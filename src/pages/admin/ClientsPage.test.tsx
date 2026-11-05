import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ToastProvider } from '../../ui/Toast'
import { listClients, regenerateLink, setClientActive, type ClientRow } from '../../api/clients'
import ClientsPage from './ClientsPage'

vi.mock('../../api/clients', () => ({
  listClients: vi.fn(),
  createClient: vi.fn(),
  regenerateLink: vi.fn(),
  setClientActive: vi.fn(),
}))

const cara: ClientRow = { id: 'u1', full_name: 'Cara Cruz', email: 'cara@client-c.test', company: 'Cruz Co', active: true }

function renderPage() {
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <ToastProvider>
        <ClientsPage />
      </ToastProvider>
    </QueryClientProvider>,
  )
}

afterEach(() => vi.clearAllMocks())

describe('ClientsPage', () => {
  it('shows loading, then the empty state only after an empty result', async () => {
    vi.mocked(listClients).mockResolvedValue([])
    renderPage()
    expect(screen.getByRole('status', { name: 'Loading' })).toBeInTheDocument()
    expect(screen.queryByText('No clients yet.')).not.toBeInTheDocument()
    expect(await screen.findByText('No clients yet.')).toBeInTheDocument()
  })

  it('shows an error with Retry', async () => {
    vi.mocked(listClients).mockRejectedValueOnce(new Error('Boom')).mockResolvedValueOnce([cara])
    renderPage()
    expect(await screen.findByRole('alert')).toHaveTextContent('Boom')
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(await screen.findByRole('cell', { name: 'Cara Cruz' })).toBeInTheDocument()
  })

  it('lists clients with a status word', async () => {
    vi.mocked(listClients).mockResolvedValue([cara, { ...cara, id: 'u2', full_name: 'Dan Diaz', active: false }])
    renderPage()
    expect(await screen.findByText('Active')).toBeInTheDocument()
    expect(screen.getByText('Deactivated')).toBeInTheDocument()
  })

  it('deactivates only after confirming, and toasts', async () => {
    vi.mocked(listClients).mockResolvedValue([cara])
    vi.mocked(setClientActive).mockResolvedValue()
    renderPage()
    await userEvent.click(await screen.findByRole('button', { name: /Deactivate/ }))
    expect(setClientActive).not.toHaveBeenCalled()
    await userEvent.click(screen.getByRole('button', { name: 'Confirm deactivate' }))
    await waitFor(() => expect(setClientActive).toHaveBeenCalledWith('u1', false))
    expect(await screen.findByText('Cara Cruz deactivated')).toBeInTheDocument()
  })

  it('regenerates a link and shows it', async () => {
    vi.mocked(listClients).mockResolvedValue([cara])
    vi.mocked(regenerateLink).mockResolvedValue('http://localhost:5173/setup#token=new')
    renderPage()
    await userEvent.click(await screen.findByRole('button', { name: /Regenerate link/ }))
    expect(await screen.findByDisplayValue('http://localhost:5173/setup#token=new')).toBeInTheDocument()
  })
})
