/**
 * SWAI KH-02 — Product Relevance Evaluator
 *
 * Validates that product candidates match the target research niche:
 * - Prevents unrelated household or apparel goods matching incidental keyword substrings
 *   from masquerading as verified candidates for niches like "Pet Gadgets".
 * - Classifies candidates into: RELEVANT, PROBABLY_RELEVANT, AMBIGUOUS, IRRELEVANT.
 */

export type ProductRelevanceStatus =
  | "RELEVANT"
  | "PROBABLY_RELEVANT"
  | "AMBIGUOUS"
  | "IRRELEVANT";

export interface RelevanceEvaluationResult {
  relevanceStatus: ProductRelevanceStatus;
  isAccepted: boolean;
  score: number; // 0 to 1
  reasons: string[];
  topic: string;
}

// Domain-specific keyword signatures for common validation niches
const NICHE_SIGNATURES: Record<string, { include: string[]; exclude: string[] }> = {
  pet: {
    include: [
      "pet", "dog", "puppy", "cat", "kitten", "paw", "paws", "fur", "leash", "collar",
      "grooming", "litter", "aquarium", "deshedding", "shedding", "lint roller", "chomchom",
      "fur zapper", "grooming glove", "pet comb", "undercoat rake", "dog toy", "cat toy",
      "pet feeder", "pet harness", "pet brush", "pet hair remover", "automatic pet feeder",
      "feeder", "water fountain", "fountain", "cat water fountain", "pet water fountain",
      "grooming vacuum", "dog grooming vacuum", "pet vacuum", "pet tracker", "gps pet tracker",
      "gps", "tracker", "smart collar", "bark collar", "pet camera", "pet gadget"
    ],
    exclude: [
      "casino", "crypto", "dating", "adult", "loan", "mortgage", "real estate",
      "car repair", "solar panels",
      // Human hair removal, beauty, skincare & depilatory terms
      "crystal hair eraser", "strawberry legs", "razor bump", "razor bumps",
      "shaving cut", "shaving cuts", "bikini", "pubic", "armpit", "underarm",
      "facial hair", "beard trimmer", "epilator", "depilatory", "laser hair",
      "human hair", "dead skin", "painless hair removal", "hair removal cream",
      "hair removal spray", "body hair", "wax strips", "waxing kit", "shaving cream",
      "lipstick", "eyeliner", "mascara", "serum", "anti-aging", "wrinkle"
    ],
  },
  beauty: {
    include: ["skincare", "serum", "makeup", "cosmetics", "facial", "anti-aging", "hair", "lipstick"],
    exclude: ["industrial", "automotive", "gaming"],
  },
};

function hasWordMatch(text: string, word: string): boolean {
  if (word.includes(" ")) {
    return text.includes(word);
  }
  const regex = new RegExp(`\\b${word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i");
  return regex.test(text);
}

/**
 * Evaluates whether candidate text, title, or category belongs to the research topic.
 */
export function evaluateProductRelevance(
  candidateText: string,
  topic: string
): RelevanceEvaluationResult {
  const normalizedTopic = topic.toLowerCase().trim();
  const normalizedText = candidateText.toLowerCase().trim();
  const reasons: string[] = [];

  // Match topic terms directly using word boundaries to prevent substring false positives (e.g. mohair != hair)
  const topicWords = normalizedTopic.split(/\s+/).filter((w) => w.length > 2);
  let matchedTopicWords = 0;
  for (const word of topicWords) {
    if (hasWordMatch(normalizedText, word)) {
      matchedTopicWords++;
    }
  }

  // Check niche signatures if available (e.g. "pet gadgets" or "pet hair remover" -> "pet")
  let nicheKey = "";
  for (const key of Object.keys(NICHE_SIGNATURES)) {
    if (hasWordMatch(normalizedTopic, key) || normalizedTopic.includes(key)) {
      nicheKey = key;
      break;
    }
  }

  if (nicheKey && NICHE_SIGNATURES[nicheKey]) {
    const signature = NICHE_SIGNATURES[nicheKey];

    // Check for hard exclusions (human hair removal / unrelated categories)
    for (const excl of signature.exclude) {
      if (normalizedText.includes(excl)) {
        reasons.push(`Contains excluded term '${excl}' for niche '${topic}' (human body hair removal/unrelated category).`);
        return {
          relevanceStatus: "IRRELEVANT",
          isAccepted: false,
          score: 0.05,
          reasons,
          topic,
        };
      }
    }

    // Contextual evaluation for "hair eraser":
    // Human body context (strawberry legs, bikini, exfoliation) is excluded, but pet hair context (fur, couch, dog) is accepted.
    if (normalizedText.includes("hair eraser")) {
      const isHumanBodyContext = [
        "strawberry", "legs", "bikini", "pubic", "underarm", "armpit", "exfoliat",
        "painless", "dead skin", "body hair", "facial", "smooth skin"
      ].some((term) => normalizedText.includes(term));
      const hasPetContext = ["pet", "dog", "puppy", "cat", "kitten", "fur", "paws", "animal"].some((term) =>
        hasWordMatch(normalizedText, term)
      );

      if (isHumanBodyContext || !hasPetContext) {
        reasons.push("Contains 'hair eraser' in human body / skin hair removal context.");
        return {
          relevanceStatus: "IRRELEVANT",
          isAccepted: false,
          score: 0.05,
          reasons,
          topic,
        };
      }
    }

    // Check generic stain cleaners / odor removers without pet hair cleanup intent
    if (
      normalizedText.includes("stain remover") ||
      normalizedText.includes("spot cleaner") ||
      normalizedText.includes("carpet cleaner") ||
      normalizedText.includes("odor eliminator")
    ) {
      const hasHairOrFur = ["hair", "fur", "lint", "pet", "dog", "cat", "shedding", "deshedding"].some((term) =>
        hasWordMatch(normalizedText, term)
      );
      if (!hasHairOrFur) {
        reasons.push("Product is a generic stain/surface cleaner and does not target hair, fur, or lint cleanup.");
        return {
          relevanceStatus: "IRRELEVANT",
          isAccepted: false,
          score: 0.1,
          reasons,
          topic,
        };
      }
    }

    // Generic household tools/gadgets without explicit pet context are AMBIGUOUS
    const petContextTerms = ["pet", "pets", "dog", "dogs", "puppy", "puppies", "cat", "cats", "kitten", "kittens", "fur", "paw", "paws", "canine", "feline", "animal"];
    const hasCorePetContext = petContextTerms.some((term) => hasWordMatch(normalizedText, term));

    if (nicheKey === "pet" && !hasCorePetContext) {
      const isGenericHouseholdItem = [
        "lint roller", "cleaning brush", "vacuum", "multi-purpose", "household", "brush", "roller", "broom"
      ].some((term) => normalizedText.includes(term) || hasWordMatch(normalizedText, term));

      if (isGenericHouseholdItem) {
        reasons.push("Product has generic cleaning or household utility attributes but lacks explicit pet intent.");
        return {
          relevanceStatus: "AMBIGUOUS",
          isAccepted: false,
          score: 0.35,
          reasons,
          topic,
        };
      }
    }

    // Special logic for "pet hair remover": requires pet hair removal / cleaning or pet grooming intent
    const isPetHairRemoverQuery = normalizedTopic.includes("pet") && normalizedTopic.includes("hair");
    if (isPetHairRemoverQuery) {
      const petTerms = ["pet", "dog", "puppy", "cat", "kitten", "fur", "paws", "animal"];
      const hairOrFurTerms = ["hair", "fur", "lint", "shedding", "deshedding", "coat"];
      const cleaningOrRemoverTerms = [
        "hair remover", "remover", "roller", "brush", "grooming", "deshedding",
        "shedding", "lint", "cleaner", "sweeper", "vacuum", "comb", "rake", "glove", "eraser"
      ];
      const householdSurfaces = ["couch", "sofa", "carpet", "clothing", "furniture", "rug", "bedding", "car seat"];

      const hasPetTerm = petTerms.some((t) => hasWordMatch(normalizedText, t));
      const hasHairOrFurTerm = hairOrFurTerms.some((t) => hasWordMatch(normalizedText, t));
      const hasRemoverTerm = cleaningOrRemoverTerms.some((t) => hasWordMatch(normalizedText, t));
      const hasSurface = householdSurfaces.some((s) => normalizedText.includes(s));

      if (hasPetTerm && hasHairOrFurTerm && hasRemoverTerm) {
        reasons.push("Strong match for pet hair removal/grooming intent.");
        return {
          relevanceStatus: "RELEVANT",
          isAccepted: true,
          score: 0.95,
          reasons,
          topic,
        };
      } else if (hasHairOrFurTerm && hasRemoverTerm && (hasPetTerm || hasSurface)) {
        // Hair removal tool for household surfaces/fabrics or pet grooming
        reasons.push("Hair/fur removal tool for household surfaces or pet grooming.");
        return {
          relevanceStatus: "RELEVANT",
          isAccepted: true,
          score: 0.85,
          reasons,
          topic,
        };
      } else if (hasPetTerm && !hasHairOrFurTerm && !hasRemoverTerm) {
        // Pet product but not hair remover (e.g. dog toy, feeder)
        reasons.push("Product is pet-related but lacks specific hair removal or grooming attributes.");
        return {
          relevanceStatus: "AMBIGUOUS",
          isAccepted: false,
          score: 0.4,
          reasons,
          topic,
        };
      } else if (!hasPetTerm && !hasHairOrFurTerm) {
        reasons.push("Product does not demonstrate pet or hair removal utility.");
        return {
          relevanceStatus: "IRRELEVANT",
          isAccepted: false,
          score: 0.1,
          reasons,
          topic,
        };
      }
    }

    // Check for domain includes
    const matchedSignatureTerms = signature.include.filter((term) =>
      hasWordMatch(normalizedText, term)
    );

    if (matchedSignatureTerms.length >= 1) {
      reasons.push(`Strong niche match on terms: ${matchedSignatureTerms.slice(0, 3).join(", ")}.`);
      return {
        relevanceStatus: "RELEVANT",
        isAccepted: true,
        score: 0.95,
        reasons,
        topic,
      };
    }
  }

  // Fallback for general topics without custom signature dictionary
  if (matchedTopicWords >= Math.ceil(topicWords.length / 2)) {
    reasons.push(`Matches majority of topic keywords: ${topicWords.join(", ")}.`);
    return {
      relevanceStatus: "RELEVANT",
      isAccepted: true,
      score: 0.85,
      reasons,
      topic,
    };
  }

  if (matchedTopicWords > 0) {
    reasons.push("Partial keyword overlap with search topic; lacks core niche alignment.");
    return {
      relevanceStatus: "AMBIGUOUS",
      isAccepted: false,
      score: 0.4,
      reasons,
      topic,
    };
  }

  reasons.push(`No keyword or niche alignment found with topic '${topic}'.`);
  return {
    relevanceStatus: "IRRELEVANT",
    isAccepted: false,
    score: 0.1,
    reasons,
    topic,
  };
}
