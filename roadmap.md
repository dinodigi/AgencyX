# Lead Engine — Build Roadmap

_Source: [lead-engine-build-brief.md](lead-engine-build-brief.md) (§10 phasing) corrected by the verified findings in [agentx-fit-assessment.md](agentx-fit-assessment.md). Effort assumes a 1–2 person AI-assisted team; durations are working estimates, not commitments._

**Critical path:** spikes → schema lock → replication live → release pipeline → scraper → MVP definition-of-done. Nothing tenant-facing ships before the schema is locked, because change-feed visibility is write-time — rows written before access rules exist never backfill into tenant feeds.

**Changes vs the brief's own roadmap (from the assessment):**
- **Billing is deferred entirely** — the tool runs internally (own agency as tenant #1). Multi-tenant isolation still ships from day one per the brief; Stripe work returns only if/when external tenants do.
- "AgentX job drain" Render Cron is deleted (the platform drains its own jobs).
- §11.1 is resolved: qualification is **async** (5s hook ceiling rules out sync LLM scoring).
- BYO keys move to a vault on the qualification service; AgentX stores a reference only.
- The AgentX dashboard is the builder's own tool (its intended role); ALL tenant and admin UX — including tenant management — is built into our web app. Tenants never touch AgentX directly.
- A day-1 replication worker (change feed → own Postgres) is added as a standing component: backup + analytics + vendor-exit hatch.

---

## Phase 0 — Foundations _(~1–2 weeks)_

### 0.1 Spikes first (day one — each is hours, and they gate schema/design decisions)
| # | Spike | Gates |
|---|---|---|
| S1 | Does delivery `POST /v1/{collection}` accept an `idempotencyKey`? (inspect the generated client's `create()`, then test) | Outbox sync design (0.4, 1.1) |
| S2 | Same-stage no-op write: rejected, ignored, or re-fires actions? | Workflow wiring (0.2) |
| S3 | Trash-restore + version-rollback vs workflow legality; does restore's `entry.created` (`restored:true`) re-fire triggers? | Qualification receiver (Ph3) |
| S4 | `bulk_create_entries` × beforeCreate hooks (docs contradict: per-item vs refused) | Only if sync scoring is ever revisited |
| S5 | Transition actions: `when` clauses + `{{field}}` templating parity with events (one `define_collection` dry run) | Transition email wiring (Ph4) |

### 0.2 Schema lock (the tenancy idioms, decided once)
- Clerk: session token template carries **org id + role claims** (JWT claims are the enforcement source, not the Users.role field). Org onboarding flow respects bootstrap ordering: create Clerk org → mint JWT with claim → create Agencies row.
- Every collection: `orgId` (text, stamped via `access.org {claim, field}`) **+** `agency` relation kept for labels/joins. No collection ships without `access.org`.
- Collections per brief §4 with deltas: Leads gets `dedupKey` (text, unique) = `{orgId}:{placeId}` (placeId itself NOT unique); SearchQueries gets `dedupKey` = `{orgId}:{keyword}:{zip}` (re-runs update the row, satisfying soft coverage); Leads gets precomputed `hasWebsite` (boolean) + `reviewBucket` (enum) because delivery filters are equality-only; `qualificationApiKey` is replaced by `qualificationKeyRef` (text — reference/fingerprint only, real key in the Phase-3 vault).
- Workflows: `Leads.stage` (initial `scraped`; `scraped→qualified` actors `['mcp']`; human transitions `['delivery','admin']`; per-transition actions per §9). `SearchQueries.status` (initial `pending`; `pending→running` actors `['delivery']` — this IS the device queue-claim CAS, the loser's move is rejected; `running→completed|failed`; `failed→pending` retry for `mcp/admin`).
- publicRead mapping: every field tenant apps need = `publicRead:true` (still org-row-gated); secrets/internal fields stay off the delivery surface.

### 0.3 Config-as-code + CI guardrails
- `export_project` manifest versioned in git; CI lint asserts: every collection has `access.org`, every Leads redefine includes the `workflow` block (omitting it silently drops enforcement).

### 0.4 Standing infra
- **Replication worker** (Render): tail `GET /v1/changes` (or MCP `get_changes`) by cursor into our own Postgres. Live before any real data flows.
- Monorepo scaffold (§3 layout): pnpm + Turborepo; `packages/agentx-client` = generated CRUD client **+ one thin hand-written wrapper** for search, changes/SSE, uploads (client covers CRUD only); `packages/types`, `packages/ui` (Tailwind v4 tokens).
- GitHub Actions skeletons (web deploy to Render; desktop build matrix stub).
- **Order the Authenticode cert now** (OV vs EV decision — validation lead time must not block Phase 1's installer).

**Exit criteria:** spikes answered and folded into schema; schema + workflows live in AgentX and linted in CI; replication tailing; typed client generated and wrapped; a smoke script proves org isolation (two test orgs cannot read each other) and workflow enforcement (illegal transition rejected).

---

## Phase 1 — MVP: scraper + core apps _(~4–6 weeks; brief's current focus)_

Three parallel workstreams. Per §12.4: the desktop **release pipeline ships before scraping logic**.

### W1 — Desktop shell (Electron + React + TS) — SCAFFOLD BUILT ✅ (typecheck + bundle green)
1. Electron scaffold in monorepo ✅ (main/preload via esbuild, renderer via Vite, both building); GitHub Actions release skeleton in place → **still TODO: prove `electron-builder` → signed NSIS → GitHub Releases → `electron-updater` self-update on a dummy build (the W1 exit gate); needs the cert.**
2. Clerk login: refresh loop **built** in `main/auth.ts` (schedules refresh before expiry, signs out cleanly on failure) ✅; secrets in Credential Manager (keytar) ✅. **TODO: real Clerk sign-in UI + `refreshFn` implementation** (currently returns null; dev sign-in accepts a pasted JWT).
3. SQLite outbox **built** (`outbox.ts`) + sync engine **built** (`sync-engine.ts`) using `syncLead` (unique-conflict = already-synced, per S1 — no delivery idempotency exists) ✅. Offline detection + failed-requeue in place.
4. Device identity **built** (`device.ts`, stable UUID in userData). Device/agency/user registration **BUILT** (`main/registration.ts`): on sign-in, idempotently ensures the org's Agencies row (`org_id` now unique), the user's Users row, and this install's Devices row via the delivery API (race-safe via unique keys); 5-min heartbeat refreshes `last_seen`. Leads now carry agency/device relations; `run:claimNext` claims the oldest pending SearchQuery and runs the real `runQuery` (claim→scrape→complete), closing the desktop↔web↔AgentX loop. 3 registration tests green.

### W2 — Scraper engine (the moat) — ARCHITECTURE BUILT ✅ (pipeline tested green)
1. `playwright-extra` + stealth on real Chrome channel **built** (`scraper/google-source.ts`, dynamic-imported); randomized viewport/UA + human pacing **built** (`scraper/human.ts`). **TODO: tune selectors/timing on live output (§12.5) — the one step that needs a real machine + Google.**
2. Source-agnostic engine (`scraper/engine.ts`) + runner (`scraper/runner.ts`) **built**: streams listings → converts to leads (dedup key + precomputed buckets) → outbox → sync. `runQuery` (claim `pending→running`, complete/fail) AND `runAdhoc` paths done. Queue-claim uses the S2 stamp-settle-verify protocol.
3. Rich capture per §5.3 **built** (placeId/CID parse, claimed via "Claim this business" presence, ratings, hours, photo count…); centralized selectors (`scraper/selectors.ts`); "0 results" vs "selector miss" vs "blocked" are distinct outcomes.
4. Cool-down/back-off **built**: `ScrapeBlockedError` → engine returns `blocked` + backoffMs, run stops, UI shows it (never hammers).
5. **MockSource + 4 pipeline tests green** (scrape→outbox→status, dedup, CAPTCHA cool-down, lost-claim) — full loop proven without Google. Run controls wired into the desktop UI (dry-run default).
6. **TODO: coverage soft-gate** (read SearchQueries by keyword+zip before a run); tune against real ZIPs; selector maintenance is now a standing cost line.

### W3 — Web app (Next.js App Router + Tailwind v4) — CORE SCREENS BUILT ✅ (next build green, rendered)
Built + verified (server-rendered, org-scoped via the shared client behind a server-only boundary):
- Lead table with filters on precomputed `has_website`/`review_bucket`/`claimed`/`stage` (equality — the working delivery filters) ✅
- Batch builder: keywords × ZIPs cross-product → SearchQueries via a server action, chunked with `upsertSearchQuery` dedup semantics + a 500-unit safety cap ✅
- Coverage view (SearchQueries by `last_scraped_at`, the §5.4 soft-dedup surface) ✅
- Devices view ✅ · nav shell + Tailwind v4 tokens mirroring packages/ui ✅
**Clerk auth WIRED** (progressive): `@clerk/nextjs` — ClerkProvider, middleware, sign-in UI + OrganizationSwitcher in the nav, `getSession()` uses `auth()`/`getToken()` when `CLERK_SECRET_KEY` is set, else the dev stub. Both build paths green. `/api/whoami` decodes the live token and reports whether flat `org_id`/`org_role` claims are present (the AgentX-scoping gate). Connector fixed 2026-07-12 (publishable key corrected).
**TODO (needs your side):** add Clerk keys to `apps/web/.env.local`, enable Organizations, create a test org+user, and set the session-token claims (`org_id`/`org_role`) — then `/api/whoami` confirms good-to-go. Remaining build: org onboarding (bootstrap ordering) · lead-level ZIP filter (relation-hop) · live run log via changes SSE · settings.

**Exit criteria (the brief's definition of done):** a real user logs in on a fresh Windows install from the public installer, runs a batch, watches the live log in the web app, and clean deduped leads land — across two test orgs with zero cross-tenant visibility. Self-update proven by shipping a v1.0.1.

---

## Phase 2 — Enrichment: listing audit _(~1–2 weeks)_

1. Provider interface `runAudit(businessName, location)` exactly per §6 — Moz automation is implementation #1, reusing the browser-automation infra, on our own worker.
2. Trigger: AgentX schedule (preset cadence) pings the worker; worker pulls un-audited leads, rate-limits itself hard (AgentX has no outbound throttle primitives — throttling is ours).
3. Write-back: `transact` (MCP, from our worker) writes the ListingAudits row + updates `listingHealthScore` atomically; idempotency keys on the batch. Oversized `rawResult` payloads → stored as assets (size caps undocumented).
4. Web app: filter/sort on listingHealthScore (bucketed enum for delivery-side filtering).
5. **Decision gate out of phase:** define the volume threshold that triggers the swap to a paid listing API (BrightLocal/Yext) behind the same interface.

---

## Phase 3 — Qualification _(~2–3 weeks)_

_Trigger decision is resolved: **async**._
1. Node service on Render. Holds **full-trust MCP credentials** — this is the trust-boundary event of the project: creds only on this box, receiver treats webhooks as untrusted input (event webhooks are not documented as signed — verify or firewall by source), idempotent keyed on `entry id + to-state`, and honors `restored:true` (S3) so restored leads don't re-score.
2. BYO key vault: per-agency keys encrypted at rest on our infra, keyed by agency id; AgentX holds `qualificationKeyRef` only.
3. Flow: `entry.created` webhook → score with tenant's key → write back `qualificationScore` via `update_entry_if` CAS → drive `scraped→qualified` (actor `mcp`).
4. Web app: qualified-lead views; entering `qualified` fires the Phase-4 sample-build webhook (wired but dormant).

---

## Phase 4 — Build & propose _(~2–4 weeks)_

1. Sample-site generator on our infra, triggered by the `qualified` transition webhook. **Site bundles cannot ship through AgentX assets** (no zip/js/css types) — host them on our own R2/storage; store the URL + metadata on the Lead.
2. Proposal generation; `building→proposed` transition fires the Resend proposal email — **dedupe before send** (transition actions deliver at-least-once and `refire_delivery` exists; a replayed proposal email goes to a real prospect). If S5 showed transition templating is weak, send via `events.updated when stage=proposed` instead.
3. Delayed follow-ups ("nudge N days after proposed") via `events.updated` + `after` (delays are unsupported on transition actions).

---

## Phase 5 — Sell & client space _(~1–2 weeks; billing DEFERRED — internal use)_

1. **Billing: deferred.** When external tenants arrive: own-infra Stripe Billing (subscriptions, customer portal, webhook receiver reconciling `tier` into AgentX). AgentX checkout stays unused regardless (payment-mode only + incompatible with org-scoped collections). Pricing-model decision deferred with it.
2. Close handling `proposed→sold` (human transition), lead→client conversion `sold→client` firing the client-space handoff.
3. Client workspace handoff — client-facing surfaces are delivery-API only (admin panel never leaves the team).

### Gate before the FIRST external tenant (hard checklist)
- Written vendor answers: SOC2/GDPR posture, residency, encryption at rest; note image-variant URLs are unauthenticated by design.
- Code-signing reputation in place (EV instant / OV aged); SmartScreen clean on a fresh machine.
- Isolation re-test with hostile-tenant scenarios (incl. dedupKey prefix-squatting attempt).
- Replication verified restorable (actual restore drill, not just tailing).
- Legal sign-off on scraping ToS exposure (business call, flagged §5.5).

---

## Standing tracks (all phases)
- **Selector maintenance** — recurring budget line from Phase 1 on; Google DOM breakage is expected, one-file fix by design.
- **Vendor watch** — track AgentX releases against our 21 feedback notes; each shipped fix deletes a workaround (delivery idempotency → simplify outbox; org-scoped unique → drop dedupKey; signed events → drop receiver firewalling; subscriptions → shrink billing service).
- **Data ops** — replication lag monitoring; monthly restore drill; audit-log sampling.
- **Risk register (top 5):** Google blocks/DOM churn (mitigated by §5.1 model + backoff) · vendor pre-1.0 single-instance (mitigated by replication + phase gates) · Clerk token expiry on long runs (refresh loop, W1.2) · undocumented rate limits (coarse heartbeats, backoff everywhere) · compliance unknowns blocking enterprise tier (gate list above).

## Milestone summary
| Milestone | Meaning | Rough cumulative timeline |
|---|---|---|
| M0 | Spikes answered, schema locked + linted, replication live, cert ordered | ~2 weeks |
| M1 | **MVP DoD**: public signed installer → batch → live log → deduped leads, 2-org isolation proven | ~6–8 weeks |
| M2 | Enrichment live, listingHealthScore filterable | ~8–10 weeks |
| M3 | Async qualification live with vaulted BYO keys | ~11–13 weeks |
| M4 | Sample-build + proposal automation on transitions | ~14–16 weeks |
| M5 | Client space live (billing deferred); external-tenant gate runs only if external tenants onboard | ~16–18 weeks |
