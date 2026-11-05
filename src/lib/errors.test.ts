import { toUserMessage } from './errors'

describe('toUserMessage', () => {
  it('maps 42501', () => {
    expect(toUserMessage({ code: '42501', message: 'new row violates row-level security policy' })).toBe(
      "You don't have access to this",
    )
  })

  it('maps HTTP 403', () => {
    expect(toUserMessage({ status: 403, message: 'forbidden' })).toBe("You don't have access to this")
  })

  it('returns the message for other errors', () => {
    expect(toUserMessage(new Error('Network down'))).toBe('Network down')
  })

  it('falls back for non-errors', () => {
    expect(toUserMessage(undefined)).toBe('Something went wrong')
  })
})
