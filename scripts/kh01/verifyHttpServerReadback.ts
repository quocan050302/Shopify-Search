/**
 * SWAI KH-01 V11.4.4 — Real HTTP Server API Verification
 *
 * Performs ACTUAL HTTP network exchanges over the loopback interface (127.0.0.1)
 * against a running Next.js server instance.
 *
 * Guarantees:
 * 1. Transport is genuinely TCP/IP HTTP (never in-process Route Handler invocation).
 * 2. Authenticates using valid administrator credentials and authorized workspace.
 * 3. Enforces negative authentication (rejects invalid token with 401/403).
 * 4. Reconciles exact database snapshot IDs against server JSON responses.
 */

export interface TestAuthenticationContext {
  token?: string;
  adminApiKey?: string;
  workspaceId: string;
}

export interface HttpServerReadbackInput {
  baseUrl: string;
  productId: string;
  jobId: string;
  workspaceId: string;
  expectedLandingSnapshotId: string | null;
  expectedOfferSnapshotId: string | null;
  expectedEvidenceIds?: string[];
  auth: TestAuthenticationContext;
  signal?: AbortSignal;
}

export interface HttpRequestEvidence {
  method: string;
  url: string;
  statusCode: number;
  durationMs: number;
  responseType: string | null;
  success: boolean;
}

export interface HttpServerReadbackResult {
  verified: boolean;
  transport: "ACTUAL_HTTP";
  serverBaseUrl: string;
  requests: HttpRequestEvidence[];
  productIdVerified: boolean;
  jobIdVerified: boolean;
  snapshotIdsVerified: boolean;
  evidenceVerified: boolean;
  authorizationVerified: boolean;
  errors: string[];
  data?: {
    overview?: any;
    jobStatus?: any;
  };
}

/**
 * Validates that the provided base URL targets a strictly authorized local loopback server.
 */
function assertAuthorizedLocalServer(baseUrl: string): void {
  try {
    const url = new URL(baseUrl);
    const isLoopback =
      url.hostname === "127.0.0.1" ||
      url.hostname === "localhost" ||
      url.hostname === "[::1]";

    if (!isLoopback) {
      throw new Error(
        `SECURITY VIOLATION: HTTP E2E tests are restricted to loopback addresses. Target '${url.hostname}' is prohibited.`
      );
    }
  } catch (err: any) {
    throw new Error(`Invalid server base URL '${baseUrl}': ${err.message}`);
  }
}

/**
 * Executes actual HTTP GET request to /api/v1/research/products/:id/overview
 */
export async function callResearchOverviewHttp(
  baseUrl: string,
  productId: string,
  auth: TestAuthenticationContext,
  signal?: AbortSignal
): Promise<{ evidence: HttpRequestEvidence; data: any; statusCode: number }> {
  assertAuthorizedLocalServer(baseUrl);
  const targetUrl = `${baseUrl}/api/v1/research/products/${encodeURIComponent(productId)}/overview`;
  const token = auth.adminApiKey || auth.token || "";

  const headers: Record<string, string> = {
    "x-workspace-id": auth.workspaceId,
    Accept: "application/json",
  };
  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }

  const startTime = Date.now();
  const response = await fetch(targetUrl, {
    method: "GET",
    headers,
    signal,
  });
  const durationMs = Date.now() - startTime;
  const contentType = response.headers.get("content-type");

  let parsedJson: any = null;
  try {
    parsedJson = await response.json();
  } catch {
    // Non-JSON or empty response
  }

  const evidence: HttpRequestEvidence = {
    method: "GET",
    url: targetUrl,
    statusCode: response.status,
    durationMs,
    responseType: contentType,
    success: response.ok && parsedJson?.success === true,
  };

  return { evidence, data: parsedJson, statusCode: response.status };
}

/**
 * Executes actual HTTP GET request to /api/v1/research/jobs/:jobId
 */
export async function callResearchJobStatusHttp(
  baseUrl: string,
  jobId: string,
  auth: TestAuthenticationContext,
  signal?: AbortSignal
): Promise<{ evidence: HttpRequestEvidence; data: any; statusCode: number }> {
  assertAuthorizedLocalServer(baseUrl);
  const targetUrl = `${baseUrl}/api/v1/research/jobs/${encodeURIComponent(jobId)}`;
  const token = auth.adminApiKey || auth.token || "";

  const headers: Record<string, string> = {
    "x-workspace-id": auth.workspaceId,
    Accept: "application/json",
  };
  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }

  const startTime = Date.now();
  const response = await fetch(targetUrl, {
    method: "GET",
    headers,
    signal,
  });
  const durationMs = Date.now() - startTime;
  const contentType = response.headers.get("content-type");

  let parsedJson: any = null;
  try {
    parsedJson = await response.json();
  } catch {
    // Non-JSON
  }

  const evidence: HttpRequestEvidence = {
    method: "GET",
    url: targetUrl,
    statusCode: response.status,
    durationMs,
    responseType: contentType,
    success: response.ok && parsedJson?.success === true,
  };

  return { evidence, data: parsedJson, statusCode: response.status };
}

/**
 * Reconciles snapshot IDs returned over HTTP against expected persisted IDs.
 */
export function verifySnapshotReferences(
  expected: {
    landingSnapshotId: string | null;
    offerSnapshotId: string | null;
  },
  overviewResponse: any,
  jobResponse?: any
): { verified: boolean; errors: string[] } {
  const errors: string[] = [];

  const actualLanding = overviewResponse?.data?.latestLandingPage?.id || null;
  const actualOffer = overviewResponse?.data?.offerSnapshots?.[0]?.id || null;

  if (expected.landingSnapshotId && actualLanding !== expected.landingSnapshotId) {
    errors.push(
      `Overview Landing Snapshot mismatch: expected '${expected.landingSnapshotId}', received '${actualLanding}'`
    );
  }

  if (expected.offerSnapshotId && actualOffer !== expected.offerSnapshotId) {
    errors.push(
      `Overview Offer Snapshot mismatch: expected '${expected.offerSnapshotId}', received '${actualOffer}'`
    );
  }

  if (jobResponse?.data) {
    const jobSnapshotId = jobResponse.data.snapshotId || null;
    if (expected.landingSnapshotId && jobSnapshotId && jobSnapshotId !== expected.landingSnapshotId) {
      errors.push(
        `Job Status Snapshot mismatch: expected '${expected.landingSnapshotId}', received '${jobSnapshotId}'`
      );
    }
  }

  return { verified: errors.length === 0, errors };
}

/**
 * Full orchestrator verifying HTTP server endpoints, snapshot reconciliation,
 * and security boundaries (positive and negative authentication).
 */
export async function verifyHttpServerReadback(
  input: HttpServerReadbackInput
): Promise<HttpServerReadbackResult> {
  const requests: HttpRequestEvidence[] = [];
  const errors: string[] = [];

  let productIdVerified = false;
  let jobIdVerified = false;
  let snapshotIdsVerified = false;
  let evidenceVerified = false;
  let authorizationVerified = false;

  let overviewData: any = null;
  let jobData: any = null;

  try {
    // 1. Negative Authentication Check: Request without valid credentials must be rejected (401)
    const unauthUrl = `${input.baseUrl}/api/v1/research/products/${encodeURIComponent(input.productId)}/overview`;
    const unauthStart = Date.now();
    const unauthRes = await fetch(unauthUrl, {
      method: "GET",
      headers: {
        "x-workspace-id": input.workspaceId,
        Authorization: "Bearer invalid_unauthorized_token_xyz",
      },
      signal: input.signal,
    });
    requests.push({
      method: "GET",
      url: unauthUrl,
      statusCode: unauthRes.status,
      durationMs: Date.now() - unauthStart,
      responseType: unauthRes.headers.get("content-type"),
      success: unauthRes.status === 401 || unauthRes.status === 403,
    });

    if (unauthRes.status !== 401 && unauthRes.status !== 403) {
      errors.push(
        `Security vulnerability: Server permitted request with invalid bearer token (HTTP ${unauthRes.status})`
      );
    } else {
      authorizationVerified = true;
    }

    // 2. Positive Authentication: GET product overview
    const overviewCall = await callResearchOverviewHttp(
      input.baseUrl,
      input.productId,
      input.auth,
      input.signal
    );
    requests.push(overviewCall.evidence);

    if (overviewCall.statusCode !== 200 || !overviewCall.evidence.success) {
      errors.push(
        `Product Overview HTTP GET failed with status ${overviewCall.statusCode}: ${JSON.stringify(overviewCall.data)}`
      );
    } else {
      overviewData = overviewCall.data;
      if (overviewData?.data?.product?.id === input.productId) {
        productIdVerified = true;
      } else {
        errors.push(
          `Product ID mismatch: expected '${input.productId}', received '${overviewData?.data?.product?.id}'`
        );
      }
    }

    // 3. Positive Authentication: GET job status
    if (input.jobId) {
      const jobCall = await callResearchJobStatusHttp(
        input.baseUrl,
        input.jobId,
        input.auth,
        input.signal
      );
      requests.push(jobCall.evidence);

      if (jobCall.statusCode !== 200 || !jobCall.evidence.success) {
        errors.push(
          `Job Status HTTP GET failed with status ${jobCall.statusCode}: ${JSON.stringify(jobCall.data)}`
        );
      } else {
        jobData = jobCall.data;
        if (jobData?.data?.jobId === input.jobId) {
          jobIdVerified = true;
        } else {
          errors.push(
            `Job ID mismatch: expected '${input.jobId}', received '${jobData?.data?.jobId}'`
          );
        }
      }
    } else {
      jobIdVerified = true;
    }

    // 4. Snapshot reference reconciliation
    if (overviewData) {
      const snapshotCheck = verifySnapshotReferences(
        {
          landingSnapshotId: input.expectedLandingSnapshotId,
          offerSnapshotId: input.expectedOfferSnapshotId,
        },
        overviewData,
        jobData
      );
      if (!snapshotCheck.verified) {
        errors.push(...snapshotCheck.errors);
      } else {
        snapshotIdsVerified = true;
      }

      // Check evidence count if expected IDs were provided
      if (input.expectedEvidenceIds && input.expectedEvidenceIds.length > 0) {
        const receivedEvidence = overviewData?.data?.evidenceRecords || [];
        const receivedIds = receivedEvidence.map((e: any) => e.id);
        const allPresent = input.expectedEvidenceIds.every((id) => receivedIds.includes(id));
        if (allPresent) {
          evidenceVerified = true;
        } else {
          errors.push("One or more expected evidence IDs were missing from Overview HTTP response");
        }
      } else {
        evidenceVerified = true;
      }
    }
  } catch (err: any) {
    errors.push(`HTTP readback exception: ${err.message || String(err)}`);
  }

  const verified =
    errors.length === 0 &&
    productIdVerified &&
    jobIdVerified &&
    snapshotIdsVerified &&
    authorizationVerified;

  return {
    verified,
    transport: "ACTUAL_HTTP",
    serverBaseUrl: input.baseUrl,
    requests,
    productIdVerified,
    jobIdVerified,
    snapshotIdsVerified,
    evidenceVerified,
    authorizationVerified,
    errors,
    data: {
      overview: overviewData?.data,
      jobStatus: jobData?.data,
    },
  };
}
