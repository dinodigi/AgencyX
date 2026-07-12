# Lead Engine (DinoSales)

Multi-tenant agency pipeline — scrape → qualify → build → propose → sell → client — backed by AgentX (pluggie.app) as the canonical data layer. Internal tool for now; multi-tenant by architecture.

## Documents
- [lead-engine-build-brief.md](lead-engine-build-brief.md) — the product brief
- [agentx-fit-assessment.md](agentx-fit-assessment.md) — verified platform capability review (86 findings)
- [roadmap.md](roadmap.md) — phased build plan
- [agentx/SPIKE-RESULTS.md](agentx/SPIKE-RESULTS.md) — empirical platform behavior (load-bearing design contracts)

## Layout
```
/apps
  /web            → Next.js management UI (W3 — pending)
  /desktop        → Electron scraper (W1/W2 — pending)
  /qualification  → Node scoring service (Phase 3 — pending)
  /replicator     → change-feed → Postgres replication worker (standing infra)
/packages
  /agentx-client  → generated typed delivery-API client + hand-written wrapper
  /types          → shared domain types + schema idioms (dedup keys, buckets)
  /ui             → shared React/Tailwind tokens (stub)
/agentx           → schema manifest (config-as-code) + CI lint
```

## Ground rules (from the assessment — do not violate)
1. Tenant surfaces (web, desktop) talk ONLY to the delivery API with a Clerk user JWT. MCP credentials live only on our own backend services.
2. Every collection carries `access.org`; every `leads`/`search_queries` redefine must resend the `workflow` block. CI lints this (`node agentx/lint.mjs`).
3. Outbox retry safety = unique `dedup_key` (the platform has no delivery-API idempotency). 422 + unique-constraint = already synced.
4. Conditional event sends go on `events.updated` `when` clauses — `when` on workflow transition actions is silently ignored.
5. The AgentX admin dashboard is the platform builder's tool only. All tenant/admin UX lives in `/apps/web`.

## Commands
- `pnpm install` — install workspace
- `pnpm typecheck` — typecheck all packages (turbo)
- `pnpm lint:manifest` — assert schema guardrails over `agentx/manifest.json`
