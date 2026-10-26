/**
 * SWAI KH-02 V12.2 — Ad Headline & Copy Classifier
 *
 * Distinguishes genuine product names from advertising copy, promotional calls-to-action (CTAs),
 * clickbait hooks, and raw ad identifiers.
 *
 * Non-negotiable invariant (Directive 79 & 85):
 * Raw ad creative headers (e.g. "Facebook Ad: 893760707134895") or promotional hooks
 * (e.g. "Sign up now for 50% off your order!") must NEVER be accepted as verified product names.
 */

export type HeadlineClass =
  | "AD_IDENTIFIER"        // e.g. "Facebook Ad: 893760707134895", "Ad ID: 12345"
  | "PROMOTIONAL_CTA"      // e.g. "Sign up now for 50% off your order!", "Shop Now & Save", "Free Shipping"
  | "CLICKBAIT_HOOK"       // e.g. "You won't believe this dog gadget!", "Viral TikTok pet find"
  | "GENERIC_CATEGORY"     // e.g. "Pet Supplies", "Dog Accessories"
  | "PRODUCT_CANDIDATE";   // e.g. "Ultrasonic Dog Bark Deterrent", "Self-Cleaning Cat Litter Box"

export interface AdHeadlineClassification {
  rawHeadline: string;
  classification: HeadlineClass;
  headlineClass: HeadlineClass; // Ergonomic alias
  isEligibleProductName: boolean;
  isEligibleAsProductName: boolean; // Ergonomic alias
  cleanTitle: string | null;
  normalizedCleanText: string; // Ergonomic alias
  adIdentifier: string | null;
  confidence: number; // 0.0 - 1.0
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
];

const CLICKBAIT_HOOK_PATTERNS = [
  /\b(you\s*(won't|wont)\s*believe)\b/i,
  /\b(tiktok\s*(made\s*me\s*buy\s*it|viral\s*find))\b/i,
  /\b(the\s*secret\s*(all|every)\s*(dog|cat|pet)\s*owners?\s*need)\b/i,
  /\b(this\s*(one\s*trick|life\s*hack))\b/i,
  /\b(why\s*(vets?|experts?|everyone)\s*(is|are)\s*talking\s*about)\b/i,
  /\b(say\s*goodbye\s*to\s*[^.!?]+forever)\b/i,
];

/**
 * Classifies an advertising headline to determine if it can serve as a genuine product title.
 */
export function classifyAdvertisingHeadline(headline: string | null | undefined): AdHeadlineClassification {
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

  // 3. Check for Clickbait Hooks
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
        confidence: 0.90,
        reason: `Matched viral clickbait hook pattern: ${pattern.source}`,
      };
    }
  }

  // 4. Strip common promotional suffix tags from real product headlines
  let cleaned = raw;
  cleaned = cleaned.replace(/\s*[-–|:]\s*(Buy Now|Shop Now|\d+%\s*Off|Free Shipping|Sale|Official Store|Best Seller).*$/i, "");
  cleaned = cleaned.replace(/^(NEW|HOT|MUST HAVE|VIRAL|SALE)\s*[:!-]\s*/i, "");
  cleaned = cleaned.replace(/[!]{2,}/g, "!");
  cleaned = cleaned.trim();

  // If after cleaning it becomes too short or matches a CTA, reject
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
    confidence: 0.92,
    reason: "Plausible commercial product title",
  };

}
