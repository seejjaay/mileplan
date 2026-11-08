import { useCallback, useEffect, useState, type RefObject } from 'react'

const NEAR_PX = 48

/** Tracks whether a scroll container is at (within 48px of) its bottom, and moves it there. */
export function useStickToBottom(ref: RefObject<HTMLElement | null>) {
  const [atBottom, setAtBottom] = useState(true)

  const measure = useCallback(() => {
    const el = ref.current
    if (!el) return
    setAtBottom(el.scrollHeight - el.scrollTop - el.clientHeight <= NEAR_PX)
  }, [ref])

  useEffect(() => {
    const el = ref.current
    if (!el) return
    el.addEventListener('scroll', measure, { passive: true })
    measure()
    return () => el.removeEventListener('scroll', measure)
  }, [ref, measure])

  const scrollToBottom = useCallback(() => {
    const el = ref.current
    if (!el) return
    el.scrollTop = el.scrollHeight
    setAtBottom(true)
  }, [ref])

  /** Call before older messages are added; call the returned function after they render to keep the view where it was. */
  const keepPositionWhilePrepending = useCallback(() => {
    const el = ref.current
    const fromBottom = el ? el.scrollHeight - el.scrollTop : 0
    return () => {
      if (el) el.scrollTop = el.scrollHeight - fromBottom
    }
  }, [ref])

  return { atBottom, scrollToBottom, keepPositionWhilePrepending }
}
