# Desktop (Electron scraper client)

Windows-first Electron app. This is the W1 shell: login, secure token storage, local SQLite outbox, the sync engine, and self-update. **Scraper automation (Playwright) is intentionally NOT here yet** — per brief §12.4 the build/sign/release loop ships and is proven first.

## Architecture
- **main** (`src/main`) — Node side. Owns the network, SQLite, tokens, and the AgentX client. `index.ts` wires it together.
  - `secure-store.ts` — tokens in Windows Credential Manager (keytar); non-secret metadata in a `0600` userData file.
  - `auth.ts` — AgentX client + Clerk JWT **refresh loop** (JWTs are ~60s, runs are hours; AgentX only verifies, refresh is ours).
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

## Native modules
`better-sqlite3` and `keytar` are native. Local installs skip their gyp compile (root `pnpm.neverBuiltDependencies`) since this repo may lack a C++ toolchain; **electron-builder rebuilds them for Electron's ABI at package time.** To run `pnpm dev` locally you need them built once for your Electron: install the VS C++ Build Tools, then `pnpm rebuild better-sqlite3 keytar` (or `electron-rebuild`).

## Not wired yet (tracked)
- Clerk sign-in UI + real `refreshFn` (main `index.ts` returns null → clean sign-out instead of mid-run 401). Dev sign-in accepts a pasted JWT so the app runs against a real org now.
- `AGENTX_DELIVERY_TOKEN` is read from env at build; move to a build-time define before shipping.
- Scraper engine (W2) and its queue-claim calls (`claimQuery` already in the shared client).

## Release pipeline (W1 exit gate)
`.github/workflows/desktop-release.yml` (tag-triggered) → electron-builder → GitHub Releases → electron-updater self-update. Needs the Authenticode cert secrets (`CSC_LINK`, `CSC_KEY_PASSWORD`) — roadmap open decision #2. **Prove this end-to-end on a dummy build before W2.**
