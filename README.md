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
