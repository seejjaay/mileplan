import { Navigate, Outlet, useLocation } from 'react-router-dom'
import DeactivatedPage from '../pages/DeactivatedPage'
import { useAuth } from './AuthProvider'

function AuthLoading() {
  return <div role="status" aria-label="Loading" aria-busy="true" className="m-8 h-16 animate-pulse rounded-md bg-[var(--border)]" />
}

export function RequireAuth() {
  const { session, profile, loading } = useAuth()
  const location = useLocation()
  if (loading) return <AuthLoading />
  if (!session) {
    const next = encodeURIComponent(location.pathname + location.search)
    return <Navigate to={`/login?next=${next}`} replace />
  }
  if (profile && !profile.active) return <DeactivatedPage />
  return <Outlet />
}

export function RequireAdmin() {
  const { profile, loading } = useAuth()
  if (loading) return <AuthLoading />
  if (profile?.role !== 'admin') return <Navigate to="/" replace />
  return <Outlet />
}
