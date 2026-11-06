import { supabase } from '../lib/supabase'
import { ACTIVITY_PAGE_SIZE } from '../lib/constants'

export type ActivityEntity = 'project' | 'milestone' | 'task' | 'document' | 'payment' | 'payment_request' | 'update' | 'review'
export type ActivityAction = 'created' | 'updated' | 'deleted' | 'status_changed'

export type Ack = { user_id: string; acked_at: string; acker_name?: string | null }

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
  actor_name: string | null
  /** plan-change acknowledgements recorded so far (empty for rows that are not plan changes) */
  acks: Ack[]
}

/** One page, newest first. Pass the last row's created_at as `before` for the next (older) page. */
export async function listActivity(projectId: string, { before }: { before?: string } = {}): Promise<ActivityRow[]> {
  let query = supabase
    .from('activity')
    .select('*, actor_name, acks:plan_change_acks(user_id, acked_at, acker_name)')
    .eq('project_id', projectId)
    .order('created_at', { ascending: false })
    .limit(ACTIVITY_PAGE_SIZE)
  if (before) query = query.lt('created_at', before)
  const { data, error } = await query
  if (error) throw error
  return data as unknown as ActivityRow[]
}

/** Everything logged after `since` (capped), newest first. Used for the "updated since your last visit" markers. */
export async function listActivitySince(projectId: string, since: string): Promise<ActivityRow[]> {
  const { data, error } = await supabase
    .from('activity')
    .select('*, actor_name, acks:plan_change_acks(user_id, acked_at, acker_name)')
    .eq('project_id', projectId)
    .gt('created_at', since)
    .order('created_at', { ascending: false })
    .limit(200)
  if (error) throw error
  return data as unknown as ActivityRow[]
}
