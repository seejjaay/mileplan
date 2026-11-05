import { render, screen } from '@testing-library/react'
import { StatusChip } from './StatusChip'

describe('StatusChip', () => {
  it('renders label text', () => {
    render(<StatusChip status="active" label="In review" />)
    expect(screen.getByText('In review')).toBeVisible()
  })

  it('changes fill style per status, not only colour', () => {
    const { rerender } = render(<StatusChip status="done" label="Done" />)
    const solid = screen.getByText('Done').closest('[data-variant]')?.getAttribute('data-variant')
    rerender(<StatusChip status="upcoming" label="Next" />)
    const dashed = screen.getByText('Next').closest('[data-variant]')?.getAttribute('data-variant')
    expect(solid).toBe('solid')
    expect(dashed).toBe('dashed')
  })
})
