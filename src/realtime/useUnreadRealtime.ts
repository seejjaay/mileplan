import { useEffect } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { qk } from '../api/keys'
import { supabase } from '../lib/supabase'

/**
 * One app-wide channel for new messages in any project this user can read (RLS scopes what arrives), so the
 * unread counts on the project cards stay current wherever the user is. Open threads patch themselves via
 * useProjectRealtime.
 */
export function useUnreadRealtime(userId: string | undefined) {
  const queryClient = useQueryClient()

  useEffect(() => {
    if (!userId) return
    let active = true
    const channel = supabase
      .channel(`unread:${userId}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, () => {
        if (active) void queryClient.invalidateQueries({ queryKey: qk.unread() })
      })
      .subscribe()
    return () => {
      active = false
      void supabase.removeChannel(channel)
    }
  }, [userId, queryClient])
}
