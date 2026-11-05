import { totalAmount } from './milestones'

describe('totalAmount', () => {
  it('sums in whole cents without float noise', () => {
    expect(totalAmount([{ amount: 0.1 }, { amount: 0.2 }])).toBe(0.3)
  })

  it('is 0 for no milestones', () => {
    expect(totalAmount([])).toBe(0)
  })
})
