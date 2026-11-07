import { useRef, useState, type ChangeEvent } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { applyPlan, planImportSummary, previewPlan, type PlanImportResult } from '../../../api/planImport'
import { invalidateProject } from '../../../api/invalidate'
import { qk } from '../../../api/keys'
import type { ProjectStatus } from '../../../api/projects'
import { toUserMessage } from '../../../lib/errors'
import { parsePlanFile } from '../../../lib/parsePlanFile'
import { Button } from '../../../ui/Button'
import { Dialog } from '../../../ui/Dialog'
import { Field } from '../../../ui/Field'
import { useToast } from '../../../ui/Toast'
import { PlanPreview } from './PlanPreview'
import { ReasonField } from './ReasonField'

type Props = {
  projectId: string
  projectStatus: ProjectStatus
  currency: string
  /** No milestones and no payment requests yet: the preview is a tree, not a diff. */
  emptyProject: boolean
  onClose: () => void
}

/** Mount it while it is open; closing unmounts it, so every open starts from a clean file picker. */
export function ImportPlanDialog({ projectId, projectStatus, currency, emptyProject, onClose }: Props) {
  const toast = useToast()
  const queryClient = useQueryClient()
  const active = projectStatus === 'active'
  const [fileName, setFileName] = useState('')
  const [plan, setPlan] = useState<unknown>(null)
  const [parseError, setParseError] = useState<string | null>(null)
  const [result, setResult] = useState<PlanImportResult | null>(null)
  const [previewError, setPreviewError] = useState<string | null>(null)
  const [applyError, setApplyError] = useState<string | null>(null)
  const [reason, setReason] = useState('')
  // Each pick or re-check gets a number; only the newest one's answer is shown, so a slow preview of an older
  // file can never sit next to a newer plan (and the plan applied is always the one whose diff is on screen).
  const latest = useRef(0)

  const preview = useMutation({
    mutationFn: (v: { plan: unknown; n: number }) => previewPlan(projectId, v.plan),
    onSuccess: (res, v) => {
      if (v.n !== latest.current) return
      setPlan(v.plan)
      setResult(res)
    },
    onError: (err, v) => {
      if (v.n === latest.current) setPreviewError(toUserMessage(err))
    },
  })

  const apply = useMutation({
    mutationFn: () => applyPlan(projectId, plan, result?.fingerprint, active ? reason.trim() || undefined : undefined),
    onSuccess: (res) => {
      toast.success(planImportSummary(res).message)
      onClose()
      return Promise.all([
        invalidateProject(queryClient, projectId),
        queryClient.invalidateQueries({ queryKey: qk.payments(projectId) }),
        queryClient.invalidateQueries({ queryKey: qk.planChanges(projectId) }),
      ])
    },
    onError: (err) => setApplyError(toUserMessage(err)),
  })

  function check(p: unknown) {
    const n = ++latest.current
    setResult(null)
    setPreviewError(null)
    setApplyError(null)
    preview.mutate({ plan: p, n })
  }

  async function onFile(e: ChangeEvent<HTMLInputElement>) {
    const input = e.target
    const n = ++latest.current
    const file = input.files?.[0]
    input.value = '' // so choosing the same path again, after fixing the file, still fires a change
    if (!file) return
    setFileName(file.name)
    setParseError(null)
    setResult(null)
    setPreviewError(null)
    setApplyError(null)
    setPlan(null)
    const parsed = await parsePlanFile(file)
    if (n !== latest.current) return // a newer file was chosen while this one was read
    if (!parsed.ok) {
      setParseError(parsed.message)
      return
    }
    preview.mutate({ plan: parsed.plan, n })
  }

  const summary = result?.valid ? planImportSummary(result) : null

  return (
    <Dialog open onClose={onClose} title="Import plan" wide>
      <div className="flex flex-col gap-4">
        <Field label="Choose plan.json">
          <input
            type="file"
            accept=".json,application/json"
            onChange={(e) => void onFile(e)}
            className="min-h-11 w-full rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm"
          />
        </Field>
        {fileName && <p className="break-all text-sm text-[var(--muted)]">{fileName}</p>}

        {parseError && (
          <p role="alert" className="text-sm text-[var(--danger)]">
            {parseError}
          </p>
        )}
        {previewError && (
          <p role="alert" className="text-sm text-[var(--danger)]">
            {previewError}
          </p>
        )}
        {preview.isPending && <p role="status">Checking the plan…</p>}

        {result && !result.valid && (
          <section className="flex flex-col gap-2">
            <p className="font-medium">Fix these in plan.json and choose it again</p>
            <ul className="flex flex-col gap-2">
              {result.errors.map((err, i) => (
                <li key={i} className="min-w-0 break-words rounded-md border border-[var(--border)] bg-[var(--surface)] p-3 text-sm">
                  <code className="font-mono">{err.path}</code> <span>{err.message}</span>
                </li>
              ))}
            </ul>
          </section>
        )}

        {result?.valid && (
          <>
            <div className="max-h-[50dvh] overflow-y-auto pr-1">
              <PlanPreview result={result} currency={currency} tree={emptyProject} />
            </div>
            {active && !summary?.isNoop && <ReasonField value={reason} onChange={setReason} />}
          </>
        )}

        {applyError && (
          <div role="alert" className="flex flex-col gap-2 text-sm text-[var(--danger)]">
            <p>{applyError}</p>
            <div>
              <Button variant="secondary" onClick={() => check(plan)} loading={preview.isPending}>
                Check again
              </Button>
            </div>
          </div>
        )}

        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          {result?.valid && (
            <Button
              loading={apply.isPending}
              disabled={summary?.isNoop || preview.isPending || applyError !== null /* stale until Check again */}
              onClick={() => {
                if (!apply.isPending) apply.mutate()
              }}
            >
              Apply changes
            </Button>
          )}
        </div>
      </div>
    </Dialog>
  )
}
