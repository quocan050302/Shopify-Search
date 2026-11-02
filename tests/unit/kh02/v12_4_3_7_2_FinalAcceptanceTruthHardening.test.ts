import { describe, expect, it } from "vitest";
import {
  verifyLiveMetaObservationProvenance,
  verifyCandidateLiveLineageChain,
  type DiscoveredProductCandidate,
} from "../../../src/services/kh02/identity/productCandidateDiscovery";
import {
  buildAmazonUiPhaseContextProof,
  validateAmazonUiContextProofConsistency,
} from "../../../src/services/kh02/marketplace/amazonUsMcpTransport";
import {
  computeV12_4_3_7_2ReleaseVerdicts,
  STANDALONE_SERVER_OR_BROWSER_E2E_FILES,
  type ComputeV12_4_3_7_2ReleaseVerdictsInput,
} from "../../../scripts/kh02/acceptanceTruth";

const VALID_SHA = "abc78cb97b627c49849db389e6920e19c46c58ae";

function makeValidLiveObservation(overrides: Record<string, any> = {}): Record<string, any> {
  return {
    source: "META_ADS",
    sourceType: "LIVE_PROVIDER",
    provenance: "LIVE_PROVIDER",
    isLiveRecord: true,
    isCached: false,
    fromCache: false,
    sourceRecordId: "db-ad-9001",
    persistedAdId: "db-ad-9001",
    upstreamAdId: "meta-ext-9001",
    sourceExternalAdId: "meta-ext-9001",
    sourceObservationId: "sobs_db-ad-9001",
    queryId: "meta-sq-1",
    matchedQueryIds: ["meta-sq-1"],
    providerRequestId: "meta_req_run-live-1_meta-sq-1",
    researchRunId: "run-live-1",
    workspaceId: "ws-pet-live-1",
    observedAt: "2026-10-20T10:00:00.000Z",
    sourceTimestamp: "2026-10-20T10:00:00.000Z",
    storeDomainEvidence: "petlibro.com",
    landingPageUrl: "https://petlibro.com/products/capsule-dog-water-fountain",
    ...overrides,
  };
}

function makeValidCandidate(
  obs: Record<string, any>,
  overrides: Partial<DiscoveredProductCandidate> = {}
): DiscoveredProductCandidate {
  return {
    candidateId: "cand-petlibro-001",
    researchProductId: "rp-petlibro-001",
    title: "PETLIBRO Capsule Automatic Pet Water Fountain",
    normalizedTitle: "petlibro capsule automatic pet water fountain",
    brand: "PETLIBRO",
    model: "PLWF005",
    storeDomain: "petlibro.com",
    canonicalProductUrl: "https://petlibro.com/products/capsule-dog-water-fountain",
    productKey: "petlibro.com::capsule-dog-water-fountain",
    familyKey: "petlibro-water-fountain",
    identityStatus: "VERIFIED",
    productRealityStatus: "VERIFIED_PHYSICAL_PRODUCT",
    relevanceStatus: "RELEVANT",
    matchedQueryIds: [obs.queryId || "meta-sq-1"],
    supportingExternalAdIds: [obs.upstreamAdId || "meta-ext-9001"],
    liveObservationsCount: 1,
    cachedObservationsCount: 0,
    sourceObservations: [obs as any],
    ...overrides,
  } as DiscoveredProductCandidate;
}

function makeValidHomeAndLocationReadback(overrides: Record<string, any> = {}) {
  return {
    attempted: true,
    status: "US_DISPLAYED_CONTEXT_VERIFIED",
    sessionId: "amz-sess-001",
    ownedChildPid: 43210,
    searchBoxReady: true,
    deliveryLinkVisible: true,
    homepageReady: true,
    locationDialogOpened: true,
    zipFieldVisible: true,
    applyClicked: true,
    confirmationHandled: true,
    initialDeliveryText: "Deliver to Vietnam",
    initialObservedZip: null,
    initialExplicitCurrency: "VND",
    initialExplicitCurrencySource: "DOM:#icp-touch-link-cop",
    requestedPostalCode: "95829",
    observedDeliveryLocationText: "Deliver to Sacramento 95829",
    observedDeliveryPostalCode: "95829",
    observedCurrency: "USD",
    explicitCurrencySource: "DOM:input[name=currencyOfPreference]",
    usDeliveryVerified: true,
    searchPageZip: "95829",
    searchPageExplicitCurrency: "USD",
    pdpPageZip: "95829",
    pdpExplicitCurrency: "USD",
    homeSnapshotHash: "hash_home_001",
    searchSnapshotHash: "hash_search_001",
    pdpSnapshotHash: "hash_pdp_001",
    searchReadbackObservedAt: "2026-11-02T10:00:10.000Z",
    pdpReadbackObservedAt: "2026-11-02T10:00:15.000Z",
    uiActionLedger: [
      {
        step: "WAIT_SEARCH_BOX_READY",
        toolName: "browser_wait_for",
        invokedAt: "2026-11-02T10:00:00.000Z",
        completedAt: "2026-11-02T10:00:01.000Z",
        snapshotHash: "hash_home_001",
      },
      {
        step: "READ_INITIAL_CONTEXT",
        toolName: "browser_evaluate",
        invokedAt: "2026-11-02T10:00:01.000Z",
        completedAt: "2026-11-02T10:00:02.000Z",
        snapshotHash: "hash_home_001",
      },
      {
        step: "OPEN_LOCATION_POPOVER_AND_APPLY_ZIP",
        toolName: "browser_evaluate",
        invokedAt: "2026-11-02T10:00:02.000Z",
        completedAt: "2026-11-02T10:00:04.000Z",
        snapshotHash: "hash_modal_001",
      },
      {
        step: "REFRESH_AND_READBACK_AFTER_APPLY",
        toolName: "browser_evaluate",
        invokedAt: "2026-11-02T10:00:04.000Z",
        completedAt: "2026-11-02T10:00:06.000Z",
        snapshotHash: "hash_home_after_001",
      },
    ],
    ...overrides,
  };
}

function makeBaseValidVerdictInput(): ComputeV12_4_3_7_2ReleaseVerdictsInput {
  const hr = makeValidHomeAndLocationReadback();
  const pdpCandidate = {
    candidateId: "cand-petlibro-001",
    operationId: "amz-op-pdp-001",
    observedAt: "2026-11-02T10:00:15.000Z",
    asin: "B0FDKQGRCK",
    productTitle: "PETLIBRO Granary Automatic Cat Feeder 5L",
    brand: "PETLIBRO",
    modelNumber: "PLAF103",
    seller: "PETLIBRO Official",
    price: 69.99,
    currency: "USD",
    availability: "In Stock",
    observedDeliveryPostalCode: "95829",
    verifiedDeliveryMarket: "US",
    searchIdentityVerdict: "AMAZON_SEARCH_PDP_IDENTITY_VERIFIED",
    metaCandidateEquivalenceVerdict: "EXACT_PRODUCT",
    combinedIdentityVerdict: "META_TO_AMAZON_EXACT_PRODUCT_CORROBORATED",
    rawEvidenceHash: "hash_pdp_001",
  };
  const sessionLifecycle = {
    sessionId: "amz-sess-001",
    ownedChildPid: 43210,
    transportMode: "REAL_STDIO_MCP",
    serverOrigin: "PINNED_PLAYWRIGHT_MCP",
    allLiveOpsMatchSessionId: true,
    closedCleanly: true,
    mcpSessionClosedCleanly: true,
    ownedChildPidTerminated: true,
    closedAfterLastToolCompleted: true,
    lastToolCompletedAt: "2026-11-02T10:00:16.000Z",
    closeStartedAt: "2026-11-02T10:00:18.000Z",
    closeFinishedAt: "2026-11-02T10:00:20.000Z",
  };
  const uiProof = buildAmazonUiPhaseContextProof({
    codeSha: VALID_SHA,
    workspaceId: "ws-pet-live-1",
    researchRunId: "run-live-1",
    sessionId: "amz-sess-001",
    targetUsZip: "95829",
    homeAndLocationReadback: hr,
    evaluatedPdpRows: [pdpCandidate],
    sessionLifecycle,
    internalGlowFetchUsed: false,
  });

  return {
    expectedCodeSha: VALID_SHA,
    gitPrecheck: {
      codeSha: VALID_SHA,
      branch: "feature/kh02-walmart-us-jina-reader-v12.4.3.5.1",
      ancestryVerified: true,
    },
    runtimePrecheck: {
      codeSha: VALID_SHA,
      playwrightMcpPackage: "@playwright/mcp@0.0.83",
      playwrightMcpHandshakePassed: true,
      metaCollectorVenvAvailable: true,
      freeDiskGiB: 28.5,
    },
    standaloneReference: {
      codeSha: VALID_SHA,
      manifest: {
        referenceOrigin: "USER_SUPPLIED_EXTERNAL_STANDALONE_REPORT",
        referenceAvailability: "SUMMARY_AND_SCRIPT_ONLY",
        referenceRawHashVerified: false,
        referenceReplayStatus: "NOT_EXECUTED",
        standaloneReferenceStatus: "USER_REPORTED_SEARCH_TO_PDP_PASS",
        standaloneAppIntegrationStatus: "NOT_TESTED_BY_REFERENCE",
      },
      parserVerification: {
        observationClass: "TEST_FIXTURE",
        fixtureSource: "USER_REPORTED_REFERENCE_FIELDS",
        asin: "B0D3XGHTJ5",
        observedCanonicalUrl: "https://www.amazon.com/clp/B0D3XGHTJ5",
      },
      downgradeNegativeTestPassed: true,
      promotedToLiveCount: 0,
    },
    serverWorkerProcess: {
      codeSha: VALID_SHA,
      executionMode: "REAL_NETWORK_WORKER_E2E",
      acceptanceProcessPid: 10001,
      serverProcessPid: 10002,
      workerProcessPid: 10003,
      directRouteImportUsedForPrimaryAcceptance: false,
      inProcessExecuteResearchJobUsedForPrimaryAcceptance: false,
      processesTerminatedCleanly: true,
    },
    httpPostJobFencing: {
      codeSha: VALID_SHA,
      httpMethod: "POST",
      requestUrl: "http://127.0.0.1:3456/api/v1/kh02/research",
      requestSourceMode: "LIVE_ONLY",
      primaryWorkspacePreSeededAdRowCount: 0,
      postHttpStatus: 202,
      researchRunId: "run-live-1",
      workspaceId: "ws-pet-live-1",
      initialJobStatusBeforeWorkerClaim: "PENDING",
      workerClaimed: true,
      workerId: "worker-10003",
      claimToken: "claim-tok-1",
      fencingToken: "fence-tok-1",
      fencingGeneration: 1,
      finalJobStatus: "COMPLETED",
      httpPollCount: 4,
    },
    liveMetaCollection: {
      codeSha: VALID_SHA,
      workspaceId: "ws-pet-live-1",
      researchRunId: "run-live-1",
      sourceMode: "LIVE_ONLY",
      primaryWorkspacePreSeededAdRowCount: 0,
      liveAttempted: true,
      subqueriesExecutedCount: 2,
      liveProviderObservationsCount: 4,
      validatedLiveObservationsCount: 4,
      persistedLiveAdsCount: 4,
      cachedObservationsCount: 0,
      syntheticPromotedToLiveCount: 0,
      cachePromotedToLiveCount: 0,
      missingRawReceiptCount: 0,
      lineagePassedCount: 3,
      lineageRejectedCount: 0,
      strictLiveShortlistCount: 3,
      sourceStatus: "PASSED",
      metaTelemetry: {
        source: "META_ADS",
        queryExecuted: true,
        queryOutcomes: [
          {
            queryId: "meta-sq-1",
            query: "smart cat water fountain",
            attempted: true,
            requestStarted: true,
            requestCompleted: true,
            actualApiCalls: 1,
            status: "SUCCEEDED_WITH_RESULTS",
            providerRequestId: "meta_req_1",
          },
          {
            queryId: "meta-sq-2",
            query: "automatic pet feeder",
            attempted: true,
            requestStarted: true,
            requestCompleted: true,
            actualApiCalls: 1,
            status: "SUCCEEDED_WITH_RESULTS",
            providerRequestId: "meta_req_2",
          },
        ],
      },
    },
    candidateFunnel: {
      codeSha: VALID_SHA,
      relevantPhysicalCandidatesCount: 3,
      nonProductPromotedToShortlistCount: 0,
      irrelevantPromotedToShortlistCount: 0,
    },
    familyDedupShortlist: {
      codeSha: VALID_SHA,
      shortlistCount: 3,
      distinctFamiliesInShortlistCount: 3,
      reversedOrderIdentical: true,
      shortfallPaddingDetected: false,
      provisionalPromotedToEvergreenWinnersCount: 0,
    },
    amazonUiPreflight: uiProof,
    amazonTargetSelection: {
      codeSha: VALID_SHA,
      targetSelectionLedger: { selectedCount: 2 },
      usedForbiddenSliceFallback: false,
      searchIntentPlans: [{ candidateId: "cand-petlibro-001" }],
    },
    amazonMcpLedger: {
      codeSha: VALID_SHA,
      operationsAttempted: 4,
      homeAndLocationReadbackRecorded: true,
      fabricatedLiveSuccess: false,
    },
    amazonSearchCards: {
      codeSha: VALID_SHA,
      maxCardsPerSearchCap: 5,
      sponsoredCardsSelectedCount: 0,
      unvisitedCardsPromotedToVerifiedCount: 0,
      observedHrefSelectedCount: 2,
      searchBlockedOrEmpty: false,
    },
    amazonPdpVerdicts: {
      codeSha: VALID_SHA,
      evaluatedCandidates: [pdpCandidate],
      falseExactProductPromotionCount: 0,
      searchBrandCopiedFromCandidateCount: 0,
      zipBorrowedFromHomepageWhenPdpMissing: false,
      usdInferredFromBareDollarSymbolAlone: false,
    },
    amazonSessionLifecycle: {
      codeSha: VALID_SHA,
      ...sessionLifecycle,
    },
    dbPersistence: {
      codeSha: VALID_SHA,
      syncJobPersisted: true,
      idempotentRePersistVerified: true,
      persistedShortlistCount: 3,
      researchEvidenceRowCount: 2,
    },
    httpGetParity: {
      codeSha: VALID_SHA,
      transportMode: "REAL_NETWORK_HTTP_FETCH",
      parityPassed: true,
      leaderboardHttpStatus: 200,
      researchHttpStatus: 200,
      runByIdHttpStatus: 200,
      amazonRouteHttpStatus: 200,
      shortlistIdsInDb: ["cand-1", "cand-2", "cand-3"],
      shortlistIdsInLeaderboardApi: ["cand-1", "cand-2", "cand-3"],
      mismatches: [],
    },
    uiDomParity: {
      codeSha: VALID_SHA,
      parityPassed: true,
      cardsBeforeReloadCount: 3,
      cardsAfterReloadCount: 3,
      provisionalRenderedAsVerifiedEvergreenCount: 0,
      domCandidateIdsBeforeReload: ["cand-1", "cand-2", "cand-3"],
      domCandidateIdsAfterReload: ["cand-1", "cand-2", "cand-3"],
      mismatches: [],
    },
    secondaryNiche: {
      codeSha: VALID_SHA,
      primaryNiche: "Pet Gadgets",
      secondaryNiche: "Home Organization",
      secondaryShortlistCount: 3,
      crossNicheOverlapCount: 0,
      parityPassed: true,
    },
    walmartPaused: {
      codeSha: VALID_SHA,
      policy: {
        featureEnabled: false,
        liveAllowed: false,
        operationalStatus: "PAUSED_EXTERNAL",
      },
      currentRunLiveWalmartHttpRequests: 0,
      priorLiveBlockerReference: {
        responseBytes: 16845,
        responseSha256:
          "d2e2fcd4b0b64ca67ef00bb7026736592060526b29ac9546b51498f4750f0fd4",
      },
    },
    nonInflation: {
      codeSha: VALID_SHA,
      nonInflationVerified: true,
      scoreDeltaAbsMax: 0,
      rankingChanged: false,
      g07PromotedCount: 0,
      g15PromotedCount: 0,
      g16PromotedCount: 0,
    },
    isolationAndReadOnly: {
      codeSha: VALID_SHA,
      readOnlyVerified: true,
      crossWorkspaceDenied: true,
      walmartPolicyOverrideRejected400: true,
      amazonPolicyOverrideRejected400: true,
    },
    testMatrix: {
      codeSha: VALID_SHA,
      allPassed: true,
      failedCasesCount: 0,
      totalCasesCount: 88,
      passedCasesCount: 88,
    },
    targetedSuites: {
      codeSha: VALID_SHA,
      allPassed: true,
      failedTests: 0,
      passedTests: 460,
      totalTests: 460,
    },
    fullRegression: {
      codeSha: VALID_SHA,
      inventoryComplete: true,
      excludedOrDeferredFilesCount: 0,
      failedTestCases: 0,
      executedTestFilesCount: 158,
      totalDiscoveredTestFiles: 158,
      passedTestCases: 1980,
      totalExecutedTestCases: 1980,
    },
    e2eReceipts: {
      codeSha: VALID_SHA,
      totalSpecs: 12,
      passedSpecsCount: 12,
      failedSpecsCount: 0,
      skippedWithoutAttemptCount: 0,
      passedE2ETestCases: 34,
      totalE2ETestCases: 34,
      failedE2ETestCases: 0,
      receipts: Object.keys(STANDALONE_SERVER_OR_BROWSER_E2E_FILES).map((specFile, idx) => ({
        specIndex: idx + 1,
        specFile,
        command: `npx vitest run ${specFile}`,
        sourceSha: VALID_SHA,
        startedAt: "2026-11-02T10:00:00.000Z",
        endedAt: "2026-11-02T10:00:05.000Z",
        durationMs: 5000,
        exitCode: 0,
        totalTests: idx === 0 ? 12 : 2,
        passedTests: idx === 0 ? 12 : 2,
        failedTests: 0,
        skippedTests: 0,
        classification: "PASS",
        stdoutHash: `stdout_hash_${idx + 1}`,
        stderrHash: `stderr_hash_${idx + 1}`,
        ownedPidsReconciled: true,
      })),
    },
    typecheckAndBuild: {
      codeSha: VALID_SHA,
      tscExitCode: 0,
      tscPassed: true,
      nextBuildExitCode: 0,
      nextBuildPassed: true,
    },
    devReplay: {
      codeSha: VALID_SHA,
      split: "DEV",
      backtestEngineExecuted: "PASS",
      pointInTimeIntegrityVerdict: "PASS",
      postCutoffRowsIncludedCount: 0,
      historicalObservationCount: 6,
      shortlistCount: 0,
      verifiedIdentityCount: 0,
      eligibleHistoricalAmazonRowsCount: 0,
      eligibleHistoricalWalmartRowsCount: 0,
      historicalDevBusinessVerdict: "INSUFFICIENT_HISTORICAL_EVIDENCE",
    },
    holdoutReplay: {
      codeSha: VALID_SHA,
      split: "HOLDOUT",
      backtestEngineExecuted: "PASS",
      pointInTimeIntegrityVerdict: "PASS",
      postCutoffRowsIncludedCount: 0,
      historicalObservationCount: 25,
      shortlistCount: 3,
      verifiedIdentityCount: 0,
      eligibleHistoricalAmazonRowsCount: 0,
      eligibleHistoricalWalmartRowsCount: 0,
      historicalHoldoutBusinessVerdict: "INSUFFICIENT_HISTORICAL_EVIDENCE",
    },
    pointInTimeAudit: {
      codeSha: VALID_SHA,
      pointInTimeIntegrityVerdict: "PASS",
      postCutoffIncludedInReplayCount: 0,
      fixtureRowsIncludedInLiveReplayCount: 0,
      semanticHashAcceptedAsRawProductSchemaProofCount: 0,
      amazonPostCutoffExcludedCount: 1,
      walmartPostCutoffExcludedCount: 1,
    },
    mutationSuite: {
      codeSha: VALID_SHA,
      totalMutationsExecuted: 92,
      caughtMutationsCount: 92,
      falsePassesCount: 0,
      sourceTreeRestoredClean: true,
    },
    resourceAndOrphanGuard: {
      codeSha: VALID_SHA,
      minFreeDiskGiB: 28.5,
      diskThresholdGiB: 15,
      diskGuardPassed: true,
      orphanedOwnedProcessCount: 0,
    },
    businessGates: {
      codeSha: VALID_SHA,
      g07Verdict: "BLOCKED",
      g15Verdict: "INSUFFICIENT_EVIDENCE",
      g15QualifiedProductsCount: 0,
      g15RequiredDays: 60,
      g15MaxObservedDays: 45,
      g16Verdict: "INSUFFICIENT_EVIDENCE",
      g16VerifiedMerchantsCount: 0,
      g16RequiredMerchantsCount: 3,
    },
  };
}

describe("KH-02 V12.4.3.7.2 — Final Acceptance Truth Hardening & 36 Mandatory Negative Scenarios", () => {
  it("P0-A/P0-B: verifies authentic live Meta observation provenance and full candidate live lineage chain", () => {
    const obs = makeValidLiveObservation();
    const obsRes = verifyLiveMetaObservationProvenance(obs, {
      codeSha: VALID_SHA,
      workspaceId: "ws-pet-live-1",
      researchRunId: "run-live-1",
      executedQueryIds: ["meta-sq-1"],
      queryOutcomesByQueryId: {
        "meta-sq-1": {
          queryId: "meta-sq-1",
          attempted: true,
          requestStarted: true,
          requestCompleted: true,
          actualApiCalls: 1,
          status: "SUCCEEDED_WITH_RESULTS",
          providerRequestId: "meta_req_run-live-1_meta-sq-1",
          startedAt: "2026-10-20T09:59:50.000Z",
          completedAt: "2026-10-20T10:00:00.000Z",
        },
      },
      upstreamExternalAdIds: ["meta-ext-9001"],
      persistedAdIdsByExternalId: { "meta-ext-9001": "db-ad-9001" },
      persistedAdWorkspacesById: { "db-ad-9001": "ws-pet-live-1" },
      requireExplicitProviderRequestId: true,
    });
    expect(obsRes.valid).toBe(true);
    expect(obsRes.rejectionCodes).toEqual([]);
    expect(obsRes.lineageReceipt?.executedQueryId).toBe("meta-sq-1");

    const cand = makeValidCandidate(obs);
    const chainRes = verifyCandidateLiveLineageChain(cand, {
      codeSha: VALID_SHA,
      workspaceId: "ws-pet-live-1",
      researchRunId: "run-live-1",
      shortlistRank: 1,
      executedQueryIds: ["meta-sq-1"],
      queryOutcomesByQueryId: {
        "meta-sq-1": {
          queryId: "meta-sq-1",
          attempted: true,
          requestStarted: true,
          requestCompleted: true,
          actualApiCalls: 1,
          status: "SUCCEEDED_WITH_RESULTS",
          providerRequestId: "meta_req_run-live-1_meta-sq-1",
        },
      },
      upstreamExternalAdIds: ["meta-ext-9001"],
      persistedAdIdsByExternalId: { "meta-ext-9001": "db-ad-9001" },
      persistedAdWorkspacesById: { "db-ad-9001": "ws-pet-live-1" },
      requireExplicitProviderRequestId: true,
    });
    expect(chainRes.valid).toBe(true);
    expect(chainRes.verifiedLinks.length).toBe(1);
    expect(chainRes.verifiedLinks[0].codeSha).toBe(VALID_SHA);
    expect(chainRes.verifiedLinks[0].shortlistRank).toBe(1);
  });

  it("P0-A/P0-C: computes all release verdicts fail-closed with PASS on valid evidence and truthful business gates", () => {
    const input = makeBaseValidVerdictInput();
    const res = computeV12_4_3_7_2ReleaseVerdicts(input);
    expect(res.allEngineeringGatesPassed).toBe(true);
    expect(res.anyGateFailed).toBe(false);
    expect(res.verdictTable.CODE_AND_ENGINEERING_GATES).toBe("PASS");
    expect(res.verdictTable.META_LIVE_CURRENT_RUN_COLLECTION).toBe("PASS");
    expect(res.verdictTable.AMAZON_UI_US_DELIVERY_ZIP_95829).toBe("PASS");
    expect(res.verdictTable.AMAZON_UI_USD_COMMERCIAL_EXTRACTION).toBe("PASS");
    expect(res.verdictTable.G07_PAID_MEDIA_PERSISTENCE).toBe("BLOCKED");
    expect(res.verdictTable.G15_LONGITUDINAL_DEMAND_60D).toBe("INSUFFICIENT_EVIDENCE");
    expect(res.verdictTable.G16_INDEPENDENT_MERCHANT_PROOF).toBe("INSUFFICIENT_EVIDENCE");
    expect(res.verdictTable.FULL_KH02_BUSINESS_ACCEPTANCE).toBe("INSUFFICIENT_EVIDENCE");
  });

  it("S01: [1] Hardcoded PASS when underlying artifact is missing -> FAIL", () => {
    const input = makeBaseValidVerdictInput();
    input.httpGetParity = null;
    const res = computeV12_4_3_7_2ReleaseVerdicts(input);
    expect(res.gates.DB_API_UI_RELOAD_PARITY.status).toBe("INCOMPLETE");
    expect(res.allEngineeringGatesPassed).toBe(false);
  });

  it("S02: [2] Hardcoded PASS when artifact has wrong CODE_SHA -> FAIL", () => {
    const input = makeBaseValidVerdictInput();
    input.liveMetaCollection!.codeSha = "0000000000000000000000000000000000000000";
    const res = computeV12_4_3_7_2ReleaseVerdicts(input);
    expect(res.gates.META_LIVE_CURRENT_RUN_COLLECTION.status).toBe("FAIL");
    expect(res.allEngineeringGatesPassed).toBe(false);
  });

  it("S03: [3] Summary artifact contradicting raw ledger -> FAIL", () => {
    const input = makeBaseValidVerdictInput();
    input.liveMetaCollection!.subqueriesExecutedCount = 4;
    const res = computeV12_4_3_7_2ReleaseVerdicts(input);
    expect(res.gates.META_LIVE_CURRENT_RUN_COLLECTION.status).toBe("FAIL");
  });

  it("S04: [4] `initialJobStatusBeforeWorkerClaim` missing or not `PENDING` -> FAIL", () => {
    const input = makeBaseValidVerdictInput();
    input.httpPostJobFencing!.initialJobStatusBeforeWorkerClaim = "COMPLETED";
    const res = computeV12_4_3_7_2ReleaseVerdicts(input);
    expect(res.gates.REAL_NETWORK_HTTP_TO_INDEPENDENT_WORKER_E2E.status).toBe("FAIL");
  });

  it("S05: [5] `finalJobStatus` missing or `FAILED` -> FAIL", () => {
    const input = makeBaseValidVerdictInput();
    input.httpPostJobFencing!.finalJobStatus = "FAILED";
    const res = computeV12_4_3_7_2ReleaseVerdicts(input);
    expect(res.gates.REAL_NETWORK_HTTP_TO_INDEPENDENT_WORKER_E2E.status).toBe("FAIL");
  });

  it("S06: [6] `fencingGeneration` missing or `< 1` -> FAIL", () => {
    const input = makeBaseValidVerdictInput();
    input.httpPostJobFencing!.fencingGeneration = 0;
    const res = computeV12_4_3_7_2ReleaseVerdicts(input);
    expect(res.gates.REAL_NETWORK_HTTP_TO_INDEPENDENT_WORKER_E2E.status).toBe("FAIL");
  });

  it("S07: [7] `subqueriesExecutedCount` fallback `|| 4` when 0 queries ran -> FAIL", () => {
    const input = makeBaseValidVerdictInput();
    input.liveMetaCollection!.subqueriesExecutedCount = 4;
    input.liveMetaCollection!.metaTelemetry = { source: "META_ADS", queryOutcomes: [] };
    const res = computeV12_4_3_7_2ReleaseVerdicts(input);
    expect(res.gates.META_LIVE_CURRENT_RUN_COLLECTION.status).toBe("FAIL");
  });

  it("S08: [8] `sourceStatus` fallback `|| 'PASSED'` when Meta failed -> FAIL", () => {
    const input = makeBaseValidVerdictInput();
    input.liveMetaCollection!.sourceStatus = "FAILED";
    const res = computeV12_4_3_7_2ReleaseVerdicts(input);
    expect(res.gates.META_LIVE_CURRENT_RUN_COLLECTION.status).not.toBe("PASS");
  });

  it("S09: [9] `metaTelemetry` empty `{}` while claiming live Meta PASS -> FAIL", () => {
    const input = makeBaseValidVerdictInput();
    input.liveMetaCollection!.metaTelemetry = {};
    const res = computeV12_4_3_7_2ReleaseVerdicts(input);
    expect(res.gates.META_LIVE_CURRENT_RUN_COLLECTION.status).toBe("FAIL");
  });

  it("S10: [10] Cached observation labeled `LIVE_PROVIDER` -> FAIL", () => {
    const obs = makeValidLiveObservation({
      provenance: "LIVE_PROVIDER",
      isCached: true,
    });
    const res = verifyLiveMetaObservationProvenance(obs);
    expect(res.valid).toBe(false);
    expect(res.rejectionCodes).toContain("CACHE_IMPERSONATING_LIVE");
  });

  it("S11: [11] Synthetic/fixture ad promoted to live -> FAIL", () => {
    const obs = makeValidLiveObservation({
      sourceIdOrigin: "INTERNAL_DERIVED",
    });
    const res = verifyLiveMetaObservationProvenance(obs);
    expect(res.valid).toBe(false);
    expect(res.rejectionCodes).toContain("FAKE_UPSTREAM_AD_ID");
  });

  it("S12: [12] `Math.random()` or non-deterministic ID in candidate discovery -> FAIL", () => {
    const obs = makeValidLiveObservation({
      upstreamAdId: "ad_0.918273645",
    });
    const res = verifyLiveMetaObservationProvenance(obs);
    expect(res.valid).toBe(false);
    expect(res.rejectionCodes).toContain("FAKE_UPSTREAM_AD_ID");
  });

  it("S13: [13] Foreign-run `queryId` attached to current run -> FAIL", () => {
    const obs = makeValidLiveObservation({ queryId: "foreign-q-99", matchedQueryIds: ["foreign-q-99"] });
    const res = verifyLiveMetaObservationProvenance(obs, {
      executedQueryIds: ["meta-sq-1"],
    });
    expect(res.valid).toBe(false);
    expect(res.rejectionCodes).toContain("FOREIGN_RUN_QUERY_ID");
  });

  it("S14: [14] Cross-workspace observation or evidence row -> FAIL", () => {
    const obs = makeValidLiveObservation({ workspaceId: "ws-foreign" });
    const res = verifyLiveMetaObservationProvenance(obs, {
      workspaceId: "ws-pet-live-1",
    });
    expect(res.valid).toBe(false);
    expect(res.rejectionCodes).toContain("CROSS_WORKSPACE_OBSERVATION");
  });

  it("S15: [15] Duplicate `externalAdId` counted twice -> FAIL", () => {
    const obs1 = makeValidLiveObservation();
    const obs2 = makeValidLiveObservation({ sourceObservationId: "sobs_dup_2" });
    const cand = makeValidCandidate(obs1, { sourceObservations: [obs1 as any, obs2 as any] });
    const res = verifyCandidateLiveLineageChain(cand, {
      executedQueryIds: ["meta-sq-1"],
    });
    expect(res.rejectionCodes).toContain("DUPLICATE_EXTERNAL_AD_COUNTED_TWICE");
  });

  it("S16: [16] Corroborated `LIVE_WITH_CACHE_FALLBACK` run claimed as strict `LIVE_ONLY` PASS -> FAIL", () => {
    const input = makeBaseValidVerdictInput();
    input.liveMetaCollection!.sourceMode = "LIVE_WITH_CACHE_FALLBACK";
    const res = computeV12_4_3_7_2ReleaseVerdicts(input);
    expect(res.gates.META_LIVE_CURRENT_RUN_COLLECTION.status).toBe("FAIL");
  });

  it("S17: [17] Amazon UI `dialogOpened=true` at top level while nested `locationDialogOpened=false` -> FAIL", () => {
    const input = makeBaseValidVerdictInput();
    input.amazonUiPreflight!.dialogOpened = true;
    input.amazonUiPreflight!.homeAndLocationReadback = {
      ...input.amazonUiPreflight!.homeAndLocationReadback,
      locationDialogOpened: false,
    };
    const res = computeV12_4_3_7_2ReleaseVerdicts(input);
    expect(res.gates.AMAZON_UI_US_DELIVERY_ZIP_95829.status).toBe("FAIL");
  });

  it("S18: [18] Amazon UI `observedDeliveryPostalCode='95829'` when PDP shows Vietnam/null ZIP -> FAIL", () => {
    const hr = makeValidHomeAndLocationReadback({ pdpPageZip: null });
    const proof = buildAmazonUiPhaseContextProof({
      codeSha: VALID_SHA,
      targetUsZip: "95829",
      homeAndLocationReadback: hr,
      evaluatedPdpRows: [{ asin: "B0FDKQGRCK", observedDeliveryPostalCode: null, price: 69.99, currency: "USD" }],
    });
    const mutated = { ...proof, finalEffectiveUsDeliveryVerified: true };
    const check = validateAmazonUiContextProofConsistency(mutated);
    expect(check.valid).toBe(false);
  });

  it("S19: [19] Amazon USD claimed from bare `$` without explicit USD signal -> FAIL", () => {
    const input = makeBaseValidVerdictInput();
    input.amazonPdpVerdicts!.usdInferredFromBareDollarSymbolAlone = true;
    const res = computeV12_4_3_7_2ReleaseVerdicts(input);
    expect(res.gates.AMAZON_UI_USD_COMMERCIAL_EXTRACTION.status).toBe("FAIL");
  });

  it("S20: [20] Amazon internal `/portal-migration/hz/glow/address-change` fetch used -> FAIL", () => {
    const input = makeBaseValidVerdictInput();
    input.amazonUiPreflight!.internalGlowFetchUsed = true;
    const res = computeV12_4_3_7_2ReleaseVerdicts(input);
    expect(res.gates.AMAZON_UI_US_DELIVERY_ZIP_95829.status).toBe("FAIL");
  });

  it("S21: [21] Unvisited search card promoted to verified Amazon product -> FAIL", () => {
    const input = makeBaseValidVerdictInput();
    input.amazonSearchCards!.unvisitedCardsPromotedToVerifiedCount = 1;
    const res = computeV12_4_3_7_2ReleaseVerdicts(input);
    expect(res.gates.AMAZON_SEARCH_TO_OBSERVED_HREF_PDP_EXECUTION.status).toBe("FAIL");
  });

  it("S22: [22] Sponsored search card selected when non-sponsored policy applies -> FAIL", () => {
    const input = makeBaseValidVerdictInput();
    input.amazonSearchCards!.sponsoredCardsSelectedCount = 1;
    const res = computeV12_4_3_7_2ReleaseVerdicts(input);
    expect(res.gates.AMAZON_SEARCH_TO_OBSERVED_HREF_PDP_EXECUTION.status).toBe("FAIL");
  });

  it("S23: [23] Category-only Amazon match promoted to `EXACT_PRODUCT` -> FAIL", () => {
    const input = makeBaseValidVerdictInput();
    input.amazonPdpVerdicts!.falseExactProductPromotionCount = 1;
    const res = computeV12_4_3_7_2ReleaseVerdicts(input);
    expect(res.gates.META_TO_AMAZON_EXACT_PRODUCT_CORROBORATION.status).toBe("FAIL");
  });

  it("S24: [24] Standalone reference (`B0D3XGHTJ5`) promoted to `AUTHORIZED_LIVE` -> FAIL", () => {
    const input = makeBaseValidVerdictInput();
    input.standaloneReference!.parserVerification!.observationClass = "AUTHORIZED_LIVE";
    const res = computeV12_4_3_7_2ReleaseVerdicts(input);
    expect(res.gates.STANDALONE_REFERENCE_EVIDENCE_INTEGRITY.status).toBe("FAIL");
  });

  it("S25: [25] `referenceRawHashVerified = true` without raw bundle -> FAIL", () => {
    const input = makeBaseValidVerdictInput();
    input.standaloneReference!.manifest!.referenceRawHashVerified = true;
    const res = computeV12_4_3_7_2ReleaseVerdicts(input);
    expect(res.gates.STANDALONE_REFERENCE_EVIDENCE_INTEGRITY.status).toBe("FAIL");
  });

  it("S26: [26] Walmart live call attempted while paused -> FAIL", () => {
    const input = makeBaseValidVerdictInput();
    input.walmartPaused!.currentRunLiveWalmartHttpRequests = 1;
    const res = computeV12_4_3_7_2ReleaseVerdicts(input);
    expect(res.gates.WALMART_US_LIVE_OPERATIONAL_STATUS.status).toBe("FAIL");
  });

  it("S27: [27] Marketplace evidence changes `opportunityScore`, rank, G07, G15, or G16 -> FAIL", () => {
    const input = makeBaseValidVerdictInput();
    input.nonInflation!.scoreDeltaAbsMax = 2.5;
    input.nonInflation!.nonInflationVerified = false;
    const res = computeV12_4_3_7_2ReleaseVerdicts(input);
    expect(res.gates.DB_API_UI_RELOAD_PARITY.status).toBe("FAIL");
  });

  it("S28: [28] Server PID == Worker PID or in-process `executeResearchJob` used -> FAIL", () => {
    const input = makeBaseValidVerdictInput();
    input.serverWorkerProcess!.workerProcessPid = input.serverWorkerProcess!.serverProcessPid;
    const res = computeV12_4_3_7_2ReleaseVerdicts(input);
    expect(res.gates.REAL_NETWORK_HTTP_TO_INDEPENDENT_WORKER_E2E.status).toBe("FAIL");
  });

  it("S29: [29] Stale worker fencing token overwrites newer run -> FAIL", () => {
    const input = makeBaseValidVerdictInput();
    input.httpPostJobFencing!.fencingToken = null;
    const res = computeV12_4_3_7_2ReleaseVerdicts(input);
    expect(res.gates.REAL_NETWORK_HTTP_TO_INDEPENDENT_WORKER_E2E.status).toBe("FAIL");
  });

  it("S30: [30] GET endpoint mutates DB rows -> FAIL", () => {
    const input = makeBaseValidVerdictInput();
    input.isolationAndReadOnly!.readOnlyVerified = false;
    const res = computeV12_4_3_7_2ReleaseVerdicts(input);
    expect(res.gates.DB_API_UI_RELOAD_PARITY.status).toBe("FAIL");
  });

  it("S31: [31] DOM after `page.reload()` differs from DOM before reload or GET JSON -> FAIL", () => {
    const input = makeBaseValidVerdictInput();
    input.uiDomParity!.domCandidateIdsAfterReload = ["cand-1", "cand-2", "cand-999"];
    const res = computeV12_4_3_7_2ReleaseVerdicts(input);
    expect(res.gates.DB_API_UI_RELOAD_PARITY.status).toBe("FAIL");
  });

  it("S32: [32] Secondary niche overlaps primary niche candidates -> FAIL", () => {
    const input = makeBaseValidVerdictInput();
    input.secondaryNiche!.crossNicheOverlapCount = 1;
    const res = computeV12_4_3_7_2ReleaseVerdicts(input);
    expect(res.gates.SECONDARY_NICHE_DYNAMIC_SEPARATION.status).toBe("FAIL");
  });

  it("S33: [33] Post-cutoff row included in DEV or HOLDOUT replay -> FAIL", () => {
    const input = makeBaseValidVerdictInput();
    input.devReplay!.postCutoffRowsIncludedCount = 1;
    const res = computeV12_4_3_7_2ReleaseVerdicts(input);
    expect(res.gates.POINT_IN_TIME_HISTORICAL_REPLAY_INTEGRITY.status).toBe("FAIL");
  });

  it("S34: [34] G15 marked PASS with `< 60` days real product-level demand -> FAIL", () => {
    const input = makeBaseValidVerdictInput();
    input.businessGates!.g15Verdict = "PASS";
    input.businessGates!.g15MaxObservedDays = 45;
    const res = computeV12_4_3_7_2ReleaseVerdicts(input);
    expect(res.gates.G15_LONGITUDINAL_DEMAND_60D.status).toBe("FAIL");
  });

  it("S35: [35] G16 marked PASS without 3/3 independent persisted merchant proofs -> FAIL", () => {
    const input = makeBaseValidVerdictInput();
    input.businessGates!.g16Verdict = "PASS";
    input.businessGates!.g16VerifiedMerchantsCount = 2;
    const res = computeV12_4_3_7_2ReleaseVerdicts(input);
    expect(res.gates.G16_INDEPENDENT_MERCHANT_PROOF.status).toBe("FAIL");
  });

  it("S36: [36] Orphaned Playwright/MCP/worker process or free disk `< 15 GiB` -> FAIL", () => {
    const input = makeBaseValidVerdictInput();
    input.resourceAndOrphanGuard!.orphanedOwnedProcessCount = 1;
    const res = computeV12_4_3_7_2ReleaseVerdicts(input);
    expect(res.gates.CODE_AND_ENGINEERING_GATES.status).toBe("FAIL");
  });
});
