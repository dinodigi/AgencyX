# AgencyX — Post-Deploy Roadmap

> **Repo note:** this project's folder is `C:\dev\DinoSales`; its product name is
> **AgencyX** (GitHub `dinodigi/AgencyX`). **AgencyOS** (`agency-os-*.onrender.com`)
> is a **separate, unrelated** prior system — the `artifact.json` sample came from
> it and is reference-only. Nothing here touches AgencyOS.

Hosted (rendered) version, kept in sync:
<https://claude.ai/code/artifact/57cc48c7-b4f0-49d3-bb9e-c19dde3df3c3>

What we build **after** the management pipeline shipped. Two workstreams turn it
from "runs" into "runs well": a scraper rebuilt on stable anchors (done), then the
qualification phase that researches a lead and drafts its brief (in progress —
schema + client live, desktop job next).

---

## Where we are — already live

Scrape → pipeline · unified search + batch · speed profiles · desktop auto-run ·
live sync (poll + SSE) · agency profile + logo · services + packages catalog ·
stage advance/reverse.

---

## Workstream 1 — Phase-1 scraper rebuild ✅ SHIPPED

The shaky data (`Results` as a name, 0 reviews, 5.0 ratings) traced to one cause:
we parsed Google's rotating CSS classes. A fresh-session recon settled the fix.

- **No clean JSON endpoint on Google** — Maps internals are opaque protobuf we
  won't build on; we parse HTML off **stable anchors**.
- **Stay on Maps, not Search.** A cold session on `google.com/search` (tbm=lcl /
  the Knowledge Panel, where the cleaner selectors live) trips the `/sorry`
  unusual-traffic block. Maps tolerates the anonymous sessions we run.
- **Stable anchors:**
  - `/g/…` Knowledge-Graph MID (from the Maps place href `!16s`) → dedup key.
  - Name from the result link's `aria-label`; rating/reviews from "N stars" /
    "N reviews" aria-labels; phone/website from `data-item-id`; name from `h1`.
    **No CSS class touched.**
- **Website** cleaned of `utm_*` tracking; **hours** captured as the full weekly
  schedule (per-day, split shifts), expanding "See more hours" when collapsed —
  after reading the core fields so the expand can't clobber the name.
- Verified end-to-end through the production esbuild bundle; 15 desktop tests
  green. Files: `apps/desktop/src/main/scraper/{selectors,google-source}.ts`.

---

## Workstream 2 — Qualification (`scraped → qualified`)  ◀ NEXT

A deep-research job that turns a bare lead into a decision-ready dossier, then an
AI drafts the brief. The lead page becomes phase-aware: at `qualified` the basic
card swaps for the qualification workspace. Grounded in the real `scan → plan →
build` artifact.

### Where each step runs

| Step | Collects | Runs |
|---|---|---|
| 1 · Deep re-scrape | Full listing detail (reuses the new stable selectors) | desktop |
| 2 · Site crawl + SEO | Full crawl (bounded) → silo, on-page signals, tech | desktop |
| 3 · Performance | Core Web Vitals / Lighthouse | PageSpeed API (server) |
| 4 · Listing audit | Moz score + per-directory NAP consistency | desktop |
| 5 · Scoring | Deterministic sub-scores → business health | web |
| 6 · AI brief | Compiles signals into the structured brief | Claude (web) |

### Moz listing audit — nailed down (verified 2026-07-13)

Free tool is an **iframe** `#check-listing-iframe` → `moz.com/freemium/local/check-listing`.
Fields: Company, Street, City, State, Zip · button "Check Now" (no phone).
**Async:** poll `local.listing.reports.fetch.background` (~90s, retry on timeout);
a durable `reportId` lands in the URL → submit now, fetch later. Parse the
intercepted JSON, not the MUI table. Runs as a non-blocking sub-job. BrightLocal
(the artifact was wired for it) stays the sanctioned path at volume.

### The brief (AI output)

One Claude pass, on demand, producing structured `brief_json`, shaped by the
artifact's proven `plan`:
- **seo** — score, audit, keyword strategy, silo, roadmap, redesign
- **brand** — essence, voice, visual direction, verified facts
- **proposal** — summary, scope, outcomes → linked to the packages catalog

Scores are deterministic (explainable); the AI writes the narrative on top.

### Schema — ✅ SHIPPED (live 2026-07-13)

- **`qualifications`** (new · 1:1 lead, enforced by unique `dedup_key` =
  `{orgId}:{leadId}`): `status` workflow
  `pending→collecting→collected→scored→briefed` (+ `failed` off both collect
  and score; `scored`/`briefed`/`failed` → `pending` for retry/re-run) ·
  `website_url` · six 0–100 scores — `seo_score`, `content_score`, `ux_score`
  (the artifact's proven score shape) + `performance_score`, `listing_score`,
  `business_health_score` (the composite) · `page_count` · richtext blobs
  `scan_json` / `brief_json` (AgentX has no JSON field type) · `model`,
  `collected_at`, `briefed_at`. Kept separate so blobs don't bloat lead reads.
  The extra `collected` state exists because delivery filters are
  equality-only — the web must be able to query "signals up, awaiting scoring".
- **`listing_audits`** (enriched): added `report_id` (durable Moz report),
  `directories_json` (per-source), `score` (0–100). Feeds the lead's
  `listing_health_score`. Additive redefine — zero entries affected.
- Client regenerated (`packages/agentx-client/src/generated.ts`), manifest
  re-exported, and the CI lint now guards the `qualifications.status` workflow
  like `leads.stage`. Workflow enforcement verified live: a create with a
  non-initial status is rejected.

---

## Build order

1. **Rebuild phase-1 scraper** — ✅ shipped.
2. **Qualification schema + client** — ✅ shipped: `qualifications` collection
   live (workflow enforcement verified), `listing_audits` enriched, client
   regenerated, manifest synced + lint extended. Typecheck and 15 tests green.
3. **Desktop qualification job** — ✅ built (2026-07-13, 14 new tests · 29 green):
   claim `pending→collecting` (stamp-settle-verify) → deep re-scrape (Maps
   lookup on the stable anchors) → bounded same-origin crawl (30-page/120s
   caps) with on-page signals + silo + tech detect → Moz submit/poll sub-job
   (durable `reportId` → `listing_audits`) → `scan_json` lands
   `collecting→collected`. The web queues jobs from the lead page ("Qualify
   this lead"); desktop auto-run claims them once the search queue is idle;
   every sub-step degrades gracefully (block → cool-down, no website / bad
   address → skip with a warning). **TODO: live tuning pass on a real machine
   — the Maps lookup match and the Moz iframe labels — same §12.5 pattern the
   scraper needed.**
4. **Scoring + performance** — ◀ next: PageSpeed + deterministic sub-scores → business health.
5. **Qualification workspace** — phase-switching lead view (scores, silo, on-page
   issues, Moz results, live progress).
6. **AI brief** — Claude server-side, structured `brief_json`, on demand.

---

## Decisions locked

- Scraper anchors: `/g/` id + Maps `aria-label` / `data-item-id`.
- Crawl: full, with a page/time safety cap.
- Scoring: deterministic + AI narrative.
- Moz: free iframe tool, async sub-job.
- AI: Claude, single server-side key, on demand.

## Open / needed

- **Rotate** the Anthropic key that was exposed in the `artifact.json`.
- BrightLocal key — optional, for listing audit at scale.
- Out of scope now: billing, BYO-per-tenant key (blocked by no encrypted field in
  AgentX), Build / Propose phases.
