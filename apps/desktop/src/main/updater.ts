/**
 * Self-update via electron-updater reading the GitHub Releases feed (brief §7.2).
 * Checks on launch, downloads in the background, installs on quit. This is the
 * whole self-update loop — no extra infrastructure. Proving THIS end-to-end on a
 * dummy build is the W1 exit gate, before any scraper logic lands.
 */

import { autoUpdater } from "electron-updater";

export interface UpdaterHooks {
  onStatus: (status: string, extra?: { version?: string; percent?: number }) => void;
}

export function initUpdater({ onStatus }: UpdaterHooks): { check: () => void } {
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on("checking-for-update", () => onStatus("checking"));
  autoUpdater.on("update-available", (info) => onStatus("available", { version: info.version }));
  autoUpdater.on("update-not-available", () => onStatus("current"));
  autoUpdater.on("download-progress", (p) => onStatus("downloading", { percent: Math.round(p.percent) }));
  autoUpdater.on("update-downloaded", (info) => onStatus("ready", { version: info.version }));
  autoUpdater.on("error", (err) => onStatus("error", { version: err?.message }));

  return {
    check() {
      // In dev there is no update feed; guard so it doesn't throw.
      autoUpdater.checkForUpdates().catch((err) => onStatus("error", { version: String(err?.message ?? err) }));
    },
  };
}
