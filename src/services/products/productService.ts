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

/**
 * Canonicalizes a product or landing page URL according to KH-01.A3 rules:
 * - Normalizes scheme and hostname (removes www, lowercases).
 * - Strips marketing & attribution tracking parameters (utm_*, fbclid, etc.).
 * - Preserves meaningful product variant parameters (variant, id, sku, size, color).
 * - Normalizes trailing slashes without removing meaningful path segments.
 * - Generates a stable comparison key.
 */
export interface CanonicalProductUrl {
  rawUrl: string;
  canonicalUrl: string;
  comparisonKey: string;
  hostname: string;
  pathname: string;
  variantParam: string | null;
}

export function canonicalizeProductUrl(rawUrl: string): CanonicalProductUrl {
  if (!rawUrl || typeof rawUrl !== "string") {
    throw new Error("URL must be a non-empty string.");
  }

  const trimmed = rawUrl.trim();
  const parsed = new URL(trimmed.startsWith("http") ? trimmed : `https://${trimmed}`);

  const hostname = parsed.hostname.toLowerCase().replace(/^www\./, "");
  let pathname = parsed.pathname;
  if (pathname.length > 1 && pathname.endsWith("/")) {
    pathname = pathname.slice(0, -1);
  }

  const trackingParams = new Set([
    "utm_source",
    "utm_medium",
    "utm_campaign",
    "utm_term",
    "utm_content",
    "fbclid",
    "gclid",
    "ttclid",
    "msclkid",
    "twclid",
    "li_fat_id",
    "ad_id",
    "campaign_id",
    "adset_id",
    "ref",
    "referrer",
    "affiliate",
    "aff",
    "mc_cid",
    "mc_eid",
    "_ga",
    "_gl",
    "sca_ref",
    "wickedid",
    "irclickid",
  ]);

  const preservedParams = new URLSearchParams();
  let variantParam: string | null = null;

  const sortedKeys = Array.from(parsed.searchParams.keys()).sort();
  for (const key of sortedKeys) {
    const lowerKey = key.toLowerCase();
    if (trackingParams.has(lowerKey)) {
      continue;
    }
    const val = parsed.searchParams.get(key);
    if (val !== null) {
      preservedParams.append(key, val);
      if (lowerKey === "variant" || lowerKey === "variant_id" || lowerKey === "v") {
        variantParam = val;
      }
    }
  }

  const queryStr = preservedParams.toString();
  const canonicalUrl = `${parsed.protocol}//${hostname}${pathname}${queryStr ? `?${queryStr}` : ""}`;
  const comparisonKey = `${hostname}${pathname}${variantParam ? `?variant=${variantParam}` : ""}`;

  return {
    rawUrl,
    canonicalUrl,
    comparisonKey,
    hostname,
    pathname,
    variantParam,
  };
}

export type ProductMatchConfidence = "EXACT_MATCH" | "PROBABLE_MATCH" | "AMBIGUOUS" | "NO_MATCH";

export interface ProductIdentityCandidate {
  adId?: string;
  advertiserId?: string | null;
  landingPageUrl?: string | null;
  canonicalProductUrl?: string | null;
  candidateTitle?: string | null;
  storeDomain?: string | null;
  identityConfidence?: "EXACT" | "PROBABLE" | "AMBIGUOUS" | "INSUFFICIENT_EVIDENCE";
  supportingEvidenceIds?: string[];
  unresolvedQuestions?: string[];
}

export interface ProductIdentityMatch {
  matchedProduct: {
    id: string;
    title: string;
    productUrl: string | null;
    storeId: string | null;
  } | null;
  confidence: ProductMatchConfidence;
  matchReason: string;
  candidateUrl: string | null;
  matchedUrl: string | null;
  suggestedAlternatives?: {
    id: string;
    title: string;
    productUrl: string | null;
    storeDomain: string | null;
  }[];
}

/**
 * Matches an ad product candidate against existing ResearchProduct records with strict confidence tiers.
 */
export async function matchExistingResearchProduct(
  candidate: ProductIdentityCandidate,
  workspaceId?: string
): Promise<ProductIdentityMatch> {
  const targetUrl = candidate.canonicalProductUrl || candidate.landingPageUrl || null;

  if (targetUrl) {
    try {
      const canonical = canonicalizeProductUrl(targetUrl);

      // Check 1: Find all products with a productUrl to compare canonical keys
      const existingProducts = await prisma.researchProduct.findMany({
        where: {
          productUrl: { not: null },
        },
        include: { store: true },
      });

      for (const p of existingProducts) {
        if (!p.productUrl) continue;
        try {
          const existingCanonical = canonicalizeProductUrl(p.productUrl);
          if (existingCanonical.comparisonKey === canonical.comparisonKey) {
            return {
              matchedProduct: {
                id: p.id,
                title: p.title,
                productUrl: p.productUrl,
                storeId: p.storeId,
              },
              confidence: "EXACT_MATCH",
              matchReason: `Exact canonical product URL match on comparison key: '${canonical.comparisonKey}'.`,
              candidateUrl: targetUrl,
              matchedUrl: p.productUrl,
            };
          }
        } catch {
          // Ignore invalid URLs
        }
      }

      // Check 2: Same store with matching pathname handle
      if (candidate.storeDomain) {
        const store = await prisma.competitorStore.findUnique({
          where: { domain: candidate.storeDomain },
          include: { products: true },
        });

        if (store && store.products.length > 0) {
          const sameStoreMatches = store.products.filter((p) => {
            if (!p.productUrl) return false;
            try {
              const pCanonical = canonicalizeProductUrl(p.productUrl);
              return pCanonical.pathname === canonical.pathname;
            } catch {
              return false;
            }
          });

          if (sameStoreMatches.length === 1) {
            const m = sameStoreMatches[0];
            return {
              matchedProduct: {
                id: m.id,
                title: m.title,
                productUrl: m.productUrl,
                storeId: m.storeId,
              },
              confidence: "PROBABLE_MATCH",
              matchReason: `Same store domain '${candidate.storeDomain}' and confirmed product path '${canonical.pathname}'.`,
              candidateUrl: targetUrl,
              matchedUrl: m.productUrl,
            };
          } else if (sameStoreMatches.length > 1) {
            return {
              matchedProduct: null,
              confidence: "AMBIGUOUS",
              matchReason: `Multiple products found in store '${candidate.storeDomain}' for path '${canonical.pathname}'. Explicit confirmation required.`,
              candidateUrl: targetUrl,
              matchedUrl: null,
              suggestedAlternatives: sameStoreMatches.map((p) => ({
                id: p.id,
                title: p.title,
                productUrl: p.productUrl,
                storeDomain: candidate.storeDomain || null,
              })),
            };
          }
        }
      }
    } catch {
      // Malformed candidate URL
    }
  }

  // Check 3: Same store exact title match
  if (candidate.storeDomain && candidate.candidateTitle?.trim()) {
    const store = await prisma.competitorStore.findUnique({
      where: { domain: candidate.storeDomain },
      include: { products: true },
    });

    if (store) {
      const titleMatch = store.products.find(
        (p) => p.title.toLowerCase().trim() === candidate.candidateTitle!.toLowerCase().trim()
      );
      if (titleMatch) {
        return {
          matchedProduct: {
            id: titleMatch.id,
            title: titleMatch.title,
            productUrl: titleMatch.productUrl,
            storeId: titleMatch.storeId,
          },
          confidence: "PROBABLE_MATCH",
          matchReason: `Confirmed same store '${candidate.storeDomain}' and exact product title match.`,
          candidateUrl: targetUrl,
          matchedUrl: titleMatch.productUrl,
        };
      }
    }
  }

  // Check 4: Cross-store titles - NEVER auto-merge, suggest only
  if (candidate.candidateTitle?.trim()) {
    const possibleCrossStore = await prisma.researchProduct.findMany({
      where: {
        title: { contains: candidate.candidateTitle.trim() },
      },
      include: { store: true },
      take: 5,
    });

    if (possibleCrossStore.length > 0) {
      return {
        matchedProduct: null,
        confidence: "NO_MATCH",
        matchReason:
          "No exact same-store match. Cross-store products with similar titles exist but automatic merging is prohibited.",
        candidateUrl: targetUrl,
        matchedUrl: null,
        suggestedAlternatives: possibleCrossStore.map((p) => ({
          id: p.id,
          title: p.title,
          productUrl: p.productUrl,
          storeDomain: p.store?.domain || null,
        })),
      };
    }
  }

  return {
    matchedProduct: null,
    confidence: "NO_MATCH",
    matchReason: "No existing research product matches the candidate identity.",
    candidateUrl: targetUrl,
    matchedUrl: null,
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
  const isUserOverride =
    userDecision === "READY_FOR_SMALL_TEST" && algorithmRecommendation === "RESEARCH_MORE";
  const overrideStatus = isUserOverride
    ? "USER OVERRIDE — REQUIREMENTS NOT MET"
    : "ALIGNED";
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
    let product: {
      id: string;
      title: string;
      category: string;
      description: string | null;
      productUrl: string | null;
      currentPrice: number | null;
      storeId: string | null;
    } | null = null;

    // Check 1: Ad already linked to a product
    if (ad.productLinks.length > 0 && ad.productLinks[0].product) {
      product = ad.productLinks[0].product;
    }

    // Check 2: Canonical URL matching (replaces unsafe startsWith prefix match)
    if (!product && rawUrl) {
      try {
        const canonical = canonicalizeProductUrl(rawUrl);
        if (typeof tx.researchProduct.findMany === "function") {
          const storeProducts = await tx.researchProduct.findMany({
            where: store?.id ? { storeId: store.id } : {},
          });

          if (Array.isArray(storeProducts)) {
            for (const existing of storeProducts) {
              if (!existing.productUrl) continue;
              try {
                const existingCanonical = canonicalizeProductUrl(existing.productUrl);
                if (existingCanonical.comparisonKey === canonical.comparisonKey) {
                  product = existing;
                  break;
                }
              } catch {
                // Ignore malformed URL
              }
            }
          }
        }

        // Direct / mock compatibility fallback
        if (!product && typeof tx.researchProduct.findFirst === "function") {
          const directMatch = await tx.researchProduct.findFirst({
            where: {
              productUrl: {
                in: [rawUrl, canonical.canonicalUrl, rawUrl.split("?")[0]],
              },
            },
          });
          if (directMatch) {
            product = directMatch;
          }
        }
      } catch {
        // Raw URL was not a valid URL
      }
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
      decisionRationale: recEvaluation.rationale,
      isUserOverride,
      overrideStatus,
      decisionId: savedDecision.id,
    };
  });
}

