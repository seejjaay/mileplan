import { render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import type { Session } from '@supabase/supabase-js'
import { AuthContext } from '../../auth/AuthProvider'
import { ToastProvider } from '../../ui/Toast'
import { getProject, type ProjectSummary } from '../../api/projects'
import ProjectPage from './ProjectPage'

vi.mock('../../api/planChanges', async (orig) => ({ ...(await orig<typeof import('../../api/planChanges')>()), listPlanChanges: vi.fn(async () => [{ id: 'a', project_id: 'p1', actor_id: 'x', entity: 'milestone', entity_id: 'm1', action: 'updated', changes: { due_date: ['2026-12-01', '2026-12-15'] }, reason: null, plan_change: true, created_at: '2026-11-05T08:00:00Z', actor_name: null, acks: [] }]), acknowledge: vi.fn() }))
vi.mock('./useProjectMarkers', () => ({ useProjectMarkers: () => ({ milestones: new Set(['m1']), tabs: new Set(['updates', 'milestones']) }) }))
vi.mock('../../realtime/useProjectRealtime', () => ({ useProjectRealtime: () => ({ connected: true, reconnecting: false, lastChange: null }) }))
vi.mock('../../api/projects', async (orig) => ({ ...(await orig<typeof import('../../api/projects')>()), getProject: vi.fn() }))

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
  percent: 40,
  nextDue: null,
  scheduled: 0,
  paid: 0,
  outstanding: 0,
  overdue: 0,
}

function renderAt(path: string, role: 'admin' | 'client' = 'admin') {
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <ToastProvider>
        <AuthContext.Provider
          value={{
            session: { user: { id: 'u1' } } as Session,
            profile: { id: 'u1', role, full_name: 'CJ', active: true },
            loading: false,
            signOut: async () => {},
          }}
        >
          <MemoryRouter initialEntries={[path]}>
            <Routes>
              <Route path="/projects/:id/:tab?" element={<ProjectPage />} />
            </Routes>
          </MemoryRouter>
        </AuthContext.Provider>
      </ToastProvider>
    </QueryClientProvider>,
  )
}

afterEach(() => vi.clearAllMocks())

describe('ProjectPage', () => {
  it('shows title, status word and percent complete', async () => {
    vi.mocked(getProject).mockResolvedValue(project)
    renderAt('/projects/p1')
    expect(await screen.findByRole('heading', { name: 'Website rebuild', level: 1 })).toBeInTheDocument()
    expect(screen.getByText('Active')).toBeInTheDocument()
    expect(screen.getByText('40% complete')).toBeInTheDocument()
  })

  it('falls back to overview for an unknown tab', async () => {
    vi.mocked(getProject).mockResolvedValue(project)
    renderAt('/projects/p1/bogus')
    expect(await screen.findByRole('link', { name: 'Overview' })).toHaveAttribute('aria-current', 'page')
  })

  it('marks the requested tab as current', async () => {
    vi.mocked(getProject).mockResolvedValue(project)
    renderAt('/projects/p1/timeline')
    expect(await screen.findByRole('link', { name: 'Timeline' })).toHaveAttribute('aria-current', 'page')
  })

  it("shows the no-access copy when the project cannot be read", async () => {
    vi.mocked(getProject).mockRejectedValue({ code: '42501', message: 'denied' })
    renderAt('/projects/p1')
    expect(await screen.findByRole('alert')).toHaveTextContent("You don't have access to this")
  })

  it('shows the plan-change banner to a client on every tab, and never to the admin', async () => {
    vi.mocked(getProject).mockResolvedValue(project)
    renderAt('/projects/p1/files', 'client')
    expect(await screen.findByRole('region', { name: 'The plan changed' })).toBeInTheDocument()
  })

  it('does not show the banner to the admin', async () => {
    vi.mocked(getProject).mockResolvedValue(project)
    renderAt('/projects/p1/files', 'admin')
    await screen.findByRole('heading', { name: 'Website rebuild', level: 1 })
    expect(screen.queryByRole('region', { name: 'The plan changed' })).not.toBeInTheDocument()
  })

  it('flags changed tabs for screen readers, but not the tab you are already on', async () => {
    vi.mocked(getProject).mockResolvedValue(project)
    renderAt('/projects/p1/milestones', 'client')
    expect(await screen.findByRole('link', { name: 'Updates (updated)' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Milestones' })).toHaveAttribute('aria-current', 'page') // no "(updated)" on the current tab
    expect(screen.getByRole('link', { name: 'Files' })).toBeInTheDocument()
  })
})

describe('ProjectPage when the project is closed', () => {
  it.each(['/projects/p1', '/projects/p1/files'])('shows the closed banner on %s', async (path) => {
    vi.mocked(getProject).mockResolvedValue({ ...project, status: 'terminated', closed_at: '2026-11-12T08:00:00Z' })
    renderAt(path)
    expect(await screen.findByText('This project was terminated on Nov 12, 2026 and is read-only.')).toBeInTheDocument()
  })

  it('shows no banner on an active project', async () => {
    vi.mocked(getProject).mockResolvedValue(project)
    renderAt('/projects/p1')
    await screen.findByRole('heading', { name: 'Website rebuild', level: 1 })
    expect(screen.queryByText(/is read-only/)).not.toBeInTheDocument()
  })
})
