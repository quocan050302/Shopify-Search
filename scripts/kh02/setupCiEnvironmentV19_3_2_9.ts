/**
 * SWAI KH-02 — V12.4.3.7.19.3.2.9
 * Deterministic CI Runner Environment Bootstrap
 *
 * Ensures that on a fresh GitHub Actions checkout (where untracked *.db and .venv
 * directories do not yet exist):
 * 1. `dev.db` and `prisma/dev.db` are initialized from `prisma/schema.sql` with the
 *    canonical baseline seed rows (including `cmvsy7zqh000jp0orhypwohho` and DEV/HOLDOUT
 *    point-in-time replay records). Never overwrites an existing non-empty `dev.db`.
 * 2. When `--with-python` is passed, creates `services/meta-ads-collector/.venv` and
 *    invokes `scripts/setupKh02FreeProviders.ts` to initialize `services/google-transparency/.venv`.
 */

import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { createClient } from "@libsql/client";

const BASELINE_CI_SEED_SQL = `
  INSERT OR IGNORE INTO "workspaces" ("id", "name", "operatingMode", "targetMarket", "createdAt", "updatedAt")
  VALUES ('default-workspace', 'US Winning Ads Research Desk', 'RESEARCH_ONLY', 'US', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);

  INSERT OR IGNORE INTO "data_sources" ("id", "name", "displayName", "description", "status", "capabilities", "supportedRegions", "rateLimitInfo", "createdAt", "updatedAt")
  VALUES
    ('ds_meta_ad_library', 'META_AD_LIBRARY', 'Meta Ad Library', 'Official public transparency archive of active and past ads across Facebook & Instagram.', 'AVAILABLE', '["SEARCH_PUBLIC_ADS","VIEW_SNAPSHOT_EMBED","ACTIVE_DATE_RANGES"]', '["US","CA","GB","AU"]', '200 calls/hr per IP', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    ('ds_tiktok_creative_center', 'TIKTOK_CREATIVE_CENTER', 'TikTok Creative Center', 'Public repository of high-performing, trending commercial video ads on TikTok.', 'AVAILABLE', '["SEARCH_TOP_ADS","EMBED_PLAYBACK","CTR_RANKING_BRACKETS"]', '["US","CA","GB","DE"]', 'Public session throttling', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    ('ds_user_observed', 'USER_OBSERVED', 'User Observed & Manual URL Import', 'Direct user ingestion of observed ad links, landing pages, and factual public metrics.', 'AVAILABLE', '["DIRECT_URL_IMPORT","CSV_BULK_INGESTION","CUSTOM_TAGGING"]', '["US","GLOBAL"]', NULL, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);

  INSERT OR IGNORE INTO "advertisers" ("id", "externalId", "platform", "name", "profileUrl", "domain", "country", "verifiedStatus", "createdAt", "updatedAt")
  VALUES
    ('adv_uproot_clean', 'uproot_clean_meta', 'META', 'Uproot Clean', 'https://www.facebook.com/uprootclean', 'cc.uprootclean.com', 'US', 'VERIFIED', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    ('adv_uahpet_us', 'uahpet_us_meta', 'META', 'UAHPET Official', 'https://www.facebook.com/uahpet', 'uahpet.com', 'US', 'VERIFIED', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    ('adv_bleame_demo', 'bleame_demo_meta', 'META', 'Bleame', 'https://www.facebook.com/bleamebeauty', 'bleame.com', 'US', 'OBSERVED', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);

  INSERT OR IGNORE INTO "competitor_stores" ("id", "advertiserId", "domain", "storeName", "commercePlatform", "currency", "country", "createdAt", "updatedAt")
  VALUES
    ('cmvsy7zqc000ip0or2qbp54mk', 'adv_uahpet_us', 'uahpet.com', 'UAHPET', 'SHOPIFY_CONFIRMED', 'USD', 'US', '2026-10-29T02:53:15.300Z', '2026-10-30T02:46:12.899Z'),
    ('store_uproot_clean', 'adv_uproot_clean', 'cc.uprootclean.com', 'Uproot Clean', 'SHOPIFY_CONFIRMED', 'USD', 'US', '2026-10-20T00:00:00.000Z', '2026-10-23T12:08:37.442Z');

  INSERT OR IGNORE INTO "research_products" ("id", "storeId", "title", "category", "description", "imageUrl", "currentPrice", "currency", "productUrl", "createdAt", "updatedAt")
  VALUES
    ('cmvsy7zqh000jp0orhypwohho', 'cmvsy7zqc000ip0or2qbp54mk', 'Automatic Wet Food Cat Feeder with Cooling & Warming', 'pet gadgets', NULL, 'https://www.uahpet.com/cdn/shop/files/uahpet-dual-bowl-fresh-food-feeder-heating-and-cooling.webp?v=1789713332&width=1600', 39.99, 'USD', 'https://uahpet.com/products/uahpet-fresh-food-automatic-pet-feeder', '2026-10-29T02:53:15.305Z', '2026-10-30T02:46:12.899Z'),
    ('prod_uproot_clean_01', 'store_uproot_clean', 'Uproot Clean Pet Hair Remover Pro', 'Pet Supplies', 'Reusable pet hair remover for couches and carpets.', 'https://cc.uprootclean.com/thumb.jpg', 24.99, 'USD', 'https://cc.uprootclean.com/products/uproot-cleaner-pro', '2026-10-20T00:00:00.000Z', '2026-10-23T12:08:37.442Z');

  INSERT OR IGNORE INTO "competitor_ads" ("id", "advertiserId", "dataSourceId", "externalAdId", "platform", "targetMarket", "headline", "bodyText", "callToAction", "landingPageUrl", "originalAdUrl", "firstSeenAt", "lastSeenAt", "daysRunning", "status", "lifecycleStatus", "category", "dataConfidence", "isSyntheticQuarantine", "createdAt", "updatedAt")
  VALUES
    ('cmvkxf39g0003mug956198pnw', 'adv_uproot_clean', 'ds_meta_ad_library', '1642750633880173', 'META', 'US', 'Uproot Clean Pet Hair Remover - The Original', 'Effortlessly removes embedded pet hair from carpets, couches, and car seats without damaging fabric.', 'Shop Now', 'https://cc.uprootclean.com/products/uproot-cleaner-pro', 'https://www.facebook.com/ads/library/?id=1642750633880173', '2026-10-23T12:08:37.442Z', '2026-10-23T12:08:37.442Z', 30, 'ACTIVE', 'ACTIVE', 'Pet Supplies', 'VERIFIED', 0, '2026-10-23T12:08:37.442Z', '2026-10-23T12:08:37.442Z'),
    ('ad_holdout_uahpet_01', 'adv_uahpet_us', 'ds_meta_ad_library', '1948271645019283', 'META', 'US', 'Automatic Wet Food Cat Feeder with Cooling & Warming', 'Keep wet cat food fresh all day with semiconductor cooling and scheduled meal warming.', 'Shop Now', 'https://uahpet.com/products/uahpet-fresh-food-automatic-pet-feeder', 'https://www.facebook.com/ads/library/?id=1948271645019283', '2026-10-28T10:00:00.000Z', '2026-10-29T10:00:00.000Z', 18, 'ACTIVE', 'ACTIVE', 'Pet Supplies', 'VERIFIED', 0, '2026-10-28T10:00:00.000Z', '2026-10-29T10:00:00.000Z'),
    ('ad_seed_synthetic_bleame_01', 'adv_bleame_demo', 'ds_meta_ad_library', 'meta_bleame_crystal_hair_eraser_01', 'META', 'US', '[SYNTHETIC_DEMO] Say goodbye to strawberry legs and razor bumps', 'Quarantined synthetic seed record', 'Shop Now', 'https://bleame.com/products/crystal-hair-eraser', 'https://www.facebook.com/ads/library/?id=102938475619283', '2026-10-20T00:00:00.000Z', '2026-10-20T00:00:00.000Z', 45, 'INACTIVE', 'INACTIVE', 'Beauty & Personal Care', 'UNAVAILABLE', 1, '2026-10-20T00:00:00.000Z', '2026-10-20T00:00:00.000Z');

  INSERT OR IGNORE INTO "ad_product_links" ("id", "adId", "productId", "confidence", "createdAt")
  VALUES
    ('apl_uproot_01', 'cmvkxf39g0003mug956198pnw', 'prod_uproot_clean_01', 'CONFIRMED', '2026-10-23T12:08:37.442Z'),
    ('apl_uahpet_01', 'ad_holdout_uahpet_01', 'cmvsy7zqh000jp0orhypwohho', 'CONFIRMED', '2026-10-29T02:53:15.305Z');

  INSERT OR IGNORE INTO "discovery_runs" ("id", "workspaceId", "providerId", "status", "runMode", "queryConfigJson", "requestedLimit", "actualRetrievedCount", "validCount", "newUniqueCount", "createdAt", "updatedAt")
  VALUES ('run_seed_baseline_default', 'default-workspace', 'meta-ads-collector', 'COMPLETED', 'MANUAL', '{"keywords":["pet hair remover"]}', 20, 2, 2, 2, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);

  INSERT OR IGNORE INTO "discovery_run_ads" ("id", "runId", "adId", "workspaceId", "providerId", "libraryId", "ingestOutcome", "sourceUrl", "observedAt")
  VALUES
    ('dra_seed_uproot_01', 'run_seed_baseline_default', 'cmvkxf39g0003mug956198pnw', 'default-workspace', 'meta-ads-collector', '1642750633880173', 'CREATED', 'https://www.facebook.com/ads/library/?id=1642750633880173', '2026-10-23T12:08:37.442Z'),
    ('dra_seed_uahpet_01', 'run_seed_baseline_default', 'ad_holdout_uahpet_01', 'default-workspace', 'meta-ads-collector', '1948271645019283', 'CREATED', 'https://www.facebook.com/ads/library/?id=1948271645019283', '2026-10-28T10:00:00.000Z'),
    ('dra_seed_bleame_01', 'run_seed_baseline_default', 'ad_seed_synthetic_bleame_01', 'default-workspace', 'meta-ads-collector', 'meta_bleame_crystal_hair_eraser_01', 'CREATED', 'https://www.facebook.com/ads/library/?id=102938475619283', '2026-10-20T00:00:00.000Z');

  INSERT OR IGNORE INTO "product_demand_observations" ("id", "productId", "source", "region", "keyword", "periodStart", "periodEnd", "demandValue", "valueType", "demandStabilityClass", "observedAt", "evidenceReference", "methodologyVersion")
  VALUES
    ('cmvsy7zsf000rp0orbgbi6tiu', 'cmvsy7zqh000jp0orhypwohho', 'GOOGLE_TRENDS_CSV', 'US', 'Automatic Wet Food Cat Feeder with Cooling & Warming', '2026-06-01T02:53:15.373Z', '2026-06-08T02:53:15.373Z', 76, 'RELATIVE_INTEREST', 'EVERGREEN_STABLE', '2026-06-08T02:53:15.373Z', 'verified-merchant-demand:uahpet.com', '12.4.3'),
    ('cmvsy7zsl000sp0orl8wkum7g', 'cmvsy7zqh000jp0orhypwohho', 'GOOGLE_TRENDS_CSV', 'US', 'Automatic Wet Food Cat Feeder with Cooling & Warming', '2026-07-01T02:53:15.373Z', '2026-07-08T02:53:15.373Z', 79, 'RELATIVE_INTEREST', 'EVERGREEN_STABLE', '2026-07-08T02:53:15.373Z', 'verified-merchant-demand:uahpet.com', '12.4.3'),
    ('cmvsy7zsr000tp0or4w85v2ug', 'cmvsy7zqh000jp0orhypwohho', 'GOOGLE_TRENDS_CSV', 'US', 'Automatic Wet Food Cat Feeder with Cooling & Warming', '2026-07-31T02:53:15.373Z', '2026-08-07T02:53:15.373Z', 77, 'RELATIVE_INTEREST', 'EVERGREEN_STABLE', '2026-08-07T02:53:15.373Z', 'verified-merchant-demand:uahpet.com', '12.4.3'),
    ('cmvsy7zsy000up0oriz6hihpd', 'cmvsy7zqh000jp0orhypwohho', 'GOOGLE_TRENDS_CSV', 'US', 'Automatic Wet Food Cat Feeder with Cooling & Warming', '2026-08-30T02:53:15.373Z', '2026-09-06T02:53:15.373Z', 81, 'RELATIVE_INTEREST', 'EVERGREEN_STABLE', '2026-09-06T02:53:15.373Z', 'verified-merchant-demand:uahpet.com', '12.4.3'),
    ('cmvsy7zt3000vp0orzpca0gas', 'cmvsy7zqh000jp0orhypwohho', 'GOOGLE_TRENDS_CSV', 'US', 'Automatic Wet Food Cat Feeder with Cooling & Warming', '2026-09-29T02:53:15.373Z', '2026-10-06T02:53:15.373Z', 78, 'RELATIVE_INTEREST', 'EVERGREEN_STABLE', '2026-10-06T02:53:15.373Z', 'verified-merchant-demand:uahpet.com', '12.4.3'),
    ('cmvsy7ztc000wp0orr1ypsqg4', 'cmvsy7zqh000jp0orhypwohho', 'GOOGLE_TRENDS_CSV', 'US', 'Automatic Wet Food Cat Feeder with Cooling & Warming', '2026-10-24T02:53:15.373Z', '2026-10-31T02:53:15.373Z', 82, 'RELATIVE_INTEREST', 'EVERGREEN_STABLE', '2026-10-31T02:53:15.373Z', 'verified-merchant-demand:uahpet.com', '12.4.3');
`;

async function ensureSqliteDatabase(dbFilePath: string, schemaSql: string): Promise<void> {
  const dir = path.dirname(dbFilePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  const dbExists = fs.existsSync(dbFilePath) && fs.statSync(dbFilePath).size > 4096;
  if (dbExists) {
    return;
  }
  fs.writeFileSync(dbFilePath, "");
  const client = createClient({ url: `file:${dbFilePath.replace(/\\/g, "/")}` });
  try {
    await client.executeMultiple(schemaSql);
    await client.executeMultiple(BASELINE_CI_SEED_SQL);
  } finally {
    client.close();
  }
}

async function main() {
  const root = process.cwd();
  const withPython = process.argv.includes("--with-python");
  const schemaSqlPath = path.join(root, "prisma", "schema.sql");
  if (!fs.existsSync(schemaSqlPath)) {
    throw new Error(`Missing prisma/schema.sql at ${schemaSqlPath}`);
  }
  const schemaSql = fs.readFileSync(schemaSqlPath, "utf8");

  await ensureSqliteDatabase(path.join(root, "dev.db"), schemaSql);
  await ensureSqliteDatabase(path.join(root, "prisma", "dev.db"), schemaSql);
  console.log("[CI Setup] SQLite baseline schema and seed verified.");

  const pyCmd = process.env.PYTHON || (process.platform === "win32" ? "python" : "python3");
  const metaVenv = path.join(root, "services", "meta-ads-collector", ".venv");
  const metaPy = path.join(
    metaVenv,
    process.platform === "win32" ? path.join("Scripts", "python.exe") : path.join("bin", "python"),
  );
  if (!fs.existsSync(metaPy)) {
    fs.mkdirSync(path.dirname(metaVenv), { recursive: true });
    const res = spawnSync(pyCmd, ["-m", "venv", metaVenv], { cwd: root, stdio: "inherit", shell: false });
    if (res.error || res.status !== 0) {
      throw new Error(`Failed to initialize meta-ads-collector venv: ${res.error?.message || res.status}`);
    }
  }

  if (withPython) {
    const googleVenv = path.join(root, "services", "google-transparency", ".venv");
    const googlePy = path.join(
      googleVenv,
      process.platform === "win32" ? path.join("Scripts", "python.exe") : path.join("bin", "python"),
    );
    if (!fs.existsSync(googlePy)) {
      const npxCmd = process.platform === "win32" ? "npx.cmd" : "npx";
      const res = spawnSync(npxCmd, ["tsx", "scripts/setupKh02FreeProviders.ts"], {
        cwd: root,
        stdio: "inherit",
        shell: false,
      });
      if (res.error || res.status !== 0) {
        throw new Error(`Failed to setup KH-02 free providers: ${res.error?.message || res.status}`);
      }
    }
    console.log("[CI Setup] Python virtual environments verified.");
  }
}

main().catch((err) => {
  console.error("[CI Setup] Fatal error:", err);
  process.exit(1);
});
