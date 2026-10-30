import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  resolveDemandProviderMode,
  GoogleFreeDemandProvider,
  GoogleTrendsBigQueryProvider,
  GoogleTrendsCsvImportProvider,
  GoogleTrendingNowProvider,
  defaultDemandProvider,
} from "@/services/kh02/demand/demandProviderRegistry";
import {
  validateAndParseGoogleTrendsCsv,
} from "@/services/kh02/demand/googleTrendsCsvValidator";
import {
  isSourceHiddenOrDisabled,
  isSourceTemporarilyDisabled,
  getSourcePolicy,
  filterActiveResearchSources,
  listActiveResearchSources,
} from "@/services/kh02/providers/sourcePolicy";
import {
  listKH02SourceCapabilities,
  testKH02SourceConnection,
  diagnoseKH02Source,
} from "@/services/kh02/providers/sourceRegistry";
import { evaluateDemandHistoryEvidence } from "@/services/kh02/demand/temporalDemandEngine";

describe("KH-02 V12.4.3.4 — Google Free Demand Only & TikTok Organic Disabled", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.restoreAllMocks();
  });

  describe("Section A: Remove compulsory SerpApi & GOOGLE_FREE_ONLY Mode", () => {
    it("A01: Defaults to GOOGLE_FREE_ONLY demand provider mode when env is unset", () => {
      delete process.env.DEMAND_PROVIDER_MODE;
      expect(resolveDemandProviderMode()).toBe("GOOGLE_FREE_ONLY");
    });

    it("A02: defaultDemandProvider is an instance of GoogleFreeDemandProvider in GOOGLE_FREE_ONLY mode", () => {
      delete process.env.DEMAND_PROVIDER_MODE;
      expect(defaultDemandProvider.providerId).toBe("google-free-demand");
    });

    it("A03: Zero SerpApi network requests are made in GOOGLE_FREE_ONLY mode", async () => {
      const fetchSpy = vi.spyOn(globalThis, "fetch");

      const provider = new GoogleFreeDemandProvider();
      const res = await provider.fetchSeries({
        term: "Car Phone Mount",
        region: "US",
        startDate: new Date(Date.now() - 90 * 86400000),
        endDate: new Date(),
      });

      // Assert that fetch was never called with any serpapi domain
      const serpApiCalls = fetchSpy.mock.calls.filter((call) => {
        const url = String(call[0]);
        return url.includes("serpapi.com");
      });
      expect(serpApiCalls).toHaveLength(0);
      expect(res.providerId).toBe("google-free-demand");
    });

    it("A04: Diagnose on DEMAND_HISTORY in GOOGLE_FREE_ONLY mode requires no SERPAPI_API_KEY", async () => {
      delete process.env.SERPAPI_API_KEY;
      delete process.env.DEMAND_PROVIDER_MODE;

      const diag = await diagnoseKH02Source("DEMAND_HISTORY");
      expect(diag.status).toBe("ENGINE_READY");
      expect(diag.upstreamConfigured).toBe(true);
      expect(diag.missingRequirements).not.toContain("SERPAPI_API_KEY");
      expect(diag.reason).toContain("Google Free Demand pipeline");
    });
  });

  describe("Section B: Google Trends Official Explore CSV Validation", () => {
    const validCsvSample = `Category: All categories

Interest over time
Week,car phone mount: (United States)
2026-08-02,78
2026-08-09,82
2026-08-16,80
2026-08-23,85
2026-08-30,79
2026-09-06,88
2026-09-13,92
2026-09-20,95
2026-09-27,90
2026-10-04,84
2026-10-11,86
2026-10-18,91
2026-10-25,89
`;

    it("B01: Parses authentic Google Trends Explore CSV and extracts query, region, and data points", () => {
      const parsed = validateAndParseGoogleTrendsCsv(validCsvSample, { importedAt: "2026-10-30T00:00:00.000Z" });
      expect(parsed.valid).toBe(true);
      expect(parsed.keyword).toBe("car phone mount");
      expect(parsed.region).toBe("US");
      expect(parsed.dataPoints.length).toBe(13);
      expect(parsed.dataPoints[0].demandValue).toBe(78);
      expect(parsed.sha256Checksum).toBeDefined();
      expect(parsed.sha256Checksum.length).toBe(64);
      expect(parsed.evidenceReference).toContain(`sha256:${parsed.sha256Checksum}`);
    });

    it("B02: Rejects CSV missing Category or Interest over time header", () => {
      const invalidCsv = `Week,car phone mount: (United States)\n2026-08-02,78\n`;
      const parsed = validateAndParseGoogleTrendsCsv(invalidCsv);
      expect(parsed.valid).toBe(false);
      expect(parsed.errors.some((e) => e.includes("Missing official Google Trends"))).toBe(true);
    });

    it("B03: Rejects CSV with insufficient data points (< 3)", () => {
      const shortCsv = `Category: All categories\n\nInterest over time\nWeek,phone mount: (US)\n2026-10-01,50\n2026-10-08,55\n`;
      const parsed = validateAndParseGoogleTrendsCsv(shortCsv);
      expect(parsed.valid).toBe(false);
      expect(parsed.errors.some((e) => e.includes("minimum 3 points required"))).toBe(true);
    });

    it("B04: Verifies CSV evidence reference contains immutable hash and parameters", () => {
      const parsed = validateAndParseGoogleTrendsCsv(validCsvSample, { importedAt: "2026-10-30T00:00:00.000Z" });
      expect(parsed.evidenceReference).toBe(
        `csv-import:google-trends-explore:sha256:${parsed.sha256Checksum}:q=car_phone_mount:geo=US:start=2026-08-02:end=2026-10-25:imported=2026-10-30T00:00:00.000Z`
      );
    });
  });

  describe("Section C: Google Trending Now Signal & G15 Evergreen Requirement", () => {
    it("C01: Google Trending Now provider is marked as discovery only and unverified provenance", () => {
      const provider = new GoogleTrendingNowProvider();
      expect(provider.providerId).toBe("google-trending-now");
    });

    it("C02: Trending signals with short duration (< 60 days) fail G15 Evergreen Demand Gate", () => {
      const trendingDataPoints = [
        { periodStart: "2026-10-20T00:00:00.000Z", periodEnd: "2026-10-20T23:59:59.000Z", demandValue: 90, source: "GOOGLE_TRENDING_NOW" },
        { periodStart: "2026-10-22T00:00:00.000Z", periodEnd: "2026-10-22T23:59:59.000Z", demandValue: 95, source: "GOOGLE_TRENDING_NOW" },
        { periodStart: "2026-10-25T00:00:00.000Z", periodEnd: "2026-10-25T23:59:59.000Z", demandValue: 85, source: "GOOGLE_TRENDING_NOW" },
      ];

      const assessment = evaluateDemandHistoryEvidence(trendingDataPoints as any, { minimumCoveredDays: 60 });
      expect(assessment.eligibleForEvergreen).toBe(false);
      expect(assessment.temporalCoverageValid).toBe(false);
      expect(assessment.coveredDays).toBeLessThan(60);
    });
  });

  describe("Section D: TikTok Organic Permanent Disabling", () => {
    it("D01: isSourceHiddenOrDisabled returns true for TIKTOK_ORGANIC and false for others", () => {
      expect(isSourceHiddenOrDisabled("TIKTOK_ORGANIC")).toBe(true);
      expect(isSourceHiddenOrDisabled("META_ADS")).toBe(false);
      expect(isSourceHiddenOrDisabled("GOOGLE_ADS")).toBe(false);
      expect(isSourceHiddenOrDisabled("DEMAND_HISTORY")).toBe(false);
      expect(isSourceHiddenOrDisabled("TIKTOK_ADS")).toBe(false);
    });

    it("D02: isSourceTemporarilyDisabled returns true for TIKTOK_ORGANIC unconditionally", () => {
      process.env.ENABLE_TIKTOK_RESEARCH = "true";
      expect(isSourceTemporarilyDisabled("TIKTOK_ORGANIC")).toBe(true);
      process.env.ENABLE_TIKTOK_RESEARCH = "false";
      expect(isSourceTemporarilyDisabled("TIKTOK_ORGANIC")).toBe(true);
    });

    it("D03: getSourcePolicy returns DISABLED and zero permissions for TIKTOK_ORGANIC", () => {
      const policy = getSourcePolicy("TIKTOK_ORGANIC");
      expect(policy.status).toBe("DISABLED");
      expect(policy.outboundAllowed).toBe(false);
      expect(policy.quotaCheckAllowed).toBe(false);
      expect(policy.cacheReuseInResearchAllowed).toBe(false);
    });

    it("D04: filterActiveResearchSources strictly omits TIKTOK_ORGANIC", () => {
      const allSources: any[] = ["META_ADS", "TIKTOK_ORGANIC", "GOOGLE_ADS", "DEMAND_HISTORY"];
      const active = filterActiveResearchSources(allSources);
      expect(active).not.toContain("TIKTOK_ORGANIC");
      expect(active).toContain("META_ADS");
      expect(active).toContain("GOOGLE_ADS");
      expect(active).toContain("DEMAND_HISTORY");
    });

    it("D05: listActiveResearchSources does not list TIKTOK_ORGANIC", () => {
      const active = listActiveResearchSources();
      expect(active).not.toContain("TIKTOK_ORGANIC");
    });

    it("D06: listKH02SourceCapabilities excludes TIKTOK_ORGANIC", () => {
      const caps = listKH02SourceCapabilities();
      const sources = caps.map((c) => c.source);
      expect(sources).not.toContain("TIKTOK_ORGANIC");
      expect(sources).toContain("META_ADS");
      expect(sources).toContain("GOOGLE_ADS");
    });

    it("D07: testKH02SourceConnection for TIKTOK_ORGANIC returns DISABLED immediately without network probe", async () => {
      const fetchSpy = vi.spyOn(globalThis, "fetch");
      const diag = await testKH02SourceConnection("TIKTOK_ORGANIC");
      expect(diag.status).toBe("DISABLED");
      expect(diag.reason).toContain("permanently disabled in KH-02");
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it("D08: diagnoseKH02Source for TIKTOK_ORGANIC returns DISABLED without requiring credentials", async () => {
      delete process.env.HASDATA_API_KEY;
      delete process.env.TIKTOK_ORGANIC_API_KEY;

      const diag = await diagnoseKH02Source("TIKTOK_ORGANIC");
      expect(diag.status).toBe("DISABLED");
      expect(diag.missingRequirements).toHaveLength(0);
      expect(diag.dimensions?.authStatus).toBe("DISABLED");
    });
  });
});
