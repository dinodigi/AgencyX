/**
 * Desktop auto-run — the loop that keeps the queue moving without a human
 * clicking "Run next queued". When enabled (default on) and the device is idle,
 * signed-in, and registered, it claims the oldest pending search and runs it,
 * then chains to the next when that finishes.
 *
 * Guardrails so unattended runs stay polite:
 *   - a rolling hourly activity budget (stop after N auto-starts/hour, then rest),
 *   - a cool-down after a block (CAPTCHA/anti-bot) before trying again,
 *   - it only ever CLAIMS work; it never bypasses the human-pacing in the engine.
 *
 * The controller owns enable/cooldown/budget state; index.ts supplies the
 * "can I claim right now?" predicate and the actual claim action.
 */

import { readFileSync, writeFileSync } from "node:fs";
import type { AutoRunState } from "../shared/ipc.ts";

const POLL_MS = 30_000; // idle poll cadence when nothing is chaining
const MAX_RUNS_PER_HOUR = 30; // activity budget for unattended scraping
const HOUR_MS = 60 * 60 * 1000;
const DEFAULT_COOLDOWN_MS = 15 * 60 * 1000;

export interface AutoRunDeps {
  /** JSON file for the persisted enabled flag. */
  settingsPath: string;
  onChange: (s: AutoRunState) => void;
  log: (level: "info" | "warn" | "error", message: string) => void;
  /** True only when a claim could actually start now (signed-in, registered, idle). */
  canClaim: () => boolean;
  /** Claim + start the next pending search. Resolves true if a run was started. */
  claim: () => Promise<boolean>;
}

export class AutoRunController {
  private enabled: boolean;
  private cooldownUntil = 0;
  private runTimes: number[] = [];
  private timer: NodeJS.Timeout | null = null;
  private ticking = false;

  constructor(private deps: AutoRunDeps) {
    this.enabled = loadEnabled(deps.settingsPath);
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => void this.tick("poll"), POLL_MS);
    // Kick once shortly after start so a pending queue doesn't wait a full cycle.
    setTimeout(() => void this.tick("startup"), 2500);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  state(): AutoRunState {
    return {
      enabled: this.enabled,
      cooldownUntil: this.cooldownUntil > Date.now() ? this.cooldownUntil : undefined,
      ranThisHour: this.recentRuns(),
      status: this.describe(),
    };
  }

  setEnabled(on: boolean): AutoRunState {
    this.enabled = on;
    saveEnabled(this.deps.settingsPath, on);
    this.deps.log("info", `auto-run ${on ? "enabled" : "disabled"}`);
    this.emit();
    if (on) void this.tick("enable");
    return this.state();
  }

  /** Called by index.ts whenever ANY run finishes — chains the next claim. */
  notifyFinished(outcomeKind: string, backoffMs?: number): void {
    if (outcomeKind === "blocked") {
      this.cooldownUntil = Date.now() + (backoffMs ?? DEFAULT_COOLDOWN_MS);
      const mins = Math.round((this.cooldownUntil - Date.now()) / 60000);
      this.deps.log("warn", `auto-run paused ~${mins}m after a block`);
      this.emit();
      return;
    }
    // Successful/empty finish → try to pick up the next one immediately.
    void this.tick("chain");
  }

  private recentRuns(): number {
    const cutoff = Date.now() - HOUR_MS;
    this.runTimes = this.runTimes.filter((t) => t >= cutoff);
    return this.runTimes.length;
  }

  private describe(): string {
    if (!this.enabled) return "off";
    if (this.cooldownUntil > Date.now()) return "cooling down after a block";
    if (this.recentRuns() >= MAX_RUNS_PER_HOUR) return "hourly budget reached — resting";
    return "watching the queue";
  }

  private emit(): void {
    this.deps.onChange(this.state());
  }

  private async tick(_reason: string): Promise<void> {
    if (this.ticking) return;
    if (!this.enabled) return;
    if (Date.now() < this.cooldownUntil) return;
    if (this.recentRuns() >= MAX_RUNS_PER_HOUR) {
      this.emit();
      return;
    }
    if (!this.deps.canClaim()) return;

    this.ticking = true;
    try {
      const started = await this.deps.claim();
      if (started) {
        this.runTimes.push(Date.now());
        this.emit();
      }
    } catch (err) {
      this.deps.log("warn", `auto-run claim failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      this.ticking = false;
    }
  }
}

function loadEnabled(path: string): boolean {
  try {
    const raw = JSON.parse(readFileSync(path, "utf8")) as { enabled?: boolean };
    return raw.enabled !== false; // default ON
  } catch {
    return true; // no settings file yet → on by default
  }
}

function saveEnabled(path: string, enabled: boolean): void {
  try {
    writeFileSync(path, JSON.stringify({ enabled }), "utf8");
  } catch {
    // Non-fatal: the toggle still works for this session, just not persisted.
  }
}
