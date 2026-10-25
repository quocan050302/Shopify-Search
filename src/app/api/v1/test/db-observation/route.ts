import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { prisma } from "@/lib/db";
import { resolveDatabaseConfiguration, canonicalizeSqliteDatabasePath } from "@/lib/database/databaseConfig";

export interface DbObservationSecurityContext {
  enabled: boolean;
  isolatedDatabaseVerified: boolean;
  expectedAcceptanceRunId: string;
  expectedDatabaseKey: string;
  authenticationConfigured: boolean;
  error?: string;
}

/**
 * Resolves trusted diagnostic security context from environment variables.
 * Enforces strict environment preconditions and rejects protected database paths.
 */
export function resolveDbObservationSecurityContext(
  env: NodeJS.ProcessEnv = process.env
): DbObservationSecurityContext {
  const isIsolatedServer =
    env.SWAI_E2E_SERVER === "true" &&
    env.SWAI_TEST_ISOLATION === "strict" &&
    (env.SWAI_DB_ROLE === "LIVE_ACCEPTANCE" || env.SWAI_DB_ROLE === "INTEGRATION_TEST");

  if (!isIsolatedServer) {
    return {
      enabled: false,
      isolatedDatabaseVerified: false,
      expectedAcceptanceRunId: "",
      expectedDatabaseKey: "",
      authenticationConfigured: false,
      error: "Diagnostic database observation endpoint is disabled in production.",
    };
  }

  // Verify database URL is isolated and non-protected
  let canonicalKey = "";
  try {
    const config = resolveDatabaseConfiguration();
    canonicalKey = canonicalizeSqliteDatabasePath(config.url).canonicalKey;

    const defaultDevCanonical = canonicalizeSqliteDatabasePath("file:./dev.db").canonicalKey;
    const defaultPrismaCanonical = canonicalizeSqliteDatabasePath("file:./prisma/dev.db").canonicalKey;

    if (
      canonicalKey === defaultDevCanonical ||
      canonicalKey === defaultPrismaCanonical ||
      canonicalKey.endsWith("/dev.db") ||
      canonicalKey.includes("dev.db") ||
      canonicalKey.includes("production.db")
    ) {
      return {
        enabled: false,
        isolatedDatabaseVerified: false,
        expectedAcceptanceRunId: "",
        expectedDatabaseKey: canonicalKey,
        authenticationConfigured: false,
        error: "Diagnostic database observation endpoint rejected protected development database path.",
      };
    }
  } catch (err: any) {
    return {
      enabled: false,
      isolatedDatabaseVerified: false,
      expectedAcceptanceRunId: "",
      expectedDatabaseKey: "",
      authenticationConfigured: false,
      error: `Failed to resolve database configuration: ${err.message}`,
    };
  }

  const expectedAcceptanceRunId = env.KH01_ACCEPTANCE_RUN_ID || env.SWAI_ACCEPTANCE_RUN_ID || "";
  if (!expectedAcceptanceRunId || expectedAcceptanceRunId.trim().length === 0) {
    return {
      enabled: false,
      isolatedDatabaseVerified: true,
      expectedAcceptanceRunId: "",
      expectedDatabaseKey: canonicalKey,
      authenticationConfigured: false,
      error: "Missing run-specific acceptance ID in server configuration.",
    };
  }

  const configuredToken = env.KH01_DB_OBSERVATION_TOKEN || "";
  if (!configuredToken || configuredToken.trim().length < 16) {
    return {
      enabled: false,
      isolatedDatabaseVerified: true,
      expectedAcceptanceRunId,
      expectedDatabaseKey: canonicalKey,
      authenticationConfigured: false,
      error: "Missing or insecure diagnostic token in server configuration.",
    };
  }

  return {
    enabled: true,
    isolatedDatabaseVerified: true,
    expectedAcceptanceRunId,
    expectedDatabaseKey: canonicalKey,
    authenticationConfigured: true,
  };
}

/**
 * Validates provided token against configured token using timing-safe comparison.
 * Never allows static defaults, fallback credentials, or empty tokens.
 */
export function verifyDbObservationToken(
  providedToken: string | null,
  configuredToken: string | undefined
): boolean {
  if (!providedToken || !configuredToken) {
    return false;
  }
  const cleanProvided = providedToken.trim();
  const cleanConfigured = configuredToken.trim();
  if (cleanProvided.length === 0 || cleanConfigured.length === 0) {
    return false;
  }

  try {
    const bufProvided = Buffer.from(cleanProvided, "utf8");
    const bufConfigured = Buffer.from(cleanConfigured, "utf8");
    if (bufProvided.length !== bufConfigured.length) {
      return false;
    }
    return crypto.timingSafeEqual(bufProvided, bufConfigured);
  } catch {
    return false;
  }
}

/**
 * Diagnostic route for verifying cross-process database identity from the running Next.js server.
 * Strict security constraints:
 * - Only enabled in verified isolated acceptance/test execution
 * - Refuses requests in standard production environments
 * - Requires run-specific cryptographically generated bearer token
 * - Never accepts static or historical credentials
 * - Never exposes raw file passwords, secrets, or internal connection credentials
 */
export async function GET(request: NextRequest) {
  const secCtx = resolveDbObservationSecurityContext(process.env);

  if (!secCtx.enabled) {
    return NextResponse.json(
      { success: false, error: secCtx.error || "Diagnostic database observation endpoint is disabled." },
      { status: 403 }
    );
  }

  const authHeader = request.headers.get("authorization");
  const tokenHeader = request.headers.get("x-acceptance-token") || request.headers.get("x-diagnostic-token");
  const bearerToken = authHeader?.startsWith("Bearer ") ? authHeader.slice(7).trim() : null;
  const providedToken = bearerToken || tokenHeader;

  if (!verifyDbObservationToken(providedToken, process.env.KH01_DB_OBSERVATION_TOKEN)) {
    return NextResponse.json(
      { success: false, error: "Unauthorized access to database observation diagnostic." },
      { status: 401 }
    );
  }

  const { searchParams } = new URL(request.url);
  const requestedRunId = searchParams.get("acceptanceRunId");
  if (!requestedRunId || requestedRunId !== secCtx.expectedAcceptanceRunId) {
    return NextResponse.json(
      { success: false, error: "Acceptance run ID mismatch or missing in request." },
      { status: 403 }
    );
  }

  const markerId = searchParams.get("markerId");
  if (!markerId || markerId.trim().length === 0) {
    return NextResponse.json(
      { success: false, error: "Query parameter 'markerId' is required." },
      { status: 400 }
    );
  }

  try {
    const ws = await prisma.workspace.findUnique({
      where: { id: markerId },
      select: { id: true, name: true, createdAt: true },
    });

    const markerObserved = Boolean(ws && ws.id === markerId);

    return NextResponse.json({
      success: true,
      processName: "NEXTJS_SERVER",
      processId: process.pid,
      acceptanceRunId: requestedRunId,
      markerId,
      markerObserved,
      observedDatabaseKey: secCtx.expectedDatabaseKey,
      workspaceName: ws?.name || null,
      observedAt: new Date().toISOString(),
    });
  } catch (err: any) {
    return NextResponse.json(
      {
        success: false,
        processName: "NEXTJS_SERVER",
        processId: process.pid,
        acceptanceRunId: requestedRunId,
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
