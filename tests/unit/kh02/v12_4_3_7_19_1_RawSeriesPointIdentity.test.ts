/**
 * ANTI KH-02 V12.4.3.7.19.1 — Exact Raw Series & Point Identity Test Matrix (R01 - R24)
 *
 * Verifies that the selected raw point strictly binds to canonical query, region,
 * date, value, cadence, and JSON pointer. Closes Defect P1-B exploit where a single
 * point on a date accepted an arbitrary queryKey.
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
  return crypto.createHash("sha256").update(buf).digest("hex");
}

describe("KH-02 V12.4.3.7.19.1: Exact Raw-Row & Series Identity (R01 - R24)", () => {
  it("R01: single point on date: global q cat / value.query dog => reject (Defect P1-B exploit)", () => {
    const raw = createRawJsonBytes({
      search_parameters: { q: "cat water fountain", geo: "US" },
      interest_over_time: {
        timeline_data: [
          {
            date: "2026-07-01",
            values: [
              { query: "dog water fountain", value: "75", extracted_value: 75 },
            ],
          },
        ],
      },
    });

    const result = verifyProviderObservationAgainstRawArtifact({
      rawBytes: raw,
      receipt: {
        rawResponseSha256: sha256Of(raw),
        targetProductOrKeyword: "cat water fountain",
        region: "US",
      },
      observation: {
        keyword: "cat water fountain",
        region: "US",
        periodStart: "2026-07-01",
        demandValue: 75,
      },
    });

    expect(result.verified).toBe(false);
    expect(result.errorCode).toBe("RAW_SERIES_IDENTITY_MISMATCH");
    expect(result.rejectionReason).toContain("dog water fountain");
  });

  it("R02: global q cat / row.query cat => accept exact", () => {
    const raw = createRawJsonBytes({
      search_parameters: { q: "cat water fountain", geo: "US" },
      interest_over_time: {
        timeline_data: [
          {
            date: "2026-07-01",
            values: [
              { query: "cat water fountain", value: "75", extracted_value: 75 },
            ],
          },
        ],
      },
    });

    const result = verifyProviderObservationAgainstRawArtifact({
      rawBytes: raw,
      receipt: {
        rawResponseSha256: sha256Of(raw),
        targetProductOrKeyword: "cat water fountain",
        region: "US",
      },
      observation: {
        keyword: "cat water fountain",
        region: "US",
        periodStart: "2026-07-01",
        demandValue: 75,
      },
    });

    expect(result.verified).toBe(true);
    expect(result.rawRowPointer).toBe("/interest_over_time/timeline_data/0/values/0");
  });

  it("R03: case/whitespace canonical equivalence only => accept", () => {
    const raw = createRawJsonBytes({
      search_parameters: { q: "  Cat   Water Fountain  ", geo: "US" },
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
      },
      observation: {
        keyword: "cat water fountain",
        region: "US",
        periodStart: "2026-07-01",
        demandValue: 75,
      },
    });

    expect(result.verified).toBe(true);
  });

  it("R04: variant/model swap => reject", () => {
    const raw = createRawJsonBytes({
      search_parameters: { q: "cat water fountain Pro Max", geo: "US" },
      interest_over_time: {
        timeline_data: [{ date: "2026-07-01", values: [75] }],
      },
    });

    const result = verifyProviderObservationAgainstRawArtifact({
      rawBytes: raw,
      receipt: {
        rawResponseSha256: sha256Of(raw),
        targetProductOrKeyword: "cat water fountain Mini",
        region: "US",
      },
      observation: {
        keyword: "cat water fountain Mini",
        region: "US",
        periodStart: "2026-07-01",
        demandValue: 75,
      },
    });

    expect(result.verified).toBe(false);
    expect(result.errorCode).toBe("RAW_SERIES_IDENTITY_MISMATCH");
  });

  it("R05: receipt only q when raw q missing => reject", () => {
    const raw = createRawJsonBytes({
      interest_over_time: {
        timeline_data: [{ date: "2026-07-01", values: [75] }],
      },
    });

    const result = verifyProviderObservationAgainstRawArtifact({
      rawBytes: raw,
      receipt: {
        rawResponseSha256: sha256Of(raw),
        targetProductOrKeyword: "cat water fountain",
      },
      observation: {
        keyword: "cat water fountain",
        periodStart: "2026-07-01",
        demandValue: 75,
      },
    });

    expect(result.verified).toBe(false);
    expect(result.errorCode).toBe("RAW_SERIES_IDENTITY_MISMATCH");
  });

  it("R06: raw q not provided, no attested request metadata => reject", () => {
    const raw = createRawJsonBytes({
      search_parameters: {},
      interest_over_time: {
        timeline_data: [{ date: "2026-07-01", values: [75] }],
      },
    });

    const result = verifyProviderObservationAgainstRawArtifact({
      rawBytes: raw,
      receipt: { rawResponseSha256: sha256Of(raw) },
      observation: {
        keyword: "cat water fountain",
        periodStart: "2026-07-01",
        demandValue: 75,
      },
    });

    expect(result.verified).toBe(false);
    expect(result.errorCode).toBe("RAW_SERIES_IDENTITY_MISMATCH");
  });

  it("R07: two series same date, unlabeled => reject", () => {
    const raw = createRawJsonBytes({
      search_parameters: { q: "cat water fountain", geo: "US" },
      interest_over_time: {
        timeline_data: [{ date: "2026-07-01", values: [75, 85] }],
      },
    });

    const result = verifyProviderObservationAgainstRawArtifact({
      rawBytes: raw,
      receipt: {
        rawResponseSha256: sha256Of(raw),
        targetProductOrKeyword: "cat water fountain",
      },
      observation: {
        keyword: "cat water fountain",
        periodStart: "2026-07-01",
        demandValue: 75,
      },
    });

    expect(result.verified).toBe(false);
    expect(result.errorCode).toBe("RAW_ROW_AMBIGUOUS");
  });

  it("R08: one row value matching other keyword => reject", () => {
    const raw = createRawJsonBytes({
      search_parameters: { q: "cat water fountain, automatic feeder", geo: "US" },
      interest_over_time: {
        timeline_data: [
          {
            date: "2026-07-01",
            values: [
              { query: "automatic feeder", value: "75", extracted_value: 75 },
              { query: "cat water fountain", value: "40", extracted_value: 40 },
            ],
          },
        ],
      },
    });

    const result = verifyProviderObservationAgainstRawArtifact({
      rawBytes: raw,
      receipt: {
        rawResponseSha256: sha256Of(raw),
        targetProductOrKeyword: "cat water fountain",
      },
      observation: {
        keyword: "cat water fountain",
        periodStart: "2026-07-01",
        demandValue: 75, // Matches automatic feeder, not cat water fountain
      },
    });

    expect(result.verified).toBe(false);
    expect(result.errorCode).toBe("RAW_VALUE_MISMATCH");
  });

  it("R09: equal value other date => reject", () => {
    const raw = createRawJsonBytes({
      search_parameters: { q: "cat water fountain", geo: "US" },
      interest_over_time: {
        timeline_data: [
          { date: "2026-06-01", values: [75] },
          { date: "2026-07-01", values: [40] },
        ],
      },
    });

    const result = verifyProviderObservationAgainstRawArtifact({
      rawBytes: raw,
      receipt: {
        rawResponseSha256: sha256Of(raw),
        targetProductOrKeyword: "cat water fountain",
      },
      observation: {
        keyword: "cat water fountain",
        periodStart: "2026-07-01",
        demandValue: 75,
      },
    });

    expect(result.verified).toBe(false);
    expect(result.errorCode).toBe("RAW_VALUE_MISMATCH");
  });

  it("R10: competing points same date different values => ambiguous", () => {
    const raw = createRawJsonBytes({
      search_parameters: { q: "cat water fountain", geo: "US" },
      interest_over_time: {
        timeline_data: [
          {
            date: "2026-07-01",
            values: [
              { query: "cat water fountain", value: 75 },
              { query: "cat water fountain", value: 85 },
            ],
          },
        ],
      },
    });

    const result = verifyProviderObservationAgainstRawArtifact({
      rawBytes: raw,
      receipt: {
        rawResponseSha256: sha256Of(raw),
        targetProductOrKeyword: "cat water fountain",
      },
      observation: {
        keyword: "cat water fountain",
        periodStart: "2026-07-01",
        demandValue: 75,
      },
    });

    expect(result.verified).toBe(false);
    expect(result.errorCode).toBe("RAW_ROW_AMBIGUOUS");
  });

  it("R11: same date duplicate same value but distinct query => reject or prove exact mapping", () => {
    const raw = createRawJsonBytes({
      search_parameters: { q: "cat fountain", geo: "US" },
      interest_over_time: {
        timeline_data: [
          {
            date: "2026-07-01",
            values: [
              { query: "dog fountain", value: 75 },
            ],
          },
        ],
      },
    });

    const result = verifyProviderObservationAgainstRawArtifact({
      rawBytes: raw,
      receipt: {
        rawResponseSha256: sha256Of(raw),
        targetProductOrKeyword: "cat fountain",
      },
      observation: {
        keyword: "cat fountain",
        periodStart: "2026-07-01",
        demandValue: 75,
      },
    });

    expect(result.verified).toBe(false);
    expect(result.errorCode).toBe("RAW_SERIES_IDENTITY_MISMATCH");
  });

  it("R12: malformed or empty timeline => reject", () => {
    const raw = createRawJsonBytes({
      search_parameters: { q: "cat fountain", geo: "US" },
      interest_over_time: { timeline_data: [] },
    });

    const result = verifyProviderObservationAgainstRawArtifact({
      rawBytes: raw,
      receipt: { rawResponseSha256: sha256Of(raw), targetProductOrKeyword: "cat fountain" },
      observation: { keyword: "cat fountain", periodStart: "2026-07-01", demandValue: 75 },
    });

    expect(result.verified).toBe(false);
    expect(result.errorCode).toBe("RAW_SERIES_MISSING");
  });

  it("R13: malformed raw JSON => reject", () => {
    const raw = Buffer.from("not valid json", "utf8");
    const result = verifyProviderObservationAgainstRawArtifact({
      rawBytes: raw,
      receipt: { rawResponseSha256: sha256Of(raw), targetProductOrKeyword: "cat fountain" },
      observation: { keyword: "cat fountain", periodStart: "2026-07-01", demandValue: 75 },
    });

    expect(result.verified).toBe(false);
    expect(result.errorCode).toBe("UNSUPPORTED_RAW_SCHEMA");
  });

  it("R14: sha mismatch => reject", () => {
    const raw = createRawJsonBytes({
      search_parameters: { q: "cat fountain", geo: "US" },
      interest_over_time: { timeline_data: [{ date: "2026-07-01", values: [75] }] },
    });

    const result = verifyProviderObservationAgainstRawArtifact({
      rawBytes: raw,
      receipt: { rawResponseSha256: "0000000000000000000000000000000000000000000000000000000000000000", targetProductOrKeyword: "cat fountain" },
      observation: { keyword: "cat fountain", periodStart: "2026-07-01", demandValue: 75 },
    });

    expect(result.verified).toBe(false);
    expect(result.errorCode).toBe("HASH_MISMATCH");
  });

  it("R15: invalid region/missing attested geo => reject", () => {
    const raw = createRawJsonBytes({
      search_parameters: { q: "cat fountain", geo: "GB" },
      interest_over_time: { timeline_data: [{ date: "2026-07-01", values: [75] }] },
    });

    const result = verifyProviderObservationAgainstRawArtifact({
      rawBytes: raw,
      receipt: { rawResponseSha256: sha256Of(raw), targetProductOrKeyword: "cat fountain", region: "GB" },
      observation: { keyword: "cat fountain", region: "US", periodStart: "2026-07-01", demandValue: 75 },
    });

    expect(result.verified).toBe(false);
    expect(result.errorCode).toBe("REGION_MISMATCH");
  });

  it("R16: weekly interval mismatch => reject", () => {
    const raw = createRawJsonBytes({
      search_parameters: { q: "cat fountain", geo: "US" },
      interest_over_time: {
        timeline_data: [
          { date: "2026-07-01", values: [75] },
          { date: "2026-07-08", values: [80] },
        ],
      },
    });

    const result = verifyProviderObservationAgainstRawArtifact({
      rawBytes: raw,
      receipt: { rawResponseSha256: sha256Of(raw), targetProductOrKeyword: "cat fountain" },
      observation: {
        keyword: "cat fountain",
        periodStart: "2026-07-01",
        periodEnd: "2026-07-15", // 14 days diff on weekly cadence
        demandValue: 75,
      },
    });

    expect(result.verified).toBe(false);
    expect(result.errorCode).toBe("INTERVAL_MISMATCH");
  });

  it("R17: daily interval invalid => reject", () => {
    const raw = createRawJsonBytes({
      search_parameters: { q: "cat fountain", geo: "US" },
      interest_over_time: {
        timeline_data: [
          { date: "2026-07-01", values: [75] },
          { date: "2026-07-02", values: [80] },
        ],
      },
    });

    const result = verifyProviderObservationAgainstRawArtifact({
      rawBytes: raw,
      receipt: { rawResponseSha256: sha256Of(raw), targetProductOrKeyword: "cat fountain" },
      observation: {
        keyword: "cat fountain",
        periodStart: "2026-07-01",
        periodEnd: "2026-07-05", // 4 days on daily series
        demandValue: 75,
      },
    });

    expect(result.verified).toBe(false);
    expect(result.errorCode).toBe("INTERVAL_MISMATCH");
  });

  it("R18: hourly boundary and timezone => deterministic", () => {
    const raw = createRawJsonBytes({
      search_parameters: { q: "cat fountain", geo: "US" },
      interest_over_time: {
        timeline_data: [
          { date: "2026-07-01T23:00:00Z", values: [75] },
          { date: "2026-07-02T00:00:00Z", values: [80] },
        ],
      },
    });

    const series = parseProviderTimeseriesPayload(raw);
    expect(series.cadence).toBe("HOURLY");
  });

  it("R19: future capturedAt/asOf lookahead => reject", () => {
    const raw = createRawJsonBytes({
      search_parameters: { q: "cat fountain", geo: "US" },
      search_metadata: { created_at: "2026-10-01T00:00:00Z" },
      interest_over_time: {
        timeline_data: [{ date: "2026-07-01", values: [75] }],
      },
    });

    const result = verifyProviderObservationAgainstRawArtifact({
      rawBytes: raw,
      receipt: {
        rawResponseSha256: sha256Of(raw),
        targetProductOrKeyword: "cat fountain",
        capturedAt: "2026-10-01T00:00:00Z",
      },
      observation: {
        keyword: "cat fountain",
        periodStart: "2026-07-01",
        demandValue: 75,
      },
      options: {
        asOfTimestamp: "2026-08-01T00:00:00Z", // asOf before capturedAt
      },
    });

    expect(result.verified).toBe(false);
    expect(result.errorCode).toBe("POINT_IN_TIME_VIOLATION");
  });

  it("R20: invalid numeric/null/zero placeholder distinction", () => {
    const raw = createRawJsonBytes({
      search_parameters: { q: "cat fountain", geo: "US" },
      interest_over_time: {
        timeline_data: [{ date: "2026-07-01", values: [null] }],
      },
    });

    const result = verifyProviderObservationAgainstRawArtifact({
      rawBytes: raw,
      receipt: { rawResponseSha256: sha256Of(raw), targetProductOrKeyword: "cat fountain" },
      observation: {
        keyword: "cat fountain",
        periodStart: "2026-07-01",
        demandValue: 0, // 0 is not null
      },
    });

    expect(result.verified).toBe(false);
    expect(result.errorCode).toBe("INVALID_NUMERIC_VALUE");
  });

  it("R21: correct rawRowPointer resolves to exact JSON node", () => {
    const raw = createRawJsonBytes({
      search_parameters: { q: "cat fountain", geo: "US" },
      interest_over_time: {
        timeline_data: [
          { date: "2026-07-01", values: [50] },
          { date: "2026-07-02", values: [75] },
        ],
      },
    });

    const result = verifyProviderObservationAgainstRawArtifact({
      rawBytes: raw,
      receipt: { rawResponseSha256: sha256Of(raw), targetProductOrKeyword: "cat fountain" },
      observation: { keyword: "cat fountain", periodStart: "2026-07-02", demandValue: 75 },
    });

    expect(result.verified).toBe(true);
    expect(result.rawRowPointer).toBe("/interest_over_time/timeline_data/1/values/0");
  });

  it("R22: wrong periodEnd => reject", () => {
    const raw = createRawJsonBytes({
      search_parameters: { q: "cat fountain", geo: "US" },
      interest_over_time: {
        timeline_data: [
          { date: "2026-07-01 - 2026-07-07", values: [75] },
        ],
      },
    });

    const result = verifyProviderObservationAgainstRawArtifact({
      rawBytes: raw,
      receipt: { rawResponseSha256: sha256Of(raw), targetProductOrKeyword: "cat fountain" },
      observation: {
        keyword: "cat fountain",
        periodStart: "2026-07-01",
        periodEnd: "2026-07-10",
        demandValue: 75,
      },
    });

    expect(result.verified).toBe(false);
    expect(result.errorCode).toBe("INTERVAL_MISMATCH");
  });

  it("R23: single point with unlabeled multi-series ambiguity => reject", () => {
    const raw = createRawJsonBytes({
      search_parameters: { q: "cat fountain", geo: "US" },
      interest_over_time: {
        timeline_data: [
          { date: "2026-07-01", values: [75, 90] }, // 2 unlabeled values
        ],
      },
    });

    const result = verifyProviderObservationAgainstRawArtifact({
      rawBytes: raw,
      receipt: { rawResponseSha256: sha256Of(raw), targetProductOrKeyword: "cat fountain" },
      observation: { keyword: "cat fountain", periodStart: "2026-07-01", demandValue: 75 },
    });

    expect(result.verified).toBe(false);
    expect(result.errorCode).toBe("RAW_ROW_AMBIGUOUS");
  });

  it("R24: unsupported provider schema => NOT_VERIFIABLE not guessed", () => {
    const raw = createRawJsonBytes({
      interest_over_time: {
        timeline_data: [{ date: "2026-07-01", unverified_score: 75 }], // lacking values array
      },
    });

    const result = verifyProviderObservationAgainstRawArtifact({
      rawBytes: raw,
      receipt: { rawResponseSha256: sha256Of(raw), targetProductOrKeyword: "cat fountain" },
      observation: { keyword: "cat fountain", periodStart: "2026-07-01", demandValue: 75 },
    });

    expect(result.verified).toBe(false);
    expect(result.errorCode).toBe("UNSUPPORTED_RAW_SCHEMA");
  });
});
