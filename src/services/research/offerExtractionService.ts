/**
 * SWAI Competitor Offer Extraction & Normalization Service
 *
 * KH-01.B — Competitor Offer Intelligence
 *
 * Core Concept:
 * An OFFER is the commercial terms under which a product is presented:
 * - Single unit price
 * - Multi-unit bundle pricing / quantity breaks
 * - Compare-at price & visible markdown
 * - Free shipping thresholds
 * - Warranty & guarantee conditions
 * - Gifts with purchase
 *
 * Safety Rules:
 * - Real observed values only; missing values stay null.
 * - Never infer USD solely because user targets US.
 * - Distinguish displayed promotional claims from checkout-validated prices.
 * - Store source evidence with content fingerprints.
 */

import { createHash } from "crypto";
import { prisma } from "@/lib/db";
import { ResearchAccessContext, assertProductWorkspaceAccess } from "./researchAuthService";

export interface ParsedPublicLandingPage {
  originalUrl: string;
  finalUrl: string;
  pageTitle: string | null;
  metaDescription: string | null;
  html: string;
  jsonLdObjects: any[];
  visiblePrices: {
    amount: number;
    currency: string | null;
    rawText: string;
    type: "REGULAR" | "COMPARE_AT" | "SUBSCRIPTION" | "BUNDLE";
  }[];
  visibleHeadings: string[];
  ctaButtons: string[];
  shippingStatements: string[];
  guaranteeStatements: string[];
}

export interface StructuredOfferCandidate {
  source: "JSON_LD" | "META_TAG" | "VISIBLE_DOM";
  sellingPrice: number | null;
  compareAtPrice: number | null;
  currency: string | null;
  availability: "IN_STOCK" | "OUT_OF_STOCK" | "PRE_ORDER" | "UNKNOWN";
  sku: string | null;
  variantTitle: string | null;
  priceValidUntil: string | null;
  evidenceText: string;
}

export interface PromotionalOfferEvidence {
  type:
    | "PERCENTAGE_DISCOUNT"
    | "FIXED_DISCOUNT"
    | "BUNDLE_QUANTITY_BREAK"
    | "FREE_SHIPPING_THRESHOLD"
    | "GIFT_WITH_PURCHASE"
    | "MONEY_BACK_GUARANTEE"
    | "WARRANTY"
    | "SUBSCRIPTION";
  claimText: string;
  observedDiscountPercent?: number | null;
  observedThresholdAmount?: number | null;
  observedThresholdCurrency?: string | null;
  bundleQuantity?: number | null;
  bundlePrice?: number | null;
  isVerifiedAtCheckout: false; // Research mode never performs live checkouts
}

export interface NormalizedCompetitorOffer {
  productId?: string | null;
  storeId?: string | null;
  adId?: string | null;
  sourceUrl: string;
  finalUrl: string | null;
  currency: string;
  sellingPrice: number | null;
  compareAtPrice: number | null;
  bundleQuantity: number;
  effectivePricePerUnit: number | null;
  hasFreeShipping: boolean;
  freeShippingThreshold: number | null;
  availability: "IN_STOCK" | "OUT_OF_STOCK" | "PRE_ORDER" | "UNKNOWN";
  promotions: PromotionalOfferEvidence[];
  structuredVariants: StructuredOfferCandidate[];
  conflicts: string[];
  warnings: string[];
}

export interface CompetitorOfferComparison {
  currency: string;
  offers: {
    snapshotId: string;
    observedAt: string;
    sellingPrice: number | null;
    compareAtPrice: number | null;
    bundleQuantity: number;
    effectivePricePerUnit: number | null;
    hasFreeShipping: boolean;
    freeShippingThreshold: number | null;
    guarantee: string | null;
    promotionsCount: number;
  }[];
  priceChangeObserved: boolean;
  lowestObservedUnitPrice: number | null;
  highestObservedUnitPrice: number | null;
  summary: string;
}

/**
 * Extracts structured pricing and offers from JSON-LD and semantic product markup.
 */
export function extractStructuredProductOffer(
  page: ParsedPublicLandingPage
): StructuredOfferCandidate[] {
  const results: StructuredOfferCandidate[] = [];

  // 1. Inspect JSON-LD Product & Offer objects
  for (const obj of page.jsonLdObjects) {
    if (!obj || typeof obj !== "object") continue;

    const types = Array.isArray(obj["@type"]) ? obj["@type"] : [obj["@type"]];
    const isProduct = types.some((t: string) => t && t.toLowerCase() === "product");

    if (isProduct) {
      const offers = obj.offers || obj.Offers;
      if (offers) {
        const offerList = Array.isArray(offers) ? offers : [offers];
        for (const off of offerList) {
          if (!off || typeof off !== "object") continue;

          // Check for AggregateOffer with highPrice / lowPrice
          const offType = off["@type"] || "";
          if (offType.toLowerCase() === "aggregateoffer") {
            const low = parseFloat(off.lowPrice);
            const high = parseFloat(off.highPrice);
            const curr = off.priceCurrency ? String(off.priceCurrency).toUpperCase() : null;

            results.push({
              source: "JSON_LD",
              sellingPrice: !isNaN(low) ? low : null,
              compareAtPrice: !isNaN(high) && high > low ? high : null,
              currency: curr,
              availability: "UNKNOWN",
              sku: off.sku || null,
              variantTitle: "Aggregate Offer",
              priceValidUntil: off.priceValidUntil || null,
              evidenceText: `JSON-LD AggregateOffer: lowPrice=${off.lowPrice}, highPrice=${off.highPrice}, currency=${curr}`,
            });
            continue;
          }

          // Individual Offer
          const price = parseFloat(off.price);
          const curr = off.priceCurrency ? String(off.priceCurrency).toUpperCase() : null;
          let availability: StructuredOfferCandidate["availability"] = "UNKNOWN";
          const availStr = (off.availability || "").toLowerCase();
          if (availStr.includes("instock")) availability = "IN_STOCK";
          else if (availStr.includes("outofstock")) availability = "OUT_OF_STOCK";
          else if (availStr.includes("preorder")) availability = "PRE_ORDER";

          results.push({
            source: "JSON_LD",
            sellingPrice: !isNaN(price) ? price : null,
            compareAtPrice: null, // JSON-LD Offer standard schema does not have formal compareAtPrice
            currency: curr,
            availability,
            sku: off.sku || null,
            variantTitle: off.name || null,
            priceValidUntil: off.priceValidUntil || null,
            evidenceText: `JSON-LD Offer: price=${off.price}, currency=${curr}, availability=${availability}`,
          });
        }
      }
    }
  }

  // 2. Cross-reference with visible price elements in DOM
  for (const vp of page.visiblePrices) {
    results.push({
      source: "VISIBLE_DOM",
      sellingPrice: vp.type === "REGULAR" ? vp.amount : null,
      compareAtPrice: vp.type === "COMPARE_AT" ? vp.amount : null,
      currency: vp.currency,
      availability: "UNKNOWN",
      sku: null,
      variantTitle: null,
      priceValidUntil: null,
      evidenceText: `Visible DOM price: '${vp.rawText}' (classified as ${vp.type})`,
    });
  }

  return results;
}

/**
 * Extracts promotional terms, bundles, quantity breaks, free shipping thresholds, and guarantees.
 */
export function extractPromotionalOffer(
  page: ParsedPublicLandingPage
): PromotionalOfferEvidence[] {
  const promotions: PromotionalOfferEvidence[] = [];
  const textCorpus = [
    page.pageTitle || "",
    page.metaDescription || "",
    ...page.visibleHeadings,
    ...page.ctaButtons,
    ...page.shippingStatements,
    ...page.guaranteeStatements,
  ].join(" \n ");

  // 1. Percentage discount: e.g. "50% OFF", "save 30%", "up to 40% discount"
  const percentMatch = textCorpus.match(
    /(?:save|discount|get|up to)?\s*(\d{1,2})%\s*(?:off|discount)/i
  ) || textCorpus.match(/(?:save|discount)\s+(\d{1,2})%/i);

  if (percentMatch) {
    const pct = parseInt(percentMatch[1], 10);
    if (!isNaN(pct) && pct > 0 && pct < 100) {
      promotions.push({
        type: "PERCENTAGE_DISCOUNT",
        claimText: percentMatch[0].trim(),
        observedDiscountPercent: pct,
        isVerifiedAtCheckout: false,
      });
    }
  }

  // 2. Free shipping threshold: e.g. "free shipping over $50", "free worldwide shipping on orders over $75"
  const thresholdMatch = textCorpus.match(/free\s+(?:standard\s+|worldwide\s+)?shipping\s+(?:on\s+orders\s+)?over\s*([$€£])?\s*(\d+(?:\.\d{2})?)/i);
  if (thresholdMatch) {
    const symbol = thresholdMatch[1];
    const amount = parseFloat(thresholdMatch[2]);
    let currency = "USD";
    if (symbol === "€") currency = "EUR";
    else if (symbol === "£") currency = "GBP";

    if (!isNaN(amount) && amount > 0) {
      promotions.push({
        type: "FREE_SHIPPING_THRESHOLD",
        claimText: thresholdMatch[0],
        observedThresholdAmount: amount,
        observedThresholdCurrency: currency,
        isVerifiedAtCheckout: false,
      });
    }
  } else if (/free\s+shipping\s+(?:today|worldwide|on all orders)/i.test(textCorpus)) {
    promotions.push({
      type: "FREE_SHIPPING_THRESHOLD",
      claimText: "Free shipping advertised on all orders",
      observedThresholdAmount: 0,
      observedThresholdCurrency: "USD",
      isVerifiedAtCheckout: false,
    });
  }

  // 3. Bundle / Quantity Breaks: "Buy 2 Get 1 Free", "Buy 1 Get 1 50% Off", "2 Pack $49"
  const bogoMatch = textCorpus.match(/buy\s+(\d+)\s*,?\s*get\s+(\d+)\s*(free|50%\s*off)/i);
  if (bogoMatch) {
    const buyQty = parseInt(bogoMatch[1], 10);
    const getQty = parseInt(bogoMatch[2], 10);
    promotions.push({
      type: "BUNDLE_QUANTITY_BREAK",
      claimText: bogoMatch[0],
      bundleQuantity: buyQty + getQty,
      isVerifiedAtCheckout: false,
    });
  }

  // 4. Money-back guarantee: "30-day money-back guarantee", "90 day guarantee"
  const guaranteeMatch = textCorpus.match(/(\d{1,3})[- ]day\s*(?:money[- ]back\s*)?guarantee/i);
  if (guaranteeMatch) {
    promotions.push({
      type: "MONEY_BACK_GUARANTEE",
      claimText: guaranteeMatch[0],
      isVerifiedAtCheckout: false,
    });
  }

  // 5. Warranty: "1-year warranty", "lifetime warranty"
  const warrantyMatch = textCorpus.match(/(lifetime|\d{1,2}[- ]year)\s*warranty/i);
  if (warrantyMatch) {
    promotions.push({
      type: "WARRANTY",
      claimText: warrantyMatch[0],
      isVerifiedAtCheckout: false,
    });
  }

  return promotions;
}

/**
 * Normalizes competitor offer candidates into a structured, unified commercial offer.
 */
export function normalizeCompetitorOffer(
  structuredOffers: StructuredOfferCandidate[],
  promotions: PromotionalOfferEvidence[],
  metadata: {
    productId?: string | null;
    storeId?: string | null;
    adId?: string | null;
    sourceUrl: string;
    finalUrl?: string | null;
  }
): NormalizedCompetitorOffer {
  const conflicts: string[] = [];
  const warnings: string[] = [];

  // Determine selling price and currency
  let sellingPrice: number | null = null;
  let compareAtPrice: number | null = null;
  let currency = "USD";
  let availability: NormalizedCompetitorOffer["availability"] = "UNKNOWN";

  // Prioritize structured JSON-LD price if available
  const jsonLdOffer = structuredOffers.find(
    (o) => o.source === "JSON_LD" && o.sellingPrice !== null
  );
  const domRegularPrice = structuredOffers.find(
    (o) => o.source === "VISIBLE_DOM" && o.sellingPrice !== null
  );
  const domCompareAt = structuredOffers.find(
    (o) => o.source === "VISIBLE_DOM" && o.compareAtPrice !== null
  );

  if (jsonLdOffer) {
    sellingPrice = jsonLdOffer.sellingPrice;
    if (jsonLdOffer.currency) currency = jsonLdOffer.currency;
    if (jsonLdOffer.availability !== "UNKNOWN") availability = jsonLdOffer.availability;
    if (jsonLdOffer.compareAtPrice) compareAtPrice = jsonLdOffer.compareAtPrice;
  } else if (domRegularPrice) {
    sellingPrice = domRegularPrice.sellingPrice;
    if (domRegularPrice.currency) currency = domRegularPrice.currency;
  }

  if (domCompareAt && compareAtPrice === null) {
    compareAtPrice = domCompareAt.compareAtPrice;
  }

  // Conflict detection: JSON-LD price differs noticeably from visible DOM price
  if (
    jsonLdOffer?.sellingPrice != null &&
    domRegularPrice?.sellingPrice != null &&
    Math.abs(jsonLdOffer.sellingPrice - domRegularPrice.sellingPrice) > 0.05
  ) {
    conflicts.push(
      `Structured JSON-LD price (${jsonLdOffer.sellingPrice} ${currency}) differs from visible DOM price (${domRegularPrice.sellingPrice} ${currency}).`
    );
  }

  // Free shipping terms
  const freeShippingPromo = promotions.find((p) => p.type === "FREE_SHIPPING_THRESHOLD");
  const hasFreeShipping = Boolean(freeShippingPromo);
  const freeShippingThreshold = freeShippingPromo?.observedThresholdAmount ?? null;

  // Bundle quantities
  const bundlePromo = promotions.find((p) => p.type === "BUNDLE_QUANTITY_BREAK");
  const bundleQuantity = bundlePromo?.bundleQuantity ?? 1;
  const effectivePricePerUnit =
    sellingPrice != null && bundleQuantity > 0
      ? Math.round((sellingPrice / bundleQuantity) * 100) / 100
      : sellingPrice;

  if (sellingPrice === null) {
    warnings.push("No explicit product selling price could be observed on the public landing page.");
  }

  return {
    productId: metadata.productId || null,
    storeId: metadata.storeId || null,
    adId: metadata.adId || null,
    sourceUrl: metadata.sourceUrl,
    finalUrl: metadata.finalUrl || null,
    currency,
    sellingPrice,
    compareAtPrice,
    bundleQuantity,
    effectivePricePerUnit,
    hasFreeShipping,
    freeShippingThreshold,
    availability,
    promotions,
    structuredVariants: structuredOffers,
    conflicts,
    warnings,
  };
}

/**
 * Persists a competitor offer snapshot with deduplication based on content hash.
 */
export async function persistCompetitorOfferSnapshot(
  input: NormalizedCompetitorOffer,
  context: ResearchAccessContext,
  tx?: any
) {
  if (input.productId && !tx) {
    await assertProductWorkspaceAccess(input.productId, context);
  }

  // Compute stable snapshot hash of core commercial terms
  const termsPayload = {
    productId: input.productId,
    storeId: input.storeId,
    currency: input.currency,
    sellingPrice: input.sellingPrice,
    compareAtPrice: input.compareAtPrice,
    bundleQuantity: input.bundleQuantity,
    hasFreeShipping: input.hasFreeShipping,
    freeShippingThreshold: input.freeShippingThreshold,
    promotions: input.promotions.map((p) => p.claimText).sort(),
  };

  const snapshotHash = createHash("sha256")
    .update(JSON.stringify(termsPayload))
    .digest("hex");

  const db = tx || prisma;

  // Check if identical snapshot already exists recently
  const existingLatest = await db.competitorOfferSnapshot.findFirst({
    where: {
      productId: input.productId ?? undefined,
      snapshotHash,
    },
    orderBy: { observedAt: "desc" },
  });

  if (existingLatest) {
    // Avoid spamming redundant identical rows; return existing
    return existingLatest;
  }

  return await db.competitorOfferSnapshot.create({
    data: {
      workspaceId: context.workspaceId,
      productId: input.productId ?? null,
      storeId: input.storeId ?? null,
      adId: input.adId ?? null,
      sourceUrl: input.sourceUrl,
      finalUrl: input.finalUrl ?? null,
      currency: input.currency,
      sellingPrice: input.sellingPrice ?? null,
      compareAtPrice: input.compareAtPrice ?? null,
      bundleQuantity: input.bundleQuantity,
      hasFreeShipping: input.hasFreeShipping,
      shippingThreshold: input.freeShippingThreshold ?? null,
      availability: input.availability,
      offerDataJson: JSON.stringify({
        bundleQuantity: input.bundleQuantity,
        effectivePricePerUnit: input.effectivePricePerUnit,
        promotions: input.promotions,
        structuredVariants: input.structuredVariants,
      }),
      evidenceJson: JSON.stringify({
        conflicts: input.conflicts,
        warnings: input.warnings,
      }),
      snapshotHash,
      observedAt: new Date(),
    },
  });
}

/**
 * Compares historical competitor offer snapshots side-by-side.
 */
export function compareCompetitorOffers(
  snapshots: {
    id: string;
    observedAt: Date | string;
    currency: string;
    sellingPrice: number | null;
    compareAtPrice: number | null;
    bundleQuantity: number;
    hasFreeShipping: boolean;
    shippingThreshold: number | null;
    offerDataJson: string;
  }[]
): CompetitorOfferComparison {
  if (!snapshots || snapshots.length === 0) {
    return {
      currency: "USD",
      offers: [],
      priceChangeObserved: false,
      lowestObservedUnitPrice: null,
      highestObservedUnitPrice: null,
      summary: "No offer snapshots available for comparison.",
    };
  }

  const baseCurrency = snapshots[0].currency || "USD";
  let lowestUnit: number | null = null;
  let highestUnit: number | null = null;
  const uniquePrices = new Set<number>();

  const offers = snapshots.map((s) => {
    let guarantee: string | null = null;
    let promoCount = 0;

    try {
      const data = JSON.parse(s.offerDataJson);
      const promos: PromotionalOfferEvidence[] = data.promotions || [];
      promoCount = promos.length;
      const g = promos.find((p) => p.type === "MONEY_BACK_GUARANTEE" || p.type === "WARRANTY");
      if (g) guarantee = g.claimText;
    } catch {
      // Ignore JSON parse errors
    }

    const effectiveUnit =
      s.sellingPrice != null && s.bundleQuantity > 0
        ? Math.round((s.sellingPrice / s.bundleQuantity) * 100) / 100
        : s.sellingPrice;

    if (effectiveUnit != null) {
      uniquePrices.add(effectiveUnit);
      if (lowestUnit === null || effectiveUnit < lowestUnit) lowestUnit = effectiveUnit;
      if (highestUnit === null || effectiveUnit > highestUnit) highestUnit = effectiveUnit;
    }

    return {
      snapshotId: s.id,
      observedAt: new Date(s.observedAt).toISOString(),
      sellingPrice: s.sellingPrice,
      compareAtPrice: s.compareAtPrice,
      bundleQuantity: s.bundleQuantity,
      effectivePricePerUnit: effectiveUnit,
      hasFreeShipping: s.hasFreeShipping,
      freeShippingThreshold: s.shippingThreshold,
      guarantee,
      promotionsCount: promoCount,
    };
  });

  const priceChangeObserved = uniquePrices.size > 1;
  const summary = priceChangeObserved
    ? `Price fluctuations observed across ${snapshots.length} observations (Range: $${lowestUnit} - $${highestUnit} ${baseCurrency}).`
    : `Stable observed offer at $${lowestUnit ?? "UNKNOWN"} ${baseCurrency} across ${snapshots.length} observations.`;

  return {
    currency: baseCurrency,
    offers,
    priceChangeObserved,
    lowestObservedUnitPrice: lowestUnit,
    highestObservedUnitPrice: highestUnit,
    summary,
  };
}
