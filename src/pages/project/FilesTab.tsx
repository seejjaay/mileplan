import { useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { DOCUMENT_KINDS, fileNameFromPath, listDocuments, uploadDocument, type DocumentKind, type DocumentRow } from '../../api/documents'
import { signedUrl } from '../../api/storage'
import { qk } from '../../api/keys'
import type { ProjectSummary } from '../../api/projects'
import { useAuth } from '../../auth/AuthProvider'
import { toUserMessage } from '../../lib/errors'
import { formatDate } from '../../lib/format'
import { openUrl } from '../../lib/openUrl'
import { ACCEPT_ATTR, validateUpload } from '../../lib/validateUpload'
import { AsyncView } from '../../ui/AsyncView'
import { Button } from '../../ui/Button'
import { Field } from '../../ui/Field'
import { StatusChip } from '../../ui/StatusChip'
import { useToast } from '../../ui/Toast'

const inputClass = 'min-h-11 w-full rounded-md border border-[var(--border)] bg-[var(--surface)] px-3'
const kindLabel = (k: DocumentKind) => DOCUMENT_KINDS.find((x) => x.value === k)?.label ?? k

function UploadForm({ project, documents }: { project: ProjectSummary; documents: DocumentRow[] }) {
  const { profile } = useAuth()
  const toast = useToast()
  const queryClient = useQueryClient()
  const [file, setFile] = useState<File | null>(null)
  const [fileError, setFileError] = useState<string | null>(null)
  const [fileKey, setFileKey] = useState(0)
  const [kind, setKind] = useState<DocumentKind>('contract')
  const [title, setTitle] = useState('')
  const [version, setVersion] = useState('1')
  const [signedAt, setSignedAt] = useState('')
  const [replaces, setReplaces] = useState('')

  const replaceable = documents.filter((d) => d.status === 'signed')
  const versionNumber = Number(version)
  const versionBad = !Number.isInteger(versionNumber) || versionNumber < 1
  const ready = !!file && !fileError && !!title.trim() && !versionBad

  const upload = useMutation({
    mutationFn: () =>
      uploadDocument({
        projectId: project.id,
        uploadedBy: profile!.id,
        file: file!,
        kind,
        title,
        version: versionNumber,
        signedAt: signedAt || undefined,
        supersedes: replaces || undefined,
      }),
    onSuccess: () => {
      toast.success('Document uploaded')
      setFile(null)
      setFileKey((k) => k + 1)
      setTitle('')
      setVersion('1')
      setSignedAt('')
      setReplaces('')
    },
    onError: (err) => toast.error(toUserMessage(err)),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: qk.documents(project.id) })
      void queryClient.invalidateQueries({ queryKey: qk.activity(project.id) })
    },
  })

  function pickFile(picked: File | undefined) {
    const problem = picked ? validateUpload(picked) : null
    setFileError(problem)
    setFile(picked && !problem ? picked : null)
  }

  function pickReplaces(id: string) {
    setReplaces(id)
    const old = replaceable.find((d) => d.id === id)
    if (old) {
      setVersion(String(old.version + 1))
      setKind(old.kind)
    }
  }

  function submit(e: FormEvent) {
    e.preventDefault()
    if (ready && profile) upload.mutate()
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4 rounded-md border border-[var(--border)] bg-[var(--surface)] p-4" noValidate>
      <h3 className="font-medium">Upload a signed document</h3>
      <Field label="Signed document file" error={fileError}>
        <input key={fileKey} type="file" accept={ACCEPT_ATTR} onChange={(e) => pickFile(e.target.files?.[0])} className={`${inputClass} py-2`} />
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Title">
          <input value={title} onChange={(e) => setTitle(e.target.value)} className={inputClass} />
        </Field>
        <Field label="Kind">
          <select value={kind} onChange={(e) => setKind(e.target.value as DocumentKind)} className={inputClass}>
            {DOCUMENT_KINDS.map((k) => (
              <option key={k.value} value={k.value}>
                {k.label}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Version" error={versionBad ? 'Use a whole number, 1 or more' : null}>
          <input type="number" min="1" step="1" value={version} onChange={(e) => setVersion(e.target.value)} className={inputClass} />
        </Field>
        <Field label="Signed on">
          <input type="date" value={signedAt} onChange={(e) => setSignedAt(e.target.value)} className={inputClass} />
        </Field>
      </div>
      {replaceable.length > 0 && (
        <Field label="Replaces (optional)">
          <select value={replaces} onChange={(e) => pickReplaces(e.target.value)} className={inputClass}>
            <option value="">Nothing — this is a new document</option>
            {replaceable.map((d) => (
              <option key={d.id} value={d.id}>
                {d.title} (v{d.version})
              </option>
            ))}
          </select>
        </Field>
      )}
      <div>
        <Button type="submit" loading={upload.isPending} disabled={!ready}>
          Upload document
        </Button>
      </div>
    </form>
  )
}

function DocumentItem({ doc }: { doc: DocumentRow }) {
  const toast = useToast()
  const download = useMutation({
    mutationFn: async () => openUrl(await signedUrl('documents', doc.storage_path, fileNameFromPath(doc.storage_path))),
    onError: (err) => toast.error(toUserMessage(err)),
  })
  return (
    <li className="flex flex-col gap-2 rounded-md border border-[var(--border)] bg-[var(--surface)] p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-medium">{doc.title}</h3>
        <StatusChip status={doc.status === 'signed' ? 'done' : 'upcoming'} label={doc.status === 'signed' ? 'Signed' : 'Superseded'} />
      </div>
      <p className="text-sm text-[var(--muted)]">
        {kindLabel(doc.kind)} · v{doc.version}
        {doc.signed_at ? ` · Signed ${formatDate(doc.signed_at)}` : ''}
      </p>
      {doc.sha256 && (
        <p className="text-sm text-[var(--muted)]">
          SHA-256{' '}
          <code title={doc.sha256} className="font-mono">
            {doc.sha256.slice(0, 12)}…
          </code>
        </p>
      )}
      <div>
        <Button variant="secondary" aria-label={`Download ${doc.title}`} loading={download.isPending} onClick={() => download.mutate()}>
          Download
        </Button>
      </div>
    </li>
  )
}

export default function FilesTab({ project }: { project: ProjectSummary }) {
  const { profile } = useAuth()
  const query = useQuery({ queryKey: qk.documents(project.id), queryFn: () => listDocuments(project.id) })
  return (
    <div className="flex flex-col gap-4">
      <h2 className="text-lg font-semibold">Files</h2>
      {profile?.role === 'admin' && <UploadForm project={project} documents={query.data ?? []} />}
      <AsyncView query={query} onRetry={() => void query.refetch()} empty={<p className="text-[var(--muted)]">No documents yet.</p>}>
        {(documents) => (
          <ul className="flex flex-col gap-3">
            {documents.map((d) => (
              <DocumentItem key={d.id} doc={d} />
            ))}
          </ul>
        )}
      </AsyncView>
    </div>
  )
}
