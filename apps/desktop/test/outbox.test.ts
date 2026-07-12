/**
 * Outbox test — the in-memory fallback behaves like the SQLite one, and the
 * factory always returns a working store (durable when better-sqlite3 is built,
 * in-memory otherwise) so the app launches with or without the C++ toolchain.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { MemoryOutbox, createOutbox, type NewLead } from "../src/main/outbox.ts";

const lead = (dedupKey: string): NewLead => ({
  dedupKey,
  placeId: dedupKey.split(":")[1] ?? dedupKey,
  businessName: `Biz ${dedupKey}`,
  payloadJson: JSON.stringify({ dedup_key: dedupKey }),
});

test("MemoryOutbox: enqueue, local dedup, lifecycle, stats", () => {
  const ob = new MemoryOutbox();
  assert.equal(ob.durable, false);
  assert.equal(ob.enqueue(lead("org:a"), 1), "queued");
  assert.equal(ob.enqueue(lead("org:a"), 2), "duplicate"); // same dedup_key
  assert.equal(ob.enqueue(lead("org:b"), 3), "queued");
  assert.deepEqual(ob.stats(), { pending: 2, synced: 0, failed: 0 });

  const pending = ob.nextPending(10);
  assert.equal(pending.length, 2);
  assert.equal(pending[0]!.dedupKey, "org:a"); // created_at order

  ob.markSynced(pending[0]!.localId, "remote-1");
  assert.deepEqual(ob.stats(), { pending: 1, synced: 1, failed: 0 });

  ob.markFailed(pending[1]!.localId, "boom");
  assert.deepEqual(ob.stats(), { pending: 0, synced: 1, failed: 1 });
  assert.equal(ob.requeueFailed(), 1);
  assert.deepEqual(ob.stats(), { pending: 1, synced: 1, failed: 0 });
});

test("createOutbox returns a working store even without native SQLite", () => {
  const warnings: string[] = [];
  const ob = createOutbox("C:/nonexistent-dir/should-not-matter.sqlite3", (m) => warnings.push(m));
  // Whichever backend, enqueue works.
  assert.equal(ob.enqueue(lead("org:x"), 1), "queued");
  assert.equal(ob.stats().pending, 1);
  // In this repo better-sqlite3 isn't built, so we expect the memory fallback + a warning.
  if (!ob.durable) assert.ok(warnings.some((w) => /in-memory/i.test(w)));
  ob.close();
});
