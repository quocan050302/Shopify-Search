// Shared domain types for Shopify Winning Ads Intelligence (SWAI)

export type OperatingMode =
  | "RESEARCH_ONLY"
  | "RESEARCH_AND_STORE"
  | "OWNED_AD_ACCOUNT_ANALYTICS";

export type DataConfidence =
  | "VERIFIED"
  | "OBSERVED"
  | "ESTIMATED"
  | "UNAVAILABLE";

export type AdPlatform = "META" | "TIKTOK" | "OTHER";

export type ProviderStatus =
  | "AVAILABLE"
  | "CONNECTED"
  | "REQUIRES_AUTH"
  | "REQUIRES_LICENSE"
  | "UNSUPPORTED_REGION"
  | "UNAVAILABLE"
  | "ERROR";

export type CommercePlatformStatus =
  | "SHOPIFY_CONFIRMED"
  | "SHOPIFY_POSSIBLE"
  | "OTHER"
  | "UNKNOWN";

export type HookType =
  | "Problem-First"
  | "Curiosity"
  | "Surprise"
  | "Product Demonstration"
  | "UGC Testimonial"
  | "Transformation"
  | "Emotional";

export type ScoreTier =
  | "HIGH_POTENTIAL"
  | "MEDIUM_POTENTIAL"
  | "LOW_POTENTIAL"
  | "INSUFFICIENT_EVIDENCE";

export type MediaAvailability =
  | "READY"
  | "EXPIRED"
  | "RESTRICTED"
  | "FALLBACK_ONLY";

export interface ProviderCapability {
  id: string;
  name: string;
  displayName: string;
  description: string;
  status: ProviderStatus;
  capabilities: string[];
  supportedRegions: string[];
  rateLimitInfo?: string;
}

export interface AdSourceResolution {
  platform: AdPlatform;
  canonicalUrl: string;
  originalUrl: string;
  externalId?: string;
  extractedAdId?: string;
  sourceType?: string;
  isCreativeCenter?: boolean;
  region?: string;
  targetRegion?: string;
  searchWindowPeriodDays?: number | null;
  isEmbeddable?: boolean;
  embedUrl?: string | null;
  authorUsername?: string;
  isValid: boolean;
  resolved?: boolean;
  notes?: string;
}

export interface NormalizedAdRecord {
  platform: AdPlatform;
  externalAdId: string;
  advertiserName: string;
  advertiserExternalId?: string;
  advertiserProfileUrl?: string;
  advertiserDomain?: string;
  headline?: string;
  bodyText?: string;
  callToAction?: string;
  landingPageUrl?: string;
  originalAdUrl: string;
  targetMarket: string;
  category: string;
  firstSeenAt: Date;
  lastSeenAt: Date;
  status: "ACTIVE" | "INACTIVE" | "UNKNOWN";
  dataConfidence: DataConfidence;
  media: {
    mediaType: "VIDEO" | "IMAGE" | "CAROUSEL";
    videoUrl?: string;
    embedUrl?: string;
    thumbnailUrl?: string;
    aspectRatio?: string;
    durationSeconds?: number;
    availability: MediaAvailability;
  };
  metrics?: {
    key: string;
    value?: number;
    textValue?: string;
    classification: DataConfidence;
  }[];
}

export interface WinningPotentialBreakdown {
  totalScore: number; // 0 - 100
  tier: ScoreTier;
  confidenceScore: number; // 0 - 100
  components: {
    longevity: { score: number; weight: number; daysActive: number };
    diversity: { score: number; weight: number; variantCount: number };
    performance: { score: number; weight: number; status: string };
    recency: { score: number; weight: number; lastSeenDaysAgo: number };
    clarity: { score: number; weight: number; hasOffer: boolean };
    aiQuality: { score: number; weight: number };
  };
  missingSignals: string[];
  formulaVersion: string;
}

export interface SystemHealthReport {
  status: "HEALTHY" | "DEGRADED" | "UNHEALTHY";
  operatingMode: OperatingMode;
  targetMarket: string;
  database: "CONNECTED" | "DISCONNECTED";
  activeProviders: number;
  totalAdsObserved: number;
  totalProductsIdentified: number;
  isolationVerified: boolean;
}
