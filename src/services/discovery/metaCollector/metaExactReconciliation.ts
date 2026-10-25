/**
 * SWAI V11.6.1 — Exact Ad ID Reconciliation and Verdict Helpers (Sections 07, 08, 22)
 *
 * Strict, bidirectional reconciliation across SQLite Database, exact-run HTTP API,
 * and Chromium Browser DOM. Fail-closed decision matrix ensuring no boundary is skipped
 * or accepted on asymmetric count matches.
 */

export interface ExactAdIdReconciliationInput {
  discoveryRunId: string;
  databaseIds: string[];
  httpIds: string[];
  browserIds: string[];
  databaseStatus: string;
  httpStatus: string;
  browserStatus: string;
  browserPaginationCompleted: boolean;
}

export interface ExactAdIdReconciliationResult {
  status: "PASSED" | "FAILED";
  exactMatch: boolean;
  databaseCount: number;
  httpCount: number;
  browserCount: number;
  missingFromHttp: string[];
  unexpectedInHttp: string[];
  missingFromBrowser: string[];
  unexpectedInBrowser: string[];
  duplicateDatabaseIds: string[];
  duplicateHttpIds: string[];
  duplicateBrowserIds: string[];
  errors: string[];
}

export type AcceptanceStatus = "PASSED" | "FAILED" | "BLOCKED" | "NOT_VERIFIED" | "SKIPPED";

export interface LiveJourneyGateResults {
  source: AcceptanceStatus;
  worker: AcceptanceStatus;
  persistence: AcceptanceStatus;
  http: AcceptanceStatus;
  browser: AcceptanceStatus;
  reconciliation: AcceptanceStatus;
  artifactIntegrity: AcceptanceStatus;
}

export interface LiveJourneyVerdict {
  success: boolean;
  verdict: "VERIFIED" | "FAILED" | "BLOCKED";
  blockingReasons: string[];
}

/**
 * Detects duplicate ad IDs in an array without altering original array order.
 * Returns deterministic unique list of duplicate IDs found.
 */
export function findDuplicateIds(ids: string[]): string[] {
  const seen = new Set<string>();
  const duplicates = new Set<string>();

  for (const rawId of ids) {
    if (!rawId || typeof rawId !== "string") continue;
    const id = rawId.trim();
    if (!id) continue;
    if (seen.has(id)) {
      duplicates.add(id);
    } else {
      seen.add(id);
    }
  }

  return Array.from(duplicates).sort();
}

/**
 * Authoritatively reconciles ad ID sets bidirectionally across Database, HTTP API, and Browser DOM.
 * Fails closed if any set is missing an ID, contains an unexpected ID, has duplicates,
 * or if counts mismatch.
 */
export function reconcileExactAdIdSets(input: ExactAdIdReconciliationInput): ExactAdIdReconciliationResult {
  const errors: string[] = [];

  const duplicateDatabaseIds = findDuplicateIds(input.databaseIds);
  const duplicateHttpIds = findDuplicateIds(input.httpIds);
  const duplicateBrowserIds = findDuplicateIds(input.browserIds);

  if (duplicateDatabaseIds.length > 0) {
    errors.push(`Duplicate database ad IDs detected: ${duplicateDatabaseIds.join(", ")}`);
  }
  if (duplicateHttpIds.length > 0) {
    errors.push(`Duplicate HTTP ad IDs detected: ${duplicateHttpIds.join(", ")}`);
  }
  if (duplicateBrowserIds.length > 0) {
    errors.push(`Duplicate browser ad IDs detected: ${duplicateBrowserIds.join(", ")}`);
  }

  const dbSet = new Set(input.databaseIds.map((id) => id?.trim()).filter(Boolean));
  const httpSet = new Set(input.httpIds.map((id) => id?.trim()).filter(Boolean));
  const browserSet = new Set(input.browserIds.map((id) => id?.trim()).filter(Boolean));

  const missingFromHttp = input.databaseIds.filter((id) => !httpSet.has(id));
  const unexpectedInHttp = input.httpIds.filter((id) => !dbSet.has(id));

  const missingFromBrowser = input.databaseIds.filter((id) => !browserSet.has(id));
  const unexpectedInBrowser = input.browserIds.filter((id) => !dbSet.has(id));

  if (missingFromHttp.length > 0) {
    errors.push(`Ads missing from HTTP readback (${missingFromHttp.length}): ${missingFromHttp.join(", ")}`);
  }
  if (unexpectedInHttp.length > 0) {
    errors.push(`Unexpected ads in HTTP readback (${unexpectedInHttp.length}): ${unexpectedInHttp.join(", ")}`);
  }
  if (missingFromBrowser.length > 0) {
    errors.push(`Ads missing from browser rendering (${missingFromBrowser.length}): ${missingFromBrowser.join(", ")}`);
  }
  if (unexpectedInBrowser.length > 0) {
    errors.push(`Unexpected ads in browser rendering (${unexpectedInBrowser.length}): ${unexpectedInBrowser.join(", ")}`);
  }

  const isDbOk = input.databaseStatus === "PASSED" || input.databaseStatus === "COMPLETED";
  if (!isDbOk) {
    errors.push(`Database status is '${input.databaseStatus}', expected PASSED or COMPLETED.`);
  }

  const isHttpOk = input.httpStatus === "PASSED" || input.httpStatus === "200";
  if (!isHttpOk) {
    errors.push(`HTTP readback status is '${input.httpStatus}', expected PASSED or 200.`);
  }

  const isBrowserOk = input.browserStatus === "PASSED";
  if (!isBrowserOk) {
    errors.push(`Browser rendering status is '${input.browserStatus}', expected PASSED.`);
  }

  if (!input.browserPaginationCompleted) {
    errors.push("Browser pagination traversal was incomplete.");
  }

  if (input.databaseIds.length !== input.httpIds.length) {
    errors.push(`Count mismatch: Database has ${input.databaseIds.length} ads, HTTP has ${input.httpIds.length} ads.`);
  }

  if (input.databaseIds.length !== input.browserIds.length) {
    errors.push(`Count mismatch: Database has ${input.databaseIds.length} ads, Browser has ${input.browserIds.length} ads.`);
  }

  if (input.databaseIds.length === 0) {
    errors.push("Database contains 0 ad records to reconcile.");
  }

  const exactMatch =
    isDbOk &&
    isHttpOk &&
    isBrowserOk &&
    input.browserPaginationCompleted === true &&
    missingFromHttp.length === 0 &&
    unexpectedInHttp.length === 0 &&
    missingFromBrowser.length === 0 &&
    unexpectedInBrowser.length === 0 &&
    duplicateDatabaseIds.length === 0 &&
    duplicateHttpIds.length === 0 &&
    duplicateBrowserIds.length === 0 &&
    input.databaseIds.length === input.httpIds.length &&
    input.databaseIds.length === input.browserIds.length &&
    input.databaseIds.length > 0;

  return {
    status: exactMatch ? "PASSED" : "FAILED",
    exactMatch,
    databaseCount: input.databaseIds.length,
    httpCount: input.httpIds.length,
    browserCount: input.browserIds.length,
    missingFromHttp,
    unexpectedInHttp,
    missingFromBrowser,
    unexpectedInBrowser,
    duplicateDatabaseIds,
    duplicateHttpIds,
    duplicateBrowserIds,
    errors,
  };
}

/**
 * Pure decision function mapping multi-boundary verification gates to a fail-closed verdict.
 * Rejection at any mandatory stage results in FAILED or BLOCKED.
 */
export function finalizeLiveJourneyVerdict(gates: LiveJourneyGateResults): LiveJourneyVerdict {
  const blockingReasons: string[] = [];

  if (gates.source === "BLOCKED") {
    blockingReasons.push("Upstream source access blocked or rate limited.");
  } else if (gates.source !== "PASSED") {
    blockingReasons.push(`Source acceptance failed: status is '${gates.source}'.`);
  }

  if (gates.worker !== "PASSED") {
    blockingReasons.push(`Discovery worker execution failed: status is '${gates.worker}'.`);
  }

  if (gates.persistence !== "PASSED") {
    blockingReasons.push(`Database persistence failed: status is '${gates.persistence}'.`);
  }

  if (gates.http !== "PASSED") {
    blockingReasons.push(`HTTP exact-run readback failed: status is '${gates.http}'.`);
  }

  if (gates.browser !== "PASSED") {
    blockingReasons.push(`Chromium browser rendering failed: status is '${gates.browser}'.`);
  }

  if (gates.reconciliation !== "PASSED") {
    blockingReasons.push(`Cross-boundary exact ID reconciliation failed: status is '${gates.reconciliation}'.`);
  }

  if (gates.artifactIntegrity !== "PASSED") {
    blockingReasons.push(`Artifact integrity validation failed: status is '${gates.artifactIntegrity}'.`);
  }

  const isBlocked =
    gates.source === "BLOCKED" ||
    gates.worker === "BLOCKED" ||
    gates.browser === "BLOCKED";

  const success =
    gates.source === "PASSED" &&
    gates.worker === "PASSED" &&
    gates.persistence === "PASSED" &&
    gates.http === "PASSED" &&
    gates.browser === "PASSED" &&
    gates.reconciliation === "PASSED" &&
    gates.artifactIntegrity === "PASSED";

  let verdict: "VERIFIED" | "FAILED" | "BLOCKED";
  if (success) {
    verdict = "VERIFIED";
  } else if (isBlocked) {
    verdict = "BLOCKED";
  } else {
    verdict = "FAILED";
  }

  return {
    success,
    verdict,
    blockingReasons,
  };
}
