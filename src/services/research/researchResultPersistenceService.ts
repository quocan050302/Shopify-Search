/**
 * SWAI Research Result Persistence Orchestration Service
 *
 * KH-01 Checkpoint 4 — Transactional & Idempotent Research Persistence
 *
 * Guarantees:
 * - Claim fencing: Assert worker ownership before persistence.
 * - Atomicity: LandingPageSnapshot, CompetitorOfferSnapshot, ResearchEvidence,
 *   and terminal SyncJob updates commit together in a single Prisma $transaction.
 * - Idempotency: Re-execution of the same job attempt does not duplicate snapshots.
 * - Truthful Terminal Status: ACCESS_RESTRICTED sources do not write COMPLETED status.
 * - No implicit workspace fallback: Workspace comes strictly from authorized job context.
 */

import { prisma } from "@/lib/db";
import { ClaimedKh01Job, assertActiveJobLease } from "@/workers/kh01Worker";
import {
  NormalizedCompetitorOffer,
  persistCompetitorOfferSnapshot,
} from "./offerExtractionService";
import {
  CompetitorFunnelAssessment,
} from "./funnelAnalysisService";
import {
  saveLandingPageSnapshot,
} from "./landingPageSnapshotService";
import {
  createResearchEvidence,
} from "./evidenceService";
import { ResearchAccessContext } from "./researchAuthService";

export interface ParsedResearchPayload {
  workspaceId: string;
  productId?: string | null;
  adId?: string | null;
  originalUrl: string;
  finalUrl: string | null;
  httpStatus: number;
  accessStatus: "SUCCESS" | "ACCESS_RESTRICTED" | "RATE_LIMITED" | "FAILED";
  pageTitle?: string | null;
  metaDescription?: string | null;
  htmlContent?: string | null;
  normalizedOffer: NormalizedCompetitorOffer | null;
  funnelAssessment: CompetitorFunnelAssessment | null;
  warnings: string[];
  errorMessage?: string | null;
}

export interface PersistedResearchResult {
  jobId: string;
  status: "COMPLETED" | "ACCESS_RESTRICTED" | "RATE_LIMITED" | "FAILED";
  snapshotId: string | null;
  offerSnapshotId: string | null;
  sellingPrice: number | null;
  currency: string | null;
  evidenceIds: string[];
  isIdempotentReplay?: boolean;
}

/**
 * Transactionally persists research artifacts under active worker claim.
 */
export async function persistCompletedResearchResult(
  claim: ClaimedKh01Job,
  result: ParsedResearchPayload
): Promise<PersistedResearchResult> {
  // 1. Read current job payload to preserve inputs & check idempotency
  const currentJob = await prisma.syncJob.findUnique({
    where: { id: claim.id },
  });
  if (!currentJob) {
    throw new Error(`SyncJob '${claim.id}' not found during persistence.`);
  }

  let jobConfig: any = {};
  try {
    jobConfig = JSON.parse(currentJob.resultJson || "{}");
  } catch {
    // ignore
  }

  // Idempotency: If this job was already completed with stored snapshots, return existing IDs safely
  if (
    (currentJob.status === "COMPLETED" || currentJob.status === "ACCESS_RESTRICTED") &&
    jobConfig.snapshotId
  ) {
    return {
      jobId: claim.id,
      status: currentJob.status as any,
      snapshotId: jobConfig.snapshotId,
      offerSnapshotId: jobConfig.offerSnapshotId || null,
      sellingPrice: jobConfig.sellingPrice ?? null,
      currency: jobConfig.currency ?? null,
      evidenceIds: jobConfig.evidenceIds || [],
      isIdempotentReplay: true,
    };
  }

  // 2. Claim verification before persistence for running jobs
  await assertActiveJobLease(claim.id, claim.workerId, claim.claimToken);

  const context: ResearchAccessContext = {
    workspaceId: result.workspaceId,
    actorId: claim.workerId,
    accessMode: "AUTHENTICATED",
  };

  // 3. Handle ACCESS_RESTRICTED sources truthfully
  if (result.accessStatus === "ACCESS_RESTRICTED") {
    return await prisma.$transaction(async (tx) => {
      // Re-verify lease inside transaction boundary
      const inTxJob = await tx.syncJob.findUnique({ where: { id: claim.id } });
      let txMeta: any = {};
      try {
        txMeta = JSON.parse(inTxJob?.resultJson || "{}");
      } catch {
        // ignore
      }
      if (txMeta.claimToken !== claim.claimToken) {
        throw new Error("Claim token mismatch during transaction persistence.");
      }

      const blockedSnapshot = await tx.landingPageSnapshot.create({
        data: {
          workspaceId: result.workspaceId,
          productId: result.productId ?? null,
          adId: result.adId ?? null,
          originalUrl: result.originalUrl,
          finalUrl: result.finalUrl,
          httpStatus: result.httpStatus,
          accessStatus: "ACCESS_RESTRICTED",
          contentHash: "blocked_access",
          observationsJson: JSON.stringify({
            note: "Access restricted by competitor website (HTTP 401/403).",
          }),
          croSignalsJson: JSON.stringify({
            note: "Unable to inspect DOM: Storefront access restricted.",
          }),
          warningsJson: JSON.stringify([
            result.errorMessage || "Access restricted by destination.",
          ]),
          analysisVersion: "11.4.2",
          observedAt: new Date(),
        },
      });

      // Terminal status is ACCESS_RESTRICTED (not falsely COMPLETED)
      await tx.syncJob.update({
        where: { id: claim.id, status: "RUNNING" },
        data: {
          status: "ACCESS_RESTRICTED",
          progress: 100,
          completedAt: new Date(),
          errorMessage: result.errorMessage || "Competitor storefront restricted access.",
          resultJson: JSON.stringify({
            ...jobConfig,
            snapshotId: blockedSnapshot.id,
            offerSnapshotId: null,
            accessStatus: "ACCESS_RESTRICTED",
            completedAt: new Date().toISOString(),
          }),
        },
      });

      return {
        jobId: claim.id,
        status: "ACCESS_RESTRICTED" as const,
        snapshotId: blockedSnapshot.id,
        offerSnapshotId: null,
        sellingPrice: null,
        currency: null,
        evidenceIds: [],
      };
    });
  }

  // 4. Handle successful inspection atomically
  return await prisma.$transaction(async (tx) => {
    // Re-verify lease inside transaction boundary
    const inTxJob = await tx.syncJob.findUnique({ where: { id: claim.id } });
    let txMeta: any = {};
    try {
      txMeta = JSON.parse(inTxJob?.resultJson || "{}");
    } catch {
      // ignore
    }
    if (txMeta.claimToken !== claim.claimToken) {
      throw new Error("Claim token mismatch during transaction persistence.");
    }

    // A. Persist / Resolve Offer Snapshot
    let offerSnapshotId: string | null = null;
    if (result.normalizedOffer) {
      const offerSnapshot = await persistCompetitorOfferSnapshot(
        result.normalizedOffer,
        context,
        tx
      );
      offerSnapshotId = offerSnapshot.id;
    }

    // B. Persist Landing Page Snapshot
    const landingSnapshot = await saveLandingPageSnapshot({
      workspaceId: result.workspaceId,
      productId: result.productId,
      adId: result.adId,
      originalUrl: result.originalUrl,
      finalUrl: result.finalUrl,
      httpStatus: result.httpStatus,
      accessStatus: "SUCCESS",
      pageTitle: result.pageTitle,
      metaDescription: result.metaDescription,
      htmlContent: result.htmlContent,
      observedPrice: result.normalizedOffer?.sellingPrice ?? null,
      currency: result.normalizedOffer?.currency ?? null,
      bundleQuantity: result.normalizedOffer?.bundleQuantity ?? null,
      freeShippingThreshold: result.normalizedOffer?.freeShippingThreshold ?? null,
      structure: result.funnelAssessment?.structure || ({} as any),
      croSignals: result.funnelAssessment || ({} as any),
      messageMatch: result.funnelAssessment?.messageMatch || null,
      warnings: result.warnings,
      tx,
    });

    // C. Persist Research Evidence (Duplicate-safe)
    const evidenceIds: string[] = [];
    if (result.productId) {
      if (result.normalizedOffer && result.normalizedOffer.sellingPrice !== null) {
        const priceEvidence = await createResearchEvidence(
          {
            productId: result.productId,
            subjectType: "OFFER",
            subjectId: offerSnapshotId || landingSnapshot.id,
            pillar: "OFFER",
            claim: "Observed competitor selling price on landing page",
            observedValue: `${result.normalizedOffer.currency || ""} ${result.normalizedOffer.sellingPrice}`.trim(),
            sourceUrl: result.finalUrl || result.originalUrl,
            observationMethod: "STOREFRONT_HTTP",
            classification: "SOURCE_OBSERVED",
            sourceContentRef: `snapshot:${landingSnapshot.id}`,
          },
          context,
          tx
        );
        evidenceIds.push(priceEvidence.id);
      }

      if (result.funnelAssessment?.structure?.primaryCtaText) {
        const ctaEvidence = await createResearchEvidence(
          {
            productId: result.productId,
            subjectType: "FUNNEL",
            subjectId: landingSnapshot.id,
            pillar: "LANDING_PAGE",
            claim: "Observed primary Call-to-Action button",
            observedValue: result.funnelAssessment.structure.primaryCtaText,
            sourceUrl: result.finalUrl || result.originalUrl,
            observationMethod: "DOM_INSPECTION",
            classification: "SOURCE_OBSERVED",
            sourceContentRef: `snapshot:${landingSnapshot.id}`,
          },
          context,
          tx
        );
        evidenceIds.push(ctaEvidence.id);
      }
    }

    // D. Reconcile SyncJob to COMPLETED
    await tx.syncJob.update({
      where: { id: claim.id, status: "RUNNING" },
      data: {
        status: "COMPLETED",
        progress: 100,
        completedAt: new Date(),
        resultJson: JSON.stringify({
          ...jobConfig,
          snapshotId: landingSnapshot.id,
          offerSnapshotId,
          sellingPrice: result.normalizedOffer?.sellingPrice ?? null,
          currency: result.normalizedOffer?.currency ?? null,
          croReadiness: result.funnelAssessment?.croReadiness ?? null,
          evidenceIds,
          completedAt: new Date().toISOString(),
        }),
      },
    });

    return {
      jobId: claim.id,
      status: "COMPLETED" as const,
      snapshotId: landingSnapshot.id,
      offerSnapshotId,
      sellingPrice: result.normalizedOffer?.sellingPrice ?? null,
      currency: result.normalizedOffer?.currency ?? null,
      evidenceIds,
    };
  });
}
