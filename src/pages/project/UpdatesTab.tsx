import type { ProjectSummary } from '../../api/projects'

// Placeholder: filled in by Task 7.
export default function UpdatesTab({ project }: { project: ProjectSummary }) {
  return <h2 className="text-lg font-semibold">Updates for {project.title}</h2>
}
