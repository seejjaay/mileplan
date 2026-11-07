import type { ReactNode } from 'react'
import { act, renderHook } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { qk } from '../api/keys'
import { useUnreadRealtime } from './useUnreadRealtime'

type Handler = { type: string; spec: { event?: string; table?: string; filter?: string }; cb: (payload: unknown) => void }
const handlers: Handler[] = []
const channel: { on: ReturnType<typeof vi.fn>; subscribe: ReturnType<typeof vi.fn> } = {
  on: vi.fn((type: string, spec: Handler['spec'], cb: (payload: unknown) => void) => {
    handlers.push({ type, spec, cb })
    return channel
  }),
  subscribe: vi.fn(() => channel),
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

describe('useUnreadRealtime', () => {
  it('opens one channel listening to message inserts with no filter', () => {
    renderHook(() => useUnreadRealtime('u1'), { wrapper })
    expect(makeChannel).toHaveBeenCalledTimes(1)
    expect(makeChannel).toHaveBeenCalledWith('unread:u1')
    expect(handlers).toHaveLength(1)
    expect(handlers[0].type).toBe('postgres_changes')
    expect(handlers[0].spec).toEqual({ event: 'INSERT', schema: 'public', table: 'messages' })
  })

  it('an event refreshes the unread counts', () => {
    const spy = vi.spyOn(queryClient, 'invalidateQueries')
    renderHook(() => useUnreadRealtime('u1'), { wrapper })
    act(() => handlers[0].cb({ eventType: 'INSERT', new: { id: 'm1' } }))
    expect(spy).toHaveBeenCalledWith({ queryKey: qk.unread() })
  })

  it('removes the channel on unmount', () => {
    const { unmount } = renderHook(() => useUnreadRealtime('u1'), { wrapper })
    unmount()
    expect(removeChannel).toHaveBeenCalledWith(channel)
  })

  it('opens nothing without a user', () => {
    renderHook(() => useUnreadRealtime(undefined), { wrapper })
    expect(makeChannel).not.toHaveBeenCalled()
  })
})
