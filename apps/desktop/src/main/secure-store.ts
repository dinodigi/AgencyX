/**
 * Token storage. Preferred backend is the OS secure store (Windows Credential
 * Manager via keytar), never plaintext on disk (brief §7.1). If keytar isn't
 * available (native module not built — e.g. no C++ toolchain), it falls back to
 * a 0600 file in userData so the app still LAUNCHES for dev/testing — with a
 * loud warning, since that is NOT OS-secure. Ship builds rebuild keytar.
 *
 * Either way the renderer never sees tokens — only AuthState (email/org/expiry).
 * Non-secret metadata always lives in a small JSON file so the session can be
 * restored on next launch.
 */

import { readFileSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";

const SERVICE = "com.dinosales.leadengine";
const ACCOUNT_SESSION = "clerk-session-token";
const ACCOUNT_REFRESH = "clerk-refresh-token";

export interface StoredAuth {
  sessionToken: string;
  refreshToken?: string;
  email: string;
  orgId: string;
  expiresAt: number;
}

type Meta = Pick<StoredAuth, "email" | "orgId" | "expiresAt">;

interface Keytar {
  getPassword(service: string, account: string): Promise<string | null>;
  setPassword(service: string, account: string, password: string): Promise<void>;
  deletePassword(service: string, account: string): Promise<boolean>;
}

let cache: StoredAuth | null = null;
let metaPath = "";
let onWarn: (msg: string) => void = () => {};

// keytar backend, resolved once. `undefined` = not tried; `null` = unavailable.
let keytar: Keytar | null | undefined;

function keychain(): Keytar | null {
  if (keytar !== undefined) return keytar;
  try {
    keytar = require("keytar") as Keytar;
  } catch (err) {
    keytar = null;
    onWarn(
      `OS keychain (keytar) unavailable (${err instanceof Error ? err.message : String(err)}) — ` +
        `storing tokens in a 0600 file (NOT OS-secure; dev only). Rebuild native modules for secure storage.`,
    );
  }
  return keytar;
}

function tokensPath(): string {
  return join(dirname(metaPath), "auth-tokens.json");
}

function readTokenFile(): Record<string, string> {
  const p = tokensPath();
  if (!existsSync(p)) return {};
  try {
    return JSON.parse(readFileSync(p, "utf8")) as Record<string, string>;
  } catch {
    return {};
  }
}

async function kcGet(account: string): Promise<string | null> {
  const kc = keychain();
  if (kc) return kc.getPassword(SERVICE, account);
  return readTokenFile()[account] ?? null;
}

async function kcSet(account: string, value: string): Promise<void> {
  const kc = keychain();
  if (kc) return void kc.setPassword(SERVICE, account, value);
  const all = readTokenFile();
  all[account] = value;
  writeFileSync(tokensPath(), JSON.stringify(all), { mode: 0o600 });
}

async function kcDelete(account: string): Promise<void> {
  const kc = keychain();
  if (kc) {
    await kc.deletePassword(SERVICE, account);
    return;
  }
  const all = readTokenFile();
  delete all[account];
  writeFileSync(tokensPath(), JSON.stringify(all), { mode: 0o600 });
}

/** Call once from main with the auth-meta.json path (+ a warn sink). */
export function initSecureStore(path: string, warn?: (msg: string) => void): void {
  metaPath = path;
  if (warn) onWarn = warn;
}

function readMeta(): Meta | null {
  if (!metaPath || !existsSync(metaPath)) return null;
  try {
    return JSON.parse(readFileSync(metaPath, "utf8")) as Meta;
  } catch {
    return null;
  }
}

function writeMeta(meta: Meta): void {
  writeFileSync(metaPath, JSON.stringify(meta), { mode: 0o600 });
}

export async function loadAuth(): Promise<StoredAuth | null> {
  if (cache) return cache;
  const meta = readMeta();
  if (!meta) return null;
  const sessionToken = await kcGet(ACCOUNT_SESSION);
  if (!sessionToken) return null;
  const refreshToken = (await kcGet(ACCOUNT_REFRESH)) ?? undefined;
  cache = { sessionToken, refreshToken, ...meta };
  return cache;
}

export async function saveAuth(auth: StoredAuth): Promise<void> {
  await kcSet(ACCOUNT_SESSION, auth.sessionToken);
  if (auth.refreshToken) await kcSet(ACCOUNT_REFRESH, auth.refreshToken);
  writeMeta({ email: auth.email, orgId: auth.orgId, expiresAt: auth.expiresAt });
  cache = auth;
}

export async function updateSessionToken(sessionToken: string, expiresAt: number): Promise<void> {
  if (!cache) throw new Error("no auth to refresh");
  await kcSet(ACCOUNT_SESSION, sessionToken);
  cache = { ...cache, sessionToken, expiresAt };
  writeMeta({ email: cache.email, orgId: cache.orgId, expiresAt });
}

export async function clearAuth(): Promise<void> {
  await kcDelete(ACCOUNT_SESSION);
  await kcDelete(ACCOUNT_REFRESH);
  if (metaPath && existsSync(metaPath)) rmSync(metaPath);
  cache = null;
}

export function currentToken(): string | null {
  return cache?.sessionToken ?? null;
}

export function currentAuth(): StoredAuth | null {
  return cache;
}
