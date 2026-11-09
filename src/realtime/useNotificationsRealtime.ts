import { useEffect } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { qk } from '../api/keys'
import { supabase } from '../lib/supabase'

/**
 * One app-wide channel for the signed-in user's own notifications. It listens to every event, not only inserts:
 * an item resolved on another device (or by the other side) is an UPDATE, and the bell here must shrink too.
 */
export function useNotificationsRealtime(userId: string | undefined) {
  const queryClient = useQueryClient()

  useEffect(() => {
    if (!userId) return
    let active = true
    const refresh = () => {
      if (active) void queryClient.invalidateQueries({ queryKey: qk.notifications() })
    }
    const channel = supabase
      .channel(`notifications:${userId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'notifications', filter: `recipient_id=eq.${userId}` }, refresh)
      // Events are not replayed after a dropped connection (a phone that slept), so every (re)join refreshes.
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') refresh()
      })
    return () => {
      active = false
      void supabase.removeChannel(channel)
    }
  }, [userId, queryClient])
}
