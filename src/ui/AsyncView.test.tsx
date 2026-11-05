import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { UseQueryResult } from '@tanstack/react-query'
import { AsyncView } from './AsyncView'

function fakeQuery(partial: Partial<UseQueryResult<string[]>>): UseQueryResult<string[]> {
  return { isPending: false, isError: false, isSuccess: false, data: undefined, error: null, ...partial } as UseQueryResult<string[]>
}

const empty = <p>Nothing here yet</p>
const list = (items: string[]) => <ul>{items.map((i) => <li key={i}>{i}</li>)}</ul>

describe('AsyncView', () => {
  it('shows skeleton while pending, not empty state', () => {
    render(
      <AsyncView query={fakeQuery({ isPending: true })} empty={empty} onRetry={() => {}}>
        {list}
      </AsyncView>,
    )
    expect(screen.getByRole('status', { name: 'Loading' })).toBeInTheDocument()
    expect(screen.queryByText('Nothing here yet')).not.toBeInTheDocument()
  })

  it('shows error with Retry that calls onRetry', async () => {
    const onRetry = vi.fn()
    render(
      <AsyncView query={fakeQuery({ isError: true, error: new Error('Boom') })} empty={empty} onRetry={onRetry}>
        {list}
      </AsyncView>,
    )
    expect(screen.getByRole('alert')).toHaveTextContent('Boom')
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(onRetry).toHaveBeenCalledTimes(1)
  })

  it('shows empty only after success with []', () => {
    render(
      <AsyncView query={fakeQuery({ isSuccess: true, data: [] })} empty={empty} onRetry={() => {}}>
        {list}
      </AsyncView>,
    )
    expect(screen.getByText('Nothing here yet')).toBeInTheDocument()
    expect(screen.queryByRole('status', { name: 'Loading' })).not.toBeInTheDocument()
  })

  it('renders children with data on success', () => {
    render(
      <AsyncView query={fakeQuery({ isSuccess: true, data: ['a', 'b'] })} empty={empty} onRetry={() => {}}>
        {list}
      </AsyncView>,
    )
    expect(screen.getAllByRole('listitem')).toHaveLength(2)
  })
})
