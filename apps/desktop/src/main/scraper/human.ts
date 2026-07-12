/**
 * Human-paced timing and believable browser fingerprint ranges (§5.1/§5.2).
 * The anti-detection model is structural — low volume, one query at a time,
 * jittered delays that look like a person, not a loop. These helpers centralize
 * that so the whole engine stays "quiet."
 */

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

/** Jittered pause between actions on a listing — sub-second, human-ish. */
export function actionDelay(signal?: AbortSignal): Promise<void> {
  return sleep(randInt(350, 1400), signal);
}

/** Longer, more variable pause between whole listings / queries. */
export function betweenListingsDelay(signal?: AbortSignal): Promise<void> {
  return sleep(randInt(1200, 4200), signal);
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
