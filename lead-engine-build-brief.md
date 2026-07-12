# Lead Engine — Build Brief

_Working name. Product sits under **Pluggy**, backed by **AgentX** (data layer) and eventually **xVibe** (IDE)._

_Status: AgentX project created; **Neon, Clerk, Resend, and R2 connectors are live and available to the AI.** Foundation infra is largely in place — remaining Phase 0 work is schema, workflow, and repo/CI scaffolding._

---

## 1. Thesis

A multi-tenant SaaS that runs a full agency pipeline — **scrape → qualify → build → propose → sell → client** — starting with a best-in-class, low-footprint lead scraper. Your own agency is tenant #1; the architecture assumes other agencies sign up as isolated tenants from day one.

The MVP is deliberately narrow: **prove the scraper and the data quality**, wrap it in the minimum web + desktop infrastructure needed to run it for real, and leave the later pipeline stages as clean seams rather than half-built features.

---

## 2. System architecture

Four components, each independently deployable, talking over APIs. AgentX is the source of truth; nothing else holds canonical state.

```
        ┌─────────────────────────────┐
        │        AgentX (Pluggy)      │  ← data model, multi-tenant isolation,
        │  delivery API · webhooks ·  │    workflow state machine, generated
        │  Clerk · Resend · R2 · Neon │    typed TS client · connectors LIVE
        └───────┬──────────────┬──────┘
                │ /v1 API      │ webhooks / hooks
        ┌───────┴──────┐   ┌───┴────────────────┐
        │  Web App     │   │ Qualification Svc  │  (your infra, Phase 3)
        │  Next.js     │   │  Node · BYO-key    │
        │  mgmt UI     │   │  per tenant        │
        └───────┬──────┘   └────────────────────┘
                │ same /v1 API + generated client
        ┌───────┴──────────────────────────────┐
        │  Desktop Scraper (Electron, Windows)  │
        │  Google Maps automation · local SQLite│
        │  outbox sync · self-update            │
        └───────────────────────────────────────┘
```

**Why this shape.** AgentX never runs tenant code by design — so the scraper, the qualifier, and the future site-builder all live on your own infra and integrate through the delivery API, webhooks, and before-write hooks. That's not a limitation to work around; it's the isolation boundary that keeps one tenant from ever touching another's data or crashing shared compute. Every component consumes the **typed, dependency-free TS client** AgentX generates from the live schema, so the web app and desktop app share one contract that can't silently drift.

---

## 3. Tech stack & deployment

**One language everywhere: TypeScript.** For a small, AI-assisted team this is the biggest force multiplier — shared types, one mental model, and the AgentX-generated client is already TS so nothing is lost at the boundaries.

| Component | Stack |
|---|---|
| Web app | **Next.js (App Router) + React + TypeScript**, Tailwind v4 |
| Desktop scraper | **Electron + React + TypeScript** — React renderer for UI, Node main process for Playwright + SQLite |
| Scraper engine | **Playwright + `playwright-extra` (stealth)**, `better-sqlite3` for local store |
| Qualification svc (Ph3) | **Node + TypeScript** — it's LLM-API orchestration, not ML training, so no reason to leave the stack |
| Shared | **pnpm workspaces + Turborepo monorepo** — `packages/` holds shared types + the AgentX client so the contract can't drift |

**Styling — Tailwind v4, shared tokens.** Design tokens (colors, spacing, fonts) live in a shared Tailwind config in `packages/`; both the web app and the Electron renderer import it, so the desktop UI matches the web app for free. Matches AgentX's own Tailwind v4. (Note: Tailwind styles the Electron _renderer_; native window chrome — title bar, menus — is separate Electron config if you want a custom frameless look.)

**Deployment — Render for backend, GitHub Releases for desktop.**

- **AgentX** — already on Render, on Neon (live).
- **Web app (Next.js)** → Render Web Service, push-to-branch auto-deploy.
- **Qualification service (Ph3)** → Render Web Service (webhook-triggered) or Background Worker (queue-draining).
- **Scheduled jobs** (AgentX job drain, enrichment sweeps) → Render Cron.
- **Desktop app does _not_ deploy to Render.** It ships as a signed Windows installer via **GitHub Releases** and self-updates from there. Two distribution models side by side — normal for a product with both a SaaS backend and a downloadable client.

**Monorepo layout (target):**
```
/apps
  /web            → Next.js management UI
  /desktop        → Electron scraper
  /qualification  → Node service (Phase 3)
/packages
  /agentx-client  → generated typed TS client
  /types          → shared domain types
  /ui             → shared React components + Tailwind tokens
```

---

## 4. Data model (AgentX collections)

Multi-tenancy is enforced by `access.org {claim, field}` on every collection — the `agency` field is server-stamped from the Clerk org claim (Clerk connector is live), so isolation happens at the row level on every read and write. No collection is missing this.

**Agencies** — `name` (text), `tier` (enum: starter/pro/enterprise), `stripeCustomerId` (text), `billingEmail` (text), `qualificationApiKey` (text, encrypted — BYO key), `createdAt` (computed: now).

**Users** — `email` (text, unique), `name` (text), `role` (enum: admin/scraper/viewer), `agency` (relation → Agencies), `createdAt` (computed: now).

**Devices** — `deviceId` (text, unique), `user` (relation → Users), `agency` (relation → Agencies), `platform` (enum: windows/mac), `appVersion` (text), `lastSeen` (date), `createdAt` (computed: now).

**SearchQueries** — `keyword` (text), `zip` (text), `user` (relation → Users), `agency` (relation → Agencies), `status` (enum: pending/running/completed/failed), `lastScrapedAt` (date), `resultCount` (number), `createdAt` (computed: now).

**Leads** — `placeId` (text, unique per agency — the canonical dedup key), `businessName` (text), `phone` (text), `website` (text), `address` (text), `hours` (richtext/text), `category` (text), `reviewCount` (number), `rating` (number), `claimed` (boolean), `searchQuery` (relation → SearchQueries), `agency` (relation → Agencies), `device` (relation → Devices), `stage` (enum — drives the workflow, see §9), `listingHealthScore` (number, Phase 2), `qualificationScore` (number, Phase 3), `createdAt` (computed: now).

**ListingAudits** (Phase 2) — `lead` (relation → Leads), `provider` (enum: moz/brightlocal/…), `directoriesChecked` (number), `directoriesFound` (number), `inconsistencies` (richtext/JSON text), `rawResult` (richtext), `checkedAt` (date).

**Dedup note:** the same business surfaces across overlapping ZIP searches. Dedup on `placeId` (Google's stable CID/place identifier), never on name+phone — those are dirty. Capture `placeId` on every scrape; it's also what lets you re-enrich a lead later without re-scraping.

---

## 5. The scraper (the heart of the MVP)

Goal: **safe, quiet, and rich.** Not a mega-scraper — the whole safety model depends on staying small and human-like.

### 5.1 Why the desktop-app-per-user model _is_ the anti-detection strategy

Each scraper runs on a real user's machine, on a real residential IP, in a real browser. That distributes load across many IPs naturally and looks like ordinary human browsing. This is the single biggest reason to keep scraping on the desktop rather than a central server farm — a central scraper on datacenter IPs is exactly what Google flags. Keep per-run volume low (50–100 leads, one query at a time, randomized human delays) and you stay under the radar structurally, not just tactically.

### 5.2 Engine

- **Playwright** driving a real Chrome channel (not bare headless Chromium — headless carries automation fingerprints). Use `playwright-extra` + stealth plugin, randomized viewport/user-agent within believable ranges, real scroll/hover behavior, jittered delays between actions and between queries.
- One search unit = `keyword + zip`. The app works a queue: run query → scroll the results panel to load listings → extract each → move on with a human-paced gap.
- Resilient selectors: Google's DOM changes often. Prefer stable anchors (aria roles, data attributes, structured JSON in the page) over brittle CSS paths, and centralize selectors so a break is a one-file fix. Treat "0 results" and "selector miss" as distinct, logged states.

### 5.3 Data captured per listing (go beyond the basics)

Name, phone, website, full address, category, hours, review count, average rating, price level, **claimed/unclaimed status**, `placeId`/CID, and where available: photo count, service options, years-in-business signals. Claimed-vs-unclaimed and website-presence are strong early qualification signals — capture them even before the scoring layer exists.

### 5.4 Coverage & soft dedup

Track coverage ZIP-by-ZIP with `lastScrapedAt` per `keyword+zip`. Before a run, surface "78704 + plumbers last scraped 3 days ago by Sarah — refresh or skip?" It's a **soft** gate: users can always re-run to catch new businesses; the timestamp just informs the decision and prevents blind repetition. New team members inherit existing coverage instead of re-querying.

### 5.5 Honest risk flags

- Scraping Google Maps violates Google's ToS. The distributed residential model materially lowers block risk but doesn't eliminate legal exposure — that's a business call, not an engineering one.
- Expect periodic DOM breakage; budget for selector maintenance as ongoing cost.
- Build a "cool-down / back-off" path: if a run hits a CAPTCHA or unusual response, pause that device, log it, and surface it in the UI rather than hammering through.

---

## 6. Listing-audit enrichment (Phase 2)

You want to run each lead through Moz's free local listing check and pull the result back as a qualification signal. Design this as a **pluggable enrichment layer**, not a Moz-specific hack — same shape can later hold BrightLocal, Yext, or Whitespark.

- **Provider interface:** `runAudit(businessName, location) → { directoriesChecked, directoriesFound, inconsistencies[] }`. Moz is the first implementation, hitting `moz.com/products/local/check-listing` via the same browser-automation infra.
- **Non-blocking & throttled:** enrichment is an async job that runs _after_ the lead is captured, never in the scrape hot path. A failed audit must not lose the lead. Rate-limit hard — a free public tool will have anti-bot / CAPTCHA protection, and firing it on every lead at speed will get blocked.
- **The payoff:** a low `directoriesFound / directoriesChecked` ratio is a concrete sales hook — "your business is missing or inconsistent across N directories." That's the `listingHealthScore` feeding qualification.
- **Honest flag:** if volume grows, a paid listing API (BrightLocal/Yext have real APIs) will be far more reliable than automating a free web tool. Keep the provider interface clean so swapping in an API is a config change, not a rewrite.

---

## 7. Desktop app infrastructure (Windows first)

**Stack: Electron + React + TypeScript.** It bundles Chromium (Playwright integrates cleanly), lets the renderer share design tokens with the web app, and has the most mature story for the three things you asked for: GitHub Actions builds, code signing, and self-update.

### 7.1 App internals

- **UI (React renderer):** login (Clerk), search-queue manager, live run log (query executing, leads grabbed, errors, progress), coverage view, settings (device ID, version, account).
- **Local store:** SQLite (`better-sqlite3`) as the offline safety-net and outbox. Leads write locally first, tagged with `deviceId`.
- **Sync engine (outbox pattern):** a worker posts un-synced leads to AgentX's `/v1` API using **idempotency keys** (AgentX returns the original id on replay, so retries never double-insert), then marks them synced. Handles offline → reconnect cleanly. AgentX stays the source of truth; local SQLite is a durable buffer.
- **Secure token storage:** the Clerk session token lives in the OS secure store (Windows Credential Manager via `keytar`), never plaintext on disk.

### 7.2 CI/CD (GitHub Actions → GitHub Releases)

- Part of the monorepo; the desktop build job is scoped to `apps/desktop`. On a tagged release, Actions runs `electron-builder` to produce a signed Windows NSIS installer and publishes it to **GitHub Releases**.
- `electron-updater` reads that Releases feed: app checks for updates on launch, downloads in the background, installs on quit. That's your self-update loop with no extra infrastructure.
- Mac later = add a macOS build matrix job + notarization; the pipeline shape is already there.

### 7.3 Code signing — budget for this

Windows SmartScreen will warn users on an unsigned installer, which kills trust for a tool you're distributing to other agencies. Plan for an **Authenticode certificate** (OV is cheaper; EV gives instant SmartScreen reputation). This is a real cost and setup step, not an afterthought — flag it early so it's not blocking your first external tenant.

---

## 8. Web app

- **Next.js (App Router) + Tailwind v4**, consuming the AgentX generated TS client. Clerk for auth + org membership (connector live).
- **MVP screens:** org onboarding, search-batch builder (keywords × ZIPs → cross-product of `SearchQueries`), lead table with filters (has-website, review thresholds, unclaimed, ZIP), coverage view, device status, settings/billing.
- The branded AgentX admin panel comes free and can back-stop anything the custom UI doesn't cover yet — both read the same isolated data.

---

## 9. Cross-cutting: the pipeline as a state machine

Model the full workflow as an AgentX **workflow state machine** on the `Lead.stage` enum: `scraped → qualified → building → proposed → sold → client`. AgentX enforces enum transitions with actor gates and per-transition actions (webhooks / **Resend** email — connector live) at the write choke point, exactly-once under races. This means the later phases (Phases 3–5) bolt onto transitions rather than requiring new plumbing — e.g. entering `qualified` fires the sample-build trigger; entering `proposed` fires a Resend proposal email; entering `sold` fires the client-space handoff.

---

## 10. Phased roadmap

### Phase 0 — Foundations  _(mostly done)_
✅ AgentX project created · ✅ Neon, Clerk, Resend, R2 connectors live. **Remaining:** define full schema with `access.org` on every collection · wire Stripe tiers · stand up the `Lead.stage` workflow end-to-end · scaffold the pnpm+Turborepo monorepo + GitHub Actions skeletons · generate + wire the shared TS client.

### Phase 1 — MVP: scraper + core apps  ← **current focus**
Electron shell (login, local SQLite, outbox sync, self-update via GitHub Releases, signed Windows installer) · Google Maps scraper (stealth, coverage tracking, soft dedup on `placeId`, rich field capture) · web app management UI (batch builder, lead table, coverage, devices). **Definition of done: a real user logs in, runs a batch, watches the live log, and sees clean deduped leads land in the web app.**

### Phase 2 — Enrichment: listing audit
Pluggable audit provider interface · Moz local-check automation (async, throttled, non-blocking) · `ListingAudits` + `listingHealthScore` on leads · surfaced as a filter/sort in the web app.

### Phase 3 — Qualification
Qualification service (Node) on your infra · BYO per-agency API key (encrypted in AgentX, retrieved at scoring time so tenants pay their own compute) · triggered by lead-created event (async) or before-write hook (sync-scored) — decide per §11 · `qualificationScore` written back · qualified-lead views. Transition `scraped → qualified`.

### Phase 4 — Build & propose
Sample-site generation on lead-qualified (assets in R2) · proposal generation + send via Resend · transitions `building → proposed`.

### Phase 5 — Sell & client space
Close handling, `proposed → sold` · lead → client conversion, `sold → client` · client workspace handoff. This is where the recurring-revenue layer lives.

---

## 11. Open decisions to resolve

1. **Qualification trigger:** async event (score after save, simpler, eventually-consistent) vs. before-write hook (score before save, instant, but adds latency to every lead write). Leaning async for scrape throughput — confirm.
2. **Code-signing cert:** OV vs. EV — decide before external tenants, since it gates SmartScreen trust.
3. **Moz automation vs. paid listing API** at scale — start with automation, define the volume threshold that triggers the swap.
4. **Stripe:** confirm subscription tiers + pricing model (per-seat, per-lead, flat) before wiring checkout.

_Resolved: TypeScript everywhere · monorepo (pnpm + Turborepo) · Tailwind v4 · Render for backend, GitHub Releases for desktop · straight Clerk login with secure OS token store._

---

## 12. Immediate next steps

1. Lock the AgentX schema (§4) and stand up the workflow state machine (§9) in the live project.
2. Scaffold the pnpm + Turborepo monorepo (§3 layout) and generate the AgentX TS client into `packages/agentx-client`.
3. Define the desktop ↔ AgentX **API contract**: exact payloads for posting leads and pulling queue jobs, with idempotency keys.
4. Stand up the Electron app + GitHub Actions build/sign/release pipeline so self-update works _before_ any scraping logic lands.
5. Build the scraper against a handful of ZIPs and tune stealth + selectors on real output.
