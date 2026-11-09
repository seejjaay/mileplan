import type { NotificationRow } from '../api/notifications'
import type { TabKey } from '../pages/project/tabs'
import { formatMoney } from './format'

const text = (v: unknown): string => (typeof v === 'string' ? v : '')

/** The sentence a notification shows, and the project tab it opens. */
export function describeNotification(n: NotificationRow): { text: string; tab: TabKey } {
  const d = n.data
  const currency = n.project?.currency ?? 'PHP'
  const client = text(d.client_name) || 'A client'
  const amount = d.amount === null || d.amount === undefined ? '' : formatMoney(Number(d.amount), currency)
  const request = text(d.request_title)
  // "for Deposit" when the payment belongs to a request, otherwise "of PHP 35,000.00"
  const payment = request ? `for ${request}` : `of ${amount}`

  switch (n.kind) {
    case 'milestone_in_review':
      return { text: `${text(d.milestone_title)} is ready for your review`, tab: 'milestones' }
    case 'update_posted': {
      const who = text(d.actor_name) || 'CJ'
      const snippet = text(d.snippet)
      return { text: snippet ? `${who} posted an update: ${snippet}` : `${who} posted an update`, tab: 'updates' }
    }
    case 'document_added':
      return { text: `New document: ${text(d.document_title)}`, tab: 'files' }
    case 'payment_confirmed':
      return { text: `Your payment ${payment} was confirmed`, tab: 'payments' }
    case 'payment_rejected': {
      const note = text(d.note)
      return { text: `Your payment ${payment} was rejected${note ? `: ${note}` : ''}`, tab: 'payments' }
    }
    case 'plan_change':
      return { text: `The plan changed: ${n.count} ${n.count === 1 ? 'change' : 'changes'} to acknowledge`, tab: 'overview' }
    case 'payment_proof':
      return { text: `${client} sent a payment proof${request ? ` for ${request}` : ''}, ${amount}`, tab: 'payments' }
    case 'milestone_approved':
      return { text: `${client} approved ${text(d.milestone_title)}`, tab: 'milestones' }
    case 'changes_requested':
      return { text: `${client} requested changes on ${text(d.milestone_title)}`, tab: 'milestones' }
    case 'plan_change_acked':
      return { text: `${client} acknowledged the plan change`, tab: 'timeline' }
    default:
      // The bell is in the app header, so a kind this build doesn't know (a newer migration) must not take the app down.
      return { text: 'There is an update in this project', tab: 'overview' }
  }
}
