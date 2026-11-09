import { chromium } from '@playwright/test'
import { marked } from 'marked'
import { FONT } from './fontcheck.ts'

const CSS = `
  @page { size: Letter; }
  * { font-family: "${FONT}" !important; }
  html, body { margin: 0; padding: 0; }
  body { font-size: 12pt; line-height: 1.15; color: #000; }
  h1, h2, h3 { font-weight: bold; margin: 12pt 0 6pt; page-break-after: avoid; }
  h1 { font-size: 16pt; }
  h2 { font-size: 14pt; }
  h3 { font-size: 12pt; }
  p { margin: 0 0 6pt; }
  ul, ol { margin: 0 0 6pt; padding-left: 0.5in; }
  li { margin: 0 0 3pt; }
  table { border-collapse: collapse; width: 100%; margin: 0 0 8pt; page-break-inside: avoid; }
  th, td { border: 1px solid #000; padding: 2pt 5pt; text-align: left; vertical-align: top; }
  a { color: #000; text-decoration: none; }
  hr { border: 0; border-top: 1px solid #000; }
`

export function markdownToHtml(markdown: string, title: string): string {
  const body = marked.parse(markdown, { async: false })
  const safeTitle = title.replace(/&/g, '&amp;').replace(/</g, '&lt;')
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${safeTitle}</title><style>${CSS}</style></head><body>${body}</body></html>`
}

// The footer is rendered by Chromium separately from the page, so it carries its own font.
const FOOTER = `<div style="font-family: '${FONT}'; font-size: 10pt; width: 100%; text-align: center;">Page <span class="pageNumber"></span> of <span class="totalPages"></span></div>`

export async function openPdfRenderer(): Promise<{
  render(markdown: string, title: string): Promise<Buffer>
  close(): Promise<void>
}> {
  const browser = await chromium.launch()
  return {
    async render(markdown, title) {
      const page = await browser.newPage()
      try {
        await page.setContent(markdownToHtml(markdown, title), { waitUntil: 'load' })
        return await page.pdf({
          format: 'Letter',
          margin: { top: '1in', right: '1in', bottom: '1in', left: '1in' },
          displayHeaderFooter: true,
          headerTemplate: '<span></span>',
          footerTemplate: FOOTER,
        })
      } finally {
        await page.close()
      }
    },
    close: () => browser.close(),
  }
}
