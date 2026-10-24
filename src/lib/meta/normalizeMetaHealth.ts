import { getCollectorSetupSteps } from "@/lib/meta/collectorSetupCommands";

export type MetaReadinessState =
  | "LOADING"
  | "READY"
  | "SETUP_REQUIRED"
  | "WORKER_OFFLINE"
  | "SOURCE_RESTRICTED"
  | "DEGRADED"
  | "UNKNOWN";

export interface ProviderHealthResponse {
  provider: {
    id: string;
    name: string;
    enabled: boolean;
    status: string;
    isAuthorized: boolean;
    message: string;
  };
  environment: {
    pythonReady: boolean;
    dataDirReady: boolean;
    defaultCountry: string;
    liveTestEnabled: boolean;
  };
  worker: {
    status: "RUNNING" | "STOPPED";
    lastHeartbeat: string | null;
  };
  history: {
    lastSuccessfulRetrievalAt: string | null;
    lastSuccessfulRecordCount: number;
    lastFailureCategory: string | null;
    lastFailureMessage: string | null;
    lastFailureAt?: string | null;
  };
  limits: {
    maxResultsPerSearch: number;
    maxRequestsPerSearch: number;
    maxExecutionSeconds: number;
    maxConcurrency: number;
  };
}

export interface NormalizedReadiness {
  state: MetaReadinessState;
  title: string;
  message: string;
  badgeVariant: "brand" | "success" | "warning" | "danger" | "info" | "neutral";
  canStartResearch: boolean;
  canQueueForLater: boolean;
  primaryActionLabel: string;
  setupSteps: {
    id: string;
    title: string;
    description: string;
    status: "COMPLETE" | "NEEDS_ACTION" | "FAILED" | "UNKNOWN";
    command?: string;
  }[];
}

export interface SourceHealthOutcome {
  isRestricted: boolean;
  category: "BLOCKED_SOURCE" | "RATE_LIMITED" | null;
  reason: string | null;
}

/**
 * Derives current upstream source health by comparing the latest failure with
 * the latest successful observation. An old failure record does not override
 * a more recent successful collection.
 */
export function deriveLatestSourceHealth(
  lastSuccessAt: string | null | undefined,
  lastFailureAt: string | null | undefined,
  failureCategory: string | null | undefined,
  failureMessage: string | null | undefined
): SourceHealthOutcome {
  if (!failureCategory || (failureCategory !== "BLOCKED_SOURCE" && failureCategory !== "RATE_LIMITED")) {
    return { isRestricted: false, category: null, reason: null };
  }

  if (lastSuccessAt && lastFailureAt) {
    const successTime = new Date(lastSuccessAt).getTime();
    const failureTime = new Date(lastFailureAt).getTime();
    // If a verified success occurred AFTER the failure, the restriction is resolved
    if (successTime >= failureTime) {
      return { isRestricted: false, category: null, reason: null };
    }
  } else if (lastSuccessAt && !lastFailureAt) {
    // If success has timestamp but failure does not, prefer verified success
    return { isRestricted: false, category: null, reason: null };
  }

  return {
    isRestricted: true,
    category: failureCategory as "BLOCKED_SOURCE" | "RATE_LIMITED",
    reason: failureMessage || "Upstream Meta Ad Library returned rate limiting or restricted public access.",
  };
}

export function normalizeMetaHealth(
  health: ProviderHealthResponse | null | undefined,
  isLoading: boolean
): NormalizedReadiness {
  // 1. Initial or ongoing background loading without cached health
  if (isLoading && !health) {
    return {
      state: "LOADING",
      title: "Checking Collector Readiness",
      message: "Querying local MetaAdsCollector daemon and background worker status...",
      badgeVariant: "neutral",
      canStartResearch: false,
      canQueueForLater: false,
      primaryActionLabel: "Checking...",
      setupSteps: [],
    };
  }

  // 2. Health check failed or uncontactable
  if (!health) {
    return {
      state: "UNKNOWN",
      title: "Health Check Unavailable",
      message: "Unable to query local MetaAdsCollector daemon. Verify server or run diagnostics.",
      badgeVariant: "danger",
      canStartResearch: false,
      canQueueForLater: false,
      primaryActionLabel: "Run Diagnostics",
      setupSteps: [],
    };
  }

  const { provider, environment, worker, history, limits } = health;

  // Use centralized setup step definitions
  const canonicalSteps = getCollectorSetupSteps();
  const setupSteps = canonicalSteps.map((step) => {
    let status: "COMPLETE" | "NEEDS_ACTION" | "FAILED" | "UNKNOWN" = "NEEDS_ACTION";

    if (step.id === "python_env") {
      status = environment.pythonReady ? "COMPLETE" : "NEEDS_ACTION";
    } else if (step.id === "collector_config") {
      status = provider.enabled && provider.status !== "NOT_CONFIGURED" ? "COMPLETE" : "NEEDS_ACTION";
    } else if (step.id === "worker_process") {
      status = worker.status === "RUNNING" ? "COMPLETE" : "NEEDS_ACTION";
    } else if (step.id === "connectivity_test") {
      const sourceHealth = deriveLatestSourceHealth(
        history.lastSuccessfulRetrievalAt,
        history.lastFailureAt,
        history.lastFailureCategory,
        history.lastFailureMessage
      );
      if (sourceHealth.isRestricted) {
        status = sourceHealth.category === "BLOCKED_SOURCE" ? "FAILED" : "NEEDS_ACTION";
      } else if (history.lastSuccessfulRetrievalAt) {
        status = "COMPLETE";
      } else {
        status = "UNKNOWN";
      }
    }

    return {
      id: step.id,
      title: step.title,
      description: step.description,
      status,
      command: step.command,
    };
  });

  // 3. Missing python or unconfigured provider
  if (!environment.pythonReady || !environment.dataDirReady || provider.status === "NOT_CONFIGURED" || !provider.enabled) {
    return {
      state: "SETUP_REQUIRED",
      title: "Collector Setup Required",
      message:
        provider.message ||
        "Local MetaAdsCollector requires a Python environment and active configuration.",
      badgeVariant: "warning",
      canStartResearch: false,
      canQueueForLater: false,
      primaryActionLabel: "Configure Collector",
      setupSteps,
    };
  }

  // 4. Upstream source restrictions (e.g. rate limit or geo block), taking timestamps into account
  const sourceHealth = deriveLatestSourceHealth(
    history.lastSuccessfulRetrievalAt,
    history.lastFailureAt,
    history.lastFailureCategory,
    history.lastFailureMessage
  );

  if (sourceHealth.isRestricted) {
    return {
      state: "SOURCE_RESTRICTED",
      title: "External Source Restricted",
      message:
        sourceHealth.reason ||
        "Upstream Meta Ad Library returned rate limiting or restricted public access.",
      badgeVariant: "danger",
      canStartResearch: false,
      canQueueForLater: true,
      primaryActionLabel: "Queue for Later",
      setupSteps,
    };
  }

  // 5. Worker offline
  if (worker.status !== "RUNNING") {
    return {
      state: "WORKER_OFFLINE",
      title: "Background Worker Offline",
      message: "The local collector worker is stopped. You can queue requests for later processing.",
      badgeVariant: "warning",
      canStartResearch: false,
      canQueueForLater: true,
      primaryActionLabel: "Queue for Later",
      setupSteps,
    };
  }

  // 6. Ready
  return {
    state: "READY",
    title: "System Operational",
    message: `Ready to research Meta public ads. Budget limit: ${limits.maxResultsPerSearch} ads/search.`,
    badgeVariant: "success",
    canStartResearch: true,
    canQueueForLater: true,
    primaryActionLabel: "Start Research",
    setupSteps,
  };
}
