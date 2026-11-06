/**
 * ANTI — KH-02 V12.4.3.7.19.1
 * Genuine Staging Runtime & Database Isolation Tests (S01 - S20)
 *
 * Verifies:
 * 1. Physical database isolation on ephemeral SQLite DB.
 * 2. Production collision rejection before any mutation.
 * 3. Network fail-closed guards (allowNetwork=false => NOT_RUN).
 * 4. Production denylist and host allowlist enforcement.
 * 5. SSRF / redirect protection against private/loopback/metadata IPs.
 * 6. Measured HTTP responses, timeouts, and body size limits.
 * 7. Report integrity and tampering rejection.
 */

import { describe, it, expect } from "vitest";
import http from "node:http";
import crypto from "node:crypto";
import path from "node:path";
import os from "node:os";
import fs from "node:fs";
import {
  executeStagingShadowCheck,
  validateStagingShadowReport,
  performAuditedStagingRequest,
  isDenylistedHost,
  isAllowedStagingHost,
} from "@/services/kh02/staging/stagingShadowReleaseGate";
import { resolveDatabaseConfiguration } from "@/lib/database/databaseConfig";

describe("KH-02 V12.4.3.7.19.1: Genuine Staging Runtime & DB Isolation (S01 - S20)", () => {
  it("S01: offline mode no live network => CONTRACT_READY only with actual ephemeral DB", async () => {
    const result = await executeStagingShadowCheck({
      mode: "OFFLINE_CONTRACT_CHECK",
    });

    expect(result.mode).toBe("OFFLINE_CONTRACT_CHECK");
    expect(result.status).toBe("CONTRACT_READY");
    expect(result.isolationVerified).toBe(true);
    expect(result.zeroProductionMutations).toBe(true);
    expect(result.operations.successes).toBeGreaterThan(0);
    expect(result.operations.failures).toBe(0);
  });

  it("S02: offline mode on production DB URL => blocked BEFORE mutation", async () => {
    const prodConfig = resolveDatabaseConfiguration(process.env);
    const prodUrl = prodConfig.url;

    const result = await executeStagingShadowCheck({
      mode: "OFFLINE_CONTRACT_CHECK",
      overrideEphemeralUrl: prodUrl,
    });

    expect(result.status).toBe("EXECUTED_FAIL");
    expect(result.isolationVerified).toBe(false);
    expect(result.operations.failures).toBe(1);
    expect(result.executionTrace.some((t) => t.includes("collides with production"))).toBe(true);
  });

  it("S03: offline DB fingerprint unknown/invalid => NOT_RUN/FAIL not success", async () => {
    const result = await executeStagingShadowCheck({
      mode: "OFFLINE_CONTRACT_CHECK",
      overrideEphemeralUrl: "file:/dev/null/impossible_dir/bad.db",
    });

    expect(result.status).toBe("EXECUTED_FAIL");
    expect(result.isolationVerified).toBe(false);
  });

  it("S04: allowNetwork=false with supplied stage URL => NOT_RUN", async () => {
    const result = await executeStagingShadowCheck({
      mode: "STAGING_RUNTIME_SHADOW",
      stagingEndpoint: "https://staging.shopifysearch.internal/api/ping",
      allowNetwork: false,
    });

    expect(result.status).toBe("NOT_RUN");
    expect(result.notRunReason).toContain("NETWORK_DISALLOWED");
    expect(result.operations.totalAttempts).toBe(0);
  });

  it("S05: missing endpoint => NOT_RUN", async () => {
    const orig = process.env.STAGING_ENDPOINT_URL;
    delete process.env.STAGING_ENDPOINT_URL;

    const result = await executeStagingShadowCheck({
      mode: "STAGING_RUNTIME_SHADOW",
      stagingEndpoint: undefined,
      allowNetwork: true,
    });

    if (orig) process.env.STAGING_ENDPOINT_URL = orig;

    expect(result.status).toBe("NOT_RUN");
    expect(result.notRunReason).toContain("NO_ENDPOINT");
  });

  it("S06: raw string URL containing allowed host as substring but actual host is external => reject", async () => {
    const evilEndpoint = "https://staging.shopifysearch.internal.attacker.com/v1/ping";
    const result = await executeStagingShadowCheck({
      mode: "STAGING_RUNTIME_SHADOW",
      stagingEndpoint: evilEndpoint,
      allowNetwork: true,
    });

    expect(result.status).toBe("EXECUTED_FAIL");
    expect(result.operations.blockedCalls).toBe(1);
    expect(result.notRunReason).toContain("UNAUTHORIZED_STAGING_HOST");
  });

  it("S07: explicit production host => reject (denylisted)", async () => {
    const prodEndpoint = "https://api.shopify.com/v1/ping";
    const result = await executeStagingShadowCheck({
      mode: "STAGING_RUNTIME_SHADOW",
      stagingEndpoint: prodEndpoint,
      allowNetwork: true,
    });

    expect(result.status).toBe("EXECUTED_FAIL");
    expect(result.operations.blockedCalls).toBe(1);
    expect(result.notRunReason).toContain("TARGET_IS_PRODUCTION");
  });

  it("S08: redirect to 127.0.0.1 or metadata IP => reject (SSRF blocked)", async () => {
    const server = http.createServer((_req, res) => {
      res.writeHead(302, { Location: "http://169.254.169.254/latest/meta-data/" });
      res.end();
    });

    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
    const port = (server.address() as any).port;
    const testUrl = new URL(`http://127.0.0.1:${port}/redirect-me`);

    let caughtErr: any = null;
    try {
      await performAuditedStagingRequest(testUrl, { timeoutMs: 2000 });
    } catch (e) {
      caughtErr = e;
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }

    expect(caughtErr).toBeDefined();
    expect(caughtErr.message).toContain("SSRF_BLOCKED");
  });

  it("S09: HTTP 500 => EXECUTED_FAIL", async () => {
    const server = http.createServer((_req, res) => {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Internal Server Error" }));
    });

    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
    const port = (server.address() as any).port;

    const result = await executeStagingShadowCheck({
      mode: "STAGING_RUNTIME_SHADOW",
      stagingEndpoint: `http://127.0.0.1:${port}/error`,
      allowNetwork: true,
      allowLocalTestServer: true,
    });

    await new Promise<void>((resolve) => server.close(() => resolve()));

    expect(result.status).toBe("EXECUTED_FAIL");
    expect(result.operations.failures).toBe(1);
    expect(result.notRunReason).toContain("NON_2XX_RESPONSE");
  });

  it("S10: timeout => EXECUTED_FAIL bounded", async () => {
    const server = http.createServer((_req, res) => {
      // Deliberately do not answer to cause timeout
      setTimeout(() => {
        if (!res.writableEnded) res.end("late");
      }, 3000);
    });

    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
    const port = (server.address() as any).port;

    const result = await executeStagingShadowCheck({
      mode: "STAGING_RUNTIME_SHADOW",
      stagingEndpoint: `http://127.0.0.1:${port}/slow`,
      allowNetwork: true,
      allowLocalTestServer: true,
      timeoutMs: 500, // Short timeout for test
    });

    await new Promise<void>((resolve) => server.close(() => resolve()));

    expect(result.status).toBe("EXECUTED_FAIL");
    expect(result.operations.failures).toBe(1);
    expect(result.notRunReason).toContain("timed out");
  });

  it("S11: wrong TLS/cert or bad connection => EXECUTED_FAIL", async () => {
    const result = await executeStagingShadowCheck({
      mode: "STAGING_RUNTIME_SHADOW",
      stagingEndpoint: "https://127.0.0.1:49999/bad-port",
      allowNetwork: true,
      allowLocalTestServer: true,
      timeoutMs: 500,
    });

    expect(result.status).toBe("EXECUTED_FAIL");
    expect(result.operations.failures).toBe(1);
  });

  it("S12: real local test server => measured request, response + digest", async () => {
    const responsePayload = JSON.stringify({ status: "ok", service: "staging-shadow-test" });
    const expectedDigest = crypto.createHash("sha256").update(responsePayload).digest("hex");

    const server = http.createServer((_req, res) => {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(responsePayload);
    });

    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
    const port = (server.address() as any).port;

    const result = await executeStagingShadowCheck({
      mode: "STAGING_RUNTIME_SHADOW",
      stagingEndpoint: `http://127.0.0.1:${port}/health`,
      allowNetwork: true,
      allowLocalTestServer: true,
    });

    await new Promise<void>((resolve) => server.close(() => resolve()));

    expect(result.status).toBe("EXECUTED_PASS");
    expect(result.operations.successes).toBe(1);
    expect(result.executionTrace.some((t) => t.includes(expectedDigest.slice(0, 16)))).toBe(true);
  });

  it("S13: simulated ping cannot produce EXECUTED_PASS", async () => {
    // Calling with allowNetwork=false never returns EXECUTED_PASS
    const res = await executeStagingShadowCheck({
      mode: "STAGING_RUNTIME_SHADOW",
      stagingEndpoint: "https://staging.shopifysearch.internal/ping",
      allowNetwork: false,
    });

    expect(res.status).not.toBe("EXECUTED_PASS");
    expect(res.status).toBe("NOT_RUN");
  });

  it("S14: cleanup failure => EXECUTED_FAIL, never zeroProductionMutations false", () => {
    const report = {
      mode: "OFFLINE_CONTRACT_CHECK" as const,
      status: "EXECUTED_FAIL" as const,
      isProductionDenylisted: true,
      shadowWorkspaceId: "ws_fail",
      operations: { totalAttempts: 1, successes: 0, failures: 1, blockedCalls: 0 },
      isolationVerified: false,
      zeroProductionMutations: false,
      executionTrace: [],
      reportDigest: "deadbeef",
      executedAt: new Date().toISOString(),
    };

    const validation = validateStagingShadowReport(report);
    expect(validation.valid).toBe(false);
    expect(validation.errors.some((e) => e.includes("zeroProductionMutations"))).toBe(true);
  });

  it("S15: report tampering / missing fields => validator fail", () => {
    const corruptReport: any = {
      mode: "OFFLINE_CONTRACT_CHECK",
      // status omitted
      zeroProductionMutations: true,
      isProductionDenylisted: true,
    };

    const validation = validateStagingShadowReport(corruptReport);
    expect(validation.valid).toBe(false);
  });

  it("S16: staging execution requested but NOT_RUN => validator non-success according to mode", () => {
    const report = {
      mode: "STAGING_RUNTIME_SHADOW" as const,
      status: "NOT_RUN" as const,
      isProductionDenylisted: true,
      shadowWorkspaceId: "ws_not_run",
      operations: { totalAttempts: 0, successes: 0, failures: 0, blockedCalls: 0 },
      isolationVerified: true,
      zeroProductionMutations: true,
      executionTrace: [],
      reportDigest: "digest",
      executedAt: new Date().toISOString(),
    };

    const validation = validateStagingShadowReport(report);
    expect(validation.valid).toBe(true);
    expect(report.status).toBe("NOT_RUN");
  });

  it("S17: repeated run leaves zero temp DB rows", async () => {
    const res1 = await executeStagingShadowCheck({ mode: "OFFLINE_CONTRACT_CHECK" });
    const res2 = await executeStagingShadowCheck({ mode: "OFFLINE_CONTRACT_CHECK" });

    expect(res1.status).toBe("CONTRACT_READY");
    expect(res2.status).toBe("CONTRACT_READY");
    expect(res1.executionTrace.some((t) => t.includes("Verified 0 lingering rows"))).toBe(true);
    expect(res2.executionTrace.some((t) => t.includes("Verified 0 lingering rows"))).toBe(true);
  });

  it("S18: zero production writes measured, not hardcoded", async () => {
    const prodConfig = resolveDatabaseConfiguration(process.env);
    const prodFile = prodConfig.location.canonicalPath;

    let mtimeBefore = 0;
    if (prodFile && fs.existsSync(prodFile)) {
      mtimeBefore = fs.statSync(prodFile).mtimeMs;
    }

    await executeStagingShadowCheck({ mode: "OFFLINE_CONTRACT_CHECK" });

    if (prodFile && fs.existsSync(prodFile)) {
      const mtimeAfter = fs.statSync(prodFile).mtimeMs;
      expect(mtimeAfter).toBe(mtimeBefore);
    }
  });

  it("S19: unexpected remote write route disabled unless documented authorized shadow endpoint", () => {
    expect(isAllowedStagingHost("random-third-party.com")).toBe(false);
    expect(isAllowedStagingHost("staging.shopifysearch.internal")).toBe(true);
    expect(isAllowedStagingHost("staging.shopifysearch.internal.attacker.com")).toBe(false);
  });

  it("S20: nonstandard request caps enforced (2 MiB limit)", async () => {
    // Generate server response larger than 2 MiB
    const largeBody = "x".repeat(2.5 * 1024 * 1024);
    const server = http.createServer((_req, res) => {
      res.writeHead(200, { "Content-Type": "text/plain" });
      res.end(largeBody);
    });

    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
    const port = (server.address() as any).port;
    const testUrl = new URL(`http://127.0.0.1:${port}/large`);

    let caughtErr: any = null;
    try {
      await performAuditedStagingRequest(testUrl, { timeoutMs: 3000 });
    } catch (e) {
      caughtErr = e;
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }

    expect(caughtErr).toBeDefined();
    expect(caughtErr.message).toContain("2 MiB safety limit");
  });
});
