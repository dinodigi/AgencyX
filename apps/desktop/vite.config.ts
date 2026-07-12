import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Renderer-only Vite config. The main + preload are bundled separately by
// build.mjs (esbuild). base:"./" makes the built renderer load from file://.
export default defineConfig({
  root: ".",
  base: "./",
  plugins: [react()],
  build: {
    outDir: "dist/renderer",
    emptyOutDir: true,
  },
  server: {
    port: 5273,
  },
});
