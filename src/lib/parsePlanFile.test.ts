import { MAX_PLAN_BYTES, parsePlanFile, parsePlanText } from './parsePlanFile'

const file = (text: string, name = 'plan.json') => new File([text], name, { type: 'application/json' })

describe('parsePlanText', () => {
  it('returns the parsed object', () => {
    expect(parsePlanText('{"schema_version":1}')).toEqual({ ok: true, plan: { schema_version: 1 } })
  })

  it('reports the line and column of a syntax error', () => {
    const r = parsePlanText('{\n  "a": 1,\n  "b": ,\n}')
    expect(r).toEqual({ ok: false, message: "plan.json isn't valid JSON (line 3, column 8)" })
  })

  it('reports an unfinished file at its end', () => {
    const r = parsePlanText('{"a": 1,\n')
    expect(r.ok).toBe(false)
    expect(!r.ok && r.message).toMatch(/^plan\.json isn't valid JSON \(line \d+, column \d+\)$/)
  })

  it.each([['[1,2]'], ['"text"'], ['42'], ['null']])('refuses %s: the plan must be an object', (text) => {
    expect(parsePlanText(text)).toEqual({ ok: false, message: 'plan.json must be a JSON object' })
  })
})

describe('parsePlanFile', () => {
  it('refuses a file over 256 KB without reading it', async () => {
    const big = file('x'.repeat(MAX_PLAN_BYTES + 1))
    expect(await parsePlanFile(big)).toEqual({ ok: false, message: 'plan.json is too big (256 KB at most)' })
  })

  it('accepts a file of exactly 256 KB', async () => {
    const pad = ' '.repeat(MAX_PLAN_BYTES - 2)
    expect(await parsePlanFile(file(`{}${pad}`))).toEqual({ ok: true, plan: {} })
  })

  it('refuses a file that is not .json', async () => {
    expect(await parsePlanFile(file('{}', 'plan.txt'))).toEqual({ ok: false, message: 'Choose a .json file' })
  })

  it('parses a good file', async () => {
    expect(await parsePlanFile(file('{"project":{"title":"x"}}'))).toEqual({ ok: true, plan: { project: { title: 'x' } } })
  })
})
