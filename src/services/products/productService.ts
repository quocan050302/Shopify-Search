import { prisma } from "@/lib/db";

/**
 * Groups advertisement IDs into linked product clusters based on landing page domains or titles.
 */
export async function groupAdsByProduct(adIds: string[]): Promise<{
  groupedCount: number;
  clusters: { productId: string; productTitle: string; adCount: number }[];
}> {
  if (!adIds || adIds.length === 0) {
    return { groupedCount: 0, clusters: [] };
  }

  const ads = await prisma.competitorAd.findMany({
    where: { id: { in: adIds } },
    include: { productLinks: true },
  });

  const clustersMap = new Map<string, { title: string; count: number }>();

  for (const ad of ads) {
    if (ad.productLinks.length > 0) {
      for (const link of ad.productLinks) {
        const existing = clustersMap.get(link.productId) || { title: "Tracked Product", count: 0 };
        existing.count += 1;
        clustersMap.set(link.productId, existing);
      }
    }
  }

  const clusters = Array.from(clustersMap.entries()).map(([productId, val]) => ({
    productId,
    productTitle: val.title,
    adCount: val.count,
  }));

  return {
    groupedCount: clusters.length,
    clusters,
  };
}

/**
 * Records a verified price observation for a product.
 */
export async function recordProductPriceObservation(
  productId: string,
  price: number,
  currency: string = "USD",
  source: string = "STOREFRONT_HTTP"
) {
  return await prisma.productPriceObservation.create({
    data: {
      productId,
      price,
      currency,
      source,
      observedAt: new Date(),
    },
  });
}

import {
  calculateEconomics,
  deriveRecommendation,
  roundCurrency,
  CalculateEconomicsInput,
  EconomicsResult,
  RecommendationInputs,
  RecommendationResult,
} from "@/lib/economics";

export {
  calculateEconomics,
  deriveRecommendation,
  roundCurrency,
  type CalculateEconomicsInput,
  type EconomicsResult,
  type RecommendationInputs,
  type RecommendationResult,
};

/**
 * Calculates observable activity trends for a research product.
 * Does NOT falsely imply COOLING when ads have UNKNOWN status.
 */
export async function calculateProductResearchTrend(
  productId: string,
  periodDays: number = 30
): Promise<{
  activeAdsCount: number;
  distinctCreativesCount: number;
  priceObservationsCount: number;
  trendVelocity: "SURGING" | "STEADY" | "COOLING" | "NEW";
  summary: string;
}> {
  const cutoff = new Date(Date.now() - periodDays * 24 * 60 * 60 * 1000);

  const product = await prisma.researchProduct.findUnique({
    where: { id: productId },
    include: {
      adLinks: {
        include: {
          ad: {
            include: { mediaAssets: true },
          },
        },
      },
      priceHistory: {
        where: { observedAt: { gte: cutoff } },
      },
    },
  });

  if (!product) {
    return {
      activeAdsCount: 0,
      distinctCreativesCount: 0,
      priceObservationsCount: 0,
      trendVelocity: "NEW",
      summary: "Product not found in library",
    };
  }

  const activeAds = product.adLinks.filter(
    (l) => l.ad.status === "ACTIVE" || l.ad.status === "ACTIVE_VERIFIED"
  );
  const confirmedInactiveAds = product.adLinks.filter(
    (l) => l.ad.status === "INACTIVE" || l.ad.status === "INACTIVE_VERIFIED"
  );
  const unknownAds = product.adLinks.filter(
    (l) =>
      l.ad.status !== "ACTIVE" &&
      l.ad.status !== "ACTIVE_VERIFIED" &&
      l.ad.status !== "INACTIVE" &&
      l.ad.status !== "INACTIVE_VERIFIED"
  );

  const totalCreatives = product.adLinks.reduce(
    (acc, l) => acc + (l.ad.mediaAssets?.length || 1),
    0
  );

  let trendVelocity: "SURGING" | "STEADY" | "COOLING" | "NEW" = "STEADY";
  if (activeAds.length >= 5) {
    trendVelocity = "SURGING";
  } else if (confirmedInactiveAds.length > 0 && activeAds.length === 0) {
    // Only mark COOLING when there are verified inactive observations and zero active ads.
    // Missing active confirmations on imported/unknown ads must NOT imply COOLING.
    trendVelocity = "COOLING";
  } else if (product.createdAt >= cutoff) {
    trendVelocity = "NEW";
  } else {
    trendVelocity = "STEADY";
  }

  let statusSummary = `${activeAds.length} confirmed active ads`;
  if (unknownAds.length > 0) {
    statusSummary += `, ${unknownAds.length} unconfirmed/unknown status ads`;
  }
  if (confirmedInactiveAds.length > 0) {
    statusSummary += `, ${confirmedInactiveAds.length} inactive ads`;
  }

  return {
    activeAdsCount: activeAds.length,
    distinctCreativesCount: totalCreatives,
    priceObservationsCount: product.priceHistory.length,
    trendVelocity,
    summary: `${statusSummary} and ${totalCreatives} creative variations observed in the last ${periodDays} days.`,
  };
}

/**
 * Extracts clean domain name from a URL safely.
 */
export function extractDomainFromUrl(urlStr: string | null | undefined): string | null {
  if (!urlStr) return null;
  try {
    const parsed = new URL(urlStr.startsWith("http") ? urlStr : `https://${urlStr}`);
    return parsed.hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}

export interface SaveProductCandidateInput {
  adId: string;
  title?: string;
  category?: string;
  description?: string;
  productUrl?: string;
  storeDomain?: string;
  observedSellingPrice?: number | null;
  estimatedSupplierCost?: number | null;
  shippingCost?: number | null;
  platformFees?: number | null;
  returnAllowancePercent?: number | null;
  targetProfitPerUnit?: number | null;
  isConfirmedByUser?: boolean;
  costVerificationSource?: "USER_ESTIMATE" | "SUPPLIER_INVOICE" | "USER_VERIFIED_QUOTE" | "UNVERIFIED" | null;
  sourceStatus?: "USER_ENTERED" | "STOREFRONT_VERIFIED" | "UNVERIFIED";
  checklist?: {
    demandEvidence?: "UNKNOWN" | "UNVERIFIED" | "VERIFIED" | boolean;
    demandEvidenceSource?: string | null;
    competitionLevel?: "UNKNOWN" | "LOW" | "MODERATE" | "HIGH" | "SATURATED";
    creativeAppeal?: "UNKNOWN" | "STRONG" | "MODERATE" | "WEAK";
    differentiationFeasibility?: "UNKNOWN" | "VIABLE" | "UNCERTAIN" | "NOT_VIABLE" | boolean;
    deliveryFeasibility?: "UNKNOWN" | "CONFIRMED" | "UNCERTAIN" | "HIGH_RISK" | boolean;
    returnRisk?: "UNKNOWN" | "LOW" | "MEDIUM" | "HIGH";
  };
  userDecision?: "READY_FOR_SMALL_TEST" | "RESEARCH_MORE" | "REJECTED" | null;
  recommendation?: "READY_FOR_SMALL_TEST" | "RESEARCH_MORE" | "REJECTED" | null;
  notes?: string;
}

/**
 * Saves or links an ad to a ResearchProduct candidate record inside a Prisma transaction.
 *
 * Safety & Data Integrity Rules:
 * - Prevents duplicate product records across multiple ads for the same product.
 * - Never overwrites an existing product's title simply because an ad headline is different.
 * - Confidence is set to CONFIRMED only when product URL matches ad landing page, else PROBABLE.
 * - Wraps all mutations in a prisma.$transaction to guarantee rollback on any failure.
 * - Separates verified price observations from user estimates.
 * - Appends ResearchDecision records to preserve historical audit trail.
 * - Computes authoritative algorithmRecommendation on server and separates it from userDecision.
 */
export async function saveAdProductCandidate(input: SaveProductCandidateInput) {
  // 1. Authoritative server-side calculations
  const economicsCalc = calculateEconomics({
    observedSellingPrice: input.observedSellingPrice ?? null,
    estimatedSupplierCost: input.estimatedSupplierCost ?? null,
    shippingCost: input.shippingCost ?? null,
    platformFees: input.platformFees ?? null,
    returnAllowancePercent: input.returnAllowancePercent ?? null,
    targetProfitPerUnit: input.targetProfitPerUnit ?? null,
    isConfirmedByUser: input.isConfirmedByUser ?? false,
    costVerificationSource: input.costVerificationSource ?? null,
    sourceStatus: input.sourceStatus ?? "USER_ENTERED",
  });

  const rawChecklist = input.checklist || {
    demandEvidence: "UNKNOWN" as const,
    demandEvidenceSource: null,
    competitionLevel: "UNKNOWN" as const,
    creativeAppeal: "UNKNOWN" as const,
    differentiationFeasibility: "UNKNOWN" as const,
    deliveryFeasibility: "UNKNOWN" as const,
    returnRisk: "UNKNOWN" as const,
  };

  const recEvaluation = deriveRecommendation({
    contributionMargin: economicsCalc.contributionMargin,
    observedSellingPrice: input.observedSellingPrice ?? null,
    missingCostState: economicsCalc.missingCostState,
    isConfirmedByUser: economicsCalc.isConfirmedByUser,
    costVerificationSource: (economicsCalc.costVerificationSource as any),
    demandEvidence: rawChecklist.demandEvidence ?? "UNKNOWN",
    demandEvidenceSource: rawChecklist.demandEvidenceSource,
    competitionLevel: rawChecklist.competitionLevel ?? "UNKNOWN",
    creativeAppeal: rawChecklist.creativeAppeal ?? "UNKNOWN",
    differentiationFeasibility: rawChecklist.differentiationFeasibility ?? "UNKNOWN",
    deliveryFeasibility: rawChecklist.deliveryFeasibility ?? "UNKNOWN",
    returnRisk: rawChecklist.returnRisk ?? "UNKNOWN",
  });

  // Algorithm recommendation is authoritative and cannot be overridden by client
  const algorithmRecommendation = recEvaluation.recommendation;
  // User decision is explicitly recorded separately
  const userDecision = input.userDecision || input.recommendation || null;
  const storedDecision = userDecision || algorithmRecommendation;

  // 2. Wrap all database mutations in a single Prisma transaction
  return await prisma.$transaction(async (tx) => {
    const ad = await tx.competitorAd.findUnique({
      where: { id: input.adId },
      include: {
        advertiser: true,
        productLinks: {
          include: { product: true },
        },
      },
    });

    if (!ad) {
      throw new Error(`Ad not found with ID: ${input.adId}`);
    }

    // Determine domain and raw URL
    const rawUrl = input.productUrl || ad.landingPageUrl || null;
    const domain = input.storeDomain || extractDomainFromUrl(rawUrl);

    // Upsert or find CompetitorStore
    let store = null;
    if (domain) {
      store = await tx.competitorStore.findUnique({
        where: { domain },
      });
      if (!store) {
        store = await tx.competitorStore.create({
          data: {
            domain,
            storeName: ad.advertiser?.name && ad.advertiser.name !== "UNKNOWN" ? ad.advertiser.name : null,
            advertiserId: ad.advertiserId,
            commercePlatform: domain.includes("myshopify") ? "SHOPIFY_CONFIRMED" : "SHOPIFY_POSSIBLE",
          },
        });
      }
    }

    // P1: Prevent duplicate product records across multiple ads of the same genuine product
    let product: any = null;

    // Check 1: Ad already linked to a product
    if (ad.productLinks.length > 0 && ad.productLinks[0].product) {
      product = ad.productLinks[0].product;
    }

    // Check 2: Existing product matching normalized productUrl
    if (!product && rawUrl) {
      const cleanUrl = rawUrl.split("?")[0].replace(/\/+$/, "");
      product = await tx.researchProduct.findFirst({
        where: {
          productUrl: {
            startsWith: cleanUrl,
          },
        },
      });
    }

    // Check 3: Existing product matching title in the same store
    if (!product && input.title && store?.id) {
      product = await tx.researchProduct.findFirst({
        where: {
          storeId: store.id,
          title: {
            equals: input.title.trim(),
          },
        },
      });
    }

    // P1: Do not overwrite an existing product simply because an ad has a similar headline
    if (product) {
      const updateData: any = {};
      // Only update title if user explicitly provided a new title
      if (input.title && input.title.trim()) {
        updateData.title = input.title.trim();
      }
      if (input.category) updateData.category = input.category;
      if (input.description && !product.description) updateData.description = input.description;
      if (rawUrl && !product.productUrl) updateData.productUrl = rawUrl;
      if (input.observedSellingPrice != null) updateData.currentPrice = input.observedSellingPrice;
      if (store?.id && !product.storeId) updateData.storeId = store.id;

      if (Object.keys(updateData).length > 0) {
        product = await tx.researchProduct.update({
          where: { id: product.id },
          data: updateData,
        });
      }
    } else {
      // Create new ResearchProduct
      const initialTitle =
        input.title?.trim() ||
        (ad.headline && !ad.headline.toLowerCase().includes("http")
          ? ad.headline
          : `${ad.advertiser?.name || "Merchant"} Product Candidate`);

      product = await tx.researchProduct.create({
        data: {
          title: initialTitle,
          category: input.category || ad.category || "Other",
          description: input.description ?? ad.bodyText,
          productUrl: rawUrl,
          currentPrice: input.observedSellingPrice ?? null,
          storeId: store?.id,
        },
      });
    }

    // P1: Do not automatically mark confidence as CONFIRMED when product identity is uncertain
    const isExactUrlMatch = Boolean(
      rawUrl &&
        ad.landingPageUrl &&
        rawUrl.split("?")[0].replace(/\/+$/, "") === ad.landingPageUrl.split("?")[0].replace(/\/+$/, "")
    );
    const linkConfidence = isExactUrlMatch ? "CONFIRMED" : "PROBABLE";

    const existingLink = await tx.adProductLink.findUnique({
      where: {
        adId_productId: {
          adId: ad.id,
          productId: product.id,
        },
      },
    });

    if (!existingLink) {
      await tx.adProductLink.create({
        data: {
          adId: ad.id,
          productId: product.id,
          confidence: linkConfidence,
        },
      });
    }

    // P1: Separate verified price observations from user estimates
    if (
      input.observedSellingPrice != null &&
      Number.isFinite(input.observedSellingPrice) &&
      input.observedSellingPrice >= 0
    ) {
      const priceSource =
        input.sourceStatus === "STOREFRONT_VERIFIED"
          ? "STOREFRONT_HTTP"
          : economicsCalc.isConfirmedByUser
          ? "USER_VERIFIED_QUOTE"
          : "USER_ESTIMATE";

      await tx.productPriceObservation.create({
        data: {
          productId: product.id,
          price: input.observedSellingPrice,
          currency: "USD",
          source: priceSource,
          observedAt: new Date(),
        },
      });
    }

    // Audit notes preserving economics scenario and checklist
    const notesPayload = JSON.stringify({
      algorithmRecommendation,
      algorithmRationale: recEvaluation.rationale,
      userDecision,
      economics: {
        ...economicsCalc,
        sourceStatus: input.sourceStatus || "USER_ENTERED",
      },
      checklist: {
        ...rawChecklist,
        algorithmRecommendation,
        userDecision,
        recommendationRationale: recEvaluation.rationale,
      },
      customNotes: input.notes || "",
      savedAt: new Date().toISOString(),
    });

    // P1: Append historical decision instead of overwriting research history
    const savedDecision = await tx.researchDecision.create({
      data: {
        adId: ad.id,
        productId: product.id,
        decision: storedDecision,
        notes: notesPayload,
      },
    });

    return {
      productId: product.id,
      title: product.title,
      category: product.category,
      productUrl: product.productUrl,
      currentPrice: product.currentPrice,
      storeDomain: domain,
      economics: economicsCalc,
      checklist: {
        ...rawChecklist,
        algorithmRecommendation,
        userDecision,
        recommendationRationale: recEvaluation.rationale,
      },
      algorithmRecommendation,
      userDecision,
      recommendation: storedDecision,
      decisionId: savedDecision.id,
    };
  });
}

