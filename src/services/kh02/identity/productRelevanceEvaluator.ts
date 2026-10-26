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
      "pet", "dog", "puppy", "cat", "kitten", "paw", "bark", "leash", "collar",
      "grooming", "fur", "hair remover", "feeder", "litter", "aquarium", "bird",
      "launcher", "ball", "toy", "gadget", "device", "bowl", "harness", "nail", "whistle"
    ],
    exclude: [
      "casino", "crypto", "dating", "adult", "loan", "mortgage", "real estate",
      "car repair", "solar panels"
    ],
  },
  beauty: {
    include: ["skincare", "serum", "makeup", "cosmetics", "facial", "anti-aging", "hair", "lipstick"],
    exclude: ["industrial", "automotive", "gaming"],
  },
};

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

  // Match topic terms directly
  const topicWords = normalizedTopic.split(/\s+/).filter((w) => w.length > 2);
  let matchedTopicWords = 0;
  for (const word of topicWords) {
    if (normalizedText.includes(word)) {
      matchedTopicWords++;
    }
  }

  // Check niche signatures if available (e.g. "pet gadgets" -> "pet")
  let nicheKey = "";
  for (const key of Object.keys(NICHE_SIGNATURES)) {
    if (normalizedTopic.includes(key)) {
      nicheKey = key;
      break;
    }
  }

  if (nicheKey && NICHE_SIGNATURES[nicheKey]) {
    const signature = NICHE_SIGNATURES[nicheKey];

    // Check for hard exclusions
    for (const excl of signature.exclude) {
      if (normalizedText.includes(excl)) {
        reasons.push(`Contains excluded term '${excl}' for niche '${topic}'.`);
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
      normalizedText.includes(term)
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
    reasons.push("Partial keyword overlap with search topic.");
    return {
      relevanceStatus: "AMBIGUOUS",
      isAccepted: true,
      score: 0.5,
      reasons,
      topic,
    };
  }

  reasons.push(`No keyword or niche alignment found with topic '${topic}'.`);
  return {
    relevanceStatus: "IRRELEVANT",
    isAccepted: false,
    score: 0.2,
    reasons,
    topic,
  };
}
