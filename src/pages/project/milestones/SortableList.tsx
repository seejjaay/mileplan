import type { ReactNode } from 'react'
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type Announcements,
  type DragEndEvent,
} from '@dnd-kit/core'
import { SortableContext, arrayMove, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'

type Props<T extends { id: string }> = {
  items: T[]
  label: string
  onReorder: (ids: string[]) => void
  handleLabel: (item: T) => string
  renderItem: (item: T, handle: ReactNode) => ReactNode
}

function SortableItem<T extends { id: string }>({
  item,
  handleLabel,
  renderItem,
}: Pick<Props<T>, 'handleLabel' | 'renderItem'> & { item: T }) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id: item.id })
  const handle = (
    <button
      type="button"
      ref={setActivatorNodeRef}
      aria-label={handleLabel(item)}
      {...attributes}
      {...listeners}
      className="inline-flex min-h-11 min-w-11 cursor-grab touch-none items-center justify-center rounded-md border border-[var(--border)] text-[var(--muted)]"
    >
      <span aria-hidden="true">⠿</span>
    </button>
  )
  return (
    <li
      ref={setNodeRef}
      data-sortable-id={item.id}
      style={{ transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.6 : 1 }}
    >
      {renderItem(item, handle)}
    </li>
  )
}

/** Vertical sortable list: mouse/touch drag plus keyboard (Space to lift, arrows to move, Space to drop). */
export function SortableList<T extends { id: string }>({ items, label, onReorder, handleLabel, renderItem }: Props<T>) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )
  const ids = items.map((i) => i.id)
  const nameOf = (id: string | number) => {
    const item = items.find((i) => i.id === id)
    return item ? handleLabel(item).replace(/^Reorder /, '') : String(id)
  }
  const position = (id: string | number) => ids.indexOf(String(id)) + 1

  const announcements: Announcements = {
    onDragStart: ({ active }) => `Picked up ${nameOf(active.id)}. Use the arrow keys to move it, Space to drop it.`,
    onDragOver: ({ active, over }) => (over ? `${nameOf(active.id)} is now at position ${position(over.id)} of ${ids.length}.` : undefined),
    onDragEnd: ({ active, over }) => (over ? `Dropped ${nameOf(active.id)} at position ${position(over.id)} of ${ids.length}.` : `Dropped ${nameOf(active.id)}.`),
    onDragCancel: ({ active }) => `Cancelled. ${nameOf(active.id)} stays where it was.`,
  }

  function onDragEnd({ active, over }: DragEndEvent) {
    if (!over || active.id === over.id) return
    const from = ids.indexOf(String(active.id))
    const to = ids.indexOf(String(over.id))
    if (from < 0 || to < 0) return
    onReorder(arrayMove(ids, from, to))
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragEnd={onDragEnd}
      accessibility={{
        announcements,
        screenReaderInstructions: { draggable: 'Press Space to lift this item, use the arrow keys to move it, press Space again to drop it.' },
      }}
    >
      <SortableContext items={ids} strategy={verticalListSortingStrategy}>
        <ul aria-label={label} className="flex flex-col gap-3">
          {items.map((item) => (
            <SortableItem key={item.id} item={item} handleLabel={handleLabel} renderItem={renderItem} />
          ))}
        </ul>
      </SortableContext>
    </DndContext>
  )
}
