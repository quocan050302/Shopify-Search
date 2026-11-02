/**
 * SWAI KH-02 V12.4.3.5.0 — Amazon US Evidence Gate Evaluator
 *
 * Implements `evaluateAmazonUsEvidenceGate(runId, evidenceRows, invocationLedger, policyContext)`
 * with strict separation between:
 * - `ENGINEERING_READY` (self-testable engineering contracts, lineage, hashing, policy guards)
 * - `REAL_PROVIDER_VERIFIED` (requires >=3 authorized live US product identities with verified
 *    same-run + same-workspace invocation lineage, raw/extracted hashes, and non-synthetic IDs).
 *
 * Fixture (`TEST_FIXTURE`), cached (`CACHED`), or user-imported (`IMPORTED_BY_USER`) records
 * are strictly excluded from `REAL_PROVIDER_VERIFIED` counts (A16, A26).
 */

import {
  AmazonEvidenceGateEvaluation,
  AmazonPolicyContext,
  AmazonProductEvidence,
  AmazonProviderOperationRecord,
  resolveAmazonUsPolicyContext,
} from "./marketplaceEvidenceTypes";
import {
  computeAmazonCanonicalProductFamilyKey,
  isValidStrictAmazonAsin,
} from "./amazonUsIdentity";

export interface EvaluateAmazonEvidenceGateOptions {
  workspaceId?: string;
  requiredLiveTargets?: number;
  mcpSessionLifecycle?: {
    sessionId?: string | null;
    transportKind?: string | null;
    transportMode?: string | null;
    serverOrigin?: string | null;
    ownershipMode?: string | null;
    ownedChildPid?: number | null;
    startedAt?: string | null;
    lastToolCompletedAt?: string | null;
    closeStartedAt?: string | null;
    closeFinishedAt?: string | null;
    closedCleanly?: boolean | "UNKNOWN" | null;
    ownedChildPidTerminated?: boolean | "UNKNOWN" | null;
    closeError?: string | null;
    toolInvocationsCount?: number;
    observedOperationIds?: string[];
    allLiveOpsMatchSessionId?: boolean;
    sessionCreated?: boolean;
  } | null;
}

export function isFakeOrLocalAmazonRequestId(
  requestId: string | null | undefined,
  localInvocationRef?: string | null
): boolean {
  if (!requestId || typeof requestId !== "string") return true;
  const trimmed = requestId.trim();
  if (!trimmed) return true;
  if (localInvocationRef && trimmed === localInvocationRef.trim()) return true;
  return /^(?:amz_inv_|mcp_inv_|local_inv_|pw_mcp_|synthetic_|fake_|unknown|null|undefined)/i.test(
    trimmed
  );
}

export function evaluateAmazonUsEvidenceGate(
  runId: string,
  evidenceRows: AmazonProductEvidence[],
  invocationLedger: AmazonProviderOperationRecord[],
  policyContext: AmazonPolicyContext = resolveAmazonUsPolicyContext(),
  options: EvaluateAmazonEvidenceGateOptions = {}
): AmazonEvidenceGateEvaluation {
  const evaluatedAt = new Date().toISOString();
  const cleanRunId = (runId || "").trim();
  const expectedWorkspaceId =
    options.workspaceId?.trim() ||
    evidenceRows[0]?.workspaceId ||
    invocationLedger[0]?.workspaceId ||
    "default-workspace";
  const requiredLiveTargets = options.requiredLiveTargets ?? 3;

  const reasons: string[] = [];
  const blockers: string[] = [];
  let engineeringIntegrityOk = true;

  // Map invocations by providerInvocationRef for strict same-run + workspace + hash verification
  const invocationByRef = new Map<string, AmazonProviderOperationRecord>();
  for (const op of invocationLedger || []) {
    if (!op || !op.providerInvocationRef) continue;
    // A17 check: if providerRequestId is present, it must not equal providerInvocationRef or a local prefix
    if (
      op.providerRequestId !== null &&
      isFakeOrLocalAmazonRequestId(op.providerRequestId, op.providerInvocationRef)
    ) {
      engineeringIntegrityOk = false;
      blockers.push(
        `INVALID_UPSTREAM_REQUEST_ID: Operation '${op.operationId}' has local/synthetic providerRequestId '${op.providerRequestId}'.`
      );
    }
    invocationByRef.set(op.providerInvocationRef, op);
  }

  let sameRunWorkspaceVerifiedRows = 0;
  let authorizedLiveRows = 0;
  let fixtureOrCachedRowsExcludedFromLive = 0;
  let identityExactMatchCount = 0;
  let identityProbableMatchCount = 0;
  let brandOnlyMatchCount = 0;
  let rejectedCount = 0;
  const verifiedLiveAsins = new Set<string>();
  const verifiedLiveCandidateIds = new Set<string>();
  const eligibleVerifiedLiveRows: AmazonProductEvidence[] = [];
  let usDeliveryConfirmedCount = 0;
  let observedUsdPriceCount = 0;

  for (const row of evidenceRows || []) {
    if (!row) continue;

    // A17 check on evidence row
    if (
      row.providerRequestId !== null &&
      isFakeOrLocalAmazonRequestId(row.providerRequestId, row.providerInvocationRef)
    ) {
      engineeringIntegrityOk = false;
      blockers.push(
        `INVALID_EVIDENCE_REQUEST_ID: Evidence '${row.id}' conflates local ref with upstream providerRequestId '${row.providerRequestId}'.`
      );
    }

    // Never allow SALES_VERIFIED on verificationScope
    if ((row.verificationScope as any) === "SALES_VERIFIED") {
      engineeringIntegrityOk = false;
      blockers.push(
        `FORBIDDEN_VERIFICATION_SCOPE: Evidence '${row.id}' claims SALES_VERIFIED from listing observation.`
      );
    }

    const sameRunAndWorkspace =
      Boolean(cleanRunId) &&
      row.researchRunId === cleanRunId &&
      row.workspaceId === expectedWorkspaceId;

    if (!sameRunAndWorkspace) {
      rejectedCount++;
      continue;
    }

    sameRunWorkspaceVerifiedRows++;

    if (row.rejectionReasons.length > 0 || row.status === "FAILED") {
      rejectedCount++;
      continue;
    }

    if (row.identityMatch === "EXACT_PRODUCT") {
      identityExactMatchCount++;
    } else if (row.identityMatch === "PROBABLE_PRODUCT") {
      identityProbableMatchCount++;
    } else if (row.identityMatch === "BRAND_ONLY") {
      brandOnlyMatchCount++;
    }

    // Check if row is fixture, cached, local test double, or user-imported -> never count as AUTHORIZED_LIVE
    if (
      row.isCached ||
      row.observationClass === "TEST_FIXTURE" ||
      row.observationClass === "CACHED" ||
      row.observationClass === "IMPORTED_BY_USER" ||
      row.observationClass === "UNVERIFIED" ||
      row.requestMode === "TEST_FIXTURE" ||
      row.requestMode === "USER_IMPORTED" ||
      row.providerSourceOrigin === "LOCAL_MCP_TEST_DOUBLE" ||
      row.providerSourceOrigin === "TEST_FIXTURE" ||
      row.providerSourceOrigin === "USER_IMPORTED"
    ) {
      fixtureOrCachedRowsExcludedFromLive++;
      continue;
    }

    // For AUTHORIZED_LIVE, require policy liveAllowed, matching invocation ledger entry, valid hashes, and valid ASIN
    const linkedInvocation = row.providerInvocationRef
      ? invocationByRef.get(row.providerInvocationRef)
      : undefined;

    const hasNonEmptyHashes = Boolean(
      row.rawEvidenceHash &&
        String(row.rawEvidenceHash).trim().length >= 8 &&
        row.extractedFieldsHash &&
        String(row.extractedFieldsHash).trim().length >= 8 &&
        linkedInvocation?.responseHash &&
        String(linkedInvocation.responseHash).trim().length >= 8
    );

    const hasValidLiveLineage = Boolean(
      policyContext.featureEnabled &&
        policyContext.liveAllowed &&
        (policyContext.accessPolicyStatus === "AUTHORIZED_CREATORS_API" ||
          policyContext.accessPolicyStatus === "AUTHORIZED_USER_LIMITED_URL") &&
        row.observationClass === "AUTHORIZED_LIVE" &&
        linkedInvocation &&
        linkedInvocation.researchRunId === cleanRunId &&
        linkedInvocation.workspaceId === expectedWorkspaceId &&
        linkedInvocation.observationClass === "AUTHORIZED_LIVE" &&
        !linkedInvocation.aborted &&
        hasNonEmptyHashes &&
        linkedInvocation.responseHash === row.rawEvidenceHash &&
        row.asin &&
        isValidStrictAmazonAsin(row.asin)
    );

    if (!hasValidLiveLineage) {
      // If a row claims AUTHORIZED_LIVE without valid live lineage or when policy is blocked, fail engineering integrity
      if (row.observationClass === "AUTHORIZED_LIVE") {
        engineeringIntegrityOk = false;
        blockers.push(
          `UNVERIFIED_LIVE_CLAIM: Evidence '${row.id}' claims AUTHORIZED_LIVE without verified policy authorization and matching invocation hash.`
        );
      }
      continue;
    }

    authorizedLiveRows++;
    if (
      row.identityMatch === "EXACT_PRODUCT" &&
      row.status === "IDENTITY_VERIFIED" &&
      row.asin
    ) {
      verifiedLiveAsins.add(row.asin);
      if (row.candidateId) {
        verifiedLiveCandidateIds.add(row.candidateId);
      }
      eligibleVerifiedLiveRows.push(row);
      if (
        row.verifiedDeliveryMarket === "US" &&
        row.observedDeliveryPostalCode &&
        /^\d{5}$/.test(String(row.observedDeliveryPostalCode).trim())
      ) {
        usDeliveryConfirmedCount++;
      } else if (row.verifiedDeliveryMarket === "US") {
        usDeliveryConfirmedCount++;
      }
      if (
        typeof row.price === "number" &&
        Number.isFinite(row.price) &&
        row.price > 0 &&
        row.currency === "USD"
      ) {
        observedUsdPriceCount++;
      }
    }
  }

  // Compute canonical product families across eligibleVerifiedLiveRows, merging any parent/child ASIN overlaps
  const familyKeyByAsin = new Map<string, string>();
  for (const row of eligibleVerifiedLiveRows) {
    const asin = row.asin!;
    const computedKey =
      row.productFamilyKey ||
      computeAmazonCanonicalProductFamilyKey({
        asin: row.asin,
        parentAsin: row.parentAsin,
        productTitle: row.productTitle,
        brand: row.brand,
        modelNumber: row.modelNumber,
        sku: row.sku,
        gtin: row.gtin,
      });
    familyKeyByAsin.set(asin, computedKey);
  }
  // Union any rows where row.parentAsin matches another row's asin or parentAsin (N09)
  for (const row of eligibleVerifiedLiveRows) {
    const asin = row.asin!;
    const pAsin = row.parentAsin ? String(row.parentAsin).trim().toUpperCase() : null;
    if (pAsin) {
      const parentMappedKey = familyKeyByAsin.get(pAsin);
      if (parentMappedKey) {
        familyKeyByAsin.set(asin, parentMappedKey);
      } else {
        for (const other of eligibleVerifiedLiveRows) {
          if (other.asin && other.parentAsin === pAsin) {
            const existingKey = familyKeyByAsin.get(other.asin);
            if (existingKey) {
              familyKeyByAsin.set(asin, existingKey);
              break;
            }
          }
        }
      }
    }
  }

  const distinctProductFamiliesSet = new Set<string>(familyKeyByAsin.values());
  const distinctVerifiedProductFamilies = distinctProductFamiliesSet.size;
  const distinctCandidateIds = verifiedLiveCandidateIds.size;
  const verifiedLiveAsinsList = Array.from(verifiedLiveAsins);
  const verifiedLiveUsProductIdentitiesCount = verifiedLiveAsins.size;

  const isCreatorsApiRoute =
    policyContext.accessPolicyStatus === "AUTHORIZED_CREATORS_API" ||
    policyContext.allowedAccessRoute === "OFFICIAL_CREATORS_API";
  const liveMcpOps = (invocationLedger || []).filter(
    (op) =>
      Boolean(op) &&
      op.observationClass === "AUTHORIZED_LIVE" &&
      Boolean(op.transportSessionId)
  );

  let mcpSessionClosedCleanly: boolean | null = null;
  if (options.mcpSessionLifecycle === undefined || options.mcpSessionLifecycle === null) {
    if (!isCreatorsApiRoute && (liveMcpOps.length > 0 || eligibleVerifiedLiveRows.length > 0)) {
      mcpSessionClosedCleanly = false;
      blockers.push(
        "MCP_SESSION_CLOSURE_UNPROVEN: Live Playwright MCP operations executed without a verified session lifecycle closure receipt."
      );
    } else {
      mcpSessionClosedCleanly = null;
    }
  } else {
    const lc = options.mcpSessionLifecycle;
    if (lc.ownershipMode === "NONE" && lc.sessionCreated === false && liveMcpOps.length === 0) {
      mcpSessionClosedCleanly = null;
    } else {
      const lcSessionId =
        typeof lc.sessionId === "string" && lc.sessionId.trim().length > 0
          ? lc.sessionId.trim()
          : null;
      const lcTransport = lc.transportMode || lc.transportKind || null;
      const lcOrigin =
        lc.serverOrigin ||
        (lcTransport === "REAL_STDIO_MCP" ? "PINNED_PLAYWRIGHT_MCP" : null);
      const lcClosed =
        lc.closedCleanly === true && lc.ownedChildPidTerminated === true;
      const sessionMismatch =
        liveMcpOps.length > 0 &&
        (!lcSessionId ||
          liveMcpOps.some((op) => op.transportSessionId !== lcSessionId));
      const closeStartedMs = lc.closeStartedAt ? Date.parse(lc.closeStartedAt) : NaN;
      const closedBeforeOpFinish =
        Number.isFinite(closeStartedMs) &&
        liveMcpOps.some(
          (op) =>
            Boolean(op.completedAt) &&
            Number.isFinite(Date.parse(op.completedAt)) &&
            closeStartedMs < Date.parse(op.completedAt)
        );
      const invalidLiveMcpOrigin =
        liveMcpOps.length > 0 &&
        (lcTransport !== "REAL_STDIO_MCP" || lcOrigin !== "PINNED_PLAYWRIGHT_MCP");

      mcpSessionClosedCleanly =
        lcClosed && !sessionMismatch && !closedBeforeOpFinish && !invalidLiveMcpOrigin;

      if (!mcpSessionClosedCleanly) {
        engineeringIntegrityOk = false;
        if (!lcClosed) {
          blockers.push(
            "MCP_SESSION_NOT_CLOSED_CLEANLY: Owned Playwright MCP session or child PID was not cleanly terminated."
          );
        }
        if (sessionMismatch) {
          blockers.push(
            `MCP_SESSION_ID_MISMATCH: Live MCP operation transportSessionId does not match closed MCP sessionId '${lcSessionId || "null"}'.`
          );
        }
        if (closedBeforeOpFinish) {
          blockers.push(
            "MCP_SESSION_CLOSED_BEFORE_OPERATIONS_COMPLETED: Session closeStartedAt precedes operation completedAt."
          );
        }
        if (invalidLiveMcpOrigin) {
          blockers.push(
            `MCP_SESSION_ORIGIN_NOT_AUTHENTIC: Live Playwright MCP gate requires REAL_STDIO_MCP and PINNED_PLAYWRIGHT_MCP origin (observed transport=${lcTransport || "null"}, origin=${lcOrigin || "null"}).`
          );
        }
      }
    }
  }

  const mcpSessionRequirementMet =
    isCreatorsApiRoute && liveMcpOps.length === 0
      ? mcpSessionClosedCleanly !== false
      : mcpSessionClosedCleanly === true;

  const requiredLiveTargetsMet = Boolean(
    verifiedLiveUsProductIdentitiesCount >= requiredLiveTargets &&
      distinctVerifiedProductFamilies >= requiredLiveTargets &&
      distinctCandidateIds >= requiredLiveTargets &&
      mcpSessionRequirementMet
  );

  const engineeringVerdict = engineeringIntegrityOk
    ? "ENGINEERING_READY"
    : "ENGINEERING_FAILED";

  let realProviderVerdict: AmazonEvidenceGateEvaluation["realProviderVerdict"] =
    "NOT_ATTEMPTED";

  if (!policyContext.featureEnabled) {
    realProviderVerdict = "DISABLED";
    blockers.push(policyContext.policyReason);
  } else if (
    !policyContext.liveAllowed ||
    policyContext.accessPolicyStatus === "LIVE_NOT_ALLOWED" ||
    policyContext.accessPolicyStatus === "CREDENTIALS_REQUIRED" ||
    policyContext.accessPolicyStatus === "ACCESS_NOT_GRANTED" ||
    policyContext.accessPolicyStatus === "BLOCKED_POLICY" ||
    policyContext.accessPolicyStatus === "FIXTURE_OR_USER_IMPORT_ONLY"
  ) {
    realProviderVerdict = "BLOCKED_POLICY";
    blockers.push(policyContext.policyReason);
  } else if (
    invocationLedger.some(
      (op) =>
        op.status === "BLOCKED_PROVIDER" ||
        op.status === "AUTHENTICATION_FAILED" ||
        op.status === "ACCESS_NOT_GRANTED" ||
        op.status === "CREDENTIALS_REQUIRED" ||
        op.status === "PROVIDER_ERROR" ||
        op.status === "MCP_NOT_CONFIGURED" ||
        op.status === "NOT_EXECUTED" ||
        op.status === "CAPTCHA_BLOCKED" ||
        op.status === "RATE_LIMITED"
    ) &&
    !requiredLiveTargetsMet
  ) {
    realProviderVerdict = "BLOCKED_PROVIDER";
    blockers.push(
      `Upstream provider or MCP session blocked/unavailable (${distinctVerifiedProductFamilies}/${requiredLiveTargets} distinct product families verified; ${verifiedLiveUsProductIdentitiesCount} raw ASINs).`
    );
  } else if (requiredLiveTargetsMet) {
    realProviderVerdict = "REAL_PROVIDER_VERIFIED";
    reasons.push(
      `Verified ${distinctVerifiedProductFamilies}/${requiredLiveTargets} distinct authorized live US Amazon product families (${verifiedLiveUsProductIdentitiesCount} ASINs across ${distinctCandidateIds} candidates).`
    );
  } else if (invocationLedger.length === 0 && evidenceRows.length === 0) {
    realProviderVerdict = "NOT_ATTEMPTED";
    blockers.push("No live Amazon US provider operations were attempted in this run.");
  } else {
    realProviderVerdict = "INSUFFICIENT_EVIDENCE";
    if (
      verifiedLiveUsProductIdentitiesCount >= requiredLiveTargets &&
      distinctVerifiedProductFamilies < requiredLiveTargets
    ) {
      blockers.push(
        `DUPLICATE_PRODUCT_FAMILY_INSUFFICIENT: Observed ${verifiedLiveUsProductIdentitiesCount} live ASINs (${verifiedLiveAsinsList.join(", ")}) but only ${distinctVerifiedProductFamilies}/${requiredLiveTargets} distinct product families (${Array.from(distinctProductFamiliesSet).join(", ")}). Variants of the same product family cannot satisfy the ${requiredLiveTargets}-product requirement.`
      );
    } else {
      blockers.push(
        `Observed ${distinctVerifiedProductFamilies}/${requiredLiveTargets} distinct verified live US Amazon product families (${verifiedLiveUsProductIdentitiesCount} raw ASINs; fixtures/cached excluded: ${fixtureOrCachedRowsExcludedFromLive}).`
      );
    }
  }

  let overallPilotStatus: AmazonEvidenceGateEvaluation["overallPilotStatus"] =
    "ENGINEERING_COMPLETE_EXTERNAL_BLOCKED";
  if (engineeringVerdict === "ENGINEERING_FAILED") {
    overallPilotStatus = "ENGINEERING_FAILED";
  } else if (realProviderVerdict === "REAL_PROVIDER_VERIFIED") {
    overallPilotStatus = "FEATURE_ACCEPTED";
  } else {
    overallPilotStatus = "ENGINEERING_COMPLETE_EXTERNAL_BLOCKED";
  }

  reasons.push(
    `Engineering gate=${engineeringVerdict}; Real provider gate=${realProviderVerdict}; G15/G16 business gates untouched.`
  );

  return {
    evaluatedAt,
    researchRunId: cleanRunId,
    workspaceId: expectedWorkspaceId,
    provider: "AMAZON_US",
    engineeringVerdict,
    realProviderVerdict,
    overallPilotStatus,
    policyStatus: policyContext.accessPolicyStatus,
    verifiedLiveAsins: verifiedLiveAsinsList,
    distinctVerifiedProductFamilies,
    distinctVerifiedProductFamilyKeys: Array.from(distinctProductFamiliesSet),
    distinctCandidateIds,
    usDeliveryConfirmedCount,
    USDeliveryConfirmedCount: usDeliveryConfirmedCount,
    observedUsdPriceCount,
    requiredLiveTargetsMet,
    mcpSessionClosedCleanly,
    mcpSessionLifecycle: (options.mcpSessionLifecycle as any) ?? null,
    counts: {
      totalEvidenceRows: (evidenceRows || []).length,
      sameRunWorkspaceVerifiedRows,
      authorizedLiveRows,
      fixtureOrCachedRowsExcludedFromLive,
      identityExactMatchCount,
      identityProbableMatchCount,
      brandOnlyMatchCount,
      rejectedCount,
      verifiedLiveUsProductIdentitiesCount,
      requiredLiveUsProductIdentitiesTarget: requiredLiveTargets,
      distinctVerifiedProductFamiliesCount: distinctVerifiedProductFamilies,
      distinctCandidateIdsCount: distinctCandidateIds,
      usDeliveryConfirmedCount,
      observedUsdPriceCount,
    },
    g15DemandUnchanged: true,
    g16MerchantGateUnchanged: true,
    reasons,
    blockers,
  };
}
