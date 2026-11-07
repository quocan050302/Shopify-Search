/**
 * ANTI — KH-02 V12.4.3.7.18: STRICT CSV ROW AUTHORITY & FAIL-CLOSED DEMAND LINEAGE
 * Scenarios R01 - R28
 */

import { describe, it, expect, beforeEach, afterEach, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { prisma } from "@/lib/db";
import {
  parseGoogleTrendsCsvBytes,
  verifyDemandObservationAgainstRawCsv,
  saveOriginalGoogleTrendsCsvFile,
  GOOGLE_TRENDS_CSV_STORAGE_DIR,
} from "@/services/kh02/demand/googleTrendsCsvValidator";
import {
  executeDemandObservationBatchImport,
} from "@/services/kh02/demand/demandObservationBatchImport";
import {
  hasVerifiableCsvOrProviderLineage,
  evaluateDemandSourceAuthority,
} from "@/services/kh02/demand/temporalDemandEngine";

describe("KH-02 V12.4.3.7.18: Strict CSV Row Authority (R01 - R28)", () => {
  const testProductId = "prod_r_test_001";
  const testWorkspaceId = "ws_r_test";

  let sampleCsvContent = "Category: All categories\nWeek,automatic cat feeder: (United States)\n";
  const dates: string[] = [];
  for (let i = 0; i < 13; i++) {
    const d = new Date(Date.UTC(2025, 4, 3 + i * 7));
    const dt = d.toISOString().slice(0, 10);
    dates.push(dt);
    sampleCsvContent += `${dt},${50 + i * 3}\n`;
  }

  const csvSha256 = crypto.createHash("sha256").update(sampleCsvContent, "utf8").digest("hex");
  const csvFilePath = path.join(GOOGLE_TRENDS_CSV_STORAGE_DIR, `${csvSha256}.csv`);
  const evidenceRef = `csv-import:google-trends-explore:sha256:${csvSha256}:q=automatic_cat_feeder`;

  beforeEach(async () => {
    fs.mkdirSync(GOOGLE_TRENDS_CSV_STORAGE_DIR, { recursive: true });
    if (!fs.existsSync(csvFilePath) || fs.readFileSync(csvFilePath, "utf8") !== sampleCsvContent) {
      fs.writeFileSync(csvFilePath, sampleCsvContent, "utf8");
    }

    await prisma.workspace.upsert({
      where: { id: testWorkspaceId },
      create: { id: testWorkspaceId, name: "WS Test R" },
      update: {},
    });

    const wl = await prisma.watchlist.upsert({
      where: { id: "wl_" + testWorkspaceId },
      create: { id: "wl_" + testWorkspaceId, workspaceId: testWorkspaceId, name: "WL Test R" },
      update: {},
    });

    await prisma.researchProduct.upsert({
      where: { id: testProductId },
      create: { id: testProductId, title: "Test Product " + testProductId },
      update: {},
    });

    await prisma.watchlistItem.upsert({
      where: { id: "wli_" + testProductId },
      create: { id: "wli_" + testProductId, watchlistId: wl.id, productId: testProductId, itemType: "PRODUCT" },
      update: { watchlistId: wl.id, productId: testProductId },
    });

    await prisma.productDemandObservation.deleteMany({
      where: { productId: testProductId },
    });
  });

  afterAll(async () => {
    try {
      if (fs.existsSync(csvFilePath)) {
        fs.unlinkSync(csvFilePath);
      }
    } catch {
      // ignore
    }
  });

  it("R01: verifyDemandObservationAgainstRawCsv does NOT mutate file on disk (mtime and sha256 byte-for-byte identical)", async () => {
    const statBefore = fs.statSync(csvFilePath);
    const contentBefore = fs.readFileSync(csvFilePath);

    const check = verifyDemandObservationAgainstRawCsv(csvSha256, {
      keyword: "automatic cat feeder",
      region: "US",
      periodStart: new Date(dates[0]),
      demandValue: 50,
    });

    expect(check.verified).toBe(true);

    const statAfter = fs.statSync(csvFilePath);
    const contentAfter = fs.readFileSync(csvFilePath);

    expect(statAfter.mtimeMs).toBe(statBefore.mtimeMs);
    expect(Buffer.compare(contentBefore, contentAfter)).toBe(0);
  });

  it("R02: parseGoogleTrendsCsvBytes is pure function, returns valid:false for empty/whitespace CSV", () => {
    const res = parseGoogleTrendsCsvBytes("   \n\n\t ");
    expect(res.valid).toBe(false);
    expect(res.errors).toContain("CSV content is empty.");
  });

  it("R03: parseGoogleTrendsCsvBytes returns valid:false for CSV missing required columns", () => {
    const badCsv = "Category: All categories\nBadCol1,BadCol2\n2026-05-03,50\n";
    const res = parseGoogleTrendsCsvBytes(badCsv);
    expect(res.valid).toBe(false);
    expect(res.errors.some((e) => e.includes("valid Google Trends time series column header"))).toBe(true);
  });

  it("R04: parseGoogleTrendsCsvBytes returns valid:false for CSV with no valid date rows", () => {
    const badCsv = "Week,cat feeder: (United States)\nnot-a-date,50\n";
    const res = parseGoogleTrendsCsvBytes(badCsv);
    expect(res.valid).toBe(false);
    expect(res.errors.some((e) => e.includes("No valid numeric time series"))).toBe(true);
  });

  it("R05: Valid 1-row CSV yields parsed point count = 1, and 3-row CSV yields valid: true", () => {
    const valid1Row = "Week,cat feeder: (United States)\n2026-05-03,75\n";
    const res1 = parseGoogleTrendsCsvBytes(valid1Row);
    expect(res1.dataPoints.length).toBe(1);
    expect(res1.keyword).toBe("cat feeder");
    expect(res1.region).toBe("US");
    expect(res1.dataPoints[0].demandValue).toBe(75);

    const valid3Row = "Category: All categories\nWeek,cat feeder: (United States)\n2026-05-03,75\n2026-05-10,80\n2026-05-17,85\n";
    const res3 = parseGoogleTrendsCsvBytes(valid3Row);
    expect(res3.valid).toBe(true);
    expect(res3.dataPoints.length).toBe(3);
  });

  it("R06: verifyDemandObservationAgainstRawCsv matches exact target period and keyword", () => {
    const check = verifyDemandObservationAgainstRawCsv(csvSha256, {
      keyword: "automatic cat feeder",
      region: "US",
      periodStart: new Date(dates[2]),
      demandValue: 56,
    });

    expect(check.verified).toBe(true);
    expect(check.code).toBe("ROW_VERIFIED");
  });

  it("R07: Target keyword mismatch in CSV returns verified: false with KEYWORD_MISMATCH", () => {
    const check = verifyDemandObservationAgainstRawCsv(csvSha256, {
      keyword: "dog feeder",
      region: "US",
      periodStart: new Date(dates[0]),
      demandValue: 50,
    });

    expect(check.verified).toBe(false);
    expect(check.code).toBe("KEYWORD_MISMATCH");
  });

  it("R08: Target observation date mismatch in CSV returns verified: false with ROW_NOT_IN_CSV", () => {
    const check = verifyDemandObservationAgainstRawCsv(csvSha256, {
      keyword: "automatic cat feeder",
      region: "US",
      periodStart: new Date("2020-01-01"),
      demandValue: 50,
    });

    expect(check.verified).toBe(false);
    expect(check.code).toBe("ROW_NOT_IN_CSV");
  });

  it("R09: Target value mismatch returns verified: false with VALUE_MISMATCH", () => {
    const check = verifyDemandObservationAgainstRawCsv(csvSha256, {
      keyword: "automatic cat feeder",
      region: "US",
      periodStart: new Date(dates[0]),
      demandValue: 999, // actual is 50
    });

    expect(check.verified).toBe(false);
    expect(check.code).toBe("VALUE_MISMATCH");
  });

  it("R10: Target region mismatch returns verified: false with REGION_MISMATCH", () => {
    const check = verifyDemandObservationAgainstRawCsv(csvSha256, {
      keyword: "automatic cat feeder",
      region: "CA", // actual is US
      periodStart: new Date(dates[0]),
      demandValue: 50,
    });

    expect(check.verified).toBe(false);
    expect(check.code).toBe("REGION_MISMATCH");
  });

  it("R11: Missing raw CSV file on disk returns verified: false with FILE_MISSING", () => {
    const nonExistentSha = "a".repeat(64);
    const check = verifyDemandObservationAgainstRawCsv(nonExistentSha, {
      keyword: "automatic cat feeder",
      region: "US",
      periodStart: new Date(dates[0]),
      demandValue: 50,
    });

    expect(check.verified).toBe(false);
    expect(check.code).toBe("FILE_MISSING");
  });

  it("R12: Corrupted raw CSV with SHA mismatch on disk returns verified: false with SHA_MISMATCH", () => {
    const corruptedSha = "b".repeat(64);
    const corruptedPath = path.join(GOOGLE_TRENDS_CSV_STORAGE_DIR, `${corruptedSha}.csv`);
    fs.writeFileSync(corruptedPath, "corrupted content", "utf8");

    try {
      const check = verifyDemandObservationAgainstRawCsv(corruptedSha, {
        keyword: "automatic cat feeder",
        region: "US",
        periodStart: new Date(dates[0]),
        demandValue: 50,
      });

      expect(check.verified).toBe(false);
      expect(check.code).toBe("SHA_MISMATCH");
    } finally {
      if (fs.existsSync(corruptedPath)) fs.unlinkSync(corruptedPath);
    }
  });

  it("R13: hasVerifiableCsvOrProviderLineage with KEYWORD_MISMATCH demotes to CACHED_UNVERIFIED and lineageVerified: false", () => {
    const result = hasVerifiableCsvOrProviderLineage(evidenceRef, null, {
      targetKeyword: "completely wrong keyword",
      region: "US",
      periodStart: new Date(dates[0]),
      observationValue: 50,
    } as any);

    expect(result.lineageVerified).toBe(false);
    expect(result.sourceAuthority).toBe("CACHED_UNVERIFIED");
    expect(result.businessLineageEligible).toBe(false);
  });

  it("R14: hasVerifiableCsvOrProviderLineage with REGION_MISMATCH demotes to CACHED_UNVERIFIED", () => {
    const result = hasVerifiableCsvOrProviderLineage(evidenceRef, null, {
      targetKeyword: "automatic cat feeder",
      region: "GB",
      periodStart: new Date(dates[0]),
      observationValue: 50,
    } as any);

    expect(result.lineageVerified).toBe(false);
    expect(result.sourceAuthority).toBe("CACHED_UNVERIFIED");
  });

  it("R15: hasVerifiableCsvOrProviderLineage with FILE_MISSING demotes to CACHED_UNVERIFIED", () => {
    const fakeRef = `csv-import:google-trends-explore:sha256:${"c".repeat(64)}:q=automatic_cat_feeder`;
    const result = hasVerifiableCsvOrProviderLineage(fakeRef, null, {
      targetKeyword: "automatic cat feeder",
      region: "US",
      periodStart: new Date(dates[0]),
      observationValue: 50,
    } as any);

    expect(result.lineageVerified).toBe(false);
    expect(result.sourceAuthority).toBe("CACHED_UNVERIFIED");
  });

  it("R16: hasVerifiableCsvOrProviderLineage with SHA_MISMATCH demotes to CACHED_UNVERIFIED", () => {
    const fakeSha = "d".repeat(64);
    const fakePath = path.join(GOOGLE_TRENDS_CSV_STORAGE_DIR, `${fakeSha}.csv`);
    fs.writeFileSync(fakePath, "content not matching fakeSha", "utf8");

    try {
      const fakeRef = `csv-import:google-trends-explore:sha256:${fakeSha}:q=automatic_cat_feeder`;
      const result = hasVerifiableCsvOrProviderLineage(fakeRef, null, {
        targetKeyword: "automatic cat feeder",
        region: "US",
        periodStart: new Date(dates[0]),
        observationValue: 50,
      } as any);

      expect(result.lineageVerified).toBe(false);
      expect(result.sourceAuthority).toBe("CACHED_UNVERIFIED");
    } finally {
      if (fs.existsSync(fakePath)) fs.unlinkSync(fakePath);
    }
  });

  it("R17: hasVerifiableCsvOrProviderLineage with VALUE_MISMATCH demotes to CACHED_UNVERIFIED", () => {
    const result = hasVerifiableCsvOrProviderLineage(evidenceRef, null, {
      targetKeyword: "automatic cat feeder",
      region: "US",
      periodStart: new Date(dates[0]),
      observationValue: 12345, // mismatch
    } as any);

    expect(result.lineageVerified).toBe(false);
    expect(result.sourceAuthority).toBe("CACHED_UNVERIFIED");
  });

  it("R18: hasVerifiableCsvOrProviderLineage with intact CSV & row verifies contentIntegrityVerified=true but requires Official CSV Import Authority for HISTORICAL_SOURCE_VERIFIED", () => {
    const result = hasVerifiableCsvOrProviderLineage(evidenceRef, null, {
      targetKeyword: "automatic cat feeder",
      region: "US",
      periodStart: new Date(dates[0]),
      observationValue: 50,
    } as any);

    expect(result.contentIntegrityVerified).toBe(true);
    expect(result.sourceOriginVerified).toBe(false);
    expect(result.lineageVerified).toBe(false);
    expect(result.sourceAuthority).toBe("CACHED_UNVERIFIED");
    expect(result.businessLineageEligible).toBe(false); // CSV byte integrity alone does not grant G15 authority
  });

  it("R19: Local CSV byte integrity proves file integrity only, does NOT equate to external Google API issuance or unattested HISTORICAL_SOURCE_VERIFIED", () => {
    const result = hasVerifiableCsvOrProviderLineage(evidenceRef, null, {
      targetKeyword: "automatic cat feeder",
      region: "US",
      periodStart: new Date(dates[0]),
      observationValue: 50,
    } as any);

    // It proves file integrity on disk, not external direct API attestation or unauthenticated historical authority
    expect(result.contentIntegrityVerified).toBe(true);
    expect(result.sourceAuthority).not.toBe("AUTHORITATIVE_VERIFIED");
    expect(result.sourceAuthority).toBe("CACHED_UNVERIFIED");
    expect(result.providerOriginVerified).toBe(false);
  });

  it("R20: Batch import with GOOGLE_TRENDS_CSV and missing evidenceReference throws 422 EVIDENCE_REFERENCE_REQUIRED", async () => {
    await expect(
      executeDemandObservationBatchImport({
        workspaceId: testWorkspaceId,
        productId: testProductId,
        source: "GOOGLE_TRENDS_CSV",
        strictProvenance: true,
        points: [
          {
            periodStart: dates[0],
            demandValue: 50,
            keyword: "automatic cat feeder",
            region: "US",
            // evidenceReference intentionally omitted
          },
        ],
      })
    ).rejects.toThrow(/evidenceReference is mandatory|EVIDENCE_REFERENCE_REQUIRED/i);
  });

  it("R21: Batch import with GOOGLE_TRENDS_CSV where row check fails (KEYWORD_MISMATCH) throws 422 CSV_ROW_MISMATCH", async () => {
    await expect(
      executeDemandObservationBatchImport({
        workspaceId: testWorkspaceId,
        productId: testProductId,
        source: "GOOGLE_TRENDS_CSV",
        strictProvenance: true,
        points: [
          {
            periodStart: dates[0],
            demandValue: 50,
            keyword: "incorrect cat feeder keyword",
            region: "US",
            evidenceReference: evidenceRef,
          },
        ],
      })
    ).rejects.toThrow(/CSV_ROW_MISMATCH|KEYWORD_MISMATCH/i);
  });

  it("R22: Batch import with mixed point sources in single batch throws 422 MIXED_SOURCE_BATCH_REJECTED", async () => {
    await expect(
      executeDemandObservationBatchImport({
        workspaceId: testWorkspaceId,
        productId: testProductId,
        source: "GOOGLE_TRENDS_CSV",
        strictProvenance: true,
        points: [
          {
            periodStart: dates[0],
            demandValue: 50,
            keyword: "automatic cat feeder",
            region: "US",
            evidenceReference: evidenceRef,
          },
          {
            periodStart: dates[1],
            demandValue: 53,
            keyword: "automatic cat feeder",
            region: "US",
            source: "MOCK_STATIC" as any,
          },
        ],
      })
    ).rejects.toThrow(/MIXED_SOURCE_BATCH_REJECTED|MIXED_SOURCES_NOT_PERMITTED/i);
  });

  it("R23: Batch import with PROVIDER_API and missing authentic receipt throws 422 PROVIDER_RECEIPT_REQUIRED", async () => {
    await expect(
      executeDemandObservationBatchImport({
        workspaceId: testWorkspaceId,
        productId: testProductId,
        source: "PROVIDER_API",
        strictProvenance: true,
        points: [
          {
            periodStart: dates[0],
            demandValue: 50,
            keyword: "automatic cat feeder",
            region: "US",
            evidenceReference: "unverified_mock_provider",
          },
        ],
      })
    ).rejects.toThrow(/authentic provider receipt verification|PROVIDER_RECEIPT_REQUIRED/i);
  });

  it("R24: Batch import transaction rollback on 5th row failure leaves DB with 0 inserted rows", async () => {
    // 4 good rows, 5th has mismatched value within 0-100 range
    const points = [0, 1, 2, 3, 4].map((idx) => ({
      periodStart: dates[idx],
      demandValue: idx === 4 ? 99 : 50 + idx * 3, // 5th row is 99 vs CSV 62 -> fails VALUE_MISMATCH
      keyword: "automatic cat feeder",
      region: "US",
      evidenceReference: evidenceRef,
    }));

    await expect(
      executeDemandObservationBatchImport({
        workspaceId: testWorkspaceId,
        productId: testProductId,
        source: "GOOGLE_TRENDS_CSV",
        strictProvenance: true,
        points,
      })
    ).rejects.toThrow(/CSV_ROW_MISMATCH|VALUE_MISMATCH/i);

    const count = await prisma.productDemandObservation.count({
      where: { productId: testProductId },
    });
    expect(count).toBe(0);
  });

  it("R25: Idempotency of batch import with identical points: duplicate upsert succeeds cleanly", async () => {
    const points = [
      {
        periodStart: dates[0],
        demandValue: 50,
        keyword: "automatic cat feeder",
        region: "US",
        evidenceReference: evidenceRef,
      },
    ];

    const res1 = await executeDemandObservationBatchImport({
      workspaceId: testWorkspaceId,
      productId: testProductId,
      source: "GOOGLE_TRENDS_CSV",
      strictProvenance: true,
      points,
    });
    expect(res1.insertedCount).toBe(1);

    const res2 = await executeDemandObservationBatchImport({
      workspaceId: testWorkspaceId,
      productId: testProductId,
      source: "GOOGLE_TRENDS_CSV",
      strictProvenance: true,
      points,
    });
    expect(res2.insertedCount).toBe(0);
    expect(res2.skippedCount).toBe(1);

    const count = await prisma.productDemandObservation.count({
      where: { productId: testProductId },
    });
    expect(count).toBe(1);
  });

  it("R26: Partial / malformed payload missing periodStart or date rejected at batch validation", async () => {
    await expect(
      executeDemandObservationBatchImport({
        workspaceId: testWorkspaceId,
        productId: testProductId,
        source: "GOOGLE_TRENDS_CSV",
        strictProvenance: true,
        points: [
          {
            periodStart: "invalid-date",
            demandValue: 50,
            keyword: "automatic cat feeder",
            region: "US",
            evidenceReference: evidenceRef,
          },
        ],
      })
    ).rejects.toThrow(/INVALID_DATE|Invalid periodStart date/i);
  });

  it("R27: High-concurrency sequential imports do not corrupt raw CSV files on disk", async () => {
    const statBefore = fs.statSync(csvFilePath);

    // Run 5 sequential imports
    for (let i = 0; i < 5; i++) {
      await executeDemandObservationBatchImport({
        workspaceId: testWorkspaceId,
        productId: testProductId,
        source: "GOOGLE_TRENDS_CSV",
        strictProvenance: true,
        points: [
          {
            periodStart: dates[i],
            demandValue: 50 + i * 3,
            keyword: "automatic cat feeder",
            region: "US",
            evidenceReference: evidenceRef,
          },
        ],
      });
    }

    const statAfter = fs.statSync(csvFilePath);
    expect(statAfter.mtimeMs).toBe(statBefore.mtimeMs);
    expect(statAfter.size).toBe(statBefore.size);
  });

  it("R28: evaluateDemandSourceAuthority demotes when any observation has unbacked CSV lineage", () => {
    const observations = [
      {
        id: "obs_r28_1",
        productId: testProductId,
        source: "GOOGLE_TRENDS_CSV",
        rawCsvSha256: csvSha256,
        evidenceReference: evidenceRef,
        demandValue: 50,
        keyword: "automatic cat feeder",
        region: "US",
        periodStart: dates[0],
      },
      {
        id: "obs_r28_2",
        productId: testProductId,
        source: "GOOGLE_TRENDS_CSV",
        rawCsvSha256: "e".repeat(64), // missing file
        evidenceReference: `csv-import:google-trends-explore:sha256:${"e".repeat(64)}:q=automatic_cat_feeder`,
        demandValue: 53,
        keyword: "automatic cat feeder",
        region: "US",
        periodStart: dates[1],
      },
    ];

    const assessment = evaluateDemandSourceAuthority(observations as any);
    expect(assessment.authority).toBe("CACHED_UNVERIFIED");
    expect(assessment.productAttributionValid).toBe(false);
  });
});
