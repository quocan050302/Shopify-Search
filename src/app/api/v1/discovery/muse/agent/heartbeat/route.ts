/**
 * External Muse Agent Gateway — Standalone Heartbeat
 *
 * POST /api/v1/discovery/muse/agent/heartbeat
 *
 * Restricted strictly to external agents authenticated via MUSE_INGESTION_TOKEN only.
 * Proves real connectivity and updates active lease health.
 */

import { NextRequest, NextResponse } from "next/server";
import { verifyMuseAgentAuthorization } from "@/services/security/museAuth";
import {
  recordMuseAgentHeartbeat,
  getMuseBridgeStatus,
} from "@/services/discovery/muse/museBridgeService";

export async function POST(request: NextRequest) {
  const auth = verifyMuseAgentAuthorization(request, "READ_QUEUE");
  if (!auth.authorized) return auth.errorResponse!;

  try {
    const body = await request.json().catch(() => ({}));
    const requestId = typeof body.requestId === "string" ? body.requestId : undefined;

    await recordMuseAgentHeartbeat(auth.agent!.agentId, requestId);

    const bridgeStatus = await getMuseBridgeStatus(auth.agent!.workspaceId);

    return NextResponse.json({
      success: true,
      data: {
        heartbeatRecorded: true,
        agentId: auth.agent!.agentId,
        workspaceId: auth.agent!.workspaceId,
        diagnosticState: bridgeStatus.diagnosticState,
        bridgeStatus,
      },
      meta: {
        timestamp: new Date().toISOString(),
        version: "v10.1",
        notice: "Heartbeat accepted. Agent is verified active.",
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
