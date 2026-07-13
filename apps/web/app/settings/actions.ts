"use server";

import { revalidatePath } from "next/cache";
import { AgentXError } from "@dinosales/agentx-client";
import type { AgenciesCreate, ServicesCreate, MicroservicesCreate, PackagesCreate } from "@dinosales/agentx-client";
import { withClient } from "@/lib/agentx.ts";
import { serializeItems, serializeHighlights, type PackageItemRef, type Billing, type Currency } from "@/lib/catalog.ts";

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
function isRateLimit(e: unknown): boolean {
  return e instanceof AgentXError && (e.status === 429 || /too many requests/i.test(e.message));
}
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
const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));

export interface ActionResult {
  ok: boolean;
  id?: string;
  error?: string;
}

// ── Agency profile ─────────────────────────────────────────────────────────

export interface AgencyProfileInput {
  name: string;
  /** Asset id from uploadLogo (empty string clears it). */
  logo?: string;
  logo_url?: string;
  tagline?: string;
  website?: string;
  phone?: string;
  email?: string;
  address?: string;
  brand_color?: string;
  accent_color?: string;
  proposal_footer?: string;
}

/** Update (or create) the org's single agencies row — the operator's identity. */
export async function saveAgencyProfile(input: AgencyProfileInput): Promise<ActionResult> {
  const ctx = await withClient();
  if (!ctx) return { ok: false, error: "Not signed in." };
  if (!input.name.trim()) return { ok: false, error: "Company name is required." };

  const patch: Record<string, unknown> = {
    name: input.name.trim(),
    logo_url: input.logo_url?.trim() || undefined,
    tagline: input.tagline?.trim() || undefined,
    website: input.website?.trim() || undefined,
    phone: input.phone?.trim() || undefined,
    email: input.email?.trim() || undefined,
    address: input.address?.trim() || undefined,
    brand_color: input.brand_color?.trim() || undefined,
    accent_color: input.accent_color?.trim() || undefined,
    proposal_footer: input.proposal_footer?.trim() || undefined,
  };
  // Asset: undefined = leave as-is, "" = clear (null), id = set.
  if (input.logo !== undefined) patch.logo = input.logo || null;

  try {
    const rows = await withBackoff(() => ctx.ax.agencies.list({ limit: 1 }));
    const row = rows[0];
    if (row) await withBackoff(() => ctx.client.update("agencies", row.id, patch));
    else await withBackoff(() => ctx.ax.agencies.create({ org_id: ctx.session.orgId, ...patch } as AgenciesCreate));
  } catch (e) {
    return { ok: false, error: errMsg(e) };
  }
  revalidatePath("/settings/profile");
  return { ok: true };
}

/**
 * Upload a logo to R2 through AgentX's delivery uploads endpoint (multipart) and
 * return the asset {id,url}. Runs server-side so the delivery token stays off the
 * client; the user's JWT (from withClient) satisfies the write gate.
 */
export async function uploadLogo(formData: FormData): Promise<{ ok: boolean; id?: string; url?: string; error?: string }> {
  const ctx = await withClient();
  if (!ctx) return { ok: false, error: "Not signed in." };
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) return { ok: false, error: "Choose an image file." };
  if (file.size > 10 * 1024 * 1024) return { ok: false, error: "Logo must be under 10 MB." };
  try {
    const res = await withBackoff(() => ctx.client.uploadAsset("agencies", file, file.name));
    return { ok: true, id: res.id, url: res.url };
  } catch (e) {
    return { ok: false, error: errMsg(e) };
  }
}

// ── Services + microservice library (shared shape) ──────────────────────────

interface CatalogEntryInput {
  id?: string;
  name: string;
  description?: string;
  category?: string;
  active?: boolean;
}

async function saveCatalogEntry(collection: "services" | "microservices", input: CatalogEntryInput): Promise<ActionResult> {
  const ctx = await withClient();
  if (!ctx) return { ok: false, error: "Not signed in." };
  if (!input.name.trim()) return { ok: false, error: "Name is required." };

  const fields = {
    name: input.name.trim(),
    description: input.description?.trim() || undefined,
    category: input.category || "other",
    active: input.active ?? true,
  };

  try {
    if (input.id) {
      await withBackoff(() => ctx.client.update(collection, input.id!, fields));
      return finish(collection, input.id);
    }
    const payload = { org_id: ctx.session.orgId, sort_order: Date.now(), created_at: new Date().toISOString(), ...fields };
    const created = await withBackoff(() =>
      collection === "services"
        ? ctx.ax.services.create(payload as ServicesCreate)
        : ctx.ax.microservices.create(payload as MicroservicesCreate),
    );
    return finish(collection, created.id);
  } catch (e) {
    return { ok: false, error: errMsg(e) };
  }
}

async function removeEntry(collection: "services" | "microservices" | "packages", id: string): Promise<ActionResult> {
  const ctx = await withClient();
  if (!ctx) return { ok: false, error: "Not signed in." };
  try {
    await withBackoff(() => ctx.client.remove(collection, id));
  } catch (e) {
    return { ok: false, error: errMsg(e) };
  }
  return finish(collection, id);
}

function finish(collection: string, id?: string): ActionResult {
  revalidatePath("/settings/packages");
  return { ok: true, id };
}

export async function saveService(input: CatalogEntryInput): Promise<ActionResult> {
  return saveCatalogEntry("services", input);
}
export async function deleteService(id: string): Promise<ActionResult> {
  return removeEntry("services", id);
}
export async function saveMicroservice(input: CatalogEntryInput): Promise<ActionResult> {
  return saveCatalogEntry("microservices", input);
}
export async function deleteMicroservice(id: string): Promise<ActionResult> {
  return removeEntry("microservices", id);
}

// ── Packages ────────────────────────────────────────────────────────────────

export interface PackageInput {
  id?: string;
  service: string;
  name: string;
  summary?: string;
  price?: number;
  currency?: Currency;
  billing?: Billing;
  setup_fee?: number;
  popular?: boolean;
  active?: boolean;
  items: PackageItemRef[];
  highlights: string[];
}

export async function savePackage(input: PackageInput): Promise<ActionResult> {
  const ctx = await withClient();
  if (!ctx) return { ok: false, error: "Not signed in." };
  if (!input.service) return { ok: false, error: "Pick a service for this package." };
  if (!input.name.trim()) return { ok: false, error: "Package name is required." };

  const fields = {
    service: input.service,
    name: input.name.trim(),
    summary: input.summary?.trim() || undefined,
    price: typeof input.price === "number" ? Math.max(0, input.price) : undefined,
    currency: input.currency || "usd",
    billing: input.billing || "one_time",
    setup_fee: typeof input.setup_fee === "number" && input.setup_fee > 0 ? input.setup_fee : undefined,
    popular: input.popular ?? false,
    active: input.active ?? true,
    items: serializeItems(input.items),
    highlights: serializeHighlights(input.highlights),
  };

  try {
    if (input.id) {
      await withBackoff(() => ctx.client.update("packages", input.id!, fields));
      return finish("packages", input.id);
    }
    const payload = { org_id: ctx.session.orgId, sort_order: Date.now(), created_at: new Date().toISOString(), ...fields };
    const created = await withBackoff(() => ctx.ax.packages.create(payload as PackagesCreate));
    return finish("packages", created.id);
  } catch (e) {
    return { ok: false, error: errMsg(e) };
  }
}

export async function deletePackage(id: string): Promise<ActionResult> {
  return removeEntry("packages", id);
}
