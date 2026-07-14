import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import type { QualificationBrief, QualificationScan, ScoreDetail } from "@dinosales/types";
import { scoreBusinessHealth, scoreContent, scoreListing, scoreSeo, scoreUx } from "@dinosales/types";

/**
 * Server-side qualification intelligence (build-order steps 4 + 6):
 * deterministic sub-scores computed from the desktop's scan_json (+ PageSpeed
 * for performance), then one Claude pass that writes the narrative brief ON TOP
 * of those numbers. Scores are never AI-assigned; the AI never runs
 * automatically — briefs are generated on an explicit click (tokens cost).
 */

export function parseScan(scanJson: string | undefined | null): QualificationScan | null {
  if (!scanJson) return null;
  try {
    const parsed = JSON.parse(scanJson) as QualificationScan;
    return parsed && parsed.version === 1 ? parsed : null;
  } catch {
    return null;
  }
}

// --- performance (Google PageSpeed Insights API — no scraping) --------------

const PAGESPEED_URL = "https://www.googleapis.com/pagespeedonline/v5/runPagespeed";

/** Core Web Vitals via PageSpeed. Keyless works at low volume; PAGESPEED_API_KEY
 *  raises the quota. Returns null on any failure — performance is then simply
 *  "unknown", never zero. */
export async function fetchPerformanceScore(url: string): Promise<ScoreDetail | null> {
  try {
    const qs = new URLSearchParams({ url, category: "performance", strategy: "mobile" });
    const key = process.env.PAGESPEED_API_KEY;
    if (key) qs.set("key", key);
    const res = await fetch(`${PAGESPEED_URL}?${qs.toString()}`, { signal: AbortSignal.timeout(45_000) });
    if (!res.ok) return null;
    const data = (await res.json()) as {
      lighthouseResult?: {
        categories?: { performance?: { score?: number } };
        audits?: Record<string, { displayValue?: string }>;
      };
    };
    const raw = data.lighthouseResult?.categories?.performance?.score;
    if (typeof raw !== "number") return null;
    const reasons = [`Lighthouse mobile performance ${Math.round(raw * 100)}/100`];
    const lcp = data.lighthouseResult?.audits?.["largest-contentful-paint"]?.displayValue;
    if (lcp) reasons.push(`LCP ${lcp}`);
    return { score: Math.round(raw * 100), reasons };
  } catch {
    return null;
  }
}

// --- deterministic sub-scores ------------------------------------------------

export interface QualificationScores {
  seo?: ScoreDetail;
  content?: ScoreDetail;
  ux?: ScoreDetail;
  performance?: ScoreDetail;
  listing?: ScoreDetail;
  business?: ScoreDetail;
}

export function computeScores(scan: QualificationScan, performance: ScoreDetail | null): QualificationScores {
  const scores: QualificationScores = {};
  if (scan.site && scan.site.pageCount > 0) {
    scores.seo = scoreSeo(scan.site);
    scores.content = scoreContent(scan.site);
    scores.ux = scoreUx(scan.site);
  }
  if (performance) scores.performance = performance;
  if (scan.moz) scores.listing = scoreListing(scan.moz) ?? undefined;
  scores.business =
    scoreBusinessHealth({
      seo: scores.seo?.score,
      content: scores.content?.score,
      ux: scores.ux?.score,
      performance: scores.performance?.score,
      listing: scores.listing?.score,
    }) ?? undefined;
  return scores;
}

// --- the AI brief (Claude, structured output) --------------------------------

const STRING_ARRAY = { type: "array", items: { type: "string" } } as const;

/** JSON schema for QualificationBrief — structured outputs require
 *  additionalProperties:false + required on every object. */
const BRIEF_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["seo", "brand", "proposal"],
  properties: {
    seo: {
      type: "object",
      additionalProperties: false,
      required: ["executiveSummary", "audit", "keywordStrategy", "siloRecommendation", "roadmap"],
      properties: {
        executiveSummary: { type: "string" },
        audit: {
          type: "object",
          additionalProperties: false,
          required: ["strengths", "weaknesses", "technicalIssues"],
          properties: { strengths: STRING_ARRAY, weaknesses: STRING_ARRAY, technicalIssues: STRING_ARRAY },
        },
        keywordStrategy: STRING_ARRAY,
        siloRecommendation: STRING_ARRAY,
        roadmap: STRING_ARRAY,
      },
    },
    brand: {
      type: "object",
      additionalProperties: false,
      required: ["essence", "voice", "visualDirection", "verifiedFacts"],
      properties: {
        essence: { type: "string" },
        voice: { type: "string" },
        visualDirection: { type: "string" },
        verifiedFacts: STRING_ARRAY,
      },
    },
    proposal: {
      type: "object",
      additionalProperties: false,
      required: ["executiveSummary", "scope", "outcomes", "recommendedPackages"],
      properties: {
        executiveSummary: { type: "string" },
        scope: STRING_ARRAY,
        outcomes: STRING_ARRAY,
        recommendedPackages: STRING_ARRAY,
      },
    },
  },
} as const;

export const BRIEF_MODEL = "claude-opus-4-8";

export interface BriefInput {
  leadName: string;
  category?: string;
  address?: string;
  phone?: string;
  websiteUrl?: string;
  rating?: number;
  reviewCount?: number;
  claimed?: boolean;
  scan: QualificationScan;
  scores: QualificationScores;
  /** The agency's sellable catalog, for grounded package recommendations. */
  catalog: { name: string; summary?: string; price?: number; billing?: string }[];
}

function describeScores(scores: QualificationScores): string {
  const lines: string[] = [];
  for (const [key, detail] of Object.entries(scores)) {
    if (!detail) continue;
    lines.push(`- ${key}: ${detail.score}/100 (${detail.reasons.join("; ")})`);
  }
  return lines.length > 0 ? lines.join("\n") : "- no scores computable (no website)";
}

function briefPrompt(input: BriefInput): string {
  const { scan, scores } = input;
  const site = scan.site;
  const pageLines = site?.pages
    .slice(0, 30)
    .map((p) => `  - ${p.url} [${p.status}] title="${p.title ?? ""}" h1="${p.h1 ?? ""}" words=${p.wordCount}`)
    .join("\n");
  return [
    `Business: ${input.leadName}`,
    input.category ? `Category: ${input.category}` : null,
    input.address ? `Address: ${input.address}` : null,
    input.websiteUrl ? `Website: ${input.websiteUrl}` : "Website: NONE (no website is the core finding)",
    `Reputation: ${input.rating ?? "?"}★ across ${input.reviewCount ?? 0} reviews · listing ${input.claimed ? "claimed" : "UNCLAIMED"}`,
    "",
    "DETERMINISTIC SCORES (already computed — do not change them, explain and build on them):",
    describeScores(scores),
    "",
    site
      ? [
          `SITE CRAWL (${site.pageCount} pages, tech: ${site.tech.join(", ") || "unknown"}):`,
          `Silo: ${site.silo.map((s) => `${s.section} (${s.pages})`).join(" · ")}`,
          `Warnings: ${site.warnings.join(" · ") || "none"}`,
          "Pages:",
          pageLines,
        ].join("\n")
      : "SITE CRAWL: skipped — the lead has no website.",
    "",
    scan.moz
      ? `LISTING AUDIT (Moz): ${scan.moz.directoriesFound ?? "?"}/${scan.moz.directoriesChecked ?? "?"} directories, accuracy score ${scan.moz.score ?? "unknown"}.`
      : "LISTING AUDIT: not available.",
    scan.listing?.hours ? `Hours: ${scan.listing.hours.split("\n").join("; ")}` : null,
    "",
    "AGENCY CATALOG (recommend from these actual packages, by exact name):",
    input.catalog.length > 0
      ? input.catalog.map((p) => `- ${p.name}${p.price ? ` ($${p.price}${p.billing && p.billing !== "one_time" ? `/${p.billing}` : ""})` : ""}${p.summary ? ` — ${p.summary}` : ""}`).join("\n")
      : "- (catalog empty — describe recommended work without package names)",
  ]
    .filter((l): l is string => l !== null)
    .join("\n");
}

const BRIEF_SYSTEM = `You write qualification briefs for a local-marketing agency evaluating a scraped business lead. You are given verified research signals (site crawl, listing audit, reputation) and deterministic scores. Produce a decision-ready brief:
- seo: what's wrong, what to do, in priority order. Ground every claim in the provided signals — never invent pages, keywords must fit the business category and location.
- brand: infer essence/voice/visual direction from the verified facts only; verifiedFacts lists only things present in the data (name, category, location, hours, rating).
- proposal: what the agency should pitch, with outcomes a small-business owner understands. recommendedPackages must use exact catalog names when a catalog is provided.
Be specific and concrete; no filler. Every array item is one crisp sentence or phrase.`;

/** One Claude pass → validated QualificationBrief. Throws on refusal/parse failure. */
export async function generateBriefJson(input: BriefInput): Promise<{ brief: QualificationBrief; model: string }> {
  const client = new Anthropic(); // reads ANTHROPIC_API_KEY
  const response = await client.messages.create({
    model: BRIEF_MODEL,
    max_tokens: 8192,
    thinking: { type: "adaptive" },
    system: BRIEF_SYSTEM,
    output_config: { format: { type: "json_schema", schema: BRIEF_SCHEMA } },
    messages: [{ role: "user", content: briefPrompt(input) }],
  });

  if (response.stop_reason === "refusal") {
    throw new Error("Claude declined this request (safety refusal) — try regenerating.");
  }
  if (response.stop_reason === "max_tokens") {
    throw new Error("Brief generation ran out of tokens — try regenerating.");
  }
  const text = response.content.find((b): b is Anthropic.TextBlock => b.type === "text")?.text;
  if (!text) throw new Error("Claude returned no brief content.");
  const brief = JSON.parse(text) as QualificationBrief;
  return { brief, model: response.model };
}
