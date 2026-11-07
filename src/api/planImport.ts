import { supabase } from '../lib/supabase'

/** A change is [old, new]. */
export type FieldChange = [unknown, unknown]
export type FieldChanges = Record<string, FieldChange>

export type PlanError = { path: string; message: string }

export type AddedMilestone = { key: string; title: string; due_date: string; amount: number; tasks: string[] }
export type ChangedMilestone = {
  key: string
  title: string
  changes: FieldChanges
  tasks: { added: string[]; removed: string[]; reordered: boolean }
}
export type AddedPayment = { key: string; title: string; amount: number; due_date: string; milestone?: string | null }
export type ChangedPayment = { key: string; title: string; changes: FieldChanges }
export type KeyedRow = { key: string; title: string }
export type KeptRow = { title: string }

/** What import_plan returns. When `valid` is false only `errors` is filled. */
export type PlanImportResult = {
  valid: boolean
  applied: boolean
  errors: PlanError[]
  project: { changes: FieldChanges }
  milestones: { added: AddedMilestone[]; changed: ChangedMilestone[]; removed: KeyedRow[]; kept: KeptRow[]; reordered: boolean }
  payments: { added: AddedPayment[]; changed: ChangedPayment[]; removed: KeyedRow[]; kept: KeptRow[] }
}

async function run(projectId: string, plan: unknown, dryRun: boolean, reason: string | null): Promise<PlanImportResult> {
  const { data, error } = await supabase.rpc('import_plan', {
    p_project_id: projectId,
    p_plan: plan,
    p_dry_run: dryRun,
    p_reason: reason,
  })
  if (error) throw error
  return data as PlanImportResult
}

/** A dry run: validates and returns the diff, never writes. */
export function previewPlan(projectId: string, plan: unknown): Promise<PlanImportResult> {
  return run(projectId, plan, true, null)
}

/** Applies in one transaction. Throws if the project changed since the preview (22023) or is closed (MP001). */
export function applyPlan(projectId: string, plan: unknown, reason?: string): Promise<PlanImportResult> {
  return run(projectId, plan, false, reason ?? null)
}

export type PlanImportSummary = { added: number; changed: number; removed: number; isNoop: boolean; message: string }

/** Counts for the toast. A project field change or a reorder each count as one change; kept rows count as nothing. */
export function planImportSummary(r: PlanImportResult): PlanImportSummary {
  const added = r.milestones.added.length + r.payments.added.length
  const removed = r.milestones.removed.length + r.payments.removed.length
  const changed =
    r.milestones.changed.length +
    r.payments.changed.length +
    (Object.keys(r.project.changes).length > 0 ? 1 : 0) +
    (r.milestones.reordered ? 1 : 0)
  const isNoop = added + changed + removed === 0
  return {
    added,
    changed,
    removed,
    isNoop,
    message: isNoop ? 'Nothing to change' : `Plan imported: ${added} added, ${changed} changed, ${removed} removed`,
  }
}
