import { useQuery } from '@tanstack/react-query'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ToastProvider } from '../../../ui/Toast'
import { SortableList } from './SortableList'
import { useReorder } from './useReorder'

type Item = { id: string; name: string }
const items: Item[] = [
  { id: 'a', name: 'Alpha' },
  { id: 'b', name: 'Bravo' },
  { id: 'c', name: 'Charlie' },
]

// jsdom has no layout: give each sortable wrapper a rect stacked by DOM order so keyboard moves have somewhere to go.
const original = Element.prototype.getBoundingClientRect
beforeAll(() => {
  Element.prototype.getBoundingClientRect = function (this: Element) {
    const all = Array.from(document.querySelectorAll('[data-sortable-id]'))
    const i = Math.max(0, all.indexOf(this as HTMLElement))
    return { x: 0, y: i * 100, top: i * 100, left: 0, bottom: i * 100 + 100, right: 300, width: 300, height: 100, toJSON() {} }
  }
})
afterAll(() => {
  Element.prototype.getBoundingClientRect = original
})

function List({ onReorder }: { onReorder: (ids: string[]) => void }) {
  return (
    <SortableList
      items={items}
      label="Items"
      onReorder={onReorder}
      handleLabel={(i) => `Reorder ${i.name}`}
      renderItem={(i, handle) => (
        <div>
          {handle}
          <span>{i.name}</span>
        </div>
      )}
    />
  )
}

async function moveDown(name: string) {
  const user = userEvent.setup()
  screen.getByRole('button', { name }).focus()
  await user.keyboard(' ')
  await user.keyboard('{ArrowDown}')
  await user.keyboard(' ')
}

describe('SortableList', () => {
  it('Space, ArrowDown, Space moves an item and reports the new order', async () => {
    const onReorder = vi.fn()
    render(<List onReorder={onReorder} />)
    await moveDown('Reorder Alpha')
    await waitFor(() => expect(onReorder).toHaveBeenCalledWith(['b', 'a', 'c']))
  })

  it('does not report an order when nothing moved', async () => {
    const onReorder = vi.fn()
    render(<List onReorder={onReorder} />)
    const user = userEvent.setup()
    screen.getByRole('button', { name: 'Reorder Alpha' }).focus()
    await user.keyboard(' ')
    await user.keyboard(' ')
    expect(onReorder).not.toHaveBeenCalled()
  })
})

// Stand-in for the database: accepted orders are remembered, so the refetch after success agrees with the optimistic view.
let server: Item[] = items
beforeEach(() => {
  server = items
})
const accept = (ids: string[]) => {
  server = ids.map((id) => items.find((i) => i.id === id)!)
}

function Harness({ apply }: { apply: (ids: string[]) => Promise<void> }) {
  const query = useQuery({ queryKey: ['items'], queryFn: async () => server, staleTime: Infinity })
  const reorder = useReorder<Item[]>(['items'], apply, (cache, ids) => ids.map((id) => cache.find((i) => i.id === id)!))
  return (
    <>
      <SortableList
        items={query.data ?? []}
        label="Items"
        onReorder={(ids) => reorder.mutate(ids)}
        handleLabel={(i) => `Reorder ${i.name}`}
        renderItem={(i, handle) => (
          <div>
            {handle}
            <span>{i.name}</span>
          </div>
        )}
      />
    </>
  )
}

function names() {
  return within(screen.getByRole('list', { name: 'Items' }))
    .getAllByText(/^(Alpha|Bravo|Charlie)$/)
    .map((n) => n.textContent)
}

describe('useReorder', () => {
  it('shows the new order straight away and keeps it when the server accepts', async () => {
    const apply = vi.fn(async (ids: string[]) => accept(ids))
    const queryClient = new QueryClient()
    render(
      <QueryClientProvider client={queryClient}>
        <ToastProvider>
          <Harness apply={apply} />
        </ToastProvider>
      </QueryClientProvider>,
    )
    await screen.findByText('Alpha')
    await moveDown('Reorder Alpha')
    await waitFor(() => expect(apply).toHaveBeenCalledWith(['b', 'a', 'c']))
    expect(names()).toEqual(['Bravo', 'Alpha', 'Charlie'])
    expect(await screen.findByText('Order saved')).toBeInTheDocument()
  })

  it('rolls back to the server order and toasts the reason when the server rejects', async () => {
    const apply = vi.fn(async () => {
      throw new Error('the milestone list is out of date')
    })
    render(
      <QueryClientProvider client={new QueryClient()}>
        <ToastProvider>
          <Harness apply={apply} />
        </ToastProvider>
      </QueryClientProvider>,
    )
    await screen.findByText('Alpha')
    await moveDown('Reorder Alpha')
    expect(await screen.findByText('the milestone list is out of date')).toBeInTheDocument()
    await waitFor(() => expect(names()).toEqual(['Alpha', 'Bravo', 'Charlie']))
  })
})
