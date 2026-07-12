/** Small display helpers shared by the table views. */

export function fmtDate(iso?: string): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleString();
}

export function fmtRelative(iso?: string): string {
  if (!iso) return "never";
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "never";
  const days = Math.floor((Date.now() - then) / 86_400_000);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  return `${days}d ago`;
}

export const STAGE_ORDER = ["scraped", "qualified", "building", "proposed", "sold", "client"] as const;
