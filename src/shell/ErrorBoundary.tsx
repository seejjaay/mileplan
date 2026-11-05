import { Component, type ErrorInfo, type ReactNode } from 'react'
import { Button } from '../ui/Button'

type State = { failed: boolean }

/** Rendered inside the shell, so nav and sign-out stay available when a page crashes. */
export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { failed: false }

  static getDerivedStateFromError(): State {
    return { failed: true }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(error, info.componentStack)
  }

  render() {
    if (!this.state.failed) return this.props.children
    return (
      <div role="alert" className="flex flex-col items-start gap-3 rounded-md border border-[var(--danger)] p-6">
        <h1 className="text-xl font-semibold">Something went wrong</h1>
        <p>This page hit an error. Try again, or go back to the start.</p>
        <Button onClick={() => this.setState({ failed: false })}>Try again</Button>
      </div>
    )
  }
}
