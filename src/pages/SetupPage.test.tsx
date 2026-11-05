import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { ToastProvider } from '../ui/Toast'
import { supabase } from '../lib/supabase'
import SetupPage from './SetupPage'

vi.mock('../lib/supabase', () => ({
  supabase: { auth: { signInWithPassword: vi.fn(async () => ({ error: null })) } },
}))

const BAD_LINK = 'This setup link has expired or was already used. Ask CJ for a new link.'

function respond(status: number, body: unknown) {
  const fetchMock = vi.fn(async () => new Response(JSON.stringify(body), { status }))
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

function renderSetup(url = '/setup#token=abc') {
  window.history.replaceState(null, '', url)
  render(
    <ToastProvider>
      <MemoryRouter initialEntries={['/setup']}>
        <Routes>
          <Route path="/setup" element={<SetupPage />} />
          <Route path="/" element={<p>Home page</p>} />
        </Routes>
      </MemoryRouter>
    </ToastProvider>,
  )
}

async function submit(password: string) {
  await userEvent.type(screen.getByLabelText('Password'), password)
  await userEvent.click(screen.getByRole('button', { name: 'Set password' }))
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})

describe('SetupPage', () => {
  it('reads token from hash, not query', async () => {
    const fetchMock = respond(200, { email: 'cara@client-c.test' })
    renderSetup('/setup?token=wrong#token=abc')
    await submit('long-enough-1')
    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(JSON.parse(init.body as string)).toEqual({ token: 'abc', password: 'long-enough-1' })
  })

  it('signs in with the returned email and goes home', async () => {
    respond(200, { email: 'cara@client-c.test' })
    renderSetup()
    await submit('long-enough-1')
    expect(await screen.findByText('Home page')).toBeInTheDocument()
    expect(supabase.auth.signInWithPassword).toHaveBeenCalledWith({ email: 'cara@client-c.test', password: 'long-enough-1' })
  })

  it('shows bad-link copy on 410', async () => {
    respond(410, { error: 'invalid_or_expired' })
    renderSetup()
    await submit('long-enough-1')
    expect(await screen.findByRole('alert')).toHaveTextContent(BAD_LINK)
  })

  it('shows bad-link copy when there is no token in the hash', () => {
    renderSetup('/setup')
    expect(screen.getByRole('alert')).toHaveTextContent(BAD_LINK)
  })

  it('blocks submit under 8 chars', async () => {
    const fetchMock = respond(200, { email: 'x@y.test' })
    renderSetup()
    await userEvent.type(screen.getByLabelText('Password'), 'short')
    expect(screen.getByRole('button', { name: 'Set password' })).toBeDisabled()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('clears hash after reading', () => {
    renderSetup('/setup#token=abc')
    expect(window.location.hash).toBe('')
  })
})
