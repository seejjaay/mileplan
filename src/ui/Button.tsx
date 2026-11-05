import type { ButtonHTMLAttributes } from 'react'

type Variant = 'primary' | 'secondary' | 'danger'

type Props = ButtonHTMLAttributes<HTMLButtonElement> & { loading?: boolean; variant?: Variant }

const styles: Record<Variant, string> = {
  primary: 'bg-[var(--accent)] text-[var(--accent-contrast)] border-transparent',
  secondary: 'bg-[var(--surface)] text-[var(--text)] border-[var(--border)]',
  danger: 'bg-[var(--danger)] text-[var(--accent-contrast)] border-transparent',
}

export function Button({ loading = false, variant = 'primary', disabled, children, className = '', type = 'button', ...rest }: Props) {
  return (
    <button
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={`inline-flex min-h-11 items-center justify-center gap-2 rounded-md border px-4 py-2 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-50 ${styles[variant]} ${className}`}
      {...rest}
    >
      {loading && <span aria-hidden="true" className="size-4 animate-spin rounded-full border-2 border-current border-t-transparent" />}
      {children}
    </button>
  )
}
