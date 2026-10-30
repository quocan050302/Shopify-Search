/**
 * SWAI KH-02 — Universal Live Source Evidence & Provenance Model
 *
 * Implements truthful, verifiable provenance tracking across all advertising sources:
 * - Differentiates fresh live provider acquisition from cached database rows.
 * - Tracks exact provider query parameters, response latency, and evidence references.
 * - Enforces market delivery verification vs requested market distinction.
 */

import { IntelligenceSource, ObservationProvenance } from "../types";

export interface SourceObservationEvidence {
  source: IntelligenceSource;
  providerName: string;
  externalRecordId: string | null;
  sourceUrl: string | null;
  advertiserName: string | null;
  advertiserId: string | null;
  title: string | null;
  description: string | null;
  creativeUrl: string | null;
  thumbnailUrl: string | null;
  videoUrl: string | null;
  landingPageUrl: string | null;
  requestedMarket: string;
  reportedMarket: string | null;
  marketVerification: "VERIFIED" | "INFERRED" | "UNKNOWN";
  reportedFirstShownAt: string | null;
  reportedLastShownAt: string | null;
  observedAt: string;
  acquisitionMethod: "LIVE_MCP_QUERY" | "DATABASE_CACHE" | "MANUAL_IMPORT" | "API_PULL";
  provenanceType: ObservationProvenance;
  rawEvidenceReference: string | null;
}

export interface SourceQueryRecord {
  queryId: string;
  researchRunId: string;
  workspaceId: string;
  provider: IntelligenceSource;
  requestParameters: Record<string, unknown>;
  startTime: string;
  endTime: string;
  resultStatus: "PASSED" | "PARTIAL" | "FAILED" | "BLOCKED" | "NO_RESULTS";
  recordsReturned: number;
  recordsAccepted: number;
  recordsRejected: number;
  errorClassification: string | null;
  costCredits: number;
  evidenceReferences: string[];
}

/**
 * Creates a normalized SourceObservationEvidence object from raw source attributes.
 */
export function createSourceObservationEvidence(
  params: Omit<SourceObservationEvidence, "observedAt"> & { observedAt?: string }
): SourceObservationEvidence {
  return {
    ...params,
    observedAt: params.observedAt || new Date().toISOString(),
  };
}
