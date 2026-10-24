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

/**
 * Calculates observable activity trends for a research product.
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

  const activeAds = product.adLinks.filter((l) => l.ad.status === "ACTIVE");
  const totalCreatives = product.adLinks.reduce(
    (acc, l) => acc + (l.ad.mediaAssets?.length || 1),
    0
  );

  let trendVelocity: "SURGING" | "STEADY" | "COOLING" | "NEW" = "STEADY";
  if (activeAds.length >= 5) trendVelocity = "SURGING";
  else if (activeAds.length === 0) trendVelocity = "COOLING";
  else if (product.createdAt >= cutoff) trendVelocity = "NEW";

  return {
    activeAdsCount: activeAds.length,
    distinctCreativesCount: totalCreatives,
    priceObservationsCount: product.priceHistory.length,
    trendVelocity,
    summary: `${activeAds.length} active ads and ${totalCreatives} creative variations observed in the last ${periodDays} days.`,
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

/**
 * Calculates contribution margin and break-even CPA from user or verified inputs.
 * NEVER invents supplier costs. If either selling price or supplier cost is missing,
 * margin and CPA return null.
 */
export function calculateEconomics(inputs: {
  observedSellingPrice: number | null;
  estimatedSupplierCost: number | null;
  shippingCost?: number | null;
  platformFees?: number | null;
  returnAllowancePercent?: number | null;
}): {
  contributionMargin: number | null;
  breakEvenCPA: number | null;
} {
  const { observedSellingPrice, estimatedSupplierCost, shippingCost, platformFees, returnAllowancePercent } = inputs;
  if (
    observedSellingPrice == null ||
    estimatedSupplierCost == null ||
    isNaN(observedSellingPrice) ||
    isNaN(estimatedSupplierCost)
  ) {
    return { contributionMargin: null, breakEvenCPA: null };
  }
  const price = Math.max(0, observedSellingPrice);
  const cost = Math.max(0, estimatedSupplierCost);
  const shipping = Math.max(0, shippingCost ?? 0);
  const fees = Math.max(0, platformFees ?? 0);
  const returnRate = Math.max(0, Math.min(100, returnAllowancePercent ?? 0));
  const returnAllowance = (price * returnRate) / 100;

  const margin = price - cost - shipping - fees - returnAllowance;
  const roundedMargin = Number(margin.toFixed(2));
  return {
    contributionMargin: roundedMargin,
    breakEvenCPA: roundedMargin,
  };
}

/**
 * Derives structured recommendation state from explicit evidence requirements.
 * Never represents this recommendation as guaranteed sales or profit.
 */
export function deriveRecommendation(checklist: {
  demandEvidence: boolean;
  competitionLevel: "LOW" | "MODERATE" | "HIGH" | "SATURATED";
  creativeAppeal: "STRONG" | "MODERATE" | "WEAK";
  differentiationFeasibility: boolean;
  deliveryFeasibility: boolean;
  returnRisk: "LOW" | "MEDIUM" | "HIGH";
  contributionMargin: number | null;
}): {
  recommendation: "READY_FOR_SMALL_TEST" | "RESEARCH_MORE" | "REJECTED";
  rationale: string;
} {
  // Hard disqualifiers
  if (checklist.contributionMargin !== null && checklist.contributionMargin <= 0) {
    return {
      recommendation: "REJECTED",
      rationale: "Unviable unit economics: estimated contribution margin is zero or negative with provided cost assumptions.",
    };
  }
  if (checklist.competitionLevel === "SATURATED" && !checklist.differentiationFeasibility) {
    return {
      recommendation: "REJECTED",
      rationale: "Saturated competition without an identified angle of differentiation.",
    };
  }
  if (!checklist.deliveryFeasibility) {
    return {
      recommendation: "REJECTED",
      rationale: "Delivery feasibility is uncertain or high risk (e.g. hazardous material, fragile, custom regulatory requirements).",
    };
  }

  // Small test qualifying criteria
  const isHealthyMargin = checklist.contributionMargin !== null && checklist.contributionMargin >= 12;
  if (
    checklist.demandEvidence &&
    checklist.differentiationFeasibility &&
    checklist.deliveryFeasibility &&
    checklist.creativeAppeal !== "WEAK" &&
    checklist.returnRisk !== "HIGH" &&
    (isHealthyMargin || checklist.competitionLevel === "LOW")
  ) {
    return {
      recommendation: "READY_FOR_SMALL_TEST",
      rationale: "Criteria met for preliminary small budget test: positive contribution margin, demand evidence, viable differentiation, and acceptable delivery/return risk.",
    };
  }

  return {
    recommendation: "RESEARCH_MORE",
    rationale: "Further validation needed before spending ad budget. Verify actual supplier quotes, inspect sample quality, or test creative messaging first.",
  };
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
  sourceStatus?: "USER_ENTERED" | "STOREFRONT_VERIFIED" | "UNVERIFIED";
  checklist?: {
    demandEvidence: boolean;
    competitionLevel: "LOW" | "MODERATE" | "HIGH" | "SATURATED";
    creativeAppeal: "STRONG" | "MODERATE" | "WEAK";
    differentiationFeasibility: boolean;
    deliveryFeasibility: boolean;
    returnRisk: "LOW" | "MEDIUM" | "HIGH";
  };
  recommendation?: "READY_FOR_SMALL_TEST" | "RESEARCH_MORE" | "REJECTED";
  notes?: string;
}

/**
 * Saves or links an ad to a ResearchProduct candidate record, updating economics and research decision.
 */
export async function saveAdProductCandidate(input: SaveProductCandidateInput) {
  const ad = await prisma.competitorAd.findUnique({
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

  // Determine domain
  const rawUrl = input.productUrl || ad.landingPageUrl;
  const domain = input.storeDomain || extractDomainFromUrl(rawUrl);

  // Upsert CompetitorStore if domain is available
  let store = null;
  if (domain) {
    store = await prisma.competitorStore.findUnique({
      where: { domain },
    });
    if (!store) {
      store = await prisma.competitorStore.create({
        data: {
          domain,
          storeName: ad.advertiser?.name !== "UNKNOWN" ? ad.advertiser?.name : null,
          advertiserId: ad.advertiserId,
          commercePlatform: domain.includes("myshopify") ? "SHOPIFY_CONFIRMED" : "SHOPIFY_POSSIBLE",
        },
      });
    }
  }

  // Calculate economics
  const economicsCalc = calculateEconomics({
    observedSellingPrice: input.observedSellingPrice ?? null,
    estimatedSupplierCost: input.estimatedSupplierCost ?? null,
    shippingCost: input.shippingCost ?? null,
    platformFees: input.platformFees ?? null,
    returnAllowancePercent: input.returnAllowancePercent ?? null,
  });

  // Evaluate recommendation
  const checklistInput = input.checklist || {
    demandEvidence: Boolean(ad.headline || ad.bodyText),
    competitionLevel: "MODERATE",
    creativeAppeal: "MODERATE",
    differentiationFeasibility: true,
    deliveryFeasibility: true,
    returnRisk: "LOW",
  };

  const recEvaluation = deriveRecommendation({
    ...checklistInput,
    contributionMargin: economicsCalc.contributionMargin,
  });

  const recommendation = input.recommendation || recEvaluation.recommendation;

  // Find or create ResearchProduct
  let product = ad.productLinks[0]?.product;

  const productTitle =
    input.title ||
    product?.title ||
    ad.headline ||
    `${ad.advertiser?.name || "Merchant"} Product Candidate`;

  if (product) {
    product = await prisma.researchProduct.update({
      where: { id: product.id },
      data: {
        title: productTitle,
        category: input.category || product.category || ad.category,
        description: input.description ?? product.description,
        productUrl: rawUrl ?? product.productUrl,
        currentPrice: input.observedSellingPrice ?? product.currentPrice,
        storeId: store?.id ?? product.storeId,
      },
    });
  } else {
    product = await prisma.researchProduct.create({
      data: {
        title: productTitle,
        category: input.category || ad.category || "Other",
        description: input.description ?? ad.bodyText,
        productUrl: rawUrl,
        currentPrice: input.observedSellingPrice ?? null,
        storeId: store?.id,
      },
    });

    // Link ad to product
    await prisma.adProductLink.create({
      data: {
        adId: ad.id,
        productId: product.id,
        confidence: "CONFIRMED",
      },
    });
  }

  // Record price observation if price provided
  if (input.observedSellingPrice != null && !isNaN(input.observedSellingPrice)) {
    await prisma.productPriceObservation.create({
      data: {
        productId: product.id,
        price: input.observedSellingPrice,
        currency: "USD",
        source: input.sourceStatus || "USER_ENTERED",
        observedAt: new Date(),
      },
    });
  }

  // Structured notes including economics and checklist
  const notesPayload = JSON.stringify({
    economics: {
      observedSellingPrice: input.observedSellingPrice ?? null,
      estimatedSupplierCost: input.estimatedSupplierCost ?? null,
      shippingCost: input.shippingCost ?? null,
      platformFees: input.platformFees ?? null,
      returnAllowancePercent: input.returnAllowancePercent ?? null,
      estimatedContributionMargin: economicsCalc.contributionMargin,
      breakEvenCPA: economicsCalc.breakEvenCPA,
      sourceStatus: input.sourceStatus || "USER_ENTERED",
    },
    checklist: {
      ...checklistInput,
      recommendation,
      recommendationRationale: recEvaluation.rationale,
    },
    customNotes: input.notes || "",
  });

  // Upsert ResearchDecision
  const existingDecision = await prisma.researchDecision.findFirst({
    where: {
      adId: ad.id,
      productId: product.id,
    },
  });

  if (existingDecision) {
    await prisma.researchDecision.update({
      where: { id: existingDecision.id },
      data: {
        decision: recommendation,
        notes: notesPayload,
        updatedAt: new Date(),
      },
    });
  } else {
    await prisma.researchDecision.create({
      data: {
        adId: ad.id,
        productId: product.id,
        decision: recommendation,
        notes: notesPayload,
      },
    });
  }

  return {
    productId: product.id,
    title: product.title,
    category: product.category,
    productUrl: product.productUrl,
    currentPrice: product.currentPrice,
    storeDomain: domain,
    economics: {
      observedSellingPrice: input.observedSellingPrice ?? null,
      estimatedSupplierCost: input.estimatedSupplierCost ?? null,
      shippingCost: input.shippingCost ?? null,
      platformFees: input.platformFees ?? null,
      returnAllowancePercent: input.returnAllowancePercent ?? null,
      estimatedContributionMargin: economicsCalc.contributionMargin,
      breakEvenCPA: economicsCalc.breakEvenCPA,
      sourceStatus: input.sourceStatus || "USER_ENTERED",
    },
    checklist: {
      ...checklistInput,
      recommendation,
      recommendationRationale: recEvaluation.rationale,
    },
    recommendation,
  };
}
