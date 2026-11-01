/**
 * SWAI KH-02 V12.4.3.5.1 — Walmart US Marketplace Evidence API Route
 *
 * GET /api/v1/kh02/marketplace/walmart?runId=<runId>[&candidateId=<candidateId>]
 *   - Strictly read-only: zero database writes, zero network calls, zero rescoring.
 *   - Enforces workspace isolation (403 on cross-workspace run, 404 on unknown run).
 *   - Returns server-side `policy` (`resolveWalmartUsPilotPolicy`), persisted `walmartMarketplaceEvidence`,
 *     `walmartMarketplaceTelemetry`, and `summariesByCandidateId`.
 *
 * POST /api/v1/kh02/marketplace/walmart
 *   - Optional bounded asynchronous child job (`KH02_WALMART_VERIFY`) for manual per-candidate recheck.
 *   - Strictly enforces server-side flags (`KH02_WALMART_US_ENABLED`), workspace ownership,
 *     and digit-only Walmart `itemId` validation.
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import {
  ResearchAuthError,
  resolveAuthorizedResearchContext,
} from "@/services/research/researchAuthService";
import { resolveWalmartUsPilotPolicy } from "@/services/kh02/marketplace/walmartJinaPolicy";
import { validateWalmartItemIdString } from "@/services/kh02/marketplace/walmartJinaReaderClient";
import {
  loadWalmartEvidenceForRun,
  summarizeWalmartEvidenceForCandidate,
} from "@/services/kh02/marketplace/walmartEvidencePersistence";
import { WalmartEvidenceSummary } from "@/services/kh02/marketplace/walmartJinaTypes";

const WalmartVerifyPostSchema = z.object({
  runId: z.string().trim().min(3).max(120),
  candidateIds: z.array(z.string().trim().min(1).max(120)).min(1).max(3),
  candidateItemIds: z.record(z.string(), z.string()).optional(),
});

function extractCandidateIdsFromSnapshot(parsed: any): string[] {
  if (!parsed || typeof parsed !== "object") return [];
  const rawLists = [
    parsed.topThree,
    parsed.researchShortlist?.shortlist,
    parsed.provisionalCandidates,
    parsed.remainingCandidates,
    parsed.insufficientEvidenceCandidates,
  ];
  const ids = new Set<string>();
  for (const list of rawLists) {
    if (!Array.isArray(list)) continue;
    for (const item of list) {
      const c = item?.candidate || item;
      if (c && typeof c.candidateId === "string" && c.candidateId.trim()) {
        ids.add(c.candidateId.trim());
      }
    }
  }
  return Array.from(ids);
}

export async function GET(request: NextRequest) {
  try {
    const context = await resolveAuthorizedResearchContext(request);
    const sp = request.nextUrl.searchParams;
    const runId = sp.get("runId")?.trim() || null;
    const candidateId = sp.get("candidateId")?.trim() || null;
    const rawPolicy = resolveWalmartUsPilotPolicy();
    const policy = {
      ...rawPolicy,
      enabled: rawPolicy.featureEnabled,
      disabledReason: rawPolicy.reason,
      maxOperationsPerRun: rawPolicy.limits.maxLogicalOperationsPerRun,
      maxAttemptsPerOperation: rawPolicy.limits.maxAttemptsPerOperation,
      maxRequestsPerMinute: rawPolicy.limits.maxRequestsPerMinuteAcrossWorkers,
    };

    // If no runId requested, return server-side Walmart pilot policy read-only
    if (!runId) {
      return NextResponse.json({
        success: true,
        data: {
          provider: "WALMART_US",
          runId: null,
          workspaceId: context.workspaceId,
          policy,
          walmartMarketplaceEvidence: [],
          walmartMarketplaceTelemetry: null,
          telemetry: null,
          summariesByCandidateId: {},
          candidateSummaries: [],
        },
      });
    }

    const runJob = await prisma.syncJob.findUnique({
      where: { id: runId },
      select: {
        id: true,
        workspaceId: true,
        jobType: true,
        status: true,
        resultJson: true,
      },
    });

    if (!runJob || runJob.jobType !== "KH02_RESEARCH") {
      return NextResponse.json(
        {
          success: false,
          error: {
            code: "RUN_NOT_FOUND",
            message: `Research run '${runId}' was not found.`,
          },
        },
        { status: 404 }
      );
    }

    if (runJob.workspaceId && runJob.workspaceId !== context.workspaceId) {
      return NextResponse.json(
        {
          success: false,
          error: {
            code: "FORBIDDEN_WORKSPACE_RUN",
            message: `Research run '${runId}' belongs to another workspace.`,
          },
        },
        { status: 403 }
      );
    }

    let parsedSnapshot: any = null;
    if (runJob.resultJson) {
      try {
        parsedSnapshot = JSON.parse(runJob.resultJson);
      } catch {
        parsedSnapshot = null;
      }
    }

    const snapshotCandidateIds = extractCandidateIdsFromSnapshot(parsedSnapshot);
    if (
      candidateId &&
      snapshotCandidateIds.length > 0 &&
      !snapshotCandidateIds.includes(candidateId)
    ) {
      return NextResponse.json(
        {
          success: false,
          error: {
            code: "CANDIDATE_NOT_FOUND_IN_RUN",
            message: `Candidate '${candidateId}' was not found in research run '${runId}'.`,
          },
        },
        { status: 404 }
      );
    }

    const loaded = await loadWalmartEvidenceForRun(
      context.workspaceId,
      runId,
      prisma
    );

    const filteredEvidence = candidateId
      ? loaded.evidenceRows.filter((r) => r.candidateId === candidateId)
      : loaded.evidenceRows;

    const targetCandidateIds = candidateId
      ? [candidateId]
      : Array.from(
          new Set([
            ...snapshotCandidateIds,
            ...loaded.evidenceRows.map((r) => r.candidateId),
          ])
        );

    const summariesByCandidateId: Record<string, WalmartEvidenceSummary> = {};
    for (const cid of targetCandidateIds) {
      summariesByCandidateId[cid] = summarizeWalmartEvidenceForCandidate(
        cid,
        runId,
        loaded.evidenceRows,
        { telemetry: loaded.telemetry, policy }
      );
    }

    return NextResponse.json({
      success: true,
      data: {
        provider: "WALMART_US",
        runId,
        workspaceId: context.workspaceId,
        runStatus: runJob.status,
        policy,
        walmartMarketplaceEvidence: filteredEvidence,
        walmartMarketplaceTelemetry: loaded.telemetry,
        telemetry: loaded.telemetry,
        summariesByCandidateId,
        candidateSummaries: Object.values(summariesByCandidateId),
        candidateSummary: candidateId
          ? summariesByCandidateId[candidateId] || null
          : null,
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
          code: "WALMART_EVIDENCE_READ_FAILED",
          message: err?.message || "Failed to read Walmart US evidence.",
        },
      },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const context = await resolveAuthorizedResearchContext(request);
    const policy = resolveWalmartUsPilotPolicy();

    if (!policy.featureEnabled) {
      return NextResponse.json(
        {
          success: false,
          error: {
            code: "WALMART_PILOT_DISABLED",
            message: policy.reason,
          },
        },
        { status: 403 }
      );
    }

    let body: any;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json(
        {
          success: false,
          error: {
            code: "INVALID_JSON",
            message: "Request body must be valid JSON.",
          },
        },
        { status: 400 }
      );
    }

    if (
      body &&
      typeof body === "object" &&
      (body.jinaEndpoint !== undefined ||
        body.apiKey !== undefined ||
        body.proxyUrl !== undefined)
    ) {
      return NextResponse.json(
        {
          success: false,
          error: {
            code: "FORBIDDEN_POLICY_OVERRIDE",
            message:
              "Client requests cannot override Walmart Jina Reader endpoint, proxy, or no-key policy.",
          },
        },
        { status: 400 }
      );
    }

    const parsed = WalmartVerifyPostSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        {
          success: false,
          error: {
            code: "VALIDATION_FAILED",
            message: "Invalid Walmart verification parameters.",
            details: parsed.error.format(),
          },
        },
        { status: 400 }
      );
    }

    const { runId, candidateIds, candidateItemIds } = parsed.data;

    // Validate itemIds if supplied
    const validatedItemIds: Record<string, string> = {};
    if (candidateItemIds) {
      for (const [cid, rawItemId] of Object.entries(candidateItemIds)) {
        const idCheck = validateWalmartItemIdString(rawItemId);
        if (!idCheck.valid || !idCheck.itemId) {
          return NextResponse.json(
            {
              success: false,
              error: {
                code: "INVALID_WALMART_ITEM_ID",
                message:
                  idCheck.rejectionReason ||
                  `Invalid Walmart itemId for candidate '${cid}'.`,
              },
            },
            { status: 400 }
          );
        }
        validatedItemIds[cid.trim()] = idCheck.itemId;
      }
    }

    const parentJob = await prisma.syncJob.findUnique({
      where: { id: runId },
      select: { id: true, workspaceId: true, jobType: true, status: true, resultJson: true },
    });

    if (!parentJob || parentJob.jobType !== "KH02_RESEARCH") {
      return NextResponse.json(
        {
          success: false,
          error: {
            code: "RUN_NOT_FOUND",
            message: `Parent research run '${runId}' was not found.`,
          },
        },
        { status: 404 }
      );
    }

    if (parentJob.workspaceId && parentJob.workspaceId !== context.workspaceId) {
      return NextResponse.json(
        {
          success: false,
          error: {
            code: "FORBIDDEN_WORKSPACE_RUN",
            message: `Parent research run '${runId}' belongs to another workspace.`,
          },
        },
        { status: 403 }
      );
    }

    const verifyJobId = `kh02_wmt_verify_${Date.now()}_${Math.random()
      .toString(36)
      .slice(2, 7)}`;

    await prisma.syncJob.create({
      data: {
        id: verifyJobId,
        workspaceId: context.workspaceId,
        jobType: "KH02_WALMART_VERIFY",
        status: "PENDING",
        progress: 0,
        totalItems: candidateIds.length,
        resultJson: JSON.stringify({
          targetResearchRunId: runId,
          candidateIds,
          walmartPilotItemIds: validatedItemIds,
          enableWalmartUsPilot: true,
        }),
        createdAt: new Date(),
      },
    });

    return NextResponse.json(
      {
        success: true,
        data: {
          verifyJobId,
          jobType: "KH02_WALMART_VERIFY",
          targetResearchRunId: runId,
          workspaceId: context.workspaceId,
          status: "PENDING",
          candidateIds,
          walmartPilotItemIds: validatedItemIds,
        },
      },
      { status: 202 }
    );
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
          code: "WALMART_VERIFY_ENQUEUE_FAILED",
          message: err?.message || "Failed to enqueue Walmart verification job.",
        },
      },
      { status: 500 }
    );
  }
}
