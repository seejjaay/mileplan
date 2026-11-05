import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { Session } from '@supabase/supabase-js'
import { AuthContext } from '../../auth/AuthProvider'
import { ToastProvider } from '../../ui/Toast'
import { acknowledge, listPlanChanges, unacknowledged, type PlanChange } from '../../api/planChanges'
import { listDocuments } from '../../api/documents'
import { listMilestones, type Milestone } from '../../api/milestones'
import type { ProjectSummary } from '../../api/projects'
import { PlanChangeBanner } from './PlanChangeBanner'

vi.mock('../../api/planChanges', async (orig) => ({
  ...(await orig<typeof import('../../api/planChanges')>()),
  listPlanChanges: vi.fn(),
  acknowledge: vi.fn(),
}))
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
}

const change = (id: string, over: Partial<PlanChange> = {}): PlanChange => ({
  id,
  project_id: 'p1',
  actor_id: 'admin',
  entity: 'milestone',
  entity_id: 'm1',
  action: 'updated',
  changes: { due_date: ['2026-12-01', '2026-12-15'] },
  reason: null,
  plan_change: true,
  created_at: '2026-11-05T08:00:00Z',
  actor_name: 'CJ',
  acks: [],
  ...over,
})

function renderBanner(role: 'admin' | 'client' = 'client') {
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <ToastProvider>
        <AuthContext.Provider
          value={{
            session: { user: { id: 'u1' } } as Session,
            profile: { id: 'u1', role, full_name: 'Eve', active: true },
            loading: false,
            signOut: async () => {},
          }}
        >
          <PlanChangeBanner project={project} />
        </AuthContext.Provider>
      </ToastProvider>
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  vi.mocked(listMilestones).mockResolvedValue([{ id: 'm1', title: 'Build', tasks: [] } as unknown as Milestone])
  vi.mocked(listDocuments).mockResolvedValue([])
  vi.mocked(acknowledge).mockResolvedValue()
})
afterEach(() => vi.clearAllMocks())

describe('unacknowledged', () => {
  it('keeps only the changes this user has not acknowledged', () => {
    const mine = change('a', { acks: [{ user_id: 'u1', acked_at: '2026-11-05T09:00:00Z' }] })
    const theirs = change('b', { acks: [{ user_id: 'someone-else', acked_at: '2026-11-05T09:00:00Z' }] })
    expect(unacknowledged([mine, theirs, change('c')], 'u1').map((c) => c.id)).toEqual(['b', 'c'])
  })
})

describe('PlanChangeBanner', () => {
  it('is hidden for the admin, and does not even load plan changes', async () => {
    vi.mocked(listPlanChanges).mockResolvedValue([change('a')])
    renderBanner('admin')
    await new Promise((r) => setTimeout(r, 50))
    expect(screen.queryByRole('region', { name: 'The plan changed' })).not.toBeInTheDocument()
    expect(listPlanChanges).not.toHaveBeenCalled()
  })

  it('is hidden when everything is acknowledged', async () => {
    vi.mocked(listPlanChanges).mockResolvedValue([change('a', { acks: [{ user_id: 'u1', acked_at: '2026-11-05T09:00:00Z' }] })])
    renderBanner()
    await waitFor(() => expect(listPlanChanges).toHaveBeenCalled())
    expect(screen.queryByRole('region', { name: 'The plan changed' })).not.toBeInTheDocument()
  })

  it('lists each unacknowledged change in plain words, with its reason', async () => {
    vi.mocked(listPlanChanges).mockResolvedValue([
      change('a', { reason: 'client asked to add a login screen' }),
      change('b', { action: 'created', entity_id: 'm2', changes: { title: [null, 'Launch'] } }),
    ])
    renderBanner()
    const region = within(await screen.findByRole('region', { name: 'The plan changed' }))
    expect(region.getByText('Milestone “Build” — Due date: Dec 1, 2026 → Dec 15, 2026. Reason: client asked to add a login screen')).toBeInTheDocument()
    expect(region.getByText('Added milestone “Launch”')).toBeInTheDocument()
  })

  it('Acknowledge sends exactly the displayed ids for this user, then toasts', async () => {
    vi.mocked(listPlanChanges).mockResolvedValue([change('a'), change('b')])
    renderBanner()
    await userEvent.click(await screen.findByRole('button', { name: 'Acknowledge' }))
    await waitFor(() => expect(acknowledge).toHaveBeenCalledWith('u1', ['a', 'b']))
    expect(await screen.findByText('Changes acknowledged')).toBeInTheDocument()
  })

  it('a change that arrives after the click stays in the banner', async () => {
    vi.mocked(listPlanChanges)
      .mockResolvedValueOnce([change('a')])
      // after the acknowledge the server has A acked and a brand-new B
      .mockResolvedValue([change('a', { acks: [{ user_id: 'u1', acked_at: '2026-11-05T09:00:00Z' }] }), change('b')])
    renderBanner()
    await userEvent.click(await screen.findByRole('button', { name: 'Acknowledge' }))
    await waitFor(() => expect(acknowledge).toHaveBeenCalledWith('u1', ['a']))
    const region = within(await screen.findByRole('region', { name: 'The plan changed' }))
    await waitFor(() => expect(region.getAllByRole('listitem')).toHaveLength(1))
  })
})
