import { formatDate, formatMoney } from './format'

describe('formatDate', () => {
  it('formats an ISO date without shifting the day for the local timezone', () => {
    expect(formatDate('2026-12-01')).toBe('Dec 1, 2026')
  })
})

describe('formatMoney', () => {
  it('formats PHP with the peso sign and two decimals', () => {
    expect(formatMoney(15000, 'PHP')).toBe('₱15,000.00')
  })

  it('accepts numeric strings from Postgres', () => {
    expect(formatMoney('1500.50', 'PHP')).toBe('₱1,500.50')
  })
})
