import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { listClients, regenerateLink, setClientActive, type ClientRow } from '../../api/clients'
import { toUserMessage } from '../../lib/errors'
import { useTitle } from '../../lib/useTitle'
import { AsyncView } from '../../ui/AsyncView'
import { Button } from '../../ui/Button'
import { Dialog } from '../../ui/Dialog'
import { StatusChip } from '../../ui/StatusChip'
import { useToast } from '../../ui/Toast'
import { CreateClientDialog } from './CreateClientDialog'
import { SetupLink } from './SetupLink'

const label = (c: ClientRow) => c.full_name || c.email || 'this client'

export default function ClientsPage() {
  useTitle('Clients')
  const toast = useToast()
  const queryClient = useQueryClient()
  const [creating, setCreating] = useState(false)
  const [link, setLink] = useState<{ name: string; url: string } | null>(null)
  const [confirming, setConfirming] = useState<ClientRow | null>(null)

  const query = useQuery({ queryKey: ['clients'], queryFn: listClients })

  const regenerate = useMutation({
    mutationFn: (c: ClientRow) => regenerateLink(c.id).then((url) => ({ name: label(c), url })),
    onSuccess: (data) => {
      setLink(data)
      toast.success('New setup link created')
    },
    onError: (err) => toast.error(toUserMessage(err)),
  })

  const toggle = useMutation({
    mutationFn: (c: ClientRow) => setClientActive(c.id, !c.active).then(() => c),
    onSuccess: (c) => {
      toast.success(`${label(c)} ${c.active ? 'deactivated' : 'reactivated'}`)
      setConfirming(null)
      void queryClient.invalidateQueries({ queryKey: ['clients'] })
    },
    onError: (err) => toast.error(toUserMessage(err)),
  })

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">Clients</h1>
        <Button onClick={() => setCreating(true)}>Add client</Button>
      </div>

      <AsyncView query={query} onRetry={() => void query.refetch()} empty={<p className="text-[var(--muted)]">No clients yet.</p>}>
        {(clients) => (
          // Table from sm up; stacked cards on phones. Explicit roles keep table semantics when display is overridden.
          <div role="table" aria-label="Clients" className="block w-full text-sm sm:table sm:border-collapse">
            <div role="rowgroup" className="sr-only sm:table-header-group sm:not-sr-only">
              <div role="row" className="sm:table-row">
                {['Name', 'Email', 'Company', 'Status', 'Actions'].map((h) => (
                  <div key={h} role="columnheader" className="sm:table-cell sm:border-b sm:border-[var(--border)] sm:px-3 sm:py-2 sm:text-left sm:font-medium">
                    {h}
                  </div>
                ))}
              </div>
            </div>
            <div role="rowgroup" className="block sm:table-row-group">
              {clients.map((c) => (
                <div
                  key={c.id}
                  role="row"
                  className="mb-3 block rounded-md border border-[var(--border)] bg-[var(--surface)] p-3 sm:mb-0 sm:table-row sm:rounded-none sm:border-0 sm:bg-transparent sm:p-0"
                >
                  <div role="cell" className="block font-medium sm:table-cell sm:border-b sm:border-[var(--border)] sm:px-3 sm:py-3">
                    {c.full_name || '—'}
                  </div>
                  <div role="cell" className="block break-all sm:table-cell sm:border-b sm:border-[var(--border)] sm:px-3 sm:py-3">
                    {c.email || '—'}
                  </div>
                  <div role="cell" className="block text-[var(--muted)] sm:table-cell sm:border-b sm:border-[var(--border)] sm:px-3 sm:py-3">
                    {c.company || '—'}
                  </div>
                  <div role="cell" className="block py-1 sm:table-cell sm:border-b sm:border-[var(--border)] sm:px-3 sm:py-3">
                    <StatusChip status={c.active ? 'done' : 'inactive'} label={c.active ? 'Active' : 'Deactivated'} />
                  </div>
                  <div role="cell" className="flex flex-wrap gap-2 sm:table-cell sm:border-b sm:border-[var(--border)] sm:px-3 sm:py-3">
                    <Button variant="secondary" loading={regenerate.isPending && regenerate.variables?.id === c.id} onClick={() => regenerate.mutate(c)}>
                      Regenerate link<span className="sr-only"> for {label(c)}</span>
                    </Button>
                    {c.active ? (
                      <Button variant="secondary" onClick={() => setConfirming(c)}>
                        Deactivate<span className="sr-only"> {label(c)}</span>
                      </Button>
                    ) : (
                      <Button variant="secondary" loading={toggle.isPending && toggle.variables?.id === c.id} onClick={() => toggle.mutate(c)}>
                        Reactivate<span className="sr-only"> {label(c)}</span>
                      </Button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </AsyncView>

      <CreateClientDialog open={creating} onClose={() => setCreating(false)} />

      <Dialog open={!!link} onClose={() => setLink(null)} title={`Setup link for ${link?.name ?? ''}`}>
        {link && (
          <div className="flex flex-col gap-4">
            <SetupLink url={link.url} />
            <p className="text-sm text-[var(--muted)]">Any earlier link for this client no longer works.</p>
            <Button onClick={() => setLink(null)}>Done</Button>
          </div>
        )}
      </Dialog>

      <Dialog open={!!confirming} onClose={() => setConfirming(null)} title="Deactivate client?">
        {confirming && (
          <div className="flex flex-col gap-4">
            <p>{label(confirming)} will lose access immediately. You can reactivate them later.</p>
            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setConfirming(null)}>
                Cancel
              </Button>
              <Button variant="danger" loading={toggle.isPending} onClick={() => toggle.mutate(confirming)}>
                Confirm deactivate
              </Button>
            </div>
          </div>
        )}
      </Dialog>
    </div>
  )
}
