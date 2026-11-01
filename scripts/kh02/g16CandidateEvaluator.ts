/**
 * SWAI KH-02 V12.4.3.4.6 — G16 Strict Same-Run Live Lineage, Merchant Proof & Top-3 Distinctness Evaluator
 *
 * Enforces non-gameable multi-predicate qualification for Top-3 candidates:
 * 1. Explicit per-observation live provenance (never inferred from candidate.liveObservationsCount).
 * 2. Exact nonblank current researchRunId / executionRunId lineage (or verified parent-child run linkage).
 * 3. Observation-to-candidate product linkage (belongsToCandidateProduct) and observation ID deduplication.
 * 4. Independent merchant/product identity verification proof (never storeDomain + canonicalProductUrl strings alone).
 * 5. Top-3 distinctness across both canonical products (>=3) and product families (>=3 for broad niches).
 */

import {
  isFunnelOrCheckoutChamp,
  isSyntheticMerchantProofRef,
  isFabricatedHydrationObservation,
  classifyPersistedLiveObservation,
  validatePersistedMerchantProofRecord,
  extractPersistedMerchantProofsFromDbRows,
  classifyHistoricalProductIdentity,
  computeSha256Hex,
  type MerchantProofValidationStatus,
  type MerchantProofMethod,
  type OriginEvidenceClassification,
  type PersistedMerchantProofRecord,
  type PersistedAdObservationRow,
  type PersistedDiscoveryRunAdRow,
} from "../../src/services/kh02/identity/merchantIdentityPolicy";

export {
  isFunnelOrCheckoutChamp,
  isSyntheticMerchantProofRef,
  isFabricatedHydrationObservation,
  classifyPersistedLiveObservation,
  validatePersistedMerchantProofRecord,
  extractPersistedMerchantProofsFromDbRows,
};

export interface NormalizedObservationIdentity {
  observationId: string | null;
  sourceRecordId: string | null;
  upstreamAdId: string | null;
  providerRequestId: string | null;
  mcpInvocationRef?: string | null;
  evidenceReference: string | null;
  researchRunId: string | null;
  executionRunId: string | null;
  provenance: string | null;
  sourceMode: string | null;
  sourceType: string | null;
  isCached: boolean;
  candidateId: string | null;
  researchProductId: string | null;
  storeDomain: string | null;
  landingPageUrl: string | null;
}

export interface G16LineageIndex {
  parentRunId?: string;
  validChildRunIds?: string[];
  allowedObservationIds?: Set<string> | string[];
}

export interface G16IdentityIndex {
  candidateObservationMap?: Record<string, string[]>;
}

export interface G16MerchantEvidenceIndex {
  [candidateId: string]: {
    verified: boolean;
    proofRefs?: string[];
    schemaVerified?: boolean;
    hasJsonLdProduct?: boolean;
    proofMethod?: MerchantProofMethod;
    validationStatus?: MerchantProofValidationStatus;
    fetchOutcome?: string;
    merchantVerifiedProductName?: string;
    hasRootDomainJsonLdSchema?: boolean;
    persistedProofs?: PersistedMerchantProofRecord[];
  };
}

export interface G16EvidenceIndex {
  lineageIndex?: G16LineageIndex;
  identityIndex?: G16IdentityIndex;
  merchantEvidenceIndex?: G16MerchantEvidenceIndex;
  strictPersistedProofRequired?: boolean;
  workspaceId?: string;
  asOf?: Date | string;
}

export interface CandidatePredicateResults {
  authenticallyLive: boolean;
  sameRunLineage: boolean;
  candidateProductMatch: boolean;
  verifiedMerchantIdentity: boolean;
  nonFunnelStore: boolean;
}

export interface CandidateEvaluationResult {
  candidateId: string;
  title: string;
  storeDomain: string | null;
  canonicalProductUrl: string | null;
  canonicalProductKey: string;
  familyKey: string;
  identityStatus: "VERIFIED" | "PROBABLE" | "UNVERIFIED";
  isCheckoutChampFunnel: boolean;
  liveObservationsCount: number;
  validLineageObservationsCount: number;
  liveObservationIds: string[];
  merchantVerified: boolean;
  merchantProofRefs: string[];
  predicateResults: CandidatePredicateResults;
  isLiveVerified: boolean;
  rejectionReasons: string[];
  verificationMethod: string;
  notes: string;
}

export interface G16Top3EvaluationOptions {
  requireDistinctFamilies?: boolean;
  requiredCount?: number;
  evidenceIndex?: G16EvidenceIndex;
}

export interface G16Top3EvaluationResult {
  evaluatedAt: string;
  researchRunId: string;
  totalCandidates: number;
  verifiedLiveCount: number;
  requiredCount: number;
  distinctFamiliesCount: number;
  distinctCanonicalProductsCount: number;
  requireDistinctFamilies: boolean;
  g16Verdict: "PASS" | "INSUFFICIENT_EVIDENCE";
  top3RejectionReasons: string[];
  entries: CandidateEvaluationResult[];
  notes: string;
}

const NON_MERCHANT_DOMAINS = new Set([
  "facebook.com",
  "www.facebook.com",
  "l.facebook.com",
  "m.facebook.com",
  "fb.com",
  "fb.me",
  "instagram.com",
  "www.instagram.com",
  "l.instagram.com",
  "tiktok.com",
  "www.tiktok.com",
  "google.com",
  "www.google.com",
  "adstransparency.google.com",
  "youtube.com",
  "www.youtube.com",
  "doubleclick.net",
  "ad.doubleclick.net",
  "bit.ly",
  "tinyurl.com",
  "tiny.cc",
]);

function cleanNonBlankString(val: unknown): string | null {
  if (typeof val !== "string") return null;
  const trimmed = val.trim();
  if (!trimmed || trimmed.toLowerCase() === "unknown" || trimmed.toLowerCase() === "null" || trimmed.toLowerCase() === "undefined") {
    return null;
  }
  return trimmed;
}

function normalizeHost(rawDomainOrUrl: string | null | undefined): string | null {
  const clean = cleanNonBlankString(rawDomainOrUrl);
  if (!clean) return null;
  try {
    const withProto = /^https?:\/\//i.test(clean) ? clean : `https://${clean}`;
    const u = new URL(withProto);
    return u.hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return clean.toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").split("/")[0] || null;
  }
}

function extractProductPathKey(rawUrl: string | null | undefined): string | null {
  const clean = cleanNonBlankString(rawUrl);
  if (!clean) return null;
  try {
    const u = new URL(clean);
    const host = u.hostname.toLowerCase().replace(/^www\./, "");
    const pathPart = u.pathname.toLowerCase().replace(/\/+$/, "");
    if (!pathPart || pathPart === "/") return null;
    return `${host}${pathPart}`;
  } catch {
    return null;
  }
}

/**
 * Normalizes an observation into a deterministic identity structure.
 * Unknown or missing observation IDs return observationId: null so they cannot inflate counts.
 */
export function normalizeObservationIdentity(observation: any): NormalizedObservationIdentity {
  if (!observation || typeof observation !== "object") {
    return {
      observationId: null,
      sourceRecordId: null,
      upstreamAdId: null,
      providerRequestId: null,
      mcpInvocationRef: null,
      evidenceReference: null,
      researchRunId: null,
      executionRunId: null,
      provenance: null,
      sourceMode: null,
      sourceType: null,
      isCached: true,
      candidateId: null,
      researchProductId: null,
      storeDomain: null,
      landingPageUrl: null,
    };
  }

  const rawObsId =
    cleanNonBlankString(observation.sourceObservationId) ||
    cleanNonBlankString(observation.observationId) ||
    cleanNonBlankString(observation.id) ||
    cleanNonBlankString(observation.sourceRecordId);

  const sourceRecordId = cleanNonBlankString(observation.sourceRecordId) || rawObsId;
  const upstreamAdId =
    cleanNonBlankString(observation.upstreamAdId) ||
    cleanNonBlankString(observation.sourceExternalAdId) ||
    cleanNonBlankString(observation.creativeId) ||
    cleanNonBlankString(observation.creative_id);
  const providerRequestId =
    cleanNonBlankString(observation.providerRequestId) ||
    cleanNonBlankString(observation.metrics?.providerRequestId);
  const mcpInvocationRef = cleanNonBlankString(observation.mcpInvocationRef);
  const evidenceReference =
    cleanNonBlankString(observation.evidenceReference) ||
    cleanNonBlankString(observation.queryId) ||
    cleanNonBlankString(observation.metrics?.queryId);
  const researchRunId =
    cleanNonBlankString(observation.researchRunId) ||
    cleanNonBlankString(observation.metrics?.researchRunId);
  const executionRunId =
    cleanNonBlankString(observation.executionRunId) ||
    cleanNonBlankString(observation.metrics?.executionRunId);

  const provenance = cleanNonBlankString(observation.provenance);
  const sourceMode = cleanNonBlankString(observation.sourceMode);
  const sourceType = cleanNonBlankString(observation.sourceType);

  const explicitlyCached =
    observation.isCached === true ||
    observation.isLiveRecord === false ||
    observation.metrics?.isFreshLive === false ||
    provenance === "CACHED_SOURCE" ||
    provenance === "CACHED_DB" ||
    provenance === "TEST_FIXTURE" ||
    provenance === "CONTROLLED_FIXTURE" ||
    sourceMode === "CACHE_ONLY" ||
    sourceMode === "CACHED_SOURCE" ||
    sourceType === "CACHED_SOURCE" ||
    sourceType === "CACHED_DB";

  return {
    observationId: rawObsId,
    sourceRecordId,
    upstreamAdId,
    providerRequestId,
    mcpInvocationRef,
    evidenceReference,
    researchRunId,
    executionRunId,
    provenance,
    sourceMode,
    sourceType,
    isCached: explicitlyCached,
    candidateId: cleanNonBlankString(observation.candidateId),
    researchProductId: cleanNonBlankString(observation.researchProductId),
    storeDomain: normalizeHost(
      observation.storeDomainEvidence || observation.advertiserDomain || observation.storeDomain
    ),
    landingPageUrl: cleanNonBlankString(observation.landingPageUrl),
  };
}

/**
 * Pure predicate: returns true ONLY when the observation itself carries explicit live provenance,
 * is not cached, has a real observation/source record ID, and has non-empty provider request/evidence metadata.
 * NEVER inspects candidate.liveObservationsCount or any candidate-level numeric aggregate.
 */
export function isAuthenticallyLiveObservation(
  observation: any,
  evidenceIndex?: G16EvidenceIndex
): boolean {
  const norm = normalizeObservationIdentity(observation);
  if (!norm.observationId || !norm.sourceRecordId) {
    return false;
  }
  if (norm.isCached) {
    return false;
  }
  if (isFabricatedHydrationObservation(observation, norm.researchRunId)) {
    return false;
  }

  // Enforce immutable persisted origin checks (`L01..L16`) when persisted DB fields or envelopes are present
  if (observation?.persistedLiveOriginVerified === false) {
    return false;
  }
  if (
    observation?.originEvidenceClassification &&
    observation.originEvidenceClassification !== "AUTHENTIC_LIVE_INGEST"
  ) {
    return false;
  }
  if (
    observation?.ingestOutcome !== undefined &&
    observation?.ingestOutcome !== null &&
    String(observation.ingestOutcome).trim().toUpperCase() !== "NEW"
  ) {
    return false;
  }
  if (
    observation?.evidenceType !== undefined &&
    observation?.evidenceType !== null &&
    ["MANUAL_ENTRY", "USER_OBSERVED", "SYNTHETIC", "TEST_FIXTURE"].includes(
      String(observation.evidenceType).trim().toUpperCase()
    )
  ) {
    return false;
  }

  // If immutable persisted rows are attached, re-verify via `classifyPersistedLiveObservation`
  // so in-memory `provenance = "LIVE_PROVIDER"` mutation (`L15`) cannot bypass origin truth
  if (observation?.persistedAdObservation && observation?.persistedDiscoveryRunAd) {
    const originCheck = classifyPersistedLiveObservation({
      adObservation: observation.persistedAdObservation as PersistedAdObservationRow,
      discoveryRunAd: observation.persistedDiscoveryRunAd as PersistedDiscoveryRunAdRow,
      expectedWorkspaceId:
        cleanNonBlankString(
          evidenceIndex?.workspaceId ||
            observation.workspaceId ||
            observation.persistedDiscoveryRunAd?.workspaceId
        ) || "",
      expectedRunId: norm.researchRunId || norm.executionRunId,
      expectedCandidateId: norm.candidateId,
      expectedStoreDomain: norm.storeDomain,
      asOf: evidenceIndex?.asOf,
    });
    if (!originCheck.isAuthenticLiveProviderObservation) {
      return false;
    }
  } else if ("rawPayload" in (observation || {})) {
    // Observation directly carries a persisted `rawPayload` field (`L03`, `L05`, `L06`, `L08`, `L15`, `L16`)
    const syntheticRunAd: PersistedDiscoveryRunAdRow = {
      runId: norm.researchRunId || norm.executionRunId || "",
      adId: cleanNonBlankString(observation.adId || observation.persistedAdId || norm.sourceRecordId) || "",
      workspaceId: cleanNonBlankString(observation.workspaceId || evidenceIndex?.workspaceId) || "ws_default",
      providerId: cleanNonBlankString(observation.provider || observation.providerId) || "META_AD_LIBRARY",
      ingestOutcome: cleanNonBlankString(observation.ingestOutcome) || "NEW",
      sourceUrl: cleanNonBlankString(observation.sourceUrl || observation.evidenceReference || norm.landingPageUrl) || "https://www.facebook.com/ads/library/",
      observedAt: observation.observedAt ?? new Date().toISOString(),
    };
    const syntheticAdObs: PersistedAdObservationRow = {
      id: norm.observationId,
      adId: syntheticRunAd.adId,
      observedAt: observation.observedAt ?? new Date().toISOString(),
      sourceTimestamp: observation.sourceTimestamp ?? observation.observedAt ?? new Date().toISOString(),
      evidenceType: cleanNonBlankString(observation.evidenceType) || "SCRAPED_POST",
      verificationMethod: cleanNonBlankString(observation.verificationMethod) || "AUTOMATED_SCRAPE",
      evidenceReference:
        cleanNonBlankString(observation.evidenceReference || observation.sourceUrl) ||
        "https://www.facebook.com/ads/library/",
      rawPayload: observation.rawPayload,
    };
    const originCheck = classifyPersistedLiveObservation({
      adObservation: syntheticAdObs,
      discoveryRunAd: syntheticRunAd,
      expectedWorkspaceId: syntheticRunAd.workspaceId,
      expectedRunId: syntheticRunAd.runId,
      expectedCandidateId: norm.candidateId,
      expectedStoreDomain: norm.storeDomain,
      asOf: evidenceIndex?.asOf,
    });
    if (!originCheck.isAuthenticLiveProviderObservation) {
      return false;
    }
  }

  // Enforce temporal validity when `observedAt` / `sourceTimestamp` or `evidenceIndex.asOf` is present (`L12`, `L13`)
  if (observation?.observedAt !== undefined && observation?.observedAt !== null) {
    const d = new Date(observation.observedAt);
    if (Number.isNaN(d.getTime())) return false;
    if (evidenceIndex?.asOf) {
      const asOfD = new Date(evidenceIndex.asOf);
      if (Number.isNaN(asOfD.getTime()) || d.getTime() > asOfD.getTime()) return false;
    }
  }
  if (observation?.sourceTimestamp !== undefined && observation?.sourceTimestamp !== null) {
    const d = new Date(observation.sourceTimestamp);
    if (Number.isNaN(d.getTime())) return false;
    if (evidenceIndex?.asOf) {
      const asOfD = new Date(evidenceIndex.asOf);
      if (Number.isNaN(asOfD.getTime()) || d.getTime() > asOfD.getTime()) return false;
    }
  }

  const hasLiveProvenance =
    norm.provenance === "LIVE_PROVIDER" || norm.provenance === "REAL_UPSTREAM";
  if (!hasLiveProvenance) {
    return false;
  }

  const hasExplicitLiveModeOrType =
    norm.sourceMode === "LIVE_PROVIDER" ||
    norm.sourceType === "LIVE_PROVIDER" ||
    observation?.isLiveRecord === true ||
    observation?.metrics?.isFreshLive === true;
  if (!hasExplicitLiveModeOrType) {
    return false;
  }

  const hasRequestOrEvidenceMetadata = Boolean(
    norm.providerRequestId || norm.mcpInvocationRef || norm.evidenceReference
  );
  if (!hasRequestOrEvidenceMetadata) {
    return false;
  }

  if (evidenceIndex?.lineageIndex?.allowedObservationIds) {
    const allowed =
      evidenceIndex.lineageIndex.allowedObservationIds instanceof Set
        ? evidenceIndex.lineageIndex.allowedObservationIds
        : new Set(evidenceIndex.lineageIndex.allowedObservationIds);
    if (!allowed.has(norm.observationId) && (!norm.sourceRecordId || !allowed.has(norm.sourceRecordId))) {
      return false;
    }
  }

  return true;
}

/**
 * Pure predicate: returns true ONLY when observation carries an exact nonblank researchRunId/executionRunId
 * matching currentRunId, or when lineageIndex proves an explicit parent-child run linkage for the same live run.
 * Missing or blank run IDs ALWAYS return false.
 */
export function belongsToCurrentResearchRun(
  observation: any,
  currentRunId: string,
  lineageIndex?: G16LineageIndex
): boolean {
  const cleanTargetRunId = cleanNonBlankString(currentRunId);
  if (!cleanTargetRunId) {
    return false;
  }

  const norm = normalizeObservationIdentity(observation);
  if (!norm.researchRunId && !norm.executionRunId) {
    return false;
  }

  if (norm.researchRunId === cleanTargetRunId || norm.executionRunId === cleanTargetRunId) {
    return true;
  }

  if (
    lineageIndex &&
    cleanNonBlankString(lineageIndex.parentRunId) === cleanTargetRunId &&
    Array.isArray(lineageIndex.validChildRunIds)
  ) {
    const validChildren = new Set(
      lineageIndex.validChildRunIds.map((id) => cleanNonBlankString(id)).filter(Boolean) as string[]
    );
    if (
      (norm.researchRunId && validChildren.has(norm.researchRunId)) ||
      (norm.executionRunId && validChildren.has(norm.executionRunId))
    ) {
      return true;
    }
  }

  return false;
}

/**
 * Pure predicate: verifies that the observation belongs to the evaluated candidate product
 * and does not conflict with the candidate's product/merchant identity.
 */
export function belongsToCandidateProduct(
  observation: any,
  candidate: any,
  identityIndex?: G16IdentityIndex
): boolean {
  if (!observation || !candidate) return false;
  const norm = normalizeObservationIdentity(observation);
  const candId = cleanNonBlankString(candidate.candidateId);
  const candProductId = cleanNonBlankString(candidate.researchProductId);
  const candDomain = normalizeHost(candidate.storeDomain || candidate.canonicalProductUrl);
  const candPathKey = extractProductPathKey(candidate.canonicalProductUrl);

  // 1. Explicit candidateId mismatch is an immediate rejection
  if (norm.candidateId && candId && norm.candidateId !== candId) {
    return false;
  }

  // 2. Explicit researchProductId mismatch (when both are distinct non-candidate product IDs)
  if (
    norm.researchProductId &&
    candProductId &&
    norm.researchProductId !== candProductId &&
    norm.researchProductId !== candId
  ) {
    return false;
  }

  // 3. Explicit merchant domain conflict (if observation specifies a merchant domain that differs from candidate's storeDomain)
  if (
    norm.storeDomain &&
    !NON_MERCHANT_DOMAINS.has(norm.storeDomain) &&
    candDomain &&
    norm.storeDomain !== candDomain
  ) {
    return false;
  }

  // 4. Explicit product URL handle conflict
  const obsPathKey = extractProductPathKey(norm.landingPageUrl);
  if (
    obsPathKey &&
    candPathKey &&
    obsPathKey.includes("/products/") &&
    candPathKey.includes("/products/") &&
    obsPathKey !== candPathKey
  ) {
    return false;
  }

  // 5. Require at least one positive linkage signal between observation and candidate
  if (norm.candidateId && candId && norm.candidateId === candId) {
    return true;
  }
  if (norm.researchProductId && candProductId && norm.researchProductId === candProductId) {
    return true;
  }
  if (obsPathKey && candPathKey && obsPathKey === candPathKey) {
    return true;
  }
  if (
    norm.storeDomain &&
    candDomain &&
    norm.storeDomain === candDomain &&
    !NON_MERCHANT_DOMAINS.has(norm.storeDomain)
  ) {
    return true;
  }

  if (Array.isArray(candidate.supportingAdIds) && candidate.supportingAdIds.length > 0) {
    const adIds = new Set(candidate.supportingAdIds.map((id: any) => String(id).trim()));
    if (
      (norm.sourceRecordId && adIds.has(norm.sourceRecordId)) ||
      (norm.observationId && adIds.has(norm.observationId)) ||
      (observation.persistedAdId && adIds.has(String(observation.persistedAdId).trim()))
    ) {
      return true;
    }
  }

  if (Array.isArray(candidate.supportingExternalAdIds) && candidate.supportingExternalAdIds.length > 0) {
    const extIds = new Set(candidate.supportingExternalAdIds.map((id: any) => String(id).trim()));
    if (norm.upstreamAdId && extIds.has(norm.upstreamAdId)) {
      return true;
    }
  }

  if (candId && identityIndex?.candidateObservationMap?.[candId]) {
    const mapped = new Set(identityIndex.candidateObservationMap[candId]);
    if (
      (norm.observationId && mapped.has(norm.observationId)) ||
      (norm.sourceRecordId && mapped.has(norm.sourceRecordId))
    ) {
      return true;
    }
  }

  return false;
}

/**
 * Extracts independent merchant verification proof references for a candidate.
 * Never counts raw storeDomain or canonicalProductUrl strings alone as proof,
 * and rejects synthetic proof strings (`jsonld:<domain>`).
 * When `strictPersistedProofRequired` is true or `merchantEvidenceIndex[candId].verified === false`,
 * only persisted evidence index entries are accepted (inline snapshot strings are ignored).
 */
export function extractMerchantProofRefs(
  candidate: any,
  merchantEvidenceIndex?: G16MerchantEvidenceIndex,
  strictPersistedProofRequired?: boolean
): string[] {
  if (!candidate || typeof candidate !== "object") return [];
  const refs: string[] = [];

  const candId = cleanNonBlankString(candidate.candidateId);
  const indexHasCandidate = Boolean(candId && merchantEvidenceIndex && candId in merchantEvidenceIndex);
  const indexEntry = candId && merchantEvidenceIndex ? merchantEvidenceIndex[candId] : undefined;

  if (strictPersistedProofRequired || (indexHasCandidate && indexEntry?.verified === false)) {
    if (indexEntry?.verified === true) {
      if (
        indexEntry.validationStatus &&
        indexEntry.validationStatus !== "CONTENT_VALIDATED_WITH_SOURCE"
      ) {
        return [];
      }
      if (Array.isArray(indexEntry.persistedProofs)) {
        const validPersisted = indexEntry.persistedProofs.filter(
          (p) =>
            validatePersistedMerchantProofRecord(p, {
              candidateWorkspaceId: candidate.workspaceId,
              candidateDomain: candidate.storeDomain,
              candidateCanonicalUrl: candidate.canonicalProductUrl,
              candidateTitle: candidate.title,
              expectedSku: candidate.sku,
              expectedMerchantProductId: candidate.merchantProductId,
              asOf: new Date(),
            }).valid
        );
        if (validPersisted.length === 0) {
          return [];
        }
      }
      if (Array.isArray(indexEntry.proofRefs) && indexEntry.proofRefs.length > 0) {
        for (const r of indexEntry.proofRefs) {
          const cr = cleanNonBlankString(r);
          if (cr && !isSyntheticMerchantProofRef(cr)) {
            refs.push(`indexProof:${cr}`);
          }
        }
      } else if (
        (indexEntry.schemaVerified ||
          indexEntry.fetchOutcome === "FETCH_SUCCEEDED" ||
          indexEntry.merchantVerifiedProductName) &&
        (!indexEntry.validationStatus ||
          indexEntry.validationStatus === "CONTENT_VALIDATED_WITH_SOURCE")
      ) {
        refs.push(`indexVerified:${candId}`);
      }
    }
    return Array.from(new Set(refs));
  }

  const verifiedName = cleanNonBlankString(candidate.merchantVerifiedProductName);
  if (verifiedName && !isSyntheticMerchantProofRef(verifiedName)) {
    refs.push(`merchantVerifiedProductName:${verifiedName}`);
  }

  const fetchOutcome = cleanNonBlankString(candidate.fetchOutcome);
  if (
    fetchOutcome === "FETCH_SUCCEEDED" ||
    fetchOutcome === "ACTUAL_PRODUCT_PAGE" ||
    fetchOutcome === "EXISTING_DB_PRODUCT"
  ) {
    refs.push(`fetchOutcome:${fetchOutcome}`);
  }

  const resolutionSource = cleanNonBlankString(candidate.resolutionSource);
  if (
    resolutionSource === "MERCHANT_PRODUCT_METADATA" ||
    resolutionSource === "JSON_LD_PRODUCT_SCHEMA" ||
    resolutionSource === "SHOPIFY_PRODUCT_JSON" ||
    resolutionSource === "EXISTING_VERIFIED_PRODUCT"
  ) {
    refs.push(`resolutionSource:${resolutionSource}`);
  }

  const skuOrId =
    cleanNonBlankString(candidate.merchantProductId) ||
    cleanNonBlankString(candidate.sku) ||
    cleanNonBlankString(candidate.gtin);
  if (skuOrId && !isSyntheticMerchantProofRef(skuOrId)) {
    refs.push(`productIdentifier:${skuOrId}`);
  }

  if (candidate.merchantPageVerified === true || candidate.existingProductVerified === true) {
    // Only accept merchantPageVerified:true if not paired solely with a synthetic jsonld:<domain> ref
    const hasOnlySyntheticProofRefs =
      Array.isArray(candidate.merchantVerificationProofRefs) &&
      candidate.merchantVerificationProofRefs.length > 0 &&
      candidate.merchantVerificationProofRefs.every((r: any) => isSyntheticMerchantProofRef(String(r || "")));
    if (!hasOnlySyntheticProofRefs) {
      refs.push("merchantPageVerified:true");
    }
  }

  const verificationReason = cleanNonBlankString(candidate.verificationReason);
  if (
    verificationReason &&
    !isSyntheticMerchantProofRef(verificationReason) &&
    /(?:json-ld|schema|storefront|shopify|fetched|merchant product|product page verified)/i.test(
      verificationReason
    )
  ) {
    refs.push(`verificationReason:${verificationReason.slice(0, 120)}`);
  }

  if (Array.isArray(candidate.merchantVerificationProofRefs)) {
    for (const ref of candidate.merchantVerificationProofRefs) {
      const cleanRef = cleanNonBlankString(ref);
      if (
        cleanRef &&
        cleanRef !== candidate.canonicalProductUrl &&
        cleanRef !== candidate.storeDomain &&
        !isSyntheticMerchantProofRef(cleanRef)
      ) {
        refs.push(`proofRef:${cleanRef}`);
      }
    }
  }

  if (Array.isArray(candidate.identityEvidenceReferences)) {
    for (const ref of candidate.identityEvidenceReferences) {
      const cleanRef = cleanNonBlankString(ref);
      if (
        cleanRef &&
        cleanRef !== candidate.canonicalProductUrl &&
        cleanRef !== candidate.storeDomain &&
        !isSyntheticMerchantProofRef(cleanRef)
      ) {
        refs.push(`evidenceRef:${cleanRef}`);
      }
    }
  }

  if (candId && indexEntry?.verified === true) {
    if (Array.isArray(indexEntry.proofRefs) && indexEntry.proofRefs.length > 0) {
      for (const r of indexEntry.proofRefs) {
        const cr = cleanNonBlankString(r);
        if (cr && !isSyntheticMerchantProofRef(cr)) {
          refs.push(`indexProof:${cr}`);
        }
      }
    } else if (
      indexEntry.schemaVerified ||
      indexEntry.fetchOutcome === "FETCH_SUCCEEDED" ||
      indexEntry.merchantVerifiedProductName
    ) {
      refs.push(`indexVerified:${candId}`);
    }
  }

  return Array.from(new Set(refs));
}

/**
 * Pure predicate: verifies independent merchant & product identity proof.
 * Never passes on Boolean(storeDomain) && Boolean(canonicalUrl) alone.
 */
export function hasVerifiedMerchantIdentity(
  candidate: any,
  merchantEvidenceIndex?: G16MerchantEvidenceIndex,
  strictPersistedProofRequired?: boolean
): boolean {
  if (!candidate || typeof candidate !== "object") return false;

  const storeDomain = normalizeHost(candidate.storeDomain);
  const canonicalUrl = cleanNonBlankString(candidate.canonicalProductUrl);
  if (!storeDomain || !canonicalUrl) return false;
  if (!storeDomain.includes(".") || NON_MERCHANT_DOMAINS.has(storeDomain)) return false;

  if (isFunnelOrCheckoutChamp(storeDomain, canonicalUrl)) {
    return false;
  }

  if (candidate.identityStatus !== "VERIFIED") {
    return false;
  }

  // Validate canonicalProductUrl is a well-formed HTTP(S) product URL matching the store domain
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(canonicalUrl);
    if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") return false;
  } catch {
    return false;
  }

  const urlHost = parsedUrl.hostname.toLowerCase().replace(/^www\./, "");
  if (urlHost !== storeDomain && !urlHost.endsWith(`.${storeDomain}`)) {
    return false;
  }

  const pathname = parsedUrl.pathname.toLowerCase();
  if (!pathname || pathname === "/" || pathname.startsWith("/collections") || pathname.startsWith("/search") || pathname.startsWith("/blogs")) {
    return false;
  }
  if (/\/products\/(?:null|undefined|nan|none|placeholder)(?:[-_]\d+)?(?:\/|$|\?)/i.test(pathname)) {
    return false;
  }

  if (
    candidate.fetchOutcome === "HTTP_404" ||
    candidate.fetchOutcome === "HOMEPAGE" ||
    candidate.fetchOutcome === "COLLECTION_PAGE" ||
    candidate.sourcePageClassification === "COLLECTION_PAGE" ||
    candidate.sourcePageClassification === "CAMPAIGN_PAGE"
  ) {
    return false;
  }

  const proofRefs = extractMerchantProofRefs(
    candidate,
    merchantEvidenceIndex,
    strictPersistedProofRequired
  );
  return proofRefs.length > 0;
}

/**
 * Computes a normalized canonical product key for Top-3 distinctness verification.
 */
export function resolveCanonicalProductKey(candidate: any): string {
  const pathKey = extractProductPathKey(candidate?.canonicalProductUrl);
  if (pathKey) return pathKey;
  const prodKey = cleanNonBlankString(candidate?.productKey) || cleanNonBlankString(candidate?.listingKey);
  if (prodKey) return prodKey.toLowerCase();
  const domain = normalizeHost(candidate?.storeDomain) || "unknown-domain";
  const title = (cleanNonBlankString(candidate?.canonicalProductName) || cleanNonBlankString(candidate?.title) || "unknown-product")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return `${domain}::${title}`;
}

/**
 * Pure evaluation function for an individual candidate under G16 rules.
 */
export function evaluateG16Candidate(
  candidate: any,
  currentResearchRunId: string,
  evidenceIndex?: G16EvidenceIndex
): CandidateEvaluationResult {
  const rejectionReasons: string[] = [];

  const storeDomain = cleanNonBlankString(candidate?.storeDomain);
  const canonicalUrl = cleanNonBlankString(candidate?.canonicalProductUrl);
  const familyKey = cleanNonBlankString(candidate?.familyKey) || "unknown";
  const canonicalProductKey = resolveCanonicalProductKey(candidate);

  // 1. Anti-gaming CheckoutChamp / funnel check
  const isCheckoutChampFunnel = isFunnelOrCheckoutChamp(storeDomain, canonicalUrl);

  // Under anti-gaming rules, sales funnels without standard merchant schema are strictly PROBABLE
  const identityStatus: "VERIFIED" | "PROBABLE" | "UNVERIFIED" = isCheckoutChampFunnel
    ? "PROBABLE"
    : (candidate?.identityStatus === "VERIFIED" || candidate?.identityStatus === "PROBABLE" || candidate?.identityStatus === "UNVERIFIED"
        ? candidate.identityStatus
        : "PROBABLE");

  if (isCheckoutChampFunnel) {
    rejectionReasons.push("CheckoutChamp/sales funnel cannot be VERIFIED without root JSON-LD merchant schema");
  }

  // 2. Independent merchant page & identity proof verification
  const merchantProofRefs = extractMerchantProofRefs(
    candidate,
    evidenceIndex?.merchantEvidenceIndex,
    evidenceIndex?.strictPersistedProofRequired
  );
  const merchantVerified = hasVerifiedMerchantIdentity(
    candidate,
    evidenceIndex?.merchantEvidenceIndex,
    evidenceIndex?.strictPersistedProofRequired
  );
  if (!storeDomain || !canonicalUrl) {
    rejectionReasons.push("Missing verified merchant store domain or canonical URL");
  } else if (!merchantVerified) {
    rejectionReasons.push("Missing independent merchant verification proof (URL strings alone are insufficient)");
  }

  // 3. Per-observation live provenance, current-run lineage, and candidate product linkage
  const observations = Array.isArray(candidate?.sourceObservations)
    ? candidate.sourceObservations
    : [];

  let anyAuthenticallyLive = false;
  let anySameRunLineage = false;
  let anyCandidateProductMatch = false;

  const deduplicatedLiveObsIds = new Set<string>();

  for (const obs of observations) {
    const liveOk = isAuthenticallyLiveObservation(obs, evidenceIndex);
    const runOk = belongsToCurrentResearchRun(obs, currentResearchRunId, evidenceIndex?.lineageIndex);
    const prodOk = belongsToCandidateProduct(obs, candidate, evidenceIndex?.identityIndex);

    if (liveOk) anyAuthenticallyLive = true;
    if (runOk) anySameRunLineage = true;
    if (prodOk) anyCandidateProductMatch = true;

    if (liveOk && runOk && prodOk) {
      const norm = normalizeObservationIdentity(obs);
      if (norm.observationId) {
        deduplicatedLiveObsIds.add(norm.observationId);
      }
    }
  }

  const liveObservationIds = Array.from(deduplicatedLiveObsIds);
  const validLineageCount = liveObservationIds.length;

  if (observations.length === 0) {
    rejectionReasons.push("Candidate has zero sourceObservations attached (numeric liveObservationsCount fallback is forbidden)");
  } else {
    if (!anyAuthenticallyLive) {
      rejectionReasons.push("Zero observations carry explicit live provider provenance and non-cached request metadata");
    }
    if (!anySameRunLineage) {
      rejectionReasons.push(`Zero observations match current researchRunId '${currentResearchRunId || "<empty>"}'`);
    }
    if (!anyCandidateProductMatch) {
      rejectionReasons.push("Zero observations match this candidate's product/merchant identity");
    }
    if (validLineageCount === 0 && anyAuthenticallyLive && anySameRunLineage && anyCandidateProductMatch) {
      rejectionReasons.push("Zero single observations simultaneously satisfied live provenance, current-run lineage, and candidate product match");
    }
  }

  if (identityStatus !== "VERIFIED") {
    rejectionReasons.push(`Identity status is '${identityStatus}', expected 'VERIFIED'`);
  }

  const predicateResults: CandidatePredicateResults = {
    authenticallyLive: validLineageCount > 0,
    sameRunLineage: validLineageCount > 0,
    candidateProductMatch: validLineageCount > 0,
    verifiedMerchantIdentity: merchantVerified,
    nonFunnelStore: !isCheckoutChampFunnel,
  };

  // Strict qualification requirement: ALL predicates must pass
  const isLiveVerified =
    identityStatus === "VERIFIED" &&
    !isCheckoutChampFunnel &&
    merchantVerified &&
    validLineageCount > 0;

  const verificationMethod = isLiveVerified
    ? "STORE_METADATA_JSON_LD_WITH_SAME_RUN_LIVE_LINEAGE"
    : isCheckoutChampFunnel
    ? "FUNNEL_PROBABLE_NO_JSON_LD"
    : validLineageCount === 0
    ? "UNVERIFIED_LINEAGE_ABSENT"
    : !merchantVerified
    ? "UNVERIFIED_MERCHANT_PROOF_ABSENT"
    : "PROBABLE_IDENTITY_ONLY";

  const notes = isLiveVerified
    ? `Standard merchant store with verified product identity (${merchantProofRefs.length} proof refs) and ${validLineageCount} deduplicated same-run live observation(s).`
    : isCheckoutChampFunnel
    ? "CheckoutChamp multi-step sales funnel retained strictly as PROBABLE under anti-gaming identity rules."
    : `Candidate failed qualification: ${rejectionReasons.join("; ")}`;

  return {
    candidateId: candidate?.candidateId || "unknown_candidate",
    title: candidate?.title || "Untitled Candidate",
    storeDomain,
    canonicalProductUrl: canonicalUrl,
    canonicalProductKey,
    familyKey,
    identityStatus,
    isCheckoutChampFunnel,
    liveObservationsCount: candidate?.liveObservationsCount || 0,
    validLineageObservationsCount: validLineageCount,
    liveObservationIds,
    merchantVerified,
    merchantProofRefs,
    predicateResults,
    isLiveVerified,
    rejectionReasons,
    verificationMethod,
    notes,
  };
}

/**
 * Pure evaluation function for the entire Top-3 shortlist under G16.
 * Requires >= 3 live-verified candidates, >= 3 distinct canonical products, and >= 3 distinct families (when broad niche).
 */
export function evaluateG16Top3(
  shortlistCandidates: any[],
  currentResearchRunId: string,
  options?: G16Top3EvaluationOptions
): G16Top3EvaluationResult {
  const requiredCount = options?.requiredCount ?? 3;
  const requireDistinctFamilies = options?.requireDistinctFamilies !== false;
  const safeList = Array.isArray(shortlistCandidates) ? shortlistCandidates : [];

  const entries = safeList.map((c) =>
    evaluateG16Candidate(c, currentResearchRunId, options?.evidenceIndex)
  );

  const verifiedEntries = entries.filter((e) => e.isLiveVerified);
  const verifiedLiveCount = verifiedEntries.length;

  const distinctFamilies = new Set(
    verifiedEntries
      .map((e) => e.familyKey)
      .filter((fk) => Boolean(fk && fk !== "unknown"))
  );
  const distinctCanonicalProducts = new Set(
    verifiedEntries.map((e) => e.canonicalProductKey).filter(Boolean)
  );

  const top3RejectionReasons: string[] = [];
  if (verifiedLiveCount < requiredCount) {
    top3RejectionReasons.push(
      `Only ${verifiedLiveCount}/${requiredCount} candidates qualified as live-verified in run '${currentResearchRunId}'.`
    );
  }
  if (distinctCanonicalProducts.size < requiredCount) {
    top3RejectionReasons.push(
      `Only ${distinctCanonicalProducts.size}/${requiredCount} distinct canonical products among live-verified candidates.`
    );
  }
  if (requireDistinctFamilies && distinctFamilies.size < requiredCount) {
    top3RejectionReasons.push(
      `Only ${distinctFamilies.size}/${requiredCount} distinct product families among live-verified candidates.`
    );
  }

  const g16Verdict: "PASS" | "INSUFFICIENT_EVIDENCE" =
    verifiedLiveCount >= requiredCount &&
    distinctCanonicalProducts.size >= requiredCount &&
    (!requireDistinctFamilies || distinctFamilies.size >= requiredCount)
      ? "PASS"
      : "INSUFFICIENT_EVIDENCE";

  return {
    evaluatedAt: new Date().toISOString(),
    researchRunId: currentResearchRunId,
    totalCandidates: safeList.length,
    verifiedLiveCount,
    requiredCount,
    distinctFamiliesCount: distinctFamilies.size,
    distinctCanonicalProductsCount: distinctCanonicalProducts.size,
    requireDistinctFamilies,
    g16Verdict,
    top3RejectionReasons,
    entries,
    notes:
      g16Verdict === "PASS"
        ? `All ${requiredCount} top candidates verified live in current run with ${distinctCanonicalProducts.size} distinct canonical products and ${distinctFamilies.size} distinct product families.`
        : top3RejectionReasons.join(" ") + " Fails closed as INSUFFICIENT_EVIDENCE.",
  };
}

function makeValidLiveObs(overrides: Record<string, any> = {}) {
  return {
    sourceObservationId: "sobs_live_1",
    sourceRecordId: "ad_1",
    provenance: "LIVE_PROVIDER",
    sourceMode: "LIVE_PROVIDER",
    sourceType: "LIVE_PROVIDER",
    isCached: false,
    isLiveRecord: true,
    researchRunId: "run_123",
    providerRequestId: "req_run_123_q1",
    evidenceReference: "CompetitorAd:ad_1",
    storeDomainEvidence: "uahpet.com",
    landingPageUrl: "https://uahpet.com/products/fountain",
    ...overrides,
  };
}

function makeValidMerchantCandidate(overrides: Record<string, any> = {}) {
  return {
    candidateId: "c1",
    title: "UAHPET Stainless Steel Pet Water Fountain",
    storeDomain: "uahpet.com",
    canonicalProductUrl: "https://uahpet.com/products/fountain",
    familyKey: "pet_water_fountain",
    identityStatus: "VERIFIED",
    fetchOutcome: "FETCH_SUCCEEDED",
    resolutionSource: "MERCHANT_PRODUCT_METADATA",
    merchantVerifiedProductName: "UAHPET Stainless Steel Pet Water Fountain",
    verificationReason: "Verified via Shopify storefront JSON-LD product schema",
    supportingAdIds: ["ad_1"],
    liveObservationsCount: 1,
    sourceObservations: [makeValidLiveObs()],
    ...overrides,
  };
}

export function runG16NegativeTests(): {
  totalTests: number;
  totalPassed: number;
  passed: boolean;
  cases: Array<{ testId: string; description: string; passed: boolean }>;
} {
  const cases = [
    {
      testId: "G16-MAT-A",
      description: "VERIFIED candidate with liveObservationsCount=5 and sourceObservations=[] fails with validLineageObservationsCount=0",
      exec: () => {
        const cand = makeValidMerchantCandidate({
          liveObservationsCount: 5,
          sourceObservations: [],
        });
        const res = evaluateG16Candidate(cand, "run_123");
        return res.isLiveVerified === false && res.validLineageObservationsCount === 0;
      },
    },
    {
      testId: "G16-MAT-B",
      description: "VERIFIED candidate with observation having provenance=CACHED_DB while candidate.liveObservationsCount=3 fails",
      exec: () => {
        const cand = makeValidMerchantCandidate({
          liveObservationsCount: 3,
          sourceObservations: [
            makeValidLiveObs({
              provenance: "CACHED_DB",
              sourceMode: "CACHE_ONLY",
              isCached: true,
            }),
          ],
        });
        const res = evaluateG16Candidate(cand, "run_123");
        return res.isLiveVerified === false && res.validLineageObservationsCount === 0;
      },
    },
    {
      testId: "G16-MAT-C",
      description: "VERIFIED candidate with live observation missing researchRunId and executionRunId fails",
      exec: () => {
        const cand = makeValidMerchantCandidate({
          sourceObservations: [
            makeValidLiveObs({
              researchRunId: null,
              executionRunId: undefined,
            }),
          ],
        });
        const res = evaluateG16Candidate(cand, "run_123");
        return res.isLiveVerified === false && res.validLineageObservationsCount === 0;
      },
    },
    {
      testId: "G16-MAT-D",
      description: "VERIFIED candidate with live observation from prior run run_old evaluated under run_new fails",
      exec: () => {
        const cand = makeValidMerchantCandidate({
          sourceObservations: [
            makeValidLiveObs({
              researchRunId: "run_old",
            }),
          ],
        });
        const res = evaluateG16Candidate(cand, "run_new");
        return res.isLiveVerified === false && res.validLineageObservationsCount === 0;
      },
    },
    {
      testId: "G16-MAT-E",
      description: "VERIFIED candidate with two duplicate observations having the same sourceObservationId deduplicates count to 1",
      exec: () => {
        const cand = makeValidMerchantCandidate({
          sourceObservations: [
            makeValidLiveObs({ sourceObservationId: "sobs_dup_1" }),
            makeValidLiveObs({ sourceObservationId: "sobs_dup_1" }),
          ],
        });
        const res = evaluateG16Candidate(cand, "run_123");
        return res.isLiveVerified === true && res.validLineageObservationsCount === 1 && res.liveObservationIds.length === 1;
      },
    },
    {
      testId: "G16-MAT-F",
      description: "Candidate with storeDomain and canonicalProductUrl strings present but no merchant verification proof fails",
      exec: () => {
        const cand = {
          candidateId: "c_unproven_merchant",
          title: "Pet Water Fountain",
          storeDomain: "uahpet.com",
          canonicalProductUrl: "https://uahpet.com/products/fountain",
          familyKey: "pet_water_fountain",
          identityStatus: "VERIFIED",
          supportingAdIds: ["ad_1"],
          liveObservationsCount: 1,
          sourceObservations: [makeValidLiveObs()],
        };
        const res = evaluateG16Candidate(cand, "run_123");
        return res.merchantVerified === false && res.isLiveVerified === false && res.merchantProofRefs.length === 0;
      },
    },
    {
      testId: "G16-MAT-G",
      description: "CheckoutChamp / funnel domain with identityStatus=VERIFIED and live observations is downgraded to PROBABLE and fails",
      exec: () => {
        const cand = makeValidMerchantCandidate({
          candidateId: "c_funnel",
          title: "Uproot Clean Pro",
          storeDomain: "cc.uprootclean.com",
          canonicalProductUrl: "https://cc.uprootclean.com/special-offer",
          identityStatus: "VERIFIED",
          sourceObservations: [
            makeValidLiveObs({
              storeDomainEvidence: "cc.uprootclean.com",
              landingPageUrl: "https://cc.uprootclean.com/special-offer",
            }),
          ],
        });
        const res = evaluateG16Candidate(cand, "run_123");
        return res.isLiveVerified === false && res.identityStatus === "PROBABLE" && res.isCheckoutChampFunnel === true;
      },
    },
    {
      testId: "G16-MAT-H",
      description: "PROBABLE candidate with valid same-run live observations remains PROBABLE and fails G16",
      exec: () => {
        const cand = makeValidMerchantCandidate({
          candidateId: "c_prob",
          identityStatus: "PROBABLE",
        });
        const res = evaluateG16Candidate(cand, "run_123");
        return res.isLiveVerified === false && res.identityStatus === "PROBABLE";
      },
    },
    {
      testId: "G16-MAT-I",
      description: "Three live-verified candidates where two share the same familyKey in a broad niche fail Top-3 with INSUFFICIENT_EVIDENCE",
      exec: () => {
        const c1 = makeValidMerchantCandidate({ candidateId: "c1", familyKey: "fountain_family" });
        const c2 = makeValidMerchantCandidate({
          candidateId: "c2",
          storeDomain: "kittyspout.com",
          canonicalProductUrl: "https://kittyspout.com/products/spout",
          familyKey: "fountain_family",
          supportingAdIds: ["ad_2"],
          sourceObservations: [
            makeValidLiveObs({
              sourceObservationId: "sobs_2",
              sourceRecordId: "ad_2",
              storeDomainEvidence: "kittyspout.com",
              landingPageUrl: "https://kittyspout.com/products/spout",
            }),
          ],
        });
        const c3 = makeValidMerchantCandidate({
          candidateId: "c3",
          storeDomain: "petlibro.com",
          canonicalProductUrl: "https://petlibro.com/products/feeder",
          familyKey: "feeder_family",
          supportingAdIds: ["ad_3"],
          sourceObservations: [
            makeValidLiveObs({
              sourceObservationId: "sobs_3",
              sourceRecordId: "ad_3",
              storeDomainEvidence: "petlibro.com",
              landingPageUrl: "https://petlibro.com/products/feeder",
            }),
          ],
        });
        const res = evaluateG16Top3([c1, c2, c3], "run_123");
        return (
          res.verifiedLiveCount === 3 &&
          res.distinctFamiliesCount === 2 &&
          res.g16Verdict === "INSUFFICIENT_EVIDENCE"
        );
      },
    },
    {
      testId: "G16-MAT-J",
      description: "Three live-verified candidates where two resolve to the same canonical product URL/handle fail Top-3 with INSUFFICIENT_EVIDENCE",
      exec: () => {
        const c1 = makeValidMerchantCandidate({ candidateId: "c1", familyKey: "f1" });
        const c2 = makeValidMerchantCandidate({ candidateId: "c2", familyKey: "f2" }); // same canonicalProductUrl as c1!
        const c3 = makeValidMerchantCandidate({
          candidateId: "c3",
          storeDomain: "petlibro.com",
          canonicalProductUrl: "https://petlibro.com/products/feeder",
          familyKey: "f3",
          supportingAdIds: ["ad_3"],
          sourceObservations: [
            makeValidLiveObs({
              sourceObservationId: "sobs_3",
              sourceRecordId: "ad_3",
              storeDomainEvidence: "petlibro.com",
              landingPageUrl: "https://petlibro.com/products/feeder",
            }),
          ],
        });
        const res = evaluateG16Top3([c1, c2, c3], "run_123");
        return (
          res.verifiedLiveCount === 3 &&
          res.distinctCanonicalProductsCount === 2 &&
          res.g16Verdict === "INSUFFICIENT_EVIDENCE"
        );
      },
    },
    {
      testId: "G16-MAT-K",
      description: "Two valid live-verified candidates + one funnel/PROBABLE candidate produces verifiedLiveCount=2 and INSUFFICIENT_EVIDENCE",
      exec: () => {
        const c1 = makeValidMerchantCandidate({ candidateId: "c1", familyKey: "f1" });
        const c2 = makeValidMerchantCandidate({
          candidateId: "c2",
          storeDomain: "kittyspout.com",
          canonicalProductUrl: "https://kittyspout.com/products/spout",
          familyKey: "f2",
          supportingAdIds: ["ad_2"],
          sourceObservations: [
            makeValidLiveObs({
              sourceObservationId: "sobs_2",
              sourceRecordId: "ad_2",
              storeDomainEvidence: "kittyspout.com",
              landingPageUrl: "https://kittyspout.com/products/spout",
            }),
          ],
        });
        const c3 = makeValidMerchantCandidate({
          candidateId: "c3",
          storeDomain: "cc.uprootclean.com",
          canonicalProductUrl: "https://cc.uprootclean.com/special-offer",
          familyKey: "f3",
          identityStatus: "PROBABLE",
        });
        const res = evaluateG16Top3([c1, c2, c3], "run_123");
        return res.verifiedLiveCount === 2 && res.g16Verdict === "INSUFFICIENT_EVIDENCE";
      },
    },
    {
      testId: "G16-MAT-L",
      description: "Three genuinely distinct, merchant-verified, same-run live-observed candidates across three families PASS G16",
      exec: () => {
        const c1 = makeValidMerchantCandidate({ candidateId: "c1", familyKey: "f1" });
        const c2 = makeValidMerchantCandidate({
          candidateId: "c2",
          storeDomain: "kittyspout.com",
          canonicalProductUrl: "https://kittyspout.com/products/spout",
          familyKey: "f2",
          supportingAdIds: ["ad_2"],
          sourceObservations: [
            makeValidLiveObs({
              sourceObservationId: "sobs_2",
              sourceRecordId: "ad_2",
              storeDomainEvidence: "kittyspout.com",
              landingPageUrl: "https://kittyspout.com/products/spout",
            }),
          ],
        });
        const c3 = makeValidMerchantCandidate({
          candidateId: "c3",
          storeDomain: "petlibro.com",
          canonicalProductUrl: "https://petlibro.com/products/feeder",
          familyKey: "f3",
          supportingAdIds: ["ad_3"],
          sourceObservations: [
            makeValidLiveObs({
              sourceObservationId: "sobs_3",
              sourceRecordId: "ad_3",
              storeDomainEvidence: "petlibro.com",
              landingPageUrl: "https://petlibro.com/products/feeder",
            }),
          ],
        });
        const res = evaluateG16Top3([c1, c2, c3], "run_123");
        return (
          res.verifiedLiveCount === 3 &&
          res.distinctFamiliesCount === 3 &&
          res.distinctCanonicalProductsCount === 3 &&
          res.g16Verdict === "PASS"
        );
      },
    },
    {
      testId: "G16-MAT-M",
      description: "Observation belonging to a different candidate product/store domain fails belongsToCandidateProduct and G16",
      exec: () => {
        const cand = makeValidMerchantCandidate({
          candidateId: "c1",
          supportingAdIds: ["ad_1"],
          sourceObservations: [
            makeValidLiveObs({
              candidateId: "other_candidate",
              storeDomainEvidence: "unrelated-store.com",
              landingPageUrl: "https://unrelated-store.com/products/other-gadget",
              sourceRecordId: "ad_other",
            }),
          ],
        });
        const res = evaluateG16Candidate(cand, "run_123");
        return res.isLiveVerified === false && res.validLineageObservationsCount === 0;
      },
    },
    {
      testId: "G16-MAT-N",
      description: "Fabricated hydration observation IDs (obs_<runId>_<candId> and req_<runId>) are rejected by isAuthenticallyLiveObservation",
      exec: () => {
        const cand = makeValidMerchantCandidate({
          candidateId: "cand_123",
          sourceObservations: [
            makeValidLiveObs({
              observationId: "obs_run_123_cand_123",
              sourceObservationId: "obs_run_123_cand_123",
              providerRequestId: "req_run_123",
              researchRunId: "run_123",
              candidateId: "cand_123",
            }),
          ],
        });
        const res = evaluateG16Candidate(cand, "run_123");
        return res.isLiveVerified === false && res.validLineageObservationsCount === 0;
      },
    },
    {
      testId: "G16-MAT-O",
      description: "Synthetic jsonld:<storeDomain> proof reference is rejected by extractMerchantProofRefs and hasVerifiedMerchantIdentity",
      exec: () => {
        const cand = {
          candidateId: "cand_syn_jsonld",
          title: "KittySpout Fountain",
          storeDomain: "kittyspout.com",
          canonicalProductUrl: "https://kittyspout.com/products/kittyspout-wireless-fountain",
          familyKey: "pet_water_fountain",
          identityStatus: "VERIFIED",
          merchantPageVerified: true,
          merchantVerificationProofRefs: ["jsonld:kittyspout.com"],
          supportingAdIds: ["ad_1"],
          sourceObservations: [
            makeValidLiveObs({
              storeDomainEvidence: "kittyspout.com",
              landingPageUrl: "https://kittyspout.com/products/kittyspout-wireless-fountain",
            }),
          ],
        };
        const res = evaluateG16Candidate(cand, "run_123");
        return res.merchantVerified === false && res.merchantProofRefs.length === 0 && res.isLiveVerified === false;
      },
    },
    {
      testId: "G16-MAT-P",
      description: "When strictPersistedProofRequired is true and persisted merchantEvidenceIndex is unverified, inline snapshot fields cannot force merchantVerified=true",
      exec: () => {
        const cand = makeValidMerchantCandidate({
          candidateId: "c1",
        });
        const res = evaluateG16Candidate(cand, "run_123", {
          strictPersistedProofRequired: true,
          merchantEvidenceIndex: {
            c1: { verified: false, proofRefs: [] },
          },
        });
        return res.merchantVerified === false && res.isLiveVerified === false;
      },
    },
    ...buildSchemaAndOriginMatrixCaseDefinitions(),
  ];

  const results = cases.map((c) => {
    let passed = false;
    try {
      passed = c.exec();
    } catch {
      passed = false;
    }
    return { testId: c.testId, description: c.description, passed };
  });

  const totalPassed = results.filter((r) => r.passed).length;

  return {
    totalTests: cases.length,
    totalPassed,
    passed: totalPassed === cases.length,
    cases: results,
  };
}

export interface SchemaAndOriginMatrixTestReceipt {
  testId: string;
  category: "MERCHANT_SCHEMA_NEGATIVE" | "LIVE_ORIGIN_NEGATIVE" | "POSITIVE_CONTRACT";
  description: string;
  passed: boolean;
  expectedOutcome: string;
  observedOutcome: string;
}

function buildValidProductJsonLdString(overrides: Record<string, any> = {}): string {
  return JSON.stringify({
    "@context": "https://schema.org",
    "@type": "Product",
    name: "KittySpout Stainless Steel Cat Water Fountain",
    sku: "KS-FOUNTAIN-01",
    gtin13: "0789123456789",
    productID: "8369671045340",
    url: "https://kittyspout.com/products/kittyspout-wireless-fountain",
    offers: {
      "@type": "Offer",
      price: "49.99",
      priceCurrency: "USD",
      availability: "https://schema.org/InStock",
      url: "https://kittyspout.com/products/kittyspout-wireless-fountain",
    },
    ...overrides,
  });
}

function buildValidLiveRawPayloadString(overrides: Record<string, any> = {}): string {
  return JSON.stringify({
    origin: "LIVE_PROVIDER_EXECUTION",
    sourceMode: "LIVE_PROVIDER",
    providerId: "META_AD_LIBRARY",
    providerRequestId: "mcp_req_live_9001",
    mcpInvocationRef: "mcp://meta-ad-library/searchAds/9001",
    workspaceId: "ws_pet_1",
    runId: "run_live_1",
    externalAdId: "lib_ad_101",
    storeDomain: "kittyspout.com",
    landingPageUrl: "https://kittyspout.com/products/kittyspout-wireless-fountain",
    capturedAt: "2026-10-25T10:00:00.000Z",
    ...overrides,
  });
}

export function buildSchemaAndOriginMatrixCaseDefinitions(): Array<{
  testId: string;
  category: "MERCHANT_SCHEMA_NEGATIVE" | "LIVE_ORIGIN_NEGATIVE" | "POSITIVE_CONTRACT";
  description: string;
  expectedOutcome: string;
  exec: () => boolean;
  inspect?: () => string;
}> {
  const asOf = new Date("2026-10-30T12:00:00.000Z");

  return [
    // ========================================================================
    // M01..M17: Merchant Schema Proof Negative Matrix
    // ========================================================================
    {
      testId: "M01",
      category: "MERCHANT_SCHEMA_NEGATIVE",
      description: "LandingPageSnapshot with pageTitle + finalUrl + contentHash only (no observationsJson Product JSON-LD) is NOT VERIFIED",
      expectedOutcome: "identityStatus=PROBABLE, validationStatus=RAW_SOURCE_NOT_RECONSTRUCTABLE",
      exec: () => {
        const extracted = extractPersistedMerchantProofsFromDbRows({
          workspaceId: "ws_pet_1",
          candidateId: "cand_m01",
          storeDomain: "kittyspout.com",
          canonicalProductUrl: "https://kittyspout.com/products/kittyspout-wireless-fountain",
          candidateTitle: "KittySpout Stainless Steel Cat Water Fountain",
          asOf,
          standaloneLandingSnapshots: [
            {
              id: "lp_m01",
              workspaceId: "ws_pet_1",
              productId: "prod_1",
              originalUrl: "https://kittyspout.com/products/kittyspout-wireless-fountain",
              finalUrl: "https://kittyspout.com/products/kittyspout-wireless-fountain",
              httpStatus: 200,
              accessStatus: "OK",
              pageTitle: "KittySpout Fountain",
              contentHash: computeSha256Hex("visible-text-summary-only"),
              observationsJson: null,
              observedAt: "2026-10-25T10:00:00.000Z",
            },
          ],
        });
        const cls = classifyHistoricalProductIdentity(
          {
            candidateId: "cand_m01",
            workspaceId: "ws_pet_1",
            title: "KittySpout Stainless Steel Cat Water Fountain",
            storeDomain: "kittyspout.com",
            canonicalProductUrl: "https://kittyspout.com/products/kittyspout-wireless-fountain",
            observedAt: "2026-10-25T10:00:00.000Z",
            persistedMerchantProofs: extracted.validProofs,
          },
          asOf
        );
        return (
          extracted.validProofs.length === 0 &&
          extracted.allAuditedRecords[0]?.validationStatus === "RAW_SOURCE_NOT_RECONSTRUCTABLE" &&
          cls.identityStatus === "PROBABLE"
        );
      },
    },
    {
      testId: "M02",
      category: "MERCHANT_SCHEMA_NEGATIVE",
      description: "LandingPageSnapshot with CRO observationsJson lacking Product JSON-LD is NOT VERIFIED",
      expectedOutcome: "identityStatus=PROBABLE, validationStatus=NO_PRODUCT_JSON_LD_IN_PAYLOAD",
      exec: () => {
        const croJson = JSON.stringify({
          headlineCount: 3,
          ctaCount: 2,
          ctaTexts: ["Add to Cart", "Buy Now"],
          hasStickyATC: true,
          benefitBullets: ["Fresh filtered water"],
        });
        const extracted = extractPersistedMerchantProofsFromDbRows({
          workspaceId: "ws_pet_1",
          candidateId: "cand_m02",
          storeDomain: "kittyspout.com",
          canonicalProductUrl: "https://kittyspout.com/products/kittyspout-wireless-fountain",
          candidateTitle: "KittySpout Stainless Steel Cat Water Fountain",
          asOf,
          standaloneLandingSnapshots: [
            {
              id: "lp_m02",
              workspaceId: "ws_pet_1",
              productId: "prod_1",
              finalUrl: "https://kittyspout.com/products/kittyspout-wireless-fountain",
              httpStatus: 200,
              accessStatus: "OK",
              pageTitle: "KittySpout Fountain",
              contentHash: computeSha256Hex(croJson),
              observationsJson: croJson,
              observedAt: "2026-10-25T10:00:00.000Z",
            },
          ],
        });
        return (
          extracted.validProofs.length === 0 &&
          extracted.allAuditedRecords[0]?.validationStatus === "NO_PRODUCT_JSON_LD_IN_PAYLOAD"
        );
      },
    },
    {
      testId: "M03",
      category: "MERCHANT_SCHEMA_NEGATIVE",
      description: "ResearchProduct row with /products/... URL alone is discovery-only and NOT VERIFIED",
      expectedOutcome: "identityStatus=PROBABLE, validationStatus=PRODUCT_ROW_DISCOVERY_ONLY",
      exec: () => {
        const extracted = extractPersistedMerchantProofsFromDbRows({
          workspaceId: "ws_pet_1",
          candidateId: "cand_m03",
          storeDomain: "kittyspout.com",
          canonicalProductUrl: "https://kittyspout.com/products/kittyspout-wireless-fountain",
          candidateTitle: "KittySpout Stainless Steel Cat Water Fountain",
          asOf,
          researchProducts: [
            {
              id: "prod_m03",
              title: "KittySpout Stainless Steel Cat Water Fountain",
              productUrl: "https://kittyspout.com/products/kittyspout-wireless-fountain",
              store: { id: "st_1", domain: "kittyspout.com", workspaceId: "ws_pet_1" },
              createdAt: "2026-10-20T00:00:00.000Z",
              updatedAt: "2026-10-20T00:00:00.000Z",
              evidence: [],
              landingPageSnapshots: [],
              offerSnapshots: [],
            },
          ],
        });
        const cls = classifyHistoricalProductIdentity(
          {
            candidateId: "cand_m03",
            researchProductId: "prod_m03",
            workspaceId: "ws_pet_1",
            title: "KittySpout Stainless Steel Cat Water Fountain",
            storeDomain: "kittyspout.com",
            canonicalProductUrl: "https://kittyspout.com/products/kittyspout-wireless-fountain",
            observedAt: "2026-10-20T00:00:00.000Z",
            persistedMerchantProofs: extracted.validProofs,
          },
          asOf
        );
        return (
          extracted.validProofs.length === 0 &&
          extracted.allAuditedRecords[0]?.validationStatus === "PRODUCT_ROW_DISCOVERY_ONLY" &&
          cls.identityStatus === "PROBABLE"
        );
      },
    },
    {
      testId: "M04",
      category: "MERCHANT_SCHEMA_NEGATIVE",
      description: "CompetitorOfferSnapshot price/offer-only row is NOT VERIFIED identity proof",
      expectedOutcome: "identityStatus=PROBABLE, validationStatus=OFFER_SNAPSHOT_NOT_IDENTITY_PROOF",
      exec: () => {
        const extracted = extractPersistedMerchantProofsFromDbRows({
          workspaceId: "ws_pet_1",
          candidateId: "cand_m04",
          storeDomain: "kittyspout.com",
          canonicalProductUrl: "https://kittyspout.com/products/kittyspout-wireless-fountain",
          asOf,
          standaloneOfferSnapshots: [
            {
              id: "os_m04",
              workspaceId: "ws_pet_1",
              productId: "prod_1",
              sourceUrl: "https://kittyspout.com/products/kittyspout-wireless-fountain",
              finalUrl: "https://kittyspout.com/products/kittyspout-wireless-fountain",
              currency: "USD",
              sellingPrice: 49.99,
              availability: "IN_STOCK",
              observedAt: "2026-10-25T10:00:00.000Z",
            },
          ],
        });
        return (
          extracted.validProofs.length === 0 &&
          extracted.allAuditedRecords[0]?.validationStatus === "OFFER_SNAPSHOT_NOT_IDENTITY_PROOF"
        );
      },
    },
    {
      testId: "M05",
      category: "MERCHANT_SCHEMA_NEGATIVE",
      description: "CheckoutChamp / funnel domain (cc.uprootclean.com, /main/phr) without root JSON-LD product schema stays PROBABLE / FUNNEL_UNVERIFIED",
      expectedOutcome: "identityStatus=PROBABLE, verificationEvidenceStatus=FUNNEL_UNVERIFIED",
      exec: () => {
        const cls = classifyHistoricalProductIdentity(
          {
            candidateId: "cand_m05",
            workspaceId: "ws_pet_1",
            title: "Uproot Cleaner Pro Pet Hair Remover",
            storeDomain: "cc.uprootclean.com",
            canonicalProductUrl: "https://cc.uprootclean.com/main/phr",
            observedAt: "2026-10-25T10:00:00.000Z",
            persistedMerchantProofs: [],
          },
          asOf
        );
        return (
          cls.identityStatus === "PROBABLE" &&
          cls.verificationEvidenceStatus === "FUNNEL_UNVERIFIED" &&
          cls.isCheckoutChampFunnel === true
        );
      },
    },
    {
      testId: "M06",
      category: "MERCHANT_SCHEMA_NEGATIVE",
      description: "ResearchEvidence with JSON-LD @type Organization / WebSite / BreadcrumbList / ItemList / Article (not Product) is NOT VERIFIED",
      expectedOutcome: "validationStatus=NON_PRODUCT_JSON_LD_TYPE",
      exec: () => {
        const orgJsonLd = JSON.stringify({
          "@context": "https://schema.org",
          "@graph": [
            { "@type": "Organization", name: "KittySpout", url: "https://kittyspout.com" },
            { "@type": "WebSite", name: "KittySpout Official", url: "https://kittyspout.com" },
            { "@type": "BreadcrumbList", itemListElement: [] },
            { "@type": "ItemList", itemListElement: [] },
            { "@type": "Article", headline: "Why Cats Love Running Water" },
          ],
        });
        const extracted = extractPersistedMerchantProofsFromDbRows({
          workspaceId: "ws_pet_1",
          candidateId: "cand_m06",
          storeDomain: "kittyspout.com",
          canonicalProductUrl: "https://kittyspout.com/products/kittyspout-wireless-fountain",
          asOf,
          standaloneEvidence: [
            {
              id: "ev_m06",
              workspaceId: "ws_pet_1",
              observedValue: orgJsonLd,
              sourceUrl: "https://kittyspout.com/products/kittyspout-wireless-fountain",
              observationMethod: "AUTOMATED_SCRAPE",
              classification: "VERIFIED",
              sourceContentRef: `sha256:${computeSha256Hex(orgJsonLd)}`,
              observedAt: "2026-10-25T10:00:00.000Z",
            },
          ],
        });
        return (
          extracted.validProofs.length === 0 &&
          extracted.allAuditedRecords[0]?.validationStatus === "NON_PRODUCT_JSON_LD_TYPE"
        );
      },
    },
    {
      testId: "M07",
      category: "MERCHANT_SCHEMA_NEGATIVE",
      description: "ResearchEvidence with observedValue='{\"schemaVerified\":true}' or '{\"hasJsonLdProduct\":true}' without actual Product JSON-LD is NOT VERIFIED",
      expectedOutcome: "validationStatus=NO_PRODUCT_JSON_LD_IN_PAYLOAD",
      exec: () => {
        const fakeJson = JSON.stringify({ schemaVerified: true, hasJsonLdProduct: true });
        const extracted = extractPersistedMerchantProofsFromDbRows({
          workspaceId: "ws_pet_1",
          candidateId: "cand_m07",
          storeDomain: "kittyspout.com",
          canonicalProductUrl: "https://kittyspout.com/products/kittyspout-wireless-fountain",
          asOf,
          standaloneEvidence: [
            {
              id: "ev_m07",
              workspaceId: "ws_pet_1",
              observedValue: fakeJson,
              sourceUrl: "https://kittyspout.com/products/kittyspout-wireless-fountain",
              observationMethod: "AUTOMATED_SCRAPE",
              classification: "VERIFIED",
              sourceContentRef: `sha256:${computeSha256Hex(fakeJson)}`,
              observedAt: "2026-10-25T10:00:00.000Z",
            },
          ],
        });
        return (
          extracted.validProofs.length === 0 &&
          extracted.allAuditedRecords[0]?.validationStatus === "NO_PRODUCT_JSON_LD_IN_PAYLOAD"
        );
      },
    },
    {
      testId: "M08",
      category: "MERCHANT_SCHEMA_NEGATIVE",
      description: "LandingPageSnapshot with httpStatus 403/500 or accessStatus=BLOCKED is NOT VERIFIED",
      expectedOutcome: "validationStatus=HTTP_OR_ACCESS_BLOCKED",
      exec: () => {
        const validJsonLd = buildValidProductJsonLdString();
        const extracted = extractPersistedMerchantProofsFromDbRows({
          workspaceId: "ws_pet_1",
          candidateId: "cand_m08",
          storeDomain: "kittyspout.com",
          canonicalProductUrl: "https://kittyspout.com/products/kittyspout-wireless-fountain",
          asOf,
          standaloneLandingSnapshots: [
            {
              id: "lp_m08",
              workspaceId: "ws_pet_1",
              finalUrl: "https://kittyspout.com/products/kittyspout-wireless-fountain",
              httpStatus: 403,
              accessStatus: "BLOCKED",
              contentHash: computeSha256Hex(validJsonLd),
              observationsJson: validJsonLd,
              observedAt: "2026-10-25T10:00:00.000Z",
            },
          ],
        });
        return (
          extracted.validProofs.length === 0 &&
          extracted.allAuditedRecords[0]?.validationStatus === "HTTP_OR_ACCESS_BLOCKED"
        );
      },
    },
    {
      testId: "M09",
      category: "MERCHANT_SCHEMA_NEGATIVE",
      description: "ResearchEvidence with observationMethod=MANUAL_ENTRY or classification=INFERRED is NOT VERIFIED",
      expectedOutcome: "validationStatus=UNSAFE_OBSERVATION_METHOD_OR_CLASSIFICATION",
      exec: () => {
        const validJsonLd = buildValidProductJsonLdString();
        const extracted = extractPersistedMerchantProofsFromDbRows({
          workspaceId: "ws_pet_1",
          candidateId: "cand_m09",
          storeDomain: "kittyspout.com",
          canonicalProductUrl: "https://kittyspout.com/products/kittyspout-wireless-fountain",
          asOf,
          standaloneEvidence: [
            {
              id: "ev_m09_manual",
              workspaceId: "ws_pet_1",
              observedValue: validJsonLd,
              sourceUrl: "https://kittyspout.com/products/kittyspout-wireless-fountain",
              observationMethod: "MANUAL_ENTRY",
              classification: "INFERRED",
              sourceContentRef: `sha256:${computeSha256Hex(validJsonLd)}`,
              observedAt: "2026-10-25T10:00:00.000Z",
            },
          ],
        });
        return (
          extracted.validProofs.length === 0 &&
          extracted.allAuditedRecords[0]?.validationStatus ===
            "UNSAFE_OBSERVATION_METHOD_OR_CLASSIFICATION"
        );
      },
    },
    {
      testId: "M10",
      category: "MERCHANT_SCHEMA_NEGATIVE",
      description: "Valid Product JSON-LD for a different product/SKU on the same merchant domain is NOT VERIFIED for target candidate",
      expectedOutcome: "validationStatus=PRODUCT_OR_SKU_MISMATCH_REJECTED",
      exec: () => {
        const otherProductJsonLd = buildValidProductJsonLdString({
          name: "Replacement Carbon Filter Pack",
          sku: "KS-FILTER-99",
          url: "https://kittyspout.com/products/replacement-filters-pack",
        });
        const extracted = extractPersistedMerchantProofsFromDbRows({
          workspaceId: "ws_pet_1",
          candidateId: "cand_m10",
          storeDomain: "kittyspout.com",
          canonicalProductUrl: "https://kittyspout.com/products/kittyspout-wireless-fountain",
          candidateTitle: "KittySpout Stainless Steel Cat Water Fountain",
          expectedSku: "KS-FOUNTAIN-01",
          asOf,
          standaloneEvidence: [
            {
              id: "ev_m10",
              workspaceId: "ws_pet_1",
              observedValue: otherProductJsonLd,
              sourceUrl: "https://kittyspout.com/products/replacement-filters-pack",
              observationMethod: "AUTOMATED_SCRAPE",
              classification: "VERIFIED",
              sourceContentRef: `sha256:${computeSha256Hex(otherProductJsonLd)}`,
              observedAt: "2026-10-25T10:00:00.000Z",
            },
          ],
        });
        return (
          extracted.validProofs.length === 0 &&
          extracted.allAuditedRecords[0]?.validationStatus ===
            "PRODUCT_OR_SKU_MISMATCH_REJECTED"
        );
      },
    },
    {
      testId: "M11",
      category: "MERCHANT_SCHEMA_NEGATIVE",
      description: "Valid Product JSON-LD for the same slug on an unrelated merchant domain is NOT VERIFIED",
      expectedOutcome: "validationStatus=DOMAIN_MISMATCH_REJECTED",
      exec: () => {
        const otherDomainJsonLd = buildValidProductJsonLdString({
          url: "https://unrelated-pet-shop.com/products/kittyspout-wireless-fountain",
        });
        const extracted = extractPersistedMerchantProofsFromDbRows({
          workspaceId: "ws_pet_1",
          candidateId: "cand_m11",
          storeDomain: "kittyspout.com",
          canonicalProductUrl: "https://kittyspout.com/products/kittyspout-wireless-fountain",
          candidateTitle: "KittySpout Stainless Steel Cat Water Fountain",
          asOf,
          standaloneEvidence: [
            {
              id: "ev_m11",
              workspaceId: "ws_pet_1",
              observedValue: otherDomainJsonLd,
              sourceUrl: "https://unrelated-pet-shop.com/products/kittyspout-wireless-fountain",
              observationMethod: "AUTOMATED_SCRAPE",
              classification: "VERIFIED",
              sourceContentRef: `sha256:${computeSha256Hex(otherDomainJsonLd)}`,
              observedAt: "2026-10-25T10:00:00.000Z",
            },
          ],
        });
        return (
          extracted.validProofs.length === 0 &&
          extracted.allAuditedRecords[0]?.validationStatus === "DOMAIN_MISMATCH_REJECTED"
        );
      },
    },
    {
      testId: "M12",
      category: "MERCHANT_SCHEMA_NEGATIVE",
      description: "Valid Product JSON-LD with observedAt > asOf is rejected as POST_CUTOFF",
      expectedOutcome: "validationStatus=POST_CUTOFF_OR_INVALID_DATE",
      exec: () => {
        const validJsonLd = buildValidProductJsonLdString();
        const extracted = extractPersistedMerchantProofsFromDbRows({
          workspaceId: "ws_pet_1",
          candidateId: "cand_m12",
          storeDomain: "kittyspout.com",
          canonicalProductUrl: "https://kittyspout.com/products/kittyspout-wireless-fountain",
          candidateTitle: "KittySpout Stainless Steel Cat Water Fountain",
          asOf,
          standaloneEvidence: [
            {
              id: "ev_m12",
              workspaceId: "ws_pet_1",
              observedValue: validJsonLd,
              sourceUrl: "https://kittyspout.com/products/kittyspout-wireless-fountain",
              observationMethod: "AUTOMATED_SCRAPE",
              classification: "VERIFIED",
              sourceContentRef: `sha256:${computeSha256Hex(validJsonLd)}`,
              observedAt: "2026-11-01T04:22:00.000Z", // > asOf
            },
          ],
        });
        return (
          extracted.validProofs.length === 0 &&
          extracted.allAuditedRecords[0]?.validationStatus === "POST_CUTOFF_OR_INVALID_DATE"
        );
      },
    },
    {
      testId: "M13",
      category: "MERCHANT_SCHEMA_NEGATIVE",
      description: "Valid Product JSON-LD in another workspaceId is rejected as CROSS_WORKSPACE_REJECTED",
      expectedOutcome: "validationStatus=CROSS_WORKSPACE_REJECTED",
      exec: () => {
        const validJsonLd = buildValidProductJsonLdString();
        const extracted = extractPersistedMerchantProofsFromDbRows({
          workspaceId: "ws_pet_1",
          candidateId: "cand_m13",
          storeDomain: "kittyspout.com",
          canonicalProductUrl: "https://kittyspout.com/products/kittyspout-wireless-fountain",
          asOf,
          standaloneEvidence: [
            {
              id: "ev_m13",
              workspaceId: "ws_other_tenant",
              observedValue: validJsonLd,
              sourceUrl: "https://kittyspout.com/products/kittyspout-wireless-fountain",
              observationMethod: "AUTOMATED_SCRAPE",
              classification: "VERIFIED",
              sourceContentRef: `sha256:${computeSha256Hex(validJsonLd)}`,
              observedAt: "2026-10-25T10:00:00.000Z",
            },
          ],
        });
        return (
          extracted.validProofs.length === 0 &&
          extracted.allAuditedRecords[0]?.validationStatus === "CROSS_WORKSPACE_REJECTED"
        );
      },
    },
    {
      testId: "M14",
      category: "MERCHANT_SCHEMA_NEGATIVE",
      description: "Synthetic / fixture proof (uahpet_lp_hash_v12_4_3_3, TEST_FIXTURE, jsonld:<domain>) is rejected",
      expectedOutcome: "validationStatus=SYNTHETIC_OR_FIXTURE_REJECTED",
      exec: () => {
        const validJsonLd = buildValidProductJsonLdString();
        const extracted = extractPersistedMerchantProofsFromDbRows({
          workspaceId: "ws_pet_1",
          candidateId: "cand_m14",
          storeDomain: "kittyspout.com",
          canonicalProductUrl: "https://kittyspout.com/products/kittyspout-wireless-fountain",
          asOf,
          standaloneLandingSnapshots: [
            {
              id: "lp_m14",
              workspaceId: "ws_pet_1",
              finalUrl: "https://kittyspout.com/products/kittyspout-wireless-fountain",
              httpStatus: 200,
              accessStatus: "OK",
              contentHash: "uahpet_lp_hash_v12_4_3_3",
              observationsJson: validJsonLd,
              observedAt: "2026-10-25T10:00:00.000Z",
            },
          ],
        });
        return (
          extracted.validProofs.length === 0 &&
          extracted.allAuditedRecords[0]?.validationStatus === "SYNTHETIC_OR_FIXTURE_REJECTED" &&
          isSyntheticMerchantProofRef("jsonld:kittyspout.com") === true
        );
      },
    },
    {
      testId: "M15",
      category: "MERCHANT_SCHEMA_NEGATIVE",
      description: "Missing or invalid date (null, empty, 'not-a-date', new Date('invalid')) fails closed",
      expectedOutcome: "validationStatus=POST_CUTOFF_OR_INVALID_DATE",
      exec: () => {
        const validJsonLd = buildValidProductJsonLdString();
        const extracted = extractPersistedMerchantProofsFromDbRows({
          workspaceId: "ws_pet_1",
          candidateId: "cand_m15",
          storeDomain: "kittyspout.com",
          canonicalProductUrl: "https://kittyspout.com/products/kittyspout-wireless-fountain",
          asOf,
          standaloneEvidence: [
            {
              id: "ev_m15_invalid_date",
              workspaceId: "ws_pet_1",
              observedValue: validJsonLd,
              sourceUrl: "https://kittyspout.com/products/kittyspout-wireless-fountain",
              observationMethod: "AUTOMATED_SCRAPE",
              classification: "VERIFIED",
              sourceContentRef: `sha256:${computeSha256Hex(validJsonLd)}`,
              observedAt: "not-a-valid-date",
            },
          ],
        });
        const invalidAsOfCls = classifyHistoricalProductIdentity(
          {
            candidateId: "cand_m15",
            workspaceId: "ws_pet_1",
            title: "KittySpout Stainless Steel Cat Water Fountain",
            storeDomain: "kittyspout.com",
            canonicalProductUrl: "https://kittyspout.com/products/kittyspout-wireless-fountain",
            observedAt: new Date("invalid"),
          },
          asOf
        );
        return (
          extracted.validProofs.length === 0 &&
          extracted.allAuditedRecords[0]?.validationStatus === "POST_CUTOFF_OR_INVALID_DATE" &&
          invalidAsOfCls.identityStatus === "UNVERIFIED"
        );
      },
    },
    {
      testId: "M16",
      category: "MERCHANT_SCHEMA_NEGATIVE",
      description: "Hash-only proof where raw source content is absent returns RAW_SOURCE_NOT_RECONSTRUCTABLE and is NOT VERIFIED",
      expectedOutcome: "validationStatus=RAW_SOURCE_NOT_RECONSTRUCTABLE, identityStatus=PROBABLE",
      exec: () => {
        const extracted = extractPersistedMerchantProofsFromDbRows({
          workspaceId: "ws_pet_1",
          candidateId: "cand_m16",
          storeDomain: "kittyspout.com",
          canonicalProductUrl: "https://kittyspout.com/products/kittyspout-wireless-fountain",
          asOf,
          standaloneEvidence: [
            {
              id: "ev_m16_hash_only",
              workspaceId: "ws_pet_1",
              observedValue: null,
              sourceUrl: "https://kittyspout.com/products/kittyspout-wireless-fountain",
              observationMethod: "AUTOMATED_SCRAPE",
              classification: "VERIFIED",
              sourceContentRef: `sha256:${computeSha256Hex("missing-raw-content")}`,
              observedAt: "2026-10-25T10:00:00.000Z",
            },
          ],
        });
        return (
          extracted.validProofs.length === 0 &&
          extracted.allAuditedRecords[0]?.validationStatus ===
            "RAW_SOURCE_NOT_RECONSTRUCTABLE"
        );
      },
    },
    {
      testId: "M17",
      category: "MERCHANT_SCHEMA_NEGATIVE",
      description: "Tampered content hash (raw Product JSON-LD payload does not match stored SHA-256 hash) is rejected",
      expectedOutcome: "validationStatus=RAW_SOURCE_HASH_TAMPERED",
      exec: () => {
        const validJsonLd = buildValidProductJsonLdString();
        const tamperedJsonLd = buildValidProductJsonLdString({ name: "Tampered Title" });
        const extracted = extractPersistedMerchantProofsFromDbRows({
          workspaceId: "ws_pet_1",
          candidateId: "cand_m17",
          storeDomain: "kittyspout.com",
          canonicalProductUrl: "https://kittyspout.com/products/kittyspout-wireless-fountain",
          asOf,
          standaloneEvidence: [
            {
              id: "ev_m17_tampered",
              workspaceId: "ws_pet_1",
              observedValue: tamperedJsonLd,
              sourceUrl: "https://kittyspout.com/products/kittyspout-wireless-fountain",
              observationMethod: "AUTOMATED_SCRAPE",
              classification: "VERIFIED",
              sourceContentRef: `sha256:${computeSha256Hex(validJsonLd)}`,
              observedAt: "2026-10-25T10:00:00.000Z",
            },
          ],
        });
        return (
          extracted.validProofs.length === 0 &&
          extracted.allAuditedRecords[0]?.validationStatus === "RAW_SOURCE_HASH_TAMPERED"
        );
      },
    },

    // ========================================================================
    // L01..L16: Persisted Live Observation Origin Negative Matrix
    // ========================================================================
    {
      testId: "L01",
      category: "LIVE_ORIGIN_NEGATIVE",
      description: "DiscoveryRunAd.ingestOutcome = EXISTING is rejected as reused historical DB ad",
      expectedOutcome: "isAuthenticLiveProviderObservation=false, originEvidenceClassification=REUSED_EXISTING_AD",
      exec: () => {
        const res = classifyPersistedLiveObservation({
          adObservation: {
            id: "obs_l01",
            adId: "ad_1",
            observedAt: "2026-10-25T10:00:00.000Z",
            sourceTimestamp: "2026-10-25T10:00:00.000Z",
            evidenceType: "SCRAPED_POST",
            verificationMethod: "AUTOMATED_SCRAPE",
            evidenceReference: "https://www.facebook.com/ads/library/?id=101",
            rawPayload: buildValidLiveRawPayloadString(),
          },
          discoveryRunAd: {
            runId: "run_live_1",
            adId: "ad_1",
            workspaceId: "ws_pet_1",
            providerId: "META_AD_LIBRARY",
            ingestOutcome: "EXISTING",
            sourceUrl: "https://www.facebook.com/ads/library/?id=101",
            observedAt: "2026-10-25T10:00:00.000Z",
          },
          expectedWorkspaceId: "ws_pet_1",
          expectedRunId: "run_live_1",
          asOf,
        });
        return (
          res.isAuthenticLiveProviderObservation === false &&
          res.originEvidenceClassification === "REUSED_EXISTING_AD" &&
          res.derivedProvenance !== "LIVE_PROVIDER"
        );
      },
    },
    {
      testId: "L02",
      category: "LIVE_ORIGIN_NEGATIVE",
      description: "DiscoveryRunAd.ingestOutcome = UPDATED without live origin is rejected",
      expectedOutcome: "isAuthenticLiveProviderObservation=false, originEvidenceClassification=PERSISTED_LIVE_ORIGIN_UNVERIFIED",
      exec: () => {
        const res = classifyPersistedLiveObservation({
          adObservation: {
            id: "obs_l02",
            adId: "ad_1",
            observedAt: "2026-10-25T10:00:00.000Z",
            sourceTimestamp: "2026-10-25T10:00:00.000Z",
            evidenceType: "SCRAPED_POST",
            verificationMethod: "AUTOMATED_SCRAPE",
            evidenceReference: "https://www.facebook.com/ads/library/?id=101",
            rawPayload: null,
          },
          discoveryRunAd: {
            runId: "run_live_1",
            adId: "ad_1",
            workspaceId: "ws_pet_1",
            providerId: "META_AD_LIBRARY",
            ingestOutcome: "UPDATED",
            sourceUrl: "https://www.facebook.com/ads/library/?id=101",
            observedAt: "2026-10-25T10:00:00.000Z",
          },
          expectedWorkspaceId: "ws_pet_1",
          expectedRunId: "run_live_1",
          asOf,
        });
        return (
          res.isAuthenticLiveProviderObservation === false &&
          res.originEvidenceClassification === "PERSISTED_LIVE_ORIGIN_UNVERIFIED"
        );
      },
    },
    {
      testId: "L03",
      category: "LIVE_ORIGIN_NEGATIVE",
      description: "DiscoveryRunAd.ingestOutcome = NEW with empty AdObservation.rawPayload is rejected (PERSISTED_LIVE_ORIGIN_UNVERIFIED)",
      expectedOutcome: "isAuthenticLiveProviderObservation=false, derivedProvenance=PERSISTED_LIVE_ORIGIN_UNVERIFIED",
      exec: () => {
        const res = classifyPersistedLiveObservation({
          adObservation: {
            id: "obs_l03",
            adId: "ad_1",
            observedAt: "2026-10-25T10:00:00.000Z",
            sourceTimestamp: "2026-10-25T10:00:00.000Z",
            evidenceType: "SCRAPED_POST",
            verificationMethod: "AUTOMATED_SCRAPE",
            evidenceReference: "https://www.facebook.com/ads/library/?id=101",
            rawPayload: null,
          },
          discoveryRunAd: {
            runId: "run_live_1",
            adId: "ad_1",
            workspaceId: "ws_pet_1",
            providerId: "META_AD_LIBRARY",
            ingestOutcome: "NEW",
            sourceUrl: "https://www.facebook.com/ads/library/?id=101",
            observedAt: "2026-10-25T10:00:00.000Z",
          },
          expectedWorkspaceId: "ws_pet_1",
          expectedRunId: "run_live_1",
          asOf,
        });
        return (
          res.isAuthenticLiveProviderObservation === false &&
          res.originEvidenceClassification === "PERSISTED_LIVE_ORIGIN_UNVERIFIED" &&
          res.derivedProvenance === "PERSISTED_LIVE_ORIGIN_UNVERIFIED"
        );
      },
    },
    {
      testId: "L04",
      category: "LIVE_ORIGIN_NEGATIVE",
      description: "AdObservation.evidenceType = MANUAL_ENTRY or USER_OBSERVED is rejected",
      expectedOutcome: "isAuthenticLiveProviderObservation=false",
      exec: () => {
        const res = classifyPersistedLiveObservation({
          adObservation: {
            id: "obs_l04",
            adId: "ad_1",
            observedAt: "2026-10-25T10:00:00.000Z",
            sourceTimestamp: "2026-10-25T10:00:00.000Z",
            evidenceType: "MANUAL_ENTRY",
            verificationMethod: "USER_OBSERVED",
            evidenceReference: "https://www.facebook.com/ads/library/?id=101",
            rawPayload: buildValidLiveRawPayloadString(),
          },
          discoveryRunAd: {
            runId: "run_live_1",
            adId: "ad_1",
            workspaceId: "ws_pet_1",
            providerId: "META_AD_LIBRARY",
            ingestOutcome: "NEW",
            sourceUrl: "https://www.facebook.com/ads/library/?id=101",
            observedAt: "2026-10-25T10:00:00.000Z",
          },
          expectedWorkspaceId: "ws_pet_1",
          expectedRunId: "run_live_1",
          asOf,
        });
        return res.isAuthenticLiveProviderObservation === false;
      },
    },
    {
      testId: "L05",
      category: "LIVE_ORIGIN_NEGATIVE",
      description: "AdObservation.rawPayload containing origin = DETERMINISTIC_FALLBACK is rejected",
      expectedOutcome: "isAuthenticLiveProviderObservation=false, originEvidenceClassification=FALLBACK_OR_SYNTHETIC",
      exec: () => {
        const res = classifyPersistedLiveObservation({
          adObservation: {
            id: "obs_l05",
            adId: "ad_1",
            observedAt: "2026-10-25T10:00:00.000Z",
            sourceTimestamp: "2026-10-25T10:00:00.000Z",
            evidenceType: "SCRAPED_POST",
            verificationMethod: "AUTOMATED_SCRAPE",
            evidenceReference: "https://www.facebook.com/ads/library/?id=101",
            rawPayload: buildValidLiveRawPayloadString({ origin: "DETERMINISTIC_FALLBACK" }),
          },
          discoveryRunAd: {
            runId: "run_live_1",
            adId: "ad_1",
            workspaceId: "ws_pet_1",
            providerId: "META_AD_LIBRARY",
            ingestOutcome: "NEW",
            sourceUrl: "https://www.facebook.com/ads/library/?id=101",
            observedAt: "2026-10-25T10:00:00.000Z",
          },
          expectedWorkspaceId: "ws_pet_1",
          expectedRunId: "run_live_1",
          asOf,
        });
        return (
          res.isAuthenticLiveProviderObservation === false &&
          res.originEvidenceClassification === "FALLBACK_OR_SYNTHETIC"
        );
      },
    },
    {
      testId: "L06",
      category: "LIVE_ORIGIN_NEGATIVE",
      description: "AdObservation.rawPayload containing TEST_FIXTURE / CONTROLLED_FIXTURE / SYNTHETIC / MOCK is rejected",
      expectedOutcome: "isAuthenticLiveProviderObservation=false, originEvidenceClassification=FALLBACK_OR_SYNTHETIC",
      exec: () => {
        const res = classifyPersistedLiveObservation({
          adObservation: {
            id: "obs_l06",
            adId: "ad_1",
            observedAt: "2026-10-25T10:00:00.000Z",
            sourceTimestamp: "2026-10-25T10:00:00.000Z",
            evidenceType: "SCRAPED_POST",
            verificationMethod: "AUTOMATED_SCRAPE",
            evidenceReference: "https://www.facebook.com/ads/library/?id=101",
            rawPayload: buildValidLiveRawPayloadString({ provenance: "TEST_FIXTURE" }),
          },
          discoveryRunAd: {
            runId: "run_live_1",
            adId: "ad_1",
            workspaceId: "ws_pet_1",
            providerId: "META_AD_LIBRARY",
            ingestOutcome: "NEW",
            sourceUrl: "https://www.facebook.com/ads/library/?id=101",
            observedAt: "2026-10-25T10:00:00.000Z",
          },
          expectedWorkspaceId: "ws_pet_1",
          expectedRunId: "run_live_1",
          asOf,
        });
        return (
          res.isAuthenticLiveProviderObservation === false &&
          res.originEvidenceClassification === "FALLBACK_OR_SYNTHETIC"
        );
      },
    },
    {
      testId: "L07",
      category: "LIVE_ORIGIN_NEGATIVE",
      description: "Fabricated IDs obs_<runId>_<candidateId> or req_<runId> are rejected",
      expectedOutcome: "isAuthenticLiveProviderObservation=false, originEvidenceClassification=FALLBACK_OR_SYNTHETIC",
      exec: () => {
        const res = classifyPersistedLiveObservation({
          adObservation: {
            id: "obs_run_live_1_cand_1",
            adId: "ad_1",
            observedAt: "2026-10-25T10:00:00.000Z",
            sourceTimestamp: "2026-10-25T10:00:00.000Z",
            evidenceType: "SCRAPED_POST",
            verificationMethod: "AUTOMATED_SCRAPE",
            evidenceReference: "https://www.facebook.com/ads/library/?id=101",
            rawPayload: buildValidLiveRawPayloadString({ providerRequestId: "req_run_live_1" }),
          },
          discoveryRunAd: {
            runId: "run_live_1",
            adId: "ad_1",
            workspaceId: "ws_pet_1",
            providerId: "META_AD_LIBRARY",
            ingestOutcome: "NEW",
            sourceUrl: "https://www.facebook.com/ads/library/?id=101",
            observedAt: "2026-10-25T10:00:00.000Z",
          },
          expectedWorkspaceId: "ws_pet_1",
          expectedRunId: "run_live_1",
          expectedCandidateId: "cand_1",
          asOf,
        });
        return (
          res.isAuthenticLiveProviderObservation === false &&
          res.originEvidenceClassification === "FALLBACK_OR_SYNTHETIC"
        );
      },
    },
    {
      testId: "L08",
      category: "LIVE_ORIGIN_NEGATIVE",
      description: "Missing providerRequestId and missing mcpInvocationRef in rawPayload is rejected",
      expectedOutcome: "isAuthenticLiveProviderObservation=false",
      exec: () => {
        const res = classifyPersistedLiveObservation({
          adObservation: {
            id: "obs_l08",
            adId: "ad_1",
            observedAt: "2026-10-25T10:00:00.000Z",
            sourceTimestamp: "2026-10-25T10:00:00.000Z",
            evidenceType: "SCRAPED_POST",
            verificationMethod: "AUTOMATED_SCRAPE",
            evidenceReference: "https://www.facebook.com/ads/library/?id=101",
            rawPayload: buildValidLiveRawPayloadString({
              providerRequestId: null,
              mcpInvocationRef: null,
            }),
          },
          discoveryRunAd: {
            runId: "run_live_1",
            adId: "ad_1",
            workspaceId: "ws_pet_1",
            providerId: "META_AD_LIBRARY",
            ingestOutcome: "NEW",
            sourceUrl: "https://www.facebook.com/ads/library/?id=101",
            observedAt: "2026-10-25T10:00:00.000Z",
          },
          expectedWorkspaceId: "ws_pet_1",
          expectedRunId: "run_live_1",
          asOf,
        });
        return res.isAuthenticLiveProviderObservation === false;
      },
    },
    {
      testId: "L09",
      category: "LIVE_ORIGIN_NEGATIVE",
      description: "Missing evidenceReference or sourceUrl is rejected",
      expectedOutcome: "isAuthenticLiveProviderObservation=false",
      exec: () => {
        const res = classifyPersistedLiveObservation({
          adObservation: {
            id: "obs_l09",
            adId: "ad_1",
            observedAt: "2026-10-25T10:00:00.000Z",
            sourceTimestamp: "2026-10-25T10:00:00.000Z",
            evidenceType: "SCRAPED_POST",
            verificationMethod: "AUTOMATED_SCRAPE",
            evidenceReference: null,
            rawPayload: buildValidLiveRawPayloadString(),
          },
          discoveryRunAd: {
            runId: "run_live_1",
            adId: "ad_1",
            workspaceId: "ws_pet_1",
            providerId: "META_AD_LIBRARY",
            ingestOutcome: "NEW",
            sourceUrl: null,
            observedAt: "2026-10-25T10:00:00.000Z",
          },
          expectedWorkspaceId: "ws_pet_1",
          expectedRunId: "run_live_1",
          asOf,
        });
        return res.isAuthenticLiveProviderObservation === false;
      },
    },
    {
      testId: "L10",
      category: "LIVE_ORIGIN_NEGATIVE",
      description: "DiscoveryRunAd.workspaceId != candidate workspaceId is rejected as CROSS_WORKSPACE_OR_RUN",
      expectedOutcome: "isAuthenticLiveProviderObservation=false, originEvidenceClassification=CROSS_WORKSPACE_OR_RUN",
      exec: () => {
        const res = classifyPersistedLiveObservation({
          adObservation: {
            id: "obs_l10",
            adId: "ad_1",
            observedAt: "2026-10-25T10:00:00.000Z",
            sourceTimestamp: "2026-10-25T10:00:00.000Z",
            evidenceType: "SCRAPED_POST",
            verificationMethod: "AUTOMATED_SCRAPE",
            evidenceReference: "https://www.facebook.com/ads/library/?id=101",
            rawPayload: buildValidLiveRawPayloadString({ workspaceId: "ws_other" }),
          },
          discoveryRunAd: {
            runId: "run_live_1",
            adId: "ad_1",
            workspaceId: "ws_other",
            providerId: "META_AD_LIBRARY",
            ingestOutcome: "NEW",
            sourceUrl: "https://www.facebook.com/ads/library/?id=101",
            observedAt: "2026-10-25T10:00:00.000Z",
          },
          expectedWorkspaceId: "ws_pet_1",
          expectedRunId: "run_live_1",
          asOf,
        });
        return (
          res.isAuthenticLiveProviderObservation === false &&
          res.originEvidenceClassification === "CROSS_WORKSPACE_OR_RUN"
        );
      },
    },
    {
      testId: "L11",
      category: "LIVE_ORIGIN_NEGATIVE",
      description: "DiscoveryRunAd.runId != expected run lineage is rejected as CROSS_WORKSPACE_OR_RUN",
      expectedOutcome: "isAuthenticLiveProviderObservation=false, originEvidenceClassification=CROSS_WORKSPACE_OR_RUN",
      exec: () => {
        const res = classifyPersistedLiveObservation({
          adObservation: {
            id: "obs_l11",
            adId: "ad_1",
            observedAt: "2026-10-25T10:00:00.000Z",
            sourceTimestamp: "2026-10-25T10:00:00.000Z",
            evidenceType: "SCRAPED_POST",
            verificationMethod: "AUTOMATED_SCRAPE",
            evidenceReference: "https://www.facebook.com/ads/library/?id=101",
            rawPayload: buildValidLiveRawPayloadString({ runId: "run_prior_99" }),
          },
          discoveryRunAd: {
            runId: "run_prior_99",
            adId: "ad_1",
            workspaceId: "ws_pet_1",
            providerId: "META_AD_LIBRARY",
            ingestOutcome: "NEW",
            sourceUrl: "https://www.facebook.com/ads/library/?id=101",
            observedAt: "2026-10-25T10:00:00.000Z",
          },
          expectedWorkspaceId: "ws_pet_1",
          expectedRunId: "run_live_1",
          asOf,
        });
        return (
          res.isAuthenticLiveProviderObservation === false &&
          res.originEvidenceClassification === "CROSS_WORKSPACE_OR_RUN"
        );
      },
    },
    {
      testId: "L12",
      category: "LIVE_ORIGIN_NEGATIVE",
      description: "AdObservation.observedAt > asOf or sourceTimestamp > asOf is rejected as POST_CUTOFF_OR_INVALID_DATE",
      expectedOutcome: "isAuthenticLiveProviderObservation=false, originEvidenceClassification=POST_CUTOFF_OR_INVALID_DATE",
      exec: () => {
        const res = classifyPersistedLiveObservation({
          adObservation: {
            id: "obs_l12",
            adId: "ad_1",
            observedAt: "2026-11-01T10:00:00.000Z",
            sourceTimestamp: "2026-11-01T10:00:00.000Z",
            evidenceType: "SCRAPED_POST",
            verificationMethod: "AUTOMATED_SCRAPE",
            evidenceReference: "https://www.facebook.com/ads/library/?id=101",
            rawPayload: buildValidLiveRawPayloadString(),
          },
          discoveryRunAd: {
            runId: "run_live_1",
            adId: "ad_1",
            workspaceId: "ws_pet_1",
            providerId: "META_AD_LIBRARY",
            ingestOutcome: "NEW",
            sourceUrl: "https://www.facebook.com/ads/library/?id=101",
            observedAt: "2026-11-01T10:00:00.000Z",
          },
          expectedWorkspaceId: "ws_pet_1",
          expectedRunId: "run_live_1",
          asOf,
        });
        return (
          res.isAuthenticLiveProviderObservation === false &&
          res.originEvidenceClassification === "POST_CUTOFF_OR_INVALID_DATE"
        );
      },
    },
    {
      testId: "L13",
      category: "LIVE_ORIGIN_NEGATIVE",
      description: "Invalid or missing observedAt or sourceTimestamp is rejected as POST_CUTOFF_OR_INVALID_DATE",
      expectedOutcome: "isAuthenticLiveProviderObservation=false, originEvidenceClassification=POST_CUTOFF_OR_INVALID_DATE",
      exec: () => {
        const res = classifyPersistedLiveObservation({
          adObservation: {
            id: "obs_l13",
            adId: "ad_1",
            observedAt: "invalid-date-string",
            sourceTimestamp: null,
            evidenceType: "SCRAPED_POST",
            verificationMethod: "AUTOMATED_SCRAPE",
            evidenceReference: "https://www.facebook.com/ads/library/?id=101",
            rawPayload: buildValidLiveRawPayloadString(),
          },
          discoveryRunAd: {
            runId: "run_live_1",
            adId: "ad_1",
            workspaceId: "ws_pet_1",
            providerId: "META_AD_LIBRARY",
            ingestOutcome: "NEW",
            sourceUrl: "https://www.facebook.com/ads/library/?id=101",
            observedAt: "2026-10-25T10:00:00.000Z",
          },
          expectedWorkspaceId: "ws_pet_1",
          expectedRunId: "run_live_1",
          asOf,
        });
        return (
          res.isAuthenticLiveProviderObservation === false &&
          res.originEvidenceClassification === "POST_CUTOFF_OR_INVALID_DATE"
        );
      },
    },
    {
      testId: "L14",
      category: "LIVE_ORIGIN_NEGATIVE",
      description: "AdObservation linked to another candidate's adId or another merchant domain is rejected as CROSS_CANDIDATE_OR_DOMAIN",
      expectedOutcome: "isAuthenticLiveProviderObservation=false, originEvidenceClassification=CROSS_CANDIDATE_OR_DOMAIN",
      exec: () => {
        const res = classifyPersistedLiveObservation({
          adObservation: {
            id: "obs_l14",
            adId: "ad_unrelated_999",
            observedAt: "2026-10-25T10:00:00.000Z",
            sourceTimestamp: "2026-10-25T10:00:00.000Z",
            evidenceType: "SCRAPED_POST",
            verificationMethod: "AUTOMATED_SCRAPE",
            evidenceReference: "https://www.facebook.com/ads/library/?id=999",
            rawPayload: buildValidLiveRawPayloadString({
              storeDomain: "unrelated-merchant.com",
            }),
          },
          discoveryRunAd: {
            runId: "run_live_1",
            adId: "ad_unrelated_999",
            workspaceId: "ws_pet_1",
            providerId: "META_AD_LIBRARY",
            ingestOutcome: "NEW",
            sourceUrl: "https://www.facebook.com/ads/library/?id=999",
            observedAt: "2026-10-25T10:00:00.000Z",
          },
          expectedWorkspaceId: "ws_pet_1",
          expectedRunId: "run_live_1",
          expectedAdIds: ["ad_1"],
          expectedStoreDomain: "kittyspout.com",
          asOf,
        });
        return (
          res.isAuthenticLiveProviderObservation === false &&
          res.originEvidenceClassification === "CROSS_CANDIDATE_OR_DOMAIN"
        );
      },
    },
    {
      testId: "L15",
      category: "LIVE_ORIGIN_NEGATIVE",
      description: "Caller mutating provenance=LIVE_PROVIDER in memory on an observation lacking DB rawPayload/ledger backing is rejected",
      expectedOutcome: "isAuthenticallyLiveObservation=false, evaluateG16Candidate.isLiveVerified=false",
      exec: () => {
        const mutatedObs = makeValidLiveObs({
          provenance: "LIVE_PROVIDER",
          sourceMode: "LIVE_PROVIDER",
          sourceType: "LIVE_PROVIDER",
          isCached: false,
          isLiveRecord: true,
          rawPayload: null, // persisted AdObservation has null rawPayload
        });
        const cand = makeValidMerchantCandidate({
          sourceObservations: [mutatedObs],
        });
        const evalRes = evaluateG16Candidate(cand, "run_123");
        return (
          isAuthenticallyLiveObservation(mutatedObs) === false &&
          evalRes.isLiveVerified === false &&
          evalRes.validLineageObservationsCount === 0
        );
      },
    },
    {
      testId: "L16",
      category: "LIVE_ORIGIN_NEGATIVE",
      description: "rawPayload with malformed JSON or contradicting DiscoveryRunAd.providerId is rejected",
      expectedOutcome: "isAuthenticLiveProviderObservation=false, originEvidenceClassification=MALFORMED_OR_CONTRADICTORY_PAYLOAD",
      exec: () => {
        const malformedRes = classifyPersistedLiveObservation({
          adObservation: {
            id: "obs_l16_malformed",
            adId: "ad_1",
            observedAt: "2026-10-25T10:00:00.000Z",
            sourceTimestamp: "2026-10-25T10:00:00.000Z",
            evidenceType: "SCRAPED_POST",
            verificationMethod: "AUTOMATED_SCRAPE",
            evidenceReference: "https://www.facebook.com/ads/library/?id=101",
            rawPayload: "{not-valid-json",
          },
          discoveryRunAd: {
            runId: "run_live_1",
            adId: "ad_1",
            workspaceId: "ws_pet_1",
            providerId: "META_AD_LIBRARY",
            ingestOutcome: "NEW",
            sourceUrl: "https://www.facebook.com/ads/library/?id=101",
            observedAt: "2026-10-25T10:00:00.000Z",
          },
          expectedWorkspaceId: "ws_pet_1",
          expectedRunId: "run_live_1",
          asOf,
        });
        const contradictRes = classifyPersistedLiveObservation({
          adObservation: {
            id: "obs_l16_contradict",
            adId: "ad_1",
            observedAt: "2026-10-25T10:00:00.000Z",
            sourceTimestamp: "2026-10-25T10:00:00.000Z",
            evidenceType: "SCRAPED_POST",
            verificationMethod: "AUTOMATED_SCRAPE",
            evidenceReference: "https://www.facebook.com/ads/library/?id=101",
            rawPayload: buildValidLiveRawPayloadString({
              providerId: "TIKTOK_COMMERCIAL_CONTENT",
            }),
          },
          discoveryRunAd: {
            runId: "run_live_1",
            adId: "ad_1",
            workspaceId: "ws_pet_1",
            providerId: "META_AD_LIBRARY",
            ingestOutcome: "NEW",
            sourceUrl: "https://www.facebook.com/ads/library/?id=101",
            observedAt: "2026-10-25T10:00:00.000Z",
          },
          expectedWorkspaceId: "ws_pet_1",
          expectedRunId: "run_live_1",
          asOf,
        });
        return (
          malformedRes.isAuthenticLiveProviderObservation === false &&
          malformedRes.originEvidenceClassification ===
            "MALFORMED_OR_CONTRADICTORY_PAYLOAD" &&
          contradictRes.isAuthenticLiveProviderObservation === false &&
          contradictRes.originEvidenceClassification ===
            "MALFORMED_OR_CONTRADICTORY_PAYLOAD"
        );
      },
    },

    // ========================================================================
    // P01..P06: Realistic Positive Contracts
    // ========================================================================
    {
      testId: "P01",
      category: "POSITIVE_CONTRACT",
      description: "Real persisted ResearchEvidence / LandingPageSnapshot with valid schema.org @type=Product JSON-LD, matching domain/product/workspace, observedAt <= asOf, and valid SHA-256 hash produces VERIFIED",
      expectedOutcome: "identityStatus=VERIFIED, proofMethod=JSON_LD_PRODUCT_SCHEMA, validationStatus=CONTENT_VALIDATED_WITH_SOURCE",
      exec: () => {
        const validJsonLd = buildValidProductJsonLdString();
        const extracted = extractPersistedMerchantProofsFromDbRows({
          workspaceId: "ws_pet_1",
          candidateId: "cand_p01",
          researchProductId: "prod_p01",
          storeDomain: "kittyspout.com",
          canonicalProductUrl: "https://kittyspout.com/products/kittyspout-wireless-fountain",
          candidateTitle: "KittySpout Stainless Steel Cat Water Fountain",
          asOf,
          standaloneEvidence: [
            {
              id: "ev_p01",
              workspaceId: "ws_pet_1",
              productId: "prod_p01",
              observedValue: validJsonLd,
              sourceUrl: "https://kittyspout.com/products/kittyspout-wireless-fountain",
              observationMethod: "AUTOMATED_SCRAPE",
              classification: "VERIFIED",
              sourceContentRef: `sha256:${computeSha256Hex(validJsonLd)}`,
              observedAt: "2026-10-25T10:00:00.000Z",
            },
          ],
        });
        const cls = classifyHistoricalProductIdentity(
          {
            candidateId: "cand_p01",
            researchProductId: "prod_p01",
            workspaceId: "ws_pet_1",
            title: "KittySpout Stainless Steel Cat Water Fountain",
            storeDomain: "kittyspout.com",
            canonicalProductUrl: "https://kittyspout.com/products/kittyspout-wireless-fountain",
            observedAt: "2026-10-25T10:00:00.000Z",
            persistedMerchantProofs: extracted.validProofs,
          },
          asOf
        );
        return (
          extracted.validProofs.length === 1 &&
          extracted.validProofs[0].proofMethod === "JSON_LD_PRODUCT_SCHEMA" &&
          extracted.validProofs[0].hasJsonLdProduct === true &&
          extracted.validProofs[0].validationStatus === "CONTENT_VALIDATED_WITH_SOURCE" &&
          cls.identityStatus === "VERIFIED" &&
          cls.verificationEvidenceStatus === "INDEPENDENT_VERIFIED"
        );
      },
    },
    {
      testId: "P02",
      category: "POSITIVE_CONTRACT",
      description: "Real persisted SHOPIFY_PRODUCT_JSON payload with provenance produces VERIFIED with proofMethod=SHOPIFY_PRODUCT_JSON and hasJsonLdProduct=false",
      expectedOutcome: "identityStatus=VERIFIED, proofMethod=SHOPIFY_PRODUCT_JSON, hasJsonLdProduct=false",
      exec: () => {
        const shopifyPayload = JSON.stringify({
          proofMethod: "SHOPIFY_PRODUCT_JSON",
          product: {
            id: 8369671045340,
            title: "KittySpout Stainless Steel Cat Water Fountain",
            handle: "kittyspout-wireless-fountain",
            url: "https://kittyspout.com/products/kittyspout-wireless-fountain",
            currency: "USD",
            variants: [
              {
                id: 44912345678,
                title: "Default Title",
                sku: "KS-FOUNTAIN-01",
                price: "49.99",
                available: true,
              },
            ],
          },
        });
        const extracted = extractPersistedMerchantProofsFromDbRows({
          workspaceId: "ws_pet_1",
          candidateId: "cand_p02",
          researchProductId: "prod_p02",
          storeDomain: "kittyspout.com",
          canonicalProductUrl: "https://kittyspout.com/products/kittyspout-wireless-fountain",
          candidateTitle: "KittySpout Stainless Steel Cat Water Fountain",
          asOf,
          standaloneEvidence: [
            {
              id: "ev_p02_shopify",
              workspaceId: "ws_pet_1",
              productId: "prod_p02",
              observedValue: shopifyPayload,
              sourceUrl: "https://kittyspout.com/products/kittyspout-wireless-fountain.json",
              observationMethod: "SHOPIFY_PRODUCT_JSON",
              classification: "VERIFIED",
              sourceContentRef: `sha256:${computeSha256Hex(shopifyPayload)}`,
              observedAt: "2026-10-25T10:00:00.000Z",
            },
          ],
        });
        const cls = classifyHistoricalProductIdentity(
          {
            candidateId: "cand_p02",
            researchProductId: "prod_p02",
            workspaceId: "ws_pet_1",
            title: "KittySpout Stainless Steel Cat Water Fountain",
            storeDomain: "kittyspout.com",
            canonicalProductUrl: "https://kittyspout.com/products/kittyspout-wireless-fountain",
            observedAt: "2026-10-25T10:00:00.000Z",
            persistedMerchantProofs: extracted.validProofs,
          },
          asOf
        );
        return (
          extracted.validProofs.length === 1 &&
          extracted.validProofs[0].proofMethod === "SHOPIFY_PRODUCT_JSON" &&
          extracted.validProofs[0].hasJsonLdProduct === false &&
          extracted.validProofs[0].schemaVerified === true &&
          cls.identityStatus === "VERIFIED"
        );
      },
    },
    {
      testId: "P03",
      category: "POSITIVE_CONTRACT",
      description: "Real persisted AdObservation + DiscoveryRunAd with ingestOutcome=NEW, SCRAPED_POST, AUTOMATED_SCRAPE, rawPayload live execution envelope, providerRequestId, evidenceReference, same workspace/run/product, <= asOf is accepted as AUTHENTIC_LIVE_INGEST",
      expectedOutcome: "isAuthenticLiveProviderObservation=true, originEvidenceClassification=AUTHENTIC_LIVE_INGEST, derivedProvenance=LIVE_PROVIDER",
      exec: () => {
        const res = classifyPersistedLiveObservation({
          adObservation: {
            id: "obs_p03_live",
            adId: "ad_101",
            observedAt: "2026-10-25T10:00:00.000Z",
            sourceTimestamp: "2026-10-25T09:59:00.000Z",
            evidenceType: "SCRAPED_POST",
            verificationMethod: "AUTOMATED_SCRAPE",
            evidenceReference: "https://www.facebook.com/ads/library/?id=101",
            rawPayload: buildValidLiveRawPayloadString(),
          },
          discoveryRunAd: {
            id: "dra_p03",
            runId: "run_live_1",
            adId: "ad_101",
            workspaceId: "ws_pet_1",
            providerId: "META_AD_LIBRARY",
            libraryId: "lib_ad_101",
            ingestOutcome: "NEW",
            sourceUrl: "https://www.facebook.com/ads/library/?id=101",
            observedAt: "2026-10-25T10:00:00.000Z",
          },
          expectedWorkspaceId: "ws_pet_1",
          expectedRunId: "run_live_1",
          expectedCandidateId: "cand_p03",
          expectedAdIds: ["ad_101"],
          expectedStoreDomain: "kittyspout.com",
          asOf,
        });
        return (
          res.isAuthenticLiveProviderObservation === true &&
          res.originEvidenceClassification === "AUTHENTIC_LIVE_INGEST" &&
          res.derivedProvenance === "LIVE_PROVIDER" &&
          res.isCached === false &&
          res.isLiveRecord === true
        );
      },
    },
    {
      testId: "P04",
      category: "POSITIVE_CONTRACT",
      description: "Current stored DB snapshot (DiscoveryRunAd EXISTING + AdObservation rawPayload=null + zero workspace merchant schema rows) reconstructs to 0/3 live-verified under G16 (INSUFFICIENT_EVIDENCE)",
      expectedOutcome: "verifiedLiveCount=0, g16Verdict=INSUFFICIENT_EVIDENCE",
      exec: () => {
        const obsCls = classifyPersistedLiveObservation({
          adObservation: {
            id: "89477c50-c32c-41a6-a6bc-d10164a35314",
            adId: "b5c6fa6d-ff0b-4b4e-8339-99b6a8d2c6ef",
            observedAt: "2026-10-25T10:00:00.000Z",
            sourceTimestamp: "2026-10-25T10:00:00.000Z",
            evidenceType: "SCRAPED_POST",
            verificationMethod: "AUTOMATED_SCRAPE",
            evidenceReference: "https://www.facebook.com/ads/library/?id=2719363741763869",
            rawPayload: null,
          },
          discoveryRunAd: {
            runId: "kh02_run_1793506187495_df6cc250",
            adId: "b5c6fa6d-ff0b-4b4e-8339-99b6a8d2c6ef",
            workspaceId: "default-workspace",
            providerId: "META_AD_LIBRARY",
            ingestOutcome: "EXISTING",
            sourceUrl: "https://www.facebook.com/ads/library/?id=2719363741763869",
            observedAt: "2026-10-31T03:00:00.000Z",
          },
          expectedWorkspaceId: "default-workspace",
          expectedRunId: "kh02_run_1793506187495_df6cc250",
          asOf: new Date("2026-10-31T04:00:00.000Z"),
        });
        const top3Res = evaluateG16Top3([], "kh02_run_1793506187495_df6cc250", {
          requiredCount: 3,
          requireDistinctFamilies: true,
          evidenceIndex: { strictPersistedProofRequired: true },
        });
        return (
          obsCls.isAuthenticLiveProviderObservation === false &&
          obsCls.originEvidenceClassification === "REUSED_EXISTING_AD" &&
          top3Res.verifiedLiveCount === 0 &&
          top3Res.g16Verdict === "INSUFFICIENT_EVIDENCE"
        );
      },
    },
    {
      testId: "P05",
      category: "POSITIVE_CONTRACT",
      description: "CheckoutChamp funnel without root schema stays PROBABLE, while a verified root merchant domain with real Product schema is VERIFIED",
      expectedOutcome: "funnel=PROBABLE/FUNNEL_UNVERIFIED, rootDomainWithSchema=VERIFIED/INDEPENDENT_VERIFIED",
      exec: () => {
        const funnelCls = classifyHistoricalProductIdentity(
          {
            candidateId: "cand_p05_funnel",
            workspaceId: "ws_pet_1",
            title: "Uproot Cleaner Pro Pet Hair Remover",
            storeDomain: "cc.uprootclean.com",
            canonicalProductUrl: "https://cc.uprootclean.com/main/phr",
            observedAt: "2026-10-25T10:00:00.000Z",
            persistedMerchantProofs: [],
          },
          asOf
        );
        const rootJsonLd = buildValidProductJsonLdString({
          name: "Uproot Cleaner Pro Pet Hair Remover",
          sku: "UPROOT-PRO-01",
          url: "https://uprootclean.com/products/uproot-cleaner-pro",
        });
        const rootExtracted = extractPersistedMerchantProofsFromDbRows({
          workspaceId: "ws_pet_1",
          candidateId: "cand_p05_root",
          storeDomain: "uprootclean.com",
          canonicalProductUrl: "https://uprootclean.com/products/uproot-cleaner-pro",
          candidateTitle: "Uproot Cleaner Pro Pet Hair Remover",
          asOf,
          standaloneEvidence: [
            {
              id: "ev_p05_root",
              workspaceId: "ws_pet_1",
              observedValue: rootJsonLd,
              sourceUrl: "https://uprootclean.com/products/uproot-cleaner-pro",
              observationMethod: "AUTOMATED_SCRAPE",
              classification: "VERIFIED",
              sourceContentRef: `sha256:${computeSha256Hex(rootJsonLd)}`,
              observedAt: "2026-10-25T10:00:00.000Z",
            },
          ],
        });
        const rootCls = classifyHistoricalProductIdentity(
          {
            candidateId: "cand_p05_root",
            workspaceId: "ws_pet_1",
            title: "Uproot Cleaner Pro Pet Hair Remover",
            storeDomain: "uprootclean.com",
            canonicalProductUrl: "https://uprootclean.com/products/uproot-cleaner-pro",
            observedAt: "2026-10-25T10:00:00.000Z",
            persistedMerchantProofs: rootExtracted.validProofs,
          },
          asOf
        );
        return (
          funnelCls.identityStatus === "PROBABLE" &&
          funnelCls.verificationEvidenceStatus === "FUNNEL_UNVERIFIED" &&
          rootCls.identityStatus === "VERIFIED" &&
          rootCls.verificationEvidenceStatus === "INDEPENDENT_VERIFIED"
        );
      },
    },
    {
      testId: "P06",
      category: "POSITIVE_CONTRACT",
      description: "Three genuinely distinct Pet Gadgets products with persisted valid Product JSON-LD proofs and persisted origin-authentic live observations across three families PASS G16",
      expectedOutcome: "verifiedLiveCount=3, distinctFamiliesCount=3, distinctCanonicalProductsCount=3, g16Verdict=PASS",
      exec: () => {
        const items = [
          {
            candId: "cand_p06_1",
            prodId: "prod_p06_1",
            adId: "ad_p06_1",
            obsId: "obs_p06_1",
            evId: "ev_p06_1",
            title: "KittySpout Stainless Steel Cat Water Fountain",
            domain: "kittyspout.com",
            url: "https://kittyspout.com/products/kittyspout-wireless-fountain",
            sku: "KS-FOUNTAIN-01",
            familyKey: "pet_water_fountain",
          },
          {
            candId: "cand_p06_2",
            prodId: "prod_p06_2",
            adId: "ad_p06_2",
            obsId: "obs_p06_2",
            evId: "ev_p06_2",
            title: "PetLibro Granary Automatic Pet Feeder",
            domain: "petlibro.com",
            url: "https://petlibro.com/products/granary-automatic-pet-feeder",
            sku: "PL-FEEDER-02",
            familyKey: "automatic_pet_feeder",
          },
          {
            candId: "cand_p06_3",
            prodId: "prod_p06_3",
            adId: "ad_p06_3",
            obsId: "obs_p06_3",
            evId: "ev_p06_3",
            title: "Uproot Cleaner Pro Pet Hair Remover",
            domain: "uprootclean.com",
            url: "https://uprootclean.com/products/uproot-cleaner-pro",
            sku: "UP-HAIR-03",
            familyKey: "pet_hair_remover_roller",
          },
        ];

        const merchantEvidenceIndex: G16MerchantEvidenceIndex = {};
        const candidateObservationMap: Record<string, string[]> = {};
        const allowedObservationIds = new Set<string>();

        const candidates = items.map((it) => {
          const jsonLd = buildValidProductJsonLdString({
            name: it.title,
            sku: it.sku,
            url: it.url,
          });
          const extracted = extractPersistedMerchantProofsFromDbRows({
            workspaceId: "ws_pet_1",
            candidateId: it.candId,
            researchProductId: it.prodId,
            storeDomain: it.domain,
            canonicalProductUrl: it.url,
            candidateTitle: it.title,
            expectedSku: it.sku,
            asOf,
            standaloneEvidence: [
              {
                id: it.evId,
                workspaceId: "ws_pet_1",
                productId: it.prodId,
                observedValue: jsonLd,
                sourceUrl: it.url,
                observationMethod: "AUTOMATED_SCRAPE",
                classification: "VERIFIED",
                sourceContentRef: `sha256:${computeSha256Hex(jsonLd)}`,
                observedAt: "2026-10-25T10:00:00.000Z",
              },
            ],
          });

          const adObs: PersistedAdObservationRow = {
            id: it.obsId,
            adId: it.adId,
            observedAt: "2026-10-25T10:00:00.000Z",
            sourceTimestamp: "2026-10-25T09:58:00.000Z",
            evidenceType: "SCRAPED_POST",
            verificationMethod: "AUTOMATED_SCRAPE",
            evidenceReference: `https://www.facebook.com/ads/library/?id=${it.adId}`,
            rawPayload: buildValidLiveRawPayloadString({
              providerRequestId: `mcp_req_${it.obsId}`,
              externalAdId: `ext_${it.adId}`,
              storeDomain: it.domain,
              landingPageUrl: it.url,
            }),
          };
          const runAd: PersistedDiscoveryRunAdRow = {
            runId: "run_live_1",
            adId: it.adId,
            workspaceId: "ws_pet_1",
            providerId: "META_AD_LIBRARY",
            libraryId: `ext_${it.adId}`,
            ingestOutcome: "NEW",
            sourceUrl: `https://www.facebook.com/ads/library/?id=${it.adId}`,
            observedAt: "2026-10-25T10:00:00.000Z",
          };
          const obsCls = classifyPersistedLiveObservation({
            adObservation: adObs,
            discoveryRunAd: runAd,
            expectedWorkspaceId: "ws_pet_1",
            expectedRunId: "run_live_1",
            expectedCandidateId: it.candId,
            expectedAdIds: [it.adId],
            expectedStoreDomain: it.domain,
            asOf,
          });

          merchantEvidenceIndex[it.candId] = {
            verified: extracted.validProofs.length > 0,
            proofRefs: [`ResearchEvidence:${it.evId}`],
            schemaVerified: true,
            hasJsonLdProduct: true,
            proofMethod: "JSON_LD_PRODUCT_SCHEMA",
            validationStatus: "CONTENT_VALIDATED_WITH_SOURCE",
            fetchOutcome: "FETCH_SUCCEEDED",
            merchantVerifiedProductName: it.title,
            persistedProofs: extracted.validProofs,
          };
          candidateObservationMap[it.candId] = [it.obsId];
          allowedObservationIds.add(it.obsId);

          return {
            candidateId: it.candId,
            researchProductId: it.prodId,
            workspaceId: "ws_pet_1",
            title: it.title,
            storeDomain: it.domain,
            canonicalProductUrl: it.url,
            sku: it.sku,
            familyKey: it.familyKey,
            identityStatus: "VERIFIED",
            fetchOutcome: "FETCH_SUCCEEDED",
            resolutionSource: "JSON_LD_PRODUCT_SCHEMA",
            merchantVerifiedProductName: it.title,
            supportingAdIds: [it.adId],
            sourceObservations: [
              {
                observationId: it.obsId,
                sourceObservationId: it.obsId,
                sourceRecordId: it.adId,
                researchRunId: "run_live_1",
                workspaceId: "ws_pet_1",
                providerRequestId: obsCls.providerRequestId,
                evidenceReference: obsCls.evidenceReference,
                storeDomainEvidence: it.domain,
                landingPageUrl: it.url,
                provenance: obsCls.derivedProvenance,
                sourceMode: obsCls.derivedSourceMode,
                sourceType: obsCls.derivedSourceMode,
                isCached: obsCls.isCached,
                isLiveRecord: obsCls.isLiveRecord,
                persistedLiveOriginVerified: obsCls.isAuthenticLiveProviderObservation,
                originEvidenceClassification: obsCls.originEvidenceClassification,
                persistedAdObservation: adObs,
                persistedDiscoveryRunAd: runAd,
              },
            ],
          };
        });

        const top3Res = evaluateG16Top3(candidates, "run_live_1", {
          requiredCount: 3,
          requireDistinctFamilies: true,
          evidenceIndex: {
            strictPersistedProofRequired: true,
            workspaceId: "ws_pet_1",
            asOf,
            lineageIndex: {
              parentRunId: "run_live_1",
              allowedObservationIds,
            },
            identityIndex: {
              candidateObservationMap,
            },
            merchantEvidenceIndex,
          },
        });

        return (
          top3Res.verifiedLiveCount === 3 &&
          top3Res.distinctFamiliesCount === 3 &&
          top3Res.distinctCanonicalProductsCount === 3 &&
          top3Res.g16Verdict === "PASS"
        );
      },
    },
  ];
}

export function runG16SchemaAndOriginMatrixTests(): {
  totalTests: number;
  totalPassed: number;
  passed: boolean;
  merchantSchemaNegativeCount: number;
  merchantSchemaNegativePassed: number;
  liveOriginNegativeCount: number;
  liveOriginNegativePassed: number;
  positiveContractCount: number;
  positiveContractPassed: number;
  receipts: SchemaAndOriginMatrixTestReceipt[];
} {
  const defs = buildSchemaAndOriginMatrixCaseDefinitions();
  const receipts: SchemaAndOriginMatrixTestReceipt[] = defs.map((d) => {
    let passed = false;
    try {
      passed = d.exec();
    } catch {
      passed = false;
    }
    return {
      testId: d.testId,
      category: d.category,
      description: d.description,
      passed,
      expectedOutcome: d.expectedOutcome,
      observedOutcome: passed ? d.expectedOutcome : "FAILED_ASSERTION",
    };
  });

  const mCases = receipts.filter((r) => r.category === "MERCHANT_SCHEMA_NEGATIVE");
  const lCases = receipts.filter((r) => r.category === "LIVE_ORIGIN_NEGATIVE");
  const pCases = receipts.filter((r) => r.category === "POSITIVE_CONTRACT");
  const totalPassed = receipts.filter((r) => r.passed).length;

  return {
    totalTests: receipts.length,
    totalPassed,
    passed: totalPassed === receipts.length,
    merchantSchemaNegativeCount: mCases.length,
    merchantSchemaNegativePassed: mCases.filter((r) => r.passed).length,
    liveOriginNegativeCount: lCases.length,
    liveOriginNegativePassed: lCases.filter((r) => r.passed).length,
    positiveContractCount: pCases.length,
    positiveContractPassed: pCases.filter((r) => r.passed).length,
    receipts,
  };
}
