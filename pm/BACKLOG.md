# Backlog

Everything open, newest thinking first. Conventions in [`README.md`](README.md).
Tasks in the active sprint are marked **→ S01** etc.

---

## 1 · Desktop release — v0.1.0 (the last thing we were on)

**v0.1.1 is published and downloadable** (2026-07-28). Remaining work here is
the self-update gate and signing.

| ID | Task | Owner | Size | Status | Notes |
|---|---|---|---|---|---|
| AX-003 | Ship `v0.1.2` to prove self-update end-to-end | claude | M | todo → S01 | **W1 exit gate.** Was going to be v0.1.1, but that number got spent recovering from the packaging bug. Now unblocked — v0.1.1 is published, so there's a real baseline to update *from*: install v0.1.1, ship v0.1.2, watch it self-update. |
| AX-024 | Decide `releaseType` — keep drafting or auto-publish | claude+dino | S | todo → S01 | Default drafts every release, so each one needs a manual publish click. Setting `releaseType: release` in `electron-builder.yml` makes tags publish straight away. Draft-by-default is the safer habit while unsigned; worth a deliberate call rather than rediscovering it each time. |
| AX-025 | Delete the stale `v0.1.0` tag | dino | S | todo | Points at the pre-fix commit `23def18` with no release attached. Harmless but reads like a shipped version. Bin icon at github.com/dinodigi/AgencyX/tags, then `git tag -d v0.1.0` locally. |
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

> **KNOWN EXPOSURE — RISK ACCEPTED (2026-07-28):** the MCP token (full-trust,
> bypasses org scoping) was baked into the **public** v0.1.1 installer, under
> the `AGENTX_DELIVERY_TOKEN` name, because nothing verified the scope. Found
> when the installed app failed with *"this token is mcp-scoped (authoring)"*.
> Dino's call: single-operator internal tool, not worth rotating now. Logged so
> it's a decision on the record rather than an oversight — **revisit before the
> first external tenant**, where it joins the hard gate in `roadmap.md`.

| ID | Task | Owner | Size | Status | Notes |
|---|---|---|---|---|---|
| AX-027 | Rotate the MCP token | dino | S | **deferred — risk accepted** | Closes the exposure. [pluggie.app admin](https://pluggie.app/admin/52bd98fd-695e-4e1e-ba38-b4ec00df74eb) → Settings → Tokens, then update `~/.claude.json` + replicator/qualification env. Deferred 2026-07-28; **blocker for external tenants**, not optional then. |
| AX-028 | Delete the v0.1.1 release | claude | S | todo | Now mostly a *product* issue, not a security one: v0.1.1 can't register devices, and it's what `releases/latest` — and the new sidebar download button — points at. Delete it **after** v0.1.2 ships, so the button is never pointing at nothing. |
| AX-029 | Put the delivery token in `.env` + repo secret | dino | S | todo | A "Prod" delivery token was minted 2026-07-28 17:15 but **`apps/desktop/.env` still holds the MCP token** — proven by `pnpm --filter @dinosales/desktop check:token`. Both the local file and the GitHub secret need the delivery token before v0.1.2 can ship. |
| AX-011 | Rotate the Anthropic key exposed in `artifact.json` | dino | S | todo → S01 | Flagged in `POST-DEPLOY.md` → Open/needed. Still listed as outstanding. |
| AX-012 | Rotate the Clerk secret key that appeared in chat | dino | S | todo → S01 | The `sk_test_` pasted into the connector's `publishableKey` field (2026-07-12). Connector config was fixed; the key itself was never confirmed rotated. |
| AX-013 | Audit shipped bundles for `AGENTX_MCP_TOKEN` | claude | S | **partly done** | Logged as a theoretical risk on the morning of 2026-07-28; it happened that afternoon. The release gate now exists (`apps/desktop/check-token.mjs`, wired into `desktop-release.yml`) and asks the API for the token's scope before packaging — a name check would not have caught this. **Still owed:** the same guard for `apps/web` (Render env), where the value is set by hand in a dashboard with nothing verifying it. |

## 4 · Platform gaps still open from Phase 0/1

| ID | Task | Owner | Size | Status | Notes |
|---|---|---|---|---|---|
| AX-014 | Bring the replication worker online | claude+dino | M | todo | `apps/replicator` is built but has **never run** — it needs a Neon `DATABASE_URL`. This was specified as a *day-one* backup / vendor-exit hedge and is the one standing-infra item never actually live. |
| AX-015 | Coverage soft-gate before a scrape run | claude | M | todo | W2.6: read SearchQueries by keyword+ZIP before running, so we don't re-burn a covered area. |
| AX-016 | Org onboarding flow (Clerk org → JWT claim → Agencies row) | claude | M | todo | Bootstrap ordering matters; currently only the internal test org exists. |
| AX-017 | Lead-level ZIP filter (relation hop) | claude | S | todo | Delivery filters are equality-only — needs a precomputed field, same pattern as `has_website`. |
| AX-018 | Settings screen in the web app | claude | M | todo | Last unbuilt W3 screen. |
| AX-026 | Fix the local Clerk key mismatch | dino | S | todo | The dev server logs `Refreshing the session token resulted in an infinite redirect loop — your Clerk instance keys do not match`. `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` and `CLERK_SECRET_KEY` in `apps/web/.env.local` must come from the *same* Clerk instance. Blocks local signed-in testing; spotted 2026-07-28. |
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
