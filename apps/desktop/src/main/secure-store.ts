/**
 * Token storage in the OS secure store (Windows Credential Manager via keytar),
 * never plaintext on disk (brief §7.1). The renderer can never read these — it
 * only ever sees AuthState (email/org/expiry) issued over IPC.
 *
 * Split of concerns:
 *   - secret material (session + refresh tokens) → OS keychain (keytar)
 *   - non-secret metadata (email/org/expiry) → a small JSON file in userData,
 *     so we can restore the session on next launch without unlocking anything
 *     the renderer shouldn't see.
 */

import { readFileSync, writeFileSync, rmSync, existsSync } from "node:fs";
import keytar from "keytar";

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

let cache: StoredAuth | null = null;
let metaPath = "";

/** Call once from main with app.getPath('userData') + '/auth-meta.json'. */
export function initSecureStore(path: string): void {
  metaPath = path;
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
  const sessionToken = await keytar.getPassword(SERVICE, ACCOUNT_SESSION);
  if (!sessionToken) return null;
  const refreshToken = (await keytar.getPassword(SERVICE, ACCOUNT_REFRESH)) ?? undefined;
  cache = { sessionToken, refreshToken, ...meta };
  return cache;
}

export async function saveAuth(auth: StoredAuth): Promise<void> {
  await keytar.setPassword(SERVICE, ACCOUNT_SESSION, auth.sessionToken);
  if (auth.refreshToken) await keytar.setPassword(SERVICE, ACCOUNT_REFRESH, auth.refreshToken);
  writeMeta({ email: auth.email, orgId: auth.orgId, expiresAt: auth.expiresAt });
  cache = auth;
}

export async function updateSessionToken(sessionToken: string, expiresAt: number): Promise<void> {
  if (!cache) throw new Error("no auth to refresh");
  await keytar.setPassword(SERVICE, ACCOUNT_SESSION, sessionToken);
  cache = { ...cache, sessionToken, expiresAt };
  writeMeta({ email: cache.email, orgId: cache.orgId, expiresAt });
}

export async function clearAuth(): Promise<void> {
  await keytar.deletePassword(SERVICE, ACCOUNT_SESSION);
  await keytar.deletePassword(SERVICE, ACCOUNT_REFRESH);
  if (metaPath && existsSync(metaPath)) rmSync(metaPath);
  cache = null;
}

export function currentToken(): string | null {
  return cache?.sessionToken ?? null;
}

export function currentAuth(): StoredAuth | null {
  return cache;
}
