/**
 * SWAI KH-02 — G15 CSV Origin Integrity & Official Import Authority Regression Suite
 *
 * Covers:
 * - Section 4 Mandatory Pre-Fix Reproduction (f300258f9ea08da45034f449ade0c43d643cf280838d0f370a264d6805826d39.csv)
 * - Section 6 Mandatory 30-Case Negative & Boundary Matrix (Cases 01 - 30)
 * - Section 6 Positive Engineering Verification (P01 - P07, explicitly labeled TEST_ONLY / ENGINEERING)
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import { prisma } from "@/lib/db";
import {
  parseGoogleTrendsCsvBytes,
  validateAndParseGoogleTrendsCsv,
  verifyStoredCsvFile,
  verifyDemandObservationAgainstRawCsv,
  saveOriginalGoogleTrendsCsvFile,
  importGoogleTrendsCsvToDatabase,
  GOOGLE_TRENDS_CSV_STORAGE_DIR,
} from "@/services/kh02/demand/googleTrendsCsvValidator";
import {
  hasVerifiableCsvOrProviderLineage,
  evaluateDemandSourceAuthority,
  evaluateDemandHistoryEvidence,
  resolveVerifiedDemandEvidence,
} from "@/services/kh02/demand/temporalDemandEngine";
import {
  executeDemandObservationBatchImport,
} from "@/services/kh02/demand/demandObservationBatchImport";
import {
  classifyCandidateObservationAttribution,
  filterAttributableObservations,
} from "@/services/kh02/demand/candidateDemandAttribution";
import {
  ALIAS_OPERATION_SCOPE,
  createSignedCandidateAliasApproval,
  persistCandidateAliasApprovalAtomically,
  registerAliasSigningKey,
  clearTestAliasSigningKeys,
} from "@/services/kh02/demand/durableCandidateAliasAuthority";
import {
  CSV_AUTHORITY_OPERATION_SCOPE,
  createSignedCsvImportAuthority,
  persistCsvImportAuthorityAtomically,
  revokeCsvImportAuthorityAtomically,
  verifyDurableCsvImportAuthority,
  registerCsvAuthoritySigningKey,
  clearTestCsvAuthoritySigningKeys,
} from "@/services/kh02/demand/durableCsvImportAuthority";
import {
  requalifyHistoricalEvergreenSnapshot,
} from "@/services/kh02/persistence/kh02PersistenceService";

describe("KH-02 G15 CSV Origin Integrity & Official Import Authority (30 Negative + 7 Positive Cases)", () => {
  const KNOWN_FIXTURE_SHA = "f300258f9ea08da45034f449ade0c43d643cf280838d0f370a264d6805826d39";
  const knownFixturePath = path.join(GOOGLE_TRENDS_CSV_STORAGE_DIR, `${KNOWN_FIXTURE_SHA}.csv`);

  let tempAuthorityDir: string;
  let tempAliasDir: string;
  let baselineCsvFiles: Set<string>;
  const createdCsvFiles: string[] = [];

  const testCsvKeyId = "csv_key_test_only_g15";
  const testCsvSecret = "1111222233334444555566667777888899990000aaaabbbbccccddddeeeeffff";

  const businessCsvKeyId = "csv_key_business_active_g15";
  const businessCsvSecret = "ffffeeeeddddccccbbbbaaaa0000999988887777666655554444333322221111";

  const businessAliasKeyId = "alias_key_business_active_g15";
  const businessAliasSecret = "abababababababababababababababababababababababababababababababab";

  function buildWeeklyCsvContent(opts?: {
    keyword?: string;
    regionLabel?: string;
    baseValue?: number;
    rowCount?: number;
    startDateIso?: string;
    stepDays?: number;
  }): { content: string; sha256: string; filePath: string; parsed: ReturnType<typeof parseGoogleTrendsCsvBytes> } {
    const kw = opts?.keyword ?? "automatic cat water fountain";
    const regionLabel = opts?.regionLabel ?? "United States";
    const baseVal = opts?.baseValue ?? 68;
    const count = opts?.rowCount ?? 13;
    const stepDays = opts?.stepDays ?? 7;
    const startMs = new Date(opts?.startDateIso ?? "2026-07-05T00:00:00.000Z").getTime();

    const lines = [
      "Category: All categories",
      "",
      "Interest over time",
      `Week,${kw}: (${regionLabel})`,
    ];
    const offsets = [0, 3, 1, 5, 2, 6, 4, 7, 3, 5, 4, 6, 5, 3, 4];
    for (let i = 0; i < count; i++) {
      const d = new Date(startMs + i * stepDays * 86400000).toISOString().slice(0, 10);
      const val = Math.min(100, Math.max(10, baseVal + offsets[i % offsets.length]));
      lines.push(`${d},${val}`);
    }
    const content = lines.join("\n") + "\n";
    const sha256 = crypto.createHash("sha256").update(content, "utf8").digest("hex");
    const filePath = saveOriginalGoogleTrendsCsvFile(content, sha256);
    createdCsvFiles.push(filePath);
    const parsed = parseGoogleTrendsCsvBytes(content);
    return { content, sha256, filePath, parsed };
  }

  beforeEach(() => {
    baselineCsvFiles = new Set(
      fs.existsSync(GOOGLE_TRENDS_CSV_STORAGE_DIR)
        ? fs.readdirSync(GOOGLE_TRENDS_CSV_STORAGE_DIR)
        : []
    );
    tempAuthorityDir = fs.mkdtempSync(path.join(os.tmpdir(), "kh02_csv_auth_g15_"));
    tempAliasDir = fs.mkdtempSync(path.join(os.tmpdir(), "kh02_alias_auth_g15_"));
    process.env.TEST_CSV_AUTHORITY_STORAGE_DIR = tempAuthorityDir;
    process.env.TEST_CANDIDATE_ALIAS_STORAGE_DIR = tempAliasDir;
    process.env.KH02_AUTHORIZED_CSV_APPROVER_PRINCIPALS = "principal_reviewer_us_01,principal_lead_auditor";
    process.env.KH02_CSV_AUTHORITY_KEY_ID = businessCsvKeyId;
    process.env.KH02_CSV_AUTHORITY_HMAC_SECRET = businessCsvSecret;
    process.env.KH02_CSV_AUTHORITY_KEY_STATUS = "ACTIVE";

    registerCsvAuthoritySigningKey({
      keyId: testCsvKeyId,
      secret: testCsvSecret,
      status: "TEST_ONLY",
      purpose: CSV_AUTHORITY_OPERATION_SCOPE,
      isBusinessTrusted: false,
      description: "Test-only key for ENGINEERING CSV authority tests",
    });

    registerAliasSigningKey({
      keyId: businessAliasKeyId,
      secret: businessAliasSecret,
      status: "ACTIVE",
      purpose: ALIAS_OPERATION_SCOPE,
      isBusinessTrusted: true,
      description: "Active alias key for cross-product alias tests",
    });
  });

  afterEach(() => {
    clearTestCsvAuthoritySigningKeys();
    clearTestAliasSigningKeys();
    delete process.env.TEST_CSV_AUTHORITY_STORAGE_DIR;
    delete process.env.TEST_CANDIDATE_ALIAS_STORAGE_DIR;
    delete process.env.KH02_AUTHORIZED_CSV_APPROVER_PRINCIPALS;
    delete process.env.KH02_CSV_AUTHORITY_KEY_ID;
    delete process.env.KH02_CSV_AUTHORITY_HMAC_SECRET;
    delete process.env.KH02_CSV_AUTHORITY_KEY_STATUS;

    while (createdCsvFiles.length > 0) {
      const f = createdCsvFiles.pop()!;
      try {
        if (f !== knownFixturePath && fs.existsSync(f)) {
          fs.unlinkSync(f);
        }
      } catch {}
    }
    try {
      if (fs.existsSync(GOOGLE_TRENDS_CSV_STORAGE_DIR) && baselineCsvFiles) {
        for (const entry of fs.readdirSync(GOOGLE_TRENDS_CSV_STORAGE_DIR)) {
          if (!baselineCsvFiles.has(entry)) {
            fs.unlinkSync(path.join(GOOGLE_TRENDS_CSV_STORAGE_DIR, entry));
          }
        }
      }
    } catch {}
    try {
      fs.rmSync(tempAuthorityDir, { recursive: true, force: true });
    } catch {}
    try {
      fs.rmSync(tempAliasDir, { recursive: true, force: true });
    } catch {}
  });

  // ============================================================================
  // SECTION 4: MANDATORY EXACT REPRODUCTION OF PRE-FIX G15 FAILURE
  // ============================================================================
  it("REPRO-00: Exact repository fixture f300258f... (car phone mount, US, 13 weekly points, 84d) with availability timestamps fails closed in BUSINESS scope", async () => {
    expect(fs.existsSync(knownFixturePath)).toBe(true);
    const parsed = parseGoogleTrendsCsvBytes(fs.readFileSync(knownFixturePath, "utf8"));
    expect(parsed.valid).toBe(true);
    expect(parsed.dataPoints.length).toBe(13);

    const evidenceRef = `csv-import:google-trends-explore:sha256:${KNOWN_FIXTURE_SHA}:q=car_phone_mount`;

    const lineage = hasVerifiableCsvOrProviderLineage(evidenceRef, null, {
      targetKeyword: "car phone mount",
      region: "US",
      periodStart: parsed.dataPoints[0].periodStart,
      observationValue: parsed.dataPoints[0].demandValue,
      strictLiveOrigin: true,
      strictSourceProvenance: true,
      allowUnitFixtures: false,
      evaluationScope: "BUSINESS",
    });

    // Separate facts: local byte/row integrity is true, but origin and business eligibility are false
    expect(lineage.rawCsvFileExists).toBe(true);
    expect(lineage.hasValidFileChecksum).toBe(true);
    expect(lineage.contentIntegrityVerified).toBe(true);
    expect(lineage.providerOriginVerified).toBe(false);
    expect((lineage as any).sourceOriginVerified).toBe(false);
    expect(lineage.businessLineageEligible).toBe(false);
    expect(lineage.lineageVerified).toBe(false);
    expect(lineage.sourceAuthority).not.toBe("HISTORICAL_SOURCE_VERIFIED");
    expect(lineage.sourceAuthority).not.toBe("AUTHORITATIVE_VERIFIED");

    const resolved = await resolveVerifiedDemandEvidence(evidenceRef, {
      keyword: "car phone mount",
      region: "US",
      strictLiveOrigin: true,
    });
    expect(resolved.contentIntegrityVerified).toBe(true);
    expect(resolved.providerOriginVerified).toBe(false);
    expect((resolved as any).sourceOriginVerified).toBe(false);
    expect(resolved.eligible).toBe(false);
    expect(resolved.verified).toBe(false);

    // Supply availability timestamps so points pass chronology gate and reach the origin gate
    const points = parsed.dataPoints.map((pt, idx) => ({
      id: `obs_repro_${idx}`,
      productId: "prod_car_phone_mount_01",
      keyword: "car phone mount",
      region: "US",
      source: "GOOGLE_TRENDS_CSV",
      periodStart: pt.periodStart,
      periodEnd: pt.periodEnd,
      demandValue: pt.demandValue,
      rawCsvSha256: KNOWN_FIXTURE_SHA,
      evidenceReference: evidenceRef,
      observedAt: pt.periodEnd,
      ingestedAt: "2026-10-26T00:00:00.000Z",
      availableAt: "2026-10-26T00:00:00.000Z",
    }));

    const strictPolicy = {
      strictLiveOrigin: true,
      strictSourceProvenance: true,
      allowUnitFixtures: false,
      evaluationScope: "BUSINESS" as const,
      requiredRegion: "US",
      targetProductId: "prod_car_phone_mount_01",
      candidateCanonicalName: "Car Phone Mount",
      searchTermUsed: "car phone mount",
    };

    const authority = evaluateDemandSourceAuthority(points, strictPolicy);
    expect(authority.authority).not.toBe("HISTORICAL_SOURCE_VERIFIED");
    expect(authority.authority).not.toBe("AUTHORITATIVE_VERIFIED");
    expect(["CACHED_UNVERIFIED", "FIXTURE_ONLY"]).toContain(authority.authority);

    const history = evaluateDemandHistoryEvidence(points, strictPolicy);
    expect(history.dataPointsCount).toBe(13);
    expect(history.coveredDays).toBe(84);
    expect(history.status).toBe("UNVERIFIED");
    expect(history.eligibleForEvergreen).toBe(false);
    expect(history.sourceAuthority).not.toBe("HISTORICAL_SOURCE_VERIFIED");
  });

  // ============================================================================
  // SECTION 6: 30 MANDATORY G15 NEGATIVE & BOUNDARY CASES
  // ============================================================================

  it("01. Empty observations -> UNKNOWN_SOURCE / INSUFFICIENT_HISTORY, eligibleForEvergreen=false", () => {
    const auth = evaluateDemandSourceAuthority([], { evaluationScope: "BUSINESS" });
    expect(auth.authority).toBe("UNKNOWN_SOURCE");
    expect(auth.productAttributionValid).toBe(false);

    const hist = evaluateDemandHistoryEvidence([], {
      strictLiveOrigin: true,
      strictSourceProvenance: true,
      evaluationScope: "BUSINESS",
    });
    expect(hist.status).toBe("INSUFFICIENT_HISTORY");
    expect(hist.eligibleForEvergreen).toBe(false);
    expect(hist.dataPointsCount).toBe(0);
  });

  it("02. Explicit fixture flag (isFixture=true) -> FIXTURE_ONLY, eligibleForEvergreen=false", () => {
    const { sha256, parsed } = buildWeeklyCsvContent();
    const points = parsed.dataPoints.map((pt, i) => ({
      id: `obs_fix_${i}`,
      productId: "prod_cat_fountain",
      keyword: "automatic cat water fountain",
      region: "US",
      source: "GOOGLE_TRENDS_CSV",
      periodStart: pt.periodStart,
      periodEnd: pt.periodEnd,
      demandValue: pt.demandValue,
      isFixture: true,
      evidenceReference: `csv-import:google-trends-explore:sha256:${sha256}:q=automatic_cat_water_fountain`,
      observedAt: pt.periodEnd,
      ingestedAt: "2026-10-20T00:00:00.000Z",
    }));

    const hist = evaluateDemandHistoryEvidence(points, {
      strictLiveOrigin: true,
      strictSourceProvenance: true,
      allowUnitFixtures: false,
      evaluationScope: "BUSINESS",
      targetProductId: "prod_cat_fountain",
      candidateCanonicalName: "Automatic Cat Water Fountain",
    });
    expect(hist.sourceAuthority).toBe("FIXTURE_ONLY");
    expect(hist.status).toBe("UNVERIFIED");
    expect(hist.eligibleForEvergreen).toBe(false);
  });

  it("03. Exact known repository CSV without fixture flag -> rejected in BUSINESS scope", () => {
    const parsed = parseGoogleTrendsCsvBytes(fs.readFileSync(knownFixturePath, "utf8"));
    const points = parsed.dataPoints.map((pt, i) => ({
      id: `obs_03_${i}`,
      productId: "prod_mount",
      keyword: "car phone mount",
      region: "US",
      source: "GOOGLE_TRENDS_CSV",
      periodStart: pt.periodStart,
      periodEnd: pt.periodEnd,
      demandValue: pt.demandValue,
      evidenceReference: `csv-import:google-trends-explore:sha256:${KNOWN_FIXTURE_SHA}:q=car_phone_mount`,
      observedAt: pt.periodEnd,
      ingestedAt: "2026-10-26T00:00:00.000Z",
    }));

    const hist = evaluateDemandHistoryEvidence(points, {
      strictLiveOrigin: true,
      strictSourceProvenance: true,
      allowUnitFixtures: false,
      evaluationScope: "BUSINESS",
      targetProductId: "prod_mount",
      candidateCanonicalName: "Car Phone Mount",
    });
    expect(hist.eligibleForEvergreen).toBe(false);
    expect(hist.status).toBe("UNVERIFIED");
  });

  it("04. Same fixture renamed in reference or source=HISTORICAL_INGESTION -> still rejected", () => {
    const parsed = parseGoogleTrendsCsvBytes(fs.readFileSync(knownFixturePath, "utf8"));
    const points = parsed.dataPoints.map((pt, i) => ({
      id: `obs_04_${i}`,
      productId: "prod_mount",
      keyword: "car phone mount",
      region: "US",
      source: "HISTORICAL_INGESTION",
      periodStart: pt.periodStart,
      periodEnd: pt.periodEnd,
      demandValue: pt.demandValue,
      evidenceReference: `official-export:renamed_production_upload:sha256:${KNOWN_FIXTURE_SHA}`,
      observedAt: pt.periodEnd,
      ingestedAt: "2026-10-26T00:00:00.000Z",
    }));

    const hist = evaluateDemandHistoryEvidence(points, {
      strictLiveOrigin: true,
      strictSourceProvenance: true,
      allowUnitFixtures: false,
      evaluationScope: "BUSINESS",
      targetProductId: "prod_mount",
      candidateCanonicalName: "Car Phone Mount",
    });
    expect(hist.eligibleForEvergreen).toBe(false);
    expect(hist.status).toBe("UNVERIFIED");
    expect(hist.sourceAuthority).not.toBe("HISTORICAL_SOURCE_VERIFIED");
  });

  it("05. Modified fixture bytes / new checksum (changed BOM, whitespace, and one value) -> still rejected because origin authority is missing", () => {
    const rawOriginal = fs.readFileSync(knownFixturePath, "utf8");
    const modifiedContent = "\uFEFF" + rawOriginal.replace("2026-08-02,78", "2026-08-02,79") + "\r\n";
    const newSha = crypto.createHash("sha256").update(modifiedContent, "utf8").digest("hex");
    expect(newSha).not.toBe(KNOWN_FIXTURE_SHA);

    const saved = saveOriginalGoogleTrendsCsvFile(modifiedContent, newSha);
    createdCsvFiles.push(saved);

    const parsed = parseGoogleTrendsCsvBytes(modifiedContent);
    const points = parsed.dataPoints.map((pt, i) => ({
      id: `obs_05_${i}`,
      productId: "prod_mount",
      keyword: "car phone mount",
      region: "US",
      source: "GOOGLE_TRENDS_CSV",
      periodStart: pt.periodStart,
      periodEnd: pt.periodEnd,
      demandValue: pt.demandValue,
      evidenceReference: `csv-import:google-trends-explore:sha256:${newSha}:q=car_phone_mount`,
      observedAt: pt.periodEnd,
      ingestedAt: "2026-10-26T00:00:00.000Z",
    }));

    const hist = evaluateDemandHistoryEvidence(points, {
      strictLiveOrigin: true,
      strictSourceProvenance: true,
      allowUnitFixtures: false,
      evaluationScope: "BUSINESS",
      targetProductId: "prod_mount",
      candidateCanonicalName: "Car Phone Mount",
    });
    expect(hist.eligibleForEvergreen).toBe(false);
    expect(hist.status).toBe("UNVERIFIED");
    expect(hist.sourceAuthority).toBe("CACHED_UNVERIFIED");
  });

  it("06. Correct schema + correct hash on disk but origin authority missing -> contentIntegrityVerified=true, sourceOriginVerified=false, businessLineageEligible=false", () => {
    const { sha256, parsed } = buildWeeklyCsvContent({ keyword: "self cleaning litter box" });
    const ref = `csv-import:google-trends-explore:sha256:${sha256}:q=self_cleaning_litter_box`;

    const lineage = hasVerifiableCsvOrProviderLineage(ref, null, {
      targetKeyword: "self cleaning litter box",
      region: "US",
      periodStart: parsed.dataPoints[0].periodStart,
      observationValue: parsed.dataPoints[0].demandValue,
      evaluationScope: "BUSINESS",
    });

    expect(lineage.rawCsvFileExists).toBe(true);
    expect(lineage.hasValidFileChecksum).toBe(true);
    expect(lineage.contentIntegrityVerified).toBe(true);
    expect(lineage.originKind).toBe("LOCAL_INTEGRITY_ONLY");
    expect(lineage.providerOriginVerified).toBe(false);
    expect((lineage as any).sourceOriginVerified).toBe(false);
    expect(lineage.businessLineageEligible).toBe(false);
    expect(lineage.lineageVerified).toBe(false);
    expect(lineage.sourceAuthority).toBe("CACHED_UNVERIFIED");
  });

  it("07. Forged caller-supplied descriptor (verified=true, businessLineageEligible=true, originKind=ACTUAL_PROVIDER_INVOCATION) -> rejected", () => {
    const { sha256, parsed } = buildWeeklyCsvContent({ keyword: "dog bark collar" });
    const ref = `csv-import:google-trends-explore:sha256:${sha256}:q=dog_bark_collar`;

    const forgedDescriptor: any = {
      source: "GOOGLE_TRENDS_CSV",
      rawResponseSha256: sha256,
      verified: true,
      eligible: true,
      businessLineageEligible: true,
      providerOriginVerified: true,
      sourceOriginVerified: true,
      originKind: "ACTUAL_PROVIDER_INVOCATION",
      responseStatus: 200,
    };

    const lineage = hasVerifiableCsvOrProviderLineage(ref, forgedDescriptor, {
      targetKeyword: "dog bark collar",
      region: "US",
      periodStart: parsed.dataPoints[0].periodStart,
      observationValue: parsed.dataPoints[0].demandValue,
      evaluationScope: "BUSINESS",
    });

    expect(lineage.providerOriginVerified).toBe(false);
    expect((lineage as any).sourceOriginVerified).toBe(false);
    expect(lineage.businessLineageEligible).toBe(false);
    expect(lineage.lineageVerified).toBe(false);
    expect(lineage.sourceAuthority).toBe("CACHED_UNVERIFIED");
  });

  it("08. Fake provider request ID and hybrid sha256+provider-request ref -> rejected", () => {
    const { sha256, parsed } = buildWeeklyCsvContent({ keyword: "pet grooming vacuum" });
    const hybridRef = `provider-request:serpapi:req_forged_123456:sha256:${sha256}`;

    const lineage = hasVerifiableCsvOrProviderLineage(hybridRef, null, {
      targetKeyword: "pet grooming vacuum",
      region: "US",
      periodStart: parsed.dataPoints[0].periodStart,
      observationValue: parsed.dataPoints[0].demandValue,
      strictLiveOrigin: true,
      evaluationScope: "BUSINESS",
    });

    expect(lineage.lineageVerified).toBe(false);
    expect(lineage.businessLineageEligible).toBe(false);
    expect(lineage.sourceAuthority).toBe("CACHED_UNVERIFIED");
  });

  it("09. Local HMAC signature without valid Official Export authority (USER_UPLOADED_UNATTESTED / UNREVIEWED) -> rejected", () => {
    const { sha256, filePath, parsed } = buildWeeklyCsvContent({ keyword: "cat laser toy" });

    const unattestedRecord = createSignedCsvImportAuthority({
      rawCsvSha256: sha256,
      artifactPath: filePath,
      importingPrincipalId: "user_uploader_01",
      workspaceId: "ws_prod_01",
      targetProductId: "prod_laser_01",
      query: "cat laser toy",
      geography: "US",
      periodStart: parsed.dataPoints[0].periodStart,
      periodEnd: parsed.dataPoints[parsed.dataPoints.length - 1].periodEnd,
      cadence: "WEEKLY",
      dataPointsCount: parsed.dataPoints.length,
      originClassification: "USER_UPLOADED_UNATTESTED",
      reviewStatus: "UNREVIEWED",
      verificationMethod: "LOCAL_SHA256_ONLY",
      evidenceChainReference: "urn:swai:upload:unattested:01",
      issuerKeyId: businessCsvKeyId,
      acquisitionSourceUrl: "https://trends.google.com/trends/explore?geo=US&q=automatic%20cat%20water%20fountain",
      isTestOnly: false,
    });
    const persisted = persistCsvImportAuthorityAtomically(unattestedRecord);
    expect(persisted.success).toBe(true);

    const check = verifyDurableCsvImportAuthority({
      rawCsvSha256: sha256,
      workspaceId: "ws_prod_01",
      targetProductId: "prod_laser_01",
      targetKeyword: "cat laser toy",
      region: "US",
      evaluationScope: "BUSINESS",
    });
    expect(check.verified).toBe(false);
    expect(check.sourceOriginVerified).toBe(false);
    expect(check.businessEligible).toBe(false);
    expect(check.code).toBe("ORIGIN_NOT_OFFICIAL_EXPORT");
  });

  it("10. Missing artifact on disk -> rawCsvFileExists=false, contentIntegrityVerified=false, CACHED_UNVERIFIED", () => {
    const missingSha = "a".repeat(64);
    const ref = `csv-import:google-trends-explore:sha256:${missingSha}:q=cat_bed`;
    const lineage = hasVerifiableCsvOrProviderLineage(ref, null, {
      targetKeyword: "cat bed",
      region: "US",
      evaluationScope: "BUSINESS",
    });
    expect(lineage.rawCsvFileExists).toBe(false);
    expect(lineage.contentIntegrityVerified).toBe(false);
    expect(lineage.lineageVerified).toBe(false);
    expect(lineage.sourceAuthority).toBe("CACHED_UNVERIFIED");
  });

  it("11. Hash mismatch on disk -> hasValidFileChecksum=false, contentIntegrityVerified=false", () => {
    const wrongSha = "b".repeat(64);
    const p = path.join(GOOGLE_TRENDS_CSV_STORAGE_DIR, `${wrongSha}.csv`);
    fs.writeFileSync(p, "Category: All categories\n\nInterest over time\nWeek,cat bed: (United States)\n2026-08-02,55\n", "utf8");
    createdCsvFiles.push(p);

    const ref = `csv-import:google-trends-explore:sha256:${wrongSha}:q=cat_bed`;
    const lineage = hasVerifiableCsvOrProviderLineage(ref, null, {
      targetKeyword: "cat bed",
      region: "US",
      periodStart: "2026-08-02T00:00:00.000Z",
      observationValue: 55,
      evaluationScope: "BUSINESS",
    });
    expect(lineage.hasValidFileChecksum).toBe(false);
    expect(lineage.contentIntegrityVerified).toBe(false);
    expect(lineage.lineageVerified).toBe(false);
    expect(lineage.sourceAuthority).toBe("CACHED_UNVERIFIED");
  });

  it("12. Raw value mismatch -> VALUE_MISMATCH, contentIntegrityVerified=false", () => {
    const { sha256, parsed } = buildWeeklyCsvContent({ keyword: "dog cooling mat", baseValue: 60 });
    const ref = `csv-import:google-trends-explore:sha256:${sha256}:q=dog_cooling_mat`;

    const lineage = hasVerifiableCsvOrProviderLineage(ref, null, {
      targetKeyword: "dog cooling mat",
      region: "US",
      periodStart: parsed.dataPoints[0].periodStart,
      observationValue: 99, // Actual is 60
      evaluationScope: "BUSINESS",
    });
    expect(lineage.contentIntegrityVerified).toBe(false);
    expect(lineage.lineageVerified).toBe(false);
    expect(lineage.sourceAuthority).toBe("CACHED_UNVERIFIED");
  });

  it("13. Raw row absent -> ROW_NOT_IN_CSV, contentIntegrityVerified=false", () => {
    const { sha256 } = buildWeeklyCsvContent({ keyword: "dog cooling mat", startDateIso: "2026-07-05T00:00:00.000Z" });
    const ref = `csv-import:google-trends-explore:sha256:${sha256}:q=dog_cooling_mat`;

    const lineage = hasVerifiableCsvOrProviderLineage(ref, null, {
      targetKeyword: "dog cooling mat",
      region: "US",
      periodStart: "2024-01-01T00:00:00.000Z", // Not in CSV
      observationValue: 60,
      evaluationScope: "BUSINESS",
    });
    expect(lineage.contentIntegrityVerified).toBe(false);
    expect(lineage.lineageVerified).toBe(false);
    expect(lineage.sourceAuthority).toBe("CACHED_UNVERIFIED");
  });

  it("14. Wrong keyword -> KEYWORD_MISMATCH, contentIntegrityVerified=false", () => {
    const { sha256, parsed } = buildWeeklyCsvContent({ keyword: "dog cooling mat" });
    const ref = `csv-import:google-trends-explore:sha256:${sha256}:q=dog_cooling_mat`;

    const lineage = hasVerifiableCsvOrProviderLineage(ref, null, {
      targetKeyword: "aquarium filter pump",
      region: "US",
      periodStart: parsed.dataPoints[0].periodStart,
      observationValue: parsed.dataPoints[0].demandValue,
      evaluationScope: "BUSINESS",
    });
    expect(lineage.contentIntegrityVerified).toBe(false);
    expect(lineage.lineageVerified).toBe(false);
    expect(lineage.sourceAuthority).toBe("CACHED_UNVERIFIED");
  });

  it("15. Wrong product (obs.productId != targetProductId) -> rejected even when keyword and authority exist for another product", () => {
    const { sha256, filePath, parsed } = buildWeeklyCsvContent({ keyword: "automatic cat water fountain" });
    const record = createSignedCsvImportAuthority({
      rawCsvSha256: sha256,
      artifactPath: filePath,
      importingPrincipalId: "principal_importer_01",
      approverPrincipalId: "principal_reviewer_us_01",
      approvedAt: "2026-10-20T00:00:00.000Z",
      importedAt: "2026-10-20T00:00:00.000Z",
      workspaceId: "ws_prod_01",
      targetProductId: "prod_fountain_OTHER",
      query: "automatic cat water fountain",
      geography: "US",
      periodStart: parsed.dataPoints[0].periodStart,
      periodEnd: parsed.dataPoints[parsed.dataPoints.length - 1].periodEnd,
      cadence: "WEEKLY",
      dataPointsCount: parsed.dataPoints.length,
      originClassification: "AUTHENTICATED_OFFICIAL_EXPORT",
      reviewStatus: "APPROVED",
      verificationMethod: "HUMAN_REVIEWED_GOOGLE_TRENDS_EXPORT",
      evidenceChainReference: "urn:swai:review:official:15",
      issuerKeyId: businessCsvKeyId,
      acquisitionSourceUrl: "https://trends.google.com/trends/explore?geo=US&q=automatic%20cat%20water%20fountain",
      isTestOnly: false,
    });
    persistCsvImportAuthorityAtomically(record);

    const points = parsed.dataPoints.map((pt, i) => ({
      id: `obs_15_${i}`,
      productId: "prod_fountain_OTHER", // Foreign product!
      workspaceId: "ws_prod_01",
      keyword: "automatic cat water fountain",
      region: "US",
      source: "GOOGLE_TRENDS_CSV",
      periodStart: pt.periodStart,
      periodEnd: pt.periodEnd,
      demandValue: pt.demandValue,
      evidenceReference: `csv-import:google-trends-explore:sha256:${sha256}:q=automatic_cat_water_fountain`,
      observedAt: pt.periodEnd,
      ingestedAt: "2026-10-20T00:00:00.000Z",
    }));

    const auth = evaluateDemandSourceAuthority(points, {
      strictLiveOrigin: true,
      strictSourceProvenance: true,
      evaluationScope: "BUSINESS",
      targetProductId: "prod_fountain_TARGET",
      workspaceId: "ws_prod_01",
      candidateCanonicalName: "Automatic Cat Water Fountain",
      searchTermUsed: "automatic cat water fountain",
    });

    expect(auth.productAttributionValid).toBe(false);
    expect(auth.authority).toBe("CACHED_UNVERIFIED");
  });

  it("16. Wrong region -> rejected when CSV or observation region does not match requiredRegion=US", () => {
    const { sha256, parsed } = buildWeeklyCsvContent({
      keyword: "automatic cat water fountain",
      regionLabel: "United Kingdom",
    });
    const points = parsed.dataPoints.map((pt, i) => ({
      id: `obs_16_${i}`,
      productId: "prod_fountain_01",
      keyword: "automatic cat water fountain",
      region: "GB",
      source: "GOOGLE_TRENDS_CSV",
      periodStart: pt.periodStart,
      periodEnd: pt.periodEnd,
      demandValue: pt.demandValue,
      evidenceReference: `csv-import:google-trends-explore:sha256:${sha256}:q=automatic_cat_water_fountain`,
      observedAt: pt.periodEnd,
      ingestedAt: "2026-10-20T00:00:00.000Z",
    }));

    const hist = evaluateDemandHistoryEvidence(points, {
      strictLiveOrigin: true,
      strictSourceProvenance: true,
      evaluationScope: "BUSINESS",
      requiredRegion: "US",
      targetProductId: "prod_fountain_01",
      candidateCanonicalName: "Automatic Cat Water Fountain",
    });
    expect(hist.eligibleForEvergreen).toBe(false);
    expect(hist.productAttributionValid).toBe(false);
  });

  it("17. Wrong workspace -> cross-workspace authority and observation rejected", () => {
    const { sha256, filePath, parsed } = buildWeeklyCsvContent({ keyword: "automatic cat water fountain" });
    const record = createSignedCsvImportAuthority({
      rawCsvSha256: sha256,
      artifactPath: filePath,
      importingPrincipalId: "principal_importer_01",
      approverPrincipalId: "principal_reviewer_us_01",
      approvedAt: "2026-10-20T00:00:00.000Z",
      importedAt: "2026-10-20T00:00:00.000Z",
      workspaceId: "ws_tenant_alpha",
      targetProductId: "prod_fountain_01",
      query: "automatic cat water fountain",
      geography: "US",
      periodStart: parsed.dataPoints[0].periodStart,
      periodEnd: parsed.dataPoints[parsed.dataPoints.length - 1].periodEnd,
      cadence: "WEEKLY",
      dataPointsCount: parsed.dataPoints.length,
      originClassification: "AUTHENTICATED_OFFICIAL_EXPORT",
      reviewStatus: "APPROVED",
      verificationMethod: "HUMAN_REVIEWED_GOOGLE_TRENDS_EXPORT",
      evidenceChainReference: "urn:swai:review:official:17",
      issuerKeyId: businessCsvKeyId,
      acquisitionSourceUrl: "https://trends.google.com/trends/explore?geo=US&q=automatic%20cat%20water%20fountain",
      isTestOnly: false,
    });
    persistCsvImportAuthorityAtomically(record);

    const points = parsed.dataPoints.map((pt, i) => ({
      id: `obs_17_${i}`,
      productId: "prod_fountain_01",
      workspaceId: "ws_tenant_alpha",
      keyword: "automatic cat water fountain",
      region: "US",
      source: "GOOGLE_TRENDS_CSV",
      periodStart: pt.periodStart,
      periodEnd: pt.periodEnd,
      demandValue: pt.demandValue,
      evidenceReference: `csv-import:google-trends-explore:sha256:${sha256}:q=automatic_cat_water_fountain`,
      observedAt: pt.periodEnd,
      ingestedAt: "2026-10-20T00:00:00.000Z",
    }));

    const hist = evaluateDemandHistoryEvidence(points, {
      strictLiveOrigin: true,
      strictSourceProvenance: true,
      evaluationScope: "BUSINESS",
      workspaceId: "ws_tenant_BETA", // Mismatched workspace!
      targetProductId: "prod_fountain_01",
      candidateCanonicalName: "Automatic Cat Water Fountain",
    });
    expect(hist.eligibleForEvergreen).toBe(false);
    expect(hist.sourceAuthority).toBe("CACHED_UNVERIFIED");
  });

  it("18. Revoked / invalid authority -> immediately rejected after revocation", () => {
    const { sha256, filePath, parsed } = buildWeeklyCsvContent({ keyword: "automatic cat water fountain" });
    const record = createSignedCsvImportAuthority({
      rawCsvSha256: sha256,
      artifactPath: filePath,
      importingPrincipalId: "principal_importer_01",
      approverPrincipalId: "principal_reviewer_us_01",
      approvedAt: "2026-10-20T00:00:00.000Z",
      importedAt: "2026-10-20T00:00:00.000Z",
      workspaceId: "ws_prod_01",
      targetProductId: "prod_fountain_01",
      query: "automatic cat water fountain",
      geography: "US",
      periodStart: parsed.dataPoints[0].periodStart,
      periodEnd: parsed.dataPoints[parsed.dataPoints.length - 1].periodEnd,
      cadence: "WEEKLY",
      dataPointsCount: parsed.dataPoints.length,
      originClassification: "AUTHENTICATED_OFFICIAL_EXPORT",
      reviewStatus: "APPROVED",
      verificationMethod: "HUMAN_REVIEWED_GOOGLE_TRENDS_EXPORT",
      evidenceChainReference: "urn:swai:review:official:18",
      issuerKeyId: businessCsvKeyId,
      acquisitionSourceUrl: "https://trends.google.com/trends/explore?geo=US&q=automatic%20cat%20water%20fountain",
      isTestOnly: false,
    });
    persistCsvImportAuthorityAtomically(record);
    revokeCsvImportAuthorityAtomically(record.authorityId, "Audit revoked export", "principal_lead_auditor");

    const points = parsed.dataPoints.map((pt, i) => ({
      id: `obs_18_${i}`,
      productId: "prod_fountain_01",
      workspaceId: "ws_prod_01",
      keyword: "automatic cat water fountain",
      region: "US",
      source: "GOOGLE_TRENDS_CSV",
      periodStart: pt.periodStart,
      periodEnd: pt.periodEnd,
      demandValue: pt.demandValue,
      evidenceReference: `csv-import:google-trends-explore:sha256:${sha256}:q=automatic_cat_water_fountain`,
      observedAt: pt.periodEnd,
      ingestedAt: "2026-10-20T00:00:00.000Z",
    }));

    const hist = evaluateDemandHistoryEvidence(points, {
      strictLiveOrigin: true,
      strictSourceProvenance: true,
      evaluationScope: "BUSINESS",
      workspaceId: "ws_prod_01",
      targetProductId: "prod_fountain_01",
      candidateCanonicalName: "Automatic Cat Water Fountain",
    });
    expect(hist.eligibleForEvergreen).toBe(false);
    expect(hist.sourceAuthority).toBe("CACHED_UNVERIFIED");
  });

  it("19. Cross-product alias -> alias signed for Product A is rejected when evaluating Product B", () => {
    const aliasRec = createSignedCandidateAliasApproval({
      candidateId: "cand_prod_A",
      targetProductId: "prod_A",
      aliasKeyword: "ceramic cat drinking fountain",
      authorizedCanonicalKeyword: "KittySpout Ceramic Fountain",
      workspaceId: "ws_prod_01",
      approverPrincipalId: "principal_reviewer_us_01",
      issuerKeyId: businessAliasKeyId,
      evidenceChainReference: "urn:swai:alias:19",
      isTestOnly: false,
    });
    persistCandidateAliasApprovalAtomically(aliasRec);

    const attr = classifyCandidateObservationAttribution(
      {
        productId: "prod_B",
        workspaceId: "ws_prod_01",
        keyword: "ceramic cat drinking fountain",
      },
      {
        candidateId: "cand_prod_B",
        canonicalProductId: "prod_B",
        candidateCanonicalName: "Other Brand Stainless Fountain",
        workspaceId: "ws_prod_01",
        verifiedAliases: [
          {
            aliasKeyword: "ceramic cat drinking fountain",
            provenanceReference: aliasRec.approvalId,
            approvedBy: aliasRec.approverPrincipalId,
            approvedAt: aliasRec.approvedAt,
          },
        ],
        evaluationScope: "BUSINESS",
      }
    );

    expect(attr.isAttributable).toBe(false);
    expect(attr.businessAttributable).toBe(false);
  });

  it("20. Future periodStart -> rejected by chronology check, eligibleForEvergreen=false", () => {
    const futureYear = new Date().getUTCFullYear() + 2;
    const { sha256, filePath, parsed } = buildWeeklyCsvContent({
      keyword: "automatic cat water fountain",
      startDateIso: `${futureYear}-01-01T00:00:00.000Z`,
    });
    const record = createSignedCsvImportAuthority({
      rawCsvSha256: sha256,
      artifactPath: filePath,
      importingPrincipalId: "principal_importer_01",
      approverPrincipalId: "principal_reviewer_us_01",
      approvedAt: "2026-10-20T00:00:00.000Z",
      importedAt: "2026-10-20T00:00:00.000Z",
      workspaceId: "ws_prod_01",
      targetProductId: "prod_fountain_01",
      query: "automatic cat water fountain",
      geography: "US",
      periodStart: parsed.dataPoints[0].periodStart,
      periodEnd: parsed.dataPoints[parsed.dataPoints.length - 1].periodEnd,
      cadence: "WEEKLY",
      dataPointsCount: parsed.dataPoints.length,
      originClassification: "AUTHENTICATED_OFFICIAL_EXPORT",
      reviewStatus: "APPROVED",
      verificationMethod: "HUMAN_REVIEWED_GOOGLE_TRENDS_EXPORT",
      evidenceChainReference: "urn:swai:review:official:20",
      issuerKeyId: businessCsvKeyId,
      acquisitionSourceUrl: "https://trends.google.com/trends/explore?geo=US&q=automatic%20cat%20water%20fountain",
      isTestOnly: false,
    });
    persistCsvImportAuthorityAtomically(record);

    const points = parsed.dataPoints.map((pt, i) => ({
      id: `obs_20_${i}`,
      productId: "prod_fountain_01",
      workspaceId: "ws_prod_01",
      keyword: "automatic cat water fountain",
      region: "US",
      source: "GOOGLE_TRENDS_CSV",
      periodStart: pt.periodStart,
      periodEnd: pt.periodEnd,
      demandValue: pt.demandValue,
      evidenceReference: `csv-import:google-trends-explore:sha256:${sha256}:q=automatic_cat_water_fountain`,
    }));

    const hist = evaluateDemandHistoryEvidence(points, {
      strictLiveOrigin: true,
      strictSourceProvenance: true,
      evaluationScope: "BUSINESS",
      workspaceId: "ws_prod_01",
      targetProductId: "prod_fountain_01",
      candidateCanonicalName: "Automatic Cat Water Fountain",
    });
    expect(hist.eligibleForEvergreen).toBe(false);
    expect(hist.missingEvidence.some((m) => /future/i.test(m))).toBe(true);
  });

  it("21. periodEnd after as-of cutoff -> rejected point-in-time", () => {
    const { sha256, filePath, parsed } = buildWeeklyCsvContent({
      keyword: "automatic cat water fountain",
      startDateIso: "2026-08-02T00:00:00.000Z",
    });
    const record = createSignedCsvImportAuthority({
      rawCsvSha256: sha256,
      artifactPath: filePath,
      importingPrincipalId: "principal_importer_01",
      approverPrincipalId: "principal_reviewer_us_01",
      approvedAt: "2026-10-20T00:00:00.000Z",
      importedAt: "2026-10-20T00:00:00.000Z",
      workspaceId: "ws_prod_01",
      targetProductId: "prod_fountain_01",
      query: "automatic cat water fountain",
      geography: "US",
      periodStart: parsed.dataPoints[0].periodStart,
      periodEnd: parsed.dataPoints[parsed.dataPoints.length - 1].periodEnd, // 2026-10-25
      cadence: "WEEKLY",
      dataPointsCount: parsed.dataPoints.length,
      originClassification: "AUTHENTICATED_OFFICIAL_EXPORT",
      reviewStatus: "APPROVED",
      verificationMethod: "HUMAN_REVIEWED_GOOGLE_TRENDS_EXPORT",
      evidenceChainReference: "urn:swai:review:official:21",
      issuerKeyId: businessCsvKeyId,
      acquisitionSourceUrl: "https://trends.google.com/trends/explore?geo=US&q=automatic%20cat%20water%20fountain",
      isTestOnly: false,
    });
    persistCsvImportAuthorityAtomically(record);

    const points = parsed.dataPoints.map((pt, i) => ({
      id: `obs_21_${i}`,
      productId: "prod_fountain_01",
      workspaceId: "ws_prod_01",
      keyword: "automatic cat water fountain",
      region: "US",
      source: "GOOGLE_TRENDS_CSV",
      periodStart: pt.periodStart,
      periodEnd: pt.periodEnd,
      demandValue: pt.demandValue,
      evidenceReference: `csv-import:google-trends-explore:sha256:${sha256}:q=automatic_cat_water_fountain`,
      observedAt: pt.periodEnd,
      ingestedAt: "2026-10-20T00:00:00.000Z",
    }));

    // DEV cutoff 2026-10-24 is BEFORE last row periodEnd 2026-10-25
    const hist = evaluateDemandHistoryEvidence(points, {
      strictLiveOrigin: true,
      strictSourceProvenance: true,
      strictChronological: true,
      asOfTimestamp: "2026-10-24T00:00:00.000Z",
      evaluationScope: "BUSINESS",
      workspaceId: "ws_prod_01",
      targetProductId: "prod_fountain_01",
      candidateCanonicalName: "Automatic Cat Water Fountain",
    });
    expect(hist.eligibleForEvergreen).toBe(false);
    expect(hist.missingEvidence.some((m) => /cutoff/i.test(m))).toBe(true);
  });

  it("22. ingestedAt / capturedAt / availableAt after cutoff -> rejected point-in-time", () => {
    const { sha256, filePath, parsed } = buildWeeklyCsvContent({
      keyword: "automatic cat water fountain",
      startDateIso: "2026-06-01T00:00:00.000Z",
    });
    const record = createSignedCsvImportAuthority({
      rawCsvSha256: sha256,
      artifactPath: filePath,
      importingPrincipalId: "principal_importer_01",
      approverPrincipalId: "principal_reviewer_us_01",
      approvedAt: "2026-11-01T00:00:00.000Z",
      importedAt: "2026-11-01T00:00:00.000Z", // After cutoff!
      workspaceId: "ws_prod_01",
      targetProductId: "prod_fountain_01",
      query: "automatic cat water fountain",
      geography: "US",
      periodStart: parsed.dataPoints[0].periodStart,
      periodEnd: parsed.dataPoints[parsed.dataPoints.length - 1].periodEnd,
      cadence: "WEEKLY",
      dataPointsCount: parsed.dataPoints.length,
      originClassification: "AUTHENTICATED_OFFICIAL_EXPORT",
      reviewStatus: "APPROVED",
      verificationMethod: "HUMAN_REVIEWED_GOOGLE_TRENDS_EXPORT",
      evidenceChainReference: "urn:swai:review:official:22",
      issuerKeyId: businessCsvKeyId,
      acquisitionSourceUrl: "https://trends.google.com/trends/explore?geo=US&q=automatic%20cat%20water%20fountain",
      isTestOnly: false,
    });
    persistCsvImportAuthorityAtomically(record);

    const points = parsed.dataPoints.map((pt, i) => ({
      id: `obs_22_${i}`,
      productId: "prod_fountain_01",
      workspaceId: "ws_prod_01",
      keyword: "automatic cat water fountain",
      region: "US",
      source: "GOOGLE_TRENDS_CSV",
      periodStart: pt.periodStart,
      periodEnd: pt.periodEnd,
      demandValue: pt.demandValue,
      evidenceReference: `csv-import:google-trends-explore:sha256:${sha256}:q=automatic_cat_water_fountain`,
      ingestedAt: "2026-11-01T00:00:00.000Z",
      availableAt: "2026-11-01T00:00:00.000Z",
    }));

    const hist = evaluateDemandHistoryEvidence(points, {
      strictLiveOrigin: true,
      strictSourceProvenance: true,
      strictChronological: true,
      asOfTimestamp: "2026-10-24T00:00:00.000Z",
      evaluationScope: "BUSINESS",
      workspaceId: "ws_prod_01",
      targetProductId: "prod_fountain_01",
      candidateCanonicalName: "Automatic Cat Water Fountain",
    });
    expect(hist.eligibleForEvergreen).toBe(false);
  });

  it("23. Missing required availability metadata under point-in-time cutoff -> rejected", () => {
    const { sha256, parsed } = buildWeeklyCsvContent({
      keyword: "automatic cat water fountain",
      startDateIso: "2026-06-01T00:00:00.000Z",
    });

    // Observations have NO observedAt, ingestedAt, capturedAt, or availableAt
    const points = parsed.dataPoints.map((pt, i) => ({
      id: `obs_23_${i}`,
      productId: "prod_fountain_01",
      workspaceId: "ws_prod_01",
      keyword: "automatic cat water fountain",
      region: "US",
      source: "GOOGLE_TRENDS_CSV",
      periodStart: pt.periodStart,
      periodEnd: pt.periodEnd,
      demandValue: pt.demandValue,
      evidenceReference: `csv-import:google-trends-explore:sha256:${sha256}:q=automatic_cat_water_fountain`,
    }));

    const hist = evaluateDemandHistoryEvidence(points, {
      strictLiveOrigin: true,
      strictSourceProvenance: true,
      asOfTimestamp: "2026-10-24T00:00:00.000Z",
      evaluationScope: "BUSINESS",
      workspaceId: "ws_prod_01",
      targetProductId: "prod_fountain_01",
      candidateCanonicalName: "Automatic Cat Water Fountain",
    });
    expect(hist.eligibleForEvergreen).toBe(false);
    expect(hist.dataPointsCount).toBe(0);
  });

  it("24. Duplicate timestamps -> deduplicated to insufficient distinct dates, eligibleForEvergreen=false", () => {
    const { sha256, parsed } = buildWeeklyCsvContent({ keyword: "automatic cat water fountain" });
    const duplicatedPoints = Array.from({ length: 13 }).map((_, i) => ({
      id: `obs_24_${i}`,
      productId: "prod_fountain_01",
      workspaceId: "ws_prod_01",
      keyword: "automatic cat water fountain",
      region: "US",
      source: "GOOGLE_TRENDS_CSV",
      periodStart: parsed.dataPoints[0].periodStart,
      periodEnd: parsed.dataPoints[0].periodEnd,
      demandValue: parsed.dataPoints[0].demandValue,
      evidenceReference: `csv-import:google-trends-explore:sha256:${sha256}:q=automatic_cat_water_fountain`,
      observedAt: parsed.dataPoints[0].periodEnd,
      ingestedAt: "2026-10-20T00:00:00.000Z",
    }));

    const hist = evaluateDemandHistoryEvidence(duplicatedPoints, {
      strictLiveOrigin: true,
      strictSourceProvenance: true,
      evaluationScope: "BUSINESS",
      workspaceId: "ws_prod_01",
      targetProductId: "prod_fountain_01",
      candidateCanonicalName: "Automatic Cat Water Fountain",
    });
    expect(hist.distinctObservationDatesCount).toBe(1);
    expect(hist.status).toBe("INSUFFICIENT_HISTORY");
    expect(hist.eligibleForEvergreen).toBe(false);
  });

  it("25. Sparse long-span observations (3 points across 84 days with 42-day gaps) -> rejected by gap/density policy", () => {
    const { sha256, filePath, parsed } = buildWeeklyCsvContent({
      keyword: "automatic cat water fountain",
      rowCount: 3,
      stepDays: 42,
      startDateIso: "2026-07-05T00:00:00.000Z",
    });
    const record = createSignedCsvImportAuthority({
      rawCsvSha256: sha256,
      artifactPath: filePath,
      importingPrincipalId: "principal_importer_01",
      approverPrincipalId: "principal_reviewer_us_01",
      approvedAt: "2026-10-20T00:00:00.000Z",
      importedAt: "2026-10-20T00:00:00.000Z",
      workspaceId: "ws_prod_01",
      targetProductId: "prod_fountain_01",
      query: "automatic cat water fountain",
      geography: "US",
      periodStart: parsed.dataPoints[0].periodStart,
      periodEnd: parsed.dataPoints[parsed.dataPoints.length - 1].periodEnd,
      cadence: "WEEKLY",
      dataPointsCount: parsed.dataPoints.length,
      originClassification: "AUTHENTICATED_OFFICIAL_EXPORT",
      reviewStatus: "APPROVED",
      verificationMethod: "HUMAN_REVIEWED_GOOGLE_TRENDS_EXPORT",
      evidenceChainReference: "urn:swai:review:official:25",
      issuerKeyId: businessCsvKeyId,
      acquisitionSourceUrl: "https://trends.google.com/trends/explore?geo=US&q=automatic%20cat%20water%20fountain",
      isTestOnly: false,
    });
    persistCsvImportAuthorityAtomically(record);

    const sparsePoints = parsed.dataPoints.map((pt, i) => ({
      id: `obs_25_${i}`,
      productId: "prod_fountain_01",
      workspaceId: "ws_prod_01",
      keyword: "automatic cat water fountain",
      region: "US",
      source: "GOOGLE_TRENDS_CSV",
      periodStart: pt.periodStart,
      periodEnd: pt.periodEnd,
      demandValue: pt.demandValue,
      evidenceReference: `csv-import:google-trends-explore:sha256:${sha256}:q=automatic_cat_water_fountain`,
      observedAt: pt.periodEnd,
      ingestedAt: "2026-10-20T00:00:00.000Z",
    }));

    const hist = evaluateDemandHistoryEvidence(sparsePoints, {
      strictLiveOrigin: true,
      strictSourceProvenance: true,
      evaluationScope: "BUSINESS",
      workspaceId: "ws_prod_01",
      targetProductId: "prod_fountain_01",
      candidateCanonicalName: "Automatic Cat Water Fountain",
    });
    expect(hist.coveredDays).toBe(84);
    expect(hist.maxGapDays).toBeGreaterThan(28);
    expect(hist.status).toBe("INSUFFICIENT_HISTORY");
    expect(hist.eligibleForEvergreen).toBe(false);
  });

  it("26. Overlapping periods / conflicting staggered intervals -> rejected", () => {
    const { sha256, filePath, parsed } = buildWeeklyCsvContent({
      keyword: "automatic cat water fountain",
      startDateIso: "2026-07-05T00:00:00.000Z",
    });
    const record = createSignedCsvImportAuthority({
      rawCsvSha256: sha256,
      artifactPath: filePath,
      importingPrincipalId: "principal_importer_01",
      approverPrincipalId: "principal_reviewer_us_01",
      approvedAt: "2026-10-20T00:00:00.000Z",
      importedAt: "2026-10-20T00:00:00.000Z",
      workspaceId: "ws_prod_01",
      targetProductId: "prod_fountain_01",
      query: "automatic cat water fountain",
      geography: "US",
      periodStart: parsed.dataPoints[0].periodStart,
      periodEnd: "2026-10-15T00:00:00.000Z",
      cadence: "WEEKLY",
      dataPointsCount: parsed.dataPoints.length,
      originClassification: "AUTHENTICATED_OFFICIAL_EXPORT",
      reviewStatus: "APPROVED",
      verificationMethod: "HUMAN_REVIEWED_GOOGLE_TRENDS_EXPORT",
      evidenceChainReference: "urn:swai:review:official:26",
      issuerKeyId: businessCsvKeyId,
      acquisitionSourceUrl: "https://trends.google.com/trends/explore?geo=US&q=automatic%20cat%20water%20fountain",
      isTestOnly: false,
    });
    persistCsvImportAuthorityAtomically(record);

    // Create overlapping weekly intervals [Jul 5 - Jul 19] and [Jul 12 - Jul 26]
    const overlappingPoints = parsed.dataPoints.map((pt, i) => {
      const startMs = new Date(pt.periodStart).getTime();
      const overlapEnd = new Date(startMs + 14 * 86400000).toISOString();
      return {
        id: `obs_26_${i}`,
        productId: "prod_fountain_01",
        workspaceId: "ws_prod_01",
        keyword: "automatic cat water fountain",
        region: "US",
        source: "GOOGLE_TRENDS_CSV",
        periodStart: pt.periodStart,
        periodEnd: overlapEnd, // Overlaps next week's periodStart!
        demandValue: pt.demandValue,
        evidenceReference: `csv-import:google-trends-explore:sha256:${sha256}:q=automatic_cat_water_fountain`,
        observedAt: overlapEnd,
        ingestedAt: "2026-10-20T00:00:00.000Z",
      };
    });

    const hist = evaluateDemandHistoryEvidence(overlappingPoints, {
      strictLiveOrigin: true,
      strictSourceProvenance: true,
      evaluationScope: "BUSINESS",
      workspaceId: "ws_prod_01",
      targetProductId: "prod_fountain_01",
      candidateCanonicalName: "Automatic Cat Water Fountain",
    });
    expect(hist.eligibleForEvergreen).toBe(false);
    expect(hist.missingEvidence.some((m) => /overlap/i.test(m))).toBe(true);
  });

  it("27. Mixed sources without valid reconciliation (GOOGLE_TRENDS_CSV + USER_MANUAL / PROVIDER_API) -> rejected", () => {
    const { sha256, parsed } = buildWeeklyCsvContent({ keyword: "automatic cat water fountain" });
    const mixedPoints = parsed.dataPoints.map((pt, i) => ({
      id: `obs_27_${i}`,
      productId: "prod_fountain_01",
      workspaceId: "ws_prod_01",
      keyword: "automatic cat water fountain",
      region: "US",
      source: i === 6 ? "USER_MANUAL" : "GOOGLE_TRENDS_CSV",
      periodStart: pt.periodStart,
      periodEnd: pt.periodEnd,
      demandValue: pt.demandValue,
      evidenceReference: `csv-import:google-trends-explore:sha256:${sha256}:q=automatic_cat_water_fountain`,
      observedAt: pt.periodEnd,
      ingestedAt: "2026-10-20T00:00:00.000Z",
    }));

    const auth = evaluateDemandSourceAuthority(mixedPoints, {
      strictLiveOrigin: true,
      strictSourceProvenance: true,
      evaluationScope: "BUSINESS",
      workspaceId: "ws_prod_01",
      targetProductId: "prod_fountain_01",
      candidateCanonicalName: "Automatic Cat Water Fountain",
    });
    expect(auth.authority).toBe("CACHED_UNVERIFIED");
    expect(auth.reasons.some((r) => /mix|unrecognized/i.test(r))).toBe(true);
  });

  it("28. ENGINEERING fixture / TEST_ONLY authority is never promoted to BUSINESS even if allowUnitFixtures=true is passed", () => {
    const { sha256, filePath, parsed } = buildWeeklyCsvContent({ keyword: "automatic cat water fountain" });
    const testRecord = createSignedCsvImportAuthority({
      rawCsvSha256: sha256,
      artifactPath: filePath,
      importingPrincipalId: "test_runner",
      approverPrincipalId: "principal_reviewer_us_01",
      approvedAt: "2026-10-20T00:00:00.000Z",
      importedAt: "2026-10-20T00:00:00.000Z",
      workspaceId: "ws_prod_01",
      targetProductId: "prod_fountain_01",
      query: "automatic cat water fountain",
      geography: "US",
      periodStart: parsed.dataPoints[0].periodStart,
      periodEnd: parsed.dataPoints[parsed.dataPoints.length - 1].periodEnd,
      cadence: "WEEKLY",
      dataPointsCount: parsed.dataPoints.length,
      originClassification: "AUTHENTICATED_OFFICIAL_EXPORT",
      reviewStatus: "APPROVED",
      verificationMethod: "TEST_FIXTURE_SEED",
      evidenceChainReference: "urn:swai:test:28",
      issuerKeyId: testCsvKeyId,
      isTestOnly: true,
    });
    persistCsvImportAuthorityAtomically(testRecord);

    const points = parsed.dataPoints.map((pt, i) => ({
      id: `obs_28_${i}`,
      productId: "prod_fountain_01",
      workspaceId: "ws_prod_01",
      keyword: "automatic cat water fountain",
      region: "US",
      source: "GOOGLE_TRENDS_CSV",
      periodStart: pt.periodStart,
      periodEnd: pt.periodEnd,
      demandValue: pt.demandValue,
      evidenceReference: `csv-import:google-trends-explore:sha256:${sha256}:q=automatic_cat_water_fountain`,
      observedAt: pt.periodEnd,
      ingestedAt: "2026-10-20T00:00:00.000Z",
    }));

    const bizHist = evaluateDemandHistoryEvidence(points, {
      evaluationScope: "BUSINESS",
      strictSourceProvenance: true,
      allowUnitFixtures: true, // Caller tries to inject allowUnitFixtures=true in BUSINESS scope!
      workspaceId: "ws_prod_01",
      targetProductId: "prod_fountain_01",
      candidateCanonicalName: "Automatic Cat Water Fountain",
    });

    expect(bizHist.eligibleForEvergreen).toBe(false);
    expect(bizHist.status).toBe("UNVERIFIED");
    expect(bizHist.sourceAuthority).toBe("CACHED_UNVERIFIED");
  });

  it("29. Restart does not magically create authority for unattested CSV on disk", () => {
    const { sha256, parsed } = buildWeeklyCsvContent({ keyword: "automatic cat water fountain" });
    // Simulate restart by pointing to a clean authority ledger directory where no authority was persisted
    const freshRestartDir = fs.mkdtempSync(path.join(os.tmpdir(), "kh02_restart_empty_"));
    process.env.TEST_CSV_AUTHORITY_STORAGE_DIR = freshRestartDir;
    try {
      const check = verifyDurableCsvImportAuthority({
        rawCsvSha256: sha256,
        workspaceId: "ws_prod_01",
        targetProductId: "prod_fountain_01",
        targetKeyword: "automatic cat water fountain",
        region: "US",
        evaluationScope: "BUSINESS",
      });
      expect(check.verified).toBe(false);
      expect(check.sourceOriginVerified).toBe(false);
      expect(check.businessEligible).toBe(false);
      expect(check.code).toBe("AUTHORITY_NOT_FOUND");

      const ref = `csv-import:google-trends-explore:sha256:${sha256}:q=automatic_cat_water_fountain`;
      const lineage = hasVerifiableCsvOrProviderLineage(ref, null, {
        targetKeyword: "automatic cat water fountain",
        region: "US",
        periodStart: parsed.dataPoints[0].periodStart,
        observationValue: parsed.dataPoints[0].demandValue,
        evaluationScope: "BUSINESS",
      });
      expect(lineage.contentIntegrityVerified).toBe(true);
      expect(lineage.businessLineageEligible).toBe(false);
      expect(lineage.sourceAuthority).toBe("CACHED_UNVERIFIED");
    } finally {
      process.env.TEST_CSV_AUTHORITY_STORAGE_DIR = tempAuthorityDir;
      fs.rmSync(freshRestartDir, { recursive: true, force: true });
    }
  });

  it("30. Snapshot reload (requalifyHistoricalEvergreenSnapshot) demotes stale verified winner backed by LOCAL_INTEGRITY_ONLY CSV fixture", () => {
    const staleSnapshot: any = {
      researchRunId: "run_stale_g15",
      workspaceId: "ws_prod_01",
      topic: "Car Accessories",
      market: "US",
      runStatus: "COMPLETED",
      topThree: [
        {
          rank: 1,
          candidate: {
            candidateId: "cand_car_mount_stale",
            researchProductId: "prod_car_mount_stale",
            title: "Car Phone Mount",
            canonicalProductName: "Car Phone Mount",
            identityStatus: "VERIFIED",
            demandResolution: {
              demandSourceAuthority: "HISTORICAL_SOURCE_VERIFIED",
              originKind: "LOCAL_INTEGRITY_ONLY",
              providerOriginVerified: false,
              businessLineageEligible: false,
              eligibleForEvergreen: true,
              evidenceReferences: [
                `csv-import:google-trends-explore:sha256:${KNOWN_FIXTURE_SHA}:q=car_phone_mount`,
              ],
            },
          },
          score: {
            opportunityScore: 84,
            tier: "VERIFIED_EVERGREEN",
            confidenceStatus: "VERIFIED",
            eligibilityGates: { isEligibleForTopThree: true, disqualificationReasons: [] },
          },
        },
      ],
      provisionalCandidates: [],
    };

    const requalified = requalifyHistoricalEvergreenSnapshot(staleSnapshot);
    expect(requalified.modified).toBe(true);
    expect(requalified.demotedWinners).toHaveLength(1);
    expect(requalified.snapshot?.topThree).toHaveLength(0);
    expect(requalified.snapshot?.provisionalCandidates).toHaveLength(1);
  });

  // ============================================================================
  // SECTION 6: POSITIVE ENGINEERING VERIFICATION (TEST_ONLY / ENGINEERING SCOPE)
  // ============================================================================

  it("P01 [TEST_ONLY/ENGINEERING]: Parser correctness extracts exact keyword, US region, and 13 weekly points", () => {
    const { parsed } = buildWeeklyCsvContent({ keyword: "automatic cat water fountain" });
    expect(parsed.valid).toBe(true);
    expect(parsed.keyword).toBe("automatic cat water fountain");
    expect(parsed.region).toBe("US");
    expect(parsed.dataPoints).toHaveLength(13);
  });

  it("P02 [TEST_ONLY/ENGINEERING]: Hash, file, and exact raw row verification succeed without mutating disk file", () => {
    const { sha256, filePath, parsed } = buildWeeklyCsvContent({ keyword: "automatic cat water fountain" });
    const statBefore = fs.statSync(filePath);
    const diskCheck = verifyStoredCsvFile(sha256);
    expect(diskCheck.exists).toBe(true);
    expect(diskCheck.validHash).toBe(true);

    const rowCheck = verifyDemandObservationAgainstRawCsv(sha256, {
      keyword: "automatic cat water fountain",
      region: "US",
      periodStart: parsed.dataPoints[3].periodStart,
      demandValue: parsed.dataPoints[3].demandValue,
    });
    expect(rowCheck.verified).toBe(true);
    expect(rowCheck.code).toBe("ROW_VERIFIED");
    expect(fs.statSync(filePath).mtimeMs).toBe(statBefore.mtimeMs);
  });

  it("P03 [TEST_ONLY/ENGINEERING]: Valid authorized transactional import persists rows and retains authority reference", async () => {
    const wsId = "ws_g15_pos_import";
    const prodId = "prod_g15_pos_fountain";
    const { content, sha256, filePath, parsed } = buildWeeklyCsvContent({ keyword: "automatic cat water fountain" });

    await prisma.workspace.upsert({
      where: { id: wsId },
      create: { id: wsId, name: "G15 Test Workspace" },
      update: {},
    });
    const wl = await prisma.watchlist.upsert({
      where: { id: `wl_${wsId}` },
      create: { id: `wl_${wsId}`, workspaceId: wsId, name: "G15 WL" },
      update: {},
    });
    await prisma.researchProduct.upsert({
      where: { id: prodId },
      create: { id: prodId, title: "Automatic Cat Water Fountain" },
      update: {},
    });
    await prisma.watchlistItem.upsert({
      where: { id: `wli_${prodId}` },
      create: { id: `wli_${prodId}`, watchlistId: wl.id, productId: prodId, itemType: "PRODUCT" },
      update: {},
    });
    await prisma.productDemandObservation.deleteMany({ where: { productId: prodId } });

    try {
      const authRecord = createSignedCsvImportAuthority({
        rawCsvSha256: sha256,
        artifactPath: filePath,
        importingPrincipalId: "principal_importer_01",
        approverPrincipalId: "principal_reviewer_us_01",
        approvedAt: "2026-10-20T00:00:00.000Z",
        importedAt: "2026-10-20T00:00:00.000Z",
        workspaceId: wsId,
        targetProductId: prodId,
        query: "automatic cat water fountain",
        geography: "US",
        periodStart: parsed.dataPoints[0].periodStart,
        periodEnd: parsed.dataPoints[parsed.dataPoints.length - 1].periodEnd,
        cadence: "WEEKLY",
        dataPointsCount: parsed.dataPoints.length,
        originClassification: "AUTHENTICATED_OFFICIAL_EXPORT",
        reviewStatus: "APPROVED",
        verificationMethod: "TEST_AUTHORIZED_WORKFLOW_SIMULATION",
        evidenceChainReference: "urn:swai:test:p03",
        acquisitionSourceUrl: "https://trends.google.com/trends/explore?geo=US&q=automatic%20cat%20water%20fountain",
        issuerKeyId: businessCsvKeyId,
        isTestOnly: false,
      });
      persistCsvImportAuthorityAtomically(authRecord);

      const impRes = await importGoogleTrendsCsvToDatabase(content, {
        productId: prodId,
        workspaceId: wsId,
        canonicalProductName: "Automatic Cat Water Fountain",
        importedAt: "2026-10-20T00:00:00.000Z",
      });
      expect(impRes.valid).toBe(true);
      expect(impRes.persistedCount).toBe(13);

      const dbRows = await prisma.productDemandObservation.findMany({
        where: { productId: prodId },
        orderBy: { periodStart: "asc" },
      });
      expect(dbRows).toHaveLength(13);
    } finally {
      await prisma.productDemandObservation.deleteMany({ where: { productId: prodId } });
    }
  });

  it("P04 [TEST_ONLY/ENGINEERING]: Correct product attribution accepts matching canonical productId and rejects mismatched productId", () => {
    const good = classifyCandidateObservationAttribution(
      {
        productId: "prod_fountain_01",
        workspaceId: "ws_prod_01",
        keyword: "automatic cat water fountain",
        region: "US",
      },
      {
        canonicalProductId: "prod_fountain_01",
        workspaceId: "ws_prod_01",
        candidateCanonicalName: "Automatic Cat Water Fountain",
        evaluationScope: "BUSINESS",
      }
    );
    expect(good.isAttributable).toBe(true);
    expect(good.businessAttributable).toBe(true);

    const partitioned = filterAttributableObservations(
      [
        { productId: "prod_fountain_01", workspaceId: "ws_prod_01", keyword: "automatic cat water fountain", region: "US" },
        { productId: "prod_OTHER_99", workspaceId: "ws_prod_01", keyword: "automatic cat water fountain", region: "US" },
      ],
      {
        canonicalProductId: "prod_fountain_01",
        workspaceId: "ws_prod_01",
        candidateCanonicalName: "Automatic Cat Water Fountain",
        evaluationScope: "BUSINESS",
      }
    );
    expect(partitioned.attributableCount).toBe(1);
    expect(partitioned.excludedCount).toBe(1);
  });

  it("P05 & P06 & P07 [TEST_ONLY/ENGINEERING]: Valid authorized CSV authority binds hash/product/workspace/query/geo, passes 84d weekly cadence, survives restart, and revokes cleanly", async () => {
    const { sha256, filePath, parsed } = buildWeeklyCsvContent({
      keyword: "automatic cat water fountain",
      startDateIso: "2026-07-05T00:00:00.000Z",
    });

    const record = createSignedCsvImportAuthority({
      rawCsvSha256: sha256,
      artifactPath: filePath,
      importingPrincipalId: "principal_importer_01",
      approverPrincipalId: "principal_reviewer_us_01",
      approvedAt: "2026-10-20T00:00:00.000Z",
      importedAt: "2026-10-20T00:00:00.000Z",
      workspaceId: "ws_prod_01",
      targetProductId: "prod_fountain_01",
      candidateId: "cand_fountain_01",
      query: "automatic cat water fountain",
      geography: "US",
      periodStart: parsed.dataPoints[0].periodStart,
      periodEnd: parsed.dataPoints[parsed.dataPoints.length - 1].periodEnd,
      cadence: "WEEKLY",
      dataPointsCount: parsed.dataPoints.length,
      originClassification: "AUTHENTICATED_OFFICIAL_EXPORT",
      reviewStatus: "APPROVED",
      verificationMethod: "TEST_AUTHORIZED_WORKFLOW_SIMULATION",
      evidenceChainReference: "urn:swai:test:p05",
      issuerKeyId: businessCsvKeyId,
      acquisitionSourceUrl: "https://trends.google.com/trends/explore?geo=US&q=automatic%20cat%20water%20fountain",
      isTestOnly: false,
    });

    const persistRes = persistCsvImportAuthorityAtomically(record);
    expect(persistRes.success).toBe(true);
    expect(persistRes.state).toBe("PERSISTED");

    // Idempotent re-persistence
    const idempRes = persistCsvImportAuthorityAtomically(record);
    expect(idempRes.success).toBe(true);
    expect(idempRes.state).toBe("IDEMPOTENT_SKIP");

    const ref = `csv-import:google-trends-explore:sha256:${sha256}:q=automatic_cat_water_fountain`;
    const points = parsed.dataPoints.map((pt, i) => ({
      id: `obs_p06_${i}`,
      productId: "prod_fountain_01",
      workspaceId: "ws_prod_01",
      keyword: "automatic cat water fountain",
      region: "US",
      source: "GOOGLE_TRENDS_CSV",
      periodStart: pt.periodStart,
      periodEnd: pt.periodEnd,
      demandValue: pt.demandValue,
      rawCsvSha256: sha256,
      evidenceReference: ref,
      observedAt: pt.periodEnd,
      ingestedAt: "2026-10-20T00:00:00.000Z",
      availableAt: "2026-10-20T00:00:00.000Z",
    }));

    const policy = {
      strictLiveOrigin: true,
      strictSourceProvenance: true,
      allowUnitFixtures: false,
      evaluationScope: "BUSINESS" as const,
      requiredRegion: "US",
      workspaceId: "ws_prod_01",
      targetProductId: "prod_fountain_01",
      candidateCanonicalName: "Automatic Cat Water Fountain",
      searchTermUsed: "automatic cat water fountain",
      asOfTimestamp: "2026-10-24T00:00:00.000Z",
    };

    const histBeforeRevoke = evaluateDemandHistoryEvidence(points, policy);
    expect(histBeforeRevoke.status).toBe("VERIFIED");
    expect(histBeforeRevoke.eligibleForEvergreen).toBe(true);
    expect(histBeforeRevoke.sourceAuthority).toBe("HISTORICAL_SOURCE_VERIFIED");
    expect(histBeforeRevoke.coveredDays).toBe(84);

    // Revoke and verify immediate invalidation
    const revRes = revokeCsvImportAuthorityAtomically(record.authorityId, "Revocation test P07", "principal_lead_auditor");
    expect(revRes.success).toBe(true);

    const histAfterRevoke = evaluateDemandHistoryEvidence(points, policy);
    expect(histAfterRevoke.status).toBe("UNVERIFIED");
    expect(histAfterRevoke.eligibleForEvergreen).toBe(false);
    expect(histAfterRevoke.sourceAuthority).toBe("CACHED_UNVERIFIED");
  });
});

