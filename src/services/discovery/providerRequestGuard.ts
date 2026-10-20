/**
 * SWAI V9 — Provider Request Guard & Ledger Service
 *
 * Implements strict security, SSRF validation, budget checks, timeout controls,
 * and audit ledger logging for all outbound provider requests.
 */

import { prisma } from "@/lib/db";
import { validateExternalResourceUrl } from "@/lib/security";
import { authorizePaidApiCall, recordPaidApiUsage } from "@/services/providers/budgetService";
import { ProviderId } from "@/services/credentials/credentialService";
import { DiscoveryError, DiscoveryErrorCode } from "./types";

export interface GuardedRequestOptions {
  providerId: string;
  url: string;
  method?: "GET" | "POST";
  headers?: Record<string, string>;
  body?: string;
  timeoutMs?: number;
  jobId?: string;
  discoveryRunId?: string;
  estimatedCredits?: number;
  estimatedCostUsd?: number;
  isAutomaticRequest?: boolean;
  isPaid?: boolean;
}

export interface GuardedResponse<T = unknown> {
  status: number;
  data: T;
  rawText: string;
  durationMs: number;
  providerRequestId?: string;
}

/**
 * Executes an external provider HTTP request through strict security and budget guards.
 */
export async function executeGuardedProviderRequest<T = unknown>(
  options: GuardedRequestOptions
): Promise<GuardedResponse<T>> {
  const {
    providerId,
    url,
    method = "GET",
    headers = {},
    body,
    timeoutMs = 15000,
    jobId,
    discoveryRunId,
    estimatedCredits = 1,
    isAutomaticRequest = true,
    isPaid = false,
  } = options;

  const startTime = Date.now();

  // 1. SSRF and Protocol Guard
  const sec = validateExternalResourceUrl(url);
  if (!sec.isValid || !sec.sanitizedUrl) {
    throw new DiscoveryError({
      code: "PROVIDER_RESPONSE_INVALID",
      message: `Blocked unsafe outbound URL '${url}': ${sec.reason || "Security policy violation"}`,
      providerId,
      statusHttp: 400,
    });
  }

  // 2. Budget & Credit Authorization Guard (Only for paid providers)
  if (isPaid) {
    if (process.env.FREE_DISCOVERY_MODE === "true") {
      throw new DiscoveryError({
        code: "PROVIDER_BUDGET_BLOCKED",
        message: "Paid requests are blocked because FREE_DISCOVERY_MODE is active.",
        providerId,
        statusHttp: 403,
      });
    }

    const pId = providerId as ProviderId;
    const auth = authorizePaidApiCall({
      provider: pId,
      estimatedCredits,
      isAutomaticRequest,
    });

    if (!auth.allowed) {
      // Record blocked attempt in ledger
      try {
        await prisma.providerRequestLedger.create({
          data: {
            providerId,
            discoveryRunId: discoveryRunId || null,
            jobId: jobId || null,
            outcome: "BLOCKED",
            httpStatus: 403,
            resultCount: 0,
            estimatedCost: 0,
            actualCost: 0,
            creditUnit: "CREDITS",
            errorCategory: "PROVIDER_BUDGET_BLOCKED",
            requestDurationMs: 0,
            endpointRedacted: sanitizeEndpointForLogging(url),
          },
        });
      } catch (logErr) {
        console.warn("Could not log blocked request in ledger:", logErr);
      }

      throw new DiscoveryError({
        code: "PROVIDER_BUDGET_BLOCKED",
        message: auth.reason || `Request to paid provider '${providerId}' was blocked by budget policy.`,
        providerId,
        statusHttp: 403,
      });
    }
  }

  // 3. Setup Request with Timeout
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  let response: Response;
  let rawText = "";

  try {
    response = await fetch(sec.sanitizedUrl, {
      method,
      headers: {
        "Accept": "application/json",
        "User-Agent": "SWAI-Research-Engine/9.0 (United States Ecommerce Research)",
        ...headers,
      },
      body,
      signal: controller.signal,
    });

    rawText = await response.text();
  } catch (err: unknown) {
    clearTimeout(timeoutId);
    const durationMs = Date.now() - startTime;
    const isTimeout = err instanceof Error && (err.name === "AbortError" || err.message.includes("aborted"));

    // Record failure in ledger
    try {
      await prisma.providerRequestLedger.create({
        data: {
          providerId,
          discoveryRunId: discoveryRunId || null,
          jobId: jobId || null,
          outcome: isTimeout ? "TIMEOUT" : "FAILED",
          httpStatus: isTimeout ? 408 : 500,
          resultCount: 0,
          requestDurationMs: durationMs,
          errorCategory: isTimeout ? "PROVIDER_UNAVAILABLE" : "PROVIDER_RESPONSE_INVALID",
          endpointRedacted: sanitizeEndpointForLogging(url),
        },
      });
    } catch {
      // ignore db logging failure
    }

    throw new DiscoveryError({
      code: isTimeout ? "PROVIDER_UNAVAILABLE" : "PROVIDER_RESPONSE_INVALID",
      message: isTimeout
        ? `Provider request timed out after ${timeoutMs}ms.`
        : `Network request to '${providerId}' failed: ${err instanceof Error ? err.message : String(err)}`,
      providerId,
      statusHttp: isTimeout ? 408 : 500,
    });
  } finally {
    clearTimeout(timeoutId);
  }

  const durationMs = Date.now() - startTime;
  const providerRequestId =
    response.headers.get("x-request-id") ||
    response.headers.get("x-tt-logid") ||
    response.headers.get("request-id") ||
    undefined;

  // 4. Handle HTTP Rate Limits (429) & Auth Denials (401/403)
  if (response.status === 429) {
    await recordLedgerEntry({
      providerId,
      discoveryRunId,
      jobId,
      outcome: "RATE_LIMITED",
      httpStatus: 429,
      resultCount: 0,
      durationMs,
      errorCategory: "PROVIDER_RATE_LIMITED",
      providerRequestId,
      url,
    });

    throw new DiscoveryError({
      code: "PROVIDER_RATE_LIMITED",
      message: `Provider '${providerId}' rate limited request (HTTP 429). Retry after backoff.`,
      providerId,
      statusHttp: 429,
    });
  }

  if (response.status === 401 || response.status === 403) {
    await recordLedgerEntry({
      providerId,
      discoveryRunId,
      jobId,
      outcome: "AUTH_REQUIRED",
      httpStatus: response.status,
      resultCount: 0,
      durationMs,
      errorCategory: "PROVIDER_PERMISSION_DENIED",
      providerRequestId,
      url,
    });

    throw new DiscoveryError({
      code: "PROVIDER_PERMISSION_DENIED",
      message: `Provider '${providerId}' access denied (HTTP ${response.status}). Authorization required.`,
      providerId,
      statusHttp: response.status,
    });
  }

  // 5. Parse JSON Response
  let parsedJson: T;
  try {
    parsedJson = JSON.parse(rawText) as T;
  } catch {
    await recordLedgerEntry({
      providerId,
      discoveryRunId,
      jobId,
      outcome: "FAILED",
      httpStatus: response.status,
      resultCount: 0,
      durationMs,
      errorCategory: "PROVIDER_RESPONSE_INVALID",
      providerRequestId,
      url,
    });

    throw new DiscoveryError({
      code: "PROVIDER_RESPONSE_INVALID",
      message: `Provider '${providerId}' returned malformed non-JSON response.`,
      providerId,
      statusHttp: response.status,
    });
  }

  // 6. Record usage if paid and successful
  if (isPaid && response.ok && estimatedCredits > 0) {
    try {
      recordPaidApiUsage(providerId as ProviderId, estimatedCredits);
    } catch (e) {
      console.warn("Failed to record paid API usage:", e);
    }
  }

  // 7. Record successful ledger entry
  await recordLedgerEntry({
    providerId,
    discoveryRunId,
    jobId,
    outcome: response.ok ? "SUCCESS" : "FAILED",
    httpStatus: response.status,
    resultCount: 1,
    durationMs,
    providerRequestId,
    url,
  });

  return {
    status: response.status,
    data: parsedJson,
    rawText,
    durationMs,
    providerRequestId,
  };
}

/**
 * Sanitizes an outbound endpoint URL for safe persistence in logs.
 * Masks query params like apiKey, token, cookie, session.
 */
function sanitizeEndpointForLogging(rawUrl: string): string {
  try {
    const parsed = new URL(rawUrl);
    const masked = new URLSearchParams();
    for (const [key, value] of parsed.searchParams.entries()) {
      const lower = key.toLowerCase();
      if (lower.includes("token") || lower.includes("key") || lower.includes("secret") || lower.includes("auth")) {
        masked.set(key, "***REDACTED***");
      } else {
        masked.set(key, value);
      }
    }
    parsed.search = masked.toString();
    return parsed.toString();
  } catch {
    return "[MALFORMED_URL]";
  }
}

async function recordLedgerEntry(opts: {
  providerId: string;
  discoveryRunId?: string;
  jobId?: string;
  outcome: string;
  httpStatus: number;
  resultCount: number;
  durationMs: number;
  errorCategory?: DiscoveryErrorCode;
  providerRequestId?: string;
  url: string;
}): Promise<void> {
  try {
    await prisma.providerRequestLedger.create({
      data: {
        providerId: opts.providerId,
        discoveryRunId: opts.discoveryRunId || null,
        jobId: opts.jobId || null,
        outcome: opts.outcome,
        httpStatus: opts.httpStatus,
        resultCount: opts.resultCount,
        requestDurationMs: opts.durationMs,
        providerRequestId: opts.providerRequestId || null,
        errorCategory: opts.errorCategory || null,
        endpointRedacted: sanitizeEndpointForLogging(opts.url),
      },
    });
  } catch (err) {
    console.warn("Could not save provider request ledger:", err);
  }
}

export const executeProviderRequest = executeGuardedProviderRequest;
