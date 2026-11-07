import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ToastProvider } from '../../../ui/Toast'
import { editMessage, type MessageRow } from '../../../api/messages'
import { signedUrl } from '../../../api/storage'
import { openUrl } from '../../../lib/openUrl'
import { MessageItem } from './MessageItem'

vi.mock('../../../api/messages', async (orig) => ({ ...(await orig<typeof import('../../../api/messages')>()), editMessage: vi.fn() }))
vi.mock('../../../api/storage', async (orig) => ({ ...(await orig<typeof import('../../../api/storage')>()), signedUrl: vi.fn() }))
vi.mock('../../../lib/openUrl', () => ({ openUrl: vi.fn() }))

const NOW = new Date('2026-11-08T10:00:00Z')

function msg(over: Partial<MessageRow> = {}): MessageRow {
  return {
    id: 'm1',
    created_at: new Date(NOW.getTime() - 60_000).toISOString(),
    project_id: 'p1',
    sender_id: 'u1',
    body: 'Hello there',
    attachments: [],
    edited_at: null,
    ...over,
  }
}

function setup(message: MessageRow, own = true, onEdited = vi.fn()) {
  const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
  const view = render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <ToastProvider>
        <MessageItem message={message} own={own} onEdited={onEdited} />
      </ToastProvider>
    </QueryClientProvider>,
  )
  return { user, onEdited, ...view }
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true, now: NOW })
  vi.mocked(signedUrl).mockResolvedValue('https://signed.example/file')
})
afterEach(() => {
  vi.useRealTimers()
  vi.clearAllMocks()
})

describe('MessageItem', () => {
  it('renders links through linkify, opening safely in a new tab', () => {
    setup(msg({ body: 'docs at https://x.dev/a.' }), false)
    const a = screen.getByRole('link', { name: 'https://x.dev/a' })
    expect(a).toHaveAttribute('href', 'https://x.dev/a')
    expect(a).toHaveAttribute('target', '_blank')
    expect(a).toHaveAttribute('rel', 'noopener noreferrer')
  })

  it('renders html in the body as literal text', () => {
    setup(msg({ body: '<b>x</b>' }), false)
    expect(screen.getByText('<b>x</b>')).toBeInTheDocument()
    expect(document.querySelector('b')).toBeNull()
  })

  it('shows "edited" only when edited_at is set', () => {
    const first = setup(msg(), false)
    expect(screen.queryByText('edited')).not.toBeInTheDocument()
    first.unmount()
    setup(msg({ edited_at: NOW.toISOString() }), false)
    expect(screen.getByText('edited')).toBeInTheDocument()
  })

  it('downloads an attachment through a signed url with its name', async () => {
    const { user } = setup(msg({ attachments: [{ path: 'p1/abc-wire.png', name: 'wire.png', size: 2048, mime: 'image/png' }] }), false)
    await user.click(screen.getByRole('button', { name: /wire\.png/ }))
    await waitFor(() => expect(openUrl).toHaveBeenCalledWith('https://signed.example/file'))
    expect(signedUrl).toHaveBeenCalledWith('attachments', 'p1/abc-wire.png', 'wire.png')
  })

  it('lets a long unbroken attachment name wrap inside the bubble', () => {
    const name = 'x'.repeat(200) + '.png'
    setup(msg({ attachments: [{ path: 'p1/abc-long.png', name, size: 2048, mime: 'image/png' }] }), false)
    const chip = screen.getByRole('button', { name: new RegExp(name) })
    expect(chip).toHaveClass('max-w-full', '[overflow-wrap:anywhere]')
    expect(chip.closest('li')).toHaveClass('min-w-0')
  })

  it('ignores Esc and Cancel while a save is in flight', async () => {
    vi.mocked(editMessage).mockReturnValue(new Promise(() => {}))
    const { user } = setup(msg())
    await user.click(screen.getByRole('button', { name: 'Edit' }))
    await user.type(screen.getByRole('textbox', { name: 'Message' }), '!')
    await user.click(screen.getByRole('button', { name: 'Save' }))
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled()
    await user.keyboard('{Escape}')
    expect(screen.getByRole('textbox', { name: 'Message' })).toHaveValue('Hello there!')
    expect(editMessage).toHaveBeenCalledTimes(1)
  })

  it('offers Edit on own messages until 15 minutes after creation', async () => {
    setup(msg())
    expect(screen.getByRole('button', { name: 'Edit' })).toBeInTheDocument()
    await act(async () => {
      vi.advanceTimersByTime(13 * 60_000)
    })
    expect(screen.getByRole('button', { name: 'Edit' })).toBeInTheDocument()
    await act(async () => {
      vi.advanceTimersByTime(2 * 60_000)
    })
    expect(screen.queryByRole('button', { name: 'Edit' })).not.toBeInTheDocument()
  })

  it("never offers Edit on someone else's message", () => {
    setup(msg(), false)
    expect(screen.queryByRole('button', { name: 'Edit' })).not.toBeInTheDocument()
  })

  it('keeps Save disabled until the text changes, and Esc cancels back to Edit', async () => {
    const { user } = setup(msg())
    await user.click(screen.getByRole('button', { name: 'Edit' }))
    const box = screen.getByRole('textbox', { name: 'Message' })
    expect(box).toHaveValue('Hello there')
    const save = screen.getByRole('button', { name: 'Save' })
    expect(save).toBeDisabled()
    await user.type(box, '!')
    expect(save).toBeEnabled()
    await user.clear(box)
    await user.type(box, '   ')
    expect(save).toBeDisabled()
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Edit' })).toHaveFocus()
  })

  it.each(['PGRST116', '42501'])('maps a %s rejection to the window-closed toast and keeps the text', async (code) => {
    vi.mocked(editMessage).mockRejectedValue({ code, message: 'raw' })
    const { user, onEdited } = setup(msg())
    await user.click(screen.getByRole('button', { name: 'Edit' }))
    await user.type(screen.getByRole('textbox', { name: 'Message' }), '!')
    await user.click(screen.getByRole('button', { name: 'Save' }))
    expect(await screen.findByText('The 15-minute edit window has closed')).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: 'Message' })).toHaveValue('Hello there!')
    expect(onEdited).not.toHaveBeenCalled()
  })

  it('toasts other errors through toUserMessage and keeps the text', async () => {
    vi.mocked(editMessage).mockRejectedValue(new Error('Network down'))
    const { user } = setup(msg())
    await user.click(screen.getByRole('button', { name: 'Edit' }))
    await user.type(screen.getByRole('textbox', { name: 'Message' }), '!')
    await user.click(screen.getByRole('button', { name: 'Save' }))
    expect(await screen.findByText('Network down')).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: 'Message' })).toHaveValue('Hello there!')
  })

  it('saves the trimmed text, calls onEdited and toasts', async () => {
    const saved = msg({ body: 'Hello there!', edited_at: NOW.toISOString() })
    vi.mocked(editMessage).mockResolvedValue(saved)
    const { user, onEdited } = setup(msg())
    await user.click(screen.getByRole('button', { name: 'Edit' }))
    await user.type(screen.getByRole('textbox', { name: 'Message' }), '!  ')
    await user.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(onEdited).toHaveBeenCalledWith(saved))
    expect(editMessage).toHaveBeenCalledWith('m1', 'Hello there!')
    expect(await screen.findByText('Message edited')).toBeInTheDocument()
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
  })
})
