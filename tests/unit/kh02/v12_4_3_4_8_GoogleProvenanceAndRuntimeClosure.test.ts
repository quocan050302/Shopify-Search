/**
 * SWAI KH-02 V12.4.3.4.8 — Google MCP Provenance Truth & Verified Runtime Closure Unit Suite
 *
 * Covers mandatory provenance scenarios P01..P20, Google MCP negative scenarios G06-NEG-01..20,
 * and 40 physical-file negative control mutations (MUT_01..MUT_40 / N01..N15).
 */

import fs from "fs";
import os from "os";
import path from "path";
import { describe, it, expect } from "vitest";
import { SWAI_KH02_RELEASE_VERSION } from "@/services/kh02/version/runtimeVersionService";
import {
  computeCanonicalPayloadHash,
  extractUpstreamGoogleRequestId,
  recordActualGoogleMcpInvocation,
  attachGoogleMcpCreativeProvenance,
  deduplicateGoogleCreatives,
  verifyGoogleInvocationLineage,
  isFakeOrLocalGoogleRequestId,
  isSyntheticGoogleCreativeId,
  isBotWallOrUnavailableResponse,
  normalizeGoogleAdsResponse,
} from "@/services/kh02/providers/googleTransparencyResearchAdapter";
import {
  normalizeObservationIdentity,
  isAuthenticallyLiveObservation,
  evaluateG16Candidate,
} from "../../../scripts/kh02/g16CandidateEvaluator";
import {
  isSyntheticProviderRequestId,
  isExplicitlyLiveGoogleCreative,
  evaluateGoogleMcpGates,
  runGoogleGateNegativeTests,
} from "../../../scripts/kh02/googleMcpGateEvaluator";
import {
  validateAcceptanceArtifacts,
  runNegativeControlSuite,
} from "../../../scripts/kh02/acceptanceValidatorV12_4_3_4_5";
import { writeCanonicalValidBaselineFixture } from "../../../scripts/kh02/runFivePhaseAutoClosure";

describe("KH-02 V12.4.3.4.8 — Google MCP Provenance Truth & Runtime Acceptance Closure", () => {
  it("exposes release version 12.4.3.4.8 or 12.4.3.4.9", () => {
    expect(["12.4.3.4.8", "12.4.3.4.9"]).toContain(SWAI_KH02_RELEASE_VERSION);
  });

  describe("P01–P20: End-to-End Google MCP Provenance & Lineage Scenarios", () => {
    it("P01: Upstream response contains real request_id -> providerRequestId equals exact upstream ID and providerRequestIdOrigin === 'UPSTREAM'", () => {
      const upstreamResponse = {
        request_id: "g_upstream_req_99182",
        creatives: [{ creative_id: "CR18441208625369186305", format: "video" }],
      };
      const extracted = extractUpstreamGoogleRequestId(
        upstreamResponse,
        upstreamResponse.creatives[0]
      );
      expect(extracted).toBe("g_upstream_req_99182");

      const invRecord = recordActualGoogleMcpInvocation(
        {
          mcpInvocationRef: "mcp_inv_run_101_uahpet.com_AR113_1",
          researchRunId: "run_101",
          workspaceId: "ws_1",
          domainQueried: "uahpet.com",
          advertiserId: "AR113",
          toolName: "get_advertiser_creatives",
          requestArgs: { advertiser_id: "AR113", limit: 3 },
          queryAttempted: true,
          upstreamCompleted: true,
          transportStatus: "CONNECTED",
          queryStatus: "PASSED",
          startedAtMs: 1000,
          completedAtMs: 1150,
        },
        upstreamResponse
      );

      expect(invRecord.upstreamProviderRequestId).toBe("g_upstream_req_99182");
      expect(invRecord.providerRequestId).toBe("g_upstream_req_99182");
      expect(invRecord.providerRequestIdOrigin).toBe("UPSTREAM");
      expect(invRecord.invocationStatus).toBe("SUCCEEDED");
      expect(invRecord.actualReturnedCreativeIds).toEqual(["CR18441208625369186305"]);

      const stamped = attachGoogleMcpCreativeProvenance(
        upstreamResponse.creatives[0],
        invRecord
      );
      expect(stamped.providerRequestId).toBe("g_upstream_req_99182");
      expect(stamped.providerRequestIdOrigin).toBe("UPSTREAM");
      expect(stamped.mcpInvocationRef).toBe("mcp_inv_run_101_uahpet.com_AR113_1");

      const lineage = verifyGoogleInvocationLineage(stamped, [invRecord], "run_101");
      expect(lineage.verified).toBe(true);
      expect(lineage.lineageMethod).toBe("UPSTREAM_PROVIDER_REQUEST_ID");
      expect(lineage.rejectionReasons).toEqual([]);
    });

    it("P02: Upstream response omits request_id -> providerRequestId === null, providerRequestIdOrigin === 'ABSENT', mcpInvocationRef populated", () => {
      const upstreamResponse = {
        creatives: [{ creative_id: "CR10608872651969527809", format: "image" }],
      };
      expect(
        extractUpstreamGoogleRequestId(upstreamResponse, upstreamResponse.creatives[0])
      ).toBeNull();

      const invRecord = recordActualGoogleMcpInvocation(
        {
          mcpInvocationRef: "mcp_inv_run_102_kittyspout.com_AR101_1",
          researchRunId: "run_102",
          workspaceId: "ws_1",
          domainQueried: "kittyspout.com",
          advertiserId: "AR101",
          toolName: "get_advertiser_creatives",
          requestArgs: { advertiser_id: "AR101", limit: 3 },
          queryAttempted: true,
          upstreamCompleted: true,
          transportStatus: "CONNECTED",
          queryStatus: "PASSED",
          startedAtMs: 2000,
          completedAtMs: 2180,
        },
        upstreamResponse
      );

      expect(invRecord.upstreamProviderRequestId).toBeNull();
      expect(invRecord.providerRequestId).toBeNull();
      expect(invRecord.providerRequestIdOrigin).toBe("ABSENT");
      expect(invRecord.mcpInvocationRef).toBe("mcp_inv_run_102_kittyspout.com_AR101_1");

      const stamped = attachGoogleMcpCreativeProvenance(
        upstreamResponse.creatives[0],
        invRecord
      );
      expect(stamped.providerRequestId).toBeNull();
      expect(stamped.upstreamProviderRequestId).toBeNull();
      expect(stamped.providerRequestIdOrigin).toBe("ABSENT");
      expect(stamped.mcpInvocationRef).toBe("mcp_inv_run_102_kittyspout.com_AR101_1");
      expect(stamped.responseEvidenceHash).toHaveLength(64);
    });

    it("P03: Local fallback google_mcp_${runId}_${domain}_${adv}_${ts} injected into providerRequestId is rejected everywhere", () => {
      const fakeId = "google_mcp_run_103_uahpet.com_AR113_1793424091548";
      expect(isFakeOrLocalGoogleRequestId(fakeId, "run_103")).toBe(true);
      expect(isSyntheticProviderRequestId(fakeId, "run_103")).toBe(true);
      expect(
        extractUpstreamGoogleRequestId({ request_id: fakeId }, null)
      ).toBeNull();

      const badCreative = {
        creativeId: "CR18441208625369186305",
        sourceMode: "LIVE_PROVIDER",
        provenance: "REAL_UPSTREAM",
        isCached: false,
        researchRunId: "run_103",
        providerRequestId: fakeId,
        providerRequestIdOrigin: "UPSTREAM",
        mcpInvocationRef: "mcp_inv_run_103_1",
      };
      const lineage = verifyGoogleInvocationLineage(badCreative, [], "run_103");
      expect(lineage.verified).toBe(false);
      expect(lineage.rejectionReasons).toContain(
        "SYNTHETIC_OR_LOCAL_PROVIDER_REQUEST_ID"
      );
      expect(isExplicitlyLiveGoogleCreative(badCreative, "run_103")).toBe(false);
    });

    it("P04: mcp_${runId} or mcpInvocationRef copied into providerRequestId is rejected", () => {
      const invRef = "mcp_inv_run_104_uahpet.com_AR113_1";
      const invRecord = recordActualGoogleMcpInvocation(
        {
          mcpInvocationRef: invRef,
          researchRunId: "run_104",
          queryAttempted: true,
          upstreamCompleted: true,
          transportStatus: "CONNECTED",
          queryStatus: "PASSED",
        },
        { creatives: [{ creative_id: "CR_104" }] }
      );

      const corruptedCreative = {
        creativeId: "CR_104",
        sourceMode: "LIVE_PROVIDER",
        provenance: "REAL_UPSTREAM",
        isCached: false,
        researchRunId: "run_104",
        providerRequestId: invRef,
        providerRequestIdOrigin: "UPSTREAM",
        mcpInvocationRef: invRef,
        responseEvidenceHash: invRecord.responseEvidenceHash,
      };

      const lineage = verifyGoogleInvocationLineage(
        corruptedCreative,
        [invRecord],
        "run_104"
      );
      expect(lineage.verified).toBe(false);
      expect(lineage.rejectionReasons).toContain(
        "PROVIDER_REQUEST_ID_EQUALS_MCP_INVOCATION_REF"
      );
    });

    it("P05: Creative without upstream request_id passes via VERIFIED_LOCAL_INVOCATION_ONLY when ledger record is complete and matches", () => {
      const upstreamResponse = {
        creatives: [{ creative_id: "CR_VALID_LOCAL_1", format: "video" }],
      };
      const invRecord = recordActualGoogleMcpInvocation(
        {
          mcpInvocationRef: "mcp_inv_run_105_uahpet.com_AR113_1",
          researchRunId: "run_105",
          workspaceId: "ws_1",
          domainQueried: "uahpet.com",
          advertiserId: "AR113",
          queryAttempted: true,
          upstreamCompleted: true,
          transportStatus: "CONNECTED",
          queryStatus: "PASSED",
        },
        upstreamResponse
      );
      const stamped = attachGoogleMcpCreativeProvenance(
        upstreamResponse.creatives[0],
        invRecord
      );

      const lineage = verifyGoogleInvocationLineage(
        stamped,
        [invRecord],
        "run_105",
        { expectedWorkspaceId: "ws_1" }
      );
      expect(lineage.verified).toBe(true);
      expect(lineage.lineageMethod).toBe("VERIFIED_LOCAL_INVOCATION_ONLY");
      expect(lineage.upstreamProviderRequestId).toBeNull();
      expect(lineage.providerRequestIdOrigin).toBe("ABSENT");
      expect(
        isExplicitlyLiveGoogleCreative(stamped, "run_105", [invRecord])
      ).toBe(true);
    });

    it("P06: Creative without upstream request_id fails when mcpInvocationRef is absent from invocationLedger", () => {
      const orphanCreative = {
        creativeId: "CR_ORPHAN_1",
        sourceMode: "LIVE_PROVIDER",
        provenance: "REAL_UPSTREAM",
        isCached: false,
        researchRunId: "run_106",
        providerRequestId: null,
        providerRequestIdOrigin: "ABSENT",
        mcpInvocationRef: "mcp_inv_run_106_missing",
        responseEvidenceHash: "a".repeat(64),
      };
      const lineage = verifyGoogleInvocationLineage(
        orphanCreative,
        [],
        "run_106"
      );
      expect(lineage.verified).toBe(false);
      expect(lineage.rejectionReasons).toContain(
        "MISSING_OR_UNMATCHED_MCP_INVOCATION_LEDGER_RECORD"
      );
      expect(
        isExplicitlyLiveGoogleCreative(orphanCreative, "run_106", [])
      ).toBe(false);
    });

    it("P07: Creative without upstream request_id fails when ledger entry has invocationStatus !== 'SUCCEEDED' or upstreamCompleted !== true", () => {
      const failedInv = recordActualGoogleMcpInvocation(
        {
          mcpInvocationRef: "mcp_inv_run_107_1",
          researchRunId: "run_107",
          queryAttempted: true,
          upstreamCompleted: false,
          invocationStatus: "TIMED_OUT",
          transportStatus: "FAILED",
          queryStatus: "FAILED",
        },
        { creatives: [{ creative_id: "CR_107" }] }
      );
      const creative = {
        creativeId: "CR_107",
        sourceMode: "LIVE_PROVIDER",
        provenance: "REAL_UPSTREAM",
        isCached: false,
        researchRunId: "run_107",
        providerRequestId: null,
        providerRequestIdOrigin: "ABSENT",
        mcpInvocationRef: "mcp_inv_run_107_1",
        responseEvidenceHash: failedInv.responseEvidenceHash,
      };
      const lineage = verifyGoogleInvocationLineage(
        creative,
        [failedInv],
        "run_107"
      );
      expect(lineage.verified).toBe(false);
      expect(lineage.rejectionReasons).toContain(
        "MCP_INVOCATION_NOT_COMPLETED_SUCCESSFULLY"
      );
    });

    it("P08: Creative without upstream request_id fails when creativeId is not in ledger actualReturnedCreativeIds", () => {
      const invRecord = recordActualGoogleMcpInvocation(
        {
          mcpInvocationRef: "mcp_inv_run_108_1",
          researchRunId: "run_108",
          queryAttempted: true,
          upstreamCompleted: true,
          transportStatus: "CONNECTED",
          queryStatus: "PASSED",
        },
        { creatives: [{ creative_id: "CR_OTHER" }] }
      );
      const unreturnedCreative = {
        creativeId: "CR_INJECTED_NOT_IN_SET",
        sourceMode: "LIVE_PROVIDER",
        provenance: "REAL_UPSTREAM",
        isCached: false,
        researchRunId: "run_108",
        providerRequestId: null,
        providerRequestIdOrigin: "ABSENT",
        mcpInvocationRef: "mcp_inv_run_108_1",
        responseEvidenceHash: invRecord.responseEvidenceHash,
      };
      const lineage = verifyGoogleInvocationLineage(
        unreturnedCreative,
        [invRecord],
        "run_108"
      );
      expect(lineage.verified).toBe(false);
      expect(lineage.rejectionReasons).toContain(
        "CREATIVE_ID_NOT_IN_INVOCATION_RETURNED_SET"
      );
    });

    it("P09: Creative without upstream request_id fails when responseEvidenceHash is missing or mismatches ledger", () => {
      const invRecord = recordActualGoogleMcpInvocation(
        {
          mcpInvocationRef: "mcp_inv_run_109_1",
          researchRunId: "run_109",
          queryAttempted: true,
          upstreamCompleted: true,
          transportStatus: "CONNECTED",
          queryStatus: "PASSED",
        },
        { creatives: [{ creative_id: "CR_109" }] }
      );
      const tamperedCreative = {
        creativeId: "CR_109",
        sourceMode: "LIVE_PROVIDER",
        provenance: "REAL_UPSTREAM",
        isCached: false,
        researchRunId: "run_109",
        providerRequestId: null,
        providerRequestIdOrigin: "ABSENT",
        mcpInvocationRef: "mcp_inv_run_109_1",
        responseEvidenceHash: "f".repeat(64),
      };
      const lineage = verifyGoogleInvocationLineage(
        tamperedCreative,
        [invRecord],
        "run_109"
      );
      expect(lineage.verified).toBe(false);
      expect(lineage.rejectionReasons).toContain(
        "RESPONSE_EVIDENCE_HASH_MISMATCH"
      );
    });

    it("P10: Creative fails when researchRunId mismatches targetRunId or ledger researchRunId", () => {
      const invRecord = recordActualGoogleMcpInvocation(
        {
          mcpInvocationRef: "mcp_inv_run_110_1",
          researchRunId: "run_old",
          queryAttempted: true,
          upstreamCompleted: true,
          transportStatus: "CONNECTED",
          queryStatus: "PASSED",
        },
        { creatives: [{ creative_id: "CR_110" }] }
      );
      const crossRunCreative = {
        creativeId: "CR_110",
        sourceMode: "LIVE_PROVIDER",
        provenance: "REAL_UPSTREAM",
        isCached: false,
        researchRunId: "run_old",
        providerRequestId: null,
        providerRequestIdOrigin: "ABSENT",
        mcpInvocationRef: "mcp_inv_run_110_1",
        responseEvidenceHash: invRecord.responseEvidenceHash,
      };
      const lineage = verifyGoogleInvocationLineage(
        crossRunCreative,
        [invRecord],
        "run_current"
      );
      expect(lineage.verified).toBe(false);
      expect(lineage.rejectionReasons).toContain("CREATIVE_RUN_ID_MISMATCH");
      expect(lineage.rejectionReasons).toContain(
        "INVOCATION_LEDGER_RUN_ID_MISMATCH"
      );
    });

    it("P11: Creative with missing upstream creative_id is never assigned cr_0 or google_cr_* and is rejected", () => {
      expect(isSyntheticGoogleCreativeId("cr_0")).toBe(true);
      expect(isSyntheticGoogleCreativeId("google_cr_AR123_0")).toBe(true);
      expect(isSyntheticGoogleCreativeId("CR18441208625369186305")).toBe(false);

      const dedup = deduplicateGoogleCreatives([
        { advertiser_id: "AR113", creative_id: null, format: "image" },
        { advertiser_id: "AR113", creative_id: "google_cr_AR113_0", format: "image" },
        { advertiser_id: "AR113", creative_id: "CR18441208625369186305", format: "video" },
      ]);
      expect(dedup.uniqueCreatives).toHaveLength(1);
      expect(dedup.uniqueCreatives[0].creativeId).toBe("CR18441208625369186305");
      expect(dedup.rejectedMissingIdCreatives).toHaveLength(2);
    });

    it("P12: Duplicate creative IDs across multiple invocations in the same run are deduplicated cleanly", () => {
      const dedup = deduplicateGoogleCreatives([
        { creative_id: "CR_DUP_1", advertiser_id: "AR1" },
        { creative_id: "CR_DUP_1", advertiser_id: "AR1" },
        { creative_id: "CR_UNIQUE_2", advertiser_id: "AR1" },
      ]);
      expect(dedup.uniqueCreatives).toHaveLength(2);
      expect(dedup.duplicateIdsDropped).toEqual(["CR_DUP_1"]);
    });

    it("P13: Timed-out, rate-limited, or bot-wall responses record failed/rate-limited invocation status and never fabricate live creatives", () => {
      expect(
        isBotWallOrUnavailableResponse({
          error: "429 Too Many Requests: Unusual traffic captcha detected",
        })
      ).toBe(true);

      const botInv = recordActualGoogleMcpInvocation(
        {
          mcpInvocationRef: "mcp_inv_run_113_1",
          researchRunId: "run_113",
          queryAttempted: true,
          upstreamCompleted: false,
          transportStatus: "CONNECTED",
          queryStatus: "RATE_LIMITED",
        },
        { error: "429 Too Many Requests: Unusual traffic captcha detected" }
      );
      expect(botInv.invocationStatus).toBe("BOT_BLOCKED");
      expect(botInv.actualReturnedCreativeIds).toEqual([]);
      expect(botInv.rawCountReturned).toBe(0);
    });

    it("P14: Cross-workspace isolation rejects creative/invocation from another workspace", () => {
      const invRecord = recordActualGoogleMcpInvocation(
        {
          mcpInvocationRef: "mcp_inv_run_114_1",
          researchRunId: "run_114",
          workspaceId: "workspace_B",
          queryAttempted: true,
          upstreamCompleted: true,
          transportStatus: "CONNECTED",
          queryStatus: "PASSED",
        },
        { creatives: [{ creative_id: "CR_114" }] }
      );
      const stamped = attachGoogleMcpCreativeProvenance(
        { creative_id: "CR_114" },
        invRecord
      );
      const lineage = verifyGoogleInvocationLineage(
        stamped,
        [invRecord],
        "run_114",
        { expectedWorkspaceId: "workspace_A" }
      );
      expect(lineage.verified).toBe(false);
      expect(lineage.rejectionReasons).toContain("WORKSPACE_ISOLATION_MISMATCH");
    });

    it("P15: Replay of persisted snapshot is classified as replayModeDetected === true and never passes live G06", () => {
      const g06 = evaluateGoogleMcpGates({
        researchRunId: "run_persisted_1",
        originalResearchRunId: "run_persisted_1",
        runExecutionMode: "REPLAY_CACHED_OR_PREVIOUS_RUN",
        evaluatedCandidateIds: ["c1"],
        telemetry: { transportStatus: "CONNECTED", queryStatus: "PASSED" },
        rawManifest: { researchRunId: "run_persisted_1", creatives: [] },
        normalizationLedger: {
          researchRunId: "run_persisted_1",
          records: [],
          rejectedRecords: [],
        },
        associationLedger: {
          researchRunId: "run_persisted_1",
          associations: [],
        },
      });
      expect(g06.replayModeDetected).toBe(true);
      expect(g06.overallG06Verdict).toBe("INSUFFICIENT_EVIDENCE");
    });

    it("P16: normalizeGoogleAdsResponse preserves null providerRequestId and populates mcpInvocationRef + lineageMethod", () => {
      const upstreamResponse = {
        creatives: [
          {
            creative_id: "CR_NORM_116",
            advertiser_id: "AR116",
            format: "video",
            last_shown: "2026-10-31",
            content: {
              headline: "UAHPET Water Fountain",
              description: "Stainless steel cat water fountain",
            },
          },
        ],
      };
      const invRecord = recordActualGoogleMcpInvocation(
        {
          mcpInvocationRef: "mcp_inv_run_116_uahpet.com_AR116_1",
          researchRunId: "run_116",
          workspaceId: "ws_1",
          domainQueried: "uahpet.com",
          advertiserId: "AR116",
          queryAttempted: true,
          upstreamCompleted: true,
          transportStatus: "CONNECTED",
          queryStatus: "PASSED",
        },
        upstreamResponse
      );
      const stamped = attachGoogleMcpCreativeProvenance(
        upstreamResponse.creatives[0],
        invRecord
      );

      const normRes = normalizeGoogleAdsResponse(
        {
          advertiser: {
            advertiser_id: "AR116",
            name: "UAHPET",
            domain: "uahpet.com",
            region: "US",
          },
          creatives: [stamped],
        },
        {
          topic: "Pet Gadgets",
          market: "US",
          lookbackDays: 90,
          maxCandidates: 10,
          workspaceId: "ws_1",
          researchRunId: "run_116",
          mcpInvocationRef: invRecord.mcpInvocationRef,
          providerRequestIdOrigin: "ABSENT",
          responseEvidenceHash: invRecord.responseEvidenceHash,
        } as any
      );

      expect(normRes.observations).toHaveLength(1);
      const obs = normRes.observations[0];
      expect(obs.providerRequestId).toBeNull();
      expect(obs.upstreamProviderRequestId).toBeNull();
      expect(obs.providerRequestIdOrigin).toBe("ABSENT");
      expect(obs.mcpInvocationRef).toBe("mcp_inv_run_116_uahpet.com_AR116_1");
      expect(obs.lineageMethod).toBe("VERIFIED_LOCAL_INVOCATION_ONLY");
      expect(obs.responseEvidenceHash).toBe(invRecord.responseEvidenceHash);
    });

    it("P17 & P18: BRAND_ONLY_MATCH and PROBABLE_PRODUCT_MATCH are never inflated into exactProductMatchesCount", () => {
      const invRecord = recordActualGoogleMcpInvocation(
        {
          mcpInvocationRef: "mcp_inv_run_117_1",
          researchRunId: "run_117",
          queryAttempted: true,
          upstreamCompleted: true,
          transportStatus: "CONNECTED",
          queryStatus: "PASSED",
        },
        { creatives: [{ creative_id: "CR_PROB_1" }, { creative_id: "CR_BRAND_2" }] }
      );
      const c1 = attachGoogleMcpCreativeProvenance(
        { creative_id: "CR_PROB_1" },
        invRecord
      );
      const c2 = attachGoogleMcpCreativeProvenance(
        { creative_id: "CR_BRAND_2" },
        invRecord
      );

      const g06 = evaluateGoogleMcpGates({
        researchRunId: "run_117",
        evaluatedCandidateIds: ["cand_1"],
        telemetry: { transportStatus: "CONNECTED", queryStatus: "PASSED" },
        rawManifest: { researchRunId: "run_117", creatives: [c1, c2] },
        normalizationLedger: {
          researchRunId: "run_117",
          records: [
            { id: "CR_PROB_1", researchRunId: "run_117" },
            { id: "CR_BRAND_2", researchRunId: "run_117" },
          ],
          rejectedRecords: [],
        },
        associationLedger: {
          researchRunId: "run_117",
          associations: [
            {
              creativeId: "CR_PROB_1",
              matchedCandidateId: "cand_1",
              researchRunId: "run_117",
              associationVerdict: "PROBABLE_PRODUCT_MATCH",
            },
            {
              creativeId: "CR_BRAND_2",
              matchedCandidateId: "cand_1",
              researchRunId: "run_117",
              associationVerdict: "BRAND_ONLY_MATCH",
            },
          ],
        },
        invocationLedger: [invRecord],
      });

      expect(g06.overallG06Verdict).toBe("PASS");
      expect(g06.verifiedLocalInvocationOnlyCount).toBe(2);
      expect(g06.subGates.GOOGLE_PRODUCT_ASSOCIATION).toBe("PASS");
      expect(g06.subGates.GOOGLE_EXACT_PRODUCT_EVIDENCE).toBe(
        "INSUFFICIENT_EVIDENCE"
      );
    });

    it("P19: g16CandidateEvaluator normalizeObservationIdentity never copies mcpInvocationRef into providerRequestId, while supporting verified local MCP lineage", () => {
      const obs = {
        sourceObservationId: "google_obs_1",
        sourceRecordId: "CR18441208625369186305",
        source: "GOOGLE_ADS",
        provenance: "LIVE_PROVIDER",
        sourceMode: "LIVE_PROVIDER",
        isCached: false,
        researchRunId: "run_119",
        providerRequestId: null,
        providerRequestIdOrigin: "ABSENT",
        mcpInvocationRef: "mcp_inv_run_119_uahpet.com_AR113_1",
        responseEvidenceHash: "d".repeat(64),
        lineageMethod: "VERIFIED_LOCAL_INVOCATION_ONLY",
        storeDomainEvidence: "uahpet.com",
        landingPageUrl: "https://uahpet.com/products/fountain",
      };

      const norm = normalizeObservationIdentity(obs);
      expect(norm.providerRequestId).toBeNull();
      expect(norm.mcpInvocationRef).toBe("mcp_inv_run_119_uahpet.com_AR113_1");
      expect(isAuthenticallyLiveObservation(obs)).toBe(true);

      const candEval = evaluateG16Candidate(
        {
          candidateId: "cand_119",
          title: "UAHPET Water Fountain",
          storeDomain: "uahpet.com",
          canonicalProductUrl: "https://uahpet.com/products/fountain",
          familyKey: "pet_water_fountain",
          identityStatus: "VERIFIED",
          fetchOutcome: "FETCH_SUCCEEDED",
          merchantVerifiedProductName: "UAHPET Water Fountain",
          supportingAdIds: ["CR18441208625369186305"],
          sourceObservations: [obs],
        },
        "run_119"
      );
      expect(candEval.isLiveVerified).toBe(true);
    });

    it("P20: computeCanonicalPayloadHash produces deterministic 64-char SHA-256 regardless of object key order", () => {
      const h1 = computeCanonicalPayloadHash({ b: 2, a: { y: 1, x: 0 } });
      const h2 = computeCanonicalPayloadHash({ a: { x: 0, y: 1 }, b: 2 });
      expect(h1).toHaveLength(64);
      expect(h1).toBe(h2);
    });
  });

  describe("Google MCP Negative Suite (G06-NEG-01..20) & 40 Physical-File Negative Control Mutations (MUT_01..40)", () => {
    it("passes all 20 Google MCP negative test scenarios (G06-NEG-01 through G06-NEG-20)", () => {
      const suite = runGoogleGateNegativeTests();
      expect(suite.totalTests).toBe(20);
      expect(suite.totalPassed).toBe(20);
      expect(suite.passed).toBe(true);
    });

    it("catches and rejects all 40 physical-file negative control mutations (MUT_01..MUT_40 covering N01..N15)", () => {
      const tmpDir = fs.mkdtempSync(
        path.join(os.tmpdir(), "kh02-v124348-neg-")
      );
      try {
        const sha = "c".repeat(40);
        writeCanonicalValidBaselineFixture(tmpDir, sha);

        const baseVal = validateAcceptanceArtifacts(tmpDir, {
          skipSelfMutationReportCheck: true,
        });
        expect(baseVal.overallValid).toBe(true);
        expect(baseVal.failedChecks).toBe(0);

        const negSuite = runNegativeControlSuite(tmpDir);
        expect(negSuite.totalMutations).toBeGreaterThanOrEqual(40);
        expect(negSuite.totalCaughtAndRejected).toBe(negSuite.totalMutations);
        expect(negSuite.suiteVerdict).toBe("PASS");
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    });
  });
});
