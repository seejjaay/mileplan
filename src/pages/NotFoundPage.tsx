import { Link } from 'react-router-dom'
import { useTitle } from '../lib/useTitle'

export default function NotFoundPage() {
  useTitle('Page not found')
  return (
    <div className="flex flex-col items-start gap-3">
      <h1 className="text-2xl font-semibold">Page not found</h1>
      <p className="text-[var(--muted)]">That page doesn't exist, or you may not have access to it.</p>
      <Link to="/" className="underline">
        Back to start
      </Link>
    </div>
  )
}
