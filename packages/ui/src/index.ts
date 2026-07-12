/**
 * Shared design tokens — imported by both the Next.js web app and the Electron
 * renderer so the desktop UI matches the web app for free (brief §3).
 * Tailwind v4 consumes these via @theme in each app's CSS entry; keep the
 * source of truth here. Real component library lands with W3.
 */

export const tokens = {
  color: {
    brand: "#0f766e", // AgencyX primary (from AgentX project branding)
    brandContrast: "#ffffff",
    surface: "#0b1220",
    stage: {
      scraped: "#64748b",
      qualified: "#0ea5e9",
      building: "#f59e0b",
      proposed: "#8b5cf6",
      sold: "#22c55e",
      client: "#0f766e",
    },
  },
  font: {
    sans: "'Inter', system-ui, sans-serif",
    mono: "'JetBrains Mono', ui-monospace, monospace",
  },
  radius: {
    card: "0.75rem",
    control: "0.5rem",
  },
} as const;

export type Tokens = typeof tokens;
