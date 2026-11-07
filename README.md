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
3. **Apply only on CJ's OK.** The same block with `false` as the third argument, an optional reason as the fourth, and `commit` instead of `rollback`. On an active project the reason is shown to the client with each plan change.

An apply that is no longer valid, for example a client sent a proof for a payment the plan removes, raises `22023` with the first problem and writes nothing: run the dry run again.
