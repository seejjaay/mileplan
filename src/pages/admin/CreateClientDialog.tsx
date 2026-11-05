import { useState, type FormEvent } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { createClient, type CreateClientResult } from '../../api/clients'
import { toUserMessage } from '../../lib/errors'
import { Button } from '../../ui/Button'
import { Dialog } from '../../ui/Dialog'
import { Field } from '../../ui/Field'
import { useToast } from '../../ui/Toast'
import { SetupLink } from './SetupLink'

const inputClass = 'min-h-11 rounded-md border border-[var(--border)] bg-[var(--surface)] px-3'

type Props = { open: boolean; onClose: () => void }

export function CreateClientDialog({ open, onClose }: Props) {
  const toast = useToast()
  const queryClient = useQueryClient()
  const [fullName, setFullName] = useState('')
  const [email, setEmail] = useState('')
  const [company, setCompany] = useState('')
  const [result, setResult] = useState<CreateClientResult | null>(null)

  const create = useMutation({
    mutationFn: () => createClient({ full_name: fullName.trim(), email: email.trim(), company: company.trim() || undefined }),
    onSuccess: (data) => {
      setResult(data)
      toast.success(data.linked_existing ? 'Client already exists' : 'Client created')
      void queryClient.invalidateQueries({ queryKey: ['clients'] })
    },
    onError: (err) => toast.error(toUserMessage(err)),
  })

  function close() {
    setFullName('')
    setEmail('')
    setCompany('')
    setResult(null)
    create.reset()
    onClose()
  }

  function submit(e: FormEvent) {
    e.preventDefault()
    create.mutate()
  }

  return (
    <Dialog open={open} onClose={close} title={result ? 'Client ready' : 'Add client'}>
      {result ? (
        <div className="flex flex-col gap-4">
          {result.setup_url ? (
            <SetupLink url={result.setup_url} />
          ) : (
            <p>Already a client — no new setup link needed.</p>
          )}
          <Button onClick={close}>Done</Button>
        </div>
      ) : (
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
            <Button variant="secondary" onClick={close}>
              Cancel
            </Button>
            <Button type="submit" loading={create.isPending} disabled={!fullName.trim() || !email.trim()}>
              Create client
            </Button>
          </div>
        </form>
      )}
    </Dialog>
  )
}
