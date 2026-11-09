import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import Handlebars from 'handlebars'
import type { RenderContext } from './context.ts'

export type DocName = 'contract' | 'agreement' | 'srs' | 'plan'

const TEMPLATES = fileURLToPath(new URL('../../templates/', import.meta.url))
const FILES: Record<DocName, string> = {
  contract: 'service-contract.md',
  agreement: 'project-agreement.md',
  srs: 'srs.md',
  plan: 'milestone-plan.md',
}

function engine(ctx: RenderContext): typeof Handlebars {
  const hb = Handlebars.create()
  // Escaped underscores, so a signature line is literal text in Markdown, never a rule or emphasis.
  hb.registerHelper('blank', (n: number) => '\\_'.repeat(n))
  hb.registerHelper('inc', (n: number) => n + 1)
  hb.registerHelper('prose', (name: keyof RenderContext['prose']) => ctx.prose[name])
  hb.registerPartial('signatures', readFileSync(join(TEMPLATES, '_signatures.md'), 'utf8'))
  return hb
}

export function renderDocument(name: DocName, ctx: RenderContext): string {
  const source = readFileSync(join(TEMPLATES, FILES[name]), 'utf8')
  const template = engine(ctx).compile(source, { strict: true, noEscape: true })
  return template(ctx).replace(/\n{3,}/g, '\n\n').trim() + '\n'
}
