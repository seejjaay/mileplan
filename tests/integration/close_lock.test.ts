import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { adminServiceClient, signIn } from './env'

const service = adminServiceClient()
const png = new Blob([new Uint8Array([137, 80, 78, 71])], { type: 'image/png' })

let project: string
let ana: SupabaseClient

async function userId(email: string): Promise<string> {
  const { data, error } = await service.auth.admin.listUsers({ perPage: 200 })
  if (error) throw error
  const u = data.users.find((x) => x.email === email)
  if (!u) throw new Error(`seed user missing: ${email}`)
  return u.id
}

async function setStatus(status: 'active' | 'completed'): Promise<void> {
  const { error } = await service
    .from('projects')
    .update({ status, closed_at: status === 'active' ? null : new Date().toISOString() })
    .eq('id', project)
  if (error) throw error
}

beforeAll(async () => {
  const { data, error } = await service.from('projects').insert({ title: 'close-lock-test', status: 'active' }).select('id').single()
  if (error) throw error
  project = data.id
  const { error: e2 } = await service.from('project_members').insert({ project_id: project, user_id: await userId('ana@client-a.test') })
  if (e2) throw e2
  ana = await signIn('ana@client-a.test')
})

afterAll(async () => {
  await service.storage.from('payment-proofs').remove([`${project}/open.png`, `${project}/closed.png`, `${project}/reopened.png`])
  await service.from('projects').delete().eq('id', project)
})

describe('closed-project storage lock', () => {
  it('client uploads proof while the project is open', async () => {
    const { error } = await ana.storage.from('payment-proofs').upload(`${project}/open.png`, png, { contentType: 'image/png' })
    expect(error).toBeNull()
  })

  it("client cannot upload a proof file into a closed project's folder, and can again after reopen", async () => {
    await setStatus('completed')
    const closed = await ana.storage.from('payment-proofs').upload(`${project}/closed.png`, png, { contentType: 'image/png' })
    expect(closed.error).not.toBeNull()

    await setStatus('active')
    const reopened = await ana.storage.from('payment-proofs').upload(`${project}/reopened.png`, png, { contentType: 'image/png' })
    expect(reopened.error).toBeNull()
  })
})
