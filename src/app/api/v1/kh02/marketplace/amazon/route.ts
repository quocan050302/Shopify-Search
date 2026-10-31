/**
 * GET & POST /api/v1/kh02/marketplace/amazon
 *
 * - GET: Strictly read-only endpoint returning persisted Amazon US product evidence,
 *   telemetry, and active/latest `KH02_AMAZON_VERIFY` child job status for a workspace's
 *   KH-02 research run (and optional candidateId / verifyJobId). Performs ZERO SQLite writes.
 * - POST: Enqueues a bounded `KH02_AMAZON_VERIFY` child job (1..3 product-specific Amazon US URLs)
 *   for an existing completed/partially-completed KH-02 research run in the caller's workspace.
 */

import crypto from "crypto";
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
import {
  AmazonRequestMode,
  resolveAmazonUsPolicyContext,
} from "@/services/kh02/marketplace/marketplaceEvidenceTypes";
import { validateAmazonUsProductUrl } from "@/services/kh02/marketplace/amazonUsIdentity";
import { AMAZON_PILOT_MAX_CANDIDATES_PER_RUN } from "@/services/kh02/marketplace/amazonUsBudget";

const MAX_POST_BODY_BYTES = 16_384;

function summarizeVerifyChildJob(job: any): {
  verifyJobId: string;
  targetResearchRunId: string | null;
  status: string;
  verificationStatus: string | null;
  progress: number;
  candidateIds: string[];
  candidateUrls: Record<string, string>;
  persistedCount: number;
  errorMessage: string | null;
  createdAt: string | null;
  completedAt: string | null;
} | null {
  if (!job) return null;
  let meta: any = {};
  try {
    meta = JSON.parse(job.resultJson || "{}");
  } catch {}
  return {
    verifyJobId: job.id,
    targetResearchRunId: meta.targetResearchRunId || null,
    status: job.status,
    verificationStatus:
      meta.verificationStatus ||
      (job.status === "PENDING"
        ? "QUEUED"
        : job.status === "RUNNING"
        ? "PROCESSING"
        : job.status === "FAILED"
        ? "FAILED"
        : null),
    progress: typeof job.progress === "number" ? job.progress : 0,
    candidateIds: Array.isArray(meta.candidateIds) ? meta.candidateIds : [],
    candidateUrls:
      meta.candidateUrls && typeof meta.candidateUrls === "object"
        ? meta.candidateUrls
        : {},
    persistedCount: typeof meta.persistedCount === "number" ? meta.persistedCount : 0,
    errorMessage: job.errorMessage || null,
    createdAt: job.createdAt ? new Date(job.createdAt).toISOString() : meta.createdAt || null,
    completedAt: job.completedAt
      ? new Date(job.completedAt).toISOString()
      : meta._runtime?.completedAt || null,
  };
}

export async function GET(request: NextRequest) {
  try {
    const context = await resolveAuthorizedResearchContext(request);
    const sp = request.nextUrl.searchParams;
    const requestedRunId = sp.get("runId")?.trim() || null;
    const requestedCandidateId = sp.get("candidateId")?.trim() || null;
    const requestedVerifyJobId = sp.get("verifyJobId")?.trim() || null;

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
          activeVerifyJob: null,
          latestVerifyJob: null,
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

    // Read-only lookup of child KH02_AMAZON_VERIFY jobs for this workspace & researchRunId
    const childJobs = await prisma.syncJob.findMany({
      where: {
        workspaceId: targetWorkspaceId,
        jobType: "KH02_AMAZON_VERIFY",
      },
      orderBy: { createdAt: "desc" },
      take: 15,
    });

    const matchingChildJobs = childJobs
      .map(summarizeVerifyChildJob)
      .filter(
        (cj): cj is NonNullable<ReturnType<typeof summarizeVerifyChildJob>> =>
          Boolean(
            cj &&
              cj.targetResearchRunId === resolvedRunId &&
              (!requestedVerifyJobId || cj.verifyJobId === requestedVerifyJobId)
          )
      );

    const activeVerifyJob =
      matchingChildJobs.find(
        (cj) => cj.status === "PENDING" || cj.status === "RUNNING"
      ) || null;
    const latestVerifyJob = matchingChildJobs[0] || null;

    return NextResponse.json({
      success: true,
      data: {
        workspaceId: targetWorkspaceId,
        researchRunId: resolvedRunId,
        policyContext,
        marketplaceEvidence: filteredEvidence,
        marketplaceTelemetry: loaded.telemetry,
        candidateSummary,
        activeVerifyJob,
        latestVerifyJob,
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

export async function POST(request: NextRequest) {
  try {
    const context = await resolveAuthorizedResearchContext(request);
    const rawBody = await request.text();
    if (Buffer.byteLength(rawBody, "utf8") > MAX_POST_BODY_BYTES) {
      return NextResponse.json(
        {
          success: false,
          error: {
            code: "PAYLOAD_TOO_LARGE",
            message: `Request body exceeds maximum size of ${MAX_POST_BODY_BYTES} bytes.`,
          },
        },
        { status: 413 }
      );
    }

    let body: any = {};
    try {
      body = rawBody ? JSON.parse(rawBody) : {};
    } catch {
      return NextResponse.json(
        {
          success: false,
          error: {
            code: "INVALID_JSON_BODY",
            message: "Request body must be valid JSON.",
          },
        },
        { status: 400 }
      );
    }

    const researchRunId =
      typeof body?.researchRunId === "string" ? body.researchRunId.trim() : "";
    if (!researchRunId) {
      return NextResponse.json(
        {
          success: false,
          error: {
            code: "INVALID_RESEARCH_RUN_ID",
            message: "A valid 'researchRunId' is required.",
          },
        },
        { status: 400 }
      );
    }

    const rawCandidateUrls = body?.candidateUrls;
    if (
      !rawCandidateUrls ||
      typeof rawCandidateUrls !== "object" ||
      Array.isArray(rawCandidateUrls)
    ) {
      return NextResponse.json(
        {
          success: false,
          error: {
            code: "INVALID_CANDIDATE_URLS",
            message: "'candidateUrls' must be a non-empty map of { [candidateId]: amazonProductUrl }.",
          },
        },
        { status: 400 }
      );
    }

    const entries = Object.entries(rawCandidateUrls).filter(
      ([k, v]) => typeof k === "string" && k.trim().length > 0 && typeof v === "string"
    ) as Array<[string, string]>;

    if (entries.length === 0) {
      return NextResponse.json(
        {
          success: false,
          error: {
            code: "INVALID_CANDIDATE_URLS",
            message: "At least 1 candidate Amazon US product URL must be provided.",
          },
        },
        { status: 400 }
      );
    }

    if (entries.length > AMAZON_PILOT_MAX_CANDIDATES_PER_RUN) {
      return NextResponse.json(
        {
          success: false,
          error: {
            code: "CANDIDATE_URL_CAP_EXCEEDED",
            message: `At most ${AMAZON_PILOT_MAX_CANDIDATES_PER_RUN} candidate Amazon US product URLs may be verified per request (received ${entries.length}).`,
          },
        },
        { status: 400 }
      );
    }

    // Look up parent KH02_RESEARCH run and verify workspace ownership
    const parentJob = await prisma.syncJob.findUnique({
      where: { id: researchRunId },
      select: {
        id: true,
        workspaceId: true,
        jobType: true,
        status: true,
        resultJson: true,
      },
    });

    if (!parentJob || parentJob.jobType !== "KH02_RESEARCH") {
      return NextResponse.json(
        {
          success: false,
          error: {
            code: "RUN_NOT_FOUND",
            message: `Parent research run '${researchRunId}' was not found.`,
          },
        },
        { status: 404 }
      );
    }

    let targetWorkspaceId = context.workspaceId;
    if (parentJob.workspaceId !== context.workspaceId) {
      const headerExplicitWorkspace = request.headers.get("x-workspace-id")?.trim();
      if (
        !headerExplicitWorkspace &&
        context.principal?.allowedWorkspaceIds?.includes(parentJob.workspaceId)
      ) {
        targetWorkspaceId = parentJob.workspaceId;
      } else {
        return NextResponse.json(
          {
            success: false,
            error: {
              code: "FORBIDDEN_WORKSPACE_RUN",
              message: `Access denied: Research run '${researchRunId}' belongs to another workspace.`,
            },
          },
          { status: 403 }
        );
      }
    }

    if (
      parentJob.status !== "COMPLETED" &&
      parentJob.status !== "PARTIALLY_COMPLETED"
    ) {
      return NextResponse.json(
        {
          success: false,
          error: {
            code: "INVALID_PARENT_RUN_STATE",
            message: `Parent research run '${researchRunId}' has status '${parentJob.status}'; post-run Amazon verification requires COMPLETED or PARTIALLY_COMPLETED.`,
          },
        },
        { status: 409 }
      );
    }

    let parentResult: any = {};
    try {
      parentResult = JSON.parse(parentJob.resultJson || "{}");
    } catch {
      return NextResponse.json(
        {
          success: false,
          error: {
            code: "CORRUPT_PARENT_RESULT_JSON",
            message: "Parent research run has corrupt resultJson.",
          },
        },
        { status: 500 }
      );
    }

    const knownCandidateIds = new Set<string>();
    for (const item of [
      ...(Array.isArray(parentResult.candidates) ? parentResult.candidates : []),
      ...(Array.isArray(parentResult.topThree) ? parentResult.topThree : []),
      ...(Array.isArray(parentResult.researchShortlist?.shortlist)
        ? parentResult.researchShortlist.shortlist
        : []),
      ...(Array.isArray(parentResult.provisionalCandidates)
        ? parentResult.provisionalCandidates
        : []),
      ...(Array.isArray(parentResult.remainingCandidates)
        ? parentResult.remainingCandidates
        : []),
      ...(Array.isArray(parentResult.insufficientEvidenceCandidates)
        ? parentResult.insufficientEvidenceCandidates
        : []),
    ]) {
      const c = item?.candidate || item;
      if (c?.candidateId) knownCandidateIds.add(String(c.candidateId));
    }

    const normalizedCandidateUrls: Record<string, string> = {};
    const seenAsinToCandidate = new Map<string, string>();
    const candidateIds: string[] = [];

    for (const [rawCandId, rawUrl] of entries) {
      const candidateId = rawCandId.trim();
      if (!knownCandidateIds.has(candidateId)) {
        return NextResponse.json(
          {
            success: false,
            error: {
              code: "UNKNOWN_CANDIDATE_FOR_RUN",
              message: `Candidate '${candidateId}' does not belong to research run '${researchRunId}'.`,
            },
          },
          { status: 400 }
        );
      }

      const hasQueryOrHash = rawUrl.includes("?") || rawUrl.includes("#");
      const urlValidation = validateAmazonUsProductUrl(rawUrl);
      if (
        hasQueryOrHash ||
        !urlValidation.valid ||
        !urlValidation.extractedAsin ||
        !urlValidation.canonicalAmazonUrl
      ) {
        return NextResponse.json(
          {
            success: false,
            error: {
              code: "INVALID_AMAZON_PRODUCT_URL",
              message: hasQueryOrHash
                ? `Amazon US product URL for candidate '${candidateId}' must not contain query or hash parameters.`
                : urlValidation.rejectionReason ||
                  `Invalid Amazon US product URL for candidate '${candidateId}'.`,
            },
          },
          { status: 400 }
        );
      }

      const existingOwner = seenAsinToCandidate.get(urlValidation.extractedAsin);
      if (existingOwner && existingOwner !== candidateId) {
        return NextResponse.json(
          {
            success: false,
            error: {
              code: "DUPLICATE_CONFLICTING_ASIN",
              message: `ASIN '${urlValidation.extractedAsin}' cannot be assigned to multiple distinct candidates ('${existingOwner}' and '${candidateId}') in the same run.`,
            },
          },
          { status: 400 }
        );
      }

      seenAsinToCandidate.set(urlValidation.extractedAsin, candidateId);
      normalizedCandidateUrls[candidateId] = urlValidation.canonicalAmazonUrl;
      candidateIds.push(candidateId);
    }

    const requestedMode: AmazonRequestMode =
      body?.requestMode === "USER_IMPORTED"
        ? "USER_IMPORTED"
        : body?.requestMode === "TEST_FIXTURE" && process.env.NODE_ENV !== "production"
        ? "TEST_FIXTURE"
        : "URL_VERIFICATION";

    const verifyJobId = `kh02_amz_verify_${Date.now().toString(36)}_${crypto
      .randomBytes(4)
      .toString("hex")}`;
    const nowIso = new Date().toISOString();
    const policyContext = resolveAmazonUsPolicyContext();

    const childPayload: Record<string, any> = {
      verifyJobId,
      targetResearchRunId: researchRunId,
      workspaceId: targetWorkspaceId,
      candidateIds,
      candidateUrls: normalizedCandidateUrls,
      requestMode: requestedMode,
      status: "PENDING",
      verificationStatus: "QUEUED",
      createdAt: nowIso,
    };

    if (
      process.env.NODE_ENV !== "production" &&
      body?.fixtureSnapshotsByUrl &&
      typeof body.fixtureSnapshotsByUrl === "object"
    ) {
      childPayload.fixtureSnapshotsByUrl = body.fixtureSnapshotsByUrl;
    }
    if (
      process.env.NODE_ENV !== "production" &&
      body?.mcpConnectOptions &&
      typeof body.mcpConnectOptions === "object"
    ) {
      childPayload.mcpConnectOptions = body.mcpConnectOptions;
    }

    await prisma.syncJob.create({
      data: {
        id: verifyJobId,
        workspaceId: targetWorkspaceId,
        jobType: "KH02_AMAZON_VERIFY",
        status: "PENDING",
        progress: 0,
        resultJson: JSON.stringify(childPayload),
      },
    });

    return NextResponse.json(
      {
        success: true,
        data: {
          verifyJobId,
          targetResearchRunId: researchRunId,
          workspaceId: targetWorkspaceId,
          status: "PENDING",
          verificationStatus: "QUEUED",
          candidateIds,
          candidateUrls: normalizedCandidateUrls,
          policyContext,
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
          code: "AMAZON_VERIFY_ENQUEUE_FAILED",
          message: err?.message || "Failed to enqueue Amazon US verification job",
        },
      },
      { status: 500 }
    );
  }
}
