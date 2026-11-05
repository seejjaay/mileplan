import { useInfiniteQuery, type UseQueryResult } from '@tanstack/react-query'
import { listActivity, type ActivityRow } from '../../api/activity'
import { qk } from '../../api/keys'
import type { ProjectSummary } from '../../api/projects'
import { ACTIVITY_PAGE_SIZE } from '../../lib/constants'
import { describeActivity } from '../../lib/formatChange'
import { AsyncView } from '../../ui/AsyncView'
import { Button } from '../../ui/Button'
import { StatusChip } from '../../ui/StatusChip'
import { useEntityNames } from './useEntityNames'

function whenLabel(iso: string): string {
  return new Date(iso).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' })
}

export default function TimelineTab({ project }: { project: ProjectSummary }) {
  const activity = useInfiniteQuery({
    queryKey: qk.activity(project.id),
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) => listActivity(project.id, { before: pageParam }),
    getNextPageParam: (last) => (last.length === ACTIVITY_PAGE_SIZE ? last[last.length - 1].created_at : undefined),
  })
  const names = useEntityNames(project.id) // so "Milestone — Due date: …" can say which one it was

  const rows = activity.data?.pages.flat() ?? []
  // AsyncView only reads the status flags and `data`; hand it the flattened pages.
  const view = { ...activity, data: rows } as unknown as UseQueryResult<ActivityRow[]>

  return (
    <div className="flex flex-col gap-4">
      <h2 className="text-lg font-semibold">Timeline</h2>
      <AsyncView query={view} onRetry={() => void activity.refetch()} empty={<p className="text-[var(--muted)]">Nothing has happened yet.</p>}>
        {(items) => (
          <>
            <ul className="flex flex-col gap-3">
              {items.map((row) => (
                <li key={row.id} className="flex flex-col gap-1 rounded-md border border-[var(--border)] bg-[var(--surface)] p-3">
                  <p>{describeActivity(row, { currency: project.currency, subjectName: names.get(row.entity_id) })}</p>
                  <p className="flex flex-wrap items-center gap-2 text-sm text-[var(--muted)]">
                    <span>
                      {row.actor?.full_name ?? 'Project team'} · {whenLabel(row.created_at)}
                    </span>
                    {row.plan_change && <StatusChip status="attention" label="Plan change" />}
                  </p>
                </li>
              ))}
            </ul>
            {activity.hasNextPage && (
              <div>
                <Button variant="secondary" loading={activity.isFetchingNextPage} onClick={() => void activity.fetchNextPage()}>
                  Load older
                </Button>
              </div>
            )}
          </>
        )}
      </AsyncView>
    </div>
  )
}
