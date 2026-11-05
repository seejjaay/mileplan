import { supabase } from '../lib/supabase'

export type MilestoneStatus = 'planned' | 'in_progress' | 'in_review' | 'approved' | 'paid'
export type TaskStatus = 'todo' | 'doing' | 'done'

export type Task = { id: string; milestone_id: string; position: number; title: string; status: TaskStatus }

export type Milestone = {
  id: string
  project_id: string
  position: number
  title: string
  description: string | null
  acceptance_criteria: string[]
  due_date: string | null
  amount: number
  status: MilestoneStatus
  on_hold: boolean
  plan_key: string | null
  approved_at: string | null
  approved_by: string | null
  tasks: Task[]
}

/** Milestones in order, each with its tasks in order. */
export async function listMilestones(projectId: string): Promise<Milestone[]> {
  const { data, error } = await supabase
    .from('milestones')
    .select('*, tasks(*)')
    .eq('project_id', projectId)
    .order('position')
    .order('position', { referencedTable: 'tasks' })
  if (error) throw error
  return data as Milestone[]
}

/** Sum in whole cents so float noise never shows up in totals. */
export function totalAmount(milestones: { amount: number }[]): number {
  return milestones.reduce((cents, m) => cents + Math.round(Number(m.amount) * 100), 0) / 100
}

export type MilestonePatch = Partial<
  Pick<Milestone, 'title' | 'description' | 'acceptance_criteria' | 'due_date' | 'amount' | 'on_hold' | 'status'>
>
export type NewMilestone = { title: string; description?: string; acceptance_criteria?: string[]; due_date?: string; amount?: number }

export async function addMilestone(projectId: string, fields: NewMilestone, reason?: string): Promise<string> {
  const { data, error } = await supabase.rpc('add_milestone', { p_project_id: projectId, p_fields: fields, p_reason: reason ?? null })
  if (error) throw error
  return data as string
}

export async function updateMilestone(id: string, patch: MilestonePatch, reason?: string): Promise<void> {
  const { error } = await supabase.rpc('update_milestone', { p_id: id, p_patch: patch, p_reason: reason ?? null })
  if (error) throw error
}

export async function deleteMilestone(id: string, reason?: string): Promise<void> {
  const { error } = await supabase.rpc('delete_milestone', { p_id: id, p_reason: reason ?? null })
  if (error) throw error
}

export async function addTask(milestoneId: string, title: string, position: number): Promise<void> {
  // project_id is filled in by the tasks_set_project_id trigger
  const { error } = await supabase.from('tasks').insert({ milestone_id: milestoneId, title: title.trim(), position })
  if (error) throw error
}

export async function updateTask(id: string, patch: { title?: string; status?: TaskStatus }): Promise<void> {
  const { error } = await supabase.from('tasks').update(patch).eq('id', id)
  if (error) throw error
}

export async function deleteTask(id: string): Promise<void> {
  const { error } = await supabase.from('tasks').delete().eq('id', id)
  if (error) throw error
}

export async function reorderMilestones(projectId: string, ids: string[]): Promise<void> {
  const { error } = await supabase.rpc('reorder_milestones', { p_project_id: projectId, p_ids: ids })
  if (error) throw error
}

export async function reorderTasks(milestoneId: string, ids: string[]): Promise<void> {
  const { error } = await supabase.rpc('reorder_tasks', { p_milestone_id: milestoneId, p_ids: ids })
  if (error) throw error
}

export async function splitMilestone(id: string, taskIds: string[], title: string, amount: number, reason?: string): Promise<string> {
  const { data, error } = await supabase.rpc('split_milestone', {
    p_id: id,
    p_task_ids: taskIds,
    p_title: title,
    p_amount: amount,
    p_reason: reason ?? null,
  })
  if (error) throw error
  return data as string
}

export async function mergeMilestones(firstId: string, secondId: string, reason?: string): Promise<void> {
  const { error } = await supabase.rpc('merge_milestones', { p_first: firstId, p_second: secondId, p_reason: reason ?? null })
  if (error) throw error
}
