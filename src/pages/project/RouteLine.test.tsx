import { render, screen, within } from '@testing-library/react'
import type { Milestone } from '../../api/milestones'
import { ChangeMarkersContext } from './changeMarkers'
import { RouteLine } from './RouteLine'

const ms = (id: string, status: Milestone['status'], over: Partial<Milestone> = {}) => ({ id, title: `Milestone ${id}`, status, on_hold: false, due_date: null, ...over })

const plan = [ms('a', 'approved'), ms('b', 'paid'), ms('c', 'in_review'), ms('d', 'planned')]

describe('RouteLine', () => {
  it('prints a word for every marker, never colour alone', () => {
    render(<RouteLine milestones={plan} />)
    const items = screen.getAllByRole('listitem')
    expect(items).toHaveLength(4)
    expect(within(items[0]).getByText('Done')).toBeInTheDocument()
    expect(within(items[2]).getByText('In review')).toBeInTheDocument()
    expect(within(items[3]).getByText('Upcoming')).toBeInTheDocument()
  })

  it('shows each milestone title and due date', () => {
    render(<RouteLine milestones={[ms('a', 'planned', { title: 'Discovery', due_date: '2026-12-01' })]} />)
    expect(screen.getByText('Discovery')).toBeInTheDocument()
    expect(screen.getByText('Due Dec 1, 2026')).toBeInTheDocument()
  })

  it('marks the current milestone as the current step', () => {
    render(<RouteLine milestones={plan} />)
    const items = screen.getAllByRole('listitem')
    expect(items[2]).toHaveAttribute('aria-current', 'step')
    expect(items.filter((i) => i.hasAttribute('aria-current'))).toHaveLength(1)
  })

  it('draws solid segments up to the current marker and dashed segments after it', () => {
    const { container } = render(<RouteLine milestones={plan} />)
    const segments = Array.from(container.querySelectorAll('[data-segment]'))
    expect(segments).toHaveLength(3) // between 4 markers
    expect(segments.map((s) => s.getAttribute('data-reached'))).toEqual(['true', 'true', 'false'])
  })

  it('when everything is done the whole line is drawn', () => {
    const { container } = render(<RouteLine milestones={[ms('a', 'approved'), ms('b', 'paid'), ms('c', 'paid')]} />)
    expect(Array.from(container.querySelectorAll('[data-segment]')).map((s) => s.getAttribute('data-reached'))).toEqual(['true', 'true'])
  })

  it('a single milestone has a marker and no segment', () => {
    const { container } = render(<RouteLine milestones={[ms('a', 'planned')]} />)
    expect(container.querySelectorAll('[data-segment]')).toHaveLength(0)
    expect(screen.getAllByRole('listitem')).toHaveLength(1)
  })

  it('gives the ticked milestone a one-shot tick class and nobody else', () => {
    const { container } = render(<RouteLine milestones={plan} tick={{ id: 'c', at: 1 }} />)
    const ticked = container.querySelectorAll('.route-marker--tick')
    expect(ticked).toHaveLength(1)
    expect(screen.getAllByRole('listitem')[2].contains(ticked[0])).toBe(true)
  })

  it('flags milestones that changed since the last visit', () => {
    render(
      <ChangeMarkersContext.Provider value={{ milestones: new Set(['d']), tabs: new Set(), tick: null }}>
        <RouteLine milestones={plan} />
      </ChangeMarkersContext.Provider>,
    )
    const items = screen.getAllByRole('listitem')
    expect(within(items[3]).getByText('Updated')).toBeInTheDocument()
    expect(screen.getAllByText('Updated')).toHaveLength(1)
  })

  it('is a labelled ordered list so the order is announced', () => {
    render(<RouteLine milestones={plan} />)
    expect(screen.getByRole('list', { name: 'Milestone route' }).tagName).toBe('OL')
  })
})
