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

export interface DeploymentSecurityConfig {
  deploymentMode?: string;
  remoteAccess?: string;
  host?: string;
  port?: string | number;
  nodeEnv?: string;
  cloudProviders?: {
    isVercel?: boolean;
    isRender?: boolean;
    isFly?: boolean;
    isKService?: boolean;
  };
}

export interface DeploymentSecurityPolicy {
  mode: "LOCAL_ONLY" | "AUTHENTICATED_REMOTE";
  localBypassAllowed: boolean;
  configurationValid: boolean;
  reason: string;
}

/**
 * Resolves the authoritative deployment security policy from server-side configuration.
 * Disallows client-controlled bypass, ensures public listener bindings cannot claim local trust,
 * and detects startup configuration conflicts.
 */
export function resolveDeploymentSecurityPolicy(
  config?: DeploymentSecurityConfig
): DeploymentSecurityPolicy {
  const deploymentMode = (config?.deploymentMode ?? process.env.SWAI_DEPLOYMENT_MODE ?? "").trim().toUpperCase();
  const remoteAccess = (config?.remoteAccess ?? process.env.SWAI_REMOTE_ACCESS ?? "").trim().toLowerCase();
  const host = (config?.host ?? process.env.HOST ?? "").trim().toLowerCase();
  const isCloud = config?.cloudProviders
    ? Boolean(config.cloudProviders.isVercel || config.cloudProviders.isRender || config.cloudProviders.isFly || config.cloudProviders.isKService)
    : Boolean(process.env.VERCEL || process.env.RENDER || process.env.FLY_APP_NAME || process.env.K_SERVICE);

  // 1. Cloud container platforms are always authenticated remote
  if (isCloud) {
    return {
      mode: "AUTHENTICATED_REMOTE",
      localBypassAllowed: false,
      configurationValid: true,
      reason: "Public cloud container platform detected.",
    };
  }

  // 2. Explicit REMOTE deployment mode
  if (deploymentMode === "REMOTE") {
    return {
      mode: "AUTHENTICATED_REMOTE",
      localBypassAllowed: false,
      configurationValid: true,
      reason: "Server explicitly configured in REMOTE deployment mode.",
    };
  }

  // 3. Explicit remote access flag
  if (remoteAccess === "true" || remoteAccess === "1") {
    return {
      mode: "AUTHENTICATED_REMOTE",
      localBypassAllowed: false,
      configurationValid: true,
      reason: "Remote access flag enabled.",
    };
  }

  // 4. Public listener binding (0.0.0.0) strictly prohibits local bypass
  if (host === "0.0.0.0") {
    const isDeclaredLocal =
      deploymentMode === "LOCAL_DESKTOP" ||
      process.env.SWAI_LOCAL_DESKTOP === "true";
    return {
      mode: "AUTHENTICATED_REMOTE",
      localBypassAllowed: false,
      configurationValid: !isDeclaredLocal, // Configuration conflict if declared local while bound to 0.0.0.0
      reason: isDeclaredLocal
        ? "Configuration conflict: Local desktop declared but listener bound publicly to 0.0.0.0."
        : "Server listener bound publicly to 0.0.0.0.",
    };
  }

  // 5. Non-loopback IP binding (e.g. LAN IP 192.168.x.x)
  if (host && host !== "127.0.0.1" && host !== "localhost" && host !== "[::1]") {
    return {
      mode: "AUTHENTICATED_REMOTE",
      localBypassAllowed: false,
      configurationValid: true,
      reason: `Server bound to non-loopback host interface: ${host}.`,
    };
  }

  // 6. Verified loopback binding (127.0.0.1, localhost, [::1])
  const isLoopback = host === "127.0.0.1" || host === "localhost" || host === "[::1]";
  if (isLoopback) {
    const isEnforcedAuth =
      process.env.SWAI_REQUIRE_AUTH === "true" ||
      process.env.SWAI_E2E_SERVER === "true";

    return {
      mode: "LOCAL_ONLY",
      localBypassAllowed: !isEnforcedAuth,
      configurationValid: true,
      reason: isEnforcedAuth
        ? "Local loopback listener with strict authentication required by environment."
        : "Trusted local desktop deployment bound to loopback interface.",
    };
  }

  // 7. Unspecified or unverified host: cannot verify loopback isolation
  return {
    mode: "AUTHENTICATED_REMOTE",
    localBypassAllowed: false,
    configurationValid: true,
    reason: "Server listener binding is unspecified or unverified; authentication required.",
  };
}

export interface ServerStartupConfig {
  host?: string;
  port?: number | string;
  nodeEnv?: string;
  allowLocalBypass?: boolean;
}

export interface BindingPolicyResult {
  valid: boolean;
  mode: "LOCAL_ONLY" | "AUTHENTICATED_REMOTE";
  listenerHost: string;
  localBypassAllowed: boolean;
  errors: string[];
}

export interface VerifiedBindingResult {
  verifiedLoopback: boolean;
  listenerHost: string;
  mode: "LOCAL_ONLY" | "AUTHENTICATED_REMOTE";
  localBypassAllowed: boolean;
  reason: string;
}

/**
 * Resolves verified server binding from startup configuration.
 * Disallows treating unverified listeners as loopback.
 */
export function resolveVerifiedServerBinding(
  config?: ServerStartupConfig
): VerifiedBindingResult {
  const host = (config?.host ?? process.env.HOST ?? "").trim().toLowerCase();
  const isLoopback = host === "127.0.0.1" || host === "localhost" || host === "[::1]";
  const isEnforcedAuth = process.env.SWAI_REQUIRE_AUTH === "true" || process.env.SWAI_E2E_SERVER === "true";

  if (isLoopback) {
    return {
      verifiedLoopback: true,
      listenerHost: host,
      mode: "LOCAL_ONLY",
      localBypassAllowed: !isEnforcedAuth && config?.allowLocalBypass !== false,
      reason: "Verified loopback listener binding.",
    };
  }

  return {
    verifiedLoopback: false,
    listenerHost: host || "unspecified",
    mode: "AUTHENTICATED_REMOTE",
    localBypassAllowed: false,
    reason: host ? `Non-loopback listener binding: ${host}` : "Unspecified listener binding.",
  };
}

/**
 * Validates server listener binding policy at startup or request time.
 * Rejects public binding (0.0.0.0 or LAN) in local-bypass mode.
 * Fails closed when binding cannot be verified.
 */
export function validateServerBindingPolicy(
  input: ServerStartupConfig
): BindingPolicyResult {
  const host = (input.host || "").trim().toLowerCase();
  const errors: string[] = [];

  const isPublic = host === "0.0.0.0" || (host.length > 0 && host !== "127.0.0.1" && host !== "localhost" && host !== "[::1]");
  const isLoopback = host === "127.0.0.1" || host === "localhost" || host === "[::1]";

  if (isPublic) {
    if (input.allowLocalBypass) {
      errors.push(`Public binding interface '${host}' is incompatible with local desktop authentication bypass.`);
    }
    return {
      valid: errors.length === 0,
      mode: "AUTHENTICATED_REMOTE",
      listenerHost: host,
      localBypassAllowed: false,
      errors,
    };
  }

  if (isLoopback) {
    return {
      valid: true,
      mode: "LOCAL_ONLY",
      listenerHost: host,
      localBypassAllowed: input.allowLocalBypass !== false,
      errors: [],
    };
  }

  // Unspecified or unverified host
  return {
    valid: true,
    mode: "AUTHENTICATED_REMOTE",
    listenerHost: host || "unspecified",
    localBypassAllowed: false,
    errors: ["Listener binding is unspecified and not verified as loopback."],
  };
}

/**
 * Verifies whether the server environment is explicitly configured and controlled as a
 * trusted local-first desktop application.
 */
export function isTrustedLocalDeployment(config?: DeploymentSecurityConfig): boolean {
  const policy = resolveDeploymentSecurityPolicy(config);
  return policy.configurationValid && policy.mode === "LOCAL_ONLY";
}

/**
 * Resolves the server-side trusted request context for an incoming HTTP request.
 * Evaluates transport boundaries, proxy headers, and local deployment policies.
 */
export function resolveTrustedRequestContext(request: NextRequest): TrustedRequestContext {
  const policy = resolveDeploymentSecurityPolicy();

  // If server is not in trusted local deployment or configuration is invalid, operate in remote mode
  if (policy.mode !== "LOCAL_ONLY" || !policy.configurationValid) {
    return {
      deploymentMode: "REMOTE",
      authenticationRequired: true,
      trustEstablished: false,
      reason: policy.reason,
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

  // Genuine loopback request verified under local desktop deployment
  return {
    deploymentMode: "LOCAL_DESKTOP",
    authenticationRequired: !policy.localBypassAllowed,
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
      // Credential was provided by caller, but no secret is configured on the server to verify it.
      // Explicit invalid/unverifiable credentials must NEVER implicitly authenticate.
      return {
        authorized: false,
        code: "INVALID_ADMIN_TOKEN",
        message: "Explicit administrator credentials provided but cannot be verified (no secret configured).",
      };
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
