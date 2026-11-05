import { useEffect, useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { redeemSetup } from '../api/setup'
import { supabase } from '../lib/supabase'
import { useTitle } from '../lib/useTitle'
import { Button } from '../ui/Button'
import { Field } from '../ui/Field'

const MIN_PASSWORD = 8
export const BAD_LINK_COPY = 'This setup link has expired or was already used. Ask CJ for a new link.'

function tokenFromHash(): string {
  return new URLSearchParams(window.location.hash.replace(/^#/, '')).get('token') ?? ''
}

export default function SetupPage() {
  useTitle('Set your password')
  const navigate = useNavigate()
  // Token lives in the fragment so it never reaches server logs; read once, then scrub the URL.
  const [token] = useState(tokenFromHash)
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(token ? null : BAD_LINK_COPY)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (window.location.hash) window.history.replaceState(null, '', window.location.pathname + window.location.search)
  }, [])

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (password.length < MIN_PASSWORD) return
    setBusy(true)
    setError(null)
    const result = await redeemSetup(token, password)
    if (!result.ok) {
      setBusy(false)
      setError(
        result.reason === 'invalid_or_expired'
          ? BAD_LINK_COPY
          : result.reason === 'weak_password'
            ? `Use at least ${MIN_PASSWORD} characters`
            : result.reason === 'rate_limited'
              ? 'Too many attempts. Wait a few minutes and try again.'
              : 'Something went wrong. Try again.',
      )
      return
    }
    const { error: signInError } = await supabase.auth.signInWithPassword({ email: result.email, password })
    setBusy(false)
    if (signInError) navigate('/login', { replace: true })
    else navigate('/', { replace: true })
  }

  const linkDead = error === BAD_LINK_COPY
  return (
    <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
      <h1 className="text-2xl font-semibold">Set your password</h1>
      {error && (
        <p role="alert" className="text-sm text-[var(--danger)]">
          {error}
        </p>
      )}
      {!linkDead && (
        <>
          <Field label="Password">
            <input
              type="password"
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="min-h-11 rounded-md border border-[var(--border)] bg-[var(--surface)] px-3"
            />
          </Field>
          <p className="text-sm text-[var(--muted)]">At least {MIN_PASSWORD} characters.</p>
          <Button type="submit" loading={busy} disabled={password.length < MIN_PASSWORD}>
            Set password
          </Button>
        </>
      )}
    </form>
  )
}
