import { screen, waitFor } from '@testing-library/react'
import { reviewPayment } from '../../../api/payments'
import { qk } from '../../../api/keys'
import { ReviewPaymentDialog } from './ReviewPaymentDialog'
import { payment, renderWithProviders } from './testkit'

vi.mock('../../../api/payments', async (orig) => ({ ...(await orig<typeof import('../../../api/payments')>()), reviewPayment: vi.fn() }))

const open = (mode: 'confirmed' | 'rejected') =>
  renderWithProviders(<ReviewPaymentDialog open onClose={() => {}} projectId="p1" payment={payment()} mode={mode} />)

beforeEach(() => {
  vi.mocked(reviewPayment).mockResolvedValue()
})
afterEach(() => vi.clearAllMocks())

describe('ReviewPaymentDialog', () => {
  it('rejecting requires a note', async () => {
    const { user } = open('rejected')
    const button = await screen.findByRole('button', { name: 'Reject proof' })
    expect(button).toBeDisabled()
    await user.type(screen.getByLabelText('Reason for rejecting'), '   ')
    expect(button).toBeDisabled()
    await user.type(screen.getByLabelText('Reason for rejecting'), 'Wrong account')
    expect(button).toBeEnabled()
    await user.click(button)
    await waitFor(() => expect(reviewPayment).toHaveBeenCalledWith('pay1', 'rejected', 'Wrong account'))
    expect(await screen.findByText('Proof rejected')).toBeInTheDocument()
  })

  it('shows what is being confirmed', async () => {
    open('confirmed')
    expect(await screen.findByText(/₱500\.00/)).toBeInTheDocument()
    expect(screen.getByText(/Eve Estrada/)).toBeInTheDocument()
  })

  it('already-reviewed shows the copy and refetches', async () => {
    vi.mocked(reviewPayment).mockRejectedValue({ code: '22023', message: 'payment was already reviewed' })
    const { user, invalidate } = open('confirmed')
    await user.click(await screen.findByRole('button', { name: 'Confirm payment' }))
    expect(await screen.findByText('This payment was already reviewed.')).toBeInTheDocument()
    expect(invalidate).toHaveBeenCalledWith({ queryKey: qk.payments('p1') })
  })
})
