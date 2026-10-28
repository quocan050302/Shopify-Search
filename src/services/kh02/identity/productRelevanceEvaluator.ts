/**
 * SWAI KH-02 V12.4.2 — Product Relevance Evaluator
 *
 * Validates that product candidates match the target research niche while
 * separating preliminary discovery recall (HIGH_RELEVANCE, POTENTIAL_RELEVANCE,
 * AMBIGUOUS, CLEARLY_UNRELATED) from final shortlist verification:
 * - Preserves strict negative controls for pet/beauty/general niches
 * - Recovers plausible physical products that lack the literal parent niche keyword
 *   (e.g., Decorative Light Switch Covers under 'diy', Self-Watering Plant Spikes under 'gardening')
 * - Immediately rejects B2B POS thermal printers, digital widget apps, casinos, vet bills, and insurance
 */

import { PlannedProductArchetype } from "../discovery/geminiDiscoveryPlanner";

export type ProductRelevanceStatus =
  | "RELEVANT"
  | "PROBABLY_RELEVANT"
  | "AMBIGUOUS"
  | "IRRELEVANT";

export type DiscoveryRelevanceDecision =
  | "HIGH_RELEVANCE"
  | "POTENTIAL_RELEVANCE"
  | "AMBIGUOUS"
  | "CLEARLY_UNRELATED";

export interface EvaluateProductRelevanceOptions {
  plannedArchetypes?: PlannedProductArchetype[];
  matchedQueryPhrase?: string | null;
}

export interface RelevanceEvaluationResult {
  relevanceStatus: ProductRelevanceStatus;
  discoveryDecision: DiscoveryRelevanceDecision;
  isAccepted: boolean;
  score: number; // 0 to 1
  reasons: string[];
  topic: string;
  matchedArchetypeId?: string | null;
}

const GLOBAL_NON_PRODUCT_EXCLUSIONS: string[] = [
  "pos thermal printer",
  "80mm pos",
  "receipt printer",
  "get latest price",
  "alibaba.com",
  "b2b app",
  "icontrol",
  "easy widgets themes",
  "widgets themes",
  "phone widgets",
  "vet bill cost factors",
  "er vet bill",
  "veterinary insurance",
  "pet insurance",
  "casino bonus",
  "welcome bonus",
  "free spins",
  "crypto trading",
  "mortgage refinance",
  "gardening service",
  "landscaping service",
  "tree trimming",
  "lawn care",
  "free estimate",
  "request a quote",
  "schedule a consultation",
  "virtual consultation",
  "design consultation",
  "interior design consultation",
];

const GENERIC_SEASONAL_CAMPAIGN_PATTERNS =
  /^(get halloween ready|halloween sale|black friday|cyber monday|holiday deals|summer sale|spring sale|shop now|limited time offer)[!.\s]*$/i;

// Domain-specific keyword signatures for consumer ecommerce niches
const NICHE_SIGNATURES: Record<
  string,
  { include: string[]; potential?: string[]; exclude: string[] }
> = {
  pet: {
    include: [
      "pet",
      "dog",
      "puppy",
      "cat",
      "kitten",
      "paw",
      "paws",
      "fur",
      "leash",
      "grooming",
      "litter",
      "aquarium",
      "deshedding",
      "shedding",
      "chomchom",
      "fur zapper",
      "grooming glove",
      "pet comb",
      "undercoat rake",
      "dog toy",
      "cat toy",
      "dog ball launcher",
      "pet ball launcher",
      "interactive pet toy",
      "pet feeder",
      "automatic pet feeder",
      "cat feeder",
      "dog feeder",
      "pet water fountain",
      "cat water fountain",
      "dog water fountain",
      "pet harness",
      "pet brush",
      "pet hair remover",
      "dog fur roller",
      "grooming vacuum",
      "dog grooming vacuum",
      "pet vacuum",
      "pet tracker",
      "gps pet tracker",
      "dog tracker",
      "cat tracker",
      "smart pet collar",
      "bark collar",
      "pet collar",
      "dog collar",
      "cat collar",
      "pet camera",
      "dog camera",
      "cat camera",
      "pet gadget",
      "pet gadgets",
      "pet bed",
      "dog bed",
      "cat bed",
      "pet car seat belt",
      "pet seat belt",
      "dog car harness",
      "pet headdress",
      "pet clothes",
      "pet coat",
      "dog coat",
      "cat tree",
      "scratching post",
    ],
    exclude: [
      "casino",
      "crypto",
      "dating",
      "adult",
      "loan",
      "mortgage",
      "real estate",
      "car repair",
      "solar panels",
      "pet insurance",
      "veterinary insurance",
      // Automotive / fleet / vehicle tracking exclusions
      "car fleet",
      "fleet tracker",
      "fleet tracking",
      "vehicle tracking",
      "car tracker",
      "asset tracker",
      "obd tracker",
      "truck tracking",
      // Garden / outdoor decorative landscaping exclusions
      "garden fountain",
      "garden decoration",
      "outdoor fountain",
      "patio fountain",
      "solar bird bath",
      "bird bath fountain",
      "yard art",
      "patio decor",
      // Human hair removal, beauty, skincare & depilatory terms
      "crystal hair eraser",
      "strawberry legs",
      "razor bump",
      "razor bumps",
      "shaving cut",
      "shaving cuts",
      "bikini",
      "pubic",
      "armpit",
      "underarm",
      "facial hair",
      "beard trimmer",
      "epilator",
      "depilatory",
      "laser hair",
      "human hair",
      "dead skin",
      "painless hair removal",
      "hair removal cream",
      "hair removal spray",
      "body hair",
      "wax strips",
      "waxing kit",
      "shaving cream",
      "lipstick",
      "eyeliner",
      "mascara",
      "serum",
      "anti-aging",
      "wrinkle",
      // Unrelated electronics / fashion / holiday / toys negative controls
      "bluetooth speaker",
      "fm radio",
      "wireless audio",
      "rearview mirror",
      "motorbike",
      "motorcycle speaker",
      "dance shoes",
      "jazz dance shoes",
      "women's shoes",
      "high heels",
      "christmas ball",
      "tree pendant",
      "holiday decor",
      "kids sunglasses",
      "sunglasses",
      "protective eyewear",
      "wooden jigsaw puzzle",
      "3d wooden jigsaw",
      "jigsaw puzzle",
      "pc case cooler",
      "case cooler",
      "tin decor",
      "metal door sign",
      "pos thermal printer",
      "widgets themes",
    ],
  },
  beauty: {
    include: [
      "skincare",
      "serum",
      "makeup",
      "cosmetics",
      "facial",
      "anti-aging",
      "hair",
      "lipstick",
      "collagen",
      "pimple patch",
      "red light therapy",
      "pore vacuum",
      "cleansing brush",
      "hair curler",
    ],
    exclude: [
      "industrial",
      "automotive",
      "gaming",
      "pos thermal printer",
      "widgets themes",
      "mortgage",
      "real estate",
      "casino",
    ],
  },
  diy: {
    include: [
      "diy",
      "do it yourself",
      "wall repair",
      "tile repair",
      "cordless hot glue gun",
      "hot glue gun",
      "glue gun",
      "craft cutter",
      "precision cutter",
      "pocket hole jig",
      "corner clamp",
      "woodworking",
      "wood scratch repair",
      "scratch repair marker",
      "furniture repair kit",
      "furniture repair",
      "paint by numbers",
      "multimeter",
      "soldering",
      "rotary tool",
      "laser level",
      "caulking tool",
      "drywall patch",
    ],
    potential: [
      "decorative light switch cover",
      "decorative switch plate",
      "switch plate cover",
      "switch plate covers",
      "light switch cover",
      "light switch covers",
      "switch sticker",
      "outlet plate",
      "outlet plates",
      "peel and stick wall",
      "wall panels",
      "wall tiles",
      "cabinet hardware",
      "adhesive hook",
      "weather stripping",
      "home repair",
      "home improvement",
      "handyman",
      "craft kit",
    ],
    exclude: [
      "pos thermal printer",
      "80mm pos",
      "receipt printer",
      "get latest price",
      "alibaba",
      "b2b app",
      "icontrol",
      "widgets themes",
      "easy widgets",
      "phone widget",
      "casino",
      "vet bill",
      "pet insurance",
      "mortgage",
      "real estate",
      "crypto",
    ],
  },
  gardening: {
    include: [
      "gardening",
      "garden",
      "self-watering plant spike",
      "self watering plant spike",
      "plant spikes",
      "watering spikes",
      "pruning shears",
      "garden shears",
      "secateurs",
      "seed starter tray",
      "seed starter",
      "drip irrigation kit",
      "drip irrigation",
      "plant support clips",
      "plant trellis",
      "soil moisture meter",
      "weed puller",
      "planter box",
      "grow light",
    ],
    potential: [
      "plant watering",
      "indoor plants",
      "houseplant",
      "seedling",
      "compost bin",
      "hose nozzle",
      "garden tool",
      "flower pot",
    ],
    exclude: [
      "pos thermal printer",
      "widgets themes",
      "casino",
      "vet bill",
      "pet insurance",
      "mortgage",
    ],
  },
  kitchen: {
    include: [
      "kitchen",
      "vegetable chopper",
      "garlic chopper",
      "mandoline slicer",
      "oil sprayer",
      "oil spray bottle",
      "sink strainer",
      "food sealer",
      "vacuum sealer",
      "bottle opener",
      "knife sharpener",
      "air fryer liner",
      "cutting board",
    ],
    potential: [
      "food prep",
      "cooking dispenser",
      "spice rack",
      "pantry organizer",
      "dish drying rack",
      "cookware",
    ],
    exclude: [
      "pos thermal printer",
      "80mm pos",
      "receipt printer",
      "widgets themes",
      "casino",
      "vet bill",
    ],
  },
  cleaning: {
    include: [
      "cleaning",
      "electric spin scrubber",
      "spin scrubber",
      "washing machine cleaner",
      "portable carpet cleaner",
      "steam cleaner",
      "microfiber spray mop",
      "spray mop",
      "grout brush",
      "window cleaner",
      "appliance cleaner",
    ],
    potential: [
      "power scrubber",
      "crevice brush",
      "microfiber mop",
      "lint remover",
      "duster",
      "stain remover",
    ],
    exclude: [
      "pos thermal printer",
      "widgets themes",
      "phone cleaner app",
      "storage cleaner app",
      "casino",
      "vet bill",
    ],
  },
  "home decor": {
    include: [
      "home decor",
      "decorative switch plate",
      "switch plate covers",
      "light switch covers",
      "switch sticker",
      "outlet plates",
      "rechargeable wall sconce",
      "wall sconce",
      "peel and stick wall",
      "wall panels",
      "wall tiles",
      "stretch sofa cover",
      "sofa slipcover",
      "crystal lamp",
      "accent lamp",
    ],
    potential: [
      "wall art",
      "throw pillow",
      "decorative cover",
      "room decor",
      "interior accent",
    ],
    exclude: [
      "pos thermal printer",
      "widgets themes",
      "icontrol",
      "get latest price",
      "alibaba",
      "casino",
      "vet bill",
    ],
  },
};

function hasWordMatch(text: string, word: string): boolean {
  if (word.includes(" ")) {
    return text.includes(word);
  }
  const regex = new RegExp(
    `\\b${word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`,
    "i"
  );
  return regex.test(text);
}

function mapStatusToDecision(
  status: ProductRelevanceStatus,
  isAccepted: boolean
): DiscoveryRelevanceDecision {
  if (status === "RELEVANT") return "HIGH_RELEVANCE";
  if (status === "PROBABLY_RELEVANT") return "POTENTIAL_RELEVANCE";
  if (status === "AMBIGUOUS") {
    return isAccepted ? "POTENTIAL_RELEVANCE" : "AMBIGUOUS";
  }
  return "CLEARLY_UNRELATED";
}

/**
 * Evaluates whether candidate text, title, or category belongs to the research topic.
 */
export type CandidateTextInput =
  | string
  | {
      title?: string | null;
      canonicalProductName?: string | null;
      category?: string | null;
      problemStatement?: string | null;
      targetAudience?: string | null;
      storeDomain?: string | null;
      canonicalProductUrl?: string | null;
      adTexts?: string[];
    };

function normalizeCandidateTextInput(input: CandidateTextInput): string {
  if (typeof input === "string") return input;
  if (!input || typeof input !== "object") return "";
  return [
    input.title || "",
    input.canonicalProductName || "",
    input.category || "",
    input.problemStatement || "",
    input.targetAudience || "",
    input.storeDomain || "",
    input.canonicalProductUrl || "",
    ...(Array.isArray(input.adTexts) ? input.adTexts : []),
  ]
    .filter(Boolean)
    .join(" ");
}

export function evaluateProductRelevance(
  candidateText: CandidateTextInput,
  topic: string,
  options?: EvaluateProductRelevanceOptions
): RelevanceEvaluationResult {
  const normalizedTopic = (topic || "").toLowerCase().trim();
  const normalizedText = normalizeCandidateTextInput(candidateText).toLowerCase().trim();
  const reasons: string[] = [];

  if (!normalizedText || normalizedText.length < 2) {
    return {
      relevanceStatus: "IRRELEVANT",
      discoveryDecision: "CLEARLY_UNRELATED",
      isAccepted: false,
      score: 0.05,
      reasons: ["Candidate text is empty or too short."],
      topic,
      matchedArchetypeId: null,
    };
  }

  // 0. Global high-precision rejection for B2B POS printers, digital widget apps, vet bills, casinos
  for (const globalExcl of GLOBAL_NON_PRODUCT_EXCLUSIONS) {
    if (normalizedText.includes(globalExcl)) {
      const isPetVetArticle =
        (globalExcl === "er vet bill" || globalExcl === "vet bill cost factors") &&
        hasWordMatch(normalizedText, "pet");
      reasons.push(
        `Contains excluded non-product/B2B/digital/service pattern '${globalExcl}'.`
      );
      return {
        relevanceStatus: isPetVetArticle ? "AMBIGUOUS" : "IRRELEVANT",
        discoveryDecision: "CLEARLY_UNRELATED",
        isAccepted: false,
        score: 0.05,
        reasons,
        topic,
        matchedArchetypeId: null,
      };
    }
  }

  // Check if candidate is solely a generic seasonal campaign headline (e.g. "Get Halloween ready")
  const primaryLine = normalizedText.split(/[|\n\r]/)[0]?.trim() || normalizedText;
  if (
    GENERIC_SEASONAL_CAMPAIGN_PATTERNS.test(primaryLine) &&
    !normalizedText.includes("/products/")
  ) {
    reasons.push(
      "Candidate headline is a generic seasonal/promotional campaign slogan requiring product-page verification."
    );
    return {
      relevanceStatus: "AMBIGUOUS",
      discoveryDecision: "AMBIGUOUS",
      isAccepted: false,
      score: 0.35,
      reasons,
      topic,
      matchedArchetypeId: null,
    };
  }

  // Match topic terms directly using word boundaries to prevent substring false positives (e.g. mohair != hair)
  const topicWords = normalizedTopic.split(/\s+/).filter((w) => w.length > 2);
  let matchedTopicWords = 0;
  for (const word of topicWords) {
    if (hasWordMatch(normalizedText, word)) {
      matchedTopicWords++;
    }
  }

  // Check niche signatures if available (e.g. "pet gadgets" -> "pet", "diy" -> "diy", "gardening" -> "gardening")
  let nicheKey = "";
  for (const key of Object.keys(NICHE_SIGNATURES)) {
    if (hasWordMatch(normalizedTopic, key) || normalizedTopic.includes(key)) {
      nicheKey = key;
      break;
    }
  }
  if (!nicheKey) {
    if (
      /\b(glue gun|switch plate|switch cover|wall repair|tile repair|pocket hole|scratch repair)\b/i.test(
        normalizedTopic
      )
    ) {
      nicheKey = "diy";
    } else if (
      /\b(plant spike|pruning shear|seed starter|drip irrigation)\b/i.test(
        normalizedTopic
      )
    ) {
      nicheKey = "gardening";
    } else if (
      /\b(cat water fountain|dog grooming|litter mat)\b/i.test(normalizedTopic)
    ) {
      nicheKey = "pet";
    }
  }

  if (nicheKey && NICHE_SIGNATURES[nicheKey]) {
    const signature = NICHE_SIGNATURES[nicheKey];

    // Check for hard exclusions
    for (const excl of signature.exclude) {
      if (normalizedText.includes(excl)) {
        reasons.push(
          `Contains excluded term '${excl}' for niche '${topic}' (unrelated domain or non-physical offer).`
        );
        return {
          relevanceStatus: "IRRELEVANT",
          discoveryDecision: "CLEARLY_UNRELATED",
          isAccepted: false,
          score: 0.05,
          reasons,
          topic,
          matchedArchetypeId: null,
        };
      }
    }

    // Contextual evaluation for "hair eraser" in pet niche
    if (nicheKey === "pet" && normalizedText.includes("hair eraser")) {
      const isHumanBodyContext = [
        "strawberry",
        "legs",
        "bikini",
        "pubic",
        "underarm",
        "armpit",
        "exfoliat",
        "painless",
        "dead skin",
        "body hair",
        "facial",
        "smooth skin",
      ].some((term) => normalizedText.includes(term));
      const hasPetContext = [
        "pet",
        "dog",
        "puppy",
        "cat",
        "kitten",
        "fur",
        "paws",
        "animal",
      ].some((term) => hasWordMatch(normalizedText, term));

      if (isHumanBodyContext || !hasPetContext) {
        reasons.push(
          "Contains 'hair eraser' in human body / skin hair removal context."
        );
        return {
          relevanceStatus: "IRRELEVANT",
          discoveryDecision: "CLEARLY_UNRELATED",
          isAccepted: false,
          score: 0.05,
          reasons,
          topic,
          matchedArchetypeId: null,
        };
      }
    }

    // Check generic chemical stain cleaners / odor removers without pet hair cleanup intent
    if (
      nicheKey === "pet" &&
      (normalizedText.includes("stain remover") ||
        normalizedText.includes("spot cleaner") ||
        normalizedText.includes("carpet cleaner") ||
        normalizedText.includes("odor eliminator") ||
        normalizedText.includes("odor remover") ||
        normalizedText.includes("urine remover") ||
        normalizedText.includes("enzyme cleaner"))
    ) {
      const hasHairOrFurCleanup = [
        "hair",
        "fur",
        "lint",
        "shedding",
        "deshedding",
        "grooming",
      ].some((term) => hasWordMatch(normalizedText, term));
      if (!hasHairOrFurCleanup) {
        reasons.push(
          "Product is a stain/odor chemical cleaner and does not target hair, fur, or lint cleanup."
        );
        return {
          relevanceStatus: "IRRELEVANT",
          discoveryDecision: "CLEARLY_UNRELATED",
          isAccepted: false,
          score: 0.1,
          reasons,
          topic,
          matchedArchetypeId: null,
        };
      }
    }

    // Core pet context verification
    if (nicheKey === "pet") {
      const petContextTerms = [
        "pet",
        "pets",
        "dog",
        "dogs",
        "puppy",
        "puppies",
        "cat",
        "cats",
        "kitten",
        "kittens",
        "fur",
        "paw",
        "paws",
        "canine",
        "feline",
        "animal",
      ];
      const hasCorePetContext = petContextTerms.some((term) =>
        hasWordMatch(normalizedText, term)
      );

      const genericDeviceHardwareTerms = [
        "gps",
        "tracker",
        "tracking",
        "fountain",
        "water fountain",
        "feeder",
        "camera",
        "sensor",
        "monitor",
      ];
      const nonPetContextTerms = [
        "car",
        "fleet",
        "vehicle",
        "truck",
        "automotive",
        "obd",
        "motorcycle",
        "garden",
        "outdoor decoration",
        "patio",
        "yard",
        "landscaping",
        "bird bath",
        "pond",
        "baby",
        "nanny",
        "elderly",
      ];

      const hasGenericDevice = genericDeviceHardwareTerms.some((term) =>
        hasWordMatch(normalizedText, term)
      );
      const hasNonPetContext = nonPetContextTerms.some(
        (term) =>
          hasWordMatch(normalizedText, term) || normalizedText.includes(term)
      );

      if (hasGenericDevice && !hasCorePetContext) {
        if (hasNonPetContext) {
          reasons.push(
            "Device or hardware product targets vehicle, garden, or non-pet context."
          );
          return {
            relevanceStatus: "IRRELEVANT",
            discoveryDecision: "CLEARLY_UNRELATED",
            isAccepted: false,
            score: 0.05,
            reasons,
            topic,
            matchedArchetypeId: null,
          };
        }
        reasons.push(
          "Hardware or device utility mentions generic tracker/fountain/feeder but lacks explicit pet intent."
        );
        return {
          relevanceStatus: "AMBIGUOUS",
          discoveryDecision: "AMBIGUOUS",
          isAccepted: false,
          score: 0.35,
          reasons,
          topic,
          matchedArchetypeId: null,
        };
      }

      if (!hasCorePetContext) {
        const isGenericHouseholdItem = [
          "lint roller",
          "cleaning brush",
          "vacuum",
          "multi-purpose",
          "household",
          "brush",
          "roller",
          "broom",
        ].some(
          (term) =>
            normalizedText.includes(term) || hasWordMatch(normalizedText, term)
        );

        if (isGenericHouseholdItem) {
          reasons.push(
            "Product has generic cleaning or household utility attributes but lacks explicit pet intent."
          );
          return {
            relevanceStatus: "AMBIGUOUS",
            discoveryDecision: "AMBIGUOUS",
            isAccepted: false,
            score: 0.35,
            reasons,
            topic,
            matchedArchetypeId: null,
          };
        }
      }

      // Special logic for "pet hair remover"
      const isPetHairRemoverQuery =
        normalizedTopic.includes("pet") && normalizedTopic.includes("hair");
      if (isPetHairRemoverQuery) {
        const petTerms = [
          "pet",
          "pets",
          "dog",
          "dogs",
          "puppy",
          "puppies",
          "cat",
          "cats",
          "kitten",
          "kittens",
          "fur",
          "paws",
          "animal",
          "canine",
          "feline",
        ];
        const hairOrFurTerms = [
          "hair",
          "fur",
          "lint",
          "shedding",
          "deshedding",
          "coat",
        ];
        const cleaningOrRemoverTerms = [
          "hair remover",
          "remover",
          "roller",
          "brush",
          "grooming",
          "deshedding",
          "shedding",
          "lint",
          "cleaner",
          "sweeper",
          "vacuum",
          "comb",
          "rake",
          "glove",
          "eraser",
        ];
        const chemicalCleanerTerms = [
          "stain",
          "odor",
          "urine",
          "enzyme",
          "spot",
          "carpet cleaner",
          "spray",
        ];
        const householdSurfaces = [
          "couch",
          "sofa",
          "carpet",
          "clothing",
          "furniture",
          "rug",
          "bedding",
          "car seat",
        ];

        const hasPetTerm = petTerms.some((t) => hasWordMatch(normalizedText, t));
        const hasHairOrFurTerm = hairOrFurTerms.some((t) =>
          hasWordMatch(normalizedText, t)
        );
        const hasRemoverTerm = cleaningOrRemoverTerms.some((t) =>
          hasWordMatch(normalizedText, t)
        );
        const hasChemicalCleaner = chemicalCleanerTerms.some((t) =>
          hasWordMatch(normalizedText, t)
        );
        const hasSurface = householdSurfaces.some((s) =>
          normalizedText.includes(s)
        );

        if (hasPetTerm && hasHairOrFurTerm && hasRemoverTerm) {
          reasons.push("Strong match for pet hair removal/grooming intent.");
          return {
            relevanceStatus: "RELEVANT",
            discoveryDecision: "HIGH_RELEVANCE",
            isAccepted: true,
            score: 0.95,
            reasons,
            topic,
            matchedArchetypeId: "pet_grooming_hair_removal",
          };
        } else if (
          hasHairOrFurTerm &&
          hasRemoverTerm &&
          (hasPetTerm || hasSurface)
        ) {
          reasons.push(
            "Hair/fur removal tool for household surfaces or pet grooming."
          );
          return {
            relevanceStatus: "RELEVANT",
            discoveryDecision: "HIGH_RELEVANCE",
            isAccepted: true,
            score: 0.85,
            reasons,
            topic,
            matchedArchetypeId: "pet_grooming_hair_removal",
          };
        } else if (hasChemicalCleaner && !hasHairOrFurTerm) {
          reasons.push(
            "Product is a stain/odor cleaner lacking pet hair or fur removal capability."
          );
          return {
            relevanceStatus: "IRRELEVANT",
            discoveryDecision: "CLEARLY_UNRELATED",
            isAccepted: false,
            score: 0.1,
            reasons,
            topic,
            matchedArchetypeId: null,
          };
        } else if (hasPetTerm && !hasHairOrFurTerm) {
          reasons.push(
            "Product is pet-related but lacks specific hair removal or grooming attributes."
          );
          return {
            relevanceStatus: "AMBIGUOUS",
            discoveryDecision: "AMBIGUOUS",
            isAccepted: false,
            score: 0.4,
            reasons,
            topic,
            matchedArchetypeId: null,
          };
        } else {
          reasons.push("Product does not demonstrate pet or hair removal utility.");
          return {
            relevanceStatus: "IRRELEVANT",
            discoveryDecision: "CLEARLY_UNRELATED",
            isAccepted: false,
            score: 0.1,
            reasons,
            topic,
            matchedArchetypeId: null,
          };
        }
      }
    }

    // Check for domain core includes
    const matchedSignatureTerms = signature.include.filter((term) =>
      hasWordMatch(normalizedText, term)
    );

    if (matchedSignatureTerms.length >= 1) {
      reasons.push(
        `Strong niche match on terms: ${matchedSignatureTerms.slice(0, 3).join(", ")}.`
      );
      return {
        relevanceStatus: "RELEVANT",
        discoveryDecision: "HIGH_RELEVANCE",
        isAccepted: true,
        score: 0.92,
        reasons,
        topic,
        matchedArchetypeId: null,
      };
    }

    // Check for domain potential / adjacent product archetypes (e.g. Decorative Light Switch Covers under 'diy')
    if (signature.potential && signature.potential.length > 0) {
      const matchedPotentialTerms = signature.potential.filter((term) =>
        hasWordMatch(normalizedText, term)
      );
      if (matchedPotentialTerms.length >= 1) {
        reasons.push(
          `Potential product archetype match for '${topic}' on terms: ${matchedPotentialTerms.slice(0, 3).join(", ")} (preserved for Gemini semantic analysis).`
        );
        return {
          relevanceStatus: "PROBABLY_RELEVANT",
          discoveryDecision: "POTENTIAL_RELEVANCE",
          isAccepted: true,
          score: 0.78,
          reasons,
          topic,
          matchedArchetypeId: null,
        };
      }
    }
  }

  // Check planned archetypes from Gemini Discovery Planner (when provided)
  if (options?.plannedArchetypes && options.plannedArchetypes.length > 0) {
    for (const arch of options.plannedArchetypes) {
      for (const q of arch.searchQueries || []) {
        const phrase = q.phrase.toLowerCase().trim();
        if (phrase.length >= 3 && hasWordMatch(normalizedText, phrase)) {
          reasons.push(
            `Matches planned product archetype '${arch.productCategory}' query '${q.phrase}'.`
          );
          return {
            relevanceStatus: "RELEVANT",
            discoveryDecision: "HIGH_RELEVANCE",
            isAccepted: true,
            score: 0.9,
            reasons,
            topic,
            matchedArchetypeId: arch.archetypeId,
          };
        }
        const qTokens = phrase.split(/\s+/).filter((w) => w.length > 2);
        const matchedQTokens = qTokens.filter((w) =>
          hasWordMatch(normalizedText, w)
        );
        if (
          qTokens.length >= 2 &&
          matchedQTokens.length >= Math.ceil(qTokens.length * 0.66)
        ) {
          reasons.push(
            `Partially matches planned product archetype '${arch.productCategory}' (${matchedQTokens.join(", ")}).`
          );
          return {
            relevanceStatus: "PROBABLY_RELEVANT",
            discoveryDecision: "POTENTIAL_RELEVANCE",
            isAccepted: true,
            score: 0.75,
            reasons,
            topic,
            matchedArchetypeId: arch.archetypeId,
          };
        }
      }
    }
  }

  // Fallback for general topics without custom signature dictionary
  if (
    topicWords.length > 0 &&
    matchedTopicWords >= Math.ceil(topicWords.length / 2)
  ) {
    reasons.push(
      `Matches majority of topic keywords: ${topicWords.join(", ")}.`
    );
    return {
      relevanceStatus: "RELEVANT",
      discoveryDecision: "HIGH_RELEVANCE",
      isAccepted: true,
      score: 0.85,
      reasons,
      topic,
      matchedArchetypeId: null,
    };
  }

  if (matchedTopicWords > 0) {
    reasons.push(
      "Partial keyword overlap with search topic; preserved as potentially relevant for semantic evaluation."
    );
    return {
      relevanceStatus: "AMBIGUOUS",
      discoveryDecision: "AMBIGUOUS",
      isAccepted: false,
      score: 0.4,
      reasons,
      topic,
      matchedArchetypeId: null,
    };
  }

  reasons.push(`No keyword or niche alignment found with topic '${topic}'.`);
  return {
    relevanceStatus: "IRRELEVANT",
    discoveryDecision: mapStatusToDecision("IRRELEVANT", false),
    isAccepted: false,
    score: 0.1,
    reasons,
    topic,
    matchedArchetypeId: null,
  };
}

/**
 * Convenience helper returning the V12.4.2 4-level DiscoveryRelevanceDecision.
 */
export function evaluateDiscoveryRelevance(
  candidateText: CandidateTextInput,
  topic: string,
  options?: EvaluateProductRelevanceOptions
): {
  decision: DiscoveryRelevanceDecision;
  discoveryDecision: DiscoveryRelevanceDecision;
  relevanceStatus: ProductRelevanceStatus;
  isAccepted: boolean;
  score: number;
  reasons: string[];
  matchedArchetypeId: string | null;
} {
  const res = evaluateProductRelevance(candidateText, topic, options);
  const effectiveStatus: ProductRelevanceStatus =
    res.discoveryDecision === "CLEARLY_UNRELATED" ? "IRRELEVANT" : res.relevanceStatus;
  return {
    decision: res.discoveryDecision,
    discoveryDecision: res.discoveryDecision,
    relevanceStatus: effectiveStatus,
    isAccepted: res.isAccepted,
    score: res.score,
    reasons: res.reasons,
    matchedArchetypeId: res.matchedArchetypeId ?? null,
  };
}
