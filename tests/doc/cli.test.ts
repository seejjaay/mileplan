import { appendFileSync, cpSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { runDoc } from '../../scripts/doc/cli.ts'

const temps: string[] = []

function copyFixture(): string {
  const dir = mkdtempSync(join(tmpdir(), 'doc-cli-'))
  temps.push(dir)
  cpSync('scripts/doc/fixtures/acme', dir, { recursive: true })
  return dir
}

const outFiles = (dir: string) => (existsSync(join(dir, 'out')) ? readdirSync(join(dir, 'out')).sort() : [])

async function run(args: string[]): Promise<{ code: number; log: string }> {
  const lines: string[] = []
  const code = await runDoc(args, (l) => lines.push(l))
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
    expect(log).toContain('is not Times New Roman')
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
