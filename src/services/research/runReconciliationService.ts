import { prisma } from "@/lib/db";

export interface RunCountReconciliation {
  runId: string;
  retrieved: number;
  valid: number;
  linked: number;
  displayed: number;
  excluded: number;
  consistent: boolean;
  reasons: string[];
}

/**
 * Reconciles research run counts by inspecting actual database tables.
 * Compares upstream retrieved, validated, linked relations (DiscoveryRunAd),
 * and displayable records without guessing.
 */
export async function reconcileResearchRunCounts(runId: string): Promise<RunCountReconciliation> {
  const run = await prisma.discoveryRun.findUnique({
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
    };
  }

  const linkedCount = await prisma.discoveryRunAd.count({
    where: { runId },
  });

  // Displayed records in exact-run mode are all non-quarantined linked ads
  const displayedCount = await prisma.discoveryRunAd.count({
    where: {
      runId,
      ad: {
        isSyntheticQuarantine: false,
      },
    },
  });

  const excluded = run.rejectedCount + run.failedCount + (linkedCount - displayedCount);
  const reasons: string[] = [];

  let consistent = true;

  if (run.actualRetrievedCount < run.validCount) {
    consistent = false;
    reasons.push(
      `Retrieved count (${run.actualRetrievedCount}) is less than valid count (${run.validCount}).`
    );
  }

  if (run.validCount !== run.newUniqueCount + run.existingDuplicateCount) {
    if (run.validCount !== linkedCount) {
      reasons.push(
        `Valid count (${run.validCount}) differs from linked relations count (${linkedCount}).`
      );
    }
  }

  if (linkedCount !== displayedCount) {
    reasons.push(
      `${linkedCount - displayedCount} linked ads are quarantined or excluded from display.`
    );
  }

  if (reasons.length === 0) {
    reasons.push("Run counts are fully consistent across ledger, relations, and display.");
  }

  return {
    runId,
    retrieved: run.actualRetrievedCount,
    valid: run.validCount,
    linked: linkedCount,
    displayed: displayedCount,
    excluded,
    consistent,
    reasons,
  };
}
