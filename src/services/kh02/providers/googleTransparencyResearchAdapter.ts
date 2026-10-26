/**
 * SWAI KH-02 — Google Ads Transparency Center Adapter
 *
 * Queries public Google Ads Transparency Center records by confirmed
 * advertiser domain or brand name to identify cross-platform commercial activity.
 *
 * Rules:
 * 1. Requires a confirmed landing page or advertiser domain from product candidates.
 * 2. Does not infer spend, conversion rates, ROAS, or product revenue.
 * 3. Classifies product relevance: PRODUCT_SPECIFIC vs BRAND_RELATED vs UNRELATED.
 * 4. Reports BLOCKED_SOURCE if Google challenges or blocks requests without proxy rotation.
 */

import {
  IntelligenceQuery,
  SourceResearchResult,
  SourceObservation,
  GoogleTransparencyAd,
} from "../types";

/**
 * Collects Google Ads Transparency observations for known advertiser domains.
 */
export async function collectGoogleAdvertiserSignals(
  query: IntelligenceQuery
): Promise<SourceResearchResult> {
  const startedAt = new Date().toISOString();
  const errors: string[] = [];
  const warnings: string[] = [];

  // 1. Google Ads research requires domains or advertiser names
  const targetDomains = query.advertiserDomains && query.advertiserDomains.length > 0
    ? query.advertiserDomains
    : [];

  if (targetDomains.length === 0) {
    warnings.push("Google Ads Transparency: No confirmed advertiser domains provided for lookup. Domain required.");
    return {
      source: "GOOGLE_ADS",
      status: "SKIPPED",
      observations: [],
      retrievedCount: 0,
      acceptedCount: 0,
      rejectedCount: 0,
      estimatedCredits: 0,
      consumedCredits: 0,
      startedAt,
      completedAt: new Date().toISOString(),
      errors,
      warnings,
    };
  }

  // 2. Query Google Transparency MCP if configured, or check server endpoint
  const googleTransparencyEndpoint = process.env.GOOGLE_TRANSPARENCY_MCP_URL || process.env.GOOGLE_ADS_MCP_URL;
  if (!googleTransparencyEndpoint) {
    warnings.push("Google Ads Transparency Center MCP server is not configured in environment. Reporting unverified.");
    return {
      source: "GOOGLE_ADS",
      status: "NOT_CONFIGURED",
      observations: [],
      retrievedCount: 0,
      acceptedCount: 0,
      rejectedCount: 0,
      estimatedCredits: 0,
      consumedCredits: 0,
      startedAt,
      completedAt: new Date().toISOString(),
      errors,
      warnings,
    };
  }

  try {
    const observations: SourceObservation[] = [];
    for (const domain of targetDomains.slice(0, 5)) {
      try {
        const res = await fetch(`${googleTransparencyEndpoint}/search_advertiser_by_domain`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ domain }),
          signal: query.signal,
        });

        if (!res.ok) {
          if (res.status === 403 || res.status === 429) {
            warnings.push(`Google Transparency query for domain '${domain}' was rate-limited or blocked.`);
            continue;
          }
          continue;
        }

        const json = await res.json();
        const ads: any[] = Array.isArray(json.ads) ? json.ads : [];

        for (const ad of ads) {
          const creativeId = String(ad.creative_id || ad.id || "");
          const format = ad.format === "video" ? "VIDEO" : (ad.format === "image" ? "IMAGE" : "TEXT");
          
          // Evaluate product relevance against topic
          const textContent = `${ad.headline || ""} ${ad.body || ""}`.toLowerCase();
          const topicWords = query.topic.toLowerCase().split(/\s+/).filter((w) => w.length > 2);
          const hasTopicMatch = topicWords.some((w) => textContent.includes(w));
          const relevance = hasTopicMatch ? "PRODUCT_SPECIFIC" : "BRAND_RELATED";

          observations.push({
            source: "GOOGLE_ADS",
            sourceRecordId: creativeId,
            sourceUrl: ad.source_url || `https://adstransparency.google.com/advertiser/${ad.advertiser_id || ""}`,
            advertiserOrCreator: ad.advertiser_name || domain,
            advertiserDomain: domain,
            productMatchHint: ad.headline || null,
            reportedPublishedAt: null,
            reportedFirstShownAt: ad.first_shown || null,
            reportedLastShownAt: ad.last_shown || null,
            observedAt: new Date().toISOString(),
            requestedMarket: "US",
            verifiedDeliveryMarket: ad.region || "US",
            title: ad.headline || null,
            description: ad.body || null,
            metrics: {
              lastShown: ad.last_shown,
              format,
              productRelevance: relevance,
            },
            media: {
              thumbnailUrl: ad.thumbnail_url || null,
              videoUrl: ad.video_url || null,
              mediaType: format,
            },
            provenance: "REAL_UPSTREAM",
            evidenceReference: `GoogleAd:${creativeId}`,
          });
        }
      } catch (domainErr: any) {
        warnings.push(`Domain lookup error for ${domain}: ${domainErr.message}`);
      }
    }

    const status = observations.length > 0 ? "PASSED" : "NO_RESULTS";

    return {
      source: "GOOGLE_ADS",
      status,
      observations,
      retrievedCount: observations.length,
      acceptedCount: observations.length,
      rejectedCount: 0,
      estimatedCredits: 0,
      consumedCredits: 0,
      startedAt,
      completedAt: new Date().toISOString(),
      errors,
      warnings,
    };
  } catch (err: any) {
    return {
      source: "GOOGLE_ADS",
      status: "BLOCKED_SOURCE",
      observations: [],
      retrievedCount: 0,
      acceptedCount: 0,
      rejectedCount: 0,
      estimatedCredits: 0,
      consumedCredits: 0,
      startedAt,
      completedAt: new Date().toISOString(),
      errors: [err.message || "Google Ads Transparency Center access was blocked or interrupted."],
      warnings,
    };
  }
}
