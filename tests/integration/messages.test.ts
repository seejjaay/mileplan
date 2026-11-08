import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { adminServiceClient, signIn } from './env'

const service = adminServiceClient()
let project: string
let anaId: string

async function userId(email: string): Promise<string> {
  const { data, error } = await service.auth.admin.listUsers({ perPage: 200 })
  if (error) throw error
  return data.users.find((u) => u.email === email)!.id
}

/** Subscribes to message inserts for `project` and resolves once the server is streaming them (see realtime.test.ts). */
async function listen(client: SupabaseClient): Promise<{ events: unknown[]; stop: () => void }> {
  const events: unknown[] = []
  const channel = client.channel(`msg-test-${Math.random().toString(36).slice(2)}`)
  channel.on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages', filter: `project_id=eq.${project}` }, (payload) => events.push(payload))
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
  const { data, error } = await service.from('projects').insert({ title: 'messages-test', status: 'active' }).select('id').single()
  if (error) throw error
  project = data.id
  anaId = await userId('ana@client-a.test')
  await service.from('project_members').insert({ project_id: project, user_id: anaId })
})

afterAll(async () => {
  await service.from('projects').delete().eq('id', project)
})

describe('messages over realtime', () => {
  it('delivers a client message to the admin, not to another client, and counts it as unread until read', async () => {
    const admin = await signIn('admin@mileplan.test')
    const ana = await signIn('ana@client-a.test')
    const ben = await signIn('ben@client-b.test')
    const adminChannel = await listen(admin)
    const benChannel = await listen(ben)

    const { error } = await ana.from('messages').insert({ project_id: project, sender_id: anaId, body: 'Hello from Ana' })
    expect(error).toBeNull()

    await expect.poll(() => adminChannel.events.length, { timeout: 5000 }).toBe(1)
    await new Promise((r) => setTimeout(r, 3000))
    expect(benChannel.events).toHaveLength(0)

    const counts = async () => {
      const { data, error: e } = await admin.rpc('unread_message_counts')
      if (e) throw e
      return (data as { project_id: string; unread: number }[]).find((r) => r.project_id === project)?.unread ?? 0
    }
    expect(await counts()).toBe(1)
    const { error: readError } = await admin.rpc('mark_messages_read', { p_project_id: project })
    expect(readError).toBeNull()
    expect(await counts()).toBe(0)

    adminChannel.stop()
    benChannel.stop()
  })
})
