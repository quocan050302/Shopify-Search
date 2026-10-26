import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { NextRequest } from "next/server";
import { createIsolatedTestDatabase, TestDatabaseHandle } from "../helpers/createIsolatedTestDatabase";
import { POST as createMetaRequest } from "@/app/api/v1/discovery/meta/requests/route";
import { deriveResearchAction } from "@/lib/meta/researchActionPolicy";
import { NormalizedReadiness } from "@/lib/meta/normalizeMetaHealth";

describe("Meta Readiness-Aware Submission (/api/v1/discovery/meta/requests & Action Policy)", () => {
  let dbHandle: TestDatabaseHandle;
  let previousTestDbUrl: string | undefined;

  const authorizedWorkspaceId = "ws_readiness_auth";
  const unauthorizedWorkspaceId = "ws_unauthorized_external";

  beforeAll(async () => {
    dbHandle = await createIsolatedTestDatabase({ prefix: "meta-readiness" });
    previousTestDbUrl = process.env.TEST_DATABASE_URL;
    process.env.TEST_DATABASE_URL = dbHandle.url;

    await dbHandle.prisma.workspace.create({
      data: { id: authorizedWorkspaceId, name: "Auth Workspace", operatingMode: "RESEARCH_ONLY", targetMarket: "US" },
    });
  });

  afterAll(async () => {
    if (previousTestDbUrl !== undefined) {
      process.env.TEST_DATABASE_URL = previousTestDbUrl;
    } else {
      delete process.env.TEST_DATABASE_URL;
    }
    await dbHandle?.teardown();
  });

  function makePostRequest(body: any, workspaceId: string): NextRequest {
    return new NextRequest(new URL("/api/v1/discovery/meta/requests", "http://localhost:3000"), {
      method: "POST",
      headers: {
        host: "localhost:3000",
        "content-type": "application/json",
        "x-workspace-id": workspaceId,
      },
      body: JSON.stringify(body),
    });
  }

  it("accepts valid research submission for authorized workspace and returns 202 with PENDING run", async () => {
    const req = makePostRequest(
      {
        keywords: ["pet hair remover", "lint brush"],
        market: "US",
        requestedLimit: 25,
      },
      authorizedWorkspaceId
    );

    const res = await createMetaRequest(req);
    expect(res.status).toBe(202);

    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.status).toBe("PENDING");
    expect(json.runId).toBeDefined();
    expect(json.workspaceId).toBe(authorizedWorkspaceId);

    // Verify record in database
    const createdRun = await dbHandle.prisma.discoveryRun.findUnique({
      where: { id: json.runId },
    });
    expect(createdRun).not.toBeNull();
    expect(createdRun?.status).toBe("PENDING");
    expect(createdRun?.workspaceId).toBe(authorizedWorkspaceId);
  });

  it("rejects submission when keywords array is empty", async () => {
    const req = makePostRequest(
      {
        keywords: [],
        market: "US",
      },
      authorizedWorkspaceId
    );

    const res = await createMetaRequest(req);
    expect(res.status).toBe(400);

    const json = await res.json();
    expect(json.success).toBe(false);
    expect(json.error).toBe("INVALID_REQUEST");
  });

  it("rejects submission when attempting to create a job for an unauthorized foreign workspace", async () => {
    const req = makePostRequest(
      {
        workspaceId: unauthorizedWorkspaceId, // Tampered workspace in body
        keywords: ["pet roller"],
        market: "US",
      },
      authorizedWorkspaceId // Authenticated as authorizedWorkspaceId
    );

    const res = await createMetaRequest(req);
    expect(res.status).toBe(403);

    const json = await res.json();
    expect(json.success).toBe(false);
    expect(json.error).toBe("UNAUTHORIZED_WORKSPACE");
  });

  it("enforces action policy disallowing submission when readiness is UNKNOWN or LOADING", () => {
    const unknownReadiness: NormalizedReadiness = {
      state: "UNKNOWN",
      title: "Unknown State",
      message: "Health check unavailable",
      badgeVariant: "danger",
      canStartResearch: false,
      canQueueForLater: false,
      primaryActionLabel: "Run Diagnostics",
      setupSteps: [],
    };

    const loadingReadiness: NormalizedReadiness = {
      state: "LOADING",
      title: "Checking...",
      message: "Probing local collector...",
      badgeVariant: "neutral",
      canStartResearch: false,
      canQueueForLater: false,
      primaryActionLabel: "Checking...",
      setupSteps: [],
    };

    const unknownAction = deriveResearchAction(unknownReadiness);
    expect(unknownAction.buttonType).toBe("button");
    expect(unknownAction.kind).toBe("DIAGNOSTICS");

    const loadingAction = deriveResearchAction(loadingReadiness);
    expect(loadingAction.buttonType).toBe("button");
    expect(loadingAction.enabled).toBe(false);
    expect(loadingAction.kind).toBe("WAIT");
  });
});
