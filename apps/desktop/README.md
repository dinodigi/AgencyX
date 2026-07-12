# Desktop (Electron scraper client)

Windows-first Electron app. This is the W1 shell: login, secure token storage, local SQLite outbox, the sync engine, and self-update. **Scraper automation (Playwright) is intentionally NOT here yet** — per brief §12.4 the build/sign/release loop ships and is proven first.

## Architecture
- **main** (`src/main`) — Node side. Owns the network, SQLite, tokens, and the AgentX client. `index.ts` wires it together.
  - `secure-store.ts` — tokens in Windows Credential Manager (keytar); non-secret metadata in a `0600` userData file.
  - `auth.ts` — AgentX client + Clerk JWT **refresh loop** (JWTs are ~60s, runs are hours; AgentX only verifies, refresh is ours).
  - `registration.ts` — on sign-in, idempotently ensures the org's **Agencies** row + the user's **Users** row + this install's **Devices** row via the delivery API (race-safe via each collection's unique key); a 5-min heartbeat refreshes `last_seen`. Its ids populate the run context so leads carry agency/device relations.
  - `outbox.ts` — SQLite buffer; leads write locally first (`dedup_key` UNIQUE), drained by the sync engine.
  - `sync-engine.ts` — drains the outbox via `syncLead()`; retry-safe with **no delivery idempotency** (unique-conflict → already-synced, the S1 spike contract).
  - `updater.ts` — electron-updater reading the GitHub Releases feed.
- **preload** (`src/preload`) — the only renderer↔main bridge. `contextIsolation` on, `nodeIntegration` off, `sandbox` on. Renderer sees exactly `window.leadEngine`.
- **renderer** (`src/renderer`) — React UI: sign-in, search queue, live run log, sync/device status bar. No Node/network access.
- **shared** (`src/shared/ipc.ts`) — the typed IPC contract both processes import so they can't drift.

## Build
- `pnpm build` — esbuild bundles main+preload (`build.mjs`), Vite builds the renderer. **Verified green.**
- `pnpm typecheck` — main + renderer tsconfigs. **Verified green.**
- `pnpm dist` — electron-builder → signed NSIS installer (`release/`).

## Run it (test as you build)
```
pnpm --filter @dinosales/desktop doctor   # what mode you'll get + what's missing
pnpm --filter @dinosales/desktop dev       # launches the Electron window
```
`dev` starts Vite (renderer), bundles main+preload (esbuild), and opens Electron. It loads `apps/desktop/.env` (see `.env.example`) for `AGENTX_DELIVERY_TOKEN`.

**It launches with NO C++ toolchain.** The two native modules degrade gracefully:
- `better-sqlite3` missing → in-memory outbox (non-durable; leads lost on quit — fine for UI testing).
- `keytar` missing → tokens in a `0600` file (not OS-secure; dev only).

So you can immediately: sign in (dev form — paste any email/org/JWT), run a **mock scrape** (dry-run on by default), watch the live log, and see leads queue. With `AGENTX_DELIVERY_TOKEN` + a real Clerk JWT, sign-in also registers the device and sync/queue-claim reach AgentX.

### Full (native) mode — durable + OS-secure
Install **Visual Studio Build Tools** with the "Desktop development with C++" workload, then:
```
pnpm --filter @dinosales/desktop rebuild better-sqlite3 keytar
```
electron-builder rebuilds these for Electron's ABI automatically at package time (`pnpm dist`), so shipped installers are always full-mode.

## Scraper (W2 — `src/main/scraper`)
Source-agnostic engine driving a `ScrapeSource`:
- `types.ts` — `ScrapeSource`/`ScrapeOutcome`, `ScrapeBlockedError`, `SelectorMissError`.
- `google-source.ts` — real Playwright/Chrome + stealth (dynamic-imported; **selectors need tuning on live output, §12.5**).
- `mock-source.ts` — deterministic listings for tests + dry-run.
- `selectors.ts` — all Google Maps anchors (one-file fix), placeId/CID + rating parsing.
- `human.ts` — jittered delays, viewport/UA randomization (the anti-detection pacing).
- `engine.ts` — one run; cool-down on CAPTCHA; distinct completed/zero-results/blocked/error outcomes.
- `runner.ts` — claim → scrape → convert (dedup key + buckets) → outbox → complete/fail. `runAdhoc` for the pre-registration loop.
- `test/pipeline.test.ts` — 4 tests, **green** (`pnpm test`), prove the loop without Google.

## Not wired yet (tracked)
- Clerk sign-in UI + real `refreshFn` (main `index.ts` returns null → clean sign-out instead of mid-run 401). Dev sign-in accepts a pasted JWT so the app runs against a real org now.
- `AGENTX_DELIVERY_TOKEN` is read from env at build; move to a build-time define before shipping.
- Device + agency registration (Devices/Agencies rows) → then `runQuery` queue-claim can replace `runAdhoc`, and leads carry the agency/device relations.
- Real Google selectors tuned on live output; coverage soft-gate before a run.

## Release pipeline (W1 exit gate)
`.github/workflows/desktop-release.yml` (tag-triggered) → electron-builder → GitHub Releases → electron-updater self-update. Needs the Authenticode cert secrets (`CSC_LINK`, `CSC_KEY_PASSWORD`) — roadmap open decision #2. **Prove this end-to-end on a dummy build before W2.**
