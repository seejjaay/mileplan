import type { ActivityEntity, ActivityRow } from '../api/activity'
import type { TabKey } from '../pages/project/tabs'

export type Changed = { milestones: Set<string>; tabs: Set<TabKey> }

// Which tab shows the thing that changed (every change also lands on the Timeline).
const TAB_FOR: Record<ActivityEntity, TabKey[]> = {
  project: [],
  milestone: ['milestones'],
  task: ['milestones'],
  review: ['milestones'],
  update: ['updates'],
  document: ['files'],
  payment: ['payments'],
  payment_request: ['payments'],
}

/**
 * What changed since the visitor's previous visit, ignoring their own actions.
 * `taskMilestone` maps task id -> milestone id so a task change can mark its milestone.
 * A null `since` (first visit) marks nothing.
 */
export function changedSince(rows: ActivityRow[], since: string | null, me: string, taskMilestone: Map<string, string>): Changed {
  const result: Changed = { milestones: new Set(), tabs: new Set() }
  if (!since) return result
  const cutoff = Date.parse(since)
  for (const row of rows) {
    if (Date.parse(row.created_at) <= cutoff || row.actor_id === me) continue
    result.tabs.add('timeline')
    for (const tab of TAB_FOR[row.entity]) result.tabs.add(tab)
    if (row.entity === 'milestone') result.milestones.add(row.entity_id)
    if (row.entity === 'task') {
      const milestoneId = taskMilestone.get(row.entity_id)
      if (milestoneId) result.milestones.add(milestoneId)
    }
  }
  return result
}
