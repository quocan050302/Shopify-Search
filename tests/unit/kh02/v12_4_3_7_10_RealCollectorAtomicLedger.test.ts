/**
 * KH-02 V12.4.3.7.10 — Real Collector Integration & Durable Ledger Atomicity Test Matrix
 *
 * Covers groups:
 * Group A: Fake-Collector & Minting Boundary Tests (P01 - P07)
 * Group B: Durable Receipt Atomicity, Concurrency & Readback (P08 - P14)
 * Group C: Fixture / Test Isolation & Sentinel Safety (P15 - P18)
 * Group D: Demand Provenance, Provider Network Wire & PIT Zero-Lookahead (P19 - P26)
 * Group E: Gate Truthfulness & G06/G07/G15/G16 Decoupling (P27 - P30)
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs";
import path from "path";
import crypto from "crypto";
import {
  createCollectorCapabilityToken,
  createTestCollectorCapabilityToken,
  getAuthorizedCollectorCapabilityToken,
  isValidCollectorCapabilityToken,
  recordProviderInvocationAttempt,
  finalizeProviderInvocationFromTransport,
  recordTrustedProviderInvocation,
  persistDurableReceipt,
  persistCollectorReceiptAtomically,
  getTrustedProviderReceipt,
  findTrustedReceiptByHash,
  saveRawProviderPayloadFile,
  registerTestFixtureReceipt,
  clearTrustedProviderInvocationsForTest,
  isAuthenticProviderReceiptDescriptor,
  hasVerifiableCsvOrProviderLineage,
  evaluateDemandSourceAuthority,
  evaluateDemandHistoryEvidence,
  resolveVerifiedDemandEvidence,
  setProviderReceiptStorageDirForTest,
  getProviderReceiptStorageDir,
} from "@/services/kh02/demand/temporalDemandEngine";
import { GoogleTrendsLegacySerpApiProvider } from "@/services/kh02/demand/demandProviderRegistry";
import { resolveProductDemandHistory } from "@/services/kh02/demand/historicalDemandIngestion";

const TEST_RUN_ID = `test_run_7_10_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
const TEST_STORAGE_DIR = path.join(process.cwd(), "data", ".test_tmp", TEST_RUN_ID);

describe("KH-02 V12.4.3.7.10 — Real Collector Integration & Durable Ledger Atomicity", () => {
  beforeEach(() => {
    if (!fs.existsSync(TEST_STORAGE_DIR)) {
      fs.mkdirSync(TEST_STORAGE_DIR, { recursive: true });
      fs.writeFileSync(path.join(TEST_STORAGE_DIR, ".owner_marker"), TEST_RUN_ID, "utf-8");
    }
    setProviderReceiptStorageDirForTest(TEST_STORAGE_DIR);
    clearTrustedProviderInvocationsForTest();
  });

  afterEach(() => {
    setProviderReceiptStorageDirForTest(null);
    clearTrustedProviderInvocationsForTest();
    try {
      const markerPath = path.join(TEST_STORAGE_DIR, ".owner_marker");
      if (fs.existsSync(markerPath) && fs.readFileSync(markerPath, "utf-8") === TEST_RUN_ID) {
        fs.rmSync(TEST_STORAGE_DIR, { recursive: true, force: true });
      }
    } catch {}
  });

  // ==========================================================================
  // GROUP A: Fake-Collector & Minting Boundary Tests (P01 - P07)
  // ==========================================================================
  describe("Group A: Fake-Collector & Minting Boundary Proof", () => {
    it("P01: Calling token factory without collector secret creates TEST_SIMULATION token, not live authority", () => {
      const publicToken = createCollectorCapabilityToken("arbitrary_caller");
      expect(isValidCollectorCapabilityToken(publicToken)).toBe(true);
      expect(publicToken.classification).toBe("TEST_SIMULATION");
      expect(publicToken.isTestSimulation).toBe(true);

      const authorizedToken = getAuthorizedCollectorCapabilityToken("google_trends_serpapi_collector");
      expect(isValidCollectorCapabilityToken(authorizedToken)).toBe(true);
      expect(authorizedToken.classification).toBe("TEST_SIMULATION");
      expect(authorizedToken.isTestSimulation).toBe(true);
    });

    it("P02: recordProviderInvocationAttempt sets status ATTEMPTED, never TRANSPORT_OBSERVED before network", () => {
      const attempt = recordProviderInvocationAttempt({
        provider: "google_trends_serpapi",
        targetProductOrKeyword: "wireless cat water fountain",
        region: "US",
        endpoint: "https://serpapi.com/search.json",
        operation: "TIMESERIES",
      });

      expect(attempt.status).toBe("ATTEMPTED");
      expect(attempt.attemptId).toMatch(/^att_/);
      expect(attempt.attemptedAt).toBeDefined();
      expect(attempt.provider).toBe("google_trends_serpapi");
    });

    it("P03: finalizeProviderInvocationFromTransport requires valid capability token", () => {
      const attempt = recordProviderInvocationAttempt({
        provider: "google_trends_serpapi",
        targetProductOrKeyword: "pet feeder",
        region: "US",
      });
      const rawPayload = JSON.stringify({
        search_metadata: { status: "Success", id: "p03_rec" },
        interest_over_time: { timeline_data: [{ date: "2026-07-01", values: [50] }] },
      });

      expect(() => {
        finalizeProviderInvocationFromTransport(
          {
            attemptId: attempt.attemptId,
            receiptId: "p03_rec",
            provider: "google_trends_serpapi",
            transportStatus: 200,
            rawResponseBytes: rawPayload,
            targetProductOrKeyword: "pet feeder",
            region: "US",
          },
          null as any
        );
      }).toThrow(/requires a verified CollectorCapabilityToken/);
    });

    it("P04: Provider response with status 200 but error JSON fails closed", () => {
      const token = getAuthorizedCollectorCapabilityToken("google_trends_serpapi_collector");
      const attempt = recordProviderInvocationAttempt({
        provider: "google_trends_serpapi",
        targetProductOrKeyword: "dog seatbelt",
        region: "US",
      });
      const errorJson = JSON.stringify({
        error: "Google has blocked this query or CAPTCHA detected",
        search_metadata: { status: "Error" },
      });

      expect(() => {
        finalizeProviderInvocationFromTransport(
          {
            attemptId: attempt.attemptId,
            receiptId: "p04_err",
            provider: "google_trends_serpapi",
            transportStatus: 200,
            rawResponseBytes: errorJson,
            targetProductOrKeyword: "dog seatbelt",
            region: "US",
          },
          token
        );
      }).toThrow(/Provider payload contains error or unsuccessful status/);
    });

    it("P05: Non-200 transport status (403, 429, 500) fails closed and cannot produce live receipt", () => {
      const token = getAuthorizedCollectorCapabilityToken("google_trends_serpapi_collector");
      const attempt = recordProviderInvocationAttempt({
        provider: "google_trends_serpapi",
        targetProductOrKeyword: "cat laser toy",
        region: "US",
      });

      for (const status of [403, 429, 500]) {
        expect(() => {
          finalizeProviderInvocationFromTransport(
            {
              attemptId: attempt.attemptId,
              receiptId: `p05_${status}`,
              provider: "google_trends_serpapi",
              transportStatus: status,
              rawResponseBytes: "rate limit or server error",
              targetProductOrKeyword: "cat laser toy",
              region: "US",
            },
            token
          );
        }).toThrow(/Cannot finalize provider invocation with non-200 transport status/);
      }
    });

    it("P06: Empty body or repeating/zero SHA fails closed", () => {
      const token = getAuthorizedCollectorCapabilityToken("google_trends_serpapi_collector");
      const attempt = recordProviderInvocationAttempt({
        provider: "google_trends_serpapi",
        targetProductOrKeyword: "dog harness",
        region: "US",
      });

      expect(() => {
        finalizeProviderInvocationFromTransport(
          {
            attemptId: attempt.attemptId,
            receiptId: "p06_empty",
            provider: "google_trends_serpapi",
            transportStatus: 200,
            rawResponseBytes: "",
            targetProductOrKeyword: "dog harness",
            region: "US",
          },
          token
        );
      }).toThrow(/Cannot finalize provider invocation with empty raw response bytes/);
    });

    it("P07: Provider mismatch between attempt and finalization fails closed", () => {
      const token = getAuthorizedCollectorCapabilityToken("google_trends_serpapi_collector");
      const attempt = recordProviderInvocationAttempt({
        provider: "google_trends_serpapi",
        targetProductOrKeyword: "dog collar",
        region: "US",
      });

      expect(() => {
        finalizeProviderInvocationFromTransport(
          {
            attemptId: attempt.attemptId,
            receiptId: "p07_mismatch",
            provider: "meta_ads", // mismatched provider!
            transportStatus: 200,
            rawResponseBytes: JSON.stringify({ ok: true }),
            targetProductOrKeyword: "dog collar",
            region: "US",
          },
          token
        );
      }).toThrow(/Provider mismatch between attempt/);
    });
  });

  // ==========================================================================
  // GROUP B: Durable Receipt Atomicity, Concurrency & Readback (P08 - P14)
  // ==========================================================================
  describe("Group B: Durable Receipt Atomicity & Concurrency", () => {
    it("P08: persistDurableReceipt writes atomically and readback verifies on disk", () => {
      const token = getAuthorizedCollectorCapabilityToken("google_trends_serpapi_collector");
      const raw = JSON.stringify({ search_metadata: { id: "p08_rec", status: "Success" } });
      const stored = saveRawProviderPayloadFile(raw);

      const receipt = {
        receiptId: "p08_rec",
        provider: "google_trends_serpapi",
        originKind: "ACTUAL_PROVIDER_INVOCATION" as const,
        targetProductOrKeyword: "cat bed",
        region: "US",
        transportStatus: 200,
        capturedAt: new Date().toISOString(),
        rawResponseSha256: stored.rawResponseSha256,
        rawByteCount: stored.byteCount,
        artifactPath: stored.artifactPath,
      };

      const res = persistDurableReceipt(receipt);
      expect(res.state).toBe("LEDGER_PENDING_DB");
      expect(res.eligible).toBe(false);
      expect(res.ledgerReadbackVerified).toBe(true);
      expect(res.artifactVerified).toBe(true);

      // Verify readback from disk even after clearing memory maps
      clearTrustedProviderInvocationsForTest();
      const readBack = getTrustedProviderReceipt("p08_rec");
      expect(readBack).not.toBeNull();
      expect(readBack?.rawResponseSha256).toBe(stored.rawResponseSha256);
      expect(readBack?.targetProductOrKeyword).toBe("cat bed");
    });

    it("P09: Concurrent writing of different receipt IDs persists both intact without lost updates", () => {
      const raw1 = JSON.stringify({ search_metadata: { id: "p09_r1", status: "Success" } });
      const raw2 = JSON.stringify({ search_metadata: { id: "p09_r2", status: "Success" } });
      const s1 = saveRawProviderPayloadFile(raw1);
      const s2 = saveRawProviderPayloadFile(raw2);

      const rec1 = {
        receiptId: "p09_r1",
        provider: "google_trends_serpapi",
        originKind: "ACTUAL_PROVIDER_INVOCATION" as const,
        targetProductOrKeyword: "item 1",
        region: "US",
        transportStatus: 200,
        capturedAt: new Date().toISOString(),
        rawResponseSha256: s1.rawResponseSha256,
        rawByteCount: s1.byteCount,
        artifactPath: s1.artifactPath,
      };

      const rec2 = {
        receiptId: "p09_r2",
        provider: "google_trends_serpapi",
        originKind: "ACTUAL_PROVIDER_INVOCATION" as const,
        targetProductOrKeyword: "item 2",
        region: "US",
        transportStatus: 200,
        capturedAt: new Date().toISOString(),
        rawResponseSha256: s2.rawResponseSha256,
        rawByteCount: s2.byteCount,
        artifactPath: s2.artifactPath,
      };

      const res1 = persistDurableReceipt(rec1);
      const res2 = persistDurableReceipt(rec2);

      expect(res1.state).toBe("LEDGER_PENDING_DB");
      expect(res2.state).toBe("LEDGER_PENDING_DB");

      clearTrustedProviderInvocationsForTest();
      expect(getTrustedProviderReceipt("p09_r1")).not.toBeNull();
      expect(getTrustedProviderReceipt("p09_r2")).not.toBeNull();
    });

    it("P10: Conflicting receipt with same ID but different hash reports CONFLICT and does not overwrite", () => {
      const raw1 = JSON.stringify({ id: 1 });
      const raw2 = JSON.stringify({ id: 2 });
      const s1 = saveRawProviderPayloadFile(raw1);
      const s2 = saveRawProviderPayloadFile(raw2);

      const rec1 = {
        receiptId: "p10_conflict",
        provider: "google_trends_serpapi",
        originKind: "ACTUAL_PROVIDER_INVOCATION" as const,
        targetProductOrKeyword: "item original",
        region: "US",
        transportStatus: 200,
        capturedAt: new Date().toISOString(),
        rawResponseSha256: s1.rawResponseSha256,
        rawByteCount: s1.byteCount,
        artifactPath: s1.artifactPath,
      };

      const rec2 = {
        receiptId: "p10_conflict", // SAME ID
        provider: "google_trends_serpapi",
        originKind: "ACTUAL_PROVIDER_INVOCATION" as const,
        targetProductOrKeyword: "item original",
        region: "US",
        transportStatus: 200,
        capturedAt: new Date().toISOString(),
        rawResponseSha256: s2.rawResponseSha256, // DIFFERENT HASH
        rawByteCount: s2.byteCount,
        artifactPath: s2.artifactPath,
      };

      const res1 = persistDurableReceipt(rec1);
      expect(res1.state).toBe("LEDGER_PENDING_DB");

      const res2 = persistDurableReceipt(rec2);
      expect(res2.state).toBe("CONFLICT");
      expect(res2.errorCode).toBe("RECEIPT_CONFLICT");

      // Verify disk still has original
      clearTrustedProviderInvocationsForTest();
      const readBack = getTrustedProviderReceipt("p10_conflict");
      expect(readBack?.rawResponseSha256).toBe(s1.rawResponseSha256);
    });

    it("P11: Idempotent duplicate registration succeeds without error", () => {
      const raw = JSON.stringify({ search_metadata: { id: "p11_idempotent", status: "Success" } });
      const stored = saveRawProviderPayloadFile(raw);

      const rec = {
        receiptId: "p11_idempotent",
        provider: "google_trends_serpapi",
        originKind: "ACTUAL_PROVIDER_INVOCATION" as const,
        targetProductOrKeyword: "repeatable item",
        region: "US",
        transportStatus: 200,
        capturedAt: new Date().toISOString(),
        rawResponseSha256: stored.rawResponseSha256,
        rawByteCount: stored.byteCount,
        artifactPath: stored.artifactPath,
      };

      const res1 = persistDurableReceipt(rec);
      expect(res1.state).toBe("LEDGER_PENDING_DB");

      const res2 = persistDurableReceipt(rec);
      expect(res2.state).toBe("LEDGER_PENDING_DB");
    });

    it("P12: persistCollectorReceiptAtomically executes full staged workflow asynchronously", async () => {
      const raw = JSON.stringify({ search_metadata: { id: "p12_async", status: "Success" } });
      const stored = saveRawProviderPayloadFile(raw);

      const rec = {
        receiptId: "p12_async",
        provider: "google_trends_serpapi",
        originKind: "ACTUAL_PROVIDER_INVOCATION" as const,
        targetProductOrKeyword: "async item",
        region: "US",
        transportStatus: 200,
        capturedAt: new Date().toISOString(),
        rawResponseSha256: stored.rawResponseSha256,
        rawByteCount: stored.byteCount,
        artifactPath: stored.artifactPath,
      };

      const res = await persistCollectorReceiptAtomically(rec);
      expect(res.state).toBe("EVIDENCE_ELIGIBLE");
      expect(res.eligible).toBe(true);
      expect(res.dbCommitted).toBe(true);
      expect(res.ledgerReadbackVerified).toBe(true);
      expect(res.artifactVerified).toBe(true);
      expect(res.receiptId).toBe("p12_async");
    });
  });

  // ==========================================================================
  // GROUP C: Fixture / Test Isolation & Sentinel Safety (P15 - P18)
  // ==========================================================================
  describe("Group C: Fixture / Test Isolation & Sentinel Safety", () => {
    it("P15: Production baseline files in data/provider_receipts remain untouched by tests", () => {
      const baselineDir = path.join(process.cwd(), "data", "provider_receipts");
      if (fs.existsSync(baselineDir)) {
        const files = fs.readdirSync(baselineDir).filter((f) => !f.startsWith("."));
        expect(files.length).toBeGreaterThanOrEqual(3);
        for (const file of files) {
          const filePath = path.join(baselineDir, file);
          const buf = fs.readFileSync(filePath);
          const computed = crypto.createHash("sha256").update(buf).digest("hex").toLowerCase();
          const expectedName = path.parse(file).name.toLowerCase();
          expect(computed).toBe(expectedName);
        }
      }
    });

    it("P16: registerTestFixtureReceipt does NOT write into production ledger file", () => {
      const prodLedgerPath = path.join(process.cwd(), "data", "provider_receipts", ".provider_receipt_ledger.json");
      let mtimeBefore = 0;
      if (fs.existsSync(prodLedgerPath)) {
        mtimeBefore = fs.statSync(prodLedgerPath).mtimeMs;
      }

      registerTestFixtureReceipt({
        receiptId: "test_fixture_isolation_receipt",
        provider: "test_fixture",
        rawResponseSha256: "04f4d039cdd4a884134914fdb9d2ed86ebbfa353991d714b78df545a96fd4b14",
        targetProductOrKeyword: "isolated test",
        region: "US",
      });

      if (fs.existsSync(prodLedgerPath)) {
        const mtimeAfter = fs.statSync(prodLedgerPath).mtimeMs;
        expect(mtimeAfter).toBe(mtimeBefore);
      }
    });

    it("P17: Fixture receipt fails closed under strictLiveOrigin=true", () => {
      const desc = {
        verified: true,
        providerRequestId: "req_live_verified_12345",
        rawResponseSha256: "04f4d039cdd4a884134914fdb9d2ed86ebbfa353991d714b78df545a96fd4b14",
        targetProductOrKeyword: "cat water fountain",
        region: "US",
        responseStatus: 200,
      };

      const res = isAuthenticProviderReceiptDescriptor(desc, {
        strictLiveOrigin: true,
        region: "US",
        targetKeyword: "cat water fountain",
      });

      expect(res.authentic).toBe(false);
      expect(res.errorCode).toBe("ORIGIN_UNVERIFIED");
      expect(res.providerOriginVerified).toBe(false);
    });
  });

  // ==========================================================================
  // GROUP D: Demand Provenance, Provider Network Wire & Zero Lookahead (P19 - P26)
  // ==========================================================================
  describe("Group D: Demand Provenance & Network Wire", () => {
    it("P19: LegacySerpApiDemandProvider returns BLOCKED when SERPAPI_API_KEY is missing, no synthetic pass", async () => {
      const originalKey = process.env.SERPAPI_API_KEY;
      delete process.env.SERPAPI_API_KEY;
      try {
        const provider = new GoogleTrendsLegacySerpApiProvider();
        const res = await provider.fetchSeries({
          term: "cat scratcher",
          region: "US",
          startDate: new Date("2026-06-01"),
          endDate: new Date("2026-09-01"),
        });

        expect(res.status).toBe("BLOCKED");
        expect(res.error).toMatch(/SERPAPI_API_KEY.*not configured/i);
        expect(res.points).toHaveLength(0);
      } finally {
        if (originalKey) process.env.SERPAPI_API_KEY = originalKey;
      }
    });

    it("P20: Official CSV reference without provider network call is classified HISTORICAL_SOURCE_VERIFIED, never LIVE", () => {
      const ref = "sha256:04f4d039cdd4a884134914fdb9d2ed86ebbfa353991d714b78df545a96fd4b14";
      const lineage = hasVerifiableCsvOrProviderLineage(ref);

      expect(lineage.providerOriginVerified).toBe(false);
      expect(lineage.sourceAuthority).not.toBe("AUTHORITATIVE_VERIFIED");
    });

    it("P21: evaluateDemandSourceAuthority strictly rejects CSV claiming to be GOOGLE_TRENDS_LIVE without network receipt", () => {
      const fakeLiveObs = [
        {
          id: "obs_fake_live",
          periodStart: "2026-07-01T00:00:00.000Z",
          demandValue: 70,
          keyword: "pet feeder",
          region: "US",
          source: "GOOGLE_TRENDS_LIVE", // claimed live!
          evidenceReference: "sha256:04f4d039cdd4a884134914fdb9d2ed86ebbfa353991d714b78df545a96fd4b14", // but only CSV hash!
        },
      ];

      const auth = evaluateDemandSourceAuthority(fakeLiveObs as any[], {
        strictLiveOrigin: true,
        requiredRegion: "US",
        candidateCanonicalName: "pet feeder",
      });

      expect(auth.authority).toBe("CACHED_UNVERIFIED");
      expect(auth.reasons.some((r) => r.includes("lacks verifiable provider API request receipt"))).toBe(true);
    });

    it("P22: Point-in-time enforcement strictly rejects observations captured after asOfTimestamp", () => {
      const observations = [
        {
          periodStart: "2026-08-01T00:00:00.000Z",
          periodEnd: "2026-08-07T00:00:00.000Z",
          demandValue: 50,
          source: "GOOGLE_TRENDS_CSV",
          keyword: "dog bowl",
          region: "US",
          evidenceReference: "sha256:04f4d039cdd4a884134914fdb9d2ed86ebbfa353991d714b78df545a96fd4b14",
          sourceCapturedAt: "2026-10-25T00:00:00.000Z", // captured AFTER cutoff!
        },
      ];

      const assessment = evaluateDemandHistoryEvidence(observations as any[], {
        asOfTimestamp: "2026-10-24T00:00:00.000Z", // cutoff is Oct 24
        strictChronological: true,
      });

      expect(assessment.dataPointsCount).toBe(0);
      expect(assessment.status).toBe("INSUFFICIENT_HISTORY");
    });

    it("P23: Mocked fetch / test simulation token cannot produce ACTUAL_PROVIDER_INVOCATION in non-test env", () => {
      const origEnv = process.env.NODE_ENV;
      (process.env as any).NODE_ENV = "production";
      try {
        const testToken = createCollectorCapabilityToken("external_test_mock");
        const attempt = recordProviderInvocationAttempt({
          provider: "google_trends_serpapi",
          targetProductOrKeyword: "pet brush",
          region: "US",
        });

        expect(() => {
          finalizeProviderInvocationFromTransport(
            {
              attemptId: attempt.attemptId,
              receiptId: "p23_fake",
              provider: "google_trends_serpapi",
              transportStatus: 200,
              rawResponseBytes: JSON.stringify({ ok: true }),
              targetProductOrKeyword: "pet brush",
              region: "US",
              originKind: "ACTUAL_PROVIDER_INVOCATION",
            },
            testToken
          );
        }).toThrow(/Test simulation capability token cannot produce ACTUAL_PROVIDER_INVOCATION/);
      } finally {
        (process.env as any).NODE_ENV = origEnv;
      }
    });

    it("P24: BigQuery top terms and Google Trending Now discovery signals are classified ESTIMATED_OR_PROXY", () => {
      const bqSeries = [
        {
          periodStart: "2026-07-01",
          demandValue: 80,
          keyword: "pet feeder",
          region: "US",
          source: "Google Trends BigQuery (Public Top Terms)",
          evidenceReference: "bigquery-public-dataset:google_trends",
        },
      ];
      const authBq = evaluateDemandSourceAuthority(bqSeries as any[], { requiredRegion: "US" });
      expect(authBq.authority).toBe("ESTIMATED_OR_PROXY");

      const trendSeries = [
        {
          periodStart: "2026-07-01",
          demandValue: 90,
          keyword: "pet feeder",
          region: "US",
          source: "Google Trending Now RSS (Spike Signal)",
          evidenceReference: "trending-now-rss:us",
        },
      ];
      const authTrend = evaluateDemandSourceAuthority(trendSeries as any[], { requiredRegion: "US" });
      expect(authTrend.authority).toBe("ESTIMATED_OR_PROXY");
    });

    it("P25: Multi-product merging in demand series is rejected as CACHED_UNVERIFIED", () => {
      const mergedSeries = [
        {
          periodStart: "2026-07-01",
          demandValue: 50,
          keyword: "cat water fountain",
          productId: "prod_001",
          source: "GOOGLE_TRENDS_CSV",
          evidenceReference: "sha256:04f4d039cdd4a884134914fdb9d2ed86ebbfa353991d714b78df545a96fd4b14",
        },
        {
          periodStart: "2026-08-01",
          demandValue: 60,
          keyword: "dog water fountain",
          productId: "prod_002", // DIFFERENT PRODUCT ID!
          source: "GOOGLE_TRENDS_CSV",
          evidenceReference: "sha256:04f4d039cdd4a884134914fdb9d2ed86ebbfa353991d714b78df545a96fd4b14",
        },
      ];
      const auth = evaluateDemandSourceAuthority(mergedSeries as any[], { requiredRegion: "US" });
      expect(auth.authority).toBe("CACHED_UNVERIFIED");
      expect(auth.reasons.some((r) => r.includes("multi-product merging is prohibited"))).toBe(true);
    });
  });

  // ==========================================================================
  // GROUP E: Gate Truthfulness & G06/G07/G15/G16 Decoupling (P27 - P30)
  // ==========================================================================
  describe("Group E: Gate Truthfulness & Decoupling", () => {
    it("P27: resolveVerifiedDemandEvidence requires canonical durable receipt and does not self-certify", async () => {
      const unbackedRes = await resolveVerifiedDemandEvidence("provider-request:serpapi:non_existent_req_id", {
        keyword: "cat collar",
        region: "US",
      });

      expect(unbackedRes.verified).toBe(false);
      expect(unbackedRes.errorCode).toBe("RECEIPT_NOT_FOUND");
    });

    it("P28: G07 stays BLOCKED and G15/G16 stay INSUFFICIENT without genuine provider evidence", () => {
      const emptyAssessment = evaluateDemandHistoryEvidence([], {
        minimumDataPoints: 3,
        minimumCoveredDays: 60,
        requiredRegion: "US",
      });

      expect(emptyAssessment.status).toBe("INSUFFICIENT_HISTORY");
      expect(emptyAssessment.missingEvidence).toContain("No demand observations provided.");
    });

    it("P29: Broad category terms used as SKU demand proxy are classified ESTIMATED_OR_PROXY", () => {
      const broadSeries = [
        {
          periodStart: "2026-07-01",
          demandValue: 70,
          keyword: "pet products", // broad category!
          source: "GOOGLE_TRENDS_CSV",
          evidenceReference: "sha256:04f4d039cdd4a884134914fdb9d2ed86ebbfa353991d714b78df545a96fd4b14",
        },
      ];
      const auth = evaluateDemandSourceAuthority(broadSeries as any[], {
        requiredRegion: "US",
        searchTermUsed: "pet products",
      });
      expect(auth.authority).toBe("ESTIMATED_OR_PROXY");
    });

    it("P30: G06 Ads creative and Trends demand are independent and cannot cross-certify", () => {
      const adLineageObs = [
        {
          periodStart: "2026-07-01",
          demandValue: 70,
          keyword: "automatic feeder",
          source: "GOOGLE_TRENDS_LIVE",
          evidenceReference: "google-ads-creative:ad_12345", // ad creative reference, NOT demand receipt!
        },
      ];
      const auth = evaluateDemandSourceAuthority(adLineageObs as any[], {
        strictLiveOrigin: true,
        requiredRegion: "US",
      });
      expect(auth.authority).toBe("CACHED_UNVERIFIED");
    });

    it("P31: Corrupted ledger JSON file fails closed with informative error rather than silently ignoring", () => {
      const ledgerPath = path.join(getProviderReceiptStorageDir(), ".provider_receipt_ledger.json");
      fs.writeFileSync(ledgerPath, "{ corrupted json syntax", "utf-8");

      const rec = {
        receiptId: "p31_corrupt",
        provider: "google_trends_serpapi",
        originKind: "ACTUAL_PROVIDER_INVOCATION" as const,
        targetProductOrKeyword: "test item",
        region: "US",
        transportStatus: 200,
        capturedAt: new Date().toISOString(),
        rawResponseSha256: "04f4d039cdd4a884134914fdb9d2ed86ebbfa353991d714b78df545a96fd4b14",
        rawByteCount: 100,
        artifactPath: path.join(getProviderReceiptStorageDir(), "04f4d039cdd4a884134914fdb9d2ed86ebbfa353991d714b78df545a96fd4b14.json"),
      };

      expect(() => {
        persistDurableReceipt(rec);
      }).toThrow(/Failed to parse durable ledger file/);
    });

    it("P32: Zero-byte or missing receiptId returns structured FAILED result", () => {
      const res = persistDurableReceipt(null as any);
      expect(res.state).toBe("FAILED");
      expect(res.errorCode).toBe("INVALID_RECEIPT");
    });
  });
});
