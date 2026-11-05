import { useState, type FormEvent } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { splitMilestone, type Milestone } from '../../../api/milestones'
import { invalidateProject } from '../../../api/invalidate'
import type { ProjectStatus } from '../../../api/projects'
import { toUserMessage } from '../../../lib/errors'
import { formatMoney } from '../../../lib/format'
import { Button } from '../../../ui/Button'
import { Dialog } from '../../../ui/Dialog'
import { Field } from '../../../ui/Field'
import { useToast } from '../../../ui/Toast'
import { ReasonField } from './ReasonField'

const inputClass = 'min-h-11 w-full rounded-md border border-[var(--border)] bg-[var(--surface)] px-3'

type Props = { milestone: Milestone; projectStatus: ProjectStatus; currency: string; open: boolean; onClose: () => void }

/** Split: the new milestone goes right after this one, takes the chosen tasks and an amount; this one keeps the remainder. */
export function SplitDialog({ milestone, projectStatus, currency, open, onClose }: Props) {
  const toast = useToast()
  const queryClient = useQueryClient()
  const [taskIds, setTaskIds] = useState<string[]>([])
  const [title, setTitle] = useState(`${milestone.title} (part 2)`)
  const [amount, setAmount] = useState('')
  const [reason, setReason] = useState('')
  const active = projectStatus === 'active'

  const max = Number(milestone.amount)
  const value = amount === '' ? 0 : Number(amount)
  const amountBad = !Number.isFinite(value) || value < 0 || value > max
  const limitText = `Can’t be more than ${formatMoney(max, currency)}`

  const split = useMutation({
    mutationFn: () => splitMilestone(milestone.id, taskIds, title.trim(), value, active ? reason.trim() || undefined : undefined),
    onSuccess: () => {
      toast.success('Milestone split')
      onClose()
      return invalidateProject(queryClient, milestone.project_id)
    },
    onError: (err) => toast.error(toUserMessage(err)),
  })

  function submit(e: FormEvent) {
    e.preventDefault()
    if (title.trim() && !amountBad) split.mutate()
  }

  return (
    <Dialog open={open} onClose={onClose} title={`Split “${milestone.title}”`}>
      <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
        {milestone.tasks.length > 0 && (
          <fieldset className="flex flex-col gap-1">
            <legend className="mb-1 text-sm font-medium">Tasks that move to the new milestone</legend>
            {milestone.tasks.map((t) => (
              <label key={t.id} className="flex min-h-11 items-center gap-2">
                <input
                  type="checkbox"
                  className="size-5"
                  checked={taskIds.includes(t.id)}
                  onChange={(e) => setTaskIds((ids) => (e.target.checked ? [...ids, t.id] : ids.filter((x) => x !== t.id)))}
                />
                {t.title}
              </label>
            ))}
          </fieldset>
        )}
        <Field label="Title of the new milestone">
          <input value={title} onChange={(e) => setTitle(e.target.value)} className={inputClass} />
        </Field>
        <Field label="Amount for the new milestone" error={amountBad ? limitText : null}>
          <input type="number" min="0" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} className={inputClass} />
        </Field>
        {!amountBad && <p className="text-sm text-[var(--muted)]">Stays on “{milestone.title}”: {formatMoney(max - value, currency)}</p>}
        {active && <ReasonField value={reason} onChange={setReason} />}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" loading={split.isPending} disabled={!title.trim() || amountBad}>
            Split
          </Button>
        </div>
      </form>
    </Dialog>
  )
}
