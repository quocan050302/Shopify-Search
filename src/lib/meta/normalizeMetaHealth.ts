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

export function normalizeMetaHealth(
  health: ProviderHealthResponse | null | undefined,
  isLoading: boolean
): NormalizedReadiness {
  if (isLoading || !health) {
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

  const { provider, environment, worker, history, limits } = health;

  // Build real setup steps with observable states
  const setupSteps = [
    {
      id: "python_env",
      title: "Verify Python Environment",
      description: "Python 3.10+ virtualenv with required dependencies in collector directory.",
      status: environment.pythonReady ? ("COMPLETE" as const) : ("NEEDS_ACTION" as const),
      command: "python3 -m venv .venv && source .venv/bin/activate && pip install -r requirements.txt",
    },
    {
      id: "collector_config",
      title: "Configure Local MCP Provider",
      description: "Local MetaAdsCollector provider initialized and authorized.",
      status:
        provider.enabled && provider.status !== "NOT_CONFIGURED"
          ? ("COMPLETE" as const)
          : ("NEEDS_ACTION" as const),
      command: "npm run doctor",
    },
    {
      id: "worker_process",
      title: "Start Discovery Background Worker",
      description: "Worker processes queued research runs and persists extracted ad records.",
      status: worker.status === "RUNNING" ? ("COMPLETE" as const) : ("NEEDS_ACTION" as const),
      command: "npm run worker:discovery",
    },
    {
      id: "connectivity_test",
      title: "Source Access Verification",
      description: "Direct HTTP reachability to public Meta Ad Library repository.",
      status:
        history.lastFailureCategory === "BLOCKED_SOURCE"
          ? ("FAILED" as const)
          : history.lastFailureCategory === "RATE_LIMITED"
          ? ("NEEDS_ACTION" as const)
          : history.lastSuccessfulRetrievalAt
          ? ("COMPLETE" as const)
          : ("UNKNOWN" as const),
      command: "curl -I https://www.facebook.com/ads/library/",
    },
  ];

  // 1. Missing python or unconfigured provider
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

  // 2. Upstream source restrictions (e.g. rate limit or geo block)
  if (history.lastFailureCategory === "BLOCKED_SOURCE" || history.lastFailureCategory === "RATE_LIMITED") {
    return {
      state: "SOURCE_RESTRICTED",
      title: "External Source Restricted",
      message:
        history.lastFailureMessage ||
        "Upstream Meta Ad Library returned rate limiting or restricted public access.",
      badgeVariant: "danger",
      canStartResearch: false,
      canQueueForLater: true,
      primaryActionLabel: "Queue for Later",
      setupSteps,
    };
  }

  // 3. Worker offline
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

  // 4. Ready
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
