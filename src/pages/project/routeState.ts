import type { Milestone } from '../../api/milestones'

export type RouteInput = Pick<Milestone, 'id' | 'title' | 'status' | 'on_hold' | 'due_date'>
export type RouteStep = { id: string; title: string; due_date: string | null; kind: 'done' | 'current' | 'future'; word: string }

const DONE = new Set(['approved', 'paid'])

/** Where each milestone sits on the route: done, the single current one (first unfinished), or ahead. Always with a word. */
export function routeState(milestones: RouteInput[]): RouteStep[] {
  const currentIndex = milestones.findIndex((m) => !DONE.has(m.status))
  return milestones.map((m, i) => {
    const done = DONE.has(m.status)
    const kind = done ? 'done' : i === currentIndex ? 'current' : 'future'
    const word = done
      ? 'Done'
      : m.on_hold
        ? 'On hold'
        : m.status === 'in_review'
          ? 'In review'
          : m.status === 'in_progress'
            ? 'In progress'
            : kind === 'current'
              ? 'Next'
              : 'Upcoming'
    return { id: m.id, title: m.title, due_date: m.due_date, kind, word }
  })
}
