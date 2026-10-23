/**
 * Integration Test: Restricted Local Muse Reverse Proxy Gateway (Port 8787)
 *
 * Verifies all security requirements:
 * 1. Allowed agent endpoints forward to upstream and return 200.
 * 2. Missing token rejected with 401.
 * 3. Invalid token rejected with 403.
 * 4. Administrator credentials rejected with 403.
 * 5. Forbidden routes (/, /settings, /api/v1/settings, user routes, dev routes) return 404.
 * 6. Forbidden HTTP methods return 404.
 * 7. Excessive request body returns 413.
 * 8. Rate limiter returns 429 when threshold exceeded.
 * 9. Separation: simulated heartbeats leave bridge in AGENT_NOT_CONNECTED;
 *    live external heartbeat sets AGENT_VERIFIED.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import http from "node:http";
import { createMuseGatewayServer } from "@/server/museGateway";
import {
  getMuseBridgeStatus,
  recordMuseAgentHeartbeat,
} from "@/services/discovery/muse/museBridgeService";
import { prisma } from "@/lib/db";

const TEST_INGESTION_TOKEN = "test_muse_secret_token_1234567890";
const TEST_ADMIN_KEY = "test_admin_key_987654321";

describe("Restricted Local Muse Gateway (127.0.0.1:8787)", () => {
  let upstreamServer: http.Server;
  let upstreamPort: number;
  let gatewayServer: http.Server;
  let gatewayPort: number;

  beforeAll(async () => {
    process.env.MUSE_INGESTION_TOKEN = TEST_INGESTION_TOKEN;
    process.env.ADMIN_API_KEY = TEST_ADMIN_KEY;

    // 1. Create mock upstream server (simulating Next.js on 127.0.0.1:3000)
    upstreamServer = http.createServer((req, res) => {
      const url = req.url || "/";
      if (url.startsWith("/api/v1/discovery/muse/agent/")) {
        const body = JSON.stringify({
          success: true,
          gatewaySource: req.headers["x-muse-gateway-source"],
          verified: req.headers["x-muse-gateway-verified"],
          path: url,
        });
        res.writeHead(200, { "content-type": "application/json" });
        res.end(body);
      } else {
        res.writeHead(404, { "content-type": "application/json" });
        res.end(JSON.stringify({ success: false, error: "Not Found on Upstream" }));
      }
    });

    await new Promise<void>((resolve) => {
      upstreamServer.listen(0, "127.0.0.1", () => {
        const addr = upstreamServer.address() as { port: number };
        upstreamPort = addr.port;
        resolve();
      });
    });

    // 2. Create restricted reverse proxy pointing to mock upstream
    gatewayServer = createMuseGatewayServer({
      targetHost: `http://127.0.0.1:${upstreamPort}`,
      maxBodySizeBytes: 1024 * 1024, // 1MB for test
      rateLimitMax: 10, // 10 req/min for test
      silent: true,
    });

    await new Promise<void>((resolve) => {
      gatewayServer.listen(0, "127.0.0.1", () => {
        const addr = gatewayServer.address() as { port: number };
        gatewayPort = addr.port;
        resolve();
      });
    });
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => gatewayServer.close(() => resolve()));
    await new Promise<void>((resolve) => upstreamServer.close(() => resolve()));
  });

  // Test 1: Allowed agent endpoint forwards with valid token
  it("allows permitted agent endpoint with valid MUSE_INGESTION_TOKEN", async () => {
    const res = await fetch(`http://127.0.0.1:${gatewayPort}/api/v1/discovery/muse/agent/requests`, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${TEST_INGESTION_TOKEN}`,
      },
    });

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.gatewaySource).toBe("muse-reverse-proxy-8787");
    expect(json.verified).toBe("true");
  });

  // Test 2: Missing token returns 401
  it("rejects request without authorization token with 401", async () => {
    const res = await fetch(`http://127.0.0.1:${gatewayPort}/api/v1/discovery/muse/agent/requests`, {
      method: "GET",
    });

    expect(res.status).toBe(401);
    const json = await res.json();
    expect(json.success).toBe(false);
    expect(json.error.code).toBe("MUSE_AUTH_REQUIRED");
  });

  // Test 3: Invalid token returns 403
  it("rejects invalid token with 403", async () => {
    const res = await fetch(`http://127.0.0.1:${gatewayPort}/api/v1/discovery/muse/agent/requests`, {
      method: "GET",
      headers: {
        Authorization: "Bearer invalid_secret_token_123",
      },
    });

    expect(res.status).toBe(403);
    const json = await res.json();
    expect(json.success).toBe(false);
    expect(json.error.code).toBe("INVALID_MUSE_CREDENTIALS");
  });

  // Test 4: Administrator credentials rejected with 403 on agent gateway
  it("rejects ADMIN_API_KEY with 403 FORBIDDEN_ADMIN_CREDENTIAL_ON_AGENT_GATEWAY", async () => {
    const res = await fetch(`http://127.0.0.1:${gatewayPort}/api/v1/discovery/muse/agent/requests`, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${TEST_ADMIN_KEY}`,
      },
    });

    expect(res.status).toBe(403);
    const json = await res.json();
    expect(json.success).toBe(false);
    expect(json.error.code).toBe("FORBIDDEN_ADMIN_CREDENTIAL_ON_AGENT_GATEWAY");
  });

  // Test 5: Forbidden routes return 404 (Whitelisting check)
  it("returns 404 for forbidden routes outside whitelist", async () => {
    const forbiddenPaths = [
      "/",
      "/settings",
      "/api/v1/settings",
      "/api/v1/ads",
      "/api/v1/discovery/muse/requests", // User route, NOT agent route!
      "/api/v1/discovery/muse/bridge",
      "/_next/static/chunks/main.js",
      "/api/v1/discovery/jobs",
    ];

    for (const path of forbiddenPaths) {
      const res = await fetch(`http://127.0.0.1:${gatewayPort}${path}`, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${TEST_INGESTION_TOKEN}`,
        },
      });

      expect(res.status).toBe(404);
      const json = await res.json();
      expect(json.success).toBe(false);
      expect(json.error.code).toBe("NOT_FOUND");
    }
  });

  // Test 6: Forbidden HTTP methods on agent routes return 404
  it("returns 404 for non-whitelisted HTTP methods on agent routes", async () => {
    // POST /requests is not permitted (requests can only be created by users on port 3000)
    const postReqRes = await fetch(`http://127.0.0.1:${gatewayPort}/api/v1/discovery/muse/agent/requests`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${TEST_INGESTION_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ keywords: ["shoes"] }),
    });
    expect(postReqRes.status).toBe(404);

    // DELETE on request detail is not permitted
    const delRes = await fetch(`http://127.0.0.1:${gatewayPort}/api/v1/discovery/muse/agent/requests/req_123`, {
      method: "DELETE",
      headers: {
        Authorization: `Bearer ${TEST_INGESTION_TOKEN}`,
      },
    });
    expect(delRes.status).toBe(404);
  });

  // Test 7: Bounded payload size returns 413
  it("returns 413 when payload exceeds maximum size limit", async () => {
    // 1.5MB body exceeds 1MB limit
    const largeBody = JSON.stringify({
      records: new Array(15000).fill({
        headline: "A".repeat(100),
      }),
    });

    const res = await fetch(
      `http://127.0.0.1:${gatewayPort}/api/v1/discovery/muse/agent/requests/req_test/results`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${TEST_INGESTION_TOKEN}`,
          "Content-Type": "application/json",
        },
        body: largeBody,
      }
    );

    expect(res.status).toBe(413);
    const json = await res.json();
    expect(json.success).toBe(false);
    expect(json.error.code).toBe("PAYLOAD_TOO_LARGE");
  });

  // Test 8: Rate limiter returns 429 when threshold exceeded
  it("returns 429 when rate limit is exceeded", async () => {
    // Configure ephemeral gateway with rate limit of 3
    const strictGateway = createMuseGatewayServer({
      targetHost: `http://127.0.0.1:${upstreamPort}`,
      rateLimitMax: 3,
      silent: true,
    });

    const port = await new Promise<number>((resolve) => {
      strictGateway.listen(0, "127.0.0.1", () => {
        resolve((strictGateway.address() as { port: number }).port);
      });
    });

    try {
      const makeReq = () =>
        fetch(`http://127.0.0.1:${port}/api/v1/discovery/muse/agent/requests`, {
          method: "GET",
          headers: { Authorization: `Bearer ${TEST_INGESTION_TOKEN}` },
        });

      const res1 = await makeReq();
      expect(res1.status).toBe(200);
      const res2 = await makeReq();
      expect(res2.status).toBe(200);
      const res3 = await makeReq();
      expect(res3.status).toBe(200);

      // 4th request must exceed limit of 3
      const res4 = await makeReq();
      expect(res4.status).toBe(429);
      const json4 = await res4.json();
      expect(json4.error.code).toBe("RATE_LIMIT_EXCEEDED");
    } finally {
      await new Promise<void>((resolve) => strictGateway.close(() => resolve()));
    }
  });

  // Test 9: Live external vs simulated test heartbeat separation
  it("ensures simulated heartbeats leave bridge in AGENT_NOT_CONNECTED while live external heartbeat sets AGENT_VERIFIED", async () => {
    // Reset simulated test runs and jobs so we test simulated heartbeat isolation cleanly
    await prisma.discoveryRun.updateMany({
      where: { providerId: "muse-ad-library", runMode: { in: ["SIMULATED", "TEST"] } },
      data: { status: "COMPLETED", heartbeatAt: null },
    });
    await prisma.syncJob.deleteMany({
      where: { jobType: { in: ["MUSE_AGENT_HEARTBEAT", "MUSE_AGENT_HEARTBEAT_SIMULATED"] } },
    });

    // 1. Record a simulated heartbeat (e.g. from local test runner)
    await recordMuseAgentHeartbeat("simulated-test-agent", undefined, {
      isSimulated: true,
      isLiveExternal: false,
    });

    const bridgeStatusSim = await getMuseBridgeStatus();
    expect(bridgeStatusSim.agentConnected).toBe(false);
    expect(bridgeStatusSim.diagnosticState).toBe("AGENT_NOT_CONNECTED");

    // 2. Record a genuine LIVE external heartbeat (from external agent connector)
    await recordMuseAgentHeartbeat("muse-production-agent-live", undefined, {
      isLiveExternal: true,
      isSimulated: false,
    });

    const bridgeStatusLive = await getMuseBridgeStatus();
    expect(bridgeStatusLive.agentConnected).toBe(true);
    expect(bridgeStatusLive.diagnosticState).toBe("AGENT_VERIFIED");
  });
});
