import { nextDueMilestone, percentComplete, toSummary } from './projects'

describe('percentComplete', () => {
  it('is 0 with no milestones', () => {
    expect(percentComplete([])).toBe(0)
  })

  it('counts approved and paid', () => {
    expect(percentComplete(['approved', 'paid', 'planned', 'in_review'])).toBe(50)
  })

  it('rounds to a whole percent', () => {
    expect(percentComplete(['approved', 'planned', 'planned'])).toBe(33)
  })
})

describe('nextDueMilestone', () => {
  it('picks the earliest due date among unfinished milestones', () => {
    const next = nextDueMilestone([
      { title: 'Done', due_date: '2026-11-01', status: 'approved' },
      { title: 'Later', due_date: '2026-12-20', status: 'planned' },
      { title: 'Soon', due_date: '2026-12-01', status: 'in_progress' },
      { title: 'Undated', due_date: null, status: 'planned' },
    ])
    expect(next).toEqual({ title: 'Soon', due_date: '2026-12-01' })
  })

  it('is null when nothing is pending with a date', () => {
    expect(nextDueMilestone([{ title: 'Done', due_date: '2026-11-01', status: 'paid' }])).toBeNull()
  })
})

describe('toSummary payments', () => {
  const row = {
    id: 'p1',
    title: 'T',
    summary: null,
    status: 'active' as const,
    currency: 'PHP',
    start_date: null,
    end_date: null,
    activated_at: null,
    closed_at: null,
    created_at: '2026-11-01T00:00:00Z',
    milestones: [],
  }

  it('summary computes paid/outstanding/overdue from embedded requests', () => {
    const s = toSummary({
      ...row,
      payment_requests: [
        { amount: 1000, due_date: '2000-01-01', payments: [{ amount: 400, status: 'confirmed' }] }, // partially paid: not overdue
        { amount: 500, due_date: '2000-01-01', payments: [] }, // overdue
        { amount: 250.5, due_date: '2999-01-01', payments: [{ amount: 250.5, status: 'pending' }] }, // proof sent
      ],
    })
    expect(s.scheduled).toBe(1750.5)
    expect(s.paid).toBe(400)
    expect(s.outstanding).toBe(1350.5)
    expect(s.overdue).toBe(1)
  })

  it('is all zeros with no scheduled payments', () => {
    const s = toSummary({ ...row, payment_requests: [] })
    expect([s.scheduled, s.paid, s.outstanding, s.overdue]).toEqual([0, 0, 0, 0])
  })
})
