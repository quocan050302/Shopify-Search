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
    fetchOutcome?: string;
    merchantVerifiedProductName?: string;
  };
}

export interface G16EvidenceIndex {
  lineageIndex?: G16LineageIndex;
  identityIndex?: G16IdentityIndex;
  merchantEvidenceIndex?: G16MerchantEvidenceIndex;
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

function isFunnelOrCheckoutChamp(storeDomain: string | null, canonicalUrl: string | null): boolean {
  const dom = (storeDomain || "").toLowerCase();
  const url = (canonicalUrl || "").toLowerCase();
  return (
    url.includes("cc.uprootclean.com") ||
    dom === "cc.uprootclean.com" ||
    dom.includes("checkoutchamp") ||
    url.includes("checkoutchamp") ||
    /^(?:cc|lp|offer|funnel|quiz|get|try)\.[a-z0-9-]+\.[a-z]{2,}$/i.test(dom) && !url.includes("/products/")
  );
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
 * Never counts raw storeDomain or canonicalProductUrl strings alone as proof.
 */
export function extractMerchantProofRefs(
  candidate: any,
  merchantEvidenceIndex?: G16MerchantEvidenceIndex
): string[] {
  if (!candidate || typeof candidate !== "object") return [];
  const refs: string[] = [];

  const verifiedName = cleanNonBlankString(candidate.merchantVerifiedProductName);
  if (verifiedName) {
    refs.push(`merchantVerifiedProductName:${verifiedName}`);
  }

  const fetchOutcome = cleanNonBlankString(candidate.fetchOutcome);
  if (fetchOutcome === "FETCH_SUCCEEDED" || fetchOutcome === "ACTUAL_PRODUCT_PAGE" || fetchOutcome === "EXISTING_DB_PRODUCT") {
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
  if (skuOrId) {
    refs.push(`productIdentifier:${skuOrId}`);
  }

  if (candidate.merchantPageVerified === true || candidate.existingProductVerified === true) {
    refs.push("merchantPageVerified:true");
  }

  const verificationReason = cleanNonBlankString(candidate.verificationReason);
  if (
    verificationReason &&
    /(?:json-ld|schema|storefront|shopify|fetched|merchant product|product page verified)/i.test(
      verificationReason
    )
  ) {
    refs.push(`verificationReason:${verificationReason.slice(0, 120)}`);
  }

  if (Array.isArray(candidate.identityEvidenceReferences)) {
    for (const ref of candidate.identityEvidenceReferences) {
      const cleanRef = cleanNonBlankString(ref);
      if (
        cleanRef &&
        cleanRef !== candidate.canonicalProductUrl &&
        cleanRef !== candidate.storeDomain
      ) {
        refs.push(`evidenceRef:${cleanRef}`);
      }
    }
  }

  const candId = cleanNonBlankString(candidate.candidateId);
  if (candId && merchantEvidenceIndex?.[candId]?.verified === true) {
    const idxEntry = merchantEvidenceIndex[candId];
    if (Array.isArray(idxEntry.proofRefs) && idxEntry.proofRefs.length > 0) {
      for (const r of idxEntry.proofRefs) {
        const cr = cleanNonBlankString(r);
        if (cr) refs.push(`indexProof:${cr}`);
      }
    } else if (idxEntry.schemaVerified || idxEntry.fetchOutcome === "FETCH_SUCCEEDED" || idxEntry.merchantVerifiedProductName) {
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
  merchantEvidenceIndex?: G16MerchantEvidenceIndex
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

  const proofRefs = extractMerchantProofRefs(candidate, merchantEvidenceIndex);
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
  const merchantProofRefs = extractMerchantProofRefs(candidate, evidenceIndex?.merchantEvidenceIndex);
  const merchantVerified = hasVerifiedMerchantIdentity(candidate, evidenceIndex?.merchantEvidenceIndex);
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
