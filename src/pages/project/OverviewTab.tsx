import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { listMilestones, totalAmount } from '../../api/milestones'
import { listPlanChanges } from '../../api/planChanges'
import { qk } from '../../api/keys'
import type { ProjectSummary } from '../../api/projects'
import { useAuth } from '../../auth/AuthProvider'
import { formatMoney } from '../../lib/format'
import { describeActivity } from '../../lib/formatChange'
import { AsyncView } from '../../ui/AsyncView'
import { Button } from '../../ui/Button'
import { ProgressBar } from '../../ui/ProgressBar'
import { ActivateDialog } from './ActivateDialog'
import { RouteLine } from './RouteLine'
import { useChangeMarkers } from './changeMarkers'
import { useEntityNames } from './useEntityNames'

export default function OverviewTab({ project }: { project: ProjectSummary }) {
  const { profile } = useAuth()
  const isAdmin = profile?.role === 'admin'
  const [activating, setActivating] = useState(false)
  const query = useQuery({ queryKey: qk.milestones(project.id), queryFn: () => listMilestones(project.id) })
  const planChanges = useQuery({ queryKey: qk.planChanges(project.id), queryFn: () => listPlanChanges(project.id), enabled: isAdmin })
  const names = useEntityNames(project.id)
  const { tick } = useChangeMarkers()
  const waiting = (planChanges.data ?? []).filter((c) => c.acks.length === 0)

  return (
    <div className="flex flex-col gap-6">
      {project.summary && <p className="max-w-prose">{project.summary}</p>}

      {isAdmin && project.status === 'setup' && (
        <div className="flex flex-col items-start gap-2 rounded-md border border-[var(--border)] bg-[var(--surface)] p-4">
          <p className="text-sm text-[var(--muted)]">The client can't see this project yet. Add them and activate it when the plan is ready.</p>
          <Button onClick={() => setActivating(true)}>Add client & activate</Button>
        </div>
      )}

      <section aria-label="Totals" className="grid gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-2 rounded-md border border-[var(--border)] bg-[var(--surface)] p-4">
          <span className="text-sm text-[var(--muted)]">Progress</span>
          <ProgressBar value={project.percent} label="Overall progress" />
          <span className="font-medium">{project.percent}% complete</span>
        </div>
        <div className="flex flex-col gap-1 rounded-md border border-[var(--border)] bg-[var(--surface)] p-4">
          <span className="text-sm text-[var(--muted)]">Contract value</span>
          <span className="text-xl font-semibold">{query.data ? formatMoney(totalAmount(query.data), project.currency) : '—'}</span>
        </div>
      </section>

      {isAdmin && waiting.length > 0 && (
        <section aria-label="Pending acknowledgements" className="flex flex-col gap-2 rounded-md border border-[var(--warn)] bg-[var(--surface)] p-4">
          <h2 className="text-lg font-semibold">Pending acknowledgements</h2>
          <p className="text-sm text-[var(--muted)]">Plan changes no client has acknowledged yet.</p>
          <ul className="flex flex-col gap-1">
            {waiting.map((c) => (
              <li key={c.id}>{describeActivity(c, { currency: project.currency, subjectName: names.get(c.entity_id) })}</li>
            ))}
          </ul>
        </section>
      )}

      <section aria-label="Milestones" className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">Milestones</h2>
        <AsyncView
          query={query}
          onRetry={() => void query.refetch()}
          empty={
            <div className="flex flex-col items-start gap-2">
              <p className="text-[var(--muted)]">No milestones yet. Add the first one.</p>
              {isAdmin && (
                <Link to={`/projects/${project.id}/milestones`} className="underline">
                  Go to Milestones
                </Link>
              )}
            </div>
          }
        >
          {(milestones) => <RouteLine milestones={milestones} tick={tick} />}
        </AsyncView>
      </section>

      {isAdmin && <ActivateDialog projectId={project.id} open={activating} onClose={() => setActivating(false)} />}
    </div>
  )
}
