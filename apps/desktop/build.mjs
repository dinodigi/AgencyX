/**
 * Bundle the Electron main + preload with esbuild. Bundling (not tsc emit) is
 * what lets these files use .ts-extension imports and workspace TS deps
 * (@dinosales/*) directly, while keeping native modules external so
 * electron-builder can rebuild them for the target ABI.
 */
import { build } from "esbuild";

const NATIVE = [
  "better-sqlite3",
  "keytar",
  "electron",
  "electron-updater",
  // Playwright + stealth must load from node_modules at runtime (they have
  // native drivers + __dirname-relative paths that don't survive bundling).
  "playwright-extra",
  "playwright-core",
  "playwright",
  "puppeteer-extra-plugin-stealth",
];

const common = {
  bundle: true,
  platform: "node",
  target: "node20",
  format: "cjs",
  sourcemap: true,
  external: NATIVE,
  logLevel: "info",
};

await build({ ...common, entryPoints: ["src/main/index.ts"], outfile: "dist/main/index.js" });
await build({ ...common, entryPoints: ["src/preload/index.ts"], outfile: "dist/preload/index.js" });

console.log("main + preload bundled → dist/");
