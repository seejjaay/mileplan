import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { listMilestones, reorderMilestones, type Milestone } from '../../../api/milestones'
import { qk } from '../../../api/keys'
import type { ProjectSummary } from '../../../api/projects'
import { useAuth } from '../../../auth/AuthProvider'
import { formatDate, formatMoney } from '../../../lib/format'
import { AsyncView } from '../../../ui/AsyncView'
import { Button } from '../../../ui/Button'
import { StatusChip } from '../../../ui/StatusChip'
import { holdChip, milestoneChip } from '../milestoneStatus'
import { AddMilestoneDialog } from './AddMilestoneDialog'
import { toDraft } from './milestoneDraft'
import { MilestoneRow } from './MilestoneRow'
import { SortableList } from './SortableList'
import { TaskList } from './TaskList'
import { useReorder } from './useReorder'

function ReadOnlyMilestone({ milestone, currency }: { milestone: Milestone; currency: string }) {
  return (
    <li className="flex flex-col gap-2 rounded-md border border-[var(--border)] bg-[var(--surface)] p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-medium">{milestone.title}</h3>
        <span className="flex flex-wrap gap-2">
          <StatusChip {...milestoneChip[milestone.status]} />
          {milestone.on_hold && <StatusChip {...holdChip} />}
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
    </li>
  )
}

export default function MilestonesTab({ project }: { project: ProjectSummary }) {
  const { profile } = useAuth()
  const isAdmin = profile?.role === 'admin'
  const [adding, setAdding] = useState(false)
  const query = useQuery({ queryKey: qk.milestones(project.id), queryFn: () => listMilestones(project.id) })
  const reorder = useReorder<Milestone[]>(
    qk.milestones(project.id),
    (ids) => reorderMilestones(project.id, ids),
    (cache, ids) => ids.map((id) => cache.find((m) => m.id === id)!),
  )

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-lg font-semibold">Milestones</h2>
        {isAdmin && <Button onClick={() => setAdding(true)}>Add milestone</Button>}
      </div>

      <AsyncView
        query={query}
        onRetry={() => void query.refetch()}
        empty={<p className="text-[var(--muted)]">No milestones yet. Add the first one.</p>}
      >
        {(milestones) =>
          isAdmin ? (
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
                      key={`${m.id}:${JSON.stringify(toDraft(m))}`}
                      milestone={m}
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
                <ReadOnlyMilestone key={m.id} milestone={m} currency={project.currency} />
              ))}
            </ul>
          )
        }
      </AsyncView>

      {isAdmin && <AddMilestoneDialog projectId={project.id} projectStatus={project.status} open={adding} onClose={() => setAdding(false)} />}
    </div>
  )
}
