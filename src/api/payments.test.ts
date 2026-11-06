import { addPaymentRequest, deletePaymentRequest, recordPayment, reviewPayment, submitProof, updatePaymentRequest } from './payments'
import { removeObjects, uploadTo } from './storage'

const insert = vi.fn()
const rpc = vi.fn()

vi.mock('../lib/supabase', () => ({
  supabase: { from: () => ({ insert: (row: unknown) => insert(row) }), rpc: (...a: unknown[]) => rpc(...a) },
}))
vi.mock('./storage', () => ({ uploadTo: vi.fn(), removeObjects: vi.fn() }))

const png = new File(['x'], 'proof.png', { type: 'image/png' })
const base = { projectId: 'p1', requestId: 'r1', userId: 'u1', amount: 500, paidOn: '2026-11-08', file: png }

beforeEach(() => {
  vi.mocked(uploadTo).mockResolvedValue({ path: 'p1/uuid-proof.png', name: 'proof.png', size: 1, mime: 'image/png' })
  rpc.mockResolvedValue({ data: 'new-id', error: null })
})
afterEach(() => vi.clearAllMocks())

describe('submitProof', () => {
  it('uploads to payment-proofs first, then inserts a pending row for the request', async () => {
    insert.mockResolvedValue({ error: null })
    await submitProof({ ...base, method: 'GCash', reference: ' 123 ' })
    expect(uploadTo).toHaveBeenCalledWith('payment-proofs', 'p1', png)
    expect(insert).toHaveBeenCalledWith({
      project_id: 'p1',
      request_id: 'r1',
      amount: 500,
      paid_on: '2026-11-08',
      method: 'GCash',
      reference: '123',
      proof_path: 'p1/uuid-proof.png',
      status: 'pending',
      submitted_by: 'u1',
    })
  })

  it('removes the uploaded file when the insert fails', async () => {
    insert.mockResolvedValue({ error: { code: 'MP001', message: 'project is closed' } })
    await expect(submitProof(base)).rejects.toMatchObject({ code: 'MP001' })
    expect(removeObjects).toHaveBeenCalledWith('payment-proofs', ['p1/uuid-proof.png'])
  })

  it('does not insert when the upload is refused', async () => {
    vi.mocked(uploadTo).mockRejectedValue(new Error('too big'))
    await expect(submitProof(base)).rejects.toThrow('too big')
    expect(insert).not.toHaveBeenCalled()
  })
})

describe('admin RPC wrappers', () => {
  it('addPaymentRequest passes the p_ arguments and returns the id', async () => {
    const id = await addPaymentRequest({ projectId: 'p1', title: 'Deposit', amount: 1000, dueDate: '2026-11-09', milestoneId: 'm1' }, 'client asked')
    expect(rpc).toHaveBeenCalledWith('add_payment_request', {
      p_project_id: 'p1',
      p_title: 'Deposit',
      p_amount: 1000,
      p_due_date: '2026-11-09',
      p_milestone_id: 'm1',
      p_reason: 'client asked',
    })
    expect(id).toBe('new-id')
  })

  it('updatePaymentRequest sends only the patched fields', async () => {
    await updatePaymentRequest('r1', { amount: 1200 }, 'bigger scope')
    expect(rpc).toHaveBeenCalledWith('update_payment_request', { p_id: 'r1', p_patch: { amount: 1200 }, p_reason: 'bigger scope' })
  })

  it('deletePaymentRequest, reviewPayment and recordPayment call their RPCs', async () => {
    await deletePaymentRequest('r1')
    expect(rpc).toHaveBeenCalledWith('delete_payment_request', { p_id: 'r1', p_reason: null })
    await reviewPayment('pay1', 'rejected', 'Wrong account')
    expect(rpc).toHaveBeenCalledWith('review_payment', { p_id: 'pay1', p_decision: 'rejected', p_note: 'Wrong account' })
    await recordPayment({ requestId: 'r1', amount: 200, paidOn: '2026-11-08', method: 'cash' })
    expect(rpc).toHaveBeenCalledWith('record_payment', {
      p_request_id: 'r1',
      p_amount: 200,
      p_paid_on: '2026-11-08',
      p_method: 'cash',
      p_reference: null,
      p_proof_path: null,
    })
  })

  it('throws the RPC error', async () => {
    rpc.mockResolvedValue({ data: null, error: { code: '22023', message: 'payment was already reviewed' } })
    await expect(reviewPayment('pay1', 'confirmed')).rejects.toMatchObject({ code: '22023' })
  })
})
