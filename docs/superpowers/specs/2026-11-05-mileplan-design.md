# MilePlan — Design Spec

**Date:** 2026-11-05 · **Owner:** CJ · **Status:** draft for review

## 1. Purpose
MilePlan is CJ's freelance client portal. Once a client has approved and signed the plan off-platform, MilePlan is where CJ and that client follow the engagement through to close-out: milestones, tasks, progress updates, payments, signed documents and messages. Both sides see the same live state.

**Success looks like:**
- A signed plan becomes a live tracker in under 5 minutes.
- The client never has to ask "where are we?"
- Every change to the agreed plan is visible and acknowledged.

## 2. Engagement flow
1. **Off-platform:** CJ and the client discuss the project, and CJ shares the agreement, SRS and milestone plan (drafted with Claude from `templates/`).
2. The client approves and signs.
3. CJ gives Claude the signed files. Claude produces or validates `plan.json`.
4. CJ creates the project in MilePlan (status `setup`), imports `plan.json` and uploads the signed PDFs. Either CJ does this in the app or Claude does it against Supabase. The client can't see any of it yet.
5. **Add client & activate:** this creates the client's account, links them to the project and sets it to `active`. It also produces a one-time setup link, which CJ sends through any channel.
6. The client opens the link, sets a password and lands on their project.
7. Work runs through MilePlan:
   - CJ posts updates and moves milestones along.
   - The client reviews deliverables and uploads payment proofs. CJ confirms them.
   - Both sides message each other.
8. **Close-out:** CJ marks the project `completed` (or `terminated`). The tracker becomes read-only and stays viewable. Messages stay open for 30 days after close for wrap-up questions.

## 3. Roles and access
- **admin:** exactly one (CJ). Full read and write on everything.
- **client:** sees only projects they're a member of, and only once the project isn't `setup`. There's no public sign-up page.
- A project can have more than one client member, for example two people at the same client company.

## 4. Screens
Every list or data screen has distinct **loading** (skeleton), **error** (message and retry) and **empty** states. The empty state only renders after data has arrived and is genuinely empty. Every write gives toast confirmation. Save buttons stay disabled until the form is dirty.

### Shared
- `/login`: email and password, plus "email me a sign-in link"
- `/setup#token=…`: set password from the setup link. The token is in the URL fragment, so it never reaches server logs.
- `/account`: name, avatar, change password
- 404 page and error boundary, both rendered inside the app shell

### Admin
- **`/` Dashboard:**
  - Project cards with status chip, % complete, next due milestone, unpaid amount and unread message count
  - Filter by status
- **`/clients`:**
  - Client list with their projects
  - Create client
  - Regenerate setup link
  - Deactivate
- **`/projects/new`:**
  - Title, summary, currency (default PHP), dates
  - Created in `setup`
- **`/projects/:id`:** tabs for Overview, Milestones, Updates, Files, Payments, Messages and Timeline
  - **Overview:**
    - Progress bar
    - Milestone strip
    - Totals: contract value, paid, outstanding
    - Pending acknowledgements
    - "Add client & activate" while in `setup`
  - **Milestones:**
    - Inline edit for every field, drag to reorder milestones and tasks
    - Add, delete, split and merge milestones; hold and unhold
    - An optional "reason" field on any plan-change edit
  - **Updates:** post a progress update (Markdown plus attachments), optionally linked to a milestone
  - **Files:**
    - Upload a signed document (kind, version, signed date). The SHA-256 is computed in the browser and stored.
    - Superseding a document keeps the old version visible, marked `superseded`.
  - **Payments:**
    - Payments are agreed with the client outside the app. The admin adds **scheduled payments** to the tracker: a label, an amount, a due date and, optionally, the milestone each belongs to
    - Each scheduled payment shows a derived state: Paid, Proof sent, Partially paid, Overdue or Due
    - The client uploads proof against a scheduled payment. The admin confirms it, or rejects it with a note
    - The admin can also record a payment directly (cash, or proof sent by chat), with or without proof
  - **Messages:** realtime thread
  - **Timeline:** the full activity log with diffs
  - **Import plan** (button on the Milestones tab, next to "Add milestone"; hidden for a client and for a closed project):
    - Choose `plan.json` (`.json`, up to 256 KB). A parse error reads "plan.json isn't valid JSON (line X, column Y)".
    - The server validates it. Errors are listed with their JSON paths under "Fix these in plan.json and choose it again", and nothing else shows.
    - Otherwise a preview. For a project with no milestones and no payment requests it's a tree of what will be created. For anything else it's a diff of added, changed and removed items, plus "Not in the plan, kept as is" for rows the plan doesn't name, and a note when milestones will be reordered.
    - On an active project the dialog also asks for an optional reason, which is shared by every change.
    - An identical plan shows "Nothing to change" and the confirm button is disabled.
    - "Apply changes" applies everything in one transaction, then toasts "Plan imported: n added, n changed, n removed". If the apply is refused (the project changed since the preview), the dialog shows why and offers "Check again".

### Client
- **`/` My projects:** cards. If there's only one project, the client goes straight to it.
- **`/projects/:id`:** the same tabs, read-only except for these client actions:
  - Milestone in `in_review`: **Approve** or **Request changes** (a comment is required for Request changes)
  - Payments: **Upload proof** against a scheduled payment (amount, method, reference, image or PDF)
  - Messages: send
  - Plan-change banner: **Acknowledge**
- An "Updated since your last visit" marker appears on changed milestones and tabs. It's computed from `activity.created_at` compared with the client's `last_seen_at` for that project.

### Phone
Every screen works at 375px wide. Tabs become a scrollable tab bar, and the milestone strip stacks vertically.

## 5. Data model
All tables have `id uuid pk default gen_random_uuid()` and `created_at timestamptz default now()` unless noted. Amounts are `numeric(12,2)`.

- **`profiles`**
  - `id` (pk, references `auth.users`)
  - `role` (`admin` | `client`)
  - `full_name`, `company`, `avatar_path`
  - `active bool default true`
- **`projects`**
  - `title`, `summary`
  - `status` (`setup` | `active` | `completed` | `terminated`)
  - `currency char(3) default 'PHP'`
  - `start_date`, `end_date`, `activated_at`, `closed_at`
- **`project_members`**
  - `project_id`, `user_id` (pk is the pair)
  - `last_seen_at`
- **`documents`**
  - `project_id`
  - `kind` (`contract` | `agreement` | `srs` | `milestone_plan` | `amendment` | `other`)
  - `title`, `version int`
  - `storage_path`, `sha256 text`, `signed_at date`
  - `status` (`signed` | `superseded`)
  - `uploaded_by`
- **`milestones`**
  - `project_id`, `position int`
  - `title`, `description`, `acceptance_criteria text[]`
  - `due_date`, `amount`
  - `status` (`planned` | `in_progress` | `in_review` | `approved` | `paid`)
  - `on_hold bool default false`
  - `plan_key text null` (unique per project)
  - `approved_at`, `approved_by`
- **`tasks`**
  - `milestone_id`, `project_id` (copied from the milestone by trigger, used for RLS and Realtime filters)
  - `position`, `title`
  - `status` (`todo` | `doing` | `done`)
- **`updates`**
  - `project_id`, `milestone_id null`
  - `author_id`, `body`
  - `attachments jsonb` (array of `{path, name, size, mime}`)
- **`milestone_reviews`**
  - `milestone_id`, `user_id`
  - `decision` (`approved` | `changes_requested`)
  - `comment`
- **`payment_requests`** (the schedule)
  - `project_id`, `milestone_id null`, `title`, `amount`, `due_date`, `created_by`
- **`payments`** (submissions and receipts against a request)
  - `project_id`, `request_id`, `milestone_id null` (both copied from the request by trigger)
  - `amount`, `method`, `reference`, `paid_on date`
  - `proof_path null`
  - `status` (`pending` | `confirmed` | `rejected`)
  - `submitted_by`, `reviewed_by`, `reviewed_at`, `review_note`
- **`messages`**
  - `project_id`, `sender_id`, `body`
  - `attachments jsonb`: at most 5 items, each exactly `path` (under `<project_id>/`, no `..`), `name` (1-200 chars), `size` (1-10485760) and `mime`; fixed after insert
  - `edited_at`: set by trigger only, when `body` changes; `body` has at least one non-whitespace character and at most 4000, and is the only column a client can update
- **`message_reads`**
  - `project_id`, `user_id` (pk is the pair)
  - `last_read_at`
- **`activity`**
  - `project_id`, `actor_id`
  - `entity` (`project` | `milestone` | `task` | `document` | `payment` | `payment_request` | `update` | `review`)
  - `entity_id`
  - `action` (`created` | `updated` | `deleted` | `status_changed`)
  - `changes jsonb` (`{field: [old, new]}`), `reason text`
  - `plan_change bool`
- **`plan_change_acks`**
  - `activity_id`, `user_id` (pk is the pair)
  - `acked_at`
- **`setup_tokens`**
  - `user_id`
  - `token_hash text` (the SHA-256 of the token, never the raw token)
  - `expires_at`, `used_at`

**Rules enforced in the database** (triggers or check constraints):
- `activity` is written only by `AFTER INSERT/UPDATE/DELETE` triggers. It is insert-only for everyone, including admin.
- `plan_change = true` is set when the project is `active` and any of these happens:
  - a milestone is inserted or deleted
  - a milestone's `amount`, `due_date`, `title`, `description` or `acceptance_criteria` changes
- `reason` gets from the app to the trigger through a transaction-local setting (`set_config('mileplan.reason', …, true)`), wrapped in an RPC.
- Payments never change a milestone's status. A milestone's status is the admin's to set. A request's state is derived from its confirmed and pending payments and the date.
- A milestone moves to `approved` only from `in_review`, and only by a client review or an admin.
- When a project is `completed` or `terminated`, a trigger blocks writes to its children, except messages, which stay open for 30 days after close.

## 6. Access rules (RLS)
- **Helper functions:**
  - `is_admin()`: true if the caller's profile has role `admin`.
  - `can_see(project_id)`: `is_admin()`, or the caller is a member and the project status isn't `setup`.
  - Both are `security definer` with a pinned `search_path`.

| Table | Client read | Client write | Admin |
|---|---|---|---|
| profiles | self, plus co-members of visible projects | self: `full_name`, `avatar_path` | all |
| projects, milestones, tasks, updates, documents | `can_see` | — | all |
| milestone_reviews | `can_see` | insert only, when the milestone is `in_review` and the reviewer is self | all |
| payment_requests | `can_see` | none | all |
| payments | `can_see` | insert with `status=pending`, `submitted_by=self`, against a request of the project | all |
| messages | `can_see` | insert with `sender_id=self`; update own body within 15 min | all |
| message_reads, project_members.last_seen_at | own rows | own rows | all |
| activity | `can_see` | — (triggers only) | read |
| plan_change_acks | own, plus all for visible projects | insert own | read |
| setup_tokens | — | — | — (Edge Functions only) |

**Storage:**
- Buckets are private: `documents`, `attachments`, `payment-proofs` and `avatars`.
- Object path is `{project_id}/{uuid}-{filename}`. Read requires `can_see(first path segment)`.
- Clients can write only to `payment-proofs` and `attachments` (message attachments).
- Downloads use signed URLs that expire after 60s.

## 7. Client onboarding (setup link)
- **Why a custom token:** Supabase's built-in invite and recovery links expire in 24h at most. A custom token is used for the 7-day window.
- **Edge Function `create-client`** (admin JWT required):
  1. Creates the auth user with no password, plus the profile with role `client`.
  2. Adds them to the project.
  3. Generates 32 random bytes as the token and stores only its SHA-256 hash, with `expires_at = now() + 7 days`.
  4. Returns `https://<site>/setup#token=<raw>` exactly once.
- **Edge Function `regenerate-setup-link`:** revokes any unused tokens for that user and issues a new one.
- **Edge Function `redeem-setup`** (public, rate-limited per IP):
  - Takes the token and a new password, and verifies the hash, expiry and that the token is unused.
  - Sets the password with the admin API, marks the token used and returns success.
  - The client then signs in normally.
- **Activation:** "Add client & activate" runs `create-client` (or links an existing client), then sets project `status=active` and `activated_at`.
- The service role key lives only in Edge Function secrets.

## 8. Tracker editing and live sync
- All admin edits go through small RPCs (`update_milestone(id, patch jsonb, reason text)`, `reorder_milestones(project_id, ids uuid[])`, and so on). Each RPC sets the reason and applies the change in one transaction.
- **Split** creates a new milestone right after the original. The tasks the admin picks move to it, and the amount is divided as entered.
- **Merge** combines two adjacent milestones. Tasks are concatenated and amounts summed. Both changes log as `plan_change`.
- **Realtime:** the client subscribes to Postgres changes on `milestones`, `tasks`, `updates`, `payments`, `documents`, `activity` and `messages`, filtered by `project_id` (this works for `tasks` too, through its copied `project_id`).
  - When an event arrives, the matching query cache is re-fetched.
  - On reconnect, all the project's queries are re-fetched.
- **Plan-change banner:**
  - Shows on every tab whenever the client has unacknowledged `plan_change` activity on the project.
  - Lists each change in plain words ("M3 due date: Dec 1 → Dec 15. Reason: client asked to add login screen").
  - One Acknowledge button covers everything currently listed.
  - The admin sees "Acknowledged by Ana · Nov 6, 14:02", or "Not yet acknowledged", for each change.

## 9. Plan import
- **`plan.json`** follows the JSON Schema at `schemas/plan.schema.json` (`schema_version: 1`). Unknown keys are errors at every level.

```json
{
  "schema_version": 1,
  "project": { "title": "string", "summary": "string", "currency": "PHP", "start_date": "2026-11-10", "end_date": "2027-01-31" },
  "milestones": [
    {
      "key": "m1",
      "title": "Discovery & wireframes",
      "description": "string",
      "acceptance_criteria": ["Wireframes for 6 screens approved"],
      "due_date": "2026-11-24",
      "amount": 15000,
      "tasks": ["Kickoff call", "Sitemap", "Wireframes"]
    }
  ],
  "payments": [
    { "key": "p1", "title": "Deposit", "amount": 5000, "due_date": "2026-11-10", "milestone": "m1" }
  ]
}
```

- **Fields.**
  - `project.title` is required (1–200 characters). `summary` (up to 2000), `currency` (3 uppercase letters) and `start_date` / `end_date` (start not after end) are optional.
  - `milestones` (required, 1–100): `key`, `title` and `due_date` are required. `description` (up to 5000), `acceptance_criteria` (up to 50 non-empty strings), `amount` (0 to 9,999,999,999.99, at most 2 decimals) and `tasks` (up to 100 unique non-empty strings of up to 200 characters) are optional. Due dates never go backwards in plan order.
  - `payments` (optional, up to 100): `key`, `title`, `amount` (greater than 0) and `due_date` are required. `milestone` is optional and must be a milestone key in the same plan.
  - `key` matches `^[a-z0-9][a-z0-9_-]{0,39}$` and is unique within its list.
  - **An omitted optional field is left unchanged**, on a milestone, a payment or the project. A plan with no `payments` list leaves every payment request alone, and one with no `tasks` leaves that milestone's tasks alone.
- **Keys.** A key is stable across revisions, so a re-import can tell "changed" apart from "removed and added". It's stored in `milestones.plan_key` and `payment_requests.plan_key`.
- **Unkeyed rows are never touched.** Milestones and requests with no key (added by hand, or created by Split) are listed as "not in the plan, kept as is". They follow the plan's milestones in their existing order.
- **Tasks match by title** within a milestone. A matching title keeps its status, a new title is added, a missing title is removed, and order follows the plan.
- **What import writes.** Milestones: `title`, `description`, `acceptance_criteria`, `due_date`, `amount`, `position` and tasks. Requests: `title`, `amount`, `due_date` and the milestone link. Never `status`, `on_hold` or approvals.
- **`import_plan(project_id, plan jsonb, dry_run bool, reason text)`**, admin only, one function for the app and for Claude:
  1. Validates the shape and collects every error as `{path, message}` (for example `milestones[2].due_date` / `is before milestones[1].due_date`).
  2. Checks the project's state. These are errors too, so a preview shows them before anything is written:
     - the project is closed;
     - a keyed milestone would be removed but is in progress, in review, approved or paid, has a done task, has client reviews, or has confirmed payments (removing it would delete that history);
     - a done task would be removed because the plan drops or renames its title (keep the title in the plan, or delete the task by hand);
     - a keyed request would be removed but has any payment submission, rejected ones included, since a rejection keeps the proof and the note (manual delete still cascades with its warning; import never does);
     - a request's or a milestone's amount would drop below what's already confirmed against it;
     - the currency would change once the project has payment requests or payments;
     - the project would end before it starts, counting a stored date the plan leaves out.
  3. Returns the diff: project field changes, and added, changed, removed and kept milestones and requests, plus whether milestones are reordered. A request that loses its milestone because the plan removes it is listed as changed, unkeyed ones included. A dry run also returns a `fingerprint` of the diff.
  4. If `dry_run` is false, it locks the project row, re-runs the dry run, and applies everything in one transaction. Any error rolls back all of it. It refuses with `22023` if the plan is no longer valid (for example a client sent a proof between preview and apply) or if the diff's fingerprint no longer matches the one the preview returned (anything else changed). A closed project raises `MP001`. The apply returns the diff as previewed.
- **Activity.** The reason is shared by every change. On an active project, milestone and request changes become plan changes the client acknowledges from the existing banner in one click. A setup import logs none. Re-importing an identical plan changes nothing and logs nothing.
- **Through Claude:** Claude runs the same function over SQL: first a dry run, then shows CJ the diff, then applies only on CJ's OK.

## 10. Document templates (`templates/`)
Each template is Markdown with `{{placeholders}}` and exports to PDF or DOCX. They are drafting aids, not legal advice: have a local lawyer review the service contract once.
- **`service-contract.md`:** parties, definitions, scope (by reference to the SRS), milestones and payment terms, revisions (included rounds, then rate), change requests, client responsibilities, IP (transfers on full payment, plus a portfolio-use clause), confidentiality, warranty and support window, termination (kill fee and payment for work done), limitation of liability, governing law, signatures.
- **`project-agreement.md`** (SOW): the project-specific summary, meaning deliverables, timeline, total, payment schedule and acceptance process. It references the contract.
- **`srs.md`:** purpose, scope, users and roles, functional requirements (numbered FR-x), non-functional requirements, constraints, assumptions, out of scope, glossary.
- **`milestone-plan.md`:** a table of milestones with dates, amounts, acceptance criteria and tasks. It's generated side by side with `plan.json`, so the two always match.

## 11. Look and feel
- **Identity:** "mile markers on a route". The project's progress is a single route line with milestone markers.
  - Done markers are filled, the current one is ringed and pulsing, future ones are outlined.
  - Each marker is labelled with its word (Done / In review / Next), never colour alone.
- **Signature motion:**
  - The route line draws forward to the current marker on load.
  - Live updates make the affected marker tick.
  - Motion is limited to transforms and opacity, and reduced-motion flattens it to static.
- **Visuals:**
  - Light and dark themes come from CSS tokens.
  - One accent colour, plus status colours that pass AA contrast on both themes.
  - A distinctive display face for headings and a clean UI sans for everything else, loaded with `font-display: swap`.

## 12. Non-functional
- **Speed:**
  - Each route is lazy-loaded.
  - The first-load JS budget is ≤ 200 KB gzipped.
  - Lists are paginated (messages: 50 at a time, scroll up to load more).
  - Images go through Supabase image transforms for thumbnails.
- **Accessibility:**
  - Every flow can be done by keyboard.
  - Dialogs have a focus trap, close on Esc and restore focus.
  - Labels are tied to inputs, every route sets a title, and there's a skip link and a visible focus ring.
- **Security:**
  - RLS on every table.
  - No service key in the client.
  - Upload limits: 10 MB per file; images, PDF and ZIP only, checked by extension and MIME type.
  - Signed URLs for every download.
  - Supabase security advisors must be clean before deploy.
- **Quality:** TypeScript strict, ESLint (including `no-undef` and `react/jsx-no-undef`) and `tsc --noEmit` all run in CI on every push.

## 13. Error handling
- **Network or Supabase errors:** an inline error state with Retry. Failed writes keep the form contents and show a toast with the reason.
- **RLS denials (`42501`/403):** shown as "You don't have access to this", never as a raw error.
- **Realtime disconnect:** a subtle "Reconnecting…" pill, then a full re-fetch on reconnect.
- **Import validation errors:** listed with the JSON path, for example `milestones[2].due_date is before milestones[1].due_date`.
- **Expired or used setup link:** a clear message, plus "ask CJ for a new link".

## 14. Testing
- **Database tests (pgTAP through the Supabase CLI):**
  - With two clients seeded, client A gets zero rows or a denied write on each of client B's tables and buckets.
  - A `setup` project is invisible to its own member.
  - `activity` can't be written directly.
  - The `plan_change` flag is set correctly.
  - `import_plan`: every validation rule reports its path, an invalid apply writes nothing, a dry run writes nothing, a re-import diffs by key and title (a Done task survives), the state checks block, an active import logs plan changes with the shared reason, an identical re-import is a no-op, and a client is denied.
  - `plan.schema.json` and `import_plan` give the same verdict on every fixture plan.
- **Unit tests (Vitest):** the plan schema, diff formatting and amount maths.
- **End-to-end tests (Playwright, two browser contexts):**
  1. Admin creates a project, imports the example `plan.json` (milestones, tasks and scheduled payments) and uploads the documents.
  2. Admin adds the client and activates the project.
  3. Client redeems the setup link.
  4. Admin moves M1 to in_review, and the client approves it.
  5. Admin schedules a payment against M1. The client uploads a proof, and the admin confirms it. The request shows Paid and the Overview totals update.
  6. Admin changes the M2 due date with a reason. The client sees it live and acknowledges it, and the admin sees the acknowledgement.
  7. Messages are exchanged live (`e2e/messages.spec.ts`).
  8. The timeline shows every step.
- **Manual:** a pass at 375px wide, a keyboard-only pass, and a dark mode pass.

## 15. Out of scope for v1
- Online checkout (Stripe or PayMongo)
- Email or push notifications (first follow-up)
- In-app e-signing
- Multiple admins or teams
- Invoicing PDFs
- Time tracking
- Client self sign-up
