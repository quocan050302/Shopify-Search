import crypto from "crypto";
import { Type, Schema } from "@google/genai";
import { z } from "zod";
import { discoverGeminiModels } from "../ai/geminiModelDiscoveryService";
import { executeGeminiTaskWithRetry } from "../ai/geminiModelRouter";
import { GeminiRunBudgetTracker } from "../ai/aiProductIntelligenceTypes";

export const DISCOVERY_PLANNER_PROMPT_VERSION = "kh02_discovery_planner_v1.0.0";
export const DISCOVERY_PLANNER_SCHEMA_VERSION = "1.0.0";

export type NicheIntentType =
  | "BROAD_CATEGORY"
  | "SPECIFIC_PRODUCT"
  | "FUNCTIONAL_NEED"
  | "AMBIGUOUS";

export type DiscoveryQuerySearchType =
  | "KEYWORD_EXACT_PHRASE"
  | "KEYWORD_UNORDERED";

export type DiscoveryQueryOrigin =
  | "USER"
  | "GEMINI_PLANNER"
  | "DETERMINISTIC_FALLBACK"
  | "ADAPTIVE_RECOVERY";

export interface DiscoveryPlannerInput {
  researchRunId: string;
  topic: string;
  market: string;
  lookbackDays: number;

  productPolicy: "PHYSICAL_ECOMMERCE_PRODUCTS";

  supportedSources: string[];

  remainingProviderRequests: number;
  remainingAIRequests: number;

  previousQueries?: string[];

  observedProductCategories?: string[];

  excludedQueryCategories?: string[];
}

export interface PlannedSearchQuery {
  phrase: string;
  searchType: DiscoveryQuerySearchType;
  priority: number;
  rationale: string;
}

export interface PlannedProductArchetype {
  archetypeId: string;
  productCategory: string;
  customerProblem: string;
  relevanceReason: string;
  searchQueries: PlannedSearchQuery[];
}

export interface AIDiscoveryPlan {
  normalizedNiche: string;
  nicheIntent: NicheIntentType;
  productArchetypes: PlannedProductArchetype[];
  negativeIntentPatterns: string[];
  uncertainties: string[];
}

export interface DiscoveryQuery {
  queryId: string;
  researchRunId: string;

  phrase: string;
  normalizedPhrase: string;

  archetypeId: string | null;

  source: string;

  searchType: DiscoveryQuerySearchType;

  roundNumber: number;

  priority: number;

  rationale: string;

  origin: DiscoveryQueryOrigin;

  expectedProductCategory: string | null;
}

export interface NicheIntentAnalysisResult {
  rawTopic: string;
  normalizedNiche: string;
  nicheIntent: NicheIntentType;
  allowedEcommerceCategories: string[];
  isProhibitedOrUnsupported: boolean;
  prohibitedReason: string | null;
  detectedDomainKey: string | null;
}

export interface DiscoveryPlanValidationResult {
  valid: boolean;
  validatedPlan: AIDiscoveryPlan;
  validatedQueries: DiscoveryQuery[];
  rejectedQueries: Array<{ phrase: string; reason: string }>;
  warnings: string[];
}

export interface DiscoveryPlannerTelemetry {
  taskType: "DISCOVERY_PLANNING";
  status:
    | "COMPLETED_GEMINI"
    | "COMPLETED_CACHE"
    | "FALLBACK_DETERMINISTIC"
    | "REJECTED_PROHIBITED"
    | "FAILED";
  origin: "GEMINI_PLANNER" | "DETERMINISTIC_FALLBACK";
  modelUsed: string | null;
  modelFallbackUsed: boolean;
  attemptsMade: number;
  retriesUsed: number;
  cacheHit: boolean;
  latencyMs: number;
  plannedArchetypesCount: number;
  validatedQueriesCount: number;
  rejectedQueriesCount: number;
  promptVersion: string;
  schemaVersion: string;
  failureReason: string | null;
}

export const PlannedSearchQueryZodSchema = z.object({
  phrase: z.string().min(2).max(80),
  searchType: z.enum(["KEYWORD_EXACT_PHRASE", "KEYWORD_UNORDERED"]),
  priority: z.number().int().min(1).max(20),
  rationale: z.string().min(3).max(240),
});

export const PlannedProductArchetypeZodSchema = z.object({
  archetypeId: z.string().min(2).max(64),
  productCategory: z.string().min(2).max(80),
  customerProblem: z.string().min(3).max(240),
  relevanceReason: z.string().min(3).max(240),
  searchQueries: z.array(PlannedSearchQueryZodSchema).min(1).max(4),
});

export const AIDiscoveryPlanZodSchema = z.object({
  normalizedNiche: z.string().min(1).max(80),
  nicheIntent: z.enum([
    "BROAD_CATEGORY",
    "SPECIFIC_PRODUCT",
    "FUNCTIONAL_NEED",
    "AMBIGUOUS",
  ]),
  productArchetypes: z.array(PlannedProductArchetypeZodSchema).min(1).max(8),
  negativeIntentPatterns: z.array(z.string().min(2).max(80)).max(25),
  uncertainties: z.array(z.string().max(200)).max(10),
});

export const GEMINI_DISCOVERY_PLAN_SCHEMA: Schema = {
  type: Type.OBJECT,
  properties: {
    normalizedNiche: {
      type: Type.STRING,
      description: "Normalized lowercase niche or product topic.",
    },
    nicheIntent: {
      type: Type.STRING,
      enum: [
        "BROAD_CATEGORY",
        "SPECIFIC_PRODUCT",
        "FUNCTIONAL_NEED",
        "AMBIGUOUS",
      ],
      description:
        "Whether the user topic is a broad category (e.g. diy, pet, gardening), a specific product (e.g. pet hair remover, cordless glue gun), a functional problem, or ambiguous.",
    },
    productArchetypes: {
      type: Type.ARRAY,
      description:
        "3 to 6 concrete physical consumer ecommerce product archetypes relevant to the topic.",
      items: {
        type: Type.OBJECT,
        properties: {
          archetypeId: {
            type: Type.STRING,
            description: "Snake_case identifier for the product archetype.",
          },
          productCategory: {
            type: Type.STRING,
            description: "Human-readable physical product category.",
          },
          customerProblem: {
            type: Type.STRING,
            description: "Specific consumer problem solved by this product.",
          },
          relevanceReason: {
            type: Type.STRING,
            description:
              "Why this physical product archetype belongs to the user's requested topic.",
          },
          searchQueries: {
            type: Type.ARRAY,
            description:
              "1 to 2 concrete product-specific ad search phrases (2-5 words each) used in DTC ecommerce ads.",
            items: {
              type: Type.OBJECT,
              properties: {
                phrase: {
                  type: Type.STRING,
                  description:
                    "Concrete physical product search phrase (e.g. 'wall repair kit', 'cordless hot glue gun', 'cat water fountain'). Never output generic marketing words or B2B/service queries.",
                },
                searchType: {
                  type: Type.STRING,
                  enum: ["KEYWORD_EXACT_PHRASE", "KEYWORD_UNORDERED"],
                },
                priority: {
                  type: Type.INTEGER,
                  description: "Priority rank (1 is highest priority).",
                },
                rationale: {
                  type: Type.STRING,
                  description:
                    "Why this phrase retrieves real DTC physical product ads.",
                },
              },
              required: ["phrase", "searchType", "priority", "rationale"],
            },
          },
        },
        required: [
          "archetypeId",
          "productCategory",
          "customerProblem",
          "relevanceReason",
          "searchQueries",
        ],
      },
    },
    negativeIntentPatterns: {
      type: Type.ARRAY,
      items: { type: Type.STRING },
      description:
        "Phrases or categories that must be excluded (e.g. B2B wholesale equipment, mobile apps, services, insurance, articles).",
    },
    uncertainties: {
      type: Type.ARRAY,
      items: { type: Type.STRING },
      description: "Any ambiguities or scope caveats in the user topic.",
    },
  },
  required: [
    "normalizedNiche",
    "nicheIntent",
    "productArchetypes",
    "negativeIntentPatterns",
    "uncertainties",
  ],
};

export const GEMINI_DISCOVERY_PLANNER_SYSTEM_PROMPT = `You are the Principal Ecommerce Product Discovery Planner for SWAI KH-02.
Your task is to translate a user's research topic into a structured discovery plan of concrete, sellable PHYSICAL consumer ecommerce product archetypes and high-signal ad library search queries.

CRITICAL RULES:
1. ONLY propose physical consumer ecommerce products (DTC/Shopify-style merchandise).
2. NEVER propose services, insurance, veterinary clinics, digital mobile apps, phone widget themes, games, casinos, B2B industrial equipment (such as POS thermal receipt printers), wholesale trade directories, or informational blog/article topics.
3. NEVER fabricate advertising metrics, active ad counts, ROAS, sales numbers, or merchant URLs. You are proposing search directions only.
4. If the topic is a BROAD category (e.g. "diy", "pet", "gardening", "kitchen", "cleaning", "home decor", "beauty"), decompose it into 4 to 6 distinct physical product archetypes covering different subcategories and concrete product-name search queries (2 to 4 words each, such as "wall repair kit", "cordless hot glue gun", "decorative switch plate covers", "pocket hole jig", "furniture repair kit").
5. If the topic is already a SPECIFIC physical product (e.g. "pet hair remover", "cordless glue gun", "cat water fountain", "automatic pet feeder", "decorative switch plate cover"), set nicheIntent to "SPECIFIC_PRODUCT" and keep search queries tightly focused on that exact product and its direct product-type synonyms without drifting into unrelated categories.
6. Avoid generic promotional phrases ("free shipping", "50% off", "best deal", "get latest price", "shop now") or repeating a single 1-word broad keyword across multiple queries.`;

const PROHIBITED_TOPIC_PATTERNS: Array<{ pattern: RegExp; reason: string }> = [
  {
    pattern:
      /\b(casino|gambling|betting|slots|sportsbook|poker|lottery)\b/i,
    reason: "Gambling and betting topics are not supported physical ecommerce niches.",
  },
  {
    pattern:
      /\b(weapon|firearm|ammunition|explosive|illicit drug|narcotic|counterfeit)\b/i,
    reason: "Prohibited or unsafe product category.",
  },
  {
    pattern:
      /\b(crypto loan|payday loan|forex signal|binary option|adult dating)\b/i,
    reason: "Financial/service lead-gen topics are not physical ecommerce products.",
  },
];

const NON_PRODUCT_QUERY_PATTERNS: RegExp[] = [
  /\b(insurance|clinic|hospital|doctor|lawyer|attorney|loan|mortgage|credit card)\b/i,
  /\b(vet bill|cost factors|how much does|article|blog|wikipedia|news)\b/i,
  /\b(casino|slots|jackpot|betting|sportsbook)\b/i,
  /\b(pos thermal printer|receipt printer|barcode scanner wholesale|b2b app|alibaba|get latest price|fob price|moq)\b/i,
  /\b(widgets? themes?|ios app|android app|wallpaper app|icontrol|download app|app store|google play)\b/i,
  /\b(free shipping|best deal|shop now|limited time|flash sale|clearance sale|discount code|coupon)\b/i,
  /\b(hiring|job opening|career|franchise opportunity|real estate agent)\b/i,
];

interface DeterministicArchetypeTemplate {
  archetypeId: string;
  productCategory: string;
  customerProblem: string;
  relevanceReason: string;
  queries: Array<{
    phrase: string;
    searchType: DiscoveryQuerySearchType;
    rationale: string;
  }>;
}

const DOMAIN_ARCHETYPE_CATALOG: Record<
  string,
  {
    matchRegex: RegExp;
    allowedCategories: string[];
    negativePatterns: string[];
    archetypes: DeterministicArchetypeTemplate[];
  }
> = {
  diy: {
    matchRegex:
      /\b(diy|do it yourself|home improvement|handyman|home repair|craft|crafting|woodworking)\b/i,
    allowedCategories: [
      "Home Repair Kits",
      "DIY Crafting Tools",
      "Decorative Home Hardware & Wall Decor",
      "Woodworking Jigs & Clamps",
      "Furniture & Surface Restoration",
    ],
    negativePatterns: [
      "pos thermal printer",
      "get latest price",
      "alibaba wholesale",
      "widgets themes app",
      "contractor hiring service",
      "home insurance",
    ],
    archetypes: [
      {
        archetypeId: "home_repair_kits",
        productCategory: "Home Repair",
        customerProblem:
          "Homeowners need fast, mess-free patching for drywall holes, cracked tiles, and wall scuffs.",
        relevanceReason:
          "Consumer DIY repair kits are core physical products for at-home improvement.",
        queries: [
          {
            phrase: "wall repair kit",
            searchType: "KEYWORD_EXACT_PHRASE",
            rationale: "High-intent physical DIY drywall/surface repair product.",
          },
          {
            phrase: "tile repair kit",
            searchType: "KEYWORD_EXACT_PHRASE",
            rationale: "Concrete DIY ceramic/floor surface repair product.",
          },
        ],
      },
      {
        archetypeId: "diy_crafting_tools",
        productCategory: "DIY Crafting",
        customerProblem:
          "Crafters and makers need portable precision bonding and cutting tools for home projects.",
        relevanceReason:
          "Cordless glue guns and precision cutters are top-selling DTC DIY crafting tools.",
        queries: [
          {
            phrase: "cordless hot glue gun",
            searchType: "KEYWORD_EXACT_PHRASE",
            rationale: "Concrete physical DIY crafting and repair tool.",
          },
          {
            phrase: "precision craft cutter",
            searchType: "KEYWORD_EXACT_PHRASE",
            rationale: "Specific handheld DIY crafting tool.",
          },
        ],
      },
      {
        archetypeId: "diy_home_decor_upgrades",
        productCategory: "Home Decor",
        customerProblem:
          "Renters and homeowners want easy self-installed decorative upgrades without hiring contractors.",
        relevanceReason:
          "Peel-and-stick panels and decorative switch plate covers are classic DIY home decor upgrades.",
        queries: [
          {
            phrase: "decorative switch plate covers",
            searchType: "KEYWORD_EXACT_PHRASE",
            rationale:
              "Physical DIY home decor hardware upgrade frequently advertised on Meta.",
          },
          {
            phrase: "peel and stick wall panels",
            searchType: "KEYWORD_EXACT_PHRASE",
            rationale: "Self-installed DIY wall renovation product.",
          },
        ],
      },
      {
        archetypeId: "woodworking_jigs",
        productCategory: "Woodworking",
        customerProblem:
          "DIY woodworkers need accurate drilling and corner clamping guides.",
        relevanceReason:
          "Pocket hole jigs and corner clamps are high-repeat physical DIY woodworking tools.",
        queries: [
          {
            phrase: "pocket hole jig",
            searchType: "KEYWORD_EXACT_PHRASE",
            rationale: "Specific woodworking tool SKU for DIY builders.",
          },
          {
            phrase: "woodworking corner clamp",
            searchType: "KEYWORD_EXACT_PHRASE",
            rationale: "Physical clamping tool for DIY woodworking.",
          },
        ],
      },
      {
        archetypeId: "furniture_restoration",
        productCategory: "Furniture Repair",
        customerProblem:
          "Fixing scratches, dents, and worn wood or leather surfaces at home.",
        relevanceReason:
          "Wood scratch repair markers and furniture restoration kits are direct consumer DIY products.",
        queries: [
          {
            phrase: "wood scratch repair markers",
            searchType: "KEYWORD_EXACT_PHRASE",
            rationale: "Specific physical furniture touch-up product.",
          },
          {
            phrase: "furniture repair kit",
            searchType: "KEYWORD_EXACT_PHRASE",
            rationale: "Consumer DIY furniture restoration kit.",
          },
        ],
      },
    ],
  },
  pet: {
    matchRegex:
      /\b(pet|pets|dog|dogs|cat|cats|puppy|kitten|canine|feline)\b/i,
    allowedCategories: [
      "Pet Grooming & Hair Removal",
      "Pet Hydration & Fountains",
      "Pet Feeding & Dispensers",
      "Pet Hygiene & Litter",
      "Interactive Pet Toys",
      "Pet Travel & Safety",
    ],
    negativePatterns: [
      "vet bill cost factors",
      "pet insurance",
      "emergency veterinary clinic",
      "animal shelter donation",
      "dog training consultation",
    ],
    archetypes: [
      {
        archetypeId: "pet_grooming_hair_removal",
        productCategory: "Pet Grooming",
        customerProblem:
          "Pet owners struggle with shedding fur on furniture, clothes, and carpets.",
        relevanceReason:
          "Reusable pet hair removers and grooming brushes are top physical pet products.",
        queries: [
          {
            phrase: "pet hair remover",
            searchType: "KEYWORD_EXACT_PHRASE",
            rationale: "High-demand reusable physical pet hair cleaning tool.",
          },
          {
            phrase: "dog grooming brush",
            searchType: "KEYWORD_EXACT_PHRASE",
            rationale: "Concrete physical pet deshedding tool.",
          },
        ],
      },
      {
        archetypeId: "pet_hydration",
        productCategory: "Pet Hydration",
        customerProblem:
          "Keeping pet drinking water fresh, filtered, and circulating all day.",
        relevanceReason:
          "Cat and dog water fountains are established physical DTC pet appliances.",
        queries: [
          {
            phrase: "cat water fountain",
            searchType: "KEYWORD_EXACT_PHRASE",
            rationale: "Concrete physical pet hydration product.",
          },
        ],
      },
      {
        archetypeId: "pet_feeding",
        productCategory: "Pet Feeding",
        customerProblem:
          "Portion-controlled and scheduled feeding for dogs and cats.",
        relevanceReason:
          "Automatic pet feeders and slow feeder bowls are core physical pet products.",
        queries: [
          {
            phrase: "automatic pet feeder",
            searchType: "KEYWORD_EXACT_PHRASE",
            rationale: "Specific physical pet feeding appliance.",
          },
        ],
      },
      {
        archetypeId: "pet_cleaning_litter",
        productCategory: "Pet Cleaning",
        customerProblem: "Containing litter scatter and pet messes indoors.",
        relevanceReason:
          "Waterproof cat litter mats and paw cleaners are practical physical pet accessories.",
        queries: [
          {
            phrase: "cat litter mat",
            searchType: "KEYWORD_EXACT_PHRASE",
            rationale: "Physical pet floor protection product.",
          },
        ],
      },
      {
        archetypeId: "pet_safety_travel",
        productCategory: "Pet Safety",
        customerProblem: "Keeping pets secure during walks and car rides.",
        relevanceReason:
          "No-pull dog harnesses and car seat covers are durable physical pet gear.",
        queries: [
          {
            phrase: "no pull dog harness",
            searchType: "KEYWORD_EXACT_PHRASE",
            rationale: "Specific physical dog walking safety product.",
          },
        ],
      },
    ],
  },
  gardening: {
    matchRegex:
      /\b(garden|gardening|plant|plants|lawn|horticulture|pruning|watering|seed)\b/i,
    allowedCategories: [
      "Pruning & Cutting Tools",
      "Plant Watering & Irrigation",
      "Seed Starting & Propagation",
      "Plant Supports & Trellises",
      "Soil Testing & Monitoring",
    ],
    negativePatterns: [
      "landscaping service",
      "lawn mowing service",
      "tree removal estimate",
      "plant identification app",
    ],
    archetypes: [
      {
        archetypeId: "plant_watering_systems",
        productCategory: "Plant Watering",
        customerProblem:
          "Keeping indoor and outdoor plants Consistently hydrated without overwatering.",
        relevanceReason:
          "Self-watering plant spikes and drip irrigation kits are physical gardening products.",
        queries: [
          {
            phrase: "self watering plant spikes",
            searchType: "KEYWORD_EXACT_PHRASE",
            rationale: "Specific physical plant hydration product.",
          },
          {
            phrase: "drip irrigation kit",
            searchType: "KEYWORD_EXACT_PHRASE",
            rationale: "Concrete garden watering hardware kit.",
          },
        ],
      },
      {
        archetypeId: "pruning_tools",
        productCategory: "Pruning Tools",
        customerProblem:
          "Effortless trimming of branches, stems, and shrubs without hand fatigue.",
        relevanceReason:
          "Pruning shears and garden trimmers are essential physical gardening tools.",
        queries: [
          {
            phrase: "garden pruning shears",
            searchType: "KEYWORD_EXACT_PHRASE",
            rationale: "Concrete physical gardening hand tool.",
          },
        ],
      },
      {
        archetypeId: "seed_starting_kits",
        productCategory: "Seed Starting",
        customerProblem:
          "Germinating seedlings indoors with humidity control and root aeration.",
        relevanceReason:
          "Seed starter trays and grow domes are physical consumer gardening supplies.",
        queries: [
          {
            phrase: "seed starter tray",
            searchType: "KEYWORD_EXACT_PHRASE",
            rationale: "Physical propagation tray for home gardeners.",
          },
        ],
      },
      {
        archetypeId: "plant_supports",
        productCategory: "Plant Supports",
        customerProblem:
          "Supporting climbing vines, tomatoes, and indoor houseplants.",
        relevanceReason:
          "Plant trellises and support clips are physical garden accessories.",
        queries: [
          {
            phrase: "plant support clips",
            searchType: "KEYWORD_EXACT_PHRASE",
            rationale: "Specific physical plant training accessory.",
          },
        ],
      },
      {
        archetypeId: "soil_monitoring",
        productCategory: "Soil Monitoring",
        customerProblem: "Measuring soil moisture and pH accurately for plant health.",
        relevanceReason:
          "Soil moisture meters are physical diagnostic tools for gardeners.",
        queries: [
          {
            phrase: "soil moisture meter",
            searchType: "KEYWORD_EXACT_PHRASE",
            rationale: "Concrete physical soil measurement device.",
          },
        ],
      },
    ],
  },
  kitchen: {
    matchRegex:
      /\b(kitchen|cooking|cookware|culinary|food prep|baking|meal prep)\b/i,
    allowedCategories: [
      "Food Prep Choppers & Slicers",
      "Kitchen Sink & Counter Organization",
      "Cooking Oil & Seasoning Dispensers",
      "Food Storage & Vacuum Sealing",
    ],
    negativePatterns: [
      "restaurant catering service",
      "meal delivery subscription",
      "recipe app",
      "commercial restaurant pos",
    ],
    archetypes: [
      {
        archetypeId: "food_prep_choppers",
        productCategory: "Food Prep Tools",
        customerProblem:
          "Slicing and dicing vegetables quickly and uniformly without knife hazards.",
        relevanceReason:
          "Vegetable choppers and mandoline slicers are high-velocity physical kitchen tools.",
        queries: [
          {
            phrase: "vegetable chopper",
            searchType: "KEYWORD_EXACT_PHRASE",
            rationale: "Core physical kitchen prep gadget.",
          },
          {
            phrase: "garlic chopper",
            searchType: "KEYWORD_EXACT_PHRASE",
            rationale: "Specific physical kitchen prep tool.",
          },
        ],
      },
      {
        archetypeId: "cooking_dispensers",
        productCategory: "Cooking Dispensers",
        customerProblem: "Controlling cooking oil spray for air fryers and pans.",
        relevanceReason:
          "Glass oil sprayers are proven physical DTC kitchen accessories.",
        queries: [
          {
            phrase: "oil sprayer",
            searchType: "KEYWORD_EXACT_PHRASE",
            rationale: "Specific physical kitchen dispenser SKU.",
          },
        ],
      },
      {
        archetypeId: "kitchen_sink_organizers",
        productCategory: "Kitchen Organization",
        customerProblem:
          "Preventing sink drain clogs and keeping sponges dry and organized.",
        relevanceReason:
          "Sink strainer baskets and caddy racks are physical kitchen organization products.",
        queries: [
          {
            phrase: "kitchen sink strainer",
            searchType: "KEYWORD_EXACT_PHRASE",
            rationale: "Concrete physical kitchen sink product.",
          },
        ],
      },
      {
        archetypeId: "food_preservation",
        productCategory: "Food Storage",
        customerProblem: "Keeping food fresh longer in refrigerators and pantries.",
        relevanceReason:
          "Portable vacuum sealers and airtight containers are physical kitchen products.",
        queries: [
          {
            phrase: "portable vacuum sealer",
            searchType: "KEYWORD_EXACT_PHRASE",
            rationale: "Physical kitchen preservation gadget.",
          },
        ],
      },
    ],
  },
  cleaning: {
    matchRegex:
      /\b(clean|cleaning|cleaner|laundry|mop|scrub|scrubber|dusting|household cleaning)\b/i,
    allowedCategories: [
      "Power Scrubbers & Brushes",
      "Floor Mops & Window Cleaners",
      "Washing Machine & Appliance Cleaners",
      "Lint & Fabric Care",
    ],
    negativePatterns: [
      "maid service",
      "house cleaning quote",
      "janitorial staffing",
      "phone storage cleaner app",
    ],
    archetypes: [
      {
        archetypeId: "power_scrubbers",
        productCategory: "Power Scrubbers",
        customerProblem:
          "Scrubbing bathroom tile grout, tubs, and sinks without back strain.",
        relevanceReason:
          "Electric spin scrubbers are flagship physical household cleaning tools.",
        queries: [
          {
            phrase: "electric spin scrubber",
            searchType: "KEYWORD_EXACT_PHRASE",
            rationale: "Concrete physical motorized cleaning brush.",
          },
        ],
      },
      {
        archetypeId: "appliance_cleaning_tablets",
        productCategory: "Appliance Care",
        customerProblem:
          "Removing odor and residue buildup inside washing machines and dishwashers.",
        relevanceReason:
          "Washing machine cleaner tablets are consumable physical household cleaning products.",
        queries: [
          {
            phrase: "washing machine cleaner",
            searchType: "KEYWORD_EXACT_PHRASE",
            rationale: "High-repeat physical household cleaning consumable.",
          },
        ],
      },
      {
        archetypeId: "crevice_and_steam_cleaners",
        productCategory: "Detail & Steam Cleaning",
        customerProblem:
          "Sanitizing tight grout lines, window tracks, and upholstery.",
        relevanceReason:
          "Handheld steam cleaners and crevice brushes are physical cleaning tools.",
        queries: [
          {
            phrase: "steam cleaner",
            searchType: "KEYWORD_EXACT_PHRASE",
            rationale: "Physical home sanitization appliance.",
          },
        ],
      },
      {
        archetypeId: "microfiber_floor_mops",
        productCategory: "Floor Care",
        customerProblem: "Hands-free wringing and flat mopping for hardwood and tile floors.",
        relevanceReason:
          "Self-wringing microfiber mops are physical household cleaning products.",
        queries: [
          {
            phrase: "microfiber spray mop",
            searchType: "KEYWORD_EXACT_PHRASE",
            rationale: "Specific physical floor cleaning tool.",
          },
        ],
      },
    ],
  },
  home_decor: {
    matchRegex:
      /\b(home decor|decor|interior decor|wall decor|room decor|home accent|lighting decor)\b/i,
    allowedCategories: [
      "Decorative Hardware & Switch Plates",
      "Ambient & Accent Lighting",
      "Peel & Stick Wall Accents",
      "Decorative Covers & Textiles",
    ],
    negativePatterns: [
      "interior design consultation",
      "real estate staging service",
      "room planner app",
    ],
    archetypes: [
      {
        archetypeId: "decorative_switch_covers",
        productCategory: "Decorative Hardware",
        customerProblem:
          "Upgrading plain plastic light switches and outlet plates to match room aesthetics.",
        relevanceReason:
          "Decorative switch plate covers are physical home decor accessories.",
        queries: [
          {
            phrase: "decorative switch plate covers",
            searchType: "KEYWORD_EXACT_PHRASE",
            rationale: "Concrete physical decorative wall hardware product.",
          },
        ],
      },
      {
        archetypeId: "ambient_accent_lighting",
        productCategory: "Accent Lighting",
        customerProblem:
          "Adding cordless warm accent lighting to walls, shelves, and bedrooms.",
        relevanceReason:
          "Rechargeable wall sconces and crystal lamps are physical home decor products.",
        queries: [
          {
            phrase: "rechargeable wall sconce",
            searchType: "KEYWORD_EXACT_PHRASE",
            rationale: "Specific physical cordless lighting decor product.",
          },
        ],
      },
      {
        archetypeId: "peel_stick_wall_accents",
        productCategory: "Wall Accents",
        customerProblem: "Refreshing walls and backsplashes with removable textured panels.",
        relevanceReason:
          "Peel-and-stick wall tiles and panels are physical home decor products.",
        queries: [
          {
            phrase: "peel and stick wall tiles",
            searchType: "KEYWORD_EXACT_PHRASE",
            rationale: "Concrete physical wall decor product.",
          },
        ],
      },
      {
        archetypeId: "furniture_slipcovers",
        productCategory: "Decorative Textiles",
        customerProblem: "Protecting and restyling sofas and chairs.",
        relevanceReason:
          "Stretch sofa slipcovers are high-volume physical home decor textiles.",
        queries: [
          {
            phrase: "stretch sofa cover",
            searchType: "KEYWORD_EXACT_PHRASE",
            rationale: "Specific physical living room decor product.",
          },
        ],
      },
    ],
  },
  beauty: {
    matchRegex:
      /\b(beauty|skincare|skin care|haircare|hair care|cosmetic|makeup|grooming)\b/i,
    allowedCategories: [
      "Facial Skincare Patches & Serums",
      "LED & Facial Massage Tools",
      "Hair Styling & Heatless Curlers",
      "Nail & Beauty Organizers",
    ],
    negativePatterns: [
      "salon booking",
      "botox clinic",
      "cosmetic surgery",
      "beauty filter app",
    ],
    archetypes: [
      {
        archetypeId: "skincare_patches_masks",
        productCategory: "Skincare Treatments",
        customerProblem:
          "Targeted overnight hydration and blemish care at home.",
        relevanceReason:
          "Collagen masks and hydrocolloid patches are physical DTC skincare products.",
        queries: [
          {
            phrase: "collagen face mask",
            searchType: "KEYWORD_EXACT_PHRASE",
            rationale: "Concrete physical skincare product.",
          },
          {
            phrase: "pimple patch",
            searchType: "KEYWORD_EXACT_PHRASE",
            rationale: "High-repeat physical skincare consumable.",
          },
        ],
      },
      {
        archetypeId: "hair_styling_tools",
        productCategory: "Hair Styling Tools",
        customerProblem: "Styling curls and smoothing hair without heat damage.",
        relevanceReason:
          "Heatless hair curlers and thermal brushes are physical beauty tools.",
        queries: [
          {
            phrase: "heatless hair curler",
            searchType: "KEYWORD_EXACT_PHRASE",
            rationale: "Specific physical hair styling product.",
          },
        ],
      },
      {
        archetypeId: "facial_sculpting_devices",
        productCategory: "Beauty Devices",
        customerProblem: "At-home facial lymphatic massage and skin firming.",
        relevanceReason:
          "Gua sha tools and LED face wands are physical beauty devices.",
        queries: [
          {
            phrase: "red light therapy wand",
            searchType: "KEYWORD_EXACT_PHRASE",
            rationale: "Concrete physical beauty device SKU.",
          },
        ],
      },
      {
        archetypeId: "cosmetic_travel_organizer",
        productCategory: "Nail & Beauty Organizers",
        customerProblem: "Keeping makeup brushes and cosmetics organized on vanities and during travel.",
        relevanceReason:
          "Rotating makeup organizers and LED travel vanity cases are physical beauty products.",
        queries: [
          {
            phrase: "rotating makeup organizer",
            searchType: "KEYWORD_EXACT_PHRASE",
            rationale: "Concrete physical vanity storage product.",
          },
        ],
      },
    ],
  },
};

const SPECIFIC_PRODUCT_NOUN_PATTERNS =
  /\b(remover|fountain|feeder|gun|cutter|cover|covers|plate|plates|jig|clamp|marker|markers|kit|spikes|shears|tray|meter|chopper|sprayer|strainer|sealer|scrubber|cleaner|mop|sconce|tiles|mask|patch|curler|wand|brush|harness|mat|holder|organizer|dispenser|rack|lamp|light|sticker|stickers|panel|panels|tool|gadget)\b/i;

const BROAD_TOPIC_EXACT_SET = new Set([
  "diy",
  "do it yourself",
  "pet",
  "pets",
  "dog",
  "dogs",
  "cat",
  "cats",
  "kitchen",
  "cooking",
  "cleaning",
  "clean",
  "home decor",
  "decor",
  "gardening",
  "garden",
  "plants",
  "beauty",
  "skincare",
  "home",
  "home improvement",
  "crafts",
  "crafting",
  "tools",
  "gadgets",
  "pet gadgets",
  "kitchen gadgets",
  "cleaning gadgets",
]);

interface CachedDiscoveryPlanEntry {
  cacheKey: string;
  plan: AIDiscoveryPlan;
  modelUsed: string;
  createdAt: number;
}

const discoveryPlanCache = new Map<string, CachedDiscoveryPlanEntry>();

export function clearDiscoveryPlanCache(): void {
  discoveryPlanCache.clear();
}

function buildDiscoveryPlanCacheKey(
  input: DiscoveryPlannerInput,
  modelId: string
): string {
  const normalizedTopic = input.topic.trim().toLowerCase().replace(/\s+/g, " ");
  const normalizedMarket = (input.market || "US").trim().toUpperCase();
  const sourcesKey = [...(input.supportedSources || [])].sort().join(",");
  const previousKey = [...(input.previousQueries || [])]
    .map((q) => q.trim().toLowerCase())
    .sort()
    .join(",");
  const excludedKey = [...(input.excludedQueryCategories || [])]
    .map((c) => c.trim().toLowerCase())
    .sort()
    .join(",");

  const rawKey = [
    normalizedTopic,
    normalizedMarket,
    input.productPolicy,
    DISCOVERY_PLANNER_PROMPT_VERSION,
    DISCOVERY_PLANNER_SCHEMA_VERSION,
    modelId,
    sourcesKey,
    previousKey,
    excludedKey,
  ].join("|");

  return crypto.createHash("sha256").update(rawKey).digest("hex");
}

/**
 * Analyzes user niche topic intent, detects broad vs specific vs functional intent,
 * checks prohibited/unsupported categories, and identifies allowed ecommerce categories.
 */
export function analyzeNicheIntent(topic: string): NicheIntentAnalysisResult {
  const rawTopic = typeof topic === "string" ? topic : "";
  const normalizedNiche = rawTopic
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");

  if (!normalizedNiche || normalizedNiche.length < 2) {
    return {
      rawTopic,
      normalizedNiche,
      nicheIntent: "AMBIGUOUS",
      allowedEcommerceCategories: [],
      isProhibitedOrUnsupported: true,
      prohibitedReason: "Topic is empty or shorter than 2 characters.",
      detectedDomainKey: null,
    };
  }

  for (const rule of PROHIBITED_TOPIC_PATTERNS) {
    if (rule.pattern.test(normalizedNiche)) {
      return {
        rawTopic,
        normalizedNiche,
        nicheIntent: "AMBIGUOUS",
        allowedEcommerceCategories: [],
        isProhibitedOrUnsupported: true,
        prohibitedReason: rule.reason,
        detectedDomainKey: null,
      };
    }
  }

  let detectedDomainKey: string | null = null;
  let allowedEcommerceCategories: string[] = [];

  for (const [domainKey, config] of Object.entries(DOMAIN_ARCHETYPE_CATALOG)) {
    if (config.matchRegex.test(normalizedNiche)) {
      detectedDomainKey = domainKey;
      allowedEcommerceCategories = [...config.allowedCategories];
      break;
    }
  }

  // Also map specific product topics back to their parent domain if not already matched
  if (!detectedDomainKey) {
    if (
      /\b(glue gun|switch plate|switch cover|wall repair|tile repair|pocket hole|scratch repair)\b/i.test(
        normalizedNiche
      )
    ) {
      detectedDomainKey = "diy";
      allowedEcommerceCategories = [
        ...DOMAIN_ARCHETYPE_CATALOG.diy.allowedCategories,
      ];
    } else if (
      /\b(hair remover|water fountain|litter mat|dog harness)\b/i.test(
        normalizedNiche
      )
    ) {
      detectedDomainKey = "pet";
      allowedEcommerceCategories = [
        ...DOMAIN_ARCHETYPE_CATALOG.pet.allowedCategories,
      ];
    } else if (
      /\b(plant spike|drip irrigation|pruning shear|seed starter|soil moisture)\b/i.test(
        normalizedNiche
      )
    ) {
      detectedDomainKey = "gardening";
      allowedEcommerceCategories = [
        ...DOMAIN_ARCHETYPE_CATALOG.gardening.allowedCategories,
      ];
    }
  }

  const tokens = normalizedNiche.split(/\s+/).filter(Boolean);
  let nicheIntent: NicheIntentType = "BROAD_CATEGORY";

  if (BROAD_TOPIC_EXACT_SET.has(normalizedNiche)) {
    nicheIntent = "BROAD_CATEGORY";
  } else if (
    /\b(how to|fix|prevent|stop|remove|solve|for sore|for dry|pain relief)\b/i.test(
      normalizedNiche
    ) &&
    !SPECIFIC_PRODUCT_NOUN_PATTERNS.test(normalizedNiche)
  ) {
    nicheIntent = "FUNCTIONAL_NEED";
  } else if (
    tokens.length >= 2 &&
    SPECIFIC_PRODUCT_NOUN_PATTERNS.test(normalizedNiche) &&
    !/\b(products|gadgets|items|supplies|accessories|ideas)\b$/i.test(
      normalizedNiche
    )
  ) {
    nicheIntent = "SPECIFIC_PRODUCT";
  } else if (tokens.length === 1 && !detectedDomainKey) {
    nicheIntent = "BROAD_CATEGORY";
  }

  if (allowedEcommerceCategories.length === 0) {
    allowedEcommerceCategories = [
      `${rawTopic.trim()} Physical Tools & Accessories`,
      `${rawTopic.trim()} Consumer Kits & Organizers`,
      `${rawTopic.trim()} Home & Everyday Hardware`,
    ];
  }

  return {
    rawTopic,
    normalizedNiche,
    nicheIntent,
    allowedEcommerceCategories,
    isProhibitedOrUnsupported: false,
    prohibitedReason: null,
    detectedDomainKey,
  };
}

/**
 * Builds a deterministic fallback discovery plan when Gemini is unavailable, disabled,
 * or returns invalid schema output. Supports both known domain catalogs and arbitrary
 * unknown niches without collapsing to a single generic keyword.
 */
export function buildDeterministicDiscoveryPlan(
  input: DiscoveryPlannerInput,
  intentOverride?: NicheIntentAnalysisResult
): AIDiscoveryPlan {
  const intent = intentOverride ?? analyzeNicheIntent(input.topic);
  const normalizedNiche = intent.normalizedNiche || input.topic.trim().toLowerCase();

  if (intent.isProhibitedOrUnsupported) {
    return {
      normalizedNiche,
      nicheIntent: "AMBIGUOUS",
      productArchetypes: [],
      negativeIntentPatterns: ["prohibited_or_unsupported_topic"],
      uncertainties: [
        intent.prohibitedReason || "Topic is unsupported or empty.",
      ],
    };
  }

  const previousSet = new Set(
    (input.previousQueries || []).map((q) => q.trim().toLowerCase())
  );

  // Case 1: Specific product intent (e.g. "pet hair remover", "cordless glue gun", "cat water fountain")
  if (intent.nicheIntent === "SPECIFIC_PRODUCT") {
    const cleanPhrase = normalizedNiche
      .replace(/[^\w\s-]/g, " ")
      .replace(/\s+/g, " ")
      .trim();

    const specificArchetypes: PlannedProductArchetype[] = [
      {
        archetypeId: `specific_${cleanPhrase.replace(/\s+/g, "_").slice(0, 40)}`,
        productCategory: `${input.topic.trim()} (Primary SKU)`,
        customerProblem: `Direct consumer demand for ${input.topic.trim()}.`,
        relevanceReason: `Matches the user's specific product query '${input.topic.trim()}'.`,
        searchQueries: [
          {
            phrase: cleanPhrase,
            searchType: "KEYWORD_EXACT_PHRASE",
            priority: 1,
            rationale: `Exact product phrase match for specific product intent '${cleanPhrase}'.`,
          },
        ],
      },
    ];

    // Add 1-2 closely related sibling product archetypes from the detected domain (if available)
    // while keeping the specific product as priority 1.
    if (intent.detectedDomainKey && DOMAIN_ARCHETYPE_CATALOG[intent.detectedDomainKey]) {
      const domainConfig = DOMAIN_ARCHETYPE_CATALOG[intent.detectedDomainKey];
      let priorityCounter = 2;
      for (const arch of domainConfig.archetypes) {
        const nonDupQueries = arch.queries.filter(
          (q) =>
            q.phrase.toLowerCase() !== cleanPhrase &&
            !previousSet.has(q.phrase.toLowerCase())
        );
        if (nonDupQueries.length > 0 && specificArchetypes.length < 4) {
          specificArchetypes.push({
            archetypeId: arch.archetypeId,
            productCategory: arch.productCategory,
            customerProblem: arch.customerProblem,
            relevanceReason: arch.relevanceReason,
            searchQueries: nonDupQueries.slice(0, 1).map((q) => ({
              phrase: q.phrase,
              searchType: q.searchType,
              priority: priorityCounter++,
              rationale: q.rationale,
            })),
          });
        }
      }
    } else {
      specificArchetypes.push({
        archetypeId: `specific_${cleanPhrase.replace(/\s+/g, "_").slice(0, 32)}_kit`,
        productCategory: `${input.topic.trim()} Kit & Replacement Set`,
        customerProblem: `Complete starter kit or reusable variant of ${input.topic.trim()}.`,
        relevanceReason: `Direct physical product variant of '${input.topic.trim()}'.`,
        searchQueries: [
          {
            phrase: `${cleanPhrase} kit`,
            searchType: "KEYWORD_UNORDERED",
            priority: 2,
            rationale: `Broader unordered kit variation for '${cleanPhrase}'.`,
          },
        ],
      });
    }

    return {
      normalizedNiche,
      nicheIntent: "SPECIFIC_PRODUCT",
      productArchetypes: specificArchetypes,
      negativeIntentPatterns:
        intent.detectedDomainKey && DOMAIN_ARCHETYPE_CATALOG[intent.detectedDomainKey]
          ? [...DOMAIN_ARCHETYPE_CATALOG[intent.detectedDomainKey].negativePatterns]
          : [
              "wholesale b2b",
              "get latest price",
              "mobile app",
              "insurance",
              "service quote",
            ],
      uncertainties: [],
    };
  }

  // Case 2: Broad category with known domain archetype catalog (diy, pet, gardening, kitchen, cleaning, home_decor, beauty)
  if (intent.detectedDomainKey && DOMAIN_ARCHETYPE_CATALOG[intent.detectedDomainKey]) {
    const domainConfig = DOMAIN_ARCHETYPE_CATALOG[intent.detectedDomainKey];
    let priorityCounter = 1;
    const archetypes: PlannedProductArchetype[] = domainConfig.archetypes.map(
      (arch) => ({
        archetypeId: arch.archetypeId,
        productCategory: arch.productCategory,
        customerProblem: arch.customerProblem,
        relevanceReason: arch.relevanceReason,
        searchQueries: arch.queries.map((q) => ({
          phrase: q.phrase,
          searchType: q.searchType,
          priority: priorityCounter++,
          rationale: q.rationale,
        })),
      })
    );

    return {
      normalizedNiche,
      nicheIntent: intent.nicheIntent,
      productArchetypes: archetypes,
      negativeIntentPatterns: [...domainConfig.negativePatterns],
      uncertainties: [],
    };
  }

  // Case 3: Unfamiliar / arbitrary broad niche (no hardcoded template required)
  const cleanRoot = normalizedNiche
    .replace(/\b(products|gadgets|items|supplies|accessories)\b/gi, "")
    .replace(/[^\w\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim() || normalizedNiche;

  const genericArchetypes: PlannedProductArchetype[] = [
    {
      archetypeId: `${cleanRoot.replace(/\s+/g, "_")}_tool`,
      productCategory: `${cleanRoot} Tools & Gadgets`,
      customerProblem: `Consumers looking for practical handheld tools or devices for ${cleanRoot}.`,
      relevanceReason: `Physical tool archetype for ${cleanRoot}.`,
      searchQueries: [
        {
          phrase: `${cleanRoot} tool`,
          searchType: "KEYWORD_EXACT_PHRASE",
          priority: 1,
          rationale: `Targets concrete physical tools in the ${cleanRoot} niche.`,
        },
      ],
    },
    {
      archetypeId: `${cleanRoot.replace(/\s+/g, "_")}_kit`,
      productCategory: `${cleanRoot} Starter & Repair Kits`,
      customerProblem: `Consumers seeking all-in-one physical kits for ${cleanRoot}.`,
      relevanceReason: `Bundled physical kit archetype for ${cleanRoot}.`,
      searchQueries: [
        {
          phrase: `${cleanRoot} kit`,
          searchType: "KEYWORD_EXACT_PHRASE",
          priority: 2,
          rationale: `Targets complete physical product kits in the ${cleanRoot} niche.`,
        },
      ],
    },
    {
      archetypeId: `${cleanRoot.replace(/\s+/g, "_")}_organizer`,
      productCategory: `${cleanRoot} Storage & Organizers`,
      customerProblem: `Keeping ${cleanRoot} gear and spaces neat and accessible.`,
      relevanceReason: `Physical storage and holder products for ${cleanRoot}.`,
      searchQueries: [
        {
          phrase: `${cleanRoot} organizer`,
          searchType: "KEYWORD_EXACT_PHRASE",
          priority: 3,
          rationale: `Targets physical organizers and holders for ${cleanRoot}.`,
        },
      ],
    },
    {
      archetypeId: `${cleanRoot.replace(/\s+/g, "_")}_accessories`,
      productCategory: `${cleanRoot} Essential Accessories`,
      customerProblem: `Everyday replacement parts, covers, and protective accessories for ${cleanRoot}.`,
      relevanceReason: `Physical consumer accessories for ${cleanRoot}.`,
      searchQueries: [
        {
          phrase: `${cleanRoot} holder`,
          searchType: "KEYWORD_UNORDERED",
          priority: 4,
          rationale: `Targets physical mounting/holder accessories for ${cleanRoot}.`,
        },
      ],
    },
  ];

  return {
    normalizedNiche,
    nicheIntent: intent.nicheIntent,
    productArchetypes: genericArchetypes,
    negativeIntentPatterns: [
      "pos thermal printer",
      "get latest price",
      "mobile app",
      "insurance",
      "consultation service",
    ],
    uncertainties: [
      `Topic '${input.topic}' used generalized physical product archetype synthesis.`,
    ],
  };
}

function normalizeQueryTokens(phrase: string): string[] {
  return phrase
    .toLowerCase()
    .replace(/[^\w\s]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 1 && !["for", "the", "and", "with"].includes(t))
    .map((t) => (t.endsWith("s") && t.length > 4 ? t.slice(0, -1) : t));
}

function areQueriesNearDuplicate(phraseA: string, phraseB: string): boolean {
  const normA = phraseA.trim().toLowerCase().replace(/\s+/g, " ");
  const normB = phraseB.trim().toLowerCase().replace(/\s+/g, " ");
  if (normA === normB) return true;

  const tokensA = new Set(normalizeQueryTokens(normA));
  const tokensB = new Set(normalizeQueryTokens(normB));
  if (tokensA.size === 0 || tokensB.size === 0) return false;

  let intersection = 0;
  for (const tok of tokensA) {
    if (tokensB.has(tok)) intersection++;
  }
  const union = new Set([...tokensA, ...tokensB]).size;
  const jaccard = union > 0 ? intersection / union : 0;
  return jaccard >= 0.75;
}

/**
 * Deterministically validates an AI or fallback discovery plan:
 * - Rejects prohibited, service, digital app, B2B industrial, or generic marketing queries
 * - Deduplicates identical and near-duplicate synonym queries
 * - Ensures round-robin archetype diversity so a single archetype does not consume the whole budget
 * - Enforces market and source constraints
 */
export function validateDiscoveryPlan(
  plan: AIDiscoveryPlan,
  input: DiscoveryPlannerInput,
  origin: DiscoveryQueryOrigin,
  roundNumber: number = 1
): DiscoveryPlanValidationResult {
  const rejectedQueries: Array<{ phrase: string; reason: string }> = [];
  const warnings: string[] = [];
  const intent = analyzeNicheIntent(input.topic);

  if (intent.isProhibitedOrUnsupported) {
    return {
      valid: false,
      validatedPlan: {
        normalizedNiche: intent.normalizedNiche,
        nicheIntent: "AMBIGUOUS",
        productArchetypes: [],
        negativeIntentPatterns: plan.negativeIntentPatterns || [],
        uncertainties: [
          intent.prohibitedReason || "Topic is prohibited or unsupported.",
        ],
      },
      validatedQueries: [],
      rejectedQueries: [
        {
          phrase: input.topic,
          reason: intent.prohibitedReason || "Prohibited or empty topic.",
        },
      ],
      warnings: [intent.prohibitedReason || "Prohibited or empty topic."],
    };
  }

  const previousNormalized = new Set(
    (input.previousQueries || []).map((q) =>
      q.trim().toLowerCase().replace(/\s+/g, " ")
    )
  );
  const excludedCategories = new Set(
    (input.excludedQueryCategories || []).map((c) => c.trim().toLowerCase())
  );

  const primarySource =
    (input.supportedSources || []).find((s) =>
      s.toUpperCase().includes("META")
    ) ||
    input.supportedSources?.[0] ||
    "META_ADS_LIBRARY";

  const validatedArchetypes: PlannedProductArchetype[] = [];
  const acceptedPhrases: string[] = [];

  for (const archetype of plan.productArchetypes || []) {
    if (
      excludedCategories.has(archetype.archetypeId.toLowerCase()) ||
      excludedCategories.has(archetype.productCategory.toLowerCase())
    ) {
      warnings.push(
        `Skipped excluded archetype '${archetype.productCategory}'.`
      );
      continue;
    }

    const validQueriesForArchetype: PlannedSearchQuery[] = [];

    for (const rawQuery of archetype.searchQueries || []) {
      const cleanedPhrase = (rawQuery.phrase || "")
        .replace(/["'`]/g, "")
        .replace(/\s+/g, " ")
        .trim();
      const normalizedPhrase = cleanedPhrase.toLowerCase();

      if (!cleanedPhrase || cleanedPhrase.length < 3) {
        rejectedQueries.push({
          phrase: rawQuery.phrase || "",
          reason: "Query phrase is empty or too short.",
        });
        continue;
      }

      if (cleanedPhrase.length > 70 || cleanedPhrase.split(/\s+/).length > 7) {
        rejectedQueries.push({
          phrase: cleanedPhrase,
          reason: "Query phrase is overly long for ad library search.",
        });
        continue;
      }

      // Reject bare 1-word broad category query when intent is BROAD_CATEGORY
      if (
        intent.nicheIntent === "BROAD_CATEGORY" &&
        normalizedPhrase === intent.normalizedNiche &&
        cleanedPhrase.split(/\s+/).length === 1
      ) {
        rejectedQueries.push({
          phrase: cleanedPhrase,
          reason:
            "Single-word broad category query rejected in favor of concrete product archetype queries.",
        });
        continue;
      }

      // Check prohibited / non-product patterns
      let matchedNegativePattern = false;
      for (const negRegex of NON_PRODUCT_QUERY_PATTERNS) {
        if (negRegex.test(cleanedPhrase)) {
          rejectedQueries.push({
            phrase: cleanedPhrase,
            reason: `Matches non-product, service, digital app, B2B, or generic marketing pattern (${negRegex.source}).`,
          });
          matchedNegativePattern = true;
          break;
        }
      }
      if (matchedNegativePattern) continue;

      for (const rule of PROHIBITED_TOPIC_PATTERNS) {
        if (rule.pattern.test(cleanedPhrase)) {
          rejectedQueries.push({
            phrase: cleanedPhrase,
            reason: rule.reason,
          });
          matchedNegativePattern = true;
          break;
        }
      }
      if (matchedNegativePattern) continue;

      if (previousNormalized.has(normalizedPhrase)) {
        rejectedQueries.push({
          phrase: cleanedPhrase,
          reason: "Query was already executed in a previous search round.",
        });
        continue;
      }

      if (
        acceptedPhrases.some((existing) =>
          areQueriesNearDuplicate(existing, cleanedPhrase)
        )
      ) {
        rejectedQueries.push({
          phrase: cleanedPhrase,
          reason: "Near-duplicate synonym of an already validated query.",
        });
        continue;
      }

      acceptedPhrases.push(cleanedPhrase);
      validQueriesForArchetype.push({
        phrase: cleanedPhrase,
        searchType:
          rawQuery.searchType === "KEYWORD_UNORDERED"
            ? "KEYWORD_UNORDERED"
            : "KEYWORD_EXACT_PHRASE",
        priority: rawQuery.priority || validQueriesForArchetype.length + 1,
        rationale:
          rawQuery.rationale ||
          `Product search for ${archetype.productCategory}`,
      });
    }

    if (validQueriesForArchetype.length > 0) {
      validatedArchetypes.push({
        ...archetype,
        searchQueries: validQueriesForArchetype,
      });
    }
  }

  // Order queries round-robin across archetypes so the top N queries span distinct product archetypes!
  const orderedDiscoveryQueries: DiscoveryQuery[] = [];
  const maxQueriesPerArchetype = Math.max(
    1,
    ...validatedArchetypes.map((a) => a.searchQueries.length)
  );

  let priorityRank = 1;
  for (let pass = 0; pass < maxQueriesPerArchetype; pass++) {
    for (const archetype of validatedArchetypes) {
      const q = archetype.searchQueries[pass];
      if (!q) continue;
      const normalizedPhrase = q.phrase.toLowerCase().replace(/\s+/g, " ");
      const queryHash = crypto
        .createHash("md5")
        .update(`${input.researchRunId}:${roundNumber}:${normalizedPhrase}`)
        .digest("hex")
        .slice(0, 8);

      orderedDiscoveryQueries.push({
        queryId: `kh02_q_r${roundNumber}_${priorityRank}_${queryHash}`,
        researchRunId: input.researchRunId,
        phrase: q.phrase,
        normalizedPhrase,
        archetypeId: archetype.archetypeId,
        source: primarySource,
        searchType: q.searchType,
        roundNumber,
        priority: priorityRank++,
        rationale: q.rationale,
        origin,
        expectedProductCategory: archetype.productCategory,
      });
    }
  }

  const validatedPlan: AIDiscoveryPlan = {
    normalizedNiche: plan.normalizedNiche || intent.normalizedNiche,
    nicheIntent: plan.nicheIntent || intent.nicheIntent,
    productArchetypes: validatedArchetypes,
    negativeIntentPatterns: Array.from(
      new Set([
        ...(plan.negativeIntentPatterns || []),
        "pos thermal printer",
        "get latest price",
        "widgets themes",
        "vet bill cost factors",
      ])
    ),
    uncertainties: plan.uncertainties || [],
  };

  return {
    valid: orderedDiscoveryQueries.length > 0,
    validatedPlan,
    validatedQueries: orderedDiscoveryQueries,
    rejectedQueries,
    warnings,
  };
}

export interface GenerateDiscoveryQueriesOptions {
  budgetTracker?: GeminiRunBudgetTracker;
  signal?: AbortSignal;
  timeoutMs?: number;
  forceDeterministicFallback?: boolean;
  allowLiveInTest?: boolean;
  roundNumber?: number;
}

/**
 * Uses Gemini (with dynamic model discovery, 3 retries, compatible fallback, and shared run budget)
 * to expand a niche topic into structured product archetypes. Falls back deterministically if
 * Gemini is unavailable or fails validation, while reporting honest telemetry.
 */
export async function generateProductArchetypes(
  input: DiscoveryPlannerInput,
  options?: GenerateDiscoveryQueriesOptions
): Promise<{
  plan: AIDiscoveryPlan;
  origin: "GEMINI_PLANNER" | "DETERMINISTIC_FALLBACK";
  telemetry: DiscoveryPlannerTelemetry;
}> {
  const startMs = Date.now();
  const intent = analyzeNicheIntent(input.topic);

  if (intent.isProhibitedOrUnsupported) {
    const emptyPlan = buildDeterministicDiscoveryPlan(input, intent);
    return {
      plan: emptyPlan,
      origin: "DETERMINISTIC_FALLBACK",
      telemetry: {
        taskType: "DISCOVERY_PLANNING",
        status: "REJECTED_PROHIBITED",
        origin: "DETERMINISTIC_FALLBACK",
        modelUsed: null,
        modelFallbackUsed: false,
        attemptsMade: 0,
        retriesUsed: 0,
        cacheHit: false,
        latencyMs: Date.now() - startMs,
        plannedArchetypesCount: 0,
        validatedQueriesCount: 0,
        rejectedQueriesCount: 1,
        promptVersion: DISCOVERY_PLANNER_PROMPT_VERSION,
        schemaVersion: DISCOVERY_PLANNER_SCHEMA_VERSION,
        failureReason: intent.prohibitedReason,
      },
    };
  }

  const isVitestRun =
    (process.env.VITEST === "true" || process.env.NODE_ENV === "test") &&
    process.env.SWAI_ALLOW_LIVE_GEMINI_IN_VITEST !== "true" &&
    !options?.allowLiveInTest;

  if (
    isVitestRun ||
    (!options?.allowLiveInTest && process.env.SWAI_FORCE_LIVE_GEMINI_PLANNER !== "true") ||
    options?.forceDeterministicFallback ||
    input.remainingAIRequests <= 0 ||
    (options?.budgetTracker && !options.budgetTracker.canStartRequest())
  ) {
    const fallbackPlan = buildDeterministicDiscoveryPlan(input, intent);
    return {
      plan: fallbackPlan,
      origin: "DETERMINISTIC_FALLBACK",
      telemetry: {
        taskType: "DISCOVERY_PLANNING",
        status: "FALLBACK_DETERMINISTIC",
        origin: "DETERMINISTIC_FALLBACK",
        modelUsed: null,
        modelFallbackUsed: false,
        attemptsMade: 0,
        retriesUsed: 0,
        cacheHit: false,
        latencyMs: Date.now() - startMs,
        plannedArchetypesCount: fallbackPlan.productArchetypes.length,
        validatedQueriesCount: 0,
        rejectedQueriesCount: 0,
        promptVersion: DISCOVERY_PLANNER_PROMPT_VERSION,
        schemaVersion: DISCOVERY_PLANNER_SCHEMA_VERSION,
        failureReason: options?.forceDeterministicFallback
          ? "Deterministic fallback explicitly requested."
          : isVitestRun
          ? "Automated test environment: using deterministic archetype planner."
          : "AI request budget exhausted prior to discovery planning.",
      },
    };
  }

  const discovery = await discoverGeminiModels();
  const primaryModelId = discovery.primaryModel?.modelId || null;

  if (!primaryModelId) {
    const fallbackPlan = buildDeterministicDiscoveryPlan(input, intent);
    return {
      plan: fallbackPlan,
      origin: "DETERMINISTIC_FALLBACK",
      telemetry: {
        taskType: "DISCOVERY_PLANNING",
        status: "FALLBACK_DETERMINISTIC",
        origin: "DETERMINISTIC_FALLBACK",
        modelUsed: null,
        modelFallbackUsed: false,
        attemptsMade: 0,
        retriesUsed: 0,
        cacheHit: false,
        latencyMs: Date.now() - startMs,
        plannedArchetypesCount: fallbackPlan.productArchetypes.length,
        validatedQueriesCount: 0,
        rejectedQueriesCount: 0,
        promptVersion: DISCOVERY_PLANNER_PROMPT_VERSION,
        schemaVersion: DISCOVERY_PLANNER_SCHEMA_VERSION,
        failureReason: "Gemini API key or eligible model unavailable.",
      },
    };
  }

  const cacheKey = buildDiscoveryPlanCacheKey(input, primaryModelId);
  const cached = discoveryPlanCache.get(cacheKey);
  if (cached) {
    return {
      plan: cached.plan,
      origin: "GEMINI_PLANNER",
      telemetry: {
        taskType: "DISCOVERY_PLANNING",
        status: "COMPLETED_CACHE",
        origin: "GEMINI_PLANNER",
        modelUsed: cached.modelUsed,
        modelFallbackUsed: false,
        attemptsMade: 0,
        retriesUsed: 0,
        cacheHit: true,
        latencyMs: Date.now() - startMs,
        plannedArchetypesCount: cached.plan.productArchetypes.length,
        validatedQueriesCount: 0,
        rejectedQueriesCount: 0,
        promptVersion: DISCOVERY_PLANNER_PROMPT_VERSION,
        schemaVersion: DISCOVERY_PLANNER_SCHEMA_VERSION,
        failureReason: null,
      },
    };
  }

  const userPrompt = JSON.stringify(
    {
      task: "DISCOVERY_PLANNING",
      topic: input.topic,
      normalizedNiche: intent.normalizedNiche,
      detectedIntentHint: intent.nicheIntent,
      allowedEcommerceCategoriesHint: intent.allowedEcommerceCategories,
      market: input.market || "US",
      lookbackDays: input.lookbackDays || 90,
      productPolicy: input.productPolicy,
      remainingProviderRequests: input.remainingProviderRequests,
      previousQueriesToAvoid: input.previousQueries || [],
      observedProductCategories: input.observedProductCategories || [],
      excludedQueryCategories: input.excludedQueryCategories || [],
      instructions:
        intent.nicheIntent === "SPECIFIC_PRODUCT"
          ? `The user asked for a specific product ('${input.topic}'). Keep priority 1 focused on '${intent.normalizedNiche}' and closely related physical SKU terms without drifting into unrelated categories.`
          : `The user asked for a broad topic ('${input.topic}'). Propose 4 to 5 distinct physical consumer product archetypes with concrete 2-to-4 word product search queries (e.g. for diy: 'wall repair kit', 'cordless hot glue gun', 'decorative switch plate covers', 'pocket hole jig', 'wood scratch repair markers'). Never propose services, B2B printers, or digital widget apps.`,
    },
    null,
    2
  );

  const timeoutMs = options?.timeoutMs ?? 15_000;
  const routerResult = await executeGeminiTaskWithRetry<AIDiscoveryPlan>(
    async (client, modelId, attemptSignal) => {
      if (attemptSignal?.aborted) {
        throw new Error("CANCELED: Discovery planner request aborted.");
      }
      const response = await client.models.generateContent({
        model: modelId,
        contents: userPrompt,
        config: {
          systemInstruction: GEMINI_DISCOVERY_PLANNER_SYSTEM_PROMPT,
          responseMimeType: "application/json",
          responseSchema: GEMINI_DISCOVERY_PLAN_SCHEMA,
          temperature: 0.1,
        },
      });
      const text = response.text;
      if (!text) {
        throw new Error("Empty response from Gemini discovery planner.");
      }
      const parsedJson = JSON.parse(text);
      return AIDiscoveryPlanZodSchema.parse(parsedJson);
    },
    {
      timeoutMs,
      perAttemptTimeoutMs: Math.min(10_000, timeoutMs),
      maxRetriesPerModel: 3,
      signal: options?.signal,
      budgetTracker: options?.budgetTracker,
    }
  );

  if (routerResult.success && routerResult.result) {
    const modelUsed = routerResult.modelUsed || primaryModelId;
    discoveryPlanCache.set(cacheKey, {
      cacheKey,
      plan: routerResult.result,
      modelUsed,
      createdAt: Date.now(),
    });

    return {
      plan: routerResult.result,
      origin: "GEMINI_PLANNER",
      telemetry: {
        taskType: "DISCOVERY_PLANNING",
        status: "COMPLETED_GEMINI",
        origin: "GEMINI_PLANNER",
        modelUsed,
        modelFallbackUsed: (routerResult.telemetry.fallbackCount || 0) > 0,
        attemptsMade: routerResult.telemetry.totalAttempts,
        retriesUsed: routerResult.telemetry.retriesExecuted || 0,
        cacheHit: false,
        latencyMs: routerResult.telemetry.totalDurationMs,
        plannedArchetypesCount: routerResult.result.productArchetypes.length,
        validatedQueriesCount: 0,
        rejectedQueriesCount: 0,
        promptVersion: DISCOVERY_PLANNER_PROMPT_VERSION,
        schemaVersion: DISCOVERY_PLANNER_SCHEMA_VERSION,
        failureReason: null,
      },
    };
  }

  // Fallback deterministically on Gemini inference or schema error
  const fallbackPlan = buildDeterministicDiscoveryPlan(input, intent);
  return {
    plan: fallbackPlan,
    origin: "DETERMINISTIC_FALLBACK",
    telemetry: {
      taskType: "DISCOVERY_PLANNING",
      status: "FALLBACK_DETERMINISTIC",
      origin: "DETERMINISTIC_FALLBACK",
      modelUsed: routerResult.modelUsed,
      modelFallbackUsed: (routerResult.telemetry.fallbackCount || 0) > 0,
      attemptsMade: routerResult.telemetry.totalAttempts,
      retriesUsed: routerResult.telemetry.retriesExecuted || 0,
      cacheHit: false,
      latencyMs: routerResult.telemetry.totalDurationMs,
      plannedArchetypesCount: fallbackPlan.productArchetypes.length,
      validatedQueriesCount: 0,
      rejectedQueriesCount: 0,
      promptVersion: DISCOVERY_PLANNER_PROMPT_VERSION,
      schemaVersion: DISCOVERY_PLANNER_SCHEMA_VERSION,
      failureReason:
        routerResult.error ||
        "Gemini discovery planning failed; used deterministic archetype fallback.",
    },
  };
}

/**
 * End-to-end discovery query planning:
 * 1. Analyzes niche intent
 * 2. Generates product archetypes via Gemini (or deterministic fallback)
 * 3. Deterministically validates and diversifies queries
 * 4. If all Gemini queries were rejected by the validator, falls back to validated deterministic queries
 */
export async function generateDiscoveryQueries(
  input: DiscoveryPlannerInput,
  options?: GenerateDiscoveryQueriesOptions
): Promise<{
  plan: AIDiscoveryPlan;
  validation: DiscoveryPlanValidationResult;
  queries: DiscoveryQuery[];
  telemetry: DiscoveryPlannerTelemetry;
}> {
  const roundNumber = options?.roundNumber ?? 1;
  const { plan, origin, telemetry } = await generateProductArchetypes(
    input,
    options
  );

  const effectiveOrigin: DiscoveryQueryOrigin =
    roundNumber > 1 && origin === "DETERMINISTIC_FALLBACK"
      ? "ADAPTIVE_RECOVERY"
      : origin;

  let validation = validateDiscoveryPlan(
    plan,
    input,
    effectiveOrigin,
    roundNumber
  );

  // If Gemini returned queries that were all rejected by deterministic validation,
  // recover using the deterministic fallback plan and mark telemetry truthfully.
  if (
    !validation.valid &&
    origin === "GEMINI_PLANNER" &&
    telemetry.status !== "REJECTED_PROHIBITED"
  ) {
    const fallbackPlan = buildDeterministicDiscoveryPlan(input);
    const fallbackValidation = validateDiscoveryPlan(
      fallbackPlan,
      input,
      roundNumber > 1 ? "ADAPTIVE_RECOVERY" : "DETERMINISTIC_FALLBACK",
      roundNumber
    );
    validation = fallbackValidation;
    telemetry.status = "FALLBACK_DETERMINISTIC";
    telemetry.origin = "DETERMINISTIC_FALLBACK";
    telemetry.failureReason =
      "Gemini queries did not pass deterministic validation; used deterministic fallback plan.";
    telemetry.plannedArchetypesCount =
      fallbackValidation.validatedPlan.productArchetypes.length;
  } else {
    telemetry.plannedArchetypesCount =
      validation.validatedPlan.productArchetypes.length;
  }

  telemetry.validatedQueriesCount = validation.validatedQueries.length;
  telemetry.rejectedQueriesCount = validation.rejectedQueries.length;

  return {
    plan: validation.validatedPlan,
    validation,
    queries: validation.validatedQueries,
    telemetry,
  };
}
