import type { ProjectSummary } from '../../api/projects'
import { formatDate } from '../../lib/format'
import { useProjectOpen } from './useProjectOpen'

/** Shown on every tab of a closed project, to everyone who can see it. Nothing while the project is open. */
export function ClosedBanner({ project }: { project: ProjectSummary }) {
  if (useProjectOpen(project)) return null
  const when = project.closed_at ? ` on ${formatDate(project.closed_at)}` : ''
  return (
    <p role="note" className="rounded-md border border-[var(--border)] bg-[var(--surface)] p-3 text-sm">
      {`This project was ${project.status}${when} and is read-only.`}
    </p>
  )
}
