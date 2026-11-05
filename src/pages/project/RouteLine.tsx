import type { CSSProperties } from 'react'
import { formatDate } from '../../lib/format'
import { StatusChip } from '../../ui/StatusChip'
import { useChangeMarkers } from './changeMarkers'
import { routeState, type RouteInput, type RouteStep } from './routeState'

type Props = { milestones: RouteInput[]; tick?: { id: string; at: number } | null }

function Marker({ kind, ticked, tickAt }: { kind: RouteStep['kind']; ticked: boolean; tickAt?: number }) {
  // Changing the key on a new tick restarts the one-shot animation.
  return (
    <span
      key={ticked ? `tick-${tickAt}` : 'marker'}
      aria-hidden="true"
      className={`route-marker route-marker--${kind}${ticked ? ' route-marker--tick' : ''}`}
    >
      {kind === 'done' && (
        <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M3.5 8.5l3 3 6-7" />
        </svg>
      )}
    </span>
  )
}

/**
 * The project as a route: markers for each milestone joined by a line that is drawn up to the current one.
 * Horizontal from `sm` up, vertical on phones (same markup, CSS only). State is always carried by shape AND a word.
 */
export function RouteLine({ milestones, tick }: Props) {
  const { milestones: changed, tick: contextTick } = useChangeMarkers()
  const activeTick = tick ?? contextTick
  const steps = routeState(milestones)
  const currentIndex = steps.findIndex((s) => s.kind === 'current')
  const reachedTo = currentIndex === -1 ? steps.length - 1 : currentIndex

  return (
    <ol aria-label="Milestone route" className="route" style={{ '--n': steps.length } as CSSProperties}>
      {steps.map((step, i) => (
        <li key={step.id} className="route-step" aria-current={step.kind === 'current' ? 'step' : undefined} style={{ '--i': i } as CSSProperties}>
          <Marker kind={step.kind} ticked={activeTick?.id === step.id} tickAt={activeTick?.at} />
          {i < steps.length - 1 && (
            <span
              aria-hidden="true"
              data-segment
              data-reached={i + 1 <= reachedTo ? 'true' : 'false'}
              className={`route-seg ${i + 1 <= reachedTo ? 'route-seg--reached' : 'route-seg--ahead'}`}
            />
          )}
          <div className="flex min-w-0 flex-col gap-0.5">
            <span className="route-title">{step.title}</span>
            <span className={`text-sm font-medium ${step.kind === 'future' ? 'text-[var(--muted)]' : ''}`}>{step.word}</span>
            {step.due_date && <span className="text-sm text-[var(--muted)]">{`Due ${formatDate(step.due_date)}`}</span>}
            {changed.has(step.id) && (
              <span className="mt-1">
                <StatusChip status="attention" label="Updated" />
              </span>
            )}
          </div>
        </li>
      ))}
    </ol>
  )
}
