import type { Milestone } from '../../api/milestones'
import { routeState } from './routeState'

const ms = (id: string, status: Milestone['status'], over: Partial<Milestone> = {}) => ({ id, title: id, status, on_hold: false, due_date: null, ...over })

describe('routeState', () => {
  it('the first unfinished milestone is the current one; earlier ones are done, later ones are upcoming', () => {
    const steps = routeState([ms('a', 'approved'), ms('b', 'paid'), ms('c', 'planned'), ms('d', 'planned')])
    expect(steps.map((s) => s.kind)).toEqual(['done', 'done', 'current', 'future'])
    expect(steps.map((s) => s.word)).toEqual(['Done', 'Done', 'Next', 'Upcoming'])
  })

  it('the current milestone reads In review or In progress when it is', () => {
    expect(routeState([ms('a', 'approved'), ms('b', 'in_review')])[1]).toMatchObject({ kind: 'current', word: 'In review' })
    expect(routeState([ms('a', 'in_progress')])[0]).toMatchObject({ kind: 'current', word: 'In progress' })
  })

  it('work that is further ahead still reads by its own status', () => {
    const steps = routeState([ms('a', 'planned'), ms('b', 'in_review')])
    expect(steps[0]).toMatchObject({ kind: 'current', word: 'Next' })
    expect(steps[1]).toMatchObject({ kind: 'future', word: 'In review' })
  })

  it('when everything is done there is no current milestone', () => {
    const steps = routeState([ms('a', 'approved'), ms('b', 'paid')])
    expect(steps.some((s) => s.kind === 'current')).toBe(false)
  })

  it('on hold overrides the word but not the position', () => {
    const steps = routeState([ms('a', 'approved'), ms('b', 'in_progress', { on_hold: true })])
    expect(steps[1]).toMatchObject({ kind: 'current', word: 'On hold' })
  })

  it('an empty plan is an empty route', () => {
    expect(routeState([])).toEqual([])
  })

  it('carries title and due date through', () => {
    expect(routeState([ms('a', 'planned', { title: 'Discovery', due_date: '2026-12-01' })])[0]).toMatchObject({ id: 'a', title: 'Discovery', due_date: '2026-12-01' })
  })
})
