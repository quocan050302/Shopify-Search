/**
 * SWAI V11 — Unified Ad View Model
 *
 * Defines the standard shape consumed by frontend UI components (AdCard, Explorer, Drawer).
 * Resolves API/UI mismatches and ensures honest display of age, scores, status, and media.
 */

export interface AdViewModel {
  id: string;
  externalAdId: string | null;
  platform: "META" | "TIKTOK" | string;
  headline: string | null;
  bodyText: string | null;
  callToAction: string | null;
  landingPageUrl: string | null;
  originalAdUrl: string;
  status: "ACTIVE" | "INACTIVE" | "UNKNOWN" | string;
  lifecycleStatus: string;
  category: string;
  targetMarket: string;
  calendarAgeDays: number | null;
  ageEvidenceSource: string | null;
  sourceReportedStartAt: string | null;
  sourceReportedEndAt?: string | null;
  firstSeenAt?: string | null;
  lastSeenAt?: string | null;
  observationCount?: number;
  verifiedActiveCount?: number;
  advertiser: {
    id?: string;
    name: string;
    externalId?: string | null;
    platform?: string;
    profileUrl?: string | null;
  };
  media: {
    mediaType: "VIDEO" | "IMAGE" | "CAROUSEL" | "UNKNOWN";
    videoUrl: string | null;
    embedUrl: string | null;
    thumbnailUrl: string | null;
    aspectRatio: string;
    availability: "READY" | "EXPIRED" | "RESTRICTED" | "FALLBACK_ONLY";
  } | null;
  score: {
    totalScore: number | null;
    tier: string;
    evidenceConfidence: number | null;
    coverageStatus: string;
    explanation?: string | null;
  } | null;
  isSyntheticQuarantine?: boolean;
}

export interface ProductEconomics {
  observedSellingPrice: number | null;
  estimatedSupplierCost: number | null;
  shippingCost: number | null;
  platformFees: number | null;
  returnAllowancePercent: number | null;
  estimatedContributionMargin: number | null;
  breakEvenCPA: number | null;
  sourceStatus: "USER_ENTERED" | "STOREFRONT_VERIFIED" | "UNVERIFIED";
}

export interface ResearchChecklist {
  demandEvidence: boolean;
  competitionLevel: "LOW" | "MODERATE" | "HIGH" | "SATURATED";
  creativeAppeal: "STRONG" | "MODERATE" | "WEAK";
  differentiationFeasibility: boolean;
  deliveryFeasibility: boolean;
  returnRisk: "LOW" | "MEDIUM" | "HIGH";
  recommendation: "RESEARCH_MORE" | "READY_FOR_SMALL_TEST" | "REJECTED";
  recommendationRationale: string;
}

export interface AdObservationViewModel {
  id: string;
  observedAt: string;
  observationStatus: string;
  evidenceType: string;
  verificationMethod: string | null;
  confidence: number | null;
}

export interface AdCreativeAnalysisViewModel {
  id: string;
  modelVersion: string;
  hookType: string | null;
  hookQualityScore: number | null;
  pacingScore: number | null;
  ctaClassification: string | null;
  sellingPoints: string[];
  weaknesses: string[];
  scriptIdeas: Record<string, unknown> | null;
  isCopyOnly: boolean;
  rawAnalysis: string | null;
  createdAt: string;
}

export interface AdScoreBreakdownViewModel {
  totalScore: number | null;
  tier: string;
  eligible: boolean;
  eligibilityReason: string;
  longevityComponent: number | null;
  observationComponent: number | null;
  coverageComponent: number | null;
  sourceReliabilityComponent: number | null;
  componentWeights: {
    longevity: number;
    observation: number;
    coverage: number;
    sourceReliability: number;
  };
  evidenceConfidence: number;
  longevityCategory: string;
  coverageStatus: string;
  calendarAgeDays: number | null;
  ageEvidenceSource: "SOURCE_REPORTED" | "FIRST_OBSERVATION" | "NONE";
  scoreBreakdown: Record<string, { score: number | null; weight: number; reason: string }>;
  availableSignals: string[];
  missingSignals: string[];
  formulaVersion: string;
  explanation: string;
  calculatedAt: string;
}

export interface AdLinkedProductViewModel {
  id: string;
  title: string;
  category: string;
  description: string | null;
  imageUrl: string | null;
  currentPrice: number | null;
  currency: string;
  productUrl: string | null;
  store: {
    id: string;
    domain: string;
    storeName: string | null;
    commercePlatform: string;
  } | null;
  economics: ProductEconomics | null;
  checklist: ResearchChecklist | null;
  decision: "RESEARCH_MORE" | "READY_FOR_SMALL_TEST" | "REJECTED" | "RESEARCHING" | string | null;
  notes: string | null;
  priceHistory: Array<{
    id: string;
    price: number;
    currency: string;
    observedAt: string;
    source: string;
  }>;
}

export interface AdDetailViewModel extends AdViewModel {
  scoreDetails: AdScoreBreakdownViewModel | null;
  observations: AdObservationViewModel[];
  distinctDates: {
    sourceReportedStartAt: string | null;
    sourceReportedEndAt: string | null;
    firstSwaiObservationAt: string | null;
    lastSwaiObservationAt: string | null;
    firstSeenAt: string | null;
    lastSeenAt: string | null;
  };
  analysis: AdCreativeAnalysisViewModel | null;
  linkedProduct: AdLinkedProductViewModel | null;
  relatedVariants: Array<{
    id: string;
    headline: string | null;
    media: {
      thumbnailUrl: string | null;
      mediaType: string;
      aspectRatio?: string;
    } | null;
    status: string;
    sourceReportedStartAt: string | null;
    totalScore?: number | null;
  }>;
  provenance: {
    dataSourceName: string;
    dataSourceDisplayName: string;
    externalAdId: string | null;
    originalAdUrl: string;
    landingPageUrl: string | null;
    storefrontDomain: string | null;
    dataConfidence: string;
    hasSampleMedia: boolean;
    hasStockThumbnail: boolean;
    missingFields: string[];
  };
}
