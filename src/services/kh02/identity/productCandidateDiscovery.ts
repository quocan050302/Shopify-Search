/**
 * SWAI KH-02 — Product Candidate Discovery Service
 *
 * Extracts consolidated product candidates from raw advertisement observations.
 * Prevents ad fragmentation by grouping multiple creatives promoting the same item.
 *
 * Invariant:
 * 50 Meta ads and 10 TikTok ads for the same product must become 1 Candidate,
 * not 60 separate products.
 */

import { SourceObservation, ProductMatchConfidence } from "../types";
import {
  canonicalizeProductUrl,
  extractDomainFromUrl,
} from "@/services/products/productService";

export interface DiscoveredProductCandidate {
  candidateId: string;
  title: string;
  category: string;
  problemStatement: string | null;
  targetAudience: string | null;
  thumbnailUrl: string | null;
  videoUrl: string | null;
  canonicalProductUrl: string | null;
  storeDomain: string | null;
  advertiserNames: string[];
  supportingAdIds: string[];
  supportingSourceTypes: string[];
  totalObservationCount: number;
  distinctAdvertisersCount: number;
  earliestObservationDate: string | null;
  latestObservationDate: string | null;
  identityConfidence: ProductMatchConfidence;
  sourceObservations: SourceObservation[];
}

/**
 * Normalizes title string by stripping common ad copy clickbait suffixes.
 */
function cleanCandidateTitle(rawTitle: string): string {
  let title = rawTitle.trim();
  // Strip trailing punctuation and common ad hook slogans
  title = title.replace(/\s*[-–|:]\s*(Buy Now|Shop Now|50% Off|Free Shipping|Sale|Official Store).*$/i, "");
  title = title.replace(/^(NEW|HOT|MUST HAVE|VIRAL)\s*[:!-]\s*/i, "");
  return title.slice(0, 100);
}

/**
 * Extracts a concise problem statement from ad copy or headline.
 */
function inferProblemStatement(headline: string | null, body: string | null): string | null {
  const combined = `${headline || ""} ${body || ""}`.trim();
  if (!combined) return null;

  // Look for problem-solution indicators
  const problemMatches = combined.match(/(tired of|say goodbye to|struggling with|stop wasting|easily remove|helps you|designed to solve|eliminates|protect your|keep your)\s+([^.!?]+)/i);
  if (problemMatches && problemMatches[0]) {
    return problemMatches[0].trim();
  }

  // Fallback to first coherent sentence if short
  const firstSentence = combined.split(/[.!?]/)[0];
  if (firstSentence && firstSentence.length > 15 && firstSentence.length < 120) {
    return firstSentence.trim();
  }

  return null;
}

/**
 * Extracts consolidated product candidates from multi-source ad observations.
 */
export function discoverProductCandidatesFromAds(
  observations: SourceObservation[],
  topic: string
): DiscoveredProductCandidate[] {
  // Map keyed by canonical product URL or fallback domain+slug
  const candidateMap = new Map<string, {
    key: string;
    titles: string[];
    descriptions: string[];
    canonicalUrl: string | null;
    storeDomain: string | null;
    advertisers: Set<string>;
    thumbnails: string[];
    videos: string[];
    adIds: string[];
    sources: Set<string>;
    observations: SourceObservation[];
    earliest: string | null;
    latest: string | null;
    confidence: ProductMatchConfidence;
  }>();

  for (const obs of observations) {
    const rawUrl = obs.sourceUrl || obs.advertiserDomain || "";
    let canonicalUrl: string | null = null;
    let storeDomain: string | null = obs.advertiserDomain || null;
    let groupKey: string;

    if (rawUrl.startsWith("http")) {
      const canonical = canonicalizeProductUrl(rawUrl);
      canonicalUrl = canonical.canonicalUrl;
      storeDomain = extractDomainFromUrl(rawUrl) || canonical.hostname;
      groupKey = canonical.comparisonKey;
    } else if (storeDomain) {
      groupKey = `${storeDomain}::${cleanCandidateTitle(obs.title || topic)}`;
    } else {
      // Fallback: group by title similarity
      groupKey = `GENERIC::${cleanCandidateTitle(obs.title || topic).toLowerCase()}`;
    }

    let candidate = candidateMap.get(groupKey);
    if (!candidate) {
      candidate = {
        key: groupKey,
        titles: [],
        descriptions: [],
        canonicalUrl,
        storeDomain,
        advertisers: new Set<string>(),
        thumbnails: [],
        videos: [],
        adIds: [],
        sources: new Set<string>(),
        observations: [],
        earliest: null,
        latest: null,
        confidence: canonicalUrl && canonicalUrl.includes("/products/") ? "EXACT" : (storeDomain ? "PROBABLE" : "AMBIGUOUS"),
      };
      candidateMap.set(groupKey, candidate);
    }

    if (obs.title) candidate.titles.push(obs.title);
    if (obs.description) candidate.descriptions.push(obs.description);
    if (obs.advertiserOrCreator) candidate.advertisers.add(obs.advertiserOrCreator);
    if (obs.media?.thumbnailUrl) candidate.thumbnails.push(obs.media.thumbnailUrl);
    if (obs.media?.videoUrl) candidate.videos.push(obs.media.videoUrl);
    if (obs.sourceRecordId) candidate.adIds.push(obs.sourceRecordId);
    candidate.sources.add(obs.source);
    candidate.observations.push(obs);

    // Update earliest/latest observation dates
    const obsDate = obs.observedAt || obs.reportedLastShownAt || obs.reportedFirstShownAt;
    if (obsDate) {
      if (!candidate.earliest || new Date(obsDate) < new Date(candidate.earliest)) {
        candidate.earliest = obsDate;
      }
      if (!candidate.latest || new Date(obsDate) > new Date(candidate.latest)) {
        candidate.latest = obsDate;
      }
    }
  }

  // Convert map into clean DiscoveredProductCandidate list
  const candidates: DiscoveredProductCandidate[] = [];
  let index = 1;

  for (const [key, c] of candidateMap.entries()) {
    // Select most representative title (shortest non-empty clean title)
    const sortedTitles = c.titles
      .map(cleanCandidateTitle)
      .filter((t) => t.length > 5)
      .sort((a, b) => a.length - b.length);

    const title = sortedTitles[0] || `${topic} Solution #${index}`;
    const problemStatement = inferProblemStatement(c.titles[0] || null, c.descriptions[0] || null);

    candidates.push({
      candidateId: `cand_${Math.abs(hashCode(key))}_${index}`,
      title,
      category: topic,
      problemStatement,
      targetAudience: "Homeowners, Pet Owners & Everyday Problem Solvers",
      thumbnailUrl: c.thumbnails[0] || null,
      videoUrl: c.videos[0] || null,
      canonicalProductUrl: c.canonicalUrl,
      storeDomain: c.storeDomain,
      advertiserNames: Array.from(c.advertisers),
      supportingAdIds: Array.from(new Set(c.adIds)),
      supportingSourceTypes: Array.from(c.sources),
      totalObservationCount: c.observations.length,
      distinctAdvertisersCount: c.advertisers.size,
      earliestObservationDate: c.earliest,
      latestObservationDate: c.latest,
      identityConfidence: c.confidence,
      sourceObservations: c.observations,
    });

    index++;
  }

  return candidates;
}

function hashCode(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = (hash << 5) - hash + str.charCodeAt(i);
    hash |= 0;
  }
  return hash;
}
