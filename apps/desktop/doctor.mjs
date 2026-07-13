/**
 * Preflight for `pnpm dev`. Reports which mode the desktop app will run in
 * (durable vs in-memory / secure vs file token store) and what env is set, so
 * "test as we build" has no surprises. Never fails — it's informational.
 */
import { existsSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const ok = (b) => (b ? "✓" : "✗");

function canLoad(mod) {
  try {
    require(mod);
    return true;
  } catch {
    return false;
  }
}

if (existsSync(".env")) {
  try {
    process.loadEnvFile(".env");
  } catch {
    /* ignore */
  }
}

const sqlite = canLoad("better-sqlite3");
const keytar = canLoad("keytar");
const electron = canLoad("electron");
const token = Boolean(process.env.AGENTX_DELIVERY_TOKEN);
const clerk = Boolean(process.env.VITE_CLERK_PUBLISHABLE_KEY);

console.log(`
AgencyX — desktop preflight
────────────────────────────────────────────
 Node ${process.version}
 ${ok(electron)} electron            ${electron ? "ready" : "run: pnpm install"}
 ${ok(sqlite)} better-sqlite3      ${sqlite ? "durable outbox" : "→ in-memory fallback (leads lost on quit)"}
 ${ok(keytar)} keytar              ${keytar ? "OS secure token store" : "→ 0600 file fallback (not OS-secure)"}
 ${ok(token)} AGENTX_DELIVERY_TOKEN ${token ? "set" : "unset → sign-in won't reach AgentX (mock runs still work)"}
 ${ok(clerk)} VITE_CLERK_PUBLISHABLE_KEY ${clerk ? "set → real Clerk sign-in" : "unset → dev paste-form (mock testing)"}

 Mode: ${sqlite && keytar ? "FULL (native)" : "DEV FALLBACK — the app runs; scrape→outbox→UI all work"}
 Auth: ${clerk ? "Clerk sign-in" : "dev paste-form"}
${sqlite && keytar ? "" : `
 To get FULL mode, build the native modules for Electron once:
   1. Install "Visual Studio Build Tools" with the "Desktop development with C++" workload
   2. pnpm --filter @dinosales/desktop rebuild better-sqlite3 keytar
      (or: npx electron-rebuild -f -w better-sqlite3,keytar)
`}────────────────────────────────────────────
`);
