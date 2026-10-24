/**
 * SWAI Competitor Landing Page Funnel & CRO Analysis Service
 *
 * KH-01.C — Landing Page & Competitor Funnel Analyzer
 *
 * Principles:
 * - Analyze only observable public page elements.
 * - croReadiness is an analytical heuristic (0-100), NOT actual competitor conversion rate.
 * - Testimonial existence is noted as an element, not certified as authentic customer praise.
 * - Ad vs Landing Page message match traces promises (e.g. Free Shipping in ad vs $50 threshold on page).
 */

import { ParsedPublicLandingPage } from "./offerExtractionService";
import { NormalizedCompetitorOffer } from "./offerExtractionService";
import { AdDetailViewModel } from "@/types/adViewModel";

export interface LandingPageStructure {
  pageUrl: string;
  hasProductHero: boolean;
  heroHeadline: string | null;
  productImagesCount: number;
  hasVisiblePriceNearCta: boolean;
  primaryCtaText: string | null;
  hasBenefitList: boolean;
  hasDemonstrationOrVideo: boolean;
  hasCustomerReviews: boolean;
  observedReviewCountText: string | null;
  observedRatingScoreText: string | null;
  hasFaqSection: boolean;
  hasShippingPolicySummary: boolean;
  hasReturnPolicySummary: boolean;
  hasTrustBadges: boolean;
  hasPaymentIcons: boolean;
  missingObservableComponents: string[];
}

export interface EvidenceBackedFinding {
  pillar: "LANDING_PAGE" | "OFFER" | "CREATIVE";
  category: "STRENGTH" | "WEAKNESS" | "FRICTION";
  finding: string;
  observedEvidence: string;
  severity: "HIGH" | "MEDIUM" | "LOW";
}

export interface TrustSignalAssessment {
  score: number; // 0 - 100
  observedSignals: string[];
  missingSignals: string[];
  disclaimer: string;
}

export interface MessageMatchAssessment {
  overallMatchScore: number; // 0 - 100
  matchedClaims: { adClaim: string; pageEvidence: string }[];
  conflictingClaims: { adClaim: string; pageEvidence: string; reason: string }[];
  missingOnLandingPage: string[];
  unverifiedClaims: string[];
}

export interface CompetitorFunnelAssessment {
  observedStrengths: EvidenceBackedFinding[];
  observedWeaknesses: EvidenceBackedFinding[];
  potentialFriction: EvidenceBackedFinding[];
  missingEvidence: string[];
  confidence: number | null;
  croReadiness: number | null; // Heuristic CRO readiness score, NOT actual CR
  structure: LandingPageStructure;
  trustSignals: TrustSignalAssessment;
  messageMatch: MessageMatchAssessment;
  analysisVersion: string;
  disclaimer: string;
}

/**
 * Extracts high-level page structure from parsed public page.
 */
export function extractPageStructure(page: ParsedPublicLandingPage): LandingPageStructure {
  const missing: string[] = [];
  const lowerHtml = (page.html || "").toLowerCase();
  const textCorpus = [
    page.pageTitle || "",
    ...page.visibleHeadings,
    ...page.ctaButtons,
    ...page.shippingStatements,
    ...page.guaranteeStatements,
    lowerHtml,
  ].join(" \n ").toLowerCase();

  const heroHeadline = page.visibleHeadings[0] || page.pageTitle || null;
  const hasProductHero = Boolean(heroHeadline);
  if (!hasProductHero) missing.push("Product Hero Headline");

  // Primary CTA
  const primaryCta =
    page.ctaButtons.find((b) => /add to cart|buy now|shop now|order now|get yours/i.test(b)) ||
    page.ctaButtons[0] ||
    null;
  if (!primaryCta) missing.push("Prominent Primary Call-to-Action button");

  // Pricing near CTA
  const hasPrice = page.visiblePrices.length > 0;
  if (!hasPrice) missing.push("Clear Visible Price");

  // Customer Reviews
  const hasReviews =
    textCorpus.includes("reviews") ||
    textCorpus.includes("customer review") ||
    textCorpus.includes("star rating") ||
    /\b\d+(\.\d)?\s*stars\b/i.test(textCorpus);
  if (!hasReviews) missing.push("Customer Reviews / Social Proof section");

  // FAQ
  const hasFaq =
    textCorpus.includes("frequently asked") ||
    textCorpus.includes("faq") ||
    textCorpus.includes("questions & answers");
  if (!hasFaq) missing.push("FAQ / Objection Handling section");

  // Shipping
  const hasShipping =
    page.shippingStatements.length > 0 ||
    textCorpus.includes("shipping policy") ||
    textCorpus.includes("free shipping") ||
    textCorpus.includes("delivery time");
  if (!hasShipping) missing.push("Explicit Shipping timeline or policy");

  // Returns / Guarantee
  const hasReturns =
    page.guaranteeStatements.length > 0 ||
    textCorpus.includes("return policy") ||
    textCorpus.includes("money back guarantee") ||
    textCorpus.includes("refund policy");
  if (!hasReturns) missing.push("Return / Refund policy statement");

  // Trust Badges & Payments
  const hasTrust =
    textCorpus.includes("secure checkout") ||
    textCorpus.includes("ssl encrypted") ||
    textCorpus.includes("guaranteed safe checkout");
  const hasPayments =
    textCorpus.includes("visa") ||
    textCorpus.includes("mastercard") ||
    textCorpus.includes("paypal") ||
    textCorpus.includes("apple pay");

  // Product demonstration cues
  const hasDemo =
    textCorpus.includes("how it works") ||
    textCorpus.includes("how to use") ||
    textCorpus.includes("step 1") ||
    textCorpus.includes("before") && textCorpus.includes("after");

  // Image count heuristic from HTML
  const imgMatches = page.html.match(/<img\b[^>]+>/gi) || [];

  return {
    pageUrl: page.finalUrl || page.originalUrl,
    hasProductHero,
    heroHeadline,
    productImagesCount: imgMatches.length,
    hasVisiblePriceNearCta: hasPrice,
    primaryCtaText: primaryCta,
    hasBenefitList: page.visibleHeadings.length > 2,
    hasDemonstrationOrVideo: hasDemo,
    hasCustomerReviews: hasReviews,
    observedReviewCountText: hasReviews ? "Observed reviews section in DOM" : null,
    observedRatingScoreText: null,
    hasFaqSection: hasFaq,
    hasShippingPolicySummary: hasShipping,
    hasReturnPolicySummary: hasReturns,
    hasTrustBadges: hasTrust,
    hasPaymentIcons: hasPayments,
    missingObservableComponents: missing,
  };
}

/**
 * Evaluates observed storefront trust signals.
 */
export function inspectTrustSignals(page: ParsedPublicLandingPage): TrustSignalAssessment {
  const observed: string[] = [];
  const missing: string[] = [];
  const lowerHtml = page.html.toLowerCase();

  if (page.guaranteeStatements.length > 0) {
    observed.push(`Observed guarantee: ${page.guaranteeStatements[0]}`);
  } else {
    missing.push("No explicit money-back guarantee observed");
  }

  if (page.shippingStatements.length > 0) {
    observed.push(`Observed shipping policy: ${page.shippingStatements[0]}`);
  } else {
    missing.push("No explicit shipping statement observed");
  }

  if (lowerHtml.includes("contact us") || lowerHtml.includes("support@")) {
    observed.push("Customer support contact details present");
  } else {
    missing.push("No direct customer support contact observed");
  }

  if (lowerHtml.includes("terms of service") || lowerHtml.includes("privacy policy")) {
    observed.push("Legal policies (Privacy / Terms) accessible in footer");
  } else {
    missing.push("Missing Privacy Policy or Terms of Service links");
  }

  const score = Math.round((observed.length / (observed.length + missing.length || 1)) * 100);

  return {
    score,
    observedSignals: observed,
    missingSignals: missing,
    disclaimer: "Trust signal evaluation reflects observable elements in HTML. It does not certify the authenticity of merchant claims or customer reviews.",
  };
}

/**
 * Compares ad creative copy and promises with observed landing page contents.
 */
export function inspectMessageMatch(
  ad: AdDetailViewModel | { headline?: string | null; bodyText?: string | null; callToAction?: string | null },
  page: ParsedPublicLandingPage
): MessageMatchAssessment {
  const matchedClaims: MessageMatchAssessment["matchedClaims"] = [];
  const conflictingClaims: MessageMatchAssessment["conflictingClaims"] = [];
  const missingOnLandingPage: string[] = [];
  const unverifiedClaims: string[] = [];

  const adText = [ad.headline || "", ad.bodyText || ""].join(" ").toLowerCase();
  const pageText = [page.pageTitle || "", page.metaDescription || "", ...page.visibleHeadings].join(" ").toLowerCase();

  // 1. Free Shipping Claim Check
  if (adText.includes("free shipping")) {
    if (pageText.includes("free shipping") || page.shippingStatements.some((s) => s.toLowerCase().includes("free shipping"))) {
      // Check if conditional threshold applies on landing page
      const thresholdMatch = page.shippingStatements.join(" ").match(/free\s+shipping.*over\s*[$€£]?(\d+)/i);
      if (thresholdMatch) {
        conflictingClaims.push({
          adClaim: "Ad states 'Free shipping' without explicit condition",
          pageEvidence: `Landing page specifies threshold: '${thresholdMatch[0]}'`,
          reason: "CONDITIONAL_MISMATCH: The landing page requires an order threshold not disclosed in the ad text.",
        });
      } else {
        matchedClaims.push({
          adClaim: "Free shipping promise",
          pageEvidence: "Landing page prominently offers free shipping",
        });
      }
    } else {
      missingOnLandingPage.push("Ad claims 'Free Shipping', but no free shipping terms were observed on landing page.");
    }
  }

  // 2. Discount Claim Check (e.g. 50% Off)
  const adDiscount = adText.match(/(\d{1,2})%\s*off/i);
  if (adDiscount) {
    const claim = adDiscount[0];
    if (pageText.includes(claim.toLowerCase())) {
      matchedClaims.push({
        adClaim: `Ad discount claim '${claim}'`,
        pageEvidence: `Landing page headline/body reinforces '${claim}'`,
      });
    } else {
      missingOnLandingPage.push(`Ad promises '${claim}', but discount is not explicitly matched on the primary landing page headings.`);
    }
  }

  // 3. CTA Alignment
  if (ad.callToAction) {
    const ctaLower = ad.callToAction.toLowerCase();
    const matchesPageCta = page.ctaButtons.some((b) => b.toLowerCase().includes(ctaLower));
    if (matchesPageCta) {
      matchedClaims.push({
        adClaim: `Call to Action '${ad.callToAction}'`,
        pageEvidence: "Directly matches button text on product hero",
      });
    } else {
      unverifiedClaims.push(`Ad CTA is '${ad.callToAction}', while landing page primary button uses different wording.`);
    }
  }

  let overallMatchScore = 70;
  if (conflictingClaims.length > 0) overallMatchScore -= conflictingClaims.length * 25;
  if (missingOnLandingPage.length > 0) overallMatchScore -= missingOnLandingPage.length * 15;
  if (matchedClaims.length > 0) overallMatchScore += matchedClaims.length * 10;
  overallMatchScore = Math.max(0, Math.min(100, overallMatchScore));

  return {
    overallMatchScore,
    matchedClaims,
    conflictingClaims,
    missingOnLandingPage,
    unverifiedClaims,
  };
}

/**
 * Synthesizes complete CRO and Funnel assessment for the competitor landing page.
 */
export function analyzeCompetitorFunnel(input: {
  page: ParsedPublicLandingPage;
  offer: NormalizedCompetitorOffer;
  ad?: AdDetailViewModel | { headline?: string | null; bodyText?: string | null; callToAction?: string | null };
}): CompetitorFunnelAssessment {
  const structure = extractPageStructure(input.page);
  const trustSignals = inspectTrustSignals(input.page);
  const messageMatch = input.ad
    ? inspectMessageMatch(input.ad, input.page)
    : {
        overallMatchScore: 50,
        matchedClaims: [],
        conflictingClaims: [],
        missingOnLandingPage: [],
        unverifiedClaims: ["No linked advertisement provided for ad-to-page message match analysis."],
      };

  const strengths: EvidenceBackedFinding[] = [];
  const weaknesses: EvidenceBackedFinding[] = [];
  const friction: EvidenceBackedFinding[] = [];
  const missingEvidence: string[] = [...structure.missingObservableComponents];

  // Evaluate strengths
  if (structure.hasProductHero && structure.primaryCtaText) {
    strengths.push({
      pillar: "LANDING_PAGE",
      category: "STRENGTH",
      finding: "Clear above-the-fold product hero and primary CTA",
      observedEvidence: `Hero headline: '${structure.heroHeadline}' with CTA button: '${structure.primaryCtaText}'`,
      severity: "HIGH",
    });
  }

  if (structure.hasCustomerReviews) {
    strengths.push({
      pillar: "LANDING_PAGE",
      category: "STRENGTH",
      finding: "Social proof section present",
      observedEvidence: "Customer ratings or review elements observed in DOM.",
      severity: "MEDIUM",
    });
  }

  if (input.offer.hasFreeShipping) {
    strengths.push({
      pillar: "OFFER",
      category: "STRENGTH",
      finding: "Free shipping incentive presented",
      observedEvidence: input.offer.freeShippingThreshold
        ? `Free shipping on orders over $${input.offer.freeShippingThreshold}`
        : "Free shipping advertised on all orders",
      severity: "MEDIUM",
    });
  }

  // Evaluate friction & weaknesses
  if (messageMatch.conflictingClaims.length > 0) {
    friction.push({
      pillar: "LANDING_PAGE",
      category: "FRICTION",
      finding: "Ad-to-landing-page conditional discrepancy",
      observedEvidence: messageMatch.conflictingClaims.map((c) => c.reason).join("; "),
      severity: "HIGH",
    });
  }

  if (!structure.hasVisiblePriceNearCta) {
    weaknesses.push({
      pillar: "LANDING_PAGE",
      category: "WEAKNESS",
      finding: "Pricing is obscure or not visible near primary CTA",
      observedEvidence: "No clear regular price found adjacent to call-to-action button.",
      severity: "MEDIUM",
    });
  }

  if (!structure.hasReturnPolicySummary) {
    weaknesses.push({
      pillar: "LANDING_PAGE",
      category: "WEAKNESS",
      finding: "Missing clear return or guarantee policy",
      observedEvidence: "No return/refund or money-back guarantee observed on page.",
      severity: "MEDIUM",
    });
  }

  // Calculate analytical CRO readiness score (heuristic 0-100)
  let baseScore = 50;
  if (structure.hasProductHero) baseScore += 10;
  if (structure.primaryCtaText) baseScore += 10;
  if (structure.hasVisiblePriceNearCta) baseScore += 10;
  if (structure.hasCustomerReviews) baseScore += 10;
  if (structure.hasShippingPolicySummary) baseScore += 5;
  if (structure.hasReturnPolicySummary) baseScore += 5;
  if (messageMatch.conflictingClaims.length > 0) baseScore -= 15;
  if (structure.missingObservableComponents.length >= 3) baseScore -= 15;

  const croReadiness = Math.max(10, Math.min(95, baseScore));

  return {
    observedStrengths: strengths,
    observedWeaknesses: weaknesses,
    potentialFriction: friction,
    missingEvidence,
    confidence: structure.hasProductHero ? 80 : 40,
    croReadiness,
    structure,
    trustSignals,
    messageMatch,
    analysisVersion: "11.4.0",
    disclaimer:
      "croReadiness is an analytical heuristic measuring observable conversion architecture. It is NOT the competitor's measured conversion rate or a sales forecast.",
  };
}
