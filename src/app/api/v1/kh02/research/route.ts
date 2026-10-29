/**
 * POST /api/v1/kh02/research
 *
 * Initiates cross-platform evergreen winning product research for a topic/niche.
 * Enforces workspace isolation, creates a durable SyncJob run, and supports both
 * asynchronous accepted-job execution (HTTP 202) and synchronous execution (HTTP 200).
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  resolveAuthorizedResearchContext,
  ResearchAuthError,
} from "@/services/research/researchAuthService";
import { runEvergreenProductResearch } from "@/services/kh02/evergreenResearchOrchestrator";
import {
  createKH02ResearchRun,
  enqueueResearchJob,
  getKH02Leaderboard,
  getKH02ResearchRunById,
  getKH02ResearchRuns,
  persistKH02RankingSnapshot,
  updateKH02ResearchRunStatus,
  WorkspacePersistenceError,
} from "@/services/kh02/persistence/kh02PersistenceService";

const ResearchRequestSchema = z.object({
  topic: z.string().trim().min(2, "Topic must be at least 2 characters").max(80),
  market: z.literal("US").default("US"),
  country: z.string().optional(),
  lookbackDays: z.number().int().min(7).max(730).default(90),
  maxCandidates: z.number().int().min(3).max(50).default(15),
  sourceMode: z.enum(["LIVE_WITH_CACHE_FALLBACK", "CACHE_ONLY", "LIVE_ONLY"]).optional(),
  metaExecutionPolicy: z.enum(["LIVE_FIRST", "CACHE_SUPPLEMENTED", "CACHE_ONLY", "OFFLINE_FIXTURE"]).optional(),
  mode: z.enum(["async", "sync"]).optional(),
  async: z.boolean().optional(),
  asyncMode: z.boolean().optional(),
});

export async function GET(request: NextRequest) {
  try {
    const context = await resolveAuthorizedResearchContext(request);
    const sp = request.nextUrl.searchParams;
    const requestedRunId = sp.get("runId") || undefined;

    const rawRuns = await getKH02ResearchRuns(context.workspaceId);
    const recentRuns = rawRuns.map((r: any) => ({
      runId: r.runId,
      topic: r.topic || "General Research",
      country: "US",
      lookbackDays: 90,
      status: r.status,
      currentStage: r.status,
      progressPct: r.progress ?? 100,
      totalObservations: r.totalCandidates ?? 0,
      totalCandidates: r.totalCandidates ?? 0,
      verifiedCandidates: r.totalCandidates ?? 0,
      evergreenWinners: Array.isArray(r.topCandidateTitles) ? r.topCandidateTitles.length : 0,
      createdAt: r.createdAt,
      completedAt: r.completedAt || null,
    }));

    let targetRun: any = null;
    if (requestedRunId) {
      targetRun = await getKH02ResearchRunById(requestedRunId, context.workspaceId);
    } else if (rawRuns.length > 0) {
      const completedSummary = rawRuns.find(
        (r) => r.status === "COMPLETED" || r.status === "PARTIALLY_COMPLETED"
      );
      if (completedSummary) {
        targetRun = await getKH02ResearchRunById(completedSummary.runId, context.workspaceId);
      } else {
        targetRun = await getKH02ResearchRunById(rawRuns[0].runId, context.workspaceId);
      }
    }

    const leaderboard =
      targetRun?.result || (await getKH02Leaderboard(context.workspaceId));
    const resolvedRunId = targetRun?.runId || leaderboard?.researchRunId || null;
    const rawStatus = targetRun?.status || (leaderboard ? "COMPLETED" : null);

    let activeJob: any = null;
    if (rawStatus === "PENDING" || rawStatus === "QUEUED" || rawStatus === "RUNNING") {
      activeJob = {
        jobId: resolvedRunId,
        runId: resolvedRunId,
        status: rawStatus === "PENDING" ? "QUEUED" : rawStatus,
        stage: targetRun?.stage || targetRun?.liveness?.currentStage || rawStatus,
        progressPct: targetRun?.progress ?? 10,
        errorSummary: targetRun?.errorMessage || null,
        startedAt: targetRun?.startedAt || null,
        completedAt: targetRun?.completedAt || null,
      };
    }

    return NextResponse.json({
      success: true,
      data: {
        runId: resolvedRunId,
        status: rawStatus,
        completedAt: targetRun?.completedAt || leaderboard?.generatedAt || null,
        topic: leaderboard?.topic || targetRun?.result?.topic || null,
        leaderboard: leaderboard
          ? {
              ...leaderboard,
              researchRunId: resolvedRunId || leaderboard.researchRunId,
            }
          : null,
        activeJob,
        recentRuns,
      },
    });
  } catch (err: any) {
    if (err instanceof ResearchAuthError) {
      return NextResponse.json(
        { success: false, error: { code: err.code, message: err.message } },
        { status: err.statusCode }
      );
    }
    return NextResponse.json(
      {
        success: false,
        error: {
          code: "RESEARCH_READ_FAILED",
          message: err.message || "Failed to load research state",
        },
      },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const context = await resolveAuthorizedResearchContext(request);

    let body: any;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json(
        { success: false, error: { code: "INVALID_JSON", message: "Request body must be valid JSON." } },
        { status: 400 }
      );
    }

    const parseResult = ResearchRequestSchema.safeParse(body);
    if (!parseResult.success) {
      return NextResponse.json(
        {
          success: false,
          error: {
            code: "VALIDATION_FAILED",
            message: "Invalid research parameters",
            details: parseResult.error.format(),
          },
        },
        { status: 400 }
      );
    }

    const { topic, market, lookbackDays, maxCandidates, sourceMode, metaExecutionPolicy } = parseResult.data;

    const isAsync =
      body.asyncMode === true ||
      body.mode === "async" ||
      body.async === true ||
      request.headers.get("prefer") === "respond-async" ||
      request.nextUrl.searchParams.get("async") === "true";

    // 2. Asynchronous execution path (HTTP 202 Accepted)
    if (isAsync) {
      // 1. Create durable persistent run record in PENDING state
      const runId = await createKH02ResearchRun({
        workspaceId: context.workspaceId,
        topic,
        market,
        lookbackDays,
        maxCandidates,
        sourceMode,
        metaExecutionPolicy,
      });

      // Enqueue job for background worker consumption (Single Executor Invariant)
      await enqueueResearchJob(runId, { workspaceId: context.workspaceId });

      return NextResponse.json(
        {
          success: true,
          data: {
            runId,
            jobId: runId,
            status: "PENDING",
            topic,
            market,
            lookbackDays,
            sourceMode: sourceMode || "LIVE_WITH_CACHE_FALLBACK",
          },
          meta: {
            runId,
            workspaceId: context.workspaceId,
            actorId: context.actorId,
            timestamp: new Date().toISOString(),
          },
        },
        { status: 202 }
      );
    }

    // 3. Synchronous execution path (HTTP 200 OK) for backwards compatibility
    // In synchronous mode, the request handler acts as exclusive executor without enqueuing
    const runId = await createKH02ResearchRun({
      workspaceId: context.workspaceId,
      topic,
      market,
      lookbackDays,
      maxCandidates,
      sourceMode,
      metaExecutionPolicy,
    });

    await updateKH02ResearchRunStatus({
      runId,
      workspaceId: context.workspaceId,
      status: "RUNNING",
      progress: 10,
      startedAt: new Date(),
    });

    let result;
    try {
      result = await runEvergreenProductResearch({
        topic,
        market,
        lookbackDays,
        maxCandidates,
        sourceMode,
        metaExecutionPolicy,
        workspaceId: context.workspaceId,
        runId,
        signal: request.signal,
      });

      await persistKH02RankingSnapshot(runId, context.workspaceId, result);
    } catch (execErr: any) {
      await updateKH02ResearchRunStatus({
        runId,
        workspaceId: context.workspaceId,
        status: "FAILED",
        errorMessage: execErr.message || "Synchronous research run failed.",
        completedAt: new Date(),
      });
      throw execErr;
    }

    return NextResponse.json({
      success: true,
      data: result,
      meta: {
        runId,
        workspaceId: context.workspaceId,
        actorId: context.actorId,
        timestamp: new Date().toISOString(),
      },
    });
  } catch (err: any) {
    if (err instanceof ResearchAuthError) {
      return NextResponse.json(
        { success: false, error: { code: err.code, message: err.message } },
        { status: err.statusCode }
      );
    }

    if (
      err instanceof WorkspacePersistenceError ||
      err?.code === "WORKSPACE_NOT_FOUND" ||
      err?.code === "UNAUTHORIZED_WORKSPACE" ||
      err?.code === "NO_WORKSPACE_CONFIGURED"
    ) {
      return NextResponse.json(
        { success: false, error: { code: err.code, message: err.message } },
        { status: err.statusCode || (err.code === "WORKSPACE_NOT_FOUND" ? 404 : 400) }
      );
    }

    return NextResponse.json(
      {
        success: false,
        error: {
          code: "RESEARCH_EXECUTION_FAILED",
          message: err.message || "An unexpected error occurred during evergreen product research.",
        },
      },
      { status: 500 }
    );
  }
}
