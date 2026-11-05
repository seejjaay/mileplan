import { supabase } from '../lib/supabase'
import type { ActivityRow } from './activity'

export type PlanChange = ActivityRow

/** Plan-change activity rows, oldest first, each with the acknowledgements recorded so far. */
export async function listPlanChanges(projectId: string): Promise<PlanChange[]> {
  const { data, error } = await supabase
    .from('activity')
    .select('*, actor_name, acks:plan_change_acks(user_id, acked_at, acker_name)')
    .eq('project_id', projectId)
    .eq('plan_change', true)
    .order('created_at', { ascending: true })
  if (error) throw error
  return data as unknown as PlanChange[]
}

/** Records that `userId` has seen exactly these changes. Re-acknowledging is a no-op (ON CONFLICT DO NOTHING). */
export async function acknowledge(userId: string, activityIds: string[]): Promise<void> {
  if (activityIds.length === 0) return
  const { error } = await supabase
    .from('plan_change_acks')
    .upsert(
      activityIds.map((activity_id) => ({ activity_id, user_id: userId })),
      { onConflict: 'activity_id,user_id', ignoreDuplicates: true },
    )
  if (error) throw error
}

export function unacknowledged(changes: PlanChange[], userId: string): PlanChange[] {
  return changes.filter((c) => !c.acks.some((a) => a.user_id === userId))
}
