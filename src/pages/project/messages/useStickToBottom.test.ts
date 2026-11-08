import { act, renderHook } from '@testing-library/react'
import { useStickToBottom } from './useStickToBottom'

function scroller(dims: { scrollHeight: number; clientHeight: number; scrollTop: number }) {
  const el = document.createElement('div')
  for (const k of ['scrollHeight', 'clientHeight', 'scrollTop'] as const) {
    let v = dims[k]
    Object.defineProperty(el, k, { configurable: true, get: () => v, set: (n: number) => (v = n) })
  }
  return el
}

describe('useStickToBottom', () => {
  it('is at the bottom within 48px and not beyond', () => {
    const el = scroller({ scrollHeight: 1000, clientHeight: 400, scrollTop: 560 }) // 40px away
    const { result } = renderHook(() => useStickToBottom({ current: el }))
    expect(result.current.atBottom).toBe(true)
    act(() => {
      el.scrollTop = 500 // 100px away
      el.dispatchEvent(new Event('scroll'))
    })
    expect(result.current.atBottom).toBe(false)
  })

  it('scrollToBottom jumps to the end', () => {
    const el = scroller({ scrollHeight: 1000, clientHeight: 400, scrollTop: 0 })
    const { result } = renderHook(() => useStickToBottom({ current: el }))
    act(() => result.current.scrollToBottom())
    expect(el.scrollTop).toBe(1000)
    expect(result.current.atBottom).toBe(true)
  })

  it('keeps the distance from the bottom after older messages are prepended', () => {
    const el = scroller({ scrollHeight: 1000, clientHeight: 400, scrollTop: 0 })
    const { result } = renderHook(() => useStickToBottom({ current: el }))
    let restore!: () => void
    act(() => {
      restore = result.current.keepPositionWhilePrepending()
    })
    Object.defineProperty(el, 'scrollHeight', { configurable: true, get: () => 1600 })
    restore()
    expect(el.scrollTop).toBe(600)
  })
})
