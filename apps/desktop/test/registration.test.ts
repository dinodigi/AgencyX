/**
 * Registration test — proves ensureRegistration is idempotent and race-safe:
 * a fresh install creates agency/user/device; a second run (same org/email/
 * device, e.g. another launch or a concurrent device) reuses the existing rows
 * via unique-conflict fallback rather than duplicating. Uses an in-memory fake
 * that enforces the same unique keys AgentX does.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { AgentXError } from "@dinosales/agentx-client";
import type { LeadEngineClient } from "@dinosales/agentx-client";
import { ensureRegistration, type RegistrationInfo } from "../src/main/registration.ts";

const INFO: RegistrationInfo = {
  orgId: "org_test",
  deviceId: "dev-uuid-1",
  platform: "windows",
  appVersion: "0.1.0",
  email: "sarah@acme.com",
  name: "Sarah",
};

function uniqueConflict(field: string): AgentXError {
  return new AgentXError(422, `${field}: value already exists — this field is unique`, "E_VALIDATION");
}

/** Minimal AgentX fake: one table per collection, enforcing a unique key each. */
function makeFakeClient() {
  let seq = 0;
  const tables: Record<string, Array<Record<string, unknown>>> = { agencies: [], users: [], devices: [] };
  const uniqueKey: Record<string, string> = { agencies: "org_id", users: "email", devices: "device_id" };

  function coll(name: string) {
    return {
      async create(data: Record<string, unknown>): Promise<{ id: string }> {
        const key = uniqueKey[name]!;
        if (tables[name]!.some((r) => r[key] === data[key])) throw uniqueConflict(key);
        const id = `${name}-${++seq}`;
        tables[name]!.push({ id, ...data });
        return { id };
      },
      async list(opts?: { filter?: Record<string, unknown>; limit?: number }): Promise<Array<{ id: string } & Record<string, unknown>>> {
        let rows = tables[name]! as Array<{ id: string } & Record<string, unknown>>;
        if (opts?.filter) rows = rows.filter((r) => Object.entries(opts.filter!).every(([k, v]) => r[k] === v));
        return rows.slice(0, opts?.limit ?? rows.length);
      },
    };
  }

  const client = {
    ax: { agencies: coll("agencies"), users: coll("users"), devices: coll("devices") },
    async update(collection: string, id: string, patch: Record<string, unknown>) {
      const row = tables[collection]!.find((r) => r.id === id);
      if (row) Object.assign(row, patch);
      return row;
    },
  };
  return { client: client as unknown as LeadEngineClient, tables };
}

test("fresh install creates agency, user, and device", async () => {
  const { client, tables } = makeFakeClient();
  const reg = await ensureRegistration(client, INFO, "2026-07-12T00:00:00.000Z");

  assert.equal(reg.agencyRowId, "agencies-1");
  assert.equal(reg.userRowId, "users-2");
  assert.equal(reg.deviceRowId, "devices-3");
  assert.equal(tables.agencies!.length, 1);
  assert.equal(tables.users!.length, 1);
  assert.equal(tables.devices!.length, 1);
  // Device links to the agency + user and stamps presence.
  const device = tables.devices![0]!;
  assert.equal(device.agency, "agencies-1");
  assert.equal(device.user, "users-2");
  assert.equal(device.last_seen, "2026-07-12T00:00:00.000Z");
});

test("second run reuses existing rows (no duplicates) and refreshes device presence", async () => {
  const { client, tables } = makeFakeClient();
  const first = await ensureRegistration(client, INFO, "2026-07-12T00:00:00.000Z");
  const second = await ensureRegistration(client, { ...INFO, appVersion: "0.2.0" }, "2026-07-12T09:00:00.000Z");

  assert.deepEqual(second, first); // same ids
  assert.equal(tables.agencies!.length, 1);
  assert.equal(tables.users!.length, 1);
  assert.equal(tables.devices!.length, 1);
  // Presence refreshed on the existing device row.
  assert.equal(tables.devices![0]!.last_seen, "2026-07-12T09:00:00.000Z");
  assert.equal(tables.devices![0]!.app_version, "0.2.0");
});

test("a second device in the same org reuses the agency + user, adds its own device row", async () => {
  const { client, tables } = makeFakeClient();
  await ensureRegistration(client, INFO, "2026-07-12T00:00:00.000Z");
  const reg2 = await ensureRegistration(client, { ...INFO, deviceId: "dev-uuid-2" }, "2026-07-12T00:00:00.000Z");

  assert.equal(reg2.agencyRowId, "agencies-1"); // shared agency
  assert.equal(reg2.userRowId, "users-2"); // shared user
  assert.equal(tables.agencies!.length, 1);
  assert.equal(tables.devices!.length, 2); // two devices
});
