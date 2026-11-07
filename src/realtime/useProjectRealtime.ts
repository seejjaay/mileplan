import { useEffect, useState } from 'react'
import { useQueryClient, type QueryClient } from '@tanstack/react-query'
import { qk } from '../api/keys'
import { appendMessage, replaceMessage, type Thread } from '../api/messageCache'
import type { MessageRow } from '../api/messages'
import { supabase } from '../lib/supabase'

/** Show "Reconnecting…" only if a channel that was working has been down this long. */
const RECONNECT_PILL_DELAY_MS = 1500

type Payload = { eventType?: string; new?: Record<string, unknown>; old?: Record<string, unknown> }

export type LastChange = { table: 'milestones'; id: string; at: number }

function invalidateAll(queryClient: QueryClient, projectId: string) {
  for (const queryKey of [
    qk.milestones(projectId),
    qk.project(projectId),
    qk.projects(),
    qk.updates(projectId),
    qk.documents(projectId),
    qk.activity(projectId),
    qk.planChanges(projectId),
    qk.reviews(projectId),
    qk.payments(projectId),
    qk.messages(projectId),
    qk.unread(),
  ]) {
    void queryClient.invalidateQueries({ queryKey })
  }
}

/** Which query keys a change in each table makes stale. `activity` is handled separately (it refreshes everything). */
function keysFor(table: string, projectId: string) {
  switch (table) {
    case 'milestones':
    case 'tasks':
    case 'projects':
      return [qk.milestones(projectId), qk.project(projectId), qk.projects()]
    case 'updates':
      return [qk.updates(projectId)]
    case 'documents':
      return [qk.documents(projectId)]
    case 'plan_change_acks':
      // the Timeline embeds who acknowledged each change, so it must refresh too
      return [qk.planChanges(projectId), qk.activity(projectId)]
    case 'milestone_reviews':
      return [qk.reviews(projectId), qk.milestones(projectId), qk.planChanges(projectId)]
    case 'payment_requests':
    case 'payments':
      return [qk.payments(projectId), qk.project(projectId), qk.projects()]
    default:
      return []
  }
}

/**
 * One Realtime channel per open project. Realtime applies RLS per subscriber, so only people who may read a row
 * hear about it. Supabase cannot filter DELETE events, but every audited change also inserts an `activity` row
 * (filterable), so an activity event refreshes everything for the project.
 */
export function useProjectRealtime(projectId: string) {
  const queryClient = useQueryClient()
  const [connected, setConnected] = useState(false)
  const [reconnecting, setReconnecting] = useState(false)
  const [lastChange, setLastChange] = useState<LastChange | null>(null)

  useEffect(() => {
    let active = true
    let hasConnected = false
    let dropped = false
    let timer: ReturnType<typeof setTimeout> | undefined

    const markDown = () => {
      setConnected(false)
      if (!hasConnected) return // never connected yet: not a "re-connect"
      dropped = true
      timer ??= setTimeout(() => active && setReconnecting(true), RECONNECT_PILL_DELAY_MS)
    }
    const markUp = () => {
      if (dropped) invalidateAll(queryClient, projectId) // anything missed while offline
      dropped = false
      hasConnected = true
      clearTimeout(timer)
      timer = undefined
      setConnected(true)
      setReconnecting(false)
    }

    const onChange = (table: string) => (payload: Payload) => {
      if (!active) return
      if (table === 'activity') {
        invalidateAll(queryClient, projectId)
        const row = payload.new
        if (row?.entity === 'milestone' && row.action === 'status_changed') {
          setLastChange({ table: 'milestones', id: String(row.entity_id), at: Date.now() })
        }
        return
      }
      if (table === 'messages') {
        // patch the open thread in place instead of refetching it; a thread that isn't loaded yet stays unwritten
        const row = payload.new as MessageRow | undefined
        if (!row) return
        const patch = payload.eventType === 'INSERT' ? appendMessage : payload.eventType === 'UPDATE' ? replaceMessage : undefined
        if (patch) queryClient.setQueryData<Thread>(qk.messages(projectId), (t) => patch(t, row))
        return
      }
      for (const queryKey of keysFor(table, projectId)) void queryClient.invalidateQueries({ queryKey })
    }

    let channel = supabase.channel(`project:${projectId}`)
    const tables: [string, string | undefined][] = [
      ['projects', `id=eq.${projectId}`],
      ['milestones', `project_id=eq.${projectId}`],
      ['tasks', `project_id=eq.${projectId}`],
      ['updates', `project_id=eq.${projectId}`],
      ['documents', `project_id=eq.${projectId}`],
      ['payment_requests', `project_id=eq.${projectId}`],
      ['payments', `project_id=eq.${projectId}`],
      ['activity', `project_id=eq.${projectId}`],
      ['messages', `project_id=eq.${projectId}`],
      ['plan_change_acks', undefined],
      ['milestone_reviews', undefined],
    ]
    for (const [table, filter] of tables) {
      channel = channel.on('postgres_changes', { event: '*', schema: 'public', table, ...(filter ? { filter } : {}) }, onChange(table))
    }
    // SUBSCRIBED only means the channel joined; the server starts streaming changes later (seconds, on a cold
    // Realtime) and says so with this message, once per join. Changes in between are never delivered, so refetch
    // what's on screen: on first open (the page's initial fetch may predate the stream) and after every rejoin.
    channel = channel.on('system', {}, (payload: { extension?: string; status?: string }) => {
      if (!active || payload.extension !== 'postgres_changes' || payload.status !== 'ok') return
      invalidateAll(queryClient, projectId)
    })
    channel.subscribe((status: string) => {
      if (!active) return
      if (status === 'SUBSCRIBED') markUp()
      else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') markDown()
    })

    const onOffline = () => markDown()
    // The browser is back. If the socket really died the channel reports it (and the pill returns); if it never noticed,
    // there is nothing to wait for, so don't leave the pill up.
    const onOnline = () => {
      clearTimeout(timer)
      timer = undefined
      setReconnecting(false)
      invalidateAll(queryClient, projectId)
    }
    window.addEventListener('offline', onOffline)
    window.addEventListener('online', onOnline)

    return () => {
      active = false
      clearTimeout(timer)
      window.removeEventListener('offline', onOffline)
      window.removeEventListener('online', onOnline)
      void supabase.removeChannel(channel)
    }
  }, [projectId, queryClient])

  return { connected, reconnecting, lastChange }
}
