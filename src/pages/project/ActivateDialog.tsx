import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { createClient, type CreateClientResult } from '../../api/clients'
import { activateProject } from '../../api/projects'
import { qk } from '../../api/keys'
import { toUserMessage } from '../../lib/errors'
import { Button } from '../../ui/Button'
import { Dialog } from '../../ui/Dialog'
import { useToast } from '../../ui/Toast'
import { ClientForm } from '../admin/ClientForm'
import { SetupLink } from '../admin/SetupLink'

type Props = { projectId: string; open: boolean; onClose: () => void }

/** Creates (or links) the client, then activates the project. A failed activation can be retried without re-creating the client. */
export function ActivateDialog({ projectId, open, onClose }: Props) {
  const toast = useToast()
  const queryClient = useQueryClient()
  const [created, setCreated] = useState<CreateClientResult | null>(null)

  const activate = useMutation({
    mutationFn: () => activateProject(projectId),
    onSuccess: () => {
      toast.success('Project activated')
      void queryClient.invalidateQueries({ queryKey: qk.project(projectId) })
      void queryClient.invalidateQueries({ queryKey: qk.projects() })
    },
  })

  const create = useMutation({
    mutationFn: (values: Parameters<typeof createClient>[0]) => createClient({ ...values, project_id: projectId }),
    onSuccess: (data) => {
      setCreated(data)
      void queryClient.invalidateQueries({ queryKey: ['clients'] })
      activate.mutate()
    },
    onError: (err) => toast.error(toUserMessage(err)),
  })

  function close() {
    setCreated(null)
    create.reset()
    activate.reset()
    onClose()
  }

  return (
    <Dialog open={open} onClose={close} title={created ? 'Client added' : 'Add client & activate'}>
      {created ? (
        <div className="flex flex-col gap-4">
          {created.setup_url ? <SetupLink url={created.setup_url} /> : <p>Already a client — no new setup link needed.</p>}
          {activate.isPending && <p role="status">Activating…</p>}
          {activate.isError && (
            <div role="alert" className="flex flex-col items-start gap-2 rounded-md border border-[var(--danger)] p-3">
              <p>{toUserMessage(activate.error)}</p>
              <Button variant="secondary" onClick={() => activate.mutate()}>
                Try activating again
              </Button>
            </div>
          )}
          {activate.isSuccess && <p className="text-sm text-[var(--muted)]">The project is active and visible to the client.</p>}
          <Button onClick={close} disabled={activate.isPending}>
            Done
          </Button>
        </div>
      ) : (
        <ClientForm submitLabel="Add client & activate" pending={create.isPending} onSubmit={(v) => create.mutate(v)} onCancel={close} />
      )}
    </Dialog>
  )
}
