# MilePlan Phase 1 — Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A deployable skeleton:
- A Vite/React/TS app with the full database schema and RLS
- Invite-only auth with CJ's 7-day setup links
- Role-aware app shell with shared accessibility and state primitives
- At the end, CJ can create a client and the client can set a password and sign in to an empty "My projects".

**Architecture:**
- The SPA talks to Supabase directly with the anon key. Every table is protected by RLS built on two helpers, `is_admin()` and `can_see(project_id)`.
- Privileged auth operations (create client, setup tokens, deactivation) live in Supabase Edge Functions, which are the only place the service role key exists.
- Local development and every test run against the Supabase CLI stack in Docker.

**Tech Stack:**
- Node 24
- Vite ^7, React ^18.3, TypeScript ^5 (strict), React Router ^7 (library mode)
- @tanstack/react-query ^5, @supabase/supabase-js ^2
- Tailwind CSS ^4 via `@tailwindcss/vite`
- Vitest ^3 + @testing-library/react, Playwright ^1
- Supabase CLI (`supabase` npm devDependency) with pgTAP
- ESLint ^9 (flat config)

**Spec:** `docs/superpowers/specs/2026-11-05-mileplan-design.md`. This plan covers spec §3, §5 (schema only), §6, §7, §11 (tokens and fonts only), §12, §13 (auth-related) and §14 (database isolation and auth tests).

**Deferred to later phases** (not in this plan):
- `activity` triggers and the `plan_change` flag (Phase 2)
- The payment → paid trigger and the closed-project write lock (Phase 3)
- Messages UI (Phase 4)
- `import_plan` (Phase 5)

This phase creates those tables and their RLS, so later phases only add behaviour.

## Global Constraints
- **Repo:** `C:\PROJECTS\mileplan`, default branch `main`.
- **Schema:** every table is in `public`, has RLS enabled, and has `id uuid primary key default gen_random_uuid()` and `created_at timestamptz not null default now()`. Composite-key tables are the exception.
- **Amounts:** `numeric(12,2)`. Currency `char(3) default 'PHP'`.
- **Helper functions:** `security definer`, `set search_path = ''`, fully schema-qualified names.
- **Keys:** the service role key is never in `src/` or any `VITE_*` variable. The client uses only `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`.
- **Setup token:** 32 random bytes, base64url-encoded. Only `sha256(token)` (hex) is stored. Expiry is `now() + interval '7 days'`. URL format: `${SITE_URL}/setup#token=<raw>`.
- **Password:** minimum length 8, enforced server-side in `redeem-setup` and in Supabase Auth config.
- **Email:** trimmed and lowercased before any lookup or insert.
- **Upload limits:** 10 MB per file; image/*, application/pdf, application/zip only.
- **Signed download URLs:** expire after 60 seconds.
- **Performance budget:** every route is lazy-loaded; first-load JS ≤ 200 KB gzipped.
- **UI rules:**
  - Every list or data view renders distinct loading, error and empty states. The empty state shows only after data has arrived and is empty.
  - Every write fires a toast.
  - Save buttons are disabled until the form is dirty.
  - Status chips always print their word.
- **Copy (exact):**
  - RLS denial: "You don't have access to this"
  - Bad setup link: "This setup link has expired or was already used. Ask CJ for a new link."
- **Lint gate:** CI runs `npm run lint`, `npm run typecheck`, `npm test` and `npx supabase test db`. ESLint includes `no-undef` and `react/jsx-no-undef`.

## Review Focus
1. **Setup link redeemed twice at once** (two tabs, or a double click): exactly one redeem succeeds and the other gets the bad-link copy. Covered in Task 5 (`redeem twice concurrently`).
2. **Email typed with different case or spaces** (" Ana@X.com "): it matches the existing client and doesn't create a duplicate. Covered in Task 5 (`create-client normalizes email`).
3. **Deactivated client with a still-valid session:** reads return zero rows, and the app shows the account-deactivated screen instead of an empty dashboard. Covered in Task 3 (pgTAP) and Task 7 (component test).
4. **Client tries to promote themself** with `update profiles set role='admin'`: denied. Covered in Task 2.
5. **Short password sent straight to `redeem-setup`**, bypassing the form: rejected with 400 and the token is not consumed. Covered in Task 5.

---

### Task 1: Scaffold, lint, test runner, CI

**Files:**
- Create: `package.json`, `vite.config.ts`, `tsconfig.json`, `tsconfig.node.json`, `eslint.config.js`, `index.html`, `src/main.tsx`, `src/App.tsx`, `src/styles/tokens.css`, `src/styles/index.css`, `.env.example`, `.gitignore`, `.github/workflows/ci.yml`, `README.md`
- Test: `src/App.test.tsx`

**Interfaces:**
- Produces:
  - npm scripts: `dev`, `build`, `lint`, `typecheck` (`tsc --noEmit -p .`), `test` (`vitest run`), `test:integration` (`vitest run --config vitest.integration.config.ts`), `e2e` (`playwright test`), `db:start` (`supabase start`), `db:reset` (`supabase db reset`), `db:test` (`supabase test db`)
  - `src/styles/tokens.css`, which defines the CSS variables `--bg --surface --text --muted --border --accent --accent-contrast --focus --danger --ok --warn`, plus `--font-display` and `--font-ui`

- [ ] **Step 1:** `npm create vite@latest . -- --template react-ts`, then install the stack listed in the header. Add `@fontsource-variable/bricolage-grotesque` (display) and `@fontsource/ibm-plex-sans` (weights 400, 500, 600).
- [ ] **Step 2: Theme tokens.** Light: `--bg #FAF8F5`, `--surface #FFFFFF`, `--text #1C1A17`, `--muted #6B655C`, `--border #E6E1D9`, `--accent #D9480F`, `--accent-contrast #FFFFFF`, `--focus #1D4ED8`. Dark (under `@media (prefers-color-scheme: dark)` and `[data-theme=dark]`): `--bg #141210`, `--surface #1E1B18`, `--text #F3EFE9`, `--muted #A39C91`, `--border #2E2A25`, `--accent #FF8A4C`, `--accent-contrast #141210`, `--focus #93B4FF`. Add a global `:focus-visible { outline: 2px solid var(--focus); outline-offset: 2px }` and a `prefers-reduced-motion` block that sets `animation-duration: 0.01ms` and `transition-duration: 0.01ms`.
- [ ] **Step 3: ESLint.** Flat config with `@eslint/js` recommended, `typescript-eslint` recommended, `eslint-plugin-react` (with `react/jsx-no-undef: error`), `eslint-plugin-react-hooks`, and `no-undef: error` for `.js` files.
- [ ] **Step 4: Write the failing test.** `src/App.test.tsx` › `renders skip link` asserts that `screen.getByRole('link', { name: 'Skip to content' })` has `href="#main"`.
- [ ] **Step 5:** `npm test`. Expected: FAIL (no skip link).
- [ ] **Step 6:** Make `App.tsx` render `<a href="#main" class="skip-link">Skip to content</a>` and `<main id="main" tabIndex={-1}>`.
- [ ] **Step 7:** Run `npm test && npm run lint && npm run typecheck && npm run build`. Expected: everything passes, and the build output shows the entry chunk under 200 KB gzipped.
- [ ] **Step 8: CI.** `.github/workflows/ci.yml` has two jobs on push and PR:
  - `web`: `npm ci`, lint, typecheck, test, build.
  - `db`: `supabase/setup-cli@v1`, `supabase start`, `supabase test db`.
- [ ] **Step 9: Commit.** `chore: scaffold MilePlan (vite, react, ts, tailwind, eslint, vitest, ci)`

---

### Task 2: Supabase init, core schema, helpers, profile RLS

**Files:**
- Create: `supabase/config.toml` (from `npx supabase init`), `supabase/migrations/20261105000100_core.sql`, `supabase/seed.sql`, `supabase/tests/database/core.test.sql`

**Interfaces:**
- Produces:
  - Enums:
    - `user_role ('admin','client')`
    - `project_status ('setup','active','completed','terminated')`
  - Tables: `profiles`, `projects`, `project_members`, with columns as in spec §5
  - Functions:
    - `public.is_admin() returns boolean`
    - `public.can_see(p_project_id uuid) returns boolean`. Returns true when `is_admin()`, or when the caller is a member, the project status ≠ `setup` and the caller's `profiles.active` is true.
  - Trigger `on_auth_user_created`: after insert on `auth.users`, inserts a `profiles` row with role `client` and `full_name` from `raw_user_meta_data->>'full_name'`.
  - Test helpers in `seed.sql`:
    - `tests.create_user(p_email text, p_role user_role default 'client') returns uuid`
    - `tests.authenticate_as(p_user uuid)`: sets `role authenticated` and `request.jwt.claims`
    - `tests.clear_auth()`
  - Seed data: admin `admin@mileplan.test` and clients `ana@client-a.test` and `ben@client-b.test`, all with the password `mileplan-dev-pw`. These are test-only values, recorded here and in the README's local dev section.

- [ ] **Step 1:** `npx supabase init`. In `config.toml`: set `[auth] enable_signup = false`, `minimum_password_length = 8`, and `site_url = "http://localhost:5173"`.
- [ ] **Step 2: Write the failing pgTAP tests** in `core.test.sql`:
  - `client sees own active project`: Ana is a member of active project P1, so `select count(*) from projects` returns 1.
  - `client cannot see other client project`: Ana sees 0 rows of Ben's P2.
  - `member cannot see setup project`: P3 is in `setup` with Ana as a member, so she gets 0 rows.
  - `client cannot change own role`: as Ana, `update profiles set role='admin' where id = ana` raises `42501` (`throws_ok`).
  - `client can update own name`: as Ana, updating `full_name` changes 1 row.
  - `client cannot read unrelated profile`: Ana sees 0 rows of Ben's profile.
  - `admin sees all projects`: the count equals 3.
  - `new auth user gets client profile`.
- [ ] **Step 3:** `npx supabase start`, then `npx supabase test db`. Expected: FAIL (the tables don't exist).
- [ ] **Step 4: Write the migration.** Enums, tables, trigger, helpers, RLS:
  - **profiles:** select own row, or co-members of projects where `can_see`. Admins read all. Run `revoke update on public.profiles from authenticated` and then `grant update (full_name, avatar_path) on public.profiles to authenticated`, plus an update policy limited to `id = auth.uid()`. Admins update through the Edge Functions (service role).
  - **projects:** select where `can_see(id)`. Insert, update and delete where `is_admin()`.
  - **project_members:** select own rows, or where `can_see(project_id)`. The client may update only `last_seen_at` on its own row (column grant again). Admins have full access.
- [ ] **Step 5:** Run `npx supabase db reset && npx supabase test db`. Expected: PASS.
- [ ] **Step 6: Commit.** `feat(db): core schema, can_see/is_admin helpers, profile and project RLS`

---

### Task 3: Remaining tables and their RLS

**Files:**
- Create: `supabase/migrations/20261105000200_tracker_tables.sql`, `supabase/tests/database/isolation.test.sql`, `supabase/tests/database/client_writes.test.sql`

**Interfaces:**
- Consumes: `can_see`, `is_admin`, and the test helpers from Task 2.
- Produces:
  - Tables exactly as in spec §5: `documents`, `milestones` (including `plan_key text`, `unique (project_id, plan_key)`), `tasks` (with `project_id`), `updates`, `milestone_reviews`, `payments`, `messages`, `message_reads`, `activity`, `plan_change_acks`, `setup_tokens`.
  - Enums for each status set listed in §5.
  - Trigger `tasks_set_project_id`: before insert or update of `milestone_id`, copies the milestone's `project_id`.

- [ ] **Step 1: Write the failing isolation test.** With Ana in P1 and Ben in P2, and one row seeded in every table for P2, Ana gets `count(*) = 0` from each table on the list. Use one `is()` per table, with a test named `isolation: <table>`.
- [ ] **Step 2: Write the failing client-write tests:**
  - **payments:** Ana inserting a payment with `status='pending', submitted_by=ana` into P1 succeeds. With `status='confirmed'` it raises 42501. Inserting into P2 raises 42501.
  - **milestone_reviews:** an insert while the milestone is `in_review` succeeds. While it's `planned`, the insert raises 42501.
  - **messages:**
    - Insert with `sender_id=ana` succeeds; with `sender_id=ben` it raises 42501.
    - Updating her own body within 15 minutes changes 1 row. After that (use `created_at = now() - interval '16 minutes'`), it changes 0 rows.
  - **activity:** Ana's insert raises 42501, and so does an insert as admin. Its write privileges are revoked from `authenticated`.
  - **setup_tokens:** Ana and admin both select 0 rows (no policies, privileges revoked).
  - **milestones, tasks, documents, updates:** a client insert or update raises 42501, while the admin's succeeds.
  - **plan_change_acks:** Ana's insert with `user_id=ana` succeeds; with `user_id=ben` it raises 42501.
  - **Deactivated client:** set `profiles.active=false` for Ana, and her select on `milestones` returns 0.
- [ ] **Step 3:** `npx supabase test db`. Expected: FAIL.
- [ ] **Step 4: Write the migration,** with policies per the spec §6 table. The message edit window is the policy condition `sender_id = auth.uid() and created_at > now() - interval '15 minutes'`, with the update column grant limited to `body, edited_at`.
- [ ] **Step 5:** Run `npx supabase db reset && npx supabase test db`. Expected: all core, isolation and client_writes tests PASS.
- [ ] **Step 6: Commit.** `feat(db): tracker, payments, messaging and audit tables with RLS`

---

### Task 4: Storage buckets and policies

**Files:**
- Create: `supabase/migrations/20261105000300_storage.sql`, `vitest.integration.config.ts`, `tests/integration/env.ts`, `tests/integration/storage.test.ts`

**Interfaces:**
- Consumes: `can_see`, and the seed users and password from Task 2.
- Produces:
  - Private buckets `documents`, `attachments`, `payment-proofs` and `avatars`, each with `file_size_limit = 10485760` and `allowed_mime_types` set to the image, PDF and ZIP list.
  - Helper `public.path_project_id(p_name text) returns uuid`, which reads the first path segment.
  - `tests/integration/env.ts` exports `signIn(email): Promise<SupabaseClient>` and `adminServiceClient(): SupabaseClient`. Both read the `.env.test.local` file written by `npx supabase status -o env > .env.test.local`, which is git-ignored and never printed.
  - Avatars use the path `{user_id}/{file}` and are readable by anyone authenticated.

- [ ] **Step 1: Write the failing tests** in `storage.test.ts`:
  - `client uploads proof to own project`: Ana uploads `p1/x.png` to `payment-proofs` and gets no error.
  - `client cannot upload to documents`: Ana uploading to `documents/p1/...` returns an error.
  - `client cannot read other project file`: Ana creating a signed URL for `documents/p2/...` returns an error.
  - `client reads own project document`: the signed URL works, and fetching it gives 200.
  - `rejects disallowed mime`: uploading a `text/html` file returns an error.
- [ ] **Step 2:** `npm run test:integration`. Expected: FAIL.
- [ ] **Step 3:** Write the migration: buckets plus `storage.objects` policies. Reads use `can_see(path_project_id(name))`. Client inserts are allowed only on `payment-proofs` and `attachments`, and only when `can_see` holds. Admins have full access.
- [ ] **Step 4:** Run `npx supabase db reset && npm run test:integration`. Expected: PASS.
- [ ] **Step 5: Commit.** `feat(storage): private buckets with project-scoped policies`

---

### Task 5: Edge Functions — create client, setup links, deactivate

**Files:**
- Create: `supabase/functions/_shared/token.ts`, `supabase/functions/_shared/http.ts`, `supabase/functions/_shared/admin-guard.ts`, `supabase/functions/create-client/index.ts`, `supabase/functions/regenerate-setup-link/index.ts`, `supabase/functions/redeem-setup/index.ts`, `supabase/functions/set-client-active/index.ts`, `supabase/migrations/20261105000400_redeem_rate_limit.sql`
- Test: `tests/unit/token.test.ts`, `tests/integration/onboarding.test.ts`

**Interfaces:**
- Consumes: the `setup_tokens` and `profiles` tables, and `project_members`.
- Produces (all functions are POST with a JSON body):
  - **`_shared/token.ts`:** `generateToken(): string` and `hashToken(raw: string): Promise<string>`, using Web Crypto only, so Vitest can import the file too.
  - **`_shared/admin-guard.ts`:** `requireAdmin(req): Promise<{ userId: string }>`. It throws a 403 `Response` unless the caller's JWT belongs to an `admin` profile.
  - **`create-client`** (admin):
    - Body: `{ email: string, full_name: string, company?: string, project_id?: string }`
    - Returns `200 { user_id, setup_url: string | null, linked_existing: boolean }`.
    - If the email already exists: the client is linked to `project_id` if given, `setup_url` is null and `linked_existing` is true.
  - **`regenerate-setup-link`** (admin): body `{ user_id }`. Returns `200 { setup_url }` and sets `used_at = now()` on all earlier unused tokens.
  - **`redeem-setup`** (public):
    - Body: `{ token: string, password: string }`
    - Returns `200 { email }`, `400 { error: 'weak_password' }`, `410 { error: 'invalid_or_expired' }` or `429 { error: 'rate_limited' }`.
    - Consumes the token atomically: `update setup_tokens set used_at = now() where token_hash = $1 and used_at is null and expires_at > now() returning user_id`.
    - The password length is checked **before** the token is consumed.
  - **`set-client-active`** (admin): body `{ user_id, active: boolean }`. Sets `profiles.active` and bans or unbans through `auth.admin.updateUserById(id, { ban_duration: active ? 'none' : '876000h' })`.
  - **Rate limit:** table `redeem_attempts (ip text, at timestamptz)`, RLS on with no policies. More than 10 attempts per IP in 15 minutes returns 429.
  - **Secrets:** `SITE_URL` and `SUPABASE_SERVICE_ROLE_KEY`, from the function environment only.

- [ ] **Step 1: Write the failing unit tests** in `token.test.ts`:
  - `generateToken` returns 43 base64url characters, and two calls give different values.
  - `hashToken('abc')` equals `'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'`.
- [ ] **Step 2: Write the failing integration tests** in `onboarding.test.ts`. Run them against `npx supabase functions serve` with `SITE_URL=http://localhost:5173`:
  - `create-client returns setup url`: the URL matches `/^http:\/\/localhost:5173\/setup#token=[A-Za-z0-9_-]{43}$/`.
  - `create-client normalizes email`: creating `" Ana@Client-A.test "` gives `linked_existing === true` and no second auth user.
  - `create-client forbidden for client`: called with Ana's JWT, it returns 403.
  - `redeem sets password and allows sign in`.
  - `redeem twice concurrently`: two parallel `redeem-setup` calls with the same token produce exactly one 200 and one 410.
  - `redeem rejects short password without consuming token`: `password: 'short'` returns 400, then a valid password returns 200.
  - `expired token returns 410`: set `expires_at` to the past through the service client first.
  - `regenerate invalidates old link`: the old token gets 410 and the new one gets 200.
  - `deactivated client cannot sign in`.
  - `rate limit`: the 11th bad attempt from the same IP returns 429.
- [ ] **Step 3:** `npm test -- token && npm run test:integration -- onboarding`. Expected: FAIL.
- [ ] **Step 4:** Implement `_shared/*`, the four functions and the migration. `http.ts` exports `json(status, body)` and CORS handling for `SITE_URL`. `redeem-setup` reads the IP from `x-forwarded-for` (first entry).
- [ ] **Step 5:** Run `npx supabase db reset`, start `npx supabase functions serve` in the background, then run `npm test && npm run test:integration`. Expected: PASS.
- [ ] **Step 6: Commit.** `feat(auth): invite-only onboarding with 7-day setup links and client deactivation`

---

### Task 6: Shared UI primitives

**Files:**
- Create: `src/ui/Toast.tsx`, `src/ui/Dialog.tsx`, `src/ui/StatusChip.tsx`, `src/ui/AsyncView.tsx`, `src/ui/Button.tsx`, `src/ui/Field.tsx`, `src/lib/useTitle.ts`, `src/lib/errors.ts`
- Test: `src/ui/*.test.tsx`, `src/lib/errors.test.ts`

**Interfaces:**
- Produces:
  - `ToastProvider` and `useToast(): { success(msg: string): void; error(msg: string): void }`. The toast region is `role="status"` / `aria-live="polite"`, fixed to the viewport and kept across route changes.
  - `<Dialog open onClose title>`: focus trap, Esc closes it, focus returns to the opener, and `aria-labelledby` points to the title.
  - `<StatusChip status label>`: the label text is always rendered, and the variant also changes the fill style (solid, outline or dashed), not only the colour.
  - `<AsyncView query empty={ReactNode} onRetry>`. `query` is a TanStack `UseQueryResult<T[]>`, and `children(data)` is a render function. The empty state renders only when `isSuccess && data.length === 0`.
  - `<Field label error>` wraps the input with `htmlFor`/`id` association and `aria-describedby` pointing to the error.
  - `<Button loading>`
  - `useTitle(title: string)` sets `document.title = \`${title} · MilePlan\``.
  - `toUserMessage(err: unknown): string` maps PostgREST code `42501` or HTTP 403 to "You don't have access to this", and returns `err.message` otherwise.

- [ ] **Step 1: Write the failing tests:**
  - `AsyncView shows skeleton while pending, not empty state`
  - `AsyncView shows error with Retry that calls onRetry`
  - `AsyncView shows empty only after success with []`
  - `Dialog traps focus and restores to opener on Esc`
  - `StatusChip renders label text`
  - `toUserMessage maps 42501`
  - `toast survives route change` (render inside a `MemoryRouter`, fire a toast, navigate, and the toast text is still visible)
- [ ] **Step 2:** `npm test`. Expected: FAIL.
- [ ] **Step 3:** Implement the primitives above.
- [ ] **Step 4:** `npm test`. Expected: PASS.
- [ ] **Step 5: Commit.** `feat(ui): toast, dialog, status chip, async view and field primitives`

---

### Task 7: Auth, routing, app shell, auth pages

**Files:**
- Create: `src/lib/supabase.ts`, `src/auth/AuthProvider.tsx`, `src/auth/guards.tsx`, `src/routes.tsx`, `src/shell/AppShell.tsx`, `src/shell/ErrorBoundary.tsx`, `src/pages/LoginPage.tsx`, `src/pages/SetupPage.tsx`, `src/pages/AccountPage.tsx`, `src/pages/NotFoundPage.tsx`, `src/pages/DeactivatedPage.tsx`, `src/pages/admin/DashboardPage.tsx`, `src/pages/client/MyProjectsPage.tsx`
- Modify: `src/App.tsx`
- Test: `src/auth/guards.test.tsx`, `src/pages/SetupPage.test.tsx`

**Interfaces:**
- Consumes: the Task 6 primitives, and the `redeem-setup` contract from Task 5.
- Produces:
  - `supabase` client singleton
  - `useAuth(): { session, profile: { id, role, full_name, active } | null, loading: boolean, signOut(): Promise<void> }`
  - `<RequireAuth>` and `<RequireAdmin>`
  - **Route map** (all lazy-loaded through `React.lazy`):

    | Path | Shows |
    |---|---|
    | `/login` | sign-in page |
    | `/setup` | setup page |
    | `/` | admin → `DashboardPage`, client → `MyProjectsPage` |
    | `/clients` | admin only (filled in Task 8) |
    | `/account` | account page |
    | `*` | `NotFoundPage` inside the shell |

  - `AppShell`: skip link, top bar with the MilePlan wordmark in `--font-display`, and role-aware nav (admin: Dashboard, Clients; client: My projects), plus an account menu with Sign out.

- [ ] **Step 1: Write the failing tests:**
  - `RequireAdmin redirects client to /`
  - `RequireAuth redirects anonymous to /login?next=<path>`
  - `deactivated profile renders DeactivatedPage`
  - `SetupPage reads token from hash, not query`: with `location.hash = '#token=abc'`, the submit posts `{ token: 'abc', password }`.
  - `SetupPage shows bad-link copy on 410`: it shows the exact copy from Global Constraints.
  - `SetupPage blocks submit under 8 chars`
  - `SetupPage clears hash after reading`: afterwards `location.hash === ''`.
- [ ] **Step 2:** `npm test`. Expected: FAIL.
- [ ] **Step 3: Implement.**
  - **LoginPage:** email and password, plus "Email me a sign-in link" (`signInWithOtp` with `shouldCreateUser: false`), then redirect to `next`.
  - **SetupPage:** on success, calls `signInWithPassword` with the returned email and the new password, then navigates to `/`.
  - **AccountPage:** edit `full_name`, with Save disabled until dirty and a toast on save; change password through `auth.updateUser`.
  - **MyProjectsPage:** an `AsyncView` over `projects`. The empty state reads "No projects yet — CJ will add you once your project starts."
  - **DashboardPage:** an `AsyncView` placeholder with the empty state "No projects yet."
  - Every page calls `useTitle`.
- [ ] **Step 4:** `npm test && npm run lint && npm run typecheck && npm run build`. Expected: PASS, and the entry chunk is ≤ 200 KB gzipped.
- [ ] **Step 5: Commit.** `feat(app): auth provider, guards, lazy routes, shell and auth pages`

---

### Task 8: Admin Clients page and end-to-end onboarding test

**Files:**
- Create: `src/pages/admin/ClientsPage.tsx`, `src/pages/admin/CreateClientDialog.tsx`, `src/api/clients.ts`, `playwright.config.ts`, `e2e/onboarding.spec.ts`
- Test: `src/pages/admin/CreateClientDialog.test.tsx`, `e2e/onboarding.spec.ts`

**Interfaces:**
- Consumes: the Task 5 function contracts, and the Task 6 and 7 primitives.
- Produces in `src/api/clients.ts`:
  - `listClients(): Promise<ClientRow[]>`
  - `createClient(input): Promise<{ user_id; setup_url; linked_existing }>`
  - `regenerateLink(userId): Promise<string>`
  - `setClientActive(userId, active): Promise<void>`
  - All four call `supabase.functions.invoke`, except `listClients`, which reads `profiles where role='client'`.

- [ ] **Step 1: Write the failing component tests:**
  - `CreateClientDialog shows setup link with Copy button after success`
  - `shows "Already a client" note when linked_existing`
  - `Create disabled until email and name filled`
- [ ] **Step 2: Write the failing e2e test** in `e2e/onboarding.spec.ts`, using two browser contexts:
  1. Admin signs in with the seed credentials and opens `/clients`, which shows the empty state.
  2. Admin creates "Cara Cruz", `cara@client-c.test`, reads the setup URL from the dialog, and checks that a success toast appears.
  3. In the client context: open the URL, set password `cara-new-pw-1`, and land on `/`. "No projects yet" is visible.
  4. Admin regenerates the link and deactivates Cara. Cara reloads and sees the deactivated screen.
  5. A fresh context opens the first URL and gets the bad-link copy.
  6. The whole client flow is done with the keyboard only (Tab, Enter).
  7. Run again at a 375×812 viewport: no horizontal scroll (`scrollWidth <= clientWidth`).
- [ ] **Step 3:** `npm test` and `npm run e2e`. Expected: FAIL.
- [ ] **Step 4: Implement ClientsPage.** A table on desktop and cards at phone width, with columns Name, Email, Company, Status chip (Active / Deactivated) and Actions (Regenerate link, Deactivate/Reactivate with a confirm `Dialog`). Every action fires a toast.
- [ ] **Step 5:** `npm test && npm run e2e`. Expected: PASS.
- [ ] **Step 6:** `npx supabase db lint`, plus the Supabase security advisors (once a hosted project exists in Phase 6). Expected: no errors.
- [ ] **Step 7: Commit.** `feat(admin): clients page with setup links and deactivation; onboarding e2e`

---

## Done when
- CI is green: lint, typecheck, unit tests, `supabase test db`.
- `npm run test:integration` and `npm run e2e` pass locally against `supabase start` plus `supabase functions serve`.
- CJ can sign in locally as the seed admin, create a client, send the link, and the client lands on "My projects".
