import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { listActivitySince } from '../../api/activity'
import { listMilestones } from '../../api/milestones'
import { qk } from '../../api/keys'
import { useAuth } from '../../auth/AuthProvider'
import { changedSince } from '../../lib/changedSince'
import type { ChangeMarkers } from './changeMarkers'
import { useLastVisit } from './useLastVisit'

/** "Updated since your last visit" for the signed-in client; empty for the admin and on a first visit. */
export function useProjectMarkers(projectId: string): ChangeMarkers {
  const { profile } = useAuth()
  const { since } = useLastVisit(projectId)
  const enabled = profile?.role === 'client' && !!since
  const rows = useQuery({ queryKey: qk.changesSince(projectId, since), queryFn: () => listActivitySince(projectId, since!), enabled })
  const milestones = useQuery({ queryKey: qk.milestones(projectId), queryFn: () => listMilestones(projectId), enabled })

  return useMemo(() => {
    const taskMilestone = new Map<string, string>()
    for (const m of milestones.data ?? []) for (const t of m.tasks) taskMilestone.set(t.id, m.id)
    return { ...changedSince(rows.data ?? [], since, profile?.id ?? '', taskMilestone), tick: null }
  }, [rows.data, milestones.data, since, profile?.id])
}
