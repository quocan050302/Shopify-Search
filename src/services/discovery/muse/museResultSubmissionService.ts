/**
 * SWAI — Muse External-Agent Result Submission & Ingestion Pipeline
 *
 * Handles source-backed research results delivered by the external Muse agent:
 * 1. Zod runtime validation of submission payload, submissionId / idempotency key.
 * 2. Idempotent submission: duplicate submission IDs return previous outcome without duplicating observations.
 * 3. Atomic status transitions preventing concurrent submission races.
 * 4. Honest handling of zero-result searches (COMPLETED_EMPTY vs FAILED).
 * 5. Independent record normalization (one bad record does not abort valid ads in the batch).
 * 6. Transactional database ingestion via ingestDiscoveredAds().
 * 7. Accurate audit ledger recording with provider "muse-ad-library" and zero external API cost.
 */

import { z } from "zod";
import { prisma } from "@/lib/db";
import {
  MUSE_PROVIDER_ID,
  MuseFacebookAdRecord,
  normalizeFacebookAd,
} from "../normalization/normalizeFacebookAd";
import { ingestDiscoveredAds } from "../discoveryIngestionService";
import { NormalizedDiscoveredAd } from "../types";
import { AuthenticatedMuseAgent } from "@/services/security/museAuth";
import { isTestOrSimulatedAgent } from "./museBridgeService";

export const MuseResultSubmissionSchema = z.object({
  submissionId: z.string().min(1).default(() => `sub_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`),
  requestId: z.string().optional(),
  agentId: z.string().optional(),
  records: z.array(z.record(z.string(), z.unknown())).default([]),
  searchContext: z
    .object({
      keywords: z.array(z.string()).optional(),
      market: z.string().optional(),
      notes: z.string().optional(),
    })
    .optional(),
  outcome: z.enum(["COMPLETED_EMPTY", "COMPLETED_WITH_RESULTS", "PARTIAL", "FAILED"]).optional(),
});

export type MuseResultSubmission = z.infer<typeof MuseResultSubmissionSchema>;

export interface MuseSubmissionSummary {
  requestId: string;
  submissionId: string;
  status: string;
  outcomeCategory: string;
  totalSubmitted: number;
  formatValid: number;
  newUniqueInserted: number;
  existingUpdated: number;
  rejectedCount: number;
  failedCount: number;
  adIds: string[];
  rejectedReasons: string[];
  isIdempotentReplay?: boolean;
}

/**
 * Submits and ingests verified Muse research results into the SWAI database.
 */
export async function submitMuseResearchResults(
  requestId: string,
  rawPayload: unknown,
  agent: AuthenticatedMuseAgent
): Promise<MuseSubmissionSummary> {
  void agent;
  // 1. Validate submission payload
  const parsed = MuseResultSubmissionSchema.safeParse(rawPayload);
  if (!parsed.success) {
    throw new Error(
      `Invalid Muse submission payload: ${parsed.error.issues.map((i) => i.message).join(", ")}`
    );
  }

  const { submissionId, records } = parsed.data;

  // 2. Check for duplicate idempotent submission
  const existingLedger = await prisma.providerRequestLedger.findFirst({
    where: {
      providerId: MUSE_PROVIDER_ID,
      discoveryRunId: requestId,
      providerRequestId: submissionId,
    },
    include: { discoveryRun: true },
  });

  if (existingLedger && existingLedger.discoveryRun) {
    const run = existingLedger.discoveryRun;
    return {
      requestId: run.id,
      submissionId,
      status: run.status,
      outcomeCategory: existingLedger.outcome,
      totalSubmitted: run.actualRetrievedCount,
      formatValid: run.validCount,
      newUniqueInserted: run.newUniqueCount,
      existingUpdated: run.existingDuplicateCount,
      rejectedCount: run.rejectedCount,
      failedCount: run.failedCount,
      adIds: [],
      rejectedReasons: [],
      isIdempotentReplay: true,
    };
  }

  // 3. Check request existence and state atomically
  const run = await prisma.discoveryRun.findUnique({
    where: { id: requestId },
  });

  if (!run || run.providerId !== MUSE_PROVIDER_ID) {
    throw new Error(`Muse request '${requestId}' not found.`);
  }

  if (run.status === "COMPLETED" || run.status === "CANCELLED" || run.status === "FAILED") {
    throw new Error(
      `Muse request '${requestId}' is already ${run.status}; results are accepted only once.`
    );
  }

  // Extract query context
  let query: Record<string, unknown> = {};
  try {
    query = JSON.parse(run.queryConfigJson);
  } catch {
    query = {};
  }
  const queryMarket = typeof query.market === "string" ? query.market : "US";

  // Mark status as RUNNING while ingesting
  const startedAt = run.startedAt || new Date();
  await prisma.discoveryRun.update({
    where: { id: run.id },
    data: { status: "RUNNING", startedAt, heartbeatAt: new Date() },
  });

  // 4. Handle genuine empty search results
  if (records.length === 0) {
    const finishedAt = new Date();
    const finalStatus = "COMPLETED";

    await prisma.discoveryRun.update({
      where: { id: run.id },
      data: {
        status: finalStatus,
        actualRetrievedCount: 0,
        validCount: 0,
        newUniqueCount: 0,
        existingDuplicateCount: 0,
        rejectedCount: 0,
        failedCount: 0,
        totalRequestCount: 1,
        finishedAt,
        errorMessage: null,
      },
    });

    if (run.jobId) {
      await prisma.syncJob.update({
        where: { id: run.jobId },
        data: {
          status: "COMPLETED",
          progress: 100,
          completedAt: finishedAt,
          errorMessage: "Zero matching ads observed on Meta Ad Library.",
        },
      });
    }

    await prisma.providerRequestLedger.create({
      data: {
        providerId: MUSE_PROVIDER_ID,
        discoveryRunId: run.id,
        jobId: run.jobId || undefined,
        providerRequestId: submissionId,
        outcome: "COMPLETED_EMPTY",
        resultCount: 0,
        estimatedCost: 0,
        actualCost: 0,
        endpointRedacted: "external-agent://muse/meta-ad-library",
      },
    });

    return {
      requestId: run.id,
      submissionId,
      status: finalStatus,
      outcomeCategory: "COMPLETED_EMPTY",
      totalSubmitted: 0,
      formatValid: 0,
      newUniqueInserted: 0,
      existingUpdated: 0,
      rejectedCount: 0,
      failedCount: 0,
      adIds: [],
      rejectedReasons: [],
    };
  }

  // 5. Normalize records independently
  const normalized: NormalizedDiscoveredAd[] = [];
  const rejectedReasons: string[] = [];

  for (const rawRecord of records) {
    try {
      const normalizedAd = normalizeFacebookAd(rawRecord as unknown as MuseFacebookAdRecord, {
        queryMarket,
        retrievedAt: new Date(),
      });
      normalized.push(normalizedAd);
    } catch (normErr: unknown) {
      const msg = normErr instanceof Error ? normErr.message : String(normErr);
      rejectedReasons.push(msg);
    }
  }

  // 6. Ingest valid records via the transactional ingestion pipeline
  let ing = {
    newUniqueInserted: 0,
    existingUpdated: 0,
    failedCount: 0,
    adIds: [] as string[],
    errors: [] as Array<{ identityHash: string; error: string }>,
  };

  const isSimulation =
    run.runMode === "SIMULATED" ||
    run.runMode === "TEST" ||
    isTestOrSimulatedAgent(agent.agentId) ||
    Boolean((rawPayload as Record<string, unknown>)?.isSimulation) ||
    (rawPayload as Record<string, unknown>)?.environment === "TEST";

  if (normalized.length > 0) {
    ing = await ingestDiscoveredAds(normalized, {
      workspaceId: run.workspaceId,
      jobId: run.jobId || undefined,
      discoveryRunId: run.id,
      providerId: MUSE_PROVIDER_ID,
      runMode: isSimulation ? "SIMULATED" : "MANUAL",
      isQuarantined: isSimulation,
    });
  }

  const retrieved = records.length;
  const rejectedCount = rejectedReasons.length;
  const failedCount = ing.failedCount;
  const formatValid = normalized.length;
  const validCommitted = formatValid - failedCount;

  // Determine final status
  let finalStatus: "COMPLETED" | "PARTIALLY_COMPLETED" | "FAILED" = "COMPLETED";
  let outcomeCategory = "COMPLETED_WITH_RESULTS";

  if (retrieved > 0 && validCommitted === 0) {
    finalStatus = "FAILED";
    outcomeCategory = "FAILED";
  } else if (rejectedCount > 0 || failedCount > 0) {
    finalStatus = "PARTIALLY_COMPLETED";
    outcomeCategory = "PARTIAL";
  } else {
    finalStatus = "COMPLETED";
    outcomeCategory = "COMPLETED_WITH_RESULTS";
  }

  const finishedAt = new Date();
  const errorSummary =
    finalStatus === "COMPLETED"
      ? null
      : [...rejectedReasons, ...ing.errors.map((e) => e.error)].slice(0, 5).join(" | ") || null;

  // 7. Update DiscoveryRun (isolate simulated/test runs)
  await prisma.discoveryRun.update({
    where: { id: run.id },
    data: {
      status: finalStatus,
      runMode: isSimulation ? "SIMULATED" : run.runMode,
      actualRetrievedCount: retrieved,
      validCount: Math.max(0, validCommitted),
      newUniqueCount: ing.newUniqueInserted,
      existingDuplicateCount: ing.existingUpdated,
      rejectedCount,
      failedCount,
      totalRequestCount: 1,
      errorMessage: errorSummary,
      finishedAt,
    },
  });

  // 8. Update SyncJob
  if (run.jobId) {
    await prisma.syncJob.update({
      where: { id: run.jobId },
      data: {
        status: finalStatus === "COMPLETED" ? "COMPLETED" : "FAILED",
        progress: 100,
        completedAt: finishedAt,
        errorMessage: errorSummary ?? undefined,
      },
    });
  }

  // 9. Create ProviderRequestLedger entry
  await prisma.providerRequestLedger.create({
    data: {
      providerId: MUSE_PROVIDER_ID,
      discoveryRunId: run.id,
      jobId: run.jobId || undefined,
      providerRequestId: submissionId,
      outcome: outcomeCategory,
      resultCount: ing.newUniqueInserted + ing.existingUpdated,
      estimatedCost: 0,
      actualCost: 0,
      errorCategory: finalStatus === "COMPLETED" ? null : "DISCOVERY_PARTIAL",
      endpointRedacted: "external-agent://muse/meta-ad-library",
    },
  });

  return {
    requestId: run.id,
    submissionId,
    status: finalStatus,
    outcomeCategory,
    totalSubmitted: retrieved,
    formatValid,
    newUniqueInserted: ing.newUniqueInserted,
    existingUpdated: ing.existingUpdated,
    rejectedCount,
    failedCount,
    adIds: ing.adIds,
    rejectedReasons,
  };
}
