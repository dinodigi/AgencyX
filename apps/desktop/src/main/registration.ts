/**
 * Registration — on sign-in, ensure this org has an Agencies row, this user a
 * Users row, and this install a Devices row, then hand back their ids so scraped
 * leads carry agency/device relations and the queue-claim path can run.
 *
 * All three writes go through the DELIVERY API (org-scoped: org_id is stamped
 * from the JWT, reads return only this org's rows). Idempotent + race-safe via
 * each collection's unique key (agencies.org_id, users.email, devices.device_id):
 * create, and on a unique conflict fall back to the existing row. Same contract
 * as the outbox's syncLead (S1 spike).
 */

import type { LeadEngineClient } from "@dinosales/agentx-client";
import { isUniqueConflict } from "@dinosales/agentx-client";

export interface RegistrationInfo {
  orgId: string;
  deviceId: string;
  platform: "windows" | "mac";
  appVersion: string;
  email: string;
  name?: string;
}

export interface Registration {
  agencyRowId: string;
  userRowId: string;
  deviceRowId: string;
}

function agencyName(info: RegistrationInfo): string {
  const domain = info.email.split("@")[1];
  return domain ? `${domain}` : "My Agency";
}

async function ensureAgency(client: LeadEngineClient, info: RegistrationInfo): Promise<string> {
  try {
    const { id } = await client.ax.agencies.create({ org_id: info.orgId, name: agencyName(info) });
    return id;
  } catch (err) {
    if (!isUniqueConflict(err)) throw err;
    // Another device already created the org's agency — reads are org-scoped.
    const existing = await client.ax.agencies.list({ limit: 1 });
    if (existing[0]) return existing[0].id;
    throw err;
  }
}

async function ensureUser(client: LeadEngineClient, info: RegistrationInfo, agencyRowId: string): Promise<string> {
  try {
    const { id } = await client.ax.users.create({
      org_id: info.orgId,
      email: info.email,
      name: info.name,
      role: "scraper",
      agency: agencyRowId,
    });
    return id;
  } catch (err) {
    if (!isUniqueConflict(err)) throw err;
    const existing = await client.ax.users.list({ filter: { email: info.email }, limit: 1 });
    if (existing[0]) return existing[0].id;
    throw err;
  }
}

async function ensureDevice(
  client: LeadEngineClient,
  info: RegistrationInfo,
  agencyRowId: string,
  userRowId: string,
  nowIso: string,
): Promise<string> {
  try {
    const { id } = await client.ax.devices.create({
      org_id: info.orgId,
      device_id: info.deviceId,
      agency: agencyRowId,
      user: userRowId,
      platform: info.platform,
      app_version: info.appVersion,
      last_seen: nowIso,
    });
    return id;
  } catch (err) {
    if (!isUniqueConflict(err)) throw err;
    const existing = await client.ax.devices.list({ filter: { device_id: info.deviceId }, limit: 1 });
    const row = existing[0];
    if (!row) throw err;
    // Already registered — refresh presence.
    await client.update("devices", row.id, { last_seen: nowIso, app_version: info.appVersion });
    return row.id;
  }
}

export async function ensureRegistration(
  client: LeadEngineClient,
  info: RegistrationInfo,
  nowIso: string = new Date().toISOString(),
): Promise<Registration> {
  const agencyRowId = await ensureAgency(client, info);
  const userRowId = await ensureUser(client, info, agencyRowId);
  const deviceRowId = await ensureDevice(client, info, agencyRowId, userRowId, nowIso);
  return { agencyRowId, userRowId, deviceRowId };
}
