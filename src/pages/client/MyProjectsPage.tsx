import { Link, Navigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { listProjects } from '../../api/projects'
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

export default function MyProjectsPage() {
  useTitle('My projects')
  const unread = useUnreadCounts()
  const query = useQuery({ queryKey: qk.projects(), queryFn: listProjects })
  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-2xl font-semibold">My projects</h1>
      <AsyncView
        query={query}
        onRetry={() => void query.refetch()}
        empty={<p className="text-[var(--muted)]">No projects yet — CJ will add you once your project starts.</p>}
      >
        {(projects) =>
          projects.length === 1 ? (
            <Navigate to={`/projects/${projects[0].id}`} replace />
          ) : (
            <ul className="grid gap-3 sm:grid-cols-2">
              {projects.map((p) => (
                <li key={p.id}>
                  <Link to={`/projects/${p.id}`} className="flex h-full flex-col gap-3 rounded-md border border-[var(--border)] bg-[var(--surface)] p-4">
                    <span className="flex items-start justify-between gap-3">
                      <span className="font-medium">{p.title}</span>
                      <span className="flex items-center gap-2">
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
          )
        }
      </AsyncView>
    </div>
  )
}
