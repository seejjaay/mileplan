import { useQuery } from '@tanstack/react-query'
import { qk } from './keys'
import { unreadCounts } from './messages'

const NONE: Record<string, number> = {}

/** Unread messages per project id. Empty while loading or on error, so a card never shows a false count. */
export function useUnreadCounts(): Record<string, number> {
  const { data } = useQuery({ queryKey: qk.unread(), queryFn: unreadCounts })
  return data ?? NONE
}
