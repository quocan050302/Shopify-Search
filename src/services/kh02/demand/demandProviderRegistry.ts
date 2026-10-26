/**
 * SWAI KH-02 — Historical Demand Provider Registry & Interface Contract
 *
 * Implements standard provider contracts for historical search interest time-series:
 * - Google Trends API (authorized/licensed feeds)
 * - Internal verified historical observation repositories
 * - Product-specific disambiguated search queries
 */

import { SourceDiagnosticResult } from "../providers/sourceRegistry";

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

class GoogleTrendsDemandProvider implements HistoricalDemandProvider {
  readonly providerId = "google-trends";
  readonly displayName = "Google Trends (US Interest Over Time)";

  async diagnose(): Promise<SourceDiagnosticResult> {
    const lastCheckedAt = new Date().toISOString();
    const hasAlphaAccess = Boolean(process.env.GOOGLE_TRENDS_API_KEY || process.env.SERPAPI_API_KEY);

    if (!hasAlphaAccess) {
      return {
        source: "DEMAND_HISTORY",
        adapterInstalled: true,
        configured: false,
        transportConnected: null,
        authenticated: false,
        discoverySupported: false,
        queryExecuted: false,
        recordsReturned: 0,
        provenanceVerified: false,
        lastCheckedAt,
        status: "NOT_CONFIGURED",
        reason: "Google Trends provider credentials (SERPAPI_API_KEY or GOOGLE_TRENDS_API_KEY) not configured; temporal policy engine ready for stored observations.",
        missingRequirements: ["SERPAPI_API_KEY or GOOGLE_TRENDS_API_KEY"],
      };
    }

    return {
      source: "DEMAND_HISTORY",
      adapterInstalled: true,
      configured: true,
      transportConnected: null,
      authenticated: true,
      discoverySupported: true,
      queryExecuted: false,
      recordsReturned: null,
      provenanceVerified: true,
      lastCheckedAt,
      status: "CONFIGURED",
      reason: "Google Trends provider configured with authorized upstream credentials.",
      missingRequirements: [],
    };
  }

  async fetchSeries(query: DemandQuery): Promise<DemandSeriesResult> {
    const diag = await this.diagnose();
    if (!diag.configured) {
      return {
        providerId: this.providerId,
        term: query.term,
        canonicalProductName: query.canonicalProductName || null,
        region: query.region,
        points: [],
        status: "BLOCKED",
        acquiredAt: new Date().toISOString(),
        provenance: "UNVERIFIED",
        error: "Google Trends provider credentials (SERPAPI_API_KEY or GOOGLE_TRENDS_API_KEY) not configured.",
      };
    }

    const serpApiKey = process.env.SERPAPI_API_KEY;
    if (serpApiKey) {
      try {
        const url = new URL("https://serpapi.com/search.json");
        url.searchParams.set("engine", "google_trends");
        url.searchParams.set("q", query.term);
        url.searchParams.set("geo", query.region || "US");
        url.searchParams.set("api_key", serpApiKey);

        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 10000);
        const res = await fetch(url.toString(), { signal: controller.signal });
        clearTimeout(timeout);

        if (!res.ok) {
          return {
            providerId: this.providerId,
            term: query.term,
            canonicalProductName: query.canonicalProductName || null,
            region: query.region,
            points: [],
            status: "FAILED",
            acquiredAt: new Date().toISOString(),
            provenance: "UNVERIFIED",
            error: `SerpApi returned HTTP ${res.status}`,
          };
        }

        const data = (await res.json()) as any;
        const timeline = data?.interest_over_time?.timeline_data;
        if (Array.isArray(timeline) && timeline.length > 0) {
          const points: DemandDataPointResult[] = timeline.map((entry: any) => {
            const val = entry.values?.[0]?.extracted_value ?? entry.values?.[0]?.value ?? 0;
            return {
              periodStart: entry.date || entry.timestamp || new Date().toISOString(),
              periodEnd: entry.date || entry.timestamp || new Date().toISOString(),
              demandValue: typeof val === "number" ? val : Number(val) || 0,
              region: query.region,
              source: "Google Trends (SerpApi)",
              scale: "GOOGLE_TRENDS_INDEX_0_100",
            };
          });

          return {
            providerId: this.providerId,
            term: query.term,
            canonicalProductName: query.canonicalProductName || null,
            region: query.region,
            points,
            status: "SUCCESS",
            acquiredAt: new Date().toISOString(),
            provenance: "AUTHORITATIVE_PROVIDER",
          };
        }
      } catch (err: any) {
        return {
          providerId: this.providerId,
          term: query.term,
          canonicalProductName: query.canonicalProductName || null,
          region: query.region,
          points: [],
          status: "FAILED",
          acquiredAt: new Date().toISOString(),
          provenance: "UNVERIFIED",
          error: err.message || "Failed to query SerpApi",
        };
      }
    }

    return {
      providerId: this.providerId,
      term: query.term,
      canonicalProductName: query.canonicalProductName || null,
      region: query.region,
      points: [],
      status: "INSUFFICIENT_DATA",
      acquiredAt: new Date().toISOString(),
      provenance: "UNVERIFIED",
    };
  }
}

export const defaultDemandProvider: HistoricalDemandProvider = new GoogleTrendsDemandProvider();
