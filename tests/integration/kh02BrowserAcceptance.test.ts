/**
 * SWAI KH-02 V12.1.1 — Vitest Browser Acceptance Test
 */

import { describe, it, expect } from "vitest";
import { runKh02BrowserE2E } from "../../scripts/kh02/runKh02BrowserE2E";
import fs from "fs";

describe("SWAI KH-02 V12.1.1 — Chromium Browser E2E Acceptance", () => {
  it("launches Chromium, interacts with /products, and captures visual artifacts", async () => {
    const result = await runKh02BrowserE2E({
      baseUrl: "http://localhost:3000",
      workspaceId: "ws_default",
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
