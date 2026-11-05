import type { ActivityRow } from '../api/activity'
import { describeActivity, formatChange } from './formatChange'

describe('formatChange', () => {
  it('formats a due date change', () => {
    expect(formatChange('milestone', 'due_date', '2026-12-01', '2026-12-15', 'PHP')).toBe('Due date: Dec 1, 2026 → Dec 15, 2026')
  })

  it('formats an amount change in the project currency', () => {
    expect(formatChange('milestone', 'amount', 15000, 20000, 'PHP')).toBe('Amount: ₱15,000.00 → ₱20,000.00')
  })

  it('shows a dash for a missing value', () => {
    expect(formatChange('milestone', 'due_date', null, '2026-12-15', 'PHP')).toBe('Due date: — → Dec 15, 2026')
  })

  it('lists added and removed acceptance criteria lines', () => {
    expect(formatChange('milestone', 'acceptance_criteria', ['Wireframes', 'Sitemap'], ['Sitemap', 'Copy deck'], 'PHP')).toBe(
      'Acceptance criteria: added “Copy deck”; removed “Wireframes”',
    )
  })

  it('uses the status word, not the raw value', () => {
    expect(formatChange('milestone', 'status', 'planned', 'in_progress', 'PHP')).toBe('Status: Planned → In progress')
    expect(formatChange('task', 'status', 'todo', 'done', 'PHP')).toBe('Status: To do → Done')
  })

  it('writes the hold flag as words', () => {
    expect(formatChange('milestone', 'on_hold', false, true, 'PHP')).toBe('On hold: No → Yes')
  })

  it('quotes text values', () => {
    expect(formatChange('milestone', 'title', 'Discovery', 'Discovery & wireframes', 'PHP')).toBe('Title: “Discovery” → “Discovery & wireframes”')
  })
})

const row = (over: Partial<ActivityRow>): ActivityRow => ({
  id: 'a1',
  project_id: 'p1',
  actor_id: 'u1',
  entity: 'milestone',
  entity_id: 'm1',
  action: 'updated',
  changes: null,
  reason: null,
  plan_change: false,
  created_at: '2026-11-05T08:00:00Z',
  actor_name: 'CJ',
  acks: [],
  ...over,
})

describe('describeActivity', () => {
  it('names the subject, lists each change and appends the reason', () => {
    const text = describeActivity(
      row({ changes: { due_date: ['2026-12-01', '2026-12-15'] }, reason: 'client asked' }),
      { currency: 'PHP', subjectName: 'Build' },
    )
    expect(text).toBe('Milestone “Build” — Due date: Dec 1, 2026 → Dec 15, 2026. Reason: client asked')
  })

  it('joins several changes', () => {
    const text = describeActivity(row({ changes: { amount: [100, 200], title: ['A', 'B'] } }), { currency: 'PHP', subjectName: 'A' })
    expect(text).toBe('Milestone “A” — Amount: ₱100.00 → ₱200.00; Title: “A” → “B”')
  })

  it('says what was added, using the title recorded with the row', () => {
    expect(describeActivity(row({ action: 'created', changes: { title: [null, 'Build'] } }), { currency: 'PHP' })).toBe('Added milestone “Build”')
  })

  it('says what was removed even though the row is gone', () => {
    expect(describeActivity(row({ action: 'deleted', changes: { title: ['Build', null] } }), { currency: 'PHP' })).toBe('Removed milestone “Build”')
  })

  it('describes a task status change', () => {
    const text = describeActivity(row({ entity: 'task', action: 'status_changed', changes: { status: ['todo', 'done'] } }), {
      currency: 'PHP',
      subjectName: 'Wireframes',
    })
    expect(text).toBe('Task “Wireframes” — Status: To do → Done')
  })

  it('hides bookkeeping columns such as approved_at', () => {
    const text = describeActivity(
      row({
        action: 'status_changed',
        changes: { status: ['in_review', 'approved'], approved_at: [null, '2026-11-05T08:00:00Z'], approved_by: [null, 'u1'], position: [1, 2] },
      }),
      { currency: 'PHP', subjectName: 'Build' },
    )
    expect(text).toBe('Milestone “Build” — Status: In review → Approved')
  })

  it('formats payments and updates', () => {
    expect(describeActivity(row({ entity: 'payment', action: 'created', changes: { amount: [null, 500] } }), { currency: 'PHP' })).toBe('Added payment ₱500.00')
    expect(describeActivity(row({ entity: 'update', action: 'created' }), { currency: 'PHP' })).toBe('Posted an update')
  })

  it('falls back to the bare entity word when no name is known', () => {
    expect(describeActivity(row({ changes: { due_date: ['2026-12-01', '2026-12-15'] } }), { currency: 'PHP' })).toBe(
      'Milestone — Due date: Dec 1, 2026 → Dec 15, 2026',
    )
  })
})
