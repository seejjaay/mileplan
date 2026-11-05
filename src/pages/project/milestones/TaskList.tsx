import { useState, type FormEvent } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { addTask, deleteTask, reorderTasks, updateTask, type Milestone, type Task, type TaskStatus } from '../../../api/milestones'
import { invalidateProject } from '../../../api/invalidate'
import { qk } from '../../../api/keys'
import { toUserMessage } from '../../../lib/errors'
import { Button } from '../../../ui/Button'
import { useToast } from '../../../ui/Toast'
import { SortableList } from './SortableList'
import { useReorder } from './useReorder'

const STATUS_LABEL: Record<TaskStatus, string> = { todo: 'To do', doing: 'Doing', done: 'Done' }
const STATUSES = Object.keys(STATUS_LABEL) as TaskStatus[]
const inputClass = 'min-h-11 rounded-md border border-[var(--border)] bg-[var(--surface)] px-3'

type Props = { milestone: Milestone; canEdit: boolean }

function EditableTask({ task, handle, projectId }: { task: Task; handle: React.ReactNode; projectId: string }) {
  const toast = useToast()
  const queryClient = useQueryClient()
  const [title, setTitle] = useState(task.title)
  const onDone = (message: string) => {
    toast.success(message)
    return invalidateProject(queryClient, projectId)
  }
  const update = useMutation({
    mutationFn: (patch: { title?: string; status?: TaskStatus }) => updateTask(task.id, patch),
    onSuccess: () => onDone('Task updated'),
    onError: (err) => {
      setTitle(task.title)
      toast.error(toUserMessage(err))
    },
  })
  const remove = useMutation({
    mutationFn: () => deleteTask(task.id),
    onSuccess: () => onDone('Task deleted'),
    onError: (err) => toast.error(toUserMessage(err)),
  })

  return (
    <div className="flex flex-wrap items-center gap-2">
      {handle}
      <input
        aria-label={`Title of ${task.title}`}
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        onBlur={() => {
          const next = title.trim()
          if (!next) setTitle(task.title)
          else if (next !== task.title) update.mutate({ title: next })
        }}
        className={`${inputClass} min-w-0 flex-1`}
      />
      <select
        aria-label={`Status of ${task.title}`}
        value={task.status}
        onChange={(e) => update.mutate({ status: e.target.value as TaskStatus })}
        className={inputClass}
      >
        {STATUSES.map((s) => (
          <option key={s} value={s}>
            {STATUS_LABEL[s]}
          </option>
        ))}
      </select>
      <Button variant="secondary" aria-label={`Delete task ${task.title}`} loading={remove.isPending} onClick={() => remove.mutate()}>
        Delete
      </Button>
    </div>
  )
}

export function TaskList({ milestone, canEdit }: Props) {
  const toast = useToast()
  const queryClient = useQueryClient()
  const [newTitle, setNewTitle] = useState('')
  const projectId = milestone.project_id

  const reorder = useReorder<Milestone[]>(
    qk.milestones(projectId),
    (ids) => reorderTasks(milestone.id, ids),
    (cache, ids) =>
      cache.map((m) => (m.id === milestone.id ? { ...m, tasks: ids.map((id) => m.tasks.find((t) => t.id === id)!) } : m)),
  )

  const add = useMutation({
    mutationFn: () => addTask(milestone.id, newTitle, milestone.tasks.length + 1),
    onSuccess: () => {
      toast.success('Task added')
      setNewTitle('')
      return invalidateProject(queryClient, projectId)
    },
    onError: (err) => toast.error(toUserMessage(err)),
  })

  if (!canEdit) {
    if (milestone.tasks.length === 0) return null
    return (
      <ul aria-label={`Tasks for ${milestone.title}`} className="flex flex-col gap-1 text-sm">
        {milestone.tasks.map((t) => (
          <li key={t.id} className="flex justify-between gap-3">
            <span>{t.title}</span>
            <span className="text-[var(--muted)]">{STATUS_LABEL[t.status]}</span>
          </li>
        ))}
      </ul>
    )
  }

  function submit(e: FormEvent) {
    e.preventDefault()
    if (newTitle.trim()) add.mutate()
  }

  return (
    <div className="flex flex-col gap-3">
      <h4 className="text-sm font-medium">Tasks</h4>
      {milestone.tasks.length > 0 && (
        <SortableList
          items={milestone.tasks}
          label={`Tasks for ${milestone.title}`}
          onReorder={(ids) => reorder.mutate(ids)}
          handleLabel={(t) => `Reorder ${t.title}`}
          renderItem={(t, handle) => <EditableTask key={`${t.id}:${t.title}:${t.status}`} task={t} handle={handle} projectId={projectId} />}
        />
      )}
      <form onSubmit={submit} className="flex gap-2">
        <input aria-label="New task" value={newTitle} onChange={(e) => setNewTitle(e.target.value)} placeholder="New task" className={`${inputClass} min-w-0 flex-1`} />
        <Button type="submit" variant="secondary" loading={add.isPending} disabled={!newTitle.trim()}>
          Add task
        </Button>
      </form>
    </div>
  )
}
