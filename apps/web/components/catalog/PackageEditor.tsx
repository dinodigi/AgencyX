"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { savePackage, deletePackage } from "@/app/settings/actions.ts";
import {
  BILLINGS,
  BILLING_LABEL,
  BILLING_SUFFIX,
  CURRENCIES,
  formatPrice,
  parseHighlights,
  parseItems,
  type Billing,
  type Currency,
} from "@/lib/catalog.ts";

export interface MicroRow {
  id: string;
  name: string;
  description?: string;
}
export interface PkgRow {
  id: string;
  /** Delivery returns relations expanded as {id, label}. */
  service?: { id: string; label: string };
  name: string;
  summary?: string;
  price?: number;
  currency?: string;
  billing?: string;
  setup_fee?: number;
  popular?: boolean;
  active?: boolean;
  items?: string;
  highlights?: string;
}

const inp =
  "w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 text-sm text-[var(--color-ink)] focus:border-[color-mix(in_srgb,var(--color-brand)_55%,var(--color-border))] focus:outline-none";

/** Create/edit one package under a service: pricing, billing, included microservices
 *  (from the library), and highlight points — with a live proposal-card preview. */
export function PackageEditor({
  service,
  microservices,
  initial,
  onClose,
}: {
  service: { id: string; name: string };
  microservices: MicroRow[];
  initial: PkgRow | null;
  onClose: () => void;
}) {
  const router = useRouter();
  const [name, setName] = useState(initial?.name ?? "");
  const [summary, setSummary] = useState(initial?.summary ?? "");
  const [price, setPrice] = useState(initial?.price != null ? String(initial.price) : "");
  const [currency, setCurrency] = useState<Currency>((initial?.currency as Currency) ?? "usd");
  const [billing, setBilling] = useState<Billing>((initial?.billing as Billing) ?? "one_time");
  const [setupFee, setSetupFee] = useState(initial?.setup_fee != null ? String(initial.setup_fee) : "");
  const [popular, setPopular] = useState(initial?.popular ?? false);
  const [active, setActive] = useState(initial?.active ?? true);
  const [itemIds, setItemIds] = useState<string[]>(() => parseItems(initial?.items).map((i) => i.id));
  const [highlights, setHighlights] = useState<string[]>(() => parseHighlights(initial?.highlights));
  const [busy, setBusy] = useState<null | "save" | "delete">(null);
  const [error, setError] = useState<string | null>(null);

  const microById = useMemo(() => new Map(microservices.map((m) => [m.id, m])), [microservices]);

  function toggleItem(id: string) {
    setItemIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  async function save() {
    setBusy("save");
    setError(null);
    const res = await savePackage({
      id: initial?.id,
      service: service.id,
      name,
      summary,
      price: price.trim() === "" ? undefined : Math.max(0, Number(price) || 0),
      currency,
      billing,
      setup_fee: setupFee.trim() === "" ? undefined : Math.max(0, Number(setupFee) || 0),
      popular,
      active,
      items: itemIds.map((id) => ({ id, included: true })),
      highlights,
    });
    setBusy(null);
    if (res.ok) {
      router.refresh();
      onClose();
    } else {
      setError(res.error ?? "Save failed.");
    }
  }

  async function remove() {
    if (!initial?.id) return;
    if (!window.confirm(`Delete the "${initial.name}" package?`)) return;
    setBusy("delete");
    const res = await deletePackage(initial.id);
    setBusy(null);
    if (res.ok) {
      router.refresh();
      onClose();
    } else {
      setError(res.error ?? "Delete failed.");
    }
  }

  const priceNum = price.trim() === "" ? 0 : Number(price) || 0;

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4" onClick={onClose}>
      <div
        className="max-h-[90vh] w-full max-w-4xl overflow-auto rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-[var(--color-border)] px-6 py-4">
          <div>
            <div className="text-sm text-[var(--color-muted)]">{service.name}</div>
            <div className="text-lg font-semibold">{initial ? "Edit package" : "New package"}</div>
          </div>
          <button onClick={onClose} className="text-[var(--color-muted)] hover:text-[var(--color-ink)]">
            ✕
          </button>
        </div>

        <div className="grid grid-cols-1 gap-6 p-6 lg:grid-cols-[1fr_300px]">
          {/* Editor */}
          <div className="flex flex-col gap-4">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <L label="Package name">
                <input className={inp} value={name} onChange={(e) => setName(e.target.value)} placeholder="Growth" />
              </L>
              <L label="Summary">
                <input className={inp} value={summary} onChange={(e) => setSummary(e.target.value)} placeholder="For businesses ready to grow" />
              </L>
            </div>

            <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              <L label="Price">
                <input className={inp} inputMode="numeric" value={price} onChange={(e) => setPrice(e.target.value)} placeholder="1500" />
              </L>
              <L label="Currency">
                <select className={inp} value={currency} onChange={(e) => setCurrency(e.target.value as Currency)}>
                  {CURRENCIES.map((c) => (
                    <option key={c} value={c}>
                      {c.toUpperCase()}
                    </option>
                  ))}
                </select>
              </L>
              <L label="Setup fee">
                <input className={inp} inputMode="numeric" value={setupFee} onChange={(e) => setSetupFee(e.target.value)} placeholder="0" />
              </L>
              <L label="Popular">
                <label className="flex h-9 items-center gap-2 text-sm text-[var(--color-muted)]">
                  <input type="checkbox" checked={popular} onChange={(e) => setPopular(e.target.checked)} /> Featured
                </label>
              </L>
            </div>

            <L label="Billing">
              <div className="flex flex-wrap gap-2">
                {BILLINGS.map((b) => (
                  <button
                    key={b}
                    type="button"
                    onClick={() => setBilling(b)}
                    className={`rounded-lg border px-3 py-1.5 text-sm ${
                      billing === b
                        ? "border-transparent bg-[color-mix(in_srgb,var(--color-brand)_20%,transparent)] text-[var(--color-ink)]"
                        : "border-[var(--color-border)] text-[var(--color-muted)] hover:text-[var(--color-ink)]"
                    }`}
                  >
                    {BILLING_LABEL[b]}
                  </button>
                ))}
              </div>
            </L>

            {/* Microservices from the library */}
            <div>
              <div className="mb-1.5 flex items-center justify-between">
                <span className="text-sm font-medium">What's included</span>
                <span className="text-xs text-[var(--color-muted)]">{itemIds.length} of {microservices.length} from your library</span>
              </div>
              {microservices.length === 0 ? (
                <p className="rounded-lg border border-dashed border-[var(--color-border)] p-3 text-xs text-[var(--color-muted)]">
                  No microservices yet. Add some in the library (below the packages) and they'll appear here to include.
                </p>
              ) : (
                <div className="flex max-h-44 flex-col gap-1 overflow-auto rounded-lg border border-[var(--color-border)] p-2">
                  {microservices.map((m) => (
                    <label key={m.id} className="flex cursor-pointer items-start gap-2 rounded-md px-2 py-1.5 hover:bg-[var(--color-surface-2)]">
                      <input type="checkbox" className="mt-0.5" checked={itemIds.includes(m.id)} onChange={() => toggleItem(m.id)} />
                      <span>
                        <span className="text-sm">{m.name}</span>
                        {m.description && <span className="block text-xs text-[var(--color-muted)]">{m.description}</span>}
                      </span>
                    </label>
                  ))}
                </div>
              )}
            </div>

            {/* Highlight points */}
            <HighlightsEditor highlights={highlights} setHighlights={setHighlights} />

            <label className="flex items-center gap-2 text-sm text-[var(--color-muted)]">
              <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} /> Active (uncheck to hide from proposals without deleting)
            </label>

            <div className="flex items-center gap-3 border-t border-[var(--color-border)] pt-4">
              <button onClick={save} disabled={busy !== null || !name.trim()} className="btn-primary px-4 py-2 text-sm">
                {busy === "save" ? "Saving…" : "Save package"}
              </button>
              {initial && (
                <button onClick={remove} disabled={busy !== null} className="rounded-lg border border-[var(--color-border)] px-3 py-2 text-sm text-red-400 hover:bg-red-500/10">
                  {busy === "delete" ? "Deleting…" : "Delete"}
                </button>
              )}
              {error && <span className="text-sm text-red-400">{error}</span>}
            </div>
          </div>

          {/* Live preview */}
          <div>
            <div className="mb-2 text-xs text-[var(--color-muted)]">Proposal preview</div>
            <div className="relative overflow-hidden rounded-2xl border-2 border-[var(--color-stage-qualified)]/40 bg-[var(--color-surface-2)] p-5">
              {popular && (
                <div className="absolute right-[-30px] top-3 rotate-45 bg-[color-mix(in_srgb,var(--color-brand)_25%,transparent)] px-8 py-0.5 text-[10px] font-medium text-[var(--color-brand-2)]">
                  Popular
                </div>
              )}
              <div className="text-base font-semibold">{name || "Package name"}</div>
              {summary && <div className="text-xs text-[var(--color-muted)]">{summary}</div>}
              <div className="mt-3 flex items-baseline gap-1">
                <span className="text-2xl font-semibold">{formatPrice(priceNum, currency)}</span>
                <span className="text-sm text-[var(--color-muted)]">{BILLING_SUFFIX[billing]}</span>
              </div>
              {itemIds.length > 0 && (
                <div className="mt-3 flex flex-col gap-1.5 border-t border-[var(--color-border)] pt-3">
                  {itemIds.map((id) => (
                    <div key={id} className="flex items-start gap-2 text-xs">
                      <span className="text-[var(--color-stage-sold)]">✓</span>
                      {microById.get(id)?.name ?? "—"}
                    </div>
                  ))}
                </div>
              )}
              {highlights.filter(Boolean).length > 0 && (
                <div className="mt-3 flex flex-col gap-1 border-t border-[var(--color-border)] pt-3">
                  {highlights.filter(Boolean).map((h, i) => (
                    <div key={i} className="flex items-start gap-2 text-xs text-[var(--color-muted)]">
                      <span className="text-[var(--color-stage-building)]">★</span>
                      {h}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function HighlightsEditor({ highlights, setHighlights }: { highlights: string[]; setHighlights: (h: string[]) => void }) {
  return (
    <div>
      <div className="mb-1.5 text-sm font-medium">Highlight points</div>
      <div className="flex flex-col gap-2">
        {highlights.map((h, i) => (
          <div key={i} className="flex items-center gap-2">
            <span className="text-[var(--color-stage-building)]">★</span>
            <input
              className={inp}
              value={h}
              onChange={(e) => setHighlights(highlights.map((x, j) => (j === i ? e.target.value : x)))}
              placeholder="Live in 2–3 weeks"
            />
            <button onClick={() => setHighlights(highlights.filter((_, j) => j !== i))} className="text-[var(--color-muted)] hover:text-red-400" aria-label="Remove">
              ✕
            </button>
          </div>
        ))}
        <button
          onClick={() => setHighlights([...highlights, ""])}
          className="self-start rounded-lg border border-dashed border-[var(--color-border)] px-3 py-1.5 text-sm text-[var(--color-stage-qualified)]"
        >
          + Add point
        </button>
      </div>
    </div>
  );
}

function L({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-sm font-medium">{label}</span>
      {children}
    </label>
  );
}
