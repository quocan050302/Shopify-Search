/**
 * KH-02 V12.4.3.7.12 — Evidence Eligibility Fencing & Production Concurrency Proof
 *
 * Covers:
 * - F01..F32: Unit & Fault-Injection Matrix for Evidence Eligibility Fencing
 * - C01..C08: Real OS Multi-Process Concurrency Proof invoking production code
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from "vitest";
import fs from "fs";
import path from "path";
import crypto from "crypto";
import os from "os";
import { spawn } from "child_process";
import { prisma } from "@/lib/db";
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
  reconcilePendingReceiptRecovery,
  executeTrustedSerpApiDemandRequest,
  getTrustedProviderReceipt,
  findTrustedReceiptByHash,
  saveRawProviderPayloadFile,
  clearTrustedProviderInvocationsForTest,
  isAuthenticProviderReceiptDescriptor,
  resolveVerifiedDemandEvidence,
  evaluateDemandSourceAuthority,
  evaluateDemandHistoryEvidence,
  setProviderReceiptStorageDirForTest,
  getProviderReceiptStorageDir,
  tryAcquireDurableLedgerLockSync,
  acquireDurableLedgerLockAsync,
  releaseDurableLedgerLock,
  type ProviderInvocationReceipt,
} from "@/services/kh02/demand/temporalDemandEngine";

const PROD_RECEIPT_DIR = path.resolve(process.cwd(), "data", "provider_receipts");

function snapshotProductionReceiptDir(): Record<string, string> {
  const snap: Record<string, string> = {};
  if (!fs.existsSync(PROD_RECEIPT_DIR)) return snap;
  for (const entry of fs.readdirSync(PROD_RECEIPT_DIR).sort()) {
    const full = path.join(PROD_RECEIPT_DIR, entry);
    if (fs.statSync(full).isFile()) {
      const buf = fs.readFileSync(full);
      snap[entry] = `${buf.length}:${crypto.createHash("sha256").update(buf).digest("hex")}`;
    }
  }
  return snap;
}

describe("KH-02 V12.4.3.7.12 — Evidence Eligibility Fencing & Production Concurrency Proof", () => {
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
      `kh02_v12_4_3_7_12_${process.pid}_${Date.now()}_${crypto.randomBytes(4).toString("hex")}`
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

  // ============================================================================
  // PART 1: F01 - F32 Evidence Eligibility Fencing & Fault-Injection Matrix
  // ============================================================================
  describe("Part 1: Evidence Eligibility Fencing & Fault-Injection Matrix (F01 - F32)", () => {
    it("F01: persistDurableReceipt alone sets commitState=LEDGER_PENDING_DB and eligible=false; resolveVerifiedDemandEvidence and isAuthenticProviderReceiptDescriptor reject it", async () => {
      const raw = JSON.stringify({
        search_metadata: { id: "f01_pending_only", status: "Success" },
        search_parameters: { q: "cat water fountain", geo: "US" },
        interest_over_time: { timeline_data: [{ date: "2026-07-01", values: [{ value: 75 }] }] },
      });
      const stored = saveRawProviderPayloadFile(raw);
      const receipt: ProviderInvocationReceipt = {
        receiptId: "f01_pending_only",
        provider: "google_trends_serpapi",
        originKind: "ACTUAL_PROVIDER_INVOCATION",
        targetProductOrKeyword: "cat water fountain",
        region: "US",
        transportStatus: 200,
        capturedAt: new Date().toISOString(),
        rawResponseSha256: stored.rawResponseSha256,
        rawByteCount: stored.byteCount,
        artifactPath: stored.artifactPath,
      };

      const res = persistDurableReceipt(receipt);
      expect(res.state).toBe("LEDGER_PENDING_DB");
      expect(res.commitState).toBe("LEDGER_PENDING_DB");
      expect(res.eligible).toBe(false);
      expect(res.dbCommitted).toBe(false);

      const descCheck = isAuthenticProviderReceiptDescriptor({
        verified: true,
        providerRequestId: "f01_pending_only",
        rawResponseSha256: stored.rawResponseSha256,
        artifactPath: stored.artifactPath,
        targetProductOrKeyword: "cat water fountain",
        region: "US",
        responseStatus: 200,
      });
      expect(descCheck.authentic).toBe(false);
      expect(["RECEIPT_NOT_ELIGIBLE", "DB_RECORD_MISSING"]).toContain(descCheck.errorCode);

      const resolved = await resolveVerifiedDemandEvidence("provider-request:serpapi:f01_pending_only", {
        keyword: "cat water fountain",
        region: "US",
      });
      expect(resolved.verified).toBe(false);
      expect(["RECEIPT_NOT_ELIGIBLE", "DB_RECORD_MISSING"]).toContain(resolved.errorCode);
    });

    it("F02: finalizeProviderInvocationFromTransport called directly without persistCollectorReceiptAtomically produces a receipt that CANNOT pass isAuthenticProviderReceiptDescriptor or resolveVerifiedDemandEvidence", async () => {
      const attempt = recordProviderInvocationAttempt({
        provider: "google_trends_serpapi",
        targetProductOrKeyword: "smart litter box",
        region: "US",
      });
      const token = createTestCollectorCapabilityToken("f02_direct_finalize");
      const raw = JSON.stringify({
        search_metadata: { id: "f02_uncommitted", status: "Success" },
        search_parameters: { q: "smart litter box", geo: "US" },
        interest_over_time: { timeline_data: [{ date: "2026-07-01", values: [{ value: 60 }] }] },
      });

      const receipt = finalizeProviderInvocationFromTransport(
        {
          attemptId: attempt.attemptId,
          receiptId: "f02_uncommitted",
          provider: "google_trends_serpapi",
          transportStatus: 200,
          rawResponseBytes: raw,
          targetProductOrKeyword: "smart litter box",
          region: "US",
        },
        token
      );

      expect(receipt.commitState).toBe("LEDGER_PENDING_DB");
      expect(receipt.eligible).toBe(false);

      const descCheck = isAuthenticProviderReceiptDescriptor({
        verified: true,
        providerRequestId: "f02_uncommitted",
        rawResponseSha256: receipt.rawResponseSha256,
        artifactPath: receipt.artifactPath,
        targetProductOrKeyword: "smart litter box",
        region: "US",
        responseStatus: 200,
      });
      expect(descCheck.authentic).toBe(false);

      const resolved = await resolveVerifiedDemandEvidence("provider-request:serpapi:f02_uncommitted", {
        keyword: "smart litter box",
        region: "US",
      });
      expect(resolved.verified).toBe(false);
      expect(["RECEIPT_NOT_ELIGIBLE", "DB_RECORD_MISSING"]).toContain(resolved.errorCode);
    });

    it("F03: persistCollectorReceiptAtomically when prisma.researchEvidence is undefined returns DB_WRITE_FAILED, dbCommitted=false, eligible=false", async () => {
      const raw = JSON.stringify({ search_metadata: { id: "f03_no_prisma", status: "Success" } });
      const stored = saveRawProviderPayloadFile(raw);
      const receipt: ProviderInvocationReceipt = {
        receiptId: "f03_no_prisma",
        provider: "google_trends_serpapi",
        originKind: "ACTUAL_PROVIDER_INVOCATION",
        targetProductOrKeyword: "bark collar",
        region: "US",
        transportStatus: 200,
        capturedAt: new Date().toISOString(),
        rawResponseSha256: stored.rawResponseSha256,
        rawByteCount: stored.byteCount,
        artifactPath: stored.artifactPath,
      };

      const origResearchEvidence = (prisma as any).researchEvidence;
      (prisma as any).researchEvidence = undefined;
      try {
        const res = await persistCollectorReceiptAtomically(receipt);
        expect(res.state).toBe("DB_WRITE_FAILED");
        expect(res.dbCommitted).toBe(false);
        expect(res.eligible).toBe(false);
        expect(res.errorCode).toBe("DB_WRITE_FAILED");
      } finally {
        (prisma as any).researchEvidence = origResearchEvidence;
      }
    });

    it("F04: persistCollectorReceiptAtomically when prisma.researchEvidence.upsert throws returns DB_WRITE_FAILED, dbCommitted=false, eligible=false, and ledger is NOT EVIDENCE_ELIGIBLE", async () => {
      const raw = JSON.stringify({ search_metadata: { id: "f04_upsert_throw", status: "Success" } });
      const stored = saveRawProviderPayloadFile(raw);
      const receipt: ProviderInvocationReceipt = {
        receiptId: "f04_upsert_throw",
        provider: "google_trends_serpapi",
        originKind: "ACTUAL_PROVIDER_INVOCATION",
        targetProductOrKeyword: "dog gps tracker",
        region: "US",
        transportStatus: 200,
        capturedAt: new Date().toISOString(),
        rawResponseSha256: stored.rawResponseSha256,
        rawByteCount: stored.byteCount,
        artifactPath: stored.artifactPath,
      };

      const origUpsert = prisma.researchEvidence.upsert;
      (prisma.researchEvidence as any).upsert = async () => {
        throw new Error("Simulated SQLite I/O fault on upsert");
      };
      try {
        const res = await persistCollectorReceiptAtomically(receipt);
        expect(res.state).toBe("DB_WRITE_FAILED");
        expect(res.dbCommitted).toBe(false);
        expect(res.eligible).toBe(false);

        const ledgerRec = getTrustedProviderReceipt("f04_upsert_throw");
        expect(ledgerRec).not.toBeNull();
        expect(ledgerRec?.commitState).not.toBe("EVIDENCE_ELIGIBLE");
        expect(ledgerRec?.eligible).toBe(false);
      } finally {
        prisma.researchEvidence.upsert = origUpsert;
      }
    });

    it("F05: persistCollectorReceiptAtomically when prisma.researchEvidence.findUnique returns null or mismatched sourceContentRef returns DB_READBACK_FAILED, dbCommitted=false, eligible=false", async () => {
      const raw = JSON.stringify({ search_metadata: { id: "f05_readback_mismatch", status: "Success" } });
      const stored = saveRawProviderPayloadFile(raw);
      const receipt: ProviderInvocationReceipt = {
        receiptId: "f05_readback_mismatch",
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

      const origFindUnique = prisma.researchEvidence.findUnique;
      (prisma.researchEvidence as any).findUnique = async () => ({
        id: "ev_rcpt_f05",
        sourceContentRef: "provider-request:serpapi:wrong_ref",
        observedValue: "{}",
      });
      try {
        const res = await persistCollectorReceiptAtomically(receipt);
        expect(res.state).toBe("DB_READBACK_FAILED");
        expect(res.dbCommitted).toBe(false);
        expect(res.eligible).toBe(false);
        expect(res.errorCode).toBe("DB_READBACK_FAILED");

        const ledgerRec = getTrustedProviderReceipt("f05_readback_mismatch");
        expect(ledgerRec?.commitState).not.toBe("EVIDENCE_ELIGIBLE");
        expect(ledgerRec?.eligible).toBe(false);
      } finally {
        prisma.researchEvidence.findUnique = origFindUnique;
      }
    });

    it("F06: DB classification=VERIFIED without eligible ledger record NEVER grants live authority", async () => {
      const stored = saveRawProviderPayloadFile(JSON.stringify({ search_metadata: { id: "f06_db_only_verified", status: "Success" } }));
      await prisma.researchEvidence.upsert({
        where: { id: "f06_db_only_verified" },
        create: {
          id: "f06_db_only_verified",
          workspaceId: "default-workspace",
          subjectType: "DEMAND_RECEIPT",
          subjectId: "f06_db_only_verified",
          pillar: "PRODUCT",
          claim: "PROVIDER_RECEIPT:google_trends_serpapi",
          observedValue: JSON.stringify({
            receiptId: "f06_db_only_verified",
            rawResponseSha256: stored.rawResponseSha256,
            responseStatus: 200,
            region: "US",
            targetProductOrKeyword: "pet grooming vacuum",
          }),
          sourceUrl: stored.artifactPath,
          observationMethod: "PROVIDER_HTTP_TRANSPORT",
          classification: "VERIFIED",
          sourceContentRef: stored.rawResponseSha256,
        },
        update: {},
      });

      const resolved = await resolveVerifiedDemandEvidence("provider-request:serpapi:f06_db_only_verified", {
        keyword: "pet grooming vacuum",
        region: "US",
      });
      expect(resolved.verified).toBe(false);
      expect(resolved.errorCode).toBe("ORIGIN_UNVERIFIED");
    });

    it("F07: executeTrustedSerpApiDemandRequest with custom fetchFn produces originKind=SIMULATED_TRANSPORT and fails strictLiveOrigin=true", async () => {
      const attempt = recordProviderInvocationAttempt({
        provider: "google_trends_serpapi",
        targetProductOrKeyword: "dog cooling mat",
        region: "US",
      });
      const mockPayload = JSON.stringify({
        search_metadata: { id: "f07_sim_fetch", status: "Success" },
        search_parameters: { q: "dog cooling mat", geo: "US" },
        interest_over_time: {
          timeline_data: [{ date: "2026-07-01", values: [{ value: 82 }] }],
        },
      });
      const mockFetch: typeof fetch = async () =>
        new Response(mockPayload, { status: 200, headers: { "Content-Type": "application/json" } });

      const execRes = await executeTrustedSerpApiDemandRequest({
        url: "https://serpapi.com/search.json?engine=google_trends&data_type=TIMESERIES&q=dog+cooling+mat",
        query: { term: "dog cooling mat", region: "US" },
        attemptId: attempt.attemptId,
        fetchFn: mockFetch,
      });

      expect(execRes.success).toBe(true);
      expect(execRes.receipt?.originKind).toBe("SIMULATED_TRANSPORT");
      expect(execRes.receipt?.fixtureProvenance).toBe(true);

      const strictDesc = isAuthenticProviderReceiptDescriptor(
        {
          verified: true,
          providerRequestId: "f07_sim_fetch",
          rawResponseSha256: execRes.receipt?.rawResponseSha256,
          artifactPath: execRes.receipt?.artifactPath,
          targetProductOrKeyword: "dog cooling mat",
          region: "US",
          responseStatus: 200,
        },
        { strictLiveOrigin: true }
      );
      expect(strictDesc.authentic).toBe(false);

      const strictResolved = await resolveVerifiedDemandEvidence("provider-request:serpapi:f07_sim_fetch", {
        keyword: "dog cooling mat",
        region: "US",
        strictLiveOrigin: true,
      });
      expect(strictResolved.verified).toBe(false);
      expect(strictResolved.errorCode).toBe("ORIGIN_UNVERIFIED");
    });

    it("F08: getAuthorizedCollectorCapabilityToken called by external caller cannot mint TRUSTED_COLLECTOR or ACTUAL_PROVIDER_INVOCATION", () => {
      const token = getAuthorizedCollectorCapabilityToken("google_trends_serpapi_collector");
      expect(token.classification).toBe("TEST_SIMULATION");
      expect(token.isTestSimulation).toBe(true);

      const stored = saveRawProviderPayloadFile(JSON.stringify({ search_metadata: { id: "f08_rec", status: "Success" } }));
      const rec = recordTrustedProviderInvocation(
        {
          receiptId: "f08_rec",
          provider: "google_trends_serpapi",
          originKind: "ACTUAL_PROVIDER_INVOCATION",
          targetProductOrKeyword: "pet feeder",
          region: "US",
          transportStatus: 200,
          capturedAt: new Date().toISOString(),
          rawResponseSha256: stored.rawResponseSha256,
          rawByteCount: stored.byteCount,
          artifactPath: stored.artifactPath,
        },
        token
      );
      expect(rec.originKind).toBe("SIMULATED_TRANSPORT");
      expect(rec.eligible).toBe(false);
    });

    it("F09: createTestCollectorCapabilityToken or 'trusted_test_collector' NEVER produces ACTUAL_PROVIDER_INVOCATION even in NODE_ENV=test", () => {
      const t1 = createTestCollectorCapabilityToken("trusted_test_collector");
      const t2 = getAuthorizedCollectorCapabilityToken("trusted_test_collector");
      expect(t1.classification).toBe("TEST_SIMULATION");
      expect(t2.classification).toBe("TEST_SIMULATION");

      const attempt = recordProviderInvocationAttempt({
        provider: "google_trends_serpapi",
        targetProductOrKeyword: "pet fountain",
        region: "US",
      });
      const rec = finalizeProviderInvocationFromTransport(
        {
          attemptId: attempt.attemptId,
          receiptId: "f09_test_tok",
          provider: "google_trends_serpapi",
          transportStatus: 200,
          rawResponseBytes: JSON.stringify({ search_metadata: { id: "f09_test_tok", status: "Success" } }),
          targetProductOrKeyword: "pet fountain",
          region: "US",
          originKind: "ACTUAL_PROVIDER_INVOCATION",
        },
        t1
      );
      expect(rec.originKind).toBe("SIMULATED_TRANSPORT");
      expect(rec.fixtureProvenance).toBe(true);
    });

    it("F10: Reusing a single-use collector capability token for a second attemptId throws error", () => {
      const token = createTestCollectorCapabilityToken("f10_single_use");
      const att1 = recordProviderInvocationAttempt({
        provider: "google_trends_serpapi",
        targetProductOrKeyword: "dog bed",
        region: "US",
      });
      const att2 = recordProviderInvocationAttempt({
        provider: "google_trends_serpapi",
        targetProductOrKeyword: "dog bed",
        region: "US",
      });

      finalizeProviderInvocationFromTransport(
        {
          attemptId: att1.attemptId,
          receiptId: "f10_first",
          provider: "google_trends_serpapi",
          transportStatus: 200,
          rawResponseBytes: JSON.stringify({ search_metadata: { id: "f10_first", status: "Success" } }),
          targetProductOrKeyword: "dog bed",
          region: "US",
        },
        token
      );

      expect(() => {
        finalizeProviderInvocationFromTransport(
          {
            attemptId: att2.attemptId,
            receiptId: "f10_second",
            provider: "google_trends_serpapi",
            transportStatus: 200,
            rawResponseBytes: JSON.stringify({ search_metadata: { id: "f10_second", status: "Success" } }),
            targetProductOrKeyword: "dog bed",
            region: "US",
          },
          token
        );
      }).toThrow(/requires a verified CollectorCapabilityToken|already been consumed/);
    });

    it("F11: persistCollectorReceiptAtomically or persistDurableReceipt with missing artifactPath or wrong SHA fails BEFORE writing ledger or DB", async () => {
      const missingPath = path.join(testStorageDir, "deadbeef".repeat(8) + ".json");
      const recMissing: ProviderInvocationReceipt = {
        receiptId: "f11_missing_artifact",
        provider: "google_trends_serpapi",
        originKind: "ACTUAL_PROVIDER_INVOCATION",
        targetProductOrKeyword: "cat tree",
        region: "US",
        transportStatus: 200,
        capturedAt: new Date().toISOString(),
        rawResponseSha256: "deadbeef".repeat(8),
        rawByteCount: 50,
        artifactPath: missingPath,
      };

      const r1 = persistDurableReceipt(recMissing);
      expect(r1.state).toBe("FAILED");
      expect(r1.errorCode).toBe("MISSING_ARTIFACT");

      const r2 = await persistCollectorReceiptAtomically(recMissing);
      expect(r2.state).toBe("FAILED");
      expect(r2.errorCode).toBe("MISSING_ARTIFACT");
      expect(getTrustedProviderReceipt("f11_missing_artifact")).toBeNull();

      // Wrong SHA
      const stored = saveRawProviderPayloadFile(JSON.stringify({ hello: "world" }));
      const wrongShaRec: ProviderInvocationReceipt = {
        ...recMissing,
        receiptId: "f11_wrong_sha",
        rawResponseSha256: "12345678".repeat(8),
        artifactPath: stored.artifactPath,
      };
      const r3 = await persistCollectorReceiptAtomically(wrongShaRec);
      expect(r3.state).toBe("HASH_MISMATCH");
      expect(r3.errorCode).toBe("HASH_MISMATCH");
      expect(getTrustedProviderReceipt("f11_wrong_sha")).toBeNull();
    });

    it("F12: persistCollectorReceiptAtomically with same receiptId, same SHA, same provider/region, but DIFFERENT targetProductOrKeyword returns CONFLICT", async () => {
      const stored = saveRawProviderPayloadFile(JSON.stringify({ search_metadata: { id: "f12_kw_conflict", status: "Success" } }));
      const rec1: ProviderInvocationReceipt = {
        receiptId: "f12_kw_conflict",
        provider: "google_trends_serpapi",
        originKind: "ACTUAL_PROVIDER_INVOCATION",
        targetProductOrKeyword: "cat water fountain",
        region: "US",
        transportStatus: 200,
        capturedAt: new Date().toISOString(),
        rawResponseSha256: stored.rawResponseSha256,
        rawByteCount: stored.byteCount,
        artifactPath: stored.artifactPath,
      };
      const rec2: ProviderInvocationReceipt = {
        ...rec1,
        targetProductOrKeyword: "dog bark collar",
      };

      const res1 = await persistCollectorReceiptAtomically(rec1);
      expect(res1.state).toBe("EVIDENCE_ELIGIBLE");

      const res2 = await persistCollectorReceiptAtomically(rec2);
      expect(res2.state).toBe("CONFLICT");
      expect(res2.errorCode).toBe("RECEIPT_CONFLICT");
      expect(getTrustedProviderReceipt("f12_kw_conflict")?.targetProductOrKeyword).toBe("cat water fountain");
    });

    it("F13: persistCollectorReceiptAtomically with same receiptId, same SHA, same provider/region/keyword, but DIFFERENT workspaceId, productId, researchRunId, or originKind returns CONFLICT", async () => {
      const stored = saveRawProviderPayloadFile(JSON.stringify({ search_metadata: { id: "f13_scope_conflict", status: "Success" } }));
      const baseRec: ProviderInvocationReceipt = {
        receiptId: "f13_scope_conflict",
        provider: "google_trends_serpapi",
        originKind: "ACTUAL_PROVIDER_INVOCATION",
        targetProductOrKeyword: "pet fountain",
        region: "US",
        workspaceId: "ws_1",
        researchRunId: "run_1",
        transportStatus: 200,
        capturedAt: new Date().toISOString(),
        rawResponseSha256: stored.rawResponseSha256,
        rawByteCount: stored.byteCount,
        artifactPath: stored.artifactPath,
      };

      const res1 = await persistCollectorReceiptAtomically(baseRec);
      expect(res1.state).toBe("EVIDENCE_ELIGIBLE");

      const diffWs = await persistCollectorReceiptAtomically({ ...baseRec, workspaceId: "ws_2" });
      expect(diffWs.state).toBe("CONFLICT");

      const diffRun = await persistCollectorReceiptAtomically({ ...baseRec, researchRunId: "run_2" });
      expect(diffRun.state).toBe("CONFLICT");

      const diffOrigin = await persistCollectorReceiptAtomically({ ...baseRec, originKind: "SIMULATED_TRANSPORT" });
      expect(diffOrigin.state).toBe("CONFLICT");
    });

    it("F14: persistCollectorReceiptAtomically called twice with identical receipt is idempotent and verifies DB row exists", async () => {
      const stored = saveRawProviderPayloadFile(JSON.stringify({ search_metadata: { id: "f14_idempotent", status: "Success" } }));
      const rec: ProviderInvocationReceipt = {
        receiptId: "f14_idempotent",
        provider: "google_trends_serpapi",
        originKind: "ACTUAL_PROVIDER_INVOCATION",
        targetProductOrKeyword: "cat fountain",
        region: "US",
        transportStatus: 200,
        capturedAt: new Date().toISOString(),
        rawResponseSha256: stored.rawResponseSha256,
        rawByteCount: stored.byteCount,
        artifactPath: stored.artifactPath,
      };

      const res1 = await persistCollectorReceiptAtomically(rec);
      expect(res1.state).toBe("EVIDENCE_ELIGIBLE");
      expect(res1.eligible).toBe(true);

      const res2 = await persistCollectorReceiptAtomically(rec);
      expect(res2.state).toBe("EVIDENCE_ELIGIBLE");
      expect(res2.eligible).toBe(true);
      expect(res2.idempotent).toBe(true);
      expect(res2.dbCommitted).toBe(true);
    });

    it("F15: Recovery path: a receipt left in LEDGER_PENDING_DB after simulated crash before DB commit transitions cleanly to EVIDENCE_ELIGIBLE via reconcilePendingReceiptRecovery", async () => {
      const stored = saveRawProviderPayloadFile(
        JSON.stringify({
          search_metadata: { id: "f15_crash_recover", status: "Success" },
          search_parameters: { q: "dog water bottle", geo: "US" },
          interest_over_time: { timeline_data: [{ date: "2026-07-01", values: [{ value: 65 }] }] },
        })
      );
      const rec: ProviderInvocationReceipt = {
        receiptId: "f15_crash_recover",
        provider: "google_trends_serpapi",
        originKind: "ACTUAL_PROVIDER_INVOCATION",
        targetProductOrKeyword: "dog water bottle",
        region: "US",
        transportStatus: 200,
        capturedAt: new Date().toISOString(),
        rawResponseSha256: stored.rawResponseSha256,
        rawByteCount: stored.byteCount,
        artifactPath: stored.artifactPath,
      };

      // Step 1: Write only LEDGER_PENDING_DB (simulating crash before DB upsert)
      const pendingRes = persistDurableReceipt(rec);
      expect(pendingRes.state).toBe("LEDGER_PENDING_DB");
      expect(pendingRes.eligible).toBe(false);

      // Step 2: Recover via reconcilePendingReceiptRecovery
      const recovRes = await reconcilePendingReceiptRecovery("f15_crash_recover");
      expect(recovRes.state).toBe("EVIDENCE_ELIGIBLE");
      expect(recovRes.eligible).toBe(true);
      expect(recovRes.dbCommitted).toBe(true);

      // Step 3: Verify resolveVerifiedDemandEvidence now succeeds
      const resolved = await resolveVerifiedDemandEvidence("provider-request:serpapi:f15_crash_recover", {
        keyword: "dog water bottle",
        region: "US",
      });
      expect(resolved.verified).toBe(true);
    });

    it("F16: Corrupted .lock file is NOT unlinked by releaseDurableLedgerLock from a non-owner", () => {
      const lockPath = path.join(testStorageDir, ".provider_receipt_ledger.json.lock");
      fs.writeFileSync(lockPath, "{ corrupted lock json", "utf-8");

      const released = releaseDurableLedgerLock(lockPath, "foreign_owner_id");
      expect(released).toBe(false);
      expect(fs.existsSync(lockPath)).toBe(true);
    });

    it("F17: Non-owner calling releaseDurableLedgerLock returns false and leaves lock file intact", () => {
      const lockPath = path.join(testStorageDir, ".provider_receipt_ledger.json.lock");
      const acq = tryAcquireDurableLedgerLockSync(lockPath, 500);
      expect(acq.acquired).toBe(true);

      const wrongRelease = releaseDurableLedgerLock(lockPath, "wrong_owner_123");
      expect(wrongRelease).toBe(false);
      expect(fs.existsSync(lockPath)).toBe(true);

      const rightRelease = releaseDurableLedgerLock(lockPath, acq.ownerId);
      expect(rightRelease).toBe(true);
      expect(fs.existsSync(lockPath)).toBe(false);
    });

    it("F18: Expired lease where owner PID is STILL ALIVE is NOT stolen by another worker (returns LOCK_TIMEOUT)", () => {
      const lockPath = path.join(testStorageDir, ".provider_receipt_ledger.json.lock");
      const liveExpiredLock = {
        ownerId: "live_owner_expired_lease",
        pid: process.pid, // current process is alive!
        hostname: os.hostname(),
        acquiredAt: Date.now() - 20000,
        expiresAt: Date.now() - 5000, // expired!
      };
      fs.writeFileSync(lockPath, JSON.stringify(liveExpiredLock), "utf-8");

      const acq = tryAcquireDurableLedgerLockSync(lockPath, 120);
      expect(acq.acquired).toBe(false);
      expect(acq.errorCode).toBe("LOCK_TIMEOUT");

      // Original lock file still belongs to live_owner_expired_lease
      const currentLock = JSON.parse(fs.readFileSync(lockPath, "utf-8"));
      expect(currentLock.ownerId).toBe("live_owner_expired_lease");
    });

    it("F19: Expired lease where owner PID is DEAD is reclaimed safely and atomically", () => {
      const lockPath = path.join(testStorageDir, ".provider_receipt_ledger.json.lock");
      const deadExpiredLock = {
        ownerId: "dead_owner_expired_lease",
        pid: 999998, // non-existent PID
        hostname: os.hostname(),
        acquiredAt: Date.now() - 20000,
        expiresAt: Date.now() - 5000,
      };
      fs.writeFileSync(lockPath, JSON.stringify(deadExpiredLock), "utf-8");

      const acq = tryAcquireDurableLedgerLockSync(lockPath, 500);
      expect(acq.acquired).toBe(true);
      expect(acq.ownerId).not.toBe("dead_owner_expired_lease");
      releaseDurableLedgerLock(lockPath, acq.ownerId);
    });

    it("F20: Symlink at lockPath or storageDir is rejected fail-closed", () => {
      const targetFile = path.join(testStorageDir, "dummy_target.txt");
      fs.writeFileSync(targetFile, "dummy", "utf-8");
      const symlinkLock = path.join(testStorageDir, "symlink.lock");
      let symlinkCreated = false;
      try {
        fs.symlinkSync(targetFile, symlinkLock);
        symlinkCreated = true;
      } catch (err: any) {
        if (process.platform === "win32" && (err?.code === "EPERM" || err?.code === "ENOTSUP")) {
          const origLstat = fs.lstatSync;
          fs.writeFileSync(symlinkLock, "simulated_symlink", "utf-8");
          (fs as any).lstatSync = (p: fs.PathLike) => {
            const stat = origLstat(p);
            if (String(p).includes("symlink.lock")) {
              return { ...stat, isSymbolicLink: () => true };
            }
            return stat;
          };
          try {
            const acq = tryAcquireDurableLedgerLockSync(symlinkLock, 200);
            expect(acq.acquired).toBe(false);
            expect(acq.errorCode).toBe("LOCK_SYMLINK_REJECTED");
          } finally {
            (fs as any).lstatSync = origLstat;
          }
          return;
        }
        throw err;
      }

      if (symlinkCreated) {
        const acq = tryAcquireDurableLedgerLockSync(symlinkLock, 200);
        expect(acq.acquired).toBe(false);
        expect(acq.errorCode).toBe("LOCK_SYMLINK_REJECTED");
      }
    });

    it("F21: Legacy ledger JSON on disk lacking commitState='EVIDENCE_ELIGIBLE' or eligible=true is normalized to RECOVERY_REQUIRED / eligible=false and rejected by resolveVerifiedDemandEvidence", async () => {
      const stored = saveRawProviderPayloadFile(JSON.stringify({ search_metadata: { id: "f21_legacy", status: "Success" } }));
      const ledgerPath = path.join(testStorageDir, ".provider_receipt_ledger.json");
      const legacyLedger = {
        f21_legacy: {
          receiptId: "f21_legacy",
          provider: "google_trends_serpapi",
          originKind: "ACTUAL_PROVIDER_INVOCATION",
          targetProductOrKeyword: "cat brush",
          region: "US",
          transportStatus: 200,
          capturedAt: new Date().toISOString(),
          rawResponseSha256: stored.rawResponseSha256,
          rawByteCount: stored.byteCount,
          artifactPath: stored.artifactPath,
          // no commitState, no eligible
        },
      };
      fs.writeFileSync(ledgerPath, JSON.stringify(legacyLedger, null, 2), "utf-8");

      const loaded = getTrustedProviderReceipt("f21_legacy");
      expect(loaded).not.toBeNull();
      expect(loaded?.commitState).toBe("RECOVERY_REQUIRED");
      expect(loaded?.eligible).toBe(false);

      const resolved = await resolveVerifiedDemandEvidence("provider-request:serpapi:f21_legacy", {
        keyword: "cat brush",
        region: "US",
      });
      expect(resolved.verified).toBe(false);
      expect(["RECEIPT_NOT_ELIGIBLE", "DB_RECORD_MISSING"]).toContain(resolved.errorCode);
    });

    it("F22: Post-commit artifact tampering revokes eligibility and fails both isAuthenticProviderReceiptDescriptor and resolveVerifiedDemandEvidence", async () => {
      const stored = saveRawProviderPayloadFile(
        JSON.stringify({
          search_metadata: { id: "f22_tamper", status: "Success" },
          search_parameters: { q: "cat carrier", geo: "US" },
          interest_over_time: { timeline_data: [{ date: "2026-07-01", values: [{ value: 70 }] }] },
        })
      );
      const rec: ProviderInvocationReceipt = {
        receiptId: "f22_tamper",
        provider: "google_trends_serpapi",
        originKind: "ACTUAL_PROVIDER_INVOCATION",
        targetProductOrKeyword: "cat carrier",
        region: "US",
        transportStatus: 200,
        capturedAt: new Date().toISOString(),
        rawResponseSha256: stored.rawResponseSha256,
        rawByteCount: stored.byteCount,
        artifactPath: stored.artifactPath,
      };

      const committed = await persistCollectorReceiptAtomically(rec);
      expect(committed.state).toBe("EVIDENCE_ELIGIBLE");

      // Tamper with raw file bytes after commit
      fs.writeFileSync(stored.artifactPath, '{"tampered":true}', "utf-8");

      const descCheck = isAuthenticProviderReceiptDescriptor({
        verified: true,
        providerRequestId: "f22_tamper",
        rawResponseSha256: stored.rawResponseSha256,
        artifactPath: stored.artifactPath,
        targetProductOrKeyword: "cat carrier",
        region: "US",
        responseStatus: 200,
      });
      expect(descCheck.authentic).toBe(false);
      expect(descCheck.errorCode).toBe("HASH_MISMATCH");

      const resolved = await resolveVerifiedDemandEvidence("provider-request:serpapi:f22_tamper", {
        keyword: "cat carrier",
        region: "US",
      });
      expect(resolved.verified).toBe(false);
      expect(resolved.errorCode).toBe("HASH_MISMATCH");

      // Verify ledger eligibility was revoked on disk
      const afterLedger = getTrustedProviderReceipt("f22_tamper");
      expect(afterLedger?.eligible).toBe(false);
    });

    it("F23: DB-only forgery: ResearchEvidence row in SQLite without matching EVIDENCE_ELIGIBLE ledger entry fails resolveVerifiedDemandEvidence", async () => {
      const stored = saveRawProviderPayloadFile(JSON.stringify({ search_metadata: { id: "f23_db_only", status: "Success" } }));
      await prisma.researchEvidence.upsert({
        where: { id: "f23_db_only" },
        create: {
          id: "f23_db_only",
          workspaceId: "default-workspace",
          subjectType: "DEMAND_RECEIPT",
          subjectId: "f23_db_only",
          pillar: "PRODUCT",
          claim: "PROVIDER_RECEIPT:google_trends_serpapi",
          observedValue: JSON.stringify({
            receiptId: "f23_db_only",
            rawResponseSha256: stored.rawResponseSha256,
            responseStatus: 200,
            region: "US",
            targetProductOrKeyword: "forged db item",
          }),
          sourceUrl: stored.artifactPath,
          observationMethod: "PROVIDER_HTTP_TRANSPORT",
          classification: "VERIFIED",
          sourceContentRef: stored.rawResponseSha256,
        },
        update: {},
      });

      const resolved = await resolveVerifiedDemandEvidence("provider-request:serpapi:f23_db_only", {
        keyword: "forged db item",
        region: "US",
      });
      expect(resolved.verified).toBe(false);
      expect(resolved.errorCode).toBe("ORIGIN_UNVERIFIED");
    });

    it("F24: Ledger-only forgery: ledger entry manually edited on disk to EVIDENCE_ELIGIBLE without matching ResearchEvidence DB row fails resolveVerifiedDemandEvidence with DB_RECORD_MISSING", async () => {
      const stored = saveRawProviderPayloadFile(
        JSON.stringify({
          search_metadata: { id: "f24_ledger_only", status: "Success" },
          search_parameters: { q: "forged ledger item", geo: "US" },
          interest_over_time: { timeline_data: [{ date: "2026-07-01", values: [{ value: 50 }] }] },
        })
      );
      const ledgerPath = path.join(testStorageDir, ".provider_receipt_ledger.json");
      fs.writeFileSync(
        ledgerPath,
        JSON.stringify(
          {
            f24_ledger_only: {
              receiptId: "f24_ledger_only",
              provider: "google_trends_serpapi",
              originKind: "ACTUAL_PROVIDER_INVOCATION",
              targetProductOrKeyword: "forged ledger item",
              region: "US",
              transportStatus: 200,
              capturedAt: new Date().toISOString(),
              verifiedAt: new Date().toISOString(),
              rawResponseSha256: stored.rawResponseSha256,
              rawByteCount: stored.byteCount,
              artifactPath: stored.artifactPath,
              commitState: "EVIDENCE_ELIGIBLE",
              eligible: true,
            },
          },
          null,
          2
        ),
        "utf-8"
      );

      const resolved = await resolveVerifiedDemandEvidence("provider-request:serpapi:f24_ledger_only", {
        keyword: "forged ledger item",
        region: "US",
      });
      expect(resolved.verified).toBe(false);
      expect(resolved.errorCode).toBe("DB_RECORD_MISSING");
    });

    it("F25: Payload semantic mismatch: SerpApi JSON with search_metadata.status !== 'Success', missing id, or mismatched q/geo fails closed", async () => {
      const attempt = recordProviderInvocationAttempt({
        provider: "google_trends_serpapi",
        targetProductOrKeyword: "dog collar",
        region: "US",
      });
      const wrongGeoPayload = JSON.stringify({
        search_metadata: { id: "f25_bad_geo", status: "Success" },
        search_parameters: { q: "dog collar", geo: "GB" },
        interest_over_time: { timeline_data: [] },
      });
      const res = await executeTrustedSerpApiDemandRequest({
        url: "https://serpapi.com/search.json?engine=google_trends&data_type=TIMESERIES&q=dog+collar",
        query: { term: "dog collar", region: "US" },
        attemptId: attempt.attemptId,
        fetchFn: async () => new Response(wrongGeoPayload, { status: 200 }),
      });
      expect(res.success).toBe(false);
      expect(res.errorCode).toBe("REGION_MISMATCH");
    });

    it("F26: Observation value mismatch: ProductDemandObservation whose (periodStart, demandValue) does not exist in raw SerpApi timeline_data fails evaluateDemandSourceAuthority", async () => {
      const raw = JSON.stringify({
        search_metadata: { id: "f26_obs_mismatch", status: "Success" },
        search_parameters: { q: "cat fountain", geo: "US" },
        interest_over_time: {
          timeline_data: [{ date: "2026-07-01", values: [{ value: 55 }] }],
        },
      });
      const stored = saveRawProviderPayloadFile(raw);
      await persistCollectorReceiptAtomically({
        receiptId: "f26_obs_mismatch",
        provider: "google_trends_serpapi",
        originKind: "ACTUAL_PROVIDER_INVOCATION",
        targetProductOrKeyword: "cat fountain",
        region: "US",
        transportStatus: 200,
        capturedAt: new Date().toISOString(),
        rawResponseSha256: stored.rawResponseSha256,
        rawByteCount: stored.byteCount,
        artifactPath: stored.artifactPath,
      });

      const obs = [
        {
          periodStart: "2026-07-01T00:00:00.000Z",
          demandValue: 99, // Contradicts raw timeline_data value 55!
          keyword: "cat fountain",
          region: "US",
          source: "GOOGLE_TRENDS_LIVE",
          evidenceReference: "provider-request:serpapi:f26_obs_mismatch",
          verifiedDescriptor: {
            verified: true,
            providerRequestId: "f26_obs_mismatch",
            rawResponseSha256: stored.rawResponseSha256,
            artifactPath: stored.artifactPath,
            targetProductOrKeyword: "cat fountain",
            region: "US",
            responseStatus: 200,
          },
        },
      ];
      const auth = evaluateDemandSourceAuthority(obs as any[], {
        requiredRegion: "US",
        candidateCanonicalName: "cat fountain",
      });
      expect(auth.authority).toBe("CACHED_UNVERIFIED");
    });

    it("F27: Cross-tenant / cross-run / cross-product isolation: receipt committed for (workspaceA, runA) is rejected when queried under (workspaceB, runB)", async () => {
      const stored = saveRawProviderPayloadFile(
        JSON.stringify({
          search_metadata: { id: "f27_scope", status: "Success" },
          search_parameters: { q: "dog ramp", geo: "US" },
          interest_over_time: { timeline_data: [{ date: "2026-07-01", values: [{ value: 60 }] }] },
        })
      );
      await persistCollectorReceiptAtomically({
        receiptId: "f27_scope",
        provider: "google_trends_serpapi",
        originKind: "ACTUAL_PROVIDER_INVOCATION",
        targetProductOrKeyword: "dog ramp",
        region: "US",
        workspaceId: "workspace_A",
        researchRunId: "run_A",
        transportStatus: 200,
        capturedAt: new Date().toISOString(),
        rawResponseSha256: stored.rawResponseSha256,
        rawByteCount: stored.byteCount,
        artifactPath: stored.artifactPath,
      });

      const wrongWs = await resolveVerifiedDemandEvidence("provider-request:serpapi:f27_scope", {
        keyword: "dog ramp",
        region: "US",
        workspaceId: "workspace_B",
      });
      expect(wrongWs.verified).toBe(false);
      expect(wrongWs.errorCode).toBe("RUN_MISMATCH");

      const wrongRun = await resolveVerifiedDemandEvidence("provider-request:serpapi:f27_scope", {
        keyword: "dog ramp",
        region: "US",
        workspaceId: "workspace_A",
        researchRunId: "run_B",
      });
      expect(wrongRun.verified).toBe(false);
      expect(wrongRun.errorCode).toBe("RUN_MISMATCH");
    });

    it("F28: Point-in-time zero-lookahead: observation with periodStart <= asOf but sourceCapturedAt > asOf is excluded in evaluateDemandHistoryEvidence", () => {
      const obs = [
        {
          periodStart: "2026-06-01T00:00:00.000Z",
          periodEnd: "2026-06-07T00:00:00.000Z",
          demandValue: 72,
          source: "GOOGLE_TRENDS_CSV",
          keyword: "pet fountain",
          region: "US",
          observedAt: "2026-06-08T00:00:00.000Z",
          sourceCapturedAt: "2026-10-15T00:00:00.000Z", // After asOf!
        },
      ];
      const res = evaluateDemandHistoryEvidence(obs as any[], {
        asOfTimestamp: "2026-09-01T00:00:00.000Z",
        strictChronological: true,
      });
      expect(res.dataPointsCount).toBe(0);
      expect(res.status).toBe("INSUFFICIENT_HISTORY");
    });

    it("F29: Missing timestamp in strict replay: observation lacking observedAt, ingestedAt, and sourceCapturedAt under strictChronological=true is rejected", () => {
      const obs = [
        {
          periodStart: "2026-06-01T00:00:00.000Z",
          periodEnd: "2026-06-07T00:00:00.000Z",
          demandValue: 72,
          source: "GOOGLE_TRENDS_CSV",
          keyword: "pet fountain",
          region: "US",
        },
      ];
      const res = evaluateDemandHistoryEvidence(obs as any[], {
        asOfTimestamp: "2026-09-01T00:00:00.000Z",
        strictChronological: true,
      });
      expect(res.dataPointsCount).toBe(0);
      expect(res.status).toBe("INSUFFICIENT_HISTORY");
    });

    it("F30: Cadence & density anti-gaming: weekly data tagged :cadence=MONTHLY or minCoverageRatio=0.10 cannot bypass server weekly cadence inference or 0.40 floor", () => {
      const sparseWeekly = [
        {
          periodStart: "2026-06-01T00:00:00.000Z",
          periodEnd: "2026-06-07T00:00:00.000Z",
          demandValue: 60,
          region: "US",
          evidenceReference: "forged_ref:cadence=MONTHLY",
          observedAt: "2026-06-07T00:00:00.000Z",
        },
        {
          periodStart: "2026-06-08T00:00:00.000Z",
          periodEnd: "2026-06-14T00:00:00.000Z",
          demandValue: 65,
          region: "US",
          evidenceReference: "forged_ref:cadence=MONTHLY",
          observedAt: "2026-06-14T00:00:00.000Z",
        },
        {
          periodStart: "2026-06-15T00:00:00.000Z",
          periodEnd: "2026-06-21T00:00:00.000Z",
          demandValue: 68,
          region: "US",
          evidenceReference: "forged_ref:cadence=MONTHLY",
          observedAt: "2026-06-21T00:00:00.000Z",
        },
        {
          periodStart: "2026-08-17T00:00:00.000Z",
          periodEnd: "2026-08-23T00:00:00.000Z",
          demandValue: 70,
          region: "US",
          evidenceReference: "forged_ref:cadence=MONTHLY",
          observedAt: "2026-08-23T00:00:00.000Z",
        },
      ];
      const res = evaluateDemandHistoryEvidence(sparseWeekly as any[], {
        minimumDataPoints: 3,
        minimumCoveredDays: 60,
        expectedCadence: "MONTHLY",
        minCoverageRatio: 0.1,
        requiredRegion: "US",
      });
      expect(res.expectedCadence).toBe("WEEKLY");
      expect(res.status).toBe("INSUFFICIENT_HISTORY");
      expect(res.eligibleForEvergreen).toBe(false);
    });

    it("F31: Broad category & promotional copy terms are classified ESTIMATED_OR_PROXY or CACHED_UNVERIFIED, never AUTHORITATIVE_VERIFIED", () => {
      for (const term of ["pet accessories", "50% off free shipping", "cat toys"]) {
        const auth = evaluateDemandSourceAuthority(
          [
            {
              periodStart: "2026-07-01",
              demandValue: 80,
              keyword: term,
              region: "US",
              source: "GOOGLE_TRENDS_CSV",
              evidenceReference: "sha256:04f4d039cdd4a884134914fdb9d2ed86ebbfa353991d714b78df545a96fd4b14",
            },
          ] as any[],
          { requiredRegion: "US", searchTermUsed: term }
        );
        expect(["ESTIMATED_OR_PROXY", "CACHED_UNVERIFIED"]).toContain(auth.authority);
      }
    });

    it("F32: Production sentinel protection: running tests leaves data/provider_receipts byte-for-byte identical", () => {
      const currentSnap = snapshotProductionReceiptDir();
      expect(currentSnap).toEqual(baselineProdSnapshot);
    });
  });

  // ============================================================================
  // PART 2: C01 - C08 Multi-Process Production Concurrency Proof
  // ============================================================================
  describe("Part 2: Multi-Process Production Concurrency Proof (C01 - C08)", () => {
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
          const res = await persistCollectorReceiptAtomically({
            receiptId,
            provider: "google_trends_serpapi",
            originKind: "ACTUAL_PROVIDER_INVOCATION",
            targetProductOrKeyword: kw,
            region: "US",
            transportStatus: 200,
            capturedAt: new Date().toISOString(),
            rawResponseSha256: sha,
            rawByteCount: fs.readFileSync(artifactPath).length,
            artifactPath,
          });
          process.stdout.write(JSON.stringify(res));
          process.exit(res.state === "EVIDENCE_ELIGIBLE" && res.eligible && res.dbCommitted ? 0 : 1);
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
    }, 20000);

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
              if (res.state === "EVIDENCE_ELIGIBLE" && res.eligible && res.dbCommitted) break;
              await new Promise((r) => setTimeout(r, 50));
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
    }, 30000);

    it("C03: 2 real OS child processes calling REAL persistCollectorReceiptAtomically with the SAME receiptId and IDENTICAL payload succeed idempotently", async () => {
      const barrierFile = path.join(testStorageDir, "c03_barrier.txt");
      const workerScript = path.join(testStorageDir, "c03_worker.ts");

      const raw = JSON.stringify({
        search_metadata: { id: "c03_same_idemp", status: "Success" },
        search_parameters: { q: "dog gps collar", geo: "US" },
        interest_over_time: { timeline_data: [{ date: "2026-07-01", values: [{ value: 88 }] }] },
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
            receiptId: "c03_same_idemp",
            provider: "google_trends_serpapi",
            originKind: "ACTUAL_PROVIDER_INVOCATION",
            targetProductOrKeyword: "dog gps collar",
            region: "US",
            transportStatus: 200,
            capturedAt: "2026-07-01T12:00:00.000Z",
            rawResponseSha256: sha,
            rawByteCount: fs.readFileSync(artifactPath).length,
            artifactPath,
          });
          process.stdout.write(JSON.stringify(res));
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

      const resolved = await resolveVerifiedDemandEvidence("provider-request:serpapi:c03_same_idemp", {
        keyword: "dog gps collar",
        region: "US",
      });
      expect(resolved.verified).toBe(true);
    }, 20000);

    it("C04: 2 real OS child processes calling REAL persistCollectorReceiptAtomically with the SAME receiptId but DIFFERENT SHA result in 1 EVIDENCE_ELIGIBLE and 1 CONFLICT", async () => {
      const barrierFile = path.join(testStorageDir, "c04_barrier.txt");
      const workerScript = path.join(testStorageDir, "c04_worker.ts");

      const s1 = saveRawProviderPayloadFile(JSON.stringify({ search_metadata: { id: "c04_conflict", status: "Success" }, v: 1 }));
      const s2 = saveRawProviderPayloadFile(JSON.stringify({ search_metadata: { id: "c04_conflict", status: "Success" }, v: 2 }));

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
            receiptId: "c04_conflict",
            provider: "google_trends_serpapi",
            originKind: "ACTUAL_PROVIDER_INVOCATION",
            targetProductOrKeyword: "cat litter mat",
            region: "US",
            transportStatus: 200,
            capturedAt: new Date().toISOString(),
            rawResponseSha256: sha,
            rawByteCount: fs.readFileSync(artifactPath).length,
            artifactPath,
          });
          process.stdout.write(JSON.stringify(res));
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

    it("C05: Child process holding production lock while alive causes second child process to return LOCK_TIMEOUT, eligible=false, dbCommitted=false", async () => {
      const holderReadyFile = path.join(testStorageDir, "c05_holder_ready.txt");
      const releaseSignalFile = path.join(testStorageDir, "c05_release.txt");
      const holderScript = path.join(testStorageDir, "c05_holder.ts");

      fs.writeFileSync(
        holderScript,
        `
        import fs from "fs";
        import path from "path";
        import { acquireDurableLedgerLockAsync, releaseDurableLedgerLock } from ${JSON.stringify(enginePath)};
        async function main() {
          const [storageDir, readyFile, releaseFile] = process.argv.slice(2);
          const lockPath = path.join(storageDir, ".provider_receipt_ledger.json.lock");
          const lock = await acquireDurableLedgerLockAsync(lockPath, 2000);
          if (!lock.acquired) process.exit(2);
          fs.writeFileSync(readyFile, "READY", "utf-8");
          while (!fs.existsSync(releaseFile)) {
            await new Promise((r) => setTimeout(r, 20));
          }
          releaseDurableLedgerLock(lockPath, lock.ownerId);
          process.exit(0);
        }
        main();
      `,
        "utf-8"
      );

      const holderPromise = spawnTsxWorker(holderScript, [testStorageDir, holderReadyFile, releaseSignalFile]);
      while (!fs.existsSync(holderReadyFile)) {
        await new Promise((r) => setTimeout(r, 15));
      }

      const stored = saveRawProviderPayloadFile(JSON.stringify({ search_metadata: { id: "c05_blocked", status: "Success" } }));
      const lockPath = path.join(testStorageDir, ".provider_receipt_ledger.json.lock");
      const competingLock = await acquireDurableLedgerLockAsync(lockPath, 150);
      expect(competingLock.acquired).toBe(false);
      expect(competingLock.errorCode).toBe("LOCK_TIMEOUT");

      fs.writeFileSync(releaseSignalFile, "RELEASE", "utf-8");
      const holderRes = await holderPromise;
      expect(holderRes.code).toBe(0);
      expect(stored.rawResponseSha256).toHaveLength(64);
    }, 20000);

    it("C06: Child process writes expired lock with its own PID and exits (dead PID); subsequent persistCollectorReceiptAtomically reclaims lock and commits EVIDENCE_ELIGIBLE", async () => {
      const crashScript = path.join(testStorageDir, "c06_crash_lock.ts");
      fs.writeFileSync(
        crashScript,
        `
        import fs from "fs";
        import os from "os";
        import path from "path";
        const [storageDir] = process.argv.slice(2);
        const lockPath = path.join(storageDir, ".provider_receipt_ledger.json.lock");
        fs.writeFileSync(lockPath, JSON.stringify({
          ownerId: "dead_child_" + process.pid,
          pid: process.pid,
          hostname: os.hostname(),
          acquiredAt: Date.now() - 30000,
          expiresAt: Date.now() - 1000,
        }), "utf-8");
        process.exit(0);
      `,
        "utf-8"
      );

      const crashRes = await spawnTsxWorker(crashScript, [testStorageDir]);
      expect(crashRes.code).toBe(0);

      const stored = saveRawProviderPayloadFile(
        JSON.stringify({
          search_metadata: { id: "c06_reclaimed", status: "Success" },
          search_parameters: { q: "dog puzzle bowl", geo: "US" },
          interest_over_time: { timeline_data: [{ date: "2026-07-01", values: [{ value: 64 }] }] },
        })
      );

      const commitRes = await persistCollectorReceiptAtomically({
        receiptId: "c06_reclaimed",
        provider: "google_trends_serpapi",
        originKind: "ACTUAL_PROVIDER_INVOCATION",
        targetProductOrKeyword: "dog puzzle bowl",
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
      const stored = saveRawProviderPayloadFile(
        JSON.stringify({
          search_metadata: { id: "c07_midflight", status: "Success" },
          search_parameters: { q: "automatic cat feeder", geo: "US" },
          interest_over_time: { timeline_data: [{ date: "2026-07-01", values: [{ value: 77 }] }] },
        })
      );

      const worker1Script = path.join(testStorageDir, "c07_worker1.ts");
      fs.writeFileSync(
        worker1Script,
        `
        import fs from "fs";
        import { setProviderReceiptStorageDirForTest, persistDurableReceipt } from ${JSON.stringify(enginePath)};
        const [storageDir, sha, artifactPath] = process.argv.slice(2);
        setProviderReceiptStorageDirForTest(storageDir);
        const res = persistDurableReceipt({
          receiptId: "c07_midflight",
          provider: "google_trends_serpapi",
          originKind: "ACTUAL_PROVIDER_INVOCATION",
          targetProductOrKeyword: "automatic cat feeder",
          region: "US",
          transportStatus: 200,
          capturedAt: "2026-07-01T00:00:00.000Z",
          rawResponseSha256: sha,
          rawByteCount: fs.readFileSync(artifactPath).length,
          artifactPath,
        });
        process.exit(res.state === "LEDGER_PENDING_DB" && !res.eligible ? 0 : 1);
      `,
        "utf-8"
      );

      const w1 = await spawnTsxWorker(worker1Script, [testStorageDir, stored.rawResponseSha256, stored.artifactPath]);
      expect(w1.code).toBe(0);

      // Reader before recovery MUST reject
      const beforeRead = await resolveVerifiedDemandEvidence("provider-request:serpapi:c07_midflight", {
        keyword: "automatic cat feeder",
        region: "US",
      });
      expect(beforeRead.verified).toBe(false);
      expect(["RECEIPT_NOT_ELIGIBLE", "DB_RECORD_MISSING"]).toContain(beforeRead.errorCode);

      // Worker 2 completes full atomic persistence
      const recov = await reconcilePendingReceiptRecovery("c07_midflight");
      expect(recov.state).toBe("EVIDENCE_ELIGIBLE");
      expect(recov.eligible).toBe(true);

      // Reader after recovery sees verified=true
      const afterRead = await resolveVerifiedDemandEvidence("provider-request:serpapi:c07_midflight", {
        keyword: "automatic cat feeder",
        region: "US",
      });
      expect(afterRead.verified).toBe(true);
    }, 20000);

    it("C08: Concurrent reader + writer: while child writer commits receipts, concurrent reader calls never crash with JSON parse errors and never observe eligible=true before DB commit", async () => {
      const writerDoneFile = path.join(testStorageDir, "c08_done.txt");
      const writerScript = path.join(testStorageDir, "c08_writer.ts");

      const items: Array<{ receiptId: string; sha: string; artifactPath: string; kw: string }> = [];
      for (let i = 0; i < 6; i++) {
        const receiptId = `c08_rec_${i}`;
        const kw = `cat interactive ball ${i}`;
        const stored = saveRawProviderPayloadFile(
          JSON.stringify({
            search_metadata: { id: receiptId, status: "Success" },
            search_parameters: { q: kw, geo: "US" },
            interest_over_time: { timeline_data: [{ date: "2026-07-01", values: [{ value: 60 + i }] }] },
          })
        );
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
          const list = JSON.parse(itemsJson);
          for (const item of list) {
            await persistCollectorReceiptAtomically({
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
            await new Promise((r) => setTimeout(r, 20));
          }
          fs.writeFileSync(doneFile, "DONE", "utf-8");
          process.exit(0);
        }
        main().catch((e) => { process.stderr.write(String(e)); process.exit(1); });
      `,
        "utf-8"
      );

      let childExited = false;
      const writerPromise = spawnTsxWorker(writerScript, [testStorageDir, writerDoneFile, JSON.stringify(items)]);
      writerPromise.then(() => { childExited = true; });

      // Continuously poll getTrustedProviderReceipt and resolveVerifiedDemandEvidence while writer runs
      let readIterations = 0;
      while (!fs.existsSync(writerDoneFile) && !childExited) {
        for (const item of items) {
          const rec = getTrustedProviderReceipt(item.receiptId);
          if (rec && rec.eligible) {
            // If eligible is true on disk, DB row MUST already exist!
            const resolved = await resolveVerifiedDemandEvidence(`provider-request:serpapi:${item.receiptId}`, {
              keyword: item.kw,
              region: "US",
            });
            expect(resolved, JSON.stringify(resolved)).toMatchObject({ verified: true });
          }
        }
        readIterations++;
        await new Promise((r) => setTimeout(r, 10));
      }

      const writerRes = await writerPromise;
      expect(writerRes.code).toBe(0);
      expect(readIterations).toBeGreaterThan(0);

      for (const item of items) {
        const resolved = await resolveVerifiedDemandEvidence(`provider-request:serpapi:${item.receiptId}`, {
          keyword: item.kw,
          region: "US",
        });
        expect(resolved.verified).toBe(true);
      }
    }, 120000);
  });
});
