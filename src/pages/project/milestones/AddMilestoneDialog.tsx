import { useState, type FormEvent } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { addMilestone } from '../../../api/milestones'
import { invalidateProject } from '../../../api/invalidate'
import type { ProjectStatus } from '../../../api/projects'
import { toUserMessage } from '../../../lib/errors'
import { Button } from '../../../ui/Button'
import { Dialog } from '../../../ui/Dialog'
import { Field } from '../../../ui/Field'
import { useToast } from '../../../ui/Toast'
import { ReasonField } from './ReasonField'

const inputClass = 'min-h-11 w-full rounded-md border border-[var(--border)] bg-[var(--surface)] px-3'

type Props = { projectId: string; projectStatus: ProjectStatus; open: boolean; onClose: () => void }

export function AddMilestoneDialog({ projectId, projectStatus, open, onClose }: Props) {
  const toast = useToast()
  const queryClient = useQueryClient()
  const [title, setTitle] = useState('')
  const [dueDate, setDueDate] = useState('')
  const [amount, setAmount] = useState('')
  const [reason, setReason] = useState('')
  const active = projectStatus === 'active'
  const amountBad = amount !== '' && !(Number(amount) >= 0)

  const add = useMutation({
    mutationFn: () =>
      addMilestone(
        projectId,
        { title: title.trim(), ...(dueDate ? { due_date: dueDate } : {}), ...(amount !== '' ? { amount: Number(amount) } : {}) },
        active ? reason.trim() || undefined : undefined,
      ),
    onSuccess: () => {
      toast.success('Milestone added')
      onClose()
      return invalidateProject(queryClient, projectId)
    },
    onError: (err) => toast.error(toUserMessage(err)),
  })

  function submit(e: FormEvent) {
    e.preventDefault()
    if (title.trim() && !amountBad) add.mutate()
  }

  return (
    <Dialog open={open} onClose={onClose} title="Add milestone">
      <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
        <Field label="Title">
          <input value={title} onChange={(e) => setTitle(e.target.value)} className={inputClass} />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Due date">
            <input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} className={inputClass} />
          </Field>
          <Field label="Amount" error={amountBad ? 'Enter an amount of 0 or more' : null}>
            <input type="number" min="0" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} className={inputClass} />
          </Field>
        </div>
        {active && <ReasonField value={reason} onChange={setReason} />}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" loading={add.isPending} disabled={!title.trim() || amountBad}>
            Add
          </Button>
        </div>
      </form>
    </Dialog>
  )
}
