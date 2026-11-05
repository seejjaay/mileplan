import { useState, type FormEvent } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { profileKey, useAuth } from '../auth/AuthProvider'
import { toUserMessage } from '../lib/errors'
import { supabase } from '../lib/supabase'
import { useTitle } from '../lib/useTitle'
import { Button } from '../ui/Button'
import { Field } from '../ui/Field'
import { useToast } from '../ui/Toast'

const inputClass = 'min-h-11 rounded-md border border-[var(--border)] bg-[var(--surface)] px-3'

export default function AccountPage() {
  useTitle('Account')
  const { profile } = useAuth()
  const toast = useToast()
  const queryClient = useQueryClient()
  const saved = profile?.full_name ?? ''
  const [name, setName] = useState(saved)
  const [savingName, setSavingName] = useState(false)
  const [password, setPassword] = useState('')
  const [savingPassword, setSavingPassword] = useState(false)

  async function saveName(e: FormEvent) {
    e.preventDefault()
    if (!profile) return
    setSavingName(true)
    const { error } = await supabase.from('profiles').update({ full_name: name.trim() }).eq('id', profile.id)
    setSavingName(false)
    if (error) return toast.error(toUserMessage(error))
    await queryClient.invalidateQueries({ queryKey: profileKey(profile.id) })
    toast.success('Name saved')
  }

  async function changePassword(e: FormEvent) {
    e.preventDefault()
    setSavingPassword(true)
    const { error } = await supabase.auth.updateUser({ password })
    setSavingPassword(false)
    if (error) return toast.error(toUserMessage(error))
    setPassword('')
    toast.success('Password changed')
  }

  return (
    <div className="flex max-w-md flex-col gap-8">
      <h1 className="text-2xl font-semibold">Account</h1>
      <form onSubmit={saveName} className="flex flex-col gap-4">
        <Field label="Full name">
          <input value={name} onChange={(e) => setName(e.target.value)} className={inputClass} />
        </Field>
        <Button type="submit" loading={savingName} disabled={name.trim() === saved || !name.trim()}>
          Save name
        </Button>
      </form>
      <form onSubmit={changePassword} className="flex flex-col gap-4">
        <Field label="New password">
          <input type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} className={inputClass} />
        </Field>
        <Button type="submit" loading={savingPassword} disabled={password.length < 8}>
          Change password
        </Button>
      </form>
    </div>
  )
}
