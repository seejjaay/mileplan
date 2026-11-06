import { screen, waitFor } from '@testing-library/react'
import { recordPayment } from '../../../api/payments'
import { removeObjects, uploadTo } from '../../../api/storage'
import { RecordPaymentDialog } from './RecordPaymentDialog'
import { payment, project, renderWithProviders, request } from './testkit'

vi.mock('../../../api/payments', async (orig) => ({ ...(await orig<typeof import('../../../api/payments')>()), recordPayment: vi.fn() }))
vi.mock('../../../api/storage', async (orig) => ({ ...(await orig<typeof import('../../../api/storage')>()), uploadTo: vi.fn(), removeObjects: vi.fn() }))

const png = new File(['x'], 'chat.png', { type: 'image/png' })
const open = () =>
  renderWithProviders(
    <RecordPaymentDialog open onClose={() => {}} project={project()} request={request({ payments: [payment({ status: 'confirmed', amount: 250 })] })} />,
  )

beforeEach(() => {
  vi.mocked(recordPayment).mockResolvedValue('new')
  vi.mocked(uploadTo).mockResolvedValue({ path: 'p1/uuid-chat.png', name: 'chat.png', size: 1, mime: 'image/png' })
})
afterEach(() => vi.clearAllMocks())

describe('RecordPaymentDialog', () => {
  it('defaults the amount to the remaining amount and records without proof', async () => {
    const { user } = open()
    expect(await screen.findByLabelText('Amount')).toHaveValue(750)
    await user.type(screen.getByLabelText('Method'), 'cash')
    await user.click(screen.getByRole('button', { name: 'Record payment' }))
    await waitFor(() =>
      expect(recordPayment).toHaveBeenCalledWith(expect.objectContaining({ requestId: 'r1', amount: 750, method: 'cash', proofPath: undefined })),
    )
    expect(uploadTo).not.toHaveBeenCalled()
    expect(await screen.findByText('Payment recorded')).toBeInTheDocument()
  })

  it('uploads optional proof first, and removes it when recording fails', async () => {
    vi.mocked(recordPayment).mockRejectedValue({ code: 'MP001', message: 'project is closed' })
    const { user } = open()
    await user.upload(await screen.findByLabelText('Proof file (optional)'), png)
    await user.click(screen.getByRole('button', { name: 'Record payment' }))
    await waitFor(() => expect(uploadTo).toHaveBeenCalledWith('payment-proofs', 'p1', png))
    await waitFor(() => expect(removeObjects).toHaveBeenCalledWith('payment-proofs', ['p1/uuid-chat.png']))
    expect(await screen.findByText('This project is closed. Reopen it to make changes.')).toBeInTheDocument()
  })
})
