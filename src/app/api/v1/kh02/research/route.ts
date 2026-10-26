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
  persistKH02RankingSnapshot,
  updateKH02ResearchRunStatus,
} from "@/services/kh02/persistence/kh02PersistenceService";

const ResearchRequestSchema = z.object({
  topic: z.string().min(2, "Topic must be at least 2 characters").max(80),
  market: z.literal("US").default("US"),
  lookbackDays: z.number().int().min(7).max(730).default(90),
  maxCandidates: z.number().int().min(3).max(50).default(15),
  mode: z.enum(["async", "sync"]).optional(),
  async: z.boolean().optional(),
});

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

    const { topic, market, lookbackDays, maxCandidates } = parseResult.data;

    const isAsync =
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
