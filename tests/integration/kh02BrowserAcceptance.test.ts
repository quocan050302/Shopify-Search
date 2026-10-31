/**
 * SWAI KH-02 V12.1.1 — Vitest Browser Acceptance Test
 */

import { describe, it, expect } from "vitest";
import { runKh02BrowserE2E } from "../../scripts/kh02/runKh02BrowserE2E";
import fs from "fs";
import path from "path";

describe("SWAI KH-02 V12.1.1 — Chromium Browser E2E Acceptance", () => {
  it("launches Chromium, interacts with /products, and captures visual artifacts", async (ctx) => {
    const envBase = process.env.SWAI_BASE_URL || process.env.BASE_URL;
    const baseUrl = envBase && envBase.startsWith("http") ? envBase : "http://127.0.0.1:3000";
    const isServerReachable = await fetch(`${baseUrl}/api/v1/kh02/version`)
      .then(async (r) => {
        if (!r.ok) return false;
        const body = await r.json().catch(() => null);
        return Boolean(body && body.success === true);
      })
      .catch(() => false);

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
  }, 120000);
});
