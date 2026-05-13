import eslint from "@eslint/js";
import { defineConfig } from "eslint/config";
import eslintConfigPrettier from "eslint-config-prettier/flat";
import eslintPluginPrettier from "eslint-plugin-prettier";
import { configs } from "typescript-eslint";

// ---------------------------------------------------------------------------
// Shared config
// ---------------------------------------------------------------------------

const sharedPlugins = {
  prettier: eslintPluginPrettier,
};

const sharedRules = {
  "prettier/prettier": "error",
  // Ban type assertions — narrow properly or restructure the types.
  // The only acceptable escape hatch is `as unknown as T` with a comment,
  // which this rule also blocks; override per-file when genuinely needed.
  "@typescript-eslint/consistent-type-assertions": [
    "error",
    { assertionStyle: "never" },
  ],
  // Prefer interfaces for object shapes — they support declaration merging
  // and produce cleaner error messages.
  "@typescript-eslint/consistent-type-definitions": ["error", "interface"],
  // No unused vars — dead code. Prefix with _ only when a binding is required
  // by the API contract (e.g. callback parameters).
  "@typescript-eslint/no-unused-vars": [
    "error",
    { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
  ],
};

// ---------------------------------------------------------------------------
// Exported config
// ---------------------------------------------------------------------------

export default defineConfig(
  { ignores: ["node_modules/", "**/node_modules/", "**/dist/"] },

  // Main process source
  {
    files: ["packages/main/src/**/*.ts"],
    extends: [
      eslint.configs.recommended,
      ...configs.strictTypeChecked,
      ...configs.stylisticTypeChecked,
    ],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    plugins: sharedPlugins,
    rules: {
      ...sharedRules,
      // Electron APIs return `T | null` from static methods like BrowserWindow.fromId().
      // After a null check, the type narrows, but subsequent null checks on the
      // same variable trigger false positives since the control flow analysis is
      // conservative across complex branching.
      "@typescript-eslint/no-unnecessary-condition": "off",
      // `delete obj[key]` is the standard way to remove properties in the
      // collapseNode helper. No Map/Object alternative is cleaner.
      "@typescript-eslint/no-dynamic-delete": "off",
    },
  },

  // Renderer source
  {
    files: ["packages/renderer/src/**/*.ts", "packages/renderer/src/**/*.tsx"],
    extends: [
      eslint.configs.recommended,
      ...configs.strictTypeChecked,
      ...configs.stylisticTypeChecked,
    ],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    plugins: sharedPlugins,
    rules: {
      ...sharedRules,
      "@typescript-eslint/no-unnecessary-condition": "off",
    },
  },

  // Preload (IIFE, @ts-nocheck) — excluded from tsconfig, skip ESLint
  {
    ignores: ["packages/main/src/preload.ts"],
  },

  // E2E tests — relax some strict rules for Playwright patterns
  {
    files: ["packages/e2e/**/*.ts"],
    extends: [
      eslint.configs.recommended,
      ...configs.strictTypeChecked,
      ...configs.stylisticTypeChecked,
    ],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    plugins: sharedPlugins,
    rules: {
      ...sharedRules,
      "@typescript-eslint/no-floating-promises": "off",
      "@typescript-eslint/consistent-type-assertions": "off",
      "@typescript-eslint/no-unnecessary-condition": "off",
      "@typescript-eslint/require-await": "off",
      "@typescript-eslint/no-unsafe-assignment": "off",
      "@typescript-eslint/no-unsafe-argument": "off",
      "@typescript-eslint/no-unsafe-call": "off",
      "@typescript-eslint/no-unsafe-member-access": "off",
      "@typescript-eslint/no-unsafe-return": "off",
      "@typescript-eslint/restrict-template-expressions": "off",
      // Playwright's boundingBox() returns null; non-null assertion is the
      // standard pattern after an expect().not.toBeNull() guard.
      "@typescript-eslint/no-non-null-assertion": "off",
      // boundingBox() returns BoundingBox | null; after null guard the type
      // is BoundingBox but ESLint sees `any` through the test infrastructure.
      "@typescript-eslint/restrict-plus-operands": "off",
    },
  },

  eslintConfigPrettier,
);
