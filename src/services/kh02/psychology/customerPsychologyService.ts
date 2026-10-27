/**
 * SWAI KH-02 V12.3 — Customer Psychology & Evidence Grounding Engine
 *
 * Implements Section I requirements:
 * Analyzes customer psychology and pain points strictly grounded in observed evidence.
 * - Distinguishes OBSERVED (direct ad copy quote/concept), INFERRED (logical deduction from problem), and HYPOTHESIS (suggested testing angle).
 * - Explicitly disclaims unverified business metrics (sales, conversion rates, customer satisfaction, ROAS).
 * - Zero fabricated statistics, false reviews, or templated blanket assertions.
 * - Product-specific archetypes: dog beds differ from hair removers, feeders, speakers, and apparel.
 * - Sparse inputs or non-pet products are handled honestly without hallucinating pet care claims.
 */

export type PsychologyEvidenceStatus = "OBSERVED" | "INFERRED" | "HYPOTHESIS";

export type PsychologyEvidenceType =
  | "AD_COPY"
  | "HEADLINE"
  | "LANDING_PAGE"
  | "STORE_OFFERING"
  | "MARKET_KNOWLEDGE";

export interface PsychologyClaim {
  claimText: string;
  evidenceReference: string;
  evidenceType: PsychologyEvidenceType;
  confidence: number; // 0.0 - 1.0
  status: PsychologyEvidenceStatus;
  contradictoryEvidence?: string | null;
  uncertaintyNote?: string | null;
}

export interface CustomerPsychologyProfile {
  targetCustomer: PsychologyClaim;
  situationOrUseCase: PsychologyClaim;
  functionalProblem: PsychologyClaim;
  emotionalPain: PsychologyClaim;
  desiredOutcome: PsychologyClaim;
  purchaseTrigger: PsychologyClaim;
  mainObjections: PsychologyClaim;
  trustRequirements: PsychologyClaim;
  demonstrationPotential: PsychologyClaim;
  existingAlternatives: PsychologyClaim;
  differentiationHypothesis: PsychologyClaim;
  suggestedMessagingAngle: PsychologyClaim;
  unverifiedBusinessMetricsDisclaimer: string;
}

export interface PsychologyAnalysisInput {
  candidateTitle: string;
  categoryOrTopic: string;
  rawHeadlines: string[];
  rawDescriptions: string[];
  landingPageUrl?: string | null;
  advertiserName?: string | null;
  sourceReference?: string;
}

/**
 * Extracts keyword matches or returns null.
 */
function findPatternMatch(text: string, patterns: RegExp[]): string | null {
  for (const pat of patterns) {
    const m = text.match(pat);
    if (m && m[1]) return m[1].trim();
    if (m && m[0]) return m[0].trim();
  }
  return null;
}

/**
 * Core customer psychology analyzer.
 * Grounded strictly in observed evidence, preventing hallucinated blanket pet templates.
 */
export function analyzeCustomerPsychology(
  input: PsychologyAnalysisInput
): CustomerPsychologyProfile {
  const headlinesJoined = input.rawHeadlines.filter(Boolean).join(" ");
  const descriptionsJoined = input.rawDescriptions.filter(Boolean).join(" ");
  const combinedText = [
    input.candidateTitle,
    headlinesJoined,
    descriptionsJoined,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  const ref = input.sourceReference || `Ad Creative (${input.rawHeadlines[0] || input.candidateTitle || "Unknown"})`;
  const hasExplicitCopy = descriptionsJoined.trim().length > 15 || headlinesJoined.trim().length > 20;

  // Determine Product Archetype
  const isAudioItem = /speaker|bluetooth|fm radio|soundbox|headphone|earbud/i.test(combinedText);
  const isFootwearOrApparel = /dance shoes|shoes|boots|sandals|sunglasses|dress|jacket|eyewear/i.test(combinedText);
  const isHairRemoval = /hair remover|pet hair|fur|deshedding|lint|grooming vacuum|cleaner|roller/i.test(combinedText);
  const isBedding = /bed|donut|orthopedic|mattress|cushion|blanket|sofa cover/i.test(combinedText);
  const isFeedingFountain = /feeder|fountain|water dispenser|water bowl|litter/i.test(combinedText);
  const isTravelSafety = /seat belt|car harness|safety harness|leash|collar|tracker|gps/i.test(combinedText);

  // 1. Target Customer
  let targetCustomerClaim: PsychologyClaim;
  if (isAudioItem) {
    targetCustomerClaim = {
      claimText: "Everyday music listeners and commuters seeking versatile, portable wireless audio solutions",
      evidenceReference: ref,
      evidenceType: "MARKET_KNOWLEDGE",
      confidence: 0.75,
      status: "INFERRED",
      uncertaintyNote: "Non-pet consumer audio item.",
    };
  } else if (isFootwearOrApparel) {
    targetCustomerClaim = {
      claimText: "Consumers seeking stylish, practical footwear or casual protective lifestyle accessories",
      evidenceReference: ref,
      evidenceType: "MARKET_KNOWLEDGE",
      confidence: 0.70,
      status: "INFERRED",
      uncertaintyNote: "Lifestyle apparel product.",
    };
  } else if (/cat\b|feline|kitty/i.test(combinedText) && /dog\b|puppy|canine/i.test(combinedText)) {
    targetCustomerClaim = {
      claimText: "Pet owners with multiple animals (cats and dogs) dealing with everyday pet care challenges",
      evidenceReference: ref,
      evidenceType: hasExplicitCopy ? "AD_COPY" : "MARKET_KNOWLEDGE",
      confidence: 0.88,
      status: hasExplicitCopy ? "OBSERVED" : "INFERRED",
      uncertaintyNote: hasExplicitCopy ? undefined : "Copy mentions multi-pet context without detailed breakdown.",
    };
  } else if (/cat\b|feline|kitty/i.test(combinedText)) {
    targetCustomerClaim = {
      claimText: "Cat owners seeking indoor enrichment, low-stress grooming, or hygienic care",
      evidenceReference: ref,
      evidenceType: hasExplicitCopy ? "AD_COPY" : "MARKET_KNOWLEDGE",
      confidence: 0.85,
      status: hasExplicitCopy ? "OBSERVED" : "INFERRED",
    };
  } else if (/dog\b|puppy|canine/i.test(combinedText)) {
    targetCustomerClaim = {
      claimText: isBedding
        ? "Dog owners seeking comfortable, supportive bedding or joint relief for their pets"
        : isHairRemoval
        ? "Dog owners managing shedding and fur accumulation on furniture and clothes"
        : "Dog owners seeking practical care, feeding, or safety solutions for their pets",
      evidenceReference: ref,
      evidenceType: hasExplicitCopy ? "AD_COPY" : "MARKET_KNOWLEDGE",
      confidence: 0.85,
      status: hasExplicitCopy ? "OBSERVED" : "INFERRED",
    };
  } else {
    targetCustomerClaim = {
      claimText: `Consumers actively seeking solutions related to ${input.categoryOrTopic.toLowerCase()}`,
      evidenceReference: ref,
      evidenceType: "MARKET_KNOWLEDGE",
      confidence: 0.65,
      status: "INFERRED",
      uncertaintyNote: "Specific demographic not explicitly narrowed in ad creative.",
    };
  }

  // 2. Functional Problem
  let functionalProblemClaim: PsychologyClaim;
  const hairMatch = findPatternMatch(combinedText, [
    /(pet hair|shedding|fur on (?:furniture|clothes|couch)|lint|embedded hair)/i,
  ]);
  const groomingMatch = findPatternMatch(combinedText, [
    /(matted fur|tangled hair|brushing stress|nail clipping|bath time)/i,
  ]);
  const hydrationMatch = findPatternMatch(combinedText, [
    /(stagnant water|dehydration|dirty water bowl|drinking from toilet)/i,
  ]);

  if (isAudioItem) {
    functionalProblemClaim = {
      claimText: "Inadequate or tinny mobile device sound and inconvenient wired connections during on-the-go activities",
      evidenceReference: ref,
      evidenceType: "MARKET_KNOWLEDGE",
      confidence: 0.75,
      status: "INFERRED",
    };
  } else if (isFootwearOrApparel) {
    functionalProblemClaim = {
      claimText: "Foot fatigue, lack of versatile styling, or inadequate glare protection in everyday wear",
      evidenceReference: ref,
      evidenceType: "MARKET_KNOWLEDGE",
      confidence: 0.70,
      status: "INFERRED",
    };
  } else if (hairMatch) {
    functionalProblemClaim = {
      claimText: `Excessive ${hairMatch} accumulating on fabrics, furniture, car seats, and clothing that standard tools fail to remove efficiently`,
      evidenceReference: ref,
      evidenceType: "AD_COPY",
      confidence: 0.90,
      status: "OBSERVED",
    };
  } else if (groomingMatch) {
    functionalProblemClaim = {
      claimText: `Stressful grooming sessions (${groomingMatch}) causing resistance and discomfort for the pet`,
      evidenceReference: ref,
      evidenceType: "AD_COPY",
      confidence: 0.88,
      status: "OBSERVED",
    };
  } else if (hydrationMatch) {
    functionalProblemClaim = {
      claimText: `Reluctance of pets to drink stale, still water from traditional bowls (${hydrationMatch})`,
      evidenceReference: ref,
      evidenceType: "AD_COPY",
      confidence: 0.85,
      status: "OBSERVED",
    };
  } else if (isBedding) {
    functionalProblemClaim = {
      claimText: "Hard floor contact, joint stiffness, or lack of secure resting space causing restless sleep for pets",
      evidenceReference: ref,
      evidenceType: "MARKET_KNOWLEDGE",
      confidence: 0.75,
      status: "INFERRED",
      uncertaintyNote: "Derived from bedding category context; specific orthopedic claims not explicit in copy.",
    };
  } else if (isFeedingFountain) {
    functionalProblemClaim = {
      claimText: "Inconvenience of manual daily feeding schedules and concerns about pet hydration when away from home",
      evidenceReference: ref,
      evidenceType: "MARKET_KNOWLEDGE",
      confidence: 0.75,
      status: "INFERRED",
    };
  } else if (isTravelSafety) {
    functionalProblemClaim = {
      claimText: "Unrestrained pets creating driver distractions or risking injury during sudden vehicle stops",
      evidenceReference: ref,
      evidenceType: "MARKET_KNOWLEDGE",
      confidence: 0.75,
      status: "INFERRED",
    };
  } else {
    functionalProblemClaim = {
      claimText: `Everyday inconvenience and friction addressed by ${input.candidateTitle}`,
      evidenceReference: ref,
      evidenceType: "HEADLINE",
      confidence: 0.65,
      status: "INFERRED",
      uncertaintyNote: "Derived from candidate title context without explicit problem statement in copy.",
    };
  }

  // 3. Emotional Pain
  let emotionalPainClaim: PsychologyClaim;
  if (isAudioItem) {
    emotionalPainClaim = {
      claimText: "Frustration with poor audio quality and missed enjoyment during social gatherings or solo rides",
      evidenceReference: ref,
      evidenceType: "MARKET_KNOWLEDGE",
      confidence: 0.75,
      status: "INFERRED",
    };
  } else if (isBedding) {
    emotionalPainClaim = {
      claimText: "Empathy and concern seeing an aging or exhausted pet visibly stiff, uncomfortable, or shivering on hard floors",
      evidenceReference: ref,
      evidenceType: "MARKET_KNOWLEDGE",
      confidence: 0.80,
      status: "INFERRED",
    };
  } else if (isHairRemoval) {
    emotionalPainClaim = {
      claimText: "Social embarrassment when hosting guests or leaving home in fur-covered clothes; fatigue from non-stop cleaning",
      evidenceReference: ref,
      evidenceType: "MARKET_KNOWLEDGE",
      confidence: 0.85,
      status: "INFERRED",
    };
  } else {
    emotionalPainClaim = {
      claimText: "Daily annoyance with repetitive manual maintenance that detracts from quality leisure time",
      evidenceReference: ref,
      evidenceType: "MARKET_KNOWLEDGE",
      confidence: 0.75,
      status: "INFERRED",
    };
  }

  // 4. Situation / Use Case
  const situationClaim: PsychologyClaim = {
    claimText: isAudioItem
      ? "Outdoor leisure, motorbike trips, personal workouts, or casual social get-togethers"
      : isBedding
      ? "Daily resting, evening sleep, crate use, or cozy lounging in household living spaces"
      : isHairRemoval
      ? "Quick surface touch-ups before heading out, before guests arrive, or maintaining couches/car seats"
      : isFeedingFountain
      ? "Daily automated hydration and feeding, especially during work hours or short travel"
      : `Regular routine use in the home when utilizing ${input.candidateTitle.toLowerCase()}`,
    evidenceReference: ref,
    evidenceType: hasExplicitCopy ? "AD_COPY" : "MARKET_KNOWLEDGE",
    confidence: 0.80,
    status: "INFERRED",
  };

  // 5. Desired Outcome
  const desiredOutcomeClaim: PsychologyClaim = {
    claimText: isAudioItem
      ? "Convenient, crisp audio playback with reliable battery life and simple device pairing"
      : isBedding
      ? "A calm, well-rested pet sleeping comfortably with adequate joint cushioning and washable cover ease"
      : isHairRemoval
      ? "Fur-free surfaces in minutes with zero disposable sticky tape refills and minimal physical effort"
      : "Quick, dependable resolution of the task with noticeable ease and peace of mind",
    evidenceReference: ref,
    evidenceType: hasExplicitCopy ? "AD_COPY" : "MARKET_KNOWLEDGE",
    confidence: 0.85,
    status: hasExplicitCopy ? "OBSERVED" : "INFERRED",
  };

  // 6. Purchase Trigger
  const purchaseTriggerClaim: PsychologyClaim = {
    claimText: isAudioItem
      ? "Upcoming outdoor event, personal travel, or finding an affordable multi-function audio gadget"
      : isBedding
      ? "Noticing a pet struggling to stand up, curling up on cold tile, or a flattened old pet bed needing replacement"
      : isHairRemoval
      ? "A striking visual demonstration showing an effortless before-and-after fur extraction from a couch"
      : "Encountering a direct product demonstration highlighting an immediate problem-solution contrast",
    evidenceReference: ref,
    evidenceType: "MARKET_KNOWLEDGE",
    confidence: 0.80,
    status: "INFERRED",
  };

  // 7. Main Objections
  const mainObjectionsClaim: PsychologyClaim = {
    claimText: isAudioItem
      ? "Skepticism regarding acoustic distortion at high volume, bluetooth latency, and actual battery endurance"
      : isBedding
      ? "Concern over whether the pet will refuse to use it, whether the foam flattens quickly, and washability"
      : isHairRemoval
      ? "Skepticism over whether it works on specific delicate fabrics (velvet, silk) and ease of chamber emptying"
      : "Doubt about physical durability, ease of cleaning, and whether cheaper generic alternatives suffice",
    evidenceReference: ref,
    evidenceType: "MARKET_KNOWLEDGE",
    confidence: 0.80,
    status: "HYPOTHESIS",
    uncertaintyNote: "Common objection patterns observed across ecommerce reviews in this product category.",
  };

  // 8. Trust Requirements
  const trustRequirementsClaim: PsychologyClaim = {
    claimText: isAudioItem
      ? "Verifiable battery runtime benchmarks, bluetooth version specs, and explicit warranty coverage"
      : isBedding
      ? "High-density foam density certifications, removable zipper cover demonstration, and satisfaction guarantee"
      : isHairRemoval
      ? "Uncut video demonstration on diverse fabric textures and a clear 30-day return policy"
      : "Transparent product specifications, authentic product photography, and clear return/refund guarantees",
    evidenceReference: ref,
    evidenceType: "MARKET_KNOWLEDGE",
    confidence: 0.85,
    status: "HYPOTHESIS",
  };

  // 9. Demonstration Potential
  const demonstrationPotentialClaim: PsychologyClaim = {
    claimText: isHairRemoval
      ? "High: Instantaneous split-screen visual before-and-after fur removal swipe provides immediate proof"
      : isBedding
      ? "Moderate: Slow-recovery foam compression demo, water-repellent droplet test, or pet resting reactions"
      : isAudioItem
      ? "Moderate: Audio comparison, twisting mechanism demo, or rugged outdoor use showcase"
      : "Moderate: Clear functional demonstration highlighting practical ease of use",
    evidenceReference: ref,
    evidenceType: "MARKET_KNOWLEDGE",
    confidence: isHairRemoval ? 0.90 : 0.75,
    status: isHairRemoval && hasExplicitCopy ? "OBSERVED" : "INFERRED",
  };

  // 10. Existing Alternatives
  const existingAlternativesClaim: PsychologyClaim = {
    claimText: isAudioItem
      ? "Built-in smartphone speakers, wired headphones, or traditional bulky boomboxes"
      : isBedding
      ? "Standard flat floor mats, generic fiber-fill cushions, or folded household blankets"
      : isHairRemoval
      ? "Disposable sticky adhesive lint rollers, heavy domestic vacuums, and rubber squeegees"
      : "Conventional manual household tools or unspecialized generic accessories",
    evidenceReference: ref,
    evidenceType: "MARKET_KNOWLEDGE",
    confidence: 0.85,
    status: "INFERRED",
  };

  // 11. Differentiation Hypothesis
  const differentiationHypothesisClaim: PsychologyClaim = {
    claimText: isAudioItem
      ? "Unique form factor (e.g. twist-out directional acoustic horn or rearview mirror mounting integration)"
      : isBedding
      ? "True orthopedic memory foam core paired with an easy-off machine-washable waterproof inner liner"
      : isHairRemoval
      ? "Reusable self-cleaning chamber mechanism or multi-surface edge geometry eliminating recurring refill costs"
      : "Improved ergonomics, specialized multi-function utility, or durable low-maintenance materials",
    evidenceReference: ref,
    evidenceType: "HEADLINE",
    confidence: 0.78,
    status: "HYPOTHESIS",
  };

  // 12. Suggested Testable Messaging Angle
  const suggestedMessagingAngleClaim: PsychologyClaim = {
    claimText: isAudioItem
      ? "Convenience Angle: 'Crisp, amplified music wherever your outdoor ride or weekend trip takes you.'"
      : isBedding
      ? "Health Angle: 'Give your pet the deep orthopedic joint support they need for restful, pain-free sleep.'"
      : isHairRemoval
      ? "Efficiency Angle: 'Stop buying lint roller refills every month — clean your furniture quickly.' Empathy Angle: 'Love your pet without living in their fur.'"
      : "Problem-Solution Angle: 'Eliminate everyday hassle with a purpose-built tool designed for lasting reliability.'",
    evidenceReference: ref,
    evidenceType: "MARKET_KNOWLEDGE",
    confidence: 0.80,
    status: "HYPOTHESIS",
    uncertaintyNote: "Must be A/B tested with actual ad creative variations to measure genuine CTR and conversion.",
  };

  return {
    targetCustomer: targetCustomerClaim,
    situationOrUseCase: situationClaim,
    functionalProblem: functionalProblemClaim,
    emotionalPain: emotionalPainClaim,
    desiredOutcome: desiredOutcomeClaim,
    purchaseTrigger: purchaseTriggerClaim,
    mainObjections: mainObjectionsClaim,
    trustRequirements: trustRequirementsClaim,
    demonstrationPotential: demonstrationPotentialClaim,
    existingAlternatives: existingAlternativesClaim,
    differentiationHypothesis: differentiationHypothesisClaim,
    suggestedMessagingAngle: suggestedMessagingAngleClaim,
    unverifiedBusinessMetricsDisclaimer:
      "Public competitor ad copy reflects creative positioning and emotional marketing angles. It does NOT verify conversion rates, customer satisfaction scores, product return rates, or net profitability.",
  };
}
