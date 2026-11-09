import { PDFDict, PDFDocument, PDFName } from 'pdf-lib'
import JSZip from 'jszip'

export const FONT = 'Times New Roman'

const CHECKED = /^word\/(document|styles|numbering|fontTable)\.xml$|^word\/(footer|header)\d*\.xml$/

// Looks at every place a DOCX can name a font. Returns what is wrong, so an empty list means clean.
// Only <w:rFonts> tags are read for font attributes: w:eastAsia also appears on <w:lang>, where it is a language.
export async function docxFontViolations(docx: Buffer): Promise<string[]> {
  const zip = await JSZip.loadAsync(docx)
  const violations: string[] = []
  for (const file of Object.keys(zip.files).filter((f) => CHECKED.test(f))) {
    const xml = await zip.file(file)!.async('string')
    for (const tag of xml.match(/<w:rFonts\b[^>]*>/g) ?? []) {
      for (const m of tag.matchAll(/w:(ascii|hAnsi|eastAsia|cs)="([^"]*)"/g)) {
        if (m[2] !== FONT) violations.push(`${file}: w:${m[1]}="${m[2]}"`)
      }
      for (const m of tag.matchAll(/w:\w*[Tt]heme="([^"]*)"/g)) violations.push(`${file}: theme font ${m[0]}`)
    }
    for (const m of xml.matchAll(/<w:font\b[^>]*\bw:name="([^"]*)"/g)) {
      if (m[1] !== FONT) violations.push(`${file}: font table lists "${m[1]}"`)
    }
  }
  return violations
}

// Names of the fonts a PDF embeds, with the random subset prefix (ABCDEF+) removed. A font with no name,
// such as a Type 3 glyph font that Chromium uses for colour emoji, is reported as "(unnamed Type 3 font)".
export async function pdfFontNames(pdf: Buffer): Promise<string[]> {
  const doc = await PDFDocument.load(pdf, { updateMetadata: false })
  const names: string[] = []
  for (const [, obj] of doc.context.enumerateIndirectObjects()) {
    if (!(obj instanceof PDFDict) || obj.get(PDFName.of('Type')) !== PDFName.of('Font')) continue
    const base = obj.get(PDFName.of('BaseFont'))
    names.push(base instanceof PDFName ? base.decodeText().replace(/^[A-Z]{6}\+/, '') : '(unnamed Type 3 font)')
  }
  return names
}

export async function pdfFontViolations(pdf: Buffer): Promise<string[]> {
  const violations: string[] = []
  for (const name of new Set(await pdfFontNames(pdf))) {
    if (!name.replace(/[^A-Za-z0-9]/g, '').startsWith('TimesNewRoman')) {
      violations.push(`PDF font "${name}" is not Times New Roman (is Times New Roman installed?)`)
    }
  }
  return violations
}
