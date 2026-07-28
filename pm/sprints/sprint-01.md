# Sprint 01 — Cut the release, prove the loop

**Dates:** 2026-07-28 → 2026-08-03
**Goal:** v0.1.0 is a real downloadable release with self-update proven, and the
qualification loop has run end-to-end a second time on a fresh lead.

Two threads that have both been sitting at 95%. Neither needs new features —
they need a tag, a live run, and honest docs.

## Committed

| ID | Task | Owner | Size | Status |
|---|---|---|---|---|
| AX-001 | Add repo secret `AGENTX_DELIVERY_TOKEN` | dino | S | **done** |
| AX-002 | Cut and publish the first release | claude | S | **done** — v0.1.1 live |
| AX-003 | Ship `v0.1.2` to prove self-update end-to-end (W1 exit gate) | claude | M | todo |
| AX-024 | Decide `releaseType` — keep drafting or auto-publish | claude+dino | S | todo |
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

- ~~AX-001 blocks AX-002 blocks AX-003~~ — cleared 2026-07-28. The whole release
  chain is unblocked; AX-003 now has a published baseline to update from.
- **AX-006 / AX-009 need a real machine + live Google + Moz** — they can't be
  done from tests alone.

## Daily notes

**2026-07-28** — Sprint opened. Confirmed the release state: `main` clean and in
sync with `origin` at `a040b40`, **no git tags exist** — v0.1.0 was never cut.
`apps/qualification` is still a bare stub (`package.json` only); the phase-3 work
lives in `apps/desktop` + `apps/web`.

**2026-07-28 (later)** — AX-001 done, first release attempted, and it failed —
usefully. Run 30343523005 died in electron-builder at the asar stage:
`packages/agentx-client/package.json must be under apps/desktop/`. Cause: the
three `@dinosales/*` workspace packages were runtime `dependencies`, so
electron-builder tried to collect them from `../../packages/*`, outside
`appDir`. They were never needed at runtime — `build.mjs` bundles their TS into
`dist/`. Moved to `devDependencies` (`b6a8518`); native rebuild and the Electron
download had already been passing.

Two things worth remembering:
- **The tag couldn't be re-pointed** (deleting a remote tag is blocked here), so
  0.1.1 became the first published version and the self-update proof shifts to
  v0.1.2. `v0.1.0` is now a dud tag → AX-025.
- **electron-builder drafts releases by default.** The build reports success and
  publishes nothing visible. Caught because the public releases API returned
  empty while the run was green → AX-024.

Run 30344497513 green end-to-end. Draft 0.1.1 held `AgencyX-Setup.exe`
(83.8 MB), `AgencyX-Setup.exe.blockmap`, `latest.yml` (330 B). 41 desktop tests
green locally.

**2026-07-28 (end of day)** — Draft published; `releases/latest` now resolves to
v0.1.1 with `draft=false`. **AX-002 done.** Followed it into the web app: the
download link was only on `/devices`, so it moved to the sidebar (pinned bottom,
renders signed-out) and the URL + SmartScreen wording were pulled into
`apps/web/lib/desktop.ts` so there's one definition. Verified on the dev server.

Noticed while verifying, not acted on: the local dev server logs
`Clerk: Refreshing the session token resulted in an infinite redirect loop —
your Clerk instance keys do not match`. Pre-existing local env issue, unrelated
to this work, but it will block local sign-in testing → AX-026.

**2026-07-28 (incident)** — The installed v0.1.1 desktop app failed at runtime:
`device registration failed: this token is mcp-scoped (authoring)`. The value in
`apps/desktop/.env` named `AGENTX_DELIVERY_TOKEN` was the **MCP** token, so a
full-trust credential got baked into a public installer. Nothing in the chain
checked the token's scope — the secret guard only checked that *something* was
set, and the name was taken at face value all the way through.

Remediation is AX-027 (rotate) and AX-028 (delete the release); both are the
user's to do and both were still open at end of day. AX-029 tracks getting the
real delivery token into `.env` and the repo secret.

Built the missing guard (`check-token.mjs`): it asks the delivery API what the
token actually is before packaging, and fails the release on either
"mcp-scoped" or "invalid or missing project token". Grounded in the live API's
real responses rather than guessed — a bogus token passed the first version,
which is how the second failure mode got found. Running it locally is what
proved `.env` still holds the MCP token.

Lesson worth keeping: **a variable's name is not evidence of its contents.** The
reasoning that a delivery token is safe to ship was right; the premise that the
file held one was never tested.

## Retro

_(fill at end of sprint)_
