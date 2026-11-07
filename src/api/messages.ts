import { supabase } from '../lib/supabase'
import { PAGE_SIZE } from './messageCache'
import { removeObjects, uploadTo, type Attachment } from './storage'

export type MessageRow = {
  id: string
  created_at: string
  project_id: string
  sender_id: string
  body: string
  attachments: Attachment[]
  edited_at: string | null
}

/** Keyset cursor: the last row of the page already loaded. */
export type Cursor = { created_at: string; id: string }

const COLUMNS = 'id, created_at, project_id, sender_id, body, attachments, edited_at'
const NAME_MAX = 200

/** One page of a thread, newest first. */
export async function listMessages(projectId: string, before?: Cursor): Promise<MessageRow[]> {
  let q = supabase
    .from('messages')
    .select(COLUMNS)
    .eq('project_id', projectId)
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(PAGE_SIZE)
  // the timestamp is quoted because its `+` and `:` can be misread by PostgREST's filter parser
  if (before) q = q.or(`created_at.lt."${before.created_at}",and(created_at.eq."${before.created_at}",id.lt.${before.id})`)
  const { data, error } = await q
  if (error) throw error
  return data as unknown as MessageRow[]
}

export type SendMessageInput = { projectId: string; senderId: string; body: string; files: File[] }

/** Uploads attachments, then inserts the message. If anything fails, files already uploaded are removed. */
export async function sendMessage({ projectId, senderId, body, files }: SendMessageInput): Promise<MessageRow> {
  const uploaded: Attachment[] = []
  try {
    for (const file of files) {
      const a = await uploadTo('attachments', projectId, file)
      // the table caps name at 200 characters; the stored file keeps its full name in `path`
      uploaded.push({ ...a, name: a.name.slice(0, NAME_MAX) })
    }
    const { data, error } = await supabase
      .from('messages')
      .insert({ project_id: projectId, sender_id: senderId, body: body.trim(), attachments: uploaded })
      .select(COLUMNS)
      .single()
    if (error) throw error
    return data as unknown as MessageRow
  } catch (err) {
    await removeObjects('attachments', uploaded.map((a) => a.path))
    throw err
  }
}

/** A refused edit (window closed, not the sender) matches no row, which PostgREST reports as PGRST116; callers map that. */
export async function editMessage(id: string, body: string): Promise<MessageRow> {
  const { data, error } = await supabase.from('messages').update({ body }).eq('id', id).select(COLUMNS).single()
  if (error) throw error
  return data as unknown as MessageRow
}

export async function markRead(projectId: string): Promise<void> {
  const { error } = await supabase.rpc('mark_messages_read', { p_project_id: projectId })
  if (error) throw error
}

/** Unread count per project; projects with none are absent. */
export async function unreadCounts(): Promise<Record<string, number>> {
  const { data, error } = await supabase.rpc('unread_message_counts')
  if (error) throw error
  return Object.fromEntries((data ?? []).map((r: { project_id: string; unread: number }) => [r.project_id, r.unread]))
}
