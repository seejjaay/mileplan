import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { adminServiceClient, anonClient, FUNCTIONS_URL, signIn } from './env'

const service = adminServiceClient()
const run = Math.random().toString(36).slice(2, 8)
const createdEmails: string[] = []

let adminJwt: string
let anaJwt: string

async function jwtOf(client: SupabaseClient): Promise<string> {
  const { data } = await client.auth.getSession()
  return data.session!.access_token
}

let ipCounter = 0
function freshIp(): string {
  ipCounter += 1
  return `10.${Math.floor(Math.random() * 200) + 20}.${ipCounter}.${Math.floor(Math.random() * 250) + 1}`
}

async function call(name: string, body: unknown, opts: { jwt?: string; ip?: string } = {}) {
  const res = await fetch(`${FUNCTIONS_URL}/${name}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(opts.jwt ? { authorization: `Bearer ${opts.jwt}` } : {}),
      'x-forwarded-for': opts.ip ?? freshIp(),
    },
    body: JSON.stringify(body),
  })
  const json = await res.json().catch(() => ({}))
  return { status: res.status, json: json as Record<string, unknown> }
}

function tokenOf(setupUrl: string): string {
  return new URL(setupUrl).hash.replace('#token=', '')
}

async function newClient(label: string) {
  const email = `${label}-${run}@client-c.test`
  createdEmails.push(email)
  const { status, json } = await call('create-client', { email, full_name: `Test ${label}` }, { jwt: adminJwt })
  expect(status).toBe(200)
  return { email, userId: json.user_id as string, setupUrl: json.setup_url as string }
}

async function authUsersWithEmail(email: string) {
  const { data } = await service.auth.admin.listUsers({ perPage: 200 })
  return data.users.filter((u) => u.email === email)
}

beforeAll(async () => {
  adminJwt = await jwtOf(await signIn('admin@mileplan.test'))
  anaJwt = await jwtOf(await signIn('ana@client-a.test'))
})

afterAll(async () => {
  for (const email of createdEmails) {
    for (const u of await authUsersWithEmail(email)) await service.auth.admin.deleteUser(u.id)
  }
})

describe('onboarding functions', () => {
  it('create-client returns setup url', async () => {
    const c = await newClient('url')
    expect(c.setupUrl).toMatch(/^http:\/\/localhost:5173\/setup#token=[A-Za-z0-9_-]{43}$/)
  })

  it('create-client normalizes email', async () => {
    const { status, json } = await call('create-client', { email: ' Ana@Client-A.test ', full_name: 'Ana' }, { jwt: adminJwt })
    expect(status).toBe(200)
    expect(json.linked_existing).toBe(true)
    expect(json.setup_url).toBeNull()
    expect(await authUsersWithEmail('ana@client-a.test')).toHaveLength(1)
  })

  it('create-client forbidden for client', async () => {
    const { status } = await call('create-client', { email: `nope-${run}@client-c.test`, full_name: 'No' }, { jwt: anaJwt })
    expect(status).toBe(403)
  })

  it('redeem sets password and allows sign in', async () => {
    const c = await newClient('redeem')
    const { status, json } = await call('redeem-setup', { token: tokenOf(c.setupUrl), password: 'brand-new-pw-1' })
    expect(status).toBe(200)
    expect(json.email).toBe(c.email)
    const signedIn = await signIn(c.email, 'brand-new-pw-1')
    expect((await signedIn.auth.getUser()).data.user?.email).toBe(c.email)
  })

  it('redeem twice concurrently', async () => {
    const c = await newClient('twice')
    const token = tokenOf(c.setupUrl)
    const results = await Promise.all([
      call('redeem-setup', { token, password: 'concurrent-pw-1' }),
      call('redeem-setup', { token, password: 'concurrent-pw-1' }),
    ])
    expect(results.map((r) => r.status).sort()).toEqual([200, 410])
    expect(results.find((r) => r.status === 410)!.json.error).toBe('invalid_or_expired')
  })

  it('redeem rejects short password without consuming token', async () => {
    const c = await newClient('short')
    const token = tokenOf(c.setupUrl)
    const bad = await call('redeem-setup', { token, password: 'short' })
    expect(bad.status).toBe(400)
    expect(bad.json.error).toBe('weak_password')
    const good = await call('redeem-setup', { token, password: 'long-enough-pw-1' })
    expect(good.status).toBe(200)
  })

  it('expired token returns 410', async () => {
    const c = await newClient('expired')
    await service.from('setup_tokens').update({ expires_at: new Date(Date.now() - 1000).toISOString() }).eq('user_id', c.userId)
    const { status } = await call('redeem-setup', { token: tokenOf(c.setupUrl), password: 'long-enough-pw-1' })
    expect(status).toBe(410)
  })

  it('regenerate invalidates old link', async () => {
    const c = await newClient('regen')
    const { status, json } = await call('regenerate-setup-link', { user_id: c.userId }, { jwt: adminJwt })
    expect(status).toBe(200)
    const old = await call('redeem-setup', { token: tokenOf(c.setupUrl), password: 'long-enough-pw-1' })
    expect(old.status).toBe(410)
    const fresh = await call('redeem-setup', { token: tokenOf(json.setup_url as string), password: 'long-enough-pw-1' })
    expect(fresh.status).toBe(200)
  })

  it('deactivated client cannot sign in', async () => {
    const c = await newClient('deact')
    await call('redeem-setup', { token: tokenOf(c.setupUrl), password: 'long-enough-pw-1' })
    const off = await call('set-client-active', { user_id: c.userId, active: false }, { jwt: adminJwt })
    expect(off.status).toBe(200)
    const { error } = await anonClient().auth.signInWithPassword({ email: c.email, password: 'long-enough-pw-1' })
    expect(error).not.toBeNull()
    const { data } = await service.from('profiles').select('active').eq('id', c.userId).single()
    expect(data!.active).toBe(false)
    const on = await call('set-client-active', { user_id: c.userId, active: true }, { jwt: adminJwt })
    expect(on.status).toBe(200)
    await expect(signIn(c.email, 'long-enough-pw-1')).resolves.toBeDefined()
  })

  it('rate limit', async () => {
    const ip = freshIp()
    const statuses: number[] = []
    for (let i = 0; i < 11; i++) {
      const r = await call('redeem-setup', { token: `bogus-${i}`, password: 'long-enough-pw-1' }, { ip })
      statuses.push(r.status)
    }
    expect(statuses.slice(0, 10).every((s) => s === 410)).toBe(true)
    expect(statuses[10]).toBe(429)
  })
})
