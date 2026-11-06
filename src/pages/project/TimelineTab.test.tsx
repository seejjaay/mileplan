import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { Session } from '@supabase/supabase-js'
import { AuthContext } from '../../auth/AuthProvider'
import { listActivity, type ActivityRow } from '../../api/activity'
import { listDocuments } from '../../api/documents'
import { listMilestones, type Milestone } from '../../api/milestones'
import type { ProjectSummary } from '../../api/projects'
import TimelineTab from './TimelineTab'

vi.mock('../../api/activity', () => ({ listActivity: vi.fn() }))
vi.mock('../../api/documents', async (orig) => ({ ...(await orig<typeof import('../../api/documents')>()), listDocuments: vi.fn() }))
vi.mock('../../api/milestones', async (orig) => ({ ...(await orig<typeof import('../../api/milestones')>()), listMilestones: vi.fn() }))

const project: ProjectSummary = {
  id: 'p1',
  title: 'Website rebuild',
  summary: null,
  status: 'active',
  currency: 'PHP',
  start_date: null,
  end_date: null,
  activated_at: null,
  closed_at: null,
  created_at: '2026-11-01T00:00:00Z',
  percent: 0,
  nextDue: null,
  scheduled: 0,
  paid: 0,
  outstanding: 0,
  overdue: 0,
}

const row = (i: number, over: Partial<ActivityRow> = {}): ActivityRow => ({
  id: `a${i}`,
  project_id: 'p1',
  actor_id: 'u1',
  entity: 'milestone',
  entity_id: 'm1',
  action: 'updated',
  changes: { due_date: ['2026-12-01', '2026-12-15'] },
  reason: null,
  plan_change: false,
  created_at: new Date(Date.UTC(2026, 10, 5, 12, 0, 0) - i * 60_000).toISOString(),
  actor_name: 'CJ',
  acks: [],
  ...over,
})

function renderTab(role: 'admin' | 'client' = 'admin') {
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <AuthContext.Provider
        value={{
          session: { user: { id: 'u1' } } as Session,
          profile: { id: 'u1', role, full_name: 'X', active: true },
          loading: false,
          signOut: async () => {},
        }}
      >
        <TimelineTab project={project} />
      </AuthContext.Provider>
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  vi.mocked(listMilestones).mockResolvedValue([{ id: 'm1', title: 'Build', tasks: [] } as unknown as Milestone])
  vi.mocked(listDocuments).mockResolvedValue([])
})
afterEach(() => vi.clearAllMocks())

describe('TimelineTab', () => {
  it('shows the exact empty copy only after an empty result', async () => {
    vi.mocked(listActivity).mockResolvedValue([])
    renderTab()
    expect(screen.queryByText('Nothing has happened yet.')).not.toBeInTheDocument()
    expect(await screen.findByText('Nothing has happened yet.')).toBeInTheDocument()
  })

  it('shows a sentence with the actor, the reason and a Plan change chip', async () => {
    vi.mocked(listActivity).mockResolvedValue([row(0, { plan_change: true, reason: 'client asked' })])
    renderTab()
    expect(await screen.findByText('Milestone “Build” — Due date: Dec 1, 2026 → Dec 15, 2026. Reason: client asked')).toBeInTheDocument()
    expect(screen.getByText('Plan change')).toBeInTheDocument()
    expect(screen.getByText(/CJ/)).toBeInTheDocument()
  })

  it('names a deleted milestone from the row itself', async () => {
    vi.mocked(listActivity).mockResolvedValue([row(0, { action: 'deleted', entity_id: 'gone', changes: { title: ['Old milestone', null] } })])
    renderTab()
    expect(await screen.findByText('Removed milestone “Old milestone”')).toBeInTheDocument()
  })

  it('offers Load older only while pages are full, using the last row as the cursor', async () => {
    const first = Array.from({ length: 50 }, (_, i) => row(i))
    const second = [row(50, { id: 'older', plan_change: false })]
    vi.mocked(listActivity).mockResolvedValueOnce(first).mockResolvedValueOnce(second)
    renderTab()
    const more = await screen.findByRole('button', { name: 'Load older' })
    expect(listActivity).toHaveBeenCalledWith('p1', { before: undefined })
    await userEvent.click(more)
    await waitFor(() => expect(listActivity).toHaveBeenCalledWith('p1', { before: first[49].created_at }))
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Load older' })).not.toBeInTheDocument())
    expect(screen.getAllByRole('listitem')).toHaveLength(51)
  })

  it('does not offer Load older when the first page is short', async () => {
    vi.mocked(listActivity).mockResolvedValue([row(0)])
    renderTab()
    await screen.findByRole('listitem')
    expect(screen.queryByRole('button', { name: 'Load older' })).not.toBeInTheDocument()
  })

  it('shows the admin who acknowledged a plan change and when', async () => {
    const at = new Date(2026, 10, 6, 14, 2).toISOString() // local time, so the expected text is timezone-proof
    vi.mocked(listActivity).mockResolvedValue([row(0, { plan_change: true, acks: [{ user_id: 'c1', acked_at: at, acker_name: 'Ana' }] })])
    renderTab('admin')
    expect(await screen.findByText('Acknowledged by Ana · Nov 6, 14:02')).toBeInTheDocument()
  })

  it('shows the admin Not yet acknowledged when nobody has', async () => {
    vi.mocked(listActivity).mockResolvedValue([row(0, { plan_change: true })])
    renderTab('admin')
    expect(await screen.findByText('Not yet acknowledged')).toBeInTheDocument()
  })

  it('shows no acknowledgement lines on rows that are not plan changes', async () => {
    vi.mocked(listActivity).mockResolvedValue([row(0, { plan_change: false })])
    renderTab('admin')
    await screen.findByRole('listitem')
    expect(screen.queryByText('Not yet acknowledged')).not.toBeInTheDocument()
  })

  it('does not show acknowledgement lines to clients', async () => {
    vi.mocked(listActivity).mockResolvedValue([row(0, { plan_change: true })])
    renderTab('client')
    await screen.findByRole('listitem')
    expect(screen.queryByText('Not yet acknowledged')).not.toBeInTheDocument()
    expect(screen.queryByText(/Acknowledged by/)).not.toBeInTheDocument()
  })
})
