import { useState, type FormEvent } from 'react'
import { Navigate, useNavigate, useSearchParams } from 'react-router-dom'
import { useAuth } from '../auth/AuthProvider'
import { toUserMessage } from '../lib/errors'
import { safeNext } from '../lib/safeNext'
import { supabase } from '../lib/supabase'
import { useTitle } from '../lib/useTitle'
import { Button } from '../ui/Button'
import { Field } from '../ui/Field'
import { useToast } from '../ui/Toast'

const inputClass = 'min-h-11 rounded-md border border-[var(--border)] bg-[var(--surface)] px-3'

export default function LoginPage() {
  useTitle('Sign in')
  const { session, loading } = useAuth()
  const navigate = useNavigate()
  const toast = useToast()
  const [params] = useSearchParams()
  const next = safeNext(params.get('next'))
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<'password' | 'link' | null>(null)

  if (!loading && session) return <Navigate to={next} replace />

  async function signIn(e: FormEvent) {
    e.preventDefault()
    setBusy('password')
    setError(null)
    const { error: err } = await supabase.auth.signInWithPassword({ email: email.trim().toLowerCase(), password })
    setBusy(null)
    if (err) setError(toUserMessage(err))
    else navigate(next, { replace: true })
  }

  async function emailLink() {
    if (!email.trim()) {
      setError('Enter your email first')
      return
    }
    setBusy('link')
    setError(null)
    const { error: err } = await supabase.auth.signInWithOtp({
      email: email.trim().toLowerCase(),
      options: { shouldCreateUser: false, emailRedirectTo: `${window.location.origin}${next}` },
    })
    setBusy(null)
    if (err) setError(toUserMessage(err))
    else toast.success('If that email has an account, a sign-in link is on its way')
  }

  return (
    <form onSubmit={signIn} className="flex flex-col gap-4" noValidate>
      <h1 className="text-2xl font-semibold">Sign in</h1>
      <Field label="Email">
        <input type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} className={inputClass} />
      </Field>
      <Field label="Password">
        <input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} className={inputClass} />
      </Field>
      {error && (
        <p role="alert" className="text-sm text-[var(--danger)]">
          {error}
        </p>
      )}
      <Button type="submit" loading={busy === 'password'} disabled={!email || !password}>
        Sign in
      </Button>
      <Button variant="secondary" loading={busy === 'link'} onClick={emailLink}>
        Email me a sign-in link
      </Button>
    </form>
  )
}
