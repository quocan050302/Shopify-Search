/**
 * GET /api/v1/kh02/version
 *
 * Exposes non-sensitive runtime build, compile-time frontend bundle SHA,
 * backend SHA, worker SHA, database fingerprint, and parity status
 * for bundle verification and deployment integrity audits (Section 3).
 */

import { NextRequest, NextResponse } from "next/server";
import {
  evaluateKH02RuntimeIdentity,
  getCompileTimeFrontendSha,
} from "@/services/kh02/version/runtimeVersionService";
import { getSharedResearchWorkerHealth } from "@/workers/kh02Worker";

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const clientFrontendSha = searchParams.get("frontendSha") || getCompileTimeFrontendSha();
  const clientFrontendVersion = searchParams.get("frontendVersion") || undefined;

  const workerHealth = await getSharedResearchWorkerHealth();
  const workerOnline = workerHealth.status === "ALIVE" || workerHealth.status === "STALE";

  const versionInfo = evaluateKH02RuntimeIdentity({
    frontendBuildSha: clientFrontendSha,
    frontendVersion: clientFrontendVersion,
    worker: {
      workerOnline,
      workerId: workerHealth.workerId,
      workerVersion: workerHealth.workerVersion || null,
      workerBuildSha: workerHealth.workerBuildSha || null,
      workerStartedAt: workerHealth.processStartedAt || null,
      workerProcessId: workerHealth.workerProcessId || null,
      workerDbFingerprint: workerHealth.dbFingerprint || null,
      conflictingWorkerIds: workerHealth.conflictingWorkerIds || [],
    },
  });

  return NextResponse.json({
    success: true,
    data: versionInfo,
  });
}
