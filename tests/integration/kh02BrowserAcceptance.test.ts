/**
 * SWAI KH-02 V12.1.1 — Vitest Browser Acceptance Test
 */

import { describe, it, expect } from "vitest";
import { runKh02BrowserE2E } from "../../scripts/kh02/runKh02BrowserE2E";
import { startSwaiTestServer, type SwaiTestServerHandle } from "../e2e/helpers/startSwaiTestServer";
import { createIsolatedTestDatabase, type TestDatabaseHandle } from "../helpers/createIsolatedTestDatabase";
import fs from "fs";
import path from "path";

describe("SWAI KH-02 V12.1.1 — Chromium Browser E2E Acceptance", () => {
  it("launches Chromium, interacts with /products, and captures visual artifacts", async (ctx) => {
    const rawEnvBase = process.env.SWAI_BASE_URL || process.env.BASE_URL;
    const envBase = rawEnvBase && rawEnvBase.startsWith("http") ? rawEnvBase : undefined;
    let baseUrl = envBase ? envBase : "http://127.0.0.1:3000";
    let ownedServer: SwaiTestServerHandle | null = null;
    let ownedDb: TestDatabaseHandle | null = null;
    let isServerReachable = await fetch(`${baseUrl}/api/v1/kh02/version`)
      .then(async (r) => {
        if (!r.ok) return false;
        const body = await r.json().catch(() => null);
        return Boolean(body && body.success === true);
      })
      .catch(() => false);

    if (!isServerReachable && !envBase) {
      ownedDb = await createIsolatedTestDatabase({ prefix: "kh02-browser-acc" });
      ownedServer = await startSwaiTestServer({
        databaseUrl: ownedDb.url,
        allowLocalBypass: true,
      });
      baseUrl = ownedServer.baseUrl;
      isServerReachable = true;
    }

    if (!isServerReachable) {
      ctx.skip(
        `BLOCKED_INFRASTRUCTURE: SWAI server at ${baseUrl} is offline. Browser test explicitly SKIPPED, not PASS.`
      );
      return;
    }

    const testScreenshotDir = path.resolve(process.cwd(), "test-results/browser-screenshots");
    if (!fs.existsSync(testScreenshotDir)) {
      fs.mkdirSync(testScreenshotDir, { recursive: true });
    }

    try {
      const result = await runKh02BrowserE2E({
        baseUrl,
        workspaceId: "test-integration-browser-ws",
        headless: true,
        topic: "Pet Hair Remover",
        screenshotDir: testScreenshotDir,
      });

      expect(result.pageLoaded).toBe(true);
      expect(result.screenshots.length).toBeGreaterThanOrEqual(2);

      for (const shotPath of result.screenshots) {
        expect(fs.existsSync(shotPath)).toBe(true);
      }
    } finally {
      if (ownedServer) {
        await ownedServer.stop();
      }
      if (ownedDb) {
        await ownedDb.teardown();
      }
    }
  }, 120000);
});
