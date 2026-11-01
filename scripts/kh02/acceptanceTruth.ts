/**
 * SWAI KH-02 V12.4.3.5.1 — Measured Acceptance Truth, Dynamic Business Gate Diagnostics,
 * Owned Process & Resource Ledger, and Fail-Closed Verdict Reducer
 *
 * Implements:
 * - Task A: Observable, fail-closed acceptance gate & release verdict reducer
 *           (`computeRequiredWaveCompletion`, `computeEngineeringVerdict`,
 *            `computeOverallBusinessVerdict`, `computeReleaseVerdicts`)
 * - Task B: Dynamic read-only KH-02 provider & business gate diagnostics
 *           (`collectKh02AcceptanceDiagnostics` — G07, G15, G16, Walmart, Amazon, Shortlist Niche Fit)
 * - Task C: Ownership-aware process tracking, peak concurrency calculation, and disk/RAM guards
 *           (`OwnedProcessTracker`, `computePeakConcurrentIntervals`, `measureHostDiskAndRam`)
 * - Task D: Full repository regression inventory & shard aggregator (`discoverRepositoryTestInventory`)
 */

import { execSync, spawn } from "child_process";
import crypto from "crypto";
import fs from "fs";
import os from "os";
import path from "path";
import { prisma } from "../../src/lib/db";
import { diagnoseKH02Source } from "../../src/services/kh02/providers/sourceRegistry";
import { evaluateDemandHistoryEvidence } from "../../src/services/kh02/demand/temporalDemandEngine";
import { resolveCreatorsApiEligibility } from "../../src/services/kh02/marketplace/amazonCreatorsApiClient";
import { resolveAmazonUsPolicyContext } from "../../src/services/kh02/marketplace/marketplaceEvidenceTypes";
import { resolveWalmartUsPilotPolicy } from "../../src/services/kh02/marketplace/walmartJinaPolicy";
import {
  evaluateG16Candidate,
  evaluateG16Top3,
  type CandidateEvaluationResult,
  type G16EvidenceIndex,
  type G16MerchantEvidenceIndex,
} from "./g16CandidateEvaluator";
import {
  classifyHistoricalProductIdentity,
  extractPersistedMerchantProofsFromDbRows,
  classifyPersistedLiveObservation,
  isFunnelOrCheckoutChamp,
  isFabricatedHydrationObservation,
  isSyntheticMerchantProofRef,
  type PersistedMerchantProofRecord,
  type PersistedMerchantProofAuditEntry,
  type PersistedLiveObservationClassification,
  type VerificationEvidenceStatus,
} from "../../src/services/kh02/identity/merchantIdentityPolicy";

// ============================================================================
// TASK A: FAIL-CLOSED GATE & VERDICT REDUCER TYPES & FUNCTIONS
// ============================================================================

export type GateExecutionStatus =
  | "PASS"
  | "FAIL"
  | "BLOCKED"
  | "NOT_RUN"
  | "CANCELLED";

export interface GateResult {
  id: string;
  required: boolean;
  executionStatus: GateExecutionStatus;
  observedAt: string;
  sourceSha: string;
  sourceArtifact?: string;
  reasonCode?: string;
  exitCode?: number | null;
  durationMs?: number;
  measurements?: Record<string, unknown>;
}

export interface RequiredWaveCompletionResult {
  complete: boolean;
  passed: boolean;
  missing: string[];
  invalid: string[];
  evaluatedGateCount: number;
}

export function computeRequiredWaveCompletion(
  requiredIds: readonly string[],
  results: readonly GateResult[],
  expectedSha: string
): RequiredWaveCompletionResult {
  const byId = new Map<string, GateResult>();
  for (const r of results || []) {
    if (r && typeof r.id === "string") {
      byId.set(r.id, r);
    }
  }

  const missing: string[] = [];
  const invalid: string[] = [];

  for (const reqId of requiredIds) {
    const found = byId.get(reqId);
    if (!found) {
      missing.push(reqId);
      continue;
    }
    if (
      found.executionStatus === "NOT_RUN" ||
      found.executionStatus === "CANCELLED"
    ) {
      missing.push(reqId);
      continue;
    }
    const shaMatches =
      typeof found.sourceSha === "string" &&
      found.sourceSha.trim() === expectedSha.trim();
    const exitOk =
      found.exitCode === undefined ||
      found.exitCode === null ||
      found.exitCode === 0;
    if (!shaMatches || found.executionStatus !== "PASS" || !exitOk) {
      invalid.push(reqId);
    }
  }

  return {
    complete: missing.length === 0,
    passed: missing.length === 0 && invalid.length === 0,
    missing,
    invalid,
    evaluatedGateCount: results.length,
  };
}

export interface FullRegressionInventorySummary {
  totalDiscoveredTestFiles: number;
  executedTestFilesCount: number;
  excludedOrDeferredFilesCount: number;
  targetedOnly: boolean;
  inventoryComplete: boolean;
  totalExecutedTestCases: number;
  passedTestCases: number;
  failedTestCases: number;
  requiredActiveSuiteFailedTestCases: number;
  baselineKnownPolicySupersededTestCases: number;
  newRegressionTestCases: number;
}

export interface ComputeEngineeringVerdictInput {
  requiredIds: readonly string[];
  results: readonly GateResult[];
  expectedSha: string;
  validatorPassed: boolean;
  validatorChecksFailed: number;
  diskGuardPassed: boolean;
  minFreeDiskGiB: number;
  diskThresholdGiB: number;
  shaParityVerified: boolean;
  regressionInventory: FullRegressionInventorySummary;
  ownedOrphanCount: number | "UNKNOWN";
  nonInflationVerified: boolean;
  nonInflationCandidatesCount: number;
}

export function computeEngineeringVerdict(
  input: ComputeEngineeringVerdictInput
): "PASS" | "FAIL" | "BLOCKED" | "INCOMPLETE" {
  if (
    !input.diskGuardPassed ||
    typeof input.minFreeDiskGiB !== "number" ||
    input.minFreeDiskGiB < input.diskThresholdGiB
  ) {
    return "BLOCKED";
  }

  const waveComp = computeRequiredWaveCompletion(
    input.requiredIds,
    input.results,
    input.expectedSha
  );

  if (
    !waveComp.complete ||
    !input.regressionInventory.inventoryComplete ||
    input.regressionInventory.targetedOnly ||
    input.regressionInventory.totalExecutedTestCases <= 0 ||
    input.nonInflationCandidatesCount < 3
  ) {
    return "INCOMPLETE";
  }

  if (
    !waveComp.passed ||
    !input.validatorPassed ||
    input.validatorChecksFailed > 0 ||
    !input.shaParityVerified ||
    !input.nonInflationVerified ||
    input.regressionInventory.failedTestCases > 0 ||
    input.regressionInventory.requiredActiveSuiteFailedTestCases > 0 ||
    input.regressionInventory.baselineKnownPolicySupersededTestCases > 0 ||
    input.regressionInventory.newRegressionTestCases > 0 ||
    input.ownedOrphanCount !== 0
  ) {
    return "FAIL";
  }

  return "PASS";
}

// ============================================================================
// TASK B: DYNAMIC LIVE PROVIDER & G07 / G15 / G16 BUSINESS DIAGNOSTICS
// ============================================================================

export interface ProductG15DemandCoverageEntry {
  candidateId: string;
  title: string;
  storeDomain: string | null;
  familyKey: string;
  sourceSplit: "STORED_RUN" | "DEV_BACKTEST" | "HOLDOUT_BACKTEST";
  authoritativeObservationsCount: number;
  distinctObservationDatesCount: number;
  coveredDays: number;
  requiredDays: number;
  missingDaysTo60: number;
  earliestObservedAt: string | null;
  latestObservedAt: string | null;
  demandClass: string;
  sourceAuthority: string;
  eligibleForEvergreen: boolean;
  g15Status: "PASS" | "INSUFFICIENT_EVIDENCE";
  reason: string;
}

export interface PersistedCandidateG16ProofAudit {
  candidateId: string;
  researchProductId: string | null;
  title: string;
  storeDomain: string | null;
  canonicalProductUrl: string | null;
  workspaceId: string;
  researchRunId: string;
  snapshotClaimedIdentityStatus: "VERIFIED" | "PROBABLE" | "UNVERIFIED";
  snapshotClaimedLiveObservationsCount: number;
  snapshotClaimedLiveVerified: boolean;
  persistedRunAdIds: string[];
  persistedRunAdIngestOutcomes: string[];
  persistedAdObservationIds: string[];
  persistedLiveSameRunObservationIds: string[];
  persistedLiveSameRunObservations: any[];
  persistedObservationClassifications: PersistedLiveObservationClassification[];
  persistedResearchEvidenceIds: string[];
  persistedLandingPageSnapshotIds: string[];
  persistedOfferSnapshotIds: string[];
  persistedMerchantProofAudits: PersistedMerchantProofAuditEntry[];
  validPersistedMerchantProofs: PersistedMerchantProofRecord[];
  persistedProductSchemaProofStatus: "VERIFIED" | "INSUFFICIENT_EVIDENCE";
  persistedLiveOriginProofStatus: "VERIFIED" | "INSUFFICIENT_EVIDENCE";
  rejectedCrossWorkspaceProofIds: string[];
  rejectedSyntheticOrFallbackReasons: string[];
  persistedMerchantVerified: boolean;
  persistedMerchantProofRefs: string[];
  reconstructedIdentityStatus: "VERIFIED" | "PROBABLE" | "UNVERIFIED";
  reconstructedVerificationEvidenceStatus: VerificationEvidenceStatus;
  reconstructedIsCheckoutChampFunnel: boolean;
  reconstructedCandidateForG16: any;
}

export interface CandidateG16ProofEntry {
  candidateId: string;
  title: string;
  storeDomain: string | null;
  canonicalProductUrl: string | null;
  canonicalProductKey?: string;
  familyKey: string;
  snapshotClaimedIdentityStatus?: "VERIFIED" | "PROBABLE" | "UNVERIFIED";
  snapshotClaimedLiveVerified?: boolean;
  identityStatus: "VERIFIED" | "PROBABLE" | "UNVERIFIED";
  verificationEvidenceStatus?: VerificationEvidenceStatus;
  productSchemaProofStatus?: "VERIFIED" | "INSUFFICIENT_EVIDENCE";
  proofMethod?: string;
  persistedProofRowIds?: string[];
  proofSourceObservedAt?: string | null;
  originProofStatus?: "VERIFIED" | "INSUFFICIENT_EVIDENCE";
  authenticLiveObservationIds?: string[];
  matchingRunId?: string | null;
  matchingWorkspaceId?: string | null;
  isCheckoutChampFunnel: boolean;
  nicheRelevantToPetGadgets: boolean;
  nicheRelevanceReason: string;
  authenticallyLive: boolean;
  sameRunLineage: boolean;
  candidateProductMatch: boolean;
  verifiedMerchantIdentity: boolean;
  nonFunnelStore: boolean;
  g16PredicateStatuses?: {
    authenticallyLive: boolean;
    sameRunLineage: boolean;
    candidateProductMatch: boolean;
    verifiedMerchantIdentity: boolean;
    nonFunnelStore: boolean;
  };
  isLiveVerified: boolean;
  verificationMethod: string;
  persistedRunAdIds?: string[];
  persistedRunAdIngestOutcomes?: string[];
  persistedAdObservationIds?: string[];
  persistedLiveSameRunObservationIds?: string[];
  persistedMerchantProofRefs?: string[];
  rejectedCrossWorkspaceProofIds?: string[];
  rejectedSyntheticOrFallbackReasons?: string[];
  rejectionReasonCodes?: string[];
  rejectionReasons: string[];
  storedSnapshotClaimDiff?: {
    snapshotClaimedIdentityStatus: string | null;
    reconstructedIdentityStatus: string;
    snapshotClaimedLiveVerified: boolean;
    reconstructedLiveVerified: boolean;
    snapshotClaimedLiveObservationsCount: number;
    reconstructedLiveObservationsCount: number;
    claimDowngraded: boolean;
  };
}

export interface Kh02AcceptanceDiagnostics {
  sourceSha: string;
  evaluatedAt: string;
  dataAsOf: string;
  providers: {
    walmartUs: {
      providerId: "WALMART_US";
      transport: "JINA_READER_REST_NO_KEY";
      defaultFeatureEnabled: boolean;
      defaultLiveAllowed: boolean;
      probeExecutionStatus: "DID_RUN" | "NOT_RUN";
      classificationIntegrityStatus: "PASS" | "FAIL";
      liveProviderStatus: string;
      liveVerdict: "LIVE_VERIFIED" | "BLOCKED_PROVIDER" | "RATE_LIMITED" | "DISABLED" | "NOT_VERIFIED";
      verifiedLiveProductCount: number;
      attemptedLiveCallsCount: number;
      reason: string;
    };
    amazonUs: {
      providerId: "AMAZON_US";
      transport: "CREATORS_API_AND_PLAYWRIGHT_MCP";
      defaultFeatureEnabled: boolean;
      defaultLiveAllowed: boolean;
      configured: boolean;
      authenticated: boolean | null;
      querySucceeded: boolean;
      liveVerdict:
        | "LIVE_VERIFIED"
        | "CREDENTIALS_REQUIRED"
        | "DISABLED"
        | "BLOCKED"
        | "NOT_VERIFIED";
      verifiedLiveProductCount: number;
      attemptedLiveCallsCount: number;
      missingEnvKeys: string[];
      reason: string;
      localMcpPilot?: {
        routeId: "AMAZON_LOCAL_MCP_PUBLIC_URL_PILOT";
        probeExecutionStatus: "DID_RUN" | "NOT_RUN";
        transportHandshakeStatus: "SUCCEEDED" | "FAILED" | "NOT_ATTEMPTED";
        actualBrowserToolExecutionStatus:
          | "SUCCEEDED"
          | "FAILED"
          | "BLOCKED_POLICY"
          | "NOT_ATTEMPTED";
        realAmazonPageObservationStatus:
          | "PUBLIC_PAGE_OBSERVED"
          | "BLOCKED_CAPTCHA_OR_BOT_WALL"
          | "FAILED"
          | "NOT_ATTEMPTED";
        productIdentityVerificationStatus:
          | "IDENTITY_VERIFIED"
          | "OBSERVED_UNVERIFIED"
          | "REJECTED_IDENTITY"
          | "NOT_ATTEMPTED";
        liveVerdict:
          | "LIVE_VERIFIED"
          | "BLOCKED_CAPTCHA_OR_BOT_WALL"
          | "OBSERVED_UNVERIFIED"
          | "NOT_VERIFIED";
        verifiedLiveProductCount: number;
        attemptedLiveCallsCount: number;
        reason: string;
      };
      creatorsApi?: {
        routeId: "AMAZON_CREATORS_API";
        independentOfLocalMcpPilot: true;
        configured: boolean;
        authenticated: boolean | null;
        querySucceeded: boolean;
        status: string;
        missingEnvKeys: string[];
        reason: string;
      };
    };
    tiktokUsG07: {
      providerId: "TIKTOK_ADS";
      gateId: "G07";
      configured: boolean;
      transportStatus: string;
      authStatus: string;
      diagnosticStatus: string;
      storedRecordsCount: number;
      verdict: "PASS" | "BLOCKED" | "INSUFFICIENT_EVIDENCE";
      missingRequirements: string[];
      reason: string;
    };
    googleAds: {
      providerId: "GOOGLE_ADS";
      configured: boolean;
      transportStatus: string;
      diagnosticStatus: string;
      reason: string;
    };
    metaAds: {
      providerId: "META_ADS";
      configured: boolean;
      transportStatus: string;
      storedRecordsCount: number;
      diagnosticStatus: string;
      reason: string;
    };
    demandHistory: {
      providerId: "DEMAND_HISTORY";
      mode: string;
      configured: boolean;
      diagnosticStatus: string;
      storedProductDemandObservationsCount: number;
      missingRequirements: string[];
      reason: string;
    };
  };
  gates: {
    g07: {
      gateId: "G07";
      verdict: "PASS" | "BLOCKED" | "INSUFFICIENT_EVIDENCE";
      evaluatedFromSource: "diagnoseKH02Source('TIKTOK_ADS')";
      reason: string;
    };
    g15: {
      gateId: "G15";
      verdict: "PASS" | "INSUFFICIENT_EVIDENCE";
      requiredCoveredDays: 60;
      qualifiedProductsCount: number;
      requiredQualifiedProductsCount: 3;
      totalDemandObservationsInDb: number;
      evaluatedProducts: ProductG15DemandCoverageEntry[];
      reason: string;
      remediationGuidance: string;
    };
    g16: {
      gateId: "G16";
      verdict:
        | "PASS"
        | "PARTIAL_2_OF_3"
        | "PARTIAL_1_OF_3"
        | "INSUFFICIENT_EVIDENCE"
        | "NOT_VERIFIED";
      snapshotFreshness: "CURRENT_LIVE_RUN" | "HISTORICAL_SNAPSHOT_RE_EVALUATED" | "NO_RUN_AVAILABLE";
      reconstructionStatus:
        | "RECONSTRUCTED_FROM_PERSISTED_DB"
        | "HISTORICAL_SNAPSHOT_PROOF_NOT_RECONSTRUCTABLE"
        | "NO_RUN_AVAILABLE";
      evaluatedRunId: string | null;
      evaluatedWorkspaceId: string | null;
      evaluatedRunCreatedAt: string | null;
      previousSnapshotClaimedVerifiedCount: number;
      verifiedFromPersistedEvidenceCount: number;
      newLiveVerifiedDuringThisRun: number;
      verifiedLiveMerchantsCount: number;
      requiredLiveMerchantsCount: number;
      distinctFamiliesCount: number;
      distinctCanonicalProductsCount: number;
      candidates: CandidateG16ProofEntry[];
      persistedProofAudit?: PersistedCandidateG16ProofAudit[];
      reason: string;
    };
  };
  shortlistQuality: {
    targetNiche: string;
    storedRunShortlistNicheMatchedCount: number;
    storedRunShortlistTotalCount: number;
    holdoutBacktestShortlistNicheMatchedCount: number;
    holdoutBacktestShortlistTotalCount: number;
    holdoutNicheMismatches: Array<{
      candidateId: string;
      title: string;
      storeDomain: string | null;
      reason: string;
    }>;
    allThreeNicheMatchedAndVerified: boolean;
  };
}

const PET_NICHE_KEYWORDS =
  /\b(pet|pets|dog|dogs|cat|cats|puppy|kitten|paw|fur|hair\s*remover|lint\s*roller|chomchom|uproot|uprootclean|litter|fountain|feeder|kittyspout|uahpet|groom|grooming|leash|collar|bark|chew)\b/i;

export function evaluatePetGadgetsNicheFit(title: string, storeDomain?: string | null): {
  matches: boolean;
  reason: string;
} {
  const combined = `${title || ""} ${storeDomain || ""}`;
  if (PET_NICHE_KEYWORDS.test(combined)) {
    return {
      matches: true,
      reason: "Title/domain contains verified pet/grooming/feeder/fountain/fur-removal signal.",
    };
  }
  return {
    matches: false,
    reason: `Title '${title}' on '${storeDomain || "unknown"}' does not match target niche 'Pet Gadgets'.`,
  };
}

/**
 * Loads and validates immutable persisted database evidence for a single G16 shortlist candidate
 * (`P0-A`, `P0-B`, `P0-C`).
 *
 * Non-negotiable guarantees:
 * - Never synthesizes `obs_<runId>_<candidateId>`, `req_<runId>`, or `jsonld:<storeDomain>`.
 * - Never rebrands a persisted `AdObservation` as `provenance: "LIVE_PROVIDER"` unless
 *   `classifyPersistedLiveObservation(...)` proves `ingestOutcome === "NEW"` AND a valid
 *   immutable `rawPayload` live provider execution envelope + `evidenceReference` + `providerRequestId`
 *   in the same workspace, run, candidate/ad, and `<= asOf`.
 * - Never infers `schemaVerified=true` or `hasJsonLdProduct=true` from `LandingPageSnapshot` hash/title/URL
 *   or imaginary Prisma columns (`ev.evidenceType`, `lp.productTitle`, `lp.canonicalUrl`, `lp.capturedAt`,
 *   `os.offerUrl`, `os.priceText`, `os.priceAmount`, `os.capturedAt`, `prod.workspaceId`, `prod.storeDomain`).
 * - Delegates all merchant proof extraction to `extractPersistedMerchantProofsFromDbRows(...)`.
 */
export async function loadPersistedG16ProofForCandidate(
  prismaClient: any,
  workspaceId: string,
  researchRunId: string,
  candidate: any,
  asOf?: Date | string
): Promise<PersistedCandidateG16ProofAudit> {
  const candId = String(candidate?.candidateId || "unknown_candidate");
  const researchProductId = candidate?.researchProductId
    ? String(candidate.researchProductId)
    : null;
  const title = String(candidate?.title || "Untitled Candidate");
  const storeDomain = candidate?.storeDomain ? String(candidate.storeDomain) : null;
  const canonicalUrl = candidate?.canonicalProductUrl
    ? String(candidate.canonicalProductUrl)
    : null;
  const asOfDate = asOf ? (asOf instanceof Date ? asOf : new Date(asOf)) : new Date();

  const snapshotEval = evaluateG16Candidate(candidate, researchRunId);
  const snapshotClaimedIdentityStatus: "VERIFIED" | "PROBABLE" | "UNVERIFIED" =
    candidate?.identityStatus === "VERIFIED" ||
    candidate?.identityStatus === "PROBABLE" ||
    candidate?.identityStatus === "UNVERIFIED"
      ? candidate.identityStatus
      : "PROBABLE";
  const snapshotClaimedLiveObservationsCount = Number(
    candidate?.liveObservationsCount || 0
  );
  const snapshotClaimedLiveVerified = snapshotEval.isLiveVerified;

  const supportingAdIds: string[] = Array.isArray(candidate?.supportingAdIds)
    ? candidate.supportingAdIds.map((id: any) => String(id)).filter(Boolean)
    : [];
  const rawSnapshotObs: any[] = Array.isArray(candidate?.sourceObservations)
    ? candidate.sourceObservations
    : [];
  const snapshotObsIds: string[] = rawSnapshotObs
    .map((o: any) => String(o?.sourceObservationId || o?.observationId || o?.id || ""))
    .filter(Boolean);

  // 1. Query persisted DiscoveryRunAd rows for this run (and fallback lookup by adId to detect cross-run/workspace)
  let dbRunAds =
    supportingAdIds.length > 0 && prismaClient?.discoveryRunAd?.findMany
      ? await prismaClient.discoveryRunAd.findMany({
          where: {
            runId: researchRunId,
            adId: { in: supportingAdIds },
          },
        })
      : [];

  if (
    dbRunAds.length === 0 &&
    supportingAdIds.length > 0 &&
    prismaClient?.discoveryRunAd?.findMany
  ) {
    dbRunAds = await prismaClient.discoveryRunAd.findMany({
      where: {
        adId: { in: supportingAdIds },
      },
      orderBy: { observedAt: "desc" },
      take: 25,
    });
  }

  const persistedRunAdIds: string[] = Array.from(
    new Set(dbRunAds.map((r: any) => String(r.adId)))
  );
  const persistedRunAdIngestOutcomes: string[] = dbRunAds.map((r: any) =>
    String(r.ingestOutcome || "UNKNOWN")
  );
  const dbRunAdsByAdId = new Map<string, any[]>();
  for (const r of dbRunAds) {
    const key = String(r.adId || "");
    if (!key) continue;
    const list = dbRunAdsByAdId.get(key) || [];
    list.push(r);
    dbRunAdsByAdId.set(key, list);
  }

  // 2. Query persisted AdObservation rows
  const obsWhereOr: any[] = [];
  if (snapshotObsIds.length > 0) obsWhereOr.push({ id: { in: snapshotObsIds } });
  if (supportingAdIds.length > 0) obsWhereOr.push({ adId: { in: supportingAdIds } });

  const dbAdObs =
    obsWhereOr.length > 0 && prismaClient?.adObservation?.findMany
      ? await prismaClient.adObservation.findMany({
          where: { OR: obsWhereOr },
        })
      : [];

  const persistedAdObservationIds: string[] = dbAdObs.map((o: any) => String(o.id));
  const dbAdObsById = new Map<string, any>(dbAdObs.map((o: any) => [String(o.id), o]));

  const rejectedSyntheticOrFallbackReasons: string[] = [];
  const rejectedCrossWorkspaceProofIds: string[] = [];
  const persistedLiveSameRunObservations: any[] = [];
  const persistedLiveSameRunObservationIds: string[] = [];
  const persistedObservationClassifications: PersistedLiveObservationClassification[] = [];

  if (
    dbRunAds.length > 0 &&
    dbRunAds.every((r: any) => r.ingestOutcome === "EXISTING")
  ) {
    rejectedSyntheticOrFallbackReasons.push(
      `All ${dbRunAds.length} DiscoveryRunAd rows for candidate '${candId}' have ingestOutcome='EXISTING' (reused historical DB ads rather than fresh live ingest).`
    );
  }

  // Evaluate both snapshot observations and any persisted dbAdObs not listed in rawSnapshotObs
  const evaluatedObsIds = new Set<string>();
  const obsCandidatesToInspect: Array<{ snapObs: any; dbObs: any | null }> = [];

  for (const snapObs of rawSnapshotObs) {
    const snapObsId = String(
      snapObs?.sourceObservationId || snapObs?.observationId || snapObs?.id || ""
    );
    const dbObs = snapObsId ? dbAdObsById.get(snapObsId) || null : null;
    if (snapObsId) evaluatedObsIds.add(snapObsId);
    obsCandidatesToInspect.push({ snapObs, dbObs });
  }
  for (const dbObs of dbAdObs) {
    const idStr = String(dbObs.id || "");
    if (idStr && !evaluatedObsIds.has(idStr)) {
      evaluatedObsIds.add(idStr);
      obsCandidatesToInspect.push({ snapObs: null, dbObs });
    }
  }

  for (const { snapObs, dbObs } of obsCandidatesToInspect) {
    if (snapObs && isFabricatedHydrationObservation(snapObs, researchRunId)) {
      rejectedSyntheticOrFallbackReasons.push(
        `Rejected fabricated hydration observation ID '${snapObs?.observationId || snapObs?.sourceObservationId}'.`
      );
      continue;
    }
    const obsOrigin = String(
      snapObs?.metrics?.origin || snapObs?.origin || ""
    ).toUpperCase();
    if (obsOrigin === "DETERMINISTIC_FALLBACK") {
      rejectedSyntheticOrFallbackReasons.push(
        `Observation '${snapObs?.sourceObservationId || snapObs?.observationId || "unknown"}' carries origin='DETERMINISTIC_FALLBACK'.`
      );
      continue;
    }

    if (!dbObs) {
      const snapObsId = String(
        snapObs?.sourceObservationId || snapObs?.observationId || snapObs?.id || "missing_id"
      );
      rejectedSyntheticOrFallbackReasons.push(
        `Observation '${snapObsId}' not found in persisted AdObservation table.`
      );
      continue;
    }

    const adIdStr = String(
      dbObs.adId || snapObs?.persistedAdId || snapObs?.sourceRecordId || ""
    );
    const matchingRunAds = dbRunAdsByAdId.get(adIdStr) || [];
    // Prefer the DiscoveryRunAd matching `researchRunId` if present, otherwise inspect the first available row
    const runAdRow =
      matchingRunAds.find((r: any) => String(r.runId) === researchRunId) ||
      matchingRunAds[0] ||
      null;

    if (!runAdRow) {
      rejectedSyntheticOrFallbackReasons.push(
        `AdObservation '${dbObs.id}' (adId='${adIdStr}') has no linked DiscoveryRunAd row in run '${researchRunId}'.`
      );
      continue;
    }

    const obsClassification = classifyPersistedLiveObservation({
      adObservation: dbObs,
      discoveryRunAd: runAdRow,
      expectedWorkspaceId: workspaceId,
      expectedRunId: researchRunId,
      expectedCandidateId: candId,
      expectedAdIds: supportingAdIds,
      expectedStoreDomain: storeDomain,
      asOf: asOfDate,
    });
    persistedObservationClassifications.push(obsClassification);

    if (obsClassification.originEvidenceClassification === "CROSS_WORKSPACE_OR_RUN") {
      if (runAdRow.workspaceId && String(runAdRow.workspaceId) !== workspaceId) {
        rejectedCrossWorkspaceProofIds.push(
          `DiscoveryRunAd:${runAdRow.id || runAdRow.adId}(workspaceId=${runAdRow.workspaceId})`
        );
      }
    }

    if (!obsClassification.isAuthenticLiveProviderObservation) {
      for (const reason of obsClassification.rejectionReasons) {
        rejectedSyntheticOrFallbackReasons.push(
          `AdObservation '${dbObs.id}': ${reason}`
        );
      }
      continue;
    }

    // Authentic live observation proven by immutable DB fields (`P03`)
    persistedLiveSameRunObservationIds.push(String(dbObs.id));
    persistedLiveSameRunObservations.push({
      ...(snapObs || {}),
      observationId: String(dbObs.id),
      sourceObservationId: String(dbObs.id),
      sourceRecordId: adIdStr,
      researchRunId: String(runAdRow.runId),
      workspaceId: String(runAdRow.workspaceId),
      providerId: String(runAdRow.providerId),
      ingestOutcome: String(runAdRow.ingestOutcome),
      evidenceType: String(dbObs.evidenceType),
      verificationMethod: String(dbObs.verificationMethod),
      evidenceReference: obsClassification.evidenceReference,
      providerRequestId: obsClassification.providerRequestId,
      mcpInvocationRef: obsClassification.mcpInvocationRef,
      rawPayload: dbObs.rawPayload,
      observedAt: obsClassification.observedAt,
      sourceTimestamp: obsClassification.sourceTimestamp,
      persistedAdObservation: dbObs,
      persistedDiscoveryRunAd: runAdRow,
      persistedLiveOriginVerified: true,
      originEvidenceClassification: obsClassification.originEvidenceClassification,
      provenance: obsClassification.derivedProvenance,
      sourceMode: obsClassification.derivedSourceMode,
      sourceType: obsClassification.derivedSourceMode,
      isCached: obsClassification.isCached,
      isLiveRecord: obsClassification.isLiveRecord,
    });
  }

  // 3. Query persisted ResearchProduct (with `store: true`), ResearchEvidence, LandingPageSnapshot, CompetitorOfferSnapshot
  const productLookupIds = Array.from(
    new Set([researchProductId, candId].filter(Boolean) as string[])
  );
  let dbProducts: any[] = [];
  if (productLookupIds.length > 0 && prismaClient?.researchProduct?.findMany) {
    dbProducts = await prismaClient.researchProduct.findMany({
      where: { id: { in: productLookupIds } },
      include: {
        store: true,
        evidence: true,
        landingPageSnapshots: true,
        offerSnapshots: true,
      },
    });
  }

  // Also query standalone evidence/snapshots by subjectId / productId so nothing persisted is missed
  const standaloneEvidence =
    productLookupIds.length > 0 && prismaClient?.researchEvidence?.findMany
      ? await prismaClient.researchEvidence.findMany({
          where: {
            OR: [
              { productId: { in: productLookupIds } },
              { subjectId: { in: productLookupIds } },
            ],
          },
        })
      : [];
  const standaloneLandingSnapshots =
    productLookupIds.length > 0 && prismaClient?.landingPageSnapshot?.findMany
      ? await prismaClient.landingPageSnapshot.findMany({
          where: { productId: { in: productLookupIds } },
        })
      : [];
  const standaloneOfferSnapshots =
    productLookupIds.length > 0 && prismaClient?.competitorOfferSnapshot?.findMany
      ? await prismaClient.competitorOfferSnapshot.findMany({
          where: { productId: { in: productLookupIds } },
        })
      : [];

  const extractedProofs = extractPersistedMerchantProofsFromDbRows({
    workspaceId,
    candidateId: candId,
    researchProductId,
    storeDomain,
    canonicalProductUrl: canonicalUrl,
    candidateTitle: title,
    expectedSku: candidate?.sku ? String(candidate.sku) : null,
    expectedMerchantProductId: candidate?.merchantProductId
      ? String(candidate.merchantProductId)
      : null,
    asOf: asOfDate,
    researchProducts: dbProducts,
    standaloneEvidence,
    standaloneLandingSnapshots,
    standaloneOfferSnapshots,
  });

  const persistedResearchEvidenceIds = extractedProofs.allAuditedRecords
    .filter((r) => r.sourceTable === "ResearchEvidence")
    .map((r) => r.recordId);
  const persistedLandingPageSnapshotIds = extractedProofs.allAuditedRecords
    .filter((r) => r.sourceTable === "LandingPageSnapshot")
    .map((r) => r.recordId);
  const persistedOfferSnapshotIds = extractedProofs.allAuditedRecords
    .filter((r) => r.sourceTable === "CompetitorOfferSnapshot")
    .map((r) => r.recordId);

  for (const auditRec of extractedProofs.allAuditedRecords) {
    if (auditRec.validationStatus === "CROSS_WORKSPACE_REJECTED") {
      rejectedCrossWorkspaceProofIds.push(
        `${auditRec.sourceTable}:${auditRec.recordId}(workspaceId=${auditRec.workspaceId || "missing"})`
      );
    }
    if (auditRec.validationStatus !== "CONTENT_VALIDATED_WITH_SOURCE") {
      for (const r of auditRec.rejectionReasons) {
        rejectedSyntheticOrFallbackReasons.push(
          `${auditRec.sourceTable}:${auditRec.recordId}: ${r}`
        );
      }
    }
  }

  if (extractedProofs.allAuditedRecords.length === 0) {
    rejectedSyntheticOrFallbackReasons.push(
      `Zero persisted merchant verification rows (ResearchEvidence / LandingPageSnapshot / CompetitorOfferSnapshot / ResearchProduct) exist in workspace '${workspaceId}' for candidate '${candId}'.`
    );
  }

  const identityCls = classifyHistoricalProductIdentity(
    {
      candidateId: candId,
      researchProductId,
      workspaceId,
      title,
      storeDomain,
      canonicalProductUrl: canonicalUrl,
      expectedSku: candidate?.sku ? String(candidate.sku) : null,
      expectedMerchantProductId: candidate?.merchantProductId
        ? String(candidate.merchantProductId)
        : null,
      observedAt: asOfDate,
      isAdOnlyFallback: extractedProofs.validProofs.length === 0,
      persistedMerchantProofs: extractedProofs.validProofs,
    },
    asOfDate
  );

  const persistedMerchantVerified =
    identityCls.identityStatus === "VERIFIED" &&
    identityCls.verificationEvidenceStatus === "INDEPENDENT_VERIFIED" &&
    extractedProofs.validProofs.length > 0 &&
    !identityCls.isCheckoutChampFunnel;
  const persistedMerchantProofRefs = identityCls.independentMerchantProofRefs.filter(
    (r) => !isSyntheticMerchantProofRef(r)
  );

  const primaryValidProof = extractedProofs.validProofs[0] || null;
  const persistedProductSchemaProofStatus: "VERIFIED" | "INSUFFICIENT_EVIDENCE" =
    persistedMerchantVerified && primaryValidProof?.validationStatus === "CONTENT_VALIDATED_WITH_SOURCE"
      ? "VERIFIED"
      : "INSUFFICIENT_EVIDENCE";
  const persistedLiveOriginProofStatus: "VERIFIED" | "INSUFFICIENT_EVIDENCE" =
    persistedLiveSameRunObservations.length > 0 ? "VERIFIED" : "INSUFFICIENT_EVIDENCE";

  // Strip unbacked inline snapshot fields unless persistedMerchantVerified === true
  const reconstructedCandidateForG16 = {
    ...candidate,
    workspaceId,
    identityStatus: identityCls.identityStatus,
    merchantPageVerified: persistedMerchantVerified,
    existingProductVerified: persistedMerchantVerified,
    merchantVerificationProofRefs: persistedMerchantProofRefs,
    identityEvidenceReferences: persistedMerchantVerified ? persistedMerchantProofRefs : [],
    merchantVerifiedProductName: persistedMerchantVerified
      ? primaryValidProof?.verifiedProductTitle || candidate?.merchantVerifiedProductName || title
      : null,
    fetchOutcome: persistedMerchantVerified ? "FETCH_SUCCEEDED" : "UNVERIFIED_PERSISTED_DB",
    resolutionSource: persistedMerchantVerified
      ? primaryValidProof?.proofMethod || "JSON_LD_PRODUCT_SCHEMA"
      : "PERSISTED_DB_RECONSTRUCTION_UNVERIFIED",
    merchantProductId: persistedMerchantVerified
      ? primaryValidProof?.merchantProductId || candidate?.merchantProductId
      : null,
    sku: persistedMerchantVerified ? primaryValidProof?.sku || candidate?.sku : null,
    gtin: persistedMerchantVerified ? primaryValidProof?.gtin || candidate?.gtin : null,
    verificationReason: persistedMerchantVerified
      ? `Verified from persisted ${primaryValidProof?.sourceTable}:${primaryValidProof?.id} (${primaryValidProof?.proofMethod}, SHA-256 validated)`
      : null,
    sourceObservations: persistedLiveSameRunObservations,
  };

  return {
    candidateId: candId,
    researchProductId,
    title,
    storeDomain,
    canonicalProductUrl: canonicalUrl,
    workspaceId,
    researchRunId,
    snapshotClaimedIdentityStatus,
    snapshotClaimedLiveObservationsCount,
    snapshotClaimedLiveVerified,
    persistedRunAdIds,
    persistedRunAdIngestOutcomes,
    persistedAdObservationIds,
    persistedLiveSameRunObservationIds,
    persistedLiveSameRunObservations,
    persistedObservationClassifications,
    persistedResearchEvidenceIds,
    persistedLandingPageSnapshotIds,
    persistedOfferSnapshotIds,
    persistedMerchantProofAudits: extractedProofs.allAuditedRecords,
    validPersistedMerchantProofs: extractedProofs.validProofs,
    persistedProductSchemaProofStatus,
    persistedLiveOriginProofStatus,
    rejectedCrossWorkspaceProofIds: Array.from(new Set(rejectedCrossWorkspaceProofIds)),
    rejectedSyntheticOrFallbackReasons: Array.from(new Set(rejectedSyntheticOrFallbackReasons)),
    persistedMerchantVerified,
    persistedMerchantProofRefs,
    reconstructedIdentityStatus: identityCls.identityStatus,
    reconstructedVerificationEvidenceStatus: identityCls.verificationEvidenceStatus,
    reconstructedIsCheckoutChampFunnel: identityCls.isCheckoutChampFunnel,
    reconstructedCandidateForG16,
  };
}

/**
 * Builds a complete `G16EvidenceIndex` and reconstructed candidate list strictly from
 * immutable persisted database rows (`P0-A`, `P0-B`, `P0-C`).
 */
export async function buildG16EvidenceIndexFromPersistedRows(
  prismaClient: any,
  workspaceId: string,
  researchRunId: string,
  candidates: any[],
  asOf?: Date | string
): Promise<{
  evidenceIndex: G16EvidenceIndex;
  audits: PersistedCandidateG16ProofAudit[];
  reconstructedCandidates: any[];
  previousSnapshotClaimedVerifiedCount: number;
}> {
  const safeList = Array.isArray(candidates) ? candidates : [];
  const audits: PersistedCandidateG16ProofAudit[] = [];
  for (const c of safeList) {
    const audit = await loadPersistedG16ProofForCandidate(
      prismaClient,
      workspaceId,
      researchRunId,
      c,
      asOf
    );
    audits.push(audit);
  }

  const allowedObservationIds = new Set<string>();
  const candidateObservationMap: Record<string, string[]> = {};
  const merchantEvidenceIndex: G16MerchantEvidenceIndex = {};

  for (const a of audits) {
    candidateObservationMap[a.candidateId] = a.persistedLiveSameRunObservationIds;
    for (const obsId of a.persistedLiveSameRunObservationIds) {
      allowedObservationIds.add(obsId);
    }
    const primaryProof = a.validPersistedMerchantProofs[0] || null;
    merchantEvidenceIndex[a.candidateId] = {
      verified: a.persistedMerchantVerified,
      proofRefs: a.persistedMerchantProofRefs,
      schemaVerified: a.persistedMerchantVerified,
      hasJsonLdProduct: Boolean(primaryProof?.hasJsonLdProduct),
      proofMethod: primaryProof?.proofMethod || "NONE",
      validationStatus:
        primaryProof?.validationStatus || "RAW_SOURCE_NOT_RECONSTRUCTABLE",
      fetchOutcome: a.persistedMerchantVerified ? "FETCH_SUCCEEDED" : "UNVERIFIED_PERSISTED_DB",
      merchantVerifiedProductName: a.persistedMerchantVerified ? a.title : undefined,
      persistedProofs: a.validPersistedMerchantProofs,
    };
  }

  const previousSnapshotClaimedVerifiedCount = audits.filter(
    (a) => a.snapshotClaimedLiveVerified
  ).length;

  return {
    evidenceIndex: {
      strictPersistedProofRequired: true,
      workspaceId,
      asOf,
      lineageIndex: {
        parentRunId: researchRunId,
        allowedObservationIds,
      },
      identityIndex: {
        candidateObservationMap,
      },
      merchantEvidenceIndex,
    },
    audits,
    reconstructedCandidates: audits.map((a) => a.reconstructedCandidateForG16),
    previousSnapshotClaimedVerifiedCount,
  };
}

export interface BuildG16DiagnosticReasonInput {
  evaluatedRunId: string | null;
  evaluatedWorkspaceId: string | null;
  requiredCount?: number;
  verifiedLiveCount: number;
  distinctFamiliesCount: number;
  distinctCanonicalProductsCount: number;
  previousSnapshotClaimedVerifiedCount: number;
  candidates: CandidateG16ProofEntry[];
  persistedProofAudit?: PersistedCandidateG16ProofAudit[];
}

/**
 * Pure dynamic G16 diagnostic reason builder (Workstream C).
 * Derives every count, position, domain, and status strictly from actual evaluated candidates and persisted proof audits.
 */
export function buildG16DiagnosticReason(input: BuildG16DiagnosticReasonInput): string {
  const requiredCount = input.requiredCount ?? 3;
  const runId = input.evaluatedRunId;
  const workspaceId = input.evaluatedWorkspaceId || "unknown";
  const candidates = Array.isArray(input.candidates) ? input.candidates : [];
  const audits = Array.isArray(input.persistedProofAudit) ? input.persistedProofAudit : [];

  if (!runId || runId === "none" || runId === "no_run_available") {
    return `No completed KH-02 research run is available for G16 evaluation (0/${requiredCount} live-verified merchant candidates).`;
  }

  if (candidates.length === 0) {
    return `Evaluated run '${runId}' in workspace '${workspaceId}' has 0 shortlisted candidates (0/${requiredCount} live-verified merchant candidates).`;
  }

  const totalFreshLiveObs = candidates.reduce((sum, c) => {
    const ids = c.authenticLiveObservationIds ?? c.persistedLiveSameRunObservationIds ?? [];
    return sum + ids.length;
  }, 0);

  const totalPersistedSchemaProofs = candidates.reduce((sum, c) => {
    const refs = c.persistedProofRowIds ?? c.persistedMerchantProofRefs ?? [];
    return sum + refs.length;
  }, 0);

  const candidatesWithSchemaProof = candidates.filter(
    (c) => c.productSchemaProofStatus === "VERIFIED" || c.verifiedMerchantIdentity
  ).length;
  const candidatesWithLiveOrigin = candidates.filter(
    (c) => c.originProofStatus === "VERIFIED" || c.authenticallyLive
  ).length;

  const isPass =
    input.verifiedLiveCount >= requiredCount &&
    input.distinctCanonicalProductsCount >= requiredCount &&
    input.distinctFamiliesCount >= requiredCount;

  if (isPass) {
    return `${input.verifiedLiveCount}/${requiredCount} shortlisted candidates in run '${runId}' (workspace '${workspaceId}') have verified merchant product schema proofs (${totalPersistedSchemaProofs} persisted proof row(s) across ${candidatesWithSchemaProof}/${candidates.length} candidates) and same-run live lineage (${totalFreshLiveObs} authentic live observation(s) across ${candidatesWithLiveOrigin}/${candidates.length} candidates) spanning ${input.distinctFamiliesCount} distinct product families.`;
  }

  const funnelClauses = candidates
    .map((c, idx) => ({ candidate: c, position: idx + 1 }))
    .filter(({ candidate }) => candidate.isCheckoutChampFunnel)
    .map(
      ({ candidate, position }) =>
        `candidate #${position} on '${
          candidate.storeDomain || candidate.canonicalProductUrl || candidate.candidateId
        }' is a CheckoutChamp/sales funnel retained as ${candidate.identityStatus}`
    );

  const semanticSnapshotCount = audits.reduce(
    (sum, a) =>
      sum +
      (a.persistedMerchantProofAudits || []).filter(
        (rec) => rec.validationStatus === "SEMANTIC_CONTENT_HASH_NOT_RAW_PROOF"
      ).length,
    0
  );

  const detailParts: string[] = [
    `stored snapshot claimed ${input.previousSnapshotClaimedVerifiedCount}/${requiredCount}`,
    `immutable DB rows in workspace '${workspaceId}' have ${totalFreshLiveObs} fresh live-ingested observation(s) (${candidatesWithLiveOrigin}/${candidates.length} candidates with live origin) and ${totalPersistedSchemaProofs} persisted product-schema proof(s) (${candidatesWithSchemaProof}/${candidates.length} candidates with schema proof)`,
  ];

  if (semanticSnapshotCount > 0) {
    detailParts.push(
      `${semanticSnapshotCount} LandingPageSnapshot row(s) store CRO commercial semantic digests rather than raw Product JSON-LD`
    );
  }

  if (funnelClauses.length > 0) {
    detailParts.push(funnelClauses.join("; "));
  }

  if (
    input.verifiedLiveCount >= requiredCount &&
    input.distinctFamiliesCount < requiredCount
  ) {
    detailParts.push(
      `only ${input.distinctFamiliesCount}/${requiredCount} distinct product families among live-verified candidates`
    );
  }

  return `Evaluated run '${runId}' has ${input.verifiedLiveCount}/${requiredCount} live-verified merchant candidates reconstructable from persisted DB rows (${detailParts.join(
    "; "
  )}).`;
}

export async function collectKh02AcceptanceDiagnostics(params: {
  sourceSha: string;
  liveWalmartArtifact10: any;
  liveAmazonProbeArtifact?: any;
  devBacktestShortlist?: Array<{
    candidateId: string;
    title: string;
    identityStatus: string;
    storeDomain: string | null;
    familyKey: string;
  }>;
  holdoutBacktestShortlist?: Array<{
    candidateId: string;
    title: string;
    identityStatus: string;
    storeDomain: string | null;
    familyKey: string;
  }>;
  env?: NodeJS.ProcessEnv;
}): Promise<Kh02AcceptanceDiagnostics> {
  const evaluatedAt = new Date().toISOString();
  const envToUse = params.env || process.env;

  const [metaDiag, googleDiag, tiktokDiag, demandDiag] = await Promise.all([
    diagnoseKH02Source("META_ADS", { checkLiveTransport: false }),
    diagnoseKH02Source("GOOGLE_ADS", { checkLiveTransport: false }),
    diagnoseKH02Source("TIKTOK_ADS", {
      checkLiveTransport: false,
      applyReleasePolicy: false,
    }),
    diagnoseKH02Source("DEMAND_HISTORY", { checkLiveTransport: false }),
  ]);

  const walmartDefaultPolicy = resolveWalmartUsPilotPolicy({});
  const amazonDefaultPolicy = resolveAmazonUsPolicyContext({});
  const amazonLiveEligibility = resolveCreatorsApiEligibility({
    ...envToUse,
    KH02_AMAZON_US_ENABLED: "true",
    KH02_AMAZON_US_LIVE_ALLOWED: "true",
  });

  const wmtStatus = String(
    params.liveWalmartArtifact10?.liveProviderStatus || "NOT_VERIFIED"
  );
  const wmtVerifiedCount = Number(
    params.liveWalmartArtifact10?.verifiedLiveProductCount || 0
  );
  const wmtLiveVerdict:
    | "LIVE_VERIFIED"
    | "BLOCKED_PROVIDER"
    | "RATE_LIMITED"
    | "DISABLED"
    | "NOT_VERIFIED" =
    wmtStatus === "SUCCEEDED" && wmtVerifiedCount > 0
      ? "LIVE_VERIFIED"
      : wmtStatus === "BLOCKED_PROVIDER"
      ? "BLOCKED_PROVIDER"
      : wmtStatus === "RATE_LIMITED"
      ? "RATE_LIMITED"
      : wmtStatus === "DISABLED"
      ? "DISABLED"
      : "NOT_VERIFIED";

  const amzLiveVerdict:
    | "LIVE_VERIFIED"
    | "CREDENTIALS_REQUIRED"
    | "DISABLED"
    | "BLOCKED"
    | "NOT_VERIFIED" = !amazonLiveEligibility.configured
    ? "CREDENTIALS_REQUIRED"
    : amazonLiveEligibility.querySucceeded
    ? "LIVE_VERIFIED"
    : "NOT_VERIFIED";

  // G07 dynamic calculation from tiktokDiag
  const g07Verdict: "PASS" | "BLOCKED" | "INSUFFICIENT_EVIDENCE" =
    tiktokDiag.configured &&
    tiktokDiag.queryExecuted &&
    (tiktokDiag.lastLiveQueryRecordCount ?? 0) > 0
      ? "PASS"
      : tiktokDiag.dimensions?.blockerCode === "NO_AUTHORIZED_US_AD_PROVIDER" ||
        !tiktokDiag.configured
      ? "BLOCKED"
      : "INSUFFICIENT_EVIDENCE";

  // Inspect latest completed KH-02 research run in SQLite that has Pet Gadgets shortlist candidates
  const recentJobs = await prisma.syncJob.findMany({
    where: { jobType: "KH02_RESEARCH", status: "COMPLETED" },
    orderBy: { createdAt: "desc" },
    take: 10,
  });

  let selectedJob: (typeof recentJobs)[number] | null = null;
  let selectedJobParsed: any = null;
  for (const job of recentJobs) {
    try {
      const parsed = JSON.parse(job.resultJson || "{}");
      const sl =
        parsed?.researchShortlist?.shortlist || parsed?.candidates || [];
      if (Array.isArray(sl) && sl.length > 0) {
        const hasPetCandidate = sl.some((c: any) =>
          PET_NICHE_KEYWORDS.test(`${c?.title || ""} ${c?.storeDomain || ""}`)
        );
        if (hasPetCandidate || !selectedJob) {
          selectedJob = job;
          selectedJobParsed = parsed;
          if (hasPetCandidate) break;
        }
      }
    } catch {
      // ignore malformed JSON
    }
  }

  const storedShortlist: any[] =
    selectedJobParsed?.researchShortlist?.shortlist ||
    selectedJobParsed?.candidates?.slice(0, 3) ||
    [];

  // Build G16 evaluation strictly from persisted database rows (P0-02: NO synthetic hydration!)
  const persistedG16Bundle = selectedJob
    ? await buildG16EvidenceIndexFromPersistedRows(
        prisma,
        selectedJob.workspaceId || "default-workspace",
        selectedJob.id,
        storedShortlist,
        selectedJob.createdAt ? new Date(selectedJob.createdAt) : undefined
      )
    : {
        evidenceIndex: { strictPersistedProofRequired: true },
        audits: [] as PersistedCandidateG16ProofAudit[],
        reconstructedCandidates: [] as any[],
        previousSnapshotClaimedVerifiedCount: 0,
      };

  const g16Eval = evaluateG16Top3(
    persistedG16Bundle.reconstructedCandidates,
    selectedJob?.id || "no_run_available",
    {
      requiredCount: 3,
      requireDistinctFamilies: true,
      evidenceIndex: persistedG16Bundle.evidenceIndex,
    }
  );

  const auditByCandId = new Map(
    persistedG16Bundle.audits.map((a) => [a.candidateId, a])
  );

  const g16Candidates: CandidateG16ProofEntry[] = g16Eval.entries.map(
    (entry: CandidateEvaluationResult) => {
      const nicheCheck = evaluatePetGadgetsNicheFit(
        entry.title,
        entry.storeDomain
      );
      const audit = auditByCandId.get(entry.candidateId);
      const primaryValidProof = audit?.validPersistedMerchantProofs?.[0] || null;
      const proofObservedAt = primaryValidProof?.observedAt
        ? typeof primaryValidProof.observedAt === "string"
          ? primaryValidProof.observedAt
          : new Date(primaryValidProof.observedAt).toISOString()
        : null;
      const persistedProofRowIds = audit?.persistedMerchantProofRefs || [];
      const authenticLiveObservationIds =
        audit?.persistedLiveSameRunObservationIds || [];
      const snapIdentity = audit?.snapshotClaimedIdentityStatus || null;
      const snapLiveVerified = Boolean(audit?.snapshotClaimedLiveVerified);
      const snapLiveObsCount = Number(
        audit?.snapshotClaimedLiveObservationsCount || 0
      );
      return {
        candidateId: entry.candidateId,
        title: entry.title,
        storeDomain: entry.storeDomain,
        canonicalProductUrl: entry.canonicalProductUrl,
        canonicalProductKey: entry.canonicalProductKey,
        familyKey: entry.familyKey,
        snapshotClaimedIdentityStatus: audit?.snapshotClaimedIdentityStatus,
        snapshotClaimedLiveVerified: audit?.snapshotClaimedLiveVerified,
        identityStatus: entry.identityStatus,
        verificationEvidenceStatus: audit?.reconstructedVerificationEvidenceStatus,
        productSchemaProofStatus:
          audit?.persistedProductSchemaProofStatus ||
          (entry.predicateResults.verifiedMerchantIdentity
            ? "VERIFIED"
            : "INSUFFICIENT_EVIDENCE"),
        proofMethod: primaryValidProof?.proofMethod || "NONE",
        persistedProofRowIds,
        proofSourceObservedAt: proofObservedAt,
        originProofStatus:
          audit?.persistedLiveOriginProofStatus ||
          (entry.predicateResults.authenticallyLive
            ? "VERIFIED"
            : "INSUFFICIENT_EVIDENCE"),
        authenticLiveObservationIds,
        matchingRunId:
          authenticLiveObservationIds.length > 0
            ? audit?.researchRunId || selectedJob?.id || null
            : null,
        matchingWorkspaceId: audit?.workspaceId || selectedJob?.workspaceId || null,
        isCheckoutChampFunnel: entry.isCheckoutChampFunnel,
        nicheRelevantToPetGadgets: nicheCheck.matches,
        nicheRelevanceReason: nicheCheck.reason,
        authenticallyLive: entry.predicateResults.authenticallyLive,
        sameRunLineage: entry.predicateResults.sameRunLineage,
        candidateProductMatch: entry.predicateResults.candidateProductMatch,
        verifiedMerchantIdentity: entry.predicateResults.verifiedMerchantIdentity,
        nonFunnelStore: entry.predicateResults.nonFunnelStore,
        g16PredicateStatuses: {
          authenticallyLive: entry.predicateResults.authenticallyLive,
          sameRunLineage: entry.predicateResults.sameRunLineage,
          candidateProductMatch: entry.predicateResults.candidateProductMatch,
          verifiedMerchantIdentity: entry.predicateResults.verifiedMerchantIdentity,
          nonFunnelStore: entry.predicateResults.nonFunnelStore,
        },
        isLiveVerified: entry.isLiveVerified,
        verificationMethod: entry.verificationMethod,
        persistedRunAdIds: audit?.persistedRunAdIds || [],
        persistedRunAdIngestOutcomes: audit?.persistedRunAdIngestOutcomes || [],
        persistedAdObservationIds: audit?.persistedAdObservationIds || [],
        persistedLiveSameRunObservationIds: authenticLiveObservationIds,
        persistedMerchantProofRefs: persistedProofRowIds,
        rejectedCrossWorkspaceProofIds:
          audit?.rejectedCrossWorkspaceProofIds || [],
        rejectedSyntheticOrFallbackReasons:
          audit?.rejectedSyntheticOrFallbackReasons || [],
        rejectionReasonCodes: entry.rejectionReasons,
        rejectionReasons: entry.rejectionReasons,
        storedSnapshotClaimDiff: {
          snapshotClaimedIdentityStatus: snapIdentity,
          reconstructedIdentityStatus: entry.identityStatus,
          snapshotClaimedLiveVerified: snapLiveVerified,
          reconstructedLiveVerified: entry.isLiveVerified,
          snapshotClaimedLiveObservationsCount: snapLiveObsCount,
          reconstructedLiveObservationsCount: authenticLiveObservationIds.length,
          claimDowngraded:
            (snapIdentity === "VERIFIED" && entry.identityStatus !== "VERIFIED") ||
            (snapLiveVerified && !entry.isLiveVerified) ||
            snapLiveObsCount > authenticLiveObservationIds.length,
        },
      };
    }
  );

  const g16Verdict:
    | "PASS"
    | "PARTIAL_2_OF_3"
    | "PARTIAL_1_OF_3"
    | "INSUFFICIENT_EVIDENCE"
    | "NOT_VERIFIED" = !selectedJob
    ? "NOT_VERIFIED"
    : g16Eval.g16Verdict === "PASS" && g16Eval.verifiedLiveCount >= 3
    ? "PASS"
    : g16Eval.verifiedLiveCount === 2
    ? "PARTIAL_2_OF_3"
    : g16Eval.verifiedLiveCount === 1
    ? "PARTIAL_1_OF_3"
    : "INSUFFICIENT_EVIDENCE";

  const g16ReconstructionStatus:
    | "RECONSTRUCTED_FROM_PERSISTED_DB"
    | "HISTORICAL_SNAPSHOT_PROOF_NOT_RECONSTRUCTABLE"
    | "NO_RUN_AVAILABLE" = !selectedJob
    ? "NO_RUN_AVAILABLE"
    : persistedG16Bundle.previousSnapshotClaimedVerifiedCount >
      g16Eval.verifiedLiveCount
    ? "HISTORICAL_SNAPSHOT_PROOF_NOT_RECONSTRUCTABLE"
    : "RECONSTRUCTED_FROM_PERSISTED_DB";

  // G15 dynamic calculation across stored shortlist + DEV/HOLDOUT backtest shortlists
  const totalDemandObsCount = await prisma.productDemandObservation.count();
  const candidateTargetsForG15: Array<{
    candidateId: string;
    title: string;
    storeDomain: string | null;
    familyKey: string;
    sourceSplit: "STORED_RUN" | "DEV_BACKTEST" | "HOLDOUT_BACKTEST";
  }> = [
    ...storedShortlist.map((c: any) => ({
      candidateId: String(c.candidateId || "unknown"),
      title: String(c.title || "Untitled"),
      storeDomain: c.storeDomain ? String(c.storeDomain) : null,
      familyKey: String(c.familyKey || "stored_family"),
      sourceSplit: "STORED_RUN" as const,
    })),
    ...(params.devBacktestShortlist || []).map((c) => ({
      candidateId: c.candidateId,
      title: c.title,
      storeDomain: c.storeDomain,
      familyKey: c.familyKey,
      sourceSplit: "DEV_BACKTEST" as const,
    })),
    ...(params.holdoutBacktestShortlist || []).map((c) => ({
      candidateId: c.candidateId,
      title: c.title,
      storeDomain: c.storeDomain,
      familyKey: c.familyKey,
      sourceSplit: "HOLDOUT_BACKTEST" as const,
    })),
  ];

  const evaluatedProductsG15: ProductG15DemandCoverageEntry[] = [];
  for (const item of candidateTargetsForG15) {
    const obsRows = await prisma.productDemandObservation.findMany({
      where: {
        OR: [{ productId: item.candidateId }, { keyword: item.title }],
      },
      orderBy: { periodStart: "asc" },
    });

    const assessment = evaluateDemandHistoryEvidence(obsRows as any[], {
      minimumCoveredDays: 60,
      candidateCanonicalName: item.title,
      candidateProductId: item.candidateId,
    });

    const earliest =
      obsRows.length > 0 && obsRows[0].periodStart
        ? new Date(obsRows[0].periodStart).toISOString()
        : null;
    const latest =
      obsRows.length > 0 && obsRows[obsRows.length - 1].periodEnd
        ? new Date(obsRows[obsRows.length - 1].periodEnd).toISOString()
        : null;

    const coveredDays = assessment.coveredDays || 0;
    const eligible =
      assessment.status === "VERIFIED" && assessment.eligibleForEvergreen;

    evaluatedProductsG15.push({
      candidateId: item.candidateId,
      title: item.title,
      storeDomain: item.storeDomain,
      familyKey: item.familyKey,
      sourceSplit: item.sourceSplit,
      authoritativeObservationsCount: obsRows.length,
      distinctObservationDatesCount: assessment.distinctObservationDatesCount || 0,
      coveredDays,
      requiredDays: 60,
      missingDaysTo60: Math.max(0, 60 - coveredDays),
      earliestObservedAt: earliest,
      latestObservedAt: latest,
      demandClass: assessment.demandClass,
      sourceAuthority: assessment.sourceAuthority,
      eligibleForEvergreen: eligible,
      g15Status: eligible ? "PASS" : "INSUFFICIENT_EVIDENCE",
      reason: eligible
        ? `Verified >=60d product-level demand (${coveredDays} days across ${obsRows.length} observations).`
        : `Product '${item.title}' has ${obsRows.length} authoritative demand observations covering ${coveredDays}/60 required days (${Math.max(
            0,
            60 - coveredDays
          )} days missing). Marketplace listing discovery does not substitute for 60d demand.`,
    });
  }

  const qualifiedG15Count = evaluatedProductsG15.filter(
    (p) => p.sourceSplit === "STORED_RUN" && p.g15Status === "PASS"
  ).length;
  const g15Verdict: "PASS" | "INSUFFICIENT_EVIDENCE" =
    qualifiedG15Count >= 3 ? "PASS" : "INSUFFICIENT_EVIDENCE";

  // Shortlist quality & niche relevance audit
  const holdoutList = params.holdoutBacktestShortlist || [];
  const holdoutMismatches: Array<{
    candidateId: string;
    title: string;
    storeDomain: string | null;
    reason: string;
  }> = [];
  let holdoutNicheMatched = 0;
  for (const h of holdoutList) {
    const fit = evaluatePetGadgetsNicheFit(h.title, h.storeDomain);
    if (fit.matches) {
      holdoutNicheMatched += 1;
    } else {
      holdoutMismatches.push({
        candidateId: h.candidateId,
        title: h.title,
        storeDomain: h.storeDomain,
        reason: fit.reason,
      });
    }
  }

  const storedNicheMatched = g16Candidates.filter(
    (c) => c.nicheRelevantToPetGadgets
  ).length;

  return {
    sourceSha: params.sourceSha,
    evaluatedAt,
    dataAsOf: selectedJob?.createdAt
      ? new Date(selectedJob.createdAt).toISOString()
      : evaluatedAt,
    providers: {
      walmartUs: {
        providerId: "WALMART_US",
        transport: "JINA_READER_REST_NO_KEY",
        defaultFeatureEnabled: walmartDefaultPolicy.featureEnabled,
        defaultLiveAllowed: walmartDefaultPolicy.liveAllowed,
        probeExecutionStatus:
          params.liveWalmartArtifact10?.probeExecutionStatus === "DID_RUN"
            ? "DID_RUN"
            : "NOT_RUN",
        classificationIntegrityStatus:
          params.liveWalmartArtifact10?.classificationIntegrityStatus === "PASS"
            ? "PASS"
            : "FAIL",
        liveProviderStatus: wmtStatus,
        liveVerdict: wmtLiveVerdict,
        verifiedLiveProductCount: wmtVerifiedCount,
        attemptedLiveCallsCount: Number(
          params.liveWalmartArtifact10?.networkAttemptsUsed || 0
        ),
        reason: String(
          params.liveWalmartArtifact10?.statusReason ||
            walmartDefaultPolicy.reason
        ),
      },
      amazonUs: {
        providerId: "AMAZON_US",
        transport: "CREATORS_API_AND_PLAYWRIGHT_MCP",
        defaultFeatureEnabled: amazonDefaultPolicy.featureEnabled,
        defaultLiveAllowed: amazonDefaultPolicy.liveAllowed,
        configured: amazonLiveEligibility.configured,
        authenticated: amazonLiveEligibility.authenticated,
        querySucceeded: amazonLiveEligibility.querySucceeded,
        liveVerdict: amzLiveVerdict,
        verifiedLiveProductCount: Number(
          params.liveAmazonProbeArtifact?.verifiedLiveProductCount || 0
        ),
        attemptedLiveCallsCount: Number(
          params.liveAmazonProbeArtifact?.attemptedLiveCallsCount || 0
        ),
        missingEnvKeys: [
          ...(!amazonLiveEligibility.hasCredentialId
            ? ["KH02_AMAZON_CREATORS_CREDENTIAL_ID"]
            : []),
          ...(!amazonLiveEligibility.hasCredentialSecret
            ? ["KH02_AMAZON_CREATORS_CREDENTIAL_SECRET"]
            : []),
          ...(!amazonLiveEligibility.hasPartnerTag
            ? ["KH02_AMAZON_PARTNER_TAG"]
            : []),
        ],
        reason: amazonLiveEligibility.reason,
        localMcpPilot: {
          routeId: "AMAZON_LOCAL_MCP_PUBLIC_URL_PILOT",
          probeExecutionStatus:
            params.liveAmazonProbeArtifact?.probeExecutionStatus === "DID_RUN"
              ? "DID_RUN"
              : "NOT_RUN",
          transportHandshakeStatus:
            params.liveAmazonProbeArtifact?.transportHandshakeStatus ||
            "NOT_ATTEMPTED",
          actualBrowserToolExecutionStatus:
            params.liveAmazonProbeArtifact?.actualBrowserToolExecutionStatus ||
            "NOT_ATTEMPTED",
          realAmazonPageObservationStatus:
            params.liveAmazonProbeArtifact?.realAmazonPageObservationStatus ||
            "NOT_ATTEMPTED",
          productIdentityVerificationStatus:
            params.liveAmazonProbeArtifact?.productIdentityVerificationStatus ||
            "NOT_ATTEMPTED",
          liveVerdict:
            params.liveAmazonProbeArtifact?.liveVerdict || "NOT_VERIFIED",
          verifiedLiveProductCount: Number(
            params.liveAmazonProbeArtifact?.verifiedLiveProductCount || 0
          ),
          attemptedLiveCallsCount: Number(
            params.liveAmazonProbeArtifact?.attemptedLiveCallsCount || 0
          ),
          reason: String(
            params.liveAmazonProbeArtifact?.statusReason ||
              "Original Amazon US Microsoft Playwright MCP pilot route (independent of Creators API credentials)."
          ),
        },
        creatorsApi: {
          routeId: "AMAZON_CREATORS_API",
          independentOfLocalMcpPilot: true,
          configured: amazonLiveEligibility.configured,
          authenticated: amazonLiveEligibility.authenticated,
          querySucceeded: amazonLiveEligibility.querySucceeded,
          status: amazonLiveEligibility.status,
          missingEnvKeys: [
            ...(!amazonLiveEligibility.hasCredentialId
              ? ["KH02_AMAZON_CREATORS_CREDENTIAL_ID"]
              : []),
            ...(!amazonLiveEligibility.hasCredentialSecret
              ? ["KH02_AMAZON_CREATORS_CREDENTIAL_SECRET"]
              : []),
            ...(!amazonLiveEligibility.hasPartnerTag
              ? ["KH02_AMAZON_PARTNER_TAG"]
              : []),
          ],
          reason: amazonLiveEligibility.reason,
        },
      },
      tiktokUsG07: {
        providerId: "TIKTOK_ADS",
        gateId: "G07",
        configured: tiktokDiag.configured,
        transportStatus: tiktokDiag.transportStatus || "NOT_CONFIGURED",
        authStatus: tiktokDiag.authStatus || "CREDENTIALS_REQUIRED",
        diagnosticStatus: tiktokDiag.status,
        storedRecordsCount: Number(tiktokDiag.storedRecordCount || 0),
        verdict: g07Verdict,
        missingRequirements: tiktokDiag.missingRequirements || [],
        reason: tiktokDiag.reason,
      },
      googleAds: {
        providerId: "GOOGLE_ADS",
        configured: googleDiag.configured,
        transportStatus: googleDiag.transportStatus || "NOT_CONFIGURED",
        diagnosticStatus: googleDiag.status,
        reason: googleDiag.reason,
      },
      metaAds: {
        providerId: "META_ADS",
        configured: metaDiag.configured,
        transportStatus: metaDiag.transportStatus || "NOT_TESTED",
        storedRecordsCount: Number(metaDiag.storedRecordCount || 0),
        diagnosticStatus: metaDiag.status,
        reason: metaDiag.reason,
      },
      demandHistory: {
        providerId: "DEMAND_HISTORY",
        mode: "GOOGLE_FREE_ONLY",
        configured: demandDiag.configured,
        diagnosticStatus: demandDiag.status,
        storedProductDemandObservationsCount: totalDemandObsCount,
        missingRequirements: demandDiag.missingRequirements || [],
        reason: demandDiag.reason,
      },
    },
    gates: {
      g07: {
        gateId: "G07",
        verdict: g07Verdict,
        evaluatedFromSource: "diagnoseKH02Source('TIKTOK_ADS')",
        reason: tiktokDiag.reason,
      },
      g15: {
        gateId: "G15",
        verdict: g15Verdict,
        requiredCoveredDays: 60,
        qualifiedProductsCount: qualifiedG15Count,
        requiredQualifiedProductsCount: 3,
        totalDemandObservationsInDb: totalDemandObsCount,
        evaluatedProducts: evaluatedProductsG15,
        reason:
          g15Verdict === "PASS"
            ? "All 3 shortlisted candidates have >=60 days of authoritative product-level demand."
            : `ProductDemandObservation table has ${totalDemandObsCount} rows (${qualifiedG15Count}/3 shortlisted candidates meet >=60d authoritative product-level longitudinal demand).`,
        remediationGuidance:
          "Configure BIGQUERY_PROJECT_ID + GOOGLE_APPLICATION_CREDENTIALS (free sandbox) or import verified Google Trends Explore CSVs covering >=60 days per candidate product.",
      },
      g16: {
        gateId: "G16",
        verdict: g16Verdict,
        snapshotFreshness: selectedJob
          ? "HISTORICAL_SNAPSHOT_RE_EVALUATED"
          : "NO_RUN_AVAILABLE",
        reconstructionStatus: g16ReconstructionStatus,
        evaluatedRunId: selectedJob?.id || null,
        evaluatedWorkspaceId: selectedJob?.workspaceId || null,
        evaluatedRunCreatedAt: selectedJob?.createdAt
          ? new Date(selectedJob.createdAt).toISOString()
          : null,
        previousSnapshotClaimedVerifiedCount:
          persistedG16Bundle.previousSnapshotClaimedVerifiedCount,
        verifiedFromPersistedEvidenceCount: g16Eval.verifiedLiveCount,
        newLiveVerifiedDuringThisRun: 0,
        verifiedLiveMerchantsCount: g16Eval.verifiedLiveCount,
        requiredLiveMerchantsCount: 3,
        distinctFamiliesCount: g16Eval.distinctFamiliesCount,
        distinctCanonicalProductsCount: g16Eval.distinctCanonicalProductsCount,
        candidates: g16Candidates,
        persistedProofAudit: persistedG16Bundle.audits,
        reason: buildG16DiagnosticReason({
          evaluatedRunId: selectedJob?.id || null,
          evaluatedWorkspaceId: selectedJob?.workspaceId || null,
          requiredCount: 3,
          verifiedLiveCount: g16Eval.verifiedLiveCount,
          distinctFamiliesCount: g16Eval.distinctFamiliesCount,
          distinctCanonicalProductsCount: g16Eval.distinctCanonicalProductsCount,
          previousSnapshotClaimedVerifiedCount:
            persistedG16Bundle.previousSnapshotClaimedVerifiedCount,
          candidates: g16Candidates,
          persistedProofAudit: persistedG16Bundle.audits,
        }),
      },
    },
    shortlistQuality: {
      targetNiche: "Pet Gadgets",
      storedRunShortlistNicheMatchedCount: storedNicheMatched,
      storedRunShortlistTotalCount: g16Candidates.length,
      holdoutBacktestShortlistNicheMatchedCount: holdoutNicheMatched,
      holdoutBacktestShortlistTotalCount: holdoutList.length,
      holdoutNicheMismatches: holdoutMismatches,
      allThreeNicheMatchedAndVerified:
        storedNicheMatched >= 3 && g16Verdict === "PASS" && g15Verdict === "PASS",
    },
  };
}

export function computeOverallBusinessVerdict(
  diagnostics: Kh02AcceptanceDiagnostics
): "PASS" | "INSUFFICIENT_EVIDENCE" | "BLOCKED" | "NOT_VERIFIED" {
  if (!diagnostics || !diagnostics.gates) {
    return "NOT_VERIFIED";
  }
  const g07 = diagnostics.gates.g07.verdict;
  const g15 = diagnostics.gates.g15.verdict;
  const g16 = diagnostics.gates.g16.verdict;

  if (
    g07 === "PASS" &&
    g15 === "PASS" &&
    g16 === "PASS" &&
    diagnostics.shortlistQuality.allThreeNicheMatchedAndVerified
  ) {
    return "PASS";
  }

  if (g16 === "NOT_VERIFIED") {
    return "NOT_VERIFIED";
  }

  return "INSUFFICIENT_EVIDENCE";
}

export interface ComputeReleaseVerdictsInput {
  releaseVersion: string;
  runtimeReleaseIdentity: string;
  branch: string;
  baseSha: string;
  masterHeadSha: string;
  codeSha: string;
  testedTreeSha: string;
  engineeringInput: ComputeEngineeringVerdictInput;
  diagnostics: Kh02AcceptanceDiagnostics;
  backtestOutput: {
    backtestEngineExecuted: "PASS" | "FAIL";
    pointInTimeIntegrityVerdict: "PASS" | "FAIL";
    policyScenarioVerdict: "PASS" | "FAIL";
    policyScenariosPassed: string;
    devObservationsCount: number;
    holdoutObservationsCount: number;
    devShortlistCount?: number;
    devShortlistNicheMatchedCount?: number;
    devNicheCoverageStatus?: string;
    holdoutShortlistCount?: number;
    holdoutShortlistNicheMatchedCount?: number;
    holdoutNicheCoverageStatus?: string;
    businessHistoricalEvidenceSufficient: "PASS" | "INSUFFICIENT_EVIDENCE";
    overallHistoricalBacktestVerdict: "PASS" | "INSUFFICIENT_HISTORICAL_EVIDENCE";
  };
  nonInflationSummary: {
    comparedCandidatesCount: number;
    candidateSetMatch: boolean;
    providerPathExercised: boolean;
    walmartEvidenceRowsExercised: number;
    scoreDeltaAbsMax: number;
    rankingChanged: boolean;
    gateChanges: number;
    nonInflationVerified: boolean;
  };
  e2eExecutionSummary?: {
    totalSpecs: number;
    executedSpecsCount?: number;
    passedSpecsCount: number;
    failedSpecsCount: number;
    envPrerequisiteBlockedSpecsCount?: number;
    skippedWithoutAttemptCount: number;
  };
  e2eSpecsSummary?: {
    totalSpecs: number;
    executedSpecsCount?: number;
    passedSpecsCount: number;
    failedSpecsCount: number;
    envPrerequisiteBlockedSpecsCount?: number;
    skippedWithoutAttemptCount: number;
  };
  nicheRelevanceSummary?: {
    crossNicheFalsePositivesInDevTop3?: number;
    crossNicheFalsePositivesInHoldoutTop3?: number;
    devCrossNicheFalsePositives?: number;
    holdoutCrossNicheFalsePositives?: number;
    paddedWithMismatchOrUncertainCount?: number;
    devShortlistCount?: number;
    devNicheMatchedCount?: number;
    devNicheCoverageStatus?: "SUFFICIENT_NICHE_COVERAGE" | "INSUFFICIENT_NICHE_COVERAGE";
    holdoutShortlistCount?: number;
    holdoutNicheMatchedCount?: number;
    holdoutNicheCoverageStatus?: "SUFFICIENT_NICHE_COVERAGE" | "INSUFFICIENT_NICHE_COVERAGE";
    nicheUnitAndReplayTestsPassed?: boolean;
  };
  historicalIdentitySummary?: {
    devVerifiedIdentityCount?: number;
    holdoutVerifiedIdentityCount?: number;
    holdoutFunnelProbableCount?: number;
    holdoutIdentityCoverageStatus?: "SUFFICIENT_VERIFIED_IDENTITY" | "INSUFFICIENT_VERIFIED_IDENTITY";
    urlPathOnlyPromotedToVerifiedCount?: number;
    funnelPromotedToVerifiedCount?: number;
    discoveryRefsCopiedToIndependentProofCount?: number;
    g16PreviousSnapshotClaimedVerifiedCount?: number;
    g16VerifiedFromPersistedEvidenceCount?: number;
    g16ReconstructionStatus?: string;
    g16SyntheticHydrationUsed?: boolean;
  };
  negativeMutationsCaught: string;
  ancestryVerified: boolean;
}

export function computeReleaseVerdicts(input: ComputeReleaseVerdictsInput) {
  const engineeringVerdict = computeEngineeringVerdict(input.engineeringInput);
  const kh02BusinessVerdict = computeOverallBusinessVerdict(input.diagnostics);

  const liveWalmartProviderVerdict =
    input.diagnostics.providers.walmartUs.liveVerdict === "LIVE_VERIFIED"
      ? "LIVE_VERIFIED"
      : input.diagnostics.providers.walmartUs.liveProviderStatus;

  const liveAmazonProviderVerdict =
    input.diagnostics.providers.amazonUs.liveVerdict;

  const historicalEvidenceVerdict =
    input.backtestOutput.overallHistoricalBacktestVerdict;

  const historicalG07Verdict = input.diagnostics.gates.g07.verdict;
  const historicalG15Verdict = input.diagnostics.gates.g15.verdict;
  const historicalG16Verdict = input.diagnostics.gates.g16.verdict;

  const broadRegressionVerdict: "PASS" | "FAIL" | "INCOMPLETE" =
    !input.engineeringInput.regressionInventory.inventoryComplete ||
    input.engineeringInput.regressionInventory.targetedOnly ||
    input.engineeringInput.regressionInventory.totalExecutedTestCases <= 0
      ? "INCOMPLETE"
      : input.engineeringInput.regressionInventory.failedTestCases === 0 &&
        input.engineeringInput.regressionInventory.requiredActiveSuiteFailedTestCases === 0 &&
        input.engineeringInput.regressionInventory.baselineKnownPolicySupersededTestCases === 0 &&
        input.engineeringInput.regressionInventory.newRegressionTestCases === 0
      ? "PASS"
      : "FAIL";

  const e2eSummary = input.e2eExecutionSummary || input.e2eSpecsSummary;
  const e2eExecutedCount =
    e2eSummary?.executedSpecsCount ??
    (e2eSummary
      ? e2eSummary.passedSpecsCount +
        e2eSummary.failedSpecsCount +
        (e2eSummary.envPrerequisiteBlockedSpecsCount ?? 0)
      : 0);

  const requiredE2eCoverageVerdict:
    | "PASS"
    | "ENV_PREREQUISITE_BLOCKED"
    | "FAIL"
    | "INCOMPLETE" = !e2eSummary
    ? engineeringVerdict === "PASS"
      ? "PASS"
      : "INCOMPLETE"
    : e2eSummary.skippedWithoutAttemptCount > 0 ||
      e2eExecutedCount < e2eSummary.totalSpecs
    ? "INCOMPLETE"
    : e2eSummary.failedSpecsCount > 0
    ? "FAIL"
    : (e2eSummary.envPrerequisiteBlockedSpecsCount ?? 0) > 0
    ? "ENV_PREREQUISITE_BLOCKED"
    : e2eSummary.passedSpecsCount === e2eSummary.totalSpecs
    ? "PASS"
    : "INCOMPLETE";

  const historicalReplayIntegrityVerdict: "PASS" | "FAIL" =
    input.backtestOutput.backtestEngineExecuted === "PASS" &&
    input.backtestOutput.pointInTimeIntegrityVerdict === "PASS" &&
    input.backtestOutput.policyScenarioVerdict === "PASS"
      ? "PASS"
      : "FAIL";

  const holdoutMismatchesCount =
    input.diagnostics.shortlistQuality?.holdoutNicheMismatches?.length ?? 0;
  const nr = input.nicheRelevanceSummary;
  const devCrossFp =
    nr?.crossNicheFalsePositivesInDevTop3 ?? nr?.devCrossNicheFalsePositives ?? 0;
  const holdoutCrossFp =
    nr?.crossNicheFalsePositivesInHoldoutTop3 ??
    nr?.holdoutCrossNicheFalsePositives ??
    0;
  const paddedMismatchCount = nr?.paddedWithMismatchOrUncertainCount ?? 0;
  const nicheTestsPassed = nr?.nicheUnitAndReplayTestsPassed ?? true;
  const holdoutMatched = nr?.holdoutNicheMatchedCount ?? 3;
  const holdoutShortlist = nr?.holdoutShortlistCount ?? 3;
  const devMatched = nr?.devNicheMatchedCount ?? 0;
  const devShortlist = nr?.devShortlistCount ?? 0;

  const nicheRelevanceVerdict: "PASS" | "FAIL" = nr
    ? nicheTestsPassed &&
      devCrossFp === 0 &&
      holdoutCrossFp === 0 &&
      paddedMismatchCount === 0 &&
      holdoutMatched === holdoutShortlist &&
      devMatched === devShortlist &&
      holdoutMismatchesCount === 0
      ? "PASS"
      : "FAIL"
    : holdoutMismatchesCount === 0
    ? "PASS"
    : "FAIL";

  const deliveryVerdict: "READY_FOR_REVIEW" | "INCOMPLETE" | "BLOCKED" =
    engineeringVerdict === "PASS" &&
    broadRegressionVerdict === "PASS" &&
    (requiredE2eCoverageVerdict === "PASS" ||
      requiredE2eCoverageVerdict === "ENV_PREREQUISITE_BLOCKED") &&
    historicalReplayIntegrityVerdict === "PASS" &&
    nicheRelevanceVerdict === "PASS" &&
    input.ancestryVerified
      ? "READY_FOR_REVIEW"
      : engineeringVerdict === "BLOCKED"
      ? "BLOCKED"
      : "INCOMPLETE";

  const remainingExternalBlockers: Array<{
    blockerId: string;
    dimension: string;
    status: string;
    detail: string;
  }> = [];

  if (liveWalmartProviderVerdict !== "LIVE_VERIFIED") {
    remainingExternalBlockers.push({
      blockerId: "EXT_WALMART_JINA_BOT_WALL",
      dimension: "liveWalmartProviderVerdict",
      status: liveWalmartProviderVerdict,
      detail: input.diagnostics.providers.walmartUs.reason,
    });
  }

  if (liveAmazonProviderVerdict !== "LIVE_VERIFIED") {
    remainingExternalBlockers.push({
      blockerId: "EXT_AMAZON_CREATORS_CREDENTIALS",
      dimension: "liveAmazonProviderVerdict",
      status: liveAmazonProviderVerdict,
      detail: input.diagnostics.providers.amazonUs.reason,
    });
  }

  if (historicalG15Verdict !== "PASS") {
    remainingExternalBlockers.push({
      blockerId: "EXT_G15_60D_LONGITUDINAL_DEMAND",
      dimension: "historicalG15Verdict",
      status: historicalG15Verdict,
      detail: input.diagnostics.gates.g15.reason,
    });
  }

  if (historicalG07Verdict !== "PASS") {
    remainingExternalBlockers.push({
      blockerId: "EXT_G07_TIKTOK_US_SOURCE",
      dimension: "historicalG07Verdict",
      status: historicalG07Verdict,
      detail: input.diagnostics.gates.g07.reason,
    });
  }

  if (historicalG16Verdict !== "PASS") {
    remainingExternalBlockers.push({
      blockerId: "EXT_G16_TOP3_LIVE_MERCHANT_PROOF",
      dimension: "historicalG16Verdict",
      status: historicalG16Verdict,
      detail: input.diagnostics.gates.g16.reason,
    });
  }

  let overallVerdict:
    | "FULL_ACCEPTANCE"
    | "ENGINEERING_READY_WITH_EXTERNAL_BLOCKERS"
    | "FAIL"
    | "BLOCKED"
    | "INCOMPLETE";

  if (engineeringVerdict !== "PASS") {
    overallVerdict = engineeringVerdict;
  } else if (
    broadRegressionVerdict !== "PASS" ||
    historicalReplayIntegrityVerdict !== "PASS" ||
    nicheRelevanceVerdict !== "PASS" ||
    requiredE2eCoverageVerdict === "FAIL"
  ) {
    overallVerdict = "FAIL";
  } else if (requiredE2eCoverageVerdict === "INCOMPLETE") {
    overallVerdict = "INCOMPLETE";
  } else if (
    kh02BusinessVerdict === "PASS" &&
    liveWalmartProviderVerdict === "LIVE_VERIFIED" &&
    historicalEvidenceVerdict === "PASS" &&
    remainingExternalBlockers.length === 0
  ) {
    overallVerdict = "FULL_ACCEPTANCE";
  } else {
    overallVerdict = "ENGINEERING_READY_WITH_EXTERNAL_BLOCKERS";
  }

  const hi = input.historicalIdentitySummary;
  const historicalProductIdentityTruthVerdict: "PASS" | "FAIL" = hi
    ? (hi.urlPathOnlyPromotedToVerifiedCount ?? 0) === 0 &&
      (hi.funnelPromotedToVerifiedCount ?? 0) === 0 &&
      (hi.discoveryRefsCopiedToIndependentProofCount ?? 0) === 0 &&
      hi.g16SyntheticHydrationUsed === false &&
      ((hi.holdoutVerifiedIdentityCount ?? 0) >= 3 ||
        hi.holdoutIdentityCoverageStatus === "INSUFFICIENT_VERIFIED_IDENTITY")
      ? "PASS"
      : "FAIL"
    : "PASS";

  const liveProvidersEntry = {
    WALMART_US: liveWalmartProviderVerdict,
    AMAZON_US: liveAmazonProviderVerdict,
    TIKTOK_US_G07: input.diagnostics.providers.tiktokUsG07?.verdict || historicalG07Verdict,
    TIKTOK_ADS: input.diagnostics.providers.tiktokUsG07?.verdict || historicalG07Verdict,
    GOOGLE_ADS: input.diagnostics.providers.googleAds?.diagnosticStatus || "CONFIGURED",
    META_ADS: input.diagnostics.providers.metaAds?.diagnosticStatus || "CONFIGURED",
    DEMAND_HISTORY: input.diagnostics.providers.demandHistory?.diagnosticStatus || "BLOCKED",
  };

  const g16Audits = input.diagnostics.gates.g16.persistedProofAudit || [];
  const persistedSchemaVerifiedCount = g16Audits.filter(
    (a) => a.persistedProductSchemaProofStatus === "VERIFIED"
  ).length;
  const persistedLiveOriginVerifiedCount = g16Audits.filter(
    (a) => a.persistedLiveOriginProofStatus === "VERIFIED"
  ).length;
  const persistedProductSchemaProofVerdict: "PASS" | "INSUFFICIENT_EVIDENCE" =
    persistedSchemaVerifiedCount >= 3 ? "PASS" : "INSUFFICIENT_EVIDENCE";
  const persistedLiveOriginProofVerdict: "PASS" | "INSUFFICIENT_EVIDENCE" =
    persistedLiveOriginVerifiedCount >= 3 ? "PASS" : "INSUFFICIENT_EVIDENCE";

  const verdictMatrix = {
    ENGINEERING_TESTS: engineeringVerdict,
    BROAD_REGRESSION: broadRegressionVerdict,
    REQUIRED_E2E_COVERAGE: requiredE2eCoverageVerdict,
    HISTORICAL_REPLAY_INTEGRITY: historicalReplayIntegrityVerdict,
    NICHE_RELEVANCE: nicheRelevanceVerdict,
    HISTORICAL_PRODUCT_IDENTITY_TRUTH: historicalProductIdentityTruthVerdict,
    HISTORICAL_VERIFIED_IDENTITY_COVERAGE:
      hi?.holdoutIdentityCoverageStatus || "INSUFFICIENT_VERIFIED_IDENTITY",
    PERSISTED_PRODUCT_SCHEMA_PROOF: persistedProductSchemaProofVerdict,
    PERSISTED_LIVE_ORIGIN_PROOF: persistedLiveOriginProofVerdict,
    PERSISTED_SCHEMA_TRUTH_ENFORCEMENT: historicalProductIdentityTruthVerdict,
    LIVE_OBSERVATION_ORIGIN_ENFORCEMENT: historicalProductIdentityTruthVerdict,
    LIVE_PROVIDERS: liveProvidersEntry,
    CURRENT_LIVE_PROVIDERS: liveProvidersEntry,
    HISTORICAL_DEMAND_G15: historicalG15Verdict,
    MERCHANT_TOP3_G16: historicalG16Verdict,
    HISTORICAL_STORED_PROOF: {
      snapshotRunId: input.diagnostics.gates.g16.evaluatedRunId,
      snapshotCreatedAt: input.diagnostics.gates.g16.evaluatedRunCreatedAt,
      snapshotFreshness: input.diagnostics.gates.g16.snapshotFreshness,
      reconstructionStatus: input.diagnostics.gates.g16.reconstructionStatus,
      previousSnapshotClaimedVerifiedCount:
        input.diagnostics.gates.g16.previousSnapshotClaimedVerifiedCount,
      verifiedFromPersistedEvidenceCount:
        input.diagnostics.gates.g16.verifiedFromPersistedEvidenceCount,
      persistedSchemaVerifiedCount,
      persistedLiveOriginVerifiedCount,
      newLiveVerifiedDuringThisRun:
        input.diagnostics.gates.g16.newLiveVerifiedDuringThisRun,
      storedG16Verdict: historicalG16Verdict,
      verifiedLiveMerchantsCount: input.diagnostics.gates.g16.verifiedLiveMerchantsCount,
      requiredLiveMerchantsCount: input.diagnostics.gates.g16.requiredLiveMerchantsCount,
      storedShortlistNicheMatchedCount:
        input.diagnostics.shortlistQuality.storedRunShortlistNicheMatchedCount,
      storedShortlistTotalCount:
        input.diagnostics.shortlistQuality.storedRunShortlistTotalCount,
    },
    BUSINESS_EVERGREEN_COVERAGE: kh02BusinessVerdict,
    FINAL_RELEASE: overallVerdict,
  };

  return {
    releaseVersion: input.releaseVersion,
    runtimeReleaseIdentity: input.runtimeReleaseIdentity,
    branch: input.branch,
    baseSha: input.baseSha,
    masterHeadSha: input.masterHeadSha,
    codeSha: input.codeSha,
    testedCodeSha: input.codeSha,
    testedTreeSha: input.testedTreeSha,
    engineeringVerdict,
    broadRegressionVerdict,
    requiredE2eCoverageVerdict,
    historicalReplayIntegrityVerdict,
    nicheRelevanceVerdict,
    historicalProductIdentityTruthVerdict,
    liveWalmartProviderVerdict,
    liveAmazonProviderVerdict,
    kh02BusinessVerdict,
    historicalEvidenceVerdict,
    historicalG07Verdict,
    historicalG15Verdict,
    historicalG16Verdict,
    deliveryVerdict,
    overallVerdict,
    verdictMatrix,
    nonInflationSummary: input.nonInflationSummary,
    backtestSummary: input.backtestOutput,
    e2eExecutionSummary: input.e2eExecutionSummary || null,
    nicheRelevanceSummary: input.nicheRelevanceSummary || null,
    historicalIdentitySummary: input.historicalIdentitySummary || null,
    remainingExternalBlockers,
    negativeMutationsCaught: input.negativeMutationsCaught,
    completedAt: new Date().toISOString(),
  };
}

// ============================================================================
// TASK C: OWNERSHIP-AWARE PROCESS TRACKER & DISK/RAM RESOURCE MONITOR
// ============================================================================

export interface OwnedChildProcessRecord {
  pid: number;
  pgid: number | null;
  label: string;
  command: string;
  isHeavy: boolean;
  startedAtMs: number;
  endedAtMs: number | null;
  startedAt: string;
  endedAt: string | null;
  durationMs: number | null;
  exitCode: number | null;
  signal: string | null;
  timedOut: boolean;
  killedByRunner: boolean;
  stillAliveAfterCleanup: boolean;
  stdoutDigestSha256: string;
  stderrDigestSha256: string;
}

export function isPidAlive(pid: number): boolean {
  if (!pid || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err: any) {
    return err?.code === "EPERM";
  }
}

export function computePeakConcurrentIntervals(
  intervals: ReadonlyArray<{ startedAtMs: number; endedAtMs: number | null }>
): number {
  const events: Array<{ time: number; delta: number }> = [];
  const now = Date.now();
  for (const iv of intervals) {
    if (!iv || typeof iv.startedAtMs !== "number") continue;
    const end = typeof iv.endedAtMs === "number" ? iv.endedAtMs : now;
    events.push({ time: iv.startedAtMs, delta: 1 });
    events.push({ time: end, delta: -1 });
  }
  events.sort((a, b) => (a.time !== b.time ? a.time - b.time : a.delta - b.delta));
  let current = 0;
  let peak = 0;
  for (const ev of events) {
    current += ev.delta;
    if (current > peak) peak = current;
  }
  return peak;
}

export class OwnedProcessTracker {
  private readonly records = new Map<number, OwnedChildProcessRecord>();

  runTrackedCommand(options: {
    label: string;
    command: string;
    cwd?: string;
    envOverrides?: Record<string, string>;
    isHeavy?: boolean;
    timeoutMs?: number;
  }): Promise<{
    ok: boolean;
    pid: number;
    exitCode: number;
    signal: string | null;
    timedOut: boolean;
    startedAt: string;
    endedAt: string;
    durationMs: number;
    stdout: string;
    stderr: string;
    record: OwnedChildProcessRecord;
  }> {
    const cwd = options.cwd || process.cwd();
    const isHeavy = options.isHeavy !== false;
    const timeoutMs = options.timeoutMs ?? 300_000;

    return new Promise((resolve) => {
      const startedAtMs = Date.now();
      const startedAt = new Date(startedAtMs).toISOString();
      const childEnv: NodeJS.ProcessEnv = {
        ...process.env,
        HOST: "127.0.0.1",
      };
      delete childEnv.ADMIN_API_KEY;
      delete childEnv.SWAI_ADMIN_TOKEN;
      delete childEnv.ADMIN_SECRET;
      delete childEnv.SWAI_DEPLOYMENT_MODE;
      delete childEnv.SWAI_REMOTE_ACCESS;
      delete childEnv.SWAI_REQUIRE_AUTH;
      delete childEnv.SWAI_E2E_SERVER;
      if (options.envOverrides) {
        Object.assign(childEnv, options.envOverrides);
      }
      const child = spawn("sh", ["-c", options.command], {
        cwd,
        env: childEnv,
      });

      const pid = child.pid || 0;
      const record: OwnedChildProcessRecord = {
        pid,
        pgid: pid || null,
        label: options.label,
        command: options.command,
        isHeavy,
        startedAtMs,
        endedAtMs: null,
        startedAt,
        endedAt: null,
        durationMs: null,
        exitCode: null,
        signal: null,
        timedOut: false,
        killedByRunner: false,
        stillAliveAfterCleanup: false,
        stdoutDigestSha256: "",
        stderrDigestSha256: "",
      };

      if (pid > 0) {
        this.records.set(pid, record);
      }

      let stdout = "";
      let stderr = "";
      child.stdout.on("data", (chunk) => {
        stdout += chunk.toString();
      });
      child.stderr.on("data", (chunk) => {
        stderr += chunk.toString();
      });

      const timer = setTimeout(() => {
        record.timedOut = true;
        record.killedByRunner = true;
        try {
          child.kill("SIGTERM");
        } catch {}
      }, timeoutMs);

      child.on("close", (code, sig) => {
        clearTimeout(timer);
        const endedAtMs = Date.now();
        record.endedAtMs = endedAtMs;
        record.endedAt = new Date(endedAtMs).toISOString();
        record.durationMs = endedAtMs - startedAtMs;
        record.exitCode = code ?? 1;
        record.signal = sig ? String(sig) : null;
        record.stillAliveAfterCleanup = pid > 0 ? isPidAlive(pid) : false;
        record.stdoutDigestSha256 = crypto
          .createHash("sha256")
          .update(stdout)
          .digest("hex");
        record.stderrDigestSha256 = crypto
          .createHash("sha256")
          .update(stderr)
          .digest("hex");

        resolve({
          ok: record.exitCode === 0 && !record.timedOut,
          pid,
          exitCode: record.exitCode,
          signal: record.signal,
          timedOut: record.timedOut,
          startedAt: record.startedAt,
          endedAt: record.endedAt,
          durationMs: record.durationMs,
          stdout: stdout.trim(),
          stderr: stderr.trim(),
          record,
        });
      });
    });
  }

  registerExternalOwnedProcess(
    pid: number,
    label: string,
    command: string,
    isHeavy = true
  ): void {
    if (!pid || pid <= 0) return;
    const now = Date.now();
    this.records.set(pid, {
      pid,
      pgid: pid,
      label,
      command,
      isHeavy,
      startedAtMs: now,
      endedAtMs: null,
      startedAt: new Date(now).toISOString(),
      endedAt: null,
      durationMs: null,
      exitCode: null,
      signal: null,
      timedOut: false,
      killedByRunner: false,
      stillAliveAfterCleanup: false,
      stdoutDigestSha256: "",
      stderrDigestSha256: "",
    });
  }

  markExternalOwnedProcessClosed(pid: number, exitCode = 0): void {
    const rec = this.records.get(pid);
    if (!rec) return;
    const now = Date.now();
    rec.endedAtMs = now;
    rec.endedAt = new Date(now).toISOString();
    rec.durationMs = now - rec.startedAtMs;
    rec.exitCode = exitCode;
    rec.stillAliveAfterCleanup = isPidAlive(pid);
  }

  reconcileOwnedProcessesAfterBarrier(): {
    totalOwnedSpawned: number;
    exitedCleanlyCount: number;
    orphanedOwnedPids: number[];
    orphanedProcessesAfterRun: number;
    configuredMaxConcurrentHeavy: number;
    observedPeakConcurrentHeavy: number;
    observedPeakConcurrentAll: number;
    records: OwnedChildProcessRecord[];
  } {
    const all = Array.from(this.records.values());
    const orphanedOwnedPids: number[] = [];
    for (const r of all) {
      const alive = isPidAlive(r.pid);
      r.stillAliveAfterCleanup = alive;
      if (alive) {
        orphanedOwnedPids.push(r.pid);
      }
    }

    const heavyIntervals = all.filter((r) => r.isHeavy);
    const observedPeakConcurrentHeavy =
      computePeakConcurrentIntervals(heavyIntervals);
    const observedPeakConcurrentAll = computePeakConcurrentIntervals(all);

    return {
      totalOwnedSpawned: all.length,
      exitedCleanlyCount: all.filter((r) => !r.stillAliveAfterCleanup).length,
      orphanedOwnedPids,
      orphanedProcessesAfterRun: orphanedOwnedPids.length,
      configuredMaxConcurrentHeavy: 2,
      observedPeakConcurrentHeavy,
      observedPeakConcurrentAll,
      records: all,
    };
  }
}

export interface HostResourceSnapshot {
  stageLabel: string;
  capturedAt: string;
  freeDiskBytes: number;
  freeDiskGiB: number;
  diskThresholdGiB: number;
  diskGuardPassed: boolean;
  totalMemBytes: number;
  totalMemGiB: number;
  freeMemBytes: number;
  freeMemGiB: number;
  runnerRssBytes: number;
  runnerRssMiB: number;
  activeOwnedChildPids: number[];
  activeOwnedChildCount: number;
  unrelatedHostBrowserOrNodeMatchCount: number;
}

export function captureOwnershipAwareResourceSnapshot(
  stageLabel: string,
  repoRoot: string,
  tracker: OwnedProcessTracker,
  diskThresholdGiB = 15
): HostResourceSnapshot {
  const stat = fs.statfsSync(repoRoot);
  const freeDiskBytes = Number(stat.bavail) * Number(stat.bsize);
  const freeDiskGiB =
    Math.round((freeDiskBytes / (1024 * 1024 * 1024)) * 100) / 100;
  const totalMemBytes = os.totalmem();
  const freeMemBytes = os.freemem();
  const rssBytes = process.memoryUsage().rss;

  const recon = tracker.reconcileOwnedProcessesAfterBarrier();
  const activeOwnedChildPids = recon.orphanedOwnedPids;

  let psCount = 0;
  try {
    const psOut = execSync(
      "ps aux | grep -E 'vitest|playwright|chromium|next-server|kh02Worker' | grep -v grep || true",
      { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }
    ).trim();
    psCount = psOut ? psOut.split("\n").filter(Boolean).length : 0;
  } catch {
    psCount = 0;
  }

  return {
    stageLabel,
    capturedAt: new Date().toISOString(),
    freeDiskBytes,
    freeDiskGiB,
    diskThresholdGiB,
    diskGuardPassed: freeDiskGiB >= diskThresholdGiB,
    totalMemBytes,
    totalMemGiB: Math.round((totalMemBytes / 1024 ** 3) * 100) / 100,
    freeMemBytes,
    freeMemGiB: Math.round((freeMemBytes / 1024 ** 3) * 100) / 100,
    runnerRssBytes: rssBytes,
    runnerRssMiB: Math.round((rssBytes / 1024 ** 2) * 100) / 100,
    activeOwnedChildPids,
    activeOwnedChildCount: activeOwnedChildPids.length,
    unrelatedHostBrowserOrNodeMatchCount: Math.max(
      0,
      psCount - activeOwnedChildPids.length
    ),
  };
}

// ============================================================================
// TASK D: FULL REPOSITORY TEST INVENTORY & SHARD CLASSIFICATION
// ============================================================================

export const HISTORICAL_REPAIRED_PRE_V12_4_UNIT_FILES: Record<
  string,
  string
> = {
  "tests/unit/kh02FreeProviderContracts.test.ts":
    "Repaired in V12.4.3.5.1 Workstream A: originally tested pre-V12.4.3.4 SERPAPI_LEGACY defaultDemandProvider; updated to assert GOOGLE_FREE_ONLY zero-spend default.",
  "tests/unit/kh02SourceAdapters.test.ts":
    "Repaired in V12.4.3.5.1 Workstream A: originally tested 5 active sources including TIKTOK_ORGANIC (HasData); updated to assert 4 active sources + TIKTOK_ORGANIC permanently disabled.",
  "tests/unit/kh02TestConnectionsFlow.test.ts":
    "Repaired in V12.4.3.5.1 Workstream A: originally tested TIKTOK_ORGANIC with HASDATA_API_KEY as CONFIGURED; updated to assert DISABLED under zero-spend policy.",
  "tests/unit/kh02V12_1_2_RuntimeOwnership.test.ts":
    "Repaired in V12.4.3.5.1 Workstream A: originally checked legacy V12.1.2 DEMAND_HISTORY copy; updated to assert V12.4 Google Trends BigQuery/CSV diagnostics.",
  "tests/unit/kh02V12_2_1_ProviderActivation.test.ts":
    "Repaired in V12.4.3.5.1 Workstream A: originally expected TIKTOK_ORGANIC to report CREDENTIALS_REQUIRED; updated to assert DISABLED.",
  "tests/unit/kh02V12_2_2_TruthfulDiagnostics.test.ts":
    "Repaired in V12.4.3.5.1 Workstream A: originally expected TIKTOK_ORGANIC to report CREDENTIALS_REQUIRED/SKIPPED; updated to assert DISABLED.",
  "tests/unit/metaCollectorNormalization.test.ts":
    "Repaired in V12.4.3.5.1 Workstream A: originally expected media_type='image'/'video' without URL to classify as IMAGE/VIDEO; updated to assert V12.4.3.2.1 strict media URL proof.",
  "tests/unit/metaCollectorV11_2.test.ts":
    "Repaired in V12.4.3.5.1 Workstream A: originally expected has_image=true without URL to return IMAGE; updated to assert UNKNOWN without URL and IMAGE with URL.",
};

export const EIGHT_REPAIRED_LEGACY_UNIT_FILES: Record<string, string> =
  HISTORICAL_REPAIRED_PRE_V12_4_UNIT_FILES;

/**
 * Workstream A (Section 2.4): Fail-exemption removed. Zero unit files are exempted from activeRequiredUnitFiles.
 */
export const LEGACY_PRE_V12_4_POLICY_SUPERSEDED_UNIT_FILES: Record<
  string,
  string
> = {};

export const STANDALONE_SERVER_OR_BROWSER_E2E_FILES: Record<string, string> = {
  "tests/integration/kh01BrowserE2E.test.ts":
    "Launches standalone KH-01 Next.js server + Chromium browser; covered by dedicated KH-01 browser runner.",
  "tests/integration/kh01HttpServerE2E.test.ts":
    "Launches standalone KH-01 HTTP server; covered by dedicated KH-01 HTTP runner.",
  "tests/integration/kh01RealE2E.test.ts":
    "Requires live MetaAdsCollector Python daemon and standalone server.",
  "tests/integration/kh02BrowserAcceptance.test.ts":
    "Launches standalone KH-02 Next.js server + Chromium; covered in Wave D Headless Chromium UI & Reload Parity.",
  "tests/integration/kh02HttpServerE2E.test.ts":
    "Launches standalone KH-02 Next.js server; covered in Wave D HTTP + Chromium parity.",
  "tests/integration/metaResearchAuthorizationHttp.test.ts":
    "Requires pre-seeded live Meta run workspace fixtures in standalone HTTP mode.",
  "tests/e2e/exactRunExplorerAcceptance.test.ts":
    "Standalone Playwright E2E spec requiring external dev server.",
  "tests/e2e/kh01RealBrowserReadback.test.ts":
    "Standalone Playwright E2E spec requiring external dev server.",
  "tests/e2e/metaDiscoveryFinalAcceptance.test.ts":
    "Standalone Playwright E2E spec requiring external dev server.",
  "tests/e2e/metaLiveExplorerPagination.test.ts":
    "Standalone Playwright E2E spec requiring external dev server.",
  "tests/e2e/metaResearchAuthorization.test.ts":
    "Standalone Playwright E2E spec requiring external dev server.",
  "tests/e2e/metaRunExplorer.test.ts":
    "Standalone Playwright E2E spec requiring external dev server.",
};

export function discoverRepositoryTestInventory(repoRoot: string): {
  allDiscoveredFiles: string[];
  activeRequiredUnitFiles: string[];
  legacyPolicySupersededUnitFiles: string[];
  activeRequiredIntegrationFiles: string[];
  standaloneBrowserOrLiveServerFiles: string[];
} {
  const walk = (dir: string): string[] => {
    const abs = path.join(repoRoot, dir);
    if (!fs.existsSync(abs)) return [];
    const results: string[] = [];
    for (const entry of fs.readdirSync(abs, { withFileTypes: true })) {
      const rel = path.posix.join(dir, entry.name);
      if (entry.isDirectory()) {
        results.push(...walk(rel));
      } else if (/\.(test|spec)\.(ts|tsx)$/.test(entry.name)) {
        results.push(rel);
      }
    }
    return results.sort();
  };

  const srcFiles = walk("src");
  const unitFiles = walk("tests/unit");
  const intFiles = walk("tests/integration");
  const e2eFiles = walk("tests/e2e");

  const allDiscoveredFiles = [
    ...srcFiles,
    ...unitFiles,
    ...intFiles,
    ...e2eFiles,
  ];

  const activeRequiredUnitFiles = [...srcFiles, ...unitFiles].filter(
    (f) => !LEGACY_PRE_V12_4_POLICY_SUPERSEDED_UNIT_FILES[f]
  );
  const legacyPolicySupersededUnitFiles = [...srcFiles, ...unitFiles].filter(
    (f) => Boolean(LEGACY_PRE_V12_4_POLICY_SUPERSEDED_UNIT_FILES[f])
  );

  const activeRequiredIntegrationFiles = intFiles.filter(
    (f) => !STANDALONE_SERVER_OR_BROWSER_E2E_FILES[f]
  );
  const standaloneBrowserOrLiveServerFiles = [...intFiles, ...e2eFiles].filter(
    (f) => Boolean(STANDALONE_SERVER_OR_BROWSER_E2E_FILES[f])
  );

  return {
    allDiscoveredFiles,
    activeRequiredUnitFiles,
    legacyPolicySupersededUnitFiles,
    activeRequiredIntegrationFiles,
    standaloneBrowserOrLiveServerFiles,
  };
}
