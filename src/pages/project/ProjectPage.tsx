import { lazy, Suspense, useMemo, type ComponentType } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { getProject, type ProjectSummary } from '../../api/projects'
import { qk } from '../../api/keys'
import { ReconnectingPill } from '../../realtime/ReconnectingPill'
import { useProjectRealtime } from '../../realtime/useProjectRealtime'
import { toUserMessage } from '../../lib/errors'
import { useTitle } from '../../lib/useTitle'
import { Button } from '../../ui/Button'
import { ProgressBar } from '../../ui/ProgressBar'
import { StatusChip } from '../../ui/StatusChip'
import { ChangeMarkersContext } from './changeMarkers'
import { PlanChangeBanner } from './PlanChangeBanner'
import { projectChip } from './projectStatus'
import { resolveTab, TABS, type TabKey } from './tabs'
import { useProjectMarkers } from './useProjectMarkers'
import type { ChangeMarkers } from './changeMarkers'

const PANELS: Record<TabKey, React.LazyExoticComponent<ComponentType<{ project: ProjectSummary }>>> = {
  overview: lazy(() => import('./OverviewTab')),
  milestones: lazy(() => import('./milestones/MilestonesTab')),
  updates: lazy(() => import('./UpdatesTab')),
  files: lazy(() => import('./FilesTab')),
  timeline: lazy(() => import('./TimelineTab')),
}

function Skeleton() {
  return <div role="status" aria-label="Loading" aria-busy="true" className="h-24 animate-pulse rounded-md bg-[var(--border)]" />
}

export default function ProjectPage() {
  const { id = '', tab: rawTab } = useParams()
  const tab = resolveTab(rawTab)
  const query = useQuery({ queryKey: qk.project(id), queryFn: () => getProject(id), enabled: !!id })
  const project = query.data
  const { reconnecting, lastChange } = useProjectRealtime(id)
  const visit = useProjectMarkers(id)
  const markers = useMemo<ChangeMarkers>(
    () => ({ ...visit, tick: lastChange ? { id: lastChange.id, at: lastChange.at } : null }),
    [visit, lastChange],
  )
  useTitle(project ? project.title : 'Project')

  if (query.isPending) return <Skeleton />
  if (query.isError || !project) {
    return (
      <div role="alert" className="flex flex-col items-start gap-3 rounded-md border border-[var(--danger)] p-4">
        <p>{toUserMessage(query.error)}</p>
        <Button variant="secondary" onClick={() => void query.refetch()}>
          Retry
        </Button>
        <Link to="/" className="underline">
          Back to start
        </Link>
      </div>
    )
  }

  const Panel = PANELS[tab]
  return (
    <ChangeMarkersContext.Provider value={markers}>
    <div className="flex flex-col gap-4">
      <ReconnectingPill visible={reconnecting} />
      <header className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold">{project.title}</h1>
          <StatusChip {...projectChip[project.status]} />
        </div>
        <div className="flex max-w-sm flex-col gap-1">
          <ProgressBar value={project.percent} label="Project progress" />
          <span className="text-sm text-[var(--muted)]">{project.percent}% complete</span>
        </div>
      </header>

      <PlanChangeBanner project={project} />

      <nav aria-label="Project sections" className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
        <ul className="flex min-w-max gap-1 border-b border-[var(--border)]">
          {TABS.map((t) => {
            const updated = markers.tabs.has(t.key) && t.key !== tab // no dot on the tab you are already reading
            return (
            <li key={t.key}>
              <Link
                to={`/projects/${id}/${t.key}`}
                aria-current={t.key === tab ? 'page' : undefined}
                aria-label={updated ? `${t.label} (updated)` : undefined}
                className={`block whitespace-nowrap px-3 py-2 text-sm font-medium ${
                  t.key === tab ? 'border-b-2 border-[var(--accent)] text-[var(--text)]' : 'text-[var(--muted)]'
                }`}
              >
                {t.label}
                {updated && (
                  <span aria-hidden="true" className="ml-1 text-[var(--accent)]">
                    •
                  </span>
                )}
              </Link>
            </li>
            )
          })}
        </ul>
      </nav>

      <section aria-label={TABS.find((t) => t.key === tab)?.label}>
        <Suspense fallback={<Skeleton />}>
          <Panel project={project} />
        </Suspense>
      </section>
    </div>
    </ChangeMarkersContext.Provider>
  )
}
