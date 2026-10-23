/**
 * SWAI — Scoped Authentication & Authorization for External Muse Agent
 *
 * Enforces strict authentication for external agent endpoints:
 * - Checks Bearer token or x-muse-token header.
 * - Compares against MUSE_INGESTION_TOKEN, ADMIN_API_KEY, or SWAI_ADMIN_TOKEN.
 * - Enforces authentication even in development (external agent endpoints must never be unauthenticated).
 * - Constant-time comparison to prevent timing attacks.
 * - Extracts agent identifier safely without leaking secrets into logs.
 */

import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";

export interface AuthenticatedMuseAgent {
  agentId: string;
  workspaceId: string;
  scope: "READ_QUEUE" | "CLAIM" | "SUBMIT_RESULTS" | "ALL";
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
 * Verifies authorization for an external Muse agent request.
 */
export function verifyMuseAgentAuthorization(
  request: NextRequest,
  scope: "READ_QUEUE" | "CLAIM" | "SUBMIT_RESULTS" = "READ_QUEUE"
): MuseAuthResult {
  const allowedSecrets: string[] = [
    process.env.MUSE_INGESTION_TOKEN,
    process.env.ADMIN_API_KEY,
    process.env.SWAI_ADMIN_TOKEN,
    process.env.ADMIN_SECRET,
  ]
    .filter((s): s is string => typeof s === "string" && s.trim().length > 0)
    .map((s) => s.trim());

  // Extract provided token
  const authHeader = request.headers.get("authorization") || "";
  let providedToken = "";
  if (authHeader.startsWith("Bearer ")) {
    providedToken = authHeader.slice(7).trim();
  }

  if (!providedToken) {
    providedToken = (request.headers.get("x-muse-token") || "").trim();
  }

  if (!providedToken) {
    providedToken = (request.headers.get("x-admin-token") || "").trim();
  }

  // If no secret configured in the environment at all, fail securely:
  if (allowedSecrets.length === 0) {
    return {
      authorized: false,
      errorResponse: NextResponse.json(
        {
          success: false,
          error: {
            code: "MUSE_GATEWAY_NOT_CONFIGURED",
            message:
              "Muse external agent gateway requires MUSE_INGESTION_TOKEN or ADMIN_API_KEY to be configured in environment.",
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
            message: "Missing authorization token. Provide Bearer token or x-muse-token header.",
          },
        },
        { status: 401 }
      ),
    };
  }

  // Validate token against any configured secrets
  const isMatch = allowedSecrets.some((secret) => timingSafeMatch(providedToken, secret));

  if (!isMatch) {
    return {
      authorized: false,
      errorResponse: NextResponse.json(
        {
          success: false,
          error: {
            code: "INVALID_MUSE_CREDENTIALS",
            message: "The provided Muse authorization token is invalid.",
          },
        },
        { status: 403 }
      ),
    };
  }

  // Extract safe agent identity from header if provided (e.g. x-muse-agent-id), defaulting to "muse-agent-session"
  const rawAgentId = request.headers.get("x-muse-agent-id") || "muse-external-agent";
  const agentId = rawAgentId.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 64) || "muse-external-agent";

  // Extract workspace id from header or use default
  const workspaceId = request.headers.get("x-workspace-id") || "default-workspace";

  return {
    authorized: true,
    agent: {
      agentId,
      workspaceId,
      scope,
    },
  };
}
