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
    const channel = supabase
      .channel(`notifications:${userId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'notifications', filter: `recipient_id=eq.${userId}` }, () => {
        if (active) void queryClient.invalidateQueries({ queryKey: qk.notifications() })
      })
      .subscribe()
    return () => {
      active = false
      void supabase.removeChannel(channel)
    }
  }, [userId, queryClient])
}
