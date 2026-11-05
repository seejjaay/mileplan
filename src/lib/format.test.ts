import { formatBytes, formatDate, formatMoney } from './format'

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

describe('formatBytes', () => {
  it.each([
    [0, '0 B'],
    [512, '512 B'],
    [2048, '2.0 KB'],
    [1572864, '1.5 MB'],
  ])('%i -> %s', (bytes, text) => {
    expect(formatBytes(bytes)).toBe(text)
  })
})
