import { defineConfig } from "tsdown";

export default defineConfig({
  entry: ["src/preload.ts"],
  format: ["iife"],
  outDir: "dist",
  clean: true,
});
