// @vitest-environment node
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { loadClient, loadDeveloper, loadPrices } from '../../../scripts/doc/load.ts'
import { DocError } from '../../../scripts/doc/types.ts'

const FIXTURE = 'scripts/doc/fixtures/acme'
const temps: string[] = []

function copyFixture(): string {
  const dir = mkdtempSync(join(tmpdir(), 'doc-'))
  temps.push(dir)
  cpSync(FIXTURE, dir, { recursive: true })
  return dir
}

function editJson(dir: string, file: string, edit: (o: Record<string, unknown>) => void) {
  const path = join(dir, file)
  const obj = JSON.parse(readFileSync(path, 'utf8'))
  edit(obj)
  writeFileSync(path, JSON.stringify(obj))
}

function errorsOf(dir: string): string[] {
  try {
    loadClient(dir)
  } catch (e) {
    if (e instanceof DocError) return e.errors
    throw e
  }
  return []
}

afterEach(() => {
  while (temps.length) rmSync(temps.pop()!, { recursive: true, force: true })
})

describe('loadClient', () => {
  it('loads the fixture client', () => {
    const c = loadClient(FIXTURE)
    expect(c.plan.payments!.length).toBe(2)
    expect(c.prose.scope.length).toBeGreaterThan(0)
    expect(c.slug).toBe('acme')
  })

  it('reports schema errors with paths', () => {
    const dir = copyFixture()
    editJson(dir, 'doc.json', (o) => {
      ;(o.source_code as { multiplier: number }).multiplier = 4
      o.foo = 1
    })
    const errors = errorsOf(dir)
    expect(errors.some((e) => e.includes('doc.json') && e.includes('/source_code/multiplier'))).toBe(true)
    expect(errors.some((e) => e.includes('doc.json') && e.includes('foo'))).toBe(true)
  })

  it('reports plan.json errors with the plan prefix', () => {
    const dir = copyFixture()
    editJson(dir, 'plan.json', (o) => {
      delete o.milestones
    })
    expect(errorsOf(dir).some((e) => e.startsWith('plan.json'))).toBe(true)
  })

  it('reports every missing prose file in one error', () => {
    const dir = copyFixture()
    rmSync(join(dir, 'glossary.md'))
    rmSync(join(dir, 'users.md'))
    const errors = errorsOf(dir)
    expect(errors.some((e) => e.includes('glossary.md'))).toBe(true)
    expect(errors.some((e) => e.includes('users.md'))).toBe(true)
  })
})

describe('shared data files', () => {
  it('prices.json has the package and add-on keys the fixture uses', () => {
    const p = loadPrices()
    expect(p.packages.find((x) => x.key === 'custom-web-app')?.from).toBe(35000)
    expect(p.addons.find((x) => x.key === 'extra-page')?.price).toBe(1000)
    expect(p.source_code_multiplier).toEqual({ min: 1.5, max: 3 })
  })

  it('developer.json has CJ', () => {
    expect(loadDeveloper().name).toBe('CJ Nicko Rosales')
  })
})
