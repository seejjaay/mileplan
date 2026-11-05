import type { ProjectSummary } from '../../api/projects'

// Placeholder: filled in by Task 4.
export default function OverviewTab({ project }: { project: ProjectSummary }) {
  return <h2 className="text-lg font-semibold">Overview of {project.title}</h2>
}
