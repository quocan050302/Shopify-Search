import { describe, it, expect } from "vitest";
import { NextRequest } from "next/server";
import { GET as getProviders } from "@/app/api/v1/discovery/providers/route";
import { GET as getConfig, POST as postConfig } from "@/app/api/v1/discovery/config/route";
import { POST as postRun } from "@/app/api/v1/discovery/run/route";
import { GET as getJobs } from "@/app/api/v1/discovery/jobs/route";
import { GET as getJobDetail } from "@/app/api/v1/discovery/jobs/[id]/route";
import { POST as cancelJob } from "@/app/api/v1/discovery/jobs/[id]/cancel/route";
import { GET as getStats } from "@/app/api/v1/discovery/stats/route";
import { discoveryOrchestrator } from "@/services/discovery/discoveryOrchestrator";

describe("Auto Discovery API Endpoints (/api/v1/discovery/*)", () => {
  it("GET /api/v1/discovery/providers returns registered discovery providers", async () => {
    const res = await getProviders();
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.success).toBe(true);
    expect(Array.isArray(json.data)).toBe(true);
    expect(json.data.length).toBeGreaterThanOrEqual(3);

    const direct = json.data.find(
      (p: any) => p.id === "tiktok-topads"
    );
    expect(direct).toBeDefined();
    expect(direct.capabilities.isPaid).toBe(false);
    expect(direct.capabilities.supportsUS).toBe(true);
  });

  it("GET and POST /api/v1/discovery/config manages workspace discovery schedule", async () => {
    // 1. GET initial config
    const getRes = await getConfig();
    const getJson = await getRes.json();

    expect(getRes.status).toBe(200);
    expect(getJson.success).toBe(true);
    expect(Array.isArray(getJson.data)).toBe(true);

    // 2. POST update config
    const postReq = new NextRequest("http://localhost:3000/api/v1/discovery/config", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        enabled: true,
        dailyLimit: 25,
        keywords: ["skincare", "antiaging"],
        timezone: "America/New_York",
      }),
    });

    const postRes = await postConfig(postReq);
    const postJson = await postRes.json();

    expect(postRes.status).toBe(200);
    expect(postJson.success).toBe(true);
    expect(postJson.data.dailyLimit).toBe(25);
    expect(postJson.data.keywords).toEqual(["skincare", "antiaging"]);
  });

  it("POST /api/v1/discovery/run validates query and processes a discovery job", async () => {
    const req = new NextRequest("http://localhost:3000/api/v1/discovery/run", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        workspaceId: "ws_default",
        market: "US",
        keywords: ["beauty"],
        requestedLimit: 5,
        runMode: "DRY_RUN",
      }),
    });

    const res = await postRun(req);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.success).toBe(true);
    expect(json.data).toHaveProperty("jobId");
    expect(json.data).toHaveProperty("finalStatus");
  });

  it("GET /api/v1/discovery/jobs lists recent jobs", async () => {
    const req = new NextRequest("http://localhost:3000/api/v1/discovery/jobs?pageSize=5");
    const res = await getJobs(req);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.success).toBe(true);
    expect(Array.isArray(json.data)).toBe(true);
    expect(json.pagination).toBeDefined();
  });

  it("GET /api/v1/discovery/jobs/[id] returns 404 for unknown job", async () => {
    const req = new NextRequest("http://localhost:3000/api/v1/discovery/jobs/job_unknown_123");
    const res = await getJobDetail(req, { params: Promise.resolve({ id: "job_unknown_123" }) });
    const json = await res.json();

    expect(res.status).toBe(404);
    expect(json.success).toBe(false);
  });

  it("POST /api/v1/discovery/jobs/[id]/cancel cancels an active or pending job", async () => {
    // 1. Create a pending job directly through orchestrator
    const pendingJob = await discoveryOrchestrator.createDiscoveryJob({
      workspaceId: "ws_default",
      platform: "TIKTOK",
      market: "US",
      keywords: ["testcancel"],
      industries: [],
      objectives: [],
      searchWindowDays: 30,
      sortBy: "relevance",
      requestedLimit: 5,
      pageSize: 5,
      runMode: "MANUAL",
    });

    const jobId = pendingJob.jobId;

    // 2. Cancel the job via API
    const cancelReq = new NextRequest(`http://localhost:3000/api/v1/discovery/jobs/${jobId}/cancel`, {
      method: "POST",
    });
    const cancelRes = await cancelJob(cancelReq, { params: Promise.resolve({ id: jobId }) });
    const cancelJson = await cancelRes.json();

    expect(cancelRes.status).toBe(200);
    expect(cancelJson.success).toBe(true);
    expect(cancelJson.data.status).toBe("CANCELLED");
  });

  it("GET /api/v1/discovery/stats returns discovery summary stats", async () => {
    const res = await getStats();
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.success).toBe(true);
    expect(json.data).toHaveProperty("totalDiscoveredAds");
    expect(json.data).toHaveProperty("totalRuns");
    expect(json.data).toHaveProperty("activeSchedule");
  });
});
