import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { ToastProvider } from '../../ui/Toast'
import { createProject } from '../../api/projects'
import NewProjectPage from './NewProjectPage'

vi.mock('../../api/projects', () => ({ createProject: vi.fn() }))

function renderPage() {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <ToastProvider>
        <MemoryRouter initialEntries={['/projects/new']}>
          <Routes>
            <Route path="/projects/new" element={<NewProjectPage />} />
            <Route path="/projects/:id" element={<p>Project page</p>} />
          </Routes>
        </MemoryRouter>
      </ToastProvider>
    </QueryClientProvider>,
  )
}

afterEach(() => vi.clearAllMocks())

describe('NewProjectPage', () => {
  it('disables Create until a title is filled, and defaults currency to PHP', async () => {
    renderPage()
    expect(screen.getByLabelText('Currency')).toHaveValue('PHP')
    const create = screen.getByRole('button', { name: 'Create project' })
    expect(create).toBeDisabled()
    await userEvent.type(screen.getByLabelText('Title'), 'Website rebuild')
    expect(create).toBeEnabled()
  })

  it('blocks an end date before the start date', async () => {
    renderPage()
    await userEvent.type(screen.getByLabelText('Title'), 'X')
    await userEvent.type(screen.getByLabelText('Start date'), '2026-12-10')
    await userEvent.type(screen.getByLabelText('End date'), '2026-12-01')
    expect(screen.getByRole('button', { name: 'Create project' })).toBeDisabled()
    expect(screen.getByText('End date must be on or after the start date')).toBeInTheDocument()
  })

  it('creates, toasts and opens the project', async () => {
    vi.mocked(createProject).mockResolvedValue('p-123')
    renderPage()
    await userEvent.type(screen.getByLabelText('Title'), 'Website rebuild')
    await userEvent.click(screen.getByRole('button', { name: 'Create project' }))
    await waitFor(() =>
      expect(createProject).toHaveBeenCalledWith(expect.objectContaining({ title: 'Website rebuild', currency: 'PHP' })),
    )
    expect(await screen.findByText('Project page')).toBeInTheDocument()
    expect(screen.getByText('Project created')).toBeInTheDocument()
  })
})
