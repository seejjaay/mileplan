import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import type { Session } from '@supabase/supabase-js'
import { AuthContext } from '../../auth/AuthProvider'
import { ToastProvider } from '../../ui/Toast'
import { listMilestones, type Milestone } from '../../api/milestones'
import { listPlanChanges, type PlanChange } from '../../api/planChanges'
import { listPaymentRequests } from '../../api/payments'
import type { ProjectSummary } from '../../api/projects'
import { ChangeMarkersContext } from './changeMarkers'
import OverviewTab from './OverviewTab'

vi.mock('../../api/milestones', async (orig) => ({ ...(await orig<typeof import('../../api/milestones')>()), listMilestones: vi.fn() }))
vi.mock('../../api/planChanges', async (orig) => ({ ...(await orig<typeof import('../../api/planChanges')>()), listPlanChanges: vi.fn() }))
vi.mock('../../api/payments', async (orig) => ({ ...(await orig<typeof import('../../api/payments')>()), listPaymentRequests: vi.fn() }))
vi.mock('../../api/clients', () => ({ createClient: vi.fn() }))
vi.mock('../../api/projects', async (orig) => ({ ...(await orig<typeof import('../../api/projects')>()), activateProject: vi.fn() }))

const project: ProjectSummary = {
  id: 'p1',
  title: 'Website rebuild',
  summary: null,
  status: 'setup',
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

const ms = (over: Partial<Milestone>): Milestone => ({
  id: 'm',
  project_id: 'p1',
  position: 1,
  title: 'M',
  description: null,
  acceptance_criteria: [],
  due_date: null,
  amount: 0,
  status: 'planned',
  on_hold: false,
  plan_key: null,
  approved_at: null,
  approved_by: null,
  tasks: [],
  ...over,
})

function renderTab(p: ProjectSummary, role: 'admin' | 'client' = 'admin', marked: string[] = []) {
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <ToastProvider>
        <AuthContext.Provider
          value={{
            session: { user: { id: 'u1' } } as Session,
            profile: { id: 'u1', role, full_name: 'X', active: true },
            loading: false,
            signOut: async () => {},
          }}
        >
          <ChangeMarkersContext.Provider value={{ milestones: new Set(marked), tabs: new Set(), tick: null }}>
            <MemoryRouter>
              <OverviewTab project={p} />
            </MemoryRouter>
          </ChangeMarkersContext.Provider>
        </AuthContext.Provider>
      </ToastProvider>
    </QueryClientProvider>,
  )
}

const pending = (id: string, acks: PlanChange['acks'] = []): PlanChange => ({
  id,
  project_id: 'p1',
  actor_id: 'admin',
  entity: 'milestone',
  entity_id: 'a',
  action: 'updated',
  changes: { due_date: ['2026-12-01', '2026-12-15'] },
  reason: 'scope grew',
  plan_change: true,
  created_at: '2026-11-05T08:00:00Z',
  actor_name: 'CJ',
  acks,
})

beforeEach(() => {
  vi.mocked(listPlanChanges).mockResolvedValue([])
  vi.mocked(listPaymentRequests).mockResolvedValue([])
})
afterEach(() => vi.clearAllMocks())

describe('OverviewTab', () => {
  it('sums milestone amounts as the contract value in the project currency', async () => {
    vi.mocked(listMilestones).mockResolvedValue([ms({ id: 'a', amount: 15000 }), ms({ id: 'b', position: 2, amount: 5000.5 })])
    renderTab(project)
    expect(await screen.findByText('₱20,000.50')).toBeInTheDocument()
  })

  it('prints a status word for every milestone in the strip', async () => {
    vi.mocked(listMilestones).mockResolvedValue([
      ms({ id: 'a', title: 'Discovery', status: 'approved' }),
      ms({ id: 'b', position: 2, title: 'Build', status: 'in_review' }),
      ms({ id: 'c', position: 3, title: 'Launch', status: 'planned', on_hold: true }),
    ])
    renderTab(project)
    expect(await screen.findByText('Discovery')).toBeInTheDocument()
    expect(screen.getByText('Done')).toBeInTheDocument()
    expect(screen.getByText('In review')).toBeInTheDocument()
    expect(screen.getByText('On hold')).toBeInTheDocument()
    expect(screen.getByRole('list', { name: 'Milestone route' })).toBeInTheDocument()
  })

  it('shows the empty copy only after an empty result', async () => {
    vi.mocked(listMilestones).mockResolvedValue([])
    renderTab(project)
    expect(screen.queryByText('No milestones yet. Add the first one.')).not.toBeInTheDocument()
    expect(await screen.findByText('No milestones yet. Add the first one.')).toBeInTheDocument()
  })

  it('offers Add client & activate to the admin while in setup', async () => {
    vi.mocked(listMilestones).mockResolvedValue([])
    renderTab(project)
    expect(await screen.findByRole('button', { name: 'Add client & activate' })).toBeInTheDocument()
  })

  it('hides Add client & activate once the project is active', async () => {
    vi.mocked(listMilestones).mockResolvedValue([])
    renderTab({ ...project, status: 'active' })
    await screen.findByText('No milestones yet. Add the first one.')
    expect(screen.queryByRole('button', { name: 'Add client & activate' })).not.toBeInTheDocument()
  })

  it('never offers Add client & activate to a client', async () => {
    vi.mocked(listMilestones).mockResolvedValue([])
    renderTab(project, 'client')
    await screen.findByText('No milestones yet. Add the first one.')
    expect(screen.queryByRole('button', { name: 'Add client & activate' })).not.toBeInTheDocument()
  })

  it('lists plan changes nobody has acknowledged yet for the admin', async () => {
    vi.mocked(listMilestones).mockResolvedValue([ms({ id: 'a', title: 'Discovery' })])
    vi.mocked(listPlanChanges).mockResolvedValue([pending('x'), pending('y', [{ user_id: 'c1', acked_at: '2026-11-05T09:00:00Z', acker_name: 'Ana' }])])
    renderTab({ ...project, status: 'active' })
    const section = await screen.findByRole('region', { name: 'Pending acknowledgements' })
    expect(section).toHaveTextContent('Milestone “Discovery” — Due date: Dec 1, 2026 → Dec 15, 2026. Reason: scope grew')
    expect(section.querySelectorAll('li')).toHaveLength(1) // the acknowledged one is not pending
  })

  it('does not render the pending section when there is nothing pending', async () => {
    vi.mocked(listMilestones).mockResolvedValue([])
    renderTab({ ...project, status: 'active' })
    await screen.findByText('No milestones yet. Add the first one.')
    expect(screen.queryByRole('region', { name: 'Pending acknowledgements' })).not.toBeInTheDocument()
  })

  it('never shows pending acknowledgements to a client', async () => {
    vi.mocked(listMilestones).mockResolvedValue([])
    vi.mocked(listPlanChanges).mockResolvedValue([pending('x')])
    renderTab({ ...project, status: 'active' }, 'client')
    await screen.findByText('No milestones yet. Add the first one.')
    expect(screen.queryByRole('region', { name: 'Pending acknowledgements' })).not.toBeInTheDocument()
  })

  it('flags a milestone in the strip that changed since the last visit', async () => {
    vi.mocked(listMilestones).mockResolvedValue([ms({ id: 'a', title: 'Discovery' }), ms({ id: 'b', position: 2, title: 'Build' })])
    renderTab({ ...project, status: 'active' }, 'client', ['b'])
    await screen.findByText('Build')
    expect(screen.getAllByText('Updated')).toHaveLength(1)
  })
})

describe('OverviewTab payments', () => {
  const req = (over: object) => ({
    id: 'r1',
    project_id: 'p1',
    milestone_id: null,
    title: '50% deposit',
    amount: 1000,
    due_date: '2999-01-01',
    created_at: '2026-11-01T00:00:00Z',
    payments: [],
    ...over,
  })

  it('overview shows paid and outstanding in PHP, and the next payment', async () => {
    vi.mocked(listMilestones).mockResolvedValue([ms({ id: 'a', amount: 3000 })])
    vi.mocked(listPaymentRequests).mockResolvedValue([
      req({ payments: [{ id: 'x', request_id: 'r1', amount: 400, status: 'confirmed' }] }),
    ] as never)
    renderTab(project)
    const paid = (await screen.findByText('Paid')).closest('div')!
    expect(await within(paid).findByText('₱400.00')).toBeInTheDocument()
    expect(within(screen.getByText('Outstanding').closest('div')!).getByText('₱600.00')).toBeInTheDocument()
    expect(screen.getByText('Next payment: 50% deposit · ₱600.00 · due Jan 1, 2999')).toBeInTheDocument()
  })

  it('says Overdue instead of a date when the next payment is late, and counts them', async () => {
    vi.mocked(listMilestones).mockResolvedValue([])
    vi.mocked(listPaymentRequests).mockResolvedValue([req({ title: 'Balance', amount: 2000, due_date: '2000-01-01' })] as never)
    renderTab(project)
    expect(await screen.findByText('Next payment: Balance · ₱2,000.00 · Overdue')).toBeInTheDocument()
    expect(screen.getByText('1 overdue')).toBeInTheDocument()
  })

  it('shows no next-payment line when everything is paid', async () => {
    vi.mocked(listMilestones).mockResolvedValue([])
    vi.mocked(listPaymentRequests).mockResolvedValue([
      req({ payments: [{ id: 'x', request_id: 'r1', amount: 1000, status: 'confirmed' }] }),
    ] as never)
    renderTab(project)
    expect(await within((await screen.findByText('Outstanding')).closest('div')!).findByText('₱0.00')).toBeInTheDocument()
    expect(screen.queryByText(/Next payment/)).not.toBeInTheDocument()
  })
})

describe('OverviewTab close and reopen', () => {
  const active = { ...project, status: 'active' as const }
  const closed = { ...project, status: 'completed' as const, closed_at: '2026-11-10T08:00:00Z' }

  beforeEach(() => {
    vi.mocked(listMilestones).mockResolvedValue([])
  })

  it('offers Close project to the admin of an active project, and opens the dialog', async () => {
    renderTab(active)
    await userEvent.click(await screen.findByRole('button', { name: 'Close project' }))
    expect(await screen.findByRole('dialog')).toBeInTheDocument()
  })

  it.each([
    ['setup', 'admin'],
    ['active', 'client'],
  ] as const)('does not offer Close project on a %s project to the %s', async (status, role) => {
    renderTab({ ...project, status }, role)
    expect(await screen.findByText('Contract value')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Close project' })).not.toBeInTheDocument()
  })

  it('offers Reopen project, and not Close project, to the admin of a closed project', async () => {
    renderTab(closed)
    expect(await screen.findByRole('button', { name: 'Reopen project' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Close project' })).not.toBeInTheDocument()
  })

  it('does not offer Reopen project to the client', async () => {
    renderTab(closed, 'client')
    expect(await screen.findByText('Contract value')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Reopen project' })).not.toBeInTheDocument()
  })
})
