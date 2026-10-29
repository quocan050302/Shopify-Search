/**
 * SWAI KH-02 V12.3 — Ad Headline & Copy Classifier
 *
 * Distinguishes genuine product names from advertising copy, promotional calls-to-action (CTAs),
 * clickbait hooks, campaign codes, and raw internal SKU codes.
 *
 * Non-negotiable invariant (Section 7, Directives 79 & 85):
 * Raw ad creative headers (e.g. "Facebook Ad: 893760707134895"), promotional hooks,
 * clickbait hooks ("Hidden Dangers"), campaign codes ("Ad50fb"), or raw SKU codes ("Wmt004 1")
 * must NEVER be accepted as verified product names.
 */

export type HeadlineClass =
  | "AD_IDENTIFIER"        // e.g. "Facebook Ad: 893760707134895", "Ad ID: 12345"
  | "PROMOTIONAL_CTA"      // e.g. "Sign up now for 50% off your order!", "Shop Now & Save", "Free Shipping"
  | "CLICKBAIT_HOOK"       // e.g. "Hidden Dangers", "You won't believe this dog gadget!", "Why vets hate this"
  | "CAMPAIGN_CODE"        // e.g. "Ad50fb", "fb_camp_01", "lp_v2_test"
  | "INTERNAL_SKU_CODE"    // e.g. "Wmt004 1", "SKU12345", "Item-098" (isolated alphanumeric SKU with no product noun)
  | "GENERIC_CATEGORY"     // e.g. "Pet Supplies", "Dog Accessories", "Pet Gadgets"
  | "PRODUCT_CANDIDATE";   // e.g. "Ultrasonic Dog Bark Deterrent", "Pet Grooming Gloves"

export interface AdHeadlineClassification {
  rawHeadline: string;
  classification: HeadlineClass;
  headlineClass: HeadlineClass; // Ergonomic alias
  headlineType?: HeadlineClass; // Ergonomic alias
  isEligibleProductName: boolean;
  isEligibleAsProductName: boolean; // Ergonomic alias
  isProductCandidate: boolean; // Ergonomic alias
  cleanTitle: string | null;
  normalizedCleanText: string; // Ergonomic alias
  cleanedCandidateTitle?: string | null; // Ergonomic alias
  adIdentifier: string | null;
  extractedModelOrSku?: string | null;
  extractedModel?: string | null; // Ergonomic alias
  extractedCampaignCode?: string | null; // Ergonomic alias
  productType?: string | null;
  brand?: string | null;
  confidence: number; // 0.0 - 1.0 (Product candidate confidence)
  reason: string;
}

const AD_IDENTIFIER_REGEXES = [
  /^(facebook|fb|meta|instagram|ig|tiktok|tt|google)\s+ad\s*[:#-]?\s*(\d+)/i,
  /^ad\s*(id|#|number)\s*[:#-]?\s*(\d+)/i,
  /^creative\s*(id|#|number)\s*[:#-]?\s*(\d+)/i,
  /^library\s*(id|#|number)\s*[:#-]?\s*(\d+)/i,
  /^\d{10,25}$/, // Pure numeric ID
];

const PROMOTIONAL_CTA_PATTERNS = [
  /\b(sign\s*up\s*(now|today)?\s*(for)?\s*\d+%\s*off)\b/i,
  /\b(get\s*\d+%\s*off\s*(your\s*order|today)?)\b/i,
  /\b(up\s*to\s*\d+%\s*off)\b/i,
  /\b(buy\s*1\s*get\s*1\s*(free)?)\b/i,
  /\b(bogo\s*(sale)?)\b/i,
  /\b(limited\s*time\s*offer)\b/i,
  /\b(order\s*(now|today)\s*(&|and)?\s*save)\b/i,
  /\b(shop\s*(now|today|the\s*sale)?)\b/i,
  /\b(click\s*here\s*(to)?\s*(buy|shop|order)?)\b/i,
  /\b(free\s*shipping\s*(on|worldwide|all\s*orders)?)\b/i,
  /\b(claim\s*your\s*discount)\b/i,
  /\b(exclusive\s*discount|flash\s*sale)\b/i,
  /\b(dont\s*miss\s*out|don't\s*miss\s*out)\b/i,
  /\b(while\s*supplies\s*last)\b/i,
  /\b(best\s*price\s*guaranteed)\b/i,
  /\b(satisfaction\s*guaranteed)\b/i,
  /^(get\s*halloween\s*ready|get\s*latest\s*price|halloween\s*sale|holiday\s*deals)[!.\s]*$/i,
];

const CLICKBAIT_HOOK_PATTERNS = [
  /\b(hidden\s+dangers?|silent\s+killers?|shocking\s+truth|warning\s+to\s+all|what\s+they\s+don'?t\s+tell\s+you|why\s+vets\s+are\s+furious|deadly\s+mistakes?|the\s+truth\s+about)\b/i,
  /\b(you\s*(won't|wont)\s*believe)\b/i,
  /\b(tiktok\s*(made\s*me\s*buy\s*it|viral\s*find))\b/i,
  /\b(the\s*secret\s*(all|every)\s*(dog|cat|pet)\s*owners?\s*need)\b/i,
  /\b(this\s*(one\s*trick|life\s*hack))\b/i,
  /\b(why\s*(vets?|experts?|everyone)\s*(is|are)\s*talking\s*about)\b/i,
  /\b(say\s*goodbye\s*to\s*[^.!?]+forever)\b/i,
];

// Campaign and experiment tracking code patterns: e.g. "Ad50fb", "fb_camp_01", "ad12_test"
const CAMPAIGN_CODE_PATTERNS = [
  /^ad\d+[a-z0-9_-]*$/i, // e.g. "Ad50fb", "ad12", "ad50_test"
  /^(fb|ig|tt|meta|camp|campaign|creative|var|variant|test|lp|slug)[-_]?\d+[a-z0-9_-]*$/i,
  /^(fb|ig|tt|meta|camp|campaign|creative|test|lp|slug)[-_].*$/i, // e.g. "fb_campaign_v3", "lp_pet_test_02"
  /^[a-z]{1,4}\d{1,4}[a-z]{1,4}\d*$/i, // e.g. "Ad50fb", "fb10a"
  /[a-z0-9_-]*(offer|variant|campaign|lp)[-_]\d+[a-z0-9_-]*/i, // e.g. "pet_offer_variant_08", "lp_test_v4", "fb_campaign_02"
];

// Internal warehouse / SKU tracking codes without product nouns: e.g. "Wmt004 1", "WMT004-1", "SKU12345", "GG002 L1"
const INTERNAL_SKU_CODE_PATTERNS = [
  /^[a-z]{2,5}\d{2,}[-_ ]?\d*$/i, // e.g. "Wmt004 1", "WMT004-1", "Wmt008"
  /^(sku|item|prod|p)[-_ ]?\d{2,}[-_ ]?\d*$/i, // e.g. "SKU12345", "Item-004"
  /^[a-z0-9]{2,4}[-_ ]\d{2,}[-_ ]?[a-z0-9]*$/i, // e.g. "GG-002-L1", "GG002 L1"
  /^[a-z]{1,4}\d{2,4}\s+[a-z0-9]{1,4}$/i, // e.g. "GG002 L1"
];

// Recognized concrete product item/category nouns
const KNOWN_PRODUCT_NOUNS = new Set([
  "glove", "gloves", "cleaner", "roller", "brush", "remover", "bed", "collar",
  "feeder", "leash", "harness", "bowl", "clipper", "tracker", "deterrent",
  "trimmer", "fountain", "carrier", "toy", "dispenser", "mat", "pad", "vest",
  "jacket", "sweater", "muzzle", "cage", "crate", "pen", "stroller", "backpack",
  "camera", "monitor", "bell", "tag", "tagger", "scratcher", "post", "litter",
  "box", "scoop", "bag", "seat", "cover", "gate", "door", "ramp", "stairs",
  "ladder", "fence", "lead", "trainer", "whistle", "dryer", "bath", "tub",
  "towel", "blanket", "cushion", "pillow", "house", "tent", "bottle", "cup",
  "dish", "scale", "thermometer", "nail", "comb", "shampoo", "soap", "spray",
  "wipes", "treat", "chew", "bone", "device", "gadget", "machine", "robot",
  "sensor", "lamp", "light", "massager", "scrubber", "vacuum", "purifier",
  "humidifier", "diffuser", "filter", "tool", "kit", "set", "pack", "organizer",
  "holder", "stand", "mount", "case", "sleeve", "pouch", "strap", "clip",
  "hook", "lock", "alarm", "razor", "shaver", "headphone", "headphones",
  "earbuds", "watch", "speaker", "charger", "cable", "adaptor", "adapter",
  "covers", "plate", "plates", "sticker", "stickers", "panel", "panels",
  "tiles", "gun", "cutter", "jig", "clamp", "marker", "markers", "spikes",
  "shears", "tray", "trellis", "meter", "chopper", "slicer", "sprayer",
  "strainer", "sealer", "mop", "sconce", "slipcover", "mask", "patch",
  "curler", "wand", "multimeter", "grinder", "opener", "sharpener", "board",
  "liner", "rack", "duster", "hose", "nozzle", "planter", "pot", "bin",
  "level", "drill", "driver", "saw", "wrench", "pliers", "sander", "tape",
  "throw", "rug", "curtain", "vase", "mirror", "clock", "frame", "shelf",
  "basket", "jar", "canister", "tongs", "whisk", "spatula", "peeler",
  "grater", "colander", "kettle", "mug", "tumbler", "thermos", "coaster",
  "apron", "pan", "skillet", "launcher",
  "wallpaper", "decal", "paste", "putty", "spackle", "caulk", "sealant",
  "wallet", "mandoline", "dicer", "crusher", "mincer", "masher", "corer",
  "zester", "tenderizer", "frother", "infuser", "warmer", "cooler", "steamer",
  "cooker", "fryer", "toaster", "blender", "mixer", "juicer", "dehydrator",
  "timer", "mold", "mould", "stopper", "trivet", "caddy", "sponge", "wiper",
  "squeegee", "plunger", "auger", "hammer", "mallet", "chisel", "vise",
  "torch", "welder", "stapler", "nailer", "trowel", "scraper", "stencil",
  "dashcam", "inflator", "compressor", "inverter", "sunshade", "visor",
  "defroster", "headrest", "trashcan", "detangler", "deshedder", "aquarium",
  "terrarium", "perch", "tunnel", "teaser", "clicker", "bootie", "booties",
  "goggles", "bandana"
]);

// Generic non-product category terms (including versioned generic terms e.g. "Pet Product V4")
const GENERIC_CATEGORY_PATTERNS = [
  /^(pet\s+(gadgets?|products?|supplies|accessories|items?|stuff))(\s+v\d+)?$/i,
  /^(dog\s+(gadgets?|products?|supplies|accessories|items?|stuff))(\s+v\d+)?$/i,
  /^(cat\s+(gadgets?|products?|supplies|accessories|items?|stuff))(\s+v\d+)?$/i,
  /^(best\s+pet\s+(gadgets?|finds?|items?))(\s+v\d+)?$/i,
  /^(store\s+home\s*page|official\s+store|catalog)$/i,
];

/**
 * Internal raw headline classifier.
 */
function classifyAdvertisingHeadlineRaw(headline: string | null | undefined): {
  rawHeadline: string;
  classification: HeadlineClass;
  headlineClass?: HeadlineClass;
  isEligibleProductName: boolean;
  isEligibleAsProductName?: boolean;
  cleanTitle: string | null;
  normalizedCleanText?: string;
  adIdentifier?: string | null;
  extractedModelOrSku?: string | null;
  confidence: number;
  reason: string;
} {
  if (!headline || !headline.trim()) {
    return {
      rawHeadline: "",
      classification: "AD_IDENTIFIER",
      headlineClass: "AD_IDENTIFIER",
      isEligibleProductName: false,
      isEligibleAsProductName: false,
      cleanTitle: null,
      normalizedCleanText: "",
      adIdentifier: null,
      confidence: 1.0,
      reason: "Empty or whitespace headline",
    };
  }

  const raw = headline.trim();

  // 1. Check for raw Ad Library identifiers
  for (const regex of AD_IDENTIFIER_REGEXES) {
    const match = raw.match(regex);
    if (match) {
      const adId = match[2] || match[1] || match[0];
      return {
        rawHeadline: raw,
        classification: "AD_IDENTIFIER",
        headlineClass: "AD_IDENTIFIER",
        isEligibleProductName: false,
        isEligibleAsProductName: false,
        cleanTitle: null,
        normalizedCleanText: "",
        adIdentifier: adId,
        confidence: 0.98,
        reason: `Matched raw ad creative identifier pattern: ${match[0]}`,
      };
    }
  }

  // 2. Check for Promotional Call-to-Actions (CTAs)
  for (const pattern of PROMOTIONAL_CTA_PATTERNS) {
    if (pattern.test(raw)) {
      return {
        rawHeadline: raw,
        classification: "PROMOTIONAL_CTA",
        headlineClass: "PROMOTIONAL_CTA",
        isEligibleProductName: false,
        isEligibleAsProductName: false,
        cleanTitle: null,
        normalizedCleanText: "",
        adIdentifier: null,
        confidence: 0.95,
        reason: `Matched promotional discount or CTA pattern: ${pattern.source}`,
      };
    }
  }

  // 3. Check for Clickbait / Editorial Hooks (e.g. "Hidden Dangers")
  for (const pattern of CLICKBAIT_HOOK_PATTERNS) {
    if (pattern.test(raw)) {
      return {
        rawHeadline: raw,
        classification: "CLICKBAIT_HOOK",
        headlineClass: "CLICKBAIT_HOOK",
        isEligibleProductName: false,
        isEligibleAsProductName: false,
        cleanTitle: null,
        normalizedCleanText: "",
        adIdentifier: null,
        confidence: 0.95,
        reason: `Matched viral clickbait / fear-appeal hook: ${pattern.source}`,
      };
    }
  }

  // 4. Check for Campaign Codes (e.g. "Ad50fb")
  for (const pattern of CAMPAIGN_CODE_PATTERNS) {
    if (pattern.test(raw)) {
      return {
        rawHeadline: raw,
        classification: "CAMPAIGN_CODE",
        headlineClass: "CAMPAIGN_CODE",
        isEligibleProductName: false,
        isEligibleAsProductName: false,
        cleanTitle: null,
        normalizedCleanText: "",
        adIdentifier: null,
        confidence: 0.96,
        reason: `Matched advertising campaign or experiment tracking code: ${raw}`,
      };
    }
  }

  // 5. Check for Internal Warehouse / SKU codes without product nouns (e.g. "Wmt004 1", "GG002 L1")
  for (const pattern of INTERNAL_SKU_CODE_PATTERNS) {
    if (pattern.test(raw)) {
      return {
        rawHeadline: raw,
        classification: "INTERNAL_SKU_CODE",
        headlineClass: "INTERNAL_SKU_CODE",
        isEligibleProductName: false,
        isEligibleAsProductName: false,
        cleanTitle: null,
        normalizedCleanText: "",
        adIdentifier: null,
        confidence: 0.94,
        reason: `Matched internal warehouse SKU or inventory tracking code: ${raw}`,
      };
    }
  }

  // 5.5 Check for Compound Campaign / SKU sequences lacking concrete product nouns (e.g. "Wmt008 L4v2 Mustyclothes")
  const hasConcreteNoun = containsKnownProductNoun(raw);
  const words = raw.split(/[\s\-_]+/);
  const firstWord = words[0] || "";
  const isSkuOrCampaignPrefix = /^[a-z]{1,5}\d{2,}[a-z0-9]*$/i.test(firstWord) || /^(sku|item|prod|wmt|gg|ad|fb|lp|test)\d*/i.test(firstWord);
  const hasExperimentToken = /\b(l\d+v\d+|v\d+|test[-_]?\d+|camp[-_]?\d+|lp[-_]?\d+)\b/i.test(raw);

  if (!hasConcreteNoun && (isSkuOrCampaignPrefix || hasExperimentToken)) {
    return {
      rawHeadline: raw,
      classification: isSkuOrCampaignPrefix ? "INTERNAL_SKU_CODE" : "CAMPAIGN_CODE",
      headlineClass: isSkuOrCampaignPrefix ? "INTERNAL_SKU_CODE" : "CAMPAIGN_CODE",
      isEligibleProductName: false,
      isEligibleAsProductName: false,
      cleanTitle: null,
      normalizedCleanText: "",
      adIdentifier: null,
      confidence: 0.96,
      reason: `Matched compound campaign experiment code or SKU sequence without product noun: '${raw}'`,
    };
  }

  // 6. Check for Generic Categories (e.g. "Pet Gadgets", "Pet Product V4")
  for (const pattern of GENERIC_CATEGORY_PATTERNS) {
    if (pattern.test(raw)) {
      return {
        rawHeadline: raw,
        classification: "GENERIC_CATEGORY",
        headlineClass: "GENERIC_CATEGORY",
        isEligibleProductName: false,
        isEligibleAsProductName: false,
        cleanTitle: null,
        normalizedCleanText: "",
        adIdentifier: null,
        confidence: 0.92,
        reason: `Matched generic category phrase without specific product noun: ${raw}`,
      };
    }
  }

  // 7. Strip common promotional suffix tags & leading superlatives
  let cleaned = raw;
  cleaned = cleaned.replace(/\s*[-–|:]\s*(Buy Now|Shop Now|\d+%\s*Off|Free Shipping|Sale|Official Store|Best Seller).*$/i, "");
  cleaned = cleaned.replace(/^(NEW|HOT|MUST HAVE|VIRAL|SALE)\s*[:!-]\s*/i, "");
  // Strip leading "#1", "The #1", "Top 10 Rated" without stripping capacity/dimension numbers like "500ml", "16oz", "2-in-1"
  cleaned = cleaned.replace(
    /^(?:(?:the\s+)?#\d+(?:\s+in\s+the\s+world|\s+rated|\s+best|\s+top)?|(?:the\s+)?\d+\s+(?:in\s+the\s+world|rated|best|top))\b\s*[-–:]?\s*/i,
    ""
  );
  cleaned = cleaned.replace(/[!]{2,}/g, "!");
  cleaned = cleaned.trim();

  // If after cleaning it becomes too short, reject
  if (cleaned.length < 4) {
    return {
      rawHeadline: raw,
      classification: "PROMOTIONAL_CTA",
      headlineClass: "PROMOTIONAL_CTA",
      isEligibleProductName: false,
      isEligibleAsProductName: false,
      cleanTitle: null,
      normalizedCleanText: "",
      adIdentifier: null,
      confidence: 0.85,
      reason: "Headline too short after stripping promotional tags",
    };
  }

  // 8. Extract Model / SKU suffix from legitimate product titles (e.g. "Grooming Gloves Gg002 L1", "Pet Grooming Vacuum V3", "Automatic Feeder X200")
  let extractedModelOrSku: string | null = null;
  const modelSuffixMatch = cleaned.match(/\s+([A-Za-z]{1,4}\d{1,4}(?:\s+[A-Za-z0-9]{1,4})?|\d{1,2}[A-Za-z]|[A-Za-z]\d{1,3})$/i);
  if (modelSuffixMatch && modelSuffixMatch.index) {
    const candidateBase = cleaned.slice(0, modelSuffixMatch.index).trim();
    // Only strip model if base contains at least 1 known product noun or 2 words with product noun
    if (containsKnownProductNoun(candidateBase) || candidateBase.split(/\s+/).length >= 2) {
      extractedModelOrSku = modelSuffixMatch[1];
      cleaned = candidateBase;
    }
  }

  // 9. Noun validation & abstract phrase check
  // Check if cleaned string contains at least one concrete product noun
  const hasProductNoun = containsKnownProductNoun(cleaned);
  const wordCount = cleaned.split(/\s+/).length;

  // If it has NO recognized product noun and has code-like or experiment features after cleaning
  if (!hasProductNoun) {
    if (isSkuOrCampaignPrefix || hasExperimentToken) {
      return {
        rawHeadline: raw,
        classification: "INTERNAL_SKU_CODE",
        headlineClass: "INTERNAL_SKU_CODE",
        isEligibleProductName: false,
        isEligibleAsProductName: false,
        cleanTitle: null,
        normalizedCleanText: "",
        adIdentifier: null,
        confidence: 0.95,
        reason: `Alphanumeric campaign or SKU code lacking concrete product noun: '${cleaned}'`,
      };
    }

    // Check if it's an abstract concept or hook (e.g. "Hidden Dangers", "Smart Solutions", "Life Changing")
    if (wordCount <= 2 || /\b(dangers?|killers?|secrets?|hacks?|solutions?|ideas?|habits?|mistakes?|reasons?|facts?|tips?|tricks?)\b/i.test(cleaned)) {
      return {
        rawHeadline: raw,
        classification: "CLICKBAIT_HOOK",
        headlineClass: "CLICKBAIT_HOOK",
        isEligibleProductName: false,
        isEligibleAsProductName: false,
        cleanTitle: null,
        normalizedCleanText: "",
        adIdentifier: null,
        confidence: 0.95,
        reason: `Abstract editorial hook lacking concrete product noun: '${cleaned}'`,
      };
    }
  }

  // Valid product name candidate
  const cleanTitle = cleaned.slice(0, 100);
  return {
    rawHeadline: raw,
    classification: "PRODUCT_CANDIDATE",
    headlineClass: "PRODUCT_CANDIDATE",
    isEligibleProductName: true,
    isEligibleAsProductName: true,
    cleanTitle,
    normalizedCleanText: cleanTitle,
    adIdentifier: null,
    extractedModelOrSku,
    confidence: hasProductNoun ? 0.95 : 0.85,
    reason: hasProductNoun
      ? `Legitimate commercial product title with recognized product noun: '${cleanTitle}'`
      : `Plausible commercial product title: '${cleanTitle}'`,
  };
}

/**
 * Classifies an advertising headline to determine if it can serve as a genuine product title.
 * Formats ergonomic aliases and guarantees non-candidate headlines have low candidate confidence (<0.5).
 */
export function classifyAdvertisingHeadline(headline: string | null | undefined): AdHeadlineClassification {
  const rawRes = classifyAdvertisingHeadlineRaw(headline);
  const isCandidate = rawRes.isEligibleProductName && rawRes.classification === "PRODUCT_CANDIDATE";
  const finalConfidence = isCandidate ? rawRes.confidence : 0.05;
  const cleanTitle = isCandidate ? rawRes.cleanTitle : null;

  return {
    rawHeadline: rawRes.rawHeadline,
    classification: rawRes.classification,
    headlineClass: rawRes.classification,
    headlineType: rawRes.classification,
    isEligibleProductName: isCandidate,
    isEligibleAsProductName: isCandidate,
    isProductCandidate: isCandidate,
    cleanTitle,
    normalizedCleanText: cleanTitle || "",
    cleanedCandidateTitle: cleanTitle || null,
    adIdentifier: rawRes.adIdentifier || null,
    extractedModelOrSku: isCandidate ? (rawRes.extractedModelOrSku || null) : null,
    extractedModel: isCandidate ? (rawRes.extractedModelOrSku || null) : null,
    extractedCampaignCode: rawRes.classification === "CAMPAIGN_CODE" ? (headline?.trim() || null) : null,
    confidence: finalConfidence,
    reason: rawRes.reason,
  };
}

/**
 * Checks if a title string contains any recognized concrete product noun.
 */
export function containsKnownProductNoun(text: string): boolean {
  if (!text) return false;
  const words = text.toLowerCase().split(/[\s\-_/.,;:()]+/);
  for (const w of words) {
    if (KNOWN_PRODUCT_NOUNS.has(w)) return true;
    // Check singular if ends in 's'
    if (w.endsWith("s") && KNOWN_PRODUCT_NOUNS.has(w.slice(0, -1))) return true;
  }
  return false;
}
