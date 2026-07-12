# How the scraper works

There are **two** sources behind one engine. What you pick is the "Dry run" checkbox.

## Mock source (Dry run ON) — the default
Fake placeholder data. It does **not** touch Google — it generates believable-looking businesses (`Prime Plumbers`, websites ending in **`.example`**, addresses using your ZIP) with human-paced delays. Its only job is to exercise the pipeline: scrape → local outbox → sync → web app. If you see `.example` URLs, you're on the mock.

## Google source (Dry run OFF) — the real one
`src/main/scraper/google-source.ts`, Playwright driving **real Chrome** (`channel: "chrome"`, `headless: false`), with the stealth plugin. When you Start run:

1. **Launches a real Chrome window** — you can literally watch it.
2. Navigates to `google.com/maps/search/{keyword} {zip}`.
3. Checks for a **consent wall** or **CAPTCHA** (Google often shows these — logged, not silently swallowed).
4. Finds the **results feed** (`div[role="feed"]`).
5. For each listing card: scrolls it into view, clicks it, reads the detail panel, and extracts name / phone / website / address / category / rating / reviews / claimed / placeId — with jittered human delays between each.
6. Scrolls the feed to load more, repeats until it hits your **Max leads**.
7. On a CAPTCHA it **cools down** (pauses the device) rather than hammering.

Every step now logs to the **Run log**, and each captured business appears live in the **Captured leads** table — so you can see exactly where it is and where it stops.

## Why a real run might capture little (yet)
Google's DOM changes constantly, so the **selectors need tuning against live output** — this is expected, ongoing work (brief §5.2/§12.5), not a bug. Common blockers:
- **Consent/cookie wall** — Google shows it before results; the scraper detects and logs it but doesn't dismiss it yet.
- **Feed/card selector drift** — if Google renamed a class/role, "results feed not found" appears.
- **Detail-panel selectors** — if a listing opens but no name extracts, that field's selector moved.

## How to tune it (the loop)
1. Uncheck **Dry run**, Start run, and **watch both** the Chrome window and the Run log.
2. Note where it stops — the log names the stage ("results feed not found", "consent page", "listing 3: detail didn't load").
3. Every brittle anchor lives in one file: **`src/main/scraper/selectors.ts`**. Fix the one that broke.
4. Re-run. Repeat until fields come through cleanly.

All selectors are centralized on purpose so a Google change is a one-file fix, not a hunt.
