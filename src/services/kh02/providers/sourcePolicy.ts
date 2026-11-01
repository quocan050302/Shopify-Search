/**
 * SWAI KH-02 — Centralized Source Policy & Release Configuration
 *
 * Implements server-side source enablement and privacy/cost enforcement policy:
 * - TIKTOK_ORGANIC: Permanently hidden and disabled in KH-02. No collector execution,
 *   no outbound network calls, no quota or connection probes, no historical reuse in new runs.
 * - TIKTOK_ADS: Separate commercial source (Creative Center / Ads US), controlled independently.
 * - META_ADS: Active live research & local MCP stdio collector.
 * - GOOGLE_ADS: Active same-run advertiser enrichment via local MCP bridge.
 * - DEMAND_HISTORY: Active temporal policy engine & Google Free demand pipeline (BigQuery sandbox + official CSV imports).
 *
 * Directives:
 * 1. Disabled sources produce ZERO outbound network calls and ZERO subprocesses.
 * 2. Disabled sources do NOT trigger quota checks or read cached records into new research runs.
 * 3. Client selectedSources cannot bypass server-side disabled source policy.
 * 4. Research runs do NOT fail or report PARTIAL due to proactively disabled sources.
 */

import { IntelligenceSource } from "../types";

export interface SourcePolicy {
  source: IntelligenceSource;
  status: "ACTIVE" | "TEMPORARILY_DISABLED" | "DISABLED";
  isEnabled: boolean;
  isTemporarilyDisabled: boolean;
  reason: string;
  uiBadgeLabel: string;
  outboundAllowed: boolean;
  allowOutboundNetworkCalls: boolean;
  requiresCredentials: boolean;
  quotaCheckAllowed: boolean;
  cacheReuseInResearchAllowed: boolean;
  allowCacheFallbackInNewRuns: boolean;
}

/**
 * Server-enforced hidden or permanently disabled source check.
 * TikTok Organic is strictly hidden and disabled across all KH-02 surfaces.
 */
export function isSourceHiddenOrDisabled(source: IntelligenceSource | string): boolean {
  return source === "TIKTOK_ORGANIC";
}

/**
 * Evaluates whether an intelligence source is disabled in KH-02.
 * Server-side authoritative flag: TikTok Organic is permanently disabled.
 * TikTok Ads is separate and managed independently.
 */
export function isSourceTemporarilyDisabled(source: IntelligenceSource | string): boolean {
  if (source === "TIKTOK_ORGANIC") {
    // Server policy: TikTok Organic is strictly and permanently disabled in KH-02
    return true;
  }
  if (source === "TIKTOK_ADS" || source === "TIKTOK_ADS_US") {
    return (
      process.env.ENABLE_TIKTOK_RESEARCH !== "true" &&
      process.env.ENABLE_TIKTOK_ADS_RESEARCH !== "true"
    );
  }
  return false;
}

/**
 * Returns comprehensive policy for a specific intelligence source.
 */
export function getSourcePolicy(source: IntelligenceSource): SourcePolicy {
  if (source === "TIKTOK_ORGANIC") {
    return {
      source,
      status: "DISABLED",
      isEnabled: false,
      isTemporarilyDisabled: true,
      reason:
        "Source 'TIKTOK_ORGANIC' is permanently disabled in KH-02 release policy. Outbound probing, collector execution, quota verification, and cached record reuse are strictly prohibited.",
      uiBadgeLabel: "Disabled",
      outboundAllowed: false,
      allowOutboundNetworkCalls: false,
      requiresCredentials: false,
      quotaCheckAllowed: false,
      cacheReuseInResearchAllowed: false,
      allowCacheFallbackInNewRuns: false,
    };
  }

  const disabled = isSourceTemporarilyDisabled(source);

  if (disabled) {
    return {
      source,
      status: "TEMPORARILY_DISABLED",
      isEnabled: false,
      isTemporarilyDisabled: true,
      reason: `Source '${source}' is temporarily disabled in KH-02 release policy. Outbound probing, collector execution, and quota verification are bypassed.`,
      uiBadgeLabel: "Temporarily Disabled",
      outboundAllowed: false,
      allowOutboundNetworkCalls: false,
      requiresCredentials: false,
      quotaCheckAllowed: false,
      cacheReuseInResearchAllowed: false,
      allowCacheFallbackInNewRuns: false,
    };
  }

  return {
    source,
    status: "ACTIVE",
    isEnabled: true,
    isTemporarilyDisabled: false,
    reason: `Source '${source}' is enabled for live research query and enrichment.`,
    uiBadgeLabel: "Active",
    outboundAllowed: true,
    allowOutboundNetworkCalls: true,
    requiresCredentials: true,
    quotaCheckAllowed: true,
    cacheReuseInResearchAllowed: true,
    allowCacheFallbackInNewRuns: true,
  };
}

/**
 * Filters requested sources against active server policy.
 * Client-specified sources CANNOT bypass server policy.
 */
export function filterActiveResearchSources(requestedSources?: IntelligenceSource[]): IntelligenceSource[] {
  const baseSources: IntelligenceSource[] =
    requestedSources && requestedSources.length > 0
      ? requestedSources
      : ["META_ADS", "GOOGLE_ADS", "DEMAND_HISTORY", "TIKTOK_ADS"];

  // Strictly strip permanently disabled sources (TIKTOK_ORGANIC) and temporarily disabled sources
  return baseSources
    .filter((s) => !isSourceHiddenOrDisabled(s))
    .filter((s) => !isSourceTemporarilyDisabled(s));
}

/**
 * Returns all active sources according to server policy.
 */
export function listActiveResearchSources(): IntelligenceSource[] {
  const all: IntelligenceSource[] = ["META_ADS", "GOOGLE_ADS", "DEMAND_HISTORY", "TIKTOK_ADS"];
  return all.filter((s) => !isSourceTemporarilyDisabled(s));
}
