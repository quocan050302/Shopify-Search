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

export interface GeminiRouterOptions {
  maxRetriesPerModel?: number; // default 3
  maxFallbackModels?: number; // default 2
  retryBaseDelayMs?: number; // default 1000ms
  maxRetryDelayMs?: number; // default 8000ms
  timeoutMs?: number; // default 30000ms
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
  modelsAttempted: string[];
  successfulModelId: string | null;
  fallbackCount: number;
  executionHistory: GeminiModelExecutionSummary[];
  circuitBreakerTriggered: boolean;
  totalDurationMs: number;
}

export interface GeminiAITelemetry {
  provider: "GOOGLE_GEMINI";
  aiStatus: "COMPLETED" | "PARTIAL" | "UNAVAILABLE" | "SKIPPED";
  authStatus: "KEY_NOT_FOUND" | "KEY_PRESENT" | "AUTHENTICATED" | "PERMISSION_DENIED" | "QUOTA_UNAVAILABLE" | "PROVIDER_UNAVAILABLE";
  modelsDiscoveredCount: number;
  eligibleModelsCount: number;
  primaryModelId: string | null;
  fallbackModels: string[];
  actualModelUsed: string | null;
  fallbackUsed: boolean;
  totalAnalysesAttempted: number;
  totalAnalysesCompleted: number;
  totalAnalysesFailed: number;
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
  // Human ground truth labels
  goldCommercialEntityType: CommercialEntityType;
  goldNicheRelevance: NicheRelevanceLevel;
  goldIsLikelySellableProduct: boolean;
  goldExpectedShortlistEligibility: boolean;
  goldExclusionReason?: string;
  // Metadata
  isCriticalRegressionCase?: boolean; // e.g. "ER Vet bill cost factors"
  provenance: string;
}

export interface HistoricalBacktestPrediction {
  recordId: string;
  ruleBasedEligible: boolean;
  ruleBasedRelevance: string;
  aiResult?: GeminiProductIntelligenceResult | null;
  deterministicVerified: boolean;
  finalShortlistEligible: boolean;
  exclusionReason?: string | null;
  correctClassification: boolean;
  correctShortlistDecision: boolean;
  durationMs: number;
}

export interface HistoricalBacktestMetrics {
  totalRecords: number;
  physicalProductPrecision: number;
  physicalProductRecall: number;
  falseProductPositiveCount: number;
  serviceToProductFalsePositives: number;
  contentToProductFalsePositives: number;
  nicheRelevancePrecision: number;
  nicheRelevanceRecall: number;
  identityAccuracy: number;
  shortlistEligibilityAccuracy: number;
  criticalFalsePositivesCount: number; // MUST BE 0
  aiAbstentionRate: number;
  modelFallbackSuccessRate: number;
  averageLatencyMs: number;
  totalRealApiCalls: number;
  estimatedCostCredits: number;
}

export interface HistoricalBacktestReport {
  datasetVersion: string;
  datasetHash: string;
  evaluatedAt: string;
  executionMode: "MODE_A_CONTRACT_REPLAY" | "MODE_B_HISTORICAL_GOLD" | "MODE_C_AUTHORIZED_LIVE" | "MODE_D_E2E_RESEARCH";
  baselineMetrics: {
    falsePositiveCount: number;
    shortlistAccuracy: number;
    serviceToProductFalsePositives: number;
  };
  hybridAiMetrics: HistoricalBacktestMetrics;
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
