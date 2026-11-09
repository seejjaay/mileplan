// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { coverageViolations } from '../../../scripts/doc/glyphs.ts'

describe('coverageViolations', () => {
  it('accepts the characters the templates and normal prose use', () => {
    const text = 'Plain “quotes” and it’s – fine × • é ñ ü € © ® ™ … PHP 1,000.00\n\ttab'
    expect(coverageViolations(text, 'srs')).toEqual([])
  })

  it('flags emoji with the document and code point', () => {
    const v = coverageViolations('Party \u{1F389} and cart \u{1F6D2}', 'srs')
    expect(v).toHaveLength(2)
    expect(v[0]).toContain('srs')
    expect(v[0]).toContain('U+1F389')
    expect(v[0]).toContain('is not covered by Times New Roman')
  })

  it('flags CJK text', () => {
    expect(coverageViolations('中文', 'contract').length).toBeGreaterThan(0)
  })

  it('reports each character once and tells the user to write PHP for the peso sign', () => {
    const v = coverageViolations('₱1 ₱2 ₱3', 'agreement')
    expect(v).toHaveLength(1)
    expect(v[0]).toContain('PHP')
  })
})
