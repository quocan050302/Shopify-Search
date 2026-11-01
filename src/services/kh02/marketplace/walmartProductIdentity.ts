/**
 * SWAI KH-02 V12.4.3.5.1 — Walmart US Product Identity, Search Intent Derivation & Matching Engine
 *
 * Implements:
 * - validateWalmartItemId(input)
 * - canonicalizeWalmartProductUrl(itemId, observedFinalUrl?)
 * - deriveWalmartSearchIntents(candidate, niche)
 * - compareCandidateToWalmartListing(candidate, listing, pdp?)
 * - chooseWalmartPdpTargets(searchRows, remainingLogicalOperations, candidate, seenItemIds?)
 *
 * Matching Discipline:
 * - Priority: GTIN/UPC > verified model > brand + variant/pack/condition/product class.
 * - Title similarity alone CANNOT grant `EXACT`.
 * - Rejects or downgrades: accessory vs main product, wrong model under same brand,
 *   different pack size/bundle, refurbished/used vs new, and variant mismatches.
 */

import {
  MatchLevel,
  MarketplacePresence,
  WalmartIdentityDecision,
  WalmartPdpProduct,
  WalmartSearchIntent,
  WalmartSearchListing,
} from "./walmartJinaTypes";
import {
   WalmartItemIdValidation,
  buildWalmartJinaSearchUrl,
  validateWalmartItemIdString,
} from "./walmartJinaReaderClient";

export function validateWalmartItemId(input: unknown): WalmartItemIdValidation {
  return validateWalmartItemIdString(input);
}

export interface CanonicalWalmartProductUrlResult {
  valid: boolean;
  itemId: string | null;
  canonicalProductUrl: string | null;
  rejectionReason: string | null;
}

/**
 * Validates `itemId` and optional `observedFinalUrl` and returns `https://www.walmart.com/ip/{itemId}`.
 */
export function canonicalizeWalmartProductUrl(
  itemIdOrUrl: unknown,
  observedFinalUrl?: string | null
): CanonicalWalmartProductUrlResult {
  let candidateItemId: unknown = itemIdOrUrl;
  let effectiveObservedUrl: string | null | undefined = observedFinalUrl;

  if (
    typeof itemIdOrUrl === "string" &&
    (itemIdOrUrl.trim().startsWith("https://") ||
      itemIdOrUrl.trim().startsWith("http://") ||
      itemIdOrUrl.trim().startsWith("/ip/"))
  ) {
    const trimmed = itemIdOrUrl.trim();
    if (!effectiveObservedUrl) {
      effectiveObservedUrl = trimmed;
    }
    const m = trimmed.match(/\/ip\/(?:[^/?#]+\/)?([0-9]{4,18})(?:\/|\?|#|$)/);
    if (m && m[1]) {
      candidateItemId = m[1];
    }
  }

  const idCheck = validateWalmartItemIdString(candidateItemId);
  if (!idCheck.valid || !idCheck.itemId) {
    return {
      valid: false,
      itemId: null,
      canonicalProductUrl: null,
      rejectionReason: idCheck.rejectionReason || "Invalid Walmart itemId.",
    };
  }

  if (typeof effectiveObservedUrl === "string" && effectiveObservedUrl.trim()) {
    const trimmedFinal = effectiveObservedUrl.trim();
    if (trimmedFinal.startsWith("http://") || trimmedFinal.startsWith("https://")) {
      try {
        const parsed = new URL(trimmedFinal);
        const host = parsed.hostname.toLowerCase();
        if (
          parsed.protocol !== "https:" ||
          (host !== "www.walmart.com" && host !== "walmart.com")
        ) {
          return {
            valid: false,
            itemId: null,
            canonicalProductUrl: null,
            rejectionReason: `Observed final URL host '${parsed.origin}' is not Walmart US.`,
          };
        }
        const m = parsed.pathname.match(/\/ip\/(?:[^/]+\/)?([0-9]{4,18})$/);
        const directM = parsed.pathname.match(/^\/ip\/([0-9]{4,18})(?:\/|$)/);
        const finalId = directM?.[1] || m?.[1] || null;
        if (finalId && finalId !== idCheck.itemId) {
          return {
            valid: false,
            itemId: null,
            canonicalProductUrl: null,
            rejectionReason: `Observed final URL itemId '${finalId}' contradicts expected itemId '${idCheck.itemId}'.`,
          };
        }
      } catch {
        return {
          valid: false,
          itemId: null,
          canonicalProductUrl: null,
          rejectionReason: `Malformed observed final URL '${trimmedFinal}'.`,
        };
      }
    } else if (trimmedFinal.startsWith("/ip/")) {
      const m = trimmedFinal.match(/\/ip\/(?:[^/]+\/)?([0-9]{4,18})(?:\/|\?|$)/);
      if (m && m[1] && m[1] !== idCheck.itemId) {
        return {
          valid: false,
          itemId: null,
          canonicalProductUrl: null,
          rejectionReason: `Relative canonicalUrl itemId '${m[1]}' contradicts expected itemId '${idCheck.itemId}'.`,
        };
      }
    }
  }

  return {
    valid: true,
    itemId: idCheck.itemId,
    canonicalProductUrl: `https://www.walmart.com/ip/${idCheck.itemId}`,
    rejectionReason: null,
  };
}

export interface CandidateIdentityInput {
  candidateId: string;
  merchantVerifiedProductName?: string | null;
  canonicalProductName?: string | null;
  displayName?: string | null;
  title?: string | null;
  brand?: string | null;
  model?: string | null;
  sku?: string | null;
  gtin?: string | null;
  upc?: string | null;
  variant?: string | null;
  color?: string | null;
  packSize?: number | null;
  condition?: "NEW" | "REFURBISHED" | "USED" | null;
}

const AD_HYPE_PHRASES: RegExp[] = [
  /\b(?:\d{1,2}%\s*off|free\s+shipping|limited\s+time(?:\s+offer)?|buy\s+\d+\s+get\s+\d+|bogo|flash\s+sale|clearance|hot\s+deal|best\s+seller|as\s+seen\s+on\s+tv|tiktok\s+made\s+me\s+buy\s+it|viral|trending|official\s+store|shop\s+now|order\s+now|guaranteed|money\s+back)\b/gi,
];

const STOPWORDS = new Set([
  "the",
  "and",
  "for",
  "with",
  "from",
  "that",
  "this",
  "your",
  "you",
  "our",
  "new",
  "best",
  "pro",
  "plus",
  "official",
  "store",
  "shop",
  "online",
  "sale",
  "free",
  "shipping",
]);

function stripAdHype(raw: string): { cleaned: string; stripped: string[] } {
  let text = raw;
  const stripped: string[] = [];
  for (const pattern of AD_HYPE_PHRASES) {
    const matches = text.match(pattern);
    if (matches) {
      stripped.push(...matches.map((m) => m.trim()));
      text = text.replace(pattern, " ");
    }
  }
  const cleaned = text
    .replace(/[|•★☆🔥✨💥👉🛒]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return { cleaned, stripped };
}

function normalizeUpcOrGtinDigits(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (/^[0-9]{8,14}$/.test(trimmed)) {
    return trimmed;
  }
  return null;
}

function normalizeModelCode(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (trimmed.length < 3 || trimmed.length > 32) return null;
  // Valid model numbers typically contain letters+digits or hyphenated model codes (e.g. WH-1000XM4, BDH2000PL, CHV1410L)
  if (!/^[A-Za-z0-9][A-Za-z0-9-_/.]{1,30}[A-Za-z0-9]$/.test(trimmed)) {
    return null;
  }
  if (!/[0-9]/.test(trimmed)) {
    return null;
  }
  // Reject generic words or pure prices
  if (/^(?:sku|model|item|part|version|gen)[-_]?[0-9]?$/i.test(trimmed)) {
    return null;
  }
  return trimmed.toUpperCase();
}

/**
 * Derives 1–2 specific Walmart search intents from a shortlisted KH-02 candidate.
 * Prioritizes merchant-verified product name, brand, model, and GTIN/UPC.
 * Excludes ad hype phrases, unverified internal SKUs, and standalone generic niche names.
 */
export function deriveWalmartSearchIntents(
  candidate: CandidateIdentityInput,
  niche?: string | null
): WalmartSearchIntent[] {
  const excludedSignals: string[] = [];
  if (niche && niche.trim()) {
    excludedSignals.push(`generic_niche_excluded:${niche.trim()}`);
  }

  const rawPrimaryName =
    candidate.merchantVerifiedProductName ||
    candidate.canonicalProductName ||
    candidate.displayName ||
    candidate.title ||
    "";

  const { cleaned: cleanedName, stripped } = stripAdHype(rawPrimaryName);
  for (const s of stripped) {
    excludedSignals.push(`ad_hype:${s}`);
  }

  const cleanBrand =
    typeof candidate.brand === "string" && candidate.brand.trim().length >= 2
      ? stripAdHype(candidate.brand).cleaned
      : null;

  const cleanModel = normalizeModelCode(candidate.model);
  const cleanGtin = normalizeUpcOrGtinDigits(candidate.upc || candidate.gtin);

  if (candidate.sku && !cleanModel) {
    excludedSignals.push(`unverified_internal_sku_excluded:${candidate.sku}`);
  }

  const nicheNormalized = (niche || "").trim().toLowerCase();
  const intents: WalmartSearchIntent[] = [];
  const seenNormalizedQueries = new Set<string>();

  const tryAddIntent = (
    rawQuery: string,
    basis: WalmartSearchIntent["derivationBasis"]
  ) => {
    if (intents.length >= 2) return;
    const built = buildWalmartJinaSearchUrl(rawQuery);
    if (!built.valid || !built.normalizedQuery || !built.encodedQuery || !built.targetWalmartUrl || !built.jinaReaderUrl) {
      return;
    }
    const lowerQ = built.normalizedQuery.toLowerCase();
    // Never emit a query that is just the generic niche alone
    if (nicheNormalized && lowerQ === nicheNormalized) {
      return;
    }
    if (seenNormalizedQueries.has(lowerQ)) {
      return;
    }
    seenNormalizedQueries.add(lowerQ);
    intents.push({
      intentId: `wmt_intent_${candidate.candidateId}_${intents.length + 1}`,
      candidateId: candidate.candidateId,
      rank: intents.length + 1,
      rawQuery,
      normalizedQuery: built.normalizedQuery,
      encodedQuery: built.encodedQuery,
      targetWalmartUrl: built.targetWalmartUrl,
      jinaReaderUrl: built.jinaReaderUrl,
      derivationBasis: basis,
      excludedSignals: [...excludedSignals],
    });
  };

  // Intent 1: Brand + Model + Core Product Name (or Brand + Core Product Name)
  if (cleanedName) {
    const basis: WalmartSearchIntent["derivationBasis"] = candidate.merchantVerifiedProductName
      ? ["MERCHANT_VERIFIED_NAME"]
      : ["CANONICAL_PRODUCT_NAME"];
    const parts: string[] = [];

    if (
      cleanBrand &&
      !cleanedName.toLowerCase().includes(cleanBrand.toLowerCase())
    ) {
      parts.push(cleanBrand);
      basis.push("BRAND");
    } else if (cleanBrand) {
      basis.push("BRAND");
    }

    parts.push(cleanedName);

    if (
      cleanModel &&
      !cleanedName.toLowerCase().includes(cleanModel.toLowerCase())
    ) {
      parts.push(cleanModel);
      basis.push("MODEL");
    } else if (cleanModel) {
      basis.push("MODEL");
    }

    const combined = parts.join(" ").replace(/\s+/g, " ").trim().slice(0, 95);
    tryAddIntent(combined, basis);
  }

  // Intent 2: GTIN/UPC or Brand + Model exact lookup if available
  if (cleanGtin) {
    const gtQuery = cleanBrand ? `${cleanBrand} ${cleanGtin}` : cleanGtin;
    tryAddIntent(
      gtQuery,
      cleanBrand ? ["BRAND", "GTIN_UPC"] : ["GTIN_UPC"]
    );
  } else if (cleanBrand && cleanModel) {
    tryAddIntent(`${cleanBrand} ${cleanModel}`, ["BRAND", "MODEL"]);
  }

  return intents;
}

function tokenizeProductText(text: string | null | undefined): string[] {
  if (!text) return [];
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s+&-]/gu, " ")
    .split(/[\s/-]+/)
    .map((t) => t.trim())
    .filter((t) => t.length >= 2 && !STOPWORDS.has(t));
}

function detectAccessoryInText(text: string): boolean {
  return /\b(?:replacement\s+(?:part|filter|brush|blade|head|battery|belt|bag|pad|cap|cord|charger|adapter)|carrying\s+case\s+for|protective\s+cover\s+for|silicone\s+case\s+for|screen\s+protector\s+for|wall\s+mount\s+for|compatible\s+with|fits\s+models?|refill\s+only|attachment\s+only)\b/i.test(
    text
  );
}

function extractPackCountFromText(text: string): number | null {
  const m =
    text.match(/\b(\d+)\s*[-\s]?(?:pack|count|ct|pk|pcs|pieces)\b/i) ||
    text.match(/\bpack\s+of\s+(\d+)\b/i) ||
    text.match(/\bset\s+of\s+(\d+)\b/i);
  if (m && m[1]) {
    const n = Number.parseInt(m[1], 10);
    if (Number.isFinite(n) && n >= 1 && n <= 1000) return n;
  }
  return null;
}

function detectRefurbishedOrUsedInText(text: string): boolean {
  return /\b(?:refurbished|restored|renewed|reconditioned|pre-owned|used|open[\s-]box)\b/i.test(
    text
  );
}

const KNOWN_COLOR_TOKENS = new Set([
  "black",
  "white",
  "silver",
  "gray",
  "grey",
  "blue",
  "red",
  "green",
  "pink",
  "purple",
  "gold",
  "rose",
  "yellow",
  "orange",
  "brown",
  "beige",
  "navy",
  "teal",
]);

function extractColorToken(text: string): string | null {
  const tokens = text
    .toLowerCase()
    .replace(/[^a-z\s]/g, " ")
    .split(/\s+/);
  for (const t of tokens) {
    if (KNOWN_COLOR_TOKENS.has(t)) return t;
  }
  return null;
}

function extractModelLikeTokensFromTitle(title: string): string[] {
  const rawTokens = title
    .replace(/[^A-Za-z0-9-\s]/g, " ")
    .split(/\s+/)
    .map((t) => t.trim())
    .filter((t) => t.length >= 4 && t.length <= 20);
  const models: string[] = [];
  for (const tok of rawTokens) {
    // Must contain both letters and digits and not be a simple pack/size unit like "100ml", "2pack", "12oz"
    if (
      /[A-Za-z]/.test(tok) &&
      /[0-9]/.test(tok) &&
      !/^\d+(?:pack|pk|ct|oz|ml|lb|lbs|kg|mg|mm|cm|in|inch|ft|yd|mah|wh|w|v|gb|tb|hz|fps|pc|pcs)$/i.test(
        tok
      )
    ) {
      models.push(tok.toUpperCase());
    }
  }
  return models;
}

/**
 * Compares a KH-02 candidate against a Walmart search listing and optional PDP product.
 * Enforces strict hierarchy:
 * 1. GTIN/UPC exact string match (including leading zeros)
 * 2. Verified model number match
 * 3. Brand + variant/pack/condition/product class verification
 * Title similarity alone never yields `EXACT`.
 */
export function compareCandidateToWalmartListing(
  candidate: CandidateIdentityInput,
  listing: WalmartSearchListing | null,
  pdp?: WalmartPdpProduct | null
): WalmartIdentityDecision {
  const walmartItemId = pdp?.usItemId || listing?.usItemId || listing?.itemId || null;
  const targetTitle = pdp?.title || listing?.title || "";
  const targetBrand = pdp?.brand || listing?.brand || null;
  const targetModel = pdp?.model || listing?.modelNumber || null;
  const targetUpc = pdp?.upc || pdp?.gtin || listing?.upc || null;

  const candidateTitle =
    candidate.merchantVerifiedProductName ||
    candidate.canonicalProductName ||
    candidate.displayName ||
    candidate.title ||
    "";

  const matchReasons: string[] = [];
  const rejectionReasons: string[] = [];
  const missingFields: string[] = [];

  if (!walmartItemId || !targetTitle) {
    return {
      candidateId: candidate.candidateId,
      walmartItemId: null,
      matchLevel: "UNCERTAIN",
      verifiedIdentity: false,
      presence: "UNKNOWN",
      matchedByGtinUpc: false,
      matchedByModel: false,
      matchedByBrand: false,
      titleTokenOverlapRatio: 0,
      isAccessoryMismatch: false,
      isPackOrBundleMismatch: false,
      isConditionMismatch: false,
      isVariantMismatch: false,
      isWrongModelMismatch: false,
      matchReasons: [],
      rejectionReasons: ["MISSING_WALMART_LISTING_IDENTITY"],
      missingFields: ["itemId", "title"],
    };
  }

  const candUpc = normalizeUpcOrGtinDigits(candidate.upc || candidate.gtin);
  const wmtUpc = normalizeUpcOrGtinDigits(targetUpc);

  if (!wmtUpc) missingFields.push("upc");
  if (!targetBrand) missingFields.push("brand");
  if (!targetModel) missingFields.push("model");
  if ((pdp?.price ?? listing?.price ?? null) === null) missingFields.push("price");
  if ((pdp?.currency ?? listing?.currency ?? null) === null)
    missingFields.push("currency");
  if (!(pdp?.sellerDisplayName ?? listing?.sellerName))
    missingFields.push("seller");

  // 1. Check UPC/GTIN match or conflict
  let matchedByGtinUpc = false;
  let upcConflict = false;
  if (candUpc && wmtUpc) {
    if (candUpc === wmtUpc) {
      matchedByGtinUpc = true;
      matchReasons.push(`EXACT_UPC_GTIN_MATCH:${wmtUpc}`);
    } else {
      upcConflict = true;
      rejectionReasons.push(
        `UPC_GTIN_MISMATCH:candidate=${candUpc},walmart=${wmtUpc}`
      );
    }
  }

  // 2. Check Brand match or conflict
  const candBrandNorm = candidate.brand
    ? candidate.brand.trim().toLowerCase().replace(/[^a-z0-9+]/g, "")
    : null;
  const wmtBrandNorm = targetBrand
    ? targetBrand.trim().toLowerCase().replace(/[^a-z0-9+]/g, "")
    : null;

  let matchedByBrand = false;
  let brandConflict = false;
  if (candBrandNorm && wmtBrandNorm) {
    if (
      candBrandNorm === wmtBrandNorm ||
      candBrandNorm.includes(wmtBrandNorm) ||
      wmtBrandNorm.includes(candBrandNorm)
    ) {
      matchedByBrand = true;
      matchReasons.push(`BRAND_MATCH:${targetBrand}`);
    } else {
      brandConflict = true;
      rejectionReasons.push(
        `BRAND_MISMATCH:candidate=${candidate.brand},walmart=${targetBrand}`
      );
    }
  } else if (
    candBrandNorm &&
    !wmtBrandNorm &&
    targetTitle
      .toLowerCase()
      .replace(/[^a-z0-9+]/g, "")
      .includes(candBrandNorm)
  ) {
    matchedByBrand = true;
    matchReasons.push(`BRAND_OBSERVED_IN_TITLE:${candidate.brand}`);
  }

  // 3. Check Model match or conflict
  const candModelNorm = normalizeModelCode(candidate.model);
  const wmtModelNorm = normalizeModelCode(targetModel);
  const candTitleModels = extractModelLikeTokensFromTitle(candidateTitle);
  const wmtTitleModels = extractModelLikeTokensFromTitle(targetTitle);

  const effectiveCandModel = candModelNorm || candTitleModels[0] || null;
  const effectiveWmtModel = wmtModelNorm || wmtTitleModels[0] || null;

  let matchedByModel = false;
  let isWrongModelMismatch = false;

  if (effectiveCandModel && effectiveWmtModel) {
    const cleanC = effectiveCandModel.replace(/[-_]/g, "");
    const cleanW = effectiveWmtModel.replace(/[-_]/g, "");
    if (cleanC === cleanW) {
      matchedByModel = true;
      matchReasons.push(`MODEL_MATCH:${effectiveWmtModel}`);
    } else {
      isWrongModelMismatch = true;
      rejectionReasons.push(
        `MODEL_MISMATCH:candidate=${effectiveCandModel},walmart=${effectiveWmtModel}`
      );
    }
  } else if (
    effectiveCandModel &&
    targetTitle
      .toUpperCase()
      .replace(/[-_]/g, "")
      .includes(effectiveCandModel.replace(/[-_]/g, ""))
  ) {
    matchedByModel = true;
    matchReasons.push(`MODEL_OBSERVED_IN_WALMART_TITLE:${effectiveCandModel}`);
  }

  // 4. Check Accessory vs Main Product mismatch (W27)
  const candIsAccessory = detectAccessoryInText(candidateTitle);
  const wmtIsAccessory =
    Boolean(pdp?.isAccessoryOrPart) || detectAccessoryInText(targetTitle);
  const isAccessoryMismatch = candIsAccessory !== wmtIsAccessory;
  if (isAccessoryMismatch) {
    rejectionReasons.push(
      wmtIsAccessory
        ? "ACCESSORY_OR_REPLACEMENT_PART_MISMATCH:Walmart listing is an accessory/replacement part for main product"
        : "ACCESSORY_OR_REPLACEMENT_PART_MISMATCH:Candidate is an accessory while Walmart listing is main product"
    );
  }

  // 5. Check Pack Size / Bundle mismatch (W27)
  const candPack =
    candidate.packSize ?? extractPackCountFromText(candidateTitle) ?? 1;
  const wmtPack =
    pdp?.packSizeCount ?? extractPackCountFromText(targetTitle) ?? 1;
  const candIsBundle = /\b(?:bundle|kit|combo\s+pack)\b/i.test(candidateTitle);
  const wmtIsBundle = /\b(?:bundle|kit|combo\s+pack)\b/i.test(targetTitle);
  const isPackOrBundleMismatch =
    candPack !== wmtPack || candIsBundle !== wmtIsBundle;
  if (isPackOrBundleMismatch) {
    rejectionReasons.push(
      `PACK_OR_BUNDLE_MISMATCH:candidatePack=${candPack}(bundle=${candIsBundle}),walmartPack=${wmtPack}(bundle=${wmtIsBundle})`
    );
  }

  // 6. Check Condition mismatch (Refurbished/Used vs New) (W27)
  const candCond =
    candidate.condition ||
    (detectRefurbishedOrUsedInText(candidateTitle) ? "REFURBISHED" : "NEW");
  const wmtCond =
    pdp?.condition && pdp.condition !== "UNKNOWN"
      ? pdp.condition
      : detectRefurbishedOrUsedInText(targetTitle)
      ? "REFURBISHED"
      : "NEW";
  const isConditionMismatch = candCond !== wmtCond;
  if (isConditionMismatch) {
    rejectionReasons.push(
      `CONDITION_MISMATCH:candidate=${candCond},walmart=${wmtCond}`
    );
  }

  // 7. Check Variant / Color mismatch (W27)
  const candColor =
    (candidate.color && candidate.color.trim().toLowerCase()) ||
    extractColorToken(candidateTitle);
  const wmtColor =
    (pdp?.variantAttributes?.color &&
      pdp.variantAttributes.color.trim().toLowerCase()) ||
    (pdp?.variantAttributes?.actual_color &&
      pdp.variantAttributes.actual_color.trim().toLowerCase()) ||
    extractColorToken(targetTitle);
  const isVariantMismatch = Boolean(
    candColor && wmtColor && candColor !== wmtColor
  );
  if (isVariantMismatch) {
    rejectionReasons.push(
      `VARIANT_COLOR_MISMATCH:candidate=${candColor},walmart=${wmtColor}`
    );
  }

  // 8. Compute Token Overlap Ratio
  const candTokens = tokenizeProductText(candidateTitle);
  const wmtTokenSet = new Set(tokenizeProductText(targetTitle));
  const matchedTokens = candTokens.filter((t) => wmtTokenSet.has(t));
  const titleTokenOverlapRatio =
    candTokens.length > 0
      ? Math.round((matchedTokens.length / candTokens.length) * 100) / 100
      : 0;

  // Decision logic:
  const hasAnyHardMismatch =
    upcConflict ||
    brandConflict ||
    isWrongModelMismatch ||
    isAccessoryMismatch ||
    isPackOrBundleMismatch ||
    isConditionMismatch ||
    isVariantMismatch;

  // Case A: Accessory mismatch or completely unrelated brand/product -> UNCERTAIN
  if (isAccessoryMismatch || upcConflict || brandConflict) {
    return {
      candidateId: candidate.candidateId,
      walmartItemId,
      matchLevel: "UNCERTAIN",
      verifiedIdentity: false,
      presence: isAccessoryMismatch ? "NO_MATCH_IN_SCOPE" : "FOUND",
      matchedByGtinUpc,
      matchedByModel,
      matchedByBrand,
      titleTokenOverlapRatio,
      isAccessoryMismatch,
      isPackOrBundleMismatch,
      isConditionMismatch,
      isVariantMismatch,
      isWrongModelMismatch,
      matchReasons,
      rejectionReasons,
      missingFields,
    };
  }

  // Case B: Wrong model under same brand, or pack/condition/variant mismatch -> SIMILAR (never EXACT)
  if (
    isWrongModelMismatch ||
    isPackOrBundleMismatch ||
    isConditionMismatch ||
    isVariantMismatch
  ) {
    if (matchedByBrand || titleTokenOverlapRatio >= 0.35) {
      return {
        candidateId: candidate.candidateId,
        walmartItemId,
        matchLevel: "SIMILAR",
        verifiedIdentity: false,
        presence: "FOUND",
        matchedByGtinUpc,
        matchedByModel,
        matchedByBrand,
        titleTokenOverlapRatio,
        isAccessoryMismatch,
        isPackOrBundleMismatch,
        isConditionMismatch,
        isVariantMismatch,
        isWrongModelMismatch,
        matchReasons,
        rejectionReasons,
        missingFields,
      };
    }
    return {
      candidateId: candidate.candidateId,
      walmartItemId,
      matchLevel: "UNCERTAIN",
      verifiedIdentity: false,
      presence: "FOUND",
      matchedByGtinUpc,
      matchedByModel,
      matchedByBrand,
      titleTokenOverlapRatio,
      isAccessoryMismatch,
      isPackOrBundleMismatch,
      isConditionMismatch,
      isVariantMismatch,
      isWrongModelMismatch,
      matchReasons,
      rejectionReasons,
      missingFields,
    };
  }

  // Case C: No hard mismatches. Check if EXACT identity proof is satisfied.
  // Title similarity alone CANNOT grant EXACT (W29).
  // Require:
  //   1. Exact GTIN/UPC match + (matchedByBrand or titleTokenOverlapRatio >= 0.3), OR
  //   2. Exact Model match + matchedByBrand + titleTokenOverlapRatio >= 0.4, OR
  //   3. Confirmed PDP + matchedByBrand + wmtUpc present + titleTokenOverlapRatio >= 0.75 (when candidate had no conflicting model/UPC)
  const hasExactGtinProof =
    matchedByGtinUpc && (matchedByBrand || titleTokenOverlapRatio >= 0.3);
  const hasExactModelAndBrandProof =
    matchedByModel && matchedByBrand && titleTokenOverlapRatio >= 0.4;
  const hasVerifiedPdpBrandAndProductClassProof =
    Boolean(pdp) &&
    matchedByBrand &&
    Boolean(wmtUpc) &&
    !effectiveCandModel &&
    !candUpc &&
    titleTokenOverlapRatio >= 0.75 &&
    matchedTokens.length >= 3;

  if (
    !hasAnyHardMismatch &&
    (hasExactGtinProof ||
      hasExactModelAndBrandProof ||
      hasVerifiedPdpBrandAndProductClassProof)
  ) {
    if (hasVerifiedPdpBrandAndProductClassProof) {
      matchReasons.push(
        `VERIFIED_PDP_BRAND_AND_PRODUCT_CLASS:overlap=${titleTokenOverlapRatio},upc=${wmtUpc}`
      );
    }
    return {
      candidateId: candidate.candidateId,
      walmartItemId,
      matchLevel: "EXACT",
      verifiedIdentity: true,
      presence: "FOUND",
      matchedByGtinUpc,
      matchedByModel,
      matchedByBrand,
      titleTokenOverlapRatio,
      isAccessoryMismatch: false,
      isPackOrBundleMismatch: false,
      isConditionMismatch: false,
      isVariantMismatch: false,
      isWrongModelMismatch: false,
      matchReasons,
      rejectionReasons: [],
      missingFields,
    };
  }

  // Otherwise, if title similarity or brand+category overlap is meaningful, classify as SIMILAR (never EXACT from title alone)
  if (titleTokenOverlapRatio >= 0.45 || (matchedByBrand && titleTokenOverlapRatio >= 0.3)) {
    rejectionReasons.push(
      "TITLE_SIMILARITY_ALONE_INSUFFICIENT_FOR_EXACT:Requires verified GTIN/UPC, model, or PDP brand+barcode confirmation"
    );
    return {
      candidateId: candidate.candidateId,
      walmartItemId,
      matchLevel: "SIMILAR",
      verifiedIdentity: false,
      presence: "FOUND",
      matchedByGtinUpc,
      matchedByModel,
      matchedByBrand,
      titleTokenOverlapRatio,
      isAccessoryMismatch: false,
      isPackOrBundleMismatch: false,
      isConditionMismatch: false,
      isVariantMismatch: false,
      isWrongModelMismatch: false,
      matchReasons,
      rejectionReasons,
      missingFields,
    };
  }

  rejectionReasons.push(
    `INSUFFICIENT_IDENTITY_OVERLAP:ratio=${titleTokenOverlapRatio}`
  );
  return {
    candidateId: candidate.candidateId,
    walmartItemId,
    matchLevel: "UNCERTAIN",
    verifiedIdentity: false,
    presence: "FOUND",
    matchedByGtinUpc,
    matchedByModel,
    matchedByBrand,
    titleTokenOverlapRatio,
    isAccessoryMismatch: false,
    isPackOrBundleMismatch: false,
    isConditionMismatch: false,
    isVariantMismatch: false,
    isWrongModelMismatch: false,
    matchReasons,
    rejectionReasons,
    missingFields,
  };
}

export interface ChosenWalmartPdpTarget {
  itemId: string;
  listing: WalmartSearchListing;
  preliminaryDecision: WalmartIdentityDecision;
  priorityScore: number;
}

/**
 * Deterministically ranks and selects Walmart PDP target(s) from search listings
 * within the remaining logical-operation budget (`<=4` total per run) and never
 * fetches the same `itemId` twice.
 */
export function chooseWalmartPdpTargets(
  searchRows: WalmartSearchListing[],
  remainingLogicalOperations: number,
  candidate: CandidateIdentityInput,
  alreadyFetchedItemIds: Set<string> = new Set()
): ChosenWalmartPdpTarget[] {
  if (
    !Array.isArray(searchRows) ||
    searchRows.length === 0 ||
    remainingLogicalOperations <= 0
  ) {
    return [];
  }

  const scored: ChosenWalmartPdpTarget[] = [];
  const seenInSelection = new Set<string>(alreadyFetchedItemIds);

  for (const row of searchRows) {
    const idCheck = validateWalmartItemIdString(row?.itemId || row?.usItemId);
    if (!idCheck.valid || !idCheck.itemId) continue;
    if (seenInSelection.has(idCheck.itemId)) continue;

    const prelim = compareCandidateToWalmartListing(candidate, row, null);

    // Do not waste PDP budget on clear accessory mismatches or brand conflicts when better candidates exist
    if (prelim.isAccessoryMismatch) {
      continue;
    }

    let priorityScore = Math.round(prelim.titleTokenOverlapRatio * 100);
    if (prelim.matchedByGtinUpc) priorityScore += 200;
    if (prelim.matchedByModel) priorityScore += 120;
    if (prelim.matchedByBrand) priorityScore += 60;
    if (row.appearanceProvenance.includes("ORGANIC")) priorityScore += 15;
    if (!prelim.isWrongModelMismatch && !prelim.isPackOrBundleMismatch && !prelim.isConditionMismatch) {
      priorityScore += 25;
    }

    // Require minimum signal to justify a PDP fetch
    if (
      priorityScore < 35 &&
      !prelim.matchedByGtinUpc &&
      !prelim.matchedByModel &&
      !prelim.matchedByBrand
    ) {
      continue;
    }

    seenInSelection.add(idCheck.itemId);
    scored.push({
      itemId: idCheck.itemId,
      listing: row,
      preliminaryDecision: prelim,
      priorityScore,
    });
  }

  scored.sort((a, b) => {
    if (b.priorityScore !== a.priorityScore) {
      return b.priorityScore - a.priorityScore;
    }
    return a.listing.positionIndex - b.listing.positionIndex;
  });

  const maxToSelect = Math.min(remainingLogicalOperations, scored.length);
  return scored.slice(0, maxToSelect);
}
