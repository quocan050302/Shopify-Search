/**
 * SWAI KH-02 V12.3 — Discovery Query Planner
 *
 * Implements Section D6 requirements:
 * Generates structured, evidence-grounded search plans for niche acquisition:
 * - Employs KEYWORD_EXACT_PHRASE to prevent broad token match pollution (e.g. page 'Gadgets' matching 'Pet Gadgets').
 * - Restricts subquery expansion to domain-specific product types with explicit rationales.
 * - Enforces bounded requests, max records, and deduplication across subqueries.
 */

export interface DiscoverySubqueryPlan {
  subquery: string;
  searchType: "KEYWORD_EXACT_PHRASE" | "KEYWORD_UNORDERED";
  rationale: string;
  maxResults: number;
}

export interface KH02DiscoveryQueryPlan {
  topic: string;
  market: string;
  primaryQuery: DiscoverySubqueryPlan;
  subqueries: DiscoverySubqueryPlan[];
  maxTotalResults: number;
  maxRequests: number;
  deduplicateAcrossSubqueries: boolean;
  createdAt: string;
}

// Domain-aligned subquery catalogs for common consumer ecommerce niches
const NICHE_SUBQUERY_TEMPLATES: Record<string, Array<{ subquery: string; rationale: string }>> = {
  pet: [
    { subquery: "pet hair remover", rationale: "High-demand everyday deshedding & cleaning tool" },
    { subquery: "automatic pet feeder", rationale: "Smart hardware / electronic gadget for feeding" },
    { subquery: "dog water fountain", rationale: "Smart pet hydration and filtration appliance" },
    { subquery: "dog grooming vacuum", rationale: "Electronic pet grooming and hair capture tool" },
    { subquery: "smart pet collar", rationale: "Connected tracking & safety hardware for pets" },
  ],
  beauty: [
    { subquery: "facial cleansing brush", rationale: "Electronic skincare device" },
    { subquery: "red light therapy wand", rationale: "Dermatological wellness hardware" },
  ],
};

/**
 * Builds a disciplined, bounded query plan for KH-02 research discovery.
 */
export function buildKH02DiscoveryQueryPlan(
  topic: string,
  market: string = "US",
  options: { maxTotalResults?: number; maxRequests?: number } = {}
): KH02DiscoveryQueryPlan {
  const cleanTopic = (topic || "").trim().slice(0, 100);
  const normalizedLower = cleanTopic.toLowerCase();
  const maxTotal = options.maxTotalResults ? Math.min(100, Math.max(5, options.maxTotalResults)) : 25;
  const maxReqs = options.maxRequests ? Math.min(10, Math.max(1, options.maxRequests)) : 4;

  // Primary query: use EXACT PHRASE to prevent token spray
  const primaryQuery: DiscoverySubqueryPlan = {
    subquery: cleanTopic,
    searchType: "KEYWORD_EXACT_PHRASE",
    rationale: `Primary research topic exact phrase matching for '${cleanTopic}'`,
    maxResults: Math.min(20, maxTotal),
  };

  const subqueries: DiscoverySubqueryPlan[] = [];

  // Match domain niche
  let matchedNiche = "";
  for (const key of Object.keys(NICHE_SUBQUERY_TEMPLATES)) {
    if (normalizedLower.includes(key)) {
      matchedNiche = key;
      break;
    }
  }

  if (matchedNiche && NICHE_SUBQUERY_TEMPLATES[matchedNiche]) {
    const templates = NICHE_SUBQUERY_TEMPLATES[matchedNiche];
    for (const t of templates) {
      if (t.subquery.toLowerCase() !== normalizedLower) {
        subqueries.push({
          subquery: t.subquery,
          searchType: "KEYWORD_EXACT_PHRASE",
          rationale: `${t.rationale} within ${cleanTopic} domain`,
          maxResults: 10,
        });
      }
      if (subqueries.length >= 3) break; // Bounded expansion: max 3 subqueries
    }
  }

  return {
    topic: cleanTopic,
    market: market.toUpperCase().slice(0, 2) || "US",
    primaryQuery,
    subqueries,
    maxTotalResults: maxTotal,
    maxRequests: maxReqs,
    deduplicateAcrossSubqueries: true,
    createdAt: new Date().toISOString(),
  };
}
