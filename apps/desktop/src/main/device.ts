/**
 * Stable per-install device identity. Generated once, persisted in userData,
 * and reused across launches — this is the deviceId that tags every locally
 * buffered lead and maps to a Devices row in AgentX.
 */

import { randomUUID } from "node:crypto";
import { readFileSync, writeFileSync, existsSync } from "node:fs";

export function getOrCreateDeviceId(path: string): string {
  if (existsSync(path)) {
    try {
      const id = readFileSync(path, "utf8").trim();
      if (id) return id;
    } catch {
      /* fall through to regenerate */
    }
  }
  const id = randomUUID();
  writeFileSync(path, id, { mode: 0o600 });
  return id;
}
