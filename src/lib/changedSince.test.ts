import type { ActivityRow } from '../api/activity'
import { changedSince } from './changedSince'

const SINCE = '2026-11-05T08:00:00Z'
const AFTER = '2026-11-05T09:00:00Z'
const BEFORE = '2026-11-05T07:00:00Z'

const row = (over: Partial<ActivityRow>): ActivityRow => ({
  id: 'a',
  project_id: 'p1',
  actor_id: 'admin',
  entity: 'milestone',
  entity_id: 'm1',
  action: 'updated',
  changes: null,
  reason: null,
  plan_change: false,
  created_at: AFTER,
  actor_name: 'CJ',
  acks: [],
  ...over,
})

const none = new Map<string, string>()

describe('changedSince', () => {
  it('marks nothing on a first visit', () => {
    const result = changedSince([row({})], null, 'me', none)
    expect(result.milestones.size).toBe(0)
    expect(result.tabs.size).toBe(0)
  })

  it('ignores changes older than the last visit', () => {
    const result = changedSince([row({ created_at: BEFORE })], SINCE, 'me', none)
    expect(result.milestones.size).toBe(0)
    expect(result.tabs.size).toBe(0)
  })

  it('ignores my own changes', () => {
    const result = changedSince([row({ actor_id: 'me' })], SINCE, 'me', none)
    expect(result.milestones.size).toBe(0)
    expect(result.tabs.size).toBe(0)
  })

  it('a milestone change marks that milestone, the Milestones tab and the Timeline', () => {
    const result = changedSince([row({ entity: 'milestone', entity_id: 'm7' })], SINCE, 'me', none)
    expect([...result.milestones]).toEqual(['m7'])
    expect([...result.tabs].sort()).toEqual(['milestones', 'timeline'])
  })

  it('a task change marks its milestone', () => {
    const result = changedSince([row({ entity: 'task', entity_id: 't1' })], SINCE, 'me', new Map([['t1', 'm3']]))
    expect([...result.milestones]).toEqual(['m3'])
    expect(result.tabs.has('milestones')).toBe(true)
  })

  it('a task whose milestone is unknown still marks the tab', () => {
    const result = changedSince([row({ entity: 'task', entity_id: 'gone' })], SINCE, 'me', none)
    expect(result.milestones.size).toBe(0)
    expect(result.tabs.has('milestones')).toBe(true)
  })

  it('a document marks Files and the Timeline', () => {
    const result = changedSince([row({ entity: 'document', entity_id: 'd1' })], SINCE, 'me', none)
    expect([...result.tabs].sort()).toEqual(['files', 'timeline'])
    expect(result.milestones.size).toBe(0)
  })

  it('an update marks Updates and the Timeline', () => {
    const result = changedSince([row({ entity: 'update', entity_id: 'u1' })], SINCE, 'me', none)
    expect([...result.tabs].sort()).toEqual(['timeline', 'updates'])
  })

  it('a review marks the Milestones tab', () => {
    const result = changedSince([row({ entity: 'review', entity_id: 'r1' })], SINCE, 'me', none)
    expect(result.tabs.has('milestones')).toBe(true)
  })

  it('a project-level change marks only the Timeline', () => {
    const result = changedSince([row({ entity: 'project', entity_id: 'p1' })], SINCE, 'me', none)
    expect([...result.tabs]).toEqual(['timeline'])
  })

  it('treats a row with no actor (system change) as someone else’s', () => {
    const result = changedSince([row({ actor_id: null })], SINCE, 'me', none)
    expect(result.milestones.has('m1')).toBe(true)
  })
})
