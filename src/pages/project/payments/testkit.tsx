import type { ReactNode } from 'react'
import { render } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { Session } from '@supabase/supabase-js'
import { AuthContext } from '../../../auth/AuthProvider'
import { ToastProvider } from '../../../ui/Toast'
import type { Payment, PaymentRequest } from '../../../api/payments'
import type { ProjectSummary } from '../../../api/projects'

/** Shared fixtures and a provider wrapper for the Payments tests. Not imported by production code. */
export const project = (status: ProjectSummary['status'] = 'active'): ProjectSummary => ({
  id: 'p1',
  title: 'Website rebuild',
  summary: null,
  status,
  currency: 'PHP',
  start_date: null,
  end_date: null,
  activated_at: null,
  closed_at: null,
  created_at: '2026-11-01T00:00:00Z',
  percent: 0,
  nextDue: null,
  scheduled: 0,
  paid: 0,
  outstanding: 0,
  overdue: 0,
})

export const payment = (over: Partial<Payment> = {}): Payment => ({
  id: 'pay1',
  request_id: 'r1',
  amount: 500,
  method: 'GCash',
  reference: 'ref-1',
  paid_on: '2026-11-08',
  proof_path: 'p1/11111111-1111-1111-1111-111111111111-proof.png',
  status: 'pending',
  submitted_by: 'client1',
  reviewed_at: null,
  review_note: null,
  created_at: '2026-11-08T08:00:00Z',
  submitter_name: 'Eve Estrada',
  ...over,
})

/** Due dates are far from "today" so the tests never depend on the clock. */
export const FUTURE = '2999-01-01'
export const PAST = '2000-01-01'

export const request = (over: Partial<PaymentRequest> = {}): PaymentRequest => ({
  id: 'r1',
  project_id: 'p1',
  milestone_id: 'm1',
  title: '50% deposit',
  amount: 1000,
  due_date: FUTURE,
  created_at: '2026-11-01T00:00:00Z',
  payments: [],
  ...over,
})

export function renderWithProviders(ui: ReactNode, role: 'admin' | 'client' = 'admin') {
  const user = userEvent.setup({ applyAccept: false })
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const invalidate = vi.spyOn(queryClient, 'invalidateQueries')
  const utils = render(
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <AuthContext.Provider
          value={{
            session: { user: { id: 'u1' } } as Session,
            profile: { id: 'u1', role, full_name: 'X', active: true },
            loading: false,
            signOut: async () => {},
          }}
        >
          {ui}
        </AuthContext.Provider>
      </ToastProvider>
    </QueryClientProvider>,
  )
  return { user, invalidate, ...utils }
}
