import { cloneElement, useId, type ReactElement } from 'react'

type Props = {
  label: string
  error?: string | null
  children: ReactElement<{ id?: string; 'aria-describedby'?: string; 'aria-invalid'?: boolean }>
}

/** Associates label, input and error text (htmlFor/id and aria-describedby). */
export function Field({ label, error, children }: Props) {
  const id = useId()
  const errorId = `${id}-error`
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-sm font-medium">
        {label}
      </label>
      {cloneElement(children, {
        id,
        'aria-describedby': error ? errorId : undefined,
        'aria-invalid': error ? true : undefined,
      })}
      {error && (
        <p id={errorId} className="text-sm text-[var(--danger)]">
          {error}
        </p>
      )}
    </div>
  )
}
