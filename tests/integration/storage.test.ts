import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { adminServiceClient, signIn } from './env'

const service = adminServiceClient()
const pdf = new Blob(['%PDF-1.4 test'], { type: 'application/pdf' })
const png = new Blob([new Uint8Array([137, 80, 78, 71])], { type: 'image/png' })

let p1: string
let p2: string
let ana: SupabaseClient

async function userId(email: string): Promise<string> {
  const { data, error } = await service.auth.admin.listUsers({ perPage: 200 })
  if (error) throw error
  const u = data.users.find((x) => x.email === email)
  if (!u) throw new Error(`seed user missing: ${email}`)
  return u.id
}

async function makeProject(title: string, member: string): Promise<string> {
  const { data, error } = await service.from('projects').insert({ title, status: 'active' }).select('id').single()
  if (error) throw error
  const { error: e2 } = await service.from('project_members').insert({ project_id: data.id, user_id: member })
  if (e2) throw e2
  return data.id
}

beforeAll(async () => {
  p1 = await makeProject('storage-test-p1', await userId('ana@client-a.test'))
  p2 = await makeProject('storage-test-p2', await userId('ben@client-b.test'))
  for (const p of [p1, p2]) {
    const { error } = await service.storage.from('documents').upload(`${p}/contract.pdf`, pdf, { contentType: 'application/pdf' })
    if (error) throw error
  }
  ana = await signIn('ana@client-a.test')
})

afterAll(async () => {
  for (const p of [p1, p2]) {
    await service.storage.from('documents').remove([`${p}/contract.pdf`])
    await service.storage.from('payment-proofs').remove([`${p}/x.png`])
    await service.from('projects').delete().eq('id', p)
  }
})

describe('storage policies', () => {
  it('client uploads proof to own project', async () => {
    const { error } = await ana.storage.from('payment-proofs').upload(`${p1}/x.png`, png, { contentType: 'image/png', upsert: true })
    expect(error).toBeNull()
  })

  it('client cannot upload to documents', async () => {
    const { error } = await ana.storage.from('documents').upload(`${p1}/nope.pdf`, pdf, { contentType: 'application/pdf' })
    expect(error).not.toBeNull()
  })

  it('client cannot read other project file', async () => {
    const { data, error } = await ana.storage.from('documents').createSignedUrl(`${p2}/contract.pdf`, 60)
    expect(error).not.toBeNull()
    expect(data).toBeNull()
  })

  it('client reads own project document', async () => {
    const { data, error } = await ana.storage.from('documents').createSignedUrl(`${p1}/contract.pdf`, 60)
    expect(error).toBeNull()
    const res = await fetch(data!.signedUrl)
    expect(res.status).toBe(200)
  })

  it('rejects disallowed mime', async () => {
    const html = new Blob(['<script>1</script>'], { type: 'text/html' })
    const { error } = await ana.storage.from('payment-proofs').upload(`${p1}/bad.html`, html, { contentType: 'text/html' })
    expect(error).not.toBeNull()
  })
})
