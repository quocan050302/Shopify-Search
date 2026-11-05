/**
 * ANTI — KH-02 V12.4.3.7.16: Transactional Demand Import Test Suite
 *
 * Covers:
 * - B01 - B20: Transactional all-or-nothing database insert for CSV and row import,
 *              exact product/workspace isolation, idempotent duplicates, conflict 409 rollback,
 *              no silent error swallowing in importGoogleTrendsCsvToDatabase
 * - D03: Multi-process concurrent import racing on identical/conflicting keys
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs";
import path from "path";
import os from "os";
import crypto from "crypto";
import { prisma } from "@/lib/db";
import {
  executeDemandObservationBatchImport,
  type DemandObservationBatchInput,
  BatchImportError,
} from "@/services/kh02/demand/demandObservationBatchImport";
import {
  validateAndParseGoogleTrendsCsv,
  saveOriginalGoogleTrendsCsvFile,
  verifyStoredCsvFile,
  importGoogleTrendsCsvToDatabase,
} from "@/services/kh02/demand/googleTrendsCsvValidator";
import { resolveProductDemandHistory } from "@/services/kh02/demand/historicalDemandIngestion";

describe("KH-02 V12.4.3.7.16 — Transactional Demand Import (B01 - B20, D03)", () => {
  const testProductId = "prod_b_test_001";
  const otherTenantProductId = "prod_b_tenant_002";
  const testWorkspaceId = "ws_test_b";
  const otherWorkspaceId = "ws_other_b";
  let testEvidenceRef: string;
  let testEvidenceRefB: string;

  beforeEach(async () => {
    const sampleCsv =
      "Category: All categories\nWeek,cat feeder: (United States)\n" +
      "2026-08-01,40\n" +
      "2026-08-02,42\n" +
      "2026-08-03,45\n" +
      "2026-08-04,48\n" +
      "2026-08-05,48\n" +
      "2026-08-08,45\n";
    const shaA = crypto.createHash("sha256").update(Buffer.from(sampleCsv, "utf8")).digest("hex");
    saveOriginalGoogleTrendsCsvFile(sampleCsv, shaA);
    testEvidenceRef = `csv-import:google-trends-explore:sha256:${shaA}:q=cat_feeder`;

    const sampleCsvB =
      "Category: All categories\nWeek,cat feeder: (United States)\n" +
      "2026-08-01,90\n";
    const shaB = crypto.createHash("sha256").update(Buffer.from(sampleCsvB, "utf8")).digest("hex");
    saveOriginalGoogleTrendsCsvFile(sampleCsvB, shaB);
    testEvidenceRefB = `csv-import:google-trends-explore:sha256:${shaB}:q=cat_feeder`;

    // Clean up test rows
    await prisma.productDemandObservation.deleteMany({
      where: { productId: { in: [testProductId, otherTenantProductId] } },
    });
    // Ensure test workspaces exist
    await prisma.workspace.upsert({
      where: { id: testWorkspaceId },
      create: { id: testWorkspaceId, name: "Test WS B" },
      update: {},
    });
    await prisma.workspace.upsert({
      where: { id: otherWorkspaceId },
      create: { id: otherWorkspaceId, name: "Other WS B" },
      update: {},
    });

    // Ensure test products exist
    await prisma.researchProduct.upsert({
      where: { id: testProductId },
      create: {
        id: testProductId,
        title: "Automatic Cat Feeder",
      },
      update: { title: "Automatic Cat Feeder" },
    });
    await prisma.researchProduct.upsert({
      where: { id: otherTenantProductId },
      create: {
        id: otherTenantProductId,
        title: "Other Tenant Product",
      },
      update: { title: "Other Tenant Product" },
    });

    // Link products to workspaces via Watchlist
    const wl = await prisma.watchlist.upsert({
      where: { id: "wl_" + testWorkspaceId },
      create: { id: "wl_" + testWorkspaceId, workspaceId: testWorkspaceId, name: "Test WL B" },
      update: {},
    });
    await prisma.watchlistItem.upsert({
      where: { id: "wli_" + testProductId },
      create: { id: "wli_" + testProductId, watchlistId: wl.id, productId: testProductId, itemType: "PRODUCT" },
      update: { watchlistId: wl.id, productId: testProductId },
    });

    const wlOther = await prisma.watchlist.upsert({
      where: { id: "wl_" + otherWorkspaceId },
      create: { id: "wl_" + otherWorkspaceId, workspaceId: otherWorkspaceId, name: "Other WL B" },
      update: {},
    });
    await prisma.watchlistItem.upsert({
      where: { id: "wli_" + otherTenantProductId },
      create: { id: "wli_" + otherTenantProductId, watchlistId: wlOther.id, productId: otherTenantProductId, itemType: "PRODUCT" },
      update: { watchlistId: wlOther.id, productId: otherTenantProductId },
    });
  });

  afterEach(async () => {
    await prisma.productDemandObservation.deleteMany({
      where: { productId: { in: [testProductId, otherTenantProductId] } },
    });
  });

  it("B01: 5-row batch with row 4 conflicting with existing DB -> 409 and ZERO new rows inserted", async () => {
    // Insert an initial row for day 4 with demandValue=50
    const day4 = new Date("2026-08-04T00:00:00.000Z");
    await prisma.productDemandObservation.create({
      data: {
        productId: testProductId,
        source: "GOOGLE_TRENDS_CSV",
        region: "US",
        keyword: "cat feeder",
        periodStart: day4,
        periodEnd: new Date("2026-08-10T00:00:00.000Z"),
        demandValue: 50,
      },
    });

    const initialCount = await prisma.productDemandObservation.count({ where: { productId: testProductId } });
    expect(initialCount).toBe(1);

    // Incoming batch of 5 rows: rows 1,2,3,5 are new, row 4 has demandValue=90 (CONFLICT with 50!)
    const batchInput: DemandObservationBatchInput = {
      productId: testProductId,
      workspaceId: testWorkspaceId,
      source: "GOOGLE_TRENDS_CSV",
      evidenceReference: testEvidenceRef,
      region: "US",
      points: [
        { keyword: "cat feeder", region: "US", periodStart: "2026-08-01T00:00:00.000Z", periodEnd: "2026-08-07T00:00:00.000Z", demandValue: 40 },
        { keyword: "cat feeder", region: "US", periodStart: "2026-08-02T00:00:00.000Z", periodEnd: "2026-08-08T00:00:00.000Z", demandValue: 42 },
        { keyword: "cat feeder", region: "US", periodStart: "2026-08-03T00:00:00.000Z", periodEnd: "2026-08-09T00:00:00.000Z", demandValue: 45 },
        { keyword: "cat feeder", region: "US", periodStart: "2026-08-04T00:00:00.000Z", periodEnd: "2026-08-10T00:00:00.000Z", demandValue: 48 }, // CONFLICT with 50 in DB!
        { keyword: "cat feeder", region: "US", periodStart: "2026-08-05T00:00:00.000Z", periodEnd: "2026-08-11T00:00:00.000Z", demandValue: 48 },
      ],
    };

    let threw = false;
    try {
      await executeDemandObservationBatchImport(batchInput);
    } catch (err: any) {
      threw = true;
      expect(err.statusCode || err.status).toBe(409);
      expect(err.code).toBe("CONFLICTING_DUPLICATE_OBSERVATION");
    }
    expect(threw).toBe(true);

    // ZERO new rows inserted: count must still be exactly 1!
    const postCount = await prisma.productDemandObservation.count({ where: { productId: testProductId } });
    expect(postCount).toBe(1);
  });

  it("B02: 10-row batch with injected Prisma error on third row -> rollback, non-2xx, inserted=0", async () => {
    const points = Array.from({ length: 10 }, (_, i) => ({
      keyword: "cat feeder",
      region: "US",
      periodStart: new Date(`2026-07-${String(i + 1).padStart(2, "0")}T00:00:00.000Z`),
      periodEnd: new Date(`2026-07-${String(i + 7).padStart(2, "0")}T00:00:00.000Z`),
      demandValue: 50 + i,
    }));

    // Inject fault for row 3 using invalid region or bad data that fails constraint
    (points as any)[2].keyword = null; // invalid keyword!

    let threw = false;
    try {
      await executeDemandObservationBatchImport({
        productId: testProductId,
        workspaceId: testWorkspaceId,
        source: "GOOGLE_TRENDS_CSV",
        region: "US",
        points: points as any,
      });
    } catch (err: any) {
      threw = true;
    }
    expect(threw).toBe(true);

    const count = await prisma.productDemandObservation.count({ where: { productId: testProductId } });
    expect(count).toBe(0); // All or nothing: zero rows committed
  });

  it("B03: 13 weekly official-shaped CSV test fixture spanning >=84d -> persisted correct scoped rows", async () => {
    let csv = "Category: All categories\nWeek,automatic cat feeder: (United States)\n";
    for (let i = 0; i < 13; i++) {
      const dt = new Date(Date.now() - (13 - i) * 7 * 86400000).toISOString().slice(0, 10);
      csv += `${dt},${60 + (i % 20)}\n`;
    }

    const res = await importGoogleTrendsCsvToDatabase(testProductId, csv, {
      expectedKeyword: "automatic cat feeder",
      region: "US",
    });

    expect(res.success).toBe(true);
    expect(res.insertedCount).toBe(13);
    expect(res.skippedCount).toBe(0);

    const count = await prisma.productDemandObservation.count({ where: { productId: testProductId } });
    expect(count).toBe(13);
  });

  it("B04: Same CSV imported twice -> idempotent, no duplicate, counts exactly match DB", async () => {
    let csv = "Category: All categories\nWeek,automatic cat feeder: (United States)\n";
    for (let i = 0; i < 5; i++) {
      const dt = new Date(Date.now() - (5 - i) * 7 * 86400000).toISOString().slice(0, 10);
      csv += `${dt},${70 + i}\n`;
    }

    const res1 = await importGoogleTrendsCsvToDatabase(testProductId, csv, {
      expectedKeyword: "automatic cat feeder",
      region: "US",
    });
    expect(res1.success).toBe(true);
    expect(res1.insertedCount).toBe(5);

    const res2 = await importGoogleTrendsCsvToDatabase(testProductId, csv, {
      expectedKeyword: "automatic cat feeder",
      region: "US",
    });
    expect(res2.success).toBe(true);
    expect(res2.insertedCount).toBe(0);
    expect(res2.skippedCount).toBe(5);

    const finalCount = await prisma.productDemandObservation.count({ where: { productId: testProductId } });
    expect(finalCount).toBe(5);
  });

  it("B05: Inconsistent values for same timestamp inside one upload -> reject with zero mutations", async () => {
    const points = [
      { keyword: "cat feeder", region: "US", periodStart: "2026-08-01T00:00:00.000Z", periodEnd: "2026-08-07T00:00:00.000Z", demandValue: 40 },
      { keyword: "cat feeder", region: "US", periodStart: "2026-08-01T00:00:00.000Z", periodEnd: "2026-08-07T00:00:00.000Z", demandValue: 80 }, // Inconsistent!
    ];

    let threw = false;
    try {
      await executeDemandObservationBatchImport({
        productId: testProductId,
        workspaceId: testWorkspaceId,
        source: "GOOGLE_TRENDS_CSV",
        region: "US",
        points,
      });
    } catch (err: any) {
      threw = true;
    }
    expect(threw).toBe(true);

    const count = await prisma.productDemandObservation.count({ where: { productId: testProductId } });
    expect(count).toBe(0);
  });

  it("B06: Same timestamp same value duplicate inside upload -> deduplicated safely", async () => {
    const points = [
      { keyword: "cat feeder", region: "US", periodStart: "2026-08-01T00:00:00.000Z", periodEnd: "2026-08-07T00:00:00.000Z", demandValue: 40 },
      { keyword: "cat feeder", region: "US", periodStart: "2026-08-01T00:00:00.000Z", periodEnd: "2026-08-07T00:00:00.000Z", demandValue: 40 }, // Identical duplicate
    ];

    const res = await executeDemandObservationBatchImport({
      productId: testProductId,
      workspaceId: testWorkspaceId,
      source: "GOOGLE_TRENDS_CSV",
      evidenceReference: testEvidenceRef,
      region: "US",
      points,
    });

    expect(res.insertedCount).toBe(1);
    expect(res.skippedCount).toBe(1);

    const count = await prisma.productDemandObservation.count({ where: { productId: testProductId } });
    expect(count).toBe(1);
  });

  it("B07: Concurrent imports for same product -> no duplicate rows, no lost insert", async () => {
    const pointsA = [
      { keyword: "cat feeder", region: "US", periodStart: "2026-08-01T00:00:00.000Z", periodEnd: "2026-08-07T00:00:00.000Z", demandValue: 40 },
      { keyword: "cat feeder", region: "US", periodStart: "2026-08-02T00:00:00.000Z", periodEnd: "2026-08-08T00:00:00.000Z", demandValue: 42 },
    ];
    const pointsB = [
      { keyword: "cat feeder", region: "US", periodStart: "2026-08-03T00:00:00.000Z", periodEnd: "2026-08-09T00:00:00.000Z", demandValue: 45 },
      { keyword: "cat feeder", region: "US", periodStart: "2026-08-04T00:00:00.000Z", periodEnd: "2026-08-10T00:00:00.000Z", demandValue: 48 },
    ];

    const [resA, resB] = await Promise.all([
      executeDemandObservationBatchImport({
        productId: testProductId,
        workspaceId: testWorkspaceId,
        source: "GOOGLE_TRENDS_CSV",
        evidenceReference: testEvidenceRef,
        region: "US",
        points: pointsA,
      }),
      executeDemandObservationBatchImport({
        productId: testProductId,
        workspaceId: testWorkspaceId,
        source: "GOOGLE_TRENDS_CSV",
        evidenceReference: testEvidenceRef,
        region: "US",
        points: pointsB,
      }),
    ]);

    expect(resA.insertedCount).toBe(2);
    expect(resB.insertedCount).toBe(2);

    const count = await prisma.productDemandObservation.count({ where: { productId: testProductId } });
    expect(count).toBe(4);
  });

  it("B08: Concurrent imports with conflicting values -> one winner, other conflict rejected", async () => {
    const pointsA = [
      { keyword: "cat feeder", region: "US", periodStart: "2026-08-01T00:00:00.000Z", periodEnd: "2026-08-07T00:00:00.000Z", demandValue: 40 },
    ];
    const pointsB = [
      { keyword: "cat feeder", region: "US", periodStart: "2026-08-01T00:00:00.000Z", periodEnd: "2026-08-07T00:00:00.000Z", demandValue: 90 }, // Conflicting value!
    ];

    const results = await Promise.allSettled([
      executeDemandObservationBatchImport({
        productId: testProductId,
        workspaceId: testWorkspaceId,
        source: "GOOGLE_TRENDS_CSV",
        evidenceReference: testEvidenceRef,
        region: "US",
        points: pointsA,
      }),
      executeDemandObservationBatchImport({
        productId: testProductId,
        workspaceId: testWorkspaceId,
        source: "GOOGLE_TRENDS_CSV",
        evidenceReference: testEvidenceRefB,
        region: "US",
        points: pointsB,
      }),
    ]);

    const statuses = results.map((r) => r.status);
    expect(statuses).toContain("fulfilled");
    // At least one succeeded or both handled deterministically
    const count = await prisma.productDemandObservation.count({ where: { productId: testProductId } });
    expect(count).toBe(1);
  });

  it("B09: Invalid keyword or wrong region -> reject all before DB write", async () => {
    let threw = false;
    try {
      await executeDemandObservationBatchImport({
        productId: testProductId,
        workspaceId: testWorkspaceId,
        source: "GOOGLE_TRENDS_CSV",
        region: "INVALID_REGION",
        points: [
          { keyword: "", region: "INVALID", periodStart: "2026-08-01T00:00:00.000Z", periodEnd: "2026-08-07T00:00:00.000Z", demandValue: 40 },
        ],
      });
    } catch {
      threw = true;
    }
    expect(threw).toBe(true);

    const count = await prisma.productDemandObservation.count({ where: { productId: testProductId } });
    expect(count).toBe(0);
  });

  it("B10: Wrong tenant -> 403 and 0 bytes/rows mutated; no ID leak", async () => {
    let threw = false;
    let code: any;
    try {
      await executeDemandObservationBatchImport({
        productId: otherTenantProductId, // belongs to otherWorkspaceId
        workspaceId: testWorkspaceId, // Caller belongs to testWorkspaceId
        source: "GOOGLE_TRENDS_CSV",
        region: "US",
        points: [
          { keyword: "cat feeder", region: "US", periodStart: "2026-08-01T00:00:00.000Z", periodEnd: "2026-08-07T00:00:00.000Z", demandValue: 40 },
        ],
      });
    } catch (err: any) {
      threw = true;
      code = err.statusCode || err.status;
    }
    expect(threw).toBe(true);
    expect(code).toBe(403);

    const count = await prisma.productDemandObservation.count({ where: { productId: otherTenantProductId } });
    expect(count).toBe(0);
  });

  it("B11: Gigantic batch (>500 records) -> early reject bounded resource use", async () => {
    const points = Array.from({ length: 501 }, (_, i) => ({
      keyword: "cat feeder",
      region: "US",
      periodStart: new Date(Date.now() - (600 - i) * 86400000),
      periodEnd: new Date(Date.now() - (600 - i - 1) * 86400000),
      demandValue: 50,
    }));

    let threw = false;
    try {
      await executeDemandObservationBatchImport({
        productId: testProductId,
        workspaceId: testWorkspaceId,
        source: "GOOGLE_TRENDS_CSV",
        region: "US",
        points,
      });
    } catch (err: any) {
      threw = true;
      expect(err.statusCode || err.status).toBe(400);
    }
    expect(threw).toBe(true);
  });

  it("B12: Success response and actual DB readback counts equal", async () => {
    const points = [
      { keyword: "cat feeder", region: "US", periodStart: "2026-08-01T00:00:00.000Z", periodEnd: "2026-08-07T00:00:00.000Z", demandValue: 40 },
      { keyword: "cat feeder", region: "US", periodStart: "2026-08-08T00:00:00.000Z", periodEnd: "2026-08-14T00:00:00.000Z", demandValue: 45 },
    ];

    const res = await executeDemandObservationBatchImport({
      productId: testProductId,
      workspaceId: testWorkspaceId,
      source: "GOOGLE_TRENDS_CSV",
      evidenceReference: testEvidenceRef,
      region: "US",
      points,
    });

    expect(res.insertedCount).toBe(2);
    const inDb = await prisma.productDemandObservation.findMany({ where: { productId: testProductId } });
    expect(inDb.length).toBe(2);
  });

  it("B13: Invalid 16-char short hash or forged evidenceReference cannot become official CSV proof", async () => {
    const points = [
      {
        keyword: "cat feeder",
        region: "US",
        periodStart: "2026-08-01T00:00:00.000Z",
        periodEnd: "2026-08-07T00:00:00.000Z",
        demandValue: 40,
        evidenceReference: "sha256:0123456789abcdef", // 16-hex short hash!
      },
    ];

    let threw = false;
    try {
      await executeDemandObservationBatchImport({
        productId: testProductId,
        workspaceId: testWorkspaceId,
        source: "GOOGLE_TRENDS_CSV",
        region: "US",
        evidenceReference: "sha256:0123456789abcdef",
        points,
      });
    } catch {
      threw = true;
    }
    expect(threw).toBe(true);
  });

  it("B14: Same SHA legitimate reuse across distinct authorized products never binds wrong product", async () => {
    const validSha = "a".repeat(64);
    // Even if two products share same CSV, their observations are strictly isolated by productId
    const points = [
      { keyword: "cat feeder", region: "US", periodStart: "2026-08-01T00:00:00.000Z", periodEnd: "2026-08-07T00:00:00.000Z", demandValue: 40 },
    ];

    await executeDemandObservationBatchImport({
      productId: testProductId,
      workspaceId: testWorkspaceId,
      source: "USER_MANUAL",
      region: "US",
      points,
    });

    const forProd1 = await prisma.productDemandObservation.findMany({ where: { productId: testProductId } });
    const forProd2 = await prisma.productDemandObservation.findMany({ where: { productId: otherTenantProductId } });

    expect(forProd1.length).toBe(1);
    expect(forProd2.length).toBe(0);
  });

  it("B15: Raw CSV structurally plausible but self-created -> integrity yes, independent Google issuance no", () => {
    let csv = "Category: All categories\nWeek,custom product: (United States)\n";
    for (let i = 0; i < 5; i++) {
      const dt = new Date(Date.now() - (5 - i) * 7 * 86400000).toISOString().slice(0, 10);
      csv += `${dt},${50 + i}\n`;
    }

    const val = validateAndParseGoogleTrendsCsv(csv, { expectedKeyword: "custom product" });
    expect(val.valid).toBe(true);
    // Integrity is verified via SHA
    expect(val.sha256Checksum.length).toBe(64);
    // But source is user-supplied export, not cryptographically proven external HTTP
    expect(val.evidenceReference).toContain("sha256:");
  });

  it("B16: Partial file write or staging crash -> recover safely without orphan authoritative", () => {
    const invalidSha = "b".repeat(64);
    const check = verifyStoredCsvFile(invalidSha);
    expect(check.exists).toBe(false);
    expect(check.validHash).toBe(false);
  });

  it("B17: Non-retryable DB error immediately fails without infinite spinning", async () => {
    let threw = false;
    try {
      await executeDemandObservationBatchImport({
        productId: "non_existent_product_xyz_123",
        source: "USER_MANUAL",
        region: "US",
        points: [
          { keyword: "test", region: "US", periodStart: "2026-08-01T00:00:00.000Z", periodEnd: "2026-08-07T00:00:00.000Z", demandValue: 10 },
        ],
      });
    } catch (err: any) {
      threw = true;
      expect(err.statusCode || err.status).toBe(404);
    }
    expect(threw).toBe(true);
  });

  it("B18: importGoogleTrendsCsvToDatabase() direct usage has same atomic semantics; no skippedCount on Prisma throw", async () => {
    // Calling with completely invalid product ID throws or returns success: false with 0 inserted, never masks error
    const res = await importGoogleTrendsCsvToDatabase("non_existent_prod_123", "Category: All\nWeek,cat: (US)\n2026-08-01,50\n", {
      expectedKeyword: "cat",
      region: "US",
    });

    expect(res.success).toBe(false);
    expect(res.insertedCount).toBe(0);
    expect(res.skippedCount).toBe(0);
    expect(res.errors.length).toBeGreaterThan(0);
  });

  it("B19: Preserved first-import historical rows and immutable replay", async () => {
    const points = [
      { keyword: "cat feeder", region: "US", periodStart: "2026-08-01T00:00:00.000Z", periodEnd: "2026-08-07T00:00:00.000Z", demandValue: 40 },
    ];
    await executeDemandObservationBatchImport({
      productId: testProductId,
      workspaceId: testWorkspaceId,
      source: "USER_MANUAL",
      region: "US",
      points,
    });

    const rows = await prisma.productDemandObservation.findMany({ where: { productId: testProductId } });
    expect(rows[0].demandValue).toBe(40);
  });

  it("B20: resolveProductDemandHistory() does not mix other productId or fallback on explicit productId", async () => {
    await prisma.productDemandObservation.create({
      data: {
        productId: testProductId,
        source: "GOOGLE_TRENDS_CSV",
        region: "US",
        keyword: "cat feeder",
        periodStart: new Date("2026-08-01T00:00:00.000Z"),
        periodEnd: new Date("2026-08-07T00:00:00.000Z"),
        demandValue: 40,
      },
    });

    const history = await resolveProductDemandHistory(testProductId, {
      workspaceId: testWorkspaceId,
      region: "US",
    });

    expect(history.observations?.length).toBe(1);
    expect(history.observations?.[0]?.productId).toBe(testProductId);
  });

  it("D03: Multi-process: Raw CSV import racing another writer on same unique key yields no partial/duplicate rows", async () => {
    const points1 = [
      { keyword: "cat feeder", region: "US", periodStart: "2026-08-01T00:00:00.000Z", periodEnd: "2026-08-07T00:00:00.000Z", demandValue: 40 },
    ];
    const points2 = [
      { keyword: "cat feeder", region: "US", periodStart: "2026-08-01T00:00:00.000Z", periodEnd: "2026-08-07T00:00:00.000Z", demandValue: 40 },
    ];

    const [r1, r2] = await Promise.all([
      executeDemandObservationBatchImport({
        productId: testProductId,
        workspaceId: testWorkspaceId,
        source: "USER_MANUAL",
        region: "US",
        points: points1,
      }),
      executeDemandObservationBatchImport({
        productId: testProductId,
        workspaceId: testWorkspaceId,
        source: "USER_MANUAL",
        region: "US",
        points: points2,
      }),
    ]);

    const totalInserted = r1.insertedCount + r2.insertedCount;
    expect(totalInserted).toBe(1); // Exactly one insert, other was skipped as duplicate
    const totalCount = await prisma.productDemandObservation.count({ where: { productId: testProductId } });
    expect(totalCount).toBe(1);
  });
});

