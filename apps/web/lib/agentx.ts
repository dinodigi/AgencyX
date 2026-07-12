import "server-only";
import { createLeadEngineClient, type LeadEngineClient } from "@dinosales/agentx-client";
import { getSession, type Session } from "./auth.ts";

/**
 * Server-only AgentX access. The delivery project token stays here (never sent
 * to the browser); the user's Clerk JWT is forwarded as X-User-Token so every
 * read/write is org-scoped by AgentX. All data flows through Server Components
 * and Server Actions — the browser never talks to AgentX directly.
 */

const DELIVERY_TOKEN = process.env.AGENTX_DELIVERY_TOKEN ?? "";

export function clientFor(session: Session): LeadEngineClient {
  return createLeadEngineClient({ token: DELIVERY_TOKEN, userToken: session.userToken });
}

/**
 * Resolve the session with both client surfaces, or null when signed out.
 * - `ax`     = generated per-collection client (list/get/create) for reads.
 * - `client` = the wrapper (upsertSearchQuery, syncLead, update, search, …).
 */
export async function withClient(): Promise<
  { session: Session; client: LeadEngineClient; ax: LeadEngineClient["ax"] } | null
> {
  const session = await getSession();
  if (!session) return null;
  const client = clientFor(session);
  return { session, client, ax: client.ax };
}

/** True when the deployment has a delivery token configured (build/dev guard). */
export function isConfigured(): boolean {
  return DELIVERY_TOKEN.length > 0;
}
