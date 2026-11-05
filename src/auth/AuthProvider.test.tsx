import { act, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { Session } from '@supabase/supabase-js'
import { AuthProvider, useAuth } from './AuthProvider'

type Listener = (event: string, session: Session | null) => void
let listener: Listener = () => {}

vi.mock('../lib/supabase', () => ({
  supabase: {
    auth: {
      getSession: vi.fn(async () => ({ data: { session: null } })),
      onAuthStateChange: vi.fn((cb: Listener) => {
        listener = cb
        return { data: { subscription: { unsubscribe: vi.fn() } } }
      }),
      signOut: vi.fn(async () => {}),
    },
    from: vi.fn(() => ({
      select: () => ({ eq: () => ({ single: async () => ({ data: { id: 'a', role: 'client', full_name: 'A', active: true }, error: null }) }) }),
    })),
  },
}))

const session = (id: string) => ({ user: { id } }) as Session

function Probe() {
  const { profile, loading } = useAuth()
  return <p>{loading ? 'loading' : (profile?.full_name ?? 'anonymous')}</p>
}

describe('AuthProvider cache hygiene', () => {
  it('drops cached data when the signed-in user changes or signs out elsewhere', async () => {
    const client = new QueryClient()
    render(
      <QueryClientProvider client={client}>
        <AuthProvider>
          <Probe />
        </AuthProvider>
      </QueryClientProvider>,
    )
    await screen.findByText('anonymous')

    act(() => listener('SIGNED_IN', session('user-a')))
    await screen.findByText('A')
    client.setQueryData(['projects'], [{ id: 'p1', title: "A's private project" }])

    // session ends in another tab / on expiry: no explicit signOut() call here
    act(() => listener('SIGNED_OUT', null))
    await waitFor(() => expect(client.getQueryData(['projects'])).toBeUndefined())
  })
})
