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

/**
 * Build the preload script (IIFE via tsdown).
 */
function buildPreload(): void {
  execSync("npx tsdown", {
    cwd: mainPackage,
    stdio: "pipe",
    env: { ...process.env },
  });
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
 */
function electronBinaryPath(): string {
  // require('electron') returns the path to the binary as a string
  return require("electron") as unknown as string;
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
export const test = base.extend<ElectronTestFixture>({
  electronApp: async ({}, use) => {
    // 1. Build preload
    buildPreload();

    // 2. Start Vite
    const { server, url } = await startRenderer();

    // 3. Launch Electron
    const executablePath = electronBinaryPath();
    const app = await electron.launch({
      args: [mainPackage, "--headless=new"],
      cwd: projectRoot,
      env: {
        ...process.env,
        RENDERER_URL: url,
        NODE_OPTIONS: "--experimental-strip-types",
      },
      executablePath,
    });

    // 4. Provide to test
    await use(app);

    // 5. Teardown with force-kill fallback
    const teardown = async (): Promise<void> => {
      await Promise.race([
        app.close(),
        new Promise<void>((resolve) => setTimeout(resolve, 10_000)),
      ]);
      try {
        if (app.process()?.exitCode === null) {
          app.process()?.kill("SIGKILL");
        }
      } catch {
        // Process already exited
      }
    };
    await teardown();
    await server.close();
  },

  page: async ({ electronApp }, use) => {
    const page = await electronApp.firstWindow();
    await use(page);
  },
});

export { expect };
