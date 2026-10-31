/**
 * SWAI KH-02 V12.4.3.2.1 — Authentic Product Media Resolution Service
 *
 * Implements Section 3, Section 5, Section 17, and Section 21:
 * - Combines authentic product-specific media from verified merchant pages,
 *   authoritative KH-02 candidate records, and explicitly linked AdMediaAssets.
 * - Strict source reliability & identity priority:
 *   1. Verified merchant product image (MERCHANT_PRODUCT_PAGE)
 *   2. Verified merchant product gallery (MERCHANT_GALLERY)
 *   3. Candidate-specific thumbnail/video from authoritative KH-02 run (KH02_CANDIDATE)
 *   4. Explicitly linked AdMediaAsset records (META_AD_CREATIVE)
 *   5. Verified video poster thumbnails from linked ads
 *   6. Honest empty state when no valid media exists
 * - Security & provenance safeguards:
 *   - Rejects javascript:, data:, file:, blob: schemes
 *   - Rejects localhost / private / loopback / link-local SSRF targets
 *   - Rejects stock/placeholder image services
 *   - Rejects untrusted iframe embed origins
 *   - Deduplicates identical media assets across multiple ads
 *   - Never matches media by generic niche keywords ("pet", "dog", "cat", "feeder")
 */

import crypto from "crypto";

export type ProductMediaKind =
  | "PRODUCT_IMAGE"
  | "PRODUCT_VIDEO"
  | "AD_IMAGE"
  | "AD_VIDEO";

export type ProductMediaStatus =
  | "READY"
  | "UNVERIFIED"
  | "EXPIRED"
  | "RESTRICTED"
  | "UNAVAILABLE";

export type ProductMediaSource =
  | "MERCHANT_PRODUCT_PAGE"
  | "MERCHANT_GALLERY"
  | "KH02_CANDIDATE"
  | "META_AD_CREATIVE"
  | "OTHER_VERIFIED_SOURCE";

export interface ProductMediaItem {
  id: string;

  productId: string;
  candidateId: string | null;
  researchRunId: string | null;

  kind: ProductMediaKind;
  mediaType: "IMAGE" | "VIDEO";

  url: string;
  thumbnailUrl: string | null;
  imageUrl: string | null;
  videoUrl: string | null;
  embedUrl: string | null;
  posterUrl: string | null;
  isEmbed: boolean;

  title: string;
  altText: string;

  source: ProductMediaSource;
  sourceType: ProductMediaSource;
  sourceLabel: string;

  sourceUrl: string | null;
  sourcePageUrl: string | null;
  sourceAdId: string | null;
  storeDomain: string | null;
  advertiserName: string | null;

  availability: ProductMediaStatus;

  verifiedProductAssociation: boolean;
  associationReason: string;

  width: number | null;
  height: number | null;
  aspectRatio: string | null;
  durationSeconds: number | null;

  observedAt: string | null;
  dedupeKey: string;
}

export interface ProductMediaResolutionInput {
  productId: string;
  productTitle: string;
  productUrl?: string | null;
  canonicalProductUrl?: string | null;
  productImageUrl?: string | null;
  storeDomain?: string | null;
  identityStatus?: string | null;
  fetchOutcome?: string | null;

  // Optional authoritative KH-02 candidate context
  candidateId?: string | null;
  researchRunId?: string | null;
  candidateTitle?: string | null;
  candidateCanonicalUrl?: string | null;
  candidateStoreDomain?: string | null;
  candidateThumbnailUrl?: string | null;
  candidateVideoUrl?: string | null;
  candidateMediaSourceAdId?: string | null;
  candidateImageReferences?: string[] | null;
  candidateSupportingAdIds?: string[] | null;

  // Optional landing page snapshot extracted images
  landingPageImageUrls?: string[] | null;

  // Shorthand ad creative media array (supported alongside adLinks)
  adCreativeMedia?: Array<{
    adId?: string | null;
    mediaType?: "IMAGE" | "VIDEO" | string | null;
    url?: string | null;
    videoUrl?: string | null;
    imageUrl?: string | null;
    thumbnailUrl?: string | null;
    embedUrl?: string | null;
    advertiserName?: string | null;
    landingPageUrl?: string | null;
    originalAdUrl?: string | null;
    availability?: string | null;
  }> | null;

  // Explicitly linked AdProductLink rows from Prisma ResearchProduct
  adLinks?: Array<{
    adId?: string;
    productId?: string;
    confidence?: string | null;
    ad?: {
      id: string;
      externalAdId?: string | null;
      platform?: string | null;
      headline?: string | null;
      advertiserName?: string | null;
      landingPageUrl?: string | null;
      originalAdUrl?: string | null;
      lastSeenAt?: Date | string | null;
      mediaAssets?: Array<{
        id: string;
        adId?: string;
        mediaType?: string | null;
        videoUrl?: string | null;
        embedUrl?: string | null;
        thumbnailUrl?: string | null;
        aspectRatio?: string | null;
        durationSeconds?: number | null;
        width?: number | null;
        height?: number | null;
        availability?: string | null;
        source?: string | null;
        updatedAt?: Date | string | null;
      }>;
    } | null;
  }> | null;
}

export interface ProductMediaRejectionRecord {
  rawUrl: string | null;
  source: string;
  reasonCode:
    | "UNSAFE_URL_SCHEME"
    | "PRIVATE_OR_LOOPBACK_HOST"
    | "STOCK_OR_PLACEHOLDER_IMAGE"
    | "UNTRUSTED_EMBED_ORIGIN"
    | "CROSS_PRODUCT_CONTAMINATION"
    | "UNVERIFIED_AD_ASSOCIATION"
    | "MALFORMED_URL"
    | "DUPLICATE_MEDIA"
    | "MISSING_MEDIA_URL";
  reason: string;
}

export interface ProductMediaResolutionResult {
  productId: string;
  candidateId: string | null;
  researchRunId: string | null;
  totalCount: number;
  hasImages: boolean;
  hasVideo: boolean;
  primaryMedia: ProductMediaItem | null;
  primaryImage: ProductMediaItem | null;
  primaryVideo: ProductMediaItem | null;
  items: ProductMediaItem[];
  mediaItems: ProductMediaItem[];
  productImages: ProductMediaItem[];
  adCreatives: ProductMediaItem[];
  videoItems: ProductMediaItem[];
  emptyState: {
    isEmpty: boolean;
    headline: string;
    explanation: string;
    merchantPageUrl: string | null;
    merchantUrl: string | null;
  };
  provenanceSummary: {
    totalResolved: number;
    merchantImageCount: number;
    candidateMediaCount: number;
    adCreativeMediaCount: number;
    playableVideoCount: number;
    restrictedOrExpiredCount: number;
    deduplicatedCount: number;
    rejectedCount: number;
    primarySource: ProductMediaSource | "NONE";
  };
  rejectedItems: ProductMediaRejectionRecord[];
}

const STOCK_OR_PLACEHOLDER_HOSTS = [
  "images.unsplash.com",
  "unsplash.com",
  "picsum.photos",
  "placehold.co",
  "placeholder.com",
  "via.placeholder.com",
  "dummyimage.com",
  "lorempixel.com",
  "placekitten.com",
  "example.com",
  "www.example.com",
];

const PERMITTED_OFFICIAL_EMBED_HOSTS = [
  "www.facebook.com",
  "facebook.com",
  "web.facebook.com",
  "www.instagram.com",
  "instagram.com",
  "www.tiktok.com",
  "tiktok.com",
  "www.youtube.com",
  "youtube.com",
  "player.vimeo.com",
];

export function isStockOrPlaceholderMediaUrl(rawUrl: string | null | undefined): boolean {
  if (!rawUrl || typeof rawUrl !== "string") return true;
  const trimmed = rawUrl.trim().toLowerCase();
  if (!trimmed) return true;
  return STOCK_OR_PLACEHOLDER_HOSTS.some((host) => trimmed.includes(host));
}

export function isPrivateOrLoopbackHost(hostname: string): boolean {
  const h = hostname.trim().toLowerCase().replace(/^\[|\]$/g, "");
  if (!h) return true;
  if (
    h === "localhost" ||
    h === "0.0.0.0" ||
    h === "::1" ||
    h === "0:0:0:0:0:0:0:1" ||
    h.endsWith(".local") ||
    h.endsWith(".internal") ||
    h.endsWith(".localhost")
  ) {
    return true;
  }
  if (/^127\./.test(h)) return true;
  if (/^10\./.test(h)) return true;
  if (/^192\.168\./.test(h)) return true;
  if (/^169\.254\./.test(h)) return true;
  if (/^172\.(1[6-9]|2[0-9]|3[0-1])\./.test(h)) return true;
  if (/^(fc00:|fd00:|fe80:)/i.test(h)) return true;
  return false;
}

export interface MediaUrlValidationResult {
  valid: boolean;
  normalizedUrl: string | null;
  hostname: string | null;
  isEmbed: boolean;
  isExpiredToken: boolean;
  rejectionCode?: ProductMediaRejectionRecord["reasonCode"];
  rejectionReason?: string;
}

/**
 * Validates a media URL against SSRF, unsafe schemes, malformed syntax, and stock placeholders.
 * Safely upgrades http:// Shopify CDN links (/cdn/shop/) to https:// to avoid mixed-content blocks.
 */
export function validateAndNormalizeMediaUrl(
  rawUrl: string | null | undefined,
  optionsOrType: { isEmbed?: boolean } | "IMAGE" | "VIDEO" = {}
): MediaUrlValidationResult {
  const options: { isEmbed?: boolean; mediaType?: "IMAGE" | "VIDEO" } =
    typeof optionsOrType === "string"
      ? { mediaType: optionsOrType }
      : optionsOrType || {};

  if (!rawUrl || typeof rawUrl !== "string" || !rawUrl.trim()) {
    return {
      valid: false,
      normalizedUrl: null,
      hostname: null,
      isEmbed: false,
      isExpiredToken: false,
      rejectionCode: "MISSING_MEDIA_URL",
      rejectionReason: "Media URL is empty or null.",
    };
  }

  const trimmed = rawUrl.trim();
  if (/^(javascript|data|file|vbscript|blob|ftp|about):/i.test(trimmed)) {
    return {
      valid: false,
      normalizedUrl: null,
      hostname: null,
      isEmbed: false,
      isExpiredToken: false,
      rejectionCode: "UNSAFE_URL_SCHEME",
      rejectionReason: `Rejected unsafe URL scheme in '${trimmed.slice(0, 40)}'. Only http/https public media URLs are permitted.`,
    };
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return {
      valid: false,
      normalizedUrl: null,
      hostname: null,
      isEmbed: false,
      isExpiredToken: false,
      rejectionCode: "MALFORMED_URL",
      rejectionReason: `Malformed media URL: '${trimmed.slice(0, 80)}'.`,
    };
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return {
      valid: false,
      normalizedUrl: null,
      hostname: null,
      isEmbed: false,
      isExpiredToken: false,
      rejectionCode: "UNSAFE_URL_SCHEME",
      rejectionReason: `Unsupported protocol '${parsed.protocol}'.`,
    };
  }

  if (parsed.username || parsed.password) {
    return {
      valid: false,
      normalizedUrl: null,
      hostname: null,
      isEmbed: false,
      isExpiredToken: false,
      rejectionCode: "MALFORMED_URL",
      rejectionReason: "Media URL must not embed credentials.",
    };
  }

  const hostname = parsed.hostname.toLowerCase();
  if (isPrivateOrLoopbackHost(hostname)) {
    return {
      valid: false,
      normalizedUrl: null,
      hostname,
      isEmbed: false,
      isExpiredToken: false,
      rejectionCode: "PRIVATE_OR_LOOPBACK_HOST",
      rejectionReason: `Rejected private or loopback host '${hostname}' (SSRF protection).`,
    };
  }

  if (!hostname.includes(".")) {
    return {
      valid: false,
      normalizedUrl: null,
      hostname,
      isEmbed: false,
      isExpiredToken: false,
      rejectionCode: "MALFORMED_URL",
      rejectionReason: `Host '${hostname}' is not a valid public domain.`,
    };
  }

  if (isStockOrPlaceholderMediaUrl(trimmed)) {
    return {
      valid: false,
      normalizedUrl: null,
      hostname,
      isEmbed: false,
      isExpiredToken: false,
      rejectionCode: "STOCK_OR_PLACEHOLDER_IMAGE",
      rejectionReason: `Rejected stock/placeholder media domain '${hostname}'.`,
    };
  }

  const looksLikeEmbedPath =
    Boolean(options.isEmbed) ||
    /\/embed(\/|$)/i.test(parsed.pathname) ||
    (options.mediaType === "VIDEO" &&
      !/\.(mp4|webm|mov|m4v|ogg|m3u8)(\?|$)/i.test(parsed.pathname) &&
      !hostname.includes("fbcdn.net") &&
      !hostname.includes("tiktokcdn") &&
      !hostname.includes("shopify"));

  if (looksLikeEmbedPath) {
    const allowedEmbed = PERMITTED_OFFICIAL_EMBED_HOSTS.some(
      (allowed) => hostname === allowed || hostname.endsWith(`.${allowed}`)
    );
    if (!allowedEmbed) {
      return {
        valid: false,
        normalizedUrl: null,
        hostname,
        isEmbed: true,
        isExpiredToken: false,
        rejectionCode: "UNTRUSTED_EMBED_ORIGIN",
        rejectionReason: `Rejected untrusted iframe embed domain '${hostname}'.`,
      };
    }
  }

  // Upgrade http:// to https:// for Shopify CDN (/cdn/shop/) and standard storefront CDNs
  if (
    parsed.protocol === "http:" &&
    (parsed.pathname.includes("/cdn/shop/") || hostname.endsWith("shopify.com"))
  ) {
    parsed.protocol = "https:";
  }

  // Check if URL contains an explicit expired `expires=` unix timestamp
  let isExpiredToken = false;
  const expiresParam = parsed.searchParams.get("expires") || parsed.searchParams.get("exp");
  if (expiresParam && /^\d{10}$/.test(expiresParam)) {
    const expSec = parseInt(expiresParam, 10);
    if (expSec * 1000 < Date.now() - 60_000) {
      isExpiredToken = true;
    }
  }

  return {
    valid: true,
    normalizedUrl: parsed.toString(),
    hostname,
    isEmbed: looksLikeEmbedPath,
    isExpiredToken,
  };
}

/**
 * Generates a stable deduplication key for a media URL so identical images/videos
 * and Shopify CDN size variants (_400x400, _1024x1024) appear only once in the gallery.
 */
export function buildCanonicalMediaDedupeKey(
  rawUrl: string,
  kind: ProductMediaKind | "IMAGE" | "VIDEO" = "PRODUCT_IMAGE"
): string {
  const mediaFamily =
    kind === "AD_VIDEO" || kind === "PRODUCT_VIDEO" || kind === "VIDEO"
      ? "VIDEO"
      : "IMAGE";
  try {
    const u = new URL(rawUrl);
    const host = u.hostname.toLowerCase().replace(/^www\./, "");
    const normalizedHost = host.includes("fbcdn.net") ? "fbcdn.net" : host;
    const cleanPath = u.pathname
      .replace(/\/+/g, "/")
      .replace(/\/$/, "")
      // Strip Shopify image size modifiers like _400x400, _1024x1024, _large, _grande before extension
      .replace(
        /_(\d+x\d+|\d+x|x\d+|small|compact|medium|large|grande|master)(?=\.(webp|jpg|jpeg|png|gif|avif)$)/i,
        ""
      );
    return `${mediaFamily}::${normalizedHost}${cleanPath}`;
  } catch {
    return `${mediaFamily}::${rawUrl.trim().toLowerCase()}`;
  }
}

function extractRegistrableDomain(domainOrUrl: string | null | undefined): string | null {
  if (!domainOrUrl) return null;
  let host = domainOrUrl.trim().toLowerCase();
  if (host.includes("://")) {
    try {
      host = new URL(host).hostname.toLowerCase();
    } catch {
      return null;
    }
  }
  host = host.replace(/^www\./, "").split("/")[0].split(":")[0];
  return host || null;
}

function extractProductHandle(urlStr: string | null | undefined): string | null {
  if (!urlStr) return null;
  const m = urlStr.match(/\/products\/([a-zA-Z0-9_-]+)/i);
  return m?.[1] ? m[1].toLowerCase() : null;
}

/**
 * Checks whether a candidate or ad landing page belongs to the same product identity
 * as the target product (preventing cross-product media contamination).
 */
export function verifyMediaBelongsToProduct(params: {
  targetProductId?: string | null;
  targetProductUrl?: string | null;
  targetStoreDomain?: string | null;
  mediaOwnerProductId?: string | null;
  mediaLandingUrl?: string | null;
  mediaLandingPageUrl?: string | null;
  mediaDomain?: string | null;
  mediaStoreDomain?: string | null;
  mediaUrl?: string | null;
}): { associated: boolean; matched: boolean; reason: string } {
  const {
    targetProductId,
    targetProductUrl,
    targetStoreDomain,
    mediaOwnerProductId,
    mediaLandingUrl,
    mediaLandingPageUrl,
    mediaDomain,
    mediaStoreDomain,
    mediaUrl,
  } = params;

  const effectiveLandingUrl = mediaLandingUrl || mediaLandingPageUrl || null;
  const effectiveMediaDomain = mediaDomain || mediaStoreDomain || mediaUrl || null;

  if (mediaOwnerProductId && targetProductId && mediaOwnerProductId !== targetProductId) {
    return {
      associated: false,
      matched: false,
      reason: `Media belongs to product '${mediaOwnerProductId}', not target product '${targetProductId}'.`,
    };
  }

  const targetHandle = extractProductHandle(targetProductUrl);
  const mediaHandle = extractProductHandle(effectiveLandingUrl);
  if (targetHandle && mediaHandle && targetHandle !== mediaHandle) {
    return {
      associated: false,
      matched: false,
      reason: `Media product handle '${mediaHandle}' conflicts with target product handle '${targetHandle}'.`,
    };
  }

  const targetDom = extractRegistrableDomain(targetStoreDomain || targetProductUrl);
  const mediaDom = extractRegistrableDomain(effectiveMediaDomain || effectiveLandingUrl);

  // If media comes from a merchant storefront URL (not fbcdn/tiktokcdn), verify domain matches target store
  const isSameOrSubdomain =
    targetDom &&
    mediaDom &&
    (targetDom === mediaDom ||
      mediaDom.endsWith(`.${targetDom}`) ||
      targetDom.endsWith(`.${mediaDom}`));

  if (
    targetDom &&
    mediaDom &&
    !mediaDom.includes("fbcdn.net") &&
    !mediaDom.includes("facebook.com") &&
    !mediaDom.includes("shopify.com") &&
    !mediaDom.includes("tiktokcdn") &&
    !isSameOrSubdomain
  ) {
    return {
      associated: false,
      matched: false,
      reason: `Media storefront domain '${mediaDom}' conflicts with target store domain '${targetDom}'.`,
    };
  }

  return {
    associated: true,
    matched: true,
    reason: "Verified product identity and storefront lineage match.",
  };
}

function makeMediaId(prefix: string, productId: string, dedupeKey: string): string {
  const hash = crypto
    .createHash("sha256")
    .update(`${productId}::${dedupeKey}`)
    .digest("hex")
    .slice(0, 10);
  return `${prefix}_${hash}`;
}

type PartialMediaItemInput = Omit<
  ProductMediaItem,
  | "id"
  | "dedupeKey"
  | "mediaType"
  | "url"
  | "thumbnailUrl"
  | "isEmbed"
  | "sourceType"
  | "sourcePageUrl"
  | "storeDomain"
  | "advertiserName"
> & {
  storeDomain?: string | null;
  advertiserName?: string | null;
};

/**
 * Resolves, validates, orders, and deduplicates authentic product media items for a product.
 * Supports both flat ProductMediaResolutionInput and nested { product, candidate, latestLandingPage, offerSnapshots, linkedCompetitorAds } objects.
 */
export function resolveProductMediaGallery(
  rawInput: ProductMediaResolutionInput | Record<string, any>
): ProductMediaResolutionResult {
  const nestedProduct = (rawInput as any).product || null;
  const nestedCandidate = (rawInput as any).candidate || null;
  const nestedLandingPage = (rawInput as any).latestLandingPage || null;
  const nestedOfferSnapshots: any[] = Array.isArray((rawInput as any).offerSnapshots)
    ? (rawInput as any).offerSnapshots
    : [];
  const linkedCompetitorAds: any[] = Array.isArray((rawInput as any).linkedCompetitorAds)
    ? (rawInput as any).linkedCompetitorAds
    : [];

  let extractedLandingImages: string[] = Array.isArray(rawInput.landingPageImageUrls)
    ? [...rawInput.landingPageImageUrls]
    : [];
  if (nestedLandingPage?.observationsJson) {
    try {
      const obs =
        typeof nestedLandingPage.observationsJson === "string"
          ? JSON.parse(nestedLandingPage.observationsJson)
          : nestedLandingPage.observationsJson;
      if (Array.isArray(obs?.imageUrls)) extractedLandingImages.push(...obs.imageUrls);
      if (Array.isArray(obs?.galleryUrls)) extractedLandingImages.push(...obs.galleryUrls);
      if (typeof obs?.ogImage === "string") extractedLandingImages.push(obs.ogImage);
    } catch {}
  }
  for (const snap of nestedOfferSnapshots) {
    if (typeof snap?.imageUrl === "string" && snap.imageUrl.trim()) {
      extractedLandingImages.push(snap.imageUrl.trim());
    }
  }

  const mergedAdLinks = [
    ...(Array.isArray(rawInput.adLinks) ? rawInput.adLinks : []),
    ...(Array.isArray(nestedProduct?.adLinks) ? nestedProduct.adLinks : []),
    ...linkedCompetitorAds.map((ad: any) => ({
      adId: ad.id,
      productId: nestedProduct?.id || rawInput.productId,
      confidence: "OBSERVED",
      ad,
    })),
  ];

  const input: ProductMediaResolutionInput = {
    ...(rawInput as ProductMediaResolutionInput),
    productId:
      rawInput.productId ||
      nestedProduct?.id ||
      nestedCandidate?.researchProductId ||
      nestedCandidate?.candidateId ||
      "unknown_product",
    productTitle:
      rawInput.productTitle ||
      nestedProduct?.title ||
      nestedCandidate?.merchantVerifiedProductName ||
      nestedCandidate?.canonicalProductName ||
      nestedCandidate?.title ||
      "Product",
    productUrl: rawInput.productUrl ?? nestedProduct?.productUrl ?? null,
    canonicalProductUrl:
      rawInput.canonicalProductUrl ??
      nestedCandidate?.canonicalProductUrl ??
      nestedProduct?.productUrl ??
      null,
    productImageUrl:
      rawInput.productImageUrl ??
      nestedProduct?.productImageUrl ??
      nestedProduct?.imageUrl ??
      null,
    storeDomain:
      rawInput.storeDomain ??
      nestedProduct?.store?.domain ??
      nestedCandidate?.storeDomain ??
      null,
    identityStatus:
      rawInput.identityStatus ?? nestedCandidate?.identityStatus ?? null,
    fetchOutcome:
      rawInput.fetchOutcome ??
      nestedCandidate?.fetchOutcome ??
      nestedCandidate?.identityEvidence?.fetchOutcome ??
      null,
    candidateId: rawInput.candidateId ?? nestedCandidate?.candidateId ?? null,
    researchRunId: rawInput.researchRunId ?? null,
    candidateTitle:
      rawInput.candidateTitle ??
      nestedCandidate?.merchantVerifiedProductName ??
      nestedCandidate?.canonicalProductName ??
      nestedCandidate?.title ??
      null,
    candidateCanonicalUrl:
      rawInput.candidateCanonicalUrl ??
      nestedCandidate?.canonicalProductUrl ??
      null,
    candidateStoreDomain:
      rawInput.candidateStoreDomain ?? nestedCandidate?.storeDomain ?? null,
    candidateThumbnailUrl:
      rawInput.candidateThumbnailUrl ?? nestedCandidate?.thumbnailUrl ?? null,
    candidateVideoUrl:
      rawInput.candidateVideoUrl ?? nestedCandidate?.videoUrl ?? null,
    candidateMediaSourceAdId:
      rawInput.candidateMediaSourceAdId ??
      nestedCandidate?.mediaSourceAdId ??
      null,
    candidateImageReferences:
      rawInput.candidateImageReferences ??
      nestedCandidate?.imageReferences ??
      null,
    candidateSupportingAdIds:
      rawInput.candidateSupportingAdIds ??
      nestedCandidate?.supportingAdIds ??
      null,
    landingPageImageUrls:
      extractedLandingImages.length > 0 ? extractedLandingImages : null,
    adLinks: mergedAdLinks.length > 0 ? mergedAdLinks : null,
  };

  const mediaItems: ProductMediaItem[] = [];
  const rejectedItems: ProductMediaRejectionRecord[] = [];
  const seenDedupeKeys = new Set<string>();
  let deduplicatedCount = 0;

  const productId = input.productId;
  const candidateId = input.candidateId || null;
  const researchRunId = input.researchRunId || null;
  const displayTitle = (input.candidateTitle || input.productTitle || "Product").trim();
  const canonicalUrl =
    input.candidateCanonicalUrl || input.canonicalProductUrl || input.productUrl || null;
  const storeDomain =
    extractRegistrableDomain(input.candidateStoreDomain || input.storeDomain || canonicalUrl) ||
    null;

  const isMerchantPageVerified =
    input.identityStatus === "VERIFIED" ||
    input.fetchOutcome === "VERIFIED_PRODUCT_PAGE" ||
    Boolean(
      canonicalUrl &&
        /\/products\/[a-z0-9_-]+/i.test(canonicalUrl) &&
        input.fetchOutcome !== "HTTP_ERROR"
    );

  const tryAddMediaItem = (item: PartialMediaItemInput) => {
    const primaryUrl = item.videoUrl || item.embedUrl || item.imageUrl || item.posterUrl;
    if (!primaryUrl) {
      rejectedItems.push({
        rawUrl: null,
        source: item.source,
        reasonCode: "MISSING_MEDIA_URL",
        reason: "Media record has no image, video, or embed URL.",
      });
      return;
    }

    const dedupeKey = buildCanonicalMediaDedupeKey(primaryUrl, item.kind);
    if (seenDedupeKeys.has(dedupeKey)) {
      deduplicatedCount++;
      rejectedItems.push({
        rawUrl: primaryUrl,
        source: item.source,
        reasonCode: "DUPLICATE_MEDIA",
        reason: `Deduplicated identical media asset (${dedupeKey}).`,
      });
      return;
    }
    seenDedupeKeys.add(dedupeKey);

    const mediaType: "IMAGE" | "VIDEO" =
      item.kind === "AD_VIDEO" || item.kind === "PRODUCT_VIDEO" ? "VIDEO" : "IMAGE";

    mediaItems.push({
      ...item,
      id: makeMediaId("media", productId, dedupeKey),
      dedupeKey,
      mediaType,
      url: primaryUrl,
      thumbnailUrl: item.posterUrl || item.imageUrl || null,
      isEmbed: Boolean(item.embedUrl),
      sourceType: item.source,
      sourcePageUrl: item.sourceUrl,
      storeDomain: item.storeDomain ?? storeDomain,
      advertiserName: item.advertiserName ?? null,
    });
  };

  // -------------------------------------------------------------------------
  // PRIORITY 1 & 2: Verified Merchant Product Images & Gallery
  // -------------------------------------------------------------------------
  const merchantImageCandidates: Array<{
    url: string;
    origin: "CANDIDATE_REF" | "PRODUCT_RECORD" | "LANDING_SNAPSHOT";
  }> = [];

  if (input.productImageUrl) {
    merchantImageCandidates.push({ url: input.productImageUrl, origin: "PRODUCT_RECORD" });
  }
  if (Array.isArray(input.candidateImageReferences)) {
    for (const ref of input.candidateImageReferences) {
      if (ref) merchantImageCandidates.push({ url: ref, origin: "CANDIDATE_REF" });
    }
  }
  if (Array.isArray(input.landingPageImageUrls)) {
    for (const lpImg of input.landingPageImageUrls) {
      if (lpImg) merchantImageCandidates.push({ url: lpImg, origin: "LANDING_SNAPSHOT" });
    }
  }

  let merchantImgIdx = 0;
  for (const candImg of merchantImageCandidates) {
    const val = validateAndNormalizeMediaUrl(candImg.url);
    if (!val.valid || !val.normalizedUrl) {
      rejectedItems.push({
        rawUrl: candImg.url,
        source: "MERCHANT_PRODUCT_PAGE",
        reasonCode: val.rejectionCode || "MALFORMED_URL",
        reason: val.rejectionReason || "Invalid merchant image URL.",
      });
      continue;
    }

    // Verify merchant domain association
    const assoc = verifyMediaBelongsToProduct({
      targetProductId: productId,
      targetProductUrl: canonicalUrl,
      targetStoreDomain: storeDomain,
      mediaLandingUrl: canonicalUrl,
      mediaDomain: val.hostname,
    });
    if (!assoc.associated) {
      rejectedItems.push({
        rawUrl: candImg.url,
        source: "MERCHANT_PRODUCT_PAGE",
        reasonCode: "CROSS_PRODUCT_CONTAMINATION",
        reason: assoc.reason,
      });
      continue;
    }

    const isPrimaryMerchant = merchantImgIdx === 0;
    merchantImgIdx++;

    tryAddMediaItem({
      productId,
      candidateId,
      researchRunId,
      kind: "PRODUCT_IMAGE",
      imageUrl: val.normalizedUrl,
      videoUrl: null,
      embedUrl: null,
      posterUrl: val.normalizedUrl,
      title: isPrimaryMerchant
        ? `${displayTitle} — Merchant Product Image`
        : `${displayTitle} — Merchant Gallery #${merchantImgIdx}`,
      altText: `${displayTitle} product photo from ${storeDomain || "merchant storefront"}`,
      source: isPrimaryMerchant ? "MERCHANT_PRODUCT_PAGE" : "MERCHANT_GALLERY",
      sourceLabel: isPrimaryMerchant ? "Merchant Product Image" : "Merchant Gallery Image",
      sourceUrl: canonicalUrl,
      sourceAdId: null,
      availability: val.isExpiredToken
        ? "EXPIRED"
        : isMerchantPageVerified
        ? "READY"
        : "UNVERIFIED",
      verifiedProductAssociation: true,
      associationReason: assoc.reason,
      width: null,
      height: null,
      aspectRatio: "1:1",
      durationSeconds: null,
      observedAt: null,
    });
  }

  // -------------------------------------------------------------------------
  // PRIORITY 3: Candidate-Specific Thumbnail & Video from Authoritative KH-02 Run
  // -------------------------------------------------------------------------
  if (input.candidateThumbnailUrl) {
    const thumbVal = validateAndNormalizeMediaUrl(input.candidateThumbnailUrl);
    if (!thumbVal.valid || !thumbVal.normalizedUrl) {
      rejectedItems.push({
        rawUrl: input.candidateThumbnailUrl,
        source: "KH02_CANDIDATE",
        reasonCode: thumbVal.rejectionCode || "MALFORMED_URL",
        reason: thumbVal.rejectionReason || "Invalid candidate thumbnail URL.",
      });
    } else {
      const assoc = verifyMediaBelongsToProduct({
        targetProductId: productId,
        targetProductUrl: canonicalUrl,
        targetStoreDomain: storeDomain,
        mediaLandingUrl: input.candidateCanonicalUrl || canonicalUrl,
      });
      if (!assoc.associated) {
        rejectedItems.push({
          rawUrl: input.candidateThumbnailUrl,
          source: "KH02_CANDIDATE",
          reasonCode: "CROSS_PRODUCT_CONTAMINATION",
          reason: assoc.reason,
        });
      } else {
        const isMetaThumb = /fbcdn\.net|facebook\.com/i.test(thumbVal.normalizedUrl);
        tryAddMediaItem({
          productId,
          candidateId,
          researchRunId,
          kind: "AD_IMAGE",
          imageUrl: thumbVal.normalizedUrl,
          videoUrl: null,
          embedUrl: null,
          posterUrl: thumbVal.normalizedUrl,
          title: `${displayTitle} — Research Candidate Creative`,
          altText: `${displayTitle} observed advertising thumbnail`,
          source: isMetaThumb ? "META_AD_CREATIVE" : "KH02_CANDIDATE",
          sourceLabel: "Meta Ad Creative",
          sourceUrl: canonicalUrl,
          sourceAdId: input.candidateMediaSourceAdId || input.candidateSupportingAdIds?.[0] || null,
          availability: thumbVal.isExpiredToken ? "EXPIRED" : "READY",
          verifiedProductAssociation: true,
          associationReason: "Directly bound to selected KH-02 candidate observation.",
          width: null,
          height: null,
          aspectRatio: "1:1",
          durationSeconds: null,
          observedAt: null,
        });
      }
    }
  }

  if (input.candidateVideoUrl) {
    const vidVal = validateAndNormalizeMediaUrl(input.candidateVideoUrl, "VIDEO");
    if (!vidVal.valid || !vidVal.normalizedUrl) {
      rejectedItems.push({
        rawUrl: input.candidateVideoUrl,
        source: "KH02_CANDIDATE",
        reasonCode: vidVal.rejectionCode || "MALFORMED_URL",
        reason: vidVal.rejectionReason || "Invalid candidate video URL.",
      });
    } else {
      const posterVal = input.candidateThumbnailUrl
        ? validateAndNormalizeMediaUrl(input.candidateThumbnailUrl)
        : null;
      tryAddMediaItem({
        productId,
        candidateId,
        researchRunId,
        kind: "AD_VIDEO",
        imageUrl: posterVal?.valid ? posterVal.normalizedUrl : null,
        videoUrl: vidVal.isEmbed ? null : vidVal.normalizedUrl,
        embedUrl: vidVal.isEmbed ? vidVal.normalizedUrl : null,
        posterUrl: posterVal?.valid ? posterVal.normalizedUrl : null,
        title: `${displayTitle} — Product Demonstration Video`,
        altText: `${displayTitle} video demonstration from ad creative`,
        source: "META_AD_CREATIVE",
        sourceLabel: "Meta Ad Video Creative",
        sourceUrl: canonicalUrl,
        sourceAdId: input.candidateMediaSourceAdId || input.candidateSupportingAdIds?.[0] || null,
        availability: vidVal.isExpiredToken ? "EXPIRED" : "READY",
        verifiedProductAssociation: true,
        associationReason: "Directly bound to selected KH-02 candidate video observation.",
        width: null,
        height: null,
        aspectRatio: "9:16",
        durationSeconds: null,
        observedAt: null,
      });
    }
  }

  // Convert shorthand adCreativeMedia entries into normalized adLinks entries
  const normalizedAdLinks = [...(input.adLinks || [])];
  if (Array.isArray(input.adCreativeMedia)) {
    for (let i = 0; i < input.adCreativeMedia.length; i++) {
      const m = input.adCreativeMedia[i];
      if (!m) continue;
      const isVid = (m.mediaType || "").toUpperCase() === "VIDEO" || Boolean(m.videoUrl);
      normalizedAdLinks.push({
        adId: m.adId || `ad_short_${i}`,
        productId,
        confidence: "CONFIRMED",
        ad: {
          id: m.adId || `ad_short_${i}`,
          externalAdId: m.adId || `ad_short_${i}`,
          advertiserName: m.advertiserName || null,
          landingPageUrl: m.landingPageUrl || canonicalUrl,
          originalAdUrl: m.originalAdUrl || m.landingPageUrl || canonicalUrl,
          mediaAssets: [
            {
              id: `asset_short_${i}`,
              mediaType: isVid ? "VIDEO" : "IMAGE",
              videoUrl: isVid ? m.videoUrl || m.url || null : null,
              embedUrl: m.embedUrl || null,
              thumbnailUrl: isVid
                ? m.thumbnailUrl || null
                : m.imageUrl || m.url || m.thumbnailUrl || null,
              availability: m.availability || "READY",
            },
          ],
        },
      });
    }
  }

  // -------------------------------------------------------------------------
  // PRIORITY 4 & 5: Explicitly Linked AdMediaAsset Records
  // -------------------------------------------------------------------------
  const allowedSupportingAdIds =
    Array.isArray(input.candidateSupportingAdIds) && input.candidateSupportingAdIds.length > 0
      ? new Set(input.candidateSupportingAdIds)
      : null;

  for (const link of normalizedAdLinks) {
    const ad = link?.ad;
    if (!ad) continue;

    // Safeguard: Verify link belongs to targetProductId
    if (link.productId && link.productId !== productId) {
      rejectedItems.push({
        rawUrl: ad.originalAdUrl || null,
        source: "META_AD_CREATIVE",
        reasonCode: "CROSS_PRODUCT_CONTAMINATION",
        reason: `AdProductLink belongs to product '${link.productId}', not '${productId}'.`,
      });
      continue;
    }

    // Verify ad landing page does not point to a different product handle or conflicting domain
    const assoc = verifyMediaBelongsToProduct({
      targetProductId: productId,
      targetProductUrl: canonicalUrl,
      targetStoreDomain: storeDomain,
      mediaOwnerProductId: link.productId || productId,
      mediaLandingUrl: ad.landingPageUrl,
    });
    if (!assoc.associated) {
      rejectedItems.push({
        rawUrl: ad.landingPageUrl || ad.originalAdUrl || null,
        source: "META_AD_CREATIVE",
        reasonCode: "CROSS_PRODUCT_CONTAMINATION",
        reason: assoc.reason,
      });
      continue;
    }

    // If an authoritative run specifies supportingAdIds, prioritize those first or verify confidence
    if (
      allowedSupportingAdIds &&
      !allowedSupportingAdIds.has(ad.id) &&
      (!ad.externalAdId || !allowedSupportingAdIds.has(ad.externalAdId)) &&
      link.confidence === "AMBIGUOUS"
    ) {
      rejectedItems.push({
        rawUrl: ad.originalAdUrl || null,
        source: "META_AD_CREATIVE",
        reasonCode: "UNVERIFIED_AD_ASSOCIATION",
        reason: `Ad '${ad.id}' has AMBIGUOUS confidence and is not in the active candidate's supportingAdIds.`,
      });
      continue;
    }

    const observedAt =
      ad.lastSeenAt instanceof Date
        ? ad.lastSeenAt.toISOString()
        : typeof ad.lastSeenAt === "string"
        ? ad.lastSeenAt
        : null;

    for (const asset of ad.mediaAssets || []) {
      const rawStatus = (asset.availability || "READY").toUpperCase();
      const thumbCheck = asset.thumbnailUrl
        ? validateAndNormalizeMediaUrl(asset.thumbnailUrl)
        : null;
      const videoCheck = asset.videoUrl
        ? validateAndNormalizeMediaUrl(asset.videoUrl, "VIDEO")
        : null;
      const embedCheck = asset.embedUrl
        ? validateAndNormalizeMediaUrl(asset.embedUrl, { isEmbed: true })
        : null;

      if (asset.thumbnailUrl && thumbCheck && !thumbCheck.valid) {
        rejectedItems.push({
          rawUrl: asset.thumbnailUrl,
          source: "META_AD_CREATIVE",
          reasonCode: thumbCheck.rejectionCode || "MALFORMED_URL",
          reason: thumbCheck.rejectionReason || "Invalid ad thumbnail URL.",
        });
      }
      if (asset.videoUrl && videoCheck && !videoCheck.valid) {
        rejectedItems.push({
          rawUrl: asset.videoUrl,
          source: "META_AD_CREATIVE",
          reasonCode: videoCheck.rejectionCode || "MALFORMED_URL",
          reason: videoCheck.rejectionReason || "Invalid ad video URL.",
        });
      }
      if (asset.embedUrl && embedCheck && !embedCheck.valid) {
        rejectedItems.push({
          rawUrl: asset.embedUrl,
          source: "META_AD_CREATIVE",
          reasonCode: embedCheck.rejectionCode || "UNTRUSTED_EMBED_ORIGIN",
          reason: embedCheck.rejectionReason || "Rejected untrusted embed URL.",
        });
      }

      const validThumb = thumbCheck?.valid ? thumbCheck.normalizedUrl : null;
      const validVideo =
        videoCheck?.valid && !videoCheck.isEmbed ? videoCheck.normalizedUrl : null;
      const validEmbed = embedCheck?.valid
        ? embedCheck.normalizedUrl
        : videoCheck?.valid && videoCheck.isEmbed
        ? videoCheck.normalizedUrl
        : null;

      let status: ProductMediaStatus = "READY";
      if (rawStatus === "EXPIRED" || videoCheck?.isExpiredToken || thumbCheck?.isExpiredToken) {
        status = "EXPIRED";
      } else if (rawStatus === "RESTRICTED") {
        status = "RESTRICTED";
      } else if (rawStatus === "FALLBACK_ONLY" && !validVideo && !validEmbed && !validThumb) {
        status = "UNAVAILABLE";
      } else if (rawStatus === "UNAVAILABLE") {
        status = "UNAVAILABLE";
      }

      const isVideoType =
        (asset.mediaType || "").toUpperCase() === "VIDEO" ||
        Boolean(validVideo) ||
        Boolean(validEmbed);

      if (
        isVideoType &&
        (validVideo ||
          validEmbed ||
          (validThumb && (status === "EXPIRED" || status === "RESTRICTED")))
      ) {
        tryAddMediaItem({
          productId,
          candidateId,
          researchRunId,
          kind: "AD_VIDEO",
          imageUrl: validThumb,
          videoUrl: status === "READY" ? validVideo : null,
          embedUrl: status === "READY" ? validEmbed : null,
          posterUrl: validThumb,
          title: ad.headline || `${displayTitle} — Ad Video Creative`,
          altText: `${displayTitle} ad creative video (${ad.externalAdId || ad.id})`,
          source: "META_AD_CREATIVE",
          sourceLabel:
            status === "EXPIRED"
              ? "Meta Ad Video (Expired — Poster Available)"
              : status === "RESTRICTED"
              ? "Meta Ad Video (Restricted — Poster Available)"
              : "Meta Ad Video Creative",
          sourceUrl: ad.originalAdUrl || ad.landingPageUrl || canonicalUrl,
          sourceAdId: ad.externalAdId || ad.id,
          advertiserName: ad.advertiserName || null,
          availability: status,
          verifiedProductAssociation: true,
          associationReason: `Linked via AdProductLink (${link.confidence || "CONFIRMED"}) to ad ${ad.externalAdId || ad.id}.`,
          width: asset.width ?? null,
          height: asset.height ?? null,
          aspectRatio: asset.aspectRatio || "9:16",
          durationSeconds: asset.durationSeconds ?? null,
          observedAt,
        });
      }

      // Also include the high-res ad image (when not purely a video poster, or when no other image exists yet)
      if (validThumb && (!isVideoType || mediaItems.every((m) => m.mediaType !== "IMAGE"))) {
        tryAddMediaItem({
          productId,
          candidateId,
          researchRunId,
          kind: "AD_IMAGE",
          imageUrl: validThumb,
          videoUrl: null,
          embedUrl: null,
          posterUrl: validThumb,
          title: ad.headline || `${displayTitle} — Ad Creative Still`,
          altText: `${displayTitle} ad creative image (${ad.externalAdId || ad.id})`,
          source: "META_AD_CREATIVE",
          sourceLabel: "Meta Ad Creative",
          sourceUrl: ad.originalAdUrl || ad.landingPageUrl || canonicalUrl,
          sourceAdId: ad.externalAdId || ad.id,
          advertiserName: ad.advertiserName || null,
          availability: thumbCheck?.isExpiredToken ? "EXPIRED" : "READY",
          verifiedProductAssociation: true,
          associationReason: `Linked via AdProductLink (${link.confidence || "CONFIRMED"}) to ad ${ad.externalAdId || ad.id}.`,
          width: asset.width ?? null,
          height: asset.height ?? null,
          aspectRatio: asset.aspectRatio || "1:1",
          durationSeconds: null,
          observedAt,
        });
      }
    }
  }

  // Sort media items by strict source priority:
  // 1. MERCHANT_PRODUCT_PAGE (READY/UNVERIFIED)
  // 2. MERCHANT_GALLERY
  // 3. KH02_CANDIDATE (PRODUCT_IMAGE / AD_IMAGE before AD_VIDEO)
  // 4. META_AD_CREATIVE (AD_IMAGE before AD_VIDEO)
  const sourceRank = (item: ProductMediaItem): number => {
    const availPenalty =
      item.availability === "READY" ? 0 : item.availability === "UNVERIFIED" ? 10 : 50;
    if (item.source === "MERCHANT_PRODUCT_PAGE") return 1 + availPenalty;
    if (item.source === "MERCHANT_GALLERY") return 2 + availPenalty;
    if (item.source === "KH02_CANDIDATE" && item.kind !== "AD_VIDEO") return 3 + availPenalty;
    if (item.source === "KH02_CANDIDATE" && item.kind === "AD_VIDEO") return 4 + availPenalty;
    if (item.source === "META_AD_CREATIVE" && item.kind === "AD_IMAGE") return 5 + availPenalty;
    if (item.source === "META_AD_CREATIVE" && item.kind === "AD_VIDEO") return 6 + availPenalty;
    return 10 + availPenalty;
  };

  mediaItems.sort((a, b) => sourceRank(a) - sourceRank(b));

  const cappedItems = mediaItems.slice(0, 16);

  const primaryMedia =
    cappedItems.find((m) => m.availability === "READY" || m.availability === "UNVERIFIED") ||
    cappedItems[0] ||
    null;

  const primaryImage =
    cappedItems.find(
      (m) => m.mediaType === "IMAGE" && (m.availability === "READY" || m.availability === "UNVERIFIED")
    ) ||
    cappedItems.find((m) => m.mediaType === "IMAGE") ||
    primaryMedia;

  const primaryVideo =
    cappedItems.find(
      (m) => m.mediaType === "VIDEO" && (m.availability === "READY" || m.availability === "UNVERIFIED")
    ) ||
    cappedItems.find((m) => m.mediaType === "VIDEO") ||
    null;

  const productImages = cappedItems.filter((m) => m.kind === "PRODUCT_IMAGE");
  const adCreatives = cappedItems.filter((m) => m.kind === "AD_IMAGE" || m.kind === "AD_VIDEO");
  const videoItems = cappedItems.filter(
    (m) => m.kind === "PRODUCT_VIDEO" || m.kind === "AD_VIDEO"
  );

  const merchantImageCount = cappedItems.filter(
    (m) => m.source === "MERCHANT_PRODUCT_PAGE" || m.source === "MERCHANT_GALLERY"
  ).length;
  const candidateMediaCount = cappedItems.filter((m) => m.source === "KH02_CANDIDATE").length;
  const adCreativeMediaCount = cappedItems.filter((m) => m.source === "META_AD_CREATIVE").length;
  const playableVideoCount = videoItems.filter(
    (m) => m.availability === "READY" && Boolean(m.videoUrl || m.embedUrl)
  ).length;
  const restrictedOrExpiredCount = cappedItems.filter(
    (m) =>
      m.availability === "EXPIRED" ||
      m.availability === "RESTRICTED" ||
      m.availability === "UNAVAILABLE"
  ).length;

  return {
    productId,
    candidateId,
    researchRunId,
    totalCount: cappedItems.length,
    hasImages: cappedItems.some((m) => m.mediaType === "IMAGE"),
    hasVideo: videoItems.length > 0,
    primaryMedia,
    primaryImage,
    primaryVideo,
    items: cappedItems,
    mediaItems: cappedItems,
    productImages,
    adCreatives,
    videoItems,
    emptyState: {
      isEmpty: cappedItems.length === 0,
      headline: "No verified product media available",
      explanation:
        "The product was identified, but no usable image or video could be verified from the linked sources.",
      merchantPageUrl: canonicalUrl,
      merchantUrl: canonicalUrl,
    },
    provenanceSummary: {
      totalResolved: cappedItems.length,
      merchantImageCount,
      candidateMediaCount,
      adCreativeMediaCount,
      playableVideoCount,
      restrictedOrExpiredCount,
      deduplicatedCount,
      rejectedCount: rejectedItems.length,
      primarySource: primaryMedia ? primaryMedia.source : "NONE",
    },
    rejectedItems,
  };
}
