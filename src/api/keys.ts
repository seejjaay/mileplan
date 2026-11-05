/** The only place query keys are built, so Phase 2b's realtime can invalidate through the same functions. */
export const qk = {
  projects: () => ['projects'] as const,
  project: (id: string) => ['project', id] as const,
  milestones: (projectId: string) => ['milestones', projectId] as const,
  updates: (projectId: string) => ['updates', projectId] as const,
  documents: (projectId: string) => ['documents', projectId] as const,
  activity: (projectId: string) => ['activity', projectId] as const,
}
