/**
 * KH-02 V12.4.3.7.11 — Atomic Receipt Commit & Verified Demand Readback Test Matrix
 *
 * Covers groups:
 * Group 1: Lock Protocol & Bounded Acquisition (A01 - A04)
 * Group 2: Content Hash, Idempotency & Conflict Semantics (A05 - A08)
 * Group 3: Staged Database Atomicity & Fault Injection (A09 - A12)
 * Group 4: Private Capability Token Minting & Transport Gating (A13 - A17)
 * Group 5: Controlled HTTP Transport Execution & Error Handling (A18 - A22)
 * Group 6: End-to-End Demand Readback & Authority Resolution (A23 - A28)
 * Group 7: Point-in-Time Zero-Lookahead & Historical Integrity (A29 - A33)
 * Group 8: Multi-Process OS Concurrency Proof (A34 - A36)
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs";
import path from "path";
import crypto from "crypto";
import os from "os";
import { fork, spawn } from "child_process";
import {
  createCollectorCapabilityToken,
  createTestCollectorCapabilityToken,
  getAuthorizedCollectorCapabilityToken,
  isValidCollectorCapabilityToken,
  recordProviderInvocationAttempt,
  finalizeProviderInvocationFromTransport,
  persistDurableReceipt,
  persistCollectorReceiptAtomically,
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
  setProviderReceiptStorageDirForTest,
  getProviderReceiptStorageDir,
  tryAcquireDurableLedgerLockSync,
  acquireDurableLedgerLockAsync,
  releaseDurableLedgerLock,
  registerTestControlledInvocationProof,
  type ProviderInvocationReceipt,
} from "@/services/kh02/demand/temporalDemandEngine";
import { GoogleTrendsLegacySerpApiProvider } from "@/services/kh02/demand/demandProviderRegistry";
import { resolveProductDemandHistory } from "@/services/kh02/demand/historicalDemandIngestion";
import { prisma } from "@/lib/db";

const TEST_RUN_ID = `test_run_7_11_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
const TEST_STORAGE_DIR = path.join(process.cwd(), "data", ".test_tmp", TEST_RUN_ID);

describe("KH-02 V12.4.3.7.11 — Atomic Receipt Commit & Verified Demand Readback", () => {
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
  // GROUP 1: Lock Protocol & Bounded Acquisition (A01 - A04)
  // ==========================================================================
  describe("Group 1: Lock Protocol & Bounded Acquisition", () => {
    it("A01: Lock acquisition fails closed with LOCK_TIMEOUT when lock is held by another owner", async () => {
      const ledgerPath = path.join(TEST_STORAGE_DIR, ".provider_receipt_ledger.json");
      const lockPath = `${ledgerPath}.lock`;

      // Simulate active lock held by another process
      const foreignLock = {
        ownerId: `foreign_proc_${process.pid}_${Date.now()}`,
        pid: process.pid, // active pid
        acquiredAt: Date.now(),
        expiresAt: Date.now() + 10000, // unexpired
      };
      fs.writeFileSync(lockPath, JSON.stringify(foreignLock), "utf-8");

      const res = await acquireDurableLedgerLockAsync(lockPath, 150);
      expect(res.acquired).toBe(false);
      expect(res.ownerId).toBeNull();

      // Clean up lock file
      fs.unlinkSync(lockPath);
    });

    it("A02: Non-owner release protocol prevents foreign worker from releasing active lock", () => {
      const ledgerPath = path.join(TEST_STORAGE_DIR, ".provider_receipt_ledger.json");
      const lockPath = `${ledgerPath}.lock`;

      const realOwner = "real_worker_owner_123";
      const lockData = {
        ownerId: realOwner,
        pid: process.pid,
        acquiredAt: Date.now(),
        expiresAt: Date.now() + 8000,
      };
      fs.writeFileSync(lockPath, JSON.stringify(lockData), "utf-8");

      // Attempt release by another owner
      const released = releaseDurableLedgerLock(lockPath, "imposter_worker_456");
      expect(released).toBe(false);
      expect(fs.existsSync(lockPath)).toBe(true);

      // Now release by real owner
      const realReleased = releaseDurableLedgerLock(lockPath, realOwner);
      expect(realReleased).toBe(true);
      expect(fs.existsSync(lockPath)).toBe(false);
    });

    it("A03: Stale lock with dead PID and expired lease is safely reclaimed", async () => {
      const ledgerPath = path.join(TEST_STORAGE_DIR, ".provider_receipt_ledger.json");
      const lockPath = `${ledgerPath}.lock`;

      // Write stale lock with a dead PID (e.g. 9999999) and expired lease
      const staleLock = {
        ownerId: "dead_worker",
        pid: 9999999,
        acquiredAt: Date.now() - 20000,
        expiresAt: Date.now() - 10000,
      };
      fs.writeFileSync(lockPath, JSON.stringify(staleLock), "utf-8");

      const lockRes = await acquireDurableLedgerLockAsync(lockPath, 500);
      expect(lockRes.acquired).toBe(true);
      expect(lockRes.ownerId).not.toBeNull();

      releaseDurableLedgerLock(lockPath, lockRes.ownerId);
    });

    it("A04: Zero CPU busy-spinning during sync lock attempt with bounded backoff", () => {
      const ledgerPath = path.join(TEST_STORAGE_DIR, ".provider_receipt_ledger.json");
      const lockPath = `${ledgerPath}.lock`;

      // Create active lock
      fs.writeFileSync(
        lockPath,
        JSON.stringify({ ownerId: "busy_tester", pid: process.pid, acquiredAt: Date.now(), expiresAt: Date.now() + 5000 }),
        "utf-8"
      );

      const start = Date.now();
      const res = tryAcquireDurableLedgerLockSync(lockPath, 100);
      const elapsed = Date.now() - start;

      expect(res.acquired).toBe(false);
      expect(elapsed).toBeGreaterThanOrEqual(90);

      fs.unlinkSync(lockPath);
    });
  });

  // ==========================================================================
  // GROUP 2: Content Hash, Idempotency & Conflict Semantics (A05 - A08)
  // ==========================================================================
  describe("Group 2: Content Hash, Idempotency & Conflict Semantics", () => {
    it("A05: Same receipt ID with identical SHA and metadata succeeds idempotently", async () => {
      const raw = JSON.stringify({ search_metadata: { id: "a05_idemp", status: "Success" } });
      const stored = saveRawProviderPayloadFile(raw);

      const receipt: ProviderInvocationReceipt = {
        receiptId: "a05_idemp",
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

      const res1 = await persistCollectorReceiptAtomically(receipt);
      expect(res1.state).toBe("EVIDENCE_ELIGIBLE");
      expect(res1.eligible).toBe(true);
      expect(res1.dbCommitted).toBe(true);

      const res2 = await persistCollectorReceiptAtomically(receipt);
      expect(res2.state).toBe("EVIDENCE_ELIGIBLE");
      expect(res2.idempotent).toBe(true);
      expect(res2.errorCode).toBeNull();
    });

    it("A06: Conflicting receipt with same ID but different SHA returns CONFLICT and preserves original", async () => {
      const raw1 = JSON.stringify({ id: 1, test: "original" });
      const raw2 = JSON.stringify({ id: 2, test: "imposter" });
      const s1 = saveRawProviderPayloadFile(raw1);
      const s2 = saveRawProviderPayloadFile(raw2);

      const rec1: ProviderInvocationReceipt = {
        receiptId: "a06_conflict_sha",
        provider: "google_trends_serpapi",
        originKind: "ACTUAL_PROVIDER_INVOCATION",
        targetProductOrKeyword: "cat tower",
        region: "US",
        transportStatus: 200,
        capturedAt: new Date().toISOString(),
        rawResponseSha256: s1.rawResponseSha256,
        rawByteCount: s1.byteCount,
        artifactPath: s1.artifactPath,
      };

      const rec2: ProviderInvocationReceipt = {
        ...rec1,
        rawResponseSha256: s2.rawResponseSha256,
        artifactPath: s2.artifactPath,
      };

      const res1 = await persistCollectorReceiptAtomically(rec1);
      expect(res1.state).toBe("EVIDENCE_ELIGIBLE");

      const res2 = await persistCollectorReceiptAtomically(rec2);
      expect(res2.state).toBe("CONFLICT");
      expect(res2.errorCode).toBe("RECEIPT_CONFLICT");

      // Verify stored record remained original
      clearTrustedProviderInvocationsForTest();
      const stored = getTrustedProviderReceipt("a06_conflict_sha");
      expect(stored?.rawResponseSha256).toBe(s1.rawResponseSha256);
    });

    it("A07: Conflicting receipt with differing region or provider returns CONFLICT", async () => {
      const raw = JSON.stringify({ ok: true });
      const s = saveRawProviderPayloadFile(raw);

      const recUS: ProviderInvocationReceipt = {
        receiptId: "a07_conflict_geo",
        provider: "google_trends_serpapi",
        originKind: "ACTUAL_PROVIDER_INVOCATION",
        targetProductOrKeyword: "pet carrier",
        region: "US",
        transportStatus: 200,
        capturedAt: new Date().toISOString(),
        rawResponseSha256: s.rawResponseSha256,
        rawByteCount: s.byteCount,
        artifactPath: s.artifactPath,
      };

      const recUK: ProviderInvocationReceipt = {
        ...recUS,
        region: "GB", // CONFLICTING REGION
      };

      const res1 = await persistCollectorReceiptAtomically(recUS);
      expect(res1.state).toBe("EVIDENCE_ELIGIBLE");

      const res2 = await persistCollectorReceiptAtomically(recUK);
      expect(res2.state).toBe("CONFLICT");
      expect(res2.errorCode).toBe("RECEIPT_CONFLICT");
    });

    it("A08: Readback verification failure fails closed if ledger file is modified concurrently", () => {
      const raw = JSON.stringify({ id: "a08" });
      const s = saveRawProviderPayloadFile(raw);

      const rec: ProviderInvocationReceipt = {
        receiptId: "a08_tamper",
        provider: "google_trends_serpapi",
        originKind: "ACTUAL_PROVIDER_INVOCATION",
        targetProductOrKeyword: "dog leash",
        region: "US",
        transportStatus: 200,
        capturedAt: new Date().toISOString(),
        rawResponseSha256: s.rawResponseSha256,
        rawByteCount: s.byteCount,
        artifactPath: s.artifactPath,
      };

      const res = persistDurableReceipt(rec);
      expect(res.state).toBe("LEDGER_PENDING_DB");
      expect(res.eligible).toBe(false);

      // Mutate artifact on disk after commit
      fs.writeFileSync(s.artifactPath, "tampered content", "utf-8");

      // Readback validation should detect hash mismatch
      const check = isAuthenticProviderReceiptDescriptor({
        verified: true,
        providerRequestId: "a08_tamper",
        rawResponseSha256: s.rawResponseSha256,
        artifactPath: s.artifactPath,
        region: "US",
        targetProductOrKeyword: "dog leash",
        responseStatus: 200,
      });

      expect(check.authentic).toBe(false);
      expect(check.errorCode).toBe("HASH_MISMATCH");
    });
  });

  // ==========================================================================
  // GROUP 3: Staged Database Atomicity & Fault Injection (A09 - A12)
  // ==========================================================================
  describe("Group 3: Staged Database Atomicity & Fault Injection", () => {
    it("A09: Database write rejection returns DB_WRITE_FAILED and dbCommitted=false", async () => {
      const raw = JSON.stringify({ search_metadata: { id: "a09_db_fail", status: "Success" } });
      const s = saveRawProviderPayloadFile(raw);

      const rec: ProviderInvocationReceipt = {
        receiptId: "a09_db_fail",
        provider: "google_trends_serpapi",
        originKind: "ACTUAL_PROVIDER_INVOCATION",
        targetProductOrKeyword: "pet clipper",
        region: "US",
        transportStatus: 200,
        capturedAt: new Date().toISOString(),
        rawResponseSha256: s.rawResponseSha256,
        rawByteCount: s.byteCount,
        artifactPath: s.artifactPath,
      };

      // Mock prisma failure
      const originalUpsert = prisma.researchEvidence.upsert;
      (prisma.researchEvidence as any).upsert = async () => {
        throw new Error("Simulated SQLite write lock timeout");
      };

      try {
        const res = await persistCollectorReceiptAtomically(rec);
        expect(res.state).toBe("DB_WRITE_FAILED");
        expect(res.eligible).toBe(false);
        expect(res.dbCommitted).toBe(false);
        expect(res.errorCode).toBe("DB_WRITE_FAILED");
        expect(res.errorReason).toContain("Simulated SQLite write lock timeout");
      } finally {
        prisma.researchEvidence.upsert = originalUpsert;
      }
    });

    it("A10: Database readback missing returns DB_READBACK_FAILED without granting verification", async () => {
      const raw = JSON.stringify({ search_metadata: { id: "a10_db_readback", status: "Success" } });
      const s = saveRawProviderPayloadFile(raw);

      const rec: ProviderInvocationReceipt = {
        receiptId: "a10_db_readback",
        provider: "google_trends_serpapi",
        originKind: "ACTUAL_PROVIDER_INVOCATION",
        targetProductOrKeyword: "grooming table",
        region: "US",
        transportStatus: 200,
        capturedAt: new Date().toISOString(),
        rawResponseSha256: s.rawResponseSha256,
        rawByteCount: s.byteCount,
        artifactPath: s.artifactPath,
      };

      const originalFindUnique = prisma.researchEvidence.findUnique;
      (prisma.researchEvidence as any).findUnique = async () => null; // simulate record missing on readback

      try {
        const res = await persistCollectorReceiptAtomically(rec);
        expect(res.state).toBe("DB_READBACK_FAILED");
        expect(res.eligible).toBe(false);
        expect(res.dbCommitted).toBe(false);
        expect(res.errorCode).toBe("DB_READBACK_FAILED");
      } finally {
        prisma.researchEvidence.findUnique = originalFindUnique;
      }
    });

    it("A11: Resolving non-existent evidence returns RECEIPT_NOT_FOUND", async () => {
      const res = await resolveVerifiedDemandEvidence("provider-request:serpapi:ghost_receipt_id_xyz", {
        keyword: "ghost product",
        region: "US",
      });

      expect(res.verified).toBe(false);
      expect(res.errorCode).toBe("RECEIPT_NOT_FOUND");
    });

    it("A12: Idempotent crash recovery preserves immutable disk artifact and ledger integrity", async () => {
      const raw = JSON.stringify({ search_metadata: { id: "a12_recovery", status: "Success" } });
      const s = saveRawProviderPayloadFile(raw);

      const rec: ProviderInvocationReceipt = {
        receiptId: "a12_recovery",
        provider: "google_trends_serpapi",
        originKind: "ACTUAL_PROVIDER_INVOCATION",
        targetProductOrKeyword: "pet gate",
        region: "US",
        transportStatus: 200,
        capturedAt: new Date().toISOString(),
        rawResponseSha256: s.rawResponseSha256,
        rawByteCount: s.byteCount,
        artifactPath: s.artifactPath,
      };

      // First run succeeds
      const res1 = await persistCollectorReceiptAtomically(rec);
      expect(res1.state).toBe("EVIDENCE_ELIGIBLE");
      expect(res1.eligible).toBe(true);

      // Clear memory caches to simulate process restart
      clearTrustedProviderInvocationsForTest();

      // Read back from disk ledger
      const diskRec = getTrustedProviderReceipt("a12_recovery");
      expect(diskRec).not.toBeNull();
      expect(diskRec?.rawResponseSha256).toBe(s.rawResponseSha256);
      expect(diskRec?.commitState).toBe("EVIDENCE_ELIGIBLE");
      expect(diskRec?.eligible).toBe(true);
    });
  });

  // ==========================================================================
  // GROUP 4: Private Capability Token Minting & Transport Gating (A13 - A17)
  // ==========================================================================
  describe("Group 4: Private Capability Token Minting & Transport Gating", () => {
    it("A13: Public token factory creates TEST_SIMULATION token, not live authority", () => {
      const publicToken = createCollectorCapabilityToken("random_consumer_module");
      expect(publicToken.classification).toBe("TEST_SIMULATION");
      expect(publicToken.isTestSimulation).toBe(true);
    });

    it("A14: Magic string 'trusted_server_boundary_collector' does NOT grant TRUSTED_COLLECTOR", () => {
      const forgedToken = createCollectorCapabilityToken("trusted_server_boundary_collector");
      expect(forgedToken.classification).toBe("TEST_SIMULATION");
      expect(forgedToken.isTestSimulation).toBe(true);
    });

    it("A15: Unauthorized collector name passed to getAuthorizedCollectorCapabilityToken returns TEST_SIMULATION", () => {
      const imposterToken = getAuthorizedCollectorCapabilityToken("hacker_collector");
      expect(imposterToken.classification).toBe("TEST_SIMULATION");
      expect(imposterToken.isTestSimulation).toBe(true);
    });

    it("A16: Public getAuthorizedCollectorCapabilityToken helper returns TEST_SIMULATION (no public TRUSTED_COLLECTOR factory)", () => {
      const validToken = getAuthorizedCollectorCapabilityToken("google_trends_serpapi_collector");
      expect(validToken.classification).toBe("TEST_SIMULATION");
      expect(validToken.isTestSimulation).toBe(true);
    });

    it("A17: Attempt without valid token or with mismatched provider throws error", () => {
      const token = getAuthorizedCollectorCapabilityToken("google_trends_serpapi_collector");
      const attempt = recordProviderInvocationAttempt({
        provider: "google_trends_serpapi",
        targetProductOrKeyword: "cat tunnel",
        region: "US",
      });

      expect(() => {
        finalizeProviderInvocationFromTransport(
          {
            attemptId: attempt.attemptId,
            receiptId: "a17_mismatch",
            provider: "meta_ads", // MISMATCH
            transportStatus: 200,
            rawResponseBytes: JSON.stringify({ ok: true }),
            targetProductOrKeyword: "cat tunnel",
            region: "US",
          },
          token
        );
      }).toThrow(/Provider mismatch between attempt/);
    });
  });

  // ==========================================================================
  // GROUP 5: Controlled HTTP Transport Execution & Error Handling (A18 - A22)
  // ==========================================================================
  describe("Group 5: Controlled HTTP Transport Execution & Error Handling", () => {
    it("A18: executeTrustedSerpApiDemandRequest succeeds with HTTP 200 and persists atomically", async () => {
      const attempt = recordProviderInvocationAttempt({
        provider: "google_trends_serpapi",
        targetProductOrKeyword: "dog raincoat",
        region: "US",
      });

      const mockPayload = JSON.stringify({
        search_metadata: { id: "a18_req_success", status: "Success" },
        interest_over_time: {
          timeline_data: [{ timestamp: "1720000000", values: [{ value: 75 }] }],
        },
      });

      const mockFetch: typeof fetch = async () =>
        new Response(mockPayload, {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });

      const res = await executeTrustedSerpApiDemandRequest({
        url: "https://serpapi.com/search.json?engine=google_trends&data_type=TIMESERIES&q=dog+raincoat",
        query: { term: "dog raincoat", region: "US" },
        attemptId: attempt.attemptId,
        fetchFn: mockFetch,
      });

      expect(res.success).toBe(true);
      expect(res.receipt).toBeDefined();
      expect(res.receipt?.receiptId).toBe("a18_req_success");
      expect(res.receipt?.originKind).toBe("SIMULATED_TRANSPORT");
      expect(res.persistenceResult?.state).toBe("EVIDENCE_ELIGIBLE");
      expect(res.persistenceResult?.eligible).toBe(true);
    });

    it("A19: executeTrustedSerpApiDemandRequest fails closed on HTTP 403, 429, 500", async () => {
      for (const status of [403, 429, 500]) {
        const attempt = recordProviderInvocationAttempt({
          provider: "google_trends_serpapi",
          targetProductOrKeyword: "dog harness",
          region: "US",
        });

        const mockFetch: typeof fetch = async () =>
          new Response("Server Error", { status });

        const res = await executeTrustedSerpApiDemandRequest({
          url: "https://serpapi.com/search.json?q=dog+harness",
          query: { term: "dog harness", region: "US" },
          attemptId: attempt.attemptId,
          fetchFn: mockFetch,
        });

        expect(res.success).toBe(false);
        expect(res.error).toContain(`SerpApi returned HTTP ${status}`);
      }
    });

    it("A20: executeTrustedSerpApiDemandRequest fails closed on SerpApi error JSON payload", async () => {
      const attempt = recordProviderInvocationAttempt({
        provider: "google_trends_serpapi",
        targetProductOrKeyword: "cat bowl",
        region: "US",
      });

      const errorPayload = JSON.stringify({ error: "Invalid API key or account plan expired" });
      const mockFetch: typeof fetch = async () =>
        new Response(errorPayload, { status: 200, headers: { "Content-Type": "application/json" } });

      const res = await executeTrustedSerpApiDemandRequest({
        url: "https://serpapi.com/search.json?q=cat+bowl",
        query: { term: "cat bowl", region: "US" },
        attemptId: attempt.attemptId,
        fetchFn: mockFetch,
      });

      expect(res.success).toBe(false);
      expect(res.error).toContain("SerpApi reported a query error");
    });

    it("A21: Empty HTTP response body fails closed with clear error", async () => {
      const attempt = recordProviderInvocationAttempt({
        provider: "google_trends_serpapi",
        targetProductOrKeyword: "pet brush",
        region: "US",
      });

      const mockFetch: typeof fetch = async () => new Response("", { status: 200 });

      const res = await executeTrustedSerpApiDemandRequest({
        url: "https://serpapi.com/search.json?q=pet+brush",
        query: { term: "pet brush", region: "US" },
        attemptId: attempt.attemptId,
        fetchFn: mockFetch,
      });

      expect(res.success).toBe(false);
      expect(res.error).toContain("empty response bytes");
    });

    it("A22: GoogleTrendsLegacySerpApiProvider.fetchSeries returns BLOCKED without API key", async () => {
      const origKey = process.env.SERPAPI_API_KEY;
      delete process.env.SERPAPI_API_KEY;
      try {
        const provider = new GoogleTrendsLegacySerpApiProvider();
        const res = await provider.fetchSeries({
          term: "cat tree",
          region: "US",
          startDate: new Date("2026-06-01"),
          endDate: new Date("2026-09-01"),
        });
        expect(res.status).toBe("BLOCKED");
        expect(res.error).toContain("SERPAPI_API_KEY");
      } finally {
        if (origKey) process.env.SERPAPI_API_KEY = origKey;
      }
    });
  });

  // ==========================================================================
  // GROUP 6: End-to-End Demand Readback & Authority Resolution (A23 - A28)
  // ==========================================================================
  describe("Group 6: End-to-End Demand Readback & Authority Resolution", () => {
    it("A23: Bare reference 'provider-request:serpapi:req_xxx' resolves verified descriptor when backed by receipt", async () => {
      const raw = JSON.stringify({ search_metadata: { id: "req_a23_test", status: "Success" } });
      const stored = saveRawProviderPayloadFile(raw);

      const receipt: ProviderInvocationReceipt = {
        receiptId: "req_a23_test",
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

      const proof = registerTestControlledInvocationProof({
        attemptId: "att_a23",
        receiptId: "req_a23_test",
        rawResponseSha256: stored.rawResponseSha256,
      });
      const persistRes = await persistCollectorReceiptAtomically(receipt, proof);
      expect(persistRes.state).toBe("EVIDENCE_ELIGIBLE");
      expect(persistRes.eligible).toBe(true);
      expect(persistRes.dbCommitted).toBe(true);

      const resolved = await resolveVerifiedDemandEvidence("provider-request:serpapi:req_a23_test", {
        keyword: "cat water fountain",
        region: "US",
      });

      expect(resolved.verified).toBe(true);
      expect(resolved.rawResponseSha256).toBe(stored.rawResponseSha256);
      expect(resolved.providerOriginVerified).toBe(true);
      expect(resolved.originKind).toBe("ACTUAL_PROVIDER_INVOCATION");
    });

    it("A24: evaluateDemandSourceAuthority upgrades to AUTHORITATIVE_VERIFIED when verifiedDescriptor is attached", async () => {
      const raw = JSON.stringify({ search_metadata: { id: "req_a24", status: "Success" } });
      const stored = saveRawProviderPayloadFile(raw);

      const receipt: ProviderInvocationReceipt = {
        receiptId: "req_a24",
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
      const proof = registerTestControlledInvocationProof({
        attemptId: "att_a24",
        receiptId: "req_a24",
        rawResponseSha256: stored.rawResponseSha256,
      });
      const persistRes = await persistCollectorReceiptAtomically(receipt, proof);
      expect(persistRes.state).toBe("EVIDENCE_ELIGIBLE");

      const obs = [
        {
          periodStart: "2026-07-01",
          periodEnd: "2026-07-07",
          demandValue: 70,
          region: "US",
          keyword: "cat water fountain",
          source: "Google Trends (SerpApi)",
          evidenceReference: "provider-request:serpapi:req_a24",
          verifiedDescriptor: {
            verified: true,
            providerRequestId: "req_a24",
            rawResponseSha256: stored.rawResponseSha256,
            artifactPath: stored.artifactPath,
            targetProductOrKeyword: "cat water fountain",
            region: "US",
            responseStatus: 200,
            originKind: "ACTUAL_PROVIDER_INVOCATION" as const,
            providerOriginVerified: true,
            contentIntegrityVerified: true,
          },
        },
      ];

      const auth = evaluateDemandSourceAuthority(obs as any[], { requiredRegion: "US" });
      expect(auth.authority).toBe("AUTHORITATIVE_VERIFIED");
      expect(auth.productAttributionValid).toBe(true);
    });

    it("A25: Region mismatch between receipt and context fails closed with REGION_MISMATCH", async () => {
      const raw = JSON.stringify({ search_metadata: { id: "req_a25", status: "Success" } });
      const stored = saveRawProviderPayloadFile(raw);

      const receipt: ProviderInvocationReceipt = {
        receiptId: "req_a25",
        provider: "google_trends_serpapi",
        originKind: "ACTUAL_PROVIDER_INVOCATION",
        targetProductOrKeyword: "cat collar",
        region: "US",
        transportStatus: 200,
        capturedAt: new Date().toISOString(),
        rawResponseSha256: stored.rawResponseSha256,
        rawByteCount: stored.byteCount,
        artifactPath: stored.artifactPath,
      };

      await persistCollectorReceiptAtomically(receipt);

      const resolved = await resolveVerifiedDemandEvidence("provider-request:serpapi:req_a25", {
        keyword: "cat collar",
        region: "GB", // CONTEXT REGION GB vs RECEIPT US
      });

      expect(resolved.verified).toBe(false);
      expect(resolved.errorCode).toBe("REGION_MISMATCH");
    });

    it("A26: Keyword mismatch between receipt and context fails closed with PRODUCT_MISMATCH", async () => {
      const raw = JSON.stringify({ search_metadata: { id: "req_a26", status: "Success" } });
      const stored = saveRawProviderPayloadFile(raw);

      const receipt: ProviderInvocationReceipt = {
        receiptId: "req_a26",
        provider: "google_trends_serpapi",
        originKind: "ACTUAL_PROVIDER_INVOCATION",
        targetProductOrKeyword: "cat litter box",
        region: "US",
        transportStatus: 200,
        capturedAt: new Date().toISOString(),
        rawResponseSha256: stored.rawResponseSha256,
        rawByteCount: stored.byteCount,
        artifactPath: stored.artifactPath,
      };

      await persistCollectorReceiptAtomically(receipt);

      const resolved = await resolveVerifiedDemandEvidence("provider-request:serpapi:req_a26", {
        keyword: "dog winter coat", // CONTRADICTS cat litter box
        region: "US",
      });

      expect(resolved.verified).toBe(false);
      expect(resolved.errorCode).toBe("PRODUCT_MISMATCH");
    });

    it("A27: Cross-product scope violation fails closed with PRODUCT_MISMATCH", async () => {
      const raw = JSON.stringify({ search_metadata: { id: "req_a27", status: "Success" } });
      const stored = saveRawProviderPayloadFile(raw);

      const receipt: ProviderInvocationReceipt = {
        receiptId: "req_a27",
        provider: "google_trends_serpapi",
        originKind: "ACTUAL_PROVIDER_INVOCATION",
        targetProductOrKeyword: "pet camera",
        region: "US",
        productId: "prod_111",
        transportStatus: 200,
        capturedAt: new Date().toISOString(),
        rawResponseSha256: stored.rawResponseSha256,
        rawByteCount: stored.byteCount,
        artifactPath: stored.artifactPath,
      };

      await persistCollectorReceiptAtomically(receipt);

      const resolved = await resolveVerifiedDemandEvidence("provider-request:serpapi:req_a27", {
        productId: "prod_222", // MISMATCH PRODUCT ID
        keyword: "pet camera",
        region: "US",
      });

      expect(resolved.verified).toBe(false);
      expect(resolved.errorCode).toBe("PRODUCT_MISMATCH");
    });

    it("A28: Cross-tenant workspace mismatch fails closed with RUN_MISMATCH", async () => {
      const raw = JSON.stringify({ search_metadata: { id: "req_a28", status: "Success" } });
      const stored = saveRawProviderPayloadFile(raw);

      const receipt: ProviderInvocationReceipt = {
        receiptId: "req_a28",
        provider: "google_trends_serpapi",
        originKind: "ACTUAL_PROVIDER_INVOCATION",
        targetProductOrKeyword: "dog bed",
        region: "US",
        workspaceId: "tenant_alpha",
        transportStatus: 200,
        capturedAt: new Date().toISOString(),
        rawResponseSha256: stored.rawResponseSha256,
        rawByteCount: stored.byteCount,
        artifactPath: stored.artifactPath,
      };

      await persistCollectorReceiptAtomically(receipt);

      const resolved = await resolveVerifiedDemandEvidence("provider-request:serpapi:req_a28", {
        workspaceId: "tenant_beta", // MISMATCH WORKSPACE
        keyword: "dog bed",
        region: "US",
      });

      expect(resolved.verified).toBe(false);
      expect(resolved.errorCode).toBe("RUN_MISMATCH");
    });
  });

  // ==========================================================================
  // GROUP 7: Point-in-Time Zero-Lookahead & Historical Integrity (A29 - A33)
  // ==========================================================================
  describe("Group 7: Point-in-Time Zero-Lookahead & Historical Integrity", () => {
    it("A29: Observations captured or ingested after asOf cutoff are strictly filtered out", () => {
      const observations = [
        {
          periodStart: "2026-08-01T00:00:00.000Z",
          periodEnd: "2026-08-07T00:00:00.000Z",
          demandValue: 65,
          source: "GOOGLE_TRENDS_CSV",
          keyword: "pet fountain",
          region: "US",
          evidenceReference: "sha256:04f4d039cdd4a884134914fdb9d2ed86ebbfa353991d714b78df545a96fd4b14",
          sourceCapturedAt: "2026-10-31T00:00:00.000Z", // captured after cutoff
        },
      ];

      const assessment = evaluateDemandHistoryEvidence(observations as any[], {
        asOfTimestamp: "2026-10-24T00:00:00.000Z",
        strictChronological: true,
      });

      expect(assessment.dataPointsCount).toBe(0);
      expect(assessment.status).toBe("INSUFFICIENT_HISTORY");
      expect(assessment.missingEvidence.some((m) => m.includes("as-of cutoff"))).toBe(true);
    });

    it("A30: Broad category terms are classified ESTIMATED_OR_PROXY", () => {
      const obs = [
        {
          periodStart: "2026-07-01",
          demandValue: 70,
          keyword: "pet accessories",
          source: "GOOGLE_TRENDS_CSV",
          evidenceReference: "sha256:04f4d039cdd4a884134914fdb9d2ed86ebbfa353991d714b78df545a96fd4b14",
        },
      ];

      const auth = evaluateDemandSourceAuthority(obs as any[], {
        requiredRegion: "US",
        searchTermUsed: "pet accessories",
      });
      expect(auth.authority).toBe("ESTIMATED_OR_PROXY");
    });

    it("A31: Templated synthetic demand sequence [76, 79, 77, ...] is rejected as CACHED_UNVERIFIED", () => {
      const syntheticSeries = [76, 79, 77, 81, 78, 82].map((val, idx) => ({
        periodStart: `2026-07-0${idx + 1}`,
        demandValue: val,
        keyword: "cat toy",
        source: "GOOGLE_TRENDS_CSV",
        evidenceReference: "pseudo_ref_templated_pattern",
      }));

      const auth = evaluateDemandSourceAuthority(syntheticSeries as any[], { requiredRegion: "US" });
      expect(auth.authority).toBe("CACHED_UNVERIFIED");
      expect(auth.reasons.some((r) => r.includes("templated [76, 79, 77, 81, 78, 82]"))).toBe(true);
    });

    it("A32: Cross-product family attribution mismatch is rejected as CACHED_UNVERIFIED", () => {
      const obs = [
        {
          periodStart: "2026-07-01",
          demandValue: 60,
          keyword: "automatic feeder",
          source: "GOOGLE_TRENDS_CSV",
          evidenceReference: "sha256:04f4d039cdd4a884134914fdb9d2ed86ebbfa353991d714b78df545a96fd4b14",
        },
      ];

      const auth = evaluateDemandSourceAuthority(obs as any[], {
        requiredRegion: "US",
        candidateCanonicalName: "water fountain", // MISMATCH FAMILY
      });

      expect(auth.authority).toBe("CACHED_UNVERIFIED");
      expect(auth.reasons.some((r) => r.includes("Cross-product demand mismatch"))).toBe(true);
    });

    it("A33: Series with less than 60 days covered returns INSUFFICIENT_HISTORY", () => {
      const shortSeries = [
        { periodStart: "2026-08-01", periodEnd: "2026-08-07", demandValue: 50 },
        { periodStart: "2026-08-08", periodEnd: "2026-08-14", demandValue: 60 },
        { periodStart: "2026-08-15", periodEnd: "2026-08-21", demandValue: 55 },
      ];

      const assessment = evaluateDemandHistoryEvidence(shortSeries as any[], {
        minimumDataPoints: 3,
        minimumCoveredDays: 60,
        requiredRegion: "US",
      });

      expect(assessment.status).toBe("INSUFFICIENT_HISTORY");
      expect(assessment.coveredDays).toBeLessThan(60);
      expect(assessment.eligibleForEvergreen).toBe(false);
    });
  });

  // ==========================================================================
  // GROUP 8: Multi-Process OS Concurrency Proof (A34 - A36)
  // ==========================================================================
  describe("Group 8: Multi-Process OS Concurrency Proof", () => {
    it("A34: Two real child Node processes writing disjoint receipt IDs under barrier complete with zero lost updates", async () => {
      const workerDir = path.join(os.tmpdir(), `swai_concurrency_${Date.now()}`);
      fs.mkdirSync(workerDir, { recursive: true });

      const barrierFile = path.join(workerDir, "start_barrier.txt");
      const workerScript = path.join(workerDir, "worker.ts");

      // Generate a raw payload for each worker
      const rawA = JSON.stringify({ search_metadata: { id: "rec_worker_a", status: "Success" } });
      const shaA = crypto.createHash("sha256").update(rawA).digest("hex").toLowerCase();
      fs.writeFileSync(path.join(workerDir, `${shaA}.json`), rawA, "utf-8");

      const rawB = JSON.stringify({ search_metadata: { id: "rec_worker_b", status: "Success" } });
      const shaB = crypto.createHash("sha256").update(rawB).digest("hex").toLowerCase();
      fs.writeFileSync(path.join(workerDir, `${shaB}.json`), rawB, "utf-8");

      // Write worker script that imports and executes real production persistCollectorReceiptAtomically
      const enginePath = path.resolve(process.cwd(), "src/services/kh02/demand/temporalDemandEngine.ts");
      const workerCode = `
        import fs from "fs";
        import path from "path";
        import {
          setProviderReceiptStorageDirForTest,
          persistCollectorReceiptAtomically,
        } from ${JSON.stringify(enginePath)};

        async function main() {
          const workerId = process.argv[2];
          const storageDir = process.argv[3];
          const barrierPath = process.argv[4];
          const receiptId = process.argv[5];
          const sha = process.argv[6];

          setProviderReceiptStorageDirForTest(storageDir);

          // Wait for barrier
          while (!fs.existsSync(barrierPath)) {
            await new Promise((r) => setTimeout(r, 5));
          }

          const artifactPath = path.join(storageDir, sha + ".json");
          const rawBytes = fs.readFileSync(artifactPath);
          const res = await persistCollectorReceiptAtomically({
            receiptId,
            provider: "google_trends_serpapi",
            originKind: "ACTUAL_PROVIDER_INVOCATION",
            targetProductOrKeyword: "pet fountain " + workerId,
            region: "US",
            transportStatus: 200,
            capturedAt: new Date().toISOString(),
            rawResponseSha256: sha,
            rawByteCount: rawBytes.length,
            artifactPath,
          });

          if (res.state !== "EVIDENCE_ELIGIBLE" || !res.eligible || !res.dbCommitted) {
            process.stderr.write("Worker " + workerId + " failed: " + JSON.stringify(res) + "\\n");
            process.exit(1);
          }
          process.exit(0);
        }
        main().catch((err) => {
          process.stderr.write(String(err) + "\\n");
          process.exit(1);
        });
      `;
      fs.writeFileSync(workerScript, workerCode, "utf-8");

      const tsxBin = path.resolve(process.cwd(), "node_modules/.bin/tsx");
      // Spawn worker A and worker B calling real production persistCollectorReceiptAtomically
      const runWorker = (id: string, receiptId: string, sha: string) =>
        new Promise<number>((resolve) => {
          const child = spawn(tsxBin, [workerScript, id, workerDir, barrierFile, receiptId, sha], {
            cwd: process.cwd(),
            env: { ...process.env },
            stdio: "pipe",
          });
          child.on("exit", (code) => resolve(code ?? 1));
        });

      const workerAPromise = runWorker("A", "rec_worker_a", shaA);
      const workerBPromise = runWorker("B", "rec_worker_b", shaB);

      // Release barrier so both workers run concurrently
      fs.writeFileSync(barrierFile, "GO", "utf-8");

      const [codeA, codeB] = await Promise.all([workerAPromise, workerBPromise]);
      expect(codeA).toBe(0);
      expect(codeB).toBe(0);

      // Verify ledger has BOTH records in EVIDENCE_ELIGIBLE state
      const ledgerPath = path.join(workerDir, ".provider_receipt_ledger.json");
      expect(fs.existsSync(ledgerPath)).toBe(true);
      const finalLedger = JSON.parse(fs.readFileSync(ledgerPath, "utf-8"));
      expect(finalLedger.rec_worker_a).toBeDefined();
      expect(finalLedger.rec_worker_a.rawResponseSha256).toBe(shaA);
      expect(finalLedger.rec_worker_a.commitState).toBe("EVIDENCE_ELIGIBLE");
      expect(finalLedger.rec_worker_a.eligible).toBe(true);
      expect(finalLedger.rec_worker_b).toBeDefined();
      expect(finalLedger.rec_worker_b.rawResponseSha256).toBe(shaB);
      expect(finalLedger.rec_worker_b.commitState).toBe("EVIDENCE_ELIGIBLE");
      expect(finalLedger.rec_worker_b.eligible).toBe(true);

      // Clean up temp dir
      try {
        fs.rmSync(workerDir, { recursive: true, force: true });
      } catch {}
    }, 15000);

    it("A35: Competing writers with conflicting SHA report conflict and avoid ledger corruption", async () => {
      const raw1 = JSON.stringify({ write: 1 });
      const raw2 = JSON.stringify({ write: 2 });
      const s1 = saveRawProviderPayloadFile(raw1);
      const s2 = saveRawProviderPayloadFile(raw2);

      const r1: ProviderInvocationReceipt = {
        receiptId: "a35_compete",
        provider: "google_trends_serpapi",
        originKind: "ACTUAL_PROVIDER_INVOCATION",
        targetProductOrKeyword: "pet bed",
        region: "US",
        transportStatus: 200,
        capturedAt: new Date().toISOString(),
        rawResponseSha256: s1.rawResponseSha256,
        rawByteCount: s1.byteCount,
        artifactPath: s1.artifactPath,
      };

      const r2: ProviderInvocationReceipt = {
        ...r1,
        rawResponseSha256: s2.rawResponseSha256,
        artifactPath: s2.artifactPath,
      };

      const p1 = persistCollectorReceiptAtomically(r1);
      const p2 = persistCollectorReceiptAtomically(r2);

      const results = await Promise.all([p1, p2]);
      const states = results.map((r) => r.state).sort();

      // One should be EVIDENCE_ELIGIBLE and the other CONFLICT
      expect(states).toContain("CONFLICT");
      expect(states).toContain("EVIDENCE_ELIGIBLE");

      // Verify disk ledger is valid parseable JSON
      const ledgerPath = path.join(TEST_STORAGE_DIR, ".provider_receipt_ledger.json");
      const diskContent = JSON.parse(fs.readFileSync(ledgerPath, "utf-8"));
      expect(diskContent.a35_compete).toBeDefined();
    });

    it("A36: Child worker holding lock causes competing attempt to return LOCK_TIMEOUT cleanly", async () => {
      const ledgerPath = path.join(TEST_STORAGE_DIR, ".provider_receipt_ledger.json");
      const lockPath = `${ledgerPath}.lock`;

      // Hold lock
      const heldLock = {
        ownerId: "parent_holding_lock",
        pid: process.pid,
        acquiredAt: Date.now(),
        expiresAt: Date.now() + 8000,
      };
      fs.writeFileSync(lockPath, JSON.stringify(heldLock), "utf-8");

      const raw = JSON.stringify({ data: "timeout_test" });
      const s = saveRawProviderPayloadFile(raw);

      const rec: ProviderInvocationReceipt = {
        receiptId: "a36_timeout_rec",
        provider: "google_trends_serpapi",
        originKind: "ACTUAL_PROVIDER_INVOCATION",
        targetProductOrKeyword: "pet brush",
        region: "US",
        transportStatus: 200,
        capturedAt: new Date().toISOString(),
        rawResponseSha256: s.rawResponseSha256,
        rawByteCount: s.byteCount,
        artifactPath: s.artifactPath,
      };

      // Persistence must fail closed with LOCK_TIMEOUT
      const res = persistDurableReceipt(rec);
      expect(res.state).toBe("LOCK_TIMEOUT");
      expect(res.eligible).toBe(false);
      expect(res.errorCode).toBe("LOCK_TIMEOUT");

      // Release lock
      fs.unlinkSync(lockPath);
    });
  });
});
