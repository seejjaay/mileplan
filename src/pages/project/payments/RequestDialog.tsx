import { useState, type FormEvent } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import {
  addPaymentRequest,
  deletePaymentRequest,
  updatePaymentRequest,
  type PaymentRequest,
  type PaymentRequestPatch,
} from '../../../api/payments'
import { qk } from '../../../api/keys'
import type { ProjectSummary } from '../../../api/projects'
import { toUserMessage } from '../../../lib/errors'
import { Button } from '../../../ui/Button'
import { Dialog } from '../../../ui/Dialog'
import { Field } from '../../../ui/Field'
import { useToast } from '../../../ui/Toast'
import { ReasonField } from '../milestones/ReasonField'

const inputClass = 'min-h-11 w-full rounded-md border border-[var(--border)] bg-[var(--surface)] px-3'

type Props = {
  open: boolean
  onClose: () => void
  project: ProjectSummary
  milestones: { id: string; title: string }[]
  /** Present when editing; absent when adding. */
  request?: PaymentRequest
}

function RequestForm({ onClose, project, milestones, request }: Omit<Props, 'open'>) {
  const toast = useToast()
  const queryClient = useQueryClient()
  const [title, setTitle] = useState(request?.title ?? '')
  const [amount, setAmount] = useState(request ? String(request.amount) : '')
  const [dueDate, setDueDate] = useState(request?.due_date ?? '')
  const [milestoneId, setMilestoneId] = useState(request?.milestone_id ?? '')
  const [reason, setReason] = useState('')
  const [confirmingDelete, setConfirmingDelete] = useState(false)

  const active = project.status === 'active' // on an active project this is a plan change, so ask why
  const amountNumber = Number(amount)
  const valid = !!title.trim() && amountNumber > 0 && !!dueDate

  // Only what changed goes to the server; Save stays disabled until something has.
  const patch: PaymentRequestPatch = {}
  if (request) {
    if (title.trim() !== request.title) patch.title = title.trim()
    if (amountNumber !== Number(request.amount)) patch.amount = amountNumber
    if (dueDate !== request.due_date) patch.due_date = dueDate
    if ((milestoneId || null) !== request.milestone_id) patch.milestone_id = milestoneId || null
  }
  const dirty = !request || Object.keys(patch).length > 0

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: qk.payments(project.id) })
    void queryClient.invalidateQueries({ queryKey: qk.project(project.id) })
    void queryClient.invalidateQueries({ queryKey: qk.activity(project.id) })
    void queryClient.invalidateQueries({ queryKey: qk.planChanges(project.id) })
  }

  const save = useMutation({
    mutationFn: async () => {
      const why = reason.trim() || undefined
      if (request) await updatePaymentRequest(request.id, patch, why)
      else await addPaymentRequest({ projectId: project.id, title: title.trim(), amount: amountNumber, dueDate, milestoneId: milestoneId || null }, why)
    },
    onSuccess: () => {
      toast.success(request ? 'Scheduled payment updated' : 'Scheduled payment added')
      onClose()
    },
    onError: (err) => toast.error(toUserMessage(err)),
    onSettled: refresh,
  })

  const remove = useMutation({
    mutationFn: () => deletePaymentRequest(request!.id, reason.trim() || undefined),
    onSuccess: () => {
      toast.success('Scheduled payment deleted')
      onClose()
    },
    onError: (err) => toast.error(toUserMessage(err)),
    onSettled: refresh,
  })

  function submit(e: FormEvent) {
    e.preventDefault()
    if (valid && dirty && !save.isPending) save.mutate()
  }

  if (confirmingDelete && request) {
    return (
      <div className="flex flex-col gap-4">
        <p>
          Delete “{request.title}”? Any proofs and payments recorded against it are deleted too.
          {request.payments.length > 0 ? ` That is ${request.payments.length} payment${request.payments.length === 1 ? '' : 's'}.` : ''}
        </p>
        {active && <ReasonField value={reason} onChange={setReason} />}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={() => setConfirmingDelete(false)}>
            Keep it
          </Button>
          <Button variant="danger" loading={remove.isPending} onClick={() => remove.mutate()}>
            Delete scheduled payment
          </Button>
        </div>
      </div>
    )
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
      <Field label="Title">
        <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. 50% deposit" className={inputClass} />
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Amount">
          <input type="number" min="0.01" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} className={inputClass} />
        </Field>
        <Field label="Due date">
          <input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} className={inputClass} />
        </Field>
      </div>
      <Field label="Milestone (optional)">
        <select value={milestoneId} onChange={(e) => setMilestoneId(e.target.value)} className={inputClass}>
          <option value="">Not tied to a milestone</option>
          {milestones.map((m) => (
            <option key={m.id} value={m.id}>
              {m.title}
            </option>
          ))}
        </select>
      </Field>
      {active && <ReasonField value={reason} onChange={setReason} />}
      <div className="flex flex-wrap justify-between gap-2">
        <div>
          {request && (
            <Button variant="danger" onClick={() => setConfirmingDelete(true)}>
              Delete…
            </Button>
          )}
        </div>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" loading={save.isPending} disabled={!valid || !dirty}>
            {request ? 'Save changes' : 'Add scheduled payment'}
          </Button>
        </div>
      </div>
    </form>
  )
}

/** Add, edit or (with a confirm) delete a scheduled payment. The form mounts fresh each time the dialog opens. */
export function RequestDialog({ open, onClose, project, milestones, request }: Props) {
  return (
    <Dialog open={open} onClose={onClose} title={request ? 'Edit scheduled payment' : 'Add scheduled payment'}>
      <RequestForm onClose={onClose} project={project} milestones={milestones} request={request} />
    </Dialog>
  )
}
