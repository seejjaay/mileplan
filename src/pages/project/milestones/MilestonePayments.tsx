import type { PaymentRequest } from '../../../api/payments'
import { formatMoney } from '../../../lib/format'
import { requestState, todayISO } from '../../../lib/paymentState'
import { requestChip } from '../payments/paymentChip'

/** A milestone's scheduled payments, one line each with the state in words. Nothing when it has none. */
export function MilestonePayments({ requests, currency }: { requests: PaymentRequest[]; currency: string }) {
  if (requests.length === 0) return null
  const today = todayISO()
  return (
    <ul aria-label="Scheduled payments" className="flex flex-col gap-1 text-sm">
      {requests.map((r) => (
        <li key={r.id}>{`${r.title} · ${formatMoney(r.amount, currency)} · ${requestChip[requestState(r, today).state].label}`}</li>
      ))}
    </ul>
  )
}
