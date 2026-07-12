/**
 * Auth manager. Owns the AgentX client instance (delivery token + the user's
 * Clerk JWT) and the refresh loop.
 *
 * WHY A REFRESH LOOP (assessment UNKNOWN #7, brief §7.1): Clerk session JWTs are
 * short-lived (≈60s), but scrape runs last hours. AgentX only verifies the JWT;
 * refresh is entirely our problem. So the main process must mint a fresh session
 * token before each expiry and swap it into the client. The actual Clerk call is
 * injected (`refreshFn`) so this is testable and so the Clerk wiring lives in
 * one place; until it's wired, the loop degrades to signing out with a clear log
 * rather than silently 401-ing mid-run.
 */

import { createLeadEngineClient, type LeadEngineClient } from "@dinosales/agentx-client";
import { saveAuth, updateSessionToken, clearAuth, loadAuth, type StoredAuth } from "./secure-store.ts";
import type { AuthState } from "../shared/ipc.ts";

/** Returns a fresh session token + its expiry, or null if refresh failed. */
export type RefreshFn = (refreshToken: string | undefined) => Promise<{ sessionToken: string; expiresAt: number } | null>;

const REFRESH_SKEW_MS = 15_000; // refresh this long before actual expiry

export class AuthManager {
  private client: LeadEngineClient | null = null;
  private refreshTimer: NodeJS.Timeout | null = null;

  constructor(
    private readonly deliveryToken: string,
    private readonly refreshFn: RefreshFn,
    private readonly onChange: (state: AuthState) => void,
    private readonly onLog: (level: "info" | "warn" | "error", message: string) => void,
  ) {}

  /** Restore a persisted session on launch, if any. */
  async restore(): Promise<void> {
    const auth = await loadAuth();
    if (auth) this.activate(auth);
  }

  getClient(): LeadEngineClient | null {
    return this.client;
  }

  getState(): AuthState {
    const auth = this._auth;
    if (!auth) return { status: "signed-out" };
    return { status: "signed-in", email: auth.email, orgId: auth.orgId, expiresAt: auth.expiresAt };
  }

  private _auth: StoredAuth | null = null;

  async signIn(auth: StoredAuth): Promise<AuthState> {
    await saveAuth(auth);
    this.activate(auth);
    this.onLog("info", `signed in as ${auth.email}`);
    return this.getState();
  }

  async signOut(): Promise<AuthState> {
    if (this.refreshTimer) clearTimeout(this.refreshTimer);
    this.refreshTimer = null;
    this.client = null;
    this._auth = null;
    await clearAuth();
    this.onLog("info", "signed out");
    const state = this.getState();
    this.onChange(state);
    return state;
  }

  private activate(auth: StoredAuth): void {
    this._auth = auth;
    if (!this.client) {
      this.client = createLeadEngineClient({ token: this.deliveryToken, userToken: auth.sessionToken });
    } else {
      this.client.setUserToken(auth.sessionToken);
    }
    this.scheduleRefresh(auth.expiresAt);
    this.onChange(this.getState());
  }

  private scheduleRefresh(expiresAt: number): void {
    if (this.refreshTimer) clearTimeout(this.refreshTimer);
    const delay = Math.max(0, expiresAt - Date.now() - REFRESH_SKEW_MS);
    this.refreshTimer = setTimeout(() => void this.doRefresh(), delay);
  }

  private async doRefresh(): Promise<void> {
    const auth = this._auth;
    if (!auth) return;
    try {
      const next = await this.refreshFn(auth.refreshToken);
      if (!next) {
        this.onLog("warn", "token refresh returned nothing — signing out to avoid mid-run 401s");
        await this.signOut();
        return;
      }
      await updateSessionToken(next.sessionToken, next.expiresAt);
      this._auth = { ...auth, sessionToken: next.sessionToken, expiresAt: next.expiresAt };
      this.client?.setUserToken(next.sessionToken);
      this.scheduleRefresh(next.expiresAt);
      this.onChange(this.getState());
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.onLog("error", `token refresh failed: ${msg}; retrying in 30s`);
      this.refreshTimer = setTimeout(() => void this.doRefresh(), 30_000);
    }
  }
}
