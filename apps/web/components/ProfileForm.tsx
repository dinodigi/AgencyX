"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { saveAgencyProfile, uploadLogo, type AgencyProfileInput } from "@/app/settings/actions.ts";

type Values = AgencyProfileInput;

const EMPTY: Values = {
  name: "",
  logo: "",
  logo_url: "",
  tagline: "",
  website: "",
  phone: "",
  email: "",
  address: "",
  brand_color: "#7c5cff",
  accent_color: "#22d3ee",
  proposal_footer: "",
};

const inp =
  "w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 text-sm text-[var(--color-ink)] focus:border-[color-mix(in_srgb,var(--color-brand)_55%,var(--color-border))] focus:outline-none";

/**
 * Agency profile editor — writes the org's single agencies row and shows a live
 * proposal-header preview themed by the brand color, so the operator sees the
 * branding a prospect will see.
 */
export function ProfileForm({ initial, initialLogoPreview }: { initial: Partial<Values> | null; initialLogoPreview?: string }) {
  const router = useRouter();
  const [v, setV] = useState<Values>({ ...EMPTY, ...initial });
  const [logoPreview, setLogoPreview] = useState<string>(initialLogoPreview ?? "");
  const [uploading, setUploading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const set = <K extends keyof Values>(k: K, val: Values[K]) => {
    setV((p) => ({ ...p, [k]: val }));
    setMsg(null);
  };

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) {
      if (file.size > 10 * 1024 * 1024) {
        setMsg({ ok: false, text: "That image is over 10 MB — pick a smaller one." });
      } else {
        setUploading(true);
        setMsg(null);
        const fd = new FormData();
        fd.append("file", file);
        const res = await uploadLogo(fd);
        setUploading(false);
        if (res.ok && res.id && res.url) {
          setV((p) => ({ ...p, logo: res.id }));
          setLogoPreview(res.url);
        } else {
          setMsg({ ok: false, text: res.error ?? "Upload failed." });
        }
      }
    }
    if (fileRef.current) fileRef.current.value = ""; // allow re-selecting the same file
  }

  function clearLogo() {
    setV((p) => ({ ...p, logo: "" }));
    setLogoPreview("");
    setMsg(null);
  }

  async function save() {
    setBusy(true);
    setMsg(null);
    try {
      const res = await saveAgencyProfile(v);
      setMsg(res.ok ? { ok: true, text: "Profile saved." } : { ok: false, text: res.error ?? "Save failed." });
      if (res.ok) router.refresh();
    } finally {
      setBusy(false);
    }
  }

  const brand = v.brand_color || "#7c5cff";
  const accent = v.accent_color || "#22d3ee";
  const initials = (v.name || "AX")
    .split(/\s+/)
    .map((w) => w[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  return (
    <div className="grid grid-cols-1 gap-8 lg:grid-cols-[1fr_340px]">
      {/* Form */}
      <div className="flex flex-col gap-5">
        <Field label="Company name">
          <input className={inp} value={v.name} onChange={(e) => set("name", e.target.value)} placeholder="Acme Digital" />
        </Field>
        <Field label="Logo" hint="Upload an image (≤10 MB) — stored in your R2 bucket via AgentX — or paste a URL below.">
          <div className="flex items-center gap-3">
            <div className="grid h-14 w-14 shrink-0 place-items-center overflow-hidden rounded-xl border border-[var(--color-border)] bg-[var(--color-bg)]">
              {logoPreview || v.logo_url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={logoPreview || v.logo_url} alt="" className="h-full w-full object-contain" />
              ) : (
                <span className="text-xs text-[var(--color-muted)]">{initials}</span>
              )}
            </div>
            <label className="cursor-pointer rounded-lg border border-[var(--color-border)] px-3 py-2 text-sm hover:bg-[var(--color-surface-2)]">
              {uploading ? "Uploading…" : "Upload logo"}
              <input ref={fileRef} type="file" accept="image/*" className="hidden" disabled={uploading} onChange={onFile} />
            </label>
            {(logoPreview || v.logo) && (
              <button onClick={clearLogo} className="text-sm text-[var(--color-muted)] hover:text-red-400">
                Remove
              </button>
            )}
          </div>
        </Field>
        <Field label="…or logo URL" hint="An externally hosted image, if you prefer not to upload.">
          <input className={inp} value={v.logo_url ?? ""} onChange={(e) => set("logo_url", e.target.value)} placeholder="https://…/logo.png" />
        </Field>
        <Field label="Tagline">
          <input className={inp} value={v.tagline ?? ""} onChange={(e) => set("tagline", e.target.value)} placeholder="Websites that win local customers" />
        </Field>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Website">
            <input className={inp} value={v.website ?? ""} onChange={(e) => set("website", e.target.value)} placeholder="acmedigital.com" />
          </Field>
          <Field label="Email">
            <input className={inp} value={v.email ?? ""} onChange={(e) => set("email", e.target.value)} placeholder="hello@acmedigital.com" />
          </Field>
          <Field label="Phone">
            <input className={inp} value={v.phone ?? ""} onChange={(e) => set("phone", e.target.value)} placeholder="(555) 010-2030" />
          </Field>
          <Field label="Address">
            <input className={inp} value={v.address ?? ""} onChange={(e) => set("address", e.target.value)} placeholder="Los Angeles, CA" />
          </Field>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <Field label="Brand color">
            <ColorInput value={brand} onChange={(c) => set("brand_color", c)} />
          </Field>
          <Field label="Accent color">
            <ColorInput value={accent} onChange={(c) => set("accent_color", c)} />
          </Field>
        </div>

        <Field label="Proposal footer" hint="Boilerplate appended to every proposal (terms, legal).">
          <textarea className={inp} rows={3} value={v.proposal_footer ?? ""} onChange={(e) => set("proposal_footer", e.target.value)} placeholder="Prices valid 30 days. …" />
        </Field>

        <div className="flex items-center gap-3">
          <button onClick={save} disabled={busy || !v.name.trim()} className="btn-primary px-4 py-2 text-sm">
            {busy ? "Saving…" : "Save profile"}
          </button>
          {msg && <span className={`text-sm ${msg.ok ? "text-[var(--color-stage-sold)]" : "text-red-400"}`}>{msg.text}</span>}
        </div>
      </div>

      {/* Live preview */}
      <div>
        <div className="mb-2 text-xs text-[var(--color-muted)]">Proposal header preview</div>
        <div className="overflow-hidden rounded-2xl border border-[var(--color-border)]">
          <div className="p-5" style={{ background: `linear-gradient(135deg, ${brand}, ${accent})` }}>
            <div className="flex items-center gap-3">
              {logoPreview || v.logo_url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={logoPreview || v.logo_url} alt="" className="h-11 w-11 rounded-xl bg-white/10 object-contain" />
              ) : (
                <div className="grid h-11 w-11 place-items-center rounded-xl bg-white/20 text-sm font-bold text-white">{initials}</div>
              )}
              <div>
                <div className="text-base font-semibold text-white">{v.name || "Your company"}</div>
                {v.tagline && <div className="text-xs text-white/85">{v.tagline}</div>}
              </div>
            </div>
          </div>
          <div className="space-y-1 bg-[var(--color-surface)] p-4 text-xs text-[var(--color-muted)]">
            <div className="mb-1 font-medium text-[var(--color-ink)]">Prepared for a prospect</div>
            {v.website && <div>{v.website}</div>}
            {v.email && <div>{v.email}</div>}
            {v.phone && <div>{v.phone}</div>}
            {v.address && <div>{v.address}</div>}
            {!(v.website || v.email || v.phone || v.address) && <div>Add contact details to fill this out.</div>}
          </div>
        </div>
      </div>
    </div>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-sm font-medium">{label}</span>
      {children}
      {hint && <span className="text-xs text-[var(--color-muted)]">{hint}</span>}
    </label>
  );
}

function ColorInput({ value, onChange }: { value: string; onChange: (c: string) => void }) {
  return (
    <div className="flex items-center gap-2">
      <input type="color" value={value} onChange={(e) => onChange(e.target.value)} className="h-9 w-10 cursor-pointer rounded-md border border-[var(--color-border)] bg-transparent" />
      <input className={inp} value={value} onChange={(e) => onChange(e.target.value)} />
    </div>
  );
}
