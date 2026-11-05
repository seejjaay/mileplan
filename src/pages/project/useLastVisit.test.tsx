import type { ReactNode } from 'react'
import { act, renderHook, waitFor } from '@testing-library/react'
import type { Session } from '@supabase/supabase-js'
import { AuthContext } from '../../auth/AuthProvider'
import { readLastSeen, touchLastSeen } from '../../api/lastVisit'
import { useLastVisit } from './useLastVisit'

vi.mock('../../api/lastVisit', () => ({ readLastSeen: vi.fn(), touchLastSeen: vi.fn() }))

const withRole = (role: 'admin' | 'client') =>
  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <AuthContext.Provider
        value={{
          session: { user: { id: 'u1' } } as Session,
          profile: { id: 'u1', role, full_name: 'Eve', active: true },
          loading: false,
          signOut: async () => {},
        }}
      >
        {children}
      </AuthContext.Provider>
    )
  }

beforeEach(() => {
  vi.mocked(readLastSeen).mockResolvedValue('2026-11-04T10:00:00Z')
  vi.mocked(touchLastSeen).mockResolvedValue()
})
afterEach(() => {
  vi.clearAllMocks()
  vi.useRealTimers()
})

describe('useLastVisit', () => {
  it('keeps the previous last_seen_at for the whole visit and only then writes now()', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const { result } = renderHook(() => useLastVisit('p1'), { wrapper: withRole('client') })
    await waitFor(() => expect(result.current.since).toBe('2026-11-04T10:00:00Z'))
    expect(touchLastSeen).not.toHaveBeenCalled()
    await act(async () => void vi.advanceTimersByTime(1600))
    expect(touchLastSeen).toHaveBeenCalledWith('p1')
    expect(result.current.since).toBe('2026-11-04T10:00:00Z') // the markers do not vanish when the stamp moves
  })

  it('a first visit has no previous stamp, so nothing will be marked, but the visit is still recorded', async () => {
    vi.mocked(readLastSeen).mockResolvedValue(null)
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const { result } = renderHook(() => useLastVisit('p1'), { wrapper: withRole('client') })
    await waitFor(() => expect(readLastSeen).toHaveBeenCalled())
    expect(result.current.since).toBeNull()
    await act(async () => void vi.advanceTimersByTime(1600))
    expect(touchLastSeen).toHaveBeenCalledWith('p1')
  })

  it('leaving before the delay does not count as a visit', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const { unmount } = renderHook(() => useLastVisit('p1'), { wrapper: withRole('client') })
    await waitFor(() => expect(readLastSeen).toHaveBeenCalled())
    unmount()
    await act(async () => void vi.advanceTimersByTime(5000))
    expect(touchLastSeen).not.toHaveBeenCalled()
  })

  it('the admin has no member row: no read, no write', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const { result } = renderHook(() => useLastVisit('p1'), { wrapper: withRole('admin') })
    await act(async () => void vi.advanceTimersByTime(5000))
    expect(result.current.since).toBeNull()
    expect(readLastSeen).not.toHaveBeenCalled()
    expect(touchLastSeen).not.toHaveBeenCalled()
  })

  it('a failed read means no markers, not an error', async () => {
    vi.mocked(readLastSeen).mockRejectedValue(new Error('offline'))
    const { result } = renderHook(() => useLastVisit('p1'), { wrapper: withRole('client') })
    await waitFor(() => expect(readLastSeen).toHaveBeenCalled())
    expect(result.current.since).toBeNull()
  })
})
