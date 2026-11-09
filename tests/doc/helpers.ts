import { buildContext } from '../../scripts/doc/context.ts'
import { loadClient, loadDeveloper, loadPrices } from '../../scripts/doc/load.ts'
import { renderDocument } from '../../scripts/doc/render.ts'
import type { DocName } from '../../scripts/doc/render.ts'

export const DOC_NAMES: DocName[] = ['contract', 'agreement', 'srs', 'plan']

export function fixtureMarkdown(name: DocName, academic = false): string {
  const input = loadClient('scripts/doc/fixtures/acme')
  input.doc.academic = academic
  return renderDocument(name, buildContext(input, loadPrices(), loadDeveloper()))
}
