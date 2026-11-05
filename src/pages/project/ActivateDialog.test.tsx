import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ToastProvider } from '../../ui/Toast'
import { createClient } from '../../api/clients'
import { activateProject } from '../../api/projects'
import { ActivateDialog } from './ActivateDialog'

vi.mock('../../api/clients', () => ({ createClient: vi.fn() }))
vi.mock('../../api/projects', () => ({ activateProject: vi.fn() }))

function renderDialog() {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <ToastProvider>
        <ActivateDialog projectId="p1" open onClose={() => {}} />
      </ToastProvider>
    </QueryClientProvider>,
  )
}

async function fillAndSubmit() {
  await userEvent.type(screen.getByLabelText('Full name'), 'Dee Diaz')
  await userEvent.type(screen.getByLabelText('Email'), 'dee@client-d.test')
  await userEvent.click(screen.getByRole('button', { name: 'Add client & activate' }))
}

afterEach(() => vi.clearAllMocks())

describe('ActivateDialog', () => {
  it('links the client to the project, then activates it', async () => {
    vi.mocked(createClient).mockResolvedValue({ user_id: 'u1', setup_url: 'http://localhost:5173/setup#token=abc', linked_existing: false })
    vi.mocked(activateProject).mockResolvedValue()
    renderDialog()
    await fillAndSubmit()
    expect(await screen.findByDisplayValue('http://localhost:5173/setup#token=abc')).toBeInTheDocument()
    expect(createClient).toHaveBeenCalledWith(expect.objectContaining({ email: 'dee@client-d.test', project_id: 'p1' }))
    expect(activateProject).toHaveBeenCalledWith('p1')
    expect(screen.getByText('Project activated')).toBeInTheDocument()
  })

  it('keeps the link and retries only the activation when activating fails', async () => {
    vi.mocked(createClient).mockResolvedValue({ user_id: 'u1', setup_url: 'http://localhost:5173/setup#token=abc', linked_existing: false })
    vi.mocked(activateProject).mockRejectedValueOnce(new Error('Network down')).mockResolvedValueOnce()
    renderDialog()
    await fillAndSubmit()
    expect(await screen.findByRole('alert')).toHaveTextContent('Network down')
    expect(screen.getByDisplayValue('http://localhost:5173/setup#token=abc')).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Try activating again' }))
    await waitFor(() => expect(activateProject).toHaveBeenCalledTimes(2))
    expect(createClient).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('shows the already-a-client note instead of a link for an existing client', async () => {
    vi.mocked(createClient).mockResolvedValue({ user_id: 'u1', setup_url: null, linked_existing: true })
    vi.mocked(activateProject).mockResolvedValue()
    renderDialog()
    await fillAndSubmit()
    expect(await screen.findByText(/Already a client/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Copy link' })).not.toBeInTheDocument()
  })

  it('stays on the form and does not activate when creating the client fails', async () => {
    vi.mocked(createClient).mockRejectedValue(new Error('Enter a valid email address'))
    renderDialog()
    await fillAndSubmit()
    expect(await screen.findByText('Enter a valid email address')).toBeInTheDocument()
    expect(activateProject).not.toHaveBeenCalled()
    expect(screen.getByLabelText('Full name')).toHaveValue('Dee Diaz')
  })
})
