// Code point ranges Times New Roman covers: Basic Latin, Latin-1, Latin Extended-A/B, Greek, Cyrillic,
// general punctuation and a few symbols. Anything else (emoji, CJK, ...) makes Word and Chromium fall back to
// another font for that glyph, which would break the "Times New Roman only" rule without any font name changing.
// The peso sign U+20B1 is left out on purpose: some versions of the font lack it, so amounts are written "PHP".
const COVERED: [number, number][] = [
  [0x09, 0x0a],
  [0x0d, 0x0d],
  [0x20, 0x7e],
  [0xa0, 0x24f],
  [0x2c6, 0x2c7],
  [0x2d8, 0x2dd],
  [0x370, 0x3ff],
  [0x400, 0x4ff],
  [0x2010, 0x2027],
  [0x2030, 0x203a],
  [0x20ac, 0x20ac],
  [0x2122, 0x2122],
  [0x2212, 0x2212],
  [0x2260, 0x2260],
  [0x2264, 0x2265],
]

const covered = (cp: number) => COVERED.some(([lo, hi]) => cp >= lo && cp <= hi)

export function coverageViolations(text: string, label: string): string[] {
  const seen = new Set<number>()
  const out: string[] = []
  for (const ch of text) {
    const cp = ch.codePointAt(0)!
    if (covered(cp) || seen.has(cp)) continue
    seen.add(cp)
    const hex = cp.toString(16).toUpperCase().padStart(4, '0')
    const hint = cp === 0x20b1 ? ' (write PHP instead)' : ''
    out.push(`${label}: "${ch}" (U+${hex}) is not covered by Times New Roman${hint}`)
  }
  return out
}
