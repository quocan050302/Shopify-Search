import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import {
  resolveAuthorizedResearchContext,
  assertProductWorkspaceAccess,
  ResearchAuthError,
} from "@/services/research/researchAuthService";
import { getProductAdvertisingProfile } from "@/services/research/productIdentityService";
import {
  resolveProductMediaGallery,
  validateAndNormalizeMediaUrl,
} from "@/services/kh02/media/productMediaResolver";

export interface ResearchContextResolutionInfo {
  status:
    | "MATCHED_EXPLICIT_RUN"
    | "MATCHED_RECENT_RUN"
    | "MISMATCH_CANDIDATE_NOT_IN_RUN"
    | "MISMATCH_PRODUCT_CANDIDATE_CONFLICT"
    | "NO_RESEARCH_RUN_CONTEXT";
  requestedRunId: string | null;
  requestedCandidateId: string | null;
  resolvedRunId: string | null;
  resolvedCandidateId: string | null;
  reason: string;
}

function normalizeUrlForMatch(url: string | null | undefined): string {
  if (!url || typeof url !== "string") return "";
  return url
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\/(www\.)?/, "")
    .replace(/\?.*$/, "")
    .replace(/#.*$/, "")
    .replace(/\/+$/, "");
}

function extractAllCandidatesFromSnapshot(parsed: any): any[] {
  if (!parsed || typeof parsed !== "object") return [];
  const rawList: any[] = [
    ...(Array.isArray(parsed.topThree) ? parsed.topThree : []),
    ...(Array.isArray(parsed.provisionalCandidates) ? parsed.provisionalCandidates : []),
    ...(Array.isArray(parsed.remainingCandidates) ? parsed.remainingCandidates : []),
    ...(Array.isArray(parsed.insufficientEvidenceCandidates)
      ? parsed.insufficientEvidenceCandidates
      : []),
    ...(Array.isArray(parsed.rejectedCandidates) ? parsed.rejectedCandidates : []),
  ];
  const shortListItems = Array.isArray(parsed.researchShortlist?.shortlist)
    ? parsed.researchShortlist.shortlist.map((c: any) => ({
        rank: null,
        candidate: c,
        score: c.score || null,
      }))
    : [];

  const seen = new Set<string>();
  const combined: any[] = [];
  for (const item of [...rawList, ...shortListItems]) {
    const c = item?.candidate || item;
    const cid = c?.candidateId;
    if (!cid || seen.has(cid)) continue;
    seen.add(cid);
    combined.push(item?.candidate ? item : { rank: null, candidate: c, score: c?.score || null });
  }
  return combined;
}

export async function GET(
  request: NextRequest,
  props: { params: Promise<{ id: string }> }
) {
  try {
    const context = await resolveAuthorizedResearchContext(request);
    const { id: rawParamId } = await props.params;
    const requestedRunId = request.nextUrl.searchParams.get("runId")?.trim() || null;
    const requestedCandidateId =
      request.nextUrl.searchParams.get("candidateId")?.trim() || null;

    // 1. V12.4.3.2.1 Section 7.1 & 7.3: Validate explicit runId existence and workspace ownership first
    let explicitRunJob: any = null;
    if (requestedRunId) {
      explicitRunJob = await prisma.syncJob.findUnique({
        where: { id: requestedRunId },
      });
      if (!explicitRunJob || explicitRunJob.jobType !== "KH02_RESEARCH") {
        throw new ResearchAuthError(
          `Requested research run '${requestedRunId}' was not found.`,
          "RUN_NOT_FOUND",
          404
        );
      }
      if (
        explicitRunJob.workspaceId &&
        explicitRunJob.workspaceId !== context.workspaceId
      ) {
        throw new ResearchAuthError(
          `Access denied: Research run '${requestedRunId}' belongs to another workspace.`,
          "FORBIDDEN_WORKSPACE_RUN",
          403
        );
      }
    }

    // 2. Load recent KH-02 jobs in the caller's authorized workspace
    const recentKh02Jobs = await prisma.syncJob.findMany({
      where: {
        workspaceId: context.workspaceId,
        jobType: "KH02_RESEARCH",
        status: { in: ["COMPLETED", "PARTIALLY_COMPLETED"] },
      },
      orderBy: { createdAt: "desc" },
      take: 30,
    });

    // 3. Check if rawParamId already resolves to a ResearchProduct, or if it is a KH-02 candidateId (cand_...)
    //    whose researchProductId was null when persisted.
    let resolvedProductId = rawParamId;
    let virtualProductFromCandidate: any = null;
    const productCheck = await prisma.researchProduct.findUnique({
      where: { id: resolvedProductId },
      select: { id: true },
    });

    if (!productCheck) {
      // Only search the explicitly requested run if runId was specified; otherwise search authorized workspace runs
      const jobsToSearchForCandidate = explicitRunJob ? [explicitRunJob] : recentKh02Jobs;
      for (const job of jobsToSearchForCandidate) {
        if (!job?.resultJson) continue;
        let parsed: any = null;
        try {
          parsed = JSON.parse(job.resultJson);
        } catch {
          continue;
        }
        const allRanked = extractAllCandidatesFromSnapshot(parsed);
        const foundItem = allRanked.find((item) => {
          const c = item?.candidate;
          if (!c) return false;
          if (c.candidateId === rawParamId || c.researchProductId === rawParamId) {
            return true;
          }
          if (
            Array.isArray(c.mergedCandidateIds) &&
            c.mergedCandidateIds.includes(rawParamId)
          ) {
            return true;
          }
          return false;
        });

        if (foundItem?.candidate) {
          if (job.workspaceId && job.workspaceId !== context.workspaceId) {
            throw new ResearchAuthError(
              `Access denied: Candidate '${rawParamId}' belongs to another workspace.`,
              "FORBIDDEN_WORKSPACE_RUN",
              403
            );
          }
          const cand = foundItem.candidate;
          if (cand.researchProductId) {
            const linkedProd = await prisma.researchProduct.findUnique({
              where: { id: cand.researchProductId },
              select: { id: true },
            });
            if (linkedProd) {
              resolvedProductId = linkedProd.id;
              break;
            }
          }

          // V12.4.3.3.1 Section 10: GET does not materialize ResearchProduct, CompetitorStore,
          // or AdProductLink records in SQLite. Perform a read-only lookup first; if not yet
          // materialized in ResearchProduct, construct a read-only in-memory projection from
          // the authorized KH-02 run candidate snapshot with zero database writes.
          const materializedId = cand.researchProductId || cand.candidateId;
          const existingProduct = await prisma.researchProduct.findUnique({
            where: { id: materializedId },
            select: { id: true },
          });
          if (existingProduct) {
            cand.researchProductId = existingProduct.id;
            resolvedProductId = existingProduct.id;
            break;
          }

          const cleanDomain = cand.storeDomain
            ? String(cand.storeDomain).trim().toLowerCase().replace(/^www\./, "")
            : null;
          const existingStore = cleanDomain
            ? await prisma.competitorStore.findFirst({
                where: { domain: cleanDomain },
              })
            : null;
          const rawExistingAds =
            Array.isArray(cand.supportingAdIds) && cand.supportingAdIds.length > 0
              ? await prisma.competitorAd.findMany({
                  where: { id: { in: cand.supportingAdIds } },
                  include: {
                    mediaAssets: true,
                    advertiser: true,
                    observations: { take: 5, orderBy: { observedAt: "desc" } },
                  },
                })
              : [];
          const existingAds = rawExistingAds.filter((adRec: any) => {
            if (!cleanDomain || !adRec?.landingPageUrl) return true;
            try {
              const adHost = new URL(adRec.landingPageUrl).hostname
                .toLowerCase()
                .replace(/^www\./, "");
              if (
                adHost &&
                !adHost.includes("facebook.com") &&
                !adHost.includes("instagram.com") &&
                !adHost.includes("tiktok.com") &&
                adHost !== cleanDomain &&
                !adHost.endsWith(`.${cleanDomain}`) &&
                !cleanDomain.endsWith(`.${adHost}`)
              ) {
                return false;
              }
            } catch {
              // Ignore malformed URL
            }
            return true;
          });
          const primaryImg =
            (Array.isArray(cand.imageReferences) && cand.imageReferences[0]) ||
            cand.thumbnailUrl ||
            null;

          virtualProductFromCandidate = {
            id: materializedId,
            workspaceId: job.workspaceId || context.workspaceId,
            storeId: existingStore?.id || null,
            title:
              cand.merchantVerifiedProductName ||
              cand.canonicalProductName ||
              cand.displayName ||
              cand.title ||
              "Discovered Product Candidate",
            category: parsed.topic || cand.category || "Other",
            description: cand.problemStatement || null,
            imageUrl: primaryImg || null,
            productUrl: cand.canonicalProductUrl || null,
            createdAt: job.createdAt || new Date(),
            updatedAt: job.completedAt || job.createdAt || new Date(),
            metadata: {
              isVirtualCandidate: true,
              candidateId: cand.candidateId,
              identityStatus: cand.identityStatus || "PROBABLE",
            },
            store:
              existingStore ||
              (cleanDomain
                ? {
                    id: `virtual_store_${cleanDomain}`,
                    domain: cleanDomain,
                    storeName: cand.brand || cleanDomain.split(".")[0],
                    commercePlatform: "SHOPIFY_POSSIBLE",
                  }
                : null),
            adLinks: existingAds.map((adRec: any) => ({
              adId: adRec.id,
              productId: materializedId,
              confidence:
                cand.identityStatus === "VERIFIED" ? "CONFIRMED" : "PROBABLE",
              ad: adRec,
            })),
          };
          resolvedProductId = materializedId;
          break;
        }
      }
    }

    const productId = resolvedProductId;

    // 4. Enforce strict workspace access on the resolved ResearchProduct (when persisted in DB)
    if (!virtualProductFromCandidate) {
      await assertProductWorkspaceAccess(productId, context);
    }

    const product =
      virtualProductFromCandidate ||
      (await prisma.researchProduct.findUnique({
        where: { id: productId },
        include: {
          store: true,
          adLinks: {
            include: {
              ad: {
                include: {
                  mediaAssets: true,
                  advertiser: true,
                  observations: { take: 5, orderBy: { observedAt: "desc" } },
                },
              },
            },
          },
        },
      }));

    if (!product) {
      return NextResponse.json(
        { success: false, error: "Product not found", code: "PRODUCT_NOT_FOUND" },
        { status: 404 }
      );
    }

    // 5. Advertising profile & KH-01 commercial entities
    const adProfile = virtualProductFromCandidate
      ? {
          productId: product.id,
          productTitle: product.title,
          storeDomain: product.store?.domain || null,
          totalLinkedAds: Array.isArray(product.adLinks) ? product.adLinks.length : 0,
          distinctAdvertisers: Array.from(
            new Map(
              (product.adLinks || [])
                .map((l: any) => l?.ad?.advertiser)
                .filter(Boolean)
                .map((adv: any) => [adv.id, { id: adv.id, name: adv.name }])
            ).values()
          ),
          distinctStores: product.store
            ? [{ id: product.store.id, domain: product.store.domain }]
            : [],
          distinctCreativeFormats: Array.from(
            new Set(
              (product.adLinks || []).map(
                (l: any) => l?.ad?.mediaAssets?.[0]?.mediaType || "IMAGE"
              )
            )
          ),
          observedLandingPages: Array.from(
            new Set(
              (product.adLinks || [])
                .map((l: any) => l?.ad?.landingPageUrl)
                .filter(Boolean)
            )
          ),
          earliestReportedStartAt: null,
          firstObservedAt: null,
          latestObservedAt: null,
          verifiedActiveObservationsCount: Array.isArray(product.adLinks)
            ? product.adLinks.length
            : 0,
          unverifiedObservationsCount: 0,
          ads: (product.adLinks || [])
            .map((l: any) => l?.ad)
            .filter(Boolean)
            .map((ad: any) => ({
              id: ad.id,
              externalAdId: ad.externalAdId || ad.id,
              headline: ad.headline,
              status: ad.status,
              format: ad.mediaAssets?.[0]?.mediaType || "IMAGE",
              firstSeenAt: ad.firstSeenAt
                ? new Date(ad.firstSeenAt).toISOString()
                : null,
              lastSeenAt: ad.lastSeenAt
                ? new Date(ad.lastSeenAt).toISOString()
                : null,
            })),
        }
      : await getProductAdvertisingProfile(productId);

    const offerSnapshots = await prisma.competitorOfferSnapshot.findMany({
      where: { productId },
      orderBy: { observedAt: "desc" },
      take: 10,
    });

    const latestLandingPage = await prisma.landingPageSnapshot.findFirst({
      where: { productId },
      orderBy: { observedAt: "desc" },
    });

    const economicsScenarios = await prisma.productEconomicsScenario.findMany({
      where: { productId },
      orderBy: { createdAt: "desc" },
      take: 5,
    });

    const supplierQuotes = await prisma.supplierQuote.findMany({
      where: { productId },
      orderBy: { quoteDate: "desc" },
    });

    const fulfillmentAssessment = await prisma.fulfillmentAssessment.findFirst({
      where: { productId },
      orderBy: { createdAt: "desc" },
    });

    const opportunityAssessment = await prisma.productOpportunityAssessment.findFirst({
      where: { productId },
      orderBy: { createdAt: "desc" },
    });

    const evidenceRecords = await prisma.researchEvidence.findMany({
      where: { productId },
      orderBy: { observedAt: "desc" },
      take: 50,
    });

    const decisions = await prisma.researchDecision.findMany({
      where: { productId },
      orderBy: { decidedAt: "desc" },
      take: 10,
    });

    // 6. V12.4.3.2.1 Section 7: Strict ResearchRun + Candidate + Product Identity Resolution
    //    - If requestedRunId is provided, ONLY inspect explicitRunJob. Never silently fall back to another run!
    //    - Verify candidate belongs to the requested run AND corresponds to the requested product.
    const normProdUrl = normalizeUrlForMatch(product.productUrl);
    const normProdTitle = (product.title || "").trim().toLowerCase();
    const productLinkedAdIds = new Set(
      (product.adLinks || []).map((l: any) => l.adId).filter(Boolean)
    );

    const doesCandidateCorrespondToProduct = (c: any): boolean => {
      if (!c) return false;
      if (c.researchProductId && c.researchProductId === product.id) return true;
      if (c.candidateId === product.id || c.candidateId === rawParamId) return true;
      if (c.researchProductId && c.researchProductId !== product.id) {
        // Candidate explicitly linked to a DIFFERENT ResearchProduct ID -> conflict!
        return false;
      }
      const candUrl = normalizeUrlForMatch(
        c.canonicalProductUrl || c.normalizedProductUrl
      );
      if (normProdUrl && candUrl && normProdUrl === candUrl) return true;
      if (
        Array.isArray(c.supportingAdIds) &&
        c.supportingAdIds.some((aid: string) => productLinkedAdIds.has(aid))
      ) {
        return true;
      }
      const candTitle = (
        c.merchantVerifiedProductName ||
        c.canonicalProductName ||
        c.displayName ||
        c.title ||
        ""
      )
        .trim()
        .toLowerCase();
      if (!c.researchProductId && normProdTitle && candTitle && normProdTitle === candTitle) {
        return true;
      }
      return false;
    };

    const buildKh02ContextFromMatch = (job: any, parsed: any, matchedItem: any) => {
      const c = matchedItem.candidate || matchedItem;
      const s = matchedItem.score || c.score || {};
      const obsList: any[] = Array.isArray(c.sourceObservations)
        ? c.sourceObservations
        : [];
      const currentRunLiveAdsCount = obsList.filter(
        (o) => o?.provenance === "LIVE_PROVIDER"
      ).length;
      const currentRunCachedAdsCount = Math.max(
        0,
        obsList.length - currentRunLiveAdsCount
      );

      return {
        runId: job.id,
        topic: parsed.topic || "Product Research",
        market: parsed.market || "US",
        lookbackDays: parsed.lookbackDays || 90,
        sourceMode: parsed.sourceMode || "LIVE_WITH_CACHE_FALLBACK",
        candidateId: c.candidateId,
        canonicalProductName:
          c.merchantVerifiedProductName || c.canonicalProductName || c.title,
        opportunityScore: s.opportunityScore ?? null,
        evidenceConfidence: s.evidenceConfidence ?? null,
        scoreStatus: s.scoreStatus || "INSUFFICIENT_EVIDENCE",
        tier:
          s.tier ||
          (s.scoreStatus === "VERIFIED" ? "VERIFIED_EVERGREEN" : "PROVISIONAL"),
        demandClass: s.demandClass || "INSUFFICIENT_DATA",
        identityStatus: c.identityStatus || "PROBABLE",
        fetchOutcome: c.fetchOutcome || "NOT_ATTEMPTED",
        productRealityStatus:
          c.productRealityStatus || "EVIDENCE_SUPPORTED_PHYSICAL_PRODUCT",
        sourcePageClassification:
          c.sourcePageClassification || "ACTUAL_PRODUCT_PAGE",
        storeDomain: c.storeDomain || product.store?.domain || null,
        canonicalProductUrl: c.canonicalProductUrl || product.productUrl || null,
        supportingAdsCount: Array.isArray(c.supportingAdIds)
          ? c.supportingAdIds.length
          : (adProfile as any)?.distinctAdsCount ??
            (adProfile as any)?.totalAdsCount ??
            0,
        currentRunLiveAdsCount,
        currentRunCachedAdsCount,
        totalHistoricalObservations:
          c.totalObservationCount ??
          Math.max(obsList.length, product.adLinks?.length || 0),
        distinctAdvertisersCount:
          c.distinctAdvertisersCount ??
          (adProfile as any)?.distinctAdvertisersCount ??
          (adProfile as any)?.distinctAdvertisers ??
          0,
        strengths: Array.isArray(s.strengths) ? s.strengths : [],
        risks: Array.isArray(s.risks) ? s.risks : [],
        missingEvidence: Array.isArray(s.missingEvidence) ? s.missingEvidence : [],
        recommendation: s.recommendation || "PROCEED_TO_VALIDATION",
        recommendationRationale: s.recommendationRationale || null,
        verificationReason: c.verificationReason || null,
      };
    };

    let kh02ResearchContext: any = null;
    let matchedCandidateObj: any = null;
    let researchContextResolution: ResearchContextResolutionInfo = {
      status: "NO_RESEARCH_RUN_CONTEXT",
      requestedRunId,
      requestedCandidateId,
      resolvedRunId: null,
      resolvedCandidateId: null,
      reason: "No KH-02 research run context was requested or found for this product.",
    };

    if (explicitRunJob) {
      // Explicit runId was requested -> NEVER silently fall back to another run (Section 7.1)
      let parsed: any = null;
      try {
        parsed = explicitRunJob.resultJson
          ? JSON.parse(explicitRunJob.resultJson)
          : null;
      } catch {
        parsed = null;
      }
      const allRanked = extractAllCandidatesFromSnapshot(parsed);

      if (requestedCandidateId) {
        const candidateById = allRanked.find((item) => {
          const c = item?.candidate;
          if (!c) return false;
          return (
            c.candidateId === requestedCandidateId ||
            (Array.isArray(c.mergedCandidateIds) &&
              c.mergedCandidateIds.includes(requestedCandidateId))
          );
        });

        if (!candidateById) {
          researchContextResolution = {
            status: "MISMATCH_CANDIDATE_NOT_IN_RUN",
            requestedRunId,
            requestedCandidateId,
            resolvedRunId: null,
            resolvedCandidateId: null,
            reason: `Candidate '${requestedCandidateId}' was not found in explicitly requested research run '${requestedRunId}'. Did not fall back to another run.`,
          };
        } else if (!doesCandidateCorrespondToProduct(candidateById.candidate)) {
          const candTitle =
            candidateById.candidate?.canonicalProductName ||
            candidateById.candidate?.title ||
            requestedCandidateId;
          researchContextResolution = {
            status: "MISMATCH_PRODUCT_CANDIDATE_CONFLICT",
            requestedRunId,
            requestedCandidateId,
            resolvedRunId: null,
            resolvedCandidateId: null,
            reason: `Candidate '${requestedCandidateId}' ('${candTitle}') in run '${requestedRunId}' does not correspond to requested product '${product.id}' ('${product.title}'). Rejected cross-candidate contamination.`,
          };
        } else {
          matchedCandidateObj = candidateById.candidate;
          kh02ResearchContext = buildKh02ContextFromMatch(
            explicitRunJob,
            parsed,
            candidateById
          );
          researchContextResolution = {
            status: "MATCHED_EXPLICIT_RUN",
            requestedRunId,
            requestedCandidateId,
            resolvedRunId: explicitRunJob.id,
            resolvedCandidateId: matchedCandidateObj.candidateId,
            reason: `Verified explicit run '${explicitRunJob.id}' + candidate '${matchedCandidateObj.candidateId}' + product '${product.id}' relationship.`,
          };
        }
      } else {
        // Explicit runId without candidateId: match by priority (1) researchProductId, (2) canonical URL, (3) title
        const matchedInExplicitRun =
          allRanked.find(
            (item) =>
              item?.candidate?.researchProductId === product.id ||
              item?.candidate?.candidateId === product.id
          ) ||
          allRanked.find((item) => {
            const c = item?.candidate;
            if (!c || (c.researchProductId && c.researchProductId !== product.id)) {
              return false;
            }
            const candUrl = normalizeUrlForMatch(
              c.canonicalProductUrl || c.normalizedProductUrl
            );
            return Boolean(normProdUrl && candUrl && normProdUrl === candUrl);
          }) ||
          allRanked.find((item) => {
            const c = item?.candidate;
            if (!c || c.researchProductId) return false;
            return doesCandidateCorrespondToProduct(c);
          });

        if (!matchedInExplicitRun) {
          researchContextResolution = {
            status: "MISMATCH_CANDIDATE_NOT_IN_RUN",
            requestedRunId,
            requestedCandidateId: null,
            resolvedRunId: null,
            resolvedCandidateId: null,
            reason: `Product '${product.id}' was not found in explicitly requested research run '${requestedRunId}'. Did not fall back to another run.`,
          };
        } else {
          matchedCandidateObj = matchedInExplicitRun.candidate;
          kh02ResearchContext = buildKh02ContextFromMatch(
            explicitRunJob,
            parsed,
            matchedInExplicitRun
          );
          researchContextResolution = {
            status: "MATCHED_EXPLICIT_RUN",
            requestedRunId,
            requestedCandidateId: null,
            resolvedRunId: explicitRunJob.id,
            resolvedCandidateId: matchedCandidateObj.candidateId,
            reason: `Verified product '${product.id}' in explicitly requested research run '${explicitRunJob.id}'.`,
          };
        }
      }
    } else {
      // No explicit runId requested -> controlled fallback across recent workspace runs
      for (const job of recentKh02Jobs) {
        if (!job.resultJson) continue;
        let parsed: any = null;
        try {
          parsed = JSON.parse(job.resultJson);
        } catch {
          continue;
        }
        const allRanked = extractAllCandidatesFromSnapshot(parsed);

        if (requestedCandidateId) {
          const candMatch = allRanked.find(
            (item) => item?.candidate?.candidateId === requestedCandidateId
          );
          if (candMatch) {
            if (!doesCandidateCorrespondToProduct(candMatch.candidate)) {
              researchContextResolution = {
                status: "MISMATCH_PRODUCT_CANDIDATE_CONFLICT",
                requestedRunId: null,
                requestedCandidateId,
                resolvedRunId: null,
                resolvedCandidateId: null,
                reason: `Requested candidate '${requestedCandidateId}' conflicts with product '${product.id}'.`,
              };
              break;
            }
            matchedCandidateObj = candMatch.candidate;
            kh02ResearchContext = buildKh02ContextFromMatch(job, parsed, candMatch);
            researchContextResolution = {
              status: "MATCHED_RECENT_RUN",
              requestedRunId: null,
              requestedCandidateId,
              resolvedRunId: job.id,
              resolvedCandidateId: matchedCandidateObj.candidateId,
              reason: `Matched candidate '${matchedCandidateObj.candidateId}' and product '${product.id}' in recent workspace run '${job.id}'.`,
            };
            break;
          }
          continue;
        }

        const matchedItem =
          allRanked.find(
            (item) =>
              item?.candidate?.researchProductId === product.id ||
              item?.candidate?.candidateId === product.id
          ) ||
          allRanked.find((item) =>
            doesCandidateCorrespondToProduct(item?.candidate)
          );

        if (matchedItem && matchedItem.candidate) {
          matchedCandidateObj = matchedItem.candidate;
          kh02ResearchContext = buildKh02ContextFromMatch(job, parsed, matchedItem);
          researchContextResolution = {
            status: "MATCHED_RECENT_RUN",
            requestedRunId: null,
            requestedCandidateId: null,
            resolvedRunId: job.id,
            resolvedCandidateId: matchedCandidateObj.candidateId,
            reason: `Matched product '${product.id}' in recent workspace run '${job.id}'.`,
          };
          break;
        }
      }
    }

    // 7. V12.4.3.2.1 Section 3: Resolve authentic Product Media Gallery
    //    Also load any CompetitorAd + mediaAssets rows linked via candidate.supportingAdIds or canonicalProductUrl
    let linkedCompetitorAds: any[] = [];
    const candidateAdIds: string[] = Array.isArray(matchedCandidateObj?.supportingAdIds)
      ? matchedCandidateObj.supportingAdIds.filter(Boolean)
      : [];
    const candidateCanonUrl =
      matchedCandidateObj?.canonicalProductUrl || product.productUrl || null;
    const candidateHandleMatch = candidateCanonUrl
      ? candidateCanonUrl.match(/\/products\/([a-zA-Z0-9_-]+)/i)?.[1]
      : null;

    if (candidateAdIds.length > 0 || candidateHandleMatch) {
      const orClauses: any[] = [];
      if (candidateAdIds.length > 0) {
        orClauses.push({ id: { in: candidateAdIds } });
        orClauses.push({ externalAdId: { in: candidateAdIds } });
      }
      if (candidateHandleMatch) {
        orClauses.push({ landingPageUrl: { contains: `/products/${candidateHandleMatch}` } });
      }
      linkedCompetitorAds = await prisma.competitorAd.findMany({
        where: { OR: orClauses },
        include: {
          advertiser: true,
          mediaAssets: true,
        },
        take: 15,
      });
    }

    const mediaGallery = resolveProductMediaGallery({
      product,
      candidate: matchedCandidateObj,
      researchRunId: kh02ResearchContext?.runId ?? null,
      latestLandingPage,
      offerSnapshots,
      linkedCompetitorAds,
    });

    // Populate product.imageUrl on response if null in DB and verified primary media exists
    const enrichedProduct = {
      ...product,
      imageUrl:
        product.imageUrl ||
        (product as any).productImageUrl ||
        (mediaGallery.primaryMedia?.verifiedProductAssociation &&
        mediaGallery.primaryMedia?.imageUrl
          ? mediaGallery.primaryMedia.imageUrl
          : null),
      resolvedPrimaryImageUrl: mediaGallery.primaryMedia?.imageUrl || null,
      resolvedPrimaryMediaSource: mediaGallery.provenanceSummary.primarySource,
    };

    // 8. Commercial Readiness Summary (strictly KH-01 — never copies KH-02 scores)
    const commercialReadinessSummary = {
      supplierQuoteEntered: supplierQuotes.length > 0,
      landedCostCalculated: economicsScenarios.some((s: any) =>
        Boolean(s.inputsJson || s.supplierCostPerUnit !== null)
      ),
      shippingEstimateEntered: economicsScenarios.some((s: any) =>
        Boolean(s.inputsJson || s.actualShippingCostPaid !== null)
      ),
      marginModelCompleted: economicsScenarios.length > 0,
      competitorOfferInspected:
        offerSnapshots.length > 0 || Boolean(latestLandingPage),
      opportunityAssessed: Boolean(opportunityAssessment),
      completedCount: [
        supplierQuotes.length > 0,
        economicsScenarios.length > 0,
        offerSnapshots.length > 0 || Boolean(latestLandingPage),
        Boolean(opportunityAssessment),
      ].filter(Boolean).length,
      totalSteps: 4,
      statusLabel:
        opportunityAssessment &&
        supplierQuotes.length > 0 &&
        economicsScenarios.length > 0
          ? "Commercial Model Complete"
          : "Commercial Validation Needed",
    };

    return NextResponse.json({
      success: true,
      data: {
        product: enrichedProduct,
        mediaGallery,
        researchContextResolution,
        advertisingProfile: adProfile,
        offerSnapshots,
        latestLandingPage,
        economicsScenarios,
        supplierQuotes,
        fulfillmentAssessment,
        opportunityAssessment,
        evidenceRecords,
        decisions,
        kh02ResearchContext,
        commercialReadinessSummary,
      },
      meta: {
        timestamp: new Date().toISOString(),
        version: "12.4.3.3.1",
      },
    });
  } catch (err: any) {
    if (err instanceof ResearchAuthError) {
      return NextResponse.json(
        { success: false, error: err.message, code: err.code },
        { status: err.statusCode }
      );
    }
    console.error("[Research Product Overview Error]:", err);
    return NextResponse.json(
      { success: false, error: err?.message || "Internal server error" },
      { status: 500 }
    );
  }
}
