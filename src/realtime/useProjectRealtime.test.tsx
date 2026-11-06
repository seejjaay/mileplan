import type { ReactNode } from 'react'
import { act, render, renderHook, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { qk } from '../api/keys'
import { ReconnectingPill } from './ReconnectingPill'
import { useProjectRealtime } from './useProjectRealtime'

type Handler = { table: string; filter?: string; cb: (payload: unknown) => void }
const handlers: Handler[] = []
let statusCb: (status: string) => void = () => {}

const channel: { on: ReturnType<typeof vi.fn>; subscribe: ReturnType<typeof vi.fn> } = {
  on: vi.fn((_type: string, spec: { table: string; filter?: string }, cb: (payload: unknown) => void) => {
    handlers.push({ table: spec.table, filter: spec.filter, cb })
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
