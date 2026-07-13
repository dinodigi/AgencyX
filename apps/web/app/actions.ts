"use server";

import { revalidatePath } from "next/cache";
import { makeQueryDedupKey, normalizeKeyword, normalizeZip } from "@dinosales/types";
import { withClient } from "@/lib/agentx.ts";

export interface BatchResult {
  ok: boolean;
  created?: number;
  existing?: number;
  total?: number;
  error?: string;
}

function lines(raw: FormDataEntryValue | null): string[] {
  return String(raw ?? "")
    .split(/[\n,]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Build a keyword × ZIP batch (§8). Cross-product → SearchQueries, one per unit,
 * deduped per org by dedup_key so re-submitting a batch is safe (existing units
 * are surfaced, not duplicated — upsertSearchQuery resolves the unique conflict).
 */
export async function createBatch(_prev: BatchResult, formData: FormData): Promise<BatchResult> {
  const ctx = await withClient();
  if (!ctx) return { ok: false, error: "Not signed in." };

  const keywords = [...new Set(lines(formData.get("keywords")).map(normalizeKeyword))];
  const zips = [...new Set(lines(formData.get("zips")).map(normalizeZip))].filter((z) => z.length >= 3);
  const maxLeads = Math.max(1, Math.min(200, Number(formData.get("maxLeads")) || 50));

  if (keywords.length === 0 || zips.length === 0) {
    return { ok: false, error: "Enter at least one keyword and one ZIP." };
  }
  const total = keywords.length * zips.length;
  if (total > 500) {
    return { ok: false, error: `${total} units exceeds the 500-unit safety cap for one batch.` };
  }

  let created = 0;
  let existing = 0;
  try {
    for (const keyword of keywords) {
      for (const zip of zips) {
        const dedup_key = makeQueryDedupKey(ctx.session.orgId, keyword, zip);
        const res = await ctx.client.upsertSearchQuery({ org_id: ctx.session.orgId, dedup_key, keyword, zip, max_leads: maxLeads });
        if (res.alreadySynced) existing++;
        else created++;
      }
    }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e), created, existing };
  }

  revalidatePath("/coverage");
  return { ok: true, created, existing, total };
}

export interface SearchResult {
  ok: boolean;
  existing?: boolean;
  keyword?: string;
  zip?: string;
  error?: string;
}

type TargetWebsite = "any" | "missing" | "has";

function numOrUndef(raw: FormDataEntryValue | null): number | undefined {
  const s = String(raw ?? "").trim();
  if (s === "") return undefined;
  const n = Math.max(0, Math.floor(Number(s)));
  return Number.isFinite(n) ? n : undefined;
}

/**
 * Single search with target options (§8). Creates one keyword×ZIP search_queries
 * row the desktop will scrape, carrying the "who to keep" filter (website /
 * review-count). Re-searching the same unit updates its options and re-queues it
 * (unless a device is mid-run on it). This is the richer sibling of the batch
 * builder — same underlying queue, more control per search.
 */
export async function createSearch(_prev: SearchResult, formData: FormData): Promise<SearchResult> {
  const ctx = await withClient();
  if (!ctx) return { ok: false, error: "Not signed in." };

  const keyword = normalizeKeyword(String(formData.get("keyword") ?? ""));
  const zip = normalizeZip(String(formData.get("zip") ?? ""));
  if (!keyword) return { ok: false, error: "Enter a keyword." };
  if (zip.length < 3) return { ok: false, error: "Enter a valid ZIP." };

  const maxLeads = Math.max(1, Math.min(200, Number(formData.get("maxLeads")) || 50));
  const twRaw = String(formData.get("target_website") ?? "any");
  const target_website: TargetWebsite = twRaw === "missing" || twRaw === "has" ? twRaw : "any";
  const min_reviews = numOrUndef(formData.get("min_reviews"));
  const max_reviews = numOrUndef(formData.get("max_reviews"));

  if (min_reviews !== undefined && max_reviews !== undefined && min_reviews > max_reviews) {
    return { ok: false, error: "Min reviews can't be greater than max reviews." };
  }

  const dedup_key = makeQueryDedupKey(ctx.session.orgId, keyword, zip);
  const options = { max_leads: maxLeads, target_website, min_reviews, max_reviews };

  let existing = false;
  try {
    const res = await ctx.client.upsertSearchQuery({ org_id: ctx.session.orgId, dedup_key, keyword, zip, ...options });
    existing = res.alreadySynced;
    if (res.alreadySynced) {
      // Existing coverage — refresh its options and re-queue it for a new pass,
      // unless a device is scraping it right now.
      const current = await ctx.ax.search_queries.get(res.id);
      const patch: Record<string, unknown> = { ...options };
      if (current.status !== "running") {
        patch.status = "pending";
        patch.queued_at = new Date().toISOString(); // re-queued now — back of the FIFO line
      }
      await ctx.client.update("search_queries", res.id, patch);
    }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }

  revalidatePath("/coverage");
  return { ok: true, existing, keyword, zip };
}

export interface DeleteResult {
  ok: boolean;
  deleted?: number;
  error?: string;
}

/** Delete one or more leads. Owner/admin only (enforced by the delivery API's
 *  write access). Used by the leads-table selection toolbar and the lead page. */
export async function deleteLeads(ids: string[]): Promise<DeleteResult> {
  const ctx = await withClient();
  if (!ctx) return { ok: false, error: "Not signed in." };
  const unique = [...new Set(ids.filter(Boolean))];
  if (unique.length === 0) return { ok: false, error: "Nothing selected." };

  let deleted = 0;
  try {
    for (const id of unique) {
      await ctx.client.remove("leads", id);
      deleted++;
    }
  } catch (e) {
    return { ok: false, deleted, error: e instanceof Error ? e.message : String(e) };
  }
  revalidatePath("/leads");
  return { ok: true, deleted };
}

export interface StageResult {
  ok: boolean;
  error?: string;
  stage?: string;
}

/** Move a lead to the next pipeline stage. AgentX's workflow enforces that only
 *  a declared transition is allowed (invalid moves are rejected). */
export async function advanceStage(_prev: StageResult, formData: FormData): Promise<StageResult> {
  const ctx = await withClient();
  if (!ctx) return { ok: false, error: "Not signed in." };
  const leadId = String(formData.get("leadId") ?? "");
  const toStage = String(formData.get("toStage") ?? "");
  if (!leadId || !toStage) return { ok: false, error: "Missing lead or stage." };

  try {
    await ctx.client.update("leads", leadId, { stage: toStage });
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
  revalidatePath(`/leads/${leadId}`);
  revalidatePath("/leads");
  return { ok: true, stage: toStage };
}
