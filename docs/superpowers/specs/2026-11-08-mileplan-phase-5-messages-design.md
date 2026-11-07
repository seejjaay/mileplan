# MilePlan Phase 5 — Messages: Design Spec

**Date:** 2026-11-08 · **Owner:** CJ · **Status:** draft for review
**Parent spec:** `2026-11-05-mileplan-design.md` (§2 step 7, §4, §5, §6, §8, §12–§14)

## 1. Intent
Finish v1. Messages are the one part of the parent spec still unbuilt: phase 1 planned the Messages UI as phase 4, and plan import took that slot. After this phase, CJ and the client never have to leave MilePlan to talk about the project.

**Success looks like:**
- Either side sends a message and the other sees it within a second, without a reload.
- Nobody misses a message: unread counts show on the project cards and on the Messages tab, and clear only when the message has actually been seen.
- The thread stays usable on a phone, by keyboard, and for 30 days after close.

**Decided with CJ:**
- Phase 5 is messages only. Deploy is next; email notifications come after.
- Plain text with autolinks, not Markdown.
- The thread is kept live by patching the query cache from realtime events (not by invalidation).

**Assumptions (stated, not asked):**
- Attachments are in scope, using the same rules as other uploads.
- No delete. The thread is a record of the engagement.
- No read receipts, no typing indicator.
- Messages stay out of the Timeline, which tracks plan and work events.

## 2. What already exists (don't rebuild)
- Tables `messages` and `message_reads`, with RLS: read by `can_see`, insert with `sender_id = self`, update own `body` within 15 minutes, admin all. `message_reads` is own rows only. (`20261105000200_tracker_tables.sql`)
- The 30-day post-close window: `project_accepts_messages()` and the close-lock trigger on `messages`, plus the `attachments` bucket insert policy. (`20261108000200_close_lock.sql`)
- The private `attachments` bucket and its read policy. (`20261105000300_storage.sql`)
- UI and helpers: `AsyncView`, `Field`, `Button`, `useToast`, `validateUpload` / `ACCEPT_ATTR`, `signedUrl` / `openUrl`, the attachment chips in `UpdatesTab.tsx`, `toUserMessage`, `useEntityNames`, `useProjectRealtime` (including the stream-live refetch from `56e0e30`).

## 3. Database (`20261110000100_messages.sql`)
1. **Body:** check constraint `char_length(btrim(body)) between 1 and 4000`. Every message has text; attachments alone are not a message.
2. **Attachments:** a `BEFORE INSERT` trigger validates `attachments`:
   - a JSON array of at most 5 items;
   - each item is an object with exactly the keys `path` (text), `name` (text, 1–200 chars), `size` (integer, 1–10 485 760) and `mime` (text);
   - `path` starts with `<project_id>/`, has no `..` segment, and the project is the message's own.
   Attachments can't change after insert: the update grant covers `body` only.
3. **`edited_at` is server-owned:** a `BEFORE UPDATE` trigger sets `edited_at = now()` when `body` changes and keeps the old value otherwise. The column grant becomes `update (body)`, so a client can't write `edited_at` directly.
4. **`mark_messages_read(p_project_id uuid)`** (`security invoker`): upserts the caller's `message_reads` row with `last_read_at = now()`. Server time, so a skewed client clock can't hide or resurrect unread messages. Fails with `42501` if the caller can't see the project.
5. **`unread_message_counts()`** returns `table (project_id uuid, unread int)` for every project the caller can see: messages where `sender_id <> auth.uid()` and `created_at > coalesce(last_read_at, '-infinity')`. Projects with zero unread are omitted. It uses `messages_project_idx` and stays `security invoker`, so RLS does the scoping.
6. **Realtime:** make sure `public.messages` is in the `supabase_realtime` publication (add it if missing, idempotently).

## 4. Data layer (`src/api/messages.ts`)
Follows `updates.ts`.
- `MessageRow`: `id, created_at, project_id, sender_id, body, attachments, edited_at`.
- `listMessages(projectId, before?: { created_at: string; id: string })`: 50 rows ordered `created_at desc, id desc`. Older pages use the keyset `(created_at, id) < (before.created_at, before.id)`, so messages sharing a timestamp at a page boundary are neither skipped nor repeated.
- `sendMessage(projectId, body, files)`: uploads each file to `attachments/<project_id>/<uuid>-<name>` through `storage.ts`, then inserts and returns the row. If the insert fails, the uploaded files are removed (best effort).
- `editMessage(id, body)`: returns the updated row.
- `markRead(projectId)` and `unreadCounts()`: wrap the two RPCs.
- Keys: `qk.messages(projectId)` (an infinite query) and `qk.unread()`.

## 5. Thread UI
**Tab.** `messages` (label "Messages") goes into `tabs.ts` between Payments and Timeline. The label shows the unread count as a printed number, not a dot alone.

**`MessagesTab.tsx`:**
- **States:** a skeleton while loading, an error with Retry, and "No messages yet" only after data has arrived and is genuinely empty.
- **Layout:** oldest at the top, newest at the bottom, composer pinned below. A day separator appears between days.
- **Scroll:**
  - It opens at the bottom.
  - New messages keep you at the bottom if you are there. If you've scrolled up, a "New messages ↓" pill appears instead.
  - Reaching the top loads the previous 50, with a "Load earlier" button as the keyboard path. Scroll position holds when a page is prepended.
- **A message:**
  - Sender name, time, and "edited" when `edited_at` is set. Own messages are aligned right.
  - The body renders as React text nodes with `white-space: pre-wrap` and `overflow-wrap: anywhere`.
  - Only `http://` and `https://` URLs become links (`target="_blank" rel="noopener noreferrer"`). Trailing `.,;:!?` and an unbalanced closing `)` stay outside the link. There's no HTML parsing at all.
  - Attachments render as chips that download through a signed URL.
- **Edit:**
  - Your own message shows Edit until 15 minutes after `created_at`. The button disappears at that moment through a timer.
  - Save stays disabled until the text changes, and Esc cancels and returns focus to Edit.
  - A refusal (the window closed mid-edit) shows "The 15-minute edit window has closed" and keeps the text.
- **Composer:**
  - A labelled textarea.
  - On fine pointers, Enter sends and Shift+Enter adds a newline. On coarse pointers, Enter adds a newline and the Send button sends.
  - Attach opens a picker (`ACCEPT_ATTR`), and each file goes through `validateUpload`. Up to 5 files show as removable chips.
  - Send stays disabled while the trimmed body is empty or a send is in flight.
  - On success the composer clears and focus stays in the textarea. On failure the text and files are kept and a toast gives the reason.
- **Closed project:** if `closed_at` is set and `now < closed_at + 30 days`, a note above the composer reads "Project closed. Messages stay open until <date>". After that date, the composer is replaced by "This thread closed on <date>". The database is the authority: a refusal is shown as such.
- **Phone:** the thread fills the viewport (`dvh`), the composer stays above the on-screen keyboard, and nothing scrolls sideways.

## 6. Realtime and unread
**Thread (cache patching).**
- `useProjectRealtime` subscribes to `messages` (`project_id=eq.<id>`) with its own handler.
- INSERT: append to the newest page of `qk.messages(projectId)` unless that id is already present. This dedupes the sender's own echo, since `sendMessage` writes the returned row into the cache first.
- UPDATE: replace by id. An update to a message outside the loaded pages is ignored.
- DELETE is admin-only, has no UI, and can't be filtered by Supabase; the stream-live refetch covers it.
- `qk.messages` and `qk.unread` join `invalidateAll`, so first open, rejoin and back online all resync the thread.

**Counts.**
- `qk.unread()` feeds the admin dashboard cards, the client's project cards and the Messages tab badge.
- The app shell keeps one channel per signed-in user on `messages` INSERT with no filter (RLS limits it to visible projects). Any event invalidates `qk.unread()`.
- Mark read:
  - when the Messages tab opens;
  - when a message arrives while `document.visibilityState === 'visible'` and the thread is scrolled to the bottom (debounced 1 s);
  - when the "New messages ↓" pill is used or the user scrolls to the bottom.
  Each call sets that project's cached count to 0 at once. A hidden tab, or a thread scrolled up, stays unread.
- Own messages never count as unread. Each member of a project has their own read state.

## 7. Error handling
Per parent §13:
- `42501`/403 shows "You don't have access to this".
- A refused edit after the window says so and keeps the text.
- A network failure on send keeps the text and files, with a toast.
- A failed page load shows an inline error with Retry, and the loaded messages stay on screen.

## 8. Testing
**pgTAP (`supabase/tests/database/messages.test.sql`):**
- body: empty, whitespace-only and 4001 chars are refused; 4000 is accepted.
- attachments: a 6th item, a missing or extra key, an oversize file, a path in another project's folder and a `..` path are all refused.
- `edited_at`: set by the server on a body change, unchanged on a no-op update, not writable directly.
- edits: refused after 15 minutes and refused on someone else's message; attachments can't be updated.
- `mark_messages_read` uses server time; client B can't mark client A's project.
- `unread_message_counts`: own messages excluded, never-read counts everything, two members count independently, client B sees nothing of client A.
- realtime: `messages` is in `supabase_realtime`.
- `close_lock.test.sql` is extended to check the window on the new triggers. It isn't duplicated.

**Vitest:**
- Autolink with real pasted text: trailing punctuation, a URL in parentheses, `javascript:` and bare `www.` (neither linked), emoji, a 300-character unbroken string, blank lines between paragraphs.
- Cache patch: insert dedupe against the echo, update in place, update outside loaded pages ignored, prepended page order.
- `MessagesTab`: a never-resolving query shows the skeleton, never the empty state; an error shows Retry; the edit button disappears at 15 minutes (fake timers); Save stays disabled until dirty; a failed send keeps text and files; both closed-project messages.
- Mark-read only when visible and at the bottom.

**Integration:** a client sends and the admin receives over real Realtime. It waits for the `postgres_changes` "ok" system message, never a sleep.

**E2e (parent §14 step 7):**
- Two browsers exchange messages live, with an attachment, an edit, the unread badge rising and clearing, and the "New messages ↓" pill.
- A send done by keyboard only.
- The phone-width check covers the Messages tab.

## 9. Out of scope
- Email or push notifications (the next follow-up after deploy).
- Delete, reactions, threads or replies, read receipts, typing indicators, search, Markdown.
- Messages in the Timeline.
