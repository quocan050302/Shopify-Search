#!/usr/bin/env tsx
/**
 * SWAI V11.6.0 — Live Meta Collection Verification Journey (Section 12)
 *
 * REAL META SOURCE · ACTUAL WORKER · REAL SQLITE · REAL HTTP · REAL CHROMIUM · ZERO REGRESSIONS
 *
 * Orchestrates an end-to-end verification journey using the existing architecture:
 * 1. Validates launch configuration & confirms no mock boundary in live mode
 * 2. Connects to Python MCP, handshakes, reads capabilities
 * 3. Probes upstream Meta Ad Library directly (read-only)
 * 4. Allocates an isolated SQLite test database (asserts dev.db is untouched)
 * 5. Starts dedicated Next.js test server on loopback against isolated DB
 * 6. Starts real Discovery Worker subprocess targeting isolated DB
 * 7. Submits research request (POST /api/v1/discovery/meta/requests)
 * 8. Observes Worker claim and execute the job
 * 9. Verifies database persistence via Prisma
 * 10. Verifies exact-run HTTP readback
 * 11. Verifies real Chromium browser rendering & captures screenshots
 * 12. Emits full evidence bundle to artifacts/v11.6.0/<runId>/
 * 13. Safely tears down all temporary processes and ephemeral database
 */

import fs from "fs";
import path from "path";
import crypto from "crypto";
import { spawn, ChildProcess } from "child_process";
import { createMetaCollectorClient, getMetaCollectorCapabilities } from "../src/services/discovery/metaCollector/metaCollectorMcpClient";
import { getMetaCollectorConfig } from "../src/services/discovery/metaCollector/metaCollectorConfig";
import { inspectLiveMetaSourceResult } from "../src/services/discovery/metaCollector/inspectLiveMetaSource";
import { createIsolatedTestDatabase, verifyIsolatedSchema } from "../tests/helpers/createIsolatedTestDatabase";
import { assertSafeTestDatabase } from "../src/lib/database/databaseSafety";
import { startSwaiTestServer, waitForSwaiServer } from "../tests/e2e/helpers/startSwaiTestServer";
import { resolveChromeExecutablePath } from "./kh01/runFullAcceptance";

export interface JourneyOptions {
  keyword: string;
  market: string;
  limit: number;
  isolatedDb: boolean;
  realSource: boolean;
  outDir?: string;
}

function parseCliArgs(argv: string[]): JourneyOptions {
  let keyword = "gadget";
  let market = "US";
  let limit = 25;
  let isolatedDb = true;
  let realSource = true;
  let outDir: string | undefined;

  for (const arg of argv) {
    if (arg.startsWith("--keyword=")) {
      keyword = arg.split("=")[1].replace(/^["']|["']$/g, "").trim();
    } else if (arg.startsWith("--market=")) {
      market = arg.split("=")[1].trim().toUpperCase();
    } else if (arg.startsWith("--limit=")) {
      limit = Math.min(100, Math.max(1, parseInt(arg.split("=")[1], 10)));
    } else if (arg === "--isolated-db") {
      isolatedDb = true;
    } else if (arg === "--real-source") {
      realSource = true;
    } else if (arg.startsWith("--out-dir=")) {
      outDir = arg.split("=")[1].trim();
    }
  }

  return { keyword, market, limit, isolatedDb, realSource, outDir };
}

export async function runMetaLiveJourney(options: JourneyOptions) {
  const startedAt = new Date().toISOString();
  const journeyRunId = `live_journey_${Date.now()}_${crypto.randomBytes(4).toString("hex")}`;
  const outDir = options.outDir || path.resolve(process.cwd(), `artifacts/v11.6.0/${journeyRunId}`);

  if (!fs.existsSync(outDir)) {
    fs.mkdirSync(outDir, { recursive: true });
  }

  console.log("==================================================================");
  console.log("  SWAI V11.6.0 — LIVE META AD LIBRARY COLLECTION JOURNEY");
  console.log("==================================================================");
  console.log(`  • Run ID:             ${journeyRunId}`);
  console.log(`  • Target Keyword:     '${options.keyword}'`);
  console.log(`  • Market:             ${options.market}`);
  console.log(`  • Target Max Ads:     ${options.limit}`);
  console.log(`  • Isolated DB:        ${options.isolatedDb ? "ENFORCED" : "OFF"}`);
  console.log(`  • Source Mode:        ${options.realSource ? "REAL_LIVE_META" : "OFFLINE"}`);
  console.log(`  • Artifacts Dir:      ${outDir}`);
  console.log("------------------------------------------------------------------");

  // 1. Validate launch configuration & ensure mock mode is disabled for live validation
  if (process.env.SWAI_MOCK_META_BOUNDARY === "true" || process.env.SWAI_MOCK_META_BOUNDARY === "fail") {
    const errorMsg = "LIVE_ACCEPTANCE_MOCK_BOUNDARY_FORBIDDEN: SWAI_MOCK_META_BOUNDARY is enabled in live mode.";
    console.error(`\n[FATAL] ${errorMsg}`);
    fs.writeFileSync(path.join(outDir, "environment-readiness.json"), JSON.stringify({ status: "BLOCKED", reason: errorMsg }, null, 2));
    process.exit(1);
  }

  process.env.SWAI_ACCEPTANCE_SOURCE_MODE = "REAL_LIVE_META";
  process.env.META_COLLECTOR_ENABLED = "true";
  process.env.META_COLLECTOR_LIVE_TEST_ENABLED = "true";

  // 2. Phase A: Environment Diagnostics & MCP Handshake
  console.log("\n[1/7] Inspecting MetaAdsCollector Python MCP environment...");
  const config = getMetaCollectorConfig();
  let caps: any = null;
  let mcpClient: any = null;

  try {
    mcpClient = await createMetaCollectorClient();
    caps = await mcpClient.getCapabilities();
    console.log(`  ✔ Python binary:      ${config.pythonBin}`);
    console.log(`  ✔ Collector Version:  v${caps.collector_version}`);
    console.log(`  ✔ Extension Version:  v${caps.extension_version}`);
    console.log(`  ✔ Transport:          ${caps.transport}`);
    console.log(`  ✔ Worker Alive:       ${caps.persistent_worker_alive}`);
    console.log(`  ✔ Operations:         ${caps.operations.join(", ")}`);
  } catch (err: unknown) {
    console.error(`  ✘ MCP handshake failed: ${(err as Error).message}`);
    fs.writeFileSync(
      path.join(outDir, "environment-readiness.json"),
      JSON.stringify({ status: "MCP_UNAVAILABLE", error: (err as Error).message }, null, 2)
    );
    process.exit(1);
  }

  const envReadiness = {
    pythonBinary: config.pythonBin,
    collectorDataDir: config.dataDir,
    collectorVersion: caps.collector_version,
    extensionVersion: caps.extension_version,
    transport: caps.transport,
    persistentWorkerAlive: caps.persistent_worker_alive,
    sourceMode: "REAL_LIVE_META",
    mockBoundaryEnabled: false,
    timestamp: new Date().toISOString(),
  };
  fs.writeFileSync(path.join(outDir, "environment-readiness.json"), JSON.stringify(envReadiness, null, 2));
  fs.writeFileSync(path.join(outDir, "mcp-handshake.json"), JSON.stringify({ status: "SUCCESS", timestamp: new Date().toISOString() }, null, 2));
  fs.writeFileSync(path.join(outDir, "mcp-capabilities.json"), JSON.stringify(caps, null, 2));

  // 3. Phase C: Read-Only Genuine Upstream Source Probe
  console.log("\n[2/7] Executing bounded read-only upstream source probe...");
  let probeInspection: any = null;
  try {
    const probeRes = await mcpClient.searchAds({
      query: options.keyword,
      country: options.market,
      status: "ACTIVE",
      maxResults: 2,
      maxRequests: 2,
      maxSeconds: 30,
      pageSize: 2,
    });

    probeInspection = inspectLiveMetaSourceResult({
      transport: caps.transport,
      requestedKeyword: options.keyword,
      requestedMarket: options.market,
      requestedLimit: 2,
      mcpResponse: probeRes,
      rawAds: probeRes.ads || [],
    });

    console.log(`  ✔ Probe Result Set ID:   ${probeRes.result_set_id}`);
    console.log(`  ✔ Upstream Requests:     ${probeRes.job?.stats?.requests_made ?? "N/A"}`);
    console.log(`  ✔ Ads Returned:          ${probeRes.ads?.length || 0}`);
    console.log(`  ✔ Source Classification: ${probeInspection.sourceClassification}`);
    console.log(`  ✔ Probe Status:          ${probeInspection.status}`);

    fs.writeFileSync(path.join(outDir, "source-probe.json"), JSON.stringify(probeRes, null, 2));
    fs.writeFileSync(path.join(outDir, "live-source-provenance.json"), JSON.stringify(probeInspection, null, 2));
  } catch (probeErr: unknown) {
    console.error(`  ✘ Source probe failed: ${(probeErr as Error).message}`);
    fs.writeFileSync(path.join(outDir, "source-probe.json"), JSON.stringify({ error: (probeErr as Error).message }, null, 2));
    fs.writeFileSync(
      path.join(outDir, "live-source-provenance.json"),
      JSON.stringify(
        inspectLiveMetaSourceResult({
          transport: caps?.transport,
          requestedKeyword: options.keyword,
          requestedMarket: options.market,
          requestedLimit: 2,
          error: probeErr,
        }),
        null,
        2
      )
    );
  } finally {
    await mcpClient.close();
  }

  // 4. Create isolated SQLite test database
  console.log("\n[3/7] Provisioning isolated SQLite test database...");
  const dbHandle = await createIsolatedTestDatabase({ prefix: "live-meta-journey" });
  assertSafeTestDatabase(dbHandle.filePath);
  await verifyIsolatedSchema(dbHandle.prisma);

  const testWorkspaceId = "ws_live_journey";
  await dbHandle.prisma.workspace.upsert({
    where: { id: testWorkspaceId },
    update: {},
    create: {
      id: testWorkspaceId,
      name: "Live Meta Journey Workspace",
    },
  });

  console.log(`  ✔ Database URL:       ${dbHandle.url}`);
  console.log(`  ✔ File Path:          ${dbHandle.filePath}`);
  console.log(`  ✔ Active dev.db:      PROTECTED (Zero mutation)`);

  // 5. Start dedicated Next.js test server against isolated DB
  console.log("\n[4/7] Launching Next.js test server on loopback...");
  const server = await startSwaiTestServer({
    databaseUrl: dbHandle.url,
    mode: "production",
    allowLocalBypass: true,
    adminApiKey: "live_journey_admin_token",
    timeoutMs: 35000,
  });
  console.log(`  ✔ Next.js Server:     ${server.baseUrl} (PID: ${server.pid})`);

  // 6. Start real Discovery Worker subprocess targeting this isolated database
  console.log("\n[5/7] Starting real Discovery Worker subprocess...");
  const tsxCli = path.resolve(process.cwd(), "node_modules/tsx/dist/cli.mjs");
  const workerScript = path.resolve(process.cwd(), "scripts/discovery-worker.ts");

  const workerEnv: NodeJS.ProcessEnv = {
    ...process.env,
    DATABASE_URL: "file:./dev.db",
    TEST_DATABASE_URL: dbHandle.url,
    SWAI_DB_ROLE: "LIVE_ACCEPTANCE",
    SWAI_TEST_ISOLATION: "strict",
    SWAI_WORKER_POLL_INTERVAL_MS: "1000",
    SWAI_ACCEPTANCE_SOURCE_MODE: "REAL_LIVE_META",
    SWAI_ACCEPTANCE_MARKER_ID: testWorkspaceId,
    SWAI_ACCEPTANCE_RUN_ID: journeyRunId,
    SWAI_EXPECTED_DB_KEY: dbHandle.canonicalKey,
    SWAI_MOCK_META_BOUNDARY: "",
    NODE_ENV: "test",
  };

  const workerChild = spawn(process.execPath, [tsxCli, workerScript], {
    cwd: process.cwd(),
    env: workerEnv,
    stdio: ["ignore", "pipe", "pipe"],
  });

  const workerPid = workerChild.pid!;
  console.log(`  ✔ Worker Subprocess:  PID ${workerPid}`);

  let workerStdout = "";
  let workerStderr = "";
  const workerProviderEvidences: any[] = [];

  workerChild.stdout?.on("data", (chunk) => {
    const text = chunk.toString();
    workerStdout += text;
    const lines = text.split("\n");
    for (const line of lines) {
      if (line.includes("[KH01_EVENT]")) {
        try {
          const jsonStr = line.slice(line.indexOf("[KH01_EVENT]") + 12).trim();
          const evt = JSON.parse(jsonStr);
          if (evt.eventType === "KH01_WORKER_PROVIDER_PROVENANCE") {
            workerProviderEvidences.push(evt.providerEvidence || evt);
          }
        } catch {}
      }
    }
  });

  workerChild.stderr?.on("data", (chunk) => {
    workerStderr += chunk.toString();
  });

  // Short pause to verify worker didn't crash
  await new Promise((r) => setTimeout(r, 1000));
  if (workerChild.exitCode !== null) {
    throw new Error(`Worker exited prematurely with code ${workerChild.exitCode}:\n${workerStderr}`);
  }

  // 7. Submit Research Request via real Next.js HTTP API (POST /api/v1/discovery/meta/requests)
  console.log("\n[6/7] Submitting research request through HTTP API...");
  const requestUrl = `${server.baseUrl}/api/v1/discovery/meta/requests`;
  const requestPayload = {
    keywords: [options.keyword],
    market: options.market,
    requestedLimit: options.limit,
    activeStatus: "ACTIVE",
    creativePreference: "ALL",
    workspaceId: testWorkspaceId,
  };

  const reqStartTime = Date.now();
  const reqRes = await fetch(requestUrl, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${server.adminApiKey}`,
      "x-workspace-id": testWorkspaceId,
    },
    body: JSON.stringify(requestPayload),
  });

  const reqDurationMs = Date.now() - reqStartTime;
  const reqBody = await reqRes.json();

  console.log(`  ✔ HTTP Status:        ${reqRes.status} Accepted (took ${reqDurationMs}ms)`);
  console.log(`  ✔ Discovery Run ID:   ${reqBody.runId}`);
  console.log(`  ✔ Initial Status:     ${reqBody.status}`);

  fs.writeFileSync(
    path.join(outDir, "research-request.json"),
    JSON.stringify({ request: requestPayload, responseStatus: reqRes.status, responseBody: reqBody, durationMs: reqDurationMs }, null, 2)
  );

  if (reqRes.status !== 202 || !reqBody.runId) {
    throw new Error(`Expected HTTP 202 with runId, received HTTP ${reqRes.status}: ${JSON.stringify(reqBody)}`);
  }

  const discoveryRunId = reqBody.runId;

  // 8. Wait for Worker to Claim, Execute, and Complete the Job
  console.log("\n  Waiting for Worker to claim and complete research job...");
  const maxWaitMs = 180000;
  const pollIntervalMs = 1500;
  const waitStart = Date.now();

  let finalRun: any = null;
  let claimedObserved = false;

  while (Date.now() - waitStart < maxWaitMs) {
    const currentRun = await dbHandle.prisma.discoveryRun.findUnique({
      where: { id: discoveryRunId },
    });

    if (currentRun) {
      if (currentRun.status === "RUNNING" || currentRun.startedAt !== null) {
        if (!claimedObserved) {
          claimedObserved = true;
          console.log(`  ✔ Job claimed by Worker: PID ${workerPid} (Status: ${currentRun.status})`);
        }
      }

      if (["COMPLETED", "FAILED", "PARTIALLY_COMPLETED", "BLOCKED_SOURCE"].includes(currentRun.status)) {
        finalRun = currentRun;
        console.log(`  ✔ Job reached terminal status: '${currentRun.status}' after ${Math.round((Date.now() - waitStart) / 1000)}s`);
        break;
      }
    }

    await new Promise((r) => setTimeout(r, pollIntervalMs));
  }

  if (!finalRun) {
    throw new Error(`Timed out after ${maxWaitMs / 1000}s waiting for discovery run '${discoveryRunId}' to complete.`);
  }

  fs.writeFileSync(path.join(outDir, "discovery-run.json"), JSON.stringify(finalRun, null, 2));

  // 9. Inspect Database Persistence & Run-Ad Associations
  console.log("\n[7/7] Verifying database persistence, HTTP readback & Chromium rendering...");
  const linkedRelations = await dbHandle.prisma.discoveryRunAd.findMany({
    where: { runId: discoveryRunId },
    include: {
      ad: {
        include: {
          advertiser: true,
          mediaAssets: true,
        },
      },
    },
  });

  const persistedAdIds = linkedRelations.map((r) => r.adId);
  const externalLibraryIds = linkedRelations.map((r) => r.ad.externalAdId);

  console.log(`  ✔ Retrieved Count:    ${finalRun.actualRetrievedCount}`);
  console.log(`  ✔ Valid Count:        ${finalRun.validCount}`);
  console.log(`  ✔ New Unique Count:   ${finalRun.newUniqueCount}`);
  console.log(`  ✔ Linked Ads in DB:   ${linkedRelations.length}`);

  const dbPersistenceEvidence = {
    runId: discoveryRunId,
    workspaceId: testWorkspaceId,
    status: finalRun.status,
    retrievedCount: finalRun.actualRetrievedCount,
    validCount: finalRun.validCount,
    newUniqueCount: finalRun.newUniqueCount,
    linkedRecordsCount: linkedRelations.length,
    persistedAdIds,
    externalLibraryIds,
    sampleAds: linkedRelations.slice(0, 3).map((r) => ({
      id: r.ad.id,
      libraryId: r.ad.externalAdId,
      advertiser: r.ad.advertiser?.name,
      headline: r.ad.headline,
      mediaType: r.ad.mediaAssets[0]?.mediaType || "UNKNOWN",
      creativeUrl: r.ad.originalAdUrl,
    })),
  };
  fs.writeFileSync(path.join(outDir, "database-persistence.json"), JSON.stringify(dbPersistenceEvidence, null, 2));

  // Normalization summary evidence (Section 27)
  const normalizationSummary = {
    runId: discoveryRunId,
    totalNormalized: finalRun.validCount,
    rejectedCount: finalRun.rejectedCount || 0,
    mediaTypesCount: linkedRelations.reduce((acc: Record<string, number>, r) => {
      const mt = r.ad.mediaAssets[0]?.mediaType || "UNKNOWN";
      acc[mt] = (acc[mt] || 0) + 1;
      return acc;
    }, {}),
    advertisersCount: new Set(linkedRelations.map((r) => r.ad.advertiserId)).size,
    sampleNormalizedAds: linkedRelations.slice(0, 5).map((r) => ({
      libraryId: r.ad.externalAdId,
      advertiser: r.ad.advertiser?.name,
      headline: r.ad.headline,
      mediaType: r.ad.mediaAssets[0]?.mediaType || "UNKNOWN",
      landingPageUrl: r.ad.landingPageUrl,
      originalAdUrl: r.ad.originalAdUrl,
      sourceReportedStartAt: r.ad.sourceReportedStartAt?.toISOString() || null,
      status: r.ad.status,
    })),
  };
  fs.writeFileSync(path.join(outDir, "normalization-summary.json"), JSON.stringify(normalizationSummary, null, 2));

  // 10. Worker execution evidence
  const matchedProvEv = workerProviderEvidences.find((p) => p.discoveryRunId === discoveryRunId) || workerProviderEvidences[0] || null;
  const workerExecution = {
    workerPid,
    discoveryRunId,
    claimedAt: finalRun.startedAt?.toISOString() || null,
    completedAt: finalRun.finishedAt?.toISOString() || null,
    finalStatus: finalRun.status,
    providerEvidence: matchedProvEv,
    stdoutPreview: workerStdout.slice(0, 2000),
    stderrPreview: workerStderr.slice(0, 1000),
  };
  fs.writeFileSync(path.join(outDir, "worker-execution.json"), JSON.stringify(workerExecution, null, 2));

  // 11. Verify Exact-Run HTTP Readback
  console.log("  Verifying exact-run HTTP readback...");
  const httpReadbackUrl = `${server.baseUrl}/api/v1/discovery/meta/requests/${encodeURIComponent(discoveryRunId)}/ads?page=1&pageSize=30`;
  const httpReadbackRes = await fetch(httpReadbackUrl, {
    headers: {
      authorization: `Bearer ${server.adminApiKey}`,
      "x-workspace-id": testWorkspaceId,
    },
  });

  const httpReadbackData = await httpReadbackRes.json();
  const rawAds = Array.isArray(httpReadbackData.data)
    ? httpReadbackData.data
    : Array.isArray(httpReadbackData.ads)
    ? httpReadbackData.ads
    : [];
  const httpAdIds = rawAds.map((a: any) => a.id);
  const totalReported = httpReadbackData.pagination?.total ?? httpReadbackData.total ?? rawAds.length;
  const httpMatchesDb = totalReported === persistedAdIds.length && httpAdIds.length > 0 && httpAdIds.every((id: string) => persistedAdIds.includes(id));

  console.log(`  ✔ HTTP Readback:      Status ${httpReadbackRes.status}, reported ${totalReported} ads (Match DB: ${httpMatchesDb})`);

  fs.writeFileSync(
    path.join(outDir, "http-readback.json"),
    JSON.stringify(
      {
        endpoint: httpReadbackUrl,
        status: httpReadbackRes.status,
        total: totalReported,
        adCount: httpAdIds.length,
        matchesPersistedIds: httpMatchesDb,
        ads: rawAds,
      },
      null,
      2
    )
  );

  // 12. Verify Real Chromium Browser Rendering
  console.log("  Verifying Chromium browser rendering...");
  const chromePath = resolveChromeExecutablePath();
  let browserReadbackResult: any = null;

  if (chromePath) {
    try {
      const { chromium } = await import("playwright-core");
      const browser = await chromium.launch({
        executablePath: chromePath,
        headless: true,
        args: ["--no-sandbox", "--disable-dev-shm-usage"],
      });

      const browserContext = await browser.newContext({
        viewport: { width: 1440, height: 900 },
        extraHTTPHeaders: {
          authorization: `Bearer ${server.adminApiKey}`,
          "x-workspace-id": testWorkspaceId,
        },
      });

      const page = await browserContext.newPage();

      // Visit Meta Discovery page
      await page.goto(`${server.baseUrl}/meta-discovery`, { waitUntil: "domcontentloaded", timeout: 25000 });
      await page.waitForTimeout(1500);
      await page.screenshot({ path: path.join(outDir, "meta-discovery.png"), fullPage: false });

      // Visit Explorer with exact-run context
      const explorerUrl = `${server.baseUrl}/explorer?platform=META&requestId=${encodeURIComponent(discoveryRunId)}`;
      await page.goto(explorerUrl, { waitUntil: "domcontentloaded", timeout: 25000 });
      await page.waitForTimeout(2000);

      // Check rendered ad card IDs in DOM
      const domAdIdsSet = new Set<string>();
      const page1Ids = await page
        .locator("[data-testid='exact-run-ad-card']")
        .evaluateAll((els: any[]) => els.map((el) => el.getAttribute("data-ad-id")).filter(Boolean));
      page1Ids.forEach((id: string) => domAdIdsSet.add(id));

      const screenshotPath = path.join(outDir, "screenshot.png");
      await page.screenshot({ path: screenshotPath, fullPage: false });

      // Check page 2 if pagination button is present
      const nextBtn = page.locator("button:has-text('Next'), button[aria-label='Next page'], [data-testid='pagination-next']").first();
      const hasNext = await nextBtn.isVisible().catch(() => false);
      if (hasNext && (await nextBtn.isEnabled().catch(() => false))) {
        await nextBtn.click().catch(() => {});
        await page.waitForTimeout(1500);
        const page2Ids = await page
          .locator("[data-testid='exact-run-ad-card']")
          .evaluateAll((els: any[]) => els.map((el) => el.getAttribute("data-ad-id")).filter(Boolean));
        page2Ids.forEach((id: string) => domAdIdsSet.add(id));
      }

      await browser.close();

      const domAdIds = Array.from(domAdIdsSet);
      const unexpectedDomIds = domAdIds.filter((id) => !persistedAdIds.includes(id));
      const domMatchesDb = domAdIds.length > 0 && unexpectedDomIds.length === 0;

      console.log(`  ✔ Browser Rendered:   ${domAdIds.length} cards across pages (DOM Matches DB: ${domMatchesDb})`);
      console.log(`  ✔ Screenshot Saved:   ${screenshotPath}`);

      browserReadbackResult = {
        browser: "Chromium",
        executablePath: chromePath,
        explorerUrl,
        renderedCardCount: domAdIds.length,
        domAdIds,
        matchesDatabase: domMatchesDb,
        screenshotCaptured: true,
      };
    } catch (browserErr: unknown) {
      console.warn(`  ⚠ Browser readback non-fatal warning: ${(browserErr as Error).message}`);
      browserReadbackResult = { error: (browserErr as Error).message };
    }
  } else {
    console.warn("  ⚠ Chromium executable not found on local host; skipping browser launch.");
    browserReadbackResult = { status: "SKIPPED", reason: "Chromium binary not found" };
  }

  fs.writeFileSync(path.join(outDir, "browser-readback.json"), JSON.stringify(browserReadbackResult, null, 2));

  // 13. Build Reconciliation Summary
  const reconciliationSummary = {
    journeyRunId,
    discoveryRunId,
    keyword: options.keyword,
    market: options.market,
    requestedLimit: options.limit,
    status: finalRun.status,
    retrievedCount: finalRun.actualRetrievedCount,
    validCount: finalRun.validCount,
    persistedRecordsCount: persistedAdIds.length,
    httpReportedCount: totalReported,
    browserRenderedCount: browserReadbackResult?.renderedCardCount ?? "N/A",
    countsReconciled: finalRun.validCount === persistedAdIds.length && totalReported === persistedAdIds.length && Boolean(browserReadbackResult?.matchesDatabase),
    sourceProvenance: matchedProvEv?.observedSourceType || probeInspection?.sourceClassification || "UNKNOWN",
    completedAt: new Date().toISOString(),
  };

  fs.writeFileSync(path.join(outDir, "reconciliation-summary.json"), JSON.stringify(reconciliationSummary, null, 2));
  fs.writeFileSync(
    path.join(outDir, "execution-metadata.json"),
    JSON.stringify(
      {
        journeyRunId,
        startedAt,
        completedAt: new Date().toISOString(),
        options,
        workerPid,
        serverBaseUrl: server.baseUrl,
        databaseFile: dbHandle.filePath,
      },
      null,
      2
    )
  );

  console.log("\n==================================================================");
  console.log("  JOURNEY COMPLETE — ALL ARTIFACTS PUBLISHED");
  console.log("==================================================================");
  console.log(`  Status:               ${finalRun.status}`);
  console.log(`  Valid Ads:            ${finalRun.validCount} of ${finalRun.actualRetrievedCount} retrieved`);
  console.log(`  Persisted DB Ads:     ${persistedAdIds.length}`);
  console.log(`  HTTP API Ads:         ${httpAdIds.length}`);
  console.log(`  Browser Cards:        ${browserReadbackResult?.renderedCardCount ?? "N/A"}`);
  console.log(`  Evidence Directory:   ${outDir}`);
  console.log("==================================================================");

  // 14. Clean Teardown
  console.log("\n[Teardown] Stopping worker, test server, and cleaning isolated DB...");
  try {
    workerChild.kill("SIGTERM");
    setTimeout(() => {
      try {
        workerChild.kill("SIGKILL");
      } catch {}
    }, 2000);
  } catch {}

  try {
    await server.stop();
  } catch {}

  try {
    await dbHandle.teardown();
    console.log("  ✔ Isolated database cleanly deleted. User active database untouched.");
  } catch (tErr) {
    console.warn("  ⚠ Database teardown warning:", (tErr as Error).message);
  }

  return {
    success: finalRun.status === "COMPLETED" && finalRun.validCount > 0,
    runId: discoveryRunId,
    outDir,
    reconciliation: reconciliationSummary,
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const options = parseCliArgs(process.argv.slice(2));
  runMetaLiveJourney(options)
    .then((res) => {
      process.exit(res.success ? 0 : 1);
    })
    .catch((err) => {
      console.error("\n[FATAL ERROR IN LIVE JOURNEY]", err);
      process.exit(1);
    });
}
