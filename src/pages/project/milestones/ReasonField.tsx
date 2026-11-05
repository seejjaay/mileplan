import { Field } from '../../../ui/Field'

/** Optional note stored with a plan change; the client sees it in the plan-change banner and the Timeline. */
export function ReasonField({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <Field label="Reason for change (optional)">
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="e.g. client asked to add a login screen"
        className="min-h-11 rounded-md border border-[var(--border)] bg-[var(--surface)] px-3"
      />
    </Field>
  )
}
