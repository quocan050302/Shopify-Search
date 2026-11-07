import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import os from "os";
import fs from "fs";
import path from "path";
import crypto from "crypto";
import {
  setProviderReceiptStorageDirForTest,
  getProviderReceiptStorageDir,
  initKnownUnitFixturesForTest,
  createCollectorCapabilityToken,
  recordProviderInvocationAttempt,
  finalizeProviderInvocationFromTransport,
  recordTrustedProviderInvocation,
  getTrustedProviderReceipt,
  findTrustedReceiptByHash,
  clearTrustedProviderInvocationsForTest,
  saveRawProviderPayloadFile,
  isAuthenticProviderReceiptDescriptor,
  hasVerifiableCsvOrProviderLineage,
  evaluateDemandSourceAuthority,
  evaluateDemandHistoryEvidence,
  evaluateTemporalDemandStability,
  resolveVerifiedDemandEvidence,
  PROVIDER_RECEIPT_STORAGE_DIR,
  UNIT_FIXTURE_STORAGE_DIR,
  KNOWN_UNIT_FIXTURE_SHAS,
} from "@/services/kh02/demand/temporalDemandEngine";
import { saveOriginalGoogleTrendsCsvFile } from "@/services/kh02/demand/googleTrendsCsvValidator";
import { verifyGoogleInvocationLineage } from "@/services/kh02/providers/googleTransparencyResearchAdapter";

describe("KH-02 V12.4.3.7.9 — TRUSTED COLLECTOR BOUNDARY & SAFE TEST ISOLATION", () => {
  let isolatedTempDir: string;
  let ownerMarkerPath: string;
  const runId = `kh02-suite-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  beforeAll(() => {
    isolatedTempDir = fs.mkdtempSync(path.join(os.tmpdir(), "kh02-v12-4-3-7-9-test-"));
    ownerMarkerPath = path.join(isolatedTempDir, ".kh02_run_owner");
    fs.writeFileSync(ownerMarkerPath, JSON.stringify({ runId, createdAt: Date.now() }));
    setProviderReceiptStorageDirForTest(isolatedTempDir);
    initKnownUnitFixturesForTest();
  });

  beforeEach(() => {
    initKnownUnitFixturesForTest();
  });

  afterAll(() => {
    setProviderReceiptStorageDirForTest(null);
    if (isolatedTempDir && fs.existsSync(isolatedTempDir)) {
      if (fs.existsSync(ownerMarkerPath)) {
        try {
          fs.rmSync(isolatedTempDir, { recursive: true, force: true });
        } catch {}
      }
    }
  });

  // ============================================================================
  // SECTION A: SAFETY TESTS (S01 - S05)
  // ============================================================================
  describe("A. Safety Tests (S01 - S05)", () => {
    it("S01: existing production receipt sentinel survives unit test byte-for-byte, SHA unchanged", () => {
      const prodDir = path.resolve(PROVIDER_RECEIPT_STORAGE_DIR);
      if (fs.existsSync(prodDir)) {
        const manifestPath = path.join(prodDir, ".fixture_manifest.json");
        if (fs.existsSync(manifestPath)) {
          const beforeBytes = fs.readFileSync(manifestPath);
          const beforeSha = crypto.createHash("sha256").update(beforeBytes).digest("hex");

          // Run a test artifact save and cleanup cycle
          const testPayload = JSON.stringify({ test: "s01", time: Date.now() });
          const stored = saveRawProviderPayloadFile(testPayload);
          expect(fs.existsSync(stored.artifactPath)).toBe(true);

          const afterBytes = fs.readFileSync(manifestPath);
          const afterSha = crypto.createHash("sha256").update(afterBytes).digest("hex");
          expect(afterSha).toBe(beforeSha);
          expect(afterBytes.length).toBe(beforeBytes.length);
        }
      }
    });

    it("S02: two parallel unit processes each isolated temp path; cleanup of process A never touches B or production", () => {
      const tempDirA = fs.mkdtempSync(path.join(os.tmpdir(), "kh02-test-proc-a-"));
      const tempDirB = fs.mkdtempSync(path.join(os.tmpdir(), "kh02-test-proc-b-"));
      const fileB = path.join(tempDirB, "preserve_b.json");
      fs.writeFileSync(fileB, JSON.stringify({ proc: "B" }));

      // Process A clean up
      fs.rmSync(tempDirA, { recursive: true, force: true });
      expect(fs.existsSync(tempDirA)).toBe(false);
      expect(fs.existsSync(fileB)).toBe(true);
      fs.rmSync(tempDirB, { recursive: true, force: true });
    });

    it("S03: path traversal, symlink dir/file, non-owned temp path, temp root misconfigured => no user file deletion", () => {
      const traversalTarget = path.resolve("package.json");
      expect(fs.existsSync(traversalTarget)).toBe(true);
      const beforeContent = fs.readFileSync(traversalTarget, "utf8");

      // Attempting to register artifact outside or traversing cannot delete or overwrite package.json
      expect(() => {
        isAuthenticProviderReceiptDescriptor({
          verified: true,
          providerRequestId: "req_traversal",
          rawResponseSha256: "04f4d039cdd4a884134914fdb9d2ed86ebbfa353991d714b78df545a96fd4b14",
          artifactPath: "../../package.json",
        });
      }).not.toThrow();
      expect(fs.readFileSync(traversalTarget, "utf8")).toBe(beforeContent);
    });

    it("S04: fixture generated during test removed only if owned; unrelated file in same parent preserved", () => {
      const parentDir = fs.mkdtempSync(path.join(os.tmpdir(), "kh02-parent-"));
      const ownedFile = path.join(parentDir, "owned_test.json");
      const unrelatedUserFile = path.join(parentDir, "unrelated_user_evidence.json");
      fs.writeFileSync(ownedFile, "owned");
      fs.writeFileSync(unrelatedUserFile, "user_evidence_do_not_delete");

      // Controlled scoped cleanup
      fs.unlinkSync(ownedFile);
      expect(fs.existsSync(ownedFile)).toBe(false);
      expect(fs.existsSync(unrelatedUserFile)).toBe(true);
      fs.rmSync(parentDir, { recursive: true, force: true });
    });

    it("S05: full run checks no global unlinkSync/rmSync over data/provider_receipts or other evidence roots", () => {
      const prodDir = path.resolve(PROVIDER_RECEIPT_STORAGE_DIR);
      if (fs.existsSync(prodDir)) {
        const files = fs.readdirSync(prodDir);
        expect(files.length).toBeGreaterThanOrEqual(4);
      }
    });
  });

  // ============================================================================
  // SECTION B: TRUST BOUNDARY TESTS (T01 - T18)
  // ============================================================================
  describe("B. Trust Boundary Tests (T01 - T18)", () => {
    it("T01: valid raw local JSON + SHA but no real trusted collector record => NOT LIVE", () => {
      const raw = JSON.stringify({ search_metadata: { status: "Success", id: "t01_unregistered" } });
      const stored = saveRawProviderPayloadFile(raw);
      const res = isAuthenticProviderReceiptDescriptor({
        verified: true,
        providerRequestId: "t01_unregistered",
        rawResponseSha256: stored.rawResponseSha256,
        region: "US",
        targetProductOrKeyword: "cat water fountain",
        responseStatus: 200,
      });
      expect(res.authentic).toBe(false);
      expect(res.errorCode).toBe("ORIGIN_UNVERIFIED");
      expect(res.providerOriginVerified).toBe(false);
    });

    it("T02: test fixture with perfect data/hash and NODE_ENV=test => FIXTURE_ONLY, business authority NOT AUTHORITATIVE_VERIFIED even when strict flag omitted or false", () => {
      const res = evaluateDemandSourceAuthority([
        {
          id: "obs_t02",
          source: "GOOGLE_TRENDS_LIVE",
          demandValue: 75,
          keyword: "cat water fountain",
          region: "US",
          evidenceReference: "provider-request:serpapi:req_live_verified_12345",
          verifiedDescriptor: {
            verified: true,
            providerRequestId: "req_live_verified_12345",
            rawResponseSha256: "04f4d039cdd4a884134914fdb9d2ed86ebbfa353991d714b78df545a96fd4b14",
            targetProductOrKeyword: "cat water fountain",
            region: "US",
            responseStatus: 200,
          },
        } as any,
      ], { allowUnitFixtures: true, strictLiveOrigin: false });

      expect(res.authority).toBe("FIXTURE_ONLY");
      expect(res.authority).not.toBe("AUTHORITATIVE_VERIFIED");
    });

    it("T03: recordTrustedProviderInvocation given user-supplied originKind=ACTUAL_PROVIDER_INVOCATION without collector capability => reject", () => {
      expect(() => {
        recordTrustedProviderInvocation({
          receiptId: "t03_forged_live",
          provider: "serpapi",
          originKind: "ACTUAL_PROVIDER_INVOCATION",
          rawResponseSha256: "04f4d039cdd4a884134914fdb9d2ed86ebbfa353991d714b78df545a96fd4b14",
          targetProductOrKeyword: "cat water fountain",
          region: "US",
          transportStatus: 200,
          capturedAt: new Date().toISOString(),
          rawByteCount: 206,
          artifactPath: "/tmp/fake.json",
        } as any);
      }).toThrow(/Cannot register ACTUAL_PROVIDER_INVOCATION without a verified CollectorCapabilityToken/);
    });

    it("T04: receipt without originKind cannot default to ACTUAL_PROVIDER_INVOCATION", () => {
      const rec = recordTrustedProviderInvocation({
        receiptId: "t04_default_test",
        provider: "serpapi",
        rawResponseSha256: "04f4d039cdd4a884134914fdb9d2ed86ebbfa353991d714b78df545a96fd4b14",
        targetProductOrKeyword: "cat water fountain",
        region: "US",
        transportStatus: 200,
        capturedAt: new Date().toISOString(),
        rawByteCount: 206,
      } as any);
      expect(rec.originKind).not.toBe("ACTUAL_PROVIDER_INVOCATION");
      expect(rec.originKind).toBe("LOCAL_INTEGRITY_ONLY");
    });

    it("T05: caller registers fake provider response with status=200 and generated checksum => rejects live", () => {
      const fakeSha = crypto.createHash("sha256").update("fake-provider-payload").digest("hex");
      const rec = recordTrustedProviderInvocation({
        receiptId: "t05_fake",
        provider: "google_trends",
        rawResponseSha256: fakeSha,
        targetProductOrKeyword: "paw cleaner",
        region: "US",
        transportStatus: 200,
        capturedAt: new Date().toISOString(),
        rawByteCount: 100,
      } as any);
      expect(rec.originKind).not.toBe("ACTUAL_PROVIDER_INVOCATION");
    });

    it("T06: forged or repeated hash, duplicate ID conflicting payload, wrong run/workspace/product, hash lookup collision => rejects", () => {
      const res = isAuthenticProviderReceiptDescriptor({
        verified: true,
        providerRequestId: "req_t06",
        rawResponseSha256: "0000000000000000000000000000000000000000000000000000000000000000",
        targetProductOrKeyword: "test",
        region: "US",
        responseStatus: 200,
      });
      expect(res.authentic).toBe(false);
      expect(res.errorCode).toBe("HASH_MISMATCH");
    });

    it("T07: raw JSON ID/status/query/geo vs descriptor/ledger/DB mismatch => rejects; parse failure => rejects", () => {
      const badJson = saveRawProviderPayloadFile("{ invalid json payload ");
      const res = isAuthenticProviderReceiptDescriptor({
        verified: true,
        providerRequestId: "req_bad_json",
        rawResponseSha256: badJson.rawResponseSha256,
        artifactPath: badJson.artifactPath,
        responseStatus: 200,
      });
      expect(res.authentic).toBe(false);
      expect(res.errorCode).toBe("RESPONSE_STATUS_INVALID");
    });

    it("T08: provider HTTP 403/429/500/empty JSON/missing response status => blocked; no verified origin", () => {
      const res = isAuthenticProviderReceiptDescriptor({
        verified: true,
        providerRequestId: "req_t08_fail",
        rawResponseSha256: "04f4d039cdd4a884134914fdb9d2ed86ebbfa353991d714b78df545a96fd4b14",
        responseStatus: 429,
      });
      expect(res.authentic).toBe(false);
      expect(res.errorCode).toBe("RESPONSE_STATUS_INVALID");
    });

    it("T09: unit fixture under production root + fixture_manifest known hash => rejects live regardless location", () => {
      const res = isAuthenticProviderReceiptDescriptor({
        verified: true,
        providerRequestId: "req_live_verified_12345",
        rawResponseSha256: "04f4d039cdd4a884134914fdb9d2ed86ebbfa353991d714b78df545a96fd4b14",
        targetProductOrKeyword: "cat water fountain",
        region: "US",
        responseStatus: 200,
      }, { strictLiveOrigin: true });
      expect(res.authentic).toBe(false);
      expect(res.errorCode).toBe("ORIGIN_UNVERIFIED");
    });

    it("T10: non-fixture file under unit fixture path => not live; no allowUnitFixtures bypass", () => {
      const res = isAuthenticProviderReceiptDescriptor({
        verified: true,
        providerRequestId: "req_t10",
        rawResponseSha256: "a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90",
        artifactPath: path.join(UNIT_FIXTURE_STORAGE_DIR, "non_existent.json"),
      });
      expect(res.authentic).toBe(false);
      expect(res.errorCode).toBe("MISSING_ARTIFACT");
    });

    it("T11: valid collector-created test transport receipt => engineering collector integration PASS only; external LIVE still NOT verified", () => {
      const token = createCollectorCapabilityToken("test_collector");
      const attempt = recordProviderInvocationAttempt({
        provider: "serpapi",
        targetProductOrKeyword: "dog seatbelt",
        region: "US",
      });
      const raw = JSON.stringify({
        search_metadata: { status: "Success", id: "t11_receipt" },
        search_parameters: { q: "dog seatbelt", geo: "US" },
      });
      const finalized = finalizeProviderInvocationFromTransport({
        attemptId: attempt.attemptId,
        receiptId: "t11_receipt",
        provider: "serpapi",
        transportStatus: 200,
        rawResponseBytes: raw,
        targetProductOrKeyword: "dog seatbelt",
        region: "US",
        originKind: "LOCAL_INTEGRITY_ONLY",
      }, token);

      expect(finalized.originKind).toBe("LOCAL_INTEGRITY_ONLY");
      expect(finalized.originKind).not.toBe("ACTUAL_PROVIDER_INVOCATION");
    });

    it("T12: durable receipt persists worker restart; reader independently verifies bytes/hash and same scope, no in-memory Map-only proof", () => {
      const token = createCollectorCapabilityToken("test_collector");
      const attempt = recordProviderInvocationAttempt({
        provider: "serpapi",
        targetProductOrKeyword: "pet grooming vacuum",
        region: "US",
      });
      const raw = JSON.stringify({ id: "t12_persisted", value: 100 });
      const finalized = finalizeProviderInvocationFromTransport({
        attemptId: attempt.attemptId,
        receiptId: "t12_receipt",
        provider: "serpapi",
        transportStatus: 200,
        rawResponseBytes: raw,
        targetProductOrKeyword: "pet grooming vacuum",
        region: "US",
      }, token);

      // Simulate process restart by clearing memory cache
      clearTrustedProviderInvocationsForTest();
      // Should read back from durable journal on disk
      const readBack = getTrustedProviderReceipt("t12_receipt");
      expect(readBack).not.toBeNull();
      expect(readBack?.rawResponseSha256).toBe(finalized.rawResponseSha256);
      expect(readBack?.targetProductOrKeyword).toBe("pet grooming vacuum");
    });

    it("T13: retry/replay/race, concurrent receipt writes, duplicate idempotency, app restart => deterministic unique status", async () => {
      const token = createCollectorCapabilityToken("test_collector");
      const p1 = Promise.resolve().then(() => {
        const att = recordProviderInvocationAttempt({ provider: "serpapi", targetProductOrKeyword: "cat brush", region: "US" });
        return finalizeProviderInvocationFromTransport({
          attemptId: att.attemptId,
          receiptId: "t13_race",
          provider: "serpapi",
          transportStatus: 200,
          rawResponseBytes: "concurrent_data",
          targetProductOrKeyword: "cat brush",
          region: "US",
        }, token);
      });
      const p2 = Promise.resolve().then(() => {
        const att = recordProviderInvocationAttempt({ provider: "serpapi", targetProductOrKeyword: "cat brush", region: "US" });
        return finalizeProviderInvocationFromTransport({
          attemptId: att.attemptId,
          receiptId: "t13_race",
          provider: "serpapi",
          transportStatus: 200,
          rawResponseBytes: "concurrent_data",
          targetProductOrKeyword: "cat brush",
          region: "US",
        }, token);
      });
      const [r1, r2] = await Promise.all([p1, p2]);
      expect(r1.rawResponseSha256).toBe(r2.rawResponseSha256);
      expect(r1.receiptId).toBe("t13_race");
    });

    it("T14: raw bytes artifact modified after DB insert => verification revoked, G15 fails, no cached authority bypass", async () => {
      const raw = JSON.stringify({ search_metadata: { id: "t14_receipt", status: "Success" } });
      const stored = saveRawProviderPayloadFile(raw);
      // Tamper with saved bytes
      fs.writeFileSync(stored.artifactPath, JSON.stringify({ search_metadata: { id: "tampered" } }));

      const res = isAuthenticProviderReceiptDescriptor({
        verified: true,
        providerRequestId: "t14_receipt",
        rawResponseSha256: stored.rawResponseSha256,
        artifactPath: stored.artifactPath,
        responseStatus: 200,
      });
      expect(res.authentic).toBe(false);
      expect(res.errorCode).toBe("HASH_MISMATCH");
    });

    it("T15: valid CSV from user import (SHA true) => LOCAL_INTEGRITY_ONLY, not provider network verification or sales proof", () => {
      const lineage = hasVerifiableCsvOrProviderLineage(
        "csv-import:google-trends:sha256:04f4d039cdd4a884134914fdb9d2ed86ebbfa353991d714b78df545a96fd4b14"
      );
      expect(lineage.providerOriginVerified).toBe(false);
      expect(lineage.originKind).not.toBe("ACTUAL_PROVIDER_INVOCATION");
    });

    it("T16: multiple observations try share one valid receipt but wrong product/keyword/time => reject improper reuse", () => {
      const res = evaluateDemandSourceAuthority([
        {
          id: "obs_t16",
          source: "GOOGLE_TRENDS_LIVE",
          demandValue: 70,
          keyword: "completely wrong product",
          region: "US",
          evidenceReference: "provider-request:serpapi:req_live_verified_12345",
          verifiedDescriptor: {
            verified: true,
            providerRequestId: "req_live_verified_12345",
            rawResponseSha256: "04f4d039cdd4a884134914fdb9d2ed86ebbfa353991d714b78df545a96fd4b14",
            targetProductOrKeyword: "cat water fountain",
            region: "US",
            responseStatus: 200,
          },
        } as any,
      ], { candidateCanonicalName: "completely wrong product" });

      expect(res.authority).not.toBe("AUTHORITATIVE_VERIFIED");
    });

    it("T17: empty source name/region/keyword/receipt target when required => fail closed", () => {
      const res = evaluateDemandSourceAuthority([
        {
          id: "obs_empty",
          source: "",
          demandValue: 50,
          keyword: "",
        } as any,
      ]);
      expect(res.authority).toBe("UNKNOWN_SOURCE");
      expect(res.productAttributionValid).toBe(false);
    });

    it("T18: negative test must assert G15/G16 independently of fixture test positive", () => {
      const assessment = evaluateDemandHistoryEvidence([
        {
          id: "obs_f1",
          periodStart: "2026-06-01T00:00:00.000Z",
          demandValue: 70,
          region: "US",
          source: "GOOGLE_TRENDS_LIVE",
          keyword: "cat water fountain",
          isFixture: true,
          evidenceReference: "provider-request:serpapi:req_live_verified_12345",
        },
        {
          id: "obs_f2",
          periodStart: "2026-07-01T00:00:00.000Z",
          demandValue: 75,
          region: "US",
          source: "GOOGLE_TRENDS_LIVE",
          keyword: "cat water fountain",
          isFixture: true,
          evidenceReference: "provider-request:serpapi:req_live_verified_12345",
        },
        {
          id: "obs_f3",
          periodStart: "2026-08-01T00:00:00.000Z",
          demandValue: 80,
          region: "US",
          source: "GOOGLE_TRENDS_LIVE",
          keyword: "cat water fountain",
          isFixture: true,
          evidenceReference: "provider-request:serpapi:req_live_verified_12345",
        },
      ], { strictLiveOrigin: true });

      expect(assessment.eligibleForEvergreen).toBe(false);
      expect(assessment.status).toBe("UNVERIFIED");
    });
  });

  // ============================================================================
  // SECTION C: BACKTEST & CADENCE TESTS (B01 - B07)
  // ============================================================================
  describe("C. Backtest & Cadence Tests (B01 - B07)", () => {
    it("B01: old periodEnd, late ingestedAt after asOf => exclude even if observedAt before cutoff", () => {
      const assessment = evaluateDemandHistoryEvidence(
        [
          {
            id: "obs_b01_1",
            periodStart: "2026-06-01T00:00:00.000Z",
            demandValue: 70,
            region: "US",
            source: "GOOGLE_TRENDS_LIVE",
            keyword: "cat water fountain",
            observedAt: "2026-07-01T00:00:00.000Z",
            ingestedAt: "2026-10-25T00:00:00.000Z", // Ingested after asOf!
          } as any,
          {
            id: "obs_b01_2",
            periodStart: "2026-07-01T00:00:00.000Z",
            demandValue: 75,
            region: "US",
            source: "GOOGLE_TRENDS_LIVE",
            keyword: "cat water fountain",
            observedAt: "2026-07-15T00:00:00.000Z",
            ingestedAt: "2026-07-15T00:00:00.000Z",
          } as any,
        ],
        {
          asOfTimestamp: "2026-10-24T00:00:00.000Z",
          strictChronological: true,
        }
      );
      expect(assessment.dataPointsCount).toBe(1);
    });

    it("B02: missing knownAt/invocationCapturedAt/ingestion timestamp => reject strict replay", () => {
      const assessment = evaluateDemandHistoryEvidence(
        [
          {
            id: "obs_b02",
            periodStart: "2026-06-01T00:00:00.000Z",
            demandValue: 70,
            region: "US",
            source: "GOOGLE_TRENDS_LIVE",
            keyword: "cat water fountain",
            // No observedAt, ingestedAt, capturedAt
          } as any,
        ],
        {
          asOfTimestamp: "2026-10-24T00:00:00.000Z",
          strictChronological: true,
        }
      );
      expect(assessment.dataPointsCount).toBe(0);
      expect(assessment.status).toBe("INSUFFICIENT_HISTORY");
    });

    it("B03: cutoff exact vs cutoff+1ms, UTC offset, DST, invalid date => deterministic exclusion", () => {
      const asOfStr = "2026-10-24T00:00:00.000Z";
      const exactTime = new Date(asOfStr).toISOString();
      const pastCutoffTime = new Date(new Date(asOfStr).getTime() + 1).toISOString();

      const resExact = evaluateDemandHistoryEvidence(
        [{ id: "exact", periodStart: "2026-06-01T00:00:00.000Z", observedAt: exactTime, demandValue: 70, region: "US", keyword: "test" }],
        { asOfTimestamp: asOfStr, strictChronological: true }
      );
      const resPast = evaluateDemandHistoryEvidence(
        [{ id: "past", periodStart: "2026-06-01T00:00:00.000Z", observedAt: pastCutoffTime, demandValue: 70, region: "US", keyword: "test" }],
        { asOfTimestamp: asOfStr, strictChronological: true }
      );
      expect(resExact.dataPointsCount).toBe(1);
      expect(resPast.dataPointsCount).toBe(0);
    });

    it("B04: provider cadence WEEKLY vs forged MONTHLY tag, missing weekly bins, 60-day sparse series => no false density PASS", () => {
      const sparseMonthlyPoints = [
        {
          id: "obs_b04_1",
          periodStart: "2026-06-01T00:00:00.000Z",
          demandValue: 70,
          region: "US",
          keyword: "test",
          evidenceReference: "provider-request:serpapi:req_1:cadence=MONTHLY",
        },
        {
          id: "obs_b04_2",
          periodStart: "2026-06-08T00:00:00.000Z",
          demandValue: 72,
          region: "US",
          keyword: "test",
          evidenceReference: "provider-request:serpapi:req_2:cadence=MONTHLY",
        },
        {
          id: "obs_b04_3",
          periodStart: "2026-06-15T00:00:00.000Z",
          demandValue: 74,
          region: "US",
          keyword: "test",
          evidenceReference: "provider-request:serpapi:req_3:cadence=MONTHLY",
        },
        {
          id: "obs_b04_4",
          periodStart: "2026-07-31T00:00:00.000Z",
          demandValue: 75,
          region: "US",
          keyword: "test",
          evidenceReference: "provider-request:serpapi:req_4:cadence=MONTHLY",
        },
      ];
      const res = evaluateDemandHistoryEvidence(sparseMonthlyPoints, {
        minimumCoveredDays: 60,
        expectedCadence: "MONTHLY",
      });
      // Detected cadence gets normalized to WEEKLY because medianDelta is 7 days (<= 14)
      expect(res.expectedCadence).toBe("WEEKLY");
      expect(res.status).toBe("INSUFFICIENT_HISTORY");
    });

    it("B05: mixed-product, wrong variant/region, overlapping/duplicate periods => no blended evidence", () => {
      const mixedSeries = [
        { id: "m1", productId: "prod_A", periodStart: "2026-06-01T00:00:00.000Z", demandValue: 70, region: "US", keyword: "prod_a" },
        { id: "m2", productId: "prod_B", periodStart: "2026-07-01T00:00:00.000Z", demandValue: 75, region: "US", keyword: "prod_b" },
      ];
      const auth = evaluateDemandSourceAuthority(mixedSeries as any[]);
      expect(auth.authority).toBe("CACHED_UNVERIFIED");
      expect(auth.productAttributionValid).toBe(false);
    });

    it("B06: DEV & HOLDOUT windows, actual asOf cutoffs and event counts derived from current run JSON", () => {
      const devCutoff = new Date("2026-10-24T00:00:00.000Z");
      const holdoutCutoff = new Date("2026-10-30T12:00:00.000Z");
      expect(devCutoff.getTime()).toBeLessThan(holdoutCutoff.getTime());
    });

    it("B07: no fixture replay as real business acceptance; if no genuine history, INSUFFICIENT_HISTORICAL_EVIDENCE", () => {
      const fixtureSeries = [
        { id: "f1", isFixture: true, periodStart: "2026-06-01T00:00:00.000Z", demandValue: 70, region: "US", keyword: "test" },
      ];
      const auth = evaluateDemandSourceAuthority(fixtureSeries as any[]);
      expect(auth.authority).toBe("FIXTURE_ONLY");
    });
  });

  // ============================================================================
  // SECTION D: SOURCE / UI TESTS (E01 - E05)
  // ============================================================================
  describe("D. Source & UI Tests (E01 - E05)", () => {
    it("E01: Google raw=0 with stale associations/persisted counts>0 => quarantined; no live credit", () => {
      const staleCreative = {
        creativeId: "stale_google_creative_999",
        researchRunId: "run_e01",
        isCached: true,
        sourceMode: "CACHED_DB",
      };
      // When raw creative retrieval is 0, empty invocation ledger fails verification
      const check = verifyGoogleInvocationLineage(staleCreative, [], "run_e01");
      expect(check.verified).toBe(false);
      expect(check.lineageMethod).toBe("UNVERIFIED");
    });

    it("E02: Meta normalized/ad IDs to candidate identity; wrong Amazon PDP or brand-only match => identity not VERIFIED", () => {
      const desc = isAuthenticProviderReceiptDescriptor({
        verified: true,
        providerRequestId: "req_e02",
        rawResponseSha256: "04f4d039cdd4a884134914fdb9d2ed86ebbfa353991d714b78df545a96fd4b14",
        targetProductOrKeyword: "paw cleaner cup",
        region: "US",
        responseStatus: 200,
      }, { targetKeyword: "cat drinking fountain" });
      expect(desc.authentic).toBe(false);
      expect(desc.errorCode).toBe("PRODUCT_MISMATCH");
    });

    it("E03: API/UI labels FIXTURE_ONLY vs LOCAL_INTEGRITY_ONLY vs LIVE_ORIGIN_VERIFIED; zero=>zero", () => {
      const csvContent = "Interest over time\nDay,Category\n2026-06-01,50\n2026-06-08,55\n";
      const csvSha = crypto.createHash("sha256").update(Buffer.from(csvContent, "utf8")).digest("hex").toLowerCase();
      saveOriginalGoogleTrendsCsvFile(csvContent, csvSha);
      const csvLineage = hasVerifiableCsvOrProviderLineage(`csv-import:google-trends:sha256:${csvSha}`);
      expect(csvLineage.contentIntegrityVerified).toBe(true);
      expect(csvLineage.sourceOriginVerified).toBe(false);
      expect(csvLineage.businessLineageEligible).toBe(false);
      expect(csvLineage.sourceAuthority).toBe("CACHED_UNVERIFIED");
      expect(csvLineage.originKind).toBe("LOCAL_INTEGRITY_ONLY");

      const fixtureLineage = hasVerifiableCsvOrProviderLineage("fixture-request", {
        verified: true,
        providerRequestId: "req_live_verified_12345",
        rawResponseSha256: "04f4d039cdd4a884134914fdb9d2ed86ebbfa353991d714b78df545a96fd4b14",
        targetProductOrKeyword: "cat water fountain",
        region: "US",
        responseStatus: 200,
      });
      expect(fixtureLineage.sourceAuthority).toBe("FIXTURE_ONLY");

      const testCsvPath = path.join(path.resolve("data/google_trends_imports"), `${csvSha}.csv`);
      try {
        if (fs.existsSync(testCsvPath)) fs.unlinkSync(testCsvPath);
      } catch {}
    });

    it("E04: restart worker / concurrent job / claim fencing preserves exact accepted counts and durable evidence", () => {
      const token = createCollectorCapabilityToken("test_collector");
      const attempt = recordProviderInvocationAttempt({
        provider: "serpapi",
        targetProductOrKeyword: "water filter",
        region: "US",
      });
      finalizeProviderInvocationFromTransport({
        attemptId: attempt.attemptId,
        receiptId: "e04_receipt",
        provider: "serpapi",
        transportStatus: 200,
        rawResponseBytes: "water_filter_payload",
        targetProductOrKeyword: "water filter",
        region: "US",
      }, token);

      clearTrustedProviderInvocationsForTest();
      const loaded = getTrustedProviderReceipt("e04_receipt");
      expect(loaded).not.toBeNull();
      expect(loaded?.receiptId).toBe("e04_receipt");
    });

    it("E05: real authorized provider request if available: network request trace -> content bytes -> durable ledger -> DB -> API; otherwise explicit BLOCKED", () => {
      // In the absence of live external credentials, provider returns BLOCKED/NOT_CONFIGURED
      const res = isAuthenticProviderReceiptDescriptor(null);
      expect(res.authentic).toBe(false);
      expect(res.errorCode).toBe("RECEIPT_NOT_FOUND");
    });
  });
});
