import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { listMilestones, totalAmount } from '../../api/milestones'
import { listPaymentRequests } from '../../api/payments'
import { listPlanChanges } from '../../api/planChanges'
import { qk } from '../../api/keys'
import type { ProjectSummary } from '../../api/projects'
import { useAuth } from '../../auth/AuthProvider'
import { formatDate, formatMoney } from '../../lib/format'
import { describeActivity } from '../../lib/formatChange'
import { paymentTotals, requestState, todayISO } from '../../lib/paymentState'
import { AsyncView } from '../../ui/AsyncView'
import { Button } from '../../ui/Button'
import { ProgressBar } from '../../ui/ProgressBar'
import { ActivateDialog } from './ActivateDialog'
import { CloseProjectDialog, ReopenProjectDialog } from './CloseProjectDialog'
import { RouteLine } from './RouteLine'
import { useChangeMarkers } from './changeMarkers'
import { useEntityNames } from './useEntityNames'

export default function OverviewTab({ project }: { project: ProjectSummary }) {
  const { profile } = useAuth()
  const isAdmin = profile?.role === 'admin'
  const [activating, setActivating] = useState(false)
  const [closing, setClosing] = useState<'close' | 'reopen' | null>(null)
  const query = useQuery({ queryKey: qk.milestones(project.id), queryFn: () => listMilestones(project.id) })
  const planChanges = useQuery({ queryKey: qk.planChanges(project.id), queryFn: () => listPlanChanges(project.id), enabled: isAdmin })
  const payments = useQuery({ queryKey: qk.payments(project.id), queryFn: () => listPaymentRequests(project.id) })
  const names = useEntityNames(project.id)
  const { tick } = useChangeMarkers()
  const waiting = (planChanges.data ?? []).filter((c) => c.acks.length === 0)
  const today = todayISO()
  const totals = payments.data ? paymentTotals(payments.data, today) : null
  // The schedule arrives ordered by due date, so the first request that is not fully paid is the next one.
  const next = payments.data?.map((r) => ({ r, s: requestState(r, today) })).find((x) => x.s.state !== 'paid')

  return (
    <div className="flex flex-col gap-6">
      {project.summary && <p className="max-w-prose">{project.summary}</p>}

      {isAdmin && project.status === 'setup' && (
        <div className="flex flex-col items-start gap-2 rounded-md border border-[var(--border)] bg-[var(--surface)] p-4">
          <p className="text-sm text-[var(--muted)]">The client can't see this project yet. Add them and activate it when the plan is ready.</p>
          <Button onClick={() => setActivating(true)}>Add client & activate</Button>
        </div>
      )}

      {isAdmin && project.status === 'active' && (
        <div>
          <Button variant="secondary" onClick={() => setClosing('close')}>
            Close project
          </Button>
        </div>
      )}
      {isAdmin && (project.status === 'completed' || project.status === 'terminated') && (
        <div>
          <Button variant="secondary" onClick={() => setClosing('reopen')}>
            Reopen project
          </Button>
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
        <div className="flex flex-col gap-1 rounded-md border border-[var(--border)] bg-[var(--surface)] p-4">
          <span className="text-sm text-[var(--muted)]">Paid</span>
          <span className="text-xl font-semibold">{totals ? formatMoney(totals.paid, project.currency) : '—'}</span>
        </div>
        <div className="flex flex-col gap-1 rounded-md border border-[var(--border)] bg-[var(--surface)] p-4">
          <span className="text-sm text-[var(--muted)]">Outstanding</span>
          <span className="text-xl font-semibold">{totals ? formatMoney(totals.outstanding, project.currency) : '—'}</span>
          {totals && totals.overdue > 0 && <span className="text-sm font-medium">{`${totals.overdue} overdue`}</span>}
        </div>
      </section>

      {next && (
        <p className="text-sm">{`Next payment: ${next.r.title} · ${formatMoney(next.s.remaining, project.currency)} · ${next.s.state === 'overdue' ? 'Overdue' : `due ${formatDate(next.r.due_date)}`}`}</p>
      )}

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
      {isAdmin && <CloseProjectDialog open={closing === 'close'} onClose={() => setClosing(null)} project={project} />}
      {isAdmin && <ReopenProjectDialog open={closing === 'reopen'} onClose={() => setClosing(null)} project={project} />}
    </div>
  )
}
