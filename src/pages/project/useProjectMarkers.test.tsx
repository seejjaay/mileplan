import type { ReactNode } from 'react'
import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { Session } from '@supabase/supabase-js'
import { AuthContext } from '../../auth/AuthProvider'
import { listActivitySince, type ActivityRow } from '../../api/activity'
import { listMilestones, type Milestone } from '../../api/milestones'
import { readLastSeen } from '../../api/lastVisit'
import { useProjectMarkers } from './useProjectMarkers'

vi.mock('../../api/lastVisit', () => ({ readLastSeen: vi.fn(), touchLastSeen: vi.fn() }))
vi.mock('../../api/activity', () => ({ listActivitySince: vi.fn() }))
vi.mock('../../api/milestones', async (orig) => ({ ...(await orig<typeof import('../../api/milestones')>()), listMilestones: vi.fn() }))

const row = (over: Partial<ActivityRow>): ActivityRow => ({
  id: 'a',
  project_id: 'p1',
  actor_id: 'admin',
  entity: 'task',
  entity_id: 't1',
  action: 'updated',
  changes: null,
  reason: null,
  plan_change: false,
  created_at: '2026-11-05T09:00:00Z',
  actor_name: 'CJ',
  acks: [],
  ...over,
})

function wrapper(role: 'admin' | 'client') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={client}>
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
      </QueryClientProvider>
    )
  }
}

beforeEach(() => {
  vi.mocked(readLastSeen).mockResolvedValue('2026-11-05T08:00:00Z')
  vi.mocked(listMilestones).mockResolvedValue([{ id: 'm3', tasks: [{ id: 't1' }] } as unknown as Milestone])
  vi.mocked(listActivitySince).mockResolvedValue([row({})])
})
afterEach(() => vi.clearAllMocks())

describe('useProjectMarkers', () => {
  it('turns activity since the last visit into milestone and tab markers', async () => {
    const { result } = renderHook(() => useProjectMarkers('p1'), { wrapper: wrapper('client') })
    await waitFor(() => expect([...result.current.milestones]).toEqual(['m3']))
    expect(result.current.tabs.has('milestones')).toBe(true)
    expect(listActivitySince).toHaveBeenCalledWith('p1', '2026-11-05T08:00:00Z')
  })

  it('marks nothing on a first visit and does not even ask for activity', async () => {
    vi.mocked(readLastSeen).mockResolvedValue(null)
    const { result } = renderHook(() => useProjectMarkers('p1'), { wrapper: wrapper('client') })
    await waitFor(() => expect(readLastSeen).toHaveBeenCalled())
    expect(result.current.milestones.size).toBe(0)
    expect(listActivitySince).not.toHaveBeenCalled()
  })

  it('the admin gets no markers', async () => {
    const { result } = renderHook(() => useProjectMarkers('p1'), { wrapper: wrapper('admin') })
    expect(result.current.milestones.size).toBe(0)
    expect(result.current.tabs.size).toBe(0)
    expect(listActivitySince).not.toHaveBeenCalled()
  })
})
