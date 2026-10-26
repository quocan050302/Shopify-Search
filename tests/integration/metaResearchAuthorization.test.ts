import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { createIsolatedTestDatabase, TestDatabaseHandle } from "../helpers/createIsolatedTestDatabase";
import { POST as postRequests, GET as getRequests } from "@/app/api/v1/discovery/meta/requests/route";
import { GET as getAuthStatus } from "@/app/api/v1/auth/status/route";
import { GET as getProviderHealth } from "@/app/api/v1/discovery/meta/provider/health/route";

describe("Meta Research Authorization Integration Tests", () => {
  let dbHandle: TestDatabaseHandle;
  let previousTestDbUrl: string | undefined;
  const originalEnv = { ...process.env };

  const testWorkspaceId = "ws_research_auth_test";
  const forbiddenWorkspaceId = "ws_forbidden_tenant";

  beforeAll(async () => {
    dbHandle = await createIsolatedTestDatabase({ prefix: "research-auth" });
    previousTestDbUrl = process.env.TEST_DATABASE_URL;
    process.env.TEST_DATABASE_URL = dbHandle.url;

    await dbHandle.prisma.workspace.createMany({
      data: [
        {
          id: testWorkspaceId,
          name: "Research Auth Workspace",
          operatingMode: "RESEARCH_ONLY",
          targetMarket: "US",
        },
        {
          id: forbiddenWorkspaceId,
          name: "Forbidden Workspace",
          operatingMode: "RESEARCH_ONLY",
          targetMarket: "US",
        },
      ],
    });
  });

  afterAll(async () => {
    if (previousTestDbUrl) {
      process.env.TEST_DATABASE_URL = previousTestDbUrl;
    }
    if (dbHandle) {
      await dbHandle.teardown();
    }
    process.env = { ...originalEnv };
  });

  beforeEach(() => {
    process.env = { ...originalEnv };
    process.env.TEST_DATABASE_URL = dbHandle.url;
    delete process.env.ADMIN_API_KEY;
    delete process.env.SWAI_ADMIN_TOKEN;
    delete process.env.ADMIN_SECRET;
    delete process.env.SWAI_DEPLOYMENT_MODE;
    delete process.env.SWAI_REMOTE_ACCESS;
    delete process.env.SWAI_LOCAL_DESKTOP;
    delete process.env.SWAI_REQUIRE_AUTH;
    delete process.env.SWAI_E2E_SERVER;
    delete process.env.HOST;
    delete process.env.PORT;
  });

  function makePostRequest(
    body: any,
    headers: Record<string, string> = {}
  ): NextRequest {
    return new NextRequest(new URL("http://localhost:3000/api/v1/discovery/meta/requests"), {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-workspace-id": testWorkspaceId,
        ...headers,
      },
      body: JSON.stringify(body),
    });
  }

  it("Test A: Local authorized deployment creates a research job (HTTP 202)", async () => {
    process.env.HOST = "127.0.0.1";

    const initialCount = await dbHandle.prisma.discoveryRun.count({
      where: { workspaceId: testWorkspaceId },
    });

    const req = makePostRequest({
      keywords: ["gadget"],
      market: "US",
      requestedLimit: 25,
    });

    const res = await postRequests(req);
    expect(res.status).toBe(202);

    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.runId).toBeDefined();
    expect(json.market).toBe("US");
    expect(json.requestedLimit).toBe(25);
    expect(json.workspaceId).toBe(testWorkspaceId);

    const finalCount = await dbHandle.prisma.discoveryRun.count({
      where: { workspaceId: testWorkspaceId },
    });
    expect(finalCount).toBe(initialCount + 1);

    const createdRun = await dbHandle.prisma.discoveryRun.findUnique({
      where: { id: json.runId },
    });
    expect(createdRun).not.toBeNull();
    expect(createdRun?.workspaceId).toBe(testWorkspaceId);
    expect(createdRun?.queryConfigJson).toContain("gadget");
    expect(createdRun?.queryConfigJson).toContain("US");
  });

  it("Test B: Remote unauthorized request is blocked with HTTP 401 without creating job", async () => {
    process.env.SWAI_DEPLOYMENT_MODE = "REMOTE";
    process.env.HOST = "127.0.0.1";

    const countBefore = await dbHandle.prisma.discoveryRun.count();

    const req = makePostRequest({
      keywords: ["remote gadget"],
      market: "US",
      requestedLimit: 25,
    });

    const res = await postRequests(req);
    expect(res.status).toBe(401);

    const json = await res.json();
    expect(json.success).toBe(false);
    expect(json.error).toBe("UNAUTHORIZED");

    const countAfter = await dbHandle.prisma.discoveryRun.count();
    expect(countAfter).toBe(countBefore);
  });

  it("Test C: Request with invalid credentials returns HTTP 403 without creating job", async () => {
    process.env.HOST = "127.0.0.1";
    process.env.ADMIN_API_KEY = "genuine_secure_api_key_456";

    const countBefore = await dbHandle.prisma.discoveryRun.count();

    const req = makePostRequest(
      {
        keywords: ["invalid auth gadget"],
        market: "US",
        requestedLimit: 25,
      },
      {
        authorization: "Bearer invalid_secret_token",
      }
    );

    const res = await postRequests(req);
    expect(res.status).toBe(403);

    const json = await res.json();
    expect(json.success).toBe(false);
    expect(json.error).toBe("FORBIDDEN");

    const countAfter = await dbHandle.prisma.discoveryRun.count();
    expect(countAfter).toBe(countBefore);
  });

  it("Test D: Unauthorized workspace mutation is rejected with HTTP 403", async () => {
    process.env.HOST = "127.0.0.1";

    const req = makePostRequest({
      workspaceId: "ws_completely_unauthorized_external_tenant",
      keywords: ["cross workspace gadget"],
      market: "US",
      requestedLimit: 25,
    });

    const res = await postRequests(req);
    expect(res.status).toBe(403);

    const json = await res.json();
    expect(json.success).toBe(false);
    expect(json.error).toBe("UNAUTHORIZED_WORKSPACE");
  });

  it("Test E: Healthy collector but unauthorized user denies POST without job creation", async () => {
    process.env.SWAI_DEPLOYMENT_MODE = "REMOTE";

    // 1. Provider health is operational/ready
    const healthRes = await getProviderHealth();
    expect(healthRes.status).toBe(200);
    const healthJson = await healthRes.json();
    expect(healthJson.success).toBe(true);

    // 2. Auth status endpoint reflects lack of authorization
    const authStatusReq = new NextRequest(new URL("http://localhost:3000/api/v1/auth/status"));
    const authStatusRes = await getAuthStatus(authStatusReq);
    expect(authStatusRes.status).toBe(200);
    const authStatusJson = await authStatusRes.json();
    expect(authStatusJson.authorized).toBe(false);
    expect(authStatusJson.code).toBe("ADMIN_AUTH_REQUIRED");

    // 3. POST must fail closed with 401
    const countBefore = await dbHandle.prisma.discoveryRun.count();
    const researchReq = makePostRequest({
      keywords: ["unauthorized gadget"],
      market: "US",
      requestedLimit: 25,
    });
    const researchRes = await postRequests(researchReq);
    expect(researchRes.status).toBe(401);

    const countAfter = await dbHandle.prisma.discoveryRun.count();
    expect(countAfter).toBe(countBefore);
  });

  it("Test F: Advisory /api/v1/auth/status endpoint returns accurate sanitized states", async () => {
    // 1. Local desktop
    process.env.HOST = "127.0.0.1";
    const reqLocal = new NextRequest(new URL("http://localhost:3000/api/v1/auth/status"));
    const resLocal = await getAuthStatus(reqLocal);
    expect(resLocal.status).toBe(200);
    const jsonLocal = await resLocal.json();
    expect(jsonLocal.success).toBe(true);
    expect(jsonLocal.authorized).toBe(true);
    expect(jsonLocal.authMode).toBe("LOCAL_DEV");
    expect(jsonLocal.code).toBe("AUTHORIZED");

    // 2. Remote without credentials
    process.env.SWAI_DEPLOYMENT_MODE = "REMOTE";
    const reqRemote = new NextRequest(new URL("http://localhost:3000/api/v1/auth/status"));
    const resRemote = await getAuthStatus(reqRemote);
    expect(resRemote.status).toBe(200);
    const jsonRemote = await resRemote.json();
    expect(jsonRemote.success).toBe(true);
    expect(jsonRemote.authorized).toBe(false);
    expect(jsonRemote.code).toBe("ADMIN_AUTH_REQUIRED");

    // 3. Remote with valid Bearer token
    process.env.ADMIN_API_KEY = "test_valid_key_789";
    const reqValidAuth = new NextRequest(new URL("http://localhost:3000/api/v1/auth/status"), {
      headers: { authorization: "Bearer test_valid_key_789" },
    });
    const resValidAuth = await getAuthStatus(reqValidAuth);
    expect(resValidAuth.status).toBe(200);
    const jsonValidAuth = await resValidAuth.json();
    expect(jsonValidAuth.success).toBe(true);
    expect(jsonValidAuth.authorized).toBe(true);
    expect(jsonValidAuth.authMode).toBe("OWNER_ADMIN");
    expect(jsonValidAuth.code).toBe("AUTHORIZED");
  });
});
