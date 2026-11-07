import type { ReactNode } from 'react'
import { planImportSummary, type FieldChanges, type PlanImportResult } from '../../../api/planImport'
import { formatChange } from '../../../lib/formatChange'
import { formatDate, formatMoney } from '../../../lib/format'

type Props = {
  result: PlanImportResult
  currency: string
  /** An empty project gets a tree of what will be created; anything else gets a diff. */
  tree: boolean
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <h3 className="text-sm font-semibold uppercase tracking-wide text-[var(--muted)]">{title}</h3>
      {children}
    </section>
  )
}

const rowClass = 'min-w-0 break-words rounded-md border border-[var(--border)] bg-[var(--surface)] p-3'

function Kind({ children }: { children: string }) {
  return <span className="mr-2 text-xs uppercase tracking-wide text-[var(--muted)]">{children}</span>
}

function ChangeLines({ changes, currency }: { changes: FieldChanges; currency: string }) {
  return (
    <>
      {Object.entries(changes).map(([field, [from, to]]) => (
        <li key={field}>{formatChange('plan', field, from, to, currency)}</li>
      ))}
    </>
  )
}

function Tasks({ titles }: { titles: string[] }) {
  if (titles.length === 0) return null
  return (
    <ul className="mt-1 list-disc pl-5 text-sm text-[var(--muted)]">
      {titles.map((t) => (
        <li key={t}>{t}</li>
      ))}
    </ul>
  )
}

export function PlanPreview({ result, currency, tree }: Props) {
  const { milestones: m, payments: p, project } = result
  const summary = planImportSummary(result)
  const projectChanged = Object.keys(project.changes).length > 0
  const keptAny = m.kept.length + p.kept.length > 0

  return (
    <div className="flex flex-col gap-4">
      {summary.isNoop && (
        <p role="status" className="font-medium">
          Nothing to change
        </p>
      )}

      {projectChanged && (
        <Section title="Project">
          <ul className={`${rowClass} flex flex-col gap-1`}>
            <ChangeLines changes={project.changes} currency={currency} />
          </ul>
        </Section>
      )}

      {tree ? (
        (m.added.length > 0 || p.added.length > 0) && (
          <Section title="Will be created">
            {m.added.length > 0 && (
              <ul aria-label="Milestones to create" className="flex flex-col gap-2">
                {m.added.map((x) => (
                  <li key={x.key} className={rowClass}>
                    <span className="font-medium">{x.title}</span>
                    <span className="block text-sm text-[var(--muted)]">
                      Due {formatDate(x.due_date)} · {formatMoney(x.amount, currency)}
                    </span>
                    <Tasks titles={x.tasks} />
                  </li>
                ))}
              </ul>
            )}
            {p.added.length > 0 && (
              <ul aria-label="Payments to create" className="flex flex-col gap-2">
                {p.added.map((x) => (
                  <li key={x.key} className={rowClass}>
                    <span className="font-medium">{x.title}</span>
                    <span className="block text-sm text-[var(--muted)]">
                      {formatMoney(x.amount, currency)} · due {formatDate(x.due_date)}
                      {x.milestone ? ` · for ${m.added.find((a) => a.key === x.milestone)?.title ?? x.milestone}` : ''}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Section>
        )
      ) : (
        <>
          {(m.added.length > 0 || p.added.length > 0) && (
            <Section title="Added">
              <ul className="flex flex-col gap-2">
                {m.added.map((x) => (
                  <li key={`m-${x.key}`} className={rowClass}>
                    <Kind>Milestone</Kind>
                    <span className="font-medium">{x.title}</span>
                    <span className="block text-sm text-[var(--muted)]">
                      Due {formatDate(x.due_date)} · {formatMoney(x.amount, currency)}
                    </span>
                    <Tasks titles={x.tasks} />
                  </li>
                ))}
                {p.added.map((x) => (
                  <li key={`p-${x.key}`} className={rowClass}>
                    <Kind>Payment</Kind>
                    <span className="font-medium">{x.title}</span>
                    <span className="block text-sm text-[var(--muted)]">
                      {formatMoney(x.amount, currency)} · due {formatDate(x.due_date)}
                    </span>
                  </li>
                ))}
              </ul>
            </Section>
          )}

          {(m.changed.length > 0 || p.changed.length > 0) && (
            <Section title="Changed">
              <ul className="flex flex-col gap-2">
                {m.changed.map((x) => (
                  <li key={`m-${x.key}`} className={rowClass}>
                    <Kind>Milestone</Kind>
                    <span className="font-medium">{x.title}</span>
                    <ul className="mt-1 flex flex-col gap-0.5 text-sm">
                      <ChangeLines changes={x.changes} currency={currency} />
                      {x.tasks.added.map((t) => (
                        <li key={`a-${t}`}>{`Added task: ${t}`}</li>
                      ))}
                      {x.tasks.removed.map((t) => (
                        <li key={`r-${t}`}>{`Removed task: ${t}`}</li>
                      ))}
                      {x.tasks.reordered && <li>Tasks reordered</li>}
                    </ul>
                  </li>
                ))}
                {p.changed.map((x) => (
                  <li key={`p-${x.key}`} className={rowClass}>
                    <Kind>Payment</Kind>
                    <span className="font-medium">{x.title}</span>
                    <ul className="mt-1 flex flex-col gap-0.5 text-sm">
                      <ChangeLines changes={x.changes} currency={currency} />
                    </ul>
                  </li>
                ))}
              </ul>
            </Section>
          )}

          {(m.removed.length > 0 || p.removed.length > 0) && (
            <Section title="Removed">
              <ul className="flex flex-col gap-2">
                {m.removed.map((x) => (
                  <li key={`m-${x.key}`} className={rowClass}>
                    <Kind>Milestone</Kind>
                    <span className="font-medium">{x.title}</span>
                  </li>
                ))}
                {p.removed.map((x) => (
                  <li key={`p-${x.key}`} className={rowClass}>
                    <Kind>Payment</Kind>
                    <span className="font-medium">{x.title}</span>
                  </li>
                ))}
              </ul>
            </Section>
          )}
        </>
      )}

      {m.reordered && <p className="text-sm">Milestones will be reordered to follow the plan</p>}

      {keptAny && (
        <section aria-labelledby="plan-kept" className="flex flex-col gap-2">
          <h3 id="plan-kept" className="text-sm font-semibold uppercase tracking-wide text-[var(--muted)]">
            Not in the plan, kept as is
          </h3>
          <ul className="flex flex-col gap-2">
            {m.kept.map((x, i) => (
              <li key={`m-${i}`} className={rowClass}>
                <Kind>Milestone</Kind>
                <span>{x.title}</span>
              </li>
            ))}
            {p.kept.map((x, i) => (
              <li key={`p-${i}`} className={rowClass}>
                <Kind>Payment</Kind>
                <span>{x.title}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}
