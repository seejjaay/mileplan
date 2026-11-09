import { chromium } from '@playwright/test'
import { PDFDocument } from 'pdf-lib'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { pdfFontNames, pdfFontViolations } from '../../scripts/doc/fontcheck.ts'
import { openPdfRenderer } from '../../scripts/doc/pdf.ts'
import { DOC_NAMES, fixtureMarkdown } from './helpers.ts'

let renderer: Awaited<ReturnType<typeof openPdfRenderer>>

beforeAll(async () => {
  renderer = await openPdfRenderer()
})
afterAll(async () => {
  await renderer.close()
})

describe('PDF export', () => {
  it('fixture contract PDF is Times New Roman only', async () => {
    const pdf = await renderer.render(fixtureMarkdown('contract', true), 'Contract')
    expect(await pdfFontViolations(pdf)).toEqual([])
    expect((await pdfFontNames(pdf)).length).toBeGreaterThan(0)
  })

  it.each(DOC_NAMES)('%s PDF is clean', async (name) => {
    const pdf = await renderer.render(fixtureMarkdown(name), name)
    expect(await pdfFontViolations(pdf)).toEqual([])
  })

  it('bold and italic stay Times New Roman', async () => {
    const pdf = await renderer.render('# Title\n\nPlain **bold** and *italic* text.\n', 'T')
    expect(await pdfFontViolations(pdf)).toEqual([])
    expect(new Set(await pdfFontNames(pdf)).size).toBeGreaterThan(1)
  })

  it('pdfFontViolations flags a non-Times font', async () => {
    const browser = await chromium.launch()
    try {
      const page = await browser.newPage()
      await page.setContent('<p style="font-family: Arial">Not Times</p>')
      const pdf = await page.pdf({ format: 'Letter' })
      const violations = await pdfFontViolations(pdf)
      expect(violations.length).toBeGreaterThanOrEqual(1)
      expect(violations[0]).toContain('is Times New Roman installed?')
    } finally {
      await browser.close()
    }
  })

  it('page is Letter', async () => {
    const pdf = await renderer.render('# T\n\nBody', 'T')
    const { width, height } = (await PDFDocument.load(pdf)).getPage(0).getSize()
    expect([Math.round(width), Math.round(height)]).toEqual([612, 792])
  })
})
