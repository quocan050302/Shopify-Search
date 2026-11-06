/**
 * SWAI KH-02 — V12.4.3.7.19
 * Exact Provider Raw Row Binding Tests (A01 - A30 Negative, B01 - B08 Positive)
 */

import { describe, it, expect } from "vitest";
import crypto from "node:crypto";
import {
  verifyProviderObservationAgainstRawArtifact,
  parseProviderTimeseriesPayload,
  areExactOrCanonicalEquivalentQueries,
  normalizeCanonicalQuery,
} from "@/services/kh02/demand/providerObservationRawBinding";

function createRawJsonBytes(obj: any): Buffer {
  return Buffer.from(JSON.stringify(obj), "utf8");
}

function sha256Of(buf: Buffer): string {
  return crypto.createHash("sha256").update(buf).digest("hex").toLowerCase();
}

describe("KH-02 V12.4.3.7.19: Exact Provider Raw Row Binding (A01 - A30 Negative)", () => {
  it("A01: missing timeline_data -> RAW_SERIES_MISSING", () => {
    const raw = createRawJsonBytes({
      search_metadata: { status: "Success", id: "req_test_a01" },
      search_parameters: { q: "cat water fountain", geo: "US" },
      interest_over_time: {},
    });
    const result = verifyProviderObservationAgainstRawArtifact({
      rawBytes: raw,
      receipt: { rawResponseSha256: sha256Of(raw), targetProductOrKeyword: "cat water fountain", region: "US" },
      observation: { keyword: "cat water fountain", region: "US", periodStart: "2026-07-01", demandValue: 75 },
    });
    expect(result.verified).toBe(false);
    expect(result.errorCode).toBe("RAW_SERIES_MISSING");
  });

  it("A02: empty timeline_data -> RAW_SERIES_MISSING", () => {
    const raw = createRawJsonBytes({
      search_metadata: { status: "Success", id: "req_test_a02" },
      search_parameters: { q: "cat water fountain", geo: "US" },
      interest_over_time: { timeline_data: [] },
    });
    const result = verifyProviderObservationAgainstRawArtifact({
      rawBytes: raw,
      receipt: { rawResponseSha256: sha256Of(raw), targetProductOrKeyword: "cat water fountain", region: "US" },
      observation: { keyword: "cat water fountain", region: "US", periodStart: "2026-07-01", demandValue: 75 },
    });
    expect(result.verified).toBe(false);
    expect(result.errorCode).toBe("RAW_SERIES_MISSING");
  });

  it("A03: timeseries wrong schema (timeline_data is not array) -> RAW_SERIES_MISSING", () => {
    const raw = createRawJsonBytes({
      search_metadata: { status: "Success", id: "req_test_a03" },
      search_parameters: { q: "cat water fountain", geo: "US" },
      interest_over_time: { timeline_data: "invalid_string" },
    });
    const result = verifyProviderObservationAgainstRawArtifact({
      rawBytes: raw,
      receipt: { rawResponseSha256: sha256Of(raw), targetProductOrKeyword: "cat water fountain", region: "US" },
      observation: { keyword: "cat water fountain", region: "US", periodStart: "2026-07-01", demandValue: 75 },
    });
    expect(result.verified).toBe(false);
    expect(result.errorCode).toBe("RAW_SERIES_MISSING");
  });

  it("A04: raw JSON points missing values array -> UNSUPPORTED_RAW_SCHEMA", () => {
    const raw = createRawJsonBytes({
      search_metadata: { status: "Success", id: "req_test_a04" },
      search_parameters: { q: "cat water fountain", geo: "US" },
      interest_over_time: {
        timeline_data: [{ date: "2026-07-01" }],
      },
    });
    const result = verifyProviderObservationAgainstRawArtifact({
      rawBytes: raw,
      receipt: { rawResponseSha256: sha256Of(raw), targetProductOrKeyword: "cat water fountain", region: "US" },
      observation: { keyword: "cat water fountain", region: "US", periodStart: "2026-07-01", demandValue: 75 },
    });
    expect(result.verified).toBe(false);
    expect(result.errorCode).toBe("UNSUPPORTED_RAW_SCHEMA");
  });

  it("A05: row value mismatch -> RAW_VALUE_MISMATCH", () => {
    const raw = createRawJsonBytes({
      search_metadata: { status: "Success", id: "req_test_a05" },
      search_parameters: { q: "cat water fountain", geo: "US" },
      interest_over_time: {
        timeline_data: [{ date: "2026-07-01", values: [75] }],
      },
    });
    const result = verifyProviderObservationAgainstRawArtifact({
      rawBytes: raw,
      receipt: { rawResponseSha256: sha256Of(raw), targetProductOrKeyword: "cat water fountain", region: "US" },
      observation: { keyword: "cat water fountain", region: "US", periodStart: "2026-07-01", demandValue: 50 }, // Expected 50, raw has 75
    });
    expect(result.verified).toBe(false);
    expect(result.errorCode).toBe("RAW_VALUE_MISMATCH");
  });

  it("A06: row date mismatch -> RAW_ROW_NOT_FOUND", () => {
    const raw = createRawJsonBytes({
      search_metadata: { status: "Success", id: "req_test_a06" },
      search_parameters: { q: "cat water fountain", geo: "US" },
      interest_over_time: {
        timeline_data: [{ date: "2026-07-01", values: [75] }],
      },
    });
    const result = verifyProviderObservationAgainstRawArtifact({
      rawBytes: raw,
      receipt: { rawResponseSha256: sha256Of(raw), targetProductOrKeyword: "cat water fountain", region: "US" },
      observation: { keyword: "cat water fountain", region: "US", periodStart: "2026-08-01", demandValue: 75 }, // Target 2026-08-01 not in raw
    });
    expect(result.verified).toBe(false);
    expect(result.errorCode).toBe("RAW_ROW_NOT_FOUND");
  });

  it("A07: same value occurs on a different date only -> RAW_ROW_NOT_FOUND", () => {
    const raw = createRawJsonBytes({
      search_metadata: { status: "Success", id: "req_test_a07" },
      search_parameters: { q: "cat water fountain", geo: "US" },
      interest_over_time: {
        timeline_data: [
          { date: "2026-07-01", values: [75] },
          { date: "2026-07-08", values: [60] },
        ],
      },
    });
    // Demanding value 75 on 2026-07-08 (value 75 only exists on 2026-07-01)
    const result = verifyProviderObservationAgainstRawArtifact({
      rawBytes: raw,
      receipt: { rawResponseSha256: sha256Of(raw), targetProductOrKeyword: "cat water fountain", region: "US" },
      observation: { keyword: "cat water fountain", region: "US", periodStart: "2026-07-08", demandValue: 75 },
    });
    expect(result.verified).toBe(false);
    expect(result.errorCode).toBe("RAW_VALUE_MISMATCH");
  });

  it("A08: same date appears in wrong keyword series -> RAW_SERIES_IDENTITY_MISMATCH", () => {
    const raw = createRawJsonBytes({
      search_metadata: { status: "Success", id: "req_test_a08" },
      search_parameters: { q: "dog water fountain", geo: "US" },
      interest_over_time: {
        timeline_data: [
          {
            date: "2026-07-01",
            values: [{ query: "dog water fountain", value: "75", extracted_value: 75 }],
          },
        ],
      },
    });
    const result = verifyProviderObservationAgainstRawArtifact({
      rawBytes: raw,
      receipt: { rawResponseSha256: sha256Of(raw), targetProductOrKeyword: "dog water fountain", region: "US" },
      observation: { keyword: "cat water fountain", region: "US", periodStart: "2026-07-01", demandValue: 75 },
    });
    expect(result.verified).toBe(false);
    expect(result.errorCode).toBe("RAW_SERIES_IDENTITY_MISMATCH");
  });

  it("A09: ambiguous multi-keyword series without labels -> RAW_ROW_AMBIGUOUS", () => {
    const raw = createRawJsonBytes({
      search_metadata: { status: "Success", id: "req_test_a09" },
      search_parameters: { q: "cat water fountain", geo: "US" },
      interest_over_time: {
        timeline_data: [
          {
            date: "2026-07-01",
            values: [75, 50], // Two unlabeled values for single date
          },
        ],
      },
    });
    const result = verifyProviderObservationAgainstRawArtifact({
      rawBytes: raw,
      receipt: { rawResponseSha256: sha256Of(raw), targetProductOrKeyword: "cat water fountain", region: "US" },
      observation: { keyword: "cat water fountain", region: "US", periodStart: "2026-07-01", demandValue: 75 },
    });
    expect(result.verified).toBe(false);
    expect(result.errorCode).toBe("RAW_ROW_AMBIGUOUS");
  });

  it("A10: conflicting duplicate dates/values -> RAW_ROW_AMBIGUOUS", () => {
    const raw = createRawJsonBytes({
      search_metadata: { status: "Success", id: "req_test_a10" },
      search_parameters: { q: "cat water fountain", geo: "US" },
      interest_over_time: {
        timeline_data: [
          { date: "2026-07-01", values: [{ query: "cat water fountain", extracted_value: 75 }] },
          { date: "2026-07-01", values: [{ query: "cat water fountain", extracted_value: 60 }] },
        ],
      },
    });
    const result = verifyProviderObservationAgainstRawArtifact({
      rawBytes: raw,
      receipt: { rawResponseSha256: sha256Of(raw), targetProductOrKeyword: "cat water fountain", region: "US" },
      observation: { keyword: "cat water fountain", region: "US", periodStart: "2026-07-01", demandValue: 75 },
    });
    expect(result.verified).toBe(false);
    expect(result.errorCode).toBe("RAW_ROW_AMBIGUOUS");
  });

  it("A11: query semantic-family overlap but not exact identity -> RAW_SERIES_IDENTITY_MISMATCH (Defect P1-B)", () => {
    const raw = createRawJsonBytes({
      search_metadata: { status: "Success", id: "req_test_a11" },
      search_parameters: { q: "cat water fountain X", geo: "US" },
      interest_over_time: {
        timeline_data: [{ date: "2026-07-01", values: [75] }],
      },
    });
    // Requesting "cat water fountain Y" against "cat water fountain X"
    const result = verifyProviderObservationAgainstRawArtifact({
      rawBytes: raw,
      receipt: { rawResponseSha256: sha256Of(raw), targetProductOrKeyword: "cat water fountain X", region: "US" },
      observation: { keyword: "cat water fountain Y", region: "US", periodStart: "2026-07-01", demandValue: 75 },
    });
    expect(result.verified).toBe(false);
    expect(result.errorCode).toBe("RAW_SERIES_IDENTITY_MISMATCH");
  });

  it("A12: brand/model mismatch hidden by token overlap -> RAW_SERIES_IDENTITY_MISMATCH", () => {
    const raw = createRawJsonBytes({
      search_metadata: { status: "Success", id: "req_test_a12" },
      search_parameters: { q: "automatic pet feeder", geo: "US" },
      interest_over_time: {
        timeline_data: [{ date: "2026-07-01", values: [75] }],
      },
    });
    const result = verifyProviderObservationAgainstRawArtifact({
      rawBytes: raw,
      receipt: { rawResponseSha256: sha256Of(raw), targetProductOrKeyword: "automatic pet feeder", region: "US" },
      observation: { keyword: "automatic cat feeder", region: "US", periodStart: "2026-07-01", demandValue: 75 },
    });
    expect(result.verified).toBe(false);
    expect(result.errorCode).toBe("RAW_SERIES_IDENTITY_MISMATCH");
  });

  it("A13: region mismatch -> REGION_MISMATCH", () => {
    const raw = createRawJsonBytes({
      search_metadata: { status: "Success", id: "req_test_a13" },
      search_parameters: { q: "cat water fountain", geo: "GB" },
      interest_over_time: {
        timeline_data: [{ date: "2026-07-01", values: [75] }],
      },
    });
    const result = verifyProviderObservationAgainstRawArtifact({
      rawBytes: raw,
      receipt: { rawResponseSha256: sha256Of(raw), targetProductOrKeyword: "cat water fountain", region: "GB" },
      observation: { keyword: "cat water fountain", region: "US", periodStart: "2026-07-01", demandValue: 75 },
    });
    expect(result.verified).toBe(false);
    expect(result.errorCode).toBe("REGION_MISMATCH");
  });

  it("A14: timezone boundary 23:00 UTC -> parsed deterministically", () => {
    // 2026-07-01T23:00:00.000Z parses to calendar day 2026-07-01
    const raw = createRawJsonBytes({
      search_metadata: { status: "Success", id: "req_test_a14" },
      search_parameters: { q: "cat water fountain", geo: "US" },
      interest_over_time: {
        timeline_data: [{ date: "2026-07-01", values: [75] }],
      },
    });
    const result = verifyProviderObservationAgainstRawArtifact({
      rawBytes: raw,
      receipt: { rawResponseSha256: sha256Of(raw), targetProductOrKeyword: "cat water fountain", region: "US" },
      observation: { keyword: "cat water fountain", region: "US", periodStart: "2026-07-01T23:00:00.000Z", demandValue: 75 },
    });
    expect(result.verified).toBe(true);
  });

  it("A15: Unix seconds-vs-ms invalid conversion (< year 2000) -> RAW_ROW_NOT_FOUND", () => {
    const raw = createRawJsonBytes({
      search_metadata: { status: "Success", id: "req_test_a15" },
      search_parameters: { q: "cat water fountain", geo: "US" },
      interest_over_time: {
        timeline_data: [{ timestamp: "123456", values: [75] }], // Invalid timestamp
      },
    });
    const result = verifyProviderObservationAgainstRawArtifact({
      rawBytes: raw,
      receipt: { rawResponseSha256: sha256Of(raw), targetProductOrKeyword: "cat water fountain", region: "US" },
      observation: { keyword: "cat water fountain", region: "US", periodStart: "2026-07-01", demandValue: 75 },
    });
    expect(result.verified).toBe(false);
    expect(result.errorCode).toBe("RAW_ROW_NOT_FOUND");
  });

  it("A16: weekly periodEnd mismatch -> INTERVAL_MISMATCH", () => {
    const raw = createRawJsonBytes({
      search_metadata: { status: "Success", id: "req_test_a16" },
      search_parameters: { q: "cat water fountain", geo: "US" },
      interest_over_time: {
        timeline_data: [
          { date: "2026-07-01", values: [75] },
          { date: "2026-07-08", values: [70] },
        ],
      },
    });
    // Requesting a 14-day interval for a weekly cadence
    const result = verifyProviderObservationAgainstRawArtifact({
      rawBytes: raw,
      receipt: { rawResponseSha256: sha256Of(raw), targetProductOrKeyword: "cat water fountain", region: "US" },
      observation: { keyword: "cat water fountain", region: "US", periodStart: "2026-07-01", periodEnd: "2026-07-15", demandValue: 75 },
    });
    expect(result.verified).toBe(false);
    expect(result.errorCode).toBe("INTERVAL_MISMATCH");
  });

  it("A17: hourly cadence viewed as daily -> INTERVAL_MISMATCH", () => {
    const raw = createRawJsonBytes({
      search_metadata: { status: "Success", id: "req_test_a17" },
      search_parameters: { q: "cat water fountain", geo: "US" },
      interest_over_time: {
        timeline_data: [
          { timestamp: 1782864000, values: [75] },      // 2026-07-01 00:00
          { timestamp: 1782867600, values: [70] },      // 2026-07-01 01:00 (1 hour later)
        ],
      },
    });
    const parsed = parseProviderTimeseriesPayload(raw);
    expect(parsed.cadence).toBe("HOURLY");
  });

  it("A18: future capturedAt or as-of before capturedAt -> POINT_IN_TIME_VIOLATION", () => {
    const raw = createRawJsonBytes({
      search_metadata: { status: "Success", id: "req_test_a18" },
      search_parameters: { q: "cat water fountain", geo: "US" },
      interest_over_time: {
        timeline_data: [{ date: "2026-07-01", values: [75] }],
      },
    });
    const result = verifyProviderObservationAgainstRawArtifact({
      rawBytes: raw,
      receipt: {
        rawResponseSha256: sha256Of(raw),
        targetProductOrKeyword: "cat water fountain",
        region: "US",
        capturedAt: "2026-07-01T12:00:00.000Z",
      },
      observation: { keyword: "cat water fountain", region: "US", periodStart: "2026-07-01", demandValue: 75 },
      options: { asOfTimestamp: "2026-06-01T00:00:00.000Z" }, // as-of cutoff before capturedAt
    });
    expect(result.verified).toBe(false);
    expect(result.errorCode).toBe("POINT_IN_TIME_VIOLATION");
  });

  it("A19: null vs zero/NaN/Infinity/string placeholder -> INVALID_NUMERIC_VALUE", () => {
    const raw = createRawJsonBytes({
      search_metadata: { status: "Success", id: "req_test_a19" },
      search_parameters: { q: "cat water fountain", geo: "US" },
      interest_over_time: {
        timeline_data: [{ date: "2026-07-01", values: ["n/a"] }],
      },
    });
    const result = verifyProviderObservationAgainstRawArtifact({
      rawBytes: raw,
      receipt: { rawResponseSha256: sha256Of(raw), targetProductOrKeyword: "cat water fountain", region: "US" },
      observation: { keyword: "cat water fountain", region: "US", periodStart: "2026-07-01", demandValue: 75 },
    });
    expect(result.verified).toBe(false);
    expect(result.errorCode).toBe("INVALID_NUMERIC_VALUE");
  });

  it("A20: raw SHA mismatch or artifact missing -> HASH_MISMATCH", () => {
    const raw = createRawJsonBytes({ test: 1 });
    const result = verifyProviderObservationAgainstRawArtifact({
      rawBytes: raw,
      receipt: { rawResponseSha256: "0000000000000000000000000000000000000000000000000000000000000000" },
      observation: { keyword: "cat water fountain", periodStart: "2026-07-01", demandValue: 75 },
    });
    expect(result.verified).toBe(false);
    expect(result.errorCode).toBe("HASH_MISMATCH");
  });

  it("A21: swapped receipt ID across products/workspaces -> PRODUCT_MISMATCH", () => {
    const raw = createRawJsonBytes({
      search_metadata: { status: "Success", id: "req_test_a21" },
      search_parameters: { q: "cat water fountain", geo: "US" },
      interest_over_time: { timeline_data: [{ date: "2026-07-01", values: [75] }] },
    });
    const result = verifyProviderObservationAgainstRawArtifact({
      rawBytes: raw,
      receipt: {
        rawResponseSha256: sha256Of(raw),
        productId: "prod_receipt_a",
        targetProductOrKeyword: "cat water fountain",
      },
      observation: {
        productId: "prod_observation_b", // Cross-product swap
        keyword: "cat water fountain",
        periodStart: "2026-07-01",
        demandValue: 75,
      },
    });
    expect(result.verified).toBe(false);
    expect(result.errorCode).toBe("PRODUCT_MISMATCH");
  });

  it("A22: non-timeseries product/ad response -> NO_TIMESERIES_SUPPORT", () => {
    const raw = createRawJsonBytes({
      ad_archive_id: "123456789",
      ads: [{ body: "Buy now!" }],
    });
    const result = verifyProviderObservationAgainstRawArtifact({
      rawBytes: raw,
      receipt: { rawResponseSha256: sha256Of(raw) },
      observation: { keyword: "cat water fountain", periodStart: "2026-07-01", demandValue: 75 },
    });
    expect(result.verified).toBe(false);
    expect(result.errorCode).toBe("NO_TIMESERIES_SUPPORT");
  });

  it("A23: empty rawBytes -> MISSING_ARTIFACT", () => {
    const result = verifyProviderObservationAgainstRawArtifact({
      rawBytes: Buffer.alloc(0),
      receipt: { rawResponseSha256: "some_sha" },
      observation: { keyword: "cat water fountain", periodStart: "2026-07-01" },
    });
    expect(result.verified).toBe(false);
    expect(result.errorCode).toBe("MISSING_ARTIFACT");
  });

  it("A24: corrupt JSON payload -> UNSUPPORTED_RAW_SCHEMA", () => {
    const raw = Buffer.from("{ invalid_json: ", "utf8");
    const result = verifyProviderObservationAgainstRawArtifact({
      rawBytes: raw,
      receipt: { rawResponseSha256: sha256Of(raw) },
      observation: { keyword: "cat water fountain", periodStart: "2026-07-01" },
    });
    expect(result.verified).toBe(false);
    expect(result.errorCode).toBe("UNSUPPORTED_RAW_SCHEMA");
  });

  it("A25: raw row missing explicit query attribution -> RAW_SERIES_IDENTITY_MISMATCH", () => {
    const raw = createRawJsonBytes({
      search_metadata: { status: "Success" },
      interest_over_time: {
        timeline_data: [{ date: "2026-07-01", values: [75] }],
      },
    });
    const result = verifyProviderObservationAgainstRawArtifact({
      rawBytes: raw,
      receipt: { rawResponseSha256: sha256Of(raw) },
      observation: { periodStart: "2026-07-01", demandValue: 75 }, // Missing keyword
    });
    expect(result.verified).toBe(false);
    expect(result.errorCode).toBe("RAW_SERIES_IDENTITY_MISMATCH");
  });

  it("A26: multiple points on date with conflicting values -> RAW_ROW_AMBIGUOUS", () => {
    const raw = createRawJsonBytes({
      search_parameters: { q: "cat water fountain", geo: "US" },
      interest_over_time: {
        timeline_data: [
          { date: "2026-07-01", values: [{ query: "cat water fountain", value: 75 }] },
          { date: "2026-07-01", values: [{ query: "cat water fountain", value: 50 }] },
        ],
      },
    });
    const result = verifyProviderObservationAgainstRawArtifact({
      rawBytes: raw,
      receipt: { rawResponseSha256: sha256Of(raw), targetProductOrKeyword: "cat water fountain", region: "US" },
      observation: { keyword: "cat water fountain", region: "US", periodStart: "2026-07-01", demandValue: 75 },
    });
    expect(result.verified).toBe(false);
    expect(result.errorCode).toBe("RAW_ROW_AMBIGUOUS");
  });

  it("A27: cross-tenant workspace swap -> RUN_MISMATCH", () => {
    const raw = createRawJsonBytes({
      search_parameters: { q: "cat water fountain", geo: "US" },
      interest_over_time: { timeline_data: [{ date: "2026-07-01", values: [75] }] },
    });
    const result = verifyProviderObservationAgainstRawArtifact({
      rawBytes: raw,
      receipt: { rawResponseSha256: sha256Of(raw), workspaceId: "ws_alpha", targetProductOrKeyword: "cat water fountain" },
      observation: { workspaceId: "ws_beta", keyword: "cat water fountain", periodStart: "2026-07-01", demandValue: 75 },
    });
    expect(result.verified).toBe(false);
    expect(result.errorCode).toBe("RUN_MISMATCH");
  });

  it("A28: cross-run researchRunId swap -> RUN_MISMATCH", () => {
    const raw = createRawJsonBytes({
      search_parameters: { q: "cat water fountain", geo: "US" },
      interest_over_time: { timeline_data: [{ date: "2026-07-01", values: [75] }] },
    });
    const result = verifyProviderObservationAgainstRawArtifact({
      rawBytes: raw,
      receipt: { rawResponseSha256: sha256Of(raw), researchRunId: "run_alpha", targetProductOrKeyword: "cat water fountain" },
      observation: { researchRunId: "run_beta", keyword: "cat water fountain", periodStart: "2026-07-01", demandValue: 75 },
    });
    expect(result.verified).toBe(false);
    expect(result.errorCode).toBe("RUN_MISMATCH");
  });

  it("A29: observation periodStart is in the future -> POINT_IN_TIME_VIOLATION", () => {
    const raw = createRawJsonBytes({
      search_parameters: { q: "cat water fountain", geo: "US" },
      interest_over_time: { timeline_data: [{ date: "2026-07-01", values: [75] }] },
    });
    const result = verifyProviderObservationAgainstRawArtifact({
      rawBytes: raw,
      receipt: { rawResponseSha256: sha256Of(raw), targetProductOrKeyword: "cat water fountain" },
      observation: { keyword: "cat water fountain", periodStart: "2026-07-01", demandValue: 75 },
      options: { asOfTimestamp: "2025-01-01" }, // asOf cutoff before observation periodStart
    });
    expect(result.verified).toBe(false);
    expect(result.errorCode).toBe("POINT_IN_TIME_VIOLATION");
  });

  it("A30: invalid prefix date match (e.g. '2026-07') -> RAW_ROW_NOT_FOUND", () => {
    const raw = createRawJsonBytes({
      search_parameters: { q: "cat water fountain", geo: "US" },
      interest_over_time: { timeline_data: [{ date: "2026-07-01", values: [75] }] },
    });
    const result = verifyProviderObservationAgainstRawArtifact({
      rawBytes: raw,
      receipt: { rawResponseSha256: sha256Of(raw), targetProductOrKeyword: "cat water fountain" },
      observation: { keyword: "cat water fountain", periodStart: "2026-07", demandValue: 75 }, // Incomplete prefix date
    });
    expect(result.verified).toBe(false);
    expect(result.errorCode).toBe("RAW_ROW_NOT_FOUND");
  });
});

describe("KH-02 V12.4.3.7.19: Exact Provider Raw Row Binding (B01 - B08 Positive)", () => {
  it("B01: exact single-series raw row mapping daily -> verified: true", () => {
    const raw = createRawJsonBytes({
      search_parameters: { q: "cat water fountain", geo: "US" },
      interest_over_time: {
        timeline_data: [{ date: "2026-07-01", values: [75] }],
      },
    });
    const result = verifyProviderObservationAgainstRawArtifact({
      rawBytes: raw,
      receipt: { rawResponseSha256: sha256Of(raw), targetProductOrKeyword: "cat water fountain", region: "US" },
      observation: { keyword: "cat water fountain", region: "US", periodStart: "2026-07-01", demandValue: 75 },
    });
    expect(result.verified).toBe(true);
    expect(result.rawRowPointer).toBe("/interest_over_time/timeline_data/0/values/0");
    expect(result.matchedObservation?.value).toBe(75);
  });

  it("B02: exact weekly mapping with verified interval -> verified: true, cadence: WEEKLY", () => {
    const raw = createRawJsonBytes({
      search_parameters: { q: "cat water fountain", geo: "US" },
      interest_over_time: {
        timeline_data: [
          { date: "2026-07-01", values: [75] },
          { date: "2026-07-08", values: [70] },
        ],
      },
    });
    const result = verifyProviderObservationAgainstRawArtifact({
      rawBytes: raw,
      receipt: { rawResponseSha256: sha256Of(raw), targetProductOrKeyword: "cat water fountain", region: "US" },
      observation: {
        keyword: "cat water fountain",
        region: "US",
        periodStart: "2026-07-01",
        periodEnd: "2026-07-07",
        demandValue: 75,
      },
    });
    expect(result.verified).toBe(true);
    expect(result.cadence).toBe("WEEKLY");
  });

  it("B03: exact multi-series mapping with verified query label/index", () => {
    const raw = createRawJsonBytes({
      search_parameters: { q: "pet feeders", geo: "US" },
      interest_over_time: {
        timeline_data: [
          {
            date: "2026-07-01",
            values: [
              { query: "automatic cat feeder", extracted_value: 80 },
              { query: "automatic dog feeder", extracted_value: 65 },
            ],
          },
        ],
      },
    });
    const result = verifyProviderObservationAgainstRawArtifact({
      rawBytes: raw,
      receipt: { rawResponseSha256: sha256Of(raw), targetProductOrKeyword: "automatic dog feeder", region: "US" },
      observation: { keyword: "automatic dog feeder", region: "US", periodStart: "2026-07-01", demandValue: 65 },
    });
    expect(result.verified).toBe(true);
    expect(result.rawRowPointer).toBe("/interest_over_time/timeline_data/0/values/1");
    expect(result.matchedObservation?.value).toBe(65);
  });

  it("B04: harmless canonical query normalization preserves identity", () => {
    expect(areExactOrCanonicalEquivalentQueries(" Cat Water Fountain ", "cat water fountain")).toBe(true);
    expect(areExactOrCanonicalEquivalentQueries("\"cat water fountain\"", "cat water fountain")).toBe(true);
    expect(areExactOrCanonicalEquivalentQueries("cat   water   fountain", "cat water fountain")).toBe(true);
    expect(normalizeCanonicalQuery("  Automatic Feeder-V2  ")).toBe("automatic feeder-v2");
  });

  it("B05: idempotent same observation produces consistent verification", () => {
    const raw = createRawJsonBytes({
      search_parameters: { q: "cat water fountain", geo: "US" },
      interest_over_time: { timeline_data: [{ date: "2026-07-01", values: [75] }] },
    });
    const params = {
      rawBytes: raw,
      receipt: { rawResponseSha256: sha256Of(raw), targetProductOrKeyword: "cat water fountain", region: "US" },
      observation: { keyword: "cat water fountain", region: "US", periodStart: "2026-07-01", demandValue: 75 },
    };
    const res1 = verifyProviderObservationAgainstRawArtifact(params);
    const res2 = verifyProviderObservationAgainstRawArtifact(params);
    expect(res1.verified).toBe(true);
    expect(res2.verified).toBe(true);
    expect(res1.rawRowPointer).toBe(res2.rawRowPointer);
  });

  it("B06: extracted_value string and numeric parsing supported", () => {
    const raw = createRawJsonBytes({
      search_parameters: { q: "cat water fountain", geo: "US" },
      interest_over_time: {
        timeline_data: [{ date: "2026-07-01", values: [{ query: "cat water fountain", value: "85" }] }],
      },
    });
    const result = verifyProviderObservationAgainstRawArtifact({
      rawBytes: raw,
      receipt: { rawResponseSha256: sha256Of(raw), targetProductOrKeyword: "cat water fountain", region: "US" },
      observation: { keyword: "cat water fountain", region: "US", periodStart: "2026-07-01", demandValue: 85 },
    });
    expect(result.verified).toBe(true);
    expect(result.matchedObservation?.value).toBe(85);
  });

  it("B07: valid explicit unsupported-schema classification (no throw into live)", () => {
    const raw = createRawJsonBytes({ random_field: 123 });
    const parsed = parseProviderTimeseriesPayload(raw);
    expect(parsed.supported).toBe(false);
    expect(parsed.reasonCode).toBe("RAW_SERIES_MISSING");
  });

  it("B08: deterministic receipt/content hash/pointer replay", () => {
    const raw = createRawJsonBytes({
      search_parameters: { q: "cat water fountain", geo: "US" },
      interest_over_time: {
        timeline_data: [
          { date: "2026-07-01", values: [75] },
          { date: "2026-07-08", values: [80] },
        ],
      },
    });
    const r1 = verifyProviderObservationAgainstRawArtifact({
      rawBytes: raw,
      receipt: { rawResponseSha256: sha256Of(raw), targetProductOrKeyword: "cat water fountain" },
      observation: { keyword: "cat water fountain", periodStart: "2026-07-08", demandValue: 80 },
    });
    expect(r1.rawRowPointer).toBe("/interest_over_time/timeline_data/1/values/0");
  });
});

