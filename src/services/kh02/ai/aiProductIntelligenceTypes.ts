/**
 * SWAI KH-02 V12.4 — AI Product Intelligence Types & Contracts
 *
 * Defines authoritative types for:
 * - Dynamic Gemini model discovery & capability assessment
 * - Exponential backoff retry & automatic model downgrade
 * - Strict structured output schema & server-side validation
 * - Commercial entity classification & product reality gate
 * - Historical backtest fixtures, metrics & audit reconciliation
 */

export type CommercialEntityType =
  | "PHYSICAL_PRODUCT"
  | "DIGITAL_PRODUCT"
  | "SERVICE"
  | "INSURANCE"
  | "INFORMATIONAL_CONTENT"
  | "LEAD_GENERATION"
  | "ADVERTISING_CAMPAIGN"
  | "UNKNOWN";

export type NicheRelevanceLevel =
  | "HIGH"
  | "MEDIUM"
  | "LOW"
  | "UNRELATED"
  | "UNKNOWN";

export type ProductRealityStatus =
  | "VERIFIED_PHYSICAL_PRODUCT"
  | "EVIDENCE_SUPPORTED_PHYSICAL_PRODUCT"
  | "NON_PHYSICAL"
  | "UNRESOLVED"
  | "REJECTED";

export type SourcePageClassification =
  | "ACTUAL_PRODUCT_PAGE"
  | "COLLECTION_PAGE"
  | "HOMEPAGE"
  | "SERVICE_PAGE"
  | "ARTICLE_PAGE"
  | "INSURANCE_PAGE"
  | "LEAD_GENERATION_PAGE"
  | "CAMPAIGN_PAGE"
  | "UNKNOWN_PAGE";

export type EvidenceDecision =
  | "ACCEPT"
  | "ACCEPT_WITH_UNCERTAINTY"
  | "REJECT"
  | "NEEDS_REVIEW";

export interface DirectlyObservedClaim {
  claim: string;
  sourceRef: string;
  supportingQuote: string;
}

export interface GeminiProductIntelligenceResult {
  candidateId: string;
  commercialEntityType: CommercialEntityType;
  suggestedProductName: string | null;
  suggestedProductType: string | null;
  nicheRelevance: NicheRelevanceLevel;
  isLikelySellableProduct: boolean;
  identityEvidenceRefs: string[];
  relevanceEvidenceRefs: string[];
  directlyObservedClaims: DirectlyObservedClaim[];
  inferredClaims: string[];
  contradictions: string[];
  uncertainties: string[];
  aiConfidence: number; // 0.0 to 1.0
  needsHumanReview: boolean;
}

export interface GeminiObservationInput {
  source: string;
  sourceRecordId: string;
  advertiser: string | null;
  headline: string | null;
  description: string | null;
  landingPageUrl: string | null;
  creativeReference: string | null;
}

export interface GeminiMerchantEvidenceInput {
  canonicalUrl: string | null;
  pageType: string;
  productName: string | null;
  brand: string | null;
  description: string | null;
  evidenceRefs: string[];
}

export interface AIProductAnalysisInput {
  researchRunId: string;
  candidateId: string;
  topic: string;
  market: string;
  observations: GeminiObservationInput[];
  merchantEvidence: GeminiMerchantEvidenceInput;
}

export interface GeminiModelCapability {
  supportsGenerateContent: boolean;
  supportsStructuredOutput: boolean;
  supportsVision: boolean;
  supportsVideo: boolean;
  inputTokenLimit: number;
  outputTokenLimit: number;
  isAvailableToAccount: boolean;
  isDeprecatedOrRemoved: boolean;
  estimatedCostTier: "FREE" | "LOW" | "MEDIUM" | "HIGH";
}

export interface GeminiModelDescriptor {
  modelId: string; // e.g. "gemini-3.7-flash"
  rawName: string; // e.g. "models/gemini-3.7-flash"
  displayName: string;
  description: string;
  version: string;
  capabilities: GeminiModelCapability;
  priorityScore: number;
  status: "ELIGIBLE" | "UNAVAILABLE" | "OVERLOADED" | "EXHAUSTED" | "INELIGIBLE";
}

export interface GeminiRunBudgetTracker {
  maxGlobalRequests: number;
  maxGlobalTokens: number;
  requestsStarted: number;
  requestsCompleted: number;
  requestsFailed: number;
  retriesExecuted: number;
  fallbackTransitions: number;
  tokensConsumed: number;
  tokensReportedCount: number;
  canStartRequest: () => boolean;
  recordRequestStart: () => boolean;
  recordRequestEnd: (success: boolean, tokensUsed?: number | null) => void;
  recordRetry: () => void;
  recordFallback: () => void;
  getRemainingRequests: () => number;
}

export interface GeminiRouterOptions {
  maxRetriesPerModel?: number; // default 3 (1 initial + 3 retries = 4 total per model)
  maxFallbackModels?: number; // default 2
  retryBaseDelayMs?: number; // default 1000ms
  maxRetryDelayMs?: number; // default 8000ms
  timeoutMs?: number; // per-candidate deadline (default 25000ms)
  perAttemptTimeoutMs?: number; // per-attempt deadline (default 10000ms)
  stageDeadlineAt?: number; // overall stage deadline epoch ms
  jobDeadlineAt?: number; // overall job deadline epoch ms
  signal?: AbortSignal; // cancellation propagation
  budgetTracker?: GeminiRunBudgetTracker;
  maxConcurrentRequests?: number; // default 2
  apiKey?: string;
  forcedModelList?: GeminiModelDescriptor[];
}

export interface GeminiAttemptRecord {
  attemptNumber: number; // 1 = initial, 2..4 = retries
  modelId: string;
  statusCode?: number;
  errorClassification?: string;
  errorMessage?: string;
  delayMs?: number;
  durationMs: number;
  tokensUsed?: number | null;
  timestamp: string;
}

export interface GeminiModelExecutionSummary {
  modelId: string;
  attemptsCount: number;
  retriesExhausted: boolean;
  successful: boolean;
  attempts: GeminiAttemptRecord[];
}

export interface GeminiRetryTelemetry {
  totalAttempts: number;
  retriesExecuted?: number;
  requestsStarted?: number;
  requestsCompleted?: number;
  requestsFailed?: number;
  modelsAttempted: string[];
  successfulModelId: string | null;
  fallbackCount: number;
  executionHistory: GeminiModelExecutionSummary[];
  circuitBreakerTriggered: boolean;
  canceled?: boolean;
  deadlineExceeded?: boolean;
  budgetExhausted?: boolean;
  tokensConsumed?: number | null;
  totalDurationMs: number;
}

export interface GeminiAITelemetry {
  provider: "GOOGLE_GEMINI";
  aiStatus: "COMPLETED" | "PARTIAL" | "DEGRADED" | "UNAVAILABLE" | "SKIPPED" | "CANCELED" | "FAILED";
  authStatus: "KEY_NOT_FOUND" | "KEY_PRESENT" | "AUTHENTICATED" | "PERMISSION_DENIED" | "QUOTA_UNAVAILABLE" | "PROVIDER_UNAVAILABLE";
  modelsDiscoveredCount: number;
  eligibleModelsCount: number;
  primaryModelId: string | null;
  fallbackModels: string[];
  actualModelUsed: string | null;
  successfulModelIds?: string[];
  modelsAttempted?: string[];
  fallbackUsed: boolean;
  fallbackTransitionsCount?: number;
  totalAnalysesAttempted: number;
  totalAnalysesCompleted: number;
  liveAnalysesCompleted?: number;
  cachedAnalysesReused?: number;
  totalAnalysesFailed: number;
  skippedAnalysesCount?: number;
  unavailableAnalysesCount?: number;
  requestsStarted?: number;
  requestsCompleted?: number;
  requestsFailed?: number;
  retriesExecuted?: number;
  tokensConsumed?: number | null;
  actualBillableUsage?: number | null;
  globalBudgetRemaining?: number;
  physicalProductsCount: number;
  servicesRejectedCount: number;
  contentRejectedCount: number;
  insuranceLeadGenRejectedCount: number;
  unknownClassificationsCount: number;
  evidenceContradictionsCount: number;
  invalidAIOutputsRejectedCount: number;
  retryTelemetry?: GeminiRetryTelemetry;
  totalInputTokens?: number;
  totalOutputTokens?: number;
  lastError?: string | null;
}

export interface HistoricalBacktestRecord {
  recordId: string;
  topic: string;
  market: string;
  adHeadline: string;
  adDescription: string;
  landingPageUrl: string;
  merchantTitle?: string;
  merchantDescription?: string;
  // Human ground truth labels (stripped before prediction)
  goldCommercialEntityType: CommercialEntityType;
  goldNicheRelevance: NicheRelevanceLevel;
  goldIsLikelySellableProduct: boolean;
  goldExpectedShortlistEligibility: boolean;
  goldExclusionReason?: string;
  // Metadata & Provenance
  isCriticalRegressionCase?: boolean; // e.g. "ER Vet bill cost factors"
  provenance: string;
  labelProvenance?: "CURATED_FIXTURE_EXPECTATION" | "INDEPENDENT_HISTORICAL_REVIEW";
  split?: "DEV" | "HOLDOUT";
}

export interface HistoricalBacktestPrediction {
  recordId: string;
  ruleBasedEligible: boolean;
  ruleBasedRelevance: string;
  aiResult?: GeminiProductIntelligenceResult | null;
  deterministicVerified: boolean;
  finalShortlistEligible: boolean;
  productRealityStatus?: ProductRealityStatus;
  exclusionReason?: string | null;
  correctClassification: boolean;
  correctShortlistDecision: boolean;
  durationMs: number;
}

export interface HistoricalBacktestMetrics {
  totalRecords: number;
  tp?: number;
  fp?: number;
  tn?: number;
  fn?: number;
  physicalProductPrecision: number;
  physicalProductRecall: number;
  physicalProductF1?: number;
  specificity?: number;
  falsePositiveRate?: number;
  falseProductPositiveCount: number;
  serviceToProductFalsePositives: number;
  contentToProductFalsePositives: number;
  nicheRelevancePrecision: number;
  nicheRelevanceRecall: number;
  nicheRelevanceAccuracy?: number;
  identityAccuracy: number;
  shortlistEligibilityAccuracy: number;
  criticalFalsePositivesCount: number; // MUST BE 0
  aiAbstentionRate: number;
  modelFallbackSuccessRate: number | null;
  averageLatencyMs: number;
  totalRealApiCalls: number;
  estimatedCostCredits: number;
}

export interface HistoricalBacktestReport {
  datasetVersion: string;
  datasetHash: string;
  evaluatedAt: string;
  executionMode:
    | "MODE_A_CONTRACT_FIXTURES"
    | "MODE_B_HISTORICAL_BLIND"
    | "MODE_C_REAL_GEMINI"
    | "MODE_A_CONTRACT_REPLAY"
    | "MODE_B_HISTORICAL_GOLD"
    | "MODE_C_AUTHORIZED_LIVE"
    | "MODE_D_E2E_RESEARCH";
  baselineMetrics: {
    falsePositiveCount: number;
    shortlistAccuracy: number;
    serviceToProductFalsePositives: number;
  };
  hybridAiMetrics: HistoricalBacktestMetrics;
  holdoutMetrics?: {
    totalHoldoutRecords: number;
    shortlistEligibilityAccuracy: number;
    falsePositiveCount: number;
  };
  criticalRegressionPassed: boolean;
  predictions: HistoricalBacktestPrediction[];
  summary: string;
}

export interface AcceptanceGateResult {
  gateId: string;
  verdict: "PASS" | "FAIL" | "BLOCKED" | "NOT_RUN" | "INSUFFICIENT_EVIDENCE";
  executed: boolean;
  actualAssertion: string;
  expected: unknown;
  observed: unknown;
  executionCommand: string | null;
  exitCode: number | null;
  runId: string | null;
  evidenceRefs: string[];
  reason: string | null;
}
