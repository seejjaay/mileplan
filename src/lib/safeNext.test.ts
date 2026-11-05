import { safeNext } from './safeNext'

describe('safeNext', () => {
  it('keeps same-site paths', () => {
    expect(safeNext('/clients?x=1')).toBe('/clients?x=1')
  })

  it.each([null, '', 'https://evil.test', '//evil.test', '/\\evil.test', 'javascript:alert(1)'])(
    'falls back to / for %s',
    (input) => {
      expect(safeNext(input)).toBe('/')
    },
  )
})
