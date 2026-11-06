import { render, screen } from '@testing-library/react'
import { ClosedBanner } from './ClosedBanner'
import { project } from './payments/testkit'

describe('ClosedBanner', () => {
  it('says what happened and when, for a completed project', () => {
    render(<ClosedBanner project={{ ...project('completed'), closed_at: '2026-11-10T08:00:00Z' }} />)
    expect(screen.getByText('This project was completed on Nov 10, 2026 and is read-only.')).toBeInTheDocument()
  })

  it('says terminated for a terminated project', () => {
    render(<ClosedBanner project={{ ...project('terminated'), closed_at: '2026-11-12T08:00:00Z' }} />)
    expect(screen.getByText('This project was terminated on Nov 12, 2026 and is read-only.')).toBeInTheDocument()
  })

  it('still reads sensibly if the close date is missing', () => {
    render(<ClosedBanner project={{ ...project('completed'), closed_at: null }} />)
    expect(screen.getByText('This project was completed and is read-only.')).toBeInTheDocument()
  })

  it.each(['setup', 'active'] as const)('renders nothing while the project is %s', (status) => {
    const { container } = render(<ClosedBanner project={project(status)} />)
    expect(container).toBeEmptyDOMElement()
  })
})
