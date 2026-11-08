import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ToastProvider } from '../../../ui/Toast'
import { sendMessage, type MessageRow } from '../../../api/messages'
import { Composer } from './Composer'

vi.mock('../../../api/messages', async (orig) => ({ ...(await orig<typeof import('../../../api/messages')>()), sendMessage: vi.fn() }))

const row: MessageRow = {
  id: 'm1', created_at: '2026-11-08T10:00:00Z', project_id: 'p1', sender_id: 'u1', body: 'hi', attachments: [], edited_at: null,
}
const png = (name = 'a.png') => new File(['x'], name, { type: 'image/png' })

function stubPointer(fine: boolean) {
  window.matchMedia = vi.fn().mockImplementation((q: string) => ({
    matches: q.includes('fine') ? fine : !fine,
    media: q, addEventListener: vi.fn(), removeEventListener: vi.fn(), addListener: vi.fn(), removeListener: vi.fn(), onchange: null, dispatchEvent: vi.fn(),
  })) as unknown as typeof window.matchMedia
}

function renderComposer(onSent = vi.fn()) {
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <ToastProvider>
        <Composer projectId="p1" senderId="u1" onSent={onSent} />
      </ToastProvider>
    </QueryClientProvider>,
  )
  return onSent
}

beforeEach(() => stubPointer(true))
afterEach(() => vi.clearAllMocks())

describe('Composer', () => {
  it('disables Send for whitespace only', async () => {
    renderComposer()
    await userEvent.type(screen.getByLabelText('Message'), '  {Shift>}{Enter}{/Shift} ')
    expect(screen.getByRole('button', { name: 'Send' })).toBeDisabled()
  })

  it('Enter sends on a fine pointer; Shift+Enter inserts a newline', async () => {
    vi.mocked(sendMessage).mockResolvedValue(row)
    const onSent = renderComposer()
    const box = screen.getByLabelText('Message')
    await userEvent.type(box, 'a{Shift>}{Enter}{/Shift}b')
    expect(box).toHaveValue('a\nb')
    expect(sendMessage).not.toHaveBeenCalled()
    await userEvent.type(box, '{Enter}')
    await waitFor(() => expect(onSent).toHaveBeenCalledWith(row))
    expect(sendMessage).toHaveBeenCalledWith({ projectId: 'p1', senderId: 'u1', body: 'a\nb', files: [] })
  })

  it('Enter inserts a newline on a coarse pointer', async () => {
    stubPointer(false)
    renderComposer()
    const box = screen.getByLabelText('Message')
    await userEvent.type(box, 'a{Enter}b')
    expect(box).toHaveValue('a\nb')
    expect(sendMessage).not.toHaveBeenCalled()
  })

  it('refuses a file that fails validation', async () => {
    renderComposer()
    await userEvent.upload(screen.getByLabelText('Attach'), new File(['x'], 'evil.svg', { type: 'image/svg+xml' }), { applyAccept: false })
    expect(screen.getByRole('alert')).toHaveTextContent('evil.svg')
    expect(screen.queryByRole('button', { name: 'Remove evil.svg' })).not.toBeInTheDocument()
  })

  it('refuses a 6th file', async () => {
    renderComposer()
    const files = ['1', '2', '3', '4', '5', '6'].map((n) => png(`${n}.png`))
    await userEvent.upload(screen.getByLabelText('Attach'), files)
    expect(screen.getAllByRole('button', { name: /^Remove / })).toHaveLength(5)
    expect(screen.getByRole('alert')).toHaveTextContent('5 attachments')
  })

  it('keeps text and chips and toasts the reason when the send fails', async () => {
    vi.mocked(sendMessage).mockRejectedValue(new Error('boom'))
    renderComposer()
    await userEvent.type(screen.getByLabelText('Message'), 'hello')
    await userEvent.upload(screen.getByLabelText('Attach'), png())
    await userEvent.click(screen.getByRole('button', { name: 'Send' }))
    await waitFor(() => expect(sendMessage).toHaveBeenCalled())
    expect(await screen.findByText(/boom|went wrong|try again/i)).toBeInTheDocument()
    expect(screen.getByLabelText('Message')).toHaveValue('hello')
    expect(screen.getByRole('button', { name: 'Remove a.png' })).toBeInTheDocument()
  })

  it('clears on success and keeps focus in the textarea', async () => {
    vi.mocked(sendMessage).mockResolvedValue(row)
    renderComposer()
    const box = screen.getByLabelText('Message')
    await userEvent.type(box, 'hello')
    await userEvent.upload(screen.getByLabelText('Attach'), png())
    await userEvent.click(screen.getByRole('button', { name: 'Send' }))
    await waitFor(() => expect(box).toHaveValue(''))
    expect(screen.queryByRole('button', { name: 'Remove a.png' })).not.toBeInTheDocument()
    expect(box).toHaveFocus()
  })
})
