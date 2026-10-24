import { prisma } from "../src/lib/db";
import { createClient } from "@libsql/client";
import fs from "fs";
import path from "path";

async function main() {
  console.log("Starting DB audit and backup...");

  // 1. Count records in all specified models
  const workspaces = await prisma.workspace.findMany();
  const ads = await prisma.competitorAd.findMany({
    include: {
      advertiser: true,
      mediaAssets: true,
      observations: true,
      sourceIdentities: true,
      researchScores: true,
      evergreenScores: true,
    },
  });
  const mediaCount = await prisma.adMediaAsset.count();
  const observationsCount = await prisma.adObservation.count();
  const identitiesCount = await prisma.adSourceIdentity.count();
  const runs = await prisma.discoveryRun.findMany({
    include: {
      requestLedgers: true,
    },
  });
  const syncJobs = await prisma.syncJob.findMany();
  const ledgersCount = await prisma.providerRequestLedger.count();
  const schedules = await prisma.discoverySchedule.findMany();

  console.log("=== RECORD COUNTS ===");
  console.log(`Workspace: ${workspaces.length}`);
  console.log(`CompetitorAd: ${ads.length}`);
  console.log(`AdMediaAsset: ${mediaCount}`);
  console.log(`AdObservation: ${observationsCount}`);
  console.log(`AdSourceIdentity: ${identitiesCount}`);
  console.log(`DiscoveryRun: ${runs.length}`);
  console.log(`SyncJob: ${syncJobs.length}`);
  console.log(`ProviderRequestLedger: ${ledgersCount}`);
  console.log(`DiscoverySchedule: ${schedules.length}`);

  // 2. Identify legacy Muse records, suspected synthetic records, genuine research records
  console.log("\n=== ADS INVENTORY ===");
  let syntheticCount = 0;
  let genuineCount = 0;
  let museAdsCount = 0;

  for (const ad of ads) {
    const isSynthetic = ad.isSyntheticQuarantine || ad.status.includes("SYNTHETIC");
    if (isSynthetic) syntheticCount++;
    else genuineCount++;

    const isMuse = ad.sourceIdentities.some((s) => s.providerId.includes("muse")) || ad.externalAdId?.startsWith("muse_");
    if (isMuse) museAdsCount++;

    console.log(
      `ID: ${ad.id} | ExtID: ${ad.externalAdId} | Platform: ${ad.platform} | Brand: ${ad.advertiser?.name} | Status: ${ad.status} | SynthQuarantine: ${ad.isSyntheticQuarantine} | Created: ${ad.createdAt.toISOString()}`
    );
  }
  console.log(`Summary Ads: Total=${ads.length}, SyntheticQuarantine=${syntheticCount}, Genuine=${genuineCount}, MuseIdentified=${museAdsCount}`);

  console.log("\n=== DISCOVERY RUNS INVENTORY ===");
  const runsByProvider: Record<string, number> = {};
  for (const run of runs) {
    runsByProvider[run.providerId] = (runsByProvider[run.providerId] || 0) + 1;
    if (run.providerId.includes("muse")) {
      console.log(
        `MUSE RUN: id=${run.id} status=${run.status} query=${run.queryConfigJson.slice(0, 60)} created=${run.createdAt.toISOString()}`
      );
    }
  }
  console.log("Runs by provider:", runsByProvider);

  // 3. Perform consistent SQLite backup using VACUUM INTO
  const projectDir = process.cwd();
  const backupDir = path.join(projectDir, "backups");
  if (!fs.existsSync(backupDir)) {
    fs.mkdirSync(backupDir, { recursive: true });
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backupFileName = `v11_pre_migration_${timestamp}.db`;
  const backupPath = path.join(backupDir, backupFileName).replace(/\\/g, "/");

  const rawUrl = process.env.DATABASE_URL || "file:./dev.db";
  const relativeDbPath = rawUrl.replace("file:", "");
  const absoluteDbPath = path.resolve(projectDir, relativeDbPath).replace(/\\/g, "/");
  console.log(`\nActive DB file: ${absoluteDbPath} (Size: ${fs.statSync(absoluteDbPath).size} bytes)`);

  const client = createClient({ url: `file:${absoluteDbPath}` });
  console.log(`Executing VACUUM INTO '${backupPath}'...`);
  await client.execute(`VACUUM INTO '${backupPath}'`);
  console.log(`Backup completed successfully. Size: ${fs.statSync(backupPath).size} bytes`);

  // Verify backup integrity
  const backupClient = createClient({ url: `file:${backupPath}` });
  const integrityResult = await backupClient.execute("PRAGMA integrity_check");
  console.log(`Integrity check on backup:`, integrityResult.rows);

  const backupAdCount = await backupClient.execute("SELECT COUNT(*) as count FROM competitor_ads");
  console.log(`Backup competitor_ads row count:`, backupAdCount.rows[0]);

  client.close();
  backupClient.close();

  return {
    backupPath,
    backupSize: fs.statSync(backupPath).size,
    integrityCheck: integrityResult.rows[0],
    counts: {
      workspaces: workspaces.length,
      ads: ads.length,
      syntheticAds: syntheticCount,
      genuineAds: genuineCount,
      museAds: museAdsCount,
      mediaCount,
      observationsCount,
      identitiesCount,
      runs: runs.length,
      runsByProvider,
      syncJobs: syncJobs.length,
      ledgersCount,
      schedules: schedules.length,
    },
  };
}

main()
  .then((res) => {
    console.log("\nBackup & Audit finished successfully:", JSON.stringify(res, null, 2));
  })
  .catch((err) => {
    console.error("Backup & Audit error:", err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
