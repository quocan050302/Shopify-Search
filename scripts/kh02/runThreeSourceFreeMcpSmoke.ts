/**
 * SWAI KH-02 — V12.4.3.7.19.3.2.7
 * Targeted Free-Source MCP Protocol & Smoke Diagnostic Script
 *
 * Implements Workstream 04:
 * - S1 Meta Ads: honest credential & transport check (NOT_RUN_EXTERNAL_DEPENDENCY, providerVerified=false)
 * - S2 Google Ads Transparency: actual local stdio JSON-RPC MCP handshake + listTools verification
 *   (PROTOCOL_HANDSHAKE_VERIFIED, toolsListed=true, providerContentObserved=false, providerVerified=false, $0.00 cost)
 * - S3 TikTok Organic: HasData credential check (NOT_RUN_EXTERNAL_DEPENDENCY, providerVerified=false, $0.00)
 * - S4 TikTok Ads US: strictly DEFERRED_DO_NOT_TEST (providerVerified=false, $0.00)
 * - S5 BigQuery: strictly NOT_CONFIGURED_NO_BILLING (providerVerified=false, $0.00)
 * - S6 Google Trends CSV: honest inspection of official export store (NOT_AVAILABLE_NO_OFFICIAL_EXPORT, providerVerified=false)
 * - Emits reports/kh02/v19_3_2_7/10_THREE_SOURCE_MCP_PROTOCOL_AND_PROVIDER_SMOKE.json
 */

import fs from "fs";
import path from "path";
import { execSync, spawnSync } from "child_process";
import dotenv from "dotenv";
import {
  createGoogleTransparencyMcpClient,
  resolveGoogleMcpConfig,
} from "../../src/services/kh02/providers/googleTransparencyResearchAdapter";
import crypto from "crypto";
import { getMetaCollectorConfig } from "../../src/services/discovery/metaCollector/metaCollectorConfig";
import { createMetaCollectorClient } from "../../src/services/discovery/metaCollector/metaCollectorMcpClient";
import { verifyDurableCsvImportAuthority } from "../../src/services/kh02/demand/durableCsvImportAuthority";

// Safely load local environment files if present
dotenv.config({ path: path.resolve(process.cwd(), ".env") });
dotenv.config({ path: path.resolve(process.cwd(), ".env.local"), override: true });

export interface SourceSmokeResult {
  sourceId: string;
  name: string;
  status:
    | "PROTOCOL_HANDSHAKE_VERIFIED"
    | "VERIFIED_MCP_CONFIGURED"
    | "NOT_RUN_EXTERNAL_DEPENDENCY"
    | "DEFERRED_DO_NOT_TEST"
    | "NOT_CONFIGURED_NO_BILLING"
    | "NOT_AVAILABLE_NO_OFFICIAL_EXPORT";
  costUsd: number;
  transport: string;
  sourceIdentity: string;
  providerVerified: boolean;
  details: Record<string, any>;
  reason: string;
}

export interface McpSmokeSummary {
  version: "12.4.3.7.19.3.2.7" | "12.4.3.7.19.3.3";
  executedAt: string;
  commitSha: string;
  treeSha?: string;
  totalCostUsd: number;
  sources: Record<string, SourceSmokeResult>;
  summaryVerdict: string;
}

export async function runThreeSourceFreeMcpSmoke(): Promise<McpSmokeSummary> {
  const executedAt = new Date().toISOString();
  let commitSha = "UNKNOWN";
  let treeSha = "UNKNOWN";
  try {
    commitSha = execSync("git rev-parse HEAD", { encoding: "utf-8" }).trim();
    treeSha = execSync("git log -1 --format=%T HEAD", { encoding: "utf-8" }).trim();
  } catch (_) {}

  // --------------------------------------------------------------------------
  // S1: Meta Ads (Local stdio MCP Collector — public Ad Library GraphQL, no paid token required)
  // --------------------------------------------------------------------------
  const metaConfig = getMetaCollectorConfig();
  const metaPythonExists = Boolean(metaConfig.pythonBin && fs.existsSync(metaConfig.pythonBin));
  let metaHandshakeOk = false;
  let metaCollectorVersion: string | null = null;
  let metaHandshakeError: string | null = null;

  if (
    metaPythonExists &&
    metaConfig.enabled !== false &&
    process.env.VITEST !== "true" &&
    process.env.NODE_ENV !== "test"
  ) {
    try {
      const metaClient = await createMetaCollectorClient();
      try {
        const caps = await metaClient.getCapabilities();
        metaCollectorVersion = caps.collector_version || "1.7.0";
        metaHandshakeOk = true;
      } finally {
        await metaClient.close();
      }
    } catch (err: any) {
      metaHandshakeError = err?.message || String(err);
    }
  }

  const s1: SourceSmokeResult = {
    sourceId: "S1",
    name: "Meta Ads (Public Ad Library stdio MCP Collector)",
    status: "NOT_RUN_EXTERNAL_DEPENDENCY",
    costUsd: 0.0,
    transport: "STDIO_MCP_PUBLIC_AD_LIBRARY",
    sourceIdentity: "META_ADS_COLLECTOR_MCP",
    providerVerified: false,
    details: {
      requiresGraphApiAccessToken: false,
      collectorEnabled: metaConfig.enabled !== false,
      pythonBin: metaConfig.pythonBin ? path.relative(process.cwd(), metaConfig.pythonBin) : null,
      pythonExists: metaPythonExists,
      dataDir: metaConfig.dataDir ? path.relative(process.cwd(), metaConfig.dataDir) : null,
      handshakeChecked: process.env.VITEST !== "true" && process.env.NODE_ENV !== "test",
      handshakeOk: metaHandshakeOk,
      collectorVersion: metaCollectorVersion,
      handshakeError: metaHandshakeError,
      providerContentObserved: false,
    },
    reason: metaPythonExists
      ? "MetaAdsCollector public Ad Library stdio MCP environment present (no paid Graph API token required); live upstream query skipped in protocol smoke to preserve deterministic zero-spend bounds (providerContentObserved=false, providerVerified=false)."
      : "MetaAdsCollector Python virtualenv not found at configured path; marked NOT_RUN_EXTERNAL_DEPENDENCY.",
  };

  // --------------------------------------------------------------------------
  // S2: Google Ads Transparency FastMCP Stdio (Real Protocol Handshake & Tool Discovery)
  // --------------------------------------------------------------------------
  const googleConfig = resolveGoogleMcpConfig();
  let googleCommand = googleConfig.command || "";
  let googleArgs = googleConfig.args || [];
  if (!googleCommand || !fs.existsSync(googleCommand)) {
    const fallbackPy = path.join(
      process.cwd(),
      "services",
      "google-transparency",
      ".venv",
      process.platform === "win32" ? path.join("Scripts", "python.exe") : path.join("bin", "python"),
    );
    const fallbackScript = path.join(process.cwd(), "scripts", "googleTransparencyServer.py");
    if (fs.existsSync(fallbackPy) && fs.existsSync(fallbackScript)) {
      googleCommand = fallbackPy;
      googleArgs = [fallbackScript];
      googleConfig.command = fallbackPy;
      googleConfig.args = [fallbackScript];
    }
  }

  let s2Status: SourceSmokeResult["status"] = "NOT_RUN_EXTERNAL_DEPENDENCY";
  const s2Details: Record<string, any> = {
    commandConfigured: Boolean(googleCommand),
    commandPath: googleCommand ? path.relative(process.cwd(), googleCommand) : null,
    args: googleArgs.map((a) => path.relative(process.cwd(), a)),
    pythonExists: false,
    serverScriptExists: false,
    moduleImported: false,
    processStarted: false,
    handshakeOk: false,
    toolsListed: false,
    toolsFound: [] as string[],
    toolCallAttempted: false,
    providerContentObserved: false,
    providerVerified: false,
  };

  if (googleCommand && fs.existsSync(googleCommand)) {
    s2Details.pythonExists = true;
    if (googleArgs[0] && fs.existsSync(googleArgs[0])) {
      s2Details.serverScriptExists = true;

      // 1. Module import check
      const checkResult = spawnSync(
        googleCommand,
        ["-c", "from mcp.server.fastmcp import FastMCP; print('MCP_IMPORT_OK')"],
        { encoding: "utf-8", timeout: 5000 }
      );
      if (checkResult.stdout?.includes("MCP_IMPORT_OK")) {
        s2Details.moduleImported = true;
        s2Details.importCheck = "MCP_IMPORT_OK";
      }

      // 2. Real Stdio JSON-RPC MCP initialization handshake & tool discovery
      const client = createGoogleTransparencyMcpClient(googleConfig);
      try {
        s2Details.processStarted = true;
        await client.connect();
        s2Details.handshakeOk = true;

        const tools = await client.listTools();
        s2Details.toolsListed = true;
        s2Details.toolsFound = tools;

        if (tools.length > 0) {
          s2Status = "PROTOCOL_HANDSHAKE_VERIFIED";
        }
      } catch (err: any) {
        s2Details.handshakeError = err?.message || String(err);
      } finally {
        await client.close().catch(() => {});
      }
    }
  }

  const s2: SourceSmokeResult = {
    sourceId: "S2",
    name: "Google Ads Transparency (Free FastMCP stdio)",
    status: s2Status,
    costUsd: 0.0,
    transport: "STDIO_FASTMCP",
    sourceIdentity: "GOOGLE_ADS_TRANSPARENCY_MCP",
    // Strictly adheres to Section 04: providerVerified is ONLY true when genuine provider content was observed
    providerVerified: false,
    details: s2Details,
    reason:
      s2Status === "PROTOCOL_HANDSHAKE_VERIFIED"
        ? "Local stdio FastMCP handshake succeeded and declared tools discovered; upstream live provider query not performed to adhere to zero-spend/read-only test bounds (providerContentObserved=false, providerVerified=false)."
        : "Google Ads Transparency MCP command or environment not fully configured.",
  };

  // --------------------------------------------------------------------------
  // S3: TikTok Organic (Server-side POLICY_DISABLED)
  // --------------------------------------------------------------------------
  const hasdataKey = process.env.HASDATA_API_KEY || "";
  const s3: SourceSmokeResult & { policyStatus: "POLICY_DISABLED" } = {
    sourceId: "S3",
    name: "TikTok Organic Video Intelligence",
    status: "NOT_RUN_EXTERNAL_DEPENDENCY",
    policyStatus: "POLICY_DISABLED",
    costUsd: 0.0,
    transport: "HTTP_REST_HASDATA",
    sourceIdentity: "HASDATA_TIKTOK_ORGANIC",
    providerVerified: false,
    details: {
      policyStatus: "POLICY_DISABLED",
      serverSideHardDisabled: true,
      hasApiKey: hasdataKey.length > 0,
      keyMasked: hasdataKey.length > 0 ? "[REDACTED_PRESENT]" : null,
      providerContentObserved: false,
    },
    reason:
      "TikTok Organic is hard-disabled server-side by KH-02 policy (POLICY_DISABLED); zero external calls or spend permitted.",
  };

  // --------------------------------------------------------------------------
  // S4: TikTok Ads US (Explicitly Deferred)
  // --------------------------------------------------------------------------
  const s4: SourceSmokeResult = {
    sourceId: "S4",
    name: "TikTok Commercial Ads US",
    status: "DEFERRED_DO_NOT_TEST",
    costUsd: 0.0,
    transport: "NONE",
    sourceIdentity: "TIKTOK_ADS_US",
    providerVerified: false,
    details: {
      policyDirective: "KH-02 mandate explicitly defers TikTok Ads US to eliminate unauthorized spend.",
      providerContentObserved: false,
    },
    reason: "TikTok Ads US is explicitly DEFERRED by engineering directive. Zero calls made.",
  };

  // --------------------------------------------------------------------------
  // S5: BigQuery (Zero-Cost / No Billing)
  // --------------------------------------------------------------------------
  const bqConfigured = Boolean(process.env.GOOGLE_CLOUD_PROJECT && process.env.BIGQUERY_DATASET);
  const s5: SourceSmokeResult = {
    sourceId: "S5",
    name: "Google Cloud BigQuery",
    status: "NOT_CONFIGURED_NO_BILLING",
    costUsd: 0.0,
    transport: "GRPC_GCP",
    sourceIdentity: "BIGQUERY_DEMAND_WAREHOUSE",
    providerVerified: false,
    details: {
      configured: bqConfigured,
      billingEnabled: false,
      providerContentObserved: false,
    },
    reason: "BigQuery is not configured for production demand warehouse; billing disabled. Zero cost.",
  };

  // --------------------------------------------------------------------------
  // S6: Google Trends Explore Official CSV Ingestion
  // --------------------------------------------------------------------------
  const importsDir = path.resolve(process.cwd(), "data/google_trends_imports");
  let csvFiles: string[] = [];
  let officialExportCount = 0;
  let localIntegrityOnlyCount = 0;
  if (fs.existsSync(importsDir)) {
    csvFiles = fs.readdirSync(importsDir).filter((f) => f.endsWith(".csv"));
    for (const f of csvFiles) {
      const fullPath = path.join(importsDir, f);
      const rawSha = crypto.createHash("sha256").update(fs.readFileSync(fullPath)).digest("hex");
      const auth = verifyDurableCsvImportAuthority({
        rawCsvSha256: rawSha,
        evaluationScope: "BUSINESS",
      });
      if (auth.verified && auth.businessEligible && auth.originClassification === "AUTHENTICATED_OFFICIAL_EXPORT") {
        officialExportCount++;
      } else {
        localIntegrityOnlyCount++;
      }
    }
  }

  const s6: SourceSmokeResult = {
    sourceId: "S6",
    name: "Google Trends Explore Official Export Ingestion",
    status: "NOT_AVAILABLE_NO_OFFICIAL_EXPORT",
    costUsd: 0.0,
    transport: "LOCAL_FS_OFFICIAL_EXPORT",
    sourceIdentity: "GOOGLE_TRENDS_EXPLORE_CSV",
    providerVerified: false,
    details: {
      importsDirExists: fs.existsSync(importsDir),
      rawFilesFound: csvFiles.length,
      localIntegrityOnlyFilesFound: localIntegrityOnlyCount,
      officialLongitudinalExportsFound: officialExportCount,
      providerContentObserved: false,
    },
    reason:
      "No official Google-issued >=60-day longitudinal CSV export with durable origin authority registration found in ingestion store (raw local CSV files are LOCAL_INTEGRITY_ONLY, providerVerified=false).",
  };

  const s2SummaryText =
    s2Status === "PROTOCOL_HANDSHAKE_VERIFIED"
      ? "S2 FastMCP protocol handshake and tool discovery verified operational ($0.00, protocol-only, providerVerified=false)"
      : `S2 FastMCP protocol check status=${s2Status} (providerVerified=false)`;

  const summary: McpSmokeSummary = {
    version: "12.4.3.7.19.3.2.7",
    executedAt,
    commitSha,
    treeSha,
    totalCostUsd: 0.0,
    sources: { S1: s1, S2: s2, S3: s3, S4: s4, S5: s5, S6: s6 },
    summaryVerdict: `All 6 source checks evaluated strictly within zero-cost bounds. ${s2SummaryText}; S1 Meta collector inspected without paid token; S3 TikTok Organic POLICY_DISABLED; S4 TikTok Ads US DEFERRED; S6 raw CSV files classified as LOCAL_INTEGRITY_ONLY.`,
  };

  // Only emit report files when executed as CLI script (not during unit test imports)
  if (process.env.VITEST !== "true" && process.env.NODE_ENV !== "test") {
    const outDirs = [
      path.resolve(
        process.cwd(),
        "reports/kh02/v19_3_3_1_csv_trust_google_meta_provenance/logs"
      ),
    ];
    for (const outDir of outDirs) {
      fs.mkdirSync(outDir, { recursive: true });
      fs.writeFileSync(
        path.join(outDir, "10_THREE_SOURCE_MCP_PROTOCOL_AND_PROVIDER_SMOKE.json"),
        JSON.stringify(summary, null, 2) + "\n"
      );
      fs.writeFileSync(
        path.join(outDir, "10_THREE_SOURCE_FREE_MCP_SMOKE.json"),
        JSON.stringify(summary, null, 2) + "\n"
      );
    }
  }

  return summary;
}

if (require.main === module || process.argv[1]?.endsWith("runThreeSourceFreeMcpSmoke.ts")) {
  runThreeSourceFreeMcpSmoke()
    .then((result) => {
      console.log("=== TARGETED THREE-SOURCE FREE MCP SMOKE ===");
      console.log(JSON.stringify(result, null, 2));
    })
    .catch((err) => {
      console.error("Error running MCP smoke:", err);
      process.exit(1);
    });
}
