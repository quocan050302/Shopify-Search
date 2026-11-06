/**
 * SWAI KH-02 — V12.4.3.7.19.1
 * Staging Shadow Release Gate Service (Workstream C)
 *
 * Implements bounded, genuinely isolated staging shadow validation:
 * - Mode 1: OFFLINE_CONTRACT_CHECK (ephemeral isolated SQLite database, no external network)
 * - Mode 2: STAGING_RUNTIME_SHADOW (real audited HTTPS transport with production denylist)
 *
 * Guarantees:
 * - Zero production mutations technically enforced via physical database isolation
 * - allowNetwork=false strictly returns NOT_RUN or CONTRACT_READY, NEVER EXECUTED_PASS
 * - Simulated string pings cannot produce EXECUTED_PASS
 */

import crypto from "node:crypto";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import http from "node:http";
import https from "node:https";
import { createClient } from "@libsql/client";
import {
  canonicalizeSqliteDatabasePath,
  resolveDatabaseConfiguration,
  assertSafeTestDatabase,
} from "@/lib/db";
import { sanitizeReleaseLog } from "../release/releaseGateEvaluatorV19";

export interface StagingShadowOptions {
  mode: "OFFLINE_CONTRACT_CHECK" | "STAGING_RUNTIME_SHADOW";
  stagingEndpoint?: string;
  allowNetwork?: boolean;
  timeoutMs?: number;
  workspaceIdPrefix?: string;
  overrideEphemeralUrl?: string;
  allowLocalTestServer?: boolean;
}

export interface StagingShadowResult {
  mode: "OFFLINE_CONTRACT_CHECK" | "STAGING_RUNTIME_SHADOW";
  status: "CONTRACT_READY" | "EXECUTED_PASS" | "EXECUTED_FAIL" | "NOT_RUN";
  targetEndpointFingerprint?: string;
  isProductionDenylisted: boolean;
  shadowWorkspaceId: string;
  operations: {
    totalAttempts: number;
    successes: number;
    failures: number;
    blockedCalls: number;
  };
  isolationVerified: boolean;
  zeroProductionMutations: boolean;
  notRunReason?: string;
  executionTrace: string[];
  reportDigest: string;
  executedAt: string;
}

export const PRODUCTION_HOSTS = [
  "api.shopify.com",
  "shopifysearch.com",
  "production.shopifysearch.internal",
  "serpapi.com",
  "google.com",
  "169.254.169.254",
  "metadata.google.internal",
];

export const PRODUCTION_HOST_PATTERNS = [
  /api\.shopify\.com/i,
  /shopifysearch\.com/i,
  /production/i,
  /live-api/i,
  /169\.254\./,
  /metadata/i,
];

export const ALLOWED_STAGING_HOSTS = [
  "staging.shopifysearch.internal",
  "staging-api.shopifysearch.internal",
  "staging.swai.local",
];

export function isDenylistedHost(hostname: string): boolean {
  const h = hostname.toLowerCase();
  return (
    PRODUCTION_HOSTS.some((p) => h === p || h.endsWith(`.${p}`)) ||
    PRODUCTION_HOST_PATTERNS.some((pat) => pat.test(h))
  );
}

export function isAllowedStagingHost(hostname: string): boolean {
  const h = hostname.toLowerCase();
  return ALLOWED_STAGING_HOSTS.some((a) => h === a || h.endsWith(`.${a}`));
}

/**
 * Performs a real, bounded HTTPS/HTTP request against a vetted non-production staging endpoint.
 */
export function performAuditedStagingRequest(
  targetUrl: URL,
  options: { timeoutMs?: number } = {}
): Promise<{ statusCode: number; bodyDigest: string; durationMs: number }> {
  return new Promise((resolve, reject) => {
    const isHttps = targetUrl.protocol === "https:";
    const transport = isHttps ? https : http;
    const timeout = Math.min(options.timeoutMs || 10000, 10000); // Capped at 10s
    const startTime = Date.now();

    const req = transport.request(
      targetUrl,
      {
        method: "GET",
        timeout,
        headers: {
          "User-Agent": "SWAI-StagingShadow-Validator/12.4.3.7.19.1",
          Accept: "application/json, text/plain, */*",
        },
      },
      (res) => {
        const statusCode = res.statusCode || 0;

        // SSRF protection against redirects to private/denylisted addresses
        if (statusCode >= 301 && statusCode <= 308 && res.headers.location) {
          try {
            const redirectUrl = new URL(res.headers.location, targetUrl);
            const redHost = redirectUrl.hostname.toLowerCase();
            if (
              isDenylistedHost(redHost) ||
              redHost === "127.0.0.1" ||
              redHost === "localhost" ||
              redHost === "169.254.169.254"
            ) {
              req.destroy(new Error(`SSRF_BLOCKED: Redirect to forbidden host '${redHost}'.`));
              return;
            }
          } catch {
            req.destroy(new Error("Invalid redirect location URL."));
            return;
          }
        }

        let bodyBytes = 0;
        const maxBytes = 2 * 1024 * 1024; // 2 MiB cap
        const hash = crypto.createHash("sha256");

        res.on("data", (chunk: Buffer) => {
          bodyBytes += chunk.length;
          if (bodyBytes > maxBytes) {
            req.destroy(new Error("Staging response body exceeded 2 MiB safety limit."));
            return;
          }
          hash.update(chunk);
        });

        res.on("end", () => {
          const durationMs = Date.now() - startTime;
          const bodyDigest = hash.digest("hex");
          resolve({ statusCode, bodyDigest, durationMs });
        });
      }
    );

    req.on("timeout", () => {
      req.destroy(new Error(`Staging request timed out after ${timeout}ms.`));
    });

    req.on("error", (err) => {
      reject(err);
    });

    req.end();
  });
}

export function validateStagingShadowReport(report: StagingShadowResult): {
  valid: boolean;
  errors: string[];
} {
  const errors: string[] = [];
  if (!report.mode || !report.status) {
    errors.push("Missing mandatory fields mode or status.");
  }
  if (report.zeroProductionMutations !== true) {
    errors.push("zeroProductionMutations must be true.");
  }
  if (report.isProductionDenylisted !== true) {
    errors.push("isProductionDenylisted must be true.");
  }
  if (report.mode === "STAGING_RUNTIME_SHADOW" && report.status === "EXECUTED_PASS" && !report.targetEndpointFingerprint) {
    errors.push("EXECUTED_PASS requires targetEndpointFingerprint.");
  }
  return { valid: errors.length === 0, errors };
}

export async function executeStagingShadowCheck(
  options: StagingShadowOptions
): Promise<StagingShadowResult> {
  const executedAt = new Date().toISOString();
  const runId = `shadow_${Date.now()}_${crypto.randomBytes(4).toString("hex")}`;
  const shadowWorkspaceId = `${options.workspaceIdPrefix || "shadow_ws"}_${runId}`;
  const trace: string[] = [];

  let totalAttempts = 0;
  let successes = 0;
  let failures = 0;
  let blockedCalls = 0;

  // MODE 1: OFFLINE_CONTRACT_CHECK
  if (options.mode === "OFFLINE_CONTRACT_CHECK") {
    trace.push("Executing OFFLINE_CONTRACT_CHECK on physically isolated ephemeral SQLite DB.");
    totalAttempts++;

    const ephemeralDir = path.join(os.tmpdir(), "swai-staging-shadow-isolated");
    fs.mkdirSync(ephemeralDir, { recursive: true });
    const ephemeralDbPath = path.join(ephemeralDir, `shadow_${runId}.db`);
    const ephemeralUrl = options.overrideEphemeralUrl || `file:${ephemeralDbPath.replace(/\\/g, "/")}`;

    try {
      // Prove that ephemeral DB is physically distinct from application production/dev DB
      const activeConfig = resolveDatabaseConfiguration(process.env);
      const prodCanonicalPath = activeConfig.location.canonicalPath || "";
      const ephemeralCanonicalPath = canonicalizeSqliteDatabasePath(ephemeralUrl).canonicalPath || "";

      if (prodCanonicalPath && ephemeralCanonicalPath && prodCanonicalPath.toLowerCase() === ephemeralCanonicalPath.toLowerCase()) {
        failures++;
        trace.push("FATAL: Ephemeral database path collides with production/application database.");
        return {
          mode: "OFFLINE_CONTRACT_CHECK",
          status: "EXECUTED_FAIL",
          isProductionDenylisted: true,
          shadowWorkspaceId,
          operations: { totalAttempts: 1, successes: 0, failures: 1, blockedCalls: 0 },
          isolationVerified: false,
          zeroProductionMutations: false,
          notRunReason: "DB_COLLISION: Ephemeral path matched active DB path.",
          executionTrace: trace,
          reportDigest: crypto.createHash("sha256").update("db_collision").digest("hex"),
          executedAt,
        };
      }

      assertSafeTestDatabase(ephemeralUrl, process.env);
      trace.push(`Verified physical DB isolation from production. Ephemeral DB: ${ephemeralDbPath}`);

      const client = createClient({ url: ephemeralUrl });
      try {
        await client.execute(`
          CREATE TABLE IF NOT EXISTS "workspaces" (
            "id" TEXT NOT NULL PRIMARY KEY,
            "name" TEXT NOT NULL,
            "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
          );
        `);

        await client.execute({
          sql: `INSERT INTO "workspaces" ("id", "name") VALUES (?, ?);`,
          args: [shadowWorkspaceId, `Shadow WS ${runId}`],
        });
        successes++;
        trace.push(`Created temporary shadow workspace in ephemeral DB: '${shadowWorkspaceId}'.`);

        // Readback check
        const readRes = await client.execute({
          sql: `SELECT id FROM "workspaces" WHERE id = ?;`,
          args: [shadowWorkspaceId],
        });
        if (readRes.rows.length !== 1) {
          throw new Error("Readback verification on ephemeral DB failed.");
        }

        // Cleanup
        await client.execute({
          sql: `DELETE FROM "workspaces" WHERE id = ?;`,
          args: [shadowWorkspaceId],
        });
        trace.push(`Cleaned up shadow workspace in ephemeral DB: '${shadowWorkspaceId}'.`);

        const countRes = await client.execute(`SELECT count(*) as cnt FROM "workspaces";`);
        const remainingCount = Number(countRes.rows[0]?.cnt || 0);
        if (remainingCount !== 0) {
          throw new Error(`Ephemeral DB has ${remainingCount} lingering rows after cleanup.`);
        }
        trace.push("Verified 0 lingering rows in ephemeral database after cleanup.");
      } finally {
        client.close();
        try {
          if (fs.existsSync(ephemeralDbPath)) {
            fs.unlinkSync(ephemeralDbPath);
          }
        } catch {}
      }
    } catch (dbErr: any) {
      failures++;
      trace.push(`Isolated DB check error: ${dbErr?.message || dbErr}`);
    }

    const reportContent = JSON.stringify({ mode: "OFFLINE_CONTRACT_CHECK", executedAt, successes, failures });
    const reportDigest = crypto.createHash("sha256").update(reportContent).digest("hex");

    return {
      mode: "OFFLINE_CONTRACT_CHECK",
      status: failures === 0 ? "CONTRACT_READY" : "EXECUTED_FAIL",
      isProductionDenylisted: true,
      shadowWorkspaceId,
      operations: {
        totalAttempts,
        successes,
        failures,
        blockedCalls,
      },
      isolationVerified: failures === 0,
      zeroProductionMutations: true,
      executionTrace: trace,
      reportDigest,
      executedAt,
    };
  }

  // MODE 2: STAGING_RUNTIME_SHADOW
  const endpoint = options.stagingEndpoint || process.env.STAGING_ENDPOINT_URL;
  if (!endpoint || endpoint.trim().length === 0 || options.allowNetwork !== true) {
    const reason = options.allowNetwork !== true
      ? "NETWORK_DISALLOWED: allowNetwork option is false; staging runtime network execution strictly skipped."
      : "NO_ENDPOINT: No staging endpoint configured in environment or CLI options.";
    trace.push(reason);
    return {
      mode: "STAGING_RUNTIME_SHADOW",
      status: "NOT_RUN",
      isProductionDenylisted: true,
      shadowWorkspaceId,
      operations: { totalAttempts: 0, successes: 0, failures: 0, blockedCalls: 0 },
      isolationVerified: true,
      zeroProductionMutations: true,
      notRunReason: `STAGING_RUNTIME_NOT_RUN: ${reason}`,
      executionTrace: trace,
      reportDigest: crypto.createHash("sha256").update(executedAt + reason).digest("hex"),
      executedAt,
    };
  }

  // Check production denylist
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(endpoint);
  } catch (urlErr: any) {
    trace.push(`BLOCKED: Invalid endpoint URL '${endpoint}'.`);
    return {
      mode: "STAGING_RUNTIME_SHADOW",
      status: "EXECUTED_FAIL",
      isProductionDenylisted: true,
      shadowWorkspaceId,
      operations: { totalAttempts: 1, successes: 0, failures: 1, blockedCalls: 1 },
      isolationVerified: false,
      zeroProductionMutations: true,
      notRunReason: "INVALID_URL: Staging endpoint URL is malformed.",
      executionTrace: trace,
      reportDigest: crypto.createHash("sha256").update("invalid_url").digest("hex"),
      executedAt,
    };
  }

  const hostname = parsedUrl.hostname.toLowerCase();
  const isDenylisted = isDenylistedHost(hostname);

  if (isDenylisted) {
    trace.push(`BLOCKED: Endpoint '${endpoint}' matches production denylist host '${hostname}'.`);
    blockedCalls++;
    return {
      mode: "STAGING_RUNTIME_SHADOW",
      status: "EXECUTED_FAIL",
      targetEndpointFingerprint: crypto.createHash("sha256").update(endpoint).digest("hex").slice(0, 16),
      isProductionDenylisted: false,
      shadowWorkspaceId,
      operations: { totalAttempts: 1, successes: 0, failures: 1, blockedCalls: 1 },
      isolationVerified: false,
      zeroProductionMutations: true,
      notRunReason: "TARGET_IS_PRODUCTION: Aborted execution because endpoint matches production denylist.",
      executionTrace: trace,
      reportDigest: crypto.createHash("sha256").update("production_denied").digest("hex"),
      executedAt,
    };
  }

  // Reject unauthorized external hosts (prevents attacker subdomain substring tricks)
  if (!options.allowLocalTestServer && !isAllowedStagingHost(hostname)) {
    trace.push(`BLOCKED: Endpoint host '${hostname}' is not an authorized staging host.`);
    blockedCalls++;
    return {
      mode: "STAGING_RUNTIME_SHADOW",
      status: "EXECUTED_FAIL",
      targetEndpointFingerprint: crypto.createHash("sha256").update(endpoint).digest("hex").slice(0, 16),
      isProductionDenylisted: true,
      shadowWorkspaceId,
      operations: { totalAttempts: 1, successes: 0, failures: 1, blockedCalls: 1 },
      isolationVerified: false,
      zeroProductionMutations: true,
      notRunReason: `UNAUTHORIZED_STAGING_HOST: Host '${hostname}' is not authorized.`,
      executionTrace: trace,
      reportDigest: crypto.createHash("sha256").update("unauthorized_host").digest("hex"),
      executedAt,
    };
  }

  // Execute real audited HTTPS request (never a simulated string ping)
  totalAttempts++;
  try {
    const httpRes = await performAuditedStagingRequest(parsedUrl, {
      timeoutMs: options.timeoutMs || 10000,
    });
    if (httpRes.statusCode >= 200 && httpRes.statusCode < 300) {
      successes++;
      trace.push(`Real staging HTTP ${httpRes.statusCode} received from ${hostname}. Measured response digest: ${httpRes.bodyDigest.slice(0, 16)}`);
      return {
        mode: "STAGING_RUNTIME_SHADOW",
        status: "EXECUTED_PASS",
        targetEndpointFingerprint: crypto.createHash("sha256").update(endpoint).digest("hex").slice(0, 16),
        isProductionDenylisted: true,
        shadowWorkspaceId,
        operations: { totalAttempts, successes, failures, blockedCalls },
        isolationVerified: true,
        zeroProductionMutations: true,
        executionTrace: trace,
        reportDigest: crypto.createHash("sha256").update(JSON.stringify({ executedAt, successes, httpRes })).digest("hex"),
        executedAt,
      };
    } else {
      failures++;
      trace.push(`Staging HTTP request returned non-2xx status ${httpRes.statusCode}`);
      return {
        mode: "STAGING_RUNTIME_SHADOW",
        status: "EXECUTED_FAIL",
        targetEndpointFingerprint: crypto.createHash("sha256").update(endpoint).digest("hex").slice(0, 16),
        isProductionDenylisted: true,
        shadowWorkspaceId,
        operations: { totalAttempts, successes, failures, blockedCalls },
        isolationVerified: true,
        zeroProductionMutations: true,
        notRunReason: `NON_2XX_RESPONSE: Staging endpoint responded with HTTP ${httpRes.statusCode}`,
        executionTrace: trace,
        reportDigest: crypto.createHash("sha256").update(executedAt + "non_2xx").digest("hex"),
        executedAt,
      };
    }
  } catch (reqErr: any) {
    failures++;
    trace.push(`Staging HTTP request failed: ${reqErr.message || reqErr}`);
    return {
      mode: "STAGING_RUNTIME_SHADOW",
      status: "EXECUTED_FAIL",
      targetEndpointFingerprint: crypto.createHash("sha256").update(endpoint).digest("hex").slice(0, 16),
      isProductionDenylisted: true,
      shadowWorkspaceId,
      operations: { totalAttempts, successes, failures, blockedCalls },
      isolationVerified: true,
      zeroProductionMutations: true,
      notRunReason: `REQUEST_FAILED: ${reqErr.message || reqErr}`,
      executionTrace: trace,
      reportDigest: crypto.createHash("sha256").update(executedAt + "fail").digest("hex"),
      executedAt,
    };
  }
}
