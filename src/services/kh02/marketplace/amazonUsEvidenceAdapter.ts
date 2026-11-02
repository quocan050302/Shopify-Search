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
  AmazonMcpSessionLifecycleProof,
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
  parseAmazonSearchSnapshotCards,
  validateAmazonUsProductUrl,
  validateAmazonUsSearchUrl,
  verifyAmazonProductIdentity,
} from "./amazonUsIdentity";
import {
  AMAZON_PILOT_MAX_CANDIDATES_PER_RUN,
  AmazonProviderBudget,
  createAmazonProviderBudget,
} from "./amazonUsBudget";
import {
  AmazonPlaywrightMcpSession,
  ConnectAmazonPlaywrightMcpOptions,
  PlaywrightMcpHandshakeProof,
  connectAmazonPlaywrightMcp,
} from "./amazonUsMcpTransport";
import { evaluateAmazonUsEvidenceGate } from "./amazonUsEvidenceGate";
import {
  AmazonAccessDecision,
  CreatorsApiClient,
  createCreatorsApiClient,
  resolveCreatorsApiEligibility,
} from "./amazonCreatorsApiClient";
import {
  deriveAmazonSearchIntents,
  discoverAmazonProductsForCandidates,
  normalizeAmazonSearchItem,
  selectAmazonCandidateMatches,
} from "./amazonUsAuthorizedDiscoveryAdapter";

export interface ClassifiedAmazonProviderOutcome {
  status: MarketplaceEvidenceStatus;
  outcomeCategory:
    | "POLICY_BLOCKED"
    | "PROVIDER_ACCESS_DENIED"
    | "MCP_NOT_CONFIGURED"
    | "ROUTE_NOT_IMPLEMENTED"
    | "NAVIGATION_NOT_EXECUTED"
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

    if (lower.includes("not_implemented") || lower.includes("creators_api_not_implemented")) {
      return {
        status: "NOT_IMPLEMENTED",
        outcomeCategory: "ROUTE_NOT_IMPLEMENTED",
        retryable: false,
        isExternalBlock: true,
        reason: msg,
      };
    }

    if (lower.includes("not_executed") || lower.includes("zero_tool_invocations")) {
      return {
        status: "NOT_EXECUTED",
        outcomeCategory: "NAVIGATION_NOT_EXECUTED",
        retryable: false,
        isExternalBlock: true,
        reason: msg,
      };
    }

    if (lower.includes("mcp_not_configured")) {
      return {
        status: "MCP_NOT_CONFIGURED",
        outcomeCategory: "MCP_NOT_CONFIGURED",
        retryable: false,
        isExternalBlock: true,
        reason: msg,
      };
    }

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
      lower.includes("blocked_provider")
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
  ownsMcpSession?: boolean;
  creatorsApiClient?: CreatorsApiClient | null;
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

  const isExplicitFixtureOrImport =
    requestMode === "TEST_FIXTURE" ||
    requestMode === "USER_IMPORTED" ||
    Boolean(input.directSnapshotForImportOrFixture) ||
    input.mcpSession?.transportMode === "TEST_FIXTURE";

  // 1. If feature flag is OFF and not an explicit fixture/import call, do nothing
  if (!policy.featureEnabled && !isExplicitFixtureOrImport) {
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

  // 3. Enforce Live Policy Gate (A02) & Official Creators API Non-Substitution (N19):
  const isFixtureOrImport =
    requestMode === "TEST_FIXTURE" ||
    requestMode === "USER_IMPORTED" ||
    input.mcpSession?.transportMode === "TEST_FIXTURE";

  if (
    !isFixtureOrImport &&
    input.creatorsApiClient &&
    policy.featureEnabled &&
    policy.liveAllowed &&
    urlValidation.extractedAsin
  ) {
    const budgetForApi =
      input.budget ||
      createAmazonProviderBudget({
        workspaceId: input.workspaceId,
        researchRunId: input.researchRunId,
        signal: input.signal,
        isolatedCoordinator: true,
      });
    const getRes = await input.creatorsApiClient.getItemsByAsins(
      [urlValidation.extractedAsin],
      {
        workspaceId: input.workspaceId,
        researchRunId: input.researchRunId,
        candidateId: input.candidateId,
        budget: budgetForApi,
        signal: input.signal,
      }
    );
    const completedAt = new Date().toISOString();
    const targetAsin = urlValidation.extractedAsin.trim().toUpperCase();
    const rawItem =
      getRes.itemsByAsin?.[targetAsin] ||
      getRes.items.find(
        (it) =>
          String(it?.asin || it?.ASIN || "")
            .trim()
            .toUpperCase() === targetAsin
      ) ||
      null;
    const apiObservationClass: MarketplaceObservationClass =
      input.creatorsApiClient.isIsolatedTestTransport ||
      input.creatorsApiClient.transportProvenance === "TEST_FIXTURE"
        ? "TEST_FIXTURE"
        : "AUTHORIZED_LIVE";
    if (getRes.succeeded && rawItem) {
      const norm = normalizeAmazonSearchItem(rawItem, {
        workspaceId: input.workspaceId,
        researchRunId: input.researchRunId,
        candidateId: input.candidateId,
        providerInvocationRef: getRes.providerInvocationRef,
        providerRequestId: getRes.upstreamRequestId,
        observedAt: getRes.completedAt,
        rawResponseHash: getRes.rawResponseHash,
        accessPolicyStatus: policy.accessPolicyStatus,
        observationClass: apiObservationClass,
      });
      if (norm.kind === "EVIDENCE") {
        const verified = verifyAmazonProductIdentity(
          input.candidate,
          norm.evidence
        );
        const ev = {
          ...verified.updatedEvidence,
          requestMode,
        };
        const opRecord: AmazonProviderOperationRecord = {
          operationId,
          providerInvocationRef: getRes.providerInvocationRef,
          providerRequestId: getRes.upstreamRequestId,
          providerRequestIdOrigin: getRes.upstreamRequestId ? "UPSTREAM" : "ABSENT",
          workspaceId: input.workspaceId,
          researchRunId: input.researchRunId,
          candidateId: input.candidateId,
          provider: "AMAZON_US",
          requestMode,
          sourceUrl: input.sourceUrl,
          finalUrl: ev.canonicalAmazonUrl,
          attemptCount: getRes.attempted ? 1 : 0,
          maxAttemptsAllowed: 2,
          startedAt: getRes.startedAt,
          completedAt,
          durationMs: getRes.durationMs,
          requestHash: getRes.requestHash,
          responseHash: ev.rawEvidenceHash,
          status: ev.status,
          outcomeCategory: "OBSERVED_SUCCESS",
          observationClass: apiObservationClass,
          transportSessionId: null,
          aborted: false,
          errorMessage: null,
        };
        return {
          status: ev.status,
          evidence: ev,
          operationRecord: opRecord,
        };
      }
    }
    const missingItemStatus: MarketplaceEvidenceStatus =
      getRes.succeeded && !rawItem
        ? getRes.partialErrors && getRes.partialErrors.length > 0
          ? "PARTIAL"
          : "QUERY_SUCCEEDED_EMPTY"
        : getRes.status;
    const opRecord: AmazonProviderOperationRecord = {
      operationId,
      providerInvocationRef: getRes.providerInvocationRef,
      providerRequestId: getRes.upstreamRequestId,
      providerRequestIdOrigin: getRes.upstreamRequestId ? "UPSTREAM" : "ABSENT",
      workspaceId: input.workspaceId,
      researchRunId: input.researchRunId,
      candidateId: input.candidateId,
      provider: "AMAZON_US",
      requestMode,
      sourceUrl: input.sourceUrl,
      finalUrl: null,
      attemptCount: getRes.attempted ? 1 : 0,
      maxAttemptsAllowed: 2,
      startedAt: getRes.startedAt,
      completedAt,
      durationMs: getRes.durationMs,
      requestHash: getRes.requestHash,
      responseHash: getRes.rawResponseHash,
      status: missingItemStatus,
      outcomeCategory:
        getRes.succeeded && !rawItem
          ? "REQUESTED_ASIN_NOT_IN_GETITEMS_RESPONSE"
          : getRes.errorCode || getRes.status,
      observationClass: apiObservationClass === "TEST_FIXTURE" ? "TEST_FIXTURE" : "UNVERIFIED",
      transportSessionId: null,
      aborted: false,
      errorMessage:
        getRes.errorMessage ||
        (getRes.succeeded && !rawItem
          ? `Requested ASIN ${targetAsin} was not returned in GetItems itemResults.items.`
          : null),
    };
    return {
      status: missingItemStatus,
      evidence: null,
      operationRecord: opRecord,
    };
  }

  if (
    !isFixtureOrImport &&
    (policy.allowedAccessRoute === "CREATORS_API" ||
      policy.allowedAccessRoute === "OFFICIAL_CREATORS_API" ||
      policy.allowedAccessRoute === "CREATORS_API_NOT_IMPLEMENTED") &&
    !policy.userAuthorizedUrlAttested
  ) {
    const completedAt = new Date().toISOString();
    const idSeed = `${input.workspaceId}:${input.researchRunId}:${input.candidateId}:AMAZON_US:${urlValidation.extractedAsin || "NOT_IMPLEMENTED"}`;
    const idHash =
      computeDeterministicEvidenceHash(idSeed)?.slice(0, 20) || "not_implemented";
    const reason =
      "NOT_IMPLEMENTED: Official Amazon Creators API HTTP client is not implemented in this build; Playwright scraping is never substituted for Creators API.";

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
      rejectionReasons: [`BLOCKED_POLICY: ${reason}`],
      accessPolicyStatus: "BLOCKED_POLICY",
      status: "NOT_IMPLEMENTED",
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
      status: "NOT_IMPLEMENTED",
      outcomeCategory: "ROUTE_NOT_IMPLEMENTED",
      observationClass: "UNVERIFIED",
      transportSessionId: null,
      aborted: false,
      errorMessage: reason,
    };

    return {
      status: "NOT_IMPLEMENTED",
      evidence: blockedEvidence,
      operationRecord: opRecord,
    };
  }

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

  // Only register session close cleanup when this call explicitly owns the MCP session (N20)
  if (input.mcpSession && input.ownsMcpSession === true) {
    budget.registerCleanup(async () => {
      await input.mcpSession?.close();
    });
  }

  const observationClass: MarketplaceObservationClass =
    requestMode === "TEST_FIXTURE" ||
    input.mcpSession?.transportMode === "TEST_FIXTURE" ||
    input.mcpSession?.observationClass === "TEST_FIXTURE" ||
    input.mcpSession?.serverOrigin === "LOCAL_MCP_TEST_DOUBLE"
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
      if (
        !Array.isArray(navOut.toolInvocations) ||
        !navOut.toolInvocations.includes("browser_navigate") ||
        !navOut.toolInvocations.includes("browser_snapshot")
      ) {
        throw new Error(
          "NOT_EXECUTED: Handshake-only MCP session did not execute browser_navigate and browser_snapshot tool calls."
        );
      }
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
  const providerSourceOrigin: AmazonProductEvidence["providerSourceOrigin"] =
    input.mcpSession?.serverOrigin === "LOCAL_MCP_TEST_DOUBLE"
      ? "LOCAL_MCP_TEST_DOUBLE"
      : input.mcpSession?.serverOrigin === "PINNED_PLAYWRIGHT_MCP"
      ? "PINNED_PLAYWRIGHT_MCP"
      : requestMode === "USER_IMPORTED"
      ? "USER_IMPORTED"
      : requestMode === "TEST_FIXTURE" || Boolean(input.directSnapshotForImportOrFixture)
      ? "TEST_FIXTURE"
      : "NONE";
  const finalEvidence: AmazonProductEvidence = {
    ...verified.updatedEvidence,
    providerSourceOrigin,
  };
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

export interface ResolveAmazonCreatorsApiRuntimeClientOptions {
  env?: Record<string, string | undefined>;
  policy?: AmazonPolicyContext;
  signal?: AbortSignal;
  transportFactory?: () => typeof fetch;
  allowIsolatedTestHost?: boolean;
}

export interface ResolvedAmazonCreatorsApiRuntimeClient {
  client: CreatorsApiClient | null;
  createdFromRuntimeFactory: boolean;
  eligibility: AmazonAccessDecision;
  reasonCode:
    | "RUNTIME_CLIENT_CONSTRUCTED"
    | "POLICY_DISABLED"
    | "LIVE_NOT_ALLOWED"
    | "CREDENTIALS_MISSING_OR_INCOMPLETE"
    | "UNSUPPORTED_MARKETPLACE"
    | "CLIENT_CONSTRUCTION_FAILED";
  reason: string;
}

/**
 * Runtime factory that constructs an official `CreatorsApiClient` from server environment
 * when `featureEnabled && liveAllowed && eligibility.configured` are all satisfied.
 * Never constructs a client or makes network calls when policy is disabled, live is not allowed,
 * or credentials/partnerTag are missing.
 */
export function resolveAmazonCreatorsApiRuntimeClient(
  options: ResolveAmazonCreatorsApiRuntimeClientOptions = {}
): ResolvedAmazonCreatorsApiRuntimeClient {
  const env = options.env || process.env;
  const eligibility = resolveCreatorsApiEligibility(env, {
    authenticated: false,
    querySucceeded: false,
    transportVerified: false,
  });

  if (
    (options.policy && options.policy.featureEnabled === false) ||
    !eligibility.featureEnabled
  ) {
    return {
      client: null,
      createdFromRuntimeFactory: false,
      eligibility,
      reasonCode: "POLICY_DISABLED",
      reason: eligibility.reason,
    };
  }

  if (
    (options.policy && options.policy.accessPolicyStatus === "LIVE_NOT_ALLOWED") ||
    !eligibility.liveAllowed
  ) {
    return {
      client: null,
      createdFromRuntimeFactory: false,
      eligibility,
      reasonCode: "LIVE_NOT_ALLOWED",
      reason: eligibility.reason,
    };
  }

  if (!eligibility.configured) {
    return {
      client: null,
      createdFromRuntimeFactory: false,
      eligibility,
      reasonCode: "CREDENTIALS_MISSING_OR_INCOMPLETE",
      reason: eligibility.reason,
    };
  }

  if (!eligibility.eligibleForLiveRequests) {
    return {
      client: null,
      createdFromRuntimeFactory: false,
      eligibility,
      reasonCode: "UNSUPPORTED_MARKETPLACE",
      reason: eligibility.reason,
    };
  }

  const credId = (
    env.KH02_AMAZON_CREATORS_API_CREDENTIAL_ID ||
    env.AMAZON_CREATORS_API_CREDENTIAL_ID ||
    ""
  ).trim();
  const credSecret = (
    env.KH02_AMAZON_CREATORS_API_CREDENTIAL_SECRET ||
    env.AMAZON_CREATORS_API_CREDENTIAL_SECRET ||
    ""
  ).trim();
  const partnerTag = (
    env.KH02_AMAZON_ASSOCIATES_PARTNER_TAG ||
    env.AMAZON_CREATORS_API_PARTNER_TAG ||
    ""
  ).trim();
  const allowIsolatedTestHost = Boolean(
    options.allowIsolatedTestHost ||
      String(env.KH02_AMAZON_CREATORS_API_ALLOW_ISOLATED_TEST_HOST || "false")
        .trim()
        .toLowerCase() === "true"
  );

  try {
    const client = createCreatorsApiClient({
      credentialId: credId,
      credentialSecret: credSecret,
      partnerTag,
      credentialVersion: eligibility.credentialVersion,
      marketplace: eligibility.registeredMarketplace,
      tokenEndpoint: env.KH02_AMAZON_CREATORS_API_TOKEN_ENDPOINT || undefined,
      searchItemsEndpoint:
        env.KH02_AMAZON_CREATORS_API_SEARCH_ITEMS_ENDPOINT || undefined,
      getItemsEndpoint:
        env.KH02_AMAZON_CREATORS_API_GET_ITEMS_ENDPOINT || undefined,
      fetchFn: options.transportFactory ? options.transportFactory() : undefined,
      allowIsolatedTestHost,
      isIsolatedTestTransport: Boolean(
        options.transportFactory || allowIsolatedTestHost
      ),
    });

    return {
      client,
      createdFromRuntimeFactory: true,
      eligibility,
      reasonCode: "RUNTIME_CLIENT_CONSTRUCTED",
      reason:
        "Constructed official Amazon Creators API runtime client from server environment.",
    };
  } catch (err) {
    return {
      client: null,
      createdFromRuntimeFactory: false,
      eligibility,
      reasonCode: "CLIENT_CONSTRUCTION_FAILED",
      reason: err instanceof Error ? err.message : String(err),
    };
  }
}

export interface RunAmazonUsPilotEnrichmentParams {
  workspaceId: string;
  researchRunId: string;
  niche?: string;
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
  closeBorrowedMcpSession?: boolean;
  borrowedSessionLifecycleReceipt?: Partial<AmazonMcpSessionLifecycleProof> | null;
  mcpConnectOptions?: ConnectAmazonPlaywrightMcpOptions;
  creatorsApiClient?: CreatorsApiClient | null;
  creatorsApiTransportFactory?: () => typeof fetch;
  allowIsolatedTestHost?: boolean;
  allowLocalMcpSearch?: boolean;
  signal?: AbortSignal;
  env?: Record<string, string | undefined>;
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
  const effectiveEnv = params.env || process.env;
  const requestMode: AmazonRequestMode = params.requestMode || "URL_VERIFICATION";
  const isExplicitTestFixture =
    requestMode === "TEST_FIXTURE" ||
    requestMode === "USER_IMPORTED" ||
    Boolean(params.fixtureSnapshotsByUrl);

  const runtimeClientResolution =
    params.creatorsApiClient || (!params.optInRequested && !isExplicitTestFixture)
      ? null
      : resolveAmazonCreatorsApiRuntimeClient({
          env: effectiveEnv,
          signal: params.signal,
          transportFactory: params.creatorsApiTransportFactory,
          allowIsolatedTestHost: params.allowIsolatedTestHost,
        });
  const effectiveCreatorsApiClient: CreatorsApiClient | null =
    params.creatorsApiClient || runtimeClientResolution?.client || null;

  const policy = resolveAmazonUsPolicyContext(effectiveEnv, {
    creatorsApiEntitlementVerified: Boolean(effectiveCreatorsApiClient),
    allowLocalMcpSearch: params.allowLocalMcpSearch,
  });
  const localMcpSearchPermitted = Boolean(
    policy.localMcpSearchPermitted || params.allowLocalMcpSearch
  );

  // If server flag is OFF and not an explicit fixture/import test, return DISABLED with zero operations
  if (!policy.featureEnabled && !isExplicitTestFixture) {
    const emptyLifecycle: AmazonMcpSessionLifecycleProof = {
      sessionId: null,
      sessionCreated: false,
      ownershipMode: "NONE",
      transportMode: null,
      serverOrigin: "NONE",
      ownedChildPid: null,
      startedAt: null,
      lastToolCompletedAt: null,
      closeStartedAt: null,
      closeFinishedAt: null,
      closedCleanly: false,
      ownedChildPidTerminated: false,
      closeError: null,
      toolInvocationsCount: 0,
      observedOperationIds: [],
    };
    const gateEvaluation = evaluateAmazonUsEvidenceGate(
      params.researchRunId,
      [],
      [],
      policy,
      { workspaceId: params.workspaceId, mcpSessionLifecycle: emptyLifecycle }
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
        mcpSessionLifecycle: emptyLifecycle,
      },
    };
  }

  if (!params.optInRequested && !isExplicitTestFixture) {
    const emptyLifecycle: AmazonMcpSessionLifecycleProof = {
      sessionId: null,
      sessionCreated: false,
      ownershipMode: "NONE",
      transportMode: null,
      serverOrigin: "NONE",
      ownedChildPid: null,
      startedAt: null,
      lastToolCompletedAt: null,
      closeStartedAt: null,
      closeFinishedAt: null,
      closedCleanly: false,
      ownedChildPidTerminated: false,
      closeError: null,
      toolInvocationsCount: 0,
      observedOperationIds: [],
    };
    const gateEvaluation = evaluateAmazonUsEvidenceGate(
      params.researchRunId,
      [],
      [],
      policy,
      { workspaceId: params.workspaceId, mcpSessionLifecycle: emptyLifecycle }
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
        mcpSessionLifecycle: emptyLifecycle,
      },
    };
  }

  const budget = createAmazonProviderBudget({
    workspaceId: params.workspaceId,
    researchRunId: params.researchRunId,
    signal: params.signal,
    isolatedCoordinator: true,
  });

  const candidateUrlsToProcess = params.candidates
    .map(
      (c) =>
        params.candidateAmazonUrls?.[c.candidateId] ||
        c.amazonProductUrl ||
        null
    )
    .filter((u): u is string => Boolean(u && String(u).trim()));

  let ownedSession: AmazonPlaywrightMcpSession | null = params.mcpSession || null;
  let createdSessionInternally = false;
  let connectionHandshakeProof: PlaywrightMcpHandshakeProof | null =
    ownedSession?.handshakeProof || null;

  const hasCandidatesWithoutUrl = params.candidates.some(
    (c) =>
      !params.candidateAmazonUrls?.[c.candidateId] && !c.amazonProductUrl
  );

  if (!ownedSession) {
    if (params.fixtureSnapshotsByUrl) {
      const conn = await connectAmazonPlaywrightMcp({
        signal: params.signal,
        fixtureTransport: {
          enabled: true,
          snapshotsByUrl: params.fixtureSnapshotsByUrl,
        },
      });
      ownedSession = conn.session;
      connectionHandshakeProof = conn.handshakeProof;
      createdSessionInternally = Boolean(conn.session);
      if (createdSessionInternally && ownedSession) {
        budget.registerCleanup(async () => {
          await ownedSession?.close();
        });
      }
    } else if (
      (candidateUrlsToProcess.length > 0 ||
        (hasCandidatesWithoutUrl && localMcpSearchPermitted && !effectiveCreatorsApiClient)) &&
      policy.featureEnabled &&
      policy.liveAllowed &&
      policy.allowedAccessRoute === "USER_AUTHORIZED_URL"
    ) {
      const conn = await connectAmazonPlaywrightMcp({
        allowRealStdioMcp: true,
        signal: params.signal,
        ...(params.mcpConnectOptions || {}),
      });
      ownedSession = conn.session;
      connectionHandshakeProof = conn.handshakeProof;
      createdSessionInternally = Boolean(conn.session);
      if (createdSessionInternally && ownedSession) {
        budget.registerCleanup(async () => {
          await ownedSession?.close();
        });
      }
    }
  }

  const marketplaceEvidence: AmazonProductEvidence[] = [];
  const operationLedger: AmazonProviderOperationRecord[] = [];
  const rejectionLedger: AmazonMarketplaceTelemetry["rejectionLedger"] = [];

  let notAttemptedCount = 0;
  let selectedPilotCandidatesCount = 0;
  let searchBlockedPolicyCount = 0;
  let pdpNotExecutedCount = 0;
  const candidatesWithoutUrl: RunAmazonUsPilotEnrichmentParams["candidates"] = [];
  let discoverySummary: AmazonMarketplaceTelemetry["discoverySummary"] | undefined;

  try {
    for (const candidate of params.candidates) {
      if (params.signal?.aborted) break;

      const candidateUrl =
        params.candidateAmazonUrls?.[candidate.candidateId] ||
        candidate.amazonProductUrl ||
        null;

      // Candidates without an explicit Amazon URL are queued for authorized discovery (Section 5C.11)
      if (!candidateUrl) {
        candidatesWithoutUrl.push(candidate);
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
        ownsMcpSession: false,
        creatorsApiClient: effectiveCreatorsApiClient,
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

    // Section 5C.11 & V12.4.3.5.1 Section 04: Bounded Discovery for remaining shortlisted candidates without an explicit Amazon URL
    const remainingPilotSlots = Math.max(
      0,
      AMAZON_PILOT_MAX_CANDIDATES_PER_RUN - selectedPilotCandidatesCount
    );
    if (candidatesWithoutUrl.length > 0 && remainingPilotSlots > 0 && !params.signal?.aborted) {
      const discoveryTargets = candidatesWithoutUrl.slice(0, remainingPilotSlots);
      const overflowCandidates = candidatesWithoutUrl.slice(remainingPilotSlots);
      for (const c of overflowCandidates) {
        notAttemptedCount++;
        (c as any).amazonEvidenceStatus = "NOT_ATTEMPTED";
      }

      // Route A: Local Playwright MCP bounded product-specific search -> matched ASIN -> PDP (when permitted and Creators API is not used)
      if (
        !effectiveCreatorsApiClient &&
        !policy.creatorsApiConfigured &&
        (policy.allowedAccessRoute === "USER_AUTHORIZED_URL" || localMcpSearchPermitted)
      ) {
        if (!localMcpSearchPermitted) {
          searchBlockedPolicyCount += discoveryTargets.length;
          discoverySummary = {
            discoveryAttempted: false,
            discoveryStatus: "SEARCH_BLOCKED_POLICY",
            searchQueriesPlanned: 0,
            searchOperationsAttempted: 0,
            getItemsOperationsAttempted: 0,
            listingsReturnedCount: 0,
            exactMatchesSelectedCount: 0,
            probableMatchesSelectedCount: 0,
            brandOnlyMatchesCount: 0,
            rejectedListingsCount: 0,
          };
          for (const c of discoveryTargets) {
            notAttemptedCount++;
            (c as any).amazonEvidenceStatus = "SEARCH_BLOCKED_POLICY";
            if (candidateUrlsToProcess.length === 0) {
              const nowIso = new Date().toISOString();
              operationLedger.push({
                operationId: `amz_op_${params.researchRunId}_${c.candidateId}_search_blocked`,
                providerInvocationRef: `amz_inv_${params.researchRunId}_${c.candidateId}_search_blocked`,
                providerRequestId: null,
                providerRequestIdOrigin: "ABSENT",
                workspaceId: params.workspaceId,
                researchRunId: params.researchRunId,
                candidateId: c.candidateId,
                provider: "AMAZON_US",
                requestMode: "AUTHORIZED_SEARCH",
                sourceUrl: null,
                finalUrl: null,
                attemptCount: 0,
                maxAttemptsAllowed: 2,
                startedAt: nowIso,
                completedAt: nowIso,
                durationMs: 0,
                requestHash: null,
                responseHash: null,
                status: "SEARCH_BLOCKED_POLICY",
                outcomeCategory: "POLICY_BLOCKED",
                observationClass: "UNVERIFIED",
                transportSessionId: null,
                aborted: false,
                errorMessage:
                  "SEARCH_BLOCKED_POLICY: Local Playwright MCP search->PDP requires explicit KH02_AMAZON_US_LOCAL_MCP_SEARCH_ATTESTED=true or allowLocalMcpSearch=true.",
              });
            }
          }
        } else {
          // Local Playwright MCP search -> pick matched ASIN -> PDP navigation within <= 4 ops/run
          let searchQueriesPlanned = 0;
          let searchOperationsAttempted = 0;
          let pdpOperationsAttempted = 0;
          let listingsReturnedCount = 0;
          let rejectedListingsCount = 0;
          let abortRemainingOnBotWall = false;
          const seenSearchQueries = new Set<string>();

          for (const candidate of discoveryTargets) {
            if (params.signal?.aborted) break;
            selectedPilotCandidatesCount++;

            const intents = deriveAmazonSearchIntents(candidate, params.niche || "");
            if (intents.length === 0) {
              notAttemptedCount++;
              (candidate as any).amazonEvidenceStatus = "INSUFFICIENT_EVIDENCE";
              continue;
            }
            const normalizedKeywords = intents[0].normalizedKeywords;
            const queryKey = normalizedKeywords.toLowerCase();
            if (seenSearchQueries.has(queryKey)) {
              notAttemptedCount++;
              (candidate as any).amazonEvidenceStatus = "NOT_ATTEMPTED";
              continue;
            }
            seenSearchQueries.add(queryKey);
            searchQueriesPlanned++;

            const snapBeforeSearch = budget.getSnapshot();
            if (
              abortRemainingOnBotWall ||
              snapBeforeSearch.maxOperationsPerRun - snapBeforeSearch.operationsUsedInRun <= 0
            ) {
              pdpNotExecutedCount++;
              (candidate as any).amazonEvidenceStatus = "PDP_NOT_EXECUTED";
              continue;
            }

            const searchUrl = `https://www.amazon.com/s?k=${encodeURIComponent(normalizedKeywords)}`;
            const searchValidation = validateAmazonUsSearchUrl(searchUrl);
            if (!searchValidation.valid || !ownedSession) {
              pdpNotExecutedCount++;
              (candidate as any).amazonEvidenceStatus = ownedSession
                ? "FAILED"
                : "MCP_NOT_CONFIGURED";
              continue;
            }

            const searchOpId = `amz_op_${params.researchRunId}_${candidate.candidateId}_mcp_search`;
            const searchInvRef = `amz_inv_${params.researchRunId}_${candidate.candidateId}_mcp_search`;
            const searchStartedAt = new Date().toISOString();
            const searchStartMs = Date.now();
            const searchReqHash = computeDeterministicEvidenceHash({
              mode: "LOCAL_MCP_SEARCH",
              candidateId: candidate.candidateId,
              searchUrl,
            });

            const searchBounded = await budget.executeBoundedOperation(
              searchOpId,
              async () => {
                if (ownedSession!.navigateAndCaptureSearchSnapshot) {
                  return await ownedSession!.navigateAndCaptureSearchSnapshot(searchUrl, {
                    signal: params.signal,
                  });
                }
                const prodSnap = await ownedSession!.navigateAndCaptureProductSnapshot(searchUrl, {
                  signal: params.signal,
                });
                const searchCardsResult = parseAmazonSearchSnapshotCards({
                  sourceUrl: prodSnap.snapshot.sourceUrl,
                  finalUrl: prodSnap.snapshot.finalUrl,
                  httpStatus: prodSnap.snapshot.httpStatus,
                  pageTitle: prodSnap.snapshot.pageTitle,
                  rawHtml: prodSnap.snapshot.html,
                  accessibilityTreeText: prodSnap.snapshot.html,
                  structuredData: prodSnap.snapshot.structuredData as any,
                });
                return {
                  snapshot: prodSnap.snapshot,
                  searchCardsResult,
                  upstreamRequestId: prodSnap.upstreamRequestId,
                  toolInvocations: prodSnap.toolInvocations,
                };
              }
            );

            searchOperationsAttempted++;
            const searchCompletedAt = new Date().toISOString();
            const searchDurationMs = Math.max(0, Date.now() - searchStartMs);
            const sessionObsClass: MarketplaceObservationClass =
              ownedSession.observationClass || "UNVERIFIED";
            const sessionSourceOrigin =
              ownedSession.serverOrigin === "PINNED_PLAYWRIGHT_MCP"
                ? "PINNED_PLAYWRIGHT_MCP"
                : ownedSession.serverOrigin === "LOCAL_MCP_TEST_DOUBLE"
                ? "LOCAL_MCP_TEST_DOUBLE"
                : "TEST_FIXTURE";

            if (!searchBounded.executed || searchBounded.error || !searchBounded.result) {
              const classified = classifyAmazonProviderOutcome(
                searchBounded.error ||
                  new Error(searchBounded.blockedDecision?.reason || "MCP search failed")
              );
              if (
                classified.status === "CAPTCHA_BLOCKED" ||
                classified.status === "BLOCKED_PROVIDER" ||
                classified.status === "RATE_LIMITED"
              ) {
                abortRemainingOnBotWall = true;
              }
              pdpNotExecutedCount++;
              operationLedger.push({
                operationId: searchOpId,
                providerInvocationRef: searchInvRef,
                providerRequestId: null,
                providerRequestIdOrigin: "ABSENT",
                workspaceId: params.workspaceId,
                researchRunId: params.researchRunId,
                candidateId: candidate.candidateId,
                provider: "AMAZON_US",
                requestMode: "AUTHORIZED_SEARCH",
                sourceUrl: searchUrl,
                finalUrl: null,
                attemptCount: searchBounded.attemptCount,
                maxAttemptsAllowed: 2,
                startedAt: searchStartedAt,
                completedAt: searchCompletedAt,
                durationMs: searchDurationMs,
                requestHash: searchReqHash,
                responseHash: null,
                status: classified.status,
                outcomeCategory: classified.outcomeCategory,
                observationClass:
                  sessionObsClass === "TEST_FIXTURE" ? "TEST_FIXTURE" : "UNVERIFIED",
                transportSessionId: ownedSession.sessionId,
                aborted: Boolean(params.signal?.aborted),
                errorMessage: classified.reason,
              });
              continue;
            }

            const { snapshot: searchSnap, searchCardsResult } = searchBounded.result;
            const searchRespHash = computeDeterministicEvidenceHash({
              sourceUrl: searchSnap.sourceUrl,
              finalUrl: searchSnap.finalUrl,
              pageTitle: searchSnap.pageTitle,
              htmlDigest: searchSnap.html
                ? computeDeterministicEvidenceHash(searchSnap.html)
                : null,
            });

            if (searchCardsResult.botWallDetected) {
              abortRemainingOnBotWall = true;
              pdpNotExecutedCount++;
              const botStatus: MarketplaceEvidenceStatus =
                searchCardsResult.botWallStatus || "CAPTCHA_BLOCKED";
              const botReason =
                searchCardsResult.botWallReason || "AMAZON_CAPTCHA_OR_BOT_WALL_DETECTED";
              operationLedger.push({
                operationId: searchOpId,
                providerInvocationRef: searchInvRef,
                providerRequestId: null,
                providerRequestIdOrigin: "ABSENT",
                workspaceId: params.workspaceId,
                researchRunId: params.researchRunId,
                candidateId: candidate.candidateId,
                provider: "AMAZON_US",
                requestMode: "AUTHORIZED_SEARCH",
                sourceUrl: searchUrl,
                finalUrl: searchSnap.finalUrl || searchUrl,
                attemptCount: searchBounded.attemptCount,
                maxAttemptsAllowed: 2,
                startedAt: searchStartedAt,
                completedAt: searchCompletedAt,
                durationMs: searchDurationMs,
                requestHash: searchReqHash,
                responseHash: searchRespHash,
                status: botStatus,
                outcomeCategory:
                  botStatus === "CAPTCHA_BLOCKED"
                    ? "CAPTCHA_CHALLENGE"
                    : "PROVIDER_ACCESS_DENIED",
                observationClass:
                  sessionObsClass === "TEST_FIXTURE" ? "TEST_FIXTURE" : "UNVERIFIED",
                transportSessionId: ownedSession.sessionId,
                aborted: false,
                errorMessage: `${botReason}; PDP_NOT_EXECUTED`,
              });

              const blockedIdSeed = `${params.workspaceId}:${params.researchRunId}:${candidate.candidateId}:AMAZON_US:SEARCH_BOT_WALL`;
              const blockedIdHash =
                computeDeterministicEvidenceHash(blockedIdSeed)?.slice(0, 20) || "botwall";
              const blockedEv: AmazonProductEvidence = {
                id: `amz_ev_${blockedIdHash}`,
                workspaceId: params.workspaceId,
                researchRunId: params.researchRunId,
                candidateId: candidate.candidateId,
                provider: "AMAZON_US",
                requestMode: "AUTHORIZED_SEARCH",
                requestedMarket: "US",
                verifiedDeliveryMarket: null,
                observedDeliveryPostalCode: null,
                sourceUrl: searchUrl,
                finalUrl: searchSnap.finalUrl || searchUrl,
                canonicalAmazonUrl: null,
                asin: null,
                parentAsin: null,
                variationAsin: null,
                productTitle: null,
                brand: null,
                merchant: null,
                seller: null,
                currency: null,
                price: null,
                availability: null,
                observedAt: searchCompletedAt,
                sourceTimestamp: null,
                rawEvidenceHash: searchRespHash,
                extractedFieldsHash: null,
                providerInvocationRef: searchInvRef,
                providerRequestId: null,
                responseEvidenceRef: searchRespHash
                  ? `amz_raw:${searchRespHash.slice(0, 16)}`
                  : null,
                evidenceOrigin:
                  sessionObsClass === "AUTHORIZED_LIVE"
                    ? "AMAZON_US_LIVE_MCP"
                    : `AMAZON_US_${sessionObsClass}`,
                providerSourceOrigin: sessionSourceOrigin,
                httpStatus: searchSnap.httpStatus ?? null,
                httpStatusOrigin:
                  typeof searchSnap.httpStatus === "number" ? "OBSERVED" : "UNOBSERVED_NULL",
                observationClass:
                  sessionObsClass === "TEST_FIXTURE" ? "TEST_FIXTURE" : "UNVERIFIED",
                verificationScope: null,
                identityMatch: "NO_MATCH",
                isCached: false,
                matchedCanonicalKey: null,
                matchingReasons: [],
                missingFields: ["asin", "productTitle", "brand", "price", "availability"],
                rejectionReasons: [botReason, "PDP_NOT_EXECUTED"],
                accessPolicyStatus: policy.accessPolicyStatus,
                status: botStatus,
              };
              marketplaceEvidence.push(blockedEv);
              rejectionLedger.push({
                candidateId: candidate.candidateId,
                sourceUrl: searchUrl,
                asin: null,
                status: botStatus,
                rejectionReasons: blockedEv.rejectionReasons,
                observedAt: searchCompletedAt,
                researchRunId: params.researchRunId,
              });
              (candidate as any).amazonEvidence = blockedEv;
              (candidate as any).amazonEvidenceStatus = botStatus;
              continue;
            }

            listingsReturnedCount += searchCardsResult.cards.length;
            rejectedListingsCount += searchCardsResult.rejectedCards.length;
            for (const rej of searchCardsResult.rejectedCards) {
              rejectionLedger.push({
                candidateId: candidate.candidateId,
                sourceUrl: searchUrl,
                asin: rej.asin,
                status: "FAILED",
                rejectionReasons: [rej.reason],
                observedAt: searchCompletedAt,
                researchRunId: params.researchRunId,
              });
            }

            operationLedger.push({
              operationId: searchOpId,
              providerInvocationRef: searchInvRef,
              providerRequestId: null,
              providerRequestIdOrigin: "ABSENT",
              workspaceId: params.workspaceId,
              researchRunId: params.researchRunId,
              candidateId: candidate.candidateId,
              provider: "AMAZON_US",
              requestMode: "AUTHORIZED_SEARCH",
              sourceUrl: searchUrl,
              finalUrl: searchSnap.finalUrl || searchUrl,
              attemptCount: searchBounded.attemptCount,
              maxAttemptsAllowed: 2,
              startedAt: searchStartedAt,
              completedAt: searchCompletedAt,
              durationMs: searchDurationMs,
              requestHash: searchReqHash,
              responseHash: searchRespHash,
              status:
                searchCardsResult.cards.length > 0
                  ? "OBSERVED_UNVERIFIED"
                  : "QUERY_SUCCEEDED_EMPTY",
              outcomeCategory:
                searchCardsResult.cards.length > 0
                  ? "OBSERVED_SUCCESS"
                  : "EMPTY_OR_UNAVAILABLE",
              observationClass: sessionObsClass,
              transportSessionId: ownedSession.sessionId,
              aborted: false,
              errorMessage: null,
            });

            if (searchCardsResult.cards.length === 0) {
              pdpNotExecutedCount++;
              (candidate as any).amazonEvidenceStatus = "QUERY_SUCCEEDED_EMPTY";
              continue;
            }

            // Evaluate candidate identity match across non-sponsored search cards
            const cardEvidences: AmazonProductEvidence[] = searchCardsResult.cards.map(
              (card) =>
                parseAmazonProductEvidence(
                  {
                    sourceUrl: card.canonicalAmazonUrl,
                    finalUrl: card.canonicalAmazonUrl,
                    canonicalUrl: card.canonicalAmazonUrl,
                    httpStatus: searchSnap.httpStatus ?? null,
                    pageTitle: card.productTitle,
                    structuredData: {
                      asin: card.asin,
                      productTitle: card.productTitle,
                      brand: card.brand || candidate.brand || null,
                      price: card.price,
                      currency: card.currency,
                      deliveryPostalCode: card.observedDeliveryPostalCode,
                      explicitUsDeliveryConfirmed: Boolean(card.observedDeliveryPostalCode),
                    },
                  },
                  {
                    workspaceId: params.workspaceId,
                    researchRunId: params.researchRunId,
                    candidateId: candidate.candidateId,
                    observedAt: searchCompletedAt,
                    providerInvocationRef: searchInvRef,
                    observationClass: sessionObsClass,
                    requestMode: "AUTHORIZED_SEARCH",
                    accessPolicyStatus: policy.accessPolicyStatus,
                  }
                )
            );

            const matchDecisions = selectAmazonCandidateMatches(candidate, cardEvidences);
            const selectedBest = matchDecisions.find(
              (d) =>
                d.selectedAsBest &&
                (d.identityMatch === "EXACT_PRODUCT" ||
                  d.identityMatch === "PROBABLE_PRODUCT")
            );

            const snapAfterSearch = budget.getSnapshot();
            if (
              !selectedBest ||
              snapAfterSearch.maxOperationsPerRun - snapAfterSearch.operationsUsedInRun <= 0
            ) {
              pdpNotExecutedCount++;
              const fallbackDecision = matchDecisions[0];
              if (fallbackDecision) {
                marketplaceEvidence.push(fallbackDecision.updatedEvidence);
                (candidate as any).amazonEvidence = fallbackDecision.updatedEvidence;
                (candidate as any).amazonEvidenceStatus = fallbackDecision.updatedEvidence.status;
                if (fallbackDecision.rejectionReasons.length > 0) {
                  rejectionLedger.push({
                    candidateId: candidate.candidateId,
                    sourceUrl: fallbackDecision.updatedEvidence.canonicalAmazonUrl,
                    asin: fallbackDecision.asin,
                    status: fallbackDecision.updatedEvidence.status,
                    rejectionReasons: fallbackDecision.rejectionReasons,
                    observedAt: searchCompletedAt,
                    researchRunId: params.researchRunId,
                  });
                }
              }
              continue;
            }

            // Navigate to canonical PDP https://www.amazon.com/dp/{ASIN} within shared 4-op budget
            pdpOperationsAttempted++;
            const pdpUrl = `https://www.amazon.com/dp/${selectedBest.asin}`;
            const pdpRes = await fetchAuthorizedAmazonProductEvidence({
              workspaceId: params.workspaceId,
              researchRunId: params.researchRunId,
              candidateId: candidate.candidateId,
              sourceUrl: pdpUrl,
              candidate,
              requestMode: isExplicitTestFixture ? "TEST_FIXTURE" : "URL_VERIFICATION",
              policyContext: policy,
              budget,
              mcpSession: ownedSession,
              ownsMcpSession: false,
              directSnapshotForImportOrFixture:
                params.fixtureSnapshotsByUrl?.[pdpUrl] || null,
              signal: params.signal,
            });

            if (pdpRes.operationRecord) {
              operationLedger.push(pdpRes.operationRecord);
              if (
                pdpRes.operationRecord.status === "CAPTCHA_BLOCKED" ||
                pdpRes.operationRecord.status === "BLOCKED_PROVIDER" ||
                pdpRes.operationRecord.status === "RATE_LIMITED"
              ) {
                abortRemainingOnBotWall = true;
              }
            }
            if (pdpRes.evidence) {
              marketplaceEvidence.push(pdpRes.evidence);
              (candidate as any).amazonEvidence = pdpRes.evidence;
              (candidate as any).amazonEvidenceStatus = pdpRes.evidence.status;
              if (pdpRes.evidence.rejectionReasons.length > 0) {
                rejectionLedger.push({
                  candidateId: candidate.candidateId,
                  sourceUrl: pdpUrl,
                  asin: pdpRes.evidence.asin,
                  status: pdpRes.evidence.status,
                  rejectionReasons: pdpRes.evidence.rejectionReasons,
                  observedAt: pdpRes.evidence.observedAt,
                  researchRunId: params.researchRunId,
                });
              }
            } else {
              (candidate as any).amazonEvidenceStatus = pdpRes.status;
            }
          }

          discoverySummary = {
            discoveryAttempted: true,
            discoveryStatus:
              marketplaceEvidence.some((e) => e.status === "IDENTITY_VERIFIED")
                ? "IDENTITY_VERIFIED"
                : operationLedger.some((o) => o.status === "CAPTCHA_BLOCKED")
                ? "CAPTCHA_BLOCKED"
                : operationLedger.some((o) => o.status === "BLOCKED_PROVIDER")
                ? "BLOCKED_PROVIDER"
                : "OBSERVED_UNVERIFIED",
            searchQueriesPlanned,
            searchOperationsAttempted,
            getItemsOperationsAttempted: pdpOperationsAttempted,
            listingsReturnedCount,
            exactMatchesSelectedCount: marketplaceEvidence.filter(
              (e) => e.identityMatch === "EXACT_PRODUCT"
            ).length,
            probableMatchesSelectedCount: marketplaceEvidence.filter(
              (e) => e.identityMatch === "PROBABLE_PRODUCT"
            ).length,
            brandOnlyMatchesCount: marketplaceEvidence.filter(
              (e) => e.identityMatch === "BRAND_ONLY"
            ).length,
            rejectedListingsCount,
          };
        }
      } else {
        // Route B: Creators API discovery (preserves D17–D18 & R29–R34)
        const discoveryRes = await discoverAmazonProductsForCandidates({
          workspaceId: params.workspaceId,
          researchRunId: params.researchRunId,
          niche: params.niche || "",
          candidates: discoveryTargets,
          policyContext: policy,
          env: effectiveEnv,
          budget,
          creatorsApiClient: effectiveCreatorsApiClient,
          transportFactory: params.creatorsApiTransportFactory,
          allowIsolatedTestHost: params.allowIsolatedTestHost,
          signal: params.signal,
        });

        discoverySummary = {
          discoveryAttempted: true,
          discoveryStatus: discoveryRes.runStatus,
          searchQueriesPlanned: discoveryRes.searchQueryPlan.plannedSearchOperationsCount,
          searchOperationsAttempted: discoveryRes.providerRequestLedger.filter((o) =>
            o.operationId.includes("search")
          ).length,
          getItemsOperationsAttempted: discoveryRes.providerRequestLedger.filter((o) =>
            o.operationId.includes("getitems")
          ).length,
          listingsReturnedCount: discoveryRes.rawAndNormalizedManifest.filter(
            (m) => m.asin !== null
          ).length,
          exactMatchesSelectedCount: discoveryRes.marketplaceEvidence.filter(
            (e) => e.identityMatch === "EXACT_PRODUCT"
          ).length,
          probableMatchesSelectedCount: discoveryRes.marketplaceEvidence.filter(
            (e) => e.identityMatch === "PROBABLE_PRODUCT"
          ).length,
          brandOnlyMatchesCount: discoveryRes.marketplaceEvidence.filter(
            (e) => e.identityMatch === "BRAND_ONLY"
          ).length,
          rejectedListingsCount: discoveryRes.rawAndNormalizedManifest.filter(
            (m) => m.identityMatch === "REJECTED" || m.rejectionReasons.length > 0
          ).length,
        };

        if (discoveryRes.providerRequestLedger.length > 0) {
          selectedPilotCandidatesCount += discoveryTargets.length;
          operationLedger.push(...discoveryRes.providerRequestLedger);
          for (const ev of discoveryRes.marketplaceEvidence) {
            marketplaceEvidence.push(ev);
            const matchedCand = discoveryTargets.find(
              (c) => c.candidateId === ev.candidateId
            );
            if (matchedCand) {
              (matchedCand as any).amazonEvidence = ev;
              (matchedCand as any).amazonEvidenceStatus = ev.status;
            }
            if (ev.rejectionReasons.length > 0) {
              rejectionLedger.push({
                candidateId: ev.candidateId,
                sourceUrl: ev.sourceUrl,
                asin: ev.asin,
                status: ev.status,
                rejectionReasons: ev.rejectionReasons,
                observedAt: ev.observedAt,
                researchRunId: params.researchRunId,
              });
            }
          }
          for (const c of discoveryTargets) {
            if (!(c as any).amazonEvidenceStatus) {
              (c as any).amazonEvidenceStatus = discoveryRes.runStatus;
            }
          }
        } else {
          for (const c of discoveryTargets) {
            notAttemptedCount++;
            (c as any).amazonEvidenceStatus =
              discoveryRes.runStatus === "CREDENTIALS_REQUIRED" ||
              discoveryRes.runStatus === "ACCESS_NOT_GRANTED"
                ? discoveryRes.runStatus
                : "NOT_ATTEMPTED";
          }
        }
      }
    } else if (candidatesWithoutUrl.length > 0) {
      for (const c of candidatesWithoutUrl) {
        notAttemptedCount++;
        (c as any).amazonEvidenceStatus = "NOT_ATTEMPTED";
      }
    }
  } finally {
    if ((createdSessionInternally || params.closeBorrowedMcpSession) && ownedSession) {
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
      op.status === "SEARCH_BLOCKED_POLICY" ||
      op.status === "BLOCKED_PROVIDER" ||
      op.status === "MCP_NOT_CONFIGURED" ||
      op.status === "NOT_IMPLEMENTED" ||
      op.status === "NOT_EXECUTED" ||
      op.status === "PDP_NOT_EXECUTED" ||
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
  } else if (operationLedger.every((op) => op.status === "SEARCH_BLOCKED_POLICY")) {
    runStatus = "SEARCH_BLOCKED_POLICY";
  } else if (operationLedger.every((op) => op.status === "BLOCKED_POLICY")) {
    runStatus = "BLOCKED_POLICY";
  } else if (operationLedger.every((op) => op.status === "NOT_IMPLEMENTED")) {
    runStatus = "NOT_IMPLEMENTED";
  } else if (operationsBlocked > 0) {
    runStatus = operationLedger[0].status;
  } else {
    runStatus = "FAILED";
  }

  const rawToolRecords =
    ownedSession?.getToolInvocationRecords?.() ??
    ownedSession?.handshakeProof?.toolInvocationRecords ??
    [];
  const toolInvocationsCount = rawToolRecords.filter(
    (r: any) => r?.toolName !== "browser_close"
  ).length;

  const observedOperationIds = operationLedger
    .filter((op) => Boolean(op.transportSessionId))
    .map((op) => op.operationId);

  let mcpSessionLifecycle: AmazonMcpSessionLifecycleProof;
  if (createdSessionInternally && ownedSession) {
    const rawProof = ownedSession.getSessionLifecycleProof
      ? ownedSession.getSessionLifecycleProof({
          ownershipMode: "ADAPTER_OWNED",
          observedOperationIds,
        })
      : null;
    const rawOrigin =
      rawProof?.serverOrigin ??
      ownedSession.serverOrigin ??
      (ownedSession.transportMode === "TEST_FIXTURE" ? "TEST_FIXTURE" : "NONE");
    mcpSessionLifecycle = {
      sessionId: rawProof?.sessionId ?? ownedSession.sessionId ?? null,
      sessionCreated: true,
      ownershipMode: "OWNED",
      transportMode: rawProof?.transportMode ?? ownedSession.transportMode ?? null,
      serverOrigin:
        rawOrigin === "LOCAL_TEST_SERVER" ? "LOCAL_MCP_TEST_DOUBLE" : rawOrigin,
      ownedChildPid:
        rawProof?.ownedChildPid ?? ownedSession.handshakeProof?.ownedChildPid ?? null,
      startedAt: rawProof?.startedAt ?? ownedSession.handshakeProof?.startedAt ?? null,
      lastToolCompletedAt:
        rawProof?.lastToolCompletedAt ??
        ownedSession.handshakeProof?.lastToolCompletedAt ??
        null,
      closeStartedAt:
        rawProof?.closeStartedAt ?? ownedSession.handshakeProof?.closeStartedAt ?? null,
      closeFinishedAt:
        rawProof?.closeFinishedAt ??
        ownedSession.handshakeProof?.closeFinishedAt ??
        null,
      closedCleanly: Boolean(
        rawProof ? rawProof.closedCleanly : ownedSession.handshakeProof?.closedCleanly
      ),
      ownedChildPidTerminated: Boolean(
        rawProof
          ? rawProof.ownedChildPidTerminated
          : ownedSession.handshakeProof?.ownedChildPidTerminated ??
              ownedSession.handshakeProof?.closedCleanly
      ),
      closeError:
        rawProof?.closeError ?? ownedSession.handshakeProof?.closeError ?? null,
      toolInvocationsCount,
      observedOperationIds,
    };
  } else if (params.mcpSession && ownedSession) {
    const rawProof = ownedSession.getSessionLifecycleProof
      ? ownedSession.getSessionLifecycleProof({
          ownershipMode: "CALLER_BORROWED",
          observedOperationIds,
        })
      : null;
    const receipt = params.borrowedSessionLifecycleReceipt;
    const receiptMatches =
      Boolean(receipt) &&
      Boolean(ownedSession.sessionId) &&
      receipt?.sessionId === ownedSession.sessionId;
    const borrowedClosedCleanly = Boolean(
      (params.closeBorrowedMcpSession && rawProof?.closedCleanly === true) ||
        (receiptMatches &&
          receipt?.closedCleanly === true &&
          receipt?.ownedChildPidTerminated === true)
    );
    const borrowedPidTerminated = Boolean(
      (params.closeBorrowedMcpSession && rawProof?.ownedChildPidTerminated === true) ||
        (receiptMatches && receipt?.ownedChildPidTerminated === true)
    );
    mcpSessionLifecycle = {
      sessionId: ownedSession.sessionId ?? null,
      sessionCreated: true,
      ownershipMode: "BORROWED",
      transportMode: ownedSession.transportMode ?? null,
      serverOrigin:
        ownedSession.serverOrigin ??
        (ownedSession.transportMode === "TEST_FIXTURE" ? "TEST_FIXTURE" : "NONE"),
      ownedChildPid:
        receipt?.ownedChildPid ??
        rawProof?.ownedChildPid ??
        ownedSession.handshakeProof?.ownedChildPid ??
        null,
      startedAt:
        receipt?.startedAt ??
        rawProof?.startedAt ??
        ownedSession.handshakeProof?.startedAt ??
        null,
      lastToolCompletedAt:
        receipt?.lastToolCompletedAt ??
        rawProof?.lastToolCompletedAt ??
        ownedSession.handshakeProof?.lastToolCompletedAt ??
        null,
      closeStartedAt:
        receipt?.closeStartedAt ??
        rawProof?.closeStartedAt ??
        ownedSession.handshakeProof?.closeStartedAt ??
        null,
      closeFinishedAt:
        receipt?.closeFinishedAt ??
        rawProof?.closeFinishedAt ??
        ownedSession.handshakeProof?.closeFinishedAt ??
        null,
      closedCleanly: borrowedClosedCleanly,
      ownedChildPidTerminated: borrowedPidTerminated,
      closeError:
        receipt?.closeError ??
        rawProof?.closeError ??
        ownedSession.handshakeProof?.closeError ??
        (borrowedClosedCleanly
          ? null
          : "BORROWED_MCP_SESSION_CLOSURE_NOT_VERIFIED_AT_ADAPTER_BOUNDARY"),
      toolInvocationsCount,
      observedOperationIds,
    };
  } else {
    mcpSessionLifecycle = {
      sessionId: null,
      sessionCreated: false,
      ownershipMode: "NONE",
      transportMode:
        policy.allowedAccessRoute === "OFFICIAL_CREATORS_API"
          ? "CREATORS_API_HTTP"
          : null,
      serverOrigin: "NONE",
      ownedChildPid: null,
      startedAt: null,
      lastToolCompletedAt: null,
      closeStartedAt: null,
      closeFinishedAt: null,
      closedCleanly: false,
      ownedChildPidTerminated: false,
      closeError: null,
      toolInvocationsCount: 0,
      observedOperationIds: [],
    };
  }

  const gateEvaluation = evaluateAmazonUsEvidenceGate(
    params.researchRunId,
    marketplaceEvidence,
    operationLedger,
    policy,
    {
      workspaceId: params.workspaceId,
      mcpSessionLifecycle,
    }
  );

  const localMcpPilotDiagnostics: AmazonMarketplaceTelemetry["localMcpPilotDiagnostics"] = {
    routeId: "AMAZON_LOCAL_MCP_PUBLIC_URL_PILOT",
    transportHandshakeStatus: connectionHandshakeProof?.connected
      ? "SUCCEEDED"
      : connectionHandshakeProof?.executed
      ? "FAILED"
      : "NOT_ATTEMPTED",
    actualBrowserToolExecutionStatus:
      toolInvocationsCount > 0 || operationsSucceeded > 0
        ? "SUCCEEDED"
        : operationLedger.some(
            (op) =>
              op.status === "BLOCKED_POLICY" || op.status === "SEARCH_BLOCKED_POLICY"
          )
        ? "BLOCKED_POLICY"
        : operationLedger.length > 0
        ? "FAILED"
        : "NOT_ATTEMPTED",
    realAmazonPageObservationStatus: marketplaceEvidence.some(
      (e) =>
        Boolean(e.asin) &&
        (e.status === "IDENTITY_VERIFIED" ||
          e.status === "OBSERVED_UNVERIFIED" ||
          e.status === "PARTIAL")
    )
      ? "PUBLIC_PAGE_OBSERVED"
      : operationLedger.some(
          (op) => op.status === "CAPTCHA_BLOCKED" || op.status === "BLOCKED_PROVIDER"
        )
      ? "BLOCKED_CAPTCHA_OR_BOT_WALL"
      : toolInvocationsCount > 0
      ? "FAILED"
      : "NOT_ATTEMPTED",
    productIdentityVerificationStatus:
      identityVerifiedCount > 0
        ? "IDENTITY_VERIFIED"
        : probableMatchCount > 0 || brandOnlyCount > 0
        ? "OBSERVED_UNVERIFIED"
        : rejectedCount > 0
        ? "REJECTED_IDENTITY"
        : "NOT_ATTEMPTED",
    creatorsApiAvailabilityStatus: policy.creatorsApiConfigured
      ? "ELIGIBLE_CONFIGURED"
      : policy.allowedAccessRoute === "USER_AUTHORIZED_URL"
      ? "NOT_REQUIRED_FOR_LOCAL_MCP_PILOT"
      : "CREDENTIALS_ABSENT",
    searchBlockedPolicyCount,
    pdpNotExecutedCount,
  };

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
      mcpSessionLifecycle,
      localMcpPilotDiagnostics,
      ...(discoverySummary ? { discoverySummary } : {}),
    },
  };
}

