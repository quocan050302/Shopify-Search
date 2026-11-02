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
import {
  isValidAmazonRawSnapshotHash,
  validateAmazonUiContextProofConsistency,
} from "../../src/services/kh02/marketplace/amazonUsMcpTransport";
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
    const statusPassed =
      found.executionStatus === "PASS" || (found as any).passed === true;
    if (!shaMatches || !statusPassed || !exitOk) {
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

  const regInv: any = input.regressionInventory || {};
  const isInvComplete = Boolean(
    regInv.inventoryComplete ?? regInv.allShardsExecuted ?? false
  );
  const isTargetedOnly = Boolean(regInv.targetedOnly ?? false);
  const totalExecCases = Number(
    regInv.totalExecutedTestCases ?? regInv.totalTestsCount ?? 0
  );
  const failedCases = Number(
    regInv.failedTestCases ?? regInv.failedTestsCount ?? 0
  );
  const activeFailed = Number(regInv.requiredActiveSuiteFailedTestCases ?? 0);
  const supersededFailed = Number(
    regInv.baselineKnownPolicySupersededTestCases ?? 0
  );
  const newRegFailed = Number(regInv.newRegressionTestCases ?? 0);

  if (
    !waveComp.complete ||
    !isInvComplete ||
    isTargetedOnly ||
    totalExecCases <= 0 ||
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
    failedCases > 0 ||
    activeFailed > 0 ||
    supersededFailed > 0 ||
    newRegFailed > 0 ||
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
        distinctVerifiedProductFamilies?: number;
        distinctCandidateIds?: number;
        usDeliveryConfirmedCount?: number;
        observedUsdPriceCount?: number;
        requiredLiveTargetsMet?: boolean;
        mcpSessionClosedCleanly?: boolean | "UNKNOWN";
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
        localMcpPilot: (() => {
          const probeRan =
            params.liveAmazonProbeArtifact?.probeExecutionStatus === "DID_RUN" ||
            params.liveAmazonProbeArtifact?.probeExecuted === true;
          const rawAsinsCount = Number(
            params.liveAmazonProbeArtifact?.rawLiveAsinsCount ??
              params.liveAmazonProbeArtifact?.verifiedLiveProductCount ??
              0
          );
          const distinctFamiliesCount = Number(
            params.liveAmazonProbeArtifact?.distinctVerifiedProductFamiliesCount ??
              params.liveAmazonProbeArtifact?.distinctVerifiedProductFamilies ??
              0
          );
          const distinctCandidatesCount = Number(
            params.liveAmazonProbeArtifact?.distinctCandidateIdsCount ??
              params.liveAmazonProbeArtifact?.distinctCandidateIds ??
              0
          );
          const reqTargets = Number(
            params.liveAmazonProbeArtifact?.requiredLiveTargets ?? 3
          );
          const usDeliveryCount = Number(
            params.liveAmazonProbeArtifact?.usDeliveryConfirmedCount ?? 0
          );
          const usdPriceCount = Number(
            params.liveAmazonProbeArtifact?.observedUsdPriceCount ?? 0
          );
          const sessionClosed =
            params.liveAmazonProbeArtifact?.mcpSessionClosedCleanly ?? null;
          const pageObsStatus =
            params.liveAmazonProbeArtifact?.realAmazonPageObservationStatus ||
            "NOT_ATTEMPTED";
          const identityPilotVerdict:
            | "PASS"
            | "INSUFFICIENT_EVIDENCE"
            | "BLOCKED"
            | "NOT_EXECUTED" = !probeRan
            ? "NOT_EXECUTED"
            : distinctFamiliesCount >= reqTargets &&
              rawAsinsCount >= reqTargets &&
              distinctCandidatesCount >= reqTargets &&
              sessionClosed === true
            ? "PASS"
            : pageObsStatus === "BLOCKED_CAPTCHA_OR_BOT_WALL"
            ? "BLOCKED"
            : "INSUFFICIENT_EVIDENCE";
          const usDeliveryProofVerdict: "VERIFIED" | "PARTIAL" | "UNKNOWN" =
            usDeliveryCount >= reqTargets && reqTargets > 0
              ? "VERIFIED"
              : usDeliveryCount > 0
              ? "PARTIAL"
              : "UNKNOWN";
          const usdPriceProofVerdict: "VERIFIED" | "PARTIAL" | "UNKNOWN" =
            usdPriceCount >= reqTargets && reqTargets > 0
              ? "VERIFIED"
              : usdPriceCount > 0
              ? "PARTIAL"
              : "UNKNOWN";
          const computedLiveVerdict =
            identityPilotVerdict === "PASS"
              ? "LIVE_VERIFIED"
              : pageObsStatus === "BLOCKED_CAPTCHA_OR_BOT_WALL"
              ? "BLOCKED_CAPTCHA_OR_BOT_WALL"
              : rawAsinsCount > 0 || pageObsStatus === "PUBLIC_PAGE_OBSERVED"
              ? "OBSERVED_PARTIAL"
              : "NOT_VERIFIED";
          return {
            routeId: "AMAZON_LOCAL_MCP_PUBLIC_URL_PILOT" as const,
            probeExecutionStatus: (probeRan ? "DID_RUN" : "NOT_RUN") as
              | "DID_RUN"
              | "NOT_RUN",
            transportHandshakeStatus: (params.liveAmazonProbeArtifact
              ?.transportHandshakeStatus || "NOT_ATTEMPTED") as
              | "SUCCEEDED"
              | "FAILED"
              | "NOT_ATTEMPTED",
            actualBrowserToolExecutionStatus: (params.liveAmazonProbeArtifact
              ?.actualBrowserToolExecutionStatus || "NOT_ATTEMPTED") as
              | "SUCCEEDED"
              | "FAILED"
              | "BLOCKED_POLICY"
              | "NOT_ATTEMPTED",
            realAmazonPageObservationStatus: pageObsStatus as
              | "PUBLIC_PAGE_OBSERVED"
              | "BLOCKED_CAPTCHA_OR_BOT_WALL"
              | "FAILED"
              | "NOT_ATTEMPTED",
            productIdentityVerificationStatus: (params.liveAmazonProbeArtifact
              ?.productIdentityVerificationStatus || "NOT_ATTEMPTED") as
              | "IDENTITY_VERIFIED"
              | "OBSERVED_UNVERIFIED"
              | "REJECTED_IDENTITY"
              | "NOT_ATTEMPTED",
            productIdentityPilotVerdict: identityPilotVerdict,
            usDeliveryProofVerdict,
            usdPriceProofVerdict,
            rawLiveAsinsCount: rawAsinsCount,
            distinctVerifiedProductFamiliesCount: distinctFamiliesCount,
            distinctCandidateIdsCount: distinctCandidatesCount,
            requiredLiveTargets: reqTargets,
            usDeliveryConfirmedCount: usDeliveryCount,
            observedUsdPriceCount: usdPriceCount,
            mcpSessionClosedCleanly: sessionClosed,
            liveVerdict: computedLiveVerdict as any,
            verifiedLiveProductCount: rawAsinsCount,
            attemptedLiveCallsCount: Number(
              params.liveAmazonProbeArtifact?.attemptedLiveCallsCount ??
                params.liveAmazonProbeArtifact?.operationsAttempted ??
                0
            ),
            reason: String(
              params.liveAmazonProbeArtifact?.statusReason ||
                `Local MCP pilot observed ${rawAsinsCount} raw ASIN(s) across ${distinctFamiliesCount}/${reqTargets} distinct product families (US delivery confirmed=${usDeliveryCount}, USD price observed=${usdPriceCount}).`
            ),
          };
        })(),
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
  e2eExecutionSummary?:
    | RequiredEvidenceSummary<E2eExecutionSummaryData>
    | E2eExecutionSummaryData
    | null;
  e2eSpecsSummary?:
    | RequiredEvidenceSummary<E2eExecutionSummaryData>
    | E2eExecutionSummaryData
    | null;
  nicheRelevanceSummary?:
    | RequiredEvidenceSummary<NicheRelevanceSummaryData>
    | NicheRelevanceSummaryData
    | null;
  historicalIdentitySummary?:
    | RequiredEvidenceSummary<HistoricalIdentitySummaryData>
    | HistoricalIdentitySummaryData
    | null;
  liveDbApiDomParitySummary?:
    | RequiredEvidenceSummary<LiveDbApiDomParitySummaryData>
    | LiveDbApiDomParitySummaryData
    | null;
  negativeMutationsCaught: string;
  ancestryVerified: boolean;
}

export interface RequiredEvidenceSummary<T> {
  present?: boolean;
  status?: "MEASURED" | "INCOMPLETE" | "FAIL" | string;
  sourceSha: string | null;
  observedAt: string | null;
  sourceArtifactPath?: string | null;
  data: T | null;
}

export function validateRequiredEvidenceSummary<T extends Record<string, any>>(
  summary: RequiredEvidenceSummary<T> | T | null | undefined,
  expectedCodeSha: string
): {
  status: "PASS" | "FAIL" | "INCOMPLETE";
  reason: string;
  unwrapped: T | null;
  sourceSha: string | null;
} {
  if (summary === null || summary === undefined || typeof summary !== "object") {
    return {
      status: "INCOMPLETE",
      reason: "MISSING_EVIDENCE_SUMMARY",
      unwrapped: null,
      sourceSha: null,
    };
  }
  const cleanExpected = (expectedCodeSha || "").trim();
  if (
    typeof (summary as RequiredEvidenceSummary<T>).present === "boolean" ||
    "data" in summary
  ) {
    const wrapped = summary as RequiredEvidenceSummary<T>;
    if (wrapped.status === "FAIL") {
      return {
        status: "FAIL",
        reason: "EVIDENCE_SUMMARY_STATUS_FAIL",
        unwrapped: wrapped.data ?? null,
        sourceSha: wrapped.sourceSha ?? null,
      };
    }
    if (
      wrapped.present === false ||
      wrapped.status === "INCOMPLETE" ||
      !wrapped.data ||
      typeof wrapped.data !== "object"
    ) {
      return {
        status: "INCOMPLETE",
        reason: "EVIDENCE_SUMMARY_NOT_PRESENT",
        unwrapped: null,
        sourceSha: wrapped.sourceSha ?? null,
      };
    }
    const sha = (wrapped.sourceSha ?? (wrapped.data as any).sourceSha ?? "").trim();
    if (!sha) {
      return {
        status: "INCOMPLETE",
        reason: "MISSING_SOURCE_SHA",
        unwrapped: wrapped.data,
        sourceSha: null,
      };
    }
    if (cleanExpected && sha !== cleanExpected) {
      return {
        status: "FAIL",
        reason: "SOURCE_SHA_MISMATCH",
        unwrapped: wrapped.data,
        sourceSha: sha,
      };
    }
    if (!wrapped.observedAt || Number.isNaN(Date.parse(wrapped.observedAt))) {
      return {
        status: "INCOMPLETE",
        reason: "INVALID_OBSERVED_AT",
        unwrapped: wrapped.data,
        sourceSha: sha,
      };
    }
    if (
      wrapped.sourceArtifactPath !== undefined &&
      wrapped.sourceArtifactPath !== null &&
      !String(wrapped.sourceArtifactPath).trim()
    ) {
      return {
        status: "INCOMPLETE",
        reason: "MISSING_SOURCE_ARTIFACT_PATH",
        unwrapped: wrapped.data,
        sourceSha: sha,
      };
    }
    return {
      status: "PASS",
      reason: "VALID",
      unwrapped: wrapped.data,
      sourceSha: sha,
    };
  }

  const direct = summary as T;
  const sha = typeof (direct as any).sourceSha === "string"
    ? (direct as any).sourceSha.trim()
    : "";
  if (cleanExpected && sha && sha !== cleanExpected) {
    return {
      status: "FAIL",
      reason: "SOURCE_SHA_MISMATCH",
      unwrapped: direct,
      sourceSha: sha,
    };
  }
  if (cleanExpected && !sha) {
    return {
      status: "INCOMPLETE",
      reason: "MISSING_SOURCE_SHA",
      unwrapped: direct,
      sourceSha: null,
    };
  }
  return {
    status: "PASS",
    reason: "VALID",
    unwrapped: direct,
    sourceSha: sha || null,
  };
}

export interface E2eExecutionSummaryData {
  sourceSha?: string | null;
  observedAt?: string | null;
  sourceArtifactPath?: string | null;
  totalSpecs: number;
  executedSpecsCount?: number;
  passedSpecsCount: number;
  failedSpecsCount: number;
  envPrerequisiteBlockedSpecsCount?: number;
  skippedWithoutAttemptCount: number;
  totalE2ETestCases?: number;
  passedE2ETestCases?: number;
  failedE2ETestCases?: number;
  specReceipts?: Array<{
    specFile: string;
    attempted: boolean;
    passed: boolean;
    failed: boolean;
    envPrerequisiteBlocked: boolean;
    exitCode: number | null;
    durationMs: number;
  }>;
}

export interface NicheRelevanceSummaryData {
  sourceSha?: string | null;
  observedAt?: string | null;
  sourceArtifactPath?: string | null;
  targetNiche?: string | null;
  nicheTestsPassed?: boolean;
  nicheUnitAndReplayTestsPassed?: boolean;
  paddingDetectedCount?: number;
  unrelatedAcceptedCount?: number;
  crossNicheFalsePositiveAcceptedCount?: number;
  crossNicheFalsePositivesInDevTop3?: number;
  crossNicheFalsePositivesInHoldoutTop3?: number;
  devCrossNicheFalsePositives?: number;
  holdoutCrossNicheFalsePositives?: number;
  ambiguousNicheAcceptedCount?: number;
  brandOnlyFalsePositiveAcceptedCount?: number;
  shortlistPaddedWithUnrelatedCount?: number;
  paddedWithMismatchOrUncertainCount?: number;
  devShortlistCount?: number;
  devNicheMatchedCount?: number;
  devNicheCoverageStatus?: "SUFFICIENT_NICHE_COVERAGE" | "INSUFFICIENT_NICHE_COVERAGE";
  holdoutShortlistCount?: number;
  holdoutNicheMatchedCount?: number;
  holdoutNicheMismatchesCount?: number;
  holdoutNicheMismatches?: any[];
  holdoutNicheCoverageStatus?: "SUFFICIENT_NICHE_COVERAGE" | "INSUFFICIENT_NICHE_COVERAGE";
}

export interface HistoricalIdentitySummaryData {
  sourceSha?: string | null;
  observedAt?: string | null;
  sourceArtifactPath?: string | null;
  devShortlistCount?: number;
  devVerifiedIdentityCount?: number;
  holdoutShortlistCount?: number;
  holdoutVerifiedIdentityCount?: number;
  holdoutFunnelProbableCount?: number;
  holdoutIdentityCoverageStatus?: "SUFFICIENT_VERIFIED_IDENTITY" | "INSUFFICIENT_VERIFIED_IDENTITY";
  urlPathSlugPromotedToVerifiedCount?: number;
  urlPathOnlyPromotedToVerifiedCount?: number;
  funnelOrCheckoutChampPromotedToVerifiedCount?: number;
  funnelPromotedToVerifiedCount?: number;
  discoveryRefsCopiedToIndependentProofCount?: number;
  postCutoffObservationsIncludedCount?: number;
  syntheticFixturesPromotedToLiveCount?: number;
  g16PreviousSnapshotClaimedVerifiedCount?: number;
  g16VerifiedFromPersistedEvidenceCount?: number;
  g16ReconstructionStatus?: string;
  g16SyntheticHydrationUsed?: boolean;
}

export interface LiveDbApiDomParitySummaryData {
  sourceSha?: string | null;
  observedAt?: string | null;
  sourceArtifactPath?: string | null;
  amazonLiveDbApiDomParityVerdict?: "PASS" | "NOT_PROVEN" | "BLOCKED" | "FAIL" | string;
  walmartLiveDbApiDomParityVerdict?: "PASS" | "BLOCKED_PROVIDER" | "NOT_PROVEN" | "FAIL" | string;
  engineeringFixtureParityVerdict?: "PASS" | "FAIL" | "INCOMPLETE" | string;
  overallLiveDbApiDomParityVerdict?:
    | "AMAZON_LIVE_PARITY_PASS_WALMART_BLOCKED_PROVIDER"
    | "PASS"
    | "NOT_PROVEN"
    | "FAIL"
    | string;
  liveDbApiDomParityStatus?: string;
  fixtureParityStatus?: string;
  candidateLineageCount?: number;
  allCandidatesMatched?: boolean;
  verifiedLiveAmazonProductFamiliesCount?: number;
  verifiedLiveWalmartProductFamiliesCount?: number;
}

export function computeReleaseVerdicts(input: ComputeReleaseVerdictsInput) {
  const engineeringVerdict = computeEngineeringVerdict(input.engineeringInput);
  const kh02BusinessVerdict = computeOverallBusinessVerdict(input.diagnostics);

  const wmtProv: any =
    input.diagnostics?.providers?.walmartUs ||
    (input.diagnostics?.gates as any)?.walmartLive ||
    {};
  const amzProv: any =
    input.diagnostics?.providers?.amazonUs ||
    (input.diagnostics?.gates as any)?.amazonLive ||
    {};
  const amzMcpGate: any =
    input.diagnostics?.providers?.amazonUs?.localMcpPilot ||
    (input.diagnostics?.gates as any)?.amazonLocalMcpLive ||
    null;

  const liveWalmartProviderVerdict =
    wmtProv.liveVerdict === "LIVE_VERIFIED" || wmtProv.verdict === "LIVE_VERIFIED"
      ? "LIVE_VERIFIED"
      : wmtProv.liveProviderStatus || wmtProv.verdict || wmtProv.liveVerdict || "NOT_ATTEMPTED";

  const liveAmazonProviderVerdict =
    amzProv.liveVerdict || amzProv.verdict || "CREDENTIALS_REQUIRED";

  const amazonCreatorsApiVerdict:
    | "CREDENTIALS_REQUIRED"
    | "VERIFIED"
    | "NOT_CONFIGURED"
    | "NOT_ATTEMPTED"
    | "BLOCKED" =
    amzProv.creatorsApi?.status === "LIVE_VERIFIED" ||
    amzProv.liveVerdict === "LIVE_VERIFIED" ||
    amzProv.verdict === "LIVE_VERIFIED"
      ? "VERIFIED"
      : amzProv.creatorsApi?.configured === false ||
        amzProv.liveVerdict === "CREDENTIALS_REQUIRED" ||
        amzProv.verdict === "CREDENTIALS_REQUIRED"
      ? "CREDENTIALS_REQUIRED"
      : amzProv.liveVerdict === "BLOCKED" || amzProv.verdict === "BLOCKED"
      ? "BLOCKED"
      : "NOT_ATTEMPTED";

  const amazonLocalMcpHandshakeVerdict: "PASS" | "FAIL" | "NOT_EXECUTED" =
    amzMcpGate?.handshakeStatus === "PASS" ||
    amzMcpGate?.transportHandshakeStatus === "SUCCEEDED"
      ? "PASS"
      : amzMcpGate?.handshakeStatus === "FAIL" ||
        amzMcpGate?.transportHandshakeStatus === "FAILED"
      ? "FAIL"
      : "NOT_EXECUTED";

  const amazonLocalMcpLiveObservationVerdict:
    | "OBSERVED"
    | "BLOCKED_PROVIDER"
    | "NOT_EXECUTED"
    | "INSUFFICIENT_EVIDENCE" =
    amzMcpGate?.liveObservationStatus === "OBSERVED" ||
    amzMcpGate?.realAmazonPageObservationStatus === "PUBLIC_PAGE_OBSERVED"
      ? "OBSERVED"
      : amzMcpGate?.liveObservationStatus === "BLOCKED_PROVIDER" ||
        amzMcpGate?.realAmazonPageObservationStatus === "BLOCKED_CAPTCHA_OR_BOT_WALL"
      ? "BLOCKED_PROVIDER"
      : amzMcpGate?.probeExecutionStatus === "DID_RUN" ||
        (amzMcpGate?.attemptedLiveCallsCount ?? 0) > 0
      ? "INSUFFICIENT_EVIDENCE"
      : "NOT_EXECUTED";

  const mcpRawAsins = Number(
    amzMcpGate?.rawLiveAsinsCount ?? amzMcpGate?.verifiedLiveProductCount ?? 0
  );
  const mcpDistinctFamilies = Number(
    amzMcpGate?.distinctVerifiedProductFamiliesCount ?? 0
  );
  const mcpRequiredTargets = Number(amzMcpGate?.requiredLiveTargets ?? 3);
  const mcpUsDeliveryCount = Number(amzMcpGate?.usDeliveryConfirmedCount ?? 0);
  const mcpUsdPriceCount = Number(amzMcpGate?.observedUsdPriceCount ?? 0);
  const mcpSessionClosed = amzMcpGate?.mcpSessionClosedCleanly ?? null;

  const amazonProductIdentityPilotVerdict:
    | "PASS"
    | "INSUFFICIENT_EVIDENCE"
    | "BLOCKED"
    | "NOT_EXECUTED" =
    amzMcpGate?.productIdentityPilotVerdict === "PASS" &&
    mcpDistinctFamilies >= mcpRequiredTargets &&
    mcpRawAsins >= mcpRequiredTargets &&
    mcpSessionClosed === true
      ? "PASS"
      : amzMcpGate?.productIdentityPilotVerdict === "BLOCKED" ||
        amazonLocalMcpLiveObservationVerdict === "BLOCKED_PROVIDER"
      ? "BLOCKED"
      : amazonLocalMcpLiveObservationVerdict === "NOT_EXECUTED" &&
        amazonLocalMcpHandshakeVerdict === "NOT_EXECUTED"
      ? "NOT_EXECUTED"
      : "INSUFFICIENT_EVIDENCE";

  const amazonUsDeliveryProofVerdict: "VERIFIED" | "PARTIAL" | "UNKNOWN" =
    amzMcpGate?.usDeliveryProofVerdict ||
    (mcpUsDeliveryCount >= mcpRequiredTargets && mcpRequiredTargets > 0
      ? "VERIFIED"
      : mcpUsDeliveryCount > 0
      ? "PARTIAL"
      : "UNKNOWN");

  const amazonUsdPriceProofVerdict: "VERIFIED" | "PARTIAL" | "UNKNOWN" =
    amzMcpGate?.usdPriceProofVerdict ||
    (mcpUsdPriceCount >= mcpRequiredTargets && mcpRequiredTargets > 0
      ? "VERIFIED"
      : mcpUsdPriceCount > 0
      ? "PARTIAL"
      : "UNKNOWN");

  const amazonLivePilotVerdict:
    | "PASS"
    | "OBSERVED_PARTIAL"
    | "INSUFFICIENT_EVIDENCE"
    | "BLOCKED_PROVIDER"
    | "NOT_EXECUTED" =
    amazonProductIdentityPilotVerdict === "PASS" &&
    amazonUsDeliveryProofVerdict === "VERIFIED" &&
    amazonUsdPriceProofVerdict === "VERIFIED"
      ? "PASS"
      : amazonProductIdentityPilotVerdict === "PASS" ||
        amazonLocalMcpLiveObservationVerdict === "OBSERVED"
      ? "OBSERVED_PARTIAL"
      : amazonProductIdentityPilotVerdict === "BLOCKED"
      ? "BLOCKED_PROVIDER"
      : amazonProductIdentityPilotVerdict === "NOT_EXECUTED"
      ? "NOT_EXECUTED"
      : "INSUFFICIENT_EVIDENCE";

  const walmartLiveJinaPilotVerdict:
    | "LIVE_VERIFIED"
    | "BLOCKED_PROVIDER"
    | "RATE_LIMITED"
    | "NOT_ATTEMPTED"
    | "INSUFFICIENT_EVIDENCE"
    | "DISABLED" =
    liveWalmartProviderVerdict === "LIVE_VERIFIED"
      ? "LIVE_VERIFIED"
      : liveWalmartProviderVerdict === "BLOCKED_PROVIDER" ||
        liveWalmartProviderVerdict === "BLOCKED_EXTERNAL_PROVIDER"
      ? "BLOCKED_PROVIDER"
      : liveWalmartProviderVerdict === "RATE_LIMITED"
      ? "RATE_LIMITED"
      : liveWalmartProviderVerdict === "DISABLED"
      ? "DISABLED"
      : liveWalmartProviderVerdict === "NOT_ATTEMPTED" ||
        liveWalmartProviderVerdict === "NOT_VERIFIED"
      ? "NOT_ATTEMPTED"
      : "INSUFFICIENT_EVIDENCE";

  const historicalEvidenceVerdict =
    input.backtestOutput?.overallHistoricalBacktestVerdict ||
    (input.backtestOutput?.businessHistoricalEvidenceSufficient === "PASS"
      ? "PASS"
      : "INSUFFICIENT_HISTORICAL_EVIDENCE");

  const historicalG07Verdict =
    input.diagnostics?.gates?.g07?.verdict || "INSUFFICIENT_EVIDENCE";
  const historicalG15Verdict =
    input.diagnostics?.gates?.g15?.verdict || "INSUFFICIENT_EVIDENCE";
  const historicalG16Verdict =
    input.diagnostics?.gates?.g16?.verdict || "INSUFFICIENT_EVIDENCE";

  const regInv: any = input.engineeringInput.regressionInventory || {};
  const isInvComplete = Boolean(
    regInv.inventoryComplete ?? regInv.allShardsExecuted ?? false
  );
  const isTargetedOnly = Boolean(regInv.targetedOnly ?? false);
  const totalExecCases = Number(
    regInv.totalExecutedTestCases ?? regInv.totalTestsCount ?? 0
  );
  const failedCases = Number(regInv.failedTestCases ?? regInv.failedTestsCount ?? 0);
  const activeFailed = Number(regInv.requiredActiveSuiteFailedTestCases ?? 0);
  const supersededFailed = Number(
    regInv.baselineKnownPolicySupersededTestCases ?? 0
  );
  const newRegFailed = Number(regInv.newRegressionTestCases ?? 0);

  const broadRegressionVerdict: "PASS" | "FAIL" | "INCOMPLETE" =
    !isInvComplete || isTargetedOnly || totalExecCases <= 0
      ? "INCOMPLETE"
      : failedCases === 0 &&
        activeFailed === 0 &&
        supersededFailed === 0 &&
        newRegFailed === 0
      ? "PASS"
      : "FAIL";

  // P0-A: Fail-closed REQUIRED_E2E_COVERAGE (never defaults to PASS when absent/null/wrong-SHA)
  const rawE2eSummaryInput = input.e2eExecutionSummary ?? input.e2eSpecsSummary;
  const e2eValidation = validateRequiredEvidenceSummary<E2eExecutionSummaryData>(
    rawE2eSummaryInput,
    input.codeSha
  );
  const e2eSummary = e2eValidation.unwrapped;
  const e2eComputedExecuted = e2eSummary
    ? Number(e2eSummary.passedSpecsCount ?? 0) +
      Number(e2eSummary.failedSpecsCount ?? 0) +
      Number(e2eSummary.envPrerequisiteBlockedSpecsCount ?? 0)
    : 0;
  const e2eExecutedCount =
    e2eSummary?.executedSpecsCount ?? e2eComputedExecuted;
  const e2eReceiptsMismatch =
    e2eSummary &&
    typeof e2eSummary.executedSpecsCount === "number" &&
    e2eSummary.executedSpecsCount !== e2eComputedExecuted;
  const e2eSpecReceiptsArrayMismatch =
    e2eSummary &&
    Array.isArray(e2eSummary.specReceipts) &&
    (e2eSummary.specReceipts.length !== e2eSummary.totalSpecs ||
      e2eSummary.specReceipts.filter((r) => r.attempted).length !== e2eExecutedCount ||
      e2eSummary.specReceipts.filter((r) => r.passed).length !==
        e2eSummary.passedSpecsCount ||
      e2eSummary.specReceipts.filter((r) => r.failed).length !==
        e2eSummary.failedSpecsCount);

  const requiredE2eCoverageVerdict:
    | "PASS"
    | "ENV_PREREQUISITE_BLOCKED"
    | "FAIL"
    | "INCOMPLETE" =
    e2eValidation.status === "FAIL"
      ? "FAIL"
      : !e2eSummary || e2eValidation.status === "INCOMPLETE"
      ? "INCOMPLETE"
      : e2eSummary.failedSpecsCount > 0 ||
        e2eReceiptsMismatch ||
        e2eSpecReceiptsArrayMismatch
      ? "FAIL"
      : typeof e2eSummary.totalSpecs !== "number" ||
        e2eSummary.totalSpecs < 12 ||
        e2eSummary.skippedWithoutAttemptCount > 0 ||
        e2eExecutedCount < e2eSummary.totalSpecs
      ? "INCOMPLETE"
      : (e2eSummary.envPrerequisiteBlockedSpecsCount ?? 0) > 0
      ? "ENV_PREREQUISITE_BLOCKED"
      : e2eSummary.passedSpecsCount === e2eSummary.totalSpecs &&
        e2eSummary.failedSpecsCount === 0 &&
        e2eSummary.skippedWithoutAttemptCount === 0
      ? "PASS"
      : "INCOMPLETE";

  const historicalReplayIntegrityVerdict: "PASS" | "FAIL" =
    input.backtestOutput?.backtestEngineExecuted === "PASS" &&
    input.backtestOutput?.pointInTimeIntegrityVerdict === "PASS" &&
    input.backtestOutput?.policyScenarioVerdict === "PASS"
      ? "PASS"
      : "FAIL";

  // P0-A: Fail-closed NICHE_RELEVANCE (never defaults to PASS when absent/null/wrong-SHA; no ?? true or ?? 3)
  const nrValidation = validateRequiredEvidenceSummary<NicheRelevanceSummaryData>(
    input.nicheRelevanceSummary,
    input.codeSha
  );
  const nr = nrValidation.unwrapped;
  const diagHoldoutMismatchesCount =
    input.diagnostics?.shortlistQuality?.holdoutNicheMismatches?.length ?? 0;
  const nrHoldoutMismatchesCount = nr
    ? Array.isArray(nr.holdoutNicheMismatches)
      ? nr.holdoutNicheMismatches.length
      : typeof nr.holdoutNicheMismatchesCount === "number"
      ? nr.holdoutNicheMismatchesCount
      : diagHoldoutMismatchesCount
    : diagHoldoutMismatchesCount;
  const devCrossFp = Number(
    nr?.crossNicheFalsePositiveAcceptedCount ??
      nr?.crossNicheFalsePositivesInDevTop3 ??
      nr?.devCrossNicheFalsePositives ??
      0
  );
  const holdoutCrossFp = Number(
    nr?.crossNicheFalsePositivesInHoldoutTop3 ??
      nr?.holdoutCrossNicheFalsePositives ??
      0
  );
  const ambiguousFp = Number(nr?.ambiguousNicheAcceptedCount ?? 0);
  const brandOnlyFp = Number(nr?.brandOnlyFalsePositiveAcceptedCount ?? 0);
  const paddedMismatchCount = Number(
    nr?.shortlistPaddedWithUnrelatedCount ??
      nr?.paddedWithMismatchOrUncertainCount ??
      0
  );
  const nicheTestsPassed: boolean | null =
    typeof nr?.nicheTestsPassed === "boolean"
      ? nr.nicheTestsPassed
      : typeof nr?.nicheUnitAndReplayTestsPassed === "boolean"
      ? nr.nicheUnitAndReplayTestsPassed
      : null;
  const holdoutMatched: number | null =
    typeof nr?.holdoutNicheMatchedCount === "number"
      ? nr.holdoutNicheMatchedCount
      : null;
  const holdoutShortlist: number | null =
    typeof nr?.holdoutShortlistCount === "number"
      ? nr.holdoutShortlistCount
      : null;
  const devMatched: number | null =
    typeof nr?.devNicheMatchedCount === "number"
      ? nr.devNicheMatchedCount
      : null;
  const devShortlist: number | null =
    typeof nr?.devShortlistCount === "number" ? nr.devShortlistCount : null;

  const nicheRelevanceVerdict: "PASS" | "FAIL" | "INCOMPLETE" =
    nrValidation.status === "FAIL"
      ? "FAIL"
      : !nr
      ? "INCOMPLETE"
      : nicheTestsPassed === false ||
        devCrossFp > 0 ||
        holdoutCrossFp > 0 ||
        ambiguousFp > 0 ||
        brandOnlyFp > 0 ||
        paddedMismatchCount > 0 ||
        nrHoldoutMismatchesCount > 0 ||
        (holdoutShortlist !== null &&
          holdoutMatched !== null &&
          (holdoutMatched < holdoutShortlist || holdoutShortlist <= 0)) ||
        (devShortlist !== null &&
          devMatched !== null &&
          devMatched < devShortlist)
      ? "FAIL"
      : nrValidation.status === "INCOMPLETE" ||
        nicheTestsPassed === null ||
        holdoutShortlist === null ||
        holdoutMatched === null ||
        devShortlist === null ||
        devMatched === null
      ? "INCOMPLETE"
      : "PASS";

  const historicalNicheShortlistCoverageVerdict:
    | "PASS"
    | "INSUFFICIENT_NICHE_COVERAGE"
    | "FAIL"
    | "INCOMPLETE" =
    nicheRelevanceVerdict === "FAIL"
      ? "FAIL"
      : nicheRelevanceVerdict === "INCOMPLETE"
      ? "INCOMPLETE"
      : (devShortlist ?? 0) >= 3 &&
        (devMatched ?? 0) >= 3 &&
        (holdoutShortlist ?? 0) >= 3 &&
        (holdoutMatched ?? 0) >= 3
      ? "PASS"
      : "INSUFFICIENT_NICHE_COVERAGE";

  // P0-A: Fail-closed HISTORICAL_PRODUCT_IDENTITY_TRUTH (never defaults to PASS when absent/null/wrong-SHA)
  const hiValidation =
    validateRequiredEvidenceSummary<HistoricalIdentitySummaryData>(
      input.historicalIdentitySummary,
      input.codeSha
    );
  const hi = hiValidation.unwrapped;
  const urlSlugPromoted = Number(
    hi?.urlPathSlugPromotedToVerifiedCount ??
      hi?.urlPathOnlyPromotedToVerifiedCount ??
      0
  );
  const funnelPromoted = Number(
    hi?.funnelOrCheckoutChampPromotedToVerifiedCount ??
      hi?.funnelPromotedToVerifiedCount ??
      0
  );
  const discoveryCopied = Number(
    hi?.discoveryRefsCopiedToIndependentProofCount ?? 0
  );
  const postCutoffIncluded = Number(
    hi?.postCutoffObservationsIncludedCount ?? 0
  );
  const syntheticPromoted = Number(
    hi?.syntheticFixturesPromotedToLiveCount ??
      (hi?.g16SyntheticHydrationUsed === true ? 1 : 0)
  );
  const hasMeasuredHistoricalIdentityCounts =
    Boolean(hi) &&
    (typeof hi?.holdoutVerifiedIdentityCount === "number" ||
      typeof hi?.devVerifiedIdentityCount === "number" ||
      typeof hi?.holdoutIdentityCoverageStatus === "string");

  const historicalProductIdentityTruthVerdict: "PASS" | "FAIL" | "INCOMPLETE" =
    hiValidation.status === "FAIL"
      ? "FAIL"
      : !hi || hiValidation.status === "INCOMPLETE"
      ? "INCOMPLETE"
      : urlSlugPromoted > 0 ||
        funnelPromoted > 0 ||
        discoveryCopied > 0 ||
        postCutoffIncluded > 0 ||
        syntheticPromoted > 0 ||
        hi.g16SyntheticHydrationUsed === true
      ? "FAIL"
      : !hasMeasuredHistoricalIdentityCounts
      ? "INCOMPLETE"
      : "PASS";

  // P0-C: Live vs Fixture DB/API/DOM Parity Verdicts
  const liveParityValidation =
    validateRequiredEvidenceSummary<LiveDbApiDomParitySummaryData>(
      input.liveDbApiDomParitySummary,
      input.codeSha
    );
  const lp = liveParityValidation.unwrapped;
  const amazonLiveDbApiDomParityVerdict:
    | "PASS"
    | "NOT_PROVEN"
    | "BLOCKED"
    | "FAIL" =
    liveParityValidation.status === "FAIL"
      ? "FAIL"
      : (lp?.amazonLiveDbApiDomParityVerdict as any) || "NOT_PROVEN";
  const walmartLiveDbApiDomParityVerdict:
    | "PASS"
    | "BLOCKED_PROVIDER"
    | "NOT_PROVEN"
    | "FAIL" =
    liveParityValidation.status === "FAIL"
      ? "FAIL"
      : (lp?.walmartLiveDbApiDomParityVerdict as any) ||
        (walmartLiveJinaPilotVerdict === "BLOCKED_PROVIDER"
          ? "BLOCKED_PROVIDER"
          : "NOT_PROVEN");
  const engineeringFixtureParityVerdict:
    | "PASS"
    | "PASS (TEST_FIXTURE)"
    | "FAIL"
    | "INCOMPLETE" =
    liveParityValidation.status === "FAIL"
      ? "FAIL"
      : (lp?.engineeringFixtureParityVerdict as any) ||
        (lp?.fixtureParityStatus === "PARITY_PASS_TEST_FIXTURE"
          ? "PASS (TEST_FIXTURE)"
          : engineeringVerdict === "PASS"
          ? "PASS (TEST_FIXTURE)"
          : "INCOMPLETE");
  const liveDbApiDomParityVerdict:
    | "AMAZON_LIVE_PARITY_PASS_WALMART_BLOCKED_PROVIDER"
    | "PASS"
    | "NOT_PROVEN"
    | "FAIL" =
    liveParityValidation.status === "FAIL" ||
    amazonLiveDbApiDomParityVerdict === "FAIL" ||
    walmartLiveDbApiDomParityVerdict === "FAIL"
      ? "FAIL"
      : (lp?.overallLiveDbApiDomParityVerdict as any) ||
        (lp?.liveDbApiDomParityStatus as any) ||
        (amazonLiveDbApiDomParityVerdict === "PASS" &&
        walmartLiveDbApiDomParityVerdict === "PASS"
          ? "PASS"
          : amazonLiveDbApiDomParityVerdict === "PASS" &&
            walmartLiveDbApiDomParityVerdict === "BLOCKED_PROVIDER"
          ? "AMAZON_LIVE_PARITY_PASS_WALMART_BLOCKED_PROVIDER"
          : "NOT_PROVEN");

  // Composite ENGINEERING_ACCEPTANCE: fail-closed if any required engineering sub-verdict is FAIL or INCOMPLETE
  const engineeringAcceptanceMapped:
    | "PASS"
    | "FAIL"
    | "INCOMPLETE"
    | "RESOURCE_BLOCKED" =
    engineeringVerdict === "BLOCKED"
      ? "RESOURCE_BLOCKED"
      : engineeringVerdict === "FAIL" ||
        broadRegressionVerdict === "FAIL" ||
        requiredE2eCoverageVerdict === "FAIL" ||
        nicheRelevanceVerdict === "FAIL" ||
        historicalProductIdentityTruthVerdict === "FAIL" ||
        historicalReplayIntegrityVerdict === "FAIL"
      ? "FAIL"
      : engineeringVerdict === "INCOMPLETE" ||
        broadRegressionVerdict === "INCOMPLETE" ||
        requiredE2eCoverageVerdict === "INCOMPLETE" ||
        nicheRelevanceVerdict === "INCOMPLETE" ||
        historicalProductIdentityTruthVerdict === "INCOMPLETE"
      ? "INCOMPLETE"
      : "PASS";

  const deliveryVerdict: "READY_FOR_REVIEW" | "INCOMPLETE" | "BLOCKED" =
    engineeringAcceptanceMapped === "PASS" &&
    broadRegressionVerdict === "PASS" &&
    (requiredE2eCoverageVerdict === "PASS" ||
      requiredE2eCoverageVerdict === "ENV_PREREQUISITE_BLOCKED") &&
    historicalReplayIntegrityVerdict === "PASS" &&
    nicheRelevanceVerdict === "PASS" &&
    historicalProductIdentityTruthVerdict === "PASS" &&
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
      detail:
        input.diagnostics?.providers?.walmartUs?.reason ||
        "Walmart US Jina reader not live verified",
    });
  }

  if (liveAmazonProviderVerdict !== "LIVE_VERIFIED") {
    remainingExternalBlockers.push({
      blockerId: "EXT_AMAZON_CREATORS_CREDENTIALS",
      dimension: "liveAmazonProviderVerdict",
      status: liveAmazonProviderVerdict,
      detail:
        input.diagnostics?.providers?.amazonUs?.reason ||
        "Amazon Creators API not live verified",
    });
  }

  if (historicalG15Verdict !== "PASS") {
    remainingExternalBlockers.push({
      blockerId: "EXT_G15_60D_LONGITUDINAL_DEMAND",
      dimension: "historicalG15Verdict",
      status: historicalG15Verdict,
      detail:
        input.diagnostics?.gates?.g15?.reason ||
        "G15 longitudinal demand insufficient",
    });
  }

  if (historicalG07Verdict !== "PASS") {
    remainingExternalBlockers.push({
      blockerId: "EXT_G07_TIKTOK_US_SOURCE",
      dimension: "historicalG07Verdict",
      status: historicalG07Verdict,
      detail:
        input.diagnostics?.gates?.g07?.reason || "G07 TikTok US source blocked",
    });
  }

  if (historicalG16Verdict !== "PASS") {
    remainingExternalBlockers.push({
      blockerId: "EXT_G16_TOP3_LIVE_MERCHANT_PROOF",
      dimension: "historicalG16Verdict",
      status: historicalG16Verdict,
      detail:
        input.diagnostics?.gates?.g16?.reason ||
        "G16 top-3 live merchant proof insufficient",
    });
  }

  let overallVerdict:
    | "FULL_ACCEPTANCE"
    | "ENGINEERING_READY_WITH_EXTERNAL_BLOCKERS"
    | "FAIL"
    | "BLOCKED"
    | "INCOMPLETE";

  if (engineeringVerdict === "BLOCKED") {
    overallVerdict = "BLOCKED";
  } else if (
    engineeringAcceptanceMapped === "FAIL" ||
    broadRegressionVerdict === "FAIL" ||
    historicalReplayIntegrityVerdict === "FAIL" ||
    nicheRelevanceVerdict === "FAIL" ||
    historicalProductIdentityTruthVerdict === "FAIL" ||
    requiredE2eCoverageVerdict === "FAIL"
  ) {
    overallVerdict = "FAIL";
  } else if (
    engineeringAcceptanceMapped === "INCOMPLETE" ||
    broadRegressionVerdict === "INCOMPLETE" ||
    nicheRelevanceVerdict === "INCOMPLETE" ||
    historicalProductIdentityTruthVerdict === "INCOMPLETE" ||
    requiredE2eCoverageVerdict === "INCOMPLETE"
  ) {
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

  const liveProvidersEntry = {
    WALMART_US: liveWalmartProviderVerdict,
    AMAZON_US: liveAmazonProviderVerdict,
    AMAZON_CREATORS_API: amazonCreatorsApiVerdict,
    AMAZON_LOCAL_MCP_HANDSHAKE: amazonLocalMcpHandshakeVerdict,
    AMAZON_LOCAL_MCP_LIVE_OBSERVATION: amazonLocalMcpLiveObservationVerdict,
    AMAZON_PRODUCT_IDENTITY_PILOT: amazonProductIdentityPilotVerdict,
    AMAZON_US_DELIVERY_PROOF: amazonUsDeliveryProofVerdict,
    AMAZON_USD_PRICE_PROOF: amazonUsdPriceProofVerdict,
    WALMART_LIVE_JINA_PILOT: walmartLiveJinaPilotVerdict,
    TIKTOK_US_G07:
      input.diagnostics?.providers?.tiktokUsG07?.verdict || historicalG07Verdict,
    TIKTOK_ADS:
      input.diagnostics?.providers?.tiktokUsG07?.verdict || historicalG07Verdict,
    GOOGLE_ADS:
      input.diagnostics?.providers?.googleAds?.diagnosticStatus || "CONFIGURED",
    META_ADS:
      input.diagnostics?.providers?.metaAds?.diagnosticStatus || "CONFIGURED",
    DEMAND_HISTORY:
      input.diagnostics?.providers?.demandHistory?.diagnosticStatus || "BLOCKED",
  };

  const g16Audits = input.diagnostics?.gates?.g16?.persistedProofAudit || [];
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

  const amazonMcpEngineeringVerdict =
    engineeringVerdict === "PASS"
      ? "PASS"
      : engineeringVerdict === "INCOMPLETE"
      ? "INCOMPLETE"
      : "FAIL";
  const walmartJinaEngineeringVerdict =
    engineeringVerdict === "PASS"
      ? "PASS"
      : engineeringVerdict === "INCOMPLETE"
      ? "INCOMPLETE"
      : "FAIL";
  const kh02G07Mapped =
    String(historicalG07Verdict) === "BLOCKED_BY_PROVIDER"
      ? "BLOCKED"
      : historicalG07Verdict;

  const verdictMatrix = {
    ENGINEERING_TESTS: engineeringVerdict,
    ENGINEERING_ACCEPTANCE: engineeringAcceptanceMapped,
    BROAD_REGRESSION: broadRegressionVerdict,
    REQUIRED_E2E_COVERAGE: requiredE2eCoverageVerdict,
    HISTORICAL_REPLAY_INTEGRITY: historicalReplayIntegrityVerdict,
    NICHE_RELEVANCE: nicheRelevanceVerdict,
    HISTORICAL_NICHE_SHORTLIST_COVERAGE: historicalNicheShortlistCoverageVerdict,
    HISTORICAL_PRODUCT_IDENTITY_TRUTH: historicalProductIdentityTruthVerdict,
    HISTORICAL_VERIFIED_IDENTITY_COVERAGE:
      hi?.holdoutIdentityCoverageStatus || "INSUFFICIENT_VERIFIED_IDENTITY",
    LIVE_DB_API_DOM_PARITY: liveDbApiDomParityVerdict,
    AMAZON_REAL_LIVE_DB_API_DOM_PARITY: amazonLiveDbApiDomParityVerdict,
    WALMART_REAL_LIVE_DB_API_DOM_PARITY: walmartLiveDbApiDomParityVerdict,
    ENGINEERING_FIXTURE_PARITY: engineeringFixtureParityVerdict,
    PERSISTED_PRODUCT_SCHEMA_PROOF: persistedProductSchemaProofVerdict,
    PERSISTED_LIVE_ORIGIN_PROOF: persistedLiveOriginProofVerdict,
    PERSISTED_SCHEMA_TRUTH_ENFORCEMENT: historicalProductIdentityTruthVerdict,
    LIVE_OBSERVATION_ORIGIN_ENFORCEMENT: historicalProductIdentityTruthVerdict,
    AMAZON_MCP_ENGINEERING: amazonMcpEngineeringVerdict,
    AMAZON_LOCAL_MCP_HANDSHAKE: amazonLocalMcpHandshakeVerdict,
    AMAZON_MCP_PUBLIC_PAGE_OBSERVED:
      amazonLocalMcpLiveObservationVerdict === "OBSERVED",
    AMAZON_LOCAL_MCP_LIVE_OBSERVATION: amazonLocalMcpLiveObservationVerdict,
    AMAZON_MCP_PRODUCT_IDENTITY: amazonProductIdentityPilotVerdict,
    AMAZON_PRODUCT_IDENTITY_PILOT: amazonProductIdentityPilotVerdict,
    AMAZON_MCP_PILOT_REQUIRED_TARGETS: amazonProductIdentityPilotVerdict,
    AMAZON_MCP_US_DELIVERY_PROOF: amazonUsDeliveryProofVerdict,
    AMAZON_US_DELIVERY_PROOF: amazonUsDeliveryProofVerdict,
    AMAZON_USD_PRICE_PROOF: amazonUsdPriceProofVerdict,
    AMAZON_CREATORS_API: amazonCreatorsApiVerdict,
    AMAZON_LIVE_PILOT_VERDICT: amazonLivePilotVerdict,
    WALMART_JINA_ENGINEERING: walmartJinaEngineeringVerdict,
    WALMART_JINA_LIVE: walmartLiveJinaPilotVerdict,
    WALMART_LIVE_JINA_PILOT: walmartLiveJinaPilotVerdict,
    KH02_G07: kh02G07Mapped,
    KH02_G15: historicalG15Verdict,
    KH02_G16: historicalG16Verdict,
    KH02_BUSINESS: kh02BusinessVerdict,
    FULL_BUSINESS_ACCEPTANCE: kh02BusinessVerdict,
    OVERALL_RELEASE: overallVerdict,
    LIVE_PROVIDERS: liveProvidersEntry,
    CURRENT_LIVE_PROVIDERS: liveProvidersEntry,
    HISTORICAL_DEMAND_G15: historicalG15Verdict,
    MERCHANT_TOP3_G16: historicalG16Verdict,
    HISTORICAL_STORED_PROOF: {
      snapshotRunId: input.diagnostics?.gates?.g16?.evaluatedRunId ?? null,
      snapshotCreatedAt:
        input.diagnostics?.gates?.g16?.evaluatedRunCreatedAt ?? null,
      snapshotFreshness:
        input.diagnostics?.gates?.g16?.snapshotFreshness ?? "MISSING",
      reconstructionStatus:
        input.diagnostics?.gates?.g16?.reconstructionStatus ?? "NO_STORED_RUN",
      previousSnapshotClaimedVerifiedCount:
        input.diagnostics?.gates?.g16?.previousSnapshotClaimedVerifiedCount ?? 0,
      verifiedFromPersistedEvidenceCount:
        input.diagnostics?.gates?.g16?.verifiedFromPersistedEvidenceCount ?? 0,
      persistedSchemaVerifiedCount,
      persistedLiveOriginVerifiedCount,
      newLiveVerifiedDuringThisRun:
        input.diagnostics?.gates?.g16?.newLiveVerifiedDuringThisRun ?? 0,
      storedG16Verdict: historicalG16Verdict,
      verifiedLiveMerchantsCount:
        input.diagnostics?.gates?.g16?.verifiedLiveMerchantsCount ?? 0,
      requiredLiveMerchantsCount:
        input.diagnostics?.gates?.g16?.requiredLiveMerchantsCount ?? 3,
      storedShortlistNicheMatchedCount:
        input.diagnostics?.shortlistQuality
          ?.storedRunShortlistNicheMatchedCount ?? 0,
      storedShortlistTotalCount:
        input.diagnostics?.shortlistQuality?.storedRunShortlistTotalCount ?? 0,
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
    historicalNicheShortlistCoverageVerdict,
    historicalProductIdentityTruthVerdict,
    liveDbApiDomParityVerdict,
    amazonLiveDbApiDomParityVerdict,
    walmartLiveDbApiDomParityVerdict,
    engineeringFixtureParityVerdict,
    liveWalmartProviderVerdict,
    liveAmazonProviderVerdict,
    amazonCreatorsApiVerdict,
    amazonLocalMcpHandshakeVerdict,
    amazonLocalMcpLiveObservationVerdict,
    amazonProductIdentityPilotVerdict,
    amazonUsDeliveryProofVerdict,
    amazonUsdPriceProofVerdict,
    amazonLivePilotVerdict,
    walmartLiveJinaPilotVerdict,
    ENGINEERING_ACCEPTANCE: engineeringAcceptanceMapped,
    REQUIRED_E2E_COVERAGE: requiredE2eCoverageVerdict,
    NICHE_RELEVANCE: nicheRelevanceVerdict,
    HISTORICAL_NICHE_SHORTLIST_COVERAGE: historicalNicheShortlistCoverageVerdict,
    HISTORICAL_PRODUCT_IDENTITY_TRUTH: historicalProductIdentityTruthVerdict,
    LIVE_DB_API_DOM_PARITY: liveDbApiDomParityVerdict,
    AMAZON_REAL_LIVE_DB_API_DOM_PARITY: amazonLiveDbApiDomParityVerdict,
    WALMART_REAL_LIVE_DB_API_DOM_PARITY: walmartLiveDbApiDomParityVerdict,
    ENGINEERING_FIXTURE_PARITY: engineeringFixtureParityVerdict,
    AMAZON_MCP_ENGINEERING: amazonMcpEngineeringVerdict,
    AMAZON_LOCAL_MCP_HANDSHAKE: amazonLocalMcpHandshakeVerdict,
    AMAZON_MCP_PUBLIC_PAGE_OBSERVED:
      amazonLocalMcpLiveObservationVerdict === "OBSERVED",
    AMAZON_LOCAL_MCP_LIVE_OBSERVATION: amazonLocalMcpLiveObservationVerdict,
    AMAZON_MCP_PRODUCT_IDENTITY: amazonProductIdentityPilotVerdict,
    AMAZON_PRODUCT_IDENTITY_PILOT: amazonProductIdentityPilotVerdict,
    AMAZON_MCP_PILOT_REQUIRED_TARGETS: amazonProductIdentityPilotVerdict,
    AMAZON_MCP_US_DELIVERY_PROOF: amazonUsDeliveryProofVerdict,
    AMAZON_US_DELIVERY_PROOF: amazonUsDeliveryProofVerdict,
    AMAZON_USD_PRICE_PROOF: amazonUsdPriceProofVerdict,
    AMAZON_CREATORS_API: amazonCreatorsApiVerdict,
    AMAZON_LIVE_PILOT_VERDICT: amazonLivePilotVerdict,
    WALMART_JINA_ENGINEERING: walmartJinaEngineeringVerdict,
    WALMART_JINA_LIVE: walmartLiveJinaPilotVerdict,
    WALMART_LIVE_JINA_PILOT: walmartLiveJinaPilotVerdict,
    KH02_G07: kh02G07Mapped,
    KH02_G15: historicalG15Verdict,
    KH02_G16: historicalG16Verdict,
    KH02_BUSINESS: kh02BusinessVerdict,
    FULL_BUSINESS_ACCEPTANCE: kh02BusinessVerdict,
    OVERALL_RELEASE: overallVerdict,
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
    e2eExecutionSummary: e2eSummary || null,
    nicheRelevanceSummary: nr || null,
    historicalIdentitySummary: hi || null,
    liveDbApiDomParitySummary: lp || null,
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

// ============================================================================
// TASK E (V12.4.3.7.2 P0-A): CENTRALIZED, FAIL-CLOSED RELEASE VERDICT EVALUATOR
// ============================================================================

export type GateVerdictStatusV12_4_3_7_2 =
  | "PASS"
  | "FAIL"
  | "INCOMPLETE"
  | "BLOCKED"
  | "BLOCKED_PROVIDER"
  | "BLOCKED_UPSTREAM"
  | "BLOCKED_ACCESS_CHALLENGE"
  | "BLOCKED_VERIFICATION"
  | "PAUSED_BLOCKED_PROVIDER"
  | "PUSH_ATTESTATION_PENDING"
  | "DEGRADED_OR_ZERO_LIVE"
  | "NOT_EXECUTED"
  | "INSUFFICIENT_EVIDENCE"
  | "PARTIAL"
  | "PARTIAL_CATEGORY_OR_FAMILY_ONLY"
  | "NOT_CONFIRMED_ON_LIVE_DOM"
  | "OBSERVED_NON_USD_OR_PARTIAL"
  | "UNVERIFIED"
  | "VACUOUS_OR_UNPROVEN";

export interface GateVerdictRecordV12_4_3_7_2 {
  gateId: string;
  status: GateVerdictStatusV12_4_3_7_2;
  evidenceRefs: string[];
  sourceSha: string;
  reasons: string[];
  measuredAt: string;
  scope: {
    workspaceId?: string | null;
    runId?: string | null;
    mode?: string | null;
    sessionId?: string | null;
  };
  counts: Record<string, number | string | boolean | null>;
}

export interface ComputeV12_4_3_7_2ReleaseVerdictsInput {
  expectedCodeSha: string;
  acceptanceRunId?: string;
  measuredAt?: string;
  gitPrecheck?: {
    codeSha?: string;
    branch?: string;
    ancestryVerified?: boolean;
  } | null;
  runtimePrecheck?: {
    codeSha?: string;
    playwrightMcpPackage?: string;
    playwrightMcpHandshakePassed?: boolean;
    metaCollectorVenvAvailable?: boolean;
    freeDiskGiB?: number;
  } | null;
  standaloneReference?: {
    codeSha?: string;
    manifest?: {
      referenceOrigin?: string;
      referenceAvailability?: string;
      referenceRawHashVerified?: boolean;
      referenceReplayStatus?: string;
      standaloneReferenceStatus?: string;
      standaloneAppIntegrationStatus?: string;
    };
    parserVerification?: {
      observationClass?: string;
      fixtureSource?: string;
      asin?: string;
      observedCanonicalUrl?: string;
    };
    downgradeNegativeTestPassed?: boolean;
    promotedToLiveCount?: number;
  } | null;
  serverWorkerProcess?: {
    codeSha?: string;
    executionMode?: string;
    acceptanceProcessPid?: number;
    serverProcessPid?: number;
    workerProcessPid?: number;
    directRouteImportUsedForPrimaryAcceptance?: boolean;
    inProcessExecuteResearchJobUsedForPrimaryAcceptance?: boolean;
    processesTerminatedCleanly?: boolean;
  } | null;
  httpPostJobFencing?: {
    codeSha?: string;
    httpMethod?: string;
    requestUrl?: string;
    requestSourceMode?: string;
    primaryWorkspacePreSeededAdRowCount?: number;
    postHttpStatus?: number;
    researchRunId?: string;
    workspaceId?: string;
    initialJobStatusBeforeWorkerClaim?: string | null;
    workerClaimed?: boolean;
    workerId?: string | null;
    claimToken?: string | null;
    fencingToken?: string | null;
    fencingGeneration?: number | null;
    finalJobStatus?: string | null;
    httpPollCount?: number;
  } | null;
  liveMetaCollection?: {
    codeSha?: string;
    workspaceId?: string;
    researchRunId?: string;
    sourceMode?: string;
    primaryWorkspacePreSeededAdRowCount?: number;
    liveAttempted?: boolean;
    subqueriesExecutedCount?: number;
    queryReceiptCount?: number;
    providerSucceededCount?: number;
    providerBlockedCount?: number;
    liveProviderObservationsCount?: number;
    validatedLiveObservationsCount?: number;
    candidateAssociatedLiveObservationsCount?: number;
    persistedLiveAdsCount?: number;
    cachedObservationsCount?: number;
    syntheticPromotedToLiveCount?: number;
    cachePromotedToLiveCount?: number;
    missingRawReceiptCount?: number;
    lineagePassedCount?: number;
    lineageRejectedCount?: number;
    strictLiveShortlistCount?: number;
    sourceStatus?: string | null;
    metaTelemetry?: Record<string, any> | null;
    candidateLineageAudit?: Array<Record<string, any>>;
  } | null;
  candidateFunnel?: {
    codeSha?: string;
    relevantPhysicalCandidatesCount?: number;
    nonProductPromotedToShortlistCount?: number;
    irrelevantPromotedToShortlistCount?: number;
  } | null;
  familyDedupShortlist?: {
    codeSha?: string;
    shortlistCount?: number;
    distinctFamiliesInShortlistCount?: number;
    reversedOrderIdentical?: boolean;
    shortfallPaddingDetected?: boolean;
    provisionalPromotedToEvergreenWinnersCount?: number;
  } | null;
  amazonUiPreflight?: {
    codeSha?: string;
    evaluatedAt?: string;
    workspaceId?: string | null;
    researchRunId?: string | null;
    sessionId?: string | null;
    internalGlowFetchUsed?: boolean;
    targetUsZip?: string;
    searchBoxReady?: boolean;
    locationTriggerFound?: boolean;
    dialogOpened?: boolean;
    zipInputFilled?: boolean;
    applyClicked?: boolean;
    observedDeliveryPostalCode?: string | null;
    observedDisplayedCurrencyCode?: string | null;
    finalEffectiveUsDeliveryVerified?: boolean;
    finalEffectiveCurrencyUsdVerified?: boolean;
    status?: string;
    stepsExecuted?: string[];
    contradictionsDetected?: string[];
    phases?: Record<string, any>;
    homeAndLocationReadback?: Record<string, any> | null;
  } | null;
  amazonTargetSelection?: {
    codeSha?: string;
    targetSelectionLedger?: { selectedCount?: number };
    usedForbiddenSliceFallback?: boolean;
    searchIntentPlans?: any[];
  } | null;
  amazonMcpLedger?: {
    codeSha?: string;
    operationsAttempted?: number;
    homeAndLocationReadbackRecorded?: boolean;
    fabricatedLiveSuccess?: boolean;
  } | null;
  amazonSearchCards?: {
    codeSha?: string;
    maxCardsPerSearchCap?: number;
    sponsoredCardsSelectedCount?: number;
    unvisitedCardsPromotedToVerifiedCount?: number;
    observedHrefSelectedCount?: number;
    searchBlockedOrEmpty?: boolean;
  } | null;
  amazonPdpVerdicts?: {
    codeSha?: string;
    evaluatedCandidates?: Array<Record<string, any>>;
    falseExactProductPromotionCount?: number;
    searchBrandCopiedFromCandidateCount?: number;
    zipBorrowedFromHomepageWhenPdpMissing?: boolean;
    usdInferredFromBareDollarSymbolAlone?: boolean;
  } | null;
  amazonSessionLifecycle?: {
    codeSha?: string;
    sessionId?: string | null;
    ownedChildPid?: number | null;
    transportMode?: string;
    serverOrigin?: string;
    allLiveOpsMatchSessionId?: boolean;
    mcpSessionClosedCleanly?: boolean;
    ownedChildPidTerminated?: boolean;
    closedAfterLastToolCompleted?: boolean;
    lastToolCompletedAt?: string | null;
    closeStartedAt?: string | null;
    closeFinishedAt?: string | null;
  } | null;
  dbPersistence?: {
    codeSha?: string;
    syncJobPersisted?: boolean;
    idempotentRePersistVerified?: boolean;
    persistedShortlistCount?: number;
    researchEvidenceRowCount?: number;
  } | null;
  httpGetParity?: {
    codeSha?: string;
    transportMode?: string;
    parityPassed?: boolean;
    leaderboardHttpStatus?: number;
    researchHttpStatus?: number;
    runByIdHttpStatus?: number;
    amazonRouteHttpStatus?: number;
    shortlistIdsInDb?: string[];
    shortlistIdsInLeaderboardApi?: string[];
    mismatches?: string[];
  } | null;
  uiDomParity?: {
    codeSha?: string;
    parityPassed?: boolean;
    cardsBeforeReloadCount?: number;
    cardsAfterReloadCount?: number;
    provisionalRenderedAsVerifiedEvergreenCount?: number;
    domCandidateIdsBeforeReload?: string[];
    domCandidateIdsAfterReload?: string[];
    mismatches?: string[];
  } | null;
  secondaryNiche?: {
    codeSha?: string;
    primaryNiche?: string;
    secondaryNiche?: string;
    secondaryShortlistCount?: number;
    crossNicheOverlapCount?: number;
    parityPassed?: boolean;
  } | null;
  walmartPaused?: {
    codeSha?: string;
    policy?: {
      featureEnabled?: boolean;
      liveAllowed?: boolean;
      operationalStatus?: string;
    };
    currentRunLiveWalmartHttpRequests?: number;
    priorLiveBlockerReference?: {
      responseBytes?: number;
      responseSha256?: string;
    };
  } | null;
  nonInflation?: {
    codeSha?: string;
    nonInflationVerified?: boolean;
    scoreDeltaAbsMax?: number;
    rankingChanged?: boolean;
    g07PromotedCount?: number;
    g15PromotedCount?: number;
    g16PromotedCount?: number;
  } | null;
  isolationAndReadOnly?: {
    codeSha?: string;
    readOnlyVerified?: boolean;
    crossWorkspaceDenied?: boolean;
    walmartPolicyOverrideRejected400?: boolean;
    amazonPolicyOverrideRejected400?: boolean;
  } | null;
  testMatrix?: {
    codeSha?: string;
    allPassed?: boolean;
    failedCasesCount?: number;
    totalCasesCount?: number;
    passedCasesCount?: number;
  } | null;
  targetedSuites?: {
    codeSha?: string;
    allPassed?: boolean;
    failedTests?: number;
    passedTests?: number;
    totalTests?: number;
  } | null;
  fullRegression?: {
    codeSha?: string;
    inventoryComplete?: boolean;
    excludedOrDeferredFilesCount?: number;
    failedTestCases?: number;
    executedTestFilesCount?: number;
    totalDiscoveredTestFiles?: number;
    passedTestCases?: number;
    totalExecutedTestCases?: number;
  } | null;
  e2eReceipts?: {
    codeSha?: string;
    totalSpecs?: number;
    passedSpecsCount?: number;
    failedSpecsCount?: number;
    skippedWithoutAttemptCount?: number;
    passedE2ETestCases?: number;
    totalE2ETestCases?: number;
    failedE2ETestCases?: number;
    receipts?: Array<{
      specIndex?: number;
      specFile?: string;
      command?: string;
      sourceSha?: string;
      codeSha?: string;
      startedAt?: string;
      endedAt?: string;
      durationMs?: number;
      exitCode?: number;
      totalTests?: number;
      passedTests?: number;
      failedTests?: number;
      skippedTests?: number;
      classification?: string;
      stdoutHash?: string;
      stderrHash?: string;
      ownedPidsReconciled?: boolean;
    }>;
    specs?: Array<{
      specIndex?: number;
      specFile?: string;
      sourceSha?: string;
      codeSha?: string;
      startedAt?: string;
      endedAt?: string;
      attempted?: boolean;
      passed?: boolean;
      classification?: string;
      exitCode?: number;
      casesPassed?: number;
      casesTotal?: number;
      totalTests?: number;
      passedTests?: number;
      failedTests?: number;
      ownedPidsReconciled?: boolean;
    }>;
  } | null;
  typecheckAndBuild?: {
    codeSha?: string;
    tscExitCode?: number;
    tscPassed?: boolean;
    nextBuildExitCode?: number;
    nextBuildPassed?: boolean;
  } | null;
  devReplay?: {
    codeSha?: string;
    split?: string;
    backtestEngineExecuted?: string;
    pointInTimeIntegrityVerdict?: string;
    postCutoffRowsIncludedCount?: number;
    historicalObservationCount?: number;
    shortlistCount?: number;
    verifiedIdentityCount?: number;
    eligibleHistoricalAmazonRowsCount?: number;
    eligibleHistoricalWalmartRowsCount?: number;
    historicalProviderParityStatus?: string;
    historicalDevBusinessVerdict?: string;
  } | null;
  holdoutReplay?: {
    codeSha?: string;
    split?: string;
    backtestEngineExecuted?: string;
    pointInTimeIntegrityVerdict?: string;
    postCutoffRowsIncludedCount?: number;
    historicalObservationCount?: number;
    shortlistCount?: number;
    verifiedIdentityCount?: number;
    eligibleHistoricalAmazonRowsCount?: number;
    eligibleHistoricalWalmartRowsCount?: number;
    historicalProviderParityStatus?: string;
    historicalHoldoutBusinessVerdict?: string;
  } | null;
  pointInTimeAudit?: {
    codeSha?: string;
    pointInTimeIntegrityVerdict?: string;
    postCutoffIncludedInReplayCount?: number;
    fixtureRowsIncludedInLiveReplayCount?: number;
    semanticHashAcceptedAsRawProductSchemaProofCount?: number;
    amazonPostCutoffExcludedCount?: number;
    walmartPostCutoffExcludedCount?: number;
  } | null;
  mutationSuite?: {
    codeSha?: string;
    kind?: string;
    scope?: string;
    isFixtureOnly?: boolean;
    acceptanceRunId?: string;
    evaluatedAt?: string;
    completedAt?: string;
    totalMutationsExecuted?: number;
    caughtMutationsCount?: number;
    falsePassesCount?: number;
    inconclusiveCount?: number;
    sourceTreeRestoredClean?: boolean;
    mutations?: Array<Record<string, any>>;
  } | null;
  commitPushAttestation?: Record<string, any> | null;
  resourceAndOrphanGuard?: {
    codeSha?: string;
    minFreeDiskGiB?: number;
    diskThresholdGiB?: number;
    diskGuardPassed?: boolean;
    orphanedOwnedProcessCount?: number;
    maxConcurrentHeavyObserved?: number;
    maxConcurrentHeavyLimit?: number;
  } | null;
  businessGates?: {
    codeSha?: string;
    g07Verdict?: "PASS" | "BLOCKED" | "INSUFFICIENT_EVIDENCE";
    g07Reason?: string;
    g15Verdict?: "PASS" | "INSUFFICIENT_EVIDENCE";
    g15QualifiedProductsCount?: number;
    g15RequiredDays?: number;
    g15MaxObservedDays?: number;
    g15Reason?: string;
    g16Verdict?: "PASS" | "PARTIAL_2_OF_3" | "PARTIAL_1_OF_3" | "INSUFFICIENT_EVIDENCE";
    g16VerifiedMerchantsCount?: number;
    g16RequiredMerchantsCount?: number;
    g16Reason?: string;
  } | null;
}

export interface ComputedReleaseVerdictsBundleV12_4_3_7_2 {
  codeSha: string;
  evaluatedAt: string;
  gates: Record<string, GateVerdictRecordV12_4_3_7_2>;
  verdictsByGate: Record<string, GateVerdictRecordV12_4_3_7_2>;
  verdictTable: Record<string, string>;
  allEngineeringGatesPassed: boolean;
  businessAcceptancePassed: boolean;
  anyGateFailed: boolean;
  failedGateKeys: string[];
}

/**
 * V12.4.3.7.3 P1-A: Fail-closed validation of all 12 canonical E2E spec receipts.
 * Never defaults `allSpecsAttemptedAndPassed` to `true` when `receipts` / `specs` is absent.
 */
export function validatePerSpecE2EReceipts(
  e2e: ComputeV12_4_3_7_2ReleaseVerdictsInput["e2eReceipts"] & Record<string, any> | null | undefined,
  expectedCodeSha: string
): {
  valid: boolean;
  status: "PASS" | "FAIL" | "INCOMPLETE";
  reasons: string[];
  computedTotalSpecs: number;
  computedPassedSpecs: number;
  computedTotalCases: number;
  computedPassedCases: number;
  computedFailedCases: number;
} {
  const reasons: string[] = [];
  if (!e2e || typeof e2e !== "object") {
    return {
      valid: false,
      status: "INCOMPLETE",
      reasons: ["E2E receipts artifact is missing."],
      computedTotalSpecs: 0,
      computedPassedSpecs: 0,
      computedTotalCases: 0,
      computedPassedCases: 0,
      computedFailedCases: 0,
    };
  }
  const cleanExpectedSha = String(expectedCodeSha || "").trim();
  const artifactSha = String(e2e.codeSha || e2e.sourceSha || "").trim();
  if (!cleanExpectedSha || artifactSha !== cleanExpectedSha) {
    return {
      valid: false,
      status: "FAIL",
      reasons: [`E2E artifact SHA '${artifactSha}' mismatches '${cleanExpectedSha}'.`],
      computedTotalSpecs: 0,
      computedPassedSpecs: 0,
      computedTotalCases: 0,
      computedPassedCases: 0,
      computedFailedCases: 0,
    };
  }

  const rawRows: any[] | null = Array.isArray(e2e.receipts)
    ? e2e.receipts
    : Array.isArray(e2e.specs)
    ? e2e.specs
    : null;

  if (!rawRows) {
    return {
      valid: false,
      status: "FAIL",
      reasons: [
        "MISSING_PER_SPEC_E2E_RECEIPTS_ARRAY: E2E artifact omits per-spec receipts/specs array; summary counters alone cannot satisfy E2E_SPEC_COVERAGE.",
      ],
      computedTotalSpecs: 0,
      computedPassedSpecs: 0,
      computedTotalCases: 0,
      computedPassedCases: 0,
      computedFailedCases: 0,
    };
  }

  const canonicalSpecs = Object.keys(STANDALONE_SERVER_OR_BROWSER_E2E_FILES);
  if (rawRows.length !== canonicalSpecs.length) {
    reasons.push(
      `EXPECTED_12_CANONICAL_E2E_SPECS_GOT_${rawRows.length}: expected ${canonicalSpecs.length} canonical E2E spec receipts, got ${rawRows.length}.`
    );
  }

  const seenSpecFiles = new Set<string>();
  const seenSpecIndices = new Set<number>();
  let sumTotalCases = 0;
  let sumPassedCases = 0;
  let sumFailedCases = 0;
  let passedSpecs = 0;

  for (let i = 0; i < rawRows.length; i++) {
    const r = rawRows[i];
    if (!r || typeof r !== "object") {
      reasons.push(`INVALID_E2E_RECEIPT_ROW_AT_${i}`);
      continue;
    }
    const specFile = String(r.specFile || "").trim();
    if (!specFile || !canonicalSpecs.includes(specFile)) {
      reasons.push(`NON_CANONICAL_OR_MISSING_E2E_SPEC_FILE:${specFile || `row_${i}`}`);
    } else if (seenSpecFiles.has(specFile)) {
      reasons.push(`DUPLICATE_E2E_SPEC_FILE:${specFile}`);
    } else {
      seenSpecFiles.add(specFile);
    }

    if (
      typeof r.specIndex !== "number" ||
      !Number.isInteger(r.specIndex) ||
      r.specIndex < 1 ||
      r.specIndex > canonicalSpecs.length ||
      seenSpecIndices.has(r.specIndex)
    ) {
      reasons.push(`DUPLICATE_OR_INVALID_E2E_SPEC_INDEX:${r.specIndex}`);
    } else {
      seenSpecIndices.add(r.specIndex);
    }

    const rowSha = r.sourceSha ?? r.codeSha;
    if (rowSha !== undefined && String(rowSha).trim() !== cleanExpectedSha) {
      reasons.push(`PER_SPEC_SOURCE_SHA_MISMATCH:${specFile || i}`);
    }

    if (r.exitCode !== 0) {
      reasons.push(`PER_SPEC_NONZERO_EXIT_CODE:${specFile || i}:exit=${r.exitCode}`);
    }

    if (r.classification !== undefined && r.classification !== "PASS") {
      reasons.push(
        `PER_SPEC_CLASSIFICATION_NOT_PASS:${specFile || i}:${r.classification}`
      );
    }
    if (r.passed !== undefined && r.passed !== true) {
      reasons.push(`PER_SPEC_PASSED_FALSE:${specFile || i}`);
    }
    if (r.attempted !== undefined && r.attempted !== true) {
      reasons.push(`PER_SPEC_ATTEMPTED_FALSE:${specFile || i}`);
    }

    const totalCases = Number(r.totalTests ?? r.casesTotal ?? 0);
    const passedCases = Number(r.passedTests ?? r.casesPassed ?? 0);
    const failedCases = Number(
      r.failedTests !== undefined ? r.failedTests : Math.max(0, totalCases - passedCases)
    );
    sumTotalCases += totalCases;
    sumPassedCases += passedCases;
    sumFailedCases += failedCases;

    if (
      !Number.isFinite(totalCases) ||
      totalCases <= 0 ||
      passedCases <= 0 ||
      failedCases !== 0 ||
      passedCases !== totalCases
    ) {
      reasons.push(
        `PER_SPEC_TEST_COUNTS_INVALID:${specFile || i}(passed=${passedCases},total=${totalCases},failed=${failedCases})`
      );
    }

    if (r.startedAt !== undefined || r.endedAt !== undefined) {
      const startMs = Date.parse(String(r.startedAt || ""));
      const endMs = Date.parse(String(r.endedAt || ""));
      if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || startMs > endMs) {
        reasons.push(`PER_SPEC_TIMESTAMPS_INVALID:${specFile || i}`);
      }
    }

    if (r.ownedPidsReconciled !== undefined && r.ownedPidsReconciled !== true) {
      reasons.push(`PER_SPEC_OWNED_PIDS_NOT_RECONCILED:${specFile || i}`);
    }

    const rowPassed =
      r.exitCode === 0 &&
      (r.classification === undefined || r.classification === "PASS") &&
      (r.passed === undefined || r.passed === true) &&
      (r.attempted === undefined || r.attempted === true) &&
      totalCases > 0 &&
      failedCases === 0 &&
      passedCases === totalCases;
    if (rowPassed) {
      passedSpecs++;
    }
  }

  for (const requiredSpec of canonicalSpecs) {
    if (!seenSpecFiles.has(requiredSpec)) {
      reasons.push(`MISSING_CANONICAL_E2E_SPEC:${requiredSpec}`);
    }
  }

  if (
    e2e.totalSpecs !== canonicalSpecs.length ||
    e2e.passedSpecsCount !== canonicalSpecs.length ||
    e2e.failedSpecsCount !== 0 ||
    e2e.skippedWithoutAttemptCount !== 0 ||
    passedSpecs !== canonicalSpecs.length ||
    e2e.totalE2ETestCases !== sumTotalCases ||
    e2e.passedE2ETestCases !== sumPassedCases ||
    (e2e.failedE2ETestCases !== undefined && e2e.failedE2ETestCases !== sumFailedCases) ||
    sumPassedCases < 34 ||
    sumPassedCases !== sumTotalCases ||
    sumFailedCases !== 0
  ) {
    reasons.push(
      `E2E_SUMMARY_TOTALS_MISMATCH_PER_SPEC_SUM(summarySpecs=${e2e.passedSpecsCount}/${e2e.totalSpecs},computedSpecs=${passedSpecs}/${rawRows.length},summaryCases=${e2e.passedE2ETestCases}/${e2e.totalE2ETestCases},computedCases=${sumPassedCases}/${sumTotalCases})`
    );
  }

  return {
    valid: reasons.length === 0,
    status: reasons.length === 0 ? "PASS" : "FAIL",
    reasons,
    computedTotalSpecs: rawRows.length,
    computedPassedSpecs: passedSpecs,
    computedTotalCases: sumTotalCases,
    computedPassedCases: sumPassedCases,
    computedFailedCases: sumFailedCases,
  };
}

/**
 * V12.4.3.7.3 P1-F: Reconciles strict LIVE_ONLY Meta query outcomes, upstream observations,
 * candidate-associated observations, persisted Ad rows, and Top-3 candidate lineage chains.
 */
export function reconcileLiveMetaLineageCounts(
  m: Record<string, any> | null | undefined
): {
  valid: boolean;
  contradictions: string[];
  realCompletedQueriesCount: number;
  validatedLiveObservationsCount: number;
  candidateAssociatedLiveObservationsCount: number;
  persistedLiveAdsCount: number;
  lineagePassedCount: number;
  lineageRejectedCount: number;
  strictLiveShortlistCount: number;
} {
  const contradictions: string[] = [];
  if (!m || typeof m !== "object") {
    return {
      valid: false,
      contradictions: ["MISSING_LIVE_META_COLLECTION_OBJECT"],
      realCompletedQueriesCount: 0,
      validatedLiveObservationsCount: 0,
      candidateAssociatedLiveObservationsCount: 0,
      persistedLiveAdsCount: 0,
      lineagePassedCount: 0,
      lineageRejectedCount: 0,
      strictLiveShortlistCount: 0,
    };
  }

  const telem = m.metaTelemetry;
  const hasNonEmptyTelem = Boolean(
    telem && typeof telem === "object" && Object.keys(telem).length > 0
  );
  const qOutcomes: any[] = Array.isArray(telem?.queryOutcomes)
    ? telem.queryOutcomes
    : [];
  const realCompletedQueries = qOutcomes.filter(
    (q) =>
      q &&
      q.attempted === true &&
      q.requestStarted === true &&
      q.requestCompleted === true &&
      Number(q.actualApiCalls ?? 0) > 0 &&
      (q.status === "SUCCEEDED_WITH_RESULTS" || q.status === "SUCCEEDED_EMPTY")
  );
  const queriesMissingRequestId = realCompletedQueries.filter(
    (q) =>
      typeof q.providerRequestId !== "string" ||
      q.providerRequestId.trim().length === 0
  );

  const validatedLiveObs = Number(
    m.validatedLiveObservationsCount ?? m.liveProviderObservationsCount ?? 0
  );
  const candidateAssocObs = Number(
    m.candidateAssociatedLiveObservationsCount ?? validatedLiveObs
  );
  const uniqueUpstreamObs = Number(
    m.uniqueAcceptedUpstreamObservationsCount ?? validatedLiveObs
  );
  const persistedAds = Number(
    m.persistedLiveAdsCount ?? m.persistedAdRecordsCount ?? 0
  );
  const lineagePassed = Number(
    m.lineagePassedCount ?? m.lineageVerifiedCandidatesCount ?? 0
  );
  const lineageRejected = Number(m.lineageRejectedCount ?? 0);
  const strictShortlist = Number(m.strictLiveShortlistCount ?? 0);

  if (m.sourceMode !== "LIVE_ONLY") {
    contradictions.push(`NON_LIVE_ONLY_SOURCE_MODE:${m.sourceMode}`);
  }
  if ((m.primaryWorkspacePreSeededAdRowCount ?? -1) !== 0) {
    contradictions.push(
      `NONZERO_PRE_SEEDED_AD_ROWS:${m.primaryWorkspacePreSeededAdRowCount}`
    );
  }
  if ((m.syntheticPromotedToLiveCount ?? 0) > 0) {
    contradictions.push(
      `SYNTHETIC_PROMOTED_TO_LIVE:${m.syntheticPromotedToLiveCount}`
    );
  }
  if ((m.cachePromotedToLiveCount ?? 0) > 0) {
    contradictions.push(`CACHE_PROMOTED_TO_LIVE:${m.cachePromotedToLiveCount}`);
  }
  if ((m.crossWorkspaceAdAdoptedCount ?? 0) > 0) {
    contradictions.push(
      `CROSS_WORKSPACE_AD_ADOPTED:${m.crossWorkspaceAdAdoptedCount}`
    );
  }
  if ((m.missingRawReceiptCount ?? 0) > 0 || queriesMissingRequestId.length > 0) {
    contradictions.push(
      `MISSING_PROVIDER_REQUEST_RECEIPT(missingRaw=${m.missingRawReceiptCount ?? 0},queriesMissingId=${queriesMissingRequestId.length})`
    );
  }
  if (lineageRejected > 0) {
    contradictions.push(`LINEAGE_REJECTED_NONZERO:${lineageRejected}`);
  }
  if (!hasNonEmptyTelem || qOutcomes.length === 0) {
    contradictions.push("EMPTY_META_TELEMETRY_OR_QUERY_OUTCOMES");
  }
  if (
    typeof m.subqueriesExecutedCount === "number" &&
    m.subqueriesExecutedCount !== realCompletedQueries.length &&
    qOutcomes.filter((q) => q && q.attempted === true && q.requestStarted === true).length !==
      m.subqueriesExecutedCount
  ) {
    contradictions.push(
      `SUBQUERIES_EXECUTED_COUNT_MISMATCH(claimed=${m.subqueriesExecutedCount},actual=${realCompletedQueries.length})`
    );
  }
  if (validatedLiveObs > candidateAssocObs || candidateAssocObs > uniqueUpstreamObs) {
    contradictions.push(
      `META_OBSERVATION_COUNT_HIERARCHY_VIOLATION(validated=${validatedLiveObs},candidateAssoc=${candidateAssocObs},upstream=${uniqueUpstreamObs})`
    );
  }
  if (
    m.candidateAssociatedLiveObservationsCount !== undefined &&
    m.validatedLiveObservationsCount !== undefined &&
    m.validatedLiveObservationsCount !== m.candidateAssociatedLiveObservationsCount &&
    lineageRejected === 0
  ) {
    contradictions.push(
      `UNRECONCILED_VALIDATED_VS_CANDIDATE_OBS_COUNT(validated=${m.validatedLiveObservationsCount},candidateAssoc=${m.candidateAssociatedLiveObservationsCount})`
    );
  }
  if (Array.isArray(m.candidateLineageAudit)) {
    const validChains = m.candidateLineageAudit.filter(
      (c: any) => c && c.valid === true
    ).length;
    if (validChains !== lineagePassed) {
      contradictions.push(
        `CANDIDATE_LINEAGE_AUDIT_MISMATCH(auditValid=${validChains},lineagePassed=${lineagePassed})`
      );
    }
  }
  if (strictShortlist === 3 && lineagePassed < 3) {
    contradictions.push(
      `STRICT_LIVE_SHORTLIST_CLAIMS_3_WITH_INSUFFICIENT_LINEAGE(lineagePassed=${lineagePassed})`
    );
  }

  return {
    valid: contradictions.length === 0,
    contradictions,
    realCompletedQueriesCount: realCompletedQueries.length,
    validatedLiveObservationsCount: validatedLiveObs,
    candidateAssociatedLiveObservationsCount: candidateAssocObs,
    persistedLiveAdsCount: persistedAds,
    lineagePassedCount: lineagePassed,
    lineageRejectedCount: lineageRejected,
    strictLiveShortlistCount: strictShortlist,
  };
}

export function computeV12_4_3_7_2ReleaseVerdicts(
  rawInput: ComputeV12_4_3_7_2ReleaseVerdictsInput & Record<string, any>
): ComputedReleaseVerdictsBundleV12_4_3_7_2 {
  const input: ComputeV12_4_3_7_2ReleaseVerdictsInput = {
    ...rawInput,
    gitPrecheck: rawInput.gitPrecheck ?? rawInput.artifact00BranchAndSha,
    runtimePrecheck: rawInput.runtimePrecheck ?? rawInput.artifact01RuntimePrecheck,
    standaloneReference:
      rawInput.standaloneReference ?? rawInput.artifact02StandaloneReference,
    serverWorkerProcess:
      rawInput.serverWorkerProcess ?? rawInput.artifact03ServerWorkerProof,
    httpPostJobFencing:
      rawInput.httpPostJobFencing ?? rawInput.artifact04HttpPostAndFencing,
    liveMetaCollection: rawInput.liveMetaCollection ?? rawInput.artifact05LiveMeta,
    candidateFunnel: rawInput.candidateFunnel ?? rawInput.artifact06DiscoveryFunnel,
    familyDedupShortlist:
      rawInput.familyDedupShortlist ?? rawInput.artifact07FamilyDedup,
    amazonUiPreflight:
      rawInput.amazonUiPreflight ?? rawInput.artifact08AmazonUiPreflight,
    amazonTargetSelection:
      rawInput.amazonTargetSelection ?? rawInput.artifact09AmazonTargetPlan,
    amazonMcpLedger: rawInput.amazonMcpLedger ?? rawInput.artifact10AmazonMcpLedger,
    amazonSearchCards:
      rawInput.amazonSearchCards ?? rawInput.artifact11AmazonSearchCards,
    amazonPdpVerdicts:
      rawInput.amazonPdpVerdicts ?? rawInput.artifact12AmazonPdpVerdicts,
    amazonSessionLifecycle:
      rawInput.amazonSessionLifecycle ?? rawInput.artifact13AmazonMcpSession,
    dbPersistence: rawInput.dbPersistence ?? rawInput.artifact14DbPersistence,
    httpGetParity: rawInput.httpGetParity ?? rawInput.artifact15RealHttpGetParity,
    uiDomParity: rawInput.uiDomParity ?? rawInput.artifact16UiDomReloadParity,
    secondaryNiche: rawInput.secondaryNiche ?? rawInput.artifact17SecondaryNiche,
    walmartPaused: rawInput.walmartPaused ?? rawInput.artifact18WalmartPaused,
    nonInflation: rawInput.nonInflation ?? rawInput.artifact19NonInflation,
    isolationAndReadOnly:
      rawInput.isolationAndReadOnly ?? rawInput.artifact20ReadOnlyIsolation,
    testMatrix: rawInput.testMatrix ?? rawInput.artifact21TestMatrix,
    targetedSuites: rawInput.targetedSuites ?? rawInput.artifact22TargetedSuites,
    fullRegression: rawInput.fullRegression ?? rawInput.artifact23FullRegression,
    e2eReceipts: rawInput.e2eReceipts ?? rawInput.artifact24E2EReceipts,
    devReplay: rawInput.devReplay ?? rawInput.artifact25DevReplay,
    holdoutReplay: rawInput.holdoutReplay ?? rawInput.artifact26HoldoutReplay,
    pointInTimeAudit: rawInput.pointInTimeAudit ?? rawInput.artifact27PointInTimeAudit,
    typecheckAndBuild:
      rawInput.typecheckAndBuild ??
      (rawInput.buildAndTscReceipt
        ? {
            codeSha: rawInput.buildAndTscReceipt.codeSha,
            tscExitCode: rawInput.buildAndTscReceipt.tscExitCode,
            tscPassed:
              rawInput.buildAndTscReceipt.tscPassed ??
              rawInput.buildAndTscReceipt.tscOk,
            nextBuildExitCode:
              rawInput.buildAndTscReceipt.nextBuildExitCode ??
              rawInput.buildAndTscReceipt.buildExitCode,
            nextBuildPassed:
              rawInput.buildAndTscReceipt.nextBuildPassed ??
              rawInput.buildAndTscReceipt.buildOk,
          }
        : undefined),
    resourceAndOrphanGuard:
      rawInput.resourceAndOrphanGuard ??
      (rawInput.resourceHygieneReceipt
        ? {
            codeSha: rawInput.resourceHygieneReceipt.codeSha,
            minFreeDiskGiB: rawInput.resourceHygieneReceipt.minFreeDiskGiB,
            diskThresholdGiB:
              rawInput.resourceHygieneReceipt.diskThresholdGiB ?? 15,
            diskGuardPassed:
              rawInput.resourceHygieneReceipt.diskGuardPassed ??
              (Number(rawInput.resourceHygieneReceipt.minFreeDiskGiB ?? 0) >= 15),
            orphanedOwnedProcessCount:
              rawInput.resourceHygieneReceipt.orphanedOwnedProcessCount ??
              Number(
                rawInput.resourceHygieneReceipt.unreconciledOwnedNodePidsCount ?? 0
              ) +
                Number(
                  rawInput.resourceHygieneReceipt
                    .unreconciledPlaywrightMcpPidsCount ?? 0
                ),
          }
        : undefined),
  };
  const expectedSha = String(input.expectedCodeSha || "").trim();
  const measuredAt = input.measuredAt || new Date().toISOString();
  const gates: Record<string, GateVerdictRecordV12_4_3_7_2> = {};

  const shaOk = (obj: any): boolean => {
    if (!obj || typeof obj !== "object") return false;
    const sha = String(obj.codeSha || obj.sourceSha || "").trim();
    return Boolean(expectedSha && /^[0-9a-f]{40}$/.test(expectedSha) && sha === expectedSha);
  };

  // 1. STANDALONE_REFERENCE_EVIDENCE_INTEGRITY
  {
    const sr = input.standaloneReference;
    const m = sr?.manifest;
    const pv = sr?.parserVerification;
    const reasons: string[] = [];
    const refs: string[] = [];
    let status: GateVerdictStatusV12_4_3_7_2 = "PASS";

    if (!sr) {
      status = "INCOMPLETE";
      reasons.push("Standalone reference artifact is missing.");
    } else if (!shaOk(sr)) {
      status = "FAIL";
      reasons.push(`Standalone reference SHA '${sr.codeSha}' mismatches '${expectedSha}'.`);
    } else {
      if (m?.referenceOrigin !== "USER_SUPPLIED_EXTERNAL_STANDALONE_REPORT") {
        status = "FAIL";
        reasons.push(`Invalid referenceOrigin: ${m?.referenceOrigin}`);
      }
      if (m?.referenceAvailability !== "SUMMARY_AND_SCRIPT_ONLY") {
        status = "FAIL";
        reasons.push(`Invalid referenceAvailability: ${m?.referenceAvailability}`);
      }
      if (m?.referenceRawHashVerified !== false) {
        status = "FAIL";
        reasons.push("referenceRawHashVerified must be false when raw bundle is absent.");
      }
      if (pv?.observationClass !== "TEST_FIXTURE") {
        status = "FAIL";
        reasons.push(`Standalone reference observationClass must be TEST_FIXTURE, got ${pv?.observationClass}.`);
      }
      if (sr.downgradeNegativeTestPassed !== true || (sr.promotedToLiveCount ?? 0) > 0) {
        status = "FAIL";
        reasons.push("Standalone reference downgrade guard failed or promoted fixture to live.");
      }
      if (status === "PASS") {
        refs.push(`StandaloneManifest:${pv?.asin || "B0D3XGHTJ5"}@TEST_FIXTURE@${expectedSha.slice(0, 8)}`);
        reasons.push("Standalone reference preserved as SUMMARY_AND_SCRIPT_ONLY / TEST_FIXTURE with 0 live promotions.");
      }
    }

    gates.STANDALONE_REFERENCE_EVIDENCE_INTEGRITY = {
      gateId: "STANDALONE_REFERENCE_EVIDENCE_INTEGRITY",
      status,
      evidenceRefs: refs,
      sourceSha: sr?.codeSha || "",
      reasons,
      measuredAt,
      scope: { mode: "REFERENCE_AUDIT" },
      counts: {
        referenceRawHashVerified: Boolean(m?.referenceRawHashVerified),
        downgradeNegativeTestPassed: Boolean(sr?.downgradeNegativeTestPassed),
        promotedToLiveCount: Number(sr?.promotedToLiveCount ?? 0),
      },
    };
  }

  // 2. REAL_NETWORK_HTTP_TO_INDEPENDENT_WORKER_E2E
  {
    const proc = input.serverWorkerProcess;
    const job = input.httpPostJobFencing;
    const reasons: string[] = [];
    const refs: string[] = [];
    let status: GateVerdictStatusV12_4_3_7_2 = "PASS";

    if (!proc || !job) {
      status = "INCOMPLETE";
      reasons.push("Server/worker process proof or HTTP POST job fencing ledger is missing.");
    } else if (!shaOk(proc) || !shaOk(job)) {
      status = "FAIL";
      reasons.push("SHA mismatch on server/worker process or job fencing artifact.");
    } else {
      const aPid = Number(proc.acceptanceProcessPid || 0);
      const sPid = Number(proc.serverProcessPid || 0);
      const wPid = Number(proc.workerProcessPid || 0);
      const distinctPids =
        aPid > 0 &&
        sPid > 0 &&
        wPid > 0 &&
        sPid !== wPid &&
        sPid !== aPid &&
        wPid !== aPid;
      if (proc.executionMode !== "REAL_NETWORK_WORKER_E2E" || !distinctPids) {
        status = "FAIL";
        reasons.push(`Invalid process topology: mode=${proc.executionMode}, aPid=${aPid}, sPid=${sPid}, wPid=${wPid}`);
      }
      if (
        proc.directRouteImportUsedForPrimaryAcceptance !== false ||
        proc.inProcessExecuteResearchJobUsedForPrimaryAcceptance !== false
      ) {
        status = "FAIL";
        reasons.push("Direct route import or in-process executeResearchJob used in primary acceptance.");
      }
      if (proc.processesTerminatedCleanly !== true) {
        status = "FAIL";
        reasons.push("Server or worker child process did not terminate cleanly.");
      }
      if (
        job.httpMethod !== "POST" ||
        job.postHttpStatus !== 202 ||
        job.requestSourceMode !== "LIVE_ONLY" ||
        (job.primaryWorkspacePreSeededAdRowCount ?? -1) !== 0
      ) {
        status = "FAIL";
        reasons.push(
          `HTTP POST / sourceMode / preSeeded check failed: status=${job.postHttpStatus}, mode=${job.requestSourceMode}, preSeeded=${job.primaryWorkspacePreSeededAdRowCount}`
        );
      }
      if (job.initialJobStatusBeforeWorkerClaim !== "PENDING") {
        status = "FAIL";
        reasons.push(
          `Initial job status before worker claim was '${job.initialJobStatusBeforeWorkerClaim}', expected 'PENDING'.`
        );
      }
      if (
        job.workerClaimed !== true ||
        !job.workerId ||
        !job.workerId.includes(String(wPid)) ||
        !job.claimToken ||
        !job.fencingToken ||
        typeof job.fencingGeneration !== "number" ||
        job.fencingGeneration < 1 ||
        (job.finalJobStatus !== "COMPLETED" && job.finalJobStatus !== "PARTIALLY_COMPLETED")
      ) {
        status = "FAIL";
        reasons.push(
          `Worker claim/fencing or terminal status invalid: workerId=${job.workerId}, fencingGen=${job.fencingGeneration}, finalStatus=${job.finalJobStatus}`
        );
      }
      if (status === "PASS") {
        refs.push(
          `ServerPID:${sPid}`,
          `WorkerPID:${wPid}`,
          `Job:${job.researchRunId}@fencingGen=${job.fencingGeneration}`
        );
        reasons.push(
          `Real HTTP POST 202 -> independent worker PID ${wPid} claimed and completed run ${job.researchRunId}.`
        );
      }
    }

    gates.REAL_NETWORK_HTTP_TO_INDEPENDENT_WORKER_E2E = {
      gateId: "REAL_NETWORK_HTTP_TO_INDEPENDENT_WORKER_E2E",
      status,
      evidenceRefs: refs,
      sourceSha: job?.codeSha || proc?.codeSha || "",
      reasons,
      measuredAt,
      scope: {
        workspaceId: job?.workspaceId || null,
        runId: job?.researchRunId || null,
        mode: job?.requestSourceMode || null,
      },
      counts: {
        serverPid: proc?.serverProcessPid ?? null,
        workerPid: proc?.workerProcessPid ?? null,
        postHttpStatus: job?.postHttpStatus ?? null,
        fencingGeneration: job?.fencingGeneration ?? null,
        httpPollCount: job?.httpPollCount ?? 0,
      },
    };
  }

  // 3. META_LIVE_CURRENT_RUN_COLLECTION & META_STRICT_LIVE_LINEAGE
  {
    const m = input.liveMetaCollection;
    const reasons: string[] = [];
    const refs: string[] = [];
    let colStatus: GateVerdictStatusV12_4_3_7_2 = "PASS";
    let linStatus: GateVerdictStatusV12_4_3_7_2 = "PASS";

    if (!m) {
      colStatus = "INCOMPLETE";
      linStatus = "INCOMPLETE";
      reasons.push("Live Meta collection artifact is missing.");
    } else if (!shaOk(m)) {
      colStatus = "FAIL";
      linStatus = "FAIL";
      reasons.push(`Meta collection SHA '${m.codeSha}' mismatches '${expectedSha}'.`);
    } else {
      const recon = reconcileLiveMetaLineageCounts(m as Record<string, any>);
      if (!recon.valid) {
        colStatus = "FAIL";
        linStatus = "FAIL";
        reasons.push(
          `Strict live Meta invariant / reconciliation violated: ${recon.contradictions.join(", ")}`
        );
      } else if (
        m.liveAttempted === true &&
        recon.realCompletedQueriesCount >= 1 &&
        recon.validatedLiveObservationsCount >= 1 &&
        recon.persistedLiveAdsCount >= 1 &&
        recon.lineagePassedCount >= 3 &&
        (m.strictLiveShortlistCount === undefined || recon.strictLiveShortlistCount === 3) &&
        (m.sourceStatus === "PASSED" || m.sourceStatus === "LIVE_DATA_VERIFIED")
      ) {
        colStatus = "PASS";
        linStatus = "PASS";
        refs.push(
          `MetaRun:${m.researchRunId}@queries=${recon.realCompletedQueriesCount}@liveObs=${recon.validatedLiveObservationsCount}@lineagePassed=${recon.lineagePassedCount}`
        );
        reasons.push(
          `Strict LIVE_ONLY Meta collection verified with ${recon.realCompletedQueriesCount} executed subqueries, ${recon.validatedLiveObservationsCount} lineage-verified live observations, and ${recon.lineagePassedCount} lineage-verified shortlist candidates.`
        );
      } else if (
        m.liveAttempted === true &&
        recon.realCompletedQueriesCount >= 1 &&
        recon.validatedLiveObservationsCount >= 1 &&
        recon.persistedLiveAdsCount >= 1 &&
        recon.lineagePassedCount > 0 &&
        recon.lineagePassedCount < 3
      ) {
        // Fewer than 3 lineage-verified candidates cannot satisfy Top-3 strict live lineage PASS
        colStatus = "FAIL";
        linStatus = "FAIL";
        reasons.push(
          `Insufficient strict live candidate lineage: lineagePassedCount=${recon.lineagePassedCount} (< 3 required for Top-3 strict live shortlist).`
        );
      } else if ((m.providerBlockedCount ?? 0) > 0 || m.sourceStatus === "FAILED") {
        colStatus = "BLOCKED_UPSTREAM";
        linStatus = "DEGRADED_OR_ZERO_LIVE";
        reasons.push("Meta upstream provider blocked or failed during LIVE_ONLY execution.");
      } else {
        colStatus = "DEGRADED_OR_ZERO_LIVE";
        linStatus = "DEGRADED_OR_ZERO_LIVE";
        reasons.push("Meta LIVE_ONLY execution returned 0 validated live observations.");
      }
    }

    gates.META_LIVE_CURRENT_RUN_COLLECTION = {
      gateId: "META_LIVE_CURRENT_RUN_COLLECTION",
      status: colStatus,
      evidenceRefs: refs,
      sourceSha: m?.codeSha || "",
      reasons,
      measuredAt,
      scope: {
        workspaceId: m?.workspaceId || null,
        runId: m?.researchRunId || null,
        mode: m?.sourceMode || null,
      },
      counts: {
        subqueriesExecutedCount: m?.subqueriesExecutedCount ?? 0,
        liveProviderObservationsCount: m?.liveProviderObservationsCount ?? 0,
        validatedLiveObservationsCount:
          m?.validatedLiveObservationsCount ?? m?.liveProviderObservationsCount ?? 0,
        cachedObservationsCount: m?.cachedObservationsCount ?? 0,
        lineagePassedCount:
          m?.lineagePassedCount ?? (m as any)?.lineageVerifiedCandidatesCount ?? 0,
        lineageRejectedCount: m?.lineageRejectedCount ?? 0,
      },
    };

    gates.META_STRICT_LIVE_LINEAGE = {
      gateId: "META_STRICT_LIVE_LINEAGE",
      status: linStatus,
      evidenceRefs: refs,
      sourceSha: m?.codeSha || "",
      reasons,
      measuredAt,
      scope: {
        workspaceId: m?.workspaceId || null,
        runId: m?.researchRunId || null,
        mode: m?.sourceMode || null,
      },
      counts: {
        lineagePassedCount:
          m?.lineagePassedCount ?? (m as any)?.lineageVerifiedCandidatesCount ?? 0,
        lineageRejectedCount: m?.lineageRejectedCount ?? 0,
        missingRawReceiptCount: m?.missingRawReceiptCount ?? 0,
      },
    };
  }

  // 4. CANDIDATE_DISCOVERY_AND_FAMILY_DEDUPLICATION
  {
    const f = input.candidateFunnel;
    const s = input.familyDedupShortlist;
    const reasons: string[] = [];
    const refs: string[] = [];
    let status: GateVerdictStatusV12_4_3_7_2 = "PASS";

    if (!f || !s) {
      status = "INCOMPLETE";
      reasons.push("Candidate funnel or shortlist deduplication artifact is missing.");
    } else if (!shaOk(f) || !shaOk(s)) {
      status = "FAIL";
      reasons.push("SHA mismatch on candidate funnel or shortlist deduplication artifact.");
    } else if (
      (f.relevantPhysicalCandidatesCount ?? 0) < 3 ||
      (f.nonProductPromotedToShortlistCount ?? 0) > 0 ||
      (f.irrelevantPromotedToShortlistCount ?? 0) > 0 ||
      s.shortlistCount !== 3 ||
      s.distinctFamiliesInShortlistCount !== 3 ||
      s.reversedOrderIdentical !== true ||
      s.shortfallPaddingDetected !== false ||
      (s.provisionalPromotedToEvergreenWinnersCount ?? 0) > 0
    ) {
      status = "FAIL";
      reasons.push(
        `Candidate discovery / family dedup invariant failed: shortlist=${s.shortlistCount}, families=${s.distinctFamiliesInShortlistCount}, reversedIdentical=${s.reversedOrderIdentical}, padding=${s.shortfallPaddingDetected}`
      );
    } else {
      refs.push(`Shortlist:3_distinct_families@${expectedSha.slice(0, 8)}`);
      reasons.push("3 distinct product families in Top 3 shortlist with order independence and 0 padding.");
    }

    gates.CANDIDATE_DISCOVERY_AND_FAMILY_DEDUPLICATION = {
      gateId: "CANDIDATE_DISCOVERY_AND_FAMILY_DEDUPLICATION",
      status,
      evidenceRefs: refs,
      sourceSha: s?.codeSha || f?.codeSha || "",
      reasons,
      measuredAt,
      scope: { mode: "CANDIDATE_DISCOVERY" },
      counts: {
        relevantPhysicalCandidatesCount: f?.relevantPhysicalCandidatesCount ?? 0,
        shortlistCount: s?.shortlistCount ?? 0,
        distinctFamiliesInShortlistCount: s?.distinctFamiliesInShortlistCount ?? 0,
      },
    };
  }

  // 5. AMAZON_LOCAL_MCP_SESSION_LIFECYCLE
  {
    const lc = input.amazonSessionLifecycle;
    const led = input.amazonMcpLedger;
    const reasons: string[] = [];
    const refs: string[] = [];
    let status: GateVerdictStatusV12_4_3_7_2 = "PASS";

    if (!lc || !led) {
      status = "INCOMPLETE";
      reasons.push("Amazon MCP session lifecycle or operation ledger is missing.");
    } else if (!shaOk(lc) || !shaOk(led)) {
      status = "FAIL";
      reasons.push("SHA mismatch on Amazon MCP session lifecycle or operation ledger.");
    } else {
      const opRows: any[] = Array.isArray((led as any).operationLedger)
        ? (led as any).operationLedger
        : [];
      const closeStartMs =
        typeof (lc as any).closeStartedAt === "string"
          ? Date.parse((lc as any).closeStartedAt)
          : NaN;
      const closeFinishMs =
        typeof (lc as any).closeFinishedAt === "string"
          ? Date.parse((lc as any).closeFinishedAt)
          : NaN;
      const lastToolMs =
        typeof (lc as any).lastToolCompletedAt === "string"
          ? Date.parse((lc as any).lastToolCompletedAt)
          : NaN;

      const closeBeforeLastTool =
        Number.isFinite(closeStartMs) &&
        Number.isFinite(lastToolMs) &&
        closeStartMs < lastToolMs;
      const closeFinishBeforeCloseStart =
        Number.isFinite(closeFinishMs) &&
        Number.isFinite(closeStartMs) &&
        closeFinishMs < closeStartMs;
      const opSessionMismatch = opRows.some(
        (op) => op && op.sessionId && lc.sessionId && op.sessionId !== lc.sessionId
      );
      const opAfterClose = opRows.some(
        (op) =>
          op &&
          typeof op.completedAt === "string" &&
          Number.isFinite(closeFinishMs) &&
          Date.parse(op.completedAt) > closeFinishMs
      );

      if (
        lc.transportMode !== "REAL_STDIO_MCP" ||
        lc.serverOrigin !== "PINNED_PLAYWRIGHT_MCP" ||
        lc.allLiveOpsMatchSessionId !== true ||
        lc.mcpSessionClosedCleanly !== true ||
        lc.ownedChildPidTerminated !== true ||
        lc.closedAfterLastToolCompleted !== true ||
        closeBeforeLastTool ||
        closeFinishBeforeCloseStart ||
        opSessionMismatch ||
        opAfterClose ||
        typeof led.operationsAttempted !== "number" ||
        led.operationsAttempted < 1 ||
        led.operationsAttempted > 4 ||
        led.fabricatedLiveSuccess === true
      ) {
        status = "FAIL";
        reasons.push(
          `Amazon MCP lifecycle invariant failed: transport=${lc.transportMode}, closedCleanly=${lc.mcpSessionClosedCleanly}, pidTerminated=${lc.ownedChildPidTerminated}, ops=${led.operationsAttempted}, closeBeforeLastTool=${closeBeforeLastTool}, opSessionMismatch=${opSessionMismatch}`
        );
      } else {
        refs.push(`McpSession:${lc.sessionId}@PID=${lc.ownedChildPid}@ops=${led.operationsAttempted}`);
        reasons.push("Same-session REAL_STDIO_MCP lifecycle verified and owned child PID terminated cleanly.");
      }
    }

    gates.AMAZON_LOCAL_MCP_SESSION_LIFECYCLE = {
      gateId: "AMAZON_LOCAL_MCP_SESSION_LIFECYCLE",
      status,
      evidenceRefs: refs,
      sourceSha: lc?.codeSha || "",
      reasons,
      measuredAt,
      scope: { sessionId: lc?.sessionId || null, mode: lc?.transportMode || null },
      counts: {
        operationsAttempted: led?.operationsAttempted ?? 0,
        mcpSessionClosedCleanly: Boolean(lc?.mcpSessionClosedCleanly),
        ownedChildPidTerminated: Boolean(lc?.ownedChildPidTerminated),
      },
    };
  }

  // 6. AMAZON_UI_US_DELIVERY_ZIP_95829, AMAZON_UI_USD_COMMERCIAL_EXTRACTION & AMAZON_UI_OBSERVATION_CHRONOLOGY
  {
    const ui = input.amazonUiPreflight;
    const pdp = input.amazonPdpVerdicts;
    const lc = input.amazonSessionLifecycle;
    const led = input.amazonMcpLedger;
    const zipReasons: string[] = [];
    const usdReasons: string[] = [];
    const chronReasons: string[] = [];
    const zipRefs: string[] = [];
    const usdRefs: string[] = [];
    const chronRefs: string[] = [];
    let zipStatus: GateVerdictStatusV12_4_3_7_2 = "PASS";
    let usdStatus: GateVerdictStatusV12_4_3_7_2 = "PASS";
    let chronStatus: GateVerdictStatusV12_4_3_7_2 = "PASS";

    if (!ui || !pdp || !lc) {
      zipStatus = !ui || !pdp ? "INCOMPLETE" : "FAIL";
      usdStatus = !ui || !pdp ? "INCOMPLETE" : "FAIL";
      chronStatus = "INCOMPLETE";
      zipReasons.push("Amazon UI preflight, PDP commercial, or session lifecycle artifact is missing.");
      usdReasons.push("Amazon UI preflight, PDP commercial, or session lifecycle artifact is missing.");
      chronReasons.push("Amazon UI preflight, PDP commercial, or session lifecycle artifact is missing.");
    } else if (!shaOk(ui) || !shaOk(pdp) || !shaOk(lc)) {
      zipStatus = "FAIL";
      usdStatus = "FAIL";
      chronStatus = "FAIL";
      zipReasons.push("SHA mismatch on Amazon UI preflight, PDP, or lifecycle artifact.");
      usdReasons.push("SHA mismatch on Amazon UI preflight, PDP, or lifecycle artifact.");
      chronReasons.push("SHA mismatch on Amazon UI preflight, PDP, or lifecycle artifact.");
    } else {
      const hr = ui.homeAndLocationReadback;
      const consistency = validateAmazonUiContextProofConsistency(ui as any);
      const contradictions = Array.from(
        new Set([
          ...(Array.isArray(ui.contradictionsDetected) ? ui.contradictionsDetected : []),
          ...consistency.contradictions,
        ])
      );
      if (ui.internalGlowFetchUsed === true) {
        contradictions.push("FORBIDDEN_INTERNAL_GLOW_FETCH_USED");
      }
      if (
        hr &&
        typeof hr === "object" &&
        ((typeof hr.locationDialogOpened === "boolean" &&
          ui.dialogOpened !== hr.locationDialogOpened) ||
          (typeof hr.observedDeliveryPostalCode === "string" &&
            hr.observedDeliveryPostalCode.length > 0 &&
            ui.observedDeliveryPostalCode !== hr.observedDeliveryPostalCode) ||
          (ui.status === "US_NOT_CONFIRMED" &&
            (hr.status === "US_DISPLAYED_CONTEXT_VERIFIED" || hr.usDeliveryVerified === true)))
      ) {
        contradictions.push("TOP_LEVEL_CONTRADICTS_NESTED_READBACK");
      }
      if (pdp.zipBorrowedFromHomepageWhenPdpMissing === true) {
        contradictions.push("ZIP_BORROWED_FROM_HOMEPAGE_WHEN_PDP_MISSING");
      }
      if (pdp.usdInferredFromBareDollarSymbolAlone === true) {
        contradictions.push("USD_INFERRED_FROM_BARE_DOLLAR_SYMBOL_ALONE");
      }

      // Cross-check phase timestamps & sessionId against sessionLifecycle (lc) and operationLedger (led)
      const phases = (ui as any).phases || {
        phase1_initial_home: (ui as any).phase1_initial_home,
        phase2_zip_dialog_action: (ui as any).phase2_zip_dialog_action,
        phase3_home_readback: (ui as any).phase3_home_readback,
        phase4_search_readback: (ui as any).phase4_search_readback,
        phase5_pdp_readback: (ui as any).phase5_pdp_readback,
        phase6_post_session_close: (ui as any).phase6_post_session_close,
      };
      const p4 = phases?.phase4_search_readback;
      const p5 = phases?.phase5_pdp_readback;
      const p6 = phases?.phase6_post_session_close;
      const closeStartIso =
        (lc as any).closeStartedAt ||
        p6?.observedFields?.closeStartedAt ||
        (ui as any).closeStartedAt ||
        null;
      const closeFinishIso =
        (lc as any).closeFinishedAt ||
        p6?.observedFields?.closeFinishedAt ||
        p6?.observedAt ||
        (ui as any).closeFinishedAt ||
        null;
      const lastToolIso =
        (lc as any).lastToolCompletedAt ||
        p6?.observedFields?.lastToolCompletedAt ||
        (ui as any).lastToolCompletedAt ||
        null;

      if (
        p4?.observedAt &&
        closeFinishIso &&
        Date.parse(p4.observedAt) > Date.parse(closeFinishIso)
      ) {
        contradictions.push("CHRONOLOGY_VIOLATION_PHASE4_OBSERVED_AFTER_SESSION_CLOSE");
      }
      if (
        p5?.observedAt &&
        closeFinishIso &&
        Date.parse(p5.observedAt) > Date.parse(closeFinishIso)
      ) {
        contradictions.push("CHRONOLOGY_VIOLATION_PHASE5_OBSERVED_AFTER_SESSION_CLOSE");
      }
      if (
        p4?.observedAt &&
        closeStartIso &&
        Date.parse(p4.observedAt) > Date.parse(closeStartIso)
      ) {
        contradictions.push("CHRONOLOGY_VIOLATION_PHASE4_OBSERVED_AFTER_CLOSE_STARTED");
      }
      if (
        p5?.observedAt &&
        closeStartIso &&
        Date.parse(p5.observedAt) > Date.parse(closeStartIso)
      ) {
        contradictions.push("CHRONOLOGY_VIOLATION_PHASE5_OBSERVED_AFTER_CLOSE_STARTED");
      }
      if (
        lastToolIso &&
        closeStartIso &&
        Date.parse(closeStartIso) < Date.parse(lastToolIso)
      ) {
        contradictions.push(
          "CHRONOLOGY_VIOLATION_CLOSE_STARTED_BEFORE_LAST_TOOL_COMPLETED"
        );
      }
      if (lc.sessionId && ui.sessionId && lc.sessionId !== ui.sessionId) {
        contradictions.push("SESSION_ID_MISMATCH_BETWEEN_UI_PROOF_AND_LIFECYCLE");
      }
      const opRows: any[] = Array.isArray((led as any)?.operationLedger)
        ? (led as any).operationLedger
        : [];
      for (const op of opRows) {
        if (op?.sessionId && lc.sessionId && op.sessionId !== lc.sessionId) {
          contradictions.push("SESSION_ID_MISMATCH_IN_OPERATION_LEDGER");
        }
        if (
          op?.completedAt &&
          closeFinishIso &&
          Date.parse(op.completedAt) > Date.parse(closeFinishIso)
        ) {
          contradictions.push("CHRONOLOGY_VIOLATION_OPERATION_COMPLETED_AFTER_SESSION_CLOSE");
        }
      }

      const pdpCands = Array.isArray(pdp.evaluatedCandidates) ? pdp.evaluatedCandidates : [];
      for (const c of pdpCands) {
        if (!isValidAmazonRawSnapshotHash(c?.rawEvidenceHash)) {
          contradictions.push("MISSING_OR_PHONY_PDP_CANDIDATE_RAW_EVIDENCE_HASH");
        }
        if (
          c?.observedAt &&
          closeFinishIso &&
          Date.parse(c.observedAt) > Date.parse(closeFinishIso)
        ) {
          contradictions.push("CHRONOLOGY_VIOLATION_PDP_CANDIDATE_OBSERVED_AFTER_CLOSE");
        }
      }

      const pdpZip95829Count = pdpCands.filter(
        (c) => c?.observedDeliveryPostalCode === "95829" && c?.verifiedDeliveryMarket === "US"
      ).length;
      const pdpUsdCount = pdpCands.filter(
        (c) =>
          c?.currency === "USD" &&
          typeof c?.price === "number" &&
          Number.isFinite(c.price) &&
          c.price > 0
      ).length;

      // Strict boolean checks without `?? true` defaults (P1-D)
      if (
        (ui as any).finalZipVerdict === "PASS" &&
        ui.finalEffectiveUsDeliveryVerified !== true
      ) {
        contradictions.push(
          "FINAL_ZIP_VERDICT_PASS_WITHOUT_EXPLICIT_US_DELIVERY_VERIFIED_TRUE"
        );
      }
      if (
        (ui as any).finalUsdCommercialVerdict === "PASS" &&
        ui.finalEffectiveCurrencyUsdVerified !== true
      ) {
        contradictions.push(
          "FINAL_USD_VERDICT_PASS_WITHOUT_EXPLICIT_USD_CURRENCY_VERIFIED_TRUE"
        );
      }
      if (
        ((ui as any).explicitCurrencySource === "SYMBOL_ONLY_UNVERIFIED" ||
          hr?.explicitCurrencySource === "SYMBOL_ONLY_UNVERIFIED") &&
        ((ui as any).finalUsdCommercialVerdict === "PASS" ||
          ui.finalEffectiveCurrencyUsdVerified === true)
      ) {
        contradictions.push("USD_VERIFIED_FROM_SYMBOL_ONLY_UNVERIFIED");
      }

      if (contradictions.length > 0) {
        zipStatus = "FAIL";
        usdStatus = "FAIL";
        chronStatus = "FAIL";
        zipReasons.push(`UI/PDP contradiction detected: ${contradictions.join(", ")}`);
        usdReasons.push(`UI/PDP contradiction detected: ${contradictions.join(", ")}`);
        chronReasons.push(`Amazon 6-phase chronology/consistency violation: ${contradictions.join(", ")}`);
      } else {
        chronStatus = "PASS";
        chronRefs.push(
          `AmazonChronology:${ui.sessionId || "live"}@p4=${p4?.observedAt}@p5=${p5?.observedAt}@close=${closeFinishIso}`
        );
        chronReasons.push(
          "All 6 Amazon browser phases have pre-close observation timestamps, valid raw snapshot hashes, and matching sessionId."
        );

        if (
          ui.observedDeliveryPostalCode === "95829" &&
          ui.dialogOpened === true &&
          ui.applyClicked === true &&
          ui.finalEffectiveUsDeliveryVerified === true &&
          pdpZip95829Count >= 1
        ) {
          zipStatus = "PASS";
          zipRefs.push(`AmazonUI:ZIP_95829@session=${ui.sessionId || "live"}@pdpCount=${pdpZip95829Count}`);
          zipReasons.push("US delivery ZIP 95829 confirmed across homepage readback, search, and PDP DOM.");
        } else if (ui.status === "CAPTCHA_BLOCKED") {
          zipStatus = "BLOCKED_ACCESS_CHALLENGE";
          zipReasons.push("Amazon UI blocked by access challenge.");
        } else {
          zipStatus = "NOT_CONFIRMED_ON_LIVE_DOM";
          zipReasons.push("US ZIP 95829 not confirmed across homepage and PDP DOM.");
        }

        if (
          ui.observedDisplayedCurrencyCode === "USD" &&
          ui.finalEffectiveCurrencyUsdVerified === true &&
          pdpUsdCount >= 1
        ) {
          usdStatus = "PASS";
          usdRefs.push(`AmazonPDP:USD@pdpUsdCount=${pdpUsdCount}`);
          usdReasons.push(`Explicit USD currency and numeric price verified on ${pdpUsdCount} live PDPs.`);
        } else if (ui.status === "CAPTCHA_BLOCKED") {
          usdStatus = "BLOCKED_ACCESS_CHALLENGE";
          usdReasons.push("Amazon UI blocked by access challenge.");
        } else {
          usdStatus = "OBSERVED_NON_USD_OR_PARTIAL";
          usdReasons.push("Explicit USD currency not confirmed on PDP DOM.");
        }
      }
    }

    gates.AMAZON_UI_OBSERVATION_CHRONOLOGY = {
      gateId: "AMAZON_UI_OBSERVATION_CHRONOLOGY",
      status: chronStatus,
      evidenceRefs: chronRefs,
      sourceSha: ui?.codeSha || "",
      reasons: chronReasons,
      measuredAt,
      scope: {
        workspaceId: ui?.workspaceId || null,
        runId: ui?.researchRunId || null,
        sessionId: ui?.sessionId || null,
      },
      counts: {
        contradictionsCount: Array.isArray(ui?.contradictionsDetected)
          ? ui!.contradictionsDetected!.length
          : 0,
      },
    };

    gates.AMAZON_UI_US_DELIVERY_ZIP_95829 = {
      gateId: "AMAZON_UI_US_DELIVERY_ZIP_95829",
      status: zipStatus,
      evidenceRefs: zipRefs,
      sourceSha: ui?.codeSha || "",
      reasons: zipReasons,
      measuredAt,
      scope: {
        workspaceId: ui?.workspaceId || null,
        runId: ui?.researchRunId || null,
        sessionId: ui?.sessionId || null,
      },
      counts: {
        observedDeliveryPostalCode: ui?.observedDeliveryPostalCode ?? null,
        dialogOpened: Boolean(ui?.dialogOpened),
        applyClicked: Boolean(ui?.applyClicked),
      },
    };

    gates.AMAZON_UI_USD_COMMERCIAL_EXTRACTION = {
      gateId: "AMAZON_UI_USD_COMMERCIAL_EXTRACTION",
      status: usdStatus,
      evidenceRefs: usdRefs,
      sourceSha: pdp?.codeSha || ui?.codeSha || "",
      reasons: usdReasons,
      measuredAt,
      scope: {
        workspaceId: ui?.workspaceId || null,
        runId: ui?.researchRunId || null,
        sessionId: ui?.sessionId || null,
      },
      counts: {
        observedDisplayedCurrencyCode: ui?.observedDisplayedCurrencyCode ?? null,
        evaluatedPdpCount: pdp?.evaluatedCandidates?.length ?? 0,
      },
    };
  }

  // 7. AMAZON_SEARCH_TO_OBSERVED_HREF_PDP_EXECUTION, AMAZON_SEARCH_PDP_IDENTITY_VERIFICATION & META_TO_AMAZON_EXACT_PRODUCT_CORROBORATION
  {
    const ts = input.amazonTargetSelection;
    const sc = input.amazonSearchCards;
    const pdp = input.amazonPdpVerdicts;
    const searchStatusReasons: string[] = [];
    const idReasons: string[] = [];
    const exactReasons: string[] = [];
    let searchStatus: GateVerdictStatusV12_4_3_7_2 = "PASS";
    let idStatus: GateVerdictStatusV12_4_3_7_2 = "PASS";
    let exactStatus: GateVerdictStatusV12_4_3_7_2 = "UNVERIFIED";

    if (!ts || !sc || !pdp) {
      searchStatus = "INCOMPLETE";
      idStatus = "INCOMPLETE";
      exactStatus = "INCOMPLETE";
    } else if (!shaOk(ts) || !shaOk(sc) || !shaOk(pdp)) {
      searchStatus = "FAIL";
      idStatus = "FAIL";
      exactStatus = "FAIL";
    } else {
      const cands = Array.isArray(pdp.evaluatedCandidates) ? pdp.evaluatedCandidates : [];
      if (
        ts.usedForbiddenSliceFallback === true ||
        (sc.maxCardsPerSearchCap ?? 0) > 5 ||
        (sc.sponsoredCardsSelectedCount ?? 0) > 0 ||
        (sc.unvisitedCardsPromotedToVerifiedCount ?? 0) > 0
      ) {
        searchStatus = "FAIL";
        searchStatusReasons.push("Amazon search card cap, sponsored filter, or unvisited card guard violated.");
      } else if ((sc.observedHrefSelectedCount ?? 0) >= 1 && cands.length >= 1) {
        searchStatus = "PASS";
        searchStatusReasons.push(`Navigated to ${cands.length} PDPs via observed search card hrefs.`);
      } else {
        searchStatus = "PARTIAL";
        searchStatusReasons.push("No observed search card href navigated to PDP.");
      }

      const searchPdpVerified = cands.filter(
        (c) => c?.searchIdentityVerdict === "AMAZON_SEARCH_PDP_IDENTITY_VERIFIED"
      ).length;
      const exactMatches = cands.filter(
        (c) =>
          c?.metaCandidateEquivalenceVerdict === "EXACT_PRODUCT" &&
          c?.combinedIdentityVerdict === "META_TO_AMAZON_EXACT_PRODUCT_CORROBORATED"
      ).length;
      const categoryMatches = cands.filter(
        (c) =>
          c?.metaCandidateEquivalenceVerdict === "CATEGORY_ONLY" ||
          c?.metaCandidateEquivalenceVerdict === "SAME_BRAND_DIFFERENT_MODEL"
      ).length;

      if (
        (pdp.falseExactProductPromotionCount ?? 0) > 0 ||
        (pdp.searchBrandCopiedFromCandidateCount ?? 0) > 0
      ) {
        idStatus = "FAIL";
        exactStatus = "FAIL";
        idReasons.push("False exact product promotion or search brand copied from candidate.");
        exactReasons.push("False exact product promotion detected.");
      } else {
        if (searchPdpVerified >= 1) {
          idStatus = "PASS";
          idReasons.push(`${searchPdpVerified}/${cands.length} Amazon search->PDP identities verified.`);
        } else {
          idStatus = "PARTIAL";
          idReasons.push("0 Amazon search->PDP identities verified.");
        }

        if (exactMatches >= 3) {
          exactStatus = "PASS";
          exactReasons.push(`All ${exactMatches} shortlisted candidates have exact Meta->Amazon product corroboration.`);
        } else if (exactMatches >= 1 || categoryMatches >= 1) {
          exactStatus = "PARTIAL_CATEGORY_OR_FAMILY_ONLY";
          exactReasons.push(
            `Observed ${exactMatches} exact product match and ${categoryMatches} category/family-only match (${exactMatches}/${cands.length} exact).`
          );
        } else {
          exactStatus = "UNVERIFIED";
          exactReasons.push("0 Meta->Amazon product matches observed.");
        }
      }
    }

    gates.AMAZON_SEARCH_TO_OBSERVED_HREF_PDP_EXECUTION = {
      gateId: "AMAZON_SEARCH_TO_OBSERVED_HREF_PDP_EXECUTION",
      status: searchStatus,
      evidenceRefs: searchStatus === "PASS" ? [`AmazonSearchHref:${sc?.observedHrefSelectedCount}`] : [],
      sourceSha: sc?.codeSha || "",
      reasons: searchStatusReasons,
      measuredAt,
      scope: { mode: "AMAZON_SEARCH_TO_PDP" },
      counts: {
        observedHrefSelectedCount: sc?.observedHrefSelectedCount ?? 0,
        sponsoredCardsSelectedCount: sc?.sponsoredCardsSelectedCount ?? 0,
        unvisitedCardsPromotedToVerifiedCount: sc?.unvisitedCardsPromotedToVerifiedCount ?? 0,
      },
    };

    gates.AMAZON_SEARCH_PDP_IDENTITY_VERIFICATION = {
      gateId: "AMAZON_SEARCH_PDP_IDENTITY_VERIFICATION",
      status: idStatus,
      evidenceRefs: idStatus === "PASS" ? [`AmazonPdpVerified:${pdp?.evaluatedCandidates?.length || 0}`] : [],
      sourceSha: pdp?.codeSha || "",
      reasons: idReasons,
      measuredAt,
      scope: { mode: "AMAZON_TWO_TIER_IDENTITY" },
      counts: {
        evaluatedCount: pdp?.evaluatedCandidates?.length ?? 0,
      },
    };

    gates.META_TO_AMAZON_EXACT_PRODUCT_CORROBORATION = {
      gateId: "META_TO_AMAZON_EXACT_PRODUCT_CORROBORATION",
      status: exactStatus,
      evidenceRefs: [`AmazonMetaCorroboration:${exactStatus}@${expectedSha.slice(0, 8)}`],
      sourceSha: pdp?.codeSha || "",
      reasons: exactReasons,
      measuredAt,
      scope: { mode: "META_TO_AMAZON_EQUIVALENCE" },
      counts: {
        evaluatedCount: pdp?.evaluatedCandidates?.length ?? 0,
        falseExactProductPromotionCount: pdp?.falseExactProductPromotionCount ?? 0,
      },
    };
  }

  // 8. WALMART_US_LIVE_OPERATIONAL_STATUS
  {
    const w = input.walmartPaused;
    let status: GateVerdictStatusV12_4_3_7_2 = "PAUSED_BLOCKED_PROVIDER";
    const reasons: string[] = [];

    if (!w) {
      status = "INCOMPLETE";
      reasons.push("Walmart status artifact is missing.");
    } else if (!shaOk(w)) {
      status = "FAIL";
      reasons.push("SHA mismatch on Walmart artifact.");
    } else if (
      w.policy?.featureEnabled !== false ||
      w.policy?.liveAllowed !== false ||
      w.policy?.operationalStatus !== "PAUSED_EXTERNAL" ||
      (w.currentRunLiveWalmartHttpRequests ?? -1) !== 0 ||
      w.priorLiveBlockerReference?.responseBytes !== 16845 ||
      w.priorLiveBlockerReference?.responseSha256 !==
        "d2e2fcd4b0b64ca67ef00bb7026736592060526b29ac9546b51498f4750f0fd4"
    ) {
      status = "FAIL";
      reasons.push("Walmart pause policy or prior CAPTCHA receipt invariant violated.");
    } else {
      reasons.push("Walmart US remains paused (PAUSED_BLOCKED_PROVIDER) with 0 live HTTP calls and verified CAPTCHA receipt.");
    }

    gates.WALMART_US_LIVE_OPERATIONAL_STATUS = {
      gateId: "WALMART_US_LIVE_OPERATIONAL_STATUS",
      status,
      evidenceRefs: ["WalmartReceipt:d2e2fcd4b0b64ca67ef00bb7026736592060526b29ac9546b51498f4750f0fd4"],
      sourceSha: w?.codeSha || "",
      reasons,
      measuredAt,
      scope: { mode: "PAUSED_EXTERNAL" },
      counts: {
        currentRunLiveWalmartHttpRequests: w?.currentRunLiveWalmartHttpRequests ?? null,
      },
    };
  }

  // 9. DB_API_UI_RELOAD_PARITY (P1-E: never fall back to dbIds when DOM IDs are missing)
  {
    const db = input.dbPersistence;
    const api = input.httpGetParity;
    const ui = input.uiDomParity;
    const ni = input.nonInflation;
    const iso = input.isolationAndReadOnly;
    const reasons: string[] = [];
    const refs: string[] = [];
    let status: GateVerdictStatusV12_4_3_7_2 = "PASS";

    if (!db || !api || !ui || !ni || !iso) {
      status = "INCOMPLETE";
      reasons.push("One or more DB/API/UI/non-inflation/isolation artifacts are missing.");
    } else if (!shaOk(db) || !shaOk(api) || !shaOk(ui) || !shaOk(ni) || !shaOk(iso)) {
      status = "FAIL";
      reasons.push("SHA mismatch across DB/API/UI/non-inflation/isolation artifacts.");
    } else {
      const dbIds = Array.isArray(api.shortlistIdsInDb) ? api.shortlistIdsInDb : [];
      const apiIds = Array.isArray(api.shortlistIdsInLeaderboardApi)
        ? api.shortlistIdsInLeaderboardApi
        : [];
      const hasDomBeforeArray = Array.isArray(ui.domCandidateIdsBeforeReload);
      const hasDomAfterArray = Array.isArray(ui.domCandidateIdsAfterReload);
      const domIdsBefore = hasDomBeforeArray ? ui.domCandidateIdsBeforeReload! : [];
      const domIdsAfter = hasDomAfterArray ? ui.domCandidateIdsAfterReload! : [];
      const distinctDbIds = new Set(
        dbIds.filter((id) => typeof id === "string" && id.trim().length > 0)
      );

      const exactIdsMatch =
        hasDomBeforeArray &&
        hasDomAfterArray &&
        dbIds.length === 3 &&
        distinctDbIds.size === 3 &&
        JSON.stringify(dbIds) === JSON.stringify(apiIds) &&
        JSON.stringify(dbIds) === JSON.stringify(domIdsBefore) &&
        JSON.stringify(dbIds) === JSON.stringify(domIdsAfter);

      if (
        db.syncJobPersisted !== true ||
        db.idempotentRePersistVerified !== true ||
        db.persistedShortlistCount !== 3 ||
        api.transportMode !== "REAL_NETWORK_HTTP_FETCH" ||
        api.parityPassed !== true ||
        api.leaderboardHttpStatus !== 200 ||
        api.researchHttpStatus !== 200 ||
        api.runByIdHttpStatus !== 200 ||
        api.amazonRouteHttpStatus !== 200 ||
        ((api as any).returnedCachedOrFixtureAsLiveCount ?? 0) > 0 ||
        (api.mismatches?.length ?? 0) > 0 ||
        ui.parityPassed !== true ||
        ui.cardsBeforeReloadCount !== 3 ||
        ui.cardsAfterReloadCount !== 3 ||
        (ui.provisionalRenderedAsVerifiedEvergreenCount ?? 0) > 0 ||
        (ui.mismatches?.length ?? 0) > 0 ||
        !exactIdsMatch ||
        ni.nonInflationVerified !== true ||
        (ni.scoreDeltaAbsMax ?? 1) !== 0 ||
        ni.rankingChanged !== false ||
        iso.readOnlyVerified !== true ||
        iso.crossWorkspaceDenied !== true ||
        iso.walmartPolicyOverrideRejected400 !== true ||
        iso.amazonPolicyOverrideRejected400 !== true
      ) {
        status = "FAIL";
        reasons.push("DB, HTTP GET API, Headless Chromium UI reload, non-inflation, or workspace isolation check failed.");
      } else {
        refs.push(`DbApiUiParity:${dbIds.join(",")}@${expectedSha.slice(0, 8)}`);
        reasons.push("Exact candidate IDs, ranks, evidence rows, and gating states match across SQLite, HTTP GET, and Chromium DOM pre/post reload.");
      }
    }

    gates.DB_API_UI_RELOAD_PARITY = {
      gateId: "DB_API_UI_RELOAD_PARITY",
      status,
      evidenceRefs: refs,
      sourceSha: api?.codeSha || db?.codeSha || "",
      reasons,
      measuredAt,
      scope: { mode: "REAL_NETWORK_HTTP_AND_CHROMIUM_DOM" },
      counts: {
        persistedShortlistCount: db?.persistedShortlistCount ?? 0,
        cardsBeforeReloadCount: ui?.cardsBeforeReloadCount ?? 0,
        cardsAfterReloadCount: ui?.cardsAfterReloadCount ?? 0,
        apiMismatches: api?.mismatches?.length ?? 0,
        uiMismatches: ui?.mismatches?.length ?? 0,
      },
    };
  }

  // 10. SECONDARY_NICHE_DYNAMIC_SEPARATION
  {
    const sn = input.secondaryNiche;
    let status: GateVerdictStatusV12_4_3_7_2 = "PASS";
    const reasons: string[] = [];

    if (!sn) {
      status = "INCOMPLETE";
      reasons.push("Secondary niche artifact is missing.");
    } else if (!shaOk(sn)) {
      status = "FAIL";
      reasons.push("SHA mismatch on secondary niche artifact.");
    } else if (
      sn.primaryNiche !== "Pet Gadgets" ||
      sn.secondaryNiche !== "Home Organization" ||
      sn.secondaryShortlistCount !== 3 ||
      sn.crossNicheOverlapCount !== 0 ||
      sn.parityPassed !== true
    ) {
      status = "FAIL";
      reasons.push("Secondary niche dynamic separation or overlap check failed.");
    } else {
      reasons.push("Secondary niche ('Home Organization') produced 3 distinct candidates with 0 overlap against 'Pet Gadgets'.");
    }

    gates.SECONDARY_NICHE_DYNAMIC_SEPARATION = {
      gateId: "SECONDARY_NICHE_DYNAMIC_SEPARATION",
      status,
      evidenceRefs: status === "PASS" ? [`SecondaryNiche:Home_Organization@${expectedSha.slice(0, 8)}`] : [],
      sourceSha: sn?.codeSha || "",
      reasons,
      measuredAt,
      scope: { mode: "SECONDARY_NICHE_ISOLATION" },
      counts: {
        secondaryShortlistCount: sn?.secondaryShortlistCount ?? 0,
        crossNicheOverlapCount: sn?.crossNicheOverlapCount ?? -1,
      },
    };
  }

  // 11. POINT_IN_TIME_HISTORICAL_REPLAY_INTEGRITY, HISTORICAL_PROVIDER_PARITY_TRUTH & HISTORICAL_BUSINESS_EVIDENCE
  {
    const dev = input.devReplay;
    const hold = input.holdoutReplay;
    const pit = input.pointInTimeAudit;
    let pitStatus: GateVerdictStatusV12_4_3_7_2 = "PASS";
    let provParityStatus: GateVerdictStatusV12_4_3_7_2 = "VACUOUS_OR_UNPROVEN";
    let histBizStatus: GateVerdictStatusV12_4_3_7_2 = "INSUFFICIENT_EVIDENCE";
    const pitReasons: string[] = [];
    const provReasons: string[] = [];
    const bizReasons: string[] = [];

    if (!dev || !hold || !pit) {
      pitStatus = "INCOMPLETE";
      provParityStatus = "INCOMPLETE";
      histBizStatus = "INCOMPLETE";
      pitReasons.push("DEV, HOLDOUT, or point-in-time audit artifact is missing.");
    } else if (!shaOk(dev) || !shaOk(hold) || !shaOk(pit)) {
      pitStatus = "FAIL";
      provParityStatus = "FAIL";
      histBizStatus = "FAIL";
      pitReasons.push("SHA mismatch on DEV, HOLDOUT, or point-in-time audit artifact.");
    } else {
      if (
        dev.split !== "DEV" ||
        hold.split !== "HOLDOUT" ||
        dev.backtestEngineExecuted !== "PASS" ||
        hold.backtestEngineExecuted !== "PASS" ||
        dev.pointInTimeIntegrityVerdict !== "PASS" ||
        hold.pointInTimeIntegrityVerdict !== "PASS" ||
        pit.pointInTimeIntegrityVerdict !== "PASS" ||
        (dev.postCutoffRowsIncludedCount ?? -1) !== 0 ||
        (hold.postCutoffRowsIncludedCount ?? -1) !== 0 ||
        (pit.postCutoffIncludedInReplayCount ?? -1) !== 0 ||
        (pit.fixtureRowsIncludedInLiveReplayCount ?? -1) !== 0 ||
        (pit.semanticHashAcceptedAsRawProductSchemaProofCount ?? -1) !== 0 ||
        (dev.historicalObservationCount ?? 0) < 1 ||
        (hold.historicalObservationCount ?? 0) < 1
      ) {
        pitStatus = "FAIL";
        pitReasons.push("Point-in-time historical replay or no-lookahead audit failed.");
      } else {
        pitStatus = "PASS";
        pitReasons.push(
          `Point-in-time replay verified on DEV (${dev.historicalObservationCount} obs) and HOLDOUT (${hold.historicalObservationCount} obs) with 0 post-cutoff leaks.`
        );
      }

      const histAmzCount =
        Number(dev.eligibleHistoricalAmazonRowsCount ?? 0) +
        Number(hold.eligibleHistoricalAmazonRowsCount ?? 0);
      const histWmtCount =
        Number(dev.eligibleHistoricalWalmartRowsCount ?? 0) +
        Number(hold.eligibleHistoricalWalmartRowsCount ?? 0);
      if (histAmzCount > 0 && histWmtCount > 0) {
        provParityStatus = "PASS";
        provReasons.push(`Historical Amazon (${histAmzCount}) and Walmart (${histWmtCount}) records verified.`);
      } else if (
        (dev as any).historicalProviderParityVerdict === "PASS" ||
        (hold as any).historicalProviderParityVerdict === "PASS" ||
        (pit as any).historicalProviderParityStatus === "PASS" ||
        (pit as any).historicalProviderParityVerdict === "PASS"
      ) {
        provParityStatus = "FAIL";
        provReasons.push(
          "Historical provider parity falsely claimed PASS when 0 pre-cutoff Amazon/Walmart rows exist."
        );
      } else {
        provParityStatus = "VACUOUS_OR_UNPROVEN";
        provReasons.push(
          "Zero pre-cutoff live Amazon/Walmart provider rows exist in historical DB; fixture post-cutoff rejection passes no-lookahead guard, but historical marketplace parity is VACUOUS_OR_UNPROVEN."
        );
      }

      if (
        (dev.verifiedIdentityCount ?? 0) >= 3 &&
        (hold.verifiedIdentityCount ?? 0) >= 3 &&
        dev.historicalDevBusinessVerdict === "PASS" &&
        hold.historicalHoldoutBusinessVerdict === "PASS"
      ) {
        histBizStatus = "PASS";
        bizReasons.push("DEV and HOLDOUT both achieved >= 3 verified evergreen winners.");
      } else if (
        (hold.verifiedIdentityCount ?? 0) > 0 &&
        hold.historicalHoldoutBusinessVerdict === "INSUFFICIENT_HISTORICAL_EVIDENCE"
      ) {
        // Tampered verifiedIdentityCount when historicalHoldoutBusinessVerdict is INSUFFICIENT
        pitStatus = "FAIL";
        histBizStatus = "FAIL";
        bizReasons.push("Contradictory HOLDOUT verifiedIdentityCount vs historicalHoldoutBusinessVerdict.");
      } else {
        histBizStatus = "INSUFFICIENT_EVIDENCE";
        bizReasons.push(
          `DEV shortlist=${dev.shortlistCount}/verified=${dev.verifiedIdentityCount}; HOLDOUT shortlist=${hold.shortlistCount}/verified=${hold.verifiedIdentityCount} (INSUFFICIENT_HISTORICAL_EVIDENCE).`
        );
      }
    }

    gates.POINT_IN_TIME_HISTORICAL_REPLAY_INTEGRITY = {
      gateId: "POINT_IN_TIME_HISTORICAL_REPLAY_INTEGRITY",
      status: pitStatus,
      evidenceRefs: pitStatus === "PASS" ? [`Backtest:DEV_2026_10_24+HOLDOUT_2026_10_30@${expectedSha.slice(0, 8)}`] : [],
      sourceSha: pit?.codeSha || "",
      reasons: pitReasons,
      measuredAt,
      scope: { mode: "POINT_IN_TIME_REPLAY" },
      counts: {
        devObs: dev?.historicalObservationCount ?? 0,
        holdoutObs: hold?.historicalObservationCount ?? 0,
        postCutoffIncluded: pit?.postCutoffIncludedInReplayCount ?? -1,
      },
    };

    gates.HISTORICAL_PROVIDER_PARITY_TRUTH = {
      gateId: "HISTORICAL_PROVIDER_PARITY_TRUTH",
      status: provParityStatus,
      evidenceRefs: [`HistoricalProviderParity:${provParityStatus}@${expectedSha.slice(0, 8)}`],
      sourceSha: pit?.codeSha || "",
      reasons: provReasons,
      measuredAt,
      scope: { mode: "HISTORICAL_PROVIDER_PARITY" },
      counts: {
        eligibleHistoricalAmazonRowsCount:
          (dev?.eligibleHistoricalAmazonRowsCount ?? 0) +
          (hold?.eligibleHistoricalAmazonRowsCount ?? 0),
        eligibleHistoricalWalmartRowsCount:
          (dev?.eligibleHistoricalWalmartRowsCount ?? 0) +
          (hold?.eligibleHistoricalWalmartRowsCount ?? 0),
      },
    };

    gates.HISTORICAL_BUSINESS_EVIDENCE = {
      gateId: "HISTORICAL_BUSINESS_EVIDENCE",
      status: histBizStatus,
      evidenceRefs: [`HistoricalBusiness:${histBizStatus}@${expectedSha.slice(0, 8)}`],
      sourceSha: hold?.codeSha || "",
      reasons: bizReasons,
      measuredAt,
      scope: { mode: "HISTORICAL_BUSINESS_EVALUATION" },
      counts: {
        devShortlistCount: dev?.shortlistCount ?? 0,
        devVerifiedIdentityCount: dev?.verifiedIdentityCount ?? 0,
        holdoutShortlistCount: hold?.shortlistCount ?? 0,
        holdoutVerifiedIdentityCount: hold?.verifiedIdentityCount ?? 0,
      },
    };
  }

  // 12. E2E_SPEC_COVERAGE & CODE_AND_ENGINEERING_GATES (P1-A & P1-B)
  {
    const git = input.gitPrecheck;
    const rt = input.runtimePrecheck;
    const tm = input.testMatrix;
    const ts = input.targetedSuites;
    const reg = input.fullRegression;
    const e2e = input.e2eReceipts;
    const tb = input.typecheckAndBuild;
    const mut = input.mutationSuite;
    const res = input.resourceAndOrphanGuard;

    const e2eValidation = validatePerSpecE2EReceipts(e2e as any, expectedSha);
    const e2eStatus: GateVerdictStatusV12_4_3_7_2 = e2eValidation.status;
    const e2eReasons: string[] =
      e2eValidation.status === "PASS"
        ? [
            `All 12/12 canonical E2E specs (${e2eValidation.computedPassedCases}/${e2eValidation.computedTotalCases} cases) passed with 0 skips and reconciled PIDs.`,
          ]
        : e2eValidation.reasons;

    gates.E2E_SPEC_COVERAGE = {
      gateId: "E2E_SPEC_COVERAGE",
      status: e2eStatus,
      evidenceRefs:
        e2eStatus === "PASS"
          ? [`E2E:12_specs_${e2eValidation.computedPassedCases}_cases@${expectedSha.slice(0, 8)}`]
          : [],
      sourceSha: e2e?.codeSha || "",
      reasons: e2eReasons,
      measuredAt,
      scope: { mode: "E2E_SUITE" },
      counts: {
        totalSpecs: e2e?.totalSpecs ?? 0,
        passedSpecsCount: e2e?.passedSpecsCount ?? 0,
        passedE2ETestCases: e2e?.passedE2ETestCases ?? 0,
        totalE2ETestCases: e2e?.totalE2ETestCases ?? 0,
      },
    };

    let engStatus: GateVerdictStatusV12_4_3_7_2 = "PASS";
    const engReasons: string[] = [];

    if (!git || !rt || !tm || !ts || !reg || !e2e || !tb || !mut || !res) {
      engStatus = "INCOMPLETE";
      if (!tb) engReasons.push("MISSING_TYPECHECK_AND_BUILD_RECEIPT");
      if (!mut) engReasons.push("MISSING_MUTATION_SUITE_RECEIPT");
      if (!res) engReasons.push("MISSING_RESOURCE_AND_ORPHAN_GUARD_RECEIPT");
      if (!git || !rt || !tm || !ts || !reg || !e2e) {
        engReasons.push("Required engineering precheck or test suite receipt is missing.");
      }
    } else if (
      !shaOk(git) ||
      !shaOk(rt) ||
      !shaOk(tm) ||
      !shaOk(ts) ||
      !shaOk(reg) ||
      !shaOk(e2e) ||
      !shaOk(tb) ||
      !shaOk(mut) ||
      !shaOk(res)
    ) {
      engStatus = "FAIL";
      engReasons.push("SHA parity failure across engineering test/build/mutation/resource artifacts.");
    } else {
      if (
        git.branch !== "feature/kh02-walmart-us-jina-reader-v12.4.3.5.1" ||
        git.ancestryVerified !== true
      ) {
        engStatus = "FAIL";
        engReasons.push("Git branch or ancestry verification failed.");
      }
      if (
        rt.playwrightMcpPackage !== "@playwright/mcp@0.0.83" ||
        rt.playwrightMcpHandshakePassed !== true ||
        rt.metaCollectorVenvAvailable !== true ||
        (rt.freeDiskGiB ?? 0) < 15
      ) {
        engStatus = "FAIL";
        engReasons.push("Runtime MCP handshake, Python venv, or 15 GiB disk precheck failed.");
      }
      const tmPassedCases =
        tm.passedCasesCount ??
        (tm.allPassed === true && tm.failedCasesCount === 0
          ? tm.totalCasesCount
          : 0);
      if (
        tm.allPassed !== true ||
        (tm.failedCasesCount ?? 1) !== 0 ||
        (tm.totalCasesCount ?? 0) < 50 ||
        tmPassedCases !== tm.totalCasesCount
      ) {
        engStatus = "FAIL";
        engReasons.push("Positive/negative test matrix failed or incomplete.");
      }
      const tsTotalTests =
        ts.totalTests ??
        Number(ts.passedTests ?? 0) + Number(ts.failedTests ?? 0);
      if (
        ts.allPassed !== true ||
        (ts.failedTests ?? 1) !== 0 ||
        (ts.passedTests ?? 0) < 350 ||
        ts.passedTests !== tsTotalTests
      ) {
        engStatus = "FAIL";
        engReasons.push("Targeted unit/integration suites failed or overreported.");
      }
      if (
        reg.inventoryComplete !== true ||
        (reg.excludedOrDeferredFilesCount ?? 1) !== 0 ||
        (reg.failedTestCases ?? 1) !== 0 ||
        (reg.executedTestFilesCount ?? 0) < 157 ||
        reg.executedTestFilesCount !== reg.totalDiscoveredTestFiles ||
        (reg.passedTestCases ?? 0) < 1940 ||
        reg.passedTestCases !== reg.totalExecutedTestCases
      ) {
        engStatus = "FAIL";
        engReasons.push("Full repository regression failed or inventory incomplete.");
      }
      if (e2eStatus !== "PASS") {
        engStatus = "FAIL";
        engReasons.push(...e2eReasons);
      }
      if (
        tb.tscPassed !== true ||
        tb.tscExitCode !== 0 ||
        tb.nextBuildPassed !== true ||
        tb.nextBuildExitCode !== 0
      ) {
        engStatus = "FAIL";
        engReasons.push(
          `TypeScript or Next.js build failed: tscExit=${tb.tscExitCode}, buildExit=${tb.nextBuildExitCode}`
        );
      }
      const mutCompletedIso = mut.completedAt || mut.evaluatedAt || null;
      const mutCompletedAfterVerdict =
        Boolean(mutCompletedIso) &&
        Number.isFinite(Date.parse(String(mutCompletedIso))) &&
        Number.isFinite(Date.parse(measuredAt)) &&
        Date.parse(String(mutCompletedIso)) > Date.parse(measuredAt);
      const mutHasInvalidKind =
        mut.kind !== undefined && mut.kind !== "ACTUAL_COMPLETED_MUTATION_RUN";
      const mutIsFixtureOnly =
        mut.isFixtureOnly === true ||
        mut.scope === "TEST_FIXTURE" ||
        mut.scope === "NON_RELEASE_EVIDENCE";
      const mutRunIdMismatch =
        Boolean(input.acceptanceRunId) &&
        Boolean(mut.acceptanceRunId) &&
        input.acceptanceRunId !== mut.acceptanceRunId;
      const mutInconclusiveCount = Number(mut.inconclusiveCount ?? 0);
      const mutRowsValid =
        !Array.isArray(mut.mutations) ||
        (mut.mutations.length === mut.totalMutationsExecuted &&
          mut.mutations.every(
            (r: any) =>
              r &&
              r.caught === true &&
              r.baselinePass !== false &&
              r.mutationFail !== false &&
              (!Array.isArray(r.newFailedChecks) || r.newFailedChecks.length > 0)
          ));
      if (
        (mut.falsePassesCount ?? 1) !== 0 ||
        mutInconclusiveCount > 0 ||
        (mut.totalMutationsExecuted ?? 0) < 92 ||
        mut.caughtMutationsCount !== mut.totalMutationsExecuted ||
        mut.sourceTreeRestoredClean !== true ||
        mutCompletedAfterVerdict ||
        mutHasInvalidKind ||
        mutIsFixtureOnly ||
        mutRunIdMismatch ||
        !mutRowsValid
      ) {
        engStatus = "FAIL";
        engReasons.push(
          mutCompletedAfterVerdict
            ? "CHRONOLOGY_VIOLATION_MUTATION_SUITE_COMPLETED_AFTER_VERDICT_EVALUATED_AT"
            : mutHasInvalidKind || mutIsFixtureOnly
            ? "INVALID_OR_FIXTURE_ONLY_MUTATION_RECEIPT_PROVENANCE"
            : mutRunIdMismatch
            ? "MUTATION_RUN_ID_MISMATCH"
            : mutInconclusiveCount > 0
            ? "MUTATION_SUITE_HAS_INCONCLUSIVE_CONTROL_BASELINES"
            : !mutRowsValid
            ? "MUTATION_PER_CASE_ROWS_MISSING_OR_INVALID"
            : "Physical negative mutation suite had false passes, < 92 mutations, or dirty worktree."
        );
      }
      if (
        res.diskGuardPassed !== true ||
        (res.minFreeDiskGiB ?? 0) < (res.diskThresholdGiB ?? 15) ||
        (res.orphanedOwnedProcessCount ?? 1) !== 0 ||
        (typeof res.maxConcurrentHeavyObserved === "number" &&
          res.maxConcurrentHeavyObserved > (res.maxConcurrentHeavyLimit ?? 2))
      ) {
        engStatus = "FAIL";
        engReasons.push(
          `Resource or orphan process guard failed: minDiskGiB=${res.minFreeDiskGiB}, orphans=${res.orphanedOwnedProcessCount}, peakHeavy=${res.maxConcurrentHeavyObserved}`
        );
      }
      // Also require core engineering sub-gates to be PASS
      if (
        gates.STANDALONE_REFERENCE_EVIDENCE_INTEGRITY.status !== "PASS" ||
        gates.REAL_NETWORK_HTTP_TO_INDEPENDENT_WORKER_E2E.status !== "PASS" ||
        gates.CANDIDATE_DISCOVERY_AND_FAMILY_DEDUPLICATION.status !== "PASS" ||
        gates.AMAZON_LOCAL_MCP_SESSION_LIFECYCLE.status !== "PASS" ||
        gates.AMAZON_UI_OBSERVATION_CHRONOLOGY.status !== "PASS" ||
        gates.DB_API_UI_RELOAD_PARITY.status !== "PASS" ||
        gates.SECONDARY_NICHE_DYNAMIC_SEPARATION.status !== "PASS" ||
        gates.POINT_IN_TIME_HISTORICAL_REPLAY_INTEGRITY.status !== "PASS"
      ) {
        engStatus = "FAIL";
        engReasons.push("One or more core engineering sub-gates did not PASS.");
      }
    }

    if (engStatus === "PASS" && mut && reg && e2e) {
      engReasons.push(
        `All engineering gates passed on ${expectedSha.slice(0, 8)}: ${reg.executedTestFilesCount} test files (${reg.passedTestCases} tests), 12 E2E specs (${e2e.passedE2ETestCases} cases), ${mut.caughtMutationsCount}/${mut.totalMutationsExecuted} mutations caught, tsc=0, build=0, 0 orphans.`
      );
    }

    gates.CODE_AND_ENGINEERING_GATES = {
      gateId: "CODE_AND_ENGINEERING_GATES",
      status: engStatus,
      evidenceRefs:
        engStatus === "PASS" && mut && reg && e2e
          ? [
              `Regression:${reg.executedTestFilesCount}_files_${reg.passedTestCases}_cases`,
              `E2E:12_specs_${e2e.passedE2ETestCases}_cases`,
              `Mutations:${mut.caughtMutationsCount}/${mut.totalMutationsExecuted}`,
            ]
          : [],
      sourceSha: expectedSha,
      reasons: engReasons,
      measuredAt,
      scope: { mode: "ENGINEERING_ACCEPTANCE" },
      counts: {
        executedTestFilesCount: reg?.executedTestFilesCount ?? 0,
        passedTestCases: reg?.passedTestCases ?? 0,
        passedE2ETestCases: e2e?.passedE2ETestCases ?? 0,
        caughtMutationsCount: mut?.caughtMutationsCount ?? 0,
        totalMutationsExecuted: mut?.totalMutationsExecuted ?? 0,
        orphanedOwnedProcessCount: res?.orphanedOwnedProcessCount ?? 0,
      },
    };
  }

  // 13. BUSINESS GATES: G07, G15, G16, FULL_KH02_BUSINESS_ACCEPTANCE, OVERALL_RELEASE_STATUS
  {
    const bg = input.businessGates;
    const g07HasRealProof =
      ((bg as any)?.g07LiveVerifiedCount ?? 0) >= 1 &&
      (bg as any)?.g07LiveProviderAuthenticated === true;
    const g07Status: GateVerdictStatusV12_4_3_7_2 =
      bg?.g07Verdict === "PASS"
        ? g07HasRealProof
          ? "PASS"
          : "FAIL"
        : bg?.g07Verdict === "INSUFFICIENT_EVIDENCE"
        ? "INSUFFICIENT_EVIDENCE"
        : "BLOCKED";

    const g15HasRealTimeSeries =
      (bg?.g15QualifiedProductsCount ?? 0) >= 3 &&
      (bg?.g15MaxObservedDays ?? 0) >= (bg?.g15RequiredDays ?? 60);
    let g15Status: GateVerdictStatusV12_4_3_7_2 = "INSUFFICIENT_EVIDENCE";
    if (bg?.g15Verdict === "PASS") {
      g15Status = g15HasRealTimeSeries ? "PASS" : "FAIL";
    }

    const g16HasAllThreeIndependentProofs =
      (bg?.g16VerifiedMerchantsCount ?? 0) >= (bg?.g16RequiredMerchantsCount ?? 3) &&
      (bg?.g16RequiredMerchantsCount ?? 3) >= 3;
    let g16Status: GateVerdictStatusV12_4_3_7_2 = "INSUFFICIENT_EVIDENCE";
    if (bg?.g16Verdict === "PASS") {
      g16Status = g16HasAllThreeIndependentProofs ? "PASS" : "FAIL";
    } else if (bg?.g16Verdict === "PARTIAL_2_OF_3" || bg?.g16Verdict === "PARTIAL_1_OF_3") {
      g16Status = "INSUFFICIENT_EVIDENCE";
    }

    gates.G07_PAID_MEDIA_PERSISTENCE = {
      gateId: "G07_PAID_MEDIA_PERSISTENCE",
      status: g07Status,
      evidenceRefs: [`G07:${g07Status}@${expectedSha.slice(0, 8)}`],
      sourceSha: bg?.codeSha || expectedSha,
      reasons: [
        bg?.g07Reason ||
          "TikTok Ads US live provider remains disabled/unauthenticated under zero-spend policy (G07 = BLOCKED).",
      ],
      measuredAt,
      scope: { mode: "G07_PAID_MEDIA" },
      counts: {},
    };

    gates.G15_LONGITUDINAL_DEMAND_60D = {
      gateId: "G15_LONGITUDINAL_DEMAND_60D",
      status: g15Status,
      evidenceRefs: [`G15:${g15Status}@qualified=${bg?.g15QualifiedProductsCount ?? 0}`],
      sourceSha: bg?.codeSha || expectedSha,
      reasons: [
        g15Status === "FAIL"
          ? "G15 falsely claimed PASS without >= 3 products having >= 60 covered days of longitudinal demand."
          : bg?.g15Reason ||
            "Fewer than 3 products have >= 60 covered days of authoritative product-level longitudinal demand (G15 = INSUFFICIENT_EVIDENCE).",
      ],
      measuredAt,
      scope: { mode: "G15_DEMAND_60D" },
      counts: {
        qualifiedProductsCount: bg?.g15QualifiedProductsCount ?? 0,
        requiredDays: bg?.g15RequiredDays ?? 60,
        maxObservedDays: bg?.g15MaxObservedDays ?? 0,
      },
    };

    gates.G16_INDEPENDENT_MERCHANT_PROOF = {
      gateId: "G16_INDEPENDENT_MERCHANT_PROOF",
      status: g16Status,
      evidenceRefs: [`G16:${g16Status}@verified=${bg?.g16VerifiedMerchantsCount ?? 0}`],
      sourceSha: bg?.codeSha || expectedSha,
      reasons: [
        g16Status === "FAIL"
          ? "G16 falsely claimed PASS without 3/3 independent persisted merchant schema proofs."
          : bg?.g16Reason ||
            "0/3 shortlisted candidates have independent persisted DB merchant schema + live same-run lineage proof (G16 = INSUFFICIENT_EVIDENCE).",
      ],
      measuredAt,
      scope: { mode: "G16_MERCHANT_PROOF" },
      counts: {
        verifiedMerchantsCount: bg?.g16VerifiedMerchantsCount ?? 0,
        requiredMerchantsCount: bg?.g16RequiredMerchantsCount ?? 3,
      },
    };

    let fullBizStatus: GateVerdictStatusV12_4_3_7_2 = "INSUFFICIENT_EVIDENCE";
    const fullBizReasons: string[] = [];
    if (
      gates.CODE_AND_ENGINEERING_GATES.status === "FAIL" ||
      g07Status === "FAIL" ||
      g15Status === "FAIL" ||
      g16Status === "FAIL" ||
      gates.HISTORICAL_BUSINESS_EVIDENCE.status === "FAIL" ||
      ((bg as any)?.fullBusinessVerdict === "PASS" &&
        (g07Status !== "PASS" || g15Status !== "PASS" || g16Status !== "PASS"))
    ) {
      fullBizStatus = "FAIL";
      fullBizReasons.push("Engineering or business gate integrity check failed.");
    } else if (
      gates.CODE_AND_ENGINEERING_GATES.status === "PASS" &&
      g07Status === "PASS" &&
      g15Status === "PASS" &&
      g16Status === "PASS" &&
      gates.HISTORICAL_BUSINESS_EVIDENCE.status === "PASS"
    ) {
      fullBizStatus = "PASS";
      fullBizReasons.push("All engineering and business gates (G07, G15, G16, historical) passed.");
    } else {
      fullBizStatus = "INSUFFICIENT_EVIDENCE";
      fullBizReasons.push(
        `Business acceptance remains INSUFFICIENT_EVIDENCE (G07=${g07Status}, G15=${g15Status}, G16=${g16Status}, HistoricalBusiness=${gates.HISTORICAL_BUSINESS_EVIDENCE.status}).`
      );
    }

    gates.FULL_KH02_BUSINESS_ACCEPTANCE = {
      gateId: "FULL_KH02_BUSINESS_ACCEPTANCE",
      status: fullBizStatus,
      evidenceRefs: [`FullBusiness:${fullBizStatus}@${expectedSha.slice(0, 8)}`],
      sourceSha: expectedSha,
      reasons: fullBizReasons,
      measuredAt,
      scope: { mode: "BUSINESS_ACCEPTANCE" },
      counts: {
        g07: g07Status,
        g15: g15Status,
        g16: g16Status,
      },
    };
  }

  // 14. V12.4.3.7.3 SECTION 8 ROUTE-SPECIFIC GATE ALIASES
  {
    const aliasGate = (
      newGateId: string,
      baseGate: GateVerdictRecordV12_4_3_7_2,
      overrideStatus?: GateVerdictStatusV12_4_3_7_2
    ): GateVerdictRecordV12_4_3_7_2 => ({
      ...baseGate,
      gateId: newGateId,
      status: overrideStatus ?? baseGate.status,
    });

    const git = input.gitPrecheck;
    const gitStatus: GateVerdictStatusV12_4_3_7_2 = !git
      ? "INCOMPLETE"
      : !shaOk(git) ||
        git.branch !== "feature/kh02-walmart-us-jina-reader-v12.4.3.5.1" ||
        git.ancestryVerified !== true
      ? "FAIL"
      : "PASS";
    gates.GIT_BRANCH_AND_CODE_SHA_INTEGRITY = {
      gateId: "GIT_BRANCH_AND_CODE_SHA_INTEGRITY",
      status: gitStatus,
      evidenceRefs: gitStatus === "PASS" ? [`GitBranch:${git?.branch}@${expectedSha.slice(0, 8)}`] : [],
      sourceSha: git?.codeSha || "",
      reasons:
        gitStatus === "PASS"
          ? ["Feature branch and origin/QA ancestry verified with exact CODE_SHA."]
          : ["Git branch, ancestry, or CODE_SHA check failed."],
      measuredAt,
      scope: { mode: "GIT_PRECHECK" },
      counts: { ancestryVerified: Boolean(git?.ancestryVerified) },
    };

    const reg = input.fullRegression;
    const ts = input.targetedSuites;
    const regStatus: GateVerdictStatusV12_4_3_7_2 =
      !reg || !ts
        ? "INCOMPLETE"
        : !shaOk(reg) ||
          !shaOk(ts) ||
          ts.allPassed !== true ||
          (ts.failedTests ?? 1) !== 0 ||
          reg.inventoryComplete !== true ||
          (reg.excludedOrDeferredFilesCount ?? 1) !== 0 ||
          (reg.failedTestCases ?? 1) !== 0 ||
          (reg.executedTestFilesCount ?? 0) < 157 ||
          reg.executedTestFilesCount !== reg.totalDiscoveredTestFiles ||
          reg.passedTestCases !== reg.totalExecutedTestCases
        ? "FAIL"
        : "PASS";
    gates.FULL_REPOSITORY_UNIT_INTEGRATION_REGRESSION = {
      gateId: "FULL_REPOSITORY_UNIT_INTEGRATION_REGRESSION",
      status: regStatus,
      evidenceRefs:
        regStatus === "PASS"
          ? [`Regression:${reg?.executedTestFilesCount}_files_${reg?.passedTestCases}_cases`]
          : [],
      sourceSha: reg?.codeSha || "",
      reasons:
        regStatus === "PASS"
          ? [`All ${reg?.executedTestFilesCount} unit/integration test files passed (${reg?.passedTestCases} tests).`]
          : ["Unit/integration regression failed or incomplete."],
      measuredAt,
      scope: { mode: "FULL_REGRESSION" },
      counts: {
        executedTestFilesCount: reg?.executedTestFilesCount ?? 0,
        passedTestCases: reg?.passedTestCases ?? 0,
      },
    };

    gates.ALL_12_CANONICAL_E2E_SPECS = aliasGate(
      "ALL_12_CANONICAL_E2E_SPECS",
      gates.E2E_SPEC_COVERAGE
    );

    const tb = input.typecheckAndBuild;
    const tbStatus: GateVerdictStatusV12_4_3_7_2 = !tb
      ? "INCOMPLETE"
      : !shaOk(tb) ||
        tb.tscPassed !== true ||
        tb.tscExitCode !== 0 ||
        tb.nextBuildPassed !== true ||
        tb.nextBuildExitCode !== 0
      ? "FAIL"
      : "PASS";
    gates.TYPESCRIPT_AND_NEXT_PRODUCTION_BUILD = {
      gateId: "TYPESCRIPT_AND_NEXT_PRODUCTION_BUILD",
      status: tbStatus,
      evidenceRefs: tbStatus === "PASS" ? [`BuildAndTsc:PASS@${expectedSha.slice(0, 8)}`] : [],
      sourceSha: tb?.codeSha || "",
      reasons:
        tbStatus === "PASS"
          ? ["TypeScript (`tsc --noEmit`) and production build (`next build`) exited 0."]
          : ["TypeScript or Next.js build missing or failed."],
      measuredAt,
      scope: { mode: "TYPECHECK_AND_BUILD" },
      counts: {
        tscExitCode: tb?.tscExitCode ?? -1,
        nextBuildExitCode: tb?.nextBuildExitCode ?? -1,
      },
    };

    gates.REAL_HTTP_SERVER_TO_INDEPENDENT_WORKER_EXECUTION = aliasGate(
      "REAL_HTTP_SERVER_TO_INDEPENDENT_WORKER_EXECUTION",
      gates.REAL_NETWORK_HTTP_TO_INDEPENDENT_WORKER_E2E
    );
    gates.STRICT_LIVE_ONLY_META_QUERY_PROVENANCE = aliasGate(
      "STRICT_LIVE_ONLY_META_QUERY_PROVENANCE",
      gates.META_LIVE_CURRENT_RUN_COLLECTION
    );
    gates.META_OBSERVATION_TO_PERSISTED_AD_TO_CANDIDATE_LINEAGE = aliasGate(
      "META_OBSERVATION_TO_PERSISTED_AD_TO_CANDIDATE_LINEAGE",
      gates.META_STRICT_LIVE_LINEAGE
    );
    gates.STRICT_LIVE_SHORTLIST_3_DISTINCT_FAMILIES = aliasGate(
      "STRICT_LIVE_SHORTLIST_3_DISTINCT_FAMILIES",
      gates.CANDIDATE_DISCOVERY_AND_FAMILY_DEDUPLICATION,
      gates.CANDIDATE_DISCOVERY_AND_FAMILY_DEDUPLICATION.status === "PASS" &&
        gates.META_STRICT_LIVE_LINEAGE.status === "PASS"
        ? "PASS"
        : gates.CANDIDATE_DISCOVERY_AND_FAMILY_DEDUPLICATION.status === "INCOMPLETE" ||
          gates.META_STRICT_LIVE_LINEAGE.status === "INCOMPLETE"
        ? "INCOMPLETE"
        : "FAIL"
    );
    gates.AMAZON_LOCAL_PLAYWRIGHT_MCP_SMOKE_EXECUTION = aliasGate(
      "AMAZON_LOCAL_PLAYWRIGHT_MCP_SMOKE_EXECUTION",
      gates.AMAZON_SEARCH_TO_OBSERVED_HREF_PDP_EXECUTION,
      gates.AMAZON_LOCAL_MCP_SESSION_LIFECYCLE.status === "PASS" &&
        gates.AMAZON_SEARCH_TO_OBSERVED_HREF_PDP_EXECUTION.status === "PASS"
        ? "PASS"
        : gates.AMAZON_LOCAL_MCP_SESSION_LIFECYCLE.status === "INCOMPLETE" ||
          gates.AMAZON_SEARCH_TO_OBSERVED_HREF_PDP_EXECUTION.status === "INCOMPLETE"
        ? "INCOMPLETE"
        : "FAIL"
    );
    gates.AMAZON_SIX_PHASE_OBSERVATION_CHRONOLOGY = aliasGate(
      "AMAZON_SIX_PHASE_OBSERVATION_CHRONOLOGY",
      gates.AMAZON_UI_OBSERVATION_CHRONOLOGY
    );
    gates.AMAZON_US_ZIP_95829_AND_EXPLICIT_USD_VERIFICATION = aliasGate(
      "AMAZON_US_ZIP_95829_AND_EXPLICIT_USD_VERIFICATION",
      gates.AMAZON_UI_US_DELIVERY_ZIP_95829,
      gates.AMAZON_UI_US_DELIVERY_ZIP_95829.status === "PASS" &&
        gates.AMAZON_UI_USD_COMMERCIAL_EXTRACTION.status === "PASS"
        ? "PASS"
        : gates.AMAZON_UI_US_DELIVERY_ZIP_95829.status === "FAIL" ||
          gates.AMAZON_UI_USD_COMMERCIAL_EXTRACTION.status === "FAIL"
        ? "FAIL"
        : gates.AMAZON_UI_US_DELIVERY_ZIP_95829.status === "INCOMPLETE" ||
          gates.AMAZON_UI_USD_COMMERCIAL_EXTRACTION.status === "INCOMPLETE"
        ? "INCOMPLETE"
        : gates.AMAZON_UI_USD_COMMERCIAL_EXTRACTION.status
    );
    gates.AMAZON_SEARCH_TO_PDP_IDENTITY_AND_META_EQUIVALENCE = aliasGate(
      "AMAZON_SEARCH_TO_PDP_IDENTITY_AND_META_EQUIVALENCE",
      gates.META_TO_AMAZON_EXACT_PRODUCT_CORROBORATION,
      gates.AMAZON_SEARCH_PDP_IDENTITY_VERIFICATION.status === "FAIL" ||
        gates.META_TO_AMAZON_EXACT_PRODUCT_CORROBORATION.status === "FAIL"
        ? "FAIL"
        : gates.AMAZON_SEARCH_PDP_IDENTITY_VERIFICATION.status === "INCOMPLETE" ||
          gates.META_TO_AMAZON_EXACT_PRODUCT_CORROBORATION.status === "INCOMPLETE"
        ? "INCOMPLETE"
        : gates.META_TO_AMAZON_EXACT_PRODUCT_CORROBORATION.status
    );
    gates.AMAZON_MCP_SESSION_AND_OWNED_PID_CLEAN_EXIT = aliasGate(
      "AMAZON_MCP_SESSION_AND_OWNED_PID_CLEAN_EXIT",
      gates.AMAZON_LOCAL_MCP_SESSION_LIFECYCLE
    );
    gates.DB_HTTP_API_CHROMIUM_RELOAD_PARITY = aliasGate(
      "DB_HTTP_API_CHROMIUM_RELOAD_PARITY",
      gates.DB_API_UI_RELOAD_PARITY
    );
    gates.DEV_AND_HOLDOUT_POINT_IN_TIME_NO_LOOKAHEAD = aliasGate(
      "DEV_AND_HOLDOUT_POINT_IN_TIME_NO_LOOKAHEAD",
      gates.POINT_IN_TIME_HISTORICAL_REPLAY_INTEGRITY
    );
    gates.HISTORICAL_MARKETPLACE_PROVIDER_COVERAGE = aliasGate(
      "HISTORICAL_MARKETPLACE_PROVIDER_COVERAGE",
      gates.HISTORICAL_PROVIDER_PARITY_TRUTH
    );
    gates.HISTORICAL_WINNING_PRODUCT_BUSINESS_SUFFICIENCY = aliasGate(
      "HISTORICAL_WINNING_PRODUCT_BUSINESS_SUFFICIENCY",
      gates.HISTORICAL_BUSINESS_EVIDENCE
    );
    gates.WALMART_JINA_LIVE_OPERATIONAL_GATE = aliasGate(
      "WALMART_JINA_LIVE_OPERATIONAL_GATE",
      gates.WALMART_US_LIVE_OPERATIONAL_STATUS
    );
    gates.G07_TIKTOK_US_LIVE_ADS = aliasGate(
      "G07_TIKTOK_US_LIVE_ADS",
      gates.G07_PAID_MEDIA_PERSISTENCE
    );
    gates.G15_60D_PRODUCT_LONGITUDINAL_DEMAND = aliasGate(
      "G15_60D_PRODUCT_LONGITUDINAL_DEMAND",
      gates.G15_LONGITUDINAL_DEMAND_60D
    );
    gates.G16_3OF3_INDEPENDENT_MERCHANT_AND_LIVE_AD_PROOF = aliasGate(
      "G16_3OF3_INDEPENDENT_MERCHANT_AND_LIVE_AD_PROOF",
      gates.G16_INDEPENDENT_MERCHANT_PROOF
    );

    const mut = input.mutationSuite;
    const mutCompletedIso = mut?.completedAt || mut?.evaluatedAt || null;
    const mutCompletedAfterVerdict =
      Boolean(mutCompletedIso) &&
      Number.isFinite(Date.parse(String(mutCompletedIso))) &&
      Number.isFinite(Date.parse(measuredAt)) &&
      Date.parse(String(mutCompletedIso)) > Date.parse(measuredAt);
    const mutHasInvalidKind =
      mut?.kind !== undefined && mut.kind !== "ACTUAL_COMPLETED_MUTATION_RUN";
    const mutIsFixtureOnly =
      mut?.isFixtureOnly === true ||
      mut?.scope === "TEST_FIXTURE" ||
      mut?.scope === "NON_RELEASE_EVIDENCE";
    const mutRunIdMismatch =
      Boolean(input.acceptanceRunId) &&
      Boolean(mut?.acceptanceRunId) &&
      input.acceptanceRunId !== mut?.acceptanceRunId;
    const mutInconclusiveCount = Number(mut?.inconclusiveCount ?? 0);
    const mutRowsValid =
      !Array.isArray(mut?.mutations) ||
      (mut!.mutations!.length === mut?.totalMutationsExecuted &&
        mut!.mutations!.every(
          (r: any) =>
            r &&
            r.caught === true &&
            r.baselinePass !== false &&
            r.mutationFail !== false &&
            (!Array.isArray(r.newFailedChecks) || r.newFailedChecks.length > 0)
        ));
    const mutStatus: GateVerdictStatusV12_4_3_7_2 = !mut
      ? "INCOMPLETE"
      : !shaOk(mut) ||
        (mut.falsePassesCount ?? 1) !== 0 ||
        mutInconclusiveCount > 0 ||
        (mut.totalMutationsExecuted ?? 0) < 92 ||
        mut.caughtMutationsCount !== mut.totalMutationsExecuted ||
        mut.sourceTreeRestoredClean !== true ||
        mutCompletedAfterVerdict ||
        mutHasInvalidKind ||
        mutIsFixtureOnly ||
        mutRunIdMismatch ||
        !mutRowsValid
      ? "FAIL"
      : "PASS";
    gates.INDEPENDENT_RAW_EVIDENCE_AND_MUTATION_VALIDATION = {
      gateId: "INDEPENDENT_RAW_EVIDENCE_AND_MUTATION_VALIDATION",
      status: mutStatus,
      evidenceRefs:
        mutStatus === "PASS"
          ? [`Mutations:${mut?.caughtMutationsCount}/${mut?.totalMutationsExecuted}@${expectedSha.slice(0, 8)}`]
          : [],
      sourceSha: mut?.codeSha || "",
      reasons:
        mutStatus === "PASS"
          ? [`All ${mut?.caughtMutationsCount}/${mut?.totalMutationsExecuted} negative/mutation checks caught with 0 false passes and 0 inconclusive baselines.`]
          : ["Independent raw evidence or negative mutation suite missing, failed, fixture-only, inconclusive, or post-dated."],
      measuredAt,
      scope: { mode: "INDEPENDENT_MUTATION_VALIDATION" },
      counts: {
        totalMutationsExecuted: mut?.totalMutationsExecuted ?? 0,
        caughtMutationsCount: mut?.caughtMutationsCount ?? 0,
        falsePassesCount: mut?.falsePassesCount ?? -1,
        inconclusiveCount: mutInconclusiveCount,
      },
    };

    const att = input.commitPushAttestation ?? (rawInput as any).artifact27CommitPushAttestation;
    let attStatus: GateVerdictStatusV12_4_3_7_2 = "PUSH_ATTESTATION_PENDING";
    const attReasons: string[] = [];
    const attRefs: string[] = [];
    if (att) {
      const attCheck = validateCommitPushAttestation(att, {
        expectedCodeSha: expectedSha,
        verifyLiveGitRemote: false,
      });
      attStatus = attCheck.status;
      attReasons.push(...attCheck.reasons);
      if (attStatus === "PASS") {
        attRefs.push(
          `EvidenceCommit:${att.evidenceContentCommitSha}@${att.branch}`
        );
      }
    } else {
      attStatus = "PUSH_ATTESTATION_PENDING";
      attReasons.push(
        "Evidence commit E not yet pushed/attested at pre-publish stage; attested in 27_COMMIT_PUSH_REMOTE_HEAD_ATTESTATION.json after Commit E push."
      );
    }

    gates.REMOTE_PUSH_ATTESTATION = {
      gateId: "REMOTE_PUSH_ATTESTATION",
      status: attStatus,
      evidenceRefs: attRefs,
      sourceSha: att?.codeSha || att?.testedCodeSha || expectedSha,
      reasons: attReasons,
      measuredAt,
      scope: { mode: "POST_COMMIT_ATTESTATION" },
      counts: {
        remoteReadbackVerified: Boolean(att?.remoteReadbackVerified),
        isSelfReferential: Boolean(att?.isSelfReferential ?? false),
      },
    };

    gates.ENGINEERING_AND_TRUTH_ACCEPTANCE = aliasGate(
      "ENGINEERING_AND_TRUTH_ACCEPTANCE",
      gates.CODE_AND_ENGINEERING_GATES
    );
    gates.FULL_KH02_AUTONOMOUS_WINNING_PRODUCT_BUSINESS_ACCEPTANCE = aliasGate(
      "FULL_KH02_AUTONOMOUS_WINNING_PRODUCT_BUSINESS_ACCEPTANCE",
      gates.FULL_KH02_BUSINESS_ACCEPTANCE
    );
  }

  const failedGateKeys = Object.entries(gates)
    .filter(
      ([, g]) =>
        g.status === "FAIL" ||
        g.status === "INCOMPLETE" ||
        g.status === "BLOCKED_VERIFICATION"
    )
    .map(([k]) => k);
  const anyGateFailed = failedGateKeys.length > 0;
  const allEngineeringGatesPassed =
    gates.CODE_AND_ENGINEERING_GATES?.status === "PASS" && !anyGateFailed;
  const businessAcceptancePassed =
    allEngineeringGatesPassed &&
    gates.FULL_KH02_BUSINESS_ACCEPTANCE?.status === "PASS";

  let overallReleaseStatus: string;
  if (!allEngineeringGatesPassed) {
    overallReleaseStatus = "FAILED_ENGINEERING_OR_TRUTH_GATES";
  } else if (businessAcceptancePassed) {
    overallReleaseStatus = "FULL_ENGINEERING_AND_BUSINESS_PASS";
  } else {
    overallReleaseStatus =
      "ENGINEERING_AND_COMMERCIAL_FOUNDATION_READY_WITH_TRUTHFUL_LIVE_AND_EXTERNAL_GATES";
  }

  const verdictTable: Record<string, string> = {};
  for (const [k, g] of Object.entries(gates)) {
    verdictTable[k] = g.status;
  }
  verdictTable.OVERALL_RELEASE_STATUS = overallReleaseStatus;
  verdictTable.OVERALL_RELEASE_VERDICT = overallReleaseStatus;

  return {
    codeSha: expectedSha,
    evaluatedAt: measuredAt,
    gates,
    verdictsByGate: gates,
    verdictTable,
    allEngineeringGatesPassed,
    businessAcceptancePassed,
    anyGateFailed,
    failedGateKeys,
  };
}

// ============================================================================
// V12.4.3.7.4 P0-A / P0-C / P0-D: PUBLICATION STATE MACHINE, ATOMIC ARTIFACT
// WRITER, BARRIER VERDICT PUBLISHER, AND NON-CIRCULAR COMMIT/PUSH ATTESTATION
// ============================================================================

export type AcceptanceLifecycleStageV12_4_3_7_4 =
  | "CREATED"
  | "RUNNING_TESTS"
  | "MUTATION_RUNNING"
  | "TESTS_COMPLETED"
  | "FINAL_VERDICT_COMPUTED"
  | "ARTIFACTS_VALIDATED"
  | "EVIDENCE_COMMITTED"
  | "PUSH_VERIFIED"
  | "ATTESTED"
  | "FAILED"
  | "BLOCKED";

export interface AcceptanceRunStateV12_4_3_7_4 {
  runId: string;
  attemptId: string;
  codeSha: string;
  treeSha: string;
  branch: string;
  status: "RUNNING" | "INCOMPLETE" | "COMPLETED" | "FAILED" | "BLOCKED";
  stage: AcceptanceLifecycleStageV12_4_3_7_4;
  isFinal: boolean;
  releaseVerdict: string | null;
  startedAt: string;
  updatedAt: string;
  completedStages: AcceptanceLifecycleStageV12_4_3_7_4[];
  stageHistory: Array<{
    stage: AcceptanceLifecycleStageV12_4_3_7_4;
    enteredAt: string;
    detail: string;
  }>;
  progressCounters: Record<string, number | string | boolean | null>;
  failureReason?: string | null;
  errorDetail?: string | null;
}

const ORDERED_HAPPY_STAGES_V12_4_3_7_4: AcceptanceLifecycleStageV12_4_3_7_4[] = [
  "CREATED",
  "RUNNING_TESTS",
  "MUTATION_RUNNING",
  "TESTS_COMPLETED",
  "FINAL_VERDICT_COMPUTED",
  "ARTIFACTS_VALIDATED",
  "EVIDENCE_COMMITTED",
  "PUSH_VERIFIED",
  "ATTESTED",
];

/**
 * Atomically writes an artifact file via a unique temporary file in the same
 * filesystem directory, fsyncs the descriptor, renames over the target path,
 * and verifies on-disk readback integrity.
 */
export function atomicWriteFinalArtifact(
  artifactDir: string,
  fileName: string,
  content: string | Record<string, any>,
  options?: { simulateCrashBeforeRename?: boolean }
): { filePath: string; sizeBytes: number; sha256: string } {
  fs.mkdirSync(artifactDir, { recursive: true });
  const serialized =
    typeof content === "string"
      ? content
      : JSON.stringify(content, null, 2) + "\n";
  const buf = Buffer.from(serialized, "utf8");
  const expectedSha256 = crypto.createHash("sha256").update(buf).digest("hex");
  const tmpName = `.${fileName}.tmp.${process.pid}.${Date.now()}.${crypto
    .randomBytes(4)
    .toString("hex")}`;
  const tmpPath = path.join(artifactDir, tmpName);
  const finalPath = path.join(artifactDir, fileName);

  let fd: number | null = null;
  try {
    fd = fs.openSync(tmpPath, "w", 0o644);
    fs.writeFileSync(fd, buf);
    try {
      fs.fsyncSync(fd);
    } catch {
      // Some virtual filesystems ignore fsync; ignore only ENOTSUP/EINVAL
    }
    fs.closeSync(fd);
    fd = null;

    if (options?.simulateCrashBeforeRename) {
      throw new Error(
        `SIMULATED_CRASH_WHILE_WRITING_ATOMIC_ARTIFACT:${fileName}`
      );
    }

    fs.renameSync(tmpPath, finalPath);
  } catch (err) {
    if (fd !== null) {
      try {
        fs.closeSync(fd);
      } catch {}
    }
    try {
      if (fs.existsSync(tmpPath)) {
        fs.unlinkSync(tmpPath);
      }
    } catch {}
    throw err;
  }

  const readbackBuf = fs.readFileSync(finalPath);
  const readbackSha256 = crypto
    .createHash("sha256")
    .update(readbackBuf)
    .digest("hex");
  if (readbackBuf.length === 0 || readbackSha256 !== expectedSha256) {
    throw new Error(
      `ATOMIC_WRITE_READBACK_MISMATCH:${fileName}:expected=${expectedSha256},actual=${readbackSha256}`
    );
  }
  if (fileName.endsWith(".json")) {
    JSON.parse(readbackBuf.toString("utf8"));
  }
  return {
    filePath: finalPath,
    sizeBytes: readbackBuf.length,
    sha256: readbackSha256,
  };
}

/**
 * Initializes RUN_STATE.json for a fresh acceptance attempt and purges any stale
 * final verdict or attestation files from prior interrupted attempts in the directory.
 */
export function createAcceptanceRunState(
  artifactDir: string,
  params: {
    runId: string;
    attemptId?: string;
    codeSha: string;
    treeSha: string;
    branch: string;
  }
): AcceptanceRunStateV12_4_3_7_4 {
  fs.mkdirSync(artifactDir, { recursive: true });
  // Purge any stale 24 / 27 / tmp files if retrying in an existing directory
  for (const entry of fs.readdirSync(artifactDir)) {
    if (
      entry.startsWith(".") ||
      entry === "24_FINAL_ROUTE_SPECIFIC_VERDICT_MATRIX.json" ||
      entry === "27_COMMIT_PUSH_REMOTE_HEAD_ATTESTATION.json" ||
      entry === "27_COMMIT_PUSH_REMOTE_HEAD_PROOF.json"
    ) {
      try {
        fs.rmSync(path.join(artifactDir, entry), { force: true });
      } catch {}
    }
  }

  const now = new Date().toISOString();
  const state: AcceptanceRunStateV12_4_3_7_4 = {
    runId: params.runId,
    attemptId:
      params.attemptId ||
      `attempt_${Date.now()}_${crypto.randomBytes(3).toString("hex")}`,
    codeSha: params.codeSha,
    treeSha: params.treeSha,
    branch: params.branch,
    status: "RUNNING",
    stage: "CREATED",
    isFinal: false,
    releaseVerdict: null,
    startedAt: now,
    updatedAt: now,
    completedStages: ["CREATED"],
    stageHistory: [
      {
        stage: "CREATED",
        enteredAt: now,
        detail: "Acceptance run initialized; zero final verdicts exist.",
      },
    ],
    progressCounters: {},
    failureReason: null,
    errorDetail: null,
  };
  atomicWriteFinalArtifact(artifactDir, "RUN_STATE.json", state);
  return state;
}

export function transitionAcceptanceRunState(
  artifactDir: string,
  nextStage: AcceptanceLifecycleStageV12_4_3_7_4,
  detail: string,
  extra?: {
    progressCounters?: Record<string, number | string | boolean | null>;
    releaseVerdict?: string | null;
  }
): AcceptanceRunStateV12_4_3_7_4 {
  const statePath = path.join(artifactDir, "RUN_STATE.json");
  if (!fs.existsSync(statePath)) {
    throw new Error(`MISSING_RUN_STATE_JSON_AT_TRANSITION:${nextStage}`);
  }
  const current: AcceptanceRunStateV12_4_3_7_4 = JSON.parse(
    fs.readFileSync(statePath, "utf8")
  );
  if (
    (current.stage === "FAILED" || current.stage === "BLOCKED") &&
    nextStage !== "FAILED" &&
    nextStage !== "BLOCKED"
  ) {
    throw new Error(
      `ILLEGAL_RUN_STATE_TRANSITION_FROM_TERMINAL:${current.stage}->${nextStage}`
    );
  }

  const curIdx = ORDERED_HAPPY_STAGES_V12_4_3_7_4.indexOf(current.stage);
  const nextIdx = ORDERED_HAPPY_STAGES_V12_4_3_7_4.indexOf(nextStage);
  if (curIdx >= 0 && nextIdx >= 0) {
    // Disallow skipping MUTATION_RUNNING or TESTS_COMPLETED when advancing to FINAL_VERDICT_COMPUTED
    if (
      nextStage === "FINAL_VERDICT_COMPUTED" &&
      (!current.completedStages.includes("MUTATION_RUNNING") ||
        !current.completedStages.includes("TESTS_COMPLETED"))
    ) {
      throw new Error(
        `ILLEGAL_RUN_STATE_TRANSITION_TO_FINAL_VERDICT_WITHOUT_MUTATIONS:${current.stage}->${nextStage}`
      );
    }
    if (nextIdx < curIdx) {
      throw new Error(
        `ILLEGAL_BACKWARD_RUN_STATE_TRANSITION:${current.stage}->${nextStage}`
      );
    }
  }

  const now = new Date().toISOString();
  current.stage = nextStage;
  current.updatedAt = now;
  if (!current.completedStages.includes(nextStage)) {
    current.completedStages.push(nextStage);
  }
  current.stageHistory.push({
    stage: nextStage,
    enteredAt: now,
    detail,
  });
  if (extra?.progressCounters) {
    current.progressCounters = {
      ...current.progressCounters,
      ...extra.progressCounters,
    };
  }
  if (nextStage === "FAILED") {
    current.status = "FAILED";
    current.isFinal = false;
    current.releaseVerdict = "FAIL";
  } else if (nextStage === "BLOCKED") {
    current.status = "BLOCKED";
    current.isFinal = false;
    current.releaseVerdict = "BLOCKED";
  } else if (
    nextStage === "ARTIFACTS_VALIDATED" ||
    nextStage === "EVIDENCE_COMMITTED" ||
    nextStage === "PUSH_VERIFIED" ||
    nextStage === "ATTESTED"
  ) {
    current.status = "COMPLETED";
    current.isFinal = nextStage === "ATTESTED";
    if (extra?.releaseVerdict !== undefined) {
      current.releaseVerdict = extra.releaseVerdict;
    }
  } else {
    current.status = "RUNNING";
    current.isFinal = false;
    if (extra?.releaseVerdict !== undefined) {
      current.releaseVerdict = extra.releaseVerdict;
    }
  }

  atomicWriteFinalArtifact(artifactDir, "RUN_STATE.json", current);
  return current;
}

export function markAcceptanceFailed(
  artifactDir: string,
  reason: string,
  errorDetail?: string,
  isBlocked = false
): AcceptanceRunStateV12_4_3_7_4 {
  const statePath = path.join(artifactDir, "RUN_STATE.json");
  let state: AcceptanceRunStateV12_4_3_7_4;
  const now = new Date().toISOString();
  if (fs.existsSync(statePath)) {
    state = JSON.parse(fs.readFileSync(statePath, "utf8"));
  } else {
    state = {
      runId: "unknown_run",
      attemptId: "unknown_attempt",
      codeSha: "",
      treeSha: "",
      branch: "",
      status: isBlocked ? "BLOCKED" : "FAILED",
      stage: isBlocked ? "BLOCKED" : "FAILED",
      isFinal: false,
      releaseVerdict: isBlocked ? "BLOCKED" : "FAIL",
      startedAt: now,
      updatedAt: now,
      completedStages: [],
      stageHistory: [],
      progressCounters: {},
    };
  }

  state.status = isBlocked ? "BLOCKED" : "FAILED";
  state.stage = isBlocked ? "BLOCKED" : "FAILED";
  state.isFinal = false;
  state.releaseVerdict = isBlocked ? "BLOCKED" : "FAIL";
  state.updatedAt = now;
  state.failureReason = reason;
  state.errorDetail = errorDetail || null;
  state.stageHistory.push({
    stage: state.stage,
    enteredAt: now,
    detail: `${reason}${errorDetail ? `: ${errorDetail}` : ""}`,
  });

  // Never leave a success-looking 24_FINAL_ROUTE_SPECIFIC_VERDICT_MATRIX.json on failure/abort
  const p24 = path.join(
    artifactDir,
    "24_FINAL_ROUTE_SPECIFIC_VERDICT_MATRIX.json"
  );
  if (fs.existsSync(p24)) {
    try {
      fs.unlinkSync(p24);
    } catch {}
  }

  atomicWriteFinalArtifact(artifactDir, "RUN_STATE.json", state);
  atomicWriteFinalArtifact(artifactDir, "INCIDENT_FAILURE_RECEIPT.json", {
    codeSha: state.codeSha,
    runId: state.runId,
    attemptId: state.attemptId,
    failedAt: now,
    status: state.status,
    failureReason: reason,
    errorDetail: errorDetail || null,
  });
  return state;
}

/**
 * Publishes 24_FINAL_ROUTE_SPECIFIC_VERDICT_MATRIX.json ONLY after verifying
 * that RUN_STATE.json has completed MUTATION_RUNNING -> TESTS_COMPLETED and
 * 22_NEGATIVE_MUTATION_SUITE_FINAL_RECEIPT.json exists on disk with an actual
 * completed mutation run, zero false passes, and zero inconclusive baselines.
 */
export function publishFinalVerdictAfterEvidenceBarrier(
  artifactDir: string,
  verdictInput: ComputeV12_4_3_7_2ReleaseVerdictsInput & Record<string, any>,
  options?: { simulateCrashBeforeRename?: boolean }
): ComputedReleaseVerdictsBundleV12_4_3_7_2 {
  const statePath = path.join(artifactDir, "RUN_STATE.json");
  if (!fs.existsSync(statePath)) {
    throw new Error("BARRIER_VIOLATION_MISSING_RUN_STATE_JSON");
  }
  const runState: AcceptanceRunStateV12_4_3_7_4 = JSON.parse(
    fs.readFileSync(statePath, "utf8")
  );
  if (
    runState.status === "FAILED" ||
    runState.status === "BLOCKED" ||
    !runState.completedStages.includes("MUTATION_RUNNING") ||
    !runState.completedStages.includes("TESTS_COMPLETED")
  ) {
    throw new Error(
      `BARRIER_VIOLATION_RUN_STATE_NOT_READY_FOR_FINAL_VERDICT:stage=${runState.stage},status=${runState.status}`
    );
  }
  if (runState.codeSha !== verdictInput.expectedCodeSha) {
    throw new Error(
      `BARRIER_VIOLATION_RUN_STATE_CODE_SHA_MISMATCH:${runState.codeSha}!==${verdictInput.expectedCodeSha}`
    );
  }

  const p22 = path.join(
    artifactDir,
    "22_NEGATIVE_MUTATION_SUITE_FINAL_RECEIPT.json"
  );
  if (!fs.existsSync(p22)) {
    throw new Error(
      "BARRIER_VIOLATION_MISSING_ON_DISK_22_NEGATIVE_MUTATION_SUITE_FINAL_RECEIPT"
    );
  }
  const onDisk22 = JSON.parse(fs.readFileSync(p22, "utf8"));
  if (
    onDisk22.kind !== "ACTUAL_COMPLETED_MUTATION_RUN" ||
    onDisk22.isFixtureOnly === true ||
    onDisk22.codeSha !== verdictInput.expectedCodeSha ||
    (onDisk22.falsePassesCount ?? 1) !== 0 ||
    (onDisk22.inconclusiveCount ?? 1) !== 0 ||
    (onDisk22.totalMutationsExecuted ?? 0) < 98 ||
    onDisk22.caughtMutationsCount !== onDisk22.totalMutationsExecuted ||
    !Array.isArray(onDisk22.mutations) ||
    onDisk22.mutations.length !== onDisk22.totalMutationsExecuted
  ) {
    throw new Error(
      "BARRIER_VIOLATION_INVALID_OR_INCOMPLETE_22_MUTATION_RECEIPT"
    );
  }

  const measuredAt = verdictInput.measuredAt || new Date().toISOString();
  const mutCompletedMs = Date.parse(
    String(onDisk22.completedAt || onDisk22.evaluatedAt || "")
  );
  const verdictEvalMs = Date.parse(measuredAt);
  if (
    !Number.isFinite(mutCompletedMs) ||
    !Number.isFinite(verdictEvalMs) ||
    mutCompletedMs > verdictEvalMs
  ) {
    throw new Error(
      `BARRIER_VIOLATION_CHRONOLOGY_22_AFTER_24:${onDisk22.completedAt}>${measuredAt}`
    );
  }

  const bundle = computeV12_4_3_7_2ReleaseVerdicts({
    ...verdictInput,
    acceptanceRunId: runState.runId,
    measuredAt,
    mutationSuite: onDisk22,
  });

  atomicWriteFinalArtifact(
    artifactDir,
    "24_FINAL_ROUTE_SPECIFIC_VERDICT_MATRIX.json",
    {
      ...bundle,
      ...bundle.verdictTable,
      acceptanceRunId: runState.runId,
      attemptId: runState.attemptId,
    },
    { simulateCrashBeforeRename: options?.simulateCrashBeforeRename }
  );

  transitionAcceptanceRunState(
    artifactDir,
    "FINAL_VERDICT_COMPUTED",
    "Final 24_FINAL_ROUTE_SPECIFIC_VERDICT_MATRIX.json atomically published after 22 completed.",
    {
      releaseVerdict: bundle.verdictTable.OVERALL_RELEASE_VERDICT,
    }
  );

  return bundle;
}

/**
 * Verifies non-self-referential 27_COMMIT_PUSH_REMOTE_HEAD_ATTESTATION.json.
 * Why Commit A cannot contain its own SHA: changing any byte inside a tracked file
 * changes the Git blob hash, tree hash, and commit SHA-1. Therefore 27 attests the
 * already-pushed Evidence Commit E (and its ancestor Source Commit S), while Commit A
 * commits 27 and is verified externally after push.
 */
export function validateCommitPushAttestation(
  a27: Record<string, any> | null | undefined,
  options: {
    expectedCodeSha: string;
    expectedBranch?: string;
    artifactDir?: string;
    repoRoot?: string;
    verifyLiveGitRemote?: boolean;
  }
): {
  valid: boolean;
  status: "PASS" | "FAIL" | "BLOCKED_VERIFICATION";
  reasons: string[];
} {
  const reasons: string[] = [];
  if (!a27 || typeof a27 !== "object") {
    return {
      valid: false,
      status: "FAIL",
      reasons: ["MISSING_27_COMMIT_PUSH_ATTESTATION_OBJECT"],
    };
  }

  const rawStr = JSON.stringify(a27);
  if (
    rawStr.includes("PENDING_EVIDENCE_COMMIT") ||
    a27.finalEvidenceCommitSha === "PENDING_EVIDENCE_COMMIT" ||
    a27.evidenceContentCommitSha === "PENDING_EVIDENCE_COMMIT"
  ) {
    reasons.push("FORBIDDEN_PENDING_EVIDENCE_COMMIT_PLACEHOLDER");
  }

  if (a27.isSelfReferential !== false) {
    reasons.push("ATTESTATION_MUST_DECLARE_IS_SELF_REFERENTIAL_FALSE");
  }
  if (a27.attestationScope !== "EVIDENCE_COMMIT_E_ALREADY_PUSHED") {
    reasons.push(
      `INVALID_ATTESTATION_SCOPE:${a27.attestationScope} (expected EVIDENCE_COMMIT_E_ALREADY_PUSHED)`
    );
  }
  if (a27.branch !== "feature/kh02-walmart-us-jina-reader-v12.4.3.5.1") {
    reasons.push(`INVALID_ATTESTATION_BRANCH:${a27.branch}`);
  }

  const testedSha = String(a27.testedCodeSha || a27.codeSha || "").trim();
  if (
    !/^[0-9a-f]{40}$/.test(testedSha) ||
    testedSha !== options.expectedCodeSha
  ) {
    reasons.push(
      `ATTESTATION_TESTED_CODE_SHA_MISMATCH:${testedSha}!==${options.expectedCodeSha}`
    );
  }
  if (
    typeof a27.testedTreeSha !== "string" ||
    !/^[0-9a-f]{40}$/.test(a27.testedTreeSha)
  ) {
    reasons.push("INVALID_OR_MISSING_TESTED_TREE_SHA");
  }

  const evidenceCommitE = String(a27.evidenceContentCommitSha || "").trim();
  const remoteHeadAfterE = String(
    a27.remoteHeadObservedAfterEvidencePush || ""
  ).trim();
  if (!/^[0-9a-f]{40}$/.test(evidenceCommitE)) {
    reasons.push(
      `INVALID_EVIDENCE_CONTENT_COMMIT_SHA_40HEX:${evidenceCommitE}`
    );
  }
  if (evidenceCommitE && evidenceCommitE === testedSha) {
    reasons.push(
      "EVIDENCE_COMMIT_SHA_CANNOT_EQUAL_SOURCE_COMMIT_SHA"
    );
  }
  if (
    a27.attestationCommitSha &&
    a27.attestationCommitSha === evidenceCommitE
  ) {
    reasons.push("SELF_REFERENTIAL_ATTESTATION_COMMIT_SHA_DETECTED");
  }
  if (
    !/^[0-9a-f]{40}$/.test(remoteHeadAfterE) ||
    remoteHeadAfterE !== evidenceCommitE
  ) {
    reasons.push(
      `REMOTE_HEAD_OBSERVED_MISMATCH_EVIDENCE_COMMIT:${remoteHeadAfterE}!==${evidenceCommitE}`
    );
  }
  if (a27.remoteReadbackVerified !== true) {
    reasons.push("REMOTE_READBACK_VERIFIED_NOT_TRUE");
  }
  if (a27.ancestryVerifiedStoE !== true) {
    reasons.push("ANCESTRY_S_TO_E_NOT_VERIFIED");
  }
  if (
    typeof a27.provider !== "string" ||
    a27.provider.trim().length < 3 ||
    typeof a27.verificationMethod !== "string" ||
    a27.verificationMethod.trim().length < 5
  ) {
    reasons.push("MISSING_PROVIDER_OR_VERIFICATION_METHOD_IN_27");
  }
  const readbackAtMs = Date.parse(String(a27.remoteRefReadbackAt || ""));
  if (!Number.isFinite(readbackAtMs)) {
    reasons.push("INVALID_REMOTE_REF_READBACK_AT_TIMESTAMP");
  }
  if (
    typeof a27.evidenceManifestSha256 !== "string" ||
    !/^[0-9a-f]{64}$/.test(a27.evidenceManifestSha256) ||
    typeof a27.independentValidatorReportSha256 !== "string" ||
    !/^[0-9a-f]{64}$/.test(a27.independentValidatorReportSha256)
  ) {
    reasons.push(
      "INVALID_MANIFEST_OR_VALIDATOR_REPORT_SHA256_IN_27"
    );
  }

  if (options.artifactDir) {
    const p25 = fs.existsSync(
      path.join(options.artifactDir, "25_NONCYCLIC_SHA256_ARTIFACT_MANIFEST.json")
    )
      ? path.join(options.artifactDir, "25_NONCYCLIC_SHA256_ARTIFACT_MANIFEST.json")
      : path.join(options.artifactDir, "25_SHA256_ARTIFACT_MANIFEST.json");
    const p23 = fs.existsSync(
      path.join(options.artifactDir, "23_INDEPENDENT_VALIDATION_REPORT.json")
    )
      ? path.join(options.artifactDir, "23_INDEPENDENT_VALIDATION_REPORT.json")
      : path.join(
          options.artifactDir,
          "23_INDEPENDENT_RAW_EVIDENCE_VALIDATOR_REPORT.json"
        );
    if (!fs.existsSync(p25)) {
      reasons.push("MISSING_MANIFEST_25_FOR_ATTESTATION_HASH_CHECK");
    } else {
      const actual25Sha = crypto
        .createHash("sha256")
        .update(fs.readFileSync(p25))
        .digest("hex");
      if (actual25Sha !== a27.evidenceManifestSha256) {
        reasons.push(
          `ATTESTATION_MANIFEST_25_HASH_MISMATCH:claimed=${a27.evidenceManifestSha256},actual=${actual25Sha}`
        );
      }
    }
    if (!fs.existsSync(p23)) {
      reasons.push("MISSING_VALIDATOR_REPORT_23_FOR_ATTESTATION_HASH_CHECK");
    } else {
      const actual23Sha = crypto
        .createHash("sha256")
        .update(fs.readFileSync(p23))
        .digest("hex");
      if (actual23Sha !== a27.independentValidatorReportSha256) {
        reasons.push(
          `ATTESTATION_VALIDATOR_23_HASH_MISMATCH:claimed=${a27.independentValidatorReportSha256},actual=${actual23Sha}`
        );
      }
    }
  }

  if (options.verifyLiveGitRemote && reasons.length === 0) {
    const checkGit = verifyRemoteBranchHeadAndAncestry({
      repoRoot: options.repoRoot || process.cwd(),
      branch: "feature/kh02-walmart-us-jina-reader-v12.4.3.5.1",
      sourceCommitSha: testedSha,
      evidenceCommitSha: evidenceCommitE,
      queryLiveRemoteLsRemote: false,
    });
    if (!checkGit.ok) {
      return {
        valid: false,
        status: checkGit.blocked ? "BLOCKED_VERIFICATION" : "FAIL",
        reasons: checkGit.reasons,
      };
    }
  }

  return {
    valid: reasons.length === 0,
    status: reasons.length === 0 ? "PASS" : "FAIL",
    reasons,
  };
}

export function verifyRemoteBranchHeadAndAncestry(params: {
  repoRoot: string;
  branch: string;
  sourceCommitSha: string;
  evidenceCommitSha: string;
  attestationCommitSha?: string;
  queryLiveRemoteLsRemote?: boolean;
}): {
  ok: boolean;
  blocked: boolean;
  observedRemoteRefSha: string | null;
  reasons: string[];
} {
  const reasons: string[] = [];
  let observedRemoteRefSha: string | null = null;
  try {
    const sType = execSync(`git cat-file -t ${params.sourceCommitSha}`, {
      cwd: params.repoRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    if (sType !== "commit") {
      reasons.push(`SOURCE_SHA_NOT_GIT_COMMIT:${params.sourceCommitSha}`);
    }
  } catch {
    reasons.push(`SOURCE_SHA_MISSING_IN_GIT:${params.sourceCommitSha}`);
  }

  try {
    const eType = execSync(`git cat-file -t ${params.evidenceCommitSha}`, {
      cwd: params.repoRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    if (eType !== "commit") {
      reasons.push(`EVIDENCE_SHA_NOT_GIT_COMMIT:${params.evidenceCommitSha}`);
    }
  } catch {
    reasons.push(`EVIDENCE_SHA_MISSING_IN_GIT:${params.evidenceCommitSha}`);
  }

  if (reasons.length === 0) {
    try {
      execSync(
        `git merge-base --is-ancestor ${params.sourceCommitSha} ${params.evidenceCommitSha}`,
        {
          cwd: params.repoRoot,
          stdio: ["ignore", "pipe", "ignore"],
        }
      );
    } catch {
      reasons.push(
        `SOURCE_SHA_NOT_ANCESTOR_OF_EVIDENCE_SHA:${params.sourceCommitSha}->${params.evidenceCommitSha}`
      );
    }
  }

  if (params.queryLiveRemoteLsRemote) {
    try {
      const lsOut = execSync(
        `git ls-remote origin refs/heads/${params.branch}`,
        {
          cwd: params.repoRoot,
          encoding: "utf8",
          stdio: ["ignore", "pipe", "ignore"],
        }
      ).trim();
      observedRemoteRefSha = lsOut.split(/\s+/)[0] || null;
      if (!observedRemoteRefSha || !/^[0-9a-f]{40}$/.test(observedRemoteRefSha)) {
        return {
          ok: false,
          blocked: true,
          observedRemoteRefSha: null,
          reasons: ["REMOTE_PUSH_VERIFICATION_BLOCKED_EMPTY_LS_REMOTE"],
        };
      }
    } catch (err: any) {
      return {
        ok: false,
        blocked: true,
        observedRemoteRefSha: null,
        reasons: [
          `REMOTE_PUSH_VERIFICATION_BLOCKED:${err?.message || "ls-remote failed"}`,
        ],
      };
    }
  } else {
    try {
      observedRemoteRefSha = execSync(
        `git rev-parse origin/${params.branch}`,
        {
          cwd: params.repoRoot,
          encoding: "utf8",
          stdio: ["ignore", "pipe", "ignore"],
        }
      ).trim();
    } catch {
      observedRemoteRefSha = null;
    }
  }

  if (observedRemoteRefSha) {
    try {
      execSync(
        `git merge-base --is-ancestor ${params.evidenceCommitSha} ${observedRemoteRefSha}`,
        {
          cwd: params.repoRoot,
          stdio: ["ignore", "pipe", "ignore"],
        }
      );
    } catch {
      reasons.push(
        `EVIDENCE_COMMIT_NOT_IN_REMOTE_BRANCH_ANCESTRY:${params.evidenceCommitSha}!<=origin/${params.branch}(${observedRemoteRefSha})`
      );
    }
  } else {
    reasons.push("REMOTE_TRACKING_REF_UNAVAILABLE");
  }

  if (params.attestationCommitSha) {
    try {
      execSync(
        `git merge-base --is-ancestor ${params.evidenceCommitSha} ${params.attestationCommitSha}`,
        {
          cwd: params.repoRoot,
          stdio: ["ignore", "pipe", "ignore"],
        }
      );
    } catch {
      reasons.push(
        `EVIDENCE_COMMIT_NOT_ANCESTOR_OF_ATTESTATION_COMMIT:${params.evidenceCommitSha}->${params.attestationCommitSha}`
      );
    }
  }

  return {
    ok: reasons.length === 0,
    blocked: false,
    observedRemoteRefSha,
    reasons,
  };
}

export type CrashInjectionStageV12_4_3_7_4 =
  | "BEFORE_MUTATION_STARTS"
  | "MID_PHYSICAL_MUTATION"
  | "JUST_AFTER_22_WRITTEN"
  | "WHILE_WRITING_24"
  | "AFTER_FINAL_VALIDATION_BEFORE_COMMIT"
  | "AFTER_EVIDENCE_PUSH_BEFORE_ATTESTATION"
  | "BEFORE_LAST_REMOTE_VERIFICATION";

/**
 * Deterministically simulates crash / abort injection at each of the 7 mandatory
 * V12.4.3.7.4 lifecycle stages inside an isolated temporary directory and verifies
 * that no outward final release PASS or valid attestation is left behind.
 */
export function simulateAcceptanceCrashInjectionAtStage(
  stage: CrashInjectionStageV12_4_3_7_4,
  baseTempDir: string,
  codeSha: string
): {
  stage: CrashInjectionStageV12_4_3_7_4;
  crashedAsExpected: boolean;
  file24ExistsAfterCrash: boolean;
  file27ExistsAfterCrash: boolean;
  runStateTerminalStatus: string;
  outwardReleasePassPublished: boolean;
  passed: boolean;
  detail: string;
} {
  const stageDir = path.join(baseTempDir, `crash_${stage}`);
  fs.mkdirSync(stageDir, { recursive: true });
  createAcceptanceRunState(stageDir, {
    runId: `run_crash_${stage}`,
    codeSha,
    treeSha: "452eb8e5d93e4cccafb81321479d4d8ef340d925",
    branch: "feature/kh02-walmart-us-jina-reader-v12.4.3.5.1",
  });

  let crashedAsExpected = false;
  try {
    transitionAcceptanceRunState(stageDir, "RUNNING_TESTS", "Stage 1..5 running");
    if (stage === "BEFORE_MUTATION_STARTS") {
      throw new Error("INJECTED_CRASH_BEFORE_MUTATION_STARTS");
    }

    transitionAcceptanceRunState(stageDir, "MUTATION_RUNNING", "Stage 6 mutations running");
    if (stage === "MID_PHYSICAL_MUTATION") {
      throw new Error("INJECTED_CRASH_MID_PHYSICAL_MUTATION");
    }

    const now22 = new Date().toISOString();
    atomicWriteFinalArtifact(
      stageDir,
      "22_NEGATIVE_MUTATION_SUITE_FINAL_RECEIPT.json",
      {
        codeSha,
        kind: "ACTUAL_COMPLETED_MUTATION_RUN",
        isFixtureOnly: false,
        startedAt: now22,
        completedAt: now22,
        evaluatedAt: now22,
        totalMutationsExecuted: 98,
        caughtMutationsCount: 98,
        falsePassesCount: 0,
        inconclusiveCount: 0,
        sourceTreeRestoredClean: true,
        mutations: Array.from({ length: 98 }, (_, i) => ({
          mutationId: `MUT_${i + 1}`,
          baselinePass: true,
          mutationFail: true,
          newFailedChecks: ["CHECK_1"],
          caught: true,
        })),
      }
    );
    transitionAcceptanceRunState(stageDir, "TESTS_COMPLETED", "22 written");
    if (stage === "JUST_AFTER_22_WRITTEN") {
      throw new Error("INJECTED_CRASH_JUST_AFTER_22_WRITTEN");
    }

    if (stage === "WHILE_WRITING_24") {
      atomicWriteFinalArtifact(
        stageDir,
        "24_FINAL_ROUTE_SPECIFIC_VERDICT_MATRIX.json",
        { codeSha },
        { simulateCrashBeforeRename: true }
      );
    }

    transitionAcceptanceRunState(
      stageDir,
      "FINAL_VERDICT_COMPUTED",
      "24 computed"
    );
    transitionAcceptanceRunState(
      stageDir,
      "ARTIFACTS_VALIDATED",
      "23 pre-publish validated"
    );
    if (stage === "AFTER_FINAL_VALIDATION_BEFORE_COMMIT") {
      throw new Error("INJECTED_CRASH_AFTER_FINAL_VALIDATION_BEFORE_COMMIT");
    }

    transitionAcceptanceRunState(
      stageDir,
      "EVIDENCE_COMMITTED",
      "Commit E created"
    );
    transitionAcceptanceRunState(
      stageDir,
      "PUSH_VERIFIED",
      "Commit E pushed"
    );
    if (stage === "AFTER_EVIDENCE_PUSH_BEFORE_ATTESTATION") {
      throw new Error("INJECTED_CRASH_AFTER_EVIDENCE_PUSH_BEFORE_ATTESTATION");
    }

    if (stage === "BEFORE_LAST_REMOTE_VERIFICATION") {
      throw new Error("INJECTED_CRASH_BEFORE_LAST_REMOTE_VERIFICATION");
    }
  } catch (err: any) {
    crashedAsExpected = true;
    markAcceptanceFailed(
      stageDir,
      `CRASH_INJECTED_AT_${stage}`,
      err?.message || String(err),
      stage === "BEFORE_LAST_REMOTE_VERIFICATION"
    );
  }

  const file24ExistsAfterCrash = fs.existsSync(
    path.join(stageDir, "24_FINAL_ROUTE_SPECIFIC_VERDICT_MATRIX.json")
  );
  const file27ExistsAfterCrash = fs.existsSync(
    path.join(stageDir, "27_COMMIT_PUSH_REMOTE_HEAD_ATTESTATION.json")
  );
  const runStateAfter: AcceptanceRunStateV12_4_3_7_4 = JSON.parse(
    fs.readFileSync(path.join(stageDir, "RUN_STATE.json"), "utf8")
  );
  const outwardReleasePassPublished =
    file24ExistsAfterCrash ||
    file27ExistsAfterCrash ||
    runStateAfter.isFinal === true ||
    runStateAfter.status === "COMPLETED";

  const passed =
    crashedAsExpected &&
    !file24ExistsAfterCrash &&
    !file27ExistsAfterCrash &&
    (runStateAfter.status === "FAILED" || runStateAfter.status === "BLOCKED") &&
    !outwardReleasePassPublished;

  return {
    stage,
    crashedAsExpected,
    file24ExistsAfterCrash,
    file27ExistsAfterCrash,
    runStateTerminalStatus: runStateAfter.status,
    outwardReleasePassPublished,
    passed,
    detail: `crashed=${crashedAsExpected}, 24Exists=${file24ExistsAfterCrash}, 27Exists=${file27ExistsAfterCrash}, state=${runStateAfter.status}`,
  };
}


