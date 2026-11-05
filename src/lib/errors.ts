export const NO_ACCESS = "You don't have access to this"

type MaybeError = { code?: unknown; status?: unknown; message?: unknown; context?: { status?: unknown } }

/** Maps PostgREST 42501 / HTTP 403 to friendly copy; never shows a raw RLS error. */
export function toUserMessage(err: unknown): string {
  if (err && typeof err === 'object') {
    const e = err as MaybeError
    if (e.code === '42501' || e.status === 403 || e.context?.status === 403) return NO_ACCESS
    if (typeof e.message === 'string' && e.message) return e.message
  }
  return 'Something went wrong'
}
