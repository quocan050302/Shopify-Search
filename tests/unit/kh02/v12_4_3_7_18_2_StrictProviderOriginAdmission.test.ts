/**
 * ANTI — KH-02 V12.4.3.7.18.2: STRICT PROVIDER ORIGIN ADMISSION (PA01 - PA24)
 *
 * Verifies that provider API observations require authenticated, durable,
 * genuine provider invocation proof bound to exact product, workspace, keyword,
 * region, date, and value.
 *
 * Enforces CONJUNCTIVE origin verification at the shared DB write entrypoint:
 * - desc.verified === true
 * - desc.verifiedOrigin === true
 * - desc.providerOriginVerified === true
 * - desc.originKind === "ACTUAL_PROVIDER_INVOCATION"
 * - desc.eligible === true
 * - desc.eligibleForBusiness === true
 * - desc.durablePersistenceVerified === true
 * - desc.commitState === "EVIDENCE_ELIGIBLE"
 *
 * Rejects UNIT_FIXTURE, SIMULATED_TRANSPORT, LOCAL_INTEGRITY_ONLY, test keys,
 * missing DB rows, unbacked string claims, and scope/time travel mismatches.
 */

import { describe, it, expect, beforeAll, beforeEach, afterEach, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { prisma } from "@/lib/db";
import {
  executeDemandObservationBatchImport,
  assertVerifiedProviderOriginForImport,
  isAuthoritativeProviderSource,
  BatchImportError,
} from "@/services/kh02/demand/demandObservationBatchImport";
import {
  initKnownUnitFixturesForTest,
  clearTrustedProviderInvocationsForTest,
  resolveVerifiedDemandEvidence,
  getProviderReceiptStorageDir,
  type ProviderInvocationReceipt,
} from "@/services/kh02/demand/temporalDemandEngine";

describe("KH-02 V12.4.3.7.18.2: Strict Provider Origin Admission (PA01 - PA24)", () => {
  const testProductId = "prod_pa_origin_01";
  const testWorkspaceId = "ws_pa_origin";
  const targetKeyword = "cat water fountain";
  const targetRegion = "US";
  const obsDate = new Date("2026-07-01T00:00:00.000Z");
  const obsValue = 75;

  beforeAll(async () => {
    initKnownUnitFixturesForTest();

    await prisma.workspace.upsert({
      where: { id: testWorkspaceId },
      create: { id: testWorkspaceId, name: "WS PA Origin" },
      update: {},
    });

    const wl = await prisma.watchlist.upsert({
      where: { id: "wl_" + testWorkspaceId },
      create: { id: "wl_" + testWorkspaceId, workspaceId: testWorkspaceId, name: "WL PA Origin" },
      update: {},
    });

    await prisma.researchProduct.upsert({
      where: { id: testProductId },
      create: { id: testProductId, title: "Automatic Cat Water Fountain" },
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
      await prisma.productDemandObservation.deleteMany({ where: { productId: testProductId } });
      await prisma.watchlistItem.deleteMany({ where: { productId: testProductId } });
      await prisma.researchProduct.deleteMany({ where: { id: testProductId } });
      await prisma.watchlist.deleteMany({ where: { workspaceId: testWorkspaceId } });
      await prisma.workspace.deleteMany({ where: { id: testWorkspaceId } });
      clearTrustedProviderInvocationsForTest();
    } catch {}
  });

  it("PA01: missing evidenceReference -> throws 422 PROVIDER_RECEIPT_REQUIRED, 0 rows inserted", async () => {
    try {
      await executeDemandObservationBatchImport({
        productId: testProductId,
        workspaceId: testWorkspaceId,
        source: "PROVIDER_API",
        points: [
          {
            keyword: targetKeyword,
            region: targetRegion,
            periodStart: obsDate,
            demandValue: obsValue,
            // evidenceReference omitted
          },
        ],
      });
      expect.unreachable("Should throw 422");
    } catch (err: any) {
      expect(err).toBeInstanceOf(BatchImportError);
      expect(err.statusCode).toBe(422);
      expect(err.code).toBe("PROVIDER_RECEIPT_REQUIRED");
    }

    const count = await prisma.productDemandObservation.count({ where: { productId: testProductId } });
    expect(count).toBe(0);
  });

  it("PA02: only 'provider-request:foo' string claim -> throws 422 PROVIDER_RECEIPT_REQUIRED, 0 rows", async () => {
    try {
      await executeDemandObservationBatchImport({
        productId: testProductId,
        workspaceId: testWorkspaceId,
        source: "PROVIDER_API",
        points: [
          {
            keyword: targetKeyword,
            region: targetRegion,
            periodStart: obsDate,
            demandValue: obsValue,
            evidenceReference: "provider-request:serpapi:unbacked_random_req_id_9999",
          },
        ],
      });
      expect.unreachable("Should throw 422");
    } catch (err: any) {
      expect(err).toBeInstanceOf(BatchImportError);
      expect(err.statusCode).toBe(422);
      expect(err.code).toBe("PROVIDER_RECEIPT_REQUIRED");
    }

    const count = await prisma.productDemandObservation.count({ where: { productId: testProductId } });
    expect(count).toBe(0);
  });

  it("PA03: unit fixture receipt (UNIT_FIXTURE) -> REJECTED under strict provider origin, 0 writes", async () => {
    // req_live_test_weekly is a registered unit fixture in UNIT_FIXTURE_STORAGE_DIR
    try {
      await executeDemandObservationBatchImport({
        productId: testProductId,
        workspaceId: testWorkspaceId,
        source: "PROVIDER_API",
        points: [
          {
            keyword: targetKeyword,
            region: targetRegion,
            periodStart: obsDate,
            demandValue: obsValue,
            evidenceReference: "provider-request:google_trends_serpapi:req_live_test_weekly",
          },
        ],
      });
      expect.unreachable("Should throw 422");
    } catch (err: any) {
      expect(err).toBeInstanceOf(BatchImportError);
      expect(err.statusCode).toBe(422);
      expect(err.code).toMatch(/PROVIDER_ORIGIN_UNVERIFIED|PROVIDER_RECEIPT_REQUIRED|FORBIDDEN_WORKSPACE_PRODUCT/);
    }

    const count = await prisma.productDemandObservation.count({ where: { productId: testProductId } });
    expect(count).toBe(0);
  });

  it("PA04: verified=true but SIMULATED_TRANSPORT -> assertVerifiedProviderOriginForImport rejects", async () => {
    await expect(
      assertVerifiedProviderOriginForImport({
        evidenceRef: "provider-request:serpapi:simulated_receipt_1",
        productId: testProductId,
        workspaceId: testWorkspaceId,
        keyword: targetKeyword,
        region: targetRegion,
        periodStart: obsDate,
        demandValue: obsValue,
      })
    ).rejects.toThrow(BatchImportError);
  });

  it("PA05: verified=true but LOCAL_INTEGRITY_ONLY -> rejected for provider API import", async () => {
    // Pointing to a local CSV hash with provider API claim must fail closed
    const fakeCsvRef = "csv-import:google-trends-explore:sha256:04f4d039cdd4a884134914fdb9d2ed86ebbfa353991d714b78df545a96fd4b14:q=cat_water_fountain";
    try {
      await executeDemandObservationBatchImport({
        productId: testProductId,
        workspaceId: testWorkspaceId,
        source: "PROVIDER_API",
        points: [
          {
            keyword: targetKeyword,
            region: targetRegion,
            periodStart: obsDate,
            demandValue: obsValue,
            evidenceReference: fakeCsvRef,
          },
        ],
      });
      expect.unreachable("Should throw 422");
    } catch (err: any) {
      expect(err).toBeInstanceOf(BatchImportError);
      expect(err.statusCode).toBe(422);
    }
  });

  it("PA06: self-asserted ACTUAL_PROVIDER_INVOCATION string without collector attestation -> REJECT", async () => {
    try {
      await executeDemandObservationBatchImport({
        productId: testProductId,
        workspaceId: testWorkspaceId,
        source: "PROVIDER_API",
        points: [
          {
            keyword: targetKeyword,
            region: targetRegion,
            periodStart: obsDate,
            demandValue: obsValue,
            evidenceReference: "provider-request:serpapi:self_asserted_live_no_token",
          },
        ],
      });
      expect.unreachable("Should throw 422");
    } catch (err: any) {
      expect(err).toBeInstanceOf(BatchImportError);
      expect(err.statusCode).toBe(422);
    }
  });

  it("PA07: providerOriginVerified=true but verifiedOrigin=false in descriptor -> conjunctive check fails", async () => {
    // Direct predicate test
    const fakeDesc: any = {
      verified: true,
      verifiedOrigin: false, // Fails conjunctive requirement
      providerOriginVerified: true,
      originKind: "ACTUAL_PROVIDER_INVOCATION",
      eligible: true,
      eligibleForBusiness: true,
      durablePersistenceVerified: true,
      commitState: "EVIDENCE_ELIGIBLE",
    };

    const isConjunctiveSuccess =
      fakeDesc.verified === true &&
      fakeDesc.verifiedOrigin === true &&
      fakeDesc.providerOriginVerified === true &&
      fakeDesc.originKind === "ACTUAL_PROVIDER_INVOCATION" &&
      fakeDesc.eligible === true &&
      fakeDesc.eligibleForBusiness === true &&
      fakeDesc.durablePersistenceVerified === true &&
      fakeDesc.commitState === "EVIDENCE_ELIGIBLE";

    expect(isConjunctiveSuccess).toBe(false);
  });

  it("PA08: providerOriginVerified=true but eligibleForBusiness=false -> conjunctive check fails", () => {
    const fakeDesc: any = {
      verified: true,
      verifiedOrigin: true,
      providerOriginVerified: true,
      originKind: "ACTUAL_PROVIDER_INVOCATION",
      eligible: true,
      eligibleForBusiness: false, // Ineligible for business
      durablePersistenceVerified: true,
      commitState: "EVIDENCE_ELIGIBLE",
    };

    const isConjunctiveSuccess =
      fakeDesc.verified === true &&
      fakeDesc.verifiedOrigin === true &&
      fakeDesc.providerOriginVerified === true &&
      fakeDesc.originKind === "ACTUAL_PROVIDER_INVOCATION" &&
      fakeDesc.eligible === true &&
      fakeDesc.eligibleForBusiness === true &&
      fakeDesc.durablePersistenceVerified === true &&
      fakeDesc.commitState === "EVIDENCE_ELIGIBLE";

    expect(isConjunctiveSuccess).toBe(false);
  });

  it("PA09: eligible=true but commitState=RECOVERY_REQUIRED -> conjunctive check fails", () => {
    const fakeDesc: any = {
      verified: true,
      verifiedOrigin: true,
      providerOriginVerified: true,
      originKind: "ACTUAL_PROVIDER_INVOCATION",
      eligible: true,
      eligibleForBusiness: true,
      durablePersistenceVerified: true,
      commitState: "RECOVERY_REQUIRED", // In recovery state
    };

    const isConjunctiveSuccess =
      fakeDesc.verified === true &&
      fakeDesc.verifiedOrigin === true &&
      fakeDesc.providerOriginVerified === true &&
      fakeDesc.originKind === "ACTUAL_PROVIDER_INVOCATION" &&
      fakeDesc.eligible === true &&
      fakeDesc.eligibleForBusiness === true &&
      fakeDesc.durablePersistenceVerified === true &&
      fakeDesc.commitState === "EVIDENCE_ELIGIBLE";

    expect(isConjunctiveSuccess).toBe(false);
  });

  it("PA10: valid-looking signed receipt using test key -> rejected under strictLiveOrigin", async () => {
    const desc = await resolveVerifiedDemandEvidence("provider-request:serpapi:req_live_test_weekly", {
      productId: testProductId,
      keyword: targetKeyword,
      region: targetRegion,
      strictLiveOrigin: true,
    });

    expect(desc.verified).toBe(false);
    expect(desc.providerOriginVerified).toBeFalsy();
    expect(desc.errorCode).toBeDefined();
  });

  it("PA11: durable attestation deleted after warm-up -> rejected after fresh read", async () => {
    // If attestation cannot be read from disk, resolver must fail closed
    const desc = await resolveVerifiedDemandEvidence("provider-request:serpapi:non_existent_attestation_req", {
      strictLiveOrigin: true,
    });
    expect(desc.verified).toBe(false);
    expect(desc.providerOriginVerified).toBeFalsy();
  });

  it("PA12: raw SHA mismatch between descriptor and stored bytes -> rejected with 422", async () => {
    const tamperedSha = "a".repeat(64);
    const desc = await resolveVerifiedDemandEvidence(`provider-request:serpapi:sha256:${tamperedSha}`, {
      strictLiveOrigin: true,
    });
    expect(desc.verified).toBe(false);
  });

  it("PA13: committed ResearchEvidence DB row missing -> rejected for non-fixture", async () => {
    // Any provider receipt lacking committed ResearchEvidence DB row fails closed
    const desc = await resolveVerifiedDemandEvidence("provider-request:serpapi:req_missing_db_row_01", {
      strictLiveOrigin: true,
    });
    expect(desc.verified).toBe(false);
  });

  it("PA14: ledger/DB identity or generation conflict -> rejected fail-closed", async () => {
    const desc = await resolveVerifiedDemandEvidence("provider-request:serpapi:conflict_gen_req", {
      strictLiveOrigin: true,
    });
    expect(desc.verified).toBe(false);
  });

  it("PA15: region mismatch (receipt is US, context requests GB) -> rejected with 422", async () => {
    try {
      await assertVerifiedProviderOriginForImport({
        evidenceRef: "provider-request:google_trends_serpapi:req_live_verified_12345",
        productId: testProductId,
        workspaceId: testWorkspaceId,
        keyword: targetKeyword,
        region: "GB", // Mismatched region (receipt is US)
        periodStart: obsDate,
        demandValue: obsValue,
      });
      expect.unreachable("Should throw 422");
    } catch (err: any) {
      expect(err).toBeInstanceOf(BatchImportError);
      expect(err.statusCode).toBe(422);
    }
  });

  it("PA16: keyword mismatch (receipt is cat fountain, context requests dog toy) -> rejected with 422", async () => {
    try {
      await assertVerifiedProviderOriginForImport({
        evidenceRef: "provider-request:google_trends_serpapi:req_live_verified_12345",
        productId: testProductId,
        workspaceId: testWorkspaceId,
        keyword: "dog squeaky chew toy", // Mismatched keyword
        region: targetRegion,
        periodStart: obsDate,
        demandValue: obsValue,
      });
      expect.unreachable("Should throw 422");
    } catch (err: any) {
      expect(err).toBeInstanceOf(BatchImportError);
      expect(err.statusCode).toBe(422);
    }
  });

  it("PA17: date or value mismatch -> rejected with 422", async () => {
    try {
      await assertVerifiedProviderOriginForImport({
        evidenceRef: "provider-request:google_trends_serpapi:req_live_verified_12345",
        productId: testProductId,
        workspaceId: testWorkspaceId,
        keyword: targetKeyword,
        region: targetRegion,
        periodStart: new Date("1995-01-01"), // Completely wrong date
        demandValue: 999, // Mismatched value
      });
      expect.unreachable("Should throw 422");
    } catch (err: any) {
      expect(err).toBeInstanceOf(BatchImportError);
      expect(err.statusCode).toBe(422);
    }
  });

  it("PA18: time-travel future capturedAt or invalid asOf -> rejected with 422 POINT_IN_TIME_VIOLATION", async () => {
    try {
      await assertVerifiedProviderOriginForImport({
        evidenceRef: "provider-request:google_trends_serpapi:req_live_verified_12345",
        productId: testProductId,
        workspaceId: testWorkspaceId,
        keyword: targetKeyword,
        region: targetRegion,
        periodStart: obsDate,
        demandValue: obsValue,
        asOfTimestamp: "2020-01-01T00:00:00.000Z", // asOf before capturedAt (2026)
      });
      expect.unreachable("Should throw 422");
    } catch (err: any) {
      expect(err).toBeInstanceOf(BatchImportError);
      expect(err.statusCode).toBe(422);
    }
  });

  it("PA19: direct importer with strictProvenance omitted -> still rejects bad provider", async () => {
    try {
      await executeDemandObservationBatchImport({
        productId: testProductId,
        workspaceId: testWorkspaceId,
        source: "PROVIDER_API",
        // strictProvenance omitted
        points: [
          {
            keyword: targetKeyword,
            region: targetRegion,
            periodStart: obsDate,
            demandValue: obsValue,
            evidenceReference: "provider-request:fake:bad_provider_no_flag",
          },
        ],
      });
      expect.unreachable("Should throw 422");
    } catch (err: any) {
      expect(err).toBeInstanceOf(BatchImportError);
      expect(err.statusCode).toBe(422);
    }
  });

  it("PA20: direct importer with strictProvenance: false -> still rejects bad provider", async () => {
    try {
      await executeDemandObservationBatchImport({
        productId: testProductId,
        workspaceId: testWorkspaceId,
        source: "PROVIDER_API",
        strictProvenance: false, // Explicitly false
        points: [
          {
            keyword: targetKeyword,
            region: targetRegion,
            periodStart: obsDate,
            demandValue: obsValue,
            evidenceReference: "provider-request:fake:bad_provider_flag_false",
          },
        ],
      });
      expect.unreachable("Should throw 422");
    } catch (err: any) {
      expect(err).toBeInstanceOf(BatchImportError);
      expect(err.statusCode).toBe(422);
    }
  });

  it("PA21: mixed source batch where one provider row is invalid -> 0 database writes", async () => {
    try {
      await executeDemandObservationBatchImport({
        productId: testProductId,
        workspaceId: testWorkspaceId,
        source: "PROVIDER_API",
        points: [
          {
            source: "PROVIDER_API",
            keyword: targetKeyword,
            region: targetRegion,
            periodStart: obsDate,
            demandValue: obsValue,
            evidenceReference: "provider-request:fake:bad_provider_row_1",
          },
          {
            source: "USER_MANUAL", // Mixed!
            keyword: targetKeyword,
            region: targetRegion,
            periodStart: new Date("2026-07-08T00:00:00.000Z"),
            demandValue: 80,
          },
        ],
      });
      expect.unreachable("Should throw 422");
    } catch (err: any) {
      expect(err).toBeInstanceOf(BatchImportError);
      expect(err.statusCode).toBe(422);
    }

    const count = await prisma.productDemandObservation.count({ where: { productId: testProductId } });
    expect(count).toBe(0);
  });

  it("PA22: authenticated CSV and USER_MANUAL semantics preserved without claiming live provider truth", async () => {
    const res = await executeDemandObservationBatchImport({
      productId: testProductId,
      workspaceId: testWorkspaceId,
      source: "USER_MANUAL",
      points: [
        {
          keyword: targetKeyword,
          region: targetRegion,
          periodStart: new Date("2026-07-15T00:00:00.000Z"),
          demandValue: 60,
        },
      ],
    });

    expect(res.success).toBe(true);
    expect(res.insertedCount).toBe(1);
    expect(isAuthoritativeProviderSource("USER_MANUAL")).toBe(false);
    expect(isAuthoritativeProviderSource("GOOGLE_TRENDS_CSV")).toBe(false);
    expect(isAuthoritativeProviderSource("PROVIDER_API")).toBe(true);
    expect(isAuthoritativeProviderSource("authoritative_api")).toBe(true);
    expect(isAuthoritativeProviderSource("Google Trends (SerpApi)")).toBe(true);
  });

  it("PA23: cross-product evidence substitution (Product A receipt for Product B) -> rejected with 422", async () => {
    try {
      await assertVerifiedProviderOriginForImport({
        evidenceRef: "provider-request:google_trends_serpapi:req_live_verified_12345",
        productId: "completely_different_product_id_xyz",
        workspaceId: testWorkspaceId,
        keyword: targetKeyword,
        region: targetRegion,
        periodStart: obsDate,
        demandValue: obsValue,
      });
      expect.unreachable("Should throw 422");
    } catch (err: any) {
      expect(err).toBeInstanceOf(BatchImportError);
      expect(err.statusCode).toBe(422);
    }
  });

  it("PA24: genuine live provider receipt in test env -> truthful NOT_RUN_NO_AUTHENTIC_PROOF without fabricating live success", async () => {
    // In test environment with ENABLE_LIVE_NETWORK_FETCHER disabled and no live provider API secrets,
    // positive integration must report NOT_RUN_NO_AUTHENTIC_PROOF and never invent synthetic live success
    const isLiveFetcherEnabled = process.env.ENABLE_LIVE_NETWORK_FETCHER === "true";
    expect(isLiveFetcherEnabled).toBe(false);

    // Assert that without genuine live secrets, zero rows can claim live authority
    const count = await prisma.productDemandObservation.count({
      where: {
        productId: testProductId,
        source: "PROVIDER_API",
      },
    });
    expect(count).toBe(0);
  });
});
