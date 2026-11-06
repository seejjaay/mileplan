import { supabase } from '../lib/supabase'
import { paymentTotals, todayISO, type RequestLike } from '../lib/paymentState'

export type ProjectStatus = 'setup' | 'active' | 'completed' | 'terminated'

export type Project = {
  id: string
  title: string
  summary: string | null
  status: ProjectStatus
  currency: string
  start_date: string | null
  end_date: string | null
  activated_at: string | null
  closed_at: string | null
  created_at: string
}

export type DueMilestone = { title: string; due_date: string }
/** Money across the schedule: scheduled and paid are sums, outstanding is the shortfall (never below 0), overdue counts late requests. */
export type PaymentSummary = { scheduled: number; paid: number; outstanding: number; overdue: number }
export type ProjectSummary = Project & { percent: number; nextDue: DueMilestone | null } & PaymentSummary

type MilestoneLite = { title: string; due_date: string | null; status: string }

const DONE = new Set(['approved', 'paid'])

/** round(100 * (approved + paid) / total); 0 when there are no milestones. */
export function percentComplete(statuses: string[]): number {
  if (statuses.length === 0) return 0
  return Math.round((100 * statuses.filter((s) => DONE.has(s)).length) / statuses.length)
}

/** Earliest due date among milestones that aren't finished yet. */
export function nextDueMilestone(milestones: MilestoneLite[]): DueMilestone | null {
  const pending = milestones
    .filter((m): m is MilestoneLite & { due_date: string } => !!m.due_date && !DONE.has(m.status))
    .sort((a, b) => a.due_date.localeCompare(b.due_date))
  return pending[0] ? { title: pending[0].title, due_date: pending[0].due_date } : null
}

const COLUMNS =
  'id, title, summary, status, currency, start_date, end_date, activated_at, closed_at, created_at, milestones(title, due_date, status), payment_requests(amount, due_date, payments(amount, status))'

type Row = Project & { milestones: MilestoneLite[]; payment_requests: RequestLike[] }

export function toSummary({ milestones, payment_requests, ...project }: Row): ProjectSummary {
  return {
    ...project,
    percent: percentComplete(milestones.map((m) => m.status)),
    nextDue: nextDueMilestone(milestones),
    ...paymentTotals(payment_requests ?? [], todayISO()),
  }
}

export async function listProjects(): Promise<ProjectSummary[]> {
  const { data, error } = await supabase.from('projects').select(COLUMNS).order('created_at', { ascending: false })
  if (error) throw error
  return (data as unknown as Row[]).map(toSummary)
}

export async function getProject(id: string): Promise<ProjectSummary> {
  const { data, error } = await supabase.from('projects').select(COLUMNS).eq('id', id).maybeSingle()
  if (error) throw error
  // RLS hides projects the caller can't see, so "missing" and "not allowed" look the same.
  if (!data) throw Object.assign(new Error("You don't have access to this"), { code: '42501' })
  return toSummary(data as unknown as Row)
}

export type NewProjectInput = { title: string; summary?: string; currency?: string; start_date?: string; end_date?: string }

export async function createProject(input: NewProjectInput): Promise<string> {
  const { data, error } = await supabase
    .from('projects')
    .insert({
      title: input.title.trim(),
      summary: input.summary?.trim() || null,
      currency: (input.currency || 'PHP').toUpperCase(),
      start_date: input.start_date || null,
      end_date: input.end_date || null,
    })
    .select('id')
    .single()
  if (error) throw error
  return data.id as string
}

export async function activateProject(projectId: string): Promise<void> {
  const { error } = await supabase.rpc('activate_project', { p_project_id: projectId })
  if (error) throw error
}
