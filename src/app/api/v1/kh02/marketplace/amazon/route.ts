/**
 * GET /api/v1/kh02/marketplace/amazon
 *
 * Strictly read-only endpoint returning persisted Amazon US product evidence
 * and telemetry for a workspace's KH-02 research run (and optional candidateId).
 *
 * Invariants:
 * - Enforces workspace isolation (403 FORBIDDEN_WORKSPACE_RUN on cross-workspace access).
 * - Returns 404 RUN_NOT_FOUND when explicit runId does not exist.
 * - Performs ZERO SQLite mutations on 200, 403, or 404 responses (A19).
 * - Never fabricates timestamps or defaults when fields are null in storage.
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import {
  resolveAuthorizedResearchContext,
  ResearchAuthError,
} from "@/services/research/researchAuthService";
import {
  loadAmazonEvidenceForRun,
  summarizeAmazonEvidenceForProduct,
} from "@/services/kh02/marketplace/marketplaceEvidencePersistence";
import { resolveAmazonUsPolicyContext } from "@/services/kh02/marketplace/marketplaceEvidenceTypes";

export async function GET(request: NextRequest) {
  try {
    const context = await resolveAuthorizedResearchContext(request);
    const sp = request.nextUrl.searchParams;
    const requestedRunId = sp.get("runId")?.trim() || null;
    const requestedCandidateId = sp.get("candidateId")?.trim() || null;

    let targetWorkspaceId = context.workspaceId;
    let resolvedRunId: string | null = requestedRunId;

    if (requestedRunId) {
      const job = await prisma.syncJob.findUnique({
        where: { id: requestedRunId },
        select: { id: true, workspaceId: true, jobType: true },
      });
      if (!job || job.jobType !== "KH02_RESEARCH") {
        return NextResponse.json(
          {
            success: false,
            error: {
              code: "RUN_NOT_FOUND",
              message: `Requested research run '${requestedRunId}' was not found.`,
            },
          },
          { status: 404 }
        );
      }

      if (job.workspaceId !== context.workspaceId) {
        const headerExplicitWorkspace = request.headers.get("x-workspace-id")?.trim();
        if (
          !headerExplicitWorkspace &&
          context.principal?.allowedWorkspaceIds?.includes(job.workspaceId)
        ) {
          targetWorkspaceId = job.workspaceId;
        } else {
          return NextResponse.json(
            {
              success: false,
              error: {
                code: "FORBIDDEN_WORKSPACE_RUN",
                message: `Access denied: Research run '${requestedRunId}' belongs to another workspace.`,
              },
            },
            { status: 403 }
          );
        }
      }
    } else {
      const latestJob = await prisma.syncJob.findFirst({
        where: {
          workspaceId: targetWorkspaceId,
          jobType: "KH02_RESEARCH",
          status: { in: ["COMPLETED", "PARTIALLY_COMPLETED"] },
        },
        orderBy: { completedAt: "desc" },
        select: { id: true },
      });
      resolvedRunId = latestJob?.id || null;
    }

    const policyContext = resolveAmazonUsPolicyContext();

    if (!resolvedRunId) {
      return NextResponse.json({
        success: true,
        data: {
          workspaceId: targetWorkspaceId,
          researchRunId: null,
          policyContext,
          marketplaceEvidence: [],
          marketplaceTelemetry: null,
          candidateSummary: null,
          isLegacyRunWithoutMarketplaceEvidence: true,
        },
      });
    }

    const loaded = await loadAmazonEvidenceForRun(targetWorkspaceId, resolvedRunId, prisma);
    const filteredEvidence = requestedCandidateId
      ? loaded.evidenceRows.filter((r) => r.candidateId === requestedCandidateId)
      : loaded.evidenceRows;

    const candidateSummary = requestedCandidateId
      ? summarizeAmazonEvidenceForProduct(
          requestedCandidateId,
          resolvedRunId,
          loaded.evidenceRows,
          { policyContext, telemetry: loaded.telemetry }
        )
      : null;

    return NextResponse.json({
      success: true,
      data: {
        workspaceId: targetWorkspaceId,
        researchRunId: resolvedRunId,
        policyContext,
        marketplaceEvidence: filteredEvidence,
        marketplaceTelemetry: loaded.telemetry,
        candidateSummary,
        isLegacyRunWithoutMarketplaceEvidence: loaded.isLegacyRunWithoutMarketplaceEvidence,
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
          code: "AMAZON_EVIDENCE_READ_FAILED",
          message: err?.message || "Failed to load Amazon US marketplace evidence",
        },
      },
      { status: 500 }
    );
  }
}
