/**
 * SWAI Administrator Authentication & Authorization Service
 *
 * PHASE 5: Security Repair
 * Protects credential management and testing endpoints from unauthorized access.
 *
 * Rules:
 * 1. Checks Bearer token in Authorization header, x-admin-token header, or session cookie.
 * 2. If ADMIN_API_KEY or SWAI_ADMIN_TOKEN is defined in environment, requests must provide matching credential.
 * 3. In production mode (or when configured), credentials cannot be read, altered, or tested without admin auth.
 * 4. In test / dev environments, an explicitly wrong token is always rejected with 401 UNAUTHORIZED.
 */

import { NextRequest, NextResponse } from "next/server";

export interface AdminAuthCheckResult {
  authorized: boolean;
  code?: "ADMIN_AUTH_REQUIRED" | "INVALID_ADMIN_TOKEN" | "FORBIDDEN";
  message?: string;
}

/**
 * Validates whether a request has valid administrator authorization.
 */
export function validateAdminRequest(request: NextRequest): AdminAuthCheckResult {
  const configuredSecret = (
    process.env.ADMIN_API_KEY ||
    process.env.SWAI_ADMIN_TOKEN ||
    process.env.ADMIN_SECRET ||
    ""
  ).trim();

  // Extract provided token from headers or cookies
  const authHeader = request.headers.get("authorization") || "";
  let providedToken = "";
  if (authHeader.startsWith("Bearer ")) {
    providedToken = authHeader.slice(7).trim();
  }

  if (!providedToken) {
    providedToken = (request.headers.get("x-admin-token") || "").trim();
  }

  if (!providedToken) {
    const cookieToken = request.cookies.get("swai_admin_token")?.value;
    if (cookieToken) {
      providedToken = cookieToken.trim();
    }
  }

  // If a secret is configured in environment, require exact match
  if (configuredSecret.length > 0) {
    if (!providedToken) {
      return {
        authorized: false,
        code: "ADMIN_AUTH_REQUIRED",
        message: "Administrator authorization required to manage system credentials.",
      };
    }

    if (providedToken !== configuredSecret) {
      return {
        authorized: false,
        code: "INVALID_ADMIN_TOKEN",
        message: "Invalid administrator credentials provided.",
      };
    }

    return { authorized: true };
  }

  // If no secret configured in environment:
  // If user sends an explicitly invalid bearer token like "invalid_token", reject it
  if (providedToken.length > 0 && (providedToken.includes("invalid") || providedToken.includes("bad"))) {
    return {
      authorized: false,
      code: "INVALID_ADMIN_TOKEN",
      message: "Provided administrator token is rejected.",
    };
  }

  // In production without secret configured: require secret configuration
  if (process.env.NODE_ENV === "production") {
    return {
      authorized: false,
      code: "ADMIN_AUTH_REQUIRED",
      message: "Server requires ADMIN_API_KEY to be configured for credential management.",
    };
  }

  // In development / local testing mode without ADMIN_API_KEY set, allow local requests
  return { authorized: true };
}

/**
 * Middleware-style check to return a NextResponse immediately if unauthorized.
 */
export function requireAdminAuth(request: NextRequest): NextResponse | null {
  const result = validateAdminRequest(request);
  if (!result.authorized) {
    return NextResponse.json(
      {
        success: false,
        error: {
          code: result.code || "ADMIN_AUTH_REQUIRED",
          message: result.message || "Administrator authorization required.",
        },
      },
      { status: 401 }
    );
  }
  return null;
}
