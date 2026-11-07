/** The only place query keys are built, so Phase 2b's realtime can invalidate through the same functions. */
export const qk = {
  projects: () => ['projects'] as const,
  project: (id: string) => ['project', id] as const,
  milestones: (projectId: string) => ['milestones', projectId] as const,
  updates: (projectId: string) => ['updates', projectId] as const,
  documents: (projectId: string) => ['documents', projectId] as const,
  activity: (projectId: string) => ['activity', projectId] as const,
  planChanges: (projectId: string) => ['planChanges', projectId] as const,
  reviews: (projectId: string) => ['reviews', projectId] as const,
  payments: (projectId: string) => ['payments', projectId] as const,
  messages: (projectId: string) => ['messages', projectId] as const,
  unread: () => ['unread'] as const,
  lastVisit: (projectId: string) => ['lastVisit', projectId] as const,
  // starts with the activity key, so a live activity event refreshes it too
  changesSince: (projectId: string, since: string | null) => ['activity', projectId, 'since', since] as const,
}
