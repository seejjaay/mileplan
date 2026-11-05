import type { ReactNode } from 'react'
import type { UseQueryResult } from '@tanstack/react-query'
import { toUserMessage } from '../lib/errors'
import { Button } from './Button'

type Props<T> = {
  query: UseQueryResult<T[]>
  empty: ReactNode
  onRetry: () => void
  children: (data: T[]) => ReactNode
}

function Skeleton() {
  return (
    <div role="status" aria-label="Loading" aria-busy="true" className="flex flex-col gap-3">
      {[0, 1, 2].map((i) => (
        <div key={i} className="h-16 animate-pulse rounded-md bg-[var(--border)]" />
      ))}
    </div>
  )
}

/** Distinct loading / error / empty / data states. Empty renders only after data has arrived and is empty. */
export function AsyncView<T>({ query, empty, onRetry, children }: Props<T>) {
  if (query.isPending) return <Skeleton />
  if (query.isError) {
    return (
      <div role="alert" className="flex flex-col items-start gap-3 rounded-md border border-[var(--danger)] p-4">
        <p>{toUserMessage(query.error)}</p>
        <Button variant="secondary" onClick={onRetry}>
          Retry
        </Button>
      </div>
    )
  }
  const data = query.data ?? []
  if (data.length === 0) return <>{empty}</>
  return <>{children(data)}</>
}
