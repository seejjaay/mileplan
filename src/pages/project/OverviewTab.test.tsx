import { render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import type { Session } from '@supabase/supabase-js'
import { AuthContext } from '../../auth/AuthProvider'
import { ToastProvider } from '../../ui/Toast'
import { listMilestones, type Milestone } from '../../api/milestones'
import type { ProjectSummary } from '../../api/projects'
import OverviewTab from './OverviewTab'

vi.mock('../../api/milestones', async (orig) => ({ ...(await orig<typeof import('../../api/milestones')>()), listMilestones: vi.fn() }))
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

function renderTab(p: ProjectSummary, role: 'admin' | 'client' = 'admin') {
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
          <MemoryRouter>
            <OverviewTab project={p} />
          </MemoryRouter>
        </AuthContext.Provider>
      </ToastProvider>
    </QueryClientProvider>,
  )
}

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
    expect(screen.getByText('Approved')).toBeInTheDocument()
    expect(screen.getByText('In review')).toBeInTheDocument()
    expect(screen.getByText('On hold')).toBeInTheDocument()
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
})
