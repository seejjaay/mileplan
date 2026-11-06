import { screen, waitFor } from '@testing-library/react'
import { submitProof } from '../../../api/payments'
import { ProofDialog } from './ProofDialog'
import { payment, project, renderWithProviders, request } from './testkit'

vi.mock('../../../api/payments', async (orig) => ({ ...(await orig<typeof import('../../../api/payments')>()), submitProof: vi.fn() }))

const png = new File(['x'], 'proof.png', { type: 'image/png' })
const exe = new File(['x'], 'run.exe', { type: 'application/x-msdownload' })

const open = (req = request({ payments: [payment({ status: 'confirmed', amount: 400 })] })) =>
  renderWithProviders(<ProofDialog open onClose={() => {}} project={project()} request={req} />, 'client')

beforeEach(() => {
  vi.mocked(submitProof).mockResolvedValue()
})
afterEach(() => vi.clearAllMocks())

describe('ProofDialog', () => {
  it('defaults the amount to the remaining amount and paid-on to today', async () => {
    open()
    expect(await screen.findByLabelText('Amount')).toHaveValue(600)
    expect(screen.getByLabelText('Paid on')).toHaveValue(new Date().toLocaleDateString('en-CA'))
  })

  it('blocks an invalid file and keeps Upload proof disabled', async () => {
    const { user } = open()
    await user.upload(await screen.findByLabelText('Proof file'), exe)
    expect(await screen.findByText(/only images .* PDF and ZIP/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Upload proof' })).toBeDisabled()
  })

  it('submits the proof for the request and toasts', async () => {
    const { user } = open()
    await user.upload(await screen.findByLabelText('Proof file'), png)
    await user.type(screen.getByLabelText('Method'), 'GCash')
    await user.click(screen.getByRole('button', { name: 'Upload proof' }))
    await waitFor(() =>
      expect(submitProof).toHaveBeenCalledWith(
        expect.objectContaining({ projectId: 'p1', requestId: 'r1', userId: 'u1', amount: 600, method: 'GCash', file: png }),
      ),
    )
    expect(await screen.findByText('Proof uploaded')).toBeInTheDocument()
  })

  it('a double submit creates one payment', async () => {
    let finish: () => void = () => {}
    vi.mocked(submitProof).mockImplementation(() => new Promise<void>((resolve) => (finish = resolve)))
    const { user } = open()
    await user.upload(await screen.findByLabelText('Proof file'), png)
    const button = screen.getByRole('button', { name: 'Upload proof' })
    await user.dblClick(button)
    expect(submitProof).toHaveBeenCalledTimes(1)
    finish()
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Upload proof' })).toBeDisabled())
  })

  it('ignores an identical resubmission within 10 seconds', async () => {
    const { user } = open()
    await user.upload(await screen.findByLabelText('Proof file'), png)
    await user.click(screen.getByRole('button', { name: 'Upload proof' }))
    await waitFor(() => expect(submitProof).toHaveBeenCalledTimes(1))
    await user.upload(await screen.findByLabelText('Proof file'), png) // the same file again, straight away
    await user.click(screen.getByRole('button', { name: 'Upload proof' }))
    expect(submitProof).toHaveBeenCalledTimes(1)
  })

  it('shows the closed-project copy when the lock refuses it', async () => {
    vi.mocked(submitProof).mockRejectedValue({ code: 'MP001', message: 'project is closed' })
    const { user } = open()
    await user.upload(await screen.findByLabelText('Proof file'), png)
    await user.click(screen.getByRole('button', { name: 'Upload proof' }))
    expect(await screen.findByText('This project is closed. Reopen it to make changes.')).toBeInTheDocument()
  })

  it('blames the closed project when a stale tab is refused by storage', async () => {
    vi.mocked(submitProof).mockRejectedValue({ status: 403, message: 'new row violates row-level security policy' })
    const closed = { ...project('completed'), closed_at: '2026-11-10T08:00:00Z' }
    const { user } = renderWithProviders(<ProofDialog open onClose={() => {}} project={closed} request={request()} />, 'client')
    await user.upload(await screen.findByLabelText('Proof file'), png)
    await user.click(screen.getByRole('button', { name: 'Upload proof' }))
    expect(await screen.findByText('This project is closed. Reopen it to make changes.')).toBeInTheDocument()
    expect(screen.queryByText("You don't have access to this")).not.toBeInTheDocument()
  })

  it('keeps the usual message when the project is open', async () => {
    vi.mocked(submitProof).mockRejectedValue({ status: 403, message: 'new row violates row-level security policy' })
    const { user } = open()
    await user.upload(await screen.findByLabelText('Proof file'), png)
    await user.click(screen.getByRole('button', { name: 'Upload proof' }))
    expect(await screen.findByText("You don't have access to this")).toBeInTheDocument()
  })
})
