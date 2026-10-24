import { NextResponse } from "next/server";
import fs from "fs";
import { prisma } from "@/lib/db";
import { getMetaCollectorConfig } from "@/services/discovery/metaCollector/metaCollectorConfig";
import { getDiscoveryProvider } from "@/services/discovery/providerRegistry";

/**
 * GET /api/v1/discovery/meta/provider/health
 * Safe health diagnostic report for the local MetaAdsCollector MCP provider and background worker.
 * Never exposes credentials, secret tokens, or private host filesystem details.
 */
export async function GET() {
  try {
    const config = getMetaCollectorConfig();
    const provider = getDiscoveryProvider("meta-ads-collector");

    // 1. Python environment checks (sanitized without printing personal home paths)
    const pythonBinaryPresent = fs.existsSync(config.pythonBin);
    const dataDirPresent = fs.existsSync(config.dataDir);

    // 2. Provider configuration & availability
    let configStatus = "NOT_CONFIGURED";
    let isAuthorized = false;
    let availabilityMessage = "";

    if (provider) {
      const statusRes = provider.getProviderConfigurationStatus();
      configStatus = statusRes.status;
      isAuthorized = statusRes.isAuthorized;
      availabilityMessage = statusRes.message || "";
    }

    // 3. Worker heartbeat check from DB
    const workerJob = await prisma.syncJob.findFirst({
      where: { jobType: "DISCOVERY_WORKER_HEARTBEAT" },
    });

    const isWorkerRunning =
      workerJob?.status === "RUNNING" &&
      workerJob.startedAt &&
      Date.now() - new Date(workerJob.startedAt).getTime() < 120_000;

    // 4. Query statistics from DiscoveryRun
    const lastSuccessfulRun = await prisma.discoveryRun.findFirst({
      where: {
        providerId: "meta-ads-collector",
        status: { in: ["COMPLETED", "PARTIALLY_COMPLETED"] },
        validCount: { gt: 0 },
      },
      orderBy: { finishedAt: "desc" },
      select: {
        id: true,
        validCount: true,
        finishedAt: true,
      },
    });

    const lastFailedRun = await prisma.discoveryRun.findFirst({
      where: {
        providerId: "meta-ads-collector",
        status: { in: ["FAILED", "BLOCKED_SOURCE", "RATE_LIMITED"] },
      },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        errorCategory: true,
        errorMessage: true,
        createdAt: true,
      },
    });

    return NextResponse.json({
      success: true,
      timestamp: new Date().toISOString(),
      provider: {
        id: "meta-ads-collector",
        name: "Meta Ad Library (Local MCP)",
        enabled: config.enabled,
        status: configStatus,
        isAuthorized,
        message: availabilityMessage,
      },
      environment: {
        pythonReady: pythonBinaryPresent,
        dataDirReady: dataDirPresent,
        defaultCountry: config.defaultCountry,
        liveTestEnabled: config.liveTestEnabled,
      },
      worker: {
        status: isWorkerRunning ? "RUNNING" : "STOPPED",
        lastHeartbeat: workerJob?.startedAt || null,
      },
      history: {
        lastSuccessfulRetrievalAt: lastSuccessfulRun?.finishedAt || null,
        lastSuccessfulRecordCount: lastSuccessfulRun?.validCount || 0,
        lastFailureCategory: lastFailedRun?.errorCategory || null,
        lastFailureMessage: lastFailedRun?.errorMessage || null,
        lastFailureAt: lastFailedRun?.createdAt || null,
      },
      limits: {
        maxResultsPerSearch: config.maxResults,
        maxRequestsPerSearch: config.maxRequests,
        maxExecutionSeconds: config.maxSeconds,
        maxConcurrency: config.maxConcurrency,
      },
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { success: false, error: "HEALTH_CHECK_FAILED", message: msg },
      { status: 500 }
    );
  }
}
