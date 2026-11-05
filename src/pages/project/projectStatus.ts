import type { ProjectStatus } from '../../api/projects'
import type { ChipStatus } from '../../ui/StatusChip'

export const projectChip: Record<ProjectStatus, { status: ChipStatus; label: string }> = {
  setup: { status: 'upcoming', label: 'Setting up' },
  active: { status: 'active', label: 'Active' },
  completed: { status: 'done', label: 'Completed' },
  terminated: { status: 'inactive', label: 'Terminated' },
}
