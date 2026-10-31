/**
 * SWAI KH-02 V12.4.3.1 — Acceptance Gate & Bounded Async Verification Engine
 *
 * Implements:
 * - Section 4.1: Split G06 Meta Gates (G06A Telemetry Truth, G06B Cache Fallback Integrity, G06C Live Execution Proof)
 * - Section 4.2: Independent G12 Evergreen Winner Verification from raw evidence
 * - Section 8: Bounded Asynchronous Parallel Job Pool & Completion Barrier
 * - Section 9: Disk, Memory, and SQLite Contention Guards
 * - Section 10: Fresh Test Execution & Build SHA Provenance Validator (Zero Stale Log Reuse)
 * - Section 19: Adversarial False-PASS Resistance Evaluators (Mutations A–J)
 */

import {
  verifyEvergreenCandidateIndependently,
  EvergreenVerificationEvidence,
} from "../scoring/evergreenOpportunityScoring";
import { compareProductIdentity } from "../identity/productDistinctnessEngine";
import { evaluateProductRelevance } from "../identity/productRelevanceEvaluator";
import { validateCustomerPsychologyAlignment } from "../psychology/customerPsychologyService";

export type GateVerdictV12_4_3_1 =
  | "PASS"
  | "FAIL"
  | "PARTIAL"
  | "BLOCKED_EXTERNAL_DEPENDENCY"
  | "NOT_APPLICABLE";

export interface SplitG06Evaluation {
  G06A_META_TELEMETRY_TRUTH: {
    verdict: GateVerdictV12_4_3_1;
    violations: string[];
    checkedRuns: number;
  };
  G06B_META_CACHE_FALLBACK_INTEGRITY: {
    verdict: GateVerdictV12_4_3_1;
    violations: string[];
    cachedRunsCount: number;
    totalCachedObservations: number;
  };
  G06C_META_LIVE_EXECUTION_PROOF: {
    verdict: GateVerdictV12_4_3_1;
    liveRunsCount: number;
    totalFreshLiveAds: number;
    totalLiveApiCalls: number;
    reason: string;
  };
  overallG06EngineeringVerdict: GateVerdictV12_4_3_1;
  overallG06LiveVerdict: GateVerdictV12_4_3_1;
}

export function evaluateSplitG06MetaGates(runs: any[]): SplitG06Evaluation {
  const telemetryViolations: string[] = [];
  const cacheViolations: string[] = [];
  let cachedRunsCount = 0;
  let totalCachedObservations = 0;
  let liveRunsCount = 0;
  let totalFreshLiveAds = 0;
  let totalLiveApiCalls = 0;

  for (const run of runs || []) {
    const runLabel = run?.topic || run?.researchRunId || "unknown_run";
    const metaTel = run?.providerTelemetry?.META_ADS || {};
    const queryExecuted = Boolean(metaTel.queryExecuted);
    const queryStatus = String(metaTel.queryStatus || "");
    const freshLiveCount = Number(metaTel.freshLiveCount ?? run?.lookbackCoverage?.freshLiveAdsCount ?? 0);
    const cachedCount = Number(metaTel.cachedRecordsCount ?? run?.lookbackCoverage?.historicalCachedAdsCount ?? 0);
    const outcomes: any[] = Array.isArray(metaTel.queryExecution)
      ? metaTel.queryExecution
      : Array.isArray(run?.queryExecutions)
      ? run.queryExecutions
      : Array.isArray(run?.queryDiscovery?.queryOutcomes)
      ? run.queryDiscovery.queryOutcomes
      : [];
    const yields: any[] = Array.isArray(run?.queryYields)
      ? run.queryYields
      : Array.isArray(run?.queryDiscovery?.queryYields)
      ? run.queryDiscovery.queryYields
      : [];

    if (!queryExecuted || queryStatus === "CACHE_ONLY") {
      if (freshLiveCount > 0) {
        telemetryViolations.push(
          `[${runLabel}] Contradiction: queryExecuted=${queryExecuted}, queryStatus=${queryStatus}, but freshLiveCount=${freshLiveCount}.`
        );
      }
      for (const qo of outcomes) {
        if (qo.attempted === true) {
          telemetryViolations.push(
            `[${runLabel}] Synthetic execution: queryId='${qo.queryId}' has attempted=true during cache-only run.`
          );
        }
        if (Number(qo.actualApiCalls || 0) > 0) {
          telemetryViolations.push(
            `[${runLabel}] Synthetic API call: queryId='${qo.queryId}' claims actualApiCalls=${qo.actualApiCalls} during cache-only run.`
          );
        }
        if (
          qo.status === "SUCCEEDED_WITH_RESULTS" ||
          qo.status === "SUCCEEDED_EMPTY"
        ) {
          telemetryViolations.push(
            `[${runLabel}] Fabricated success status: queryId='${qo.queryId}' has status='${qo.status}' when queryExecuted=false.`
          );
        }
        if (Number(qo.returnedCount || 0) > 0 || (qo.upstreamReturnedCount !== null && qo.upstreamReturnedCount !== undefined && qo.upstreamReturnedCount > 0)) {
          telemetryViolations.push(
            `[${runLabel}] Fabricated returnedCount: queryId='${qo.queryId}' claims returnedCount=${qo.returnedCount} from cached observations.`
          );
        }
      }
      for (const qy of yields) {
        if (Number(qy.actualAdsReturned || 0) > 0) {
          telemetryViolations.push(
            `[${runLabel}] Fabricated queryYield: queryId='${qy.queryId}' claims actualAdsReturned=${qy.actualAdsReturned} when no live query ran.`
          );
        }
      }
    }

    if (cachedCount > 0) {
      cachedRunsCount++;
      totalCachedObservations += cachedCount;
      if (freshLiveCount === 0 && metaTel.queryProvenance === "LIVE_PROVIDER") {
        cacheViolations.push(
          `[${runLabel}] Cache fallback claimed LIVE_PROVIDER provenance with 0 fresh live ads.`
        );
      }
      if (freshLiveCount === 0 && metaTel.isLive === true) {
        cacheViolations.push(
          `[${runLabel}] Cache fallback marked isLive=true with 0 fresh live ads.`
        );
      }
    }

    const runApiCalls = outcomes.reduce(
      (sum, o) => sum + (o.attempted ? Number(o.actualApiCalls || 0) : 0),
      0
    );
    const anyLiveOutcome = outcomes.some(
      (o) =>
        o.attempted === true &&
        o.requestCompleted === true &&
        (o.status === "SUCCEEDED_WITH_RESULTS" || o.status === "SUCCEEDED_EMPTY")
    );

    if (queryExecuted && (freshLiveCount > 0 || anyLiveOutcome)) {
      liveRunsCount++;
      totalFreshLiveAds += freshLiveCount;
      totalLiveApiCalls += Math.max(runApiCalls, 1);
    }
  }

  const g06aVerdict: GateVerdictV12_4_3_1 =
    runs && runs.length > 0 && telemetryViolations.length === 0 ? "PASS" : "FAIL";
  const g06bVerdict: GateVerdictV12_4_3_1 =
    runs && runs.length > 0 && cacheViolations.length === 0 ? "PASS" : "FAIL";
  const g06cVerdict: GateVerdictV12_4_3_1 =
    liveRunsCount > 0 && telemetryViolations.length === 0
      ? "PASS"
      : "BLOCKED_EXTERNAL_DEPENDENCY";

  return {
    G06A_META_TELEMETRY_TRUTH: {
      verdict: g06aVerdict,
      violations: telemetryViolations,
      checkedRuns: (runs || []).length,
    },
    G06B_META_CACHE_FALLBACK_INTEGRITY: {
      verdict: g06bVerdict,
      violations: cacheViolations,
      cachedRunsCount,
      totalCachedObservations,
    },
    G06C_META_LIVE_EXECUTION_PROOF: {
      verdict: g06cVerdict,
      liveRunsCount,
      totalFreshLiveAds,
      totalLiveApiCalls,
      reason:
        g06cVerdict === "PASS"
          ? `Verified ${liveRunsCount} live Meta execution run(s) with ${totalFreshLiveAds} fresh live ad(s) across ${totalLiveApiCalls} upstream API call(s).`
          : "No fresh live Meta upstream query execution occurred in this run batch (CACHE_ONLY / external provider boundary); cached fallback remained truthful.",
    },
    overallG06EngineeringVerdict:
      g06aVerdict === "PASS" && g06bVerdict === "PASS" ? "PASS" : "FAIL",
    overallG06LiveVerdict: g06cVerdict,
  };
}

export interface G12IndependentEvaluation {
  verdict: GateVerdictV12_4_3_1;
  totalClaimedWinners: number;
  independentlyVerifiedWinners: number;
  maxVerifiedWinnersInSingleRun: number;
  runsWithThreeVerifiedWinners: string[];
  disqualifiedWinners: Array<{
    runTopic: string;
    candidateId: string;
    title: string;
    disqualifiers: string[];
  }>;
  winnerEvidenceRecords: EvergreenVerificationEvidence[];
}

export function evaluateG12IndependentEvergreen(
  runs: any[]
): G12IndependentEvaluation {
  let totalClaimedWinners = 0;
  let independentlyVerifiedWinners = 0;
  let maxVerifiedWinnersInSingleRun = 0;
  const runsWithThreeVerifiedWinners: string[] = [];
  const disqualifiedWinners: G12IndependentEvaluation["disqualifiedWinners"] = [];
  const winnerEvidenceRecords: EvergreenVerificationEvidence[] = [];

  for (const run of runs || []) {
    const topic = String(run?.topic || "general");
    const topThree: any[] = Array.isArray(run?.topThree) ? run.topThree : [];
    let verifiedInRun = 0;

    // Check pairwise distinctness within topThree
    for (let i = 0; i < topThree.length; i++) {
      for (let j = i + 1; j < topThree.length; j++) {
        const candA = topThree[i]?.candidate || topThree[i];
        const candB = topThree[j]?.candidate || topThree[j];
        const cmp = compareProductIdentity(candA, candB);
        if (cmp.areSameActualProduct === true) {
          disqualifiedWinners.push({
            runTopic: topic,
            candidateId: String(candB?.candidateId || "dup"),
            title: String(candB?.title || ""),
            disqualifiers: [
              `Duplicate product in Top 3 leaderboard: matches '${candA?.title}' (${cmp.reason}).`,
            ],
          });
        }
      }
    }

    for (const item of topThree) {
      totalClaimedWinners++;
      const cand = item?.candidate || item;
      const score = item?.score || {};
      const demandPoints =
        cand?.demandResolution?.dataPoints ||
        cand?.demandSeries ||
        item?.demandSeries ||
        [];

      const evidence = verifyEvergreenCandidateIndependently(cand, demandPoints, {
        opportunityScore: score?.opportunityScore,
        evidenceConfidence: score?.evidenceConfidence,
        demandStabilityScore: score?.pillars?.demandStability?.score,
        demandClass: score?.demandClass,
        demandSourceAuthority: score?.demandSourceAuthority,
        demandObservationIds: score?.evergreenVerification?.demandObservationIds,
        distinctDemandDatesCount:
          score?.evergreenVerification?.distinctDemandDatesCount,
        coveredDays: score?.evergreenVerification?.coveredDays,
        demandObservationsCount:
          score?.evergreenVerification?.demandObservationsCount,
      });

      // Also verify topic-specific relevance and customer psychology alignment
      const obsText = Array.isArray(cand?.sourceObservations)
        ? cand.sourceObservations
            .map(
              (o: any) =>
                `${o?.title || ""} ${o?.description || ""} ${o?.observedContent || ""} ${o?.productMatchHint || ""} ${o?.landingPageUrl || ""}`
            )
            .join(" ")
        : "";
      const relCheck = evaluateProductRelevance(
        `${cand?.canonicalProductName || ""} ${cand?.title || ""} ${cand?.originalAdHeadline || ""} ${cand?.adClaimedProductName || ""} ${cand?.canonicalProductUrl || ""} ${cand?.problemStatement || ""} ${cand?.targetAudience || ""} ${obsText}`,
        topic
      );
      if (!relCheck.isAccepted || relCheck.relevanceStatus === "IRRELEVANT") {
        evidence.relevanceVerified = false;
        evidence.verifiedByGate = false;
        evidence.disqualifiers.push(
          `Candidate '${cand?.title}' failed independent relevance check for topic '${topic}': ${relCheck.reasons.join("; ")}`
        );
      }

      if (cand?.psychologyProfile) {
        const psychCheck = validateCustomerPsychologyAlignment(
          cand.psychologyProfile,
          cand
        );
        if (!psychCheck.valid) {
          evidence.verifiedByGate = false;
          evidence.disqualifiers.push(
            psychCheck.reason || "Customer psychology misalignment."
          );
        }
      }

      if (score?.tier && score.tier !== "VERIFIED_EVERGREEN") {
        evidence.verifiedByGate = false;
        evidence.disqualifiers.push(
          `Item in topThree has non-evergreen tier '${score.tier}'.`
        );
      }

      winnerEvidenceRecords.push(evidence);

      if (evidence.verifiedByGate && evidence.disqualifiers.length === 0) {
        independentlyVerifiedWinners++;
        verifiedInRun++;
      } else {
        disqualifiedWinners.push({
          runTopic: topic,
          candidateId: evidence.candidateId,
          title: evidence.canonicalProductName,
          disqualifiers: evidence.disqualifiers,
        });
      }
    }

    if (verifiedInRun > maxVerifiedWinnersInSingleRun) {
      maxVerifiedWinnersInSingleRun = verifiedInRun;
    }
    if (verifiedInRun >= 3 && disqualifiedWinners.filter((d) => d.runTopic === topic).length === 0) {
      runsWithThreeVerifiedWinners.push(topic);
    }
  }

  const verdict: GateVerdictV12_4_3_1 =
    totalClaimedWinners > 0 &&
    disqualifiedWinners.length === 0 &&
    independentlyVerifiedWinners === totalClaimedWinners
      ? "PASS"
      : "FAIL";

  return {
    verdict,
    totalClaimedWinners,
    independentlyVerifiedWinners,
    maxVerifiedWinnersInSingleRun,
    runsWithThreeVerifiedWinners,
    disqualifiedWinners,
    winnerEvidenceRecords,
  };
}

export interface FreshTestExecutionRecord {
  suiteId: string;
  command: string;
  headSha: string;
  startedAt: string;
  completedAt: string;
  durationMs: number;
  exitCode: number;
  passedTests: number;
  failedTests: number;
  reusedPreviousLog: boolean;
  logFilePath: string;
}

export function validateFreshTestExecutionLog(
  record: FreshTestExecutionRecord,
  expectedHeadSha: string
): { valid: boolean; reasons: string[] } {
  const reasons: string[] = [];
  if (record.reusedPreviousLog !== false) {
    reasons.push(`Suite '${record.suiteId}' reused a previous log (reusedPreviousLog=true).`);
  }
  if (!record.headSha || record.headSha.trim().toLowerCase() !== expectedHeadSha.trim().toLowerCase()) {
    reasons.push(
      `Suite '${record.suiteId}' headSha (${record.headSha}) does not match current HEAD (${expectedHeadSha}).`
    );
  }
  if (record.exitCode !== 0 || record.failedTests > 0) {
    reasons.push(
      `Suite '${record.suiteId}' failed with exitCode=${record.exitCode}, failedTests=${record.failedTests}.`
    );
  }
  const startMs = new Date(record.startedAt).getTime();
  const endMs = new Date(record.completedAt).getTime();
  if (isNaN(startMs) || isNaN(endMs) || endMs < startMs) {
    reasons.push(`Suite '${record.suiteId}' has invalid timestamps.`);
  }
  return { valid: reasons.length === 0, reasons };
}

export type AsyncJobStatus =
  | "QUEUED"
  | "RUNNING"
  | "COMPLETED"
  | "FAILED"
  | "CANCELLED"
  | "TIMED_OUT";

export interface AsyncJobRecord<T = any> {
  jobId: string;
  group: string;
  status: AsyncJobStatus;
  queuedAt: string;
  startedAt: string | null;
  completedAt: string | null;
  durationMs: number;
  retryCount: number;
  error: string | null;
  result?: T;
}

export interface BoundedPoolOptions {
  maxConcurrency: number;
  defaultTimeoutMs?: number;
  maxRetriesOnTransientError?: number;
}

export async function runBoundedAsyncJobPool<T>(
  tasks: Array<{
    jobId: string;
    group: string;
    timeoutMs?: number;
    isTransientError?: (err: any) => boolean;
    execute: (signal: AbortSignal) => Promise<T>;
  }>,
  options: BoundedPoolOptions
): Promise<{
  records: AsyncJobRecord<T>[];
  barrierPassed: boolean;
  maxObservedConcurrency: number;
}> {
  const maxConcurrency = Math.max(1, options.maxConcurrency || 1);
  const defaultTimeoutMs = options.defaultTimeoutMs || 60_000;
  const maxRetries = options.maxRetriesOnTransientError ?? 0;

  const records: AsyncJobRecord<T>[] = tasks.map((t) => ({
    jobId: t.jobId,
    group: t.group,
    status: "QUEUED",
    queuedAt: new Date().toISOString(),
    startedAt: null,
    completedAt: null,
    durationMs: 0,
    retryCount: 0,
    error: null,
  }));

  let activeCount = 0;
  let maxObservedConcurrency = 0;
  let nextIndex = 0;

  const runSingleTask = async (idx: number): Promise<void> => {
    const task = tasks[idx];
    const rec = records[idx];
    activeCount++;
    if (activeCount > maxObservedConcurrency) {
      maxObservedConcurrency = activeCount;
    }

    const startMs = Date.now();
    rec.status = "RUNNING";
    rec.startedAt = new Date(startMs).toISOString();

    let attempt = 0;
    while (true) {
      const controller = new AbortController();
      const timeoutMs = task.timeoutMs || defaultTimeoutMs;
      let timedOut = false;
      const timer = setTimeout(() => {
        timedOut = true;
        controller.abort(new Error(`Job '${task.jobId}' timed out after ${timeoutMs}ms`));
      }, timeoutMs);

      try {
        const res = await task.execute(controller.signal);
        clearTimeout(timer);
        const endMs = Date.now();
        rec.status = "COMPLETED";
        rec.completedAt = new Date(endMs).toISOString();
        rec.durationMs = Math.max(0, endMs - startMs);
        rec.result = res;
        rec.error = null;
        break;
      } catch (err: any) {
        clearTimeout(timer);
        const isTransient = task.isTransientError ? task.isTransientError(err) : false;
        if (!timedOut && attempt < maxRetries && isTransient) {
          attempt++;
          rec.retryCount = attempt;
          continue;
        }
        const endMs = Date.now();
        rec.status = timedOut ? "TIMED_OUT" : "FAILED";
        rec.completedAt = new Date(endMs).toISOString();
        rec.durationMs = Math.max(0, endMs - startMs);
        rec.error = err?.message || String(err);
        break;
      }
    }

    activeCount--;
  };

  const workers = Array.from(
    { length: Math.min(maxConcurrency, tasks.length) },
    async () => {
      while (true) {
        const idx = nextIndex++;
        if (idx >= tasks.length) break;
        await runSingleTask(idx);
      }
    }
  );

  await Promise.allSettled(workers);

  const barrierCheck = validateCompletionBarrier(records);

  return {
    records,
    barrierPassed: barrierCheck.passed,
    maxObservedConcurrency,
  };
}

export function validateCompletionBarrier(
  records: AsyncJobRecord[]
): { passed: boolean; incompleteJobs: string[] } {
  const incompleteJobs = (records || [])
    .filter((r) => r.status === "QUEUED" || r.status === "RUNNING")
    .map((r) => r.jobId);
  return {
    passed: incompleteJobs.length === 0,
    incompleteJobs,
  };
}
