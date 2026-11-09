# MilePlan notifications: design

Decided with CJ on 2026-11-09. Delivers the "notifications" follow-up named in §15 of `2026-11-05-mileplan-design.md`, as an in-app bell. Email is deferred (§11).

## 1. Purpose

Today a client only sees changes inside a project they open, and CJ gets no signal at all when a client acts, except for messages. The bell gives both roles one cross-project list of what needs attention, live.

**Success looks like:**
- CJ sees "client sent a payment proof" without opening the project.
- A client sees "milestone ready for your review" the moment they sign in.
- The unread count means "things still waiting on me", because a finished action clears its own notification.

## 2. Decisions

- **Recipients:** both roles, with role-specific events (§3).
- **Channel:** in-app only. No email, no push, no scheduled reminders in this version.
- **Messages:** not in the bell. They keep their unread badges (`useUnreadCounts`).
- **Action items clear themselves** when the action is done, from any place or device (§4).
- **Source of events:** the existing `public.activity` log and `public.plan_change_acks`. Nothing in the app has to remember to notify.

## 3. Events

The actor is never notified about their own action. An admin actor, or a null actor (a plan imported over SQL), notifies clients. A client actor notifies admins.

| Source row | Recipients | kind | Needs action | Opens tab |
|---|---|---|---|---|
| milestone `status_changed` to `in_review` | clients | `milestone_in_review` | yes | milestones |
| update `created` | clients | `update_posted` | no | updates |
| document `created` | clients | `document_added` | no | files |
| payment `status_changed` to `confirmed` | clients | `payment_confirmed` | no | payments |
| payment `status_changed` to `rejected` | clients | `payment_rejected` | yes | payments |
| any activity with `plan_change = true` | clients | `plan_change` | yes | overview |
| payment `created` (a proof, by a client) | admins | `payment_proof` | yes | payments |
| review `created`, decision `approved` | admins | `milestone_approved` | no | milestones |
| review `created`, decision `changes_requested` | admins | `changes_requested` | yes | milestones |
| `plan_change_acks` insert | admins | `plan_change_acked` | no | timeline |

- **A new scheduled payment is a `plan_change`.** On an active project every new payment request is already flagged as a plan change, so it produces no separate notification.
- **Not notified:** tasks, project rows, deletes, projects in `setup` (the client can't see them yet), and recipients whose profile is inactive.
- **Recipients:** clients are members of the project with an active client profile. Admins are all active admin profiles.

## 4. Collapse and auto-resolve

Each notification has a `group_key`, built from its kind and what it is about (for example `payment_proof:<payment id>`). `plan_change` uses one key per project. `payment_rejected` uses the payment's request, or the payment itself for older payments that have no request.

- **Collapse.** A partial unique index on `(recipient_id, group_key)` where `read_at is null` allows one unread row per key. A repeat event updates that row (`count + 1`, new `updated_at`, fresh `data`) instead of adding another. Importing a plan with 5 changes gives one row, "5 changes to acknowledge". Once a row is read, the next event starts a new one.
- **Auto-resolve.** Setting `read_at = now()` on every unread row with a matching key, for all recipients:

| Row | Clears when |
|---|---|
| `milestone_in_review:<milestone>` | the milestone's status changes away from `in_review` |
| `changes_requested:<milestone>` | the milestone's status changes again |
| `payment_proof:<payment>` | the payment leaves `pending` |
| `payment_rejected:<request>` | a new payment is submitted against that request |
| `plan_change` (a client's) | that client has no unacknowledged plan change left in the project, checked when they acknowledge |

## 5. Data

One migration, `supabase/migrations/20261111000100_notifications.sql`, following the style of `20261110000100_messages.sql` (`set search_path = ''`, explicit revoke and grant).

- **Enum `public.notification_kind`** with the ten kinds in §3.
- **Table `public.notifications`:**
  - `id`, `recipient_id` (profiles, cascade), `project_id` (projects, cascade), `kind`, `group_key`, `subject_id`, `needs_action`, `count` (default 1), `created_at`, `updated_at`, `read_at`.
  - `data jsonb` snapshots what the sentence needs: the milestone, update or document title, the amount and currency, the review comment, and the actor's name from `public.display_name(uuid)`.
  - Index on `(recipient_id, updated_at desc)`.
  - No retention rule yet. The list query is capped at 50 rows.
- **Security:**
  - RLS lets a user select only rows where `recipient_id = auth.uid()`.
  - `authenticated` has no insert, update or delete grant on the table. Only triggers write.
  - Reads change through two RPCs, which are security definer and touch only the caller's rows:
    - `mark_notifications_read(p_ids uuid[])`.
    - `mark_all_notifications_read()`, which marks only unread rows with `needs_action = false`.
  - The RPCs are executable by `authenticated` and `service_role`, and revoked from `public` and `anon`.
- **Trigger functions**, security definer with execute revoked from `public`, `anon` and `authenticated` (the rule from commit c57164b):
  - `notify_from_activity()` on `public.activity` insert does the fan-out and the auto-resolve.
  - `notify_from_ack()` on `public.plan_change_acks` insert.
- **Realtime:** `public.notifications` is added to `supabase_realtime`, guarded like the messages migration.

## 6. Frontend

- **API:** `src/api/notifications.ts` with `listNotifications()` (the latest 50 by `updated_at`), `unreadNotificationCount()`, `markNotificationsRead(ids)` and `markAllNotificationsRead()`. `qk.notifications()` is added to `src/api/keys.ts`.
- **Text:** `src/lib/describeNotification.ts` turns kind, data and count into the sentence and the target tab. Example: "Acme sent a payment proof for Deposit, PHP 35,000.00". It reuses `formatMoney` and `formatDate` from `src/lib/format.ts`.
- **Live updates:** `src/realtime/useNotificationsRealtime.ts` mirrors `useUnreadRealtime`. It listens for changes on `notifications` filtered to `recipient_id=eq.<user id>` and invalidates `qk.notifications()`. It is mounted in `AppShell` beside `useUnreadRealtime`.
- **The bell**, `src/shell/NotificationBell.tsx`, sits in the `AppShell` header between the nav and the account menu.
  - **Button:** a bell icon with the existing `UnreadBadge`, `aria-label` "Notifications, N unread", and `aria-expanded`.
  - **Panel:** a popover anchored right on desktop, and a full-width sheet under the header below 640px with no horizontal scroll.
  - **Sections:** "Needs you" (unread action items), "New" (other unread items) and "Earlier" (read).
  - **Items:** each shows the sentence, the project title and the time. Action items carry the printed words "Action needed", never colour alone.
  - **Clicking:** an info item is marked read and opens `/projects/:id/<tab>`. An action item only navigates, since it clears itself when the action is done. It also has a small "Dismiss" for the rare case it never will.
  - **"Mark all read"** covers info items only.
  - **States:** distinct loading, error with Retry, and empty ("You're all caught up.") states through `AsyncView`. A query that never completes must not show the empty state.
  - **Keyboard:** the whole flow works by keyboard. Escape closes the panel only when focus is inside it, and returns focus to the bell. A click outside closes it.

## 7. Testing

- **Database tests (pgTAP):** `supabase/tests/database/notifications.test.sql`.
  - Each row of §3 creates the right kind for the right recipients, and the actor gets nothing.
  - A setup project creates nothing, and an inactive client gets nothing.
  - A plan import with 3 changes gives one row with count 3.
  - Each auto-resolve rule in §4 fires.
  - Client B can't see client A's rows and can't insert or update directly.
  - The RPCs touch only the caller's own rows.
  - `function_grants.test.sql` is extended with the two new trigger functions.
- **Unit tests (Vitest):**
  - The text for every kind and count.
  - The bell's loading, error and empty states, including a never-resolving query.
  - The "Action needed" words, mark all read, click to navigate and mark read, Escape only when focus is inside, and Dismiss.
  - The realtime hook, mirroring `useUnreadRealtime.test.tsx`.
- **End-to-end (Playwright, two browsers):** `e2e/notifications.spec.ts`, with seed and cleanup like `e2e/messages.spec.ts`.
  - The admin moves a milestone to in review, and the client's bell updates live with "Action needed".
  - The client approves: their item clears, and the admin gets "approved".
  - At phone width the panel doesn't scroll sideways.
- **Manual:** two browsers on `npm run dev`, walking every row of §3.

## 8. Rollout

Local first. Pushing the migration to the hosted project (`npx supabase db push --remote --yes`), checking `npx supabase db advisors --remote`, and merging to `main` each need CJ's OK.

## 9. Out of scope

- Email, push, SMS, and scheduled reminders ("payment due in 3 days", "waiting on you for 3 days").
- Notifications for messages and for task changes.
- Per-event preferences, and a retention rule for old rows.

## 10. Later: email as a second channel

The same table feeds it, so nothing here is rebuilt.
- An `emailed_at` column, and a scheduled edge function that emails rows still unread after about 10 minutes. This is the bundling CJ approved.
- A one-switch preference on `profiles`, and an unsubscribe link in every email.
- The sending provider is chosen once CJ has a domain.
