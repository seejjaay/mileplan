import type { ProjectSummary } from '../../api/projects'

// Placeholder: filled in by Task 8.
export default function FilesTab({ project }: { project: ProjectSummary }) {
  return <h2 className="text-lg font-semibold">Files for {project.title}</h2>
}
