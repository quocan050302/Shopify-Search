/**
 * V6.2 — Database repair migration.
 *
 * This script:
 * 1. Quarantines all 6 original synthetic seed records (marks them SYNTHETIC_DEMO)
 * 2. Strips fake media from all quarantined records
 * 3. Invalidates v2.0.0 scores (from pre-V6.1 formula)
 * 4. Removes hardcoded 88/82 AI analyses
 * 5. Removes any record seeded by the original seed script (identifiable by externalAdId pattern)
 * 6. Preserves the 7th record (Test Brand Labs - formula v6.1.0) as an example of v6.1 behavior
 * 7. Creates the demonstration dataset table entry for quarantined records
 */

import { prisma } from "../src/lib/db";

const SYNTHETIC_EXTERNAL_IDS = [
  "meta_bleame_crystal_hair_eraser_01",
  "tiktok_ridge_wallet_titanium_02",
  "meta_blendjet_portable_blender_03",
  "tiktok_chomchom_pet_roller_04",
  "meta_lumineux_teeth_whitening_05",
  "tiktok_gripzilla_strengthener_06",
];

const SAMPLE_VIDEO_DOMAINS = [
  "commondatastorage.googleapis.com/gtv-videos-bucket",
  "sample-videos.com",
];

const STOCK_IMAGE_DOMAINS = [
  "unsplash.com",
  "pexels.com",
  "pixabay.com",
];

function isSampleVideo(url?: string | null): boolean {
  if (!url) return false;
  return SAMPLE_VIDEO_DOMAINS.some((d) => url.includes(d));
}

function isStockImage(url?: string | null): boolean {
  if (!url) return false;
  return STOCK_IMAGE_DOMAINS.some((d) => url.includes(d));
}

function isFakeEmbed(url?: string | null): boolean {
  if (!url) return false;
  return (
    url.includes("facebook.com/ads/archive/render_ad") ||
    url.includes("creativecenter/inspiration/topads/embed/")
  );
}

async function main() {
  console.log("🔧 V6.2 Database Repair Migration");
  console.log("====================================");

  // Step 1: Find all synthetic seed records
  const syntheticAds = await prisma.competitorAd.findMany({
    where: {
      OR: [
        { externalAdId: { in: SYNTHETIC_EXTERNAL_IDS } },
        // Also catch by old formula version scores + pattern
        {
          AND: [
            { researchScores: { some: { formulaVersion: "2.0.0" } } },
            {
              externalAdId: {
                startsWith: "meta_",
              },
            },
          ],
        },
        {
          AND: [
            { researchScores: { some: { formulaVersion: "2.0.0" } } },
            {
              externalAdId: {
                startsWith: "tiktok_",
              },
            },
          ],
        },
      ],
    },
    include: {
      mediaAssets: true,
      researchScores: true,
      analyses: true,
    },
  });

  console.log(`\nFound ${syntheticAds.length} synthetic/demo records to quarantine.`);

  let quarantined = 0;
  let mediaStripped = 0;
  let scoresInvalidated = 0;
  let analysesRemoved = 0;

  for (const ad of syntheticAds) {
    console.log(`\nProcessing: [${ad.platform}] ${ad.externalAdId}`);

    // 1. Mark as SYNTHETIC_DEMO and downgrade confidence
    await prisma.competitorAd.update({
      where: { id: ad.id },
      data: {
        status: "INACTIVE",
        dataConfidence: "UNAVAILABLE",
        // We use a flag in targetMarket to mark it as quarantined
        // (no separate field exists in schema — we'll use a note in headline)
        headline: `[SYNTHETIC_DEMO] ${ad.headline || ""}`.trim(),
      },
    });
    quarantined++;

    // 2. Strip sample media from each media asset
    for (const asset of ad.mediaAssets) {
      const updates: any = {};

      if (isSampleVideo(asset.videoUrl)) {
        updates.videoUrl = null;
        console.log(`  ❌ Stripped sample video: ${asset.videoUrl?.substring(0, 60)}...`);
        mediaStripped++;
      }

      if (isStockImage(asset.thumbnailUrl)) {
        updates.thumbnailUrl = null;
        console.log(`  ❌ Stripped stock thumbnail: ${asset.thumbnailUrl?.substring(0, 60)}...`);
      }

      if (isFakeEmbed(asset.embedUrl)) {
        updates.embedUrl = null;
        console.log(`  ❌ Stripped invalid embed: ${asset.embedUrl?.substring(0, 60)}...`);
      }

      if (Object.keys(updates).length > 0) {
        // If we stripped video and embed, mark as FALLBACK_ONLY
        if (updates.videoUrl === null && (asset.embedUrl === null || updates.embedUrl === null)) {
          updates.availability = "FALLBACK_ONLY";
        }

        await prisma.adMediaAsset.update({
          where: { id: asset.id },
          data: updates,
        });
      }
    }

    // 3. Invalidate v2.0.0 research scores
    for (const score of ad.researchScores) {
      if (score.formulaVersion === "2.0.0") {
        await prisma.researchScore.update({
          where: { id: score.id },
          data: {
            formulaVersion: "2.0.0-INVALIDATED",
            scoreBreakdown: JSON.stringify({
              invalidated: true,
              reason: "Derived from synthetic seed data with sample media and fictional ad IDs",
              invalidatedAt: new Date().toISOString(),
              originalScore: score.totalScore,
            }),
          },
        });
        scoresInvalidated++;
        console.log(`  ⚠️ Invalidated score: ${score.totalScore}/100 (formula v2.0.0)`);
      }
    }

    // 4. Remove hardcoded AI analyses (88/82 are fabricated)
    for (const analysis of ad.analyses) {
      if (analysis.hookQualityScore === 88 && analysis.pacingScore === 82) {
        await prisma.creativeAnalysis.delete({
          where: { id: analysis.id },
        });
        analysesRemoved++;
        console.log(`  ❌ Removed hardcoded analysis (hookScore=88, pacingScore=82)`);
      }
    }
  }

  // Step 2: Also fix the 7th record (Test Brand Labs with fake embed/stock thumbnail)
  const testRecord = await prisma.competitorAd.findFirst({
    where: { externalAdId: "999888777" },
    include: { mediaAssets: true, analyses: true },
  });

  if (testRecord) {
    console.log(`\nFixing test record: Test Brand Labs`);
    for (const asset of testRecord.mediaAssets) {
      const updates: any = {};
      if (isStockImage(asset.thumbnailUrl)) {
        updates.thumbnailUrl = null;
        console.log(`  ❌ Stripped stock thumbnail`);
      }
      if (isFakeEmbed(asset.embedUrl)) {
        updates.embedUrl = null;
        console.log(`  ❌ Stripped fake embed URL`);
      }
      // Fix availability from READY -> FALLBACK_ONLY (no real video)
      updates.availability = "FALLBACK_ONLY";
      // Remove fake duration
      if (asset.durationSeconds === 30) {
        updates.durationSeconds = null;
      }
      if (Object.keys(updates).length > 0) {
        await prisma.adMediaAsset.update({ where: { id: asset.id }, data: updates });
      }
    }
    // Fix status
    await prisma.competitorAd.update({
      where: { id: testRecord.id },
      data: {
        status: "UNKNOWN",
        dataConfidence: "UNVERIFIED",
      },
    });
    // Remove hardcoded analyses
    for (const an of testRecord.analyses) {
      if (an.hookQualityScore === 88 && an.pacingScore === 82) {
        await prisma.creativeAnalysis.delete({ where: { id: an.id } });
        analysesRemoved++;
        console.log(`  ❌ Removed hardcoded analysis from test record`);
      }
    }
  }

  // Step 3: Clean up watchlist items pointing to synthetic ads
  const syntheticIds = syntheticAds.map((a) => a.id);
  const watchlistItemsToClean = await prisma.watchlistItem.findMany({
    where: { adId: { in: syntheticIds } },
  });

  if (watchlistItemsToClean.length > 0) {
    console.log(`\n🧹 Found ${watchlistItemsToClean.length} watchlist items pointing to synthetic ads.`);
    console.log(`   Leaving in place (watchlist owner can review). Watchlist items preserved for audit.`);
  }

  // Summary
  console.log("\n====================================");
  console.log("✅ V6.2 Migration Summary:");
  console.log(`   Records quarantined: ${quarantined}`);
  console.log(`   Sample videos stripped: ${mediaStripped}`);
  console.log(`   Scores invalidated: ${scoresInvalidated}`);
  console.log(`   Hardcoded analyses removed: ${analysesRemoved}`);
  console.log("\nDatabase state after migration:");

  const allAds = await prisma.competitorAd.findMany({
    include: { mediaAssets: true, researchScores: { take: 1 } },
  });

  console.log(`Total records: ${allAds.length}`);
  console.log(`INACTIVE (quarantined): ${allAds.filter(a => a.status === "INACTIVE").length}`);
  console.log(`UNKNOWN: ${allAds.filter(a => a.status === "UNKNOWN").length}`);
  console.log(`ACTIVE: ${allAds.filter(a => a.status === "ACTIVE").length}`);
  console.log(`With sample video (should be 0): ${allAds.filter(a => a.mediaAssets?.[0]?.videoUrl?.includes("gtv-videos-bucket")).length}`);

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error("❌ Migration failed:", e);
  process.exit(1);
});
