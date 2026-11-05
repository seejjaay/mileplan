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
