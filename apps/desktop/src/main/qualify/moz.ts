/**
 * Moz Local free listing check — the qualification job's async sub-job
 * (recon 2026-07-13, agentx/SPIKE notes in the roadmap): the tool is an
 * IFRAME (#check-listing-iframe → moz.com/freemium/local/check-listing),
 * fields Company/Street/City/State/Zip (no phone), button "Check Now". The
 * backend polls `local.listing.reports.fetch.background` (~90s, can time out);
 * a durable `reportId` lands in the URL — submit now, re-fetch later. We read
 * the intercepted JSON, never the MUI table.
 *
 * Etiquette per the plan: one submit per job, hard-throttled by job cadence,
 * STOP on CAPTCHA (never bypass). Parsing is defensive — the response shape is
 * unversioned, so `parseMozReport` extracts what it can and the raw JSON is
 * stored in listing_audits.raw_result regardless.
 */

import { ScrapeBlockedError } from "../scraper/types.ts";
import { sleep } from "../scraper/human.ts";

export interface MozInput {
  company: string;
  street: string;
  city: string;
  state: string;
  zip: string;
}

export interface MozDirectoryResult {
  source: string;
  status: string;
}

export interface MozParsed {
  directories: MozDirectoryResult[];
  checked: number;
  found: number;
  /** 0–100 listing-health derivation, when computable. */
  score?: number;
}

export interface MozRunResult {
  reportId?: string;
  submittedAt: string;
  /** The best captured report payload (stored raw in listing_audits). */
  raw?: unknown;
  parsed?: MozParsed;
  /** Set when submit/poll didn't complete; reportId (if any) allows a later re-fetch. */
  error?: string;
}

const STATUS_KEYS = ["status", "listingStatus", "state", "result"];
const SOURCE_KEYS = ["source", "name", "directory", "site", "publisher"];

function asRecord(v: unknown): Record<string, unknown> | null {
  return v !== null && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

/** Pull per-directory results out of an arbitrary report JSON, defensively. */
export function parseMozReport(json: unknown): MozParsed | null {
  const directories: MozDirectoryResult[] = [];
  let percentCorrect: number | undefined;

  const visit = (node: unknown, depth: number): void => {
    if (depth > 8 || node === null || typeof node !== "object") return;
    if (Array.isArray(node)) {
      // An array of {source-ish, status-ish} objects = the per-directory table.
      const rows = node
        .map((item) => {
          const rec = asRecord(item);
          if (!rec) return null;
          const source = SOURCE_KEYS.map((k) => rec[k]).find((v) => typeof v === "string" && v.length > 0) as string | undefined;
          const status = STATUS_KEYS.map((k) => rec[k]).find((v) => typeof v === "string" && v.length > 0) as string | undefined;
          return source && status ? { source, status } : null;
        })
        .filter((r): r is MozDirectoryResult => r !== null);
      if (rows.length >= 2 && rows.length > directories.length) {
        directories.length = 0;
        directories.push(...rows);
      }
      for (const item of node) visit(item, depth + 1);
      return;
    }
    const rec = node as Record<string, unknown>;
    for (const [key, value] of Object.entries(rec)) {
      if (typeof value === "number" && /percent.*correct|correct.*percent/i.test(key)) percentCorrect = value;
      visit(value, depth + 1);
    }
  };
  visit(json, 0);

  if (directories.length === 0 && percentCorrect === undefined) return null;

  const norm = (s: string) => s.toLowerCase();
  const correct = directories.filter((d) => /correct|complete|good|found/.test(norm(d.status)) && !/incomplete|not/.test(norm(d.status))).length;
  const incomplete = directories.filter((d) => /incomplete|partial/.test(norm(d.status))).length;
  const found = directories.filter((d) => !/not[\s_-]?found|missing|absent/.test(norm(d.status))).length;
  const checked = directories.length;

  let score: number | undefined;
  if (typeof percentCorrect === "number") {
    score = Math.max(0, Math.min(100, Math.round(percentCorrect <= 1 ? percentCorrect * 100 : percentCorrect)));
  } else if (checked > 0) {
    score = Math.round((100 * (correct + 0.5 * incomplete)) / checked);
  }

  return { directories, checked, found, score };
}

// --- browser driving (thin; expected to need live tuning like §12.5) --------

interface PwLocator {
  fill(value: string, opts?: { timeout?: number }): Promise<void>;
  click(opts?: { timeout?: number }): Promise<void>;
  count(): Promise<number>;
  nth(i: number): PwLocator;
}
interface PwFrameLocator {
  locator(sel: string): PwLocator;
  getByLabel(text: RegExp | string): PwLocator;
  getByRole(role: string, opts?: { name?: RegExp | string }): PwLocator;
}
interface PwResponse {
  url(): string;
  json(): Promise<unknown>;
}
interface PwPage {
  goto(url: string, opts?: { waitUntil?: string; timeout?: number }): Promise<unknown>;
  url(): string;
  locator(sel: string): PwLocator;
  frameLocator(sel: string): PwFrameLocator;
  on(event: "response", handler: (res: PwResponse) => void): void;
}
interface PwContext {
  newPage(): Promise<PwPage>;
}
interface PwBrowser {
  newContext(opts: Record<string, unknown>): Promise<PwContext>;
  close(): Promise<void>;
}

const MOZ_URL = "https://moz.com/products/local/check-listing";
const IFRAME = "#check-listing-iframe";
const REPORT_ENDPOINT = /local\.listing\.reports\.fetch/i;
const CAPTCHA = 'iframe[src*="recaptcha"], form#captcha-form, div#recaptcha';

export interface MozRunOptions {
  signal: AbortSignal;
  onLog: (level: "info" | "warn" | "error", message: string) => void;
  /** Total budget for submit + poll (report generation runs ~90s). */
  timeoutMs?: number;
  channel?: string;
}

export class MozAuditor {
  async run(input: MozInput, opts: MozRunOptions): Promise<MozRunResult> {
    const submittedAt = new Date().toISOString();
    const timeoutMs = opts.timeoutMs ?? 150_000;
    const { chromium } = (await import("playwright-extra")) as unknown as {
      chromium: { use(p: unknown): void; launch(o: Record<string, unknown>): Promise<PwBrowser> };
    };
    const stealth = (await import("puppeteer-extra-plugin-stealth")) as unknown as { default: () => unknown };
    chromium.use(stealth.default());

    const browser = await chromium.launch({ channel: opts.channel ?? "chrome", headless: false });
    const captured: unknown[] = [];
    try {
      const ctx = await browser.newContext({ locale: "en-US" });
      const page = await ctx.newPage();
      page.on("response", (res) => {
        if (REPORT_ENDPOINT.test(res.url())) {
          res
            .json()
            .then((body) => captured.push(body))
            .catch(() => {});
        }
      });

      opts.onLog("info", "moz — opening the free listing-check tool");
      await page.goto(MOZ_URL, { waitUntil: "domcontentloaded", timeout: 30_000 });
      await sleep(1500, opts.signal);
      if ((await page.locator(CAPTCHA).count()) > 0) {
        throw new ScrapeBlockedError("Moz showed a CAPTCHA — stopping (never bypass)");
      }

      const frame = page.frameLocator(IFRAME);
      // Labels per recon; positional fallback if the MUI labels shift.
      const fields: [RegExp, string][] = [
        [/company\s*name/i, input.company],
        [/street\s*address/i, input.street],
        [/^city/i, input.city],
        [/state/i, input.state],
        [/zip\s*code|zipcode|postal/i, input.zip],
      ];
      try {
        for (const [label, value] of fields) {
          await frame.getByLabel(label).fill(value, { timeout: 8_000 });
        }
      } catch {
        opts.onLog("warn", "moz — labels not matched, falling back to positional inputs");
        const inputs = frame.locator("input");
        const values = [input.company, input.street, input.city, input.state, input.zip];
        for (let i = 0; i < values.length; i++) {
          await inputs.nth(i).fill(values[i]!, { timeout: 8_000 });
        }
      }

      try {
        await frame.getByRole("button", { name: /check now/i }).click({ timeout: 8_000 });
      } catch {
        await frame.locator('button:has-text("Check Now")').click({ timeout: 8_000 });
      }
      opts.onLog("info", "moz — submitted; report generates in ~90s (polling)");

      // Poll: the backend fetch.background responses land in `captured`; the
      // durable reportId appears in the top page URL.
      const deadline = Date.now() + timeoutMs;
      let reportId: string | undefined;
      while (Date.now() < deadline && !opts.signal.aborted) {
        reportId = reportId ?? page.url().match(/reportId=([0-9a-f-]{16,})/i)?.[1];
        for (let i = captured.length - 1; i >= 0; i--) {
          const parsed = parseMozReport(captured[i]);
          if (parsed && parsed.checked > 0) {
            opts.onLog("info", `moz — report ready: ${parsed.found}/${parsed.checked} directories, score ${parsed.score ?? "?"}`);
            return { reportId, submittedAt, raw: captured[i], parsed };
          }
        }
        await sleep(2_000, opts.signal);
      }

      const last = captured.length > 0 ? captured[captured.length - 1] : undefined;
      const why = opts.signal.aborted ? "cancelled" : "timed out";
      opts.onLog("warn", `moz — ${why} before the report finished${reportId ? ` (reportId ${reportId.slice(0, 8)}… saved for re-fetch)` : ""}`);
      return { reportId, submittedAt, raw: last, error: why };
    } finally {
      await browser.close().catch(() => {});
    }
  }
}
