import { render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import type { Session } from '@supabase/supabase-js'
import { AuthContext, type AuthContextValue } from './AuthProvider'
import { RequireAdmin, RequireAuth } from './guards'

function Probe() {
  const loc = useLocation()
  return <p>login at {loc.pathname + loc.search}</p>
}

function value(overrides: Partial<AuthContextValue> = {}): AuthContextValue {
  return {
    session: { user: { id: 'u1' } } as Session,
    profile: { id: 'u1', role: 'client', full_name: 'Ana', active: true },
    loading: false,
    signOut: vi.fn(async () => {}),
    ...overrides,
  }
}

function renderAt(path: string, auth: AuthContextValue) {
  render(
    <AuthContext.Provider value={auth}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/login" element={<Probe />} />
          <Route element={<RequireAuth />}>
            <Route path="/" element={<p>Home</p>} />
            <Route element={<RequireAdmin />}>
              <Route path="/clients" element={<p>Admin clients</p>} />
            </Route>
          </Route>
        </Routes>
      </MemoryRouter>
    </AuthContext.Provider>,
  )
}

describe('guards', () => {
  it('RequireAdmin redirects client to /', () => {
    renderAt('/clients', value())
    expect(screen.getByText('Home')).toBeInTheDocument()
    expect(screen.queryByText('Admin clients')).not.toBeInTheDocument()
  })

  it('RequireAdmin lets an admin through', () => {
    renderAt('/clients', value({ profile: { id: 'u1', role: 'admin', full_name: 'CJ', active: true } }))
    expect(screen.getByText('Admin clients')).toBeInTheDocument()
  })

  it('RequireAuth redirects anonymous to /login?next=<path>', () => {
    renderAt('/clients', value({ session: null, profile: null }))
    expect(screen.getByText('login at /login?next=%2Fclients')).toBeInTheDocument()
  })

  it('shows a loading status while auth resolves, never a redirect', () => {
    renderAt('/clients', value({ session: null, profile: null, loading: true }))
    expect(screen.getByRole('status', { name: 'Loading' })).toBeInTheDocument()
  })

  it('deactivated profile renders DeactivatedPage', () => {
    renderAt('/', value({ profile: { id: 'u1', role: 'client', full_name: 'Ana', active: false } }))
    expect(screen.getByRole('heading', { name: 'Account deactivated' })).toBeInTheDocument()
    expect(screen.queryByText('Home')).not.toBeInTheDocument()
  })
})
