import { NextRequest, NextResponse } from "next/server";
import { validateAdminRequest } from "@/services/security/adminAuth";

/**
 * GET /api/v1/auth/status
 *
 * Advisory authorization readiness endpoint for frontend UI state.
 * Uses identical authentication primitives as protected research endpoints.
 * Never leaks API keys, secrets, token bytes, or filesystem paths.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const result = validateAdminRequest(request);

  const payload = {
    success: true,
    authorized: result.authorized,
    authMode: result.authMode || null,
    code: result.authorized ? "AUTHORIZED" : (result.code || "ADMIN_AUTH_REQUIRED"),
    message: result.message || (result.authorized ? "Authorized" : "Administrator authorization required."),
  };

  return NextResponse.json(payload, {
    status: 200,
    headers: {
      "Cache-Control": "no-store, no-cache, max-age=0, must-revalidate",
    },
  });
}
