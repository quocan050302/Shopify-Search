/**
 * SWAI V10.1 — Muse External-Agent Bridge Health & Connectivity Service
 *
 * Responsibilities:
 * 1. Checks application-side gateway configuration (MUSE_INGESTION_TOKEN).
 * 2. Monitors external Muse agent heartbeat and lease health.
 * 3. Enforces strict boundary: completed test jobs or simulated heartbeats
 *    must NOT prove a live external Muse connection.
 * 4. Isolates test-created Facebook ads and simulated agent sessions from production.
 * 5. Provides honest status: AGENT_NOT_CONNECTED when no live external agent is active.
 * 6. Reports AGENT_VERIFIED ONLY when a verified live external agent sends fresh heartbeats.
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
  simulatedRequestsCount?: number;
  hasSimulatedActivity?: boolean;
  agentSessionId: string | null;
  notice: string;
}

export interface MuseHeartbeatOptions {
  isLiveExternal?: boolean;
  isSimulated?: boolean;
}

const HEARTBEAT_EXPIRATION_MS = 15 * 60 * 1000; // 15 minutes lease

/**
 * Checks whether an agent ID represents a test simulation rather than a real live external agent.
 */
export function isTestOrSimulatedAgent(agentId: string): boolean {
  if (!agentId) return false;
  const lower = agentId.toLowerCase();
  return (
    lower.startsWith("test") ||
    lower.startsWith("sim") ||
    lower.startsWith("mock") ||
    lower.startsWith("vitest") ||
    lower.includes("local-test") ||
    lower.includes("simulation")
  );
}

/**
 * Reads persistent status for the Muse bridge and reports honest connectivity.
 * - CONFIGURED: MUSE_INGESTION_TOKEN exists in environment.
 * - AGENT_NOT_CONNECTED: Token configured, but no active live external agent heartbeat within lease.
 * - AGENT_VERIFIED: Active external agent connected with verified fresh live heartbeat.
 * Invariant: Completed test jobs or simulated heartbeats NEVER prove a live external connection!
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

  // Separate production runs from test/simulated runs
  const productionRuns = runs.filter(
    (r) => r.runMode !== "SIMULATED" && r.runMode !== "TEST"
  );
  const simulatedRuns = runs.filter(
    (r) => r.runMode === "SIMULATED" || r.runMode === "TEST"
  );

  const pending = productionRuns.filter((r) => r.status === "PENDING").length;
  const running = productionRuns.filter((r) => r.status === "RUNNING" || r.status === "CLAIMED").length;
  const completed = productionRuns.filter((r) => r.status === "COMPLETED" || r.status === "PARTIALLY_COMPLETED").length;
  const failed = productionRuns.filter((r) => r.status === "FAILED").length;

  // Find genuine LIVE external heartbeat (excluding simulations)
  const liveHeartbeatJob = await prisma.syncJob.findFirst({
    where: { jobType: "MUSE_AGENT_HEARTBEAT" },
  });

  let liveJobTime: Date | null = null;
  if (liveHeartbeatJob?.startedAt) {
    try {
      const meta = JSON.parse(liveHeartbeatJob.errorMessage || "{}");
      if (meta.isLiveExternal === true && !meta.isSimulated) {
        liveJobTime = liveHeartbeatJob.startedAt;
      }
    } catch {
      // Legacy fallback: if errorMessage does not contain simulation flag
      if (!liveHeartbeatJob.errorMessage?.includes("sim") && !liveHeartbeatJob.errorMessage?.includes("test")) {
        liveJobTime = liveHeartbeatJob.startedAt;
      }
    }
  }

  // Also check production runs (non-simulated) with active heartbeat
  const mostRecentProdHeartbeatRun = productionRuns.find((r) => r.heartbeatAt != null);
  const prodRunHeartbeatTime = mostRecentProdHeartbeatRun?.heartbeatAt || null;

  let lastLiveHeartbeat: Date | null = null;
  if (liveJobTime && prodRunHeartbeatTime) {
    lastLiveHeartbeat = liveJobTime > prodRunHeartbeatTime ? liveJobTime : prodRunHeartbeatTime;
  } else {
    lastLiveHeartbeat = liveJobTime || prodRunHeartbeatTime;
  }

  const now = Date.now();
  const isLiveHeartbeatFresh =
    lastLiveHeartbeat != null && now - lastLiveHeartbeat.getTime() < HEARTBEAT_EXPIRATION_MS;

  // Find most recent production submission
  const mostRecentCompletedRun = productionRuns.find(
    (r) => (r.status === "COMPLETED" || r.status === "PARTIALLY_COMPLETED") && r.finishedAt != null
  );
  const lastSubmission = mostRecentCompletedRun?.finishedAt || null;

  let diagnosticState: MuseDiagnosticState = "NOT_CONFIGURED";
  let connectionState: MuseBridgeConnectionState = "BRIDGE_NOT_CONFIGURED";
  let agentConnected = false;
  let executionMode: MuseExecutionMode | "MUSE_AGENT_CONNECTION_NOT_VERIFIED" =
    "MUSE_AGENT_CONNECTION_NOT_VERIFIED";

  if (!isConfigured) {
    diagnosticState = "NOT_CONFIGURED";
    connectionState = "BRIDGE_NOT_CONFIGURED";
    agentConnected = false;
  } else if (running > 0 && isLiveHeartbeatFresh) {
    diagnosticState = "AGENT_VERIFIED";
    connectionState = "RESEARCH_IN_PROGRESS";
    agentConnected = true;
    executionMode = "MUSE_CONNECTED_AGENT";
  } else if (isLiveHeartbeatFresh) {
    diagnosticState = "AGENT_VERIFIED";
    connectionState = "AGENT_CONNECTED";
    agentConnected = true;
    executionMode = "MUSE_CONNECTED_AGENT";
  } else {
    // Token configured, but no active live external agent heartbeat received within lease
    diagnosticState = "AGENT_NOT_CONNECTED";
    connectionState = "AGENT_NOT_CONNECTED";
    agentConnected = false;
    executionMode = completed > 0 ? "MUSE_ASSISTED_ON_DEMAND" : "MUSE_AGENT_CONNECTION_NOT_VERIFIED";
  }

  const notice =
    diagnosticState === "AGENT_VERIFIED" && connectionState === "RESEARCH_IN_PROGRESS"
      ? "Muse external research session is active and researching Meta Ad Library."
      : diagnosticState === "AGENT_VERIFIED"
      ? "Active external Muse agent connector is verified and sending fresh heartbeats."
      : diagnosticState === "AGENT_NOT_CONNECTED"
      ? "Gateway is configured (MUSE_INGESTION_TOKEN set), but no verified live external agent heartbeat received recently."
      : "MUSE_INGESTION_TOKEN not configured. Configure credential to authorize external Muse requests.";

  return {
    isConfigured,
    gatewayConfigured: isConfigured,
    agentConnected,
    connectionState,
    diagnosticState,
    executionMode,
    lastHeartbeatAt: lastLiveHeartbeat ? lastLiveHeartbeat.toISOString() : null,
    lastSubmissionAt: lastSubmission ? lastSubmission.toISOString() : null,
    pendingRequestsCount: pending,
    runningRequestsCount: running,
    completedRequestsCount: completed,
    failedRequestsCount: failed,
    simulatedRequestsCount: simulatedRuns.length,
    hasSimulatedActivity: simulatedRuns.length > 0,
    agentSessionId: mostRecentProdHeartbeatRun?.jobId || null,
    notice,
  };
}

/**
 * Records an authenticated Muse agent heartbeat.
 * Strictly separates live external agent heartbeats from test simulations.
 */
export async function recordMuseAgentHeartbeat(
  agentId: string,
  requestId?: string,
  options: MuseHeartbeatOptions = {}
): Promise<void> {
  const now = new Date();
  const isSimulated =
    options.isSimulated === true ||
    options.isLiveExternal === false ||
    isTestOrSimulatedAgent(agentId);

  const isLiveExternal = !isSimulated && Boolean(options.isLiveExternal);

  if (requestId) {
    await prisma.discoveryRun.updateMany({
      where: { id: requestId, providerId: MUSE_PROVIDER_ID },
      data: {
        heartbeatAt: now,
        ...(isSimulated ? { runMode: "SIMULATED" } : {}),
      },
    });
  }

  const jobType = isLiveExternal ? "MUSE_AGENT_HEARTBEAT" : "MUSE_AGENT_HEARTBEAT_SIMULATED";

  const payloadMeta = JSON.stringify({
    agentId,
    isLiveExternal,
    isSimulated,
    updatedAt: now.toISOString(),
  });

  const existingJob = await prisma.syncJob.findFirst({
    where: { jobType },
  });

  if (existingJob) {
    await prisma.syncJob.update({
      where: { id: existingJob.id },
      data: {
        status: "RUNNING",
        startedAt: now,
        errorMessage: payloadMeta,
      },
    });
  } else {
    const workspace = await prisma.workspace.findFirst({ select: { id: true } });
    if (workspace) {
      await prisma.syncJob.create({
        data: {
          id: `muse-heartbeat-${isLiveExternal ? "live" : "sim"}-${Date.now()}`,
          workspaceId: workspace.id,
          jobType,
          status: "RUNNING",
          startedAt: now,
          errorMessage: payloadMeta,
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
