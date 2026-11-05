import { describe, expect, it } from 'vitest'
import { generateToken, hashToken } from '../../supabase/functions/_shared/token'

describe('setup token', () => {
  it('generateToken returns 43 base64url characters and is unique per call', () => {
    const a = generateToken()
    const b = generateToken()
    expect(a).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(b).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(a).not.toBe(b)
  })

  it("hashToken('abc') is the SHA-256 hex digest", async () => {
    expect(await hashToken('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
  })
})
