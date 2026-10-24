/**
 * SWAI V11.5.1 — Collector Budget Options Reconciler
 *
 * Computes strictly valid research limit options bounded by effectiveMax.
 * Guarantees:
 * - Never returns options above effectiveMax
 * - If positive, always includes at least one option (effectiveMax itself or standard fractions)
 * - Returns deduplicated, sorted ascending numbers
 */

const STANDARD_LIMIT_STEPS = [5, 10, 15, 20, 25, 50, 100];

export function getAllowedResearchLimits(effectiveMax: number): number[] {
  if (typeof effectiveMax !== "number" || isNaN(effectiveMax) || effectiveMax <= 0) {
    return [1];
  }

  const boundedMax = Math.min(100, Math.max(1, Math.floor(effectiveMax)));

  // Filter standard steps that are strictly <= boundedMax
  const filtered = STANDARD_LIMIT_STEPS.filter((step) => step <= boundedMax);

  // If boundedMax is not in filtered, add it
  if (!filtered.includes(boundedMax)) {
    filtered.push(boundedMax);
  }

  // If empty (e.g. boundedMax < 5, like 1 or 2), ensure boundedMax is returned
  if (filtered.length === 0) {
    filtered.push(boundedMax);
  }

  return Array.from(new Set(filtered)).sort((a, b) => a - b);
}
