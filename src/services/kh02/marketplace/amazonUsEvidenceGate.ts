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
import { isValidStrictAmazonAsin } from "./amazonUsIdentity";

export interface EvaluateAmazonEvidenceGateOptions {
  workspaceId?: string;
  requiredLiveTargets?: number;
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
        row.rawEvidenceHash &&
        row.extractedFieldsHash &&
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
    }
  }

  const verifiedLiveUsProductIdentitiesCount = verifiedLiveAsins.size;
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
    verifiedLiveUsProductIdentitiesCount < requiredLiveTargets
  ) {
    realProviderVerdict = "BLOCKED_PROVIDER";
    blockers.push(
      `Upstream provider or MCP session blocked/unavailable (${verifiedLiveUsProductIdentitiesCount}/${requiredLiveTargets} live US identities verified).`
    );
  } else if (verifiedLiveUsProductIdentitiesCount >= requiredLiveTargets) {
    realProviderVerdict = "REAL_PROVIDER_VERIFIED";
    reasons.push(
      `Verified ${verifiedLiveUsProductIdentitiesCount}/${requiredLiveTargets} distinct authorized live US Amazon product identities.`
    );
  } else if (invocationLedger.length === 0 && evidenceRows.length === 0) {
    realProviderVerdict = "NOT_ATTEMPTED";
    blockers.push("No live Amazon US provider operations were attempted in this run.");
  } else {
    realProviderVerdict = "INSUFFICIENT_EVIDENCE";
    blockers.push(
      `Observed ${verifiedLiveUsProductIdentitiesCount}/${requiredLiveTargets} verified live US Amazon product identities (fixtures/cached excluded: ${fixtureOrCachedRowsExcludedFromLive}).`
    );
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
    },
    g15DemandUnchanged: true,
    g16MerchantGateUnchanged: true,
    reasons,
    blockers,
  };
}
