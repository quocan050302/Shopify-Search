/**
 * SWAI KH-02 — Historical Demand Provider Registry & Interface Contract
 *
 * Implements standard provider contracts for historical search interest time-series:
 * - Google Trends public BigQuery datasets (zero-cost sandbox quota, public data)
 * - Google Trends official Explore CSV imports (verifiable file hash and structure)
 * - Google Trending Now signals (daily trending RSS, discovery only)
 * - Legacy SerpApi adapter (isolated, inactive in GOOGLE_FREE_ONLY mode)
 */

import type { SourceDiagnosticResult } from "../providers/sourceRegistry";
import { prisma } from "@/lib/db";
import { hasVerifiableCsvOrProviderLineage } from "./temporalDemandEngine";
import { verifyStoredCsvFile } from "./googleTrendsCsvValidator";
import {
  executeBigQueryTrendsSearch,
  verifyGoogleCloudProjectBilling,
  PUBLIC_GOOGLE_TRENDS_TOP_TERMS_TABLE,
  type BigQueryExecutor,
} from "./bigqueryClientAdapter";

export type DemandProviderMode = "GOOGLE_FREE_ONLY" | "SERPAPI_LEGACY";

export function resolveDemandProviderMode(): DemandProviderMode {
  return process.env.DEMAND_PROVIDER_MODE === "SERPAPI_LEGACY"
    ? "SERPAPI_LEGACY"
    : "GOOGLE_FREE_ONLY";
}

export interface DemandQuery {
  term: string;
  canonicalProductName?: string;
  productId?: string;
  region: string; // e.g. "US"
  startDate: Date;
  endDate: Date;
  granularity?: "DAY" | "WEEK" | "MONTH";
}

export type DemandEvidenceClass =
  | "PRODUCT_SPECIFIC_HISTORICAL_DEMAND"
  | "CATEGORY_TREND_DISCOVERY"
  | "GOOGLE_TOP_TERMS_SIGNAL"
  | "GOOGLE_TRENDING_NOW_EVENT"
  | "CSV_IMPORTED_UNVERIFIED_ORIGIN"
  | "VERIFIED_HISTORICAL_SOURCE"
  | "INSUFFICIENT_COVERAGE";

export interface DemandDataPointResult {
  periodStart: string;
  periodEnd: string;
  demandValue: number; // 0-100 relative index or ranking score
  region: string;
  source: string;
  scale: "GOOGLE_TRENDS_INDEX_0_100" | "GOOGLE_TOP_TERMS_RANK_SCORE";
  evidenceClass?: DemandEvidenceClass;
}

export interface DemandSeriesResult {
  providerId: string;
  term: string;
  canonicalProductName: string | null;
  region: string;
  points: DemandDataPointResult[];
  status: "SUCCESS" | "INSUFFICIENT_DATA" | "BLOCKED" | "FAILED";
  acquiredAt: string;
  provenance: "AUTHORITATIVE_PROVIDER" | "CACHED_OBSERVATION" | "UNVERIFIED";
  evidenceClass?: DemandEvidenceClass;
  error?: string;
  discoveryOnly?: boolean;
}

export interface HistoricalDemandProvider {
  providerId: string;
  displayName: string;
  diagnose(): Promise<SourceDiagnosticResult>;
  fetchSeries(query: DemandQuery): Promise<DemandSeriesResult>;
}

// ============================================================================
// 1. Google Trends Public BigQuery Provider (Zero-Cost Free Sandbox)
// ============================================================================
export class GoogleTrendsBigQueryProvider implements HistoricalDemandProvider {
  readonly providerId = "google-trends-bigquery";
  readonly displayName = "Google Trends Public BigQuery (Zero-Cost Free Sandbox)";

  constructor(
    private customExecutor?: BigQueryExecutor,
    private customBillingChecker?: (proj: string) => Promise<any>
  ) {}

  async diagnose(): Promise<SourceDiagnosticResult> {
    const zeroSpendEnforced = process.env.ZERO_SPEND_ENFORCED !== "false";
    const billingEnabled = process.env.BIGQUERY_BILLING_ENABLED === "true";

    if (billingEnabled && zeroSpendEnforced) {
      return {
        source: "DEMAND_HISTORY",
        adapterInstalled: true,
        configured: false,
        transportConnected: false,
        authenticated: false,
        discoverySupported: false,
        queryExecuted: false,
        recordsReturned: null,
        provenanceVerified: false,
        lastCheckedAt: new Date().toISOString(),
        status: "BLOCKED",
        reason:
          "BLOCKED_BILLING_PROHIBITED: BigQuery billing account detected or reported enabled. Zero-spend policy strictly prohibits queries against billable Google Cloud projects.",
        missingRequirements: ["FREE_SANDBOX_VERIFIED"],
      };
    }

    const projectId =
      process.env.BIGQUERY_PROJECT_ID?.trim() ||
      process.env.GCP_PROJECT_ID?.trim() ||
      process.env.GOOGLE_CLOUD_PROJECT?.trim() ||
      "";
    const hasProject = Boolean(projectId);
    const hasCreds = Boolean(
      process.env.GOOGLE_APPLICATION_CREDENTIALS?.trim() ||
      process.env.GOOGLE_CLOUD_KEYFILE_JSON?.trim()
    );

    if (!hasProject) {
      return {
        source: "DEMAND_HISTORY",
        adapterInstalled: true,
        configured: false,
        transportConnected: false,
        authenticated: false,
        discoverySupported: true,
        queryExecuted: false,
        recordsReturned: null,
        provenanceVerified: false,
        lastCheckedAt: new Date().toISOString(),
        status: "NOT_CONFIGURED",
        reason:
          "Google Cloud Project ID (BIGQUERY_PROJECT_ID / GCP_PROJECT_ID) not configured. Google Trends public datasets (bigquery-public-data.google_trends) require a free Google Cloud project (1TB/mo free query sandbox, zero payment required).",
        missingRequirements: ["BIGQUERY_PROJECT_ID"],
      };
    }

    if (!hasCreds) {
      return {
        source: "DEMAND_HISTORY",
        adapterInstalled: true,
        configured: true,
        transportConnected: false,
        authenticated: false,
        discoverySupported: true,
        queryExecuted: false,
        recordsReturned: null,
        provenanceVerified: false,
        lastCheckedAt: new Date().toISOString(),
        status: "AUTHENTICATION_REQUIRED",
        reason: `BigQuery project '${projectId}' configured, but Google Cloud credentials (GOOGLE_APPLICATION_CREDENTIALS or gcloud ADC) are required.`,
        missingRequirements: ["GOOGLE_APPLICATION_CREDENTIALS"],
      };
    }

    // RC-02: Independently verify whether the project has zero-spend billing disabled
    const billingCheck = await verifyGoogleCloudProjectBilling(projectId, {
      credentialsPath: process.env.GOOGLE_APPLICATION_CREDENTIALS,
      customChecker: this.customBillingChecker,
    });

    if (!billingCheck.sandboxEligible) {
      return {
        source: "DEMAND_HISTORY",
        adapterInstalled: true,
        configured: true,
        transportConnected: false,
        authenticated: false,
        discoverySupported: true,
        queryExecuted: false,
        recordsReturned: null,
        provenanceVerified: false,
        lastCheckedAt: new Date().toISOString(),
        status: "BLOCKED_FREE_SANDBOX_NOT_VERIFIED",
        reason: billingCheck.reason || `Google BigQuery project '${projectId}' billing state cannot be confirmed as zero-charge Sandbox. Set BIGQUERY_FREE_SANDBOX_VERIFIED=true to confirm project has no billing account attached.`,
        missingRequirements: ["BIGQUERY_FREE_SANDBOX_VERIFIED"],
      };
    }

    return {
      source: "DEMAND_HISTORY",
      adapterInstalled: true,
      configured: true,
      transportConnected: true,
      authenticated: true,
      discoverySupported: true,
      queryExecuted: false,
      recordsReturned: null,
      provenanceVerified: true,
      lastCheckedAt: new Date().toISOString(),
      status: "CONFIGURED",
      reason: `BigQuery project '${projectId}' configured for Google Trends public dataset queries within 1TB/mo free sandbox.`,
      missingRequirements: [],
    };
  }

  async fetchSeries(query: DemandQuery): Promise<DemandSeriesResult> {
    const result: DemandSeriesResult = {
      providerId: this.providerId,
      term: query.term,
      canonicalProductName: query.canonicalProductName || null,
      region: query.region,
      points: [],
      status: "BLOCKED",
      acquiredAt: new Date().toISOString(),
      provenance: "UNVERIFIED",
      evidenceClass: "INSUFFICIENT_COVERAGE",
    };

    const diag = await this.diagnose();
    if (diag.status !== "CONFIGURED") {
      return {
        ...result,
        status: "BLOCKED",
        error: diag.reason || "Google Trends BigQuery sandbox credentials are not configured.",
      };
    }

    const projectId =
      process.env.BIGQUERY_PROJECT_ID?.trim() ||
      process.env.GCP_PROJECT_ID?.trim() ||
      process.env.GOOGLE_CLOUD_PROJECT?.trim() ||
      "";

    // RC-01: Execute real parameterized query with dry-run and byte budget enforcement
    const bqRes = await executeBigQueryTrendsSearch(
      {
        projectId,
        term: query.term,
        region: query.region,
        credentialsPath: process.env.GOOGLE_APPLICATION_CREDENTIALS,
      },
      this.customExecutor,
      this.customBillingChecker
    );

    if (bqRes.status === "SUCCESS" && bqRes.rowCount > 0) {
      const points: DemandDataPointResult[] = bqRes.rows.map((r) => ({
        periodStart: r.week || r.refresh_date || new Date().toISOString(),
        periodEnd: r.week || r.refresh_date || new Date().toISOString(),
        demandValue: typeof r.score === "number" ? r.score : 0,
        region: query.region,
        source: "Google Trends BigQuery (Public Top Terms)",
        scale: "GOOGLE_TOP_TERMS_RANK_SCORE",
        evidenceClass: "GOOGLE_TOP_TERMS_SIGNAL",
      }));
      return {
        ...result,
        points,
        status: "SUCCESS",
        provenance: "AUTHORITATIVE_PROVIDER",
        evidenceClass: "GOOGLE_TOP_TERMS_SIGNAL",
      };
    }

    if (bqRes.status === "BUDGET_EXCEEDED" || bqRes.status === "BILLING_PROHIBITED" || bqRes.status === "BLOCKED") {
      return {
        ...result,
        status: "BLOCKED",
        error: bqRes.errorMessage || `Query blocked under zero-spend policy (${bqRes.status}).`,
        evidenceClass: "INSUFFICIENT_COVERAGE",
      };
    }

    if (bqRes.status === "FAILED") {
      return {
        ...result,
        status: "FAILED",
        error: bqRes.errorMessage || "BigQuery query execution failed.",
        evidenceClass: "INSUFFICIENT_COVERAGE",
      };
    }

    return {
      ...result,
      status: "INSUFFICIENT_DATA",
      error:
        bqRes.errorMessage ||
        `INSUFFICIENT_COVERAGE: Keyword '${query.term}' not found in Google Trends public BigQuery top terms dataset for ${query.region} (checked ${PUBLIC_GOOGLE_TRENDS_TOP_TERMS_TABLE}). Public dataset tracks selected top terms, not arbitrary niche products. Official Explore CSV export can provide verified coverage.`,
      evidenceClass: "INSUFFICIENT_COVERAGE",
    };
  }
}

// ============================================================================
// 2. Google Trends Official Explore CSV Import Provider
// ============================================================================
export class GoogleTrendsCsvImportProvider implements HistoricalDemandProvider {
  readonly providerId = "google-trends-csv";
  readonly displayName = "Google Trends Official Explore CSV Imports";

  async diagnose(): Promise<SourceDiagnosticResult> {
    return {
      source: "DEMAND_HISTORY",
      adapterInstalled: true,
      configured: true,
      // RC-08 fix: Local adapter does not connect to external Google transport
      transportConnected: false,
      authenticated: false,
      discoverySupported: true,
      queryExecuted: false,
      recordsReturned: null,
      provenanceVerified: true,
      lastCheckedAt: new Date().toISOString(),
      status: "CONFIGURED",
      reason: "Local Google Trends CSV import repository ready (local filesystem/database adapter; no external transport connection).",
      missingRequirements: [],
    };
  }

  async fetchSeries(query: DemandQuery): Promise<DemandSeriesResult> {
    const result: DemandSeriesResult = {
      providerId: this.providerId,
      term: query.term,
      canonicalProductName: query.canonicalProductName || null,
      region: query.region,
      points: [],
      status: "INSUFFICIENT_DATA",
      acquiredAt: new Date().toISOString(),
      provenance: "UNVERIFIED",
    };

    if (!query.term || !query.term.trim()) {
      return { ...result, status: "FAILED", error: "Search term is required." };
    }

    try {
      const records = await prisma.productDemandObservation.findMany({
        where: {
          source: "GOOGLE_TRENDS_CSV",
          region: query.region || "US",
          keyword: { contains: query.term.trim() },
        },
        orderBy: { periodStart: "asc" },
      });

      const verifiedPoints: DemandDataPointResult[] = [];
      for (const r of records) {
        const lineage = hasVerifiableCsvOrProviderLineage(r.evidenceReference);
        if (!lineage.hasValidFileChecksum || !lineage.rawCsvFileExists) continue;
        if (r.demandValue === null || typeof r.demandValue !== "number") continue;

        verifiedPoints.push({
          periodStart: r.periodStart.toISOString ? r.periodStart.toISOString() : String(r.periodStart),
          periodEnd: r.periodEnd.toISOString ? r.periodEnd.toISOString() : String(r.periodEnd),
          demandValue: r.demandValue,
          region: r.region,
          source: "Google Trends Explore CSV Export",
          scale: "GOOGLE_TRENDS_INDEX_0_100",
          evidenceClass: "VERIFIED_HISTORICAL_SOURCE",
        });
      }

      if (verifiedPoints.length >= 3) {
        return {
          ...result,
          points: verifiedPoints,
          status: "SUCCESS",
          provenance: "AUTHORITATIVE_PROVIDER",
          evidenceClass: "VERIFIED_HISTORICAL_SOURCE",
        };
      }

      return {
        ...result,
        status: "INSUFFICIENT_DATA",
        error: `No verified Google Trends CSV export found in local database for '${query.term}'. Import an official Google Trends CSV export via /api/v1/demand/import.`,
        evidenceClass: "INSUFFICIENT_COVERAGE",
      };
    } catch (err: any) {
      return {
        ...result,
        status: "FAILED",
        error: `Database lookup error for Google Trends CSV: ${err.message}`,
        evidenceClass: "INSUFFICIENT_COVERAGE",
      };
    }
  }
}

// ============================================================================
// 3. Google Trending Now Provider (Discovery Signals Only)
// ============================================================================
export class GoogleTrendingNowProvider implements HistoricalDemandProvider {
  readonly providerId = "google-trending-now";
  readonly displayName = "Google Trending Now (Discovery Signals Only)";

  async diagnose(): Promise<SourceDiagnosticResult> {
    return {
      source: "DEMAND_HISTORY",
      adapterInstalled: true,
      configured: true,
      transportConnected: true,
      authenticated: true,
      discoverySupported: true,
      queryExecuted: false,
      recordsReturned: null,
      provenanceVerified: false,
      lastCheckedAt: new Date().toISOString(),
      status: "CONFIGURED",
      reason: "Google Trending Now public RSS endpoint ready for discovery-only search signals.",
      missingRequirements: [],
    };
  }

  async fetchSeries(query: DemandQuery): Promise<DemandSeriesResult> {
    const result: DemandSeriesResult = {
      providerId: this.providerId,
      term: query.term,
      canonicalProductName: query.canonicalProductName || null,
      region: query.region,
      points: [],
      status: "INSUFFICIENT_DATA",
      acquiredAt: new Date().toISOString(),
      provenance: "UNVERIFIED",
      evidenceClass: "GOOGLE_TRENDING_NOW_EVENT",
      discoveryOnly: true,
    };

    try {
      const geo = query.region || "US";
      const url = `https://trends.google.com/trending/rss?geo=${encodeURIComponent(geo)}`;
      const res = await fetch(url, { signal: AbortSignal.timeout(3000), cache: "no-store" });
      if (!res.ok) {
        return { ...result, status: "FAILED", error: `Google Trending Now RSS returned HTTP ${res.status}` };
      }
      const text = await res.text();
      const termLower = query.term.toLowerCase();
      const isTrending = text.toLowerCase().includes(termLower);

      if (isTrending) {
        return {
          ...result,
          status: "SUCCESS",
          provenance: "UNVERIFIED",
          evidenceClass: "GOOGLE_TRENDING_NOW_EVENT",
          discoveryOnly: true,
          points: [], // RC-05: RSS signal is discovery-only; never synthesize longitudinal demand points (value 100)
        };
      }

      return {
        ...result,
        status: "INSUFFICIENT_DATA",
        error: `Keyword '${query.term}' is not currently in Google Trending Now daily searches for ${geo}.`,
        evidenceClass: "GOOGLE_TRENDING_NOW_EVENT",
      };
    } catch {
      return {
        ...result,
        status: "FAILED",
        error: "Google Trending Now RSS request failed or timed out.",
        evidenceClass: "GOOGLE_TRENDING_NOW_EVENT",
      };
    }
  }
}

// ============================================================================
// 4. Google Free Composite Demand Provider (Default in GOOGLE_FREE_ONLY Mode)
// ============================================================================
export class GoogleFreeDemandProvider implements HistoricalDemandProvider {
  readonly providerId = "google-free-demand";
  readonly displayName = "Google Free Demand Pipeline (BigQuery Sandbox + Official CSV + Trending Now)";

  private bigquery = new GoogleTrendsBigQueryProvider();
  private csvImport = new GoogleTrendsCsvImportProvider();
  private trendingNow = new GoogleTrendingNowProvider();

  async diagnose(): Promise<SourceDiagnosticResult> {
    const bqDiag = await this.bigquery.diagnose();
    const csvDiag = await this.csvImport.diagnose();

    const isBqConfigured = bqDiag.status === "CONFIGURED";
    const isCsvConfigured = csvDiag.status === "CONFIGURED";
    const isConfigured = isBqConfigured || isCsvConfigured;
    // RC-08 fix: CSV adapter is local; external transport is active only when BigQuery sandbox connects
    const isTransportConnected = bqDiag.transportConnected === true;
    const isAuthenticated = bqDiag.authenticated === true;

    const missingRequirements: string[] = [];
    if (!isBqConfigured && bqDiag.missingRequirements) {
      missingRequirements.push(...bqDiag.missingRequirements);
    }

    return {
      source: "DEMAND_HISTORY",
      adapterInstalled: true,
      configured: isConfigured,
      transportConnected: isTransportConnected,
      authenticated: isAuthenticated,
      discoverySupported: true,
      queryExecuted: false,
      recordsReturned: null,
      provenanceVerified: isConfigured,
      lastCheckedAt: new Date().toISOString(),
      status: isConfigured ? "CONFIGURED" : (bqDiag.status.startsWith("BLOCKED") ? bqDiag.status : "NOT_CONFIGURED"),
      reason: isConfigured
        ? "Using Google Free Demand pipeline (BigQuery public datasets, official Explore CSV imports, and Trending Now discovery signals). SerpApi is not required."
        : (bqDiag.reason || "Google Free Demand pipeline requires verified BigQuery Sandbox or official Google Trends CSV imports."),
      missingRequirements,
      dimensions: {
        bigqueryStatus: bqDiag.status,
        csvImportStatus: csvDiag.status,
        freeQuotaMode: "ZERO_COST_FREE_ONLY",
      } as any,
    };
  }

  async fetchSeries(query: DemandQuery): Promise<DemandSeriesResult> {
    // 1. First check local verified Google Trends CSV imports
    const csvResult = await this.csvImport.fetchSeries(query);
    if (csvResult.status === "SUCCESS" && csvResult.points.length >= 3) {
      return csvResult;
    }

    // 2. Then check Google Trends BigQuery public dataset
    const bqResult = await this.bigquery.fetchSeries(query);
    if (bqResult.status === "SUCCESS" && bqResult.points.length > 0) {
      return bqResult;
    }

    // 3. Optional discovery signal check
    const trendingResult = await this.trendingNow.fetchSeries(query);
    if (trendingResult.status === "SUCCESS") {
      return trendingResult;
    }

    // 4. Truthful INSUFFICIENT_DATA if no free source has authoritative coverage
    return {
      providerId: this.providerId,
      term: query.term,
      canonicalProductName: query.canonicalProductName || null,
      region: query.region,
      points: [],
      status: "INSUFFICIENT_DATA",
      acquiredAt: new Date().toISOString(),
      provenance: "UNVERIFIED",
      error: `INSUFFICIENT_COVERAGE: Keyword '${query.term}' not found in Google Free demand sources (BigQuery / CSV import).`,
    };
  }
}

// ============================================================================
// 5. Legacy SerpApi Demand Provider (Only active in SERPAPI_LEGACY mode)
// ============================================================================
export async function inspectSerpApiAccount(apiKey: string) {
  if (resolveDemandProviderMode() === "GOOGLE_FREE_ONLY") {
    throw new Error(
      "SerpApi is disabled under DEMAND_PROVIDER_MODE=GOOGLE_FREE_ONLY. Use Google Free demand sources."
    );
  }
  const url = new URL("https://serpapi.com/account.json");
  url.searchParams.set("api_key", apiKey);
  const response = await fetch(url, { signal: AbortSignal.timeout(6000), cache: "no-store" });
  if (!response.ok) throw new Error(`SerpApi account check returned HTTP ${response.status}`);
  const account = await response.json();
  if (account.error || account.account_status !== "Active" || typeof account.plan_name !== "string") {
    throw new Error("SerpApi account could not be authenticated as active");
  }
  const free =
    account.plan_monthly_price === 0 &&
    (/^free(?:[ _-]|$)/i.test(String(account.plan_name || "")) || account.plan_id === "free");
  const remaining = account.total_searches_left;
  return {
    free,
    remaining: typeof remaining === "number" && Number.isFinite(remaining) ? remaining : null,
  };
}

export class GoogleTrendsLegacySerpApiProvider implements HistoricalDemandProvider {
  readonly providerId = "google-trends";
  readonly displayName = "Google Trends (SerpApi Legacy Feed)";

  async diagnose(): Promise<SourceDiagnosticResult> {
    const configured = Boolean(process.env.SERPAPI_API_KEY?.trim());
    return {
      source: "DEMAND_HISTORY",
      adapterInstalled: true,
      configured,
      transportConnected: null,
      authenticated: null,
      discoverySupported: configured,
      queryExecuted: false,
      recordsReturned: null,
      provenanceVerified: false,
      lastCheckedAt: new Date().toISOString(),
      status: configured ? "CONFIGURED" : "NOT_CONFIGURED",
      reason: configured
        ? "SerpApi key configured; authentication and quota have not been tested."
        : "Set SERPAPI_API_KEY from the SerpApi Free plan, or switch to GOOGLE_FREE_ONLY mode.",
      missingRequirements: configured ? [] : ["SERPAPI_API_KEY"],
    };
  }

  async fetchSeries(query: DemandQuery): Promise<DemandSeriesResult> {
    const result: DemandSeriesResult = {
      providerId: this.providerId,
      term: query.term,
      canonicalProductName: query.canonicalProductName || null,
      region: query.region,
      points: [],
      status: "BLOCKED",
      acquiredAt: new Date().toISOString(),
      provenance: "UNVERIFIED",
    };
    const apiKey = process.env.SERPAPI_API_KEY?.trim();
    if (!apiKey) {
      return {
        ...result,
        error: "SerpApi credentials (SERPAPI_API_KEY) are not configured.",
      };
    }
    if (
      !query.term.trim() ||
      !Number.isFinite(query.startDate.getTime()) ||
      !Number.isFinite(query.endDate.getTime()) ||
      query.startDate >= query.endDate
    ) {
      return {
        ...result,
        status: "FAILED",
        error: "A search term and valid increasing date range are required.",
      };
    }
    try {
      const account = await inspectSerpApiAccount(apiKey);
      if (account.remaining === null || account.remaining < 1) {
        return { ...result, error: "SerpApi search balance is unavailable or exhausted." };
      }
      if (!account.free && process.env.AUTO_PAID_RESEARCH !== "true") {
        return {
          ...result,
          error: "SerpApi account is not a verified Free plan; paid research is disabled.",
        };
      }
      const url = new URL("https://serpapi.com/search.json");
      url.searchParams.set("engine", "google_trends");
      url.searchParams.set("data_type", "TIMESERIES");
      url.searchParams.set("q", query.term);
      url.searchParams.set("geo", query.region || "US");
      url.searchParams.set(
        "date",
        `${query.startDate.toISOString().slice(0, 10)} ${query.endDate.toISOString().slice(0, 10)}`
      );
      url.searchParams.set("api_key", apiKey);
      const response = await fetch(url, { signal: AbortSignal.timeout(15000), cache: "no-store" });
      if (!response.ok) return { ...result, status: "FAILED", error: `SerpApi returned HTTP ${response.status}` };
      const data = await response.json();
      if (data.error) return { ...result, status: "FAILED", error: "SerpApi reported a query error." };
      const timeline = data?.interest_over_time?.timeline_data;
      if (!Array.isArray(timeline)) return { ...result, status: "INSUFFICIENT_DATA" };
      const points: DemandDataPointResult[] = [];
      for (const entry of timeline) {
        const seconds = Number(entry.timestamp);
        const value = entry.values?.[0]?.extracted_value ?? entry.values?.[0]?.value;
        const index = value === "<1" ? 0.5 : Number(value);
        const date = new Date(seconds * 1000);
        if (
          !entry.timestamp ||
          !Number.isFinite(date.getTime()) ||
          value === null ||
          value === undefined ||
          value === "" ||
          !Number.isFinite(index) ||
          index < 0 ||
          index > 100 ||
          entry.partial === true
        )
          continue;
        if (date < query.startDate || date > query.endDate) continue;
        const period = date.toISOString();
        points.push({
          periodStart: period,
          periodEnd: period,
          demandValue: index,
          region: query.region,
          source: "Google Trends (SerpApi)",
          scale: "GOOGLE_TRENDS_INDEX_0_100",
        });
      }
      points.sort((a, b) => a.periodStart.localeCompare(b.periodStart));
      return {
        ...result,
        points,
        status: points.length ? "SUCCESS" : "INSUFFICIENT_DATA",
        provenance: points.length ? "AUTHORITATIVE_PROVIDER" : "UNVERIFIED",
      };
    } catch {
      return {
        ...result,
        status: "FAILED",
        error: "SerpApi account or Trends request failed; check network, key and quota.",
      };
    }
  }
}

// ============================================================================
// Default Demand Provider Export (Resolves dynamically by DEMAND_PROVIDER_MODE)
// ============================================================================
export const googleFreeDemandProvider = new GoogleFreeDemandProvider();
export const legacySerpApiDemandProvider = new GoogleTrendsLegacySerpApiProvider();

export const defaultDemandProvider: HistoricalDemandProvider = {
  get providerId() {
    return resolveDemandProviderMode() === "SERPAPI_LEGACY"
      ? legacySerpApiDemandProvider.providerId
      : googleFreeDemandProvider.providerId;
  },
  get displayName() {
    return resolveDemandProviderMode() === "SERPAPI_LEGACY"
      ? legacySerpApiDemandProvider.displayName
      : googleFreeDemandProvider.displayName;
  },
  diagnose() {
    return resolveDemandProviderMode() === "SERPAPI_LEGACY"
      ? legacySerpApiDemandProvider.diagnose()
      : googleFreeDemandProvider.diagnose();
  },
  fetchSeries(query: DemandQuery) {
    return resolveDemandProviderMode() === "SERPAPI_LEGACY"
      ? legacySerpApiDemandProvider.fetchSeries(query)
      : googleFreeDemandProvider.fetchSeries(query);
  },
};
