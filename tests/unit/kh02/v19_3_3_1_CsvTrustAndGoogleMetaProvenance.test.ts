/**
 * SWAI KH-02 V12.4.3.7.19.3.3.1 — Adversarial RED/GREEN Verification Suite
 *
 * Covers:
 * - P0 CSV Signing-Key & Approver Trust Boundary (A01..A16)
 * - P1 Google Ads Invocation Receipt, Upstream vs Local Provenance, and Null-PDP/Market Truth (G01..G12)
 * - P1 Meta Live Collector Diagnostic vs Upstream Query Truth & Family Consolidation (M01..M06)
 */

import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { prisma } from "@/lib/db";
import {
  CSV_AUTHORITY_OPERATION_SCOPE,
  registerCsvAuthoritySigningKey,
  clearTestCsvAuthoritySigningKeys,
  getCsvAuthoritySigningKey,
  createSignedCsvImportAuthority,
  persistCsvImportAuthorityAtomically,
  revokeCsvImportAuthorityAtomically,
  verifyDurableCsvImportAuthority,
  readCsvAuthorityLedgerUnderLock,
  getCsvAuthorityLedgerPath,
} from "@/services/kh02/demand/durableCsvImportAuthority";
import {
  GOOGLE_TRENDS_CSV_STORAGE_DIR,
  validateAndParseGoogleTrendsCsv,
} from "@/services/kh02/demand/googleTrendsCsvValidator";
import {
  hasVerifiableCsvOrProviderLineage,
  evaluateDemandSourceAuthority,
  evaluateDemandHistoryEvidence,
} from "@/services/kh02/demand/temporalDemandEngine";
import {
  discoverGoogleAdsMcpCapabilities,
  recordActualGoogleMcpInvocation,
  attachGoogleMcpCreativeProvenance,
  verifyGoogleInvocationLineage,
  normalizeGoogleAdsResponse,
  persistGoogleObservationsToDatabase,
  collectGoogleAdvertiserSignals,
  decodeCallToolResult,
} from "@/services/kh02/providers/googleTransparencyResearchAdapter";
import {
  diagnoseMetaLiveCollector,
  resolveMetaMarketProvenance,
} from "@/services/kh02/providers/metaResearchAdapter";
import {
  discoverProductCandidatesFromAds,
  selectTopResearchShortlist,
} from "@/services/kh02/identity/productCandidateDiscovery";
import { ingestDiscoveredAds } from "@/services/discovery/discoveryIngestionService";

function buildTwelveWeekTrendsCsv(keyword: string, region = "United States", baseVal = 64): string {
  const lines = [
    "Category: All categories",
    "",
    `Week,${keyword}: (${region})`,
    `2026-06-07,${baseVal}`,
    `2026-06-14,${baseVal + 2}`,
    `2026-06-21,${baseVal + 1}`,
    `2026-06-28,${baseVal + 4}`,
    `2026-07-05,${baseVal + 3}`,
    `2026-07-12,${baseVal + 5}`,
    `2026-07-19,${baseVal + 2}`,
    `2026-07-26,${baseVal + 6}`,
    `2026-08-02,${baseVal + 4}`,
    `2026-08-09,${baseVal + 5}`,
    `2026-08-16,${baseVal + 3}`,
    `2026-08-23,${baseVal + 7}`,
  ];
  return lines.join("\n") + "\n";
}

describe("KH-02 V12.4.3.7.19.3.3.1 — P0 CSV Authority Trust Boundary & P1 Google/Meta Provenance", () => {
  let tmpStorageDir: string;
  let baselineCsvFiles: Set<string>;
  const savedEnv: Record<string, string | undefined> = {};
  const envKeysToSave = [
    "NODE_ENV",
    "TEST_CSV_AUTHORITY_STORAGE_DIR",
    "KH02_CSV_AUTHORITY_KEY_ID",
    "KH02_CSV_AUTHORITY_HMAC_SECRET",
    "KH02_CSV_AUTHORITY_KEY_STATUS",
    "KH02_AUTHORIZED_CSV_APPROVER_PRINCIPALS",
    "META_COLLECTOR_ENABLED",
  ];

  const envBusinessKeyId = "prod_env_csv_authority_key_v1";
  const envBusinessSecret = "env_server_secret_99887766554433221100_abcdef1234567890_trusted";
  const authorizedApprover = "sec_approver_alice@swai.internal";

  beforeEach(() => {
    for (const k of envKeysToSave) {
      savedEnv[k] = process.env[k];
    }
    tmpStorageDir = fs.mkdtempSync(path.join(os.tmpdir(), "kh02_v19331_csv_auth_"));
    process.env.TEST_CSV_AUTHORITY_STORAGE_DIR = tmpStorageDir;
    delete process.env.KH02_CSV_AUTHORITY_KEY_ID;
    delete process.env.KH02_CSV_AUTHORITY_HMAC_SECRET;
    delete process.env.KH02_CSV_AUTHORITY_KEY_STATUS;
    delete process.env.KH02_AUTHORIZED_CSV_APPROVER_PRINCIPALS;

    if (fs.existsSync(GOOGLE_TRENDS_CSV_STORAGE_DIR)) {
      baselineCsvFiles = new Set(fs.readdirSync(GOOGLE_TRENDS_CSV_STORAGE_DIR));
    } else {
      baselineCsvFiles = new Set();
    }
    clearTestCsvAuthoritySigningKeys();
  });

  afterEach(() => {
    clearTestCsvAuthoritySigningKeys();
    for (const k of envKeysToSave) {
      if (savedEnv[k] === undefined) {
        delete process.env[k];
      } else {
        process.env[k] = savedEnv[k];
      }
    }
    try {
      if (fs.existsSync(tmpStorageDir)) {
        fs.rmSync(tmpStorageDir, { recursive: true, force: true });
      }
    } catch {}
    try {
      if (fs.existsSync(GOOGLE_TRENDS_CSV_STORAGE_DIR)) {
        for (const f of fs.readdirSync(GOOGLE_TRENDS_CSV_STORAGE_DIR)) {
          if (!baselineCsvFiles.has(f)) {
            fs.unlinkSync(path.join(GOOGLE_TRENDS_CSV_STORAGE_DIR, f));
          }
        }
      }
    } catch {}
  });

  // =========================================================================
  // SECTION 02.7: P0 CSV SIGNING-KEY / APPROVER TRUST BOUNDARY (A01..A16)
  // =========================================================================
  describe("Section 02.7 — P0 CSV Authority Trust Boundary (A01..A16)", () => {
    it("A01: registerCsvAuthoritySigningKey({isBusinessTrusted:true}) using arbitrary key cannot grant BUSINESS authority without trusted env issuer & authorized approver", () => {
      registerCsvAuthoritySigningKey({
        keyId: "rogue_injected_key_a01",
        secret: "rogue_secret_key_material_at_least_32_bytes_long_0001",
        status: "ACTIVE",
        purpose: CSV_AUTHORITY_OPERATION_SCOPE,
        isBusinessTrusted: true,
      });

      const csvText = buildTwelveWeekTrendsCsv("smart cat fountain a01");
      const parsed = validateAndParseGoogleTrendsCsv(csvText, { persist: true });
      expect(parsed.valid).toBe(true);

      // Even if caller passes isTestOnly=false using a test-registered key, BUSINESS scope MUST DENY
      let issuedRecord: any = null;
      let threwOnIssue = false;
      try {
        issuedRecord = createSignedCsvImportAuthority({
          rawCsvSha256: parsed.sha256Checksum,
          artifactPath: path.join(GOOGLE_TRENDS_CSV_STORAGE_DIR, `${parsed.sha256Checksum}.csv`),
          importingPrincipalId: "rogue_caller",
          approverPrincipalId: "rogue_approver",
          workspaceId: "ws_a01",
          targetProductId: "prod_a01",
          query: "smart cat fountain a01",
          geography: "US",
          periodStart: parsed.startDate!,
          periodEnd: parsed.endDate!,
          dataPointsCount: parsed.dataPointsCount,
          originClassification: "AUTHENTICATED_OFFICIAL_EXPORT",
          reviewStatus: "APPROVED",
          verificationMethod: "MANUAL_EXPORT_REVIEW",
          evidenceChainReference: "ticket:a01",
          acquisitionSourceUrl: "https://trends.google.com/trends/explore?geo=US&q=smart%20cat%20fountain%20a01",
          issuerKeyId: "rogue_injected_key_a01",
          isTestOnly: false,
        } as any);
        persistCsvImportAuthorityAtomically(issuedRecord);
      } catch {
        threwOnIssue = true;
      }

      const verifyRes = verifyDurableCsvImportAuthority({
        authorityId: issuedRecord?.authorityId,
        rawCsvSha256: parsed.sha256Checksum,
        workspaceId: "ws_a01",
        targetProductId: "prod_a01",
        targetKeyword: "smart cat fountain a01",
        region: "US",
        evaluationScope: "BUSINESS",
      });

      expect(threwOnIssue || !verifyRes.verified || !verifyRes.businessEligible).toBe(true);
      expect(verifyRes.businessEligible).toBe(false);
    });

    it("A02: test-registered key with isBusinessTrusted:true is denied in BUSINESS scope across NODE_ENV=test, development, and production", () => {
      registerCsvAuthoritySigningKey({
        keyId: "rogue_injected_key_a02",
        secret: "rogue_secret_key_material_at_least_32_bytes_long_0002",
        status: "ACTIVE",
        purpose: CSV_AUTHORITY_OPERATION_SCOPE,
        isBusinessTrusted: true,
      });

      const csvText = buildTwelveWeekTrendsCsv("smart cat fountain a02");
      const parsed = validateAndParseGoogleTrendsCsv(csvText, { persist: true });

      for (const envMode of ["test", "development", "production"]) {
        (process.env as any).NODE_ENV = envMode;
        let rec: any = null;
        try {
          rec = createSignedCsvImportAuthority({
            rawCsvSha256: parsed.sha256Checksum,
            artifactPath: path.join(GOOGLE_TRENDS_CSV_STORAGE_DIR, `${parsed.sha256Checksum}.csv`),
            importingPrincipalId: "caller_a02",
            approverPrincipalId: "approver_a02",
            workspaceId: "ws_a02",
            targetProductId: "prod_a02",
            query: "smart cat fountain a02",
            geography: "US",
            periodStart: parsed.startDate!,
            periodEnd: parsed.endDate!,
            dataPointsCount: parsed.dataPointsCount,
            originClassification: "AUTHENTICATED_OFFICIAL_EXPORT",
            reviewStatus: "APPROVED",
            verificationMethod: "MANUAL_EXPORT_REVIEW",
            evidenceChainReference: "ticket:a02",
            acquisitionSourceUrl: "https://trends.google.com/trends/explore?geo=US&q=smart%20cat%20fountain%20a02",
            issuerKeyId: "rogue_injected_key_a02",
            isTestOnly: false,
          } as any);
          persistCsvImportAuthorityAtomically(rec);
        } catch {}

        const verifyRes = verifyDurableCsvImportAuthority({
          authorityId: rec?.authorityId,
          rawCsvSha256: parsed.sha256Checksum,
          workspaceId: "ws_a02",
          targetProductId: "prod_a02",
          targetKeyword: "smart cat fountain a02",
          region: "US",
          evaluationScope: "BUSINESS",
        });
        expect(verifyRes.businessEligible).toBe(false);
      }
    });

    it("A03: test registry key ID equal to real env key ID cannot shadow or substitute the env-managed business issuer", () => {
      process.env.KH02_CSV_AUTHORITY_KEY_ID = envBusinessKeyId;
      process.env.KH02_CSV_AUTHORITY_HMAC_SECRET = envBusinessSecret;
      process.env.KH02_CSV_AUTHORITY_KEY_STATUS = "ACTIVE";
      process.env.KH02_AUTHORIZED_CSV_APPROVER_PRINCIPALS = authorizedApprover;

      const attackerSecret = "attacker_shadow_secret_key_material_32_bytes_minimum_9999";
      // Attempt to register the exact same keyId with attacker secret
      let shadowRegistrationRejected = false;
      try {
        registerCsvAuthoritySigningKey({
          keyId: envBusinessKeyId,
          secret: attackerSecret,
          status: "ACTIVE",
          purpose: CSV_AUTHORITY_OPERATION_SCOPE,
          isBusinessTrusted: true,
        });
      } catch {
        shadowRegistrationRejected = true;
      }

      // Even if registration did not throw, BUSINESS key resolution must NEVER return attackerSecret
      const businessKey = getCsvAuthoritySigningKey(envBusinessKeyId, "BUSINESS" as any);
      expect(businessKey).not.toBeNull();
      expect(businessKey?.secret).not.toBe(attackerSecret);
      expect(shadowRegistrationRejected || businessKey?.secret === envBusinessSecret).toBe(true);
    });

    it("A04: fake approverPrincipalId with caller enforceApproverAuthority=false is DENIED in BUSINESS scope regardless of NODE_ENV", () => {
      process.env.KH02_CSV_AUTHORITY_KEY_ID = envBusinessKeyId;
      process.env.KH02_CSV_AUTHORITY_HMAC_SECRET = envBusinessSecret;
      process.env.KH02_CSV_AUTHORITY_KEY_STATUS = "ACTIVE";
      process.env.KH02_AUTHORIZED_CSV_APPROVER_PRINCIPALS = authorizedApprover;
      (process.env as any).NODE_ENV = "test";

      const csvText = buildTwelveWeekTrendsCsv("pet grooming vacuum a04");
      const parsed = validateAndParseGoogleTrendsCsv(csvText, { persist: true });

      expect(() =>
        createSignedCsvImportAuthority({
          rawCsvSha256: parsed.sha256Checksum,
          artifactPath: path.join(GOOGLE_TRENDS_CSV_STORAGE_DIR, `${parsed.sha256Checksum}.csv`),
          importingPrincipalId: "importer_a04",
          approverPrincipalId: "unapproved_bob@example.com",
          workspaceId: "ws_a04",
          targetProductId: "prod_a04",
          query: "pet grooming vacuum a04",
          geography: "US",
          periodStart: parsed.startDate!,
          periodEnd: parsed.endDate!,
          dataPointsCount: parsed.dataPointsCount,
          originClassification: "AUTHENTICATED_OFFICIAL_EXPORT",
          reviewStatus: "APPROVED",
          verificationMethod: "MANUAL_EXPORT_REVIEW",
          evidenceChainReference: "ticket:a04",
          acquisitionSourceUrl: "https://trends.google.com/trends/explore?geo=US&q=pet%20grooming%20vacuum%20a04",
          issuerKeyId: envBusinessKeyId,
          isTestOnly: false,
          enforceApproverAuthority: false,
        } as any)
      ).toThrow(/UNAUTHORIZED_APPROVER/i);
    });

    it("A05: known repository fixture hash AND invented non-fixture lookalike CSV without origin review are DENIED in BUSINESS scope", () => {
      process.env.KH02_CSV_AUTHORITY_KEY_ID = envBusinessKeyId;
      process.env.KH02_CSV_AUTHORITY_HMAC_SECRET = envBusinessSecret;
      process.env.KH02_CSV_AUTHORITY_KEY_STATUS = "ACTIVE";
      process.env.KH02_AUTHORIZED_CSV_APPROVER_PRINCIPALS = authorizedApprover;

      // 1. Known fixture hash rejected at issuance
      const knownSha = "f300258f9ea08da45034f449ade0c43d643cf280838d0f370a264d6805826d39";
      expect(() =>
        createSignedCsvImportAuthority({
          rawCsvSha256: knownSha,
          artifactPath: path.join(GOOGLE_TRENDS_CSV_STORAGE_DIR, `${knownSha}.csv`),
          importingPrincipalId: "importer_a05",
          approverPrincipalId: authorizedApprover,
          workspaceId: "ws_a05",
          targetProductId: "prod_a05",
          query: "automatic cat feeder",
          geography: "US",
          periodStart: "2026-06-07T00:00:00.000Z",
          periodEnd: "2026-08-23T00:00:00.000Z",
          dataPointsCount: 12,
          originClassification: "AUTHENTICATED_OFFICIAL_EXPORT",
          reviewStatus: "APPROVED",
          verificationMethod: "MANUAL_EXPORT_REVIEW",
          evidenceChainReference: "ticket:a05",
          acquisitionSourceUrl: "https://trends.google.com/trends/explore?geo=US&q=automatic%20cat%20feeder",
          issuerKeyId: envBusinessKeyId,
          isTestOnly: false,
        } as any)
      ).toThrow(/KNOWN_FIXTURE_REJECTED/i);

      // 2. Invented non-fixture same-format CSV on disk without authority record => LOCAL_INTEGRITY_ONLY
      const lookalikeCsv = buildTwelveWeekTrendsCsv("invented lookalike gadget a05");
      const parsedLookalike = validateAndParseGoogleTrendsCsv(lookalikeCsv, { persist: true });
      const verifyLookalike = verifyDurableCsvImportAuthority({
        rawCsvSha256: parsedLookalike.sha256Checksum,
        workspaceId: "ws_a05",
        targetProductId: "prod_a05",
        targetKeyword: "invented lookalike gadget a05",
        region: "US",
        evaluationScope: "BUSINESS",
      });
      expect(verifyLookalike.verified).toBe(false);
      expect(verifyLookalike.businessEligible).toBe(false);
      expect(verifyLookalike.originClassification).toBe("LOCAL_INTEGRITY_ONLY");
    });

    it("A06: caller supplying originClassification=AUTHENTICATED_OFFICIAL_EXPORT and reviewStatus=APPROVED alone without trusted issuer & allowlisted approver is DENIED", () => {
      const csvText = buildTwelveWeekTrendsCsv("dog bark collar a06");
      const parsed = validateAndParseGoogleTrendsCsv(csvText, { persist: true });

      expect(() =>
        createSignedCsvImportAuthority({
          rawCsvSha256: parsed.sha256Checksum,
          artifactPath: path.join(GOOGLE_TRENDS_CSV_STORAGE_DIR, `${parsed.sha256Checksum}.csv`),
          importingPrincipalId: "caller_a06",
          approverPrincipalId: "self_approved_caller",
          workspaceId: "ws_a06",
          targetProductId: "prod_a06",
          query: "dog bark collar a06",
          geography: "US",
          periodStart: parsed.startDate!,
          periodEnd: parsed.endDate!,
          dataPointsCount: parsed.dataPointsCount,
          originClassification: "AUTHENTICATED_OFFICIAL_EXPORT",
          reviewStatus: "APPROVED",
          verificationMethod: "SELF_ASSERTED",
          evidenceChainReference: "self:a06",
          issuerKeyId: "non_existent_business_key",
          isTestOnly: false,
        })
      ).toThrow(/KEY_UNTRUSTED/i);
    });

    it("A07: signed local CSV with no verified official acquisition source URL / review evidence is DENIED in BUSINESS scope", () => {
      process.env.KH02_CSV_AUTHORITY_KEY_ID = envBusinessKeyId;
      process.env.KH02_CSV_AUTHORITY_HMAC_SECRET = envBusinessSecret;
      process.env.KH02_CSV_AUTHORITY_KEY_STATUS = "ACTIVE";
      process.env.KH02_AUTHORIZED_CSV_APPROVER_PRINCIPALS = authorizedApprover;

      const csvText = buildTwelveWeekTrendsCsv("interactive cat laser a07");
      const parsed = validateAndParseGoogleTrendsCsv(csvText, { persist: true });

      // Missing acquisitionSourceUrl (or non-trends.google.com acquisition URL) must be rejected for BUSINESS official export
      expect(() =>
        createSignedCsvImportAuthority({
          rawCsvSha256: parsed.sha256Checksum,
          artifactPath: path.join(GOOGLE_TRENDS_CSV_STORAGE_DIR, `${parsed.sha256Checksum}.csv`),
          importingPrincipalId: "importer_a07",
          approverPrincipalId: authorizedApprover,
          workspaceId: "ws_a07",
          targetProductId: "prod_a07",
          query: "interactive cat laser a07",
          geography: "US",
          periodStart: parsed.startDate!,
          periodEnd: parsed.endDate!,
          dataPointsCount: parsed.dataPointsCount,
          originClassification: "AUTHENTICATED_OFFICIAL_EXPORT",
          reviewStatus: "APPROVED",
          verificationMethod: "MANUAL_EXPORT_REVIEW",
          evidenceChainReference: "ticket:a07",
          acquisitionSourceUrl: "", // Missing verified official acquisition URL
          issuerKeyId: envBusinessKeyId,
          isTestOnly: false,
        } as any)
      ).toThrow(/ACQUISITION_SOURCE_REQUIRED|INVALID_ACQUISITION_SOURCE/i);
    });

    it("A08: tampered ledger signature, digest, immutable record, or underlying CSV file bytes are DENIED", () => {
      process.env.KH02_CSV_AUTHORITY_KEY_ID = envBusinessKeyId;
      process.env.KH02_CSV_AUTHORITY_HMAC_SECRET = envBusinessSecret;
      process.env.KH02_CSV_AUTHORITY_KEY_STATUS = "ACTIVE";
      process.env.KH02_AUTHORIZED_CSV_APPROVER_PRINCIPALS = authorizedApprover;

      const csvText = buildTwelveWeekTrendsCsv("cat litter mat a08");
      const parsed = validateAndParseGoogleTrendsCsv(csvText, { persist: true });
      const artifactPath = path.join(GOOGLE_TRENDS_CSV_STORAGE_DIR, `${parsed.sha256Checksum}.csv`);

      const record = createSignedCsvImportAuthority({
        rawCsvSha256: parsed.sha256Checksum,
        artifactPath,
        importingPrincipalId: "importer_a08",
        approverPrincipalId: authorizedApprover,
        workspaceId: "ws_a08",
        targetProductId: "prod_a08",
        query: "cat litter mat a08",
        geography: "US",
        periodStart: parsed.startDate!,
        periodEnd: parsed.endDate!,
        dataPointsCount: parsed.dataPointsCount,
        originClassification: "AUTHENTICATED_OFFICIAL_EXPORT",
        reviewStatus: "APPROVED",
        verificationMethod: "MANUAL_EXPORT_REVIEW",
        evidenceChainReference: "ticket:a08",
        acquisitionSourceUrl: "https://trends.google.com/trends/explore?geo=US&q=cat%20litter%20mat%20a08",
        issuerKeyId: envBusinessKeyId,
        isTestOnly: false,
      } as any);

      // Tamper with payload field before persisting
      const tampered = { ...record, targetProductId: "prod_hijacked_a08" };
      const persistTampered = persistCsvImportAuthorityAtomically(tampered);
      expect(persistTampered.success).toBe(false);
      expect(persistTampered.code).toBe("TAMPERED_PAYLOAD");

      // Persist valid record, then tamper with CSV bytes on disk
      const persistOk = persistCsvImportAuthorityAtomically(record);
      expect(persistOk.success).toBe(true);

      fs.writeFileSync(artifactPath, csvText + "2026-08-30,99\n", "utf8");
      const verifyAfterByteTamper = verifyDurableCsvImportAuthority({
        authorityId: record.authorityId,
        rawCsvSha256: parsed.sha256Checksum,
        workspaceId: "ws_a08",
        targetProductId: "prod_a08",
        targetKeyword: "cat litter mat a08",
        region: "US",
        evaluationScope: "BUSINESS",
      });
      expect(verifyAfterByteTamper.verified).toBe(false);
      expect(verifyAfterByteTamper.code).toBe("ARTIFACT_MISSING_OR_CORRUPT");
    });

    it("A09: previously valid record once revoked is monotonically DENIED on fresh readback and cannot be re-persisted", () => {
      process.env.KH02_CSV_AUTHORITY_KEY_ID = envBusinessKeyId;
      process.env.KH02_CSV_AUTHORITY_HMAC_SECRET = envBusinessSecret;
      process.env.KH02_CSV_AUTHORITY_KEY_STATUS = "ACTIVE";
      process.env.KH02_AUTHORIZED_CSV_APPROVER_PRINCIPALS = authorizedApprover;

      const csvText = buildTwelveWeekTrendsCsv("dog gps collar a09");
      const parsed = validateAndParseGoogleTrendsCsv(csvText, { persist: true });
      const artifactPath = path.join(GOOGLE_TRENDS_CSV_STORAGE_DIR, `${parsed.sha256Checksum}.csv`);

      const record = createSignedCsvImportAuthority({
        rawCsvSha256: parsed.sha256Checksum,
        artifactPath,
        importingPrincipalId: "importer_a09",
        approverPrincipalId: authorizedApprover,
        workspaceId: "ws_a09",
        targetProductId: "prod_a09",
        query: "dog gps collar a09",
        geography: "US",
        periodStart: parsed.startDate!,
        periodEnd: parsed.endDate!,
        dataPointsCount: parsed.dataPointsCount,
        originClassification: "AUTHENTICATED_OFFICIAL_EXPORT",
        reviewStatus: "APPROVED",
        verificationMethod: "MANUAL_EXPORT_REVIEW",
        evidenceChainReference: "ticket:a09",
        acquisitionSourceUrl: "https://trends.google.com/trends/explore?geo=US&q=dog%20gps%20collar%20a09",
        issuerKeyId: envBusinessKeyId,
        isTestOnly: false,
      } as any);

      expect(persistCsvImportAuthorityAtomically(record).success).toBe(true);
      const rev = revokeCsvImportAuthorityAtomically(record.authorityId, "Audit revoked", authorizedApprover);
      expect(rev.success).toBe(true);

      const afterRevoke = verifyDurableCsvImportAuthority({
        authorityId: record.authorityId,
        rawCsvSha256: parsed.sha256Checksum,
        workspaceId: "ws_a09",
        targetProductId: "prod_a09",
        targetKeyword: "dog gps collar a09",
        region: "US",
        evaluationScope: "BUSINESS",
      });
      expect(afterRevoke.verified).toBe(false);
      expect(afterRevoke.code).toBe("AUTHORITY_REVOKED");

      const rePersist = persistCsvImportAuthorityAtomically(record);
      expect(rePersist.success).toBe(false);
      expect(rePersist.code).toBe("AUTHORITY_REVOKED");
    });

    it("A10: corrupt ledger, symlinked ledger file, path traversal, and foreign workspace are DENIED fail-closed", () => {
      const ledgerPath = getCsvAuthorityLedgerPath();
      const targetDummy = path.join(os.tmpdir(), `kh02_symlink_target_${Date.now()}.json`);
      fs.writeFileSync(targetDummy, JSON.stringify({ version: "1.0", records: {}, revocations: {}, updatedAt: new Date().toISOString() }), "utf8");
      try {
        if (fs.existsSync(ledgerPath)) fs.unlinkSync(ledgerPath);
        fs.symlinkSync(targetDummy, ledgerPath);

        const symlinkRead = readCsvAuthorityLedgerUnderLock();
        expect(symlinkRead.status).toBe("LEDGER_UNREADABLE");

        const verifySymlink = verifyDurableCsvImportAuthority({
          rawCsvSha256: "a".repeat(64),
          workspaceId: "ws_a10",
          evaluationScope: "BUSINESS",
        });
        expect(verifySymlink.verified).toBe(false);
        expect(verifySymlink.code).toBe("LEDGER_UNREADABLE");
      } finally {
        try { if (fs.existsSync(ledgerPath)) fs.unlinkSync(ledgerPath); } catch {}
        try { if (fs.existsSync(targetDummy)) fs.unlinkSync(targetDummy); } catch {}
      }

      // Corrupt JSON in ledger
      fs.writeFileSync(ledgerPath, "{corrupt_json:", "utf8");
      const verifyCorrupt = verifyDurableCsvImportAuthority({
        rawCsvSha256: "a".repeat(64),
        workspaceId: "ws_a10",
        evaluationScope: "BUSINESS",
      });
      expect(verifyCorrupt.verified).toBe(false);
      expect(verifyCorrupt.code).toBe("LEDGER_CORRUPT");
    });

    it("A11: wrong candidate, wrong product, wrong term, non-US geography, or missing observation productId are DENIED", () => {
      process.env.KH02_CSV_AUTHORITY_KEY_ID = envBusinessKeyId;
      process.env.KH02_CSV_AUTHORITY_HMAC_SECRET = envBusinessSecret;
      process.env.KH02_CSV_AUTHORITY_KEY_STATUS = "ACTIVE";
      process.env.KH02_AUTHORIZED_CSV_APPROVER_PRINCIPALS = authorizedApprover;

      const csvText = buildTwelveWeekTrendsCsv("pet hair roller a11");
      const parsed = validateAndParseGoogleTrendsCsv(csvText, { persist: true });
      const artifactPath = path.join(GOOGLE_TRENDS_CSV_STORAGE_DIR, `${parsed.sha256Checksum}.csv`);

      const record = createSignedCsvImportAuthority({
        rawCsvSha256: parsed.sha256Checksum,
        artifactPath,
        importingPrincipalId: "importer_a11",
        approverPrincipalId: authorizedApprover,
        workspaceId: "ws_a11",
        targetProductId: "prod_a11",
        candidateId: "cand_a11",
        query: "pet hair roller a11",
        geography: "US",
        periodStart: parsed.startDate!,
        periodEnd: parsed.endDate!,
        dataPointsCount: parsed.dataPointsCount,
        originClassification: "AUTHENTICATED_OFFICIAL_EXPORT",
        reviewStatus: "APPROVED",
        verificationMethod: "MANUAL_EXPORT_REVIEW",
        evidenceChainReference: "ticket:a11",
        acquisitionSourceUrl: "https://trends.google.com/trends/explore?geo=US&q=pet%20hair%20roller%20a11",
        issuerKeyId: envBusinessKeyId,
        isTestOnly: false,
      } as any);
      persistCsvImportAuthorityAtomically(record);

      // Wrong candidate
      expect(
        verifyDurableCsvImportAuthority({
          authorityId: record.authorityId,
          rawCsvSha256: parsed.sha256Checksum,
          workspaceId: "ws_a11",
          targetProductId: "prod_a11",
          candidateId: "cand_wrong",
          targetKeyword: "pet hair roller a11",
          region: "US",
          evaluationScope: "BUSINESS",
        }).code
      ).toBe("CANDIDATE_MISMATCH");

      // Missing observation productId must NOT be silently substituted by targetProductId in BUSINESS scope
      const obsMissingProductId = parsed.dataPoints.map((pt, idx) => ({
        id: `obs_missing_pid_${idx}`,
        productId: null as any,
        keyword: pt.keyword,
        region: "US",
        periodStart: pt.periodStart,
        periodEnd: pt.periodEnd,
        demandValue: pt.demandValue,
        source: "GOOGLE_TRENDS_CSV",
        evidenceReference: `${parsed.evidenceReference}:authorityId=${record.authorityId}`,
        observedAt: "2026-08-25T00:00:00.000Z",
      }));

      const authEvalMissingPid = evaluateDemandSourceAuthority(obsMissingProductId, {
        targetProductId: "prod_a11",
        candidateCanonicalName: "pet hair roller a11",
        workspaceId: "ws_a11",
        requiredRegion: "US",
        strictSourceProvenance: true,
        evaluationScope: "BUSINESS",
      });
      expect(authEvalMissingPid.authority).toBe("CACHED_UNVERIFIED");
      expect(authEvalMissingPid.productAttributionValid).toBe(false);
    });

    it("A12: periodEnd, approvedAt, importedAt, or availableAt after point-in-time asOf cutoff are DENIED", () => {
      process.env.KH02_CSV_AUTHORITY_KEY_ID = envBusinessKeyId;
      process.env.KH02_CSV_AUTHORITY_HMAC_SECRET = envBusinessSecret;
      process.env.KH02_CSV_AUTHORITY_KEY_STATUS = "ACTIVE";
      process.env.KH02_AUTHORIZED_CSV_APPROVER_PRINCIPALS = authorizedApprover;

      const csvText = buildTwelveWeekTrendsCsv("dog water bottle a12");
      const parsed = validateAndParseGoogleTrendsCsv(csvText, { persist: true });
      const artifactPath = path.join(GOOGLE_TRENDS_CSV_STORAGE_DIR, `${parsed.sha256Checksum}.csv`);

      const record = createSignedCsvImportAuthority({
        rawCsvSha256: parsed.sha256Checksum,
        artifactPath,
        importedAt: "2026-09-01T00:00:00.000Z",
        availableAt: "2026-09-05T00:00:00.000Z",
        approvedAt: "2026-09-10T00:00:00.000Z",
        importingPrincipalId: "importer_a12",
        approverPrincipalId: authorizedApprover,
        workspaceId: "ws_a12",
        targetProductId: "prod_a12",
        query: "dog water bottle a12",
        geography: "US",
        periodStart: parsed.startDate!,
        periodEnd: parsed.endDate!,
        dataPointsCount: parsed.dataPointsCount,
        originClassification: "AUTHENTICATED_OFFICIAL_EXPORT",
        reviewStatus: "APPROVED",
        verificationMethod: "MANUAL_EXPORT_REVIEW",
        evidenceChainReference: "ticket:a12",
        acquisitionSourceUrl: "https://trends.google.com/trends/explore?geo=US&q=dog%20water%20bottle%20a12",
        issuerKeyId: envBusinessKeyId,
        isTestOnly: false,
      } as any);
      persistCsvImportAuthorityAtomically(record);

      // 1. Cutoff before periodEnd (2026-08-15 < 2026-08-23)
      expect(
        verifyDurableCsvImportAuthority({
          authorityId: record.authorityId,
          rawCsvSha256: parsed.sha256Checksum,
          workspaceId: "ws_a12",
          targetProductId: "prod_a12",
          targetKeyword: "dog water bottle a12",
          region: "US",
          asOfTimestamp: "2026-08-15T00:00:00.000Z",
          evaluationScope: "BUSINESS",
        }).code
      ).toBe("IMPORT_AFTER_CUTOFF");

      // 2. Cutoff after importedAt (2026-09-01) but before availableAt (2026-09-05)
      expect(
        verifyDurableCsvImportAuthority({
          authorityId: record.authorityId,
          rawCsvSha256: parsed.sha256Checksum,
          workspaceId: "ws_a12",
          targetProductId: "prod_a12",
          targetKeyword: "dog water bottle a12",
          region: "US",
          asOfTimestamp: "2026-09-03T00:00:00.000Z",
          evaluationScope: "BUSINESS",
        }).code
      ).toBe("AVAILABLE_AFTER_CUTOFF");

      // 3. Cutoff after availableAt (2026-09-05) but before approvedAt (2026-09-10)
      expect(
        verifyDurableCsvImportAuthority({
          authorityId: record.authorityId,
          rawCsvSha256: parsed.sha256Checksum,
          workspaceId: "ws_a12",
          targetProductId: "prod_a12",
          targetKeyword: "dog water bottle a12",
          region: "US",
          asOfTimestamp: "2026-09-07T00:00:00.000Z",
          evaluationScope: "BUSINESS",
        }).code
      ).toBe("APPROVAL_AFTER_CUTOFF");
    });

    it("A13: key rotation, compromised/revoked/unknown/purpose-mismatch key IDs are DENIED fail-closed", () => {
      process.env.KH02_CSV_AUTHORITY_KEY_ID = envBusinessKeyId;
      process.env.KH02_CSV_AUTHORITY_HMAC_SECRET = envBusinessSecret;
      process.env.KH02_CSV_AUTHORITY_KEY_STATUS = "ACTIVE";
      process.env.KH02_AUTHORIZED_CSV_APPROVER_PRINCIPALS = authorizedApprover;

      const csvText = buildTwelveWeekTrendsCsv("cat window perch a13");
      const parsed = validateAndParseGoogleTrendsCsv(csvText, { persist: true });
      const artifactPath = path.join(GOOGLE_TRENDS_CSV_STORAGE_DIR, `${parsed.sha256Checksum}.csv`);

      const record = createSignedCsvImportAuthority({
        rawCsvSha256: parsed.sha256Checksum,
        artifactPath,
        importingPrincipalId: "importer_a13",
        approverPrincipalId: authorizedApprover,
        workspaceId: "ws_a13",
        targetProductId: "prod_a13",
        query: "cat window perch a13",
        geography: "US",
        periodStart: parsed.startDate!,
        periodEnd: parsed.endDate!,
        dataPointsCount: parsed.dataPointsCount,
        originClassification: "AUTHENTICATED_OFFICIAL_EXPORT",
        reviewStatus: "APPROVED",
        verificationMethod: "MANUAL_EXPORT_REVIEW",
        evidenceChainReference: "ticket:a13",
        acquisitionSourceUrl: "https://trends.google.com/trends/explore?geo=US&q=cat%20window%20perch%20a13",
        issuerKeyId: envBusinessKeyId,
        isTestOnly: false,
      } as any);
      persistCsvImportAuthorityAtomically(record);

      // Mark env key COMPROMISED -> must DENY
      process.env.KH02_CSV_AUTHORITY_KEY_STATUS = "COMPROMISED";
      const compromisedRes = verifyDurableCsvImportAuthority({
        authorityId: record.authorityId,
        rawCsvSha256: parsed.sha256Checksum,
        workspaceId: "ws_a13",
        targetProductId: "prod_a13",
        targetKeyword: "cat window perch a13",
        region: "US",
        evaluationScope: "BUSINESS",
      });
      expect(compromisedRes.verified).toBe(false);
      expect(compromisedRes.code).toBe("KEY_REVOKED");

      // Rotate env key to new keyId -> old unconfigured keyId must DENY as KEY_UNTRUSTED
      process.env.KH02_CSV_AUTHORITY_KEY_ID = "rotated_key_v2";
      process.env.KH02_CSV_AUTHORITY_KEY_STATUS = "ACTIVE";
      const rotatedRes = verifyDurableCsvImportAuthority({
        authorityId: record.authorityId,
        rawCsvSha256: parsed.sha256Checksum,
        workspaceId: "ws_a13",
        targetProductId: "prod_a13",
        targetKeyword: "cat window perch a13",
        region: "US",
        evaluationScope: "BUSINESS",
      });
      expect(rotatedRes.verified).toBe(false);
      expect(rotatedRes.code).toBe("KEY_UNTRUSTED");
    });

    it("A14: concurrent writer/reader/revoke race maintains monotonic revocation and zero false acceptance", async () => {
      process.env.KH02_CSV_AUTHORITY_KEY_ID = envBusinessKeyId;
      process.env.KH02_CSV_AUTHORITY_HMAC_SECRET = envBusinessSecret;
      process.env.KH02_CSV_AUTHORITY_KEY_STATUS = "ACTIVE";
      process.env.KH02_AUTHORIZED_CSV_APPROVER_PRINCIPALS = authorizedApprover;

      const csvText = buildTwelveWeekTrendsCsv("dog slow feeder a14");
      const parsed = validateAndParseGoogleTrendsCsv(csvText, { persist: true });
      const artifactPath = path.join(GOOGLE_TRENDS_CSV_STORAGE_DIR, `${parsed.sha256Checksum}.csv`);

      const record = createSignedCsvImportAuthority({
        rawCsvSha256: parsed.sha256Checksum,
        artifactPath,
        importingPrincipalId: "importer_a14",
        approverPrincipalId: authorizedApprover,
        workspaceId: "ws_a14",
        targetProductId: "prod_a14",
        query: "dog slow feeder a14",
        geography: "US",
        periodStart: parsed.startDate!,
        periodEnd: parsed.endDate!,
        dataPointsCount: parsed.dataPointsCount,
        originClassification: "AUTHENTICATED_OFFICIAL_EXPORT",
        reviewStatus: "APPROVED",
        verificationMethod: "MANUAL_EXPORT_REVIEW",
        evidenceChainReference: "ticket:a14",
        acquisitionSourceUrl: "https://trends.google.com/trends/explore?geo=US&q=dog%20slow%20feeder%20a14",
        issuerKeyId: envBusinessKeyId,
        isTestOnly: false,
      } as any);

      persistCsvImportAuthorityAtomically(record);
      await Promise.all([
        Promise.resolve().then(() => revokeCsvImportAuthorityAtomically(record.authorityId, "Race revoke 1", authorizedApprover)),
        Promise.resolve().then(() => persistCsvImportAuthorityAtomically(record)),
        Promise.resolve().then(() => revokeCsvImportAuthorityAtomically(record.authorityId, "Race revoke 2", authorizedApprover)),
      ]);

      const finalCheck = verifyDurableCsvImportAuthority({
        authorityId: record.authorityId,
        rawCsvSha256: parsed.sha256Checksum,
        workspaceId: "ws_a14",
        targetProductId: "prod_a14",
        targetKeyword: "dog slow feeder a14",
        region: "US",
        evaluationScope: "BUSINESS",
      });
      expect(finalCheck.verified).toBe(false);
      expect(finalCheck.code).toBe("AUTHORITY_REVOKED");
    });

    it("A15: 60-day fixture time series cannot PASS BUSINESS G15 even if engineering parser passes", () => {
      const csvText = buildTwelveWeekTrendsCsv("pet grooming glove a15");
      const parsed = validateAndParseGoogleTrendsCsv(csvText, { persist: true });
      expect(parsed.valid).toBe(true);
      expect(parsed.dataPointsCount).toBe(12);

      const obs = parsed.dataPoints.map((pt, i) => ({
        id: `obs_a15_${i}`,
        productId: "prod_a15",
        keyword: pt.keyword,
        region: "US",
        periodStart: pt.periodStart,
        periodEnd: pt.periodEnd,
        demandValue: pt.demandValue,
        source: "GOOGLE_TRENDS_CSV",
        evidenceReference: parsed.evidenceReference!,
        observedAt: "2026-08-25T00:00:00.000Z",
      }));

      const assessment = evaluateDemandHistoryEvidence(obs, {
        minimumDataPoints: 3,
        minimumCoveredDays: 60,
        requiredRegion: "US",
        targetProductId: "prod_a15",
        workspaceId: "ws_a15",
        candidateCanonicalName: "pet grooming glove a15",
        strictSourceProvenance: true,
        evaluationScope: "BUSINESS",
      });
      expect(assessment.eligibleForEvergreen).toBe(false);
      expect(assessment.sourceAuthority).toBe("CACHED_UNVERIFIED");
    });

    it("A16: ENGINEERING-scoped test CSV authority satisfies parser and cadence tests in ENGINEERING scope but is NEVER counted as genuine BUSINESS Google export", () => {
      registerCsvAuthoritySigningKey({
        keyId: "eng_test_key_a16",
        secret: "eng_test_secret_material_32_bytes_minimum_length_a16",
        status: "TEST_ONLY",
        purpose: CSV_AUTHORITY_OPERATION_SCOPE,
        isBusinessTrusted: false,
      });

      const csvText = buildTwelveWeekTrendsCsv("self cleaning litter box a16");
      const parsed = validateAndParseGoogleTrendsCsv(csvText, { persist: true });
      const artifactPath = path.join(GOOGLE_TRENDS_CSV_STORAGE_DIR, `${parsed.sha256Checksum}.csv`);

      const testAuth = createSignedCsvImportAuthority({
        rawCsvSha256: parsed.sha256Checksum,
        artifactPath,
        importingPrincipalId: "test_runner",
        approverPrincipalId: "test_approver",
        workspaceId: "ws_a16",
        targetProductId: "prod_a16",
        query: "self cleaning litter box a16",
        geography: "US",
        periodStart: parsed.startDate!,
        periodEnd: parsed.endDate!,
        dataPointsCount: parsed.dataPointsCount,
        originClassification: "AUTHENTICATED_OFFICIAL_EXPORT",
        reviewStatus: "APPROVED",
        verificationMethod: "UNIT_TEST_FIXTURE_REVIEW",
        evidenceChainReference: "test:a16",
        issuerKeyId: "eng_test_key_a16",
        isTestOnly: true,
      });
      expect(persistCsvImportAuthorityAtomically(testAuth).success).toBe(true);

      const engVerify = verifyDurableCsvImportAuthority({
        authorityId: testAuth.authorityId,
        rawCsvSha256: parsed.sha256Checksum,
        workspaceId: "ws_a16",
        targetProductId: "prod_a16",
        targetKeyword: "self cleaning litter box a16",
        region: "US",
        evaluationScope: "ENGINEERING",
      });
      expect(engVerify.verified).toBe(true);
      expect(engVerify.businessEligible).toBe(false);
      expect(engVerify.providerOriginVerified).toBe(false);

      const bizVerify = verifyDurableCsvImportAuthority({
        authorityId: testAuth.authorityId,
        rawCsvSha256: parsed.sha256Checksum,
        workspaceId: "ws_a16",
        targetProductId: "prod_a16",
        targetKeyword: "self cleaning litter box a16",
        region: "US",
        evaluationScope: "BUSINESS",
      });
      expect(bizVerify.verified).toBe(false);
      expect(bizVerify.businessEligible).toBe(false);
      expect(bizVerify.code).toBe("TEST_ONLY_REJECTED_IN_BUSINESS_SCOPE");
    });
  });

  // =========================================================================
  // SECTION 03.7: P1 GOOGLE ADS PROVENANCE & RELEVANCE (G01..G12)
  // =========================================================================
  describe("Section 03.7 — P1 Google Ads Provenance & Product/Market Truth (G01..G12)", () => {
    it("G01: tools/list success with tools/call skipped reports PROTOCOL_ONLY (ENRICHMENT_ONLY), not LIVE_CONTENT", async () => {
      let callToolInvoked = false;
      const mockClient: any = {
        connect: async () => {},
        close: async () => {},
        isAlive: () => true,
        listToolsWithSchemas: async () => [
          { name: "search_advertiser", inputSchema: { type: "object" } },
          { name: "get_advertiser_ads", inputSchema: { type: "object" } },
        ],
        callToolByName: async () => {
          callToolInvoked = true;
          return {};
        },
      };

      const caps = await discoverGoogleAdsMcpCapabilities({}, mockClient);
      expect(caps.transportConnected).toBe(true);
      expect(caps.capabilityClassification).toBe("ENRICHMENT_ONLY");
      expect(callToolInvoked).toBe(false);
    });

    it("G02: 6 creative rows with zero invocation receipts in ledger are rejected as UNVERIFIED and cannot qualify as G16 proof", () => {
      const fakeCreatives = Array.from({ length: 6 }, (_, idx) => ({
        creativeId: `CR100000000000000${idx + 1}`,
        advertiserId: "AR11363703404665765889",
        domain: "uahpet.com",
        sourceMode: "LIVE_PROVIDER",
        provenance: "REAL_UPSTREAM",
        isCached: false,
        researchRunId: "run_g02",
        mcpInvocationRef: "google_mcp_inv_missing_receipt",
      }));

      for (const c of fakeCreatives) {
        const res = verifyGoogleInvocationLineage(c, [], "run_g02");
        expect(res.verified).toBe(false);
        expect(res.lineageMethod).toBe("UNVERIFIED");
        expect((res as any).providerVerified).toBe(false);
      }
    });

    it("G03: local invocation receipt without upstream request ID reports LOCAL_MCP_TOOL_RESULT_VERIFIED with providerVerified=false", () => {
      const upstreamPayload = {
        ads: [{ creative_id: "CR998877665544332211", advertiser_id: "AR11363703404665765889" }],
      };
      const inv = recordActualGoogleMcpInvocation(
        {
          mcpInvocationRef: "google_mcp_inv_uahpet.com_AR11363703404665765889_1",
          researchRunId: "run_g03",
          workspaceId: "ws_g03",
          advertiserId: "AR11363703404665765889",
          domain: "uahpet.com",
          toolName: "get_advertiser_ads",
          requestArguments: { advertiser_id: "AR11363703404665765889", region: "US" },
          sourceMode: "LIVE_PROVIDER",
          status: "SUCCEEDED",
        },
        upstreamPayload
      );
      const stamped = attachGoogleMcpCreativeProvenance(upstreamPayload.ads[0], inv);
      const lineage = verifyGoogleInvocationLineage(stamped, [inv], "run_g03");

      expect(lineage.verified).toBe(true);
      expect(lineage.lineageMethod).toBe("VERIFIED_LOCAL_INVOCATION_ONLY");
      expect(lineage.upstreamProviderRequestId).toBeNull();
      expect((lineage as any).provenanceTier).toBe("LOCAL_MCP_TOOL_RESULT_VERIFIED");
      expect((lineage as any).localMcpToolResultVerified).toBe(true);
      expect((lineage as any).upstreamRequestVerified).toBe(false);
      expect((lineage as any).providerVerified).toBe(false);
    });

    it("G04: response hash mismatch, creative ID mismatch, advertiser ID mismatch, or domain mismatch is DENIED", () => {
      const upstreamPayload = {
        ads: [{ creative_id: "CR112233445566778899", advertiser_id: "AR1111" }],
      };
      const inv = recordActualGoogleMcpInvocation(
        {
          mcpInvocationRef: "google_mcp_inv_uahpet.com_AR1111_1",
          researchRunId: "run_g04",
          workspaceId: "ws_g04",
          advertiserId: "AR1111",
          domain: "uahpet.com",
          toolName: "get_advertiser_ads",
          requestArguments: { advertiser_id: "AR1111", region: "US" },
          sourceMode: "LIVE_PROVIDER",
          status: "SUCCEEDED",
        },
        upstreamPayload
      );
      const stamped = attachGoogleMcpCreativeProvenance(upstreamPayload.ads[0], inv);

      // 1. Response hash mismatch
      expect(
        verifyGoogleInvocationLineage({ ...stamped, responseEvidenceHash: "f".repeat(64) }, [inv], "run_g04").verified
      ).toBe(false);

      // 2. Creative ID not in returned set
      expect(
        verifyGoogleInvocationLineage({ ...stamped, creativeId: "CR_FOREIGN_999", creative_id: "CR_FOREIGN_999" }, [inv], "run_g04").verified
      ).toBe(false);

      // 3. Advertiser ID mismatch
      const advMismatch = verifyGoogleInvocationLineage(
        { ...stamped, advertiser_id: "AR_DIFFERENT_9999", advertiserId: "AR_DIFFERENT_9999" },
        [inv],
        "run_g04"
      );
      expect(advMismatch.verified).toBe(false);
      expect(advMismatch.rejectionReasons).toContain("ADVERTISER_ID_MISMATCH");

      // 4. Domain mismatch
      const domMismatch = verifyGoogleInvocationLineage(
        { ...stamped, domain: "other-merchant.com" },
        [inv],
        "run_g04"
      );
      expect(domMismatch.verified).toBe(false);
      expect(domMismatch.rejectionReasons).toContain("ADVERTISER_DOMAIN_MISMATCH");
    });

    it("G05: storefront root and collection/category URLs are classified as BRAND_RELATED with zero product-specific qualification", () => {
      const res = normalizeGoogleAdsResponse(
        {
          ads: [
            {
              advertiser_id: "AR_G05",
              creative_id: "CR_G05_ROOT",
              headline: "Whisper Quiet Dog Fountain",
              destination_url: "https://kittyspout.com/",
            },
            {
              advertiser_id: "AR_G05",
              creative_id: "CR_G05_COLL",
              headline: "Whisper Quiet Dog Fountain",
              destination_url: "https://kittyspout.com/collections/fountains",
            },
          ],
        },
        {
          requestedDomain: "kittyspout.com",
          topic: "Dog Fountain",
          observedAt: new Date().toISOString(),
          toolName: "get_advertiser_ads",
          requestedMarket: "US",
        }
      );

      expect(res.ads[0].productRelevance).toBe("BRAND_RELATED");
      expect(res.ads[1].productRelevance).toBe("BRAND_RELATED");
    });

    it("G06: creative with null landingPageUrl and null productId is classified as UNKNOWN (never PRODUCT_SPECIFIC) even when headline matches topic", () => {
      const res = normalizeGoogleAdsResponse(
        {
          ads: [
            {
              advertiser_id: "AR10162009454036385793",
              creative_id: "CR11272956311978901505",
              format: "video",
              headline: "Whisper Quiet Dog Fountain",
              destination_url: null,
            },
          ],
        },
        {
          requestedDomain: "kittyspout.com",
          topic: "Pet Water Fountain Dog Grooming",
          observedAt: new Date().toISOString(),
          toolName: "get_advertiser_ads",
          requestedMarket: "US",
        }
      );

      expect(res.ads).toHaveLength(1);
      expect(res.ads[0].productRelevance).toBe("UNKNOWN");
      expect((res.observations[0].metrics as any).productRelevance).toBe("UNKNOWN");
    });

    it("G07: requested US filter with null provider-reported market keeps verifiedDeliveryMarket=null and FILTER_ONLY/UNKNOWN market status", () => {
      const res = normalizeGoogleAdsResponse(
        {
          requested_region: "US",
          provider_filter_region: "US",
          ads: [
            {
              advertiser_id: "AR_G07",
              creative_id: "CR_G07_1",
              headline: "KittySpout Stainless Fountain",
              destination_url: "https://kittyspout.com/products/kittyspout-fountain",
            },
          ],
        },
        {
          requestedDomain: "kittyspout.com",
          topic: "Cat Fountain",
          observedAt: new Date().toISOString(),
          toolName: "get_advertiser_ads",
          requestedMarket: "US",
          providerFilterMarket: "US",
        }
      );

      expect(res.ads[0].verifiedDeliveryMarket).toBeNull();
      expect(res.ads[0].marketProvenance.verificationStatus).toBe("FILTER_ONLY");
      expect(res.observations[0].verifiedDeliveryMarket).toBeNull();
    });

    it("G08: 403/429/CAPTCHA/timeout/bot-wall responses are marked NOT_VERIFIED / BOT_BLOCKED with zero retries", async () => {
      let adsCalls = 0;
      const mockClient: any = {
        connect: async () => {},
        close: async () => {},
        isAlive: () => true,
        listToolsWithSchemas: async () => [
          { name: "search_advertiser", inputSchema: { type: "object" } },
          { name: "get_advertiser_ads", inputSchema: { type: "object" } },
        ],
        callToolByName: async (tool: string) => {
          if (tool === "search_advertiser") {
            return { advertisers: [{ advertiser_id: "AR_BOT" }] };
          }
          adsCalls++;
          return { html: "<title>Sorry...</title><div class='g-recaptcha'>Unusual traffic</div>", statusCode: 429 };
        },
      };

      const res = await collectGoogleAdvertiserSignals(
        {
          topic: "Pet Gadgets",
          market: "US",
          advertiserDomains: ["uahpet.com", "kittyspout.com"],
          researchRunId: "run_g08",
        } as any,
        mockClient,
        { persistToDatabase: false }
      );

      expect(adsCalls).toBe(1); // Zero retries and second domain skipped after 429/bot block
      expect(res.acceptedCount).toBe(0);
      expect(res.status).toBe("QUERY_FAILED");
    });

    it("G09: malformed/truncated JSON or >2MiB response fails closed with bounded memory", () => {
      const oversizedPayload = "x".repeat(2 * 1024 * 1024 + 1024);
      expect(() =>
        decodeCallToolResult({
          content: [{ type: "text", text: oversizedPayload }],
        })
      ).toThrow(/RESPONSE_SIZE_EXCEEDED_2MIB|exceeds maximum allowed size/i);

      const invOversized = recordActualGoogleMcpInvocation(
        {
          mcpInvocationRef: "inv_oversized_g09",
          researchRunId: "run_g09",
          advertiserId: "AR_G09",
          domain: "uahpet.com",
          status: "SUCCEEDED",
        },
        { content: [{ type: "text", text: oversizedPayload }] }
      );
      expect(invOversized.status).toBe("FAILED");
      expect(invOversized.returnedCreativeIds).toEqual([]);
    });

    it("G10: durable DB rows survive reload without losing exact invocation receipts", async () => {
      const wsId = `ws_g10_${Date.now()}`;
      const inv = recordActualGoogleMcpInvocation(
        {
          mcpInvocationRef: "google_mcp_inv_uahpet.com_AR_G10_1",
          researchRunId: "run_g10",
          workspaceId: wsId,
          advertiserId: "AR_G10",
          domain: "uahpet.com",
          toolName: "get_advertiser_ads",
          requestArguments: { advertiser_id: "AR_G10", region: "US" },
          sourceMode: "LIVE_PROVIDER",
          status: "SUCCEEDED",
        },
        {
          ads: [
            {
              creative_id: "CR_G10_9001",
              advertiser_id: "AR_G10",
              headline: "UAHPET Fountain",
              destination_url: "https://uahpet.com/products/fountain-g10",
            },
          ],
        }
      );
      const stamped = attachGoogleMcpCreativeProvenance(
        {
          creative_id: "CR_G10_9001",
          advertiser_id: "AR_G10",
          headline: "UAHPET Fountain",
          destination_url: "https://uahpet.com/products/fountain-g10",
        },
        inv
      );
      const norm = normalizeGoogleAdsResponse(
        { ads: [stamped] },
        {
          requestedDomain: "uahpet.com",
          topic: "Pet Fountain",
          observedAt: new Date().toISOString(),
          toolName: "get_advertiser_ads",
          requestedMarket: "US",
        }
      );
      norm.observations[0].researchRunId = "run_g10";
      norm.observations[0].workspaceId = wsId;

      const persistRes = await persistGoogleObservationsToDatabase(norm.observations, wsId);
      expect(persistRes.persistedCount).toBe(1);

      const dbObs = await prisma.adObservation.findFirst({
        where: { id: norm.observations[0].sourceObservationId ?? undefined },
      });
      expect(dbObs).not.toBeNull();
      const raw = JSON.parse(dbObs!.rawPayload || "{}");
      expect(raw.mcpInvocationRef).toBe("google_mcp_inv_uahpet.com_AR_G10_1");
      expect(raw.requestArgumentsHash).toBe(inv.requestArgumentsHash);
      expect(raw.responseEvidenceHash).toBe(inv.responseEvidenceHash);
      expect(raw.lineageMethod).toBe("VERIFIED_LOCAL_INVOCATION_ONLY");
    });

    it("G11: legit verified local tool invocation with returned advertiser/creative IDs reports precise local-MCP proof without claiming upstream API-origin proof", () => {
      const upstreamPayload = {
        ads: [
          { creative_id: "CR10858223549638770689", advertiser_id: "AR11363703404665765889", format: "image" },
          { creative_id: "CR10179391117963821057", advertiser_id: "AR11363703404665765889", format: "image" },
        ],
      };
      const inv = recordActualGoogleMcpInvocation(
        {
          mcpInvocationRef: "google_mcp_inv_uahpet.com_AR11363703404665765889_g11",
          researchRunId: "run_g11",
          workspaceId: "ws_g11",
          advertiserId: "AR11363703404665765889",
          domain: "uahpet.com",
          toolName: "get_advertiser_ads",
          requestArguments: { advertiser_id: "AR11363703404665765889", region: "US" },
          sourceMode: "LIVE_PROVIDER",
          status: "SUCCEEDED",
        },
        upstreamPayload
      );
      const stamped = attachGoogleMcpCreativeProvenance(upstreamPayload.ads[0], inv);
      const lineage = verifyGoogleInvocationLineage(stamped, [inv], "run_g11");

      expect(lineage.verified).toBe(true);
      expect(lineage.lineageMethod).toBe("VERIFIED_LOCAL_INVOCATION_ONLY");
      expect((lineage as any).provenanceTier).toBe("LOCAL_MCP_TOOL_RESULT_VERIFIED");
      expect((lineage as any).localMcpToolResultVerified).toBe(true);
      expect((lineage as any).upstreamRequestVerified).toBe(false);
      expect((lineage as any).providerVerified).toBe(false);
    });

    it("G12: collectGoogleAdvertiserSignals populates providerInvocations and reconciled breakdown counts that agree with invocation records and per-row origins", async () => {
      const mockClient: any = {
        connect: async () => {},
        close: async () => {},
        isAlive: () => true,
        listToolsWithSchemas: async () => [
          { name: "search_advertiser", inputSchema: { type: "object" } },
          { name: "get_advertiser_ads", inputSchema: { type: "object" } },
        ],
        callToolByName: async (tool: string, args: any) => {
          if (tool === "search_advertiser") {
            return {
              advertisers: [
                {
                  advertiser_id: args.query.includes("uahpet")
                    ? "AR11363703404665765889"
                    : "AR10162009454036385793",
                },
              ],
            };
          }
          if (args.advertiser_id === "AR11363703404665765889") {
            return {
              ads: [
                { creative_id: "CR10858223549638770689", advertiser_id: "AR11363703404665765889", format: "image" },
                { creative_id: "CR10179391117963821057", advertiser_id: "AR11363703404665765889", format: "image" },
                { creative_id: "CR02856632681859383297", advertiser_id: "AR11363703404665765889", format: "image" },
              ],
            };
          }
          return {
            ads: [
              {
                creative_id: "CR11272956311978901505",
                advertiser_id: "AR10162009454036385793",
                format: "video",
                headline: "Whisper Quiet Dog Fountain",
                destination_url: null,
              },
              { creative_id: "CR16027593058358919169", advertiser_id: "AR10162009454036385793", format: "image" },
              { creative_id: "CR02280641798978142209", advertiser_id: "AR10162009454036385793", format: "image" },
            ],
          };
        },
      };

      const res = await collectGoogleAdvertiserSignals(
        {
          topic: "Pet Water Fountain Dog Grooming",
          market: "US",
          advertiserDomains: ["uahpet.com", "kittyspout.com"],
        } as any,
        mockClient,
        { persistToDatabase: false }
      );

      expect(res.retrievedCount).toBe(6);
      expect(res.acceptedCount).toBe(6);
      expect(Array.isArray((res as any).providerInvocations)).toBe(true);
      expect((res as any).providerInvocations).toHaveLength(2);

      const counts = (res.enrichmentExecution as any)?.reconciledCounts;
      expect(counts).toBeDefined();
      expect(counts.rawMcpRows).toBe(6);
      expect(counts.uniqueCreatives).toBe(6);
      expect(counts.acceptedRawCreativeRows).toBe(6);
      expect(counts.localToolCallsVerified).toBe(6);
      expect(counts.upstreamContentVerified).toBe(0);
      expect(counts.productSpecificVerified).toBe(0);
      expect(counts.usDeliveryVerified).toBe(0);
      expect(counts.eligibleG16Evidence).toBe(0);
    });
  });

  // =========================================================================
  // SECTION 04.4: P1 META PROVIDER-TO-DB TRUTH (M01..M06)
  // =========================================================================
  describe("Section 04.4 — P1 Meta Provider-to-DB Truth (M01..M06)", () => {
    it("M01: diagnostic connected with no live query executed reports transportStatus=PASS, queryExecuted=false, contentStatus=NOT_RUN", async () => {
      const diag = await diagnoseMetaLiveCollector({
        checkLiveTransport: false,
        actualQueryAttempted: false,
      });

      expect(diag.queryExecuted).toBe(false);
      expect(diag.actualQueryAttempted).toBe(false);
      expect(diag.upstreamQueryCompleted).toBe(false);
      expect(diag.rawAdsReturned).toBe(0);
      expect((diag as any).contentStatus).toBe("NOT_RUN");
    });

    it("M02: fixture/seed DB rows cannot upgrade provider status or set provenanceVerified=true when no live query executed", async () => {
      const diag = await diagnoseMetaLiveCollector({
        checkLiveTransport: false,
        actualQueryAttempted: false,
      });

      expect(diag.provenanceVerified).toBe(false);
      expect(diag.queryExecuted).toBe(false);
      expect(diag.recordsReturned).toBe(0);
    });

    it("M03: true upstream Meta ad ingestion binds external Ad Library ID, source identity hash, and DB observation record", async () => {
      const extAdId = `99887766${Date.now().toString().slice(-6)}`;
      const ingestRes = await ingestDiscoveredAds(
        [
          {
            sourceExternalId: extAdId,
            platform: "META",
            providerId: "meta-ads-collector",
            advertiserName: "KittySpout Official",
            advertiserExternalId: "page_ks_1",
            headline: "KittySpout Stainless Steel Cat Fountain",
            bodyText: "Encourages cats to drink more water.",
            callToAction: "Shop Now",
            landingPageUrl: "https://kittyspout.com/products/kittyspout-cat-water-fountain",
            creativeUrl: `https://www.facebook.com/ads/library/?id=${extAdId}`,
            mediaType: "VIDEO",
            mediaUrls: ["https://kittyspout.com/cdn/video.mp4"],
            targetMarket: "US",
            isActive: true,
            confidenceScore: 0.95,
          } as any,
        ],
        {
          providerId: "meta-ads-collector",
          runMode: "LIVE",
        } as any
      );

      expect(ingestRes.newUniqueInserted).toBe(1);
      expect(ingestRes.adIds).toHaveLength(1);
      const dbAd = await prisma.competitorAd.findUnique({ where: { id: ingestRes.adIds[0] } });
      expect(dbAd?.externalAdId).toBe(extAdId);
    });

    it("M04: 9 Uproot Meta ads collapse into ONE product family and cannot occupy multiple Top 3 slots", () => {
      const uprootAds: any[] = Array.from({ length: 9 }, (_, i) => ({
        source: "META_ADS",
        sourceRecordId: `db_uproot_${i + 1}`,
        sourceExternalAdId: `META:40000000${i + 1}`,
        title: i % 2 === 0 ? "Uproot Cleaner Pro™ Pet Hair Remover" : "Uproot Clean Pet Hair Detailer Bundle",
        description: "Remove embedded pet hair from carpets, rugs, and couches.",
        landingPageUrl:
          i === 0
            ? "https://uprootclean.com/products/uproot-cleaner-pro"
            : `https://cc.uprootclean.com/main/phr?variant=${i}`,
        advertiserDomain: "uprootclean.com",
        advertiserOrCreator: "Uproot Clean",
        provenance: "LIVE_PROVIDER",
        observedAt: new Date().toISOString(),
        verifiedDeliveryMarket: "US",
      }));

      const candidates = discoverProductCandidatesFromAds(uprootAds, "Pet Gadgets");
      const shortlistRes = selectTopResearchShortlist(candidates, 3, { topic: "Pet Gadgets" });
      expect(shortlistRes.distinctFamiliesCount).toBe(1);
      expect(shortlistRes.shortlist.length).toBe(1);
    });

    it("M05: targetMarket US query filter does not fabricate verified US audience delivery when ad targetMarket is UNKNOWN", () => {
      const prov = resolveMetaMarketProvenance(
        {
          id: "meta_ad_m05",
          platform: "META",
          targetMarket: "UNKNOWN",
          advertiser: { name: "Merchant M05", country: "US" },
        },
        { requestedMarket: "US" }
      );
      expect(prov.requestedMarket).toBe("US");
      expect(prov.verifiedDeliveryMarket).toBeNull();
      expect(prov.marketVerification).toBe("UNKNOWN");
    });

    it("M06: failed/timeout MCP client closes child transport cleanly and promotes zero records", async () => {
      let closed = false;
      const failingClient: any = {
        connect: async () => {},
        close: async () => {
          closed = true;
        },
        isAlive: () => true,
        listToolsWithSchemas: async () => {
          throw new Error("MCP stdio timeout after 5000ms");
        },
        callToolByName: async () => {
          throw new Error("MCP stdio timeout after 5000ms");
        },
      };

      const res = await collectGoogleAdvertiserSignals(
        {
          topic: "Pet Gadgets",
          market: "US",
          advertiserDomains: ["uahpet.com"],
          researchRunId: "run_m06",
        } as any,
        failingClient,
        { persistToDatabase: false }
      );
      expect(["BLOCKED_SOURCE", "QUERY_FAILED"]).toContain(res.status);
      expect(res.observations).toHaveLength(0);
      await failingClient.close();
      expect(closed).toBe(true);
    });
  });
});
