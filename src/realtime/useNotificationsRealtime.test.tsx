import type { ReactNode } from 'react'
import { act, renderHook } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { qk } from '../api/keys'
import { useNotificationsRealtime } from './useNotificationsRealtime'

type Handler = { type: string; spec: { event?: string; table?: string; filter?: string }; cb: (payload: unknown) => void }
const handlers: Handler[] = []
let statusCb: ((status: string) => void) | undefined
const channel: { on: ReturnType<typeof vi.fn>; subscribe: ReturnType<typeof vi.fn> } = {
  on: vi.fn((type: string, spec: Handler['spec'], cb: (payload: unknown) => void) => {
    handlers.push({ type, spec, cb })
    return channel
  }),
  subscribe: vi.fn((cb?: (status: string) => void) => {
    statusCb = cb
    return channel
  }),
}
const makeChannel = vi.fn(() => channel)
const removeChannel = vi.fn()

vi.mock('../lib/supabase', () => ({ supabase: { channel: (...a: unknown[]) => makeChannel(...(a as [])), removeChannel: (...a: unknown[]) => removeChannel(...a) } }))

let queryClient: QueryClient
const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>

beforeEach(() => {
  handlers.length = 0
  queryClient = new QueryClient()
})
afterEach(() => vi.clearAllMocks())

describe('useNotificationsRealtime', () => {
  it('opens one channel filtered to the user', () => {
    renderHook(() => useNotificationsRealtime('u1'), { wrapper })
    expect(makeChannel).toHaveBeenCalledTimes(1)
    expect(makeChannel).toHaveBeenCalledWith('notifications:u1')
    expect(handlers).toHaveLength(1)
    expect(handlers[0].type).toBe('postgres_changes')
    expect(handlers[0].spec).toEqual({ event: '*', schema: 'public', table: 'notifications', filter: 'recipient_id=eq.u1' })
  })

  it('an insert event refreshes notifications', () => {
    const spy = vi.spyOn(queryClient, 'invalidateQueries')
    renderHook(() => useNotificationsRealtime('u1'), { wrapper })
    act(() => handlers[0].cb({ eventType: 'INSERT', new: { id: 'n1' } }))
    expect(spy).toHaveBeenCalledWith({ queryKey: qk.notifications() })
  })

  // Resolved on another device: the badge here must drop live, not only grow.
  it('an update event refreshes notifications', () => {
    const spy = vi.spyOn(queryClient, 'invalidateQueries')
    renderHook(() => useNotificationsRealtime('u1'), { wrapper })
    act(() => handlers[0].cb({ eventType: 'UPDATE', new: { id: 'n1', read_at: '2026-11-09T10:00:00Z' } }))
    expect(spy).toHaveBeenCalledWith({ queryKey: qk.notifications() })
  })

  // Events are not replayed after a dropped connection (a phone that slept), so (re)joining refreshes everything.
  it('refreshes when the channel (re)subscribes, and ignores other statuses', () => {
    const spy = vi.spyOn(queryClient, 'invalidateQueries')
    renderHook(() => useNotificationsRealtime('u1'), { wrapper })
    expect(statusCb).toBeTypeOf('function')
    act(() => statusCb!('CHANNEL_ERROR'))
    act(() => statusCb!('CLOSED'))
    expect(spy).not.toHaveBeenCalled()
    act(() => statusCb!('SUBSCRIBED'))
    expect(spy).toHaveBeenCalledWith({ queryKey: qk.notifications() })
  })

  it('opens nothing without a user', () => {
    renderHook(() => useNotificationsRealtime(undefined), { wrapper })
    expect(makeChannel).not.toHaveBeenCalled()
  })

  it('removes the channel on unmount', () => {
    const { unmount } = renderHook(() => useNotificationsRealtime('u1'), { wrapper })
    unmount()
    expect(removeChannel).toHaveBeenCalledWith(channel)
  })
})
