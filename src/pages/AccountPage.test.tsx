import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { Session } from '@supabase/supabase-js'
import { AuthContext } from '../auth/AuthProvider'
import { ToastProvider } from '../ui/Toast'
import AccountPage from './AccountPage'

vi.mock('../lib/supabase', () => ({
  supabase: { from: vi.fn(), auth: { updateUser: vi.fn(async () => ({ error: null })) } },
}))

function renderAccount() {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <ToastProvider>
        <AuthContext.Provider
          value={{
            session: { user: { id: 'u1' } } as Session,
            profile: { id: 'u1', role: 'client', full_name: 'Ana', active: true },
            loading: false,
            signOut: async () => {},
          }}
        >
          <AccountPage />
        </AuthContext.Provider>
      </ToastProvider>
    </QueryClientProvider>,
  )
}

describe('AccountPage', () => {
  it('keeps Save disabled until the name is changed', async () => {
    renderAccount()
    const save = screen.getByRole('button', { name: 'Save name' })
    expect(save).toBeDisabled()
    await userEvent.type(screen.getByLabelText('Full name'), ' B')
    expect(save).toBeEnabled()
  })

  it('keeps Change password disabled until 8+ characters', async () => {
    renderAccount()
    const change = screen.getByRole('button', { name: 'Change password' })
    expect(change).toBeDisabled()
    await userEvent.type(screen.getByLabelText('New password'), 'long-enough-1')
    expect(change).toBeEnabled()
  })
})
