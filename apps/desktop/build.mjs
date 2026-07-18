/**
 * Bundle the Electron main + preload with esbuild. We bundle ONLY our own source
 * and the @dinosales/* workspace TS (which ships as source, not built JS). Every
 * real npm package — electron, playwright-extra, better-sqlite3, and all their
 * transitive deps (kind-of, merge-deep, …) — is externalized and loads from
 * node_modules at runtime. Bundling those breaks native drivers / __dirname paths.
 */
import { build } from "esbuild";

const externalizeNpm = {
  name: "externalize-npm",
  setup(b) {
    // Every bare import (doesn't start with . or /) is a package or node builtin.
    b.onResolve({ filter: /^[^./]/ }, (args) => {
      if (args.path.startsWith("@dinosales/")) return; // bundle our workspace TS
      return { path: args.path, external: true }; // everything else → runtime
    });
  },
};

const common = {
  bundle: true,
  platform: "node",
  target: "node20",
  format: "cjs",
  sourcemap: true,
  plugins: [externalizeNpm],
  logLevel: "info",
  define: {
    // Release builds bake the delivery-scoped token in (CI secret). It's a
    // project identifier, not a tenant-data grant — reads/writes still require
    // the user's Clerk JWT (see .env.example). Empty when unset (dev/PR builds).
    __EMBEDDED_DELIVERY_TOKEN__: JSON.stringify(process.env.AGENTX_DELIVERY_TOKEN ?? ""),
  },
};

await build({ ...common, entryPoints: ["src/main/index.ts"], outfile: "dist/main/index.js" });
await build({ ...common, entryPoints: ["src/preload/index.ts"], outfile: "dist/preload/index.js" });

console.log("main + preload bundled → dist/");
