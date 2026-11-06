import type { ProjectSummary } from '../../api/projects'

/** True while the tracker can be edited: a project in setup or active. A completed or terminated one is read-only. */
export function useProjectOpen(project: Pick<ProjectSummary, 'status'>): boolean {
  return project.status === 'setup' || project.status === 'active'
}
