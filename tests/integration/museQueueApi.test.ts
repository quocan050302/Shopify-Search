import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { NextRequest } from "next/server";
import { POST as postRequest, GET as getRequests } from "@/app/api/v1/discovery/muse/requests/route";
import { GET as getRequestDetail, PATCH as patchRequestDetail } from "@/app/api/v1/discovery/muse/requests/[id]/route";
import { POST as postResults } from "@/app/api/v1/discovery/muse/requests/[id]/results/route";
import { POST as postUserImport } from "@/app/api/v1/discovery/muse/requests/[id]/import/route";
import { GET as getBridgeStatus } from "@/app/api/v1/discovery/muse/bridge/route";
import { GET as getAgentRequests } from "@/app/api/v1/discovery/muse/agent/requests/route";
import { GET as getAgentRequestDetail, PATCH as patchAgentRequestDetail } from "@/app/api/v1/discovery/muse/agent/requests/[id]/route";
import { POST as postAgentResults } from "@/app/api/v1/discovery/muse/agent/requests/[id]/results/route";
import { POST as postAgentHeartbeat } from "@/app/api/v1/discovery/muse/agent/heartbeat/route";
import { prisma } from "@/lib/db";
import { discoveryOrchestrator } from "@/services/discovery/discoveryOrchestrator";
import { MUSE_PROVIDER_ID } from "@/services/discovery/normalization/normalizeFacebookAd";

const TEST_SECRET = "test_muse_secret_key_12345";
const AUTH_HEADER = `Bearer ${TEST_SECRET}`;
const ADMIN_TEST_KEY = "admin_super_secret_key_999";

describe("Muse Queue API & Ingestion Integration (Part 18 & V10.1)", () => {
  const originalSecret = process.env.MUSE_INGESTION_TOKEN;
  const originalAdminKey = process.env.ADMIN_API_KEY;
  const testRunIds: string[] = [];
  function trackRun(id: string): string {
    testRunIds.push(id);
    return id;
  }

  beforeAll(() => {
    process.env.MUSE_INGESTION_TOKEN = TEST_SECRET;
    process.env.ADMIN_API_KEY = ADMIN_TEST_KEY;
  });

  afterAll(async () => {
    process.env.MUSE_INGESTION_TOKEN = originalSecret;
    process.env.ADMIN_API_KEY = originalAdminKey;
    // Clean up ONLY runs created by this test suite to preserve real user runs
    try {
      for (const id of testRunIds) {
        await prisma.providerRequestLedger.deleteMany({ where: { discoveryRunId: id } });
        const r = await prisma.discoveryRun.findUnique({ where: { id } });
        if (r?.jobId) {
          await prisma.syncJob.delete({ where: { id: r.jobId } }).catch(() => {});
        }
        await prisma.discoveryRun.delete({ where: { id } }).catch(() => {});
      }
    } catch (e) {
      console.warn("Cleanup warning:", e);
    }
  });

  // Test 216 & V10.1: Strict separation of agent credentials and workspace binding
  it("Test 216: returns 401 on agent gateway when no token, and 403 for invalid or admin credentials", async () => {
    // 1. External agent endpoint without token -> 401
    const reqNoAuth = new NextRequest("http://localhost:3000/api/v1/discovery/muse/agent/requests", {
      method: "GET",
    });
    const resNoAuth = await getAgentRequests(reqNoAuth);
    expect(resNoAuth.status).toBe(401);
    const jsonNoAuth = await resNoAuth.json();
    expect(jsonNoAuth.error.code).toBe("MUSE_AUTH_REQUIRED");

    // 2. External agent endpoint with invalid token -> 403
    const reqBadAuth = new NextRequest("http://localhost:3000/api/v1/discovery/muse/agent/requests", {
      method: "GET",
      headers: { authorization: "Bearer completely_wrong_token" },
    });
    const resBadAuth = await getAgentRequests(reqBadAuth);
    expect(resBadAuth.status).toBe(403);
    const jsonBadAuth = await resBadAuth.json();
    expect(jsonBadAuth.error.code).toBe("INVALID_MUSE_CREDENTIALS");

    // 3. External agent endpoint rejects ADMIN credentials -> 403
    const reqAdminOnAgent = new NextRequest("http://localhost:3000/api/v1/discovery/muse/agent/requests", {
      method: "GET",
      headers: { authorization: `Bearer ${ADMIN_TEST_KEY}` },
    });
    const resAdminOnAgent = await getAgentRequests(reqAdminOnAgent);
    expect(resAdminOnAgent.status).toBe(403);
    const jsonAdminOnAgent = await resAdminOnAgent.json();
    expect(jsonAdminOnAgent.error.code).toBe("FORBIDDEN_ADMIN_CREDENTIAL_ON_AGENT_GATEWAY");

    // 4. External agent endpoint rejects unauthorized workspace header -> 403
    const reqSpoofedWorkspace = new NextRequest("http://localhost:3000/api/v1/discovery/muse/agent/requests", {
      method: "GET",
      headers: {
        authorization: AUTH_HEADER,
        "x-workspace-id": "unauthorized-rogue-workspace",
      },
    });
    const resSpoofed = await getAgentRequests(reqSpoofedWorkspace);
    expect(resSpoofed.status).toBe(403);
    const jsonSpoofed = await resSpoofed.json();
    expect(jsonSpoofed.error.code).toBe("UNAUTHORIZED_WORKSPACE");

    // 5. External agent endpoint with valid MUSE_INGESTION_TOKEN -> 200
    const reqValid = new NextRequest("http://localhost:3000/api/v1/discovery/muse/agent/requests", {
      method: "GET",
      headers: { authorization: AUTH_HEADER },
    });
    const resValid = await getAgentRequests(reqValid);
    expect(resValid.status).toBe(200);
  });

  // Test 215 & V10.1: User creates request without Muse token, agent claims via gateway
  it("Test 215: user creates request without secret, external agent claims via gateway", async () => {
    // 1. User creates a request from UI (no x-muse-token!)
    const createReq = new NextRequest("http://localhost:3000/api/v1/discovery/muse/requests", {
      method: "POST",
      headers: {
        authorization: `Bearer ${ADMIN_TEST_KEY}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        keywords: ["pet grooming glove", "dog shedding brush"],
        market: "US",
        requestedLimit: 10,
        creativePreference: "VIDEO",
      }),
    });

    const createRes = await postRequest(createReq);
    expect(createRes.status).toBe(200);
    const createJson = await createRes.json();
    expect(createJson.success).toBe(true);
    const requestId = trackRun(createJson.data.requestId);
    expect(requestId).toBeDefined();
    expect(createJson.data.status).toBe("PENDING");
    expect(createJson.data.platform).toBe("META");

    // 2. User lists queue from UI
    const listReq = new NextRequest("http://localhost:3000/api/v1/discovery/muse/requests?status=PENDING", {
      method: "GET",
      headers: { authorization: `Bearer ${ADMIN_TEST_KEY}` },
    });
    const listRes = await getRequests(listReq);
    expect(listRes.status).toBe(200);
    const listJson = await listRes.json();
    expect(listJson.success).toBe(true);
    const found = listJson.data.find((r: { requestId: string; keywords: string[] }) => r.requestId === requestId);
    expect(found).toBeDefined();
    expect(found.keywords).toContain("pet grooming glove");

    // 2b. User inspects detail from UI (no agent secret)
    const userDetailReq = new NextRequest(`http://localhost:3000/api/v1/discovery/muse/requests/${requestId}`, {
      method: "GET",
      headers: { authorization: `Bearer ${ADMIN_TEST_KEY}` },
    });
    const userDetailRes = await getRequestDetail(userDetailReq, { params: Promise.resolve({ id: requestId }) });
    expect(userDetailRes.status).toBe(200);
    const userDetailJson = await userDetailRes.json();
    expect(userDetailJson.data.requestId).toBe(requestId);

    // 3. Agent inspects assigned request via agent gateway
    const detailReq = new NextRequest(`http://localhost:3000/api/v1/discovery/muse/agent/requests/${requestId}`, {
      method: "GET",
      headers: { authorization: AUTH_HEADER },
    });
    const detailRes = await getAgentRequestDetail(detailReq, { params: Promise.resolve({ id: requestId }) });
    expect(detailRes.status).toBe(200);
    const detailJson = await detailRes.json();
    expect(detailJson.data.requestId).toBe(requestId);

    // 4. Agent claims request atomically via agent gateway
    const claimReq = new NextRequest(`http://localhost:3000/api/v1/discovery/muse/agent/requests/${requestId}`, {
      method: "PATCH",
      headers: {
        authorization: AUTH_HEADER,
        "x-muse-agent-id": "muse-session-001",
        "content-type": "application/json",
      },
      body: JSON.stringify({ action: "CLAIM" }),
    });
    const claimRes = await patchAgentRequestDetail(claimReq, { params: Promise.resolve({ id: requestId }) });
    expect(claimRes.status).toBe(200);
    const claimJson = await claimRes.json();
    expect(claimJson.success).toBe(true);

    // 5. Agent sends standalone heartbeat
    const hbReq = new NextRequest("http://localhost:3000/api/v1/discovery/muse/agent/heartbeat", {
      method: "POST",
      headers: {
        authorization: AUTH_HEADER,
        "x-muse-gateway-source": "muse-reverse-proxy-8787",
        "content-type": "application/json",
      },
      body: JSON.stringify({ requestId }),
    });
    const hbRes = await postAgentHeartbeat(hbReq);
    expect(hbRes.status).toBe(200);
    const hbJson = await hbRes.json();
    expect(hbJson.data.heartbeatRecorded).toBe(true);

    // 6. Check bridge status & diagnostics
    const bridgeReq = new NextRequest("http://localhost:3000/api/v1/discovery/muse/bridge", {
      method: "GET",
    });
    const bridgeRes = await getBridgeStatus(bridgeReq);
    expect(bridgeRes.status).toBe(200);
    const bridgeJson = await bridgeRes.json();
    expect(bridgeJson.data.isConfigured).toBe(true);
    expect(bridgeJson.data.diagnosticState).toBe("AGENT_VERIFIED");
    expect(bridgeJson.data.agentConnected).toBe(true);
  });

  // Test 218: Atomic claim & concurrency protection
  it("Test 218: prevents multiple agents from claiming the same active request", async () => {
    // Create new request
    const createReq = new NextRequest("http://localhost:3000/api/v1/discovery/muse/requests", {
      method: "POST",
      headers: { authorization: AUTH_HEADER, "content-type": "application/json" },
      body: JSON.stringify({ keywords: ["ergonomic mousepad"] }),
    });
    const createRes = await postRequest(createReq);
    const { requestId: rawId } = (await createRes.json()).data;
    const requestId = trackRun(rawId);

    // Agent 1 claims
    const claim1Req = new NextRequest(`http://localhost:3000/api/v1/discovery/muse/requests/${requestId}`, {
      method: "PATCH",
      headers: { authorization: AUTH_HEADER, "x-muse-agent-id": "agent-1", "content-type": "application/json" },
      body: JSON.stringify({ action: "CLAIM" }),
    });
    const claim1Res = await patchRequestDetail(claim1Req, { params: Promise.resolve({ id: requestId }) });
    expect(claim1Res.status).toBe(200);

    // Agent 2 attempts to claim same request immediately
    const claim2Req = new NextRequest(`http://localhost:3000/api/v1/discovery/muse/requests/${requestId}`, {
      method: "PATCH",
      headers: { authorization: AUTH_HEADER, "x-muse-agent-id": "agent-2", "content-type": "application/json" },
      body: JSON.stringify({ action: "CLAIM" }),
    });
    const claim2Res = await patchRequestDetail(claim2Req, { params: Promise.resolve({ id: requestId }) });
    expect(claim2Res.status).toBe(409);
    const claim2Json = await claim2Res.json();
    expect(claim2Json.error.code).toBe("CLAIM_CONFLICT");
  });

  // Test 219: Status transition rules (cannot reopen COMPLETED)
  it("Test 219: rejects reopening completed or cancelled requests to RUNNING", async () => {
    // Create request
    const createReq = new NextRequest("http://localhost:3000/api/v1/discovery/muse/requests", {
      method: "POST",
      headers: { authorization: AUTH_HEADER, "content-type": "application/json" },
      body: JSON.stringify({ keywords: ["sunset lamp"] }),
    });
    const { requestId: rawId } = (await (await postRequest(createReq)).json()).data;
    const requestId = trackRun(rawId);

    // Cancel request
    const cancelReq = new NextRequest(`http://localhost:3000/api/v1/discovery/muse/requests/${requestId}`, {
      method: "PATCH",
      headers: { authorization: AUTH_HEADER, "content-type": "application/json" },
      body: JSON.stringify({ status: "CANCELLED" }),
    });
    const cancelRes = await patchRequestDetail(cancelReq, { params: Promise.resolve({ id: requestId }) });
    expect(cancelRes.status).toBe(200);

    // Attempt to reopen to RUNNING
    const reopenReq = new NextRequest(`http://localhost:3000/api/v1/discovery/muse/requests/${requestId}`, {
      method: "PATCH",
      headers: { authorization: AUTH_HEADER, "content-type": "application/json" },
      body: JSON.stringify({ status: "RUNNING" }),
    });
    const reopenRes = await patchRequestDetail(reopenReq, { params: Promise.resolve({ id: requestId }) });
    expect(reopenRes.status).toBe(409);
  });

  // Test 220: Duplicate submission idempotency
  it("Test 220: handles duplicate result submissions idempotently without duplicating ads", async () => {
    const createReq = new NextRequest("http://localhost:3000/api/v1/discovery/muse/requests", {
      method: "POST",
      headers: { authorization: AUTH_HEADER, "content-type": "application/json" },
      body: JSON.stringify({ keywords: ["crystal hair eraser"] }),
    });
    const { requestId: rawId } = (await (await postRequest(createReq)).json()).data;
    const requestId = trackRun(rawId);

    // Agent claims request
    const claimReq = new NextRequest(`http://localhost:3000/api/v1/discovery/muse/agent/requests/${requestId}`, {
      method: "PATCH",
      headers: { authorization: AUTH_HEADER, "x-muse-agent-id": "muse-idempotent-agent", "content-type": "application/json" },
      body: JSON.stringify({ action: "CLAIM" }),
    });
    const claimRes = await patchAgentRequestDetail(claimReq, { params: Promise.resolve({ id: requestId }) });
    expect(claimRes.status).toBe(200);

    const testLibraryId = "2489" + String(Date.now()).slice(-10);
    const submissionPayload = {
      submissionId: `sub_idempotent_test_${Date.now()}`,
      records: [
        {
          libraryId: testLibraryId,
          advertiserName: "Bleame Test Store",
          headline: "Crystal Hair Eraser V2",
          landingPageUrl: "https://bleame.example.com/eraser",
          mediaType: "VIDEO",
          activeStatus: "ACTIVE",
          sourceReportedStartAt: "2026-08-10",
        },
      ],
    };

    // First submission
    const sub1Req = new NextRequest(`http://localhost:3000/api/v1/discovery/muse/agent/requests/${requestId}/results`, {
      method: "POST",
      headers: { authorization: AUTH_HEADER, "x-muse-agent-id": "muse-idempotent-agent", "content-type": "application/json" },
      body: JSON.stringify(submissionPayload),
    });
    const sub1Res = await postAgentResults(sub1Req, { params: Promise.resolve({ id: requestId }) });
    expect(sub1Res.status).toBe(200);
    const sub1Json = await sub1Res.json();
    expect(sub1Json.data.newUniqueInserted).toBe(1);
    expect(sub1Json.data.status).toBe("COMPLETED");

    // Second submission with exact same submissionId (Idempotent replay)
    const sub2Req = new NextRequest(`http://localhost:3000/api/v1/discovery/muse/agent/requests/${requestId}/results`, {
      method: "POST",
      headers: { authorization: AUTH_HEADER, "x-muse-agent-id": "muse-idempotent-agent", "content-type": "application/json" },
      body: JSON.stringify(submissionPayload),
    });
    const sub2Res = await postAgentResults(sub2Req, { params: Promise.resolve({ id: requestId }) });
    expect(sub2Res.status).toBe(200);
    const sub2Json = await sub2Res.json();
    expect(sub2Json.data.isIdempotentReplay).toBe(true);

    // Verify DB count of this ad is strictly 1
    const adCount = await prisma.competitorAd.count({
      where: { externalAdId: testLibraryId },
    });
    expect(adCount).toBe(1);
  });

  // Test 221 & 222: Partial failure & rejected invalid source evidence
  it("Test 221 & 222: accepts valid ads while rejecting invalid records within the same batch", async () => {
    const createReq = new NextRequest("http://localhost:3000/api/v1/discovery/muse/requests", {
      method: "POST",
      headers: { authorization: AUTH_HEADER, "content-type": "application/json" },
      body: JSON.stringify({ keywords: ["cleaning gel putty"] }),
    });
    const { requestId: rawId } = (await (await postRequest(createReq)).json()).data;
    const requestId = trackRun(rawId);

    // Agent claims request
    const claimReq = new NextRequest(`http://localhost:3000/api/v1/discovery/muse/agent/requests/${requestId}`, {
      method: "PATCH",
      headers: { authorization: AUTH_HEADER, "x-muse-agent-id": "muse-mixed-agent", "content-type": "application/json" },
      body: JSON.stringify({ action: "CLAIM" }),
    });
    const claimRes = await patchAgentRequestDetail(claimReq, { params: Promise.resolve({ id: requestId }) });
    expect(claimRes.status).toBe(200);

    const validLibId = "3344" + String(Date.now()).slice(-10);
    const mixedPayload = {
      submissionId: `sub_mixed_${Date.now()}`,
      records: [
        // Valid
        {
          libraryId: validLibId,
          advertiserName: "Car Cleaning Co",
          headline: "Auto Detailing Putty Gel",
          mediaType: "IMAGE",
        },
        // Invalid (malformed ID)
        {
          libraryId: "invalid_id_not_numeric",
          advertiserName: "Bad Record Brand",
        },
      ],
    };

    const subReq = new NextRequest(`http://localhost:3000/api/v1/discovery/muse/agent/requests/${requestId}/results`, {
      method: "POST",
      headers: { authorization: AUTH_HEADER, "x-muse-agent-id": "muse-mixed-agent", "content-type": "application/json" },
      body: JSON.stringify(mixedPayload),
    });
    const subRes = await postAgentResults(subReq, { params: Promise.resolve({ id: requestId }) });
    expect(subRes.status).toBe(200);
    const subJson = await subRes.json();

    expect(subJson.data.totalSubmitted).toBe(2);
    expect(subJson.data.formatValid).toBe(1);
    expect(subJson.data.rejectedCount).toBe(1);
    expect(subJson.data.newUniqueInserted).toBe(1);
    expect(subJson.data.status).toBe("PARTIALLY_COMPLETED");
  });

  // Test 223: Genuine zero-result search completion
  it("Test 223: allows legitimate zero-result search completion without marking as failed", async () => {
    const createReq = new NextRequest("http://localhost:3000/api/v1/discovery/muse/requests", {
      method: "POST",
      headers: { authorization: AUTH_HEADER, "content-type": "application/json" },
      body: JSON.stringify({ keywords: ["extremely obscure keyword nonexistent ad"] }),
    });
    const { requestId: rawId } = (await (await postRequest(createReq)).json()).data;
    const requestId = trackRun(rawId);

    // Agent claims request
    const claimReq = new NextRequest(`http://localhost:3000/api/v1/discovery/muse/agent/requests/${requestId}`, {
      method: "PATCH",
      headers: { authorization: AUTH_HEADER, "x-muse-agent-id": "muse-empty-agent", "content-type": "application/json" },
      body: JSON.stringify({ action: "CLAIM" }),
    });
    const claimRes = await patchAgentRequestDetail(claimReq, { params: Promise.resolve({ id: requestId }) });
    expect(claimRes.status).toBe(200);

    // Agent submits empty array indicating no ads were found on Meta Ad Library
    const emptyPayload = {
      submissionId: `sub_empty_${Date.now()}`,
      records: [],
      outcome: "COMPLETED_EMPTY",
    };

    const emptyReq = new NextRequest(`http://localhost:3000/api/v1/discovery/muse/agent/requests/${requestId}/results`, {
      method: "POST",
      headers: { authorization: AUTH_HEADER, "x-muse-agent-id": "muse-empty-agent", "content-type": "application/json" },
      body: JSON.stringify(emptyPayload),
    });
    const emptyRes = await postAgentResults(emptyReq, { params: Promise.resolve({ id: requestId }) });
    expect(emptyRes.status).toBe(200);
    const emptyJson = await emptyRes.json();

    expect(emptyJson.data.status).toBe("COMPLETED");
    expect(emptyJson.data.outcomeCategory).toBe("COMPLETED_EMPTY");
    expect(emptyJson.data.totalSubmitted).toBe(0);
    expect(emptyJson.data.failedCount).toBe(0);
  });

  // Test 224: Local worker exclusion
  it("Test 224: ensures local worker claim mechanism strictly ignores Muse provider jobs", async () => {
    // Create a pending Muse job
    const createReq = new NextRequest("http://localhost:3000/api/v1/discovery/muse/requests", {
      method: "POST",
      headers: { authorization: AUTH_HEADER, "content-type": "application/json" },
      body: JSON.stringify({ keywords: ["worker exclusion test"] }),
    });
    const { requestId: rawId } = (await (await postRequest(createReq)).json()).data;
    const requestId = trackRun(rawId);

    // Local orchestrator worker claims pending jobs
    const claimedByWorker = await discoveryOrchestrator.claimPendingDiscoveryJob();

    // The claimed job must NEVER be the Muse job
    expect(claimedByWorker).not.toBe(requestId);

    // Verify the Muse job remains in PENDING state
    const run = await prisma.discoveryRun.findUnique({ where: { id: requestId } });
    expect(run?.status).toBe("PENDING");
    expect(run?.providerId).toBe(MUSE_PROVIDER_ID);

    // Executing executeDiscoveryJob directly with a Muse run ID must throw an explicit error
    await expect(discoveryOrchestrator.executeDiscoveryJob(requestId)).rejects.toThrow(
      /Muse provider jobs are asynchronous/
    );
  });

  // Test 225 (V10.1): Same-origin user imports research artifact without Muse secret
  it("Test 225: allows user to import structured research artifact without agent secret", async () => {
    // 1. Create request
    const createReq = new NextRequest("http://localhost:3000/api/v1/discovery/muse/requests", {
      method: "POST",
      headers: { authorization: `Bearer ${ADMIN_TEST_KEY}`, "content-type": "application/json" },
      body: JSON.stringify({ keywords: ["ice roller face"] }),
    });
    const { requestId: rawId } = (await (await postRequest(createReq)).json()).data;
    const requestId = trackRun(rawId);

    // 2. User imports artifact via dedicated /import endpoint (no agent secret!)
    const userImportId = "9876" + String(Date.now()).slice(-10);
    const importPayload = {
      submissionId: `sub_user_import_${Date.now()}`,
      records: [
        {
          libraryId: userImportId,
          advertiserName: "Glow Skin Store",
          headline: "Stainless Steel Face Ice Roller",
          mediaType: "IMAGE",
        },
      ],
    };

    const importReq = new NextRequest(`http://localhost:3000/api/v1/discovery/muse/requests/${requestId}/import`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${ADMIN_TEST_KEY}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(importPayload),
    });

    const importRes = await postUserImport(importReq, { params: Promise.resolve({ id: requestId }) });
    expect(importRes.status).toBe(200);
    const importJson = await importRes.json();
    expect(importJson.success).toBe(true);
    expect(importJson.data.newUniqueInserted).toBe(1);
    expect(importJson.data.status).toBe("COMPLETED");

    // Verify ad exists in database
    const ad = await prisma.competitorAd.findUnique({ where: { externalAdId: userImportId } });
    expect(ad).not.toBeNull();
  });

  // Test 226 (V10.1): External agent cannot cancel user research requests
  it("Test 226: forbids external agent from cancelling a user research request", async () => {
    const createReq = new NextRequest("http://localhost:3000/api/v1/discovery/muse/requests", {
      method: "POST",
      headers: { authorization: `Bearer ${ADMIN_TEST_KEY}`, "content-type": "application/json" },
      body: JSON.stringify({ keywords: ["sleep mask noise cancelling"] }),
    });
    const { requestId: rawId } = (await (await postRequest(createReq)).json()).data;
    const requestId = trackRun(rawId);

    // Agent attempts to cancel via agent gateway
    const agentCancelReq = new NextRequest(`http://localhost:3000/api/v1/discovery/muse/agent/requests/${requestId}`, {
      method: "PATCH",
      headers: {
        authorization: AUTH_HEADER,
        "content-type": "application/json",
      },
      body: JSON.stringify({ status: "CANCELLED" }),
    });

    const agentCancelRes = await patchAgentRequestDetail(agentCancelReq, {
      params: Promise.resolve({ id: requestId }),
    });
    expect(agentCancelRes.status).toBe(403);
    const cancelJson = await agentCancelRes.json();
    expect(cancelJson.error.code).toBe("FORBIDDEN_ACTION");
  });

  // Test 227: Rejects result submission when request belongs to another workspace
  it("Test 227: rejects result submission when request belongs to another workspace", async () => {
    const rogueWs = await prisma.workspace.create({
      data: { id: `ws_rogue_${Date.now()}`, name: "Rogue Workspace" },
    });
    const run = await prisma.discoveryRun.create({
      data: {
        workspaceId: rogueWs.id,
        providerId: MUSE_PROVIDER_ID,
        status: "CLAIMED",
        queryConfigJson: JSON.stringify({
          keywords: ["workspace isolation test"],
          market: "US",
          claimedByAgentId: "external-agent-1",
        }),
      },
    });
    trackRun(run.id);

    const subReq = new NextRequest(`http://localhost:3000/api/v1/discovery/muse/agent/requests/${run.id}/results`, {
      method: "POST",
      headers: {
        authorization: AUTH_HEADER,
        "x-muse-agent-id": "external-agent-1",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        submissionId: `sub_ws_test_${Date.now()}`,
        records: [],
      }),
    });

    const res = await postAgentResults(subReq, { params: Promise.resolve({ id: run.id }) });
    expect(res.status).toBe(403);
    const json = await res.json();
    expect(json.error.code).toBe("UNAUTHORIZED_WORKSPACE");

    await prisma.workspace.delete({ where: { id: rogueWs.id } }).catch(() => {});
  });

  // Test 228: Rejects result submission from external agent on an unclaimed PENDING request
  it("Test 228: rejects result submission from external agent on an unclaimed PENDING request", async () => {
    const createReq = new NextRequest("http://localhost:3000/api/v1/discovery/muse/requests", {
      method: "POST",
      headers: { authorization: `Bearer ${ADMIN_TEST_KEY}`, "content-type": "application/json" },
      body: JSON.stringify({ keywords: ["unclaimed test keyword"] }),
    });
    const { requestId: rawId } = (await (await postRequest(createReq)).json()).data;
    const requestId = trackRun(rawId);

    // Agent attempts to submit results directly without claiming
    const subReq = new NextRequest(`http://localhost:3000/api/v1/discovery/muse/agent/requests/${requestId}/results`, {
      method: "POST",
      headers: {
        authorization: AUTH_HEADER,
        "x-muse-agent-id": "agent-skip-claim",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        submissionId: `sub_unclaimed_${Date.now()}`,
        records: [],
      }),
    });

    const res = await postAgentResults(subReq, { params: Promise.resolve({ id: requestId }) });
    expect(res.status).toBe(409);
    const json = await res.json();
    expect(json.error.code).toBe("REQUEST_NOT_CLAIMED");
  });

  // Test 229: Rejects result submission from Agent 2 when request was claimed by Agent 1
  it("Test 229: prevents agent without claim ownership from submitting results", async () => {
    const createReq = new NextRequest("http://localhost:3000/api/v1/discovery/muse/requests", {
      method: "POST",
      headers: { authorization: `Bearer ${ADMIN_TEST_KEY}`, "content-type": "application/json" },
      body: JSON.stringify({ keywords: ["ownership test item"] }),
    });
    const { requestId: rawId } = (await (await postRequest(createReq)).json()).data;
    const requestId = trackRun(rawId);

    // Agent 1 claims request
    const claimReq = new NextRequest(`http://localhost:3000/api/v1/discovery/muse/agent/requests/${requestId}`, {
      method: "PATCH",
      headers: {
        authorization: AUTH_HEADER,
        "x-muse-agent-id": "legitimate-agent-1",
        "content-type": "application/json",
      },
      body: JSON.stringify({ action: "CLAIM" }),
    });
    const claimRes = await patchAgentRequestDetail(claimReq, { params: Promise.resolve({ id: requestId }) });
    expect(claimRes.status).toBe(200);

    // Rogue Agent 2 attempts to submit results into request claimed by Agent 1
    const rogueSubReq = new NextRequest(`http://localhost:3000/api/v1/discovery/muse/agent/requests/${requestId}/results`, {
      method: "POST",
      headers: {
        authorization: AUTH_HEADER,
        "x-muse-agent-id": "rogue-agent-2",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        submissionId: `sub_rogue_${Date.now()}`,
        records: [],
      }),
    });

    const rogueRes = await postAgentResults(rogueSubReq, { params: Promise.resolve({ id: requestId }) });
    expect(rogueRes.status).toBe(403);
    const rogueJson = await rogueRes.json();
    expect(rogueJson.error.code).toBe("UNAUTHORIZED_AGENT");
  });

  // Test 230: Rejects result submission when agent claim lease has expired (> 15 minutes)
  it("Test 230: rejects result submission when agent claim lease has expired", async () => {
    const createReq = new NextRequest("http://localhost:3000/api/v1/discovery/muse/requests", {
      method: "POST",
      headers: { authorization: `Bearer ${ADMIN_TEST_KEY}`, "content-type": "application/json" },
      body: JSON.stringify({ keywords: ["expired lease test"] }),
    });
    const { requestId: rawId } = (await (await postRequest(createReq)).json()).data;
    const requestId = trackRun(rawId);

    // Agent claims request
    const claimReq = new NextRequest(`http://localhost:3000/api/v1/discovery/muse/agent/requests/${requestId}`, {
      method: "PATCH",
      headers: {
        authorization: AUTH_HEADER,
        "x-muse-agent-id": "lease-expiring-agent",
        "content-type": "application/json",
      },
      body: JSON.stringify({ action: "CLAIM" }),
    });
    await patchAgentRequestDetail(claimReq, { params: Promise.resolve({ id: requestId }) });

    // Simulate lease expiration by updating startedAt and heartbeatAt to 20 minutes ago
    const twentyMinsAgo = new Date(Date.now() - 20 * 60 * 1000);
    await prisma.discoveryRun.update({
      where: { id: requestId },
      data: { startedAt: twentyMinsAgo, heartbeatAt: twentyMinsAgo },
    });

    // Agent attempts to submit results after lease expiration
    const expiredSubReq = new NextRequest(`http://localhost:3000/api/v1/discovery/muse/agent/requests/${requestId}/results`, {
      method: "POST",
      headers: {
        authorization: AUTH_HEADER,
        "x-muse-agent-id": "lease-expiring-agent",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        submissionId: `sub_expired_${Date.now()}`,
        records: [],
      }),
    });

    const expiredRes = await postAgentResults(expiredSubReq, { params: Promise.resolve({ id: requestId }) });
    expect(expiredRes.status).toBe(409);
    const expiredJson = await expiredRes.json();
    expect(expiredJson.error.code).toBe("LEASE_EXPIRED");
  });
});
