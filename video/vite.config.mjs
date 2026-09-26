import { fileURLToPath } from "node:url";

import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const root = fileURLToPath(new URL(".", import.meta.url));
const repoSrc = fileURLToPath(new URL("../src", import.meta.url));

// The scene builds on its own: its cache and output never touch Astro's.
export default defineConfig({
  root,
  base: "./",
  cacheDir: `${root}.vite`,
  publicDir: false,
  plugins: [react(), tailwindcss()],
  resolve: { alias: { "@": repoSrc } },
  build: {
    outDir: `${root}dist`,
    emptyOutDir: true,
    assetsInlineLimit: 0,
    chunkSizeWarningLimit: 2000,
  },
});
