/**
 * Dev orchestrator: start the Vite renderer dev server, bundle main+preload,
 * then launch Electron pointed at the dev server (main reads VITE_DEV_SERVER_URL).
 * Requires the native modules to be rebuilt for Electron once (see README).
 */
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { createServer } from "vite";
import { build } from "esbuild";

// Load apps/desktop/.env (AGENTX_DELIVERY_TOKEN, etc.) into process.env if present.
if (existsSync(".env")) {
  try {
    process.loadEnvFile(".env");
    console.log("[dev] loaded .env");
  } catch (err) {
    console.warn("[dev] could not load .env:", err?.message ?? err);
  }
}

// Bundle only our source + @dinosales/* workspace TS; externalize every npm
// package (and its transitive deps) so they load from node_modules at runtime.
const externalizeNpm = {
  name: "externalize-npm",
  setup(b) {
    b.onResolve({ filter: /^[^./]/ }, (args) => {
      if (args.path.startsWith("@dinosales/")) return;
      return { path: args.path, external: true };
    });
  },
};
const common = { bundle: true, platform: "node", target: "node20", format: "cjs", sourcemap: true, plugins: [externalizeNpm] };

const server = await createServer({ configFile: "vite.config.ts" });
await server.listen();
const url = server.resolvedUrls?.local?.[0];
if (!url) throw new Error("vite dev server did not report a URL");

await build({ ...common, entryPoints: ["src/main/index.ts"], outfile: "dist/main/index.js" });
await build({ ...common, entryPoints: ["src/preload/index.ts"], outfile: "dist/preload/index.js" });

const electronBin = (await import("electron")).default;
const child = spawn(electronBin, ["."], {
  stdio: "inherit",
  env: { ...process.env, VITE_DEV_SERVER_URL: url },
});
child.on("close", async () => {
  await server.close();
  process.exit(0);
});
