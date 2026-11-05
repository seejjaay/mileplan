import { toUserMessage } from '../../lib/errors'
import { Button } from '../../ui/Button'
import { Field } from '../../ui/Field'
import { useToast } from '../../ui/Toast'

/** Read-only setup URL with a Copy button. The link is shown once; it is not stored anywhere readable. */
export function SetupLink({ url }: { url: string }) {
  const toast = useToast()
  async function copy() {
    try {
      await navigator.clipboard.writeText(url)
      toast.success('Link copied')
    } catch (err) {
      toast.error(toUserMessage(err))
    }
  }
  return (
    <div className="flex flex-col gap-3">
      <Field label="Setup link">
        <input readOnly value={url} onFocus={(e) => e.currentTarget.select()} className="min-h-11 rounded-md border border-[var(--border)] bg-[var(--bg)] px-3 text-sm" />
      </Field>
      <p className="text-sm text-[var(--muted)]">Valid for 7 days. Send it through any channel; it works once.</p>
      <Button variant="secondary" onClick={copy}>
        Copy link
      </Button>
    </div>
  )
}
