import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { invalidateProject } from '../../api/invalidate'
import { qk } from '../../api/keys'
import { closeProject, reopenProject, type ProjectSummary } from '../../api/projects'
import { toUserMessage } from '../../lib/errors'
import { Button } from '../../ui/Button'
import { Dialog } from '../../ui/Dialog'
import { Field } from '../../ui/Field'
import { useToast } from '../../ui/Toast'

type Props = { open: boolean; onClose: () => void; project: ProjectSummary }
type Outcome = 'completed' | 'terminated'

const inputClass = 'min-h-11 w-full rounded-md border border-[var(--border)] bg-[var(--surface)] px-3'

/** After a close or reopen everything on the project page may have changed: the lock, banner, totals and the timeline. */
function useRefresh(projectId: string) {
  const queryClient = useQueryClient()
  return () => {
    void invalidateProject(queryClient, projectId)
    void queryClient.invalidateQueries({ queryKey: qk.payments(projectId) })
  }
}

function CloseForm({ onClose, project }: Omit<Props, 'open'>) {
  const toast = useToast()
  const refresh = useRefresh(project.id)
  const [outcome, setOutcome] = useState<Outcome | null>(null)
  const [reason, setReason] = useState('')

  const close = useMutation({
    mutationFn: () => closeProject(project.id, outcome!, reason.trim() || undefined),
    onSuccess: () => {
      toast.success('Project closed')
      onClose()
    },
    onError: (err) => toast.error(toUserMessage(err)),
    onSettled: refresh,
  })

  return (
    <div className="flex flex-col gap-4">
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-sm font-medium">How did it end?</legend>
        {(
          [
            ['completed', 'Completed'],
            ['terminated', 'Terminated'],
          ] as const
        ).map(([value, label]) => (
          <label key={value} className="flex min-h-11 items-center gap-2">
            <input type="radio" name="outcome" checked={outcome === value} onChange={() => setOutcome(value)} />
            {label}
          </label>
        ))}
      </fieldset>
      <Field label="Reason (optional)">
        <input value={reason} onChange={(e) => setReason(e.target.value)} className={inputClass} />
      </Field>
      <p className="text-sm text-[var(--muted)]">
        The tracker becomes read-only for everyone. Messages stay open for 30 days. You can reopen the project later.
      </p>
      <div className="flex justify-end gap-2">
        <Button variant="secondary" onClick={onClose}>
          Cancel
        </Button>
        <Button variant="danger" loading={close.isPending} disabled={!outcome} onClick={() => close.mutate()}>
          Close project
        </Button>
      </div>
    </div>
  )
}

/** Active → Completed or Terminated. The form mounts fresh each time the dialog opens. */
export function CloseProjectDialog({ open, onClose, project }: Props) {
  return (
    <Dialog open={open} onClose={onClose} title="Close project">
      <CloseForm onClose={onClose} project={project} />
    </Dialog>
  )
}

function ReopenForm({ onClose, project }: Omit<Props, 'open'>) {
  const toast = useToast()
  const refresh = useRefresh(project.id)
  const [reason, setReason] = useState('')

  const reopen = useMutation({
    mutationFn: () => reopenProject(project.id, reason.trim() || undefined),
    onSuccess: () => {
      toast.success('Project reopened')
      onClose()
    },
    onError: (err) => toast.error(toUserMessage(err)),
    onSettled: refresh,
  })

  return (
    <div className="flex flex-col gap-4">
      <p>Reopening makes the tracker editable again. The project goes back to active.</p>
      <Field label="Reason (optional)">
        <input value={reason} onChange={(e) => setReason(e.target.value)} className={inputClass} />
      </Field>
      <div className="flex justify-end gap-2">
        <Button variant="secondary" onClick={onClose}>
          Cancel
        </Button>
        <Button loading={reopen.isPending} onClick={() => reopen.mutate()}>
          Reopen project
        </Button>
      </div>
    </div>
  )
}

/** Completed or Terminated → Active, after a confirm. */
export function ReopenProjectDialog({ open, onClose, project }: Props) {
  return (
    <Dialog open={open} onClose={onClose} title="Reopen project">
      <ReopenForm onClose={onClose} project={project} />
    </Dialog>
  )
}
