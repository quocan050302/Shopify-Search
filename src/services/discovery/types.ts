/**
 * SWAI V9 — Discovery Domain Types & Runtime Schemas
 *
 * Provides strict TypeScript types and Zod schemas for the TikTok Auto Discovery Engine.
 * Enforces real-data guarantees, provenance tracking, and error taxonomy.
 */

import { z } from "zod";

// ─── Error Taxonomy ─────────────────────────────────────────────────────────

export const DISCOVERY_ERROR_CODES = [
  "NO_AUTHORIZED_PROVIDER",
  "PROVIDER_NOT_CONFIGURED",
  "PROVIDER_PERMISSION_DENIED",
  "PROVIDER_RATE_LIMITED",
  "PROVIDER_REGION_UNSUPPORTED",
  "PROVIDER_RESPONSE_INVALID",
  "PROVIDER_BUDGET_BLOCKED",
  "PROVIDER_UNAVAILABLE",
  "DISCOVERY_CANCELLED",
  "DISCOVERY_PARTIAL",
  "DISCOVERY_DATABASE_ERROR",
] as const;

export type DiscoveryErrorCode = (typeof DISCOVERY_ERROR_CODES)[number];

export class DiscoveryError extends Error {
  readonly code: DiscoveryErrorCode;
  readonly providerId?: string;
  readonly statusHttp?: number;
  readonly details?: unknown;

  constructor(options: {
    code: DiscoveryErrorCode;
    message: string;
    providerId?: string;
    statusHttp?: number;
    details?: unknown;
  }) {
    super(options.message);
    this.name = "DiscoveryError";
    this.code = options.code;
    this.providerId = options.providerId;
    this.statusHttp = options.statusHttp;
    this.details = options.details;
  }
}

// ─── Provider Capabilities & Status ──────────────────────────────────────────

export const PROVIDER_AVAILABILITY_STATES = [
  "NOT_CONFIGURED",
  "READY_UNVERIFIED",
  "AVAILABLE",
  "LIVE_VERIFIED",
  "REQUIRES_AUTH",
  "PERMISSION_DENIED",
  "REGION_UNSUPPORTED",
  "ENDPOINT_UNSUPPORTED",
  "INVALID_RESPONSE",
  "RATE_LIMITED",
  "BLOCKED_SOURCE",
  "PAID_DISABLED",
  "UNVERIFIED",
] as const;

export type ProviderAvailabilityStatus = (typeof PROVIDER_AVAILABILITY_STATES)[number];

export const DISCOVERY_PROVIDER_STATUS = {
  NOT_CONFIGURED: "NOT_CONFIGURED",
  READY_UNVERIFIED: "READY_UNVERIFIED",
  AVAILABLE: "AVAILABLE",
  LIVE_VERIFIED: "LIVE_VERIFIED",
  REQUIRES_AUTH: "REQUIRES_AUTH",
  PERMISSION_DENIED: "PERMISSION_DENIED",
  REGION_UNSUPPORTED: "REGION_UNSUPPORTED",
  ENDPOINT_UNSUPPORTED: "ENDPOINT_UNSUPPORTED",
  INVALID_RESPONSE: "INVALID_RESPONSE",
  RATE_LIMITED: "RATE_LIMITED",
  BLOCKED_SOURCE: "BLOCKED_SOURCE",
  PAID_DISABLED: "PAID_DISABLED",
  UNVERIFIED: "UNVERIFIED",
} as const;

export interface DiscoveryProviderCapabilities {
  providerId: string;
  displayName: string;
  description: string;
  supportsUS: boolean;
  supportsKeywordFiltering: boolean;
  supportsKeywords?: boolean;
  supportsIndustryFiltering: boolean;
  supportsIndustries?: boolean;
  supportsPagination: boolean;
  supportsAdDetails: boolean;
  supportsVideoMetadata: boolean;
  supportsLifecycleMetadata: boolean;
  requiresAuthentication: boolean;
  requiresAuth?: boolean;
  isPaid: boolean;
  isLiveVerified: boolean;
  notes?: string;
  // V9.2 Source compatibility metadata
  authMethod?: "NONE" | "SESSION_COOKIE" | "BEARER_TOKEN" | "API_KEY" | "OAUTH2";
  allowedDataAccess?: string;
  supportedRegions?: string[];
  termsBasis?: string;
  sourceType?: "OFFICIAL_API" | "INTERNAL_ENDPOINT" | "CLOUD_ACTOR" | "MANUAL_IMPORT";
  apiDocumentationUrl?: string;
  lastLiveVerificationAt?: string | null;
  lastVerificationError?: string | null;
}

// ─── Discovery Query ────────────────────────────────────────────────────────

export const DiscoveryQuerySchema = z.object({
  workspaceId: z.string().default("default-workspace"),
  platform: z.literal("TIKTOK").default("TIKTOK"),
  market: z.string().default("US"),
  keywords: z.array(z.string()).default([]),
  industries: z.array(z.string()).default([]),
  objectives: z.array(z.string()).default([]),
  searchWindowDays: z.union([z.literal(7), z.literal(30), z.literal(180)]).default(30),
  sortBy: z.enum(["relevance", "likes", "ctr", "first_seen"]).default("relevance"),
  requestedLimit: z.number().int().min(1).max(500).default(50),
  pageSize: z.number().int().min(5).max(100).default(20),
  providerId: z.string().optional(),
  runMode: z.enum(["MANUAL", "SCHEDULED", "DRY_RUN"]).default("MANUAL"),
});

export type DiscoveryQuery = z.infer<typeof DiscoveryQuerySchema>;

// ─── Raw & Normalized Discovered Ads ────────────────────────────────────────

export const RawDiscoveredAdSchema = z.object({
  providerId: z.string(),
  sourceUrl: z.string(),
  sourceId: z.string().nullable().optional(),
  rawMetadata: z.record(z.string(), z.unknown()).default({}),
  retrievedAt: z.date().default(() => new Date()),
  sourceTimestamp: z.date().nullable().optional(),
});

export type RawDiscoveredAd = z.infer<typeof RawDiscoveredAdSchema>;

export const DiscoveredMetricSchema = z.object({
  likes: z.number().nullable().optional(),
  ctr: z.number().nullable().optional(),
  cvr: z.number().nullable().optional(),
  costScore: z.number().nullable().optional(),
  comments: z.number().nullable().optional(),
  shares: z.number().nullable().optional(),
  rawMetricsNotice: z.string().optional(),
});

export const NormalizedDiscoveredAdSchema = z.object({
  platform: z.literal("TIKTOK"),
  providerId: z.string(),
  sourceNamespace: z.string(),
  sourceExternalId: z.string().nullable(),
  stableIdentityHash: z.string(),
  advertiserName: z.string(),
  advertiserExternalId: z.string().nullable().optional(),
  headline: z.string().nullable().optional(),
  bodyText: z.string().nullable().optional(),
  callToAction: z.string().nullable().optional(),
  creativeUrl: z.string().url(),
  videoUrl: z.string().nullable().optional(),
  embedUrl: z.string().nullable().optional(),
  thumbnailUrl: z.string().nullable().optional(),
  durationSeconds: z.number().nullable().optional(),
  aspectRatio: z.string().default("9:16"),
  mediaAvailability: z.enum(["READY", "EXPIRED", "RESTRICTED", "FALLBACK_ONLY"]).default("RESTRICTED"),
  landingPageUrl: z.string().nullable().optional(),
  targetMarket: z.string().default("US"),
  marketEvidenceType: z.enum(["QUERY_FILTER", "CONFIRMED_DELIVERY", "UNKNOWN"]).default("QUERY_FILTER"),
  industry: z.string().nullable().optional(),
  objective: z.string().nullable().optional(),
  sourceReportedStartAt: z.date().nullable().optional(),
  sourceReportedEndAt: z.date().nullable().optional(),
  reportedMetrics: DiscoveredMetricSchema.default({}),
  retrievedAt: z.date().default(() => new Date()),
  confidenceScore: z.number().min(0).max(1).default(0.8),
  rawEvidenceReference: z.string().nullable().optional(),
});

export type NormalizedDiscoveredAd = z.infer<typeof NormalizedDiscoveredAdSchema>;

// ─── Pagination & Result Types ──────────────────────────────────────────────

export interface DiscoveryPageResult {
  items: NormalizedDiscoveredAd[];
  nextCursor?: string | null;
  hasMore: boolean;
  requestId?: string | null;
  usage?: {
    creditsUsed: number;
    costUsd?: number;
  };
  warnings?: string[];
}

export const DISCOVERY_JOB_STATUS = {
  PENDING: "PENDING",
  RUNNING: "RUNNING",
  COMPLETED: "COMPLETED",
  PARTIALLY_COMPLETED: "PARTIALLY_COMPLETED",
  FAILED: "FAILED",
  CANCELLED: "CANCELLED",
  BLOCKED_SOURCE: "BLOCKED_SOURCE",
  BUDGET_BLOCKED: "BUDGET_BLOCKED",
} as const;

export type DiscoveryJobStatus = (typeof DISCOVERY_JOB_STATUS)[keyof typeof DISCOVERY_JOB_STATUS];

export interface DiscoveryRunSummary {
  jobId: string;
  providerId: string;
  requestedLimit: number;
  actualRetrievedCount: number;
  validCount: number;
  newUniqueCount: number;
  existingDuplicateCount: number;
  rejectedCount: number;
  failedCount: number;
  totalRequestCount: number;
  estimatedCostUsd?: number;
  actualCostUsd?: number;
  startTime: Date;
  finishTime: Date;
  finalStatus: DiscoveryJobStatus;
  errorMessage?: string | null;
}

// ─── Schedule Configuration ─────────────────────────────────────────────────

export const DiscoveryScheduleConfigSchema = z.object({
  id: z.string().optional(),
  workspaceId: z.string().default("default-workspace"),
  name: z.string().default("US TikTok Top Ads Daily Discovery"),
  enabled: z.boolean().default(false),
  providerId: z.string().default("tiktok-topads"),
  searchWindowDays: z.union([z.literal(7), z.literal(30), z.literal(180)]).default(30),
  targetMarket: z.string().default("US"),
  keywords: z.array(z.string()).default(["ecommerce", "gadget", "beauty"]),
  industries: z.array(z.string()).default([]),
  dailyLimit: z.number().int().min(5).max(200).default(20),
  timezone: z.string().default("UTC"),
  hourOfDayUtc: z.number().int().min(0).max(23).default(6),
});

export type DiscoveryScheduleConfig = z.infer<typeof DiscoveryScheduleConfigSchema>;
