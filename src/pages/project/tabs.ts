export const TABS = [
  { key: 'overview', label: 'Overview' },
  { key: 'milestones', label: 'Milestones' },
  { key: 'updates', label: 'Updates' },
  { key: 'files', label: 'Files' },
  { key: 'payments', label: 'Payments' },
  { key: 'messages', label: 'Messages' },
  { key: 'timeline', label: 'Timeline' },
] as const

export type TabKey = (typeof TABS)[number]['key']

export function resolveTab(raw: string | undefined): TabKey {
  return TABS.find((t) => t.key === raw)?.key ?? 'overview'
}
