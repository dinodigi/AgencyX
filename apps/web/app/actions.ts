"use server";

import { revalidatePath } from "next/cache";
import { AgentXError } from "@dinosales/agentx-client";
import { makeQueryDedupKey, makeQualificationDedupKey } from "@dinosales/types";
import type { NormalizedSearch } from "@dinosales/ui/search";
import { withClient } from "@/lib/agentx.ts";
import { computeScores, fetchPerformanceScore, generateBriefJson, parseScan } from "@/lib/qualify.ts";

/** Qualification states whose research results are reviewable. */
const REVIEWABLE = ["collected", "scored", "briefed"];

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

function isRateLimit(e: unknown): boolean {
  return e instanceof AgentXError && (e.status === 429 || /too many requests/i.test(e.message));
}

/**
 * Run one delivery-API call with 429-aware exponential backoff. AgentX
 * rate-limits the delivery API (limits undocumented) and has no bulk
 * endpoints, so every loop of writes must pace itself and absorb 429s.
 * Gives up after ~15s of continuous rate-limiting (0.5+1+2+4+8).
 */
async function withBackoff<T>(fn: () => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (e) {
      if (!isRateLimit(e) || attempt >= 5) throw e;
      await sleep(500 * 2 ** attempt);
    }
  }
}

/** Gap between calls in a write loop — stay politely under the limiter. */
const WRITE_PACE_MS = 200;

export interface QueueSearchResult {
  ok: boolean;
  created?: number;
  requeued?: number;
  skipped?: number;
  total?: number;
  message?: string;
  error?: string;
}

/**
 * The one search action — powers both Single and Batch (Single is a batch of
 * one). Takes the normalized unit list + target filter + pacing from the shared
 * SearchForm and writes one search_queries row per keyword × ZIP, carrying speed
 * and detail_level so the desktop runs each search exactly how it was queued.
 *
 * Re-submitting is safe: existing units are either left as-is ("skip") or bumped
 * back to pending with refreshed options ("requeue") — never duplicated. All
 * writes pace + back off around AgentX's delivery-API rate limit.
 */
export async function queueSearch(n: NormalizedSearch): Promise<QueueSearchResult> {
  const ctx = await withClient();
  if (!ctx) return { ok: false, error: "Not signed in." };
  if (n.units === 0) return { ok: false, error: "Enter at least one keyword and one ZIP." };
  if (n.units > 500) return { ok: false, error: `${n.units} units exceeds the 500-unit safety cap for one batch.` };

  const base = {
    max_leads: n.maxLeads,
    target_website: n.filter.target_website,
    min_reviews: n.filter.min_reviews,
    max_reviews: n.filter.max_reviews,
    min_rating: n.filter.min_rating,
    speed: n.speed,
    detail_level: n.detailLevel,
  };

  let created = 0;
  let requeued = 0;
  let skipped = 0;
  try {
    for (const keyword of n.keywords) {
      for (const zip of n.zips) {
        const dedup_key = makeQueryDedupKey(ctx.session.orgId, keyword, zip);
        const res = await withBackoff(() =>
          ctx.client.upsertSearchQuery({ org_id: ctx.session.orgId, dedup_key, keyword, zip, ...base }),
        );
        if (!res.alreadySynced) {
          created++;
        } else if (n.recoverage === "requeue") {
          // Existing coverage — refresh options and bump to the back of the FIFO
          // line, unless a device is scraping it right now.
          const current = await withBackoff(() => ctx.ax.search_queries.get(res.id));
          const patch: Record<string, unknown> = { ...base };
          if (current.status !== "running") {
            patch.status = "pending";
            patch.queued_at = new Date().toISOString();
          }
          await withBackoff(() => ctx.client.update("search_queries", res.id, patch));
          requeued++;
        } else {
          skipped++;
        }
        await sleep(WRITE_PACE_MS);
      }
    }
  } catch (e) {
    const done = created + requeued + skipped;
    const msg = isRateLimit(e)
      ? `Queued ${done} of ${n.units}, then AgentX kept rate-limiting. Re-submit — already-created units are skipped, not duplicated.`
      : e instanceof Error
        ? e.message
        : String(e);
    return { ok: false, error: msg, created, requeued, skipped };
  }

  revalidatePath("/coverage");
  const parts: string[] = [];
  if (created) parts.push(`${created} queued`);
  if (requeued) parts.push(`${requeued} re-queued`);
  if (skipped) parts.push(`${skipped} already covered (skipped)`);
  return {
    ok: true,
    created,
    requeued,
    skipped,
    total: n.units,
    message: `${parts.join(" · ") || "Nothing to do"}. The desktop scrapes queued searches when it's idle.`,
  };
}

export interface DeleteResult {
  ok: boolean;
  deleted?: number;
  error?: string;
}

/** Delete one or more leads. Owner/admin only (enforced by the delivery API's
 *  write access). No bulk endpoint exists, so this paces one DELETE at a time
 *  and absorbs 429s; on a hard rate-limit it reports partial progress. */
export async function deleteLeads(ids: string[]): Promise<DeleteResult> {
  const ctx = await withClient();
  if (!ctx) return { ok: false, error: "Not signed in." };
  const unique = [...new Set(ids.filter(Boolean))];
  if (unique.length === 0) return { ok: false, error: "Nothing selected." };

  let deleted = 0;
  try {
    for (const id of unique) {
      await withBackoff(() => ctx.client.remove("leads", id));
      deleted++;
      if (deleted < unique.length) await sleep(WRITE_PACE_MS);
    }
  } catch (e) {
    revalidatePath("/leads"); // some may have deleted before the failure — show that
    const msg = e instanceof Error ? e.message : String(e);
    const detail = isRateLimit(e)
      ? `Deleted ${deleted} of ${unique.length}, then AgentX kept rate-limiting. Wait a few seconds and delete the rest.`
      : `Deleted ${deleted} of ${unique.length} — then: ${msg}`;
    return { ok: false, deleted, error: detail };
  }
  revalidatePath("/leads");
  return { ok: true, deleted };
}

export interface QualifyQueueResult {
  ok: boolean;
  /** The qualification row's current status after the action. */
  status?: string;
  message?: string;
  error?: string;
}

/**
 * Queue the lead's deep-research qualification job. Idempotent (1:1 via
 * dedup_key): a fresh lead gets a pending row the desktop claims; an existing
 * failed row is bumped back to pending (the workflow's retry transition); any
 * other status just reports where the job already is.
 */
export async function queueQualification(_prev: QualifyQueueResult, formData: FormData): Promise<QualifyQueueResult> {
  const ctx = await withClient();
  if (!ctx) return { ok: false, error: "Not signed in." };
  const leadId = String(formData.get("leadId") ?? "");
  if (!leadId) return { ok: false, error: "Missing lead." };

  try {
    const res = await ctx.client.upsertQualification({
      org_id: ctx.session.orgId,
      dedup_key: makeQualificationDedupKey(ctx.session.orgId, leadId),
      lead: leadId,
    });
    if (!res.alreadySynced) {
      revalidatePath(`/leads/${leadId}`);
      return { ok: true, status: "pending", message: "Queued — the desktop collects it next time it's idle." };
    }
    const row = await ctx.ax.qualifications.get(res.id);
    if (row.status === "failed") {
      await ctx.client.update("qualifications", res.id, { status: "pending" });
      revalidatePath(`/leads/${leadId}`);
      return { ok: true, status: "pending", message: "Re-queued after a failure." };
    }
    return { ok: true, status: row.status, message: `Already ${row.status ?? "queued"}.` };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export interface StageResult {
  ok: boolean;
  error?: string;
  stage?: string;
}

/** Move a lead to another pipeline stage — forward or back one step. AgentX's
 *  workflow enforces that only a declared transition is allowed (both directions
 *  are declared; skipping stages is still rejected). App-layer safeguard on top:
 *  a lead can't become `qualified` until its qualification research has actually
 *  run and its results are reviewable (the workflow can't express cross-collection
 *  guards, so this gate lives here — the human surface). */
export async function advanceStage(_prev: StageResult, formData: FormData): Promise<StageResult> {
  const ctx = await withClient();
  if (!ctx) return { ok: false, error: "Not signed in." };
  const leadId = String(formData.get("leadId") ?? "");
  const toStage = String(formData.get("toStage") ?? "");
  if (!leadId || !toStage) return { ok: false, error: "Missing lead or stage." };

  if (toStage === "qualified") {
    try {
      const qual = (await ctx.ax.qualifications.list({ filter: { lead: leadId }, limit: 1 }))[0];
      if (!qual || !REVIEWABLE.includes(qual.status ?? "")) {
        return {
          ok: false,
          error: qual
            ? `Qualification is still ${qual.status ?? "pending"} — the research must finish before this lead can be qualified.`
            : "Run qualification first — a lead is only qualified once its research results are reviewable.",
        };
      }
    } catch (e) {
      return { ok: false, error: `Couldn't verify the qualification: ${e instanceof Error ? e.message : String(e)}` };
    }
  }

  try {
    await ctx.client.update("leads", leadId, { stage: toStage });
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
  revalidatePath(`/leads/${leadId}`);
  revalidatePath("/leads");
  return { ok: true, stage: toStage };
}

export interface BriefResult {
  ok: boolean;
  message?: string;
  error?: string;
}

/**
 * Manual trigger (tokens cost — never automatic): deterministic scoring +
 * PageSpeed, then one Claude pass for the brief. Re-runnable — scores are
 * recomputed and the brief regenerated on every click.
 * Status flow: collected → scored (after the numbers) → briefed (after Claude).
 */
export async function scoreAndBrief(_prev: BriefResult, formData: FormData): Promise<BriefResult> {
  const ctx = await withClient();
  if (!ctx) return { ok: false, error: "Not signed in." };
  const qualId = String(formData.get("qualId") ?? "");
  const leadId = String(formData.get("leadId") ?? "");
  if (!qualId || !leadId) return { ok: false, error: "Missing qualification or lead." };
  if (!process.env.ANTHROPIC_API_KEY) return { ok: false, error: "ANTHROPIC_API_KEY is not configured on the server." };

  try {
    const qual = await ctx.ax.qualifications.get(qualId);
    if (!REVIEWABLE.includes(qual.status ?? "")) {
      return { ok: false, error: `Signals aren't collected yet (status: ${qual.status ?? "pending"}) — run the desktop job first.` };
    }
    const scan = parseScan(qual.scan_json);
    if (!scan) return { ok: false, error: "No usable scan data on this qualification — re-run collection." };
    const lead = await ctx.ax.leads.get(leadId);

    // 1 · deterministic scores (+ PageSpeed for performance)
    const performance = qual.website_url ? await fetchPerformanceScore(qual.website_url) : null;
    const scores = computeScores(scan, performance);
    const scorePatch: Record<string, unknown> = {};
    if (scores.seo) scorePatch.seo_score = scores.seo.score;
    if (scores.content) scorePatch.content_score = scores.content.score;
    if (scores.ux) scorePatch.ux_score = scores.ux.score;
    if (scores.performance) scorePatch.performance_score = scores.performance.score;
    if (scores.listing) scorePatch.listing_score = scores.listing.score;
    if (scores.business) scorePatch.business_health_score = scores.business.score;
    await ctx.client.update("qualifications", qualId, {
      ...(qual.status === "collected" ? { status: "scored" } : {}),
      ...scorePatch,
    });

    // 2 · the brief (grounded in the agency's actual catalog)
    const catalog = await ctx.ax.packages
      .list({ filter: { active: true }, limit: 50 })
      .then((rows) => rows.map((p) => ({ name: p.name, summary: p.summary, price: p.price, billing: p.billing })))
      .catch(() => []);
    const { brief, model } = await generateBriefJson({
      leadName: lead.business_name,
      category: lead.category,
      address: lead.address,
      phone: lead.phone,
      websiteUrl: qual.website_url ?? lead.website,
      rating: scan.listing?.rating ?? lead.rating,
      reviewCount: scan.listing?.reviewCount ?? lead.review_count,
      claimed: scan.listing?.claimed ?? lead.claimed,
      scan,
      scores,
      catalog,
    });
    await ctx.client.update("qualifications", qualId, {
      ...(qual.status !== "briefed" ? { status: "briefed" } : {}),
      brief_json: JSON.stringify(brief),
      model,
      briefed_at: new Date().toISOString(),
    });

    // 3 · mirror the headline numbers onto the lead (equality-filterable lists)
    const leadPatch: Record<string, unknown> = {};
    if (scores.business) leadPatch.qualification_score = scores.business.score;
    if (scores.listing) leadPatch.listing_health_score = scores.listing.score;
    if (Object.keys(leadPatch).length > 0) await ctx.client.update("leads", leadId, leadPatch);

    revalidatePath(`/leads/${leadId}`);
    return {
      ok: true,
      message: `Business health ${scores.business?.score ?? "—"}/100 · brief generated${performance ? "" : " (performance unavailable)"}.`,
    };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
