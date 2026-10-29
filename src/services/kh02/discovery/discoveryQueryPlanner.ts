/**
 * SWAI KH-02 V12.4.2 — Hybrid AI + Deterministic Discovery Query Planner
 *
 * Implements Section D6 & V12.4.2 Phases A/B/C/H:
 * - Preserves synchronous buildKH02DiscoveryQueryPlan and MetaQueryBudgetTracker contracts
 * - Integrates Gemini Niche Understanding & Archetype Planning (buildHybridKH02DiscoveryQueryPlan)
 * - Expands domain templates to diy, gardening, home decor, pet, beauty, cleaning, kitchen,
 *   plus generalized physical-product archetype synthesis for unfamiliar topics
 * - Provides QueryYield and ShortlistCoverageState evaluation for bounded multi-round adaptive search
 */

import {
  AIDiscoveryPlan,
  analyzeNicheIntent,
  buildDeterministicDiscoveryPlan,
  clearDiscoveryPlanCache,
  DiscoveryPlannerInput,
  DiscoveryPlannerTelemetry,
  DiscoveryPlanValidationResult,
  DiscoveryQuery,
  DiscoveryQueryOrigin,
  DiscoveryQuerySearchType,
  generateDiscoveryQueries,
  GenerateDiscoveryQueriesOptions,
  generateProductArchetypes,
  NicheIntentAnalysisResult,
  NicheIntentType,
  PlannedProductArchetype,
  PlannedSearchQuery,
  validateDiscoveryPlan,
} from "./geminiDiscoveryPlanner";

export type {
  AIDiscoveryPlan,
  DiscoveryPlannerInput,
  DiscoveryPlannerTelemetry,
  DiscoveryPlanValidationResult,
  DiscoveryQuery,
  DiscoveryQueryOrigin,
  DiscoveryQuerySearchType,
  GenerateDiscoveryQueriesOptions,
  NicheIntentAnalysisResult,
  NicheIntentType,
  PlannedProductArchetype,
  PlannedSearchQuery,
};

export {
  analyzeNicheIntent,
  buildDeterministicDiscoveryPlan,
  clearDiscoveryPlanCache,
  generateDiscoveryQueries,
  generateProductArchetypes,
  validateDiscoveryPlan,
};

export interface DiscoverySubqueryPlan {
  subquery: string;
  searchType: "KEYWORD_EXACT_PHRASE" | "KEYWORD_UNORDERED";
  rationale: string;
  maxResults: number;
  queryId?: string;
  archetypeId?: string | null;
  origin?: DiscoveryQueryOrigin;
  roundNumber?: number;
  priority?: number;
  expectedProductCategory?: string | null;
}

export interface MetaResearchBudget {
  maxLogicalSubqueries: number;
  maxProviderRequests: number;
  maxPages: number;
  maxUniqueAds: number;
  maxDurationMs: number;
}

export class MetaQueryBudgetTracker {
  public consumedRequests: number = 0;
  private consumedPages: number = 0;
  private uniqueAdsObserved: number = 0;
  private startTime: number;
  private budget: MetaResearchBudget;

  constructor(budget: MetaResearchBudget) {
    this.budget = budget;
    this.startTime = Date.now();
  }

  get remainingRequests(): number {
    return Math.max(0, this.budget.maxProviderRequests - this.consumedRequests);
  }

  get remainingUniqueAds(): number {
    return Math.max(0, this.budget.maxUniqueAds - this.uniqueAdsObserved);
  }

  isExpired(): boolean {
    return Date.now() - this.startTime >= this.budget.maxDurationMs;
  }

  canFetchMorePages(): boolean {
    return !this.isExhausted && this.consumedPages < this.budget.maxPages && this.remainingRequests > 0;
  }

  recordPageFetched(): void {
    this.consumedPages += 1;
  }

  get isExhausted(): boolean {
    if (this.consumedRequests >= this.budget.maxProviderRequests) return true;
    if (this.consumedPages >= this.budget.maxPages) return true;
    if (this.uniqueAdsObserved >= this.budget.maxUniqueAds) return true;
    if (this.isExpired()) return true;
    return false;
  }

  canExecuteSubquery(): boolean {
    return !this.isExhausted && this.remainingRequests > 0;
  }

  canExecuteNextRequest(): boolean {
    return this.canExecuteSubquery();
  }

  canExecuteRequest(): boolean {
    return this.canExecuteSubquery();
  }

  tryConsume(requests: number = 1): boolean {
    if (this.remainingRequests >= requests && !this.isExhausted) {
      this.recordUsage(requests, 0, requests);
      return true;
    }
    return false;
  }

  reserveRequest(): boolean {
    if (this.canExecuteNextRequest()) {
      this.recordUsage(1, 0, 1);
      return true;
    }
    return false;
  }

  recordRequestSuccess(adsCount: number): void {
    this.uniqueAdsObserved += Math.max(0, adsCount);
  }

  getUsage(): { actualProviderRequests: number; totalAdsCollected: number } {
    return {
      actualProviderRequests: this.consumedRequests,
      totalAdsCollected: this.uniqueAdsObserved,
    };
  }

  reserveRequests(maxDesired: number): number {
    const available = this.remainingRequests;
    if (available <= 0) return 0;
    const reserved = Math.min(Math.max(1, maxDesired), available);
    // Atomically commit reserved capacity so failed requests/exceptions retain accountability
    this.consumedRequests += reserved;
    return reserved;
  }

  finalizeUsage(
    reservedRequests: number,
    actualRequests: number,
    adsCount: number,
    pagesConsumed: number = 1
  ): void {
    if (actualRequests < reservedRequests) {
      const refund = Math.max(0, reservedRequests - Math.max(0, actualRequests));
      this.consumedRequests = Math.max(0, this.consumedRequests - refund);
    }
    this.uniqueAdsObserved += Math.max(0, adsCount);
    this.consumedPages += Math.max(0, pagesConsumed);
  }

  recordFailure(reservedRequests: number, actualAttempted?: number): void {
    if (typeof actualAttempted === "number" && actualAttempted < reservedRequests) {
      const refund = Math.max(0, reservedRequests - Math.max(1, actualAttempted));
      this.consumedRequests = Math.max(0, this.consumedRequests - refund);
    }
    this.consumedPages += 1;
  }

  recordUsage(requestsConsumed: number, adsCount: number, pagesConsumed: number = 1): void {
    this.consumedRequests += Math.max(0, requestsConsumed);
    this.uniqueAdsObserved += Math.max(0, adsCount);
    this.consumedPages += Math.max(0, pagesConsumed);
  }

  getUsageSummary(): {
    consumedRequests: number;
    consumedPages: number;
    uniqueAdsObserved: number;
    elapsedMs: number;
    isBudgetExhausted: boolean;
    stopReason: string;
  } {
    const stopReason = this.isExpired()
      ? "DEADLINE_EXCEEDED"
      : this.consumedRequests >= this.budget.maxProviderRequests
      ? "PROVIDER_REQUEST_CAP_REACHED"
      : this.consumedPages >= this.budget.maxPages
      ? "PAGE_CAP_REACHED"
      : this.uniqueAdsObserved >= this.budget.maxUniqueAds
      ? "UNIQUE_ADS_CAP_REACHED"
      : "ACTIVE";
    return {
      consumedRequests: this.consumedRequests,
      consumedPages: this.consumedPages,
      uniqueAdsObserved: this.uniqueAdsObserved,
      elapsedMs: Date.now() - this.startTime,
      isBudgetExhausted: this.isExhausted,
      stopReason,
    };
  }
}

export interface KH02DiscoveryQueryPlan {
  topic: string;
  market: string;
  nicheIntent?: NicheIntentType;
  primaryQuery: DiscoverySubqueryPlan;
  subqueries: DiscoverySubqueryPlan[];
  maxTotalResults: number;
  maxRequests: number;
  budget: MetaResearchBudget;
  deduplicateAcrossSubqueries: boolean;
  createdAt: string;
  aiPlan?: AIDiscoveryPlan;
  validatedQueries?: DiscoveryQuery[];
  plannerTelemetry?: DiscoveryPlannerTelemetry;
}

export interface QueryYield {
  queryId: string;
  phrase?: string;
  source?: string;
  roundNumber?: number;
  origin?: DiscoveryQueryOrigin;
  archetypeId?: string | null;
  actualAdsReturned: number;
  uniqueAdsReturned: number;

  relevantCandidates: number;
  merchantLinkedCandidates: number;
  identifiableProducts: number;

  qualifiedShortlistContributions: number;

  rejectedCandidates: number;
  duplicateAds: number;

  sourceStatus: string;
}

export type ShortlistCoverageStopReason =
  | "TARGET_REACHED"
  | "SOURCE_BUDGET_EXHAUSTED"
  | "AI_BUDGET_EXHAUSTED"
  | "TIME_DEADLINE"
  | "SOURCE_UNAVAILABLE"
  | "NO_USEFUL_QUERIES"
  | "CANCELLED"
  | "CONTINUE";

export interface ShortlistCoverageState {
  requestedCount: number;

  qualifiedProducts: number;

  distinctProductArchetypesObserved: number;
  distinctFamiliesObserved?: number;
  homogeneousFamilyDetected?: boolean;

  unresolvedCandidates: number;
  unverifiedQueueRemaining?: number;

  remainingSourceQueries: number;
  remainingAIRequests: number;

  missingArchetypes: string[];

  recoveryRecommended: boolean;
  recoveryTriggerReason?: string | null;

  stopReason: ShortlistCoverageStopReason;
}

// Domain-aligned subquery catalogs for consumer ecommerce niches (used as fallback seeds)
const NICHE_SUBQUERY_TEMPLATES: Record<
  string,
  Array<{ subquery: string; rationale: string; archetypeId?: string; category?: string }>
> = {
  dog: [
    {
      subquery: "dog hair remover",
      rationale: "High-demand dog fur deshedding & furniture cleaning tool",
      archetypeId: "pet_grooming_hair_removal",
      category: "Dog Grooming",
    },
    {
      subquery: "orthopedic dog bed",
      rationale: "Supportive calming and orthopedic dog bedding",
      archetypeId: "pet_bedding",
      category: "Dog Bedding",
    },
    {
      subquery: "dog water fountain",
      rationale: "Filtered dog hydration and water dispenser",
      archetypeId: "pet_hydration",
      category: "Dog Hydration",
    },
    {
      subquery: "dog grooming vacuum",
      rationale: "Electronic dog coat brushing and hair capture device",
      archetypeId: "pet_grooming_vacuum",
      category: "Dog Grooming",
    },
  ],
  cat: [
    {
      subquery: "cat water fountain",
      rationale: "Filtered stainless steel cat hydration appliance",
      archetypeId: "pet_hydration",
      category: "Cat Hydration",
    },
    {
      subquery: "automatic cat feeder",
      rationale: "Timed wet/dry cat food dispenser",
      archetypeId: "pet_feeding",
      category: "Cat Feeding",
    },
    {
      subquery: "cat litter mat",
      rationale: "Double-layer honeycomb cat litter trapping mat",
      archetypeId: "pet_litter_care",
      category: "Cat Litter Care",
    },
  ],
  pet: [
    {
      subquery: "pet hair remover",
      rationale: "High-demand everyday deshedding & cleaning tool",
      archetypeId: "pet_grooming_hair_removal",
      category: "Pet Grooming",
    },
    {
      subquery: "automatic pet feeder",
      rationale: "Smart hardware / electronic gadget for feeding",
      archetypeId: "pet_feeding",
      category: "Pet Feeding",
    },
    {
      subquery: "dog water fountain",
      rationale: "Smart pet hydration and filtration appliance",
      archetypeId: "pet_hydration",
      category: "Pet Hydration",
    },
    {
      subquery: "dog grooming vacuum",
      rationale: "Electronic pet grooming and hair capture tool",
      archetypeId: "pet_grooming_vacuum",
      category: "Pet Grooming",
    },
    {
      subquery: "smart pet collar",
      rationale: "Connected tracking & safety hardware for pets",
      archetypeId: "pet_safety_travel",
      category: "Pet Safety",
    },
  ],
  beauty: [
    {
      subquery: "facial cleansing brush",
      rationale: "Electronic skincare device",
      archetypeId: "facial_cleansing",
      category: "Skincare Devices",
    },
    {
      subquery: "red light therapy wand",
      rationale: "Dermatological wellness hardware",
      archetypeId: "facial_sculpting_devices",
      category: "Beauty Devices",
    },
    {
      subquery: "pore vacuum cleanser",
      rationale: "Facial blackhead suction appliance",
      archetypeId: "pore_care",
      category: "Skincare Treatments",
    },
  ],
  cleaning: [
    {
      subquery: "electric spin scrubber",
      rationale: "Motorized bathroom & surface scrubbing tool",
      archetypeId: "power_scrubbers",
      category: "Power Scrubbers",
    },
    {
      subquery: "portable carpet cleaner",
      rationale: "Spot upholstery washing device",
      archetypeId: "carpet_upholstery_cleaners",
      category: "Surface Cleaners",
    },
    {
      subquery: "steam cleaner handheld",
      rationale: "High-temperature chemical-free sanitizing device",
      archetypeId: "crevice_and_steam_cleaners",
      category: "Steam Cleaning",
    },
  ],
  kitchen: [
    {
      subquery: "vegetable chopper",
      rationale: "High-velocity food prep slicing and dicing tool",
      archetypeId: "food_prep_choppers",
      category: "Food Prep Tools",
    },
    {
      subquery: "electric oil spray bottle",
      rationale: "Pressurized uniform cooking dispenser",
      archetypeId: "cooking_dispensers",
      category: "Cooking Dispensers",
    },
    {
      subquery: "rechargeable food sealer",
      rationale: "Mini bag heat-welding preservation gadget",
      archetypeId: "food_preservation",
      category: "Food Storage",
    },
  ],
  diy: [
    {
      subquery: "wall repair kit",
      rationale: "High-intent physical DIY drywall and surface patching product",
      archetypeId: "home_repair_kits",
      category: "Home Repair",
    },
    {
      subquery: "cordless hot glue gun",
      rationale: "Portable physical DIY crafting and bonding tool",
      archetypeId: "diy_crafting_tools",
      category: "DIY Crafting",
    },
    {
      subquery: "decorative switch plate covers",
      rationale: "Self-installed physical DIY home decor hardware upgrade",
      archetypeId: "diy_home_decor_upgrades",
      category: "Home Decor",
    },
    {
      subquery: "pocket hole jig",
      rationale: "Precision woodworking drilling guide for DIY builders",
      archetypeId: "woodworking_jigs",
      category: "Woodworking",
    },
    {
      subquery: "wood scratch repair markers",
      rationale: "Consumer DIY furniture touch-up and surface restoration kit",
      archetypeId: "furniture_restoration",
      category: "Furniture Repair",
    },
  ],
  gardening: [
    {
      subquery: "self watering plant spikes",
      rationale: "Physical automatic plant hydration device",
      archetypeId: "plant_watering_systems",
      category: "Plant Watering",
    },
    {
      subquery: "garden pruning shears",
      rationale: "Physical ergonomic branch and stem cutting tool",
      archetypeId: "pruning_tools",
      category: "Pruning Tools",
    },
    {
      subquery: "seed starter tray",
      rationale: "Physical indoor seedling germination kit",
      archetypeId: "seed_starting_kits",
      category: "Seed Starting",
    },
  ],
  "home decor": [
    {
      subquery: "decorative switch plate covers",
      rationale: "Physical decorative light switch and outlet plate upgrade",
      archetypeId: "decorative_switch_covers",
      category: "Decorative Hardware",
    },
    {
      subquery: "rechargeable wall sconce",
      rationale: "Cordless physical wall accent lighting fixture",
      archetypeId: "ambient_accent_lighting",
      category: "Accent Lighting",
    },
    {
      subquery: "peel and stick wall tiles",
      rationale: "Removable physical wall accent panels",
      archetypeId: "peel_stick_wall_accents",
      category: "Wall Accents",
    },
  ],
};

/**
 * Builds a disciplined, bounded query plan for KH-02 research discovery.
 * Synchronous deterministic entry point preserved for backward compatibility
 * while supporting DIY, gardening, home decor, and unfamiliar niches.
 */
export function buildKH02DiscoveryQueryPlan(
  topic: string,
  market: string = "US",
  options: { maxTotalResults?: number; maxRequests?: number } = {}
): KH02DiscoveryQueryPlan {
  const cleanTopic = (topic || "").trim().slice(0, 100);
  const normalizedLower = cleanTopic.toLowerCase();
  const maxTotal = options.maxTotalResults
    ? Math.min(100, Math.max(5, options.maxTotalResults))
    : 25;
  const maxReqs = options.maxRequests
    ? Math.min(10, Math.max(1, options.maxRequests))
    : 3;

  const intent = analyzeNicheIntent(cleanTopic);

  const budget: MetaResearchBudget = {
    maxLogicalSubqueries: 3,
    maxProviderRequests: maxReqs,
    maxPages: Math.max(1, Math.ceil(maxTotal / 10)),
    maxUniqueAds: maxTotal,
    maxDurationMs: 45_000,
  };

  // Primary query: use EXACT PHRASE to prevent token spray
  const primaryQuery: DiscoverySubqueryPlan = {
    subquery: cleanTopic,
    searchType: "KEYWORD_EXACT_PHRASE",
    rationale: `Primary research topic exact phrase matching for '${cleanTopic}'`,
    maxResults: Math.min(20, maxTotal),
    queryId: "primary",
    origin: "USER",
    roundNumber: 1,
    priority: 1,
  };

  const subqueries: DiscoverySubqueryPlan[] = [];

  // Match domain niche templates first
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
          archetypeId: t.archetypeId || null,
          origin: "DETERMINISTIC_FALLBACK",
          roundNumber: 1,
          priority: subqueries.length + 2,
          expectedProductCategory: t.category || null,
        });
      }
      if (subqueries.length >= 3) break;
    }
  } else if (!intent.isProhibitedOrUnsupported && cleanTopic.length >= 2) {
    // Generalized deterministic archetype expansion for unfamiliar topics
    const detPlan = buildDeterministicDiscoveryPlan(
      {
        researchRunId: "sync_plan",
        topic: cleanTopic,
        market,
        lookbackDays: 90,
        productPolicy: "PHYSICAL_ECOMMERCE_PRODUCTS",
        supportedSources: ["META_ADS"],
        remainingProviderRequests: maxReqs,
        remainingAIRequests: 0,
      },
      intent
    );
    for (const arch of detPlan.productArchetypes) {
      for (const q of arch.searchQueries) {
        if (
          q.phrase.toLowerCase() !== normalizedLower &&
          !subqueries.some(
            (s) => s.subquery.toLowerCase() === q.phrase.toLowerCase()
          )
        ) {
          subqueries.push({
            subquery: q.phrase,
            searchType: q.searchType,
            rationale: q.rationale,
            maxResults: 10,
            archetypeId: arch.archetypeId,
            origin: "DETERMINISTIC_FALLBACK",
            roundNumber: 1,
            priority: subqueries.length + 2,
            expectedProductCategory: arch.productCategory,
          });
        }
        if (subqueries.length >= 3) break;
      }
      if (subqueries.length >= 3) break;
    }
  }

  return {
    topic: cleanTopic,
    market: market.toUpperCase().slice(0, 2) || "US",
    nicheIntent: intent.nicheIntent,
    primaryQuery,
    subqueries,
    maxTotalResults: maxTotal,
    maxRequests: maxReqs,
    budget,
    deduplicateAcrossSubqueries: true,
    createdAt: new Date().toISOString(),
  };
}

/**
 * Builds a V12.4.2 hybrid AI + deterministic query plan for a research run.
 * For BROAD_CATEGORY topics (such as "diy", "pet", "gardening"), prioritizes distinct
 * product-specific archetype queries so the bounded 3-request Meta budget is distributed
 * across concrete physical product queries rather than spending 2 of 3 requests on a
 * single generic word like "diy".
 * For SPECIFIC_PRODUCT topics (such as "pet hair remover", "cordless glue gun"), preserves
 * the user's exact product query as priority 1.
 */
export async function buildHybridKH02DiscoveryQueryPlan(
  input: DiscoveryPlannerInput,
  options?: GenerateDiscoveryQueriesOptions & {
    maxTotalResults?: number;
    maxRequests?: number;
  }
): Promise<KH02DiscoveryQueryPlan> {
  const cleanTopic = (input.topic || "").trim().slice(0, 100);
  const normalizedLower = cleanTopic.toLowerCase();
  const maxTotal = options?.maxTotalResults
    ? Math.min(100, Math.max(5, options.maxTotalResults))
    : 25;
  const maxReqs = options?.maxRequests
    ? Math.min(10, Math.max(1, options.maxRequests))
    : Math.max(1, input.remainingProviderRequests || 3);

  const budget: MetaResearchBudget = {
    maxLogicalSubqueries: maxReqs,
    maxProviderRequests: maxReqs,
    maxPages: Math.max(1, Math.ceil(maxTotal / 10)),
    maxUniqueAds: maxTotal,
    maxDurationMs: 45_000,
  };

  const { plan, validation, queries, telemetry } =
    await generateDiscoveryQueries(input, options);

  const isSpecific = plan.nicheIntent === "SPECIFIC_PRODUCT";
  const finalQueries: DiscoveryQuery[] = [...queries];

  // For SPECIFIC_PRODUCT, ensure the exact user query is priority 1
  if (
    isSpecific &&
    cleanTopic.length >= 2 &&
    !finalQueries.some(
      (q) => q.normalizedPhrase === normalizedLower.replace(/\s+/g, " ")
    )
  ) {
    finalQueries.unshift({
      queryId: `kh02_q_user_${input.researchRunId}`,
      researchRunId: input.researchRunId,
      phrase: cleanTopic,
      normalizedPhrase: normalizedLower.replace(/\s+/g, " "),
      archetypeId: plan.productArchetypes[0]?.archetypeId || "user_specific_sku",
      source: input.supportedSources[0] || "META_ADS",
      searchType: "KEYWORD_EXACT_PHRASE",
      roundNumber: options?.roundNumber ?? 1,
      priority: 1,
      rationale: `Exact specific product query requested by user ('${cleanTopic}').`,
      origin: "USER",
      expectedProductCategory:
        plan.productArchetypes[0]?.productCategory || cleanTopic,
    });
  }

  const primaryDq = finalQueries[0];
  const primaryQuery: DiscoverySubqueryPlan = primaryDq
    ? {
        queryId: primaryDq.queryId,
        subquery: primaryDq.phrase,
        searchType: primaryDq.searchType,
        rationale: primaryDq.rationale,
        maxResults: Math.min(15, maxTotal),
        archetypeId: primaryDq.archetypeId,
        origin: primaryDq.origin,
        roundNumber: primaryDq.roundNumber,
        priority: 1,
        expectedProductCategory: primaryDq.expectedProductCategory,
      }
    : {
        queryId: "primary",
        subquery: cleanTopic,
        searchType: "KEYWORD_EXACT_PHRASE",
        rationale: `Primary research topic exact phrase matching for '${cleanTopic}'`,
        maxResults: Math.min(15, maxTotal),
        archetypeId: null,
        origin: "USER",
        roundNumber: 1,
        priority: 1,
        expectedProductCategory: null,
      };

  const subqueries: DiscoverySubqueryPlan[] = finalQueries
    .slice(1)
    .map((dq, idx) => ({
      queryId: dq.queryId,
      subquery: dq.phrase,
      searchType: dq.searchType,
      rationale: dq.rationale,
      maxResults: 10,
      archetypeId: dq.archetypeId,
      origin: dq.origin,
      roundNumber: dq.roundNumber,
      priority: idx + 2,
      expectedProductCategory: dq.expectedProductCategory,
    }));

  return {
    topic: cleanTopic,
    market: (input.market || "US").toUpperCase().slice(0, 2) || "US",
    nicheIntent: plan.nicheIntent,
    primaryQuery,
    subqueries,
    maxTotalResults: maxTotal,
    maxRequests: maxReqs,
    budget,
    deduplicateAcrossSubqueries: true,
    createdAt: new Date().toISOString(),
    aiPlan: validation.validatedPlan,
    validatedQueries: finalQueries,
    plannerTelemetry: telemetry,
  };
}

/**
 * Selects the bounded set of queries to execute in a search round,
 * ensuring distinct archetype diversity, avoiding any already-executed phrase,
 * and supporting fallback to shorter/unordered queries when an exact phrase returns 0 ads (C26, C28).
 */
export function selectQueriesForSearchRound(
  validatedQueries: DiscoveryQuery[],
  maxQueriesForRound: number,
  executedNormalizedPhrases: Set<string>,
  coveredArchetypeIds: Set<string>,
  roundNumber: number,
  options?: {
    zeroResultQueries?: DiscoveryQuery[];
  }
): DiscoveryQuery[] {
  if (maxQueriesForRound <= 0) {
    return [];
  }

  const available = (validatedQueries || []).filter(
    (q) =>
      !executedNormalizedPhrases.has(q.normalizedPhrase) &&
      !executedNormalizedPhrases.has(`${q.normalizedPhrase}::${q.searchType}`)
  );

  // C26: If exact phrase queries returned 0 ads, synthesize shorter phrase or KEYWORD_UNORDERED fallbacks
  const synthesizedFallbacks: DiscoveryQuery[] = [];
  if (options?.zeroResultQueries && options.zeroResultQueries.length > 0) {
    for (const zq of options.zeroResultQueries) {
      const normPhrase = (zq.normalizedPhrase || zq.phrase || "").trim().toLowerCase();
      const words = normPhrase.split(/\s+/).filter(Boolean);
      if (words.length >= 3) {
        const shorterPhrase = words.slice(-2).join(" ");
        if (!executedNormalizedPhrases.has(shorterPhrase)) {
          synthesizedFallbacks.push({
            ...zq,
            queryId: `${zq.queryId || "zq"}_short_fb`,
            phrase: shorterPhrase,
            normalizedPhrase: shorterPhrase,
            searchType: "KEYWORD_UNORDERED",
            roundNumber,
            origin: "ADAPTIVE_RECOVERY",
            rationale: `Shorter unordered fallback for zero-result exact phrase '${zq.phrase}'`,
          });
        }
      } else if (
        zq.searchType === "KEYWORD_EXACT_PHRASE" &&
        !executedNormalizedPhrases.has(`${normPhrase}::KEYWORD_UNORDERED`)
      ) {
        synthesizedFallbacks.push({
          ...zq,
          queryId: `${zq.queryId || "zq"}_unordered_fb`,
          normalizedPhrase: normPhrase,
          searchType: "KEYWORD_UNORDERED",
          roundNumber,
          origin: "ADAPTIVE_RECOVERY",
          rationale: `Unordered keyword fallback for zero-result exact phrase '${zq.phrase}'`,
        });
      }
    }
  }

  const allCandidates = [...available, ...synthesizedFallbacks];
  if (allCandidates.length === 0) {
    return [];
  }

  const uncovered = allCandidates.filter(
    (q) => !q.archetypeId || !coveredArchetypeIds.has(q.archetypeId)
  );
  const covered = allCandidates.filter(
    (q) => q.archetypeId && coveredArchetypeIds.has(q.archetypeId)
  );

  const prioritized = [...uncovered, ...covered];
  const selected: DiscoveryQuery[] = [];
  const selectedArchetypesInRound = new Set<string>();

  for (const q of prioritized) {
    if (selected.length >= maxQueriesForRound) break;
    if (q.archetypeId && selectedArchetypesInRound.has(q.archetypeId)) {
      continue;
    }
    if (q.archetypeId) {
      selectedArchetypesInRound.add(q.archetypeId);
    }
    selected.push({
      ...q,
      roundNumber,
      origin:
        roundNumber > 1 && q.origin !== "GEMINI_PLANNER"
          ? "ADAPTIVE_RECOVERY"
          : q.origin,
    });
  }

  for (const q of prioritized) {
    if (selected.length >= maxQueriesForRound) break;
    if (
      !selected.some(
        (s) =>
          s.normalizedPhrase === q.normalizedPhrase &&
          s.searchType === q.searchType
      )
    ) {
      selected.push({
        ...q,
        roundNumber,
        origin:
          roundNumber > 1 && q.origin !== "GEMINI_PLANNER"
            ? "ADAPTIVE_RECOVERY"
            : q.origin,
      });
    }
  }

  return selected;
}

/**
 * Evaluates shortlist coverage after a discovery/enrichment/verification round and determines
 * whether bounded adaptive search recovery should continue or stop (Section 6.1–6.5).
 */
export function evaluateShortlistCoverage(params: {
  requestedCount?: number;
  qualifiedProducts: number;
  distinctFamiliesCount?: number;
  nicheIntent?: NicheIntentType;
  observedArchetypeIds: string[];
  plannedArchetypes: PlannedProductArchetype[];
  unresolvedCandidates: number;
  unverifiedQueueRemaining?: number;
  remainingSourceQueries: number;
  remainingAIRequests: number;
  remainingUnusedQueriesCount: number;
  sourceAvailable: boolean;
  timeDeadlineReached: boolean;
  cancelled: boolean;
}): ShortlistCoverageState {
  const requestedCount = params.requestedCount ?? 3;
  const observedSet = new Set(params.observedArchetypeIds.filter(Boolean));
  const missingArchetypes = (params.plannedArchetypes || [])
    .filter((a) => !observedSet.has(a.archetypeId))
    .map((a) => a.productCategory || a.archetypeId);

  const distinctFamilies =
    params.distinctFamiliesCount ?? observedSet.size;
  const isBroadCategory =
    !params.nicheIntent || params.nicheIntent === "BROAD_CATEGORY";
  const homogeneousFamilyDetected =
    isBroadCategory &&
    params.qualifiedProducts >= 2 &&
    distinctFamilies <= 1;

  const needsMoreProducts = params.qualifiedProducts < requestedCount;
  const needsFamilyDiversification =
    isBroadCategory &&
    params.qualifiedProducts >= 1 &&
    distinctFamilies < Math.min(2, requestedCount) &&
    (missingArchetypes.length > 0 ||
      !params.plannedArchetypes ||
      params.plannedArchetypes.length === 0);

  let stopReason: ShortlistCoverageStopReason = "CONTINUE";
  let recoveryRecommended = false;
  let recoveryTriggerReason: string | null = null;

  if (params.cancelled) {
    stopReason = "CANCELLED";
  } else if (!needsMoreProducts && !needsFamilyDiversification) {
    stopReason = "TARGET_REACHED";
  } else if (params.timeDeadlineReached) {
    stopReason = "TIME_DEADLINE";
  } else if (!params.sourceAvailable) {
    stopReason = "SOURCE_UNAVAILABLE";
  } else if (params.remainingSourceQueries <= 0) {
    stopReason = "SOURCE_BUDGET_EXHAUSTED";
  } else if (params.remainingAIRequests <= 0) {
    stopReason = "AI_BUDGET_EXHAUSTED";
  } else if (params.remainingUnusedQueriesCount <= 0) {
    stopReason = "NO_USEFUL_QUERIES";
  } else {
    stopReason = "CONTINUE";
    recoveryRecommended = true;
    recoveryTriggerReason = needsMoreProducts
      ? `Post-gate qualified distinct products (${params.qualifiedProducts}/${requestedCount}) below target.`
      : `Homogeneous product family detected (${distinctFamilies} family across ${params.qualifiedProducts} products); expanding to uncovered archetype.`;
  }

  return {
    requestedCount,
    qualifiedProducts: params.qualifiedProducts,
    distinctProductArchetypesObserved: observedSet.size,
    distinctFamiliesObserved: distinctFamilies,
    homogeneousFamilyDetected,
    unresolvedCandidates: params.unresolvedCandidates,
    unverifiedQueueRemaining: params.unverifiedQueueRemaining ?? 0,
    remainingSourceQueries: Math.max(0, params.remainingSourceQueries),
    remainingAIRequests: Math.max(0, params.remainingAIRequests),
    missingArchetypes,
    recoveryRecommended,
    recoveryTriggerReason,
    stopReason,
  };
}
