# Sprint 01 — Cut the release, prove the loop

**Dates:** 2026-07-28 → 2026-08-03
**Goal:** v0.1.0 is a real downloadable release with self-update proven, and the
qualification loop has run end-to-end a second time on a fresh lead.

Two threads that have both been sitting at 95%. Neither needs new features —
they need a tag, a live run, and honest docs.

## Committed

| ID | Task | Owner | Size | Status |
|---|---|---|---|---|
| AX-001 | Add repo secret `AGENTX_DELIVERY_TOKEN` | dino | S | blocked |
| AX-002 | Tag `v0.1.0` + push → verify the release build | dino | S | blocked |
| AX-003 | Ship `v0.1.1` to prove self-update end-to-end (W1 exit gate) | claude | M | todo |
| AX-006 | Live tuning: Maps deep re-scrape lookup match | claude | M | todo |
| AX-007 | Reconcile `POST-DEPLOY.md` with what's actually proven | claude | S | todo |
| AX-008 | Set `PAGESPEED_API_KEY` (local + Render) | dino | S | todo |
| AX-009 | Second full qualification run on a fresh lead | claude | M | todo |
| AX-011 | Rotate the Anthropic key exposed in `artifact.json` | dino | S | todo |
| AX-012 | Rotate the Clerk secret key that appeared in chat | dino | S | todo |

## Stretch

| ID | Task | Owner | Size | Status |
|---|---|---|---|---|
| AX-010 | Decide the fate of the `apps/qualification` stub | claude | S | todo |
| AX-013 | Audit shipped bundles for `AGENTX_MCP_TOKEN` | claude | S | todo |

## Blockers

- **AX-001 blocks AX-002 blocks AX-003** — the whole release thread is one
  hand-off deep. `desktop-release.yml` fails fast without the secret, so nothing
  downstream can start until it's set. This has been the standing blocker since
  2026-07-18.
- **AX-006 / AX-009 need a real machine + live Google + Moz** — they can't be
  done from tests alone.

## Daily notes

**2026-07-28** — Sprint opened. Confirmed the release state: `main` clean and in
sync with `origin` at `a040b40`, **no git tags exist** — v0.1.0 was never cut.
`apps/qualification` is still a bare stub (`package.json` only); the phase-3 work
lives in `apps/desktop` + `apps/web`.

## Retro

_(fill at end of sprint)_
