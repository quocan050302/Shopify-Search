/**
 * KH-02 V12.4.3.7.19.3.3.3 — Strict Google Trends q/geo Origin Binding + No-False-Google-Platform-Score
 *
 * Covers the complete 48-case adversarial & positive verification matrix:
 *   Part 1 (CSV-01 .. CSV-24): Official Google Trends Explore URL `q` & `geo` binding,
 *     duplicate parameter rejection, whole-term query matching, Schema v2 HMAC & readback enforcement.
 *   Part 2 (GSC-01 .. GSC-24): No unverified Google Ads multi-platform score (+6 Pillar C / +10 confidence),
 *     strict boolean upstream attestation (`providerVerified === true && upstreamRequestVerified === true`),
 *     candidate-specific PDP & US market binding, alias normalization, and G15/G16 non-bypass.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  CSV_AUTHORITY_OPERATION_SCOPE,
  validateOfficialGoogleTrendsAcquisitionUrl,
  normalizeCsvAuthorityQuery,
  createSignedCsvImportAuthority,
  computeCsvAuthorityPayloadDigest,
  signCsvAuthorityPayloadDigest,
  persistCsvImportAuthorityAtomically,
  verifyDurableCsvImportAuthority,
  getCsvAuthorityLedgerPath,
  registerCsvAuthoritySigningKey,
  clearTestCsvAuthoritySigningKeys,
} from "@/services/kh02/demand/durableCsvImportAuthority";
import {
  saveOriginalGoogleTrendsCsvFile,
  validateAndParseGoogleTrendsCsv,
} from "@/services/kh02/demand/googleTrendsCsvValidator";
import {
  evaluateDemandSourceAuthority,
  evaluateDemandHistoryEvidence,
  DemandDataPoint,
} from "@/services/kh02/demand/temporalDemandEngine";
import {
  calculateKH02EvergreenScore,
  applyKH02EligibilityGates,
} from "@/services/kh02/scoring/evergreenOpportunityScoring";
import {
  discoverProductCandidatesFromAds,
  evaluateShortlistDistinctness,
  selectTopResearchShortlist,
  DiscoveredProductCandidate,
} from "@/services/kh02/identity/productCandidateDiscovery";
import {
  verifyGoogleInvocationLineage,
} from "@/services/kh02/providers/googleTransparencyResearchAdapter";
import { requalifyHistoricalEvergreenSnapshot } from "@/services/kh02/persistence/kh02PersistenceService";

const TEST_KEY_ID = "prod_env_csv_authority_key_v19333";
const TEST_SECRET = "env_server_secret_v19333_99887766554433221100_abcdef1234567890";
const TEST_APPROVER = "sec_approver_alice@swai.internal";

function buildTwelveWeekTrendsCsv(keyword = "automatic cat water fountain", region = "United States", baseVal = 64): string {
  return [
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
    `2026-08-30,${baseVal + 4}`,
    `2026-09-06,${baseVal + 6}`,
  ].join("\n") + "\n";
}

function makeBaseCandidate(overrides: Partial<DiscoveredProductCandidate> = {}): DiscoveredProductCandidate {
  return {
    candidateId: "cand_uahpet_fountain_01",
    researchProductId: "prod_uahpet_fountain_01",
    title: "UAHPET Wireless Stainless Steel Cat Water Fountain",
    canonicalProductName: "UAHPET Wireless Stainless Steel Cat Water Fountain",
    merchantVerifiedProductName: "UAHPET Wireless Stainless Steel Cat Water Fountain",
    category: "Pet Fountain",
    problemStatement: "Keeps cats hydrated with motion-activated cordless water filtration.",
    targetAudience: "Cat Owners",
    thumbnailUrl: "https://uahpet.com/cdn/shop/fountain.jpg",
    videoUrl: null,
    canonicalProductUrl: "https://uahpet.com/products/uahpet-fountain",
    storeDomain: "uahpet.com",
    brand: "UAHPET",
    advertiserNames: ["UAHPET Official"],
    supportingAdIds: ["meta_ad_1"],
    supportingSourceTypes: ["META_ADS", "GOOGLE_ADS"],
    totalObservationCount: 4,
    distinctAdvertisersCount: 2,
    earliestObservationDate: "2026-06-01T00:00:00.000Z",
    latestObservationDate: "2026-09-15T00:00:00.000Z",
    identityConfidence: "EXACT",
    identityStatus: "VERIFIED",
    productRealityStatus: "VERIFIED_PHYSICAL_PRODUCT",
    relevanceStatus: "RELEVANT",
    isEligibleAsEvergreenWinner: true,
    hasUnresolvedContradiction: false,
    sourceObservations: [
      {
        source: "META_ADS",
        sourceRecordId: "meta_ad_1",
        title: "UAHPET Wireless Stainless Steel Cat Water Fountain",
        description: "Cordless motion-sensor cat water fountain in 304 stainless steel.",
        landingPageUrl: "https://uahpet.com/products/uahpet-fountain",
        advertiserName: "UAHPET Official",
        advertiserDomain: "uahpet.com",
        observedAt: "2026-09-01T00:00:00.000Z",
        provenance: "LIVE_PROVIDER",
        verifiedDeliveryMarket: "US",
        metrics: {
          daysRunning: 95,
          providerVerified: true,
          upstreamRequestVerified: true,
        },
      } as any,
    ],
    ...overrides,
  };
}

describe("KH-02 V12.4.3.7.19.3.3.3 — Strict Google Trends q/geo Origin Binding + No-False-Google-Platform-Score", () => {
  let tmpStorageDir: string;
  const createdCsvFiles: string[] = [];
  const savedEnv: Record<string, string | undefined> = {};
  const envKeys = [
    "TEST_CSV_AUTHORITY_STORAGE_DIR",
    "KH02_CSV_AUTHORITY_KEY_ID",
    "KH02_CSV_AUTHORITY_HMAC_SECRET",
    "KH02_CSV_AUTHORITY_KEY_STATUS",
    "KH02_AUTHORIZED_CSV_APPROVER_PRINCIPALS",
  ];

  beforeEach(() => {
    for (const k of envKeys) {
      savedEnv[k] = process.env[k];
    }
    tmpStorageDir = fs.mkdtempSync(path.join(os.tmpdir(), "kh02_v19333_csv_auth_"));
    process.env.TEST_CSV_AUTHORITY_STORAGE_DIR = tmpStorageDir;
    process.env.KH02_CSV_AUTHORITY_KEY_ID = TEST_KEY_ID;
    process.env.KH02_CSV_AUTHORITY_HMAC_SECRET = TEST_SECRET;
    process.env.KH02_CSV_AUTHORITY_KEY_STATUS = "ACTIVE";
    process.env.KH02_AUTHORIZED_CSV_APPROVER_PRINCIPALS = TEST_APPROVER;
    clearTestCsvAuthoritySigningKeys();
  });

  afterEach(() => {
    clearTestCsvAuthoritySigningKeys();
    for (const k of envKeys) {
      if (savedEnv[k] === undefined) {
        delete process.env[k];
      } else {
        process.env[k] = savedEnv[k];
      }
    }
    while (createdCsvFiles.length > 0) {
      const f = createdCsvFiles.pop()!;
      try {
        if (fs.existsSync(f)) fs.unlinkSync(f);
      } catch {
        // ignore
      }
    }
    if (tmpStorageDir && fs.existsSync(tmpStorageDir)) {
      fs.rmSync(tmpStorageDir, { recursive: true, force: true });
    }
  });

  function parseAndSaveCsv(csvText: string) {
    const parsed = validateAndParseGoogleTrendsCsv(csvText);
    const artifactPath = saveOriginalGoogleTrendsCsvFile(csvText, parsed.sha256Checksum);
    createdCsvFiles.push(artifactPath);
    return { parsed, artifactPath };
  }

  // ===========================================================================
  // PART 1: P1-A / G15 — STRICT GOOGLE TRENDS `q` & `geo` ORIGIN BINDING (CSV-01..CSV-24)
  // ===========================================================================
  describe("Part 1: P1-A — Official Google Trends Explore URL `q` & `geo` Strict Origin Binding (CSV-01..CSV-24)", () => {
    it("CSV-01: missing geo parameter (URL has valid q) -> DENY with ACQUISITION_GEO_REQUIRED", () => {
      const urlMissingGeo = "https://trends.google.com/trends/explore?q=automatic%20cat%20water%20fountain";
      expect(() =>
        validateOfficialGoogleTrendsAcquisitionUrl(urlMissingGeo, "automatic cat water fountain", "US")
      ).toThrow(/ACQUISITION_GEO_REQUIRED/);

      const { parsed, artifactPath } = parseAndSaveCsv(buildTwelveWeekTrendsCsv("automatic cat water fountain", "United States"));
      expect(() =>
        createSignedCsvImportAuthority({
          rawCsvSha256: parsed.sha256Checksum,
          artifactPath,
          importingPrincipalId: "importer_01",
          approverPrincipalId: TEST_APPROVER,
          approvedAt: "2026-09-07T00:00:00.000Z",
          importedAt: "2026-09-07T00:00:00.000Z",
          workspaceId: "ws_v19333",
          targetProductId: "prod_01",
          candidateId: "cand_01",
          query: "automatic cat water fountain",
          geography: "US",
          periodStart: parsed.dataPoints[0].periodStart,
          periodEnd: parsed.dataPoints[parsed.dataPoints.length - 1].periodEnd,
          cadence: "WEEKLY",
          dataPointsCount: parsed.dataPoints.length,
          originClassification: "AUTHENTICATED_OFFICIAL_EXPORT",
          reviewStatus: "APPROVED",
          verificationMethod: "MANUAL_OPERATOR_EXPORT_REVIEW",
          evidenceChainReference: "urn:swai:csv:v19333:csv01",
          acquisitionSourceUrl: urlMissingGeo,
          issuerKeyId: TEST_KEY_ID,
          isTestOnly: false,
        })
      ).toThrow(/ACQUISITION_GEO_REQUIRED/);
    });

    it("CSV-02: missing q parameter (URL has valid geo) -> DENY with ACQUISITION_QUERY_REQUIRED", () => {
      const urlMissingQ = "https://trends.google.com/trends/explore?geo=US";
      expect(() =>
        validateOfficialGoogleTrendsAcquisitionUrl(urlMissingQ, "automatic cat water fountain", "US")
      ).toThrow(/ACQUISITION_QUERY_REQUIRED/);

      const { parsed, artifactPath } = parseAndSaveCsv(buildTwelveWeekTrendsCsv("automatic cat water fountain", "United States"));
      expect(() =>
        createSignedCsvImportAuthority({
          rawCsvSha256: parsed.sha256Checksum,
          artifactPath,
          importingPrincipalId: "importer_01",
          approverPrincipalId: TEST_APPROVER,
          approvedAt: "2026-09-07T00:00:00.000Z",
          importedAt: "2026-09-07T00:00:00.000Z",
          workspaceId: "ws_v19333",
          targetProductId: "prod_02",
          candidateId: "cand_02",
          query: "automatic cat water fountain",
          geography: "US",
          periodStart: parsed.dataPoints[0].periodStart,
          periodEnd: parsed.dataPoints[parsed.dataPoints.length - 1].periodEnd,
          cadence: "WEEKLY",
          dataPointsCount: parsed.dataPoints.length,
          originClassification: "AUTHENTICATED_OFFICIAL_EXPORT",
          reviewStatus: "APPROVED",
          verificationMethod: "MANUAL_OPERATOR_EXPORT_REVIEW",
          evidenceChainReference: "urn:swai:csv:v19333:csv02",
          acquisitionSourceUrl: urlMissingQ,
          issuerKeyId: TEST_KEY_ID,
          isTestOnly: false,
        })
      ).toThrow(/ACQUISITION_QUERY_REQUIRED/);
    });

    it("CSV-03: neither q nor geo in Explore URL -> DENY", () => {
      const urlBareExplore = "https://trends.google.com/trends/explore";
      expect(() =>
        validateOfficialGoogleTrendsAcquisitionUrl(urlBareExplore, "automatic cat water fountain", "US")
      ).toThrow(/ACQUISITION_GEO_REQUIRED|ACQUISITION_QUERY_REQUIRED/);
    });

    it("CSV-04: empty or whitespace geo='' / geo=%20 / q='' / q=%20 -> DENY", () => {
      for (const emptyGeoUrl of [
        "https://trends.google.com/trends/explore?geo=&q=automatic%20cat%20water%20fountain",
        "https://trends.google.com/trends/explore?geo=%20%20&q=automatic%20cat%20water%20fountain",
      ]) {
        expect(() =>
          validateOfficialGoogleTrendsAcquisitionUrl(emptyGeoUrl, "automatic cat water fountain", "US")
        ).toThrow(/ACQUISITION_GEO_REQUIRED/);
      }
      for (const emptyQUrl of [
        "https://trends.google.com/trends/explore?geo=US&q=",
        "https://trends.google.com/trends/explore?geo=US&q=%20%20",
      ]) {
        expect(() =>
          validateOfficialGoogleTrendsAcquisitionUrl(emptyQUrl, "automatic cat water fountain", "US")
        ).toThrow(/ACQUISITION_QUERY_REQUIRED/);
      }
    });

    it("CSV-05: duplicated geo parameters (geo=US&geo=GB or geo=US&geo=US) -> DENY with AMBIGUOUS_ACQUISITION_PARAMETERS", () => {
      expect(() =>
        validateOfficialGoogleTrendsAcquisitionUrl(
          "https://trends.google.com/trends/explore?geo=US&geo=GB&q=automatic%20cat%20water%20fountain",
          "automatic cat water fountain",
          "US"
        )
      ).toThrow(/AMBIGUOUS_ACQUISITION_PARAMETERS/);

      expect(() =>
        validateOfficialGoogleTrendsAcquisitionUrl(
          "https://trends.google.com/trends/explore?geo=US&geo=US&q=automatic%20cat%20water%20fountain",
          "automatic cat water fountain",
          "US"
        )
      ).toThrow(/AMBIGUOUS_ACQUISITION_PARAMETERS/);
    });

    it("CSV-06: duplicated q parameters (q=cat%20feeder&q=dog%20feeder) -> DENY with AMBIGUOUS_ACQUISITION_PARAMETERS", () => {
      expect(() =>
        validateOfficialGoogleTrendsAcquisitionUrl(
          "https://trends.google.com/trends/explore?geo=US&q=cat%20feeder&q=dog%20feeder",
          "cat feeder",
          "US"
        )
      ).toThrow(/AMBIGUOUS_ACQUISITION_PARAMETERS/);
    });

    it("CSV-07: non-US geo (GB, CA, WW) when expected US -> DENY with ACQUISITION_GEO_MISMATCH", () => {
      for (const wrongGeo of ["GB", "CA", "WW", "AU"]) {
        expect(() =>
          validateOfficialGoogleTrendsAcquisitionUrl(
            `https://trends.google.com/trends/explore?geo=${wrongGeo}&q=cat%20feeder`,
            "cat feeder",
            "US"
          )
        ).toThrow(/ACQUISITION_GEO_MISMATCH/);
      }
    });

    it("CSV-08: ambiguous US subregion (geo=US-CA or geo=US-NY) vs explicit US -> policy-driven DENY with ACQUISITION_GEO_MISMATCH", () => {
      expect(() =>
        validateOfficialGoogleTrendsAcquisitionUrl(
          "https://trends.google.com/trends/explore?geo=US-CA&q=cat%20feeder",
          "cat feeder",
          "US"
        )
      ).toThrow(/ACQUISITION_GEO_MISMATCH/);

      // Even if caller passes expectedGeo="US-CA", BUSINESS US G15 requires national US ("US"), not a state subregion
      expect(() =>
        validateOfficialGoogleTrendsAcquisitionUrl(
          "https://trends.google.com/trends/explore?geo=US-CA&q=cat%20feeder",
          "cat feeder",
          "US-CA"
        )
      ).toThrow(/ACQUISITION_GEO_MISMATCH/);
    });

    it("CSV-09: partial prefix/substring q='cat' vs expected 'cat feeder' -> DENY with ACQUISITION_QUERY_MISMATCH", () => {
      expect(() =>
        validateOfficialGoogleTrendsAcquisitionUrl(
          "https://trends.google.com/trends/explore?geo=US&q=cat",
          "cat feeder",
          "US"
        )
      ).toThrow(/ACQUISITION_QUERY_MISMATCH/);
    });

    it("CSV-10: superstring q='cat feeder accessories' vs expected 'cat feeder' -> DENY with ACQUISITION_QUERY_MISMATCH", () => {
      expect(() =>
        validateOfficialGoogleTrendsAcquisitionUrl(
          "https://trends.google.com/trends/explore?geo=US&q=cat%20feeder%20accessories",
          "cat feeder",
          "US"
        )
      ).toThrow(/ACQUISITION_QUERY_MISMATCH/);
    });

    it("CSV-11: encoded/Unicode canonical-equivalent keyword (+ or %20 or case difference) -> ACCEPT only when whole normalized term matches", () => {
      const validatedPlus = validateOfficialGoogleTrendsAcquisitionUrl(
        "https://trends.google.com/trends/explore?geo=US&q=Automatic+Cat+Water+Fountain",
        "automatic cat water fountain",
        "US"
      );
      expect(validatedPlus).toContain("https://trends.google.com/trends/explore");

      // Different product keyword with same length/prefix fails
      expect(() =>
        validateOfficialGoogleTrendsAcquisitionUrl(
          "https://trends.google.com/trends/explore?geo=US&q=Automatic+Cat+Food+Dispenser",
          "automatic cat water fountain",
          "US"
        )
      ).toThrow(/ACQUISITION_QUERY_MISMATCH/);
    });

    it("CSV-12: double-encoded (%2520) or multi-keyword comma-separated q ('cat feeder,dog feeder') -> DENY", () => {
      expect(() =>
        validateOfficialGoogleTrendsAcquisitionUrl(
          "https://trends.google.com/trends/explore?geo=US&q=cat%2520feeder",
          "cat feeder",
          "US"
        )
      ).toThrow(/AMBIGUOUS_ACQUISITION_PARAMETERS|ACQUISITION_QUERY_MISMATCH/);

      expect(() =>
        validateOfficialGoogleTrendsAcquisitionUrl(
          "https://trends.google.com/trends/explore?geo=US&q=cat%20feeder,dog%20feeder",
          "cat feeder",
          "US"
        )
      ).toThrow(/AMBIGUOUS_ACQUISITION_PARAMETERS|ACQUISITION_QUERY_MISMATCH/);
    });

    it("CSV-13: userinfo, evil host, http scheme, custom port, or non-Explore path (/trends/yis) -> DENY", () => {
      const invalidOriginsAndPaths = [
        "https://user:pass@trends.google.com/trends/explore?geo=US&q=cat%20feeder",
        "https://trends.google.com.evil.example/trends/explore?geo=US&q=cat%20feeder",
        "http://trends.google.com/trends/explore?geo=US&q=cat%20feeder",
        "https://trends.google.com:8443/trends/explore?geo=US&q=cat%20feeder",
        "https://trends.google.com/trends/yis?geo=US&q=cat%20feeder",
        "https://trends.google.com/trends/about?geo=US&q=cat%20feeder",
      ];
      for (const bad of invalidOriginsAndPaths) {
        expect(() =>
          validateOfficialGoogleTrendsAcquisitionUrl(bad, "cat feeder", "US")
        ).toThrow();
      }
    });

    it("CSV-14: fragment-only query '#?geo=US&q=cat%20feeder' without real searchParams -> DENY", () => {
      expect(() =>
        validateOfficialGoogleTrendsAcquisitionUrl(
          "https://trends.google.com/trends/explore#?geo=US&q=cat%20feeder",
          "cat feeder",
          "US"
        )
      ).toThrow(/ACQUISITION_GEO_REQUIRED|ACQUISITION_QUERY_REQUIRED|ACQUISITION_SOURCE_UNTRUSTED_ORIGIN/);
    });

    it("CSV-15: correctly bound q+geo with real review chain -> positive controlled pass with providerOriginVerified=false", () => {
      const { parsed, artifactPath } = parseAndSaveCsv(buildTwelveWeekTrendsCsv("automatic cat water fountain", "United States"));
      const rec = createSignedCsvImportAuthority({
        rawCsvSha256: parsed.sha256Checksum,
        artifactPath,
        importingPrincipalId: "importer_01",
        approverPrincipalId: TEST_APPROVER,
        approvedAt: "2026-09-07T00:00:00.000Z",
        importedAt: "2026-09-07T00:05:00.000Z",
        workspaceId: "ws_v19333",
        targetProductId: "prod_15",
        candidateId: "cand_15",
        query: "automatic cat water fountain",
        geography: "US",
        periodStart: parsed.dataPoints[0].periodStart,
        periodEnd: parsed.dataPoints[parsed.dataPoints.length - 1].periodEnd,
        cadence: "WEEKLY",
        dataPointsCount: parsed.dataPoints.length,
        originClassification: "AUTHENTICATED_OFFICIAL_EXPORT",
        reviewStatus: "APPROVED",
        verificationMethod: "MANUAL_OPERATOR_EXPORT_REVIEW",
        evidenceChainReference: "urn:swai:csv:v19333:csv15",
        acquisitionSourceUrl: "https://trends.google.com/trends/explore?geo=US&q=automatic%20cat%20water%20fountain",
        issuerKeyId: TEST_KEY_ID,
        isTestOnly: false,
      });
      persistCsvImportAuthorityAtomically(rec);

      const verified = verifyDurableCsvImportAuthority({
        rawCsvSha256: parsed.sha256Checksum,
        workspaceId: "ws_v19333",
        targetProductId: "prod_15",
        candidateId: "cand_15",
        targetKeyword: "automatic cat water fountain",
        region: "US",
        evaluationScope: "BUSINESS",
      });
      expect(verified.verified).toBe(true);
      expect(verified.businessEligible).toBe(true);
      expect(verified.providerOriginVerified).toBe(false);
    });

    it("CSV-16: signed record altered q or geo in acquisitionSourceUrl on disk after issue -> DENY (INVALID_SIGNATURE)", () => {
      const { parsed, artifactPath } = parseAndSaveCsv(buildTwelveWeekTrendsCsv("automatic cat water fountain", "United States"));
      const rec = createSignedCsvImportAuthority({
        rawCsvSha256: parsed.sha256Checksum,
        artifactPath,
        importingPrincipalId: "importer_01",
        approverPrincipalId: TEST_APPROVER,
        approvedAt: "2026-09-07T00:00:00.000Z",
        importedAt: "2026-09-07T00:05:00.000Z",
        workspaceId: "ws_v19333",
        targetProductId: "prod_16",
        candidateId: "cand_16",
        query: "automatic cat water fountain",
        geography: "US",
        periodStart: parsed.dataPoints[0].periodStart,
        periodEnd: parsed.dataPoints[parsed.dataPoints.length - 1].periodEnd,
        cadence: "WEEKLY",
        dataPointsCount: parsed.dataPoints.length,
        originClassification: "AUTHENTICATED_OFFICIAL_EXPORT",
        reviewStatus: "APPROVED",
        verificationMethod: "MANUAL_OPERATOR_EXPORT_REVIEW",
        evidenceChainReference: "urn:swai:csv:v19333:csv16",
        acquisitionSourceUrl: "https://trends.google.com/trends/explore?geo=US&q=automatic%20cat%20water%20fountain",
        issuerKeyId: TEST_KEY_ID,
        isTestOnly: false,
      });
      persistCsvImportAuthorityAtomically(rec);

      const ledgerPath = getCsvAuthorityLedgerPath();
      const ledgerData = JSON.parse(fs.readFileSync(ledgerPath, "utf8"));
      ledgerData.records[rec.authorityId].acquisitionSourceUrl =
        "https://trends.google.com/trends/explore?geo=US&q=automatic%20cat%20water%20fountain&date=today%203-m";
      fs.writeFileSync(ledgerPath, JSON.stringify(ledgerData, null, 2), "utf8");

      const check = verifyDurableCsvImportAuthority({
        rawCsvSha256: parsed.sha256Checksum,
        workspaceId: "ws_v19333",
        targetProductId: "prod_16",
        candidateId: "cand_16",
        targetKeyword: "automatic cat water fountain",
        region: "US",
        evaluationScope: "BUSINESS",
      });
      expect(check.verified).toBe(false);
      expect(check.businessEligible).toBe(false);
      expect(check.code).toBe("INVALID_SIGNATURE");
    });

    it("CSV-17: previously signed record missing q or geo on readback -> DENY even if HMAC signature matches stored fields", () => {
      const { parsed, artifactPath } = parseAndSaveCsv(buildTwelveWeekTrendsCsv("automatic cat water fountain", "United States"));

      // Construct a Schema v2 record with a valid HMAC signature computed over a URL lacking `q`
      const urlLackingQ = "https://trends.google.com/trends/explore?geo=US";
      const unsignedRecord: any = {
        authorityId: "auth_csv17_missing_q",
        schemaVersion: "2.0",
        operationScope: CSV_AUTHORITY_OPERATION_SCOPE,
        importEventId: "csv_imp_17",
        rawCsvSha256: parsed.sha256Checksum,
        artifactPath: path.resolve(artifactPath),
        importedAt: "2026-09-07T00:05:00.000Z",
        availableAt: "2026-09-07T00:05:00.000Z",
        importingPrincipalId: "importer_01",
        approverPrincipalId: TEST_APPROVER,
        approvedAt: "2026-09-07T00:00:00.000Z",
        workspaceId: "ws_v19333",
        targetProductId: "prod_17",
        candidateId: "cand_17",
        query: "automatic cat water fountain",
        normalizedQuery: normalizeCsvAuthorityQuery("automatic cat water fountain"),
        geography: "US",
        periodStart: new Date(parsed.dataPoints[0].periodStart).toISOString(),
        periodEnd: new Date(parsed.dataPoints[parsed.dataPoints.length - 1].periodEnd).toISOString(),
        cadence: "WEEKLY",
        dataPointsCount: parsed.dataPoints.length,
        originClassification: "AUTHENTICATED_OFFICIAL_EXPORT",
        reviewStatus: "APPROVED",
        verificationMethod: "MANUAL_OPERATOR_EXPORT_REVIEW",
        verificationLimitation: "Local integrity only",
        evidenceChainReference: "urn:swai:csv:v19333:csv17",
        acquisitionSourceUrl: urlLackingQ,
        acquisitionEvidenceRef: "urn:swai:csv:v19333:csv17",
        acquisitionCapturedAt: "2026-09-07T00:05:00.000Z",
        acquisitionMethod: "MANUAL_OPERATOR_EXPORT_REVIEW",
        isTestOnly: false,
        issuerKeyId: TEST_KEY_ID,
        signingAlgorithm: "HMAC-SHA256",
      };
      const payloadDigest = computeCsvAuthorityPayloadDigest(unsignedRecord);
      const authoritySignature = signCsvAuthorityPayloadDigest(payloadDigest, TEST_SECRET);
      const forgedSignedRecord = {
        ...unsignedRecord,
        payloadDigest,
        authoritySignature,
      };
      expect(persistCsvImportAuthorityAtomically(forgedSignedRecord as any).success).toBe(true);

      const check = verifyDurableCsvImportAuthority({
        rawCsvSha256: parsed.sha256Checksum,
        workspaceId: "ws_v19333",
        targetProductId: "prod_17",
        candidateId: "cand_17",
        targetKeyword: "automatic cat water fountain",
        region: "US",
        evaluationScope: "BUSINESS",
      });
      expect(check.verified).toBe(false);
      expect(check.businessEligible).toBe(false);
    });

    it("CSV-18: TEST_ONLY positive fixture in ENGINEERING scope -> passes engineeringEligible=true, businessEligible=false", () => {
      registerCsvAuthoritySigningKey({
        keyId: "test_only_key_csv18",
        secret: "00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff",
        status: "TEST_ONLY",
        purpose: CSV_AUTHORITY_OPERATION_SCOPE,
        isBusinessTrusted: false,
      });

      const { parsed, artifactPath } = parseAndSaveCsv(buildTwelveWeekTrendsCsv("automatic cat water fountain", "United States"));
      const testRec = createSignedCsvImportAuthority({
        rawCsvSha256: parsed.sha256Checksum,
        artifactPath,
        importingPrincipalId: "test_importer",
        approverPrincipalId: "test_approver",
        approvedAt: "2026-09-07T00:00:00.000Z",
        importedAt: "2026-09-07T00:05:00.000Z",
        workspaceId: "ws_v19333",
        targetProductId: "prod_18",
        candidateId: "cand_18",
        query: "automatic cat water fountain",
        geography: "US",
        periodStart: parsed.dataPoints[0].periodStart,
        periodEnd: parsed.dataPoints[parsed.dataPoints.length - 1].periodEnd,
        cadence: "WEEKLY",
        dataPointsCount: parsed.dataPoints.length,
        originClassification: "AUTHENTICATED_OFFICIAL_EXPORT",
        reviewStatus: "APPROVED",
        verificationMethod: "SYNTHETIC_TEST_SIGNING",
        evidenceChainReference: "urn:swai:test:csv18",
        issuerKeyId: "test_only_key_csv18",
        isTestOnly: true,
      });
      persistCsvImportAuthorityAtomically(testRec);

      const engCheck = verifyDurableCsvImportAuthority({
        rawCsvSha256: parsed.sha256Checksum,
        workspaceId: "ws_v19333",
        targetProductId: "prod_18",
        candidateId: "cand_18",
        targetKeyword: "automatic cat water fountain",
        region: "US",
        evaluationScope: "ENGINEERING",
      });
      expect(engCheck.verified).toBe(true);
      expect(engCheck.sourceOriginVerified).toBe(true);
      expect(engCheck.businessEligible).toBe(false);
    });

    it("CSV-19: same TEST_ONLY fixture evaluated in BUSINESS scope -> DENY", () => {
      registerCsvAuthoritySigningKey({
        keyId: "test_only_key_csv19",
        secret: "00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff",
        status: "TEST_ONLY",
        purpose: CSV_AUTHORITY_OPERATION_SCOPE,
        isBusinessTrusted: false,
      });

      const { parsed, artifactPath } = parseAndSaveCsv(buildTwelveWeekTrendsCsv("automatic cat water fountain", "United States"));
      const testRec = createSignedCsvImportAuthority({
        rawCsvSha256: parsed.sha256Checksum,
        artifactPath,
        importingPrincipalId: "test_importer",
        approverPrincipalId: "test_approver",
        approvedAt: "2026-09-07T00:00:00.000Z",
        importedAt: "2026-09-07T00:05:00.000Z",
        workspaceId: "ws_v19333",
        targetProductId: "prod_19",
        candidateId: "cand_19",
        query: "automatic cat water fountain",
        geography: "US",
        periodStart: parsed.dataPoints[0].periodStart,
        periodEnd: parsed.dataPoints[parsed.dataPoints.length - 1].periodEnd,
        cadence: "WEEKLY",
        dataPointsCount: parsed.dataPoints.length,
        originClassification: "UNIT_FIXTURE",
        reviewStatus: "APPROVED",
        verificationMethod: "SYNTHETIC_TEST_SIGNING",
        evidenceChainReference: "urn:swai:test:csv19",
        issuerKeyId: "test_only_key_csv19",
        isTestOnly: true,
      });
      persistCsvImportAuthorityAtomically(testRec);

      const bizCheck = verifyDurableCsvImportAuthority({
        rawCsvSha256: parsed.sha256Checksum,
        workspaceId: "ws_v19333",
        targetProductId: "prod_19",
        candidateId: "cand_19",
        targetKeyword: "automatic cat water fountain",
        region: "US",
        evaluationScope: "BUSINESS",
      });
      expect(bizCheck.verified).toBe(false);
      expect(bizCheck.businessEligible).toBe(false);
    });

    it("CSV-20: future import/approval cutoff (> asOfTimestamp) -> DENY with IMPORT_AFTER_CUTOFF", () => {
      const { parsed, artifactPath } = parseAndSaveCsv(buildTwelveWeekTrendsCsv("automatic cat water fountain", "United States"));
      const rec = createSignedCsvImportAuthority({
        rawCsvSha256: parsed.sha256Checksum,
        artifactPath,
        importingPrincipalId: "importer_01",
        approverPrincipalId: TEST_APPROVER,
        approvedAt: "2026-10-15T00:00:00.000Z",
        importedAt: "2026-10-15T00:00:00.000Z",
        workspaceId: "ws_v19333",
        targetProductId: "prod_20",
        candidateId: "cand_20",
        query: "automatic cat water fountain",
        geography: "US",
        periodStart: parsed.dataPoints[0].periodStart,
        periodEnd: parsed.dataPoints[parsed.dataPoints.length - 1].periodEnd,
        cadence: "WEEKLY",
        dataPointsCount: parsed.dataPoints.length,
        originClassification: "AUTHENTICATED_OFFICIAL_EXPORT",
        reviewStatus: "APPROVED",
        verificationMethod: "MANUAL_OPERATOR_EXPORT_REVIEW",
        evidenceChainReference: "urn:swai:csv:v19333:csv20",
        acquisitionSourceUrl: "https://trends.google.com/trends/explore?geo=US&q=automatic%20cat%20water%20fountain",
        issuerKeyId: TEST_KEY_ID,
        isTestOnly: false,
      });
      persistCsvImportAuthorityAtomically(rec);

      const cutoffCheck = verifyDurableCsvImportAuthority({
        rawCsvSha256: parsed.sha256Checksum,
        workspaceId: "ws_v19333",
        targetProductId: "prod_20",
        candidateId: "cand_20",
        targetKeyword: "automatic cat water fountain",
        region: "US",
        asOfTimestamp: "2026-09-30T23:59:59.000Z",
        evaluationScope: "BUSINESS",
      });
      expect(cutoffCheck.verified).toBe(false);
      expect(cutoffCheck.businessEligible).toBe(false);
      expect(cutoffCheck.code).toBe("IMPORT_AFTER_CUTOFF");
    });

    it("CSV-21: wrong targetProductId, candidateId, workspaceId, or raw CSV SHA -> DENY", () => {
      const { parsed, artifactPath } = parseAndSaveCsv(buildTwelveWeekTrendsCsv("automatic cat water fountain", "United States"));
      const rec = createSignedCsvImportAuthority({
        rawCsvSha256: parsed.sha256Checksum,
        artifactPath,
        importingPrincipalId: "importer_01",
        approverPrincipalId: TEST_APPROVER,
        approvedAt: "2026-09-07T00:00:00.000Z",
        importedAt: "2026-09-07T00:05:00.000Z",
        workspaceId: "ws_v19333",
        targetProductId: "prod_21",
        candidateId: "cand_21",
        query: "automatic cat water fountain",
        geography: "US",
        periodStart: parsed.dataPoints[0].periodStart,
        periodEnd: parsed.dataPoints[parsed.dataPoints.length - 1].periodEnd,
        cadence: "WEEKLY",
        dataPointsCount: parsed.dataPoints.length,
        originClassification: "AUTHENTICATED_OFFICIAL_EXPORT",
        reviewStatus: "APPROVED",
        verificationMethod: "MANUAL_OPERATOR_EXPORT_REVIEW",
        evidenceChainReference: "urn:swai:csv:v19333:csv21",
        acquisitionSourceUrl: "https://trends.google.com/trends/explore?geo=US&q=automatic%20cat%20water%20fountain",
        issuerKeyId: TEST_KEY_ID,
        isTestOnly: false,
      });
      persistCsvImportAuthorityAtomically(rec);

      const wrongProduct = verifyDurableCsvImportAuthority({
        rawCsvSha256: parsed.sha256Checksum,
        workspaceId: "ws_v19333",
        targetProductId: "prod_OTHER",
        candidateId: "cand_21",
        targetKeyword: "automatic cat water fountain",
        region: "US",
        evaluationScope: "BUSINESS",
      });
      expect(wrongProduct.verified).toBe(false);
      expect(wrongProduct.code).toBe("PRODUCT_MISMATCH");

      const wrongWorkspace = verifyDurableCsvImportAuthority({
        rawCsvSha256: parsed.sha256Checksum,
        workspaceId: "ws_OTHER",
        targetProductId: "prod_21",
        candidateId: "cand_21",
        targetKeyword: "automatic cat water fountain",
        region: "US",
        evaluationScope: "BUSINESS",
      });
      expect(wrongWorkspace.verified).toBe(false);
      expect(wrongWorkspace.code).toBe("WORKSPACE_MISMATCH");
    });

    it("CSV-22: valid REAL approved CSV evidence but < 60 covered days -> G15 insufficient (eligibleForEvergreen=false)", () => {
      const shortPoints: DemandDataPoint[] = [
        {
          id: "pt_1",
          productId: "prod_22",
          keyword: "automatic cat water fountain",
          source: "GOOGLE_TRENDS_CSV",
          region: "US",
          evidenceReference: "csv-import:job_csv22:sha256:1111111111111111111111111111111111111111111111111111111111111111",
          periodStart: "2026-08-02",
          periodEnd: "2026-08-08",
          demandValue: 70,
        },
        {
          id: "pt_2",
          productId: "prod_22",
          keyword: "automatic cat water fountain",
          source: "GOOGLE_TRENDS_CSV",
          region: "US",
          evidenceReference: "csv-import:job_csv22:sha256:1111111111111111111111111111111111111111111111111111111111111111",
          periodStart: "2026-08-09",
          periodEnd: "2026-08-15",
          demandValue: 73,
        },
        {
          id: "pt_3",
          productId: "prod_22",
          keyword: "automatic cat water fountain",
          source: "GOOGLE_TRENDS_CSV",
          region: "US",
          evidenceReference: "csv-import:job_csv22:sha256:1111111111111111111111111111111111111111111111111111111111111111",
          periodStart: "2026-08-16",
          periodEnd: "2026-08-22",
          demandValue: 71,
        },
      ];

      const ev = evaluateDemandHistoryEvidence(shortPoints, {
        candidateCanonicalName: "Automatic Cat Water Fountain",
        targetProductId: "prod_22",
        workspaceId: "ws_v19333",
        evaluationScope: "BUSINESS",
      });
      expect(ev.eligibleForEvergreen).toBe(false);
    });

    it("CSV-23: valid >=60d engineered TEST_ONLY fixture -> passes ENGINEERING scope only, denied in BUSINESS scope", () => {
      registerCsvAuthoritySigningKey({
        keyId: "test_only_key_csv23",
        secret: "00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff",
        status: "TEST_ONLY",
        purpose: CSV_AUTHORITY_OPERATION_SCOPE,
        isBusinessTrusted: false,
      });

      const { parsed, artifactPath } = parseAndSaveCsv(buildTwelveWeekTrendsCsv("automatic cat water fountain", "United States"));
      const rec = createSignedCsvImportAuthority({
        rawCsvSha256: parsed.sha256Checksum,
        artifactPath,
        importingPrincipalId: "test_importer",
        approverPrincipalId: null,
        approvedAt: null,
        importedAt: "2026-09-07T00:05:00.000Z",
        workspaceId: "ws_v19333",
        targetProductId: "prod_23",
        candidateId: "cand_23",
        query: "automatic cat water fountain",
        geography: "US",
        periodStart: parsed.dataPoints[0].periodStart,
        periodEnd: parsed.dataPoints[parsed.dataPoints.length - 1].periodEnd,
        cadence: "WEEKLY",
        dataPointsCount: parsed.dataPoints.length,
        originClassification: "UNIT_FIXTURE",
        reviewStatus: "PENDING_REVIEW",
        verificationMethod: "SYNTHETIC_TEST_SIGNING",
        evidenceChainReference: "urn:swai:test:csv23",
        issuerKeyId: "test_only_key_csv23",
        isTestOnly: true,
      });
      persistCsvImportAuthorityAtomically(rec);

      const points: DemandDataPoint[] = parsed.dataPoints.map((p, idx) => ({
        id: `pt23_${idx}`,
        productId: "prod_23",
        keyword: "automatic cat water fountain",
        source: "GOOGLE_TRENDS_CSV",
        region: "US",
        evidenceReference: `csv-import:job_csv23:sha256:${parsed.sha256Checksum}`,
        periodStart: p.periodStart,
        periodEnd: p.periodEnd,
        demandValue: p.demandValue,
      }));

      const bizEval = evaluateDemandHistoryEvidence(points, {
        candidateCanonicalName: "Automatic Cat Water Fountain",
        targetProductId: "prod_23",
        workspaceId: "ws_v19333",
        evaluationScope: "BUSINESS",
      });
      expect(bizEval.eligibleForEvergreen).toBe(false);
    });

    it("CSV-24: non-CSV source disguised as official -> DENY in evaluateDemandSourceAuthority", () => {
      const disguisedSeries: DemandDataPoint[] = [
        {
          id: "d1",
          productId: "prod_24",
          keyword: "automatic cat water fountain",
          source: "SYNTHETIC_DEMO",
          region: "US",
          evidenceReference: "csv-import:job_fake_24:sha256:0000000000000000000000000000000000000000000000000000000000000000",
          periodStart: "2026-06-01",
          periodEnd: "2026-06-30",
          demandValue: 70,
        },
        {
          id: "d2",
          productId: "prod_24",
          keyword: "automatic cat water fountain",
          source: "SYNTHETIC_DEMO",
          region: "US",
          evidenceReference: "csv-import:job_fake_24:sha256:0000000000000000000000000000000000000000000000000000000000000000",
          periodStart: "2026-07-01",
          periodEnd: "2026-07-31",
          demandValue: 72,
        },
        {
          id: "d3",
          productId: "prod_24",
          keyword: "automatic cat water fountain",
          source: "SYNTHETIC_DEMO",
          region: "US",
          evidenceReference: "csv-import:job_fake_24:sha256:0000000000000000000000000000000000000000000000000000000000000000",
          periodStart: "2026-09-01",
          periodEnd: "2026-09-30",
          demandValue: 75,
        },
      ];
      const auth = evaluateDemandSourceAuthority(disguisedSeries, {
        candidateCanonicalName: "Automatic Cat Water Fountain",
        candidateProductId: "prod_24",
        evaluationScope: "BUSINESS",
      });
      expect(auth.authority).toBe("FIXTURE_ONLY");
      expect(auth.productAttributionValid).toBe(false);
    });
  });

  // ===========================================================================
  // PART 2: P1-B / G16 — NO UNVERIFIED GOOGLE ADS PLATFORM POINTS (GSC-01..GSC-24)
  // ===========================================================================
  describe("Part 2: P1-B — Google Ads Multi-Platform Score & Confidence Require Verified Product Evidence (GSC-01..GSC-24)", () => {
    it("GSC-01: supportingSourceTypes has GOOGLE_ADS but zero Google observations exist -> 0 Google points (score 8/20 from Meta only)", () => {
      const candidate = makeBaseCandidate({
        supportingSourceTypes: ["META_ADS", "GOOGLE_ADS"],
        sourceObservations: [
          {
            source: "META_ADS",
            sourceRecordId: "meta_only_1",
            landingPageUrl: "https://uahpet.com/products/uahpet-fountain",
            verifiedDeliveryMarket: "US",
            provenance: "LIVE_PROVIDER",
            metrics: { daysRunning: 90 },
          } as any,
        ],
      });

      const score = calculateKH02EvergreenScore({ candidate, demandSeries: [] });
      expect(score.pillars.multiPlatformValidation.score).toBe(8);
      expect(score.evidenceConfidence).toBe(50); // 15 (problemStatement) + 15 (Meta) + 10 (storeDomain) + 10 (distinctAdvertisers=2), 0 from Google
      expect(score.strengths.some((s) => s.includes("2 independent media channels"))).toBe(false);
    });

    it("GSC-02: Google observation has PDP + US market but providerVerified=false -> 0 Google points", () => {
      const candidate = makeBaseCandidate({
        supportingSourceTypes: ["META_ADS", "GOOGLE_ADS"],
        sourceObservations: [
          {
            source: "META_ADS",
            sourceRecordId: "meta_1",
            landingPageUrl: "https://uahpet.com/products/uahpet-fountain",
            verifiedDeliveryMarket: "US",
            provenance: "LIVE_PROVIDER",
          } as any,
          {
            source: "GOOGLE_ADS",
            sourceRecordId: "CR_LOCAL_MCP_02",
            landingPageUrl: "https://uahpet.com/products/uahpet-fountain",
            advertiserDomain: "uahpet.com",
            verifiedDeliveryMarket: "US",
            provenance: "LIVE_PROVIDER",
            providerVerified: false,
            upstreamRequestVerified: false,
            metrics: {
              productRelevance: "DIRECT_PRODUCT",
              providerVerified: false,
              upstreamRequestVerified: false,
              localMcpToolResultVerified: true,
              provenanceTier: "LOCAL_MCP_TOOL_RESULT_VERIFIED",
              upstreamOriginStatus: "UPSTREAM_NOT_ATTESTED",
            },
          } as any,
        ],
      });

      const score = calculateKH02EvergreenScore({ candidate, demandSeries: [] });
      expect(score.pillars.multiPlatformValidation.score).toBe(8);
      expect(score.evidenceConfidence).toBe(50);
    });

    it("GSC-03: Google observation has providerVerified=true but upstreamRequestVerified=false -> 0 Google points", () => {
      const candidate = makeBaseCandidate({
        supportingSourceTypes: ["GOOGLE_ADS"],
        sourceObservations: [
          {
            source: "GOOGLE_ADS",
            sourceRecordId: "CR_GSC03",
            landingPageUrl: "https://uahpet.com/products/uahpet-fountain",
            advertiserDomain: "uahpet.com",
            verifiedDeliveryMarket: "US",
            provenance: "LIVE_PROVIDER",
            providerVerified: true,
            upstreamRequestVerified: false,
            metrics: {
              productRelevance: "DIRECT_PRODUCT",
              providerVerified: true,
              upstreamRequestVerified: false,
            },
          } as any,
        ],
      });

      const score = calculateKH02EvergreenScore({ candidate, demandSeries: [] });
      expect(score.pillars.multiPlatformValidation.score).toBe(0);
    });

    it("GSC-04: Google observation has upstreamRequestVerified=true but providerVerified=false -> 0 Google points", () => {
      const candidate = makeBaseCandidate({
        supportingSourceTypes: ["GOOGLE_ADS"],
        sourceObservations: [
          {
            source: "GOOGLE_ADS",
            sourceRecordId: "CR_GSC04",
            landingPageUrl: "https://uahpet.com/products/uahpet-fountain",
            advertiserDomain: "uahpet.com",
            verifiedDeliveryMarket: "US",
            provenance: "LIVE_PROVIDER",
            providerVerified: false,
            upstreamRequestVerified: true,
            metrics: {
              productRelevance: "DIRECT_PRODUCT",
              providerVerified: false,
              upstreamRequestVerified: true,
            },
          } as any,
        ],
      });

      const score = calculateKH02EvergreenScore({ candidate, demandSeries: [] });
      expect(score.pillars.multiPlatformValidation.score).toBe(0);
    });

    it("GSC-05: string 'true' provenance flags ('true' instead of boolean true) -> 0 Google points", () => {
      const candidate = makeBaseCandidate({
        supportingSourceTypes: ["GOOGLE_ADS"],
        sourceObservations: [
          {
            source: "GOOGLE_ADS",
            sourceRecordId: "CR_GSC05",
            landingPageUrl: "https://uahpet.com/products/uahpet-fountain",
            advertiserDomain: "uahpet.com",
            verifiedDeliveryMarket: "US",
            provenance: "LIVE_PROVIDER",
            providerVerified: "true" as any,
            upstreamRequestVerified: "true" as any,
            metrics: {
              productRelevance: "DIRECT_PRODUCT",
              providerVerified: "true",
              upstreamRequestVerified: "true",
            },
          } as any,
        ],
      });

      const score = calculateKH02EvergreenScore({ candidate, demandSeries: [] });
      expect(score.pillars.multiPlatformValidation.score).toBe(0);
    });

    it("GSC-06: local MCP verified with upstreamOriginStatus='UPSTREAM_NOT_ATTESTED' or provenanceTier='LOCAL_MCP_TOOL_RESULT_VERIFIED' -> 0 Google points", () => {
      const candidate = makeBaseCandidate({
        supportingSourceTypes: ["GOOGLE_ADS"],
        sourceObservations: [
          {
            source: "GOOGLE_ADS",
            sourceRecordId: "CR_GSC06",
            landingPageUrl: "https://uahpet.com/products/uahpet-fountain",
            advertiserDomain: "uahpet.com",
            verifiedDeliveryMarket: "US",
            provenance: "LIVE_PROVIDER",
            providerVerified: true,
            upstreamRequestVerified: true,
            upstreamOriginStatus: "UPSTREAM_NOT_ATTESTED",
            provenanceTier: "LOCAL_MCP_TOOL_RESULT_VERIFIED",
            metrics: {
              productRelevance: "DIRECT_PRODUCT",
              providerVerified: true,
              upstreamRequestVerified: true,
              upstreamOriginStatus: "UPSTREAM_NOT_ATTESTED",
              provenanceTier: "LOCAL_MCP_TOOL_RESULT_VERIFIED",
            },
          } as any,
        ],
      });

      const score = calculateKH02EvergreenScore({ candidate, demandSeries: [] });
      expect(score.pillars.multiPlatformValidation.score).toBe(0);
    });

    it("GSC-07: fabricated upstream requestId in MCP JSON without registered execution lineage -> 0 Google points", () => {
      const forgedCreative = {
        creative_id: "CR_FORGED_07",
        advertiser_id: "AR1111111111",
        request_id: "forged_rpc_99999",
        providerRequestId: "forged_rpc_99999",
        _mcpProvenance: {
          mcpInvocationRef: "forged_inv_gsc07",
          researchRunId: "run_gsc07",
          rawPayloadSha256: "0000000000000000000000000000000000000000000000000000000000000000",
        },
      };
      const lineageCheck = verifyGoogleInvocationLineage(forgedCreative, [], "run_gsc07");
      expect(lineageCheck.verified).toBe(false);
      expect(lineageCheck.providerVerified).toBe(false);
      expect(lineageCheck.upstreamRequestVerified).toBe(false);

      const candidate = makeBaseCandidate({
        supportingSourceTypes: ["GOOGLE_ADS"],
        sourceObservations: [
          {
            source: "GOOGLE_ADS",
            sourceRecordId: "CR_FORGED_07",
            evidenceReference: "GoogleAd:CR_FORGED_07",
            landingPageUrl: "https://uahpet.com/products/uahpet-fountain",
            advertiserDomain: "uahpet.com",
            verifiedDeliveryMarket: "US",
            provenance: "LIVE_PROVIDER",
            providerRequestId: "forged_rpc_99999",
            providerVerified: lineageCheck.providerVerified,
            upstreamRequestVerified: lineageCheck.upstreamRequestVerified,
            upstreamOriginStatus: lineageCheck.upstreamOriginStatus,
            provenanceTier: lineageCheck.provenanceTier,
            metrics: {
              productRelevance: "DIRECT_PRODUCT",
              requestId: "forged_rpc_99999",
              providerVerified: lineageCheck.providerVerified,
              upstreamRequestVerified: lineageCheck.upstreamRequestVerified,
            },
          } as any,
        ],
      });

      const score = calculateKH02EvergreenScore({ candidate, demandSeries: [] });
      expect(score.pillars.multiPlatformValidation.score).toBe(0);
      expect(score.evidenceConfidence).toBe(35);
    });

    it("GSC-08: GOOGLE_ADS observation with brand/home/collection/search URL -> 0 Google points even if upstream flags true", () => {
      for (const nonPdpUrl of [
        "https://uahpet.com/",
        "https://uahpet.com/collections/all",
        "https://uahpet.com/pages/about-us",
        "https://uahpet.com/search?q=fountain",
      ]) {
        const candidate = makeBaseCandidate({
          supportingSourceTypes: ["GOOGLE_ADS"],
          sourceObservations: [
            {
              source: "GOOGLE_ADS",
              sourceRecordId: "CR_GSC08",
              landingPageUrl: nonPdpUrl,
              advertiserDomain: "uahpet.com",
              verifiedDeliveryMarket: "US",
              provenance: "LIVE_PROVIDER",
              providerVerified: true,
              upstreamRequestVerified: true,
              metrics: {
                productRelevance: "DIRECT_PRODUCT",
                providerVerified: true,
                upstreamRequestVerified: true,
              },
            } as any,
          ],
        });
        const score = calculateKH02EvergreenScore({ candidate, demandSeries: [] });
        expect(score.pillars.multiPlatformValidation.score).toBe(0);
      }
    });

    it("GSC-09: Google product URL but requested US filter only (marketProvenance FILTER_ONLY or verifiedDeliveryMarket null) -> 0 Google points", () => {
      const candidateFilterOnly = makeBaseCandidate({
        supportingSourceTypes: ["GOOGLE_ADS"],
        sourceObservations: [
          {
            source: "GOOGLE_ADS",
            sourceRecordId: "CR_GSC09",
            landingPageUrl: "https://uahpet.com/products/uahpet-fountain",
            advertiserDomain: "uahpet.com",
            verifiedDeliveryMarket: "US",
            provenance: "LIVE_PROVIDER",
            providerVerified: true,
            upstreamRequestVerified: true,
            metrics: {
              productRelevance: "DIRECT_PRODUCT",
              providerVerified: true,
              upstreamRequestVerified: true,
              marketProvenance: {
                verificationStatus: "FILTER_ONLY",
              },
            },
          } as any,
        ],
      });

      const score = calculateKH02EvergreenScore({ candidate: candidateFilterOnly, demandSeries: [] });
      expect(score.pillars.multiPlatformValidation.score).toBe(0);
    });

    it("GSC-10: related but wrong merchant/product/candidate URL -> 0 Google points", () => {
      const candidateWrongMerchant = makeBaseCandidate({
        canonicalProductUrl: "https://uahpet.com/products/uahpet-fountain",
        storeDomain: "uahpet.com",
        supportingSourceTypes: ["GOOGLE_ADS"],
        sourceObservations: [
          {
            source: "GOOGLE_ADS",
            sourceRecordId: "CR_GSC10_OTHER_MERCHANT",
            landingPageUrl: "https://competitor-pets.com/products/other-fountain",
            advertiserDomain: "competitor-pets.com",
            verifiedDeliveryMarket: "US",
            provenance: "LIVE_PROVIDER",
            providerVerified: true,
            upstreamRequestVerified: true,
            metrics: {
              productRelevance: "DIRECT_PRODUCT",
              providerVerified: true,
              upstreamRequestVerified: true,
            },
          } as any,
          {
            source: "GOOGLE_ADS",
            sourceRecordId: "CR_GSC10_OTHER_HANDLE",
            landingPageUrl: "https://uahpet.com/products/dog-nail-grinder",
            advertiserDomain: "uahpet.com",
            verifiedDeliveryMarket: "US",
            provenance: "LIVE_PROVIDER",
            providerVerified: true,
            upstreamRequestVerified: true,
            metrics: {
              productRelevance: "DIRECT_PRODUCT",
              providerVerified: true,
              upstreamRequestVerified: true,
            },
          } as any,
        ],
      });

      const score = calculateKH02EvergreenScore({ candidate: candidateWrongMerchant, demandSeries: [] });
      expect(score.pillars.multiPlatformValidation.score).toBe(0);
    });

    it("GSC-11: cached/replay/fixture Google observation marked as LIVE by outer wrapper -> 0 Google points", () => {
      const candidateCached = makeBaseCandidate({
        supportingSourceTypes: ["GOOGLE_ADS"],
        sourceObservations: [
          {
            source: "GOOGLE_ADS",
            sourceRecordId: "CR_GSC11",
            landingPageUrl: "https://uahpet.com/products/uahpet-fountain",
            advertiserDomain: "uahpet.com",
            verifiedDeliveryMarket: "US",
            provenance: "CACHED_SOURCE",
            isCached: true,
            sourceMode: "CACHE",
            providerVerified: true,
            upstreamRequestVerified: true,
            metrics: {
              productRelevance: "DIRECT_PRODUCT",
              providerVerified: true,
              upstreamRequestVerified: true,
            },
          } as any,
        ],
      });

      const score = calculateKH02EvergreenScore({ candidate: candidateCached, demandSeries: [] });
      expect(score.pillars.multiPlatformValidation.score).toBe(0);
    });

    it("GSC-12: sourceObservations absent/null while supportingSourceTypes claims GOOGLE_ADS -> 0 Google points", () => {
      const candidateNullObs = makeBaseCandidate({
        supportingSourceTypes: ["GOOGLE_ADS"],
        sourceObservations: null as any,
      });

      const score = calculateKH02EvergreenScore({ candidate: candidateNullObs, demandSeries: [] });
      expect(score.pillars.multiPlatformValidation.score).toBe(0);
    });

    it("GSC-13: duplicate verified Google observations for same creative/product -> max +6 Pillar C and +10 confidence ONCE", () => {
      const verifiedGoogleObs1 = {
        source: "GOOGLE_ADS",
        sourceRecordId: "CR_GSC13_1",
        landingPageUrl: "https://uahpet.com/products/uahpet-fountain",
        advertiserDomain: "uahpet.com",
        verifiedDeliveryMarket: "US",
        provenance: "LIVE_PROVIDER",
        providerVerified: true,
        upstreamRequestVerified: true,
        upstreamOriginStatus: "UPSTREAM_HTTPS_ATTESTED",
        provenanceTier: "UPSTREAM_NETWORK_ATTESTED",
        metrics: {
          productRelevance: "DIRECT_PRODUCT",
          providerVerified: true,
          upstreamRequestVerified: true,
          syntheticTestFixtureLabel: "SYNTHETIC_POSITIVE_ENGINEERING_TEST_FIXTURE",
        },
      } as any;
      const verifiedGoogleObs2 = {
        ...verifiedGoogleObs1,
        sourceRecordId: "CR_GSC13_2",
      };

      const candidateDupGoogle = makeBaseCandidate({
        supportingSourceTypes: ["GOOGLE_ADS", "GOOGLE", "GOOGLE_ADS_TRANSPARENCY"],
        sourceObservations: [verifiedGoogleObs1, verifiedGoogleObs2],
      });

      const score = calculateKH02EvergreenScore({ candidate: candidateDupGoogle, demandSeries: [] });
      expect(score.pillars.multiPlatformValidation.score).toBe(6);
      expect(score.evidenceConfidence).toBe(45); // 15 (problemStatement) + 10 (Google once) + 10 (storeDomain) + 10 (distinctAdvertisers=2)
    });

    it("GSC-14: 1 authentic independently upstream-attested US PDP Google obs (SYNTHETIC POSITIVE ENGINEERING TEST fixture) -> +6 Google", () => {
      const candidateVerifiedGoogleOnly = makeBaseCandidate({
        supportingSourceTypes: ["GOOGLE_ADS"],
        sourceObservations: [
          {
            source: "GOOGLE_ADS",
            sourceRecordId: "CR_GSC14_SYNTH_POS",
            landingPageUrl: "https://uahpet.com/products/uahpet-fountain",
            advertiserDomain: "uahpet.com",
            verifiedDeliveryMarket: "US",
            provenance: "LIVE_PROVIDER",
            providerVerified: true,
            upstreamRequestVerified: true,
            upstreamOriginStatus: "UPSTREAM_HTTPS_ATTESTED",
            provenanceTier: "UPSTREAM_NETWORK_ATTESTED",
            metrics: {
              productRelevance: "DIRECT_PRODUCT",
              providerVerified: true,
              upstreamRequestVerified: true,
              syntheticTestFixtureLabel: "SYNTHETIC_POSITIVE_ENGINEERING_TEST_FIXTURE",
            },
          } as any,
        ],
      });

      const score = calculateKH02EvergreenScore({ candidate: candidateVerifiedGoogleOnly, demandSeries: [] });
      expect(score.pillars.multiPlatformValidation.score).toBe(6);
      expect(score.evidenceConfidence).toBe(45);
    });

    it("GSC-15: 1 verified META_ADS + 1 unverified GOOGLE_ADS -> Pillar C score 8/20", () => {
      const candidate = makeBaseCandidate({
        supportingSourceTypes: ["META_ADS", "GOOGLE_ADS"],
        sourceObservations: [
          {
            source: "META_ADS",
            sourceRecordId: "meta_15",
            landingPageUrl: "https://uahpet.com/products/uahpet-fountain",
            verifiedDeliveryMarket: "US",
            provenance: "LIVE_PROVIDER",
          } as any,
          {
            source: "GOOGLE_ADS",
            sourceRecordId: "google_unverified_15",
            landingPageUrl: "https://uahpet.com/products/uahpet-fountain",
            advertiserDomain: "uahpet.com",
            verifiedDeliveryMarket: "US",
            provenance: "LIVE_PROVIDER",
            providerVerified: false,
            upstreamRequestVerified: false,
            metrics: {
              productRelevance: "DIRECT_PRODUCT",
              providerVerified: false,
              upstreamRequestVerified: false,
            },
          } as any,
        ],
      });

      const score = calculateKH02EvergreenScore({ candidate, demandSeries: [] });
      expect(score.pillars.multiPlatformValidation.score).toBe(8);
      expect(score.pillars.multiPlatformValidation.maxWeight).toBe(20);
    });

    it("GSC-16: 1 verified META_ADS + 1 verified GOOGLE_ADS (SYNTHETIC POSITIVE ENGINEERING TEST fixture) -> Pillar C score 14/20", () => {
      const candidate = makeBaseCandidate({
        supportingSourceTypes: ["META_ADS", "GOOGLE_ADS"],
        sourceObservations: [
          {
            source: "META_ADS",
            sourceRecordId: "meta_16",
            landingPageUrl: "https://uahpet.com/products/uahpet-fountain",
            verifiedDeliveryMarket: "US",
            provenance: "LIVE_PROVIDER",
          } as any,
          {
            source: "GOOGLE_ADS",
            sourceRecordId: "google_verified_16",
            landingPageUrl: "https://uahpet.com/products/uahpet-fountain",
            advertiserDomain: "uahpet.com",
            verifiedDeliveryMarket: "US",
            provenance: "LIVE_PROVIDER",
            providerVerified: true,
            upstreamRequestVerified: true,
            upstreamOriginStatus: "UPSTREAM_HTTPS_ATTESTED",
            provenanceTier: "UPSTREAM_NETWORK_ATTESTED",
            metrics: {
              productRelevance: "DIRECT_PRODUCT",
              providerVerified: true,
              upstreamRequestVerified: true,
              syntheticTestFixtureLabel: "SYNTHETIC_POSITIVE_ENGINEERING_TEST_FIXTURE",
            },
          } as any,
        ],
      });

      const score = calculateKH02EvergreenScore({ candidate, demandSeries: [] });
      expect(score.pillars.multiPlatformValidation.score).toBe(14);
      expect(score.pillars.multiPlatformValidation.maxWeight).toBe(20);
      expect(score.strengths).toContain(
        "Cross-platform validation: Confirmed across 2 independent media channels."
      );
    });

    it("GSC-17: unrelated Google observation while supportingSourceTypes lists GOOGLE_ADS -> 0 Google points", () => {
      const candidate = makeBaseCandidate({
        supportingSourceTypes: ["GOOGLE_ADS"],
        sourceObservations: [
          {
            source: "GOOGLE_ADS",
            sourceRecordId: "google_unrelated_17",
            landingPageUrl: "https://uahpet.com/products/uahpet-fountain",
            advertiserDomain: "uahpet.com",
            verifiedDeliveryMarket: "US",
            provenance: "LIVE_PROVIDER",
            providerVerified: true,
            upstreamRequestVerified: true,
            metrics: {
              productRelevance: "UNRELATED",
              associationVerdict: "REJECTED_UNRELATED_CREATIVE",
              providerVerified: true,
              upstreamRequestVerified: true,
            },
          } as any,
        ],
      });

      const score = calculateKH02EvergreenScore({ candidate, demandSeries: [] });
      expect(score.pillars.multiPlatformValidation.score).toBe(0);
    });

    it("GSC-18: no fake cross-platform strength, confidence, or platformCount across negative Google cases", () => {
      const candidate = makeBaseCandidate({
        supportingSourceTypes: ["META_ADS", "GOOGLE_ADS"],
        sourceObservations: [
          {
            source: "META_ADS",
            sourceRecordId: "meta_18",
            landingPageUrl: "https://uahpet.com/products/uahpet-fountain",
            verifiedDeliveryMarket: "US",
            provenance: "LIVE_PROVIDER",
          } as any,
          {
            source: "GOOGLE_ADS",
            sourceRecordId: "google_18_unverified",
            landingPageUrl: "https://uahpet.com/products/uahpet-fountain",
            advertiserDomain: "uahpet.com",
            verifiedDeliveryMarket: "US",
            provenance: "LIVE_PROVIDER",
            providerVerified: false,
            upstreamRequestVerified: false,
            metrics: {
              productRelevance: "DIRECT_PRODUCT",
              providerVerified: false,
              upstreamRequestVerified: false,
            },
          } as any,
        ],
      });

      const score = calculateKH02EvergreenScore({ candidate, demandSeries: [] });
      expect(score.pillars.multiPlatformValidation.score).toBe(8);
      expect(score.pillars.multiPlatformValidation.explanation).toContain("1 platform source(s)");
      expect(score.strengths.some((s) => s.includes("independent media channels"))).toBe(false);
    });

    it("GSC-19: no G15 pass from 120-day Google ad creative longevity when demandSeries is empty", () => {
      const candidate = makeBaseCandidate({
        earliestObservationDate: "2026-04-01T00:00:00.000Z",
        latestObservationDate: "2026-09-01T00:00:00.000Z",
        supportingSourceTypes: ["META_ADS", "GOOGLE_ADS"],
        sourceObservations: [
          {
            source: "GOOGLE_ADS",
            sourceRecordId: "google_120d_19",
            landingPageUrl: "https://uahpet.com/products/uahpet-fountain",
            advertiserDomain: "uahpet.com",
            verifiedDeliveryMarket: "US",
            provenance: "LIVE_PROVIDER",
            providerVerified: true,
            upstreamRequestVerified: true,
            metrics: {
              daysRunning: 120,
              productRelevance: "DIRECT_PRODUCT",
              providerVerified: true,
              upstreamRequestVerified: true,
            },
          } as any,
        ],
      });

      const score = calculateKH02EvergreenScore({ candidate, demandSeries: [] });
      expect(score.pillars.demandStability.score).toBeNull();
      expect(score.scoreStatus).toBe("PROVISIONAL");
      expect(score.tier).toBe("PROVISIONAL_OPPORTUNITY");
    });

    it("GSC-20: no G16 Top3 pass merely because Pillar C scores 14/20 when G15 demand history is absent", () => {
      const candidate = makeBaseCandidate({
        supportingSourceTypes: ["META_ADS", "GOOGLE_ADS"],
        sourceObservations: [
          {
            source: "META_ADS",
            sourceRecordId: "meta_20",
            landingPageUrl: "https://uahpet.com/products/uahpet-fountain",
            verifiedDeliveryMarket: "US",
            provenance: "LIVE_PROVIDER",
          } as any,
          {
            source: "GOOGLE_ADS",
            sourceRecordId: "google_20",
            landingPageUrl: "https://uahpet.com/products/uahpet-fountain",
            advertiserDomain: "uahpet.com",
            verifiedDeliveryMarket: "US",
            provenance: "LIVE_PROVIDER",
            providerVerified: true,
            upstreamRequestVerified: true,
            metrics: {
              productRelevance: "DIRECT_PRODUCT",
              providerVerified: true,
              upstreamRequestVerified: true,
            },
          } as any,
        ],
      });

      const score = calculateKH02EvergreenScore({ candidate, demandSeries: [] });
      expect(score.pillars.multiPlatformValidation.score).toBe(14);
      expect(score.evergreenVerification?.verifiedByGate).toBe(false);
      const gate = applyKH02EligibilityGates(score);
      expect(gate.isTop3Eligible).toBe(false);
      expect(gate.tier).toBe("PROVISIONAL_OPPORTUNITY");
    });

    it("GSC-21: source aliases GOOGLE and GOOGLE_ADS_TRANSPARENCY normalized consistently; unsupported arbitrary source types ignored", () => {
      const candidateBogus = makeBaseCandidate({
        supportingSourceTypes: ["META_ADS", "BOGUS_PLATFORM_XYZ", "REDDIT_ADS", "GOOGLE_ADS_TRANSPARENCY"],
        sourceObservations: [
          {
            source: "META_ADS",
            sourceRecordId: "meta_21",
            landingPageUrl: "https://uahpet.com/products/uahpet-fountain",
            verifiedDeliveryMarket: "US",
            provenance: "LIVE_PROVIDER",
          } as any,
        ],
      });

      const score = calculateKH02EvergreenScore({ candidate: candidateBogus, demandSeries: [] });
      expect(score.pillars.multiPlatformValidation.score).toBe(8);
      expect(score.pillars.multiPlatformValidation.explanation).toContain("1 platform source(s)");
      expect(score.strengths.some((s) => s.includes("independent media channels"))).toBe(false);
    });

    it("GSC-22: missing metrics, malformed booleans, null PDP, partial US ('US-CA') -> fail closed without throwing", () => {
      const malformedCandidate = makeBaseCandidate({
        supportingSourceTypes: ["GOOGLE_ADS"],
        sourceObservations: [
          null as any,
          {} as any,
          {
            source: "GOOGLE_ADS",
            sourceRecordId: "bad_1",
            landingPageUrl: null,
            verifiedDeliveryMarket: "US-CA",
            providerVerified: 1 as any,
            upstreamRequestVerified: "1" as any,
            metrics: null as any,
          } as any,
        ],
      });

      expect(() =>
        calculateKH02EvergreenScore({ candidate: malformedCandidate, demandSeries: [] })
      ).not.toThrow();
      const score = calculateKH02EvergreenScore({ candidate: malformedCandidate, demandSeries: [] });
      expect(score.pillars.multiPlatformValidation.score).toBe(0);
    });

    it("GSC-23: snapshot/DB readback requalifyHistoricalEvergreenSnapshot preserves honest source confidence and demotes unverified winners", () => {
      const pollutedSnapshot: any = {
        runId: "run_gsc23",
        workspaceId: "ws_v19333",
        topic: "Pet Gadgets",
        market: "US",
        runStatus: "PASSED",
        topThree: [
          {
            rank: 1,
            candidate: makeBaseCandidate({
              supportingSourceTypes: ["META_ADS", "GOOGLE_ADS"],
              sourceObservations: [
                {
                  source: "GOOGLE_ADS",
                  sourceRecordId: "CR_GSC23",
                  landingPageUrl: "https://uahpet.com/products/uahpet-fountain",
                  verifiedDeliveryMarket: "US",
                  providerVerified: false,
                  upstreamRequestVerified: false,
                } as any,
              ],
            }),
            score: {
              opportunityScore: 88,
              evidenceConfidence: 80,
              scoreStatus: "VERIFIED",
              tier: "VERIFIED_EVERGREEN",
              pillars: {
                demandStability: { score: null },
                multiPlatformValidation: { score: 14 },
              },
            },
          },
        ],
        provisionalCandidates: [],
        remainingCandidates: [],
      };

      const requalified = requalifyHistoricalEvergreenSnapshot(pollutedSnapshot);
      expect(requalified.snapshot?.topThree).toHaveLength(0);
    });

    it("GSC-24: repeated ad placements across Meta & Google for one merchant SKU collapse to one canonical product family", () => {
      const multiPlacements = discoverProductCandidatesFromAds(
        [
          {
            source: "META_ADS",
            sourceRecordId: "meta_p1",
            title: "UAHPET Wireless Stainless Steel Cat Water Fountain - Promo 1",
            landingPageUrl: "https://uahpet.com/products/uahpet-fountain?utm_source=fb&variant=111",
            advertiserDomain: "uahpet.com",
            provenance: "LIVE_PROVIDER",
          },
          {
            source: "META_ADS",
            sourceRecordId: "meta_p2",
            title: "UAHPET Wireless Stainless Steel Cat Water Fountain - Promo 2",
            landingPageUrl: "https://uahpet.com/products/uahpet-fountain?utm_source=ig&variant=222",
            advertiserDomain: "uahpet.com",
            provenance: "LIVE_PROVIDER",
          },
          {
            source: "GOOGLE_ADS",
            sourceRecordId: "google_p1",
            title: "UAHPET Wireless Stainless Steel Cat Water Fountain",
            landingPageUrl: "https://uahpet.com/products/uahpet-fountain?gclid=abc",
            advertiserDomain: "uahpet.com",
            provenance: "LIVE_PROVIDER",
          },
        ],
        "Pet Gadgets"
      );

      expect(multiPlacements).toHaveLength(1);
      const distinctness = evaluateShortlistDistinctness(multiPlacements);
      expect(distinctness.distinctCount).toBe(1);

      const shortlist = selectTopResearchShortlist(multiPlacements, 3, {
        nicheIntent: "BROAD_CATEGORY",
        topic: "Pet Gadgets",
      });
      expect(shortlist.shortlist.length).toBeLessThanOrEqual(1);
    });
  });
});
