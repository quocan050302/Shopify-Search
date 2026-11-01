/**
 * SWAI KH-02 V12.4.3.5.1 — Unified Merchant/Funnel Identity Policy, Persisted Schema Proof Validator,
 * Origin-Authentic G16 Live Observation Classifier & Point-in-Time Historical Identity Classifier
 *
 * Enforces identical anti-fake-pass merchant identity, schema truth, and live provenance rules across:
 * 1. Historical DEV/HOLDOUT point-in-time replay (`scripts/kh02/runBacktestV12_4_3_4_2.ts`)
 * 2. G16 Top-3 live lineage & merchant proof evaluation (`scripts/kh02/g16CandidateEvaluator.ts`)
 * 3. Acceptance truth diagnostics (`scripts/kh02/acceptanceTruth.ts`)
 *
 * Non-negotiable invariants:
 * - A URL path matching `/products/...` or `/main/(phr|grooming-gloves)` is a discovery signal ONLY;
 *   it NEVER promotes `identityStatus` to `"VERIFIED"`.
 * - `LandingPageSnapshot` rows with `pageTitle`, `finalUrl`, and `contentHash` (or CRO `observationsJson`)
 *   NEVER imply `hasJsonLdProduct=true` or `schemaVerified=true` unless raw parseable `schema.org`
 *   `@type: "Product"` / `"ProductGroup"` JSON-LD (or verified `SHOPIFY_PRODUCT_JSON` / `VERIFIED_MERCHANT_API`)
 *   is present and its SHA-256 hash matches.
 * - Caller-supplied bare boolean flags (`schemaVerified: true`, `hasJsonLdProduct: true`,
 *   `fetchOutcome: "FETCH_SUCCEEDED"`) without validated raw source payload + SHA-256 digest are rejected.
 * - Persisted `AdObservation` + `DiscoveryRunAd` rows are NEVER rebranded as `LIVE_PROVIDER` merely because
 *   they exist in DB or have `ingestOutcome: "NEW" | "UPDATED"`; authentic live provenance requires an
 *   immutable `rawPayload` live execution envelope + `evidenceReference` + `providerRequestId`/`mcpInvocationRef`
 *   matching run, workspace, provider, candidate/ad, and `<= asOf` timestamps.
 */

import { createHash } from "crypto";

export type IdentityStatusClassification = "VERIFIED" | "PROBABLE" | "UNVERIFIED";

export type VerificationEvidenceStatus =
  | "INDEPENDENT_VERIFIED"
  | "DISCOVERY_ONLY"
  | "STALE"
  | "MISSING"
  | "POST_CUTOFF"
  | "FUNNEL_UNVERIFIED";

export type MerchantProofValidationStatus =
  | "CONTENT_VALIDATED_WITH_SOURCE"
  | "RAW_SOURCE_NOT_RECONSTRUCTABLE"
  | "RAW_SOURCE_HASH_TAMPERED"
  | "NO_PRODUCT_JSON_LD_IN_PAYLOAD"
  | "NON_PRODUCT_JSON_LD_TYPE"
  | "HTTP_OR_ACCESS_BLOCKED"
  | "UNSAFE_OBSERVATION_METHOD_OR_CLASSIFICATION"
  | "CROSS_WORKSPACE_REJECTED"
  | "DOMAIN_MISMATCH_REJECTED"
  | "PRODUCT_OR_SKU_MISMATCH_REJECTED"
  | "POST_CUTOFF_OR_INVALID_DATE"
  | "SYNTHETIC_OR_FIXTURE_REJECTED"
  | "OFFER_SNAPSHOT_NOT_IDENTITY_PROOF"
  | "PRODUCT_ROW_DISCOVERY_ONLY"
  | "UNVALIDATED_CALLER_FLAGS_REJECTED";

export type MerchantProofMethod =
  | "JSON_LD_PRODUCT_SCHEMA"
  | "SHOPIFY_PRODUCT_JSON"
  | "VERIFIED_MERCHANT_API"
  | "NONE";

export type OriginEvidenceClassification =
  | "AUTHENTIC_LIVE_INGEST"
  | "PERSISTED_LIVE_ORIGIN_UNVERIFIED"
  | "REUSED_EXISTING_AD"
  | "FALLBACK_OR_SYNTHETIC"
  | "CROSS_WORKSPACE_OR_RUN"
  | "POST_CUTOFF_OR_INVALID_DATE"
  | "CROSS_CANDIDATE_OR_DOMAIN"
  | "MALFORMED_OR_CONTRADICTORY_PAYLOAD";

/**
 * Exact Prisma model projection for `ResearchEvidence` (`prisma/schema.prisma`).
 * Note: `evidenceType` does NOT exist on `ResearchEvidence` (only on `AdObservation`).
 */
export interface PersistedResearchEvidenceRow {
  id: string;
  workspaceId?: string | null;
  subjectType?: string | null;
  subjectId?: string | null;
  pillar?: string | null;
  claim?: string | null;
  observedValue?: string | null;
  sourceUrl?: string | null;
  observationMethod?: string | null;
  classification?: string | null;
  sourceContentRef?: string | null;
  observedAt?: Date | string | null;
  verifiedAt?: Date | string | null;
  verifierActorId?: string | null;
  createdAt?: Date | string | null;
  productId?: string | null;
}

/**
 * Exact Prisma model projection for `LandingPageSnapshot` (`prisma/schema.prisma`).
 * Note: `productTitle`, `canonicalUrl`, and `capturedAt` do NOT exist on `LandingPageSnapshot`.
 */
export interface PersistedLandingPageSnapshotRow {
  id: string;
  workspaceId?: string | null;
  productId?: string | null;
  storeId?: string | null;
  adId?: string | null;
  originalUrl?: string | null;
  finalUrl?: string | null;
  httpStatus?: number | null;
  accessStatus?: string | null;
  pageTitle?: string | null;
  metaDescription?: string | null;
  contentHash?: string | null;
  observationsJson?: string | null;
  croSignalsJson?: string | null;
  messageMatchJson?: string | null;
  warningsJson?: string | null;
  analysisVersion?: string | null;
  observedAt?: Date | string | null;
  createdAt?: Date | string | null;
}

/**
 * Exact Prisma model projection for `CompetitorOfferSnapshot` (`prisma/schema.prisma`).
 * Note: `offerUrl`, `priceText`, `priceAmount`, and `capturedAt` do NOT exist on `CompetitorOfferSnapshot`.
 */
export interface PersistedCompetitorOfferSnapshotRow {
  id: string;
  workspaceId?: string | null;
  productId?: string | null;
  storeId?: string | null;
  adId?: string | null;
  sourceUrl?: string | null;
  finalUrl?: string | null;
  currency?: string | null;
  sellingPrice?: unknown;
  compareAtPrice?: unknown;
  bundleQuantity?: number | null;
  hasFreeShipping?: boolean | null;
  shippingThreshold?: unknown;
  availability?: string | null;
  offerDataJson?: string | null;
  evidenceJson?: string | null;
  snapshotHash?: string | null;
  observedAt?: Date | string | null;
  createdAt?: Date | string | null;
}

/**
 * Exact Prisma model projection for `ResearchProduct` (`prisma/schema.prisma`).
 * Note: `workspaceId` and `storeDomain` do NOT exist as top-level columns on `ResearchProduct`.
 */
export interface PersistedResearchProductRow {
  id: string;
  storeId?: string | null;
  title?: string | null;
  category?: string | null;
  description?: string | null;
  imageUrl?: string | null;
  currentPrice?: unknown;
  currency?: string | null;
  productUrl?: string | null;
  createdAt?: Date | string | null;
  updatedAt?: Date | string | null;
  store?: {
    id?: string | null;
    domain?: string | null;
    workspaceId?: string | null;
    name?: string | null;
  } | null;
  evidence?: PersistedResearchEvidenceRow[] | null;
  landingPageSnapshots?: PersistedLandingPageSnapshotRow[] | null;
  offerSnapshots?: PersistedCompetitorOfferSnapshotRow[] | null;
}

/**
 * Exact Prisma model projection for `AdObservation` (`prisma/schema.prisma`).
 * Note: `provenance`, `sourceMode`, `sourceType`, `isCached`, `isLiveRecord` do NOT exist on `AdObservation`.
 */
export interface PersistedAdObservationRow {
  id: string;
  adId: string;
  observedAt?: Date | string | null;
  observationStatus?: string | null;
  isActive?: boolean | null;
  evidenceType?: string | null;
  verificationMethod?: string | null;
  evidenceReference?: string | null;
  sourceTimestamp?: Date | string | null;
  confidence?: number | null;
  rawPayload?: string | null;
}

/**
 * Exact Prisma model projection for `DiscoveryRunAd` (`prisma/schema.prisma`).
 */
export interface PersistedDiscoveryRunAdRow {
  id?: string | null;
  runId: string;
  adId: string;
  workspaceId: string;
  providerId: string;
  libraryId?: string | null;
  ingestOutcome: string;
  sourceUrl?: string | null;
  observedAt?: Date | string | null;
}

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
  verifiedAt?: Date | string | null;
  schemaVerified?: boolean;
  hasJsonLdProduct?: boolean;
  proofMethod?: MerchantProofMethod;
  validationStatus?: MerchantProofValidationStatus;
  rawSourcePayload?: string | null;
  rawSourceSha256?: string | null;
  sourceFieldUsed?: string | null;
  fetchOutcome?: string | null;
  resolutionSource?: string | null;
  merchantProductId?: string | null;
  sku?: string | null;
  gtin?: string | null;
  verifiedProductTitle?: string | null;
  offerPrice?: string | number | null;
  offerCurrency?: string | null;
  offerAvailability?: string | null;
  contentHash?: string | null;
  evidenceOrigin?: string | null;
  observationMethod?: string | null;
  classification?: string | null;
  isSyntheticOrFixture?: boolean;
  rejectionReasons?: string[];
}

export interface PersistedMerchantProofAuditEntry {
  recordId: string;
  sourceTable:
    | "ResearchEvidence"
    | "LandingPageSnapshot"
    | "CompetitorOfferSnapshot"
    | "ResearchProduct";
  workspaceId: string | null;
  productId: string | null;
  storeDomain: string | null;
  sourceUrl: string | null;
  observedAt: string | null;
  validationStatus: MerchantProofValidationStatus;
  proofMethod: MerchantProofMethod;
  schemaVerified: boolean;
  hasJsonLdProduct: boolean;
  rawSourceReconstructable: boolean;
  hashVerified: boolean;
  sourceFieldUsed: string | null;
  expectedHashRef: string | null;
  computedSha256: string | null;
  extractedProductName: string | null;
  extractedSku: string | null;
  extractedMerchantProductId: string | null;
  realColumnsInspected: string[];
  rejectionReasons: string[];
}

export interface ExtractPersistedMerchantProofsInput {
  workspaceId: string;
  candidateId?: string | null;
  researchProductId?: string | null;
  storeDomain?: string | null;
  canonicalProductUrl?: string | null;
  candidateTitle?: string | null;
  expectedSku?: string | null;
  expectedMerchantProductId?: string | null;
  asOf?: Date | string | null;
  maxStaleDays?: number;
  researchProducts?: PersistedResearchProductRow[] | null;
  standaloneEvidence?: PersistedResearchEvidenceRow[] | null;
  standaloneLandingSnapshots?: PersistedLandingPageSnapshotRow[] | null;
  standaloneOfferSnapshots?: PersistedCompetitorOfferSnapshotRow[] | null;
}

export interface ExtractedPersistedMerchantProofsResult {
  validProofs: PersistedMerchantProofRecord[];
  allAuditedRecords: PersistedMerchantProofAuditEntry[];
  summary: {
    totalInspected: number;
    validProofCount: number;
    byTable: Record<string, { inspected: number; valid: number; rejected: number }>;
    byValidationStatus: Record<string, number>;
  };
}

export interface HistoricalProductIdentityInput {
  candidateId?: string | null;
  researchProductId?: string | null;
  workspaceId?: string | null;
  title?: string | null;
  storeDomain?: string | null;
  canonicalProductUrl?: string | null;
  expectedSku?: string | null;
  expectedMerchantProductId?: string | null;
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
  proofValidationStatuses?: Record<string, MerchantProofValidationStatus>;
  proofMethods?: Record<string, MerchantProofMethod>;
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

const UNSAFE_EVIDENCE_METHODS = new Set([
  "MANUAL_ENTRY",
  "USER_OBSERVED",
  "AI_INFERRED",
  "MODEL_INFERRED",
  "HEURISTIC_GUESS",
  "SYNTHETIC",
  "TEST_FIXTURE",
]);

const SAFE_AUTOMATED_EVIDENCE_METHODS = new Set([
  "AUTOMATED_SCRAPE",
  "API_SYNC",
  "MERCHANT_PDP_JSON_LD",
  "SHOPIFY_PRODUCT_JSON",
  "VERIFIED_MERCHANT_API",
  "STOREFRONT_JSON_LD_FETCH",
]);

const UNSAFE_EVIDENCE_CLASSIFICATIONS = new Set([
  "INFERRED",
  "ESTIMATED",
  "SYNTHETIC",
  "TEST_FIXTURE",
  "MANUAL_NOTE",
  "UNVERIFIED_GUESS",
]);

const NON_PRODUCT_JSON_LD_TYPES = new Set([
  "organization",
  "corporation",
  "localbusiness",
  "store",
  "onlinebusiness",
  "website",
  "webpage",
  "collectionpage",
  "searchresultspage",
  "breadcrumblist",
  "itemlist",
  "article",
  "newsarticle",
  "blogposting",
  "faqpage",
  "person",
  "imageobject",
  "videoobject",
]);

const TITLE_STOPWORDS = new Set([
  "the",
  "and",
  "for",
  "with",
  "from",
  "that",
  "this",
  "your",
  "our",
  "new",
  "pro",
  "best",
  "official",
  "store",
  "shop",
  "buy",
  "sale",
  "free",
  "shipping",
  "pack",
  "set",
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

export function computeSha256Hex(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

export function extractSha256HexFromRef(ref: string | null | undefined): string | null {
  const clean = cleanNonBlank(ref);
  if (!clean) return null;
  const match = clean.match(/^(?:sha256:|content_sha256:|hash:)?([a-f0-9]{64})$/i);
  return match ? match[1].toLowerCase() : null;
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

export function extractRegistrableBrandRoot(host: string | null | undefined): string | null {
  const norm = normalizeMerchantHost(host);
  if (!norm || !norm.includes(".")) return null;
  const parts = norm.split(".");
  if (parts.length <= 2) return norm;
  return parts.slice(-2).join(".");
}

export function extractNormalizedProductHandle(rawUrl: string | null | undefined): string | null {
  const clean = cleanNonBlank(rawUrl);
  if (!clean) return null;
  try {
    const u = new URL(/^https?:\/\//i.test(clean) ? clean : `https://${clean}`);
    const match = u.pathname.toLowerCase().match(/\/products\/([a-z0-9_-]+)/i);
    if (match && match[1]) {
      const handle = match[1].toLowerCase().replace(/\/+$/, "");
      if (!["null", "undefined", "nan", "none", "placeholder"].includes(handle)) {
        return handle;
      }
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Shared funnel / CheckoutChamp detector used across G16 evaluation and historical backtest replay.
 */
export function isFunnelOrCheckoutChamp(
  storeDomain: string | null | undefined,
  canonicalUrl: string | null | undefined
): boolean {
  const dom = normalizeMerchantHost(storeDomain) || (storeDomain || "").toLowerCase().trim();
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

export interface ParsedProductSchemaValidationResult {
  valid: boolean;
  validationStatus: MerchantProofValidationStatus;
  proofMethod: MerchantProofMethod;
  schemaVerified: boolean;
  hasJsonLdProduct: boolean;
  rawSourceReconstructable: boolean;
  hashVerified: boolean;
  computedSha256: string | null;
  expectedSha256: string | null;
  productName: string | null;
  sku: string | null;
  gtin: string | null;
  merchantProductId: string | null;
  canonicalUrl: string | null;
  offerPrice: string | number | null;
  offerCurrency: string | null;
  offerAvailability: string | null;
  rejectionReasons: string[];
}

function normalizeSchemaTypes(rawType: unknown): string[] {
  if (typeof rawType === "string") {
    return [
      rawType
        .trim()
        .replace(/^https?:\/\/schema\.org\//i, "")
        .toLowerCase(),
    ];
  }
  if (Array.isArray(rawType)) {
    return rawType
      .filter((t) => typeof t === "string")
      .map((t) =>
        String(t)
          .trim()
          .replace(/^https?:\/\/schema\.org\//i, "")
          .toLowerCase()
      );
  }
  return [];
}

function collectJsonLdNodes(parsed: any): any[] {
  const nodes: any[] = [];
  const visit = (item: any) => {
    if (!item || typeof item !== "object") return;
    if (Array.isArray(item)) {
      for (const el of item) visit(el);
      return;
    }
    nodes.push(item);
    if (Array.isArray(item["@graph"])) {
      for (const g of item["@graph"]) visit(g);
    }
    if (item.mainEntity && typeof item.mainEntity === "object") {
      visit(item.mainEntity);
    }
  };
  visit(parsed);
  return nodes;
}

function extractOfferMetadata(offersRaw: any): {
  hasValidOffer: boolean;
  price: string | number | null;
  currency: string | null;
  availability: string | null;
  sku: string | null;
  url: string | null;
} {
  if (!offersRaw || typeof offersRaw !== "object") {
    return {
      hasValidOffer: false,
      price: null,
      currency: null,
      availability: null,
      sku: null,
      url: null,
    };
  }
  const offerList = Array.isArray(offersRaw) ? offersRaw : [offersRaw];
  for (const offer of offerList) {
    if (!offer || typeof offer !== "object") continue;
    const price =
      offer.price ??
      offer.lowPrice ??
      offer.highPrice ??
      offer.priceSpecification?.price ??
      null;
    const currency = cleanNonBlank(
      offer.priceCurrency ?? offer.priceSpecification?.priceCurrency
    );
    const availability = cleanNonBlank(offer.availability);
    const sku = cleanNonBlank(offer.sku ? String(offer.sku) : null);
    const url = cleanNonBlank(offer.url);
    const hasPrice =
      (typeof price === "number" && Number.isFinite(price) && price >= 0) ||
      (typeof price === "string" && price.trim().length > 0 && !Number.isNaN(Number(price.replace(/[^0-9.]/g, ""))));
    if (hasPrice || currency || availability || sku || url) {
      return {
        hasValidOffer: true,
        price: hasPrice ? price : null,
        currency,
        availability,
        sku,
        url,
      };
    }
  }
  return {
    hasValidOffer: false,
    price: null,
    currency: null,
    availability: null,
    sku: null,
    url: null,
  };
}

/**
 * Strictly parses and validates a raw persisted payload for `schema.org` `@type: "Product"` / `"ProductGroup"`
 * JSON-LD (or explicitly distinguished `SHOPIFY_PRODUCT_JSON` / `VERIFIED_MERCHANT_API`) and verifies its
 * SHA-256 content hash against `expectedHash`.
 */
export function parseAndValidateProductSchemaPayload(
  rawPayloadStr: string | null | undefined,
  options?: {
    expectedHash?: string | null;
    allowShopifyProductJson?: boolean;
    observationMethod?: string | null;
  }
): ParsedProductSchemaValidationResult {
  const rejectionReasons: string[] = [];
  const cleanRaw = cleanNonBlank(rawPayloadStr);

  if (!cleanRaw) {
    return {
      valid: false,
      validationStatus: "RAW_SOURCE_NOT_RECONSTRUCTABLE",
      proofMethod: "NONE",
      schemaVerified: false,
      hasJsonLdProduct: false,
      rawSourceReconstructable: false,
      hashVerified: false,
      computedSha256: null,
      expectedSha256: extractSha256HexFromRef(options?.expectedHash),
      productName: null,
      sku: null,
      gtin: null,
      merchantProductId: null,
      canonicalUrl: null,
      offerPrice: null,
      offerCurrency: null,
      offerAvailability: null,
      rejectionReasons: ["RAW_SOURCE_PAYLOAD_EMPTY_OR_MISSING"],
    };
  }

  if (SYNTHETIC_HASH_OR_ID_PATTERNS.test(cleanRaw)) {
    return {
      valid: false,
      validationStatus: "SYNTHETIC_OR_FIXTURE_REJECTED",
      proofMethod: "NONE",
      schemaVerified: false,
      hasJsonLdProduct: false,
      rawSourceReconstructable: true,
      hashVerified: false,
      computedSha256: computeSha256Hex(cleanRaw),
      expectedSha256: extractSha256HexHexSafe(options?.expectedHash),
      productName: null,
      sku: null,
      gtin: null,
      merchantProductId: null,
      canonicalUrl: null,
      offerPrice: null,
      offerCurrency: null,
      offerAvailability: null,
      rejectionReasons: ["SYNTHETIC_OR_FIXTURE_PATTERN_IN_RAW_PAYLOAD"],
    };
  }

  const outerSha256 = computeSha256Hex(cleanRaw);
  const expectedSha256 = extractSha256HexFromRef(options?.expectedHash);

  // Extract JSON candidate blocks from raw JSON or HTML <script type="application/ld+json">
  const jsonBlocks: string[] = [];
  const scriptRegex = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let match: RegExpExecArray | null;
  while ((match = scriptRegex.exec(cleanRaw)) !== null) {
    if (match[1] && match[1].trim()) {
      jsonBlocks.push(match[1].trim());
    }
  }
  if (jsonBlocks.length === 0) {
    jsonBlocks.push(cleanRaw);
  }

  let parsedObjects: any[] = [];
  let innerRawStrings: string[] = [];
  for (const block of jsonBlocks) {
    try {
      const obj = JSON.parse(block);
      parsedObjects.push(obj);
      innerRawStrings.push(block);
      // If envelope wraps `rawJsonLd`, `jsonLd`, or `productSchema`
      if (obj && typeof obj === "object" && !Array.isArray(obj)) {
        for (const key of ["rawJsonLd", "jsonLd", "productSchema", "schemaJsonLd"]) {
          const inner = obj[key];
          if (typeof inner === "string" && inner.trim()) {
            innerRawStrings.push(inner.trim());
            try {
              parsedObjects.push(JSON.parse(inner.trim()));
            } catch {
              // ignore malformed inner string
            }
          } else if (inner && typeof inner === "object") {
            parsedObjects.push(inner);
          }
        }
      }
    } catch {
      // Not valid JSON block
    }
  }

  if (parsedObjects.length === 0) {
    return {
      valid: false,
      validationStatus: "NO_PRODUCT_JSON_LD_IN_PAYLOAD",
      proofMethod: "NONE",
      schemaVerified: false,
      hasJsonLdProduct: false,
      rawSourceReconstructable: false,
      hashVerified: false,
      computedSha256: outerSha256,
      expectedSha256,
      productName: null,
      sku: null,
      gtin: null,
      merchantProductId: null,
      canonicalUrl: null,
      offerPrice: null,
      offerCurrency: null,
      offerAvailability: null,
      rejectionReasons: ["RAW_PAYLOAD_NOT_PARSEABLE_JSON_OR_JSON_LD"],
    };
  }

  // Verify SHA-256 hash before accepting any content
  if (!expectedSha256) {
    return {
      valid: false,
      validationStatus: "RAW_SOURCE_NOT_RECONSTRUCTABLE",
      proofMethod: "NONE",
      schemaVerified: false,
      hasJsonLdProduct: false,
      rawSourceReconstructable: true,
      hashVerified: false,
      computedSha256: outerSha256,
      expectedSha256: null,
      productName: null,
      sku: null,
      gtin: null,
      merchantProductId: null,
      canonicalUrl: null,
      offerPrice: null,
      offerCurrency: null,
      offerAvailability: null,
      rejectionReasons: ["MISSING_VALID_SHA256_CONTENT_HASH_REFERENCE"],
    };
  }

  const candidateHashes = new Set<string>([
    outerSha256,
    ...innerRawStrings.map((s) => computeSha256Hex(s)),
  ]);
  const hashVerified = candidateHashes.has(expectedSha256);
  if (!hashVerified) {
    return {
      valid: false,
      validationStatus: "RAW_SOURCE_HASH_TAMPERED",
      proofMethod: "NONE",
      schemaVerified: false,
      hasJsonLdProduct: false,
      rawSourceReconstructable: true,
      hashVerified: false,
      computedSha256: outerSha256,
      expectedSha256,
      productName: null,
      sku: null,
      gtin: null,
      merchantProductId: null,
      canonicalUrl: null,
      offerPrice: null,
      offerCurrency: null,
      offerAvailability: null,
      rejectionReasons: [
        `RAW_SOURCE_SHA256_MISMATCH: expected=${expectedSha256}, computed=${outerSha256}`,
      ],
    };
  }

  const allNodes = parsedObjects.flatMap((obj) => collectJsonLdNodes(obj));
  let sawNonProductSchemaType = false;
  let sawBareBooleanClaim = false;
  let sawCroStructureOnly = false;

  for (const node of allNodes) {
    if (!node || typeof node !== "object") continue;

    // Detect CRO-only `LandingPageStructure` JSON (`observationsJson`)
    if (
      ("headlineCount" in node || "ctaTexts" in node || "hasStickyATC" in node || "benefitBullets" in node) &&
      !("@type" in node)
    ) {
      sawCroStructureOnly = true;
    }

    // Detect bare boolean wrapper `{"schemaVerified": true}` or `{"hasJsonLdProduct": true}` without `@type`
    if (
      (node.schemaVerified === true || node.hasJsonLdProduct === true) &&
      !("@type" in node) &&
      !node.rawJsonLd &&
      !node.jsonLd &&
      !node.productSchema &&
      !node.shopifyProduct
    ) {
      sawBareBooleanClaim = true;
    }

    const types = normalizeSchemaTypes(node["@type"]);
    if (types.length > 0) {
      const isProduct = types.includes("product") || types.includes("productgroup");
      if (!isProduct) {
        if (types.some((t) => NON_PRODUCT_JSON_LD_TYPES.has(t))) {
          sawNonProductSchemaType = true;
        }
        continue;
      }

      // Validate `@type: "Product"` or `"ProductGroup"` node fields
      const productName = cleanNonBlank(node.name || node.title);
      const sku = cleanNonBlank(
        node.sku
          ? String(node.sku)
          : Array.isArray(node.hasVariant) && node.hasVariant[0]?.sku
          ? String(node.hasVariant[0].sku)
          : null
      );
      const gtin = cleanNonBlank(
        node.gtin || node.gtin13 || node.gtin12 || node.gtin14 || node.mpn
          ? String(node.gtin || node.gtin13 || node.gtin12 || node.gtin14 || node.mpn)
          : null
      );
      const merchantProductId = cleanNonBlank(
        node.productID || node.productId || node.id || node["@id"]
          ? String(node.productID || node.productId || node.id || node["@id"])
          : null
      );
      const offerInfo = extractOfferMetadata(
        node.offers ?? (Array.isArray(node.hasVariant) ? node.hasVariant[0]?.offers : null)
      );
      const canonicalUrl = cleanNonBlank(node.url || offerInfo.url || node["@id"]);

      const effectiveSku = sku || offerInfo.sku;
      const hasProductIdentifierOrOffer = Boolean(
        effectiveSku || gtin || merchantProductId || offerInfo.hasValidOffer
      );

      if (!productName) {
        rejectionReasons.push("JSON_LD_PRODUCT_MISSING_NAME");
        continue;
      }
      if (!hasProductIdentifierOrOffer) {
        rejectionReasons.push("JSON_LD_PRODUCT_MISSING_SKU_GTIN_ID_AND_OFFERS");
        continue;
      }

      return {
        valid: true,
        validationStatus: "CONTENT_VALIDATED_WITH_SOURCE",
        proofMethod: "JSON_LD_PRODUCT_SCHEMA",
        schemaVerified: true,
        hasJsonLdProduct: true,
        rawSourceReconstructable: true,
        hashVerified: true,
        computedSha256: outerSha256,
        expectedSha256,
        productName,
        sku: effectiveSku,
        gtin,
        merchantProductId,
        canonicalUrl,
        offerPrice: offerInfo.price,
        offerCurrency: offerInfo.currency,
        offerAvailability: offerInfo.availability,
        rejectionReasons: [],
      };
    }
  }

  // Check if explicitly allowed & structured Shopify product JSON / verified merchant API payload
  const obsMethodUpper = String(options?.observationMethod || "").toUpperCase();
  const allowShopify =
    options?.allowShopifyProductJson === true ||
    obsMethodUpper === "SHOPIFY_PRODUCT_JSON" ||
    obsMethodUpper === "VERIFIED_MERCHANT_API" ||
    obsMethodUpper === "API_SYNC";

  for (const obj of parsedObjects) {
    if (!obj || typeof obj !== "object" || Array.isArray(obj)) continue;
    const shopifyNode =
      obj.shopifyProduct && typeof obj.shopifyProduct === "object"
        ? obj.shopifyProduct
        : obj.product && typeof obj.product === "object"
        ? obj.product
        : obj;

    if (
      (allowShopify ||
        obj.proofMethod === "SHOPIFY_PRODUCT_JSON" ||
        obj.proofMethod === "VERIFIED_MERCHANT_API") &&
      shopifyNode &&
      typeof shopifyNode === "object" &&
      !Array.isArray(shopifyNode)
    ) {
      const prodId = cleanNonBlank(shopifyNode.id ? String(shopifyNode.id) : null);
      const title = cleanNonBlank(shopifyNode.title);
      const handle = cleanNonBlank(shopifyNode.handle);
      const variants = Array.isArray(shopifyNode.variants) ? shopifyNode.variants : [];
      const firstVariant = variants.length > 0 && typeof variants[0] === "object" ? variants[0] : null;
      const variantId = firstVariant?.id ? String(firstVariant.id) : null;
      const variantPrice = firstVariant?.price ?? null;
      const variantSku = cleanNonBlank(firstVariant?.sku ? String(firstVariant.sku) : null);

      if (prodId && title && handle && variants.length > 0 && (variantId || variantPrice !== null)) {
        const method: MerchantProofMethod =
          obsMethodUpper === "VERIFIED_MERCHANT_API" || obj.proofMethod === "VERIFIED_MERCHANT_API"
            ? "VERIFIED_MERCHANT_API"
            : "SHOPIFY_PRODUCT_JSON";
        return {
          valid: true,
          validationStatus: "CONTENT_VALIDATED_WITH_SOURCE",
          proofMethod: method,
          schemaVerified: true,
          hasJsonLdProduct: false, // Explicitly distinguished from JSON-LD product schema
          rawSourceReconstructable: true,
          hashVerified: true,
          computedSha256: outerSha256,
          expectedSha256,
          productName: title,
          sku: variantSku,
          gtin: cleanNonBlank(firstVariant?.barcode ? String(firstVariant.barcode) : null),
          merchantProductId: prodId,
          canonicalUrl: cleanNonBlank(shopifyNode.url || obj.canonicalUrl || obj.sourceUrl),
          offerPrice: variantPrice,
          offerCurrency: cleanNonBlank(shopifyNode.currency || obj.currency),
          offerAvailability:
            typeof firstVariant?.available === "boolean"
              ? firstVariant.available
                ? "InStock"
                : "OutOfStock"
              : null,
          rejectionReasons: [],
        };
      }
    }
  }

  if (sawNonProductSchemaType) {
    return {
      valid: false,
      validationStatus: "NON_PRODUCT_JSON_LD_TYPE",
      proofMethod: "NONE",
      schemaVerified: false,
      hasJsonLdProduct: false,
      rawSourceReconstructable: true,
      hashVerified: true,
      computedSha256: outerSha256,
      expectedSha256,
      productName: null,
      sku: null,
      gtin: null,
      merchantProductId: null,
      canonicalUrl: null,
      offerPrice: null,
      offerCurrency: null,
      offerAvailability: null,
      rejectionReasons: [
        "JSON_LD_TYPE_NOT_PRODUCT_OR_PRODUCTGROUP",
        ...rejectionReasons,
      ],
    };
  }

  if (sawBareBooleanClaim) {
    rejectionReasons.push("BARE_BOOLEAN_SCHEMA_CLAIM_WITHOUT_PRODUCT_JSON_LD_NODE");
  }
  if (sawCroStructureOnly) {
    rejectionReasons.push("LANDING_PAGE_CRO_OBSERVATIONS_JSON_LACKS_PRODUCT_SCHEMA");
  }
  if (rejectionReasons.length === 0) {
    rejectionReasons.push("NO_PARSEABLE_PRODUCT_JSON_LD_OR_SHOPIFY_PRODUCT_JSON_FOUND");
  }

  return {
    valid: false,
    validationStatus: "NO_PRODUCT_JSON_LD_IN_PAYLOAD",
    proofMethod: "NONE",
    schemaVerified: false,
    hasJsonLdProduct: false,
    rawSourceReconstructable: true,
    hashVerified: true,
    computedSha256: outerSha256,
    expectedSha256,
    productName: null,
    sku: null,
    gtin: null,
    merchantProductId: null,
    canonicalUrl: null,
    offerPrice: null,
    offerCurrency: null,
    offerAvailability: null,
    rejectionReasons,
  };
}

function extractSha256HexHexSafe(ref: string | null | undefined): string | null {
  return extractSha256HexFromRef(ref);
}

function significantTitleTokens(title: string | null | undefined): string[] {
  const clean = cleanNonBlank(title);
  if (!clean) return [];
  return clean
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((tok) => tok.length >= 3 && !TITLE_STOPWORDS.has(tok));
}

function doesProofAlignWithCandidateProduct(params: {
  candidateCanonicalUrl: string | null;
  candidateTitle: string | null;
  expectedSku: string | null;
  expectedMerchantProductId: string | null;
  proofUrl: string | null;
  proofProductName: string | null;
  proofSku: string | null;
  proofMerchantProductId: string | null;
}): { aligned: boolean; reason?: string } {
  // 1. Explicit SKU conflict check
  if (
    params.expectedSku &&
    params.proofSku &&
    params.expectedSku.toLowerCase() !== params.proofSku.toLowerCase()
  ) {
    return {
      aligned: false,
      reason: `SKU_MISMATCH: expected=${params.expectedSku}, proof=${params.proofSku}`,
    };
  }

  // 2. Explicit merchantProductId conflict check
  if (
    params.expectedMerchantProductId &&
    params.proofMerchantProductId &&
    params.expectedMerchantProductId.toLowerCase() !==
      params.proofMerchantProductId.toLowerCase()
  ) {
    return {
      aligned: false,
      reason: `MERCHANT_PRODUCT_ID_MISMATCH: expected=${params.expectedMerchantProductId}, proof=${params.proofMerchantProductId}`,
    };
  }

  // 3. `/products/<handle>` URL slug consistency check
  const candHandle = extractNormalizedProductHandle(params.candidateCanonicalUrl);
  const proofHandle = extractNormalizedProductHandle(params.proofUrl);
  if (candHandle && proofHandle && candHandle !== proofHandle) {
    return {
      aligned: false,
      reason: `PRODUCT_HANDLE_MISMATCH_ON_MERCHANT: candidate=${candHandle}, proof=${proofHandle}`,
    };
  }

  // 4. Title token overlap check when both candidateTitle and proofProductName are concrete
  const candTokens = significantTitleTokens(params.candidateTitle);
  const proofTokens = significantTitleTokens(params.proofProductName);
  if (candTokens.length >= 2 && proofTokens.length >= 2) {
    const proofSet = new Set(proofTokens);
    const shared = candTokens.filter((t) => proofSet.has(t));
    // If neither handle matched nor any significant token overlapped, reject as cross-product
    if (shared.length === 0) {
      return {
        aligned: false,
        reason: `PRODUCT_TITLE_ZERO_TOKEN_OVERLAP: candidate="${params.candidateTitle}", proof="${params.proofProductName}"`,
      };
    }
  }

  return { aligned: true };
}

function doesProofDomainMatchCandidate(params: {
  candidateDomain: string | null;
  candidateCanonicalUrl: string | null;
  proofDomain: string | null;
  proofUrl: string | null;
}): { matched: boolean; reason?: string } {
  const candDom = normalizeMerchantHost(params.candidateDomain || params.candidateCanonicalUrl);
  const proofDom = normalizeMerchantHost(params.proofDomain || params.proofUrl);
  if (!candDom || !proofDom) {
    return { matched: false, reason: "MISSING_CANDIDATE_OR_PROOF_MERCHANT_DOMAIN" };
  }
  if (NON_MERCHANT_PLATFORM_DOMAINS.has(proofDom)) {
    return { matched: false, reason: `NON_MERCHANT_PROOF_DOMAIN:${proofDom}` };
  }
  if (
    proofDom === candDom ||
    proofDom.endsWith(`.${candDom}`) ||
    candDom.endsWith(`.${proofDom}`)
  ) {
    return { matched: true };
  }
  return {
    matched: false,
    reason: `MERCHANT_DOMAIN_MISMATCH: candidate=${candDom}, proof=${proofDom}`,
  };
}

/**
 * Pure extractor that inspects persisted Prisma rows (`ResearchEvidence`, `LandingPageSnapshot`,
 * `CompetitorOfferSnapshot`, `ResearchProduct` with `store`) using ONLY real Prisma schema columns.
 *
 * Never uses imaginary columns (`ev.evidenceType`, `lp.productTitle`, `lp.canonicalUrl`, `lp.capturedAt`,
 * `os.offerUrl`, `os.priceText`, `os.priceAmount`, `os.capturedAt`, `prod.workspaceId`, `prod.storeDomain`).
 * Never infers `schemaVerified=true` or `hasJsonLdProduct=true` from `pageTitle + finalUrl + contentHash`.
 */
export function extractPersistedMerchantProofsFromDbRows(
  input: ExtractPersistedMerchantProofsInput
): ExtractedPersistedMerchantProofsResult {
  const expectedWorkspaceId = cleanNonBlank(input.workspaceId);
  const candidateDomain = normalizeMerchantHost(
    input.storeDomain || input.canonicalProductUrl
  );
  const candidateCanonicalUrl = cleanNonBlank(input.canonicalProductUrl);
  const candidateTitle = cleanNonBlank(input.candidateTitle);
  const expectedSku = cleanNonBlank(input.expectedSku);
  const expectedMerchantProductId = cleanNonBlank(input.expectedMerchantProductId);
  const asOfDate = input.asOf ? parseValidDate(input.asOf) : null;
  const maxStaleMs =
    typeof input.maxStaleDays === "number" && input.maxStaleDays > 0
      ? input.maxStaleDays * 86_400_000
      : null;

  const validProofs: PersistedMerchantProofRecord[] = [];
  const allAuditedRecords: PersistedMerchantProofAuditEntry[] = [];

  const byTable: Record<string, { inspected: number; valid: number; rejected: number }> = {
    ResearchEvidence: { inspected: 0, valid: 0, rejected: 0 },
    LandingPageSnapshot: { inspected: 0, valid: 0, rejected: 0 },
    CompetitorOfferSnapshot: { inspected: 0, valid: 0, rejected: 0 },
    ResearchProduct: { inspected: 0, valid: 0, rejected: 0 },
  };
  const byValidationStatus: Record<string, number> = {};

  const recordAudit = (entry: PersistedMerchantProofAuditEntry) => {
    allAuditedRecords.push(entry);
    const tbl = byTable[entry.sourceTable];
    if (tbl) {
      tbl.inspected += 1;
      if (entry.validationStatus === "CONTENT_VALIDATED_WITH_SOURCE") {
        tbl.valid += 1;
      } else {
        tbl.rejected += 1;
      }
    }
    byValidationStatus[entry.validationStatus] =
      (byValidationStatus[entry.validationStatus] || 0) + 1;
  };

  // Deduplicate rows by table + id
  const seenEvidenceIds = new Set<string>();
  const seenLandingIds = new Set<string>();
  const seenOfferIds = new Set<string>();
  const seenProductIds = new Set<string>();

  const evidenceRows: Array<{
    row: PersistedResearchEvidenceRow;
    productDomain: string | null;
    productId: string | null;
  }> = [];
  const landingRows: Array<{
    row: PersistedLandingPageSnapshotRow;
    productDomain: string | null;
    productId: string | null;
  }> = [];
  const offerRows: Array<{
    row: PersistedCompetitorOfferSnapshotRow;
    productDomain: string | null;
    productId: string | null;
  }> = [];

  const products = Array.isArray(input.researchProducts) ? input.researchProducts : [];
  for (const prod of products) {
    if (!prod || typeof prod !== "object" || !cleanNonBlank(prod.id)) continue;
    if (seenProductIds.has(prod.id)) continue;
    seenProductIds.add(prod.id);

    // Resolve domain strictly from `prod.store?.domain` or `prod.productUrl` (never `prod.storeDomain`)
    const prodDomain = normalizeMerchantHost(prod.store?.domain || prod.productUrl);

    // Audit the ResearchProduct row itself: a ResearchProduct row with `/products/...` is discovery only (M03)
    recordAudit({
      recordId: prod.id,
      sourceTable: "ResearchProduct",
      workspaceId: cleanNonBlank(prod.store?.workspaceId),
      productId: prod.id,
      storeDomain: prodDomain,
      sourceUrl: cleanNonBlank(prod.productUrl),
      observedAt: parseValidDate(prod.createdAt)?.toISOString() || null,
      validationStatus: "PRODUCT_ROW_DISCOVERY_ONLY",
      proofMethod: "NONE",
      schemaVerified: false,
      hasJsonLdProduct: false,
      rawSourceReconstructable: false,
      hashVerified: false,
      sourceFieldUsed: "productUrl",
      expectedHashRef: null,
      computedSha256: null,
      extractedProductName: cleanNonBlank(prod.title),
      extractedSku: null,
      extractedMerchantProductId: null,
      realColumnsInspected: [
        "id",
        "storeId",
        "title",
        "productUrl",
        "currentPrice",
        "currency",
        "createdAt",
        "updatedAt",
        "store.domain",
      ],
      rejectionReasons: [
        "RESEARCH_PRODUCT_ROW_AND_URL_PATH_ARE_DISCOVERY_SIGNALS_ONLY_NOT_SCHEMA_PROOF",
      ],
    });

    if (Array.isArray(prod.evidence)) {
      for (const ev of prod.evidence) {
        if (ev && cleanNonBlank(ev.id) && !seenEvidenceIds.has(ev.id)) {
          seenEvidenceIds.add(ev.id);
          evidenceRows.push({ row: ev, productDomain: prodDomain, productId: prod.id });
        }
      }
    }
    if (Array.isArray(prod.landingPageSnapshots)) {
      for (const lp of prod.landingPageSnapshots) {
        if (lp && cleanNonBlank(lp.id) && !seenLandingIds.has(lp.id)) {
          seenLandingIds.add(lp.id);
          landingRows.push({ row: lp, productDomain: prodDomain, productId: prod.id });
        }
      }
    }
    if (Array.isArray(prod.offerSnapshots)) {
      for (const os of prod.offerSnapshots) {
        if (os && cleanNonBlank(os.id) && !seenOfferIds.has(os.id)) {
          seenOfferIds.add(os.id);
          offerRows.push({ row: os, productDomain: prodDomain, productId: prod.id });
        }
      }
    }
  }

  if (Array.isArray(input.standaloneEvidence)) {
    for (const ev of input.standaloneEvidence) {
      if (ev && cleanNonBlank(ev.id) && !seenEvidenceIds.has(ev.id)) {
        seenEvidenceIds.add(ev.id);
        evidenceRows.push({
          row: ev,
          productDomain: candidateDomain,
          productId: cleanNonBlank(ev.productId || input.researchProductId),
        });
      }
    }
  }
  if (Array.isArray(input.standaloneLandingSnapshots)) {
    for (const lp of input.standaloneLandingSnapshots) {
      if (lp && cleanNonBlank(lp.id) && !seenLandingIds.has(lp.id)) {
        seenLandingIds.add(lp.id);
        landingRows.push({
          row: lp,
          productDomain: candidateDomain,
          productId: cleanNonBlank(lp.productId || input.researchProductId),
        });
      }
    }
  }
  if (Array.isArray(input.standaloneOfferSnapshots)) {
    for (const os of input.standaloneOfferSnapshots) {
      if (os && cleanNonBlank(os.id) && !seenOfferIds.has(os.id)) {
        seenOfferIds.add(os.id);
        offerRows.push({
          row: os,
          productDomain: candidateDomain,
          productId: cleanNonBlank(os.productId || input.researchProductId),
        });
      }
    }
  }

  // 1. Inspect `ResearchEvidence` rows using exact Prisma columns
  for (const { row: ev, productDomain, productId } of evidenceRows) {
    const realColumnsInspected = [
      "id",
      "workspaceId",
      "subjectType",
      "subjectId",
      "pillar",
      "claim",
      "observedValue",
      "sourceUrl",
      "observationMethod",
      "classification",
      "sourceContentRef",
      "observedAt",
      "verifiedAt",
      "productId",
    ];
    const rowWorkspaceId = cleanNonBlank(ev.workspaceId);
    const evSourceUrl = cleanNonBlank(ev.sourceUrl);
    const evDomain = normalizeMerchantHost(evSourceUrl || productDomain);
    const obsDate = parseValidDate(ev.observedAt);
    const verDate = ev.verifiedAt ? parseValidDate(ev.verifiedAt) : null;

    // Synthetic / fixture check (M14)
    const obsMethodUpper = String(ev.observationMethod || "").trim().toUpperCase();
    const classUpper = String(ev.classification || "").trim().toUpperCase();
    if (
      SYNTHETIC_HASH_OR_ID_PATTERNS.test(String(ev.id || "")) ||
      SYNTHETIC_HASH_OR_ID_PATTERNS.test(String(ev.sourceContentRef || "")) ||
      SYNTHETIC_HASH_OR_ID_PATTERNS.test(String(ev.observedValue || "")) ||
      SYNTHETIC_PROVENANCE_VALUES.has(obsMethodUpper) ||
      SYNTHETIC_PROVENANCE_VALUES.has(classUpper)
    ) {
      recordAudit({
        recordId: ev.id,
        sourceTable: "ResearchEvidence",
        workspaceId: rowWorkspaceId,
        productId: cleanNonBlank(ev.productId || productId),
        storeDomain: evDomain,
        sourceUrl: evSourceUrl,
        observedAt: obsDate?.toISOString() || null,
        validationStatus: "SYNTHETIC_OR_FIXTURE_REJECTED",
        proofMethod: "NONE",
        schemaVerified: false,
        hasJsonLdProduct: false,
        rawSourceReconstructable: false,
        hashVerified: false,
        sourceFieldUsed: "observedValue",
        expectedHashRef: cleanNonBlank(ev.sourceContentRef),
        computedSha256: null,
        extractedProductName: null,
        extractedSku: null,
        extractedMerchantProductId: null,
        realColumnsInspected,
        rejectionReasons: ["SYNTHETIC_OR_TEST_FIXTURE_EVIDENCE_ROW"],
      });
      continue;
    }

    // Workspace isolation check (M13): never default to candidate workspaceId
    if (!rowWorkspaceId || (expectedWorkspaceId && rowWorkspaceId !== expectedWorkspaceId)) {
      recordAudit({
        recordId: ev.id,
        sourceTable: "ResearchEvidence",
        workspaceId: rowWorkspaceId,
        productId: cleanNonBlank(ev.productId || productId),
        storeDomain: evDomain,
        sourceUrl: evSourceUrl,
        observedAt: obsDate?.toISOString() || null,
        validationStatus: "CROSS_WORKSPACE_REJECTED",
        proofMethod: "NONE",
        schemaVerified: false,
        hasJsonLdProduct: false,
        rawSourceReconstructable: false,
        hashVerified: false,
        sourceFieldUsed: "observedValue",
        expectedHashRef: cleanNonBlank(ev.sourceContentRef),
        computedSha256: null,
        extractedProductName: null,
        extractedSku: null,
        extractedMerchantProductId: null,
        realColumnsInspected,
        rejectionReasons: [
          !rowWorkspaceId
            ? "MISSING_ROW_WORKSPACE_ID"
            : `CROSS_WORKSPACE_MISMATCH: row=${rowWorkspaceId}, expected=${expectedWorkspaceId}`,
        ],
      });
      continue;
    }

    // Observation method & classification check (M09)
    if (
      !obsMethodUpper ||
      UNSAFE_EVIDENCE_METHODS.has(obsMethodUpper) ||
      !SAFE_AUTOMATED_EVIDENCE_METHODS.has(obsMethodUpper) ||
      UNSAFE_EVIDENCE_CLASSIFICATIONS.has(classUpper)
    ) {
      recordAudit({
        recordId: ev.id,
        sourceTable: "ResearchEvidence",
        workspaceId: rowWorkspaceId,
        productId: cleanNonBlank(ev.productId || productId),
        storeDomain: evDomain,
        sourceUrl: evSourceUrl,
        observedAt: obsDate?.toISOString() || null,
        validationStatus: "UNSAFE_OBSERVATION_METHOD_OR_CLASSIFICATION",
        proofMethod: "NONE",
        schemaVerified: false,
        hasJsonLdProduct: false,
        rawSourceReconstructable: false,
        hashVerified: false,
        sourceFieldUsed: "observedValue",
        expectedHashRef: cleanNonBlank(ev.sourceContentRef),
        computedSha256: null,
        extractedProductName: null,
        extractedSku: null,
        extractedMerchantProductId: null,
        realColumnsInspected,
        rejectionReasons: [
          `UNSAFE_OBSERVATION_METHOD_OR_CLASSIFICATION: method=${obsMethodUpper || "<empty>"}, classification=${classUpper || "<empty>"}`,
        ],
      });
      continue;
    }

    // Temporal validity check (M12, M15)
    if (
      !obsDate ||
      (ev.verifiedAt !== undefined && ev.verifiedAt !== null && !verDate) ||
      (asOfDate && obsDate.getTime() > asOfDate.getTime()) ||
      (asOfDate && verDate && verDate.getTime() > asOfDate.getTime()) ||
      (asOfDate && maxStaleMs !== null && asOfDate.getTime() - obsDate.getTime() > maxStaleMs)
    ) {
      recordAudit({
        recordId: ev.id,
        sourceTable: "ResearchEvidence",
        workspaceId: rowWorkspaceId,
        productId: cleanNonBlank(ev.productId || productId),
        storeDomain: evDomain,
        sourceUrl: evSourceUrl,
        observedAt: obsDate?.toISOString() || null,
        validationStatus: "POST_CUTOFF_OR_INVALID_DATE",
        proofMethod: "NONE",
        schemaVerified: false,
        hasJsonLdProduct: false,
        rawSourceReconstructable: false,
        hashVerified: false,
        sourceFieldUsed: "observedValue",
        expectedHashRef: cleanNonBlank(ev.sourceContentRef),
        computedSha256: null,
        extractedProductName: null,
        extractedSku: null,
        extractedMerchantProductId: null,
        realColumnsInspected,
        rejectionReasons: [
          !obsDate
            ? "INVALID_OR_MISSING_OBSERVED_AT"
            : asOfDate && obsDate.getTime() > asOfDate.getTime()
            ? "OBSERVED_AT_EXCEEDS_ASOF_CUTOFF"
            : asOfDate && verDate && verDate.getTime() > asOfDate.getTime()
            ? "VERIFIED_AT_EXCEEDS_ASOF_CUTOFF"
            : "STALE_OR_INVALID_TIMESTAMP",
        ],
      });
      continue;
    }

    // Parse & validate raw schema payload + SHA-256 hash
    const schemaCheck = parseAndValidateProductSchemaPayload(ev.observedValue, {
      expectedHash: ev.sourceContentRef,
      observationMethod: ev.observationMethod,
    });

    if (!schemaCheck.valid) {
      recordAudit({
        recordId: ev.id,
        sourceTable: "ResearchEvidence",
        workspaceId: rowWorkspaceId,
        productId: cleanNonBlank(ev.productId || productId),
        storeDomain: evDomain,
        sourceUrl: evSourceUrl,
        observedAt: obsDate.toISOString(),
        validationStatus: schemaCheck.validationStatus,
        proofMethod: schemaCheck.proofMethod,
        schemaVerified: false,
        hasJsonLdProduct: false,
        rawSourceReconstructable: schemaCheck.rawSourceReconstructable,
        hashVerified: schemaCheck.hashVerified,
        sourceFieldUsed: "observedValue",
        expectedHashRef: cleanNonBlank(ev.sourceContentRef),
        computedSha256: schemaCheck.computedSha256,
        extractedProductName: schemaCheck.productName,
        extractedSku: schemaCheck.sku,
        extractedMerchantProductId: schemaCheck.merchantProductId,
        realColumnsInspected,
        rejectionReasons: schemaCheck.rejectionReasons,
      });
      continue;
    }

    const effectiveProofUrl = evSourceUrl || schemaCheck.canonicalUrl;
    const effectiveProofDomain = normalizeMerchantHost(effectiveProofUrl || evDomain);

    // Domain match check (M11)
    if (candidateDomain) {
      const domMatch = doesProofDomainMatchCandidate({
        candidateDomain,
        candidateCanonicalUrl,
        proofDomain: effectiveProofDomain,
        proofUrl: effectiveProofUrl,
      });
      if (!domMatch.matched) {
        recordAudit({
          recordId: ev.id,
          sourceTable: "ResearchEvidence",
          workspaceId: rowWorkspaceId,
          productId: cleanNonBlank(ev.productId || productId),
          storeDomain: effectiveProofDomain,
          sourceUrl: effectiveProofUrl,
          observedAt: obsDate.toISOString(),
          validationStatus: "DOMAIN_MISMATCH_REJECTED",
          proofMethod: schemaCheck.proofMethod,
          schemaVerified: false,
          hasJsonLdProduct: false,
          rawSourceReconstructable: true,
          hashVerified: true,
          sourceFieldUsed: "observedValue",
          expectedHashRef: cleanNonBlank(ev.sourceContentRef),
          computedSha256: schemaCheck.computedSha256,
          extractedProductName: schemaCheck.productName,
          extractedSku: schemaCheck.sku,
          extractedMerchantProductId: schemaCheck.merchantProductId,
          realColumnsInspected,
          rejectionReasons: [domMatch.reason || "DOMAIN_MISMATCH"],
        });
        continue;
      }
    }

    // Product / handle / SKU alignment check (M10)
    const prodAlign = doesProofAlignWithCandidateProduct({
      candidateCanonicalUrl,
      candidateTitle,
      expectedSku,
      expectedMerchantProductId,
      proofUrl: effectiveProofUrl,
      proofProductName: schemaCheck.productName,
      proofSku: schemaCheck.sku,
      proofMerchantProductId: schemaCheck.merchantProductId,
    });
    if (!prodAlign.aligned) {
      recordAudit({
        recordId: ev.id,
        sourceTable: "ResearchEvidence",
        workspaceId: rowWorkspaceId,
        productId: cleanNonBlank(ev.productId || productId),
        storeDomain: effectiveProofDomain,
        sourceUrl: effectiveProofUrl,
        observedAt: obsDate.toISOString(),
        validationStatus: "PRODUCT_OR_SKU_MISMATCH_REJECTED",
        proofMethod: schemaCheck.proofMethod,
        schemaVerified: false,
        hasJsonLdProduct: false,
        rawSourceReconstructable: true,
        hashVerified: true,
        sourceFieldUsed: "observedValue",
        expectedHashRef: cleanNonBlank(ev.sourceContentRef),
        computedSha256: schemaCheck.computedSha256,
        extractedProductName: schemaCheck.productName,
        extractedSku: schemaCheck.sku,
        extractedMerchantProductId: schemaCheck.merchantProductId,
        realColumnsInspected,
        rejectionReasons: [prodAlign.reason || "PRODUCT_OR_SKU_MISMATCH"],
      });
      continue;
    }

    recordAudit({
      recordId: ev.id,
      sourceTable: "ResearchEvidence",
      workspaceId: rowWorkspaceId,
      productId: cleanNonBlank(ev.productId || productId),
      storeDomain: effectiveProofDomain,
      sourceUrl: effectiveProofUrl,
      observedAt: obsDate.toISOString(),
      validationStatus: "CONTENT_VALIDATED_WITH_SOURCE",
      proofMethod: schemaCheck.proofMethod,
      schemaVerified: true,
      hasJsonLdProduct: schemaCheck.hasJsonLdProduct,
      rawSourceReconstructable: true,
      hashVerified: true,
      sourceFieldUsed: "observedValue",
      expectedHashRef: cleanNonBlank(ev.sourceContentRef),
      computedSha256: schemaCheck.computedSha256,
      extractedProductName: schemaCheck.productName,
      extractedSku: schemaCheck.sku,
      extractedMerchantProductId: schemaCheck.merchantProductId,
      realColumnsInspected,
      rejectionReasons: [],
    });

    validProofs.push({
      id: ev.id,
      sourceTable: "ResearchEvidence",
      workspaceId: rowWorkspaceId,
      candidateId: cleanNonBlank(input.candidateId),
      researchProductId: cleanNonBlank(ev.productId || productId),
      storeDomain: effectiveProofDomain,
      canonicalUrl: effectiveProofUrl,
      observedAt: obsDate.toISOString(),
      verifiedAt: verDate?.toISOString() || null,
      schemaVerified: true,
      hasJsonLdProduct: schemaCheck.hasJsonLdProduct,
      proofMethod: schemaCheck.proofMethod,
      validationStatus: "CONTENT_VALIDATED_WITH_SOURCE",
      rawSourcePayload: ev.observedValue,
      rawSourceSha256: schemaCheck.expectedSha256,
      sourceFieldUsed: "ResearchEvidence.observedValue",
      fetchOutcome: "FETCH_SUCCEEDED",
      resolutionSource: schemaCheck.proofMethod,
      merchantProductId: schemaCheck.merchantProductId,
      sku: schemaCheck.sku,
      gtin: schemaCheck.gtin,
      verifiedProductTitle: schemaCheck.productName,
      offerPrice: schemaCheck.offerPrice,
      offerCurrency: schemaCheck.offerCurrency,
      offerAvailability: schemaCheck.offerAvailability,
      contentHash: cleanNonBlank(ev.sourceContentRef),
      evidenceOrigin: obsMethodUpper,
      observationMethod: obsMethodUpper,
      classification: classUpper || "VERIFIED",
      isSyntheticOrFixture: false,
      rejectionReasons: [],
    });
  }

  // 2. Inspect `LandingPageSnapshot` rows using exact Prisma columns
  for (const { row: lp, productDomain, productId } of landingRows) {
    const realColumnsInspected = [
      "id",
      "workspaceId",
      "productId",
      "storeId",
      "adId",
      "originalUrl",
      "finalUrl",
      "httpStatus",
      "accessStatus",
      "pageTitle",
      "metaDescription",
      "contentHash",
      "observationsJson",
      "croSignalsJson",
      "messageMatchJson",
      "warningsJson",
      "analysisVersion",
      "observedAt",
    ];
    const rowWorkspaceId = cleanNonBlank(lp.workspaceId);
    const lpUrl = cleanNonBlank(lp.finalUrl || lp.originalUrl);
    const lpDomain = normalizeMerchantHost(lpUrl || productDomain);
    const obsDate = parseValidDate(lp.observedAt);

    // Synthetic / fixture check (M14)
    if (
      SYNTHETIC_HASH_OR_ID_PATTERNS.test(String(lp.id || "")) ||
      SYNTHETIC_HASH_OR_ID_PATTERNS.test(String(lp.contentHash || "")) ||
      SYNTHETIC_HASH_OR_ID_PATTERNS.test(String(lp.pageTitle || "")) ||
      SYNTHETIC_HASH_OR_ID_PATTERNS.test(String(lp.observationsJson || ""))
    ) {
      recordAudit({
        recordId: lp.id,
        sourceTable: "LandingPageSnapshot",
        workspaceId: rowWorkspaceId,
        productId: cleanNonBlank(lp.productId || productId),
        storeDomain: lpDomain,
        sourceUrl: lpUrl,
        observedAt: obsDate?.toISOString() || null,
        validationStatus: "SYNTHETIC_OR_FIXTURE_REJECTED",
        proofMethod: "NONE",
        schemaVerified: false,
        hasJsonLdProduct: false,
        rawSourceReconstructable: false,
        hashVerified: false,
        sourceFieldUsed: "observationsJson",
        expectedHashRef: cleanNonBlank(lp.contentHash),
        computedSha256: null,
        extractedProductName: null,
        extractedSku: null,
        extractedMerchantProductId: null,
        realColumnsInspected,
        rejectionReasons: ["SYNTHETIC_OR_TEST_FIXTURE_LANDING_SNAPSHOT_ROW"],
      });
      continue;
    }

    // Workspace isolation check (M13)
    if (!rowWorkspaceId || (expectedWorkspaceId && rowWorkspaceId !== expectedWorkspaceId)) {
      recordAudit({
        recordId: lp.id,
        sourceTable: "LandingPageSnapshot",
        workspaceId: rowWorkspaceId,
        productId: cleanNonBlank(lp.productId || productId),
        storeDomain: lpDomain,
        sourceUrl: lpUrl,
        observedAt: obsDate?.toISOString() || null,
        validationStatus: "CROSS_WORKSPACE_REJECTED",
        proofMethod: "NONE",
        schemaVerified: false,
        hasJsonLdProduct: false,
        rawSourceReconstructable: false,
        hashVerified: false,
        sourceFieldUsed: "observationsJson",
        expectedHashRef: cleanNonBlank(lp.contentHash),
        computedSha256: null,
        extractedProductName: null,
        extractedSku: null,
        extractedMerchantProductId: null,
        realColumnsInspected,
        rejectionReasons: [
          !rowWorkspaceId
            ? "MISSING_ROW_WORKSPACE_ID"
            : `CROSS_WORKSPACE_MISMATCH: row=${rowWorkspaceId}, expected=${expectedWorkspaceId}`,
        ],
      });
      continue;
    }

    // HTTP status / accessStatus check (M08)
    const accessUpper = String(lp.accessStatus || "").trim().toUpperCase();
    if (
      (typeof lp.httpStatus === "number" && (lp.httpStatus < 200 || lp.httpStatus >= 300)) ||
      accessUpper === "BLOCKED" ||
      accessUpper === "CHALLENGE" ||
      accessUpper === "ERROR" ||
      accessUpper === "FORBIDDEN" ||
      accessUpper === "NOT_FOUND"
    ) {
      recordAudit({
        recordId: lp.id,
        sourceTable: "LandingPageSnapshot",
        workspaceId: rowWorkspaceId,
        productId: cleanNonBlank(lp.productId || productId),
        storeDomain: lpDomain,
        sourceUrl: lpUrl,
        observedAt: obsDate?.toISOString() || null,
        validationStatus: "HTTP_OR_ACCESS_BLOCKED",
        proofMethod: "NONE",
        schemaVerified: false,
        hasJsonLdProduct: false,
        rawSourceReconstructable: false,
        hashVerified: false,
        sourceFieldUsed: "observationsJson",
        expectedHashRef: cleanNonBlank(lp.contentHash),
        computedSha256: null,
        extractedProductName: null,
        extractedSku: null,
        extractedMerchantProductId: null,
        realColumnsInspected,
        rejectionReasons: [
          `HTTP_OR_ACCESS_BLOCKED: httpStatus=${lp.httpStatus ?? "null"}, accessStatus=${accessUpper || "<empty>"}`,
        ],
      });
      continue;
    }

    // Temporal validity check (M12, M15)
    if (
      !obsDate ||
      (asOfDate && obsDate.getTime() > asOfDate.getTime()) ||
      (asOfDate && maxStaleMs !== null && asOfDate.getTime() - obsDate.getTime() > maxStaleMs)
    ) {
      recordAudit({
        recordId: lp.id,
        sourceTable: "LandingPageSnapshot",
        workspaceId: rowWorkspaceId,
        productId: cleanNonBlank(lp.productId || productId),
        storeDomain: lpDomain,
        sourceUrl: lpUrl,
        observedAt: obsDate?.toISOString() || null,
        validationStatus: "POST_CUTOFF_OR_INVALID_DATE",
        proofMethod: "NONE",
        schemaVerified: false,
        hasJsonLdProduct: false,
        rawSourceReconstructable: false,
        hashVerified: false,
        sourceFieldUsed: "observationsJson",
        expectedHashRef: cleanNonBlank(lp.contentHash),
        computedSha256: null,
        extractedProductName: null,
        extractedSku: null,
        extractedMerchantProductId: null,
        realColumnsInspected,
        rejectionReasons: [
          !obsDate
            ? "INVALID_OR_MISSING_OBSERVED_AT"
            : asOfDate && obsDate.getTime() > asOfDate.getTime()
            ? "OBSERVED_AT_EXCEEDS_ASOF_CUTOFF"
            : "STALE_TIMESTAMP",
        ],
      });
      continue;
    }

    // Parse & validate `observationsJson` against `contentHash` (M01, M02, M06, M07, M16, M17)
    // Note: `pageTitle + finalUrl + contentHash` alone WITHOUT parseable Product JSON-LD in `observationsJson`
    // is NEVER accepted as `schemaVerified` or `hasJsonLdProduct`!
    const schemaCheck = parseAndValidateProductSchemaPayload(lp.observationsJson, {
      expectedHash: lp.contentHash,
      allowShopifyProductJson: false,
    });

    if (!schemaCheck.valid) {
      recordAudit({
        recordId: lp.id,
        sourceTable: "LandingPageSnapshot",
        workspaceId: rowWorkspaceId,
        productId: cleanNonBlank(lp.productId || productId),
        storeDomain: lpDomain,
        sourceUrl: lpUrl,
        observedAt: obsDate.toISOString(),
        validationStatus: schemaCheck.validationStatus,
        proofMethod: schemaCheck.proofMethod,
        schemaVerified: false,
        hasJsonLdProduct: false,
        rawSourceReconstructable: schemaCheck.rawSourceReconstructable,
        hashVerified: schemaCheck.hashVerified,
        sourceFieldUsed: "observationsJson",
        expectedHashRef: cleanNonBlank(lp.contentHash),
        computedSha256: schemaCheck.computedSha256,
        extractedProductName: schemaCheck.productName,
        extractedSku: schemaCheck.sku,
        extractedMerchantProductId: schemaCheck.merchantProductId,
        realColumnsInspected,
        rejectionReasons: schemaCheck.rejectionReasons,
      });
      continue;
    }

    const effectiveProofUrl = lpUrl || schemaCheck.canonicalUrl;
    const effectiveProofDomain = normalizeMerchantHost(effectiveProofUrl || lpDomain);

    // Domain match check (M11)
    if (candidateDomain) {
      const domMatch = doesProofDomainMatchCandidate({
        candidateDomain,
        candidateCanonicalUrl,
        proofDomain: effectiveProofDomain,
        proofUrl: effectiveProofUrl,
      });
      if (!domMatch.matched) {
        recordAudit({
          recordId: lp.id,
          sourceTable: "LandingPageSnapshot",
          workspaceId: rowWorkspaceId,
          productId: cleanNonBlank(lp.productId || productId),
          storeDomain: effectiveProofDomain,
          sourceUrl: effectiveProofUrl,
          observedAt: obsDate.toISOString(),
          validationStatus: "DOMAIN_MISMATCH_REJECTED",
          proofMethod: schemaCheck.proofMethod,
          schemaVerified: false,
          hasJsonLdProduct: false,
          rawSourceReconstructable: true,
          hashVerified: true,
          sourceFieldUsed: "observationsJson",
          expectedHashRef: cleanNonBlank(lp.contentHash),
          computedSha256: schemaCheck.computedSha256,
          extractedProductName: schemaCheck.productName,
          extractedSku: schemaCheck.sku,
          extractedMerchantProductId: schemaCheck.merchantProductId,
          realColumnsInspected,
          rejectionReasons: [domMatch.reason || "DOMAIN_MISMATCH"],
        });
        continue;
      }
    }

    // Product / handle / SKU alignment check (M10)
    const prodAlign = doesProofAlignWithCandidateProduct({
      candidateCanonicalUrl,
      candidateTitle,
      expectedSku,
      expectedMerchantProductId,
      proofUrl: effectiveProofUrl,
      proofProductName: schemaCheck.productName,
      proofSku: schemaCheck.sku,
      proofMerchantProductId: schemaCheck.merchantProductId,
    });
    if (!prodAlign.aligned) {
      recordAudit({
        recordId: lp.id,
        sourceTable: "LandingPageSnapshot",
        workspaceId: rowWorkspaceId,
        productId: cleanNonBlank(lp.productId || productId),
        storeDomain: effectiveProofDomain,
        sourceUrl: effectiveProofUrl,
        observedAt: obsDate.toISOString(),
        validationStatus: "PRODUCT_OR_SKU_MISMATCH_REJECTED",
        proofMethod: schemaCheck.proofMethod,
        schemaVerified: false,
        hasJsonLdProduct: false,
        rawSourceReconstructable: true,
        hashVerified: true,
        sourceFieldUsed: "observationsJson",
        expectedHashRef: cleanNonBlank(lp.contentHash),
        computedSha256: schemaCheck.computedSha256,
        extractedProductName: schemaCheck.productName,
        extractedSku: schemaCheck.sku,
        extractedMerchantProductId: schemaCheck.merchantProductId,
        realColumnsInspected,
        rejectionReasons: [prodAlign.reason || "PRODUCT_OR_SKU_MISMATCH"],
      });
      continue;
    }

    recordAudit({
      recordId: lp.id,
      sourceTable: "LandingPageSnapshot",
      workspaceId: rowWorkspaceId,
      productId: cleanNonBlank(lp.productId || productId),
      storeDomain: effectiveProofDomain,
      sourceUrl: effectiveProofUrl,
      observedAt: obsDate.toISOString(),
      validationStatus: "CONTENT_VALIDATED_WITH_SOURCE",
      proofMethod: schemaCheck.proofMethod,
      schemaVerified: true,
      hasJsonLdProduct: schemaCheck.hasJsonLdProduct,
      rawSourceReconstructable: true,
      hashVerified: true,
      sourceFieldUsed: "observationsJson",
      expectedHashRef: cleanNonBlank(lp.contentHash),
      computedSha256: schemaCheck.computedSha256,
      extractedProductName: schemaCheck.productName,
      extractedSku: schemaCheck.sku,
      extractedMerchantProductId: schemaCheck.merchantProductId,
      realColumnsInspected,
      rejectionReasons: [],
    });

    validProofs.push({
      id: lp.id,
      sourceTable: "LandingPageSnapshot",
      workspaceId: rowWorkspaceId,
      candidateId: cleanNonBlank(input.candidateId),
      researchProductId: cleanNonBlank(lp.productId || productId),
      storeDomain: effectiveProofDomain,
      canonicalUrl: effectiveProofUrl,
      observedAt: obsDate.toISOString(),
      schemaVerified: true,
      hasJsonLdProduct: schemaCheck.hasJsonLdProduct,
      proofMethod: schemaCheck.proofMethod,
      validationStatus: "CONTENT_VALIDATED_WITH_SOURCE",
      rawSourcePayload: lp.observationsJson,
      rawSourceSha256: schemaCheck.expectedSha256,
      sourceFieldUsed: "LandingPageSnapshot.observationsJson",
      fetchOutcome: "FETCH_SUCCEEDED",
      resolutionSource: schemaCheck.proofMethod,
      merchantProductId: schemaCheck.merchantProductId,
      sku: schemaCheck.sku,
      gtin: schemaCheck.gtin,
      verifiedProductTitle: schemaCheck.productName,
      offerPrice: schemaCheck.offerPrice,
      offerCurrency: schemaCheck.offerCurrency,
      offerAvailability: schemaCheck.offerAvailability,
      contentHash: cleanNonBlank(lp.contentHash),
      evidenceOrigin: "LANDING_PAGE_SNAPSHOT_JSON_LD",
      observationMethod: "AUTOMATED_SCRAPE",
      classification: "VERIFIED",
      isSyntheticOrFixture: false,
      rejectionReasons: [],
    });
  }

  // 3. Inspect `CompetitorOfferSnapshot` rows using exact Prisma columns:
  // Price / offer-only rows (`sellingPrice`, `currency`, `availability`, `offerDataJson`) are offer telemetry ONLY
  // and NEVER promote a candidate to `VERIFIED` identity on their own (M04).
  for (const { row: os, productDomain, productId } of offerRows) {
    const realColumnsInspected = [
      "id",
      "workspaceId",
      "productId",
      "storeId",
      "adId",
      "sourceUrl",
      "finalUrl",
      "currency",
      "sellingPrice",
      "compareAtPrice",
      "bundleQuantity",
      "hasFreeShipping",
      "shippingThreshold",
      "availability",
      "offerDataJson",
      "evidenceJson",
      "snapshotHash",
      "observedAt",
    ];
    const rowWorkspaceId = cleanNonBlank(os.workspaceId);
    const osUrl = cleanNonBlank(os.finalUrl || os.sourceUrl);
    const osDomain = normalizeMerchantHost(osUrl || productDomain);
    const obsDate = parseValidDate(os.observedAt);

    recordAudit({
      recordId: os.id,
      sourceTable: "CompetitorOfferSnapshot",
      workspaceId: rowWorkspaceId,
      productId: cleanNonBlank(os.productId || productId),
      storeDomain: osDomain,
      sourceUrl: osUrl,
      observedAt: obsDate?.toISOString() || null,
      validationStatus: "OFFER_SNAPSHOT_NOT_IDENTITY_PROOF",
      proofMethod: "NONE",
      schemaVerified: false,
      hasJsonLdProduct: false,
      rawSourceReconstructable: false,
      hashVerified: false,
      sourceFieldUsed: "sellingPrice/offerDataJson",
      expectedHashRef: cleanNonBlank(os.snapshotHash),
      computedSha256: null,
      extractedProductName: null,
      extractedSku: null,
      extractedMerchantProductId: null,
      realColumnsInspected,
      rejectionReasons: [
        "COMPETITOR_OFFER_SNAPSHOT_PRICE_TELEMETRY_ONLY_NOT_PRODUCT_SCHEMA_PROOF",
      ],
    });
  }

  return {
    validProofs,
    allAuditedRecords,
    summary: {
      totalInspected: allAuditedRecords.length,
      validProofCount: validProofs.length,
      byTable,
      byValidationStatus,
    },
  };
}

/**
 * Validates a `PersistedMerchantProofRecord` to ensure callers cannot bypass `extractPersistedMerchantProofsFromDbRows`
 * by passing bare boolean flags (`schemaVerified: true`, `hasJsonLdProduct: true`, `fetchOutcome: "FETCH_SUCCEEDED"`)
 * without a reconstructable raw source payload, valid SHA-256 hash, and parsed Product schema.
 */
export function validatePersistedMerchantProofRecord(
  proof: PersistedMerchantProofRecord,
  context: {
    candidateWorkspaceId?: string | null;
    candidateDomain?: string | null;
    candidateCanonicalUrl?: string | null;
    candidateTitle?: string | null;
    expectedSku?: string | null;
    expectedMerchantProductId?: string | null;
    asOf: Date;
    maxStaleDays?: number;
  }
): {
  valid: boolean;
  validationStatus: MerchantProofValidationStatus;
  proofMethod: MerchantProofMethod;
  reasonCodes: string[];
  parsedSchema?: ParsedProductSchemaValidationResult;
} {
  if (!proof || typeof proof !== "object" || !cleanNonBlank(proof.id)) {
    return {
      valid: false,
      validationStatus: "UNVALIDATED_CALLER_FLAGS_REJECTED",
      proofMethod: "NONE",
      reasonCodes: ["MISSING_PROOF_RECORD_ID"],
    };
  }

  // Reject CompetitorOfferSnapshot or ResearchProduct rows immediately (M03, M04)
  if (proof.sourceTable === "CompetitorOfferSnapshot") {
    return {
      valid: false,
      validationStatus: "OFFER_SNAPSHOT_NOT_IDENTITY_PROOF",
      proofMethod: "NONE",
      reasonCodes: ["OFFER_SNAPSHOT_NOT_IDENTITY_PROOF"],
    };
  }
  if (proof.sourceTable === "ResearchProduct") {
    return {
      valid: false,
      validationStatus: "PRODUCT_ROW_DISCOVERY_ONLY",
      proofMethod: "NONE",
      reasonCodes: ["PRODUCT_ROW_DISCOVERY_ONLY"],
    };
  }

  // Synthetic / fixture check (M14)
  const originUpper = String(proof.evidenceOrigin || "").trim().toUpperCase();
  const methodUpper = String(proof.observationMethod || proof.evidenceOrigin || "")
    .trim()
    .toUpperCase();
  const classUpper = String(proof.classification || "").trim().toUpperCase();
  if (
    proof.isSyntheticOrFixture === true ||
    SYNTHETIC_PROVENANCE_VALUES.has(originUpper) ||
    SYNTHETIC_PROVENANCE_VALUES.has(methodUpper) ||
    SYNTHETIC_PROVENANCE_VALUES.has(classUpper) ||
    SYNTHETIC_HASH_OR_ID_PATTERNS.test(String(proof.id || "")) ||
    SYNTHETIC_HASH_OR_ID_PATTERNS.test(String(proof.contentHash || "")) ||
    SYNTHETIC_HASH_OR_ID_PATTERNS.test(String(proof.rawSourceSha256 || "")) ||
    SYNTHETIC_HASH_OR_ID_PATTERNS.test(String(proof.verifiedProductTitle || "")) ||
    SYNTHETIC_HASH_OR_ID_PATTERNS.test(String(proof.rawSourcePayload || ""))
  ) {
    return {
      valid: false,
      validationStatus: "SYNTHETIC_OR_FIXTURE_REJECTED",
      proofMethod: "NONE",
      reasonCodes: ["SYNTHETIC_MERCHANT_PROOF_REJECTED"],
    };
  }

  // Unsafe observationMethod / classification check (M09)
  if (
    UNSAFE_EVIDENCE_METHODS.has(methodUpper) ||
    UNSAFE_EVIDENCE_METHODS.has(originUpper) ||
    UNSAFE_EVIDENCE_CLASSIFICATIONS.has(classUpper)
  ) {
    return {
      valid: false,
      validationStatus: "UNSAFE_OBSERVATION_METHOD_OR_CLASSIFICATION",
      proofMethod: "NONE",
      reasonCodes: ["UNSAFE_OBSERVATION_METHOD_OR_CLASSIFICATION_REJECTED"],
    };
  }

  // Workspace isolation check (M13): when candidate specifies workspaceId, proof MUST also specify matching workspaceId
  const candWs = cleanNonBlank(context.candidateWorkspaceId);
  const proofWs = cleanNonBlank(proof.workspaceId);
  if (candWs && (!proofWs || proofWs !== candWs)) {
    return {
      valid: false,
      validationStatus: "CROSS_WORKSPACE_REJECTED",
      proofMethod: "NONE",
      reasonCodes: ["CROSS_WORKSPACE_MERCHANT_PROOF_REJECTED"],
    };
  }

  // Temporal checks (M12, M15)
  const proofDate = parseValidDate(proof.observedAt);
  if (!proofDate) {
    return {
      valid: false,
      validationStatus: "POST_CUTOFF_OR_INVALID_DATE",
      proofMethod: "NONE",
      reasonCodes: ["MISSING_PROOF_TIMESTAMP_REJECTED"],
    };
  }
  if (proof.verifiedAt !== undefined && proof.verifiedAt !== null && !parseValidDate(proof.verifiedAt)) {
    return {
      valid: false,
      validationStatus: "POST_CUTOFF_OR_INVALID_DATE",
      proofMethod: "NONE",
      reasonCodes: ["INVALID_PROOF_VERIFIED_AT_REJECTED"],
    };
  }
  const verDate = proof.verifiedAt ? parseValidDate(proof.verifiedAt) : null;
  if (
    proofDate.getTime() > context.asOf.getTime() ||
    (verDate && verDate.getTime() > context.asOf.getTime())
  ) {
    return {
      valid: false,
      validationStatus: "POST_CUTOFF_OR_INVALID_DATE",
      proofMethod: "NONE",
      reasonCodes: ["POST_CUTOFF_MERCHANT_PROOF_REJECTED"],
    };
  }

  const maxStaleMs =
    typeof context.maxStaleDays === "number" && context.maxStaleDays > 0
      ? context.maxStaleDays * 86_400_000
      : null;
  if (maxStaleMs !== null && context.asOf.getTime() - proofDate.getTime() > maxStaleMs) {
    return {
      valid: false,
      validationStatus: "POST_CUTOFF_OR_INVALID_DATE",
      proofMethod: "NONE",
      reasonCodes: ["STALE_MERCHANT_PROOF_REJECTED"],
    };
  }

  // Require validated raw source payload + SHA-256 hash (M01, M02, M06, M07, M16, M17)
  const rawPayload = cleanNonBlank(proof.rawSourcePayload);
  const expectedHash = cleanNonBlank(proof.rawSourceSha256 || proof.contentHash);
  if (!rawPayload || !expectedHash) {
    return {
      valid: false,
      validationStatus: "RAW_SOURCE_NOT_RECONSTRUCTABLE",
      proofMethod: "NONE",
      reasonCodes: [
        "UNVALIDATED_CALLER_BOOLEAN_FLAGS_REJECTED_RAW_SOURCE_NOT_RECONSTRUCTABLE",
      ],
    };
  }

  const schemaCheck = parseAndValidateProductSchemaPayload(rawPayload, {
    expectedHash,
    allowShopifyProductJson:
      proof.proofMethod === "SHOPIFY_PRODUCT_JSON" ||
      proof.proofMethod === "VERIFIED_MERCHANT_API" ||
      methodUpper === "SHOPIFY_PRODUCT_JSON" ||
      methodUpper === "VERIFIED_MERCHANT_API",
    observationMethod: methodUpper || proof.proofMethod || null,
  });

  if (!schemaCheck.valid) {
    return {
      valid: false,
      validationStatus: schemaCheck.validationStatus,
      proofMethod: schemaCheck.proofMethod,
      reasonCodes: schemaCheck.rejectionReasons,
      parsedSchema: schemaCheck,
    };
  }

  // Domain consistency check (M11)
  const effectiveProofUrl = cleanNonBlank(proof.canonicalUrl || schemaCheck.canonicalUrl);
  const effectiveProofDomain = normalizeMerchantHost(
    proof.storeDomain || effectiveProofUrl
  );
  if (context.candidateDomain) {
    const domMatch = doesProofDomainMatchCandidate({
      candidateDomain: context.candidateDomain,
      candidateCanonicalUrl: context.candidateCanonicalUrl || null,
      proofDomain: effectiveProofDomain,
      proofUrl: effectiveProofUrl,
    });
    if (!domMatch.matched) {
      return {
        valid: false,
        validationStatus: "DOMAIN_MISMATCH_REJECTED",
        proofMethod: schemaCheck.proofMethod,
        reasonCodes: ["MERCHANT_DOMAIN_MISMATCH_PROOF_REJECTED"],
      };
    }
  }

  // Product / handle / SKU alignment check (M10)
  const prodAlign = doesProofAlignWithCandidateProduct({
    candidateCanonicalUrl: context.candidateCanonicalUrl || null,
    candidateTitle: context.candidateTitle || null,
    expectedSku: context.expectedSku || null,
    expectedMerchantProductId: context.expectedMerchantProductId || null,
    proofUrl: effectiveProofUrl,
    proofProductName: schemaCheck.productName || cleanNonBlank(proof.verifiedProductTitle),
    proofSku: schemaCheck.sku || cleanNonBlank(proof.sku),
    proofMerchantProductId:
      schemaCheck.merchantProductId || cleanNonBlank(proof.merchantProductId),
  });
  if (!prodAlign.aligned) {
    return {
      valid: false,
      validationStatus: "PRODUCT_OR_SKU_MISMATCH_REJECTED",
      proofMethod: schemaCheck.proofMethod,
      reasonCodes: [
        "CROSS_PRODUCT_OR_SKU_MISMATCH_ON_MERCHANT",
        prodAlign.reason || "PRODUCT_MISMATCH",
      ],
    };
  }

  return {
    valid: true,
    validationStatus: "CONTENT_VALIDATED_WITH_SOURCE",
    proofMethod: schemaCheck.proofMethod,
    reasonCodes: [],
    parsedSchema: schemaCheck,
  };
}

/**
 * Pure point-in-time product identity classifier (`P0-A`, `P0-C`, `M01..M17`, `P01..P06`).
 * Never promotes a candidate to `"VERIFIED"` from URL path patterns (`/products/...` or `/main/...`) alone,
 * nor from caller-supplied bare boolean flags (`schemaVerified: true`, `hasJsonLdProduct: true`) lacking
 * reconstructable raw Product JSON-LD / Shopify product JSON + verified SHA-256 content hash.
 */
export function classifyHistoricalProductIdentity(
  input: HistoricalProductIdentityInput,
  asOf: Date | string
): HistoricalProductIdentityClassification {
  const asOfDate = parseValidDate(asOf);
  const candidateId = cleanNonBlank(input.candidateId);
  const title = cleanNonBlank(input.title) || "";
  const storeDomain = normalizeMerchantHost(input.storeDomain || input.canonicalProductUrl);
  const canonicalUrl = cleanNonBlank(input.canonicalProductUrl);

  const discoveryRefs: string[] = [];
  if (candidateId) discoveryRefs.push(`candidate:${candidateId}`);
  if (storeDomain) discoveryRefs.push(`domain:${storeDomain}`);
  if (canonicalUrl) discoveryRefs.push(`url:${canonicalUrl}`);

  const isCheckoutChampFunnel = isFunnelOrCheckoutChamp(storeDomain, canonicalUrl);

  // Fail closed on invalid `asOf` date (M15)
  if (!asOfDate) {
    return {
      identityStatus: "UNVERIFIED",
      verificationEvidenceStatus: "MISSING",
      isCheckoutChampFunnel,
      evidenceRefIds: [],
      independentMerchantProofRefs: [],
      discoveryRefs,
      evidenceObservedAt: null,
      eligibilityAtAsOf: false,
      reasonCodes: ["INVALID_ASOF_TIMESTAMP_REJECTED"],
    };
  }

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

  // 2. Enforce point-in-time observation cutoff (and fail closed if observedAt is explicitly invalid string/Date)
  if (input.observedAt !== undefined && input.observedAt !== null) {
    const obsDate = parseValidDate(input.observedAt);
    if (!obsDate) {
      return {
        identityStatus: "UNVERIFIED",
        verificationEvidenceStatus: "MISSING",
        isCheckoutChampFunnel,
        evidenceRefIds: [],
        independentMerchantProofRefs: [],
        discoveryRefs,
        evidenceObservedAt: null,
        eligibilityAtAsOf: false,
        reasonCodes: ["INVALID_CANDIDATE_OBSERVED_AT_TIMESTAMP"],
      };
    }
    if (obsDate.getTime() > asOfDate.getTime()) {
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

  // 4. Evaluate persisted independent merchant proof records at `<= asOf` using strict content + hash validation
  const proofs = Array.isArray(input.persistedMerchantProofs) ? input.persistedMerchantProofs : [];
  const validProofs: Array<{
    proof: PersistedMerchantProofRecord;
    proofMethod: MerchantProofMethod;
    parsedSchema?: ParsedProductSchemaValidationResult;
  }> = [];
  const reasonCodes: string[] = [];
  const proofValidationStatuses: Record<string, MerchantProofValidationStatus> = {};
  const proofMethods: Record<string, MerchantProofMethod> = {};
  let hadPostCutoffProof = false;
  let hadStaleProof = false;
  let hadSyntheticProof = false;

  for (const proof of proofs) {
    if (!proof || typeof proof !== "object") continue;
    const key = `${proof.sourceTable || "Unknown"}:${proof.id || "unknown"}`;
    const check = validatePersistedMerchantProofRecord(proof, {
      candidateWorkspaceId: input.workspaceId,
      candidateDomain: storeDomain,
      candidateCanonicalUrl: canonicalUrl,
      candidateTitle: title,
      expectedSku: input.expectedSku,
      expectedMerchantProductId: input.expectedMerchantProductId,
      asOf: asOfDate,
      maxStaleDays: input.maxStaleDays,
    });

    proofValidationStatuses[key] = check.validationStatus;
    proofMethods[key] = check.proofMethod;

    if (!check.valid) {
      reasonCodes.push(...check.reasonCodes);
      if (check.reasonCodes.includes("POST_CUTOFF_MERCHANT_PROOF_REJECTED")) {
        hadPostCutoffProof = true;
      }
      if (check.reasonCodes.includes("STALE_MERCHANT_PROOF_REJECTED")) {
        hadStaleProof = true;
      }
      if (check.validationStatus === "SYNTHETIC_OR_FIXTURE_REJECTED") {
        hadSyntheticProof = true;
      }
      continue;
    }

    validProofs.push({
      proof,
      proofMethod: check.proofMethod,
      parsedSchema: check.parsedSchema,
    });
  }

  // 5. CheckoutChamp / multi-step sales funnel rule (`M05`, `P05`):
  // Never promote a CheckoutChamp / funnel domain to VERIFIED without root JSON-LD product schema proof
  if (isCheckoutChampFunnel) {
    const hasRootJsonLdProof = validProofs.some(
      (vp) =>
        vp.proofMethod === "JSON_LD_PRODUCT_SCHEMA" &&
        !isFunnelOrCheckoutChamp(vp.proof.storeDomain, vp.proof.canonicalUrl)
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
        proofValidationStatuses,
        proofMethods,
      };
    }
  }

  // 6. If valid independent point-in-time merchant proof(s) exist at `<= asOf`, classify as VERIFIED
  if (validProofs.length > 0) {
    validProofs.sort((a, b) => {
      const da = parseValidDate(a.proof.observedAt)?.getTime() || 0;
      const db = parseValidDate(b.proof.observedAt)?.getTime() || 0;
      return db - da;
    });
    const latestObservedAt =
      parseValidDate(validProofs[0].proof.observedAt)?.toISOString() || null;
    const evidenceRefIds = Array.from(
      new Set(validProofs.map((vp) => `${vp.proof.sourceTable}:${vp.proof.id}`))
    );
    const independentMerchantProofRefs = Array.from(
      new Set(
        validProofs.flatMap((vp) => {
          const p = vp.proof;
          const refs: string[] = [`${p.sourceTable}:${p.id}`];
          if (vp.proofMethod === "JSON_LD_PRODUCT_SCHEMA") {
            refs.push(`jsonld_verified:${p.sourceTable}:${p.id}`);
          } else if (vp.proofMethod === "SHOPIFY_PRODUCT_JSON") {
            refs.push(`shopify_product_json_verified:${p.sourceTable}:${p.id}`);
          } else if (vp.proofMethod === "VERIFIED_MERCHANT_API") {
            refs.push(`merchant_api_verified:${p.sourceTable}:${p.id}`);
          }
          const mId = cleanNonBlank(
            vp.parsedSchema?.merchantProductId || p.merchantProductId
          );
          if (mId) {
            refs.push(`merchantProductId:${mId}`);
          }
          const sku = cleanNonBlank(vp.parsedSchema?.sku || p.sku);
          if (sku) {
            refs.push(`sku:${sku}`);
          }
          const sha = cleanNonBlank(vp.parsedSchema?.expectedSha256 || p.rawSourceSha256);
          if (sha) {
            refs.push(`sha256:${sha}`);
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
      proofValidationStatuses,
      proofMethods,
    };
  }

  // 7. No independent point-in-time merchant proof at `<= asOf`:
  // Fail closed to PROBABLE (NEVER promote based on `/products/...` URL path!)
  let verificationEvidenceStatus: VerificationEvidenceStatus = "DISCOVERY_ONLY";
  if (hadPostCutoffProof) {
    verificationEvidenceStatus = "POST_CUTOFF";
  } else if (hadStaleProof) {
    verificationEvidenceStatus = "STALE";
  } else if (hadSyntheticProof) {
    verificationEvidenceStatus = "MISSING";
  } else if (input.isAdOnlyFallback || !cleanNonBlank(input.researchProductId)) {
    verificationEvidenceStatus = "DISCOVERY_ONLY";
    reasonCodes.push("AD_ONLY_NO_INDEPENDENT_MERCHANT_PROOF");
  } else {
    verificationEvidenceStatus = "DISCOVERY_ONLY";
    reasonCodes.push(
      "URL_PATH_OR_PRODUCT_ROW_ONLY_NO_INDEPENDENT_POINT_IN_TIME_MERCHANT_PROOF"
    );
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
    proofValidationStatuses,
    proofMethods,
  };
}

// ============================================================================
// P0-B: Origin-Authentic G16 Live Observation Classifier (`L01..L16`, `P03..P04`)
// ============================================================================

export interface ClassifyPersistedLiveObservationInput {
  adObservation: PersistedAdObservationRow;
  discoveryRunAd: PersistedDiscoveryRunAdRow;
  expectedWorkspaceId: string;
  expectedRunId?: string | null;
  allowedRunIds?: string[] | Set<string> | null;
  expectedCandidateId?: string | null;
  expectedAdIds?: string[] | Set<string> | null;
  expectedStoreDomain?: string | null;
  asOf?: Date | string | null;
  discoveryRun?: {
    id: string;
    workspaceId: string;
    status?: string | null;
    providerStatsJson?: string | null;
    startedAt?: Date | string | null;
    completedAt?: Date | string | null;
  } | null;
  providerRequestLedger?: {
    requestId?: string | null;
    providerId?: string | null;
    workspaceId?: string | null;
    runId?: string | null;
    status?: string | null;
    executedAt?: Date | string | null;
  } | null;
}

export interface PersistedLiveObservationClassification {
  observationId: string | null;
  adId: string | null;
  runId: string | null;
  workspaceId: string | null;
  providerId: string | null;
  ingestOutcome: string | null;
  evidenceType: string | null;
  verificationMethod: string | null;
  evidenceReference: string | null;
  sourceUrl: string | null;
  observedAt: string | null;
  sourceTimestamp: string | null;
  rawPayloadPresent: boolean;
  rawPayloadParseable: boolean;
  providerRequestId: string | null;
  mcpInvocationRef: string | null;
  isAuthenticLiveProviderObservation: boolean;
  originEvidenceClassification: OriginEvidenceClassification;
  derivedProvenance:
    | "LIVE_PROVIDER"
    | "PERSISTED_LIVE_ORIGIN_UNVERIFIED"
    | "REUSED_EXISTING_AD"
    | "FALLBACK_OR_SYNTHETIC";
  derivedSourceMode:
    | "LIVE_PROVIDER"
    | "PERSISTED_DB_UNVERIFIED"
    | "CACHE_ONLY"
    | "FALLBACK";
  isCached: boolean;
  isLiveRecord: boolean;
  rejectionReasons: string[];
  realColumnsInspected: {
    AdObservation: string[];
    DiscoveryRunAd: string[];
  };
}

const VALID_LIVE_DISCOVERY_PROVIDERS = new Set([
  "META_AD_LIBRARY",
  "GOOGLE_ADS_TRANSPARENCY",
  "TIKTOK_COMMERCIAL_CONTENT",
  "WALMART_US_JINA_PILOT",
  "META_ADS_LIVE",
  "GOOGLE_ADS_LIVE",
  "TIKTOK_ADS_LIVE",
]);

const VALID_AUTOMATED_AD_EVIDENCE_TYPES = new Set([
  "SCRAPED_POST",
  "API_PAYLOAD",
  "LIVE_PROVIDER_CAPTURE",
]);

const VALID_AUTOMATED_AD_VERIFICATION_METHODS = new Set([
  "AUTOMATED_SCRAPE",
  "API_SYNC",
  "LIVE_MCP_EXECUTION",
]);

const NON_LIVE_RAW_ORIGIN_TOKENS = new Set([
  "DETERMINISTIC_FALLBACK",
  "FALLBACK",
  "CACHED_DB",
  "CACHED_SOURCE",
  "CACHE_ONLY",
  "DB_BACKFILL",
  "TEST_FIXTURE",
  "CONTROLLED_FIXTURE",
  "SYNTHETIC",
  "MOCK",
  "DEMO",
  "SEED",
  "HISTORICAL_REPLAY",
  "MANUAL_ENTRY",
  "USER_OBSERVED",
]);

/**
 * Classifies a persisted `AdObservation` + `DiscoveryRunAd` pair strictly from immutable DB columns
 * (`AdObservation.evidenceType`, `verificationMethod`, `evidenceReference`, `sourceTimestamp`, `observedAt`,
 * `rawPayload`; `DiscoveryRunAd.runId`, `workspaceId`, `providerId`, `ingestOutcome`, `sourceUrl`, `observedAt`).
 *
 * NEVER rebrands a persisted DB row as `provenance: "LIVE_PROVIDER"` unless `ingestOutcome === "NEW"` AND
 * `rawPayload` + `evidenceReference` prove an authentic upstream provider execution in the target workspace/run/product
 * at `<= asOf`.
 */
export function classifyPersistedLiveObservation(
  input: ClassifyPersistedLiveObservationInput
): PersistedLiveObservationClassification {
  const obs = input?.adObservation;
  const runAd = input?.discoveryRunAd;
  const rejectionReasons: string[] = [];

  const realColumnsInspected = {
    AdObservation: [
      "id",
      "adId",
      "observedAt",
      "observationStatus",
      "isActive",
      "evidenceType",
      "verificationMethod",
      "evidenceReference",
      "sourceTimestamp",
      "confidence",
      "rawPayload",
    ],
    DiscoveryRunAd: [
      "id",
      "runId",
      "adId",
      "workspaceId",
      "providerId",
      "libraryId",
      "ingestOutcome",
      "sourceUrl",
      "observedAt",
    ],
  };

  const obsId = cleanNonBlank(obs?.id);
  const adId = cleanNonBlank(obs?.adId || runAd?.adId);
  const runId = cleanNonBlank(runAd?.runId);
  const workspaceId = cleanNonBlank(runAd?.workspaceId);
  const providerId = cleanNonBlank(runAd?.providerId);
  const ingestOutcome = cleanNonBlank(runAd?.ingestOutcome)?.toUpperCase() || null;
  const evidenceType = cleanNonBlank(obs?.evidenceType)?.toUpperCase() || null;
  const verificationMethod = cleanNonBlank(obs?.verificationMethod)?.toUpperCase() || null;
  const evidenceReference = cleanNonBlank(obs?.evidenceReference);
  const sourceUrl = cleanNonBlank(runAd?.sourceUrl);
  const rawPayloadStr = cleanNonBlank(obs?.rawPayload);

  const obsDate = obs?.observedAt !== undefined && obs?.observedAt !== null ? parseValidDate(obs.observedAt) : null;
  const srcDate =
    obs?.sourceTimestamp !== undefined && obs?.sourceTimestamp !== null
      ? parseValidDate(obs.sourceTimestamp)
      : null;
  const runAdDate =
    runAd?.observedAt !== undefined && runAd?.observedAt !== null
      ? parseValidDate(runAd.observedAt)
      : null;
  const asOfDate = input?.asOf ? parseValidDate(input.asOf) : null;

  const buildUnverified = (
    classification: OriginEvidenceClassification,
    derivedProvenance:
      | "PERSISTED_LIVE_ORIGIN_UNVERIFIED"
      | "REUSED_EXISTING_AD"
      | "FALLBACK_OR_SYNTHETIC" = "PERSISTED_LIVE_ORIGIN_UNVERIFIED",
    derivedSourceMode:
      | "PERSISTED_DB_UNVERIFIED"
      | "CACHE_ONLY"
      | "FALLBACK" = "PERSISTED_DB_UNVERIFIED",
    extra?: {
      rawPayloadParseable?: boolean;
      providerRequestId?: string | null;
      mcpInvocationRef?: string | null;
    }
  ): PersistedLiveObservationClassification => ({
    observationId: obsId,
    adId,
    runId,
    workspaceId,
    providerId,
    ingestOutcome,
    evidenceType,
    verificationMethod,
    evidenceReference,
    sourceUrl,
    observedAt: obsDate?.toISOString() || null,
    sourceTimestamp: srcDate?.toISOString() || null,
    rawPayloadPresent: Boolean(rawPayloadStr),
    rawPayloadParseable: extra?.rawPayloadParseable ?? false,
    providerRequestId: extra?.providerRequestId ?? null,
    mcpInvocationRef: extra?.mcpInvocationRef ?? null,
    isAuthenticLiveProviderObservation: false,
    originEvidenceClassification: classification,
    derivedProvenance,
    derivedSourceMode,
    isCached: true,
    isLiveRecord: false,
    rejectionReasons: Array.from(new Set(rejectionReasons)),
    realColumnsInspected,
  });

  if (!obs || !runAd || !obsId || !adId) {
    rejectionReasons.push("MISSING_AD_OBSERVATION_OR_DISCOVERY_RUN_AD_RECORD");
    return buildUnverified("PERSISTED_LIVE_ORIGIN_UNVERIFIED");
  }

  // L07: Fabricated hydration ID patterns (`obs_<runId>_<candId>` or `req_<runId>`)
  if (
    isFabricatedHydrationObservation(
      {
        id: obsId,
        observationId: obsId,
        candidateId: input.expectedCandidateId,
        researchRunId: runId,
      },
      runId
    )
  ) {
    rejectionReasons.push("FABRICATED_HYDRATION_OBSERVATION_ID_PATTERN");
    return buildUnverified("FALLBACK_OR_SYNTHETIC", "FALLBACK_OR_SYNTHETIC", "FALLBACK");
  }

  // L06: Synthetic / test fixture check on record IDs & references
  if (
    SYNTHETIC_HASH_OR_ID_PATTERNS.test(obsId) ||
    SYNTHETIC_HASH_OR_ID_PATTERNS.test(adId) ||
    (evidenceReference && SYNTHETIC_HASH_OR_ID_PATTERNS.test(evidenceReference)) ||
    (rawPayloadStr && SYNTHETIC_HASH_OR_ID_PATTERNS.test(rawPayloadStr))
  ) {
    rejectionReasons.push("SYNTHETIC_OR_TEST_FIXTURE_OBSERVATION_REJECTED");
    return buildUnverified("FALLBACK_OR_SYNTHETIC", "FALLBACK_OR_SYNTHETIC", "FALLBACK");
  }

  // L10: Workspace isolation check
  const expectedWs = cleanNonBlank(input.expectedWorkspaceId);
  if (!workspaceId || !expectedWs || workspaceId !== expectedWs) {
    rejectionReasons.push(
      `CROSS_WORKSPACE_OBSERVATION_REJECTED: runAdWorkspace=${workspaceId || "<empty>"}, expected=${expectedWs || "<empty>"}`
    );
    return buildUnverified("CROSS_WORKSPACE_OR_RUN");
  }
  if (
    input.discoveryRun &&
    cleanNonBlank(input.discoveryRun.workspaceId) &&
    cleanNonBlank(input.discoveryRun.workspaceId) !== expectedWs
  ) {
    rejectionReasons.push("DISCOVERY_RUN_WORKSPACE_MISMATCH");
    return buildUnverified("CROSS_WORKSPACE_OR_RUN");
  }

  // L11: Run lineage and Ad linkage check
  if (!runId) {
    rejectionReasons.push("MISSING_DISCOVERY_RUN_ID");
    return buildUnverified("CROSS_WORKSPACE_OR_RUN");
  }
  if (cleanNonBlank(obs.adId) !== cleanNonBlank(runAd.adId)) {
    rejectionReasons.push("AD_OBSERVATION_AD_ID_MISMATCH_WITH_DISCOVERY_RUN_AD");
    return buildUnverified("CROSS_WORKSPACE_OR_RUN");
  }
  const expectedRunId = cleanNonBlank(input.expectedRunId);
  if (expectedRunId && runId !== expectedRunId) {
    const allowedSet = input.allowedRunIds
      ? input.allowedRunIds instanceof Set
        ? input.allowedRunIds
        : new Set(input.allowedRunIds)
      : null;
    if (!allowedSet || !allowedSet.has(runId)) {
      rejectionReasons.push(
        `CROSS_RUN_OBSERVATION_REJECTED: runId=${runId}, expected=${expectedRunId}`
      );
      return buildUnverified("CROSS_WORKSPACE_OR_RUN");
    }
  }
  if (input.discoveryRun && cleanNonBlank(input.discoveryRun.id) !== runId) {
    rejectionReasons.push("DISCOVERY_RUN_RECORD_ID_MISMATCH");
    return buildUnverified("CROSS_WORKSPACE_OR_RUN");
  }

  // L14: Candidate adId & domain linkage check
  if (input.expectedAdIds) {
    const expectedAds =
      input.expectedAdIds instanceof Set
        ? input.expectedAdIds
        : new Set(input.expectedAdIds.map((x) => String(x).trim()).filter(Boolean));
    if (expectedAds.size > 0 && !expectedAds.has(adId)) {
      rejectionReasons.push(`OBSERVATION_AD_ID_NOT_IN_CANDIDATE_SUPPORTING_ADS: adId=${adId}`);
      return buildUnverified("CROSS_CANDIDATE_OR_DOMAIN");
    }
  }

  // L12 & L13: Temporal validity check (`observedAt`, `sourceTimestamp`, `DiscoveryRunAd.observedAt`)
  if (input.asOf !== undefined && input.asOf !== null && !asOfDate) {
    rejectionReasons.push("INVALID_ASOF_CUTOFF_DATE");
    return buildUnverified("POST_CUTOFF_OR_INVALID_DATE");
  }
  if (!obsDate || !srcDate || !runAdDate) {
    rejectionReasons.push(
      `INVALID_OR_MISSING_OBSERVATION_TIMESTAMPS: observedAt=${String(obs.observedAt)}, sourceTimestamp=${String(obs.sourceTimestamp)}, runAdObservedAt=${String(runAd.observedAt)}`
    );
    return buildUnverified("POST_CUTOFF_OR_INVALID_DATE");
  }
  if (
    asOfDate &&
    (obsDate.getTime() > asOfDate.getTime() ||
      srcDate.getTime() > asOfDate.getTime() ||
      runAdDate.getTime() > asOfDate.getTime())
  ) {
    rejectionReasons.push("POST_CUTOFF_OBSERVATION_OR_SOURCE_TIMESTAMP");
    return buildUnverified("POST_CUTOFF_OR_INVALID_DATE");
  }

  // L01 & L02: `DiscoveryRunAd.ingestOutcome` check
  // `EXISTING` means a pre-existing DB ad was re-linked; `UPDATED` (or anything other than `NEW`)
  // is not a fresh first-time live provider ingest unless backed by verified live origin, and per contract
  // L01 (`EXISTING`) and L02 (`UPDATED` without live origin / non-NEW) must be rejected.
  if (ingestOutcome === "EXISTING") {
    rejectionReasons.push("DISCOVERY_RUN_AD_INGEST_OUTCOME_EXISTING_REUSED_AD");
    return buildUnverified("REUSED_EXISTING_AD", "REUSED_EXISTING_AD", "CACHE_ONLY");
  }
  if (ingestOutcome !== "NEW") {
    rejectionReasons.push(
      `DISCOVERY_RUN_AD_INGEST_OUTCOME_NOT_NEW: ingestOutcome=${ingestOutcome || "<empty>"}`
    );
    return buildUnverified("PERSISTED_LIVE_ORIGIN_UNVERIFIED");
  }

  // L04: `AdObservation.evidenceType` and `verificationMethod` check
  if (
    !evidenceType ||
    !VALID_AUTOMATED_AD_EVIDENCE_TYPES.has(evidenceType) ||
    !verificationMethod ||
    !VALID_AUTOMATED_AD_VERIFICATION_METHODS.has(verificationMethod)
  ) {
    rejectionReasons.push(
      `NON_AUTOMATED_AD_OBSERVATION_EVIDENCE_TYPE_OR_METHOD: evidenceType=${evidenceType || "<empty>"}, verificationMethod=${verificationMethod || "<empty>"}`
    );
    return buildUnverified("PERSISTED_LIVE_ORIGIN_UNVERIFIED");
  }

  // L09: `evidenceReference` and `sourceUrl` check
  const hasValidEvidenceRefUrl = Boolean(
    evidenceReference && /^https?:\/\/[^\s/$.?#].[^\s]*$/i.test(evidenceReference)
  );
  const hasValidSourceUrl = Boolean(
    sourceUrl && /^https?:\/\/[^\s/$.?#].[^\s]*$/i.test(sourceUrl)
  );
  if (!hasValidEvidenceRefUrl || !hasValidSourceUrl) {
    rejectionReasons.push(
      `MISSING_OR_INVALID_EVIDENCE_REFERENCE_OR_SOURCE_URL: evidenceReference=${evidenceReference || "<empty>"}, sourceUrl=${sourceUrl || "<empty>"}`
    );
    return buildUnverified("PERSISTED_LIVE_ORIGIN_UNVERIFIED");
  }

  // L03 & L16: `AdObservation.rawPayload` presence and JSON validity
  // Note: In current `discoveryIngestionService.ts`, `rawPayload` is not populated (`null`).
  // Any `AdObservation` with `rawPayload = null / "" / "{}"` is honestly classified as
  // `PERSISTED_LIVE_ORIGIN_UNVERIFIED` and NEVER rebranded as `LIVE_PROVIDER`!
  if (!rawPayloadStr) {
    rejectionReasons.push(
      "AD_OBSERVATION_RAW_PAYLOAD_NULL_LIVE_ORIGIN_NOT_STORED_AT_INGESTION"
    );
    return buildUnverified("PERSISTED_LIVE_ORIGIN_UNVERIFIED");
  }

  let parsedPayload: any;
  try {
    parsedPayload = JSON.parse(rawPayloadStr);
  } catch {
    rejectionReasons.push("MALFORMED_AD_OBSERVATION_RAW_PAYLOAD_JSON");
    return buildUnverified("MALFORMED_OR_CONTRADICTORY_PAYLOAD");
  }

  if (
    !parsedPayload ||
    typeof parsedPayload !== "object" ||
    Array.isArray(parsedPayload) ||
    Object.keys(parsedPayload).length === 0
  ) {
    rejectionReasons.push("EMPTY_OR_NON_OBJECT_AD_OBSERVATION_RAW_PAYLOAD");
    return buildUnverified("PERSISTED_LIVE_ORIGIN_UNVERIFIED", "PERSISTED_LIVE_ORIGIN_UNVERIFIED", "PERSISTED_DB_UNVERIFIED", {
      rawPayloadParseable: true,
    });
  }

  // L05 & L06: Inspect `rawPayload` for fallback, cached, fixture, or synthetic origin markers
  const rawOriginUpper = String(
    parsedPayload.origin ||
      parsedPayload.sourceOrigin ||
      parsedPayload.captureMode ||
      parsedPayload.provenance ||
      ""
  )
    .trim()
    .toUpperCase();
  const rawModeUpper = String(
    parsedPayload.sourceMode || parsedPayload.mode || parsedPayload.sourceType || ""
  )
    .trim()
    .toUpperCase();

  if (
    NON_LIVE_RAW_ORIGIN_TOKENS.has(rawOriginUpper) ||
    NON_LIVE_RAW_ORIGIN_TOKENS.has(rawModeUpper) ||
    parsedPayload.isFallback === true ||
    parsedPayload.isCached === true ||
    parsedPayload.isSynthetic === true ||
    parsedPayload.isTestFixture === true ||
    /(?:DETERMINISTIC_FALLBACK|TEST_FIXTURE|CONTROLLED_FIXTURE|CACHED_DB|CACHE_ONLY)/i.test(
      rawPayloadStr
    )
  ) {
    rejectionReasons.push(
      `NON_LIVE_OR_FALLBACK_ORIGIN_IN_RAW_PAYLOAD: origin=${rawOriginUpper || "<empty>"}, mode=${rawModeUpper || "<empty>"}`
    );
    return buildUnverified("FALLBACK_OR_SYNTHETIC", "FALLBACK_OR_SYNTHETIC", "FALLBACK", {
      rawPayloadParseable: true,
    });
  }

  // Require explicit positive live origin indicator in `rawPayload`
  const hasPositiveLiveOrigin =
    rawOriginUpper === "LIVE_PROVIDER_EXECUTION" ||
    rawOriginUpper === "LIVE_PROVIDER" ||
    rawOriginUpper === "LIVE_MCP_CAPTURE" ||
    rawModeUpper === "LIVE_PROVIDER";
  if (!hasPositiveLiveOrigin) {
    rejectionReasons.push(
      `RAW_PAYLOAD_MISSING_EXPLICIT_LIVE_PROVIDER_ORIGIN: origin=${rawOriginUpper || "<empty>"}`
    );
    return buildUnverified("PERSISTED_LIVE_ORIGIN_UNVERIFIED", "PERSISTED_LIVE_ORIGIN_UNVERIFIED", "PERSISTED_DB_UNVERIFIED", {
      rawPayloadParseable: true,
    });
  }

  // L16: Provider consistency check between `DiscoveryRunAd.providerId` and `rawPayload.providerId`
  const payloadProviderId = cleanNonBlank(parsedPayload.providerId);
  if (
    !providerId ||
    !VALID_LIVE_DISCOVERY_PROVIDERS.has(providerId.toUpperCase()) ||
    !payloadProviderId ||
    payloadProviderId.toUpperCase() !== providerId.toUpperCase()
  ) {
    rejectionReasons.push(
      `PROVIDER_ID_MISSING_OR_CONTRADICTS_RAW_PAYLOAD: runAdProvider=${providerId || "<empty>"}, payloadProvider=${payloadProviderId || "<empty>"}`
    );
    return buildUnverified("MALFORMED_OR_CONTRADICTORY_PAYLOAD", "PERSISTED_LIVE_ORIGIN_UNVERIFIED", "PERSISTED_DB_UNVERIFIED", {
      rawPayloadParseable: true,
    });
  }

  // Check workspaceId / runId / adId consistency inside `rawPayload` if present
  const payloadWs = cleanNonBlank(parsedPayload.workspaceId);
  if (payloadWs && payloadWs !== expectedWs) {
    rejectionReasons.push(
      `RAW_PAYLOAD_WORKSPACE_MISMATCH: payloadWs=${payloadWs}, expected=${expectedWs}`
    );
    return buildUnverified("CROSS_WORKSPACE_OR_RUN", "PERSISTED_LIVE_ORIGIN_UNVERIFIED", "PERSISTED_DB_UNVERIFIED", {
      rawPayloadParseable: true,
    });
  }
  const payloadRunId = cleanNonBlank(parsedPayload.runId || parsedPayload.researchRunId);
  if (payloadRunId && payloadRunId !== runId) {
    rejectionReasons.push(
      `RAW_PAYLOAD_RUN_ID_MISMATCH: payloadRunId=${payloadRunId}, runAdRunId=${runId}`
    );
    return buildUnverified("CROSS_WORKSPACE_OR_RUN", "PERSISTED_LIVE_ORIGIN_UNVERIFIED", "PERSISTED_DB_UNVERIFIED", {
      rawPayloadParseable: true,
    });
  }
  const payloadLibraryId = cleanNonBlank(parsedPayload.externalAdId || parsedPayload.libraryId);
  const runAdLibraryId = cleanNonBlank(runAd.libraryId);
  if (payloadLibraryId && runAdLibraryId && payloadLibraryId !== runAdLibraryId) {
    rejectionReasons.push(
      `RAW_PAYLOAD_LIBRARY_ID_MISMATCH: payload=${payloadLibraryId}, runAd=${runAdLibraryId}`
    );
    return buildUnverified("MALFORMED_OR_CONTRADICTORY_PAYLOAD", "PERSISTED_LIVE_ORIGIN_UNVERIFIED", "PERSISTED_DB_UNVERIFIED", {
      rawPayloadParseable: true,
    });
  }

  // L14: Check merchant domain consistency in `rawPayload` (`landingPageDomain` / `destinationUrl` / `storeDomain`)
  const expectedDomain = normalizeMerchantHost(input.expectedStoreDomain);
  const payloadDomain = normalizeMerchantHost(
    parsedPayload.storeDomain ||
      parsedPayload.landingPageDomain ||
      parsedPayload.advertiserDomain ||
      parsedPayload.destinationUrl ||
      parsedPayload.landingPageUrl
  );
  if (
    expectedDomain &&
    payloadDomain &&
    !NON_MERCHANT_PLATFORM_DOMAINS.has(payloadDomain) &&
    payloadDomain !== expectedDomain &&
    !payloadDomain.endsWith(`.${expectedDomain}`) &&
    !expectedDomain.endsWith(`.${payloadDomain}`)
  ) {
    rejectionReasons.push(
      `RAW_PAYLOAD_MERCHANT_DOMAIN_MISMATCH: payloadDomain=${payloadDomain}, expectedDomain=${expectedDomain}`
    );
    return buildUnverified("CROSS_CANDIDATE_OR_DOMAIN", "PERSISTED_LIVE_ORIGIN_UNVERIFIED", "PERSISTED_DB_UNVERIFIED", {
      rawPayloadParseable: true,
    });
  }
  const payloadCandId = cleanNonBlank(parsedPayload.candidateId);
  const expectedCandId = cleanNonBlank(input.expectedCandidateId);
  if (payloadCandId && expectedCandId && payloadCandId !== expectedCandId) {
    rejectionReasons.push(
      `RAW_PAYLOAD_CANDIDATE_ID_MISMATCH: payloadCandidate=${payloadCandId}, expectedCandidate=${expectedCandId}`
    );
    return buildUnverified("CROSS_CANDIDATE_OR_DOMAIN", "PERSISTED_LIVE_ORIGIN_UNVERIFIED", "PERSISTED_DB_UNVERIFIED", {
      rawPayloadParseable: true,
    });
  }

  // L07 & L08: Require non-fabricated `providerRequestId` or `mcpInvocationRef`
  const providerRequestId = cleanNonBlank(parsedPayload.providerRequestId);
  const mcpInvocationRef = cleanNonBlank(parsedPayload.mcpInvocationRef);
  if (!providerRequestId && !mcpInvocationRef) {
    rejectionReasons.push(
      "MISSING_PROVIDER_REQUEST_ID_AND_MCP_INVOCATION_REF_IN_RAW_PAYLOAD"
    );
    return buildUnverified("PERSISTED_LIVE_ORIGIN_UNVERIFIED", "PERSISTED_LIVE_ORIGIN_UNVERIFIED", "PERSISTED_DB_UNVERIFIED", {
      rawPayloadParseable: true,
    });
  }

  if (
    isFabricatedHydrationObservation(
      {
        id: obsId,
        observationId: obsId,
        providerRequestId,
        candidateId: input.expectedCandidateId || payloadCandId,
        researchRunId: runId,
      },
      runId
    )
  ) {
    rejectionReasons.push("FABRICATED_PROVIDER_REQUEST_ID_IN_RAW_PAYLOAD");
    return buildUnverified("FALLBACK_OR_SYNTHETIC", "FALLBACK_OR_SYNTHETIC", "FALLBACK", {
      rawPayloadParseable: true,
      providerRequestId,
      mcpInvocationRef,
    });
  }

  // Verify against `providerRequestLedger` when provided
  if (input.providerRequestLedger) {
    const ledgerReqId = cleanNonBlank(input.providerRequestLedger.requestId);
    const ledgerStatus = cleanNonBlank(input.providerRequestLedger.status)?.toUpperCase();
    const ledgerWs = cleanNonBlank(input.providerRequestLedger.workspaceId);
    if (
      (ledgerReqId && providerRequestId && ledgerReqId !== providerRequestId) ||
      (ledgerWs && ledgerWs !== expectedWs) ||
      (ledgerStatus && !["SUCCEEDED", "COMPLETED", "OK"].includes(ledgerStatus))
    ) {
      rejectionReasons.push("PROVIDER_REQUEST_LEDGER_MISMATCH_OR_UNSUCCESSFUL");
      return buildUnverified("PERSISTED_LIVE_ORIGIN_UNVERIFIED", "PERSISTED_LIVE_ORIGIN_UNVERIFIED", "PERSISTED_DB_UNVERIFIED", {
        rawPayloadParseable: true,
        providerRequestId,
        mcpInvocationRef,
      });
    }
  }

  // All immutable origin checks passed (`P03`)
  return {
    observationId: obsId,
    adId,
    runId,
    workspaceId,
    providerId,
    ingestOutcome,
    evidenceType,
    verificationMethod,
    evidenceReference,
    sourceUrl,
    observedAt: obsDate.toISOString(),
    sourceTimestamp: srcDate.toISOString(),
    rawPayloadPresent: true,
    rawPayloadParseable: true,
    providerRequestId,
    mcpInvocationRef,
    isAuthenticLiveProviderObservation: true,
    originEvidenceClassification: "AUTHENTIC_LIVE_INGEST",
    derivedProvenance: "LIVE_PROVIDER",
    derivedSourceMode: "LIVE_PROVIDER",
    isCached: false,
    isLiveRecord: true,
    rejectionReasons: [],
    realColumnsInspected,
  };
}
