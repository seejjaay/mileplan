import { screen, waitFor, within } from '@testing-library/react'
import { closeProject, reopenProject } from '../../api/projects'
import { CloseProjectDialog, ReopenProjectDialog } from './CloseProjectDialog'
import { project, renderWithProviders } from './payments/testkit'

vi.mock('../../api/projects', async (orig) => ({
  ...(await orig<typeof import('../../api/projects')>()),
  closeProject: vi.fn(),
  reopenProject: vi.fn(),
}))

beforeEach(() => {
  vi.mocked(closeProject).mockResolvedValue()
  vi.mocked(reopenProject).mockResolvedValue()
})
afterEach(() => vi.clearAllMocks())

describe('CloseProjectDialog', () => {
  it('requires an outcome, then calls close_project with it', async () => {
    const { user } = renderWithProviders(<CloseProjectDialog open onClose={() => {}} project={project()} />)
    const dialog = await screen.findByRole('dialog')
    const confirm = within(dialog).getByRole('button', { name: 'Close project' })
    expect(confirm).toBeDisabled()
    await user.click(within(dialog).getByRole('radio', { name: 'Completed' }))
    expect(confirm).toBeEnabled()
    await user.click(confirm)
    await waitFor(() => expect(closeProject).toHaveBeenCalledWith('p1', 'completed', undefined))
    expect(await screen.findByText('Project closed')).toBeInTheDocument()
  })

  it('sends Terminated with the optional reason', async () => {
    const { user } = renderWithProviders(<CloseProjectDialog open onClose={() => {}} project={project()} />)
    const dialog = await screen.findByRole('dialog')
    await user.click(within(dialog).getByRole('radio', { name: 'Terminated' }))
    await user.type(within(dialog).getByLabelText('Reason (optional)'), 'Client stopped responding')
    await user.click(within(dialog).getByRole('button', { name: 'Close project' }))
    await waitFor(() => expect(closeProject).toHaveBeenCalledWith('p1', 'terminated', 'Client stopped responding'))
  })

  it('warns that the tracker becomes read-only', async () => {
    renderWithProviders(<CloseProjectDialog open onClose={() => {}} project={project()} />)
    expect(await screen.findByText(/read-only/)).toBeInTheDocument()
  })

  it('shows the server message when closing is refused', async () => {
    vi.mocked(closeProject).mockRejectedValue({ code: '22023', message: 'a completed project cannot be closed' })
    const { user } = renderWithProviders(<CloseProjectDialog open onClose={() => {}} project={project()} />)
    const dialog = await screen.findByRole('dialog')
    await user.click(within(dialog).getByRole('radio', { name: 'Completed' }))
    await user.click(within(dialog).getByRole('button', { name: 'Close project' }))
    expect(await screen.findByText('a completed project cannot be closed')).toBeInTheDocument()
  })
})

describe('ReopenProjectDialog', () => {
  it('asks to confirm before reopening', async () => {
    const { user } = renderWithProviders(<ReopenProjectDialog open onClose={() => {}} project={project('completed')} />)
    const dialog = await screen.findByRole('dialog')
    expect(reopenProject).not.toHaveBeenCalled()
    await user.type(within(dialog).getByLabelText('Reason (optional)'), 'One more change')
    await user.click(within(dialog).getByRole('button', { name: 'Reopen project' }))
    await waitFor(() => expect(reopenProject).toHaveBeenCalledWith('p1', 'One more change'))
    expect(await screen.findByText('Project reopened')).toBeInTheDocument()
  })

  it('cancel does nothing', async () => {
    const onClose = vi.fn()
    const { user } = renderWithProviders(<ReopenProjectDialog open onClose={onClose} project={project('completed')} />)
    await user.click(await screen.findByRole('button', { name: 'Cancel' }))
    expect(onClose).toHaveBeenCalled()
    expect(reopenProject).not.toHaveBeenCalled()
  })
})
