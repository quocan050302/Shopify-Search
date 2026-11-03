import { describe, it, expect } from "vitest";
import {
  hasVerifiableCsvOrProviderLineage,
  evaluateDemandSourceAuthority,
  evaluateDemandHistoryEvidence,
  evaluateTemporalDemandStability,
} from "@/services/kh02/demand/temporalDemandEngine";
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

    it("evaluateDemandSourceAuthority grants AUTHORITATIVE_VERIFIED only when observation carries verified provider receipt descriptor", () => {
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
          },
          keyword: "cat water fountain",
        } as any,
      ]);
      expect(authenticLive.authority).toBe("AUTHORITATIVE_VERIFIED");
      expect(authenticLive.productAttributionValid).toBe(true);
      expect(authenticLive.reasons.length).toBe(0);
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
        providerReceiptDescriptor: { verified: true, source: "GOOGLE_TRENDS_LIVE", responseStatus: 200 },
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
        providerReceiptDescriptor: { verified: true, source: "GOOGLE_TRENDS_LIVE", responseStatus: 200 },
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
        providerReceiptDescriptor: { verified: true, source: "GOOGLE_TRENDS_LIVE", responseStatus: 200 },
      });

      expect(assessment.dataPointsCount).toBe(1); // late-ingested point filtered out!
      expect(assessment.missingEvidence.some((m) => m.includes("as-of cutoff"))).toBe(true);
    });
  });
});
