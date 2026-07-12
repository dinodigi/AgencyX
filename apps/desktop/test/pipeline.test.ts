/**
 * Pipeline test — proves the scraper→outbox→query-status flow end to end using
 * the deterministic MockSource and in-memory fakes (no Electron, no SQLite, no
 * Google). Run: pnpm --filter @dinosales/desktop test
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { ScrapeRunner, type RunContext } from "../src/main/scraper/runner.ts";
import { MockSource } from "../src/main/scraper/mock-source.ts";
import type { NewLead } from "../src/main/outbox.ts";

const CTX: RunContext = { orgId: "org_test", agencyRowId: "agency-1", deviceRowId: "device-1" };

function makeHarness(source: () => MockSource) {
  const enqueued: NewLead[] = [];
  const completed: Array<{ queryId: string; count: number }> = [];
  const failed: string[] = [];
  const runner = new ScrapeRunner({
    outbox: { enqueue: (lead) => (enqueued.push(lead), "queued") },
    makeSource: source,
    claim: async () => ({ claimed: true }),
    complete: async (queryId, count) => void completed.push({ queryId, count }),
    fail: async (queryId) => void failed.push(queryId),
    onLog: () => {},
    onOutcome: () => {},
    now: () => "2026-07-12T00:00:00.000Z",
    maxLeads: 50,
  });
  return { runner, enqueued, completed, failed };
}

test("happy path: mock listings become outbox leads and the query completes", async () => {
  const h = makeHarness(() => new MockSource({ count: 5 }));
  const outcome = await h.runner.runQuery("q1", "plumbers", "78704", CTX, new AbortController().signal);

  assert.equal(outcome.kind, "completed");
  assert.equal(outcome.captured, 5);
  assert.equal(h.enqueued.length, 5);
  assert.deepEqual(h.completed, [{ queryId: "q1", count: 5 }]);
  assert.equal(h.failed.length, 0);

  // Conversion correctness: dedup key, precomputed filter fields.
  const first = JSON.parse(h.enqueued[0]!.payloadJson);
  assert.equal(first.org_id, "org_test");
  assert.equal(first.dedup_key, `org_test:${first.place_id}`);
  assert.equal(first.stage, "scraped");
  assert.equal(first.search_query, "q1");
  assert.equal(first.has_website, typeof first.website === "string" && first.website.length > 0);
  assert.ok(["none", "low", "medium", "high"].includes(first.review_bucket));
  // review_count 0 ⇒ bucket "none"
  const zeroReview = h.enqueued.map((e) => JSON.parse(e.payloadJson)).find((l) => l.review_count === 0);
  if (zeroReview) assert.equal(zeroReview.review_bucket, "none");
});

test("dedup keys are unique per placeId within a run", async () => {
  const h = makeHarness(() => new MockSource({ count: 6 }));
  await h.runner.runQuery("q2", "plumbers", "78704", CTX, new AbortController().signal);
  const keys = h.enqueued.map((e) => e.dedupKey);
  assert.equal(new Set(keys).size, keys.length);
});

test("CAPTCHA mid-run ⇒ blocked outcome with backoff, query failed", async () => {
  const h = makeHarness(() => new MockSource({ count: 6, blockAfter: 2 }));
  const outcome = await h.runner.runQuery("q3", "plumbers", "78704", CTX, new AbortController().signal);

  assert.equal(outcome.kind, "blocked");
  assert.ok((outcome.backoffMs ?? 0) > 0);
  assert.equal(h.enqueued.length, 2); // captured before the block are still buffered
  assert.deepEqual(h.failed, ["q3"]);
  assert.equal(h.completed.length, 0);
});

test("lost claim ⇒ skips without scraping", async () => {
  const enqueued: NewLead[] = [];
  const runner = new ScrapeRunner({
    outbox: { enqueue: (lead) => (enqueued.push(lead), "queued") },
    makeSource: () => new MockSource({ count: 5 }),
    claim: async () => ({ claimed: false, reason: "lost-race" }),
    complete: async () => {},
    fail: async () => {},
    onLog: () => {},
    onOutcome: () => {},
    now: () => "2026-07-12T00:00:00.000Z",
  });
  const outcome = await runner.runQuery("q4", "plumbers", "78704", CTX, new AbortController().signal);
  assert.equal(outcome.kind, "cancelled");
  assert.equal(enqueued.length, 0);
});
