import { lazy } from 'react'
import { Route, Routes } from 'react-router-dom'
import { useAuth } from './auth/AuthProvider'
import { RequireAdmin, RequireAuth } from './auth/guards'
import { AppShell, PublicLayout } from './shell/AppShell'

const LoginPage = lazy(() => import('./pages/LoginPage'))
const SetupPage = lazy(() => import('./pages/SetupPage'))
const AccountPage = lazy(() => import('./pages/AccountPage'))
const NotFoundPage = lazy(() => import('./pages/NotFoundPage'))
const DashboardPage = lazy(() => import('./pages/admin/DashboardPage'))
const ClientsPage = lazy(() => import('./pages/admin/ClientsPage'))
const MyProjectsPage = lazy(() => import('./pages/client/MyProjectsPage'))

function Home() {
  const { profile } = useAuth()
  return profile?.role === 'admin' ? <DashboardPage /> : <MyProjectsPage />
}

export function AppRoutes() {
  return (
    <Routes>
      <Route element={<PublicLayout />}>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/setup" element={<SetupPage />} />
      </Route>
      <Route element={<RequireAuth />}>
        <Route element={<AppShell />}>
          <Route index element={<Home />} />
          <Route element={<RequireAdmin />}>
            <Route path="/clients" element={<ClientsPage />} />
          </Route>
          <Route path="/account" element={<AccountPage />} />
          <Route path="*" element={<NotFoundPage />} />
        </Route>
      </Route>
    </Routes>
  )
}
