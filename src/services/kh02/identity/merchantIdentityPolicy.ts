/**
 * SWAI KH-02 V12.4.3.5.1 — Unified Merchant/Funnel Identity Policy & Point-in-Time Historical Identity Classifier
 *
 * Enforces identical anti-fake-pass merchant identity and funnel rules across:
 * 1. Historical DEV/HOLDOUT point-in-time replay (`scripts/kh02/runBacktestV12_4_3_4_2.ts`)
 * 2. G16 Top-3 live lineage & merchant proof evaluation (`scripts/kh02/g16CandidateEvaluator.ts`)
 * 3. Acceptance truth diagnostics (`scripts/kh02/acceptanceTruth.ts`)
 *
 * Non-negotiable invariants:
 * - A URL path matching `/products/...` or `/main/(phr|grooming-gloves)` is a discovery signal ONLY;
 *   it NEVER promotes `identityStatus` to `"VERIFIED"`.
 * - CheckoutChamp and multi-step sales funnels (`cc.uprootclean.com`, `order.uprootclean.com`, `checkoutchamp`,
 *   `lp.*`, `offer.*`, `funnel.*`, `quiz.*`, `get.*`, `try.*`) are classified as `isCheckoutChampFunnel: true`,
 *   `identityStatus: "PROBABLE"`, `verificationEvidenceStatus: "FUNNEL_UNVERIFIED"` unless backed by
 *   independent point-in-time root JSON-LD product schema proof.
 * - Synthetic proof strings (`jsonld:<storeDomain>`, `obs_<runId>_<candidateId>`, `req_<runId>`) and
 *   test fixtures (`TEST_FIXTURE`, `CONTROLLED_FIXTURE`, `SYNTHETIC`, `MOCK`, `uahpet_lp_hash_v12_4_3_3`)
 *   are rejected unconditionally.
 */

export type IdentityStatusClassification = "VERIFIED" | "PROBABLE" | "UNVERIFIED";

export type VerificationEvidenceStatus =
  | "INDEPENDENT_VERIFIED"
  | "DISCOVERY_ONLY"
  | "STALE"
  | "MISSING"
  | "POST_CUTOFF"
  | "FUNNEL_UNVERIFIED";

export interface PersistedMerchantProofRecord {
  id: string;
  sourceTable:
    | "ResearchEvidence"
    | "LandingPageSnapshot"
    | "CompetitorOfferSnapshot"
    | "ResearchProduct";
  workspaceId?: string | null;
  researchRunId?: string | null;
  candidateId?: string | null;
  researchProductId?: string | null;
  storeDomain?: string | null;
  canonicalUrl?: string | null;
  observedAt?: Date | string | null;
  schemaVerified?: boolean;
  hasJsonLdProduct?: boolean;
  fetchOutcome?: string | null;
  resolutionSource?: string | null;
  merchantProductId?: string | null;
  sku?: string | null;
  gtin?: string | null;
  verifiedProductTitle?: string | null;
  contentHash?: string | null;
  evidenceOrigin?: string | null;
  isSyntheticOrFixture?: boolean;
}

export interface HistoricalProductIdentityInput {
  candidateId?: string | null;
  researchProductId?: string | null;
  workspaceId?: string | null;
  title?: string | null;
  storeDomain?: string | null;
  canonicalProductUrl?: string | null;
  observedAt?: Date | string | null;
  metadataUpdatedAt?: Date | string | null;
  isAdOnlyFallback?: boolean;
  isSyntheticQuarantine?: boolean;
  maxStaleDays?: number;
  persistedMerchantProofs?: PersistedMerchantProofRecord[];
}

export interface HistoricalProductIdentityClassification {
  identityStatus: IdentityStatusClassification;
  verificationEvidenceStatus: VerificationEvidenceStatus;
  isCheckoutChampFunnel: boolean;
  evidenceRefIds: string[];
  independentMerchantProofRefs: string[];
  discoveryRefs: string[];
  evidenceObservedAt: string | null;
  eligibilityAtAsOf: boolean;
  reasonCodes: string[];
}

export const NON_MERCHANT_PLATFORM_DOMAINS = new Set([
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
  "competitor-store.com",
  "example.com",
]);

const SYNTHETIC_HASH_OR_ID_PATTERNS =
  /^(?:ad_fixture_|fixture_|syn_|mock_|test_fixture_)|uahpet_lp_hash_v12_4_3_3|\[SYNTHETIC_DEMO\]|^Synthetic Fixture:/i;

const SYNTHETIC_PROVENANCE_VALUES = new Set([
  "TEST_FIXTURE",
  "CONTROLLED_FIXTURE",
  "SYNTHETIC",
  "MOCK",
  "FAKE",
]);

function cleanNonBlank(val: unknown): string | null {
  if (typeof val !== "string") return null;
  const trimmed = val.trim();
  if (
    !trimmed ||
    trimmed.toLowerCase() === "unknown" ||
    trimmed.toLowerCase() === "null" ||
    trimmed.toLowerCase() === "undefined"
  ) {
    return null;
  }
  return trimmed;
}

export function normalizeMerchantHost(rawDomainOrUrl: string | null | undefined): string | null {
  const clean = cleanNonBlank(rawDomainOrUrl);
  if (!clean) return null;
  try {
    const withProto = /^https?:\/\//i.test(clean) ? clean : `https://${clean}`;
    const u = new URL(withProto);
    return u.hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return (
      clean
        .toLowerCase()
        .replace(/^https?:\/\//, "")
        .replace(/^www\./, "")
        .split("/")[0] || null
    );
  }
}

/**
 * Shared funnel / CheckoutChamp detector used across G16 evaluation and historical backtest replay.
 */
export function isFunnelOrCheckoutChamp(
  storeDomain: string | null | undefined,
  canonicalUrl: string | null | undefined
): boolean {
  const dom = ( normalizeMerchantHost(storeDomain) || (storeDomain || "").toLowerCase().trim() );
  const url = (canonicalUrl || "").toLowerCase().trim();
  let urlHost = "";
  let urlPath = "";
  if (url) {
    try {
      const parsed = new URL(url);
      urlHost = parsed.hostname.toLowerCase().replace(/^www\./, "");
      urlPath = parsed.pathname.toLowerCase();
    } catch {
      urlPath = url;
    }
  }
  const effectiveHost = dom || urlHost;

  if (
    effectiveHost === "cc.uprootclean.com" ||
    effectiveHost === "order.uprootclean.com" ||
    urlHost === "cc.uprootclean.com" ||
    urlHost === "order.uprootclean.com" ||
    url.includes("cc.uprootclean.com") ||
    url.includes("order.uprootclean.com") ||
    effectiveHost.includes("checkoutchamp") ||
    url.includes("checkoutchamp") ||
    /\/main\/(?:phr|grooming-gloves|wmtabs)\b/i.test(urlPath)
  ) {
    return true;
  }

  if (
    /^(?:cc|lp|offer|funnel|quiz|get|try|order)\.[a-z0-9-]+\.[a-z]{2,}$/i.test(effectiveHost) &&
    !urlPath.includes("/products/")
  ) {
    return true;
  }

  return false;
}

/**
 * Checks whether a proof reference string is a synthetic/fabricated placeholder
 * (e.g. `jsonld:kittyspout.com` without an evidence record ID).
 */
export function isSyntheticMerchantProofRef(ref: string | null | undefined): boolean {
  const clean = cleanNonBlank(ref);
  if (!clean) return true;
  // `jsonld:<domain>` with no record ID or path is the legacy fabricated ref from acceptanceTruth.ts
  if (/^jsonld:[a-z0-9.-]+\.[a-z]{2,}$/i.test(clean)) {
    return true;
  }
  if (/^evidenceRef:jsonld:[a-z0-9.-]+\.[a-z]{2,}$/i.test(clean)) {
    return true;
  }
  if (SYNTHETIC_HASH_OR_ID_PATTERNS.test(clean)) {
    return true;
  }
  return false;
}

/**
 * Checks whether an observation ID or providerRequestId is a fabricated hydration string
 * (`obs_<jobId>_<candId>` or `req_<jobId>`).
 */
export function isFabricatedHydrationObservation(obs: any, runId?: string | null): boolean {
  if (!obs || typeof obs !== "object") return false;
  const obsId = cleanNonBlank(obs.observationId || obs.sourceObservationId || obs.id) || "";
  const reqId = cleanNonBlank(obs.providerRequestId) || "";
  const candId = cleanNonBlank(obs.candidateId) || "";
  const cleanRunId = cleanNonBlank(runId || obs.researchRunId) || "";

  if (cleanRunId && candId && obsId === `obs_${cleanRunId}_${candId}`) {
    return true;
  }
  if (cleanRunId && reqId === `req_${cleanRunId}`) {
    return true;
  }
  if (/^obs_kh02_run_[0-9]+_[a-z0-9]+_cand_/i.test(obsId)) {
    return true;
  }
  if (/^req_kh02_run_[0-9]+_[a-z0-9]+$/i.test(reqId)) {
    return true;
  }
  return false;
}

function parseValidDate(val: Date | string | null | undefined): Date | null {
  if (!val) return null;
  const d = val instanceof Date ? val : new Date(val);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * Pure point-in-time product identity classifier (`P0-01` & `P0-03`).
 * Never promotes a candidate to `"VERIFIED"` from URL path patterns (`/products/...` or `/main/...`) alone.
 * Requires independent point-in-time (`<= asOf`) merchant verification proof from persisted evidence records.
 */
export function classifyHistoricalProductIdentity(
  input: HistoricalProductIdentityInput,
  asOf: Date | string
): HistoricalProductIdentityClassification {
  const asOfDate = parseValidDate(asOf) || new Date(0);
  const candidateId = cleanNonBlank(input.candidateId);
  const title = cleanNonBlank(input.title) || "";
  const storeDomain = normalizeMerchantHost(input.storeDomain || input.canonicalProductUrl);
  const canonicalUrl = cleanNonBlank(input.canonicalProductUrl);

  const discoveryRefs: string[] = [];
  if (candidateId) discoveryRefs.push(`candidate:${candidateId}`);
  if (storeDomain) discoveryRefs.push(`domain:${storeDomain}`);
  if (canonicalUrl) discoveryRefs.push(`url:${canonicalUrl}`);

  const isCheckoutChampFunnel = isFunnelOrCheckoutChamp(storeDomain, canonicalUrl);

  // 1. Reject synthetic / test fixture / quarantine records immediately
  if (
    input.isSyntheticQuarantine === true ||
    (candidateId && SYNTHETIC_HASH_OR_ID_PATTERNS.test(candidateId)) ||
    SYNTHETIC_HASH_OR_ID_PATTERNS.test(title)
  ) {
    return {
      identityStatus: "UNVERIFIED",
      verificationEvidenceStatus: "MISSING",
      isCheckoutChampFunnel,
      evidenceRefIds: [],
      independentMerchantProofRefs: [],
      discoveryRefs,
      evidenceObservedAt: null,
      eligibilityAtAsOf: false,
      reasonCodes: ["SYNTHETIC_OR_QUARANTINE_REJECTED"],
    };
  }

  // 2. Enforce point-in-time observation cutoff
  const obsDate = parseValidDate(input.observedAt);
  if (obsDate && obsDate.getTime() > asOfDate.getTime()) {
    return {
      identityStatus: "UNVERIFIED",
      verificationEvidenceStatus: "POST_CUTOFF",
      isCheckoutChampFunnel,
      evidenceRefIds: [],
      independentMerchantProofRefs: [],
      discoveryRefs,
      evidenceObservedAt: obsDate.toISOString(),
      eligibilityAtAsOf: false,
      reasonCodes: ["OBSERVATION_TIMESTAMP_EXCEEDS_ASOF"],
    };
  }

  // 3. Validate concrete merchant domain and product URL structure
  if (
    !storeDomain ||
    !storeDomain.includes(".") ||
    NON_MERCHANT_PLATFORM_DOMAINS.has(storeDomain) ||
    storeDomain.endsWith(".example.com") ||
    !canonicalUrl
  ) {
    return {
      identityStatus: "UNVERIFIED",
      verificationEvidenceStatus: "MISSING",
      isCheckoutChampFunnel,
      evidenceRefIds: [],
      independentMerchantProofRefs: [],
      discoveryRefs,
      evidenceObservedAt: null,
      eligibilityAtAsOf: false,
      reasonCodes: ["MISSING_CONCRETE_MERCHANT_DOMAIN_OR_URL"],
    };
  }

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(canonicalUrl);
    if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") {
      throw new Error("Invalid protocol");
    }
  } catch {
    return {
      identityStatus: "UNVERIFIED",
      verificationEvidenceStatus: "MISSING",
      isCheckoutChampFunnel,
      evidenceRefIds: [],
      independentMerchantProofRefs: [],
      discoveryRefs,
      evidenceObservedAt: null,
      eligibilityAtAsOf: false,
      reasonCodes: ["MALFORMED_CANONICAL_PRODUCT_URL"],
    };
  }

  const pathname = parsedUrl.pathname.toLowerCase();
  const isNonProductPath =
    !pathname ||
    pathname === "/" ||
    /^\/(collections|browse|search|pages|blogs|cart|checkout)(\/|$)/i.test(pathname) ||
    /\/products\/(?:null|undefined|nan|none|placeholder)(?:[-_]\d+)?(?:\/|$|\?)/i.test(pathname);

  if (isNonProductPath) {
    return {
      identityStatus: "UNVERIFIED",
      verificationEvidenceStatus: "MISSING",
      isCheckoutChampFunnel,
      evidenceRefIds: [],
      independentMerchantProofRefs: [],
      discoveryRefs,
      evidenceObservedAt: null,
      eligibilityAtAsOf: false,
      reasonCodes: ["NON_PRODUCT_OR_COLLECTION_URL_PATH"],
    };
  }

  // 4. Evaluate persisted independent merchant proof records at `<= asOf`
  const proofs = Array.isArray(input.persistedMerchantProofs) ? input.persistedMerchantProofs : [];
  const validProofs: PersistedMerchantProofRecord[] = [];
  const reasonCodes: string[] = [];
  let hadPostCutoffProof = false;
  let hadStaleProof = false;
  let hadSyntheticProof = false;
  const maxStaleMs =
    typeof input.maxStaleDays === "number" && input.maxStaleDays > 0
      ? input.maxStaleDays * 86_400_000
      : null;

  for (const proof of proofs) {
    if (!proof || typeof proof !== "object" || !cleanNonBlank(proof.id)) {
      continue;
    }
    const originUpper = String(proof.evidenceOrigin || "").toUpperCase();
    if (
      proof.isSyntheticOrFixture === true ||
      SYNTHETIC_PROVENANCE_VALUES.has(originUpper) ||
      SYNTHETIC_HASH_OR_ID_PATTERNS.test(String(proof.id || "")) ||
      SYNTHETIC_HASH_OR_ID_PATTERNS.test(String(proof.contentHash || "")) ||
      SYNTHETIC_HASH_OR_ID_PATTERNS.test(String(proof.verifiedProductTitle || ""))
    ) {
      hadSyntheticProof = true;
      continue;
    }

    // Workspace isolation check when both candidate and proof specify workspaceId
    if (
      cleanNonBlank(input.workspaceId) &&
      cleanNonBlank(proof.workspaceId) &&
      cleanNonBlank(input.workspaceId) !== cleanNonBlank(proof.workspaceId)
    ) {
      reasonCodes.push("CROSS_WORKSPACE_MERCHANT_PROOF_REJECTED");
      continue;
    }

    // Domain consistency check
    const proofDomain = normalizeMerchantHost(proof.storeDomain || proof.canonicalUrl);
    if (
      proofDomain &&
      proofDomain !== storeDomain &&
      !proofDomain.endsWith(`.${storeDomain}`) &&
      !storeDomain.endsWith(`.${proofDomain}`)
    ) {
      reasonCodes.push("MERCHANT_DOMAIN_MISMATCH_PROOF_REJECTED");
      continue;
    }

    const proofDate = parseValidDate(proof.observedAt);
    if (!proofDate) {
      reasonCodes.push("MISSING_PROOF_TIMESTAMP_REJECTED");
      continue;
    }

    if (proofDate.getTime() > asOfDate.getTime()) {
      hadPostCutoffProof = true;
      continue;
    }

    if (maxStaleMs !== null && asOfDate.getTime() - proofDate.getTime() > maxStaleMs) {
      hadStaleProof = true;
      continue;
    }

    const hasSchemaOrVerifiedMetadata =
      proof.schemaVerified === true ||
      proof.hasJsonLdProduct === true ||
      ((proof.fetchOutcome === "FETCH_SUCCEEDED" || proof.fetchOutcome === "ACTUAL_PRODUCT_PAGE") &&
        Boolean(
          cleanNonBlank(proof.merchantProductId) ||
            cleanNonBlank(proof.sku) ||
            cleanNonBlank(proof.gtin) ||
            cleanNonBlank(proof.verifiedProductTitle)
        ));

    if (!hasSchemaOrVerifiedMetadata) {
      continue;
    }

    validProofs.push(proof);
  }

  // 5. CheckoutChamp / multi-step sales funnel rule (`P0-03`):
  // Never promote a CheckoutChamp / funnel domain to VERIFIED without root JSON-LD product schema proof
  if (isCheckoutChampFunnel) {
    const hasRootJsonLdProof = validProofs.some(
      (p) =>
        (p.schemaVerified === true || p.hasJsonLdProduct === true) &&
        !isFunnelOrCheckoutChamp(p.storeDomain, p.canonicalUrl)
    );
    if (!hasRootJsonLdProof) {
      return {
        identityStatus: "PROBABLE",
        verificationEvidenceStatus: "FUNNEL_UNVERIFIED",
        isCheckoutChampFunnel: true,
        evidenceRefIds: [],
        independentMerchantProofRefs: [],
        discoveryRefs,
        evidenceObservedAt: null,
        eligibilityAtAsOf: false,
        reasonCodes: [
          "CHECKOUTCHAMP_OR_FUNNEL_UNVERIFIED_WITHOUT_ROOT_JSON_LD",
          ...Array.from(new Set(reasonCodes)),
        ],
      };
    }
  }

  // 6. If valid independent point-in-time merchant proof(s) exist at `<= asOf`, classify as VERIFIED
  if (validProofs.length > 0) {
    validProofs.sort((a, b) => {
      const da = parseValidDate(a.observedAt)?.getTime() || 0;
      const db = parseValidDate(b.observedAt)?.getTime() || 0;
      return db - da;
    });
    const latestObservedAt = parseValidDate(validProofs[0].observedAt)?.toISOString() || null;
    const evidenceRefIds = Array.from(new Set(validProofs.map((p) => `${p.sourceTable}:${p.id}`)));
    const independentMerchantProofRefs = Array.from(
      new Set(
        validProofs.flatMap((p) => {
          const refs: string[] = [`${p.sourceTable}:${p.id}`];
          if (p.schemaVerified || p.hasJsonLdProduct) {
            refs.push(`jsonld_verified:${p.sourceTable}:${p.id}`);
          }
          if (cleanNonBlank(p.merchantProductId)) {
            refs.push(`merchantProductId:${cleanNonBlank(p.merchantProductId)}`);
          }
          if (cleanNonBlank(p.sku)) {
            refs.push(`sku:${cleanNonBlank(p.sku)}`);
          }
          return refs;
        })
      )
    );

    return {
      identityStatus: "VERIFIED",
      verificationEvidenceStatus: "INDEPENDENT_VERIFIED",
      isCheckoutChampFunnel,
      evidenceRefIds,
      independentMerchantProofRefs,
      discoveryRefs,
      evidenceObservedAt: latestObservedAt,
      eligibilityAtAsOf: true,
      reasonCodes: ["INDEPENDENT_POINT_IN_TIME_MERCHANT_PROOF_VERIFIED"],
    };
  }

  // 7. No independent point-in-time merchant proof at `<= asOf`:
  // Fail closed to PROBABLE (NEVER promote based on `/products/...` URL path!)
  let verificationEvidenceStatus: VerificationEvidenceStatus = "DISCOVERY_ONLY";
  if (hadPostCutoffProof) {
    verificationEvidenceStatus = "POST_CUTOFF";
    reasonCodes.push("POST_CUTOFF_MERCHANT_PROOF_REJECTED");
  } else if (hadStaleProof) {
    verificationEvidenceStatus = "STALE";
    reasonCodes.push("STALE_MERCHANT_PROOF_REJECTED");
  } else if (hadSyntheticProof) {
    verificationEvidenceStatus = "MISSING";
    reasonCodes.push("SYNTHETIC_MERCHANT_PROOF_REJECTED");
  } else if (input.isAdOnlyFallback || !cleanNonBlank(input.researchProductId)) {
    verificationEvidenceStatus = "DISCOVERY_ONLY";
    reasonCodes.push("AD_ONLY_NO_INDEPENDENT_MERCHANT_PROOF");
  } else {
    verificationEvidenceStatus = "DISCOVERY_ONLY";
    reasonCodes.push("URL_PATH_OR_PRODUCT_ROW_ONLY_NO_INDEPENDENT_POINT_IN_TIME_MERCHANT_PROOF");
  }

  return {
    identityStatus: "PROBABLE",
    verificationEvidenceStatus,
    isCheckoutChampFunnel,
    evidenceRefIds: [],
    independentMerchantProofRefs: [],
    discoveryRefs,
    evidenceObservedAt: null,
    eligibilityAtAsOf: false,
    reasonCodes: Array.from(new Set(reasonCodes)),
  };
}

