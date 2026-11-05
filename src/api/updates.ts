import { supabase } from '../lib/supabase'
import { removeObjects, uploadTo, type Attachment } from './storage'

export type UpdateRow = {
  id: string
  project_id: string
  milestone_id: string | null
  author_id: string
  body: string
  attachments: Attachment[]
  created_at: string
  author: { full_name: string | null } | null
  milestone: { title: string } | null
}

export async function listUpdates(projectId: string): Promise<UpdateRow[]> {
  const { data, error } = await supabase
    .from('updates')
    .select('*, author:profiles!author_id(full_name), milestone:milestones!milestone_id(title)')
    .eq('project_id', projectId)
    .order('created_at', { ascending: false })
  if (error) throw error
  return data as unknown as UpdateRow[]
}

export type PostUpdateInput = { projectId: string; authorId: string; body: string; milestoneId?: string; files: File[] }

/** Uploads attachments, then inserts the update. If anything fails, files already uploaded are removed. */
export async function postUpdate({ projectId, authorId, body, milestoneId, files }: PostUpdateInput): Promise<void> {
  const uploaded: Attachment[] = []
  try {
    for (const file of files) uploaded.push(await uploadTo('attachments', projectId, file))
    const { error } = await supabase.from('updates').insert({
      project_id: projectId,
      author_id: authorId,
      body: body.trim(),
      milestone_id: milestoneId ?? null,
      attachments: uploaded,
    })
    if (error) throw error
  } catch (err) {
    await removeObjects('attachments', uploaded.map((a) => a.path))
    throw err
  }
}
