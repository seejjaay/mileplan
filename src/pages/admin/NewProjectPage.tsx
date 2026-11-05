import { useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { createProject } from '../../api/projects'
import { qk } from '../../api/keys'
import { toUserMessage } from '../../lib/errors'
import { useTitle } from '../../lib/useTitle'
import { Button } from '../../ui/Button'
import { Field } from '../../ui/Field'
import { useToast } from '../../ui/Toast'

const inputClass = 'min-h-11 w-full rounded-md border border-[var(--border)] bg-[var(--surface)] px-3'

export default function NewProjectPage() {
  useTitle('New project')
  const navigate = useNavigate()
  const toast = useToast()
  const queryClient = useQueryClient()
  const [title, setTitle] = useState('')
  const [summary, setSummary] = useState('')
  const [currency, setCurrency] = useState('PHP')
  const [start, setStart] = useState('')
  const [end, setEnd] = useState('')

  const datesBad = !!start && !!end && end < start
  const currencyBad = !/^[A-Za-z]{3}$/.test(currency)
  const invalid = !title.trim() || datesBad || currencyBad

  const create = useMutation({
    mutationFn: () => createProject({ title, summary, currency, start_date: start, end_date: end }),
    onSuccess: (id) => {
      toast.success('Project created')
      void queryClient.invalidateQueries({ queryKey: qk.projects() })
      navigate(`/projects/${id}`)
    },
    onError: (err) => toast.error(toUserMessage(err)),
  })

  function submit(e: FormEvent) {
    e.preventDefault()
    if (!invalid) create.mutate()
  }

  return (
    <form onSubmit={submit} className="flex max-w-xl flex-col gap-4" noValidate>
      <h1 className="text-2xl font-semibold">New project</h1>
      <Field label="Title">
        <input value={title} onChange={(e) => setTitle(e.target.value)} className={inputClass} />
      </Field>
      <Field label="Summary">
        <textarea value={summary} onChange={(e) => setSummary(e.target.value)} rows={3} className={`${inputClass} py-2`} />
      </Field>
      <Field label="Currency" error={currencyBad ? 'Use a 3-letter currency code' : null}>
        <input value={currency} onChange={(e) => setCurrency(e.target.value)} maxLength={3} className={inputClass} />
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Start date">
          <input type="date" value={start} onChange={(e) => setStart(e.target.value)} className={inputClass} />
        </Field>
        <Field label="End date" error={datesBad ? 'End date must be on or after the start date' : null}>
          <input type="date" value={end} onChange={(e) => setEnd(e.target.value)} className={inputClass} />
        </Field>
      </div>
      <p className="text-sm text-[var(--muted)]">New projects start in setup, hidden from the client until you activate them.</p>
      <div>
        <Button type="submit" loading={create.isPending} disabled={invalid}>
          Create project
        </Button>
      </div>
    </form>
  )
}
