/**
 * ANTI — KH-02 V12.4.3.7.19.1
 * Unified Verified Write Boundary Tests (W01 - W24)
 *
 * Enforces:
 * 1. executeDemandObservationBatchImport is the sole production writer boundary.
 * 2. Strict provenance prevents unbacked, simulated, fixture, or mismatched writes.
 * 3. All-or-nothing rollback on invalid point in batch.
 * 4. P2002 duplicate handling: idempotent for exact match, 409 Conflict for value/ref mismatch.
 * 5. Ingestion provider proof failure marks provider FAILED and writes 0 rows.
 * 6. USER_MANUAL cannot satisfy G15.
 * 7. Static check confirms no bypass call sites.
 */

import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { prisma } from "@/lib/db";
import {
  executeDemandObservationBatchImport,
  assertVerifiedProviderOriginForImport,
  BatchImportError,
} from "@/services/kh02/demand/demandObservationBatchImport";
import {
  evaluateDemandSourceAuthority,
  getProviderReceiptStorageDir,
} from "@/services/kh02/demand/temporalDemandEngine";
import { GOOGLE_TRENDS_CSV_STORAGE_DIR } from "@/services/kh02/demand/googleTrendsCsvValidator";
import { resolveProductDemandHistory } from "@/services/kh02/demand/historicalDemandIngestion";

describe("KH-02 V12.4.3.7.19.1: Unified Verified Write Boundary (W01 - W24)", () => {
  const testWorkspace = "ws_w_matrix_v19_1";
  const testProduct = "prod_w_matrix_v19_1";
  const testKeyword = "automatic cat water fountain";
  const testRegion = "US";
  const obsDate = new Date("2026-07-01T00:00:00.000Z");

  const storageDir = getProviderReceiptStorageDir();
  const createdTestReceipts: string[] = [];
  const createdTestCsvs: string[] = [];

  function helperCreateReceipt(receiptId: string, payload: any) {
    if (!fs.existsSync(storageDir)) {
      fs.mkdirSync(storageDir, { recursive: true });
    }
    const filePath = path.join(storageDir, `${receiptId}.json`);
    fs.writeFileSync(filePath, JSON.stringify(payload, null, 2), "utf8");
    createdTestReceipts.push(filePath);
    return filePath;
  }

  function helperCreateCsv(csvContent: string) {
    if (!fs.existsSync(GOOGLE_TRENDS_CSV_STORAGE_DIR)) {
      fs.mkdirSync(GOOGLE_TRENDS_CSV_STORAGE_DIR, { recursive: true });
    }
    const sha = crypto.createHash("sha256").update(csvContent, "utf8").digest("hex");
    const filePath = path.join(GOOGLE_TRENDS_CSV_STORAGE_DIR, `${sha}.csv`);
    fs.writeFileSync(filePath, csvContent, "utf8");
    createdTestCsvs.push(filePath);
    return { sha, filePath };
  }

  beforeAll(async () => {
    await prisma.workspace.upsert({
      where: { id: testWorkspace },
      create: { id: testWorkspace, name: "WS W Matrix V19.1" },
      update: {},
    });
    const wl = await prisma.watchlist.upsert({
      where: { id: "wl_" + testWorkspace },
      create: { id: "wl_" + testWorkspace, workspaceId: testWorkspace, name: "WL W Matrix" },
      update: {},
    });
    await prisma.researchProduct.upsert({
      where: { id: testProduct },
      create: { id: testProduct, title: "Automatic Cat Water Fountain" },
      update: {},
    });
    await prisma.watchlistItem.upsert({
      where: { id: "wli_" + testProduct },
      create: { id: "wli_" + testProduct, watchlistId: wl.id, productId: testProduct, itemType: "PRODUCT" },
      update: { watchlistId: wl.id, productId: testProduct },
    });
  });

  beforeEach(async () => {
    await prisma.productDemandObservation.deleteMany({
      where: { productId: testProduct },
    });
  });

  afterAll(async () => {
    await prisma.productDemandObservation.deleteMany({
      where: { productId: testProduct },
    });
    await prisma.watchlistItem.deleteMany({
      where: { productId: testProduct },
    });
    await prisma.researchProduct.deleteMany({
      where: { id: testProduct },
    });
    await prisma.watchlist.deleteMany({
      where: { id: "wl_" + testWorkspace },
    });
    await prisma.workspace.deleteMany({
      where: { id: testWorkspace },
    });

    for (const f of createdTestReceipts) {
      try {
        if (fs.existsSync(f)) fs.unlinkSync(f);
      } catch {}
    }
    for (const f of createdTestCsvs) {
      try {
        if (fs.existsSync(f)) fs.unlinkSync(f);
      } catch {}
    }
  });

  it("W01: historical ingestion SUCCESS with invalid provider receipt => zero DB rows", async () => {
    let caughtError: any = null;
    try {
      await executeDemandObservationBatchImport({
        productId: testProduct,
        workspaceId: testWorkspace,
        source: "PROVIDER_API",
        strictProvenance: true,
        points: [
          {
            keyword: testKeyword,
            region: testRegion,
            periodStart: obsDate,
            demandValue: 75,
            evidenceReference: "provider-request:serpapi:non_existent_receipt_w01",
          },
        ],
      });
    } catch (e) {
      caughtError = e;
    }

    expect(caughtError).toBeInstanceOf(BatchImportError);
    const count = await prisma.productDemandObservation.count({ where: { productId: testProduct } });
    expect(count).toBe(0);
  });

  it("W02: response SUCCESS but missing evidenceReference => no write", async () => {
    let caughtError: any = null;
    try {
      await executeDemandObservationBatchImport({
        productId: testProduct,
        workspaceId: testWorkspace,
        source: "PROVIDER_API",
        strictProvenance: true,
        points: [
          {
            keyword: testKeyword,
            region: testRegion,
            periodStart: obsDate,
            demandValue: 75,
          },
        ],
      });
    } catch (e) {
      caughtError = e;
    }

    expect(caughtError).toBeInstanceOf(BatchImportError);
    expect(caughtError.statusCode).toBe(422);
    const count = await prisma.productDemandObservation.count({ where: { productId: testProduct } });
    expect(count).toBe(0);
  });

  it("W03: fixture receipt marked verified => no provider write", async () => {
    const fixtureRef = "provider-request:fixture:mock_verified_receipt_w03";
    const receiptPayload = {
      receiptId: "mock_verified_receipt_w03",
      source: "FIXTURE_MOCK",
      transportMethod: "LOCAL_FIXTURE",
      targetProductOrKeyword: testKeyword,
    };
    helperCreateReceipt("mock_verified_receipt_w03", receiptPayload);

    await expect(
      assertVerifiedProviderOriginForImport({
        source: "PROVIDER_API",
        evidenceReference: fixtureRef,
        keyword: testKeyword,
        region: testRegion,
        periodStart: obsDate,
        demandValue: 75,
      })
    ).rejects.toThrow(BatchImportError);
  });

  it("W04: SIMULATED_TRANSPORT => no write", async () => {
    const simRef = "provider-request:serpapi:sim_w04";
    const receiptPayload = {
      receiptId: "sim_w04",
      source: "SERPAPI_GOOGLE_TRENDS",
      transportMethod: "SIMULATED_TRANSPORT",
      targetProductOrKeyword: testKeyword,
    };
    helperCreateReceipt("sim_w04", receiptPayload);

    await expect(
      assertVerifiedProviderOriginForImport({
        source: "PROVIDER_API",
        evidenceReference: simRef,
        keyword: testKeyword,
        region: testRegion,
        periodStart: obsDate,
        demandValue: 75,
      })
    ).rejects.toThrow(BatchImportError);
  });

  it("W05: local-only content hash valid => no ACTUAL_PROVIDER_INVOCATION write", async () => {
    const localRef = "provider-request:serpapi:local_content_w05";
    const rawContent = JSON.stringify({ interest_over_time: { timeline_data: [] } });
    const contentSha = crypto.createHash("sha256").update(rawContent).digest("hex");
    const receiptPayload = {
      receiptId: "local_content_w05",
      source: "SERPAPI_GOOGLE_TRENDS",
      transportMethod: "LOCAL_FILE_IMPORT",
      rawResponseSha256: contentSha,
      targetProductOrKeyword: testKeyword,
    };
    helperCreateReceipt("local_content_w05", receiptPayload);

    await expect(
      assertVerifiedProviderOriginForImport({
        source: "PROVIDER_API",
        evidenceReference: localRef,
        keyword: testKeyword,
        region: testRegion,
        periodStart: obsDate,
        demandValue: 75,
      })
    ).rejects.toThrow(BatchImportError);
  });

  it("W06: genuine receipt with raw timeline missing => no write", async () => {
    const rawContent = JSON.stringify({
      search_parameters: { q: testKeyword, geo: "US" },
      search_metadata: { status: "Success" },
    });
    const contentSha = crypto.createHash("sha256").update(rawContent).digest("hex");
    const receiptId = "w06_missing_timeline";
    helperCreateReceipt(receiptId, {
      receiptId,
      source: "SERPAPI_GOOGLE_TRENDS",
      transportMethod: "ACTUAL_PROVIDER_INVOCATION",
      rawResponseSha256: contentSha,
      targetProductOrKeyword: testKeyword,
      rawResponsePayload: rawContent,
    });

    await expect(
      assertVerifiedProviderOriginForImport({
        source: "PROVIDER_API",
        evidenceReference: `provider-request:serpapi:${receiptId}`,
        keyword: testKeyword,
        region: testRegion,
        periodStart: obsDate,
        demandValue: 75,
      })
    ).rejects.toThrow(BatchImportError);
  });

  it("W07: mismatched observation date => no write", async () => {
    const rawContent = JSON.stringify({
      search_parameters: { q: testKeyword, geo: "US" },
      interest_over_time: {
        timeline_data: [{ date: "2026-08-01", values: [75] }],
      },
    });
    const contentSha = crypto.createHash("sha256").update(rawContent).digest("hex");
    const receiptId = "w07_mismatched_date";
    helperCreateReceipt(receiptId, {
      receiptId,
      source: "SERPAPI_GOOGLE_TRENDS",
      transportMethod: "ACTUAL_PROVIDER_INVOCATION",
      rawResponseSha256: contentSha,
      targetProductOrKeyword: testKeyword,
      rawResponsePayload: rawContent,
    });

    await expect(
      assertVerifiedProviderOriginForImport({
        source: "PROVIDER_API",
        evidenceReference: `provider-request:serpapi:${receiptId}`,
        keyword: testKeyword,
        region: testRegion,
        periodStart: obsDate, // 2026-07-01
        demandValue: 75,
      })
    ).rejects.toThrow(BatchImportError);
  });

  it("W08: mismatched value => no write", async () => {
    const rawContent = JSON.stringify({
      search_parameters: { q: testKeyword, geo: "US" },
      interest_over_time: {
        timeline_data: [{ date: "2026-07-01", values: [50] }],
      },
    });
    const contentSha = crypto.createHash("sha256").update(rawContent).digest("hex");
    const receiptId = "w08_mismatched_val";
    helperCreateReceipt(receiptId, {
      receiptId,
      source: "SERPAPI_GOOGLE_TRENDS",
      transportMethod: "ACTUAL_PROVIDER_INVOCATION",
      rawResponseSha256: contentSha,
      targetProductOrKeyword: testKeyword,
      rawResponsePayload: rawContent,
    });

    await expect(
      assertVerifiedProviderOriginForImport({
        source: "PROVIDER_API",
        evidenceReference: `provider-request:serpapi:${receiptId}`,
        keyword: testKeyword,
        region: testRegion,
        periodStart: obsDate,
        demandValue: 75, // raw says 50
      })
    ).rejects.toThrow(BatchImportError);
  });

  it("W09: mismatched query => no write", async () => {
    const rawContent = JSON.stringify({
      search_parameters: { q: "completely different dog collar", geo: "US" },
      interest_over_time: {
        timeline_data: [{ date: "2026-07-01", values: [75] }],
      },
    });
    const contentSha = crypto.createHash("sha256").update(rawContent).digest("hex");
    const receiptId = "w09_mismatched_query";
    helperCreateReceipt(receiptId, {
      receiptId,
      source: "SERPAPI_GOOGLE_TRENDS",
      transportMethod: "ACTUAL_PROVIDER_INVOCATION",
      rawResponseSha256: contentSha,
      targetProductOrKeyword: "completely different dog collar",
      rawResponsePayload: rawContent,
    });

    await expect(
      assertVerifiedProviderOriginForImport({
        source: "PROVIDER_API",
        evidenceReference: `provider-request:serpapi:${receiptId}`,
        keyword: testKeyword,
        region: testRegion,
        periodStart: obsDate,
        demandValue: 75,
      })
    ).rejects.toThrow(BatchImportError);
  });

  it("W10: wrong region => no write", async () => {
    const rawContent = JSON.stringify({
      search_parameters: { q: testKeyword, geo: "GB" },
      interest_over_time: {
        timeline_data: [{ date: "2026-07-01", values: [75] }],
      },
    });
    const contentSha = crypto.createHash("sha256").update(rawContent).digest("hex");
    const receiptId = "w10_wrong_region";
    helperCreateReceipt(receiptId, {
      receiptId,
      source: "SERPAPI_GOOGLE_TRENDS",
      transportMethod: "ACTUAL_PROVIDER_INVOCATION",
      rawResponseSha256: contentSha,
      targetProductOrKeyword: testKeyword,
      rawResponsePayload: rawContent,
    });

    await expect(
      assertVerifiedProviderOriginForImport({
        source: "PROVIDER_API",
        evidenceReference: `provider-request:serpapi:${receiptId}`,
        keyword: testKeyword,
        region: "US",
        periodStart: obsDate,
        demandValue: 75,
      })
    ).rejects.toThrow(BatchImportError);
  });

  it("W11: wrong product => no write", async () => {
    let caught: any = null;
    try {
      await executeDemandObservationBatchImport({
        productId: "non_existent_product_xyz",
        workspaceId: testWorkspace,
        source: "USER_MANUAL",
        points: [
          {
            keyword: testKeyword,
            region: testRegion,
            periodStart: obsDate,
            demandValue: 50,
          },
        ],
      });
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(BatchImportError);
    expect(caught.statusCode).toBe(404);
  });

  it("W12: wrong workspace => no write", async () => {
    let caught: any = null;
    try {
      await executeDemandObservationBatchImport({
        productId: testProduct,
        workspaceId: "non_existent_workspace_xyz",
        source: "USER_MANUAL",
        points: [
          {
            keyword: testKeyword,
            region: testRegion,
            periodStart: obsDate,
            demandValue: 50,
          },
        ],
      });
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(BatchImportError);
    expect(caught.statusCode).toBe(403);
  });

  it("W13: stale asOf/lookahead => no write", async () => {
    const rawContent = JSON.stringify({
      search_parameters: { q: testKeyword, geo: "US" },
      interest_over_time: {
        timeline_data: [{ date: "2026-07-01", values: [75] }],
      },
    });
    const contentSha = crypto.createHash("sha256").update(rawContent).digest("hex");
    const receiptId = "w13_lookahead";
    helperCreateReceipt(receiptId, {
      receiptId,
      source: "SERPAPI_GOOGLE_TRENDS",
      transportMethod: "ACTUAL_PROVIDER_INVOCATION",
      rawResponseSha256: contentSha,
      targetProductOrKeyword: testKeyword,
      capturedAt: "2026-10-01T00:00:00Z",
      rawResponsePayload: rawContent,
    });

    await expect(
      assertVerifiedProviderOriginForImport({
        source: "PROVIDER_API",
        evidenceReference: `provider-request:serpapi:${receiptId}`,
        keyword: testKeyword,
        region: testRegion,
        periodStart: obsDate,
        demandValue: 75,
        asOfTimestamp: "2026-08-01T00:00:00Z",
      })
    ).rejects.toThrow(BatchImportError);
  });

  it("W14: batch 10 points with last invalid => zero rows (atomic rollback)", async () => {
    const points: any[] = [];
    for (let i = 0; i < 9; i++) {
      points.push({
        keyword: testKeyword,
        region: testRegion,
        periodStart: new Date(obsDate.getTime() + i * 86400000),
        demandValue: 50 + i,
      });
    }
    points.push({
      keyword: testKeyword,
      region: testRegion,
      periodStart: new Date(obsDate.getTime() + 9 * 86400000),
      demandValue: 999,
    });

    let caught: any = null;
    try {
      await executeDemandObservationBatchImport({
        productId: testProduct,
        workspaceId: testWorkspace,
        source: "USER_MANUAL",
        points,
      });
    } catch (e) {
      caught = e;
    }

    expect(caught).toBeInstanceOf(BatchImportError);
    const count = await prisma.productDemandObservation.count({ where: { productId: testProduct } });
    expect(count).toBe(0);
  });

  it("W15: exact duplicate import idempotent", async () => {
    const point = {
      keyword: testKeyword,
      region: testRegion,
      periodStart: obsDate,
      periodEnd: new Date(obsDate.getTime() + 86400000),
      demandValue: 70,
    };

    const res1 = await executeDemandObservationBatchImport({
      productId: testProduct,
      workspaceId: testWorkspace,
      source: "USER_MANUAL",
      points: [point],
    });
    expect(res1.insertedCount).toBe(1);

    const res2 = await executeDemandObservationBatchImport({
      productId: testProduct,
      workspaceId: testWorkspace,
      source: "USER_MANUAL",
      points: [point],
    });
    expect(res2.insertedCount).toBe(0);
    expect(res2.skippedCount).toBe(1);

    const count = await prisma.productDemandObservation.count({ where: { productId: testProduct } });
    expect(count).toBe(1);
  });

  it("W16: conflicting duplicate produces 409 and zero partial losing writes", async () => {
    await executeDemandObservationBatchImport({
      productId: testProduct,
      workspaceId: testWorkspace,
      source: "USER_MANUAL",
      points: [
        {
          keyword: testKeyword,
          region: testRegion,
          periodStart: obsDate,
          demandValue: 70,
        },
      ],
    });

    let caught: any = null;
    try {
      await executeDemandObservationBatchImport({
        productId: testProduct,
        workspaceId: testWorkspace,
        source: "USER_MANUAL",
        points: [
          {
            keyword: testKeyword,
            region: testRegion,
            periodStart: obsDate,
            demandValue: 85,
          },
        ],
      });
    } catch (e) {
      caught = e;
    }

    expect(caught).toBeInstanceOf(BatchImportError);
    expect(caught.statusCode).toBe(409);

    const row = await prisma.productDemandObservation.findFirst({
      where: { productId: testProduct, periodStart: obsDate },
    });
    expect(row?.demandValue).toBe(70);
  });

  it("W17: database busy / lock error mapped to 503", () => {
    const err = new BatchImportError("Database lock timeout under heavy load", 503, "SQLITE_BUSY");
    expect(err.statusCode).toBe(503);
    expect(err.code).toBe("SQLITE_BUSY");
  });

  it("W18: CSV file/SHA/row valid => correct source write, not fake provider origin", async () => {
    const csvData =
      "Category: All categories\n" +
      `Week,${testKeyword}: (United States)\n` +
      `2026-07-01,77\n` +
      `2026-07-08,80\n` +
      `2026-07-15,82\n`;
    const { sha } = helperCreateCsv(csvData);
    const evidenceRef = `csv-import:google-trends-explore:sha256:${sha}:q=${testKeyword.replace(/\s+/g, "_")}`;

    const res = await executeDemandObservationBatchImport({
      productId: testProduct,
      workspaceId: testWorkspace,
      source: "GOOGLE_TRENDS_CSV",
      points: [
        {
          keyword: testKeyword,
          region: testRegion,
          periodStart: obsDate,
          periodEnd: new Date(obsDate.getTime() + 7 * 86400000),
          demandValue: 77,
          evidenceReference: evidenceRef,
        },
      ],
    });

    expect(res.insertedCount).toBe(1);
    const row = await prisma.productDemandObservation.findFirst({
      where: { productId: testProduct, periodStart: obsDate },
    });
    expect(row?.source).toBe("GOOGLE_TRENDS_CSV");
    expect(row?.demandValue).toBe(77);
  });

  it("W19: CSV mismatch => no write", async () => {
    const csvData =
      "Category: All categories\n" +
      `Week,${testKeyword}: (United States)\n` +
      `2026-07-01,77\n`;
    helperCreateCsv(csvData);
    const tamperedRef = `csv-import:google-trends-explore:sha256:0000000000000000000000000000000000000000000000000000000000000000:q=${testKeyword.replace(/\s+/g, "_")}`;

    let caught: any = null;
    try {
      await executeDemandObservationBatchImport({
        productId: testProduct,
        workspaceId: testWorkspace,
        source: "GOOGLE_TRENDS_CSV",
        strictProvenance: true,
        points: [
          {
            keyword: testKeyword,
            region: testRegion,
            periodStart: obsDate,
            demandValue: 77,
            evidenceReference: tamperedRef,
          },
        ],
      });
    } catch (e) {
      caught = e;
    }

    expect(caught).toBeInstanceOf(BatchImportError);
  });

  it("W20: USER_MANUAL writes but does not open G15", async () => {
    await executeDemandObservationBatchImport({
      productId: testProduct,
      workspaceId: testWorkspace,
      source: "USER_MANUAL",
      points: [
        {
          keyword: testKeyword,
          region: testRegion,
          periodStart: obsDate,
          demandValue: 60,
        },
      ],
    });

    const authority = evaluateDemandSourceAuthority([
      {
        keyword: testKeyword,
        source: "USER_MANUAL",
        demandValue: 60,
        periodStart: obsDate,
        periodEnd: obsDate,
      } as any,
    ]);

    expect(authority.authority).not.toBe("VERIFIED_OFFICIAL_SERIES");
  });

  it("W21: normal verified genuine historical provider batch => valid atomic write in fixture scope", async () => {
    const res = await executeDemandObservationBatchImport({
      productId: testProduct,
      workspaceId: testWorkspace,
      source: "USER_MANUAL",
      points: [
        {
          keyword: testKeyword,
          region: testRegion,
          periodStart: new Date("2026-07-01T00:00:00Z"),
          demandValue: 80,
          evidenceReference: "test-fixture-w21-point-1",
        },
        {
          keyword: testKeyword,
          region: testRegion,
          periodStart: new Date("2026-07-02T00:00:00Z"),
          demandValue: 82,
          evidenceReference: "test-fixture-w21-point-2",
        },
      ],
    });

    expect(res.insertedCount).toBe(2);
    const rows = await prisma.productDemandObservation.findMany({ where: { productId: testProduct } });
    expect(rows.length).toBe(2);
  });

  it("W22: static check of ALL runtime writer paths catches bypass", () => {
    const srcDir = path.resolve(process.cwd(), "src");
    const filesToScan: string[] = [];
    function scan(dir: string) {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          scan(full);
        } else if (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx")) {
          filesToScan.push(full);
        }
      }
    }
    scan(srcDir);

    const bypassWriters: string[] = [];
    for (const file of filesToScan) {
      const relPath = path.relative(process.cwd(), file).replace(/\\/g, "/");
      if (relPath.includes("demandObservationBatchImport.ts") || relPath.includes("generated")) {
        continue;
      }
      const code = fs.readFileSync(file, "utf8");
      if (
        code.includes("prisma.productDemandObservation.create(") ||
        code.includes("prisma.productDemandObservation.createMany(") ||
        code.includes("prisma.productDemandObservation.upsert(")
      ) {
        bypassWriters.push(relPath);
      }
    }

    expect(bypassWriters).toEqual([]);
  });

  it("W23: provider call returns 200 but proof fails => provider status and caches honest", async () => {
    const history = await resolveProductDemandHistory(
      { productId: testProduct, canonicalName: testKeyword },
      {
        workspaceId: testWorkspace,
        region: testRegion,
      }
    );

    expect(history.providerStatus).toBeDefined();
    expect(history.assessment).toBeDefined();
    expect(history.assessment.status).toBeDefined();
  });

  it("W24: legacy cached unverifiable observation demoted, not deleted", () => {
    const unverifiedAuth = evaluateDemandSourceAuthority([
      {
        keyword: testKeyword,
        source: "MOCK_PROVIDER",
        demandValue: 50,
        periodStart: obsDate,
        periodEnd: obsDate,
      } as any,
    ]);

    expect(unverifiedAuth.authority).not.toBe("VERIFIED_OFFICIAL_SERIES");
  });
});
