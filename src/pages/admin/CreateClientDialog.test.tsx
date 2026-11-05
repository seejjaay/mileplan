import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ToastProvider } from '../../ui/Toast'
import { createClient } from '../../api/clients'
import { CreateClientDialog } from './CreateClientDialog'

vi.mock('../../api/clients', () => ({ createClient: vi.fn() }))

function renderDialog() {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <ToastProvider>
        <CreateClientDialog open onClose={() => {}} />
      </ToastProvider>
    </QueryClientProvider>,
  )
}

async function fill(name: string, email: string) {
  await userEvent.type(screen.getByLabelText('Full name'), name)
  await userEvent.type(screen.getByLabelText('Email'), email)
}

afterEach(() => vi.clearAllMocks())

describe('CreateClientDialog', () => {
  it('Create disabled until email and name filled', async () => {
    renderDialog()
    const create = screen.getByRole('button', { name: 'Create client' })
    expect(create).toBeDisabled()
    await userEvent.type(screen.getByLabelText('Full name'), 'Cara Cruz')
    expect(create).toBeDisabled()
    await userEvent.type(screen.getByLabelText('Email'), 'cara@client-c.test')
    expect(create).toBeEnabled()
  })

  it('shows setup link with Copy button after success', async () => {
    vi.mocked(createClient).mockResolvedValue({ user_id: 'u1', setup_url: 'http://localhost:5173/setup#token=abc', linked_existing: false })
    renderDialog()
    await fill('Cara Cruz', 'cara@client-c.test')
    await userEvent.click(screen.getByRole('button', { name: 'Create client' }))
    expect(await screen.findByDisplayValue('http://localhost:5173/setup#token=abc')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Copy link' })).toBeInTheDocument()
    expect(screen.getByText('Client created')).toBeInTheDocument()
  })

  it('shows "Already a client" note when linked_existing', async () => {
    vi.mocked(createClient).mockResolvedValue({ user_id: 'u1', setup_url: null, linked_existing: true })
    renderDialog()
    await fill('Ana', 'ana@client-a.test')
    await userEvent.click(screen.getByRole('button', { name: 'Create client' }))
    expect(await screen.findByText(/Already a client/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Copy link' })).not.toBeInTheDocument()
  })

  it('keeps the form and toasts the reason when creating fails', async () => {
    vi.mocked(createClient).mockRejectedValue(new Error('Enter a valid email address'))
    renderDialog()
    await fill('Cara', 'bad')
    await userEvent.click(screen.getByRole('button', { name: 'Create client' }))
    expect(await screen.findByText('Enter a valid email address')).toBeInTheDocument()
    expect(screen.getByLabelText('Full name')).toHaveValue('Cara')
  })
})
