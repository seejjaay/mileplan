import { supabase } from '../lib/supabase'

/** The caller's own previous visit stamp for this project (null on a first visit). */
export async function readLastSeen(projectId: string, userId: string): Promise<string | null> {
  const { data, error } = await supabase
    .from('project_members')
    .select('last_seen_at')
    .eq('project_id', projectId)
    .eq('user_id', userId)
    .maybeSingle()
  if (error) throw error
  return data?.last_seen_at ?? null
}

/** Stamps "now" with the database clock (so it compares correctly with activity timestamps). */
export async function touchLastSeen(projectId: string): Promise<void> {
  const { error } = await supabase.rpc('touch_last_seen', { p_project_id: projectId })
  if (error) throw error
}
