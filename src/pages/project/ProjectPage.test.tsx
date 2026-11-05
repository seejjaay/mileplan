import { render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import type { Session } from '@supabase/supabase-js'
import { AuthContext } from '../../auth/AuthProvider'
import { ToastProvider } from '../../ui/Toast'
import { getProject, type ProjectSummary } from '../../api/projects'
import ProjectPage from './ProjectPage'

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
}

function renderAt(path: string) {
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <ToastProvider>
        <AuthContext.Provider
          value={{
            session: { user: { id: 'u1' } } as Session,
            profile: { id: 'u1', role: 'admin', full_name: 'CJ', active: true },
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
})
