/**
 * SWAI Product Identity & Competitor Intelligence Service
 *
 * KH-01.B — Product Identity & Competitor Offer Intelligence
 *
 * Core Principle:
 * Distinguishes three business entities:
 * 1. ADVERTISEMENT — specific creative, copy, library ID.
 * 2. PRODUCT — underlying physical or digital item.
 * 3. OFFER — commercial terms (pricing, bundle, shipping, guarantee).
 */

import { prisma } from "@/lib/db";
import {
  ResearchAccessContext,
  assertAdWorkspaceAccess,
  assertProductWorkspaceAccess,
} from "./researchAuthService";
import {
  canonicalizeProductUrl,
  matchExistingResearchProduct,
  extractDomainFromUrl,
} from "@/services/products/productService";
import { getAdvertisementDetails } from "@/services/ads/adService";

export interface ProductIdentityCandidate {
  adId: string;
  advertiserId: string | null;
  advertiserName: string | null;
  landingPageUrl: string | null;
  canonicalProductUrl: string | null;
  candidateTitle: string | null;
  storeDomain: string | null;
  identityConfidence: "EXACT" | "PROBABLE" | "AMBIGUOUS" | "INSUFFICIENT_EVIDENCE";
  existingProductLinks: { productId: string; title: string; confidence: string }[];
  supportingEvidenceIds: string[];
  unresolvedQuestions: string[];
}

export interface ProductIdentitySelection {
  action?: "LINK_EXISTING" | "CREATE_NEW";
  mode?: "LINK_EXISTING" | "CREATE_NEW";
  targetProductId?: string;
  customTitle?: string;
  title?: string;
  category?: string;
  description?: string;
}

export interface ProductAdvertisingProfile {
  productId: string;
  productTitle: string;
  storeDomain: string | null;
  totalLinkedAds: number;
  distinctAdvertisers: { id: string; name: string }[];
  distinctStores: { id: string; domain: string }[];
  distinctCreativeFormats: string[];
  observedLandingPages: string[];
  earliestReportedStartAt: string | null;
  firstObservedAt: string | null;
  latestObservedAt: string | null;
  verifiedActiveObservationsCount: number;
  unverifiedObservationsCount: number;
  ads: {
    id: string;
    externalAdId: string;
    headline: string | null;
    status: string;
    format: string;
    firstSeenAt: string | null;
    lastSeenAt: string | null;
  }[];
}

/**
 * Extracts a candidate product identity from a verified competitor advertisement.
 */
export async function extractProductIdentityCandidate(
  adId: string,
  context: ResearchAccessContext
): Promise<ProductIdentityCandidate> {
  await assertAdWorkspaceAccess(adId, context);

  const ad = await getAdvertisementDetails(adId);
  if (!ad) {
    throw new Error(`Advertisement '${adId}' not found.`);
  }

  const landingPageUrl = ad.landingPageUrl || null;
  let canonicalProductUrl: string | null = null;
  let storeDomain: string | null = null;

  if (landingPageUrl) {
    try {
      const canonical = canonicalizeProductUrl(landingPageUrl);
      canonicalProductUrl = canonical.canonicalUrl;
      storeDomain = canonical.hostname;
    } catch {
      storeDomain = extractDomainFromUrl(landingPageUrl);
    }
  }

  // Derive candidate title from existing links or ad headline
  const existingLinks = (ad.productLinks || []).map((l: any) => ({
    productId: l.product?.id || l.productId,
    title: l.product?.title || "Tracked Product",
    confidence: l.confidence,
  }));

  let candidateTitle: string | null = null;
  let identityConfidence: ProductIdentityCandidate["identityConfidence"] = "INSUFFICIENT_EVIDENCE";
  const unresolvedQuestions: string[] = [];

  if (existingLinks.length > 0) {
    candidateTitle = existingLinks[0].title;
    const topConfidence = existingLinks[0].confidence;
    if (topConfidence === "CONFIRMED" || topConfidence === "VERIFIED" || topConfidence === "EXACT") {
      identityConfidence = "EXACT";
    } else {
      identityConfidence = "PROBABLE";
      unresolvedQuestions.push(
        `Existing product link has confidence '${topConfidence}' and requires verified confirmation.`
      );
    }
  } else if (landingPageUrl && canonicalProductUrl) {
    // Check if landing page points to a specific product path
    const path = new URL(canonicalProductUrl).pathname;
    if (path.includes("/products/") || path.includes("/product/")) {
      const slug = path.split("/products/")[1]?.split("/")[0] || path.split("/product/")[1]?.split("/")[0];
      if (slug) {
        candidateTitle = slug
          .replace(/[-_]/g, " ")
          .replace(/\b\w/g, (c) => c.toUpperCase());
        identityConfidence = "PROBABLE";
      }
    } else {
      unresolvedQuestions.push(
        "Landing page appears to be a homepage or collection, not a direct single product page."
      );
      identityConfidence = "AMBIGUOUS";
    }
  }

  if (!candidateTitle && ad.headline) {
    // Avoid using URL string as headline
    if (!ad.headline.toLowerCase().startsWith("http")) {
      candidateTitle = ad.headline;
      if (identityConfidence === "INSUFFICIENT_EVIDENCE") {
        identityConfidence = "PROBABLE";
      }
    }
  }

  if (!storeDomain) {
    unresolvedQuestions.push("Store domain could not be resolved from advertisement link.");
  }

  return {
    adId: ad.id,
    advertiserId: ad.advertiserId || null,
    advertiserName: ad.advertiser?.name || null,
    landingPageUrl,
    canonicalProductUrl,
    candidateTitle,
    storeDomain,
    identityConfidence,
    existingProductLinks: existingLinks,
    supportingEvidenceIds: [],
    unresolvedQuestions,
  };
}

/**
 * Resolves or creates a CompetitorStore for a given product or storefront domain.
 */
export async function resolveCompetitorStore(
  productUrl: string,
  evidenceIndicators: string[] = []
): Promise<{ storeId: string; domain: string; storeName: string | null; platform: string; isNew: boolean }> {
  let domain = extractDomainFromUrl(productUrl);
  if (!domain) {
    throw new Error(`Cannot resolve valid store domain from URL: '${productUrl}'.`);
  }
  domain = domain.toLowerCase().replace(/^www\./, "").trim();

  let existing = await prisma.competitorStore.findUnique({
    where: { domain },
  });

  if (existing) {
    return {
      storeId: existing.id,
      domain: existing.domain,
      storeName: existing.storeName,
      platform: existing.commercePlatform,
      isNew: false,
    };
  }

  const isMyshopify = domain.endsWith(".myshopify.com") || domain === "myshopify.com";
  const created = await prisma.competitorStore.create({
    data: {
      domain,
      storeName: domain.split(".")[0].toUpperCase(),
      commercePlatform: isMyshopify ? "SHOPIFY_CONFIRMED" : "SHOPIFY_POSSIBLE",
    },
  });

  return {
    storeId: created.id,
    domain: created.domain,
    storeName: created.storeName,
    platform: created.commercePlatform,
    isNew: true,
  };
}

/**
 * Resolves or creates a canonical ResearchProduct entity based on verified candidate identity
 * and optional explicit user confirmation.
 */
export async function resolveOrCreateResearchProduct(
  candidate: ProductIdentityCandidate,
  selection: ProductIdentitySelection,
  context: ResearchAccessContext
): Promise<{ productId: string; title: string; isNew: boolean }> {
  await assertAdWorkspaceAccess(candidate.adId, context);

  const action = selection.action || selection.mode || "AUTO";
  const customTitle = selection.customTitle || selection.title;

  // Path A: Explicit link to an existing product
  if (action === "LINK_EXISTING") {
    if (!selection.targetProductId) {
      throw new Error("Missing targetProductId for LINK_EXISTING action.");
    }
    // Strict tenant boundary check: assert that target product belongs to authorized workspace
    await assertProductWorkspaceAccess(selection.targetProductId, context);

    return await prisma.$transaction(async (tx) => {
      const existingProduct = await tx.researchProduct.findUnique({
        where: { id: selection.targetProductId },
      });
      if (!existingProduct) {
        throw new Error(`Target product '${selection.targetProductId}' not found.`);
      }

      // Attach link if not already linked
      const link = await tx.adProductLink.findUnique({
        where: {
          adId_productId: {
            adId: candidate.adId,
            productId: existingProduct.id,
          },
        },
      });
      if (!link) {
        await tx.adProductLink.create({
          data: {
            adId: candidate.adId,
            productId: existingProduct.id,
            confidence: "CONFIRMED",
          },
        });
      }

      return {
        productId: existingProduct.id,
        title: existingProduct.title,
        isNew: false,
      };
    });
  }

  // Path B: Automatic matching before creating new (only if not explicitly CREATE_NEW)
  if (action !== "CREATE_NEW") {
    const match = await matchExistingResearchProduct(candidate, context.workspaceId);
    if (match.confidence === "EXACT_MATCH" && match.matchedProduct) {
      return await prisma.$transaction(async (tx) => {
        const link = await tx.adProductLink.findUnique({
          where: {
            adId_productId: {
              adId: candidate.adId,
              productId: match.matchedProduct!.id,
            },
          },
        });
        if (!link) {
          await tx.adProductLink.create({
            data: {
              adId: candidate.adId,
              productId: match.matchedProduct!.id,
              confidence: "CONFIRMED",
            },
          });
        }
        return {
          productId: match.matchedProduct!.id,
          title: match.matchedProduct!.title,
          isNew: false,
        };
      });
    }
  }

  // Path C: Create new canonical ResearchProduct
  return await prisma.$transaction(async (tx) => {
    let storeId: string | null = null;
    if (candidate.storeDomain) {
      let store = await tx.competitorStore.findUnique({
        where: { domain: candidate.storeDomain },
      });
      if (!store) {
        store = await tx.competitorStore.create({
          data: {
            domain: candidate.storeDomain,
            storeName: candidate.advertiserName || candidate.storeDomain.split(".")[0],
            commercePlatform: candidate.storeDomain.includes("myshopify")
              ? "SHOPIFY_CONFIRMED"
              : "SHOPIFY_POSSIBLE",
          },
        });
      }
      storeId = store.id;
    }

    const title =
      customTitle?.trim() ||
      candidate.candidateTitle?.trim() ||
      "New Product Candidate";

    const newProduct = await tx.researchProduct.create({
      data: {
        storeId,
        title,
        category: selection.category || "Other",
        description: selection.description || null,
        productUrl: candidate.canonicalProductUrl || candidate.landingPageUrl || null,
      },
    });

    // Attach ad link
    await tx.adProductLink.create({
      data: {
        adId: candidate.adId,
        productId: newProduct.id,
        confidence: candidate.canonicalProductUrl ? "CONFIRMED" : "PROBABLE",
      },
    });

    return {
      productId: newProduct.id,
      title: newProduct.title,
      isNew: true,
    };
  });
}

/**
 * Attaches a competitor ad to a ResearchProduct.
 */
export async function attachAdvertisementToProduct(
  adId: string,
  productId: string,
  evidenceIds: string[],
  context: ResearchAccessContext
) {
  await assertAdWorkspaceAccess(adId, context);
  await assertProductWorkspaceAccess(productId, context);

  return await prisma.adProductLink.upsert({
    where: {
      adId_productId: {
        adId,
        productId,
      },
    },
    update: {
      confidence: "CONFIRMED",
    },
    create: {
      adId,
      productId,
      confidence: "CONFIRMED",
    },
  });
}

/**
 * Aggregates all advertising intelligence across ads linked to a genuine product.
 */
export async function getProductAdvertisingProfile(
  productId: string
): Promise<ProductAdvertisingProfile> {
  const product = await prisma.researchProduct.findUnique({
    where: { id: productId },
    include: {
      store: true,
      adLinks: {
        include: {
          ad: {
            include: {
              advertiser: true,
              mediaAssets: true,
              observations: true,
            },
          },
        },
      },
    },
  });

  if (!product) {
    throw new Error(`Product '${productId}' not found.`);
  }

  const distinctAdvertisersMap = new Map<string, string>();
  const distinctStoresMap = new Map<string, string>();
  const distinctFormats = new Set<string>();
  const observedLandingPages = new Set<string>();
  const seenLibraryIds = new Set<string>();

  let earliestStart: Date | null = null;
  let firstObserved: Date | null = null;
  let latestObserved: Date | null = null;
  let verifiedActiveCount = 0;
  let unverifiedCount = 0;

  const adsSummary: ProductAdvertisingProfile["ads"] = [];

  for (const link of product.adLinks) {
    const ad = link.ad;
    if (!ad) continue;

    const externalId = ad.externalAdId || ad.id;
    // Deduplicate Library IDs
    if (seenLibraryIds.has(externalId)) {
      continue;
    }
    seenLibraryIds.add(externalId);

    if (ad.advertiser) {
      distinctAdvertisersMap.set(ad.advertiser.id, ad.advertiser.name);
    }
    if (product.store) {
      distinctStoresMap.set(product.store.id, product.store.domain);
    }
    const format = ad.mediaAssets[0]?.mediaType || "IMAGE";
    distinctFormats.add(format);
    if (ad.landingPageUrl) observedLandingPages.add(ad.landingPageUrl);

    if (ad.status === "ACTIVE") {
      verifiedActiveCount += ad.verifiedActiveCount || 1;
    } else {
      unverifiedCount++;
    }

    if (ad.firstSeenAt) {
      const d = new Date(ad.firstSeenAt);
      if (!firstObserved || d < firstObserved) firstObserved = d;
      if (!earliestStart || d < earliestStart) earliestStart = d;
    }
    if (ad.lastSeenAt) {
      const d = new Date(ad.lastSeenAt);
      if (!latestObserved || d > latestObserved) latestObserved = d;
    }

    adsSummary.push({
      id: ad.id,
      externalAdId: externalId,
      headline: ad.headline,
      status: ad.status,
      format,
      firstSeenAt: ad.firstSeenAt ? ad.firstSeenAt.toISOString() : null,
      lastSeenAt: ad.lastSeenAt ? ad.lastSeenAt.toISOString() : null,
    });
  }

  return {
    productId: product.id,
    productTitle: product.title,
    storeDomain: product.store?.domain || null,
    totalLinkedAds: adsSummary.length,
    distinctAdvertisers: Array.from(distinctAdvertisersMap.entries()).map(([id, name]) => ({
      id,
      name,
    })),
    distinctStores: Array.from(distinctStoresMap.entries()).map(([id, domain]) => ({
      id,
      domain,
    })),
    distinctCreativeFormats: Array.from(distinctFormats),
    observedLandingPages: Array.from(observedLandingPages),
    earliestReportedStartAt: earliestStart ? earliestStart.toISOString() : null,
    firstObservedAt: firstObserved ? firstObserved.toISOString() : null,
    latestObservedAt: latestObserved ? latestObserved.toISOString() : null,
    verifiedActiveObservationsCount: verifiedActiveCount,
    unverifiedObservationsCount: unverifiedCount,
    ads: adsSummary,
  };
}
