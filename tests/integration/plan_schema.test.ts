import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import Ajv2020 from 'ajv/dist/2020.js'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { adminServiceClient, signIn } from './env'

// plan.schema.json is for Claude and editors; import_plan is the authority. Every fixture must get the same
// verdict from both, so the two cannot drift apart. Rules JSON Schema can't express (unique keys, date order,
// cross-references, real calendar dates) live in `invalid-sql-only/` and are checked against SQL alone.

const FIXTURES = 'tests/fixtures/plans'
const service = adminServiceClient()
let admin: SupabaseClient
let project: string

const ajv = new Ajv2020({ allErrors: true, multipleOfPrecision: 2 })
const validateSchema = ajv.compile(JSON.parse(readFileSync('schemas/plan.schema.json', 'utf8')))

function load(dir: string): [string, unknown][] {
  return readdirSync(join(FIXTURES, dir))
    .filter((f) => f.endsWith('.json'))
    .map((f) => [f.replace(/\.json$/, ''), JSON.parse(readFileSync(join(FIXTURES, dir, f), 'utf8'))])
}

async function sqlVerdict(plan: unknown): Promise<boolean> {
  const { data, error } = await admin.rpc('import_plan', { p_project_id: project, p_plan: plan, p_dry_run: true })
  if (error) throw new Error(error.message)
  return (data as { valid: boolean }).valid
}

beforeAll(async () => {
  const { data, error } = await service.from('projects').insert({ title: 'plan-schema-test', status: 'setup' }).select('id').single()
  if (error) throw error
  project = data.id
  admin = await signIn('admin@mileplan.test')
})

afterAll(async () => {
  await service.from('projects').delete().eq('id', project)
})

describe('plan.schema.json and import_plan agree', () => {
  it('has a fixture for every folder', () => {
    expect(load('valid').length).toBeGreaterThan(0)
    expect(load('invalid').length).toBeGreaterThan(0)
    expect(load('invalid-sql-only').length).toBeGreaterThan(0)
  })

  it.each(load('valid'))('valid: %s', async (_name, plan) => {
    expect(validateSchema(plan), JSON.stringify(validateSchema.errors)).toBe(true)
    expect(await sqlVerdict(plan)).toBe(true)
  })

  it.each(load('invalid'))('invalid: %s', async (_name, plan) => {
    expect(validateSchema(plan)).toBe(false)
    expect(await sqlVerdict(plan)).toBe(false)
  })

  it.each(load('invalid-sql-only'))('invalid in SQL only: %s', async (_name, plan) => {
    expect(await sqlVerdict(plan)).toBe(false)
  })

  it('the example plan is valid on both', async () => {
    const example = JSON.parse(readFileSync('schemas/plan.example.json', 'utf8'))
    expect(validateSchema(example), JSON.stringify(validateSchema.errors)).toBe(true)
    expect(await sqlVerdict(example)).toBe(true)
  })
})
