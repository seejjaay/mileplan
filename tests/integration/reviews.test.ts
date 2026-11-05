import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { adminServiceClient, signIn } from './env'

const service = adminServiceClient()
let project: string
let m1: string
let m2: string
let anaId: string

beforeAll(async () => {
  const { data: users } = await service.auth.admin.listUsers({ perPage: 200 })
  anaId = users.users.find((u) => u.email === 'ana@client-a.test')!.id
  const { data: p } = await service.from('projects').insert({ title: 'reviews-test', status: 'active' }).select('id').single()
  project = p!.id
  await service.from('project_members').insert({ project_id: project, user_id: anaId })
  const insert = async (title: string, position: number) => {
    const { data, error } = await service.from('milestones').insert({ project_id: project, title, status: 'in_review', position }).select('id').single()
    if (error) throw error
    return data.id as string
  }
  m1 = await insert('A', 1)
  m2 = await insert('B', 2)
})

afterAll(async () => {
  await service.from('projects').delete().eq('id', project)
})

describe('client reviews against the real database', () => {
  it('approve moves the milestone to approved and is readable with the reviewer name', async () => {
    const ana = await signIn('ana@client-a.test')
    const { error } = await ana.from('milestone_reviews').insert({ milestone_id: m1, user_id: anaId, decision: 'approved', comment: null })
    expect(error).toBeNull()
    expect((await service.from('milestones').select('status').eq('id', m1).single()).data!.status).toBe('approved')

    const { data, error: listError } = await ana
      .from('milestone_reviews')
      .select('*, reviewer_name, milestones!inner(project_id)')
      .eq('milestones.project_id', project)
      .order('created_at', { ascending: false })
    expect(listError).toBeNull()
    expect(data).toHaveLength(1)
    expect(data![0].reviewer_name).toBe('ana')
  })

  it('request changes sends the milestone back to in_progress, and needs a comment', async () => {
    const ana = await signIn('ana@client-a.test')
    const blank = await ana.from('milestone_reviews').insert({ milestone_id: m2, user_id: anaId, decision: 'changes_requested', comment: '  ' })
    expect(blank.error?.code).toBe('23514')

    const ok = await ana.from('milestone_reviews').insert({ milestone_id: m2, user_id: anaId, decision: 'changes_requested', comment: 'Logo too small' })
    expect(ok.error).toBeNull()
    expect((await service.from('milestones').select('status').eq('id', m2).single()).data!.status).toBe('in_progress')
  })

  it('a second review of an already-reviewed milestone is refused with 42501', async () => {
    const ana = await signIn('ana@client-a.test')
    const again = await ana.from('milestone_reviews').insert({ milestone_id: m1, user_id: anaId, decision: 'approved', comment: null })
    expect(again.error?.code).toBe('42501')
  })

  it('the client can read the upsert-style acknowledgement path (ON CONFLICT DO NOTHING) for plan changes', async () => {
    const ana = await signIn('ana@client-a.test')
    const { data: act } = await service.from('activity').select('id').eq('project_id', project).limit(1).single()
    const ack = () =>
      ana.from('plan_change_acks').upsert([{ activity_id: act!.id, user_id: anaId }], { onConflict: 'activity_id,user_id', ignoreDuplicates: true })
    expect((await ack()).error).toBeNull()
    expect((await ack()).error).toBeNull() // second click is a no-op, not an error
    const { data } = await service.from('plan_change_acks').select('user_id').eq('activity_id', act!.id)
    expect(data).toHaveLength(1)
  })
})
