export interface MetaResearchFormState {
  keywordsInput: string;
  market: string;
  requestedLimit: number;
  creativePreference: "VIDEO" | "IMAGE" | "ALL";
  activeStatus: "ACTIVE" | "INACTIVE" | "ALL";
  launchWithinDays?: number;
  advertiserPageId?: string;
}

export interface MetaProviderLimits {
  maxResultsPerSearch: number;
  maxRequestsPerSearch?: number;
  maxExecutionSeconds?: number;
  maxConcurrency?: number;
}

export interface MetaResearchValidationResult {
  isValid: boolean;
  errors: {
    keywords?: string;
    limit?: string;
    market?: string;
    advertiserPageId?: string;
  };
  cleanedKeywords: string[];
}

export function validateMetaResearchForm(
  input: MetaResearchFormState,
  limits?: MetaProviderLimits | null
): MetaResearchValidationResult {
  const errors: MetaResearchValidationResult["errors"] = {};

  // 1. Parse and clean keywords
  const rawParts = input.keywordsInput
    .split(",")
    .map((k) => k.trim())
    .filter((k) => k.length > 0);

  // Deduplicate case-insensitively while preserving original casing
  const seen = new Set<string>();
  const cleanedKeywords: string[] = [];
  for (const part of rawParts) {
    const lower = part.toLowerCase();
    if (!seen.has(lower)) {
      seen.add(lower);
      cleanedKeywords.push(part);
    }
  }

  if (cleanedKeywords.length === 0) {
    errors.keywords = "Please enter at least one search keyword.";
  } else if (cleanedKeywords.length > 10) {
    errors.keywords = "Maximum 10 keywords allowed per search task.";
  } else {
    for (const kw of cleanedKeywords) {
      if (kw.length < 2) {
        errors.keywords = `Keyword "${kw}" is too short (minimum 2 characters).`;
        break;
      }
      if (kw.length > 100) {
        errors.keywords = `Keyword "${kw.slice(0, 20)}..." exceeds 100 characters.`;
        break;
      }
    }
  }

  // 2. Validate limit against effective collector budget
  const effectiveMax = limits?.maxResultsPerSearch ?? 25;
  if (!input.requestedLimit || input.requestedLimit < 1) {
    errors.limit = "Limit must be at least 1 ad.";
  } else if (input.requestedLimit > effectiveMax) {
    errors.limit = `Requested limit (${input.requestedLimit}) exceeds the effective collector capacity (${effectiveMax}).`;
  }

  // 3. Market validation
  if (!input.market || input.market.trim() !== "US") {
    errors.market = "Currently only the US market is supported for public Meta research.";
  }

  // 4. Page ID validation (optional numeric/alphanumeric)
  if (input.advertiserPageId && input.advertiserPageId.trim().length > 0) {
    const trimmed = input.advertiserPageId.trim();
    if (trimmed.length > 100) {
      errors.advertiserPageId = "Advertiser Page ID must be under 100 characters.";
    }
  }

  return {
    isValid: Object.keys(errors).length === 0,
    errors,
    cleanedKeywords,
  };
}
