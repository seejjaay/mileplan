import { Suspense, useEffect, useRef } from 'react'
import { NavLink, Outlet, useLocation } from 'react-router-dom'
import { useAuth } from '../auth/AuthProvider'
import { useNotificationsRealtime } from '../realtime/useNotificationsRealtime'
import { useUnreadRealtime } from '../realtime/useUnreadRealtime'
import { ErrorBoundary } from './ErrorBoundary'

const linkClass = ({ isActive }: { isActive: boolean }) =>
  `rounded-md px-3 py-2 text-sm font-medium ${isActive ? 'bg-[var(--border)] text-[var(--text)]' : 'text-[var(--muted)]'}`

function PageFallback() {
  return <div role="status" aria-label="Loading" aria-busy="true" className="h-24 animate-pulse rounded-md bg-[var(--border)]" />
}

export function AppShell() {
  const { session, profile, signOut } = useAuth()
  useUnreadRealtime(session?.user.id)
  useNotificationsRealtime(session?.user.id)
  const location = useLocation()
  const main = useRef<HTMLElement>(null)
  const first = useRef(true)

  // Move focus to the page on route change so keyboard and screen-reader users land at the top.
  useEffect(() => {
    if (first.current) {
      first.current = false
      return
    }
    main.current?.focus()
  }, [location.pathname])

  const isAdmin = profile?.role === 'admin'
  return (
    <div className="min-h-screen">
      <header className="flex flex-wrap items-center gap-4 border-b border-[var(--border)] bg-[var(--surface)] px-4 py-3">
        <span className="text-xl font-bold tracking-tight" style={{ fontFamily: 'var(--font-display)' }}>
          MilePlan
        </span>
        <nav aria-label="Main" className="flex flex-1 gap-1">
          {isAdmin ? (
            <>
              <NavLink to="/" end className={linkClass}>
                Dashboard
              </NavLink>
              <NavLink to="/clients" className={linkClass}>
                Clients
              </NavLink>
            </>
          ) : (
            <NavLink to="/" end className={linkClass}>
              My projects
            </NavLink>
          )}
        </nav>
        <details className="relative">
          <summary className="cursor-pointer rounded-md px-3 py-2 text-sm font-medium">{profile?.full_name || 'Account'}</summary>
          <div className="absolute right-0 z-30 mt-1 flex min-w-40 flex-col rounded-md border border-[var(--border)] bg-[var(--surface)] p-1 shadow-md">
            <NavLink to="/account" className="rounded px-3 py-2 text-sm">
              Account
            </NavLink>
            <button type="button" onClick={() => void signOut()} className="rounded px-3 py-2 text-left text-sm">
              Sign out
            </button>
          </div>
        </details>
      </header>
      <main id="main" ref={main} tabIndex={-1} className="mx-auto max-w-5xl p-4 outline-none sm:p-6">
        <ErrorBoundary key={location.pathname}>
          <Suspense fallback={<PageFallback />}>
            <Outlet />
          </Suspense>
        </ErrorBoundary>
      </main>
    </div>
  )
}

/** Layout for public pages (login, setup): same landmark, no nav. */
export function PublicLayout() {
  return (
    <main id="main" tabIndex={-1} className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-6 p-6 outline-none">
      <span className="text-3xl font-bold tracking-tight" style={{ fontFamily: 'var(--font-display)' }}>
        MilePlan
      </span>
      <Suspense fallback={<PageFallback />}>
        <Outlet />
      </Suspense>
    </main>
  )
}
