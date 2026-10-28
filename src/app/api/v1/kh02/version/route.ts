/**
 * GET /api/v1/kh02/version
 *
 * Exposes non-sensitive runtime build, git commit SHA, and worker version
 * for bundle verification and deployment integrity audits (Section 4.3).
 */

import { NextResponse } from "next/server";
import { getRuntimeVersionInfo } from "@/services/kh02/version/runtimeVersionService";

export async function GET() {
  const versionInfo = getRuntimeVersionInfo();
  return NextResponse.json({
    success: true,
    data: versionInfo,
  });
}
