// @vitest-environment node
import { marked } from 'marked'
import type { Token, Tokens } from 'marked'
import { describe, expect, it } from 'vitest'
import { buildContext, mdEscape, parseRequirements } from '../../../scripts/doc/context.ts'
import type { RenderContext } from '../../../scripts/doc/context.ts'
import { loadClient, loadDeveloper, loadPrices } from '../../../scripts/doc/load.ts'
import { renderDocument } from '../../../scripts/doc/render.ts'
import type { ClientInput, DocJson, Payment } from '../../../scripts/doc/types.ts'

const prices = loadPrices()
const developer = loadDeveloper()

function make(edit?: (c: ClientInput) => void): ClientInput {
  const c = structuredClone(loadClient('scripts/doc/fixtures/acme'))
  edit?.(c)
  return c
}
const ctxOf = (c = make()): RenderContext => buildContext(c, prices, developer)
const withDoc = (doc: Partial<DocJson>) => make((c) => Object.assign(c.doc, doc))

function headings(md: string, depth: number): string[] {
  return marked.lexer(md).filter((t): t is Tokens.Heading => t.type === 'heading' && t.depth === depth).map((t) => t.text)
}

// Plain text of an inline token list: escape tokens contribute the escaped character.
function plain(tokens: Token[] | undefined): string {
  return (tokens ?? [])
    .map((t) => {
      if ('tokens' in t && t.tokens) return plain(t.tokens)
      return 'text' in t ? String(t.text) : ''
    })
    .join('')
}

const SECTIONS = [
  'Parties',
  'Definitions',
  'Scope',
  'Additional features',
  'Fees and payment',
  'Deposit, deadline and delays',
  'Revisions',
  'Acceptance',
  'Client responsibilities',
  'Ownership and license',
  'Source code buyout',
  'Cancellation by the Client',
  'Confidentiality and personal data',
  'Warranty',
  'Limitation of liability',
  'Disputes',
]

describe('service contract', () => {
  it('has every section heading in order, without the academic section', () => {
    const h = headings(renderDocument('contract', ctxOf()), 2)
    expect(h).toEqual([...SECTIONS, 'Electronic signatures', 'Signatures'].map((s, i) => `${i + 1}. ${s}`))
  })

  it('adds the academic section before the closing sections when academic', () => {
    const h = headings(renderDocument('contract', ctxOf(withDoc({ academic: true }))), 2)
    expect(h).toEqual([...SECTIONS, 'Academic projects', 'Electronic signatures', 'Signatures'].map((s, i) => `${i + 1}. ${s}`))
  })

  it('academic section only when academic', () => {
    const off = renderDocument('contract', ctxOf())
    expect(off).not.toContain('Academic')
    const on = renderDocument('contract', ctxOf(withDoc({ academic: true, school: 'PUP', course: 'BSIT' })))
    expect(on).toContain('Academic projects')
    expect(on).toContain('walkthrough')
    expect(on).toContain('technical guide')
  })

  it('states the pinned terms', () => {
    const md = renderDocument('contract', ctxOf())
    expect(md).toContain('PHP 800.00')
    expect(md).toContain('30 days')
    expect(md).toContain('7 days')
    expect(md).toContain('Quezon City')
    expect(md).toContain('1.5')
    expect(md).toContain('9 November 2026')
  })
})

describe('project agreement', () => {
  it('always shows the buyout line', () => {
    expect(renderDocument('agreement', ctxOf())).toContain('PHP 105,000.00')
  })

  it('has no special terms section unless the project sets some', () => {
    const md = renderDocument('agreement', ctxOf())
    expect(headings(md, 2)).not.toContain('8. Special terms')
    expect(headings(md, 2)).toContain('8. Signatures')
  })

  it('prints special terms before the signatures and renumbers them', () => {
    const md = renderDocument('agreement', ctxOf(withDoc({ special_terms: ['Credit. The Client credits the Developer.'] })))
    const h = headings(md, 2)
    expect(h.slice(-2)).toEqual(['8. Special terms', '9. Signatures'])
    expect(md).toContain('Credit. The Client credits the Developer.')
  })

  it('payment table gains a buyout row when bought', () => {
    const bought = make((c) => {
      c.plan.payments!.push({ key: 'source-code', title: 'Source', amount: 105000, due_date: '2027-03-05' } as Payment)
    })
    const rows = (md: string) =>
      (marked.lexer(md).filter((t): t is Tokens.Table => t.type === 'table').find((t) => t.header[0].text === 'Payment')?.rows ?? []).length
    expect(rows(renderDocument('agreement', ctxOf(bought)))).toBe(3)
    expect(rows(renderDocument('agreement', ctxOf()))).toBe(2)
  })

  it('shows every fee label and the total', () => {
    const md = renderDocument('agreement', ctxOf())
    for (const label of ['Custom web application', 'Extra page', 'Domain and hosting setup', 'UI/UX mockups']) {
      expect(md).toContain(label)
    }
    expect(md).toContain('PHP 70,000.00')
  })

  it('escapes markdown in data values', () => {
    const c = make((x) => {
      x.doc.client.name = 'Dela Cruz & Sons *Inc*'
      x.plan.payments![0].title = 'Phase 1 | Build'
    })
    const tokens = marked.lexer(renderDocument('agreement', ctxOf(c)))
    const table = tokens.find((t): t is Tokens.Table => t.type === 'table' && t.header[0].text === 'Payment')!
    expect(table.rows[0]).toHaveLength(3)
    expect(table.rows[0][0].text).toContain('Phase 1')
    const paragraphs = tokens.filter((t): t is Tokens.Paragraph => t.type === 'paragraph').map((p) => plain(p.tokens))
    expect(paragraphs.some((p) => p.includes('Dela Cruz & Sons *Inc*'))).toBe(true)
  })
})

describe('srs', () => {
  it('numbers requirements', () => {
    const md = renderDocument('srs', ctxOf())
    expect(md).toContain('FR-5')
    expect(md).not.toContain('FR-6')
    expect(md).toContain('FR-1')
  })

  it('states it is the complete scope', () => {
    expect(renderDocument('srs', ctxOf())).toContain('complete scope')
  })
})

describe('milestone plan', () => {
  it('lists every milestone criteria and task', () => {
    const md = renderDocument('plan', ctxOf())
    for (const s of ['Wireframes for 6 screens approved', 'Sitemap signed off', 'Cart', 'Handover session', 'Launch']) {
      expect(md).toContain(s)
    }
  })
})

describe('strictness and helpers', () => {
  it('throws on a missing key', () => {
    const ctx = ctxOf() as Partial<RenderContext>
    delete ctx.disputeCity
    expect(() => renderDocument('contract', ctx as RenderContext)).toThrow()
  })

  it('template comments never render', () => {
    for (const name of ['contract', 'agreement', 'srs', 'plan'] as const) {
      expect(renderDocument(name, ctxOf()).toLowerCase()).not.toContain('not legal advice')
    }
  })

  it('mdEscape neutralises markdown characters', () => {
    expect(mdEscape('a*b_c|d#e`f')).toBe('a\\*b\\_c\\|d\\#e\\`f')
    expect(mdEscape('- not a list')).toBe('\\- not a list')
    expect(mdEscape('2. not a list')).toBe('2\\. not a list')
  })

  it('parseRequirements reads top-level bullets and joins continuation lines', () => {
    expect(parseRequirements('- one\n- two\n  continues\n\n- three')).toEqual(['one', 'two continues', 'three'])
  })
})

describe('review fixes', () => {
  it('contract has no ambiguous deadline-start sentence, and prices outside work', () => {
    const md = renderDocument('contract', ctxOf())
    expect(md).not.toContain('The deadline starts counting')
    expect(md).toContain('Work outside this Agreement')
  })

  it('handover waits on the last project payment, never the optional buyout', () => {
    const bought = make((c) => {
      c.plan.payments!.push({ key: 'source-code', title: 'Source', amount: 105000, due_date: '2027-03-05' } as Payment)
    })
    for (const name of ['contract', 'agreement'] as const) {
      expect(renderDocument(name, ctxOf(bought))).toContain('last project payment')
    }
    expect(renderDocument('contract', ctxOf())).not.toContain('every payment due under')
  })

  it('parseRequirements strips ordered and plus markers', () => {
    expect(parseRequirements('1. Login\n2) Logout\n+ Plus\n* Star')).toEqual(['Login', 'Logout', 'Plus', 'Star'])
  })
})

describe('revision rounds for the whole project', () => {
  it('contract counts rounds across the whole project, not per milestone', () => {
    const md = renderDocument('contract', ctxOf(withDoc({ revision_rounds: 3 })))
    expect(md).toContain('3 rounds of revisions are included for the whole project')
    expect(md).not.toContain('per milestone')
  })

  it('agreement states the number, defaulting to the minimum of 2', () => {
    expect(renderDocument('agreement', ctxOf(withDoc({ revision_rounds: 3 })))).toContain('Revision rounds included: 3')
    expect(renderDocument('agreement', ctxOf())).toContain('Revision rounds included: 2')
  })
})
