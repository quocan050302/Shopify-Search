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
import {
  loadAmazonEvidenceForRun,
  summarizeAmazonEvidenceForProduct,
} from "@/services/kh02/marketplace/marketplaceEvidencePersistence";
import { validateAmazonUsProductUrl } from "@/services/kh02/marketplace/amazonUsIdentity";
import { AMAZON_PILOT_MAX_CANDIDATES_PER_RUN } from "@/services/kh02/marketplace/amazonUsBudget";
import {
  loadWalmartEvidenceForRun,
  summarizeWalmartEvidenceForCandidate,
} from "@/services/kh02/marketplace/walmartEvidencePersistence";

const ResearchRequestSchema = z.object({
  topic: z.string().trim().min(2, "Topic must be at least 2 characters").max(80),
  market: z.literal("US").default("US"),
  country: z.string().optional(),
  lookbackDays: z.number().int().min(7).max(730).default(90),
  maxCandidates: z.number().int().min(3).max(50).default(15),
  sourceMode: z.enum(["LIVE_WITH_CACHE_FALLBACK", "CACHE_ONLY", "LIVE_ONLY"]).optional(),
  metaExecutionPolicy: z.enum(["LIVE_FIRST", "CACHE_SUPPLEMENTED", "CACHE_ONLY", "OFFLINE_FIXTURE"]).optional(),
  enableAmazonUsPilot: z.boolean().optional(),
  amazonPilotCandidateUrls: z.record(z.string(), z.string()).optional(),
  enableWalmartUsPilot: z.boolean().optional(),
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

    const rawLeaderboard = requestedRunId
      ? targetRun?.result || null
      : targetRun?.result || (await getKH02Leaderboard(context.workspaceId));
    const resolvedRunId = targetRun?.runId || rawLeaderboard?.researchRunId || null;
    const rawStatus = targetRun?.status || (rawLeaderboard ? "COMPLETED" : null);

    let leaderboard = rawLeaderboard;
    if (leaderboard) {
      const effectiveRunId = resolvedRunId || leaderboard.researchRunId;
      let marketplaceEvidence = Array.isArray(leaderboard.marketplaceEvidence)
        ? leaderboard.marketplaceEvidence
        : [];
      let marketplaceTelemetry = leaderboard.marketplaceTelemetry || null;
      let walmartMarketplaceEvidence = Array.isArray(leaderboard.walmartMarketplaceEvidence)
        ? leaderboard.walmartMarketplaceEvidence
        : [];
      let walmartMarketplaceTelemetry = leaderboard.walmartMarketplaceTelemetry || null;

      if (effectiveRunId) {
        const loadedAmz = await loadAmazonEvidenceForRun(context.workspaceId, effectiveRunId);
        if (loadedAmz.evidenceRows.length > 0) {
          marketplaceEvidence = loadedAmz.evidenceRows;
        }
        if (!marketplaceTelemetry && loadedAmz.telemetry) {
          marketplaceTelemetry = loadedAmz.telemetry;
        }

        const loadedWmt = await loadWalmartEvidenceForRun(context.workspaceId, effectiveRunId);
        if (loadedWmt.evidenceRows.length > 0) {
          walmartMarketplaceEvidence = loadedWmt.evidenceRows;
        }
        if (!walmartMarketplaceTelemetry && loadedWmt.telemetry) {
          walmartMarketplaceTelemetry = loadedWmt.telemetry;
        }
      }

      if (marketplaceEvidence.length > 0 && effectiveRunId) {
        const attachSummaryToList = (list: any[] | undefined) => {
          if (!Array.isArray(list)) return;
          for (const item of list) {
            const cand = item?.candidate || item;
            if (!cand || !cand.candidateId) continue;
            const summary = summarizeAmazonEvidenceForProduct(
              cand.candidateId,
              effectiveRunId,
              marketplaceEvidence,
              { telemetry: marketplaceTelemetry }
            );
            if (summary.visible) {
              cand.amazonEvidenceSummary = summary;
            }
          }
        };
        attachSummaryToList(leaderboard.topThree);
        attachSummaryToList(leaderboard.researchShortlist?.shortlist);
        attachSummaryToList(leaderboard.provisionalCandidates);
        attachSummaryToList(leaderboard.remainingCandidates);
        attachSummaryToList(leaderboard.insufficientEvidenceCandidates);
      }

      if ((walmartMarketplaceEvidence.length > 0 || walmartMarketplaceTelemetry) && effectiveRunId) {
        const attachWalmartSummaryToList = (list: any[] | undefined) => {
          if (!Array.isArray(list)) return;
          for (const item of list) {
            const cand = item?.candidate || item;
            if (!cand || !cand.candidateId) continue;
            const wSummary = summarizeWalmartEvidenceForCandidate(
              cand.candidateId,
              effectiveRunId,
              walmartMarketplaceEvidence,
              { telemetry: walmartMarketplaceTelemetry }
            );
            if (wSummary.visible) {
              cand.walmartEvidenceSummary = wSummary;
            }
          }
        };
        attachWalmartSummaryToList(leaderboard.topThree);
        attachWalmartSummaryToList(leaderboard.researchShortlist?.shortlist);
        attachWalmartSummaryToList(leaderboard.provisionalCandidates);
        attachWalmartSummaryToList(leaderboard.remainingCandidates);
        attachWalmartSummaryToList(leaderboard.insufficientEvidenceCandidates);
      }

      const metaTel = leaderboard.providerTelemetry?.META_ADS;
      const googleTel = leaderboard.providerTelemetry?.GOOGLE_ADS;
      const lookbackCov = leaderboard.lookbackCoverage;
      const obsList = Array.isArray(leaderboard.sourceObservations)
        ? leaderboard.sourceObservations
        : [];
      const metaLiveCount =
        leaderboard.sourceCoverage?.META_ADS?.freshLiveAdsCount ??
        metaTel?.freshLiveCount ??
        lookbackCov?.freshLiveAdsCount ??
        obsList.filter((o: any) => o?.source === "META_ADS" && o?.provenance === "LIVE_PROVIDER").length;
      const metaCachedCount =
        leaderboard.sourceCoverage?.META_ADS?.historicalCachedAdsCount ??
        metaTel?.cachedRecordsCount ??
        lookbackCov?.historicalCachedAdsCount ??
        obsList.filter((o: any) => o?.source === "META_ADS" && o?.provenance !== "LIVE_PROVIDER").length;

      const googleLiveCount =
        leaderboard.sourceCoverage?.GOOGLE_ADS?.freshLiveAdsCount ??
        leaderboard.sourceCoverage?.GOOGLE_ADS_TRANSPARENCY?.freshLiveAdsCount ??
        obsList.filter(
          (o: any) => o?.source === "GOOGLE_ADS" && o?.provenance === "LIVE_PROVIDER"
        ).length;
      const googleCachedCount =
        leaderboard.sourceCoverage?.GOOGLE_ADS?.historicalCachedAdsCount ??
        leaderboard.sourceCoverage?.GOOGLE_ADS_TRANSPARENCY?.historicalCachedAdsCount ??
        obsList.filter(
          (o: any) => o?.source === "GOOGLE_ADS" && o?.provenance !== "LIVE_PROVIDER"
        ).length;
      const googleCov = {
        freshLiveAdsCount: googleLiveCount,
        historicalCachedAdsCount: googleCachedCount,
        totalObservationsCount: googleLiveCount + googleCachedCount,
        queryExecuted: Boolean(googleTel?.queryExecuted),
        queryStatus:
          leaderboard.sourceStatuses?.GOOGLE_ADS || googleTel?.queryStatus || "SKIPPED",
      };
      const demandCov = leaderboard.sourceCoverage?.DEMAND_HISTORY ||
        leaderboard.sourceCoverage?.GOOGLE_TRENDS || {
          freshLiveAdsCount: 0,
          historicalCachedAdsCount: 0,
          totalObservationsCount: 0,
          queryExecuted: Boolean(leaderboard.providerTelemetry?.DEMAND_HISTORY?.queryExecuted),
          queryStatus:
            leaderboard.sourceStatuses?.DEMAND_HISTORY ||
            leaderboard.providerTelemetry?.DEMAND_HISTORY?.queryStatus ||
            "NOT_VERIFIED",
        };

      leaderboard = {
        ...leaderboard,
        researchRunId: resolvedRunId || leaderboard.researchRunId,
        marketplaceEvidence,
        marketplaceTelemetry,
        walmartMarketplaceEvidence,
        walmartMarketplaceTelemetry,
        sourceCoverage: {
          ...(leaderboard.sourceCoverage || {}),
          META_ADS: leaderboard.sourceCoverage?.META_ADS || {
            freshLiveAdsCount: metaLiveCount,
            historicalCachedAdsCount: metaCachedCount,
            totalObservationsCount: metaLiveCount + metaCachedCount,
            queryExecuted: Boolean(metaTel?.queryExecuted),
            queryStatus:
              leaderboard.sourceStatuses?.META_ADS || metaTel?.queryStatus || "NOT_CONFIGURED",
          },
          GOOGLE_ADS: googleCov,
          GOOGLE_ADS_TRANSPARENCY: googleCov,
          DEMAND_HISTORY: demandCov,
          GOOGLE_TRENDS: demandCov,
        },
      };
    }

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

    if (
      body &&
      typeof body === "object" &&
      (body.walmartJinaEndpoint !== undefined ||
        body.walmartTargetHost !== undefined ||
        body.walmartApiKey !== undefined ||
        body.jinaApiKey !== undefined ||
        body.walmartBudgetOverride !== undefined)
    ) {
      return NextResponse.json(
        {
          success: false,
          error: {
            code: "FORBIDDEN_WALMART_POLICY_OVERRIDE",
            message:
              "Client requests cannot override server-side Walmart Jina Reader endpoint, allowlist, budget, or no-key policy.",
          },
        },
        { status: 400 }
      );
    }

    if (
      body &&
      typeof body === "object" &&
      (body.amazonTargetHost !== undefined ||
        body.amazonMcpCommand !== undefined ||
        body.amazonMcpArgs !== undefined ||
        body.amazonBudgetOverride !== undefined ||
        body.amazonCreatorsApiKey !== undefined ||
        body.amazonBypassPolicy !== undefined)
    ) {
      return NextResponse.json(
        {
          success: false,
          error: {
            code: "FORBIDDEN_AMAZON_POLICY_OVERRIDE",
            message:
              "Client requests cannot override server-side Amazon US host allowlist, Playwright MCP command/flags, budget caps, or policy.",
          },
        },
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

    const {
      topic,
      market,
      lookbackDays,
      maxCandidates,
      sourceMode,
      metaExecutionPolicy,
      enableAmazonUsPilot,
      amazonPilotCandidateUrls,
      enableWalmartUsPilot,
    } = parseResult.data;

    let validatedAmazonCandidateUrls: Record<string, string> | undefined = undefined;
    if (amazonPilotCandidateUrls && typeof amazonPilotCandidateUrls === "object") {
      const urlEntries = Object.entries(amazonPilotCandidateUrls).filter(
        ([k, v]) => typeof k === "string" && k.trim().length > 0 && typeof v === "string"
      );
      if (urlEntries.length > AMAZON_PILOT_MAX_CANDIDATES_PER_RUN) {
        return NextResponse.json(
          {
            success: false,
            error: {
              code: "CANDIDATE_URL_CAP_EXCEEDED",
              message: `At most ${AMAZON_PILOT_MAX_CANDIDATES_PER_RUN} Amazon US product URLs may be supplied per research run.`,
            },
          },
          { status: 400 }
        );
      }
      validatedAmazonCandidateUrls = {};
      for (const [cid, rawUrl] of urlEntries) {
        const hasQueryOrHash = rawUrl.includes("?") || rawUrl.includes("#");
        const check = validateAmazonUsProductUrl(rawUrl);
        if (hasQueryOrHash || !check.valid || !check.canonicalAmazonUrl) {
          return NextResponse.json(
            {
              success: false,
              error: {
                code: "INVALID_AMAZON_PILOT_URL",
                message: hasQueryOrHash
                  ? `Amazon US product URL supplied for '${cid}' must not contain query or hash parameters.`
                  : check.rejectionReason ||
                    `Invalid Amazon US product URL supplied for '${cid}'.`,
              },
            },
            { status: 400 }
          );
        }
        validatedAmazonCandidateUrls[cid.trim()] = check.canonicalAmazonUrl;
      }
    }

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
        enableAmazonUsPilot,
        amazonPilotCandidateUrls: validatedAmazonCandidateUrls,
        enableWalmartUsPilot,
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
            enableAmazonUsPilot: Boolean(enableAmazonUsPilot),
            enableWalmartUsPilot: Boolean(enableWalmartUsPilot),
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
      enableAmazonUsPilot,
      amazonPilotCandidateUrls: validatedAmazonCandidateUrls,
      enableWalmartUsPilot,
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
        enableAmazonUsPilot,
        amazonPilotCandidateUrls: validatedAmazonCandidateUrls,
        enableWalmartUsPilot,
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
