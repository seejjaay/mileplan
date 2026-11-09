import { formatDate } from './format'

const MIN = 60_000
const HOUR = 60 * MIN
const DAY = 24 * HOUR

/** "just now", "5 min ago", "3 h ago", "2 d ago", then a date after a week. `now` is injectable for tests. */
export function relativeTime(iso: string, now: number = Date.now()): string {
  const age = now - Date.parse(iso)
  if (age < MIN) return 'just now' // includes a clock that is slightly ahead of ours
  if (age < HOUR) return `${Math.floor(age / MIN)} min ago`
  if (age < DAY) return `${Math.floor(age / HOUR)} h ago`
  if (age < 7 * DAY) return `${Math.floor(age / DAY)} d ago`
  return formatDate(iso)
}
