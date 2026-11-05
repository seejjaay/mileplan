import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Link, MemoryRouter, Route, Routes } from 'react-router-dom'
import { ToastProvider, useToast } from './Toast'

function PageA() {
  const toast = useToast()
  return (
    <>
      <button onClick={() => toast.success('Saved')}>Save</button>
      <button onClick={() => toast.error('Failed')}>Break</button>
      <Link to="/b">Go to B</Link>
    </>
  )
}

function renderApp() {
  render(
    <MemoryRouter initialEntries={['/a']}>
      <ToastProvider>
        <Routes>
          <Route path="/a" element={<PageA />} />
          <Route path="/b" element={<p>Page B</p>} />
        </Routes>
      </ToastProvider>
    </MemoryRouter>,
  )
}

describe('Toast', () => {
  it('announces toasts in a polite status region', async () => {
    renderApp()
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(screen.getByRole('status')).toHaveTextContent('Saved')
    expect(screen.getByRole('status')).toHaveAttribute('aria-live', 'polite')
  })

  it('toast survives route change', async () => {
    renderApp()
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))
    await userEvent.click(screen.getByRole('link', { name: 'Go to B' }))
    expect(screen.getByText('Page B')).toBeInTheDocument()
    expect(screen.getByText('Saved')).toBeVisible()
  })
})
