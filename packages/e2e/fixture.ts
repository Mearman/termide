/**
 * Test fixture: builds preload, starts Vite, launches Electron, tears it all down.
 *
 * Usage:
 *   import { test, expect } from "./fixture";
 */
import { test as base, expect } from "@playwright/test";
import { _electron as electron } from "@playwright/test";
import type { ElectronApplication, Page } from "@playwright/test";
import { createServer, type ViteDevServer, type InlineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { execSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..", "..");
const mainPackage = path.join(projectRoot, "packages", "main");
const rendererPackage = path.join(projectRoot, "packages", "renderer");

interface ElectronTestFixture {
  electronApp: ElectronApplication;
  page: Page;
}

interface ViteFixture {
  viteServer: { server: ViteDevServer; url: string };
}

/**
 * Build the preload script (IIFE via tsdown).
 * Run once per worker, not per test.
 */
let preloadBuilt = false;
function buildPreload(): void {
  if (preloadBuilt) return;
  execSync("npx tsdown", {
    cwd: mainPackage,
    stdio: "pipe",
    env: { ...process.env },
  });
  preloadBuilt = true;
}

/**
 * Start Vite dev server for the renderer on a random port.
 */
async function startRenderer(): Promise<{ server: ViteDevServer; url: string }> {
  const config: InlineConfig = {
    configFile: path.join(rendererPackage, "vite.config.ts"),
    root: rendererPackage,
    server: { port: 0 },
    logLevel: "warn",
  };

  const server = await createServer(config);
  await server.listen();

  const address = server.httpServer!.address();
  const port =
    typeof address === "object" && address !== null ? address.port : 5173;

  return { server, url: `http://localhost:${port}` };
}

/**
 * Path to the Electron binary.
 * Resolved from the main package where electron is declared.
 */
function electronBinaryPath(): string {
  const mainPkg = path.join(projectRoot, "packages", "main");
  const mainRequire = createRequire(path.join(mainPkg, "package.json"));
  return mainRequire("electron") as unknown as string;
}

/**
 * Extended Playwright test with Electron lifecycle management.
 *
 * Each test gets:
 *   - `electronApp`: the launched ElectronApplication
 *   - `page`: the first BrowserWindow's Page
 *
 * The fixture handles:
 *   1. Building the preload script via tsdown
 *   2. Starting a Vite dev server on a random port
 *   3. Launching Electron with RENDERER_URL pointing at Vite
 *   4. Tearing everything down after the test
 */
export const test = base.extend<ElectronTestFixture & ViteFixture>({
  // Shared Vite server — created once per worker, reused across tests
  viteServer: async ({}, use) => {
    const { server, url } = await startRenderer();
    await use({ server, url });
    await server.close();
  },

  electronApp: async ({ viteServer }, use) => {
    // 1. Build preload (once per worker)
    buildPreload();

    // 2. Launch Electron (reuses shared Vite server)
    const executablePath = electronBinaryPath();
    const app = await electron.launch({
      args: [mainPackage, "--headless=new"],
      cwd: projectRoot,
      env: {
        ...process.env,
        RENDERER_URL: viteServer.url,
        NODE_OPTIONS: "--experimental-strip-types",
      },
      executablePath,
    });

    // 3. Provide to test
    await use(app);

    // 4. Teardown — kill the process immediately
    // CDP Browser.close() is unreliable for Electron (doesn't clean up
    // main process windows, intervals, etc.). SIGKILL is the sure way.
    try {
      app.process()?.kill("SIGKILL");
    } catch {
      // Process already exited
    }
    // Wait for process to actually exit
    try {
      await app.close();
    } catch {
      // Already killed
    }
  },

  page: async ({ electronApp }, use) => {
    const page = await electronApp.firstWindow();
    await use(page);
  },
});

export { expect };
