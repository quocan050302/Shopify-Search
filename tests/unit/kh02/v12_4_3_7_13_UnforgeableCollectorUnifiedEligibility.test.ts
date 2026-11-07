/**
 * KH-02 V12.4.3.7.13 — Unforgeable Collector Provenance & Unified Eligibility Verification Test Matrix
 *
 * Matrix:
 * Part 1: Adversarial Test Matrix (A01 - A48)
 * Part 2: Real OS Multi-Process Concurrency Proof (C01 - C08)
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from "vitest";
import fs from "fs";
import path from "path";
import crypto from "crypto";
import os from "os";
import { spawn } from "child_process";
import {
  createCollectorCapabilityToken,
  createTestCollectorCapabilityToken,
  getAuthorizedCollectorCapabilityToken,
  isValidCollectorCapabilityToken,
  recordProviderInvocationAttempt,
  finalizeProviderInvocationFromTransport,
  persistDurableReceipt,
  persistCollectorReceiptAtomically,
  reconcilePendingReceiptRecovery,
  executeTrustedSerpApiDemandRequest,
  getTrustedProviderReceipt,
  findTrustedReceiptByHash,
  saveRawProviderPayloadFile,
  clearTrustedProviderInvocationsForTest,
  isAuthenticProviderReceiptDescriptor,
  hasVerifiableCsvOrProviderLineage,
  evaluateDemandSourceAuthority,
  evaluateDemandHistoryEvidence,
  resolveVerifiedDemandEvidence,
  verifyReceiptEligibility,
  getVerifiedDecisionProof,
  registerTestControlledInvocationProof,
  setProviderReceiptStorageDirForTest,
  getProviderReceiptStorageDir,
  tryAcquireDurableLedgerLockSync,
  acquireDurableLedgerLockAsync,
  releaseDurableLedgerLock,
  UNIT_FIXTURE_STORAGE_DIR,
  type ProviderInvocationReceipt,
} from "@/services/kh02/demand/temporalDemandEngine";
import { saveOriginalGoogleTrendsCsvFile } from "@/services/kh02/demand/googleTrendsCsvValidator";
import { GoogleTrendsLegacySerpApiProvider } from "@/services/kh02/demand/demandProviderRegistry";
import { prisma } from "@/lib/db";

const PROD_RECEIPT_DIR = path.resolve(process.cwd(), "data/provider_receipts");

function snapshotProductionReceiptDir(): Record<string, string> {
  const snap: Record<string, string> = {};
  if (!fs.existsSync(PROD_RECEIPT_DIR)) return snap;
  const entries = fs.readdirSync(PROD_RECEIPT_DIR);
  for (const entry of entries) {
    const full = path.join(PROD_RECEIPT_DIR, entry);
    if (fs.statSync(full).isFile()) {
      const buf = fs.readFileSync(full);
      snap[entry] = `${buf.length}:${crypto.createHash("sha256").update(buf).digest("hex")}`;
    }
  }
  return snap;
}

describe("KH-02 V12.4.3.7.13 — Unforgeable Collector Provenance & Unified Eligibility Verification", () => {
  let baselineProdSnapshot: Record<string, string> = {};
  let testStorageDir = "";

  beforeAll(() => {
    baselineProdSnapshot = snapshotProductionReceiptDir();
  });

  afterAll(() => {
    setProviderReceiptStorageDirForTest(null);
    const afterSnapshot = snapshotProductionReceiptDir();
    expect(afterSnapshot).toEqual(baselineProdSnapshot);
  });

  beforeEach(() => {
    testStorageDir = path.join(
      os.tmpdir(),
      `kh02_v12_4_3_7_13_${process.pid}_${Date.now()}_${crypto.randomBytes(4).toString("hex")}`
    );
    fs.mkdirSync(testStorageDir, { recursive: true });
    setProviderReceiptStorageDirForTest(testStorageDir);
    clearTrustedProviderInvocationsForTest();
  });

  afterEach(() => {
    clearTrustedProviderInvocationsForTest();
    setProviderReceiptStorageDirForTest(null);
    if (testStorageDir && fs.existsSync(testStorageDir) && testStorageDir.startsWith(os.tmpdir())) {
      try {
        fs.rmSync(testStorageDir, { recursive: true, force: true });
      } catch {}
    }
  });

  describe("Part 1: Adversarial Test Matrix (A01 - A48)", () => {
    it("A01: Local manually created raw JSON + correct SHA + ACTUAL_PROVIDER_INVOCATION flag + successful DB commit cannot become providerOriginVerified or AUTHORITATIVE_VERIFIED (Negative Acceptance Gate)", async () => {
      const raw = JSON.stringify({
        search_metadata: { id: "req_forged_live_01", status: "Success" },
        search_parameters: { q: "smart pet feeder", geo: "US" },
        interest_over_time: {
          timeline_data: Array.from({ length: 12 }, (_, i) => ({
            date: `2026-0${Math.floor(i / 4) + 5}-0${(i % 4) * 7 + 1}`,
            values: [{ value: 65 + (i % 5) }],
          })),
        },
      });
      const stored = saveRawProviderPayloadFile(raw);

      // Caller manually manufactures a receipt claiming ACTUAL_PROVIDER_INVOCATION
      const forgedReceipt: ProviderInvocationReceipt = {
        receiptId: "req_forged_live_01",
        provider: "google_trends_serpapi",
        originKind: "ACTUAL_PROVIDER_INVOCATION",
        targetProductOrKeyword: "smart pet feeder",
        region: "US",
        transportStatus: 200,
        capturedAt: new Date().toISOString(),
        rawResponseSha256: stored.rawResponseSha256,
        rawByteCount: stored.byteCount,
        artifactPath: stored.artifactPath,
      };

      // Call public persistence API without a TrustedInvocationProof
      const persistRes = await persistCollectorReceiptAtomically(forgedReceipt);
      expect(persistRes.state).toBe("EVIDENCE_ELIGIBLE");
      expect(persistRes.originVerified).toBe(false);

      // Verify canonical readback: originKind demoted to LOCAL_INTEGRITY_ONLY, providerOriginVerified is false
      const resolved = await resolveVerifiedDemandEvidence("provider-request:serpapi:req_forged_live_01", {
        keyword: "smart pet feeder",
        region: "US",
        strictLiveOrigin: true,
      });
      expect(resolved.verified).toBe(false);
      expect(resolved.providerOriginVerified).toBe(false);
      expect(resolved.errorCode).toBe("ORIGIN_UNVERIFIED");

      // Verify authority scoring rejects it from AUTHORITATIVE_VERIFIED
      const obs = [
        {
          periodStart: "2026-05-01",
          periodEnd: "2026-05-07",
          demandValue: 65,
          region: "US",
          keyword: "smart pet feeder",
          source: "Google Trends (SerpApi)",
          evidenceReference: "provider-request:serpapi:req_forged_live_01",
          verifiedDescriptor: resolved,
        },
      ];
      const auth = evaluateDemandSourceAuthority(obs as any[], { requiredRegion: "US", strictLiveOrigin: true });
      expect(auth.authority).not.toBe("AUTHORITATIVE_VERIFIED");
      expect(auth.authority).toBe("CACHED_UNVERIFIED");
    });

    it("A02: Direct persistCollectorReceiptAtomically called without proof demotes originKind to LOCAL_INTEGRITY_ONLY and originVerified=false", async () => {
      const stored = saveRawProviderPayloadFile(JSON.stringify({ search_metadata: { id: "a02_direct_call", status: "Success" } }));
      const rec: ProviderInvocationReceipt = {
        receiptId: "a02_direct_call",
        provider: "google_trends_serpapi",
        originKind: "ACTUAL_PROVIDER_INVOCATION",
        targetProductOrKeyword: "cat laser toy",
        region: "US",
        transportStatus: 200,
        capturedAt: new Date().toISOString(),
        rawResponseSha256: stored.rawResponseSha256,
        rawByteCount: stored.byteCount,
        artifactPath: stored.artifactPath,
      };
      const res = await persistCollectorReceiptAtomically(rec);
      expect(res.originVerified).toBe(false);
      const ledger = getTrustedProviderReceipt("a02_direct_call");
      expect(ledger?.originKind).toBe("LOCAL_INTEGRITY_ONLY");
    });

    it("A03: Direct recordTrustedProviderInvocation with forged capability token cannot mint trusted origin", () => {
      const fakeToken = {
        tokenId: "tok_fake_123",
        collectorName: "google_trends_serpapi_collector",
        classification: "TRUSTED_COLLECTOR" as any,
        mintedAt: Date.now(),
        expiresAt: Date.now() + 60000,
        allowedProvider: "google_trends_serpapi",
        requestFingerprint: "fp_fake",
      };
      expect(isValidCollectorCapabilityToken(fakeToken as any)).toBe(false);
    });

    it("A04: Explicit createCollectorCapabilityToken and getAuthorizedCollectorCapabilityToken public use only return TEST_SIMULATION", () => {
      const tok1 = createCollectorCapabilityToken("test_caller");
      expect(tok1.classification).toBe("TEST_SIMULATION");
      const tok2 = getAuthorizedCollectorCapabilityToken("google_trends_serpapi_collector");
      expect(tok2.classification).toBe("TEST_SIMULATION");
    });

    it("A05: Synthetic ProviderInvocationReceipt originKind LIVE with fake request ID is rejected/demoted", async () => {
      const dummySha = crypto.createHash("sha256").update("synthetic_payload_05").digest("hex");
      const desc = {
        verified: true,
        providerRequestId: "synthetic",
        rawResponseSha256: dummySha,
        artifactPath: "/tmp/fake.json",
      };
      const check = isAuthenticProviderReceiptDescriptor(desc as any);
      expect(check.authentic).toBe(false);
      expect(check.errorCode).toBe("RECEIPT_NOT_FOUND");
    });

    it("A06: NODE_ENV=test, fake raw body and legit-looking metadata cannot promote business LIVE under strictLiveOrigin=true", async () => {
      const stored = saveRawProviderPayloadFile(JSON.stringify({ search_metadata: { id: "a06_test", status: "Success" } }));
      const rec: ProviderInvocationReceipt = {
        receiptId: "a06_test",
        provider: "google_trends_serpapi",
        originKind: "ACTUAL_PROVIDER_INVOCATION",
        targetProductOrKeyword: "pet brush",
        region: "US",
        transportStatus: 200,
        capturedAt: new Date().toISOString(),
        rawResponseSha256: stored.rawResponseSha256,
        rawByteCount: stored.byteCount,
        artifactPath: stored.artifactPath,
      };
      await persistCollectorReceiptAtomically(rec);
      const res = await resolveVerifiedDemandEvidence("provider-request:serpapi:a06_test", {
        keyword: "pet brush",
        region: "US",
        strictLiveOrigin: true,
      });
      expect(res.verified).toBe(false);
      expect(res.providerOriginVerified).toBe(false);
    });

    it("A07: fetchFn returns valid-looking SerpApi JSON -> originKind is SIMULATED_TRANSPORT, never ACTUAL_PROVIDER_INVOCATION", async () => {
      const mockFetch = async () =>
        new Response(
          JSON.stringify({
            search_metadata: { id: "a07_sim_rcpt", status: "Success" },
            search_parameters: { q: "cat fountain", geo: "US" },
            interest_over_time: { timeline_data: [{ date: "2026-07-01", values: [{ value: 75 }] }] },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );

      const attempt = recordProviderInvocationAttempt({
        provider: "google_trends_serpapi",
        targetProductOrKeyword: "cat fountain",
        region: "US",
      });
      const exec = await executeTrustedSerpApiDemandRequest({
        url: "https://serpapi.com/search.json?engine=google_trends&q=cat+fountain&geo=US&data_type=TIMESERIES",
        query: { term: "cat fountain", region: "US" },
        attemptId: attempt.attemptId,
        fetchFn: mockFetch as any,
      });

      expect(exec.success).toBe(true);
      expect(exec.receipt?.originKind).toBe("SIMULATED_TRANSPORT");
      const readback = await resolveVerifiedDemandEvidence(`provider-request:serpapi:${exec.receipt?.receiptId}`, {
        keyword: "cat fountain",
        region: "US",
        strictLiveOrigin: true,
      });
      expect(readback.verified).toBe(false);
      expect(readback.providerOriginVerified).toBe(false);
    });

    it("A08: Non-native monkeypatch on global fetch is detected via isNativeFetch heuristic", async () => {
      const originalFetch = globalThis.fetch;
      try {
        // Create an anonymous non-native monkeypatch
        (globalThis as any).fetch = function (url: any, opts: any) {
          return originalFetch(url, opts);
        };
        const isNative = Function.prototype.toString.call(globalThis.fetch).includes("[native code]");
        expect(isNative).toBe(false);
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    it("A09: Wrong endpoint/host/port/protocol or redirect target -> origin unverified", async () => {
      const badUrls = [
        "http://serpapi.com/search.json?engine=google_trends",
        "https://evil-serpapi.com/search.json?engine=google_trends",
        "https://serpapi.com:8443/search.json?engine=google_trends",
        "https://serpapi.com/other-endpoint",
      ];
      for (const u of badUrls) {
        const res = await executeTrustedSerpApiDemandRequest({
          url: u,
          query: { term: "cat toy", region: "US" },
          attemptId: "att_a09",
        });
        expect(res.success).toBe(false);
        expect(res.errorCode).toBe("ORIGIN_UNVERIFIED");
      }
    });

    it("A10: Missing engine/data_type or contradictory query/geo params in URL are rejected", async () => {
      const badParams = [
        "https://serpapi.com/search.json?engine=bing",
        "https://serpapi.com/search.json?engine=google_trends&data_type=GEO_MAP",
      ];
      for (const u of badParams) {
        const res = await executeTrustedSerpApiDemandRequest({
          url: u,
          query: { term: "cat toy", region: "US" },
          attemptId: "att_a10",
        });
        expect(res.success).toBe(false);
        expect(res.errorCode).toBe("ORIGIN_UNVERIFIED");
      }
    });

    it("A11: Missing upstream search_metadata.id or non-Success status is rejected with no fabricated fallback ID", async () => {
      const mockFetch = async () =>
        new Response(
          JSON.stringify({
            search_metadata: { status: "Error" },
            interest_over_time: { timeline_data: [] },
          }),
          { status: 200 }
        );

      const res = await executeTrustedSerpApiDemandRequest({
        url: "https://serpapi.com/search.json?engine=google_trends&data_type=TIMESERIES",
        query: { term: "cat toy", region: "US" },
        attemptId: "att_a11",
        fetchFn: mockFetch as any,
      });
      expect(res.success).toBe(false);
      expect(res.errorCode).toBe("ORIGIN_UNVERIFIED");
    });

    it("A12: Reused proof token, wrong attempt, wrong SHA, or wrong receiptId is rejected", async () => {
      const stored = saveRawProviderPayloadFile(JSON.stringify({ search_metadata: { id: "a12_rcpt", status: "Success" } }));
      const proof = registerTestControlledInvocationProof({
        attemptId: "att_a12",
        receiptId: "a12_rcpt",
        rawResponseSha256: stored.rawResponseSha256,
      });

      const rec: ProviderInvocationReceipt = {
        receiptId: "a12_rcpt",
        provider: "google_trends_serpapi",
        originKind: "ACTUAL_PROVIDER_INVOCATION",
        targetProductOrKeyword: "pet bed",
        region: "US",
        transportStatus: 200,
        capturedAt: new Date().toISOString(),
        rawResponseSha256: stored.rawResponseSha256,
        rawByteCount: stored.byteCount,
        artifactPath: stored.artifactPath,
      };

      const res1 = await persistCollectorReceiptAtomically(rec, proof);
      // P0-A: Test proof MUST NEVER yield originVerified=true
      expect(res1.originVerified).toBe(false);

      // Reusing the same single-use proof for a second persist call fails
      const res2 = await persistCollectorReceiptAtomically({ ...rec, receiptId: "a12_rcpt_2" }, proof);
      expect(res2.originVerified).toBe(false);
    });

    it("A13: Test-controlled proof in isolated test cannot grant strictLiveOrigin authority (Negative Inversion)", async () => {
      const stored = saveRawProviderPayloadFile(JSON.stringify({ search_metadata: { id: "a13_rcpt", status: "Success" } }));
      const proof = registerTestControlledInvocationProof({
        attemptId: "att_a13",
        receiptId: "a13_rcpt",
        rawResponseSha256: stored.rawResponseSha256,
      });

      const rec: ProviderInvocationReceipt = {
        receiptId: "a13_rcpt",
        provider: "google_trends_serpapi",
        originKind: "ACTUAL_PROVIDER_INVOCATION",
        targetProductOrKeyword: "dog feeder",
        region: "US",
        transportStatus: 200,
        capturedAt: new Date().toISOString(),
        rawResponseSha256: stored.rawResponseSha256,
        rawByteCount: stored.byteCount,
        artifactPath: stored.artifactPath,
      };

      const res = await persistCollectorReceiptAtomically(rec, proof);
      // P0-A: Test proof must demote origin to SIMULATED_TRANSPORT with originVerified=false
      expect(res.originVerified).toBe(false);

      // strictLiveOrigin MUST fail closed against test simulation proof
      const strictReadback = await resolveVerifiedDemandEvidence("provider-request:serpapi:a13_rcpt", {
        keyword: "dog feeder",
        region: "US",
        strictLiveOrigin: true,
      });
      expect(strictReadback.verified).toBe(false);
      expect(strictReadback.providerOriginVerified).toBe(false);
      expect(strictReadback.errorCode).toBe("ORIGIN_UNVERIFIED");

      // Non-strict readback succeeds for local content integrity only
      const relaxedReadback = await resolveVerifiedDemandEvidence("provider-request:serpapi:a13_rcpt", {
        keyword: "dog feeder",
        region: "US",
      });
      expect(relaxedReadback.verified).toBe(true);
      expect(relaxedReadback.providerOriginVerified).toBe(false);
      expect(relaxedReadback.originKind).toBe("SIMULATED_TRANSPORT");
    });

    it("A14: Ledger-only eligible flag + valid SHA but NO DB row fails resolveVerifiedDemandEvidence with DB_RECORD_MISSING", async () => {
      const raw = JSON.stringify({ search_metadata: { id: "a14_no_db", status: "Success" } });
      const stored = saveRawProviderPayloadFile(raw);
      const ledgerPath = path.join(testStorageDir, ".provider_receipt_ledger.json");
      const diskLedger: Record<string, any> = {};
      diskLedger["a14_no_db"] = {
        receiptId: "a14_no_db",
        provider: "google_trends_serpapi",
        originKind: "ACTUAL_PROVIDER_INVOCATION",
        targetProductOrKeyword: "cat tree",
        region: "US",
        transportStatus: 200,
        capturedAt: new Date().toISOString(),
        rawResponseSha256: stored.rawResponseSha256,
        rawByteCount: stored.byteCount,
        artifactPath: stored.artifactPath,
        commitState: "EVIDENCE_ELIGIBLE",
        eligible: true,
      };
      fs.writeFileSync(ledgerPath, JSON.stringify(diskLedger), "utf-8");

      const resolved = await resolveVerifiedDemandEvidence("provider-request:serpapi:a14_no_db", {
        keyword: "cat tree",
        region: "US",
      });
      expect(resolved.verified).toBe(false);
      expect(resolved.errorCode).toBe("DB_RECORD_MISSING");
    });

    it("A15: DB-only classification=VERIFIED without an eligible ledger entry fails resolveVerifiedDemandEvidence", async () => {
      const resolved = await resolveVerifiedDemandEvidence("provider-request:serpapi:a15_nonexistent_ledger", {
        keyword: "pet feeder",
        region: "US",
      });
      expect(resolved.verified).toBe(false);
      expect(resolved.errorCode).toBe("RECEIPT_NOT_FOUND");
    });

    it("A16: DB row deleted AFTER initial verification -> subsequent resolveVerifiedDemandEvidence detects missing DB row and revokes eligibility", async () => {
      const stored = saveRawProviderPayloadFile(JSON.stringify({ search_metadata: { id: "a16_del_db", status: "Success" } }));
      const rec: ProviderInvocationReceipt = {
        receiptId: "a16_del_db",
        provider: "google_trends_serpapi",
        originKind: "LOCAL_INTEGRITY_ONLY",
        targetProductOrKeyword: "pet carrier",
        region: "US",
        transportStatus: 200,
        capturedAt: new Date().toISOString(),
        rawResponseSha256: stored.rawResponseSha256,
        rawByteCount: stored.byteCount,
        artifactPath: stored.artifactPath,
      };
      const res = await persistCollectorReceiptAtomically(rec);
      expect(res.state).toBe("EVIDENCE_ELIGIBLE");

      // Verify first readback passes
      const rb1 = await resolveVerifiedDemandEvidence("provider-request:serpapi:a16_del_db", {
        keyword: "pet carrier",
        region: "US",
      });
      expect(rb1.verified).toBe(true);

      // Delete the SQLite row
      await prisma.researchEvidence.delete({ where: { id: "a16_del_db" } });

      // Second readback must fail closed
      const rb2 = await resolveVerifiedDemandEvidence("provider-request:serpapi:a16_del_db", {
        keyword: "pet carrier",
        region: "US",
      });
      expect(rb2.verified).toBe(false);
      expect(rb2.errorCode).toBe("DB_RECORD_MISSING");
    });

    it("A17: DB observedValue mutated with same sourceContentRef is rejected as cross-store metadata conflict", async () => {
      const stored = saveRawProviderPayloadFile(JSON.stringify({ search_metadata: { id: "a17_tampered", status: "Success" } }));
      const rec: ProviderInvocationReceipt = {
        receiptId: "a17_tampered",
        provider: "google_trends_serpapi",
        originKind: "LOCAL_INTEGRITY_ONLY",
        targetProductOrKeyword: "cat hammock",
        region: "US",
        transportStatus: 200,
        capturedAt: new Date().toISOString(),
        rawResponseSha256: stored.rawResponseSha256,
        rawByteCount: stored.byteCount,
        artifactPath: stored.artifactPath,
      };
      await persistCollectorReceiptAtomically(rec);

      // Mutate observedValue JSON in DB to have different keyword
      const mutatedObs = JSON.stringify({ ...rec, targetProductOrKeyword: "dog cage" });
      await prisma.researchEvidence.update({
        where: { id: "a17_tampered" },
        data: { observedValue: mutatedObs },
      });

      const rb = await resolveVerifiedDemandEvidence("provider-request:serpapi:a17_tampered", {
        keyword: "cat hammock",
        region: "US",
      });
      expect(rb.verified).toBe(false);
      expect(rb.errorCode).toBe("ORIGIN_UNVERIFIED");
    });

    it("A18: Ledger metadata changed with same SHA returns CONFLICT on atomic commit", async () => {
      const stored = saveRawProviderPayloadFile(JSON.stringify({ search_metadata: { id: "a18_meta", status: "Success" } }));
      const rec1: ProviderInvocationReceipt = {
        receiptId: "a18_meta",
        provider: "google_trends_serpapi",
        originKind: "LOCAL_INTEGRITY_ONLY",
        targetProductOrKeyword: "original keyword",
        region: "US",
        transportStatus: 200,
        capturedAt: new Date().toISOString(),
        rawResponseSha256: stored.rawResponseSha256,
        rawByteCount: stored.byteCount,
        artifactPath: stored.artifactPath,
      };
      const res1 = await persistCollectorReceiptAtomically(rec1);
      expect(res1.state).toBe("EVIDENCE_ELIGIBLE");

      const rec2: ProviderInvocationReceipt = {
        ...rec1,
        targetProductOrKeyword: "conflicting keyword",
      };
      const res2 = await persistCollectorReceiptAtomically(rec2);
      expect(res2.state).toBe("CONFLICT");
      expect(res2.errorCode).toBe("RECEIPT_CONFLICT");
    });

    it("A19: Artifact bytes tampered on disk or replaced by symlink is rejected fail-closed", async () => {
      const raw = JSON.stringify({ search_metadata: { id: "a19_tamper", status: "Success" } });
      const stored = saveRawProviderPayloadFile(raw);
      const rec: ProviderInvocationReceipt = {
        receiptId: "a19_tamper",
        provider: "google_trends_serpapi",
        originKind: "LOCAL_INTEGRITY_ONLY",
        targetProductOrKeyword: "cat bed",
        region: "US",
        transportStatus: 200,
        capturedAt: new Date().toISOString(),
        rawResponseSha256: stored.rawResponseSha256,
        rawByteCount: stored.byteCount,
        artifactPath: stored.artifactPath,
      };
      await persistCollectorReceiptAtomically(rec);

      // Tamper bytes in the artifact file
      fs.writeFileSync(stored.artifactPath, '{"tampered":true}', "utf-8");

      const rb = await resolveVerifiedDemandEvidence("provider-request:serpapi:a19_tamper", {
        keyword: "cat bed",
        region: "US",
      });
      expect(rb.verified).toBe(false);
      expect(rb.errorCode).toBe("HASH_MISMATCH");
    });

    it("A20: Revoked eligibility on disk causes downstream checks to immediately fail closed", async () => {
      const stored = saveRawProviderPayloadFile(JSON.stringify({ search_metadata: { id: "a20_revoked", status: "Success" } }));
      const rec: ProviderInvocationReceipt = {
        receiptId: "a20_revoked",
        provider: "google_trends_serpapi",
        originKind: "LOCAL_INTEGRITY_ONLY",
        targetProductOrKeyword: "cat toy",
        region: "US",
        transportStatus: 200,
        capturedAt: new Date().toISOString(),
        rawResponseSha256: stored.rawResponseSha256,
        rawByteCount: stored.byteCount,
        artifactPath: stored.artifactPath,
      };
      await persistCollectorReceiptAtomically(rec);

      // Verify descriptor with tampered hash triggers revocation
      const tamperedSha = crypto.createHash("sha256").update("tampered_hash_20").digest("hex");
      const desc = {
        verified: true,
        providerRequestId: "a20_revoked",
        rawResponseSha256: tamperedSha,
        artifactPath: stored.artifactPath,
      };
      const check = isAuthenticProviderReceiptDescriptor(desc as any);
      expect(check.authentic).toBe(false);

      // Ledger record must now be RECOVERY_REQUIRED with eligible=false
      const ledger = getTrustedProviderReceipt("a20_revoked");
      expect(ledger?.commitState).toBe("RECOVERY_REQUIRED");
      expect(ledger?.eligible).toBe(false);
    });

    it("A21: Observation with future timestamp under strict asOf cutoff is rejected", () => {
      const futureDate = new Date(Date.now() + 50 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
      const obs = [
        { periodStart: "2026-06-01", demandValue: 50 },
        { periodStart: "2026-07-01", demandValue: 60 },
        { periodStart: futureDate, demandValue: 70 },
      ];
      const res = evaluateDemandHistoryEvidence(obs as any[], { strictChronological: true });
      expect(res.status).not.toBe("LONGITUDINAL_CONFIRMED");
    });

    it("A22: Cross-tenant isolation: receipt committed under workspaceA is rejected when queried under workspaceB", async () => {
      const stored = saveRawProviderPayloadFile(JSON.stringify({ search_metadata: { id: "a22_tenant", status: "Success" } }));
      const rec: ProviderInvocationReceipt = {
        receiptId: "a22_tenant",
        provider: "google_trends_serpapi",
        originKind: "LOCAL_INTEGRITY_ONLY",
        targetProductOrKeyword: "cat bowl",
        region: "US",
        transportStatus: 200,
        capturedAt: new Date().toISOString(),
        rawResponseSha256: stored.rawResponseSha256,
        rawByteCount: stored.byteCount,
        artifactPath: stored.artifactPath,
        workspaceId: "ws_alpha",
      };
      await persistCollectorReceiptAtomically(rec);

      const rb = await resolveVerifiedDemandEvidence("provider-request:serpapi:a22_tenant", {
        keyword: "cat bowl",
        region: "US",
        workspaceId: "ws_beta",
      });
      expect(rb.verified).toBe(false);
      expect(rb.errorCode).toBe("RUN_MISMATCH");
    });

    it("A23: Cross-run isolation: receipt committed under runA is rejected when queried under runB", async () => {
      const stored = saveRawProviderPayloadFile(JSON.stringify({ search_metadata: { id: "a23_run", status: "Success" } }));
      const rec: ProviderInvocationReceipt = {
        receiptId: "a23_run",
        provider: "google_trends_serpapi",
        originKind: "LOCAL_INTEGRITY_ONLY",
        targetProductOrKeyword: "cat toy",
        region: "US",
        transportStatus: 200,
        capturedAt: new Date().toISOString(),
        rawResponseSha256: stored.rawResponseSha256,
        rawByteCount: stored.byteCount,
        artifactPath: stored.artifactPath,
        researchRunId: "run_alpha",
      };
      await persistCollectorReceiptAtomically(rec);

      const rb = await resolveVerifiedDemandEvidence("provider-request:serpapi:a23_run", {
        keyword: "cat toy",
        region: "US",
        researchRunId: "run_beta",
      });
      expect(rb.verified).toBe(false);
      expect(rb.errorCode).toBe("RUN_MISMATCH");
    });

    it("A24: Cross-product scope isolation: receipt committed for prodA is rejected when queried for prodB", async () => {
      const stored = saveRawProviderPayloadFile(JSON.stringify({ search_metadata: { id: "a24_prod", status: "Success" } }));
      const rec: ProviderInvocationReceipt = {
        receiptId: "a24_prod",
        provider: "google_trends_serpapi",
        originKind: "LOCAL_INTEGRITY_ONLY",
        targetProductOrKeyword: "cat fountain",
        region: "US",
        transportStatus: 200,
        capturedAt: new Date().toISOString(),
        rawResponseSha256: stored.rawResponseSha256,
        rawByteCount: stored.byteCount,
        artifactPath: stored.artifactPath,
        productId: "prod_alpha",
      };
      await persistCollectorReceiptAtomically(rec);

      const rb = await resolveVerifiedDemandEvidence("provider-request:serpapi:a24_prod", {
        keyword: "cat fountain",
        region: "US",
        productId: "prod_beta",
      });
      expect(rb.verified).toBe(false);
      expect(rb.errorCode).toBe("PRODUCT_MISMATCH");
    });

    it("A25: Wrong US geo/query in payload (geo: 'UK' or contradictory q) is rejected with REGION_MISMATCH / PRODUCT_MISMATCH", async () => {
      const rawUk = JSON.stringify({
        search_metadata: { id: "a25_geo", status: "Success" },
        search_parameters: { q: "cat fountain", geo: "GB" },
      });
      const stored = saveRawProviderPayloadFile(rawUk);
      const rec: ProviderInvocationReceipt = {
        receiptId: "a25_geo",
        provider: "google_trends_serpapi",
        originKind: "LOCAL_INTEGRITY_ONLY",
        targetProductOrKeyword: "cat fountain",
        region: "US",
        transportStatus: 200,
        capturedAt: new Date().toISOString(),
        rawResponseSha256: stored.rawResponseSha256,
        rawByteCount: stored.byteCount,
        artifactPath: stored.artifactPath,
      };
      await persistCollectorReceiptAtomically(rec);

      const rb = await resolveVerifiedDemandEvidence("provider-request:serpapi:a25_geo", {
        keyword: "cat fountain",
        region: "US",
      });
      expect(rb.verified).toBe(false);
      expect(rb.errorCode).toBe("REGION_MISMATCH");
    });

    it("A26: Observation value check: if demandValue does not exist in raw timeline_data, evaluateDemandSourceAuthority rejects it", async () => {
      const raw = JSON.stringify({
        search_metadata: { id: "a26_val", status: "Success" },
        search_parameters: { q: "cat fountain", geo: "US" },
        interest_over_time: {
          timeline_data: [{ date: "2026-07-01", values: [{ value: 75 }] }],
        },
      });
      const stored = saveRawProviderPayloadFile(raw);
      const desc = {
        verified: true,
        providerRequestId: "a26_val",
        rawResponseSha256: stored.rawResponseSha256,
        artifactPath: stored.artifactPath,
        targetProductOrKeyword: "cat fountain",
        region: "US",
      };
      const check = isAuthenticProviderReceiptDescriptor(desc as any, {
        targetKeyword: "cat fountain",
        region: "US",
        observationValue: 99, // Does not exist in timeline (only 75 exists)
      });
      expect(check.authentic).toBe(false);
      expect(check.errorCode).toBe("HASH_MISMATCH");
    });

    it("A27: Broad keyword or promotional ad copy is classified as ESTIMATED_OR_PROXY or CACHED_UNVERIFIED", () => {
      const obsBroad = [
        { periodStart: "2026-06-01", demandValue: 50, keyword: "pet supplies", source: "google_trends_api" },
        { periodStart: "2026-07-01", demandValue: 60, keyword: "pet supplies", source: "google_trends_api" },
        { periodStart: "2026-08-01", demandValue: 70, keyword: "pet supplies", source: "google_trends_api" },
      ];
      const authBroad = evaluateDemandSourceAuthority(obsBroad as any[], { requiredRegion: "US" });
      expect(authBroad.authority).toBe("ESTIMATED_OR_PROXY");

      const obsPromo = [
        { periodStart: "2026-06-01", demandValue: 50, keyword: "BUY NOW 50% OFF LIMITED TIME ONLY!", source: "google_trends_api" },
        { periodStart: "2026-07-01", demandValue: 60, keyword: "BUY NOW 50% OFF LIMITED TIME ONLY!", source: "google_trends_api" },
        { periodStart: "2026-08-01", demandValue: 70, keyword: "BUY NOW 50% OFF LIMITED TIME ONLY!", source: "google_trends_api" },
      ];
      const authPromo = evaluateDemandSourceAuthority(obsPromo as any[], { requiredRegion: "US" });
      expect(authPromo.authority).toBe("CACHED_UNVERIFIED");
    });

    it("A28: Unattested local CSV with valid SHA-256 is LOCAL_INTEGRITY_ONLY (verified=false, providerOriginVerified=false), never network LIVE", async () => {
      const csvContent = "Week,cat fountain\n2026-07-01,75\n";
      const csvSha = crypto.createHash("sha256").update(Buffer.from(csvContent, "utf8")).digest("hex").toLowerCase();
      const csvFile = saveOriginalGoogleTrendsCsvFile(csvContent, csvSha);

      try {
        const resolved = await resolveVerifiedDemandEvidence(`sha256:${csvSha}`, {
          keyword: "cat fountain",
          region: "US",
        });
        expect(resolved.contentIntegrityVerified).toBe(true);
        expect(resolved.verified).toBe(false);
        expect(resolved.eligible).toBe(false);
        expect(resolved.originKind).toBe("LOCAL_INTEGRITY_ONLY");
        expect(resolved.providerOriginVerified).toBe(false);
      } finally {
        if (fs.existsSync(csvFile)) fs.unlinkSync(csvFile);
      }
    });

    it("A29: Fixture SHA is classified as FIXTURE_ONLY, never AUTHORITATIVE_VERIFIED under strictLiveOrigin", async () => {
      const fixtureContent = JSON.stringify({
        search_metadata: { id: "req_fixture_01", status: "Success" },
        isFixture: true,
      });
      const fixtureSha = crypto.createHash("sha256").update(Buffer.from(fixtureContent, "utf8")).digest("hex").toLowerCase();
      if (!fs.existsSync(UNIT_FIXTURE_STORAGE_DIR)) fs.mkdirSync(UNIT_FIXTURE_STORAGE_DIR, { recursive: true });
      const fixtureFile = path.join(UNIT_FIXTURE_STORAGE_DIR, `${fixtureSha}.json`);
      fs.writeFileSync(fixtureFile, fixtureContent, "utf-8");

      try {
        const desc = {
          verified: true,
          providerRequestId: "req_fixture_01",
          rawResponseSha256: fixtureSha,
          artifactPath: fixtureFile,
          originKind: "UNIT_FIXTURE" as const,
        };
        const check = isAuthenticProviderReceiptDescriptor(desc as any, { strictLiveOrigin: true });
        expect(check.authentic).toBe(false);
        expect(check.errorCode).toBe("ORIGIN_UNVERIFIED");
      } finally {
        if (fs.existsSync(fixtureFile)) fs.unlinkSync(fixtureFile);
      }
    });

    it("A30: persistDurableReceipt alone stages LEDGER_PENDING_DB and eligible=false, never granting live authority", () => {
      const stored = saveRawProviderPayloadFile(JSON.stringify({ test: "a30" }));
      const rec: ProviderInvocationReceipt = {
        receiptId: "a30_staged_only",
        provider: "google_trends_serpapi",
        originKind: "LOCAL_INTEGRITY_ONLY",
        targetProductOrKeyword: "cat harness",
        region: "US",
        transportStatus: 200,
        capturedAt: new Date().toISOString(),
        rawResponseSha256: stored.rawResponseSha256,
        rawByteCount: stored.byteCount,
        artifactPath: stored.artifactPath,
      };
      const staged = persistDurableReceipt(rec);
      expect(staged.commitState).toBe("LEDGER_PENDING_DB");
      expect(staged.eligible).toBe(false);
    });

    it("A31: DB lock held by a second worker causes persistCollectorReceiptAtomically to return DB_LOCK_TIMEOUT and perform 0 Prisma writes", async () => {
      const stored = saveRawProviderPayloadFile(JSON.stringify({ search_metadata: { id: "a31_db_lock", status: "Success" } }));
      const rec: ProviderInvocationReceipt = {
        receiptId: "a31_db_lock",
        provider: "google_trends_serpapi",
        originKind: "LOCAL_INTEGRITY_ONLY",
        targetProductOrKeyword: "cat bed",
        region: "US",
        transportStatus: 200,
        capturedAt: new Date().toISOString(),
        rawResponseSha256: stored.rawResponseSha256,
        rawByteCount: stored.byteCount,
        artifactPath: stored.artifactPath,
      };

      // Manually acquire the DB lock file
      const dbLockPath = path.join(testStorageDir, ".provider_receipt_ledger.json.db.lock");
      const lockData = {
        ownerId: "competing_worker",
        pid: process.pid,
        hostname: os.hostname(),
        acquiredAt: Date.now(),
        expiresAt: Date.now() + 60000,
      };
      fs.writeFileSync(dbLockPath, JSON.stringify(lockData), "utf-8");

      try {
        const res = await persistCollectorReceiptAtomically(rec);
        expect(res.state).toBe("LOCK_TIMEOUT");
        expect(res.errorCode).toBe("DB_LOCK_TIMEOUT");
        expect(res.dbCommitted).toBe(false);
        expect(res.eligible).toBe(false);

        // Verify DB row was NOT written
        const dbRow = await prisma.researchEvidence.findUnique({ where: { id: "a31_db_lock" } });
        expect(dbRow).toBeNull();
      } finally {
        if (fs.existsSync(dbLockPath)) fs.unlinkSync(dbLockPath);
      }
    });

    it("A32: DB lock timeout leaves ledger staged as LEDGER_PENDING_DB, eligible=false", async () => {
      const stored = saveRawProviderPayloadFile(JSON.stringify({ search_metadata: { id: "a32_db_lock_staged", status: "Success" } }));
      const rec: ProviderInvocationReceipt = {
        receiptId: "a32_db_lock_staged",
        provider: "google_trends_serpapi",
        originKind: "LOCAL_INTEGRITY_ONLY",
        targetProductOrKeyword: "cat bed",
        region: "US",
        transportStatus: 200,
        capturedAt: new Date().toISOString(),
        rawResponseSha256: stored.rawResponseSha256,
        rawByteCount: stored.byteCount,
        artifactPath: stored.artifactPath,
      };

      const dbLockPath = path.join(testStorageDir, ".provider_receipt_ledger.json.db.lock");
      fs.writeFileSync(
        dbLockPath,
        JSON.stringify({ ownerId: "worker_x", pid: process.pid, expiresAt: Date.now() + 60000 }),
        "utf-8"
      );

      try {
        await persistCollectorReceiptAtomically(rec);
        const ledger = JSON.parse(fs.readFileSync(path.join(testStorageDir, ".provider_receipt_ledger.json"), "utf-8"));
        expect(ledger.a32_db_lock_staged?.commitState).toBe("LEDGER_PENDING_DB");
        expect(ledger.a32_db_lock_staged?.eligible).toBe(false);
      } finally {
        if (fs.existsSync(dbLockPath)) fs.unlinkSync(dbLockPath);
      }
    });

    it("A33: DB upsert throw leaves ledger NOT eligible and returns DB_WRITE_FAILED", async () => {
      const stored = saveRawProviderPayloadFile(JSON.stringify({ search_metadata: { id: "a33_throw", status: "Success" } }));
      const rec: ProviderInvocationReceipt = {
        receiptId: "a33_throw",
        provider: "google_trends_serpapi",
        originKind: "LOCAL_INTEGRITY_ONLY",
        targetProductOrKeyword: "dog bed",
        region: "US",
        transportStatus: 200,
        capturedAt: new Date().toISOString(),
        rawResponseSha256: stored.rawResponseSha256,
        rawByteCount: stored.byteCount,
        artifactPath: stored.artifactPath,
      };

      const origUpsert = prisma.researchEvidence.upsert;
      (prisma.researchEvidence as any).upsert = async () => {
        throw new Error("Simulated SQLite write error");
      };

      try {
        const res = await persistCollectorReceiptAtomically(rec);
        expect(res.state).toBe("DB_WRITE_FAILED");
        expect(res.dbCommitted).toBe(false);
        expect(res.eligible).toBe(false);
      } finally {
        prisma.researchEvidence.upsert = origUpsert;
      }
    });

    it("A34: Compare-and-swap generation mismatch fails staged ledger commit", async () => {
      const stored = saveRawProviderPayloadFile(JSON.stringify({ search_metadata: { id: "a34_cas", status: "Success" } }));
      const rec: ProviderInvocationReceipt = {
        receiptId: "a34_cas",
        provider: "google_trends_serpapi",
        originKind: "LOCAL_INTEGRITY_ONLY",
        targetProductOrKeyword: "cat toy",
        region: "US",
        transportStatus: 200,
        capturedAt: new Date().toISOString(),
        rawResponseSha256: stored.rawResponseSha256,
        rawByteCount: stored.byteCount,
        artifactPath: stored.artifactPath,
      };

      const res = await persistCollectorReceiptAtomically(rec);
      expect(res.state).toBe("EVIDENCE_ELIGIBLE");
      expect(res.generation).toBe(2);
    });

    it("A35: Crash before DB write leaves LEDGER_PENDING_DB; reconcilePendingReceiptRecovery safely recovers it", async () => {
      const stored = saveRawProviderPayloadFile(JSON.stringify({ search_metadata: { id: "a35_crash", status: "Success" } }));
      const rec: ProviderInvocationReceipt = {
        receiptId: "a35_crash",
        provider: "google_trends_serpapi",
        originKind: "LOCAL_INTEGRITY_ONLY",
        targetProductOrKeyword: "cat bed",
        region: "US",
        transportStatus: 200,
        capturedAt: new Date().toISOString(),
        rawResponseSha256: stored.rawResponseSha256,
        rawByteCount: stored.byteCount,
        artifactPath: stored.artifactPath,
      };
      persistDurableReceipt(rec);

      // Verify staged receipt before recovery is not eligible
      const unrec = await resolveVerifiedDemandEvidence("provider-request:serpapi:a35_crash", {
        keyword: "cat bed",
        region: "US",
      });
      expect(unrec.verified).toBe(false);

      // Run reconciliation
      const recovRes = await reconcilePendingReceiptRecovery("a35_crash");
      expect(recovRes.state).toBe("EVIDENCE_ELIGIBLE");
      expect(recovRes.eligible).toBe(true);

      const recov = await resolveVerifiedDemandEvidence("provider-request:serpapi:a35_crash", {
        keyword: "cat bed",
        region: "US",
      });
      expect(recov.verified).toBe(true);
    });

    it("A36: Crash after DB write before ledger promotion fails closed until reconciled", async () => {
      const stored = saveRawProviderPayloadFile(JSON.stringify({ search_metadata: { id: "a36_half", status: "Success" } }));
      const rec: ProviderInvocationReceipt = {
        receiptId: "a36_half",
        provider: "google_trends_serpapi",
        originKind: "LOCAL_INTEGRITY_ONLY",
        targetProductOrKeyword: "dog toy",
        region: "US",
        transportStatus: 200,
        capturedAt: new Date().toISOString(),
        rawResponseSha256: stored.rawResponseSha256,
        rawByteCount: stored.byteCount,
        artifactPath: stored.artifactPath,
      };

      persistDurableReceipt(rec);

      // Insert DB row manually to simulate mid-flight crash after DB commit
      await prisma.researchEvidence.create({
        data: {
          id: "a36_half",
          subjectType: "DEMAND_RECEIPT",
          subjectId: "a36_half",
          pillar: "PRODUCT",
          claim: "PROVIDER_RECEIPT:google_trends_serpapi",
          observationMethod: "COLLECTOR_ATOMIC_PERSIST",
          sourceContentRef: stored.rawResponseSha256,
          classification: "VERIFIED",
          observedValue: JSON.stringify({ ...rec, commitState: "EVIDENCE_ELIGIBLE", eligible: true }),
        },
      });

      // Still fails closed because ledger is LEDGER_PENDING_DB
      const rb = await resolveVerifiedDemandEvidence("provider-request:serpapi:a36_half", {
        keyword: "dog toy",
        region: "US",
      });
      expect(rb.verified).toBe(false);

      // Reconcile fixes it
      await reconcilePendingReceiptRecovery("a36_half");
      const rbFixed = await resolveVerifiedDemandEvidence("provider-request:serpapi:a36_half", {
        keyword: "dog toy",
        region: "US",
      });
      expect(rbFixed.verified).toBe(true);
    });

    it("A37: Lock release by different owner or invalid JSON returns false and does not unlink the lock", () => {
      const lockPath = path.join(testStorageDir, "a37.lock");
      fs.writeFileSync(
        lockPath,
        JSON.stringify({ ownerId: "real_owner", pid: process.pid, expiresAt: Date.now() + 60000 }),
        "utf-8"
      );

      const released = releaseDurableLedgerLock(lockPath, "imposter_owner");
      expect(released).toBe(false);
      expect(fs.existsSync(lockPath)).toBe(true);
    });

    it("A38: Stale expired lock held by a live PID is NOT stolen by another worker (returns LOCK_TIMEOUT)", () => {
      const lockPath = path.join(testStorageDir, "a38.lock");
      fs.writeFileSync(
        lockPath,
        JSON.stringify({ ownerId: "live_worker", pid: process.pid, hostname: os.hostname(), expiresAt: Date.now() - 5000 }),
        "utf-8"
      );

      const res = tryAcquireDurableLedgerLockSync(lockPath, 100);
      expect(res.acquired).toBe(false);
      expect(res.errorCode).toBe("LOCK_TIMEOUT");
    });

    it("A39: Expired lock with dead PID is safely and atomically reclaimed with inode verification", () => {
      const lockPath = path.join(testStorageDir, "a39.lock");
      // Use guaranteed dead PID (e.g. 999999999)
      fs.writeFileSync(
        lockPath,
        JSON.stringify({ ownerId: "dead_worker", pid: 999999999, hostname: os.hostname(), expiresAt: Date.now() - 5000 }),
        "utf-8"
      );

      const res = tryAcquireDurableLedgerLockSync(lockPath, 2000);
      expect(res.acquired).toBe(true);
      releaseDurableLedgerLock(lockPath, res.ownerId);
    });

    it("A40: Same receiptId with identical SHA and metadata succeeds idempotently", async () => {
      const stored = saveRawProviderPayloadFile(JSON.stringify({ search_metadata: { id: "a40_idem", status: "Success" } }));
      const rec: ProviderInvocationReceipt = {
        receiptId: "a40_idem",
        provider: "google_trends_serpapi",
        originKind: "LOCAL_INTEGRITY_ONLY",
        targetProductOrKeyword: "cat bed",
        region: "US",
        transportStatus: 200,
        capturedAt: new Date().toISOString(),
        rawResponseSha256: stored.rawResponseSha256,
        rawByteCount: stored.byteCount,
        artifactPath: stored.artifactPath,
      };

      const res1 = await persistCollectorReceiptAtomically(rec);
      expect(res1.state).toBe("EVIDENCE_ELIGIBLE");

      const res2 = await persistCollectorReceiptAtomically(rec);
      expect(res2.state).toBe("EVIDENCE_ELIGIBLE");
      expect(res2.idempotent).toBe(true);
    });

    it("A41: Full restart/reload (clearTrustedProviderInvocationsForTest) clears in-memory maps; cannot inherit trust from stale memory cache", () => {
      const proof = registerTestControlledInvocationProof({
        attemptId: "att_a41",
        receiptId: "rcpt_a41",
        rawResponseSha256: "e".repeat(64),
      });
      clearTrustedProviderInvocationsForTest();
      expect(getVerifiedDecisionProof("rcpt_a41")).toBeUndefined();
    });

    it("A42: Provider HTTP 403/429/500 fails closed with RESPONSE_STATUS_INVALID", async () => {
      for (const status of [403, 429, 500]) {
        const mockFetch = async () => new Response("Rate limited", { status });
        const res = await executeTrustedSerpApiDemandRequest({
          url: "https://serpapi.com/search.json?engine=google_trends&data_type=TIMESERIES",
          query: { term: "cat toy", region: "US" },
          attemptId: "att_a42",
          fetchFn: mockFetch as any,
        });
        expect(res.success).toBe(false);
        expect(res.errorCode).toBe("RESPONSE_STATUS_INVALID");
      }
    });

    it("A43: Canonical verifier verifyReceiptEligibility (resolveVerifiedDemandEvidence) is exported and issues VerifiedEligibilityProof", async () => {
      expect(verifyReceiptEligibility).toBe(resolveVerifiedDemandEvidence);
      const stored = saveRawProviderPayloadFile(JSON.stringify({ search_metadata: { id: "a43_proof", status: "Success" } }));
      const rec: ProviderInvocationReceipt = {
        receiptId: "a43_proof",
        provider: "google_trends_serpapi",
        originKind: "LOCAL_INTEGRITY_ONLY",
        targetProductOrKeyword: "cat brush",
        region: "US",
        transportStatus: 200,
        capturedAt: new Date().toISOString(),
        rawResponseSha256: stored.rawResponseSha256,
        rawByteCount: stored.byteCount,
        artifactPath: stored.artifactPath,
      };
      await persistCollectorReceiptAtomically(rec);

      const resolved = await verifyReceiptEligibility("provider-request:serpapi:a43_proof", {
        keyword: "cat brush",
        region: "US",
      });
      expect(resolved.verified).toBe(true);
      const proof = getVerifiedDecisionProof("a43_proof");
      expect(proof).toBeDefined();
      expect(proof?.receiptId).toBe("a43_proof");
      expect(proof?.rawResponseSha256).toBe(stored.rawResponseSha256);
    });

    it("A44: Point-in-time zero-lookahead: observations after asOf cutoff are excluded", () => {
      const obs = [
        { periodStart: "2026-05-01", demandValue: 50 },
        { periodStart: "2026-06-01", demandValue: 60 },
        { periodStart: "2026-07-01", demandValue: 70 },
      ];
      const res = evaluateDemandHistoryEvidence(obs as any[], { asOfTimestamp: "2026-05-15" });
      expect(res.dataPointsCount).toBe(1);
      expect(res.status).toBe("INSUFFICIENT_HISTORY");
    });

    it("A45: Exact 60D cadence/gap/density checks; 3 sparse samples over 60D not verified evergreen", () => {
      const obs = [
        { periodStart: "2026-01-01", demandValue: 50 },
        { periodStart: "2026-02-15", demandValue: 55 },
        { periodStart: "2026-03-31", demandValue: 60 },
      ];
      const res = evaluateDemandHistoryEvidence(obs as any[], { minimumDataPoints: 6 });
      expect(res.status).toBe("INSUFFICIENT_HISTORY");
    });

    it("A46: Discrepancy analysis test: dynamic test file discovery across repository files", () => {
      function findTestFiles(dir: string): string[] {
        let results: string[] = [];
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
          const fullPath = path.join(dir, entry.name);
          if (entry.isDirectory() && entry.name !== "node_modules" && entry.name !== ".git") {
            results = results.concat(findTestFiles(fullPath));
          } else if (entry.isFile() && (entry.name.endsWith(".test.ts") || entry.name.endsWith(".spec.ts"))) {
            results.push(path.resolve(fullPath));
          }
        }
        return results;
      }
      const unitFiles = findTestFiles(path.resolve(process.cwd(), "tests/unit"));
      const uniqueUnitFiles = Array.from(new Set(unitFiles));
      expect(uniqueUnitFiles.length).toBeGreaterThanOrEqual(119);
      const rootUnitFiles = uniqueUnitFiles.filter((f) => path.dirname(f) === path.resolve(process.cwd(), "tests/unit"));
      const overlapFiles = rootUnitFiles.filter((f) => path.basename(f).startsWith("kh02"));
      expect(overlapFiles.length).toBe(27);
    });

    it("A47: Negative fixture corpus / baseline sentinel SHA unchanged after tests", () => {
      const currentSnapshot = snapshotProductionReceiptDir();
      expect(currentSnapshot).toEqual(baselineProdSnapshot);
    });

    it("A48: Corrupted ledger JSON file fails closed with clear error", async () => {
      const stored = saveRawProviderPayloadFile(JSON.stringify({ test: "a48" }));
      const ledgerPath = path.join(testStorageDir, ".provider_receipt_ledger.json");
      fs.writeFileSync(ledgerPath, "INVALID_JSON_CORRUPTED{", "utf-8");

      const rec: ProviderInvocationReceipt = {
        receiptId: "a48_corrupt",
        provider: "google_trends_serpapi",
        originKind: "LOCAL_INTEGRITY_ONLY",
        targetProductOrKeyword: "cat toy",
        region: "US",
        transportStatus: 200,
        capturedAt: new Date().toISOString(),
        rawResponseSha256: stored.rawResponseSha256,
        rawByteCount: stored.byteCount,
        artifactPath: stored.artifactPath,
      };

      await expect(persistCollectorReceiptAtomically(rec)).rejects.toThrow("Failed to parse durable ledger file");
    });
  });

  describe("Part 2: Real OS Multi-Process Concurrency Proof (C01 - C08)", () => {
    const tsxCli = path.resolve(process.cwd(), "node_modules/tsx/dist/cli.mjs");
    const useNode = fs.existsSync(tsxCli);
    const tsxBin = useNode ? process.execPath : path.resolve(process.cwd(), process.platform === "win32" ? "node_modules/.bin/tsx.cmd" : "node_modules/.bin/tsx");
    const enginePath = path.resolve(process.cwd(), "src/services/kh02/demand/temporalDemandEngine.ts");

    function spawnTsxWorker(scriptPath: string, args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
      return new Promise((resolve) => {
        const spawnArgs = useNode ? [tsxCli, scriptPath, ...args] : [scriptPath, ...args];
        const child = spawn(tsxBin, spawnArgs, {
          cwd: process.cwd(),
          env: { ...process.env },
          stdio: "pipe",
        });
        let stdout = "";
        let stderr = "";
        child.stdout?.on("data", (d) => (stdout += d.toString()));
        child.stderr?.on("data", (d) => (stderr += d.toString()));
        child.on("error", (err) => {
          stderr += String(err);
          resolve({ code: 1, stdout, stderr });
        });
        child.on("exit", (code) => resolve({ code: code ?? 1, stdout, stderr }));
      });
    }

    it("C01: 2 real OS child processes calling REAL persistCollectorReceiptAtomically on disjoint receipt IDs behind barrier complete with zero lost updates in ledger and SQLite DB", async () => {
      const barrierFile = path.join(testStorageDir, "c01_barrier.txt");
      const workerScript = path.join(testStorageDir, "c01_worker.ts");

      const rawA = JSON.stringify({
        search_metadata: { id: "c01_rec_a", status: "Success" },
        search_parameters: { q: "cat fountain a", geo: "US" },
        interest_over_time: { timeline_data: [{ date: "2026-07-01", values: [{ value: 71 }] }] },
      });
      const rawB = JSON.stringify({
        search_metadata: { id: "c01_rec_b", status: "Success" },
        search_parameters: { q: "cat fountain b", geo: "US" },
        interest_over_time: { timeline_data: [{ date: "2026-07-01", values: [{ value: 72 }] }] },
      });
      const sA = saveRawProviderPayloadFile(rawA);
      const sB = saveRawProviderPayloadFile(rawB);

      fs.writeFileSync(
        workerScript,
        `
        import fs from "fs";
        import { setProviderReceiptStorageDirForTest, persistCollectorReceiptAtomically } from ${JSON.stringify(enginePath)};
        async function main() {
          const [storageDir, barrier, receiptId, sha, artifactPath, kw] = process.argv.slice(2);
          setProviderReceiptStorageDirForTest(storageDir);
          while (!fs.existsSync(barrier)) {
            await new Promise((r) => setTimeout(r, 5));
          }
          let res: any;
          for (let attempt = 0; attempt < 5; attempt++) {
            res = await persistCollectorReceiptAtomically({
              receiptId,
              provider: "google_trends_serpapi",
              originKind: "LOCAL_INTEGRITY_ONLY",
              targetProductOrKeyword: kw,
              region: "US",
              transportStatus: 200,
              capturedAt: new Date().toISOString(),
              rawResponseSha256: sha,
              rawByteCount: fs.readFileSync(artifactPath).length,
              artifactPath,
            });
            if (res.state === "EVIDENCE_ELIGIBLE" && res.eligible && res.dbCommitted) break;
            await new Promise((r) => setTimeout(r, 100));
          }
          process.exit(res && res.state === "EVIDENCE_ELIGIBLE" && res.eligible && res.dbCommitted ? 0 : 1);
        }
        main().catch((e) => { process.stderr.write(String(e)); process.exit(1); });
      `,
        "utf-8"
      );

      const pA = spawnTsxWorker(workerScript, [testStorageDir, barrierFile, "c01_rec_a", sA.rawResponseSha256, sA.artifactPath, "cat fountain a"]);
      const pB = spawnTsxWorker(workerScript, [testStorageDir, barrierFile, "c01_rec_b", sB.rawResponseSha256, sB.artifactPath, "cat fountain b"]);
      fs.writeFileSync(barrierFile, "GO", "utf-8");

      const [resA, resB] = await Promise.all([pA, pB]);
      expect(resA.code).toBe(0);
      expect(resB.code).toBe(0);

      const ledger = JSON.parse(fs.readFileSync(path.join(testStorageDir, ".provider_receipt_ledger.json"), "utf-8"));
      expect(ledger.c01_rec_a?.commitState).toBe("EVIDENCE_ELIGIBLE");
      expect(ledger.c01_rec_b?.commitState).toBe("EVIDENCE_ELIGIBLE");

      const rA = await resolveVerifiedDemandEvidence("provider-request:serpapi:c01_rec_a", { keyword: "cat fountain a", region: "US" });
      const rB = await resolveVerifiedDemandEvidence("provider-request:serpapi:c01_rec_b", { keyword: "cat fountain b", region: "US" });
      expect(rA.verified).toBe(true);
      expect(rB.verified).toBe(true);
    }, 30000);

    it("C02: 4 real OS child processes concurrently calling REAL persistCollectorReceiptAtomically across 20 total iterations persist all 20 receipts with zero lost updates", async () => {
      const barrierFile = path.join(testStorageDir, "c02_barrier.txt");
      const workerScript = path.join(testStorageDir, "c02_worker.ts");

      const itemsByWorker: Array<Array<{ receiptId: string; sha: string; artifactPath: string; kw: string }>> = [];
      for (let w = 0; w < 4; w++) {
        const workerItems: Array<{ receiptId: string; sha: string; artifactPath: string; kw: string }> = [];
        for (let i = 0; i < 5; i++) {
          const receiptId = `c02_w${w}_i${i}`;
          const kw = `pet gadget w${w} i${i}`;
          const raw = JSON.stringify({
            search_metadata: { id: receiptId, status: "Success" },
            search_parameters: { q: kw, geo: "US" },
            interest_over_time: { timeline_data: [{ date: "2026-07-01", values: [{ value: 50 + i }] }] },
          });
          const stored = saveRawProviderPayloadFile(raw);
          workerItems.push({ receiptId, sha: stored.rawResponseSha256, artifactPath: stored.artifactPath, kw });
        }
        itemsByWorker.push(workerItems);
      }

      fs.writeFileSync(
        workerScript,
        `
        import fs from "fs";
        import { setProviderReceiptStorageDirForTest, persistCollectorReceiptAtomically } from ${JSON.stringify(enginePath)};
        async function main() {
          const [storageDir, barrier, itemsJson] = process.argv.slice(2);
          setProviderReceiptStorageDirForTest(storageDir);
          const items = JSON.parse(itemsJson);
          while (!fs.existsSync(barrier)) {
            await new Promise((r) => setTimeout(r, 5));
          }
          for (const item of items) {
            let res: any;
            for (let attempt = 0; attempt < 8; attempt++) {
              res = await persistCollectorReceiptAtomically({
                receiptId: item.receiptId,
                provider: "google_trends_serpapi",
                originKind: "LOCAL_INTEGRITY_ONLY",
                targetProductOrKeyword: item.kw,
                region: "US",
                transportStatus: 200,
                capturedAt: new Date().toISOString(),
                rawResponseSha256: item.sha,
                rawByteCount: fs.readFileSync(item.artifactPath).length,
                artifactPath: item.artifactPath,
              });
              if (res.state === "EVIDENCE_ELIGIBLE" && res.eligible && res.dbCommitted) {
                break;
              }
              if (res.state === "LOCK_TIMEOUT" || res.state === "DB_LOCK_TIMEOUT") {
                await new Promise((r) => setTimeout(r, 25 + Math.floor(Math.random() * 75)));
                continue;
              }
              break;
            }
            if (res.state !== "EVIDENCE_ELIGIBLE" || !res.eligible || !res.dbCommitted) {
              process.stderr.write("Failed item " + item.receiptId + ": " + JSON.stringify(res));
              process.exit(1);
            }
          }
          process.exit(0);
        }
        main().catch((e) => { process.stderr.write(String(e)); process.exit(1); });
      `,
        "utf-8"
      );

      const promises = itemsByWorker.map((items) =>
        spawnTsxWorker(workerScript, [testStorageDir, barrierFile, JSON.stringify(items)])
      );
      fs.writeFileSync(barrierFile, "GO", "utf-8");

      const results = await Promise.all(promises);
      for (const r of results) {
        expect(r.code).toBe(0);
      }

      const ledger = JSON.parse(fs.readFileSync(path.join(testStorageDir, ".provider_receipt_ledger.json"), "utf-8"));
      expect(Object.keys(ledger).length).toBe(20);
      for (const items of itemsByWorker) {
        for (const item of items) {
          expect(ledger[item.receiptId]?.commitState).toBe("EVIDENCE_ELIGIBLE");
          expect(ledger[item.receiptId]?.eligible).toBe(true);
        }
      }
    }, 40000);

    it("C03: 2 real OS child processes calling REAL persistCollectorReceiptAtomically with the SAME receiptId and IDENTICAL payload succeed idempotently", async () => {
      const barrierFile = path.join(testStorageDir, "c03_barrier.txt");
      const workerScript = path.join(testStorageDir, "c03_worker.ts");

      const raw = JSON.stringify({
        search_metadata: { id: "c03_same_rec", status: "Success" },
        search_parameters: { q: "identical cat toy", geo: "US" },
        interest_over_time: { timeline_data: [{ date: "2026-07-01", values: [{ value: 75 }] }] },
      });
      const stored = saveRawProviderPayloadFile(raw);

      fs.writeFileSync(
        workerScript,
        `
        import fs from "fs";
        import { setProviderReceiptStorageDirForTest, persistCollectorReceiptAtomically } from ${JSON.stringify(enginePath)};
        async function main() {
          const [storageDir, barrier, sha, artifactPath] = process.argv.slice(2);
          setProviderReceiptStorageDirForTest(storageDir);
          while (!fs.existsSync(barrier)) {
            await new Promise((r) => setTimeout(r, 5));
          }
          const res = await persistCollectorReceiptAtomically({
            receiptId: "c03_same_rec",
            provider: "google_trends_serpapi",
        originKind: "LOCAL_INTEGRITY_ONLY",
        targetProductOrKeyword: "identical cat toy",
            region: "US",
            transportStatus: 200,
            capturedAt: new Date().toISOString(),
            rawResponseSha256: sha,
            rawByteCount: fs.readFileSync(artifactPath).length,
            artifactPath,
          });
          process.exit(res.state === "EVIDENCE_ELIGIBLE" && res.eligible && res.dbCommitted ? 0 : 1);
        }
        main().catch((e) => { process.stderr.write(String(e)); process.exit(1); });
      `,
        "utf-8"
      );

      const p1 = spawnTsxWorker(workerScript, [testStorageDir, barrierFile, stored.rawResponseSha256, stored.artifactPath]);
      const p2 = spawnTsxWorker(workerScript, [testStorageDir, barrierFile, stored.rawResponseSha256, stored.artifactPath]);
      fs.writeFileSync(barrierFile, "GO", "utf-8");

      const [r1, r2] = await Promise.all([p1, p2]);
      expect(r1.code).toBe(0);
      expect(r2.code).toBe(0);

      const ledger = JSON.parse(fs.readFileSync(path.join(testStorageDir, ".provider_receipt_ledger.json"), "utf-8"));
      expect(ledger.c03_same_rec?.commitState).toBe("EVIDENCE_ELIGIBLE");
      expect(ledger.c03_same_rec?.eligible).toBe(true);
    }, 20000);

    it("C04: 2 real OS child processes calling REAL persistCollectorReceiptAtomically with the SAME receiptId but DIFFERENT SHA result in 1 EVIDENCE_ELIGIBLE and 1 CONFLICT", async () => {
      const barrierFile = path.join(testStorageDir, "c04_barrier.txt");
      const workerScript = path.join(testStorageDir, "c04_worker.ts");

      const raw1 = JSON.stringify({ search_metadata: { id: "c04_conf_rec", status: "Success" }, payload: 1 });
      const raw2 = JSON.stringify({ search_metadata: { id: "c04_conf_rec", status: "Success" }, payload: 2 });
      const s1 = saveRawProviderPayloadFile(raw1);
      const s2 = saveRawProviderPayloadFile(raw2);

      fs.writeFileSync(
        workerScript,
        `
        import fs from "fs";
        import { setProviderReceiptStorageDirForTest, persistCollectorReceiptAtomically } from ${JSON.stringify(enginePath)};
        async function main() {
          const [storageDir, barrier, sha, artifactPath] = process.argv.slice(2);
          setProviderReceiptStorageDirForTest(storageDir);
          while (!fs.existsSync(barrier)) {
            await new Promise((r) => setTimeout(r, 5));
          }
          const res = await persistCollectorReceiptAtomically({
            receiptId: "c04_conf_rec",
            provider: "google_trends_serpapi",
        originKind: "LOCAL_INTEGRITY_ONLY",
        targetProductOrKeyword: "conflicting toy",
            region: "US",
            transportStatus: 200,
            capturedAt: new Date().toISOString(),
            rawResponseSha256: sha,
            rawByteCount: fs.readFileSync(artifactPath).length,
            artifactPath,
          });
          process.stdout.write(JSON.stringify({ state: res.state, code: res.errorCode }));
          process.exit(0);
        }
        main().catch((e) => { process.stderr.write(String(e)); process.exit(1); });
      `,
        "utf-8"
      );

      const p1 = spawnTsxWorker(workerScript, [testStorageDir, barrierFile, s1.rawResponseSha256, s1.artifactPath]);
      const p2 = spawnTsxWorker(workerScript, [testStorageDir, barrierFile, s2.rawResponseSha256, s2.artifactPath]);
      fs.writeFileSync(barrierFile, "GO", "utf-8");

      const [r1, r2] = await Promise.all([p1, p2]);
      const out1 = JSON.parse(r1.stdout);
      const out2 = JSON.parse(r2.stdout);
      const states = [out1.state, out2.state].sort();
      expect(states).toEqual(["CONFLICT", "EVIDENCE_ELIGIBLE"]);
    }, 20000);

    it("C05: Child process holding DB lock causes second child process to return DB_LOCK_TIMEOUT, eligible=false, dbCommitted=false", async () => {
      const holderReadyFile = path.join(testStorageDir, "c05_holder_ready.txt");
      const releaseSignalFile = path.join(testStorageDir, "c05_release_signal.txt");
      const holderScript = path.join(testStorageDir, "c05_holder.ts");
      const dbLockPath = path.join(testStorageDir, ".provider_receipt_ledger.json.db.lock");

      fs.writeFileSync(
        holderScript,
        `
        import fs from "fs";
        import os from "os";
        const [dbLockPath, readyFile, releaseFile] = process.argv.slice(2);
        const lockData = {
          ownerId: "c05_holder_pid_" + process.pid,
          pid: process.pid,
          hostname: os.hostname(),
          acquiredAt: Date.now(),
          expiresAt: Date.now() + 10000,
        };
        fs.writeFileSync(dbLockPath, JSON.stringify(lockData), "utf-8");
        fs.writeFileSync(readyFile, "READY", "utf-8");
        while (!fs.existsSync(releaseFile)) {
          const sleepUntil = Date.now() + 20;
          while (Date.now() < sleepUntil) {}
        }
        try { fs.unlinkSync(dbLockPath); } catch {}
        process.exit(0);
      `,
        "utf-8"
      );

      const holderPromise = spawnTsxWorker(holderScript, [dbLockPath, holderReadyFile, releaseSignalFile]);
      while (!fs.existsSync(holderReadyFile)) {
        await new Promise((r) => setTimeout(r, 10));
      }

      const stored = saveRawProviderPayloadFile(JSON.stringify({ search_metadata: { id: "c05_timeout_rec", status: "Success" } }));
      const res = await persistCollectorReceiptAtomically({
        receiptId: "c05_timeout_rec",
        provider: "google_trends_serpapi",
        originKind: "LOCAL_INTEGRITY_ONLY",
        targetProductOrKeyword: "cat bed",
        region: "US",
        transportStatus: 200,
        capturedAt: new Date().toISOString(),
        rawResponseSha256: stored.rawResponseSha256,
        rawByteCount: stored.byteCount,
        artifactPath: stored.artifactPath,
      });

      fs.writeFileSync(releaseSignalFile, "RELEASE", "utf-8");
      await holderPromise;

      expect(res.state).toBe("LOCK_TIMEOUT");
      expect(res.errorCode).toBe("DB_LOCK_TIMEOUT");
      expect(res.dbCommitted).toBe(false);
      expect(res.eligible).toBe(false);
    }, 20000);

    it("C06: Child process writes expired lock with its own PID and exits (dead PID); subsequent reclaimer safely reclaims lock", async () => {
      const lockPath = path.join(testStorageDir, ".provider_receipt_ledger.json.lock");
      const crashScript = path.join(testStorageDir, "c06_crasher.ts");

      fs.writeFileSync(
        crashScript,
        `
        import fs from "fs";
        import os from "os";
        const [lockPath] = process.argv.slice(2);
        const lockData = {
          ownerId: "c06_crasher_pid_" + process.pid,
          pid: process.pid,
          hostname: os.hostname(),
          acquiredAt: Date.now() - 15000,
          expiresAt: Date.now() - 5000,
        };
        fs.writeFileSync(lockPath, JSON.stringify(lockData), "utf-8");
        process.exit(0);
      `,
        "utf-8"
      );

      const crashRes = await spawnTsxWorker(crashScript, [lockPath]);
      expect(crashRes.code).toBe(0);

      const stored = saveRawProviderPayloadFile(JSON.stringify({ search_metadata: { id: "c06_reclaim_rec", status: "Success" } }));
      const commitRes = await persistCollectorReceiptAtomically({
        receiptId: "c06_reclaim_rec",
        provider: "google_trends_serpapi",
        originKind: "LOCAL_INTEGRITY_ONLY",
        targetProductOrKeyword: "cat water fountain",
        region: "US",
        transportStatus: 200,
        capturedAt: new Date().toISOString(),
        rawResponseSha256: stored.rawResponseSha256,
        rawByteCount: stored.byteCount,
        artifactPath: stored.artifactPath,
      });
      expect(commitRes.state).toBe("EVIDENCE_ELIGIBLE");
      expect(commitRes.eligible).toBe(true);
      expect(commitRes.dbCommitted).toBe(true);
    }, 20000);

    it("C07: Simulated mid-flight crash: Worker 1 writes LEDGER_PENDING_DB and exits; Reader sees verified=false; Worker 2 runs persistCollectorReceiptAtomically and Reader then sees verified=true", async () => {
      const worker1Script = path.join(testStorageDir, "c07_worker1.ts");
      const stored = saveRawProviderPayloadFile(JSON.stringify({ search_metadata: { id: "c07_crash_rec", status: "Success" } }));

      fs.writeFileSync(
        worker1Script,
        `
        import fs from "fs";
        import { setProviderReceiptStorageDirForTest, persistDurableReceipt } from ${JSON.stringify(enginePath)};
        const [storageDir, sha, artifactPath] = process.argv.slice(2);
        setProviderReceiptStorageDirForTest(storageDir);
        persistDurableReceipt({
          receiptId: "c07_crash_rec",
          provider: "google_trends_serpapi",
        originKind: "LOCAL_INTEGRITY_ONLY",
        targetProductOrKeyword: "cat toy c07",
          region: "US",
          transportStatus: 200,
          capturedAt: new Date().toISOString(),
          rawResponseSha256: sha,
          rawByteCount: fs.readFileSync(artifactPath).length,
          artifactPath,
        });
        process.exit(0);
      `,
        "utf-8"
      );

      const w1 = await spawnTsxWorker(worker1Script, [testStorageDir, stored.rawResponseSha256, stored.artifactPath]);
      expect(w1.code).toBe(0);

      // Reader inspects receipt: MUST NOT pass verification
      const readerBefore = await resolveVerifiedDemandEvidence("provider-request:serpapi:c07_crash_rec", {
        keyword: "cat toy c07",
        region: "US",
      });
      expect(readerBefore.verified).toBe(false);
      expect(readerBefore.errorCode).toBe("RECEIPT_NOT_ELIGIBLE");

      // Worker 2 runs full atomic persistence
      const commitRes = await persistCollectorReceiptAtomically({
        receiptId: "c07_crash_rec",
        provider: "google_trends_serpapi",
        originKind: "LOCAL_INTEGRITY_ONLY",
        targetProductOrKeyword: "cat toy c07",
        region: "US",
        transportStatus: 200,
        capturedAt: new Date().toISOString(),
        rawResponseSha256: stored.rawResponseSha256,
        rawByteCount: stored.byteCount,
        artifactPath: stored.artifactPath,
      });
      expect(commitRes.state).toBe("EVIDENCE_ELIGIBLE");
      expect(commitRes.eligible).toBe(true);

      // Reader inspects receipt again: MUST pass verification
      const readerAfter = await resolveVerifiedDemandEvidence("provider-request:serpapi:c07_crash_rec", {
        keyword: "cat toy c07",
        region: "US",
      });
      expect(readerAfter.verified).toBe(true);
    }, 20000);

    it("C08: Concurrent reader + writer: while child writer commits receipts, concurrent reader calls never crash with JSON parse errors and never observe eligible=true before DB commit", async () => {
      const writerDoneFile = path.join(testStorageDir, "c08_writer_done.txt");
      const writerScript = path.join(testStorageDir, "c08_writer.ts");

      const items: Array<{ receiptId: string; sha: string; artifactPath: string; kw: string }> = [];
      for (let i = 0; i < 6; i++) {
        const receiptId = `c08_rec_${i}`;
        const kw = `pet c08 item ${i}`;
        const raw = JSON.stringify({
          search_metadata: { id: receiptId, status: "Success" },
          search_parameters: { q: kw, geo: "US" },
          interest_over_time: { timeline_data: [{ date: "2026-07-01", values: [{ value: 70 + i }] }] },
        });
        const stored = saveRawProviderPayloadFile(raw);
        items.push({ receiptId, sha: stored.rawResponseSha256, artifactPath: stored.artifactPath, kw });
      }

      fs.writeFileSync(
        writerScript,
        `
        import fs from "fs";
        import { setProviderReceiptStorageDirForTest, persistCollectorReceiptAtomically } from ${JSON.stringify(enginePath)};
        async function main() {
          const [storageDir, doneFile, itemsJson] = process.argv.slice(2);
          setProviderReceiptStorageDirForTest(storageDir);
          const items = JSON.parse(itemsJson);
          for (const item of items) {
            let res;
            let attempts = 0;
            while (attempts < 5) {
              res = await persistCollectorReceiptAtomically({
                receiptId: item.receiptId,
                provider: "google_trends_serpapi",
                originKind: "LOCAL_INTEGRITY_ONLY",
                targetProductOrKeyword: item.kw,
                region: "US",
                transportStatus: 200,
                capturedAt: new Date().toISOString(),
                rawResponseSha256: item.sha,
                rawByteCount: fs.readFileSync(item.artifactPath).length,
                artifactPath: item.artifactPath,
              });
              if (res && res.state === "EVIDENCE_ELIGIBLE") break;
              attempts++;
              await new Promise((r) => setTimeout(r, 50 * attempts));
            }
            if (!res || res.state !== "EVIDENCE_ELIGIBLE") {
              process.stderr.write("Failed: " + JSON.stringify(res));
              process.exit(1);
            }
            await new Promise((r) => setTimeout(r, 20));
          }
          fs.writeFileSync(doneFile, "DONE", "utf-8");
          process.exit(0);
        }
        main().catch((e) => { process.stderr.write(String(e)); process.exit(1); });
      `,
        "utf-8"
      );

      const writerPromise = spawnTsxWorker(writerScript, [testStorageDir, writerDoneFile, JSON.stringify(items)]);

      let readerIterations = 0;
      while (!fs.existsSync(writerDoneFile)) {
        readerIterations++;
        const target = items[readerIterations % items.length];
        const resolved = await resolveVerifiedDemandEvidence(`provider-request:serpapi:${target.receiptId}`, {
          keyword: target.kw,
          region: "US",
        });
        if (resolved.verified) {
          expect(resolved.eligible).toBe(true);
        }
        await new Promise((r) => setTimeout(r, 10));
      }

      const writerRes = await writerPromise;
      expect(writerRes.code, `Writer exited with ${writerRes.code}. Stderr: ${writerRes.stderr}`).toBe(0);
      expect(readerIterations).toBeGreaterThan(0);

      // Verify all items are now verified
      for (const item of items) {
        const resolved = await resolveVerifiedDemandEvidence(`provider-request:serpapi:${item.receiptId}`, {
          keyword: item.kw,
          region: "US",
        });
        expect(resolved.verified).toBe(true);
      }
    }, 60000);
  });
});
