import type { QueryClient } from '@tanstack/react-query'
import { qk } from './keys'

/** After any tracker write: milestones, the project's % complete, dashboard cards and the timeline all may have changed. */
export function invalidateProject(queryClient: QueryClient, projectId: string): Promise<unknown> {
  return Promise.all([
    queryClient.invalidateQueries({ queryKey: qk.milestones(projectId) }),
    queryClient.invalidateQueries({ queryKey: qk.project(projectId) }),
    queryClient.invalidateQueries({ queryKey: qk.projects() }),
    queryClient.invalidateQueries({ queryKey: qk.activity(projectId) }),
  ])
}
