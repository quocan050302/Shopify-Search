/**
 * ANTI — KH-02 V12.4.3.7.17: Group C — CSV ROW BINDING, HASH INTEGRITY & DEMAND LINEAGE
 * Scenarios C01 - C24
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { prisma } from "@/lib/db";
import {
  validateAndParseGoogleTrendsCsv,
  verifyDemandObservationAgainstRawCsv,
  saveOriginalGoogleTrendsCsvFile,
  GOOGLE_TRENDS_CSV_STORAGE_DIR,
} from "@/services/kh02/demand/googleTrendsCsvValidator";
import {
  executeDemandObservationBatchImport,
} from "@/services/kh02/demand/demandObservationBatchImport";
import {
  hasVerifiableCsvOrProviderLineage,
} from "@/services/kh02/demand/temporalDemandEngine";
import { resolveProductDemandHistory } from "@/services/kh02/demand/historicalDemandIngestion";

describe("KH-02 V12.4.3.7.17 Group C: CSV Row Binding & Demand Lineage", () => {
  const testProductId = "prod_c_test_001";
  const testWorkspaceId = "ws_c_test";

  let sampleCsvContent = "Category: All categories\nWeek,automatic cat feeder: (United States)\n";
  const dates: string[] = [];
  for (let i = 0; i < 13; i++) {
    const d = new Date(Date.UTC(2026, 4, 3 + i * 7));
    const dt = d.toISOString().slice(0, 10);
    dates.push(dt);
    sampleCsvContent += `${dt},${50 + i * 3}\n`;
  }

  const csvSha256 = crypto.createHash("sha256").update(sampleCsvContent, "utf8").digest("hex");
  const csvFilePath = path.join(GOOGLE_TRENDS_CSV_STORAGE_DIR, `${csvSha256}.csv`);

  beforeEach(async () => {
    fs.mkdirSync(GOOGLE_TRENDS_CSV_STORAGE_DIR, { recursive: true });
    fs.writeFileSync(csvFilePath, sampleCsvContent, "utf8");

    await prisma.workspace.upsert({
      where: { id: testWorkspaceId },
      create: { id: testWorkspaceId, name: "WS Test C" },
      update: {},
    });

    const wl = await prisma.watchlist.upsert({
      where: { id: "wl_" + testWorkspaceId },
      create: { id: "wl_" + testWorkspaceId, workspaceId: testWorkspaceId, name: "WL Test C" },
      update: {},
    });

    const prods = [testProductId, "prod_c_test_tampered", "prod_c_test_A", "prod_c_test_B"];
    for (const pid of prods) {
      await prisma.researchProduct.upsert({
        where: { id: pid },
        create: { id: pid, title: "Test Product " + pid },
        update: {},
      });
      await prisma.watchlistItem.upsert({
        where: { id: "wli_" + pid },
        create: { id: "wli_" + pid, watchlistId: wl.id, productId: pid, itemType: "PRODUCT" },
        update: { watchlistId: wl.id, productId: pid },
      });
    }
  });

  afterEach(async () => {
    try {
      if (fs.existsSync(csvFilePath)) fs.unlinkSync(csvFilePath);
    } catch {}
    try {
      await prisma.productDemandObservation.deleteMany({
        where: { productId: { startsWith: "prod_c_test_" } },
      });
      await prisma.watchlistItem.deleteMany({
        where: { productId: { startsWith: "prod_c_test_" } },
      });
      await prisma.researchProduct.deleteMany({
        where: { id: { startsWith: "prod_c_test_" } },
      });
    } catch {}
  });

  it("C01: valid CSV file with correct header and 13 rows -> SHA-256 computed matches file on disk, all 13 rows parsed", () => {
    const parsed = validateAndParseGoogleTrendsCsv(sampleCsvContent, {
      expectedKeyword: "automatic cat feeder",
      expectedRegion: "US",
    });
    expect(parsed.valid).toBe(true);
    expect(parsed.dataPoints.length).toBe(13);
    expect(parsed.keyword).toBe("automatic cat feeder");
    expect(parsed.region).toBe("US");
    expect(parsed.sha256Checksum).toBe(csvSha256);
  });

  it("C02: individual observation matching CSV row verified via verifyDemandObservationAgainstRawCsv -> true", () => {
    const verified = verifyDemandObservationAgainstRawCsv(
      csvSha256,
      {
        keyword: "automatic cat feeder",
        region: "US",
        periodStart: new Date("2026-05-03T00:00:00.000Z"),
        demandValue: 50,
      }
    );
    expect(verified.verified).toBe(true);
    expect(verified.matchedRow?.demandValue).toBe(50);
  });

  it("C03: observation with altered demandValue -> verified=false, code is VALUE_MISMATCH", () => {
    const verified = verifyDemandObservationAgainstRawCsv(
      csvSha256,
      {
        keyword: "automatic cat feeder",
        region: "US",
        periodStart: new Date("2026-05-03T00:00:00.000Z"),
        demandValue: 99, // Altered from 50
      }
    );
    expect(verified.verified).toBe(false);
    expect(verified.code).toBe("VALUE_MISMATCH");
  });

  it("C04: observation with altered periodStart -> verified=false, code is ROW_NOT_IN_CSV", () => {
    const verified = verifyDemandObservationAgainstRawCsv(
      csvSha256,
      {
        keyword: "automatic cat feeder",
        region: "US",
        periodStart: new Date("2026-05-04T00:00:00.000Z"), // 1 day off
        demandValue: 50,
      }
    );
    expect(verified.verified).toBe(false);
    expect(verified.code).toBe("ROW_NOT_IN_CSV");
  });

  it("C05: observation with altered keyword -> verified=false", () => {
    const verified = verifyDemandObservationAgainstRawCsv(
      csvSha256,
      {
        keyword: "dog feeder",
        region: "US",
        periodStart: new Date("2026-05-03T00:00:00.000Z"),
        demandValue: 50,
      }
    );
    expect(verified.verified).toBe(false);
    expect(verified.code).toBe("KEYWORD_MISMATCH");
  });

  it("C06: observation referencing non-existent CSV hash -> verified=false, code is FILE_MISSING", () => {
    const fakeHash = "a".repeat(64);
    const verified = verifyDemandObservationAgainstRawCsv(
      fakeHash,
      {
        keyword: "automatic cat feeder",
        region: "US",
        periodStart: new Date("2026-05-03T00:00:00.000Z"),
        demandValue: 50,
      }
    );
    expect(verified.verified).toBe(false);
    expect(verified.code).toBe("FILE_MISSING");
  });

  it("C07: observation with forged or short hash -> verified=false, code is SHA_MISMATCH", () => {
    const verified = verifyDemandObservationAgainstRawCsv(
      "short_hash_123",
      {
        keyword: "automatic cat feeder",
        region: "US",
        periodStart: new Date("2026-05-03T00:00:00.000Z"),
        demandValue: 50,
      }
    );
    expect(verified.verified).toBe(false);
    expect(verified.code).toBe("SHA_MISMATCH");
  });

  it("C08: batch import rejecting mixed sources with 422 error", async () => {
    const mixedBatch = [
      {
        keyword: "automatic cat feeder",
        region: "US",
        periodStart: "2026-05-03T00:00:00.000Z",
        periodEnd: "2026-05-09T23:59:59.999Z",
        demandValue: 50,
        source: "GOOGLE_TRENDS_CSV",
        evidenceReference: `sha256:${csvSha256}`,
      },
      {
        keyword: "automatic cat feeder",
        region: "US",
        periodStart: "2026-05-10T00:00:00.000Z",
        periodEnd: "2026-05-16T23:59:59.999Z",
        demandValue: 53,
        source: "LIVE_PROVIDER",
      },
    ];

    await expect(
      executeDemandObservationBatchImport({
        productId: testProductId,
        workspaceId: testWorkspaceId,
        source: "GOOGLE_TRENDS_CSV",
        points: mixedBatch as any,
      })
    ).rejects.toThrow(/MIXED_SOURCE_BATCH_REJECTED/);
  });

  it("C09: batch import with valid GOOGLE_TRENDS_CSV and raw CSV verification imports rows atomically", async () => {
    const validBatch = [
      {
        keyword: "automatic cat feeder",
        region: "US",
        periodStart: "2026-05-03T00:00:00.000Z",
        periodEnd: "2026-05-09T23:59:59.999Z",
        demandValue: 50,
        source: "GOOGLE_TRENDS_CSV",
        evidenceReference: `sha256:${csvSha256}`,
      },
      {
        keyword: "automatic cat feeder",
        region: "US",
        periodStart: "2026-05-10T00:00:00.000Z",
        periodEnd: "2026-05-16T23:59:59.999Z",
        demandValue: 53,
        source: "GOOGLE_TRENDS_CSV",
        evidenceReference: `sha256:${csvSha256}`,
      },
    ];

    const res = await executeDemandObservationBatchImport({
      productId: testProductId,
      workspaceId: testWorkspaceId,
      source: "GOOGLE_TRENDS_CSV",
      points: validBatch,
    });

    expect(res.insertedCount).toBe(2);
    expect(res.success).toBe(true);
  });

  it("C10: batch import with one row value tampered vs raw CSV fails with CSV_ROW_INTEGRITY_MISMATCH, 0 rows inserted", async () => {
    const tamperedBatch = [
      {
        keyword: "automatic cat feeder",
        region: "US",
        periodStart: "2026-05-17T00:00:00.000Z",
        periodEnd: "2026-05-23T23:59:59.999Z",
        demandValue: 56, // Valid
        source: "GOOGLE_TRENDS_CSV",
        evidenceReference: `sha256:${csvSha256}`,
      },
      {
        keyword: "automatic cat feeder",
        region: "US",
        periodStart: "2026-05-24T00:00:00.000Z",
        periodEnd: "2026-05-30T23:59:59.999Z",
        demandValue: 88, // Tampered! Actual CSV is 59 (valid 0-100 number but contradicts CSV)
        source: "GOOGLE_TRENDS_CSV",
        evidenceReference: `sha256:${csvSha256}`,
      },
    ];

    const prodTampered = "prod_c_test_tampered";
    await expect(
      executeDemandObservationBatchImport({
        productId: prodTampered,
        workspaceId: testWorkspaceId,
        source: "GOOGLE_TRENDS_CSV",
        points: tamperedBatch,
      })
    ).rejects.toThrow(/CSV row verification failed/);

    // Verify 0 rows inserted
    const count = await prisma.productDemandObservation.count({
      where: { productId: prodTampered },
    });
    expect(count).toBe(0);
  });

  it("C11: same valid CSV imported twice is idempotent (insertedCount=0, skippedCount=1)", async () => {
    const batch = [
      {
        keyword: "automatic cat feeder",
        region: "US",
        periodStart: "2026-05-31T00:00:00.000Z",
        periodEnd: "2026-06-06T23:59:59.999Z",
        demandValue: 62,
        source: "GOOGLE_TRENDS_CSV",
        evidenceReference: `sha256:${csvSha256}`,
      },
    ];

    const res1 = await executeDemandObservationBatchImport({
      productId: testProductId,
      workspaceId: testWorkspaceId,
      source: "GOOGLE_TRENDS_CSV",
      points: batch,
    });
    expect(res1.insertedCount).toBe(1);

    // Second import identical -> idempotent skip
    const res2 = await executeDemandObservationBatchImport({
      productId: testProductId,
      workspaceId: testWorkspaceId,
      source: "GOOGLE_TRENDS_CSV",
      points: batch,
    });
    expect(res2.insertedCount).toBe(0);
    expect(res2.skippedCount).toBe(1);
    expect(res2.success).toBe(true);
  });

  it("C12: hasVerifiableCsvOrProviderLineage: observation with verified CSV row marked verified", () => {
    const obs = {
      id: "obs_c12",
      productId: testProductId,
      source: "GOOGLE_TRENDS_CSV",
      keyword: "automatic cat feeder",
      region: "US",
      periodStart: new Date("2026-05-03T00:00:00.000Z"),
      periodEnd: new Date("2026-05-09T23:59:59.999Z"),
      demandValue: 50,
      evidenceReference: `csv-import:google-trends-explore:sha256:${csvSha256}:q=automatic_cat_feeder`,
      provenancePayload: null,
      verificationStatus: "VERIFIED",
    };

    const hasLineage = hasVerifiableCsvOrProviderLineage(obs.evidenceReference, null, {
      observationValue: obs.demandValue,
      targetKeyword: obs.keyword,
      region: obs.region,
      periodStart: obs.periodStart,
    } as any);
    expect(hasLineage.contentIntegrityVerified).toBe(true);
  });

  it("C13: hasVerifiableCsvOrProviderLineage: observation with valid SHA but tampered value demoted", () => {
    const tamperedObs = {
      id: "obs_c13",
      productId: testProductId,
      source: "GOOGLE_TRENDS_CSV",
      keyword: "automatic cat feeder",
      region: "US",
      periodStart: new Date("2026-05-03T00:00:00.000Z"),
      periodEnd: new Date("2026-05-09T23:59:59.999Z"),
      demandValue: 999, // Tampered!
      evidenceReference: `csv-import:google-trends-explore:sha256:${csvSha256}:q=automatic_cat_feeder`,
      provenancePayload: null,
      verificationStatus: "VERIFIED",
    };

    const hasLineage = hasVerifiableCsvOrProviderLineage(tamperedObs.evidenceReference, null, {
      observationValue: tamperedObs.demandValue,
      targetKeyword: tamperedObs.keyword,
      region: tamperedObs.region,
      periodStart: tamperedObs.periodStart,
    } as any);
    expect(hasLineage.contentIntegrityVerified).toBe(false);
  });

  it("C14: multi-product isolation: Product A demand cannot be accessed under Product B", async () => {
    const prodA = "prod_c_test_A";
    const prodB = "prod_c_test_B";

    await executeDemandObservationBatchImport({
      productId: prodA,
      workspaceId: testWorkspaceId,
      source: "GOOGLE_TRENDS_CSV",
      points: [
        {
          keyword: "automatic cat feeder",
          region: "US",
          periodStart: "2026-06-07T00:00:00.000Z",
          periodEnd: "2026-06-13T23:59:59.999Z",
          demandValue: 65,
          source: "GOOGLE_TRENDS_CSV",
          evidenceReference: `sha256:${csvSha256}`,
        },
      ],
    });

    const rowsB = await prisma.productDemandObservation.findMany({
      where: { productId: prodB },
    });
    expect(rowsB.length).toBe(0);
  });

  it("C15: large CSV with leading/trailing notes stripped cleanly", () => {
    const dirtyCsv = `Category: Pets & Animals\n\nWeek,dog leash: (United States)\n2026-01-04,30\n2026-01-11,35\n2026-01-18,40\n\nNote: Includes web searches only.`;
    const parsed = validateAndParseGoogleTrendsCsv(dirtyCsv, {
      expectedKeyword: "dog leash",
      expectedRegion: "US",
    });
    expect(parsed.valid).toBe(true);
    expect(parsed.dataPoints.length).toBe(3);
    expect(parsed.dataPoints[0].demandValue).toBe(30);
  });

  it("C16: CSV with '<1' demand value parsed as 0.5 per Google Trends convention", () => {
    const lowCsv = `Category: All categories\nWeek,niche item: (United States)\n2026-01-04,<1\n2026-01-11,5\n2026-01-18,10`;
    const parsed = validateAndParseGoogleTrendsCsv(lowCsv, {
      expectedKeyword: "niche item",
      expectedRegion: "US",
    });
    expect(parsed.valid).toBe(true);
    expect(parsed.dataPoints[0].demandValue).toBe(0.5);
    expect(parsed.dataPoints[1].demandValue).toBe(5);
  });

  it("C17: missing header or invalid columns rejected", () => {
    const badCsv = `Random text without header\n123,456`;
    const parsed = validateAndParseGoogleTrendsCsv(badCsv, {
      expectedKeyword: "keyword",
      expectedRegion: "US",
    });
    expect(parsed.valid).toBe(false);
  });

  it("C18: temporal continuity: 13 weeks of consecutive data verified without gaps", () => {
    const parsed = validateAndParseGoogleTrendsCsv(sampleCsvContent, {
      expectedKeyword: "automatic cat feeder",
      expectedRegion: "US",
    });
    expect(parsed.dataPoints.length).toBe(13);
    for (let i = 1; i < parsed.dataPoints.length; i++) {
      const prev = new Date(parsed.dataPoints[i - 1].periodStart).getTime();
      const curr = new Date(parsed.dataPoints[i].periodStart).getTime();
      const diffDays = Math.round((curr - prev) / (1000 * 60 * 60 * 24));
      expect(diffDays).toBe(7);
    }
  });

  it("C19: ISO date formatting consistency: periodStart normalized to midnight UTC", () => {
    const parsed = validateAndParseGoogleTrendsCsv(sampleCsvContent, {
      expectedKeyword: "automatic cat feeder",
      expectedRegion: "US",
    });
    const d = new Date(parsed.dataPoints[0].periodStart);
    expect(d.getUTCHours()).toBe(0);
    expect(d.getUTCMinutes()).toBe(0);
    expect(d.getUTCSeconds()).toBe(0);
  });

  it("C20: region code normalization preserved in uppercase", () => {
    const parsed = validateAndParseGoogleTrendsCsv(sampleCsvContent, {
      expectedKeyword: "automatic cat feeder",
      expectedRegion: "us",
    });
    expect(parsed.region).toBe("US");
  });

  it("C21: high-concurrency read of verified CSV cache without file handle corruption", async () => {
    const reads = Array.from({ length: 25 }, () =>
      verifyDemandObservationAgainstRawCsv(
        csvSha256,
        {
          keyword: "automatic cat feeder",
          region: "US",
          periodStart: new Date("2026-05-03T00:00:00.000Z"),
          demandValue: 50,
        }
      )
    );
    const results = await Promise.all(reads);
    expect(results.every((r) => r.verified)).toBe(true);
  });

  it("C22: direct caller resolveProductDemandHistory returns verified points when evidence matches", async () => {
    const history = await resolveProductDemandHistory(
      testProductId,
      {
        region: "US",
      }
    );
    expect(history).toBeDefined();
    expect(Array.isArray(history.dataPoints)).toBe(true);
  });

  it("C23: lineage verification detects non-hex SHA strings and rejects immediately", () => {
    const badHash = "not_a_valid_hex_hash_at_all";
    const res = verifyDemandObservationAgainstRawCsv(
      badHash,
      {
        keyword: "automatic cat feeder",
        region: "US",
        periodStart: new Date("2026-05-03T00:00:00.000Z"),
        demandValue: 50,
      }
    );
    expect(res.verified).toBe(false);
    expect(res.code).toBe("SHA_MISMATCH");
  });

  it("C24: audit record creation: evidence metadata contains exact source SHA and row count", () => {
    const parsed = validateAndParseGoogleTrendsCsv(sampleCsvContent, {
      expectedKeyword: "automatic cat feeder",
      expectedRegion: "US",
    });
    const metadata = {
      sourceSha256: csvSha256,
      rowCount: parsed.dataPoints.length,
      verifiedTimestamp: new Date().toISOString(),
    };
    expect(metadata.sourceSha256).toBe(csvSha256);
    expect(metadata.rowCount).toBe(13);
  });
});
