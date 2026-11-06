import { useMemo, useRef, useState, type FormEvent } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { submitProof, type PaymentRequest } from '../../../api/payments'
import { qk } from '../../../api/keys'
import type { ProjectSummary } from '../../../api/projects'
import { useAuth } from '../../../auth/AuthProvider'
import { toUserMessage } from '../../../lib/errors'
import { requestState, todayISO } from '../../../lib/paymentState'
import { ACCEPT_ATTR, validateUpload } from '../../../lib/validateUpload'
import { Button } from '../../../ui/Button'
import { Dialog } from '../../../ui/Dialog'
import { Field } from '../../../ui/Field'
import { useToast } from '../../../ui/Toast'

const inputClass = 'min-h-11 w-full rounded-md border border-[var(--border)] bg-[var(--surface)] px-3'
/** An identical submission (same request, amount and file name) inside this window is a double-click or a retry loop. */
const DUPLICATE_WINDOW_MS = 10_000

type Props = { open: boolean; onClose: () => void; project: ProjectSummary; request: PaymentRequest }
type Recent = { key: string; at: number }
/** Remembers the last submission, so an identical one straight after it can be refused. */
type DuplicateGuard = { isDuplicate: (key: string) => boolean; forget: () => void }

function ProofForm({ onClose, project, request, guard }: Omit<Props, 'open'> & { guard: DuplicateGuard }) {
  const { profile } = useAuth()
  const toast = useToast()
  const queryClient = useQueryClient()
  const [amount, setAmount] = useState(() => String(requestState(request, todayISO()).remaining))
  const [paidOn, setPaidOn] = useState(todayISO)
  const [method, setMethod] = useState('')
  const [reference, setReference] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [fileError, setFileError] = useState<string | null>(null)
  const [fileKey, setFileKey] = useState(0)

  const amountNumber = Number(amount)
  const ready = !!file && !fileError && amountNumber > 0 && !!paidOn

  const upload = useMutation({
    mutationFn: () =>
      submitProof({
        projectId: project.id,
        requestId: request.id,
        userId: profile!.id,
        amount: amountNumber,
        paidOn,
        method,
        reference,
        file: file!,
      }),
    onSuccess: () => {
      toast.success('Proof uploaded')
      setFile(null)
      setFileKey((k) => k + 1)
      onClose()
    },
    onError: (err) => {
      guard.forget() // a failed attempt may be retried straight away
      toast.error(toUserMessage(err))
    },
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
    if (!ready || !profile || upload.isPending) return
    const key = `${request.id}|${amountNumber}|${file!.name}`
    if (guard.isDuplicate(key)) return
    upload.mutate()
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
        <input value={method} onChange={(e) => setMethod(e.target.value)} placeholder="e.g. GCash, bank transfer" className={inputClass} />
      </Field>
      <Field label="Reference">
        <input value={reference} onChange={(e) => setReference(e.target.value)} className={inputClass} />
      </Field>
      <Field label="Proof file" error={fileError}>
        <input key={fileKey} type="file" accept={ACCEPT_ATTR} onChange={(e) => pickFile(e.target.files?.[0])} className={`${inputClass} py-2`} />
      </Field>
      <div className="flex justify-end gap-2">
        <Button variant="secondary" onClick={onClose}>
          Cancel
        </Button>
        <Button type="submit" loading={upload.isPending} disabled={!ready}>
          Upload proof
        </Button>
      </div>
    </form>
  )
}

/** The client attaches proof of payment to a scheduled payment. The form mounts fresh each time the dialog opens. */
export function ProofDialog({ open, onClose, project, request }: Props) {
  const recent = useRef<Recent | null>(null) // outlives the form, so a close-and-reopen cannot dodge the duplicate check
  const guard = useMemo<DuplicateGuard>(
    () => ({
      isDuplicate: (key) => {
        const last = recent.current
        if (last && last.key === key && Date.now() - last.at < DUPLICATE_WINDOW_MS) return true
        recent.current = { key, at: Date.now() }
        return false
      },
      forget: () => {
        recent.current = null
      },
    }),
    [],
  )
  return (
    <Dialog open={open} onClose={onClose} title="Upload proof">
      <ProofForm onClose={onClose} project={project} request={request} guard={guard} />
    </Dialog>
  )
}
