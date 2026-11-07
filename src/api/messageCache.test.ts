import { appendMessage, nextCursor, replaceMessage, threadOrder, type Thread } from './messageCache'
import type { MessageRow } from './messages'

const msg = (id: string, created_at: string, body = id): MessageRow => ({
  id,
  created_at,
  project_id: 'p1',
  sender_id: 'u1',
  body,
  attachments: [],
  edited_at: null,
})
const at = (n: number) => `2026-11-08T10:${String(n).padStart(2, '0')}:00+00:00`

// pages are newest first, as listMessages returns them
const thread = (): Thread => ({
  pages: [
    [msg('m4', at(4)), msg('m3', at(3))],
    [msg('m2', at(2)), msg('m1', at(1))],
  ],
  pageParams: [undefined, { created_at: at(3), id: 'm3' }],
})

describe('appendMessage', () => {
  it('does nothing when the thread has not loaded', () => {
    expect(appendMessage(undefined, msg('m5', at(5)))).toBeUndefined()
  })

  it('puts the message first in the first page without mutating the input', () => {
    const t = thread()
    const before = structuredClone(t)
    const out = appendMessage(t, msg('m5', at(5)))!
    expect(out.pages[0].map((m) => m.id)).toEqual(['m5', 'm4', 'm3'])
    expect(out.pages[1]).toBe(t.pages[1])
    expect(out.pageParams).toBe(t.pageParams)
    expect(t).toEqual(before)
  })

  it('returns the same object when the id is already in any page', () => {
    const t = thread()
    expect(appendMessage(t, msg('m4', at(4)))).toBe(t)
    expect(appendMessage(t, msg('m1', at(1)))).toBe(t)
  })

  it('is idempotent in either order of echo and mutation', () => {
    const m = msg('m5', at(5))
    const once = appendMessage(thread(), m)!
    expect(appendMessage(once, m)).toBe(once)
    expect(threadOrder(once).filter((x) => x.id === 'm5')).toHaveLength(1)
  })
})

describe('replaceMessage', () => {
  it('swaps by id across pages without mutating the input', () => {
    const t = thread()
    const before = structuredClone(t)
    const edited = { ...msg('m2', at(2), 'changed'), edited_at: at(9) }
    const out = replaceMessage(t, edited)!
    expect(out.pages[1][0]).toBe(edited)
    expect(out.pages[0]).toBe(t.pages[0])
    expect(t).toEqual(before)
  })

  it('returns the same object when the id is not loaded, or the thread is undefined', () => {
    const t = thread()
    expect(replaceMessage(t, msg('zz', at(8)))).toBe(t)
    expect(replaceMessage(undefined, msg('zz', at(8)))).toBeUndefined()
  })
})

describe('threadOrder', () => {
  it('lists two pages oldest to newest', () => {
    expect(threadOrder(thread()).map((m) => m.id)).toEqual(['m1', 'm2', 'm3', 'm4'])
  })
})

describe('nextCursor', () => {
  const page = (n: number) => Array.from({ length: n }, (_, i) => msg(`id${i}`, at(59 - i)))

  it('is the last row of a full page', () => {
    const p = page(50)
    expect(nextCursor(p)).toEqual({ created_at: p[49].created_at, id: 'id49' })
  })

  it('is undefined for a short page', () => {
    expect(nextCursor(page(49))).toBeUndefined()
    expect(nextCursor([])).toBeUndefined()
  })
})
