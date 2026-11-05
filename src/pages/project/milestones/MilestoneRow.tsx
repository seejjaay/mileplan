import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { deleteMilestone, mergeMilestones, updateMilestone, type Milestone, type MilestonePatch, type MilestoneStatus } from '../../../api/milestones'
import { invalidateProject } from '../../../api/invalidate'
import type { ProjectStatus } from '../../../api/projects'
import { describeReview, type Review } from '../../../api/reviews'
import { toUserMessage } from '../../../lib/errors'
import { Button } from '../../../ui/Button'
import { Dialog } from '../../../ui/Dialog'
import { Field } from '../../../ui/Field'
import { useToast } from '../../../ui/Toast'
import { milestoneChip } from '../milestoneStatus'
import { amountValid, diffDraft, editedFields, toDraft, touchesPlan, type Draft } from './milestoneDraft'
import { ReasonField } from './ReasonField'
import { SplitDialog } from './SplitDialog'
import { TaskList } from './TaskList'

const inputClass = 'min-h-11 w-full rounded-md border border-[var(--border)] bg-[var(--surface)] px-3'
const STATUSES = Object.keys(milestoneChip) as MilestoneStatus[]

type Props = { milestone: Milestone; next?: Milestone; review?: Review; projectStatus: ProjectStatus; currency: string }

/** One editable milestone. Remount (via key) when the saved data changes so the draft resets. */
export function MilestoneRow({ milestone, next, review, projectStatus, currency }: Props) {
  const toast = useToast()
  const queryClient = useQueryClient()
  const saved = toDraft(milestone)
  const savedKey = JSON.stringify(saved)
  // `base` = the saved values the draft started from. If the milestone changes underneath (live sync),
  // a clean row follows silently; a row being edited keeps its edits and offers "Load latest".
  const [base, setBase] = useState<Draft>(saved)
  const [draft, setDraft] = useState<Draft>(saved)
  const [reason, setReason] = useState('')
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const [deleteReason, setDeleteReason] = useState('')
  const [splitting, setSplitting] = useState(false)
  const [confirmingMerge, setConfirmingMerge] = useState(false)
  const [mergeReason, setMergeReason] = useState('')

  const edited = editedFields(base, draft)
  const patch = diffDraft(milestone, draft, edited) // only what was edited here, never untouched fields
  const dirty = Object.keys(patch).length > 0
  const active = projectStatus === 'active'
  const showReason = active && touchesPlan(patch)
  const canSave = dirty && amountValid(draft) && !!draft.title.trim()

  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => setDraft((d) => ({ ...d, [key]: value }))

  const save = useMutation({
    // The payload travels as the variables: onMutate re-renders the row (patch becomes empty) before the request is sent.
    mutationFn: (vars: { patch: MilestonePatch; reason?: string }) => updateMilestone(milestone.id, vars.patch, vars.reason),
    onSuccess: () => {
      toast.success('Milestone saved')
      return invalidateProject(queryClient, milestone.project_id)
    },
    onError: (err) => toast.error(toUserMessage(err)),
  })

  function saveNow() {
    const previousBase = base
    setBase(draft) // what is being saved is no longer an unsaved edit...
    save.mutate(
      { patch, reason: showReason ? reason.trim() || undefined : undefined },
      { onError: () => setBase(previousBase) }, // ...unless the save fails
    )
  }

  const changedUnderneath = JSON.stringify(base) !== savedKey
  if (!save.isPending && changedUnderneath && edited.length === 0) {
    setBase(saved)
    setDraft(saved)
    setReason('')
  }
  const stale = !save.isPending && changedUnderneath && edited.length > 0

  const remove = useMutation({
    mutationFn: () => deleteMilestone(milestone.id, active ? deleteReason.trim() || undefined : undefined),
    onSuccess: () => {
      toast.success('Milestone deleted')
      setConfirmingDelete(false)
      return invalidateProject(queryClient, milestone.project_id)
    },
    onError: (err) => toast.error(toUserMessage(err)),
  })

  const merge = useMutation({
    mutationFn: () => mergeMilestones(milestone.id, next!.id, active ? mergeReason.trim() || undefined : undefined),
    onSuccess: () => {
      toast.success('Milestones merged')
      setConfirmingMerge(false)
      return invalidateProject(queryClient, milestone.project_id)
    },
    onError: (err) => toast.error(toUserMessage(err)),
  })

  return (
    <fieldset className="flex flex-col gap-4 rounded-md border border-[var(--border)] bg-[var(--surface)] p-4">
      <legend className="px-1 font-medium">{milestone.title}</legend>

      {review && <p className="text-sm text-[var(--muted)]">{describeReview(review)}</p>}

      {stale && (
        <div role="status" className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-[var(--warn)] p-3 text-sm">
          <span>Changed elsewhere. Your edits are kept, and saving sends only the fields you edited.</span>
          <Button
            variant="secondary"
            onClick={() => {
              setBase(saved)
              setDraft(saved)
              setReason('')
            }}
          >
            Load latest
          </Button>
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Title">
          <input value={draft.title} onChange={(e) => set('title', e.target.value)} className={inputClass} />
        </Field>
        <Field label="Status">
          <select value={draft.status} onChange={(e) => set('status', e.target.value as MilestoneStatus)} className={inputClass}>
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {milestoneChip[s].label}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Due date">
          <input type="date" value={draft.due_date} onChange={(e) => set('due_date', e.target.value)} className={inputClass} />
        </Field>
        <Field label="Amount" error={amountValid(draft) ? null : 'Enter an amount of 0 or more'}>
          <input type="number" min="0" step="0.01" value={draft.amount} onChange={(e) => set('amount', e.target.value)} className={inputClass} />
        </Field>
      </div>

      <Field label="Description">
        <textarea value={draft.description} onChange={(e) => set('description', e.target.value)} rows={2} className={`${inputClass} py-2`} />
      </Field>
      <Field label="Acceptance criteria (one per line)">
        <textarea value={draft.criteria} onChange={(e) => set('criteria', e.target.value)} rows={3} className={`${inputClass} py-2`} />
      </Field>

      <label className="flex min-h-11 items-center gap-2">
        <input type="checkbox" checked={draft.on_hold} onChange={(e) => set('on_hold', e.target.checked)} className="size-5" />
        On hold
      </label>

      <TaskList milestone={milestone} canEdit />

      {showReason && <ReasonField value={reason} onChange={setReason} />}

      <div className="flex flex-wrap justify-between gap-2">
        <div className="flex flex-wrap gap-2">
          <Button variant="danger" onClick={() => setConfirmingDelete(true)}>
            Delete milestone
          </Button>
          <Button variant="secondary" disabled={dirty} title={dirty ? 'Save or undo your edits first' : undefined} onClick={() => setSplitting(true)}>
            Split milestone
          </Button>
          {next && (
            <Button variant="secondary" disabled={dirty} title={dirty ? 'Save or undo your edits first' : undefined} onClick={() => setConfirmingMerge(true)}>
              Merge with next
            </Button>
          )}
        </div>
        <Button
          loading={save.isPending}
          disabled={!canSave}
          onClick={saveNow}
        >
          Save changes
        </Button>
      </div>

      <SplitDialog milestone={milestone} projectStatus={projectStatus} currency={currency} open={splitting} onClose={() => setSplitting(false)} />

      {next && (
        <Dialog open={confirmingMerge} onClose={() => setConfirmingMerge(false)} title="Merge milestones?">
          <div className="flex flex-col gap-4">
            <p>
              “{next.title}” will be folded into “{milestone.title}”: amounts are added, tasks are combined and “{next.title}” is removed.
              {active ? ' The client will see this as a plan change.' : ''}
            </p>
            {active && <ReasonField value={mergeReason} onChange={setMergeReason} />}
            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setConfirmingMerge(false)}>
                Cancel
              </Button>
              <Button loading={merge.isPending} onClick={() => merge.mutate()}>
                Confirm merge
              </Button>
            </div>
          </div>
        </Dialog>
      )}

      <Dialog open={confirmingDelete} onClose={() => setConfirmingDelete(false)} title="Delete milestone?">
        <div className="flex flex-col gap-4">
          <p>
            “{milestone.title}” and its tasks will be removed.{active ? ' The client will see this as a plan change.' : ''}
          </p>
          {active && <ReasonField value={deleteReason} onChange={setDeleteReason} />}
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setConfirmingDelete(false)}>
              Cancel
            </Button>
            <Button variant="danger" loading={remove.isPending} onClick={() => remove.mutate()}>
              Confirm delete
            </Button>
          </div>
        </div>
      </Dialog>
    </fieldset>
  )
}
