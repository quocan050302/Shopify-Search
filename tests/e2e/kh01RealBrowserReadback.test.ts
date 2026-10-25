import { describe, it, expect, beforeAll, afterAll } from "vitest";
import http from "http";
import { AddressInfo } from "net";
import fs from "fs";
import {
  verifyExactRunBrowserReadback,
  resolveChromeExecutablePath,
} from "../../scripts/kh01/runFullAcceptance";

describe("KH-01 Real Browser Readback (Part 08, FIX-05, Invariant 4)", () => {
  let server: http.Server;
  let baseUrl: string;
  const adminApiKey = "test_admin_browser_token";
  const workspaceId = "ws_browser_readback_test";
  const runId = "run_browser_001";

  let htmlBody = "";

  beforeAll(async () => {
    server = http.createServer((req, res) => {
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end(`
        <!DOCTYPE html>
        <html>
          <head><title>Explorer Test</title></head>
          <body>
            <div data-testid="exact-run-context-banner">Exact Run: ${runId}</div>
            ${htmlBody}
          </body>
        </html>
      `);
    });

    await new Promise<void>((resolve) => {
      server.listen(0, "127.0.0.1", () => {
        const addr = server.address() as AddressInfo;
        baseUrl = `http://127.0.0.1:${addr.port}`;
        resolve();
      });
    });
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  const context = {
    acceptanceRunId: `run_acc_${Date.now()}`,
    workspaceId,
    databaseUrl: "file:test.db",
    startedAt: new Date().toISOString(),
    liveDbHandle: null,
    cleanup: async () => {},
  };

  it("extracts real DOM ad IDs from Chromium observation and passes when matching", async () => {
    const chrome = resolveChromeExecutablePath();
    if (!chrome) {
      // If no local chrome found on runner, verify NOT_RUN is safely returned without fabricating PASS
      const serverHandle = { baseUrl, adminApiKey };
      const evidence = await verifyExactRunBrowserReadback(
        serverHandle,
        context as any,
        runId,
        ["ad_dom_001", "ad_dom_002"]
      );
      expect(evidence.status).toBe("NOT_RUN");
      expect(evidence.evidenceOrigin).toBe("NOT_EXECUTED");
      return;
    }

    htmlBody = `
      <div data-testid="exact-run-ad-card" data-ad-id="ad_dom_001">Card 1</div>
      <div data-testid="exact-run-ad-card" data-ad-id="ad_dom_002">Card 2</div>
    `;

    const serverHandle = { baseUrl, adminApiKey };
    const evidence = await verifyExactRunBrowserReadback(
      serverHandle,
      context as any,
      runId,
      ["ad_dom_001", "ad_dom_002"]
    );

    expect(evidence.status).toBe("PASSED");
    expect(evidence.browserLaunched).toBe(true);
    expect(evidence.pageNavigated).toBe(true);
    expect(evidence.domReadCompleted).toBe(true);
    expect(evidence.adIds).toEqual(["ad_dom_001", "ad_dom_002"]);
    expect(evidence.missingIds).toHaveLength(0);
    expect(evidence.unexpectedIds).toHaveLength(0);
    expect(evidence.evidenceOrigin).toBe("ACTUAL_BROWSER_OBSERVATION");

    if (evidence.screenshotPath) {
      expect(fs.existsSync(evidence.screenshotPath)).toBe(true);
    }
  });

  it("fails when an expected ad card is missing from the rendered DOM", async () => {
    const chrome = resolveChromeExecutablePath();
    if (!chrome) return;

    // Only 1 ad rendered in DOM, but 2 expected
    htmlBody = `
      <div data-testid="exact-run-ad-card" data-ad-id="ad_dom_001">Card 1</div>
    `;

    const serverHandle = { baseUrl, adminApiKey };
    const evidence = await verifyExactRunBrowserReadback(
      serverHandle,
      context as any,
      runId,
      ["ad_dom_001", "ad_dom_missing_002"]
    );

    expect(evidence.status).toBe("FAILED");
    expect(evidence.missingIds).toContain("ad_dom_missing_002");
    expect(evidence.adIds).toEqual(["ad_dom_001"]);
    expect(evidence.error).toContain("Browser DOM ad ID mismatch");
  });

  it("fails when an unexpected foreign ad card is rendered into the DOM", async () => {
    const chrome = resolveChromeExecutablePath();
    if (!chrome) return;

    htmlBody = `
      <div data-testid="exact-run-ad-card" data-ad-id="ad_dom_001">Card 1</div>
      <div data-testid="exact-run-ad-card" data-ad-id="ad_foreign_injected">Foreign Card</div>
    `;

    const serverHandle = { baseUrl, adminApiKey };
    const evidence = await verifyExactRunBrowserReadback(
      serverHandle,
      context as any,
      runId,
      ["ad_dom_001"]
    );

    expect(evidence.status).toBe("FAILED");
    expect(evidence.unexpectedIds).toContain("ad_foreign_injected");
    expect(evidence.error).toContain("Browser DOM ad ID mismatch");
  });

  it("fails gracefully when target server is unreachable", async () => {
    const closedServer = { baseUrl: "http://127.0.0.1:59998", adminApiKey };
    const evidence = await verifyExactRunBrowserReadback(
      closedServer,
      context as any,
      runId,
      ["ad_dom_001"]
    );

    expect(evidence.status).toBe("FAILED");
    expect(evidence.error).toBeTruthy();
  });
});
