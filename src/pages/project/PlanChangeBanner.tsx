import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { acknowledge, listPlanChanges, unacknowledged } from '../../api/planChanges'
import { qk } from '../../api/keys'
import type { ProjectSummary } from '../../api/projects'
import { useAuth } from '../../auth/AuthProvider'
import { toUserMessage } from '../../lib/errors'
import { describeActivity } from '../../lib/formatChange'
import { Button } from '../../ui/Button'
import { useToast } from '../../ui/Toast'
import { useEntityNames } from './useEntityNames'

/** Shown to clients on every tab while there are plan changes they have not acknowledged. */
export function PlanChangeBanner({ project }: { project: ProjectSummary }) {
  const { profile } = useAuth()
  const toast = useToast()
  const queryClient = useQueryClient()
  const isClient = profile?.role === 'client'
  const query = useQuery({ queryKey: qk.planChanges(project.id), queryFn: () => listPlanChanges(project.id), enabled: isClient })
  const names = useEntityNames(project.id)

  const ack = useMutation({
    // Only the ids that were on screen when the button was pressed; anything that arrives later stays in the banner.
    mutationFn: (ids: string[]) => acknowledge(profile!.id, ids),
    onSuccess: () => {
      toast.success('Changes acknowledged')
      return queryClient.invalidateQueries({ queryKey: qk.planChanges(project.id) })
    },
    onError: (err) => toast.error(toUserMessage(err)),
  })

  if (!isClient || !profile) return null
  const pending = unacknowledged(query.data ?? [], profile.id)
  if (pending.length === 0) return null

  return (
    <section aria-label="The plan changed" className="flex flex-col gap-3 rounded-md border border-[var(--warn)] bg-[var(--surface)] p-4">
      <h2 className="text-lg font-semibold">The plan changed</h2>
      <ul className="flex flex-col gap-2">
        {pending.map((c) => (
          <li key={c.id}>{describeActivity(c, { currency: project.currency, subjectName: names.get(c.entity_id) })}</li>
        ))}
      </ul>
      <div>
        <Button loading={ack.isPending} onClick={() => ack.mutate(pending.map((c) => c.id))}>
          Acknowledge
        </Button>
      </div>
    </section>
  )
}
