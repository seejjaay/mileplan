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
