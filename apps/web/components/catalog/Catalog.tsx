"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { saveService, deleteService, saveMicroservice, deleteMicroservice } from "@/app/settings/actions.ts";
import { CATEGORY_LABEL, SERVICE_CATEGORIES, formatPrice, BILLING_SUFFIX, type Billing } from "@/lib/catalog.ts";
import { PackageEditor, type MicroRow, type PkgRow } from "./PackageEditor.tsx";

interface SvcRow {
  id: string;
  name: string;
  description?: string;
  category?: string;
  active?: boolean;
}

const inp =
  "w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 text-sm text-[var(--color-ink)] focus:border-[color-mix(in_srgb,var(--color-brand)_55%,var(--color-border))] focus:outline-none";

export function Catalog({ services, microservices, packages }: { services: SvcRow[]; microservices: MicroRow[]; packages: PkgRow[] }) {
  const [selectedSvc, setSelectedSvc] = useState<string | null>(services[0]?.id ?? null);
  const [svcModal, setSvcModal] = useState<{ open: boolean; row: SvcRow | null }>({ open: false, row: null });
  const [microModal, setMicroModal] = useState<{ open: boolean; row: SvcRow | null }>({ open: false, row: null });
  const [pkgModal, setPkgModal] = useState<{ open: boolean; row: PkgRow | null } | null>(null);

  const service = services.find((s) => s.id === selectedSvc) ?? services[0] ?? null;
  const svcPackages = packages.filter((p) => p.service?.id === service?.id);

  return (
    <div className="flex flex-col gap-8 p-8">
      {/* Services + packages */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[240px_1fr]">
        {/* Services list */}
        <div>
          <div className="mb-2 flex items-center justify-between">
            <h2 className="text-sm font-semibold">Services</h2>
            <button onClick={() => setSvcModal({ open: true, row: null })} className="text-sm text-[var(--color-stage-qualified)]">
              + Add
            </button>
          </div>
          <div className="flex flex-col gap-1">
            {services.length === 0 && <p className="text-xs text-[var(--color-muted)]">No services yet. Add your first — e.g. "Website design".</p>}
            {services.map((s) => (
              <button
                key={s.id}
                onClick={() => setSelectedSvc(s.id)}
                className={`group flex items-center justify-between rounded-lg px-3 py-2 text-left text-sm ${
                  s.id === service?.id ? "bg-[var(--color-surface-2)] font-medium" : "text-[var(--color-muted)] hover:bg-[var(--color-surface-2)]/60 hover:text-[var(--color-ink)]"
                }`}
              >
                <span className="truncate">
                  {s.name}
                  {s.active === false && <span className="ml-1 text-xs text-[var(--color-muted)]">(hidden)</span>}
                </span>
                <span
                  onClick={(e) => {
                    e.stopPropagation();
                    setSvcModal({ open: true, row: s });
                  }}
                  className="opacity-0 group-hover:opacity-100"
                  aria-label="Edit service"
                >
                  ✎
                </span>
              </button>
            ))}
          </div>
        </div>

        {/* Packages for the selected service */}
        <div>
          {service ? (
            <>
              <div className="mb-3 flex items-center justify-between">
                <div>
                  <h2 className="font-semibold">{service.name}</h2>
                  {service.description && <p className="text-sm text-[var(--color-muted)]">{service.description}</p>}
                </div>
                <button onClick={() => setPkgModal({ open: true, row: null })} className="btn-primary px-3 py-2 text-sm">
                  + Add package
                </button>
              </div>
              {svcPackages.length === 0 ? (
                <div className="rounded-xl border border-dashed border-[var(--color-border)] p-8 text-center text-sm text-[var(--color-muted)]">
                  No packages under {service.name} yet. Add one to start building your offer.
                </div>
              ) : (
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
                  {svcPackages.map((p) => (
                    <button
                      key={p.id}
                      onClick={() => setPkgModal({ open: true, row: p })}
                      className="relative rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4 text-left transition hover:border-[color-mix(in_srgb,var(--color-brand)_45%,var(--color-border))]"
                    >
                      {p.popular && <span className="absolute right-3 top-3 rounded-full bg-[color-mix(in_srgb,var(--color-brand)_20%,transparent)] px-2 py-0.5 text-[10px] text-[var(--color-brand-2)]">Popular</span>}
                      <div className="font-medium">
                        {p.name}
                        {p.active === false && <span className="ml-1 text-xs text-[var(--color-muted)]">(hidden)</span>}
                      </div>
                      {p.summary && <div className="mt-0.5 line-clamp-2 text-xs text-[var(--color-muted)]">{p.summary}</div>}
                      <div className="mt-2 flex items-baseline gap-1">
                        <span className="text-lg font-semibold">{formatPrice(p.price, p.currency)}</span>
                        <span className="text-xs text-[var(--color-muted)]">{BILLING_SUFFIX[(p.billing as Billing) ?? "one_time"]}</span>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </>
          ) : (
            <div className="rounded-xl border border-dashed border-[var(--color-border)] p-10 text-center text-sm text-[var(--color-muted)]">
              Add a service on the left to start building packages.
            </div>
          )}
        </div>
      </div>

      {/* Microservice library */}
      <div className="border-t border-[var(--color-border)] pt-6">
        <div className="mb-1 flex items-center justify-between">
          <h2 className="text-sm font-semibold">Microservice library</h2>
          <button onClick={() => setMicroModal({ open: true, row: null })} className="text-sm text-[var(--color-stage-qualified)]">
            + Add microservice
          </button>
        </div>
        <p className="mb-3 text-xs text-[var(--color-muted)]">Reusable inclusions you attach to packages. Edit one here and every package that uses it updates.</p>
        {microservices.length === 0 ? (
          <p className="text-sm text-[var(--color-muted)]">Nothing yet — e.g. "Mobile responsive build", "3 rounds of revisions".</p>
        ) : (
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {microservices.map((m) => (
              <button
                key={m.id}
                onClick={() => setMicroModal({ open: true, row: m })}
                className="flex flex-col rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-left hover:border-[color-mix(in_srgb,var(--color-brand)_45%,var(--color-border))]"
              >
                <span className="text-sm">{m.name}</span>
                {m.description && <span className="line-clamp-1 text-xs text-[var(--color-muted)]">{m.description}</span>}
              </button>
            ))}
          </div>
        )}
      </div>

      {svcModal.open && <EntityModal kind="service" initial={svcModal.row} onClose={() => setSvcModal({ open: false, row: null })} />}
      {microModal.open && <EntityModal kind="microservice" initial={microModal.row} onClose={() => setMicroModal({ open: false, row: null })} />}
      {pkgModal?.open && service && <PackageEditor service={service} microservices={microservices} initial={pkgModal.row} onClose={() => setPkgModal(null)} />}
    </div>
  );
}

/** Shared add/edit modal for a service or a microservice (same fields). */
function EntityModal({ kind, initial, onClose }: { kind: "service" | "microservice"; initial: SvcRow | null; onClose: () => void }) {
  const router = useRouter();
  const [name, setName] = useState(initial?.name ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [category, setCategory] = useState(initial?.category ?? "other");
  const [active, setActive] = useState(initial?.active ?? true);
  const [busy, setBusy] = useState<null | "save" | "delete">(null);
  const [error, setError] = useState<string | null>(null);

  const save = kind === "service" ? saveService : saveMicroservice;
  const del = kind === "service" ? deleteService : deleteMicroservice;
  const label = kind === "service" ? "service" : "microservice";

  async function onSave() {
    setBusy("save");
    setError(null);
    const res = await save({ id: initial?.id, name, description, category, active });
    setBusy(null);
    if (res.ok) {
      router.refresh();
      onClose();
    } else setError(res.error ?? "Save failed.");
  }
  async function onDelete() {
    if (!initial?.id) return;
    if (!window.confirm(`Delete the "${initial.name}" ${label}?`)) return;
    setBusy("delete");
    const res = await del(initial.id);
    setBusy(null);
    if (res.ok) {
      router.refresh();
      onClose();
    } else setError(res.error ?? "Delete failed.");
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4" onClick={onClose}>
      <div className="w-full max-w-md rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-6 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 text-lg font-semibold">
          {initial ? "Edit" : "New"} {label}
        </div>
        <div className="flex flex-col gap-4">
          <label className="flex flex-col gap-1.5">
            <span className="text-sm font-medium">Name</span>
            <input className={inp} value={name} onChange={(e) => setName(e.target.value)} placeholder={kind === "service" ? "Website design" : "Mobile responsive build"} />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-sm font-medium">Description</span>
            <textarea className={inp} rows={2} value={description} onChange={(e) => setDescription(e.target.value)} />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-sm font-medium">Category</span>
            <select className={inp} value={category} onChange={(e) => setCategory(e.target.value)}>
              {SERVICE_CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {CATEGORY_LABEL[c]}
                </option>
              ))}
            </select>
          </label>
          <label className="flex items-center gap-2 text-sm text-[var(--color-muted)]">
            <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} /> Active
          </label>
          <div className="flex items-center gap-3 border-t border-[var(--color-border)] pt-4">
            <button onClick={onSave} disabled={busy !== null || !name.trim()} className="btn-primary px-4 py-2 text-sm">
              {busy === "save" ? "Saving…" : "Save"}
            </button>
            {initial && (
              <button onClick={onDelete} disabled={busy !== null} className="rounded-lg border border-[var(--color-border)] px-3 py-2 text-sm text-red-400 hover:bg-red-500/10">
                {busy === "delete" ? "Deleting…" : "Delete"}
              </button>
            )}
            {error && <span className="text-sm text-red-400">{error}</span>}
          </div>
        </div>
      </div>
    </div>
  );
}
