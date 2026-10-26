/**
 * SWAI KH-02 — Persistent Research Runs & Ranking Snapshots
 *
 * Implements persistent, workspace-isolated research run management and
 * immutable ranking snapshots using the database syncJob model.
 *
 * Invariants:
 * 1. Strictly workspace-scoped: Cross-workspace access is rejected.
 * 2. Immutable snapshots: Past runs remain preserved when a new run executes.
 * 3. Page reloads restore the latest completed leaderboard snapshot without re-running network calls.
 * 4. Transparent statuses: PENDING, RUNNING, COMPLETED, PARTIALLY_COMPLETED, FAILED, CANCELED.
 */

import { prisma } from "@/lib/db";
import { EvergreenLeaderboardResult } from "../evergreenResearchOrchestrator";

export interface KH02RunSummary {
  runId: string;
  workspaceId: string;
  topic: string;
  status: string;
  progress: number;
  totalCandidates: number;
  topCandidateTitles: string[];
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
}

/**
 * Creates a new persistent KH-02 research run in PENDING status.
 */
export async function createKH02ResearchRun(params: {
  workspaceId: string;
  topic: string;
  market?: string;
  lookbackDays?: number;
}): Promise<string> {
  const runId = `kh02_run_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;

  await prisma.syncJob.create({
    data: {
      id: runId,
      workspaceId: params.workspaceId,
      jobType: "KH02_RESEARCH",
      status: "PENDING",
      progress: 0,
      totalItems: 0,
      resultJson: JSON.stringify({
        topic: params.topic,
        market: params.market || "US",
        lookbackDays: params.lookbackDays || 90,
      }),
      createdAt: new Date(),
    },
  });

  return runId;
}

/**
 * Updates the execution progress and status of a persistent run.
 */
export async function updateKH02ResearchRunStatus(params: {
  runId: string;
  workspaceId: string;
  status: "RUNNING" | "COMPLETED" | "PARTIALLY_COMPLETED" | "FAILED" | "CANCELED";
  progress?: number;
  errorMessage?: string;
  startedAt?: Date;
  completedAt?: Date;
}): Promise<void> {
  const data: any = {
    status: params.status,
  };
  if (params.progress !== undefined) data.progress = params.progress;
  if (params.errorMessage !== undefined) data.errorMessage = params.errorMessage;
  if (params.startedAt) data.startedAt = params.startedAt;
  if (params.completedAt) data.completedAt = params.completedAt;

  await prisma.syncJob.updateMany({
    where: {
      id: params.runId,
      workspaceId: params.workspaceId,
      jobType: "KH02_RESEARCH",
    },
    data,
  });
}

/**
 * Persists the final immutable leaderboard ranking snapshot to the research run.
 */
export async function persistKH02RankingSnapshot(
  runId: string,
  workspaceId: string,
  result: EvergreenLeaderboardResult
): Promise<void> {
  await prisma.syncJob.updateMany({
    where: {
      id: runId,
      workspaceId,
      jobType: "KH02_RESEARCH",
    },
    data: {
      status: result.runStatus === "FAILED" ? "FAILED" : (result.runStatus === "PARTIAL" ? "PARTIALLY_COMPLETED" : "COMPLETED"),
      progress: 100,
      totalItems: result.totalCandidatesDiscovered,
      resultJson: JSON.stringify(result),
      completedAt: new Date(),
    },
  });
}

/**
 * Restores the latest completed leaderboard snapshot for a workspace.
 */
export async function getKH02Leaderboard(
  workspaceId: string
): Promise<EvergreenLeaderboardResult | null> {
  const latestJob = await prisma.syncJob.findFirst({
    where: {
      workspaceId,
      jobType: "KH02_RESEARCH",
      status: { in: ["COMPLETED", "PARTIALLY_COMPLETED"] },
    },
    orderBy: {
      completedAt: "desc",
    },
  });

  if (!latestJob?.resultJson) return null;

  try {
    return JSON.parse(latestJob.resultJson) as EvergreenLeaderboardResult;
  } catch {
    return null;
  }
}

/**
 * Retrieves research run history for a workspace.
 */
export async function getKH02ResearchRuns(
  workspaceId: string
): Promise<KH02RunSummary[]> {
  const jobs = await prisma.syncJob.findMany({
    where: {
      workspaceId,
      jobType: "KH02_RESEARCH",
    },
    orderBy: {
      createdAt: "desc",
    },
    take: 30,
  });

  return jobs.map((job) => {
    let topic = "General Research";
    let totalCandidates = job.totalItems || 0;
    let topCandidateTitles: string[] = [];

    if (job.resultJson) {
      try {
        const parsed = JSON.parse(job.resultJson);
        if (parsed.topic) topic = parsed.topic;
        if (Array.isArray(parsed.topThree)) {
          topCandidateTitles = parsed.topThree.map((item: any) => item.candidate?.title || "Product Candidate");
        }
      } catch {}
    }

    return {
      runId: job.id,
      workspaceId: job.workspaceId,
      topic,
      status: job.status,
      progress: job.progress,
      totalCandidates,
      topCandidateTitles,
      startedAt: job.startedAt ? job.startedAt.toISOString() : null,
      completedAt: job.completedAt ? job.completedAt.toISOString() : null,
      createdAt: job.createdAt.toISOString(),
    };
  });
}

/**
 * Retrieves an exact research run by ID for an authorized workspace.
 */
export async function getKH02ResearchRunById(
  runId: string,
  workspaceId: string
): Promise<{
  runId: string;
  workspaceId: string;
  status: string;
  progress: number;
  result: EvergreenLeaderboardResult | null;
  createdAt: string;
} | null> {
  const job = await prisma.syncJob.findFirst({
    where: {
      id: runId,
      workspaceId,
      jobType: "KH02_RESEARCH",
    },
  });

  if (!job) return null;

  let result: EvergreenLeaderboardResult | null = null;
  if (job.resultJson) {
    try {
      result = JSON.parse(job.resultJson);
    } catch {}
  }

  return {
    runId: job.id,
    workspaceId: job.workspaceId,
    status: job.status,
    progress: job.progress,
    result,
    createdAt: job.createdAt.toISOString(),
  };
}
