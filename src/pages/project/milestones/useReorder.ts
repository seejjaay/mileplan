import { useMutation, useQueryClient, type QueryKey } from '@tanstack/react-query'
import { toUserMessage } from '../../../lib/errors'
import { useToast } from '../../../ui/Toast'

/**
 * Optimistic reorder: show the new order immediately, send it, and on failure restore the previous
 * cache, toast the reason and refetch (a stale-list rejection means someone else changed the list).
 */
export function useReorder<TCache>(
  queryKey: QueryKey,
  apply: (ids: string[]) => Promise<void>,
  optimistic: (cache: TCache, ids: string[]) => TCache,
) {
  const queryClient = useQueryClient()
  const toast = useToast()
  return useMutation({
    mutationFn: (ids: string[]) => apply(ids),
    onMutate: async (ids: string[]) => {
      await queryClient.cancelQueries({ queryKey })
      const previous = queryClient.getQueryData<TCache>(queryKey)
      if (previous) queryClient.setQueryData<TCache>(queryKey, optimistic(previous, ids))
      return { previous }
    },
    onError: (err, _ids, context) => {
      if (context?.previous) queryClient.setQueryData(queryKey, context.previous)
      toast.error(toUserMessage(err))
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey }),
  })
}
