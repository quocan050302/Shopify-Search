/**
 * SWAI KH-02 — Durable Official CSV Import Authority
 *
 * Implements a fail-closed, cryptographically signed, workspace- and product-bound,
 * monotonically revocable authority ledger for Official Google Trends CSV Exports.
 *
 * Core Invariants (Section 5.1 - 5.3):
 * 1. Raw file existence, SHA-256 checksum match, valid CSV schema, and raw row match
 *    prove ONLY `contentIntegrityVerified = true` (`LOCAL_INTEGRITY_ONLY`).
 * 2. They NEVER automatically prove `sourceOriginVerified = true` or `businessEligible = true`.
 * 3. `providerOriginVerified` is ALWAYS `false` for CSV imports because a local signature
 *    only proves that our system signed the review/import record and that it was not tampered with;
 *    it does NOT prove Google LLC cryptographically signed the CSV bytes.
 * 4. To be accepted as `HISTORICAL_SOURCE_VERIFIED` in `BUSINESS` scope, a CSV must have both:
 *    (a) verified disk file + SHA-256 + schema + row integrity, AND
 *    (b) a verified, non-revoked, non-test-only `OfficialCsvImportAuthorityRecord` bound to the
 *        exact `rawCsvSha256`, `artifactPath`, `importEventId`, `importedAt`, `importingPrincipalId`,
 *        `approverPrincipalId`, `workspaceId`, `targetProductId`, `query`, `geography`,
 *        `periodStart`..`periodEnd`, and `cadence`.
 * 5. Collector, importer, CI, and test runners NEVER auto-approve arbitrary CSV uploads.
 * 6. `TEST_ONLY` / `ENGINEERING` authority records are strictly fenced and rejected in `BUSINESS` scope.
 */

import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import { verifyStoredCsvFile } from "./googleTrendsCsvValidator";

export const CSV_AUTHORITY_SCHEMA_VERSION = "2.0" as const;
export type CsvAuthoritySchemaVersion = "1.0" | "2.0";
export const CSV_AUTHORITY_OPERATION_SCOPE = "KH02_OFFICIAL_CSV_IMPORT_AUTHORITY_V1" as const;

export type CsvOriginClassification =
  | "AUTHENTICATED_OFFICIAL_EXPORT"
  | "USER_UPLOADED_UNATTESTED"
  | "LOCAL_INTEGRITY_ONLY"
  | "UNIT_FIXTURE"
  | "SIMULATED_TRANSPORT"
  | "UNKNOWN_UNVERIFIED";

export type CsvReviewStatus =
  | "APPROVED"
  | "PENDING_REVIEW"
  | "REJECTED"
  | "UNREVIEWED";

export type CsvCadence = "DAILY" | "WEEKLY" | "MONTHLY" | "IRREGULAR";

export type CsvAuthorityKeyStatus = "ACTIVE" | "REVOKED" | "COMPROMISED" | "TEST_ONLY";

export interface CsvAuthoritySigningKeyEntry {
  keyId: string;
  secret: string;
  status: CsvAuthorityKeyStatus;
  purpose: typeof CSV_AUTHORITY_OPERATION_SCOPE;
  description?: string;
  isBusinessTrusted: boolean;
}

export interface OfficialCsvImportAuthorityRecord {
  authorityId: string;
  schemaVersion: CsvAuthoritySchemaVersion;
  operationScope: typeof CSV_AUTHORITY_OPERATION_SCOPE;
  importEventId: string;
  rawCsvSha256: string;
  artifactPath: string;
  importedAt: string;
  availableAt: string;
  importingPrincipalId: string;
  approverPrincipalId: string | null;
  approvedAt: string | null;
  workspaceId: string;
  targetProductId: string;
  candidateId: string | null;
  query: string;
  normalizedQuery: string;
  geography: string;
  periodStart: string;
  periodEnd: string;
  cadence: CsvCadence;
  dataPointsCount: number;
  originClassification: CsvOriginClassification;
  reviewStatus: CsvReviewStatus;
  verificationMethod: string;
  verificationLimitation: string;
  evidenceChainReference: string;
  acquisitionSourceUrl?: string | null;
  acquisitionEvidenceRef?: string | null;
  acquisitionCapturedAt?: string | null;
  acquisitionMethod?: string | null;
  isTestOnly: boolean;
  issuerKeyId: string;
  signingAlgorithm: "HMAC-SHA256";
  payloadDigest: string;
  authoritySignature: string;
}

export type CsvAuthorityDecisionCode =
  | "VERIFIED_OFFICIAL_CSV_AUTHORITY"
  | "VERIFIED_ENGINEERING_TEST_CSV_AUTHORITY"
  | "AUTHORITY_NOT_FOUND"
  | "AUTHORITY_REVOKED"
  | "KEY_UNTRUSTED"
  | "KEY_REVOKED"
  | "TAMPERED_PAYLOAD"
  | "INVALID_SIGNATURE"
  | "WRONG_OPERATION_SCOPE"
  | "ORIGIN_NOT_OFFICIAL_EXPORT"
  | "REVIEW_NOT_APPROVED"
  | "TEST_ONLY_REJECTED_IN_BUSINESS_SCOPE"
  | "KNOWN_FIXTURE_REJECTED"
  | "RAW_SHA_MISMATCH"
  | "ARTIFACT_MISSING_OR_CORRUPT"
  | "ARTIFACT_PATH_MISMATCH"
  | "WORKSPACE_MISMATCH"
  | "PRODUCT_MISMATCH"
  | "CANDIDATE_MISMATCH"
  | "QUERY_MISMATCH"
  | "REGION_MISMATCH"
  | "PERIOD_OUT_OF_RANGE"
  | "IMPORT_AFTER_CUTOFF"
  | "AVAILABLE_AFTER_CUTOFF"
  | "APPROVAL_AFTER_CUTOFF"
  | "PERIOD_END_AFTER_CUTOFF"
  | "LEDGER_CORRUPT"
  | "LEDGER_UNREADABLE"
  | "CONFLICT_ERROR";

export interface CsvAuthorityVerificationResult {
  verified: boolean;
  sourceOriginVerified: boolean;
  businessEligible: boolean;
  providerOriginVerified: false;
  originClassification: CsvOriginClassification;
  code: CsvAuthorityDecisionCode;
  reason: string;
  tamperDetected?: boolean;
  record?: OfficialCsvImportAuthorityRecord;
}

/**
 * Known repository unit-test fixture CSV hashes (Defense-in-Depth supplement).
 * Note: Core security does NOT rely on this set; any CSV without a verified
 * OfficialCsvImportAuthorityRecord fails closed as LOCAL_INTEGRITY_ONLY.
 * This set additionally prevents anyone from accidentally or maliciously
 * minting a BUSINESS-trusted authority record over a tracked test fixture.
 */
export const KNOWN_REPOSITORY_FIXTURE_CSV_SHAS = new Set<string>([
  "f300258f9ea08da45034f449ade0c43d643cf280838d0f370a264d6805826d39",
  "49f452e8413178ee0b3e1e2d42c2fd495693b552f211bc908a16511b63302109",
  "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08",
]);

export function isKnownRepositoryFixtureCsvSha(sha256: string | null | undefined): boolean {
  if (!sha256) return false;
  return KNOWN_REPOSITORY_FIXTURE_CSV_SHAS.has(String(sha256).trim().toLowerCase());
}

// -------------------------------------------------------------------------------------
// Purpose-Separated Signing Key Registry
// -------------------------------------------------------------------------------------

const testCsvAuthorityKeys = new Map<string, CsvAuthoritySigningKeyEntry>();

export function registerCsvAuthoritySigningKey(entry: CsvAuthoritySigningKeyEntry): void {
  if (!entry.keyId || !entry.secret || entry.secret.length < 32) {
    throw new Error("INVALID_CSV_AUTHORITY_KEY: keyId and secret (>= 32 chars) are required.");
  }
  if (entry.purpose !== CSV_AUTHORITY_OPERATION_SCOPE) {
    throw new Error(
      `WRONG_KEY_PURPOSE: Key '${entry.keyId}' purpose '${entry.purpose}' does not match '${CSV_AUTHORITY_OPERATION_SCOPE}'.`
    );
  }
  const envKeyId = process.env.KH02_CSV_AUTHORITY_KEY_ID?.trim();
  if (envKeyId && entry.keyId.trim() === envKeyId) {
    throw new Error(
      `KEY_SHADOW_REJECTED: Test key registry cannot register or shadow active environment issuer keyId '${envKeyId}'.`
    );
  }
  // Security boundary (V19.3.3.1 P0): In-memory programmatic registration is strictly fenced to TEST_ONLY / non-business scope.
  // Business-trusted keys MUST come exclusively from out-of-band environment secrets (KH02_CSV_AUTHORITY_KEY_ID / KH02_CSV_AUTHORITY_HMAC_SECRET).
  const safeStatus: CsvAuthorityKeyStatus =
    entry.status === "REVOKED" || entry.status === "COMPROMISED" ? entry.status : "TEST_ONLY";
  testCsvAuthorityKeys.set(entry.keyId, {
    ...entry,
    status: safeStatus,
    isBusinessTrusted: false,
  });
}

export function clearTestCsvAuthoritySigningKeys(): void {
  testCsvAuthorityKeys.clear();
}

export function getCsvAuthoritySigningKey(
  keyId: string,
  scope: "BUSINESS" | "ENGINEERING" = "BUSINESS"
): CsvAuthoritySigningKeyEntry | null {
  if (!keyId) return null;

  // Always resolve environment-configured business issuer key first so test keys can never shadow it
  const envKeyId = process.env.KH02_CSV_AUTHORITY_KEY_ID?.trim();
  const envSecret = process.env.KH02_CSV_AUTHORITY_HMAC_SECRET?.trim();
  const envStatus = (process.env.KH02_CSV_AUTHORITY_KEY_STATUS?.trim() || "ACTIVE") as CsvAuthorityKeyStatus;

  if (envKeyId && envSecret && envSecret.length >= 32 && envKeyId === keyId) {
    return {
      keyId: envKeyId,
      secret: envSecret,
      status: envStatus,
      purpose: CSV_AUTHORITY_OPERATION_SCOPE,
      isBusinessTrusted: envStatus === "ACTIVE",
    };
  }

  if (testCsvAuthorityKeys.has(keyId)) {
    const testEntry = testCsvAuthorityKeys.get(keyId)!;
    return {
      ...testEntry,
      status:
        testEntry.status === "REVOKED" || testEntry.status === "COMPROMISED"
          ? testEntry.status
          : "TEST_ONLY",
      isBusinessTrusted: false,
    };
  }

  return null;
}

export function getAuthorizedCsvApproverPrincipals(): string[] {
  const raw =
    process.env.KH02_AUTHORIZED_CSV_APPROVER_PRINCIPALS ||
    process.env.KH02_AUTHORIZED_APPROVER_PRINCIPALS ||
    "";
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

export function normalizeCsvAuthorityQuery(q: string | null | undefined): string {
  return String(q || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function normalizeCsvAuthorityGeography(geo: string | null | undefined): string {
  const cleaned = String(geo || "").trim().toUpperCase();
  if (cleaned === "UNITED STATES" || cleaned === "USA" || cleaned === "US") {
    return "US";
  }
  return cleaned;
}

export function validateOfficialGoogleTrendsAcquisitionUrl(
  rawUrl: unknown,
  expectedQuery?: string | null,
  expectedGeo?: string | null
): string {
  if (rawUrl === undefined || rawUrl === null || typeof rawUrl !== "string" || !rawUrl.trim()) {
    throw new Error(
      "ACQUISITION_SOURCE_REQUIRED: Verified official Google Trends acquisitionSourceUrl (https://trends.google.com/trends/...) is required for BUSINESS-scope AUTHENTICATED_OFFICIAL_EXPORT."
    );
  }
  const trimmed = rawUrl.trim();
  if (!/^https:\/\/trends\.google\.com\/trends\//i.test(trimmed)) {
    throw new Error(
      `INVALID_ACQUISITION_SOURCE_URL: URL '${trimmed}' must use https://trends.google.com/trends/... without userinfo, IP literal, or custom port.`
    );
  }
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(trimmed);
  } catch {
    throw new Error(`INVALID_ACQUISITION_SOURCE_URL: Malformed URL '${trimmed}'.`);
  }
  if (
    parsedUrl.origin.toLowerCase() !== "https://trends.google.com" ||
    parsedUrl.protocol !== "https:" ||
    parsedUrl.hostname.toLowerCase() !== "trends.google.com" ||
    parsedUrl.username !== "" ||
    parsedUrl.password !== "" ||
    parsedUrl.port !== "" ||
    !/^\/trends\/explore(?:\/|$)/i.test(parsedUrl.pathname)
  ) {
    throw new Error(
      `INVALID_ACQUISITION_SOURCE_URL: URL '${trimmed}' failed strict origin/path validation (requires https://trends.google.com/trends/explore).`
    );
  }

  const geoValues = parsedUrl.searchParams.getAll("geo");
  if (geoValues.length === 0) {
    throw new Error(
      "ACQUISITION_GEO_REQUIRED: Official Google Trends Explore URL must include a non-empty 'geo' query parameter."
    );
  }
  if (geoValues.length > 1) {
    throw new Error(
      "AMBIGUOUS_ACQUISITION_PARAMETERS: Official Google Trends Explore URL contains duplicate 'geo' query parameters."
    );
  }
  const rawGeo = String(geoValues[0] || "").trim();
  if (!rawGeo) {
    throw new Error(
      "ACQUISITION_GEO_REQUIRED: Official Google Trends Explore URL 'geo' query parameter cannot be empty or whitespace."
    );
  }
  if (/%[0-9a-fA-F]{2}/.test(rawGeo) || rawGeo.includes(",")) {
    throw new Error(
      `AMBIGUOUS_ACQUISITION_PARAMETERS: Acquisition URL geo '${rawGeo}' contains ambiguous encoding or multiple regions.`
    );
  }
  const urlGeo = normalizeCsvAuthorityGeography(rawGeo);
  const expGeo = normalizeCsvAuthorityGeography(expectedGeo || "US");
  if (urlGeo !== expGeo || urlGeo !== "US") {
    throw new Error(
      `ACQUISITION_GEO_MISMATCH: Acquisition URL geo '${urlGeo}' does not match authority geography '${expGeo}' (national US required).`
    );
  }

  const qValues = parsedUrl.searchParams.getAll("q");
  if (qValues.length === 0) {
    throw new Error(
      "ACQUISITION_QUERY_REQUIRED: Official Google Trends Explore URL must include a non-empty 'q' query parameter."
    );
  }
  if (qValues.length > 1) {
    throw new Error(
      "AMBIGUOUS_ACQUISITION_PARAMETERS: Official Google Trends Explore URL contains duplicate 'q' query parameters."
    );
  }
  const rawQ = String(qValues[0] || "").trim();
  if (!rawQ) {
    throw new Error(
      "ACQUISITION_QUERY_REQUIRED: Official Google Trends Explore URL 'q' query parameter cannot be empty or whitespace."
    );
  }
  if (/%[0-9a-fA-F]{2}/.test(rawQ) || rawQ.includes(",")) {
    throw new Error(
      `AMBIGUOUS_ACQUISITION_PARAMETERS: Acquisition URL query '${rawQ}' contains ambiguous double-encoding or multiple comma-separated terms.`
    );
  }
  const urlQ = normalizeCsvAuthorityQuery(rawQ);
  if (!urlQ) {
    throw new Error(
      "ACQUISITION_QUERY_REQUIRED: Normalized acquisition URL query 'q' cannot be empty."
    );
  }
  if (expectedQuery !== undefined && expectedQuery !== null) {
    const expQ = normalizeCsvAuthorityQuery(expectedQuery);
    if (!expQ || urlQ !== expQ) {
      throw new Error(
        `ACQUISITION_QUERY_MISMATCH: Acquisition URL query '${urlQ}' does not exactly match authority query '${expQ}'.`
      );
    }
  }

  return trimmed;
}

// -------------------------------------------------------------------------------------
// Canonical Serialization & HMAC Signing
// -------------------------------------------------------------------------------------

const CSV_AUTHORITY_DOMAIN_SEPARATOR_V1 = "SWAI_KH02_CSV_IMPORT_AUTHORITY_V1\n";
const CSV_AUTHORITY_DOMAIN_SEPARATOR_V2 = "SWAI_KH02_CSV_IMPORT_AUTHORITY_V2\n";

export function computeCanonicalCsvAuthorityPayload(
  r: Omit<OfficialCsvImportAuthorityRecord, "payloadDigest" | "authoritySignature">
): string {
  const isV1 = r.schemaVersion === "1.0";
  const fields: Array<[string, string]> = [
    ["authorityId", r.authorityId],
    ["schemaVersion", r.schemaVersion],
    ["operationScope", r.operationScope],
    ["importEventId", r.importEventId],
    ["rawCsvSha256", r.rawCsvSha256.toLowerCase()],
    ["artifactPath", r.artifactPath],
    ["importedAt", r.importedAt],
    ["availableAt", r.availableAt],
    ["importingPrincipalId", r.importingPrincipalId],
    ["approverPrincipalId", r.approverPrincipalId || ""],
    ["approvedAt", r.approvedAt || ""],
    ["workspaceId", r.workspaceId],
    ["targetProductId", r.targetProductId],
    ["candidateId", r.candidateId || ""],
    ["query", r.query],
    ["normalizedQuery", r.normalizedQuery],
    ["geography", r.geography],
    ["periodStart", r.periodStart],
    ["periodEnd", r.periodEnd],
    ["cadence", r.cadence],
    ["dataPointsCount", String(r.dataPointsCount)],
    ["originClassification", r.originClassification],
    ["reviewStatus", r.reviewStatus],
    ["verificationMethod", r.verificationMethod],
    ["verificationLimitation", r.verificationLimitation],
    ["evidenceChainReference", r.evidenceChainReference],
  ];

  if (!isV1) {
    fields.push(
      ["acquisitionSourceUrl", r.acquisitionSourceUrl || ""],
      ["acquisitionEvidenceRef", r.acquisitionEvidenceRef || ""],
      ["acquisitionCapturedAt", r.acquisitionCapturedAt || ""],
      ["acquisitionMethod", r.acquisitionMethod || ""]
    );
  }

  fields.push(
    ["isTestOnly", r.isTestOnly ? "true" : "false"],
    ["issuerKeyId", r.issuerKeyId],
    ["signingAlgorithm", r.signingAlgorithm]
  );

  const separator = isV1 ? CSV_AUTHORITY_DOMAIN_SEPARATOR_V1 : CSV_AUTHORITY_DOMAIN_SEPARATOR_V2;

  return (
    separator +
    fields.map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join("\n") +
    "\n"
  );
}

export function computeCsvAuthorityPayloadDigest(
  r: Omit<OfficialCsvImportAuthorityRecord, "payloadDigest" | "authoritySignature">
): string {
  const canonical = computeCanonicalCsvAuthorityPayload(r);
  return crypto.createHash("sha256").update(canonical, "utf8").digest("hex");
}

export function signCsvAuthorityPayloadDigest(payloadDigest: string, secretKey: string): string {
  return crypto.createHmac("sha256", secretKey).update(payloadDigest, "utf8").digest("hex");
}

export function verifyCsvAuthoritySignature(
  expectedSignature: string,
  actualSignature: string
): boolean {
  if (!expectedSignature || !actualSignature) return false;
  try {
    const expBuf = Buffer.from(expectedSignature, "hex");
    const actBuf = Buffer.from(actualSignature, "hex");
    if (expBuf.length === 0 || expBuf.length !== actBuf.length) return false;
    return crypto.timingSafeEqual(expBuf, actBuf);
  } catch {
    return false;
  }
}

// -------------------------------------------------------------------------------------
// Durable Ledger Storage & Atomic Lock
// -------------------------------------------------------------------------------------

export function getCsvAuthorityStorageDir(): string {
  const configured =
    process.env.TEST_CSV_AUTHORITY_STORAGE_DIR ||
    process.env.CSV_AUTHORITY_STORAGE_DIR ||
    path.join(process.cwd(), "data", "csv_import_authority");
  if (!fs.existsSync(configured)) {
    fs.mkdirSync(configured, { recursive: true });
  }
  return configured;
}

export function getCsvAuthorityLedgerPath(): string {
  return path.join(getCsvAuthorityStorageDir(), ".csv_import_authority_ledger.json");
}

export interface CsvAuthorityLedgerState {
  version: CsvAuthoritySchemaVersion;
  records: Record<string, OfficialCsvImportAuthorityRecord>;
  revocations: Record<string, { revokedAt: string; reason: string; revokedBy: string }>;
  updatedAt: string;
}

export type CsvLedgerStorageStatus =
  | "LEDGER_HEALTHY"
  | "LEDGER_NOT_INITIALIZED"
  | "LEDGER_CORRUPT"
  | "LEDGER_UNREADABLE";

export interface ReadCsvLedgerResult {
  status: CsvLedgerStorageStatus;
  state: CsvAuthorityLedgerState | null;
  error?: string;
}

interface CsvLedgerLockInfo {
  ownerId: string;
  pid: number;
  hostname: string;
  acquiredAt: number;
  expiresAt: number;
}

function isProcessAliveOnLocalHost(pid: number | undefined): boolean {
  if (!pid || typeof pid !== "number" || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err: any) {
    return err?.code === "EPERM";
  }
}

function acquireCsvAuthorityLedgerLock(maxWaitMs = 5000): { lockFile: string; release: () => void } {
  const dir = getCsvAuthorityStorageDir();
  const lockFile = path.join(dir, ".csv_import_authority_ledger.lock");
  const ownerId = `${process.pid}_${Date.now()}_${crypto.randomBytes(4).toString("hex")}`;
  const start = Date.now();
  const myHostname = os.hostname();

  while (Date.now() - start < maxWaitMs) {
    try {
      const lockData: CsvLedgerLockInfo = {
        ownerId,
        pid: process.pid,
        hostname: myHostname,
        acquiredAt: Date.now(),
        expiresAt: Date.now() + 8000,
      };
      fs.writeFileSync(lockFile, JSON.stringify(lockData), { flag: "wx" });
      return {
        lockFile,
        release: () => {
          try {
            if (fs.existsSync(lockFile)) {
              const current = JSON.parse(fs.readFileSync(lockFile, "utf8"));
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
          const raw = fs.readFileSync(lockFile, "utf8");
          const info: CsvLedgerLockInfo = JSON.parse(raw);
          if (Date.now() > info.expiresAt) {
            if (info.hostname && info.hostname !== myHostname) {
              // Do not reclaim foreign host lock
            } else if (!isProcessAliveOnLocalHost(info.pid)) {
              fs.unlinkSync(lockFile);
              continue;
            }
          }
        } catch {}
        const sleepMs = 15 + Math.floor(Math.random() * 25);
        const waitUntil = Date.now() + sleepMs;
        while (Date.now() < waitUntil) {
          // spin wait
        }
      } else {
        throw err;
      }
    }
  }

  throw new Error(`LOCK_TIMEOUT: Failed to acquire CSV import authority ledger lock within ${maxWaitMs}ms.`);
}

export function readCsvAuthorityLedgerUnderLock(): ReadCsvLedgerResult {
  const dir = getCsvAuthorityStorageDir();
  try {
    const dirStat = fs.lstatSync(dir);
    if (dirStat.isSymbolicLink()) {
      return {
        status: "LEDGER_UNREADABLE",
        state: null,
        error: "SECURITY_VIOLATION: CSV authority storage directory is a symbolic link.",
      };
    }
  } catch (err: any) {
    return {
      status: "LEDGER_UNREADABLE",
      state: null,
      error: `IO_ERROR checking CSV authority storage directory: ${err?.message}`,
    };
  }

  const p = getCsvAuthorityLedgerPath();
  try {
    const fileStat = fs.lstatSync(p);
    if (fileStat.isSymbolicLink()) {
      return {
        status: "LEDGER_UNREADABLE",
        state: null,
        error: "SECURITY_VIOLATION: CSV authority ledger file is a symbolic link.",
      };
    }
  } catch (err: any) {
    if (err?.code === "ENOENT") {
      return {
        status: "LEDGER_NOT_INITIALIZED",
        state: {
          version: CSV_AUTHORITY_SCHEMA_VERSION,
          records: {},
          revocations: {},
          updatedAt: new Date().toISOString(),
        },
      };
    }
    return {
      status: "LEDGER_UNREADABLE",
      state: null,
      error: `IO_ERROR lstat CSV authority ledger: ${err?.message}`,
    };
  }

  let raw: string;
  try {
    raw = fs.readFileSync(p, "utf8");
  } catch (err: any) {
    return {
      status: "LEDGER_UNREADABLE",
      state: null,
      error: `IO_ERROR reading CSV authority ledger: ${err?.message}`,
    };
  }

  try {
    const parsed = JSON.parse(raw);
    if (
      !parsed ||
      typeof parsed !== "object" ||
      typeof parsed.records !== "object" ||
      parsed.records === null ||
      typeof parsed.revocations !== "object" ||
      parsed.revocations === null
    ) {
      return {
        status: "LEDGER_CORRUPT",
        state: null,
        error: "SCHEMA_CORRUPTION: CSV authority ledger missing records or revocations map.",
      };
    }
    return {
      status: "LEDGER_HEALTHY",
      state: parsed as CsvAuthorityLedgerState,
    };
  } catch (err: any) {
    return {
      status: "LEDGER_CORRUPT",
      state: null,
      error: `JSON_SYNTAX_ERROR: Failed to parse CSV authority ledger: ${err?.message}`,
    };
  }
}

function writeCsvAuthorityLedgerUnderLock(state: CsvAuthorityLedgerState): void {
  const dir = getCsvAuthorityStorageDir();
  if (fs.lstatSync(dir).isSymbolicLink()) {
    throw new Error("LEDGER_UNREADABLE: CSV authority storage directory is a symbolic link.");
  }
  const p = getCsvAuthorityLedgerPath();
  try {
    if (fs.lstatSync(p).isSymbolicLink()) {
      throw new Error("LEDGER_UNREADABLE: CSV authority ledger file is a symbolic link.");
    }
  } catch (err: any) {
    if (err?.code !== "ENOENT") throw err;
  }
  const tmp = `${p}.tmp_${process.pid}_${Date.now()}_${crypto.randomBytes(4).toString("hex")}`;
  state.updatedAt = new Date().toISOString();
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2), "utf8");
  fs.renameSync(tmp, p);
}

// -------------------------------------------------------------------------------------
// Issuance, Persistence, Revocation, and Verification
// -------------------------------------------------------------------------------------

export interface CreateCsvImportAuthorityInput {
  authorityId?: string;
  importEventId?: string;
  rawCsvSha256: string;
  artifactPath: string;
  importedAt?: string;
  availableAt?: string;
  importingPrincipalId: string;
  approverPrincipalId?: string | null;
  approvedAt?: string | null;
  workspaceId: string;
  targetProductId: string;
  candidateId?: string | null;
  query: string;
  geography?: string;
  periodStart: string;
  periodEnd: string;
  cadence?: CsvCadence;
  dataPointsCount: number;
  originClassification: CsvOriginClassification;
  reviewStatus: CsvReviewStatus;
  verificationMethod: string;
  verificationLimitation?: string;
  evidenceChainReference: string;
  acquisitionSourceUrl?: string | null;
  acquisitionEvidenceRef?: string | null;
  acquisitionCapturedAt?: string | null;
  acquisitionMethod?: string | null;
  issuerKeyId: string;
  isTestOnly?: boolean;
  enforceApproverAuthority?: boolean;
}

export function createSignedCsvImportAuthority(
  input: CreateCsvImportAuthorityInput
): OfficialCsvImportAuthorityRecord {
  const cleanSha = String(input.rawCsvSha256 || "").trim().toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(cleanSha)) {
    throw new Error("INVALID_INPUT: rawCsvSha256 must be a valid 64-character hex SHA-256 digest.");
  }
  if (!input.artifactPath || !input.artifactPath.trim()) {
    throw new Error("INVALID_INPUT: artifactPath is required.");
  }
  if (!input.importingPrincipalId || !input.importingPrincipalId.trim()) {
    throw new Error("INVALID_INPUT: importingPrincipalId is required.");
  }
  if (!input.workspaceId || !input.workspaceId.trim()) {
    throw new Error("INVALID_INPUT: workspaceId is required.");
  }
  if (!input.targetProductId || !input.targetProductId.trim()) {
    throw new Error("INVALID_INPUT: targetProductId is required.");
  }
  if (!input.query || !input.query.trim()) {
    throw new Error("INVALID_INPUT: query is required.");
  }
  if (!input.periodStart || isNaN(new Date(input.periodStart).getTime())) {
    throw new Error("INVALID_INPUT: valid periodStart is required.");
  }
  if (!input.periodEnd || isNaN(new Date(input.periodEnd).getTime())) {
    throw new Error("INVALID_INPUT: valid periodEnd is required.");
  }
  if (!input.verificationMethod || !input.verificationMethod.trim()) {
    throw new Error("INVALID_INPUT: verificationMethod is required.");
  }
  if (!input.evidenceChainReference || !input.evidenceChainReference.trim()) {
    throw new Error("INVALID_INPUT: evidenceChainReference is required.");
  }

  const keyEntry = getCsvAuthoritySigningKey(
    input.issuerKeyId,
    input.isTestOnly ? "ENGINEERING" : "BUSINESS"
  );
  if (!keyEntry) {
    throw new Error(`KEY_UNTRUSTED: Issuer keyId '${input.issuerKeyId}' is not registered in CSV Authority Key Registry.`);
  }
  if (keyEntry.purpose !== CSV_AUTHORITY_OPERATION_SCOPE) {
    throw new Error(`WRONG_OPERATION_SCOPE: Key '${input.issuerKeyId}' is not scoped for CSV Import Authority.`);
  }
  if (keyEntry.status === "REVOKED" || keyEntry.status === "COMPROMISED") {
    throw new Error(`KEY_REVOKED: Issuer keyId '${input.issuerKeyId}' has status '${keyEntry.status}'.`);
  }

  const isTest = input.isTestOnly === true || keyEntry.status === "TEST_ONLY" || !keyEntry.isBusinessTrusted;

  if (!isTest && isKnownRepositoryFixtureCsvSha(cleanSha)) {
    throw new Error(
      `KNOWN_FIXTURE_REJECTED: Known repository unit-test fixture CSV (${cleanSha.slice(0, 12)}...) cannot be issued a business-trusted Official CSV Import Authority record.`
    );
  }

  let validatedAcquisitionSourceUrl: string | null = null;
  if (
    input.originClassification === "AUTHENTICATED_OFFICIAL_EXPORT" &&
    input.reviewStatus === "APPROVED"
  ) {
    if (!input.approverPrincipalId || !input.approverPrincipalId.trim()) {
      throw new Error("INVALID_INPUT: approverPrincipalId is required for APPROVED AUTHENTICATED_OFFICIAL_EXPORT.");
    }
    // Security boundary (V19.3.3.1 P0): Approver allowlist is ALWAYS enforced for BUSINESS-scope
    // records (!isTest) regardless of NODE_ENV or caller-supplied enforceApproverAuthority flag.
    if (!isTest || input.enforceApproverAuthority === true) {
      const authorizedApprovers = getAuthorizedCsvApproverPrincipals();
      if (authorizedApprovers.length === 0) {
        throw new Error(
          "APPROVER_AUTHORITY_NOT_CONFIGURED: No authorized CSV approver principals configured in KH02_AUTHORIZED_CSV_APPROVER_PRINCIPALS."
        );
      }
      if (!authorizedApprovers.includes(input.approverPrincipalId.trim())) {
        throw new Error(
          `UNAUTHORIZED_APPROVER: Principal '${input.approverPrincipalId}' is not authorized to approve official CSV exports.`
        );
      }
    }
    // Security boundary (V19.3.3.2 P1-A): Unconditionally require and strictly validate
    // official Google Trends acquisitionSourceUrl for BUSINESS-scope AUTHENTICATED_OFFICIAL_EXPORT.
    // Omission of `acquisitionSourceUrl` (undefined) MUST NOT bypass validation.
    if (!isTest) {
      validatedAcquisitionSourceUrl = validateOfficialGoogleTrendsAcquisitionUrl(
        input.acquisitionSourceUrl,
        input.query,
        input.geography || "US"
      );
    } else if (input.acquisitionSourceUrl && String(input.acquisitionSourceUrl).trim()) {
      validatedAcquisitionSourceUrl = validateOfficialGoogleTrendsAcquisitionUrl(
        input.acquisitionSourceUrl,
        input.query,
        input.geography || "US"
      );
    }
  } else if (input.acquisitionSourceUrl && String(input.acquisitionSourceUrl).trim()) {
    validatedAcquisitionSourceUrl = String(input.acquisitionSourceUrl).trim();
  }

  const nowIso = new Date().toISOString();
  const importedAt = input.importedAt || nowIso;
  const availableAt = input.availableAt || importedAt;
  const approvedAt =
    input.reviewStatus === "APPROVED" ? input.approvedAt || importedAt : input.approvedAt || null;

  const authorityId =
    input.authorityId || `csv_auth_${Date.now()}_${crypto.randomBytes(6).toString("hex")}`;
  const importEventId =
    input.importEventId || `csv_imp_${Date.now()}_${crypto.randomBytes(6).toString("hex")}`;

  const defaultLimitation =
    "Local HMAC-SHA256 signature attests internal approval record integrity, principal review, and raw SHA-256 binding; it does NOT constitute a cryptographic signature from Google LLC servers (providerOriginVerified=false).";

  const unsigned: Omit<OfficialCsvImportAuthorityRecord, "payloadDigest" | "authoritySignature"> = {
    authorityId,
    schemaVersion: CSV_AUTHORITY_SCHEMA_VERSION,
    operationScope: CSV_AUTHORITY_OPERATION_SCOPE,
    importEventId,
    rawCsvSha256: cleanSha,
    artifactPath: path.resolve(input.artifactPath.trim()),
    importedAt: new Date(importedAt).toISOString(),
    availableAt: new Date(availableAt).toISOString(),
    importingPrincipalId: input.importingPrincipalId.trim(),
    approverPrincipalId: input.approverPrincipalId ? input.approverPrincipalId.trim() : null,
    approvedAt: approvedAt ? new Date(approvedAt).toISOString() : null,
    workspaceId: input.workspaceId.trim(),
    targetProductId: input.targetProductId.trim(),
    candidateId: input.candidateId ? input.candidateId.trim() : null,
    query: input.query.trim(),
    normalizedQuery: normalizeCsvAuthorityQuery(input.query),
    geography: normalizeCsvAuthorityGeography(input.geography || "US"),
    periodStart: new Date(input.periodStart).toISOString(),
    periodEnd: new Date(input.periodEnd).toISOString(),
    cadence: input.cadence || "WEEKLY",
    dataPointsCount: Math.max(0, Math.floor(Number(input.dataPointsCount) || 0)),
    originClassification: input.originClassification,
    reviewStatus: input.reviewStatus,
    verificationMethod: input.verificationMethod.trim(),
    verificationLimitation: (input.verificationLimitation || defaultLimitation).trim(),
    evidenceChainReference: input.evidenceChainReference.trim(),
    acquisitionSourceUrl: validatedAcquisitionSourceUrl,
    acquisitionEvidenceRef: input.acquisitionEvidenceRef
      ? input.acquisitionEvidenceRef.trim()
      : input.evidenceChainReference.trim(),
    acquisitionCapturedAt: input.acquisitionCapturedAt
      ? new Date(input.acquisitionCapturedAt).toISOString()
      : new Date(importedAt).toISOString(),
    acquisitionMethod: input.acquisitionMethod
      ? input.acquisitionMethod.trim()
      : input.verificationMethod.trim(),
    isTestOnly: isTest,
    issuerKeyId: input.issuerKeyId,
    signingAlgorithm: "HMAC-SHA256",
  };

  const payloadDigest = computeCsvAuthorityPayloadDigest(unsigned);
  const authoritySignature = signCsvAuthorityPayloadDigest(payloadDigest, keyEntry.secret);

  return {
    ...unsigned,
    payloadDigest,
    authoritySignature,
  };
}

export function persistCsvImportAuthorityAtomically(
  record: OfficialCsvImportAuthorityRecord
): {
  success: boolean;
  state: "PERSISTED" | "IDEMPOTENT_SKIP" | "CONFLICT";
  record: OfficialCsvImportAuthorityRecord;
  code?: CsvAuthorityDecisionCode;
  error?: string;
} {
  const expectedDigest = computeCsvAuthorityPayloadDigest(record);
  if (record.payloadDigest !== expectedDigest) {
    return {
      success: false,
      state: "CONFLICT",
      code: "TAMPERED_PAYLOAD",
      record,
      error: `TAMPERED_PAYLOAD: Provided payloadDigest '${record.payloadDigest}' does not match recomputed digest '${expectedDigest}'.`,
    };
  }

  const key = getCsvAuthoritySigningKey(record.issuerKeyId);
  if (!key) {
    return {
      success: false,
      state: "CONFLICT",
      code: "KEY_UNTRUSTED",
      record,
      error: `KEY_UNTRUSTED: Issuer key '${record.issuerKeyId}' is not registered in CSV Authority Key Registry.`,
    };
  }
  if (key.status === "REVOKED" || key.status === "COMPROMISED") {
    return {
      success: false,
      state: "CONFLICT",
      code: "KEY_REVOKED",
      record,
      error: `KEY_REVOKED: Issuer key '${record.issuerKeyId}' has status '${key.status}'.`,
    };
  }

  const expectedSig = signCsvAuthorityPayloadDigest(record.payloadDigest, key.secret);
  if (!verifyCsvAuthoritySignature(expectedSig, record.authoritySignature)) {
    return {
      success: false,
      state: "CONFLICT",
      code: "INVALID_SIGNATURE",
      record,
      error: "INVALID_SIGNATURE: CSV authority signature verification failed.",
    };
  }

  const lock = acquireCsvAuthorityLedgerLock();
  try {
    const readRes = readCsvAuthorityLedgerUnderLock();
    if (readRes.status === "LEDGER_CORRUPT" || readRes.status === "LEDGER_UNREADABLE") {
      return {
        success: false,
        state: "CONFLICT",
        code: readRes.status,
        record,
        error: `${readRes.status}: Cannot persist CSV authority to a corrupt or unreadable ledger. Details: ${readRes.error}`,
      };
    }

    const ledger = readRes.state!;
    if (ledger.revocations[record.authorityId]) {
      return {
        success: false,
        state: "CONFLICT",
        code: "AUTHORITY_REVOKED",
        record,
        error: `REVOCATION_IMMUTABLE: Authority '${record.authorityId}' has been monotonically revoked.`,
      };
    }

    const existing = ledger.records[record.authorityId];
    if (existing) {
      if (existing.payloadDigest === record.payloadDigest) {
        return { success: true, state: "IDEMPOTENT_SKIP", record: existing };
      }
      return {
        success: false,
        state: "CONFLICT",
        code: "CONFLICT_ERROR",
        record: existing,
        error: `CONFLICT_ERROR: Authority '${record.authorityId}' already exists with different payload digest.`,
      };
    }

    ledger.records[record.authorityId] = { ...record };
    writeCsvAuthorityLedgerUnderLock(ledger);
    return { success: true, state: "PERSISTED", record };
  } finally {
    lock.release();
  }
}

export function revokeCsvImportAuthorityAtomically(
  authorityId: string,
  reason: string,
  revokedBy: string
): {
  success: boolean;
  revokedAt?: string;
  code?: CsvAuthorityDecisionCode;
  error?: string;
} {
  const lock = acquireCsvAuthorityLedgerLock();
  try {
    const readRes = readCsvAuthorityLedgerUnderLock();
    if (readRes.status === "LEDGER_CORRUPT" || readRes.status === "LEDGER_UNREADABLE") {
      return {
        success: false,
        code: readRes.status,
        error: `${readRes.status}: Cannot revoke in a corrupt or unreadable ledger. Details: ${readRes.error}`,
      };
    }
    const ledger = readRes.state!;
    if (ledger.revocations[authorityId]) {
      return {
        success: true,
        revokedAt: ledger.revocations[authorityId].revokedAt,
      };
    }
    const revokedAt = new Date().toISOString();
    ledger.revocations[authorityId] = {
      revokedAt,
      reason: reason || "Revoked by administrator",
      revokedBy: revokedBy || "system",
    };
    writeCsvAuthorityLedgerUnderLock(ledger);
    return { success: true, revokedAt };
  } finally {
    lock.release();
  }
}

export interface VerifyCsvImportAuthorityParams {
  authorityId?: string | null;
  rawCsvSha256: string;
  workspaceId?: string | null;
  targetProductId?: string | null;
  candidateId?: string | null;
  targetKeyword?: string | null;
  region?: string | null;
  periodStart?: string | Date | null;
  asOfTimestamp?: string | Date | null;
  evaluationScope?: "BUSINESS" | "ENGINEERING";
}

function evaluateSingleCsvAuthorityRecord(
  record: OfficialCsvImportAuthorityRecord,
  ledger: CsvAuthorityLedgerState,
  params: VerifyCsvImportAuthorityParams
): CsvAuthorityVerificationResult {
  const scope = params.evaluationScope === "ENGINEERING" ? "ENGINEERING" : "BUSINESS";

  if (ledger.revocations[record.authorityId]) {
    const rev = ledger.revocations[record.authorityId];
    return {
      verified: false,
      sourceOriginVerified: false,
      businessEligible: false,
      providerOriginVerified: false,
      originClassification: record.originClassification,
      code: "AUTHORITY_REVOKED",
      reason: `CSV import authority '${record.authorityId}' was revoked at ${rev.revokedAt}: ${rev.reason}`,
      record,
    };
  }

  if (record.operationScope !== CSV_AUTHORITY_OPERATION_SCOPE) {
    return {
      verified: false,
      sourceOriginVerified: false,
      businessEligible: false,
      providerOriginVerified: false,
      originClassification: "UNKNOWN_UNVERIFIED",
      code: "WRONG_OPERATION_SCOPE",
      reason: `Authority record operationScope '${record.operationScope}' does not match '${CSV_AUTHORITY_OPERATION_SCOPE}'.`,
      record,
    };
  }

  const key = getCsvAuthoritySigningKey(record.issuerKeyId);
  if (!key || key.purpose !== CSV_AUTHORITY_OPERATION_SCOPE) {
    return {
      verified: false,
      sourceOriginVerified: false,
      businessEligible: false,
      providerOriginVerified: false,
      originClassification: record.originClassification,
      code: "KEY_UNTRUSTED",
      reason: `Issuer key '${record.issuerKeyId}' is not registered in the CSV Authority Key Registry.`,
      record,
    };
  }

  if (key.status === "REVOKED" || key.status === "COMPROMISED") {
    return {
      verified: false,
      sourceOriginVerified: false,
      businessEligible: false,
      providerOriginVerified: false,
      originClassification: record.originClassification,
      code: "KEY_REVOKED",
      reason: `Issuer key '${record.issuerKeyId}' has status '${key.status}'.`,
      record,
    };
  }

  const expectedDigest = computeCsvAuthorityPayloadDigest(record);
  const expectedSigOverRecomputed = signCsvAuthorityPayloadDigest(expectedDigest, key.secret);
  if (!verifyCsvAuthoritySignature(expectedSigOverRecomputed, record.authoritySignature)) {
    return {
      verified: false,
      sourceOriginVerified: false,
      businessEligible: false,
      providerOriginVerified: false,
      originClassification: "UNKNOWN_UNVERIFIED",
      code: "INVALID_SIGNATURE",
      reason: "CSV authority record HMAC signature verification failed over canonical payload.",
      tamperDetected: true,
      record,
    };
  }

  if (record.payloadDigest !== expectedDigest) {
    return {
      verified: false,
      sourceOriginVerified: false,
      businessEligible: false,
      providerOriginVerified: false,
      originClassification: "UNKNOWN_UNVERIFIED",
      code: "TAMPERED_PAYLOAD",
      reason: "CSV authority record payload digest mismatch (tampered record).",
      tamperDetected: true,
      record,
    };
  }

  const cleanTargetSha = String(params.rawCsvSha256 || "").trim().toLowerCase();
  if (record.rawCsvSha256.toLowerCase() !== cleanTargetSha) {
    return {
      verified: false,
      sourceOriginVerified: false,
      businessEligible: false,
      providerOriginVerified: false,
      originClassification: record.originClassification,
      code: "RAW_SHA_MISMATCH",
      reason: `Authority record SHA-256 (${record.rawCsvSha256.slice(0, 12)}...) does not match requested SHA-256 (${cleanTargetSha.slice(0, 12)}...).`,
      record,
    };
  }

  const diskVerify = verifyStoredCsvFile(cleanTargetSha);
  if (!diskVerify.exists || !diskVerify.validHash || !diskVerify.filePath) {
    return {
      verified: false,
      sourceOriginVerified: false,
      businessEligible: false,
      providerOriginVerified: false,
      originClassification: record.originClassification,
      code: "ARTIFACT_MISSING_OR_CORRUPT",
      reason: `Stored CSV artifact for SHA-256 '${cleanTargetSha.slice(0, 12)}...' is missing or failed byte hash verification on disk.`,
      record,
    };
  }

  if (path.resolve(record.artifactPath) !== path.resolve(diskVerify.filePath)) {
    return {
      verified: false,
      sourceOriginVerified: false,
      businessEligible: false,
      providerOriginVerified: false,
      originClassification: record.originClassification,
      code: "ARTIFACT_PATH_MISMATCH",
      reason: `Authority record artifactPath '${record.artifactPath}' does not match canonical stored path '${diskVerify.filePath}'.`,
      record,
    };
  }

  if (record.originClassification !== "AUTHENTICATED_OFFICIAL_EXPORT") {
    return {
      verified: false,
      sourceOriginVerified: false,
      businessEligible: false,
      providerOriginVerified: false,
      originClassification: record.originClassification,
      code: "ORIGIN_NOT_OFFICIAL_EXPORT",
      reason: `CSV originClassification is '${record.originClassification}', not 'AUTHENTICATED_OFFICIAL_EXPORT'.`,
      record,
    };
  }

  if (record.reviewStatus !== "APPROVED" || !record.approverPrincipalId || !record.approvedAt) {
    return {
      verified: false,
      sourceOriginVerified: false,
      businessEligible: false,
      providerOriginVerified: false,
      originClassification: record.originClassification,
      code: "REVIEW_NOT_APPROVED",
      reason: `CSV authority reviewStatus is '${record.reviewStatus}' (requires APPROVED with approverPrincipalId and approvedAt).`,
      record,
    };
  }

  const isTestRecord = record.isTestOnly === true || key.status === "TEST_ONLY" || !key.isBusinessTrusted;

  if (scope === "BUSINESS") {
    if (isTestRecord) {
      return {
        verified: false,
        sourceOriginVerified: false,
        businessEligible: false,
        providerOriginVerified: false,
        originClassification: "UNIT_FIXTURE",
        code: "TEST_ONLY_REJECTED_IN_BUSINESS_SCOPE",
        reason: `CSV authority record '${record.authorityId}' is marked isTestOnly/TEST_ONLY and cannot grant BUSINESS scope G15 authority.`,
        record,
      };
    }
    if (isKnownRepositoryFixtureCsvSha(cleanTargetSha)) {
      return {
        verified: false,
        sourceOriginVerified: false,
        businessEligible: false,
        providerOriginVerified: false,
        originClassification: "UNIT_FIXTURE",
        code: "KNOWN_FIXTURE_REJECTED",
        reason: `CSV SHA-256 '${cleanTargetSha.slice(0, 12)}...' is a known repository unit test fixture and is barred from BUSINESS scope.`,
        record,
      };
    }
    const authorizedApprovers = getAuthorizedCsvApproverPrincipals();
    if (
      authorizedApprovers.length === 0 ||
      !record.approverPrincipalId ||
      !authorizedApprovers.includes(record.approverPrincipalId.trim())
    ) {
      return {
        verified: false,
        sourceOriginVerified: false,
        businessEligible: false,
        providerOriginVerified: false,
        originClassification: "LOCAL_INTEGRITY_ONLY",
        code: "ORIGIN_NOT_OFFICIAL_EXPORT",
        reason: `CSV authority approver '${record.approverPrincipalId}' is not in the active authorized approver allowlist on readback.`,
        record,
      };
    }
    if (record.schemaVersion === "1.0") {
      return {
        verified: false,
        sourceOriginVerified: false,
        businessEligible: false,
        providerOriginVerified: false,
        originClassification: "LOCAL_INTEGRITY_ONLY",
        code: "ORIGIN_NOT_OFFICIAL_EXPORT",
        reason: `Legacy v1 CSV authority record '${record.authorityId}' lacks cryptographically signed v2 acquisition evidence (acquisitionSourceUrl) and is not eligible for BUSINESS scope.`,
        record,
      };
    }
    try {
      validateOfficialGoogleTrendsAcquisitionUrl(
        record.acquisitionSourceUrl,
        record.query,
        record.geography
      );
    } catch (acqErr: any) {
      return {
        verified: false,
        sourceOriginVerified: false,
        businessEligible: false,
        providerOriginVerified: false,
        originClassification: "LOCAL_INTEGRITY_ONLY",
        code: "ORIGIN_NOT_OFFICIAL_EXPORT",
        reason: `CSV authority record '${record.authorityId}' failed signed acquisitionSourceUrl verification on readback: ${acqErr?.message}`,
        record,
      };
    }
  }

  if (params.workspaceId && params.workspaceId.trim() !== record.workspaceId) {
    return {
      verified: false,
      sourceOriginVerified: false,
      businessEligible: false,
      providerOriginVerified: false,
      originClassification: record.originClassification,
      code: "WORKSPACE_MISMATCH",
      reason: `CSV authority workspaceId '${record.workspaceId}' does not match target workspaceId '${params.workspaceId.trim()}'.`,
      record,
    };
  }

  if (params.targetProductId && params.targetProductId.trim() !== record.targetProductId) {
    return {
      verified: false,
      sourceOriginVerified: false,
      businessEligible: false,
      providerOriginVerified: false,
      originClassification: record.originClassification,
      code: "PRODUCT_MISMATCH",
      reason: `CSV authority targetProductId '${record.targetProductId}' does not match target productId '${params.targetProductId.trim()}'.`,
      record,
    };
  }

  if (
    params.candidateId &&
    record.candidateId &&
    params.candidateId.trim() !== record.candidateId
  ) {
    return {
      verified: false,
      sourceOriginVerified: false,
      businessEligible: false,
      providerOriginVerified: false,
      originClassification: record.originClassification,
      code: "CANDIDATE_MISMATCH",
      reason: `CSV authority candidateId '${record.candidateId}' does not match target candidateId '${params.candidateId.trim()}'.`,
      record,
    };
  }

  if (params.targetKeyword && params.targetKeyword.trim()) {
    const normTarget = normalizeCsvAuthorityQuery(params.targetKeyword);
    if (normTarget !== record.normalizedQuery) {
      return {
        verified: false,
        sourceOriginVerified: false,
        businessEligible: false,
        providerOriginVerified: false,
        originClassification: record.originClassification,
        code: "QUERY_MISMATCH",
        reason: `CSV authority query '${record.query}' does not match observation keyword '${params.targetKeyword}'.`,
        record,
      };
    }
  }

  if (params.region && params.region.trim()) {
    const normGeo = normalizeCsvAuthorityGeography(params.region);
    if (normGeo !== record.geography) {
      return {
        verified: false,
        sourceOriginVerified: false,
        businessEligible: false,
        providerOriginVerified: false,
        originClassification: record.originClassification,
        code: "REGION_MISMATCH",
        reason: `CSV authority geography '${record.geography}' does not match required region '${normGeo}'.`,
        record,
      };
    }
  }

  if (params.periodStart) {
    const obsMs = new Date(params.periodStart).getTime();
    const startMs = new Date(record.periodStart).getTime();
    const endMs = new Date(record.periodEnd).getTime();
    if (!isNaN(obsMs) && (obsMs < startMs - 24 * 3600 * 1000 || obsMs > endMs + 24 * 3600 * 1000)) {
      return {
        verified: false,
        sourceOriginVerified: false,
        businessEligible: false,
        providerOriginVerified: false,
        originClassification: record.originClassification,
        code: "PERIOD_OUT_OF_RANGE",
        reason: `Observation periodStart '${new Date(obsMs).toISOString()}' is outside CSV authority range [${record.periodStart}, ${record.periodEnd}].`,
        record,
      };
    }
  }

  if (params.asOfTimestamp) {
    const asOfMs = new Date(params.asOfTimestamp).getTime();
    if (!isNaN(asOfMs)) {
      const impMs = new Date(record.importedAt).getTime();
      const availMs = new Date(record.availableAt).getTime();
      const apprMs = record.approvedAt ? new Date(record.approvedAt).getTime() : impMs;
      const endMs = new Date(record.periodEnd).getTime();

      if (impMs > asOfMs) {
        return {
          verified: false,
          sourceOriginVerified: false,
          businessEligible: false,
          providerOriginVerified: false,
          originClassification: record.originClassification,
          code: "IMPORT_AFTER_CUTOFF",
          reason: `CSV authority importedAt (${record.importedAt}) is after asOfTimestamp cutoff (${new Date(asOfMs).toISOString()}).`,
          record,
        };
      }
      if (availMs > asOfMs) {
        return {
          verified: false,
          sourceOriginVerified: false,
          businessEligible: false,
          providerOriginVerified: false,
          originClassification: record.originClassification,
          code: "AVAILABLE_AFTER_CUTOFF",
          reason: `CSV authority availableAt (${record.availableAt}) is after asOfTimestamp cutoff (${new Date(asOfMs).toISOString()}).`,
          record,
        };
      }
      if (apprMs > asOfMs) {
        return {
          verified: false,
          sourceOriginVerified: false,
          businessEligible: false,
          providerOriginVerified: false,
          originClassification: record.originClassification,
          code: "APPROVAL_AFTER_CUTOFF",
          reason: `CSV authority approvedAt (${record.approvedAt}) is after asOfTimestamp cutoff (${new Date(asOfMs).toISOString()}).`,
          record,
        };
      }
      if (endMs > asOfMs) {
        return {
          verified: false,
          sourceOriginVerified: false,
          businessEligible: false,
          providerOriginVerified: false,
          originClassification: record.originClassification,
          code: "PERIOD_END_AFTER_CUTOFF",
          reason: `CSV authority periodEnd (${record.periodEnd}) is after asOfTimestamp cutoff (${new Date(asOfMs).toISOString()}).`,
          record,
        };
      }
    }
  }

  const businessEligible = !isTestRecord && scope === "BUSINESS";

  return {
    verified: true,
    sourceOriginVerified: true,
    businessEligible,
    providerOriginVerified: false,
    originClassification: "AUTHENTICATED_OFFICIAL_EXPORT",
    code: isTestRecord ? "VERIFIED_ENGINEERING_TEST_CSV_AUTHORITY" : "VERIFIED_OFFICIAL_CSV_AUTHORITY",
    reason: isTestRecord
      ? "Verified ENGINEERING-scoped test CSV import authority (not eligible for BUSINESS G15)."
      : "Verified Official Google Trends CSV Import Authority (business eligible; providerOriginVerified=false).",
    record,
  };
}

export function verifyDurableCsvImportAuthority(
  params: VerifyCsvImportAuthorityParams
): CsvAuthorityVerificationResult {
  const readRes = readCsvAuthorityLedgerUnderLock();
  if (readRes.status === "LEDGER_CORRUPT" || readRes.status === "LEDGER_UNREADABLE") {
    return {
      verified: false,
      sourceOriginVerified: false,
      businessEligible: false,
      providerOriginVerified: false,
      originClassification: "UNKNOWN_UNVERIFIED",
      code: readRes.status,
      reason: `${readRes.status}: ${readRes.error}`,
    };
  }

  const ledger = readRes.state!;
  const cleanSha = String(params.rawCsvSha256 || "").trim().toLowerCase();

  if (params.authorityId) {
    const rec = ledger.records[params.authorityId.trim()];
    if (!rec) {
      return {
        verified: false,
        sourceOriginVerified: false,
        businessEligible: false,
        providerOriginVerified: false,
        originClassification: isKnownRepositoryFixtureCsvSha(cleanSha)
          ? "UNIT_FIXTURE"
          : "LOCAL_INTEGRITY_ONLY",
        code: "AUTHORITY_NOT_FOUND",
        reason: `CSV import authority '${params.authorityId}' not found in durable ledger.`,
      };
    }
    return evaluateSingleCsvAuthorityRecord(rec, ledger, params);
  }

  const matchingShaRecords = Object.values(ledger.records).filter(
    (r) => r && r.rawCsvSha256 && r.rawCsvSha256.toLowerCase() === cleanSha
  );

  if (matchingShaRecords.length === 0) {
    return {
      verified: false,
      sourceOriginVerified: false,
      businessEligible: false,
      providerOriginVerified: false,
      originClassification: isKnownRepositoryFixtureCsvSha(cleanSha)
        ? "UNIT_FIXTURE"
        : "LOCAL_INTEGRITY_ONLY",
      code: "AUTHORITY_NOT_FOUND",
      reason: `No Official CSV Import Authority record exists in durable ledger for SHA-256 '${cleanSha.slice(0, 12)}...'.`,
    };
  }

  let lastFailure: CsvAuthorityVerificationResult | null = null;
  for (const candidateRec of matchingShaRecords) {
    const evalRes = evaluateSingleCsvAuthorityRecord(candidateRec, ledger, params);
    if (evalRes.verified) {
      return evalRes;
    }
    lastFailure = evalRes;
  }

  return (
    lastFailure || {
      verified: false,
      sourceOriginVerified: false,
      businessEligible: false,
      providerOriginVerified: false,
      originClassification: "LOCAL_INTEGRITY_ONLY",
      code: "AUTHORITY_NOT_FOUND",
      reason: "No matching verified CSV import authority found.",
    }
  );
}

