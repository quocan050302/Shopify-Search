/**
 * GET  /api/v1/discovery/muse/bridge — returns real bridge connectivity status and stats.
 * POST /api/v1/discovery/muse/bridge — records authenticated agent heartbeat.
 */

import { NextRequest, NextResponse } from "next/server";
import {
  getMuseBridgeStatus,
  recordMuseAgentHeartbeat,
} from "@/services/discovery/muse/museBridgeService";
import { verifyMuseAgentAuthorization } from "@/services/security/museAuth";

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const workspaceId = searchParams.get("workspaceId") || "default-workspace";
    const status = await getMuseBridgeStatus(workspaceId);

    return NextResponse.json({
      success: true,
      data: status,
      meta: {
        timestamp: new Date().toISOString(),
        version: "v10.0",
      },
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Failed to get bridge status.";
    return NextResponse.json(
      { success: false, error: { code: "BRIDGE_STATUS_FAILED", message: msg } },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  const auth = verifyMuseAgentAuthorization(request, "READ_QUEUE");
  if (!auth.authorized) return auth.errorResponse!;

  try {
    const body = await request.json().catch(() => ({}));
    const requestId = typeof body.requestId === "string" ? body.requestId : undefined;

    await recordMuseAgentHeartbeat(auth.agent!.agentId, requestId);

    const status = await getMuseBridgeStatus(auth.agent!.workspaceId);

    return NextResponse.json({
      success: true,
      data: {
        heartbeatRecorded: true,
        agentId: auth.agent!.agentId,
        bridgeStatus: status,
      },
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Failed to record heartbeat.";
    return NextResponse.json(
      { success: false, error: { code: "HEARTBEAT_FAILED", message: msg } },
      { status: 500 }
    );
  }
}
