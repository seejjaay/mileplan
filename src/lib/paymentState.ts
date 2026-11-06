export type PaymentStatus = 'pending' | 'confirmed' | 'rejected'
export type PaymentLike = { amount: number; status: PaymentStatus }
export type RequestLike = { amount: number; due_date: string; payments: PaymentLike[] }
export type RequestStateName = 'paid' | 'proof_sent' | 'partially_paid' | 'overdue' | 'due'

/** Whole cents, so float noise (0.1 + 0.2) never decides a state or shows up in a total. */
const cents = (n: number) => Math.round(Number(n) * 100)

/**
 * A request's state is derived, never stored. The first matching rule wins:
 * paid (confirmed ≥ amount) → proof sent (a pending payment) → partially paid (confirmed > 0) → overdue (due before today) → due.
 * `today` and `due_date` are YYYY-MM-DD, so string comparison is date comparison.
 */
export function requestState(request: RequestLike, today: string): { state: RequestStateName; paid: number; remaining: number } {
  const paidCents = request.payments.filter((p) => p.status === 'confirmed').reduce((sum, p) => sum + cents(p.amount), 0)
  const remainingCents = Math.max(cents(request.amount) - paidCents, 0)
  const hasPending = request.payments.some((p) => p.status === 'pending')
  const state: RequestStateName =
    paidCents >= cents(request.amount)
      ? 'paid'
      : hasPending
        ? 'proof_sent'
        : paidCents > 0
          ? 'partially_paid'
          : request.due_date < today
            ? 'overdue'
            : 'due'
  return { state, paid: paidCents / 100, remaining: remainingCents / 100 }
}

/** Scheduled and paid are plain sums; outstanding is their difference, floored at 0; overdue counts requests. */
export function paymentTotals(
  requests: RequestLike[],
  today: string,
): { scheduled: number; paid: number; outstanding: number; overdue: number } {
  let scheduled = 0
  let paid = 0
  let overdue = 0
  for (const r of requests) {
    const s = requestState(r, today)
    scheduled += cents(r.amount)
    paid += cents(s.paid)
    if (s.state === 'overdue') overdue += 1
  }
  return { scheduled: scheduled / 100, paid: paid / 100, outstanding: Math.max(scheduled - paid, 0) / 100, overdue }
}
