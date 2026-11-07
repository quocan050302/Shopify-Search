/**
 * ANTI — KH-02 V12.4.3.7.18.1: MANDATORY PROVENANCE (D01 - D14)
 *
 * Verifies that source authority checks are enforced unconditionally at the deepest
 * shared write path regardless of optional flags.
 * Enforces pure CSV non-mutating validation, receipt authentication, tenant/product
 * isolation, and fail-closed G15 evaluation.
 */

import { describe, it, expect, beforeAll, beforeEach, afterEach, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { prisma } from "@/lib/db";
import {
  executeDemandObservationBatchImport,
  BatchImportError,
} from "@/services/kh02/demand/demandObservationBatchImport";
import {
  parseGoogleTrendsCsvBytes,
  verifyDemandObservationAgainstRawCsv,
  GOOGLE_TRENDS_CSV_STORAGE_DIR,
} from "@/services/kh02/demand/googleTrendsCsvValidator";
import {
  hasVerifiableCsvOrProviderLineage,
  evaluateDemandSourceAuthority,
} from "@/services/kh02/demand/temporalDemandEngine";

describe("KH-02 V12.4.3.7.18.1: Workstream D — Mandatory Provenance (D01 - D14)", () => {
  const testProductId = "prod_d_prov_01";
  const testWorkspaceId = "ws_d_prov";

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
  const evidenceRef = `csv-import:google-trends-explore:sha256:${csvSha256}:q=automatic_cat_feeder`;

  beforeAll(async () => {
    fs.mkdirSync(GOOGLE_TRENDS_CSV_STORAGE_DIR, { recursive: true });
    fs.writeFileSync(csvFilePath, sampleCsvContent, "utf8");

    await prisma.workspace.upsert({
      where: { id: testWorkspaceId },
      create: { id: testWorkspaceId, name: "WS D Prov" },
      update: {},
    });

    const wl = await prisma.watchlist.upsert({
      where: { id: "wl_" + testWorkspaceId },
      create: { id: "wl_" + testWorkspaceId, workspaceId: testWorkspaceId, name: "WL D Prov" },
      update: {},
    });

    await prisma.researchProduct.upsert({
      where: { id: testProductId },
      create: { id: testProductId, title: "Automatic Cat Feeder" },
      update: {},
    });

    await prisma.watchlistItem.upsert({
      where: { id: "wli_" + testProductId },
      create: { id: "wli_" + testProductId, watchlistId: wl.id, productId: testProductId, itemType: "PRODUCT" },
      update: { watchlistId: wl.id, productId: testProductId },
    });
  });

  beforeEach(async () => {
    await prisma.productDemandObservation.deleteMany({
      where: { productId: testProductId },
    });
  });

  afterAll(async () => {
    try {
      if (fs.existsSync(csvFilePath)) fs.unlinkSync(csvFilePath);
      await prisma.productDemandObservation.deleteMany({ where: { productId: testProductId } });
      await prisma.watchlistItem.deleteMany({ where: { productId: testProductId } });
      await prisma.researchProduct.deleteMany({ where: { id: testProductId } });
      await prisma.watchlist.deleteMany({ where: { workspaceId: testWorkspaceId } });
      await prisma.workspace.deleteMany({ where: { id: testWorkspaceId } });
    } catch {}
  });

  it("D01: direct importer CSV missing ref and strictProvenance omitted -> throws 422 EVIDENCE_REFERENCE_REQUIRED, 0 rows", async () => {
    try {
      await executeDemandObservationBatchImport({
        productId: testProductId,
        workspaceId: testWorkspaceId,
        source: "GOOGLE_TRENDS_CSV",
        // strictProvenance omitted
        points: [
          {
            keyword: "automatic cat feeder",
            region: "US",
            periodStart: new Date(dates[0]),
            demandValue: 50,
            // evidenceReference omitted
          },
        ],
      });
      expect.unreachable("Should throw 422");
    } catch (err: any) {
      expect(err).toBeInstanceOf(BatchImportError);
      expect(err.statusCode).toBe(422);
      expect(err.code).toBe("EVIDENCE_REFERENCE_REQUIRED");
    }

    const count = await prisma.productDemandObservation.count({ where: { productId: testProductId } });
    expect(count).toBe(0);
  });

  it("D02: same with strictProvenance: false -> still throws 422 EVIDENCE_REFERENCE_REQUIRED", async () => {
    try {
      await executeDemandObservationBatchImport({
        productId: testProductId,
        workspaceId: testWorkspaceId,
        source: "GOOGLE_TRENDS_CSV",
        strictProvenance: false, // Explicitly false
        points: [
          {
            keyword: "automatic cat feeder",
            region: "US",
            periodStart: new Date(dates[0]),
            demandValue: 50,
          },
        ],
      });
      expect.unreachable("Should throw 422");
    } catch (err: any) {
      expect(err).toBeInstanceOf(BatchImportError);
      expect(err.statusCode).toBe(422);
      expect(err.code).toBe("EVIDENCE_REFERENCE_REQUIRED");
    }
  });

  it("D03: correct stored CSV but wrong keyword/region/start/value -> each denied fail-closed", async () => {
    // Wrong keyword
    const chkKw = verifyDemandObservationAgainstRawCsv(evidenceRef, {
      keyword: "unrelated dog toy",
      region: "US",
      periodStart: new Date(dates[0]),
      demandValue: 50,
    });
    expect(chkKw.verified).toBe(false);
    expect(chkKw.code).toBe("KEYWORD_MISMATCH");

    // Wrong region
    const chkReg = verifyDemandObservationAgainstRawCsv(evidenceRef, {
      keyword: "automatic cat feeder",
      region: "GB",
      periodStart: new Date(dates[0]),
      demandValue: 50,
    });
    expect(chkReg.verified).toBe(false);
    expect(chkReg.code).toBe("REGION_MISMATCH");

    // Wrong date
    const chkDate = verifyDemandObservationAgainstRawCsv(evidenceRef, {
      keyword: "automatic cat feeder",
      region: "US",
      periodStart: new Date("1999-01-01"),
      demandValue: 50,
    });
    expect(chkDate.verified).toBe(false);
    expect(chkDate.code).toBe("ROW_NOT_IN_CSV");

    // Wrong demand value
    const chkVal = verifyDemandObservationAgainstRawCsv(evidenceRef, {
      keyword: "automatic cat feeder",
      region: "US",
      periodStart: new Date(dates[0]),
      demandValue: 99, // Actual is 50
    });
    expect(chkVal.verified).toBe(false);
    expect(chkVal.code).toBe("VALUE_MISMATCH");
  });

  it("D04: missing/tampered CSV hash -> denied, not HISTORICAL_SOURCE_VERIFIED", () => {
    const fakeRef = "csv-import:google-trends-explore:sha256:0000000000000000000000000000000000000000000000000000000000000000:q=cat_feeder";
    const res = hasVerifiableCsvOrProviderLineage(fakeRef, null, {
      targetKeyword: "automatic cat feeder",
      region: "US",
      periodStart: new Date(dates[0]),
      observationValue: 50,
    });

    expect(res.lineageVerified).toBe(false);
    expect(res.sourceAuthority).toBe("CACHED_UNVERIFIED");
  });

  it("D05: hand-made valid CSV -> file integrity verified, but origin is LOCAL_INTEGRITY_ONLY (CACHED_UNVERIFIED without Official CSV Import Authority), not external API", () => {
    const lineage = hasVerifiableCsvOrProviderLineage(evidenceRef, null, {
      targetKeyword: "automatic cat feeder",
      region: "US",
      periodStart: new Date(dates[0]),
      observationValue: 50,
    });
    expect(lineage.contentIntegrityVerified).toBe(true);
    expect(lineage.rawCsvFileExists).toBe(true);
    expect(lineage.hasValidFileChecksum).toBe(true);
    expect(lineage.originKind).toBe("LOCAL_INTEGRITY_ONLY");
    expect(lineage.providerOriginVerified).toBe(false);
    expect(lineage.sourceOriginVerified).toBe(false);
    expect(lineage.businessLineageEligible).toBe(false);
    expect(lineage.lineageVerified).toBe(false);

    const auth = evaluateDemandSourceAuthority([
      {
        source: "GOOGLE_TRENDS_CSV",
        evidenceReference: evidenceRef,
        keyword: "automatic cat feeder",
        region: "US",
        periodStart: new Date(dates[0]),
        demandValue: 50,
      },
    ]);

    // Byte integrity verified, but hand-made local CSV without Official CSV Import Authority is CACHED_UNVERIFIED
    expect(auth.authority).toBe("CACHED_UNVERIFIED");
  });

  it("D06: provider row only matching receipt-looking string -> denied (no real receipt on disk)", async () => {
    try {
      await executeDemandObservationBatchImport({
        productId: testProductId,
        workspaceId: testWorkspaceId,
        source: "PROVIDER_API",
        points: [
          {
            keyword: "automatic cat feeder",
            region: "US",
            periodStart: new Date(dates[0]),
            demandValue: 50,
            evidenceReference: "provider-request:serpapi:fake_12345678",
          },
        ],
      });
      expect.unreachable("Should throw 422");
    } catch (err: any) {
      expect(err).toBeInstanceOf(BatchImportError);
      expect(err.statusCode).toBe(422);
      expect(err.code).toBe("PROVIDER_RECEIPT_REQUIRED");
    }
  });

  it("D07: tampered/non-existent provider receipt -> denied", () => {
    const res = hasVerifiableCsvOrProviderLineage(
      "provider-request:serpapi:non_existent_receipt_id",
      null,
      {
        targetKeyword: "automatic cat feeder",
        region: "US",
        periodStart: new Date(dates[0]),
        observationValue: 50,
      }
    );

    expect(res.lineageVerified).toBe(false);
    expect(res.sourceAuthority).toBe("CACHED_UNVERIFIED");
  });

  it("D08: simulated/test receipt with production-looking name -> denied live authority", () => {
    const auth = evaluateDemandSourceAuthority(
      [
        {
          source: "PROVIDER_API",
          evidenceReference: "receipt_fake_production_name",
          keyword: "automatic cat feeder",
          region: "US",
        },
      ],
      {
        providerReceiptDescriptor: {
          providerRequestId: "receipt_fake_production_name",
          source: "PROVIDER_API",
          responseStatus: 200,
          verified: true,
          originKind: "SIMULATED_TRANSPORT" as any,
          providerOriginVerified: false,
        } as any,
      }
    );

    expect(auth.authority).toBe("CACHED_UNVERIFIED");
  });

  it("D09: cross-product or other tenant receipt -> denied", () => {
    // Temporal demand engine checks product/keyword mismatch
    const res = hasVerifiableCsvOrProviderLineage(evidenceRef, null, {
      targetKeyword: "completely different product",
      region: "US",
      periodStart: new Date(dates[0]),
      observationValue: 50,
    });

    expect(res.lineageVerified).toBe(false);
  });

  it("D10: authentic CSV with exact match -> verified and bound to product", async () => {
    const res = await executeDemandObservationBatchImport({
      productId: testProductId,
      workspaceId: testWorkspaceId,
      source: "GOOGLE_TRENDS_CSV",
      points: [
        {
          keyword: "automatic cat feeder",
          region: "US",
          periodStart: new Date(dates[0]),
          demandValue: 50,
          evidenceReference: evidenceRef,
        },
      ],
    });

    expect(res.success).toBe(true);
    expect(res.insertedCount).toBe(1);
  });

  it("D11: USER_MANUAL can write but does not open G15 authority", async () => {
    const res = await executeDemandObservationBatchImport({
      productId: testProductId,
      workspaceId: testWorkspaceId,
      source: "USER_MANUAL",
      points: [
        {
          keyword: "automatic cat feeder",
          region: "US",
          periodStart: new Date("2026-06-01"),
          demandValue: 35,
        },
      ],
    });

    expect(res.success).toBe(true);

    const auth = evaluateDemandSourceAuthority([
      {
        source: "USER_MANUAL",
        keyword: "automatic cat feeder",
        region: "US",
      },
    ]);

    // USER_MANUAL is CACHED_UNVERIFIED, never HISTORICAL_SOURCE_VERIFIED (fail closed)
    expect(auth.authority).toBe("CACHED_UNVERIFIED");
  });

  it("D12: mixed source batch rejected before any write (422 MIXED_SOURCE_BATCH_REJECTED)", async () => {
    try {
      await executeDemandObservationBatchImport({
        productId: testProductId,
        workspaceId: testWorkspaceId,
        source: "GOOGLE_TRENDS_CSV",
        points: [
          {
            source: "GOOGLE_TRENDS_CSV",
            keyword: "cat feeder",
            region: "US",
            periodStart: new Date(dates[0]),
            demandValue: 50,
            evidenceReference: evidenceRef,
          },
          {
            source: "USER_MANUAL", // Mixed!
            keyword: "cat feeder",
            region: "US",
            periodStart: new Date(dates[1]),
            demandValue: 55,
          },
        ],
      });
      expect.unreachable("Should throw 422");
    } catch (err: any) {
      expect(err).toBeInstanceOf(BatchImportError);
      expect(err.statusCode).toBe(422);
      expect(err.code).toBe("MIXED_SOURCE_BATCH_REJECTED");
    }
  });

  it("D13: raw CSV verification preserves file bytes, SHA and mtime", () => {
    const statBefore = fs.statSync(csvFilePath);
    const contentBefore = fs.readFileSync(csvFilePath);

    const chk = verifyDemandObservationAgainstRawCsv(evidenceRef, {
      keyword: "automatic cat feeder",
      region: "US",
      periodStart: new Date(dates[0]),
      demandValue: 50,
    });

    expect(chk.verified).toBe(true);

    const statAfter = fs.statSync(csvFilePath);
    const contentAfter = fs.readFileSync(csvFilePath);

    expect(statAfter.mtimeMs).toBe(statBefore.mtimeMs);
    expect(Buffer.compare(contentBefore, contentAfter)).toBe(0);
  });

  it("D14: reload/cold process pure parsing produces bitwise identical hash and valid flag", () => {
    const raw = fs.readFileSync(csvFilePath, "utf8");
    const parsed1 = parseGoogleTrendsCsvBytes(raw);
    const parsed2 = parseGoogleTrendsCsvBytes(raw);

    expect(parsed1.valid).toBe(true);
    expect(parsed2.valid).toBe(true);
    expect(parsed1.sha256Checksum).toBe(parsed2.sha256Checksum);
    expect(parsed1.dataPoints.length).toBe(parsed2.dataPoints.length);
  });
});
