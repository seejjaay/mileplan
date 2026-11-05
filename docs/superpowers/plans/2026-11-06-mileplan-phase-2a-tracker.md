# MilePlan Phase 2a — Admin Tracker Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (CJ chose Native/inline execution) to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
> On approval, copy this file to `docs/superpowers/plans/2026-11-06-mileplan-phase-2a-tracker.md` and execute from there on a new branch `phase-2a-tracker`.

## Context
Phase 1 (merged to `main` at `622c5fb`) left MilePlan as a skeleton: schema + RLS, invite-only onboarding, app shell, Clients page. There is no way yet to create a project, build its milestone plan, or see what changed. Phase 2 is the tracker; CJ split it in two. **2a (this plan)** = everything CJ needs to run a project from the admin side, plus read-only rendering for clients. **2b (next plan)** = the client experience: realtime, plan-change banner + Acknowledge, Approve / Request changes, "updated since your last visit" markers, and the route-line signature visuals.

**Goal:** CJ can create a project, build and edit its milestones/tasks (inline edit, drag reorder, split, merge, hold), post updates, upload signed documents, add a client and activate, and every change lands in an audited Timeline with `plan_change` flagged correctly.

**Architecture:**
- Every write to tracked tables is logged by `AFTER` triggers into `activity` (security definer — `activity` stays unwritable by `authenticated`). The edit reason travels via `set_config('mileplan.reason', …, true)` set inside admin RPCs.
- Multi-row or rule-bearing admin edits are `security invoker` RPCs that check `is_admin()` and run in one transaction; simple single-row task edits stay direct table writes under the existing admin RLS policies.
- Project page is one lazy route `/projects/:id` with lazy tab panels; dnd-kit loads only inside the Milestones tab chunk.

**Tech Stack:** Phase 1 stack, plus `@dnd-kit/core` + `@dnd-kit/sortable` (drag + keyboard sensor) and `react-markdown` (no `rehype-raw`, so raw HTML is never rendered).

**Spec:** `docs/superpowers/specs/2026-11-05-mileplan-design.md` — this plan covers §4 admin project screens (except Payments, Messages, Import), §5 DB rules for `activity`/`plan_change`/approval transition, §8 RPC editing + split/merge, §12–§14 as they apply. Deferred: payments (and the dashboard's unpaid amount, Overview paid/outstanding) → Phase 3, messages UI (and unread counts) → 4, `import_plan` → 5, client actions/realtime/banner/visuals → 2b.

## Global Constraints
- Everything in Phase 1's Global Constraints still applies (schema conventions, `numeric(12,2)`, helper-function style, anon key only in `src/`, UI rules, exact copy, lint gate).
- **Reason:** every admin RPC takes `p_reason text default null` and always calls `set_config('mileplan.reason', coalesce(p_reason, ''), true)` first — never leaves a previous value in place. Triggers read `nullif(current_setting('mileplan.reason', true), '')`.
- **plan_change = true** only when the project is `active` **and** (a milestone is inserted or deleted, **or** a milestone's `amount`, `due_date`, `title`, `description` or `acceptance_criteria` changes).
- **Approval:** `milestones.status` may become `approved` only from `in_review`; setting it stamps `approved_at = now()`, `approved_by = auth.uid()`.
- **Activity noise rule:** updates that change only `position` (reorders) or only `last_seen_at` are **not** logged.
- **Storage paths:** `{project_id}/{uuid}-{filename}`. Uploads ≤ 10 MB, `image/png|jpeg|webp|gif`, `application/pdf`, `application/zip`, checked by MIME **and** extension in the browser before upload (server bucket limits from Phase 1 are the backstop). Downloads via signed URLs with `expiresIn: 60`.
- **Percent complete:** `round(100 * count(status in ('approved','paid')) / count(*))`, 0 when there are no milestones.
- **Copy (exact):** project empty milestones: "No milestones yet. Add the first one."; Timeline empty: "Nothing has happened yet."; Updates empty: "No updates yet."; Files empty: "No documents yet."
- **Bundle:** entry chunk stays ≤ 200 KB gzip; dnd-kit and react-markdown must not appear in the entry chunk.

## Review Focus
1. **Reason bleeding into a later edit** (two RPCs in one session, the second without a reason): the second activity row has `reason = null`. Covered in Task 1 (`reason does not leak to next edit`).
2. **Split asking for more money than the milestone has** (or a task from another milestone): rejected, nothing changes. Covered in Task 2.
3. **Merge of non-adjacent milestones or milestones from two projects:** rejected with 22023, nothing changes. Covered in Task 2.
4. **Reorder with a stale id list** (a milestone added in another tab, so the list is missing one): rejected, positions unchanged, UI refetches. Covered in Task 2 (pgTAP) and Task 6 (component test).
5. **A renamed file** (`invoice.html` renamed `invoice.pdf`, or an 11 MB PDF): blocked in the browser with a clear message, no upload attempted. Covered in Task 8 (`validateUpload` tests).

---

### Task 1: Activity triggers and the plan_change flag

**Files:** Create `supabase/migrations/20261106000100_activity_triggers.sql`, `supabase/tests/database/activity.test.sql`

**Interfaces:**
- Consumes: Phase 1 tables/enums, `tests.*` helpers in `supabase/seed.sql`.
- Produces: trigger function `public.log_activity()` attached `AFTER INSERT OR UPDATE OR DELETE` on `projects, milestones, tasks, documents, updates, milestone_reviews, payments`; trigger `milestones_guard_status` (`BEFORE UPDATE OF status`) enforcing the approval rule.
  - `entity` from table name (`projects→project`, `milestone_reviews→review`, …); `project_id` from the row (`projects.id`; `milestone_reviews` via its milestone); `actor_id = auth.uid()`.
  - `action`: `created` / `deleted` / `status_changed` (when `status` differs) / `updated`.
  - `changes jsonb`: `{field: [old, new]}` for every changed column except `id, created_at`; `null` for insert/delete.

- [ ] **Step 1: Failing pgTAP tests** (`activity.test.sql`), fixtures P1 `active`, P3 `setup`, run as admin via `tests.authenticate_as`:
  - `milestone due_date change logs diff and reason`: after `set_config('mileplan.reason','client asked',true)` + update, newest activity row has `changes->'due_date'` = `[old,new]`, `reason='client asked'`, `plan_change=true`, `actor_id=admin`.
  - `setup project change is not a plan change`: same edit on P3 → `plan_change=false`.
  - `milestone insert and delete are plan changes` (P1).
  - `task status change logs status_changed, not plan_change`.
  - `position-only update is not logged`: count of activity rows unchanged.
  - `reason does not leak to next edit`: second update after `set_config('mileplan.reason','',true)` → `reason is null`.
  - `approve only from in_review`: `planned → approved` raises `P0001`; `in_review → approved` succeeds and sets `approved_by=admin`.
  - `client still cannot insert activity` (regression, 42501).
- [ ] **Step 2:** `npx supabase test db` → FAIL (no triggers).
- [ ] **Step 3:** Write the migration (security definer, `set search_path = ''`, fully qualified).
- [ ] **Step 4:** `npx supabase db reset && npx supabase test db` → all PASS (Phase 1 tests included).
- [ ] **Step 5:** Commit `feat(db): activity triggers, plan_change flag, approval transition guard`

---

### Task 2: Admin tracker RPCs

**Files:** Create `supabase/migrations/20261106000200_tracker_rpcs.sql`, `supabase/tests/database/tracker_rpcs.test.sql`

**Interfaces** (all `security invoker`, `set search_path = ''`, raise `42501` unless `public.is_admin()`, set reason first, `grant execute … to authenticated`):
- `public.activate_project(p_project_id uuid) returns void` — `setup → active`, sets `activated_at`; already `active` is a no-op (double-click safe); `completed/terminated` raises 22023.
- `public.add_milestone(p_project_id uuid, p_fields jsonb, p_reason text default null) returns uuid` — appends at `max(position)+1`.
- `public.update_milestone(p_id uuid, p_patch jsonb, p_reason text default null) returns void` — allowlist `title, description, acceptance_criteria, due_date, amount, on_hold, status`; any other key raises 22023.
- `public.delete_milestone(p_id uuid, p_reason text default null) returns void` — closes the position gap.
- `public.reorder_milestones(p_project_id uuid, p_ids uuid[]) returns void` — `p_ids` must equal the project's milestone id set exactly, else 22023 (stale list); positions = array index.
- `public.reorder_tasks(p_milestone_id uuid, p_ids uuid[]) returns void` — same rule for tasks.
- `public.split_milestone(p_id uuid, p_task_ids uuid[], p_title text, p_amount numeric, p_reason text default null) returns uuid` — new milestone at `position+1` (later ones shift), chosen tasks move, `0 ≤ p_amount ≤ original.amount` and original keeps the remainder; task not in the milestone → 22023.
- `public.merge_milestones(p_first uuid, p_second uuid, p_reason text default null) returns void` — same project and `second.position = first.position + 1`, else 22023; second's tasks appended, amounts summed, `acceptance_criteria` concatenated, second deleted.

- [ ] **Step 1: Failing pgTAP tests** — one or more per function, named `<fn>: <behaviour>`, including: `split: amount over original rejected, nothing changed`; `split: foreign task rejected`; `merge: non-adjacent rejected`; `merge: cross-project rejected`; `merge: amounts summed and tasks moved`; `reorder: stale id list rejected, positions unchanged`; `activate: twice is a no-op`; `update_milestone: unknown key rejected`; `client calling any RPC gets 42501`; `split and merge both produce plan_change activity on an active project`.
- [ ] **Step 2:** `npx supabase test db` → FAIL.
- [ ] **Step 3:** Write the migration.
- [ ] **Step 4:** `npx supabase db reset && npx supabase test db` → PASS.
- [ ] **Step 5:** Commit `feat(db): admin tracker RPCs (milestones, reorder, split, merge, activate)`

---

### Task 3: Project data layer, New project page, project route + tabs, dashboard cards

**Files:**
- Create: `src/api/projects.ts`, `src/api/keys.ts`, `src/pages/admin/NewProjectPage.tsx`, `src/pages/project/ProjectPage.tsx`, `src/pages/project/tabs.ts`
- Modify: `src/routes.tsx`, `src/pages/admin/DashboardPage.tsx`, `src/pages/client/MyProjectsPage.tsx`
- Test: `src/api/projects.test.ts`, `src/pages/admin/NewProjectPage.test.tsx`, `src/pages/project/ProjectPage.test.tsx`

**Interfaces:**
- Consumes: Phase 1 `supabase`, `AsyncView`, `StatusChip`, `useTitle`, `useToast`, `toUserMessage`, `RequireAdmin`.
- Produces:
  - `src/api/keys.ts`: `qk.projects()`, `qk.project(id)`, `qk.milestones(projectId)`, `qk.updates(projectId)`, `qk.documents(projectId)`, `qk.activity(projectId)` — the only place query keys are built (2b's realtime invalidates through these).
  - `src/api/projects.ts`: `type Project`, `type ProjectSummary = Project & { percent: number; nextDue: { title: string; due_date: string } | null }`; `listProjects(): Promise<ProjectSummary[]>`; `getProject(id): Promise<Project>`; `createProject(input: { title; summary?; currency?; start_date?; end_date? }): Promise<string>` (direct insert, status `setup`); `activateProject(id): Promise<void>` (rpc); pure `percentComplete(statuses: string[]): number`.
  - Routes: `/projects/new` (admin only) and `/projects/:id/:tab?` with tabs `overview | milestones | updates | files | timeline` (default `overview`; unknown tab → overview). Payments/Messages tabs are not rendered until Phases 3/4.
  - `ProjectPage`: header (title, status chip, % complete), tab bar as `role="tablist"` links (horizontally scrollable at 375px), lazy tab panel.
  - Dashboard cards: status chip, % complete, next due milestone; status filter (`All | Setup | Active | Completed | Terminated`) kept in `?status=`. "New project" button. Client My projects: cards link to the project; exactly one project → `<Navigate replace>` to it.

- [ ] **Step 1: Failing tests:** `percentComplete: 0 with no milestones`, `percentComplete: counts approved and paid` (`['approved','paid','planned','in_review'] → 50`); `NewProjectPage: Create disabled until title filled, currency defaults to PHP, navigates to /projects/<id> and toasts`; `ProjectPage: unknown tab falls back to overview`; `ProjectPage: renders "You don't have access to this" when getProject fails with 42501`; `MyProjectsPage: single project redirects to it`.
- [ ] **Step 2:** `npm test` → FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** `npm test && npm run lint && npm run typecheck && npm run build` → PASS, entry ≤ 200 KB gzip.
- [ ] **Step 5:** Commit `feat(projects): new project page, project route with tabs, dashboard cards`

---

### Task 4: Overview tab and "Add client & activate"

**Files:** Create `src/pages/project/OverviewTab.tsx`, `src/pages/project/ActivateDialog.tsx`; Modify `src/pages/admin/CreateClientDialog.tsx`; Test `src/pages/project/ActivateDialog.test.tsx`, `src/pages/project/OverviewTab.test.tsx`

**Interfaces:**
- Consumes: `activateProject`, `qk.*` (Task 3); `createClient(input)` with `project_id` (Phase 1 `src/api/clients.ts`); `SetupLink` (`src/pages/admin/SetupLink.tsx`).
- Produces: `CreateClientDialog` gains optional prop `projectId?: string` (passed through as `project_id`). `ActivateDialog({ projectId, open, onClose })`: runs `createClient({…, project_id})` then `activateProject(projectId)`; shows the setup link (or "Already a client" note); toasts "Project activated". If create succeeds but activate fails, the dialog shows the error with a "Try activating again" button that only re-runs `activateProject`.
- Overview: progress bar (`role="progressbar"` with `aria-valuenow`), plain milestone strip (ordered list with status word per milestone — the route-line visuals come in 2b), contract value total (sum of milestone amounts, formatted with the project currency via `Intl.NumberFormat`), "Add client & activate" button only while `setup`.

- [ ] **Step 1: Failing tests:** `ActivateDialog: links client to project then activates`; `ActivateDialog: activate failure keeps link and offers retry without re-creating the client`; `OverviewTab: contract value sums amounts in PHP`; `OverviewTab: Add client & activate hidden once active`.
- [ ] **Step 2:** `npm test` → FAIL. **Step 3:** Implement. **Step 4:** `npm test` → PASS.
- [ ] **Step 5:** Commit `feat(projects): overview tab and add-client-and-activate`

---

### Task 5: Milestones tab — inline edit, add, delete, hold, status, reason

**Files:** Create `src/api/milestones.ts`, `src/pages/project/milestones/MilestonesTab.tsx`, `src/pages/project/milestones/MilestoneRow.tsx`, `src/pages/project/milestones/ReasonField.tsx`; Test `src/pages/project/milestones/MilestonesTab.test.tsx`

**Interfaces:**
- Consumes: Task 2 RPCs, `qk.milestones`.
- Produces (`src/api/milestones.ts`): `type Milestone` (incl. `tasks: Task[]` ordered by position), `listMilestones(projectId)`, `addMilestone(projectId, fields, reason?)`, `updateMilestone(id, patch, reason?)`, `deleteMilestone(id, reason?)`; tasks via direct table writes: `addTask(milestoneId, title)`, `updateTask(id, patch: { title?; status? })`, `deleteTask(id)`.
- UI: each milestone row edits title, description, acceptance criteria (one per line), due date, amount, status, on hold. A row's Save is disabled until that row is dirty. While the project is `active`, a plan-change edit (any of the five plan fields, or add/delete) shows the optional "Reason for change" field; Save sends it. Delete uses a confirm `Dialog`. Every write toasts. Client role renders the same list read-only (no inputs).

- [ ] **Step 1: Failing tests:** `Save disabled until row dirty`; `reason field shown for plan field edit on active project, not on setup`; `save sends patch and reason to updateMilestone`; `delete asks for confirmation`; `client sees read-only list`; `shows exact empty copy`.
- [ ] **Step 2:** FAIL. **Step 3:** Implement. **Step 4:** PASS.
- [ ] **Step 5:** Commit `feat(milestones): inline edit, add, delete, hold, status with reason`

---

### Task 6: Milestones tab — drag reorder, tasks, split, merge

**Files:** Create `src/pages/project/milestones/SortableList.tsx`, `src/pages/project/milestones/SplitDialog.tsx`, `src/pages/project/milestones/TaskList.tsx`; Modify `MilestonesTab.tsx`, `src/api/milestones.ts`; Test `SortableList.test.tsx`, `SplitDialog.test.tsx`

**Interfaces:**
- Consumes: Task 5 components, Task 2 RPCs.
- Produces: `src/api/milestones.ts` adds `reorderMilestones(projectId, ids)`, `reorderTasks(milestoneId, ids)`, `splitMilestone(id, taskIds, title, amount, reason?)`, `mergeMilestones(firstId, secondId, reason?)`. `SortableList<T extends { id: string }>({ items, onReorder(ids: string[]), renderItem, label })` wraps dnd-kit with `PointerSensor` + `KeyboardSensor` (`sortableKeyboardCoordinates`) and announcements. Reorder is optimistic; on error it rolls back, toasts the reason and refetches.
- Split dialog: pick tasks (checkboxes), new title, amount (max = current amount, remainder shown live), optional reason. "Merge with next" on every milestone except the last, behind a confirm `Dialog`.

- [ ] **Step 1: Failing tests:** `SortableList: keyboard Space, ArrowDown, Space moves item and calls onReorder with new order`; `reorder failure rolls back order and toasts`; `SplitDialog: amount above original disables Split and shows the limit`; `SplitDialog: sends chosen task ids`.
- [ ] **Step 2:** FAIL. **Step 3:** `npm i @dnd-kit/core @dnd-kit/sortable @dnd-kit/utilities`, implement. **Step 4:** PASS; `npm run build` shows dnd-kit outside the entry chunk.
- [ ] **Step 5:** Commit `feat(milestones): drag and keyboard reorder, tasks, split and merge`

---

### Task 7: Updates tab

**Files:** Create `src/api/updates.ts`, `src/api/storage.ts`, `src/pages/project/UpdatesTab.tsx`, `src/ui/Markdown.tsx`; Test `src/ui/Markdown.test.tsx`, `src/pages/project/UpdatesTab.test.tsx`

**Interfaces:**
- Produces: `src/api/storage.ts`: `objectPath(projectId, file: File): string` (`{projectId}/{crypto.randomUUID()}-{sanitized name}`), `uploadTo(bucket, projectId, file): Promise<{ path; name; size; mime }>`, `signedUrl(bucket, path): Promise<string>` (60 s). `src/api/updates.ts`: `listUpdates(projectId)`, `postUpdate({ projectId, body, milestoneId?, files: File[] })` (uploads to `attachments`, then inserts the row; if the insert fails, removes the uploaded objects). `Markdown({ children })`: `react-markdown` with no raw HTML; links get `rel="noopener noreferrer" target="_blank"`.
- UI: admin composer (Markdown textarea, optional milestone select, attachments) with Post disabled until body non-empty; newest-first list with author, date, linked milestone, attachment links opening a fresh signed URL on click. Clients see the list only.

- [ ] **Step 1: Failing tests:** `Markdown: raw <script> and <img onerror> are not rendered as elements`; `Markdown: links open with noopener`; `objectPath: prefixes project id and strips path separators from the name`; `UpdatesTab: Post disabled until body entered`; `UpdatesTab: exact empty copy`.
- [ ] **Step 2:** FAIL. **Step 3:** `npm i react-markdown`, implement. **Step 4:** PASS.
- [ ] **Step 5:** Commit `feat(updates): progress updates with markdown and attachments`

---

### Task 8: Files tab — signed documents with SHA-256 and supersede

**Files:** Create `src/lib/validateUpload.ts`, `src/lib/sha256.ts`, `src/api/documents.ts`, `src/pages/project/FilesTab.tsx`; Modify `src/api/storage.ts` (use `validateUpload`); Test `src/lib/validateUpload.test.ts`, `src/lib/sha256.test.ts`, `src/pages/project/FilesTab.test.tsx`

**Interfaces:**
- Produces: `validateUpload(file: File): string | null` (error copy or null) — enforces 10 MB and that MIME **and** extension both match the allowed list (`.png .jpg .jpeg .webp .gif .pdf .zip`). `sha256Hex(file: Blob): Promise<string>` (Web Crypto). `src/api/documents.ts`: `listDocuments(projectId)` (signed first, superseded after, newest version first), `uploadDocument({ projectId, file, kind, title, version, signedAt, supersedes?: string })` — hashes in the browser, uploads to `documents`, inserts the row with `sha256`, then marks `supersedes` as `superseded`.
- UI: admin upload form (kind select from the `document_kind` enum, title, version defaulting to previous+1 when superseding, signed date). List shows kind, version, signed date, a short SHA-256 (first 12 chars, full value in `title` attribute), a `superseded` chip, and a Download action (signed URL, 60 s). Clients see the list and can download.

- [ ] **Step 1: Failing tests:** `validateUpload: rejects 10 MB + 1 byte`; `validateUpload: rejects invoice.pdf with type text/html`; `validateUpload: rejects invoice.html with type application/pdf`; `validateUpload: accepts a 2 MB PDF`; `sha256Hex: 'abc' digest` (same vector as Phase 1); `FilesTab: superseded documents show the superseded chip`.
- [ ] **Step 2:** FAIL. **Step 3:** Implement. **Step 4:** PASS.
- [ ] **Step 5:** Commit `feat(files): signed documents with browser SHA-256 and supersede`

---

### Task 9: Timeline tab and diff formatting

**Files:** Create `src/lib/formatChange.ts`, `src/api/activity.ts`, `src/pages/project/TimelineTab.tsx`; Test `src/lib/formatChange.test.ts`, `src/pages/project/TimelineTab.test.tsx`

**Interfaces:**
- Produces: `formatChange(entity: string, field: string, from: unknown, to: unknown, currency: string): string` and `describeActivity(row: ActivityRow, ctx: { currency: string; milestoneTitle?: string }): string` — plain-word lines like `M3 due date: Dec 1 → Dec 15` and `Amount: ₱15,000.00 → ₱20,000.00`; reason appended as `. Reason: <reason>` (2b's banner reuses these). `listActivity(projectId, { before?: string }): Promise<ActivityRow[]>` — 50 per page, newest first, cursor on `created_at`.
- UI: newest-first list with actor name, time, sentence per changed field, a `Plan change` chip when `plan_change`, and "Load older" until a page returns < 50.

- [ ] **Step 1: Failing tests:** `formatChange: due date`, `formatChange: amount in PHP`, `formatChange: acceptance criteria lists added and removed lines`, `describeActivity: appends reason`, `TimelineTab: Load older fetches with before cursor`, `TimelineTab: exact empty copy`.
- [ ] **Step 2:** FAIL. **Step 3:** Implement. **Step 4:** PASS.
- [ ] **Step 5:** Commit `feat(timeline): activity log with plain-language diffs`

---

### Task 10: End-to-end tracker test

**Files:** Create `e2e/tracker.spec.ts`; reuse helpers by moving `signInAs`/`expectNoHorizontalScroll` from `e2e/onboarding.spec.ts` into `e2e/helpers.ts`.

- [ ] **Step 1: Write the e2e test** (admin + client contexts, cleans up its own project and client in `beforeAll`/`afterAll` via `adminServiceClient()`):
  1. Admin creates project "Tracker E2E", adds M1 and M2 with amounts, tasks on M1, reorders M2 above M1 with the keyboard.
  2. Admin uploads a signed PDF on Files; the SHA-256 shown matches the file's hash computed in the test.
  3. Admin adds client "Dee Diaz" via "Add client & activate"; project shows Active.
  4. Admin changes M1's due date with reason "client asked for more time"; Timeline shows that sentence with a `Plan change` chip.
  5. Admin splits M1 (one task, half the amount), then merges it back; Timeline shows both.
  6. Admin posts an update with a PNG attachment.
  7. Client redeems the link and opens the project (single project → redirect): sees milestones read-only, the update, the document, the Timeline; no edit controls.
  8. At 375×812: project page and Milestones tab have no horizontal scroll; tab bar scrolls.
- [ ] **Step 2:** `npm run e2e` → FAIL before Tasks 3–9 exist (run once early to confirm it fails), PASS after.
- [ ] **Step 3:** `npm test && npm run lint && npm run typecheck && npm run build && npx supabase test db && npm run test:integration && npm run e2e` → all PASS; `npx supabase db lint` clean.
- [ ] **Step 4:** Commit `test(e2e): admin tracker flow and client read-only view`

---

## Reused from Phase 1 (don't rebuild)
- UI primitives: `src/ui/AsyncView.tsx`, `Dialog.tsx`, `Field.tsx`, `Button.tsx`, `StatusChip.tsx`, `Toast.tsx`; `src/lib/errors.ts` (`toUserMessage`), `useTitle.ts`, `safeNext.ts`.
- Auth: `useAuth()` / `profileKey` (`src/auth/AuthProvider.tsx`), `RequireAuth`/`RequireAdmin` (`src/auth/guards.tsx`).
- Onboarding: `createClient` / `SetupLink` / `CreateClientDialog` (`src/api/clients.ts`, `src/pages/admin/`).
- DB tests: `tests.create_user/get_user/authenticate_as/clear_auth` in `supabase/seed.sql`; RLS helpers `is_admin()`, `can_see()`.
- Integration/e2e: `tests/integration/env.ts` (`signIn`, `adminServiceClient`), `e2e/onboarding.spec.ts` patterns (clear `redeem_attempts` in setup).

## Verification
- Per task: the task's RED → GREEN commands above.
- End of phase: Task 10 Step 3 (all suites green, `supabase db lint` clean, entry ≤ 200 KB gzip with dnd-kit/react-markdown outside it).
- Manual: as the seed admin at `npm run dev` with the local stack + `npx supabase functions serve --env-file supabase/functions/.env`, run the Task 10 story by hand once in dark mode and once keyboard-only.
- Final whole-branch review per executing-plans (self-review unless CJ asks for a reviewer agent), then merge to `main`.
