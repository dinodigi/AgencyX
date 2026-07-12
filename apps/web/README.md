# Web (management UI)

Next.js (App Router) + Tailwind v4 — the tenant-facing dashboard (all tenant/admin UX lives here; the AgentX admin panel is builder-only). Consumes the shared `@dinosales/agentx-client` behind a **server-only** boundary so the delivery token never reaches the browser and every read/write is org-scoped by the user's Clerk JWT.

## Screens
- `/leads` — lead table, filters on precomputed `has_website` / `review_bucket` / `claimed` / `stage` (delivery reads are equality-only; these are the working filters).
- `/batches` — batch builder: keywords × ZIPs → SearchQueries via a server action (`app/actions.ts`), deduped per org, 500-unit cap.
- `/coverage` — keyword × ZIP units by last-scraped (the §5.4 soft-dedup surface).
- `/devices` — registered scraper devices + last-seen.

## Data boundary
- `lib/agentx.ts` — `withClient()` returns `{ session, ax (generated reads), client (wrapper writes) }`. Server-only.
- `lib/auth.ts` — `getSession()` = the ONE auth swap point. Dev stub reads `AGENTX_DEV_ORG_ID` + `AGENTX_DEV_USER_TOKEN` (or `le_org_id`/`le_user_token` cookies); replace with `@clerk/nextjs`'s `auth()` (the TODO is inline).
- Pages are `force-dynamic` (per-request, org-scoped) and degrade to a signed-out / not-configured empty state so `next build` needs no network.

## Env (`.env.example`)
`AGENTX_DELIVERY_TOKEN` (server-side project token), plus the dev-auth stub `AGENTX_DEV_ORG_ID` + `AGENTX_DEV_USER_TOKEN` until Clerk is wired.

## Commands
`pnpm --filter @dinosales/web dev` · `build` · `start`. Build verified green; UI rendered (nav, batch builder, tables, Tailwind v4 tokens).

## Not wired yet
Real Clerk auth · org onboarding (JWT-claim bootstrap ordering) · lead-level ZIP filter (relation-hop in the client wrapper) · live run log (changes SSE).
