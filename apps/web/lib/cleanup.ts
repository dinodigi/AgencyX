import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import type { LeadCleanupFields } from "@dinosales/types";

/**
 * The AI judgment pass of lead cleanup — the FIRST AI call in the pipeline,
 * fired from the qualify click (after the free deterministic pass, and only
 * when the heuristics flag something a regex can't fix: branch suffixes in
 * names, shouty casing, unparseable addresses, missing categories). Clean
 * inputs here are what make the Moz form fill, the Maps lookup, and the crawl
 * land on the right business.
 *
 * Ground rule enforced by the prompt + merge: NORMALIZE, never invent. A field
 * the model can't derive from the given data comes back empty and is ignored.
 */

const CLEAN_MODEL = "claude-opus-4-8";

const CLEANUP_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["businessName", "street", "city", "state", "zip", "category", "notes"],
  properties: {
    businessName: { type: "string", description: "Proper business name — casing fixed, branch/location suffixes removed. Empty if already correct." },
    street: { type: "string", description: "Street address line only. Empty if unknown — NEVER guess." },
    city: { type: "string", description: "City only. Empty if unknown." },
    state: { type: "string", description: "Two-letter state code. Empty if unknown." },
    zip: { type: "string", description: "5-digit ZIP. Empty if unknown." },
    category: { type: "string", description: "Concise business category (e.g. 'Pizza restaurant'). Empty if it cannot be determined from the data." },
    notes: { type: "array", items: { type: "string" }, description: "One short note per change made." },
  },
} as const;

const CLEANUP_SYSTEM = `You normalize scraped local-business lead data so it can be submitted to listing directories (exact-match forms). Rules:
- Fix ONLY formatting and obvious noise: casing (ALL-CAPS/all-lowercase → proper name casing, preserving intentional stylization like "L.A.'S"), branch/location suffixes glued onto the name ("Joe's Pizza - Hollywood Blvd" → "Joe's Pizza", "(HOLLYWOOD)", "@Cahuenga", trailing ", Los Angeles, CA"), stray punctuation.
- Split the address into street/city/state/zip using ONLY what's in the given address string. If a component is not present, return it empty — NEVER invent or guess an address, ZIP, or city.
- Category: normalize to a concise Google-Business-style category using the given category/name; empty if genuinely unknowable.
- Return empty strings for anything already correct or unknowable. notes lists each change in a few words.`;

export interface AiCleanupOutcome {
  patch: LeadCleanupFields;
  notes: string[];
  model: string;
  tokens: { input: number; output: number };
}

export async function aiCleanLead(
  lead: LeadCleanupFields & { hours?: string },
  reasons: string[],
): Promise<AiCleanupOutcome> {
  const client = new Anthropic(); // reads ANTHROPIC_API_KEY
  const response = await client.messages.create({
    model: CLEAN_MODEL,
    max_tokens: 1024,
    thinking: { type: "adaptive" },
    output_config: { effort: "low", format: { type: "json_schema", schema: CLEANUP_SCHEMA } },
    system: CLEANUP_SYSTEM,
    messages: [
      {
        role: "user",
        content: [
          `Flagged because: ${reasons.join("; ")}`,
          `business_name: ${lead.business_name ?? ""}`,
          `address: ${lead.address ?? ""}`,
          `category: ${lead.category ?? ""}`,
          `phone: ${lead.phone ?? ""}`,
          `website: ${lead.website ?? ""}`,
        ].join("\n"),
      },
    ],
  });
  if (response.stop_reason === "refusal") throw new Error("cleanup call was refused");
  const text = response.content.find((b): b is Anthropic.TextBlock => b.type === "text")?.text;
  if (!text) throw new Error("cleanup call returned no content");
  const out = JSON.parse(text) as {
    businessName: string;
    street: string;
    city: string;
    state: string;
    zip: string;
    category: string;
    notes: string[];
  };

  const patch: LeadCleanupFields = {};
  const notes = [...out.notes];
  if (out.businessName && out.businessName !== lead.business_name) patch.business_name = out.businessName;
  // Recompose the address ONLY when every component came back — a partial
  // address is worse than the original string for downstream form fills.
  if (out.street && out.city && out.state && out.zip) {
    const address = `${out.street}, ${out.city}, ${out.state} ${out.zip}`;
    if (address !== lead.address) patch.address = address;
  }
  if (out.category && out.category !== lead.category) patch.category = out.category;

  return {
    patch,
    notes,
    model: response.model,
    tokens: { input: response.usage.input_tokens, output: response.usage.output_tokens },
  };
}
