import { appendFileSync, cpSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { runDoc } from '../../scripts/doc/cli.ts'

const temps: string[] = []

function copyFixture(): string {
  const dir = mkdtempSync(join(tmpdir(), 'doc-cli-'))
  temps.push(dir)
  // Skip out/: a manual `npm run doc` on the fixture leaves exported files there.
  cpSync('scripts/doc/fixtures/acme', dir, { recursive: true, filter: (src) => basename(src) !== 'out' })
  return dir
}

const outFiles = (dir: string) => (existsSync(join(dir, 'out')) ? readdirSync(join(dir, 'out')).sort() : [])

const logCalls: unknown[][] = []

async function run(args: string[]): Promise<{ code: number; log: string }> {
  const lines: string[] = []
  logCalls.length = 0
  // Records every argument the way console.log would receive them.
  const code = await runDoc(args, (...a: unknown[]) => {
    logCalls.push(a)
    lines.push(String(a[0]))
  })
  return { code, log: lines.join('\n') }
}

afterEach(() => {
  while (temps.length) rmSync(temps.pop()!, { recursive: true, force: true })
})

describe('npm run doc', () => {
  it('writes 8 files by default', async () => {
    const dir = copyFixture()
    const slug = basename(dir)
    const { code } = await run([dir])
    expect(code).toBe(0)
    const docs = ['service-contract', 'project-agreement', 'srs', 'milestone-plan']
    expect(outFiles(dir)).toEqual(docs.flatMap((d) => [`${slug}-${d}.docx`, `${slug}-${d}.pdf`]).sort())
  })

  it('--only contract --format pdf writes one file', async () => {
    const dir = copyFixture()
    const { code } = await run([dir, '--only', 'contract', '--format', 'pdf'])
    expect(code).toBe(0)
    expect(outFiles(dir)).toEqual([`${basename(dir)}-service-contract.pdf`])
  })

  it('fails and leaves no files when prose has an emoji', async () => {
    const dir = copyFixture()
    appendFileSync(join(dir, 'scope.md'), '\n\nLaunch party \u{1F389}\n')
    const { code, log } = await run([dir, '--only', 'srs'])
    expect(code).toBe(1)
    expect(outFiles(dir)).toEqual([])
    expect(log).toContain('U+1F389')
  })

  it('a DOCX-only export also rejects characters Times New Roman lacks', async () => {
    const dir = copyFixture()
    appendFileSync(join(dir, 'scope.md'), '\n\nCart \u{1F6D2}\n')
    const { code, log } = await run([dir, '--only', 'srs', '--format', 'docx'])
    expect(code).toBe(1)
    expect(outFiles(dir)).toEqual([])
    expect(log).toContain('U+1F6D2')
  })

  it('logs exactly one argument per line on failure', async () => {
    const dir = copyFixture()
    rmSync(join(dir, 'glossary.md'))
    rmSync(join(dir, 'users.md'))
    const { code } = await run([dir])
    expect(code).toBe(1)
    expect(logCalls.length).toBeGreaterThan(1)
    expect(logCalls.every((a) => a.length === 1)).toBe(true)
  })

  it('validation failure writes nothing', async () => {
    const dir = copyFixture()
    const doc = JSON.parse(readFileSync(join(dir, 'doc.json'), 'utf8'))
    doc.source_code.multiplier = 4
    writeFileSync(join(dir, 'doc.json'), JSON.stringify(doc))
    const { code, log } = await run([dir])
    expect(code).toBe(1)
    expect(log).toContain('/source_code/multiplier')
    expect(outFiles(dir)).toEqual([])
  })

  it('rejects a source code multiplier below 1', async () => {
    const dir = copyFixture()
    const doc = JSON.parse(readFileSync(join(dir, 'doc.json'), 'utf8'))
    doc.source_code.multiplier = 0.9
    writeFileSync(join(dir, 'doc.json'), JSON.stringify(doc))
    const { code, log } = await run([dir])
    expect(code).toBe(1)
    expect(log).toContain('/source_code/multiplier')
    expect(outFiles(dir)).toEqual([])
  })

  it('a money rule failure writes nothing', async () => {
    const dir = copyFixture()
    const plan = JSON.parse(readFileSync(join(dir, 'plan.json'), 'utf8'))
    plan.payments[1].amount = 30000
    writeFileSync(join(dir, 'plan.json'), JSON.stringify(plan))
    const { code, log } = await run([dir, '--format', 'docx'])
    expect(code).toBe(1)
    expect(log).toContain('equal')
    expect(outFiles(dir)).toEqual([])
  })

  it('unknown --only value exits 2', async () => {
    const dir = copyFixture()
    const { code, log } = await run([dir, '--only', 'bogus'])
    expect(code).toBe(2)
    expect(log).toContain('Usage')
  })

  it('missing client folder argument exits 2', async () => {
    expect((await run([])).code).toBe(2)
  })
})
