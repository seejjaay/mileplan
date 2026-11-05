import type { Milestone, MilestonePatch, MilestoneStatus } from '../../../api/milestones'

/** Form-state shape of one milestone row (everything is a string/bool the inputs can hold). */
export type Draft = {
  title: string
  description: string
  criteria: string
  due_date: string
  amount: string
  status: MilestoneStatus
  on_hold: boolean
}

/** Fields whose change counts as a plan change on an active project (and so gets an optional reason). */
export const PLAN_FIELDS = ['title', 'description', 'acceptance_criteria', 'due_date', 'amount'] as const

export function toDraft(m: Milestone): Draft {
  return {
    title: m.title,
    description: m.description ?? '',
    criteria: m.acceptance_criteria.join('\n'),
    due_date: m.due_date ?? '',
    amount: String(m.amount),
    status: m.status,
    on_hold: m.on_hold,
  }
}

export function criteriaLines(text: string): string[] {
  return text.split('\n').map((l) => l.trim()).filter(Boolean)
}

export function amountValid(d: Draft): boolean {
  const n = Number(d.amount)
  return d.amount.trim() !== '' && Number.isFinite(n) && n >= 0
}

/** Only the fields that differ from the saved milestone. */
export function diffDraft(m: Milestone, d: Draft): MilestonePatch {
  const patch: MilestonePatch = {}
  if (d.title.trim() !== m.title) patch.title = d.title.trim()
  if (d.description.trim() !== (m.description ?? '').trim()) patch.description = d.description.trim() || null
  const lines = criteriaLines(d.criteria)
  if (JSON.stringify(lines) !== JSON.stringify(m.acceptance_criteria)) patch.acceptance_criteria = lines
  if ((d.due_date || null) !== m.due_date) patch.due_date = d.due_date || null
  if (amountValid(d) && Number(d.amount) !== Number(m.amount)) patch.amount = Number(d.amount)
  if (d.status !== m.status) patch.status = d.status
  if (d.on_hold !== m.on_hold) patch.on_hold = d.on_hold
  return patch
}

export function touchesPlan(patch: MilestonePatch): boolean {
  return PLAN_FIELDS.some((f) => f in patch)
}
