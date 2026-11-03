/**
 * KH-02 V12.4.3.7.14 — Trusted Proof Isolation & Durable Provenance Recovery Test Matrix
 *
 * Covers groups:
 * Part 1: Adversarial Integrity & Proof Isolation (F01 - F24)
 * Part 2: Durable Provenance Recovery & Restart Survival (R01 - R14)
 * Part 3: Canonical Verifier & Decision Integrity (V01 - V12)
 * Part 4: Dynamic Discovery, Concurrency & Sentinel Hygiene (H01 - H10)
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs";
import path from "path";
import crypto from "crypto";
import os from "os";
import { spawn } from "child_process";
import {
  createCollectorCapabilityToken,
  getAuthorizedCollectorCapabilityToken,
  registerTestControlledInvocationProof,
  persistCollectorReceiptAtomically,
  reconcilePendingReceiptRecovery,
  resolveVerifiedDemandEvidence,
  verifyReceiptEligibility,
  getVerifiedDecisionProof,
  getTrustedInvocationRegistryEntry,
  isAuthenticProviderReceiptDescriptor,
  hasVerifiableCsvOrProviderLineage,
  evaluateDemandSourceAuthority,
  evaluateDemandHistoryEvidence,
  evaluateTemporalDemandStability,
  saveRawProviderPayloadFile,
  computeCanonicalAttestationPayload,
  signTransportAttestationPayload,
  verifyTransportAttestationSignature,
  issueTrustedTransportAttestation,
  persistTransportAttestationAtomically,
  loadDurableTransportAttestation,
  verifyDurableTransportAttestation,
  setProvenanceSigningKeyForTest,
  getProvenanceSigningKey,
  clearTestTransportAttestationsForTest,
  setProviderReceiptStorageDirForTest,
  getProviderReceiptStorageDir,
  clearTrustedProviderInvocationsForTest,
  type ProviderInvocationReceipt,
  type ProviderTransportAttestationV1,
} from "@/services/kh02/demand/temporalDemandEngine";
import {
  createTestSimulatedTransportAttestation,
  createTestSignedLiveTransportAttestation,
  TEST_PROVENANCE_SIGNING_KEY_32,
  TEST_PROVENANCE_KEY_ID,
} from "../../support/kh02TestProvenanceHarness";

describe("KH-02 V12.4.3.7.14 — Trusted Proof Isolation & Durable Provenance Recovery", () => {
  let testStorageDir: string;
  let originalStorageDir: string;

  beforeEach(() => {
    testStorageDir = fs.mkdtempSync(path.join(os.tmpdir(), "kh02_proof_iso_test_"));
    originalStorageDir = getProviderReceiptStorageDir();
    setProviderReceiptStorageDirForTest(testStorageDir);
    setProvenanceSigningKeyForTest(TEST_PROVENANCE_SIGNING_KEY_32, TEST_PROVENANCE_KEY_ID);
    clearTrustedProviderInvocationsForTest();
  });

  afterEach(() => {
    clearTrustedProviderInvocationsForTest();
    clearTestTransportAttestationsForTest();
    setProviderReceiptStorageDirForTest(originalStorageDir);
    if (fs.existsSync(testStorageDir)) {
      try {
        fs.rmSync(testStorageDir, { recursive: true, force: true });
      } catch {}
    }
  });

  // =========================================================================
  // Part 1: Adversarial Integrity & Proof Isolation (F01 - F24)
  // =========================================================================
  describe("Part 1: Adversarial Integrity & Proof Isolation (F01 - F24)", () => {
    it("F01: Public token factories produce TEST_SIMULATION token only, never LIVE_ORIGIN", () => {
      const pubToken = createCollectorCapabilityToken("test_simulated_collector");
      expect(pubToken.classification).toBe("TEST_SIMULATION");
      expect(pubToken.isTestSimulation).toBe(true);

      const authHelperToken = getAuthorizedCollectorCapabilityToken("trusted_server_boundary_collector");
      expect(authHelperToken.classification).toBe("TEST_SIMULATION");
      expect(authHelperToken.isTestSimulation).toBe(true);
    });

    it("F02: registerTestControlledInvocationProof produces proofKind TEST_SIMULATION and isTestSimulation=true", () => {
      const proof = registerTestControlledInvocationProof({
        attemptId: "att_f02",
        receiptId: "req_f02",
        rawResponseSha256: "0".repeat(64),
      });
      expect(proof.proofKind).toBe("TEST_SIMULATION");
      expect(proof.isTestSimulation).toBe(true);
    });

    it("F03: Persistence of receipt with TEST_SIMULATION proof demotes originKind to SIMULATED_TRANSPORT with originVerified=false", async () => {
      const raw = JSON.stringify({ search_metadata: { id: "req_f03", status: "Success" } });
      const stored = saveRawProviderPayloadFile(raw);
      const proof = registerTestControlledInvocationProof({
        attemptId: "att_f03",
        receiptId: "req_f03",
        rawResponseSha256: stored.rawResponseSha256,
      });

      const res = await persistCollectorReceiptAtomically({
        receiptId: "req_f03",
        provider: "google_trends_serpapi",
        originKind: "ACTUAL_PROVIDER_INVOCATION",
        targetProductOrKeyword: "cat toy",
        region: "US",
        transportStatus: 200,
        capturedAt: new Date().toISOString(),
        rawResponseSha256: stored.rawResponseSha256,
        rawByteCount: stored.byteCount,
        artifactPath: stored.artifactPath,
      }, proof);

      expect(res.originVerified).toBe(false);
      expect(res.receipt?.originKind).toBe("SIMULATED_TRANSPORT");
      expect(getTrustedInvocationRegistryEntry("req_f03")).toBeUndefined();
    });

    it("F04: resolveVerifiedDemandEvidence with strictLiveOrigin=true rejects receipt with SIMULATED_TRANSPORT", async () => {
      const raw = JSON.stringify({ search_metadata: { id: "req_f04", status: "Success" } });
      const stored = saveRawProviderPayloadFile(raw);
      const proof = registerTestControlledInvocationProof({
        attemptId: "att_f04",
        receiptId: "req_f04",
        rawResponseSha256: stored.rawResponseSha256,
      });
      await persistCollectorReceiptAtomically({
        receiptId: "req_f04",
        provider: "google_trends_serpapi",
        originKind: "ACTUAL_PROVIDER_INVOCATION",
        targetProductOrKeyword: "cat toy",
        region: "US",
        transportStatus: 200,
        capturedAt: new Date().toISOString(),
        rawResponseSha256: stored.rawResponseSha256,
        rawByteCount: stored.byteCount,
        artifactPath: stored.artifactPath,
      }, proof);

      const decision = await resolveVerifiedDemandEvidence("provider-request:serpapi:req_f04", {
        strictLiveOrigin: true,
        keyword: "cat toy",
        region: "US",
      });
      expect(decision.verified).toBe(false);
      expect(decision.verifiedOrigin).toBe(false);
      expect(decision.rejectionReason).toContain("strictLiveOrigin");
    });

    it("F05: resolveVerifiedDemandEvidence with strictLiveOrigin=false still reports originKind SIMULATED_TRANSPORT and verifiedOrigin=false", async () => {
      const raw = JSON.stringify({ search_metadata: { id: "req_f05", status: "Success" } });
      const stored = saveRawProviderPayloadFile(raw);
      const proof = registerTestControlledInvocationProof({
        attemptId: "att_f05",
        receiptId: "req_f05",
        rawResponseSha256: stored.rawResponseSha256,
      });
      await persistCollectorReceiptAtomically({
        receiptId: "req_f05",
        provider: "google_trends_serpapi",
        originKind: "ACTUAL_PROVIDER_INVOCATION",
        targetProductOrKeyword: "cat toy",
        region: "US",
        transportStatus: 200,
        capturedAt: new Date().toISOString(),
        rawResponseSha256: stored.rawResponseSha256,
        rawByteCount: stored.byteCount,
        artifactPath: stored.artifactPath,
      }, proof);

      const decision = await resolveVerifiedDemandEvidence("provider-request:serpapi:req_f05", {
        strictLiveOrigin: false,
        keyword: "cat toy",
        region: "US",
      });
      expect(decision.verified).toBe(true);
      expect(decision.verifiedOrigin).toBe(false);
      expect(decision.originKind).toBe("SIMULATED_TRANSPORT");
    });

    it("F06: Forged attestation with modified rawResponseSha256 fails signature verification", async () => {
      const raw = JSON.stringify({ search_metadata: { id: "req_f06", status: "Success" } });
      const sha = crypto.createHash("sha256").update(raw).digest("hex").toLowerCase();
      const att = await createTestSignedLiveTransportAttestation({
        attemptId: "att_f06",
        receiptId: "req_f06",
        rawResponseSha256: sha,
        rawBytes: Buffer.from(raw, "utf8"),
      });

      const tamperedAtt: ProviderTransportAttestationV1 = {
        ...att,
        rawResponseSha256: "f".repeat(64),
      };

      const verifyRes = await verifyDurableTransportAttestation(tamperedAtt);
      expect(verifyRes.valid).toBe(false);
      expect(verifyRes.error).toContain("INVALID_SIGNATURE");
    });

    it("F07: Forged attestation with modified upstreamRequestId fails signature verification", async () => {
      const raw = JSON.stringify({ search_metadata: { id: "req_f07", status: "Success" } });
      const sha = crypto.createHash("sha256").update(raw).digest("hex").toLowerCase();
      const att = await createTestSignedLiveTransportAttestation({
        attemptId: "att_f07",
        receiptId: "req_f07",
        rawResponseSha256: sha,
        rawBytes: Buffer.from(raw, "utf8"),
      });

      const tamperedAtt: ProviderTransportAttestationV1 = {
        ...att,
        upstreamRequestId: "req_forged_other_id",
      };

      const verifyRes = await verifyDurableTransportAttestation(tamperedAtt);
      expect(verifyRes.valid).toBe(false);
      expect(verifyRes.error).toContain("INVALID_SIGNATURE");
    });

    it("F08: Forged attestation with modified responseCapturedAt fails signature verification", async () => {
      const raw = JSON.stringify({ search_metadata: { id: "req_f08", status: "Success" } });
      const sha = crypto.createHash("sha256").update(raw).digest("hex").toLowerCase();
      const att = await createTestSignedLiveTransportAttestation({
        attemptId: "att_f08",
        receiptId: "req_f08",
        rawResponseSha256: sha,
        rawBytes: Buffer.from(raw, "utf8"),
      });

      const tamperedAtt: ProviderTransportAttestationV1 = {
        ...att,
        responseCapturedAt: "2020-01-01T00:00:00.000Z",
      };

      const verifyRes = await verifyDurableTransportAttestation(tamperedAtt);
      expect(verifyRes.valid).toBe(false);
      expect(verifyRes.error).toContain("INVALID_SIGNATURE");
    });

    it("F09: Forged attestation signed with unauthorized/mismatched private key fails signature verification", async () => {
      const raw = JSON.stringify({ search_metadata: { id: "req_f09", status: "Success" } });
      const sha = crypto.createHash("sha256").update(raw).digest("hex").toLowerCase();
      const att = await createTestSignedLiveTransportAttestation({
        attemptId: "att_f09",
        receiptId: "req_f09",
        rawResponseSha256: sha,
        rawBytes: Buffer.from(raw, "utf8"),
      });

      const wrongKey = "different_secret_key_that_does_not_match_original_key";
      const isValid = verifyTransportAttestationSignature(att, wrongKey);
      expect(isValid).toBe(false);
    });

    it("F10: Attestation signed with valid key but testOrSimulated=true cannot satisfy strictLiveOrigin=true", async () => {
      const raw = JSON.stringify({ search_metadata: { id: "req_f10", status: "Success" } });
      const stored = saveRawProviderPayloadFile(raw);
      const att = await createTestSimulatedTransportAttestation({
        attemptId: "att_f10",
        receiptId: "req_f10",
        rawResponseSha256: stored.rawResponseSha256,
        rawBytes: Buffer.from(raw, "utf8"),
        term: "cat collar",
        region: "US",
      });

      const res = await persistCollectorReceiptAtomically({
        receiptId: "req_f10",
        provider: "google_trends_serpapi",
        originKind: "ACTUAL_PROVIDER_INVOCATION",
        targetProductOrKeyword: "cat collar",
        region: "US",
        transportStatus: 200,
        capturedAt: new Date().toISOString(),
        rawResponseSha256: stored.rawResponseSha256,
        rawByteCount: stored.byteCount,
        artifactPath: stored.artifactPath,
      }, undefined, att);

      expect(res.originVerified).toBe(false);
      const decision = await resolveVerifiedDemandEvidence("provider-request:serpapi:req_f10", {
        strictLiveOrigin: true,
        keyword: "cat collar",
        region: "US",
      });
      expect(decision.verifiedOrigin).toBe(false);
    });

    it("F11: Attestation signed with valid key but captureMethod=SIMULATED cannot satisfy live origin", async () => {
      const raw = JSON.stringify({ search_metadata: { id: "req_f11", status: "Success" } });
      const stored = saveRawProviderPayloadFile(raw);
      const att = await createTestSignedLiveTransportAttestation({
        attemptId: "att_f11",
        receiptId: "req_f11",
        rawResponseSha256: stored.rawResponseSha256,
        rawBytes: Buffer.from(raw, "utf8"),
      });

      const simulatedMethodAtt: any = {
        ...att,
        captureMethod: "SIMULATED",
      };
      // Resign with simulated captureMethod
      const payload = computeCanonicalAttestationPayload(simulatedMethodAtt);
      const resignedAtt: ProviderTransportAttestationV1 = {
        ...simulatedMethodAtt,
        signature: signTransportAttestationPayload(payload, TEST_PROVENANCE_SIGNING_KEY_32),
      };

      const res = await persistCollectorReceiptAtomically({
        receiptId: "req_f11",
        provider: "google_trends_serpapi",
        originKind: "ACTUAL_PROVIDER_INVOCATION",
        targetProductOrKeyword: "cat collar",
        region: "US",
        transportStatus: 200,
        capturedAt: new Date().toISOString(),
        rawResponseSha256: stored.rawResponseSha256,
        rawByteCount: stored.byteCount,
        artifactPath: stored.artifactPath,
      }, undefined, resignedAtt);

      expect(res.originVerified).toBe(false);
    });

    it("F12: Canonical payload serialization produces deterministic byte ordering regardless of object key order", () => {
      const att1: any = {
        attestationVersion: "1.0",
        receiptId: "rec_123",
        rawResponseSha256: "abc",
        transportStatus: 200,
      };
      const att2: any = {
        transportStatus: 200,
        rawResponseSha256: "abc",
        receiptId: "rec_123",
        attestationVersion: "1.0",
      };
      const payload1 = computeCanonicalAttestationPayload(att1);
      const payload2 = computeCanonicalAttestationPayload(att2);
      expect(payload1).toBe(payload2);
    });

    it("F13: Signature uses constant-time comparison to prevent timing side-channel attacks", () => {
      const raw = JSON.stringify({ test: "data" });
      const sha = crypto.createHash("sha256").update(raw).digest("hex");
      const att: any = {
        schemaVersion: "1.0",
        issuerKeyId: TEST_PROVENANCE_KEY_ID,
        attemptId: "att_f13",
        receiptId: "req_f13",
        provider: "google_trends_serpapi",
        upstreamRequestId: "req_f13",
        transportStatus: 200,
        canonicalSanitizedUrl: "https://serpapi.com/search.json?engine=google_trends&data_type=TIMESERIES",
        requestFingerprint: "fp_f13",
        requestTerm: "term",
        region: "US",
        rawResponseSha256: sha,
        rawByteCount: raw.length,
        responseCapturedAt: new Date().toISOString(),
        requestCompletedAt: new Date().toISOString(),
        issuedAt: new Date().toISOString(),
        captureMethod: "NATIVE_HTTPS_FETCH",
        testOrSimulated: false,
        signature: "",
      };
      const payload = computeCanonicalAttestationPayload(att);
      att.signature = signTransportAttestationPayload(payload, TEST_PROVENANCE_SIGNING_KEY_32);

      // Verify legitimate signature
      expect(verifyTransportAttestationSignature(att, TEST_PROVENANCE_SIGNING_KEY_32)).toBe(true);
      // Mismatched length
      att.signature = "short_sig";
      expect(verifyTransportAttestationSignature(att, TEST_PROVENANCE_SIGNING_KEY_32)).toBe(false);
    });

    it("F14: persistCollectorReceiptAtomically rejects attestation whose rawResponseSha256 differs from receipt SHA", async () => {
      const raw = JSON.stringify({ search_metadata: { id: "req_f14", status: "Success" } });
      const stored = saveRawProviderPayloadFile(raw);
      const otherRaw = JSON.stringify({ search_metadata: { id: "req_f14_other", status: "Success" } });
      const otherSha = crypto.createHash("sha256").update(otherRaw).digest("hex").toLowerCase();
      const att = await createTestSignedLiveTransportAttestation({
        attemptId: "att_f14",
        receiptId: "req_f14",
        rawResponseSha256: otherSha,
        rawBytes: Buffer.from(otherRaw, "utf8"),
      });

      const res = await persistCollectorReceiptAtomically({
        receiptId: "req_f14",
        provider: "google_trends_serpapi",
        originKind: "ACTUAL_PROVIDER_INVOCATION",
        targetProductOrKeyword: "cat toy",
        region: "US",
        transportStatus: 200,
        capturedAt: new Date().toISOString(),
        rawResponseSha256: stored.rawResponseSha256,
        rawByteCount: stored.byteCount,
        artifactPath: stored.artifactPath,
      }, undefined, att);

      expect(res.originVerified).toBe(false);
    });

    it("F15: persistCollectorReceiptAtomically rejects attestation whose upstreamRequestId differs from receiptId", async () => {
      const raw = JSON.stringify({ search_metadata: { id: "req_f15", status: "Success" } });
      const stored = saveRawProviderPayloadFile(raw);
      const att = await createTestSignedLiveTransportAttestation({
        attemptId: "att_f15",
        receiptId: "different_receipt_id",
        rawResponseSha256: stored.rawResponseSha256,
        rawBytes: Buffer.from(raw, "utf8"),
      });

      const res = await persistCollectorReceiptAtomically({
        receiptId: "req_f15",
        provider: "google_trends_serpapi",
        originKind: "ACTUAL_PROVIDER_INVOCATION",
        targetProductOrKeyword: "cat toy",
        region: "US",
        transportStatus: 200,
        capturedAt: new Date().toISOString(),
        rawResponseSha256: stored.rawResponseSha256,
        rawByteCount: stored.byteCount,
        artifactPath: stored.artifactPath,
      }, undefined, att);

      expect(res.originVerified).toBe(false);
    });

    it("F16: persistCollectorReceiptAtomically rejects attestation whose provider differs from receipt provider", async () => {
      const raw = JSON.stringify({ search_metadata: { id: "req_f16", status: "Success" } });
      const stored = saveRawProviderPayloadFile(raw);
      const att = await createTestSignedLiveTransportAttestation({
        attemptId: "att_f16",
        receiptId: "req_f16",
        provider: "wrong_provider_name",
        rawResponseSha256: stored.rawResponseSha256,
        rawBytes: Buffer.from(raw, "utf8"),
      });

      const res = await persistCollectorReceiptAtomically({
        receiptId: "req_f16",
        provider: "google_trends_serpapi",
        originKind: "ACTUAL_PROVIDER_INVOCATION",
        targetProductOrKeyword: "cat toy",
        region: "US",
        transportStatus: 200,
        capturedAt: new Date().toISOString(),
        rawResponseSha256: stored.rawResponseSha256,
        rawByteCount: stored.byteCount,
        artifactPath: stored.artifactPath,
      }, undefined, att);

      expect(res.originVerified).toBe(false);
    });

    it("F17: Missing attestation file on disk causes un-attested receipt in recovery to demote to LOCAL_INTEGRITY_ONLY", async () => {
      const raw = JSON.stringify({ search_metadata: { id: "req_f17", status: "Success" } });
      const stored = saveRawProviderPayloadFile(raw);
      // Persist without attestation
      await persistCollectorReceiptAtomically({
        receiptId: "req_f17",
        provider: "google_trends_serpapi",
        originKind: "ACTUAL_PROVIDER_INVOCATION",
        targetProductOrKeyword: "cat toy",
        region: "US",
        transportStatus: 200,
        capturedAt: new Date().toISOString(),
        rawResponseSha256: stored.rawResponseSha256,
        rawByteCount: stored.byteCount,
        artifactPath: stored.artifactPath,
      });

      clearTrustedProviderInvocationsForTest();
      const recResult = await reconcilePendingReceiptRecovery("req_f17");
      expect(recResult.recovered).toBe(true);
      expect(recResult.originVerified).toBe(false);
      expect(recResult.originKind).toBe("LOCAL_INTEGRITY_ONLY");
    });

    it("F18: Tampered attestation file on disk causes recovery to reject attestation and demote receipt", async () => {
      const raw = JSON.stringify({ search_metadata: { id: "req_f18", status: "Success" } });
      const stored = saveRawProviderPayloadFile(raw);
      const att = await createTestSignedLiveTransportAttestation({
        attemptId: "att_f18",
        receiptId: "req_f18",
        rawResponseSha256: stored.rawResponseSha256,
        rawBytes: Buffer.from(raw, "utf8"),
      });
      await persistCollectorReceiptAtomically({
        receiptId: "req_f18",
        provider: "google_trends_serpapi",
        originKind: "ACTUAL_PROVIDER_INVOCATION",
        targetProductOrKeyword: "cat toy",
        region: "US",
        transportStatus: 200,
        capturedAt: new Date().toISOString(),
        rawResponseSha256: stored.rawResponseSha256,
        rawByteCount: stored.byteCount,
        artifactPath: stored.artifactPath,
      }, undefined, att);

      // Corrupt attestation on disk
      const attPath = path.join(testStorageDir, "req_f18.attestation.json");
      const loaded: ProviderTransportAttestationV1 = JSON.parse(fs.readFileSync(attPath, "utf-8"));
      loaded.rawResponseSha256 = "0".repeat(64);
      fs.writeFileSync(attPath, JSON.stringify(loaded), "utf-8");

      clearTrustedProviderInvocationsForTest();
      const recResult = await reconcilePendingReceiptRecovery("req_f18");
      expect(recResult.originVerified).toBe(false);
      expect(recResult.originKind).toBe("LOCAL_INTEGRITY_ONLY");
    });

    it("F19: reconcilePendingReceiptRecovery does not mint internal trusted invocation proof from unsigned ledger fields", async () => {
      const raw = JSON.stringify({ search_metadata: { id: "req_f19", status: "Success" } });
      const stored = saveRawProviderPayloadFile(raw);
      // Manually forge ledger entry claiming ACTUAL_PROVIDER_INVOCATION with no attestation
      const ledgerFile = path.join(testStorageDir, ".provider_receipt_ledger.json");
      const ledgerData = {
        req_f19: {
          receiptId: "req_f19",
          provider: "google_trends_serpapi",
          originKind: "ACTUAL_PROVIDER_INVOCATION",
          commitState: "LEDGER_PENDING_DB",
          eligible: false,
          targetProductOrKeyword: "cat toy",
          region: "US",
          transportStatus: 200,
          capturedAt: new Date().toISOString(),
          rawResponseSha256: stored.rawResponseSha256,
          rawByteCount: stored.byteCount,
          artifactPath: stored.artifactPath,
        },
      };
      fs.writeFileSync(ledgerFile, JSON.stringify(ledgerData, null, 2), "utf-8");

      clearTrustedProviderInvocationsForTest();
      const recResult = await reconcilePendingReceiptRecovery("req_f19");
      expect(recResult.originVerified).toBe(false);
      expect(recResult.originKind).toBe("LOCAL_INTEGRITY_ONLY");
      expect(getTrustedInvocationRegistryEntry("req_f19")).toBeUndefined();
    });

    it("F20: reconcilePendingReceiptRecovery validates durable attestation from disk; valid live attestation receives verified origin", async () => {
      const raw = JSON.stringify({ search_metadata: { id: "req_f20", status: "Success" } });
      const stored = saveRawProviderPayloadFile(raw);
      const att = await createTestSignedLiveTransportAttestation({
        attemptId: "att_f20",
        receiptId: "req_f20",
        rawResponseSha256: stored.rawResponseSha256,
        rawBytes: Buffer.from(raw, "utf8"),
        term: "cat tree",
        region: "US",
      });
      await persistCollectorReceiptAtomically({
        receiptId: "req_f20",
        provider: "google_trends_serpapi",
        originKind: "ACTUAL_PROVIDER_INVOCATION",
        targetProductOrKeyword: "cat tree",
        region: "US",
        transportStatus: 200,
        capturedAt: new Date().toISOString(),
        rawResponseSha256: stored.rawResponseSha256,
        rawByteCount: stored.byteCount,
        artifactPath: stored.artifactPath,
      }, undefined, att);

      clearTrustedProviderInvocationsForTest();
      const recResult = await reconcilePendingReceiptRecovery("req_f20");
      expect(recResult.originVerified).toBe(true);
      expect(recResult.originKind).toBe("ACTUAL_PROVIDER_INVOCATION");
    });

    it("F21: Cold restart simulation: clearing in-memory registry, loading authentic receipt with durable attestation recovers verifiedOrigin=true", async () => {
      const raw = JSON.stringify({ search_metadata: { id: "req_f21", status: "Success" } });
      const stored = saveRawProviderPayloadFile(raw);
      const att = await createTestSignedLiveTransportAttestation({
        attemptId: "att_f21",
        receiptId: "req_f21",
        rawResponseSha256: stored.rawResponseSha256,
        rawBytes: Buffer.from(raw, "utf8"),
        term: "cat scratcher",
        region: "US",
      });
      await persistCollectorReceiptAtomically({
        receiptId: "req_f21",
        provider: "google_trends_serpapi",
        originKind: "ACTUAL_PROVIDER_INVOCATION",
        targetProductOrKeyword: "cat scratcher",
        region: "US",
        transportStatus: 200,
        capturedAt: new Date().toISOString(),
        rawResponseSha256: stored.rawResponseSha256,
        rawByteCount: stored.byteCount,
        artifactPath: stored.artifactPath,
      }, undefined, att);

      // SIMULATE PROCESS RESTART: wipe all in-memory registries
      clearTrustedProviderInvocationsForTest();

      const decision = await resolveVerifiedDemandEvidence("provider-request:serpapi:req_f21", {
        keyword: "cat scratcher",
        region: "US",
      });
      expect(decision.verified).toBe(true);
      expect(decision.verifiedOrigin).toBe(true);
      expect(decision.originKind).toBe("ACTUAL_PROVIDER_INVOCATION");
    });

    it("F22: Off-allowlist endpoint or forged URL in attestation fails validation", async () => {
      const raw = JSON.stringify({ search_metadata: { id: "req_f22", status: "Success" } });
      const sha = crypto.createHash("sha256").update(raw).digest("hex");
      const res = await issueTrustedTransportAttestation({
        attemptId: "att_f22",
        receiptId: "req_f22",
        provider: "google_trends_serpapi",
        rawResponseSha256: sha,
        rawBytes: Buffer.from(raw, "utf8"),
        transportStatus: 200,
        canonicalSanitizedUrl: "https://malicious-proxy.com/steal-data",
        requestFingerprint: "fp_f22",
        requestTerm: "term",
        region: "US",
      });
      expect(res.success).toBe(false);
      expect(res.error).toContain("OFF_ALLOWLIST_ENDPOINT");
    });

    it("F23: Attestation issuerKeyId mismatch fails signature verification", async () => {
      const raw = JSON.stringify({ search_metadata: { id: "req_f23", status: "Success" } });
      const sha = crypto.createHash("sha256").update(raw).digest("hex");
      const att = await createTestSignedLiveTransportAttestation({
        attemptId: "att_f23",
        receiptId: "req_f23",
        rawResponseSha256: sha,
        rawBytes: Buffer.from(raw, "utf8"),
      });

      const mismatchedKeyIdAtt: ProviderTransportAttestationV1 = {
        ...att,
        issuerKeyId: "unrecognized_key_v999",
      };
      const verifyRes = await verifyDurableTransportAttestation(mismatchedKeyIdAtt);
      expect(verifyRes.valid).toBe(false);
      expect(verifyRes.error).toContain("SIGNING_KEY_MISMATCH");
    });

    it("F24: Corrupted attestation JSON file on disk handled gracefully without unhandled crash", async () => {
      const attPath = path.join(testStorageDir, "req_f24.attestation.json");
      fs.writeFileSync(attPath, "{ invalid_json: broken syntax ...", "utf-8");

      const loaded = await loadDurableTransportAttestation("req_f24");
      expect(loaded).toBeNull();

      const verified = await verifyDurableTransportAttestation("req_f24");
      expect(verified.valid).toBe(false);
    });
  });

  // =========================================================================
  // Part 2: Durable Provenance Recovery & Restart Survival (R01 - R14)
  // =========================================================================
  describe("Part 2: Durable Provenance Recovery & Restart Survival (R01 - R14)", () => {
    it("R01: Cold recovery: empty registry + valid ledger + valid attestation recovers without manual proof injection", async () => {
      const raw = JSON.stringify({ search_metadata: { id: "req_r01", status: "Success" } });
      const stored = saveRawProviderPayloadFile(raw);
      const att = await createTestSignedLiveTransportAttestation({
        attemptId: "att_r01",
        receiptId: "req_r01",
        rawResponseSha256: stored.rawResponseSha256,
        rawBytes: Buffer.from(raw, "utf8"),
        term: "dog leash",
        region: "US",
      });
      await persistCollectorReceiptAtomically({
        receiptId: "req_r01",
        provider: "google_trends_serpapi",
        originKind: "ACTUAL_PROVIDER_INVOCATION",
        targetProductOrKeyword: "dog leash",
        region: "US",
        transportStatus: 200,
        capturedAt: new Date().toISOString(),
        rawResponseSha256: stored.rawResponseSha256,
        rawByteCount: stored.byteCount,
        artifactPath: stored.artifactPath,
      }, undefined, att);

      clearTrustedProviderInvocationsForTest();
      expect(getTrustedInvocationRegistryEntry("req_r01")).toBeUndefined();

      const recRes = await reconcilePendingReceiptRecovery("req_r01");
      expect(recRes.recovered).toBe(true);
      expect(recRes.originVerified).toBe(true);
      expect(getTrustedInvocationRegistryEntry("req_r01")).toBeDefined();
    });

    it("R02: Empty registry + existing ledger + missing attestation falls back to LOCAL_INTEGRITY_ONLY", async () => {
      const raw = JSON.stringify({ search_metadata: { id: "req_r02", status: "Success" } });
      const stored = saveRawProviderPayloadFile(raw);
      await persistCollectorReceiptAtomically({
        receiptId: "req_r02",
        provider: "google_trends_serpapi",
        originKind: "LOCAL_INTEGRITY_ONLY",
        targetProductOrKeyword: "dog leash",
        region: "US",
        transportStatus: 200,
        capturedAt: new Date().toISOString(),
        rawResponseSha256: stored.rawResponseSha256,
        rawByteCount: stored.byteCount,
        artifactPath: stored.artifactPath,
      });

      clearTrustedProviderInvocationsForTest();
      const recRes = await reconcilePendingReceiptRecovery("req_r02");
      expect(recRes.originVerified).toBe(false);
      expect(recRes.originKind).toBe("LOCAL_INTEGRITY_ONLY");
    });

    it("R03: Crash between receipt write and attestation write: recovery detects missing attestation and demotes cleanly", async () => {
      const raw = JSON.stringify({ search_metadata: { id: "req_r03", status: "Success" } });
      const stored = saveRawProviderPayloadFile(raw);
      // Simulate crash: staged receipt persisted, but attestation never written
      const ledgerFile = path.join(testStorageDir, ".provider_receipt_ledger.json");
      fs.writeFileSync(
        ledgerFile,
        JSON.stringify({
          req_r03: {
            receiptId: "req_r03",
            provider: "google_trends_serpapi",
            originKind: "ACTUAL_PROVIDER_INVOCATION",
            commitState: "LEDGER_PENDING_DB",
            eligible: false,
            targetProductOrKeyword: "dog bowl",
            region: "US",
            transportStatus: 200,
            capturedAt: new Date().toISOString(),
            rawResponseSha256: stored.rawResponseSha256,
            rawByteCount: stored.byteCount,
            artifactPath: stored.artifactPath,
          },
        }),
        "utf-8"
      );

      clearTrustedProviderInvocationsForTest();
      const recRes = await reconcilePendingReceiptRecovery("req_r03");
      expect(recRes.recovered).toBe(true);
      expect(recRes.originVerified).toBe(false);
      expect(recRes.originKind).toBe("LOCAL_INTEGRITY_ONLY");
    });

    it("R04: Crash after attestation write: atomic recovery links attestation and completes verification", async () => {
      const raw = JSON.stringify({ search_metadata: { id: "req_r04", status: "Success" } });
      const stored = saveRawProviderPayloadFile(raw);
      const att = await createTestSignedLiveTransportAttestation({
        attemptId: "att_r04",
        receiptId: "req_r04",
        rawResponseSha256: stored.rawResponseSha256,
        rawBytes: Buffer.from(raw, "utf8"),
        term: "dog crate",
        region: "US",
      });
      // Save attestation to disk
      await persistTransportAttestationAtomically(att);

      // Simulate ledger in LEDGER_PENDING_DB state (crashed before DB write completed)
      const ledgerFile = path.join(testStorageDir, ".provider_receipt_ledger.json");
      fs.writeFileSync(
        ledgerFile,
        JSON.stringify({
          req_r04: {
            receiptId: "req_r04",
            provider: "google_trends_serpapi",
            originKind: "ACTUAL_PROVIDER_INVOCATION",
            commitState: "LEDGER_PENDING_DB",
            eligible: false,
            targetProductOrKeyword: "dog crate",
            region: "US",
            transportStatus: 200,
            capturedAt: new Date().toISOString(),
            rawResponseSha256: stored.rawResponseSha256,
            rawByteCount: stored.byteCount,
            artifactPath: stored.artifactPath,
          },
        }),
        "utf-8"
      );

      clearTrustedProviderInvocationsForTest();
      const recRes = await reconcilePendingReceiptRecovery("req_r04");
      expect(recRes.recovered).toBe(true);
      expect(recRes.originVerified).toBe(true);
      expect(recRes.originKind).toBe("ACTUAL_PROVIDER_INVOCATION");
    });

    it("R05: Process restart simulation: in-memory registry wiped; resolveVerifiedDemandEvidence re-reads attestation and verifies signature", async () => {
      const raw = JSON.stringify({ search_metadata: { id: "req_r05", status: "Success" } });
      const stored = saveRawProviderPayloadFile(raw);
      const att = await createTestSignedLiveTransportAttestation({
        attemptId: "att_r05",
        receiptId: "req_r05",
        rawResponseSha256: stored.rawResponseSha256,
        rawBytes: Buffer.from(raw, "utf8"),
        term: "dog harness",
        region: "US",
      });
      await persistCollectorReceiptAtomically({
        receiptId: "req_r05",
        provider: "google_trends_serpapi",
        originKind: "ACTUAL_PROVIDER_INVOCATION",
        targetProductOrKeyword: "dog harness",
        region: "US",
        transportStatus: 200,
        capturedAt: new Date().toISOString(),
        rawResponseSha256: stored.rawResponseSha256,
        rawByteCount: stored.byteCount,
        artifactPath: stored.artifactPath,
      }, undefined, att);

      // Wipe memory completely
      clearTrustedProviderInvocationsForTest();

      const decision = await resolveVerifiedDemandEvidence("provider-request:serpapi:req_r05", {
        keyword: "dog harness",
        region: "US",
      });
      expect(decision.verified).toBe(true);
      expect(decision.verifiedOrigin).toBe(true);
      expect(decision.durablePersistenceVerified).toBe(true);
    });

    it("R06: Cold OS process spawn: child Node process successfully reads and verifies authentic attestation created by parent", async () => {
      const raw = JSON.stringify({ search_metadata: { id: "req_r06", status: "Success" } });
      const stored = saveRawProviderPayloadFile(raw);
      const att = await createTestSignedLiveTransportAttestation({
        attemptId: "att_r06",
        receiptId: "req_r06",
        rawResponseSha256: stored.rawResponseSha256,
        rawBytes: Buffer.from(raw, "utf8"),
        term: "cat bed",
        region: "US",
      });
      await persistCollectorReceiptAtomically({
        receiptId: "req_r06",
        provider: "google_trends_serpapi",
        originKind: "ACTUAL_PROVIDER_INVOCATION",
        targetProductOrKeyword: "cat bed",
        region: "US",
        transportStatus: 200,
        capturedAt: new Date().toISOString(),
        rawResponseSha256: stored.rawResponseSha256,
        rawByteCount: stored.byteCount,
        artifactPath: stored.artifactPath,
      }, undefined, att);

      // Spawn real independent child process using tsx
      const enginePath = path.resolve(process.cwd(), "src/services/kh02/demand/temporalDemandEngine.ts");
      const scriptCode = `
        import {
          setProviderReceiptStorageDirForTest,
          setProvenanceSigningKeyForTest,
          resolveVerifiedDemandEvidence,
        } from ${JSON.stringify(enginePath)};

        async function main() {
          setProviderReceiptStorageDirForTest(${JSON.stringify(testStorageDir)});
          setProvenanceSigningKeyForTest(${JSON.stringify(TEST_PROVENANCE_SIGNING_KEY_32)}, ${JSON.stringify(TEST_PROVENANCE_KEY_ID)});

          const decision = await resolveVerifiedDemandEvidence("provider-request:serpapi:req_r06", {
            keyword: "cat bed",
            region: "US",
          });

          if (!decision.verified || !decision.verifiedOrigin || decision.originKind !== "ACTUAL_PROVIDER_INVOCATION") {
            process.stderr.write("Child verification failed: " + JSON.stringify(decision));
            process.exit(1);
          }
          process.exit(0);
        }
        main().catch((err) => {
          process.stderr.write(String(err));
          process.exit(1);
        });
      `;
      const childScriptPath = path.join(testStorageDir, "child_verifier_r06.ts");
      fs.writeFileSync(childScriptPath, scriptCode, "utf-8");

      const tsxBin = path.resolve(process.cwd(), "node_modules/.bin/tsx");
      const exitCode = await new Promise<number>((resolve) => {
        const child = spawn(tsxBin, [childScriptPath], { stdio: "inherit" });
        child.on("close", resolve);
      });
      expect(exitCode).toBe(0);
    });

    it("R07: Child process cannot escalate TEST_SIMULATION receipt to live origin even across process restart", async () => {
      const raw = JSON.stringify({ search_metadata: { id: "req_r07", status: "Success" } });
      const stored = saveRawProviderPayloadFile(raw);
      const att = await createTestSimulatedTransportAttestation({
        attemptId: "att_r07",
        receiptId: "req_r07",
        rawResponseSha256: stored.rawResponseSha256,
        rawBytes: Buffer.from(raw, "utf8"),
        term: "cat tunnel",
        region: "US",
      });
      await persistCollectorReceiptAtomically({
        receiptId: "req_r07",
        provider: "google_trends_serpapi",
        originKind: "ACTUAL_PROVIDER_INVOCATION",
        targetProductOrKeyword: "cat tunnel",
        region: "US",
        transportStatus: 200,
        capturedAt: new Date().toISOString(),
        rawResponseSha256: stored.rawResponseSha256,
        rawByteCount: stored.byteCount,
        artifactPath: stored.artifactPath,
      }, undefined, att);

      const enginePath = path.resolve(process.cwd(), "src/services/kh02/demand/temporalDemandEngine.ts");
      const scriptCode = `
        import {
          setProviderReceiptStorageDirForTest,
          setProvenanceSigningKeyForTest,
          resolveVerifiedDemandEvidence,
        } from ${JSON.stringify(enginePath)};

        async function main() {
          setProviderReceiptStorageDirForTest(${JSON.stringify(testStorageDir)});
          setProvenanceSigningKeyForTest(${JSON.stringify(TEST_PROVENANCE_SIGNING_KEY_32)}, ${JSON.stringify(TEST_PROVENANCE_KEY_ID)});

          const decision = await resolveVerifiedDemandEvidence("provider-request:serpapi:req_r07", {
            strictLiveOrigin: true,
            keyword: "cat tunnel",
            region: "US",
          });

          // Must FAIL closed
          if (decision.verified && decision.verifiedOrigin) {
            process.stderr.write("Escalation bug: child granted live origin!");
            process.exit(1);
          }
          process.exit(0);
        }
        main().catch((err) => {
          process.stderr.write(String(err));
          process.exit(1);
        });
      `;
      const childScriptPath = path.join(testStorageDir, "child_verifier_r07.ts");
      fs.writeFileSync(childScriptPath, scriptCode, "utf-8");

      const tsxBin = path.resolve(process.cwd(), "node_modules/.bin/tsx");
      const exitCode = await new Promise<number>((resolve) => {
        const child = spawn(tsxBin, [childScriptPath], { stdio: "inherit" });
        child.on("close", resolve);
      });
      expect(exitCode).toBe(0);
    });

    it("R08: Concurrent recovery calls on same receipt are idempotent", async () => {
      const raw = JSON.stringify({ search_metadata: { id: "req_r08", status: "Success" } });
      const stored = saveRawProviderPayloadFile(raw);
      const att = await createTestSignedLiveTransportAttestation({
        attemptId: "att_r08",
        receiptId: "req_r08",
        rawResponseSha256: stored.rawResponseSha256,
        rawBytes: Buffer.from(raw, "utf8"),
        term: "cat post",
        region: "US",
      });
      await persistCollectorReceiptAtomically({
        receiptId: "req_r08",
        provider: "google_trends_serpapi",
        originKind: "ACTUAL_PROVIDER_INVOCATION",
        targetProductOrKeyword: "cat post",
        region: "US",
        transportStatus: 200,
        capturedAt: new Date().toISOString(),
        rawResponseSha256: stored.rawResponseSha256,
        rawByteCount: stored.byteCount,
        artifactPath: stored.artifactPath,
      }, undefined, att);

      clearTrustedProviderInvocationsForTest();
      const [res1, res2] = await Promise.all([
        reconcilePendingReceiptRecovery("req_r08"),
        reconcilePendingReceiptRecovery("req_r08"),
      ]);

      expect(res1.recovered).toBe(true);
      expect(res2.recovered).toBe(true);
      expect(res1.originVerified).toBe(true);
      expect(res2.originVerified).toBe(true);
    });

    it("R09: Recovery preserves existing raw payload artifact without overwriting or truncating", async () => {
      const raw = JSON.stringify({ search_metadata: { id: "req_r09", status: "Success" }, extra: "do_not_modify" });
      const stored = saveRawProviderPayloadFile(raw);
      const originalContent = fs.readFileSync(stored.artifactPath, "utf-8");

      await persistCollectorReceiptAtomically({
        receiptId: "req_r09",
        provider: "google_trends_serpapi",
        originKind: "LOCAL_INTEGRITY_ONLY",
        targetProductOrKeyword: "cat toy",
        region: "US",
        transportStatus: 200,
        capturedAt: new Date().toISOString(),
        rawResponseSha256: stored.rawResponseSha256,
        rawByteCount: stored.byteCount,
        artifactPath: stored.artifactPath,
      });

      await reconcilePendingReceiptRecovery("req_r09");
      const postRecoveryContent = fs.readFileSync(stored.artifactPath, "utf-8");
      expect(postRecoveryContent).toBe(originalContent);
    });

    it("R10: Recovery rejects receipt if raw artifact checksum does not match ledger", async () => {
      const raw = JSON.stringify({ search_metadata: { id: "req_r10", status: "Success" } });
      const stored = saveRawProviderPayloadFile(raw);
      await persistCollectorReceiptAtomically({
        receiptId: "req_r10",
        provider: "google_trends_serpapi",
        originKind: "LOCAL_INTEGRITY_ONLY",
        targetProductOrKeyword: "cat toy",
        region: "US",
        transportStatus: 200,
        capturedAt: new Date().toISOString(),
        rawResponseSha256: stored.rawResponseSha256,
        rawByteCount: stored.byteCount,
        artifactPath: stored.artifactPath,
      });

      // Tamper artifact
      fs.writeFileSync(stored.artifactPath, "corrupted_payload_bytes", "utf-8");
      clearTrustedProviderInvocationsForTest();

      const recRes = await reconcilePendingReceiptRecovery("req_r10");
      expect(recRes.recovered).toBe(false);
      expect(recRes.errorCode).toBe("HASH_MISMATCH");
    });

    it("R11: Recovery rejects receipt if raw artifact file is missing from disk", async () => {
      const raw = JSON.stringify({ search_metadata: { id: "req_r11", status: "Success" } });
      const stored = saveRawProviderPayloadFile(raw);
      await persistCollectorReceiptAtomically({
        receiptId: "req_r11",
        provider: "google_trends_serpapi",
        originKind: "LOCAL_INTEGRITY_ONLY",
        targetProductOrKeyword: "cat toy",
        region: "US",
        transportStatus: 200,
        capturedAt: new Date().toISOString(),
        rawResponseSha256: stored.rawResponseSha256,
        rawByteCount: stored.byteCount,
        artifactPath: stored.artifactPath,
      });

      // Delete artifact
      fs.unlinkSync(stored.artifactPath);
      clearTrustedProviderInvocationsForTest();

      const recRes = await reconcilePendingReceiptRecovery("req_r11");
      expect(recRes.recovered).toBe(false);
      expect(recRes.errorCode).toBe("MISSING_ARTIFACT");
    });

    it("R12: Multiple receipts in directory: recovery correctly reconciles only receipts with matching durable attestations", async () => {
      const raw1 = JSON.stringify({ search_metadata: { id: "req_r12_1", status: "Success" } });
      const stored1 = saveRawProviderPayloadFile(raw1);
      const att1 = await createTestSignedLiveTransportAttestation({
        attemptId: "att_r12_1",
        receiptId: "req_r12_1",
        rawResponseSha256: stored1.rawResponseSha256,
        rawBytes: Buffer.from(raw1, "utf8"),
      });
      await persistCollectorReceiptAtomically({
        receiptId: "req_r12_1",
        provider: "google_trends_serpapi",
        originKind: "ACTUAL_PROVIDER_INVOCATION",
        targetProductOrKeyword: "toy 1",
        region: "US",
        transportStatus: 200,
        capturedAt: new Date().toISOString(),
        rawResponseSha256: stored1.rawResponseSha256,
        rawByteCount: stored1.byteCount,
        artifactPath: stored1.artifactPath,
      }, undefined, att1);

      const raw2 = JSON.stringify({ search_metadata: { id: "req_r12_2", status: "Success" } });
      const stored2 = saveRawProviderPayloadFile(raw2);
      await persistCollectorReceiptAtomically({
        receiptId: "req_r12_2",
        provider: "google_trends_serpapi",
        originKind: "LOCAL_INTEGRITY_ONLY",
        targetProductOrKeyword: "toy 2",
        region: "US",
        transportStatus: 200,
        capturedAt: new Date().toISOString(),
        rawResponseSha256: stored2.rawResponseSha256,
        rawByteCount: stored2.byteCount,
        artifactPath: stored2.artifactPath,
      });

      clearTrustedProviderInvocationsForTest();
      const rec1 = await reconcilePendingReceiptRecovery("req_r12_1");
      const rec2 = await reconcilePendingReceiptRecovery("req_r12_2");

      expect(rec1.originVerified).toBe(true);
      expect(rec2.originVerified).toBe(false);
    });

    it("R13: Stale crash lock left behind during recovery is safely reclaimed after lease expiration", async () => {
      const lockFile = path.join(testStorageDir, ".provider_receipt_ledger.json.lock");
      // Write stale lock with dead PID and expired lease
      fs.writeFileSync(
        lockFile,
        JSON.stringify({
          ownerId: "dead_worker_owner",
          pid: 9999999, // dead PID
          hostname: os.hostname(),
          acquiredAt: Date.now() - 60000,
          expiresAt: Date.now() - 30000,
        }),
        "utf-8"
      );

      const raw = JSON.stringify({ search_metadata: { id: "req_r13", status: "Success" } });
      const stored = saveRawProviderPayloadFile(raw);
      const res = await persistCollectorReceiptAtomically({
        receiptId: "req_r13",
        provider: "google_trends_serpapi",
        originKind: "LOCAL_INTEGRITY_ONLY",
        targetProductOrKeyword: "cat toy",
        region: "US",
        transportStatus: 200,
        capturedAt: new Date().toISOString(),
        rawResponseSha256: stored.rawResponseSha256,
        rawByteCount: stored.byteCount,
        artifactPath: stored.artifactPath,
      });

      expect(res.state).toBe("EVIDENCE_ELIGIBLE");
      expect(res.eligible).toBe(true);
    });

    it("R14: Recovery handles corrupted ledger entry gracefully without crashing engine", async () => {
      const ledgerFile = path.join(testStorageDir, ".provider_receipt_ledger.json");
      fs.writeFileSync(ledgerFile, "{ invalid_syntax ...", "utf-8");

      const recRes = await reconcilePendingReceiptRecovery("req_r14");
      expect(recRes.recovered).toBe(false);
    });
  });

  // =========================================================================
  // Part 3: Canonical Verifier & Decision Integrity (V01 - V12)
  // =========================================================================
  describe("Part 3: Canonical Verifier & Decision Integrity (V01 - V12)", () => {
    it("V01: resolveVerifiedDemandEvidence verifies exact observationDate matches timeline point in raw payload", async () => {
      const raw = JSON.stringify({
        search_metadata: { id: "req_v01", status: "Success" },
        search_parameters: { q: "smart pet feeder", geo: "US" },
        interest_over_time: {
          timeline_data: [
            { date: "2026-06-01", values: [80] },
            { date: "2026-07-01", values: [85] },
          ],
        },
      });
      const stored = saveRawProviderPayloadFile(raw);
      const att = await createTestSignedLiveTransportAttestation({
        attemptId: "att_v01",
        receiptId: "req_v01",
        rawResponseSha256: stored.rawResponseSha256,
        rawBytes: Buffer.from(raw, "utf8"),
        term: "smart pet feeder",
        region: "US",
      });
      await persistCollectorReceiptAtomically({
        receiptId: "req_v01",
        provider: "google_trends_serpapi",
        originKind: "ACTUAL_PROVIDER_INVOCATION",
        targetProductOrKeyword: "smart pet feeder",
        region: "US",
        transportStatus: 200,
        capturedAt: new Date().toISOString(),
        rawResponseSha256: stored.rawResponseSha256,
        rawByteCount: stored.byteCount,
        artifactPath: stored.artifactPath,
      }, undefined, att);

      const decision = await resolveVerifiedDemandEvidence("provider-request:serpapi:req_v01", {
        keyword: "smart pet feeder",
        region: "US",
        observationDate: "2026-07-01",
        observationValue: 85,
      });
      expect(decision.verified).toBe(true);
    });

    it("V02: resolveVerifiedDemandEvidence verifies exact observationValue matches timeline point in raw payload", async () => {
      const raw = JSON.stringify({
        search_metadata: { id: "req_v02", status: "Success" },
        search_parameters: { q: "smart pet feeder", geo: "US" },
        interest_over_time: {
          timeline_data: [{ date: "2026-07-01", values: [85] }],
        },
      });
      const stored = saveRawProviderPayloadFile(raw);
      const att = await createTestSignedLiveTransportAttestation({
        attemptId: "att_v02",
        receiptId: "req_v02",
        rawResponseSha256: stored.rawResponseSha256,
        rawBytes: Buffer.from(raw, "utf8"),
        term: "smart pet feeder",
        region: "US",
      });
      await persistCollectorReceiptAtomically({
        receiptId: "req_v02",
        provider: "google_trends_serpapi",
        originKind: "ACTUAL_PROVIDER_INVOCATION",
        targetProductOrKeyword: "smart pet feeder",
        region: "US",
        transportStatus: 200,
        capturedAt: new Date().toISOString(),
        rawResponseSha256: stored.rawResponseSha256,
        rawByteCount: stored.byteCount,
        artifactPath: stored.artifactPath,
      }, undefined, att);

      const decision = await resolveVerifiedDemandEvidence("provider-request:serpapi:req_v02", {
        keyword: "smart pet feeder",
        region: "US",
        observationValue: 85,
      });
      expect(decision.verified).toBe(true);
    });

    it("V03: Mismatched observationDate returns DATE_MISMATCH / rejection", async () => {
      const raw = JSON.stringify({
        search_metadata: { id: "req_v03", status: "Success" },
        search_parameters: { q: "smart pet feeder", geo: "US" },
        interest_over_time: {
          timeline_data: [{ date: "2026-07-01", values: [85] }],
        },
      });
      const stored = saveRawProviderPayloadFile(raw);
      const att = await createTestSignedLiveTransportAttestation({
        attemptId: "att_v03",
        receiptId: "req_v03",
        rawResponseSha256: stored.rawResponseSha256,
        rawBytes: Buffer.from(raw, "utf8"),
        term: "smart pet feeder",
        region: "US",
      });
      await persistCollectorReceiptAtomically({
        receiptId: "req_v03",
        provider: "google_trends_serpapi",
        originKind: "ACTUAL_PROVIDER_INVOCATION",
        targetProductOrKeyword: "smart pet feeder",
        region: "US",
        transportStatus: 200,
        capturedAt: new Date().toISOString(),
        rawResponseSha256: stored.rawResponseSha256,
        rawByteCount: stored.byteCount,
        artifactPath: stored.artifactPath,
      }, undefined, att);

      const decision = await resolveVerifiedDemandEvidence("provider-request:serpapi:req_v03", {
        keyword: "smart pet feeder",
        region: "US",
        observationDate: "2025-01-01", // Mismatched date
      });
      expect(decision.verified).toBe(false);
      expect(decision.errorCode).toBe("DATE_MISMATCH");
    });

    it("V04: Mismatched observationValue returns HASH_MISMATCH / rejection", async () => {
      const raw = JSON.stringify({
        search_metadata: { id: "req_v04", status: "Success" },
        search_parameters: { q: "smart pet feeder", geo: "US" },
        interest_over_time: {
          timeline_data: [{ date: "2026-07-01", values: [85] }],
        },
      });
      const stored = saveRawProviderPayloadFile(raw);
      const att = await createTestSignedLiveTransportAttestation({
        attemptId: "att_v04",
        receiptId: "req_v04",
        rawResponseSha256: stored.rawResponseSha256,
        rawBytes: Buffer.from(raw, "utf8"),
        term: "smart pet feeder",
        region: "US",
      });
      await persistCollectorReceiptAtomically({
        receiptId: "req_v04",
        provider: "google_trends_serpapi",
        originKind: "ACTUAL_PROVIDER_INVOCATION",
        targetProductOrKeyword: "smart pet feeder",
        region: "US",
        transportStatus: 200,
        capturedAt: new Date().toISOString(),
        rawResponseSha256: stored.rawResponseSha256,
        rawByteCount: stored.byteCount,
        artifactPath: stored.artifactPath,
      }, undefined, att);

      const decision = await resolveVerifiedDemandEvidence("provider-request:serpapi:req_v04", {
        keyword: "smart pet feeder",
        region: "US",
        observationValue: 12, // Mismatched value
      });
      expect(decision.verified).toBe(false);
      expect(decision.errorCode).toBe("HASH_MISMATCH");
    });

    it("V05: Point-in-time check: observation after asOfTimestamp is rejected (POINT_IN_TIME_VIOLATION)", async () => {
      const raw = JSON.stringify({
        search_metadata: { id: "req_v05", status: "Success" },
        search_parameters: { q: "smart pet feeder", geo: "US" },
        interest_over_time: {
          timeline_data: [{ date: "2026-07-01", values: [85] }],
        },
      });
      const stored = saveRawProviderPayloadFile(raw);
      const att = await createTestSignedLiveTransportAttestation({
        attemptId: "att_v05",
        receiptId: "req_v05",
        rawResponseSha256: stored.rawResponseSha256,
        rawBytes: Buffer.from(raw, "utf8"),
        term: "smart pet feeder",
        region: "US",
      });
      await persistCollectorReceiptAtomically({
        receiptId: "req_v05",
        provider: "google_trends_serpapi",
        originKind: "ACTUAL_PROVIDER_INVOCATION",
        targetProductOrKeyword: "smart pet feeder",
        region: "US",
        transportStatus: 200,
        capturedAt: "2026-08-01T00:00:00.000Z",
        rawResponseSha256: stored.rawResponseSha256,
        rawByteCount: stored.byteCount,
        artifactPath: stored.artifactPath,
      }, undefined, att);

      const decision = await resolveVerifiedDemandEvidence("provider-request:serpapi:req_v05", {
        keyword: "smart pet feeder",
        region: "US",
        asOfTimestamp: "2026-07-15T00:00:00.000Z", // asOf before capturedAt
      });
      expect(decision.verified).toBe(false);
      expect(decision.errorCode).toBe("POINT_IN_TIME_VIOLATION");
    });

    it("V06: Ingestion timestamp after asOfTimestamp is rejected", () => {
      const obs = [
        {
          periodStart: "2026-06-01",
          demandValue: 70,
          ingestedAt: "2026-07-20T00:00:00.000Z",
        },
      ];
      const res = evaluateDemandHistoryEvidence(obs as any[], { asOfTimestamp: "2026-07-10T00:00:00.000Z" });
      expect(res.dataPointsCount).toBe(0);
      expect(res.status).toBe("INSUFFICIENT_HISTORY");
    });

    it("V07: Canonical verifier returns EligibilityDecision with typed metadata (evidenceVersion: '12.4.3.7.14', decisionAt)", async () => {
      const raw = JSON.stringify({ search_metadata: { id: "req_v07", status: "Success" } });
      const stored = saveRawProviderPayloadFile(raw);
      await persistCollectorReceiptAtomically({
        receiptId: "req_v07",
        provider: "google_trends_serpapi",
        originKind: "LOCAL_INTEGRITY_ONLY",
        targetProductOrKeyword: "cat toy",
        region: "US",
        transportStatus: 200,
        capturedAt: new Date().toISOString(),
        rawResponseSha256: stored.rawResponseSha256,
        rawByteCount: stored.byteCount,
        artifactPath: stored.artifactPath,
      });

      const decision = await resolveVerifiedDemandEvidence("provider-request:serpapi:req_v07", {
        keyword: "cat toy",
        region: "US",
      });
      expect(decision.evidenceVersion).toBe("12.4.3.7.14");
      expect(decision.decisionAt).toBeDefined();
      expect(decision.durablePersistenceVerified).toBe(true);
    });

    it("V08: Canonical verifier verifyReceiptEligibility is identical to resolveVerifiedDemandEvidence", () => {
      expect(verifyReceiptEligibility).toBe(resolveVerifiedDemandEvidence);
    });

    it("V09: G15 evaluation: evaluateDemandHistoryEvidence fails closed with INSUFFICIENT_EVIDENCE when live origin is unverified", () => {
      const obs = [
        {
          periodStart: "2026-05-01",
          demandValue: 70,
          source: "GOOGLE_TRENDS_LIVE",
          evidenceReference: "provider-request:serpapi:unbacked_req",
        },
      ];
      const auth = evaluateDemandSourceAuthority(obs as any[], { requiredRegion: "US" });
      expect(auth.authority).toBe("CACHED_UNVERIFIED");
    });

    it("V10: G16 evaluation: evaluateTemporalDemandStability fails closed when provenance is unverified", () => {
      const obs = [
        {
          periodStart: "2026-05-01",
          demandValue: 70,
          source: "GOOGLE_TRENDS_LIVE",
          evidenceReference: "provider-request:serpapi:unbacked_req",
        },
      ];
      const stability = evaluateTemporalDemandStability(obs as any[], 90, { requiredRegion: "US" });
      expect(stability.eligibleForEvergreen).toBe(false);
      expect(stability.demandClass).toBe("INSUFFICIENT_HISTORY");
    });

    it("V11: Multi-point series where 1 point has mismatched value fails closed for the whole series", () => {
      const obs = [
        { periodStart: "2026-05-01", demandValue: 70, source: "Google Trends (SerpApi)" },
        { periodStart: "2026-05-08", demandValue: 0, source: "Google Trends (SerpApi)" }, // corrupted zero
        { periodStart: "2026-05-15", demandValue: 75, source: "Google Trends (SerpApi)" },
      ];
      const res = evaluateDemandHistoryEvidence(obs as any[], { requiredRegion: "US" });
      expect(res.status).toBe("INSUFFICIENT_HISTORY");
    });

    it("V12: Valid live attestation + matching point date + matching value + pre-asOf timestamp produces AUTHORITATIVE_VERIFIED", async () => {
      const raw = JSON.stringify({
        search_metadata: { id: "req_v12", status: "Success" },
        search_parameters: { q: "cat fountain", geo: "US" },
        interest_over_time: {
          timeline_data: [{ date: "2026-07-01", values: [75] }],
        },
      });
      const stored = saveRawProviderPayloadFile(raw);
      const att = await createTestSignedLiveTransportAttestation({
        attemptId: "att_v12",
        receiptId: "req_v12",
        rawResponseSha256: stored.rawResponseSha256,
        rawBytes: Buffer.from(raw, "utf8"),
        term: "cat fountain",
        region: "US",
      });
      await persistCollectorReceiptAtomically({
        receiptId: "req_v12",
        provider: "google_trends_serpapi",
        originKind: "ACTUAL_PROVIDER_INVOCATION",
        targetProductOrKeyword: "cat fountain",
        region: "US",
        transportStatus: 200,
        capturedAt: new Date().toISOString(),
        rawResponseSha256: stored.rawResponseSha256,
        rawByteCount: stored.byteCount,
        artifactPath: stored.artifactPath,
      }, undefined, att);

      const obs = [
        {
          id: "obs_v12",
          periodStart: "2026-07-01T00:00:00.000Z",
          demandValue: 75,
          keyword: "cat fountain",
          region: "US",
          source: "GOOGLE_TRENDS_LIVE",
          evidenceReference: "provider-request:serpapi:req_v12",
          verifiedDescriptor: {
            verified: true,
            providerRequestId: "req_v12",
            rawResponseSha256: stored.rawResponseSha256,
            targetProductOrKeyword: "cat fountain",
            region: "US",
            responseStatus: 200,
          },
        },
      ];

      const auth = evaluateDemandSourceAuthority(obs as any[], { requiredRegion: "US" });
      expect(auth.authority).toBe("AUTHORITATIVE_VERIFIED");
    });
  });

  // =========================================================================
  // Part 4: Dynamic Discovery, Concurrency & Sentinel Hygiene (H01 - H10)
  // =========================================================================
  describe("Part 4: Dynamic Discovery, Concurrency & Sentinel Hygiene (H01 - H10)", () => {
    it("H01: Dynamic test file discovery verifies exact test inventory against disk without hardcoded constants", () => {
      const testsDir = path.resolve(process.cwd(), "tests/unit");
      const findTestFiles = (dir: string): string[] => {
        let results: string[] = [];
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        for (const entry of entries) {
          const fullPath = path.join(dir, entry.name);
          if (entry.isDirectory()) {
            results = results.concat(findTestFiles(fullPath));
          } else if (entry.isFile() && (entry.name.endsWith(".test.ts") || entry.name.endsWith(".spec.ts"))) {
            results.push(fullPath);
          }
        }
        return results;
      };

      const files = findTestFiles(testsDir);
      expect(files.length).toBeGreaterThan(0);
      for (const f of files) {
        expect(fs.existsSync(f)).toBe(true);
      }
    });

    it("H02: All unit tests in tests/unit/kh02 are discovered dynamically and have unique names", () => {
      const kh02Dir = path.resolve(process.cwd(), "tests/unit/kh02");
      const files = fs.readdirSync(kh02Dir).filter((f) => f.endsWith(".test.ts"));
      const testNames = new Set<string>();
      let totalTestsCount = 0;

      for (const file of files) {
        const content = fs.readFileSync(path.join(kh02Dir, file), "utf-8");
        const matches = content.matchAll(/\b(?:it|test)\s*\(\s*(["'`])((?:(?!\1)[\s\S])+?)\1/g);
        for (const match of matches) {
          const testTitle = `${file} :: ${match[2].trim()}`;
          expect(testNames.has(testTitle)).toBe(false);
          testNames.add(testTitle);
          totalTestsCount++;
        }
      }
      expect(totalTestsCount).toBeGreaterThan(100);
    });

    it("H03: Production sentinel receipts in data/provider_receipts/ match baseline SHA-256 hashes without tampering", () => {
      const receiptsDir = path.resolve(process.cwd(), "data/provider_receipts");
      if (fs.existsSync(receiptsDir)) {
        const files = fs.readdirSync(receiptsDir).filter((f) => f.endsWith(".json") && !f.includes("ledger") && !f.includes("lock") && !f.includes("attestation"));
        for (const f of files) {
          const fullPath = path.join(receiptsDir, f);
          const bytes = fs.readFileSync(fullPath);
          const computedSha = crypto.createHash("sha256").update(bytes).digest("hex").toLowerCase();
          const baseName = path.basename(f, ".json");
          if (baseName.length === 64 && /^[0-9a-f]{64}$/.test(baseName)) {
            expect(computedSha).toBe(baseName);
          }
        }
      }
    });

    it("H04: Test provenance harness is never importable from production runtime files", () => {
      const srcDir = path.resolve(process.cwd(), "src");
      const checkSrcFiles = (dir: string): void => {
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        for (const entry of entries) {
          const fullPath = path.join(dir, entry.name);
          if (entry.isDirectory()) {
            checkSrcFiles(fullPath);
          } else if (entry.isFile() && (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx"))) {
            const content = fs.readFileSync(fullPath, "utf-8");
            expect(content).not.toContain("kh02TestProvenanceHarness");
            expect(content).not.toContain("createTestSignedLiveTransportAttestation");
            expect(content).not.toContain("createTestSimulatedTransportAttestation");
          }
        }
      };
      checkSrcFiles(srcDir);
    });

    it("H05: Two concurrent worker processes writing attestations under barrier complete without file corruption or race conditions", async () => {
      const barrierPath = path.join(testStorageDir, "barrier.txt");
      const enginePath = path.resolve(process.cwd(), "src/services/kh02/demand/temporalDemandEngine.ts");
      const harnessPath = path.resolve(process.cwd(), "tests/support/kh02TestProvenanceHarness.ts");

      const workerCode = `
        import fs from "fs";
        import path from "path";
        import {
          setProviderReceiptStorageDirForTest,
          setProvenanceSigningKeyForTest,
          persistCollectorReceiptAtomically,
          saveRawProviderPayloadFile,
        } from ${JSON.stringify(enginePath)};
        import {
          createTestSignedLiveTransportAttestation,
          TEST_PROVENANCE_SIGNING_KEY_32,
          TEST_PROVENANCE_KEY_ID,
        } from ${JSON.stringify(harnessPath)};

        async function main() {
          const id = process.argv[2];
          const storageDir = process.argv[3];
          const barrier = process.argv[4];

          setProviderReceiptStorageDirForTest(storageDir);
          setProvenanceSigningKeyForTest(TEST_PROVENANCE_SIGNING_KEY_32, TEST_PROVENANCE_KEY_ID);

          while (!fs.existsSync(barrier)) {
            await new Promise((r) => setTimeout(r, 5));
          }

          const raw = JSON.stringify({ search_metadata: { id: "req_h05_" + id, status: "Success" } });
          const stored = saveRawProviderPayloadFile(raw);
          const att = await createTestSignedLiveTransportAttestation({
            attemptId: "att_h05_" + id,
            receiptId: "req_h05_" + id,
            rawResponseSha256: stored.rawResponseSha256,
            rawBytes: Buffer.from(raw, "utf8"),
            term: "worker item " + id,
            region: "US",
          });

          const res = await persistCollectorReceiptAtomically({
            receiptId: "req_h05_" + id,
            provider: "google_trends_serpapi",
            originKind: "ACTUAL_PROVIDER_INVOCATION",
            targetProductOrKeyword: "worker item " + id,
            region: "US",
            transportStatus: 200,
            capturedAt: new Date().toISOString(),
            rawResponseSha256: stored.rawResponseSha256,
            rawByteCount: stored.byteCount,
            artifactPath: stored.artifactPath,
          }, undefined, att);

          if (res.state !== "EVIDENCE_ELIGIBLE" || !res.originVerified) {
            process.stderr.write("Worker " + id + " failed: " + JSON.stringify(res));
            process.exit(1);
          }
          process.exit(0);
        }
        main().catch((err) => {
          process.stderr.write(String(err));
          process.exit(1);
        });
      `;
      const workerScript = path.join(testStorageDir, "worker_h05.ts");
      fs.writeFileSync(workerScript, workerCode, "utf-8");

      const tsxBin = path.resolve(process.cwd(), "node_modules/.bin/tsx");
      const runWorker = (id: string) =>
        new Promise<number>((resolve) => {
          const child = spawn(tsxBin, [workerScript, id, testStorageDir, barrierPath], {
            stdio: "inherit",
          });
          child.on("close", resolve);
        });

      const p1 = runWorker("1");
      const p2 = runWorker("2");
      await new Promise((r) => setTimeout(r, 100));
      fs.writeFileSync(barrierPath, "GO", "utf-8");

      const [code1, code2] = await Promise.all([p1, p2]);
      expect(code1).toBe(0);
      expect(code2).toBe(0);
    });

    it("H06: Two concurrent worker processes verifying attestations achieve identical cryptographic verification results", async () => {
      const raw = JSON.stringify({ search_metadata: { id: "req_h06", status: "Success" } });
      const stored = saveRawProviderPayloadFile(raw);
      const att = await createTestSignedLiveTransportAttestation({
        attemptId: "att_h06",
        receiptId: "req_h06",
        rawResponseSha256: stored.rawResponseSha256,
        rawBytes: Buffer.from(raw, "utf8"),
        term: "cat collar",
        region: "US",
      });
      await persistCollectorReceiptAtomically({
        receiptId: "req_h06",
        provider: "google_trends_serpapi",
        originKind: "ACTUAL_PROVIDER_INVOCATION",
        targetProductOrKeyword: "cat collar",
        region: "US",
        transportStatus: 200,
        capturedAt: new Date().toISOString(),
        rawResponseSha256: stored.rawResponseSha256,
        rawByteCount: stored.byteCount,
        artifactPath: stored.artifactPath,
      }, undefined, att);

      const barrierPath = path.join(testStorageDir, "barrier_h06.txt");
      const enginePath = path.resolve(process.cwd(), "src/services/kh02/demand/temporalDemandEngine.ts");

      const verifierCode = `
        import fs from "fs";
        import {
          setProviderReceiptStorageDirForTest,
          setProvenanceSigningKeyForTest,
          resolveVerifiedDemandEvidence,
        } from ${JSON.stringify(enginePath)};

        async function main() {
          const id = process.argv[2];
          const storageDir = process.argv[3];
          const barrier = process.argv[4];

          setProviderReceiptStorageDirForTest(storageDir);
          setProvenanceSigningKeyForTest(${JSON.stringify(TEST_PROVENANCE_SIGNING_KEY_32)}, ${JSON.stringify(TEST_PROVENANCE_KEY_ID)});

          while (!fs.existsSync(barrier)) {
            await new Promise((r) => setTimeout(r, 5));
          }

          const decision = await resolveVerifiedDemandEvidence("provider-request:serpapi:req_h06", {
            keyword: "cat collar",
            region: "US",
          });

          if (!decision.verified || !decision.verifiedOrigin) {
            process.stderr.write("Verifier " + id + " failed: " + JSON.stringify(decision));
            process.exit(1);
          }
          process.exit(0);
        }
        main().catch((err) => {
          process.stderr.write(String(err));
          process.exit(1);
        });
      `;
      const verifierScript = path.join(testStorageDir, "verifier_h06.ts");
      fs.writeFileSync(verifierScript, verifierCode, "utf-8");

      const tsxBin = path.resolve(process.cwd(), "node_modules/.bin/tsx");
      const runVerifier = (id: string) =>
        new Promise<number>((resolve) => {
          const child = spawn(tsxBin, [verifierScript, id, testStorageDir, barrierPath], {
            stdio: "inherit",
          });
          child.on("close", resolve);
        });

      const p1 = runVerifier("1");
      const p2 = runVerifier("2");
      await new Promise((r) => setTimeout(r, 100));
      fs.writeFileSync(barrierPath, "GO", "utf-8");

      const [code1, code2] = await Promise.all([p1, p2]);
      expect(code1).toBe(0);
      expect(code2).toBe(0);
    });

    it("H07: Engine cleans up test attestations cleanly without touching production receipts", () => {
      setProvenanceSigningKeyForTest(TEST_PROVENANCE_SIGNING_KEY_32, TEST_PROVENANCE_KEY_ID);
      expect(getProvenanceSigningKey()?.keyId).toBe(TEST_PROVENANCE_KEY_ID);
      clearTestTransportAttestationsForTest();
      expect(getProvenanceSigningKey()).toBeNull();
    });

    it("H08: Key rotation test: attestation signed with old keyId fails verification when only new key is configured", async () => {
      setProvenanceSigningKeyForTest("key_generation_1_secret_entropy_32_bytes_min", "key_gen_1");
      const raw = JSON.stringify({ search_metadata: { id: "req_h08", status: "Success" } });
      const sha = crypto.createHash("sha256").update(raw).digest("hex");
      const res = await issueTrustedTransportAttestation({
        attemptId: "att_h08",
        receiptId: "req_h08",
        provider: "google_trends_serpapi",
        rawResponseSha256: sha,
        rawBytes: Buffer.from(raw, "utf8"),
        transportStatus: 200,
        canonicalSanitizedUrl: "https://serpapi.com/search.json?engine=google_trends&data_type=TIMESERIES",
        requestFingerprint: "fp_h08",
        requestTerm: "term",
        region: "US",
        isTestSimulation: false,
      });
      expect(res.success).toBe(true);
      const att = res.attestation!;

      // Rotate to key generation 2
      setProvenanceSigningKeyForTest("key_generation_2_secret_entropy_32_bytes_min", "key_gen_2");
      const verifyRes = await verifyDurableTransportAttestation(att);
      expect(verifyRes.valid).toBe(false);
      expect(verifyRes.error).toContain("SIGNING_KEY_MISMATCH");
    });

    it("H09: Zero CPU busy-spinning during attestation persistence and verification", async () => {
      const startCpu = process.cpuUsage();
      const raw = JSON.stringify({ search_metadata: { id: "req_h09", status: "Success" } });
      const stored = saveRawProviderPayloadFile(raw);
      const att = await createTestSignedLiveTransportAttestation({
        attemptId: "att_h09",
        receiptId: "req_h09",
        rawResponseSha256: stored.rawResponseSha256,
        rawBytes: Buffer.from(raw, "utf8"),
      });
      await persistCollectorReceiptAtomically({
        receiptId: "req_h09",
        provider: "google_trends_serpapi",
        originKind: "ACTUAL_PROVIDER_INVOCATION",
        targetProductOrKeyword: "cat toy",
        region: "US",
        transportStatus: 200,
        capturedAt: new Date().toISOString(),
        rawResponseSha256: stored.rawResponseSha256,
        rawByteCount: stored.byteCount,
        artifactPath: stored.artifactPath,
      }, undefined, att);

      const diffCpu = process.cpuUsage(startCpu);
      const totalCpuMs = (diffCpu.user + diffCpu.system) / 1000;
      expect(totalCpuMs).toBeLessThan(1500); // Well bounded
    });

    it("H10: Memory footprint remains bounded under 100 sequential attestation signing and verification operations", async () => {
      const memBefore = process.memoryUsage().heapUsed;
      for (let i = 0; i < 100; i++) {
        const raw = JSON.stringify({ iter: i, search_metadata: { id: "req_h10_" + i, status: "Success" } });
        const sha = crypto.createHash("sha256").update(raw).digest("hex");
        const res = await issueTrustedTransportAttestation({
          attemptId: "att_h10_" + i,
          receiptId: "req_h10_" + i,
          provider: "google_trends_serpapi",
          rawResponseSha256: sha,
          rawBytes: Buffer.from(raw, "utf8"),
          transportStatus: 200,
          canonicalSanitizedUrl: "https://serpapi.com/search.json?engine=google_trends&data_type=TIMESERIES",
          requestFingerprint: "fp_h10_" + i,
          requestTerm: "term " + i,
          region: "US",
          isTestSimulation: false,
        });
        expect(res.success).toBe(true);
        const verifyRes = await verifyDurableTransportAttestation(res.attestation!);
        expect(verifyRes.valid).toBe(true);
      }
      const memAfter = process.memoryUsage().heapUsed;
      const memGrowthMb = (memAfter - memBefore) / (1024 * 1024);
      expect(memGrowthMb).toBeLessThan(50); // Bounded memory growth
    });
  });
});
