import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { reviewPayment, type Payment } from '../../../api/payments'
import { qk } from '../../../api/keys'
import { toUserMessage } from '../../../lib/errors'
import { formatDate, formatMoney } from '../../../lib/format'
import { Button } from '../../../ui/Button'
import { Dialog } from '../../../ui/Dialog'
import { Field } from '../../../ui/Field'
import { useToast } from '../../../ui/Toast'

export const ALREADY_REVIEWED = 'This payment was already reviewed.'

type Props = { open: boolean; onClose: () => void; projectId: string; payment: Payment; mode: 'confirmed' | 'rejected'; currency?: string }

/** Confirm a pending proof, or reject it with a note. Only pending payments can be reviewed. */
export function ReviewPaymentDialog({ open, onClose, projectId, payment, mode, currency = 'PHP' }: Props) {
  const toast = useToast()
  const queryClient = useQueryClient()
  const [note, setNote] = useState('')
  const rejecting = mode === 'rejected'
  const ready = !rejecting || note.trim().length > 0

  const review = useMutation({
    mutationFn: () => reviewPayment(payment.id, mode, rejecting ? note.trim() : undefined),
    onSuccess: () => {
      toast.success(rejecting ? 'Proof rejected' : 'Payment confirmed')
      onClose()
    },
    onError: (err) => {
      // Someone (CJ in another tab) already reviewed it: say so and show the current state.
      if ((err as { code?: string } | null)?.code === '22023') {
        toast.error(ALREADY_REVIEWED)
        onClose()
      } else {
        toast.error(toUserMessage(err))
      }
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: qk.payments(projectId) })
      void queryClient.invalidateQueries({ queryKey: qk.project(projectId) })
      void queryClient.invalidateQueries({ queryKey: qk.activity(projectId) })
    },
  })

  const title = rejecting ? 'Reject proof' : 'Confirm payment'
  return (
    <Dialog open={open} onClose={onClose} title={title}>
      <div className="flex flex-col gap-4">
        <p>
          {formatMoney(payment.amount, currency)}
          {payment.paid_on ? ` paid on ${formatDate(payment.paid_on)}` : ''}
          {payment.submitter_name ? ` · sent by ${payment.submitter_name}` : ''}
        </p>
        {rejecting && (
          <Field label="Reason for rejecting">
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={3}
              className="min-h-11 w-full rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-2"
            />
          </Field>
        )}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button variant={rejecting ? 'danger' : 'primary'} loading={review.isPending} disabled={!ready} onClick={() => review.mutate()}>
            {title}
          </Button>
        </div>
      </div>
    </Dialog>
  )
}
