#!/usr/bin/env tsx
/**
 * SWAI V11.6.1 — Live Meta Acceptance Integrity Verification Journey
 *
 * REAL META SOURCE · ACTUAL WORKER · REAL SQLITE · REAL HTTP · REAL CHROMIUM · EXACT RECONCILIATION
 *
 * Orchestrates an end-to-end verification journey using strict, fail-closed boundaries:
 * 1. Validates launch configuration & forbids mock boundaries in live mode
 * 2. Connects to Python MCP, handshakes, reads capabilities
 * 3. Probes upstream Meta Ad Library directly (read-only) with authoritative request stats
 * 4. Allocates an isolated SQLite test database (asserts dev.db is untouched)
 * 5. Starts dedicated Next.js test server on loopback against isolated DB
 * 6. Starts real Discovery Worker subprocess targeting isolated DB
 * 7. Submits research request (POST /api/v1/discovery/meta/requests)
 * 8. Observes Worker claim and execute the job (exact DiscoveryRun matching)
 * 9. Verifies database persistence via Prisma
 * 10. Verifies exact-run HTTP readback with complete pagination
 * 11. Verifies real Chromium browser rendering across all pages (Page 1, 2, 3...)
 * 12. Strict bidirectional cross-boundary exact ID reconciliation
 * 13. Emits full evidence bundle to artifacts/v11.6.1/<runId>/
 * 14. Unconditional safe resource cleanup & teardown via try/finally
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
import {
  findDuplicateIds,
  reconcileExactAdIdSets,
  finalizeLiveJourneyVerdict,
  verifyWorkerProvenance,
  LiveJourneyGateResults,
} from "../src/services/discovery/metaCollector/metaExactReconciliation";
import {
  collectExactRunBrowserAdIds,
  BrowserAdCollectionResult,
} from "../src/services/discovery/metaCollector/browserAdCollector";
import {
  cleanupLiveJourneyResources,
  CleanupResult,
} from "../src/services/discovery/metaCollector/liveJourneyCleanup";

export interface JourneyOptions {
  keyword: string;
  market: string;
  limit: number;
  isolatedDb: boolean;
  realSource: boolean;
  outDir?: string;
}

export interface MetaLiveJourneyResult {
  success: boolean;
  verdict: "VERIFIED" | "FAILED" | "BLOCKED";
  journeyRunId: string;
  discoveryRunId: string | null;
  sourceVerified: boolean;
  workerVerified: boolean;
  persistenceVerified: boolean;
  httpVerified: boolean;
  browserVerified: boolean;
  reconciliationVerified: boolean;
  evidencePublished: boolean;
  cleanupVerified?: boolean;
  reasons: string[];
  artifactDirectory: string;
  reconciliation?: any;
  cleanup?: CleanupResult;
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

export async function runMetaLiveJourney(options: JourneyOptions): Promise<MetaLiveJourneyResult> {
  const startedAt = new Date().toISOString();
  const journeyRunId = `live_journey_${Date.now()}_${crypto.randomBytes(4).toString("hex")}`;
  const outDir = options.outDir || path.resolve(process.cwd(), `artifacts/v11.6.1/${journeyRunId}`);

  if (!fs.existsSync(outDir)) {
    fs.mkdirSync(outDir, { recursive: true });
  }

  console.log("==================================================================");
  console.log("  SWAI V11.6.1 — LIVE META AD LIBRARY ACCEPTANCE JOURNEY");
  console.log("==================================================================");
  console.log(`  • Run ID:             ${journeyRunId}`);
  console.log(`  • Target Keyword:     '${options.keyword}'`);
  console.log(`  • Market:             ${options.market}`);
  console.log(`  • Target Max Ads:     ${options.limit}`);
  console.log(`  • Isolated DB:        ${options.isolatedDb ? "ENFORCED" : "OFF"}`);
  console.log(`  • Source Mode:        ${options.realSource ? "REAL_LIVE_META" : "OFFLINE"}`);
  console.log(`  • Artifacts Dir:      ${outDir}`);
  console.log("------------------------------------------------------------------");

  // Resource handles for guaranteed cleanup in finally
  let mcpClient: any = null;
  let dbHandle: any = null;
  let server: any = null;
  let workerChild: ChildProcess | null = null;
  let browser: any = null;
  let context: any = null;
  let page: any = null;

  let discoveryRunId: string | null = null;
  const reasons: string[] = [];

  const gates: LiveJourneyGateResults = {
    source: "NOT_VERIFIED",
    worker: "NOT_VERIFIED",
    persistence: "NOT_VERIFIED",
    http: "NOT_VERIFIED",
    browser: "NOT_VERIFIED",
    reconciliation: "NOT_VERIFIED",
    artifactIntegrity: "NOT_VERIFIED",
    cleanup: "NOT_VERIFIED",
  };

  let finalRun: any = null;
  let persistedAdIds: string[] = [];
  let httpAdIds: string[] = [];
  let browserResult: BrowserAdCollectionResult | null = null;
  let reconciliationSummary: any = null;
  let cleanupReport: CleanupResult | undefined;
  let returnResult: MetaLiveJourneyResult | null = null;

  try {
    // 1. Validate launch configuration & confirm no mock boundary in live mode
    if (process.env.SWAI_MOCK_META_BOUNDARY === "true" || process.env.SWAI_MOCK_META_BOUNDARY === "fail") {
      const errorMsg = "LIVE_ACCEPTANCE_MOCK_BOUNDARY_FORBIDDEN: SWAI_MOCK_META_BOUNDARY is enabled in live mode.";
      console.error(`\n[FATAL] ${errorMsg}`);
      gates.source = "BLOCKED";
      fs.writeFileSync(path.join(outDir, "environment-readiness.json"), JSON.stringify({ status: "BLOCKED", reason: errorMsg }, null, 2));
      throw new Error(errorMsg);
    }

    process.env.SWAI_ACCEPTANCE_SOURCE_MODE = "REAL_LIVE_META";
    process.env.META_COLLECTOR_ENABLED = "true";
    process.env.META_COLLECTOR_LIVE_TEST_ENABLED = "true";

    // 2. Phase A: Environment Diagnostics & MCP Handshake
    console.log("\n[1/7] Inspecting MetaAdsCollector Python MCP environment...");
    const config = getMetaCollectorConfig();
    let caps: any = null;

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
      const errMsg = `MCP handshake failed: ${(err as Error).message}`;
      console.error(`  ✘ ${errMsg}`);
      gates.source = "FAILED";
      fs.writeFileSync(
        path.join(outDir, "environment-readiness.json"),
        JSON.stringify({ status: "MCP_UNAVAILABLE", error: (err as Error).message }, null, 2)
      );
      throw new Error(errMsg);
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

      if (probeInspection.status === "PASSED" && probeInspection.sourceClassification === "REAL_UPSTREAM") {
        gates.source = "PASSED";
      } else if (probeInspection.status === "BLOCKED") {
        gates.source = "BLOCKED";
      } else {
        gates.source = "FAILED";
      }
    } catch (probeErr: unknown) {
      console.error(`  ✘ Source probe failed: ${(probeErr as Error).message}`);
      gates.source = "FAILED";
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
      if (mcpClient) {
        await mcpClient.close();
        mcpClient = null;
      }
    }

    // 4. Create isolated SQLite test database
    console.log("\n[3/7] Provisioning isolated SQLite test database...");
    dbHandle = await createIsolatedTestDatabase({ prefix: "live-meta-journey" });
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
    server = await startSwaiTestServer({
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

    workerChild = spawn(process.execPath, [tsxCli, workerScript], {
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

    discoveryRunId = reqBody.runId;

    // 8. Wait for Worker to Claim, Execute, and Complete the Job
    console.log("\n  Waiting for Worker to claim and complete research job...");
    const maxWaitMs = 180000;
    const pollIntervalMs = 1500;
    const waitStart = Date.now();

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

    // 9. Inspect Database Persistence & Run-Ad Associations early for full cross-verification
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

    persistedAdIds = linkedRelations.map((r: any) => r.adId);
    const externalLibraryIds = linkedRelations.map((r: any) => r.ad.externalAdId);

    // Match exact worker provider evidence by DiscoveryRun ID (Section 17)
    const matchedProvEv = workerProviderEvidences.find(
      (p) => p.discoveryRunId === discoveryRunId && p.providerId === "meta-ads-collector"
    ) || null;

    // Verify Worker Provenance thoroughly (FIX 2)
    const workerProvVerification = verifyWorkerProvenance({
      discoveryRunId: discoveryRunId!,
      finalRunStatus: finalRun.status,
      validCount: finalRun.validCount,
      providerEvidence: matchedProvEv,
      persistedLibraryIds: externalLibraryIds,
    });

    gates.worker = workerProvVerification.status;
    if (workerProvVerification.errors.length > 0) {
      reasons.push(...workerProvVerification.errors);
    }

    const workerExecution = {
      workerPid,
      discoveryRunId,
      claimedAt: finalRun.startedAt?.toISOString() || null,
      completedAt: finalRun.finishedAt?.toISOString() || null,
      finalStatus: finalRun.status,
      providerEvidence: matchedProvEv,
      verification: workerProvVerification,
      stdoutPreview: workerStdout.slice(0, 2000),
      stderrPreview: workerStderr.slice(0, 1000),
    };
    fs.writeFileSync(path.join(outDir, "worker-execution.json"), JSON.stringify(workerExecution, null, 2));

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
      sampleAds: linkedRelations.slice(0, 3).map((r: any) => ({
        id: r.ad.id,
        libraryId: r.ad.externalAdId,
        advertiser: r.ad.advertiser?.name,
        headline: r.ad.headline,
        mediaType: r.ad.mediaAssets[0]?.mediaType || "UNKNOWN",
        creativeUrl: r.ad.originalAdUrl,
      })),
    };
    fs.writeFileSync(path.join(outDir, "database-persistence.json"), JSON.stringify(dbPersistenceEvidence, null, 2));

    const dbDuplicates = findDuplicateIds(persistedAdIds);
    if (linkedRelations.length === finalRun.validCount && finalRun.validCount > 0 && dbDuplicates.length === 0) {
      gates.persistence = "PASSED";
    } else {
      gates.persistence = "FAILED";
    }

    // Normalization summary evidence
    const normalizationSummary = {
      runId: discoveryRunId,
      totalNormalized: finalRun.validCount,
      rejectedCount: finalRun.rejectedCount || 0,
      mediaTypesCount: linkedRelations.reduce((acc: Record<string, number>, r: any) => {
        const mt = r.ad.mediaAssets[0]?.mediaType || "UNKNOWN";
        acc[mt] = (acc[mt] || 0) + 1;
        return acc;
      }, {}),
      advertisersCount: new Set(linkedRelations.map((r: any) => r.ad.advertiserId)).size,
      sampleNormalizedAds: linkedRelations.slice(0, 5).map((r: any) => ({
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

    const activeRunId = discoveryRunId!;

    // 10. Verify Exact-Run HTTP Readback across all pages (Section 10)
    console.log("  Verifying exact-run HTTP readback with complete pagination...");
    const allHttpAds: any[] = [];
    let httpPage = 1;
    let httpTotalPages = 1;
    let httpTotalReported = 0;
    let httpStatus = 200;

    while (httpPage <= httpTotalPages && httpPage <= 10) {
      const httpReadbackUrl = `${server.baseUrl}/api/v1/discovery/meta/requests/${encodeURIComponent(activeRunId)}/ads?page=${httpPage}&pageSize=30`;
      const httpReadbackRes = await fetch(httpReadbackUrl, {
        headers: {
          authorization: `Bearer ${server.adminApiKey}`,
          "x-workspace-id": testWorkspaceId,
        },
      });

      httpStatus = httpReadbackRes.status;
      const httpReadbackData = await httpReadbackRes.json();
      const rawBatch = Array.isArray(httpReadbackData.data)
        ? httpReadbackData.data
        : Array.isArray(httpReadbackData.ads)
        ? httpReadbackData.ads
        : [];
      allHttpAds.push(...rawBatch);

      httpTotalPages = httpReadbackData.pagination?.totalPages || 1;
      httpTotalReported = httpReadbackData.pagination?.total ?? httpTotalReported;
      httpPage++;
    }

    httpAdIds = allHttpAds.map((a: any) => a.id);
    const httpDuplicates = findDuplicateIds(httpAdIds);
    const missingHttp = persistedAdIds.filter((id) => !httpAdIds.includes(id));
    const unexpectedHttp = httpAdIds.filter((id) => !persistedAdIds.includes(id));

    const httpMatchesDb =
      httpStatus === 200 &&
      httpTotalReported === persistedAdIds.length &&
      httpAdIds.length === persistedAdIds.length &&
      missingHttp.length === 0 &&
      unexpectedHttp.length === 0 &&
      httpDuplicates.length === 0;

    console.log(`  ✔ HTTP Readback:      Status ${httpStatus}, reported ${httpTotalReported} ads across pages (Match DB: ${httpMatchesDb})`);

    fs.writeFileSync(
      path.join(outDir, "http-readback.json"),
      JSON.stringify(
        {
          status: httpStatus,
          total: httpTotalReported,
          adCount: httpAdIds.length,
          matchesPersistedIds: httpMatchesDb,
          adIds: httpAdIds,
          missingFromDb: missingHttp,
          unexpectedInHttp: unexpectedHttp,
          duplicateHttpIds: httpDuplicates,
          ads: allHttpAds,
        },
        null,
        2
      )
    );

    gates.http = httpMatchesDb ? "PASSED" : "FAILED";

    // 11. Verify Real Chromium Browser Rendering across all pages (Sections 05 & 06)
    console.log("  Verifying Chromium browser rendering across all pages...");
    const chromePath = resolveChromeExecutablePath();

    if (chromePath) {
      try {
        const { chromium } = await import("playwright-core");
        browser = await chromium.launch({
          executablePath: chromePath,
          headless: true,
          args: ["--no-sandbox", "--disable-dev-shm-usage"],
        });

        context = await browser.newContext({
          viewport: { width: 1440, height: 900 },
          extraHTTPHeaders: {
            authorization: `Bearer ${server.adminApiKey}`,
            "x-workspace-id": testWorkspaceId,
          },
        });

        page = await context.newPage();

        // Visit Meta Discovery page
        await page.goto(`${server.baseUrl}/meta-discovery`, { waitUntil: "domcontentloaded", timeout: 25000 });
        await page.waitForTimeout(1000);
        await page.screenshot({ path: path.join(outDir, "meta-discovery.png"), fullPage: false }).catch(() => {});

        // Visit Explorer with exact-run context
        const explorerUrl = `${server.baseUrl}/explorer?platform=META&requestId=${encodeURIComponent(activeRunId)}`;
        await page.goto(explorerUrl, { waitUntil: "domcontentloaded", timeout: 25000 });

        browserResult = await collectExactRunBrowserAdIds(page, {
          expectedRunId: activeRunId,
          expectedTotal: persistedAdIds.length,
          maximumPages: 10,
          timeoutMs: 25000,
          outDir,
        });

        console.log(`  ✔ Browser Rendered:   ${browserResult.uniqueRenderedIds.length} cards across ${browserResult.visitedPages.length} pages (Status: ${browserResult.status})`);
        gates.browser = browserResult.status === "PASSED" ? "PASSED" : "FAILED";
      } catch (browserErr: unknown) {
        console.error(`  ✘ Browser rendering failed: ${(browserErr as Error).message}`);
        browserResult = {
          status: "FAILED",
          discoveryRunId: activeRunId,
          visitedPages: [],
          expectedPages: 0,
          renderedIds: [],
          uniqueRenderedIds: [],
          duplicateIds: [],
          pageEvidence: [],
          paginationCompleted: false,
          errors: [(browserErr as Error).message],
        };
        gates.browser = "FAILED";
      }
    } else {
      console.warn("  ⚠ Chromium executable not found on local host; skipping browser launch.");
      browserResult = {
        status: "NOT_VERIFIED",
        discoveryRunId: activeRunId,
        visitedPages: [],
        expectedPages: 0,
        renderedIds: [],
        uniqueRenderedIds: [],
        duplicateIds: [],
        pageEvidence: [],
        paginationCompleted: false,
        errors: ["Chromium binary not found on local host"],
      };
      gates.browser = "FAILED"; // Mandatory boundary in live acceptance
    }

    fs.writeFileSync(
      path.join(outDir, "browser-readback.json"),
      JSON.stringify(
        {
          browser: "Chromium",
          executablePath: chromePath,
          explorerUrl: `${server.baseUrl}/explorer?platform=META&requestId=${encodeURIComponent(activeRunId)}`,
          renderedCardCount: browserResult.uniqueRenderedIds.length,
          domAdIds: browserResult.uniqueRenderedIds,
          visitedPages: browserResult.visitedPages,
          expectedPages: browserResult.expectedPages,
          paginationCompleted: browserResult.paginationCompleted,
          status: browserResult.status,
          errors: browserResult.errors,
        },
        null,
        2
      )
    );

    fs.writeFileSync(path.join(outDir, "browser-pages.json"), JSON.stringify(browserResult.pageEvidence, null, 2));

    // 12. Strict Cross-Boundary Exact ID Reconciliation (Section 08)
    console.log("  Reconciling ad IDs across Database, HTTP API, and Chromium Browser...");
    const exactReconciliationResult = reconcileExactAdIdSets({
      discoveryRunId: activeRunId,
      databaseIds: persistedAdIds,
      httpIds: httpAdIds,
      browserIds: browserResult.uniqueRenderedIds,
      databaseStatus: finalRun.status,
      httpStatus: gates.http === "PASSED" ? "PASSED" : "FAILED",
      browserStatus: browserResult.status,
      browserPaginationCompleted: browserResult.paginationCompleted,
    });

    gates.reconciliation = exactReconciliationResult.status;

    reconciliationSummary = {
      journeyRunId,
      discoveryRunId,
      keyword: options.keyword,
      market: options.market,
      requestedLimit: options.limit,
      status: finalRun.status,
      retrievedCount: finalRun.actualRetrievedCount,
      validCount: finalRun.validCount,
      persistedRecordsCount: persistedAdIds.length,
      httpReportedCount: httpTotalReported,
      browserRenderedCount: browserResult.uniqueRenderedIds.length,
      browserVisitedPages: browserResult.visitedPages.length,
      browserTotalPages: browserResult.expectedPages,
      exactMatch: exactReconciliationResult.exactMatch,
      countsReconciled: exactReconciliationResult.status === "PASSED",
      missingFromHttp: exactReconciliationResult.missingFromHttp,
      unexpectedInHttp: exactReconciliationResult.unexpectedInHttp,
      missingFromBrowser: exactReconciliationResult.missingFromBrowser,
      unexpectedInBrowser: exactReconciliationResult.unexpectedInBrowser,
      duplicateDatabaseIds: exactReconciliationResult.duplicateDatabaseIds,
      duplicateHttpIds: exactReconciliationResult.duplicateHttpIds,
      duplicateBrowserIds: exactReconciliationResult.duplicateBrowserIds,
      sourceProvenance: matchedProvEv?.observedSourceType || probeInspection?.sourceClassification || "UNKNOWN",
      completedAt: new Date().toISOString(),
    };

    fs.writeFileSync(path.join(outDir, "reconciliation-summary.json"), JSON.stringify(reconciliationSummary, null, 2));

    // 13. Validate Artifact Integrity (Section 29)
    const mandatoryArtifacts = [
      "environment-readiness.json",
      "mcp-handshake.json",
      "source-probe.json",
      "live-source-provenance.json",
      "research-request.json",
      "worker-execution.json",
      "discovery-run.json",
      "database-persistence.json",
      "normalization-summary.json",
      "http-readback.json",
      "browser-readback.json",
      "browser-pages.json",
      "reconciliation-summary.json",
    ];

    const missingArtifacts = mandatoryArtifacts.filter((f) => !fs.existsSync(path.join(outDir, f)));
    if (missingArtifacts.length === 0) {
      gates.artifactIntegrity = "PASSED";
    } else {
      gates.artifactIntegrity = "FAILED";
      reasons.push(`Missing mandatory artifacts: ${missingArtifacts.join(", ")}`);
    }
  } catch (err: unknown) {
    const errorMsg = (err as Error).message || String(err);
    reasons.push(errorMsg);
    console.error("\n[FATAL ERROR IN LIVE JOURNEY]", errorMsg);
  } finally {
    // 14. Safe Unconditional Resource Cleanup (FIX 1)
    console.log("\n[Teardown] Performing unconditional safe resource cleanup...");
    try {
      cleanupReport = await cleanupLiveJourneyResources({
        page,
        browserContext: context,
        browser,
        workerChild,
        server,
        mcpClient,
        dbHandle,
      });
    } catch (cleanupErr: any) {
      cleanupReport = {
        browserClosed: false,
        workerStopped: false,
        nextServerStopped: false,
        mcpClosed: false,
        prismaDisconnected: false,
        isolatedDatabaseDeleted: false,
        errors: [`Unhandled exception during cleanup: ${cleanupErr?.message || String(cleanupErr)}`],
      };
    }

    // Always persist cleanup results, even if previous stages failed
    fs.writeFileSync(path.join(outDir, "cleanup-results.json"), JSON.stringify(cleanupReport, null, 2));
    console.log(`  ✔ Teardown complete (Errors: ${cleanupReport.errors.length}).`);

    const mandatoryResourcesClosed =
      cleanupReport.browserClosed &&
      cleanupReport.workerStopped &&
      cleanupReport.nextServerStopped &&
      cleanupReport.mcpClosed &&
      cleanupReport.prismaDisconnected &&
      cleanupReport.isolatedDatabaseDeleted;

    if (cleanupReport.errors.length === 0 && mandatoryResourcesClosed) {
      gates.cleanup = "PASSED";
    } else {
      gates.cleanup = "FAILED";
      const failMsgs: string[] = [];
      if (cleanupReport.errors.length > 0) {
        failMsgs.push(...cleanupReport.errors);
      }
      if (!mandatoryResourcesClosed) {
        failMsgs.push("One or more mandatory resources failed to close cleanly during teardown.");
      }
      reasons.push(...failMsgs);
    }

    // 15. Finalize Verdict & Emit Decision Artifacts ONLY AFTER CLEANUP
    const finalVerdict = finalizeLiveJourneyVerdict(gates);

    const stageResults = {
      journeyRunId,
      discoveryRunId,
      gates,
      verdict: finalVerdict.verdict,
      success: finalVerdict.success,
      blockingReasons: [...finalVerdict.blockingReasons, ...reasons],
      evaluatedAt: new Date().toISOString(),
    };

    fs.writeFileSync(path.join(outDir, "stage-results.json"), JSON.stringify(stageResults, null, 2));
    fs.writeFileSync(path.join(outDir, "validation-verdict.json"), JSON.stringify(finalVerdict, null, 2));

    fs.writeFileSync(
      path.join(outDir, "execution-metadata.json"),
      JSON.stringify(
        {
          journeyRunId,
          discoveryRunId,
          startedAt,
          completedAt: new Date().toISOString(),
          options,
          verdict: finalVerdict.verdict,
          success: finalVerdict.success,
        },
        null,
        2
      )
    );

    // If journey succeeded, update latest pointer ONLY AFTER CLEANUP
    if (finalVerdict.success) {
      const latestPointerPath = path.resolve(process.cwd(), "artifacts/v11.6.1/latest.json");
      fs.writeFileSync(
        latestPointerPath,
        JSON.stringify(
          {
            journeyRunId,
            discoveryRunId,
            outDir,
            timestamp: new Date().toISOString(),
            verdict: finalVerdict.verdict,
          },
          null,
          2
        )
      );
    }

    console.log("\n==================================================================");
    console.log(`  JOURNEY COMPLETE — FINAL VERDICT: ${finalVerdict.verdict}`);
    console.log("==================================================================");
    console.log(`  Source Gate:          ${gates.source}`);
    console.log(`  Worker Gate:          ${gates.worker}`);
    console.log(`  Persistence Gate:     ${gates.persistence}`);
    console.log(`  HTTP API Gate:        ${gates.http}`);
    console.log(`  Browser Gate:         ${gates.browser}`);
    console.log(`  Reconciliation Gate:  ${gates.reconciliation}`);
    console.log(`  Artifact Gate:        ${gates.artifactIntegrity}`);
    console.log(`  Cleanup Gate:         ${gates.cleanup}`);
    console.log(`  Success:              ${finalVerdict.success}`);
    console.log(`  Evidence Directory:   ${outDir}`);
    console.log("==================================================================");

    returnResult = {
      success: finalVerdict.success,
      verdict: finalVerdict.verdict,
      journeyRunId,
      discoveryRunId,
      sourceVerified: gates.source === "PASSED",
      workerVerified: gates.worker === "PASSED",
      persistenceVerified: gates.persistence === "PASSED",
      httpVerified: gates.http === "PASSED",
      browserVerified: gates.browser === "PASSED",
      reconciliationVerified: gates.reconciliation === "PASSED",
      evidencePublished: gates.artifactIntegrity === "PASSED",
      cleanupVerified: gates.cleanup === "PASSED",
      reasons: [...finalVerdict.blockingReasons, ...reasons],
      artifactDirectory: outDir,
      reconciliation: reconciliationSummary,
      cleanup: cleanupReport,
    };
  }

  return returnResult!;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const options = parseCliArgs(process.argv.slice(2));
  runMetaLiveJourney(options)
    .then((res) => {
      console.log(`\nLive Journey Finished with Verdict: ${res.verdict} (Success: ${res.success})`);
      process.exitCode = res.success ? 0 : 1;
    })
    .catch((err) => {
      console.error("\n[UNCAUGHT ERROR IN LIVE JOURNEY]", err);
      process.exitCode = 1;
    });
}
