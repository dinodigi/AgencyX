# Backlog

Everything open, newest thinking first. Conventions in [`README.md`](README.md).
Tasks in the active sprint are marked **→ S01** etc.

---

## 1 · Desktop release — v0.1.0 (the last thing we were on)

Code-complete on `main` at `a040b40` (2026-07-18). Verified locally: Clerk
sign-in renders over loopback in packaged mode. **No tag exists yet** — the
release has never been cut.

| ID | Task | Owner | Size | Status | Notes |
|---|---|---|---|---|---|
| AX-001 | Add repo secret `AGENTX_DELIVERY_TOKEN` | dino | S | blocked → S01 | Value is in `apps/desktop/.env`. github.com/dinodigi/AgencyX → Settings → Secrets and variables → Actions. Claude is blocked from credential-provisioning paths — this one is yours. |
| AX-002 | Tag `v0.1.0` + push → verify the release build | dino | S | blocked → S01 | Blocked by AX-001; `desktop-release.yml` fails fast without the secret. Expected artifact: `AgencyX-Setup.exe`. |
| AX-003 | Ship `v0.1.1` to prove self-update end-to-end | claude | M | todo → S01 | **W1 exit gate.** electron-builder → GitHub Releases → electron-updater, proven on a real install. Never yet demonstrated. |
| AX-004 | Decide + order Authenticode cert (OV vs EV) | dino | M | todo | Roadmap open decision #2. Validation lead time is long; needed before any external tenant and for a clean SmartScreen. |
| AX-005 | Clerk `pk_live` switch + loopback origin allowlist | dino | S | todo | Currently on `pk_test_` (amusing-elk-34). Needed before non-internal users. |

## 2 · Qualification — close out the owed proof

All six build-order steps in `POST-DEPLOY.md` are built. What's owed is **live
proof and doc reconciliation**, not code.

| ID | Task | Owner | Size | Status | Notes |
|---|---|---|---|---|---|
| AX-006 | Live tuning: Maps deep re-scrape lookup match | claude | M | todo → S01 | The one sub-step that missed on the Tribute Hollywood live run (crawl + Moz both landed). Same §12.5 live-tuning pattern the phase-1 scraper needed. |
| AX-007 | Reconcile `POST-DEPLOY.md` with what's actually proven | claude | S | todo → S01 | Doc still says "first live click owed" for the AI brief and "Moz iframe labels need tuning" — both were reportedly cleared on the Urban Masala / Tribute runs. **Verify against a real run before editing the doc.** |
| AX-008 | Set `PAGESPEED_API_KEY` (local + Render) | dino | S | todo → S01 | Keyless PageSpeed 429s intermittently → performance score returns "unknown". Documented in `DEPLOY.md`. |
| AX-009 | Second full qualification run on a fresh lead | claude | M | todo → S01 | Regression proof that the loop is repeatable, not a one-off. `collected → scored → briefed` on a lead we haven't touched. |
| AX-010 | Decide the fate of the `apps/qualification` stub | claude | S | todo | It's an empty package (`package.json` only). Phase 3 in `roadmap.md` planned a standalone Render service; the work actually landed in `apps/desktop` + `apps/web`. Delete the stub and correct the roadmap, or justify keeping it. |

## 3 · Security & secrets hygiene

| ID | Task | Owner | Size | Status | Notes |
|---|---|---|---|---|---|
| AX-011 | Rotate the Anthropic key exposed in `artifact.json` | dino | S | todo → S01 | Flagged in `POST-DEPLOY.md` → Open/needed. Still listed as outstanding. |
| AX-012 | Rotate the Clerk secret key that appeared in chat | dino | S | todo → S01 | The `sk_test_` pasted into the connector's `publishableKey` field (2026-07-12). Connector config was fixed; the key itself was never confirmed rotated. |
| AX-013 | Audit shipped bundles for `AGENTX_MCP_TOKEN` | claude | S | todo | The MCP token is full-trust and bypasses org scoping — it must never appear in `apps/web` or `apps/desktop` output. Grep the built artifacts and add a CI guard. Routing rules: `agentx/TOKENS.md`. |

## 4 · Platform gaps still open from Phase 0/1

| ID | Task | Owner | Size | Status | Notes |
|---|---|---|---|---|---|
| AX-014 | Bring the replication worker online | claude+dino | M | todo | `apps/replicator` is built but has **never run** — it needs a Neon `DATABASE_URL`. This was specified as a *day-one* backup / vendor-exit hedge and is the one standing-infra item never actually live. |
| AX-015 | Coverage soft-gate before a scrape run | claude | M | todo | W2.6: read SearchQueries by keyword+ZIP before running, so we don't re-burn a covered area. |
| AX-016 | Org onboarding flow (Clerk org → JWT claim → Agencies row) | claude | M | todo | Bootstrap ordering matters; currently only the internal test org exists. |
| AX-017 | Lead-level ZIP filter (relation hop) | claude | S | todo | Delivery filters are equality-only — needs a precomputed field, same pattern as `has_website`. |
| AX-018 | Settings screen in the web app | claude | M | todo | Last unbuilt W3 screen. |
| AX-019 | Selector maintenance | claude | S | recurring | Standing cost line. Google DOM churn is expected; one-file fix by design (`scraper/selectors.ts`). Budget a slot each sprint. |

## 5 · Next phase — Build & propose (Phase 4)

Not started. Do not pull into a sprint until the release and qualification
sections above are clear.

| ID | Task | Owner | Size | Status | Notes |
|---|---|---|---|---|---|
| AX-020 | Sample-site generator on the `qualified` transition | claude | L | todo | Bundles can't ship through AgentX assets (no zip/js/css types) — host on our own R2, store URL + metadata on the lead. |
| AX-021 | Proposal generation + Resend send | claude | L | todo | **Dedupe before send** — transition actions deliver at-least-once and these emails go to real prospects. |
| AX-022 | Delayed follow-up nudges | claude | M | todo | Via `events.updated` + `after`; delays are unsupported on transition actions. |

## 6 · Deferred / out of scope (tracked, not scheduled)

- **Billing / Stripe** — internal tool, tenant #1 is our own agency. Stripe connector unconfigured in AgentX; AgentX checkout unusable regardless (payment-mode only).
- **BYO per-agency Claude keys** — blocked upstream: AgentX has no encrypted field type. Needs an app-side vault.
- **BrightLocal key** — the sanctioned listing-audit path at volume; the free Moz iframe is fine at current levels.
- **External-tenant gate** — the hard checklist in `roadmap.md` (vendor SOC2/GDPR answers, signing reputation, hostile-tenant isolation re-test, restore drill, scraping-ToS legal sign-off). Runs only if external tenants onboard.
