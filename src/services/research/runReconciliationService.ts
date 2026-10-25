import { prisma } from "@/lib/db";

export interface RunCounts {
  retrieved: number;
  valid: number;
  newUnique: number;
  duplicates: number;
  rejected: number;
  failed: number;
  linked: number;
  displayed: number;
  quarantined: number;
}

export interface InvariantViolation {
  code: string;
  expected: string;
  actual: string;
}

export interface ReconciliationEvaluation {
  consistent: boolean;
  violations: InvariantViolation[];
  explanations: string[];
}

export interface RunCountRules {
  requireExactValidLink?: boolean;
  requireNonNegative?: boolean;
}

export interface RunCountReconciliation {
  runId: string;
  retrieved: number;
  valid: number;
  linked: number;
  displayed: number;
  eligibleForDisplayCount?: number;
  httpObservedCount?: number | null;
  browserObservedCount?: number | null;
  excluded: number;
  quarantined?: number;
  consistent: boolean;
  reasons: string[];
  violations?: InvariantViolation[];
}

/**
 * Pure evaluation of research run count invariants.
 * Any violation of a mandatory arithmetic invariant strictly sets consistent = false.
 */
export function evaluateRunCountInvariants(
  counts: RunCounts,
  rules: RunCountRules = { requireExactValidLink: true, requireNonNegative: true }
): ReconciliationEvaluation {
  const violations: InvariantViolation[] = [];
  const explanations: string[] = [];

  // 1. Non-negative counts
  if (rules.requireNonNegative !== false) {
    for (const [key, val] of Object.entries(counts)) {
      if (typeof val === "number" && val < 0) {
        violations.push({
          code: "NEGATIVE_COUNT",
          expected: `${key} >= 0`,
          actual: `${key} = ${val}`,
        });
        explanations.push(`Invalid negative count for ${key}: ${val}.`);
      }
    }
  }

  // 2. Upstream retrieval bound: retrieved >= valid
  if (counts.retrieved < counts.valid) {
    violations.push({
      code: "RETRIEVED_LESS_THAN_VALID",
      expected: `retrieved (${counts.retrieved}) >= valid (${counts.valid})`,
      actual: `retrieved = ${counts.retrieved}, valid = ${counts.valid}`,
    });
    explanations.push(
      `Retrieved count (${counts.retrieved}) is less than valid count (${counts.valid}).`
    );
  }

  // 3. Ingestion partition: valid === newUnique + duplicates
  if (counts.valid !== counts.newUnique + counts.duplicates) {
    violations.push({
      code: "VALID_PARTITION_MISMATCH",
      expected: `valid (${counts.valid}) === newUnique (${counts.newUnique}) + duplicates (${counts.duplicates})`,
      actual: `valid = ${counts.valid}, sum = ${counts.newUnique + counts.duplicates}`,
    });
    explanations.push(
      `Valid count (${counts.valid}) differs from sum of new unique (${counts.newUnique}) and duplicate (${counts.duplicates}) records.`
    );
  }

  // 4. Linked relations invariant: linked === valid
  if (rules.requireExactValidLink !== false && counts.valid !== counts.linked) {
    violations.push({
      code: "VALID_LINKED_MISMATCH",
      expected: `valid (${counts.valid}) === linked (${counts.linked})`,
      actual: `valid = ${counts.valid}, linked = ${counts.linked}`,
    });
    explanations.push(
      `Valid count (${counts.valid}) differs from linked relations count (${counts.linked}).`
    );
  }

  // 5. Display alignment (Option B: Exact-run API returns all linked ads)
  if (counts.linked !== counts.displayed) {
    violations.push({
      code: "LINKED_DISPLAYED_MISMATCH",
      expected: `linked (${counts.linked}) === displayed (${counts.displayed})`,
      actual: `linked = ${counts.linked}, displayed = ${counts.displayed}`,
    });
    explanations.push(
      `Linked relations count (${counts.linked}) differs from displayed count (${counts.displayed}).`
    );
  }

  // Informational notes
  if (counts.quarantined > 0) {
    explanations.push(
      `${counts.quarantined} linked ads are flagged with synthetic quarantine in display payload.`
    );
  }

  if (violations.length === 0 && explanations.length === 0) {
    explanations.push("Run counts are fully consistent across ledger, relations, and display.");
  }

  return {
    consistent: violations.length === 0,
    violations,
    explanations,
  };
}

export interface ReconcileOptions {
  observedDisplayedCount?: number;
  observedHttpCount?: number;
  rules?: RunCountRules;
  prisma?: any;
}

/**
 * Reconciles research run counts by inspecting actual database tables.
 * Compares upstream retrieved, validated, linked relations (DiscoveryRunAd),
 * and displayable records without guessing.
 */
export async function reconcileResearchRunCounts(
  runId: string,
  options?: ReconcileOptions
): Promise<RunCountReconciliation> {
  const client = options?.prisma || prisma;

  const run = await client.discoveryRun.findUnique({
    where: { id: runId },
    select: {
      id: true,
      actualRetrievedCount: true,
      validCount: true,
      newUniqueCount: true,
      existingDuplicateCount: true,
      rejectedCount: true,
      failedCount: true,
    },
  });

  if (!run) {
    return {
      runId,
      retrieved: 0,
      valid: 0,
      linked: 0,
      displayed: 0,
      excluded: 0,
      consistent: false,
      reasons: [`Run '${runId}' not found in database.`],
      violations: [
        { code: "RUN_NOT_FOUND", expected: "Existing discovery run", actual: "null" },
      ],
    };
  }

  const linkedCount = await client.discoveryRunAd.count({
    where: { runId },
  });

  const quarantinedCount = await client.discoveryRunAd.count({
    where: {
      runId,
      ad: {
        isSyntheticQuarantine: true,
      },
    },
  });

  // If observed cross-boundary counts are provided, use them; otherwise use database linked count
  const displayedCount =
    typeof options?.observedDisplayedCount === "number"
      ? options.observedDisplayedCount
      : linkedCount;
  const excluded = run.rejectedCount + run.failedCount;

  const counts: RunCounts = {
    retrieved: run.actualRetrievedCount,
    valid: run.validCount,
    newUnique: run.newUniqueCount,
    duplicates: run.existingDuplicateCount,
    rejected: run.rejectedCount,
    failed: run.failedCount,
    linked: linkedCount,
    displayed: displayedCount,
    quarantined: quarantinedCount,
  };

  const evaluation = evaluateRunCountInvariants(counts, options?.rules);

  return {
    runId,
    retrieved: counts.retrieved,
    valid: counts.valid,
    linked: counts.linked,
    displayed: counts.displayed,
    eligibleForDisplayCount: linkedCount,
    httpObservedCount: typeof options?.observedHttpCount === "number" ? options.observedHttpCount : null,
    browserObservedCount: typeof options?.observedDisplayedCount === "number" ? options.observedDisplayedCount : null,
    excluded,
    quarantined: quarantinedCount,
    consistent: evaluation.consistent,
    reasons: evaluation.explanations,
    violations: evaluation.violations,
  };
}
