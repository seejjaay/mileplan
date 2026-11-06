# MilePlan Phase 3 — Scheduled Payments and Closing Projects Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (CJ chose Native/inline execution) to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
> On approval, copy this file to `docs/superpowers/plans/2026-11-07-mileplan-phase-3-payments.md` and execute it from there on a new branch, `phase-3-payments`, cut from `main` (`f9b1a8f`).

## Context
Phases 1 and 2 are merged and pushed, and CI is green. MilePlan still has no way to track money, and a finished project can still be edited.

CJ's decisions, which **change spec §4/§5/§6 payments**:
- Payments are agreed with the client outside the app. CJ then **adds scheduled payments to the tracker**: a label, an amount, a due date, and optionally the milestone it belongs to.
- The **client uploads proof** against a scheduled payment. CJ **confirms it, or rejects it with a note**.
- CJ can also **record a payment directly**, with or without proof (cash, or proof sent by chat).
- **A milestone's status is CJ's to set.** Payments never change it. This drops the spec's "confirmed payments ≥ amount mark the milestone paid" trigger.
- **Closing a project** (Completed or Terminated) makes the tracker read-only. Messages stay open for 30 days after close, and **CJ can reopen** the project.

**Goal:** CJ schedules the payment plan, the client sends proof in-app, CJ confirms it, and totals (paid, outstanding, overdue) show on the Overview and dashboard. A closed project is locked in the database, and the UI shows it as read-only.

**Architecture:**
- A new `payment_requests` table holds the schedule, with a title, amount, due date and optional milestone.
- The existing `payments` table becomes the **submissions/receipts** against a request. It gains a `request_id`, and its client RLS (row-level security) from Phase 1 is kept.
- A request's state is **derived**, never stored, from its payments and the date: Paid, Partially paid, Proof sent, Overdue, or Due.
- Admin money actions are `security invoker` RPCs that check `is_admin()`, so RLS still applies.
- The closed-project lock is one `BEFORE` trigger on every child table, plus a storage-policy check. It raises SQLSTATE `MP001`, which the UI turns into one readable sentence.

**Tech Stack:** the existing stack. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-11-05-mileplan-design.md`. This plan covers:
- §4: Payments tab, Overview totals, and the dashboard unpaid amount.
- §5: the close lock and the 30-day message window.
- §6: payments RLS and storage.
- §8: realtime for payments.
- §14: e2e step 5, reworded for scheduled payments.

**Spec change:** Task 1 rewrites the spec's payment lines to the scheduled-payment model above.

## Global Constraints
- All earlier Global Constraints still apply: `numeric(12,2)` money, `security definer` helpers with `set search_path = ''`, the anon key only in `src/`, every write toasts, Save buttons disabled until the form is dirty, and status chips always print their word.
- **Request state** is `requestState(request, payments, today)`. The first matching rule wins:
  1. **Paid** when the sum of confirmed payments ≥ the request amount.
  2. **Proof sent** when a pending payment exists.
  3. **Partially paid** when the sum of confirmed payments > 0.
  4. **Overdue** when `due_date < today`.
  5. Otherwise **Due**.

  The amounts shown are "Paid ₱X of ₱Y" and "Remaining ₱Z".
- **Totals:**

  | Total | Definition |
  |---|---|
  | Contract value | Sum of milestone amounts (unchanged) |
  | Scheduled | Sum of request amounts |
  | Paid | Sum of confirmed payments |
  | Outstanding | `max(Scheduled − Paid, 0)` |
  | Overdue | Count of requests in the Overdue state |

  The dashboard card shows Outstanding, plus "N overdue" when N is above 0.
- **Payment rules:**
  - A client submits only `pending` payments, and only against a request of the same project. `milestone_id` is copied from the request by trigger.
  - Amounts must be > 0.
  - Rejecting needs a non-empty note. Only `pending` payments can be reviewed.
  - Proof files follow the Phase 2a upload rules (10 MB; images, PDF, ZIP) and go in the `payment-proofs` bucket at `{project_id}/{uuid}-{name}`.
- **Plan changes:** on an active project, adding or deleting a request, or changing its amount or due date, is a `plan_change`, so the client acknowledges payment-schedule changes like any other plan change.
- **Lock:**
  - A closed project (`completed` or `terminated`) rejects every insert, update and delete on `milestones`, `tasks`, `updates`, `documents`, `payment_requests`, `payments` and `milestone_reviews`. It raises `MP001`, and nobody is exempt, admin included.
  - `messages` stay writable while the project is open, or until `closed_at + 30 days`.
  - Storage inserts follow the same rule: `payment-proofs` and `documents` need the project open, and `attachments` follow the message window.
  - A cascade delete of the whole project is still allowed.
- **Copy (exact):**
  - Buttons: "Add scheduled payment", "Upload proof", "Confirm payment", "Reject proof", "Record payment", "Close project", "Reopen project".
  - Toasts: "Scheduled payment added", "Proof uploaded", "Payment confirmed", "Proof rejected", "Payment recorded", "Project closed", "Project reopened".
  - Lock error: "This project is closed. Reopen it to make changes."
  - Closed banner: "This project was {completed|terminated} on {date} and is read-only."
  - Empty state: "No payments scheduled yet."

## Review Focus
1. **The client double-clicks Upload proof:** exactly one pending payment is created. The button is disabled while saving, and a second identical submission within 10 s is ignored. Covered in Task 4.
2. **CJ confirms a proof that was already rejected, in another tab:** refused, because only pending payments can be reviewed, and the UI refetches. Covered in Task 1 (pgTAP) and Task 4.
3. **A client writes to a closed project,** for example an old tab uploading proof: the DB refuses with MP001, the UI shows the closed copy, and no orphan file is left behind because the storage policy refuses too. Covered in Task 2 (pgTAP and integration) and Task 6.
4. **A payment larger than the remaining amount:** allowed (overpayment happens), and the request shows Paid. Remaining never goes negative. Covered in Task 3 (`requestState` tests).
5. **A client tries to confirm their own proof** (`update payments set status='confirmed'`): denied. Covered in Task 1.

---

### Task 1: Payment schedule schema, review RPCs, realtime, spec update

**Files:**
- Create: `supabase/migrations/20261108000100_payment_schedule.sql`, `supabase/tests/database/payments_schedule.test.sql`
- Modify: `docs/superpowers/specs/2026-11-05-mileplan-design.md` (the payments lines in §2, §4, §5, §6, §14)

**Interfaces (all produced here):**
- **Table `payment_requests`:**
  - Columns: `id`, `created_at`, `project_id`, `milestone_id null` (on delete set null), `title text not null`, `amount numeric(12,2) check > 0`, `due_date date not null`, `created_by`.
  - RLS: clients select where `can_see(project_id)`; the admin has all access.
- **`payments` changes:**
  - Add `request_id uuid references payment_requests on delete cascade`.
  - Trigger `payments_from_request` (`BEFORE INSERT OR UPDATE OF request_id`, security definer) copies the request's `project_id` and `milestone_id`, and rejects a request from another project (22023).
  - The client insert policy is replaced: `status='pending'`, `submitted_by=self`, `request_id` not null, review fields null, and `can_see(project_id)`.
  - Clients still have no UPDATE.
- **Activity:**
  - Add the enum value `payment_request` to `activity_entity`.
  - `log_activity` maps `payment_requests` to `payment_request`. It flags `plan_change` for request insert/delete, or an `amount`/`due_date` change, on an active project.
  - Its title snapshot already covers `title` and `amount`.
  - Attach it `AFTER INSERT OR UPDATE OR DELETE` on `payment_requests`.
- **RPCs** (security invoker, `begin_admin_edit`, granted to authenticated):
  - `add_payment_request(p_project_id uuid, p_title text, p_amount numeric, p_due_date date, p_milestone_id uuid default null, p_reason text default null) returns uuid`.
  - `update_payment_request(p_id uuid, p_patch jsonb, p_reason text default null)`: the allowlist is `title, amount, due_date, milestone_id`.
  - `delete_payment_request(p_id uuid, p_reason text default null)`.
  - `review_payment(p_id uuid, p_decision text, p_note text default null)`:
    - `p_decision` is `'confirmed'` or `'rejected'`, and the payment must be `pending`, else 22023.
    - A rejection needs a non-empty note, else 22023.
    - It stamps `reviewed_by`, `reviewed_at` and `review_note`.
  - `record_payment(p_request_id uuid, p_amount numeric, p_paid_on date, p_method text default null, p_reference text default null, p_proof_path text default null) returns uuid`: the admin inserts an already-`confirmed` payment.
- **Realtime:** `alter publication supabase_realtime add table public.payment_requests, public.payments`.

- [ ] **Step 1: Failing pgTAP tests** (`payments_schedule.test.sql`), each as `<area>: <behaviour>`:
  - `client: sees requests of own project only`
  - `client: submits pending proof against a request; milestone_id copied`
  - `client: cannot submit against another project's request` (42501 or 22023)
  - `client: cannot submit confirmed`
  - `client: cannot confirm own payment` (update → 0 rows or 42501)
  - `client: cannot call review_payment / record_payment / add_payment_request` (42501)
  - `admin: confirm stamps reviewer`
  - `admin: reject needs a note`
  - `admin: reviewing a non-pending payment fails`
  - `admin: record_payment inserts confirmed`
  - `activity: request insert on active project is a plan change; on setup it is not`
  - `activity: request amount change is a plan change, title change is not`
  - `publication includes payments and payment_requests`
- [ ] **Step 2:** Run `npx supabase test db`. Expected: FAIL.
- [ ] **Step 3:** Write the migration, and update the spec text.
- [ ] **Step 4:** Run `npx supabase db reset && npx supabase test db`. Expected: all PASS.
- [ ] **Step 5:** Commit `feat(db): scheduled payments, proof review RPCs, realtime`

---

### Task 2: Close, reopen and the write lock

**Files:**
- Create: `supabase/migrations/20261108000200_close_lock.sql`, `supabase/tests/database/close_lock.test.sql`, `tests/integration/close_lock.test.ts`

**Interfaces:**
- **Helpers:**
  - `public.project_is_open(p_project_id uuid) returns boolean`: true for status `setup` or `active`.
  - `public.project_accepts_messages(p_project_id uuid) returns boolean`: open, or `closed_at > now() - interval '30 days'`.
  - Both are security definer and stable.
- **Lock trigger** `public.lock_closed_project()`:
  - Runs `BEFORE INSERT OR UPDATE OR DELETE` on the seven tracker tables and on `messages`.
  - It resolves `project_id`; `milestone_reviews` resolve it through their milestone.
  - If the project row is gone (a cascade delete), it lets the row through.
  - Otherwise it raises `using errcode = 'MP001', message = 'project is closed'` when the project isn't open. For `messages`, it uses `project_accepts_messages` instead.
- **RPCs** (admin):
  - `close_project(p_project_id uuid, p_outcome text, p_reason text default null)`: `active → completed|terminated`, and sets `closed_at = now()`. Anything else raises 22023.
  - `reopen_project(p_project_id uuid, p_reason text default null)`: `completed|terminated → active`, and sets `closed_at = null`.
- **Storage:** replace `objects_insert`. Uploads to `payment-proofs` and `documents` additionally need `project_is_open(path_project_id(name))`, and `attachments` need `project_accepts_messages(...)`. The admin bypass is narrowed the same way.

- [ ] **Step 1: Failing pgTAP tests:**
  - `close: completed sets closed_at`
  - `close: only from active`
  - `lock: admin cannot update a milestone of a closed project` (MP001)
  - `lock: client cannot submit proof to a closed project` (MP001 or 42501)
  - `lock: message allowed 10 days after close`
  - `lock: message refused 31 days after close` (MP001)
  - `lock: deleting a closed project cascades fine`
  - `reopen: back to active, lock lifted`
  - `client cannot close or reopen` (42501)
  - `close and reopen are logged as status changes with the reason`
- [ ] **Step 2: Failing integration test:** `client cannot upload a proof file into a closed project's folder`, and the same upload works after reopen.
- [ ] **Step 3:** FAIL. **Step 4:** Write the migration. **Step 5:** Run `npx supabase db reset && npx supabase test db && npm run test:integration`. Expected: PASS.
- [ ] **Step 6:** Commit `feat(db): close/reopen projects with a write lock and 30-day message window`

---

### Task 3: Payment data layer and request state

**Files:**
- Create: `src/api/payments.ts`, `src/lib/paymentState.ts`
- Modify: `src/api/keys.ts`, `src/lib/errors.ts`, `src/realtime/useProjectRealtime.ts`
- Test: `src/lib/paymentState.test.ts`, `src/lib/errors.test.ts`, `src/realtime/useProjectRealtime.test.tsx`

**Interfaces:**
- Produces in `src/api/payments.ts`:
  - `type PaymentRequest = { id; project_id; milestone_id: string | null; title; amount: number; due_date: string; created_at; payments: Payment[] }`.
  - `type Payment = { id; request_id; amount: number; method; reference; paid_on; proof_path; status: 'pending' | 'confirmed' | 'rejected'; submitted_by; reviewed_at; review_note; created_at; submitter_name: string | null }`. `submitter_name` is a computed field added in Task 1's migration, using `display_name`.
  - `listPaymentRequests(projectId)`: ordered by `due_date`, with the payments embedded newest first.
  - `addPaymentRequest`, `updatePaymentRequest`, `deletePaymentRequest`, `reviewPayment`, `recordPayment`: wrappers over the RPCs.
  - `submitProof({ projectId, requestId, userId, amount, paidOn, method?, reference?, file })`: `uploadTo('payment-proofs', …)` from `src/api/storage.ts`, then the insert. On insert failure it removes the file, following the `postUpdate` pattern.
- Produces in `src/lib/paymentState.ts`:
  - `requestState(request, today: string): { state: 'paid' | 'proof_sent' | 'partially_paid' | 'overdue' | 'due'; paid: number; remaining: number }`.
  - `paymentTotals(requests, today): { scheduled; paid; outstanding; overdue: number }`.
  - Money is computed in cents, as `totalAmount` does in `src/api/milestones.ts`.
- `toUserMessage` maps `MP001` to "This project is closed. Reopen it to make changes."
- `qk.payments(projectId)`. The realtime map: `payment_requests` and `payments` invalidate `payments`, `project` and `projects`.

- [ ] **Step 1: Failing tests:**
  - `requestState`:
    - `due`
    - `overdue past due date`
    - `proof sent beats overdue`
    - `partially paid`
    - `paid at exactly the amount`
    - `overpayment is paid and remaining is 0`
    - `rejected proofs do not count`
  - `paymentTotals`: `sums in cents and counts overdue`.
  - `toUserMessage maps MP001`.
  - `a payments event refreshes payments, project and dashboard`.
- [ ] **Step 2:** FAIL. **Step 3:** Implement. **Step 4:** PASS.
- [ ] **Step 5:** Commit `feat(payments): data layer, request state and totals`

---

### Task 4: Payments tab — schedule, client proof, admin review

**Files:**
- Create: `src/pages/project/payments/PaymentsTab.tsx`, `src/pages/project/payments/RequestDialog.tsx`, `src/pages/project/payments/ProofDialog.tsx`, `src/pages/project/payments/ReviewPaymentDialog.tsx`, `src/pages/project/payments/RecordPaymentDialog.tsx`
- Modify: `src/pages/project/tabs.ts` (add `payments` after `files`), `src/pages/project/ProjectPage.tsx` (lazy panel), `src/lib/changedSince.ts` (`payment`/`payment_request` → `payments` tab)
- Test: `src/pages/project/payments/PaymentsTab.test.tsx`, `ProofDialog.test.tsx`, `ReviewPaymentDialog.test.tsx`

**Behaviour:**
- **The list** shows one row per request, ordered by due date. Each row has:
  - the title, the linked milestone's name, and the due date;
  - a state chip (Paid / Proof sent / Partially paid / Overdue / Due), always with its word;
  - "Paid ₱X of ₱Y";
  - its payments underneath: amount, date, status word, the submitter's name, the rejection note, and a "View proof" button (signed URL, 60 s, `openUrl`).
- **Admin actions:**
  - "Add scheduled payment" opens `RequestDialog` (title, amount, due date, milestone select, plus a reason when the project is active). Edit and delete use the same dialog, with a confirm.
  - "Record payment" on a request opens `RecordPaymentDialog` (amount defaults to the remaining amount, paid on, method, reference, optional proof file).
  - "Confirm payment" and "Reject proof" on a pending payment open `ReviewPaymentDialog`. Reject needs a note.
- **Client action:** "Upload proof" on any request that isn't Paid opens `ProofDialog`:
  - Fields: the amount (defaults to remaining), paid on (defaults to today), method, reference, and the file (`validateUpload` at pick time).
  - Submit is disabled while pending.
  - An identical resubmission (same request, amount and file name) within 10 s is ignored.
- A 22023 from the review means it was already reviewed: show "This payment was already reviewed." and refetch.
- **Empty state:** "No payments scheduled yet."

- [ ] **Step 1: Failing tests:**
  - `admin adds a scheduled payment with reason on an active project`
  - `client sees Upload proof on due requests, not on paid ones`
  - `proof dialog defaults amount to remaining and blocks an invalid file`
  - `double submit creates one payment`
  - `admin confirms a pending proof`
  - `reject requires a note`
  - `already-reviewed shows the copy and refetches`
  - `rejected proof shows the note to the client`
  - `exact empty copy`
  - `View proof opens a signed URL`
- [ ] **Step 2:** FAIL. **Step 3:** Implement. **Step 4:** PASS.
- [ ] **Step 5:** Commit `feat(payments): payments tab with schedule, client proofs and admin review`

---

### Task 5: Money on the Overview, milestones and dashboard

**Files:**
- Modify: `src/api/projects.ts` (embed `payment_requests(amount, due_date, payments(amount, status))`, and add `paid`, `outstanding`, `overdue` to `ProjectSummary`), `src/pages/project/OverviewTab.tsx`, `src/pages/admin/DashboardPage.tsx`, `src/pages/client/MyProjectsPage.tsx`, `src/pages/project/milestones/MilestonesTab.tsx`, `MilestoneRow.tsx`
- Test: extend `src/api/projects.test.ts`, `OverviewTab.test.tsx`, `DashboardPage` (new test file), and `MilestonesTab.test.tsx`

**Behaviour:**
- **Overview:** the totals row shows Contract value, Paid and Outstanding, plus "Next payment: {title} · ₱X · due {date}" (or "Overdue"), from `paymentTotals`.
- **Dashboard cards:** show Outstanding, plus "N overdue" when N is above 0. "Unpaid amount" in the spec means Outstanding.
- **Milestones:** each milestone, read-only and admin row alike, lists its scheduled payments in one line each, with a state word. This is the "payment on a specific point in the tracker".

- [ ] **Step 1: Failing tests:**
  - `summary computes paid/outstanding/overdue from embedded requests`
  - `overview shows paid and outstanding in PHP`
  - `dashboard card shows outstanding and overdue count`
  - `milestone lists its scheduled payments with state words`
- [ ] **Step 2:** FAIL. **Step 3:** Implement. **Step 4:** PASS. The entry chunk stays at or under 200 KB.
- [ ] **Step 5:** Commit `feat(payments): totals on overview, dashboard and milestones`

---

### Task 6: Close / reopen UI and read-only mode

**Files:**
- Create: `src/pages/project/CloseProjectDialog.tsx`, `src/pages/project/ClosedBanner.tsx`, `src/pages/project/useProjectOpen.ts`
- Modify: `OverviewTab.tsx`, `ProjectPage.tsx`, `MilestonesTab.tsx` (admin rows render read-only when closed), `UpdatesTab.tsx`, `FilesTab.tsx`, `PaymentsTab.tsx`, `ReviewActions.tsx`, `PlanChangeBanner.tsx` (Acknowledge stays allowed)
- Test: `CloseProjectDialog.test.tsx`, `ClosedBanner.test.tsx`, plus one "hidden when closed" assertion per affected tab

**Behaviour:**
- `useProjectOpen(project): boolean` is `status in (setup, active)`.
- **Admin, active project:** Overview shows "Close project", which opens a dialog choosing Completed or Terminated, with an optional reason and a confirm.
- **Admin, closed project:** "Reopen project", with a confirm.
- **Every viewer, closed project:**
  - `ClosedBanner` shows on every tab.
  - All write controls are hidden: add, edit, upload, review, record, the composer, the upload form, and drag handles.
  - The data stays fully visible and downloadable.
- Any write that still hits `MP001` (for example a stale tab) toasts the lock copy through `toUserMessage`.

- [ ] **Step 1: Failing tests:**
  - `close dialog requires an outcome and calls close_project`
  - `reopen asks to confirm`
  - `closed banner text with date and outcome`
  - Per tab, `no write controls when closed`: milestones, updates, files, payments and reviews.
- [ ] **Step 2:** FAIL. **Step 3:** Implement. **Step 4:** PASS.
- [ ] **Step 5:** Commit `feat(projects): close and reopen with a read-only tracker`

---

### Task 7: End-to-end — payments and closing

**Files:**
- Create: `e2e/payments.spec.ts`. Seed through the service client, as `e2e/live.spec.ts` does, and reuse `e2e/helpers.ts`, including the `tab()` helper that accepts "(updated)".

- [ ] **Step 1: Write the e2e test** (admin and client contexts, both live):
  1. The admin adds "50% deposit", ₱1,000, due tomorrow, on M1. The client sees the plan-change banner and the request live, and acknowledges.
  2. The client uploads a PNG proof for ₱1,000. The admin sees "Proof sent" live, views the proof (the signed URL returns 200), and confirms. The client sees Paid live. Overview Paid is ₱1,000.
  3. The admin adds "Balance", ₱2,000, due yesterday. Both sides see it as Overdue, and the dashboard card shows "1 overdue".
  4. The client uploads a proof. The admin rejects it with "Wrong account". The client sees the note, and the request goes back to Overdue.
  5. The admin records a cash payment of ₱2,000. Outstanding becomes ₱0.
  6. The admin closes the project as Completed. The client sees the closed banner live and no Upload proof or Approve buttons. A proof upload forced from an old tab gets the lock copy.
  7. The admin reopens the project, and the controls come back.
  8. At 375×812: the Payments tab has no horizontal scroll.
- [ ] **Step 2:** Run `npm run e2e`. Expected: FAIL before Tasks 1–6, PASS after, with no flake across 5 runs.
- [ ] **Step 3: Full gate:** `npm run lint && npm run typecheck && npm test && npm run build && npx supabase test db && npm run test:integration && npm run e2e && npx supabase db lint`. Expected: all green.
- [ ] **Step 4:** Commit `test(e2e): scheduled payments, proofs, review and closing`

---

## Reused (don't rebuild)
- **Uploads and downloads:** `uploadTo`, `signedUrl`, `removeObjects` and `objectPath` (`src/api/storage.ts`), `validateUpload` and `ACCEPT_ATTR` (`src/lib/validateUpload.ts`), and `openUrl` (`src/lib/openUrl.ts`).
- **Formatting and errors:** `formatMoney`, `formatDate` and `formatAckStamp` (`src/lib/format.ts`), and `toUserMessage` (`src/lib/errors.ts`).
- **Activity and plan changes:** `describeActivity` (`src/lib/formatChange.ts`; add the `payment_request` entity word), the plan-change banner, and `ReasonField`.
- **Live sync and markers:** `useProjectRealtime`, `invalidateProject`, `qk.*`, and `changedSince`.
- **UI primitives:** `Dialog`, `Field`, `Button`, `StatusChip` and `AsyncView`.
- **DB helpers:** `begin_admin_edit`, `assert_keys`, `display_name`, `log_activity`, and the `tests.*` pgTAP helpers.
- **Test patterns:** the e2e seeding pattern in `e2e/live.spec.ts`. In tests, write `beforeEach(() => { … })` with braces; a function returned from `beforeEach` runs as a teardown.

## Verification
- **Per task:** the RED → GREEN commands above.
- **End of phase:** the Task 7 Step 3 full gate, plus 5 clean e2e runs.
- **Manual:**
  1. Run `npm run dev` with the local stack and `functions serve`.
  2. Open two browsers. Walk the Task 7 story once on a phone-sized window and once with reduced motion on.
- **Final review:** a whole-branch review per executing-plans. It's a self-review unless CJ asks for a reviewer agent. Then merge and push on CJ's say-so.
