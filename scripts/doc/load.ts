import { existsSync, readFileSync } from 'node:fs'
import { basename, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import Ajv2020 from 'ajv/dist/2020.js'
import type { ErrorObject } from 'ajv'
import { DocError, PROSE_NAMES } from './types.ts'
import type { ClientInput, Developer, DocJson, Plan, Prices, ProseName } from './types.ts'

const ROOT = fileURLToPath(new URL('../../', import.meta.url))

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, 'utf8'))
}

const ajv = new Ajv2020({ allErrors: true, strict: false })
const validatePlan = ajv.compile(readJson(join(ROOT, 'schemas/plan.schema.json')) as object)
const validateDoc = ajv.compile(readJson(join(ROOT, 'schemas/doc.schema.json')) as object)

function describe(file: string, e: ErrorObject): string {
  const extra = 'additionalProperty' in e.params ? ` "${String(e.params.additionalProperty)}"` : ''
  return `${file}: ${e.instancePath || '/'} ${e.message}${extra}`
}

function loadJsonFile(dir: string, file: string, errors: string[]): unknown {
  const path = join(dir, file)
  if (!existsSync(path)) {
    errors.push(`${file}: file is missing (${path})`)
    return undefined
  }
  try {
    return readJson(path)
  } catch (e) {
    errors.push(`${file}: not valid JSON (${(e as Error).message})`)
    return undefined
  }
}

export function loadClient(dir: string): ClientInput {
  const errors: string[] = []
  const plan = loadJsonFile(dir, 'plan.json', errors)
  const doc = loadJsonFile(dir, 'doc.json', errors)
  if (plan !== undefined && !validatePlan(plan)) {
    for (const e of validatePlan.errors ?? []) errors.push(describe('plan.json', e))
  }
  if (doc !== undefined && !validateDoc(doc)) {
    for (const e of validateDoc.errors ?? []) errors.push(describe('doc.json', e))
  }
  const prose = {} as Record<ProseName, string>
  for (const name of PROSE_NAMES) {
    const path = join(dir, `${name}.md`)
    if (existsSync(path)) prose[name] = readFileSync(path, 'utf8').trim()
    else errors.push(`${name}.md: file is missing (${path})`)
  }
  if (errors.length) throw new DocError(errors)
  return { slug: basename(resolve(dir)), dir, plan: plan as Plan, doc: doc as DocJson, prose }
}

export function loadPrices(): Prices {
  return readJson(join(ROOT, 'templates/prices.json')) as Prices
}

export function loadDeveloper(): Developer {
  return readJson(join(ROOT, 'templates/developer.json')) as Developer
}
