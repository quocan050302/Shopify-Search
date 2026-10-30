/**
 * SWAI KH-02 — Historical Demand Provider Registry & Interface Contract
 *
 * Implements standard provider contracts for historical search interest time-series:
 * - Google Trends API (authorized/licensed feeds)
 * - Internal verified historical observation repositories
 * - Product-specific disambiguated search queries
 */

import type { SourceDiagnosticResult } from "../providers/sourceRegistry";

export interface DemandQuery {
  term: string;
  canonicalProductName?: string;
  productId?: string;
  region: string; // e.g. "US"
  startDate: Date;
  endDate: Date;
  granularity?: "DAY" | "WEEK" | "MONTH";
}

export interface DemandDataPointResult {
  periodStart: string;
  periodEnd: string;
  demandValue: number; // 0-100 relative index
  region: string;
  source: string;
  scale: "GOOGLE_TRENDS_INDEX_0_100";
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
  error?: string;
}

export interface HistoricalDemandProvider {
  providerId: string;
  displayName: string;
  diagnose(): Promise<SourceDiagnosticResult>;
  fetchSeries(query: DemandQuery): Promise<DemandSeriesResult>;
}

// SerpApi's account endpoint is non-metered. Only the Free plan with a
// positive authoritative balance may run while AUTO_PAID_RESEARCH is disabled.
export async function inspectSerpApiAccount(apiKey: string) {
  const url = new URL("https://serpapi.com/account.json");
  url.searchParams.set("api_key", apiKey);
  const response = await fetch(url, { signal: AbortSignal.timeout(6000), cache: "no-store" });
  if (!response.ok) throw new Error(`SerpApi account check returned HTTP ${response.status}`);
  const account = await response.json();
  if (account.error || account.account_status !== "Active" || typeof account.plan_name !== "string") {
    throw new Error("SerpApi account could not be authenticated as active");
  }
  const free = account.plan_monthly_price === 0 &&
    (/^free(?:[ _-]|$)/i.test(String(account.plan_name || "")) || account.plan_id === "free");
  const remaining = account.total_searches_left;
  return {
    free,
    remaining: typeof remaining === "number" && Number.isFinite(remaining) ? remaining : null,
  };
}

class GoogleTrendsDemandProvider implements HistoricalDemandProvider {
  readonly providerId = "google-trends";
  readonly displayName = "Google Trends (SerpApi Interest Over Time)";

  async diagnose(): Promise<SourceDiagnosticResult> {
    const configured = Boolean(process.env.SERPAPI_API_KEY?.trim());
    return {
      source: "DEMAND_HISTORY", adapterInstalled: true, configured,
      transportConnected: null, authenticated: null, discoverySupported: configured,
      queryExecuted: false, recordsReturned: null, provenanceVerified: false,
      lastCheckedAt: new Date().toISOString(),
      status: configured ? "CONFIGURED" : "NOT_CONFIGURED",
      reason: configured
        ? "SerpApi key configured; authentication and quota have not been tested."
        : "Set SERPAPI_API_KEY from the SerpApi Free plan, or import Trends CSV. GOOGLE_TRENDS_API_KEY alone is not implemented; Google's official API requires alpha approval.",
      missingRequirements: configured ? [] : ["SERPAPI_API_KEY"],
    };
  }

  async fetchSeries(query: DemandQuery): Promise<DemandSeriesResult> {
    const result: DemandSeriesResult = {
      providerId: this.providerId, term: query.term,
      canonicalProductName: query.canonicalProductName || null, region: query.region,
      points: [], status: "BLOCKED", acquiredAt: new Date().toISOString(), provenance: "UNVERIFIED",
    };
    const apiKey = process.env.SERPAPI_API_KEY?.trim();
    if (!apiKey) return { ...result, error: "SerpApi credentials (SERPAPI_API_KEY) are not configured. Get a personal Free plan key at https://serpapi.com/manage-api-key." };
    if (!query.term.trim() || !Number.isFinite(query.startDate.getTime()) ||
        !Number.isFinite(query.endDate.getTime()) || query.startDate >= query.endDate) {
      return { ...result, status: "FAILED", error: "A search term and valid increasing date range are required." };
    }
    try {
      const account = await inspectSerpApiAccount(apiKey);
      if (account.remaining === null || account.remaining < 1) {
        return { ...result, error: "SerpApi search balance is unavailable or exhausted." };
      }
      if (!account.free && process.env.AUTO_PAID_RESEARCH !== "true") {
        return { ...result, error: "SerpApi account is not a verified Free plan; paid research is disabled." };
      }
      const url = new URL("https://serpapi.com/search.json");
      url.searchParams.set("engine", "google_trends");
      url.searchParams.set("data_type", "TIMESERIES");
      url.searchParams.set("q", query.term);
      url.searchParams.set("geo", query.region || "US");
      url.searchParams.set("date", `${query.startDate.toISOString().slice(0, 10)} ${query.endDate.toISOString().slice(0, 10)}`);
      url.searchParams.set("api_key", apiKey);
      const response = await fetch(url, { signal: AbortSignal.timeout(15000), cache: "no-store" });
      if (!response.ok) return { ...result, status: "FAILED", error: `SerpApi returned HTTP ${response.status}` };
      const data = await response.json();
      if (data.error) return { ...result, status: "FAILED", error: "SerpApi reported a query error. Check the provider dashboard." };
      const timeline = data?.interest_over_time?.timeline_data;
      if (!Array.isArray(timeline)) return { ...result, status: "INSUFFICIENT_DATA" };
      const points: DemandDataPointResult[] = [];
      for (const entry of timeline) {
        // Display dates can be ranges such as 'Jun 6 - 12, 2021'. Use epoch seconds.
        const seconds = Number(entry.timestamp);
        const value = entry.values?.[0]?.extracted_value ?? entry.values?.[0]?.value;
        const index = value === "<1" ? 0.5 : Number(value);
        const date = new Date(seconds * 1000);
        if (!entry.timestamp || !Number.isFinite(date.getTime()) ||
            value === null || value === undefined || value === "" ||
            !Number.isFinite(index) || index < 0 || index > 100 || entry.partial === true || entry.isPartial === true || entry.is_partial === true) continue;
        if (date < query.startDate || date > query.endDate) continue;
        const period = date.toISOString();
        points.push({ periodStart: period, periodEnd: period, demandValue: index,
          region: query.region, source: "Google Trends (SerpApi)", scale: "GOOGLE_TRENDS_INDEX_0_100" });
      }
      points.sort((a, b) => a.periodStart.localeCompare(b.periodStart));
      return { ...result, points, status: points.length ? "SUCCESS" : "INSUFFICIENT_DATA",
        provenance: points.length ? "AUTHORITATIVE_PROVIDER" : "UNVERIFIED" };
    } catch {
      // Never forward fetch errors which could contain the api_key query parameter.
      return { ...result, status: "FAILED", error: "SerpApi account or Trends request failed; check network, key and quota." };
    }
  }
}

export const defaultDemandProvider: HistoricalDemandProvider = new GoogleTrendsDemandProvider();
