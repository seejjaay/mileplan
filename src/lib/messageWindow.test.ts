import { messageWindow } from './messageWindow'

const now = new Date('2026-11-08T12:00:00Z')
const DAY = 24 * 60 * 60 * 1000

describe('messageWindow', () => {
  it('is open with no end while the project is active', () => {
    expect(messageWindow({ status: 'active', closed_at: null }, now)).toEqual({ open: true, until: null })
  })

  it('stays open for 30 days after close', () => {
    const closed = new Date(now.getTime() - 29 * DAY)
    const w = messageWindow({ status: 'completed', closed_at: closed.toISOString() }, now)
    expect(w.open).toBe(true)
    expect(w.until).toEqual(new Date(closed.getTime() + 30 * DAY))
  })

  it.each(['setup', 'active'])('is open with no end while the project is %s', (status) => {
    expect(messageWindow({ status, closed_at: null }, now)).toEqual({ open: true, until: null })
  })

  it('treats a terminated project like a completed one', () => {
    const closed = new Date(now.getTime() - 31 * DAY)
    expect(messageWindow({ status: 'terminated', closed_at: closed.toISOString() }, now).open).toBe(false)
  })

  it('is shut 31 days after close', () => {
    const closed = new Date(now.getTime() - 31 * DAY)
    expect(messageWindow({ status: 'completed', closed_at: closed.toISOString() }, now).open).toBe(false)
  })
})
