import { nextDueMilestone, percentComplete } from './projects'

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
