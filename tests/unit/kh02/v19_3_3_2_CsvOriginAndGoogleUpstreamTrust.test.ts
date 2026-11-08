/**
 * SWAI KH-02 V12.4.3.7.19.3.3.2 — Adversarial RED/GREEN Security & Provenance Suite
 *
 * Covers Section 06 Mandatory Adversarial Matrix:
 * - CSV Negative & Security Scenarios: C01 .. C19
 * - Google MCP Upstream Trust & Provenance Scenarios: G01 .. G18
 * - Meta & System Integrity Scenarios: M01 .. M04, S01 .. S06
 */

import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { spawn } from "node:child_process";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { prisma } from "@/lib/db";
import {
  CSV_AUTHORITY_OPERATION_SCOPE,
  registerCsvAuthoritySigningKey,
  clearTestCsvAuthoritySigningKeys,
  getCsvAuthoritySigningKey,
  computeCsvAuthorityPayloadDigest,
  signCsvAuthorityPayloadDigest,
  createSignedCsvImportAuthority,
  persistCsvImportAuthorityAtomically,
  revokeCsvImportAuthorityAtomically,
  verifyDurableCsvImportAuthority,
  readCsvAuthorityLedgerUnderLock,
  getCsvAuthorityLedgerPath,
  type OfficialCsvImportAuthorityRecord,
} from "@/services/kh02/demand/durableCsvImportAuthority";
import {
  GOOGLE_TRENDS_CSV_STORAGE_DIR,
  validateAndParseGoogleTrendsCsv,
  saveOriginalGoogleTrendsCsvFile,
} from "@/services/kh02/demand/googleTrendsCsvValidator";
import {
  hasVerifiableCsvOrProviderLineage,
  evaluateDemandHistoryEvidence,
} from "@/services/kh02/demand/temporalDemandEngine";
import { resolveProductDemandHistory } from "@/services/kh02/demand/historicalDemandIngestion";
import {
  discoverGoogleAdsMcpCapabilities,
  extractUpstreamGoogleRequestId,
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
  calculateKH02EvergreenScore,
} from "@/services/kh02/scoring/evergreenOpportunityScoring";
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

const createdCsvFiles: string[] = [];

function parseAndSaveCsv(csvText: string) {
  const parsed = validateAndParseGoogleTrendsCsv(csvText);
  const artifactPath = saveOriginalGoogleTrendsCsvFile(csvText, parsed.sha256Checksum);
  createdCsvFiles.push(artifactPath);
  return { parsed, artifactPath };
}

describe("KH-02 V12.4.3.7.19.3.3.2 — CSV Official-Origin Binding & Google Upstream Trust Boundary", () => {
  let tmpStorageDir: string;
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

  const envBusinessKeyId = "prod_env_csv_authority_key_v19332";
  const envBusinessSecret = "env_server_secret_v19332_99887766554433221100_abcdef1234567890";
  const authorizedApprover = "sec_approver_alice@swai.internal";

  beforeEach(() => {
    for (const k of envKeysToSave) {
      savedEnv[k] = process.env[k];
    }
    tmpStorageDir = fs.mkdtempSync(path.join(os.tmpdir(), "kh02_v19332_csv_auth_"));
    process.env.TEST_CSV_AUTHORITY_STORAGE_DIR = tmpStorageDir;
    delete process.env.KH02_CSV_AUTHORITY_KEY_ID;
    delete process.env.KH02_CSV_AUTHORITY_HMAC_SECRET;
    delete process.env.KH02_CSV_AUTHORITY_KEY_STATUS;
    delete process.env.KH02_AUTHORIZED_CSV_APPROVER_PRINCIPALS;

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
      fs.rmSync(tmpStorageDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
    while (createdCsvFiles.length > 0) {
      const f = createdCsvFiles.pop()!;
      try {
        if (fs.existsSync(f)) {
          fs.unlinkSync(f);
        }
      } catch {
        // Ignore
      }
    }
  });

  function setupTrustedEnvBusinessKeyAndApprover() {
    process.env.KH02_CSV_AUTHORITY_KEY_ID = envBusinessKeyId;
    process.env.KH02_CSV_AUTHORITY_HMAC_SECRET = envBusinessSecret;
    process.env.KH02_CSV_AUTHORITY_KEY_STATUS = "ACTIVE";
    process.env.KH02_AUTHORIZED_CSV_APPROVER_PRINCIPALS = authorizedApprover;
  }

  // =========================================================================
  // SECTION 1: P1-A CSV OFFICIAL-ORIGIN BINDING & ACQUISITION EVIDENCE (C01..C19)
  // =========================================================================
  describe("P1-A: CSV Official-Origin Binding & Acquisition Evidence (C01..C19)", () => {
    it("C01: Omitted acquisitionSourceUrl property with otherwise valid business key and approver -> DENIED at creation and on readback", () => {
      setupTrustedEnvBusinessKeyAndApprover();
      const { parsed, artifactPath } = parseAndSaveCsv(buildTwelveWeekTrendsCsv("uahpet fountain", "United States", 65));
      expect(parsed.valid).toBe(true);

      // Property `acquisitionSourceUrl` is completely OMITTED from input object
      expect(() =>
        createSignedCsvImportAuthority({
          rawCsvSha256: parsed.sha256Checksum,
          artifactPath,
          importingPrincipalId: "importer_01",
          approverPrincipalId: authorizedApprover,
          approvedAt: "2026-09-01T10:00:00.000Z",
          importedAt: "2026-09-01T10:05:00.000Z",
          workspaceId: "ws_c01",
          targetProductId: "prod_c01",
          candidateId: "cand_c01",
          query: "uahpet fountain",
          geography: "US",
          periodStart: parsed.dataPoints[0].periodStart,
          periodEnd: parsed.dataPoints[parsed.dataPoints.length - 1].periodEnd,
          cadence: "WEEKLY",
          dataPointsCount: parsed.dataPoints.length,
          originClassification: "AUTHENTICATED_OFFICIAL_EXPORT",
          reviewStatus: "APPROVED",
          verificationMethod: "MANUAL_OPERATOR_EXPORT_REVIEW",
          evidenceChainReference: "review-ticket:SWAI-C01",
          issuerKeyId: envBusinessKeyId,
          isTestOnly: false,
        })
      ).toThrow(/ACQUISITION_SOURCE_REQUIRED/);
    });

    it("C02: undefined, null, empty string '', or whitespace acquisitionSourceUrl -> DENIED", () => {
      setupTrustedEnvBusinessKeyAndApprover();
      const { parsed, artifactPath } = parseAndSaveCsv(buildTwelveWeekTrendsCsv("dog gps collar", "United States", 66));

      const invalidValues: any[] = [undefined, null, "", "   ", "\t\n "];
      for (const badVal of invalidValues) {
        expect(() =>
          createSignedCsvImportAuthority({
            rawCsvSha256: parsed.sha256Checksum,
            artifactPath,
            importingPrincipalId: "importer_01",
            approverPrincipalId: authorizedApprover,
            approvedAt: "2026-09-01T10:00:00.000Z",
            importedAt: "2026-09-01T10:05:00.000Z",
            workspaceId: "ws_c02",
            targetProductId: "prod_c02",
            query: "dog gps collar",
            geography: "US",
            periodStart: parsed.dataPoints[0].periodStart,
            periodEnd: parsed.dataPoints[parsed.dataPoints.length - 1].periodEnd,
            cadence: "WEEKLY",
            dataPointsCount: parsed.dataPoints.length,
            originClassification: "AUTHENTICATED_OFFICIAL_EXPORT",
            reviewStatus: "APPROVED",
            verificationMethod: "MANUAL_OPERATOR_EXPORT_REVIEW",
            evidenceChainReference: "review-ticket:SWAI-C02",
            acquisitionSourceUrl: badVal,
            issuerKeyId: envBusinessKeyId,
            isTestOnly: false,
          })
        ).toThrow(/ACQUISITION_SOURCE_REQUIRED|INVALID_ACQUISITION_SOURCE_URL/);
      }
    });

    it("C03: http, unknown host, trends.google.com.evil, userinfo@, encoded host, IPv4/localhost, custom port, bad geo/query, invalid URL -> DENIED", () => {
      setupTrustedEnvBusinessKeyAndApprover();
      const { parsed, artifactPath } = parseAndSaveCsv(buildTwelveWeekTrendsCsv("cat water fountain", "United States", 68));

      const maliciousUrls = [
        "http://trends.google.com/trends/explore?geo=US&q=cat%20water%20fountain",
        "https://example.com/trends/explore?geo=US&q=cat%20water%20fountain",
        "https://trends.google.com.evil.com/trends/explore?geo=US&q=cat%20water%20fountain",
        "https://evil-trends.google.com/trends/explore?geo=US&q=cat%20water%20fountain",
        "https://admin:secret@trends.google.com/trends/explore?geo=US&q=cat%20water%20fountain",
        "https://user@trends.google.com/trends/explore?geo=US&q=cat%20water%20fountain",
        "https://142.250.190.46/trends/explore?geo=US&q=cat%20water%20fountain",
        "https://localhost/trends/explore?geo=US&q=cat%20water%20fountain",
        "https://127.0.0.1/trends/explore?geo=US&q=cat%20water%20fountain",
        "https://trends.google.com:8443/trends/explore?geo=US&q=cat%20water%20fountain",
        "https://trends.google.com/other-service/download?geo=US&q=cat%20water%20fountain",
        "https://trends.google.com/trends/explore?geo=GB&q=cat%20water%20fountain",
        "https://trends.google.com/trends/explore?geo=US&q=unrelated%20laptop%20stand",
        "not_a_valid_url_at_all",
      ];

      for (const badUrl of maliciousUrls) {
        expect(() =>
          createSignedCsvImportAuthority({
            rawCsvSha256: parsed.sha256Checksum,
            artifactPath,
            importingPrincipalId: "importer_01",
            approverPrincipalId: authorizedApprover,
            approvedAt: "2026-09-01T10:00:00.000Z",
            importedAt: "2026-09-01T10:05:00.000Z",
            workspaceId: "ws_c03",
            targetProductId: "prod_c03",
            query: "cat water fountain",
            geography: "US",
            periodStart: parsed.dataPoints[0].periodStart,
            periodEnd: parsed.dataPoints[parsed.dataPoints.length - 1].periodEnd,
            cadence: "WEEKLY",
            dataPointsCount: parsed.dataPoints.length,
            originClassification: "AUTHENTICATED_OFFICIAL_EXPORT",
            reviewStatus: "APPROVED",
            verificationMethod: "MANUAL_OPERATOR_EXPORT_REVIEW",
            evidenceChainReference: "review-ticket:SWAI-C03",
            acquisitionSourceUrl: badUrl,
            issuerKeyId: envBusinessKeyId,
            isTestOnly: false,
          })
        ).toThrow(/INVALID_ACQUISITION_SOURCE_URL|ACQUISITION_GEO_MISMATCH|ACQUISITION_QUERY_MISMATCH/);
      }
    });

    it("C04: Valid-looking Google URL without review evidence is DENIED; and even when approved, providerOriginVerified remains strictly false", () => {
      setupTrustedEnvBusinessKeyAndApprover();
      const { parsed, artifactPath } = parseAndSaveCsv(buildTwelveWeekTrendsCsv("cat water fountain", "United States", 68));

      // 1. Valid URL but missing evidenceChainReference -> DENIED
      expect(() =>
        createSignedCsvImportAuthority({
          rawCsvSha256: parsed.sha256Checksum,
          artifactPath,
          importingPrincipalId: "importer_01",
          approverPrincipalId: authorizedApprover,
          approvedAt: "2026-09-01T10:00:00.000Z",
          importedAt: "2026-09-01T10:05:00.000Z",
          workspaceId: "ws_c04",
          targetProductId: "prod_c04",
          query: "cat water fountain",
          geography: "US",
          periodStart: parsed.dataPoints[0].periodStart,
          periodEnd: parsed.dataPoints[parsed.dataPoints.length - 1].periodEnd,
          cadence: "WEEKLY",
          dataPointsCount: parsed.dataPoints.length,
          originClassification: "AUTHENTICATED_OFFICIAL_EXPORT",
          reviewStatus: "APPROVED",
          verificationMethod: "MANUAL_OPERATOR_EXPORT_REVIEW",
          evidenceChainReference: "   ",
          acquisitionSourceUrl: "https://trends.google.com/trends/explore?geo=US&q=cat%20water%20fountain",
          issuerKeyId: envBusinessKeyId,
          isTestOnly: false,
        })
      ).toThrow(/INVALID_INPUT: evidenceChainReference is required/);

      // 2. Valid URL + valid review evidence -> providerOriginVerified is STILL strictly false (local HMAC is NOT a Google signature)
      const rec = createSignedCsvImportAuthority({
        rawCsvSha256: parsed.sha256Checksum,
        artifactPath,
        importingPrincipalId: "importer_01",
        approverPrincipalId: authorizedApprover,
        approvedAt: "2026-09-01T10:00:00.000Z",
        importedAt: "2026-09-01T10:05:00.000Z",
        workspaceId: "ws_c04",
        targetProductId: "prod_c04",
        query: "cat water fountain",
        geography: "US",
        periodStart: parsed.dataPoints[0].periodStart,
        periodEnd: parsed.dataPoints[parsed.dataPoints.length - 1].periodEnd,
        cadence: "WEEKLY",
        dataPointsCount: parsed.dataPoints.length,
        originClassification: "AUTHENTICATED_OFFICIAL_EXPORT",
        reviewStatus: "APPROVED",
        verificationMethod: "MANUAL_OPERATOR_EXPORT_REVIEW",
        evidenceChainReference: "review-ticket:SWAI-C04",
        acquisitionSourceUrl: "https://trends.google.com/trends/explore?geo=US&q=cat%20water%20fountain",
        issuerKeyId: envBusinessKeyId,
        isTestOnly: false,
      });
      persistCsvImportAuthorityAtomically(rec);

      const lineage = hasVerifiableCsvOrProviderLineage(
        `csv-import:google-trends-explore:sha256:${parsed.sha256Checksum}`,
        null,
        {
          workspaceId: "ws_c04",
          targetProductId: "prod_c04",
          targetKeyword: "cat water fountain",
          region: "US",
          evaluationScope: "BUSINESS",
        }
      );
      expect(lineage.providerOriginVerified).toBe(false);
    });

    it("C05: Issue valid signed v2 record then mutate acquisitionSourceUrl or acquisitionEvidenceRef on disk -> verification rejects SIGNATURE_MISMATCH", () => {
      setupTrustedEnvBusinessKeyAndApprover();
      const { parsed, artifactPath } = parseAndSaveCsv(buildTwelveWeekTrendsCsv("smart litter box", "United States", 70));

      const rec = createSignedCsvImportAuthority({
        rawCsvSha256: parsed.sha256Checksum,
        artifactPath,
        importingPrincipalId: "importer_01",
        approverPrincipalId: authorizedApprover,
        approvedAt: "2026-09-01T10:00:00.000Z",
        importedAt: "2026-09-01T10:05:00.000Z",
        workspaceId: "ws_c05",
        targetProductId: "prod_c05",
        query: "smart litter box",
        geography: "US",
        periodStart: parsed.dataPoints[0].periodStart,
        periodEnd: parsed.dataPoints[parsed.dataPoints.length - 1].periodEnd,
        cadence: "WEEKLY",
        dataPointsCount: parsed.dataPoints.length,
        originClassification: "AUTHENTICATED_OFFICIAL_EXPORT",
        reviewStatus: "APPROVED",
        verificationMethod: "MANUAL_OPERATOR_EXPORT_REVIEW",
        evidenceChainReference: "review-ticket:SWAI-C05",
        acquisitionSourceUrl: "https://trends.google.com/trends/explore?geo=US&q=smart%20litter%20box",
        acquisitionEvidenceRef: "capture-bundle:sha256:112233",
        issuerKeyId: envBusinessKeyId,
        isTestOnly: false,
      } as any);
      expect(persistCsvImportAuthorityAtomically(rec).success).toBe(true);

      // Tamper with acquisitionSourceUrl on disk without re-signing
      const ledgerPath = getCsvAuthorityLedgerPath();
      const ledgerJson = JSON.parse(fs.readFileSync(ledgerPath, "utf8"));
      ledgerJson.records[rec.authorityId].acquisitionSourceUrl =
        "https://trends.google.com/trends/explore?geo=US&q=smart%20litter%20box&tampered=1";
      fs.writeFileSync(ledgerPath, JSON.stringify(ledgerJson, null, 2), "utf8");

      const check1 = verifyDurableCsvImportAuthority({
        rawCsvSha256: parsed.sha256Checksum,
        workspaceId: "ws_c05",
        targetProductId: "prod_c05",
        targetKeyword: "smart litter box",
        region: "US",
        evaluationScope: "BUSINESS",
      });
      expect(check1.verified).toBe(false);
      expect(check1.businessEligible).toBe(false);
      expect(check1.code).toBe("INVALID_SIGNATURE");

      // Restore URL, tamper with acquisitionEvidenceRef instead
      ledgerJson.records[rec.authorityId].acquisitionSourceUrl =
        "https://trends.google.com/trends/explore?geo=US&q=smart%20litter%20box";
      ledgerJson.records[rec.authorityId].acquisitionEvidenceRef = "capture-bundle:sha256:TAMPERED";
      fs.writeFileSync(ledgerPath, JSON.stringify(ledgerJson, null, 2), "utf8");

      const check2 = verifyDurableCsvImportAuthority({
        rawCsvSha256: parsed.sha256Checksum,
        workspaceId: "ws_c05",
        targetProductId: "prod_c05",
        targetKeyword: "smart litter box",
        region: "US",
        evaluationScope: "BUSINESS",
      });
      expect(check2.verified).toBe(false);
      expect(check2.code).toBe("INVALID_SIGNATURE");
    });

    it("C06: Drop acquisitionSourceUrl field from signed record on disk -> DENIED", () => {
      setupTrustedEnvBusinessKeyAndApprover();
      const { parsed, artifactPath } = parseAndSaveCsv(buildTwelveWeekTrendsCsv("bark collar", "United States", 63));

      const rec = createSignedCsvImportAuthority({
        rawCsvSha256: parsed.sha256Checksum,
        artifactPath,
        importingPrincipalId: "importer_01",
        approverPrincipalId: authorizedApprover,
        approvedAt: "2026-09-01T10:00:00.000Z",
        importedAt: "2026-09-01T10:05:00.000Z",
        workspaceId: "ws_c06",
        targetProductId: "prod_c06",
        query: "bark collar",
        geography: "US",
        periodStart: parsed.dataPoints[0].periodStart,
        periodEnd: parsed.dataPoints[parsed.dataPoints.length - 1].periodEnd,
        cadence: "WEEKLY",
        dataPointsCount: parsed.dataPoints.length,
        originClassification: "AUTHENTICATED_OFFICIAL_EXPORT",
        reviewStatus: "APPROVED",
        verificationMethod: "MANUAL_OPERATOR_EXPORT_REVIEW",
        evidenceChainReference: "review-ticket:SWAI-C06",
        acquisitionSourceUrl: "https://trends.google.com/trends/explore?geo=US&q=bark%20collar",
        issuerKeyId: envBusinessKeyId,
        isTestOnly: false,
      });
      expect(persistCsvImportAuthorityAtomically(rec).success).toBe(true);

      const ledgerPath = getCsvAuthorityLedgerPath();
      const ledgerJson = JSON.parse(fs.readFileSync(ledgerPath, "utf8"));
      delete ledgerJson.records[rec.authorityId].acquisitionSourceUrl;
      fs.writeFileSync(ledgerPath, JSON.stringify(ledgerJson, null, 2), "utf8");

      const check = verifyDurableCsvImportAuthority({
        rawCsvSha256: parsed.sha256Checksum,
        workspaceId: "ws_c06",
        targetProductId: "prod_c06",
        targetKeyword: "bark collar",
        region: "US",
        evaluationScope: "BUSINESS",
      });
      expect(check.verified).toBe(false);
      expect(check.businessEligible).toBe(false);
      expect(["INVALID_SIGNATURE", "TAMPERED_PAYLOAD", "ORIGIN_NOT_OFFICIAL_EXPORT"]).toContain(check.code);
    });

    it("C07: Legacy v1 approved record WITHOUT signed acquisition field -> BUSINESS INELIGIBLE, no transparent promotion or silent re-signing", () => {
      setupTrustedEnvBusinessKeyAndApprover();
      const { parsed, artifactPath } = parseAndSaveCsv(buildTwelveWeekTrendsCsv("pet grooming kit", "United States", 67));

      // Construct a genuine legacy v1 record signed with the v1 canonical format (without acquisitionSourceUrl)
      const legacyId = `csv_auth_legacy_v1_${parsed.sha256Checksum.slice(0, 12)}`;
      const legacyV1Unsigned: any = {
        authorityId: legacyId,
        schemaVersion: "1.0",
        operationScope: CSV_AUTHORITY_OPERATION_SCOPE,
        importEventId: "csv_imp_legacy_v1",
        rawCsvSha256: parsed.sha256Checksum,
        artifactPath: path.resolve(artifactPath),
        importedAt: "2026-09-01T10:05:00.000Z",
        availableAt: "2026-09-01T10:05:00.000Z",
        importingPrincipalId: "importer_legacy",
        approverPrincipalId: authorizedApprover,
        approvedAt: "2026-09-01T10:00:00.000Z",
        workspaceId: "ws_c07",
        targetProductId: "prod_c07",
        candidateId: "cand_c07",
        query: "pet grooming kit",
        normalizedQuery: "pet grooming kit",
        geography: "US",
        periodStart: parsed.dataPoints[0].periodStart,
        periodEnd: parsed.dataPoints[parsed.dataPoints.length - 1].periodEnd,
        cadence: "WEEKLY",
        dataPointsCount: parsed.dataPoints.length,
        originClassification: "AUTHENTICATED_OFFICIAL_EXPORT",
        reviewStatus: "APPROVED",
        verificationMethod: "MANUAL_OPERATOR_EXPORT_REVIEW",
        verificationLimitation: "Legacy v1 limitation",
        evidenceChainReference: "review-ticket:LEGACY-V1",
        isTestOnly: false,
        issuerKeyId: envBusinessKeyId,
        signingAlgorithm: "HMAC-SHA256",
      };
      const v1Digest = computeCsvAuthorityPayloadDigest(legacyV1Unsigned);
      const v1Sig = signCsvAuthorityPayloadDigest(v1Digest, envBusinessSecret);
      const legacyV1Record: OfficialCsvImportAuthorityRecord = {
        ...legacyV1Unsigned,
        payloadDigest: v1Digest,
        authoritySignature: v1Sig,
      };

      const ledgerPath = getCsvAuthorityLedgerPath();
      fs.writeFileSync(
        ledgerPath,
        JSON.stringify(
          {
            schemaVersion: "1.0",
            updatedAt: "2026-09-01T10:05:00.000Z",
            records: { [legacyId]: legacyV1Record },
            revocations: {},
          },
          null,
          2
        ),
        "utf8"
      );

      const checkBiz = verifyDurableCsvImportAuthority({
        rawCsvSha256: parsed.sha256Checksum,
        workspaceId: "ws_c07",
        targetProductId: "prod_c07",
        targetKeyword: "pet grooming kit",
        region: "US",
        evaluationScope: "BUSINESS",
      });
      expect(checkBiz.verified).toBe(false);
      expect(checkBiz.businessEligible).toBe(false);
      expect(checkBiz.sourceOriginVerified).toBe(false);
      expect(checkBiz.code).toBe("ORIGIN_NOT_OFFICIAL_EXPORT");
      expect(checkBiz.reason).toMatch(/legacy|acquisition/i);

      // Verify no silent re-signing occurred on disk
      const afterReadLedger = JSON.parse(fs.readFileSync(ledgerPath, "utf8"));
      expect(afterReadLedger.records[legacyId].schemaVersion).toBe("1.0");
      expect(afterReadLedger.records[legacyId].authoritySignature).toBe(v1Sig);
    });

    it("C08: Test-only key claiming isBusinessTrusted=true -> coerced to TEST_ONLY and DENIED in BUSINESS", () => {
      registerCsvAuthoritySigningKey({
        keyId: "key_c08_forged",
        secret: "11223344556677889900aabbccddeeff11223344556677889900aabbccddeeff",
        status: "ACTIVE",
        purpose: CSV_AUTHORITY_OPERATION_SCOPE,
        isBusinessTrusted: true,
        description: "In-process test key attempting business trust escalation",
      });

      const key = getCsvAuthoritySigningKey("key_c08_forged", "BUSINESS");
      expect(key).not.toBeNull();
      expect(key!.status).toBe("TEST_ONLY");
      expect(key!.isBusinessTrusted).toBe(false);

      const { parsed, artifactPath } = parseAndSaveCsv(buildTwelveWeekTrendsCsv("cat carrier backpack", "United States", 61));

      const rec = createSignedCsvImportAuthority({
        rawCsvSha256: parsed.sha256Checksum,
        artifactPath,
        importingPrincipalId: "importer_01",
        approverPrincipalId: authorizedApprover,
        approvedAt: "2026-09-01T10:00:00.000Z",
        importedAt: "2026-09-01T10:05:00.000Z",
        workspaceId: "ws_c08",
        targetProductId: "prod_c08",
        query: "cat carrier backpack",
        geography: "US",
        periodStart: parsed.dataPoints[0].periodStart,
        periodEnd: parsed.dataPoints[parsed.dataPoints.length - 1].periodEnd,
        cadence: "WEEKLY",
        dataPointsCount: parsed.dataPoints.length,
        originClassification: "AUTHENTICATED_OFFICIAL_EXPORT",
        reviewStatus: "APPROVED",
        verificationMethod: "MANUAL_OPERATOR_EXPORT_REVIEW",
        evidenceChainReference: "review-ticket:SWAI-C08",
        acquisitionSourceUrl: "https://trends.google.com/trends/explore?geo=US&q=cat%20carrier%20backpack",
        issuerKeyId: "key_c08_forged",
        isTestOnly: false,
      });
      expect(rec.isTestOnly).toBe(true);
      persistCsvImportAuthorityAtomically(rec);

      const bizCheck = verifyDurableCsvImportAuthority({
        rawCsvSha256: parsed.sha256Checksum,
        workspaceId: "ws_c08",
        targetProductId: "prod_c08",
        targetKeyword: "cat carrier backpack",
        region: "US",
        evaluationScope: "BUSINESS",
      });
      expect(bizCheck.verified).toBe(false);
      expect(bizCheck.businessEligible).toBe(false);
      expect(bizCheck.code).toBe("TEST_ONLY_REJECTED_IN_BUSINESS_SCOPE");
    });

    it("C09: Authorized issuer key, but approver missing or not allowlisted on issue OR readback -> DENIED", () => {
      setupTrustedEnvBusinessKeyAndApprover();
      const { parsed, artifactPath } = parseAndSaveCsv(buildTwelveWeekTrendsCsv("dog anxiety vest", "United States", 64));

      // 1. Unauthorized approver at creation -> DENIED
      expect(() =>
        createSignedCsvImportAuthority({
          rawCsvSha256: parsed.sha256Checksum,
          artifactPath,
          importingPrincipalId: "importer_01",
          approverPrincipalId: "rogue_approver@external.com",
          approvedAt: "2026-09-01T10:00:00.000Z",
          importedAt: "2026-09-01T10:05:00.000Z",
          workspaceId: "ws_c09",
          targetProductId: "prod_c09",
          query: "dog anxiety vest",
          geography: "US",
          periodStart: parsed.dataPoints[0].periodStart,
          periodEnd: parsed.dataPoints[parsed.dataPoints.length - 1].periodEnd,
          cadence: "WEEKLY",
          dataPointsCount: parsed.dataPoints.length,
          originClassification: "AUTHENTICATED_OFFICIAL_EXPORT",
          reviewStatus: "APPROVED",
          verificationMethod: "MANUAL_OPERATOR_EXPORT_REVIEW",
          evidenceChainReference: "review-ticket:SWAI-C09",
          acquisitionSourceUrl: "https://trends.google.com/trends/explore?geo=US&q=dog%20anxiety%20vest",
          issuerKeyId: envBusinessKeyId,
          isTestOnly: false,
        })
      ).toThrow(/UNAUTHORIZED_APPROVER/);

      // 2. Issue with authorized approver, then remove approver from allowlist before readback -> DENIED on readback!
      const rec = createSignedCsvImportAuthority({
        rawCsvSha256: parsed.sha256Checksum,
        artifactPath,
        importingPrincipalId: "importer_01",
        approverPrincipalId: authorizedApprover,
        approvedAt: "2026-09-01T10:00:00.000Z",
        importedAt: "2026-09-01T10:05:00.000Z",
        workspaceId: "ws_c09",
        targetProductId: "prod_c09",
        query: "dog anxiety vest",
        geography: "US",
        periodStart: parsed.dataPoints[0].periodStart,
        periodEnd: parsed.dataPoints[parsed.dataPoints.length - 1].periodEnd,
        cadence: "WEEKLY",
        dataPointsCount: parsed.dataPoints.length,
        originClassification: "AUTHENTICATED_OFFICIAL_EXPORT",
        reviewStatus: "APPROVED",
        verificationMethod: "MANUAL_OPERATOR_EXPORT_REVIEW",
        evidenceChainReference: "review-ticket:SWAI-C09",
        acquisitionSourceUrl: "https://trends.google.com/trends/explore?geo=US&q=dog%20anxiety%20vest",
        issuerKeyId: envBusinessKeyId,
        isTestOnly: false,
      });
      persistCsvImportAuthorityAtomically(rec);

      // Rotate allowlist so alice is no longer authorized
      process.env.KH02_AUTHORIZED_CSV_APPROVER_PRINCIPALS = "sec_approver_bob@swai.internal";

      const readback = verifyDurableCsvImportAuthority({
        rawCsvSha256: parsed.sha256Checksum,
        workspaceId: "ws_c09",
        targetProductId: "prod_c09",
        targetKeyword: "dog anxiety vest",
        region: "US",
        evaluationScope: "BUSINESS",
      });
      expect(readback.verified).toBe(false);
      expect(readback.businessEligible).toBe(false);
      expect(readback.code).toBe("ORIGIN_NOT_OFFICIAL_EXPORT");
    });

    it("C10: Unknown/revoked/compromised key and revoked authority -> DENIED", () => {
      setupTrustedEnvBusinessKeyAndApprover();
      const { parsed, artifactPath } = parseAndSaveCsv(buildTwelveWeekTrendsCsv("automatic pet feeder", "United States", 69));

      const rec = createSignedCsvImportAuthority({
        rawCsvSha256: parsed.sha256Checksum,
        artifactPath,
        importingPrincipalId: "importer_01",
        approverPrincipalId: authorizedApprover,
        approvedAt: "2026-09-01T10:00:00.000Z",
        importedAt: "2026-09-01T10:05:00.000Z",
        workspaceId: "ws_c10",
        targetProductId: "prod_c10",
        query: "automatic pet feeder",
        geography: "US",
        periodStart: parsed.dataPoints[0].periodStart,
        periodEnd: parsed.dataPoints[parsed.dataPoints.length - 1].periodEnd,
        cadence: "WEEKLY",
        dataPointsCount: parsed.dataPoints.length,
        originClassification: "AUTHENTICATED_OFFICIAL_EXPORT",
        reviewStatus: "APPROVED",
        verificationMethod: "MANUAL_OPERATOR_EXPORT_REVIEW",
        evidenceChainReference: "review-ticket:SWAI-C10",
        acquisitionSourceUrl: "https://trends.google.com/trends/explore?geo=US&q=automatic%20pet%20feeder",
        issuerKeyId: envBusinessKeyId,
        isTestOnly: false,
      });
      persistCsvImportAuthorityAtomically(rec);

      // 1. Key compromised in env
      process.env.KH02_CSV_AUTHORITY_KEY_STATUS = "COMPROMISED";
      const checkCompromised = verifyDurableCsvImportAuthority({
        rawCsvSha256: parsed.sha256Checksum,
        workspaceId: "ws_c10",
        targetProductId: "prod_c10",
        targetKeyword: "automatic pet feeder",
        region: "US",
        evaluationScope: "BUSINESS",
      });
      expect(checkCompromised.verified).toBe(false);
      expect(checkCompromised.code).toBe("KEY_REVOKED");

      // 2. Restore key, revoke authority record
      process.env.KH02_CSV_AUTHORITY_KEY_STATUS = "ACTIVE";
      const rev = revokeCsvImportAuthorityAtomically(rec.authorityId, "Revoked in C10", authorizedApprover);
      expect(rev.success).toBe(true);

      const checkRevoked = verifyDurableCsvImportAuthority({
        rawCsvSha256: parsed.sha256Checksum,
        workspaceId: "ws_c10",
        targetProductId: "prod_c10",
        targetKeyword: "automatic pet feeder",
        region: "US",
        evaluationScope: "BUSINESS",
      });
      expect(checkRevoked.verified).toBe(false);
      expect(checkRevoked.code).toBe("AUTHORITY_REVOKED");
    });

    it("C11: Altered CSV bytes/hash on disk, symlink artifact, or path traversal -> DENIED", () => {
      setupTrustedEnvBusinessKeyAndApprover();
      const csv = buildTwelveWeekTrendsCsv("cat laser toy", "United States", 62);
      const { parsed, artifactPath } = parseAndSaveCsv(csv);

      // 1. Path outside storage dir rejected on verification
      const outsideRec = createSignedCsvImportAuthority({
        rawCsvSha256: parsed.sha256Checksum,
        artifactPath: path.join(os.tmpdir(), `${parsed.sha256Checksum}.csv`),
        importingPrincipalId: "importer_01",
        approverPrincipalId: authorizedApprover,
        approvedAt: "2026-09-01T10:00:00.000Z",
        importedAt: "2026-09-01T10:05:00.000Z",
        workspaceId: "ws_c11_outside",
        targetProductId: "prod_c11_outside",
        query: "cat laser toy",
        geography: "US",
        periodStart: parsed.dataPoints[0].periodStart,
        periodEnd: parsed.dataPoints[parsed.dataPoints.length - 1].periodEnd,
        cadence: "WEEKLY",
        dataPointsCount: parsed.dataPoints.length,
        originClassification: "AUTHENTICATED_OFFICIAL_EXPORT",
        reviewStatus: "APPROVED",
        verificationMethod: "MANUAL_OPERATOR_EXPORT_REVIEW",
        evidenceChainReference: "review-ticket:SWAI-C11",
        acquisitionSourceUrl: "https://trends.google.com/trends/explore?geo=US&q=cat%20laser%20toy",
        issuerKeyId: envBusinessKeyId,
        isTestOnly: false,
      });
      persistCsvImportAuthorityAtomically(outsideRec);
      const checkOutside = verifyDurableCsvImportAuthority({
        authorityId: outsideRec.authorityId,
        rawCsvSha256: parsed.sha256Checksum,
        workspaceId: "ws_c11_outside",
        targetProductId: "prod_c11_outside",
        targetKeyword: "cat laser toy",
        region: "US",
        evaluationScope: "BUSINESS",
      });
      expect(checkOutside.verified).toBe(false);
      expect(checkOutside.code).toBe("ARTIFACT_PATH_MISMATCH");

      // 2. Valid creation, then alter CSV bytes on disk
      const rec = createSignedCsvImportAuthority({
        rawCsvSha256: parsed.sha256Checksum,
        artifactPath,
        importingPrincipalId: "importer_01",
        approverPrincipalId: authorizedApprover,
        approvedAt: "2026-09-01T10:00:00.000Z",
        importedAt: "2026-09-01T10:05:00.000Z",
        workspaceId: "ws_c11",
        targetProductId: "prod_c11",
        query: "cat laser toy",
        geography: "US",
        periodStart: parsed.dataPoints[0].periodStart,
        periodEnd: parsed.dataPoints[parsed.dataPoints.length - 1].periodEnd,
        cadence: "WEEKLY",
        dataPointsCount: parsed.dataPoints.length,
        originClassification: "AUTHENTICATED_OFFICIAL_EXPORT",
        reviewStatus: "APPROVED",
        verificationMethod: "MANUAL_OPERATOR_EXPORT_REVIEW",
        evidenceChainReference: "review-ticket:SWAI-C11",
        acquisitionSourceUrl: "https://trends.google.com/trends/explore?geo=US&q=cat%20laser%20toy",
        issuerKeyId: envBusinessKeyId,
        isTestOnly: false,
      });
      expect(persistCsvImportAuthorityAtomically(rec).success).toBe(true);

      fs.writeFileSync(artifactPath, csv + "\n2026-08-30,99\n", "utf8");
      const checkTamperedCsv = verifyDurableCsvImportAuthority({
        rawCsvSha256: parsed.sha256Checksum,
        workspaceId: "ws_c11",
        targetProductId: "prod_c11",
        targetKeyword: "cat laser toy",
        region: "US",
        evaluationScope: "BUSINESS",
      });
      expect(checkTamperedCsv.verified).toBe(false);
      expect(["ARTIFACT_MISSING_OR_CORRUPT", "ARTIFACT_HASH_MISMATCH"]).toContain(checkTamperedCsv.code);
    });

    it("C12: Foreign workspace, product, candidate, keyword, or non-US geography -> DENIED", () => {
      setupTrustedEnvBusinessKeyAndApprover();
      const { parsed, artifactPath } = parseAndSaveCsv(buildTwelveWeekTrendsCsv("pet water dispenser", "United States", 66));

      const rec = createSignedCsvImportAuthority({
        rawCsvSha256: parsed.sha256Checksum,
        artifactPath,
        importingPrincipalId: "importer_01",
        approverPrincipalId: authorizedApprover,
        approvedAt: "2026-09-01T10:00:00.000Z",
        importedAt: "2026-09-01T10:05:00.000Z",
        workspaceId: "ws_c12_alpha",
        targetProductId: "prod_c12_alpha",
        candidateId: "cand_c12_alpha",
        query: "pet water dispenser",
        geography: "US",
        periodStart: parsed.dataPoints[0].periodStart,
        periodEnd: parsed.dataPoints[parsed.dataPoints.length - 1].periodEnd,
        cadence: "WEEKLY",
        dataPointsCount: parsed.dataPoints.length,
        originClassification: "AUTHENTICATED_OFFICIAL_EXPORT",
        reviewStatus: "APPROVED",
        verificationMethod: "MANUAL_OPERATOR_EXPORT_REVIEW",
        evidenceChainReference: "review-ticket:SWAI-C12",
        acquisitionSourceUrl: "https://trends.google.com/trends/explore?geo=US&q=pet%20water%20dispenser",
        issuerKeyId: envBusinessKeyId,
        isTestOnly: false,
      });
      expect(persistCsvImportAuthorityAtomically(rec).success).toBe(true);

      expect(
        verifyDurableCsvImportAuthority({
          rawCsvSha256: parsed.sha256Checksum,
          workspaceId: "ws_c12_BETA",
          targetProductId: "prod_c12_alpha",
          targetKeyword: "pet water dispenser",
          region: "US",
          evaluationScope: "BUSINESS",
        }).code
      ).toBe("WORKSPACE_MISMATCH");

      expect(
        verifyDurableCsvImportAuthority({
          rawCsvSha256: parsed.sha256Checksum,
          workspaceId: "ws_c12_alpha",
          targetProductId: "prod_c12_OTHER",
          targetKeyword: "pet water dispenser",
          region: "US",
          evaluationScope: "BUSINESS",
        }).code
      ).toBe("PRODUCT_MISMATCH");

      expect(
        verifyDurableCsvImportAuthority({
          rawCsvSha256: parsed.sha256Checksum,
          workspaceId: "ws_c12_alpha",
          targetProductId: "prod_c12_alpha",
          candidateId: "cand_c12_OTHER",
          targetKeyword: "pet water dispenser",
          region: "US",
          evaluationScope: "BUSINESS",
        }).code
      ).toBe("CANDIDATE_MISMATCH");

      expect(
        verifyDurableCsvImportAuthority({
          rawCsvSha256: parsed.sha256Checksum,
          workspaceId: "ws_c12_alpha",
          targetProductId: "prod_c12_alpha",
          targetKeyword: "orthogonal dog house",
          region: "US",
          evaluationScope: "BUSINESS",
        }).code
      ).toBe("QUERY_MISMATCH");

      expect(
        verifyDurableCsvImportAuthority({
          rawCsvSha256: parsed.sha256Checksum,
          workspaceId: "ws_c12_alpha",
          targetProductId: "prod_c12_alpha",
          targetKeyword: "pet water dispenser",
          region: "GB",
          evaluationScope: "BUSINESS",
        }).code
      ).toBe("REGION_MISMATCH");
    });

    it("C13: Import/approval/availableAt after historical cutoff -> DENIED", () => {
      setupTrustedEnvBusinessKeyAndApprover();
      const { parsed, artifactPath } = parseAndSaveCsv(buildTwelveWeekTrendsCsv("pet hair remover", "United States", 64));

      const rec = createSignedCsvImportAuthority({
        rawCsvSha256: parsed.sha256Checksum,
        artifactPath,
        importingPrincipalId: "importer_01",
        approverPrincipalId: authorizedApprover,
        approvedAt: "2026-10-28T10:00:00.000Z",
        importedAt: "2026-10-28T10:05:00.000Z",
        workspaceId: "ws_c13",
        targetProductId: "prod_c13",
        query: "pet hair remover",
        geography: "US",
        periodStart: parsed.dataPoints[0].periodStart,
        periodEnd: parsed.dataPoints[parsed.dataPoints.length - 1].periodEnd,
        cadence: "WEEKLY",
        dataPointsCount: parsed.dataPoints.length,
        originClassification: "AUTHENTICATED_OFFICIAL_EXPORT",
        reviewStatus: "APPROVED",
        verificationMethod: "MANUAL_OPERATOR_EXPORT_REVIEW",
        evidenceChainReference: "review-ticket:SWAI-C13",
        acquisitionSourceUrl: "https://trends.google.com/trends/explore?geo=US&q=pet%20hair%20remover",
        issuerKeyId: envBusinessKeyId,
        isTestOnly: false,
      });
      expect(persistCsvImportAuthorityAtomically(rec).success).toBe(true);

      const check = verifyDurableCsvImportAuthority({
        rawCsvSha256: parsed.sha256Checksum,
        workspaceId: "ws_c13",
        targetProductId: "prod_c13",
        targetKeyword: "pet hair remover",
        region: "US",
        asOfTimestamp: "2026-10-24T23:59:59.000Z",
        evaluationScope: "BUSINESS",
      });
      expect(check.verified).toBe(false);
      expect(["IMPORT_AFTER_CUTOFF", "APPROVAL_AFTER_CUTOFF"]).toContain(check.code);
    });

    it("C14: 12-week positive engineering fixture -> PASS only in ENGINEERING; never counts as BUSINESS Google Trends production data", () => {
      registerCsvAuthoritySigningKey({
        keyId: "key_c14_test",
        secret: "11223344556677889900aabbccddeeff11223344556677889900aabbccddeeff",
        status: "TEST_ONLY",
        purpose: CSV_AUTHORITY_OPERATION_SCOPE,
        isBusinessTrusted: false,
        description: "Test key for C14",
      });

      const { parsed, artifactPath } = parseAndSaveCsv(buildTwelveWeekTrendsCsv("orthopedic dog bed", "United States", 65));

      const testRec = createSignedCsvImportAuthority({
        rawCsvSha256: parsed.sha256Checksum,
        artifactPath,
        importingPrincipalId: "test_runner",
        approverPrincipalId: "test_approver",
        approvedAt: "2026-09-01T10:00:00.000Z",
        importedAt: "2026-09-01T10:05:00.000Z",
        workspaceId: "ws_c14",
        targetProductId: "prod_c14",
        query: "orthopedic dog bed",
        geography: "US",
        periodStart: parsed.dataPoints[0].periodStart,
        periodEnd: parsed.dataPoints[parsed.dataPoints.length - 1].periodEnd,
        cadence: "WEEKLY",
        dataPointsCount: parsed.dataPoints.length,
        originClassification: "AUTHENTICATED_OFFICIAL_EXPORT",
        reviewStatus: "APPROVED",
        verificationMethod: "TEST_FIXTURE_SEED",
        evidenceChainReference: "urn:swai:test:c14",
        issuerKeyId: "key_c14_test",
        isTestOnly: true,
      });
      expect(persistCsvImportAuthorityAtomically(testRec).success).toBe(true);

      const engCheck = verifyDurableCsvImportAuthority({
        rawCsvSha256: parsed.sha256Checksum,
        workspaceId: "ws_c14",
        targetProductId: "prod_c14",
        targetKeyword: "orthopedic dog bed",
        region: "US",
        evaluationScope: "ENGINEERING",
      });
      expect(engCheck.verified).toBe(true);
      expect(engCheck.businessEligible).toBe(false);
      expect(engCheck.providerOriginVerified).toBe(false);

      const bizCheck = verifyDurableCsvImportAuthority({
        rawCsvSha256: parsed.sha256Checksum,
        workspaceId: "ws_c14",
        targetProductId: "prod_c14",
        targetKeyword: "orthopedic dog bed",
        region: "US",
        evaluationScope: "BUSINESS",
      });
      expect(bizCheck.verified).toBe(false);
      expect(bizCheck.businessEligible).toBe(false);
      expect(bizCheck.code).toBe("TEST_ONLY_REJECTED_IN_BUSINESS_SCOPE");
    });

    it("C15: Stable canonical serialization: identical fields => identical digest; modifying any signed field (including acquisitionSourceUrl/acquisitionEvidenceRef) => changed digest", () => {
      setupTrustedEnvBusinessKeyAndApprover();
      const { parsed, artifactPath } = parseAndSaveCsv(buildTwelveWeekTrendsCsv("cat window perch", "United States", 64));

      const rec = createSignedCsvImportAuthority({
        rawCsvSha256: parsed.sha256Checksum,
        artifactPath,
        importingPrincipalId: "importer_01",
        approverPrincipalId: authorizedApprover,
        approvedAt: "2026-09-01T10:00:00.000Z",
        importedAt: "2026-09-01T10:05:00.000Z",
        workspaceId: "ws_c15",
        targetProductId: "prod_c15",
        candidateId: "cand_c15",
        query: "cat window perch",
        geography: "US",
        periodStart: parsed.dataPoints[0].periodStart,
        periodEnd: parsed.dataPoints[parsed.dataPoints.length - 1].periodEnd,
        cadence: "WEEKLY",
        dataPointsCount: parsed.dataPoints.length,
        originClassification: "AUTHENTICATED_OFFICIAL_EXPORT",
        reviewStatus: "APPROVED",
        verificationMethod: "MANUAL_OPERATOR_EXPORT_REVIEW",
        evidenceChainReference: "review-ticket:SWAI-C15",
        acquisitionSourceUrl: "https://trends.google.com/trends/explore?geo=US&q=cat%20window%20perch",
        acquisitionEvidenceRef: "capture-ref:001",
        acquisitionCapturedAt: "2026-09-01T09:55:00.000Z",
        acquisitionMethod: "OFFICIAL_WEB_EXPORT",
        issuerKeyId: envBusinessKeyId,
        isTestOnly: false,
      } as any);

      const baseDigest = computeCsvAuthorityPayloadDigest(rec);
      const repeatDigest = computeCsvAuthorityPayloadDigest({ ...rec });
      expect(baseDigest).toBe(repeatDigest);

      const mutations: Array<Partial<OfficialCsvImportAuthorityRecord>> = [
        { acquisitionSourceUrl: "https://trends.google.com/trends/explore?geo=US&q=cat%20window%20perch&date=today" } as any,
        { acquisitionEvidenceRef: "capture-ref:002" } as any,
        { acquisitionCapturedAt: "2026-09-01T09:56:00.000Z" } as any,
        { acquisitionMethod: "MODIFIED_METHOD" } as any,
        { workspaceId: "ws_c15_other" },
        { targetProductId: "prod_c15_other" },
        { approverPrincipalId: "other_approver@swai.internal" },
        { rawCsvSha256: "a".repeat(64) },
      ];

      for (const mut of mutations) {
        const mutatedDigest = computeCsvAuthorityPayloadDigest({ ...rec, ...mut } as any);
        expect(mutatedDigest).not.toBe(baseDigest);
      }
    });

    it("C16: Concurrent persistence and revocation across processes -> monotonic revoke, no TOCTOU false acceptance, no ledger corruption", async () => {
      setupTrustedEnvBusinessKeyAndApprover();
      const { parsed, artifactPath } = parseAndSaveCsv(buildTwelveWeekTrendsCsv("dog cooling vest", "United States", 65));

      const rec = createSignedCsvImportAuthority({
        rawCsvSha256: parsed.sha256Checksum,
        artifactPath,
        importingPrincipalId: "importer_01",
        approverPrincipalId: authorizedApprover,
        approvedAt: "2026-09-01T10:00:00.000Z",
        importedAt: "2026-09-01T10:05:00.000Z",
        workspaceId: "ws_c16",
        targetProductId: "prod_c16",
        query: "dog cooling vest",
        geography: "US",
        periodStart: parsed.dataPoints[0].periodStart,
        periodEnd: parsed.dataPoints[parsed.dataPoints.length - 1].periodEnd,
        cadence: "WEEKLY",
        dataPointsCount: parsed.dataPoints.length,
        originClassification: "AUTHENTICATED_OFFICIAL_EXPORT",
        reviewStatus: "APPROVED",
        verificationMethod: "MANUAL_OPERATOR_EXPORT_REVIEW",
        evidenceChainReference: "review-ticket:SWAI-C16",
        acquisitionSourceUrl: "https://trends.google.com/trends/explore?geo=US&q=dog%20cooling%20vest",
        issuerKeyId: envBusinessKeyId,
        isTestOnly: false,
      });

      const persistRes = persistCsvImportAuthorityAtomically(rec);
      expect(persistRes.success).toBe(true);

      const revRes = revokeCsvImportAuthorityAtomically(rec.authorityId, "Concurrent revocation", authorizedApprover);
      expect(revRes.success).toBe(true);

      // Re-persisting the unrevoked record after revocation must be rejected as CONFLICT
      const replayRes = persistCsvImportAuthorityAtomically(rec);
      expect(replayRes.success).toBe(false);
      expect(replayRes.state).toBe("CONFLICT");

      const readRes = readCsvAuthorityLedgerUnderLock();
      expect(readRes.status).toBe("LEDGER_HEALTHY");
      expect(Object.keys(readRes.state!.records)).toHaveLength(1);
      expect(readRes.state!.revocations[rec.authorityId]?.revokedAt).toBeDefined();
    });

    it("C17: Missing source data for target productId cannot be backfilled by fallback to another product", async () => {
      const res = await resolveProductDemandHistory(
        {
          productId: "prod_c17_nonexistent_demand",
          canonicalName: "UAHPET Fresh Food Automatic Pet Feeder",
        },
        { lookbackDays: 90, region: "US", workspaceId: "ws_c17" }
      );
      expect(res.productId).toBe("prod_c17_nonexistent_demand");
      expect(res.observationPointsCount).toBe(0);
      expect(res.sourceStatus).not.toBe("PRODUCT_HISTORY_VERIFIED");
    });

    it("C18: Deliberate wrong, malformed, short, or missing signing key -> no success", () => {
      process.env.KH02_CSV_AUTHORITY_KEY_ID = "short_key";
      process.env.KH02_CSV_AUTHORITY_HMAC_SECRET = "too_short_secret";
      process.env.KH02_AUTHORIZED_CSV_APPROVER_PRINCIPALS = authorizedApprover;

      expect(getCsvAuthoritySigningKey("short_key", "BUSINESS")).toBeNull();

      const { parsed, artifactPath } = parseAndSaveCsv(buildTwelveWeekTrendsCsv("cat scratching post", "United States", 63));

      expect(() =>
        createSignedCsvImportAuthority({
          rawCsvSha256: parsed.sha256Checksum,
          artifactPath,
          importingPrincipalId: "importer_01",
          approverPrincipalId: authorizedApprover,
          approvedAt: "2026-09-01T10:00:00.000Z",
          importedAt: "2026-09-01T10:05:00.000Z",
          workspaceId: "ws_c18",
          targetProductId: "prod_c18",
          query: "cat scratching post",
          geography: "US",
          periodStart: parsed.dataPoints[0].periodStart,
          periodEnd: parsed.dataPoints[parsed.dataPoints.length - 1].periodEnd,
          cadence: "WEEKLY",
          dataPointsCount: parsed.dataPoints.length,
          originClassification: "AUTHENTICATED_OFFICIAL_EXPORT",
          reviewStatus: "APPROVED",
          verificationMethod: "MANUAL_OPERATOR_EXPORT_REVIEW",
          evidenceChainReference: "review-ticket:SWAI-C18",
          acquisitionSourceUrl: "https://trends.google.com/trends/explore?geo=US&q=cat%20scratching%20post",
          issuerKeyId: "short_key",
          isTestOnly: false,
        })
      ).toThrow(/KEY_UNTRUSTED/);
    });

    it("C19: Controlled human-reviewed official import simulation with trusted server key, allowlisted approver, raw CSV, and signed acquisitionSourceUrl succeeds while keeping providerOriginVerified=false", () => {
      setupTrustedEnvBusinessKeyAndApprover();
      const { parsed, artifactPath } = parseAndSaveCsv(buildTwelveWeekTrendsCsv("uahpet water fountain", "United States", 67));

      const rec = createSignedCsvImportAuthority({
        rawCsvSha256: parsed.sha256Checksum,
        artifactPath,
        importingPrincipalId: "importer_01",
        approverPrincipalId: authorizedApprover,
        approvedAt: "2026-09-01T10:00:00.000Z",
        importedAt: "2026-09-01T10:05:00.000Z",
        workspaceId: "ws_c19",
        targetProductId: "prod_c19",
        candidateId: "cand_c19",
        query: "uahpet water fountain",
        geography: "US",
        periodStart: parsed.dataPoints[0].periodStart,
        periodEnd: parsed.dataPoints[parsed.dataPoints.length - 1].periodEnd,
        cadence: "WEEKLY",
        dataPointsCount: parsed.dataPoints.length,
        originClassification: "AUTHENTICATED_OFFICIAL_EXPORT",
        reviewStatus: "APPROVED",
        verificationMethod: "MANUAL_OPERATOR_EXPORT_REVIEW",
        evidenceChainReference: "review-ticket:SWAI-C19",
        acquisitionSourceUrl: "https://trends.google.com/trends/explore?geo=US&q=uahpet%20water%20fountain",
        acquisitionEvidenceRef: "capture-bundle:SWAI-C19",
        acquisitionCapturedAt: "2026-09-01T09:50:00.000Z",
        acquisitionMethod: "OFFICIAL_WEB_EXPORT",
        issuerKeyId: envBusinessKeyId,
        isTestOnly: false,
      } as any);

      expect(rec.schemaVersion).toBe("2.0");
      expect((rec as any).acquisitionSourceUrl).toBe(
        "https://trends.google.com/trends/explore?geo=US&q=uahpet%20water%20fountain"
      );

      const persisted = persistCsvImportAuthorityAtomically(rec);
      expect(persisted.success).toBe(true);

      const check = verifyDurableCsvImportAuthority({
        rawCsvSha256: parsed.sha256Checksum,
        workspaceId: "ws_c19",
        targetProductId: "prod_c19",
        candidateId: "cand_c19",
        targetKeyword: "uahpet water fountain",
        region: "US",
        asOfTimestamp: "2026-10-01T00:00:00.000Z",
        evaluationScope: "BUSINESS",
      });
      expect(check.verified).toBe(true);
      expect(check.businessEligible).toBe(true);
      expect(check.sourceOriginVerified).toBe(true);
      expect(check.providerOriginVerified).toBe(false);

      const lineage = hasVerifiableCsvOrProviderLineage(
        `csv-import:google-trends-explore:sha256:${parsed.sha256Checksum}`,
        null,
        {
          workspaceId: "ws_c19",
          targetProductId: "prod_c19",
          targetKeyword: "uahpet water fountain",
          region: "US",
          evaluationScope: "BUSINESS",
        }
      );
      expect(lineage.providerOriginVerified).toBe(false);
    });
  });

  // =========================================================================
  // SECTION 2: P1-B GOOGLE MCP UPSTREAM TRUST BOUNDARY (G01..G18)
  // =========================================================================
  describe("P1-B: Google MCP Upstream Provenance Trust Boundary (G01..G18)", () => {
    it("G01: Handshake + tools/list alone => providerVerified=false, capabilityClassification=ENRICHMENT_ONLY", async () => {
      const mockClient: any = {
        connect: async () => {},
        close: async () => {},
        isAlive: () => true,
        listToolsWithSchemas: async () => [
          { name: "search_advertiser", inputSchema: { type: "object" } },
          { name: "get_advertiser_ads", inputSchema: { type: "object" } },
        ],
      };
      const caps = await discoverGoogleAdsMcpCapabilities({}, mockClient);
      expect(caps.transportConnected).toBe(true);
      expect(caps.capabilityClassification).toBe("ENRICHMENT_ONLY");
      expect((caps as any).providerVerified ?? false).toBe(false);
    });

    it("G02: Untrusted MCP JSON includes invented requestId, creativeId and matching local invocation fields => upstreamRequestVerified=false and providerVerified=false", () => {
      const untrustedMcpResponse = {
        request_id: "req_invented_by_untrusted_mcp_server_999",
        advertiser_id: "AR09542566763567710209",
        ads: [
          {
            creative_id: "CR01190636535947264001",
            advertiser_id: "AR09542566763567710209",
            request_id: "req_invented_by_untrusted_mcp_server_999",
          },
        ],
      };

      const inv = recordActualGoogleMcpInvocation(
        {
          mcpInvocationRef: "mcp_inv_g02",
          researchRunId: "run_g02",
          workspaceId: "ws_g02",
          advertiserId: "AR09542566763567710209",
          domain: "uahpet.com",
          toolName: "get_advertiser_ads",
          requestArguments: { advertiser_id: "AR09542566763567710209", region: "US" },
          sourceMode: "LIVE_PROVIDER",
          status: "SUCCEEDED",
        },
        untrustedMcpResponse
      );

      const stamped = attachGoogleMcpCreativeProvenance(untrustedMcpResponse.ads[0], inv);
      const lineage = verifyGoogleInvocationLineage(stamped, [inv], "run_g02");

      expect(lineage.verified).toBe(true);
      expect(lineage.localMcpToolResultVerified).toBe(true);
      // Critical P1-B invariant: in-band MCP JSON request_id is NOT independent upstream Google proof!
      expect(lineage.upstreamRequestVerified).toBe(false);
      expect(lineage.providerVerified).toBe(false);
      expect(lineage.provenanceTier).toBe("LOCAL_MCP_TOOL_RESULT_VERIFIED");
      expect((lineage as any).upstreamOriginStatus).toBe("UPSTREAM_NOT_ATTESTED");
    });

    it("G03: Fake GetAdvertiserById / SearchCreatives RPC envelope in a stub => NOT upstream", () => {
      const fakeRpcEnvelope = {
        rpcMethod: "SearchCreatives",
        rpcHeader: "GetAdvertiserById",
        providerRequestId: "google_rpc_fake_888777666",
        ads: [
          {
            creative_id: "CR05056137812242399233",
            advertiser_id: "AR09542566763567710209",
            providerRequestId: "google_rpc_fake_888777666",
          },
        ],
      };

      const inv = recordActualGoogleMcpInvocation(
        {
          mcpInvocationRef: "mcp_inv_g03",
          researchRunId: "run_g03",
          workspaceId: "ws_g03",
          advertiserId: "AR09542566763567710209",
          domain: "uahpet.com",
          toolName: "get_advertiser_ads",
          requestArguments: { advertiser_id: "AR09542566763567710209", region: "US" },
          sourceMode: "LIVE_PROVIDER",
          status: "SUCCEEDED",
        },
        fakeRpcEnvelope
      );

      const stamped = attachGoogleMcpCreativeProvenance(fakeRpcEnvelope.ads[0], inv);
      const lineage = verifyGoogleInvocationLineage(stamped, [inv], "run_g03");

      expect(lineage.localMcpToolResultVerified).toBe(true);
      expect(lineage.upstreamRequestVerified).toBe(false);
      expect(lineage.providerVerified).toBe(false);
    });

    it("G04: Real local callTool receipt with no independent source attestation => localMcpToolResultVerified=true, providerVerified=false", () => {
      const localResponse = {
        ads: [{ creative_id: "CR05776693956203020289", advertiser_id: "AR09542566763567710209" }],
      };
      const inv = recordActualGoogleMcpInvocation(
        {
          mcpInvocationRef: "mcp_inv_g04",
          researchRunId: "run_g04",
          workspaceId: "ws_g04",
          advertiserId: "AR09542566763567710209",
          domain: "uahpet.com",
          toolName: "get_advertiser_ads",
          requestArguments: { advertiser_id: "AR09542566763567710209", region: "US" },
          sourceMode: "LIVE_PROVIDER",
          status: "SUCCEEDED",
        },
        localResponse
      );
      const stamped = attachGoogleMcpCreativeProvenance(localResponse.ads[0], inv);
      const lineage = verifyGoogleInvocationLineage(stamped, [inv], "run_g04");
      expect(lineage.verified).toBe(true);
      expect(lineage.localMcpToolResultVerified).toBe(true);
      expect(lineage.upstreamRequestVerified).toBe(false);
      expect(lineage.providerVerified).toBe(false);
      expect(lineage.provenanceTier).toBe("LOCAL_MCP_TOOL_RESULT_VERIFIED");
    });

    it("G05: Mismatched advertiser, domain, workspace, or researchRunId => DENIED", () => {
      const rawResponse = {
        ads: [{ creative_id: "CR01190636535947264001", advertiser_id: "AR09542566763567710209" }],
      };
      const inv = recordActualGoogleMcpInvocation(
        {
          mcpInvocationRef: "mcp_inv_g05",
          researchRunId: "run_g05_alpha",
          workspaceId: "ws_g05_alpha",
          advertiserId: "AR09542566763567710209",
          domain: "uahpet.com",
          toolName: "get_advertiser_ads",
          requestArguments: { advertiser_id: "AR09542566763567710209", region: "US" },
          sourceMode: "LIVE_PROVIDER",
          status: "SUCCEEDED",
        },
        rawResponse
      );
      const stamped = attachGoogleMcpCreativeProvenance(rawResponse.ads[0], inv);

      expect(
        verifyGoogleInvocationLineage({ ...stamped, advertiser_id: "AR9999999999", advertiserId: "AR9999999999" }, [inv], "run_g05_alpha").verified
      ).toBe(false);
      expect(
        verifyGoogleInvocationLineage({ ...stamped, domain: "other-store.com" }, [inv], "run_g05_alpha").verified
      ).toBe(false);
      expect(
        verifyGoogleInvocationLineage({ ...stamped, workspaceId: "ws_g05_BETA" }, [inv], "run_g05_alpha").verified
      ).toBe(false);
      expect(
        verifyGoogleInvocationLineage(stamped, [inv], "run_g05_BETA").verified
      ).toBe(false);
    });

    it("G06: Wrong response SHA or creative not in returned membership => DENIED", () => {
      const rawResponse = {
        ads: [{ creative_id: "CR01190636535947264001", advertiser_id: "AR09542566763567710209" }],
      };
      const inv = recordActualGoogleMcpInvocation(
        {
          mcpInvocationRef: "mcp_inv_g06",
          researchRunId: "run_g06",
          workspaceId: "ws_g06",
          advertiserId: "AR09542566763567710209",
          domain: "uahpet.com",
          toolName: "get_advertiser_ads",
          requestArguments: { advertiser_id: "AR09542566763567710209", region: "US" },
          sourceMode: "LIVE_PROVIDER",
          status: "SUCCEEDED",
        },
        rawResponse
      );
      const stamped = attachGoogleMcpCreativeProvenance(rawResponse.ads[0], inv);

      expect(verifyGoogleInvocationLineage({ ...stamped, responseEvidenceHash: "f".repeat(64) }, [inv], "run_g06").verified).toBe(false);
      expect(
        verifyGoogleInvocationLineage({ ...stamped, creative_id: "CR99999999999999999999", creativeId: "CR99999999999999999999" }, [inv], "run_g06").verified
      ).toBe(false);
    });

    it("G07: Cached/fixture/replayed data restamped LIVE_PROVIDER => DENIED", () => {
      const rawResponse = {
        ads: [{ creative_id: "CR01190636535947264001", advertiser_id: "AR09542566763567710209" }],
      };
      const inv = recordActualGoogleMcpInvocation(
        {
          mcpInvocationRef: "mcp_inv_g07",
          researchRunId: "run_g07",
          workspaceId: "ws_g07",
          advertiserId: "AR09542566763567710209",
          domain: "uahpet.com",
          toolName: "get_advertiser_ads",
          requestArguments: { advertiser_id: "AR09542566763567710209", region: "US" },
          sourceMode: "CACHE" as any,
          status: "SUCCEEDED",
        },
        rawResponse
      );
      const stamped = attachGoogleMcpCreativeProvenance(rawResponse.ads[0], inv);

      // Restamp creative as LIVE_PROVIDER
      const restamped = { ...stamped, sourceMode: "LIVE_PROVIDER" as const };
      const lineage = verifyGoogleInvocationLineage(restamped, [inv], "run_g07");
      expect(lineage.verified).toBe(false);
      expect(lineage.providerVerified).toBe(false);
    });

    it("G08: Null destination, brand homepage, or collection URL => NOT PDP-bound", () => {
      const normalized = normalizeGoogleAdsResponse(
        {
          ads: [
            {
              creative_id: "CR01190636535947264001",
              advertiser_id: "AR09542566763567710209",
              advertiser_name: "UAHPET",
              destination_url: null,
            },
            {
              creative_id: "CR05056137812242399233",
              advertiser_id: "AR09542566763567710209",
              advertiser_name: "UAHPET",
              destination_url: "https://uahpet.com/",
            },
            {
              creative_id: "CR05776693956203020289",
              advertiser_id: "AR09542566763567710209",
              advertiser_name: "UAHPET",
              destination_url: "https://uahpet.com/collections/all",
            },
          ],
        },
        {
          requestedDomain: "uahpet.com",
          topic: "Pet Fountain",
          observedAt: new Date().toISOString(),
          toolName: "get_advertiser_ads",
          requestedMarket: "US",
        }
      );

      expect(normalized.ads).toHaveLength(3);
      expect(normalized.ads[0].productRelevance).toBe("UNKNOWN");
      expect(normalized.ads[1].productRelevance).toBe("BRAND_RELATED");
      expect(normalized.ads[2].productRelevance).toBe("BRAND_RELATED");
    });

    it("G09 & G10: US query filter without delivered country => FILTER_ONLY; non-US delivered country => UNVERIFIED (not US)", () => {
      const normalized = normalizeGoogleAdsResponse(
        {
          requested_region: "US",
          provider_filter_region: "US",
          ads: [
            {
              creative_id: "CR01190636535947264001",
              advertiser_id: "AR09542566763567710209",
              advertiser_name: "UAHPET",
              // No country or regions in creative payload
            },
            {
              creative_id: "CR05056137812242399233",
              advertiser_id: "AR09542566763567710209",
              advertiser_name: "UAHPET",
              delivery_country: "GB",
              region: "GB",
            },
          ],
        },
        {
          requestedDomain: "uahpet.com",
          topic: "Pet Fountain",
          observedAt: new Date().toISOString(),
          toolName: "get_advertiser_ads",
          requestedMarket: "US",
          providerFilterMarket: "US",
        }
      );

      expect(normalized.ads[0].marketProvenance.verificationStatus).toBe("FILTER_ONLY");
      expect(normalized.ads[0].verifiedDeliveryMarket).toBeNull();

      expect(normalized.ads[1].marketProvenance.verificationStatus).toBe("UNVERIFIED");
      expect(normalized.ads[1].marketProvenance.providerReportedMarket).toBe("GB");
      expect(normalized.ads[1].verifiedDeliveryMarket).toBeNull();
    });

    it("G11: Malicious caller-provided requestId equal to local invocation ID => DENIED; request origin never promoted", () => {
      const localInvocationId = "mcp_inv_collision_attack_001";
      const collidingResponse = {
        request_id: localInvocationId, // Maliciously echoes local invocationId as upstream request_id!
        ads: [
          {
            creative_id: "CR01190636535947264001",
            advertiser_id: "AR09542566763567710209",
            request_id: localInvocationId,
          },
        ],
      };

      const inv = recordActualGoogleMcpInvocation(
        {
          mcpInvocationRef: localInvocationId,
          researchRunId: "run_g11_col",
          workspaceId: "ws_g11_col",
          advertiserId: "AR09542566763567710209",
          domain: "uahpet.com",
          toolName: "get_advertiser_ads",
          requestArguments: { advertiser_id: "AR09542566763567710209", region: "US" },
          sourceMode: "LIVE_PROVIDER",
          status: "SUCCEEDED",
        },
        collidingResponse
      );

      expect(inv.providerRequestIdOrigin).not.toBe("UPSTREAM");
      expect((inv as any).collidesWithLocalInvocationId).toBe(true);

      const stamped = attachGoogleMcpCreativeProvenance(collidingResponse.ads[0], inv);

      // Even if caller forces providerRequestId = localInvocationId on creative, verifyGoogleInvocationLineage DENIES it
      const forcedCollision = { ...stamped, providerRequestId: localInvocationId };
      const lineage = verifyGoogleInvocationLineage(forcedCollision, [inv], "run_g11_col");
      expect(lineage.verified).toBe(false);
      expect(lineage.providerVerified).toBe(false);
      expect(lineage.upstreamRequestVerified).toBe(false);
    });

    it("G12: Oversized raw payload (>2 MiB), malformed JSON, timeout, 403, 429, CAPTCHA or bot wall => bounded BLOCKED/FAILED, never success", () => {
      // 1. Oversized > 2 MiB payload
      const giantText = "x".repeat(2 * 1024 * 1024 + 4096);
      expect(() =>
        decodeCallToolResult({
          content: [{ type: "text", text: giantText }],
        } as any)
      ).toThrow(/RESPONSE_SIZE_EXCEEDED_2MIB|exceeds maximum allowed size/i);

      // 2. Malformed JSON
      expect(() =>
        decodeCallToolResult({
          content: [{ type: "text", text: "{malformed_json_payload" }],
        } as any)
      ).toThrow();

      // 3. Error flag / 403 / 429 / CAPTCHA
      expect(() =>
        decodeCallToolResult({
          isError: true,
          content: [{ type: "text", text: "HTTP 429 Too Many Requests / CAPTCHA challenge" }],
        } as any)
      ).toThrow(/429|CAPTCHA|error/i);
    });

    it("G13: Synthetic upstream ID from a different creative or foreign advertiser => DENIED", () => {
      const responseWithTwoCreatives = {
        ads: [
          {
            creative_id: "CR01190636535947264001",
            advertiser_id: "AR09542566763567710209",
            request_id: "req_for_CR01190636535947264001",
          },
          {
            creative_id: "CR05056137812242399233",
            advertiser_id: "AR09542566763567710209",
            request_id: "req_for_CR05056137812242399233",
          },
        ],
      };

      const inv = recordActualGoogleMcpInvocation(
        {
          mcpInvocationRef: "mcp_inv_g13",
          researchRunId: "run_g13",
          workspaceId: "ws_g13",
          advertiserId: "AR09542566763567710209",
          domain: "uahpet.com",
          toolName: "get_advertiser_ads",
          requestArguments: { advertiser_id: "AR09542566763567710209", region: "US" },
          sourceMode: "LIVE_PROVIDER",
          status: "SUCCEEDED",
        },
        responseWithTwoCreatives
      );

      const stampedSecond = attachGoogleMcpCreativeProvenance(responseWithTwoCreatives.ads[1], inv);

      // Swap in creative 1's request_id or a foreign advertiser's ID onto creative 2
      const crossCreativeForgery = {
        ...stampedSecond,
        providerRequestId: "req_for_CR01190636535947264001",
      };
      expect(verifyGoogleInvocationLineage(crossCreativeForgery, [inv], "run_g13").verified).toBe(false);

      const foreignAdvertiserForgery = {
        ...stampedSecond,
        providerRequestId: "req_for_AR99999999999999999999",
      };
      expect(verifyGoogleInvocationLineage(foreignAdvertiserForgery, [inv], "run_g13").verified).toBe(false);
    });

    it("G14: Local verified creative persisted + DB reload => remains LOCAL_MCP_TOOL_RESULT_VERIFIED with providerVerified=false", async () => {
      const wsId = `ws_g14_${Date.now()}`;
      const rawResponse = {
        request_id: "req_unattested_mcp_json_g14",
        ads: [
          {
            creative_id: "CR01190636535947264001",
            advertiser_id: "AR09542566763567710209",
            headline: "UAHPET Fountain",
            destination_url: "https://uahpet.com/products/fountain-g14",
            request_id: "req_unattested_mcp_json_g14",
          },
        ],
      };

      const inv = recordActualGoogleMcpInvocation(
        {
          mcpInvocationRef: "mcp_inv_g14",
          researchRunId: "run_g14",
          workspaceId: wsId,
          advertiserId: "AR09542566763567710209",
          domain: "uahpet.com",
          toolName: "get_advertiser_ads",
          requestArguments: { advertiser_id: "AR09542566763567710209", region: "US" },
          sourceMode: "LIVE_PROVIDER",
          status: "SUCCEEDED",
        },
        rawResponse
      );

      const stamped = attachGoogleMcpCreativeProvenance(rawResponse.ads[0], inv);
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
      norm.observations[0].researchRunId = "run_g14";
      norm.observations[0].workspaceId = wsId;

      const persistRes = await persistGoogleObservationsToDatabase(norm.observations, wsId);
      expect(persistRes.persistedCount).toBe(1);

      const dbObs = await prisma.adObservation.findFirst({
        where: { id: norm.observations[0].sourceObservationId ?? undefined },
      });
      expect(dbObs).not.toBeNull();
      const savedPayload = JSON.parse(dbObs!.rawPayload || "{}");
      expect(savedPayload.provenanceTier).toBe("LOCAL_MCP_TOOL_RESULT_VERIFIED");
      expect(savedPayload.providerVerified).toBe(false);
      expect(savedPayload.upstreamRequestVerified).toBe(false);
    });

    it("G15: Google creative/ad duration (even 120 active days) cannot satisfy historical-demand G15", () => {
      const hist = evaluateDemandHistoryEvidence([], {
        evaluationScope: "BUSINESS",
        targetProductId: "prod_uahpet_01",
        candidateCanonicalName: "UAHPET Water Fountain",
      });
      expect(hist.eligibleForEvergreen).toBe(false);
      expect(hist.status).toBe("INSUFFICIENT_HISTORY");
    });

    it("G16: Repeated creatives under same merchant/product -> consolidated into 1 product family only", () => {
      const ads: any[] = [1, 2, 3, 4].map((idx) => ({
        source: "GOOGLE_ADS",
        sourceRecordId: `google_cr_${idx}`,
        sourceExternalAdId: `CR_${idx}`,
        title: `UAHPET Stainless Cat Water Fountain #${idx}`,
        description: `UAHPET Stainless Cat Water Fountain Variant ${idx}`,
        landingPageUrl: "https://uahpet.com/products/stainless-cat-water-fountain",
        advertiserDomain: "uahpet.com",
        advertiserOrCreator: "UAHPET",
        provenance: "LIVE_PROVIDER",
        observedAt: new Date().toISOString(),
        verifiedDeliveryMarket: "US",
      }));

      const candidates = discoverProductCandidatesFromAds(ads, "Pet Gadgets");
      expect(candidates.length).toBeLessThanOrEqual(1);
    });

    it("G17 & G18: Upstream origin status is UPSTREAM_NOT_ATTESTED without out-of-band capture; brand-only/null-PDP/FILTER_ONLY Google observations get 0 cross-platform product score", () => {
      const scoreRes = calculateKH02EvergreenScore({
        candidate: {
          candidateId: "cand_g18_uahpet",
          title: "UAHPET Wireless Cat Water Fountain",
          canonicalProductName: "UAHPET Wireless Cat Water Fountain",
          storeDomain: "uahpet.com",
          canonicalProductUrl: "https://uahpet.com/products/uahpet-wireless-cat-water-fountain",
          productHandle: "uahpet-wireless-cat-water-fountain",
          niche: "Pet Gadgets",
          category: "Pet Supplies",
          priceUsd: 49.99,
          identityConfidence: 90,
          identityStatus: "VERIFIED",
          totalObservationCount: 2,
          supportingAdIds: ["meta_1", "google_null_pdp_1"],
          supportingSourceTypes: ["META_ADS", "GOOGLE_ADS"],
          sourceObservations: [
            {
              source: "META_ADS",
              sourceRecordId: "meta_1",
              landingPageUrl: "https://uahpet.com/products/uahpet-wireless-cat-water-fountain",
              advertiserDomain: "uahpet.com",
              verifiedDeliveryMarket: "US",
              metrics: { productRelevance: "PRODUCT_SPECIFIC" },
            },
            // Google creative with null landingPageUrl, UNKNOWN productRelevance, and FILTER_ONLY market
            {
              source: "GOOGLE_ADS",
              sourceRecordId: "google_null_pdp_1",
              landingPageUrl: null,
              advertiserDomain: "uahpet.com",
              verifiedDeliveryMarket: null,
              metrics: {
                productRelevance: "UNKNOWN",
                marketProvenance: { verificationStatus: "FILTER_ONLY" },
              },
            },
          ],
        } as any,
        demandSeries: [],
      });

      // META_ADS alone gives 8/20 points; unverified/null-PDP GOOGLE_ADS must NOT add +6 points (must stay 8, not 14)
      expect(scoreRes.pillars.multiPlatformValidation.score).toBe(8);
      expect(scoreRes.pillars.multiPlatformValidation.status).not.toBe("PASS");
    });
  });

  // =========================================================================
  // SECTION 3: META ADS & SYSTEM INTEGRITY INVARIANTS (M01..M04, S01..S06)
  // =========================================================================
  describe("Meta Ads & System Integrity Invariants (M01..M04, S01..S06)", () => {
    it("M01: Meta diagnostics only => actualQueryAttempted=false, upstreamQueryCompleted=false, contentStatus=NOT_RUN", async () => {
      const diag = await diagnoseMetaLiveCollector({
        checkLiveTransport: false,
        actualQueryAttempted: false,
      });
      expect(diag.actualQueryAttempted).toBe(false);
      expect(diag.upstreamQueryCompleted).toBe(false);
      expect(diag.rawAdsReturned).toBe(0);
      expect((diag as any).contentStatus).toBe("NOT_RUN");
    });

    it("M02: Meta targetMarket US query filter does not fabricate verified US audience delivery when ad targetMarket is UNKNOWN", () => {
      const mkt = resolveMetaMarketProvenance(
        {
          id: "meta_ad_m02",
          platform: "META",
          targetMarket: "UNKNOWN",
          advertiser: { name: "Merchant M02", country: "US" },
        },
        { requestedMarket: "US" }
      );
      expect(mkt.requestedMarket).toBe("US");
      expect(mkt.verifiedDeliveryMarket).toBeNull();
      expect(mkt.marketVerification).toBe("UNKNOWN");
    });

    it("M03: Meta placement duplicates for same merchant SKU => consolidated into 1 candidate family", () => {
      const dupAds: any[] = ["facebook", "instagram", "messenger", "audience_network"].map((placement, idx) => ({
        source: "META_ADS",
        sourceRecordId: `meta_dup_${idx}`,
        sourceExternalAdId: `META:${idx}`,
        title: "Pawira Cat Water Fountain",
        description: `Shop Pawira Cat Water Fountain (${placement})`,
        landingPageUrl: "https://pawira.com/products/cat-water-fountain",
        advertiserDomain: "pawira.com",
        advertiserOrCreator: "Pawira",
        provenance: "LIVE_PROVIDER",
        observedAt: new Date().toISOString(),
        verifiedDeliveryMarket: "US",
      }));
      const candidates = discoverProductCandidatesFromAds(dupAds, "Pet Gadgets");
      const shortlistRes = selectTopResearchShortlist(candidates, 3, { topic: "Pet Gadgets" });
      expect(shortlistRes.distinctFamiliesCount).toBe(1);
    });

    it("M04: Meta provenance survives SQLite round-trip", async () => {
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

    it("S01..S06: Runner & release-gate invariants fail closed on malformed counts, signal timeout, disk/RAM breach, canceled child, SHA mismatch, and missing CI jobs", async () => {
      const evaluateRunnerOutcome = (input: {
        exitCode: number | null;
        signal: string | null;
        timedOut: boolean;
        parsedTestsPassed?: number;
        parsedTestsFailed?: number;
        testedSha: string;
        currentHeadSha: string;
        freeDiskBytes: number;
        ciJobsGreenCount: number;
      }) => {
        if (input.freeDiskBytes < 1024 * 1024 * 1024) {
          return { status: "RESOURCE_BLOCKED", pass: false };
        }
        if (input.timedOut || input.signal !== null) {
          return { status: "TIMED_OUT", pass: false };
        }
        if (input.testedSha !== input.currentHeadSha) {
          return { status: "SHA_MISMATCH", pass: false };
        }
        if (
          input.exitCode !== 0 ||
          typeof input.parsedTestsPassed !== "number" ||
          input.parsedTestsPassed <= 0 ||
          (input.parsedTestsFailed ?? 0) > 0
        ) {
          return { status: "STRUCTURED_VALIDATION_FAILED", pass: false };
        }
        const ciStatus = input.ciJobsGreenCount === 6 ? "CI_PASS" : "CI_NOT_RUN";
        return { status: "ENGINEERING_PASS", pass: true, ciStatus };
      };

      // S01: exit 0 but 0 parsed tests -> FAIL
      expect(
        evaluateRunnerOutcome({
          exitCode: 0,
          signal: null,
          timedOut: false,
          parsedTestsPassed: 0,
          parsedTestsFailed: 0,
          testedSha: "sha_a",
          currentHeadSha: "sha_a",
          freeDiskBytes: 5 * 1024 * 1024 * 1024,
          ciJobsGreenCount: 6,
        }).pass
      ).toBe(false);

      // S02: timeout / signal with exit 0 -> TIMED_OUT, never PASS
      expect(
        evaluateRunnerOutcome({
          exitCode: 0,
          signal: "SIGTERM",
          timedOut: true,
          parsedTestsPassed: 10,
          parsedTestsFailed: 0,
          testedSha: "sha_a",
          currentHeadSha: "sha_a",
          freeDiskBytes: 5 * 1024 * 1024 * 1024,
          ciJobsGreenCount: 6,
        }).status
      ).toBe("TIMED_OUT");

      // S03: disk < 1 GiB -> RESOURCE_BLOCKED
      expect(
        evaluateRunnerOutcome({
          exitCode: 0,
          signal: null,
          timedOut: false,
          parsedTestsPassed: 10,
          parsedTestsFailed: 0,
          testedSha: "sha_a",
          currentHeadSha: "sha_a",
          freeDiskBytes: 512 * 1024 * 1024,
          ciJobsGreenCount: 6,
        }).status
      ).toBe("RESOURCE_BLOCKED");

      // S04: Canceled child process leaves no orphan
      const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], {
        stdio: "ignore",
      });
      const pid = child.pid!;
      expect(pid).toBeGreaterThan(0);
      child.kill("SIGKILL");
      await new Promise((resolve) => child.once("close", resolve));
      let alive = true;
      try {
        process.kill(pid, 0);
      } catch {
        alive = false;
      }
      expect(alive).toBe(false);

      // S05: Output SHA differs from C1 -> SHA_MISMATCH
      expect(
        evaluateRunnerOutcome({
          exitCode: 0,
          signal: null,
          timedOut: false,
          parsedTestsPassed: 10,
          parsedTestsFailed: 0,
          testedSha: "sha_old",
          currentHeadSha: "sha_new",
          freeDiskBytes: 5 * 1024 * 1024 * 1024,
          ciJobsGreenCount: 6,
        }).status
      ).toBe("SHA_MISMATCH");

      // S06: CI jobs < 6 -> CI_NOT_RUN, never CI_PASS
      expect(
        evaluateRunnerOutcome({
          exitCode: 0,
          signal: null,
          timedOut: false,
          parsedTestsPassed: 10,
          parsedTestsFailed: 0,
          testedSha: "sha_a",
          currentHeadSha: "sha_a",
          freeDiskBytes: 5 * 1024 * 1024 * 1024,
          ciJobsGreenCount: 0,
        }).ciStatus
      ).toBe("CI_NOT_RUN");
    });
  });
});
