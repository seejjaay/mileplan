import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { createClient, type CreateClientResult } from '../../api/clients'
import { toUserMessage } from '../../lib/errors'
import { Button } from '../../ui/Button'
import { Dialog } from '../../ui/Dialog'
import { useToast } from '../../ui/Toast'
import { ClientForm } from './ClientForm'
import { SetupLink } from './SetupLink'

type Props = { open: boolean; onClose: () => void; projectId?: string }

export function CreateClientDialog({ open, onClose, projectId }: Props) {
  const toast = useToast()
  const queryClient = useQueryClient()
  const [result, setResult] = useState<CreateClientResult | null>(null)

  const create = useMutation({
    mutationFn: (values: Parameters<typeof createClient>[0]) => createClient({ ...values, project_id: projectId }),
    onSuccess: (data) => {
      setResult(data)
      toast.success(data.linked_existing ? 'Client already exists' : 'Client created')
      void queryClient.invalidateQueries({ queryKey: ['clients'] })
    },
    onError: (err) => toast.error(toUserMessage(err)),
  })

  function close() {
    setResult(null)
    create.reset()
    onClose()
  }

  return (
    <Dialog open={open} onClose={close} title={result ? 'Client ready' : 'Add client'}>
      {result ? (
        <div className="flex flex-col gap-4">
          {result.setup_url ? <SetupLink url={result.setup_url} /> : <p>Already a client — no new setup link needed.</p>}
          <Button onClick={close}>Done</Button>
        </div>
      ) : (
        <ClientForm submitLabel="Create client" pending={create.isPending} onSubmit={(v) => create.mutate(v)} onCancel={close} />
      )}
    </Dialog>
  )
}
