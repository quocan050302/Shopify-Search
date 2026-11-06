/**
 * SWAI KH-02 — V12.4.3.7.19
 * Exact Provider Observation-to-Raw Evidence Binding & Schema Adapters
 *
 * Implements a reusable, auditable, fail-closed proof function that binds
 * a PROVIDER_API-type time-series observation to immutable raw provider bytes:
 * - Structural verification of supported provider time-series schemas
 * - Byte-level SHA-256 verification against durable receipt/ledger
 * - Exact canonical query/keyword identity (rejects loose token/family overlap)
 * - Exact geographic region matching
 * - Exact point-in-time date and numeric demandValue matching
 * - Multi-series unambiguous indexing and JSON Pointer generation
 * - Chronological and as-of cutoff enforcement (no lookahead / time travel)
 * - Rejection of non-timeseries payloads (ad creatives, HTML PDPs, search results)
 */

import crypto from "node:crypto";
import path from "node:path";
import fs from "node:fs";

export type ProviderTimeseriesCadence = "DAILY" | "WEEKLY" | "MONTHLY" | "HOURLY";

export interface ParsedProviderObservation {
  start: string; // ISO date string YYYY-MM-DD
  end: string;   // ISO date string YYYY-MM-DD
  queryKey: string;
  region: string;
  value: number | null;
  rawRowPointer: string; // JSON Pointer e.g. "/interest_over_time/timeline_data/0/values/0"
  pointIndex: number;
  seriesIndex: number;
}

export interface ParsedProviderSeries {
  sourceKind: string;
  providerSchemaVersion: string;
  providerQuery: string;
  normalizedExactQuery: string;
  region: string;
  cadence: ProviderTimeseriesCadence;
  capturedAt?: string;
  periodStart?: string;
  periodEnd?: string;
  observations: ParsedProviderObservation[];
  rawPayloadHash: string;
  supported: boolean;
  reasonCode?: string;
}

export type ProviderRawRowErrorCode =
  | "RAW_SERIES_MISSING"
  | "UNSUPPORTED_RAW_SCHEMA"
  | "RAW_ROW_NOT_FOUND"
  | "RAW_VALUE_MISMATCH"
  | "RAW_SERIES_IDENTITY_MISMATCH"
  | "REGION_MISMATCH"
  | "POINT_IN_TIME_VIOLATION"
  | "RAW_ROW_AMBIGUOUS"
  | "HASH_MISMATCH"
  | "MISSING_ARTIFACT"
  | "PRODUCT_MISMATCH"
  | "RUN_MISMATCH"
  | "INVALID_NUMERIC_VALUE"
  | "INTERVAL_MISMATCH"
  | "NO_TIMESERIES_SUPPORT";

export interface ProviderObservationVerificationResult {
  verified: boolean;
  errorCode?: ProviderRawRowErrorCode;
  rejectionReason?: string;
  matchedObservation?: ParsedProviderObservation;
  rawRowPointer?: string;
  cadence?: ProviderTimeseriesCadence;
  rawPayloadHash?: string;
}

/**
 * Normalizes a search query strictly to canonical form:
 * - lowercase, trimmed
 * - removes surrounding quotes and punctuation
 * - collapses internal whitespace
 * DOES NOT strip meaningful tokens or perform loose family/category mapping.
 */
export function normalizeCanonicalQuery(query: string | null | undefined): string {
  if (!query) return "";
  return String(query)
    .toLowerCase()
    .replace(/["'“”‘’]/g, "")
    .replace(/[^\p{L}\p{N}\s\-]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Compares two queries for exact or canonical equivalent identity.
 * Rejects semantic family or category token overlap (Defect P1-B fix).
 * E.g.:
 * - "cat water fountain" vs "  Cat Water Fountain  " -> true
 * - "cat water fountain X" vs "cat water fountain Y" -> false
 * - "automatic pet feeder" vs "automatic cat feeder" -> false
 */
export function areExactOrCanonicalEquivalentQueries(
  qA: string | null | undefined,
  qB: string | null | undefined
): boolean {
  const normA = normalizeCanonicalQuery(qA);
  const normB = normalizeCanonicalQuery(qB);
  if (!normA || !normB) return false;
  return normA === normB;
}

/**
 * Helper to parse a date into UTC YYYY-MM-DD.
 * Rejects partial/prefix dates (e.g. "2026-01" vs "2026-01-01").
 */
export function parseUtcIsoDateOnly(dateVal: string | number | Date | null | undefined): string | null {
  if (dateVal === null || dateVal === undefined) return null;

  if (typeof dateVal === "number" || (/^\d+$/.test(String(dateVal).trim()))) {
    const num = Number(dateVal);
    // Detect Unix seconds (~10 digits) vs milliseconds (~13 digits)
    const ms = String(num).length <= 10 ? num * 1000 : num;
    const d = new Date(ms);
    if (isNaN(d.getTime())) return null;
    const year = d.getUTCFullYear();
    if (year < 2000 || year > 2100) return null;
    return d.toISOString().slice(0, 10);
  }

  const str = String(dateVal).trim();
  // Reject prefix-only dates like "2026-01" or "2026"
  if (/^\d{4}-\d{2}$/.test(str) || /^\d{4}$/.test(str)) {
    return null;
  }

  // Range string: "2026-07-01 - 2026-07-07" or "2026-07-01 to 2026-07-07"
  const rangeMatch = str.match(/^(\d{4}-\d{2}-\d{2})\s*(?:-|–|to)\s*(\d{4}-\d{2}-\d{2})/);
  if (rangeMatch) {
    return rangeMatch[1];
  }

  const d = new Date(str);
  if (isNaN(d.getTime())) return null;
  const year = d.getUTCFullYear();
  if (year < 2000 || year > 2100) return null;
  return d.toISOString().slice(0, 10);
}

/**
 * Parses raw JSON provider bytes into a structured ParsedProviderSeries.
 * Fails closed if the payload lacks a supported time series schema.
 */
export function parseProviderTimeseriesPayload(
  rawBytes: Buffer | string,
  options: {
    expectedQuery?: string | null;
    expectedRegion?: string | null;
  } = {}
): ParsedProviderSeries {
  const buf = Buffer.isBuffer(rawBytes) ? rawBytes : Buffer.from(rawBytes, "utf8");
  const rawPayloadHash = crypto.createHash("sha256").update(buf).digest("hex").toLowerCase();

  let rawObj: any;
  try {
    rawObj = JSON.parse(buf.toString("utf8"));
  } catch {
    return {
      sourceKind: "UNKNOWN",
      providerSchemaVersion: "unsupported",
      providerQuery: "",
      normalizedExactQuery: "",
      region: "",
      cadence: "DAILY",
      observations: [],
      rawPayloadHash,
      supported: false,
      reasonCode: "UNSUPPORTED_RAW_SCHEMA",
    };
  }

  if (!rawObj || typeof rawObj !== "object" || Array.isArray(rawObj)) {
    return {
      sourceKind: "UNKNOWN",
      providerSchemaVersion: "unsupported",
      providerQuery: "",
      normalizedExactQuery: "",
      region: "",
      cadence: "DAILY",
      observations: [],
      rawPayloadHash,
      supported: false,
      reasonCode: "UNSUPPORTED_RAW_SCHEMA",
    };
  }

  if (rawObj.error || rawObj.errors) {
    return {
      sourceKind: "UNKNOWN",
      providerSchemaVersion: "error_payload",
      providerQuery: "",
      normalizedExactQuery: "",
      region: "",
      cadence: "DAILY",
      observations: [],
      rawPayloadHash,
      supported: false,
      reasonCode: "UNSUPPORTED_RAW_SCHEMA",
    };
  }

  // Detect non-timeseries schemas (e.g. ad creative archive, PDP scraper HTML/JSON, search SERP)
  const isAdCreative = Boolean(rawObj.ad_archive_id || rawObj.ads || rawObj.page_id || rawObj.creative_body);
  const isPdp = Boolean(rawObj.product_title && rawObj.canonical_pdp_url && !rawObj.interest_over_time && !rawObj.timeline_data);
  if (isAdCreative || isPdp) {
    return {
      sourceKind: isAdCreative ? "AD_CREATIVE" : "PDP_METADATA",
      providerSchemaVersion: "non_timeseries",
      providerQuery: "",
      normalizedExactQuery: "",
      region: "",
      cadence: "DAILY",
      observations: [],
      rawPayloadHash,
      supported: false,
      reasonCode: "NO_TIMESERIES_SUPPORT",
    };
  }

  // Locate timeline_data
  let timelineData: any[] | null = null;
  let sourceKind = "GOOGLE_TRENDS_API";
  let providerSchemaVersion = "serpapi_google_trends_v1";

  if (Array.isArray(rawObj.interest_over_time?.timeline_data)) {
    timelineData = rawObj.interest_over_time.timeline_data;
    sourceKind = "GOOGLE_TRENDS_API";
  } else if (Array.isArray(rawObj.timeline_data)) {
    timelineData = rawObj.timeline_data;
    sourceKind = "GOOGLE_TRENDS_API";
  }

  if (!timelineData) {
    return {
      sourceKind,
      providerSchemaVersion,
      providerQuery: "",
      normalizedExactQuery: "",
      region: "",
      cadence: "DAILY",
      observations: [],
      rawPayloadHash,
      supported: false,
      reasonCode: "RAW_SERIES_MISSING",
    };
  }

  if (timelineData.length === 0) {
    return {
      sourceKind,
      providerSchemaVersion,
      providerQuery: "",
      normalizedExactQuery: "",
      region: "",
      cadence: "DAILY",
      observations: [],
      rawPayloadHash,
      supported: false,
      reasonCode: "RAW_SERIES_MISSING",
    };
  }

  const rawQ = rawObj.search_parameters?.q ? String(rawObj.search_parameters.q).trim() : "";
  const rawGeo = rawObj.search_parameters?.geo ? String(rawObj.search_parameters.geo).trim().toUpperCase() : "";

  // Detect cadence
  let cadence: ProviderTimeseriesCadence = "DAILY";
  if (timelineData.length >= 2) {
    const t0 = Date.parse(timelineData[0].date || timelineData[0].timestamp);
    const t1 = Date.parse(timelineData[1].date || timelineData[1].timestamp);
    if (!isNaN(t0) && !isNaN(t1) && String(timelineData[0].date || "").includes("T")) {
      const diffHours = Math.abs(t1 - t0) / (1000 * 60 * 60);
      if (diffHours > 0 && diffHours <= 4) {
        cadence = "HOURLY";
      } else {
        const diffDays = diffHours / 24;
        if (diffDays >= 6 && diffDays <= 8) {
          cadence = "WEEKLY";
        } else if (diffDays >= 27 && diffDays <= 32) {
          cadence = "MONTHLY";
        }
      }
    } else {
      const d0 = parseUtcIsoDateOnly(timelineData[0].date || timelineData[0].timestamp);
      const d1 = parseUtcIsoDateOnly(timelineData[1].date || timelineData[1].timestamp);
      if (d0 && d1) {
        const diffDays = Math.abs((new Date(d1).getTime() - new Date(d0).getTime()) / (1000 * 60 * 60 * 24));
        if (diffDays >= 6 && diffDays <= 8) {
          cadence = "WEEKLY";
        } else if (diffDays >= 27 && diffDays <= 32) {
          cadence = "MONTHLY";
        } else if (diffDays < 1) {
          cadence = "HOURLY";
        }
      }
    }
  }

  const observations: ParsedProviderObservation[] = [];
  const pointerPrefix = rawObj.interest_over_time ? "/interest_over_time/timeline_data" : "/timeline_data";

  for (let ptIdx = 0; ptIdx < timelineData.length; ptIdx++) {
    const pt = timelineData[ptIdx];
    if (!pt || typeof pt !== "object") continue;

    const startIso = parseUtcIsoDateOnly(pt.date || pt.timestamp);
    if (!startIso) continue;

    // Determine end date based on cadence or range string
    let endIso = startIso;
    if (typeof pt.date === "string") {
      const rangeMatch = pt.date.match(/(\d{4}-\d{2}-\d{2})\s*(?:-|–|to)\s*(\d{4}-\d{2}-\d{2})/);
      if (rangeMatch) {
        endIso = rangeMatch[2];
      }
    }
    if (endIso === startIso && cadence === "WEEKLY") {
      const d = new Date(startIso);
      d.setUTCDate(d.getUTCDate() + 6);
      endIso = d.toISOString().slice(0, 10);
    } else if (endIso === startIso && cadence === "MONTHLY") {
      const d = new Date(startIso);
      d.setUTCMonth(d.getUTCMonth() + 1);
      d.setUTCDate(d.getUTCDate() - 1);
      endIso = d.toISOString().slice(0, 10);
    }

    // Process values array
    if (!Array.isArray(pt.values) || pt.values.length === 0) {
      continue;
    }

    for (let valIdx = 0; valIdx < pt.values.length; valIdx++) {
      const valItem = pt.values[valIdx];
      let queryKey = rawQ;
      let numericVal: number | null = null;

      if (typeof valItem === "number") {
        numericVal = Number.isFinite(valItem) ? valItem : null;
        if (pt.values.length > 1) {
          queryKey = ""; // Unlabeled multi-series cannot be assumed
        }
      } else if (valItem && typeof valItem === "object") {
        if (valItem.query) {
          queryKey = String(valItem.query).trim();
        } else if (pt.values.length > 1) {
          queryKey = ""; // Unlabeled multi-series cannot be assumed
        }
        if (typeof valItem.extracted_value === "number") {
          numericVal = Number.isFinite(valItem.extracted_value) ? valItem.extracted_value : null;
        } else if (valItem.value !== undefined && valItem.value !== null) {
          const parsed = Number(valItem.value);
          numericVal = Number.isFinite(parsed) ? parsed : null;
        }
      }

      const rawRowPointer = `${pointerPrefix}/${ptIdx}/values/${valIdx}`;

      observations.push({
        start: startIso,
        end: endIso,
        queryKey,
        region: rawGeo,
        value: numericVal,
        rawRowPointer,
        pointIndex: ptIdx,
        seriesIndex: valIdx,
      });
    }
  }

  return {
    sourceKind,
    providerSchemaVersion,
    providerQuery: rawQ,
    normalizedExactQuery: normalizeCanonicalQuery(rawQ),
    region: rawGeo,
    cadence,
    capturedAt: rawObj.search_metadata?.created_at || undefined,
    periodStart: observations[0]?.start,
    periodEnd: observations[observations.length - 1]?.end,
    observations,
    rawPayloadHash,
    supported: true,
  };
}

export interface VerifyProviderObservationParams {
  rawBytes: Buffer | string;
  receipt?: {
    receiptId?: string;
    rawResponseSha256?: string;
    region?: string | null;
    targetProductOrKeyword?: string | null;
    productId?: string | null;
    workspaceId?: string | null;
    researchRunId?: string | null;
    capturedAt?: string | Date | null;
    originKind?: string;
    eligible?: boolean;
    commitState?: string;
    transportStatus?: number;
    signature?: string;
    attestation?: any;
  } | null;
  observation: {
    keyword?: string | null;
    region?: string | null;
    periodStart: string | Date;
    periodEnd?: string | Date | null;
    demandValue?: number | null;
    productId?: string | null;
    workspaceId?: string | null;
    researchRunId?: string | null;
    asOfTimestamp?: string | Date | null;
  };
  options?: {
    strictLiveOrigin?: boolean;
    asOfTimestamp?: string | Date | null;
  };
}

/**
 * Strict, fail-closed verification of a PROVIDER_API observation against raw provider bytes.
 *
 * Enforces:
 * 1. Byte SHA-256 agreement with receipt
 * 2. Supported time-series schema with nonempty timeline_data
 * 3. Exact canonical query identity (rejects loose token/family overlap)
 * 4. Region agreement
 * 5. Scope agreement (product, workspace, run)
 * 6. Point-in-time and chronology validity
 * 7. Exact date point existence in raw timeline_data
 * 8. Exact numeric demandValue match on the matching date
 * 9. Cadence and interval agreement
 * 10. Rejection of ambiguous multiple matching series
 */
export function verifyProviderObservationAgainstRawArtifact(
  params: VerifyProviderObservationParams
): ProviderObservationVerificationResult {
  const { rawBytes, receipt, observation, options = {} } = params;

  if (!rawBytes || (Buffer.isBuffer(rawBytes) ? rawBytes.length === 0 : String(rawBytes).trim().length === 0)) {
    return {
      verified: false,
      errorCode: "MISSING_ARTIFACT",
      rejectionReason: "Raw provider artifact bytes are empty or missing.",
    };
  }

  const buf = Buffer.isBuffer(rawBytes) ? rawBytes : Buffer.from(rawBytes, "utf8");
  const computedSha = crypto.createHash("sha256").update(buf).digest("hex").toLowerCase();

  // 1. Verify byte SHA against receipt
  if (receipt?.rawResponseSha256) {
    const expectedSha = receipt.rawResponseSha256.toLowerCase();
    if (computedSha !== expectedSha) {
      return {
        verified: false,
        errorCode: "HASH_MISMATCH",
        rejectionReason: `Raw artifact bytes SHA-256 ('${computedSha.slice(0, 12)}...') does not match receipt hash ('${expectedSha.slice(0, 12)}...').`,
        rawPayloadHash: computedSha,
      };
    }
  }

  // 2. Parse raw payload
  let rawJson: any;
  try {
    rawJson = JSON.parse(buf.toString("utf8"));
  } catch {
    return {
      verified: false,
      errorCode: "UNSUPPORTED_RAW_SCHEMA",
      rejectionReason: "Raw provider artifact is not valid JSON.",
      rawPayloadHash: computedSha,
    };
  }

  if (!rawJson || typeof rawJson !== "object" || Array.isArray(rawJson)) {
    return {
      verified: false,
      errorCode: "UNSUPPORTED_RAW_SCHEMA",
      rejectionReason: "Raw provider artifact root is not a JSON object.",
      rawPayloadHash: computedSha,
    };
  }

  // Check for error in payload
  if (rawJson.error || rawJson.errors) {
    return {
      verified: false,
      errorCode: "UNSUPPORTED_RAW_SCHEMA",
      rejectionReason: `Raw provider payload contains upstream error: ${rawJson.error || JSON.stringify(rawJson.errors)}`,
      rawPayloadHash: computedSha,
    };
  }

  // Check for non-timeseries responses (ad creative, PDP HTML/JSON)
  if (
    rawJson.ad_archive_id ||
    rawJson.ads ||
    (rawJson.product_title && rawJson.canonical_pdp_url && !rawJson.interest_over_time && !rawJson.timeline_data)
  ) {
    return {
      verified: false,
      errorCode: "NO_TIMESERIES_SUPPORT",
      rejectionReason: "Raw payload is a non-timeseries provider response (ad creative or merchant PDP) and cannot establish demand observations.",
      rawPayloadHash: computedSha,
    };
  }

  // Check timeline_data presence
  let rawTimeline = rawJson.interest_over_time?.timeline_data ?? rawJson.timeline_data;
  if (!Array.isArray(rawTimeline)) {
    return {
      verified: false,
      errorCode: "RAW_SERIES_MISSING",
      rejectionReason: "Raw provider payload lacks 'interest_over_time.timeline_data' array.",
      rawPayloadHash: computedSha,
    };
  }

  if (rawTimeline.length === 0) {
    return {
      verified: false,
      errorCode: "RAW_SERIES_MISSING",
      rejectionReason: "Raw provider timeline_data array is empty.",
      rawPayloadHash: computedSha,
    };
  }

  // Check values presence in rawTimeline
  const hasValuesField = rawTimeline.some((pt: any) => pt && Array.isArray(pt.values));
  if (!hasValuesField) {
    return {
      verified: false,
      errorCode: "UNSUPPORTED_RAW_SCHEMA",
      rejectionReason: "Raw provider timeline_data points lack 'values' array.",
      rawPayloadHash: computedSha,
    };
  }

  // 3. Query identity check (Defect P1-B fix: strict canonical equality, no loose family overlap)
  // R05: receipt only q when raw q missing is rejected unless supported signed schema proves identity
  const hasAttestedIdentity = Boolean(
    receipt?.signature ||
    receipt?.attestation ||
    (receipt?.originKind === "ACTUAL_PROVIDER_INVOCATION" && receipt?.targetProductOrKeyword)
  );

  const rawQuery =
    (rawJson.search_parameters?.q ? String(rawJson.search_parameters.q).trim() : "") ||
    (hasAttestedIdentity && receipt?.targetProductOrKeyword ? String(receipt.targetProductOrKeyword).trim() : "");
  const obsKeyword = String(observation.keyword || "").trim();

  // Check if payload has nested multi-series points with explicit query attribution matching obsKeyword
  const hasMatchingNestedSeries = rawTimeline.some((pt: any) =>
    Array.isArray(pt?.values) &&
    pt.values.some((v: any) => v && typeof v === "object" && v.query && areExactOrCanonicalEquivalentQueries(v.query, obsKeyword))
  );

  if (!rawQuery && !hasMatchingNestedSeries) {
    return {
      verified: false,
      errorCode: "RAW_SERIES_IDENTITY_MISMATCH",
      rejectionReason: "Raw provider artifact lacks authoritative query specification ('search_parameters.q' or point 'query' attribute).",
      rawPayloadHash: computedSha,
    };
  }

  if (obsKeyword && rawQuery && !areExactOrCanonicalEquivalentQueries(obsKeyword, rawQuery) && !hasMatchingNestedSeries) {
    return {
      verified: false,
      errorCode: "RAW_SERIES_IDENTITY_MISMATCH",
      rejectionReason: `Observation keyword '${obsKeyword}' does not match raw provider query '${rawQuery}' (loose token/family overlap rejected).`,
      rawPayloadHash: computedSha,
    };
  }

  // 4. Region check
  const rawGeo = String(rawJson.search_parameters?.geo || receipt?.region || "US").trim().toUpperCase();
  const obsRegion = String(observation.region || "US").trim().toUpperCase();
  if (rawGeo && obsRegion && rawGeo !== obsRegion) {
    return {
      verified: false,
      errorCode: "REGION_MISMATCH",
      rejectionReason: `Observation region '${obsRegion}' does not match raw provider geo '${rawGeo}'.`,
      rawPayloadHash: computedSha,
    };
  }

  // 5. Scope check
  if (receipt?.productId && observation.productId && receipt.productId !== observation.productId) {
    return {
      verified: false,
      errorCode: "PRODUCT_MISMATCH",
      rejectionReason: `Receipt productId '${receipt.productId}' contradicts observation productId '${observation.productId}'.`,
      rawPayloadHash: computedSha,
    };
  }

  if (receipt?.workspaceId && observation.workspaceId && receipt.workspaceId !== observation.workspaceId) {
    return {
      verified: false,
      errorCode: "RUN_MISMATCH",
      rejectionReason: `Receipt workspaceId '${receipt.workspaceId}' contradicts observation workspaceId '${observation.workspaceId}'.`,
      rawPayloadHash: computedSha,
    };
  }

  if (receipt?.researchRunId && observation.researchRunId && receipt.researchRunId !== observation.researchRunId) {
    return {
      verified: false,
      errorCode: "RUN_MISMATCH",
      rejectionReason: `Receipt researchRunId '${receipt.researchRunId}' contradicts observation researchRunId '${observation.researchRunId}'.`,
      rawPayloadHash: computedSha,
    };
  }

  // 6. Chronology and point-in-time check
  const now = Date.now();
  if (receipt?.capturedAt) {
    const capMs = new Date(receipt.capturedAt).getTime();
    if (!isNaN(capMs) && capMs > now + 60000) {
      return {
        verified: false,
        errorCode: "POINT_IN_TIME_VIOLATION",
        rejectionReason: `Receipt capturedAt '${receipt.capturedAt}' is in the future.`,
        rawPayloadHash: computedSha,
      };
    }
  }

  const effectiveAsOf = options.asOfTimestamp || observation.asOfTimestamp;
  if (effectiveAsOf) {
    const asOfMs = new Date(effectiveAsOf).getTime();
    if (!isNaN(asOfMs)) {
      if (receipt?.capturedAt && new Date(receipt.capturedAt).getTime() > asOfMs) {
        return {
          verified: false,
          errorCode: "POINT_IN_TIME_VIOLATION",
          rejectionReason: `Receipt capturedAt '${receipt.capturedAt}' is after asOf cutoff '${effectiveAsOf}'.`,
          rawPayloadHash: computedSha,
        };
      }
      const obsDateMs = new Date(observation.periodStart).getTime();
      if (!isNaN(obsDateMs) && obsDateMs > asOfMs) {
        return {
          verified: false,
          errorCode: "POINT_IN_TIME_VIOLATION",
          rejectionReason: `Observation periodStart '${observation.periodStart}' is after asOf cutoff '${effectiveAsOf}'.`,
          rawPayloadHash: computedSha,
        };
      }
    }
  }

  // 7. Parse series observations
  const parsedSeries = parseProviderTimeseriesPayload(buf, {
    expectedQuery: obsKeyword || rawQuery,
    expectedRegion: obsRegion,
  });

  if (!parsedSeries.supported) {
    return {
      verified: false,
      errorCode: (parsedSeries.reasonCode as ProviderRawRowErrorCode) || "UNSUPPORTED_RAW_SCHEMA",
      rejectionReason: `Provider time-series parsing failed: ${parsedSeries.reasonCode}`,
      rawPayloadHash: computedSha,
    };
  }

  // 8. Find target date in parsed series
  let targetDateStr: string;
  if (observation.periodStart !== undefined && observation.periodStart !== null && observation.periodStart !== "") {
    const parsed = parseUtcIsoDateOnly(observation.periodStart);
    if (!parsed) {
      return {
        verified: false,
        errorCode: "RAW_ROW_NOT_FOUND",
        rejectionReason: `Invalid or incomplete observation periodStart date: '${observation.periodStart}'.`,
        rawPayloadHash: computedSha,
      };
    }
    targetDateStr = parsed;
  } else {
    if (observation.demandValue !== undefined && observation.demandValue !== null) {
      const expectedVal = Number(observation.demandValue);
      const matched = parsedSeries.observations.find(
        (obs) =>
          obs.value === expectedVal &&
          obs.queryKey &&
          areExactOrCanonicalEquivalentQueries(obs.queryKey, obsKeyword || rawQuery)
      );
      if (matched) {
        return {
          verified: true,
          matchedObservation: matched,
          rawRowPointer: matched.rawRowPointer,
          cadence: parsedSeries.cadence,
          rawPayloadHash: computedSha,
        };
      }
      return {
        verified: false,
        errorCode: "RAW_VALUE_MISMATCH",
        rejectionReason: `Observation demandValue (${expectedVal}) for query '${obsKeyword || rawQuery}' does not match any point in raw provider timeline_data.`,
        rawPayloadHash: computedSha,
      };
    }
    return {
      verified: false,
      errorCode: "RAW_ROW_NOT_FOUND",
      rejectionReason: "Observation periodStart date is missing.",
      rawPayloadHash: computedSha,
    };
  }

  // Check if multiple series exist without query labels
  const firstPt = parsedSeries.observations[0];
  const pointsOnDate = parsedSeries.observations.filter((obs) => obs.start === targetDateStr);

  if (pointsOnDate.length === 0) {
    // Check if the value happens to appear on a different date only
    if (observation.demandValue !== undefined && observation.demandValue !== null) {
      const valOnOtherDate = parsedSeries.observations.find((obs) => obs.value === Number(observation.demandValue));
      if (valOnOtherDate) {
        return {
          verified: false,
          errorCode: "RAW_ROW_NOT_FOUND",
          rejectionReason: `Target observation date '${targetDateStr}' not found in raw timeline_data (value ${observation.demandValue} exists only on ${valOnOtherDate.start}).`,
          rawPayloadHash: computedSha,
        };
      }
    }
    return {
      verified: false,
      errorCode: "RAW_ROW_NOT_FOUND",
      rejectionReason: `Target observation date '${targetDateStr}' not found in raw provider timeline_data.`,
      rawPayloadHash: computedSha,
    };
  }

  // Check for ambiguous multi-series on the same date without query distinction
  let matchedPoint: ParsedProviderObservation | null = null;

  const matchingQueryPoints = pointsOnDate.filter((p) =>
    p.queryKey && areExactOrCanonicalEquivalentQueries(p.queryKey, obsKeyword || rawQuery)
  );

  if (pointsOnDate.length === 1) {
    const singlePt = pointsOnDate[0];
    if (!singlePt.queryKey || !areExactOrCanonicalEquivalentQueries(singlePt.queryKey, obsKeyword || rawQuery)) {
      return {
        verified: false,
        errorCode: "RAW_SERIES_IDENTITY_MISMATCH",
        rejectionReason: `Selected raw point query '${singlePt.queryKey || "unlabeled"}' does not match expected query '${obsKeyword || rawQuery}'.`,
        rawPayloadHash: computedSha,
      };
    }
    matchedPoint = singlePt;
  } else {
    // Multiple points on same date: could be multi-keyword series or duplicate timestamps
    if (matchingQueryPoints.length === 1) {
      matchedPoint = matchingQueryPoints[0];
    } else if (matchingQueryPoints.length === 0) {
      const hasUnlabeled = pointsOnDate.some((p) => !p.queryKey);
      if (hasUnlabeled) {
        return {
          verified: false,
          errorCode: "RAW_ROW_AMBIGUOUS",
          rejectionReason: `Observation date '${targetDateStr}' has multiple ambiguous unlabeled points in raw payload.`,
          rawPayloadHash: computedSha,
        };
      }
      // Date exists in raw payload, but ONLY for a DIFFERENT keyword series
      return {
        verified: false,
        errorCode: "RAW_SERIES_IDENTITY_MISMATCH",
        rejectionReason: `Observation date '${targetDateStr}' exists only for other series queries (${pointsOnDate.map((p) => p.queryKey || "unlabeled").join(", ")}), not '${obsKeyword}'.`,
        rawPayloadHash: computedSha,
      };
    } else {
      // Multiple points for the same date and same query: check if values conflict
      const uniqueVals = new Set(matchingQueryPoints.map((p) => p.value));
      if (uniqueVals.size > 1) {
        return {
          verified: false,
          errorCode: "RAW_ROW_AMBIGUOUS",
          rejectionReason: `Multiple conflicting raw points on date '${targetDateStr}' for query '${obsKeyword}': [${Array.from(uniqueVals).join(", ")}].`,
          rawPayloadHash: computedSha,
        };
      }
      matchedPoint = matchingQueryPoints[0];
    }
  }

  // 9. Interval and Cadence check
  if (observation.periodEnd) {
    const endIso = parseUtcIsoDateOnly(observation.periodEnd);
    if (endIso) {
      if (matchedPoint.end && endIso !== matchedPoint.end) {
        return {
          verified: false,
          errorCode: "INTERVAL_MISMATCH",
          rejectionReason: `Observation periodEnd '${endIso}' does not match raw point interval end '${matchedPoint.end}'.`,
          rawPayloadHash: computedSha,
        };
      }
      const pStartMs = new Date(targetDateStr).getTime();
      const pEndMs = new Date(endIso).getTime();
      const diffDays = Math.round((pEndMs - pStartMs) / (1000 * 60 * 60 * 24));

      if (parsedSeries.cadence === "WEEKLY" && (diffDays < 6 || diffDays > 7)) {
        return {
          verified: false,
          errorCode: "INTERVAL_MISMATCH",
          rejectionReason: `Weekly provider cadence requires 6-7 day interval; received ${diffDays} days (${targetDateStr} to ${endIso}).`,
          rawPayloadHash: computedSha,
        };
      }
      if (parsedSeries.cadence === "DAILY" && parsedSeries.observations.length > 1 && diffDays > 1) {
        return {
          verified: false,
          errorCode: "INTERVAL_MISMATCH",
          rejectionReason: `Daily provider cadence cannot match multi-day interval (${diffDays} days).`,
          rawPayloadHash: computedSha,
        };
      }
    }
  }

  // 10. Value matching
  if (matchedPoint.value === null || !Number.isFinite(matchedPoint.value) || matchedPoint.value < 0 || matchedPoint.value > 100) {
    return {
      verified: false,
      errorCode: "INVALID_NUMERIC_VALUE",
      rejectionReason: `Raw datapoint on '${targetDateStr}' has invalid numeric value: ${matchedPoint.value}.`,
      rawPayloadHash: computedSha,
    };
  }

  if (observation.demandValue !== undefined && observation.demandValue !== null) {
    const expectedVal = Number(observation.demandValue);
    if (!Number.isFinite(expectedVal) || expectedVal < 0 || expectedVal > 100) {
      return {
        verified: false,
        errorCode: "INVALID_NUMERIC_VALUE",
        rejectionReason: `Observation demandValue '${observation.demandValue}' is not a valid 0-100 number.`,
        rawPayloadHash: computedSha,
      };
    }

    if (matchedPoint.value !== expectedVal) {
      return {
        verified: false,
        errorCode: "RAW_VALUE_MISMATCH",
        rejectionReason: `Observation demandValue (${expectedVal}) does not match raw value (${matchedPoint.value}) on date '${targetDateStr}'.`,
        rawPayloadHash: computedSha,
        matchedObservation: matchedPoint,
      };
    }
  }

  return {
    verified: true,
    matchedObservation: matchedPoint,
    rawRowPointer: matchedPoint.rawRowPointer,
    cadence: parsedSeries.cadence,
    rawPayloadHash: computedSha,
  };
}
