import { prisma } from "../src/lib/db";

async function main() {
  const ads = await prisma.competitorAd.findMany({
    include: {
      mediaAssets: true,
      advertiser: true,
      researchScores: { take: 1, orderBy: { createdAt: "desc" } },
      analyses: { take: 1, orderBy: { createdAt: "desc" } },
    },
  });

  console.log(`\n=== DATABASE AUDIT — ${new Date().toISOString()} ===`);
  console.log(`Total competitor ad records: ${ads.length}\n`);

  for (const a of ads) {
    const m = a.mediaAssets?.[0];
    const s = a.researchScores?.[0];
    const an = a.analyses?.[0];
    console.log(JSON.stringify({
      id: a.id,
      platform: a.platform,
      advertiser: a.advertiser?.name,
      externalAdId: a.externalAdId,
      originalAdUrl: a.originalAdUrl,
      status: a.status,
      daysRunning: a.daysRunning,
      dataConfidence: a.dataConfidence,
      targetMarket: a.targetMarket,
      media: {
        videoUrl: m?.videoUrl,
        embedUrl: m?.embedUrl,
        thumbnailUrl: m?.thumbnailUrl,
        availability: m?.availability,
        durationSeconds: m?.durationSeconds,
      },
      score: s?.totalScore,
      formulaVersion: s?.formulaVersion,
      analysisStatus: an ? {
        hookType: an.hookType,
        hookQualityScore: an.hookQualityScore,
        pacingScore: an.pacingScore,
      } : null,
    }, null, 2));
    console.log("---");
  }

  // Check watchlists
  const watchlists = await prisma.watchlist.findMany({ include: { items: true } });
  console.log(`\nWatchlists: ${watchlists.length}`);
  for (const wl of watchlists) {
    console.log(`  - "${wl.name}" — ${wl.items.length} items`);
  }

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
