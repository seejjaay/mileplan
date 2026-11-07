# MilePlan Phase 4 — Plan Import Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans (inline, as in Phase 3). Steps use checkbox (`- [ ]`) syntax.
> On approval: cut branch `phase-4-plan-import` from `main` (`cdb1803`), copy this file to `docs/superpowers/plans/2026-11-06-mileplan-phase-4-plan-import.md`, and execute it from there.

## Context
Phases 1–3 are merged and pushed. Milestones and scheduled payments can only be entered one at a time through the UI. Spec §9 promised `plan.json` import: CJ drafts the plan with Claude, then loads it in one step, and re-imports it when the SOW changes. None of it exists yet. `milestones.plan_key` (unique per project) is the only piece already in place.

**CJ's decisions (2026-11-06), which extend spec §9:**
- **Unkeyed rows are kept.** Milestones or requests with `plan_key is null` (added by hand, or created by Split) are never touched by an import. The preview lists them as "not in the plan, kept as is".
- **Tasks match by title** within a milestone. A matching title keeps its status, a new title is added, and a missing title is removed. Order follows the plan.
- **plan.json may carry an optional `payments` array.** Import creates and diffs payment requests by key, like milestones.
- **Import works on setup and active projects.** A closed project is refused.

**Goal:** CJ picks a `plan.json` and sees either validation errors (with JSON paths) or a preview: a tree for an empty project, a diff for an existing one. On confirm, everything applies in one transaction. On an active project, the client sees the changes as plan changes and acknowledges them from the existing banner. Claude can run the same dry-run-then-apply flow over SQL.

**Architecture:**
- One `security invoker` RPC, `import_plan(p_project_id, p_plan jsonb, p_dry_run bool, p_reason text)`, is the single source of truth. It validates, computes the diff, and applies it when `p_dry_run` is false. A dry run never writes.
- The app does only file reading, JSON parsing and rendering. It never re-implements the rules.
- `schemas/plan.schema.json` exists for Claude and editors. A fixture test keeps it in step with the SQL.

**Tech stack:** existing. One new **dev** dependency, `ajv` (a JSON Schema validator), used only by the schema-agreement test and never imported from `src/`.

## Global Constraints
- Earlier constraints still apply: `numeric(12,2)` money, `set search_path = ''`, RPCs refuse non-admins with `42501` via `begin_admin_edit`, the close lock raises `MP001`, every write toasts, errors go through `toUserMessage`, the entry chunk stays ≤ 200 KB gzip, and there is no horizontal scroll at 375 px.
- **plan.json shape** (`schema_version: 1`); unknown keys are errors at every level:
  - `project` (required): `title` required (1–200 chars). `summary` (≤ 2000), `currency` (3 uppercase letters), `start_date` and `end_date` (ISO dates, start ≤ end) are optional, and **an omitted field is left unchanged**.
  - `milestones` (required, 1–100 items):
    - `key` matches `^[a-z0-9][a-z0-9_-]{0,39}$` and is unique.
    - `title` is 1–200 chars. `description` ≤ 5000.
    - `acceptance_criteria`: ≤ 50 non-empty strings.
    - `due_date` is required and **non-decreasing in plan order**. The error reads `milestones[2].due_date is before milestones[1].due_date`.
    - `amount` is ≥ 0, ≤ 9,999,999,999.99, with at most 2 decimals.
    - `tasks`: ≤ 100 non-empty strings (≤ 200 chars), unique within the milestone.
  - `payments` (optional, ≤ 100): `key` has the same pattern and is unique among payments. `title` is required. `amount` > 0. `due_date` is required. `milestone` is optional and must be a milestone `key` in the same plan.
- **State checks.** These are errors too, so the preview shows them before anything is written:
  1. The project is closed.
  2. A keyed milestone would be removed but has **confirmed** payments.
  3. A keyed request would be removed but has any **pending or confirmed** payment. Manual delete still cascades with its warning; import never does.
  4. A request's amount would drop below its confirmed total.
  5. `currency` would change while the project already has payment requests.
- **What import touches:**
  - Milestones: `title`, `description`, `acceptance_criteria`, `due_date`, `amount`, `position` and tasks. **Never** `status`, `on_hold` or approvals.
  - Requests: `title`, `amount`, `due_date` and `milestone_id`.
  - Plan milestones take plan order (positions 1..n). Kept unkeyed milestones follow in their existing order.
- **Apply order, in one transaction:** lock the project row (`for update`), then project fields, milestones (insert, update, delete), tasks, requests (milestone key resolved to id), and finally renumber. Any error rolls everything back.
- **Activity:** one shared optional reason via `begin_admin_edit(p_reason)`. The existing triggers do the rest: on an active project, milestone and request changes become `plan_change` rows, and the client acks them all with one click. A setup import logs no plan changes.
- **Return value** (the same shape for a dry run and an apply):
  ```json
  { "valid": true, "applied": false,
    "errors": [{ "path": "milestones[2].due_date", "message": "is before milestones[1].due_date" }],
    "project":    { "changes": { "title": ["old", "new"] } },
    "milestones": { "added": [{ "key": "", "title": "", "due_date": "", "amount": 0, "tasks": [] }],
                    "changed": [{ "key": "", "title": "", "changes": { "due_date": ["", ""] }, "tasks": { "added": [], "removed": [] } }],
                    "removed": [{ "key": "", "title": "" }], "kept": [{ "title": "" }], "reordered": false },
    "payments":   { "added": [], "changed": [], "removed": [], "kept": [] } }
  ```
  When `valid` is false, only `errors` is filled. A non-dry-run call that is invalid raises `22023` with the first error. That is the guard for something changing between preview and apply, such as a client sending a proof in the meantime.
- **Copy (exact):**
  - Buttons: "Import plan" (on the Milestones tab, next to "Add milestone"), and "Import plan" / "Apply changes" in the dialog.
  - Empty state: "No milestones yet. Add the first one, or import a plan."
  - Errors heading: "Fix these in plan.json and choose it again".
  - Kept heading: "Not in the plan, kept as is".
  - No-op re-import: "Nothing to change"; the confirm button is disabled.
  - Toast: "Plan imported: {n} added, {n} changed, {n} removed".
  - File limits: `.json`, ≤ 256 KB. A parse error reads "plan.json isn't valid JSON (line X, column Y)".

## Review Focus
1. **Preview, then a client sends a proof, then CJ applies a plan that removes that request:** the apply re-validates, refuses with 22023, and nothing is written. The dialog shows the error and offers to re-check. Task 1 (pgTAP) and Task 4.
2. **Re-importing the same file twice** is a no-op: "Nothing to change", with no activity rows. Task 1.
3. **A client calls `import_plan`** (dry run or apply): `42501`. Task 1.
4. **A task that is Done survives a re-import** that keeps its title, and its milestone's status and approval are untouched. Task 1.
5. **The schema and the SQL disagree:** the agreement test fails. Task 2.

---

### Task 1: `import_plan` RPC and the spec update
**Files:** create `supabase/migrations/20261109000100_plan_import.sql` and `supabase/tests/database/import_plan.test.sql`. Modify spec §4 (Import plan screen), §9 and §14.
- Migration:
  - Add `payment_requests.plan_key text` with `unique (project_id, plan_key)`.
  - Add a small validation helper that collects `{path, message}` errors instead of raising, alongside `assert_keys` in `20261106000200_tracker_rpcs.sql`.
  - Add `import_plan`. Reuse `begin_admin_edit`, `renumber_milestones` / `renumber_tasks` and `project_is_open` (`20261108000200_close_lock.sql`).
  - `revoke all … from public, anon`, and grant to `authenticated`.
- [ ] **Step 1: Failing pgTAP tests** (`import_plan: <behaviour>`, using `tests.authenticate_as`):
  - Validation: each shape rule reports its path. Unknown keys. A duplicate key. Due dates out of order. A payment naming a missing milestone key.
  - Security: client denied for a dry run and an apply (42501). A closed project is reported in the dry run and refused on apply.
  - Setup import: creates milestones, tasks and requests with `plan_key`, positions follow plan order, and no `plan_change` rows are logged.
  - A dry run writes nothing (row counts unchanged).
  - Invalid apply: full rollback, even when the failing rule is the last one checked.
  - Re-import diff:
    - Changed fields are reported.
    - A Done task with the same title keeps its status.
    - Task added and removed.
    - A removed keyed milestone; a kept unkeyed milestone.
    - `reordered` is set.
    - Status, `on_hold` and approval are untouched.
  - State checks 2–5 each block, with a message.
  - Active import: a `plan_change` row per milestone or request change, all carrying the shared reason.
  - An identical re-import gives an empty diff and no activity rows.
- [ ] **Step 2:** `npx supabase test db`. Expected: FAIL.
- [ ] **Step 3:** Write the migration. Rewrite spec §9 with the rules above, §4 with the dialog flow, and §14 with e2e step 1 using import.
- [ ] **Step 4:** `npx supabase db reset && npx supabase test db && npx supabase db lint`. Expected: PASS.
- [ ] **Step 5:** Commit `feat(db): import_plan with validation, diff and one-transaction apply`.

### Task 2: JSON Schema and the agreement test
**Files:** create `schemas/plan.schema.json` (draft 2020-12), `schemas/plan.example.json`, `tests/fixtures/plans/{valid,invalid}/*.json` and `tests/integration/plan_schema.test.ts`.
- [ ] **Step 1: Failing test.** Every fixture gets the same verdict from `ajv` and from `import_plan(dry_run => true)`, called as the admin through supabase-js like the other integration tests. The example plan is valid on both. Invalid fixtures: one per shape rule; state checks are SQL-only and excluded.
- [ ] **Step 2:** FAIL. **Step 3:** Write the schema, example and fixtures, and `npm i -D ajv`. **Step 4:** `npm run test:integration`. Expected: PASS.
- [ ] **Step 5:** Commit `feat(plan): plan.json schema, example and schema/SQL agreement test`.

### Task 3: Data layer and file parsing
**Files:** create `src/api/planImport.ts` (`previewPlan(projectId, plan)` and `applyPlan(projectId, plan, reason?)`, plus the result types) and `src/lib/parsePlanFile.ts` (size check, `JSON.parse`, character position mapped to line and column, must be an object). Add tests beside each.
- [ ] **Step 1: Failing tests:**
  - `parsePlanFile`: oversize, bad JSON gives line and column, a non-object, OK.
  - `planImport`: RPC args, and errors are thrown.
  - `planImportSummary(result)`: the counts for the toast, and the no-op detection.
- [ ] **Step 2:** FAIL. **Step 3:** Implement, following `src/api/milestones.ts` for the RPC wrapper style. **Step 4:** PASS.
- [ ] **Step 5:** Commit `feat(plan): import data layer and plan.json parsing`.

### Task 4: Import dialog and preview
**Files:** create `src/pages/project/milestones/ImportPlanDialog.tsx` and `PlanPreview.tsx`, with tests. Modify `MilestonesTab.tsx`: the header button and empty-state copy, shown only when `canEdit`.
- Flow: pick file → parse → `previewPlan` → errors list, or preview → `ReasonField` (active only, reused) → apply → toast → `invalidateProject` (`src/api/invalidate.ts`) → close.
- An apply error keeps the dialog open, shows `toUserMessage(err)`, and offers "Check again", which re-runs the preview.
- Reuse `Dialog`, `Button`, `Field`, `useToast`, `formatMoney` / `formatChange` (`src/lib/`).
- Tree preview when the project has no milestones and no requests; diff preview otherwise.
- Lives in the already-lazy `MilestonesTab` chunk, so the entry chunk is untouched.
- [ ] **Step 1: Failing tests:**
  - `PlanPreview`: tree vs diff, the kept section, the reordered note, field changes rendered.
  - Dialog:
    - Parse error shown.
    - Server errors listed with their paths.
    - Reason field only on active.
    - Confirm disabled on a no-op.
    - Apply → toast + invalidate.
    - Apply error → message + "Check again".
    - Double-click applies once (button loading).
  - `MilestonesTab`: no Import button for a client or a closed project.
- [ ] **Step 2:** FAIL. **Step 3:** Implement. **Step 4:** `npm test && npm run build`. Expected: PASS, entry ≤ 200 KB gzip.
- [ ] **Step 5:** Commit `feat(plan): import plan dialog with validation and diff preview`.

### Task 5: Claude path, e2e and the full gate
**Files:** create `e2e/import.spec.ts`. Modify `README.md` ("Importing a plan through Claude").
- README snippet (the same impersonation `tests.authenticate_as` uses, so actor and RLS are CJ's):
  `begin; select set_config('request.jwt.claims', json_build_object('sub','<admin id>','role','authenticated')::text, true); set local role authenticated; select public.import_plan('<project>', '<plan>'::jsonb, true); rollback;`
  Claude shows CJ the diff, and re-runs it with `false` and `commit` **only on CJ's OK**.
- [ ] **Step 1: e2e**, seeded via the service client as in `e2e/payments.spec.ts`, reusing `e2e/helpers.ts`:
  1. The admin imports `schemas/plan.example.json` into a setup project, sees the tree, and imports. The milestones, tasks and scheduled payments appear.
  2. The admin activates the project; the client is signed in live.
  3. The admin re-imports a variant (M2 due date moved, a task added, one keyed request removed) with a reason, and sees the diff.
  4. The client sees the plan-change banner live and acknowledges.
  5. A Done task stays Done.
  6. At 375×812: the dialog and preview have no horizontal scroll.
- [ ] **Step 2:** `npx playwright test e2e/import.spec.ts --repeat-each=5`. Expected: 5/5.
- [ ] **Step 3: Full gate:** `npm run lint && npm run typecheck && npm test && npm run build && npx supabase test db && npm run test:integration && npm run e2e && npx supabase db lint`. Expected: all green.
- [ ] **Step 4:** Commit `test(e2e): plan import and re-import with live plan changes`, and `docs: importing a plan through Claude`.

## Reused (don't rebuild)
- `begin_admin_edit`, `assert_keys`, `renumber_milestones`, `renumber_tasks`: `supabase/migrations/20261106000200_tracker_rpcs.sql`.
- `project_is_open`: `supabase/migrations/20261108000200_close_lock.sql`.
- `log_activity` and its plan_change rules: `supabase/migrations/20261108000100_payment_schedule.sql`.
- The plan-change banner and batch ack: `src/pages/project/PlanChangeBanner.tsx` and `src/api/planChanges.ts`.
- `ReasonField`, `useProjectOpen`, `invalidateProject`, `toUserMessage`, `Dialog`, `Field`, `useToast`.

## Verification
- `npx supabase test db`: the `import_plan` suite covers every rule, state check and Review Focus item 1–4.
- `npm run test:integration`: schema/SQL agreement (Review Focus 5).
- `npm test`, plus the e2e repeated 5×, plus the full gate in Task 5.
- Manual: import the example at 375 px, keyboard only (file input → preview → confirm), and in dark mode.
