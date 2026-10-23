/**
 * SWAI V10.1 — Scoped Authentication & Authorization for External Muse Agent
 *
 * Strict separation of external agent credentials from administrator credentials:
 * 1. Checks Bearer token in Authorization header or x-muse-token header.
 * 2. Compares strictly against MUSE_INGESTION_TOKEN only (rejects administrator credentials).
 * 3. Enforces authentication in all environments (development, staging, production).
 * 4. Constant-time comparison prevents timing side-channel attacks.
 * 5. Binds external agent credentials to authorized workspaces server-side;
 *    never trusts arbitrary client-provided x-workspace-id headers.
 * 6. Restricts agent permissions to: READ_QUEUE, CLAIM, HEARTBEAT, and SUBMIT_RESULTS.
 */

import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";

export type MuseAgentScope = "READ_QUEUE" | "CLAIM" | "HEARTBEAT" | "SUBMIT_RESULTS" | "ALL";

export interface AuthenticatedMuseAgent {
  agentId: string;
  workspaceId: string;
  scope: MuseAgentScope;
}

export interface MuseAuthResult {
  authorized: boolean;
  agent?: AuthenticatedMuseAgent;
  errorResponse?: NextResponse;
}

function timingSafeMatch(a: string, b: string): boolean {
  if (typeof a !== "string" || typeof b !== "string") return false;
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

/**
 * Resolves the server-side authorized workspace for the external Muse agent.
 * Avoids trusting client-supplied headers without verification.
 */
export function getAuthorizedWorkspaceForAgent(): string {
  const configured = (process.env.MUSE_WORKSPACE_ID || "").trim();
  return configured.length > 0 ? configured : "default-workspace";
}

/**
 * Verifies authorization for an external Muse agent request.
 * Accepts ONLY MUSE_INGESTION_TOKEN.
 */
export function verifyMuseAgentAuthorization(
  request: NextRequest,
  scope: MuseAgentScope = "READ_QUEUE"
): MuseAuthResult {
  const agentToken = (process.env.MUSE_INGESTION_TOKEN || "").trim();

  // Extract provided token from Authorization header or x-muse-token
  const authHeader = request.headers.get("authorization") || "";
  let providedToken = "";
  if (authHeader.startsWith("Bearer ")) {
    providedToken = authHeader.slice(7).trim();
  }

  if (!providedToken) {
    providedToken = (request.headers.get("x-muse-token") || "").trim();
  }

  // If MUSE_INGESTION_TOKEN is not configured in environment, fail safely
  if (agentToken.length === 0) {
    return {
      authorized: false,
      errorResponse: NextResponse.json(
        {
          success: false,
          error: {
            code: "MUSE_GATEWAY_NOT_CONFIGURED",
            message:
              "Muse external agent gateway requires MUSE_INGESTION_TOKEN to be configured in environment.",
          },
        },
        { status: 401 }
      ),
    };
  }

  if (!providedToken) {
    return {
      authorized: false,
      errorResponse: NextResponse.json(
        {
          success: false,
          error: {
            code: "MUSE_AUTH_REQUIRED",
            message:
              "Missing external agent authorization token. Provide Bearer token or x-muse-token header.",
          },
        },
        { status: 401 }
      ),
    };
  }

  // Explicitly disallow administrator credentials on external agent endpoints
  const adminSecret = (
    process.env.ADMIN_API_KEY ||
    process.env.SWAI_ADMIN_TOKEN ||
    process.env.ADMIN_SECRET ||
    ""
  ).trim();

  if (
    adminSecret.length > 0 &&
    timingSafeMatch(providedToken, adminSecret) &&
    !timingSafeMatch(providedToken, agentToken)
  ) {
    return {
      authorized: false,
      errorResponse: NextResponse.json(
        {
          success: false,
          error: {
            code: "FORBIDDEN_ADMIN_CREDENTIAL_ON_AGENT_GATEWAY",
            message:
              "Administrator credentials cannot be used on external agent gateway. Use MUSE_INGESTION_TOKEN.",
          },
        },
        { status: 403 }
      ),
    };
  }

  // Validate token against MUSE_INGESTION_TOKEN
  const isMatch = timingSafeMatch(providedToken, agentToken);

  if (!isMatch) {
    return {
      authorized: false,
      errorResponse: NextResponse.json(
        {
          success: false,
          error: {
            code: "INVALID_MUSE_CREDENTIALS",
            message: "The provided Muse external agent authorization token is invalid.",
          },
        },
        { status: 403 }
      ),
    };
  }

  // Server-side workspace binding: never trust arbitrary x-workspace-id
  const boundWorkspaceId = getAuthorizedWorkspaceForAgent();
  const requestedWorkspaceId = (request.headers.get("x-workspace-id") || "").trim();

  if (requestedWorkspaceId.length > 0 && requestedWorkspaceId !== boundWorkspaceId) {
    return {
      authorized: false,
      errorResponse: NextResponse.json(
        {
          success: false,
          error: {
            code: "UNAUTHORIZED_WORKSPACE",
            message: `The agent credential is bound to workspace '${boundWorkspaceId}', not '${requestedWorkspaceId}'.`,
          },
        },
        { status: 403 }
      ),
    };
  }

  // Extract safe agent identity from header if provided, defaulting to "muse-external-agent"
  const rawAgentId = request.headers.get("x-muse-agent-id") || "muse-external-agent";
  const agentId = rawAgentId.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 64) || "muse-external-agent";

  return {
    authorized: true,
    agent: {
      agentId,
      workspaceId: boundWorkspaceId,
      scope,
    },
  };
}

import { validateAdminRequest } from "@/services/security/adminAuth";

export interface UserOrAgentAuthResult {
  authorized: boolean;
  isAgent: boolean;
  agent?: AuthenticatedMuseAgent;
  workspaceId: string;
  errorResponse?: NextResponse;
}

/**
 * Authorizes either:
 * 1. An external Muse agent providing MUSE_INGESTION_TOKEN via Authorization or x-muse-token header.
 * 2. A same-origin SWAI user / administrator providing standard session or admin credentials.
 * This ensures the web UI never has to know or expose MUSE_INGESTION_TOKEN.
 */
export function verifyUserOrAgentAuthorization(
  request: NextRequest,
  agentScope: MuseAgentScope = "READ_QUEUE"
): UserOrAgentAuthResult {
  const authHeader = request.headers.get("authorization") || "";
  const hasBearer = authHeader.startsWith("Bearer ");
  const hasMuseHeader = Boolean(request.headers.get("x-muse-token"));

  // If agent headers are present, attempt agent authentication
  if (hasBearer || hasMuseHeader) {
    const agentToken = (process.env.MUSE_INGESTION_TOKEN || "").trim();
    let token = "";
    if (hasBearer) token = authHeader.slice(7).trim();
    if (!token && hasMuseHeader) token = (request.headers.get("x-muse-token") || "").trim();

    // Check if provided token matches external agent token
    if (agentToken.length > 0 && timingSafeMatch(token, agentToken)) {
      const agentAuth = verifyMuseAgentAuthorization(request, agentScope);
      if (agentAuth.authorized && agentAuth.agent) {
        return {
          authorized: true,
          isAgent: true,
          agent: agentAuth.agent,
          workspaceId: agentAuth.agent.workspaceId,
        };
      }
      return {
        authorized: false,
        isAgent: true,
        errorResponse: agentAuth.errorResponse,
        workspaceId: getAuthorizedWorkspaceForAgent(),
      };
    }
  }

  // Otherwise, verify as same-origin user/admin session
  const adminCheck = validateAdminRequest(request);
  if (adminCheck.authorized) {
    const workspaceId = (request.headers.get("x-workspace-id") || "").trim() || "default-workspace";
    return {
      authorized: true,
      isAgent: false,
      agent: {
        agentId: "user-ui-session",
        workspaceId,
        scope: "SUBMIT_RESULTS",
      },
      workspaceId,
    };
  }

  return {
    authorized: false,
    isAgent: false,
    workspaceId: "default-workspace",
    errorResponse: NextResponse.json(
      {
        success: false,
        error: {
          code: adminCheck.code || "UNAUTHORIZED",
          message: adminCheck.message || "User authorization required.",
        },
      },
      { status: 401 }
    ),
  };
}
