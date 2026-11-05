import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { invalidateProject } from '../../../api/invalidate'
import { qk } from '../../../api/keys'
import type { Milestone } from '../../../api/milestones'
import { submitReview, type ReviewDecision } from '../../../api/reviews'
import { useAuth } from '../../../auth/AuthProvider'
import { toUserMessage } from '../../../lib/errors'
import { Button } from '../../../ui/Button'
import { Dialog } from '../../../ui/Dialog'
import { Field } from '../../../ui/Field'
import { useToast } from '../../../ui/Toast'

const ALREADY_REVIEWED = 'This milestone was already reviewed.'

/** A client's Approve / Request changes on a milestone that is in review. Nothing renders for anyone else. */
export function ReviewActions({ milestone }: { milestone: Milestone }) {
  const { profile } = useAuth()
  const toast = useToast()
  const queryClient = useQueryClient()
  const [mode, setMode] = useState<'approve' | 'changes' | null>(null)
  const [comment, setComment] = useState('')

  const refresh = () =>
    Promise.all([invalidateProject(queryClient, milestone.project_id), queryClient.invalidateQueries({ queryKey: qk.reviews(milestone.project_id) })])
  const close = () => {
    setMode(null)
    setComment('')
  }

  const review = useMutation({
    mutationFn: (v: { decision: ReviewDecision; comment?: string }) => submitReview(milestone.id, profile!.id, v.decision, v.comment),
    onSuccess: (_data, v) => {
      toast.success(v.decision === 'approved' ? 'Milestone approved' : 'Changes requested')
      close()
      return refresh()
    },
    onError: (err) => {
      if ((err as { code?: string } | null)?.code === '42501') {
        // Someone else reviewed it first (or CJ moved it): say so plainly instead of "no access", and refetch.
        toast.error(ALREADY_REVIEWED)
        close()
        return refresh()
      }
      toast.error(toUserMessage(err))
    },
  })

  if (profile?.role !== 'client' || milestone.status !== 'in_review') return null

  return (
    <div className="flex flex-wrap gap-2">
      <Button onClick={() => setMode('approve')}>Approve</Button>
      <Button variant="secondary" onClick={() => setMode('changes')}>
        Request changes
      </Button>

      <Dialog open={mode === 'approve'} onClose={close} title={`Approve “${milestone.title}”?`}>
        <div className="flex flex-col gap-4">
          <p>This tells CJ the deliverable is accepted.</p>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={close}>
              Cancel
            </Button>
            <Button loading={review.isPending} onClick={() => review.mutate({ decision: 'approved' })}>
              Approve milestone
            </Button>
          </div>
        </div>
      </Dialog>

      <Dialog open={mode === 'changes'} onClose={close} title={`Request changes to “${milestone.title}”`}>
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault()
            if (comment.trim()) review.mutate({ decision: 'changes_requested', comment: comment.trim() })
          }}
        >
          <Field label="What needs to change?">
            <textarea
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              rows={4}
              className="min-h-11 w-full rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-2"
            />
          </Field>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={close}>
              Cancel
            </Button>
            <Button type="submit" loading={review.isPending} disabled={!comment.trim()}>
              Send request
            </Button>
          </div>
        </form>
      </Dialog>
    </div>
  )
}
