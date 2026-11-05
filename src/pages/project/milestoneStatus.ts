import type { MilestoneStatus } from '../../api/milestones'
import type { ChipStatus } from '../../ui/StatusChip'

export const milestoneChip: Record<MilestoneStatus, { status: ChipStatus; label: string }> = {
  planned: { status: 'upcoming', label: 'Planned' },
  in_progress: { status: 'active', label: 'In progress' },
  in_review: { status: 'attention', label: 'In review' },
  approved: { status: 'done', label: 'Approved' },
  paid: { status: 'done', label: 'Paid' },
}

export const holdChip = { status: 'inactive', label: 'On hold' } as const
