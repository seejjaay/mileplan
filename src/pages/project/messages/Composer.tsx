import { useRef, useState, type FormEvent, type KeyboardEvent } from 'react'
import { useMutation } from '@tanstack/react-query'
import { sendMessage, type MessageRow } from '../../../api/messages'
import { toUserMessage } from '../../../lib/errors'
import { formatBytes } from '../../../lib/format'
import { ACCEPT_ATTR, validateUpload } from '../../../lib/validateUpload'
import { Button } from '../../../ui/Button'
import { useToast } from '../../../ui/Toast'

const MAX_FILES = 5

function hasFinePointer(): boolean {
  return typeof window.matchMedia === 'function' && window.matchMedia('(pointer: fine)').matches
}

type Props = { projectId: string; senderId: string; onSent: (m: MessageRow) => void }

export function Composer({ projectId, senderId, onSent }: Props) {
  const toast = useToast()
  const [body, setBody] = useState('')
  const [files, setFiles] = useState<File[]>([])
  const [fileProblem, setFileProblem] = useState<string | null>(null)
  const [fileInputKey, setFileInputKey] = useState(0)
  const box = useRef<HTMLTextAreaElement>(null)

  const send = useMutation({
    mutationFn: () => sendMessage({ projectId, senderId, body: body.trim(), files }),
    onSuccess: (m) => {
      setBody('')
      setFiles([])
      setFileProblem(null)
      setFileInputKey((k) => k + 1)
      onSent(m)
      box.current?.focus()
    },
    onError: (err) => toast.error(toUserMessage(err)),
  })

  const canSend = body.trim() !== '' && !send.isPending

  function pick(picked: File[]) {
    let problem: string | null = null
    const next = [...files]
    for (const f of picked) {
      const bad = validateUpload(f)
      if (bad) problem = bad
      else if (next.length >= MAX_FILES) problem = `You can attach up to ${MAX_FILES} attachments per message`
      else next.push(f)
    }
    setFiles(next)
    setFileProblem(problem)
    setFileInputKey((k) => k + 1) // lets the same file be picked again after removing it
  }

  function submit(e?: FormEvent) {
    e?.preventDefault()
    if (canSend) send.mutate()
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing && hasFinePointer()) {
      e.preventDefault()
      submit()
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-2 border-t border-[var(--border)] pt-3">
      {files.length > 0 && (
        <ul className="flex flex-wrap gap-2">
          {files.map((f, i) => (
            <li
              key={`${f.name}-${i}`}
              className="flex max-w-full items-center gap-2 rounded-md border border-[var(--border)] bg-[var(--surface)] px-2 py-1 text-sm"
            >
              <span className="min-w-0 [overflow-wrap:anywhere]">
                {f.name} <span className="text-[var(--muted)]">({formatBytes(f.size)})</span>
              </span>
              <button
                type="button"
                aria-label={`Remove ${f.name}`}
                disabled={send.isPending}
                onClick={() => setFiles((all) => all.filter((_, j) => j !== i))}
                className="min-h-11 min-w-11 shrink-0 text-[var(--muted)] disabled:opacity-50"
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}
      {fileProblem && (
        <p role="alert" className="text-sm text-[var(--danger)]">
          {fileProblem}
        </p>
      )}
      <div className="flex items-end gap-2">
        <label className="inline-flex min-h-11 cursor-pointer items-center justify-center rounded-md border border-[var(--border)] bg-[var(--surface)] px-4 text-sm font-medium focus-within:outline focus-within:outline-2 focus-within:outline-[var(--accent)]">
          <input
            key={fileInputKey}
            type="file"
            multiple
            accept={ACCEPT_ATTR}
            disabled={send.isPending}
            onChange={(e) => pick(Array.from(e.target.files ?? []))}
            className="sr-only"
          />
          Attach
        </label>
        <textarea
          ref={box}
          aria-label="Message"
          value={body}
          rows={2}
          maxLength={4000}
          onChange={(e) => setBody(e.target.value)}
          onKeyDown={onKeyDown}
          className="max-h-40 min-h-11 min-w-0 flex-1 resize-none rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-2"
        />
        <Button type="submit" loading={send.isPending} disabled={!canSend && !send.isPending}>
          Send
        </Button>
      </div>
    </form>
  )
}
