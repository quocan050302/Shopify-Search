/**
 * SWAI KH-02 — V12.4.3.7.19.3.2
 * Durable, Authentic Candidate Alias Authorization & Immutable Ledger Authority
 *
 * Implements a durable, append-only, tamper-evident and cryptographically authenticated
 * candidate alias approval subsystem:
 * - Canonical payload serialization and SHA-256 digest computation
 * - Dedicated purpose-scoped HMAC-SHA256 signing (operationScope: "KH02_DEMAND_ALIAS")
 * - Purpose and key-id separation: distinct from provider transport receipt keys
 * - Atomic filesystem ledger persistence with file locks and PID liveness checking
 * - Monotonic revocation: revoked approvals cannot be un-revoked or overwritten
 * - Idempotency on exact duplicate (same approvalId and identical digest)
 * - Conflict detection on same approvalId with mismatched payload
 * - Strict read-time verification: rejects unauthenticated caller strings, expired/revoked/future approvals,
 *   tampered payloads, key compromise, and scope/tenant/run/product/region/asOf mismatches
 */

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import {
  areExactOrCanonicalEquivalentQueries,
  normalizeCanonicalQuery,
} from "./providerObservationRawBinding";

export const ALIAS_SCHEMA_VERSION = "1.0" as const;
export const ALIAS_OPERATION_SCOPE = "KH02_DEMAND_ALIAS" as const;

export type AliasDecisionCode =
  | "VERIFIED_ALIAS"
  | "ALIAS_NOT_FOUND"
  | "APPROVAL_UNTRUSTED"
  | "INVALID_SIGNATURE"
  | "TAMPERED_PAYLOAD"
  | "REVOKED"
  | "EXPIRED"
  | "FUTURE_APPROVAL"
  | "SCOPE_MISMATCH"
  | "PRODUCT_IDENTITY_MISMATCH"
  | "RUN_SCOPE_MISMATCH"
  | "REGION_MISMATCH"
  | "KEYWORD_MISMATCH"
  | "TARGET_KEYWORD_MISMATCH"
  | "KEY_REVOKED"
  | "POST_AS_OF_CUTOFF"
  | "INVALID_SOURCE_EVIDENCE"
  | "CONFLICT_ERROR";

export interface CandidateAliasApprovalRecord {
  approvalId: string;
  schemaVersion: typeof ALIAS_SCHEMA_VERSION;
  operationScope: typeof ALIAS_OPERATION_SCOPE;
  candidateId: string;
  targetProductId: string | null;
  aliasKeyword: string;
  authorizedCanonicalKeyword: string;
  normalizedAliasQuery: string;
  normalizedCanonicalQuery: string;
  productFamily?: string | null;
  skuVariant?: string | null;
  workspaceId: string;
  researchRunId?: string | null;
  region: string;
  approverPrincipalId: string;
  issuerKeyId: string;
  signingAlgorithm: "HMAC-SHA256";
  approvedAt: string; // ISO date string
  effectiveAt: string; // ISO date string
  expiresAt?: string | null; // ISO date string
  revokedAt?: string | null; // ISO date string
  revocationReason?: string | null;
  revokedBy?: string | null;
  supersedes?: string | null;
  supersededBy?: string | null;
  evidenceChainReference: string; // e.g. "urn:swai:evidence:merchant_pdp_identity:..."
  payloadDigest: string; // SHA-256 of canonical payload string
  approvalSignature: string; // HMAC-SHA256 signature
  isTestOnly?: boolean;
}

export interface AliasVerificationContext {
  workspaceId?: string | null;
  candidateId?: string | null;
  canonicalProductId?: string | null;
  candidateCanonicalName?: string | null;
  researchRunId?: string | null;
  region?: string;
  asOfTimestamp?: string | Date | null;
  observationKeyword?: string | null;
}

export interface AliasVerificationDecision {
  valid: boolean;
  code: AliasDecisionCode;
  reason: string;
  record?: CandidateAliasApprovalRecord;
  isTestOnly?: boolean;
}

export interface KeyRegistryEntry {
  keyId: string;
  secret: string;
  status: "ACTIVE" | "REVOKED" | "COMPROMISED" | "TEST_ONLY";
  purpose: typeof ALIAS_OPERATION_SCOPE;
  description: string;
}

// Purpose-separated Alias Trust Registry (in-memory registered keys with env and test isolation)
const keyRegistry = new Map<string, KeyRegistryEntry>();

// Initialize default environment key if present
const defaultEnvKey = process.env.KH02_ALIAS_SIGNING_KEY;
if (defaultEnvKey && defaultEnvKey.trim().length >= 32) {
  keyRegistry.set("alias_prod_key_v1", {
    keyId: "alias_prod_key_v1",
    secret: defaultEnvKey.trim(),
    status: "ACTIVE",
    purpose: ALIAS_OPERATION_SCOPE,
    description: "Production primary candidate alias signing key",
  });
}

/**
 * Registers or updates a key in the Alias Trust Registry (for testing or key rotation).
 */
export function registerAliasSigningKey(entry: KeyRegistryEntry): void {
  if (process.env.NODE_ENV === "production" && entry.status === "TEST_ONLY") {
    throw new Error("SECURITY_VIOLATION: TEST_ONLY alias signing key cannot be registered in production.");
  }
  keyRegistry.set(entry.keyId, { ...entry });
}

export function getAliasSigningKey(keyId: string): KeyRegistryEntry | undefined {
  return keyRegistry.get(keyId);
}

export function clearTestAliasSigningKeys(): void {
  for (const [k, v] of keyRegistry.entries()) {
    if (v.status === "TEST_ONLY" || k.startsWith("test_")) {
      keyRegistry.delete(k);
    }
  }
}

/**
 * Canonical payload serialization for Alias Approval Record.
 * Delimited, deterministic, newline-separated representation with domain separator.
 */
export function computeCanonicalAliasPayload(
  r: Omit<CandidateAliasApprovalRecord, "payloadDigest" | "approvalSignature">
): string {
  const normAlias = normalizeCanonicalQuery(r.aliasKeyword);
  const normTarget = normalizeCanonicalQuery(r.authorizedCanonicalKeyword);
  const DOMAIN_SEPARATOR = "SWAI_KH02_ALIAS_APPROVAL_V1\n";

  const fields: [string, string][] = [
    ["approvalId", r.approvalId || ""],
    ["schemaVersion", r.schemaVersion || ALIAS_SCHEMA_VERSION],
    ["operationScope", r.operationScope || ALIAS_OPERATION_SCOPE],
    ["candidateId", r.candidateId || ""],
    ["targetProductId", r.targetProductId || ""],
    ["aliasKeyword", r.aliasKeyword || ""],
    ["authorizedCanonicalKeyword", r.authorizedCanonicalKeyword || ""],
    ["normalizedAliasQuery", normAlias],
    ["normalizedCanonicalQuery", normTarget],
    ["productFamily", r.productFamily || ""],
    ["skuVariant", r.skuVariant || ""],
    ["workspaceId", r.workspaceId || ""],
    ["researchRunId", r.researchRunId || ""],
    ["region", (r.region || "US").toUpperCase()],
    ["approverPrincipalId", r.approverPrincipalId || ""],
    ["issuerKeyId", r.issuerKeyId || ""],
    ["signingAlgorithm", r.signingAlgorithm || "HMAC-SHA256"],
    ["approvedAt", r.approvedAt || ""],
    ["effectiveAt", r.effectiveAt || ""],
    ["expiresAt", r.expiresAt || ""],
    ["evidenceChainReference", r.evidenceChainReference || ""],
    ["isTestOnly", r.isTestOnly ? "true" : "false"],
  ];

  return (
    DOMAIN_SEPARATOR +
    fields.map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join("\n") +
    "\n"
  );
}

/**
 * Computes the SHA-256 digest of the canonical payload.
 */
export function computeAliasPayloadDigest(
  r: Omit<CandidateAliasApprovalRecord, "payloadDigest" | "approvalSignature">
): string {
  const canonical = computeCanonicalAliasPayload(r);
  return crypto.createHash("sha256").update(canonical, "utf8").digest("hex");
}

/**
 * Signs the canonical payload digest using the registered purpose-scoped HMAC key.
 */
export function signAliasPayloadDigest(payloadDigest: string, secretKey: string): string {
  return crypto.createHmac("sha256", secretKey).update(payloadDigest, "utf8").digest("hex");
}

/**
 * Constant-time signature verification.
 */
export function verifyAliasSignature(
  expectedSignature: string,
  actualSignature: string
): boolean {
  if (!expectedSignature || !actualSignature) return false;
  const expBuf = Buffer.from(expectedSignature, "hex");
  const actBuf = Buffer.from(actualSignature, "hex");
  if (expBuf.length !== actBuf.length) return false;
  return crypto.timingSafeEqual(expBuf, actBuf);
}

// -------------------------------------------------------------------------------------
// Storage & Atomic Persistence
// -------------------------------------------------------------------------------------

export function getCandidateAliasStorageDir(): string {
  const configured =
    process.env.TEST_CANDIDATE_ALIAS_STORAGE_DIR ||
    process.env.CANDIDATE_ALIAS_STORAGE_DIR ||
    path.join(process.cwd(), "data", "candidate_aliases");
  if (!fs.existsSync(configured)) {
    fs.mkdirSync(configured, { recursive: true });
  }
  return configured;
}

function getCandidateAliasLedgerPath(): string {
  return path.join(getCandidateAliasStorageDir(), ".candidate_alias_ledger.json");
}

interface AliasLedgerLockInfo {
  ownerId: string;
  pid: number;
  hostname?: string;
  acquiredAt: number;
  expiresAt: number;
}

function isProcessAliveOnHost(pid: number | undefined): boolean {
  if (!pid || typeof pid !== "number" || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err: any) {
    return err?.code === "EPERM";
  }
}

function acquireAliasLedgerLock(maxWaitMs = 5000): { lockFile: string; release: () => void } {
  const dir = getCandidateAliasStorageDir();
  const lockFile = path.join(dir, ".candidate_alias_ledger.lock");
  const ownerId = `${process.pid}_${Date.now()}_${crypto.randomBytes(4).toString("hex")}`;
  const start = Date.now();

  while (Date.now() - start < maxWaitMs) {
    try {
      const lockData: AliasLedgerLockInfo = {
        ownerId,
        pid: process.pid,
        hostname: os.hostname(),
        acquiredAt: Date.now(),
        expiresAt: Date.now() + 8000,
      };
      fs.writeFileSync(lockFile, JSON.stringify(lockData), { flag: "wx" });
      return {
        lockFile,
        release: () => {
          try {
            if (fs.existsSync(lockFile)) {
              const current = JSON.parse(fs.readFileSync(lockFile, "utf-8"));
              if (current.ownerId === ownerId) {
                fs.unlinkSync(lockFile);
              }
            }
          } catch {}
        },
      };
    } catch (err: any) {
      if (err?.code === "EEXIST") {
        try {
          const raw = fs.readFileSync(lockFile, "utf-8");
          const info: AliasLedgerLockInfo = JSON.parse(raw);
          if (Date.now() > info.expiresAt && !isProcessAliveOnHost(info.pid)) {
            // Safe reclaim dead lock
            fs.unlinkSync(lockFile);
            continue;
          }
        } catch {}
        const sleepMs = 15 + Math.floor(Math.random() * 25);
        const waitUntil = Date.now() + sleepMs;
        while (Date.now() < waitUntil) {
          // busy spin wait for lock release
        }
      } else {
        throw err;
      }
    }
  }

  throw new Error(`LOCK_TIMEOUT: Failed to acquire candidate alias ledger lock within ${maxWaitMs}ms.`);
}

export interface AliasLedgerState {
  version: "1.0";
  approvals: Record<string, CandidateAliasApprovalRecord>;
  revocations: Record<string, { revokedAt: string; reason: string; revokedBy: string }>;
  updatedAt: string;
}

function readLedgerUnderLock(): AliasLedgerState {
  const p = getCandidateAliasLedgerPath();
  if (!fs.existsSync(p)) {
    return { version: "1.0", approvals: {}, revocations: {}, updatedAt: new Date().toISOString() };
  }
  try {
    const raw = fs.readFileSync(p, "utf-8");
    return JSON.parse(raw);
  } catch {
    return { version: "1.0", approvals: {}, revocations: {}, updatedAt: new Date().toISOString() };
  }
}

function writeLedgerUnderLock(state: AliasLedgerState): void {
  const p = getCandidateAliasLedgerPath();
  const tmp = `${p}.tmp_${process.pid}_${Date.now()}_${crypto.randomBytes(4).toString("hex")}`;
  state.updatedAt = new Date().toISOString();
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2), "utf-8");
  fs.renameSync(tmp, p);
}

// -------------------------------------------------------------------------------------
// Issuance, Revocation, and Persistence
// -------------------------------------------------------------------------------------

export interface CreateCandidateAliasApprovalInput {
  approvalId?: string;
  candidateId: string;
  targetProductId: string | null;
  aliasKeyword: string;
  authorizedCanonicalKeyword: string;
  productFamily?: string | null;
  skuVariant?: string | null;
  workspaceId: string;
  researchRunId?: string | null;
  region?: string;
  approverPrincipalId: string;
  issuerKeyId: string;
  effectiveAt?: string;
  expiresAt?: string | null;
  evidenceChainReference: string;
  isTestOnly?: boolean;
}

/**
 * Creates and cryptographically signs a CandidateAliasApprovalRecord.
 */
export function createSignedCandidateAliasApproval(
  input: CreateCandidateAliasApprovalInput
): CandidateAliasApprovalRecord {
  if (!input.candidateId || !input.candidateId.trim()) {
    throw new Error("INVALID_INPUT: candidateId is required.");
  }
  if (!input.aliasKeyword || !input.aliasKeyword.trim()) {
    throw new Error("INVALID_INPUT: aliasKeyword is required.");
  }
  if (!input.authorizedCanonicalKeyword || !input.authorizedCanonicalKeyword.trim()) {
    throw new Error("INVALID_INPUT: authorizedCanonicalKeyword is required.");
  }
  if (!input.workspaceId || !input.workspaceId.trim()) {
    throw new Error("INVALID_INPUT: workspaceId is required.");
  }
  if (!input.approverPrincipalId || !input.approverPrincipalId.trim()) {
    throw new Error("INVALID_INPUT: approverPrincipalId is required.");
  }
  if (!input.evidenceChainReference || !input.evidenceChainReference.trim()) {
    throw new Error("INVALID_INPUT: evidenceChainReference is required.");
  }

  const keyEntry = getAliasSigningKey(input.issuerKeyId);
  if (!keyEntry) {
    throw new Error(`APPROVAL_UNTRUSTED: Issuer keyId '${input.issuerKeyId}' is not registered in Alias Trust Registry.`);
  }
  if (keyEntry.status === "REVOKED" || keyEntry.status === "COMPROMISED") {
    throw new Error(`KEY_REVOKED: Issuer keyId '${input.issuerKeyId}' has status '${keyEntry.status}'.`);
  }

  const isTest = input.isTestOnly === true || keyEntry.status === "TEST_ONLY";
  const approvalId =
    input.approvalId ||
    `alias_appr_${Date.now()}_${crypto.randomBytes(6).toString("hex")}`;
  const nowIso = new Date().toISOString();

  const unsignedRecord: Omit<CandidateAliasApprovalRecord, "payloadDigest" | "approvalSignature"> = {
    approvalId,
    schemaVersion: ALIAS_SCHEMA_VERSION,
    operationScope: ALIAS_OPERATION_SCOPE,
    candidateId: input.candidateId.trim(),
    targetProductId: input.targetProductId ? input.targetProductId.trim() : null,
    aliasKeyword: input.aliasKeyword.trim(),
    authorizedCanonicalKeyword: input.authorizedCanonicalKeyword.trim(),
    normalizedAliasQuery: normalizeCanonicalQuery(input.aliasKeyword),
    normalizedCanonicalQuery: normalizeCanonicalQuery(input.authorizedCanonicalKeyword),
    productFamily: input.productFamily || null,
    skuVariant: input.skuVariant || null,
    workspaceId: input.workspaceId.trim(),
    researchRunId: input.researchRunId ? input.researchRunId.trim() : null,
    region: (input.region || "US").toUpperCase(),
    approverPrincipalId: input.approverPrincipalId.trim(),
    issuerKeyId: input.issuerKeyId,
    signingAlgorithm: "HMAC-SHA256",
    approvedAt: nowIso,
    effectiveAt: input.effectiveAt || nowIso,
    expiresAt: input.expiresAt || null,
    evidenceChainReference: input.evidenceChainReference.trim(),
    isTestOnly: isTest,
  };

  const payloadDigest = computeAliasPayloadDigest(unsignedRecord);
  const approvalSignature = signAliasPayloadDigest(payloadDigest, keyEntry.secret);

  return {
    ...unsignedRecord,
    payloadDigest,
    approvalSignature,
  };
}

/**
 * Atomically persists a signed CandidateAliasApprovalRecord to durable ledger.
 * Idempotent on exact duplicate (same approvalId + same digest).
 * Conflicts on same approvalId + different digest.
 */
export function persistCandidateAliasApprovalAtomically(
  record: CandidateAliasApprovalRecord
): { success: boolean; state: "PERSISTED" | "IDEMPOTENT_SKIP" | "CONFLICT"; record: CandidateAliasApprovalRecord; error?: string } {
  // Verify self integrity before write
  const expectedDigest = computeAliasPayloadDigest(record);
  if (record.payloadDigest !== expectedDigest) {
    return {
      success: false,
      state: "CONFLICT",
      record,
      error: `TAMPERED_PAYLOAD: Provided payloadDigest '${record.payloadDigest}' does not match recomputed digest '${expectedDigest}'.`,
    };
  }

  const key = getAliasSigningKey(record.issuerKeyId);
  if (!key) {
    return {
      success: false,
      state: "CONFLICT",
      record,
      error: `APPROVAL_UNTRUSTED: Issuer key '${record.issuerKeyId}' is not registered.`,
    };
  }
  const expectedSig = signAliasPayloadDigest(record.payloadDigest, key.secret);
  if (!verifyAliasSignature(expectedSig, record.approvalSignature)) {
    return {
      success: false,
      state: "CONFLICT",
      record,
      error: "INVALID_SIGNATURE: Signature verification failed.",
    };
  }

  const lock = acquireAliasLedgerLock();
  try {
    const ledger = readLedgerUnderLock();
    const existing = ledger.approvals[record.approvalId];

    if (existing) {
      if (existing.payloadDigest === record.payloadDigest) {
        // Idempotent exact duplicate
        return { success: true, state: "IDEMPOTENT_SKIP", record: existing };
      }
      // Conflicting duplicate with different payload
      return {
        success: false,
        state: "CONFLICT",
        record: existing,
        error: `CONFLICT_ERROR: Approval with ID '${record.approvalId}' already exists with different payload digest.`,
      };
    }

    // Persist new approval
    ledger.approvals[record.approvalId] = { ...record };
    writeLedgerUnderLock(ledger);
    return { success: true, state: "PERSISTED", record };
  } finally {
    lock.release();
  }
}

/**
 * Atomically revokes a candidate alias approval.
 * Monotonic: cannot be undone.
 */
export function revokeCandidateAliasAtomically(
  approvalId: string,
  reason: string,
  revokedBy: string
): { success: boolean; revokedAt: string } {
  const lock = acquireAliasLedgerLock();
  try {
    const ledger = readLedgerUnderLock();
    const existing = ledger.approvals[approvalId];
    const revokedAt = new Date().toISOString();

    if (existing) {
      existing.revokedAt = existing.revokedAt || revokedAt;
      existing.revocationReason = existing.revocationReason || reason;
      existing.revokedBy = existing.revokedBy || revokedBy;
    }

    ledger.revocations[approvalId] = {
      revokedAt: ledger.revocations[approvalId]?.revokedAt || revokedAt,
      reason,
      revokedBy,
    };

    writeLedgerUnderLock(ledger);
    return { success: true, revokedAt: ledger.revocations[approvalId].revokedAt };
  } finally {
    lock.release();
  }
}

/**
 * Retrieves a candidate alias approval by ID from the durable ledger.
 */
export function getCandidateAliasApprovalById(
  approvalId: string
): CandidateAliasApprovalRecord | null {
  const ledgerPath = getCandidateAliasLedgerPath();
  if (!fs.existsSync(ledgerPath)) return null;
  try {
    const raw = fs.readFileSync(ledgerPath, "utf-8");
    const state: AliasLedgerState = JSON.parse(raw);
    const item = state.approvals[approvalId];
    if (!item) return null;
    // Check if revocation is registered in revocations map
    if (state.revocations[approvalId]) {
      item.revokedAt = item.revokedAt || state.revocations[approvalId].revokedAt;
      item.revocationReason = item.revocationReason || state.revocations[approvalId].reason;
      item.revokedBy = item.revokedBy || state.revocations[approvalId].revokedBy;
    }
    return item;
  } catch {
    return null;
  }
}

// -------------------------------------------------------------------------------------
// Independent Read-Time Verification
// -------------------------------------------------------------------------------------

/**
 * Verifies a durable CandidateAliasApprovalRecord against live context and cryptographic requirements.
 */
export function verifyDurableCandidateAliasApproval(
  approvalIdOrRef: string,
  context: AliasVerificationContext
): AliasVerificationDecision {
  if (!approvalIdOrRef || typeof approvalIdOrRef !== "string" || !approvalIdOrRef.trim()) {
    return {
      valid: false,
      code: "ALIAS_NOT_FOUND",
      reason: "No approvalId or reference string provided for alias verification.",
    };
  }

  // Extract approvalId from reference string (e.g. "alias_appr_123" or "urn:swai:alias:alias_appr_123")
  const cleanRef = approvalIdOrRef.trim();
  const extractedId = cleanRef.replace(/^(?:urn:swai:alias:|gov_decision_ref_|ref:)/i, "").split(":")[0];
  const targetId = extractedId.startsWith("alias_appr_") ? extractedId : cleanRef;

  const record = getCandidateAliasApprovalById(targetId) || getCandidateAliasApprovalById(cleanRef);
  if (!record) {
    return {
      valid: false,
      code: "ALIAS_NOT_FOUND",
      reason: `No durable signed alias approval record found matching identifier '${cleanRef}'. Plain reference strings are unverified.`,
    };
  }

  // 1. Operation scope check
  if (record.operationScope !== ALIAS_OPERATION_SCOPE) {
    return {
      valid: false,
      code: "SCOPE_MISMATCH",
      reason: `Approval operationScope '${record.operationScope}' is not '${ALIAS_OPERATION_SCOPE}'.`,
      record,
    };
  }

  // 2. Issuer key check in Trust Registry
  const key = getAliasSigningKey(record.issuerKeyId);
  if (!key) {
    return {
      valid: false,
      code: "APPROVAL_UNTRUSTED",
      reason: `Issuer keyId '${record.issuerKeyId}' is not registered in the Alias Trust Registry.`,
      record,
    };
  }
  if (key.status === "REVOKED" || key.status === "COMPROMISED") {
    return {
      valid: false,
      code: "KEY_REVOKED",
      reason: `Issuer keyId '${record.issuerKeyId}' has been revoked or compromised (status: ${key.status}).`,
      record,
    };
  }

  // 3. Payload integrity check (recompute digest)
  const expectedDigest = computeAliasPayloadDigest(record);
  if (record.payloadDigest !== expectedDigest) {
    return {
      valid: false,
      code: "TAMPERED_PAYLOAD",
      reason: `Payload digest mismatch: stored '${record.payloadDigest}' does not match canonical recomputed digest '${expectedDigest}'.`,
      record,
    };
  }

  // 4. Cryptographic signature check
  const expectedSig = signAliasPayloadDigest(record.payloadDigest, key.secret);
  if (!verifyAliasSignature(expectedSig, record.approvalSignature)) {
    return {
      valid: false,
      code: "INVALID_SIGNATURE",
      reason: "Cryptographic signature verification failed for alias approval payload.",
      record,
    };
  }

  // 5. Revocation check
  if (record.revokedAt) {
    return {
      valid: false,
      code: "REVOKED",
      reason: `Alias approval was revoked on ${record.revokedAt} (reason: ${record.revocationReason || "no reason specified"}).`,
      record,
    };
  }

  // 6. Temporal checks (effectiveAt, expiresAt)
  const nowTime = Date.now();
  if (record.effectiveAt) {
    const effTime = new Date(record.effectiveAt).getTime();
    if (!isNaN(effTime) && effTime > nowTime) {
      return {
        valid: false,
        code: "FUTURE_APPROVAL",
        reason: `Alias approval is not yet effective (effectiveAt: ${record.effectiveAt}).`,
        record,
      };
    }
  }
  if (record.expiresAt) {
    const expTime = new Date(record.expiresAt).getTime();
    if (!isNaN(expTime) && expTime <= nowTime) {
      return {
        valid: false,
        code: "EXPIRED",
        reason: `Alias approval has expired (expiresAt: ${record.expiresAt}).`,
        record,
      };
    }
  }

  // 7. Point-in-time / asOf cutoff check
  if (context.asOfTimestamp && record.approvedAt) {
    const asOfTime = new Date(context.asOfTimestamp).getTime();
    const appTime = new Date(record.approvedAt).getTime();
    if (!isNaN(asOfTime) && !isNaN(appTime) && appTime > asOfTime) {
      return {
        valid: false,
        code: "POST_AS_OF_CUTOFF",
        reason: `Alias approval date '${record.approvedAt}' is after the evaluation asOf cutoff '${context.asOfTimestamp}'.`,
        record,
      };
    }
  }

  // 8. Scope & Context matching
  if (context.workspaceId && record.workspaceId && record.workspaceId !== context.workspaceId) {
    return {
      valid: false,
      code: "SCOPE_MISMATCH",
      reason: `Approval workspaceId '${record.workspaceId}' does not match context workspaceId '${context.workspaceId}'.`,
      record,
    };
  }

  if (context.candidateId && record.candidateId && record.candidateId !== context.candidateId) {
    return {
      valid: false,
      code: "SCOPE_MISMATCH",
      reason: `Approval candidateId '${record.candidateId}' does not match context candidateId '${context.candidateId}'.`,
      record,
    };
  }

  if (context.canonicalProductId && record.targetProductId && record.targetProductId !== context.canonicalProductId) {
    return {
      valid: false,
      code: "PRODUCT_IDENTITY_MISMATCH",
      reason: `Approval targetProductId '${record.targetProductId}' does not match context canonicalProductId '${context.canonicalProductId}'.`,
      record,
    };
  }

  if (context.researchRunId && record.researchRunId && record.researchRunId !== context.researchRunId) {
    return {
      valid: false,
      code: "RUN_SCOPE_MISMATCH",
      reason: `Approval researchRunId '${record.researchRunId}' does not match context researchRunId '${context.researchRunId}'.`,
      record,
    };
  }

  if (context.region && record.region && record.region.toUpperCase() !== context.region.toUpperCase()) {
    return {
      valid: false,
      code: "REGION_MISMATCH",
      reason: `Approval region '${record.region}' does not match context region '${context.region}'.`,
      record,
    };
  }

  if (context.observationKeyword && !areExactOrCanonicalEquivalentQueries(record.aliasKeyword, context.observationKeyword)) {
    return {
      valid: false,
      code: "KEYWORD_MISMATCH",
      reason: `Approval aliasKeyword '${record.aliasKeyword}' does not canonically match observation keyword '${context.observationKeyword}'.`,
      record,
    };
  }

  if (context.candidateCanonicalName && !areExactOrCanonicalEquivalentQueries(record.authorizedCanonicalKeyword, context.candidateCanonicalName)) {
    return {
      valid: false,
      code: "TARGET_KEYWORD_MISMATCH",
      reason: `Approval authorized target '${record.authorizedCanonicalKeyword}' does not canonically match candidate name '${context.candidateCanonicalName}'.`,
      record,
    };
  }

  return {
    valid: true,
    code: "VERIFIED_ALIAS",
    reason: `Durable alias approval '${record.approvalId}' is authentic, signed by '${record.issuerKeyId}', and matches context scope.`,
    record,
    isTestOnly: record.isTestOnly === true,
  };
}
