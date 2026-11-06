import { useState, type FormEvent } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { recordPayment, type PaymentRequest } from '../../../api/payments'
import { qk } from '../../../api/keys'
import type { ProjectSummary } from '../../../api/projects'
import { removeObjects, uploadTo } from '../../../api/storage'
import { toUserMessage } from '../../../lib/errors'
import { requestState, todayISO } from '../../../lib/paymentState'
import { ACCEPT_ATTR, validateUpload } from '../../../lib/validateUpload'
import { Button } from '../../../ui/Button'
import { Dialog } from '../../../ui/Dialog'
import { Field } from '../../../ui/Field'
import { useToast } from '../../../ui/Toast'

const inputClass = 'min-h-11 w-full rounded-md border border-[var(--border)] bg-[var(--surface)] px-3'

type Props = { open: boolean; onClose: () => void; project: ProjectSummary; request: PaymentRequest }

function RecordForm({ onClose, project, request }: Omit<Props, 'open'>) {
  const toast = useToast()
  const queryClient = useQueryClient()
  const [amount, setAmount] = useState(() => String(requestState(request, todayISO()).remaining))
  const [paidOn, setPaidOn] = useState(todayISO)
  const [method, setMethod] = useState('')
  const [reference, setReference] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [fileError, setFileError] = useState<string | null>(null)

  const amountNumber = Number(amount)
  const ready = amountNumber > 0 && !!paidOn && !fileError

  const record = useMutation({
    // The optional proof is uploaded first; if recording fails the file is removed so nothing is orphaned.
    mutationFn: async () => {
      const uploaded = file ? await uploadTo('payment-proofs', project.id, file) : null
      try {
        await recordPayment({
          requestId: request.id,
          amount: amountNumber,
          paidOn,
          method: method.trim() || undefined,
          reference: reference.trim() || undefined,
          proofPath: uploaded?.path,
        })
      } catch (err) {
        if (uploaded) await removeObjects('payment-proofs', [uploaded.path])
        throw err
      }
    },
    onSuccess: () => {
      toast.success('Payment recorded')
      onClose()
    },
    onError: (err) => toast.error(toUserMessage(err)),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: qk.payments(project.id) })
      void queryClient.invalidateQueries({ queryKey: qk.project(project.id) })
      void queryClient.invalidateQueries({ queryKey: qk.activity(project.id) })
    },
  })

  function pickFile(picked: File | undefined) {
    const problem = picked ? validateUpload(picked) : null
    setFileError(problem)
    setFile(picked && !problem ? picked : null)
  }

  function submit(e: FormEvent) {
    e.preventDefault()
    if (ready && !record.isPending) record.mutate()
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
      <p className="text-sm text-[var(--muted)]">{request.title}</p>
      <Field label="Amount">
        <input type="number" min="0.01" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} className={inputClass} />
      </Field>
      <Field label="Paid on">
        <input type="date" value={paidOn} onChange={(e) => setPaidOn(e.target.value)} className={inputClass} />
      </Field>
      <Field label="Method">
        <input value={method} onChange={(e) => setMethod(e.target.value)} placeholder="e.g. cash, bank transfer" className={inputClass} />
      </Field>
      <Field label="Reference">
        <input value={reference} onChange={(e) => setReference(e.target.value)} className={inputClass} />
      </Field>
      <Field label="Proof file (optional)" error={fileError}>
        <input type="file" accept={ACCEPT_ATTR} onChange={(e) => pickFile(e.target.files?.[0])} className={`${inputClass} py-2`} />
      </Field>
      <div className="flex justify-end gap-2">
        <Button variant="secondary" onClick={onClose}>
          Cancel
        </Button>
        <Button type="submit" loading={record.isPending} disabled={!ready}>
          Record payment
        </Button>
      </div>
    </form>
  )
}

/** The admin records a payment directly (cash, or proof sent by chat). It is confirmed on the spot. */
export function RecordPaymentDialog({ open, onClose, project, request }: Props) {
  return (
    <Dialog open={open} onClose={onClose} title="Record payment">
      <RecordForm onClose={onClose} project={project} request={request} />
    </Dialog>
  )
}
