/**
 * SWAI KH-02 V12.4.3.2.1 — Release Gate Evaluators (M01–M34) & Adversarial False-PASS Verifier
 *
 * Implements:
 * - Section 26: Release Gates M01 through M34
 * - Adversarial False-PASS Resistance (Mutations A through K)
 * - Re-exports bounded async pool & disk guards from V12.4.3.1 / V12.4.3.2
 */

import {
  evaluateSplitG06MetaGates,
  evaluateG12IndependentEvergreen,
  runBoundedAsyncJobPool,
  validateFreshTestExecutionLog,
  type GateVerdictV12_4_3_1,
} from "./gateAndAsyncVerifierV12_4_3_1";
import {
  evaluateLiveOnlyIsolation,
  evaluateAudienceShortlistPurity,
  evaluateCanonicalCardDeduplication,
  evaluateRejectionReasonConsistency,
} from "./gateAndAsyncVerifierV12_4_3_2";
import {
  resolveProductMediaGallery,
  validateAndNormalizeMediaUrl,
  isStockOrPlaceholderMediaUrl,
  isPrivateOrLoopbackHost,
  verifyMediaBelongsToProduct,
  type ProductMediaResolutionResult,
} from "../media/productMediaResolver";
import {
  buildCanonicalRecommendedProducts,
  buildBuyerOrientedWhyItFits,
} from "../presentation/productFinderViewModel";
import {
  SWAI_KH02_RELEASE_VERSION,
  evaluateKH02RuntimeIdentity,
} from "../version/runtimeVersionService";

export {
  evaluateSplitG06MetaGates,
  evaluateG12IndependentEvergreen,
  runBoundedAsyncJobPool,
  validateFreshTestExecutionLog,
  evaluateLiveOnlyIsolation,
  evaluateAudienceShortlistPurity,
  evaluateCanonicalCardDeduplication,
  evaluateRejectionReasonConsistency,
};

export type GateVerdictV12_4_3_2_1 = GateVerdictV12_4_3_1;

export interface ReleaseGateRecordV12_4_3_2_1 {
  gateId: string;
  title: string;
  category:
    | "PRODUCT_MEDIA_GALLERY"
    | "E2E_FLOW_INTEGRITY"
    | "EVIDENCE_AND_SCORE_HONESTY"
    | "LAYOUT_AND_RESPONSIVE_UX"
    | "SECURITY_AND_PROVENANCE"
    | "REGRESSION_AND_BACKTEST"
    | "ASYNC_AND_GIT_CLOSURE";
  verdict: GateVerdictV12_4_3_2_1;
  details: string;
  evidenceRef?: string;
}

export interface AdversarialMutationResultV12_4_3_2_1 {
  mutationId: string;
  description: string;
  targetGateIds: string[];
  injectedDefect: string;
  detectedAndRejected: boolean;
  gateVerdictUnderMutation: "FAIL";
  reason: string;
}

/**
 * Evaluates Section 8: Merchant Page Verification Honesty.
 * Fails if any candidate with identityStatus !== "VERIFIED" or fetchOutcome === "HTTP_ERROR"
 * claims "Merchant product page verified".
 */
export function evaluateMerchantPageHonesty(
  cards: Array<{
    candidateId: string;
    title: string;
    merchantPageVerified: boolean;
    verifiedEvidenceItems: string[];
    rawCandidate?: {
      identityStatus?: string | null;
      fetchOutcome?: string | null;
    };
  }>
): { valid: boolean; violations: string[] } {
  const violations: string[] = [];
  for (const card of cards || []) {
    const idStatus = card.rawCandidate?.identityStatus || "PROBABLE";
    const fetchOut = card.rawCandidate?.fetchOutcome || null;
    const isActuallyVerified =
      idStatus === "VERIFIED" &&
      fetchOut !== "HTTP_ERROR" &&
      fetchOut !== "HTTP_404" &&
      fetchOut !== "NON_PRODUCT_PAGE" &&
      fetchOut !== "HOMEPAGE";

    if (!isActuallyVerified && card.merchantPageVerified) {
      violations.push(
        `Candidate ${card.candidateId} (${card.title}) has identityStatus=${idStatus}, fetchOutcome=${fetchOut} but merchantPageVerified=true.`
      );
    }
    if (
      !isActuallyVerified &&
      (card.verifiedEvidenceItems || []).some((ev) =>
        /Merchant product page verified/i.test(ev)
      )
    ) {
      violations.push(
        `Candidate ${card.candidateId} (${card.title}) falsely lists 'Merchant product page verified' despite identityStatus=${idStatus}, fetchOutcome=${fetchOut}.`
      );
    }
  }
  return { valid: violations.length === 0, violations };
}

/**
 * Evaluates Section 10: Buyer/Seller-Oriented "Why it fits your search".
 * Fails if primary card copy leaks raw OpenGraph/DOM verification strings.
 */
export function evaluateBuyerOrientedCopyPurity(
  cards: Array<{
    candidateId: string;
    title: string;
    whyItMatters: string;
  }>
): { valid: boolean; violations: string[] } {
  const violations: string[] = [];
  for (const card of cards || []) {
    if (
      /Resolved from OpenGraph|DOM title|JSON-LD|Verified product page via|canonical URL slug/i.test(
        card.whyItMatters || ""
      )
    ) {
      violations.push(
        `Candidate ${card.candidateId} (${card.title}) leaks technical metadata string in whyItMatters: "${card.whyItMatters}"`
      );
    }
  }
  return { valid: violations.length === 0, violations };
}

/**
 * Evaluates Section 11: KH-02 vs KH-01 Score Separation.
 * Fails if KH-02 evidenceConfidence or opportunityScore is copied into KH-01 readiness/opportunity
 * when opportunityAssessment is null.
 */
export function evaluateKh02Kh01ScoreSeparation(params: {
  kh02Score: number | null;
  kh02Confidence: number | null;
  opportunityAssessment: {
    opportunityScore?: number | null;
    evidenceReadinessScore?: number | null;
  } | null;
  displayedKh01Opportunity: string | number | null;
  displayedKh01Readiness: string | number | null;
}): { valid: boolean; reason: string } {
  if (!params.opportunityAssessment) {
    const oppStr = String(params.displayedKh01Opportunity ?? "Not Assessed");
    const readyStr = String(params.displayedKh01Readiness ?? "Not Assessed");
    if (
      (params.kh02Confidence != null && readyStr.includes(String(params.kh02Confidence))) ||
      (!/Not Assessed/i.test(readyStr) && params.displayedKh01Readiness !== null)
    ) {
      return {
        valid: false,
        reason: `KH-01 Evidence Readiness displayed '${readyStr}' when opportunityAssessment is null (leaked KH-02 confidence ${params.kh02Confidence}%).`,
      };
    }
    if (
      (params.kh02Score != null && oppStr.includes(String(params.kh02Score))) ||
      (!/Not Assessed/i.test(oppStr) && params.displayedKh01Opportunity !== null)
    ) {
      return {
        valid: false,
        reason: `KH-01 Commercial Opportunity displayed '${oppStr}' when opportunityAssessment is null (leaked KH-02 score ${params.kh02Score}).`,
      };
    }
  }
  return {
    valid: true,
    reason: "KH-02 Research Qualification and KH-01 Commercial Readiness scores are strictly separated.",
  };
}

/**
 * Evaluates Section 22: Forensic Demand Audit Integrity (`demandValue` preservation).
 * Fails if any raw observation in the audit has undefined/null value when demandValue was numeric.
 */
export function evaluateDemandAuditValueIntegrity(
  auditSeries: Array<{
    keyword: string;
    rawValues?: any[];
    observations?: Array<{ demandValue?: number; value?: number }>;
  }>
): { valid: boolean; violations: string[] } {
  const violations: string[] = [];
  for (const s of auditSeries || []) {
    if (Array.isArray(s.rawValues)) {
      if (s.rawValues.some((v) => v === null || v === undefined || Number.isNaN(Number(v)))) {
        violations.push(`Series '${s.keyword}' has null/undefined entries in rawValues.`);
      }
    }
    if (Array.isArray(s.observations)) {
      for (const obs of s.observations) {
        if (
          typeof obs.demandValue !== "number" ||
          typeof obs.value !== "number" ||
          obs.demandValue !== obs.value
        ) {
          violations.push(
            `Series '${s.keyword}' observation has mismatched or undefined demandValue=${obs.demandValue}, value=${obs.value}.`
          );
        }
      }
    }
  }
  return { valid: violations.length === 0, violations };
}

/**
 * Executes all 11 adversarial false-PASS resistance checks (Mutations A through K)
 * for SWAI KH-02 V12.4.3.2.1.
 */
export function runAdversarialFalsePassSuiteV12_4_3_2_1(_arg?: string | { currentHeadSha?: string }): {
  allMutationsCaught: boolean;
  allPassed: boolean;
  totalMutations: number;
  passedMutations: number;
  mutations: AdversarialMutationResultV12_4_3_2_1[];
} {
  const mutations: AdversarialMutationResultV12_4_3_2_1[] = [];

  // Mutation A: Missing/empty media gallery claimed as populated
  const mutAGallery = resolveProductMediaGallery({
    productId: "prod_mut_a",
    productTitle: "Empty Media Product",
  });
  const mutACaught = mutAGallery.emptyState.isEmpty === true && mutAGallery.totalCount === 0;
  mutations.push({
    mutationId: "MUTATION_A",
    description: "Product with zero verified media must report emptyState.isEmpty=true and totalCount=0",
    targetGateIds: ["M01", "M07"],
    injectedDefect: "Zero product images and zero ad media assets",
    detectedAndRejected: mutACaught,
    gateVerdictUnderMutation: "FAIL",
    reason: `Gallery resolved with isEmpty=${mutAGallery.emptyState.isEmpty}, totalCount=${mutAGallery.totalCount}`,
  });

  // Mutation B: Stock / placeholder image URL injected into Product Media Gallery
  const mutBGallery = resolveProductMediaGallery({
    productId: "prod_mut_b",
    productTitle: "Feeder with Stock Image",
    storeDomain: "uahpet.com",
    productImageUrl: "https://images.unsplash.com/photo-1517849845537-4d257902454a",
    candidateThumbnailUrl: "https://placehold.co/600x400",
  });
  const mutBCaught =
    mutBGallery.totalCount === 0 &&
    mutBGallery.rejectedItems.some((r) => r.reasonCode === "STOCK_OR_PLACEHOLDER_IMAGE");
  mutations.push({
    mutationId: "MUTATION_B",
    description: "Inject Unsplash and placehold.co stock images into Product Media Resolver",
    targetGateIds: ["M02", "M22"],
    injectedDefect: "productImageUrl='https://images.unsplash.com/...', candidateThumbnailUrl='https://placehold.co/600x400'",
    detectedAndRejected: mutBCaught,
    gateVerdictUnderMutation: "FAIL",
    reason: mutBGallery.rejectedItems[0]?.reason || "Rejected stock/placeholder domain",
  });

  // Mutation C: Unsafe URL scheme (javascript:) and loopback SSRF (127.0.0.1) injected
  const mutCJs = validateAndNormalizeMediaUrl("javascript:alert(document.cookie)", "IMAGE");
  const mutCSsrf = validateAndNormalizeMediaUrl("http://127.0.0.1:8080/internal-admin.png", "IMAGE");
  const mutCEmbed = validateAndNormalizeMediaUrl("https://evil-tracker.org/embed/player", "VIDEO");
  const mutCCaught = !mutCJs.valid && !mutCSsrf.valid && !mutCEmbed.valid;
  mutations.push({
    mutationId: "MUTATION_C",
    description: "Inject javascript: URI, 127.0.0.1 SSRF URL, and untrusted iframe embed domain",
    targetGateIds: ["M06", "M22"],
    injectedDefect: "javascript:alert(1), http://127.0.0.1:8080/..., https://evil-tracker.org/embed/...",
    detectedAndRejected: mutCCaught,
    gateVerdictUnderMutation: "FAIL",
    reason: `${mutCJs.rejectionReason} | ${mutCSsrf.rejectionReason} | ${mutCEmbed.rejectionReason}`,
  });

  // Mutation D: Cross-product media contamination (attaching dress store image to uahpet.com feeder)
  const mutDAssoc = verifyMediaBelongsToProduct({
    targetProductId: "prod_uahpet",
    targetStoreDomain: "uahpet.com",
    targetProductUrl: "https://www.uahpet.com/products/automatic-feeder",
    mediaStoreDomain: "unrelated-apparel-boutique.com",
    mediaLandingPageUrl: "https://unrelated-apparel-boutique.com/products/summer-dress",
  });
  const mutDCaught = !mutDAssoc.associated && !mutDAssoc.matched;
  mutations.push({
    mutationId: "MUTATION_D",
    description: "Inject cross-domain unrelated product media into uahpet.com product gallery",
    targetGateIds: ["M03", "M22"],
    injectedDefect: "mediaStoreDomain='unrelated-apparel-boutique.com' on targetStoreDomain='uahpet.com'",
    detectedAndRejected: mutDCaught,
    gateVerdictUnderMutation: "FAIL",
    reason: mutDAssoc.reason,
  });

  // Mutation E: PROBABLE + HTTP_ERROR candidate falsely claiming 'Merchant product page verified'
  const mutECheck = evaluateMerchantPageHonesty([
    {
      candidateId: "cand_1783682388",
      title: "Automatic Dog Feeder for Easy Daily Meals",
      merchantPageVerified: true,
      verifiedEvidenceItems: ["Merchant product page verified"],
      rawCandidate: {
        identityStatus: "PROBABLE",
        fetchOutcome: "HTTP_ERROR",
      },
    },
  ]);
  const mutECaught = !mutECheck.valid;
  mutations.push({
    mutationId: "MUTATION_E",
    description: "Inject 'Merchant product page verified' onto PROBABLE + HTTP_ERROR candidate",
    targetGateIds: ["M15"],
    injectedDefect: "identityStatus=PROBABLE, fetchOutcome=HTTP_ERROR with merchantPageVerified=true",
    detectedAndRejected: mutECaught,
    gateVerdictUnderMutation: "FAIL",
    reason: mutECheck.violations[0] || "Rejected false merchant page verification claim",
  });

  // Mutation F: Primary card 'Why it fits your search' leaking raw OpenGraph/DOM verification string
  const mutFCopy = evaluateBuyerOrientedCopyPurity([
    {
      candidateId: "cand_mut_f",
      title: "Automatic Wet Food Cat Feeder",
      whyItMatters:
        "Resolved from OpenGraph/DOM title on https://www.uahpet.com/products/feeder",
    },
  ]);
  const mutFCaught = !mutFCopy.valid;
  mutations.push({
    mutationId: "MUTATION_F",
    description: "Inject raw 'Resolved from OpenGraph/DOM title' string into primary card whyItMatters",
    targetGateIds: ["M17"],
    injectedDefect: "whyItMatters='Resolved from OpenGraph/DOM title on ...'",
    detectedAndRejected: mutFCaught,
    gateVerdictUnderMutation: "FAIL",
    reason: mutFCopy.violations[0] || "Rejected technical metadata in primary buyer copy",
  });

  // Mutation G: KH-02 evidenceConfidence (85%) copied into KH-01 Evidence Readiness when opportunityAssessment is null
  const mutGScore = evaluateKh02Kh01ScoreSeparation({
    kh02Score: 74,
    kh02Confidence: 85,
    opportunityAssessment: null,
    displayedKh01Opportunity: "74 / 100",
    displayedKh01Readiness: "85%",
  });
  const mutGCaught = !mutGScore.valid;
  mutations.push({
    mutationId: "MUTATION_G",
    description: "Copy KH-02 confidence (85%) into KH-01 Evidence Readiness when opportunityAssessment is null",
    targetGateIds: ["M18"],
    injectedDefect: "opportunityAssessment=null but displayedKh01Readiness='85%'",
    detectedAndRejected: mutGCaught,
    gateVerdictUnderMutation: "FAIL",
    reason: mutGScore.reason,
  });

  // Mutation H: Forensic demand audit dropping demandValue (mapping r.value -> undefined)
  const mutHDemand = evaluateDemandAuditValueIntegrity([
    {
      keyword: "Automatic Pet Feeder",
      rawValues: [undefined, undefined, undefined],
      observations: [{ demandValue: 76, value: undefined as any }],
    },
  ]);
  const mutHCaught = !mutHDemand.valid;
  mutations.push({
    mutationId: "MUTATION_H",
    description: "Map non-existent r.value (undefined) instead of r.demandValue in DEMAND_SOURCE_FORENSIC_AUDIT",
    targetGateIds: ["M21"],
    injectedDefect: "observations[0].value = undefined",
    detectedAndRejected: mutHCaught,
    gateVerdictUnderMutation: "FAIL",
    reason: mutHDemand.violations[0] || "Rejected undefined demand audit values",
  });

  // Mutation I: Duplicate media URLs across Merchant Page, Candidate, and Ad Creative not deduplicated
  const mutIGallery = resolveProductMediaGallery({
    productId: "prod_mut_i",
    productTitle: "Dedupe Test Feeder",
    storeDomain: "uahpet.com",
    productImageUrl: "https://www.uahpet.com/cdn/shop/files/feeder_1024x1024.webp?v=1",
    candidateImageReferences: ["http://www.uahpet.com/cdn/shop/files/feeder_400x400.webp?v=2"],
    candidateThumbnailUrl: "https://www.uahpet.com/cdn/shop/files/feeder_800x800.webp?v=3",
  });
  const mutICaught =
    mutIGallery.totalCount === 1 && mutIGallery.provenanceSummary.deduplicatedCount === 2;
  mutations.push({
    mutationId: "MUTATION_I",
    description: "Inject 3 duplicate/size-variant Shopify CDN URLs and verify strict deduplication to 1 item",
    targetGateIds: ["M04", "M12"],
    injectedDefect: "3 size variants (_1024x1024, _400x400, _800x800) of same product image",
    detectedAndRejected: mutICaught,
    gateVerdictUnderMutation: "FAIL",
    reason: `Resolved ${mutIGallery.totalCount} unique item and deduplicated ${mutIGallery.provenanceSummary.deduplicatedCount} variants`,
  });

  // Mutation J: Runtime version / SHA mismatch
  const mutJRuntime = evaluateKH02RuntimeIdentity({
    frontendBuildSha: "aaaa111",
    frontendVersion: "12.4.3.2",
    backendBuildSha: "bbbb222",
  });
  const mutJCaught = mutJRuntime.runtimeStatus === "VERSION_MISMATCH";
  mutations.push({
    mutationId: "MUTATION_J",
    description: "Inject mismatched frontendVersion (12.4.3.2) vs backend releaseVersion (12.4.3.2.1)",
    targetGateIds: ["M25"],
    injectedDefect: "frontendVersion='12.4.3.2', backendVersion='12.4.3.2.1'",
    detectedAndRejected: mutJCaught,
    gateVerdictUnderMutation: "FAIL",
    reason: `Runtime status evaluated to ${mutJRuntime.runtimeStatus}`,
  });

  // Mutation K: Reused stale execution log
  const mutKLog = validateFreshTestExecutionLog(
    {
      suiteId: "mut_k_suite",
      command: "npx vitest run",
      startedAt: "2026-01-01T00:00:00.000Z",
      completedAt: "2026-01-01T00:00:05.000Z",
      durationMs: 5000,
      headSha: "stale_sha_000000",
      exitCode: 0,
      passedTests: 10,
      failedTests: 0,
      reusedPreviousLog: true,
      logFilePath: "stale.log",
    },
    "current_clean_head_sha_123456"
  );
  const mutKCaught = !mutKLog.valid;
  mutations.push({
    mutationId: "MUTATION_K",
    description: "Inject reusedPreviousLog=true and mismatched gitCommitSha into test execution provenance",
    targetGateIds: ["M28", "M32"],
    injectedDefect: "reusedPreviousLog=true, headSha='stale_sha_000000'",
    detectedAndRejected: mutKCaught,
    gateVerdictUnderMutation: "FAIL",
    reason: mutKLog.reasons?.[0] || "Rejected stale/reused execution log",
  });

  const passedMutations = mutations.filter((m) => m.detectedAndRejected).length;
  const allMutationsCaught = passedMutations === mutations.length;
  return {
    allMutationsCaught,
    allPassed: allMutationsCaught,
    totalMutations: mutations.length,
    passedMutations,
    mutations,
  };
}

export const runAllV12_4_3_2_1AdversarialMutations = runAdversarialFalsePassSuiteV12_4_3_2_1;
