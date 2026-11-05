import { supabase } from '../lib/supabase'
import { ACTIVITY_PAGE_SIZE } from '../lib/constants'

export type ActivityEntity = 'project' | 'milestone' | 'task' | 'document' | 'payment' | 'update' | 'review'
export type ActivityAction = 'created' | 'updated' | 'deleted' | 'status_changed'

export type ActivityRow = {
  id: string
  project_id: string
  actor_id: string | null
  entity: ActivityEntity
  entity_id: string
  action: ActivityAction
  /** {field: [old, new]}; created/deleted rows carry only the identifying fields (title, amount, decision). */
  changes: Record<string, [unknown, unknown]> | null
  reason: string | null
  plan_change: boolean
  created_at: string
  actor: { full_name: string | null } | null
}

/** One page, newest first. Pass the last row's created_at as `before` for the next (older) page. */
export async function listActivity(projectId: string, { before }: { before?: string } = {}): Promise<ActivityRow[]> {
  let query = supabase
    .from('activity')
    .select('*, actor:profiles!actor_id(full_name)')
    .eq('project_id', projectId)
    .order('created_at', { ascending: false })
    .limit(ACTIVITY_PAGE_SIZE)
  if (before) query = query.lt('created_at', before)
  const { data, error } = await query
  if (error) throw error
  return data as unknown as ActivityRow[]
}
