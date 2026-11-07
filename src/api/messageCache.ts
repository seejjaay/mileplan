import type { InfiniteData } from '@tanstack/react-query'
import type { Cursor, MessageRow } from './messages'

export const PAGE_SIZE = 50

/** Pages are newest first, each page newest first; page 0 holds the latest messages. */
export type Thread = InfiniteData<MessageRow[], Cursor | undefined>

const has = (t: Thread, id: string) => t.pages.some((page) => page.some((m) => m.id === id))

/** Puts a new message at the head of the thread. No thread loaded yet means nothing to patch; a message already there is left alone, so the sender's echo and the mutation result can arrive in either order. */
export function appendMessage(t: Thread | undefined, m: MessageRow): Thread | undefined {
  if (!t || has(t, m.id)) return t
  return { ...t, pages: [[m, ...t.pages[0]], ...t.pages.slice(1)] }
}

/** Swaps a loaded message for its new version; an id that isn't loaded leaves the thread untouched. */
export function replaceMessage(t: Thread | undefined, m: MessageRow): Thread | undefined {
  if (!t || !has(t, m.id)) return t
  return { ...t, pages: t.pages.map((page) => (page.some((x) => x.id === m.id) ? page.map((x) => (x.id === m.id ? m : x)) : page)) }
}

/** Every loaded message, oldest to newest. */
export function threadOrder(t: Thread): MessageRow[] {
  return t.pages.flat().reverse()
}

/** The cursor for the next older page, or undefined when this page came back short (no more history). */
export function nextCursor(lastPage: MessageRow[]): Cursor | undefined {
  if (lastPage.length < PAGE_SIZE) return undefined
  const last = lastPage[lastPage.length - 1]
  return { created_at: last.created_at, id: last.id }
}
