import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts", "src/preload.ts"],
  format: ["esm"],
  outDir: "dist",
  sourcemap: true,
  clean: true,
  external: ["electron"],
  outExtension: () => ({ js: ".js" }),
});
