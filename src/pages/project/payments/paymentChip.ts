import type { PaymentStatus, RequestStateName } from '../../../lib/paymentState'
import type { ChipStatus } from '../../../ui/StatusChip'

/** Every state prints its word, so meaning never rests on colour alone. */
export const requestChip: Record<RequestStateName, { status: ChipStatus; label: string }> = {
  paid: { status: 'done', label: 'Paid' },
  proof_sent: { status: 'active', label: 'Proof sent' },
  partially_paid: { status: 'active', label: 'Partially paid' },
  overdue: { status: 'attention', label: 'Overdue' },
  due: { status: 'upcoming', label: 'Due' },
}

export const paymentChip: Record<PaymentStatus, { status: ChipStatus; label: string }> = {
  confirmed: { status: 'done', label: 'Confirmed' },
  pending: { status: 'active', label: 'Pending' },
  rejected: { status: 'inactive', label: 'Rejected' },
}
