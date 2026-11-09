# MilePlan

Freelance client portal: milestones, updates, payments, documents and messages for a signed engagement.
Spec: `docs/superpowers/specs/2026-11-05-mileplan-design.md`.

## Develop

```
npm ci
npm run db:start      # Supabase local stack (needs Docker)
npm run dev
```

Checks: `npm run lint && npm run typecheck && npm test`, `npm run db:test`.

## Local dev

Supabase ports are shifted to 574xx (API `http://127.0.0.1:57421`, DB `57422`) because the default 543xx range collides with other local stacks and Windows reserves 55250–55574.

Seed users (test-only, created by `supabase/seed.sql`), all with password `mileplan-dev-pw`:
`admin@mileplan.test`, `ana@client-a.test`, `ben@client-b.test`.

## Tests

| Command | Needs |
|---|---|
| `npm run lint && npm run typecheck && npm test` | nothing |
| `npm run db:test` (pgTAP) | `npm run db:start` (Docker) |
| `npm run test:integration` | local stack + `npx supabase status -o env > .env.test.local` + `npx supabase functions serve --env-file supabase/functions/.env` |
| `npm run e2e` | everything above; Playwright starts the Vite dev server (`npx playwright install chromium` once) |

## Importing a plan

CJ can load a `plan.json` from the Milestones tab ("Import plan"): the app shows validation errors or a preview, and applies it on confirm. The shape is in `schemas/plan.schema.json` and a full example is `schemas/plan.example.json`. Re-importing is safe: rows are matched by `key`, rows without a key are never touched, and an identical plan changes nothing.

### Importing a plan through Claude

Claude runs the same function the app does, `import_plan(project_id, plan, dry_run, reason)`, so the rules are identical. The flow is a dry run, then CJ's OK, then the apply.

1. **Dry run.** Impersonate CJ so the actor and RLS are his (the same impersonation the pgTAP tests use), and roll back:

   ```sql
   begin;
   select set_config('request.jwt.claims', json_build_object('sub', '<admin id>', 'role', 'authenticated')::text, true);
   set local role authenticated;
   select public.import_plan('<project id>', '<plan json>'::jsonb, true);
   rollback;
   ```

2. **Show CJ the result.** `valid: false` lists every problem as `{ path, message }`. Otherwise show the diff: `milestones` and `payments` each have `added`, `changed` (with `[old, new]` per field), `removed` and `kept` (rows the plan doesn't name, which are left alone), plus `reordered`.
3. **Apply only on CJ's OK.** The same block with `false` as the third argument, an optional reason as the fourth, the dry run's `fingerprint` as the fifth, and `commit` instead of `rollback`. On an active project the reason is shown to the client with each plan change.

An apply that no longer matches its dry run raises `22023` and writes nothing: either the plan became invalid (a client sent a proof for a payment the plan removes) or the project changed since (the fingerprint differs). Run the dry run again and show CJ the new diff.

## Client documents

`npm run doc -- clients/<slug>` fills the four templates in `templates/` (service contract, project agreement, SRS, milestone plan) and writes them as PDF and DOCX to `clients/<slug>/out/`. Everything is Times New Roman: the exporter checks the fonts in both files and fails, writing nothing, if any other font shows up. Add `--only contract,agreement,srs,plan` or `--format pdf,docx` to narrow it down.

A client folder holds `plan.json` (the same file imported into MilePlan), `doc.json` (everything plan.json doesn't carry, see `schemas/doc.schema.json`) and eight prose files: `scope.md`, `requirements.md`, `users.md`, `nfr.md`, `constraints.md`, `assumptions.md`, `out-of-scope.md` and `glossary.md`. `clients/` is gitignored, so client details never reach GitHub. `scripts/doc/fixtures/acme/` is a sample client to copy from. Prices and add-ons live in `templates/prices.json`.

The export and font tests need Chromium and Times New Roman installed, so they run with `npm run test:doc`, not in CI. The templates are drafting aids, not legal advice.
