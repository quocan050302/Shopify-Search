import path from "path";
import os from "os";
import fs from "fs";
import crypto from "crypto";
import { beforeAll, afterAll } from "vitest";
import { createClient } from "@libsql/client";
import { canonicalizeSqliteDatabasePath } from "@/lib/database/databaseConfig";
import { assertSafeTestDatabase } from "@/lib/database/databaseSafety";

function sanitizeLeakedTestAuthEnv() {
  delete process.env.ADMIN_API_KEY;
  delete process.env.SWAI_ADMIN_TOKEN;
  delete process.env.ADMIN_SECRET;
  delete process.env.SWAI_DEPLOYMENT_MODE;
  delete process.env.SWAI_REMOTE_ACCESS;
  delete process.env.SWAI_REQUIRE_AUTH;
  delete process.env.SWAI_E2E_SERVER;
  process.env.HOST = "127.0.0.1";
}

sanitizeLeakedTestAuthEnv();

beforeAll(() => {
  sanitizeLeakedTestAuthEnv();
});

afterAll(() => {
  sanitizeLeakedTestAuthEnv();
});

// Ensure every Vitest worker runs against a completely isolated SQLite test database
if (!process.env.TEST_DATABASE_URL) {
  const baseIsolatedDir = path.join(os.tmpdir(), "swai-vitest-isolated");
  try {
    if (fs.existsSync(baseIsolatedDir)) {
      const now = Date.now();
      for (const entry of fs.readdirSync(baseIsolatedDir)) {
        if (entry === "cached_schema_template_v2.db") continue;
        const entryPath = path.join(baseIsolatedDir, entry);
        try {
          const stat = fs.statSync(entryPath);
          if (now - stat.mtimeMs > 5 * 60 * 1000) {
            fs.rmSync(entryPath, { recursive: true, force: true });
          }
        } catch {}
      }
    }
  } catch {}
  const uniqueId = `vitest-run-${Date.now()}-${crypto.randomUUID()}`;
  const tempDir = path.join(os.tmpdir(), "swai-vitest-isolated", uniqueId);
  fs.mkdirSync(tempDir, { recursive: true });
  if (false) {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {}
  }
  const isolatedPath = path.join(tempDir, "isolated_test.db");
  const templatePath = fs.existsSync(path.resolve(process.cwd(), "prisma/test_template.db")) && fs.statSync(path.resolve(process.cwd(), "prisma/test_template.db")).size > 0
    ? path.resolve(process.cwd(), "prisma/test_template.db")
    : path.join(baseIsolatedDir, "cached_schema_template_v2.db");
  const schemaSqlPath = path.resolve(process.cwd(), "prisma/schema.sql");

  const testUrl = `file:${isolatedPath.replace(/\\/g, "/")}`;

  if (fs.existsSync(templatePath) && fs.statSync(templatePath).size > 0) {
    fs.copyFileSync(templatePath, isolatedPath);
  } else if (fs.existsSync(schemaSqlPath)) {
    fs.writeFileSync(isolatedPath, "");
    const ddl = fs.readFileSync(schemaSqlPath, "utf8");
    const baselineSeedSql = `
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
        ('adv_bleame_demo', 'bleame_demo_meta', 'META', 'Bleame', 'https://www.facebook.com/bleamebeauty', 'bleame.com', 'US', 'OBSERVED', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);

      INSERT OR IGNORE INTO "competitor_ads" ("id", "advertiserId", "dataSourceId", "externalAdId", "platform", "targetMarket", "headline", "bodyText", "callToAction", "landingPageUrl", "originalAdUrl", "firstSeenAt", "lastSeenAt", "daysRunning", "status", "lifecycleStatus", "category", "dataConfidence", "isSyntheticQuarantine", "createdAt", "updatedAt")
      VALUES
        ('cmvkxf39g0003mug956198pnw', 'adv_uproot_clean', 'ds_meta_ad_library', '1642750633880173', 'META', 'US', 'Uproot Clean Pet Hair Remover - The Original', 'Effortlessly removes embedded pet hair from carpets, couches, and car seats without damaging fabric.', 'Shop Now', 'https://cc.uprootclean.com/main/phr', 'https://www.facebook.com/ads/library/?id=1642750633880173', '2026-10-23T12:08:37.442Z', CURRENT_TIMESTAMP, 30, 'ACTIVE', 'ACTIVE', 'Pet Supplies', 'VERIFIED', 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
        ('ad_seed_synthetic_bleame_01', 'adv_bleame_demo', 'ds_meta_ad_library', 'meta_bleame_crystal_hair_eraser_01', 'META', 'US', '[SYNTHETIC_DEMO] Say goodbye to strawberry legs and razor bumps', 'Quarantined synthetic seed record', 'Shop Now', 'https://bleame.com/products/crystal-hair-eraser', 'https://www.facebook.com/ads/library/?id=102938475619283', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, 45, 'INACTIVE', 'INACTIVE', 'Beauty & Personal Care', 'UNAVAILABLE', 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);

      INSERT OR IGNORE INTO "discovery_runs" ("id", "workspaceId", "providerId", "status", "runMode", "queryConfigJson", "requestedLimit", "actualRetrievedCount", "validCount", "newUniqueCount", "createdAt", "updatedAt")
      VALUES ('run_seed_baseline_default', 'default-workspace', 'meta-ads-collector', 'COMPLETED', 'MANUAL', '{"keywords":["pet hair remover"]}', 20, 2, 2, 2, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);

      INSERT OR IGNORE INTO "discovery_run_ads" ("id", "runId", "adId", "workspaceId", "providerId", "libraryId", "ingestOutcome", "sourceUrl", "observedAt")
      VALUES
        ('dra_seed_uproot_01', 'run_seed_baseline_default', 'cmvkxf39g0003mug956198pnw', 'default-workspace', 'meta-ads-collector', '1642750633880173', 'CREATED', 'https://www.facebook.com/ads/library/?id=1642750633880173', CURRENT_TIMESTAMP),
        ('dra_seed_bleame_01', 'run_seed_baseline_default', 'ad_seed_synthetic_bleame_01', 'default-workspace', 'meta-ads-collector', 'meta_bleame_crystal_hair_eraser_01', 'CREATED', 'https://www.facebook.com/ads/library/?id=102938475619283', CURRENT_TIMESTAMP);
    `;
    const client = createClient({ url: testUrl });
    await client.executeMultiple(ddl);
    await client.executeMultiple(baselineSeedSql);
    client.close();
    try {
      if (!fs.existsSync(templatePath)) {
        fs.copyFileSync(isolatedPath, templatePath);
      }
    } catch {}
  } else {
    fs.writeFileSync(isolatedPath, "");
  }

  process.env.TEST_DATABASE_URL = testUrl;
  process.env.SWAI_TEST_ISOLATION = "strict";

  assertSafeTestDatabase(testUrl, process.env);
}

if (!process.env.HOST) {
  process.env.HOST = "127.0.0.1";
}
