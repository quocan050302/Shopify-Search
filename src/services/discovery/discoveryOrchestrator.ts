/**
 * SWAI V9 — Discovery Job Orchestrator & State Machine
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

export class DiscoveryOrchestrator {
  /**
   * Main entry point to run an automated discovery job.
   */
  async runDiscoveryJob(
    query: DiscoveryQuery,
    options: RunDiscoveryOptions = {}
  ): Promise<DiscoveryRunSummary> {
    const startTime = new Date();

    // 1. Resolve Provider
    let provider = query.providerId ? getDiscoveryProvider(query.providerId) : undefined;
    if (!provider) {
      provider = await selectDiscoveryProvider(query);
    }

    // 2. Check Provider Availability
    const availability = await provider.checkAvailability();
    if (!availability.isAuthorized || availability.status !== "AVAILABLE") {
      // Record blocked run in database
      const blockedStatus: DiscoveryJobStatus =
        availability.status === "REQUIRES_AUTH" || availability.status === "BLOCKED_SOURCE"
          ? "BLOCKED_SOURCE"
          : availability.status === "PAID_DISABLED"
          ? "BUDGET_BLOCKED"
          : "FAILED";

      const blockedWorkspaceId = await getEffectiveWorkspaceId(query.workspaceId);
      const run = await prisma.discoveryRun.create({
        data: {
          workspaceId: blockedWorkspaceId,
          scheduleId: options.scheduleId || null,
          providerId: provider.id,
          status: blockedStatus,
          runMode: query.runMode,
          queryConfigJson: JSON.stringify(query),
          errorMessage: availability.message || "Provider access blocked.",
          errorCategory: "NO_AUTHORIZED_PROVIDER",
          startedAt: startTime,
          finishedAt: new Date(),
        },
      });

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
        totalRequestCount: 1,
        startTime,
        finishTime: new Date(),
        finalStatus: blockedStatus,
        errorMessage: availability.message,
      };
    }

    // 3. Create Persisted Discovery Run & SyncJob
    const effectiveWorkspaceId = await getEffectiveWorkspaceId(query.workspaceId);
    const syncJob = await prisma.syncJob.create({
      data: {
        workspaceId: effectiveWorkspaceId,
        jobType: "AD_AUTO_DISCOVERY",
        status: "RUNNING",
        totalItems: query.requestedLimit,
        progress: 0,
        startedAt: startTime,
      },
    });

    const run = await prisma.discoveryRun.create({
      data: {
        workspaceId: effectiveWorkspaceId,
        scheduleId: options.scheduleId || null,
        jobId: syncJob.id,
        providerId: provider.id,
        status: "RUNNING",
        runMode: query.runMode,
        queryConfigJson: JSON.stringify(query),
        requestedLimit: query.requestedLimit,
        startedAt: startTime,
        heartbeatAt: startTime,
      },
    });

    let cursor: string | null = null;
    let actualRetrieved = 0;
    let newUniqueTotal = 0;
    let existingUpdatedTotal = 0;
    let failedTotal = 0;
    let requestCount = 0;
    let totalCreditsUsed = 0;
    let lastError: string | null = null;
    let finalStatus: DiscoveryJobStatus = "COMPLETED";

    const maxPages = Math.min(Math.ceil(query.requestedLimit / query.pageSize), 10);
    const seenHashes = new Set<string>();

    try {
      // 4. Bounded Pagination Loop
      for (let pageIdx = 0; pageIdx < maxPages; pageIdx++) {
        // Heartbeat update
        await prisma.discoveryRun.update({
          where: { id: run.id },
          data: { heartbeatAt: new Date() },
        });

        // Check if cancelled
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
          jobId: syncJob.id,
          scheduleId: options.scheduleId,
          timeoutMs: options.timeoutMs,
        });

        if (pageResult.usage?.creditsUsed) {
          totalCreditsUsed += pageResult.usage.creditsUsed;
        }

        // Deduplicate within the run
        const uniqueInPage = pageResult.items.filter((item) => {
          if (seenHashes.has(item.stableIdentityHash)) return false;
          seenHashes.add(item.stableIdentityHash);
          return true;
        });

        actualRetrieved += pageResult.items.length;

        // Ingest into database (unless dry run)
        if (!options.dryRun && uniqueInPage.length > 0) {
          const ingResult = await ingestDiscoveredAds(uniqueInPage, {
            workspaceId: query.workspaceId || "default-workspace",
            jobId: syncJob.id,
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

        await prisma.syncJob.update({
          where: { id: syncJob.id },
          data: { progress: progressPercent },
        });

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

        // Stopping conditions (Rule 56)
        if (!pageResult.hasMore || !pageResult.nextCursor) break;
        if (actualRetrieved >= query.requestedLimit) break;
        if (pageResult.nextCursor === cursor) break; // repeated cursor safeguard
        cursor = pageResult.nextCursor;
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      lastError = msg;
      finalStatus =
        err instanceof DiscoveryError && err.code === "PROVIDER_BUDGET_BLOCKED"
          ? "BUDGET_BLOCKED"
          : err instanceof DiscoveryError && (err.code === "PROVIDER_PERMISSION_DENIED" || err.code === "NO_AUTHORIZED_PROVIDER")
          ? "BLOCKED_SOURCE"
          : actualRetrieved > 0
          ? "PARTIALLY_COMPLETED"
          : "FAILED";

      console.warn(`Discovery run [${run.id}] halted:`, msg);
    }

    const finishTime = new Date();

    // 5. Finalize Job Records
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
        errorMessage: lastError,
        finishedAt: finishTime,
      },
    });

    await prisma.syncJob.update({
      where: { id: syncJob.id },
      data: {
        status: finalStatus === "COMPLETED" ? "COMPLETED" : "FAILED",
        progress: 100,
        completedAt: finishTime,
        errorMessage: lastError,
      },
    });

    // Update schedule lastRunAt if linked
    if (options.scheduleId) {
      await prisma.discoverySchedule.update({
        where: { id: options.scheduleId },
        data: {
          lastRunAt: finishTime,
          failureCount: finalStatus === "FAILED" || finalStatus === "BLOCKED_SOURCE" ? { increment: 1 } : 0,
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
      actualCostUsd: totalCreditsUsed * 0.05,
      startTime,
      finishTime,
      finalStatus,
      errorMessage: lastError,
    };
  }

  /**
   * Creates a persisted initial discovery job in PENDING state (Requirement 95).
   */
  async createDiscoveryJob(query: DiscoveryQuery): Promise<{ jobId: string; syncJobId: string; status: DiscoveryJobStatus }> {
    const validated = DiscoveryQuerySchema.parse(query);
    const effectiveWorkspaceId = await getEffectiveWorkspaceId(validated.workspaceId);
    const syncJob = await prisma.syncJob.create({
      data: {
        workspaceId: effectiveWorkspaceId,
        jobType: "AD_AUTO_DISCOVERY",
        status: "PENDING",
        progress: 0,
      },
    });

    const run = await prisma.discoveryRun.create({
      data: {
        workspaceId: effectiveWorkspaceId,
        jobId: syncJob.id,
        providerId: validated.providerId || "tiktok-topads",
        status: "PENDING",
        runMode: validated.runMode,
        queryConfigJson: JSON.stringify(validated),
        requestedLimit: validated.requestedLimit,
      },
    });

    return { jobId: run.id, syncJobId: syncJob.id, status: "PENDING" };
  }

  /**
   * Cancels an active or pending discovery job safely.
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
