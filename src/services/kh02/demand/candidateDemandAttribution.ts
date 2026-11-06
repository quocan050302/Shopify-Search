/**
 * Candidate-Scoped Demand Attribution Policy & Helper
 *
 * Implements strict candidate-scoped observation attribution to prevent cross-candidate,
 * cross-keyword, cross-run, or cross-workspace demand observation leakage for product-specific G15 history.
 *
 * Requirements: KH-02 V12.4.3.7.19.3
 */

import { areExactOrCanonicalEquivalentQueries, normalizeCanonicalQuery } from "./providerObservationRawBinding";
import { detectSpecificProductFamily } from "./temporalDemandEngine";
import {
  verifyDurableCandidateAliasApproval,
  type CandidateAliasApprovalRecord,
} from "./durableCandidateAliasAuthority";

const NON_BRAND_PREFIXES = new Set([
  "the", "a", "an", "automatic", "reusable", "rechargeable", "electric", "portable", "smart", "wireless", "stainless", "self", "pet", "dog", "cat", "multi", "dual"
]);

const SKU_VARIANT_TOKENS = new Set([
  "black", "white", "pink", "blue", "green", "grey", "gray", "silver", "gold",
  "small", "medium", "large", "mini", "pro", "max", "plus", "single", "dual", "double", "triple"
]);

export function extractCandidateBrandToken(title: string | null | undefined): string | null {
  if (!title) return null;
  const tokens = title.trim().split(/\s+/);
  if (tokens.length >= 2) {
    const first = tokens[0].replace(/[^\p{L}\p{N}]/gu, "").toLowerCase();
    if (first.length >= 3 && !NON_BRAND_PREFIXES.has(first)) {
      return first;
    }
  }
  return null;
}

export type CandidateAttributionClassification =
  | "EXACT_CANDIDATE_KEYWORD_MATCH"
  | "VERIFIED_EXPLICIT_ALIAS_MATCH"
  | "KEYWORD_ONLY_UNBOUND"
  | "EXCLUDED_KEYWORD_MISMATCH"
  | "EXCLUDED_UNVERIFIED_ALIAS"
  | "EXCLUDED_CROSS_PRODUCT"
  | "EXCLUDED_WORKSPACE_OR_RUN"
  | "EXCLUDED_REGION"
  | "EXCLUDED_MISSING_PROVENANCE"
  | "EXCLUDED_FUTURE_OR_POST_CUTOFF"
  | "EXCLUDED_FIXTURE_OR_PROXY"
  | "INSUFFICIENT_CANDIDATE_IDENTITY";

export interface VerifiedCandidateAlias {
  aliasKeyword: string;
  targetProductId?: string | null;
  candidateId?: string | null;
  approvedBy: string;
  provenanceReference: string;
  workspaceId?: string | null;
  approvedAt?: string | Date;
  revoked?: boolean;
  approvalSignature?: string | null;
}

const ACCESSORY_TOKENS = new Set([
  "filter", "filters", "replacement", "replacements", "cartridge", "cartridges",
  "cord", "adapter", "battery", "mat", "bowl", "bowls", "tray", "stand", "sponge", "sponges", "foam"
]);

/**
 * Validates whether a candidate alias descriptor possesses authentic, immutable, and scoped approval
 * backed by an independent durable signed approval record.
 */
export function isAuthenticVerifiedCandidateAlias(
  alias: VerifiedCandidateAlias,
  context: CandidateAttributionContext
): { valid: boolean; reason?: string; approvalRecord?: CandidateAliasApprovalRecord; isTestOnly?: boolean; businessEligible?: boolean } {
  if (!alias || typeof alias !== "object") {
    return { valid: false, reason: "Alias descriptor is missing or not an object." };
  }
  if (!alias.aliasKeyword || !String(alias.aliasKeyword).trim()) {
    return { valid: false, reason: "Alias descriptor lacks non-empty aliasKeyword." };
  }
  if (alias.revoked === true) {
    return { valid: false, reason: "Alias authorization is explicitly revoked." };
  }
  if (!alias.approvedBy || !String(alias.approvedBy).trim()) {
    return { valid: false, reason: "Alias lacks authenticated approvedBy authority." };
  }
  const approver = String(alias.approvedBy).trim().toLowerCase();
  if (/(untrusted|anonymous|unknown|mock_bypass|caller_override)/i.test(approver)) {
    return { valid: false, reason: `Alias approvedBy '${alias.approvedBy}' is unauthenticated.` };
  }
  if (!alias.provenanceReference || !String(alias.provenanceReference).trim()) {
    return { valid: false, reason: "Alias lacks immutable provenanceReference." };
  }
  const ref = String(alias.provenanceReference).trim();
  if (!/^(gov_decision_ref_|urn:|sha256:|receipt:|trends-csv:|gov:|alias_appr_)/i.test(ref)) {
    return { valid: false, reason: `Alias provenanceReference '${ref}' lacks verifiable immutable reference prefix.` };
  }

  // Independent verification against durable signed alias authority
  const verification = verifyDurableCandidateAliasApproval(ref, {
    workspaceId: context.workspaceId,
    candidateId: context.candidateId,
    canonicalProductId: context.canonicalProductId,
    candidateCanonicalName: context.candidateCanonicalName,
    researchRunId: context.researchRunId,
    region: context.region,
    asOfTimestamp: context.asOfTimestamp,
    observationKeyword: alias.aliasKeyword,
    scope: context.evaluationScope,
  });

  if (!verification.valid) {
    return {
      valid: false,
      reason: `Independent durable alias authority check failed (${verification.code}): ${verification.reason}`,
    };
  }

  // In explicit BUSINESS scope, test-only records are strictly ineligible for commercial demand attribution
  if (context.evaluationScope === "BUSINESS" && (verification.isTestOnly || !verification.businessEligible)) {
    return {
      valid: false,
      reason: `Independent durable alias authority check failed (TEST_ONLY_ALIAS): Record is marked TEST_ONLY and ineligible for commercial business demand attribution.`,
    };
  }

  return {
    valid: true,
    approvalRecord: verification.record,
    isTestOnly: verification.isTestOnly,
    businessEligible: verification.businessEligible,
  };
}

export interface CandidateAttributionContext {
  candidateId?: string | null;
  researchRunId?: string | null;
  canonicalProductId?: string | null;
  candidateCanonicalName?: string | null;
  searchTermUsed?: string | null;
  authorizedKeywords?: string[];
  workspaceId?: string | null;
  region?: string;
  asOfTimestamp?: string | Date | null;
  strictChronological?: boolean;
  verifiedAliases?: VerifiedCandidateAlias[];
  strictProvenance?: boolean;
  evaluationScope?: "ENGINEERING" | "BUSINESS";
}

export interface CandidateObservationRecord {
  id?: string;
  productId?: string | null;
  keyword?: string | null;
  region?: string | null;
  source?: string | null;
  evidenceReference?: string | null;
  periodStart?: string | Date | null;
  periodEnd?: string | Date | null;
  observedAt?: string | Date | null;
  capturedAt?: string | Date | null;
  demandValue?: number | null;
  value?: number | null;
  isFixture?: boolean;
  workspaceId?: string | null;
  researchRunId?: string | null;
  [key: string]: any;
}

export interface CandidateAttributionResult {
  classification: CandidateAttributionClassification;
  isAttributable: boolean;
  businessAttributable: boolean;
  reason: string;
  candidateId: string | null;
  canonicalProductId: string | null;
  observationProductId: string | null;
  observationKeyword: string | null;
  matchedAlias?: VerifiedCandidateAlias | null;
  approvalRecord?: CandidateAliasApprovalRecord | null;
  isTestOnly?: boolean;
  businessEligible?: boolean;
}

/**
 * Classifies an individual demand observation record against the target candidate context.
 * Strict fail-closed policy: only EXACT_CANDIDATE_KEYWORD_MATCH or VERIFIED_EXPLICIT_ALIAS_MATCH
 * qualify as attributable demand for product-specific G15 Evergreen history.
 */
export function classifyCandidateObservationAttribution(
  observation: CandidateObservationRecord,
  context: CandidateAttributionContext
): CandidateAttributionResult {
  const candidateId = context.candidateId || null;
  const canonicalProductId = context.canonicalProductId || null;
  const observationProductId = observation.productId || null;
  const observationKeyword = observation.keyword ? String(observation.keyword).trim() : null;

  // 1. Check candidate identity sufficiency
  const hasAuthorizedKeywords =
    Array.isArray(context.authorizedKeywords) &&
    context.authorizedKeywords.some((k) => Boolean(k && String(k).trim()));
  const hasCandidateName = Boolean(context.candidateCanonicalName && String(context.candidateCanonicalName).trim());

  if (!canonicalProductId && !candidateId && !hasCandidateName && !hasAuthorizedKeywords) {
    return {
      classification: "INSUFFICIENT_CANDIDATE_IDENTITY",
      isAttributable: false,
      businessAttributable: false,
      reason: "Candidate lacks an unambiguous canonical productId, candidateId, or authorized search keyword.",
      candidateId,
      canonicalProductId,
      observationProductId,
      observationKeyword,
    };
  }

  // 2. Fixture / Proxy / Synthetic check
  const isFixture =
    observation.isFixture === true ||
    (observationProductId !== null && String(observationProductId).startsWith("prod_fixture_")) ||
    (observation.source !== null && observation.source !== undefined && /fixture|mock|synthetic|demo|seed_test/i.test(String(observation.source))) ||
    (observation.evidenceReference !== null && observation.evidenceReference !== undefined && /fixture|mock|synthetic|demo/i.test(String(observation.evidenceReference)));

  if (isFixture) {
    return {
      classification: "EXCLUDED_FIXTURE_OR_PROXY",
      isAttributable: false,
      businessAttributable: false,
      reason: "Demand observation is a test fixture or synthetic mock and cannot verify production Evergreen demand.",
      candidateId,
      canonicalProductId,
      observationProductId,
      observationKeyword,
    };
  }

  // 3. Cross-product mismatch: If observation has a productId and candidate has a canonicalProductId, they must match
  if (canonicalProductId && observationProductId && canonicalProductId !== observationProductId) {
    return {
      classification: "EXCLUDED_CROSS_PRODUCT",
      isAttributable: false,
      businessAttributable: false,
      reason: `Observation productId '${observationProductId}' does not match candidate canonical productId '${canonicalProductId}'.`,
      candidateId,
      canonicalProductId,
      observationProductId,
      observationKeyword,
    };
  }

  // 3b. Unbound observation productId: Candidate has no canonical productId, but observation specifies a foreign productId
  if (!canonicalProductId && observationProductId) {
    return {
      classification: "KEYWORD_ONLY_UNBOUND",
      isAttributable: false,
      businessAttributable: false,
      reason: `Observation specifies productId '${observationProductId}' but candidate has no canonical product ID linking them.`,
      candidateId,
      canonicalProductId,
      observationProductId,
      observationKeyword,
    };
  }

  // 3c. Observation lacks productId while candidate requires canonical productId and lacks verified raw binding
  if (canonicalProductId && !observationProductId && !observation.evidenceReference) {
    return {
      classification: "INSUFFICIENT_CANDIDATE_IDENTITY",
      isAttributable: false,
      businessAttributable: false,
      reason: `Observation lacks productId while candidate requires canonical productId '${canonicalProductId}'.`,
      candidateId,
      canonicalProductId,
      observationProductId,
      observationKeyword,
    };
  }

  // 4. Cross-workspace check
  if (
    context.workspaceId &&
    observation.workspaceId &&
    context.workspaceId !== observation.workspaceId
  ) {
    return {
      classification: "EXCLUDED_WORKSPACE_OR_RUN",
      isAttributable: false,
      businessAttributable: false,
      reason: `Observation workspaceId '${observation.workspaceId}' does not match candidate workspaceId '${context.workspaceId}'.`,
      candidateId,
      canonicalProductId,
      observationProductId,
      observationKeyword,
    };
  }

  // 5. Cross-research-run check
  if (
    context.researchRunId &&
    observation.researchRunId &&
    context.researchRunId !== observation.researchRunId
  ) {
    return {
      classification: "EXCLUDED_WORKSPACE_OR_RUN",
      isAttributable: false,
      businessAttributable: false,
      reason: `Observation researchRunId '${observation.researchRunId}' does not match candidate researchRunId '${context.researchRunId}'.`,
      candidateId,
      canonicalProductId,
      observationProductId,
      observationKeyword,
    };
  }

  // 6. Region check
  const requiredRegion = (context.region || "US").trim().toUpperCase();
  if (observation.region) {
    const obsRegion = String(observation.region).trim().toUpperCase();
    if (obsRegion !== requiredRegion) {
      return {
        classification: "EXCLUDED_REGION",
        isAttributable: false,
        businessAttributable: false,
        reason: `Observation region '${obsRegion}' does not match required region '${requiredRegion}'.`,
        candidateId,
        canonicalProductId,
        observationProductId,
        observationKeyword,
      };
    }
  }

  // 7. Date / As-of / Future cutoff check
  const maxAllowedTimestamp = context.strictChronological === true ? Date.now() : Date.now() + 24 * 60 * 60 * 1000;
  const asOfTime = context.asOfTimestamp ? new Date(context.asOfTimestamp).getTime() : null;

  const startDate = observation.periodStart || observation.date;
  if (startDate) {
    const startMs = new Date(startDate).getTime();
    if (!isNaN(startMs)) {
      if (startMs > maxAllowedTimestamp) {
        return {
          classification: "EXCLUDED_FUTURE_OR_POST_CUTOFF",
          isAttributable: false,
          businessAttributable: false,
          reason: `Observation periodStart '${startDate}' is in the future relative to execution cutoff.`,
          candidateId,
          canonicalProductId,
          observationProductId,
          observationKeyword,
        };
      }
      if (asOfTime !== null && startMs > asOfTime) {
        return {
          classification: "EXCLUDED_FUTURE_OR_POST_CUTOFF",
          isAttributable: false,
          businessAttributable: false,
          reason: `Observation periodStart '${startDate}' exceeds as-of cutoff '${context.asOfTimestamp}'.`,
          candidateId,
          canonicalProductId,
          observationProductId,
          observationKeyword,
        };
      }
    }
  }

  const availabilityTimestamps = [
    observation.observedAt,
    observation.capturedAt,
    (observation as any).ingestedAt,
  ].filter(Boolean);

  if (asOfTime !== null) {
    for (const ts of availabilityTimestamps) {
      const ms = new Date(ts!).getTime();
      if (!isNaN(ms) && ms > asOfTime) {
        return {
          classification: "EXCLUDED_FUTURE_OR_POST_CUTOFF",
          isAttributable: false,
          businessAttributable: false,
          reason: `Observation availability timestamp '${ts}' exceeds as-of cutoff '${context.asOfTimestamp}'.`,
          candidateId,
          canonicalProductId,
          observationProductId,
          observationKeyword,
        };
      }
    }
  }

  // 8. Missing provenance check (if strict provenance requested or observation claims authority)
  const isMerchantDomainPseudoRef =
    observation.evidenceReference &&
    String(observation.evidenceReference).startsWith("verified-merchant-demand:");

  if (context.strictProvenance && (!observation.evidenceReference || isMerchantDomainPseudoRef)) {
    return {
      classification: "EXCLUDED_MISSING_PROVENANCE",
      isAttributable: false,
      businessAttributable: false,
      reason: isMerchantDomainPseudoRef
        ? "Observation uses 'verified-merchant-demand:<domain>' pseudo-reference without raw CSV checksum or provider receipt."
        : "Observation lacks verifiable evidenceReference under strict provenance policy.",
      candidateId,
      canonicalProductId,
      observationProductId,
      observationKeyword,
    };
  }

  // 9. Keyword matching:
  // Build full list of candidate's authorized search queries:
  const authorizedQueries = new Set<string>();
  if (context.candidateCanonicalName) {
    authorizedQueries.add(context.candidateCanonicalName);
  }
  if (Array.isArray(context.authorizedKeywords)) {
    for (const kw of context.authorizedKeywords) {
      if (kw) authorizedQueries.add(kw);
    }
  }

  if (!observationKeyword) {
    return {
      classification: "EXCLUDED_KEYWORD_MISMATCH",
      isAttributable: false,
      businessAttributable: false,
      reason: "Observation has null or empty keyword.",
      candidateId,
      canonicalProductId,
      observationProductId,
      observationKeyword,
    };
  }

  // Check exact / canonical equivalence against authorized candidate queries
  let exactMatch = false;
  for (const authQuery of authorizedQueries) {
    if (areExactOrCanonicalEquivalentQueries(observationKeyword, authQuery)) {
      exactMatch = true;
      break;
    }
  }

  if (exactMatch) {
    return {
      classification: "EXACT_CANDIDATE_KEYWORD_MATCH",
      isAttributable: true,
      businessAttributable: !isFixture && context.evaluationScope !== "ENGINEERING",
      reason: `Observation keyword '${observationKeyword}' canonically matches authorized candidate query.`,
      candidateId,
      canonicalProductId,
      observationProductId,
      observationKeyword,
    };
  }

  // 9b. Keyword does not exactly match authorized queries; check discriminating attributes
  const candNameNorm = normalizeCanonicalQuery(context.candidateCanonicalName || "");
  const obsKwNorm = normalizeCanonicalQuery(observationKeyword);
  const candFamily = context.candidateCanonicalName ? detectSpecificProductFamily(context.candidateCanonicalName) : null;
  const obsFamily = detectSpecificProductFamily(observationKeyword);
  const brandToken = extractCandidateBrandToken(context.candidateCanonicalName);

  const candTokens = new Set(candNameNorm.split(/\s+/).filter(Boolean));
  const obsTokens = new Set(obsKwNorm.split(/\s+/).filter(Boolean));

  // Check for conflicting SKU variant tokens (e.g. Black Edition vs White Edition)
  const candVariantTokens = Array.from(candTokens).filter((t) => SKU_VARIANT_TOKENS.has(t));
  const obsVariantTokens = Array.from(obsTokens).filter((t) => SKU_VARIANT_TOKENS.has(t));
  const hasConflictingVariant =
    (candVariantTokens.length > 0 && obsVariantTokens.length > 0 && candVariantTokens.some((t) => !obsTokens.has(t))) ||
    (obsVariantTokens.some((t) => !candTokens.has(t)));

  if (hasConflictingVariant) {
    return {
      classification: "EXCLUDED_UNVERIFIED_ALIAS",
      isAttributable: false,
      businessAttributable: false,
      reason: `Observation keyword '${observationKeyword}' contains conflicting SKU variant attribute(s) relative to candidate '${context.candidateCanonicalName}'.`,
      candidateId,
      canonicalProductId,
      observationProductId,
      observationKeyword,
    };
  }

  // Check if observation is an accessory / part (e.g. filter, replacement, cord) for a main product
  const isAccessory = Array.from(obsTokens).some((t) => ACCESSORY_TOKENS.has(t));
  const candidateIsAccessory = Array.from(candTokens).some((t) => ACCESSORY_TOKENS.has(t));
  if (isAccessory && !candidateIsAccessory) {
    return {
      classification: "EXCLUDED_KEYWORD_MISMATCH",
      isAttributable: false,
      businessAttributable: false,
      reason: `Observation keyword '${observationKeyword}' is an accessory/replacement part rather than candidate product '${context.candidateCanonicalName}'.`,
      candidateId,
      canonicalProductId,
      observationProductId,
      observationKeyword,
    };
  }

  // Check if observation keyword belongs to a different functional product family
  if (candFamily && obsFamily && candFamily !== obsFamily) {
    return {
      classification: "EXCLUDED_KEYWORD_MISMATCH",
      isAttributable: false,
      businessAttributable: false,
      reason: `Observation keyword family '${obsFamily}' does not match candidate family '${candFamily}' despite shared brand or token overlap.`,
      candidateId,
      canonicalProductId,
      observationProductId,
      observationKeyword,
    };
  }

  // 10. Check explicit verified aliases with authentic independent authorization
  if (Array.isArray(context.verifiedAliases) && context.verifiedAliases.length > 0) {
    for (const alias of context.verifiedAliases) {
      if (!alias || typeof alias !== "object" || !alias.aliasKeyword) {
        continue;
      }
      if (areExactOrCanonicalEquivalentQueries(observationKeyword, alias.aliasKeyword)) {
        const aliasAuth = isAuthenticVerifiedCandidateAlias(alias, context);
        if (aliasAuth.valid) {
          const isBusinessAttributable =
            !isFixture &&
            context.evaluationScope !== "ENGINEERING" &&
            aliasAuth.businessEligible === true &&
            aliasAuth.isTestOnly !== true;

          return {
            classification: "VERIFIED_EXPLICIT_ALIAS_MATCH",
            isAttributable: true,
            businessAttributable: isBusinessAttributable,
            reason: `Observation keyword '${observationKeyword}' matches verified alias '${alias.aliasKeyword}' (approvedBy: ${alias.approvedBy}, ref: ${alias.provenanceReference}).`,
            candidateId,
            canonicalProductId,
            observationProductId,
            observationKeyword,
            matchedAlias: alias,
            approvalRecord: aliasAuth.approvalRecord || null,
            isTestOnly: aliasAuth.isTestOnly || false,
            businessEligible: aliasAuth.businessEligible,
          };
        } else {
          return {
            classification: "EXCLUDED_UNVERIFIED_ALIAS",
            isAttributable: false,
            businessAttributable: false,
            reason: `Observation keyword '${observationKeyword}' matched alias descriptor but authorization was rejected: ${aliasAuth.reason}`,
            candidateId,
            canonicalProductId,
            observationProductId,
            observationKeyword,
          };
        }
      }
    }
  }

  // 10b. Check legitimate brand-core noun query or unbranded functional prefix match
  if (brandToken) {
    // Branded candidate (e.g. "UAHPET Fresh Food Automatic Pet Feeder"):
    // Observation keyword must contain candidate brand token, have >=2 tokens (brand + product noun),
    // and ALL observation tokens must be a subset of candidate's tokens.
    if (
      obsTokens.size >= 2 &&
      obsTokens.has(brandToken) &&
      Array.from(obsTokens).every((t) => candTokens.has(t)) &&
      (!obsFamily || !candFamily || obsFamily === candFamily)
    ) {
      return {
        classification: "EXACT_CANDIDATE_KEYWORD_MATCH",
        isAttributable: true,
        businessAttributable: !isFixture && context.evaluationScope !== "ENGINEERING",
        reason: `Observation keyword '${observationKeyword}' is the legitimate brand ('${brandToken}') core product query for candidate '${context.candidateCanonicalName}'.`,
        candidateId,
        canonicalProductId,
        observationProductId,
        observationKeyword,
      };
    }
  } else {
    // Unbranded candidate (e.g. "Dog Water Fountain Stainless Steel", "Automatic Wet Food Cat Feeder with Cooling & Warming"):
    // Observation keyword must be a valid functional leading prefix of candidate title
    if (
      candNameNorm.startsWith(obsKwNorm) &&
      obsKwNorm.length >= 8 &&
      Array.from(obsTokens).every((t) => candTokens.has(t)) &&
      (!obsFamily || !candFamily || obsFamily === candFamily)
    ) {
      return {
        classification: "EXACT_CANDIDATE_KEYWORD_MATCH",
        isAttributable: true,
        businessAttributable: !isFixture && context.evaluationScope !== "ENGINEERING",
        reason: `Observation keyword '${observationKeyword}' is the core functional prefix of unbranded candidate '${context.candidateCanonicalName}'.`,
        candidateId,
        canonicalProductId,
        observationProductId,
        observationKeyword,
      };
    }
  }

  // 11. Keyword is NOT an exact match and NOT a verified alias.
  // Distinguish UNVERIFIED_ALIAS (token overlap or family match) from complete KEYWORD_MISMATCH:
  const tokenOverlap = Array.from(obsTokens).some((t) => t.length > 2 && candTokens.has(t));

  const isPotentialAlias =
    (candFamily && obsFamily && candFamily === obsFamily) || tokenOverlap;

  if (isPotentialAlias) {
    return {
      classification: "EXCLUDED_UNVERIFIED_ALIAS",
      isAttributable: false,
      businessAttributable: false,
      reason: `Observation keyword '${observationKeyword}' shares family ('${obsFamily || "none"}') or tokens with candidate '${context.candidateCanonicalName || ""}' but lacks an explicit verified alias.`,
      candidateId,
      canonicalProductId,
      observationProductId,
      observationKeyword,
    };
  }

  return {
    classification: "EXCLUDED_KEYWORD_MISMATCH",
    isAttributable: false,
    businessAttributable: false,
    reason: `Observation keyword '${observationKeyword}' does not match candidate query and has no verified alias.`,
    candidateId,
    canonicalProductId,
    observationProductId,
    observationKeyword,
  };
}

export interface AttributionPartitionSummary {
  totalInputObservations: number;
  attributableCount: number;
  businessAttributableCount: number;
  excludedCount: number;
  classifications: Record<CandidateAttributionClassification, number>;
  attributableObservations: CandidateObservationRecord[];
  businessAttributableObservations: CandidateObservationRecord[];
  excludedObservations: Array<{
    observation: CandidateObservationRecord;
    result: CandidateAttributionResult;
  }>;
}

/**
 * Partitions a list of observation records into candidate-attributable and excluded subsets.
 */
export function filterAttributableObservations(
  observations: CandidateObservationRecord[],
  context: CandidateAttributionContext
): AttributionPartitionSummary {
  const attributableObservations: CandidateObservationRecord[] = [];
  const businessAttributableObservations: CandidateObservationRecord[] = [];
  const excludedObservations: Array<{
    observation: CandidateObservationRecord;
    result: CandidateAttributionResult;
  }> = [];

  const classifications: Record<CandidateAttributionClassification, number> = {
    EXACT_CANDIDATE_KEYWORD_MATCH: 0,
    VERIFIED_EXPLICIT_ALIAS_MATCH: 0,
    EXCLUDED_KEYWORD_MISMATCH: 0,
    EXCLUDED_UNVERIFIED_ALIAS: 0,
    EXCLUDED_CROSS_PRODUCT: 0,
    EXCLUDED_WORKSPACE_OR_RUN: 0,
    EXCLUDED_REGION: 0,
    EXCLUDED_MISSING_PROVENANCE: 0,
    EXCLUDED_FUTURE_OR_POST_CUTOFF: 0,
    EXCLUDED_FIXTURE_OR_PROXY: 0,
    INSUFFICIENT_CANDIDATE_IDENTITY: 0,
    KEYWORD_ONLY_UNBOUND: 0,
  };

  for (const obs of observations) {
    const res = classifyCandidateObservationAttribution(obs, context);
    classifications[res.classification] = (classifications[res.classification] || 0) + 1;
    if (res.isAttributable) {
      attributableObservations.push(obs);
    } else {
      excludedObservations.push({ observation: obs, result: res });
    }
    if (res.businessAttributable) {
      businessAttributableObservations.push(obs);
    }
  }

  return {
    totalInputObservations: observations.length,
    attributableCount: attributableObservations.length,
    businessAttributableCount: businessAttributableObservations.length,
    excludedCount: excludedObservations.length,
    classifications,
    attributableObservations,
    businessAttributableObservations,
    excludedObservations,
  };
}
