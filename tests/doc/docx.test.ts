import JSZip from 'jszip'
import { describe, expect, it } from 'vitest'
import { markdownToDocx } from '../../scripts/doc/docx.ts'
import { docxFontViolations } from '../../scripts/doc/fontcheck.ts'
import { DOC_NAMES, fixtureMarkdown } from './helpers.ts'

async function xml(docx: Buffer, file: string): Promise<string> {
  return (await JSZip.loadAsync(docx)).file(file)!.async('string')
}

describe('DOCX export', () => {
  it('fixture contract DOCX is Times New Roman only', async () => {
    const docx = await markdownToDocx(fixtureMarkdown('contract', true), 'Contract')
    expect(await docxFontViolations(docx)).toEqual([])
  })

  it.each(DOC_NAMES)('%s DOCX is clean', async (name) => {
    const docx = await markdownToDocx(fixtureMarkdown(name), name)
    expect(await docxFontViolations(docx)).toEqual([])
  })

  it('docxFontViolations flags other fonts and theme fonts', async () => {
    const zip = new JSZip()
    zip.file('word/styles.xml', '<w:styles><w:rFonts w:ascii="Calibri" w:asciiTheme="minorHAnsi"/></w:styles>')
    const violations = await docxFontViolations(await zip.generateAsync({ type: 'nodebuffer' }))
    expect(violations).toHaveLength(2)
  })

  it('does not flag language attributes that share a name with font attributes', async () => {
    const zip = new JSZip()
    zip.file('word/styles.xml', '<w:styles><w:lang w:val="en-US" w:eastAsia="en-US"/><w:rFonts w:ascii="Times New Roman"/></w:styles>')
    expect(await docxFontViolations(await zip.generateAsync({ type: 'nodebuffer' }))).toEqual([])
  })

  it('page is Letter with 1-inch margins', async () => {
    const doc = await xml(await markdownToDocx(fixtureMarkdown('contract'), 'Contract'), 'word/document.xml')
    expect(doc).toContain('w:w="12240"')
    expect(doc).toContain('w:h="15840"')
    expect(doc).toContain('w:top="1440"')
  })

  it('keeps data text literal: escaped characters, bold and table cells', async () => {
    const md = 'Tom & \\*Jerry\\* and **bold** text\n\n| A | B |\n| --- | --- |\n| 1 | x \\| y |\n'
    const doc = await xml(await markdownToDocx(md, 'T'), 'word/document.xml')
    // Escaped characters are their own runs, so read the text the way Word shows it: all <w:t> joined.
    const text = [...doc.matchAll(/<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>/g)].map((m) => m[1]).join('').replace(/&amp;/g, '&')
    expect(text).toContain('Tom & *Jerry* and bold text')
    expect(text).toContain('x | y')
    expect(doc).toContain('<w:b/>')
  })

  it('has a footer with page numbers', async () => {
    const zip = await JSZip.loadAsync(await markdownToDocx('# T\n\nBody', 'T'))
    const footer = Object.keys(zip.files).find((f) => /^word\/footer\d*\.xml$/.test(f))!
    const text = await zip.file(footer)!.async('string')
    expect(text).toContain('PAGE')
    expect(text).toContain('NUMPAGES')
  })
})
