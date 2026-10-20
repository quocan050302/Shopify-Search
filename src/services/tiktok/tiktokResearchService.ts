/**
 * TikTok Creative Center US Research Service — SWAI V7.3
 *
 * Provides research tooling, prefiltered URL builders, and validation rules
 * for TikTok Creative Center Top Ads with United States focus.
 *
 * DESIGN PRINCIPLES:
 * 1. TikTok Creative Center US is the PRIMARY manual research source in SWAI.
 * 2. No paid API keys or scrapers required — researchers browse directly on the
 *    official TikTok Creative Center web portal and import links into SWAI.
 * 3. Never claim 180 days of activity simply because a result appeared in a 180-day search window.
 */

export const TIKTOK_TOP_ADS_US_DEFAULT_URL =
  "https://ads.tiktok.com/business/creativecenter/inspiration/topads/pc/en?period=30&region=US";

export interface TikTokTopAdsFilterOptions {
  period?: 7 | 30 | 180;
  region?: string; // defaults to "US"
  objective?: "Traffic" | "Conversions" | "Lead_Generation" | "Reach";
  industry?: string;
}

export const TOP_ADS_PRESETS = [
  {
    id: "30_DAYS_US_PRIMARY",
    label: "Top Ads US (Last 30 Days) — Primary",
    period: 30 as const,
    region: "US",
    url: "https://ads.tiktok.com/business/creativecenter/inspiration/topads/pc/en?period=30&region=US",
    description: "Standard winning ads benchmark. Highly relevant commercial creatives actively scaling.",
  },
  {
    id: "7_DAYS_US_TRENDING",
    label: "Top Ads US (Last 7 Days) — Breakouts",
    period: 7 as const,
    region: "US",
    url: "https://ads.tiktok.com/business/creativecenter/inspiration/topads/pc/en?period=7&region=US",
    description: "Fast-rising hooks and trending angles from the past week.",
  },
  {
    id: "180_DAYS_US_DISCOVERY",
    label: "Top Ads US (Last 180 Days) — Broad Window",
    period: 180 as const,
    region: "US",
    url: "https://ads.tiktok.com/business/creativecenter/inspiration/topads/pc/en?period=180&region=US",
    description:
      "Historical high-performance pool. IMPORTANT: Result presence only means it ranked within the 180-day window, NOT that it ran for 180 days.",
  },
];

/**
 * Builds the official TikTok Creative Center Top Ads URL with specified filter parameters.
 */
export function buildTikTokTopAdsUrl(options: TikTokTopAdsFilterOptions = {}): string {
  const { period = 30, region = "US", objective, industry } = options;
  const params = new URLSearchParams();

  params.set("period", period.toString());
  params.set("region", region.toUpperCase());

  if (objective) {
    params.set("objective", objective);
  }

  if (industry) {
    params.set("industry", industry);
  }

  return `https://ads.tiktok.com/business/creativecenter/inspiration/topads/pc/en?${params.toString()}`;
}

export interface TikTokMetadataValidationInput {
  url?: string;
  creativeId?: string | null;
  targetRegion?: string | null;
  authorHandle?: string | null;
  reportedImpressions?: number | null;
  searchWindowPeriodDays?: number | null;
  targetMarket?: string | null;
  claimedDaysRunning?: number | null;
}

export interface TikTokMetadataValidationResult {
  isValid: boolean;
  confidence: number;
  targetMarket: string;
  sourceReportedDays: number | null;
  issues: string[];
  warning?: string;
  note: string;
}

/**
 * Validates metadata extracted from a TikTok Creative Center URL or import payload.
 * Guarantees that search window parameters are never misrepresented as verified run days.
 */
export function validateTikTokMetadataIntegrity(
  data: TikTokMetadataValidationInput
): TikTokMetadataValidationResult {
  const issues: string[] = [];

  if (data.reportedImpressions !== undefined && data.reportedImpressions !== null && data.reportedImpressions < 0) {
    issues.push("Reported impressions cannot be negative");
  }

  if (data.creativeId === "unknown" || (data.creativeId !== undefined && !data.creativeId)) {
    issues.push("Invalid or missing creative identifier");
  }

  const hasUS =
    data.targetRegion?.toUpperCase() === "US" ||
    data.targetMarket?.toUpperCase() === "US" ||
    (data.url && data.url.includes("region=US"));

  const targetMarket = hasUS ? "US" : data.targetMarket || data.targetRegion || "UNKNOWN";

  // CRITICAL (Rule 12): Never claim 180 days of activity simply because a result appeared in a 180-day search window
  let warning: string | undefined = undefined;
  let sourceReportedDays: number | null = null;

  if (data.searchWindowPeriodDays && data.searchWindowPeriodDays >= 30) {
    warning =
      `Search window filter (period=${data.searchWindowPeriodDays}d) indicates discovery scope, not active continuous duration. ` +
      `SWAI will not assign ${data.searchWindowPeriodDays} days of activity without independent observation proof.`;
  }

  const isValid = issues.length === 0;
  const confidence = isValid ? 0.9 : 0.0;

  return {
    isValid,
    confidence,
    targetMarket,
    sourceReportedDays,
    issues,
    warning,
    note: "Source-backed metadata: calendar age remains UNKNOWN until independent historical start evidence is observed.",
  };
}
