import { BadgeVariant } from "@/components/ui/Badge";

export interface ResearchJobPresentation {
  label: string;
  variant: BadgeVariant;
  description: string;
  isTerminal: boolean;
  canCancel: boolean;
  canRetry: boolean;
  canViewAds: boolean;
}

export function mapMetaJobStatus(backendStatus: string | null | undefined): ResearchJobPresentation {
  const normalized = (backendStatus || "").toUpperCase();

  switch (normalized) {
    case "COMPLETED":
      return {
        label: "Completed",
        variant: "success",
        description: "Ad extraction completed and verified records persisted.",
        isTerminal: true,
        canCancel: false,
        canRetry: false,
        canViewAds: true,
      };

    case "PARTIALLY_COMPLETED":
      return {
        label: "Partial results",
        variant: "warning",
        description: "Task completed with some valid ads before reaching limits.",
        isTerminal: true,
        canCancel: false,
        canRetry: true,
        canViewAds: true,
      };

    case "RUNNING":
      return {
        label: "Running",
        variant: "info",
        description: "Local worker is actively querying and processing ads.",
        isTerminal: false,
        canCancel: true,
        canRetry: false,
        canViewAds: false,
      };

    case "PENDING":
      return {
        label: "Queued",
        variant: "warning",
        description: "Task is pending execution by the background worker.",
        isTerminal: false,
        canCancel: true,
        canRetry: false,
        canViewAds: false,
      };

    case "BLOCKED_SOURCE":
      return {
        label: "Source restricted",
        variant: "danger",
        description: "Meta Ad Library restricted public access or anti-bot triggered.",
        isTerminal: true,
        canCancel: false,
        canRetry: true,
        canViewAds: false,
      };

    case "RATE_LIMITED":
      return {
        label: "Rate limited",
        variant: "warning",
        description: "Upstream requests throttled. Retry with a lower budget.",
        isTerminal: true,
        canCancel: false,
        canRetry: true,
        canViewAds: false,
      };

    case "CANCELLED":
      return {
        label: "Cancelled",
        variant: "neutral",
        description: "Research task was cancelled by the user.",
        isTerminal: true,
        canCancel: false,
        canRetry: true,
        canViewAds: false,
      };

    case "FAILED":
      return {
        label: "Failed",
        variant: "danger",
        description: "Research task encountered an error during execution.",
        isTerminal: true,
        canCancel: false,
        canRetry: true,
        canViewAds: false,
      };

    default:
      return {
        label: normalized || "Unknown",
        variant: "neutral",
        description: "Unknown task status.",
        isTerminal: true,
        canCancel: false,
        canRetry: true,
        canViewAds: false,
      };
  }
}
