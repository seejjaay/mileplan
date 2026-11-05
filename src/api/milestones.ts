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
