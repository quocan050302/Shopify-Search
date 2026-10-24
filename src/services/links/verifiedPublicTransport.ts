/**
 * SWAI Verified Public Transport
 *
 * KH-01 Checkpoint 2 — Secure Network Connection
 *
 * Guarantees:
 * - Direct socket connection to pre-validated IP address (eliminates TOCTOU DNS rebinding).
 * - Full TLS Server Name Indication (SNI) matching destination hostname.
 * - Strict TLS certificate validation (rejectUnauthorized = true).
 * - Bounded streaming payload (aborts socket immediately if response exceeds byte limit).
 * - Clean socket cleanup and AbortSignal support.
 */

import http from "node:http";
import https from "node:https";
import net from "node:net";

export interface VerifiedPublicDestination {
  originalHostname: string;
  normalizedHostname: string;
  protocol: "http:" | "https:";
  port: number;
  validatedAddresses: string[];
  selectedAddress: string;
  family: 4 | 6;
  validatedAt: number;
}

export interface VerifiedTransportResponse {
  statusCode: number;
  statusMessage: string;
  headers: Record<string, string>;
  body: string | null;
  bytesRead: number;
  isTruncated: boolean;
  remoteAddress: string;
  durationMs: number;
}

export interface TransportRequestOptions {
  method?: string;
  headers?: Record<string, string>;
  timeoutMs?: number;
  maxBytes?: number;
  signal?: AbortSignal;
}

export interface VerifiedPublicTransport {
  destination: VerifiedPublicDestination;
  request(url: URL, options?: TransportRequestOptions): Promise<VerifiedTransportResponse>;
  close(): void;
}

export function createVerifiedPublicDispatcher(
  destination: VerifiedPublicDestination
): VerifiedPublicTransport {
  const isHttps = destination.protocol === "https:";
  const pinnedIp = destination.selectedAddress;
  const family = destination.family;

  const customLookup: http.AgentOptions["lookup"] = (
    _hostname,
    opts,
    callback
  ) => {
    if (opts && (opts as any).all) {
      callback(null, [{ address: pinnedIp, family } as any]);
    } else {
      callback(null, pinnedIp, family);
    }
  };

  const agent = isHttps
    ? new https.Agent({
        keepAlive: false,
        maxSockets: 1,
        lookup: customLookup,
        servername: destination.normalizedHostname,
        rejectUnauthorized: true,
      })
    : new http.Agent({
        keepAlive: false,
        maxSockets: 1,
        lookup: customLookup,
      });

  return {
    destination,
    close() {
      agent.destroy();
    },
    async request(
      targetUrl: URL,
      options: TransportRequestOptions = {}
    ): Promise<VerifiedTransportResponse> {
      const {
        method = "GET",
        headers = {},
        timeoutMs = 8000,
        maxBytes = 2 * 1024 * 1024,
        signal,
      } = options;

      const startTime = Date.now();

      return new Promise<VerifiedTransportResponse>((resolve, reject) => {
        if (signal?.aborted) {
          agent.destroy();
          return reject(new Error("Request aborted by caller prior to execution."));
        }

        const clientModule = isHttps ? https : http;

        const reqOptions: https.RequestOptions = {
          protocol: destination.protocol,
          hostname: destination.normalizedHostname,
          port: destination.port,
          path: `${targetUrl.pathname}${targetUrl.search}`,
          method,
          headers: {
            ...headers,
            Host: destination.normalizedHostname,
            Accept: "text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8",
            "Accept-Language": "en-US,en;q=0.9",
          },
          agent,
          servername: destination.normalizedHostname,
          rejectUnauthorized: true,
          timeout: timeoutMs,
        };

        let isCompleted = false;
        let timeoutTimer: NodeJS.Timeout | null = null;

        const cleanup = () => {
          if (timeoutTimer) clearTimeout(timeoutTimer);
          if (signal && onAbort) signal.removeEventListener("abort", onAbort);
        };

        const onAbort = () => {
          if (isCompleted) return;
          isCompleted = true;
          cleanup();
          req.destroy(new Error("Request aborted via AbortSignal."));
          agent.destroy();
          reject(new Error("Request aborted via AbortSignal."));
        };

        if (signal) {
          signal.addEventListener("abort", onAbort, { once: true });
        }

        const req = clientModule.request(reqOptions, (res) => {
          const resHeaders: Record<string, string> = {};
          for (const [key, value] of Object.entries(res.headers)) {
            if (value !== undefined) {
              resHeaders[key.toLowerCase()] = Array.isArray(value) ? value.join(", ") : value;
            }
          }

          const remoteAddress = res.socket?.remoteAddress || pinnedIp;
          let bytesRead = 0;
          let isTruncated = false;
          const chunks: Buffer[] = [];

          res.on("data", (chunk: Buffer) => {
            bytesRead += chunk.length;
            if (bytesRead > maxBytes) {
              isTruncated = true;
              const allowedBytes = Math.max(0, maxBytes - (bytesRead - chunk.length));
              if (allowedBytes > 0) {
                chunks.push(chunk.subarray(0, allowedBytes));
              }
              // Immediately abort further reading to conserve memory
              res.destroy();
            } else {
              chunks.push(chunk);
            }
          });

          res.on("end", () => {
            if (isCompleted) return;
            isCompleted = true;
            cleanup();
            const bodyBuffer = Buffer.concat(chunks);
            const body = bodyBuffer.toString("utf-8");
            agent.destroy();

            resolve({
              statusCode: res.statusCode || 200,
              statusMessage: res.statusMessage || "OK",
              headers: resHeaders,
              body,
              bytesRead,
              isTruncated,
              remoteAddress,
              durationMs: Date.now() - startTime,
            });
          });

          res.on("close", () => {
            if (!isCompleted) {
              isCompleted = true;
              cleanup();
              const bodyBuffer = Buffer.concat(chunks);
              const body = bodyBuffer.toString("utf-8");
              agent.destroy();

              resolve({
                statusCode: res.statusCode || 200,
                statusMessage: res.statusMessage || "OK",
                headers: resHeaders,
                body,
                bytesRead,
                isTruncated,
                remoteAddress,
                durationMs: Date.now() - startTime,
              });
            }
          });

          res.on("error", (err) => {
            if (isCompleted) return;
            isCompleted = true;
            cleanup();
            agent.destroy();
            reject(err);
          });
        });

        timeoutTimer = setTimeout(() => {
          if (isCompleted) return;
          isCompleted = true;
          cleanup();
          req.destroy(new Error(`Connection timed out after ${timeoutMs}ms.`));
          agent.destroy();
          reject(new Error(`Connection timed out after ${timeoutMs}ms.`));
        }, timeoutMs);

        req.on("error", (err) => {
          if (isCompleted) return;
          isCompleted = true;
          cleanup();
          agent.destroy();
          reject(err);
        });

        req.end();
      });
    },
  };
}
