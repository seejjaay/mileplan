import { useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { listMilestones } from '../../api/milestones'
import { listUpdates, postUpdate, type UpdateRow } from '../../api/updates'
import { signedUrl } from '../../api/storage'
import { qk } from '../../api/keys'
import type { ProjectSummary } from '../../api/projects'
import { useAuth } from '../../auth/AuthProvider'
import { toUserMessage } from '../../lib/errors'
import { formatBytes } from '../../lib/format'
import { openUrl } from '../../lib/openUrl'
import { ACCEPT_ATTR, validateUpload } from '../../lib/validateUpload'
import { AsyncView } from '../../ui/AsyncView'
import { Button } from '../../ui/Button'
import { Field } from '../../ui/Field'
import { Markdown } from '../../ui/Markdown'
import { useToast } from '../../ui/Toast'

const inputClass = 'min-h-11 w-full rounded-md border border-[var(--border)] bg-[var(--surface)] px-3'

function whenLabel(iso: string): string {
  return new Date(iso).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' })
}

function Composer({ project }: { project: ProjectSummary }) {
  const { profile } = useAuth()
  const toast = useToast()
  const queryClient = useQueryClient()
  const [body, setBody] = useState('')
  const [milestoneId, setMilestoneId] = useState('')
  const [files, setFiles] = useState<File[]>([])
  const [fileInputKey, setFileInputKey] = useState(0)
  const milestones = useQuery({ queryKey: qk.milestones(project.id), queryFn: () => listMilestones(project.id) })

  const post = useMutation({
    mutationFn: () =>
      postUpdate({ projectId: project.id, authorId: profile!.id, body, milestoneId: milestoneId || undefined, files }),
    onSuccess: () => {
      toast.success('Update posted')
      setBody('')
      setMilestoneId('')
      setFiles([])
      setFileInputKey((k) => k + 1)
      void queryClient.invalidateQueries({ queryKey: qk.updates(project.id) })
      void queryClient.invalidateQueries({ queryKey: qk.activity(project.id) })
    },
    onError: (err) => toast.error(toUserMessage(err)),
  })

  function pickFiles(picked: File[]) {
    const ok: File[] = []
    for (const f of picked) {
      const problem = validateUpload(f)
      if (problem) toast.error(problem)
      else ok.push(f)
    }
    setFiles(ok)
  }

  function submit(e: FormEvent) {
    e.preventDefault()
    if (body.trim() && profile) post.mutate()
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4 rounded-md border border-[var(--border)] bg-[var(--surface)] p-4">
      <Field label="Write an update (Markdown)">
        <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={4} className={`${inputClass} py-2`} />
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Linked milestone (optional)">
          <select value={milestoneId} onChange={(e) => setMilestoneId(e.target.value)} className={inputClass}>
            <option value="">None</option>
            {(milestones.data ?? []).map((m) => (
              <option key={m.id} value={m.id}>
                {m.title}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Attachments">
          <input
            key={fileInputKey}
            type="file"
            multiple
            accept={ACCEPT_ATTR}
            onChange={(e) => pickFiles(Array.from(e.target.files ?? []))}
            className={`${inputClass} py-2`}
          />
        </Field>
      </div>
      {files.length > 0 && (
        <ul className="flex flex-col gap-1 text-sm">
          {files.map((f, i) => (
            <li key={`${f.name}-${i}`} className="flex items-center justify-between gap-2">
              <span>
                {f.name} <span className="text-[var(--muted)]">({formatBytes(f.size)})</span>
              </span>
              <Button variant="secondary" aria-label={`Remove ${f.name}`} onClick={() => setFiles((all) => all.filter((_, j) => j !== i))}>
                Remove
              </Button>
            </li>
          ))}
        </ul>
      )}
      <div>
        <Button type="submit" loading={post.isPending} disabled={!body.trim()}>
          Post update
        </Button>
      </div>
    </form>
  )
}

function UpdateItem({ update }: { update: UpdateRow }) {
  const toast = useToast()
  const open = useMutation({
    mutationFn: async (a: UpdateRow['attachments'][number]) => openUrl(await signedUrl('attachments', a.path, a.name)),
    onError: (err) => toast.error(toUserMessage(err)),
  })
  return (
    <li className="flex flex-col gap-3 rounded-md border border-[var(--border)] bg-[var(--surface)] p-4">
      <p className="flex flex-wrap items-center gap-x-2 text-sm text-[var(--muted)]">
        <span>
          {update.author_name ?? 'Project team'} · {whenLabel(update.created_at)}
        </span>
        {update.milestone && <span className="rounded-full border border-[var(--border)] px-2 py-0.5">Re: {update.milestone.title}</span>}
      </p>
      <Markdown>{update.body}</Markdown>
      {update.attachments.length > 0 && (
        <ul className="flex flex-wrap gap-2">
          {update.attachments.map((a) => (
            <li key={a.path}>
              <Button variant="secondary" loading={open.isPending && open.variables?.path === a.path} onClick={() => open.mutate(a)}>
                {a.name} ({formatBytes(a.size)})
              </Button>
            </li>
          ))}
        </ul>
      )}
    </li>
  )
}

export default function UpdatesTab({ project }: { project: ProjectSummary }) {
  const { profile } = useAuth()
  const query = useQuery({ queryKey: qk.updates(project.id), queryFn: () => listUpdates(project.id) })
  return (
    <div className="flex flex-col gap-4">
      <h2 className="text-lg font-semibold">Updates</h2>
      {profile?.role === 'admin' && <Composer project={project} />}
      <AsyncView query={query} onRetry={() => void query.refetch()} empty={<p className="text-[var(--muted)]">No updates yet.</p>}>
        {(updates) => (
          <ul className="flex flex-col gap-3">
            {updates.map((u) => (
              <UpdateItem key={u.id} update={u} />
            ))}
          </ul>
        )}
      </AsyncView>
    </div>
  )
}
