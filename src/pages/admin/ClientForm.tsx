import { useState, type FormEvent } from 'react'
import { Button } from '../../ui/Button'
import { Field } from '../../ui/Field'

export type ClientFormValues = { full_name: string; email: string; company?: string }

type Props = {
  submitLabel: string
  pending: boolean
  onSubmit: (values: ClientFormValues) => void
  onCancel: () => void
}

const inputClass = 'min-h-11 rounded-md border border-[var(--border)] bg-[var(--surface)] px-3'

/** Name / email / company fields shared by "Add client" and "Add client & activate". */
export function ClientForm({ submitLabel, pending, onSubmit, onCancel }: Props) {
  const [fullName, setFullName] = useState('')
  const [email, setEmail] = useState('')
  const [company, setCompany] = useState('')

  function submit(e: FormEvent) {
    e.preventDefault()
    onSubmit({ full_name: fullName.trim(), email: email.trim(), company: company.trim() || undefined })
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
      <Field label="Full name">
        <input value={fullName} onChange={(e) => setFullName(e.target.value)} className={inputClass} />
      </Field>
      <Field label="Email">
        <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} className={inputClass} />
      </Field>
      <Field label="Company (optional)">
        <input value={company} onChange={(e) => setCompany(e.target.value)} className={inputClass} />
      </Field>
      <div className="flex justify-end gap-2">
        <Button variant="secondary" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" loading={pending} disabled={!fullName.trim() || !email.trim()}>
          {submitLabel}
        </Button>
      </div>
    </form>
  )
}
