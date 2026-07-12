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
        const res = await ctx.client.upsertSearchQuery({ org_id: ctx.session.orgId, dedup_key, keyword, zip });
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
