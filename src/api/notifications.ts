import { supabase } from '../lib/supabase'

export type NotificationKind =
  | 'milestone_in_review'
  | 'update_posted'
  | 'document_added'
  | 'payment_confirmed'
  | 'payment_rejected'
  | 'plan_change'
  | 'payment_proof'
  | 'milestone_approved'
  | 'changes_requested'
  | 'plan_change_acked'

export type NotificationRow = {
  id: string
  project_id: string
  kind: NotificationKind
  needs_action: boolean
  /** How many events were merged into this unread row. */
  count: number
  /** What the sentence needs (titles, names, amounts), snapshotted by the database trigger. */
  data: Record<string, unknown>
  created_at: string
  updated_at: string
  read_at: string | null
  /** Null when the project is no longer visible to this user. */
  project: { title: string; currency: string } | null
}

const LIST_LIMIT = 50

/** The latest notifications for the signed-in user (RLS scopes the rows), most recently touched first. */
export async function listNotifications(): Promise<NotificationRow[]> {
  const { data, error } = await supabase
    .from('notifications')
    .select('*, project:projects(title, currency)')
    .order('updated_at', { ascending: false })
    .limit(LIST_LIMIT)
  if (error) throw error
  return data as unknown as NotificationRow[]
}

export async function unreadNotificationCount(): Promise<number> {
  const { count, error } = await supabase.from('notifications').select('id', { count: 'exact', head: true }).is('read_at', null)
  if (error) throw error
  return count ?? 0
}

export async function markNotificationsRead(ids: string[]): Promise<void> {
  const { error } = await supabase.rpc('mark_notifications_read', { p_ids: ids })
  if (error) throw error
}

/** Marks information items read; action items stay until the action is done. */
export async function markAllNotificationsRead(): Promise<void> {
  const { error } = await supabase.rpc('mark_all_notifications_read')
  if (error) throw error
}
