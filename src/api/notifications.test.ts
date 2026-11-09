import { listNotifications, markAllNotificationsRead, markNotificationsRead, unreadNotificationCount, type NotificationRow } from './notifications'

const calls: [string, unknown[]][] = []
let result: { data?: unknown; count?: number | null; error?: unknown } = {}

function builder() {
  const b: Record<string, unknown> = {}
  for (const m of ['select', 'order', 'limit', 'is']) {
    b[m] = (...args: unknown[]) => {
      calls.push([m, args])
      return b
    }
  }
  b.then = (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) => Promise.resolve(result).then(resolve, reject)
  return b
}

const rpc = vi.fn()
vi.mock('../lib/supabase', () => ({
  supabase: {
    from: (table: string) => {
      calls.push(['from', [table]])
      return builder()
    },
    rpc: (...args: unknown[]) => rpc(...args),
  },
}))

const call = (name: string) => calls.find(([c]) => c === name)?.[1]
const row: NotificationRow = {
  id: 'n1',
  project_id: 'p1',
  kind: 'update_posted',
  needs_action: false,
  count: 1,
  data: {},
  created_at: '2026-11-09T10:00:00Z',
  updated_at: '2026-11-09T10:00:00Z',
  read_at: null,
  project: { title: 'Acme', currency: 'PHP' },
}

beforeEach(() => {
  calls.length = 0
  rpc.mockReset()
  rpc.mockResolvedValue({ error: null })
  result = {}
})

describe('listNotifications', () => {
  it('reads the latest 50 with the project joined, newest first', async () => {
    result = { data: [row], error: null }
    expect(await listNotifications()).toEqual([row])
    expect(call('from')).toEqual(['notifications'])
    expect(call('select')).toEqual(['*, project:projects(title, currency)'])
    expect(call('order')).toEqual(['updated_at', { ascending: false }])
    expect(call('limit')).toEqual([50])
  })

  it('throws the Supabase error', async () => {
    result = { data: null, error: new Error('boom') }
    await expect(listNotifications()).rejects.toThrow('boom')
  })
})

describe('unreadNotificationCount', () => {
  it('counts unread rows with a head request', async () => {
    result = { count: 4, error: null }
    expect(await unreadNotificationCount()).toBe(4)
    expect(call('select')).toEqual(['id', { count: 'exact', head: true }])
    expect(call('is')).toEqual(['read_at', null])
  })

  it('is 0 when there is no count', async () => {
    result = { count: null, error: null }
    expect(await unreadNotificationCount()).toBe(0)
  })
})

describe('mark read', () => {
  it('marks the given ids through the RPC', async () => {
    await markNotificationsRead(['a', 'b'])
    expect(rpc).toHaveBeenCalledWith('mark_notifications_read', { p_ids: ['a', 'b'] })
  })

  it('marks all through the RPC', async () => {
    await markAllNotificationsRead()
    expect(rpc).toHaveBeenCalledWith('mark_all_notifications_read')
  })

  it('throws an RPC error', async () => {
    rpc.mockResolvedValue({ error: new Error('nope') })
    await expect(markAllNotificationsRead()).rejects.toThrow('nope')
  })
})
