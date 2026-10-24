/**
 * SWAI Landing Page Inspection & Research Job Execution Service
 *
 * KH-01.C — Landing Page & Competitor Funnel Analyzer
 *
 * Execution Order:
 * 1. Validate public research URL (SSRF & protocol safety).
 * 2. Enforce workspace access permissions.
 * 3. Atomic job claim and status management.
 * 4. Bounded HTTP fetch (hop-by-hop redirects, 8s timeout, 2MB cap).
 * 5. Handle access-restricted sources honestly without faking results.
 * 6. Parse HTML and extract JSON-LD, visible prices, headings, CTAs.
 * 7. Extract and normalize commercial offers.
 * 8. Analyze CRO architecture and ad message match.
 * 9. Persist versioned LandingPageSnapshot and CompetitorOfferSnapshot.
 * 10. Record traceable ResearchEvidence entries.
 */

import { prisma } from "@/lib/db";
import {
  ResearchAccessContext,
  assertAdWorkspaceAccess,
  assertProductWorkspaceAccess,
} from "./researchAuthService";
import {
  validatePublicResearchUrl,
  fetchPublicResearchPage,
  ValidatedResearchUrl,
} from "@/services/links/linkValidationService";
import {
  ParsedPublicLandingPage,
  extractStructuredProductOffer,
  extractPromotionalOffer,
  normalizeCompetitorOffer,
  persistCompetitorOfferSnapshot,
  NormalizedCompetitorOffer,
} from "./offerExtractionService";
import {
  analyzeCompetitorFunnel,
  CompetitorFunnelAssessment,
} from "./funnelAnalysisService";
import { saveLandingPageSnapshot } from "./landingPageSnapshotService";
import { createResearchEvidence } from "./evidenceService";
import { getAdvertisementDetails } from "@/services/ads/adService";

export interface CreateLandingPageResearchInput {
  productId?: string | null;
  adId?: string | null;
  targetUrl: string;
  forceRefresh?: boolean;
}

export interface ResearchJobReceipt {
  jobId: string;
  productId?: string | null;
  adId?: string | null;
  targetUrl: string;
  status: "QUEUED" | "CACHED_FRESH" | "COMPLETED";
  cachedSnapshotId?: string;
  createdAt: string;
}

export interface LandingPageResearchResult {
  jobId: string;
  status: "COMPLETED" | "ACCESS_RESTRICTED" | "RATE_LIMITED" | "FAILED";
  originalUrl: string;
  finalUrl: string | null;
  httpStatus: number;
  snapshotId: string | null;
  offerSnapshotId: string | null;
  offer: NormalizedCompetitorOffer | null;
  funnel: CompetitorFunnelAssessment | null;
  warnings: string[];
  durationMs: number;
}

/**
 * Safely parses public landing page HTML without script execution.
 */
export function parsePublicLandingPage(
  html: string,
  pageUrl: string
): ParsedPublicLandingPage {
  let pageTitle: string | null = null;
  let metaDescription: string | null = null;
  const jsonLdObjects: any[] = [];
  const visiblePrices: ParsedPublicLandingPage["visiblePrices"] = [];
  const visibleHeadings: string[] = [];
  const ctaButtons: string[] = [];
  const shippingStatements: string[] = [];
  const guaranteeStatements: string[] = [];

  // 1. Title extraction
  const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
  if (titleMatch) {
    pageTitle = titleMatch[1].trim();
  }

  // 2. Meta description extraction
  const descMatch =
    html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i) ||
    html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+name=["']description["']/i);
  if (descMatch) {
    metaDescription = descMatch[1].trim();
  }

  // 3. JSON-LD scripts extraction
  const scriptRegex = /<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let scriptMatch: RegExpExecArray | null;
  while ((scriptMatch = scriptRegex.exec(html)) !== null) {
    const rawJson = scriptMatch[1].trim();
    if (rawJson) {
      try {
        const parsed = JSON.parse(rawJson);
        if (Array.isArray(parsed)) {
          jsonLdObjects.push(...parsed);
        } else {
          jsonLdObjects.push(parsed);
        }
      } catch {
        // Ignore unparseable JSON-LD
      }
    }
  }

  // 4. Visible price patterns in DOM (e.g. $29.99, €24.90, £19.95)
  const priceRegex = /([$€£])\s*(\d{1,4}(?:\.\d{2})?)/g;
  let pMatch: RegExpExecArray | null;
  const seenAmounts = new Set<number>();

  while ((pMatch = priceRegex.exec(html)) !== null) {
    const symbol = pMatch[1];
    const amount = parseFloat(pMatch[2]);
    if (!isNaN(amount) && amount > 0 && amount < 10000 && !seenAmounts.has(amount)) {
      seenAmounts.add(amount);

      let currency = "USD";
      if (symbol === "€") currency = "EUR";
      else if (symbol === "£") currency = "GBP";

      // Context snippet around the price
      const idx = pMatch.index;
      const snippet = html.slice(Math.max(0, idx - 80), Math.min(html.length, idx + 80)).toLowerCase();
      const isCompareAt =
        snippet.includes("compare") ||
        snippet.includes("original") ||
        snippet.includes("strike") ||
        snippet.includes("was-price") ||
        snippet.includes("<del") ||
        snippet.includes("<s");

      visiblePrices.push({
        amount,
        currency,
        rawText: pMatch[0],
        type: isCompareAt ? "COMPARE_AT" : "REGULAR",
      });
    }
  }

  // 5. Headings extraction (h1, h2, h3, h4)
  const headingRegex = /<h[1-4][^>]*>([\s\S]*?)<\/h[1-4]>/gi;
  let hMatch: RegExpExecArray | null;
  while ((hMatch = headingRegex.exec(html)) !== null) {
    const text = hMatch[1].replace(/<[^>]+>/g, "").trim();
    if (text && text.length > 2 && text.length < 200 && !visibleHeadings.includes(text)) {
      visibleHeadings.push(text);
    }
  }

  // 6. CTA button text extraction
  const ctaRegex = /<(?:button|a)\b[^>]*class=["'][^"']*(?:btn|cta|button|checkout|add-to-cart)[^"']*["'][^>]*>([\s\S]*?)<\/(?:button|a)>/gi;
  let ctaMatch: RegExpExecArray | null;
  while ((ctaMatch = ctaRegex.exec(html)) !== null) {
    const text = ctaMatch[1].replace(/<[^>]+>/g, "").trim();
    if (text && text.length > 2 && text.length < 80 && !ctaButtons.includes(text)) {
      ctaButtons.push(text);
    }
  }

  // 7. Shipping and Guarantee statements
  const textCorpus = html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
  const sentences = textCorpus.split(/[.!?\n]/).map((s) => s.trim());

  for (const sentence of sentences) {
    const lower = sentence.toLowerCase();
    if (
      lower.includes("free shipping") ||
      lower.includes("standard shipping") ||
      lower.includes("shipping worldwide") ||
      lower.includes("delivery in")
    ) {
      if (sentence.length > 5 && sentence.length < 150 && !shippingStatements.includes(sentence)) {
        shippingStatements.push(sentence);
      }
    }
    if (
      lower.includes("money-back guarantee") ||
      lower.includes("money back guarantee") ||
      lower.includes("satisfaction guarantee") ||
      lower.includes("year warranty") ||
      lower.includes("lifetime warranty")
    ) {
      if (sentence.length > 5 && sentence.length < 150 && !guaranteeStatements.includes(sentence)) {
        guaranteeStatements.push(sentence);
      }
    }
  }

  return {
    originalUrl: pageUrl,
    finalUrl: pageUrl,
    pageTitle,
    metaDescription,
    html,
    jsonLdObjects,
    visiblePrices,
    visibleHeadings,
    ctaButtons,
    shippingStatements,
    guaranteeStatements,
  };
}

/**
 * Creates or claims a research job for a landing page inspection.
 */
export async function createLandingPageResearchJob(
  input: CreateLandingPageResearchInput,
  context: ResearchAccessContext
): Promise<ResearchJobReceipt> {
  const validatedUrl = validatePublicResearchUrl(input.targetUrl);

  if (input.productId) {
    await assertProductWorkspaceAccess(input.productId, context);
  }
  if (input.adId) {
    await assertAdWorkspaceAccess(input.adId, context);
  }

  // Freshness check: If snapshot from last 24h exists, reuse unless forceRefresh is true
  if (!input.forceRefresh && input.productId) {
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const recentSnapshot = await prisma.landingPageSnapshot.findFirst({
      where: {
        productId: input.productId,
        observedAt: { gte: oneDayAgo },
        accessStatus: "SUCCESS",
      },
      orderBy: { observedAt: "desc" },
    });

    if (recentSnapshot) {
      return {
        jobId: `cached_${recentSnapshot.id}`,
        productId: input.productId,
        adId: input.adId || null,
        targetUrl: validatedUrl.normalizedUrl,
        status: "CACHED_FRESH",
        cachedSnapshotId: recentSnapshot.id,
        createdAt: recentSnapshot.observedAt.toISOString(),
      };
    }
  }

  // Create persisted SyncJob
  const syncJob = await prisma.syncJob.create({
    data: {
      workspaceId: context.workspaceId,
      jobType: "KH01_LANDING_PAGE_RESEARCH",
      status: "PENDING",
      progress: 0,
      totalItems: 1,
      resultJson: JSON.stringify({
        productId: input.productId || null,
        adId: input.adId || null,
        targetUrl: validatedUrl.normalizedUrl,
      }),
      startedAt: new Date(),
    },
  });

  return {
    jobId: syncJob.id,
    productId: input.productId || null,
    adId: input.adId || null,
    targetUrl: validatedUrl.normalizedUrl,
    status: "QUEUED",
    createdAt: syncJob.createdAt.toISOString(),
  };
}

export interface ClaimedKh01Job {
  id: string;
  workspaceId: string;
  jobType: string;
  status: string;
  workerId: string;
  claimToken: string;
  attemptNumber: number;
  payload?: {
    productId?: string | null;
    adId?: string | null;
    targetUrl: string;
    forceRefresh?: boolean;
  };
}

/**
 * Executes a claimed landing page research job with complete error boundaries.
 */
export async function executeLandingPageResearchJob(
  jobOrClaim: string | ClaimedKh01Job,
  signal?: AbortSignal
): Promise<LandingPageResearchResult> {
  const startTime = Date.now();
  const jobId = typeof jobOrClaim === "string" ? jobOrClaim : jobOrClaim.id;

  const syncJob = await prisma.syncJob.findUnique({
    where: { id: jobId },
  });

  if (!syncJob) {
    throw new Error(`Research job '${jobId}' not found.`);
  }

  let jobConfig: {
    productId?: string | null;
    adId?: string | null;
    targetUrl: string;
    workerId?: string;
    claimToken?: string;
    attemptNumber?: number;
    leaseExpiresAt?: string;
  };
  try {
    jobConfig = JSON.parse(syncJob.resultJson || "{}");
  } catch {
    throw new Error(`Corrupted job payload for job '${jobId}'.`);
  }

  // Enforce valid claim and active lease
  if (
    !jobOrClaim ||
    typeof jobOrClaim !== "object" ||
    !("claimToken" in jobOrClaim) ||
    !jobOrClaim.claimToken ||
    !jobOrClaim.workerId
  ) {
    throw new Error(
      `Job '${jobId}' cannot be executed directly: status must be claimed and RUNNING. Use a worker to claim pending jobs.`
    );
  }

  const claim = jobOrClaim as ClaimedKh01Job;
  if (syncJob.status !== "RUNNING") {
    throw new Error(`Job '${jobId}' is not running (status: ${syncJob.status}).`);
  }

  if (
    jobConfig.workerId !== claim.workerId ||
    jobConfig.claimToken !== claim.claimToken
  ) {
    throw new Error(
      `Claim mismatch: Worker '${claim.workerId}' does not own active lease on job '${jobId}'.`
    );
  }

  if (
    jobConfig.leaseExpiresAt &&
    new Date(jobConfig.leaseExpiresAt).getTime() < Date.now()
  ) {
    throw new Error(`Lease expired for job '${jobId}'.`);
  }

  // Update progress atomically under active claim
  await prisma.syncJob.update({
    where: { id: jobId, status: "RUNNING" },
    data: { progress: 20 },
  });

  const targetUrl =
    (typeof jobOrClaim === "object" && jobOrClaim.payload?.targetUrl) || jobConfig.targetUrl;

  if (!targetUrl || typeof targetUrl !== "string") {
    throw new Error(`Target URL missing in job '${jobId}' payload.`);
  }

  const validatedUrl = validatePublicResearchUrl(targetUrl);

  // 1. Bounded HTTP fetch
  const fetchResult = await fetchPublicResearchPage(validatedUrl, {
    timeoutMs: 8000,
    maxRedirects: 3,
    maxResponseBytes: 2 * 1024 * 1024, // 2MB
    signal,
  });

  // 2. Handle restricted / blocked access honestly
  if (fetchResult.statusClassification === "ACCESS_RESTRICTED") {
    const blockedSnapshot = await prisma.landingPageSnapshot.create({
      data: {
        workspaceId: syncJob.workspaceId,
        productId: jobConfig.productId ?? null,
        adId: jobConfig.adId ?? null,
        originalUrl: validatedUrl.originalUrl,
        finalUrl: fetchResult.finalUrl,
        httpStatus: fetchResult.httpStatus,
        accessStatus: "ACCESS_RESTRICTED",
        contentHash: "blocked_access",
        observationsJson: JSON.stringify({ note: "Access restricted by competitor website." }),
        croSignalsJson: JSON.stringify({ note: "Unable to inspect DOM: HTTP 401/403 access restricted." }),
        warningsJson: JSON.stringify([fetchResult.errorMessage || "Access restricted by destination."]),
        analysisVersion: "11.4.1",
        observedAt: new Date(),
      },
    });

    await prisma.syncJob.update({
      where: { id: jobId, status: "RUNNING" },
      data: {
        status: "COMPLETED",
        progress: 100,
        completedAt: new Date(),
        errorMessage: fetchResult.errorMessage,
        resultJson: JSON.stringify({
          ...jobConfig,
          snapshotId: blockedSnapshot.id,
          accessStatus: "ACCESS_RESTRICTED",
        }),
      },
    });

    return {
      jobId,
      status: "ACCESS_RESTRICTED",
      originalUrl: validatedUrl.originalUrl,
      finalUrl: fetchResult.finalUrl,
      httpStatus: fetchResult.httpStatus,
      snapshotId: blockedSnapshot.id,
      offerSnapshotId: null,
      offer: null,
      funnel: null,
      warnings: [fetchResult.errorMessage || "Competitor storefront restricted bot/crawler access."],
      durationMs: Date.now() - startTime,
    };
  }

  if (fetchResult.statusClassification === "RATE_LIMITED") {
    await prisma.syncJob.update({
      where: { id: jobId },
      data: { status: "FAILED", progress: 100, errorMessage: "HTTP 429 Rate limited." },
    });
    return {
      jobId,
      status: "RATE_LIMITED",
      originalUrl: validatedUrl.originalUrl,
      finalUrl: fetchResult.finalUrl,
      httpStatus: 429,
      snapshotId: null,
      offerSnapshotId: null,
      offer: null,
      funnel: null,
      warnings: ["Rate limit encountered while attempting to inspect landing page."],
      durationMs: Date.now() - startTime,
    };
  }

  if (!fetchResult.content) {
    await prisma.syncJob.update({
      where: { id: jobId },
      data: {
        status: "FAILED",
        progress: 100,
        errorMessage: fetchResult.errorMessage || "No readable content returned from landing page.",
      },
    });
    return {
      jobId,
      status: "FAILED",
      originalUrl: validatedUrl.originalUrl,
      finalUrl: fetchResult.finalUrl,
      httpStatus: fetchResult.httpStatus,
      snapshotId: null,
      offerSnapshotId: null,
      offer: null,
      funnel: null,
      warnings: [fetchResult.errorMessage || "Empty response body."],
      durationMs: Date.now() - startTime,
    };
  }

  // 3. Safe Parsing
  const parsedPage = parsePublicLandingPage(fetchResult.content, fetchResult.finalUrl);
  parsedPage.originalUrl = validatedUrl.originalUrl;

  // 4. Offer extraction & normalization
  const structuredOffers = extractStructuredProductOffer(parsedPage);
  const promotions = extractPromotionalOffer(parsedPage);
  const normalizedOffer = normalizeCompetitorOffer(structuredOffers, promotions, {
    productId: jobConfig.productId,
    adId: jobConfig.adId,
    sourceUrl: validatedUrl.originalUrl,
    finalUrl: fetchResult.finalUrl,
  });

  // 5. Ad message match & CRO analysis
  let adDetails: any = null;
  if (jobConfig.adId) {
    adDetails = await getAdvertisementDetails(jobConfig.adId);
  }
  const funnelAssessment = analyzeCompetitorFunnel({
    page: parsedPage,
    offer: normalizedOffer,
    ad: adDetails,
  });

  // 6. Persistence of snapshots
  const context: ResearchAccessContext = {
    workspaceId: syncJob.workspaceId,
    actorId: "kh01_worker",
    accessMode: "AUTHENTICATED",
  };

  const offerSnapshot = await persistCompetitorOfferSnapshot(normalizedOffer, context);

  const landingSnapshot = await saveLandingPageSnapshot({
    workspaceId: syncJob.workspaceId,
    productId: jobConfig.productId,
    adId: jobConfig.adId,
    originalUrl: validatedUrl.originalUrl,
    finalUrl: fetchResult.finalUrl,
    httpStatus: fetchResult.httpStatus,
    accessStatus: "SUCCESS",
    pageTitle: parsedPage.pageTitle,
    metaDescription: parsedPage.metaDescription,
    htmlContent: fetchResult.content,
    structure: funnelAssessment.structure,
    croSignals: funnelAssessment,
    messageMatch: funnelAssessment.messageMatch,
    warnings: normalizedOffer.warnings,
  });

  // 7. Provenance: Create evidence entries
  if (jobConfig.productId) {
    // Record offer price evidence
    if (normalizedOffer.sellingPrice !== null) {
      await createResearchEvidence(
        {
          productId: jobConfig.productId,
          subjectType: "OFFER",
          subjectId: offerSnapshot.id,
          pillar: "OFFER",
          claim: "Observed competitor selling price on landing page",
          observedValue: `$${normalizedOffer.sellingPrice} ${normalizedOffer.currency}`,
          sourceUrl: fetchResult.finalUrl,
          observationMethod: "STOREFRONT_HTTP",
          classification: "SOURCE_OBSERVED",
          sourceContentRef: `snapshot:${landingSnapshot.id}`,
        },
        context
      );
    }

    // Record landing page hero CTA evidence
    if (funnelAssessment.structure.primaryCtaText) {
      await createResearchEvidence(
        {
          productId: jobConfig.productId,
          subjectType: "FUNNEL",
          subjectId: landingSnapshot.id,
          pillar: "LANDING_PAGE",
          claim: "Observed primary Call-to-Action button",
          observedValue: funnelAssessment.structure.primaryCtaText,
          sourceUrl: fetchResult.finalUrl,
          observationMethod: "DOM_INSPECTION",
          classification: "SOURCE_OBSERVED",
          sourceContentRef: `snapshot:${landingSnapshot.id}`,
        },
        context
      );
    }
  }

  // 8. Reconcile job status atomically under active claim
  await prisma.syncJob.update({
    where: { id: jobId, status: "RUNNING" },
    data: {
      status: "COMPLETED",
      progress: 100,
      completedAt: new Date(),
      resultJson: JSON.stringify({
        ...jobConfig,
        snapshotId: landingSnapshot.id,
        offerSnapshotId: offerSnapshot.id,
        sellingPrice: normalizedOffer.sellingPrice,
        croReadiness: funnelAssessment.croReadiness,
      }),
    },
  });

  return {
    jobId,
    status: "COMPLETED",
    originalUrl: validatedUrl.originalUrl,
    finalUrl: fetchResult.finalUrl,
    httpStatus: fetchResult.httpStatus,
    snapshotId: landingSnapshot.id,
    offerSnapshotId: offerSnapshot.id,
    offer: normalizedOffer,
    funnel: funnelAssessment,
    warnings: normalizedOffer.warnings,
    durationMs: Date.now() - startTime,
  };
}
