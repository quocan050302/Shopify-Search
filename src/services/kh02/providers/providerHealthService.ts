/**
 * SWAI KH-02 — Provider Health & Readiness Service
 *
 * Provides non-destructive diagnostic evaluations for all intelligence sources:
 * META_ADS, TIKTOK_ADS, TIKTOK_ORGANIC, GOOGLE_ADS, and DEMAND_HISTORY.
 */

import { IntelligenceSource } from "../types";
import { diagnoseKH02Source, SourceDiagnosticResult } from "./sourceRegistry";

export interface AggregateHealthReport {
  timestamp: string;
  sources: Record<IntelligenceSource, SourceDiagnosticResult>;
  summary: {
    total: number;
    readyOrConfigured: number;
    blockedOrCredentialsRequired: number;
    manualOnly: number;
  };
}

/**
 * Runs non-destructive health checks across all five intelligence sources.
 */
export async function getKH02AggregateHealthReport(
  workspaceId?: string
): Promise<AggregateHealthReport> {
  const sources: IntelligenceSource[] = [
    "META_ADS",
    "TIKTOK_ADS",
    "TIKTOK_ORGANIC",
    "GOOGLE_ADS",
    "DEMAND_HISTORY",
  ];

  const results = await Promise.all(
    sources.map(async (s) => {
      const diag = await diagnoseKH02Source(s, { workspaceId, checkLiveTransport: true });
      return [s, diag] as const;
    })
  );

  const sourceMap = Object.fromEntries(results) as Record<IntelligenceSource, SourceDiagnosticResult>;

  let readyOrConfigured = 0;
  let blockedOrCredentialsRequired = 0;
  let manualOnly = 0;

  for (const diag of Object.values(sourceMap)) {
    if (
      diag.status === "SOURCE_ACCESS_VERIFIED" ||
      diag.status === "CONFIGURED" ||
      diag.status === "ENGINE_READY"
    ) {
      readyOrConfigured++;
    } else if (
      diag.status === "CREDENTIALS_REQUIRED" ||
      diag.status === "MCP_NOT_CONFIGURED" ||
      diag.status === "BLOCKED"
    ) {
      blockedOrCredentialsRequired++;
    } else if (diag.status === "MANUAL_RESEARCH_ONLY") {
      manualOnly++;
    }
  }

  return {
    timestamp: new Date().toISOString(),
    sources: sourceMap,
    summary: {
      total: sources.length,
      readyOrConfigured,
      blockedOrCredentialsRequired,
      manualOnly,
    },
  };
}
