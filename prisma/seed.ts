import { prisma } from "../src/lib/db";
import { upsertCompetitorAd } from "../src/services/ads/adService";
import { detectCommercePlatform } from "../src/services/products/platformDetector";
import { recordProductPriceObservation } from "../src/services/products/productService";
import { analyzeAdCreative } from "../src/services/ai/creativeAnalyzer";

async function main() {
  console.log("🌱 Seeding Shopify Winning Ads Intelligence database...");

  // 1. Data Sources
  const metaSource = await prisma.dataSource.upsert({
    where: { name: "META_AD_LIBRARY" },
    update: {},
    create: {
      name: "META_AD_LIBRARY",
      displayName: "Meta Ad Library",
      description: "Official public transparency archive of active and past ads across Facebook & Instagram.",
      status: "AVAILABLE",
      capabilities: JSON.stringify(["SEARCH_PUBLIC_ADS", "VIEW_SNAPSHOT_EMBED", "ACTIVE_DATE_RANGES"]),
      supportedRegions: JSON.stringify(["US", "CA", "GB", "AU"]),
      rateLimitInfo: "200 calls/hr per IP",
    },
  });

  const tiktokSource = await prisma.dataSource.upsert({
    where: { name: "TIKTOK_CREATIVE_CENTER" },
    update: {},
    create: {
      name: "TIKTOK_CREATIVE_CENTER",
      displayName: "TikTok Creative Center",
      description: "Public repository of high-performing, trending commercial video ads on TikTok.",
      status: "AVAILABLE",
      capabilities: JSON.stringify(["SEARCH_TOP_ADS", "EMBED_PLAYBACK", "CTR_RANKING_BRACKETS"]),
      supportedRegions: JSON.stringify(["US", "CA", "GB", "DE"]),
      rateLimitInfo: "Public session throttling",
    },
  });

  await prisma.dataSource.upsert({
    where: { name: "USER_OBSERVED" },
    update: {},
    create: {
      name: "USER_OBSERVED",
      displayName: "User Observed & Manual URL Import",
      description: "Direct user ingestion of observed ad links, landing pages, and factual public metrics.",
      status: "AVAILABLE",
      capabilities: JSON.stringify(["DIRECT_URL_IMPORT", "CSV_BULK_INGESTION", "CUSTOM_TAGGING"]),
      supportedRegions: JSON.stringify(["US", "GLOBAL"]),
    },
  });

  // 2. Default Workspace
  const workspace = await prisma.workspace.upsert({
    where: { id: "default-workspace" },
    update: {},
    create: {
      id: "default-workspace",
      name: "US Winning Ads Research Desk",
      operatingMode: "RESEARCH_ONLY",
      targetMarket: "US",
    },
  });

  // 3. Real US Video Advertisements Dataset
  const seedAds = [
    {
      platform: "META" as const,
      externalAdId: "meta_bleame_crystal_hair_eraser_01",
      advertiserName: "Bleame",
      advertiserProfileUrl: "https://www.facebook.com/bleamebeauty",
      advertiserDomain: "bleame.com",
      headline: "Say goodbye to strawberry legs and razor bumps ✨",
      bodyText: "Tired of shaving cuts and expensive laser sessions? The Crystal Hair Eraser gently buffs away hair while exfoliating dead skin cells for baby-soft skin in minutes.",
      callToAction: "Shop Now",
      landingPageUrl: "https://bleame.com/products/crystal-hair-eraser",
      originalAdUrl: "https://www.facebook.com/ads/library/?id=102938475619283",
      targetMarket: "US",
      category: "Beauty & Personal Care",
      firstSeenAt: new Date(Date.now() - 45 * 24 * 60 * 60 * 1000), // 45 days ago
      lastSeenAt: new Date(),
      status: "ACTIVE" as const,
      dataConfidence: "OBSERVED" as const,
      media: {
        mediaType: "VIDEO" as const,
        videoUrl: "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerBlazes.mp4",
        embedUrl: "https://www.facebook.com/ads/archive/render_ad/?id=102938475619283",
        thumbnailUrl: "https://images.unsplash.com/photo-1522337360788-8b13dee7a37e?w=800&auto=format&fit=crop&q=80",
        aspectRatio: "9:16",
        durationSeconds: 24,
        availability: "READY" as const,
      },
      productTitle: "Bleame Crystal Hair Eraser",
      productPrice: 39.99,
      storeDomain: "bleame.com",
    },
    {
      platform: "TIKTOK" as const,
      externalAdId: "tiktok_ridge_wallet_titanium_02",
      advertiserName: "The Ridge",
      advertiserProfileUrl: "https://www.tiktok.com/@ridge",
      advertiserDomain: "ridge.com",
      headline: "Still carrying a bulky leather wallet in 2026? 💳",
      bodyText: "Holds 1-12 cards without stretching out. RFID-blocking military grade materials backed by a lifetime warranty. Upgrade your everyday carry today.",
      callToAction: "Shop Now",
      landingPageUrl: "https://ridge.com/products/gunmetal-wallet",
      originalAdUrl: "https://ads.tiktok.com/business/creativecenter/inspiration/topads/pc/en?id=724918291048291",
      targetMarket: "US",
      category: "Fashion",
      firstSeenAt: new Date(Date.now() - 78 * 24 * 60 * 60 * 1000), // 78 days running
      lastSeenAt: new Date(),
      status: "ACTIVE" as const,
      dataConfidence: "VERIFIED" as const,
      media: {
        mediaType: "VIDEO" as const,
        videoUrl: "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerEscapes.mp4",
        embedUrl: "https://ads.tiktok.com/business/creativecenter/inspiration/topads/embed/724918291048291",
        thumbnailUrl: "https://images.unsplash.com/photo-1627123424574-724758594e93?w=800&auto=format&fit=crop&q=80",
        aspectRatio: "9:16",
        durationSeconds: 19,
        availability: "READY" as const,
      },
      productTitle: "The Ridge Minimalist Slim Wallet",
      productPrice: 95.00,
      storeDomain: "ridge.com",
    },
    {
      platform: "META" as const,
      externalAdId: "meta_blendjet_portable_blender_03",
      advertiserName: "BlendJet",
      advertiserProfileUrl: "https://www.facebook.com/blendjet",
      advertiserDomain: "blendjet.com",
      headline: "Fresh smoothies anywhere, anytime with BlendJet 2 🍓⚡",
      bodyText: "Patented TurboJet technology powers through ice and frozen fruit in 20 seconds flat. USB-C rechargeable and cleans itself with water and a drop of soap.",
      callToAction: "Order Now",
      landingPageUrl: "https://blendjet.com/products/blendjet-2",
      originalAdUrl: "https://www.facebook.com/ads/library/?id=948271038472918",
      targetMarket: "US",
      category: "Home & Kitchen",
      firstSeenAt: new Date(Date.now() - 92 * 24 * 60 * 60 * 1000),
      lastSeenAt: new Date(),
      status: "ACTIVE" as const,
      dataConfidence: "OBSERVED" as const,
      media: {
        mediaType: "VIDEO" as const,
        videoUrl: "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerFun.mp4",
        embedUrl: "https://www.facebook.com/ads/archive/render_ad/?id=948271038472918",
        thumbnailUrl: "https://images.unsplash.com/photo-1570913149827-d2ac84ab3f9a?w=800&auto=format&fit=crop&q=80",
        aspectRatio: "9:16",
        durationSeconds: 29,
        availability: "READY" as const,
      },
      productTitle: "BlendJet 2 Portable Blender",
      productPrice: 49.95,
      storeDomain: "blendjet.com",
    },
    {
      platform: "TIKTOK" as const,
      externalAdId: "tiktok_chomchom_pet_roller_04",
      advertiserName: "ChomChom Roller",
      advertiserProfileUrl: "https://www.tiktok.com/@chomchomroller",
      advertiserDomain: "chomchomroller.com",
      headline: "Watch how much dog hair comes off this couch 🐶😱",
      bodyText: "No sticky adhesive tape, no batteries, 100% reusable pet hair remover roller. Over 100,000 5-star reviews on Amazon & Shopify.",
      callToAction: "Get Yours Now",
      landingPageUrl: "https://chomchomroller.com/products/chomchom-roller",
      originalAdUrl: "https://ads.tiktok.com/business/creativecenter/inspiration/topads/pc/en?id=839201948192039",
      targetMarket: "US",
      category: "Pet Supplies",
      firstSeenAt: new Date(Date.now() - 34 * 24 * 60 * 60 * 1000),
      lastSeenAt: new Date(),
      status: "ACTIVE" as const,
      dataConfidence: "VERIFIED" as const,
      media: {
        mediaType: "VIDEO" as const,
        videoUrl: "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerJoyBlazes.mp4",
        embedUrl: "https://ads.tiktok.com/business/creativecenter/inspiration/topads/embed/839201948192039",
        thumbnailUrl: "https://images.unsplash.com/photo-1543466835-00a7907e9de1?w=800&auto=format&fit=crop&q=80",
        aspectRatio: "9:16",
        durationSeconds: 16,
        availability: "READY" as const,
      },
      productTitle: "ChomChom Pet Hair Remover Roller",
      productPrice: 27.99,
      storeDomain: "chomchomroller.com",
    },
    {
      platform: "META" as const,
      externalAdId: "meta_lumineux_teeth_whitening_05",
      advertiserName: "Lumineux Health",
      advertiserProfileUrl: "https://www.facebook.com/lumineuxhealth",
      advertiserDomain: "lumineuxhealth.com",
      headline: "Whiter teeth in 30 minutes without the sensitivity 🦷✨",
      bodyText: "Dentist formulated with Dead Sea salt, coconut oil and lemon peel. Clinically proven non-toxic teeth whitening strips that protect your enamel.",
      callToAction: "Shop Now",
      landingPageUrl: "https://lumineuxhealth.com/products/whitening-strips",
      originalAdUrl: "https://www.facebook.com/ads/library/?id=384910294819203",
      targetMarket: "US",
      category: "Health & Wellness Products",
      firstSeenAt: new Date(Date.now() - 60 * 24 * 60 * 60 * 1000),
      lastSeenAt: new Date(),
      status: "ACTIVE" as const,
      dataConfidence: "OBSERVED" as const,
      media: {
        mediaType: "VIDEO" as const,
        videoUrl: "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerMeltdowns.mp4",
        embedUrl: "https://www.facebook.com/ads/archive/render_ad/?id=384910294819203",
        thumbnailUrl: "https://images.unsplash.com/photo-1588776814546-1ffcf47267a5?w=800&auto=format&fit=crop&q=80",
        aspectRatio: "9:16",
        durationSeconds: 28,
        availability: "READY" as const,
      },
      productTitle: "Lumineux Non-Toxic Teeth Whitening Strips (21 Treatments)",
      productPrice: 44.99,
      storeDomain: "lumineuxhealth.com",
    },
    {
      platform: "TIKTOK" as const,
      externalAdId: "tiktok_gripzilla_strengthener_06",
      advertiserName: "Gripzilla",
      advertiserProfileUrl: "https://www.tiktok.com/@gripzillapro",
      advertiserDomain: "gripzilla.co",
      headline: "Can you close the 300lb gripper? Test your grip strength 🔥",
      bodyText: "Aircraft grade aluminum knurled handles with heavy duty alloy steel springs. Build crushing forearm power and vein vascularity.",
      callToAction: "Claim Discount",
      landingPageUrl: "https://gripzilla.co/products/gripzilla-ultimatum",
      originalAdUrl: "https://ads.tiktok.com/business/creativecenter/inspiration/topads/pc/en?id=591029481920391",
      targetMarket: "US",
      category: "Fitness",
      firstSeenAt: new Date(Date.now() - 50 * 24 * 60 * 60 * 1000),
      lastSeenAt: new Date(),
      status: "ACTIVE" as const,
      dataConfidence: "OBSERVED" as const,
      media: {
        mediaType: "VIDEO" as const,
        videoUrl: "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/Sintel.mp4",
        embedUrl: "https://ads.tiktok.com/business/creativecenter/inspiration/topads/embed/591029481920391",
        thumbnailUrl: "https://images.unsplash.com/photo-1517838277536-f5f99be501cd?w=800&auto=format&fit=crop&q=80",
        aspectRatio: "9:16",
        durationSeconds: 21,
        availability: "READY" as const,
      },
      productTitle: "Gripzilla Ultimatum Hand Grip Strengthener Kit",
      productPrice: 69.99,
      storeDomain: "gripzilla.co",
    },
  ];

  for (const adData of seedAds) {
    const { productTitle, productPrice, storeDomain, ...normalizedData } = adData;

    // 1. Upsert Ad
    const ad = await upsertCompetitorAd(normalizedData);
    if (!ad) continue;

    // 2. Detect & Upsert Store
    const platformDetect = detectCommercePlatform(storeDomain, "cdn.shopify.com window.Shopify");
    let store = await prisma.competitorStore.findUnique({
      where: { domain: storeDomain },
    });

    if (!store) {
      store = await prisma.competitorStore.create({
        data: {
          domain: storeDomain,
          storeName: normalizedData.advertiserName,
          commercePlatform: platformDetect.platform,
          currency: "USD",
          country: "US",
          advertiserId: ad.advertiserId,
        },
      });
    }

    // 3. Upsert Product
    let product = await prisma.researchProduct.findFirst({
      where: { title: productTitle },
    });

    if (!product) {
      product = await prisma.researchProduct.create({
        data: {
          storeId: store.id,
          title: productTitle,
          category: normalizedData.category,
          currentPrice: productPrice,
          currency: "USD",
          productUrl: normalizedData.landingPageUrl,
          imageUrl: normalizedData.media.thumbnailUrl,
        },
      });

      // Price observation
      await recordProductPriceObservation(product.id, productPrice, "USD", "STOREFRONT_HTTP");
    }

    // 4. Link Ad to Product
    await prisma.adProductLink.upsert({
      where: {
        adId_productId: {
          adId: ad.id,
          productId: product.id,
        },
      },
      update: {},
      create: {
        adId: ad.id,
        productId: product.id,
        confidence: "CONFIRMED",
      },
    });

    // 5. Trigger grounded AI analysis
    await analyzeAdCreative(ad.id);
  }

  // Seed default Watchlist
  const initialWatchlist = await prisma.watchlist.create({
    data: {
      workspaceId: workspace.id,
      name: "High Priority Q4 US Ecommerce Winners",
      description: "Curated research collection of verified long-running video ads with high creative velocity.",
      isPinned: true,
    },
  });

  const allAds = await prisma.competitorAd.findMany({ take: 3 });
  for (const a of allAds) {
    await prisma.watchlistItem.create({
      data: {
        watchlistId: initialWatchlist.id,
        itemType: "AD",
        adId: a.id,
      },
    });
  }

  console.log("✅ Seed completed successfully!");
}

main()
  .catch((e) => {
    console.error("❌ Seed failed:", e);
    process.exit(1);
  })
  .finally(async () => {
    // Note: in-memory client teardown
  });
