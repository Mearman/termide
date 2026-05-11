import { defineConfig } from "tsdown";

export default defineConfig({
  entry: ["src/preload.ts"],
  format: ["esm"],
  outDir: "dist",
  clean: true,
  deps: { neverBundle: ["electron"] },
});
