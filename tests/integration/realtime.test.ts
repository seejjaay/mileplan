import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { adminServiceClient, signIn } from './env'

const service = adminServiceClient()
let project: string
let milestone: string

async function userId(email: string): Promise<string> {
  const { data, error } = await service.auth.admin.listUsers({ perPage: 200 })
  if (error) throw error
  return data.users.find((u) => u.email === email)!.id
}

/**
 * Subscribes to milestone changes for `project` and resolves once the server is streaming them.
 * SUBSCRIBED only means the channel joined; the change stream is registered later (seconds later on a cold
 * Realtime) and announced by a `postgres_changes` system message. Writes before that are never delivered.
 */
async function listen(client: SupabaseClient): Promise<{ events: unknown[]; stop: () => void }> {
  const events: unknown[] = []
  const channel = client.channel(`rt-test-${Math.random().toString(36).slice(2)}`)
  channel.on('postgres_changes', { event: '*', schema: 'public', table: 'milestones', filter: `project_id=eq.${project}` }, (payload) => events.push(payload))
  await new Promise<void>((resolve, reject) => {
    channel.on('system', {}, (payload: { extension: string; status: string; message: string }) => {
      if (payload.extension !== 'postgres_changes') return
      if (payload.status === 'ok') resolve()
      else reject(new Error(`realtime postgres_changes ${payload.status}: ${payload.message}`))
    })
    channel.subscribe((status) => {
      if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') reject(new Error(`realtime ${status}`))
    })
  })
  return { events, stop: () => void client.removeChannel(channel) }
}

beforeAll(async () => {
  const { data, error } = await service.from('projects').insert({ title: 'realtime-test', status: 'active' }).select('id').single()
  if (error) throw error
  project = data.id
  await service.from('project_members').insert({ project_id: project, user_id: await userId('ana@client-a.test') })
  const { data: m } = await service.from('milestones').insert({ project_id: project, title: 'M1' }).select('id').single()
  milestone = m!.id
})

afterAll(async () => {
  await service.from('projects').delete().eq('id', project)
})

describe('realtime', () => {
  it('member receives a milestone change for their project', async () => {
    const ana = await signIn('ana@client-a.test')
    const { events, stop } = await listen(ana)
    await service.from('milestones').update({ title: 'M1 renamed' }).eq('id', milestone)
    await expect.poll(() => events.length, { timeout: 5000 }).toBeGreaterThan(0)
    stop()
  })

  it('non-member receives nothing', async () => {
    const ben = await signIn('ben@client-b.test')
    const { events, stop } = await listen(ben)
    await service.from('milestones').update({ title: 'M1 renamed again' }).eq('id', milestone)
    await new Promise((r) => setTimeout(r, 3000))
    expect(events).toHaveLength(0)
    stop()
  })
})
