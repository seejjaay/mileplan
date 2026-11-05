import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { adminServiceClient, signIn } from './env'

const service = adminServiceClient()
let project: string
let activityId: string
let adminId: string
let anaId: string

async function userId(email: string): Promise<string> {
  const { data, error } = await service.auth.admin.listUsers({ perPage: 200 })
  if (error) throw error
  return data.users.find((u) => u.email === email)!.id
}

beforeAll(async () => {
  adminId = await userId('admin@mileplan.test')
  anaId = await userId('ana@client-a.test')
  const { data: p } = await service.from('projects').insert({ title: 'names-test', status: 'active' }).select('id').single()
  project = p!.id
  await service.from('project_members').insert({ project_id: project, user_id: anaId })

  // Written as the admin so the audit trigger records the admin as the actor.
  const admin = await signIn('admin@mileplan.test')
  const { error } = await admin.from('updates').insert({ project_id: project, author_id: adminId, body: 'hello' })
  if (error) throw error
  const { data: act } = await service.from('activity').select('id').eq('project_id', project).eq('entity', 'update').single()
  activityId = act!.id
  await service.from('plan_change_acks').insert({ activity_id: activityId, user_id: anaId })
})

afterAll(async () => {
  await service.from('projects').delete().eq('id', project)
})

describe('display names through PostgREST', () => {
  it("a client reads the admin's name on updates and activity without being able to read the admin profile", async () => {
    const ana = await signIn('ana@client-a.test')
    const updates = await ana.from('updates').select('*, author_name').eq('project_id', project)
    expect(updates.error).toBeNull()
    expect(updates.data![0].author_name).toBe('admin')

    const activity = await ana.from('activity').select('*, actor_name').eq('project_id', project).eq('entity', 'update')
    expect(activity.data![0].actor_name).toBe('admin')

    const profile = await ana.from('profiles').select('id').eq('id', adminId)
    expect(profile.data).toEqual([])
  })

  it('embedded acknowledgements carry the acknowledger name for the admin', async () => {
    const admin = await signIn('admin@mileplan.test')
    const { data, error } = await admin.from('activity').select('id, acks:plan_change_acks(user_id, acked_at, acker_name)').eq('id', activityId).single()
    expect(error).toBeNull()
    expect(data!.acks).toHaveLength(1)
    expect(data!.acks[0].acker_name).toBe('ana')
  })

  it('an unrelated client cannot learn a stranger by id', async () => {
    const ben = await signIn('ben@client-b.test')
    const { data } = await ben.from('updates').select('*, author_name').eq('project_id', project)
    expect(data).toEqual([])
  })
})
