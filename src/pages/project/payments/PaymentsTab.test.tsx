import { screen, waitFor, within } from '@testing-library/react'
import { addPaymentRequest, listPaymentRequests, reviewPayment } from '../../../api/payments'
import { listMilestones } from '../../../api/milestones'
import { signedUrl } from '../../../api/storage'
import { openUrl } from '../../../lib/openUrl'
import PaymentsTab from './PaymentsTab'
import { FUTURE, PAST, payment, project, renderWithProviders, request } from './testkit'

vi.mock('../../../api/payments', async (orig) => ({
  ...(await orig<typeof import('../../../api/payments')>()),
  listPaymentRequests: vi.fn(),
  addPaymentRequest: vi.fn(),
  updatePaymentRequest: vi.fn(),
  deletePaymentRequest: vi.fn(),
  reviewPayment: vi.fn(),
  recordPayment: vi.fn(),
  submitProof: vi.fn(),
}))
vi.mock('../../../api/milestones', async (orig) => ({ ...(await orig<typeof import('../../../api/milestones')>()), listMilestones: vi.fn() }))
vi.mock('../../../api/storage', async (orig) => ({ ...(await orig<typeof import('../../../api/storage')>()), signedUrl: vi.fn() }))
vi.mock('../../../lib/openUrl', () => ({ openUrl: vi.fn() }))

beforeEach(() => {
  vi.mocked(listPaymentRequests).mockResolvedValue([request()])
  vi.mocked(listMilestones).mockResolvedValue([
    { id: 'm1', title: 'Design', position: 1 },
    { id: 'm2', title: 'Build', position: 2 },
  ] as never)
  vi.mocked(addPaymentRequest).mockResolvedValue('new')
  vi.mocked(reviewPayment).mockResolvedValue()
  vi.mocked(signedUrl).mockResolvedValue('https://signed.example/proof')
})
afterEach(() => vi.clearAllMocks())

describe('PaymentsTab', () => {
  it('shows the exact empty copy', async () => {
    vi.mocked(listPaymentRequests).mockResolvedValue([])
    renderWithProviders(<PaymentsTab project={project()} />)
    expect(await screen.findByText('No payments scheduled yet.')).toBeInTheDocument()
  })

  it('lists each request with its milestone, due date, state word and paid-of amount', async () => {
    vi.mocked(listPaymentRequests).mockResolvedValue([
      request({ payments: [payment({ status: 'confirmed', amount: 400 })] }),
    ])
    renderWithProviders(<PaymentsTab project={project()} />)
    const item = (await screen.findByText('50% deposit')).closest('li')!
    expect(within(item).getByText('Design')).toBeInTheDocument()
    expect(within(item).getByText('Partially paid')).toBeInTheDocument()
    expect(within(item).getByText(/Paid ₱400\.00 of ₱1,000\.00/)).toBeInTheDocument()
  })

  it('admin adds a scheduled payment with a reason on an active project', async () => {
    const { user } = renderWithProviders(<PaymentsTab project={project('active')} />)
    await user.click(await screen.findByRole('button', { name: 'Add scheduled payment' }))
    const dialog = await screen.findByRole('dialog')
    await user.type(within(dialog).getByLabelText('Title'), 'Balance')
    await user.type(within(dialog).getByLabelText('Amount'), '2000')
    await user.type(within(dialog).getByLabelText('Due date'), FUTURE)
    await user.selectOptions(within(dialog).getByLabelText('Milestone (optional)'), 'm2')
    await user.type(within(dialog).getByLabelText('Reason for change (optional)'), 'agreed by chat')
    await user.click(within(dialog).getByRole('button', { name: 'Add scheduled payment' }))
    await waitFor(() =>
      expect(addPaymentRequest).toHaveBeenCalledWith(
        { projectId: 'p1', title: 'Balance', amount: 2000, dueDate: FUTURE, milestoneId: 'm2' },
        'agreed by chat',
      ),
    )
    expect(await screen.findByText('Scheduled payment added')).toBeInTheDocument()
  })

  it('does not ask for a reason while the project is still in setup', async () => {
    const { user } = renderWithProviders(<PaymentsTab project={project('setup')} />)
    await user.click(await screen.findByRole('button', { name: 'Add scheduled payment' }))
    expect(within(await screen.findByRole('dialog')).queryByLabelText('Reason for change (optional)')).toBeNull()
  })

  it('keeps Add disabled until the form is valid', async () => {
    const { user } = renderWithProviders(<PaymentsTab project={project()} />)
    await user.click(await screen.findByRole('button', { name: 'Add scheduled payment' }))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByRole('button', { name: 'Add scheduled payment' })).toBeDisabled()
  })

  it('client sees Upload proof on due requests, not on paid ones, and no admin controls', async () => {
    vi.mocked(listPaymentRequests).mockResolvedValue([
      request({ id: 'r1', title: 'Deposit' }),
      request({ id: 'r2', title: 'Balance', payments: [payment({ id: 'pay2', request_id: 'r2', status: 'confirmed', amount: 1000 })] }),
    ])
    renderWithProviders(<PaymentsTab project={project()} />, 'client')
    const due = (await screen.findByText('Deposit')).closest('li')!
    const paid = screen.getByText('Balance').closest('li')!
    expect(within(due).getByRole('button', { name: 'Upload proof' })).toBeInTheDocument()
    expect(within(paid).queryByRole('button', { name: 'Upload proof' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Add scheduled payment' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Record payment' })).toBeNull()
  })

  it('admin confirms a pending proof', async () => {
    vi.mocked(listPaymentRequests).mockResolvedValue([request({ payments: [payment()] })])
    const { user } = renderWithProviders(<PaymentsTab project={project()} />)
    await user.click(await screen.findByRole('button', { name: 'Confirm payment' }))
    const dialog = await screen.findByRole('dialog')
    await user.click(within(dialog).getByRole('button', { name: 'Confirm payment' }))
    await waitFor(() => expect(reviewPayment).toHaveBeenCalledWith('pay1', 'confirmed', undefined))
    expect(await screen.findByText('Payment confirmed')).toBeInTheDocument()
  })

  it('shows the submitter, status word and the rejection note to the client', async () => {
    vi.mocked(listPaymentRequests).mockResolvedValue([
      request({ due_date: PAST, payments: [payment({ status: 'rejected', review_note: 'Wrong account' })] }),
    ])
    renderWithProviders(<PaymentsTab project={project()} />, 'client')
    const item = (await screen.findByText('50% deposit')).closest('li')!
    expect(within(item).getByText('Overdue')).toBeInTheDocument() // a rejected proof does not count
    expect(within(item).getByText('Rejected')).toBeInTheDocument()
    expect(within(item).getByText(/Wrong account/)).toBeInTheDocument()
    expect(within(item).getByText(/Eve Estrada/)).toBeInTheDocument()
  })

  it('View proof opens a signed URL', async () => {
    vi.mocked(listPaymentRequests).mockResolvedValue([request({ payments: [payment()] })])
    const { user } = renderWithProviders(<PaymentsTab project={project()} />, 'client')
    await user.click(await screen.findByRole('button', { name: 'View proof' }))
    await waitFor(() => expect(openUrl).toHaveBeenCalledWith('https://signed.example/proof'))
    expect(signedUrl).toHaveBeenCalledWith('payment-proofs', 'p1/11111111-1111-1111-1111-111111111111-proof.png', 'proof.png')
  })
})

describe('PaymentsTab when the project is closed', () => {
  const closed = () => ({ ...project('completed'), closed_at: '2026-11-10T08:00:00Z' })

  it('hides every write control from the admin and keeps View proof', async () => {
    vi.mocked(listPaymentRequests).mockResolvedValue([request({ payments: [payment()] })])
    renderWithProviders(<PaymentsTab project={closed()} />, 'admin')
    expect(await screen.findByRole('button', { name: 'View proof' })).toBeInTheDocument()
    for (const name of ['Add scheduled payment', 'Record payment', 'Confirm payment', 'Reject proof', /^Edit/]) {
      expect(screen.queryByRole('button', { name })).not.toBeInTheDocument()
    }
  })

  it('hides Upload proof from the client', async () => {
    renderWithProviders(<PaymentsTab project={closed()} />, 'client')
    expect(await screen.findByText('50% deposit')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Upload proof' })).not.toBeInTheDocument()
  })
})
