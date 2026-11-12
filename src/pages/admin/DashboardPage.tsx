import { Link, useSearchParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { listProjects, type ProjectStatus } from '../../api/projects'
import { qk } from '../../api/keys'
import { useUnreadCounts } from '../../api/useUnreadCounts'
import { formatDate } from '../../lib/format'
import { useTitle } from '../../lib/useTitle'
import { AsyncView } from '../../ui/AsyncView'
import { ProgressBar } from '../../ui/ProgressBar'
import { StatusChip } from '../../ui/StatusChip'
import { UnreadBadge } from '../../ui/UnreadBadge'
import { OutstandingLine } from '../project/payments/OutstandingLine'
import { projectChip } from '../project/projectStatus'

const FILTERS: { value: ProjectStatus | 'all'; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'setup', label: 'Setup' },
  { value: 'active', label: 'Active' },
  { value: 'completed', label: 'Completed' },
  { value: 'terminated', label: 'Terminated' },
]

export default function DashboardPage() {
  useTitle('Dashboard')
  const unread = useUnreadCounts()
  const [params, setParams] = useSearchParams()
  const filter = FILTERS.find((f) => f.value === params.get('status'))?.value ?? 'all'
  const query = useQuery({ queryKey: qk.projects(), queryFn: listProjects })
  const shown = query.data && filter !== 'all' ? query.data.filter((p) => p.status === filter) : query.data

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">Dashboard</h1>
        <Link to="/projects/new" className="inline-flex min-h-11 items-center rounded-md bg-[var(--accent)] px-4 text-sm font-medium text-[var(--accent-contrast)]">
          New project
        </Link>
      </div>

      <div role="group" aria-label="Filter by status" className="flex flex-wrap gap-2">
        {FILTERS.map((f) => (
          <button
            key={f.value}
            type="button"
            aria-pressed={f.value === filter}
            onClick={() => setParams(f.value === 'all' ? {} : { status: f.value })}
            className={`min-h-11 rounded-full border px-4 text-sm ${f.value === filter ? 'border-[var(--accent)] font-medium' : 'border-[var(--border)] text-[var(--muted)]'}`}
          >
            {f.label}
          </button>
        ))}
      </div>

      <AsyncView
        query={{ ...query, data: shown } as typeof query}
        onRetry={() => void query.refetch()}
        empty={<p className="text-[var(--muted)]">{filter === 'all' ? 'No projects yet.' : `No ${filter} projects.`}</p>}
      >
        {(projects) => (
          <ul className="grid gap-3 sm:grid-cols-2">
            {projects.map((p) => (
              <li key={p.id}>
                <Link to={`/projects/${p.id}`} className="flex h-full flex-col gap-3 rounded-md border border-[var(--border)] bg-[var(--surface)] p-4">
                  <span className="flex items-start justify-between gap-3">
                    <span className="min-w-0 font-medium">{p.title}</span>
                    <span className="flex shrink-0 items-center gap-2">
                      <UnreadBadge count={unread[p.id] ?? 0} />
                      <StatusChip {...projectChip[p.status]} />
                    </span>
                  </span>
                  <ProgressBar value={p.percent} label={`${p.title} progress`} />
                  <span className="text-sm text-[var(--muted)]">
                    {p.percent}% complete
                    {p.nextDue ? ` · Next: ${p.nextDue.title}, ${formatDate(p.nextDue.due_date)}` : ''}
                  </span>
                  <OutstandingLine project={p} />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </AsyncView>
    </div>
  )
}
