import {
  AlignmentType,
  BorderStyle,
  Document,
  Footer,
  HeadingLevel,
  LevelFormat,
  Packer,
  PageNumber,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
} from 'docx'
import { marked } from 'marked'
import type { Token, Tokens } from 'marked'
import { FONT } from './fontcheck.ts'

type Fmt = { bold?: boolean; italics?: boolean; strike?: boolean }
type Block = Paragraph | Table

const AFTER = { after: 120 }

// marked HTML-escapes the text of escape and codespan tokens; a DOCX wants the literal characters.
function decode(s: string): string {
  return s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&')
}

function run(text: string, fmt: Fmt, extra: { break?: number } = {}): TextRun {
  return new TextRun({ text, font: FONT, bold: fmt.bold, italics: fmt.italics, strike: fmt.strike, ...extra })
}

function runs(tokens: Token[], fmt: Fmt = {}): TextRun[] {
  const out: TextRun[] = []
  for (const t of tokens) {
    switch (t.type) {
      case 'strong':
        out.push(...runs((t as Tokens.Strong).tokens, { ...fmt, bold: true }))
        break
      case 'em':
        out.push(...runs((t as Tokens.Em).tokens, { ...fmt, italics: true }))
        break
      case 'del':
        out.push(...runs((t as Tokens.Del).tokens, { ...fmt, strike: true }))
        break
      case 'link':
        out.push(...runs((t as Tokens.Link).tokens, fmt))
        break
      case 'br':
        out.push(run('', fmt, { break: 1 }))
        break
      case 'escape':
      case 'codespan':
        out.push(run(decode((t as Tokens.Escape).text), fmt))
        break
      case 'text': {
        const inner = (t as Tokens.Text).tokens
        if (inner?.length) out.push(...runs(inner, fmt))
        else out.push(run((t as Tokens.Text).text, fmt))
        break
      }
      default:
        out.push(run('raw' in t ? String(t.raw) : '', fmt))
    }
  }
  return out
}

type State = { orderedCount: number; orderedRefs: string[] }

function list(token: Tokens.List, level: number, state: State, ref?: string): Block[] {
  let reference = 'bullet'
  if (token.ordered) {
    reference = ref ?? `ol-${++state.orderedCount}`
    if (!state.orderedRefs.includes(reference)) state.orderedRefs.push(reference)
  }
  const out: Block[] = []
  for (const item of token.items) {
    for (const child of item.tokens) {
      if (child.type === 'list') out.push(...list(child as Tokens.List, level + 1, state))
      else if (child.type === 'text' || child.type === 'paragraph') {
        const inline = (child as Tokens.Text).tokens ?? [child]
        out.push(new Paragraph({ children: runs(inline), numbering: { reference, level }, spacing: { after: 60 } }))
      }
    }
  }
  return out
}

const HEADINGS = [HeadingLevel.HEADING_1, HeadingLevel.HEADING_2, HeadingLevel.HEADING_3]

function blocks(tokens: Token[], state: State): Block[] {
  const out: Block[] = []
  for (const t of tokens) {
    switch (t.type) {
      case 'heading': {
        const h = t as Tokens.Heading
        out.push(new Paragraph({ heading: HEADINGS[Math.min(h.depth, 3) - 1], children: runs(h.tokens) }))
        break
      }
      case 'paragraph':
        out.push(new Paragraph({ children: runs((t as Tokens.Paragraph).tokens), spacing: AFTER }))
        break
      case 'list':
        out.push(...list(t as Tokens.List, 0, state))
        break
      case 'table': {
        const tbl = t as Tokens.Table
        const cell = (c: Tokens.TableCell, bold: boolean) =>
          new TableCell({ children: [new Paragraph({ children: runs(c.tokens, bold ? { bold: true } : {}), spacing: { before: 40, after: 40 } })] })
        out.push(
          new Table({
            width: { size: 100, type: WidthType.PERCENTAGE },
            rows: [
              new TableRow({ tableHeader: true, children: tbl.header.map((c) => cell(c, true)) }),
              ...tbl.rows.map((r) => new TableRow({ children: r.map((c) => cell(c, false)) })),
            ],
          }),
          new Paragraph({ spacing: AFTER }),
        )
        break
      }
      case 'hr':
        out.push(new Paragraph({ border: { bottom: { style: BorderStyle.SINGLE, size: 6, space: 1, color: '000000' } }, spacing: AFTER }))
        break
      case 'space':
        break
      default:
        out.push(new Paragraph({ children: [run('raw' in t ? String(t.raw).trim() : '', {})], spacing: AFTER }))
    }
  }
  return out
}

export async function markdownToDocx(markdown: string, title: string): Promise<Buffer> {
  const state: State = { orderedCount: 0, orderedRefs: [] }
  const children = blocks(marked.lexer(markdown), state)
  const indent = (level: number) => ({ left: 720 + level * 360, hanging: 360 })
  const numbered = (reference: string) => ({
    reference,
    levels: [0, 1, 2].map((level) => ({
      level,
      format: LevelFormat.DECIMAL,
      text: `%${level + 1}.`,
      alignment: AlignmentType.LEFT,
      style: { paragraph: { indent: indent(level) } },
    })),
  })
  const heading = (size: number, before: number) => ({
    run: { font: FONT, size, bold: true, color: '000000' },
    paragraph: { spacing: { before, after: 120 } },
  })
  const doc = new Document({
    title,
    creator: 'CJ Nicko Rosales',
    styles: {
      default: {
        document: { run: { font: FONT, size: 24 }, paragraph: { spacing: { line: 276 } } },
        heading1: heading(32, 240),
        heading2: heading(28, 240),
        heading3: heading(24, 200),
      },
    },
    numbering: {
      config: [
        {
          reference: 'bullet',
          levels: [0, 1, 2].map((level) => ({
            level,
            format: LevelFormat.BULLET,
            text: level === 0 ? '•' : '–',
            alignment: AlignmentType.LEFT,
            style: { paragraph: { indent: indent(level) } },
          })),
        },
        ...state.orderedRefs.map(numbered),
      ],
    },
    sections: [
      {
        properties: { page: { size: { width: 12240, height: 15840 }, margin: { top: 1440, right: 1440, bottom: 1440, left: 1440 } } },
        footers: {
          default: new Footer({
            children: [
              new Paragraph({
                alignment: AlignmentType.CENTER,
                children: [new TextRun({ children: ['Page ', PageNumber.CURRENT, ' of ', PageNumber.TOTAL_PAGES], font: FONT, size: 20 })],
              }),
            ],
          }),
        },
        children,
      },
    ],
  })
  return Packer.toBuffer(doc)
}
