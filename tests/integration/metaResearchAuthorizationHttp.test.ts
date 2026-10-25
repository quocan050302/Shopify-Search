import { describe, it, expect } from "vitest";
import { createIsolatedTestDatabase } from "../helpers/createIsolatedTestDatabase";
import { startSwaiTestServer } from "../e2e/helpers/startSwaiTestServer";

describe("Real Next.js HTTP Server Research Authorization Tests", () => {
  it("executes full HTTP cycle: local desktop authorized -> HTTP 202 -> SQLite job persisted", async () => {
    // 1. Create dedicated isolated test database
    const dbHandle = await createIsolatedTestDatabase({ prefix: "http-local-auth" });
    const workspaceId = "ws_http_local_desk";

    await dbHandle.prisma.workspace.create({
      data: {
        id: workspaceId,
        name: "HTTP Local Workspace",
        operatingMode: "RESEARCH_ONLY",
        targetMarket: "US",
      },
    });

    // 2. Start real Next.js process with trusted local desktop bypass
    const server = await startSwaiTestServer({
      databaseUrl: dbHandle.url,
      mode: "development",
      allowLocalBypass: true,
      timeoutMs: 45000,
    });

    try {
      expect(server.host).toBe("127.0.0.1");
      expect(server.port).toBeGreaterThan(0);
      expect(server.baseUrl).toContain("127.0.0.1");

      // 3. Confirm sanitized auth-status endpoint returns authorized local access
      const authRes = await fetch(`${server.baseUrl}/api/v1/auth/status`, {
        method: "GET",
        headers: { "x-workspace-id": workspaceId },
      });
      expect(authRes.status).toBe(200);
      const authJson = await authRes.json();
      expect(authJson.success).toBe(true);
      expect(authJson.authorized).toBe(true);
      expect(authJson.authMode).toBe("LOCAL_DEV");
      expect(authJson.code).toBe("AUTHORIZED");

      // 4. Send real POST to the real Next.js route
      const postRes = await fetch(`${server.baseUrl}/api/v1/discovery/meta/requests`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-workspace-id": workspaceId,
        },
        body: JSON.stringify({
          keywords: ["gadget"],
          market: "US",
          requestedLimit: 25,
        }),
      });

      expect(postRes.status).toBe(202);
      const postJson = await postRes.json();
      expect(postJson.success).toBe(true);
      expect(postJson.runId).toBeDefined();
      expect(postJson.market).toBe("US");
      expect(postJson.requestedLimit).toBe(25);
      expect(postJson.workspaceId).toBe(workspaceId);

      // 5. Query isolated SQLite through Prisma to verify persistence
      const createdRun = await dbHandle.prisma.discoveryRun.findUnique({
        where: { id: postJson.runId },
      });
      expect(createdRun).not.toBeNull();
      expect(createdRun?.workspaceId).toBe(workspaceId);
      expect(createdRun?.providerId).toBe("meta-ads-collector");
      expect(createdRun?.queryConfigJson).toContain("gadget");
      expect(createdRun?.queryConfigJson).toContain("US");

      // Verify only one job created
      const totalRuns = await dbHandle.prisma.discoveryRun.count({
        where: { workspaceId },
      });
      expect(totalRuns).toBe(1);
    } finally {
      // 6. Stop the test server cleanly
      await server.stop();
      await dbHandle.teardown();
    }
  }, 60000);

  it("fails closed on remote deployment: unauthenticated -> HTTP 401 -> no database mutation", async () => {
    // 1. Create dedicated isolated test database
    const dbHandle = await createIsolatedTestDatabase({ prefix: "http-remote-auth" });
    const workspaceId = "ws_http_remote_desk";

    await dbHandle.prisma.workspace.create({
      data: {
        id: workspaceId,
        name: "HTTP Remote Workspace",
        operatingMode: "RESEARCH_ONLY",
        targetMarket: "US",
      },
    });

    // 2. Start real Next.js process with remote deployment configuration (no admin secret provided)
    const server = await startSwaiTestServer({
      databaseUrl: dbHandle.url,
      mode: "development",
      deploymentMode: "REMOTE",
      timeoutMs: 45000,
    });

    try {
      // 3. Confirm auth status is UNAUTHORIZED
      const authRes = await fetch(`${server.baseUrl}/api/v1/auth/status`, {
        method: "GET",
        headers: { "x-workspace-id": workspaceId },
      });
      expect(authRes.status).toBe(200);
      const authJson = await authRes.json();
      expect(authJson.authorized).toBe(false);
      expect(authJson.code).toBe("ADMIN_AUTH_REQUIRED");

      // 4. Send unauthenticated research POST
      const countBefore = await dbHandle.prisma.discoveryRun.count();

      const postRes = await fetch(`${server.baseUrl}/api/v1/discovery/meta/requests`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-workspace-id": workspaceId,
        },
        body: JSON.stringify({
          keywords: ["unauthorized gadget"],
          market: "US",
          requestedLimit: 25,
        }),
      });

      expect(postRes.status).toBe(401);
      const postJson = await postRes.json();
      expect(postJson.success).toBe(false);
      expect(postJson.error).toBe("UNAUTHORIZED");

      // 5. Verify no database mutation occurred
      const countAfter = await dbHandle.prisma.discoveryRun.count();
      expect(countAfter).toBe(countBefore);
    } finally {
      await server.stop();
      await dbHandle.teardown();
    }
  }, 60000);
});
