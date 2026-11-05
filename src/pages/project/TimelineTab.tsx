import type { ProjectSummary } from '../../api/projects'

// Placeholder: filled in by Task 9.
export default function TimelineTab({ project }: { project: ProjectSummary }) {
  return <h2 className="text-lg font-semibold">Timeline for {project.title}</h2>
}
