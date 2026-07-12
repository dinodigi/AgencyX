# Web (management UI)

Next.js (App Router) + Tailwind v4 — the tenant-facing dashboard (all tenant/admin UX lives here; the AgentX admin panel is builder-only). Consumes the shared `@dinosales/agentx-client` behind a **server-only** boundary so the delivery token never reaches the browser and every read/write is org-scoped by the user's Clerk JWT.

## Screens
- `/leads` — lead table, filters on precomputed `has_website` / `review_bucket` / `claimed` / `stage` (delivery reads are equality-only; these are the working filters).
- `/batches` — batch builder: keywords × ZIPs → SearchQueries via a server action (`app/actions.ts`), deduped per org, 500-unit cap.
- `/coverage` — keyword × ZIP units by last-scraped (the §5.4 soft-dedup surface).
- `/devices` — registered scraper devices + last-seen.

## Auth (Clerk, progressive)
`@clerk/nextjs` is wired and degrades gracefully:
- **Clerk mode** (when `CLERK_SECRET_KEY` is set): `ClerkProvider` + `middleware.ts` + sign-in/OrganizationSwitcher in the nav; `getSession()` uses `auth()` + `getToken()` to scope every call by the user's active org.
- **Dev-stub mode** (no secret): `getSession()` reads `AGENTX_DEV_ORG_ID` + `AGENTX_DEV_USER_TOKEN` (or `le_org_id`/`le_user_token` cookies). Keeps `next build` green with no env.
- `lib/auth.ts` is the single boundary; `lib/agentx.ts` `withClient()` returns `{ session, ax (generated reads), client (wrapper writes) }` (server-only).
- Root layout is `force-dynamic` (per-request, org-scoped) so nothing prerenders and ClerkProvider stays out of static /_not-found.

### Confirm Clerk is good-to-go
Sign in, then GET `/api/whoami` → reports `activeOrgId` and whether the session token carries flat `org_id` + `org_role` (`agentxReady: true`). If false, set them in Clerk → Sessions → Customize session token: `{ "org_id": "{{org.id}}", "org_role": "{{org.role}}" }`.

## Env (`.env.example`)
`AGENTX_DELIVERY_TOKEN` (server-side project token); `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` + `CLERK_SECRET_KEY` for Clerk; or the dev-auth stub `AGENTX_DEV_ORG_ID` + `AGENTX_DEV_USER_TOKEN`.

## Commands
`pnpm --filter @dinosales/web dev` · `build` · `start`. Build verified green; UI rendered (nav, batch builder, tables, Tailwind v4 tokens).

## Not wired yet
Real Clerk auth · org onboarding (JWT-claim bootstrap ordering) · lead-level ZIP filter (relation-hop in the client wrapper) · live run log (changes SSE).
