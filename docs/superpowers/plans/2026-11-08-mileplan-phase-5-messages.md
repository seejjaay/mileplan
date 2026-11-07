# MilePlan Phase 5 — Messages Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
> On approval: cut branch `phase-5-messages` from `main` and execute from this file.

**Goal:** CJ and the client message each other in a live, paginated thread per project, with attachments, 15-minute edits and unread counts, open until 30 days after close.

**Architecture:**
- The database already holds `messages` and `message_reads` with RLS and the post-close window. One migration adds the remaining integrity rules (body, attachments, server-owned `edited_at`) and two RPCs (`mark_messages_read`, `unread_message_counts`).
- The thread is a react-query infinite query. Realtime INSERT and UPDATE events patch it through pure cache functions; the stream-live refetch in `useProjectRealtime` resyncs it.
- An app-shell channel keeps the unread counts fresh on every screen.

**Tech Stack:** existing (Supabase, React, TanStack Query, Vitest, pgTAP, Playwright). No new dependencies.

**Spec:** `docs/superpowers/specs/2026-11-08-mileplan-phase-5-messages-design.md` (parent: `2026-11-05-mileplan-design.md`).

## Global Constraints
- Earlier constraints still apply: `set search_path = ''` on functions, `revoke all … from public, anon` then grant to `authenticated`, the close lock raises `MP001`, every write toasts, errors go through `toUserMessage`, the entry chunk stays ≤ 200 KB gzip, every route is lazy, and nothing scrolls sideways at 375 px.
- **Body:** at least one non-whitespace character and at most 4000 characters: `check (body ~ '\S' and char_length(body) <= 4000)`. This is the spec's "trimmed length 1–4000"; `btrim` alone only strips spaces, so a body of newlines would pass it. The client sends `body.trim()`.
- **Attachments:** at most 5. Each item has exactly the keys `path`, `name` (1–200 chars), `size` (integer, 1–10485760) and `mime`. `path` starts with `<project_id>/` and has no `..` segment. Attachments can't change after insert.
- **`edited_at`** is set only by trigger. The update grant on `messages` is `body` only.
- **Pages:** 50 messages, ordered `created_at desc, id desc`, with the keyset cursor `(created_at, id)`.
- **Edit window:** 15 minutes from `created_at`. **Post-close window:** 30 days from `closed_at`, matching `project_accepts_messages`.
- **Copy (exact):**
  - Tab: "Messages". Empty: "No messages yet". Composer label: "Message". Buttons: "Send", "Attach", "Edit", "Save", "Cancel", "Load earlier".
  - Pill: "New messages ↓". Edited mark: "edited".
  - Refused edit: "The 15-minute edit window has closed".
  - Closed notes: "Project closed. Messages stay open until {d MMM}" and "This thread closed on {d MMM}".
  - Toasts: "Message sent" is **not** shown, because the message appearing in the thread is the confirmation; this is a deliberate exception to the parent spec's every-write-toasts rule. "Message edited" is shown on edit.
  - Unread on cards and tab: the count as a number, with the accessible name "{n} unread".
- **Keys** live in `src/api/keys.ts`: `qk.messages(projectId)` → `['messages', projectId]`, and `qk.unread()` → `['unread']`.

## Review Focus
1. **The sender's own realtime echo arrives before `sendMessage` resolves:** the message appears exactly once. Task 2 (`appendMessage` is idempotent in either order).
2. **A realtime INSERT arrives before the thread query has loaded:** nothing is written to the cache, and the first fetch includes the message. Task 2.
3. **A file named with more than 200 characters:** the send succeeds, and the stored `name` is cut to 200 characters (the file itself is unchanged). Task 2.
4. **Reading older messages (scrolled up) when a new one arrives:** the view doesn't move, the pill shows, and the thread isn't marked read. Task 5.
5. **The browser tab is hidden while messages arrive:** they stay unread until the tab is visible and scrolled to the bottom. Task 5.

---

### Task 1: Database rules and RPCs
**Files:**
- Create: `supabase/migrations/20261110000100_messages.sql`, `supabase/tests/database/messages.test.sql`
- Modify: `supabase/tests/database/close_lock.test.sql` (append), parent spec §5 (`messages`: the body, attachment and `edited_at` rules)

**Interfaces:**
- Produces: `public.mark_messages_read(p_project_id uuid) returns void`; `public.unread_message_counts() returns table (project_id uuid, unread int)`; both `security invoker`.

- [ ] **Step 1: Failing pgTAP tests** (`messages: <behaviour>`, using `tests.authenticate_as`):
  - Body: `''`, `'   '` and `E'\n\n'` are refused; 4001 chars are refused; 4000 are accepted.
  - Attachments: 6 items, a missing key, an extra key, `size` 10485761, `name` of 201 chars, a path under another project, and `<project>/../x` are each refused; one valid item is accepted.
  - `edited_at`: null on insert; set on a body change; unchanged by `update … set body = body`; `update … set edited_at = now()` is refused (permission denied); `update … set attachments = '[]'` is refused.
  - Edit window: the sender's edit with `created_at` set 16 minutes back (as the service role) is refused; another member's edit is refused.
  - `mark_messages_read`: writes `last_read_at = now()` for the caller; client B on client A's project raises `42501`.
  - `unread_message_counts`: own messages are excluded; never-read counts everything; after a read only newer messages count; two members of one project count independently; client B gets no row for A's project; a zero count omits the row.
  - `pg_publication_tables` has `public.messages` in `supabase_realtime`.
  - In `close_lock.test.sql`: on a project closed 29 days ago, insert and the trigger-set `edited_at` still work; at 31 days, insert is refused with `MP001`.
- [ ] **Step 2:** `npx supabase test db`. Expected: FAIL in `messages.test.sql`.
- [ ] **Step 3: Write the migration.**
  - Add the body check constraint.
  - Add `messages_validate_attachments()` as a `BEFORE INSERT` trigger. Raise `22023` with a message naming the rule, e.g. `attachments[2].path is outside this project`.
  - Add `messages_set_edited_at()` as a `BEFORE UPDATE` trigger: `new.edited_at := case when new.body is distinct from old.body then now() else old.edited_at end`.
  - `revoke update on public.messages from authenticated; grant update (body) on public.messages to authenticated;`
  - Add both RPCs. `mark_messages_read` raises `42501` unless `public.can_see(p_project_id)`, then upserts on `(project_id, user_id)`.
  - Add `messages` to the publication only if it's absent (a `do` block checking `pg_publication_tables`).
  - Update parent spec §5 to match.
- [ ] **Step 4:** `npx supabase db reset && npx supabase test db && npx supabase db lint`. Expected: PASS, lint clean.
- [ ] **Step 5:** Commit `feat(db): message rules, server-owned edited_at, read and unread RPCs`.

### Task 2: Data layer and cache patching
**Files:**
- Create: `src/api/messages.ts`, `src/api/messages.test.ts`, `src/api/messageCache.ts`, `src/api/messageCache.test.ts`
- Modify: `src/api/keys.ts`

**Interfaces:**
- Consumes: Task 1's RPCs; `uploadTo`, `removeObjects` and `Attachment` from `src/api/storage.ts`.
- Produces:
  - `type MessageRow = { id: string; created_at: string; project_id: string; sender_id: string; body: string; attachments: Attachment[]; edited_at: string | null }`
  - `type Cursor = { created_at: string; id: string }`
  - `listMessages(projectId: string, before?: Cursor): Promise<MessageRow[]>` (newest first, ≤ 50)
  - `sendMessage(input: { projectId: string; senderId: string; body: string; files: File[] }): Promise<MessageRow>`
  - `editMessage(id: string, body: string): Promise<MessageRow>`
  - `markRead(projectId: string): Promise<void>` and `unreadCounts(): Promise<Record<string, number>>`
  - `type Thread = InfiniteData<MessageRow[], Cursor | undefined>`
  - `appendMessage(t: Thread | undefined, m: MessageRow): Thread | undefined`
  - `replaceMessage(t: Thread | undefined, m: MessageRow): Thread | undefined`
  - `threadOrder(t: Thread): MessageRow[]` (oldest → newest)
  - `nextCursor(lastPage: MessageRow[]): Cursor | undefined` (undefined when the page has fewer than 50)

- [ ] **Step 1: Failing tests.**
  - `messages.test.ts` (supabase mocked, as in `updates.test.ts`):
    - `listMessages` without a cursor orders `created_at desc, id desc` and limits 50.
    - With a cursor it filters by `.or('created_at.lt.<c>,and(created_at.eq.<c>,id.lt.<id>)')`.
    - `sendMessage` trims the body, uploads each file, cuts `name` to 200 chars, inserts with `sender_id`, and returns the row.
    - If the insert fails, `removeObjects('attachments', paths)` is called and the error is rethrown.
    - `unreadCounts` maps rows to `{ [project_id]: unread }`.
  - `messageCache.test.ts`:
    - `appendMessage(undefined, m)` returns `undefined`.
    - Appending puts `m` first in `pages[0]`.
    - Appending an id already in any page returns the same object (`toBe`), whether the echo or the mutation comes first.
    - `replaceMessage` swaps by id across pages and returns the same object when the id isn't loaded.
    - `threadOrder` over two pages is oldest → newest.
    - `nextCursor` of 50 rows is the last row's `(created_at, id)`; of 49 rows it's `undefined`.
- [ ] **Step 2:** `npx vitest run src/api/messages src/api/messageCache`. Expected: FAIL (modules missing).
- [ ] **Step 3:** Implement. Follow `updates.ts` for the supabase calls and errors. The cache functions are pure and never mutate their input.
- [ ] **Step 4:** Same command. Expected: PASS.
- [ ] **Step 5:** Commit `feat(messages): data layer and thread cache patching`.

### Task 3: Realtime and unread counts on the cards
**Files:**
- Create: `src/realtime/useUnreadRealtime.ts`, `src/realtime/useUnreadRealtime.test.tsx`, `src/api/useUnreadCounts.ts`, `src/ui/UnreadBadge.tsx`
- Modify: `src/realtime/useProjectRealtime.ts` (+ test), `src/shell/AppShell.tsx`, `src/pages/admin/DashboardPage.tsx` (+ test), `src/pages/client/MyProjectsPage.tsx` (+ test)

**Interfaces:**
- Consumes: Task 2's `appendMessage`, `replaceMessage`, `unreadCounts`, `MessageRow`; `qk.messages` and `qk.unread`.
- Produces:
  - `useUnreadCounts(): Record<string, number>` (`{}` while loading or on error, so a card never shows a false count)
  - `useUnreadRealtime(userId: string | undefined): void`
  - `UnreadBadge({ count }: { count: number })` in `src/ui/UnreadBadge.tsx`. It renders nothing at 0, otherwise the number with `aria-label="{n} unread"`.

- [ ] **Step 1: Failing tests.**
  - `useProjectRealtime.test.tsx`:
    - It subscribes to `messages` with `project_id=eq.p1`.
    - A `messages` INSERT calls `setQueryData(qk.messages('p1'), …)` with the appended row and does **not** invalidate `qk.messages`.
    - An UPDATE replaces the row.
    - The stream-live "ok" invalidates `qk.messages('p1')` and `qk.unread()`.
  - `useUnreadRealtime.test.tsx`:
    - It opens one channel listening to `postgres_changes` INSERT on `messages` with no filter.
    - An event invalidates `qk.unread()`.
    - Unmount removes the channel; `undefined` userId opens nothing.
  - `DashboardPage.test.tsx` and `MyProjectsPage.test.tsx`:
    - With `unreadCounts` resolving `{ p1: 3 }`, the p1 card shows "3" with accessible name "3 unread".
    - A project absent from the map shows no badge.
- [ ] **Step 2:** `npx vitest run src/realtime src/pages/admin/DashboardPage src/pages/client/MyProjectsPage`. Expected: FAIL.
- [ ] **Step 3:** Implement.
  - In `useProjectRealtime`, `messages` gets its own handler (not `keysFor`). INSERT goes through `appendMessage` and UPDATE through `replaceMessage`. Add `qk.messages(projectId)` and `qk.unread()` to `invalidateAll`.
  - `AppShell` calls `useUnreadRealtime(user?.id)` with channel name `unread:<userId>`.
  - Both card pages render `UnreadBadge` next to the status chip.
- [ ] **Step 4:** Same command. Expected: PASS.
- [ ] **Step 5:** Commit `feat(messages): live thread patching and unread counts on project cards`.

### Task 4: Message rendering and editing
**Files:**
- Create: `src/lib/linkify.ts`, `src/lib/linkify.test.ts`, `src/pages/project/messages/MessageItem.tsx`, `src/pages/project/messages/MessageItem.test.tsx`

**Interfaces:**
- Consumes: Task 2's `MessageRow` and `editMessage`; `signedUrl` and `openUrl`; `useEntityNames` for sender names.
- Produces:
  - `type Segment = { kind: 'text'; text: string } | { kind: 'link'; text: string; href: string }`
  - `linkify(text: string): Segment[]`
  - `canEditUntil(m: MessageRow): number` (epoch ms: `created_at` + 15 min)
  - `MessageItem({ message, own, onEdited }: { message: MessageRow; own: boolean; onEdited: (m: MessageRow) => void })`

- [ ] **Step 1: Failing tests.**
  - `linkify.test.ts`:
    - `'see https://x.dev.'` gives a link `https://x.dev` followed by the text `.`.
    - `'(https://x.dev/a_(b))'` keeps the balanced `)` inside the link and the outer `)` outside.
    - `'https://x.dev, then'` leaves the `,` outside.
    - `'javascript:alert(1)'`, `'www.x.dev'` and `'ftp://x'` give text only.
    - Two URLs in one line give two links.
    - `'a\n\nb'`, emoji, and a 300-char unbroken string round-trip as text unchanged.
  - `MessageItem.test.tsx`:
    - The body renders through `linkify`, and a link has `target="_blank"` and `rel="noopener noreferrer"`.
    - A body `'<b>x</b>'` renders as literal text.
    - "edited" shows when `edited_at` is set.
    - An attachment chip downloads through `signedUrl('attachments', path, name)`.
    - Own message: Edit is visible, then gone after `vi.advanceTimersByTime` past 15 minutes. It's never visible on another person's message.
    - Save is disabled until the text changes, and Esc cancels and returns focus to Edit.
    - `editMessage` rejecting with the policy error shows the toast "The 15-minute edit window has closed" and keeps the textarea text.
    - Success calls `onEdited` and toasts "Message edited".
- [ ] **Step 2:** `npx vitest run src/lib/linkify src/pages/project/messages/MessageItem`. Expected: FAIL.
- [ ] **Step 3:** Implement.
  - `linkify`: match `/https?:\/\/[^\s<>"]+/g`. Then trim trailing `[.,;:!?]` and any `)` that has no matching `(` inside the match, and return the trimmed tail as text.
  - `MessageItem`: renders segments as React nodes only. The body has `whitespace-pre-wrap [overflow-wrap:anywhere]`. Own messages are aligned right. A refused edit (an empty update result, or `42501`) maps to the window-closed copy.
- [ ] **Step 4:** Same command. Expected: PASS.
- [ ] **Step 5:** Commit `feat(messages): message rendering with autolinks, attachments and 15-minute edit`.

### Task 5: Messages tab: thread, composer, read state
**Files:**
- Create: `src/pages/project/messages/MessagesTab.tsx` (+ test), `src/pages/project/messages/Composer.tsx` (+ test), `src/pages/project/messages/useStickToBottom.ts` (+ test), `src/lib/messageWindow.ts` (+ test)
- Modify: `src/pages/project/tabs.ts` (insert `{ key: 'messages', label: 'Messages' }` between payments and timeline), `src/pages/project/ProjectPage.tsx` (lazy route + `UnreadBadge` on the tab), `src/pages/project/ProjectPage.test.tsx`

**Interfaces:**
- Consumes: Tasks 2–4 (`listMessages`, `sendMessage`, `markRead`, `threadOrder`, `nextCursor`, `appendMessage`, `replaceMessage`, `useUnreadCounts`, `UnreadBadge`, `MessageItem`); `validateUpload`, `ACCEPT_ATTR`, `AsyncView`, `useToast`, `useAuth`.
- Produces:
  - `messageWindow(p: { status: string; closed_at: string | null }, now: Date): { open: boolean; until: Date | null }`
  - `useStickToBottom(ref: RefObject<HTMLElement>): { atBottom: boolean; scrollToBottom: () => void; keepPositionWhilePrepending: () => () => void }`. "At bottom" means within 48 px.

- [ ] **Step 1: Failing tests.**
  - `messageWindow.test.ts`:
    - Active gives `{open: true, until: null}`.
    - Closed 29 days ago gives `open: true` with `until` = `closed_at` + 30 days.
    - Closed 31 days ago gives `open: false`.
  - `useStickToBottom.test.ts` (stub `scrollHeight`, `clientHeight` and `scrollTop`):
    - `atBottom` is true within 48 px and false beyond.
    - `keepPositionWhilePrepending()` returns a restore function that keeps the distance from the bottom after `scrollHeight` grows.
  - `Composer.test.tsx`:
    - Send is disabled for `'  \n '`.
    - Enter sends on `(pointer: fine)` and inserts a newline on `(pointer: coarse)` (stub `matchMedia`); Shift+Enter always inserts a newline.
    - A file that fails `validateUpload` shows its message and isn't added.
    - A 6th file is refused.
    - A failed send keeps text and chips and toasts the reason.
    - Success clears and keeps focus in the textarea.
  - `MessagesTab.test.tsx`:
    - A never-resolving query shows the skeleton, never "No messages yet". A rejected query shows Retry. An empty list shows "No messages yet".
    - Messages render oldest → newest with a day separator between days.
    - "Load earlier" calls `listMessages` with `nextCursor` of the oldest page.
    - Opening the tab calls `markRead('p1')` once and sets `qk.unread()` p1 to 0.
    - A new message while `atBottom` and visible calls `markRead` after 1 s (fake timers).
    - A new message while scrolled up shows "New messages ↓" and doesn't call `markRead`; clicking the pill scrolls down and calls it. (Review Focus 4)
    - Scrolling back to the bottom after the pill appeared calls `markRead` and hides the pill.
    - A failed "Load earlier" shows an inline error with Retry, and the loaded messages stay on screen.
    - A new message while `document.visibilityState` is `'hidden'` doesn't call `markRead`; a later `visibilitychange` to visible at the bottom does. (Review Focus 5)
    - With `messageWindow` open and `until` set, the note reads "Project closed. Messages stay open until …". When closed, the composer is replaced by "This thread closed on …".
  - `ProjectPage.test.tsx`:
    - The Messages tab sits between Payments and Timeline.
    - With unread `{ p1: 2 }` the tab shows "2" with accessible name "2 unread", and no badge while on the Messages tab itself.
- [ ] **Step 2:** `npx vitest run src/pages/project src/lib/messageWindow`. Expected: FAIL.
- [ ] **Step 3:** Implement.
  - `MessagesTab` uses `useInfiniteQuery({ queryKey: qk.messages(id), queryFn: ({ pageParam }) => listMessages(id, pageParam), initialPageParam: undefined, getNextPageParam: nextCursor })`.
  - Its layout is a flex column at `h-[calc(100dvh-<shell offset>)]` with the list `overflow-y-auto`. Reaching the top uses an `IntersectionObserver` sentinel, plus the "Load earlier" button.
  - On send success, write `appendMessage` into the cache, then `scrollToBottom`.
  - Mark-read is debounced 1 s and gated on `atBottom && document.visibilityState === 'visible'`.
- [ ] **Step 4:** Same command, then `npm run typecheck && npm run lint`. Expected: PASS, clean.
- [ ] **Step 5:** Commit `feat(messages): messages tab with live thread, composer and read state`.

### Task 6: Live round trip, e2e and the full gate
**Files:**
- Create: `tests/integration/messages.test.ts`, `e2e/messages.spec.ts`
- Modify: `e2e/tracker.spec.ts` (the phone-width test also opens `/projects/:id/messages`), parent spec §14 step 7 (name the spec file)

**Interfaces:**
- Consumes: everything above; `signIn` and `adminServiceClient` from `tests/integration/env.ts`; the `listen()` pattern in `tests/integration/realtime.test.ts`; seed and cleanup per `e2e/live.spec.ts:15-43`.

- [ ] **Step 1: Write the tests.**
  - `messages.test.ts`:
    - Ana sends to her project; the admin's channel (ready on the `postgres_changes` "ok" system message, no sleep) receives the INSERT.
    - Ben's channel receives nothing within 3 s.
    - `unread_message_counts()` as the admin shows 1 for the project, then 0 after `mark_messages_read`.
  - `messages.spec.ts` (two contexts, admin and Ana):
    - Ana sends "Hi, link https://example.com." with a PDF. The admin sees it live with a link and a chip, and the dashboard card shows "1 unread" before the tab is opened.
    - The admin opens Messages, the badge clears, and the admin replies. Ana edits her message within the window and the admin sees "edited".
    - With the admin scrolled up (after seeding 60 messages), a new message from Ana shows "New messages ↓".
    - Keyboard only (Tab to the composer, type, Enter): a message is sent.
- [ ] **Step 2:** `npm run test:integration && npx playwright test e2e/messages.spec.ts`. Expected: PASS. Then force-fail one assertion once to confirm the failure is reported in seconds and cleanup still runs, and revert.
- [ ] **Step 3: Full gate:**
  - `npm run typecheck && npm run lint && npm test && npx supabase test db && npx supabase db lint && npm run test:integration && npm run build`. Expected: all pass. The build output's entry chunk is ≤ 200 KB gzip.
  - `npx playwright test --repeat-each=5 --workers=1`. Expected: all pass.
  - Supabase security advisors clean (`get_advisors` for security).
- [ ] **Step 4: Manual:**
  - At 375 px: the thread fills the screen, the composer stays above the keyboard, and nothing scrolls sideways.
  - Keyboard only: send, edit, Esc, "Load earlier", the pill.
  - Dark mode.
- [ ] **Step 5:** Commit `test(messages): realtime round trip, two-browser e2e and phone check`.

## Reused (don't rebuild)
- Uploads and downloads: `uploadTo`, `removeObjects`, `signedUrl` (`src/api/storage.ts`), `validateUpload` and `ACCEPT_ATTR` (`src/lib/validateUpload.ts`), `openUrl`, and the attachment chip markup in `src/pages/project/UpdatesTab.tsx`.
- UI and state: `AsyncView`, `Button`, `Field`, `useToast`, `toUserMessage` / `NO_ACCESS`, `useEntityNames`, `useAuth`.
- Realtime: `useProjectRealtime` and its stream-live refetch (`56e0e30`); the `listen()` readiness pattern in `tests/integration/realtime.test.ts`.
- Database: `can_see`, `is_admin`, `project_accepts_messages`, `path_project_id`, and the existing `messages` / `message_reads` RLS and close-lock triggers.

## Verification
- `npx supabase test db`: `messages.test.sql` covers every rule in Task 1, and `close_lock.test.sql` covers the 30-day window on the new triggers.
- `npm test`: the cache, linkify, window, scroll, composer and tab tests, including Review Focus 1–5.
- `npm run test:integration`: the live round trip and RLS isolation over Realtime.
- `npx playwright test --repeat-each=5 --workers=1`, then the manual pass in Task 6.
