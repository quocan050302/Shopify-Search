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
import { reconcileDatabaseAndBrowser } from "../../../src/services/kh02/persistence/kh02PersistenceService";
import {
  computeV12_4_3_7_2ReleaseVerdicts,
  validatePerSpecE2EReceipts,
  reconcileLiveMetaLineageCounts,
  STANDALONE_SERVER_OR_BROWSER_E2E_FILES,
  type ComputeV12_4_3_7_2ReleaseVerdictsInput,
} from "../../../scripts/kh02/acceptanceTruth";

const VALID_SHA = "164f9d0d1a6207cbb5a00490a7154396b5d07836";

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
    homeSnapshotHash: "hash_home_001_valid",
    searchSnapshotHash: "hash_search_001_valid",
    pdpSnapshotHash: "hash_pdp_001_valid",
    initialHomeObservedAt: "2026-11-02T10:00:01.000Z",
    zipSubmitObservedAt: "2026-11-02T10:00:03.000Z",
    postReloadHomeObservedAt: "2026-11-02T10:00:05.000Z",
    searchReadbackObservedAt: "2026-11-02T10:00:08.000Z",
    pdpReadbackObservedAt: "2026-11-02T10:00:12.000Z",
    lastToolCompletedAt: "2026-11-02T10:00:15.000Z",
    stepsExecuted: [
      "OPEN_AMAZON_US_HOME",
      "WAIT_SEARCH_BOX_READY",
      "INSPECT_INITIAL_DELIVERY_AND_CURRENCY",
      "OPEN_GLOW_DELIVERY_DIALOG",
      "FILL_US_ZIP_INPUT",
      "CLICK_GLOW_ZIP_APPLY",
      "HANDLE_GLOW_CONTINUE_CONFIRMATION",
      "RELOAD_HOME_PAGE",
      "READBACK_DELIVERY_ZIP_AND_EXPLICIT_CURRENCY",
    ],
    contradictionsDetected: [],
    ...overrides,
  };
}

function makeValidPdpCandidate(overrides: Record<string, any> = {}) {
  return {
    candidateId: "cand-petlibro-001",
    operationId: "amz-op-pdp-1",
    observedAt: "2026-11-02T10:00:12.000Z",
    candidateTitle: "PETLIBRO Capsule Automatic Pet Water Fountain",
    candidateBrand: "PETLIBRO",
    selectedAsin: "B091D37RBB",
    pdpUrl: "https://www.amazon.com/dp/B091D37RBB",
    pdpTitle: "PETLIBRO Capsule Automatic Pet Water Fountain 2.1L",
    pdpBrand: "PETLIBRO",
    priceValue: 29.99,
    currency: "USD",
    displayedCurrencyCode: "USD",
    explicitCurrencySource: "DOM:input[name=currencyOfPreference]",
    deliveryLocationText: "Deliver to Sacramento 95829",
    deliveryPostalCode: "95829",
    usDeliveryVerified: true,
    searchToPdpTitleSimilarity: 0.85,
    searchIdentityVerdict: "AMAZON_SEARCH_PDP_IDENTITY_VERIFIED",
    metaCandidateEquivalenceVerdict: "EXACT_PRODUCT",
    combinedIdentityVerdict: "META_TO_AMAZON_EXACT_PRODUCT_CORROBORATED",
    rawSnapshotHash: "hash_pdp_001_valid",
    ...overrides,
  };
}

function makeValidSessionLifecycle(overrides: Record<string, any> = {}) {
  return {
    sessionId: "amz-sess-001",
    ownedChildPid: 43210,
    transportMode: "REAL_STDIO_MCP",
    serverOrigin: "PINNED_PLAYWRIGHT_MCP",
    allLiveOpsMatchSessionId: true,
    mcpSessionClosedCleanly: true,
    ownedChildPidTerminated: true,
    closedAfterLastToolCompleted: true,
    lastToolCompletedAt: "2026-11-02T10:00:15.000Z",
    closeStartedAt: "2026-11-02T10:00:18.000Z",
    closeFinishedAt: "2026-11-02T10:00:20.000Z",
    ...overrides,
  };
}

function makeValidVerdictInput(): ComputeV12_4_3_7_2ReleaseVerdictsInput {
  const hr = makeValidHomeAndLocationReadback();
  const pdpCandidate = makeValidPdpCandidate();
  const sessionLifecycle = makeValidSessionLifecycle();
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
    measuredAt: "2026-11-02T10:01:00.000Z",
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
      candidateAssociatedLiveObservationsCount: 4,
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
      candidateLineageAudit: [
        { candidateId: "cand-1", valid: true },
        { candidateId: "cand-2", valid: true },
        { candidateId: "cand-3", valid: true },
      ],
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
      completedAt: "2026-11-02T10:00:50.000Z",
      totalMutationsExecuted: 98,
      caughtMutationsCount: 98,
      falsePassesCount: 0,
      sourceTreeRestoredClean: true,
    },
    resourceAndOrphanGuard: {
      codeSha: VALID_SHA,
      minFreeDiskGiB: 28.5,
      diskThresholdGiB: 15,
      diskGuardPassed: true,
      orphanedOwnedProcessCount: 0,
      maxConcurrentHeavyObserved: 2,
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

describe("KH-02 V12.4.3.7.3 — 42 Mandatory Negative & Mutation Regression Tests (A01..A42)", () => {
  describe("E2E Per-Spec Receipt Integrity (A01..A10)", () => {
    it("[A01] 04_E2E_SPEC_INVENTORY missing receipts array -> FAIL", () => {
      const input = makeValidVerdictInput();
      delete (input.e2eReceipts as any).receipts;
      const check = validatePerSpecE2EReceipts(input.e2eReceipts as any, VALID_SHA);
      expect(check.valid).toBe(false);
      expect(
        check.reasons.some((r) => r.includes("MISSING_PER_SPEC_E2E_RECEIPTS_ARRAY"))
      ).toBe(true);
      const res = computeV12_4_3_7_2ReleaseVerdicts(input);
      expect(res.verdictTable.ALL_12_CANONICAL_E2E_SPECS).toBe("FAIL");
      expect(res.verdictTable.CODE_AND_ENGINEERING_GATES).toBe("FAIL");
    });

    it("[A02] 04_E2E_SPEC_INVENTORY has 11/12 spec rows -> FAIL", () => {
      const input = makeValidVerdictInput();
      (input.e2eReceipts as any).receipts = (input.e2eReceipts as any).receipts.slice(0, 11);
      const check = validatePerSpecE2EReceipts(input.e2eReceipts as any, VALID_SHA);
      expect(check.valid).toBe(false);
      const res = computeV12_4_3_7_2ReleaseVerdicts(input);
      expect(res.verdictTable.ALL_12_CANONICAL_E2E_SPECS).toBe("FAIL");
    });

    it("[A03] Duplicate specFile or duplicate specIndex in E2E receipts -> FAIL", () => {
      const input = makeValidVerdictInput();
      const receipts = (input.e2eReceipts as any).receipts;
      receipts[1] = {
        ...receipts[1],
        specFile: receipts[0].specFile,
      };
      const check = validatePerSpecE2EReceipts(input.e2eReceipts as any, VALID_SHA);
      expect(check.valid).toBe(false);
      expect(check.reasons.some((r) => r.includes("DUPLICATE_E2E_SPEC_FILE"))).toBe(true);
    });

    it("[A04] One spec receipt has exitCode !== 0 while summary says 12/12 passed -> FAIL", () => {
      const input = makeValidVerdictInput();
      (input.e2eReceipts as any).receipts[3].exitCode = 1;
      const check = validatePerSpecE2EReceipts(input.e2eReceipts as any, VALID_SHA);
      expect(check.valid).toBe(false);
      const res = computeV12_4_3_7_2ReleaseVerdicts(input);
      expect(res.verdictTable.ALL_12_CANONICAL_E2E_SPECS).toBe("FAIL");
    });

    it("[A05] One spec receipt has classification = SKIPPED or FAIL -> FAIL", () => {
      const input = makeValidVerdictInput();
      (input.e2eReceipts as any).receipts[4].classification = "SKIPPED";
      const check = validatePerSpecE2EReceipts(input.e2eReceipts as any, VALID_SHA);
      expect(check.valid).toBe(false);
      const res = computeV12_4_3_7_2ReleaseVerdicts(input);
      expect(res.verdictTable.ALL_12_CANONICAL_E2E_SPECS).toBe("FAIL");
    });

    it("[A06] One spec receipt has totalTests = 0 or failedTests > 0 -> FAIL", () => {
      const input = makeValidVerdictInput();
      (input.e2eReceipts as any).receipts[2].totalTests = 0;
      (input.e2eReceipts as any).receipts[2].passedTests = 0;
      expect(validatePerSpecE2EReceipts(input.e2eReceipts as any, VALID_SHA).valid).toBe(false);

      const input2 = makeValidVerdictInput();
      (input2.e2eReceipts as any).receipts[2].failedTests = 1;
      expect(validatePerSpecE2EReceipts(input2.e2eReceipts as any, VALID_SHA).valid).toBe(false);
    });

    it("[A07] Summary totalE2ETestCases !== sum(spec.totalTests) -> FAIL", () => {
      const input = makeValidVerdictInput();
      input.e2eReceipts!.totalE2ETestCases = 999;
      const check = validatePerSpecE2EReceipts(input.e2eReceipts as any, VALID_SHA);
      expect(check.valid).toBe(false);
      expect(check.reasons.some((r) => r.includes("E2E_SUMMARY_TOTALS_MISMATCH_PER_SPEC_SUM"))).toBe(
        true
      );
    });

    it("[A08] One spec receipt has wrong sourceSha -> FAIL", () => {
      const input = makeValidVerdictInput();
      (input.e2eReceipts as any).receipts[5].sourceSha = "deadbeef";
      const check = validatePerSpecE2EReceipts(input.e2eReceipts as any, VALID_SHA);
      expect(check.valid).toBe(false);
      expect(check.reasons.some((r) => r.includes("PER_SPEC_SOURCE_SHA_MISMATCH"))).toBe(true);
    });

    it("[A09] One spec receipt has invalid timestamps or startedAt > endedAt -> FAIL", () => {
      const input = makeValidVerdictInput();
      (input.e2eReceipts as any).receipts[6].startedAt = "2026-11-02T10:05:00.000Z";
      (input.e2eReceipts as any).receipts[6].endedAt = "2026-11-02T10:00:00.000Z";
      const check = validatePerSpecE2EReceipts(input.e2eReceipts as any, VALID_SHA);
      expect(check.valid).toBe(false);
      expect(check.reasons.some((r) => r.includes("PER_SPEC_TIMESTAMPS_INVALID"))).toBe(true);
    });

    it("[A10] One spec receipt has ownedPidsReconciled = false -> FAIL", () => {
      const input = makeValidVerdictInput();
      (input.e2eReceipts as any).receipts[7].ownedPidsReconciled = false;
      const check = validatePerSpecE2EReceipts(input.e2eReceipts as any, VALID_SHA);
      expect(check.valid).toBe(false);
      expect(check.reasons.some((r) => r.includes("PER_SPEC_OWNED_PIDS_NOT_RECONCILED"))).toBe(true);
    });
  });

  describe("Final Verdict Completeness & Chronology (A11..A14)", () => {
    it("[A11] computeV12_4_3_7_2ReleaseVerdicts called with missing mutationSuite -> INCOMPLETE (never PASS)", () => {
      const input = makeValidVerdictInput();
      input.mutationSuite = null;
      const res = computeV12_4_3_7_2ReleaseVerdicts(input);
      expect(res.verdictTable.CODE_AND_ENGINEERING_GATES).toBe("INCOMPLETE");
      expect(res.verdictTable.INDEPENDENT_RAW_EVIDENCE_AND_MUTATION_VALIDATION).toBe("INCOMPLETE");
      expect(res.verdictTable.ENGINEERING_AND_TRUTH_ACCEPTANCE).toBe("INCOMPLETE");
    });

    it("[A12] computeV12_4_3_7_2ReleaseVerdicts called with missing typecheckAndBuild -> INCOMPLETE", () => {
      const input = makeValidVerdictInput();
      input.typecheckAndBuild = null;
      const res = computeV12_4_3_7_2ReleaseVerdicts(input);
      expect(res.verdictTable.TYPESCRIPT_AND_NEXT_PRODUCTION_BUILD).toBe("INCOMPLETE");
      expect(res.verdictTable.CODE_AND_ENGINEERING_GATES).toBe("INCOMPLETE");
    });

    it("[A13] computeV12_4_3_7_2ReleaseVerdicts called with missing resourceAndOrphanGuard -> INCOMPLETE", () => {
      const input = makeValidVerdictInput();
      input.resourceAndOrphanGuard = null;
      const res = computeV12_4_3_7_2ReleaseVerdicts(input);
      expect(res.verdictTable.CODE_AND_ENGINEERING_GATES).toBe("INCOMPLETE");
      expect(res.verdictTable.ENGINEERING_AND_TRUTH_ACCEPTANCE).toBe("INCOMPLETE");
    });

    it("[A14] 22_NEGATIVE_MUTATION_SUITE_FINAL_RECEIPT.completedAt > 24_FINAL_ROUTE_SPECIFIC_VERDICT_MATRIX.evaluatedAt or reason string contains Mutations:pending -> FAIL", () => {
      const input = makeValidVerdictInput();
      input.measuredAt = "2026-11-02T10:00:30.000Z";
      input.mutationSuite!.completedAt = "2026-11-02T10:00:50.000Z";
      const res = computeV12_4_3_7_2ReleaseVerdicts(input);
      expect(res.verdictTable.CODE_AND_ENGINEERING_GATES).toBe("FAIL");
      expect(res.verdictTable.INDEPENDENT_RAW_EVIDENCE_AND_MUTATION_VALIDATION).toBe("FAIL");
      expect(JSON.stringify(res)).not.toContain("Mutations:pending");
    });
  });

  describe("Amazon MCP Chronology & Session Integrity (A15..A20)", () => {
    it("[A15] phase4_search_readback.observedAt or phase5_pdp_readback.observedAt > phase6_post_session_close.closeFinishedAt -> FAIL", () => {
      const input = makeValidVerdictInput();
      input.amazonUiPreflight!.phases!.phase5_pdp_readback.observedAt =
        "2026-11-02T10:00:25.000Z"; // after closeFinishedAt (10:00:20)
      const check = validateAmazonUiContextProofConsistency(input.amazonUiPreflight as any);
      expect(check.valid).toBe(false);
      expect(
        check.contradictions.some((c) =>
          c.includes("CHRONOLOGY_VIOLATION_PHASE5_AFTER_CLOSE_FINISHED")
        )
      ).toBe(true);
      const res = computeV12_4_3_7_2ReleaseVerdicts(input);
      expect(res.verdictTable.AMAZON_SIX_PHASE_OBSERVATION_CHRONOLOGY).toBe("FAIL");
    });

    it("[A16] phase4 or phase5 observedAt equals final report synthesis timestamp evaluatedAt -> FAIL", () => {
      const input = makeValidVerdictInput();
      input.amazonUiPreflight!.phases!.phase4_search_readback.observedAt =
        input.amazonUiPreflight!.evaluatedAt;
      const check = validateAmazonUiContextProofConsistency(input.amazonUiPreflight as any);
      expect(check.valid).toBe(false);
      expect(
        check.contradictions.some((c) =>
          c.includes("PHASE4_OBSERVED_AT_EQUALS_REPORT_EVALUATED_AT")
        )
      ).toBe(true);
    });

    it("[A17] phase5_pdp_readback.status = INCOMPLETE while claiming Amazon PDP PASS -> FAIL", () => {
      const input = makeValidVerdictInput();
      input.amazonUiPreflight!.phases!.phase5_pdp_readback.status = "INCOMPLETE";
      const check = validateAmazonUiContextProofConsistency(input.amazonUiPreflight as any);
      expect(check.valid).toBe(false);
      const res = computeV12_4_3_7_2ReleaseVerdicts(input);
      expect(res.verdictTable.AMAZON_SIX_PHASE_OBSERVATION_CHRONOLOGY).toBe("FAIL");
      expect(res.verdictTable.AMAZON_US_ZIP_95829_AND_EXPLICIT_USD_VERIFICATION).toBe("FAIL");
    });

    it("[A18] closeStartedAt < lastToolCompletedAt in Amazon MCP session -> FAIL", () => {
      const input = makeValidVerdictInput();
      input.amazonSessionLifecycle!.lastToolCompletedAt = "2026-11-02T10:00:19.000Z";
      input.amazonSessionLifecycle!.closeStartedAt = "2026-11-02T10:00:18.000Z";
      input.amazonUiPreflight!.phases!.phase6_post_session_close.observedFields.lastToolCompletedAt =
        "2026-11-02T10:00:19.000Z";
      const check = validateAmazonUiContextProofConsistency(input.amazonUiPreflight as any);
      expect(check.valid).toBe(false);
      const res = computeV12_4_3_7_2ReleaseVerdicts(input);
      expect(res.verdictTable.AMAZON_MCP_SESSION_AND_OWNED_PID_CLEAN_EXIT).toBe("FAIL");
    });

    it("[A19] sessionId mismatch across Phase 1..6 or operation ledger -> FAIL", () => {
      const input = makeValidVerdictInput();
      input.amazonUiPreflight!.phases!.phase4_search_readback.sessionId = "amz-sess-wrong";
      const check = validateAmazonUiContextProofConsistency(input.amazonUiPreflight as any);
      expect(check.valid).toBe(false);
      expect(
        check.contradictions.some((c) => c.includes("SESSION_ID_MISMATCH_ACROSS_PHASES"))
      ).toBe(true);
    });

    it("[A20] Missing or phony rawSnapshotHash on any phase/operation -> FAIL", () => {
      const input = makeValidVerdictInput();
      input.amazonUiPreflight!.phases!.phase3_home_readback.rawSnapshotHash = "todo_placeholder";
      const check = validateAmazonUiContextProofConsistency(input.amazonUiPreflight as any);
      expect(check.valid).toBe(false);
      expect(
        check.contradictions.some((c) =>
          c.includes("MISSING_OR_PHONY_RAW_SNAPSHOT_HASH_PHASE3")
        )
      ).toBe(true);
    });
  });

  describe("Amazon Commercial US Context Truth (A21..A24)", () => {
    it("[A21] finalEffectiveUsDeliveryVerified = undefined or false while finalZipVerdict = PASS -> FAIL", () => {
      const input = makeValidVerdictInput();
      delete (input.amazonUiPreflight as any).finalEffectiveUsDeliveryVerified;
      const check = validateAmazonUiContextProofConsistency(input.amazonUiPreflight as any);
      expect(check.valid).toBe(false);
      const res = computeV12_4_3_7_2ReleaseVerdicts(input);
      expect(res.verdictTable.AMAZON_UI_US_DELIVERY_ZIP_95829).toBe("FAIL");
    });

    it("[A22] finalEffectiveCurrencyUsdVerified = undefined or false while finalUsdCommercialVerdict = PASS -> FAIL", () => {
      const input = makeValidVerdictInput();
      delete (input.amazonUiPreflight as any).finalEffectiveCurrencyUsdVerified;
      const check = validateAmazonUiContextProofConsistency(input.amazonUiPreflight as any);
      expect(check.valid).toBe(false);
      const res = computeV12_4_3_7_2ReleaseVerdicts(input);
      expect(res.verdictTable.AMAZON_UI_USD_COMMERCIAL_EXTRACTION).toBe("FAIL");
    });

    it("[A23] Currency inferred from $ symbol only (explicitCurrencySource = SYMBOL_ONLY_UNVERIFIED) -> FAIL", () => {
      const hr = makeValidHomeAndLocationReadback({
        explicitCurrencySource: "SYMBOL_ONLY_UNVERIFIED",
      });
      const proof = buildAmazonUiPhaseContextProof({
        codeSha: VALID_SHA,
        workspaceId: "ws-pet-live-1",
        researchRunId: "run-live-1",
        sessionId: "amz-sess-001",
        targetUsZip: "95829",
        homeAndLocationReadback: hr,
        evaluatedPdpRows: [
          makeValidPdpCandidate({ explicitCurrencySource: "SYMBOL_ONLY_UNVERIFIED" }),
        ],
        sessionLifecycle: makeValidSessionLifecycle(),
        internalGlowFetchUsed: false,
      });
      expect(proof.finalEffectiveCurrencyUsdVerified).toBe(false);
      expect(proof.finalUsdCommercialVerdict).not.toBe("PASS");
      const input = makeValidVerdictInput();
      (input.amazonUiPreflight as any).explicitCurrencySource = "SYMBOL_ONLY_UNVERIFIED";
      (input.amazonPdpVerdicts as any).usdInferredFromBareDollarSymbolAlone = true;
      const res = computeV12_4_3_7_2ReleaseVerdicts(input);
      expect(res.verdictTable.AMAZON_UI_USD_COMMERCIAL_EXTRACTION).toBe("FAIL");
    });

    it("[A24] Homepage ZIP 95829 borrowed onto PDP whose own header shows non-US or null ZIP -> FAIL", () => {
      const proof = buildAmazonUiPhaseContextProof({
        codeSha: VALID_SHA,
        workspaceId: "ws-pet-live-1",
        researchRunId: "run-live-1",
        sessionId: "amz-sess-001",
        targetUsZip: "95829",
        homeAndLocationReadback: makeValidHomeAndLocationReadback({ pdpPageZip: null }),
        evaluatedPdpRows: [
          makeValidPdpCandidate({
            deliveryPostalCode: null,
            usDeliveryVerified: false,
          }),
        ],
        sessionLifecycle: makeValidSessionLifecycle(),
        internalGlowFetchUsed: false,
      });
      expect(proof.finalEffectiveUsDeliveryVerified).toBe(false);
      expect(proof.finalZipVerdict).not.toBe("PASS");
      const input = makeValidVerdictInput();
      (input.amazonPdpVerdicts as any).zipBorrowedFromHomepageWhenPdpMissing = true;
      const res = computeV12_4_3_7_2ReleaseVerdicts(input);
      expect(res.verdictTable.AMAZON_UI_US_DELIVERY_ZIP_95829).toBe("FAIL");
    });
  });

  describe("Browser DOM & API Parity (A25..A27)", () => {
    it("[A25] domCandidateIdsBeforeReload or domCandidateIdsAfterReload missing/undefined/non-array -> FAIL (never fallback to dbIds)", () => {
      const input = makeValidVerdictInput();
      delete (input.uiDomParity as any).domCandidateIdsBeforeReload;
      delete (input.uiDomParity as any).domCandidateIdsAfterReload;
      const res = computeV12_4_3_7_2ReleaseVerdicts(input);
      expect(res.verdictTable.DB_API_UI_RELOAD_PARITY).toBe("FAIL");
      expect(res.verdictTable.DB_HTTP_API_CHROMIUM_RELOAD_PARITY).toBe("FAIL");

      const rec = reconcileDatabaseAndBrowser(
        {
          runId: "r-1",
          workspaceId: "ws-1",
          status: "COMPLETED",
          candidateIds: ["cand-1"],
          rankedCandidateIds: ["cand-1"],
          shortlistCandidateIds: ["cand-1"],
          provisionalCandidateIds: [],
          rankedScores: { "cand-1": 80 },
          confidenceStatuses: { "cand-1": "PROVISIONAL" },
          sourceObservationIds: [],
          rawObservationsCount: 1,
          candidateCount: 1,
          shortlistDetails: [],
        } as any,
        { runId: "r-1" } as any
      );
      expect(rec.reconciled).toBe(false);
      expect(rec.mismatches.some((m) => m.field === "displayedCandidateIds")).toBe(true);
    });

    it("[A26] DOM candidate IDs after reload differ from before reload or from GET API -> FAIL", () => {
      const input = makeValidVerdictInput();
      input.uiDomParity!.domCandidateIdsAfterReload = ["cand-1", "cand-2", "cand-999"];
      const res = computeV12_4_3_7_2ReleaseVerdicts(input);
      expect(res.verdictTable.DB_API_UI_RELOAD_PARITY).toBe("FAIL");
    });

    it("[A27] GET API returns cached/fixture data while claiming live run parity -> FAIL", () => {
      const input = makeValidVerdictInput();
      (input.httpGetParity as any).returnedCachedOrFixtureAsLiveCount = 1;
      const res = computeV12_4_3_7_2ReleaseVerdicts(input);
      expect(res.verdictTable.DB_API_UI_RELOAD_PARITY).toBe("FAIL");
    });
  });

  describe("Meta Live Provenance & Lineage Reconciliation (A28..A34)", () => {
    it("[A28] sourceMode !== LIVE_ONLY or pre-seeded rows > 0 in live workspace -> FAIL", () => {
      const input = makeValidVerdictInput();
      input.liveMetaCollection!.sourceMode = "CACHE_FALLBACK";
      expect(reconcileLiveMetaLineageCounts(input.liveMetaCollection as any).valid).toBe(false);

      const input2 = makeValidVerdictInput();
      input2.liveMetaCollection!.primaryWorkspacePreSeededAdRowCount = 2;
      expect(reconcileLiveMetaLineageCounts(input2.liveMetaCollection as any).valid).toBe(false);
    });

    it("[A29] metaTelemetry is empty {} -> FAIL", () => {
      const input = makeValidVerdictInput();
      input.liveMetaCollection!.metaTelemetry = {};
      expect(reconcileLiveMetaLineageCounts(input.liveMetaCollection as any).valid).toBe(false);
      const res = computeV12_4_3_7_2ReleaseVerdicts(input);
      expect(res.verdictTable.STRICT_LIVE_ONLY_META_QUERY_PROVENANCE).toBe("FAIL");
    });

    it("[A30] subqueriesExecutedCount > actual completed query receipts -> FAIL", () => {
      const input = makeValidVerdictInput();
      input.liveMetaCollection!.subqueriesExecutedCount = 4; // only 2 queryOutcomes exist
      const rec = reconcileLiveMetaLineageCounts(input.liveMetaCollection as any);
      expect(rec.valid).toBe(false);
      expect(
        rec.contradictions.some((f) => f.includes("SUBQUERIES_EXECUTED_COUNT_MISMATCH"))
      ).toBe(true);
    });

    it("[A31] Any query receipt missing providerRequestId or timestamps -> FAIL", () => {
      const input = makeValidVerdictInput();
      input.liveMetaCollection!.metaTelemetry!.queryOutcomes[1].providerRequestId = "";
      const rec = reconcileLiveMetaLineageCounts(input.liveMetaCollection as any);
      expect(rec.valid).toBe(false);
      expect(
        rec.contradictions.some((f) => f.includes("MISSING_PROVIDER_REQUEST_RECEIPT"))
      ).toBe(true);
    });

    it("[A32] Cached/synthetic/cross-workspace ad promoted into live candidate -> FAIL", () => {
      const obs = makeValidLiveObservation({ workspaceId: "ws-other-workspace" });
      const cand = makeValidCandidate(obs);
      const lineage = verifyCandidateLiveLineageChain(cand, {
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
      expect(lineage.valid).toBe(false);
    });

    it("[A33] validatedLiveObservationsCount !== candidateAssociatedLiveObservationsCount without explicit rejected reason -> FAIL", () => {
      const input = makeValidVerdictInput();
      (input.liveMetaCollection as any).validatedLiveObservationsCount = 5;
      (input.liveMetaCollection as any).candidateAssociatedLiveObservationsCount = 3;
      input.liveMetaCollection!.lineageRejectedCount = 0;
      const rec = reconcileLiveMetaLineageCounts(input.liveMetaCollection as any);
      expect(rec.valid).toBe(false);
      expect(
        rec.contradictions.some((f) =>
          f.includes("UNRECONCILED_VALIDATED_VS_CANDIDATE_OBS_COUNT")
        )
      ).toBe(true);
    });

    it("[A34] lineagePassedCount < 3 while claiming strict-live Top 3 PASS -> FAIL", () => {
      const input = makeValidVerdictInput();
      input.liveMetaCollection!.lineagePassedCount = 2;
      (input.liveMetaCollection as any).candidateLineageAudit = [
        { candidateId: "cand-1", valid: true },
        { candidateId: "cand-2", valid: true },
        { candidateId: "cand-3", valid: false },
      ];
      const rec = reconcileLiveMetaLineageCounts(input.liveMetaCollection as any);
      expect(rec.valid).toBe(false);
      const res = computeV12_4_3_7_2ReleaseVerdicts(input);
      expect(res.verdictTable.META_OBSERVATION_TO_PERSISTED_AD_TO_CANDIDATE_LINEAGE).toBe("FAIL");
    });
  });

  describe("Historical, Walmart, Business Gate & Resource Hygiene (A35..A42)", () => {
    it("[A35] Post-cutoff row admitted into DEV or HOLDOUT replay -> FAIL", () => {
      const input = makeValidVerdictInput();
      input.devReplay!.postCutoffRowsIncludedCount = 1;
      const res = computeV12_4_3_7_2ReleaseVerdicts(input);
      expect(res.verdictTable.DEV_AND_HOLDOUT_POINT_IN_TIME_NO_LOOKAHEAD).toBe("FAIL");
    });

    it("[A36] TEST_FIXTURE row admitted into historical replay -> FAIL", () => {
      const input = makeValidVerdictInput();
      input.pointInTimeAudit!.fixtureRowsIncludedInLiveReplayCount = 1;
      const res = computeV12_4_3_7_2ReleaseVerdicts(input);
      expect(res.verdictTable.DEV_AND_HOLDOUT_POINT_IN_TIME_NO_LOOKAHEAD).toBe("FAIL");
    });

    it("[A37] Historical provider parity marked PASS when pre-cutoff Amazon/Walmart rows = 0 -> FAIL", () => {
      const input = makeValidVerdictInput();
      input.devReplay!.eligibleHistoricalAmazonRowsCount = 0;
      input.devReplay!.eligibleHistoricalWalmartRowsCount = 0;
      (input.devReplay as any).historicalProviderParityVerdict = "PASS";
      const res = computeV12_4_3_7_2ReleaseVerdicts(input);
      expect(res.verdictTable.HISTORICAL_PROVIDER_PARITY_TRUTH).toBe("FAIL");
      expect(res.verdictTable.HISTORICAL_MARKETPLACE_PROVIDER_COVERAGE).toBe("FAIL");
    });

    it("[A38] Walmart live HTTP requests > 0 while gate status is PAUSED_EXTERNAL -> FAIL", () => {
      const input = makeValidVerdictInput();
      input.walmartPaused!.currentRunLiveWalmartHttpRequests = 1;
      const res = computeV12_4_3_7_2ReleaseVerdicts(input);
      expect(res.verdictTable.WALMART_US_LIVE_OPERATIONAL_STATUS).toBe("FAIL");
      expect(res.verdictTable.WALMART_JINA_LIVE_OPERATIONAL_GATE).toBe("FAIL");
    });

    it("[A39] G07, G15, G16, or FULL_KH02_BUSINESS_ACCEPTANCE marked PASS without required proof -> FAIL", () => {
      const input = makeValidVerdictInput();
      input.businessGates!.g07Verdict = "PASS";
      const res = computeV12_4_3_7_2ReleaseVerdicts(input);
      expect(res.verdictTable.G07_PAID_MEDIA_PERSISTENCE).toBe("FAIL");
      expect(res.verdictTable.G07_TIKTOK_US_LIVE_ADS).toBe("FAIL");
      expect(res.verdictTable.FULL_KH02_AUTONOMOUS_WINNING_PRODUCT_BUSINESS_ACCEPTANCE).toBe(
        "FAIL"
      );
    });

    it("[A40] Free disk < 15 GiB -> FAIL", () => {
      const input = makeValidVerdictInput();
      input.resourceAndOrphanGuard!.minFreeDiskGiB = 14.5;
      const res = computeV12_4_3_7_2ReleaseVerdicts(input);
      expect(res.verdictTable.CODE_AND_ENGINEERING_GATES).toBe("FAIL");
    });

    it("[A41] Orphaned test-spawned process remains after run -> FAIL", () => {
      const input = makeValidVerdictInput();
      input.resourceAndOrphanGuard!.orphanedOwnedProcessCount = 1;
      const res = computeV12_4_3_7_2ReleaseVerdicts(input);
      expect(res.verdictTable.CODE_AND_ENGINEERING_GATES).toBe("FAIL");
    });

    it("[A42] Concurrent heavy process count exceeds 2 -> FAIL", () => {
      const input = makeValidVerdictInput();
      input.resourceAndOrphanGuard!.maxConcurrentHeavyObserved = 3;
      const res = computeV12_4_3_7_2ReleaseVerdicts(input);
      expect(res.verdictTable.CODE_AND_ENGINEERING_GATES).toBe("FAIL");
    });
  });
});
