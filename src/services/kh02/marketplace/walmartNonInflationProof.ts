/**
 * KH-02 V12.4.3.5.1 — Non-Vacuous Score & Gate Non-Inflation Proof Engine
 *
 * Executes `runEvergreenProductResearch` twice on the SAME isolated workspace corpus
 * containing >= 3 distinct physical product candidates:
 *   1) `runOff`: `enableWalmartUsPilot: false` (`KH02_WALMART_US_ENABLED="false"`)
 *   2) `runOn`:  `enableWalmartUsPilot: true`  (`KH02_WALMART_US_ENABLED="true"`, `TEST_FIXTURE`)
 *
 * Matches every candidate by stable `candidateId` (never by array index alone) and proves:
 *   - `comparedCandidatesCount >= 3`
 *   - `candidateSetMatch === true`
 *   - `providerPathExercised === true`
 *   - `walmartEvidenceRowsExercised >= 1`
 *   - `scoreDeltaAbsMax === 0`
 *   - `rankingChanged === false`
 *   - `gateChanges === 0`
 *   - `g15PromotedCount === 0` and `g16PromotedCount === 0`
 */

import { prisma } from "@/lib/db";
import {
  runEvergreenProductResearch,
  type RankedLeaderboardItem,
} from "../evergreenResearchOrchestrator";
import type { ProductMetadataEvidence } from "../identity/productMetadataExtractor";
import type {
  EvidenceOrigin,
  MatchLevel as WalmartMatchLevel,
  MarketplacePresence as WalmartMarketplacePresence,
  WalmartQueryExecutionStatus,
} from "./walmartJinaTypes";
import {
  resetWalmartSharedHostGroupForTests,
  WALMART_COOLDOWN_PROVIDER_ID,
} from "./walmartJinaBudget";

export interface WalmartCandidateNonInflationDiff {
  candidateId: string;
  title: string;
  storeDomain: string | null;
  opportunityScoreOff: number;
  opportunityScoreOn: number;
  scoreDelta: number;
  evidenceConfidenceOff: number;
  evidenceConfidenceOn: number;
  confidenceDelta: number;
  rankOff: number | null;
  rankOn: number | null;
  rankDelta: number;
  orderIndexOff: number;
  orderIndexOn: number;
  orderIndexDelta: number;
  tierOff: string;
  tierOn: string;
  recommendationOff: string;
  recommendationOn: string;
  demandStabilityStatusOff: string;
  demandStabilityStatusOn: string;
  evergreenEligibleOff: boolean;
  evergreenEligibleOn: boolean;
  g15StatusOff: string;
  g15StatusOn: string;
  g16StatusOff: string;
  g16StatusOn: string;
  walmartQueryStatusOff: WalmartQueryExecutionStatus | "DISABLED";
  walmartQueryStatusOn: WalmartQueryExecutionStatus;
  walmartPresenceOn: WalmartMarketplacePresence;
  walmartMatchLevelOn: WalmartMatchLevel;
  walmartEvidenceOriginOn: EvidenceOrigin;
  walmartItemIdOn: string | null;
}

export interface WalmartNonInflationProofReport {
  evaluatedAt: string;
  workspaceId: string;
  topic: string;
  comparedCandidatesCount: number;
  candidateIdsOff: string[];
  candidateIdsOn: string[];
  candidateSetMatch: boolean;
  providerPathExercised: boolean;
  walmartLogicalOperationsUsedOn: number;
  walmartEvidenceRowsExercised: number;
  evidenceOrigins: EvidenceOrigin[];
  scoreDeltaAbsMax: number;
  confidenceDeltaAbsMax: number;
  rankingChanged: boolean;
  gateChanges: number;
  g15PromotedCount: number;
  g16PromotedCount: number;
  nonInflationVerified: boolean;
  perCandidateDiffs: WalmartCandidateNonInflationDiff[];
  diffs: WalmartCandidateNonInflationDiff[];
}

function collectOrderedScoredItems(res: Awaited<ReturnType<typeof runEvergreenProductResearch>>): RankedLeaderboardItem[] {
  const seen = new Set<string>();
  const ordered: RankedLeaderboardItem[] = [];
  const pools = [
    ...(res.topThree || []),
    ...(res.provisionalCandidates || []),
    ...(res.remainingCandidates || []),
    ...(res.insufficientEvidenceCandidates || []),
  ];
  for (const item of pools) {
    const cid = item?.candidate?.candidateId;
    if (!cid || seen.has(cid)) continue;
    seen.add(cid);
    ordered.push(item);
  }
  return ordered;
}

export async function proveWalmartNonInflationWithCandidates(options?: {
  workspacePrefix?: string;
}): Promise<WalmartNonInflationProofReport> {
  const prefix = options?.workspacePrefix || "ws_wmt_noninflation_proof";
  const suffix = `${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  const workspaceId = `${prefix}_${suffix}`;
  const runIdOff = `run_wmt_off_${suffix}`;
  const runIdOn = `run_wmt_on_${suffix}`;
  const discoveryRunId = `drun_wmt_noninf_${suffix}`;
  const dataSourceId = `ds_wmt_noninf_${suffix}`;

  const wrapNextData = (nextDataObj: Record<string, any>, title: string, targetUrl: string): string => {
    const html = `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"/><title>${title}</title></head><body><div id="__next"><h1>${title}</h1></div><script id="__NEXT_DATA__" type="application/json">${JSON.stringify(
      nextDataObj
    )}</script></body></html>`;
    return JSON.stringify({
      code: 200,
      status: 20000,
      data: {
        title,
        url: targetUrl,
        html,
        content: title,
      },
    });
  };

  const buildSearchChomChom = (q: string) =>
    wrapNextData(
      {
        buildId: "wmt-prod-20261101",
        page: "/search",
        query: { q },
        props: {
          pageProps: {
            initialData: {
              searchResult: {
                title: `Results for ${q}`,
                query: q,
                count: 1,
                aggregatedCount: 1,
                itemStacks: [
                  {
                    title: "Main Results",
                    items: [
                      {
                        __typename: "Product",
                        usItemId: "5184129384",
                        id: "CC5184129384",
                        name: "ChomChom Roller Pet Hair Remover Model CCR-2000",
                        brand: "ChomChom",
                        canonicalUrl: "/ip/ChomChom-Roller-Pet-Hair-Remover/5184129384",
                        sellerName: "Walmart.com",
                        availabilityStatusV2: { value: "IN_STOCK", display: "In stock" },
                        isSponsoredFlag: false,
                        priceInfo: {
                          currentPrice: {
                            price: 27.95,
                            priceString: "$27.95",
                            currencyUnit: "USD",
                          },
                        },
                      },
                    ],
                  },
                ],
              },
              location: { postalCode: "95829", storeIds: ["3081"] },
            },
          },
        },
      },
      `${q} - Walmart.com`,
      `https://www.walmart.com/search?q=${encodeURIComponent(q)}`
    );

  const pdpChomChom = wrapNextData(
    {
      buildId: "wmt-prod-20261101",
      page: "/ip/[id]",
      query: { id: "5184129384" },
      props: {
        pageProps: {
          initialData: {
            data: {
              product: {
                usItemId: "5184129384",
                id: "CC5184129384",
                name: "ChomChom Roller Pet Hair Remover Model CCR-2000",
                brand: "ChomChom",
                model: "CCR-2000",
                upc: "0856166005008",
                canonicalUrl: "/ip/ChomChom-Roller-Pet-Hair-Remover/5184129384",
                sellerName: "Walmart.com",
                availabilityStatus: "IN_STOCK",
                availabilityStatusV2: { value: "IN_STOCK", display: "In stock" },
                priceInfo: {
                  currentPrice: {
                    price: 27.95,
                    priceString: "$27.95",
                    currencyUnit: "USD",
                  },
                },
                location: { postalCode: "95829", storeIds: ["3081"] },
              },
            },
          },
        },
      },
    },
    "ChomChom Roller Pet Hair Remover Model CCR-2000 - Walmart.com",
    "https://www.walmart.com/ip/5184129384"
  );

  const buildSearchCatFountain = (q: string) =>
    wrapNextData(
      {
        buildId: "wmt-prod-20261101",
        page: "/search",
        query: { q },
        props: {
          pageProps: {
            initialData: {
              searchResult: {
                title: `Results for ${q}`,
                query: q,
                count: 1,
                aggregatedCount: 1,
                itemStacks: [
                  {
                    title: "Main Results",
                    items: [
                      {
                        __typename: "Product",
                        usItemId: "9081726354",
                        id: "UAH9081726354",
                        name: "Uahpet Cordless Stainless Steel Cat Water Fountain UWF-01",
                        brand: "Uahpet",
                        canonicalUrl: "/ip/Uahpet-Cat-Water-Fountain/9081726354",
                        sellerName: "Walmart.com",
                        availabilityStatusV2: { value: "IN_STOCK", display: "In stock" },
                        isSponsoredFlag: false,
                        priceInfo: {
                          currentPrice: {
                            price: 45.99,
                            priceString: "$45.99",
                            currencyUnit: "USD",
                          },
                        },
                      },
                    ],
                  },
                ],
              },
              location: { postalCode: "95829", storeIds: ["3081"] },
            },
          },
        },
      },
      `${q} - Walmart.com`,
      `https://www.walmart.com/search?q=${encodeURIComponent(q)}`
    );

  const pdpCatFountain = wrapNextData(
    {
      buildId: "wmt-prod-20261101",
      page: "/ip/[id]",
      query: { id: "9081726354" },
      props: {
        pageProps: {
          initialData: {
            data: {
              product: {
                usItemId: "9081726354",
                id: "UAH9081726354",
                name: "Uahpet Cordless Stainless Steel Cat Water Fountain UWF-01",
                brand: "Uahpet",
                model: "UWF-01",
                upc: "0742832119023",
                canonicalUrl: "/ip/Uahpet-Cat-Water-Fountain/9081726354",
                sellerName: "Walmart.com",
                availabilityStatus: "IN_STOCK",
                availabilityStatusV2: { value: "IN_STOCK", display: "In stock" },
                priceInfo: {
                  currentPrice: {
                    price: 45.99,
                    priceString: "$45.99",
                    currencyUnit: "USD",
                  },
                },
                location: { postalCode: "95829", storeIds: ["3081"] },
              },
            },
          },
        },
      },
    },
    "Uahpet Cordless Stainless Steel Cat Water Fountain UWF-01 - Walmart.com",
    "https://www.walmart.com/ip/9081726354"
  );

  const buildSearchNoMatch = (q: string) =>
    wrapNextData(
      {
        buildId: "wmt-prod-20261101",
        page: "/search",
        query: { q },
        props: {
          pageProps: {
            initialData: {
              searchResult: {
                title: `Results for ${q}`,
                query: q,
                count: 0,
                aggregatedCount: 0,
                itemStacks: [{ title: "Main Results", items: [] }],
              },
              location: { postalCode: "95829", storeIds: ["3081"] },
            },
          },
        },
      },
      `${q} - Walmart.com`,
      `https://www.walmart.com/search?q=${encodeURIComponent(q)}`
    );

  const productsSeed = [
    {
      advId: `adv_cc_${suffix}`,
      advName: "ChomChom Roller Official",
      storeId: `store_cc_${suffix}`,
      domain: "chomchomroller.com",
      prodId: `prod_cc_${suffix}`,
      title: "ChomChom Roller Pet Hair Remover Model CCR-2000",
      handle: "chomchom-roller-pet-hair-remover",
      url: "https://chomchomroller.com/products/chomchom-roller-pet-hair-remover",
      brand: "ChomChom",
      model: "CCR-2000",
      sku: "CCR-2000",
      gtin: "0856166005008",
      price: "27.95",
      adHeadline1: "ChomChom Roller Pet Hair Remover Model CCR-2000 Reusable Lint Roller",
      adBody1: "Remove dog and cat hair from couches, beds, carpets and blankets with the ChomChom Roller CCR-2000 pet gadget.",
      adHeadline2: "Original ChomChom Roller CCR-2000 Pet Hair Remover for Furniture",
      adBody2: "No sticky tape or refills needed. Reusable pet hair remover roller for pet owners.",
    },
    {
      advId: `adv_uah_${suffix}`,
      advName: "Uahpet Official Store",
      storeId: `store_uah_${suffix}`,
      domain: "uahpet.com",
      prodId: `prod_uah_${suffix}`,
      title: "Uahpet Cordless Stainless Steel Cat Water Fountain UWF-01",
      handle: "uahpet-cordless-stainless-steel-cat-water-fountain",
      url: "https://uahpet.com/products/uahpet-cordless-stainless-steel-cat-water-fountain",
      brand: "Uahpet",
      model: "UWF-01",
      sku: "UWF-01",
      gtin: "0742832119023",
      price: "45.99",
      adHeadline1: "Uahpet Cordless Stainless Steel Cat Water Fountain UWF-01 Motion Sensor",
      adBody1: "Keep your cat hydrated with the Uahpet UWF-01 cordless stainless steel automatic pet water fountain.",
      adHeadline2: "Wireless Automatic Cat Water Fountain Uahpet UWF-01 67oz Battery Operated",
      adBody2: "Ultra-quiet motion-activated stainless steel cat water dispenser for pets.",
    },
    {
      advId: `adv_lr_${suffix}`,
      advName: "Whisker Litter-Robot",
      storeId: `store_lr_${suffix}`,
      domain: "whisker.com",
      prodId: `prod_lr_${suffix}`,
      title: "Litter-Robot 4 Self-Cleaning Cat Litter Box LR4-100",
      handle: "litter-robot-4-self-cleaning-cat-litter-box",
      url: "https://whisker.com/products/litter-robot-4-self-cleaning-cat-litter-box",
      brand: "Whisker",
      model: "LR4-100",
      sku: "LR4-100",
      gtin: "0850018302145",
      price: "699.00",
      adHeadline1: "Litter-Robot 4 Self-Cleaning Cat Litter Box LR4-100 by Whisker",
      adBody1: "Never scoop cat litter again with the automatic Litter-Robot 4 smart pet gadget.",
      adHeadline2: "Whisker Litter-Robot 4 Automatic Self-Cleaning Litter Box with OdorTrap",
      adBody2: "Smart WiFi-enabled automatic cat litter box with real-time waste and weight tracking.",
    },
  ];

  const createdAdIds: string[] = [];
  const createdLinkIds: string[] = [];
  const createdDiscoveryRunAdIds: string[] = [];
  const newlyCreatedStoreIds: string[] = [];

  try {
    await prisma.workspace.create({
      data: {
        id: workspaceId,
        name: "Walmart V12.4.3.5.1 Non-Inflation Proof Workspace",
      },
    });

    await prisma.dataSource.create({
      data: {
        id: dataSourceId,
        name: `META_AD_LIBRARY_NONINF_${suffix}`,
        displayName: "Meta Ad Library Non-Inflation Proof",
        status: "AVAILABLE",
        capabilities: JSON.stringify(["DISCOVERY", "OBSERVATION"]),
        supportedRegions: JSON.stringify(["US"]),
      },
    });

    await prisma.discoveryRun.create({
      data: {
        id: discoveryRunId,
        workspaceId,
        providerId: "meta-ads-collector",
        status: "COMPLETED",
        runMode: "MANUAL",
        queryConfigJson: JSON.stringify({ topic: "Pet Gadgets", market: "US" }),
        startedAt: new Date("2026-10-15T00:00:00.000Z"),
        finishedAt: new Date("2026-10-15T00:05:00.000Z"),
      },
    });

    const now = new Date();
    const firstSeen = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000);
    const lastSeen = new Date(now.getTime() - 1 * 24 * 60 * 60 * 1000);

    for (const p of productsSeed) {
      await prisma.advertiser.create({
        data: {
          id: p.advId,
          platform: "META",
          name: p.advName,
          domain: p.domain,
        },
      });

      const existingStore = await prisma.competitorStore.findUnique({
        where: { domain: p.domain },
      });
      let storeIdToUse = existingStore?.id;
      if (!storeIdToUse) {
        await prisma.competitorStore.create({
          data: {
            id: p.storeId,
            advertiserId: p.advId,
            storeName: p.advName,
            domain: p.domain,
            commercePlatform: "SHOPIFY_CONFIRMED",
          },
        });
        storeIdToUse = p.storeId;
        newlyCreatedStoreIds.push(p.storeId);
      }

      await prisma.researchProduct.create({
        data: {
          id: p.prodId,
          storeId: storeIdToUse,
          title: p.title,
          productUrl: p.url,
          category: "Pet Gadgets",
          currentPrice: parseFloat(p.price),
          currency: "USD",
        },
      });

      const adEntries = [
        { idx: 1, headline: p.adHeadline1, bodyText: p.adBody1 },
        { idx: 2, headline: p.adHeadline2, bodyText: p.adBody2 },
      ];

      for (const entry of adEntries) {
        const adId = `ad_${p.prodId}_${entry.idx}`;
        createdAdIds.push(adId);
        await prisma.competitorAd.create({
          data: {
            id: adId,
            externalAdId: `ext_${adId}`,
            advertiserId: p.advId,
            dataSourceId,
            platform: "META",
            status: "ACTIVE_VERIFIED",
            headline: entry.headline,
            bodyText: entry.bodyText,
            landingPageUrl: p.url,
            originalAdUrl: `https://www.facebook.com/ads/library/?id=${adId}`,
            targetMarket: "US",
            firstSeenAt: firstSeen,
            lastSeenAt: lastSeen,
            isSyntheticQuarantine: false,
          },
        });

        const linkId = `link_${adId}`;
        createdLinkIds.push(linkId);
        await prisma.adProductLink.create({
          data: {
            id: linkId,
            adId,
            productId: p.prodId,
            confidence: "CONFIRMED",
          },
        });

        const drAdId = `drad_${adId}`;
        createdDiscoveryRunAdIds.push(drAdId);
        await prisma.discoveryRunAd.create({
          data: {
            id: drAdId,
            runId: discoveryRunId,
            adId,
            workspaceId,
            providerId: "meta-ads-collector",
            ingestOutcome: "NEW",
          },
        });
      }
    }

    const deterministicMetadataFetcher = async (
      rawUrl: string
    ): Promise<ProductMetadataEvidence> => {
      const matched = productsSeed.find((p) => rawUrl.includes(p.domain));
      if (!matched) {
        return {
          url: rawUrl,
          requestedUrl: rawUrl,
          resolvedFinalUrl: rawUrl,
          declaredCanonicalUrl: rawUrl,
          normalizedProductUrl: rawUrl,
          storeDomain: null,
          merchantProductId: null,
          isSafe: true,
          pageType: "ACTUAL_PRODUCT_PAGE",
          fetchOutcome: "VERIFIED_PRODUCT_PAGE",
          httpStatus: 200,
          verified: true,
          isValidProductPage: true,
          title: "Pet Gadget Product",
          ogTitle: "Pet Gadget Product",
          ogImage: "https://example.com/image.jpg",
          canonicalUrl: rawUrl,
          brand: "PetBrand",
          productName: "Pet Gadget Product",
          description: "Verified physical pet gadget product.",
          jsonLdFound: true,
        };
      }
      return {
        url: matched.url,
        requestedUrl: matched.url,
        resolvedFinalUrl: matched.url,
        declaredCanonicalUrl: matched.url,
        normalizedProductUrl: matched.url,
        storeDomain: matched.domain,
        merchantProductId: matched.sku,
        isSafe: true,
        pageType: "ACTUAL_PRODUCT_PAGE",
        fetchOutcome: "VERIFIED_PRODUCT_PAGE",
        httpStatus: 200,
        verified: true,
        isValidProductPage: true,
        verificationReason: "Verified Shopify product page with JSON-LD Product schema.",
        title: matched.title,
        ogTitle: matched.title,
        ogImage: `https://${matched.domain}/cdn/shop/products/${matched.handle}.jpg`,
        imageReferences: [`https://${matched.domain}/cdn/shop/products/${matched.handle}.jpg`],
        canonicalUrl: matched.url,
        brand: matched.brand,
        model: matched.model,
        sku: matched.sku,
        gtin: matched.gtin,
        price: matched.price,
        currency: "USD",
        productName: matched.title,
        description: matched.adBody1,
        jsonLdFound: true,
        jsonLdProduct: {
          name: matched.title,
          brand: matched.brand,
          sku: matched.sku,
          gtin: matched.gtin,
          model: matched.model,
          price: matched.price,
          currency: "USD",
        },
      };
    };

    const walmartCustomFetch: typeof fetch = (async (inputUrl: any) => {
      const urlStr = String(inputUrl);
      if (urlStr.includes("/ip/") && urlStr.includes("5184129384")) {
        return new Response(pdpChomChom, { status: 200 });
      }
      if (urlStr.includes("/ip/") && urlStr.includes("9081726354")) {
        return new Response(pdpCatFountain, { status: 200 });
      }
      let requestedQ = "Pet Gadgets";
      try {
        const innerTarget = urlStr.replace(/^https:\/\/r\.jina\.ai\//i, "");
        const parsedU = new URL(innerTarget);
        requestedQ = parsedU.searchParams.get("q") || requestedQ;
      } catch {
        // fallback
      }
      const lower = `${decodeURIComponent(urlStr)} ${requestedQ}`.toLowerCase();
      if (
        lower.includes("0856166005008") ||
        lower.includes("chomchom") ||
        lower.includes("ccr-2000") ||
        lower.includes("roller")
      ) {
        return new Response(buildSearchChomChom(requestedQ), { status: 200 });
      }
      if (
        lower.includes("0742832119023") ||
        lower.includes("uahpet") ||
        lower.includes("fountain") ||
        lower.includes("uwf-01")
      ) {
        return new Response(buildSearchCatFountain(requestedQ), { status: 200 });
      }
      return new Response(buildSearchNoMatch(requestedQ), { status: 200 });
    }) as typeof fetch;

    resetWalmartSharedHostGroupForTests();
    await prisma.providerRequestLedger
      .deleteMany({
        where: { providerId: WALMART_COOLDOWN_PROVIDER_ID },
      })
      .catch(() => {});

    const runOff = await runEvergreenProductResearch({
      workspaceId,
      topic: "Pet Gadgets",
      market: "US",
      lookbackDays: 30,
      sourceMode: "CACHE_ONLY",
      selectedSources: ["META_ADS", "DEMAND_HISTORY"],
      enableAmazonUsPilot: false,
      enableWalmartUsPilot: false,
      walmartPilotEnv: {
        KH02_WALMART_US_ENABLED: "false",
        KH02_WALMART_US_LIVE_ALLOWED: "false",
      },
      candidateMetadataFetcher: deterministicMetadataFetcher,
    });

    const runOn = await runEvergreenProductResearch({
      workspaceId,
      topic: "Pet Gadgets",
      market: "US",
      lookbackDays: 30,
      sourceMode: "CACHE_ONLY",
      selectedSources: ["META_ADS", "DEMAND_HISTORY"],
      enableAmazonUsPilot: false,
      enableWalmartUsPilot: true,
      walmartPilotEnv: {
        KH02_WALMART_US_ENABLED: "true",
        KH02_WALMART_US_LIVE_ALLOWED: "false",
      },
      walmartPilotEvidenceOrigin: "TEST_FIXTURE",
      walmartPilotCustomFetch: walmartCustomFetch,
      candidateMetadataFetcher: deterministicMetadataFetcher,
    });

    const itemsOff = collectOrderedScoredItems(runOff);
    const itemsOn = collectOrderedScoredItems(runOn);

    const candidateIdsOff = itemsOff.map((i) => i.candidate.candidateId);
    const candidateIdsOn = itemsOn.map((i) => i.candidate.candidateId);

    const candidateSetMatch =
      candidateIdsOff.length === candidateIdsOn.length &&
      candidateIdsOff.every((id, idx) => id === candidateIdsOn[idx]);

    const onById = new Map<string, { item: RankedLeaderboardItem; index: number }>();
    itemsOn.forEach((item, index) => {
      onById.set(item.candidate.candidateId, { item, index });
    });

    const perCandidateDiffs: WalmartCandidateNonInflationDiff[] = [];

    itemsOff.forEach((offItem, offIdx) => {
      const cid = offItem.candidate.candidateId;
      const onEntry = onById.get(cid);
      if (!onEntry) return;
      const onItem = onEntry.item;
      const onIdx = onEntry.index;

      const scoreOff = Number(offItem.score.opportunityScore ?? 0);
      const scoreOn = Number(onItem.score.opportunityScore ?? 0);
      const confOff = Number(offItem.score.evidenceConfidence ?? 0);
      const confOn = Number(onItem.score.evidenceConfidence ?? 0);
      const rankOff = offItem.rank ?? null;
      const rankOn = onItem.rank ?? null;

      const tierOff = String(offItem.score.tier || "INSUFFICIENT_EVIDENCE");
      const tierOn = String(onItem.score.tier || "INSUFFICIENT_EVIDENCE");
      const recOff = String(offItem.score.recommendation || "INSUFFICIENT_EVIDENCE");
      const recOn = String(onItem.score.recommendation || "INSUFFICIENT_EVIDENCE");

      const demandOff = String(offItem.score.pillars?.demandStability?.status || "INSUFFICIENT_EVIDENCE");
      const demandOn = String(onItem.score.pillars?.demandStability?.status || "INSUFFICIENT_EVIDENCE");

      const evergreenOff = tierOff === "VERIFIED_EVERGREEN";
      const evergreenOn = tierOn === "VERIFIED_EVERGREEN";

      const g15StatusOff = demandOff === "PASS" ? "PASS" : "INSUFFICIENT_EVIDENCE";
      const g15StatusOn = demandOn === "PASS" ? "PASS" : "INSUFFICIENT_EVIDENCE";
      const g16StatusOff = runOff.researchShortlist?.liveVerifiedTop3 ? "PASS" : "PARTIAL_OR_INSUFFICIENT";
      const g16StatusOn = runOn.researchShortlist?.liveVerifiedTop3 ? "PASS" : "PARTIAL_OR_INSUFFICIENT";

      const wmtSummaryOn = (onItem.candidate as any).walmartEvidenceSummary;
      const wmtRowsOn = (runOn.walmartMarketplaceEvidence || []).filter(
        (r) => r.candidateId === cid
      );
      const primaryWmtRow = wmtRowsOn[0] || null;

      perCandidateDiffs.push({
        candidateId: cid,
        title: offItem.candidate.title,
        storeDomain: offItem.candidate.storeDomain || null,
        opportunityScoreOff: scoreOff,
        opportunityScoreOn: scoreOn,
        scoreDelta: Number((scoreOn - scoreOff).toFixed(6)),
        evidenceConfidenceOff: confOff,
        evidenceConfidenceOn: confOn,
        confidenceDelta: Number((confOn - confOff).toFixed(6)),
        rankOff,
        rankOn,
        rankDelta: (rankOn ?? 0) - (rankOff ?? 0),
        orderIndexOff: offIdx,
        orderIndexOn: onIdx,
        orderIndexDelta: onIdx - offIdx,
        tierOff,
        tierOn,
        recommendationOff: recOff,
        recommendationOn: recOn,
        demandStabilityStatusOff: demandOff,
        demandStabilityStatusOn: demandOn,
        evergreenEligibleOff: evergreenOff,
        evergreenEligibleOn: evergreenOn,
        g15StatusOff,
        g15StatusOn,
        g16StatusOff,
        g16StatusOn,
        walmartQueryStatusOff: "DISABLED",
        walmartQueryStatusOn:
          primaryWmtRow?.queryStatus || wmtSummaryOn?.queryStatus || "NOT_ATTEMPTED",
        walmartPresenceOn:
          primaryWmtRow?.presence || wmtSummaryOn?.presence || "UNKNOWN",
        walmartMatchLevelOn:
          primaryWmtRow?.matchLevel || wmtSummaryOn?.matchLevel || "UNCERTAIN",
        walmartEvidenceOriginOn:
          primaryWmtRow?.evidenceOrigin || wmtSummaryOn?.evidenceOrigin || "TEST_FIXTURE",
        walmartItemIdOn: primaryWmtRow?.itemId || wmtSummaryOn?.itemId || null,
      });
    });

    const comparedCandidatesCount = perCandidateDiffs.length;
    const walmartLogicalOperationsUsedOn =
      runOn.walmartMarketplaceTelemetry?.logicalOperationsUsed ?? 0;
    const walmartEvidenceRowsExercised =
      runOn.walmartMarketplaceEvidence?.length ?? 0;
    const providerPathExercised =
      Boolean(runOn.walmartMarketplaceTelemetry?.featureEnabled) &&
      walmartLogicalOperationsUsedOn > 0 &&
      walmartEvidenceRowsExercised > 0 &&
      perCandidateDiffs.some(
        (d) =>
          d.walmartQueryStatusOn === "SUCCEEDED" &&
          d.walmartPresenceOn === "FOUND" &&
          d.walmartMatchLevelOn === "EXACT" &&
          d.walmartItemIdOn !== null
      );

    const evidenceOrigins = Array.from(
      new Set(
        (runOn.walmartMarketplaceEvidence || []).map((r) => r.evidenceOrigin)
      )
    );

    const scoreDeltaAbsMax =
      perCandidateDiffs.length > 0
        ? Math.max(...perCandidateDiffs.map((d) => Math.abs(d.scoreDelta)))
        : 0;
    const confidenceDeltaAbsMax =
      perCandidateDiffs.length > 0
        ? Math.max(...perCandidateDiffs.map((d) => Math.abs(d.confidenceDelta)))
        : 0;

    const rankingChanged =
      !candidateSetMatch ||
      perCandidateDiffs.some(
        (d) => d.rankDelta !== 0 || d.orderIndexDelta !== 0
      );

    const gateChanges = perCandidateDiffs.filter(
      (d) =>
        d.tierOff !== d.tierOn ||
        d.recommendationOff !== d.recommendationOn ||
        d.demandStabilityStatusOff !== d.demandStabilityStatusOn ||
        d.evergreenEligibleOff !== d.evergreenEligibleOn ||
        d.g15StatusOff !== d.g15StatusOn ||
        d.g16StatusOff !== d.g16StatusOn
    ).length;

    const g15PromotedCount = perCandidateDiffs.filter(
      (d) => d.g15StatusOff !== "PASS" && d.g15StatusOn === "PASS"
    ).length;
    const g16PromotedCount = perCandidateDiffs.filter(
      (d) => d.g16StatusOff !== "PASS" && d.g16StatusOn === "PASS"
    ).length;

    const nonInflationVerified =
      comparedCandidatesCount >= 3 &&
      candidateSetMatch &&
      providerPathExercised &&
      walmartEvidenceRowsExercised >= 1 &&
      scoreDeltaAbsMax === 0 &&
      confidenceDeltaAbsMax === 0 &&
      !rankingChanged &&
      gateChanges === 0 &&
      g15PromotedCount === 0 &&
      g16PromotedCount === 0;

    return {
      evaluatedAt: new Date().toISOString(),
      workspaceId,
      topic: "Pet Gadgets",
      comparedCandidatesCount,
      candidateIdsOff,
      candidateIdsOn,
      candidateSetMatch,
      providerPathExercised,
      walmartLogicalOperationsUsedOn,
      walmartEvidenceRowsExercised,
      evidenceOrigins,
      scoreDeltaAbsMax,
      confidenceDeltaAbsMax,
      rankingChanged,
      gateChanges,
      g15PromotedCount,
      g16PromotedCount,
      nonInflationVerified,
      perCandidateDiffs,
      diffs: perCandidateDiffs,
    };
  } finally {
    await prisma.discoveryRunAd
      .deleteMany({ where: { id: { in: createdDiscoveryRunAdIds } } })
      .catch(() => undefined);
    await prisma.adProductLink
      .deleteMany({ where: { id: { in: createdLinkIds } } })
      .catch(() => undefined);
    await prisma.competitorAd
      .deleteMany({ where: { id: { in: createdAdIds } } })
      .catch(() => undefined);
    await prisma.researchProduct
      .deleteMany({
        where: { id: { in: productsSeed.map((p) => p.prodId) } },
      })
      .catch(() => undefined);
    if (newlyCreatedStoreIds.length > 0) {
      await prisma.competitorStore
        .deleteMany({
          where: { id: { in: newlyCreatedStoreIds } },
        })
        .catch(() => undefined);
    }
    await prisma.advertiser
      .deleteMany({
        where: { id: { in: productsSeed.map((p) => p.advId) } },
      })
      .catch(() => undefined);
    await prisma.discoveryRun
      .deleteMany({ where: { id: discoveryRunId } })
      .catch(() => undefined);
    await prisma.dataSource
      .deleteMany({ where: { id: dataSourceId } })
      .catch(() => undefined);
    await prisma.workspace
      .deleteMany({ where: { id: workspaceId } })
      .catch(() => undefined);
  }
}
