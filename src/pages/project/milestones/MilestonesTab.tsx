import type { ProjectSummary } from '../../../api/projects'

// Placeholder: filled in by Task 5.
export default function MilestonesTab({ project }: { project: ProjectSummary }) {
  return <h2 className="text-lg font-semibold">Milestones for {project.title}</h2>
}
