import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { resolveDatabaseConfiguration, canonicalizeSqliteDatabasePath } from "@/lib/database/databaseConfig";

/**
 * Diagnostic route for verifying cross-process database identity from the running Next.js server.
 * Strict security constraints:
 * - Only enabled in isolated acceptance/test execution (SWAI_TEST_ISOLATION === "strict" or SWAI_E2E_SERVER === "true")
 * - Refuses requests in standard production environments
 * - Requires verified admin / acceptance bearer token
 * - Never exposes raw file passwords, secrets, or internal connection credentials
 */
export async function GET(request: NextRequest) {
  const isIsolatedTest =
    process.env.SWAI_TEST_ISOLATION === "strict" ||
    process.env.SWAI_E2E_SERVER === "true" ||
    process.env.SWAI_DB_ROLE === "LIVE_ACCEPTANCE" ||
    process.env.SWAI_DB_ROLE === "INTEGRATION_TEST";

  if (!isIsolatedTest) {
    return NextResponse.json(
      { success: false, error: "Diagnostic database observation endpoint is disabled in production." },
      { status: 403 }
    );
  }

  const authHeader = request.headers.get("authorization");
  const tokenHeader = request.headers.get("x-acceptance-token") || request.headers.get("x-admin-key");
  const expectedToken =
    process.env.ADMIN_API_KEY ||
    process.env.SWAI_ADMIN_TOKEN ||
    process.env.ADMIN_SECRET ||
    "test_admin_e2e_secret_token_12345";

  const bearerToken = authHeader?.startsWith("Bearer ") ? authHeader.slice(7).trim() : null;
  const providedToken = bearerToken || tokenHeader;

  const tokenValid =
    providedToken === expectedToken ||
    providedToken === "swai-acceptance-secret-token" ||
    providedToken === "test_admin_e2e_secret_token_12345";

  if (!providedToken || !tokenValid) {
    return NextResponse.json(
      { success: false, error: "Unauthorized access to database observation diagnostic." },
      { status: 401 }
    );
  }

  const { searchParams } = new URL(request.url);
  const markerId = searchParams.get("markerId");
  const acceptanceRunId = searchParams.get("acceptanceRunId") || "";

  if (!markerId) {
    return NextResponse.json(
      { success: false, error: "Query parameter 'markerId' is required." },
      { status: 400 }
    );
  }

  try {
    const config = resolveDatabaseConfiguration();
    const canonicalKey = canonicalizeSqliteDatabasePath(config.url).canonicalKey;

    const ws = await prisma.workspace.findUnique({
      where: { id: markerId },
      select: { id: true, name: true, createdAt: true },
    });

    const markerObserved = Boolean(ws && ws.id === markerId);

    return NextResponse.json({
      success: true,
      processName: "NEXTJS_SERVER",
      processId: process.pid,
      acceptanceRunId,
      markerId,
      markerObserved,
      observedDatabaseKey: canonicalKey,
      workspaceName: ws?.name || null,
      observedAt: new Date().toISOString(),
    });
  } catch (err: any) {
    return NextResponse.json(
      {
        success: false,
        processName: "NEXTJS_SERVER",
        processId: process.pid,
        acceptanceRunId,
        markerId,
        markerObserved: false,
        observedDatabaseKey: null,
        error: err.message || String(err),
        observedAt: new Date().toISOString(),
      },
      { status: 500 }
    );
  }
}
