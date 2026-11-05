import { useAuth } from '../auth/AuthProvider'
import { useTitle } from '../lib/useTitle'
import { Button } from '../ui/Button'

export default function DeactivatedPage() {
  useTitle('Account deactivated')
  const { signOut } = useAuth()
  return (
    <main id="main" tabIndex={-1} className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-4 p-6 outline-none">
      <h1 className="text-2xl font-semibold">Account deactivated</h1>
      <p>Your access to MilePlan has been turned off. If you think this is a mistake, contact CJ.</p>
      <Button variant="secondary" onClick={() => void signOut()}>
        Sign out
      </Button>
    </main>
  )
}
