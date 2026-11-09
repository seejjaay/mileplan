# Notifications (in-app bell) implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A live notification bell for admin and clients, fed by database triggers on the existing activity log. Action items clear themselves when the action is done.

**Architecture:** One migration adds a `notifications` table, read RPCs, and two trigger functions on `public.activity` and `public.plan_change_acks` that fan out, collapse and auto-resolve rows. The React app reads the table through `src/api/notifications.ts`, stays live through a realtime hook, and shows a `NotificationBell` in the `AppShell` header.

**Tech stack:** Postgres/Supabase (plpgsql, RLS, realtime), pgTAP, React 18, TanStack Query, Tailwind 4, Vitest + Testing Library, Playwright.

**Spec:** `docs/superpowers/specs/2026-11-09-mileplan-notifications-design.md` (the section numbers below are the spec's).

## Global constraints

**Database**
- **Migration file:** `supabase/migrations/20261111000100_notifications.sql`, the only migration. Edit it in place until it is pushed to hosted.
- **Every function** uses `set search_path = ''` and fully qualified names.
- **Trigger and helper functions** have execute revoked from `public`, `anon` and `authenticated`.
- **RPCs** have execute granted to `authenticated` and `service_role` only.
- **Only triggers write the table.** `authenticated` has no insert, update or delete on `public.notifications`.
- **The actor is never a recipient.** A client actor notifies admins. An admin actor, or a null actor, notifies clients.
- **Skipped:** projects with status `setup`, and recipients with `profiles.active = false`.

**Data limits**
- The list is capped at 50 rows, newest `updated_at` first.
- An update's snippet is the first non-empty line of `body`, cut to 80 characters.

**UI copy** (exact)
- Section headings: "Needs you", "New", "Earlier".
- Chip: "Action needed". Buttons: "Mark all read", "Dismiss".
- Empty state: "You're all caught up."
- Bell `aria-label`: `Notifications, N unread`. The badge shows `99+` above 99.

**Layout**
- The panel is full width below Tailwind `sm` (640px), and a right-anchored 22rem popover from `sm` up.

**Process**
- Commit messages carry no attribution lines.
- Messages are never notified, and no email code is written.

## Review focus

1. **A project the user can no longer see.** A removed member still owns old rows, but the `projects` join comes back null. Expected: the item renders "A project you no longer have access to" and doesn't crash. Test: Task 5 `renders an item whose project is hidden`.
2. **Resolved on another device.** The admin confirms a proof on a laptop, and the badge on the phone must drop live. Expected: the realtime hook refreshes on UPDATE events, not only INSERT. Test: Task 4 `an update event refreshes notifications`.
3. **Long text on a phone.** A long first line in an update, or a long milestone title. Expected: the snippet is at most 80 characters, and the panel never scrolls sideways at 375px. Tests: Task 2 `update snippet is the first line cut to 80`, and Task 6 `phone width`.
4. **Two client members on one project.** Both get "ready for review". When one approves, both rows clear. Test: Task 2 `one member's approval clears in_review for every member`.
5. **A burst of acknowledgements.** One click acknowledges 4 plan changes. Expected: the admin gets one "acknowledged" row, not four. Test: Task 2 `acks collapse into one row per client`.

---

### Task 1: Table, RLS, read RPCs and realtime

**Files:**
- Create: `supabase/migrations/20261111000100_notifications.sql`
- Test: `supabase/tests/database/notifications_table.test.sql`

**Interfaces**

Produces:
- **Enum `public.notification_kind`:** `'milestone_in_review','update_posted','document_added','payment_confirmed','payment_rejected','plan_change','payment_proof','milestone_approved','changes_requested','plan_change_acked'`.
- **Table `public.notifications`:**
  - `id uuid pk default gen_random_uuid()`
  - `recipient_id uuid not null references public.profiles(id) on delete cascade`
  - `project_id uuid not null references public.projects(id) on delete cascade`
  - `kind public.notification_kind not null`
  - `group_key text not null`
  - `subject_id uuid`
  - `needs_action boolean not null default false`
  - `count int not null default 1`
  - `data jsonb not null default '{}'`
  - `created_at timestamptz not null default now()`
  - `updated_at timestamptz not null default now()`
  - `read_at timestamptz`
- **Indexes:**
  - `notifications_unread_group` is unique on `(recipient_id, group_key) where read_at is null`.
  - `notifications_recipient_recent` is on `(recipient_id, updated_at desc)`.
- **RPCs:**
  - `public.mark_notifications_read(p_ids uuid[]) returns void` sets `read_at = now()` on the caller's unread rows among `p_ids`.
  - `public.mark_all_notifications_read() returns void` sets `read_at` on the caller's unread rows where `needs_action = false`.
  - Both are security definer.

- [ ] **Step 1: Write the failing pgTAP test** `notifications_table.test.sql`. Use `begin; select plan(N);` and the `tests.*` helpers from `supabase/seed.sql`, with seeded users `ana@client-a.test`, `ben@client-b.test` and `admin@mileplan.test`. Insert fixture rows as postgres directly.
  - `has_table('public','notifications')` and `has_type` for the enum.
  - As ana, `select count(*)` sees only ana's rows (seed 2 for ana, 1 for ben). Expect 2.
  - As ana, `insert into public.notifications …` throws `42501`. So do `update … set read_at = now()` and `delete`.
  - As ana, `mark_notifications_read(array[<ana row>, <ben row>])`. Then, as postgres, ana's row has `read_at` set and ben's is still null.
  - As ana, `mark_all_notifications_read()` marks ana's `needs_action = false` row and leaves her `needs_action = true` row unread.
  - A second unread row with the same `(recipient_id, group_key)` throws `23505`. The same insert after the first is read succeeds.
  - Deleting the project removes its notifications (cascade).
  - `public.notifications` is in the `supabase_realtime` publication (`pg_publication_tables`).
- [ ] **Step 2:** Run `npm run db:reset` and then `npx supabase test db supabase/tests/database/notifications_table.test.sql`. Expected: FAIL, because the relation doesn't exist.
- [ ] **Step 3: Write the migration's table part.**
  - Enum, table, the 2 indexes, `enable row level security`, and policy `notifications_select_own` for select using `recipient_id = (select auth.uid())`.
  - `revoke insert, update, delete on public.notifications from authenticated, anon`.
  - The 2 RPCs, with execute revoked from `public, anon` and granted to `authenticated, service_role`.
  - The realtime publication add, guarded exactly like section 5 of `20261110000100_messages.sql`.
- [ ] **Step 4:** Run `npm run db:reset && npx supabase test db supabase/tests/database/notifications_table.test.sql`. Expected: PASS. Then run `npm run db:test`. Expected: all database tests pass.
- [ ] **Step 5: Commit** with `feat(notifications): table, RLS, read RPCs and realtime`.

### Task 2: Fan-out, collapse and auto-resolve triggers

**Files:**
- Modify: `supabase/migrations/20261111000100_notifications.sql` (append)
- Modify: `supabase/tests/database/function_grants.test.sql` (add the new trigger functions to the list in assertion 1, and an assertion for the helpers)
- Test: `supabase/tests/database/notifications_events.test.sql`

**Interfaces**

Consumes the table and enum from Task 1.

Produces (internal, execute revoked as in Global constraints):
- `public.notify(p_recipients uuid[], p_project uuid, p_kind public.notification_kind, p_group text, p_subject uuid, p_needs boolean, p_data jsonb) returns void`.
  - It inserts one row per recipient.
  - Collapse: `on conflict (recipient_id, group_key) where read_at is null do update set count = notifications.count + 1, updated_at = now(), data = excluded.data`.
- `public.resolve_notifications(p_project uuid, p_group text, p_recipient uuid default null) returns void` sets `read_at = now()` on unread rows with that project and group, optionally limited to one recipient.
- `public.notify_client_ids(p_project uuid, p_except uuid) returns uuid[]` returns active client members of the project except `p_except`.
- `public.notify_admin_ids(p_except uuid) returns uuid[]` returns active admins except `p_except`.
- Trigger function `public.notify_from_activity()` runs `after insert on public.activity for each row`.
- Trigger function `public.notify_from_ack()` runs `after insert on public.plan_change_acks for each row`.

**Rules for `notify_from_activity`**

It reads `new.entity`, `new.action`, `new.changes` (`{field: [old, new]}`), `new.plan_change` and `new.actor_id`. Actor side: `profiles.role` of `actor_id`, with null treated as admin. Return early when the project's status is `setup`.

1. **Resolve first** (any actor):
   - milestone `status_changed` where `changes->'status'->>0 = 'in_review'`: resolve `milestone_in_review:<entity_id>`.
   - milestone `status_changed` with an admin or null actor: resolve `changes_requested:<entity_id>`. A client actor must not resolve it (spec §4).
   - payment `status_changed` where `changes->'status'->>0 = 'pending'`: resolve `payment_proof:<entity_id>`.
   - payment `created` with a non-null `request_id`: resolve `payment_rejected:<request_id>`.
2. **If `new.plan_change`** and the actor is admin-side: `notify(clients, …, 'plan_change', 'plan_change', null, true, '{}')`, then return. It produces no other kind.
3. **Otherwise apply the spec §3 table.** The group key is `<kind>:<subject>`, and the subject is `entity_id`, with these exceptions:
   - `payment_rejected` uses `request_id`, or the payment id when there is none.
   - `milestone_approved` and `changes_requested` use the review's `milestone_id`.

   `data` keys (exact):

| kind | data |
|---|---|
| `milestone_in_review` | `{milestone_title}` |
| `update_posted` | `{actor_name, snippet}` (`display_name(actor_id)`, first non-empty line of body, `left(…, 80)`) |
| `document_added` | `{document_title}` |
| `payment_confirmed` | `{request_title, amount}` (`request_title` null when there's no request) |
| `payment_rejected` | `{request_title, amount, note}` (`note` = `review_note`) |
| `payment_proof` | `{client_name, request_title, amount}` |
| `milestone_approved`, `changes_requested` | `{client_name, milestone_title, comment}` |

**Rules for `notify_from_ack`**

The ack's activity gives `project_id`. The user is `new.user_id`.
- If the user has no remaining plan-change activity in that project without an ack: `resolve_notifications(project, 'plan_change', new.user_id)`.
- Always: `notify(admins except user, project, 'plan_change_acked', 'plan_change_acked:' || new.user_id, new.user_id, false, {client_name})`.

- [ ] **Step 1: Write the failing pgTAP test** `notifications_events.test.sql`.
  - **Fixtures:** active project P1 with members ana and cara (`tests.create_user('cara@client-c.test')`), a setup project P2 with member ben, and admin `admin@mileplan.test`. Perform each action as the right user with `tests.authenticate_as`, the same way the existing tests do: milestone update as admin, `review_payment` RPC, review insert as client, `plan_change_acks` insert as client, and update/document insert as admin. Then assert as postgres.
  - **Tests, by name:**
    - `in_review notifies every client member, needs action`: ana and cara each have 1 `milestone_in_review` row with `needs_action`, and the admin has none.
    - `actor is never notified`: the admin posting an update gives the admin 0 `update_posted` rows.
    - `update snippet is the first line cut to 80`: a body of `E'\n\n' || repeat('x', 120) || E'\nsecond'` gives `data->>'snippet'` = 80 × `x`.
    - `one member's approval clears in_review for every member`: after ana's approving review, both rows have `read_at` set. The admin gets 1 `milestone_approved` row with `client_name` = ana's display name.
    - `changes requested stays open through the client's own status change`: cara's `changes_requested` review gives the admin an unread `changes_requested` row, even though the milestone moved to `in_progress` in the same transaction.
    - `changes requested clears when the admin moves the milestone`: the admin sets the milestone to `in_review`, and the row is read.
    - `payment proof notifies admin; confirming clears it and notifies the client`: covers `payment_proof` needs_action, then `review_payment(…,'confirmed')`, then admin row read plus ana's `payment_confirmed`.
    - `rejected proof needs action until a new proof for that request`: `payment_rejected` stays unread, and a new payment with the same `request_id` resolves it.
    - `plan changes collapse into one row with a count`: 3 milestone inserts as admin on active P1 give 1 unread `plan_change` row per client with `count = 3`.
    - `a new payment request is only a plan change`: an `add_payment_request` RPC on P1 gives no row with kind other than `plan_change`.
    - `acks collapse into one row per client`: ana acking 3 plan-change activities gives the admin 1 `plan_change_acked` row with `count = 3`.
    - `acking everything clears the client's plan_change`: ana's `plan_change` row is read and cara's is not.
    - `setup projects notify nobody`: an update on P2 gives 0 rows for ben.
    - `inactive clients are skipped`: with cara's `profiles.active = false`, a new update gives 0 rows for cara.
    - `a read row starts a new one`: mark ana's `update_posted` read, post another, and there are 2 rows, 1 unread.
- [ ] **Step 2:** Run `npm run db:reset && npx supabase test db supabase/tests/database/notifications_events.test.sql`. Expected: FAIL, because nothing creates rows yet.
- [ ] **Step 3:** Append the 4 helpers, the 2 trigger functions and the 2 `create trigger` statements to the migration. Revoke execute on all 6 from `public, anon, authenticated`. Add `notify_from_activity` and `notify_from_ack` to the array in `function_grants.test.sql` assertion 1, and add assertion `notification helpers are not executable by authenticated`, raising `plan(4)` to `plan(5)`.
- [ ] **Step 4:** Run `npm run db:reset && npm run db:test`. Expected: all database tests pass, including the existing `activity`, `reviews` and `payments_schedule` tests, which prove the triggers break nothing.
- [ ] **Step 5: Commit** with `feat(notifications): fan-out, collapse and auto-resolve triggers`.

### Task 3: Client API and notification text

**Files:**
- Create: `src/api/notifications.ts`, `src/lib/describeNotification.ts`
- Modify: `src/api/keys.ts`
- Test: `src/api/notifications.test.ts`, `src/lib/describeNotification.test.ts`

**Interfaces**

Consumes the table and RPCs from Task 1.

Produces:
- `qk.notifications = () => ['notifications'] as const` and `qk.notificationCount = () => ['notifications', 'count'] as const`. One invalidation of `['notifications']` refreshes both.
- **Types:**
  - `NotificationKind` (the 10 strings).
  - `NotificationRow = { id: string; project_id: string; kind: NotificationKind; needs_action: boolean; count: number; data: Record<string, unknown>; created_at: string; updated_at: string; read_at: string | null; project: { title: string; currency: string } | null }`.
- **Functions:**
  - `listNotifications(): Promise<NotificationRow[]>` selects `'*, project:projects(title, currency)'`, ordered by `updated_at desc`, limit 50.
  - `unreadNotificationCount(): Promise<number>` uses `select('id', { count: 'exact', head: true }).is('read_at', null)`.
  - `markNotificationsRead(ids: string[]): Promise<void>` and `markAllNotificationsRead(): Promise<void>` call the RPCs. All four throw the Supabase error.
- `describeNotification(n: NotificationRow): { text: string; tab: TabKey }`, with `TabKey` from `src/pages/project/tabs.ts`.

- [ ] **Step 1: Write the failing tests.**
  - **`describeNotification.test.ts`**, one `it` per kind, asserting `text` and `tab` exactly. `formatMoney(35000, 'PHP')` comes from `src/lib/format.ts`; call it inside the expectation rather than hard-coding its output.
    - `milestone_in_review`: `"Discovery is ready for your review"`, tab `milestones`.
    - `update_posted`: `"CJ posted an update: Week 2 progress"`, tab `updates`.
    - `document_added`: `"New document: Service Agreement"`, tab `files`.
    - `payment_confirmed`: `"Your payment for Deposit was confirmed"`, tab `payments`. With `request_title` null, it reads `` `Your payment of ${formatMoney(35000,'PHP')} was confirmed` ``.
    - `payment_rejected`: `"Your payment for Deposit was rejected: Wrong amount"`. Without a note, the text ends at `rejected`. Tab `payments`.
    - `plan_change`: count 1 gives `"The plan changed: 1 change to acknowledge"`, and count 3 gives `"The plan changed: 3 changes to acknowledge"`. Tab `overview`.
    - `payment_proof`: `` `Acme sent a payment proof for Deposit, ${formatMoney(35000,'PHP')}` ``, tab `payments`.
    - `milestone_approved`: `"Acme approved Build"`, tab `milestones`.
    - `changes_requested`: `"Acme requested changes on Build"`, tab `milestones`.
    - `plan_change_acked`: `"Acme acknowledged the plan change"`, tab `timeline`.
  - **`notifications.test.ts`**, mocking `../lib/supabase` like `src/api/messages.test.ts`:
    - `listNotifications` selects with the project join, orders by `updated_at` descending and limits 50.
    - `markAllNotificationsRead` calls `rpc('mark_all_notifications_read')`.
    - An error from Supabase is thrown.
- [ ] **Step 2:** Run `npx vitest run src/lib/describeNotification.test.ts src/api/notifications.test.ts`. Expected: FAIL, module not found.
- [ ] **Step 3: Implement** `keys.ts`, `notifications.ts` and `describeNotification.ts`. When `project` is null, use currency `'PHP'`.
- [ ] **Step 4:** Run the same command. Expected: PASS. Then run `npm test`, `npm run typecheck` and `npm run lint`. Expected: clean.
- [ ] **Step 5: Commit** with `feat(notifications): client API and notification text`.

### Task 4: Live updates

**Files:**
- Create: `src/realtime/useNotificationsRealtime.ts`
- Modify: `src/shell/AppShell.tsx` (call it next to `useUnreadRealtime`)
- Test: `src/realtime/useNotificationsRealtime.test.tsx` (copy the mock setup of `useUnreadRealtime.test.tsx`)

**Interfaces**

Consumes `qk.notifications()` from Task 3.

Produces `useNotificationsRealtime(userId: string | undefined): void`. It opens channel `notifications:<userId>` with spec `{ event: '*', schema: 'public', table: 'notifications', filter: 'recipient_id=eq.<userId>' }` and invalidates `{ queryKey: qk.notifications() }`.

- [ ] **Step 1: Write the failing tests.**
  - `opens one channel filtered to the user`: asserts the channel name and the exact spec above.
  - `an insert event refreshes notifications`.
  - `an update event refreshes notifications`: an `{eventType: 'UPDATE'}` payload invalidates `qk.notifications()`. This is Review focus 2.
  - `no user, no channel`.
  - `unmount removes the channel`.
- [ ] **Step 2:** Run `npx vitest run src/realtime/useNotificationsRealtime.test.tsx`. Expected: FAIL.
- [ ] **Step 3: Implement** the hook, mirroring `useUnreadRealtime`, and mount it in `AppShell`.
- [ ] **Step 4:** Run the test file, then `npm test`. Expected: PASS.
- [ ] **Step 5: Commit** with `feat(notifications): live updates`.

### Task 5: The bell

**Files:**
- Create: `src/shell/NotificationBell.tsx`
- Modify: `src/shell/AppShell.tsx` (render `<NotificationBell />` between the `<nav>` and the account `<details>`)
- Test: `src/shell/NotificationBell.test.tsx` (mock `../api/notifications`, wrap in `QueryClientProvider` and `MemoryRouter`)

**Interfaces**

Consumes Tasks 3–4 and reuses `UnreadBadge` (wrapped to cap at `99+`), `AsyncView`, `Button` and `toUserMessage`.

Produces `NotificationBell(): JSX.Element`.

**Behaviour** (decisions the tests pin):
- **Data:**
  - `useQuery(qk.notifications(), listNotifications)` and `useQuery(qk.notificationCount(), unreadNotificationCount)`.
  - Mutations call the API and then `invalidateQueries({ queryKey: qk.notifications() })`.
- **Sections and items:**
  - The panel lists 3 sections, each omitted when empty, in order: "Needs you" (unread, `needs_action`), "New" (unread, not `needs_action`) and "Earlier" (read).
  - Each item is a button showing `describeNotification(n).text`, the project title (or `A project you no longer have access to`), and a relative time.
  - Action items show the chip text "Action needed" and a "Dismiss" button.
- **Clicking an item:**
  - Every click navigates to `/projects/<project_id>/<tab>` and closes the panel.
  - An info item is also marked read. An action item is not.
- **Closing:**
  - Escape is handled by a `keydown` listener on the panel element, not on `window`. It closes the panel and focuses the bell button.
  - A `pointerdown` outside the bell and panel closes it.
  - On open, focus moves to the first item, or to the panel heading when the list is empty.

- [ ] **Step 1: Write the failing tests.**
  - `bell shows the unread count`: count 3 gives the button name `Notifications, 3 unread`, and 150 shows `99+`.
  - `loading, error and empty are distinct`:
    - A never-resolving `listNotifications` shows `role=status` "Loading" and not "You're all caught up.".
    - A rejecting call shows the error text and a Retry button.
    - Resolving `[]` shows "You're all caught up.".
  - `groups items into Needs you, New and Earlier`: with one of each, the headings appear in that order, and only the action item shows "Action needed".
  - `clicking an info item marks it read and navigates`: asserts `markNotificationsRead(['n2'])` and the location `/projects/p1/updates`.
  - `clicking an action item navigates without marking read`.
  - `dismiss marks one action item read`.
  - `mark all read calls the RPC`.
  - `renders an item whose project is hidden`: `project: null` shows `A project you no longer have access to` (Review focus 1).
  - `Escape closes only when focus is inside the panel`:
    - With focus on a button outside the panel, pressing Escape on `document.body` keeps it open.
    - With focus inside, Escape closes it and focuses the bell.
- [ ] **Step 2:** Run `npx vitest run src/shell/NotificationBell.test.tsx`. Expected: FAIL.
- [ ] **Step 3: Implement** the component and add it to `AppShell`. Style it with the app's CSS variables (`--surface`, `--border`, `--muted`, `--accent`), as in `AppShell`'s account menu. The panel classes follow the Global constraints layout.
- [ ] **Step 4:** Run the test file, then `npm test`, `npm run typecheck`, `npm run lint` and `npm run build`. Expected: all clean, and the build still meets the first-load JS budget from the main spec §12.
- [ ] **Step 5: Commit** with `feat(notifications): notification bell`.

### Task 6: End-to-end

**Files:**
- Create: `e2e/notifications.spec.ts`

**Interfaces**

Consumes everything above. Follow `e2e/messages.spec.ts` for seed and cleanup with `adminServiceClient()`, and `e2e/helpers.ts` for `signInAs` and `expectNoHorizontalScroll`.

- **Seed:**
  - Client `gia@client-g.test` / `gia-e2e-pw-1`.
  - Project `Notifications E2E`, status `active`, with gia as a member.
  - One milestone `Discovery`, status `in_progress`.
- **Cleanup:** delete the project and the user. It must run from any failure point.

- [ ] **Step 1: Write the tests.**
  - `client is told live, approves, admin is told live`:
    - Open an admin context and a gia context, both on `/`.
    - Set the milestone to `in_review` through the service client. A null actor counts as admin-side.
    - The gia bell's name becomes `Notifications, 1 unread` without a reload.
    - Open the panel: "Action needed" and "Discovery is ready for your review" are visible.
    - Click the item: the URL ends `/milestones`.
    - Approve the milestone through the UI, using the same approve control `e2e/tracker.spec.ts` uses.
    - gia's bell drops to no unread badge.
    - The admin's bell shows 1, and the panel contains `approved Discovery`.
  - `phone width`: at viewport 375×740, gia opens the panel with an item whose milestone title is 120 characters long, and `expectNoHorizontalScroll` passes.
- [ ] **Step 2:** Run `npx playwright test e2e/notifications.spec.ts`, with the local stack up (`npm run db:start`) and migrations applied. Expected: PASS. Run it again to confirm cleanup leaves no residue: PASS.
- [ ] **Step 3: Full check.** Run `npm test`, `npm run db:test`, `npx playwright test` (all suites), `npm run lint` and `npm run typecheck`. Expected: all green.
- [ ] **Step 4: Commit** with `test(notifications): two-browser e2e and phone check`.

**Rollout** (spec §8, each needs CJ's OK, not part of this plan's tasks):
1. Push to hosted with `npx supabase db push --remote --yes`.
2. Run `npx supabase db advisors --remote` and check for no new warnings.
3. Merge to `main`.
