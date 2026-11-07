import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { listMilestones, reorderMilestones, type Milestone } from '../../../api/milestones'
import { listPaymentRequests, type PaymentRequest } from '../../../api/payments'
import { describeReview, latestReview, listReviews, type Review } from '../../../api/reviews'
import { qk } from '../../../api/keys'
import type { ProjectSummary } from '../../../api/projects'
import { useAuth } from '../../../auth/AuthProvider'
import { formatDate, formatMoney } from '../../../lib/format'
import { AsyncView } from '../../../ui/AsyncView'
import { Button } from '../../../ui/Button'
import { StatusChip } from '../../../ui/StatusChip'
import { holdChip, milestoneChip } from '../milestoneStatus'
import { AddMilestoneDialog } from './AddMilestoneDialog'
import { ImportPlanDialog } from './ImportPlanDialog'
import { useChangeMarkers } from '../changeMarkers'
import { useProjectOpen } from '../useProjectOpen'
import { MilestonePayments } from './MilestonePayments'
import { MilestoneRow } from './MilestoneRow'
import { ReviewActions } from './ReviewActions'
import { SortableList } from './SortableList'
import { TaskList } from './TaskList'
import { useReorder } from './useReorder'

function ReadOnlyMilestone({
  milestone,
  currency,
  review,
  payments,
  canReview,
}: {
  milestone: Milestone
  currency: string
  review?: Review
  payments: PaymentRequest[]
  canReview: boolean
}) {
  const changed = useChangeMarkers().milestones.has(milestone.id)
  return (
    <li className="flex flex-col gap-2 rounded-md border border-[var(--border)] bg-[var(--surface)] p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-medium">{milestone.title}</h3>
        <span className="flex flex-wrap gap-2">
          <StatusChip {...milestoneChip[milestone.status]} />
          {milestone.on_hold && <StatusChip {...holdChip} />}
          {changed && <StatusChip status="attention" label="Updated" />}
        </span>
      </div>
      <p className="text-sm text-[var(--muted)]">
        {milestone.due_date ? `Due ${formatDate(milestone.due_date)} · ` : ''}
        {formatMoney(milestone.amount, currency)}
      </p>
      {milestone.description && <p>{milestone.description}</p>}
      {milestone.acceptance_criteria.length > 0 && (
        <ul className="list-disc pl-5 text-sm">
          {milestone.acceptance_criteria.map((c) => (
            <li key={c}>{c}</li>
          ))}
        </ul>
      )}
      <TaskList milestone={milestone} canEdit={false} />
      <MilestonePayments requests={payments} currency={currency} />
      {review && <p className="text-sm text-[var(--muted)]">{describeReview(review)}</p>}
      {canReview && <ReviewActions milestone={milestone} />}
    </li>
  )
}

export default function MilestonesTab({ project }: { project: ProjectSummary }) {
  const { profile } = useAuth()
  const isAdmin = profile?.role === 'admin'
  const open = useProjectOpen(project)
  const canEdit = isAdmin && open // a closed project is read-only for the admin too
  const [adding, setAdding] = useState(false)
  const [importing, setImporting] = useState(false)
  const query = useQuery({ queryKey: qk.milestones(project.id), queryFn: () => listMilestones(project.id) })
  const reviews = useQuery({ queryKey: qk.reviews(project.id), queryFn: () => listReviews(project.id) })
  const reviewOf = (milestoneId: string) => latestReview(reviews.data ?? [], milestoneId)
  const payments = useQuery({ queryKey: qk.payments(project.id), queryFn: () => listPaymentRequests(project.id) })
  const paymentsOf = (milestoneId: string) => (payments.data ?? []).filter((r) => r.milestone_id === milestoneId)
  const reorder = useReorder<Milestone[]>(
    qk.milestones(project.id),
    (ids) => reorderMilestones(project.id, ids),
    (cache, ids) => ids.map((id) => cache.find((m) => m.id === id)!),
  )

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-lg font-semibold">Milestones</h2>
        {canEdit && (
          <div className="flex flex-wrap justify-end gap-2">
            <Button variant="secondary" onClick={() => setImporting(true)}>
              Import plan
            </Button>
            <Button onClick={() => setAdding(true)}>Add milestone</Button>
          </div>
        )}
      </div>

      <AsyncView
        query={query}
        onRetry={() => void query.refetch()}
        empty={
          <p className="text-[var(--muted)]">
            {canEdit ? 'No milestones yet. Add the first one, or import a plan.' : 'No milestones yet. Add the first one.'}
          </p>
        }
      >
        {(milestones) =>
          canEdit ? (
            <SortableList
              items={milestones}
              label="Milestones"
              onReorder={(ids) => reorder.mutate(ids)}
              handleLabel={(m) => `Reorder ${m.title}`}
              renderItem={(m, handle) => (
                <div className="flex items-start gap-2">
                  {handle}
                  <div className="min-w-0 flex-1">
                    <MilestoneRow
                      milestone={m}
                      review={reviewOf(m.id)}
                      payments={paymentsOf(m.id)}
                      next={milestones[milestones.findIndex((x) => x.id === m.id) + 1]}
                      projectStatus={project.status}
                      currency={project.currency}
                    />
                  </div>
                </div>
              )}
            />
          ) : (
            <ul className="flex flex-col gap-3">
              {milestones.map((m) => (
                <ReadOnlyMilestone key={m.id} milestone={m} currency={project.currency} review={reviewOf(m.id)} payments={paymentsOf(m.id)} canReview={open} />
              ))}
            </ul>
          )
        }
      </AsyncView>

      {canEdit && <AddMilestoneDialog projectId={project.id} projectStatus={project.status} open={adding} onClose={() => setAdding(false)} />}
      {canEdit && importing && (
        <ImportPlanDialog
          projectId={project.id}
          projectStatus={project.status}
          currency={project.currency}
          emptyProject={query.data?.length === 0 && payments.data?.length === 0}
          onClose={() => setImporting(false)}
        />
      )}
    </div>
  )
}
