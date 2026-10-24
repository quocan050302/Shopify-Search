/**
 * SWAI Landing Page Snapshot Persistence & Historical Comparison Service
 *
 * KH-01.C — Landing Page & Competitor Funnel Analyzer
 *
 * Rules:
 * - Versioned persistence: Never overwrites evidence history on refresh.
 * - Detects meaningful commercial changes (pricing, headline, CTA, shipping).
 * - Ignores superficial HTML fluctuations (session tokens, timestamps).
 */

import { createHash } from "crypto";
import { prisma } from "@/lib/db";
import {
  LandingPageStructure,
  CompetitorFunnelAssessment,
  MessageMatchAssessment,
} from "./funnelAnalysisService";

export interface SaveLandingPageSnapshotInput {
  workspaceId?: string | null;
  productId?: string | null;
  storeId?: string | null;
  adId?: string | null;
  originalUrl: string;
  finalUrl?: string | null;
  httpStatus: number;
  accessStatus: "SUCCESS" | "ACCESS_RESTRICTED" | "RATE_LIMITED" | "NOT_FOUND" | "FAILED";
  pageTitle?: string | null;
  metaDescription?: string | null;
  htmlContent?: string | null;
  structure: LandingPageStructure;
  croSignals: CompetitorFunnelAssessment;
  messageMatch?: MessageMatchAssessment | null;
  warnings?: string[];
}

export interface LandingPageChangeReport {
  hasChanges: boolean;
  olderObservedAt: string;
  newerObservedAt: string;
  detectedChanges: {
    field: string;
    olderValue: string | null;
    newerValue: string | null;
    significance: "HIGH" | "MEDIUM" | "LOW";
  }[];
  summary: string;
}

/**
 * Persists a versioned snapshot of an inspected competitor landing page.
 */
export async function saveLandingPageSnapshot(input: SaveLandingPageSnapshotInput) {
  // Compute deterministic content hash based on visible semantic content (not ephemeral session tokens)
  const semanticDigest = [
    input.pageTitle || "",
    input.structure.heroHeadline || "",
    input.structure.primaryCtaText || "",
    input.structure.hasVisiblePriceNearCta ? "price:yes" : "price:no",
    input.structure.hasShippingPolicySummary ? "shipping:yes" : "shipping:no",
    input.structure.hasReturnPolicySummary ? "return:yes" : "return:no",
  ].join("|");

  const contentHash = createHash("sha256").update(semanticDigest).digest("hex");

  return await prisma.landingPageSnapshot.create({
    data: {
      workspaceId: input.workspaceId || "default-workspace",
      productId: input.productId ?? null,
      storeId: input.storeId ?? null,
      adId: input.adId ?? null,
      originalUrl: input.originalUrl,
      finalUrl: input.finalUrl ?? null,
      httpStatus: input.httpStatus,
      accessStatus: input.accessStatus,
      pageTitle: input.pageTitle ?? null,
      metaDescription: input.metaDescription ?? null,
      contentHash,
      observationsJson: JSON.stringify(input.structure),
      croSignalsJson: JSON.stringify(input.croSignals),
      messageMatchJson: input.messageMatch ? JSON.stringify(input.messageMatch) : null,
      warningsJson: input.warnings ? JSON.stringify(input.warnings) : null,
      analysisVersion: "11.4.0",
      observedAt: new Date(),
    },
  });
}

/**
 * Compares two historical landing page snapshots to detect meaningful marketing iterations.
 */
export function compareLandingPageSnapshots(
  older: {
    observedAt: Date | string;
    pageTitle: string | null;
    observationsJson: string;
    croSignalsJson: string;
  },
  newer: {
    observedAt: Date | string;
    pageTitle: string | null;
    observationsJson: string;
    croSignalsJson: string;
  }
): LandingPageChangeReport {
  const changes: LandingPageChangeReport["detectedChanges"] = [];

  try {
    const olderStructure: LandingPageStructure = JSON.parse(older.observationsJson);
    const newerStructure: LandingPageStructure = JSON.parse(newer.observationsJson);

    // 1. Headline change
    if (olderStructure.heroHeadline !== newerStructure.heroHeadline) {
      changes.push({
        field: "Hero Headline",
        olderValue: olderStructure.heroHeadline,
        newerValue: newerStructure.heroHeadline,
        significance: "HIGH",
      });
    }

    // 2. Primary CTA change
    if (olderStructure.primaryCtaText !== newerStructure.primaryCtaText) {
      changes.push({
        field: "Primary CTA",
        olderValue: olderStructure.primaryCtaText,
        newerValue: newerStructure.primaryCtaText,
        significance: "MEDIUM",
      });
    }

    // 3. Page Title
    if (older.pageTitle !== newer.pageTitle) {
      changes.push({
        field: "Meta Title",
        olderValue: older.pageTitle,
        newerValue: newer.pageTitle,
        significance: "LOW",
      });
    }

    // 4. Social proof / reviews appearance or removal
    if (olderStructure.hasCustomerReviews !== newerStructure.hasCustomerReviews) {
      changes.push({
        field: "Customer Reviews Section",
        olderValue: olderStructure.hasCustomerReviews ? "Present" : "Absent",
        newerValue: newerStructure.hasCustomerReviews ? "Present" : "Absent",
        significance: "HIGH",
      });
    }

    // 5. Shipping summary appearance or change
    if (olderStructure.hasShippingPolicySummary !== newerStructure.hasShippingPolicySummary) {
      changes.push({
        field: "Shipping Policy Summary",
        olderValue: olderStructure.hasShippingPolicySummary ? "Present" : "Absent",
        newerValue: newerStructure.hasShippingPolicySummary ? "Present" : "Absent",
        significance: "MEDIUM",
      });
    }
  } catch {
    // Malformed JSON payload
  }

  const hasChanges = changes.length > 0;
  const summary = hasChanges
    ? `Detected ${changes.length} meaningful commercial changes between ${new Date(older.observedAt).toLocaleDateString()} and ${new Date(newer.observedAt).toLocaleDateString()}.`
    : `No meaningful landing page copy or layout changes detected between observations.`;

  return {
    hasChanges,
    olderObservedAt: new Date(older.observedAt).toISOString(),
    newerObservedAt: new Date(newer.observedAt).toISOString(),
    detectedChanges: changes,
    summary,
  };
}
