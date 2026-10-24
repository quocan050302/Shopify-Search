import { NormalizedReadiness } from "@/lib/meta/normalizeMetaHealth";

export type ResearchActionKind = "START" | "QUEUE" | "SETUP" | "DIAGNOSTICS" | "WAIT";

export interface ResearchAction {
  kind: ResearchActionKind;
  label: string;
  enabled: boolean;
  buttonType: "submit" | "button";
}

/**
 * Derives the exact user action from collector readiness state.
 * Prevents submitting research when the system is UNKNOWN, LOADING, or SETUP_REQUIRED.
 */
export function deriveResearchAction(readiness: NormalizedReadiness): ResearchAction {
  switch (readiness.state) {
    case "READY":
      return {
        kind: "START",
        label: "Start Research",
        enabled: true,
        buttonType: "submit",
      };

    case "WORKER_OFFLINE":
      return {
        kind: "QUEUE",
        label: "Queue for Later",
        enabled: readiness.canQueueForLater,
        buttonType: "submit",
      };

    case "SETUP_REQUIRED":
      return {
        kind: "SETUP",
        label: "Configure Collector",
        enabled: true,
        buttonType: "button",
      };

    case "SOURCE_RESTRICTED":
      if (readiness.canQueueForLater) {
        return {
          kind: "QUEUE",
          label: "Queue for Later",
          enabled: true,
          buttonType: "submit",
        };
      }
      return {
        kind: "DIAGNOSTICS",
        label: "Run Diagnostics",
        enabled: true,
        buttonType: "button",
      };

    case "DEGRADED":
      if (readiness.canQueueForLater) {
        return {
          kind: "QUEUE",
          label: "Queue for Later",
          enabled: true,
          buttonType: "submit",
        };
      }
      return {
        kind: "DIAGNOSTICS",
        label: "Run Diagnostics",
        enabled: true,
        buttonType: "button",
      };

    case "UNKNOWN":
      return {
        kind: "DIAGNOSTICS",
        label: "Run Diagnostics",
        enabled: true,
        buttonType: "button",
      };

    case "LOADING":
    default:
      return {
        kind: "WAIT",
        label: "Checking...",
        enabled: false,
        buttonType: "button",
      };
  }
}
