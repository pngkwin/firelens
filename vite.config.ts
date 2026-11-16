import { readFileSync } from "node:fs";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// `vite preview` (and so Playwright) serves the same site-wide security headers
// as production, read from vercel.json so there is one source of truth.
type VercelHeaders = { headers: Array<{ source: string; headers: Array<{ key: string; value: string }> }> };
const vercel = JSON.parse(readFileSync(new URL("./vercel.json", import.meta.url), "utf8")) as VercelHeaders;
const siteHeaders = Object.fromEntries((vercel.headers.find((h) => h.source === "/(.*)")?.headers ?? []).map((h) => [h.key, h.value]));

export default defineConfig({
  plugins: [react(), tailwindcss()],
  preview: { headers: siteHeaders },
  build: {
    rollupOptions: {
      output: { manualChunks: { map: ["maplibre-gl"], charts: ["recharts"] } },
    },
  },
});
