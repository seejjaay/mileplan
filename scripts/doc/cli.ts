import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { buildContext } from './context.ts'
import { markdownToDocx } from './docx.ts'
import { docxFontViolations, pdfFontViolations } from './fontcheck.ts'
import { loadClient, loadDeveloper, loadPrices } from './load.ts'
import { openPdfRenderer } from './pdf.ts'
import { renderDocument } from './render.ts'
import type { DocName } from './render.ts'
import { DocError } from './types.ts'

const FILE_BASE: Record<DocName, string> = {
  contract: 'service-contract',
  agreement: 'project-agreement',
  srs: 'srs',
  plan: 'milestone-plan',
}
const ALL_DOCS = Object.keys(FILE_BASE) as DocName[]
const FORMATS = ['pdf', 'docx'] as const
type Format = (typeof FORMATS)[number]

const USAGE = `Usage: npm run doc -- <client-dir> [--only ${ALL_DOCS.join(',')}] [--format ${FORMATS.join(',')}]`

type Args = { dir: string; docs: DocName[]; formats: Format[] }

function parseArgs(argv: string[]): Args | string {
  let dir: string | undefined
  let docs: DocName[] = ALL_DOCS
  let formats: Format[] = [...FORMATS]
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--only' || a === '--format') {
      const values = (argv[++i] ?? '').split(',').filter(Boolean)
      const allowed: readonly string[] = a === '--only' ? ALL_DOCS : FORMATS
      const bad = values.filter((v) => !allowed.includes(v))
      if (!values.length || bad.length) return `Unknown ${a} value${bad.length ? `: ${bad.join(', ')}` : ''}`
      if (a === '--only') docs = values as DocName[]
      else formats = values as Format[]
    } else if (a.startsWith('--')) return `Unknown option ${a}`
    else if (dir === undefined) dir = a
    else return `Unexpected argument ${a}`
  }
  return dir === undefined ? 'Missing client folder' : { dir, docs, formats }
}

export async function runDoc(argv: string[], log: (line: string) => void = console.log): Promise<number> {
  const args = parseArgs(argv)
  if (typeof args === 'string') {
    log(args)
    log(USAGE)
    return 2
  }
  let renderer: Awaited<ReturnType<typeof openPdfRenderer>> | undefined
  try {
    const input = loadClient(args.dir)
    const ctx = buildContext(input, loadPrices(), loadDeveloper())
    if (args.formats.includes('pdf')) renderer = await openPdfRenderer()

    // Everything is built and font-checked in memory first, so a failure leaves no files behind.
    const files: { name: string; data: Buffer }[] = []
    const problems: string[] = []
    for (const doc of args.docs) {
      const markdown = renderDocument(doc, ctx)
      const title = FILE_BASE[doc]
      for (const format of args.formats) {
        const name = `${input.slug}-${title}.${format}`
        const data = format === 'docx' ? await markdownToDocx(markdown, title) : await renderer!.render(markdown, title)
        const violations = format === 'docx' ? await docxFontViolations(data) : await pdfFontViolations(data)
        problems.push(...violations.map((v) => `${name}: ${v}`))
        files.push({ name, data })
      }
    }
    if (problems.length) {
      problems.forEach(log)
      return 1
    }
    const out = join(args.dir, 'out')
    mkdirSync(out, { recursive: true })
    for (const f of files) {
      writeFileSync(join(out, f.name), f.data)
      log(join(out, f.name))
    }
    return 0
  } catch (e) {
    if (e instanceof DocError) e.errors.forEach(log)
    else log(e instanceof Error ? e.message : String(e))
    return 1
  } finally {
    await renderer?.close()
  }
}
