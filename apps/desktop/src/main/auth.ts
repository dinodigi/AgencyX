/**
 * Auth manager — a MIRROR of the renderer's auth. The renderer owns sign-in
 * (Clerk in the Electron browser, or the dev paste-form) and pushes the current
 * session token here via IPC (`auth:setSession`), re-pushing a fresh token
 * before each expiry. Main just holds the AgentX client (delivery token + the
 * user's JWT) and reflects the state — no refresh loop, no token persistence
 * (Clerk persists its own session in the renderer).
 */

import { createLeadEngineClient, type LeadEngineClient } from "@dinosales/agentx-client";
import type { AuthState } from "../shared/ipc.ts";

export interface SessionInput {
  email: string;
  orgId: string;
  token: string;
  expiresAt: number;
}

export class AuthManager {
  private client: LeadEngineClient | null = null;
  private state: AuthState = { status: "signed-out" };
  private orgId: string | null = null;

  constructor(
    private readonly deliveryToken: string,
    private readonly onChange: (state: AuthState) => void,
    private readonly onLog: (level: "info" | "warn" | "error", message: string) => void,
  ) {}

  getClient(): LeadEngineClient | null {
    return this.client;
  }

  getState(): AuthState {
    return this.state;
  }

  /**
   * Set or refresh the session. Notifies (→ registration re-runs) only on first
   * sign-in or an org switch; a plain token refresh silently swaps the client's
   * token so ongoing sync/registration keep working.
   */
  setSession(input: SessionInput): AuthState {
    const firstSignIn = this.state.status !== "signed-in";
    const orgChanged = this.orgId !== null && this.orgId !== input.orgId;

    if (!this.client) {
      this.client = createLeadEngineClient({ token: this.deliveryToken, userToken: input.token });
    } else {
      this.client.setUserToken(input.token);
    }
    this.orgId = input.orgId;
    this.state = { status: "signed-in", email: input.email, orgId: input.orgId, expiresAt: input.expiresAt };

    if (firstSignIn) this.onLog("info", `signed in as ${input.email}`);
    if (firstSignIn || orgChanged) this.onChange(this.state);
    return this.state;
  }

  signOut(): AuthState {
    this.client = null;
    this.orgId = null;
    this.state = { status: "signed-out" };
    this.onLog("info", "signed out");
    this.onChange(this.state);
    return this.state;
  }
}
