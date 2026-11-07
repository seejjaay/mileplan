import type { ReactNode } from 'react'
import { act, render, renderHook, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { qk } from '../api/keys'
import type { MessageRow } from '../api/messages'
import type { Thread } from '../api/messageCache'
import { ReconnectingPill } from './ReconnectingPill'
import { useProjectRealtime } from './useProjectRealtime'

type Handler = { type: string; table: string; filter?: string; cb: (payload: unknown) => void }
const handlers: Handler[] = []
let statusCb: (status: string) => void = () => {}

const channel: { on: ReturnType<typeof vi.fn>; subscribe: ReturnType<typeof vi.fn> } = {
  on: vi.fn((type: string, spec: { table: string; filter?: string }, cb: (payload: unknown) => void) => {
    handlers.push({ type, table: spec.table, filter: spec.filter, cb })
    return channel
  }),
  subscribe: vi.fn((cb: (status: string) => void) => {
    statusCb = cb
    return channel
  }),
}
const removeChannel = vi.fn()

vi.mock('../lib/supabase', () => ({ supabase: { channel: vi.fn(() => channel), removeChannel: (...a: unknown[]) => removeChannel(...a) } }))

let queryClient: QueryClient
const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>

const fire = (table: string, payload: unknown) => act(() => handlers.filter((h) => h.table === table).forEach((h) => h.cb(payload)))
const status = (s: string) => act(() => statusCb(s))
const streaming = () => act(() => handlers.filter((h) => h.type === 'system').forEach((h) => h.cb({ extension: 'postgres_changes', status: 'ok', message: 'Subscribed to PostgreSQL' })))
const keysInvalidated = (spy: { mock: { calls: unknown[][] } }) => spy.mock.calls.map((c) => JSON.stringify((c[0] as { queryKey: unknown }).queryKey))

beforeEach(() => {
  handlers.length = 0
  queryClient = new QueryClient()
})
afterEach(() => {
  vi.clearAllMocks()
  vi.useRealTimers()
})

describe('useProjectRealtime', () => {
  it('subscribes to the project with the right filters', () => {
    renderHook(() => useProjectRealtime('p1'), { wrapper })
    const find = (t: string) => handlers.find((h) => h.table === t)
    expect(find('milestones')?.filter).toBe('project_id=eq.p1')
    expect(find('activity')?.filter).toBe('project_id=eq.p1')
    expect(find('projects')?.filter).toBe('id=eq.p1')
    expect(find('plan_change_acks')?.filter).toBeUndefined() // no project_id column; RLS scopes it
  })

  it('subscribes to the messages of the project', () => {
    renderHook(() => useProjectRealtime('p1'), { wrapper })
    expect(handlers.find((h) => h.table === 'messages')?.filter).toBe('project_id=eq.p1')
  })

  describe('messages', () => {
    const msg = (over: Partial<MessageRow> = {}): MessageRow => ({
      id: 'm1',
      created_at: '2026-11-08T10:00:00Z',
      project_id: 'p1',
      sender_id: 'u1',
      body: 'hi',
      attachments: [],
      edited_at: null,
      ...over,
    })
    const seed = (rows: MessageRow[]) => queryClient.setQueryData<Thread>(qk.messages('p1'), { pages: [rows], pageParams: [undefined] })

    it('an INSERT is patched into the thread without refetching it', () => {
      seed([msg()])
      const set = vi.spyOn(queryClient, 'setQueryData')
      const spy = vi.spyOn(queryClient, 'invalidateQueries')
      renderHook(() => useProjectRealtime('p1'), { wrapper })
      fire('messages', { eventType: 'INSERT', new: msg({ id: 'm2', body: 'new' }) })
      expect(set).toHaveBeenCalledWith(qk.messages('p1'), expect.any(Function))
      expect(queryClient.getQueryData<Thread>(qk.messages('p1'))?.pages[0].map((m) => m.id)).toEqual(['m2', 'm1'])
      expect(keysInvalidated(spy)).not.toContain(JSON.stringify(qk.messages('p1')))
    })

    it('an UPDATE replaces the row', () => {
      seed([msg()])
      renderHook(() => useProjectRealtime('p1'), { wrapper })
      fire('messages', { eventType: 'UPDATE', new: msg({ body: 'edited', edited_at: '2026-11-08T10:05:00Z' }) })
      expect(queryClient.getQueryData<Thread>(qk.messages('p1'))?.pages[0][0]).toMatchObject({ body: 'edited', edited_at: '2026-11-08T10:05:00Z' })
    })

    it('an INSERT before the thread has loaded writes nothing', () => {
      renderHook(() => useProjectRealtime('p1'), { wrapper })
      fire('messages', { eventType: 'INSERT', new: msg() })
      expect(queryClient.getQueryData(qk.messages('p1'))).toBeUndefined()
    })

    it('the stream going live refetches the thread and the unread counts', () => {
      const spy = vi.spyOn(queryClient, 'invalidateQueries')
      renderHook(() => useProjectRealtime('p1'), { wrapper })
      streaming()
      const keys = keysInvalidated(spy)
      expect(keys).toContain(JSON.stringify(qk.messages('p1')))
      expect(keys).toContain(JSON.stringify(qk.unread()))
    })
  })

  it('a milestones event refreshes milestones, the project and the dashboard', () => {
    const spy = vi.spyOn(queryClient, 'invalidateQueries')
    renderHook(() => useProjectRealtime('p1'), { wrapper })
    fire('milestones', { eventType: 'UPDATE', new: { id: 'm1' } })
    const keys = keysInvalidated(spy)
    expect(keys).toContain(JSON.stringify(qk.milestones('p1')))
    expect(keys).toContain(JSON.stringify(qk.project('p1')))
    expect(keys).toContain(JSON.stringify(qk.projects()))
    expect(keys).not.toContain(JSON.stringify(qk.updates('p1')))
  })

  it('subscribes to payment requests and payments of the project', () => {
    renderHook(() => useProjectRealtime('p1'), { wrapper })
    expect(handlers.find((h) => h.table === 'payment_requests')?.filter).toBe('project_id=eq.p1')
    expect(handlers.find((h) => h.table === 'payments')?.filter).toBe('project_id=eq.p1')
  })

  it('a payments event refreshes payments, the project and the dashboard', () => {
    const spy = vi.spyOn(queryClient, 'invalidateQueries')
    renderHook(() => useProjectRealtime('p1'), { wrapper })
    fire('payments', { eventType: 'INSERT', new: { id: 'pay1' } })
    const keys = keysInvalidated(spy)
    expect(keys).toContain(JSON.stringify(qk.payments('p1')))
    expect(keys).toContain(JSON.stringify(qk.project('p1')))
    expect(keys).toContain(JSON.stringify(qk.projects()))
    expect(keys).not.toContain(JSON.stringify(qk.updates('p1')))
  })

  it('an activity event refreshes every project key (it is the reliable signal for deletes)', () => {
    const spy = vi.spyOn(queryClient, 'invalidateQueries')
    renderHook(() => useProjectRealtime('p1'), { wrapper })
    fire('activity', { eventType: 'INSERT', new: { entity: 'milestone', entity_id: 'm1', action: 'deleted' } })
    const keys = keysInvalidated(spy)
    for (const key of [qk.milestones('p1'), qk.project('p1'), qk.projects(), qk.updates('p1'), qk.documents('p1'), qk.activity('p1'), qk.planChanges('p1'), qk.reviews('p1'), qk.payments('p1')]) {
      expect(keys).toContain(JSON.stringify(key))
    }
  })

  it('a milestone status change in the activity stream becomes lastChange', () => {
    const { result } = renderHook(() => useProjectRealtime('p1'), { wrapper })
    expect(result.current.lastChange).toBeNull()
    fire('activity', { eventType: 'INSERT', new: { entity: 'task', entity_id: 't1', action: 'status_changed' } })
    expect(result.current.lastChange).toBeNull()
    fire('activity', { eventType: 'INSERT', new: { entity: 'milestone', entity_id: 'm7', action: 'status_changed' } })
    expect(result.current.lastChange).toMatchObject({ table: 'milestones', id: 'm7' })
  })

  it('refetches everything when the channel comes back after a drop', () => {
    const spy = vi.spyOn(queryClient, 'invalidateQueries')
    renderHook(() => useProjectRealtime('p1'), { wrapper })
    status('SUBSCRIBED')
    expect(spy).not.toHaveBeenCalled() // first connect: nothing was missed
    status('CHANNEL_ERROR')
    status('SUBSCRIBED')
    const keys = keysInvalidated(spy)
    for (const key of [qk.milestones('p1'), qk.updates('p1'), qk.documents('p1'), qk.activity('p1'), qk.project('p1')]) {
      expect(keys).toContain(JSON.stringify(key))
    }
  })

  it('refetches when the server starts streaming, on first open and after a rejoin, since changes before that are never delivered', () => {
    const spy = vi.spyOn(queryClient, 'invalidateQueries')
    renderHook(() => useProjectRealtime('p1'), { wrapper })
    status('SUBSCRIBED')
    expect(spy).not.toHaveBeenCalled() // joined, but not streaming yet
    streaming()
    expect(keysInvalidated(spy)).toContain(JSON.stringify(qk.milestones('p1')))
    status('CHANNEL_ERROR')
    status('SUBSCRIBED')
    spy.mockClear()
    streaming()
    expect(keysInvalidated(spy)).toContain(JSON.stringify(qk.milestones('p1')))
  })

  it('ignores system messages that are not the postgres_changes ok', () => {
    const spy = vi.spyOn(queryClient, 'invalidateQueries')
    renderHook(() => useProjectRealtime('p1'), { wrapper })
    act(() => handlers.filter((h) => h.type === 'system').forEach((h) => {
      h.cb({ extension: 'system', status: 'ok', message: 'Replication connection established' })
      h.cb({ extension: 'postgres_changes', status: 'error', message: 'failed' })
    }))
    expect(spy).not.toHaveBeenCalled()
  })

  it('shows reconnecting only after a connected channel has been down for 1.5 s, and hides it on return', () => {
    vi.useFakeTimers()
    const { result } = renderHook(() => useProjectRealtime('p1'), { wrapper })
    status('SUBSCRIBED')
    expect(result.current.reconnecting).toBe(false)
    status('CHANNEL_ERROR')
    act(() => void vi.advanceTimersByTime(1400))
    expect(result.current.reconnecting).toBe(false)
    act(() => void vi.advanceTimersByTime(200))
    expect(result.current.reconnecting).toBe(true)
    status('SUBSCRIBED')
    expect(result.current.reconnecting).toBe(false)
  })

  it('never shows reconnecting if the first connect has not succeeded yet', () => {
    vi.useFakeTimers()
    const { result } = renderHook(() => useProjectRealtime('p1'), { wrapper })
    status('CHANNEL_ERROR')
    act(() => void vi.advanceTimersByTime(5000))
    expect(result.current.reconnecting).toBe(false)
  })

  it('treats the browser going offline as a drop, and refetches when it is back', () => {
    vi.useFakeTimers()
    const spy = vi.spyOn(queryClient, 'invalidateQueries')
    const { result } = renderHook(() => useProjectRealtime('p1'), { wrapper })
    status('SUBSCRIBED')
    act(() => void window.dispatchEvent(new Event('offline')))
    act(() => void vi.advanceTimersByTime(1600))
    expect(result.current.reconnecting).toBe(true)
    act(() => void window.dispatchEvent(new Event('online')))
    expect(keysInvalidated(spy)).toContain(JSON.stringify(qk.milestones('p1')))
  })

  it('an acknowledgement refreshes the plan changes AND the timeline (which embeds who acknowledged)', () => {
    const spy = vi.spyOn(queryClient, 'invalidateQueries')
    renderHook(() => useProjectRealtime('p1'), { wrapper })
    fire('plan_change_acks', { eventType: 'INSERT', new: { activity_id: 'a1', user_id: 'u1' } })
    const keys = keysInvalidated(spy)
    expect(keys).toContain(JSON.stringify(qk.planChanges('p1')))
    expect(keys).toContain(JSON.stringify(qk.activity('p1')))
  })

  it('coming back online hides the pill even if the channel never reported a drop', () => {
    vi.useFakeTimers()
    const { result } = renderHook(() => useProjectRealtime('p1'), { wrapper })
    status('SUBSCRIBED')
    act(() => void window.dispatchEvent(new Event('offline')))
    act(() => void vi.advanceTimersByTime(1600))
    expect(result.current.reconnecting).toBe(true)
    act(() => void window.dispatchEvent(new Event('online')))
    expect(result.current.reconnecting).toBe(false)
  })

  it('removes the channel on unmount', () => {
    const { unmount } = renderHook(() => useProjectRealtime('p1'), { wrapper })
    unmount()
    expect(removeChannel).toHaveBeenCalledWith(channel)
  })
})

describe('ReconnectingPill', () => {
  it('prints Reconnecting… only when visible', () => {
    const { rerender } = render(<ReconnectingPill visible={false} />)
    expect(screen.queryByText('Reconnecting…')).not.toBeInTheDocument()
    rerender(<ReconnectingPill visible />)
    expect(screen.getByRole('status')).toHaveTextContent('Reconnecting…')
  })
})
