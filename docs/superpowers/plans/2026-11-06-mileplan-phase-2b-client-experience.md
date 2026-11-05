# MilePlan Phase 2b — Client Experience Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (CJ chose Native/inline execution) to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
> On approval, copy this file to `docs/superpowers/plans/2026-11-06-mileplan-phase-2b-client-experience.md` and execute it from there on a new branch, `phase-2b-client-experience`, cut from `main` (`25e1f65`).

## Context
Phase 2a (merged and pushed at `25e1f65`) gave CJ the full admin tracker. Clients can see a project, but they can't act on it, and they only see changes after a reload.

Phase 2b delivers the spec's client side:
- **Live sync**, plus a "Reconnecting…" pill when the connection drops.
- **Plan-change banner:** the client acknowledges plan changes, and CJ sees who acknowledged.
- **Milestone review:** Approve or Request changes.
- **"Updated since your last visit" markers.**
- **The route-line signature visuals.**

It also fixes two things 2a deferred:
- A live refetch would wipe a milestone row CJ is editing.
- Clients see "Project team" instead of CJ's name.

**CJ's decisions for this phase:**
- Request changes sends the milestone back to **In progress**.
- Clients may see the **admin's name** (name only), through a narrow database helper.

**Goal:** a client watching their project sees CJ's edits arrive live, acknowledges plan changes, and approves or rejects deliverables. CJ sees all of that live as well.

**Architecture:**
- One Supabase Realtime channel per open project. `postgres_changes` (Realtime events for row inserts, updates and deletes) is filtered by `project_id` and invalidates the matching `qk.*` keys. Realtime enforces RLS, so the database stays the only access gate.
- Review effects (approve, or request changes) run in a `security definer` trigger on `milestone_reviews`, so a client never needs `UPDATE` on `milestones`.
- Names reach clients through PostgREST computed fields (`author_name`, `actor_name`) backed by one security-definer helper. Clients never get read access to the admin's profile row.

**Tech Stack:** the Phase 1 and 2a stack. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-11-05-mileplan-design.md`. This plan covers:
- §4: client actions, the last-visit marker, and phone stacking.
- §5: the approval rule from a client review.
- §8: realtime and the plan-change banner.
- §11: route line and motion.
- §13: the Realtime disconnect pill.
- §14: e2e steps 4, 6 and 8 (minus payments).

Deferred: payment and message realtime (Phases 3 and 4, when their UIs exist).

## Global Constraints
- All Phase 1 and 2a Global Constraints still apply.
- **Realtime:**
  - Tables added to `supabase_realtime`: `projects`, `milestones`, `tasks`, `updates`, `documents`, `activity`, `plan_change_acks`, `milestone_reviews`.
  - The channel name is `project:${projectId}`. The filter is `project_id=eq.${id}`; the `projects` table uses `id=eq.${id}`. `plan_change_acks` and `milestone_reviews` have no `project_id`, so they get no filter and RLS limits them.
  - On re-subscribe after a drop, refetch every project key.
  - Show the pill only after the channel has been subscribed once and then left `SUBSCRIBED` for more than 1.5 s.
- **Reviews:**
  - `approved` sets the milestone to `approved` (the existing guard stamps `approved_by` with the client).
  - `changes_requested` sets it to `in_progress` and needs a non-empty comment, enforced by a DB check.
- **Acknowledge:** one click inserts an ack for exactly the activity ids the banner showed, with `ON CONFLICT DO NOTHING`.
- **Last visit:**
  - On opening a project, a client keeps their previous `last_seen_at` for the whole visit, then sets `last_seen_at = now()`.
  - Admins have no member row, so they get no markers.
  - The client's own actions never mark anything.
- **Motion:**
  - Only `transform` and `opacity` animate.
  - The route line draws forward with `scaleX` (`scaleY` when the strip is stacked vertically).
  - A marker "ticks" (one short scale pulse) when its milestone's status changes while the page is open.
  - The global reduced-motion rule from Phase 1 flattens all of it.
- **Copy (exact):**
  - Pill: "Reconnecting…".
  - Banner heading: "The plan changed".
  - Banner button: "Acknowledge".
  - Admin acknowledgement: "Acknowledged by {name} · {Nov 6, 14:02}", or "Not yet acknowledged".
  - Already-reviewed error: "This milestone was already reviewed."
  - Marker chip: "Updated".

## Review Focus
1. **A live refetch while CJ is mid-edit:** the row keeps CJ's typing and shows "Changed elsewhere", with a button to load the new values. Covered in Task 3.
2. **Two client members review the same milestone at once:** the second gets "This milestone was already reviewed." (not the generic no-access copy), and the list refetches. Covered in Task 6.
3. **A new plan change arrives while the banner is open:** Acknowledge acks only the rows that were displayed, and the new one stays in the banner. Covered in Task 4.
4. **The Realtime connection drops and returns:** the pill shows and then hides, and every project query refetches, so nothing missed while offline stays stale. Covered in Task 2 (unit) and Task 9 (e2e with `setOffline`).
5. **A client subscribes to another client's project id:** they receive no events, because Realtime applies RLS. Covered in Task 1 (integration).

---

### Task 1: Realtime publication, review trigger, name helper

**Files:**
- Create: `supabase/migrations/20261107000100_client_experience.sql`, `supabase/tests/database/reviews.test.sql`, `supabase/tests/database/names.test.sql`, `tests/integration/realtime.test.ts`

**Interfaces:**
- Produces:
  - `alter publication supabase_realtime add table …` for the eight tables in Global Constraints.
  - A check on `milestone_reviews`: `decision <> 'changes_requested' or length(trim(comment)) > 0`.
  - Trigger `milestone_reviews_apply` (`AFTER INSERT`, security definer):
    - `approved` updates the milestone status to `approved`.
    - `changes_requested` updates it to `in_progress`.
    - Neither leaks a reason (it sets `mileplan.reason` to `''`).
  - `public.display_name(p_user uuid) returns text` (security definer). It returns `full_name` when the target is an admin, the caller themself, the caller is an admin, or the two share a visible project (reuse `shares_visible_project`). Otherwise it returns null.
  - Computed fields `public.author_name(public.updates) returns text` and `public.actor_name(public.activity) returns text`, both wrapping `display_name`.

- [ ] **Step 1: Failing pgTAP tests.**
  - `reviews.test.sql`:
    - `approve moves milestone to approved, approved_by is the client`
    - `request changes moves milestone to in_progress`
    - `request changes without a comment fails` (23514)
    - `a second review after approval is denied` (42501)
    - `the review and the status change both appear in activity with the client as actor`
    - `review leaves no edit reason behind`
  - `names.test.sql`:
    - `client reads admin name via display_name`
    - `client reads co-member name`
    - `client gets null for an unrelated client`
    - `client still cannot select the admin profile row` (0 rows)
- [ ] **Step 2: Failing integration test** `tests/integration/realtime.test.ts`:
  - `member receives a milestone change for their project`: Ana subscribes to P1, the service client updates a P1 milestone, and an event arrives within 5 s.
  - `non-member receives nothing`: Ben subscribes with the P1 filter, the same update happens, and no event arrives in 3 s.
- [ ] **Step 3:** Run `npx supabase test db && npm run test:integration -- realtime`. Expected: FAIL.
- [ ] **Step 4:** Write the migration.
- [ ] **Step 5:** Run `npx supabase db reset && npx supabase test db && npm run test:integration`. Expected: all PASS, Phase 1 and 2a included.
- [ ] **Step 6:** Commit `feat(db): realtime publication, client review effects, display names`

---

### Task 2: Project realtime hook and the Reconnecting pill

**Files:**
- Create: `src/realtime/useProjectRealtime.ts`, `src/realtime/ReconnectingPill.tsx`
- Modify: `src/api/keys.ts` (add `qk.planChanges(id)`, `qk.reviews(id)`, `qk.lastVisit(id)`), `src/pages/project/ProjectPage.tsx`
- Test: `src/realtime/useProjectRealtime.test.tsx`

**Interfaces:**
- Consumes: `qk.*` and `supabase`.
- Produces:
  - `useProjectRealtime(projectId): { connected: boolean; reconnecting: boolean; lastChange: { table: string; id: string } | null }`. `lastChange` feeds the marker tick.
  - Table-to-keys map:

    | Table | Invalidates |
    |---|---|
    | `milestones`, `tasks` | `milestones`, `project`, `projects` |
    | `updates` | `updates` |
    | `documents` | `documents` |
    | `activity` | `activity`, `planChanges` |
    | `plan_change_acks` | `planChanges` |
    | `milestone_reviews` | `reviews`, `milestones` |
    | `projects` | `project`, `projects` |

  - When the channel reaches `SUBSCRIBED` again after a drop, it invalidates every key for the project.
  - `<ReconnectingPill visible />` is a fixed `role="status"` pill reading "Reconnecting…".

- [ ] **Step 1: Failing tests** with a fake channel (`vi.mock('../lib/supabase')`, capturing `.on()` handlers and the `.subscribe()` status callback):
  - `a milestones event invalidates milestones and project keys`
  - `an activity event invalidates planChanges`
  - `re-subscribe after CHANNEL_ERROR refetches every project key`
  - `pill hidden on first connect, shown after 1.5 s disconnected, hidden on reconnect` (fake timers)
  - `channel removed on unmount`
- [ ] **Step 2:** Run `npm test`. Expected: FAIL.
- [ ] **Step 3:** Implement the hook and the pill, and mount both in `ProjectPage`.
- [ ] **Step 4:** Run `npm test`. Expected: PASS.
- [ ] **Step 5:** Commit `feat(realtime): live project sync with reconnect refetch and pill`

---

### Task 3: Live-safe milestone editing

**Files:**
- Modify: `src/pages/project/milestones/MilestoneRow.tsx`, `src/pages/project/milestones/MilestonesTab.tsx` (key rows by `id` only)
- Test: `src/pages/project/milestones/MilestoneRow.test.tsx`

**Interfaces:**
- `MilestoneRow` tracks `base` (the saved values its draft started from):
  - When the `milestone` prop changes and the row is clean, the draft resets silently.
  - When the row is dirty, it keeps the draft and shows "Changed elsewhere" with a "Load latest" button.
  - Use the React "adjust state when a prop changes" pattern (compare during render). It must not use `setState` inside an effect.

- [ ] **Step 1: Failing tests:**
  - `clean row picks up new saved values`
  - `dirty row keeps typing and shows Changed elsewhere`
  - `Load latest replaces the draft`
  - `the diff after Load latest is against the new values`
- [ ] **Step 2:** FAIL. **Step 3:** Implement. **Step 4:** PASS, and the existing `MilestonesTab` tests stay green.
- [ ] **Step 5:** Commit `fix(milestones): keep in-progress edits when the row changes elsewhere`

---

### Task 4: Plan-change banner with Acknowledge (client)

**Files:**
- Create: `src/api/planChanges.ts`, `src/pages/project/PlanChangeBanner.tsx`
- Modify: `src/pages/project/ProjectPage.tsx` (render above the tabs, on every tab)
- Test: `src/pages/project/PlanChangeBanner.test.tsx`

**Interfaces:**
- Consumes: `describeActivity` (`src/lib/formatChange.ts`), and a names map built from the milestones cache. Extract the Timeline's map into `src/pages/project/useEntityNames.ts` so both use it.
- Produces:
  - `type PlanChange = ActivityRow & { acks: { user_id: string; acked_at: string; user: { full_name: string | null } | null }[] }`.
  - `listPlanChanges(projectId): Promise<PlanChange[]>`: activity rows where `plan_change`, oldest first, with their acks.
  - `acknowledge(userId, activityIds: string[]): Promise<void>`: bulk upsert with `ignoreDuplicates`.
  - `unacknowledged(changes, userId): PlanChange[]`.
- UI:
  - The banner renders only for clients, and only while `unacknowledged(...)` is non-empty.
  - It's a `role="region"` labelled "The plan changed", listing one sentence per change.
  - Acknowledge sends the ids that were rendered, then toasts "Changes acknowledged".

- [ ] **Step 1: Failing tests:**
  - `hidden for admin`
  - `hidden when everything is acknowledged`
  - `lists each unacknowledged change in plain words with its reason`
  - `Acknowledge sends exactly the displayed ids`
  - `a change that arrives after render is not acknowledged by the earlier click`
  - `shows on every tab` (ProjectPage test)
- [ ] **Step 2:** FAIL. **Step 3:** Implement. **Step 4:** PASS.
- [ ] **Step 5:** Commit `feat(plan-changes): client banner with acknowledge`

---

### Task 5: Admin acknowledgement status and display names

**Files:**
- Modify: `src/pages/project/TimelineTab.tsx`, `src/pages/project/OverviewTab.tsx`, `src/api/activity.ts`, `src/api/updates.ts`, `src/pages/project/UpdatesTab.tsx`
- Test: extend `TimelineTab.test.tsx`, `OverviewTab.test.tsx`, `UpdatesTab.test.tsx`

**Interfaces:**
- Consumes: `listPlanChanges` (Task 4), and the computed fields `author_name` and `actor_name` (Task 1).
- `listActivity` selects `*, actor_name`, and `listUpdates` selects `*, author_name, milestone:…`. This replaces the `profiles` embeds. The fields `author`/`actor` become `author_name`/`actor_name: string | null`.
- On the Timeline, each `plan_change` row (admin only) shows one line per ack ("Acknowledged by Ana · Nov 6, 14:02"), or "Not yet acknowledged".
- On the Overview, admins get a "Pending acknowledgements" section listing plan changes that no client member has acknowledged. It isn't rendered when there are none.

- [ ] **Step 1: Failing tests:**
  - `timeline shows who acknowledged and when`
  - `timeline shows Not yet acknowledged`
  - `clients do not see acknowledgement lines`
  - `overview lists pending acknowledgements`
  - `update author shows the computed name`
- [ ] **Step 2:** FAIL. **Step 3:** Implement. **Step 4:** PASS.
- [ ] **Step 5:** Commit `feat(plan-changes): admin acknowledgement status; real names for clients`

---

### Task 6: Client milestone review (Approve / Request changes)

**Files:**
- Create: `src/api/reviews.ts`, `src/pages/project/milestones/ReviewActions.tsx`
- Modify: `MilestonesTab.tsx` (client read-only rows), `MilestoneRow.tsx` (admin sees the latest review comment)
- Test: `src/pages/project/milestones/ReviewActions.test.tsx`

**Interfaces:**
- Produces:
  - `type Review = { id; milestone_id; user_id; decision: 'approved' | 'changes_requested'; comment: string | null; created_at; reviewer_name: string | null }`.
  - `listReviews(projectId): Promise<Review[]>`: through `milestones!inner(project_id)`, newest first. `reviewer_name` is a computed field `public.reviewer_name(public.milestone_reviews)`; add it to Task 1's migration.
  - `submitReview(milestoneId, userId, decision, comment?)`.
- UI:
  - Shown only when the milestone is `in_review` and the viewer is a client: **Approve** (with a confirm `Dialog`), and **Request changes** (a `Dialog` with a required comment, submit disabled until it's non-empty).
  - On a 42501 error, toast "This milestone was already reviewed." and refetch.
  - Admin rows show the latest review, for example: "Changes requested by Dee: ‘Logo too small’".

- [ ] **Step 1: Failing tests:**
  - `actions only for in_review and only for clients`
  - `Approve asks to confirm then submits approved`
  - `Request changes requires a comment`
  - `42501 shows the already-reviewed copy and refetches`
  - `admin row shows the latest review comment`
- [ ] **Step 2:** FAIL. **Step 3:** Implement. **Step 4:** PASS.
- [ ] **Step 5:** Commit `feat(reviews): client approve and request-changes on in-review milestones`

---

### Task 7: "Updated since your last visit" markers

**Files:**
- Create: `src/lib/changedSince.ts`, `src/pages/project/useLastVisit.ts`
- Modify: `ProjectPage.tsx` (tab dots), `OverviewTab.tsx` and `MilestonesTab.tsx` (milestone "Updated" chip)
- Test: `src/lib/changedSince.test.ts`, `src/pages/project/useLastVisit.test.tsx`

**Interfaces:**
- `changedSince(rows: ActivityRow[], since: string | null, me: string, taskMilestone: Map<string, string>): { milestones: Set<string>; tabs: Set<TabKey> }`:
  - Counts rows newer than `since` and not by `me`.
  - A task row marks its milestone.
  - The tab mapping:

    | Entity | Tab |
    |---|---|
    | milestone, task, review | `milestones` |
    | update | `updates` |
    | document | `files` |
    | anything | `timeline` |

  - `since = null` (first visit) marks nothing.
- `useLastVisit(projectId)` returns `{ since: string | null }`:
  - Reads the client's own `project_members.last_seen_at` once.
  - Keeps that value for the whole visit.
  - Then updates `last_seen_at = now()`. The column grant already allows this.
  - Admins get `{ since: null }` and no write.
- Tab dots show as `•` with visually hidden "(updated)" text, so the link reads "Updates (updated)".

- [ ] **Step 1: Failing tests:**
  - `changedSince` cases:
    - `ignores my own changes`
    - `task change marks its milestone`
    - `document marks files and timeline`
    - `first visit marks nothing`
  - `useLastVisit` cases:
    - `keeps the previous value for the visit and writes now()`
    - `admin: no read, no write`
- [ ] **Step 2:** FAIL. **Step 3:** Implement. **Step 4:** PASS.
- [ ] **Step 5:** Commit `feat(markers): updated-since-your-last-visit on milestones and tabs`

---

### Task 8: Route line — the signature visual

**Files:**
- Create: `src/pages/project/RouteLine.tsx`, `src/pages/project/routeState.ts`
- Modify: `OverviewTab.tsx` (replace the plain strip), `src/styles/index.css` (keyframes)
- Test: `src/pages/project/routeState.test.ts`, `src/pages/project/RouteLine.test.tsx`

**Before Step 3:** invoke the `frontend-design:frontend-design` skill, and hold it to the Phase 1 tokens and fonts (`--accent`, `--font-display`).

**Interfaces:**
- `routeState(milestones): { id; title; kind: 'done' | 'current' | 'future'; word: string }[]`:
  - Done is `approved` or `paid`, with the word "Done".
  - Current is the first milestone that isn't done. Its word is "In review", "In progress" or "Next" (when planned).
  - Future milestones get "Upcoming".
  - `on_hold` replaces the word with "On hold".
- `<RouteLine milestones tick?: string>` (`tick` is the id from `lastChange`):
  - An ordered list on one route line, horizontal from `sm` and vertical below.
  - Done markers are filled, the current one is ringed and pulsing, future ones are outlined.
  - Each marker always prints its word.
  - The line's progress segment draws to the current marker on mount via a `scaleX`/`scaleY` transition.
  - The ticked marker gets a one-shot `marker-tick` animation.

- [ ] **Step 1: Failing tests:**
  - `routeState`:
    - `first unfinished is current`
    - `in_review current reads In review`
    - `all done has no current`
    - `on hold overrides the word`
  - `RouteLine`:
    - `every marker shows its word`
    - `current marker has aria-current="step"`
    - `ticked marker gets the tick class`
    - `progress segment scale equals done fraction`
- [ ] **Step 2:** FAIL. **Step 3:** Implement. **Step 4:** PASS, and `npm run build` keeps the entry chunk at or under 200 KB gzipped.
- [ ] **Step 5:** Commit `feat(overview): route-line milestone strip with live tick`

---

### Task 9: End-to-end — two live contexts

**Files:**
- Create: `e2e/live.spec.ts`. Reuse `e2e/helpers.ts` and the cleanup pattern from `e2e/tracker.spec.ts`.

- [ ] **Step 1: Write the e2e test** (admin and client contexts; it creates its own project and client "Eve Estrada", and cleans up in `beforeAll` and `afterAll`):
  1. Admin creates the project with M1 and M2, then adds the client and activates. The client redeems the link and lands on the project.
  2. **Live plan change:** the admin changes M2's due date with the reason "scope grew". Without a reload, the client sees the "The plan changed" banner with that sentence, and acknowledges it. Live on the admin's Timeline, the row shows "Acknowledged by Eve Estrada".
  3. **Review:** the admin sets M1 to In review. The client sees Approve live and approves. The admin sees M1 Approved without a reload, and the client's route line shows M1 as Done.
  4. **Request changes:** the admin sets M2 to In review. The client requests changes with the comment "Logo too small". The admin sees M2 In progress and the comment.
  5. **Last visit:** the client navigates away. The admin posts an update. The client reopens the project, and the Updates tab link reads "Updates (updated)".
  6. **Reconnect:** `clientContext.setOffline(true)` shows "Reconnecting…". The admin renames M1. `setOffline(false)` hides the pill, and the new name appears without a reload.
  7. **Names:** on the client's Updates tab, the author reads the admin's name, not "Project team".
  8. **Phone:** at 375×812, the client's Overview has no horizontal scroll, and the route line is vertical (the progress segment is taller than it is wide).
- [ ] **Step 2:** Run `npm run e2e`. Expected: FAIL before Tasks 1–8 (run it once early), PASS after, with no flake across 5 runs.
- [ ] **Step 3: Full gate:** `npm run lint && npm run typecheck && npm test && npm run build && npx supabase test db && npm run test:integration && npm run e2e && npx supabase db lint`. Expected: all green.
- [ ] **Step 4:** Commit `test(e2e): live plan changes, reviews, markers and reconnect`

---

## Reused from earlier phases (don't rebuild)
- **Query keys and invalidation:** `qk.*` (`src/api/keys.ts`) and `invalidateProject` (`src/api/invalidate.ts`).
- **Plain-language sentences:** `describeActivity` and `formatChange` (`src/lib/formatChange.ts`).
- **Date and money formatting:** `formatDate` and `formatMoney` (`src/lib/format.ts`).
- **Milestone statuses:** `milestoneChip` and `holdChip` (`src/pages/project/milestoneStatus.ts`).
- **UI primitives:** `Dialog`, `Button`, `Field`, `StatusChip`, `useToast` and `AsyncView` (`src/ui/*`).
- **Auth:** `useAuth()` (`src/auth/AuthProvider.tsx`).
- **DB helpers:** `can_see()`, `is_admin()`, `shares_visible_project()`, the `log_activity` snapshot, and the `milestones_guard_status` trigger.
- **Test helpers:** the pgTAP helpers in `supabase/seed.sql`, `tests/integration/env.ts`, and `e2e/helpers.ts` (`signInAs`, `expectToast`, `expectNoHorizontalScroll`).

## Verification
- **Per task:** the RED → GREEN commands above.
- **End of phase:** the Task 9 Step 3 full gate, plus 5 clean e2e runs.
- **Manual:**
  1. Run `npm run dev` with the local stack and `npx supabase functions serve --env-file supabase/functions/.env`.
  2. Open two browsers, admin and client. Walk through the Task 9 story once in dark mode and once with OS reduced motion on; the route line should be static with reduced motion.
- **Final review:** a whole-branch review per executing-plans. It's a self-review unless CJ asks for a reviewer agent. Then merge to `main` and push on CJ's say-so.
