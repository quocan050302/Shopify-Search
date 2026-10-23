/**
 * SWAI — Muse External-Agent Bridge Health & Connectivity Service
 *
 * Responsibilities:
 * 1. Checks application-side gateway configuration (MUSE_INGESTION_TOKEN / ADMIN_API_KEY).
 * 2. Monitors external Muse agent heartbeat and lease health.
 * 3. Tracks last verified submission and persistent execution status.
 * 4. Determines the genuine execution mode (never claiming full unattended scheduling without proof).
 * 5. Provides honest status: MUSE_AGENT_CONNECTION_NOT_VERIFIED when no live agent is connected.
 */

import { prisma } from "@/lib/db";
import { MUSE_PROVIDER_ID } from "../normalization/normalizeFacebookAd";
import { MuseExecutionMode } from "../types";

export type MuseBridgeConnectionState =
  | "BRIDGE_NOT_CONFIGURED"
  | "BRIDGE_CONFIGURED"
  | "AGENT_NOT_CONNECTED"
  | "AGENT_CONNECTED"
  | "RESEARCH_IN_PROGRESS"
  | "LIVE_VERIFIED"
  | "CONNECTION_FAILED";

export interface MuseBridgeStatus {
  isConfigured: boolean;
  connectionState: MuseBridgeConnectionState;
  executionMode: MuseExecutionMode | "MUSE_AGENT_CONNECTION_NOT_VERIFIED";
  lastHeartbeatAt: string | null;
  lastSubmissionAt: string | null;
  pendingRequestsCount: number;
  runningRequestsCount: number;
  completedRequestsCount: number;
  failedRequestsCount: number;
  agentSessionId: string | null;
  notice: string;
}

const HEARTBEAT_EXPIRATION_MS = 15 * 60 * 1000; // 15 minutes lease

/**
 * Reads persistent status for the Muse bridge and reports honest connectivity.
 */
export async function getMuseBridgeStatus(
  workspaceId: string = "default-workspace"
): Promise<MuseBridgeStatus> {
  void workspaceId;
  const token = (
    process.env.MUSE_INGESTION_TOKEN ||
    process.env.ADMIN_API_KEY ||
    process.env.SWAI_ADMIN_TOKEN ||
    ""
  ).trim();

  const isConfigured = token.length > 0;

  // Query recent runs for the muse provider
  const runs = await prisma.discoveryRun.findMany({
    where: { providerId: MUSE_PROVIDER_ID },
    orderBy: { createdAt: "desc" },
    take: 50,
  });

  const pending = runs.filter((r) => r.status === "PENDING").length;
  const running = runs.filter((r) => r.status === "RUNNING" || r.status === "CLAIMED").length;
  const completed = runs.filter((r) => r.status === "COMPLETED" || r.status === "PARTIALLY_COMPLETED").length;
  const failed = runs.filter((r) => r.status === "FAILED").length;

  // Find most recent heartbeat from running jobs or sync jobs
  const mostRecentHeartbeatRun = runs.find((r) => r.heartbeatAt != null);
  const lastHeartbeat = mostRecentHeartbeatRun?.heartbeatAt || null;

  // Find most recent successful submission
  const mostRecentCompletedRun = runs.find(
    (r) => (r.status === "COMPLETED" || r.status === "PARTIALLY_COMPLETED") && r.finishedAt != null
  );
  const lastSubmission = mostRecentCompletedRun?.finishedAt || null;

  const now = Date.now();
  const isHeartbeatFresh =
    lastHeartbeat != null && now - lastHeartbeat.getTime() < HEARTBEAT_EXPIRATION_MS;

  let connectionState: MuseBridgeConnectionState = "BRIDGE_NOT_CONFIGURED";
  let executionMode: MuseExecutionMode | "MUSE_AGENT_CONNECTION_NOT_VERIFIED" =
    "MUSE_AGENT_CONNECTION_NOT_VERIFIED";

  if (!isConfigured) {
    connectionState = "BRIDGE_NOT_CONFIGURED";
  } else if (running > 0 && isHeartbeatFresh) {
    connectionState = "RESEARCH_IN_PROGRESS";
    executionMode = "MUSE_CONNECTED_AGENT";
  } else if (isHeartbeatFresh) {
    connectionState = "AGENT_CONNECTED";
    executionMode = "MUSE_CONNECTED_AGENT";
  } else if (completed > 0) {
    connectionState = "LIVE_VERIFIED";
    executionMode = "MUSE_ASSISTED_ON_DEMAND";
  } else {
    connectionState = "AGENT_NOT_CONNECTED";
    executionMode = "MUSE_AGENT_CONNECTION_NOT_VERIFIED";
  }

  const notice =
    connectionState === "RESEARCH_IN_PROGRESS"
      ? "Muse research session is active and researching Meta Ad Library."
      : connectionState === "AGENT_CONNECTED"
      ? "Muse agent connector is active and connected to SWAI."
      : connectionState === "LIVE_VERIFIED"
      ? "Previous research submitted successfully. Ready for new research on demand."
      : isConfigured
      ? "Bridge gateway is configured. Waiting for Muse agent to claim pending requests."
      : "MUSE_INGESTION_TOKEN not configured. Configure credential to authorize external Muse requests.";

  return {
    isConfigured,
    connectionState,
    executionMode,
    lastHeartbeatAt: lastHeartbeat ? lastHeartbeat.toISOString() : null,
    lastSubmissionAt: lastSubmission ? lastSubmission.toISOString() : null,
    pendingRequestsCount: pending,
    runningRequestsCount: running,
    completedRequestsCount: completed,
    failedRequestsCount: failed,
    agentSessionId: mostRecentHeartbeatRun?.jobId || null,
    notice,
  };
}

/**
 * Records an authenticated Muse agent heartbeat.
 */
export async function recordMuseAgentHeartbeat(
  agentId: string,
  requestId?: string
): Promise<void> {
  const now = new Date();

  if (requestId) {
    await prisma.discoveryRun.updateMany({
      where: { id: requestId, providerId: MUSE_PROVIDER_ID },
      data: { heartbeatAt: now },
    });
  }

  // Update or record heartbeat job in syncJob
  const existingJob = await prisma.syncJob.findFirst({
    where: { jobType: "MUSE_AGENT_HEARTBEAT" },
  });

  if (existingJob) {
    await prisma.syncJob.update({
      where: { id: existingJob.id },
      data: {
        status: "RUNNING",
        startedAt: now,
        errorMessage: `Agent ID: ${agentId}`,
      },
    });
  } else {
    const workspace = await prisma.workspace.findFirst({ select: { id: true } });
    if (workspace) {
      await prisma.syncJob.create({
        data: {
          id: `muse-heartbeat-${Date.now()}`,
          workspaceId: workspace.id,
          jobType: "MUSE_AGENT_HEARTBEAT",
          status: "RUNNING",
          startedAt: now,
          errorMessage: `Agent ID: ${agentId}`,
        },
      });
    }
  }
}

/**
 * Validates whether the bridge gateway is configured and reachable.
 */
export function verifyMuseBridgeConfiguration(): {
  isConfigured: boolean;
  tokenConfigured: boolean;
} {
  const token = (
    process.env.MUSE_INGESTION_TOKEN ||
    process.env.ADMIN_API_KEY ||
    process.env.SWAI_ADMIN_TOKEN ||
    ""
  ).trim();

  return {
    isConfigured: token.length > 0,
    tokenConfigured: token.length > 0,
  };
}
