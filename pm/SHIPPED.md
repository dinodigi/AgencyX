# Shipped

What landed and what proved it. Newest first. Entries move here from
`BACKLOG.md` only when verified, not when merely built.

Entries before 2026-07-28 are reconstructed from git history and
`POST-DEPLOY.md` — they predate this tracker, so they carry no task IDs.

---

## Sprint 01

### AX-002 · Desktop v0.1.1 — first published release (2026-07-28)
`AgencyX-Setup.exe` (83.8 MB) is live at
[releases/latest](https://github.com/dinodigi/AgencyX/releases/latest), with
`latest.yml` + `.blockmap` alongside it for electron-updater.

Took three commits and one instructive failure:
- The first tagged build died in electron-builder — the `@dinosales/*` workspace
  packages were runtime `dependencies`, so it tried to collect them from
  `../../packages/*`, outside `appDir`, which asar packing refuses. They're
  build-time only (esbuild inlines them into `dist/`), so they moved to
  `devDependencies` (`b6a8518`).
- The `v0.1.0` tag couldn't be re-pointed at the fix, so the version bumped to
  0.1.1 (`8a4c6ec`) — which also keeps the git tag and the electron-builder
  release name in step, since electron-builder names releases from
  `package.json`, not from the tag.
- electron-builder **drafts** releases by default: run 30344497513 was green
  while nothing was publicly visible. Publishing the draft is what made
  `/releases/latest/download/…` resolve — verified via the API
  (`latest → v0.1.1`, `draft=false`).

*Proof:* CI run 30344497513 green on every step; 41 desktop tests green locally;
`releases/latest` resolves to v0.1.1 with the installer asset present.

### Desktop download in the web app (2026-07-28)
The download link moved out of `/devices` and into the sidebar, pinned at the
bottom so it's reachable from every page — and it renders **signed-out**, so a
new user can install before they have an account. URL and the
unsigned/SmartScreen wording now live in one module (`apps/web/lib/desktop.ts`)
instead of being inlined at the call site. *Proof:* rendered on the dev server —
sidebar link resolves to the release asset, no console errors, typecheck green.

---

## Pre-tracker (2026-07-12 → 2026-07-18)

### Desktop release pipeline — `a040b40` (2026-07-18)
Loopback renderer so Clerk cookie sessions work in packaged mode (file:// broke
them), delivery token baked at build time via esbuild define from a CI secret,
stable installer name `AgencyX-Setup.exe`, download button on the web Devices
page. *Proof:* Clerk sign-in renders over loopback in a local packaged build.
**Not yet released** — see AX-001/002.

### Account bar + theme switcher — `edf0f7c`
Top-right account bar, light/dark switcher.

### Qualification phase (all 6 build-order steps) — `66ea6e2` → `df9a8ee`
- **Schema + client** (`66ea6e2`) — `qualifications` collection live with the
  `pending→collecting→collected→scored→briefed` workflow (enforcement verified:
  a create with a non-initial status is rejected), `listing_audits` enriched
  with `report_id`/`directories_json`/`score`, client regenerated, CI lint
  extended to guard the new workflow.
- **Desktop collection job** (`d5f8298`) — claim → deep re-scrape → bounded
  same-origin crawl (30 pages / 120s, robots.txt-compliant, sitemap-seeded) →
  Moz submit/poll sub-job with durable `reportId`. 29 tests green.
- **Scoring + performance** — deterministic sub-scores (seo/content/ux from
  crawl signals, listing from Moz) + PageSpeed → business-health composite,
  mirrored onto the lead. Every score carries human-readable reasons.
  *Proof:* live Tribute Hollywood scan → seo 63 · content 12 · ux 79 ·
  listing 26 → **business 45/100**.
- **Qualification workspace + stage safeguard** (`88936af`, `df9a8ee`) — score
  tiles, crawl table, silo, on-page warnings, Moz results, live status, tabbed
  layout + listings detail table. `scraped→qualified` blocked in UI *and* server
  action until research is reviewable.
- **Cleanup-first qualify + fairer Moz scoring** (`cc66ae4`) — deterministic
  normalization pass, then a Claude judgment call only when heuristics flag it
  (normalize-never-invent). Moz `NeedsAttention` = half credit, Moz-side scan
  errors excluded. *Proof:* Moz form fill verified exact against the raw live
  report; scan completed in 134s (timeout raised to 240s).
- **AI brief** — manual "Score + generate AI brief" button, one `claude-opus-4-8`
  structured-output pass producing `brief_json` (seo/brand/proposal), grounded
  in the deterministic scores + the agency's packages catalog. Re-runnable, never
  automatic. *Proof: reportedly a full `collected→scored→briefed` run on "Urban
  Masala" — needs confirming, see AX-007.*

### Phase-1 scraper rebuild — `eb2e082`, `8260c14`
Root cause of the shaky data (`Results` as a name, 0 reviews, 5.0 ratings) was
parsing Google's rotating CSS classes. Rebuilt on stable anchors: `/g/`
Knowledge-Graph MID from the Maps `!16s` href as the dedup key, name from the
result link's `aria-label`, rating/reviews from "N stars"/"N reviews" labels,
phone/website from `data-item-id`. No CSS class touched. Website URLs stripped
of `utm_*`; full weekly hours captured including split shifts. *Proof:* verified
end-to-end through the production esbuild bundle, 15 desktop tests green.

### Pipeline UX — `5ee7c47`, `adad62b`, `dd800b3`, `b13c43f`
Live sync (web polls, desktop streams — no manual refresh), optimistic stage
advance, surfaced failures instead of silent no-ops, and stage reversal to undo
a mistaken advance.

### Foundations (Phase 0 + W1/W2/W3)
pnpm + Turborepo monorepo; AgentX schema live and org-scoped with `access.org`
row isolation; typed delivery client + hand-written wrapper; desktop Electron
shell (secure store, outbox, sync engine, updater); source-agnostic scraper
engine with stealth + human pacing + CAPTCHA cool-down; Next.js web app (leads,
batches, coverage, devices) with Clerk auth. *Proof:* org isolation and workflow
enforcement verified live via MCP across two test orgs — cross-tenant reads
return nothing, illegal transitions rejected.
