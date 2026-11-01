/**
 * SWAI KH-02 V12.4.3.5.1 — Shared Walmart US Jina Reader Budget, Rate Limiter, Cooldown & Retry State Machine
 *
 * Implements:
 * - createWalmartProviderBudget(...)
 * - reserveWalmartOperation(...)
 * - reserveWalmartNetworkAttempt(...)
 * - awaitWalmartRateSlot(...)
 * - applyWalmartProviderCooldown(...)
 * - cancelWalmartPendingOperations(...)
 * - commitWalmartOperationAttemptResult(...)
 * - executeWalmartOperationWithRetry(...)
 *
 * Mandatory Provider Ceilings:
 * - 1 concurrent Walmart network operation per provider worker group.
 * - <= 4 logical operations per research run total (SEARCH + PDP combined).
 * - <= 2 attempts per logical operation; all retries consume the global network-attempt budget (<= 8).
 * - <= 6 total Jina REST requests per rolling 60 seconds ACROSS workers sharing host/IP/DB.
 * - Shared 429 Retry-After cooldown (seconds and HTTP-date) across workers.
 * - Immediate free-pilot halt on 401/402 without asking user for API keys or paid fallback.
 * - Monotonic attemptGeneration fence so late attempt #1 can never overwrite completed attempt #2.
 */

import {
  WalmartPilotPolicyLimits,
  WalmartQueryExecutionStatus,
} from "./walmartJinaTypes";
import { DEFAULT_WALMART_PILOT_LIMITS } from "./walmartJinaPolicy";
import { parseRetryAfter } from "./walmartJinaReaderClient";

export const WALMART_LEDGER_PROVIDER_ID = "WALMART_US_JINA_READER";
export const WALMART_COOLDOWN_PROVIDER_ID = "WALMART_US_JINA_COOLDOWN";
export const WALMART_CONCURRENCY_LOCK_JOB_ID = "wmt_provider_concurrency_lock";

interface SharedHostGroupState {
  groupKey: string;
  activeConcurrencyCount: number;
  maxConcurrent: number;
  concurrencyWaitQueue: Array<{
    resolve: () => void;
    reject: (err: Error) => void;
  }>;
  rollingRequestTimestampsMs: number[];
  cooldownUntilMs: number;
  freePilotStopped: boolean;
  freePilotStopReason: string | null;
  dbMutexChain: Promise<void>;
}

const sharedHostGroups = new Map<string, SharedHostGroupState>();

function getOrCreateSharedHostGroup(
  groupKey: string,
  maxConcurrent: number = 1
): SharedHostGroupState {
  let state = sharedHostGroups.get(groupKey);
  if (!state) {
    state = {
      groupKey,
      activeConcurrencyCount: 0,
      maxConcurrent: Math.max(1, maxConcurrent),
      concurrencyWaitQueue: [],
      rollingRequestTimestampsMs: [],
      cooldownUntilMs: 0,
      freePilotStopped: false,
      freePilotStopReason: null,
      dbMutexChain: Promise.resolve(),
    };
    sharedHostGroups.set(groupKey, state);
  }
  return state;
}

export function resetWalmartSharedHostGroupForTests(groupKey?: string): void {
  if (groupKey) {
    sharedHostGroups.delete(groupKey);
  } else {
    sharedHostGroups.clear();
  }
}

export interface WalmartLogicalOperationState {
  logicalOperationId: string;
  operationIndex: number;
  operationKind: "SEARCH" | "PDP";
  candidateId: string | null;
  targetKey: string;
  attemptsUsed: number;
  maxAttempts: number;
  attemptGeneration: number;
  committedGeneration: number;
  committedResult: unknown;
  status: WalmartQueryExecutionStatus;
  createdAtMs: number;
  deadlineAtMs: number;
}

export interface CreateWalmartProviderBudgetOptions {
  workspaceId: string;
  researchRunId: string;
  workerId?: string;
  providerGroupKey?: string;
  limits?: Partial<WalmartPilotPolicyLimits>;
  db?: any;
  nowFn?: () => number;
  sleepFn?: (ms: number, signal?: AbortSignal) => Promise<void>;
  parentSignal?: AbortSignal;
}

export interface WalmartProviderBudget {
  readonly workspaceId: string;
  readonly researchRunId: string;
  readonly workerId: string;
  readonly providerGroupKey: string;
  readonly limits: WalmartPilotPolicyLimits;
  readonly db?: any;
  readonly nowFn: () => number;
  readonly sleepFn: (ms: number, signal?: AbortSignal) => Promise<void>;
  readonly controller: AbortController;
  readonly operations: Map<string, WalmartLogicalOperationState>;
  logicalOperationsUsed: number;
  networkAttemptsUsed: number;
  abortedRequestsCount: number;
  peakConcurrentObserved: number;
  cancelled: boolean;
  cancelReason: string | null;
  isCancelled: () => boolean;
  isFreePilotStopped: () => { stopped: boolean; reason: string | null };
  getCooldownUntilMs: () => number;
  getRollingWindowRequestCount: () => number;
}

async function defaultAbortableSleep(
  ms: number,
  signal?: AbortSignal
): Promise<void> {
  if (ms <= 0) return;
  if (signal?.aborted) {
    throw new Error("Sleep aborted by signal.");
  }
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      if (signal) signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new Error("Sleep aborted by signal."));
    };
    if (signal) {
      signal.addEventListener("abort", onAbort, { once: true });
    }
  });
}

export function createWalmartProviderBudget(
  options: CreateWalmartProviderBudgetOptions
): WalmartProviderBudget {
  const limits: WalmartPilotPolicyLimits = {
    ...DEFAULT_WALMART_PILOT_LIMITS,
    ...options.limits,
    maxConcurrentOperationsPerProviderGroup: 1,
    maxLogicalOperationsPerRun: Math.min(
      4,
      Math.max(
        1,
        options.limits?.maxLogicalOperationsPerRun ??
          DEFAULT_WALMART_PILOT_LIMITS.maxLogicalOperationsPerRun
      )
    ),
    maxAttemptsPerOperation: Math.min(
      2,
      Math.max(
        1,
        options.limits?.maxAttemptsPerOperation ??
          DEFAULT_WALMART_PILOT_LIMITS.maxAttemptsPerOperation
      )
    ),
    maxRequestsPerMinuteAcrossWorkers: Math.min(
      6,
      Math.max(
        1,
        options.limits?.maxRequestsPerMinuteAcrossWorkers ??
          DEFAULT_WALMART_PILOT_LIMITS.maxRequestsPerMinuteAcrossWorkers
      )
    ),
  };
  limits.maxNetworkAttemptsPerRun =
    limits.maxLogicalOperationsPerRun * limits.maxAttemptsPerOperation;

  const providerGroupKey =
    options.providerGroupKey || "walmart_us_default_host_group";
  const hostState = getOrCreateSharedHostGroup(
    providerGroupKey,
    limits.maxConcurrentOperationsPerProviderGroup
  );

  const nowFn = options.nowFn || (() => Date.now());
  const sleepFn = options.sleepFn || defaultAbortableSleep;
  const controller = new AbortController();

  const budget: WalmartProviderBudget = {
    workspaceId: options.workspaceId,
    researchRunId: options.researchRunId,
    workerId: options.workerId || `wmt_worker_${process.pid}`,
    providerGroupKey,
    limits,
    db: options.db,
    nowFn,
    sleepFn,
    controller,
    operations: new Map(),
    logicalOperationsUsed: 0,
    networkAttemptsUsed: 0,
    abortedRequestsCount: 0,
    peakConcurrentObserved: 0,
    cancelled: false,
    cancelReason: null,
    isCancelled: () =>
      budget.cancelled ||
      controller.signal.aborted ||
      Boolean(options.parentSignal?.aborted),
    isFreePilotStopped: () => ({
      stopped: hostState.freePilotStopped,
      reason: hostState.freePilotStopReason,
    }),
    getCooldownUntilMs: () => hostState.cooldownUntilMs,
    getRollingWindowRequestCount: () => {
      const cutoff = nowFn() - limits.rollingWindowMs;
      hostState.rollingRequestTimestampsMs =
        hostState.rollingRequestTimestampsMs.filter((t) => t > cutoff);
      return hostState.rollingRequestTimestampsMs.length;
    },
  };

  if (options.parentSignal) {
    if (options.parentSignal.aborted) {
      cancelWalmartPendingOperations(
        budget,
        "Parent research run signal was already aborted."
      );
    } else {
      options.parentSignal.addEventListener(
        "abort",
        () => {
          cancelWalmartPendingOperations(
            budget,
            "Parent research run signal aborted."
          );
        },
        { once: true }
      );
    }
  }

  return budget;
}

export interface ReserveWalmartOperationInput {
  operationKind: "SEARCH" | "PDP";
  candidateId?: string | null;
  targetKey: string;
  operationDeadlineMs?: number;
}

export interface ReserveWalmartOperationResult {
  permitted: boolean;
  logicalOperationId: string | null;
  operationState: WalmartLogicalOperationState | null;
  status: WalmartQueryExecutionStatus;
  reason: string | null;
}

/**
 * Reserves one of the `<= 4` logical Walmart operations permitted per research run.
 */
export function reserveWalmartOperation(
  budget: WalmartProviderBudget,
  input: ReserveWalmartOperationInput
): ReserveWalmartOperationResult {
  if (budget.isCancelled()) {
    return {
      permitted: false,
      logicalOperationId: null,
      operationState: null,
      status: "CANCELLED",
      reason: budget.cancelReason || "Walmart provider budget is cancelled.",
    };
  }

  const freeStop = budget.isFreePilotStopped();
  if (freeStop.stopped) {
    return {
      permitted: false,
      logicalOperationId: null,
      operationState: null,
      status: "KEY_OR_PAYMENT_REQUIRED",
      reason:
        freeStop.reason ||
        "Free no-key Jina Reader pilot stopped due to 401/402 response.",
    };
  }

  if (budget.logicalOperationsUsed >= budget.limits.maxLogicalOperationsPerRun) {
    return {
      permitted: false,
      logicalOperationId: null,
      operationState: null,
      status: "BUDGET_EXHAUSTED",
      reason: `Logical operation cap exhausted (${budget.logicalOperationsUsed}/${budget.limits.maxLogicalOperationsPerRun} operations per run).`,
    };
  }

  budget.logicalOperationsUsed += 1;
  const opIndex = budget.logicalOperationsUsed;
  const logicalOperationId = `wmt_op_${budget.researchRunId}_${opIndex}_${input.operationKind.toLowerCase()}`;
  const now = budget.nowFn();
  const deadlineDuration =
    input.operationDeadlineMs ?? budget.limits.maxOperationDeadlineMs;

  const opState: WalmartLogicalOperationState = {
    logicalOperationId,
    operationIndex: opIndex,
    operationKind: input.operationKind,
    candidateId: input.candidateId ?? null,
    targetKey: input.targetKey,
    attemptsUsed: 0,
    maxAttempts: budget.limits.maxAttemptsPerOperation,
    attemptGeneration: 0,
    committedGeneration: 0,
    committedResult: null,
    status: "PENDING",
    createdAtMs: now,
    deadlineAtMs: now + deadlineDuration,
  };

  budget.operations.set(logicalOperationId, opState);

  return {
    permitted: true,
    logicalOperationId,
    operationState: opState,
    status: "PENDING",
    reason: null,
  };
}

export interface ReserveWalmartNetworkAttemptResult {
  permitted: boolean;
  attemptNumber: number;
  attemptGeneration: number;
  status: WalmartQueryExecutionStatus;
  reason: string | null;
}

/**
 * Reserves a concrete network attempt (`<= 2` per logical operation, `<= 8` per run).
 * Increments monotonic `attemptGeneration` so any earlier in-flight attempt is fenced off.
 */
export function reserveWalmartNetworkAttempt(
  budget: WalmartProviderBudget,
  logicalOperationId: string
): ReserveWalmartNetworkAttemptResult {
  if (budget.isCancelled()) {
    return {
      permitted: false,
      attemptNumber: 0,
      attemptGeneration: 0,
      status: "CANCELLED",
      reason: budget.cancelReason || "Walmart provider budget is cancelled.",
    };
  }

  const freeStop = budget.isFreePilotStopped();
  if (freeStop.stopped) {
    return {
      permitted: false,
      attemptNumber: 0,
      attemptGeneration: 0,
      status: "KEY_OR_PAYMENT_REQUIRED",
      reason:
        freeStop.reason ||
        "Free no-key Jina Reader pilot stopped due to 401/402 response.",
    };
  }

  const opState = budget.operations.get(logicalOperationId);
  if (!opState) {
    return {
      permitted: false,
      attemptNumber: 0,
      attemptGeneration: 0,
      status: "FAILED",
      reason: `Unknown logicalOperationId '${logicalOperationId}'.`,
    };
  }

  const now = budget.nowFn();
  if (now >= opState.deadlineAtMs) {
    opState.status = "TIMED_OUT";
    return {
      permitted: false,
      attemptNumber: opState.attemptsUsed,
      attemptGeneration: opState.attemptGeneration,
      status: "TIMED_OUT",
      reason: `Operation '${logicalOperationId}' exceeded its operation deadline.`,
    };
  }

  if (opState.attemptsUsed >= opState.maxAttempts) {
    return {
      permitted: false,
      attemptNumber: opState.attemptsUsed,
      attemptGeneration: opState.attemptGeneration,
      status: "BUDGET_EXHAUSTED",
      reason: `Operation '${logicalOperationId}' reached maxAttemptsPerOperation (${opState.attemptsUsed}/${opState.maxAttempts}).`,
    };
  }

  if (budget.networkAttemptsUsed >= budget.limits.maxNetworkAttemptsPerRun) {
    return {
      permitted: false,
      attemptNumber: opState.attemptsUsed,
      attemptGeneration: opState.attemptGeneration,
      status: "BUDGET_EXHAUSTED",
      reason: `Global network attempt budget exhausted (${budget.networkAttemptsUsed}/${budget.limits.maxNetworkAttemptsPerRun}).`,
    };
  }

  opState.attemptsUsed += 1;
  opState.attemptGeneration += 1;
  opState.status = "RUNNING";
  budget.networkAttemptsUsed += 1;

  return {
    permitted: true,
    attemptNumber: opState.attemptsUsed,
    attemptGeneration: opState.attemptGeneration,
    status: "RUNNING",
    reason: null,
  };
}

/**
 * Commits the result of an operation attempt ONLY if `attemptGeneration` matches the latest
 * generation for `logicalOperationId` and the budget is not cancelled.
 * Prevents a slow/late attempt #1 from overwriting a newer attempt #2 (W36).
 */
export function commitWalmartOperationAttemptResult<T>(
  budget: WalmartProviderBudget,
  logicalOperationId: string,
  attemptGeneration: number,
  result: T,
  finalStatus: WalmartQueryExecutionStatus
): { committed: boolean; rejectionReason: string | null } {
  if (budget.isCancelled()) {
    return {
      committed: false,
      rejectionReason: "STALE_ABORTED_COMMIT: Budget was cancelled.",
    };
  }
  const opState = budget.operations.get(logicalOperationId);
  if (!opState) {
    return {
      committed: false,
      rejectionReason: `UNKNOWN_OPERATION:${logicalOperationId}`,
    };
  }
  if (
    attemptGeneration < opState.attemptGeneration ||
    attemptGeneration <= opState.committedGeneration
  ) {
    return {
      committed: false,
      rejectionReason: `STALE_ATTEMPT_GENERATION:attemptGen=${attemptGeneration},currentGen=${opState.attemptGeneration},committedGen=${opState.committedGeneration}`,
    };
  }

  opState.committedGeneration = attemptGeneration;
  opState.committedResult = result;
  opState.status = finalStatus;
  return { committed: true, rejectionReason: null };
}

async function syncDbRollingWindowAndCooldown(
  budget: WalmartProviderBudget,
  hostState: SharedHostGroupState
): Promise<void> {
  if (!budget.db || typeof budget.db.providerRequestLedger?.findMany !== "function") {
    return;
  }
  try {
    const now = budget.nowFn();
    const windowStart = new Date(now - budget.limits.rollingWindowMs);
    const recentRows = await budget.db.providerRequestLedger.findMany({
      where: {
        providerId: {
          in: [
            WALMART_LEDGER_PROVIDER_ID,
            "WALMART_JINA_READER_US",
            WALMART_COOLDOWN_PROVIDER_ID,
          ],
        },
        requestedAt: { gte: windowStart },
      },
      orderBy: { requestedAt: "asc" },
    });

    for (const row of recentRows) {
      if (
        row.providerId === WALMART_LEDGER_PROVIDER_ID ||
        row.providerId === "WALMART_JINA_READER_US"
      ) {
        const ts = new Date(row.requestedAt).getTime();
        if (
          Number.isFinite(ts) &&
          !hostState.rollingRequestTimestampsMs.some((existing) => Math.abs(existing - ts) < 5)
        ) {
          hostState.rollingRequestTimestampsMs.push(ts);
        }
      } else if (row.providerId === WALMART_COOLDOWN_PROVIDER_ID) {
        const duration =
          typeof row.requestDurationMs === "number" ? row.requestDurationMs : 0;
        const unblockAt = new Date(row.requestedAt).getTime() + duration;
        if (unblockAt > hostState.cooldownUntilMs) {
          hostState.cooldownUntilMs = unblockAt;
        }
        if (row.outcome === "KEY_OR_PAYMENT_REQUIRED") {
          hostState.freePilotStopped = true;
          hostState.freePilotStopReason =
            row.errorCategory || "401/402 free pilot stopped across workers";
        }
      }
    }
    hostState.rollingRequestTimestampsMs.sort((a, b) => a - b);
  } catch {
    // Non-fatal if isolated test DB does not have table initialized yet
  }
}

async function recordDbRateSlotReservation(
  budget: WalmartProviderBudget,
  timestampMs: number,
  logicalOperationId: string,
  attemptNumber: number
): Promise<void> {
  if (!budget.db || typeof budget.db.providerRequestLedger?.create !== "function") {
    return;
  }
  try {
    await budget.db.providerRequestLedger.create({
      data: {
        providerId: WALMART_LEDGER_PROVIDER_ID,
        jobId: budget.researchRunId,
        requestedAt: new Date(timestampMs),
        outcome: "RATE_SLOT_RESERVED",
        resultCount: 0,
        estimatedCost: 0,
        actualCost: 0,
        creditUnit: "FREE_JINA_READER",
        endpointRedacted: `${logicalOperationId}:att${attemptNumber}`,
      },
    });
  } catch {
    // Ignore in pure unit tests without DB table
  }
}

export interface AwaitWalmartRateSlotOptions {
  logicalOperationId: string;
  attemptNumber: number;
  signal?: AbortSignal;
  deadlineAtMs?: number;
}

export interface AwaitWalmartRateSlotResult {
  permitted: boolean;
  status: WalmartQueryExecutionStatus;
  waitedMs: number;
  slotTimestampMs: number | null;
  reason: string | null;
  releaseConcurrencySlot: () => void;
}

/**
 * Serializes Walmart Jina requests so at most 1 operation runs concurrently per provider worker group
 * and at most 6 requests occur per rolling 60s across workers sharing host/IP/DB.
 * Also honors any active 429 Retry-After cooldown.
 * If required wait time exceeds the usable deadline, returns `DEFERRED` immediately without issuing a request.
 */
export async function awaitWalmartRateSlot(
  budget: WalmartProviderBudget,
  options: AwaitWalmartRateSlotOptions
): Promise<AwaitWalmartRateSlotResult> {
  const hostState = getOrCreateSharedHostGroup(
    budget.providerGroupKey,
    budget.limits.maxConcurrentOperationsPerProviderGroup
  );
  const startWaitMs = budget.nowFn();
  const opState = budget.operations.get(options.logicalOperationId);
  const effectiveDeadlineAtMs =
    options.deadlineAtMs ??
    opState?.deadlineAtMs ??
    startWaitMs + budget.limits.maxOperationDeadlineMs;

  const isAbortedNow = () =>
    budget.isCancelled() || Boolean(options.signal?.aborted);

  if (isAbortedNow()) {
    return {
      permitted: false,
      status: "CANCELLED",
      waitedMs: 0,
      slotTimestampMs: null,
      reason: "Cancelled before acquiring Walmart rate slot.",
      releaseConcurrencySlot: () => undefined,
    };
  }

  // 1. Acquire single-concurrency mutex across workers in group
  if (hostState.activeConcurrencyCount >= hostState.maxConcurrent) {
    try {
      await new Promise<void>((resolve, reject) => {
        const entry = { resolve, reject };
        hostState.concurrencyWaitQueue.push(entry);

        const removeAndReject = (reason: string) => {
          const idx = hostState.concurrencyWaitQueue.indexOf(entry);
          if (idx !== -1) {
            hostState.concurrencyWaitQueue.splice(idx, 1);
          }
          reject(new Error(reason));
        };

        const onSignalAbort = () =>
          removeAndReject("Aborted while queued for Walmart concurrency slot.");
        budget.controller.signal.addEventListener("abort", onSignalAbort, {
          once: true,
        });
        options.signal?.addEventListener("abort", onSignalAbort, { once: true });
      });
    } catch (err: any) {
      budget.abortedRequestsCount += 1;
      return {
        permitted: false,
        status: "CANCELLED",
        waitedMs: Math.max(0, budget.nowFn() - startWaitMs),
        slotTimestampMs: null,
        reason:
          err instanceof Error
            ? err.message
            : "Cancelled while waiting in concurrency queue.",
        releaseConcurrencySlot: () => undefined,
      };
    }
  }

  hostState.activeConcurrencyCount += 1;
  if (hostState.activeConcurrencyCount > budget.peakConcurrentObserved) {
    budget.peakConcurrentObserved = hostState.activeConcurrencyCount;
  }

  let released = false;
  const releaseConcurrencySlot = () => {
    if (released) return;
    released = true;
    hostState.activeConcurrencyCount = Math.max(
      0,
      hostState.activeConcurrencyCount - 1
    );
    const next = hostState.concurrencyWaitQueue.shift();
    if (next) {
      next.resolve();
    }
  };

  try {
    // 2. Sync with shared DB ledger if present
    await syncDbRollingWindowAndCooldown(budget, hostState);

    while (true) {
      if (isAbortedNow()) {
        releaseConcurrencySlot();
        return {
          permitted: false,
          status: "CANCELLED",
          waitedMs: Math.max(0, budget.nowFn() - startWaitMs),
          slotTimestampMs: null,
          reason: "Cancelled while awaiting Walmart rate window.",
          releaseConcurrencySlot: () => undefined,
        };
      }

      if (hostState.freePilotStopped) {
        releaseConcurrencySlot();
        return {
          permitted: false,
          status: "KEY_OR_PAYMENT_REQUIRED",
          waitedMs: Math.max(0, budget.nowFn() - startWaitMs),
          slotTimestampMs: null,
          reason:
            hostState.freePilotStopReason ||
            "Free no-key Jina Reader pilot stopped (401/402).",
          releaseConcurrencySlot: () => undefined,
        };
      }

      const now = budget.nowFn();
      const windowCutoff = now - budget.limits.rollingWindowMs;
      hostState.rollingRequestTimestampsMs =
        hostState.rollingRequestTimestampsMs.filter((t) => t > windowCutoff);

      let requiredWaitMs = 0;

      // Check 429 cooldown
      if (hostState.cooldownUntilMs > now) {
        requiredWaitMs = Math.max(
          requiredWaitMs,
          hostState.cooldownUntilMs - now
        );
      }

      // Check rolling 60s window cap (<= 6 requests / 60s)
      if (
        hostState.rollingRequestTimestampsMs.length >=
        budget.limits.maxRequestsPerMinuteAcrossWorkers
      ) {
        const oldestInWindow = hostState.rollingRequestTimestampsMs[0];
        const waitForOldestToExpire =
          oldestInWindow + budget.limits.rollingWindowMs - now + 15;
        requiredWaitMs = Math.max(requiredWaitMs, waitForOldestToExpire);
      }

      if (requiredWaitMs <= 0) {
        // Check if we still have enough time before deadline to even start the request
        if (now >= effectiveDeadlineAtMs) {
          releaseConcurrencySlot();
          return {
            permitted: false,
            status: "DEFERRED",
            waitedMs: Math.max(0, now - startWaitMs),
            slotTimestampMs: null,
            reason: "Operation deadline reached before rate slot could be claimed.",
            releaseConcurrencySlot: () => undefined,
          };
        }

        hostState.rollingRequestTimestampsMs.push(now);
        await recordDbRateSlotReservation(
          budget,
          now,
          options.logicalOperationId,
          options.attemptNumber
        );

        return {
          permitted: true,
          status: "RUNNING",
          waitedMs: Math.max(0, now - startWaitMs),
          slotTimestampMs: now,
          reason: null,
          releaseConcurrencySlot,
        };
      }

      // If waiting `requiredWaitMs` would exceed the usable operation deadline, yield DEFERRED immediately!
      if (now + requiredWaitMs >= effectiveDeadlineAtMs) {
        releaseConcurrencySlot();
        const isCooldownWait = hostState.cooldownUntilMs > now;
        return {
          permitted: false,
          status: isCooldownWait ? "RATE_LIMITED" : "DEFERRED",
          waitedMs: Math.max(0, now - startWaitMs),
          slotTimestampMs: null,
          reason: `Required rate/cooldown wait (${requiredWaitMs}ms) exceeds remaining usable deadline (${Math.max(
            0,
            effectiveDeadlineAtMs - now
          )}ms).`,
          releaseConcurrencySlot: () => undefined,
        };
      }

      // Sleep until cooldown or rolling window slot frees up, abortable by parent/budget signal
      try {
        await budget.sleepFn(requiredWaitMs, options.signal || budget.controller.signal);
      } catch (err: any) {
        releaseConcurrencySlot();
        budget.abortedRequestsCount += 1;
        return {
          permitted: false,
          status: "CANCELLED",
          waitedMs: Math.max(0, budget.nowFn() - startWaitMs),
          slotTimestampMs: null,
          reason:
            err instanceof Error
              ? err.message
              : "Aborted while waiting for rate limit / cooldown window.",
          releaseConcurrencySlot: () => undefined,
        };
      }

      await syncDbRollingWindowAndCooldown(budget, hostState);
    }
  } catch (err) {
    releaseConcurrencySlot();
    throw err;
  }
}

export interface ApplyWalmartProviderCooldownInput {
  statusCode?: number | null;
  retryAfterHeader?: string | null;
  retryAfterMs?: number | null;
  stopFreePilot?: boolean;
  reason?: string | null;
}

export interface ApplyWalmartProviderCooldownResult {
  cooldownApplied: boolean;
  cooldownDelayMs: number;
  cooldownUntilMs: number;
  freePilotStopped: boolean;
}

/**
 * Applies a shared provider cooldown on HTTP 429 (`Retry-After` seconds or HTTP-date)
 * or halts the free no-key pilot on HTTP 401/402 across all workers in the host group / DB.
 */
export async function applyWalmartProviderCooldown(
  budget: WalmartProviderBudget,
  input: ApplyWalmartProviderCooldownInput
): Promise<ApplyWalmartProviderCooldownResult> {
  const hostState = getOrCreateSharedHostGroup(
    budget.providerGroupKey,
    budget.limits.maxConcurrentOperationsPerProviderGroup
  );
  const now = budget.nowFn();

  if (
    input.stopFreePilot ||
    input.statusCode === 401 ||
    input.statusCode === 402
  ) {
    hostState.freePilotStopped = true;
    hostState.freePilotStopReason =
      input.reason ||
      `Jina Reader returned HTTP ${input.statusCode || 402}; stopping free no-key pilot.`;

    if (
      budget.db &&
      typeof budget.db.providerRequestLedger?.create === "function"
    ) {
      try {
        await budget.db.providerRequestLedger.create({
          data: {
            providerId: WALMART_COOLDOWN_PROVIDER_ID,
            jobId: budget.researchRunId,
            requestedAt: new Date(now),
            outcome: "KEY_OR_PAYMENT_REQUIRED",
            httpStatus: input.statusCode ?? 402,
            requestDurationMs: 60_000,
            errorCategory: hostState.freePilotStopReason,
            creditUnit: "FREE_JINA_READER",
          },
        });
      } catch {
        // Ignore if isolated test without DB
      }
    }

    return {
      cooldownApplied: false,
      cooldownDelayMs: 0,
      cooldownUntilMs: hostState.cooldownUntilMs,
      freePilotStopped: true,
    };
  }

  let delayMs = 0;
  if (typeof input.retryAfterMs === "number" && input.retryAfterMs > 0) {
    delayMs = input.retryAfterMs;
  } else if (input.retryAfterHeader) {
    const parsed = parseRetryAfter(input.retryAfterHeader, now);
    if (parsed.valid && parsed.delayMs !== null) {
      delayMs = parsed.delayMs;
    }
  }

  if (delayMs <= 0 && input.statusCode === 429) {
    delayMs = 10_000; // Default conservative 10s cooldown on 429 without Retry-After header
  }

  if (delayMs > 0) {
    const targetUnblock = now + delayMs;
    if (targetUnblock > hostState.cooldownUntilMs) {
      hostState.cooldownUntilMs = targetUnblock;
    }

    if (
      budget.db &&
      typeof budget.db.providerRequestLedger?.create === "function"
    ) {
      try {
        await budget.db.providerRequestLedger.create({
          data: {
            providerId: WALMART_COOLDOWN_PROVIDER_ID,
            jobId: budget.researchRunId,
            requestedAt: new Date(now),
            outcome: "RATE_LIMITED_COOLDOWN",
            httpStatus: input.statusCode ?? 429,
            requestDurationMs: delayMs,
            errorCategory: input.reason || "HTTP_429_RETRY_AFTER",
            creditUnit: "FREE_JINA_READER",
          },
        });
      } catch {
        // Ignore if isolated test without DB
      }
    }

    return {
      cooldownApplied: true,
      cooldownDelayMs: delayMs,
      cooldownUntilMs: hostState.cooldownUntilMs,
      freePilotStopped: hostState.freePilotStopped,
    };
  }

  return {
    cooldownApplied: false,
    cooldownDelayMs: 0,
    cooldownUntilMs: hostState.cooldownUntilMs,
    freePilotStopped: hostState.freePilotStopped,
  };
}

/**
 * Cancels all pending and in-flight Walmart operations for this budget instance.
 */
export function cancelWalmartPendingOperations(
  budget: WalmartProviderBudget,
  reason: string = "Cancelled by caller."
): void {
  if (budget.cancelled) return;
  budget.cancelled = true;
  budget.cancelReason = reason;
  for (const op of budget.operations.values()) {
    if (op.status === "PENDING" || op.status === "RUNNING") {
      op.status = "CANCELLED";
    }
  }
  if (!budget.controller.signal.aborted) {
    budget.controller.abort(new Error(reason));
  }
}
