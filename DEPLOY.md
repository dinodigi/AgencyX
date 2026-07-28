# Deploy

Two independent targets: the **web app → Render** (SaaS backend UI) and the **desktop app → GitHub Releases** (downloadable client with self-update). All the config lives in the repo; the account-level steps below are yours (they need your Render/GitHub accounts + secrets).

---

## Web app → Render

The blueprint is [`render.yaml`](render.yaml) (a `lead-engine-web` Node web service).

**Live URL: <https://lead-engine-web-n1c5.onrender.com>** — note the `-n1c5` suffix.
Render appends one when the plain subdomain is taken, and `lead-engine-web.onrender.com`
belongs to an unrelated app, so guessing the URL from the service name lands you on
someone else's site.

**One-time setup (you):**
1. Render dashboard → **New → Blueprint** → connect this repo (`dinodigi/AgencyX`). Render reads `render.yaml`.
2. Set the four secret env vars (marked `sync: false`, so they're prompted in the dashboard, never in git):
   - `AGENTX_DELIVERY_TOKEN` — the **delivery** token, not the MCP token ([agentx/TOKENS.md](agentx/TOKENS.md))
   - `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`
   - `CLERK_SECRET_KEY`
   - `ANTHROPIC_API_KEY` — Claude API key for qualification AI briefs; also goes in `apps/web/.env.local` for local dev (gitignored)

   Optional: `PAGESPEED_API_KEY` (free, Google Cloud console → PageSpeed Insights API) — without it performance scoring works keyless at low volume and simply reports "unknown" when Google's quota bites.
3. Apply. Render builds (`pnpm install` + `pnpm --filter @dinosales/web build`) and starts (`next start`), health-checking `/api/health`.

After that, every push to `main` auto-deploys (`autoDeploy: true`).

**Clerk for production:** add the Render URL to Clerk's allowed origins, and (before real tenants) promote the Clerk instance from development to production keys. Confirm the session token still carries `org_id`/`org_role` via `/api/whoami`.

**Notes:**
- Build needs no C++ toolchain — the desktop's native deps are skipped by root `pnpm.neverBuiltDependencies`.
- `NEXT_PUBLIC_*` is inlined at build time; Render injects env for both build and runtime, so it's covered.

---

## Desktop app → GitHub Releases

The workflow is [`.github/workflows/desktop-release.yml`](.github/workflows/desktop-release.yml). It runs on a version tag, builds the Windows NSIS installer with electron-builder, and publishes it to GitHub Releases; `electron-updater` reads that feed for self-update.

**Release (you):**
```
# bump apps/desktop/package.json "version" to match, then:
git tag v0.1.0
git push origin v0.1.0
```
The `windows` job builds + publishes; the installer appears under **Releases**. A `workflow_dispatch` run (Actions tab → Run workflow) builds artifacts without publishing, for a dry run.

**Code signing (optional, internal tool → deferred):** unsigned installers trip Windows SmartScreen (a one-time "Run anyway" for your own team). To sign, add repo secrets `CSC_LINK` (base64 of the .pfx) + `CSC_KEY_PASSWORD`; the workflow picks them up automatically. OV vs EV is roadmap open-decision #2.

**Caveats (first release may need a tweak):**
- electron-builder rebuilds `better-sqlite3`/`keytar` for Electron's ABI on the runner. pnpm's symlinked `node_modules` occasionally needs tuning here; if the rebuild misbehaves, the app still runs (in-memory outbox + file token store fallbacks) — it just isn't durable/OS-secure until the native rebuild succeeds.
- Mac later = add a `macos-latest` matrix leg + notarization; the pipeline shape is already there.
