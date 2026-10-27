/**
 * SWAI KH-02 V12.1.1 — Vitest Browser Acceptance Test
 */

import { describe, it, expect } from "vitest";
import { runKh02BrowserE2E } from "../../scripts/kh02/runKh02BrowserE2E";
import fs from "fs";

describe("SWAI KH-02 V12.1.1 — Chromium Browser E2E Acceptance", () => {
  it("launches Chromium, interacts with /products, and captures visual artifacts", async () => {
    const isServerReachable = await fetch("http://localhost:3000/products")
      .then((r) => r.status < 500)
      .catch(() => false);

    if (!isServerReachable) {
      console.log("[Notice] Server at http://localhost:3000 is offline; skipping standalone browser test.");
      return;
    }

    const result = await runKh02BrowserE2E({
      baseUrl: "http://localhost:3000",
      workspaceId: "default-workspace",
      headless: true,
      topic: "Pet Hair Remover",
    });

    expect(result.pageLoaded).toBe(true);
    expect(result.screenshots.length).toBeGreaterThanOrEqual(2);

    for (const shotPath of result.screenshots) {
      expect(fs.existsSync(shotPath)).toBe(true);
    }
  }, 45000);
});
