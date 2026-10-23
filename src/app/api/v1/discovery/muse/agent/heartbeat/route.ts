/**
 * External Muse Agent Gateway — Standalone Heartbeat
 *
 * POST /api/v1/discovery/muse/agent/heartbeat
 *
 * Restricted strictly to external agents authenticated via MUSE_INGESTION_TOKEN only.
 * Proves real connectivity and updates active lease health.
 * Differentiates genuine external live heartbeats from test simulations.
 */

import { NextRequest, NextResponse } from "next/server";
import { verifyMuseAgentAuthorization } from "@/services/security/museAuth";
import {
  recordMuseAgentHeartbeat,
  getMuseBridgeStatus,
  isTestOrSimulatedAgent,
} from "@/services/discovery/muse/museBridgeService";

export async function POST(request: NextRequest) {
  const auth = verifyMuseAgentAuthorization(request, "READ_QUEUE");
  if (!auth.authorized) return auth.errorResponse!;

  try {
    const body = await request.json().catch(() => ({}));
    const requestId = typeof body.requestId === "string" ? body.requestId : undefined;

    const isSimulationFlag =
      body.isSimulation === true ||
      request.headers.get("x-muse-simulation") === "true";

    const gatewayHeader = request.headers.get("x-muse-gateway-source");
    const isFromGateway = gatewayHeader === "muse-reverse-proxy-8787";

    const isTestId = isTestOrSimulatedAgent(auth.agent!.agentId);

    // Live external connection is verified ONLY when coming via reverse proxy or explicitly live,
    // and NOT marked as a test/simulated agent!
    const isLiveExternal = (isFromGateway || body.isLiveExternal === true) && !isTestId && !isSimulationFlag;

    await recordMuseAgentHeartbeat(auth.agent!.agentId, requestId, {
      isLiveExternal,
      isSimulated: !isLiveExternal,
    });

    const bridgeStatus = await getMuseBridgeStatus(auth.agent!.workspaceId);

    return NextResponse.json({
      success: true,
      data: {
        heartbeatRecorded: true,
        agentId: auth.agent!.agentId,
        workspaceId: auth.agent!.workspaceId,
        isLiveExternal,
        diagnosticState: bridgeStatus.diagnosticState,
        bridgeStatus,
      },
      meta: {
        timestamp: new Date().toISOString(),
        version: "v10.1",
        notice: isLiveExternal
          ? "Live external agent heartbeat verified. Connection state is AGENT_VERIFIED."
          : "Heartbeat accepted as local test simulation. Live external connection indicator untouched.",
      },
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Failed to record agent heartbeat.";
    return NextResponse.json(
      { success: false, error: { code: "HEARTBEAT_FAILED", message: msg } },
      { status: 500 }
    );
  }
}
