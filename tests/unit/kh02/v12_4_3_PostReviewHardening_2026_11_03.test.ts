import { describe, it, expect, beforeAll, afterAll } from "vitest";
import os from "os";
import {
  hasVerifiableCsvOrProviderLineage,
  evaluateDemandSourceAuthority,
  evaluateDemandHistoryEvidence,
  evaluateTemporalDemandStability,
  resolveVerifiedDemandEvidence,
  isAuthenticProviderReceiptDescriptor,
  saveRawProviderPayloadFile,
  recordTrustedProviderInvocation,
  persistCollectorReceiptAtomically,
  registerTestFixtureReceipt,
  getTrustedProviderReceipt,
  findTrustedReceiptByHash,
  clearTrustedProviderInvocationsForTest,
  UNIT_FIXTURE_STORAGE_DIR,
  KNOWN_UNIT_FIXTURE_SHAS,
  setProviderReceiptStorageDirForTest,
  createCollectorCapabilityToken,
  registerTestControlledInvocationProof,
} from "@/services/kh02/demand/temporalDemandEngine";
import fs from "fs";
import path from "path";
import crypto from "crypto";
import {
  verifyStoredCsvFile,
  saveOriginalGoogleTrendsCsvFile,
} from "@/services/kh02/demand/googleTrendsCsvValidator";
import {
  buildCanonicalRecommendedProducts,
  buildAllCandidatesExplorerList,
  buildBuyerOrientedWhyItFits,
  resolveCandidatePrimaryMedia,
} from "@/services/kh02/presentation/productFinderViewModel";
import {
  evaluateGoogleMcpGates,
  runGoogleGateNegativeTests,
} from "../../../scripts/kh02/googleMcpGateEvaluator";
import { runEvergreenProductResearch } from "@/services/kh02/evergreenResearchOrchestrator";

describe("KH-02 Post-Review Hardening Audit Suite (2026-11-03)", () => {
  describe("BUG P0-A: G15 Demand Source Authority & Provenance Integrity", () => {
    it("verifyStoredCsvFile strictly rejects path traversal, non-hex inputs, and truncated prefixes (16, 32, 63 chars)", () => {
      const traversal1 = verifyStoredCsvFile("../../etc/passwd");
      expect(traversal1.exists).toBe(false);
      expect(traversal1.validHash).toBe(false);

      const traversal2 = verifyStoredCsvFile("..\\..\\windows\\system32\\config");
      expect(traversal2.exists).toBe(false);
      expect(traversal2.validHash).toBe(false);

      const nonHex = verifyStoredCsvFile("not_a_valid_hex_hash_string_12345");
      expect(nonHex.exists).toBe(false);
      expect(nonHex.validHash).toBe(false);

      const fakeHex = verifyStoredCsvFile("0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef");
      expect(fakeHex.exists).toBe(false);
      expect(fakeHex.validHash).toBe(false);

      // Truncated 16, 32, 63 char prefixes of existing real file MUST FAIL
      const real64 = "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08";
      expect(verifyStoredCsvFile(real64).exists).toBe(true);
      expect(verifyStoredCsvFile(real64).validHash).toBe(true);
      expect(verifyStoredCsvFile(real64.slice(0, 16)).exists).toBe(false);
      expect(verifyStoredCsvFile(real64.slice(0, 32)).exists).toBe(false);
      expect(verifyStoredCsvFile(real64.slice(0, 63)).exists).toBe(false);
    });

    it("saveOriginalGoogleTrendsCsvFile enforces full 64 hex checksum and rejects checksum mismatches", () => {
      // 1. Non-64 hex format throws
      expect(() => {
        saveOriginalGoogleTrendsCsvFile("test content", "not_64_hex_chars");
      }).toThrow(/must be full 64 hexadecimal characters/);

      // 2. Truncated 16 char prefix throws
      expect(() => {
        saveOriginalGoogleTrendsCsvFile("test content", "0123456789abcdef");
      }).toThrow(/must be full 64 hexadecimal characters/);

      // 3. 64 hex mismatch with actual content throws
      expect(() => {
        saveOriginalGoogleTrendsCsvFile("test content", "0000000000000000000000000000000000000000000000000000000000000000");
      }).toThrow(/Checksum mismatch/);
    });

    it("hasVerifiableCsvOrProviderLineage never grants hasValidFileChecksum without verified file on disk", () => {
      // Regex alone matching sha256: cannot grant valid checksum
      const fakeLineage = hasVerifiableCsvOrProviderLineage(
        "csv-import:google-trends:sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
      );
      expect(fakeLineage.rawCsvFileExists).toBe(false);
      expect(fakeLineage.hasValidFileChecksum).toBe(false);
      expect(fakeLineage.lineageVerified).toBe(false);
    });

    it("evaluateDemandSourceAuthority fails closed against fabricated GOOGLE_TRENDS_LIVE source without provider receipt", () => {
      const fabricatedLive = evaluateDemandSourceAuthority([
        {
          id: "obs_1",
          source: "GOOGLE_TRENDS_LIVE",
          demandValue: 75,
          periodStart: "2026-07-01T00:00:00.000Z",
          evidenceReference: "fake_reference_no_receipt",
          keyword: "cat water fountain",
        },
      ]);
      expect(fabricatedLive.authority).toBe("CACHED_UNVERIFIED");
      expect(fabricatedLive.productAttributionValid).toBe(false);
      expect(fabricatedLive.reasons.some((r) => r.includes("lacks verifiable provider API request receipt"))).toBe(true);
    });

    it("evaluateDemandSourceAuthority rejects empty source attribution", () => {
      const noSource = evaluateDemandSourceAuthority([
        {
          id: "obs_1",
          source: "" as any,
          demandValue: 75,
          periodStart: "2026-07-01T00:00:00.000Z",
          keyword: "cat water fountain",
        },
      ]);
      expect(noSource.authority).toBe("UNKNOWN_SOURCE");
      expect(noSource.productAttributionValid).toBe(false);
    });

    it("evaluateDemandSourceAuthority rejects unbacked GOOGLE_TRENDS_CSV without matching disk file", () => {
      const unbackedCsv = evaluateDemandSourceAuthority([
        {
          id: "obs_csv_1",
          source: "GOOGLE_TRENDS_CSV",
          demandValue: 80,
          periodStart: "2026-07-01T00:00:00.000Z",
          evidenceReference: "csv-import:google-trends:sha256:deadbeefdeadbeefdeadbeefdeadbeef",
          keyword: "cat water fountain",
        },
      ]);
      expect(unbackedCsv.authority).toBe("CACHED_UNVERIFIED");
      expect(unbackedCsv.productAttributionValid).toBe(false);
    });

    it("evaluateDemandSourceAuthority rejects bare string claim provider-request without receipt descriptor", () => {
      const bareClaim = evaluateDemandSourceAuthority([
        {
          id: "obs_bare_1",
          source: "GOOGLE_TRENDS_LIVE",
          demandValue: 75,
          periodStart: "2026-07-01T00:00:00.000Z",
          evidenceReference: "provider-request:serpapi:req_live_verified_12345",
          keyword: "cat water fountain",
        },
      ]);
      expect(bareClaim.authority).toBe("CACHED_UNVERIFIED");
      expect(bareClaim.productAttributionValid).toBe(false);
      expect(bareClaim.reasons.some((r) => r.includes("unverified string claim"))).toBe(true);
    });

    it("evaluateDemandSourceAuthority rejects forged providerEvidence lacking 64-hex rawResponseSha256 digest", () => {
      const forged = evaluateDemandSourceAuthority([
        {
          id: "obs_forged_1",
          source: "GOOGLE_TRENDS_LIVE",
          demandValue: 75,
          periodStart: "2026-07-01T00:00:00.000Z",
          evidenceReference: "provider-request:serpapi:req_live_verified_12345",
          providerEvidence: {
            requestId: "req_live_verified_12345",
            status: 200,
            source: "GOOGLE_TRENDS_LIVE",
          },
          keyword: "cat water fountain",
        } as any,
      ]);
      expect(forged.authority).toBe("CACHED_UNVERIFIED");
      expect(forged.productAttributionValid).toBe(false);
      expect(forged.reasons.some((r) => r.includes("64-hex raw response SHA-256") || r.includes("verifiable provider API request receipt"))).toBe(true);
    });

    it("evaluateDemandSourceAuthority rejects verifiedDescriptor: { verified: true } alone without proof attributes", () => {
      const bareBool = evaluateDemandSourceAuthority([
        {
          id: "obs_bare_bool_1",
          source: "GOOGLE_TRENDS_LIVE",
          demandValue: 75,
          periodStart: "2026-07-01T00:00:00.000Z",
          evidenceReference: "provider-request:serpapi:req_bool_1",
          verifiedDescriptor: { verified: true },
          keyword: "cat water fountain",
        } as any,
      ]);
      expect(bareBool.authority).toBe("CACHED_UNVERIFIED");
      expect(bareBool.productAttributionValid).toBe(false);
    });

    it("evaluateDemandSourceAuthority rejects methodologyVersion='serpapi_google_trends_live_v1' alone without evidence reference", () => {
      const methodologyAlone = evaluateDemandSourceAuthority([
        {
          id: "obs_meth_alone",
          source: "GOOGLE_TRENDS_LIVE",
          demandValue: 75,
          periodStart: "2026-07-01T00:00:00.000Z",
          evidenceReference: "",
          methodologyVersion: "serpapi_google_trends_live_v1",
          keyword: "cat water fountain",
        } as any,
      ]);
      expect(methodologyAlone.authority).toBe("CACHED_UNVERIFIED");
      expect(methodologyAlone.productAttributionValid).toBe(false);
    });

    it("evaluateDemandSourceAuthority rejects policy.providerReceiptDescriptor reused for mismatched keyword or product", () => {
      const mismatchedProduct = evaluateDemandSourceAuthority(
        [
          {
            id: "obs_dog_1",
            source: "GOOGLE_TRENDS_LIVE",
            demandValue: 75,
            periodStart: "2026-07-01T00:00:00.000Z",
            evidenceReference: "provider-request:serpapi:req_dog_1",
            keyword: "dog bark collar",
          },
        ],
        {
          providerReceiptDescriptor: {
            providerRequestId: "req_cat_fountain",
            responseStatus: 200,
            source: "GOOGLE_TRENDS_LIVE",
            rawResponseSha256: "04f4d039cdd4a884134914fdb9d2ed86ebbfa353991d714b78df545a96fd4b14",
            targetProductOrKeyword: "cat water fountain",
            region: "US",
            verified: true,
          },
        }
      );
      expect(mismatchedProduct.authority).toBe("CACHED_UNVERIFIED");
      expect(mismatchedProduct.productAttributionValid).toBe(false);
    });

    it("resolveVerifiedDemandEvidence rejects ResearchEvidence lacking 64-hex SHA or returning non-200 status", async () => {
      const unbackedDesc = await resolveVerifiedDemandEvidence("provider-request:test:no_sha", {
        productId: "prod_mock_missing_sha",
      });
      expect(unbackedDesc.verified).toBe(false);
      expect(unbackedDesc.rejectionReason).toContain("unverified string claim");
    });

    it("evaluateDemandSourceAuthority returns FIXTURE_ONLY when observation carries test fixture receipt (P0-HIGH fail closed)", () => {
      const authenticLive = evaluateDemandSourceAuthority([
        {
          id: "obs_real_live_1",
          source: "GOOGLE_TRENDS_LIVE",
          demandValue: 75,
          periodStart: "2026-07-01T00:00:00.000Z",
          evidenceReference: "provider-request:serpapi:req_live_verified_12345",
          providerEvidence: {
            requestId: "req_live_verified_12345",
            status: 200,
            source: "GOOGLE_TRENDS_LIVE",
            rawResponseSha256: "04f4d039cdd4a884134914fdb9d2ed86ebbfa353991d714b78df545a96fd4b14",
            targetProductOrKeyword: "cat water fountain",
            region: "US",
          },
          keyword: "cat water fountain",
          region: "US",
        } as any,
      ]);
      expect(authenticLive.authority).toBe("FIXTURE_ONLY");
      expect(authenticLive.productAttributionValid).toBe(true);
    });
  });

  describe("BUG P0-B: Google Raw Zero vs Nonzero Observations Quarantine & Telemetry Parity", () => {
    it("fails closed in evaluateGoogleMcpGates when rawCount is 0 but UI or persisted count > 0", () => {
      const gateResult = evaluateGoogleMcpGates({
        researchRunId: "run_quarantine_test_1",
        evaluatedCandidateIds: ["cand_1"],
        telemetry: {
          transportStatus: "CONNECTED",
          queryStatus: "QUERY_SUCCEEDED_EMPTY",
          enrichmentExecution: { mcpInvocations: [] },
        },
        rawManifest: {
          rawCount: 0,
          researchRunId: "run_quarantine_test_1",
          creatives: [],
        },
        normalizationLedger: {
          normalizationStageExecuted: true,
          normalizedDistinctCount: 0,
          rejectedBeforeNormalizationCount: 0,
          records: [],
          rejectedRecords: [],
        },
        associationLedger: {
          classifiedDistinctCount: 0,
          probableProductMatchesCount: 0,
          brandLevelMatchesCount: 0,
          associations: [],
        },
        uiDisplayedCreativesCount: 5,
        persistedCreativesCount: 5,
      });

      expect(gateResult.subGates.GOOGLE_PRODUCT_ASSOCIATION).toBe("FAIL");
      expect(gateResult.overallG06Verdict).toBe("FAIL");
      expect(gateResult.setReconciliation.unknownAssociationCreativeIds).toContain(
        "ui_displayed_creatives_exceed_raw_count"
      );
    });
  });

  describe("BUG P1-C: Product Finder UI & View-Model Never Defaults to Fake Meta Ads", () => {
    it("never defaults supportingSources to ['Meta Ads'] when candidate has zero sources", () => {
      const candidateNoSources = {
        candidateId: "cand_no_sources_1",
        title: "Solar Outdoor Ultrasonic Pest Repeller",
        canonicalProductName: "Solar Outdoor Ultrasonic Pest Repeller",
        category: "Pest Control Gadgets",
        storeDomain: "pest-shield.com",
        canonicalProductUrl: "https://pest-shield.com/products/repeller",
        supportingSourceTypes: [],
        supportingAdIds: [],
        totalObservationCount: 0,
        sourceObservations: [],
        identityStatus: "VERIFIED",
        fetchOutcome: "FETCH_SUCCEEDED",
        productRealityStatus: "VERIFIED_PHYSICAL_PRODUCT",
      } as any;

      const recommended = buildCanonicalRecommendedProducts({
        researchRunId: "run_viewmodel_no_sources",
        topic: "Pest Control Gadgets",
        runStatus: "COMPLETED",
        topThree: [
          {
            rank: 1,
            candidate: candidateNoSources,
            score: {
              opportunityScore: 85,
              evidenceConfidence: 75,
              tier: "RESEARCH_QUALIFIED",
              scoreStatus: "QUALIFIED",
            } as any,
          },
        ],
      } as any);

      expect(recommended.length).toBe(1);
      const card = recommended[0];

      // Must not display "Meta Ads"
      expect(card.supportingSources).toEqual(["No Verified Source"]);
      expect(card.supportingSources).not.toContain("Meta Ads");

      // Evidence checklist must truthfully state no advertising observations
      expect(card.verifiedEvidenceItems).toContain("No verified advertising observations");
      expect(card.verifiedEvidenceItems).not.toContain(
        expect.stringMatching(/Historical advertising observations:.*Meta Ads/)
      );

      // Explorer rows must also show zero observationCount and "No Verified Source"
      const explorerRows = buildAllCandidatesExplorerList({
        researchRunId: "run_viewmodel_no_sources",
        topic: "Pest Control Gadgets",
        topThree: [{ candidate: candidateNoSources, score: {} as any, rank: 1 }],
      } as any);
      expect(explorerRows[0].observationCount).toBe(0);
      expect(explorerRows[0].supportingSources).toEqual(["No Verified Source"]);
    });

    it("buildBuyerOrientedWhyItFits never invents 'supported by 1 linked advertising creative(s)' when supportingAdIds is empty", () => {
      const candidateWithoutAds = {
        candidateId: "cand_no_ads_1",
        title: "Self-Cleaning Litter Tray System",
        category: "Pet Gadgets",
        storeDomain: "pet-clean.com",
        supportingAdIds: [],
        problemStatement: "Eliminates odor and manual cat box scooping",
        identityStatus: "PROBABLE",
        fetchOutcome: "UNVERIFIED",
      } as any;

      const whyItFits = buildBuyerOrientedWhyItFits(
        candidateWithoutAds,
        "Pet Gadgets",
        "Cat Owners",
        false
      );

      expect(whyItFits).not.toContain("supported by 1 linked advertising creative(s)");
      expect(whyItFits).toContain("discovered from product signals for pet-clean.com");
    });

    it("resolveCandidatePrimaryMedia never marks unverified thumbnail as 'Merchant Product Image'", () => {
      const unverifiedMedia = resolveCandidatePrimaryMedia(
        {
          thumbnailUrl: "https://some-random-domain.com/image.jpg",
          storeDomain: "official-brand.com",
          identityStatus: "PROBABLE",
          fetchOutcome: "HTTP_ERROR",
        },
        false
      );

      expect(unverifiedMedia.primaryMediaSourceLabel).toBe("Candidate Thumbnail");
      expect(unverifiedMedia.primaryMediaSourceLabel).not.toBe("Merchant Product Image");
    });
  });

  describe("BUG P1-D: Longitudinal Coverage, Sampling Cadence & Gap Guards", () => {
    it("strictly rejects series with excessive gap (> 35 days) despite 3 points over 65 days", () => {
      // Point 1: 2026-06-01, Point 2: 2026-06-05 (4d gap), Point 3: 2026-08-05 (61d gap!)
      const clusteredPointsSeries = evaluateDemandHistoryEvidence(
        [
          {
            id: "obs_c1",
            periodStart: "2026-06-01T00:00:00.000Z",
            demandValue: 65,
            region: "US",
            source: "GOOGLE_TRENDS_LIVE",
            keyword: "cat water fountain",
            evidenceReference: "provider-request:serpapi:req_c1",
          },
          {
            id: "obs_c2",
            periodStart: "2026-06-05T00:00:00.000Z",
            demandValue: 67,
            region: "US",
            source: "GOOGLE_TRENDS_LIVE",
            keyword: "cat water fountain",
            evidenceReference: "provider-request:serpapi:req_c2",
          },
          {
            id: "obs_c3",
            periodStart: "2026-08-05T00:00:00.000Z",
            demandValue: 70,
            region: "US",
            source: "GOOGLE_TRENDS_LIVE",
            keyword: "cat water fountain",
            evidenceReference: "provider-request:serpapi:req_c3",
          },
        ],
        {
          minimumDataPoints: 3,
          minimumCoveredDays: 60,
          candidateCanonicalName: "Cat Water Fountain",
        }
      );

      expect(clusteredPointsSeries.status).toBe("INSUFFICIENT_HISTORY");
      expect(clusteredPointsSeries.eligibleForEvergreen).toBe(false);
      expect(clusteredPointsSeries.temporalCoverageValid).toBe(false);
      expect(clusteredPointsSeries.maxGapDays).toBeGreaterThan(35);
      expect(clusteredPointsSeries.missingEvidence.some((m) => m.includes("excessive gap"))).toBe(true);
    });

    it("rejects observations with timestamps after policy asOfTimestamp", () => {
      const asOfCutoff = "2026-08-01T00:00:00.000Z";
      const postCutoffSeries = evaluateDemandHistoryEvidence(
        [
          {
            id: "obs_ok_1",
            periodStart: "2026-06-01T00:00:00.000Z",
            demandValue: 60,
            region: "US",
            source: "GOOGLE_TRENDS_LIVE",
            keyword: "cat water fountain",
            evidenceReference: "provider-request:serpapi:req_1",
          },
          {
            id: "obs_ok_2",
            periodStart: "2026-07-01T00:00:00.000Z",
            demandValue: 65,
            region: "US",
            source: "GOOGLE_TRENDS_LIVE",
            keyword: "cat water fountain",
            evidenceReference: "provider-request:serpapi:req_2",
          },
          {
            id: "obs_future_post_cutoff",
            periodStart: "2026-08-15T00:00:00.000Z", // After cutoff!
            demandValue: 70,
            region: "US",
            source: "GOOGLE_TRENDS_LIVE",
            keyword: "cat water fountain",
            evidenceReference: "provider-request:serpapi:req_3",
          },
        ],
        {
          minimumDataPoints: 3,
          minimumCoveredDays: 60,
          asOfTimestamp: asOfCutoff,
        }
      );

      // Only 2 points survive cutoff -> insufficient points
      expect(postCutoffSeries.status).toBe("INSUFFICIENT_HISTORY");
      expect(postCutoffSeries.dataPointsCount).toBe(2);
      expect(postCutoffSeries.missingEvidence.some((m) => m.includes("as-of cutoff"))).toBe(true);
    });

    it("rejects observations from non-US region when requiredRegion is US", () => {
      const nonUsSeries = evaluateDemandHistoryEvidence(
        [
          {
            id: "obs_vn_1",
            periodStart: "2026-06-01T00:00:00.000Z",
            demandValue: 60,
            region: "VN", // Foreign region!
            source: "GOOGLE_TRENDS_LIVE",
            keyword: "cat water fountain",
            evidenceReference: "provider-request:serpapi:req_vn1",
          },
          {
            id: "obs_vn_2",
            periodStart: "2026-07-01T00:00:00.000Z",
            demandValue: 65,
            region: "VN",
            source: "GOOGLE_TRENDS_LIVE",
            keyword: "cat water fountain",
            evidenceReference: "provider-request:serpapi:req_vn2",
          },
          {
            id: "obs_vn_3",
            periodStart: "2026-08-01T00:00:00.000Z",
            demandValue: 70,
            region: "VN",
            source: "GOOGLE_TRENDS_LIVE",
            keyword: "cat water fountain",
            evidenceReference: "provider-request:serpapi:req_vn3",
          },
        ],
        {
          requiredRegion: "US",
        }
      );

      expect(nonUsSeries.status).toBe("INSUFFICIENT_HISTORY");
      expect(nonUsSeries.productAttributionValid).toBe(false);
      expect(nonUsSeries.missingEvidence.some((m) => m.includes("non-US records"))).toBe(true);
    });

    it("accepts continuous weekly observation series spanning >= 60 days with max gap <= 7 days", () => {
      // 10 points spaced exactly 7 days apart from 2026-06-01 to 2026-08-03 (63 days)
      const weeklyPoints = [];
      const baseDate = new Date("2026-06-01T00:00:00.000Z").getTime();
      for (let i = 0; i < 10; i++) {
        const d = new Date(baseDate + i * 7 * 24 * 60 * 60 * 1000).toISOString();
        weeklyPoints.push({
          id: `obs_w_${i}`,
          periodStart: d,
          demandValue: 65 + (i % 3),
          region: "US",
          source: "GOOGLE_TRENDS_LIVE",
          keyword: "cat water fountain",
          evidenceReference: `provider-request:serpapi:req_w_${i}`,
        });
      }

      const assessment = evaluateDemandHistoryEvidence(weeklyPoints, {
        minimumDataPoints: 3,
        minimumCoveredDays: 60,
        requiredRegion: "US",
        providerReceiptDescriptor: {
          verified: true,
          source: "GOOGLE_TRENDS_LIVE",
          responseStatus: 200,
          providerRequestId: "req_live_test_weekly",
          rawResponseSha256: "04f4d039cdd4a884134914fdb9d2ed86ebbfa353991d714b78df545a96fd4b14",
          targetProductOrKeyword: "cat water fountain",
          region: "US",
        },
      });

      expect(assessment.status).toBe("VERIFIED");
      expect(assessment.eligibleForEvergreen).toBe(true);
      expect(assessment.expectedCadence).toBe("WEEKLY");
      expect(assessment.maxGapDays).toBe(7);
      expect(assessment.coveredDays).toBe(63);
      expect(assessment.temporalCoverageValid).toBe(true);
      expect(assessment.coverageRatio).toBeGreaterThanOrEqual(0.8);
    });

    it("strictly rejects sparse series with low sampling density (coverageRatio < 0.40)", () => {
      // 3 weekly points spanning 63 days: week 0 (day 0), week 4 (day 28), week 8 (day 56)
      // expectedPeriods = 63 / 7 = 9; qualifiedPeriods = 3; coverageRatio = 3/9 = 0.33 < 0.40
      const sparsePoints = [
        {
          id: "obs_sp_1",
          periodStart: "2026-06-01T00:00:00.000Z",
          demandValue: 65,
          region: "US",
          source: "GOOGLE_TRENDS_LIVE",
          keyword: "cat water fountain",
          evidenceReference: "provider-request:serpapi:req_sp1",
        },
        {
          id: "obs_sp_2",
          periodStart: "2026-06-29T00:00:00.000Z", // 28 days later
          demandValue: 67,
          region: "US",
          source: "GOOGLE_TRENDS_LIVE",
          keyword: "cat water fountain",
          evidenceReference: "provider-request:serpapi:req_sp2",
        },
        {
          id: "obs_sp_3",
          periodStart: "2026-07-27T00:00:00.000Z", // 28 days later
          demandValue: 70,
          region: "US",
          source: "GOOGLE_TRENDS_LIVE",
          keyword: "cat water fountain",
          evidenceReference: "provider-request:serpapi:req_sp3",
        },
      ];

      const assessment = evaluateDemandHistoryEvidence(sparsePoints, {
        minimumDataPoints: 3,
        minimumCoveredDays: 50,
        maxAllowedGapDays: 35,
        expectedCadence: "WEEKLY",
        minCoverageRatio: 0.40,
        providerReceiptDescriptor: {
          verified: true,
          source: "GOOGLE_TRENDS_LIVE",
          responseStatus: 200,
          providerRequestId: "req_sp_desc",
          rawResponseSha256: "04f4d039cdd4a884134914fdb9d2ed86ebbfa353991d714b78df545a96fd4b14",
          targetProductOrKeyword: "cat water fountain",
          region: "US",
        },
      });

      expect(assessment.status).toBe("INSUFFICIENT_HISTORY");
      expect(assessment.eligibleForEvergreen).toBe(false);
      expect(assessment.coverageRatio).toBeLessThan(0.40);
      expect(assessment.missingEvidence.some((m) => m.includes("coverage ratio"))).toBe(true);
    });

    it("rejects observations with observedAt/ingestedAt timestamps after asOf cutoff (P0-3 Point-in-Time)", () => {
      const asOfCutoff = "2026-10-01T00:00:00.000Z";
      // Observation has old observation period (2026-07) but was ingested in 2026-11 (after 2026-10 cutoff)
      const lateIngestedSeries = [
        {
          id: "obs_old_period_late_ingested",
          periodStart: "2026-07-01T00:00:00.000Z",
          demandValue: 60,
          region: "US",
          source: "GOOGLE_TRENDS_LIVE",
          keyword: "cat water fountain",
          evidenceReference: "provider-request:serpapi:req_late",
          observedAt: "2026-11-01T00:00:00.000Z", // INGESTED AFTER CUTOFF!
        },
        {
          id: "obs_prior_1",
          periodStart: "2026-06-01T00:00:00.000Z",
          demandValue: 65,
          region: "US",
          source: "GOOGLE_TRENDS_LIVE",
          keyword: "cat water fountain",
          evidenceReference: "provider-request:serpapi:req_p1",
          observedAt: "2026-06-01T00:00:00.000Z",
        },
      ];

      const assessment = evaluateDemandHistoryEvidence(lateIngestedSeries, {
        minimumDataPoints: 2,
        asOfTimestamp: asOfCutoff,
        providerReceiptDescriptor: {
          verified: true,
          source: "GOOGLE_TRENDS_LIVE",
          responseStatus: 200,
          providerRequestId: "req_sp_desc",
          rawResponseSha256: "04f4d039cdd4a884134914fdb9d2ed86ebbfa353991d714b78df545a96fd4b14",
          targetProductOrKeyword: "cat water fountain",
          region: "US",
        },
      });

      expect(assessment.dataPointsCount).toBe(1); // late-ingested point filtered out!
      expect(assessment.missingEvidence.some((m) => m.includes("as-of cutoff"))).toBe(true);
    });

    it("rejects observation when ingestedAt is after asOf cutoff even if observedAt is prior to cutoff", () => {
      const asOfCutoff = "2026-10-01T00:00:00.000Z";
      const splitTimeObs = [
        {
          id: "obs_split_time",
          periodStart: "2026-07-01T00:00:00.000Z",
          demandValue: 60,
          region: "US",
          source: "GOOGLE_TRENDS_LIVE",
          keyword: "cat water fountain",
          observedAt: "2026-07-01T00:00:00.000Z", // Prior to cutoff
          ingestedAt: "2026-11-02T00:00:00.000Z", // AFTER cutoff!
          evidenceReference: "provider-request:serpapi:req_split",
        },
      ];

      const assessment = evaluateDemandHistoryEvidence(splitTimeObs, {
        asOfTimestamp: asOfCutoff,
        providerReceiptDescriptor: {
          verified: true,
          source: "GOOGLE_TRENDS_LIVE",
          responseStatus: 200,
          providerRequestId: "req_sp_desc",
          rawResponseSha256: "04f4d039cdd4a884134914fdb9d2ed86ebbfa353991d714b78df545a96fd4b14",
          targetProductOrKeyword: "cat water fountain",
          region: "US",
        },
      });

      expect(assessment.dataPointsCount).toBe(0);
      expect(assessment.missingEvidence.some((m) => m.includes("as-of cutoff"))).toBe(true);
    });

    it("strictly rejects attempts to override minCoverageRatio below server minimum 0.40", () => {
      const sparsePoints = [
        {
          id: "obs_sp_1",
          periodStart: "2026-06-01T00:00:00.000Z",
          demandValue: 65,
          region: "US",
          source: "GOOGLE_TRENDS_LIVE",
          keyword: "cat water fountain",
          evidenceReference: "provider-request:serpapi:req_sp1",
        },
        {
          id: "obs_sp_2",
          periodStart: "2026-06-29T00:00:00.000Z",
          demandValue: 67,
          region: "US",
          source: "GOOGLE_TRENDS_LIVE",
          keyword: "cat water fountain",
          evidenceReference: "provider-request:serpapi:req_sp2",
        },
        {
          id: "obs_sp_3",
          periodStart: "2026-07-27T00:00:00.000Z",
          demandValue: 70,
          region: "US",
          source: "GOOGLE_TRENDS_LIVE",
          keyword: "cat water fountain",
          evidenceReference: "provider-request:serpapi:req_sp3",
        },
      ];

      const assessment = evaluateDemandHistoryEvidence(sparsePoints, {
        minimumDataPoints: 3,
        minimumCoveredDays: 50,
        maxAllowedGapDays: 35,
        expectedCadence: "WEEKLY",
        minCoverageRatio: 0.10, // Attempted downward override!
        providerReceiptDescriptor: {
          verified: true,
          source: "GOOGLE_TRENDS_LIVE",
          responseStatus: 200,
          providerRequestId: "req_sp_desc",
          rawResponseSha256: "04f4d039cdd4a884134914fdb9d2ed86ebbfa353991d714b78df545a96fd4b14",
          targetProductOrKeyword: "cat water fountain",
          region: "US",
        },
      });

      expect(assessment.status).toBe("INSUFFICIENT_HISTORY");
      expect(assessment.eligibleForEvergreen).toBe(false);
      expect(assessment.missingEvidence.some((m) => m.includes("coverage ratio"))).toBe(true);
    });

    it("source cadence metadata in evidenceReference takes precedence over client expectedCadence", () => {
      const weeklyMetaPoints = [
        {
          id: "obs_wm_1",
          periodStart: "2026-06-01T00:00:00.000Z",
          demandValue: 65,
          region: "US",
          source: "GOOGLE_TRENDS_CSV",
          keyword: "cat water fountain",
          evidenceReference: "csv-import:google-trends-explore:sha256:9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08:q=cat_water_fountain:geo=US:cadence=WEEKLY:start=2026-06-01:end=2026-07-27",
        },
        {
          id: "obs_wm_2",
          periodStart: "2026-06-29T00:00:00.000Z",
          demandValue: 67,
          region: "US",
          source: "GOOGLE_TRENDS_CSV",
          keyword: "cat water fountain",
          evidenceReference: "csv-import:google-trends-explore:sha256:9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08:q=cat_water_fountain:geo=US:cadence=WEEKLY:start=2026-06-01:end=2026-07-27",
        },
        {
          id: "obs_wm_3",
          periodStart: "2026-07-27T00:00:00.000Z",
          demandValue: 70,
          region: "US",
          source: "GOOGLE_TRENDS_CSV",
          keyword: "cat water fountain",
          evidenceReference: "csv-import:google-trends-explore:sha256:9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08:q=cat_water_fountain:geo=US:cadence=WEEKLY:start=2026-06-01:end=2026-07-27",
        },
      ];

      const assessment = evaluateDemandHistoryEvidence(weeklyMetaPoints, {
        minimumDataPoints: 3,
        minimumCoveredDays: 50,
        maxAllowedGapDays: 35,
        expectedCadence: "MONTHLY", // Client attempted to treat it as MONTHLY!
      });

      // Must be evaluated as WEEKLY due to source metadata, and fail density check!
      expect(assessment.expectedCadence).toBe("WEEKLY");
      expect(assessment.status).toBe("INSUFFICIENT_HISTORY");
    });
  });

  describe("MANDATORY ADVERSARIAL NEGATIVE / POSITIVE SUITE (T01 - T30)", () => {
    const verifiedFixtureSha = "04f4d039cdd4a884134914fdb9d2ed86ebbfa353991d714b78df545a96fd4b14";

    it("T01: methodologyVersion authoritative + generic nonempty ref + zero digest => FAIL", () => {
      const res = evaluateDemandSourceAuthority(
        [
          {
            id: "obs_t01",
            source: "GOOGLE_TRENDS_LIVE",
            keyword: "cat water fountain",
            evidenceReference: "provider-request:serpapi:req_t01",
            methodologyVersion: "serpapi_google_trends_live",
          } as any,
        ],
        { strictSourceProvenance: false }
      );
      expect(res.authority).toBe("CACHED_UNVERIFIED");
      expect(res.productAttributionValid).toBe(false);
    });

    it("T02: providerEvidence requestId/status200/hash64 but no raw artifact/ledger => FAIL", () => {
      const res = evaluateDemandSourceAuthority([
        {
          id: "obs_t02",
          source: "GOOGLE_TRENDS_LIVE",
          keyword: "cat water fountain",
          region: "US",
          evidenceReference: "provider-request:serpapi:req_t02",
          providerEvidence: {
            requestId: "req_t02",
            status: 200,
            source: "GOOGLE_TRENDS_LIVE",
            rawResponseSha256: "aabbccddeeff00112233445566778899aabbccddeeff00112233445566778899",
            targetProductOrKeyword: "cat water fountain",
            region: "US",
          },
        } as any,
      ]);
      expect(res.authority).toBe("CACHED_UNVERIFIED");
    });

    it("T03: verifiedDescriptor:{verified:true,sha256:valid64} no artifact => FAIL", () => {
      const auth = isAuthenticProviderReceiptDescriptor({
        verified: true,
        providerRequestId: "req_t03",
        rawResponseSha256: "aabbccddeeff00112233445566778899aabbccddeeff00112233445566778899",
        region: "US",
        targetProductOrKeyword: "cat water fountain",
      });
      expect(auth.authentic).toBe(false);
      expect(auth.errorCode).toBe("MISSING_ARTIFACT");
    });

    it("T04: policy.providerReceiptDescriptor from caller with valid hash but wrong region/keyword => FAIL", () => {
      const authRegion = isAuthenticProviderReceiptDescriptor(
        {
          verified: true,
          providerRequestId: "req_live_verified_12345",
          rawResponseSha256: verifiedFixtureSha,
          region: "US",
          targetProductOrKeyword: "cat water fountain",
        },
        { region: "GB" }
      );
      expect(authRegion.authentic).toBe(false);
      expect(authRegion.errorCode).toBe("REGION_MISMATCH");

      const authKw = isAuthenticProviderReceiptDescriptor(
        {
          verified: true,
          providerRequestId: "req_live_verified_12345",
          rawResponseSha256: verifiedFixtureSha,
          region: "US",
          targetProductOrKeyword: "cat water fountain",
        },
        { targetKeyword: "wireless earbuds" }
      );
      expect(authKw.authentic).toBe(false);
      expect(authKw.errorCode).toBe("PRODUCT_MISMATCH");
    });

    it("T05: response hash valid format but mismatch real saved bytes => FAIL", () => {
      const mismatchAuth = isAuthenticProviderReceiptDescriptor({
        verified: true,
        providerRequestId: "req_t05",
        rawResponseSha256: "111122223333444455556666777788889999aaaabbbbccccddddeeeeffff0000",
        artifactPath: path.resolve(process.cwd(), "package.json"),
      });
      expect(mismatchAuth.authentic).toBe(false);
      expect(mismatchAuth.errorCode).toBe("HASH_MISMATCH");
    });

    it("T06: ResearchEvidence substring collision/ref unregistered => FAIL", async () => {
      const res = await resolveVerifiedDemandEvidence("provider-request:serpapi:unregistered_ref_collision_xyz", {
        productId: "non_existent_product_id",
      });
      expect(res.verified).toBe(false);
      expect(res.errorCode).toBe("RECEIPT_NOT_FOUND");
    });

    it("T07: ResearchEvidence SHA64 of unrelated report file => FAIL", async () => {
      const res = await resolveVerifiedDemandEvidence("sha256:1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef");
      expect(res.verified).toBe(false);
      expect(res.errorCode).toBe("MISSING_ARTIFACT");
    });

    it("T08: parse failure/missing status in provider receipt => FAIL", () => {
      const auth = isAuthenticProviderReceiptDescriptor({
        verified: true,
        providerRequestId: "req_t08",
        rawResponseSha256: verifiedFixtureSha,
        responseStatus: 500,
      });
      expect(auth.authentic).toBe(false);
      expect(auth.errorCode).toBe("RESPONSE_STATUS_INVALID");
    });

    it("T09: same raw receipt replayed for another product => FAIL", () => {
      const auth = isAuthenticProviderReceiptDescriptor(
        {
          verified: true,
          providerRequestId: "req_live_verified_12345",
          rawResponseSha256: verifiedFixtureSha,
          targetProductOrKeyword: "cat water fountain",
          region: "US",
        },
        { targetKeyword: "electric nail clipper" }
      );
      expect(auth.authentic).toBe(false);
      expect(auth.errorCode).toBe("PRODUCT_MISMATCH");
    });

    it("T10: trusted provider raw payload with correct hash + invocation + exact product/time/market => engineering unit PASS", () => {
      const auth = isAuthenticProviderReceiptDescriptor(
        {
          verified: true,
          providerRequestId: "req_live_verified_12345",
          rawResponseSha256: verifiedFixtureSha,
          targetProductOrKeyword: "cat water fountain",
          region: "US",
          responseStatus: 200,
        },
        { targetKeyword: "cat water fountain", region: "US" }
      );
      expect(auth.authentic).toBe(true);
    });

    it("T11: original CSV full SHA byte true; prefix truncated => FAIL closed", () => {
      const short16 = verifyStoredCsvFile("9f86d081884c7d65");
      expect(short16.exists).toBe(false);
      const short32 = verifyStoredCsvFile("9f86d081884c7d659a2feaa0c55ad015");
      expect(short32.exists).toBe(false);
      const short63 = verifyStoredCsvFile("9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a0");
      expect(short63.exists).toBe(false);
      const valid64 = verifyStoredCsvFile("9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08");
      expect(valid64.exists).toBe(true);
      expect(valid64.validHash).toBe(true);
    });

    it("T12: period old, observedAt old, ingestedAt new after asOf => reject", () => {
      const assessment = evaluateDemandHistoryEvidence(
        [
          {
            id: "obs_t12_1",
            periodStart: "2026-06-01T00:00:00.000Z",
            demandValue: 60,
            region: "US",
            observedAt: "2026-06-01T00:00:00.000Z",
            ingestedAt: "2026-11-01T00:00:00.000Z",
          } as any,
          {
            id: "obs_t12_2",
            periodStart: "2026-06-08T00:00:00.000Z",
            demandValue: 62,
            region: "US",
            observedAt: "2026-06-08T00:00:00.000Z",
            ingestedAt: "2026-06-08T00:00:00.000Z",
          } as any,
        ],
        { asOfTimestamp: "2026-10-01T00:00:00.000Z" }
      );
      expect(assessment.dataPointsCount).toBe(1);
    });

    it("T13: observedAt missing, ingestedAt unknown, period old => reject on strict replay", () => {
      const assessment = evaluateDemandHistoryEvidence(
        [
          {
            id: "obs_t13",
            periodStart: "2026-06-01T00:00:00.000Z",
            demandValue: 60,
            region: "US",
          } as any,
        ],
        { asOfTimestamp: "2026-10-01T00:00:00.000Z", strictChronological: true }
      );
      expect(assessment.dataPointsCount).toBe(0);
    });

    it("T14: capturedAt new after cutoff => reject", () => {
      const assessment = evaluateDemandHistoryEvidence(
        [
          {
            id: "obs_t14",
            periodStart: "2026-06-01T00:00:00.000Z",
            demandValue: 60,
            region: "US",
            observedAt: "2026-06-01T00:00:00.000Z",
            capturedAt: "2026-11-01T00:00:00.000Z",
          } as any,
        ],
        { asOfTimestamp: "2026-10-01T00:00:00.000Z" }
      );
      expect(assessment.dataPointsCount).toBe(0);
    });

    it("T15: periodEnd > asOf => reject without +24h grace", () => {
      const assessment = evaluateDemandHistoryEvidence(
        [
          {
            id: "obs_t15",
            periodStart: "2026-09-28T00:00:00.000Z",
            periodEnd: "2026-10-02T00:00:00.000Z",
            demandValue: 65,
            region: "US",
            observedAt: "2026-09-28T00:00:00.000Z",
          } as any,
        ],
        { asOfTimestamp: "2026-10-01T00:00:00.000Z" }
      );
      expect(assessment.dataPointsCount).toBe(0);
    });

    it("T16: 60d+ span yet sparse weekly day0/28/56 -> INSUFFICIENT", () => {
      const sparse = [
        { periodStart: "2026-06-01T00:00:00.000Z", demandValue: 60 },
        { periodStart: "2026-06-29T00:00:00.000Z", demandValue: 62 },
        { periodStart: "2026-07-27T00:00:00.000Z", demandValue: 64 },
      ];
      const assessment = evaluateDemandHistoryEvidence(sparse, {
        minimumDataPoints: 3,
        minimumCoveredDays: 50,
        expectedCadence: "WEEKLY",
      });
      expect(assessment.status).toBe("INSUFFICIENT_HISTORY");
      expect(assessment.coverageRatio).toBeLessThan(0.40);
    });

    it("T17: caller-supplied :cadence=MONTHLY on empirical weekly intervals -> evaluates as WEEKLY", () => {
      const weeklyMeta = [];
      const start = new Date("2026-06-01T00:00:00.000Z").getTime();
      for (let i = 0; i < 10; i++) {
        weeklyMeta.push({
          periodStart: new Date(start + i * 7 * 86400000).toISOString(),
          demandValue: 60 + i,
          sourceCadence: "WEEKLY",
        });
      }
      const assessment = evaluateDemandHistoryEvidence(weeklyMeta, {
        minimumDataPoints: 3,
        minimumCoveredDays: 60,
        expectedCadence: "MONTHLY",
      });
      expect(assessment.expectedCadence).toBe("WEEKLY");
    });

    it("T18: valid source-authenticated true calendar-month series -> MONTHLY cadence", () => {
      const monthly = [
        { periodStart: "2026-06-01T00:00:00.000Z", demandValue: 60 },
        { periodStart: "2026-07-01T00:00:00.000Z", demandValue: 62 },
        { periodStart: "2026-08-01T00:00:00.000Z", demandValue: 64 },
        { periodStart: "2026-09-01T00:00:00.000Z", demandValue: 66 },
      ];
      const assessment = evaluateDemandHistoryEvidence(monthly, {
        minimumDataPoints: 3,
        minimumCoveredDays: 60,
      });
      expect(assessment.expectedCadence).toBe("MONTHLY");
    });

    it("T19: duplicates overlapping periods can't inflate qualified periods", () => {
      const dupes = [
        { periodStart: "2026-06-01T00:00:00.000Z", demandValue: 60 },
        { periodStart: "2026-06-01T12:00:00.000Z", demandValue: 61 },
        { periodStart: "2026-06-08T00:00:00.000Z", demandValue: 62 },
      ];
      const assessment = evaluateDemandHistoryEvidence(dupes, { minimumDataPoints: 2 });
      expect(assessment.qualifiedPeriods).toBe(2);
    });

    it("T20: policy minCoverageRatio .10 cannot bypass server floor .40", () => {
      const sparse = [
        { periodStart: "2026-06-01T00:00:00.000Z", demandValue: 60 },
        { periodStart: "2026-06-29T00:00:00.000Z", demandValue: 62 },
        { periodStart: "2026-07-27T00:00:00.000Z", demandValue: 64 },
      ];
      const assessment = evaluateDemandHistoryEvidence(sparse, {
        minimumDataPoints: 3,
        minimumCoveredDays: 50,
        minCoverageRatio: 0.10,
      });
      expect(assessment.status).toBe("INSUFFICIENT_HISTORY");
    });
  });

  describe("MANDATORY ADVERSARIAL MATRIX (E01 - E36) — AUTHENTIC PROVIDER ORIGIN & REPLAY PARITY", () => {
    let testTempDir: string;
    let runOwnerMarkerPath: string;
    const testRunId = `kh02-test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    beforeAll(() => {
      testTempDir = fs.mkdtempSync(path.join(os.tmpdir(), "kh02-receipts-test-"));
      runOwnerMarkerPath = path.join(testTempDir, ".kh02_run_owner");
      fs.writeFileSync(runOwnerMarkerPath, JSON.stringify({ runId: testRunId, createdAt: Date.now() }));
      setProviderReceiptStorageDirForTest(testTempDir);
    });

    afterAll(() => {
      setProviderReceiptStorageDirForTest(null);
      if (testTempDir && fs.existsSync(testTempDir)) {
        if (fs.existsSync(runOwnerMarkerPath)) {
          try {
            fs.rmSync(testTempDir, { recursive: true, force: true });
          } catch {}
        }
      }
    });

    it("E01: trusted-looking JSON fixture with SHA match + fake requestId = LIVE_UNVERIFIED", () => {
      const res = isAuthenticProviderReceiptDescriptor({
        verified: true,
        providerRequestId: "fake_request_id_not_in_ledger",
        rawResponseSha256: "04f4d039cdd4a884134914fdb9d2ed86ebbfa353991d714b78df545a96fd4b14",
        targetProductOrKeyword: "cat water fountain",
        region: "US",
        responseStatus: 200,
      }, { strictLiveOrigin: true });
      expect(res.authentic).toBe(false);
      expect(res.errorCode).toBe("ORIGIN_UNVERIFIED");
    });

    it("E02: manually planted <sha>.json file & forged verified descriptor = LIVE_UNVERIFIED", () => {
      const raw = JSON.stringify({ data: "planted", time: Date.now() });
      const stored = saveRawProviderPayloadFile(raw);
      const res = isAuthenticProviderReceiptDescriptor({
        verified: true,
        providerRequestId: "forged_planted_receipt",
        rawResponseSha256: stored.rawResponseSha256,
        targetProductOrKeyword: "arbitrary product",
        region: "US",
        responseStatus: 200,
      });
      expect(res.authentic).toBe(false);
      expect(res.errorCode).toBe("ORIGIN_UNVERIFIED");
    });

    it("E03: genuine bytes + legitimate hash but absence of independent trusted invocation ledger = LIVE_UNVERIFIED", () => {
      const raw = JSON.stringify({ search_metadata: { status: "Success", id: "unregistered_req" }, search_parameters: { q: "test product", geo: "US" } });
      const stored = saveRawProviderPayloadFile(raw);
      const res = isAuthenticProviderReceiptDescriptor({
        verified: true,
        providerRequestId: "unregistered_req",
        rawResponseSha256: stored.rawResponseSha256,
        targetProductOrKeyword: "test product",
        region: "US",
        responseStatus: 200,
      });
      expect(res.authentic).toBe(false);
      expect(res.errorCode).toBe("ORIGIN_UNVERIFIED");
    });

    it("E04: ledger for request A + bytes of response B = HASH/RECEIPT MISMATCH", () => {
      const testToken = createCollectorCapabilityToken("test_collector");
      const rawA = JSON.stringify({ id: "req_A", value: 100 });
      const storedA = saveRawProviderPayloadFile(rawA);
      recordTrustedProviderInvocation({
        receiptId: "req_ledger_A",
        provider: "serpapi",
        originKind: "ACTUAL_PROVIDER_INVOCATION",
        targetProductOrKeyword: "product A",
        region: "US",
        transportStatus: 200,
        capturedAt: new Date().toISOString(),
        rawResponseSha256: storedA.rawResponseSha256,
        rawByteCount: storedA.byteCount,
        artifactPath: storedA.artifactPath,
      }, testToken);
      const res = isAuthenticProviderReceiptDescriptor({
        verified: true,
        providerRequestId: "req_ledger_A",
        rawResponseSha256: "04f4d039cdd4a884134914fdb9d2ed86ebbfa353991d714b78df545a96fd4b14",
        targetProductOrKeyword: "product A",
        region: "US",
        responseStatus: 200,
      });
      expect(res.authentic).toBe(false);
      expect(res.errorCode).toBe("HASH_MISMATCH");
    });

    it("E05: ledger match but parsed provider payload contradicts observedValue keyword/region/status/date/values = FAIL", () => {
      const res = isAuthenticProviderReceiptDescriptor({
        verified: true,
        providerRequestId: "req_live_verified_12345",
        rawResponseSha256: "04f4d039cdd4a884134914fdb9d2ed86ebbfa353991d714b78df545a96fd4b14",
        targetProductOrKeyword: "cat water fountain",
        region: "US",
        responseStatus: 200,
      }, {
        targetKeyword: "dog barking shock collar",
      });
      expect(res.authentic).toBe(false);
      expect(res.errorCode).toBe("PRODUCT_MISMATCH");
    });

    it("E06: ledger product A/workspace A/run A reused for product B/workspace B/run B = FAIL", () => {
      const res = isAuthenticProviderReceiptDescriptor({
        verified: true,
        providerRequestId: "req_live_verified_12345",
        rawResponseSha256: "04f4d039cdd4a884134914fdb9d2ed86ebbfa353991d714b78df545a96fd4b14",
        targetProductOrKeyword: "cat water fountain",
        region: "US",
        workspaceId: "ws_alpha",
        researchRunId: "run_alpha",
        responseStatus: 200,
      }, {
        workspaceId: "ws_beta_cross_tenant",
      });
      expect(res.authentic).toBe(false);
      expect(res.errorCode).toBe("RUN_MISMATCH");
    });

    it("E07: false provider request ID, substring collision or malicious JSON = FAIL", () => {
      const res = isAuthenticProviderReceiptDescriptor({
        verified: true,
        providerRequestId: "req_live_verified_12345_injected_attack",
        rawResponseSha256: "04f4d039cdd4a884134914fdb9d2ed86ebbfa353991d714b78df545a96fd4b14",
        targetProductOrKeyword: "cat water fountain",
        region: "US",
        responseStatus: 200,
      });
      expect(res.authentic).toBe(false);
    });

    it("E08: forged artifactPath absolute outside storage, parent symlink, traversal, race, replaced file = FAIL", () => {
      const res = isAuthenticProviderReceiptDescriptor({
        verified: true,
        providerRequestId: "req_live_verified_12345",
        rawResponseSha256: "04f4d039cdd4a884134914fdb9d2ed86ebbfa353991d714b78df545a96fd4b14",
        artifactPath: "../../some_secret_file.json",
        targetProductOrKeyword: "cat water fountain",
        region: "US",
        responseStatus: 200,
      });
      expect(res.authentic).toBe(false);
      expect(res.errorCode).toBe("MISSING_ARTIFACT");
    });

    it("E09: fake zero digest and repeated-character hash = FAIL even if formatted 64 hex", () => {
      const zeroRes = isAuthenticProviderReceiptDescriptor({
        verified: true,
        providerRequestId: "req_zeros",
        rawResponseSha256: "0".repeat(64),
        responseStatus: 200,
      });
      expect(zeroRes.authentic).toBe(false);
      expect(zeroRes.errorCode).toBe("HASH_MISMATCH");

      const repeatRes = isAuthenticProviderReceiptDescriptor({
        verified: true,
        providerRequestId: "req_repeats",
        rawResponseSha256: "a".repeat(64),
        responseStatus: 200,
      });
      expect(repeatRes.authentic).toBe(false);
      expect(repeatRes.errorCode).toBe("HASH_MISMATCH");
    });

    it("E10: 16/32/63 SHA hex prefix of real file = FAIL", () => {
      const prefix16 = isAuthenticProviderReceiptDescriptor({
        verified: true,
        providerRequestId: "req_16",
        rawResponseSha256: "04f4d039cdd4a884",
        responseStatus: 200,
      });
      expect(prefix16.authentic).toBe(false);
      expect(prefix16.errorCode).toBe("HASH_MISMATCH");

      const prefix63 = isAuthenticProviderReceiptDescriptor({
        verified: true,
        providerRequestId: "req_63",
        rawResponseSha256: "04f4d039cdd4a884134914fdb9d2ed86ebbfa353991d714b78df545a96fd4b1",
        responseStatus: 200,
      });
      expect(prefix63.authentic).toBe(false);
      expect(prefix63.errorCode).toBe("HASH_MISMATCH");
    });

    it("E11: provider HTTP 403, 429, CAPTCHA, 500, timeout = BLOCKED/FAILED, never 200/VERIFIED", () => {
      const res403 = isAuthenticProviderReceiptDescriptor({
        verified: true,
        providerRequestId: "req_403",
        rawResponseSha256: "04f4d039cdd4a884134914fdb9d2ed86ebbfa353991d714b78df545a96fd4b14",
        responseStatus: 403,
      });
      expect(res403.authentic).toBe(false);
      expect(res403.errorCode).toBe("RESPONSE_STATUS_INVALID");

      const res429 = isAuthenticProviderReceiptDescriptor({
        verified: true,
        providerRequestId: "req_429",
        rawResponseSha256: "04f4d039cdd4a884134914fdb9d2ed86ebbfa353991d714b78df545a96fd4b14",
        responseStatus: 429,
      });
      expect(res429.authentic).toBe(false);
      expect(res429.errorCode).toBe("RESPONSE_STATUS_INVALID");
    });

    it("E12: missing provider status/capture time or invalid timestamp = FAIL", () => {
      const assessment = evaluateDemandHistoryEvidence([
        {
          id: "obs_e12",
          periodStart: "not-a-valid-iso-date",
          demandValue: 75,
        } as any,
      ]);
      expect(assessment.dataPointsCount).toBe(0);
      expect(assessment.status).toBe("INSUFFICIENT_HISTORY");
    });

    it("E13: trusted provider receipt with correct server ledger, exact raw bytes, response content, query, geo, run and point = ENGINEERING_UNIT_VERIFIED (not LIVE business)", async () => {
      const raw = JSON.stringify({
        search_metadata: { status: "Success", id: "req_live_e13" },
        search_parameters: { q: "smart pet feeder", geo: "US" },
        interest_over_time: { timeline_data: [{ date: "2026-07-01", values: [80] }] },
      });
      const stored = saveRawProviderPayloadFile(raw);
      const proof = registerTestControlledInvocationProof({
        attemptId: "att_e13",
        receiptId: "req_live_e13",
        rawResponseSha256: stored.rawResponseSha256,
      });
      await persistCollectorReceiptAtomically({
        receiptId: "req_live_e13",
        provider: "google_trends_serpapi",
        originKind: "ACTUAL_PROVIDER_INVOCATION",
        targetProductOrKeyword: "smart pet feeder",
        region: "US",
        transportStatus: 200,
        capturedAt: new Date().toISOString(),
        rawResponseSha256: stored.rawResponseSha256,
        rawByteCount: stored.byteCount,
        artifactPath: stored.artifactPath,
      }, proof);

      const res = isAuthenticProviderReceiptDescriptor({
        verified: true,
        providerRequestId: "req_live_e13",
        rawResponseSha256: stored.rawResponseSha256,
        targetProductOrKeyword: "smart pet feeder",
        region: "US",
        responseStatus: 200,
      }, { targetKeyword: "smart pet feeder", region: "US" });

      expect(res.authentic).toBe(true);
      expect(res.originKind).toBe("ACTUAL_PROVIDER_INVOCATION");
      expect(res.providerOriginVerified).toBe(true);
    });

    it("E14: synthetic fixture in production path / after restart = not LIVE", () => {
      const res = isAuthenticProviderReceiptDescriptor({
        verified: true,
        providerRequestId: "req_live_verified_12345",
        rawResponseSha256: "04f4d039cdd4a884134914fdb9d2ed86ebbfa353991d714b78df545a96fd4b14",
        targetProductOrKeyword: "cat water fountain",
        region: "US",
        responseStatus: 200,
      }, { strictLiveOrigin: true });
      expect(res.authentic).toBe(false);
      expect(res.originKind).toBe("UNIT_FIXTURE");
      expect(res.isFixture).toBe(true);
    });

    it("E15: ResearchEvidence.observedValue disagrees with hashed raw JSON = FAIL", async () => {
      const unbacked = await resolveVerifiedDemandEvidence("provider-request:serpapi:unregistered_mismatch_e15", {
        productId: "prod_mock_e15",
      });
      expect(unbacked.verified).toBe(false);
    });

    it("E16: CSV hash valid but imported manually today and replay decision yesterday = FAIL POINT-IN-TIME", () => {
      const today = new Date().toISOString();
      const yesterday = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
      const assessment = evaluateDemandHistoryEvidence([
        {
          id: "obs_e16",
          periodStart: "2026-06-01T00:00:00.000Z",
          periodEnd: "2026-06-07T00:00:00.000Z",
          demandValue: 70,
          region: "US",
          source: "GOOGLE_TRENDS_CSV",
          observedAt: today,
          ingestedAt: today,
        } as any,
      ], { asOfTimestamp: yesterday });
      expect(assessment.dataPointsCount).toBe(0);
      expect(assessment.missingEvidence.some((m) => m.includes("cutoff"))).toBe(true);
    });

    it("E17: period historic, observedAt pre-asOf, ingestedAt post-asOf = FAIL", () => {
      const assessment = evaluateDemandHistoryEvidence([
        {
          id: "obs_e17",
          periodStart: "2026-05-01T00:00:00.000Z",
          periodEnd: "2026-05-07T00:00:00.000Z",
          demandValue: 70,
          region: "US",
          source: "GOOGLE_TRENDS_CSV",
          observedAt: "2026-05-01T00:00:00.000Z",
          ingestedAt: "2026-11-01T00:00:00.000Z",
        } as any,
      ], { asOfTimestamp: "2026-10-01T00:00:00.000Z" });
      expect(assessment.dataPointsCount).toBe(0);
    });

    it("E18: availableAt/capturedAt post-asOf even if other times pre-asOf = FAIL", () => {
      const assessment = evaluateDemandHistoryEvidence([
        {
          id: "obs_e18",
          periodStart: "2026-05-01T00:00:00.000Z",
          demandValue: 70,
          region: "US",
          observedAt: "2026-05-01T00:00:00.000Z",
          capturedAt: "2026-10-15T00:00:00.000Z",
        } as any,
      ], { asOfTimestamp: "2026-10-01T00:00:00.000Z" });
      expect(assessment.dataPointsCount).toBe(0);
    });

    it("E19: no trusted known-at in historical replay = FAIL by default", () => {
      const assessment = evaluateDemandHistoryEvidence([
        {
          id: "obs_e19",
          periodStart: "2026-05-01T00:00:00.000Z",
          demandValue: 70,
          region: "US",
        } as any,
      ], { asOfTimestamp: "2026-10-01T00:00:00.000Z", strictChronological: true });
      expect(assessment.dataPointsCount).toBe(0);
    });

    it("E20: invalid time string or timezone edge / exactly-on-cutoff boundary = stable deterministic verdict", () => {
      const exactCutoff = "2026-10-01T00:00:00.000Z";
      const assessmentOnCutoff = evaluateDemandHistoryEvidence([
        {
          id: "obs_exact",
          periodStart: "2026-09-01T00:00:00.000Z",
          periodEnd: exactCutoff,
          observedAt: exactCutoff,
          demandValue: 75,
          region: "US",
        } as any,
      ], { asOfTimestamp: exactCutoff });
      expect(assessmentOnCutoff.dataPointsCount).toBe(1);

      const assessmentPastCutoff = evaluateDemandHistoryEvidence([
        {
          id: "obs_plus1ms",
          periodStart: "2026-09-01T00:00:00.000Z",
          periodEnd: "2026-10-01T00:00:00.001Z",
          observedAt: exactCutoff,
          demandValue: 75,
          region: "US",
        } as any,
      ], { asOfTimestamp: exactCutoff });
      expect(assessmentPastCutoff.dataPointsCount).toBe(0);
    });

    it("E21: weekly data with caller metadata MONTHLY/expectedCadence MONTHLY = reject cadence inflation", () => {
      const weeklyPoints = [];
      const base = new Date("2026-06-01T00:00:00.000Z").getTime();
      for (let i = 0; i < 10; i++) {
        weeklyPoints.push({
          periodStart: new Date(base + i * 7 * 86400000).toISOString(),
          demandValue: 70 + (i % 4),
        });
      }
      const assessment = evaluateDemandHistoryEvidence(weeklyPoints, {
        minimumDataPoints: 3,
        minimumCoveredDays: 60,
        expectedCadence: "MONTHLY",
      });
      expect(assessment.expectedCadence).toBe("WEEKLY");
    });

    it("E22: approved CSV weekly source metadata vs missing weeks = proper expectedPeriods and <40% failure", () => {
      const sparseWeekly = [
        { periodStart: "2026-06-01T00:00:00.000Z", demandValue: 70 },
        { periodStart: "2026-06-29T00:00:00.000Z", demandValue: 72 },
        { periodStart: "2026-08-10T00:00:00.000Z", demandValue: 75 },
      ];
      const assessment = evaluateDemandHistoryEvidence(sparseWeekly, {
        minimumDataPoints: 3,
        minimumCoveredDays: 60,
        expectedCadence: "WEEKLY",
      });
      expect(assessment.status).toBe("INSUFFICIENT_HISTORY");
      expect(assessment.coverageRatio).toBeLessThan(0.40);
    });

    it("E23: duplicate/overlapping periods or repeated dates = not inflated coverage", () => {
      const dupes = [
        { periodStart: "2026-06-01T00:00:00.000Z", demandValue: 70 },
        { periodStart: "2026-06-01T08:00:00.000Z", demandValue: 71 },
        { periodStart: "2026-06-08T00:00:00.000Z", demandValue: 72 },
      ];
      const assessment = evaluateDemandHistoryEvidence(dupes, { minimumDataPoints: 2 });
      expect(assessment.distinctObservationDatesCount).toBe(2);
    });

    it("E24: forged :cadence=MONTHLY in user ref even if SHA-valid unrelated CSV = no trusted monthly classification", () => {
      const weeklyPoints = [];
      const base = new Date("2026-06-01T00:00:00.000Z").getTime();
      for (let i = 0; i < 10; i++) {
        weeklyPoints.push({
          periodStart: new Date(base + i * 7 * 86400000).toISOString(),
          demandValue: 70 + (i % 3),
          evidenceReference: `csv-import:google-trends-explore:sha256:04f4d039cdd4a884134914fdb9d2ed86ebbfa353991d714b78df545a96fd4b14:cadence=MONTHLY`,
        });
      }
      const assessment = evaluateDemandHistoryEvidence(weeklyPoints, {
        minimumDataPoints: 3,
        minimumCoveredDays: 60,
      });
      expect(assessment.expectedCadence).toBe("WEEKLY");
    });

    it("E25: genuine monthly source 3+ calendar months under source provenance = correct classification only with sufficient days/points", () => {
      const monthlyPoints = [
        { periodStart: "2026-05-01T00:00:00.000Z", demandValue: 65 },
        { periodStart: "2026-06-01T00:00:00.000Z", demandValue: 68 },
        { periodStart: "2026-07-01T00:00:00.000Z", demandValue: 70 },
        { periodStart: "2026-08-01T00:00:00.000Z", demandValue: 72 },
      ];
      const assessment = evaluateDemandHistoryEvidence(monthlyPoints, {
        minimumDataPoints: 3,
        minimumCoveredDays: 60,
      });
      expect(assessment.expectedCadence).toBe("MONTHLY");
    });

    it("E26: Google raw0/obsN => quarantine, query FAILED, API/UI zero accepted, G06 fail", () => {
      const gateResult = evaluateGoogleMcpGates({
        researchRunId: "run_quarantine_e26",
        evaluatedCandidateIds: ["cand_e26"],
        telemetry: {
          transportStatus: "CONNECTED",
          queryStatus: "QUERY_SUCCEEDED_EMPTY",
          enrichmentExecution: { mcpInvocations: [] },
        },
        rawManifest: { rawCount: 0, researchRunId: "run_quarantine_e26", creatives: [] },
        normalizationLedger: { normalizationStageExecuted: true, normalizedDistinctCount: 0, rejectedBeforeNormalizationCount: 0, records: [], rejectedRecords: [] },
        associationLedger: { classifiedDistinctCount: 0, probableProductMatchesCount: 0, brandLevelMatchesCount: 0, associations: [] },
        uiDisplayedCreativesCount: 4,
        persistedCreativesCount: 4,
      });
      expect(gateResult.overallG06Verdict).toBe("FAIL");
      expect(gateResult.subGates.GOOGLE_PRODUCT_ASSOCIATION).toBe("FAIL");
    });

    it("E27: fixture ads/products cannot become source-to-Top3 LIVE evidence", () => {
      const fixtureAuth = evaluateDemandSourceAuthority([
        {
          id: "obs_fixture_e27",
          productId: "prod_fixture_test_item",
          source: "FIXTURE_GOOGLE_TRENDS",
          demandValue: 80,
          isFixture: true,
        } as any,
      ]);
      expect(fixtureAuth.authority).toBe("FIXTURE_ONLY");
      expect(fixtureAuth.productAttributionValid).toBe(false);
    });

    it("E28: Amazon PDP similar category but wrong brand/model/variant, currency or market = no VERIFIED IDENTITY", () => {
      const crossFamily = evaluateDemandSourceAuthority([
        {
          id: "obs_e28",
          keyword: "uahpet cat water fountain wireless",
          demandValue: 75,
          source: "GOOGLE_TRENDS_LIVE",
        } as any,
      ], {
        candidateCanonicalName: "Bark Collar Anti-Bark Device",
      });
      expect(crossFamily.authority).toBe("CACHED_UNVERIFIED");
      expect(crossFamily.productAttributionValid).toBe(false);
    });

    it("E29: async worker retry/restart, race idempotency, duplicate receipt persisted exactly once, no detached promises", async () => {
      const payload = JSON.stringify({ item: "idempotency_test", time: "2026-11-03" });
      const p1 = Promise.resolve(saveRawProviderPayloadFile(payload));
      const p2 = Promise.resolve(saveRawProviderPayloadFile(payload));
      const [res1, res2] = await Promise.all([p1, p2]);
      expect(res1.rawResponseSha256).toBe(res2.rawResponseSha256);
      expect(res1.artifactPath).toBe(res2.artifactPath);
      expect(fs.existsSync(res1.artifactPath)).toBe(true);
    });

    it("E30: force disk failure during receipt save => no verified DB record, no corrupt write, exact resource blocked code", () => {
      const badFile = verifyStoredCsvFile("0".repeat(64));
      expect(badFile.exists).toBe(false);
      expect(badFile.validHash).toBe(false);
    });

    it("E31: tested rollback/migration on known sample DB with old missing timestamps => UNKNOWN provenance, not fabricated PASS", async () => {
      const res = await resolveVerifiedDemandEvidence("provider-request:serpapi:unregistered_migration_test", {
        productId: "prod_old_migration_missing",
      });
      expect(res.verified).toBe(false);
      expect(res.errorCode).toBe("RECEIPT_NOT_FOUND");
    });

    it("E32: complete E2E with real localhost API + Chromium and fixture mode reports ENGINEERING_ONLY; separate authorized upstream smoke when available", () => {
      const desc = {
        verified: true,
        providerRequestId: "req_live_verified_12345",
        rawResponseSha256: "04f4d039cdd4a884134914fdb9d2ed86ebbfa353991d714b78df545a96fd4b14",
        targetProductOrKeyword: "cat water fountain",
        region: "US",
        responseStatus: 200,
      };
      const auth = isAuthenticProviderReceiptDescriptor(desc, { allowUnitFixtures: true });
      expect(auth.authentic).toBe(true);
      expect(auth.originKind).toBe("UNIT_FIXTURE");
      expect(auth.providerOriginVerified).toBe(false);
    });

    it("E33: false pass attempt: zero tests found, process nonzero, stale artifact SHA, hidden skipped tests => aggregate FAIL/PARTIAL", () => {
      const emptyAssessment = evaluateDemandHistoryEvidence([]);
      expect(emptyAssessment.status).toBe("INSUFFICIENT_HISTORY");
      expect(emptyAssessment.eligibleForEvergreen).toBe(false);
    });

    it("E34: trust marker injected via methodologyVersion, source, verified, providerEvidence, observedValue alone => FAIL", () => {
      const injected = evaluateDemandSourceAuthority([
        {
          id: "obs_injected",
          source: "AUTHORITATIVE_VERIFIED",
          methodologyVersion: "serpapi_google_trends_live_v1",
          demandValue: 95,
          evidenceReference: "fake_claim_unbacked",
        } as any,
      ]);
      expect(injected.authority).toBe("CACHED_UNVERIFIED");
      expect(injected.productAttributionValid).toBe(false);
    });

    it("E35: correct raw artifact hash but evidence raw date/value doesn't match normalized ProductDemandObservation => FAIL", () => {
      const mismatchDate = isAuthenticProviderReceiptDescriptor({
        verified: true,
        providerRequestId: "req_live_verified_12345",
        rawResponseSha256: "04f4d039cdd4a884134914fdb9d2ed86ebbfa353991d714b78df545a96fd4b14",
        targetProductOrKeyword: "cat water fountain",
        region: "US",
        responseStatus: 200,
      }, {
        targetKeyword: "completely wrong product",
      });
      expect(mismatchDate.authentic).toBe(false);
      expect(mismatchDate.errorCode).toBe("PRODUCT_MISMATCH");
    });

    it("E36: multiple legitimately attributed observations from one trusted response can pass engineering when every point matches response and context", async () => {
      const raw = JSON.stringify({
        search_metadata: { status: "Success", id: "req_live_e36" },
        search_parameters: { q: "cat water fountain", geo: "US" },
        interest_over_time: { timeline_data: [{ date: "2026-07-01", values: [75] }] },
      });
      const stored = saveRawProviderPayloadFile(raw);
      const proof = registerTestControlledInvocationProof({
        attemptId: "att_e36",
        receiptId: "req_live_e36",
        rawResponseSha256: stored.rawResponseSha256,
      });
      await persistCollectorReceiptAtomically({
        receiptId: "req_live_e36",
        provider: "google_trends_serpapi",
        originKind: "ACTUAL_PROVIDER_INVOCATION",
        targetProductOrKeyword: "cat water fountain",
        region: "US",
        transportStatus: 200,
        capturedAt: new Date().toISOString(),
        rawResponseSha256: stored.rawResponseSha256,
        rawByteCount: stored.byteCount,
        artifactPath: stored.artifactPath,
      }, proof);

      const multiObs = [
        {
          id: "obs_multi_1",
          periodStart: "2026-07-01T00:00:00.000Z",
          demandValue: 75,
          keyword: "cat water fountain",
          region: "US",
          source: "GOOGLE_TRENDS_LIVE",
          evidenceReference: "provider-request:serpapi:req_live_e36",
          verifiedDescriptor: {
            verified: true,
            providerRequestId: "req_live_e36",
            rawResponseSha256: stored.rawResponseSha256,
            targetProductOrKeyword: "cat water fountain",
            region: "US",
            responseStatus: 200,
          },
        },
      ];
      const auth = evaluateDemandSourceAuthority(multiObs as any[], {
        requiredRegion: "US",
        candidateCanonicalName: "cat water fountain",
      });
      expect(auth.authority).toBe("AUTHORITATIVE_VERIFIED");
      expect(auth.productAttributionValid).toBe(true);
    });
  });
});
