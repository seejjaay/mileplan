import { useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { listPaymentRequests, type Payment, type PaymentRequest } from '../../../api/payments'
import { fileNameFromPath } from '../../../api/documents'
import { listMilestones } from '../../../api/milestones'
import { signedUrl } from '../../../api/storage'
import { qk } from '../../../api/keys'
import type { ProjectSummary } from '../../../api/projects'
import { useAuth } from '../../../auth/AuthProvider'
import { toUserMessage } from '../../../lib/errors'
import { formatDate, formatMoney } from '../../../lib/format'
import { openUrl } from '../../../lib/openUrl'
import { requestState, todayISO } from '../../../lib/paymentState'
import { AsyncView } from '../../../ui/AsyncView'
import { Button } from '../../../ui/Button'
import { StatusChip } from '../../../ui/StatusChip'
import { useToast } from '../../../ui/Toast'
import { paymentChip, requestChip } from './paymentChip'
import { ProofDialog } from './ProofDialog'
import { RecordPaymentDialog } from './RecordPaymentDialog'
import { RequestDialog } from './RequestDialog'
import { ReviewPaymentDialog } from './ReviewPaymentDialog'

type Dialogs =
  | { kind: 'add' }
  | { kind: 'edit'; request: PaymentRequest }
  | { kind: 'proof'; request: PaymentRequest }
  | { kind: 'record'; request: PaymentRequest }
  | { kind: 'review'; payment: Payment; mode: 'confirmed' | 'rejected' }

function ViewProof({ payment }: { payment: Payment }) {
  const toast = useToast()
  const view = useMutation({
    mutationFn: async () => openUrl(await signedUrl('payment-proofs', payment.proof_path!, fileNameFromPath(payment.proof_path!))),
    onError: (err) => toast.error(toUserMessage(err)),
  })
  return (
    <Button variant="secondary" loading={view.isPending} onClick={() => view.mutate()}>
      View proof
    </Button>
  )
}

function PaymentLine({
  payment,
  currency,
  isAdmin,
  onReview,
}: {
  payment: Payment
  currency: string
  isAdmin: boolean
  onReview: (payment: Payment, mode: 'confirmed' | 'rejected') => void
}) {
  const chip = paymentChip[payment.status]
  return (
    <li className="flex flex-col gap-2 border-t border-[var(--border)] pt-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium">{formatMoney(payment.amount, currency)}</span>
        <StatusChip {...chip} />
        <span className="text-sm text-[var(--muted)]">
          {payment.paid_on ? formatDate(payment.paid_on) : formatDate(payment.created_at)}
          {payment.method ? ` · ${payment.method}` : ''}
          {payment.reference ? ` · ${payment.reference}` : ''}
        </span>
      </div>
      {payment.submitter_name && <p className="text-sm text-[var(--muted)]">{payment.submitter_name}</p>}
      {payment.status === 'rejected' && payment.review_note && <p className="text-sm">Note: {payment.review_note}</p>}
      <div className="flex flex-wrap gap-2">
        {payment.proof_path && <ViewProof payment={payment} />}
        {isAdmin && payment.status === 'pending' && (
          <>
            <Button onClick={() => onReview(payment, 'confirmed')}>Confirm payment</Button>
            <Button variant="danger" onClick={() => onReview(payment, 'rejected')}>
              Reject proof
            </Button>
          </>
        )}
      </div>
    </li>
  )
}

function RequestItem({
  request,
  milestoneTitle,
  currency,
  isAdmin,
  onOpen,
}: {
  request: PaymentRequest
  milestoneTitle: string | null
  currency: string
  isAdmin: boolean
  onOpen: (dialog: Dialogs) => void
}) {
  const { state, paid, remaining } = requestState(request, todayISO())
  return (
    <li className="flex flex-col gap-3 rounded-md border border-[var(--border)] bg-[var(--surface)] p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-medium">{request.title}</h3>
        <StatusChip {...requestChip[state]} />
      </div>
      <p className="text-sm text-[var(--muted)]">
        Due {formatDate(request.due_date)}
        {milestoneTitle ? ` · ` : ''}
        {milestoneTitle && <span>{milestoneTitle}</span>}
      </p>
      <p className="text-sm">
        Paid {formatMoney(paid, currency)} of {formatMoney(request.amount, currency)}
        {remaining > 0 ? ` · Remaining ${formatMoney(remaining, currency)}` : ''}
      </p>
      {request.payments.length > 0 && (
        <ul className="flex flex-col gap-3">
          {request.payments.map((p) => (
            <PaymentLine
              key={p.id}
              payment={p}
              currency={currency}
              isAdmin={isAdmin}
              onReview={(payment, mode) => onOpen({ kind: 'review', payment, mode })}
            />
          ))}
        </ul>
      )}
      <div className="flex flex-wrap gap-2">
        {!isAdmin && state !== 'paid' && <Button onClick={() => onOpen({ kind: 'proof', request })}>Upload proof</Button>}
        {isAdmin && state !== 'paid' && (
          <Button variant="secondary" onClick={() => onOpen({ kind: 'record', request })}>
            Record payment
          </Button>
        )}
        {isAdmin && (
          <Button variant="secondary" aria-label={`Edit ${request.title}`} onClick={() => onOpen({ kind: 'edit', request })}>
            Edit
          </Button>
        )}
      </div>
    </li>
  )
}

export default function PaymentsTab({ project }: { project: ProjectSummary }) {
  const { profile } = useAuth()
  const isAdmin = profile?.role === 'admin'
  const [dialog, setDialog] = useState<Dialogs | null>(null)
  // Kept mounted after it closes, so ProofDialog's duplicate-submission memory outlives a close and reopen.
  const [proofFor, setProofFor] = useState<PaymentRequest | null>(null)
  const query = useQuery({ queryKey: qk.payments(project.id), queryFn: () => listPaymentRequests(project.id) })
  const milestones = useQuery({ queryKey: qk.milestones(project.id), queryFn: () => listMilestones(project.id) })
  const milestoneList = (milestones.data ?? []).map((m) => ({ id: m.id, title: m.title }))
  const titleOf = (id: string | null) => milestoneList.find((m) => m.id === id)?.title ?? null
  const close = () => setDialog(null)
  const open = (next: Dialogs) => {
    if (next.kind === 'proof') setProofFor(next.request)
    setDialog(next)
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-semibold">Payments</h2>
        {isAdmin && <Button onClick={() => setDialog({ kind: 'add' })}>Add scheduled payment</Button>}
      </div>
      <AsyncView query={query} onRetry={() => void query.refetch()} empty={<p className="text-[var(--muted)]">No payments scheduled yet.</p>}>
        {(requests) => (
          <ul className="flex flex-col gap-3">
            {requests.map((r) => (
              <RequestItem
                key={r.id}
                request={r}
                milestoneTitle={titleOf(r.milestone_id)}
                currency={project.currency}
                isAdmin={isAdmin}
                onOpen={open}
              />
            ))}
          </ul>
        )}
      </AsyncView>

      <RequestDialog
        open={dialog?.kind === 'add' || dialog?.kind === 'edit'}
        onClose={close}
        project={project}
        milestones={milestoneList}
        request={dialog?.kind === 'edit' ? dialog.request : undefined}
      />
      {proofFor && <ProofDialog open={dialog?.kind === 'proof'} onClose={close} project={project} request={proofFor} />}
      {dialog?.kind === 'record' && <RecordPaymentDialog open onClose={close} project={project} request={dialog.request} />}
      {dialog?.kind === 'review' && (
        <ReviewPaymentDialog open onClose={close} projectId={project.id} payment={dialog.payment} mode={dialog.mode} currency={project.currency} />
      )}
    </div>
  )
}
