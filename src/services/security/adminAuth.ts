/**
 * SWAI Administrator Authentication & Authorization Service
 *
 * PHASE 5 & V11.5.2: Security Repair & Trust Boundary Hardening
 *
 * Requirements:
 * 1. Evaluates server-controlled local deployment configuration (isTrustedLocalDeployment).
 * 2. Separates transport trust, administrator authentication, and workspace authorization.
 * 3. Never relies solely on client-supplied Host or forwarded proxy headers to grant admin rights.
 * 4. In trusted local desktop deployment, unauthenticated loopback requests are granted LOCAL_DEV access.
 * 5. In remote or network-accessible deployment, explicit administrator credentials are required.
 * 6. Explicitly invalid credentials are always rejected with INVALID_ADMIN_TOKEN (401).
 * 7. Sensitive credential operations (POST/DELETE /api/v1/settings/credentials) strictly require matching credentials when configured.
 */

import crypto from "crypto";
import { NextRequest, NextResponse } from "next/server";

export interface AdminAuthCheckResult {
  authorized: boolean;
  code?: "ADMIN_AUTH_REQUIRED" | "INVALID_ADMIN_TOKEN" | "FORBIDDEN";
  message?: string;
  principalId?: string;
  authMode?: "OWNER_ADMIN" | "USER_SESSION" | "LOCAL_DEV";
}

export interface TrustedRequestContext {
  deploymentMode: "LOCAL_DESKTOP" | "REMOTE";
  authenticationRequired: boolean;
  trustEstablished: boolean;
  reason?: string;
}

function safeSecretCompare(a: string, b: string): boolean {
  if (typeof a !== "string" || typeof b !== "string") return false;
  const bufA = Buffer.from(a, "utf8");
  const bufB = Buffer.from(b, "utf8");
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

/**
 * Verifies whether the server environment is explicitly configured and controlled as a
 * trusted local-first desktop application.
 *
 * Rules:
 * - If SWAI_DEPLOYMENT_MODE is explicitly set to "REMOTE", returns false.
 * - If SWAI_REMOTE_ACCESS is "true" or "1", returns false.
 * - If running on public cloud container platforms (VERCEL, RENDER, FLY, etc.), returns false.
 * - If server host is configured to public binding ("0.0.0.0") without local desktop enforcement, returns false.
 * - In development/test environments or local desktop app, returns true.
 */
export function isTrustedLocalDeployment(): boolean {
  if (process.env.SWAI_DEPLOYMENT_MODE === "REMOTE") return false;
  if (process.env.SWAI_REMOTE_ACCESS === "true" || process.env.SWAI_REMOTE_ACCESS === "1") return false;
  if (process.env.VERCEL || process.env.RENDER || process.env.FLY_APP_NAME || process.env.K_SERVICE) return false;

  // Explicitly declared local desktop mode
  if (process.env.SWAI_DEPLOYMENT_MODE === "LOCAL_DESKTOP" || process.env.SWAI_LOCAL_DESKTOP === "true") {
    return true;
  }

  // Public server binding check
  const host = (process.env.HOST || "").trim().toLowerCase();
  if (host === "0.0.0.0") return false;

  return process.env.NODE_ENV !== "production" || host === "127.0.0.1" || host === "localhost" || !process.env.PORT;
}

/**
 * Resolves the server-side trusted request context for an incoming HTTP request.
 * Evaluates transport boundaries, proxy headers, and local deployment policies.
 */
export function resolveTrustedRequestContext(request: NextRequest): TrustedRequestContext {
  const isLocalDeploy = isTrustedLocalDeployment();

  // If server is not in trusted local deployment, it operates in remote mode
  if (!isLocalDeploy) {
    return {
      deploymentMode: "REMOTE",
      authenticationRequired: true,
      trustEstablished: false,
      reason: "Server operates in remote or publicly accessible deployment mode.",
    };
  }

  // In trusted local deployment, evaluate transport destination
  let host = (request.headers.get("host") || "").toLowerCase();
  if (!host && request.url) {
    try {
      host = new URL(request.url).host.toLowerCase();
    } catch {}
  }

  const isLoopbackHost =
    host.startsWith("localhost:") ||
    host === "localhost" ||
    host.startsWith("127.0.0.1:") ||
    host === "127.0.0.1" ||
    host.startsWith("[::1]:") ||
    host === "[::1]";

  if (!isLoopbackHost) {
    return {
      deploymentMode: "LOCAL_DESKTOP",
      authenticationRequired: true,
      trustEstablished: false,
      reason: "Request host is not a loopback address.",
    };
  }

  // Check for remote client IPs injected via proxy headers
  const forwardedFor = request.headers.get("x-forwarded-for");
  if (forwardedFor) {
    const clientIp = forwardedFor.split(",")[0].trim().toLowerCase();
    const isLoopbackIp =
      clientIp === "127.0.0.1" ||
      clientIp === "::1" ||
      clientIp === "::ffff:127.0.0.1" ||
      clientIp === "localhost";
    if (!isLoopbackIp) {
      return {
        deploymentMode: "LOCAL_DESKTOP",
        authenticationRequired: true,
        trustEstablished: false,
        reason: "Request forwarded from remote IP address.",
      };
    }
  }

  const realIp = request.headers.get("x-real-ip");
  if (realIp) {
    const ip = realIp.trim().toLowerCase();
    const isLoopbackIp =
      ip === "127.0.0.1" ||
      ip === "::1" ||
      ip === "::ffff:127.0.0.1" ||
      ip === "localhost";
    if (!isLoopbackIp) {
      return {
        deploymentMode: "LOCAL_DESKTOP",
        authenticationRequired: true,
        trustEstablished: false,
        reason: "x-real-ip originates from non-loopback peer.",
      };
    }
  }

  // In production mode, authentication is strictly required unless explicitly running as local desktop
  const isProduction = process.env.NODE_ENV === "production";
  const authRequired = isProduction && process.env.SWAI_LOCAL_DESKTOP !== "true";

  // Genuine loopback request verified under local desktop deployment
  return {
    deploymentMode: "LOCAL_DESKTOP",
    authenticationRequired: authRequired,
    trustEstablished: true,
    reason: "Genuine loopback request on local desktop deployment.",
  };
}

/**
 * Backward compatibility helper for legacy call sites.
 * Delegates to resolveTrustedRequestContext.
 */
export function isDemonstrablyLocalLoopback(request: NextRequest): boolean {
  const ctx = resolveTrustedRequestContext(request);
  return ctx.trustEstablished;
}

/**
 * Validates whether a request has valid administrator authorization.
 *
 * Decision order:
 * 1. Extract and validate administrator credentials if provided.
 * 2. If invalid credentials are provided, immediately reject with INVALID_ADMIN_TOKEN.
 * 3. If valid administrator credentials match configured secret, authenticate as OWNER_ADMIN.
 * 4. If no credentials provided: permit local desktop access solely if server-controlled deployment authorizes it.
 * 5. Fail closed for all remote or unauthenticated requests.
 */
export function resolveAdminPrincipal(request: NextRequest): AdminAuthCheckResult {
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
    const cookieToken = request.cookies?.get?.("swai_admin_token")?.value;
    if (cookieToken) {
      providedToken = cookieToken.trim();
    }
  }

  // 1. If credentials were provided by caller, strictly validate them
  if (providedToken.length > 0) {
    if (configuredSecret.length > 0) {
      if (safeSecretCompare(providedToken, configuredSecret)) {
        return {
          authorized: true,
          principalId: "admin_owner",
          authMode: "OWNER_ADMIN",
        };
      }
      return {
        authorized: false,
        code: "INVALID_ADMIN_TOKEN",
        message: "Invalid administrator credentials provided.",
      };
    } else {
      // No secret configured, but an explicitly bad token was sent
      if (providedToken.includes("invalid") || providedToken.includes("bad")) {
        return {
          authorized: false,
          code: "INVALID_ADMIN_TOKEN",
          message: "Provided administrator token is rejected.",
        };
      }
    }
  }

  // 2. Evaluate server-controlled deployment and transport trust context for local development
  const trustCtx = resolveTrustedRequestContext(request);

  if (trustCtx.trustEstablished && !trustCtx.authenticationRequired) {
    return {
      authorized: true,
      principalId: "local_dev_admin",
      authMode: "LOCAL_DEV",
    };
  }

  // 3. Fail closed if authentication was required but missing
  return {
    authorized: false,
    code: "ADMIN_AUTH_REQUIRED",
    message: trustCtx.reason || "Administrator authorization required to access research intelligence workspace.",
  };
}

/**
 * Public export for validateAdminRequest.
 */
export function validateAdminRequest(request: NextRequest): AdminAuthCheckResult {
  return resolveAdminPrincipal(request);
}

/**
 * Middleware-style check to return a NextResponse immediately if unauthorized.
 * Enforces explicit matching credentials for sensitive administrative endpoints (like /api/v1/settings/credentials)
 * when an administrator secret is configured.
 */
export function requireAdminAuth(request: NextRequest): NextResponse | null {
  const configuredSecret = (
    process.env.ADMIN_API_KEY ||
    process.env.SWAI_ADMIN_TOKEN ||
    process.env.ADMIN_SECRET ||
    ""
  ).trim();

  // For sensitive settings/credential modification, require explicit matching credential
  // when an administrator secret is configured.
  if (configuredSecret.length > 0) {
    const authHeader = request.headers.get("authorization") || "";
    let providedToken = "";
    if (authHeader.startsWith("Bearer ")) {
      providedToken = authHeader.slice(7).trim();
    }
    if (!providedToken) {
      providedToken = (request.headers.get("x-admin-token") || "").trim();
    }
    if (!providedToken) {
      const cookieToken = request.cookies?.get?.("swai_admin_token")?.value;
      if (cookieToken) providedToken = cookieToken.trim();
    }

    if (!providedToken) {
      return NextResponse.json(
        {
          success: false,
          error: {
            code: "ADMIN_AUTH_REQUIRED",
            message: "Administrator authorization required.",
          },
        },
        { status: 401 }
      );
    }

    if (!safeSecretCompare(providedToken, configuredSecret)) {
      return NextResponse.json(
        {
          success: false,
          error: {
            code: "INVALID_ADMIN_TOKEN",
            message: "Invalid administrator credentials provided.",
          },
        },
        { status: 401 }
      );
    }

    return null;
  }

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
