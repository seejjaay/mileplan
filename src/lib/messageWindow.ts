const POST_CLOSE_MS = 30 * 24 * 60 * 60 * 1000

/** Whether the thread accepts messages. Mirrors the database's project_accepts_messages: open while the project is set up or active, and for 30 days after it completes or is terminated. */
export function messageWindow(
  p: { status: string; closed_at: string | null },
  now: Date,
): { open: boolean; until: Date | null } {
  if (p.status === 'setup' || p.status === 'active' || !p.closed_at) return { open: true, until: null }
  const until = new Date(new Date(p.closed_at).getTime() + POST_CLOSE_MS)
  return { open: now.getTime() < until.getTime(), until }
}
