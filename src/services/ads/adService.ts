import { prisma } from "@/lib/db";
import { NormalizedAdRecord } from "@/types";
import { calculateWinningPotentialScore } from "@/services/scoring/scoringEngine";
import { isSampleOrFakeMedia, isStockImage } from "@/services/links/linkValidationService";
import { calculateAdLongevityScore } from "@/services/evergreen/evergreenScoring";
import { extractDomainFromUrl } from "@/services/products/productService";
import { AdDetailViewModel, ProductEconomics, ResearchChecklist } from "@/types/adViewModel";

export interface SearchAdsFilters {
  query?: string;
  platform?: string;
  category?: string;
  market?: string;
  minScore?: number;
  status?: string;
  page?: number;
  pageSize?: number;
  sortBy?: "newest" | "score" | "longevity" | "variants";
  /** When true, include quarantined SYNTHETIC_DEMO records. Defaults to false. */
  includeSynthetic?: boolean;
  /** When provided, restricts query strictly to ads authorized for this workspace. */
  workspaceId?: string;
}

import { buildAuthorizedAdWhere } from "@/services/research/authorizedScopeHelpers";

/**
 * Searches stored competitor ads backed by real observation records.
 */
export async function searchCompetitorAds(filters: SearchAdsFilters = {}) {
  const page = Math.max(1, filters.page || 1);
  const pageSize = Math.min(50, Math.max(1, filters.pageSize || 12));
  const skip = (page - 1) * pageSize;

  const whereClause: any = {};

  if (filters.platform && filters.platform !== "ALL") {
    whereClause.platform = filters.platform.toUpperCase();
  }

  if (filters.category && filters.category !== "ALL") {
    whereClause.category = filters.category;
  }

  if (filters.status && filters.status !== "ALL") {
    whereClause.status = filters.status.toUpperCase();
  }

  // Only filter by market when explicitly requested — do NOT assume US
  if (filters.market && filters.market !== "ALL" && filters.market !== "UNKNOWN") {
    whereClause.targetMarket = filters.market.toUpperCase();
  }

  if (filters.query && filters.query.trim().length > 0) {
    const q = filters.query.trim();
    whereClause.OR = [
      { headline: { contains: q } },
      { bodyText: { contains: q } },
      { advertiser: { name: { contains: q } } },
      { category: { contains: q } },
    ];
  }

  // Exclude quarantined SYNTHETIC_DEMO records from production results by default
  // These records have UNAVAILABLE dataConfidence and [SYNTHETIC_DEMO] headline prefix
  if (!filters.includeSynthetic) {
    whereClause.dataConfidence = { not: "UNAVAILABLE" };
    // Additional guard: exclude headlines prefixed with [SYNTHETIC_DEMO]
    if (!whereClause.AND) whereClause.AND = [];
    whereClause.AND.push({
      NOT: { headline: { startsWith: "[SYNTHETIC_DEMO]" } },
    });
  }

  // Enforce workspace authorization if workspaceId is specified
  if (filters.workspaceId) {
    if (!whereClause.AND) whereClause.AND = [];
    whereClause.AND.push(buildAuthorizedAdWhere(filters.workspaceId));
  }

  // Count total matching
  const total = await prisma.competitorAd.count({ where: whereClause });

  let orderBy: any = { createdAt: "desc" };
  if (filters.sortBy === "longevity") {
    orderBy = { daysRunning: "desc" };
  } else if (filters.sortBy === "newest") {
    orderBy = { firstSeenAt: "desc" };
  }
  // Note: 'score' sort is NOT implemented in DB — not exposed as a sort option

  const ads = await prisma.competitorAd.findMany({
    where: whereClause,
    skip,
    take: pageSize,
    orderBy,
    include: {
      advertiser: true,
      mediaAssets: true,
      researchScores: {
        orderBy: { createdAt: "desc" },
        take: 1,
      },
      productLinks: {
        include: { product: true },
      },
      analyses: {
        take: 1,
        orderBy: { createdAt: "desc" },
      },
    },
  });

  return {
    ads,
    pagination: {
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
    },
  };
}

/**
 * User-facing authorized search helper.
 * Strictly injects the caller's authorized workspaceId into search filters.
 */
export async function searchAuthorizedCompetitorAds(
  context: { workspaceId: string },
  filters: Omit<SearchAdsFilters, "workspaceId"> = {}
) {
  if (!context?.workspaceId) {
    throw new Error("Authorized workspace context is required to search competitor ads.");
  }
  return await searchCompetitorAds({
    ...filters,
    workspaceId: context.workspaceId,
  });
}

/**
 * Retrieves full raw Prisma details for a single competitor advertisement.
 */
export async function getAdvertisementDetails(adId: string) {
  return await prisma.competitorAd.findUnique({
    where: { id: adId },
    include: {
      advertiser: true,
      dataSource: true,
      mediaAssets: true,
      observations: { orderBy: { observedAt: "desc" } },
      metricObservations: { orderBy: { observedAt: "desc" } },
      researchScores: { orderBy: { createdAt: "desc" }, take: 1 },
      analyses: { orderBy: { createdAt: "desc" }, take: 1 },
      researchDecisions: { orderBy: { updatedAt: "desc" }, take: 1 },
      productLinks: {
        include: {
          product: {
            include: {
              store: true,
              priceHistory: { orderBy: { observedAt: "desc" }, take: 5 },
              researchDecisions: { orderBy: { updatedAt: "desc" }, take: 1 },
            },
          },
        },
      },
      notes: { orderBy: { createdAt: "desc" } },
    },
  });
}

/**
 * Retrieves full typed AdDetailViewModel for a competitor advertisement,
 * reconciling scores, media, observations, candidate products, and provenance.
 */
export async function getAdvertisementDetailViewModel(adId: string): Promise<AdDetailViewModel | null> {
  const ad = await getAdvertisementDetails(adId);
  if (!ad) return null;

  // Calculate actual Evergreen longevity score and breakdown
  const scoreResult = calculateAdLongevityScore({
    adId: ad.id,
    platform: ad.platform,
    sourceReportedStartAt: ad.sourceReportedStartAt ?? null,
    sourceReportedEndAt: ad.sourceReportedEndAt ?? null,
    isSyntheticQuarantine: ad.isSyntheticQuarantine,
    observations: ad.observations.map((o) => ({
      observedAt: new Date(o.observedAt),
      observationStatus:
        o.observationStatus === "ACTIVE" ||
        o.observationStatus === "INACTIVE" ||
        o.observationStatus === "CHECK_FAILED" ||
        o.observationStatus === "ACCESS_RESTRICTED"
          ? o.observationStatus
          : "UNKNOWN",
      confidence: o.confidence,
    })),
    // Rule 32: Do not classify MetaAdsCollector as OFFICIAL_PROVIDER solely from an ad's VERIFIED confidence
    sourceReliability:
      ad.dataSource?.name === "META_GRAPH_API" || ad.dataSource?.name === "TIKTOK_BUSINESS_API"
        ? "OFFICIAL_PROVIDER"
        : ad.dataConfidence === "VERIFIED" || ad.dataConfidence === "OBSERVED"
        ? "USER_IMPORT"
        : "UNKNOWN",
  });

  const media = ad.mediaAssets[0];

  // Calculate calendar age without falsifying missing dates
  let calendarAgeDays: number | null = null;
  if (scoreResult.calendarAgeDays != null && scoreResult.calendarAgeDays > 0) {
    calendarAgeDays = scoreResult.calendarAgeDays;
  } else if (ad.sourceReportedStartAt) {
    const diffMs = Date.now() - new Date(ad.sourceReportedStartAt).getTime();
    calendarAgeDays = Math.max(1, Math.floor(diffMs / (1000 * 60 * 60 * 24)));
  }

  // Parse Analysis
  let analysisModel: AdDetailViewModel["analysis"] = null;
  if (ad.analyses && ad.analyses.length > 0) {
    const rawAnalysis = ad.analyses[0];
    let sellingPoints: string[] = [];
    try {
      sellingPoints = JSON.parse(rawAnalysis.sellingPoints || "[]");
    } catch {}

    let weaknesses: string[] = [];
    try {
      weaknesses = JSON.parse(rawAnalysis.weaknesses || "[]");
    } catch {}

    let scriptIdeas: any = null;
    try {
      if (rawAnalysis.scriptIdeas) {
        scriptIdeas = JSON.parse(rawAnalysis.scriptIdeas);
      }
    } catch {}

    const isLegacyFake = rawAnalysis.hookQualityScore === 88 && rawAnalysis.pacingScore === 82;
    const isCopyOnly =
      isLegacyFake ||
      rawAnalysis.modelVersion?.includes("copy") ||
      !rawAnalysis.pacingScore ||
      rawAnalysis.pacingScore === 0;

    analysisModel = {
      id: rawAnalysis.id,
      modelVersion: rawAnalysis.modelVersion || "unknown",
      hookType: rawAnalysis.hookType,
      hookQualityScore: isLegacyFake ? null : rawAnalysis.hookQualityScore > 0 ? rawAnalysis.hookQualityScore : null,
      pacingScore: isLegacyFake ? null : rawAnalysis.pacingScore > 0 ? rawAnalysis.pacingScore : null,
      ctaClassification: rawAnalysis.ctaClassification,
      sellingPoints,
      weaknesses,
      scriptIdeas,
      isCopyOnly,
      rawAnalysis: rawAnalysis.rawAnalysis,
      createdAt: rawAnalysis.createdAt.toISOString(),
    };
  }

  // Parse Linked Product & Candidate Decision
  let linkedProductModel: AdDetailViewModel["linkedProduct"] = null;
  const primaryLink = ad.productLinks?.[0];
  const productRecord = primaryLink?.product;

  if (productRecord) {
    // Preserve scenario history: query all decisions for product and ad
    const allDecisions = await prisma.researchDecision.findMany({
      where: {
        OR: [
          { adId: ad.id, productId: productRecord.id },
          { productId: productRecord.id },
          { adId: ad.id },
        ],
      },
      orderBy: { decidedAt: "desc" },
    });

    const decisionRecord = allDecisions[0] || null;

    let economics: ProductEconomics | null = null;
    let checklist: ResearchChecklist | null = null;
    let algorithmRecommendation: "READY_FOR_SMALL_TEST" | "RESEARCH_MORE" | "REJECTED" | null = null;
    let userDecision: "READY_FOR_SMALL_TEST" | "RESEARCH_MORE" | "REJECTED" | null = null;

    if (decisionRecord?.notes) {
      try {
        const parsedNotes = JSON.parse(decisionRecord.notes);
        if (parsedNotes.economics) {
          economics = parsedNotes.economics;
        }
        if (parsedNotes.checklist) {
          checklist = parsedNotes.checklist;
        }
        if (parsedNotes.algorithmRecommendation) {
          algorithmRecommendation = parsedNotes.algorithmRecommendation;
        }
        if (parsedNotes.userDecision) {
          userDecision = parsedNotes.userDecision;
        }
      } catch {}
    }

    linkedProductModel = {
      id: productRecord.id,
      title: productRecord.title,
      category: productRecord.category,
      description: productRecord.description,
      imageUrl: productRecord.imageUrl,
      currentPrice: productRecord.currentPrice,
      currency: productRecord.currency,
      productUrl: productRecord.productUrl,
      store: productRecord.store
        ? {
            id: productRecord.store.id,
            domain: productRecord.store.domain,
            storeName: productRecord.store.storeName,
            commercePlatform: productRecord.store.commercePlatform,
          }
        : null,
      economics,
      checklist,
      algorithmRecommendation,
      userDecision,
      decision: (userDecision || decisionRecord?.decision || null) as any,
      notes: decisionRecord?.notes ?? null,
      priceHistory: (productRecord.priceHistory || []).map((p) => ({
        id: p.id,
        price: p.price,
        currency: p.currency,
        observedAt: p.observedAt.toISOString(),
        source: p.source,
      })),
      history: allDecisions.map((d) => ({
        id: d.id,
        decision: d.decision as any,
        notes: d.notes,
        decidedAt: d.decidedAt.toISOString(),
        createdAt: d.decidedAt.toISOString(),
      })),
    };
  }

  // Related Variants by advertiser
  const variants = await findRelatedCreativeVariants(ad.id);
  const relatedVariants: AdDetailViewModel["relatedVariants"] = variants.map((v) => {
    const vMedia = v.mediaAssets?.[0];
    return {
      id: v.id,
      headline: v.headline,
      media: vMedia
        ? {
            thumbnailUrl: vMedia.thumbnailUrl,
            mediaType: vMedia.mediaType,
            aspectRatio: vMedia.aspectRatio || "1:1",
          }
        : null,
      status: v.status,
      sourceReportedStartAt: v.sourceReportedStartAt ? v.sourceReportedStartAt.toISOString() : null,
      totalScore: v.researchScores?.[0]?.totalScore ?? null,
    };
  });

  // Collect missing fields
  const missingFields: string[] = [];
  if (!ad.sourceReportedStartAt) missingFields.push("sourceReportedStartAt");
  if (!ad.landingPageUrl) missingFields.push("landingPageUrl");
  if (!ad.headline) missingFields.push("headline");
  if (!ad.bodyText) missingFields.push("bodyText");
  if (!ad.callToAction) missingFields.push("callToAction");
  if (ad.observations.length === 0) missingFields.push("swaiObservations");
  if (!media?.thumbnailUrl) missingFields.push("mediaThumbnail");

  const storefrontDomain =
    productRecord?.store?.domain || extractDomainFromUrl(ad.landingPageUrl);

  const detailViewModel: AdDetailViewModel = {
    id: ad.id,
    externalAdId: ad.externalAdId,
    platform: ad.platform,
    headline: ad.headline,
    bodyText: ad.bodyText,
    callToAction: ad.callToAction,
    landingPageUrl: ad.landingPageUrl,
    originalAdUrl: ad.originalAdUrl,
    status: ad.status,
    lifecycleStatus: ad.lifecycleStatus,
    category: ad.category,
    targetMarket: ad.targetMarket,
    calendarAgeDays,
    ageEvidenceSource: scoreResult.ageEvidenceSource,
    sourceReportedStartAt: ad.sourceReportedStartAt ? ad.sourceReportedStartAt.toISOString() : null,
    sourceReportedEndAt: ad.sourceReportedEndAt ? ad.sourceReportedEndAt.toISOString() : null,
    firstSeenAt: ad.firstSeenAt ? ad.firstSeenAt.toISOString() : null,
    lastSeenAt: ad.lastSeenAt ? ad.lastSeenAt.toISOString() : null,
    observationCount: ad.observationCount || ad.observations.length,
    verifiedActiveCount:
      ad.verifiedActiveCount ||
      ad.observations.filter((o) => o.observationStatus === "ACTIVE" || o.isActive).length,
    advertiser: {
      id: ad.advertiser?.id,
      name: ad.advertiser?.name || "Unknown Advertiser",
      externalId: ad.advertiser?.externalId,
      platform: ad.advertiser?.platform,
      profileUrl: ad.advertiser?.profileUrl,
    },
    media: media
      ? {
          mediaType:
            media.mediaType === "IMAGE" ||
            media.mediaType === "VIDEO" ||
            media.mediaType === "CAROUSEL"
              ? media.mediaType
              : "UNKNOWN",
          videoUrl: media.videoUrl,
          embedUrl: media.embedUrl,
          thumbnailUrl: media.thumbnailUrl,
          aspectRatio: media.aspectRatio || "1:1",
          availability:
            media.availability === "READY" ||
            media.availability === "EXPIRED" ||
            media.availability === "FALLBACK_ONLY"
              ? media.availability
              : "RESTRICTED",
        }
      : null,
    score: {
      totalScore: scoreResult.totalScore,
      tier: scoreResult.tier,
      evidenceConfidence: scoreResult.evidenceConfidence,
      coverageStatus: scoreResult.coverageStatus,
      explanation: scoreResult.explanation,
    },
    scoreDetails: {
      totalScore: scoreResult.totalScore,
      tier: scoreResult.tier,
      eligible: scoreResult.eligible,
      eligibilityReason: scoreResult.eligibilityReason,
      longevityComponent: scoreResult.longevityComponent,
      observationComponent: scoreResult.observationComponent,
      coverageComponent: scoreResult.coverageComponent,
      sourceReliabilityComponent: scoreResult.sourceReliabilityComponent,
      componentWeights: scoreResult.componentWeights,
      evidenceConfidence: scoreResult.evidenceConfidence,
      longevityCategory: scoreResult.longevityCategory,
      coverageStatus: scoreResult.coverageStatus,
      calendarAgeDays: scoreResult.calendarAgeDays,
      ageEvidenceSource: scoreResult.ageEvidenceSource,
      scoreBreakdown: scoreResult.scoreBreakdown,
      availableSignals: scoreResult.availableSignals,
      missingSignals: scoreResult.missingSignals,
      formulaVersion: scoreResult.formulaVersion,
      explanation: scoreResult.explanation,
      calculatedAt: scoreResult.calculatedAt,
    },
    observations: ad.observations.map((o) => ({
      id: o.id,
      observedAt: o.observedAt.toISOString(),
      observationStatus: o.observationStatus,
      evidenceType: o.evidenceType,
      verificationMethod: o.verificationMethod,
      confidence: o.confidence,
    })),
    distinctDates: {
      sourceReportedStartAt: ad.sourceReportedStartAt ? ad.sourceReportedStartAt.toISOString() : null,
      sourceReportedEndAt: ad.sourceReportedEndAt ? ad.sourceReportedEndAt.toISOString() : null,
      firstSwaiObservationAt:
        ad.observations.length > 0
          ? ad.observations[ad.observations.length - 1].observedAt.toISOString()
          : null,
      lastSwaiObservationAt:
        ad.observations.length > 0 ? ad.observations[0].observedAt.toISOString() : null,
      firstSeenAt: ad.firstSeenAt ? ad.firstSeenAt.toISOString() : null,
      lastSeenAt: ad.lastSeenAt ? ad.lastSeenAt.toISOString() : null,
    },
    analysis: analysisModel,
    linkedProduct: linkedProductModel,
    relatedVariants,
    provenance: {
      dataSourceName: ad.dataSource?.name || "META_AD_LIBRARY",
      dataSourceDisplayName: ad.dataSource?.displayName || "Meta Ad Library",
      externalAdId: ad.externalAdId,
      originalAdUrl: ad.originalAdUrl,
      landingPageUrl: ad.landingPageUrl,
      storefrontDomain,
      dataConfidence: ad.dataConfidence,
      hasSampleMedia: isSampleOrFakeMedia(media?.videoUrl),
      hasStockThumbnail: isStockImage(media?.thumbnailUrl),
      missingFields,
    },
    isSyntheticQuarantine: ad.isSyntheticQuarantine,
  };

  return detailViewModel;
}

/**
 * Upserts a normalized competitor ad record idempotently.
 * Media defaults are honest: no sample videos, no stock images.
 */
export async function upsertCompetitorAd(record: NormalizedAdRecord) {
  // Ensure default data source exists
  let dataSource = await prisma.dataSource.findFirst({
    where: {
      name:
        record.platform === "META"
          ? "META_AD_LIBRARY"
          : record.platform === "TIKTOK"
          ? "TIKTOK_CREATIVE_CENTER"
          : "USER_OBSERVED",
    },
  });

  if (!dataSource) {
    dataSource = await prisma.dataSource.create({
      data: {
        name:
          record.platform === "META"
            ? "META_AD_LIBRARY"
            : record.platform === "TIKTOK"
            ? "TIKTOK_CREATIVE_CENTER"
            : "USER_OBSERVED",
        displayName:
          record.platform === "META"
            ? "Meta Ad Library"
            : record.platform === "TIKTOK"
            ? "TikTok Creative Center"
            : "User Observed Import",
        capabilities: JSON.stringify(["DIRECT_URL_IMPORT"]),
        supportedRegions: JSON.stringify(["GLOBAL"]),
      },
    });
  }

  // Upsert Advertiser — do NOT use "Independent Merchant" as a default
  const advertiserName =
    record.advertiserName && record.advertiserName !== "UNKNOWN"
      ? record.advertiserName
      : "UNKNOWN";

  let advertiser = await prisma.advertiser.findFirst({
    where: {
      platform: record.platform,
      name: advertiserName,
    },
  });

  if (!advertiser) {
    advertiser = await prisma.advertiser.create({
      data: {
        name: advertiserName,
        platform: record.platform,
        profileUrl: record.advertiserProfileUrl,
        domain: record.advertiserDomain,
        // Do not claim a country without evidence
        country: record.targetMarket !== "UNKNOWN" ? record.targetMarket : null,
        verifiedStatus: "OBSERVED",
      },
    });
  }

  // Days running: only calculate if firstSeen !== lastSeen, else 0
  const firstSeenMs = new Date(record.firstSeenAt).getTime();
  const lastSeenMs = new Date(record.lastSeenAt).getTime();
  const daysRunning =
    lastSeenMs > firstSeenMs
      ? Math.round((lastSeenMs - firstSeenMs) / (1000 * 60 * 60 * 24)) + 1
      : 1;

  // Check if ad exists by external ID or original URL
  let existingAd = await prisma.competitorAd.findFirst({
    where: {
      OR: [
        ...(record.externalAdId ? [{ externalAdId: record.externalAdId }] : []),
        ...(record.originalAdUrl
          ? [{ originalAdUrl: record.originalAdUrl }]
          : []),
      ],
    },
  });

  let adId: string;

  if (existingAd) {
    adId = existingAd.id;

    // Section 11: Protect source-verified data from degradation.
    // Only advance lastSeenAt if incoming observation is strictly newer.
    const incomingLastSeenMs = new Date(record.lastSeenAt).getTime();
    const existingLastSeenMs = new Date(existingAd.lastSeenAt).getTime();
    const isNewerLastSeen = incomingLastSeenMs > existingLastSeenMs;
    const effectiveLastSeen = isNewerLastSeen ? record.lastSeenAt : existingAd.lastSeenAt;

    // Preserve earliest firstSeenAt
    const incomingFirstSeenMs = new Date(record.firstSeenAt).getTime();
    const existingFirstSeenMs = new Date(existingAd.firstSeenAt).getTime();
    const effectiveFirstSeen = incomingFirstSeenMs < existingFirstSeenMs ? record.firstSeenAt : existingAd.firstSeenAt;

    // Recalculate days running based on earliest firstSeen and latest lastSeen
    const firstMs = new Date(effectiveFirstSeen).getTime();
    const lastMs = new Date(effectiveLastSeen).getTime();
    const updatedDaysRunning = lastMs > firstMs ? Math.round((lastMs - firstMs) / (1000 * 60 * 60 * 24)) + 1 : existingAd.daysRunning;

    // Do not downgrade VERIFIED data confidence with weaker observations
    const shouldUpdateConfidence =
      record.dataConfidence === "VERIFIED" ||
      (existingAd.dataConfidence !== "VERIFIED" && record.dataConfidence === "OBSERVED");

    await prisma.competitorAd.update({
      where: { id: adId },
      data: {
        firstSeenAt: effectiveFirstSeen,
        lastSeenAt: effectiveLastSeen,
        daysRunning: updatedDaysRunning,
        ...(shouldUpdateConfidence ? { dataConfidence: record.dataConfidence } : {}),
        // Only update status if new record has a definitive status and existing status is not VERIFIED active
        ...(record.status !== "UNKNOWN" ? { status: record.status } : {}),
      },
    });
  } else {
    const newAd = await prisma.competitorAd.create({
      data: {
        advertiserId: advertiser.id,
        dataSourceId: dataSource.id,
        externalAdId: record.externalAdId,
        platform: record.platform,
        targetMarket: record.targetMarket || "UNKNOWN",
        headline: record.headline,
        bodyText: record.bodyText,
        callToAction: record.callToAction,
        landingPageUrl: record.landingPageUrl,
        originalAdUrl: record.originalAdUrl,
        firstSeenAt: record.firstSeenAt,
        lastSeenAt: record.lastSeenAt,
        daysRunning,
        status: record.status || "UNKNOWN",
        category: record.category || "Other",
        dataConfidence: record.dataConfidence || "UNVERIFIED",
      },
    });
    adId = newAd.id;
  }

  // Media Asset — validate: no sample videos, no stock images
  const existingMedia = await prisma.adMediaAsset.findFirst({
    where: { adId },
  });

  if (!existingMedia) {
    const videoUrl = isSampleOrFakeMedia(record.media.videoUrl)
      ? null // Strip sample videos
      : record.media.videoUrl || null;

    const thumbnailUrl = isStockImage(record.media.thumbnailUrl)
      ? null // Strip stock images
      : record.media.thumbnailUrl || null;

    // Strip known-invalid embed URLs (Meta render_ad and TikTok Creative Center embed)
    const embedUrl =
      record.media.embedUrl?.includes("facebook.com/ads/archive/render_ad") ||
      record.media.embedUrl?.includes(
        "creativecenter/inspiration/topads/embed/"
      )
        ? null
        : record.media.embedUrl || null;

    await prisma.adMediaAsset.create({
      data: {
        adId,
        mediaType: record.media.mediaType,
        videoUrl,
        embedUrl,
        thumbnailUrl,
        aspectRatio: record.media.aspectRatio || "9:16",
        // Do NOT default duration to 30 — leave null if unknown
        durationSeconds: record.media.durationSeconds ?? null,
        // Only mark READY if we have a real, non-sample video URL
        availability:
          videoUrl && !isSampleOrFakeMedia(videoUrl)
            ? "READY"
            : "FALLBACK_ONLY",
      },
    });
  }

  // Observation log
  await prisma.adObservation.create({
    data: {
      adId,
      observedAt: new Date(),
      isActive: record.status === "ACTIVE",
      evidenceType: "USER_OBSERVED",
    },
  });

  // Calculate and store Research Score
  const scoreResult = calculateWinningPotentialScore({
    firstSeenAt: record.firstSeenAt,
    lastSeenAt: record.lastSeenAt,
    variantCount: 1,
    status: record.status as "ACTIVE" | "INACTIVE" | "UNKNOWN",
    hasLandingPage: Boolean(record.landingPageUrl),
    hasCallToAction: Boolean(record.callToAction),
    // aiQualityScore intentionally omitted — no AI analysis performed at import time
  });

  await prisma.researchScore.create({
    data: {
      adId,
      totalScore: scoreResult.totalScore,
      tier: scoreResult.tier,
      longevityScore: scoreResult.components.longevity.score,
      diversityScore: scoreResult.components.diversity.score,
      performanceScore: scoreResult.components.performance.score,
      recencyScore: scoreResult.components.recency.score,
      clarityScore: scoreResult.components.clarity.score,
      aiQualityScore: scoreResult.components.aiQuality.score,
      confidenceScore: scoreResult.confidenceScore,
      formulaVersion: scoreResult.formulaVersion,
      scoreBreakdown: JSON.stringify(scoreResult),
    },
  });

  return await getAdvertisementDetails(adId);
}

export interface WorkspaceAdImportContext {
  workspaceId: string;
  runId?: string;
  providerId?: string;
  sourceConfidence?: "VERIFIED" | "OBSERVED" | "UNVERIFIED";
}

/**
 * Context-aware advertisement import wrapper.
 * Ensures canonical advertisement identity is preserved while workspace-specific
 * associations and observations remain isolated to the designated workspace.
 */
export async function importAdvertisementForWorkspace(
  context: WorkspaceAdImportContext,
  record: NormalizedAdRecord
) {
  const adDetails = await upsertCompetitorAd(record);
  if (!adDetails) return null;

  if (context.runId) {
    const existingRel = await prisma.discoveryRunAd.findUnique({
      where: {
        runId_adId: {
          runId: context.runId,
          adId: adDetails.id,
        },
      },
    });

    if (!existingRel) {
      await prisma.discoveryRunAd.create({
        data: {
          runId: context.runId,
          adId: adDetails.id,
          workspaceId: context.workspaceId,
          providerId: context.providerId || "META_COLLECTOR",
          ingestOutcome: "NEW",
          sourceUrl: record.originalAdUrl || null,
          observedAt: new Date(record.lastSeenAt || Date.now()),
        },
      });
    }
  }

  return adDetails;
}

/**
 * Discovers real related creative variants by the same advertiser.
 */
export async function findRelatedCreativeVariants(adId: string) {
  const currentAd = await prisma.competitorAd.findUnique({
    where: { id: adId },
    select: { advertiserId: true },
  });

  if (!currentAd) return [];

  return await prisma.competitorAd.findMany({
    where: {
      advertiserId: currentAd.advertiserId,
      id: { not: adId },
    },
    include: {
      mediaAssets: true,
      researchScores: { take: 1, orderBy: { createdAt: "desc" } },
    },
    take: 8,
  });
}

/**
 * Audit existing records for data integrity issues.
 * Returns structured report without modifying any data.
 */
export async function auditResearchDataIntegrity(): Promise<{
  totalAudited: number;
  issues: {
    adId: string;
    advertiserName: string;
    issues: string[];
    severity: "HIGH" | "MEDIUM" | "LOW";
  }[];
  summary: {
    hasSampleMedia: number;
    hasStockThumbnail: number;
    hasFakeEmbed: number;
    hasUnverifiedStatus: number;
    hasUnknownAdvertiser: number;
    hasMissingSource: number;
  };
}> {
  const ads = await prisma.competitorAd.findMany({
    include: { advertiser: true, mediaAssets: true },
  });

  const issues: {
    adId: string;
    advertiserName: string;
    issues: string[];
    severity: "HIGH" | "MEDIUM" | "LOW";
  }[] = [];

  const summary = {
    hasSampleMedia: 0,
    hasStockThumbnail: 0,
    hasFakeEmbed: 0,
    hasUnverifiedStatus: 0,
    hasUnknownAdvertiser: 0,
    hasMissingSource: 0,
  };

  for (const ad of ads) {
    const adIssues: string[] = [];
    const media = ad.mediaAssets?.[0];

    if (isSampleOrFakeMedia(media?.videoUrl)) {
      adIssues.push("VIDEO_URL_IS_SAMPLE_MEDIA: Google GTV sample video");
      summary.hasSampleMedia++;
    }

    if (isStockImage(media?.thumbnailUrl)) {
      adIssues.push("THUMBNAIL_IS_STOCK_IMAGE: Unsplash/Pexels stock photo");
      summary.hasStockThumbnail++;
    }

    if (
      media?.embedUrl?.includes("facebook.com/ads/archive/render_ad") ||
      media?.embedUrl?.includes("creativecenter/inspiration/topads/embed/")
    ) {
      adIssues.push("EMBED_URL_IS_INVALID: Not a public embed endpoint");
      summary.hasFakeEmbed++;
    }

    if (ad.status === "ACTIVE" && ad.dataConfidence === "VERIFIED") {
      adIssues.push(
        "UNVERIFIED_ACTIVE_STATUS: Marked ACTIVE/VERIFIED without live evidence"
      );
      summary.hasUnverifiedStatus++;
    }

    if (
      ad.advertiser?.name === "UNKNOWN" ||
      ad.advertiser?.name === "Independent Merchant"
    ) {
      adIssues.push(
        "UNKNOWN_ADVERTISER: Advertiser could not be identified from source"
      );
      summary.hasUnknownAdvertiser++;
    }

    if (!ad.originalAdUrl || ad.originalAdUrl.length < 5) {
      adIssues.push("MISSING_SOURCE_URL: No verifiable original ad URL");
      summary.hasMissingSource++;
    }

    if (adIssues.length > 0) {
      issues.push({
        adId: ad.id,
        advertiserName: ad.advertiser?.name || "UNKNOWN",
        issues: adIssues,
        severity:
          adIssues.some(
            (i) =>
              i.includes("SAMPLE_MEDIA") ||
              i.includes("STOCK_IMAGE") ||
              i.includes("EMBED_URL_IS_INVALID")
          )
            ? "HIGH"
            : "MEDIUM",
      });
    }
  }

  return {
    totalAudited: ads.length,
    issues,
    summary,
  };
}
