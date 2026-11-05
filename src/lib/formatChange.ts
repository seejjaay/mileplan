import type { ActivityEntity, ActivityRow } from '../api/activity'
import { formatDate, formatMoney } from './format'

const DATE_FIELDS = new Set(['due_date', 'start_date', 'end_date', 'signed_at', 'paid_on'])
// Bookkeeping columns that change as a side effect and say nothing a person would care about.
const HIDDEN_FIELDS = new Set(['position', 'approved_at', 'approved_by', 'activated_at', 'closed_at', 'reviewed_at', 'reviewed_by', 'uploaded_by', 'edited_at'])

const STATUS_WORDS: Record<string, string> = {
  planned: 'Planned',
  in_progress: 'In progress',
  in_review: 'In review',
  approved: 'Approved',
  paid: 'Paid',
  todo: 'To do',
  doing: 'Doing',
  done: 'Done',
  setup: 'Setting up',
  active: 'Active',
  completed: 'Completed',
  terminated: 'Terminated',
  pending: 'Pending',
  confirmed: 'Confirmed',
  rejected: 'Rejected',
  signed: 'Signed',
  superseded: 'Superseded',
}

const ENTITY_WORD: Record<ActivityEntity, string> = {
  project: 'Project',
  milestone: 'Milestone',
  task: 'Task',
  document: 'Document',
  payment: 'Payment',
  update: 'Update',
  review: 'Review',
}

const DECISION_WORDS: Record<string, string> = { approved: 'approved', changes_requested: 'requested changes' }

const label = (field: string) => {
  const text = field.replace(/_/g, ' ')
  return text.charAt(0).toUpperCase() + text.slice(1)
}

const quote = (text: string) => `“${text.length > 60 ? `${text.slice(0, 57)}…` : text}”`

function formatValue(field: string, value: unknown, currency: string): string {
  if (value === null || value === undefined || value === '') return '—'
  if (DATE_FIELDS.has(field)) return formatDate(String(value))
  if (field === 'amount') return formatMoney(Number(value), currency)
  if (field === 'status') return STATUS_WORDS[String(value)] ?? String(value)
  if (typeof value === 'boolean') return value ? 'Yes' : 'No'
  if (Array.isArray(value)) return value.map(String).join(', ')
  if (typeof value === 'string') return quote(value)
  return String(value)
}

/** "Due date: Dec 1, 2026 → Dec 15, 2026" — one field's before/after in plain words. */
export function formatChange(_entity: string, field: string, from: unknown, to: unknown, currency: string): string {
  if (field === 'acceptance_criteria') {
    const before = Array.isArray(from) ? (from as string[]) : []
    const after = Array.isArray(to) ? (to as string[]) : []
    const added = after.filter((l) => !before.includes(l)).map(quote)
    const removed = before.filter((l) => !after.includes(l)).map(quote)
    const parts = [added.length ? `added ${added.join(', ')}` : '', removed.length ? `removed ${removed.join(', ')}` : ''].filter(Boolean)
    return `${label(field)}: ${parts.join('; ') || 'reordered'}`
  }
  return `${label(field)}: ${formatValue(field, from, currency)} → ${formatValue(field, to, currency)}`
}

type Context = { currency: string; /** current name of the entity, when it still exists */ subjectName?: string }

/** One plain-language sentence for an activity row; the edit reason, if any, is appended. */
export function describeActivity(row: ActivityRow, { currency, subjectName }: Context): string {
  const word = ENTITY_WORD[row.entity]
  const lower = word.toLowerCase()
  const changes = row.changes ?? {}
  // Created/deleted rows record the title; on updates `title` is a before/after diff, not a name.
  const recorded = row.action === 'created' ? changes.title?.[1] : row.action === 'deleted' ? changes.title?.[0] : undefined
  const name = typeof recorded === 'string' && recorded ? recorded : subjectName
  const named = name ? `${word} ${quote(name)}` : word

  let sentence: string
  if (row.action === 'created') {
    if (row.entity === 'update') sentence = 'Posted an update'
    else if (row.entity === 'project') sentence = 'Created the project'
    else if (row.entity === 'payment') sentence = changes.amount ? `Added payment ${formatMoney(Number(changes.amount[1]), currency)}` : 'Added a payment'
    else if (row.entity === 'review') sentence = `Reviewed a milestone: ${DECISION_WORDS[String(changes.decision?.[1])] ?? 'decision recorded'}`
    else sentence = `Added ${lower}${name ? ` ${quote(name)}` : ''}`
  } else if (row.action === 'deleted') {
    sentence = row.entity === 'payment' ? 'Removed a payment' : `Removed ${lower}${name ? ` ${quote(name)}` : ''}`
  } else {
    const fields = Object.entries(changes)
      .filter(([field]) => !HIDDEN_FIELDS.has(field))
      .map(([field, [from, to]]) => formatChange(row.entity, field, from, to, currency))
    sentence = fields.length ? `${named} — ${fields.join('; ')}` : `${named} updated`
  }
  return row.reason ? `${sentence}. Reason: ${row.reason}` : sentence
}
