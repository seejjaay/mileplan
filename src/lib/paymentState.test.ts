import { paymentTotals, requestState } from './paymentState'

type P = { amount: number; status: 'pending' | 'confirmed' | 'rejected' }
const req = (amount: number, due_date: string, payments: P[] = []) => ({ amount, due_date, payments })
const TODAY = '2026-11-08'

describe('requestState', () => {
  it('is due when nothing has been paid and the date has not passed', () => {
    expect(requestState(req(1000, '2026-11-09'), TODAY)).toEqual({ state: 'due', paid: 0, remaining: 1000 })
  })

  it('is due on the due date itself (overdue means strictly before today)', () => {
    expect(requestState(req(1000, TODAY), TODAY).state).toBe('due')
  })

  it('is overdue once the due date has passed', () => {
    expect(requestState(req(1000, '2026-11-07'), TODAY).state).toBe('overdue')
  })

  it('proof sent beats overdue', () => {
    const r = requestState(req(1000, '2026-11-01', [{ amount: 1000, status: 'pending' }]), TODAY)
    expect(r.state).toBe('proof_sent')
    expect(r.paid).toBe(0) // pending money is not paid yet
  })

  it('is partially paid when some, but not all, is confirmed', () => {
    expect(requestState(req(1000, '2026-11-09', [{ amount: 400, status: 'confirmed' }]), TODAY)).toEqual({
      state: 'partially_paid',
      paid: 400,
      remaining: 600,
    })
  })

  it('partially paid beats overdue', () => {
    expect(requestState(req(1000, '2026-11-01', [{ amount: 400, status: 'confirmed' }]), TODAY).state).toBe('partially_paid')
  })

  it('is paid at exactly the amount', () => {
    expect(requestState(req(1000, '2026-11-01', [{ amount: 600, status: 'confirmed' }, { amount: 400, status: 'confirmed' }]), TODAY)).toEqual({
      state: 'paid',
      paid: 1000,
      remaining: 0,
    })
  })

  it('an overpayment is paid and remaining never goes negative', () => {
    expect(requestState(req(1000, '2026-11-09', [{ amount: 1500, status: 'confirmed' }]), TODAY)).toEqual({
      state: 'paid',
      paid: 1500,
      remaining: 0,
    })
  })

  it('rejected proofs do not count', () => {
    expect(requestState(req(1000, '2026-11-09', [{ amount: 1000, status: 'rejected' }]), TODAY)).toEqual({
      state: 'due',
      paid: 0,
      remaining: 1000,
    })
  })

  it('a rejected proof on an overdue request leaves it overdue', () => {
    expect(requestState(req(1000, '2026-11-01', [{ amount: 1000, status: 'rejected' }]), TODAY).state).toBe('overdue')
  })

  it('adds in cents, so 0.1 + 0.2 confirmed covers 0.30', () => {
    const r = requestState(req(0.3, '2026-11-09', [{ amount: 0.1, status: 'confirmed' }, { amount: 0.2, status: 'confirmed' }]), TODAY)
    expect(r.state).toBe('paid')
    expect(r.remaining).toBe(0)
  })
})

describe('paymentTotals', () => {
  it('sums in cents and counts overdue', () => {
    const totals = paymentTotals(
      [
        req(1000.1, '2026-11-01', [{ amount: 1000.1, status: 'confirmed' }]), // paid
        req(2000.2, '2026-11-01', [{ amount: 500, status: 'rejected' }]), // overdue
        req(300, '2026-11-20', [{ amount: 100.05, status: 'confirmed' }, { amount: 50, status: 'pending' }]), // proof sent
      ],
      TODAY,
    )
    expect(totals).toEqual({ scheduled: 3300.3, paid: 1100.15, outstanding: 2200.15, overdue: 1 })
  })

  it('outstanding never goes below zero', () => {
    expect(paymentTotals([req(100, '2026-11-20', [{ amount: 250, status: 'confirmed' }])], TODAY).outstanding).toBe(0)
  })

  it('is all zeros for no requests', () => {
    expect(paymentTotals([], TODAY)).toEqual({ scheduled: 0, paid: 0, outstanding: 0, overdue: 0 })
  })
})
