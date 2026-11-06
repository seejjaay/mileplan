import { render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { listProjects, type ProjectSummary } from '../../api/projects'
import MyProjectsPage from './MyProjectsPage'

vi.mock('../../api/projects', async (orig) => ({ ...(await orig<typeof import('../../api/projects')>()), listProjects: vi.fn() }))

const base: ProjectSummary = {
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

function renderPage() {
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={['/']}>
        <Routes>
          <Route path="/" element={<MyProjectsPage />} />
          <Route path="/projects/:id" element={<p>Project page</p>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

afterEach(() => vi.clearAllMocks())

describe('MyProjectsPage', () => {
  it('goes straight to the project when there is exactly one', async () => {
    vi.mocked(listProjects).mockResolvedValue([base])
    renderPage()
    expect(await screen.findByText('Project page')).toBeInTheDocument()
  })

  it('lists cards when there are several', async () => {
    vi.mocked(listProjects).mockResolvedValue([base, { ...base, id: 'p2', title: 'App' }])
    renderPage()
    expect(await screen.findByRole('link', { name: /Website rebuild/ })).toHaveAttribute('href', '/projects/p1')
    expect(screen.getByRole('link', { name: /App/ })).toBeInTheDocument()
  })

  it('shows the empty copy only after an empty result', async () => {
    vi.mocked(listProjects).mockResolvedValue([])
    renderPage()
    expect(screen.queryByText(/No projects yet/)).not.toBeInTheDocument()
    expect(await screen.findByText('No projects yet — CJ will add you once your project starts.')).toBeInTheDocument()
  })
})

describe('MyProjectsPage payments', () => {
  it('cards show the outstanding amount and the overdue count', async () => {
    vi.mocked(listProjects).mockResolvedValue([
      { ...base, scheduled: 3000, paid: 1000, outstanding: 2000, overdue: 1 },
      { ...base, id: 'p2', title: 'App', scheduled: 0, paid: 0, outstanding: 0, overdue: 0 },
    ])
    renderPage()
    const card = await screen.findByRole('link', { name: /Website rebuild/ })
    expect(card).toHaveTextContent('Outstanding ₱2,000.00')
    expect(card).toHaveTextContent('1 overdue')
    expect(screen.getByRole('link', { name: /App/ })).not.toHaveTextContent('Outstanding')
  })
})
