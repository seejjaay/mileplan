import { relativeTime } from './relativeTime'

const now = Date.parse('2026-11-09T12:00:00Z')
const ago = (ms: number) => new Date(now - ms).toISOString()
const MIN = 60_000
const HOUR = 60 * MIN
const DAY = 24 * HOUR

describe('relativeTime', () => {
  it('says just now under a minute, and for a clock that is slightly ahead', () => {
    expect(relativeTime(ago(30_000), now)).toBe('just now')
    expect(relativeTime(ago(-5_000), now)).toBe('just now')
  })

  it('counts minutes, hours and days', () => {
    expect(relativeTime(ago(5 * MIN), now)).toBe('5 min ago')
    expect(relativeTime(ago(3 * HOUR), now)).toBe('3 h ago')
    expect(relativeTime(ago(2 * DAY), now)).toBe('2 d ago')
  })

  it('switches to a date after a week', () => {
    expect(relativeTime('2026-10-20T08:00:00Z', now)).toBe('Oct 20, 2026')
  })
})
