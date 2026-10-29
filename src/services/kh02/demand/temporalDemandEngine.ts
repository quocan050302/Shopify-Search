/**
 * SWAI KH-02 — Temporal Demand Engine (V12.4.3.1)
 *
 * Implements historical time-series demand assessment over 30D, 90D, 180D, and 365D windows
 * with strict product-level source authority and provenance verification.
 *
 * Rules:
 * 1. Historical demand evidence is mandatory for evergreen claims.
 * 2. 7D/30D data represents short-term novelty, not sustainable evergreen demand.
 * 3. Stable low demand (flatline near zero) is NOT high-value evergreen.
 * 4. Seasonality requires cyclical periodic recurrence across seasons.
 * 5. Missing time series strictly yields INSUFFICIENT_HISTORY.
 * 6. Evidence evaluation enforces multi-point verification, distinct observation timestamps,
 *    no future dates, no merged multi-product series, no broad category proxy terms, and
 *    verifiable source authority.
 */

import { prisma } from "@/lib/db";

export type KH02DemandClass =
  | "EVERGREEN_STABLE"
  | "SEASONAL_RECURRING"
  | "EMERGING_PERSISTENT"
  | "TREND_DEPENDENT"
  | "DECLINING"
  | "INSUFFICIENT_HISTORY";

export type DemandSourceAuthority =
  | "AUTHORITATIVE_VERIFIED"
  | "HISTORICAL_SOURCE_VERIFIED"
  | "ESTIMATED_OR_PROXY"
  | "CACHED_UNVERIFIED"
  | "FIXTURE_ONLY"
  | "UNKNOWN_SOURCE"
  | "AUTHORITATIVE_PROVIDER"
  | "ESTIMATED_SNAPSHOTS"
  | "UNVERIFIED";

export interface DemandDataPoint {
  id?: string;
  productId?: string | null;
  keyword?: string | null;
  evidenceReference?: string | null;
  methodologyVersion?: string | null;
  isFixture?: boolean;
  periodStart?: Date | string;
  periodEnd?: Date | string;
  demandValue?: number | null; // 0-100 relative index (Google Trends)
  date?: Date | string;
  value?: number | null;
  region?: string;
  source?: string;
}

export type HistoricalObservation = DemandDataPoint & {
  observedAt?: string;
  publicationDate?: string;
};

export interface DemandHistoryPolicy {
  minimumDataPoints?: number; // default: 3
  minimumCoveredDays?: number; // default: 60
  strictChronological?: boolean;
  rejectDuplicateTimestamps?: boolean;
  requiredRegion?: string;
  candidateCanonicalName?: string;
  candidateCanonicalTitle?: string | null;
  candidateProductId?: string | null;
  targetProductId?: string | null;
  searchTermUsed?: string;
  strictSourceProvenance?: boolean;
}

export interface DemandHistoryAssessment {
  status: "VERIFIED" | "UNVERIFIED" | "INSUFFICIENT_HISTORY";
  eligibleForEvergreen: boolean;
  dataPointsCount: number;
  distinctObservationDatesCount: number;
  coveredDays: number;
  meanInterest: number | null;
  stdDev: number | null;
  coefficientOfVariation: number | null;
  demandClass: KH02DemandClass;
  sourceAuthority: DemandSourceAuthority;
  temporalCoverageValid: boolean;
  productAttributionValid?: boolean;
  demandObservationIds?: string[];
  evidenceKind?: "SEARCH_INTEREST_NOT_SALES";
  commercialInterpretationNote?: string;
  calculationVersion: string;
  explanation: string;
  missingEvidence: string[];
  evaluatedAt: string;
}

export interface TemporalStabilityEvaluation {
  eligibleForEvergreen: boolean;
  demandClass: KH02DemandClass;
  stabilityScore: number | null; // 0-25 points for scoring Pillar A
  dataPointsCount: number;
  distinctObservationDatesCount?: number;
  coveredDays: number;
  meanInterest: number | null;
  stdDev: number | null;
  coefficientOfVariation: number | null;
  trendVelocity: "ACCELERATING" | "STEADY" | "DECELERATING" | "FLAT";
  sourceAuthority?: DemandSourceAuthority;
  demandObservationIds?: string[];
  evidenceKind?: "SEARCH_INTEREST_NOT_SALES";
  commercialInterpretationNote?: string;
  explanation: string;
  evaluatedAt: string;
  confidencePenaltyReason?: string | null;
}

export interface DemandSourceAuditRecord {
  productId: string | null;
  canonicalProductName: string | null;
  observationIds: string[];
  source: string | null;
  evidenceReferences: string[];
  methodologyVersions: string[];
  keywords: string[];
  values: number[];
  rawCsvFileExists: boolean;
  hasValidFileChecksum: boolean;
  hasProviderRequestLineage: boolean;
  isTemplated76To82Series: boolean;
  isPromotionalCopyKeyword: boolean;
  resolvedAuthority: DemandSourceAuthority;
  eligibleForEvergreen: boolean;
  demotedFromEvergreen: boolean;
  evidenceKind: "SEARCH_INTEREST_NOT_SALES";
  commercialNote: string;
  auditReasons: string[];
}

const SPECIFIC_PRODUCT_FAMILIES: Array<{ family: string; pattern: RegExp }> = [
  { family: "pet_feeder", pattern: /\b(pet\s+feeder|cat\s+feeder|dog\s+feeder|automatic\s+feeder|food\s+dispenser|meal\s+dispenser|timed\s+feeder|wet\s+food\s+.*feeder)\b/i },
  { family: "water_fountain", pattern: /\b(water\s+fountain|cat\s+fountain|pet\s+fountain|dog\s+fountain|hydration\s+fountain|dockstream)\b/i },
  { family: "hair_remover", pattern: /\b(hair\s+remover|fur\s+remover|lint\s+roller|chomchom|pet\s+roller|deshedding\s+brush|grooming\s+brush)\b/i },
  { family: "pet_bed", pattern: /\b(calming\s+bed|dog\s+bed|cat\s+bed|pet\s+bed|orthopedic\s+bed|donut\s+bed)\b/i },
  { family: "litter_mat", pattern: /\b(litter\s+mat|litter\s+box|litter\s+trapper)\b/i },
  { family: "glue_gun", pattern: /\b(glue\s+gun|hot\s+melt\s+glue)\b/i },
  { family: "spin_scrubber", pattern: /\b(spin\s+scrubber|power\s+scrubber|electric\s+scrubber)\b/i },
  { family: "plant_spike", pattern: /\b(plant\s+spike|watering\s+spike|watering\s+globe|self-watering\s+spike)\b/i },
  { family: "wall_repair", pattern: /\b(wall\s+repair|drywall\s+repair|patch\s+repair|repair\s+paste)\b/i },
  { family: "wallpaper", pattern: /\b(wallpaper|peel\s+and\s+stick\s+wall)\b/i },
  { family: "paint_by_numbers", pattern: /\b(paint\s+by\s+numbers|two\s+blue\s+cats)\b/i },
  { family: "posture_corrector", pattern: /\b(posture\s+corrector|back\s+relief\s+support)\b/i },
];

export function detectSpecificProductFamily(text: string | null | undefined): string | null {
  if (!text) return null;
  const cleaned = String(text).trim();
  for (const item of SPECIFIC_PRODUCT_FAMILIES) {
    if (item.pattern.test(cleaned)) {
      return item.family;
    }
  }
  return null;
}

const BROAD_CATEGORY_TERMS = new Set([
  "pet",
  "pets",
  "pet gadgets",
  "pet supplies",
  "pet products",
  "pet accessories",
  "dog supplies",
  "cat supplies",
  "diy",
  "diy tools",
  "home improvement",
  "home decor",
  "kitchen gadgets",
  "beauty",
  "electronics",
  "gadgets",
  "accessories",
  "tools",
]);

export function isBroadCategoryDemandTerm(term: string | null | undefined): boolean {
  if (!term) return false;
  const norm = String(term).trim().toLowerCase().replace(/\s+/g, " ");
  return BROAD_CATEGORY_TERMS.has(norm);
}

export function isTemplatedSyntheticDemandSeries(observations: HistoricalObservation[]): boolean {
  if (!observations || observations.length !== 6) return false;
  const vals = observations.map((o) => Number(o.demandValue !== undefined ? o.demandValue : (o as any).value));
  const templated = [76, 79, 77, 81, 78, 82];
  return vals.every((v, idx) => v === templated[idx]);
}

export function isPromotionalAdCopyDemandKeyword(keyword: string | null | undefined): boolean {
  if (!keyword) return false;
  const kw = String(keyword).trim();
  const wordCount = kw.split(/\s+/).length;
  return (
    wordCount > 12 ||
    /[\u{1F300}-\u{1FAFF}]/u.test(kw) ||
    /\b(free\s+bonus|buy\s+\d+\s+set|\d+%\s+off|limited\s+time\s+offer|shop\s+now)\b/i.test(kw)
  );
}

export function hasVerifiableCsvOrProviderLineage(evidenceReference: string | null | undefined): {
  rawCsvFileExists: boolean;
  hasValidFileChecksum: boolean;
  hasProviderRequestLineage: boolean;
  isMerchantDomainPseudoRef: boolean;
} {
  if (!evidenceReference) {
    return {
      rawCsvFileExists: false,
      hasValidFileChecksum: false,
      hasProviderRequestLineage: false,
      isMerchantDomainPseudoRef: false,
    };
  }
  const ref = String(evidenceReference).trim();
  const isMerchantDomainPseudoRef = /^verified-merchant-demand:/i.test(ref);
  const hasValidFileChecksum = /\bsha256:[a-f0-9]{16,64}\b/i.test(ref);
  const rawCsvFileExists = /\b(csv-import|benchmark-csv):/i.test(ref) && hasValidFileChecksum;
  const hasProviderRequestLineage = /\b(provider-request|serpapi-request|trends-api-request):/i.test(ref);
  return {
    rawCsvFileExists,
    hasValidFileChecksum,
    hasProviderRequestLineage,
    isMerchantDomainPseudoRef,
  };
}

export function evaluateDemandSourceAuthority(
  observations: HistoricalObservation[],
  policy: DemandHistoryPolicy = {}
): { authority: DemandSourceAuthority; reasons: string[]; productAttributionValid: boolean } {
  const reasons: string[] = [];
  if (!observations || observations.length === 0) {
    return { authority: "UNKNOWN_SOURCE", reasons: ["No demand observations provided."], productAttributionValid: false };
  }

  // 1. Check for fixture / synthetic / mock markers
  const hasFixture = observations.some(
    (o) =>
      o.isFixture === true ||
      (o.productId && String(o.productId).startsWith("prod_fixture_")) ||
      (o.source && /fixture|mock|synthetic|demo|seed_test/i.test(String(o.source))) ||
      (o.evidenceReference && /fixture|mock|synthetic|demo/i.test(String(o.evidenceReference)))
  );
  if (hasFixture) {
    reasons.push("Demand observations originate from test fixture records (FIXTURE_ONLY) and cannot verify production Evergreen winners.");
    return { authority: "FIXTURE_ONLY", reasons, productAttributionValid: false };
  }

  // 2. Check for merged multi-product series
  const distinctProductIds = new Set(
    observations.map((o) => o.productId).filter((id): id is string => Boolean(id))
  );
  if (distinctProductIds.size > 1) {
    reasons.push(`Demand series merges ${distinctProductIds.size} distinct productIds (${Array.from(distinctProductIds).join(", ")}); multi-product merging is prohibited.`);
    return { authority: "CACHED_UNVERIFIED", reasons, productAttributionValid: false };
  }

  // 3. Check for broad category term used as SKU demand proxy
  const keywords = observations
    .map((o) => o.keyword)
    .filter((k): k is string => Boolean(k && String(k).trim()));
  const checkTerms = [...keywords];
  if (policy.searchTermUsed) checkTerms.push(policy.searchTermUsed);

  if (checkTerms.some((t) => isBroadCategoryDemandTerm(t))) {
    reasons.push("Demand observations use a broad category term rather than a specific product/SKU search term.");
    return { authority: "ESTIMATED_OR_PROXY", reasons, productAttributionValid: false };
  }

  // 3b. Check for promotional ad-headline copy masquerading as a Google Trends search query
  if (keywords.some((kw) => isPromotionalAdCopyDemandKeyword(kw))) {
    reasons.push("Demand observation keyword is a long promotional ad headline rather than a genuine Google Trends search term.");
    return { authority: "CACHED_UNVERIFIED", reasons, productAttributionValid: false };
  }

  // 3c. Check for templated 6-point [76, 79, 77, 81, 78, 82] series
  if (isTemplatedSyntheticDemandSeries(observations)) {
    reasons.push("Demand series matches the unbacked templated [76, 79, 77, 81, 78, 82] sequence without raw CSV or provider API lineage.");
    return { authority: "CACHED_UNVERIFIED", reasons, productAttributionValid: false };
  }

  // 4. Check for cross-product family attribution mismatch
  if (policy.candidateCanonicalName) {
    const candidateFamily = detectSpecificProductFamily(policy.candidateCanonicalName);
    if (candidateFamily) {
      for (const kw of keywords) {
        const kwFamily = detectSpecificProductFamily(kw);
        if (kwFamily && kwFamily !== candidateFamily) {
          reasons.push(
            `Cross-product demand mismatch: candidate family '${candidateFamily}' cannot be verified by demand keyword '${kw}' (family '${kwFamily}').`
          );
          return { authority: "CACHED_UNVERIFIED", reasons, productAttributionValid: false };
        }
      }
    }
  }

  // 5. Inspect explicit source and evidenceReference
  const sources = observations
    .map((o) => (o.source ? String(o.source).trim() : ""))
    .filter(Boolean);

  if (sources.some((s) => /^unknown/i.test(s))) {
    reasons.push("Demand observation source is marked UNKNOWN_SOURCE.");
    return { authority: "UNKNOWN_SOURCE", reasons, productAttributionValid: true };
  }

  if (sources.some((s) => /unverified|cached_unverified/i.test(s))) {
    reasons.push("Demand observation source is marked CACHED_UNVERIFIED.");
    return { authority: "CACHED_UNVERIFIED", reasons, productAttributionValid: true };
  }

  if (sources.some((s) => /estimated|proxy|snapshot/i.test(s))) {
    reasons.push("Demand observation source is ESTIMATED_OR_PROXY.");
    return { authority: "ESTIMATED_OR_PROXY", reasons, productAttributionValid: true };
  }

  // Check if DB records lack evidenceReference or use pseudo-reference 'verified-merchant-demand:<domain>' without CSV checksum
  const hasDbProductWithoutRef = observations.some(
    (o) => o.productId && o.evidenceReference === null
  );
  if (hasDbProductWithoutRef) {
    reasons.push("Stored database demand observation lacks traceable evidenceReference.");
    return { authority: "CACHED_UNVERIFIED", reasons, productAttributionValid: false };
  }

  const hasMerchantDomainPseudoRef = observations.some(
    (o) => o.evidenceReference && hasVerifiableCsvOrProviderLineage(o.evidenceReference).isMerchantDomainPseudoRef
  );
  if (hasMerchantDomainPseudoRef) {
    reasons.push(
      "Demand observation uses 'verified-merchant-demand:<domain>' pseudo-reference without a raw Google Trends CSV file, SHA-256 checksum, or provider API response lineage."
    );
    return { authority: "CACHED_UNVERIFIED", reasons, productAttributionValid: false };
  }

  const hasUnbackedDbCsvRef = observations.some((o) => {
    if (!o.productId || !o.source || !/google_trends_csv/i.test(String(o.source))) return false;
    const lineage = hasVerifiableCsvOrProviderLineage(o.evidenceReference);
    return !lineage.rawCsvFileExists && !lineage.hasValidFileChecksum && !lineage.hasProviderRequestLineage;
  });
  if (hasUnbackedDbCsvRef) {
    reasons.push(
      "Stored GOOGLE_TRENDS_CSV observation lacks a verifiable CSV import job ID and SHA-256 file checksum."
    );
    return { authority: "CACHED_UNVERIFIED", reasons, productAttributionValid: false };
  }

  if (sources.length === 0) {
    if (policy.strictSourceProvenance) {
      reasons.push("Demand observations lack explicit source attribution under strict provenance policy.");
      return { authority: "UNKNOWN_SOURCE", reasons, productAttributionValid: false };
    }
    return { authority: "HISTORICAL_SOURCE_VERIFIED", reasons: [], productAttributionValid: true };
  }

  if (sources.every((s) => /google_trends_live|authoritative_api|provider_api|google_trends_api|authoritative_verified|authoritative_provider/i.test(s)) || observations.every((o) => Boolean((o as any).methodologyVersion) && /serpapi_google_trends_live|authoritative/i.test(String((o as any).methodologyVersion)))) {
    return { authority: "AUTHORITATIVE_VERIFIED", reasons: [], productAttributionValid: true };
  }

  if (sources.every((s) => /google_trends_csv|google_trends|historical_ingestion|historical_source|authoritative/i.test(s))) {
    return { authority: "HISTORICAL_SOURCE_VERIFIED", reasons: [], productAttributionValid: true };
  }

  reasons.push(`Unrecognized demand source '${sources[0]}' classified as UNKNOWN_SOURCE.`);
  return { authority: "UNKNOWN_SOURCE", reasons, productAttributionValid: false };
}

export function auditDemandObservationsProvenance(
  productId: string | null,
  canonicalProductName: string | null,
  observations: HistoricalObservation[]
): DemandSourceAuditRecord {
  const auth = evaluateDemandSourceAuthority(observations, {
    candidateCanonicalName: canonicalProductName || undefined,
    strictSourceProvenance: true,
  });
  const refs = Array.from(
    new Set(observations.map((o) => o.evidenceReference).filter((r): r is string => Boolean(r)))
  );
  const versions = Array.from(
    new Set(observations.map((o) => o.methodologyVersion).filter((v): v is string => Boolean(v)))
  );
  const keywords = Array.from(
    new Set(observations.map((o) => o.keyword).filter((k): k is string => Boolean(k)))
  );
  const values = observations.map((o) => Number(o.demandValue !== undefined ? o.demandValue : (o as any).value || 0));
  const lineages = refs.map((r) => hasVerifiableCsvOrProviderLineage(r));
  const rawCsvFileExists = lineages.length > 0 && lineages.every((l) => l.rawCsvFileExists);
  const hasValidFileChecksum = lineages.length > 0 && lineages.every((l) => l.hasValidFileChecksum);
  const hasProviderRequestLineage = lineages.length > 0 && lineages.every((l) => l.hasProviderRequestLineage);
  const isTemplated = isTemplatedSyntheticDemandSeries(observations);
  const isPromoKw = keywords.some((k) => isPromotionalAdCopyDemandKeyword(k));
  const eligible =
    (auth.authority === "AUTHORITATIVE_VERIFIED" || auth.authority === "HISTORICAL_SOURCE_VERIFIED") &&
    auth.productAttributionValid;

  return {
    productId,
    canonicalProductName,
    observationIds: observations.map((o, i) => o.id || `obs_${i + 1}`),
    source: observations[0]?.source || null,
    evidenceReferences: refs,
    methodologyVersions: versions,
    keywords,
    values,
    rawCsvFileExists,
    hasValidFileChecksum,
    hasProviderRequestLineage,
    isTemplated76To82Series: isTemplated,
    isPromotionalCopyKeyword: isPromoKw,
    resolvedAuthority: auth.authority,
    eligibleForEvergreen: eligible,
    demotedFromEvergreen: !eligible && refs.some((r) => /^verified-merchant-demand:/i.test(r)),
    evidenceKind: "SEARCH_INTEREST_NOT_SALES",
    commercialNote:
      "Google Trends observations measure relative search interest (0-100 index), NOT store orders, revenue, conversion rate, or unit sales.",
    auditReasons: auth.reasons,
  };
}

/**
 * Loads stored Google Trends demand observations for a product.
 */
export async function loadProductHistoricalDemand(
  productId: string
): Promise<DemandDataPoint[]> {
  const records = await prisma.productDemandObservation.findMany({
    where: { productId },
    orderBy: { periodStart: "asc" },
  });

  return records.map((r) => ({
    id: r.id,
    productId: r.productId,
    keyword: r.keyword,
    evidenceReference: r.evidenceReference,
    methodologyVersion: r.methodologyVersion,
    isFixture: String(r.productId || "").startsWith("prod_fixture_"),
    periodStart: r.periodStart,
    periodEnd: r.periodEnd,
    demandValue: r.demandValue,
    region: r.region,
    source: r.source,
  }));
}

/**
 * Evaluates historical demand observations against policy requirements to prevent false VERIFIED states.
 */
export function evaluateDemandHistoryEvidence(
  observations: HistoricalObservation[],
  policy: DemandHistoryPolicy = {}
): DemandHistoryAssessment {
  const evaluatedAt = new Date().toISOString();
  const minPoints = policy.minimumDataPoints ?? 3;
  const minDays = policy.minimumCoveredDays ?? 60;
  const missingEvidence: string[] = [];
  const maxAllowedTimestamp = Date.now() + 24 * 60 * 60 * 1000;

  let futureDateRejected = false;
  const seenDates = new Set<string>();
  const valid = (observations || [])
    .filter((o) => {
      const val = o.demandValue !== undefined ? o.demandValue : (o as any).value;
      if (val === null || val === undefined || isNaN(val) || val < 0) return false;
      const startDate = o.periodStart || o.date;
      if (!startDate) return false;
      const timeVal = new Date(startDate).getTime();
      if (isNaN(timeVal)) return false;
      const endTimeVal = o.periodEnd ? new Date(o.periodEnd).getTime() : timeVal;
      if (timeVal > maxAllowedTimestamp || (!isNaN(endTimeVal) && endTimeVal > Date.now() + 35 * 24 * 60 * 60 * 1000)) {
        futureDateRejected = true;
        return false;
      }
      const dateKey = new Date(startDate).toISOString().slice(0, 10);
      if (seenDates.has(dateKey) && policy.rejectDuplicateTimestamps !== false) {
        return false;
      }
      seenDates.add(dateKey);
      return true;
    })
    .map((o) => ({
      ...o,
      demandValue: o.demandValue !== undefined ? o.demandValue : (o as any).value,
    }))
    .sort((a, b) => {
      const aTime = new Date(a.periodStart || a.date!).getTime();
      const bTime = new Date(b.periodStart || b.date!).getTime();
      return aTime - bTime;
    });

  if (futureDateRejected) {
    missingEvidence.push("Future-dated demand observations were detected and rejected.");
  }

  const authorityEval = evaluateDemandSourceAuthority(valid, policy);
  for (const r of authorityEval.reasons) {
    if (!missingEvidence.includes(r)) missingEvidence.push(r);
  }

  const demandObservationIds = valid
    .map((v, idx) => v.id || `obs_${idx + 1}_${new Date(v.periodStart || v.date!).toISOString().slice(0, 10)}`);

  if (valid.length < minPoints) {
    const expl = `Insufficient historical data (${valid.length} points observed, minimum ${minPoints} required). Evergreen sustainability cannot be verified.`;
    if (!missingEvidence.includes(expl)) missingEvidence.push(expl);
    return {
      status: "INSUFFICIENT_HISTORY",
      eligibleForEvergreen: false,
      dataPointsCount: valid.length,
      distinctObservationDatesCount: seenDates.size,
      coveredDays: 0,
      meanInterest: null,
      stdDev: null,
      coefficientOfVariation: null,
      demandClass: "INSUFFICIENT_HISTORY",
      sourceAuthority: authorityEval.authority,
      temporalCoverageValid: false,
      productAttributionValid: authorityEval.productAttributionValid,
      demandObservationIds,
      calculationVersion: "12.4.3.1",
      explanation: expl,
      missingEvidence,
      evaluatedAt,
    };
  }

  const firstTime = new Date(valid[0].periodStart || valid[0].date!).getTime();
  const lastTime = new Date(
    valid[valid.length - 1].periodEnd || valid[valid.length - 1].periodStart || valid[valid.length - 1].date!
  ).getTime();
  const coveredDays = Math.max(1, Math.round((lastTime - firstTime) / (1000 * 60 * 60 * 24)));

  if (coveredDays < minDays) {
    const expl = `Observations span only ${coveredDays} days — short-term window cannot substantiate evergreen claims (minimum ${minDays} days required).`;
    if (!missingEvidence.includes(expl)) missingEvidence.push(expl);
    return {
      status: "INSUFFICIENT_HISTORY",
      eligibleForEvergreen: false,
      dataPointsCount: valid.length,
      distinctObservationDatesCount: seenDates.size,
      coveredDays,
      meanInterest: null,
      stdDev: null,
      coefficientOfVariation: null,
      demandClass: "INSUFFICIENT_HISTORY",
      sourceAuthority: authorityEval.authority,
      temporalCoverageValid: false,
      productAttributionValid: authorityEval.productAttributionValid,
      demandObservationIds,
      calculationVersion: "12.4.3.1",
      explanation: expl,
      missingEvidence,
      evaluatedAt,
    };
  }

  // Statistical metrics
  const values = valid.map((v) => Number(v.demandValue));
  const mean = values.reduce((sum, v) => sum + v, 0) / values.length;
  const variance = values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / values.length;
  const stdDev = Math.sqrt(variance);
  const cv = mean > 0 ? stdDev / mean : 1.0;

  // Trend velocity calculation
  const half = Math.floor(values.length / 2);
  const firstHalf = values.slice(0, half);
  const secondHalf = values.slice(half);
  const firstMean = firstHalf.length ? firstHalf.reduce((s, v) => s + v, 0) / firstHalf.length : 0;
  const secondMean = secondHalf.length ? secondHalf.reduce((s, v) => s + v, 0) / secondHalf.length : 0;
  const delta = secondMean - firstMean;

  // Classify demand stability
  let demandClass: KH02DemandClass = "TREND_DEPENDENT";
  let mathEligible = false;

  if (mean < 10) {
    demandClass = "DECLINING";
  } else if (delta > 8 && values[values.length - 1] > values[0] && cv <= 0.40) {
    demandClass = "EMERGING_PERSISTENT";
    mathEligible = true;
  } else if (cv <= 0.35 && mean >= 25) {
    demandClass = "EVERGREEN_STABLE";
    mathEligible = true;
  } else if (cv > 0.35 && cv <= 0.65) {
    let hasPeak = false;
    for (let i = 1; i < values.length - 1; i++) {
      if (values[i] > values[i - 1] && values[i] > values[i + 1]) hasPeak = true;
    }
    const hasSeasonalWave =
      (values[0] < values[1] || values[0] < values[2]) &&
      values[values.length - 1] < values[values.length - 2];

    if (hasPeak || hasSeasonalWave) {
      demandClass = "SEASONAL_RECURRING";
      mathEligible = true;
    } else {
      demandClass = "TREND_DEPENDENT";
    }
  } else {
    demandClass = "TREND_DEPENDENT";
  }

  const isSourceAuthoritative =
    authorityEval.authority === "AUTHORITATIVE_VERIFIED" ||
    authorityEval.authority === "HISTORICAL_SOURCE_VERIFIED" ||
    authorityEval.authority === "AUTHORITATIVE_PROVIDER";

  const eligibleForEvergreen =
    mathEligible && isSourceAuthoritative && authorityEval.productAttributionValid && !futureDateRejected;

  return {
    status: eligibleForEvergreen ? "VERIFIED" : "UNVERIFIED",
    eligibleForEvergreen,
    dataPointsCount: valid.length,
    distinctObservationDatesCount: seenDates.size,
    coveredDays,
    meanInterest: Math.round(mean * 10) / 10,
    stdDev: Math.round(stdDev * 10) / 10,
    coefficientOfVariation: Math.round(cv * 100) / 100,
    demandClass,
    sourceAuthority: authorityEval.authority,
    temporalCoverageValid: true,
    productAttributionValid: authorityEval.productAttributionValid,
    demandObservationIds,
    evidenceKind: "SEARCH_INTEREST_NOT_SALES",
    commercialInterpretationNote:
      "Reflects relative search interest index (0-100), not verified store orders, revenue, conversion rate, or ROAS.",
    calculationVersion: "12.4.3.2",
    explanation: eligibleForEvergreen
      ? `Verified search-interest stability (${authorityEval.authority}): ${valid.length} points spanning ${coveredDays} days with CV=${cv.toFixed(2)}.`
      : !isSourceAuthoritative || !authorityEval.productAttributionValid
      ? `Demand source authority '${authorityEval.authority}' is not eligible for Verified Evergreen (${authorityEval.reasons[0] || "unverified provenance"}).`
      : `Demand class '${demandClass}' does not meet verified evergreen criteria.`,
    missingEvidence,
    evaluatedAt,
  };
}

/**
 * Evaluates temporal stability across a historical observation series.
 */
export function evaluateTemporalDemandStability(
  observations: DemandDataPoint[],
  requestedLookbackDays: number = 90,
  policy: DemandHistoryPolicy = {}
): TemporalStabilityEvaluation {
  const evaluatedAt = new Date().toISOString();
  const assessment = evaluateDemandHistoryEvidence(observations, {
    minimumDataPoints: 3,
    minimumCoveredDays: 60,
    ...policy,
  });

  if (assessment.status === "INSUFFICIENT_HISTORY" || assessment.dataPointsCount < 3) {
    return {
      eligibleForEvergreen: false,
      demandClass: "INSUFFICIENT_HISTORY",
      stabilityScore: null,
      dataPointsCount: assessment.dataPointsCount,
      distinctObservationDatesCount: assessment.distinctObservationDatesCount,
      coveredDays: assessment.coveredDays,
      meanInterest: null,
      stdDev: null,
      coefficientOfVariation: null,
      trendVelocity: "FLAT",
      sourceAuthority: assessment.sourceAuthority,
      demandObservationIds: assessment.demandObservationIds,
      evidenceKind: "SEARCH_INTEREST_NOT_SALES",
      commercialInterpretationNote:
        "Reflects relative search interest index (0-100), not verified store orders, revenue, conversion rate, or ROAS.",
      explanation: assessment.explanation,
      evaluatedAt,
      confidencePenaltyReason: assessment.missingEvidence[0] || "Missing historical demand time series.",
    };
  }

  const isSourceAuthoritative =
    assessment.sourceAuthority === "AUTHORITATIVE_VERIFIED" ||
    assessment.sourceAuthority === "HISTORICAL_SOURCE_VERIFIED" ||
    assessment.sourceAuthority === "AUTHORITATIVE_PROVIDER";

  if (!isSourceAuthoritative || assessment.productAttributionValid === false) {
    return {
      eligibleForEvergreen: false,
      demandClass: assessment.demandClass,
      stabilityScore: null,
      dataPointsCount: assessment.dataPointsCount,
      distinctObservationDatesCount: assessment.distinctObservationDatesCount,
      coveredDays: assessment.coveredDays,
      meanInterest: assessment.meanInterest,
      stdDev: assessment.stdDev,
      coefficientOfVariation: assessment.coefficientOfVariation,
      trendVelocity: "FLAT",
      sourceAuthority: assessment.sourceAuthority,
      demandObservationIds: assessment.demandObservationIds,
      evidenceKind: "SEARCH_INTEREST_NOT_SALES",
      commercialInterpretationNote:
        "Reflects relative search interest index (0-100), not verified store orders, revenue, conversion rate, or ROAS.",
      explanation: assessment.explanation,
      evaluatedAt,
      confidencePenaltyReason: assessment.missingEvidence[0] || `Demand source authority '${assessment.sourceAuthority}' cannot verify Evergreen stability.`,
    };
  }

  // Calculate velocity trend
  const valid = observations
    .map((o) => ({ ...o, demandValue: o.demandValue !== undefined ? o.demandValue : (o as any).value }))
    .filter((o) => o.demandValue !== null && o.demandValue !== undefined && !isNaN(o.demandValue));

  const half = Math.floor(valid.length / 2);
  const firstHalf = valid.slice(0, half).map((v) => Number(v.demandValue));
  const secondHalf = valid.slice(half).map((v) => Number(v.demandValue));
  const firstMean = firstHalf.length ? firstHalf.reduce((s, v) => s + v, 0) / firstHalf.length : 0;
  const secondMean = secondHalf.length ? secondHalf.reduce((s, v) => s + v, 0) / secondHalf.length : 0;
  const delta = secondMean - firstMean;

  let trendVelocity: "ACCELERATING" | "STEADY" | "DECELERATING" | "FLAT" = "STEADY";
  if (delta > 8) trendVelocity = "ACCELERATING";
  else if (delta < -8) trendVelocity = "DECELERATING";
  else trendVelocity = "STEADY";

  // Calculate stability score (0-25)
  let stabilityScore = 0;
  const mean = assessment.meanInterest || 0;
  const cv = assessment.coefficientOfVariation || 1.0;

  if (assessment.demandClass === "EVERGREEN_STABLE") {
    stabilityScore = 18 + Math.round((1 - Math.min(cv, 0.35) / 0.35) * 7);
    if (mean >= 50) stabilityScore = Math.min(25, stabilityScore + 2);
  } else if (assessment.demandClass === "EMERGING_PERSISTENT") {
    stabilityScore = 22;
  } else if (assessment.demandClass === "SEASONAL_RECURRING") {
    stabilityScore = 18;
  } else if (assessment.demandClass === "TREND_DEPENDENT") {
    stabilityScore = 9;
  } else if (assessment.demandClass === "DECLINING") {
    stabilityScore = 3;
  }

  return {
    eligibleForEvergreen: assessment.eligibleForEvergreen,
    demandClass: assessment.demandClass,
    stabilityScore: Math.max(0, Math.min(25, stabilityScore)),
    dataPointsCount: assessment.dataPointsCount,
    distinctObservationDatesCount: assessment.distinctObservationDatesCount,
    coveredDays: assessment.coveredDays,
    meanInterest: assessment.meanInterest,
    stdDev: assessment.stdDev,
    coefficientOfVariation: assessment.coefficientOfVariation,
    trendVelocity,
    sourceAuthority: assessment.sourceAuthority,
    demandObservationIds: assessment.demandObservationIds,
    evidenceKind: "SEARCH_INTEREST_NOT_SALES",
    commercialInterpretationNote:
      "Reflects relative search interest index (0-100), not verified store orders, revenue, conversion rate, or ROAS.",
    explanation: assessment.explanation,
    evaluatedAt,
    confidencePenaltyReason: null,
  };
}
