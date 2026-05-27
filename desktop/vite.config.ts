import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";

export default defineConfig({
  root: path.resolve(__dirname, "renderer"),
  base: "./",
  plugins: [react()],
  server: {
    port: 5180,
    strictPort: true,
  },
  build: {
    outDir: path.resolve(__dirname, "..", "dist-desktop", "renderer"),
    emptyOutDir: true,
    sourcemap: true,
    target: "chrome120",
  },
});
