/**
 * SWAI KH-02 V12.4.3.5.0 — Amazon US Protective Pilot Budget & Concurrency Coordinator
 *
 * Enforces protective pilot caps (Section 2.4, 3.3, A10, A11, A12):
 * 1. Concurrency = 1 per workspace/provider (no parallel Amazon requests).
 * 2. Max 4 provider operations per research run (no 5th operation).
 * 3. Max 2 attempts per operation (initial + at most 1 retry on transient error; 0 retries on 403/429/CAPTCHA/policy block).
 * 4. Rolling 5-minute navigation window: max 4 main navigations per 300,000 ms per workspace/provider.
 * 5. Early stop on external block / rate-limit / CAPTCHA (halts remaining candidates in the run).
 * 6. Immediate cleanup of owned MCP sessions / browser child processes on abort or timeout.
 */

export const AMAZON_PILOT_MAX_CONCURRENCY = 1;
export const AMAZON_PILOT_MAX_OPERATIONS_PER_RUN = 4;
export const AMAZON_PILOT_MAX_CANDIDATES_PER_RUN = 3;
export const AMAZON_PILOT_MAX_ATTEMPTS_PER_OPERATION = 2;
export const AMAZON_PILOT_ROLLING_WINDOW_MS = 5 * 60 * 1000; // 5 minutes
export const AMAZON_PILOT_MAX_NAVIGATIONS_PER_WINDOW = 4;
export const AMAZON_PILOT_DEFAULT_OPERATION_TIMEOUT_MS = 20_000;

export interface AmazonProviderBudgetContext {
  workspaceId: string;
  researchRunId: string;
  maxOperationsPerRun?: number;
  maxAttemptsPerOperation?: number;
  maxNavigationsPerRollingWindow?: number;
  rollingWindowMs?: number;
  operationTimeoutMs?: number;
  signal?: AbortSignal;
  nowMs?: () => number;
  isolatedCoordinator?: boolean;
}

export interface BudgetAcquisitionDecision {
  allowed: boolean;
  reasonCode:
    | "ALLOWED"
    | "BUDGET_ABORTED"
    | "PROVIDER_EARLY_STOP_BLOCKED"
    | "CONCURRENCY_LIMIT_EXCEEDED"
    | "RUN_OPERATION_CAP_EXCEEDED"
    | "OPERATION_ATTEMPT_CAP_EXCEEDED"
    | "ROLLING_WINDOW_RATE_LIMITED";
  reason: string;
  operationsUsedInRun: number;
  rollingWindowNavigationsUsed: number;
  activeConcurrentCount: number;
}

export interface AmazonProviderBudget {
  readonly workspaceId: string;
  readonly researchRunId: string;
  readonly maxOperationsPerRun: number;
  readonly maxAttemptsPerOperation: number;
  readonly maxNavigationsPerRollingWindow: number;
  readonly rollingWindowMs: number;
  readonly operationTimeoutMs: number;
  canAcquireOperation(operationKey: string, attemptNumber?: number): BudgetAcquisitionDecision;
  executeBoundedOperation<T>(
    operationKey: string,
    fn: (attemptNumber: number, opSignal: AbortSignal) => Promise<T>,
    options?: {
      maxAttempts?: number;
      shouldRetry?: (err: unknown, attemptNumber: number) => boolean;
      isExternalBlockResult?: (result: T) => boolean;
    }
  ): Promise<{
    executed: boolean;
    attemptCount: number;
    result?: T;
    blockedDecision?: BudgetAcquisitionDecision;
    aborted: boolean;
    error?: string;
  }>;
  markExternalBlockEncountered(reason: string): void;
  registerCleanup(cleanupFn: () => Promise<void> | void): () => void;
  abortAndCleanup(reason?: string): Promise<void>;
  getSnapshot(): {
    workspaceId: string;
    researchRunId: string;
    maxConcurrency: number;
    activeConcurrentCount: number;
    operationsUsedInRun: number;
    maxOperationsPerRun: number;
    maxAttemptsPerOperation: number;
    rollingWindowNavigationsUsed: number;
    maxNavigationsPerRollingWindow: number;
    aborted: boolean;
    abortReason: string | null;
    earlyStopBlocked: boolean;
    earlyStopReason: string | null;
    cleanupCallbacksExecuted: number;
  };
}

interface WorkspaceRollingState {
  activeConcurrentCount: number;
  navigationTimestampsMs: number[];
}

const sharedWorkspaceCoordinators = new Map<string, WorkspaceRollingState>();

export function resetSharedAmazonBudgetCoordinatorsForTest(): void {
  sharedWorkspaceCoordinators.clear();
}

export function createAmazonProviderBudget(
  context: AmazonProviderBudgetContext
): AmazonProviderBudget {
  const workspaceId = (context.workspaceId || "default-workspace").trim();
  const researchRunId = (context.researchRunId || "unknown-run").trim();
  const maxOperationsPerRun = Math.min(
    AMAZON_PILOT_MAX_OPERATIONS_PER_RUN,
    Math.max(1, context.maxOperationsPerRun ?? AMAZON_PILOT_MAX_OPERATIONS_PER_RUN)
  );
  const maxAttemptsPerOperation = Math.min(
    AMAZON_PILOT_MAX_ATTEMPTS_PER_OPERATION,
    Math.max(1, context.maxAttemptsPerOperation ?? AMAZON_PILOT_MAX_ATTEMPTS_PER_OPERATION)
  );
  const maxNavigationsPerRollingWindow = Math.min(
    AMAZON_PILOT_MAX_NAVIGATIONS_PER_WINDOW,
    Math.max(
      1,
      context.maxNavigationsPerRollingWindow ?? AMAZON_PILOT_MAX_NAVIGATIONS_PER_WINDOW
    )
  );
  const rollingWindowMs = context.rollingWindowMs ?? AMAZON_PILOT_ROLLING_WINDOW_MS;
  const operationTimeoutMs =
    context.operationTimeoutMs ?? AMAZON_PILOT_DEFAULT_OPERATION_TIMEOUT_MS;
  const nowMs = context.nowMs ?? (() => Date.now());

  const coordinatorKey = context.isolatedCoordinator
    ? `${workspaceId}:${researchRunId}:AMAZON_US`
    : `${workspaceId}:AMAZON_US`;

  const getCoordinator = (): WorkspaceRollingState => {
    let state = sharedWorkspaceCoordinators.get(coordinatorKey);
    if (!state) {
      state = { activeConcurrentCount: 0, navigationTimestampsMs: [] };
      sharedWorkspaceCoordinators.set(coordinatorKey, state);
    }
    const cutoff = nowMs() - rollingWindowMs;
    state.navigationTimestampsMs = state.navigationTimestampsMs.filter((t) => t > cutoff);
    return state;
  };

  let operationsUsedInRun = 0;
  const attemptsByOperationKey = new Map<string, number>();
  let aborted = Boolean(context.signal?.aborted);
  let abortReason: string | null = aborted
    ? String(context.signal?.reason || "Parent signal already aborted")
    : null;
  let earlyStopBlocked = false;
  let earlyStopReason: string | null = null;
  let cleanupCallbacksExecuted = 0;
  const cleanupSet = new Set<() => Promise<void> | void>();

  const runCleanups = async () => {
    const fns = Array.from(cleanupSet);
    cleanupSet.clear();
    for (const fn of fns) {
      try {
        await fn();
        cleanupCallbacksExecuted++;
      } catch {
        cleanupCallbacksExecuted++;
      }
    }
  };

  if (context.signal) {
    if (context.signal.aborted) {
      aborted = true;
      abortReason = String(context.signal.reason || "Parent signal aborted");
      void runCleanups();
    } else {
      context.signal.addEventListener(
        "abort",
        () => {
          aborted = true;
          abortReason = String(context.signal?.reason || "Parent signal aborted");
          void runCleanups();
        },
        { once: true }
      );
    }
  }

  const canAcquireOperation = (
    operationKey: string,
    attemptNumber: number = 1
  ): BudgetAcquisitionDecision => {
    const coord = getCoordinator();

    if (aborted || context.signal?.aborted) {
      aborted = true;
      return {
        allowed: false,
        reasonCode: "BUDGET_ABORTED",
        reason: abortReason || "Operation aborted by cancellation or worker deadline.",
        operationsUsedInRun,
        rollingWindowNavigationsUsed: coord.navigationTimestampsMs.length,
        activeConcurrentCount: coord.activeConcurrentCount,
      };
    }

    if (earlyStopBlocked) {
      return {
        allowed: false,
        reasonCode: "PROVIDER_EARLY_STOP_BLOCKED",
        reason:
          earlyStopReason ||
          "Provider halted early after encountering external block, CAPTCHA, or rate limit.",
        operationsUsedInRun,
        rollingWindowNavigationsUsed: coord.navigationTimestampsMs.length,
        activeConcurrentCount: coord.activeConcurrentCount,
      };
    }

    if (coord.activeConcurrentCount >= AMAZON_PILOT_MAX_CONCURRENCY) {
      return {
        allowed: false,
        reasonCode: "CONCURRENCY_LIMIT_EXCEEDED",
        reason: `Amazon US pilot concurrency limit (${AMAZON_PILOT_MAX_CONCURRENCY}) exceeded for workspace '${workspaceId}'.`,
        operationsUsedInRun,
        rollingWindowNavigationsUsed: coord.navigationTimestampsMs.length,
        activeConcurrentCount: coord.activeConcurrentCount,
      };
    }

    const recordedAttempts = attemptsByOperationKey.get(operationKey) || 0;
    if (attemptNumber > maxAttemptsPerOperation || recordedAttempts >= maxAttemptsPerOperation) {
      return {
        allowed: false,
        reasonCode: "OPERATION_ATTEMPT_CAP_EXCEEDED",
        reason: `Operation '${operationKey}' reached max attempts cap (${maxAttemptsPerOperation}).`,
        operationsUsedInRun,
        rollingWindowNavigationsUsed: coord.navigationTimestampsMs.length,
        activeConcurrentCount: coord.activeConcurrentCount,
      };
    }

    // Only count a new operation slot on attempt 1
    if (attemptNumber === 1 && operationsUsedInRun >= maxOperationsPerRun) {
      return {
        allowed: false,
        reasonCode: "RUN_OPERATION_CAP_EXCEEDED",
        reason: `Research run '${researchRunId}' reached max Amazon provider operations cap (${maxOperationsPerRun}).`,
        operationsUsedInRun,
        rollingWindowNavigationsUsed: coord.navigationTimestampsMs.length,
        activeConcurrentCount: coord.activeConcurrentCount,
      };
    }

    if (coord.navigationTimestampsMs.length >= maxNavigationsPerRollingWindow) {
      return {
        allowed: false,
        reasonCode: "ROLLING_WINDOW_RATE_LIMITED",
        reason: `Rolling 5-minute navigation cap (${maxNavigationsPerRollingWindow} navigations per ${rollingWindowMs}ms) reached for workspace '${workspaceId}'.`,
        operationsUsedInRun,
        rollingWindowNavigationsUsed: coord.navigationTimestampsMs.length,
        activeConcurrentCount: coord.activeConcurrentCount,
      };
    }

    return {
      allowed: true,
      reasonCode: "ALLOWED",
      reason: "Within protective pilot budget.",
      operationsUsedInRun,
      rollingWindowNavigationsUsed: coord.navigationTimestampsMs.length,
      activeConcurrentCount: coord.activeConcurrentCount,
    };
  };

  return {
    workspaceId,
    researchRunId,
    maxOperationsPerRun,
    maxAttemptsPerOperation,
    maxNavigationsPerRollingWindow,
    rollingWindowMs,
    operationTimeoutMs,
    canAcquireOperation,
    async executeBoundedOperation<T>(
      operationKey: string,
      fn: (attemptNumber: number, opSignal: AbortSignal) => Promise<T>,
      options?: {
        maxAttempts?: number;
        shouldRetry?: (err: unknown, attemptNumber: number) => boolean;
        isExternalBlockResult?: (result: T) => boolean;
      }
    ) {
      const effectiveMaxAttempts = Math.min(
        maxAttemptsPerOperation,
        Math.max(1, options?.maxAttempts ?? maxAttemptsPerOperation)
      );

      let attemptCount = 0;
      let lastError: string | undefined;

      while (attemptCount < effectiveMaxAttempts) {
        const nextAttempt = attemptCount + 1;
        const decision = canAcquireOperation(operationKey, nextAttempt);
        if (!decision.allowed) {
          return {
            executed: attemptCount > 0,
            attemptCount,
            blockedDecision: decision,
            aborted,
            error: decision.reason,
          };
        }

        const coord = getCoordinator();
        coord.activeConcurrentCount++;
        if (nextAttempt === 1) {
          operationsUsedInRun++;
        }
        attemptsByOperationKey.set(operationKey, nextAttempt);
        coord.navigationTimestampsMs.push(nowMs());
        attemptCount = nextAttempt;

        const opController = new AbortController();
        let timer: NodeJS.Timeout | null = null;
        const onParentAbort = () => {
          opController.abort(
            context.signal?.reason || new Error("Parent research run aborted.")
          );
        };
        if (context.signal) {
          if (context.signal.aborted) {
            opController.abort(context.signal.reason);
          } else {
            context.signal.addEventListener("abort", onParentAbort, { once: true });
          }
        }

        try {
          const timeoutPromise = new Promise<never>((_, reject) => {
            timer = setTimeout(() => {
              opController.abort(new Error(`OPERATION_TIMED_OUT_${operationTimeoutMs}MS`));
              reject(new Error(`OPERATION_TIMED_OUT_${operationTimeoutMs}MS`));
            }, operationTimeoutMs);
          });

          const result = await Promise.race([
            fn(nextAttempt, opController.signal),
            timeoutPromise,
          ]);

          if (aborted || context.signal?.aborted) {
            await runCleanups();
            return {
              executed: true,
              attemptCount,
              aborted: true,
              error: abortReason || "Operation aborted before completion.",
            };
          }

          if (options?.isExternalBlockResult?.(result)) {
            earlyStopBlocked = true;
            earlyStopReason =
              "Halted remaining provider operations after external block, CAPTCHA, or rate limit.";
          }

          return {
            executed: true,
            attemptCount,
            result,
            aborted: false,
          };
        } catch (err: any) {
          const errMessage = String(err?.message || err || "Unknown operation error");
          lastError = errMessage;
          const msgLower = errMessage.toLowerCase();
          if (
            aborted ||
            context.signal?.aborted ||
            msgLower.includes("abort") ||
            msgLower.includes("ownership_lost")
          ) {
            aborted = true;
            abortReason = errMessage;
            await runCleanups();
            return {
              executed: true,
              attemptCount,
              aborted: true,
              error: errMessage,
            };
          }

          // Never retry on 403, 429, CAPTCHA, bot wall, or policy block
          if (
            msgLower.includes("403") ||
            msgLower.includes("429") ||
            msgLower.includes("captcha") ||
            msgLower.includes("bot_wall") ||
            msgLower.includes("blocked_policy") ||
            msgLower.includes("rate_limit")
          ) {
            earlyStopBlocked = true;
            earlyStopReason = errMessage;
            return {
              executed: true,
              attemptCount,
              aborted: false,
              error: errMessage,
            };
          }

          const allowRetry =
            nextAttempt < effectiveMaxAttempts &&
            (options?.shouldRetry ? options.shouldRetry(err, nextAttempt) : true);
          if (!allowRetry) {
            return {
              executed: true,
              attemptCount,
              aborted: false,
              error: lastError,
            };
          }
        } finally {
          if (timer) clearTimeout(timer);
          if (context.signal) {
            context.signal.removeEventListener("abort", onParentAbort);
          }
          coord.activeConcurrentCount = Math.max(0, coord.activeConcurrentCount - 1);
        }
      }

      return {
        executed: attemptCount > 0,
        attemptCount,
        aborted,
        error: lastError || "Operation exhausted allowed attempts.",
      };
    },
    markExternalBlockEncountered(reason: string) {
      earlyStopBlocked = true;
      earlyStopReason = reason;
    },
    registerCleanup(cleanupFn: () => Promise<void> | void) {
      cleanupSet.add(cleanupFn);
      return () => {
        cleanupSet.delete(cleanupFn);
      };
    },
    async abortAndCleanup(reason?: string) {
      aborted = true;
      abortReason = reason || "Explicitly aborted by caller.";
      await runCleanups();
    },
    getSnapshot() {
      const coord = getCoordinator();
      return {
        workspaceId,
        researchRunId,
        maxConcurrency: AMAZON_PILOT_MAX_CONCURRENCY,
        activeConcurrentCount: coord.activeConcurrentCount,
        operationsUsedInRun,
        maxOperationsPerRun,
        maxAttemptsPerOperation,
        rollingWindowNavigationsUsed: coord.navigationTimestampsMs.length,
        maxNavigationsPerRollingWindow,
        aborted,
        abortReason,
        earlyStopBlocked,
        earlyStopReason,
        cleanupCallbacksExecuted,
      };
    },
  };
}
