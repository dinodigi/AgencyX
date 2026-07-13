/**
 * Human-paced timing and believable browser fingerprint ranges (§5.1/§5.2).
 * The anti-detection model is structural — low volume, one query at a time,
 * jittered delays that look like a person, not a loop. These helpers centralize
 * that so the whole engine stays "quiet."
 *
 * Delay magnitudes come from a SpeedProfile (careful/balanced/fast) the operator
 * picks per search — see SPEED_PROFILES in @dinosales/types. When no profile is
 * passed the balanced defaults apply, so callers that don't care still behave.
 */

import { SPEED_PROFILES, DEFAULT_SPEED, type SpeedProfile } from "@dinosales/types";

const DEFAULT_PROFILE = SPEED_PROFILES[DEFAULT_SPEED];

export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new DOMException("Aborted", "AbortError"));
    const t = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(t);
      reject(new DOMException("Aborted", "AbortError"));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

/** Uniform int in [min, max]. */
export function randInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

/** Uniform int within a [min, max] range tuple. */
export function randRange(range: readonly [number, number]): number {
  return randInt(range[0], range[1]);
}

/** Short settle after a nav/action within a listing (profile-scaled). */
export function actionDelay(signal?: AbortSignal, profile: SpeedProfile = DEFAULT_PROFILE): Promise<void> {
  return sleep(randRange(profile.settleMs), signal);
}

/** The dominant human-pacing pause between whole listings (profile-scaled). */
export function betweenListingsDelay(signal?: AbortSignal, profile: SpeedProfile = DEFAULT_PROFILE): Promise<void> {
  return sleep(randRange(profile.betweenListingsMs), signal);
}

/** Pause between feed scroll steps during discovery (profile-scaled). */
export function scrollPause(signal?: AbortSignal, profile: SpeedProfile = DEFAULT_PROFILE): Promise<void> {
  return sleep(randRange(profile.scrollPauseMs), signal);
}

// Believable desktop viewport + UA ranges. Kept deliberately narrow to common
// real configurations — an exotic fingerprint is as suspicious as an obvious bot.
const VIEWPORTS = [
  { width: 1280, height: 800 },
  { width: 1366, height: 768 },
  { width: 1440, height: 900 },
  { width: 1536, height: 864 },
  { width: 1920, height: 1080 },
];

const CHROME_MAJORS = [122, 123, 124, 125, 126];

export function randomViewport(): { width: number; height: number } {
  return VIEWPORTS[randInt(0, VIEWPORTS.length - 1)]!;
}

export function randomUserAgent(): string {
  const major = CHROME_MAJORS[randInt(0, CHROME_MAJORS.length - 1)]!;
  return `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${major}.0.0.0 Safari/537.36`;
}
