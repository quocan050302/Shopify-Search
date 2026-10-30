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

export type TargetCustomerAudience =
  | "DOG"
  | "CAT"
  | "PET_GENERAL"
  | "MEN"
  | "WOMEN"
  | "KIDS"
  | "ADULTS"
  | "CAR"
  | "MOTORCYCLE"
  | "INDOOR"
  | "OUTDOOR"
  | "UNSPECIFIED";

export interface ProductAudienceRelevance {
  requestedAudience: TargetCustomerAudience;
  supportedAudiences: TargetCustomerAudience[];
  audienceMatch: "EXACT" | "COMPATIBLE" | "ADJACENT" | "CONTRADICTORY" | "UNKNOWN";
  audienceEvidenceReferences: string[];
  relevanceReason: string;
  eligibleForPrimaryShortlist: boolean;
}

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
  audienceRelevance?: ProductAudienceRelevance;
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
  "ads agency",
  "marketing agency",
  "advertising agency",
  "ecommerce agency",
  "online course",
  "coaching program",
  "masterclass",
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
      // V12.4.3.3.1 G09/G10: Consumable pet food, starter kits, bundles, treats & supplements
      "dog food starter kit",
      "shelf-stable dog food",
      "cooked dog food",
      "raw dog food",
      "freeze-dried dog food",
      "dog food bundle",
      "cat food bundle",
      "pet food starter",
      "probiotic chew",
      "probiotic chews",
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
      "woodworking kit",
      "home repair kit",
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
      // V12.4.3.3.1 G09/G10: Exclude textile/yarn/crochet/fashion bag craft kits from DIY Tools
      "crochet",
      "granny bag",
      "crochet bag",
      "knitting",
      "yarn",
      "embroidery",
      "cross stitch",
      "needlepoint",
      "macrame",
      "sewing pattern",
      "jewelry making",
      "bead kit",
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
      "self watering planter",
      "self-watering planter",
      "plant waterer",
      "automatic plant waterer",
      "planter",
      "flowerpot",
      "bonsai pot",
      "grow light",
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
      "vegetable slicer",
      "food chopper",
      "garlic chopper",
      "garlic press",
      "mandoline slicer",
      "mandoline",
      "cheese grater",
      "rotary grater",
      "oil sprayer",
      "oil spray bottle",
      "oil dispenser",
      "olive oil bottle",
      "defrosting tray",
      "thawing board",
      "meat defrosting",
      "sink strainer",
      "sink caddy",
      "food sealer",
      "vacuum sealer",
      "bottle opener",
      "can opener",
      "knife sharpener",
      "air fryer liner",
      "air fryer",
      "cutting board",
      "silicone baking mat",
      "egg separator",
      "colander",
    ],
    potential: [
      "food prep",
      "cooking dispenser",
      "spice rack",
      "pantry organizer",
      "dish drying rack",
      "cookware",
      "utensil",
      "baking",
      "meat thermometer",
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
      "carpet cleaner",
      "spot cleaner",
      "steam cleaner",
      "steam mop",
      "microfiber spray mop",
      "spray mop",
      "grout brush",
      "window cleaner",
      "window vacuum",
      "appliance cleaner",
      "cordless vacuum",
      "stick vacuum",
      "vacuum cleaner",
      "handheld vacuum",
      "robot vacuum",
      "ultrasonic cleaner",
      "lint remover",
      "fabric shaver",
    ],
    potential: [
      "power scrubber",
      "crevice brush",
      "microfiber mop",
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
      "pet grooming vacuum",
      "dog grooming vacuum",
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
      "wallpaper",
      "peel and stick wallpaper",
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
  car: {
    include: [
      "car accessory",
      "car accessories",
      "portable car vacuum",
      "car vacuum",
      "car phone mount",
      "magnetic car phone mount",
      "car phone holder",
      "car trunk organizer",
      "trunk organizer",
      "car seat organizer",
      "tire inflator",
      "portable tire inflator",
      "dash cam",
      "dashcam",
      "dog car seat cover",
      "car seat cover",
      "car trash can",
      "windshield sunshade",
      "car sunshade",
      "car air freshener",
      "car charger",
      "jump starter",
      "car detailing brush",
      "car cleaning gel",
      "blind spot mirror",
    ],
    potential: [
      "steering wheel cover",
      "headrest hook",
      "seat gap filler",
      "car Seat",
      "auto accessory",
      "vehicle organizer",
    ],
    exclude: [
      "car insurance",
      "auto insurance",
      "auto loan",
      "car repair service",
      "pos thermal printer",
      "widgets themes",
      "casino",
      "vet bill",
      // V12.4.3.3.1 G09/G10/G26: Exclude golf & non-automotive sports/home organizers from Car Accessories
      "golf",
      "golf organizer",
      "golf accessories",
      "golf bag",
      "golf tee",
      "golf club",
      "makeup organizer",
      "cosmetic organizer",
      "jewelry organizer",
      "desk organizer",
      "closet organizer",
      "wardrobe organizer",
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
      topic?: string | null;
      title?: string | null;
      canonicalProductName?: string | null;
      merchantVerifiedProductName?: string | null;
      category?: string | null;
      problemStatement?: string | null;
      targetAudience?: string | null;
      storeDomain?: string | null;
      canonicalProductUrl?: string | null;
      productUrl?: string | null;
      adTexts?: string[];
      evidenceSnippets?: string[];
    };

function normalizeCandidateTextInput(input: CandidateTextInput): string {
  if (typeof input === "string") return input;
  if (!input || typeof input !== "object") return "";
  return [
    input.title || "",
    input.canonicalProductName || "",
    input.merchantVerifiedProductName || "",
    input.category || "",
    input.problemStatement || "",
    input.targetAudience || "",
    input.storeDomain || "",
    input.canonicalProductUrl || "",
    input.productUrl || "",
    ...(Array.isArray(input.adTexts) ? input.adTexts : []),
    ...(Array.isArray(input.evidenceSnippets) ? input.evidenceSnippets : []),
  ]
    .filter(Boolean)
    .join(" ");
}

export function evaluateProductAudienceRelevance(
  candidateText: CandidateTextInput,
  topic?: string
): ProductAudienceRelevance {
  const resolvedTopic =
    topic ||
    (typeof candidateText === "object" && candidateText ? candidateText.topic || "" : "");
  const normTopic = resolvedTopic.toLowerCase().trim();
  const normText = normalizeCandidateTextInput(candidateText).toLowerCase().trim();

  // 1. Determine requestedAudience from topic
  let requestedAudience: TargetCustomerAudience = "UNSPECIFIED";
  const topicHasDog = /\b(dogs?|pupp(?:y|ies)|canines?)\b/i.test(normTopic);
  const topicHasCat = /\b(cats?|kittens?|felines?)\b/i.test(normTopic);
  const topicHasPet = /\b(pets?)\b/i.test(normTopic);
  const topicHasMen = /\b(men|mens|men's|male)\b/i.test(normTopic);
  const topicHasWomen = /\b(women|womens|women's|female|ladies)\b/i.test(normTopic);
  const topicHasKids = /\b(kids?|children|toddler|baby|babies)\b/i.test(normTopic);
  const topicHasAdults = /\b(adults?)\b/i.test(normTopic);
  const topicHasCar = /\b(cars?|auto|automotive|sedan|suv|truck)\b/i.test(normTopic);
  const topicHasMoto = /\b(motorcycles?|motorbikes?|bikers?)\b/i.test(normTopic);
  const topicHasIndoor = /\b(indoors?)\b/i.test(normTopic);
  const topicHasOutdoor = /\b(outdoors?)\b/i.test(normTopic);

  if (topicHasDog && !topicHasCat && !topicHasPet) requestedAudience = "DOG";
  else if (topicHasCat && !topicHasDog && !topicHasPet) requestedAudience = "CAT";
  else if (topicHasPet || (topicHasDog && topicHasCat)) requestedAudience = "PET_GENERAL";
  else if (topicHasMen && !topicHasWomen) requestedAudience = "MEN";
  else if (topicHasWomen && !topicHasMen) requestedAudience = "WOMEN";
  else if (topicHasKids && !topicHasAdults) requestedAudience = "KIDS";
  else if (topicHasAdults && !topicHasKids) requestedAudience = "ADULTS";
  else if (topicHasCar && !topicHasMoto) requestedAudience = "CAR";
  else if (topicHasMoto && !topicHasCar) requestedAudience = "MOTORCYCLE";
  else if (topicHasIndoor && !topicHasOutdoor) requestedAudience = "INDOOR";
  else if (topicHasOutdoor && !topicHasIndoor) requestedAudience = "OUTDOOR";

  // 2. Detect supportedAudiences & evidence references from candidate text
  const supportedAudiences: TargetCustomerAudience[] = [];
  const evidenceRefs: string[] = [];

  const addAudienceIfMatch = (aud: TargetCustomerAudience, regex: RegExp, label: string) => {
    const m = normText.match(regex);
    if (m && m[0]) {
      if (!supportedAudiences.includes(aud)) supportedAudiences.push(aud);
      evidenceRefs.push(`${label}:"${m[0].trim()}"`);
    }
  };

  addAudienceIfMatch("DOG", /\b(dogs?|pupp(?:y|ies)|canines?)\b/i, "dog_term");
  addAudienceIfMatch("CAT", /\b(cats?|kittens?|felines?|litter\s+box|litter\s+mat)\b/i, "cat_term");
  addAudienceIfMatch("PET_GENERAL", /\b(pets?|fur\s+remover|pet\s+hair|paws?)\b/i, "pet_term");
  addAudienceIfMatch("MEN", /\b(men|mens|men's|for\s+men)\b/i, "men_term");
  addAudienceIfMatch("WOMEN", /\b(women|womens|women's|for\s+women|ladies)\b/i, "women_term");
  addAudienceIfMatch("KIDS", /\b(kids?|children|toddler|baby|babies)\b/i, "kids_term");
  addAudienceIfMatch("ADULTS", /\b(adults?|for\s+adults)\b/i, "adults_term");
  addAudienceIfMatch("CAR", /\b(cars?|automotive|truck|suv)\b/i, "car_term");
  addAudienceIfMatch("MOTORCYCLE", /\b(motorcycles?|motorbikes?)\b/i, "motorcycle_term");
  addAudienceIfMatch("INDOOR", /\b(indoors?)\b/i, "indoor_term");
  addAudienceIfMatch("OUTDOOR", /\b(outdoors?)\b/i, "outdoor_term");

  if (supportedAudiences.length === 0) {
    supportedAudiences.push("UNSPECIFIED");
  }

  // Primary product title / headline check for explicit species lock
  const primaryTitle =
    typeof candidateText === "object" && candidateText
      ? `${candidateText.canonicalProductName || ""} ${candidateText.title || ""}`.toLowerCase()
      : normText.split(/https?:\/\//)[0].toLowerCase();

  const isExplicitlyCatOnlyTitle =
    /\b(cat\s+feeder|cat\s+water\s+fountain|cat\s+fountain|cat\s+litter|cat\s+tree|cat\s+scratcher|cat\s+toy|cat\s+bed|cat\s+collar|cat\s+harness|cat\s+brush|cat\s+carrier|cat\s+house|litter\s+box|litter\s+mat|wet\s+food\s+cat\s+feeder|kitten)\b/i.test(
      primaryTitle
    ) && !/\b(dogs?|pupp(?:y|ies)|canines?)\b/i.test(primaryTitle);

  const isExplicitlyDogOnlyTitle =
    /\b(dog\s+bed|dog\s+harness|dog\s+leash|dog\s+bark|dog\s+collar|dog\s+crate|dog\s+toy|dog\s+feeder|dog\s+water\s+fountain|dog\s+fountain|dog\s+grooming|dog\s+brush|dog\s+coat|dog\s+jacket|dog\s+muzzle|dog\s+ramp|dog\s+stairs|dog\s+car\s+seat|dog\s+chew|puppy\s+pad)\b/i.test(
      primaryTitle
    ) && !/\b(cats?|kittens?|felines?)\b/i.test(primaryTitle);

  if (requestedAudience === "UNSPECIFIED" || requestedAudience === "PET_GENERAL") {
    return {
      requestedAudience,
      supportedAudiences,
      audienceMatch: "COMPATIBLE",
      audienceEvidenceReferences: evidenceRefs,
      relevanceReason: "Target audience is broad or compatible with candidate audience.",
      eligibleForPrimaryShortlist: true,
    };
  }

  if (requestedAudience === "DOG") {
    if (isExplicitlyCatOnlyTitle || (supportedAudiences.includes("CAT") && !supportedAudiences.includes("DOG"))) {
      return {
        requestedAudience,
        supportedAudiences,
        audienceMatch: "CONTRADICTORY",
        audienceEvidenceReferences: evidenceRefs,
        relevanceReason: "Excluded — Product is marketed for cats, while this search targets dogs.",
        eligibleForPrimaryShortlist: false,
      };
    }
    if (supportedAudiences.includes("DOG") && supportedAudiences.includes("CAT")) {
      return {
        requestedAudience,
        supportedAudiences,
        audienceMatch: "COMPATIBLE",
        audienceEvidenceReferences: evidenceRefs,
        relevanceReason: "Multi-pet product explicitly supports both dogs and cats.",
        eligibleForPrimaryShortlist: true,
      };
    }
    if (supportedAudiences.includes("DOG")) {
      return {
        requestedAudience,
        supportedAudiences,
        audienceMatch: "EXACT",
        audienceEvidenceReferences: evidenceRefs,
        relevanceReason: "Product explicitly targets dogs.",
        eligibleForPrimaryShortlist: true,
      };
    }
    if (supportedAudiences.includes("PET_GENERAL")) {
      return {
        requestedAudience,
        supportedAudiences,
        audienceMatch: "COMPATIBLE",
        audienceEvidenceReferences: evidenceRefs,
        relevanceReason: "General pet product compatible with dogs.",
        eligibleForPrimaryShortlist: true,
      };
    }
  }

  if (requestedAudience === "CAT") {
    if (isExplicitlyDogOnlyTitle || (supportedAudiences.includes("DOG") && !supportedAudiences.includes("CAT"))) {
      return {
        requestedAudience,
        supportedAudiences,
        audienceMatch: "CONTRADICTORY",
        audienceEvidenceReferences: evidenceRefs,
        relevanceReason: "Excluded — Product is marketed for dogs, while this search targets cats.",
        eligibleForPrimaryShortlist: false,
      };
    }
    if (supportedAudiences.includes("CAT") && supportedAudiences.includes("DOG")) {
      return {
        requestedAudience,
        supportedAudiences,
        audienceMatch: "COMPATIBLE",
        audienceEvidenceReferences: evidenceRefs,
        relevanceReason: "Multi-pet product explicitly supports both cats and dogs.",
        eligibleForPrimaryShortlist: true,
      };
    }
    if (supportedAudiences.includes("CAT")) {
      return {
        requestedAudience,
        supportedAudiences,
        audienceMatch: "EXACT",
        audienceEvidenceReferences: evidenceRefs,
        relevanceReason: "Product explicitly targets cats.",
        eligibleForPrimaryShortlist: true,
      };
    }
    if (supportedAudiences.includes("PET_GENERAL")) {
      return {
        requestedAudience,
        supportedAudiences,
        audienceMatch: "COMPATIBLE",
        audienceEvidenceReferences: evidenceRefs,
        relevanceReason: "General pet product compatible with cats.",
        eligibleForPrimaryShortlist: true,
      };
    }
  }

  const opposingPairs: Array<[TargetCustomerAudience, TargetCustomerAudience]> = [
    ["MEN", "WOMEN"],
    ["WOMEN", "MEN"],
    ["KIDS", "ADULTS"],
    ["ADULTS", "KIDS"],
    ["CAR", "MOTORCYCLE"],
    ["MOTORCYCLE", "CAR"],
    ["INDOOR", "OUTDOOR"],
    ["OUTDOOR", "INDOOR"],
  ];

  for (const [reqAud, oppAud] of opposingPairs) {
    if (requestedAudience === reqAud) {
      if (supportedAudiences.includes(oppAud) && !supportedAudiences.includes(reqAud)) {
        return {
          requestedAudience,
          supportedAudiences,
          audienceMatch: "CONTRADICTORY",
          audienceEvidenceReferences: evidenceRefs,
          relevanceReason: `Excluded — Product is marketed for ${oppAud.toLowerCase()}, while this search targets ${reqAud.toLowerCase()}.`,
          eligibleForPrimaryShortlist: false,
        };
      }
      if (supportedAudiences.includes(reqAud)) {
        return {
          requestedAudience,
          supportedAudiences,
          audienceMatch: supportedAudiences.includes(oppAud) ? "COMPATIBLE" : "EXACT",
          audienceEvidenceReferences: evidenceRefs,
          relevanceReason: `Product supports requested target audience (${reqAud.toLowerCase()}).`,
          eligibleForPrimaryShortlist: true,
        };
      }
    }
  }

  return {
    requestedAudience,
    supportedAudiences,
    audienceMatch: supportedAudiences.includes(requestedAudience) ? "EXACT" : "UNKNOWN",
    audienceEvidenceReferences: evidenceRefs,
    relevanceReason: "No contradictory target customer audience detected.",
    eligibleForPrimaryShortlist: true,
  };
}

export function evaluateProductRelevance(
  candidateText: CandidateTextInput,
  topic?: string,
  options?: EvaluateProductRelevanceOptions
): RelevanceEvaluationResult {
  const resolvedTopic =
    topic ||
    (typeof candidateText === "object" && candidateText ? candidateText.topic || "" : "");
  const audienceRelevance = evaluateProductAudienceRelevance(candidateText, resolvedTopic);
  const core = evaluateProductRelevanceCore(candidateText, resolvedTopic, options, audienceRelevance);
  return {
    ...core,
    audienceRelevance: core.audienceRelevance || audienceRelevance,
  };
}

function evaluateProductRelevanceCore(
  candidateText: CandidateTextInput,
  topic: string,
  options?: EvaluateProductRelevanceOptions,
  precomputedAudience?: ProductAudienceRelevance
): RelevanceEvaluationResult {
  const normalizedTopic = (topic || "").toLowerCase().trim();
  const normalizedText = normalizeCandidateTextInput(candidateText).toLowerCase().trim();
  const reasons: string[] = [];
  const audienceRelevance = precomputedAudience || evaluateProductAudienceRelevance(candidateText, topic);

  if (!normalizedText || normalizedText.length < 2) {
    return {
      relevanceStatus: "IRRELEVANT",
      discoveryDecision: "CLEARLY_UNRELATED",
      isAccepted: false,
      score: 0.05,
      reasons: ["Candidate text is empty or too short."],
      topic,
      matchedArchetypeId: null,
      audienceRelevance,
    };
  }

  // V12.4.3.2 Section 5: Enforce strict target customer / species audience compatibility
  if (!audienceRelevance.eligibleForPrimaryShortlist) {
    return {
      relevanceStatus: "IRRELEVANT",
      discoveryDecision: "CLEARLY_UNRELATED",
      isAccepted: false,
      score: 0.08,
      reasons: [audienceRelevance.relevanceReason],
      topic,
      matchedArchetypeId: null,
      audienceRelevance,
    };
  }

  // V12.4.3.3: Reject non-physical entity types (services, courses, digital products, apps)
  if (
    typeof candidateText === "object" &&
    candidateText !== null &&
    ((candidateText as any).entityType === "SERVICE_OR_COURSE" ||
      (candidateText as any).entityType === "DIGITAL_PRODUCT" ||
      (candidateText as any).entityType === "NON_ECOMMERCE")
  ) {
    return {
      relevanceStatus: "IRRELEVANT",
      discoveryDecision: "CLEARLY_UNRELATED",
      isAccepted: false,
      score: 0.05,
      reasons: [
        `Rejected non-physical entityType '${(candidateText as any).entityType}' under PHYSICAL_ECOMMERCE_PRODUCTS policy.`,
      ],
      topic,
      matchedArchetypeId: null,
      audienceRelevance,
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
  const GENERIC_CATEGORY_SUFFIX_WORDS = new Set([
    "accessories",
    "accessory",
    "gadgets",
    "gadget",
    "tools",
    "tool",
    "supplies",
    "supply",
    "products",
    "product",
    "items",
    "item",
    "equipment",
    "gear",
  ]);
  const rawTopicWords = normalizedTopic.split(/\s+/).filter((w) => w.length > 2);
  const coreTopicWords = rawTopicWords.filter(
    (w) => !GENERIC_CATEGORY_SUFFIX_WORDS.has(w)
  );
  const topicWords = coreTopicWords.length > 0 ? coreTopicWords : rawTopicWords;
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
      /\b(cat water fountain|dog grooming|litter mat|dogs?|pupp(?:y|ies)|cats?|kittens?|pets?)\b/i.test(normalizedTopic)
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

    // V12.4.3.3.1 G09/G10: Reject consumable pet food, starter kits, bundles, treats & dietary supplements
    // unless the product is an actual feeding/hydration hardware device (e.g., automatic feeder, water fountain).
    if (nicheKey === "pet") {
      const isConsumablePetFoodOrSupplement =
        /\b(dog\s+food|cat\s+food|pet\s+food|cooked\s+dog\s+food|shelf[-_\s]stable\s+dog\s+food|raw\s+dog\s+food|freeze[-_\s]dried\s+(?:dog|cat|pet)\s+food|food\s+starter\s+kit|food\s+bundle|kibble|dog\s+treats?|cat\s+treats?|pet\s+supplement|dog\s+supplement|probiotic\s+chews?|hip\s+and\s+joint\s+chews?|multivitamin\s+chews?)\b/i.test(
          normalizedText
        );
      const isFeedingHardwareDevice =
        /\b((?:automatic|smart|timed|electronic|programmable)\s+(?:pet|cat|dog)?\s*feeder|(?:pet|cat|dog)\s+feeder|food\s+dispenser|meal\s+dispenser|water\s+fountain|drinking\s+fountain|slow\s+feeder\s+bowl)\b/i.test(
          normalizedText
        );
      if (isConsumablePetFoodOrSupplement && !isFeedingHardwareDevice) {
        reasons.push(
          "Excluded — Consumable pet food, treats, or dietary supplement rather than a physical pet gadget or durable accessory."
        );
        return {
          relevanceStatus: "IRRELEVANT",
          discoveryDecision: "CLEARLY_UNRELATED",
          isAccepted: false,
          score: 0.08,
          reasons,
          topic,
          matchedArchetypeId: null,
        };
      }

      // V12.4.3.3.1 WS-C (Section 7.1): Exclude passive plush/squeaky/chew/stuffed/rope toys from 'Pet Gadgets'
      // unless they have electronic, smart, automated, dispensing, grooming, or hardware gadget indicators
      // (while still accepting them when the topic targets 'Pet Toys' / 'Dog Toys' / 'Cat Toys').
      const isGadgetSubNicheTopic =
        /\bgadgets?\b/i.test(normalizedTopic) && !/\btoys?\b/i.test(normalizedTopic);
      if (isGadgetSubNicheTopic) {
        const isPassivePlushOrChewToy =
          /\b(plush|squeak(?:y|er)?|stuffed\s+toy|chew\s+toy|chew[-_\s]resistant[^.|]*?\btoy|bite[-_\s]resistant[^.|]*?\btoy|rope\s+toy|crinkle\s+toy|plush\s+(?:pet|dog|cat|puppy|kitten)?\s*toy|squeaky\s+(?:pet|dog|cat|puppy|kitten)?\s*toy|fetch\s+ball|tennis\s+ball|catnip\s+toy)\b/i.test(
            normalizedText
          );
        const hasActiveGadgetOrHardwareIndicator =
          /\b(electronic|electric|smart|automatic|automated|rechargeable|usb|battery[-_\s]operated|motorized|motion[-_\s]activated|sensor|laser|ball\s+launcher|launcher|treat[-_\s]dispens(?:er|ing)|food[-_\s]dispens(?:er|ing)|feeder|fountain|gps|tracker|camera|collar|bark\s+(?:collar|control|deterrent)|ultrasonic|grooming|vacuum|nail\s+grinder|trimmer|clipper|deshedding|hair\s+remover|fur\s+remover|led)\b/i.test(
            normalizedText
          );
        if (isPassivePlushOrChewToy && !hasActiveGadgetOrHardwareIndicator) {
          reasons.push(
            "Excluded — Passive plush, squeaky, or chew pet toy lacks electronic, smart, automated, dispensing, grooming, or hardware gadget functionality required for 'Pet Gadgets'."
          );
          return {
            relevanceStatus: "IRRELEVANT",
            discoveryDecision: "CLEARLY_UNRELATED",
            isAccepted: false,
            score: 0.08,
            reasons,
            topic,
            matchedArchetypeId: null,
          };
        }
      }
    }

    // V12.4.3.3.1 WS-C (Section 7.4): Exclude decorative wallpaper, wall decals, wall murals, and peel-and-stick decor
    // materials from DIY / DIY Tools unless the product is an actual tool or hardware applicator.
    if (nicheKey === "diy") {
      const isDecorativeWallMaterial =
        /\b(wallpapers?|wall\s+decals?|wall\s+murals?|wall\s+art|wall\s+tapestry|peel[-_\s]and[-_\s]stick\s+wallpaper|contact\s+paper|window\s+film|decorative\s+film)\b/i.test(
          normalizedText
        );
      const isActualDiyToolOrHardware =
        /\b(tool|tools|scraper|stripper|steamer|roller|smoother|squeegee|cutter|knife|seam\s+roller|paste\s+brush|laser\s+level|glue\s+gun|drill|driver|saw|clamp|jig|sander|multimeter|soldering|wrench|pliers|caulking\s+tool)\b/i.test(
          normalizedText
        );
      if (isDecorativeWallMaterial && !isActualDiyToolOrHardware) {
        reasons.push(
          "Excluded — Decorative wallpaper, wall decal, or surface covering material rather than a functional DIY tool or hardware."
        );
        return {
          relevanceStatus: "IRRELEVANT",
          discoveryDecision: "CLEARLY_UNRELATED",
          isAccepted: false,
          score: 0.08,
          reasons,
          topic,
          matchedArchetypeId: null,
        };
      }
    }

    // V12.4.3.3.1 G09/G10/G26: Require automotive/vehicle context for 'car' niche
    if (nicheKey === "car") {
      const hasAutomotiveContext =
        /\b(cars?|auto|automotive|vehicles?|trucks?|suvs?|sedans?|windshield|dashboard|dash\s*cam|dashcam|trunk|steering\s+wheel|tires?|headrest|seat\s+gap|blind\s+spot|jump\s+starter|obd)\b/i.test(
          normalizedText
        );
      if (!hasAutomotiveContext) {
        reasons.push(
          "Excluded — Product lacks automotive or vehicle context required for Car Accessories."
        );
        return {
          relevanceStatus: "IRRELEVANT",
          discoveryDecision: "CLEARLY_UNRELATED",
          isAccepted: false,
          score: 0.08,
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

      if (hasGenericDevice && !hasCorePetContext && !(/\b(feeder|food\s+dispenser)\b/i.test(normalizedTopic) && !/\b(feeder|food\s+dispenser)\b/i.test(normalizedText))) {
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


      // Specific-product query gates (F08): prevent sibling niche products from matching a specific product request
      const isSpecificPetFeederQuery = /\b(pet\s+feeder|cat\s+feeder|dog\s+feeder|automatic\s+pet\s+feeder|automatic\s+cat\s+feeder|automatic\s+dog\s+feeder|smart\s+pet\s+feeder|pet\s+food\s+dispenser)\b/i.test(normalizedTopic);
      if (isSpecificPetFeederQuery) {
        const hasFeederTerm = /\b(feeder|food\s+dispenser|meal\s+dispenser|feeding\s+station|timed\s+meal|wet\s+food.*feeder|auto-cool.*auto-warm|smarter\s+feeding|feed\s+fresh|fresh\s+meals|mealtime|uahpet)\b/i.test(normalizedText);
        const hasSiblingNonFeederTerm = /\b(water\s+fountain|cat\s+fountain|pet\s+fountain|hydration\s+fountain|dockstream|hair\s+remover|hair\/lint|lint\s+roller|lint\s+cleaner|dust\s+cleaner|fur\s+remover|uproot\s+cleaner|chomchom|deshedding\s+brush|grooming\s+brush|grooming\s+vacuum|dog\s+bed|cat\s+bed|calming\s+bed|orthopedic\s+bed|litter\s+mat|litter\s+box|nail\s+grinder|seat\s+belt|car\s+harness|bark\s+collar)\b/i.test(normalizedText);
        if (hasFeederTerm && !hasSiblingNonFeederTerm) {
          reasons.push(`Matches specific requested product family 'pet_feeder' for query '${topic}'.`);
          return {
            relevanceStatus: "RELEVANT",
            discoveryDecision: "HIGH_RELEVANCE",
            isAccepted: true,
            score: 0.95,
            reasons,
            topic,
            matchedArchetypeId: "pet_feeding_hydration",
          };
        }
        reasons.push(`Candidate belongs to a sibling or unrelated product family and does not match specific product query '${topic}'.`);
        return {
          relevanceStatus: "IRRELEVANT",
          discoveryDecision: "CLEARLY_UNRELATED",
          isAccepted: false,
          score: 0.08,
          reasons,
          topic,
          matchedArchetypeId: null,
        };
      }

      const isSpecificWaterFountainQuery = /\b(cat\s+water\s+fountain|pet\s+water\s+fountain|dog\s+water\s+fountain|wireless\s+cat\s+fountain|stainless\s+steel\s+cat\s+fountain)\b/i.test(normalizedTopic);
      if (isSpecificWaterFountainQuery) {
        const hasFountainTerm = /\b(water\s+fountain|cat\s+fountain|pet\s+fountain|dog\s+fountain|hydration\s+fountain|dockstream|water\s+dispenser|drinking\s+fountain)\b/i.test(normalizedText);
        const hasSiblingNonFountainTerm = /\b(pet\s+feeder|cat\s+feeder|dog\s+feeder|wet\s+food.*feeder|food\s+dispenser|meal\s+dispenser|hair\s+remover|hair\/lint|lint\s+roller|lint\s+cleaner|dust\s+cleaner|fur\s+remover|uproot\s+cleaner|chomchom|dog\s+bed|cat\s+bed|calming\s+bed|litter\s+mat|litter\s+box)\b/i.test(normalizedText);
        if (hasFountainTerm && !hasSiblingNonFountainTerm) {
          reasons.push(`Matches specific requested product family 'water_fountain' for query '${topic}'.`);
          return {
            relevanceStatus: "RELEVANT",
            discoveryDecision: "HIGH_RELEVANCE",
            isAccepted: true,
            score: 0.95,
            reasons,
            topic,
            matchedArchetypeId: "pet_feeding_hydration",
          };
        }
        reasons.push(`Candidate belongs to a sibling or unrelated product family and does not match specific product query '${topic}'.`);
        return {
          relevanceStatus: "IRRELEVANT",
          discoveryDecision: "CLEARLY_UNRELATED",
          isAccepted: false,
          score: 0.08,
          reasons,
          topic,
          matchedArchetypeId: null,
        };
      }

      const isSpecificGlueGunQuery = /\b(glue\s+gun|hot\s+melt\s+glue)\b/i.test(normalizedTopic);
      if (isSpecificGlueGunQuery) {
        const hasGlueGunTerm = /\b(glue\s+gun|hot\s+melt|glue\s+stick)\b/i.test(normalizedText);
        if (hasGlueGunTerm) {
          reasons.push(`Matches specific requested product family 'glue_gun' for query '${topic}'.`);
          return {
            relevanceStatus: "RELEVANT",
            discoveryDecision: "HIGH_RELEVANCE",
            isAccepted: true,
            score: 0.95,
            reasons,
            topic,
            matchedArchetypeId: "diy_fastening_bonding",
          };
        }
        reasons.push(`Candidate does not match specific product query '${topic}'.`);
        return {
          relevanceStatus: "IRRELEVANT",
          discoveryDecision: "CLEARLY_UNRELATED",
          isAccepted: false,
          score: 0.08,
          reasons,
          topic,
          matchedArchetypeId: null,
        };
      }

      const isSpecificPlantSpikeQuery = /\b(plant\s+spike|watering\s+spike|self-watering\s+plant\s+spike|watering\s+globe)\b/i.test(normalizedTopic);
      if (isSpecificPlantSpikeQuery) {
        const hasSpikeTerm = /\b(plant\s+spike|watering\s+spike|self-watering|self\s+watering|watering\s+globe|plant\s+waterer|drip\s+spike|terracotta\s+watering)\b/i.test(normalizedText);
        if (hasSpikeTerm) {
          reasons.push(`Matches specific requested product family 'plant_spike' for query '${topic}'.`);
          return {
            relevanceStatus: "RELEVANT",
            discoveryDecision: "HIGH_RELEVANCE",
            isAccepted: true,
            score: 0.95,
            reasons,
            topic,
            matchedArchetypeId: "gardening_irrigation",
          };
        }
        reasons.push(`Candidate does not match specific product query '${topic}'.`);
        return {
          relevanceStatus: "IRRELEVANT",
          discoveryDecision: "CLEARLY_UNRELATED",
          isAccepted: false,
          score: 0.08,
          reasons,
          topic,
          matchedArchetypeId: null,
        };
      }

      const isSpecificSpinScrubberQuery = /\b(spin\s+scrubber|electric\s+scrubber|power\s+scrubber)\b/i.test(normalizedTopic);
      if (isSpecificSpinScrubberQuery) {
        const hasScrubberTerm = /\b(spin\s+scrubber|electric\s+scrubber|power\s+scrubber|cleaning\s+brush|rotary\s+scrubber)\b/i.test(normalizedText);
        if (hasScrubberTerm) {
          reasons.push(`Matches specific requested product family 'spin_scrubber' for query '${topic}'.`);
          return {
            relevanceStatus: "RELEVANT",
            discoveryDecision: "HIGH_RELEVANCE",
            isAccepted: true,
            score: 0.95,
            reasons,
            topic,
            matchedArchetypeId: "cleaning_power_tools",
          };
        }
        reasons.push(`Candidate does not match specific product query '${topic}'.`);
        return {
          relevanceStatus: "IRRELEVANT",
          discoveryDecision: "CLEARLY_UNRELATED",
          isAccepted: false,
          score: 0.08,
          reasons,
          topic,
          matchedArchetypeId: null,
        };
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
    !nicheKey &&
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
