import { NormalizedReadiness } from "@/lib/meta/normalizeMetaHealth";

export type ResearchActionKind = "START" | "QUEUE" | "SETUP" | "DIAGNOSTICS" | "WAIT";

export interface ResearchAction {
  kind: ResearchActionKind;
  label: string;
  enabled: boolean;
  buttonType: "submit" | "button";
}

export type ResearchAuthorizationState =
  | "CHECKING"
  | "AUTHORIZED_LOCAL"
  | "AUTHORIZED_SESSION"
  | "AUTH_REQUIRED"
  | "INVALID_CREDENTIALS"
  | "FORBIDDEN"
  | "UNAVAILABLE";

export interface ResearchAuthorizationStatus {
  state: ResearchAuthorizationState;
  authorized: boolean;
  authMode?: "LOCAL_DEV" | "OWNER_ADMIN" | "USER_SESSION" | null;
  code?: string;
  message?: string;
}

/**
 * Derives the primary user action considering both collector readiness and user authorization.
 * Authorization errors take strict precedence over collector operational state.
 */
export function deriveAuthorizedResearchAction(
  collector: NormalizedReadiness,
  authorization: ResearchAuthorizationStatus
): ResearchAction {
  // If authorization is not granted, authorization state strictly governs primary action
  if (!authorization.authorized) {
    switch (authorization.state) {
      case "CHECKING":
        return {
          kind: "WAIT",
          label: "Checking Access…",
          enabled: false,
          buttonType: "button",
        };

      case "AUTH_REQUIRED":
        return {
          kind: "SETUP",
          label: "Authentication Required",
          enabled: false,
          buttonType: "button",
        };

      case "INVALID_CREDENTIALS":
        return {
          kind: "SETUP",
          label: "Reconnect / Fix Credentials",
          enabled: false,
          buttonType: "button",
        };

      case "FORBIDDEN":
        return {
          kind: "DIAGNOSTICS",
          label: "Access Restricted",
          enabled: false,
          buttonType: "button",
        };

      case "UNAVAILABLE":
        return {
          kind: "DIAGNOSTICS",
          label: "Retry Access Check",
          enabled: true,
          buttonType: "button",
        };

      default:
        return {
          kind: "SETUP",
          label: "Authentication Required",
          enabled: false,
          buttonType: "button",
        };
    }
  }

  // Authorization is verified: collector readiness derives the action
  return deriveResearchAction(collector);
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
