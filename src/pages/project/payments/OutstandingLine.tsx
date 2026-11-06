import type { ProjectSummary } from '../../../api/projects'
import { formatMoney } from '../../../lib/format'

/** "Outstanding ₱X · N overdue" for a project card. Nothing when no payments are scheduled. */
export function OutstandingLine({ project }: { project: Pick<ProjectSummary, 'scheduled' | 'outstanding' | 'overdue' | 'currency'> }) {
  if (project.scheduled <= 0) return null
  return (
    <span className="text-sm">
      {`Outstanding ${formatMoney(project.outstanding, project.currency)}`}
      {project.overdue > 0 && <span className="font-medium">{` · ${project.overdue} overdue`}</span>}
    </span>
  )
}
