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
