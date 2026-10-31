/**
 * SWAI KH-02 V12.4.3.5.0 — Amazon US Product Evidence Adapter & Pilot Enrichment Runner
 *
 * Implements:
 * - classifyAmazonProviderOutcome(error, response)
 * - fetchAuthorizedAmazonProductEvidence(input)
 * - runAmazonUsPilotEnrichment(params)
 */

import crypto from "crypto";
import {
  AmazonMarketplaceTelemetry,
  AmazonPolicyContext,
  AmazonProductEvidence,
  AmazonProviderOperationRecord,
  AmazonRequestMode,
  MarketplaceEvidenceStatus,
  MarketplaceObservationClass,
  computeDeterministicEvidenceHash,
  resolveAmazonUsPolicyContext,
} from "./marketplaceEvidenceTypes";
import {
  RawAmazonSnapshotInput,
  parseAmazonProductEvidence,
  validateAmazonUsProductUrl,
  verifyAmazonProductIdentity,
} from "./amazonUsIdentity";
import {
  AMAZON_PILOT_MAX_CANDIDATES_PER_RUN,
  AmazonProviderBudget,
  createAmazonProviderBudget,
} from "./amazonUsBudget";
import {
  AmazonPlaywrightMcpSession,
  connectAmazonPlaywrightMcp,
} from "./amazonUsMcpTransport";
import { evaluateAmazonUsEvidenceGate } from "./amazonUsEvidenceGate";

export interface ClassifiedAmazonProviderOutcome {
  status: MarketplaceEvidenceStatus;
  outcomeCategory:
    | "POLICY_BLOCKED"
    | "PROVIDER_ACCESS_DENIED"
    | "RATE_LIMITED"
    | "CAPTCHA_CHALLENGE"
    | "TIMED_OUT"
    | "EMPTY_OR_UNAVAILABLE"
    | "PARSER_OR_SCHEMA_REJECTED"
    | "OBSERVED_SUCCESS";
  retryable: boolean;
  isExternalBlock: boolean;
  reason: string;
}

/**
 * Classifies errors and upstream responses into honest MarketplaceEvidenceStatus outcomes.
 * Never defaults to silent PASS.
 */
export function classifyAmazonProviderOutcome(
  error: unknown,
  response?: {
    httpStatus?: number | null;
    html?: string | null;
    pageTitle?: string | null;
    parsedEvidence?: AmazonProductEvidence | null;
  } | null
): ClassifiedAmazonProviderOutcome {
  if (error) {
    const msg = error instanceof Error ? error.message : String(error);
    const lower = msg.toLowerCase();

    if (lower.includes("blocked_policy") || lower.includes("live_not_allowed")) {
      return {
        status: "BLOCKED_POLICY",
        outcomeCategory: "POLICY_BLOCKED",
        retryable: false,
        isExternalBlock: true,
        reason: msg,
      };
    }

    if (lower.includes("429") || lower.includes("rate_limit") || lower.includes("rolling_window")) {
      return {
        status: "RATE_LIMITED",
        outcomeCategory: "RATE_LIMITED",
        retryable: false,
        isExternalBlock: true,
        reason: msg,
      };
    }

    if (lower.includes("captcha") || lower.includes("not a robot")) {
      return {
        status: "CAPTCHA_BLOCKED",
        outcomeCategory: "CAPTCHA_CHALLENGE",
        retryable: false,
        isExternalBlock: true,
        reason: msg,
      };
    }

    if (lower.includes("timed_out") || lower.includes("timeout") || lower.includes("deadline")) {
      return {
        status: "TIMED_OUT",
        outcomeCategory: "TIMED_OUT",
        retryable: true,
        isExternalBlock: false,
        reason: msg,
      };
    }

    if (
      lower.includes("403") ||
      lower.includes("503") ||
      lower.includes("bot_wall") ||
      lower.includes("login") ||
      lower.includes("blocked_provider") ||
      lower.includes("mcp_not_configured")
    ) {
      return {
        status: "BLOCKED_PROVIDER",
        outcomeCategory: "PROVIDER_ACCESS_DENIED",
        retryable: false,
        isExternalBlock: true,
        reason: msg,
      };
    }

    return {
      status: "FAILED",
      outcomeCategory: "PARSER_OR_SCHEMA_REJECTED",
      retryable: false,
      isExternalBlock: false,
      reason: msg,
    };
  }

  if (response?.parsedEvidence) {
    const ev = response.parsedEvidence;
    if (ev.status === "CAPTCHA_BLOCKED") {
      return {
        status: "CAPTCHA_BLOCKED",
        outcomeCategory: "CAPTCHA_CHALLENGE",
        retryable: false,
        isExternalBlock: true,
        reason: ev.rejectionReasons.join("; ") || "CAPTCHA challenge detected",
      };
    }
    if (ev.status === "RATE_LIMITED") {
      return {
        status: "RATE_LIMITED",
        outcomeCategory: "RATE_LIMITED",
        retryable: false,
        isExternalBlock: true,
        reason: ev.rejectionReasons.join("; ") || "HTTP 429 rate limited",
      };
    }
    if (ev.status === "BLOCKED_PROVIDER") {
      return {
        status: "BLOCKED_PROVIDER",
        outcomeCategory: "PROVIDER_ACCESS_DENIED",
        retryable: false,
        isExternalBlock: true,
        reason: ev.rejectionReasons.join("; ") || "Provider blocked access",
      };
    }
    if (ev.status === "QUERY_SUCCEEDED_EMPTY") {
      return {
        status: "QUERY_SUCCEEDED_EMPTY",
        outcomeCategory: "EMPTY_OR_UNAVAILABLE",
        retryable: false,
        isExternalBlock: false,
        reason: ev.rejectionReasons.join("; ") || "Product unavailable or empty page",
      };
    }
    if (ev.status === "FAILED" || ev.rejectionReasons.length > 0) {
      return {
        status: "FAILED",
        outcomeCategory: "PARSER_OR_SCHEMA_REJECTED",
        retryable: false,
        isExternalBlock: false,
        reason: ev.rejectionReasons.join("; ") || "Parser or identity rejection",
      };
    }
    return {
      status: ev.status,
      outcomeCategory: "OBSERVED_SUCCESS",
      retryable: false,
      isExternalBlock: false,
      reason: "Product evidence observed and parsed",
    };
  }

  const httpStatus = response?.httpStatus ?? null;
  const combined = `${response?.pageTitle || ""} ${response?.html || ""}`;

  if (httpStatus === 429 || /429\s+too\s+many\s+requests|rate\s+limit/i.test(combined)) {
    return {
      status: "RATE_LIMITED",
      outcomeCategory: "RATE_LIMITED",
      retryable: false,
      isExternalBlock: true,
      reason: "HTTP 429 or rate limit response",
    };
  }
  if (/validateCaptcha|opfcaptcha|not a robot/i.test(combined)) {
    return {
      status: "CAPTCHA_BLOCKED",
      outcomeCategory: "CAPTCHA_CHALLENGE",
      retryable: false,
      isExternalBlock: true,
      reason: "Amazon CAPTCHA challenge detected",
    };
  }
  if (httpStatus === 403 || httpStatus === 503 || /automated access|request blocked/i.test(combined)) {
    return {
      status: "BLOCKED_PROVIDER",
      outcomeCategory: "PROVIDER_ACCESS_DENIED",
      retryable: false,
      isExternalBlock: true,
      reason: `HTTP ${httpStatus || 403} provider access blocked`,
    };
  }
  if (httpStatus === 404 || !combined.trim()) {
    return {
      status: "QUERY_SUCCEEDED_EMPTY",
      outcomeCategory: "EMPTY_OR_UNAVAILABLE",
      retryable: false,
      isExternalBlock: false,
      reason: "Empty or 404 product response",
    };
  }

  return {
    status: "FAILED",
    outcomeCategory: "PARSER_OR_SCHEMA_REJECTED",
    retryable: false,
    isExternalBlock: false,
    reason: "Unsupported or unparseable provider response",
  };
}

export interface FetchAuthorizedAmazonEvidenceInput {
  workspaceId: string;
  researchRunId: string;
  candidateId: string;
  sourceUrl: string;
  candidate: {
    candidateId: string;
    title?: string | null;
    canonicalProductName?: string | null;
    merchantVerifiedProductName?: string | null;
    brand?: string | null;
    storeDomain?: string | null;
    model?: string | null;
    sku?: string | null;
    gtin?: string | null;
    asin?: string | null;
  };
  requestMode?: AmazonRequestMode;
  policyContext?: AmazonPolicyContext;
  budget?: AmazonProviderBudget;
  mcpSession?: AmazonPlaywrightMcpSession | null;
  directSnapshotForImportOrFixture?: RawAmazonSnapshotInput | null;
  observedAt?: string;
  sourceTimestamp?: string | null;
  signal?: AbortSignal;
}

export interface FetchAuthorizedAmazonEvidenceResult {
  status: MarketplaceEvidenceStatus;
  evidence: AmazonProductEvidence | null;
  operationRecord: AmazonProviderOperationRecord | null;
}

/**
 * Fetches and verifies Amazon US product evidence for a single candidate URL.
 * Enforces policy FIRST, validates URL before any navigation, respects budget caps,
 * and never fabricates dummy product data.
 */
export async function fetchAuthorizedAmazonProductEvidence(
  input: FetchAuthorizedAmazonEvidenceInput
): Promise<FetchAuthorizedAmazonEvidenceResult> {
  const policy = input.policyContext || resolveAmazonUsPolicyContext();
  const startedAtMs = Date.now();
  const startedAt = input.observedAt || new Date(startedAtMs).toISOString();
  const requestMode: AmazonRequestMode = input.requestMode || "URL_VERIFICATION";

  // 1. If feature flag is OFF and not an explicit unit-test fixture call, do nothing
  if (!policy.featureEnabled && requestMode !== "TEST_FIXTURE") {
    return {
      status: "DISABLED",
      evidence: null,
      operationRecord: null,
    };
  }

  const opSeed = `${input.workspaceId}:${input.researchRunId}:${input.candidateId}:${input.sourceUrl}`;
  const opShortHash =
    computeDeterministicEvidenceHash(opSeed)?.slice(0, 12) ||
    crypto.randomBytes(4).toString("hex");
  const operationId = `amz_op_${opShortHash}`;
  const providerInvocationRef = `amz_inv_${input.researchRunId}_${input.candidateId}_${opShortHash}`;
  const requestHash = computeDeterministicEvidenceHash({
    workspaceId: input.workspaceId,
    researchRunId: input.researchRunId,
    candidateId: input.candidateId,
    sourceUrl: input.sourceUrl,
    requestMode,
  });

  // 2. Validate URL strictly before any policy/MCP execution
  const urlValidation = validateAmazonUsProductUrl(input.sourceUrl);
  if (!urlValidation.valid) {
    const completedAt = new Date().toISOString();
    const rejectedEv = parseAmazonProductEvidence(
      { sourceUrl: input.sourceUrl },
      {
        workspaceId: input.workspaceId,
        researchRunId: input.researchRunId,
        candidateId: input.candidateId,
        observedAt: startedAt,
        providerInvocationRef,
        providerRequestId: null,
        observationClass:
          requestMode === "TEST_FIXTURE"
            ? "TEST_FIXTURE"
            : requestMode === "USER_IMPORTED"
            ? "IMPORTED_BY_USER"
            : "UNVERIFIED",
        requestMode,
        accessPolicyStatus: policy.accessPolicyStatus,
      }
    );

    const opRecord: AmazonProviderOperationRecord = {
      operationId,
      providerInvocationRef,
      providerRequestId: null,
      providerRequestIdOrigin: "ABSENT",
      workspaceId: input.workspaceId,
      researchRunId: input.researchRunId,
      candidateId: input.candidateId,
      provider: "AMAZON_US",
      requestMode,
      sourceUrl: input.sourceUrl,
      finalUrl: null,
      attemptCount: 0,
      maxAttemptsAllowed: 2,
      startedAt,
      completedAt,
      durationMs: Math.max(0, Date.now() - startedAtMs),
      requestHash,
      responseHash: rejectedEv.rawEvidenceHash,
      status: "FAILED",
      outcomeCategory: "URL_VALIDATION_REJECTED",
      observationClass: rejectedEv.observationClass,
      transportSessionId: input.mcpSession?.sessionId || null,
      aborted: false,
      errorMessage: urlValidation.rejectionReason,
    };

    return {
      status: "FAILED",
      evidence: rejectedEv,
      operationRecord: opRecord,
    };
  }

  // 3. Enforce Live Policy Gate (A02): If live URL_VERIFICATION or AUTHORIZED_SEARCH is requested without liveAllowed, block before browser navigation!
  const isFixtureOrImport =
    requestMode === "TEST_FIXTURE" ||
    requestMode === "USER_IMPORTED" ||
    input.mcpSession?.transportMode === "TEST_FIXTURE";

  if (!isFixtureOrImport && !policy.liveAllowed) {
    const completedAt = new Date().toISOString();
    const idSeed = `${input.workspaceId}:${input.researchRunId}:${input.candidateId}:AMAZON_US:${urlValidation.extractedAsin || "BLOCKED"}`;
    const idHash = computeDeterministicEvidenceHash(idSeed)?.slice(0, 20) || "blocked";

    const blockedEvidence: AmazonProductEvidence = {
      id: `amz_ev_${idHash}`,
      workspaceId: input.workspaceId,
      researchRunId: input.researchRunId,
      candidateId: input.candidateId,
      provider: "AMAZON_US",
      requestMode,
      requestedMarket: "US",
      verifiedDeliveryMarket: null,
      sourceUrl: input.sourceUrl,
      finalUrl: null,
      canonicalAmazonUrl: urlValidation.canonicalAmazonUrl,
      asin: urlValidation.extractedAsin,
      parentAsin: null,
      variationAsin: null,
      productTitle: null,
      brand: null,
      merchant: null,
      seller: null,
      currency: null,
      price: null,
      availability: null,
      observedAt: startedAt,
      sourceTimestamp: null,
      rawEvidenceHash: null,
      extractedFieldsHash: null,
      providerInvocationRef,
      providerRequestId: null,
      responseEvidenceRef: null,
      evidenceOrigin: "AMAZON_US_POLICY_GUARD",
      observationClass: "UNVERIFIED",
      verificationScope: null,
      identityMatch: "NO_MATCH",
      isCached: false,
      matchedCanonicalKey: urlValidation.extractedAsin
        ? `amz_us:${urlValidation.extractedAsin}`
        : null,
      matchingReasons: [],
      missingFields: ["productTitle", "brand", "price", "availability"],
      rejectionReasons: [`BLOCKED_POLICY: ${policy.policyReason}`],
      accessPolicyStatus: policy.accessPolicyStatus,
      status: "BLOCKED_POLICY",
    };

    const opRecord: AmazonProviderOperationRecord = {
      operationId,
      providerInvocationRef,
      providerRequestId: null,
      providerRequestIdOrigin: "ABSENT",
      workspaceId: input.workspaceId,
      researchRunId: input.researchRunId,
      candidateId: input.candidateId,
      provider: "AMAZON_US",
      requestMode,
      sourceUrl: input.sourceUrl,
      finalUrl: null,
      attemptCount: 0,
      maxAttemptsAllowed: 2,
      startedAt,
      completedAt,
      durationMs: Math.max(0, Date.now() - startedAtMs),
      requestHash,
      responseHash: null,
      status: "BLOCKED_POLICY",
      outcomeCategory: "POLICY_BLOCKED",
      observationClass: "UNVERIFIED",
      transportSessionId: null,
      aborted: false,
      errorMessage: policy.policyReason,
    };

    return {
      status: "BLOCKED_POLICY",
      evidence: blockedEvidence,
      operationRecord: opRecord,
    };
  }

  // 4. Execute within protective budget
  const budget =
    input.budget ||
    createAmazonProviderBudget({
      workspaceId: input.workspaceId,
      researchRunId: input.researchRunId,
      signal: input.signal,
      isolatedCoordinator: true,
    });

  if (input.mcpSession) {
    budget.registerCleanup(async () => {
      await input.mcpSession?.close();
    });
  }

  const observationClass: MarketplaceObservationClass =
    requestMode === "TEST_FIXTURE" || input.mcpSession?.transportMode === "TEST_FIXTURE"
      ? "TEST_FIXTURE"
      : requestMode === "USER_IMPORTED"
      ? "IMPORTED_BY_USER"
      : "AUTHORIZED_LIVE";

  let capturedUpstreamRequestId: string | null = null;
  let capturedFinalUrl: string | null = null;

  const execRes = await budget.executeBoundedOperation(
    `${input.candidateId}:${urlValidation.extractedAsin}`,
    async (_attempt, opSignal) => {
      if (input.directSnapshotForImportOrFixture && isFixtureOrImport) {
        capturedFinalUrl =
          input.directSnapshotForImportOrFixture.finalUrl ||
          input.directSnapshotForImportOrFixture.sourceUrl;
        return input.directSnapshotForImportOrFixture;
      }

      if (!input.mcpSession || !input.mcpSession.isAlive()) {
        throw new Error("MCP_NOT_CONFIGURED: No active Playwright MCP session available.");
      }

      const navOut = await input.mcpSession.navigateAndCaptureProductSnapshot(
        urlValidation.canonicalAmazonUrl || input.sourceUrl,
        { signal: opSignal }
      );
      capturedUpstreamRequestId = navOut.upstreamRequestId;
      capturedFinalUrl = navOut.snapshot.finalUrl || navOut.snapshot.sourceUrl;
      return navOut.snapshot;
    },
    {
      isExternalBlockResult: (snap) => {
        const check = classifyAmazonProviderOutcome(null, {
          httpStatus: snap.httpStatus,
          html: snap.html,
          pageTitle: snap.pageTitle,
        });
        return check.isExternalBlock;
      },
    }
  );

  const completedAt = new Date().toISOString();

  if (execRes.aborted) {
    const opRecord: AmazonProviderOperationRecord = {
      operationId,
      providerInvocationRef,
      providerRequestId: null,
      providerRequestIdOrigin: "ABSENT",
      workspaceId: input.workspaceId,
      researchRunId: input.researchRunId,
      candidateId: input.candidateId,
      provider: "AMAZON_US",
      requestMode,
      sourceUrl: input.sourceUrl,
      finalUrl: capturedFinalUrl,
      attemptCount: execRes.attemptCount,
      maxAttemptsAllowed: budget.maxAttemptsPerOperation,
      startedAt,
      completedAt,
      durationMs: Math.max(0, Date.now() - startedAtMs),
      requestHash,
      responseHash: null,
      status: "TIMED_OUT",
      outcomeCategory: "ABORTED_OR_TIMED_OUT",
      observationClass,
      transportSessionId: input.mcpSession?.sessionId || null,
      aborted: true,
      errorMessage: execRes.error || "Operation aborted",
    };
    return {
      status: "TIMED_OUT",
      evidence: null,
      operationRecord: opRecord,
    };
  }

  if (execRes.blockedDecision && !execRes.executed) {
    const isRateLimit =
      execRes.blockedDecision.reasonCode === "ROLLING_WINDOW_RATE_LIMITED" ||
      execRes.blockedDecision.reasonCode === "RUN_OPERATION_CAP_EXCEEDED";
    const status: MarketplaceEvidenceStatus = isRateLimit
      ? "RATE_LIMITED"
      : "BLOCKED_POLICY";
    const opRecord: AmazonProviderOperationRecord = {
      operationId,
      providerInvocationRef,
      providerRequestId: null,
      providerRequestIdOrigin: "ABSENT",
      workspaceId: input.workspaceId,
      researchRunId: input.researchRunId,
      candidateId: input.candidateId,
      provider: "AMAZON_US",
      requestMode,
      sourceUrl: input.sourceUrl,
      finalUrl: null,
      attemptCount: execRes.attemptCount,
      maxAttemptsAllowed: budget.maxAttemptsPerOperation,
      startedAt,
      completedAt,
      durationMs: Math.max(0, Date.now() - startedAtMs),
      requestHash,
      responseHash: null,
      status,
      outcomeCategory: execRes.blockedDecision.reasonCode,
      observationClass,
      transportSessionId: input.mcpSession?.sessionId || null,
      aborted: false,
      errorMessage: execRes.blockedDecision.reason,
    };
    return {
      status,
      evidence: null,
      operationRecord: opRecord,
    };
  }

  if (!execRes.result) {
    const classified = classifyAmazonProviderOutcome(
      new Error(execRes.error || "Operation failed")
    );
    const opRecord: AmazonProviderOperationRecord = {
      operationId,
      providerInvocationRef,
      providerRequestId: null,
      providerRequestIdOrigin: "ABSENT",
      workspaceId: input.workspaceId,
      researchRunId: input.researchRunId,
      candidateId: input.candidateId,
      provider: "AMAZON_US",
      requestMode,
      sourceUrl: input.sourceUrl,
      finalUrl: capturedFinalUrl,
      attemptCount: execRes.attemptCount,
      maxAttemptsAllowed: budget.maxAttemptsPerOperation,
      startedAt,
      completedAt,
      durationMs: Math.max(0, Date.now() - startedAtMs),
      requestHash,
      responseHash: null,
      status: classified.status,
      outcomeCategory: classified.outcomeCategory,
      observationClass,
      transportSessionId: input.mcpSession?.sessionId || null,
      aborted: false,
      errorMessage: classified.reason,
    };
    return {
      status: classified.status,
      evidence: null,
      operationRecord: opRecord,
    };
  }

  // Parse snapshot and verify candidate identity
  const parsed = parseAmazonProductEvidence(execRes.result, {
    workspaceId: input.workspaceId,
    researchRunId: input.researchRunId,
    candidateId: input.candidateId,
    observedAt: startedAt,
    sourceTimestamp: input.sourceTimestamp ?? null,
    providerInvocationRef,
    providerRequestId: capturedUpstreamRequestId,
    observationClass,
    requestMode,
    accessPolicyStatus: policy.accessPolicyStatus,
    isCached: false,
  });

  const verified = verifyAmazonProductIdentity(input.candidate, parsed);
  const finalEvidence = verified.updatedEvidence;
  const classifiedOutcome = classifyAmazonProviderOutcome(null, {
    parsedEvidence: finalEvidence,
  });

  if (classifiedOutcome.isExternalBlock) {
    budget.markExternalBlockEncountered(classifiedOutcome.reason);
  }

  const opRecord: AmazonProviderOperationRecord = {
    operationId,
    providerInvocationRef,
    providerRequestId: finalEvidence.providerRequestId,
    providerRequestIdOrigin: finalEvidence.providerRequestId ? "UPSTREAM" : "ABSENT",
    workspaceId: input.workspaceId,
    researchRunId: input.researchRunId,
    candidateId: input.candidateId,
    provider: "AMAZON_US",
    requestMode,
    sourceUrl: input.sourceUrl,
    finalUrl: finalEvidence.finalUrl,
    attemptCount: execRes.attemptCount,
    maxAttemptsAllowed: budget.maxAttemptsPerOperation,
    startedAt,
    completedAt,
    durationMs: Math.max(0, Date.now() - startedAtMs),
    requestHash,
    responseHash: finalEvidence.rawEvidenceHash,
    status: finalEvidence.status,
    outcomeCategory: classifiedOutcome.outcomeCategory,
    observationClass: finalEvidence.observationClass,
    transportSessionId: input.mcpSession?.sessionId || null,
    aborted: false,
    errorMessage:
      finalEvidence.rejectionReasons.length > 0
        ? finalEvidence.rejectionReasons.join("; ")
        : null,
  };

  return {
    status: finalEvidence.status,
    evidence: finalEvidence,
    operationRecord: opRecord,
  };
}

export interface RunAmazonUsPilotEnrichmentParams {
  workspaceId: string;
  researchRunId: string;
  optInRequested?: boolean;
  candidates: Array<{
    candidateId: string;
    title?: string | null;
    canonicalProductName?: string | null;
    merchantVerifiedProductName?: string | null;
    brand?: string | null;
    storeDomain?: string | null;
    model?: string | null;
    sku?: string | null;
    gtin?: string | null;
    asin?: string | null;
    amazonProductUrl?: string | null;
    [key: string]: any;
  }>;
  candidateAmazonUrls?: Record<string, string>;
  requestMode?: AmazonRequestMode;
  fixtureSnapshotsByUrl?: Record<string, RawAmazonSnapshotInput>;
  mcpSession?: AmazonPlaywrightMcpSession | null;
  signal?: AbortSignal;
  env?: NodeJS.ProcessEnv;
  reportProgress?: (message: string) => Promise<void>;
}

/**
 * Enriches up to 3 shortlisted KH-02 candidates with bounded Amazon US product evidence.
 * Never replaces Meta/Google discovery, never modifies opportunity scores or G15/G16,
 * and never fails the parent KH-02 run when Amazon is disabled or policy-blocked.
 */
export async function runAmazonUsPilotEnrichment(
  params: RunAmazonUsPilotEnrichmentParams
): Promise<{
  marketplaceEvidence: AmazonProductEvidence[];
  marketplaceTelemetry: AmazonMarketplaceTelemetry;
}> {
  const policy = resolveAmazonUsPolicyContext(params.env || process.env);
  const requestMode: AmazonRequestMode = params.requestMode || "URL_VERIFICATION";
  const isExplicitTestFixture =
    requestMode === "TEST_FIXTURE" ||
    requestMode === "USER_IMPORTED" ||
    Boolean(params.fixtureSnapshotsByUrl);

  // If server flag is OFF and not an explicit fixture/import test, return DISABLED with zero operations
  if (!policy.featureEnabled && !isExplicitTestFixture) {
    const gateEvaluation = evaluateAmazonUsEvidenceGate(
      params.researchRunId,
      [],
      [],
      policy,
      { workspaceId: params.workspaceId }
    );
    return {
      marketplaceEvidence: [],
      marketplaceTelemetry: {
        provider: "AMAZON_US",
        featureEnabled: false,
        liveAllowed: false,
        accessPolicyStatus: policy.accessPolicyStatus,
        allowedAccessRoute: policy.allowedAccessRoute,
        runStatus: "DISABLED",
        operationsAttempted: 0,
        operationsSucceeded: 0,
        operationsBlocked: 0,
        candidatesEvaluated: 0,
        identityVerifiedCount: 0,
        probableMatchCount: 0,
        brandOnlyCount: 0,
        rejectedCount: 0,
        notAttemptedCount: params.candidates.length,
        operationLedger: [],
        rejectionLedger: [],
        gateEvaluation,
      },
    };
  }

  if (!params.optInRequested && !isExplicitTestFixture) {
    const gateEvaluation = evaluateAmazonUsEvidenceGate(
      params.researchRunId,
      [],
      [],
      policy,
      { workspaceId: params.workspaceId }
    );
    return {
      marketplaceEvidence: [],
      marketplaceTelemetry: {
        provider: "AMAZON_US",
        featureEnabled: policy.featureEnabled,
        liveAllowed: policy.liveAllowed,
        accessPolicyStatus: policy.accessPolicyStatus,
        allowedAccessRoute: policy.allowedAccessRoute,
        runStatus: "NOT_ATTEMPTED",
        operationsAttempted: 0,
        operationsSucceeded: 0,
        operationsBlocked: 0,
        candidatesEvaluated: 0,
        identityVerifiedCount: 0,
        probableMatchCount: 0,
        brandOnlyCount: 0,
        rejectedCount: 0,
        notAttemptedCount: params.candidates.length,
        operationLedger: [],
        rejectionLedger: [],
        gateEvaluation,
      },
    };
  }

  const budget = createAmazonProviderBudget({
    workspaceId: params.workspaceId,
    researchRunId: params.researchRunId,
    signal: params.signal,
    isolatedCoordinator: true,
  });

  let ownedSession: AmazonPlaywrightMcpSession | null = params.mcpSession || null;
  let createdSessionInternally = false;

  if (!ownedSession && params.fixtureSnapshotsByUrl) {
    const conn = await connectAmazonPlaywrightMcp({
      signal: params.signal,
      fixtureTransport: {
        enabled: true,
        snapshotsByUrl: params.fixtureSnapshotsByUrl,
      },
    });
    ownedSession = conn.session;
    createdSessionInternally = true;
  }

  const marketplaceEvidence: AmazonProductEvidence[] = [];
  const operationLedger: AmazonProviderOperationRecord[] = [];
  const rejectionLedger: AmazonMarketplaceTelemetry["rejectionLedger"] = [];

  let notAttemptedCount = 0;
  let selectedPilotCandidatesCount = 0;

  try {
    for (const candidate of params.candidates) {
      if (params.signal?.aborted) break;

      const candidateUrl =
        params.candidateAmazonUrls?.[candidate.candidateId] ||
        candidate.amazonProductUrl ||
        null;

      // Candidates without an explicit Amazon URL are marked NOT_ATTEMPTED (not missing/not sold)
      if (!candidateUrl) {
        notAttemptedCount++;
        (candidate as any).amazonEvidenceStatus = "NOT_ATTEMPTED";
        continue;
      }

      // Bounded pilot cap: at most 3 candidate product URLs per run (A10)
      if (selectedPilotCandidatesCount >= AMAZON_PILOT_MAX_CANDIDATES_PER_RUN) {
        notAttemptedCount++;
        (candidate as any).amazonEvidenceStatus = "NOT_ATTEMPTED";
        continue;
      }

      selectedPilotCandidatesCount++;
      if (params.reportProgress) {
        await params
          .reportProgress(
            `Evaluating Amazon US pilot evidence (${selectedPilotCandidatesCount}/${AMAZON_PILOT_MAX_CANDIDATES_PER_RUN}) for ${candidate.title || candidate.candidateId}`
          )
          .catch(() => {});
      }

      const directSnap = params.fixtureSnapshotsByUrl?.[candidateUrl] || null;

      const res = await fetchAuthorizedAmazonProductEvidence({
        workspaceId: params.workspaceId,
        researchRunId: params.researchRunId,
        candidateId: candidate.candidateId,
        sourceUrl: candidateUrl,
        candidate,
        requestMode,
        policyContext: policy,
        budget,
        mcpSession: ownedSession,
        directSnapshotForImportOrFixture: directSnap,
        signal: params.signal,
      });

      if (res.operationRecord) {
        operationLedger.push(res.operationRecord);
      }
      if (res.evidence) {
        marketplaceEvidence.push(res.evidence);
        (candidate as any).amazonEvidence = res.evidence;
        (candidate as any).amazonEvidenceStatus = res.evidence.status;
        if (res.evidence.rejectionReasons.length > 0) {
          rejectionLedger.push({
            candidateId: candidate.candidateId,
            sourceUrl: candidateUrl,
            asin: res.evidence.asin,
            status: res.evidence.status,
            rejectionReasons: res.evidence.rejectionReasons,
            observedAt: res.evidence.observedAt,
            researchRunId: params.researchRunId,
          });
        }
      } else {
        (candidate as any).amazonEvidenceStatus = res.status;
      }
    }
  } finally {
    if (createdSessionInternally && ownedSession) {
      await ownedSession.close().catch(() => {});
    }
  }

  const identityVerifiedCount = marketplaceEvidence.filter(
    (e) => e.identityMatch === "EXACT_PRODUCT" && e.status === "IDENTITY_VERIFIED"
  ).length;
  const probableMatchCount = marketplaceEvidence.filter(
    (e) => e.identityMatch === "PROBABLE_PRODUCT"
  ).length;
  const brandOnlyCount = marketplaceEvidence.filter(
    (e) => e.identityMatch === "BRAND_ONLY"
  ).length;
  const rejectedCount = rejectionLedger.length;
  const operationsBlocked = operationLedger.filter(
    (op) =>
      op.status === "BLOCKED_POLICY" ||
      op.status === "BLOCKED_PROVIDER" ||
      op.status === "CAPTCHA_BLOCKED" ||
      op.status === "RATE_LIMITED"
  ).length;
  const operationsSucceeded = operationLedger.filter(
    (op) =>
      op.status === "IDENTITY_VERIFIED" || op.status === "OBSERVED_UNVERIFIED"
  ).length;

  let runStatus: MarketplaceEvidenceStatus = "NOT_ATTEMPTED";
  if (operationLedger.length === 0) {
    runStatus = policy.featureEnabled ? "NOT_ATTEMPTED" : "DISABLED";
  } else if (identityVerifiedCount > 0) {
    runStatus = operationsBlocked > 0 ? "PARTIAL" : "IDENTITY_VERIFIED";
  } else if (operationsSucceeded > 0) {
    runStatus = "OBSERVED_UNVERIFIED";
  } else if (operationLedger.every((op) => op.status === "BLOCKED_POLICY")) {
    runStatus = "BLOCKED_POLICY";
  } else if (operationsBlocked > 0) {
    runStatus = operationLedger[0].status;
  } else {
    runStatus = "FAILED";
  }

  const gateEvaluation = evaluateAmazonUsEvidenceGate(
    params.researchRunId,
    marketplaceEvidence,
    operationLedger,
    policy,
    { workspaceId: params.workspaceId }
  );

  return {
    marketplaceEvidence,
    marketplaceTelemetry: {
      provider: "AMAZON_US",
      featureEnabled: policy.featureEnabled,
      liveAllowed: policy.liveAllowed,
      accessPolicyStatus: policy.accessPolicyStatus,
      allowedAccessRoute: policy.allowedAccessRoute,
      runStatus,
      operationsAttempted: operationLedger.length,
      operationsSucceeded,
      operationsBlocked,
      candidatesEvaluated: selectedPilotCandidatesCount,
      identityVerifiedCount,
      probableMatchCount,
      brandOnlyCount,
      rejectedCount,
      notAttemptedCount,
      operationLedger,
      rejectionLedger,
      gateEvaluation,
    },
  };
}
