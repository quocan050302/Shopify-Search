import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import os from "os";
import {
  normalizeObservationIdentity,
  isAuthenticallyLiveObservation,
  belongsToCurrentResearchRun,
  belongsToCandidateProduct,
  extractMerchantProofRefs,
  hasVerifiedMerchantIdentity,
  resolveCanonicalProductKey,
  evaluateG16Candidate,
  evaluateG16Top3,
  runG16NegativeTests,
} from "../../../scripts/kh02/g16CandidateEvaluator";
import {
  normalizeProductTitleForParity,
  reconcileSqliteHttpChromium,
  assessReadOnlyMutation,
  computeChromiumGate,
  runChromiumFailureInjections,
  type PersistedSqliteRunSnapshot,
} from "../../../scripts/kh02/chromiumAcceptanceService";
import {
  isExplicitlyLiveGoogleCreative,
  hasVerifiedExactProductAssociationEvidence,
  evaluateGoogleMcpGates,
  runGoogleGateNegativeTests,
} from "../../../scripts/kh02/googleMcpGateEvaluator";
import {
  resolvePointInTimeAdCandidateMetadata,
  runPolicyScenarioTests,
} from "../../../scripts/kh02/runBacktestV12_4_3_4_2";
import {
  MANDATORY_ACCEPTANCE_ARTIFACTS,
  validateAcceptanceArtifacts,
  runNegativeControlSuite,
} from "../../../scripts/kh02/acceptanceValidatorV12_4_3_4_5";
import { writeCanonicalValidBaselineFixture } from "../../../scripts/kh02/runFivePhaseAutoClosure";
import { SWAI_KH02_RELEASE_VERSION } from "../../../src/services/kh02/version/runtimeVersionService";

describe("V12.4.3.4.6 — Strict Lineage, Real Parity & Acceptance Truth", () => {
  it("exposes release version 12.4.3.4.6 or 12.4.3.4.7", () => {
    expect(["12.4.3.4.6", "12.4.3.4.7"]).toContain(SWAI_KH02_RELEASE_VERSION);
  });

  describe("Phase 1: Strict G16 Live Observation Lineage, Merchant Proof & Top-3 Distinctness", () => {
    const runId = "run-v124346-test";

    it("enforces pure helper predicates for observation lineage and merchant proof", () => {
      const norm = normalizeObservationIdentity({
        sourceObservationId: "obs-100",
        sourceRecordId: "ad-100",
        provenance: "LIVE_PROVIDER",
        sourceMode: "LIVE_PROVIDER",
        isCached: false,
        researchRunId: runId,
        providerRequestId: "req-1",
      });
      expect(norm.observationId).toBe("obs-100");
      expect(norm.sourceRecordId).toBe("ad-100");
      expect(norm.isCached).toBe(false);

      // isAuthenticallyLiveObservation rejects missing live markers or cached observations
      expect(isAuthenticallyLiveObservation({ sourceObservationId: "o1" })).toBe(false);
      expect(
        isAuthenticallyLiveObservation({
          sourceObservationId: "o1",
          sourceRecordId: "ad-1",
          isCached: true,
          provenance: "REAL_UPSTREAM",
          sourceMode: "LIVE_PROVIDER",
          providerRequestId: "req-1",
        })
      ).toBe(false);
      expect(
        isAuthenticallyLiveObservation({
          sourceObservationId: "o1",
          sourceRecordId: "ad-1",
          isCached: false,
          sourceMode: "LIVE_PROVIDER",
          provenance: "REAL_UPSTREAM",
          providerRequestId: "req-1",
        })
      ).toBe(true);

      // belongsToCurrentResearchRun rejects missing/blank researchRunId or executionRunId
      expect(belongsToCurrentResearchRun({ sourceObservationId: "o1" }, runId)).toBe(false);
      expect(
        belongsToCurrentResearchRun({ sourceObservationId: "o1", researchRunId: "" }, runId)
      ).toBe(false);
      expect(
        belongsToCurrentResearchRun({ sourceObservationId: "o1", researchRunId: runId }, "")
      ).toBe(false);
      expect(
        belongsToCurrentResearchRun({ sourceObservationId: "o1", researchRunId: runId }, runId)
      ).toBe(true);

      // belongsToCandidateProduct checks candidateId / supportingAdIds / URL / domain linkage
      const cand = {
        candidateId: "cand-1",
        storeDomain: "pawtech.com",
        canonicalProductUrl: "https://pawtech.com/products/smart-feeder",
        supportingAdIds: ["ad-1"],
      };
      expect(
        belongsToCandidateProduct({ sourceObservationId: "obs-1", sourceRecordId: "ad-1" }, cand)
      ).toBe(true);
      expect(
        belongsToCandidateProduct(
          { sourceObservationId: "obs-other", storeDomain: "other.com" },
          cand
        )
      ).toBe(false);

      // Merchant identity requires independent verification proof, not just domain + canonicalUrl
      expect(
        hasVerifiedMerchantIdentity({
          storeDomain: "pawtech.com",
          canonicalProductUrl: "https://pawtech.com/products/smart-feeder",
          identityStatus: "VERIFIED",
        })
      ).toBe(false);

      expect(
        hasVerifiedMerchantIdentity({
          storeDomain: "pawtech.com",
          canonicalProductUrl: "https://pawtech.com/products/smart-feeder",
          identityStatus: "VERIFIED",
          fetchOutcome: "FETCH_SUCCEEDED",
          merchantVerifiedProductName: "Smart Pet Feeder",
        })
      ).toBe(true);

      // CheckoutChamp funnel domain is rejected even with fetchOutcome
      expect(
        hasVerifiedMerchantIdentity({
          storeDomain: "cc.uprootclean.com",
          canonicalProductUrl: "https://cc.uprootclean.com/products/pro",
          identityStatus: "VERIFIED",
          fetchOutcome: "FETCH_SUCCEEDED",
          merchantVerifiedProductName: "Uproot Pro",
        })
      ).toBe(false);
    });

    it("rejects candidate.liveObservationsCount fallback when sourceObservations are empty or lack runId", () => {
      const candidate = {
        candidateId: "cand-fallback",
        title: "Smart Automatic Pet Feeder",
        storeDomain: "pawtech.com",
        canonicalProductUrl: "https://pawtech.com/products/smart-feeder",
        familyKey: "pet_feeder",
        identityStatus: "VERIFIED",
        fetchOutcome: "FETCH_SUCCEEDED",
        merchantVerifiedProductName: "Smart Automatic Pet Feeder",
        liveObservationsCount: 5,
        supportingAdIds: ["ad-1"],
        sourceObservations: [],
      };

      const resNoObs = evaluateG16Candidate(candidate, runId);
      expect(resNoObs.validLineageObservationsCount).toBe(0);
      expect(resNoObs.isLiveVerified).toBe(false);
      expect(resNoObs.rejectionReasons.join(" ")).toContain("zero sourceObservations");

      const resMissingRunId = evaluateG16Candidate(
        {
          ...candidate,
          sourceObservations: [
            {
              sourceObservationId: "obs-1",
              sourceRecordId: "ad-1",
              candidateId: "cand-fallback",
              sourceMode: "LIVE_PROVIDER",
              provenance: "REAL_UPSTREAM",
              isCached: false,
              providerRequestId: "req-1",
              // researchRunId missing!
            },
          ],
        },
        runId
      );
      expect(resMissingRunId.validLineageObservationsCount).toBe(0);
      expect(resMissingRunId.isLiveVerified).toBe(false);
    });

    it("enforces Top-3 distinct canonical products and distinct families in evaluateG16Top3", () => {
      const makeCand = (id: string, domain: string, slug: string, family: string) => ({
        candidateId: id,
        title: `Product ${id}`,
        storeDomain: domain,
        canonicalProductUrl: `https://${domain}/products/${slug}`,
        familyKey: family,
        identityStatus: "VERIFIED",
        fetchOutcome: "FETCH_SUCCEEDED",
        merchantVerifiedProductName: `Product ${id}`,
        supportingAdIds: [`ad-${id}`],
        sourceObservations: [
          {
            sourceObservationId: `obs-${id}`,
            sourceRecordId: `ad-${id}`,
            candidateId: id,
            storeDomainEvidence: domain,
            sourceMode: "LIVE_PROVIDER",
            provenance: "REAL_UPSTREAM",
            isCached: false,
            researchRunId: runId,
            providerRequestId: `req-${id}`,
          },
        ],
      });

      // Duplicate family -> INSUFFICIENT_EVIDENCE
      const dupFamilyRes = evaluateG16Top3(
        [
          makeCand("c1", "a.com", "p1", "FAM_FEEDER"),
          makeCand("c2", "b.com", "p2", "FAM_FEEDER"),
          makeCand("c3", "c.com", "p3", "FAM_FOUNTAIN"),
        ],
        runId,
        { requireDistinctFamilies: true }
      );
      expect(dupFamilyRes.verifiedLiveCount).toBe(3);
      expect(dupFamilyRes.distinctFamiliesCount).toBe(2);
      expect(dupFamilyRes.g16Verdict).toBe("INSUFFICIENT_EVIDENCE");

      // 3 distinct canonical products + 3 distinct families -> PASS
      const passRes = evaluateG16Top3(
        [
          makeCand("c1", "a.com", "p1", "FAM_FEEDER"),
          makeCand("c2", "b.com", "p2", "FAM_LITTER"),
          makeCand("c3", "c.com", "p3", "FAM_FOUNTAIN"),
        ],
        runId,
        { requireDistinctFamilies: true }
      );
      expect(passRes.g16Verdict).toBe("PASS");
    });

    it("passes all 13 deterministic G16 matrix scenarios (G16-MAT-A through G16-MAT-M)", () => {
      const suite = runG16NegativeTests();
      expect(suite.cases).toHaveLength(13);
      expect(suite.passed).toBe(true);
    });
  });

  describe("Phase 2: Three-System Parity (SQLite <-> HTTP API <-> Chromium DOM) & Read-Only Content Integrity", () => {
    it("requires persistedDbSnapshot from SQLite and compares DB_VS_HTTP, DB_VS_DOM, HTTP_VS_DOM", () => {
      const noSqlite = reconcileSqliteHttpChromium({
        workspaceId: "ws-1",
        runId: "run-1",
        persistedDbSnapshot: null,
        httpOverviewResponses: [],
        domData: null,
      });
      expect(noSqlite.persistedFromSqliteVerified).toBe(false);
      expect(noSqlite.dbVsHttpVerdict).toBe("FAIL");

      const snapshot: PersistedSqliteRunSnapshot = {
        persistedFromSqlite: true,
        workspaceId: "ws-1",
        researchRunId: "run-1",
        syncJobId: "job-1",
        status: "COMPLETED",
        persistedAt: "2026-10-31T00:00:00.000Z",
        candidates: [
          {
            candidateId: "c1",
            researchProductId: "prod-1",
            rank: 1,
            title: "Smart Pet Water Fountain Pro",
            storeDomain: "hydropaw.com",
            canonicalProductUrl: "https://hydropaw.com/products/fountain-pro",
            identityStatus: "VERIFIED",
            familyKey: "pet_fountain",
            score: 78,
            persistedObservationCount: 2,
            persistedResearchProductExists: true,
          },
        ],
      };

      // Prefix-only DOM title must FAIL exact normalized title parity
      const prefixMismatch = reconcileSqliteHttpChromium({
        workspaceId: "ws-1",
        runId: "run-1",
        persistedDbSnapshot: snapshot,
        httpOverviewResponses: [
          {
            candidateId: "c1",
            statusCode: 200,
            ok: true,
            body: {
              data: {
                kh02ResearchContext: {
                  researchRunId: "run-1",
                  candidateId: "c1",
                  title: "Smart Pet Water Fountain Pro",
                  storeDomain: "hydropaw.com",
                  identityStatus: "VERIFIED",
                  rank: 1,
                  opportunityScore: 78,
                },
              },
            },
          },
        ],
        domData: {
          domRunId: "run-1",
          cardCount: 1,
          cards: [
            {
              candidateId: "c1",
              rank: 1,
              title: "Smart Pet Water Deluxe Max", // shares 15-char prefix "Smart Pet Water"
              storeDomain: "hydropaw.com",
              identityStatus: "VERIFIED",
              score: 78,
            },
          ],
        },
      });
      expect(prefixMismatch.dbVsHttpVerdict).toBe("PASS");
      expect(prefixMismatch.dbVsDomVerdict).toBe("FAIL");
      expect(prefixMismatch.httpVsDomVerdict).toBe("FAIL");
      expect(prefixMismatch.chromiumParityPassed).toBe(false);
    });

    it("detects in-place row update via SHA-256 content digest even when row counts stay identical", async () => {
      let mutated = false;
      const mockDb = {
        syncJob: {
          findMany: async () => [
            {
              id: "job-1",
              workspaceId: "ws-1",
              jobType: "RESEARCH",
              status: mutated ? "TAMPERED_STATUS" : "COMPLETED",
              progress: 100,
              totalItems: 3,
              errorMessage: null,
              resultJson: "{}",
              startedAt: new Date("2026-10-31T00:00:00.000Z"),
              completedAt: new Date("2026-10-31T00:01:00.000Z"),
              createdAt: new Date("2026-10-31T00:00:00.000Z"),
            },
          ],
        },
        researchProduct: { findMany: async () => [] },
        competitorStore: { findMany: async () => [] },
        adProductLink: { findMany: async () => [] },
        evergreenProductScore: { findMany: async () => [] },
      };

      const check = await assessReadOnlyMutation(async () => {
        mutated = true;
        return { statusCode: 200, ok: true, body: { data: [] } };
      }, mockDb);

      expect(check.rowCountsMatch).toBe(true);
      expect(check.contentDigestsMatch).toBe(false);
      expect(check.mutatedTables).toContain("syncJob");
      expect(check.readOnlyPassed).toBe(false);
    });

    it("passes all 11 Chromium failure injection scenarios (CR-FAIL-01 through CR-FAIL-11)", async () => {
      const suite = await runChromiumFailureInjections();
      expect(suite.results).toHaveLength(11);
      expect(suite.passed).toBe(true);
    });
  });

  describe("Phase 3: Google MCP Explicit Live Provenance, Set Reconciliation & Association Truth", () => {
    it("rejects creatives with undefined isCached or missing providerRequestId/mcpInvocationRef", () => {
      expect(
        isExplicitlyLiveGoogleCreative(
          {
            creativeId: "cr-1",
            sourceMode: "LIVE_PROVIDER",
            provenance: "REAL_UPSTREAM",
            researchRunId: "run-1",
            observedAt: "2026-10-31T00:00:00.000Z",
            providerRequestId: "req-1",
            // isCached undefined!
          },
          "run-1"
        )
      ).toBe(false);

      expect(
        isExplicitlyLiveGoogleCreative(
          {
            creativeId: "cr-1",
            isCached: false,
            sourceMode: "LIVE_PROVIDER",
            provenance: "REAL_UPSTREAM",
            researchRunId: "run-1",
            observedAt: "2026-10-31T00:00:00.000Z",
            providerRequestId: "req-1",
          },
          "run-1"
        )
      ).toBe(true);
    });

    it("passes all adversarial Google MCP negative scenarios (G06-NEG-01 through G06-NEG-15)", () => {
      const suite = runGoogleGateNegativeTests();
      expect(suite.cases.length).toBeGreaterThanOrEqual(10);
      expect(suite.passed).toBe(true);
    });
  });

  describe("Phase 4 & 5: Point-in-Time Joined Metadata Leakage Guard & 26 Physical-File Mutations", () => {
    it("rejects joined ResearchProduct metadata when product.updatedAt > asOf cutoff", () => {
      const asOf = new Date("2026-10-24T23:59:59.999Z");
      const ad = {
        id: "ad-100",
        firstSeenAt: new Date("2026-10-10T00:00:00.000Z"),
        headline: "Ad Headline At Cutoff",
        landingPageUrl: "https://shop.example.com/products/item",
        advertiserDomain: "shop.example.com",
      };
      const leakedLink = {
        createdAt: new Date("2026-10-10T00:00:00.000Z"),
        product: {
          id: "prod-1",
          title: "Future Updated Product Title",
          productUrl: "https://shop.example.com/products/item",
          createdAt: new Date("2026-10-10T00:00:00.000Z"),
          updatedAt: new Date("2026-10-28T00:00:00.000Z"), // > asOf!
        },
      };

      const resolved = resolvePointInTimeAdCandidateMetadata(ad, leakedLink, asOf);
      expect(resolved.trustedPointInTimeMetadata).toBe(false);
      expect(resolved.metadataProvenance).toBe("REJECTED_POST_CUTOFF_JOINED_METADATA");
      expect(resolved.title).toBe("Ad Headline At Cutoff");
    });

    it("passes all policy & leakage scenario tests in runBacktestV12_4_3_4_2", async () => {
      const report = await runPolicyScenarioTests();
      expect(report.totalScenarios).toBeGreaterThanOrEqual(8);
      expect(report.verdict).toBe("PASS");
      expect(report.scenarios.every((s) => s.passed)).toBe(true);
    });

    it("validates canonical 32-artifact fixture and catches all 26 physical-file mutations (MUT_01..MUT_26)", () => {
      expect(MANDATORY_ACCEPTANCE_ARTIFACTS).toHaveLength(32);

      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "kh02-v124346-unit-"));
      try {
        const sha = "a".repeat(40);
        writeCanonicalValidBaselineFixture(tmpDir, sha);

        const baseRes = validateAcceptanceArtifacts(tmpDir, {
          skipSelfMutationReportCheck: true,
        });
        expect(baseRes.failedChecks).toBe(0);
        expect(baseRes.overallValid).toBe(true);

        const negSuite = runNegativeControlSuite(tmpDir);
        expect(negSuite.totalMutations).toBeGreaterThanOrEqual(26);
        expect(negSuite.totalCaughtAndRejected).toBe(negSuite.totalMutations);
        expect(negSuite.suiteVerdict).toBe("PASS");
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    });
  });
});
