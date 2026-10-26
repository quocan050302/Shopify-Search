/**
 * GET /api/v1/kh02/worker/status
 *
 * Exposes authoritative, database-persisted worker health, heartbeat, and queue metrics
 * across processes so Next.js HTTP server and the frontend UI can verify worker presence.
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSharedResearchWorkerHealth } from "@/workers/kh02Worker";
import {
  resolveAuthorizedResearchContext,
  ResearchAuthError,
} from "@/services/research/researchAuthService";

export async function GET(request: NextRequest) {
  try {
    const context = await resolveAuthorizedResearchContext(request);
    const workerHealth = await getSharedResearchWorkerHealth(prisma);

    const [pendingCount, runningCount] = await Promise.all([
      prisma.syncJob.count({
        where: { jobType: "KH02_RESEARCH", status: "PENDING" },
      }),
      prisma.syncJob.count({
        where: { jobType: "KH02_RESEARCH", status: "RUNNING" },
      }),
    ]);

    return NextResponse.json({
      success: true,
      data: {
        worker: workerHealth,
        queue: {
          pendingCount,
          runningCount,
        },
      },
      meta: {
        workspaceId: context.workspaceId,
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
          code: "WORKER_STATUS_CHECK_FAILED",
          message: err.message || "Failed to retrieve worker status.",
        },
      },
      { status: 500 }
    );
  }
}
