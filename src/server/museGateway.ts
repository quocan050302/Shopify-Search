/**
 * SWAI V10.1 — Restricted Local Muse HTTPS/HTTP Reverse Proxy Gateway
 *
 * Dedicated local reverse proxy listening on 127.0.0.1:8787,
 * strictly forwarding permitted Muse agent traffic to 127.0.0.1:3000.
 *
 * Security Constraints:
 * 1. Allows ONLY the existing /api/v1/discovery/muse/agent/* endpoints and intended HTTP methods.
 * 2. ALL other paths return HTTP 404 (/, /settings, /api/v1/settings, _next/*, etc.).
 * 3. Enforces constant-time MUSE_INGESTION_TOKEN authentication before forwarding.
 * 4. Explicitly forbids administrator credentials on the agent gateway (HTTP 403).
 * 5. Bounded payload sizes (max 2MB, HTTP 413 on excess).
 * 6. Rate limiting (max 60 req/min per IP, HTTP 429 on excess).
 * 7. Socket & upstream timeouts (30s, HTTP 504 on timeout, HTTP 502 on unreachable upstream).
 * 8. Never exposes ADMIN_API_KEY, MUSE_INGESTION_TOKEN, or database details in logs or responses.
 */

import http from "node:http";
import crypto from "node:crypto";
import { URL } from "node:url";

export interface MuseGatewayOptions {
  port?: number;
  host?: string;
  targetHost?: string;
  maxBodySizeBytes?: number;
  timeoutMs?: number;
  rateLimitMax?: number;
  rateLimitWindowMs?: number;
  silent?: boolean;
}

export interface RouteMatch {
  allowed: boolean;
  endpointName: string;
}

/**
 * Validates whether the given HTTP method and pathname match permitted agent endpoints.
 * Permitted:
 * 1. GET   /api/v1/discovery/muse/agent/requests
 * 2. GET   /api/v1/discovery/muse/agent/requests/:id
 * 3. PATCH /api/v1/discovery/muse/agent/requests/:id
 * 4. POST  /api/v1/discovery/muse/agent/requests/:id/results
 * 5. POST  /api/v1/discovery/muse/agent/heartbeat
 */
export function matchPermittedRoute(method: string, pathname: string): RouteMatch {
  const m = method.toUpperCase();

  // 1. GET /api/v1/discovery/muse/agent/requests
  if (m === "GET" && pathname === "/api/v1/discovery/muse/agent/requests") {
    return { allowed: true, endpointName: "LIST_ASSIGNED_QUEUE" };
  }

  // 2. POST /api/v1/discovery/muse/agent/heartbeat
  if (m === "POST" && pathname === "/api/v1/discovery/muse/agent/heartbeat") {
    return { allowed: true, endpointName: "AGENT_HEARTBEAT" };
  }

  // 3. POST /api/v1/discovery/muse/agent/requests/:id/results
  const resultsRegex = /^\/api\/v1\/discovery\/muse\/agent\/requests\/([a-zA-Z0-9_-]+)\/results$/;
  if (m === "POST" && resultsRegex.test(pathname)) {
    return { allowed: true, endpointName: "SUBMIT_RESULTS" };
  }

  // 4. GET or PATCH /api/v1/discovery/muse/agent/requests/:id
  const requestItemRegex = /^\/api\/v1\/discovery\/muse\/agent\/requests\/([a-zA-Z0-9_-]+)$/;
  if ((m === "GET" || m === "PATCH") && requestItemRegex.test(pathname)) {
    return {
      allowed: true,
      endpointName: m === "GET" ? "GET_REQUEST_DETAIL" : "CLAIM_REQUEST",
    };
  }

  // All other methods or paths are rejected with 404
  return { allowed: false, endpointName: "FORBIDDEN_ROUTE" };
}

function timingSafeMatch(a: string, b: string): boolean {
  if (typeof a !== "string" || typeof b !== "string") return false;
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

export function createMuseGatewayServer(options: MuseGatewayOptions = {}): http.Server {
  const {
    targetHost = process.env.SWAI_UPSTREAM_URL || "http://127.0.0.1:3000",
    maxBodySizeBytes = 2 * 1024 * 1024, // 2MB
    timeoutMs = 30000, // 30s
    rateLimitMax = 60,
    rateLimitWindowMs = 60000,
    silent = false,
  } = options;

  const targetParsed = new URL(targetHost);
  const rateLimitMap = new Map<string, RateLimitEntry>();

  // Periodically clean up rate limit map
  const cleanupInterval = setInterval(() => {
    const now = Date.now();
    for (const [ip, entry] of rateLimitMap.entries()) {
      if (entry.resetAt <= now) {
        rateLimitMap.delete(ip);
      }
    }
  }, 60000);
  cleanupInterval.unref();

  const server = http.createServer((req, res) => {
    const startTime = Date.now();
    const clientIp =
      (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() ||
      req.socket.remoteAddress ||
      "127.0.0.1";

    const sendJsonResponse = (statusCode: number, data: unknown, extraHeaders: Record<string, string> = {}) => {
      if (res.headersSent) return;
      const body = JSON.stringify(data);
      res.writeHead(statusCode, {
        "content-type": "application/json; charset=utf-8",
        "content-length": Buffer.byteLength(body),
        "x-content-type-options": "nosniff",
        "x-frame-options": "DENY",
        ...extraHeaders,
      });
      res.end(body);

      if (!silent) {
        const duration = Date.now() - startTime;
        console.log(
          `[MUSE-GATEWAY] ${req.method} ${req.url?.split("?")[0]} -> ${statusCode} (${duration}ms) [IP: ${clientIp}]`
        );
      }
    };

    // 1. Parse URL & path
    let pathname = "";
    try {
      const parsedUrl = new URL(req.url || "/", `http://${req.headers.host || "127.0.0.1"}`);
      pathname = parsedUrl.pathname;
    } catch {
      sendJsonResponse(400, {
        success: false,
        error: { code: "INVALID_URL", message: "Malformed request URL." },
      });
      return;
    }

    // 2. Strict Whitelist Route & Method Check (All others return 404!)
    const route = matchPermittedRoute(req.method || "", pathname);
    if (!route.allowed) {
      sendJsonResponse(404, {
        success: false,
        error: {
          code: "NOT_FOUND",
          message: "Resource not found on restricted Muse gateway.",
        },
      });
      return;
    }

    // 3. Rate Limiting Check
    const now = Date.now();
    const rateEntry = rateLimitMap.get(clientIp);
    if (rateEntry && rateEntry.resetAt > now) {
      if (rateEntry.count >= rateLimitMax) {
        const retryAfter = Math.ceil((rateEntry.resetAt - now) / 1000);
        sendJsonResponse(
          429,
          {
            success: false,
            error: {
              code: "RATE_LIMIT_EXCEEDED",
              message: `Rate limit of ${rateLimitMax} req/min exceeded. Please retry after ${retryAfter} seconds.`,
            },
          },
          { "Retry-After": String(retryAfter) }
        );
        return;
      }
      rateEntry.count += 1;
    } else {
      rateLimitMap.set(clientIp, { count: 1, resetAt: now + rateLimitWindowMs });
    }

    // 4. Authentication Check (MUSE_INGESTION_TOKEN only)
    const agentSecret = (process.env.MUSE_INGESTION_TOKEN || "").trim();
    const adminSecret = (
      process.env.ADMIN_API_KEY ||
      process.env.SWAI_ADMIN_TOKEN ||
      process.env.ADMIN_SECRET ||
      ""
    ).trim();

    if (agentSecret.length === 0) {
      sendJsonResponse(401, {
        success: false,
        error: {
          code: "MUSE_GATEWAY_NOT_CONFIGURED",
          message:
            "Gateway requires MUSE_INGESTION_TOKEN to be configured in environment.",
        },
      });
      return;
    }

    // Extract token
    const authHeader = (req.headers["authorization"] as string) || "";
    let providedToken = "";
    if (authHeader.startsWith("Bearer ")) {
      providedToken = authHeader.slice(7).trim();
    }
    if (!providedToken && req.headers["x-muse-token"]) {
      providedToken = String(req.headers["x-muse-token"]).trim();
    }

    if (!providedToken) {
      sendJsonResponse(401, {
        success: false,
        error: {
          code: "MUSE_AUTH_REQUIRED",
          message: "Missing external agent authorization token on restricted gateway.",
        },
      });
      return;
    }

    // Disallow administrator credentials on agent gateway
    if (
      adminSecret.length > 0 &&
      timingSafeMatch(providedToken, adminSecret) &&
      !timingSafeMatch(providedToken, agentSecret)
    ) {
      sendJsonResponse(403, {
        success: false,
        error: {
          code: "FORBIDDEN_ADMIN_CREDENTIAL_ON_AGENT_GATEWAY",
          message:
            "Administrator credentials are strictly forbidden on external agent gateway. Use MUSE_INGESTION_TOKEN.",
        },
      });
      return;
    }

    // Validate token against MUSE_INGESTION_TOKEN
    if (!timingSafeMatch(providedToken, agentSecret)) {
      sendJsonResponse(403, {
        success: false,
        error: {
          code: "INVALID_MUSE_CREDENTIALS",
          message: "The provided Muse external agent authorization token is invalid.",
        },
      });
      return;
    }

    // 5. Bounded Request Body Buffering & Size Validation
    const contentLengthHeader = req.headers["content-length"];
    if (contentLengthHeader && parseInt(contentLengthHeader, 10) > maxBodySizeBytes) {
      sendJsonResponse(413, {
        success: false,
        error: {
          code: "PAYLOAD_TOO_LARGE",
          message: `Payload exceeds maximum permitted size of ${maxBodySizeBytes / (1024 * 1024)}MB.`,
        },
      });
      return;
    }

    const chunks: Buffer[] = [];
    let receivedBytes = 0;
    let isPayloadTooLarge = false;

    req.on("data", (chunk: Buffer) => {
      receivedBytes += chunk.length;
      if (receivedBytes > maxBodySizeBytes) {
        isPayloadTooLarge = true;
        req.destroy();
        sendJsonResponse(413, {
          success: false,
          error: {
            code: "PAYLOAD_TOO_LARGE",
            message: `Payload exceeds maximum permitted size of ${maxBodySizeBytes / (1024 * 1024)}MB.`,
          },
        });
        return;
      }
      chunks.push(chunk);
    });

    req.on("end", () => {
      if (isPayloadTooLarge) return;
      const requestBody = Buffer.concat(chunks);

      // 6. Forward Permitted Traffic to Upstream (127.0.0.1:3000)
      const forwardHeaders: http.OutgoingHttpHeaders = {
        ...req.headers,
        host: targetParsed.host,
        "x-forwarded-for": clientIp,
        "x-forwarded-proto": "http",
        "x-forwarded-host": req.headers.host || "127.0.0.1:8787",
        "x-muse-gateway-source": "muse-reverse-proxy-8787",
        "x-muse-gateway-verified": "true",
      };

      // Strip potential hop-by-hop headers
      delete forwardHeaders["connection"];
      delete forwardHeaders["keep-alive"];
      delete forwardHeaders["proxy-authenticate"];
      delete forwardHeaders["proxy-authorization"];
      delete forwardHeaders["te"];
      delete forwardHeaders["trailers"];
      delete forwardHeaders["transfer-encoding"];
      delete forwardHeaders["upgrade"];

      const upstreamReq = http.request(
        {
          hostname: targetParsed.hostname,
          port: targetParsed.port || (targetParsed.protocol === "https:" ? 443 : 80),
          path: req.url,
          method: req.method,
          headers: forwardHeaders,
          timeout: timeoutMs,
        },
        (upstreamRes) => {
          res.writeHead(upstreamRes.statusCode || 500, upstreamRes.headers);
          upstreamRes.pipe(res);

          if (!silent) {
            const duration = Date.now() - startTime;
            console.log(
              `[MUSE-GATEWAY] ${req.method} ${pathname} -> ${upstreamRes.statusCode} (${duration}ms)`
            );
          }
        }
      );

      upstreamReq.on("timeout", () => {
        upstreamReq.destroy();
        sendJsonResponse(504, {
          success: false,
          error: {
            code: "UPSTREAM_TIMEOUT",
            message: "Upstream SWAI Next.js server timed out handling the request.",
          },
        });
      });

      upstreamReq.on("error", (err: NodeJS.ErrnoException) => {
        sendJsonResponse(502, {
          success: false,
          error: {
            code: "UPSTREAM_UNAVAILABLE",
            message:
              "Upstream SWAI server (127.0.0.1:3000) is unreachable. Ensure Next.js is running ('npm run dev').",
            detail: err.code === "ECONNREFUSED" ? "Connection refused by target port." : err.message,
          },
        });
      });

      if (requestBody.length > 0) {
        upstreamReq.write(requestBody);
      }
      upstreamReq.end();
    });

    req.on("error", () => {
      sendJsonResponse(400, {
        success: false,
        error: { code: "CLIENT_REQUEST_ERROR", message: "Client socket error." },
      });
    });
  });

  return server;
}
