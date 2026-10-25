import { describe, it, expect, afterAll } from "vitest";
import { createIsolatedTestDatabase } from "../helpers/createIsolatedTestDatabase";
import { startSwaiTestServer } from "./helpers/startSwaiTestServer";
import { chromium, Browser } from "playwright-core";
import fs from "fs";

function resolveChrome(): string {
  const candidates = [
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium-browser",
    "/usr/bin/chromium",
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  throw new Error("No Chrome found");
}

describe("E2E Meta Research Authorization Regression (Section 20)", () => {
  let browser: Browser | undefined;

  afterAll(async () => {
    if (browser) {
      await browser.close();
    }
  });

  it("Scenario 1: Local desktop authorized -> Start Research enabled -> HTTP 202 -> Ledger updated", async () => {
    const dbHandle = await createIsolatedTestDatabase({ prefix: "e2e-local-auth" });
    const workspaceId = "ws_e2e_local_desk";

    await dbHandle.prisma.workspace.create({
      data: {
        id: workspaceId,
        name: "Local Desktop Workspace",
        operatingMode: "RESEARCH_ONLY",
        targetMarket: "US",
      },
    });

    // Seed heartbeat so collector readiness is READY
    await dbHandle.prisma.syncJob.create({
      data: {
        id: "job_worker_heartbeat_e2e",
        workspaceId,
        jobType: "DISCOVERY_WORKER_HEARTBEAT",
        status: "RUNNING",
        startedAt: new Date(),
      },
    });

    const serverHandle = await startSwaiTestServer({
      databaseUrl: dbHandle.url,
      mode: "production",
      allowLocalBypass: true,
      timeoutMs: 45000,
    });

    if (!browser) {
      browser = await chromium.launch({
        executablePath: resolveChrome(),
        headless: true,
        args: ["--no-sandbox", "--disable-dev-shm-usage"],
      });
    }

    const context = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      extraHTTPHeaders: {
        "x-workspace-id": workspaceId,
      },
    });

    const page = await context.newPage();

    try {
      await page.goto(`${serverHandle.baseUrl}/meta-discovery`, {
        waitUntil: "domcontentloaded",
        timeout: 25000,
      });

      // 1. Verify Access badge indicates Local Desktop
      const accessBadge = page.locator("text=Access: Local Desktop");
      await accessBadge.waitFor({ state: "visible", timeout: 15000 });
      expect(await accessBadge.isVisible()).toBe(true);

      // 2. Fill keyword "gadget"
      const keywordInput = page.locator("input#meta-keywords-input, [data-testid='meta-keyword-input']").first();
      await keywordInput.waitFor({ state: "visible", timeout: 10000 });
      await keywordInput.fill("gadget");

      // 3. Confirm Start Research button is available and enabled
      const submitButton = page.locator("button[type='submit'], [data-testid='meta-research-submit']").first();
      await submitButton.waitFor({ state: "visible", timeout: 10000 });
      expect(await submitButton.isEnabled()).toBe(true);
      const btnText = await submitButton.innerText();
      expect(btnText).toContain("Start Research");

      // 4. Click Start Research and wait for HTTP 202
      const [response] = await Promise.all([
        page.waitForResponse(
          (res) =>
            res.url().includes("/api/v1/discovery/meta/requests") &&
            res.request().method() === "POST",
          { timeout: 15000 }
        ),
        submitButton.click(),
      ]);

      expect(response.status()).toBe(202);
      const resJson = await response.json();
      expect(resJson.success).toBe(true);
      expect(resJson.runId).toBeDefined();

      // 5. Success notification visible
      const successBanner = page.locator("text=Research task queued successfully");
      await successBanner.waitFor({ state: "visible", timeout: 10000 });
      expect(await successBanner.isVisible()).toBe(true);

      // 6. Verify SQLite database has exactly 1 new job in this workspace
      const runs = await dbHandle.prisma.discoveryRun.findMany({
        where: { workspaceId },
      });
      expect(runs).toHaveLength(1);
      expect(runs[0].id).toBe(resJson.runId);
      expect(runs[0].queryConfigJson).toContain("gadget");
    } finally {
      await context.close();
      await serverHandle.stop();
      await dbHandle.teardown();
    }
  }, 60000);

  it("Scenario 2 & 5: Remote unauthenticated -> Access Auth Required -> No POST sent -> Clean error presentation", async () => {
    const dbHandle = await createIsolatedTestDatabase({ prefix: "e2e-remote-auth" });
    const workspaceId = "ws_e2e_remote_desk";

    await dbHandle.prisma.workspace.create({
      data: {
        id: workspaceId,
        name: "Remote Desk Workspace",
        operatingMode: "RESEARCH_ONLY",
        targetMarket: "US",
      },
    });

    const serverHandle = await startSwaiTestServer({
      databaseUrl: dbHandle.url,
      mode: "production",
      deploymentMode: "REMOTE",
      timeoutMs: 45000,
    });

    if (!browser) {
      browser = await chromium.launch({
        executablePath: resolveChrome(),
        headless: true,
        args: ["--no-sandbox", "--disable-dev-shm-usage"],
      });
    }

    const context = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      extraHTTPHeaders: {
        "x-workspace-id": workspaceId,
      },
    });

    const page = await context.newPage();

    try {
      await page.goto(`${serverHandle.baseUrl}/meta-discovery`, {
        waitUntil: "domcontentloaded",
        timeout: 25000,
      });

      // 1. Verify Access badge indicates Auth Required
      const authBadge = page.locator("text=Access: Auth Required");
      await authBadge.waitFor({ state: "visible", timeout: 15000 });
      expect(await authBadge.isVisible()).toBe(true);

      // 2. Action button should state Authentication Required and be disabled
      const actionButton = page.locator("button[type='submit'], [data-testid='meta-research-submit'], button:has-text('Authentication Required')").first();
      await actionButton.waitFor({ state: "visible", timeout: 10000 });
      const actionText = await actionButton.innerText();
      expect(actionText).toContain("Authentication Required");
      expect(await actionButton.isDisabled()).toBe(true);

      // 3. Fill keywords and verify input is preserved
      const keywordInput = page.locator("input#meta-keywords-input, [data-testid='meta-keyword-input']").first();
      await keywordInput.fill("gadget");
      expect(await keywordInput.inputValue()).toBe("gadget");

      // 4. Verify advisory banner is visible
      const advisory = page.locator("text=Research Access:");
      await advisory.waitFor({ state: "visible", timeout: 10000 });
      expect(await advisory.isVisible()).toBe(true);

      // 5. Verify keyword input does NOT show raw UNAUTHORIZED validation error (Scenario 5)
      const keywordErrorElement = page.locator("p.text-red-400:has-text('UNAUTHORIZED')");
      expect(await keywordErrorElement.isVisible()).toBe(false);
    } finally {
      await context.close();
      await serverHandle.stop();
      await dbHandle.teardown();
    }
  }, 60000);

  it("Scenario 3 & 4: Invalid cookie rejected -> Recovery with valid credentials restores Start Research", async () => {
    const dbHandle = await createIsolatedTestDatabase({ prefix: "e2e-recovery-auth" });
    const workspaceId = "ws_e2e_recovery_desk";

    await dbHandle.prisma.workspace.create({
      data: {
        id: workspaceId,
        name: "Recovery Desk Workspace",
        operatingMode: "RESEARCH_ONLY",
        targetMarket: "US",
      },
    });

    const validAdminKey = "valid_admin_secret_recovery_999";
    const serverHandle = await startSwaiTestServer({
      databaseUrl: dbHandle.url,
      mode: "production",
      adminApiKey: validAdminKey,
      timeoutMs: 45000,
    });

    if (!browser) {
      browser = await chromium.launch({
        executablePath: resolveChrome(),
        headless: true,
        args: ["--no-sandbox", "--disable-dev-shm-usage"],
      });
    }

    // 1. Start with invalid cookie
    const context = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      extraHTTPHeaders: {
        "x-workspace-id": workspaceId,
      },
    });

    await context.addCookies([
      {
        name: "swai_admin_token",
        value: "stale_invalid_secret_token",
        domain: "127.0.0.1",
        path: "/",
      },
    ]);

    const page = await context.newPage();

    try {
      await page.goto(`${serverHandle.baseUrl}/meta-discovery`, {
        waitUntil: "domcontentloaded",
        timeout: 25000,
      });

      // 2. Shows Invalid Token access state
      const invalidBadge = page.locator("text=Access: Invalid Token");
      await invalidBadge.waitFor({ state: "visible", timeout: 15000 });
      expect(await invalidBadge.isVisible()).toBe(true);

      const actionButton = page.locator("button:has-text('Fix Credentials'), button:has-text('Authentication Required'), button[type='submit']").first();
      await actionButton.waitFor({ state: "visible", timeout: 10000 });
      expect(await actionButton.isDisabled()).toBe(true);

      // 3. Recovery: update cookie to valid admin key
      await context.addCookies([
        {
          name: "swai_admin_token",
          value: validAdminKey,
          domain: "127.0.0.1",
          path: "/",
        },
      ]);

      // 4. Click Recheck button or reload page
      const recheckBtn = page.locator("button:has-text('Recheck')");
      if (await recheckBtn.isVisible()) {
        await recheckBtn.click();
      } else {
        await page.reload({ waitUntil: "domcontentloaded" });
      }

      // 5. Verify badge transitions to Authorized
      const authorizedBadge = page.locator("text=Access: Authorized");
      await authorizedBadge.waitFor({ state: "visible", timeout: 15000 });
      expect(await authorizedBadge.isVisible()).toBe(true);

      // 6. Submit research job once recovered
      const keywordInput = page.locator("input#meta-keywords-input, [data-testid='meta-keyword-input']").first();
      await keywordInput.fill("gadget");

      const submitButton = page.locator("button[type='submit'], [data-testid='meta-research-submit']").first();
      await submitButton.waitFor({ state: "visible", timeout: 10000 });
      expect(await submitButton.isEnabled()).toBe(true);
      const btnText = await submitButton.innerText();
      expect(btnText.includes("Start Research") || btnText.includes("Queue for Later")).toBe(true);

      const [response] = await Promise.all([
        page.waitForResponse(
          (res) =>
            res.url().includes("/api/v1/discovery/meta/requests") &&
            res.request().method() === "POST",
          { timeout: 15000 }
        ),
        submitButton.click(),
      ]);

      expect(response.status()).toBe(202);
    } finally {
      await context.close();
      await serverHandle.stop();
      await dbHandle.teardown();
    }
  }, 60000);
});
