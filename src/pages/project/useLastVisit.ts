import { useEffect, useState } from 'react'
import { readLastSeen, touchLastSeen } from '../../api/lastVisit'
import { useAuth } from '../../auth/AuthProvider'

/** A visit only counts once the page has been open this long (so a bounce or a dev double-mount doesn't reset the markers). */
const COUNT_VISIT_AFTER_MS = 1500

/**
 * The client's previous visit stamp, held for the whole visit, then moved to "now".
 * Admins have no member row, so they get null and nothing is written.
 */
export function useLastVisit(projectId: string): { since: string | null } {
  const { profile } = useAuth()
  const userId = profile?.role === 'client' ? profile.id : undefined
  const [since, setSince] = useState<string | null>(null)

  useEffect(() => {
    if (!userId) return
    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | undefined
    readLastSeen(projectId, userId)
      .then((previous) => {
        if (cancelled) return
        setSince(previous)
        timer = setTimeout(() => void touchLastSeen(projectId).catch(() => undefined), COUNT_VISIT_AFTER_MS)
      })
      .catch(() => undefined) // no stamp -> no markers; never an error screen
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [projectId, userId])

  return { since }
}
