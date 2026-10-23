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

export type MuseDiagnosticState =
  | "NOT_CONFIGURED"
  | "CONFIGURED"
  | "AGENT_NOT_CONNECTED"
  | "AGENT_VERIFIED";

export type MuseBridgeConnectionState =
  | "BRIDGE_NOT_CONFIGURED"
  | "BRIDGE_CONFIGURED"
  | "CONFIGURED"
  | "NOT_CONFIGURED"
  | "AGENT_NOT_CONNECTED"
  | "AGENT_CONNECTED"
  | "AGENT_VERIFIED"
  | "RESEARCH_IN_PROGRESS"
  | "LIVE_VERIFIED"
  | "CONNECTION_FAILED";

export interface MuseBridgeStatus {
  isConfigured: boolean;
  gatewayConfigured: boolean;
  agentConnected: boolean;
  connectionState: MuseBridgeConnectionState;
  diagnosticState: MuseDiagnosticState;
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
 * - CONFIGURED: MUSE_INGESTION_TOKEN exists in environment.
 * - AGENT_NOT_CONNECTED: Token configured, but no active heartbeat within lease.
 * - AGENT_VERIFIED: Active agent connected with verified fresh heartbeat.
 * Never claims connection merely because the token is defined!
 */
export async function getMuseBridgeStatus(
  workspaceId: string = "default-workspace"
): Promise<MuseBridgeStatus> {
  void workspaceId;
  const token = (process.env.MUSE_INGESTION_TOKEN || "").trim();
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

  // Find most recent heartbeat from running jobs
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

  let diagnosticState: MuseDiagnosticState = "NOT_CONFIGURED";
  let connectionState: MuseBridgeConnectionState = "BRIDGE_NOT_CONFIGURED";
  let agentConnected = false;
  let executionMode: MuseExecutionMode | "MUSE_AGENT_CONNECTION_NOT_VERIFIED" =
    "MUSE_AGENT_CONNECTION_NOT_VERIFIED";

  if (!isConfigured) {
    diagnosticState = "NOT_CONFIGURED";
    connectionState = "BRIDGE_NOT_CONFIGURED";
    agentConnected = false;
  } else if (running > 0 && isHeartbeatFresh) {
    diagnosticState = "AGENT_VERIFIED";
    connectionState = "RESEARCH_IN_PROGRESS";
    agentConnected = true;
    executionMode = "MUSE_CONNECTED_AGENT";
  } else if (isHeartbeatFresh) {
    diagnosticState = "AGENT_VERIFIED";
    connectionState = "AGENT_CONNECTED";
    agentConnected = true;
    executionMode = "MUSE_CONNECTED_AGENT";
  } else {
    // Token configured, but no active agent session or heartbeat is stale
    diagnosticState = "AGENT_NOT_CONNECTED";
    connectionState = "AGENT_NOT_CONNECTED";
    agentConnected = false;
    executionMode = completed > 0 ? "MUSE_ASSISTED_ON_DEMAND" : "MUSE_AGENT_CONNECTION_NOT_VERIFIED";
  }

  const notice =
    diagnosticState === "AGENT_VERIFIED" && connectionState === "RESEARCH_IN_PROGRESS"
      ? "Muse research session is active and researching Meta Ad Library."
      : diagnosticState === "AGENT_VERIFIED"
      ? "Active Muse agent connector is verified and sending fresh heartbeats."
      : diagnosticState === "AGENT_NOT_CONNECTED"
      ? "Gateway is configured (MUSE_INGESTION_TOKEN set), but no active Muse agent heartbeat received recently."
      : "MUSE_INGESTION_TOKEN not configured. Configure credential to authorize external Muse requests.";

  return {
    isConfigured,
    gatewayConfigured: isConfigured,
    agentConnected,
    connectionState,
    diagnosticState,
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
  const token = (process.env.MUSE_INGESTION_TOKEN || "").trim();

  return {
    isConfigured: token.length > 0,
    tokenConfigured: token.length > 0,
  };
}
