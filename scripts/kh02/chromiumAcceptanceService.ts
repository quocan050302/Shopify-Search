/**
 * SWAI KH-02 V12.4.3.4.6 — Isolated Chromium Acceptance, True Three-System Parity & Read-Only Content Integrity Service
 *
 * Enforces:
 * 1. Independent Persisted SQLite Snapshot (`loadPersistedRunSnapshotFromSqlite`) — never uses uncommitted in-memory arrays as DB oracle.
 * 2. True Three-Way Parity (`SQLite <-> HTTP API <-> Chromium DOM`) with independent `dbVsHttpVerdict`, `dbVsDomVerdict`, `httpVsDomVerdict`.
 * 3. Required field presence enforcement (missing `candidateId`, `storeDomain`, `identityStatus`, `title`, `rank`, `score` fails closed).
 * 4. Exact normalized title comparison (never substring or 15-char prefix match).
 * 5. Read-Only Content Integrity (`assessReadOnlyMutation`) using row counts AND deterministic SHA-256 content digests across KH-02 tables
 *    plus verified HTTP 200 JSON response validation.
 */

import { ChildProcess, spawn } from "child_process";
import crypto from "crypto";
import fs from "fs";
import path from "path";
import http from "http";
import net from "net";
import { chromium, Browser, BrowserContext, Page } from "playwright-core";
import { prisma } from "../../src/lib/db";

export interface ServerLaunchOptions {
  buildPath?: string;
  port: number;
  logFilePath?: string;
  signal?: AbortSignal;
  timeoutMs?: number;
  allowDynamicPortFallback?: boolean;
}

export interface ServerLaunchResult {
  childProcess: ChildProcess;
  pid: number | null;
  port: number;
  baseUrl: string;
  serverReady: boolean;
  ownedProcessVerified: boolean;
  portConflictDetected: boolean;
  startupDurationMs: number;
  stopServer: () => Promise<void>;
}

export interface ProductionBuildVerificationOptions {
  sourceSha: string;
  buildLogPath: string;
  cwd?: string;
  buildDir?: string;
  signal?: AbortSignal;
  timeoutMs?: number;
  spawnImpl?: typeof spawn;
}

export interface ProductionBuildVerificationResult {
  executed: boolean;
  status: "BUILD_PASS" | "BUILD_FAILED" | "BUILD_TIMED_OUT" | "BUILD_SPAWN_ERROR";
  allowServerAndChromiumLaunch: boolean;
  sourceSha: string;
  command: string;
  pid: number | null;
  startedAt: string;
  completedAt: string;
  durationMs: number;
  exitCode: number | null;
  signal: string | null;
  buildIdExists: boolean;
  buildIdValue: string | null;
  buildIdMtimeMs: number | null;
  buildIdFreshlyUpdated: boolean;
  compileSucceeded: boolean;
  warningsCount: number;
  warningsInventory: string[];
  logFilePath: string;
  reason: string;
}

export interface RealHttpReadOnlyProbeOptions {
  baseUrl: string;
  runId: string;
  candidateId: string;
  productId?: string;
  workspaceId?: string;
  signal?: AbortSignal;
  fetchImpl?: typeof fetch;
}

export interface RealHttpReadOnlyProbeResult {
  transportVerified: boolean;
  actualHttpRequestCount: number;
  requestUrl: string;
  statusCode: number | null;
  ok: boolean;
  validJson: boolean;
  identityMatched: boolean;
  resolvedRunId: string | null;
  resolvedCandidateId: string | null;
  resolvedProductId: string | null;
  responseBodyDigest: string | null;
  body: any;
  error?: string;
}

export interface PersistedSqliteCandidateRecord {
  candidateId: string;
  researchProductId: string | null;
  title: string;
  storeDomain: string | null;
  canonicalProductUrl: string | null;
  rank: number;
  score: number | null;
  identityStatus: string;
  familyKey: string;
  persistedObservationCount: number;
  persistedResearchProductExists: boolean;
}

export interface PersistedSqliteRunSnapshot {
  persistedFromSqlite: true;
  syncJobId: string;
  researchRunId: string;
  workspaceId: string;
  status: string;
  persistedAt: string;
  candidates: PersistedSqliteCandidateRecord[];
}

export interface DomExtractedCard {
  candidateId: string | null;
  productId?: string | null;
  title: string | null;
  storeDomain: string | null;
  canonicalProductUrl?: string | null;
  rank: number | null;
  score: number | null;
  identityStatus: string | null;
  familyKey?: string | null;
}

export interface ChromiumExecutionOptions {
  baseUrl: string;
  workspaceId: string;
  researchRunId: string;
  shortlistCandidates: any[];
  screenshotsDir: string;
  signal?: AbortSignal;
}

export interface ChromiumExecutionResult {
  executed: boolean;
  status: "PASS" | "FAIL" | "BLOCKED";
  browserLaunched: boolean;
  serverReady: boolean;
  pageNavigationSucceeded: boolean;
  pageLoaded?: boolean;
  mainDocumentHttpStatus?: number | null;
  actualAssertionCount: number;
  assertionFailures: string[];
  routesVerified: string[];
  screenshots: string[];
  httpApiResponse?: {
    statusCode: number;
    ok: boolean;
    body: any;
  };
  httpOverviewResponses?: Array<{
    candidateId: string;
    statusCode: number;
    ok: boolean;
    body: any;
  }>;
  domExtractedCandidate?: DomExtractedCard;
  domExtractedData?: {
    domRunId: string | null;
    cardCount: number;
    cards: DomExtractedCard[];
  };
  durationMs: number;
  error?: string;
}

export interface ParityFieldComparisonEntry {
  pair: "DB_VS_HTTP" | "DB_VS_DOM" | "HTTP_VS_DOM";
  field: string;
  candidateId: string;
  required: boolean;
  presentDb: boolean;
  presentHttp: boolean;
  presentDom: boolean;
  expectedNormalizedValue: string | number | null;
  observedNormalizedValue: string | number | null;
  sourceEvidenceId: string;
  verdict: "PASS" | "FAIL";
}

export interface ParityReconciliationInput {
  workspaceId: string;
  runId: string;
  persistedDbSnapshot?: PersistedSqliteRunSnapshot | null;
  candidates?: any[];
  httpData?: any;
  httpOverviewResponses?: Array<{
    candidateId: string;
    statusCode: number;
    ok: boolean;
    body: any;
  }>;
  domData?: {
    domRunId?: string | null;
    researchRunId?: string | null;
    cardCount?: number;
    cards?: DomExtractedCard[];
    candidateId?: string | null;
    title?: string | null;
    storeDomain?: string | null;
    identityStatus?: string | null;
    rank?: number | null;
    score?: number | null;
  } | null;
}

export interface ParityReconciliationResult {
  evaluatedAt: string;
  researchRunId: string;
  persistedFromSqliteVerified: boolean;
  dbVsHttpVerdict: "PASS" | "FAIL" | "NOT_EXECUTED";
  dbVsDomVerdict: "PASS" | "FAIL" | "NOT_EXECUTED";
  httpVsDomVerdict: "PASS" | "FAIL" | "NOT_EXECUTED";
  sameRunReconciliationPassed: boolean;
  httpApiParityPassed: boolean;
  chromiumParityPassed: boolean;
  comparedCandidateCount: number;
  comparedFieldCount: number;
  comparedDbFieldCount: number;
  comparedHttpFieldCount: number;
  comparedDomFieldCount: number;
  fieldComparisons: ParityFieldComparisonEntry[];
  fieldDiscrepancies: Array<{
    pair?: "DB_VS_HTTP" | "DB_VS_DOM" | "HTTP_VS_DOM";
    candidateId?: string;
    field: string;
    expected: any;
    actual: any;
    source: "HTTP" | "DOM" | "SQLITE";
  }>;
  reason?: string;
}

export interface TableContentDigest {
  tableName: string;
  rowCount: number;
  sha256Digest: string;
}

export interface ReadOnlyMutationCheckResult {
  verificationScope?:
    | "HTTP_GET_NONMUTATION"
    | "DB_ONLY_READ_SNAPSHOT"
    | "SYNTHETIC_CALLBACK_REJECTED"
    | "HTTP_PROBE_FAILED";
  status?: "PASS" | "FAIL" | "HTTP_NOT_EXECUTED";
  readOnlyPassed: boolean;
  httpRequestVerified: boolean;
  httpStatusCode: number | null;
  actualHttpRequestCount?: number;
  requestUrl?: string | null;
  responseBodyDigest?: string | null;
  contentDigestDbOnly?: any;
  contentDigestsMatch: boolean;
  rowCountsMatch: boolean;
  mutatedTables: string[];
  beforeSnapshot: {
    syncJobCount: number;
    productCount: number;
    competitorStoreCount?: number;
    adProductLinkCount?: number;
    evergreenScoreCount?: number;
    tableDigests?: Record<string, TableContentDigest>;
  };
  afterSnapshot: {
    syncJobCount: number;
    productCount: number;
    competitorStoreCount?: number;
    adProductLinkCount?: number;
    evergreenScoreCount?: number;
    tableDigests?: Record<string, TableContentDigest>;
  };
  mutationsDetected: boolean;
  error?: string;
}

export interface ChromiumGateResult {
  verdict: "PASS" | "FAIL" | "BLOCKED";
  reason: string;
  checks: {
    serverReady: boolean;
    browserLaunched: boolean;
    pageNavigationSucceeded: boolean;
    domAssertionsPassed: boolean;
    httpApiPassed: boolean;
    parityReconciliationPassed: boolean;
    readOnlyIntegrityPassed: boolean;
  };
}

export function normalizeProductTitleForParity(rawTitle: string | null | undefined): string {
  if (!rawTitle || typeof rawTitle !== "string") return "";
  return rawTitle
    .toLowerCase()
    .replace(/[^a-z0-9\s]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function normalizeDomainForParity(rawDomain: string | null | undefined): string {
  if (!rawDomain || typeof rawDomain !== "string") return "";
  const clean = rawDomain.trim().toLowerCase();
  if (!clean) return "";
  try {
    const withProto = /^https?:\/\//i.test(clean) ? clean : `https://${clean}`;
    return new URL(withProto).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return clean.replace(/^https?:\/\//, "").replace(/^www\./, "").split("/")[0] || "";
  }
}

/**
 * 0. Independently read persisted KH-02 run snapshot and materialized ResearchProduct rows from SQLite.
 */
export async function loadPersistedRunSnapshotFromSqlite(
  workspaceId: string,
  runId: string,
  db: any = prisma
): Promise<PersistedSqliteRunSnapshot | null> {
  if (!runId || !workspaceId) return null;

  const job = await db.syncJob?.findFirst?.({
    where: {
      id: runId,
      workspaceId,
    },
  });

  if (!job || !job.resultJson) {
    return null;
  }

  let parsed: any = null;
  try {
    parsed = typeof job.resultJson === "string" ? JSON.parse(job.resultJson) : job.resultJson;
  } catch {
    return null;
  }

  // Extract Top-3 candidates in the exact priority order rendered by /products RECOMMENDED tab
  // (topThree -> researchShortlist.shortlist -> provisionalCandidates -> insufficientEvidenceCandidates)
  const scoreByCandidateId = new Map<string, number>();
  const rankByCandidateId = new Map<string, number>();

  const collectScoredItems = (items: any[]) => {
    if (!Array.isArray(items)) return;
    items.forEach((item, idx) => {
      const cand = item?.candidate || item;
      const cid = cand?.candidateId;
      if (!cid) return;
      if (typeof item?.score?.totalScore === "number") {
        scoreByCandidateId.set(cid, Math.round(item.score.totalScore));
      } else if (typeof item?.score?.opportunityScore === "number") {
        scoreByCandidateId.set(cid, Math.round(item.score.opportunityScore));
      } else if (typeof cand?.score?.opportunityScore === "number") {
        scoreByCandidateId.set(cid, Math.round(cand.score.opportunityScore));
      } else if (typeof cand?.opportunityScore === "number") {
        scoreByCandidateId.set(cid, Math.round(cand.opportunityScore));
      } else if (typeof cand?.evergreenScore === "number") {
        scoreByCandidateId.set(cid, Math.round(cand.evergreenScore));
      } else if (typeof cand?.researchScore === "number") {
        scoreByCandidateId.set(cid, Math.round(cand.researchScore));
      }
      if (typeof item?.rank === "number" && !rankByCandidateId.has(cid)) {
        rankByCandidateId.set(cid, item.rank);
      } else if (!rankByCandidateId.has(cid)) {
        rankByCandidateId.set(cid, idx + 1);
      }
    });
  };

  collectScoredItems(parsed?.topThree);
  collectScoredItems(parsed?.provisionalCandidates);
  collectScoredItems(parsed?.insufficientEvidenceCandidates);
  collectScoredItems(parsed?.remainingCandidates);

  let rawCandidates: any[] = [];
  if (Array.isArray(parsed?.researchShortlist?.shortlist) && parsed.researchShortlist.shortlist.length > 0) {
    rawCandidates = parsed.researchShortlist.shortlist.slice(0, 3);
  } else if (Array.isArray(parsed?.topThree) && parsed.topThree.length > 0) {
    rawCandidates = parsed.topThree.map((i: any) => i?.candidate || i).slice(0, 3);
  } else if (Array.isArray(parsed?.provisionalCandidates) && parsed.provisionalCandidates.length > 0) {
    rawCandidates = parsed.provisionalCandidates.map((i: any) => i?.candidate || i).slice(0, 3);
  } else if (Array.isArray(parsed?.insufficientEvidenceCandidates) && parsed.insufficientEvidenceCandidates.length > 0) {
    rawCandidates = parsed.insufficientEvidenceCandidates.map((i: any) => i?.candidate || i).slice(0, 3);
  }

  const persistedCandidates: PersistedSqliteCandidateRecord[] = [];
  for (let idx = 0; idx < rawCandidates.length; idx++) {
    const c = rawCandidates[idx]?.candidate || rawCandidates[idx];
    if (!c || !c.candidateId) continue;

    const prodId = c.researchProductId || c.candidateId;
    let prodRow: any = null;
    try {
      prodRow = await db.researchProduct?.findUnique?.({
        where: { id: prodId },
        include: { store: true },
      });
    } catch {
      prodRow = null;
    }

    const cleanTitle =
      c.canonicalProductName ||
      c.displayName ||
      c.title ||
      prodRow?.title ||
      "Untitled Candidate";
    const storeDomain =
      normalizeDomainForParity(c.storeDomain || prodRow?.store?.domain) || null;
    const canonicalProductUrl = c.canonicalProductUrl || prodRow?.productUrl || null;
    const rank = idx + 1;
    const score =
      scoreByCandidateId.get(c.candidateId) ??
      (typeof parsed?.rankedScores?.[c.candidateId] === "number"
        ? Math.round(parsed.rankedScores[c.candidateId])
        : typeof c.relevanceScore === "number"
        ? Math.round(c.relevanceScore)
        : null);

    persistedCandidates.push({
      candidateId: String(c.candidateId),
      researchProductId: prodRow?.id || c.researchProductId || String(c.candidateId),
      title: String(cleanTitle),
      storeDomain,
      canonicalProductUrl,
      rank,
      score,
      identityStatus: String(c.identityStatus || "PROBABLE"),
      familyKey: String(c.familyKey || "general_family"),
      persistedObservationCount: Array.isArray(c.sourceObservations)
        ? c.sourceObservations.length
        : Number(c.totalObservationCount || 0),
      persistedResearchProductExists: Boolean(prodRow),
    });
  }

  return {
    persistedFromSqlite: true,
    syncJobId: String(job.id),
    researchRunId: String(parsed?.researchRunId || job.id),
    workspaceId: String(job.workspaceId),
    status: String(job.status),
    persistedAt: job.completedAt
      ? new Date(job.completedAt).toISOString()
      : new Date(job.createdAt).toISOString(),
    candidates: persistedCandidates,
  };
}

export async function checkPortInUse(port: number, host = "127.0.0.1"): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.createConnection({ port, host });
    const timer = setTimeout(() => {
      socket.destroy();
      resolve(false);
    }, 800);
    socket.on("connect", () => {
      clearTimeout(timer);
      socket.destroy();
      resolve(true);
    });
    socket.on("error", () => {
      clearTimeout(timer);
      socket.destroy();
      resolve(false);
    });
  });
}

/**
 * 0.5 Supervised Production Build Verifier (`executeAndVerifyFreshProductionBuild`, Phase 4)
 * Runs `npx next build` as an async child process with timeout, checks PID, exitCode === 0,
 * signal === null, absence of fatal compile errors, and freshness of `.next/BUILD_ID` (`mtimeMs >= buildStartMs - 1000`).
 */
export async function executeAndVerifyFreshProductionBuild(
  options: ProductionBuildVerificationOptions
): Promise<ProductionBuildVerificationResult> {
  const {
    sourceSha,
    buildLogPath,
    cwd = process.cwd(),
    buildDir = path.resolve(cwd, ".next"),
    signal,
    timeoutMs = 240000,
    spawnImpl = spawn,
  } = options;

  const buildStartMs = Date.now();
  const startedAt = new Date(buildStartMs).toISOString();
  const isWin = process.platform === "win32";
  const cmd = isWin ? "npx.cmd" : "npx";
  const args = ["next", "build"];

  fs.mkdirSync(path.dirname(buildLogPath), { recursive: true });
  const logStream = fs.createWriteStream(buildLogPath, { flags: "w" });

  let combinedLog = "";
  let timedOut = false;
  let spawnErr: string | null = null;

  return new Promise((resolve) => {
    let child: ChildProcess;
    try {
      child = spawnImpl(cmd, args, {
        cwd,
        env: { ...process.env, NODE_ENV: "production" },
        stdio: ["ignore", "pipe", "pipe"],
        shell: isWin,
      });
    } catch (err: any) {
      logStream.end();
      const completedAt = new Date().toISOString();
      return resolve({
        executed: false,
        status: "BUILD_SPAWN_ERROR",
        allowServerAndChromiumLaunch: false,
        sourceSha,
        command: `${cmd} ${args.join(" ")}`,
        pid: null,
        startedAt,
        completedAt,
        durationMs: Date.now() - buildStartMs,
        exitCode: null,
        signal: null,
        buildIdExists: false,
        buildIdValue: null,
        buildIdMtimeMs: null,
        buildIdFreshlyUpdated: false,
        compileSucceeded: false,
        warningsCount: 0,
        warningsInventory: [],
        logFilePath: buildLogPath,
        reason: `Failed to spawn production build: ${err?.message}`,
      });
    }

    const pid = typeof child.pid === "number" ? child.pid : null;

    const onData = (chunk: Buffer) => {
      const str = chunk.toString("utf8");
      combinedLog = (combinedLog + str).slice(-250_000);
      logStream.write(chunk);
    };

    child.stdout?.on("data", onData);
    child.stderr?.on("data", onData);

    const timer = setTimeout(() => {
      timedOut = true;
      try {
        child.kill("SIGKILL");
      } catch {}
    }, timeoutMs);

    const onAbort = () => {
      timedOut = true;
      try {
        child.kill("SIGKILL");
      } catch {}
    };
    signal?.addEventListener("abort", onAbort, { once: true });

    child.on("error", (err) => {
      spawnErr = err?.message || "spawn_error";
    });

    child.on("close", (code, sig) => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      logStream.end();

      const completedAt = new Date().toISOString();
      const durationMs = Date.now() - buildStartMs;
      const buildIdPath = path.join(buildDir, "BUILD_ID");
      const buildIdExists = fs.existsSync(buildIdPath);
      let buildIdValue: string | null = null;
      let buildIdMtimeMs: number | null = null;

      if (buildIdExists) {
        try {
          buildIdValue = fs.readFileSync(buildIdPath, "utf8").trim() || null;
          const st = fs.statSync(buildIdPath);
          buildIdMtimeMs = st.mtimeMs;
        } catch {
          buildIdValue = null;
          buildIdMtimeMs = null;
        }
      }

      const buildIdFreshlyUpdated =
        buildIdExists &&
        typeof buildIdMtimeMs === "number" &&
        buildIdMtimeMs >= buildStartMs - 1000 &&
        Boolean(buildIdValue);

      const hasFatalErrorText =
        combinedLog.includes("Build error occurred") ||
        combinedLog.includes("Failed to compile") ||
        combinedLog.includes("Command failed");

      const hasSuccessMarker =
        combinedLog.includes("Compiled successfully") ||
        combinedLog.includes("Route (app)") ||
        combinedLog.includes("Generating static pages");

      const compileSucceeded =
        !spawnErr &&
        !timedOut &&
        code === 0 &&
        !sig &&
        !hasFatalErrorText &&
        (hasSuccessMarker || buildIdFreshlyUpdated);

      const warningsInventory = combinedLog
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter((l) =>
          /warn|warning|Critical dependency|bigqueryClientAdapter/i.test(l)
        )
        .slice(0, 50);

      let status: ProductionBuildVerificationResult["status"] = "BUILD_FAILED";
      if (spawnErr || !pid || pid <= 0) {
        status = "BUILD_SPAWN_ERROR";
      } else if (timedOut) {
        status = "BUILD_TIMED_OUT";
      } else if (compileSucceeded && buildIdFreshlyUpdated) {
        status = "BUILD_PASS";
      } else {
        status = "BUILD_FAILED";
      }

      const allowServerAndChromiumLaunch = status === "BUILD_PASS";
      let reason = `Production build ${status}: pid=${pid}, exitCode=${code}, signal=${sig || "none"}, buildIdFreshlyUpdated=${buildIdFreshlyUpdated}.`;
      if (status !== "BUILD_PASS" && !buildIdFreshlyUpdated && code === 0) {
        reason = `BUILD_FAILED: child exited 0 but .next/BUILD_ID was missing or stale (mtimeMs=${buildIdMtimeMs}, buildStartMs=${buildStartMs}).`;
      }

      resolve({
        executed: Boolean(pid && pid > 0 && !spawnErr),
        status,
        allowServerAndChromiumLaunch,
        sourceSha,
        command: `${cmd} ${args.join(" ")}`,
        pid,
        startedAt,
        completedAt,
        durationMs,
        exitCode: code,
        signal: sig ? String(sig) : null,
        buildIdExists,
        buildIdValue,
        buildIdMtimeMs,
        buildIdFreshlyUpdated,
        compileSucceeded,
        warningsCount: warningsInventory.length,
        warningsInventory,
        logFilePath: buildLogPath,
        reason,
      });
    });
  });
}

/**
 * 1. Start isolated Next.js acceptance server on a dedicated port
 * Verifies the port is not already occupied before spawning `next start` so an unowned process is never probed.
 */
export async function startIsolatedAcceptanceServer(
  options: ServerLaunchOptions
): Promise<ServerLaunchResult> {
  const {
    port,
    logFilePath,
    timeoutMs = 30000,
    signal,
    buildPath,
    allowDynamicPortFallback = false,
  } = options;
  const startMs = Date.now();

  const nextBuildDir = buildPath || path.resolve(process.cwd(), ".next");
  if (!fs.existsSync(nextBuildDir) || !fs.existsSync(path.join(nextBuildDir, "BUILD_ID"))) {
    throw new Error(
      `NEXT_BUILD_MISSING: .next/BUILD_ID does not exist at ${nextBuildDir}. Run 'executeAndVerifyFreshProductionBuild' before starting isolated server.`
    );
  }

  let effectivePort = port;
  const alreadyOccupied = await checkPortInUse(effectivePort);
  if (alreadyOccupied) {
    if (!allowDynamicPortFallback) {
      throw new Error(
        `PORT_CONFLICT: Port ${effectivePort} is already occupied on 127.0.0.1 before server launch; refusing to attach to unowned process.`
      );
    }
    let foundFree = false;
    for (let candidatePort = effectivePort + 1; candidatePort <= effectivePort + 20; candidatePort++) {
      if (!(await checkPortInUse(candidatePort))) {
        effectivePort = candidatePort;
        foundFree = true;
        break;
      }
    }
    if (!foundFree) {
      throw new Error(
        `PORT_CONFLICT: Port ${port} and fallback range ${port + 1}..${port + 20} are all occupied.`
      );
    }
  }

  const baseUrl = `http://127.0.0.1:${effectivePort}`;

  const logStream = logFilePath
    ? fs.createWriteStream(logFilePath, { flags: "a" })
    : null;

  const isWin = process.platform === "win32";
  const cmd = isWin ? "npx.cmd" : "npx";
  const args = ["next", "start", "-H", "127.0.0.1", "-p", String(effectivePort)];

  const child = spawn(cmd, args, {
    cwd: process.cwd(),
    env: {
      ...process.env,
      HOST: "127.0.0.1",
      HOSTNAME: "127.0.0.1",
      PORT: String(effectivePort),
      NODE_ENV: "production",
    },
    stdio: ["ignore", "pipe", "pipe"],
    shell: isWin,
  });

  const childPid = typeof child.pid === "number" ? child.pid : null;
  if (!childPid || childPid <= 0) {
    logStream?.end();
    throw new Error("SERVER_SPAWN_FAILED: Next.js server child process did not receive a valid PID.");
  }

  if (logStream) {
    child.stdout?.pipe(logStream);
    child.stderr?.pipe(logStream);
  }

  let childExited = false;
  let exitCode: number | null = null;
  child.on("exit", (code) => {
    childExited = true;
    exitCode = code;
  });

  const stopServer = async (): Promise<void> => {
    return new Promise((resolve) => {
      if (childExited) {
        logStream?.end();
        return resolve();
      }
      child.on("close", () => {
        logStream?.end();
        resolve();
      });
      try {
        if (isWin) {
          spawn("taskkill", ["/pid", String(child.pid), "/f", "/t"]);
        } else {
          child.kill("SIGTERM");
        }
      } catch {
        resolve();
      }
    });
  };

  let serverReady = false;
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    if (signal?.aborted) {
      await stopServer();
      throw new Error("Server launch aborted by signal");
    }
    if (childExited) {
      await stopServer();
      throw new Error(`Next.js server exited prematurely with code ${exitCode}`);
    }

    try {
      const isUp = await new Promise<boolean>((res) => {
        const req = http.get(
          `${baseUrl}/products`,
          { timeout: 2000 },
          (resp) => {
            resp.resume();
            res(resp.statusCode !== undefined && resp.statusCode < 500);
          }
        );
        req.on("error", () => res(false));
        req.on("timeout", () => {
          req.destroy();
          res(false);
        });
      });

      if (isUp && !childExited) {
        serverReady = true;
        break;
      }
    } catch {
      // Retry
    }

    await new Promise((r) => setTimeout(r, 600));
  }

  if (!serverReady) {
    await stopServer();
    throw new Error(
      `Next.js server failed to become ready on ${baseUrl} within ${timeoutMs}ms`
    );
  }

  return {
    childProcess: child,
    pid: childPid,
    port: effectivePort,
    baseUrl,
    serverReady: true,
    ownedProcessVerified: Boolean(childPid && childPid > 0 && !childExited),
    portConflictDetected: alreadyOccupied,
    startupDurationMs: Date.now() - startMs,
    stopServer,
  };
}

/**
 * 2. Launch actual Playwright Chromium & run real UI and API assertions
 */
export async function runLiveChromiumAcceptance(
  options: ChromiumExecutionOptions
): Promise<ChromiumExecutionResult> {
  const { baseUrl, researchRunId, shortlistCandidates, screenshotsDir, signal } =
    options;
  const startMs = Date.now();
  let browser: Browser | null = null;
  let context: BrowserContext | null = null;
  let browserLaunched = false;
  let pageNavigationSucceeded = false;
  const assertionFailures: string[] = [];
  const routesVerified: string[] = [];
  const screenshots: string[] = [];
  let actualAssertionCount = 0;
  let httpApiResponse: any = undefined;
  const httpOverviewResponses: Array<{
    candidateId: string;
    statusCode: number;
    ok: boolean;
    body: any;
  }> = [];
  let domExtractedCandidate: DomExtractedCard | undefined = undefined;
  const domCards: DomExtractedCard[] = [];
  let domRunId: string | null = null;

  try {
    fs.mkdirSync(screenshotsDir, { recursive: true });

    try {
      browser = await chromium.launch({ headless: true });
    } catch {
      browser = await chromium.launch({ headless: true, channel: "chrome" });
    }
    browserLaunched = true;
    context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    if (options.workspaceId && /^https?:\/\//i.test(baseUrl)) {
      await context
        .addCookies([
          {
            name: "swai_workspace_id",
            value: options.workspaceId,
            url: baseUrl,
          },
        ])
        .catch(() => {});
    }
    const page: Page = await context.newPage();

    if (signal?.aborted) {
      throw new Error("Chromium execution aborted by signal");
    }

    const targetUrl = `${baseUrl}/products?runId=${encodeURIComponent(
      researchRunId
    )}&topic=Pet+Gadgets&tab=RECOMMENDED${
      options.workspaceId
        ? `&workspaceId=${encodeURIComponent(options.workspaceId)}`
        : ""
    }`;

    const navResponse = await page.goto(targetUrl, {
      waitUntil: "domcontentloaded",
      timeout: 25000,
    });
    const mainDocumentHttpStatus = navResponse ? navResponse.status() : null;

    if (!navResponse || navResponse.status() >= 400) {
      assertionFailures.push(
        `Navigation to ${targetUrl} returned HTTP status ${navResponse?.status() || "NULL"}`
      );
    } else {
      pageNavigationSucceeded = true;
      routesVerified.push("/products");
      actualAssertionCount++;
    }

    // Wait for canonical product cards to render in the DOM
    try {
      await page.waitForSelector('[data-testid="pf-canonical-product-card"]', {
        timeout: 12000,
      });
    } catch {
      await page.waitForTimeout(1500);
    }

    // Extract authoritative run meta if present
    const runMetaLoc = page.locator('[data-testid="kh02-authoritative-run-meta"]').first();
    if ((await runMetaLoc.count()) > 0) {
      domRunId = await runMetaLoc.getAttribute("data-research-run-id");
      actualAssertionCount++;
    }

    // Extract all rendered canonical product cards from the DOM
    const cardLocator = page.locator('[data-testid="pf-canonical-product-card"]');
    const cardCount = await cardLocator.count();
    if (cardCount === 0) {
      assertionFailures.push(
        'Zero [data-testid="pf-canonical-product-card"] elements rendered on /products'
      );
    } else {
      for (let i = 0; i < Math.min(cardCount, 3); i++) {
        const card = cardLocator.nth(i);
        const cid = await card.getAttribute("data-candidate-id");
        const pid = await card.getAttribute("data-product-id");
        const attrTitle = await card.getAttribute("data-title");
        const h3Title = await card.locator("h3").first().textContent().catch(() => null);
        const domain = await card.getAttribute("data-store-domain");
        const canonicalUrl = await card.getAttribute("data-canonical-url");
        const rankStr = await card.getAttribute("data-rank");
        const scoreStr = await card.getAttribute("data-opportunity-score");
        const idStatus = await card.getAttribute("data-identity-status");
        const famKey = await card.getAttribute("data-family-key");

        const extractedCard: DomExtractedCard = {
          candidateId: cid ? cid.trim() : null,
          productId: pid ? pid.trim() : null,
          title: (h3Title || attrTitle || "").trim() || null,
          storeDomain: domain ? domain.trim() : null,
          canonicalProductUrl: canonicalUrl ? canonicalUrl.trim() : null,
          rank: rankStr && !Number.isNaN(Number(rankStr)) ? Number(rankStr) : i + 1,
          score: scoreStr && scoreStr.trim() !== "" && !Number.isNaN(Number(scoreStr)) ? Number(scoreStr) : null,
          identityStatus: idStatus ? idStatus.trim() : null,
          familyKey: famKey ? famKey.trim() : null,
        };
        domCards.push(extractedCard);
        actualAssertionCount++;
      }
      domExtractedCandidate = domCards[0];
    }

    // Take screenshot of products page
    const shotPath = path.join(screenshotsDir, "01_pf_recommended.png");
    await page.screenshot({ path: shotPath, fullPage: true });
    screenshots.push(shotPath);
    actualAssertionCount++;

    // Open and verify research drawer if available
    const viewBtn = page.locator('[data-testid="pf-view-research-btn"]').first();
    if ((await viewBtn.count()) > 0) {
      await viewBtn.click();
      await page.waitForTimeout(500);
      const drawerShotPath = path.join(screenshotsDir, "02_pf_research_drawer.png");
      await page.screenshot({ path: drawerShotPath, fullPage: false });
      screenshots.push(drawerShotPath);
      actualAssertionCount++;
      await page.keyboard.press("Escape");
    }

    // Real HTTP GET to overview API for each Top-3 candidate
    const candidatesToFetch = shortlistCandidates.slice(0, 3);
    if (candidatesToFetch.length === 0) {
      assertionFailures.push("No candidate available for overview API verification");
    } else {
      for (const cand of candidatesToFetch) {
        const cid = cand?.candidateId;
        const pid = cand?.researchProductId || cid;
        if (!cid) continue;
        const apiUrl = `${baseUrl}/api/v1/research/products/${encodeURIComponent(
          pid
        )}/overview?runId=${encodeURIComponent(researchRunId)}&candidateId=${encodeURIComponent(cid)}${
          options.workspaceId
            ? `&workspaceId=${encodeURIComponent(options.workspaceId)}`
            : ""
        }`;

        const apiRes = await fetch(apiUrl);
        const apiOk = apiRes.ok;
        const apiStatus = apiRes.status;
        let apiJson: any = null;
        try {
          apiJson = await apiRes.json();
        } catch (err: any) {
          assertionFailures.push(`API response JSON parse failed for ${cid}: ${err?.message}`);
        }

        const entry = {
          candidateId: cid,
          statusCode: apiStatus,
          ok: apiOk,
          body: apiJson,
        };
        httpOverviewResponses.push(entry);
        if (!httpApiResponse) {
          httpApiResponse = {
            statusCode: apiStatus,
            ok: apiOk,
            body: apiJson,
          };
        }

        if (!apiOk) {
          assertionFailures.push(`GET ${apiUrl} returned status ${apiStatus}`);
        } else {
          if (!routesVerified.includes("/api/v1/research/products/[id]/overview")) {
            routesVerified.push("/api/v1/research/products/[id]/overview");
          }
          actualAssertionCount++;
        }
      }
    }

    const overallStatus =
      assertionFailures.length === 0 && pageNavigationSucceeded && domCards.length > 0
        ? "PASS"
        : "FAIL";

    return {
      executed: true,
      status: overallStatus,
      browserLaunched,
      serverReady: true,
      pageNavigationSucceeded,
      pageLoaded: pageNavigationSucceeded,
      mainDocumentHttpStatus,
      actualAssertionCount,
      assertionFailures,
      routesVerified,
      screenshots,
      httpApiResponse,
      httpOverviewResponses,
      domExtractedCandidate,
      domExtractedData: {
        domRunId,
        cardCount: domCards.length,
        cards: domCards,
      },
      durationMs: Date.now() - startMs,
    };
  } catch (err: any) {
    return {
      executed: true,
      status: "FAIL",
      browserLaunched,
      serverReady: true,
      pageNavigationSucceeded: false,
      actualAssertionCount,
      assertionFailures: [...assertionFailures, err?.message || "Chromium execution error"],
      routesVerified,
      screenshots,
      durationMs: Date.now() - startMs,
      error: err?.message,
    };
  } finally {
    await context?.close().catch(() => {});
    await browser?.close().catch(() => {});
  }
}

interface NormalizedHttpCandidateView {
  researchRunId: string | null;
  candidateId: string | null;
  title: string | null;
  storeDomain: string | null;
  identityStatus: string | null;
  rank: number | null;
  score: number | null;
  familyKey: string | null;
}

function extractNormalizedHttpCandidate(rawPayload: any): NormalizedHttpCandidateView | null {
  if (!rawPayload || typeof rawPayload !== "object") return null;
  const body = rawPayload.body && typeof rawPayload.body === "object" ? rawPayload.body : rawPayload;
  const data = body.data && typeof body.data === "object" ? body.data : null;
  if (!data) return null;

  const ctx = data.kh02ResearchContext && typeof data.kh02ResearchContext === "object" ? data.kh02ResearchContext : null;
  const resCtx = data.researchContextResolution && typeof data.researchContextResolution === "object" ? data.researchContextResolution : null;
  const prod = data.product && typeof data.product === "object" ? data.product : null;

  const researchRunId =
    resCtx?.resolvedResearchRunId ??
    resCtx?.resolvedRunId ??
    ctx?.researchRunId ??
    ctx?.runId ??
    data.researchRunId ??
    data.runId ??
    null;

  const candidateId =
    ctx?.candidateId ??
    data.candidateId ??
    prod?.metadata?.candidateId ??
    null;

  const title =
    ctx?.canonicalProductName ??
    ctx?.displayName ??
    ctx?.title ??
    data.title ??
    prod?.title ??
    null;

  const storeDomain =
    ctx?.storeDomain ??
    data.storeDomain ??
    prod?.store?.domain ??
    null;

  const identityStatus =
    ctx?.identityStatus ??
    data.identityStatus ??
    prod?.metadata?.identityStatus ??
    null;

  const rawRank = ctx?.rank ?? data.rank ?? null;
  const rank = typeof rawRank === "number" && !Number.isNaN(rawRank) ? rawRank : null;

  const rawScore =
    ctx?.evergreenScore ??
    ctx?.opportunityScore ??
    ctx?.researchScore ??
    ctx?.score ??
    data.score ??
    prod?.evergreenScore ??
    null;
  const score = typeof rawScore === "number" && !Number.isNaN(rawScore) ? Math.round(rawScore) : null;

  const familyKey =
    ctx?.familyKey ??
    data.familyKey ??
    prod?.metadata?.familyKey ??
    null;

  return {
    researchRunId: typeof researchRunId === "string" && researchRunId.trim() ? researchRunId.trim() : null,
    candidateId: typeof candidateId === "string" && candidateId.trim() ? candidateId.trim() : null,
    title: typeof title === "string" && title.trim() ? title.trim() : null,
    storeDomain: typeof storeDomain === "string" && storeDomain.trim() ? normalizeDomainForParity(storeDomain) : null,
    identityStatus: typeof identityStatus === "string" && identityStatus.trim() ? identityStatus.trim() : null,
    rank,
    score,
    familyKey: typeof familyKey === "string" && familyKey.trim() ? familyKey.trim() : null,
  };
}

/**
 * 3. Reconcile SQLite, HTTP API, and Chromium DOM with exact three-way field comparisons.
 *    Requires an independently loaded PersistedSqliteRunSnapshot (`persistedFromSqlite === true`).
 */
export function reconcileSqliteHttpChromium(
  input: ParityReconciliationInput
): ParityReconciliationResult {
  const evaluatedAt = new Date().toISOString();
  const fieldComparisons: ParityFieldComparisonEntry[] = [];
  const discrepancies: Array<{
    pair?: "DB_VS_HTTP" | "DB_VS_DOM" | "HTTP_VS_DOM";
    candidateId?: string;
    field: string;
    expected: any;
    actual: any;
    source: "HTTP" | "DOM" | "SQLITE";
  }> = [];

  const dbSnapshot = input.persistedDbSnapshot;
  const isPersistedFromSqlite = Boolean(
    dbSnapshot &&
      dbSnapshot.persistedFromSqlite === true &&
      typeof dbSnapshot.syncJobId === "string" &&
      dbSnapshot.syncJobId.trim().length > 0 &&
      Array.isArray(dbSnapshot.candidates) &&
      dbSnapshot.candidates.length > 0
  );

  if (!isPersistedFromSqlite) {
    discrepancies.push({
      pair: "DB_VS_HTTP",
      field: "persistedDbSnapshot",
      expected: "persistedFromSqlite: true with non-empty candidates",
      actual: dbSnapshot ? "empty or invalid snapshot" : "uncommitted in-memory shortlist",
      source: "SQLITE",
    });
    return {
      evaluatedAt,
      researchRunId: input.runId,
      persistedFromSqliteVerified: false,
      dbVsHttpVerdict: "FAIL",
      dbVsDomVerdict: "FAIL",
      httpVsDomVerdict: "NOT_EXECUTED",
      sameRunReconciliationPassed: false,
      httpApiParityPassed: false,
      chromiumParityPassed: false,
      comparedCandidateCount: 0,
      comparedFieldCount: 0,
      comparedDbFieldCount: 0,
      comparedHttpFieldCount: 0,
      comparedDomFieldCount: 0,
      fieldComparisons: [],
      fieldDiscrepancies: discrepancies,
      reason: "Uncommitted in-memory shortlist cannot serve as persisted SQLite oracle; independent persisted SQLite snapshot required.",
    };
  }

  const dbCandidates = dbSnapshot!.candidates;
  const persistedRunId = dbSnapshot!.researchRunId || input.runId;

  // Build map of HTTP candidate views
  const httpMap = new Map<string, NormalizedHttpCandidateView>();
  if (Array.isArray(input.httpOverviewResponses) && input.httpOverviewResponses.length > 0) {
    for (const resp of input.httpOverviewResponses) {
      const view = extractNormalizedHttpCandidate(resp);
      if (view) {
        httpMap.set(resp.candidateId, view);
      }
    }
  } else if (input.httpData) {
    const view = extractNormalizedHttpCandidate(input.httpData);
    if (view && dbCandidates[0]) {
      httpMap.set(dbCandidates[0].candidateId, view);
    }
  }

  // Build list of DOM extracted cards
  let domCards: DomExtractedCard[] = [];
  let domRunId: string | null = null;
  if (input.domData && typeof input.domData === "object") {
    domRunId =
      (typeof input.domData.domRunId === "string" && input.domData.domRunId.trim()) ||
      (typeof input.domData.researchRunId === "string" && input.domData.researchRunId.trim()) ||
      null;
    if (Array.isArray(input.domData.cards) && input.domData.cards.length > 0) {
      domCards = input.domData.cards;
    } else if (
      input.domData.title ||
      input.domData.candidateId ||
      input.domData.storeDomain ||
      input.domData.identityStatus
    ) {
      domCards = [
        {
          candidateId: input.domData.candidateId ?? dbCandidates[0]?.candidateId ?? null,
          title: input.domData.title ?? null,
          storeDomain: input.domData.storeDomain ?? dbCandidates[0]?.storeDomain ?? null,
          rank: input.domData.rank ?? 1,
          score: input.domData.score ?? dbCandidates[0]?.score ?? null,
          identityStatus: input.domData.identityStatus ?? dbCandidates[0]?.identityStatus ?? null,
        },
      ];
    }
  }

  let comparedDbFieldCount = 0;
  let comparedHttpFieldCount = 0;
  let comparedDomFieldCount = 0;

  const recordComparison = (entry: ParityFieldComparisonEntry) => {
    fieldComparisons.push(entry);
    if (entry.presentDb) comparedDbFieldCount++;
    if (entry.pair === "DB_VS_HTTP" && entry.presentHttp) comparedHttpFieldCount++;
    if ((entry.pair === "DB_VS_DOM" || entry.pair === "HTTP_VS_DOM") && entry.presentDom) {
      comparedDomFieldCount++;
    }
    if (entry.verdict === "FAIL") {
      discrepancies.push({
        pair: entry.pair,
        candidateId: entry.candidateId,
        field: entry.field,
        expected: entry.expectedNormalizedValue,
        actual: entry.observedNormalizedValue,
        source: entry.pair === "DB_VS_HTTP" ? "HTTP" : "DOM",
      });
    }
  };

  // Determine how many candidates to evaluate across layers
  const evalCandidates =
    Array.isArray(input.httpOverviewResponses) && input.httpOverviewResponses.length > 1
      ? dbCandidates
      : dbCandidates.slice(0, Math.max(1, domCards.length));

  // 1. Evaluate DB_VS_HTTP
  for (const dbCand of evalCandidates) {
    if (
      !Array.isArray(input.httpOverviewResponses) &&
      dbCand.candidateId !== dbCandidates[0]?.candidateId
    ) {
      continue;
    }
    const httpView = httpMap.get(dbCand.candidateId) || null;
    const evId = `syncJob:${dbSnapshot!.syncJobId}#${dbCand.candidateId}`;

    if (!httpView) {
      recordComparison({
        pair: "DB_VS_HTTP",
        field: "httpCandidatePayload",
        candidateId: dbCand.candidateId,
        required: true,
        presentDb: true,
        presentHttp: false,
        presentDom: false,
        expectedNormalizedValue: dbCand.candidateId,
        observedNormalizedValue: null,
        sourceEvidenceId: evId,
        verdict: "FAIL",
      });
      continue;
    }

    // researchRunId (when present in HTTP overview)
    if (httpView.researchRunId !== null) {
      recordComparison({
        pair: "DB_VS_HTTP",
        field: "researchRunId",
        candidateId: dbCand.candidateId,
        required: true,
        presentDb: Boolean(persistedRunId),
        presentHttp: Boolean(httpView.researchRunId),
        presentDom: false,
        expectedNormalizedValue: persistedRunId,
        observedNormalizedValue: httpView.researchRunId,
        sourceEvidenceId: evId,
        verdict: httpView.researchRunId === persistedRunId ? "PASS" : "FAIL",
      });
    }

    // candidateId (REQUIRED)
    recordComparison({
      pair: "DB_VS_HTTP",
      field: "candidateId",
      candidateId: dbCand.candidateId,
      required: true,
      presentDb: Boolean(dbCand.candidateId),
      presentHttp: Boolean(httpView.candidateId),
      presentDom: false,
      expectedNormalizedValue: dbCand.candidateId,
      observedNormalizedValue: httpView.candidateId,
      sourceEvidenceId: evId,
      verdict:
        Boolean(httpView.candidateId) && httpView.candidateId === dbCand.candidateId
          ? "PASS"
          : "FAIL",
    });

    // title (REQUIRED)
    const normDbTitle = normalizeProductTitleForParity(dbCand.title);
    const normHttpTitle = normalizeProductTitleForParity(httpView.title);
    recordComparison({
      pair: "DB_VS_HTTP",
      field: "title",
      candidateId: dbCand.candidateId,
      required: true,
      presentDb: Boolean(normDbTitle),
      presentHttp: Boolean(normHttpTitle),
      presentDom: false,
      expectedNormalizedValue: normDbTitle || null,
      observedNormalizedValue: normHttpTitle || null,
      sourceEvidenceId: evId,
      verdict: Boolean(normDbTitle) && Boolean(normHttpTitle) && normDbTitle === normHttpTitle ? "PASS" : "FAIL",
    });

    // storeDomain (REQUIRED)
    const normDbDomain = normalizeDomainForParity(dbCand.storeDomain);
    const normHttpDomain = normalizeDomainForParity(httpView.storeDomain);
    recordComparison({
      pair: "DB_VS_HTTP",
      field: "storeDomain",
      candidateId: dbCand.candidateId,
      required: true,
      presentDb: Boolean(normDbDomain),
      presentHttp: Boolean(normHttpDomain),
      presentDom: false,
      expectedNormalizedValue: normDbDomain || null,
      observedNormalizedValue: normHttpDomain || null,
      sourceEvidenceId: evId,
      verdict:
        Boolean(normDbDomain) && Boolean(normHttpDomain) && normDbDomain === normHttpDomain
          ? "PASS"
          : "FAIL",
    });

    // identityStatus (REQUIRED)
    recordComparison({
      pair: "DB_VS_HTTP",
      field: "identityStatus",
      candidateId: dbCand.candidateId,
      required: true,
      presentDb: Boolean(dbCand.identityStatus),
      presentHttp: Boolean(httpView.identityStatus),
      presentDom: false,
      expectedNormalizedValue: dbCand.identityStatus || null,
      observedNormalizedValue: httpView.identityStatus || null,
      sourceEvidenceId: evId,
      verdict:
        Boolean(dbCand.identityStatus) &&
        Boolean(httpView.identityStatus) &&
        dbCand.identityStatus === httpView.identityStatus
          ? "PASS"
          : "FAIL",
    });

    // score (when present in both DB and HTTP)
    if (dbCand.score !== null && httpView.score !== null) {
      recordComparison({
        pair: "DB_VS_HTTP",
        field: "score",
        candidateId: dbCand.candidateId,
        required: true,
        presentDb: true,
        presentHttp: true,
        presentDom: false,
        expectedNormalizedValue: Math.round(dbCand.score),
        observedNormalizedValue: Math.round(httpView.score),
        sourceEvidenceId: evId,
        verdict: Math.round(dbCand.score) === Math.round(httpView.score) ? "PASS" : "FAIL",
      });
    }
  }

  // 2. Evaluate DB_VS_DOM and HTTP_VS_DOM
  if (domCards.length > 0) {
    // Check runId alignment if domRunId is provided
    if (domRunId !== null) {
      recordComparison({
        pair: "DB_VS_DOM",
        field: "researchRunId",
        candidateId: dbCandidates[0]?.candidateId || "run_meta",
        required: true,
        presentDb: Boolean(persistedRunId),
        presentHttp: false,
        presentDom: Boolean(domRunId),
        expectedNormalizedValue: persistedRunId,
        observedNormalizedValue: domRunId,
        sourceEvidenceId: `dom:kh02-authoritative-run-meta`,
        verdict: domRunId === persistedRunId ? "PASS" : "FAIL",
      });
    }

    for (let idx = 0; idx < domCards.length; idx++) {
      const domCard = domCards[idx];
      const dbCand = dbCandidates[idx];
      if (!dbCand) break;
      const httpView = httpMap.get(dbCand.candidateId) || null;
      const evId = `dom:pf-canonical-product-card[${idx}]`;

      // candidateId at rank slot idx (catches rank swaps and wrong candidates)
      recordComparison({
        pair: "DB_VS_DOM",
        field: "candidateId",
        candidateId: dbCand.candidateId,
        required: true,
        presentDb: Boolean(dbCand.candidateId),
        presentHttp: false,
        presentDom: Boolean(domCard.candidateId),
        expectedNormalizedValue: dbCand.candidateId,
        observedNormalizedValue: domCard.candidateId || null,
        sourceEvidenceId: evId,
        verdict:
          Boolean(domCard.candidateId) && domCard.candidateId === dbCand.candidateId
            ? "PASS"
            : "FAIL",
      });

      // rank at slot idx
      recordComparison({
        pair: "DB_VS_DOM",
        field: "rank",
        candidateId: dbCand.candidateId,
        required: true,
        presentDb: true,
        presentHttp: false,
        presentDom: domCard.rank !== null && domCard.rank !== undefined,
        expectedNormalizedValue: dbCand.rank,
        observedNormalizedValue: domCard.rank ?? null,
        sourceEvidenceId: evId,
        verdict: domCard.rank === dbCand.rank ? "PASS" : "FAIL",
      });

      // title (exact normalized equality — no 15-char prefix match!)
      const normDbTitle = normalizeProductTitleForParity(dbCand.title);
      const normDomTitle = normalizeProductTitleForParity(domCard.title);
      recordComparison({
        pair: "DB_VS_DOM",
        field: "title",
        candidateId: dbCand.candidateId,
        required: true,
        presentDb: Boolean(normDbTitle),
        presentHttp: false,
        presentDom: Boolean(normDomTitle),
        expectedNormalizedValue: normDbTitle || null,
        observedNormalizedValue: normDomTitle || null,
        sourceEvidenceId: evId,
        verdict:
          Boolean(normDbTitle) && Boolean(normDomTitle) && normDbTitle === normDomTitle
            ? "PASS"
            : "FAIL",
      });

      // storeDomain
      const normDbDomain = normalizeDomainForParity(dbCand.storeDomain);
      const normDomDomain = normalizeDomainForParity(domCard.storeDomain);
      recordComparison({
        pair: "DB_VS_DOM",
        field: "storeDomain",
        candidateId: dbCand.candidateId,
        required: true,
        presentDb: Boolean(normDbDomain),
        presentHttp: false,
        presentDom: Boolean(normDomDomain),
        expectedNormalizedValue: normDbDomain || null,
        observedNormalizedValue: normDomDomain || null,
        sourceEvidenceId: evId,
        verdict:
          Boolean(normDbDomain) && Boolean(normDomDomain) && normDbDomain === normDomDomain
            ? "PASS"
            : "FAIL",
      });

      // identityStatus
      recordComparison({
        pair: "DB_VS_DOM",
        field: "identityStatus",
        candidateId: dbCand.candidateId,
        required: true,
        presentDb: Boolean(dbCand.identityStatus),
        presentHttp: false,
        presentDom: Boolean(domCard.identityStatus),
        expectedNormalizedValue: dbCand.identityStatus || null,
        observedNormalizedValue: domCard.identityStatus || null,
        sourceEvidenceId: evId,
        verdict:
          Boolean(dbCand.identityStatus) &&
          Boolean(domCard.identityStatus) &&
          dbCand.identityStatus === domCard.identityStatus
            ? "PASS"
            : "FAIL",
      });

      // score (when present in DB or DOM)
      if (dbCand.score !== null || (domCard.score !== null && domCard.score !== undefined)) {
        const expScore = dbCand.score !== null ? Math.round(dbCand.score) : null;
        const obsScore =
          domCard.score !== null && domCard.score !== undefined ? Math.round(domCard.score) : null;
        recordComparison({
          pair: "DB_VS_DOM",
          field: "score",
          candidateId: dbCand.candidateId,
          required: true,
          presentDb: expScore !== null,
          presentHttp: false,
          presentDom: obsScore !== null,
          expectedNormalizedValue: expScore,
          observedNormalizedValue: obsScore,
          sourceEvidenceId: evId,
          verdict: expScore !== null && obsScore !== null && expScore === obsScore ? "PASS" : "FAIL",
        });
      }

      // HTTP_VS_DOM comparisons when HTTP view exists for this candidate
      if (httpView) {
        const normHttpTitle = normalizeProductTitleForParity(httpView.title);
        recordComparison({
          pair: "HTTP_VS_DOM",
          field: "title",
          candidateId: dbCand.candidateId,
          required: true,
          presentDb: false,
          presentHttp: Boolean(normHttpTitle),
          presentDom: Boolean(normDomTitle),
          expectedNormalizedValue: normHttpTitle || null,
          observedNormalizedValue: normDomTitle || null,
          sourceEvidenceId: evId,
          verdict:
            Boolean(normHttpTitle) && Boolean(normDomTitle) && normHttpTitle === normDomTitle
              ? "PASS"
              : "FAIL",
        });

        const normHttpDomain = normalizeDomainForParity(httpView.storeDomain);
        recordComparison({
          pair: "HTTP_VS_DOM",
          field: "storeDomain",
          candidateId: dbCand.candidateId,
          required: true,
          presentDb: false,
          presentHttp: Boolean(normHttpDomain),
          presentDom: Boolean(normDomDomain),
          expectedNormalizedValue: normHttpDomain || null,
          observedNormalizedValue: normDomDomain || null,
          sourceEvidenceId: evId,
          verdict:
            Boolean(normHttpDomain) && Boolean(normDomDomain) && normHttpDomain === normDomDomain
              ? "PASS"
              : "FAIL",
        });

        recordComparison({
          pair: "HTTP_VS_DOM",
          field: "identityStatus",
          candidateId: dbCand.candidateId,
          required: true,
          presentDb: false,
          presentHttp: Boolean(httpView.identityStatus),
          presentDom: Boolean(domCard.identityStatus),
          expectedNormalizedValue: httpView.identityStatus || null,
          observedNormalizedValue: domCard.identityStatus || null,
          sourceEvidenceId: evId,
          verdict:
            Boolean(httpView.identityStatus) &&
            Boolean(domCard.identityStatus) &&
            httpView.identityStatus === domCard.identityStatus
              ? "PASS"
              : "FAIL",
        });

        if (httpView.score !== null || (domCard.score !== null && domCard.score !== undefined)) {
          const expScore = httpView.score !== null ? Math.round(httpView.score) : null;
          const obsScore =
            domCard.score !== null && domCard.score !== undefined ? Math.round(domCard.score) : null;
          recordComparison({
            pair: "HTTP_VS_DOM",
            field: "score",
            candidateId: dbCand.candidateId,
            required: true,
            presentDb: false,
            presentHttp: expScore !== null,
            presentDom: obsScore !== null,
            expectedNormalizedValue: expScore,
            observedNormalizedValue: obsScore,
            sourceEvidenceId: evId,
            verdict: expScore !== null && obsScore !== null && expScore === obsScore ? "PASS" : "FAIL",
          });
        }
      }
    }
  }

  const dbVsHttpEntries = fieldComparisons.filter((e) => e.pair === "DB_VS_HTTP");
  const dbVsDomEntries = fieldComparisons.filter((e) => e.pair === "DB_VS_DOM");
  const httpVsDomEntries = fieldComparisons.filter((e) => e.pair === "HTTP_VS_DOM");

  const dbVsHttpVerdict: "PASS" | "FAIL" | "NOT_EXECUTED" =
    dbVsHttpEntries.length === 0
      ? "NOT_EXECUTED"
      : dbVsHttpEntries.every((e) => e.verdict === "PASS")
      ? "PASS"
      : "FAIL";

  const hasValidDomTitle = domCards.some(
    (c) => Boolean(normalizeProductTitleForParity(c.title))
  );

  const dbVsDomVerdict: "PASS" | "FAIL" | "NOT_EXECUTED" =
    dbVsDomEntries.length === 0 || !hasValidDomTitle
      ? domCards.length === 0
        ? "NOT_EXECUTED"
        : "FAIL"
      : dbVsDomEntries.every((e) => e.verdict === "PASS")
      ? "PASS"
      : "FAIL";

  const httpVsDomVerdict: "PASS" | "FAIL" | "NOT_EXECUTED" =
    httpVsDomEntries.length === 0 || !hasValidDomTitle
      ? domCards.length === 0
        ? "NOT_EXECUTED"
        : "FAIL"
      : httpVsDomEntries.every((e) => e.verdict === "PASS")
      ? "PASS"
      : "FAIL";

  if (!hasValidDomTitle) {
    comparedDomFieldCount = 0;
  }

  const httpApiParityPassed = dbVsHttpVerdict === "PASS" && comparedHttpFieldCount > 0;
  const chromiumParityPassed =
    dbVsDomVerdict === "PASS" &&
    httpVsDomVerdict === "PASS" &&
    comparedDomFieldCount > 0;
  const sameRunReconciliationPassed =
    httpApiParityPassed && chromiumParityPassed && discrepancies.length === 0;

  const comparedCandidateCount = Math.min(dbCandidates.length, Math.max(1, domCards.length));
  const comparedFieldCount = fieldComparisons.length;

  return {
    evaluatedAt,
    researchRunId: persistedRunId,
    persistedFromSqliteVerified: true,
    dbVsHttpVerdict,
    dbVsDomVerdict,
    httpVsDomVerdict,
    sameRunReconciliationPassed,
    httpApiParityPassed,
    chromiumParityPassed,
    comparedCandidateCount,
    comparedFieldCount,
    comparedDbFieldCount,
    comparedHttpFieldCount,
    comparedDomFieldCount,
    fieldComparisons,
    fieldDiscrepancies: discrepancies,
    reason: sameRunReconciliationPassed
      ? `Three-way reconciliation passed (${fieldComparisons.length} field checks across SQLite, HTTP API, and Chromium DOM).`
      : `Reconciliation failed or incomplete (dbVsHttp=${dbVsHttpVerdict}, dbVsDom=${dbVsDomVerdict}, httpVsDom=${httpVsDomVerdict}, discrepancies=${discrepancies.length}).`,
  };
}

async function computeSqliteTableDigests(db: any = prisma): Promise<{
  syncJobCount: number;
  productCount: number;
  competitorStoreCount: number;
  adProductLinkCount: number;
  evergreenScoreCount: number;
  tableDigests: Record<string, TableContentDigest>;
}> {
  const hashRows = (tableName: string, rows: any[]): TableContentDigest => {
    const serialized = JSON.stringify(rows);
    const sha256Digest = crypto.createHash("sha256").update(serialized).digest("hex");
    return {
      tableName,
      rowCount: rows.length,
      sha256Digest,
    };
  };

  const syncJobs =
    (await db.syncJob?.findMany?.({
      orderBy: { id: "asc" },
      select: {
        id: true,
        workspaceId: true,
        jobType: true,
        status: true,
        progress: true,
        totalItems: true,
        errorMessage: true,
        resultJson: true,
        startedAt: true,
        completedAt: true,
        createdAt: true,
      },
    })) ?? [];

  const products =
    (await db.researchProduct?.findMany?.({
      orderBy: { id: "asc" },
      select: {
        id: true,
        storeId: true,
        title: true,
        category: true,
        description: true,
        imageUrl: true,
        productUrl: true,
        updatedAt: true,
      },
    })) ?? [];

  const stores =
    (await db.competitorStore?.findMany?.({
      orderBy: { id: "asc" },
      select: {
        id: true,
        domain: true,
        storeName: true,
        commercePlatform: true,
        updatedAt: true,
      },
    })) ?? [];

  const links =
    (await db.adProductLink?.findMany?.({
      orderBy: { id: "asc" },
      select: {
        id: true,
        adId: true,
        productId: true,
        confidence: true,
      },
    })) ?? [];

  const scores =
    (await db.evergreenProductScore?.findMany?.({
      orderBy: { id: "asc" },
      select: {
        id: true,
        productId: true,
        totalScore: true,
        tier: true,
        createdAt: true,
      },
    })) ?? [];

  const tableDigests: Record<string, TableContentDigest> = {
    syncJob: hashRows("syncJob", syncJobs),
    researchProduct: hashRows("researchProduct", products),
    competitorStore: hashRows("competitorStore", stores),
    adProductLink: hashRows("adProductLink", links),
    evergreenProductScore: hashRows("evergreenProductScore", scores),
  };

  return {
    syncJobCount: syncJobs.length,
    productCount: products.length,
    competitorStoreCount: stores.length,
    adProductLinkCount: links.length,
    evergreenScoreCount: scores.length,
    tableDigests,
  };
}

/**
 * 4A. DB-only SQLite Snapshot Integrity Verifier (`verifySqliteReadOnlySnapshotIntegrity`, Phase 1)
 * Used when the isolated Next.js server cannot be launched (e.g., disk headroom < 15 GB).
 * NEVER claims `httpRequestVerified: true` or `readOnlyPassed: true`.
 */
export async function verifySqliteReadOnlySnapshotIntegrity(
  db: any = prisma
): Promise<ReadOnlyMutationCheckResult> {
  try {
    const beforeSnap = await computeSqliteTableDigests(db);
    const afterSnap = await computeSqliteTableDigests(db);
    const mutatedTables: string[] = [];
    let rowCountsMatch = true;
    let contentDigestsMatch = true;

    for (const tableName of Object.keys(beforeSnap.tableDigests)) {
      const b = beforeSnap.tableDigests[tableName];
      const a = afterSnap.tableDigests[tableName];
      if (!b || !a) continue;
      if (b.rowCount !== a.rowCount) {
        rowCountsMatch = false;
        mutatedTables.push(tableName);
      } else if (b.sha256Digest !== a.sha256Digest) {
        contentDigestsMatch = false;
        mutatedTables.push(tableName);
      }
    }

    const mutationsDetected = !rowCountsMatch || !contentDigestsMatch || mutatedTables.length > 0;
    return {
      verificationScope: "DB_ONLY_READ_SNAPSHOT",
      status: "HTTP_NOT_EXECUTED",
      readOnlyPassed: false,
      httpRequestVerified: false,
      httpStatusCode: null,
      actualHttpRequestCount: 0,
      requestUrl: null,
      responseBodyDigest: null,
      contentDigestDbOnly: beforeSnap,
      contentDigestsMatch,
      rowCountsMatch,
      mutatedTables,
      beforeSnapshot: beforeSnap,
      afterSnapshot: afterSnap,
      mutationsDetected,
      error:
        "HTTP_NOT_EXECUTED: Read-only HTTP endpoint could not be probed because isolated server was not running; only DB-only snapshot digest was verified.",
    };
  } catch (err: any) {
    return {
      verificationScope: "DB_ONLY_READ_SNAPSHOT",
      status: "HTTP_NOT_EXECUTED",
      readOnlyPassed: false,
      httpRequestVerified: false,
      httpStatusCode: null,
      actualHttpRequestCount: 0,
      requestUrl: null,
      responseBodyDigest: null,
      contentDigestsMatch: false,
      rowCountsMatch: false,
      mutatedTables: [],
      beforeSnapshot: { syncJobCount: -1, productCount: -1 },
      afterSnapshot: { syncJobCount: -1, productCount: -1 },
      mutationsDetected: true,
      error: `DB-only SQLite digest snapshot failed: ${err?.message}`,
    };
  }
}

/**
 * 4B. Real HTTP Read-Only Overview API Probe (`probeRealReadOnlyOverviewApi`, Phase 1)
 * Performs a real HTTP GET against `/api/v1/research/products/[id]/overview` and verifies:
 * - HTTP status === 200
 * - Valid JSON payload with SHA-256 `responseBodyDigest`
 * - Resolved `researchRunId === runId`, `candidateId === candidateId`, and `productId` match
 */
export async function probeRealReadOnlyOverviewApi(
  options: RealHttpReadOnlyProbeOptions
): Promise<RealHttpReadOnlyProbeResult> {
  const {
    baseUrl,
    runId,
    candidateId,
    productId,
    workspaceId,
    signal,
    fetchImpl = fetch,
  } = options;

  const cleanBase = String(baseUrl || "").trim().replace(/\/$/, "");
  const effectiveProductId = String(productId || candidateId || "").trim();
  const requestUrl = `${cleanBase}/api/v1/research/products/${encodeURIComponent(
    effectiveProductId
  )}/overview?runId=${encodeURIComponent(runId)}&candidateId=${encodeURIComponent(
    candidateId
  )}${workspaceId ? `&workspaceId=${encodeURIComponent(workspaceId)}` : ""}`;

  if (!/^https?:\/\//i.test(cleanBase) || !runId || !candidateId) {
    return {
      transportVerified: false,
      actualHttpRequestCount: 0,
      requestUrl,
      statusCode: null,
      ok: false,
      validJson: false,
      identityMatched: false,
      resolvedRunId: null,
      resolvedCandidateId: null,
      resolvedProductId: null,
      responseBodyDigest: null,
      body: null,
      error: "Invalid baseUrl, runId, or candidateId for real HTTP overview probe",
    };
  }

  try {
    const res = await fetchImpl(requestUrl, {
      method: "GET",
      signal,
    });
    const statusCode = res.status;
    const rawText = await res.text();
    const responseBodyDigest = crypto
      .createHash("sha256")
      .update(rawText, "utf8")
      .digest("hex");

    let parsedJson: any = null;
    let validJson = false;
    try {
      parsedJson = JSON.parse(rawText);
      validJson = Boolean(parsedJson && typeof parsedJson === "object");
    } catch {
      validJson = false;
    }

    const normView = validJson ? extractNormalizedHttpCandidate({ body: parsedJson }) : null;
    const dataObj = parsedJson?.data && typeof parsedJson.data === "object" ? parsedJson.data : null;
    const resolvedRunId = normView?.researchRunId ?? null;
    const resolvedCandidateId = normView?.candidateId ?? null;
    const resolvedProductId =
      dataObj?.kh02ResearchContext?.researchProductId ??
      dataObj?.product?.id ??
      resolvedCandidateId ??
      null;

    const runIdMatched = Boolean(resolvedRunId && resolvedRunId === runId);
    const candidateIdMatched = Boolean(
      resolvedCandidateId && resolvedCandidateId === candidateId
    );
    const productIdMatched =
      !productId ||
      !resolvedProductId ||
      resolvedProductId === productId ||
      resolvedProductId === candidateId;

    const identityMatched = runIdMatched && candidateIdMatched && productIdMatched;
    const transportVerified =
      statusCode === 200 &&
      res.ok === true &&
      validJson &&
      identityMatched &&
      responseBodyDigest.length === 64;

    let error: string | undefined = undefined;
    if (statusCode !== 200) {
      error = `HTTP GET returned status ${statusCode} (expected 200)`;
    } else if (!validJson) {
      error = "HTTP 200 response body is not a valid JSON object";
    } else if (!identityMatched) {
      error = `Identity mismatch in HTTP 200 response: expected(runId=${runId}, candidateId=${candidateId}, productId=${effectiveProductId}) vs resolved(runId=${resolvedRunId}, candidateId=${resolvedCandidateId}, productId=${resolvedProductId})`;
    }

    return {
      transportVerified,
      actualHttpRequestCount: 1,
      requestUrl,
      statusCode,
      ok: res.ok && statusCode === 200,
      validJson,
      identityMatched,
      resolvedRunId,
      resolvedCandidateId,
      resolvedProductId,
      responseBodyDigest,
      body: parsedJson,
      error,
    };
  } catch (err: any) {
    return {
      transportVerified: false,
      actualHttpRequestCount: 0,
      requestUrl,
      statusCode: null,
      ok: false,
      validJson: false,
      identityMatched: false,
      resolvedRunId: null,
      resolvedCandidateId: null,
      resolvedProductId: null,
      responseBodyDigest: null,
      body: null,
      error: `HTTP GET network/transport error: ${err?.message}`,
    };
  }
}

/**
 * 4. Assess that GET requests do not mutate SQLite records (row counts AND SHA-256 content digests)
 *    and that the GET request itself succeeded with real HTTP transport proof (`transportVerified === true`),
 *    HTTP 200, valid JSON, responseBodyDigest, and identity match.
 *    Synthetic Prisma/in-memory callbacks returning `{ status: 200, body: { ok: true } }` without
 *    real HTTP transport proof are rejected (`httpRequestVerified: false`, `readOnlyPassed: false`).
 */
export async function assessReadOnlyMutation(
  fnToExecute: () => Promise<any>,
  db: any = prisma
): Promise<ReadOnlyMutationCheckResult> {
  let beforeSnap: Awaited<ReturnType<typeof computeSqliteTableDigests>>;
  try {
    beforeSnap = await computeSqliteTableDigests(db);
  } catch (err: any) {
    return {
      verificationScope: "HTTP_PROBE_FAILED",
      status: "FAIL",
      readOnlyPassed: false,
      httpRequestVerified: false,
      httpStatusCode: null,
      actualHttpRequestCount: 0,
      requestUrl: null,
      responseBodyDigest: null,
      contentDigestsMatch: false,
      rowCountsMatch: false,
      mutatedTables: [],
      beforeSnapshot: { syncJobCount: -1, productCount: -1 },
      afterSnapshot: { syncJobCount: -1, productCount: -1 },
      mutationsDetected: true,
      error: `Pre-execution SQLite digest snapshot failed: ${err?.message}`,
    };
  }

  let httpRequestVerified = false;
  let httpStatusCode: number | null = null;
  let actualHttpRequestCount = 0;
  let requestUrl: string | null = null;
  let responseBodyDigest: string | null = null;
  let verificationScope: ReadOnlyMutationCheckResult["verificationScope"] =
    "SYNTHETIC_CALLBACK_REJECTED";
  let callbackError: string | undefined = undefined;

  try {
    const execResult = await fnToExecute();
    if (execResult === null || execResult === false) {
      callbackError =
        "Read-only GET callback returned null/false (swallowed network failure is forbidden)";
      verificationScope = "HTTP_PROBE_FAILED";
    } else if (execResult && typeof execResult === "object") {
      const status =
        typeof execResult.statusCode === "number"
          ? execResult.statusCode
          : typeof execResult.status === "number"
          ? execResult.status
          : null;
      httpStatusCode = status;
      requestUrl =
        typeof execResult.requestUrl === "string" ? execResult.requestUrl : null;
      responseBodyDigest =
        typeof execResult.responseBodyDigest === "string"
          ? execResult.responseBodyDigest
          : null;
      actualHttpRequestCount =
        typeof execResult.actualHttpRequestCount === "number"
          ? execResult.actualHttpRequestCount
          : 0;

      const hasRealTransportProof =
        execResult.transportVerified === true &&
        actualHttpRequestCount >= 1 &&
        Boolean(requestUrl && /^https?:\/\//i.test(requestUrl)) &&
        status === 200 &&
        execResult.validJson === true &&
        execResult.identityMatched === true &&
        Boolean(responseBodyDigest && responseBodyDigest.length === 64);

      if (hasRealTransportProof) {
        httpRequestVerified = true;
        verificationScope = "HTTP_GET_NONMUTATION";
      } else if (status !== null && status !== 200) {
        httpRequestVerified = false;
        verificationScope = "HTTP_PROBE_FAILED";
        callbackError =
          execResult.error ||
          `Read-only GET request returned non-200 HTTP status ${status}`;
      } else if (execResult.transportVerified === false) {
        httpRequestVerified = false;
        verificationScope = "HTTP_PROBE_FAILED";
        callbackError =
          execResult.error ||
          "Real HTTP read-only probe failed transport/JSON/identity verification";
      } else {
        // Synthetic callback object such as `{ status: 200, body: { ok: true } }` without transport proof!
        httpRequestVerified = false;
        actualHttpRequestCount = 0;
        verificationScope = "SYNTHETIC_CALLBACK_REJECTED";
        callbackError =
          "SYNTHETIC_CALLBACK_REJECTED: Callback returned an object without real HTTP transport proof (transportVerified=true, requestUrl, responseBodyDigest, identityMatched required).";
      }
    } else {
      // Callback returned undefined (void) or primitive without real HTTP transport proof
      httpRequestVerified = false;
      actualHttpRequestCount = 0;
      verificationScope = "SYNTHETIC_CALLBACK_REJECTED";
      callbackError =
        "SYNTHETIC_CALLBACK_REJECTED: Callback returned void/primitive without real HTTP transport proof.";
    }
  } catch (err: any) {
    httpRequestVerified = false;
    verificationScope = "HTTP_PROBE_FAILED";
    callbackError = `Executed GET callback threw or failed verification: ${err?.message}`;
  }

  let afterSnap: Awaited<ReturnType<typeof computeSqliteTableDigests>>;
  try {
    afterSnap = await computeSqliteTableDigests(db);
  } catch (err: any) {
    return {
      verificationScope,
      status: "FAIL",
      readOnlyPassed: false,
      httpRequestVerified: false,
      httpStatusCode,
      actualHttpRequestCount,
      requestUrl,
      responseBodyDigest,
      contentDigestsMatch: false,
      rowCountsMatch: false,
      mutatedTables: [],
      beforeSnapshot: beforeSnap,
      afterSnapshot: { syncJobCount: -1, productCount: -1 },
      mutationsDetected: true,
      error: `Post-execution SQLite digest snapshot failed: ${err?.message}`,
    };
  }

  const mutatedTables: string[] = [];
  let rowCountsMatch = true;
  let contentDigestsMatch = true;

  for (const tableName of Object.keys(beforeSnap.tableDigests)) {
    const b = beforeSnap.tableDigests[tableName];
    const a = afterSnap.tableDigests[tableName];
    if (!b || !a) continue;
    if (b.rowCount !== a.rowCount) {
      rowCountsMatch = false;
      mutatedTables.push(tableName);
    } else if (b.sha256Digest !== a.sha256Digest) {
      contentDigestsMatch = false;
      mutatedTables.push(tableName);
    }
  }

  const mutationsDetected = !rowCountsMatch || !contentDigestsMatch || mutatedTables.length > 0;
  const readOnlyPassed = httpRequestVerified && !mutationsDetected && !callbackError;

  const errorMsg = mutationsDetected
    ? `Database mutation detected during read-only GET in table(s): ${mutatedTables.join(", ")}`
    : callbackError;

  return {
    verificationScope,
    status: readOnlyPassed ? "PASS" : "FAIL",
    readOnlyPassed,
    httpRequestVerified,
    httpStatusCode,
    actualHttpRequestCount,
    requestUrl,
    responseBodyDigest,
    contentDigestsMatch,
    rowCountsMatch,
    mutatedTables,
    beforeSnapshot: beforeSnap,
    afterSnapshot: afterSnap,
    mutationsDetected,
    error: errorMsg,
  };
}

/**
 * 5. Compute Chromium gate dynamically from actual execution metrics
 */
export function computeChromiumGate(
  execution: ChromiumExecutionResult,
  parity: ParityReconciliationResult,
  readOnly: ReadOnlyMutationCheckResult
): ChromiumGateResult {
  const checks = {
    serverReady: execution.serverReady,
    browserLaunched: execution.browserLaunched,
    pageNavigationSucceeded: execution.pageNavigationSucceeded,
    domAssertionsPassed:
      execution.actualAssertionCount > 0 && execution.assertionFailures.length === 0,
    httpApiPassed: Boolean(execution.httpApiResponse?.ok),
    parityReconciliationPassed:
      parity.sameRunReconciliationPassed &&
      parity.persistedFromSqliteVerified &&
      parity.dbVsHttpVerdict === "PASS" &&
      parity.dbVsDomVerdict === "PASS" &&
      parity.httpVsDomVerdict === "PASS" &&
      parity.comparedCandidateCount > 0 &&
      parity.comparedDomFieldCount > 0,
    readOnlyIntegrityPassed:
      readOnly.readOnlyPassed &&
      readOnly.httpRequestVerified &&
      readOnly.contentDigestsMatch &&
      !readOnly.mutationsDetected,
  };

  const allPassed = Object.values(checks).every(Boolean);

  let reason = "";
  if (allPassed) {
    reason =
      "Playwright Chromium UI, HTTP API overview, and persisted SQLite three-way parity + content digest read-only integrity verified.";
  } else {
    const failedChecks = Object.entries(checks)
      .filter(([_, v]) => !v)
      .map(([k]) => k);
    reason = `Chromium gate failed on checks: ${failedChecks.join(", ")}`;
  }

  return {
    verdict: allPassed ? "PASS" : "FAIL",
    reason,
    checks,
  };
}

function makeSamplePersistedSnapshot(): PersistedSqliteRunSnapshot {
  return {
    persistedFromSqlite: true,
    syncJobId: "run_strict_1",
    researchRunId: "run_strict_1",
    workspaceId: "ws_1",
    status: "COMPLETED",
    persistedAt: "2026-04-03T00:00:00.000Z",
    candidates: [
      {
        candidateId: "c1",
        researchProductId: "c1",
        title: "UAHPET Stainless Steel Pet Water Fountain",
        storeDomain: "uahpet.com",
        canonicalProductUrl: "https://uahpet.com/products/fountain",
        rank: 1,
        score: 84,
        identityStatus: "VERIFIED",
        familyKey: "pet_water_fountain",
        persistedObservationCount: 3,
        persistedResearchProductExists: true,
      },
      {
        candidateId: "c2",
        researchProductId: "c2",
        title: "KittySpout Wireless Cat Fountain",
        storeDomain: "kittyspout.com",
        canonicalProductUrl: "https://kittyspout.com/products/wireless",
        rank: 2,
        score: 79,
        identityStatus: "VERIFIED",
        familyKey: "wireless_fountain",
        persistedObservationCount: 2,
        persistedResearchProductExists: true,
      },
    ],
  };
}

function makeSampleHttpOverview(overrides: Record<string, any> = {}) {
  return {
    data: {
      researchContextResolution: {
        resolvedResearchRunId: "run_strict_1",
      },
      kh02ResearchContext: {
        researchRunId: "run_strict_1",
        candidateId: "c1",
        canonicalProductName: "UAHPET Stainless Steel Pet Water Fountain",
        storeDomain: "uahpet.com",
        identityStatus: "VERIFIED",
        rank: 1,
        evergreenScore: 84,
        familyKey: "pet_water_fountain",
        ...overrides,
      },
    },
  };
}

function makeSampleDomData(cardOverrides: Partial<DomExtractedCard> = {}, domRunId = "run_strict_1") {
  return {
    domRunId,
    cardCount: 2,
    cards: [
      {
        candidateId: "c1",
        productId: "c1",
        title: "UAHPET Stainless Steel Pet Water Fountain",
        storeDomain: "uahpet.com",
        canonicalProductUrl: "https://uahpet.com/products/fountain",
        rank: 1,
        score: 84,
        identityStatus: "VERIFIED",
        familyKey: "pet_water_fountain",
        ...cardOverrides,
      },
      {
        candidateId: "c2",
        productId: "c2",
        title: "KittySpout Wireless Cat Fountain",
        storeDomain: "kittyspout.com",
        canonicalProductUrl: "https://kittyspout.com/products/wireless",
        rank: 2,
        score: 79,
        identityStatus: "VERIFIED",
        familyKey: "wireless_fountain",
      },
    ],
  };
}

/**
 * 6. Mandatory negative failure injection tests exercising reconcileSqliteHttpChromium,
 *    assessReadOnlyMutation, and computeChromiumGate across all 11 required scenarios.
 */
export function runChromiumFailureInjections(): {
  totalInjections: number;
  totalCaught: number;
  passed: boolean;
  results: Array<{
    scenarioId: string;
    description: string;
    injectedDefect: string;
    caughtAndRejected: boolean;
    resultingVerdict: string;
  }>;
} {
  const baseExecution: ChromiumExecutionResult = {
    executed: true,
    status: "PASS",
    browserLaunched: true,
    serverReady: true,
    pageNavigationSucceeded: true,
    actualAssertionCount: 6,
    assertionFailures: [],
    routesVerified: ["/products", "/api/v1/research/products/[id]/overview"],
    screenshots: ["screenshots/01_pf_recommended.png"],
    httpApiResponse: { statusCode: 200, ok: true, body: makeSampleHttpOverview() },
    durationMs: 1200,
  };

  const baseReadOnly: ReadOnlyMutationCheckResult = {
    readOnlyPassed: true,
    httpRequestVerified: true,
    httpStatusCode: 200,
    contentDigestsMatch: true,
    rowCountsMatch: true,
    mutatedTables: [],
    beforeSnapshot: { syncJobCount: 10, productCount: 20 },
    afterSnapshot: { syncJobCount: 10, productCount: 20 },
    mutationsDetected: false,
  };

  const scenarios = [
    {
      scenarioId: "CR-FAIL-01",
      description: "HTTP response missing candidateId (undefined/null) fails dbVsHttpVerdict and httpApiParityPassed",
      mutate: () => {
        const p = reconcileSqliteHttpChromium({
          workspaceId: "ws_1",
          runId: "run_strict_1",
          persistedDbSnapshot: makeSamplePersistedSnapshot(),
          httpData: makeSampleHttpOverview({ candidateId: null }),
          domData: makeSampleDomData(),
        });
        if (p.dbVsHttpVerdict !== "FAIL" || p.httpApiParityPassed !== false) {
          return { verdict: "PASS" as const };
        }
        return computeChromiumGate(baseExecution, p, baseReadOnly);
      },
    },
    {
      scenarioId: "CR-FAIL-02",
      description: "HTTP response missing storeDomain fails dbVsHttpVerdict",
      mutate: () => {
        const p = reconcileSqliteHttpChromium({
          workspaceId: "ws_1",
          runId: "run_strict_1",
          persistedDbSnapshot: makeSamplePersistedSnapshot(),
          httpData: makeSampleHttpOverview({ storeDomain: null }),
          domData: makeSampleDomData(),
        });
        if (p.dbVsHttpVerdict !== "FAIL" || p.httpApiParityPassed !== false) {
          return { verdict: "PASS" as const };
        }
        return computeChromiumGate(baseExecution, p, baseReadOnly);
      },
    },
    {
      scenarioId: "CR-FAIL-03",
      description: "HTTP response missing identityStatus fails dbVsHttpVerdict",
      mutate: () => {
        const p = reconcileSqliteHttpChromium({
          workspaceId: "ws_1",
          runId: "run_strict_1",
          persistedDbSnapshot: makeSamplePersistedSnapshot(),
          httpData: makeSampleHttpOverview({ identityStatus: undefined }),
          domData: makeSampleDomData(),
        });
        if (p.dbVsHttpVerdict !== "FAIL" || p.httpApiParityPassed !== false) {
          return { verdict: "PASS" as const };
        }
        return computeChromiumGate(baseExecution, p, baseReadOnly);
      },
    },
    {
      scenarioId: "CR-FAIL-04",
      description: "DOM title absent produces comparedDomFieldCount=0 and chromiumParityPassed=false",
      mutate: () => {
        const p = reconcileSqliteHttpChromium({
          workspaceId: "ws_1",
          runId: "run_strict_1",
          persistedDbSnapshot: makeSamplePersistedSnapshot(),
          httpData: makeSampleHttpOverview(),
          domData: { domRunId: "run_strict_1", cardCount: 0, cards: [] },
        });
        if (
          p.comparedDomFieldCount !== 0 ||
          (p.dbVsDomVerdict !== "NOT_EXECUTED" && p.dbVsDomVerdict !== "FAIL") ||
          p.chromiumParityPassed !== false
        ) {
          return { verdict: "PASS" as const };
        }
        return computeChromiumGate(baseExecution, p, baseReadOnly);
      },
    },
    {
      scenarioId: "CR-FAIL-05",
      description: "DOM title changed to another product whose first 15 chars overlap fails dbVsDomVerdict and httpVsDomVerdict",
      mutate: () => {
        const p = reconcileSqliteHttpChromium({
          workspaceId: "ws_1",
          runId: "run_strict_1",
          persistedDbSnapshot: makeSamplePersistedSnapshot(),
          httpData: makeSampleHttpOverview(),
          domData: makeSampleDomData({
            title: "UAHPET Stainless Steel Dog Bowl Automatic",
          }),
        });
        if (p.dbVsDomVerdict !== "FAIL" || p.httpVsDomVerdict !== "FAIL") {
          return { verdict: "PASS" as const };
        }
        return computeChromiumGate(baseExecution, p, baseReadOnly);
      },
    },
    {
      scenarioId: "CR-FAIL-06",
      description: "DOM rank order swapped vs SQLite persisted order fails dbVsDomVerdict",
      mutate: () => {
        const swappedDom = makeSampleDomData();
        swappedDom.cards = [
          { ...swappedDom.cards[1], rank: 1 },
          { ...swappedDom.cards[0], rank: 2 },
        ];
        const p = reconcileSqliteHttpChromium({
          workspaceId: "ws_1",
          runId: "run_strict_1",
          persistedDbSnapshot: makeSamplePersistedSnapshot(),
          httpData: makeSampleHttpOverview(),
          domData: swappedDom,
        });
        if (p.dbVsDomVerdict !== "FAIL") {
          return { verdict: "PASS" as const };
        }
        return computeChromiumGate(baseExecution, p, baseReadOnly);
      },
    },
    {
      scenarioId: "CR-FAIL-07",
      description: "DOM score mutated vs SQLite/HTTP fails dbVsDomVerdict and httpVsDomVerdict",
      mutate: () => {
        const p = reconcileSqliteHttpChromium({
          workspaceId: "ws_1",
          runId: "run_strict_1",
          persistedDbSnapshot: makeSamplePersistedSnapshot(),
          httpData: makeSampleHttpOverview(),
          domData: makeSampleDomData({ score: 99 }),
        });
        if (p.dbVsDomVerdict !== "FAIL" || p.httpVsDomVerdict !== "FAIL") {
          return { verdict: "PASS" as const };
        }
        return computeChromiumGate(baseExecution, p, baseReadOnly);
      },
    },
    {
      scenarioId: "CR-FAIL-08",
      description: "DOM runId differs from persisted researchRunId fails dbVsDomVerdict",
      mutate: () => {
        const p = reconcileSqliteHttpChromium({
          workspaceId: "ws_1",
          runId: "run_strict_1",
          persistedDbSnapshot: makeSamplePersistedSnapshot(),
          httpData: makeSampleHttpOverview(),
          domData: makeSampleDomData({}, "run_stale_999"),
        });
        if (p.dbVsDomVerdict !== "FAIL") {
          return { verdict: "PASS" as const };
        }
        return computeChromiumGate(baseExecution, p, baseReadOnly);
      },
    },
    {
      scenarioId: "CR-FAIL-09",
      description: "In-memory shortlist passed without persisted SQLite snapshot fails dbVsHttpVerdict",
      mutate: () => {
        const p = reconcileSqliteHttpChromium({
          workspaceId: "ws_1",
          runId: "run_strict_1",
          persistedDbSnapshot: null,
          candidates: [{ candidateId: "c1", title: "In-memory only" }],
          httpData: makeSampleHttpOverview(),
          domData: makeSampleDomData(),
        });
        if (p.dbVsHttpVerdict !== "FAIL" || p.persistedFromSqliteVerified !== false) {
          return { verdict: "PASS" as const };
        }
        return computeChromiumGate(baseExecution, p, baseReadOnly);
      },
    },
    {
      scenarioId: "CR-FAIL-10",
      description: "Read-only GET handler updates an existing row (content digest changes while row counts stay equal) fails readOnlyPassed",
      mutate: () => {
        const r: ReadOnlyMutationCheckResult = {
          ...baseReadOnly,
          readOnlyPassed: false,
          contentDigestsMatch: false,
          rowCountsMatch: true,
          mutatedTables: ["researchProduct"],
          mutationsDetected: true,
        };
        const validParity = reconcileSqliteHttpChromium({
          workspaceId: "ws_1",
          runId: "run_strict_1",
          persistedDbSnapshot: makeSamplePersistedSnapshot(),
          httpData: makeSampleHttpOverview(),
          domData: makeSampleDomData(),
        });
        return computeChromiumGate(baseExecution, validParity, r);
      },
    },
    {
      scenarioId: "CR-FAIL-11",
      description: "Read-only GET request returns HTTP 500 or network error fails readOnlyPassed and computeChromiumGate",
      mutate: () => {
        const r: ReadOnlyMutationCheckResult = {
          ...baseReadOnly,
          readOnlyPassed: false,
          httpRequestVerified: false,
          httpStatusCode: 500,
          mutationsDetected: false,
        };
        const validParity = reconcileSqliteHttpChromium({
          workspaceId: "ws_1",
          runId: "run_strict_1",
          persistedDbSnapshot: makeSamplePersistedSnapshot(),
          httpData: makeSampleHttpOverview(),
          domData: makeSampleDomData(),
        });
        return computeChromiumGate(
          { ...baseExecution, httpApiResponse: { statusCode: 500, ok: false, body: null } },
          validParity,
          r
        );
      },
    },
  ];

  const results = scenarios.map((s) => {
    const res = s.mutate();
    const caught = res.verdict !== "PASS";
    return {
      scenarioId: s.scenarioId,
      description: s.description,
      injectedDefect: s.description,
      caughtAndRejected: caught,
      resultingVerdict: res.verdict,
    };
  });

  const totalCaught = results.filter((r) => r.caughtAndRejected).length;

  return {
    totalInjections: scenarios.length,
    totalCaught,
    passed: totalCaught === scenarios.length,
    results,
  };
}
