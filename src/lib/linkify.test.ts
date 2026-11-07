import { linkify } from './linkify'

const link = (text: string) => ({ kind: 'link', text, href: text })
const text = (t: string) => ({ kind: 'text', text: t })

describe('linkify', () => {
  it('keeps trailing sentence punctuation outside the link', () => {
    expect(linkify('see https://x.dev.')).toEqual([text('see '), link('https://x.dev'), text('.')])
    expect(linkify('https://x.dev, then')).toEqual([link('https://x.dev'), text(', then')])
  })

  it('keeps a balanced ")" inside the link and the outer one outside', () => {
    expect(linkify('(https://x.dev/a_(b))')).toEqual([text('('), link('https://x.dev/a_(b)'), text(')')])
  })

  it('only links http and https urls', () => {
    for (const s of ['javascript:alert(1)', 'www.x.dev', 'ftp://x']) expect(linkify(s)).toEqual([text(s)])
  })

  it('does not link a bare scheme', () => {
    expect(linkify('https://.')).toEqual([text('https://.')])
  })

  it('links every url in a line', () => {
    expect(linkify('a https://x.dev b http://y.dev')).toEqual([text('a '), link('https://x.dev'), text(' b '), link('http://y.dev')])
  })

  it('round-trips plain text unchanged', () => {
    for (const s of ['a\n\nb', 'hi 👋🏽 there', 'x'.repeat(300)]) {
      const segs = linkify(s)
      expect(segs.every((g) => g.kind === 'text')).toBe(true)
      expect(segs.map((g) => g.text).join('')).toBe(s)
    }
  })
})
