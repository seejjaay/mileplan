import { render, screen, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import { listProjects, type ProjectSummary } from '../../api/projects'
import { unreadCounts } from '../../api/messages'
import DashboardPage from './DashboardPage'

vi.mock('../../api/messages', async (orig) => ({ ...(await orig<typeof import('../../api/messages')>()), unreadCounts: vi.fn() }))
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
  percent: 40,
  nextDue: null,
  scheduled: 0,
  paid: 0,
  outstanding: 0,
  overdue: 0,
}

function renderPage() {
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter>
        <DashboardPage />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

beforeEach(() => vi.mocked(unreadCounts).mockResolvedValue({}))
afterEach(() => vi.clearAllMocks())

describe('DashboardPage', () => {
  it('dashboard card shows outstanding and the overdue count', async () => {
    vi.mocked(listProjects).mockResolvedValue([{ ...base, scheduled: 3000, paid: 1000, outstanding: 2000, overdue: 2 }])
    renderPage()
    const card = await screen.findByRole('link', { name: /Website rebuild/ })
    expect(card).toHaveTextContent('Outstanding ₱2,000.00')
    expect(card).toHaveTextContent('2 overdue')
  })

  it('omits the overdue count when nothing is overdue', async () => {
    vi.mocked(listProjects).mockResolvedValue([{ ...base, scheduled: 3000, paid: 1000, outstanding: 2000, overdue: 0 }])
    renderPage()
    const card = await screen.findByRole('link', { name: /Website rebuild/ })
    expect(card).toHaveTextContent('Outstanding ₱2,000.00')
    expect(card).not.toHaveTextContent('overdue')
  })

  it('shows no money line for a project with nothing scheduled', async () => {
    vi.mocked(listProjects).mockResolvedValue([base])
    renderPage()
    expect(await screen.findByRole('link', { name: /Website rebuild/ })).not.toHaveTextContent('Outstanding')
  })

  it('shows the unread count on the card, and no badge for a project without any', async () => {
    vi.mocked(listProjects).mockResolvedValue([base, { ...base, id: 'p2', title: 'App' }])
    vi.mocked(unreadCounts).mockResolvedValue({ p1: 3 })
    renderPage()
    const card = await screen.findByRole('link', { name: /Website rebuild/ })
    expect(await within(card).findByLabelText('3 unread')).toHaveTextContent('3')
    expect(within(screen.getByRole('link', { name: /App/ })).queryByLabelText(/unread/)).not.toBeInTheDocument()
  })
})
