/**
 * KH-02 V12.4.3.7.14 Test Provenance Harness
 *
 * Dedicated test-only provenance helpers for isolated unit tests.
 * This file is strictly located inside tests/ and must NEVER be imported by production runtime code.
 */

import crypto from "crypto";
import {
  registerTestControlledInvocationProof,
  issueTrustedTransportAttestation,
  setProvenanceSigningKeyForTest,
  clearTestTransportAttestationsForTest,
  type TrustedInvocationProof,
  type ProviderTransportAttestationV1,
} from "@/services/kh02/demand/temporalDemandEngine";

if (process.env.NODE_ENV === "production") {
  throw new Error("SECURITY_VIOLATION: kh02TestProvenanceHarness cannot be imported in production environment.");
}

export {
  registerTestControlledInvocationProof,
  setProvenanceSigningKeyForTest,
  clearTestTransportAttestationsForTest,
};

export const TEST_PROVENANCE_SIGNING_KEY_32 = "test_signing_key_32_bytes_long_min_secret_entropy_1234567890";
export const TEST_PROVENANCE_KEY_ID = "test_key_v1";

/**
 * Creates an explicitly simulated transport attestation (testOrSimulated: true).
 * Even with valid signature, this can NEVER satisfy strictLiveOrigin=true.
 */
export async function createTestSimulatedTransportAttestation(params: {
  attemptId: string;
  receiptId: string;
  rawResponseSha256: string;
  rawBytes: Buffer | Uint8Array;
  provider?: string;
  term?: string;
  region?: string;
}): Promise<ProviderTransportAttestationV1> {
  setProvenanceSigningKeyForTest(TEST_PROVENANCE_SIGNING_KEY_32, TEST_PROVENANCE_KEY_ID);
  const res = await issueTrustedTransportAttestation({
    attemptId: params.attemptId,
    receiptId: params.receiptId,
    provider: params.provider || "google_trends_serpapi",
    rawResponseSha256: params.rawResponseSha256,
    rawBytes: params.rawBytes,
    transportStatus: 200,
    canonicalSanitizedUrl: "https://serpapi.com/search.json?engine=google_trends&data_type=TIMESERIES",
    requestFingerprint: `test_fp_${Date.now()}`,
    requestTerm: params.term || "cat toy",
    region: params.region || "US",
    upstreamRequestId: params.receiptId,
    isTestSimulation: true,
  });
  if (!res.success || !res.attestation) {
    throw new Error(`Failed to create test simulated attestation: ${res.error}`);
  }
  return res.attestation;
}

/**
 * Creates an authorized test signed transport attestation (testOrSimulated: false).
 * Used exclusively to test cryptographic verification, process restart, and tamper rejection in test environments.
 */
export async function createTestSignedLiveTransportAttestation(params: {
  attemptId: string;
  receiptId: string;
  rawResponseSha256: string;
  rawBytes: Buffer | Uint8Array;
  provider?: string;
  term?: string;
  region?: string;
  workspaceId?: string | null;
  researchRunId?: string | null;
  productId?: string | null;
  issuedAt?: string;
}): Promise<ProviderTransportAttestationV1> {
  setProvenanceSigningKeyForTest(TEST_PROVENANCE_SIGNING_KEY_32, TEST_PROVENANCE_KEY_ID);
  const res = await issueTrustedTransportAttestation({
    attemptId: params.attemptId,
    receiptId: params.receiptId,
    provider: params.provider || "google_trends_serpapi",
    rawResponseSha256: params.rawResponseSha256,
    rawBytes: params.rawBytes,
    transportStatus: 200,
    canonicalSanitizedUrl: "https://serpapi.com/search.json?engine=google_trends&data_type=TIMESERIES",
    requestFingerprint: `test_fp_${Date.now()}`,
    requestTerm: params.term || "cat toy",
    region: params.region || "US",
    workspaceId: params.workspaceId || null,
    researchRunId: params.researchRunId || null,
    productId: params.productId || null,
    upstreamRequestId: params.receiptId,
    responseCapturedAt: params.issuedAt,
    requestCompletedAt: params.issuedAt,
    isTestSimulation: false,
  });
  if (!res.success || !res.attestation) {
    throw new Error(`Failed to create test signed live attestation: ${res.error}`);
  }
  return res.attestation;
}

