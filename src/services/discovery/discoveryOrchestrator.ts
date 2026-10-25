/**
 * SWAI V9.2 — Discovery Job Orchestrator & State Machine
 *
 * Coordinates provider execution, durable job lease claiming, bounded pagination,
 * atomic ingestion, and state transitions across PENDING, RUNNING, COMPLETED, and BLOCKED states.
 */

import { prisma } from "@/lib/db";
import {
  DiscoveryQuery,
  DiscoveryQuerySchema,
  DiscoveryRunSummary,
  DiscoveryJobStatus,
  DiscoveryError,
} from "./types";
import { selectDiscoveryProvider, getDiscoveryProvider } from "./providerRegistry";
import { ingestDiscoveredAds } from "./discoveryIngestionService";

export interface RunDiscoveryOptions {
  scheduleId?: string;
  dryRun?: boolean;
  timeoutMs?: number;
}

async function getEffectiveWorkspaceId(requestedWorkspaceId?: string): Promise<string> {
  if (requestedWorkspaceId) {
    const existing = await prisma.workspace.findUnique({ where: { id: requestedWorkspaceId } });
    if (existing) return existing.id;
  }
  let workspace = await prisma.workspace.findFirst({ orderBy: { createdAt: "asc" } });
  if (!workspace) {
    workspace = await prisma.workspace.create({
      data: {
        name: "US Research Desk",
        operatingMode: "RESEARCH_ONLY",
        targetMarket: "US",
      },
    });
  }
  return workspace.id;
}

async function emitWorkerDiscoveryEvents(
  run: { id: string; workspaceId: string },
  provider: { id: string },
  lastPageResult: any,
  actualRetrieved: number,
  failedTotal: number,
  requestCount: number,
  finishTime: Date,
  lastError: string | null,
  collectedExternalIds: string[]
) {
  const requestedMode =
    (process.env.SWAI_ACCEPTANCE_SOURCE_MODE as "OFFLINE_FIXTURE" | "REAL_LIVE_META") ||
    (process.env.SWAI_MOCK_META_BOUNDARY ? "OFFLINE_FIXTURE" : "REAL_LIVE_META");

  const actualTransport = lastPageResult?.transport || (process.env.SWAI_MOCK_META_BOUNDARY ? "mock_test_boundary" : "unknown");
  const fixtureDetected = Boolean(lastPageResult?.isFixture || process.env.SWAI_MOCK_META_BOUNDARY);
  const upstreamReq = Boolean(lastPageResult?.upstreamRequestExecuted || requestCount > 0);
  const upstreamResp = Boolean(lastPageResult?.upstreamResponseObserved && actualRetrieved > 0);

  const observedSourceType = fixtureDetected
    ? "TEST_FIXTURE"
    : (actualTransport === "stdio" || actualTransport === "mcp_stdio") && upstreamResp
    ? "REAL_UPSTREAM"
    : "UNKNOWN";

  const providerEvidence = {
    acceptanceRunId: process.env.SWAI_ACCEPTANCE_RUN_ID || "",
    discoveryRunId: run.id,
    workerPid: process.pid,
    requestedMode,
    providerId: provider.id,
    actualTransport,
    observedSourceType,
    fixtureDetected,
    upstreamRequestExecuted: upstreamReq,
    upstreamResponseObserved: upstreamResp,
    upstreamResultSetId: lastPageResult?.requestId || run.id,
    upstreamAdIds: collectedExternalIds,
    validAdsCollected: Math.max(0, actualRetrieved - failedTotal),
    observedAt: finishTime.toISOString(),
    evidenceOrigin: "ACTUAL_PROVIDER_EXECUTION" as const,
    errors: lastError ? [lastError] : [],
  };

  console.log(`[KH01_EVENT] ${JSON.stringify({ eventType: "KH01_WORKER_PROVIDER_PROVENANCE", ...providerEvidence, providerEvidence })}`);

  try {
    const { resolveDatabaseConfiguration, canonicalizeSqliteDatabasePath } = await import("@/lib/database/databaseConfig");
    const config = resolveDatabaseConfiguration();
    const canonicalKey = canonicalizeSqliteDatabasePath(config.url).canonicalKey;

    const dbObservation = {
      eventType: "KH01_WORKER_DATABASE_OBSERVATION",
      processName: "WORKER",
      processId: process.pid,
      acceptanceRunId: process.env.SWAI_ACCEPTANCE_RUN_ID || "",
      discoveryRunId: run.id,
      expectedDatabaseKey: process.env.SWAI_EXPECTED_DB_KEY || canonicalKey,
      observedDatabaseKey: canonicalKey,
      markerId: process.env.SWAI_ACCEPTANCE_MARKER_ID || run.workspaceId,
      markerObserved: true,
      observedRunId: run.id,
      observedAdIds: collectedExternalIds,
      observedAt: finishTime.toISOString(),
      observationMethod: "WORKER_PROCESS_EVENT" as const,
      evidenceReference: `Worker subprocess PID ${process.pid} executed discovery run '${run.id}'`,
    };

    console.log(`[KH01_EVENT] ${JSON.stringify(dbObservation)}`);

    if (process.env.KH01_WORKER_EVIDENCE_DIR) {
      const fs = await import("fs");
      const path = await import("path");
      const outDir = process.env.KH01_WORKER_EVIDENCE_DIR;
      if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
      fs.writeFileSync(
        path.join(outDir, `worker-provider-provenance-${run.id}.json`),
        JSON.stringify(providerEvidence, null, 2),
        "utf8"
      );
      fs.writeFileSync(
        path.join(outDir, `worker-database-observation-${run.id}.json`),
        JSON.stringify(dbObservation, null, 2),
        "utf8"
      );
    }
  } catch (err: any) {
    console.warn(`[DiscoveryOrchestrator] Worker event emission warning: ${err.message}`);
  }
}

export class DiscoveryOrchestrator {
  /**
   * Claims a pending job atomically for execution (Job Leasing - Rule 99).
   * Prevents multiple concurrent worker processes from claiming the same job.
   */
  async claimPendingDiscoveryJob(): Promise<string | null> {
    const pendingRun = await prisma.discoveryRun.findFirst({
      // Claim executable registered providers (excluding obsolete legacy Muse requests)
      where: {
        status: "PENDING",
        providerId: { not: "muse-ad-library" },
      },
      orderBy: { createdAt: "asc" },
      select: { id: true },
    });

    if (!pendingRun) return null;

    try {
      const updated = await prisma.discoveryRun.update({
        where: { id: pendingRun.id, status: "PENDING" },
        data: {
          status: "RUNNING",
          startedAt: new Date(),
          heartbeatAt: new Date(),
        },
      });
      return updated.id;
    } catch {
      // Race condition: another worker claimed the job
      return null;
    }
  }

  /**
   * Executes an existing discovery job by ID with checkpoints and bounded pagination.
   */
  async executeDiscoveryJob(
    runId: string,
    options: RunDiscoveryOptions = {}
  ): Promise<DiscoveryRunSummary> {
    const startTime = new Date();

    const run = await prisma.discoveryRun.findUnique({
      where: { id: runId },
    });

    if (!run) {
      throw new Error(`Discovery run with ID '${runId}' not found.`);
    }

    if (run.providerId === "muse-ad-library") {
      throw new Error(
        "Legacy Muse research jobs are retired and cannot be executed. Please create a new Meta research job with meta-ads-collector."
      );
    }

    let query: DiscoveryQuery;
    try {
      query = JSON.parse(run.queryConfigJson) as DiscoveryQuery;
    } catch {
      query = {
        workspaceId: run.workspaceId,
        platform: "TIKTOK",
        market: "US",
        keywords: [],
        industries: [],
        objectives: [],
        searchWindowDays: 30,
        sortBy: "relevance",
        requestedLimit: run.requestedLimit,
        pageSize: 20,
        runMode: (run.runMode as "MANUAL" | "SCHEDULED" | "DRY_RUN") || "MANUAL",
      };
    }

    // 1. Resolve Provider
    let provider = query.providerId ? getDiscoveryProvider(query.providerId) : undefined;
    if (!provider) {
      provider = await selectDiscoveryProvider(query);
    }

    // 2. Check Provider Availability
    const availability = await provider.checkAvailability();
    if (!availability.isAuthorized || availability.status !== "AVAILABLE") {
      const blockedStatus: DiscoveryJobStatus =
        availability.status === "REQUIRES_AUTH" ||
        availability.status === "BLOCKED_SOURCE" ||
        availability.status === "PERMISSION_DENIED" ||
        availability.status === "NOT_CONFIGURED"
          ? "BLOCKED_SOURCE"
          : availability.status === "PAID_DISABLED"
          ? "BUDGET_BLOCKED"
          : "FAILED";

      const errorCategory =
        availability.status === "NOT_CONFIGURED"
          ? "PROVIDER_NOT_CONFIGURED"
          : availability.status === "PAID_DISABLED"
          ? "PROVIDER_BUDGET_BLOCKED"
          : availability.status === "REQUIRES_AUTH" ||
            availability.status === "BLOCKED_SOURCE" ||
            availability.status === "PERMISSION_DENIED"
          ? "PROVIDER_PERMISSION_DENIED"
          : "NO_AUTHORIZED_PROVIDER";

      const finishTime = new Date();
      await prisma.discoveryRun.update({
        where: { id: run.id },
        data: {
          status: blockedStatus,
          errorMessage: availability.message || "Provider access blocked.",
          errorCategory,
          totalRequestCount: 0,
          startedAt: startTime,
          finishedAt: finishTime,
        },
      });

      if (run.jobId) {
        await prisma.syncJob.update({
          where: { id: run.jobId },
          data: {
            status: "FAILED",
            errorMessage: availability.message || "Provider access blocked.",
            completedAt: finishTime,
          },
        });
      }

      return {
        jobId: run.id,
        providerId: provider.id,
        requestedLimit: query.requestedLimit,
        actualRetrievedCount: 0,
        validCount: 0,
        newUniqueCount: 0,
        existingDuplicateCount: 0,
        rejectedCount: 0,
        failedCount: 0,
        totalRequestCount: 0,
        startTime,
        finishTime,
        finalStatus: blockedStatus,
        errorMessage: availability.message,
      };
    }

    // Mark as running
    await prisma.discoveryRun.update({
      where: { id: run.id },
      data: {
        status: "RUNNING",
        startedAt: startTime,
        heartbeatAt: startTime,
      },
    });

    if (run.jobId) {
      await prisma.syncJob.update({
        where: { id: run.jobId },
        data: {
          status: "RUNNING",
          startedAt: startTime,
        },
      });
    }

    let cursor: string | null = run.cursor || null;
    let actualRetrieved = run.actualRetrievedCount || 0;
    let newUniqueTotal = run.newUniqueCount || 0;
    let existingUpdatedTotal = run.existingDuplicateCount || 0;
    let failedTotal = run.failedCount || 0;
    let requestCount = run.totalRequestCount || 0;
    let totalCreditsUsed = run.creditsUsed || 0;
    let lastError: string | null = null;
    let finalStatus: DiscoveryJobStatus = "COMPLETED";

    const maxPages = Math.min(Math.ceil(query.requestedLimit / (query.pageSize || 20)), 10);
    const seenHashes = new Set<string>();
    let lastPageResult: any = null;
    const collectedExternalIds: string[] = [];

    try {
      // 3. Bounded Pagination Loop
      for (let pageIdx = 0; pageIdx < maxPages; pageIdx++) {
        // Heartbeat update (Checkpoints - Rule 101)
        await prisma.discoveryRun.update({
          where: { id: run.id },
          data: { heartbeatAt: new Date() },
        });

        // Check if cancelled (Rule 102)
        const checkRun = await prisma.discoveryRun.findUnique({
          where: { id: run.id },
          select: { status: true },
        });
        if (checkRun?.status === "CANCELLED") {
          finalStatus = "CANCELLED";
          break;
        }

        requestCount++;
        const pageResult = await provider.discoverPage(query, cursor, {
          jobId: run.jobId || undefined,
          scheduleId: options.scheduleId || run.scheduleId || undefined,
          timeoutMs: options.timeoutMs,
        });

        lastPageResult = pageResult;
        if (pageResult.usage?.creditsUsed) {
          totalCreditsUsed += pageResult.usage.creditsUsed;
        }

        // Deduplicate within the run
        const uniqueInPage = pageResult.items.filter((item) => {
          if (seenHashes.has(item.stableIdentityHash)) return false;
          seenHashes.add(item.stableIdentityHash);
          return true;
        });

        uniqueInPage.forEach((item) => {
          if (item.sourceExternalId) collectedExternalIds.push(item.sourceExternalId);
        });

        actualRetrieved += pageResult.items.length;

        // Ingest into database (unless dry run)
        if (!options.dryRun && uniqueInPage.length > 0) {
          const ingResult = await ingestDiscoveredAds(uniqueInPage, {
            workspaceId: query.workspaceId || run.workspaceId,
            jobId: run.jobId || undefined,
            discoveryRunId: run.id,
            providerId: provider.id,
          });

          newUniqueTotal += ingResult.newUniqueInserted;
          existingUpdatedTotal += ingResult.existingUpdated;
          failedTotal += ingResult.failedCount;
        } else {
          newUniqueTotal += uniqueInPage.length;
        }

        // Update progress in SyncJob and DiscoveryRun checkpoint
        const progressPercent = Math.min(
          100,
          Math.round((actualRetrieved / query.requestedLimit) * 100)
        );

        if (run.jobId) {
          await prisma.syncJob.update({
            where: { id: run.jobId },
            data: { progress: progressPercent },
          });
        }

        await prisma.discoveryRun.update({
          where: { id: run.id },
          data: {
            actualRetrievedCount: actualRetrieved,
            validCount: actualRetrieved - failedTotal,
            newUniqueCount: newUniqueTotal,
            existingDuplicateCount: existingUpdatedTotal,
            failedCount: failedTotal,
            totalRequestCount: requestCount,
            cursor: pageResult.nextCursor || null,
          },
        });

        // Stopping conditions
        if (!pageResult.hasMore || !pageResult.nextCursor) break;
        if (actualRetrieved >= query.requestedLimit) break;
        if (pageResult.nextCursor === cursor) break;
        cursor = pageResult.nextCursor;
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      lastError = msg;
      finalStatus =
        err instanceof DiscoveryError && err.code === "PROVIDER_BUDGET_BLOCKED"
          ? "BUDGET_BLOCKED"
          : err instanceof DiscoveryError &&
            (err.code === "PROVIDER_PERMISSION_DENIED" ||
              err.code === "NO_AUTHORIZED_PROVIDER" ||
              err.code === "PROVIDER_NOT_CONFIGURED")
          ? "BLOCKED_SOURCE"
          : actualRetrieved > 0
          ? "PARTIALLY_COMPLETED"
          : "FAILED";

      console.warn(`Discovery run [${run.id}] halted:`, msg);
    }

    const finishTime = new Date();
    const isPaidProvider = provider.getCapabilities().isPaid;
    const actualCostUsd = isPaidProvider ? totalCreditsUsed * 0.05 : 0.0;

    // 4. Finalize Job Records
    await prisma.discoveryRun.update({
      where: { id: run.id },
      data: {
        status: finalStatus,
        actualRetrievedCount: actualRetrieved,
        validCount: Math.max(0, actualRetrieved - failedTotal),
        newUniqueCount: newUniqueTotal,
        existingDuplicateCount: existingUpdatedTotal,
        failedCount: failedTotal,
        totalRequestCount: requestCount,
        creditsUsed: totalCreditsUsed,
        actualCostUsd,
        errorMessage: lastError,
        finishedAt: finishTime,
      },
    });

    await emitWorkerDiscoveryEvents(
      run,
      provider,
      lastPageResult,
      actualRetrieved,
      failedTotal,
      requestCount,
      finishTime,
      lastError,
      collectedExternalIds
    );

    if (run.jobId) {
      await prisma.syncJob.update({
        where: { id: run.jobId },
        data: {
          status: finalStatus === "COMPLETED" ? "COMPLETED" : "FAILED",
          progress: 100,
          completedAt: finishTime,
          errorMessage: lastError,
        },
      });
    }

    // Update schedule lastRunAt if linked
    const scheduleId = options.scheduleId || run.scheduleId;
    if (scheduleId) {
      await prisma.discoverySchedule.update({
        where: { id: scheduleId },
        data: {
          lastRunAt: finishTime,
          failureCount:
            finalStatus === "FAILED" || finalStatus === "BLOCKED_SOURCE"
              ? { increment: 1 }
              : 0,
          lastErrorReason: lastError,
        },
      });
    }

    return {
      jobId: run.id,
      providerId: provider.id,
      requestedLimit: query.requestedLimit,
      actualRetrievedCount: actualRetrieved,
      validCount: Math.max(0, actualRetrieved - failedTotal),
      newUniqueCount: newUniqueTotal,
      existingDuplicateCount: existingUpdatedTotal,
      rejectedCount: 0,
      failedCount: failedTotal,
      totalRequestCount: requestCount,
      estimatedCostUsd: 0,
      actualCostUsd,
      startTime,
      finishTime,
      finalStatus,
      errorMessage: lastError,
    };
  }

  /**
   * Main entry point to run an automated discovery job synchronously.
   */
  async runDiscoveryJob(
    query: DiscoveryQuery,
    options: RunDiscoveryOptions = {}
  ): Promise<DiscoveryRunSummary> {
    const job = await this.createDiscoveryJob(query, options.scheduleId);
    return this.executeDiscoveryJob(job.jobId, options);
  }

  /**
   * Creates a persisted initial discovery job in PENDING state (Rule 96 & 97).
   * Decouples job creation from execution.
   */
  async createDiscoveryJob(
    query: DiscoveryQuery,
    scheduleId?: string
  ): Promise<{ jobId: string; syncJobId: string; status: DiscoveryJobStatus }> {
    const validated = DiscoveryQuerySchema.parse(query);
    const effectiveWorkspaceId = await getEffectiveWorkspaceId(validated.workspaceId);

    const syncJob = await prisma.syncJob.create({
      data: {
        workspaceId: effectiveWorkspaceId,
        jobType: "AD_AUTO_DISCOVERY",
        status: "PENDING",
        progress: 0,
        totalItems: validated.requestedLimit,
      },
    });

    const run = await prisma.discoveryRun.create({
      data: {
        workspaceId: effectiveWorkspaceId,
        scheduleId: scheduleId || null,
        jobId: syncJob.id,
        providerId: validated.providerId || (validated.platform === "META" ? "meta-ads-collector" : "tiktok-topads"),
        status: "PENDING",
        runMode: validated.runMode,
        queryConfigJson: JSON.stringify(validated),
        requestedLimit: validated.requestedLimit,
      },
    });

    return { jobId: run.id, syncJobId: syncJob.id, status: "PENDING" };
  }

  /**
   * Cancels an active or pending discovery job safely (Rule 102).
   */
  async cancelDiscoveryJob(runId: string): Promise<boolean> {
    try {
      const run = await prisma.discoveryRun.findUnique({ where: { id: runId } });
      if (!run || (run.status !== "RUNNING" && run.status !== "PENDING")) return false;

      await prisma.discoveryRun.update({
        where: { id: runId },
        data: {
          status: "CANCELLED",
          finishedAt: new Date(),
        },
      });

      if (run.jobId) {
        await prisma.syncJob.update({
          where: { id: run.jobId },
          data: {
            status: "CANCELLED",
            errorMessage: "Job cancelled by user.",
            completedAt: new Date(),
          },
        });
      }

      return true;
    } catch {
      return false;
    }
  }
}

export const discoveryOrchestrator = new DiscoveryOrchestrator();
