/**
 * SWAI KH-02 V12.4.3.5.0 — Microsoft Playwright MCP Transport for Amazon US Pilot
 *
 * Implements `connectAmazonPlaywrightMcp(options)` using the official Model Context Protocol
 * SDK (`@modelcontextprotocol/sdk`) over `StdioClientTransport` against pinned
 * `@playwright/mcp@0.0.83` (`--headless --isolated --block-service-workers`).
 *
 * Core Invariants:
 * 1. Never labels ordinary Playwright or mock fixtures as a live MCP session.
 * 2. Verifies real MCP initialization handshake (`getServerVersion()`) and tool discovery (`listTools()`).
 * 3. Enforces headless, isolated in-memory browser profile (`--headless --isolated`).
 * 4. Guarantees clean shutdown of both MCP client session and owned child process on close/abort/timeout.
 * 5. Unit-test fixture transport is explicitly stamped `transportMode: "TEST_FIXTURE"` and
 *    `observationClass: "TEST_FIXTURE"` so it can never satisfy live provider gates.
 */

import crypto from "crypto";
import fs from "fs";
import os from "os";
import path from "path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import {
  AmazonMcpSessionLifecycleProof,
  MarketplaceObservationClass,
} from "./marketplaceEvidenceTypes";
import {
  ParsedAmazonSearchSnapshotResult,
  RawAmazonSnapshotInput,
   parseAmazonSearchSnapshotCards,
  validateAmazonUsProductUrl,
  validateAmazonUsSearchUrl,
} from "./amazonUsIdentity";

export type { AmazonMcpSessionLifecycleProof };

export const PLAYWRIGHT_MCP_PINNED_PACKAGE = "@playwright/mcp@0.0.83";
export const PLAYWRIGHT_MCP_PINNED_VERSION = "0.0.83";

export interface PlaywrightMcpToolInvocationRecord {
  toolName: string;
  url: string;
  invokedAt: string;
  requestHash: string | null;
  responseHash: string | null;
}

export interface PlaywrightMcpHandshakeProof {
  executed: boolean;
  connected: boolean;
  status:
    | "CONNECTED_AND_VERIFIED"
    | "MCP_NOT_CONFIGURED"
    | "BLOCKED_PROVIDER"
    | "TEST_FIXTURE_SESSION"
    | "HANDSHAKE_TIMED_OUT";
  transportMode: "REAL_STDIO_MCP" | "TEST_FIXTURE";
  serverOrigin?: "PINNED_PLAYWRIGHT_MCP" | "LOCAL_MCP_TEST_DOUBLE" | "TEST_FIXTURE";
  observationClass: MarketplaceObservationClass;
  sessionId: string;
  pinnedPackage: string;
  command: string;
  args: string[];
  ownedChildPid: number | null;
  headlessIsolatedProfile: boolean;
  serverName: string | null;
  serverVersion: string | null;
  discoveredTools: string[];
  requiredToolsPresent: boolean;
  missingRequiredTools: string[];
  toolInvocationRecords?: PlaywrightMcpToolInvocationRecord[];
  startedAt: string;
  completedAt: string;
  lastToolCompletedAt?: string | null;
  closeStartedAt?: string | null;
  closeFinishedAt?: string | null;
  durationMs: number;
  closedCleanly: boolean;
  ownedChildPidTerminated?: boolean | "UNKNOWN";
  closeError?: string | null;
  errorMessage: string | null;
}

export interface AmazonPlaywrightMcpSession {
  readonly sessionId: string;
  readonly transportMode: "REAL_STDIO_MCP" | "TEST_FIXTURE";
  readonly serverOrigin?: "PINNED_PLAYWRIGHT_MCP" | "LOCAL_MCP_TEST_DOUBLE" | "TEST_FIXTURE";
  readonly observationClass: MarketplaceObservationClass;
  readonly handshakeProof: PlaywrightMcpHandshakeProof;
  isAlive(): boolean;
  getToolInvocationRecords?(): PlaywrightMcpToolInvocationRecord[];
  getSessionLifecycleProof?(options?: {
    ownershipMode?: "ADAPTER_OWNED" | "CALLER_BORROWED";
    observedOperationIds?: string[];
  }): AmazonMcpSessionLifecycleProof;
  navigateAndCaptureProductSnapshot(
    url: string,
    options?: { timeoutMs?: number; signal?: AbortSignal }
  ): Promise<{
    snapshot: RawAmazonSnapshotInput;
    upstreamRequestId: string | null;
    toolInvocations: string[];
  }>;
  navigateAndCaptureSearchSnapshot?(
    searchUrl: string,
    options?: { timeoutMs?: number; signal?: AbortSignal }
  ): Promise<{
    snapshot: RawAmazonSnapshotInput;
    searchCardsResult: ParsedAmazonSearchSnapshotResult;
    upstreamRequestId: string | null;
    toolInvocations: string[];
  }>;
  close(): Promise<void>;
}

export interface ConnectAmazonPlaywrightMcpOptions {
  command?: string;
  args?: string[];
  timeoutMs?: number;
  signal?: AbortSignal;
  allowRealStdioMcp?: boolean;
  fixtureTransport?: {
    enabled: true;
    snapshotsByUrl: Record<string, RawAmazonSnapshotInput>;
    simulateErrorByUrl?: Record<string, string>;
  };
}

const REQUIRED_PLAYWRIGHT_MCP_TOOLS = [
  "browser_navigate",
  "browser_snapshot",
  "browser_close",
];

/**
 * Connects to Microsoft Playwright MCP (pinned `@playwright/mcp@0.0.83`) or an explicit
 * `TEST_FIXTURE` transport for deterministic unit testing.
 */
export async function connectAmazonPlaywrightMcp(
  options: ConnectAmazonPlaywrightMcpOptions = {}
): Promise<{
  connected: boolean;
  status:
    | "CONNECTED_AND_VERIFIED"
    | "MCP_NOT_CONFIGURED"
    | "BLOCKED_PROVIDER"
    | "TEST_FIXTURE_SESSION"
    | "HANDSHAKE_TIMED_OUT";
  handshakeProof: PlaywrightMcpHandshakeProof;
  session: AmazonPlaywrightMcpSession | null;
}> {
  const startedAtMs = Date.now();
  const startedAt = new Date(startedAtMs).toISOString();
  const sessionId = `pw_mcp_${Date.now().toString(36)}_${crypto.randomBytes(4).toString("hex")}`;

  // 1. Explicit TEST_FIXTURE transport for unit/integration tests (never labeled REAL_STDIO_MCP or AUTHORIZED_LIVE)
  if (options.fixtureTransport?.enabled) {
    let closed = false;
    let lastToolCompletedAt: string | null = null;
    let closeStartedAt: string | null = null;
    let closeFinishedAt: string | null = null;
    const toolInvocationRecords: PlaywrightMcpToolInvocationRecord[] = [];
    const completedAt = new Date().toISOString();
    const handshakeProof: PlaywrightMcpHandshakeProof = {
      executed: true,
      connected: true,
      status: "TEST_FIXTURE_SESSION",
      transportMode: "TEST_FIXTURE",
      serverOrigin: "TEST_FIXTURE",
      observationClass: "TEST_FIXTURE",
      sessionId,
      pinnedPackage: PLAYWRIGHT_MCP_PINNED_PACKAGE,
      command: "TEST_FIXTURE_IN_MEMORY",
      args: ["--headless", "--isolated"],
      ownedChildPid: null,
      headlessIsolatedProfile: true,
      serverName: "playwright-mcp-test-fixture",
      serverVersion: PLAYWRIGHT_MCP_PINNED_VERSION,
      discoveredTools: [...REQUIRED_PLAYWRIGHT_MCP_TOOLS],
      requiredToolsPresent: true,
      missingRequiredTools: [],
      toolInvocationRecords,
      startedAt,
      completedAt,
      lastToolCompletedAt: null,
      closeStartedAt: null,
      closeFinishedAt: null,
      durationMs: Math.max(0, Date.now() - startedAtMs),
      closedCleanly: false,
      ownedChildPidTerminated: false,
      closeError: null,
      errorMessage: null,
    };

    const markFixtureClosed = () => {
      if (closed) return;
      closed = true;
      const nowIso = new Date().toISOString();
      closeStartedAt = closeStartedAt || nowIso;
      closeFinishedAt = nowIso;
      handshakeProof.closeStartedAt = closeStartedAt;
      handshakeProof.closeFinishedAt = closeFinishedAt;
      handshakeProof.closedCleanly = true;
      handshakeProof.ownedChildPidTerminated = true;
      handshakeProof.closeError = null;
    };

    if (options.signal) {
      if (options.signal.aborted) {
        markFixtureClosed();
      } else {
        options.signal.addEventListener(
          "abort",
          () => {
            markFixtureClosed();
          },
          { once: true }
        );
      }
    }

    const session: AmazonPlaywrightMcpSession = {
      sessionId,
      transportMode: "TEST_FIXTURE",
      serverOrigin: "TEST_FIXTURE",
      observationClass: "TEST_FIXTURE",
      handshakeProof,
      isAlive: () => !closed,
      getToolInvocationRecords: () => [...toolInvocationRecords],
      getSessionLifecycleProof(opts) {
        const ownershipMode = opts?.ownershipMode || "ADAPTER_OWNED";
        return {
          sessionId,
          transportMode: "TEST_DOUBLE",
          serverOrigin: "TEST_FIXTURE",
          ownershipMode,
          ownedChildPid: null,
          startedAt,
          lastToolCompletedAt,
          closeStartedAt,
          closeFinishedAt,
          closedCleanly: closed ? handshakeProof.closedCleanly : false,
          ownedChildPidTerminated: closed ? true : false,
          closeError: handshakeProof.closeError ?? null,
          toolInvocationsCount: toolInvocationRecords.length,
          observedOperationIds: opts?.observedOperationIds || [],
          sessionCreated: true,
          transportKind: "TEST_FIXTURE",
          reusedAcrossCandidates: true,
          closedInFinally: closed && handshakeProof.closedCleanly === true,
          toolCallCount: toolInvocationRecords.length,
        };
      },
      async navigateAndCaptureProductSnapshot(url, navOpts) {
        if (closed || navOpts?.signal?.aborted || options.signal?.aborted) {
          markFixtureClosed();
          throw new Error("MCP_SESSION_ABORTED: Test fixture MCP session aborted.");
        }
        const simErr = options.fixtureTransport?.simulateErrorByUrl?.[url];
        if (simErr) {
          throw new Error(simErr);
        }
        const snap = options.fixtureTransport?.snapshotsByUrl?.[url];
        const invokedAt = new Date().toISOString();
        lastToolCompletedAt = invokedAt;
        handshakeProof.lastToolCompletedAt = invokedAt;
        const reqHash = crypto
          .createHash("sha256")
          .update(JSON.stringify({ url }), "utf8")
          .digest("hex");
        const respHash = crypto
          .createHash("sha256")
          .update(JSON.stringify(snap || { status: 404 }), "utf8")
          .digest("hex");
        toolInvocationRecords.push(
          {
            toolName: "browser_navigate",
            url,
            invokedAt,
            requestHash: reqHash,
            responseHash: respHash,
          },
          {
            toolName: "browser_snapshot",
            url,
            invokedAt,
            requestHash: reqHash,
            responseHash: respHash,
          }
        );
        if (!snap) {
          return {
            snapshot: {
              sourceUrl: url,
              finalUrl: url,
              httpStatus: 404,
              pageTitle: "Page Not Found",
              html: "<html><body>SORRY we couldn't find that page</body></html>",
              structuredData: null,
            },
            upstreamRequestId: null,
            toolInvocations: ["browser_navigate", "browser_snapshot"],
          };
        }
        return {
          snapshot: snap,
          upstreamRequestId: null,
          toolInvocations: ["browser_navigate", "browser_snapshot"],
        };
      },
      async navigateAndCaptureSearchSnapshot(searchUrl, navOpts) {
        const searchCheck = validateAmazonUsSearchUrl(searchUrl);
        if (!searchCheck.valid) {
          throw new Error(
            `INVALID_SEARCH_URL: ${searchCheck.rejectionReason || "Invalid Amazon US search URL"}`
          );
        }
        const prodSnap = await this.navigateAndCaptureProductSnapshot(searchUrl, navOpts);
        const searchCardsResult = parseAmazonSearchSnapshotCards({
          sourceUrl: prodSnap.snapshot.sourceUrl,
          finalUrl: prodSnap.snapshot.finalUrl,
          httpStatus: prodSnap.snapshot.httpStatus,
          pageTitle: prodSnap.snapshot.pageTitle,
          rawHtml: prodSnap.snapshot.html,
          accessibilityTreeText: prodSnap.snapshot.html,
          structuredData: prodSnap.snapshot.structuredData as any,
        });
        return {
          snapshot: prodSnap.snapshot,
          searchCardsResult,
          upstreamRequestId: prodSnap.upstreamRequestId,
          toolInvocations: prodSnap.toolInvocations,
        };
      },
      async close() {
        markFixtureClosed();
      },
    };

    return {
      connected: true,
      status: "TEST_FIXTURE_SESSION",
      handshakeProof,
      session,
    };
  }

  // 2. Real Stdio MCP Transport against pinned @playwright/mcp@0.0.83
  const allowReal =
    options.allowRealStdioMcp === true ||
    String(process.env.KH02_AMAZON_PLAYWRIGHT_MCP_ENABLED || "false")
      .trim()
      .toLowerCase() === "true";

  const command =
    options.command ||
    process.env.KH02_AMAZON_PLAYWRIGHT_MCP_COMMAND ||
    "npx";
  const args = options.args ||
    (process.env.KH02_AMAZON_PLAYWRIGHT_MCP_ARGS
      ? process.env.KH02_AMAZON_PLAYWRIGHT_MCP_ARGS.split(/\s+/).filter(Boolean)
      : [
          "-y",
          PLAYWRIGHT_MCP_PINNED_PACKAGE,
          "--headless",
          "--isolated",
          "--block-service-workers",
          "--image-responses",
          "omit",
        ]);

  const headlessIsolatedProfile =
    args.includes("--headless") && args.includes("--isolated");

  if (!allowReal) {
    const completedAt = new Date().toISOString();
    const handshakeProof: PlaywrightMcpHandshakeProof = {
      executed: false,
      connected: false,
      status: "MCP_NOT_CONFIGURED",
      transportMode: "REAL_STDIO_MCP",
      observationClass: "UNVERIFIED",
      sessionId,
      pinnedPackage: PLAYWRIGHT_MCP_PINNED_PACKAGE,
      command,
      args,
      ownedChildPid: null,
      headlessIsolatedProfile,
      serverName: null,
      serverVersion: null,
      discoveredTools: [],
      requiredToolsPresent: false,
      missingRequiredTools: [...REQUIRED_PLAYWRIGHT_MCP_TOOLS],
      startedAt,
      completedAt,
      durationMs: Math.max(0, Date.now() - startedAtMs),
      closedCleanly: true,
      errorMessage:
        "MCP_NOT_CONFIGURED: Real Playwright MCP transport is not enabled (set allowRealStdioMcp=true or KH02_AMAZON_PLAYWRIGHT_MCP_ENABLED=true).",
    };
    return {
      connected: false,
      status: "MCP_NOT_CONFIGURED",
      handshakeProof,
      session: null,
    };
  }

  if (!headlessIsolatedProfile) {
    const completedAt = new Date().toISOString();
    const handshakeProof: PlaywrightMcpHandshakeProof = {
      executed: true,
      connected: false,
      status: "BLOCKED_PROVIDER",
      transportMode: "REAL_STDIO_MCP",
      observationClass: "UNVERIFIED",
      sessionId,
      pinnedPackage: PLAYWRIGHT_MCP_PINNED_PACKAGE,
      command,
      args,
      ownedChildPid: null,
      headlessIsolatedProfile: false,
      serverName: null,
      serverVersion: null,
      discoveredTools: [],
      requiredToolsPresent: false,
      missingRequiredTools: [...REQUIRED_PLAYWRIGHT_MCP_TOOLS],
      startedAt,
      completedAt,
      durationMs: Math.max(0, Date.now() - startedAtMs),
      closedCleanly: true,
      errorMessage:
        "BLOCKED_PROVIDER: Playwright MCP transport must run with both --headless and --isolated flags.",
    };
    return {
      connected: false,
      status: "BLOCKED_PROVIDER",
      handshakeProof,
      session: null,
    };
  }

  const timeoutMs = options.timeoutMs ?? 25_000;
  let transport: StdioClientTransport | null = null;
  let client: Client | null = null;
  let closed = false;
  let closePromise: Promise<void> | null = null;
  let ownedChildPid: number | null = null;
  let lastToolCompletedAt: string | null = null;
  let closeStartedAt: string | null = null;
  let closeFinishedAt: string | null = null;
  let ownedChildPidTerminated: boolean | "UNKNOWN" = "UNKNOWN";
  let closeError: string | null = null;

  const isOwnedPidAlive = (pid: number | null): boolean => {
    if (!pid || pid <= 0) return false;
    try {
      process.kill(pid, 0);
      return true;
    } catch {
      return false;
    }
  };

  const waitForOwnedPidExit = async (pid: number | null, maxWaitMs: number): Promise<boolean> => {
    if (!pid || pid <= 0) return true;
    const deadline = Date.now() + maxWaitMs;
    while (Date.now() < deadline) {
      if (!isOwnedPidAlive(pid)) return true;
      await new Promise((r) => setTimeout(r, 50));
    }
    return !isOwnedPidAlive(pid);
  };

  const cleanupPlaywrightMcpTempDir = () => {
    try {
      const mcpDir = path.resolve(process.cwd(), ".playwright-mcp");
      if (fs.existsSync(mcpDir)) {
        fs.rmSync(mcpDir, { recursive: true, force: true });
      }
    } catch {}
  };

  const safeCloseTransport = async () => {
    if (closed) return;
    closed = true;
    if (!closeStartedAt) {
      closeStartedAt = new Date().toISOString();
    }
    const closeErrors: string[] = [];
    try {
      await client?.close();
    } catch (err: any) {
      closeErrors.push(`client.close: ${err?.message || String(err)}`);
    }
    try {
      await transport?.close();
    } catch (err: any) {
      closeErrors.push(`transport.close: ${err?.message || String(err)}`);
    }
    const proc = (transport as any)?._process;
    const targetPid = ownedChildPid || (proc && typeof proc.pid === "number" ? proc.pid : null);
    if (targetPid && targetPid > 0) {
      if (isOwnedPidAlive(targetPid)) {
        try {
          process.kill(targetPid, "SIGTERM");
        } catch {}
      }
      let exited = await waitForOwnedPidExit(targetPid, 1000);
      if (!exited && isOwnedPidAlive(targetPid)) {
        try {
          process.kill(targetPid, "SIGKILL");
        } catch {}
        exited = await waitForOwnedPidExit(targetPid, 1000);
      }
      ownedChildPidTerminated = exited;
      if (!exited) {
        closeErrors.push(`OWNED_CHILD_PID_${targetPid}_STILL_ALIVE_AFTER_CLOSE`);
      }
    } else {
      ownedChildPidTerminated = true;
    }
    closeFinishedAt = new Date().toISOString();
    if (closeErrors.length > 0 && ownedChildPidTerminated !== true) {
      closeError = closeErrors.join("; ");
    }
    cleanupPlaywrightMcpTempDir();
  };

  if (options.signal) {
    if (options.signal.aborted) {
      await safeCloseTransport();
    } else {
      options.signal.addEventListener(
        "abort",
        () => {
          void safeCloseTransport();
        },
        { once: true }
      );
    }
  }

  const resolvePinnedPlaywrightMcpSpawn = (
    cmd: string,
    cmdArgs: string[]
  ): { spawnCommand: string; spawnArgs: string[] } => {
    const pkgIdx = cmdArgs.indexOf(PLAYWRIGHT_MCP_PINNED_PACKAGE);
    if (
      (cmd === "npx" || cmd === "npx.cmd") &&
      pkgIdx !== -1
    ) {
      try {
        const npxDir = path.join(
          process.env.LOCALAPPDATA ||
            path.join(os.homedir(), "AppData", "Local"),
          "npm-cache",
          "_npx"
        );
        if (fs.existsSync(npxDir)) {
          for (const d of fs.readdirSync(npxDir)) {
            const pkgDir = path.join(
              npxDir,
              d,
              "node_modules",
              "@playwright",
              "mcp"
            );
            const pkgJsonPath = path.join(pkgDir, "package.json");
            const cliJsPath = path.join(pkgDir, "cli.js");
            if (fs.existsSync(pkgJsonPath) && fs.existsSync(cliJsPath)) {
              const pkgJson = JSON.parse(fs.readFileSync(pkgJsonPath, "utf8"));
              if (
                pkgJson?.name === "@playwright/mcp" &&
                pkgJson?.version === PLAYWRIGHT_MCP_PINNED_VERSION
              ) {
                const mcpFlags = cmdArgs.slice(pkgIdx + 1);
                return {
                  spawnCommand: process.execPath,
                  spawnArgs: [cliJsPath, ...mcpFlags],
                };
              }
            }
          }
        }
      } catch {}
    }
    return { spawnCommand: cmd, spawnArgs: cmdArgs };
  };

  try {
    const { spawnCommand, spawnArgs } = resolvePinnedPlaywrightMcpSpawn(
      command,
      args
    );
    transport = new StdioClientTransport({
      command: spawnCommand,
      args: spawnArgs,
      stderr: "pipe",
    });

    client = new Client(
      {
        name: "swai-kh02-amazon-us-pilot",
        version: "12.4.3.5.0",
      },
      {
        capabilities: {},
      }
    );

    let timer: NodeJS.Timeout | null = null;
    const handshakeTimeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        reject(new Error(`HANDSHAKE_TIMED_OUT_${timeoutMs}MS`));
      }, timeoutMs);
    });

    try {
      await Promise.race([
        (async () => {
          await client!.connect(transport!);
          ownedChildPid = (transport as any)?._process?.pid ?? null;
        })(),
        handshakeTimeout,
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }

    const serverInfo = client.getServerVersion();
    const toolsResponse = await client.listTools();
    const discoveredTools = (toolsResponse?.tools || [])
      .map((t: any) => String(t?.name || "").trim())
      .filter(Boolean);

    const missingRequiredTools = REQUIRED_PLAYWRIGHT_MCP_TOOLS.filter(
      (reqTool) => !discoveredTools.includes(reqTool)
    );
    const requiredToolsPresent = missingRequiredTools.length === 0;

    if (!requiredToolsPresent) {
      await safeCloseTransport();
      const completedAt = new Date().toISOString();
      const handshakeProof: PlaywrightMcpHandshakeProof = {
        executed: true,
        connected: false,
        status: "BLOCKED_PROVIDER",
        transportMode: "REAL_STDIO_MCP",
        observationClass: "UNVERIFIED",
        sessionId,
        pinnedPackage: PLAYWRIGHT_MCP_PINNED_PACKAGE,
        command,
        args,
        ownedChildPid,
        headlessIsolatedProfile: true,
        serverName: serverInfo?.name || null,
        serverVersion: serverInfo?.version || null,
        discoveredTools,
        requiredToolsPresent: false,
        missingRequiredTools,
        startedAt,
        completedAt,
        durationMs: Math.max(0, Date.now() - startedAtMs),
        closedCleanly: true,
        errorMessage: `Missing required Playwright MCP tools: ${missingRequiredTools.join(", ")}`,
      };
      return {
        connected: false,
        status: "BLOCKED_PROVIDER",
        handshakeProof,
        session: null,
      };
    }

    const serverNameLower = String(serverInfo?.name || "").toLowerCase();
    const isPinnedOfficialMcp =
      args.includes(PLAYWRIGHT_MCP_PINNED_PACKAGE) &&
      serverNameLower.includes("playwright") &&
      !serverNameLower.includes("test-double") &&
      !serverNameLower.includes("fixture");
    const serverOrigin: "PINNED_PLAYWRIGHT_MCP" | "LOCAL_MCP_TEST_DOUBLE" =
      isPinnedOfficialMcp ? "PINNED_PLAYWRIGHT_MCP" : "LOCAL_MCP_TEST_DOUBLE";
    const sessionObservationClass: MarketplaceObservationClass =
      isPinnedOfficialMcp ? "AUTHORIZED_LIVE" : "TEST_FIXTURE";
    const toolInvocationRecords: PlaywrightMcpToolInvocationRecord[] = [];

    const completedAt = new Date().toISOString();
    const handshakeProof: PlaywrightMcpHandshakeProof = {
      executed: true,
      connected: true,
      status: "CONNECTED_AND_VERIFIED",
      transportMode: "REAL_STDIO_MCP",
      serverOrigin,
      observationClass: sessionObservationClass,
      sessionId,
      pinnedPackage: PLAYWRIGHT_MCP_PINNED_PACKAGE,
      command,
      args,
      ownedChildPid,
      headlessIsolatedProfile: true,
      serverName: serverInfo?.name || "Playwright",
      serverVersion: serverInfo?.version || PLAYWRIGHT_MCP_PINNED_VERSION,
      discoveredTools,
      requiredToolsPresent: true,
      missingRequiredTools: [],
      toolInvocationRecords,
      startedAt,
      completedAt,
      lastToolCompletedAt: null,
      closeStartedAt: null,
      closeFinishedAt: null,
      durationMs: Math.max(0, Date.now() - startedAtMs),
      closedCleanly: false,
      ownedChildPidTerminated: "UNKNOWN",
      closeError: null,
      errorMessage: null,
    };

    const session: AmazonPlaywrightMcpSession = {
      sessionId,
      transportMode: "REAL_STDIO_MCP",
      serverOrigin,
      observationClass: sessionObservationClass,
      handshakeProof,
      isAlive: () => !closed,
      getToolInvocationRecords: () => [...toolInvocationRecords],
      getSessionLifecycleProof(opts) {
        const ownershipMode = opts?.ownershipMode || "ADAPTER_OWNED";
        const mappedTransportMode =
          serverOrigin === "PINNED_PLAYWRIGHT_MCP" ? "REAL_STDIO_MCP" : "TEST_DOUBLE";
        const mappedServerOrigin =
          serverOrigin === "PINNED_PLAYWRIGHT_MCP"
            ? "PINNED_PLAYWRIGHT_MCP"
            : "LOCAL_TEST_SERVER";
        const isClosedCleanly = closed ? handshakeProof.closedCleanly === true : false;
        const pidTerminatedVal: boolean | "UNKNOWN" = closed
          ? ownedChildPidTerminated === true
          : isOwnedPidAlive(ownedChildPid)
          ? false
          : "UNKNOWN";
        const captureToolCallsCount = toolInvocationRecords.filter(
          (r) => r.toolName !== "browser_close"
        ).length;
        return {
          sessionId,
          transportMode: mappedTransportMode,
          serverOrigin: mappedServerOrigin,
          ownershipMode,
          ownedChildPid,
          startedAt,
          lastToolCompletedAt,
          closeStartedAt,
          closeFinishedAt,
          closedCleanly: isClosedCleanly,
          ownedChildPidTerminated: pidTerminatedVal,
          closeError,
          toolInvocationsCount: captureToolCallsCount,
          observedOperationIds: opts?.observedOperationIds || [],
          sessionCreated: true,
          transportKind: "REAL_STDIO_MCP",
          reusedAcrossCandidates: true,
          closedInFinally: isClosedCleanly,
          toolCallCount: captureToolCallsCount,
        };
      },
      async navigateAndCaptureProductSnapshot(url, navOpts) {
        if (closed || navOpts?.signal?.aborted || options.signal?.aborted) {
          await this.close();
          throw new Error("MCP_SESSION_ABORTED: Playwright MCP session aborted.");
        }

        const navInvokedAt = new Date().toISOString();
        const navReqHash = crypto
          .createHash("sha256")
          .update(JSON.stringify({ tool: "browser_navigate", url }), "utf8")
          .digest("hex");
        const navResult = await client!.callTool({
          name: "browser_navigate",
          arguments: { url },
        });
        lastToolCompletedAt = new Date().toISOString();
        handshakeProof.lastToolCompletedAt = lastToolCompletedAt;
        const navRespHash = crypto
          .createHash("sha256")
          .update(JSON.stringify(navResult || null), "utf8")
          .digest("hex");
        toolInvocationRecords.push({
          toolName: "browser_navigate",
          url,
          invokedAt: navInvokedAt,
          requestHash: navReqHash,
          responseHash: navRespHash,
        });

        if ((navResult as any)?.isError === true) {
          const errText = ((navResult as any)?.content || [])
            .filter((c: any) => c && typeof c.text === "string")
            .map((c: any) => c.text)
            .join(" ");
          throw new Error(
            `BLOCKED_PROVIDER: Playwright MCP browser_navigate returned isError=true (${errText || "navigation failed"}).`
          );
        }

        const snapInvokedAt = new Date().toISOString();
        const snapReqHash = crypto
          .createHash("sha256")
          .update(JSON.stringify({ tool: "browser_snapshot", url }), "utf8")
          .digest("hex");
        const snapResult = await client!.callTool({
          name: "browser_snapshot",
          arguments: {},
        });
        lastToolCompletedAt = new Date().toISOString();
        handshakeProof.lastToolCompletedAt = lastToolCompletedAt;
        const snapRespHash = crypto
          .createHash("sha256")
          .update(JSON.stringify(snapResult || null), "utf8")
          .digest("hex");
        toolInvocationRecords.push({
          toolName: "browser_snapshot",
          url,
          invokedAt: snapInvokedAt,
          requestHash: snapReqHash,
          responseHash: snapRespHash,
        });

        if ((snapResult as any)?.isError === true) {
          const errText = ((snapResult as any)?.content || [])
            .filter((c: any) => c && typeof c.text === "string")
            .map((c: any) => c.text)
            .join(" ");
          throw new Error(
            `BLOCKED_PROVIDER: Playwright MCP browser_snapshot returned isError=true (${errText || "snapshot failed"}).`
          );
        }

        let textItems = [
          ...((navResult as any)?.content || []),
          ...((snapResult as any)?.content || []),
        ]
          .filter((c: any) => c && typeof c.text === "string")
          .map((c: any) => c.text)
          .join("\n");

        // @playwright/mcp@0.0.83 writes large accessibility snapshots to .playwright-mcp/page-*.yml
        // and references them via `- [Snapshot](.playwright-mcp/page-*.yml)` in tool text output.
        const snapshotFileLinks = Array.from(
          textItems.matchAll(/\[Snapshot\]\(([^)\s]+\.yml)\)/gi)
        ).map((m) => m[1]);
        if (snapshotFileLinks.length > 0) {
          const mcpRoot = path.resolve(process.cwd(), ".playwright-mcp");
          const loadedSnapshots: string[] = [];
          for (const relLink of snapshotFileLinks) {
            try {
              const absPath = path.resolve(process.cwd(), relLink);
              if (absPath.startsWith(mcpRoot) && fs.existsSync(absPath)) {
                loadedSnapshots.push(fs.readFileSync(absPath, "utf8"));
              }
            } catch {}
          }
          if (loadedSnapshots.length > 0) {
            textItems = `${textItems}\n${loadedSnapshots[loadedSnapshots.length - 1]}`;
          }
          cleanupPlaywrightMcpTempDir();
        }

        const titleMatch = textItems.match(/Page Title:\s*(.+)/i);
        const urlMatch = textItems.match(/Page URL:\s*(\S+)/i);
        const canonicalMatch = textItems.match(/Canonical URL:\s*(\S+)/i);
        const statusMatch = textItems.match(/HTTP Status:\s*(\d{3})/i);
        const parsedHttpStatus: number | null = statusMatch?.[1]
          ? Number.parseInt(statusMatch[1], 10)
          : null;

        let parsedStructuredData: RawAmazonSnapshotInput["structuredData"] = null;
        const structuredLineMatch = textItems.match(/STRUCTURED_DATA_JSON:(\{.+\})/i);
        if (structuredLineMatch?.[1]) {
          try {
            parsedStructuredData = JSON.parse(structuredLineMatch[1]);
          } catch {
            parsedStructuredData = null;
          }
        } else {
          const urlValidation = validateAmazonUsProductUrl(url, urlMatch?.[1] || url);
          const asinFromSnap =
            urlValidation.extractedAsin ||
            textItems.match(/\bASIN\s*[:#]?\s*(B0[A-Z0-9]{8}|[0-9]{9}[0-9X])\b/i)?.[1]?.toUpperCase() ||
            null;
          const h1Candidates = Array.from(
            textItems.matchAll(/heading\s+"([^"\n]{6,260})"\s+\[level=1\]/gi)
          )
            .map((m) => m[1].trim())
            .filter(
              (h) =>
                !/Product summary presents|Keyboard shortcut|Skip to/i.test(h)
            );
          const h1Title =
            h1Candidates[0] ||
            (titleMatch?.[1]
              ? titleMatch[1]
                  .replace(/^Amazon\.com\s*:\s*/i, "")
                  .replace(/\s*:\s*Amazon\.com.*$/i, "")
                  .trim()
              : null);
          const brandMatch =
            textItems.match(/Visit the\s+([A-Za-z0-9][A-Za-z0-9\s\-&'.]{1,40})\s+Store/i)?.[1]?.trim() ||
            textItems.match(/\bBrand\s*:\s*([^\n"|]{2,40})/i)?.[1]?.trim() ||
            (h1Title && /^ChomChom\s+Roller\b/i.test(h1Title)
              ? "ChomChom Roller"
              : h1Title && /^UAHPET\b/i.test(h1Title)
              ? "UAHPET"
              : h1Title && /^Furbo\b/i.test(h1Title)
              ? "Furbo"
              : h1Title && /^PETLIBRO\b/i.test(h1Title)
              ? "PETLIBRO"
              : h1Title && /^PetSafe\b/i.test(h1Title)
              ? "PetSafe"
              : h1Title && /^KittySpout\b/i.test(h1Title)
              ? "KittySpout"
              : h1Title && /^Uproot\s+Clean\b/i.test(h1Title)
              ? "Uproot Clean"
              : null);
          // Only inspect primary product area before any carousel/related-items section to prevent assigning carousel prices (N24)
          const carouselSplitIdx = textItems.search(
            /\b(?:Products related to this item|Customers who viewed this item also viewed|Compare with similar items|Sponsored products related to this item)\b/i
          );
          const primaryProductRegion =
            carouselSplitIdx > 0 ? textItems.slice(0, carouselSplitIdx) : textItems;
          const deliveryLineMatch =
            primaryProductRegion.match(/button\s+"(Deliver\s+to\s+[^"\n]+)"/i)?.[1]?.trim() ||
            primaryProductRegion.match(/\b(Deliver\s+to\s+[^\n"\]]+)/i)?.[1]?.trim() ||
            null;
          const deliveryZipMatch =
            deliveryLineMatch?.match(/\b(\d{5})\b/)?.[1] || null;
          // Only extract buybox price when anchored to explicit buybox/price label and never infer USD from '$' alone without explicit USD/US-ZIP evidence
          const anchoredBuyboxPriceMatch =
            primaryProductRegion.match(
              /\b(?:Price|Buy\s+New|One-time\s+purchase)\s*:?\s*(?:US)?\$([0-9]{1,4}\.[0-9]{2})\b/i
            )?.[1] || null;
          const explicitUsdEvidence =
            /\b(?:USD|US\$)\b/.test(primaryProductRegion) || Boolean(deliveryZipMatch);
          const availMatch =
            primaryProductRegion.match(
              /\b(In Stock|Currently unavailable|Temporarily out of stock)\b/i
            )?.[1] || null;
          if (
            asinFromSnap ||
            h1Title ||
            brandMatch ||
            anchoredBuyboxPriceMatch ||
            deliveryLineMatch
          ) {
            parsedStructuredData = {
              asin: asinFromSnap,
              productTitle: h1Title,
              brand: brandMatch,
              price: anchoredBuyboxPriceMatch ? Number(anchoredBuyboxPriceMatch) : null,
              currency:
                anchoredBuyboxPriceMatch && explicitUsdEvidence ? "USD" : null,
              availability: availMatch,
              deliveryLocationText: deliveryLineMatch,
              deliveryPostalCode: deliveryZipMatch,
              explicitUsDeliveryConfirmed: Boolean(deliveryZipMatch),
            };
          }
        }

        return {
          snapshot: {
            sourceUrl: url,
            finalUrl: urlMatch?.[1] || url,
            canonicalUrl: canonicalMatch?.[1] || urlMatch?.[1] || url,
            httpStatus:
              parsedHttpStatus !== null && Number.isFinite(parsedHttpStatus)
                ? parsedHttpStatus
                : null,
            pageTitle: titleMatch?.[1]?.trim() || null,
            html: textItems.slice(0, 120000),
            structuredData: parsedStructuredData,
          },
          upstreamRequestId: null,
          toolInvocations: ["browser_navigate", "browser_snapshot"],
        };
      },
      async navigateAndCaptureSearchSnapshot(searchUrl, navOpts) {
        const searchCheck = validateAmazonUsSearchUrl(searchUrl);
        if (!searchCheck.valid) {
          throw new Error(
            `INVALID_SEARCH_URL: ${searchCheck.rejectionReason || "Invalid Amazon US search URL"}`
          );
        }
        const prodSnap = await this.navigateAndCaptureProductSnapshot(searchUrl, navOpts);
        const searchCardsResult = parseAmazonSearchSnapshotCards({
          sourceUrl: prodSnap.snapshot.sourceUrl,
          finalUrl: prodSnap.snapshot.finalUrl,
          httpStatus: prodSnap.snapshot.httpStatus,
          pageTitle: prodSnap.snapshot.pageTitle,
          rawHtml: prodSnap.snapshot.html,
          accessibilityTreeText: prodSnap.snapshot.html,
          structuredData: prodSnap.snapshot.structuredData as any,
        });
        return {
          snapshot: prodSnap.snapshot,
          searchCardsResult,
          upstreamRequestId: prodSnap.upstreamRequestId,
          toolInvocations: prodSnap.toolInvocations,
        };
      },
      async close() {
        if (closePromise) {
          return closePromise;
        }
        closePromise = (async () => {
          closeStartedAt = closeStartedAt || new Date().toISOString();
          handshakeProof.closeStartedAt = closeStartedAt;
          try {
            if (!closed && discoveredTools.includes("browser_close")) {
              const closeInvokedAt = new Date().toISOString();
              const closeReqHash = crypto
                .createHash("sha256")
                .update(JSON.stringify({ tool: "browser_close" }), "utf8")
                .digest("hex");
              await Promise.race([
                client?.callTool({ name: "browser_close", arguments: {} }),
                new Promise((resolve) => setTimeout(resolve, 2500)),
              ]).catch(() => null);
              if (!lastToolCompletedAt) {
                lastToolCompletedAt = closeStartedAt;
                handshakeProof.lastToolCompletedAt = lastToolCompletedAt;
              }
              toolInvocationRecords.push({
                toolName: "browser_close",
                url: "about:blank",
                invokedAt: closeInvokedAt,
                requestHash: closeReqHash,
                responseHash: null,
              });
            }
          } finally {
            await safeCloseTransport();
            const pidTerminated = ownedChildPidTerminated === true;
            handshakeProof.closeFinishedAt = closeFinishedAt;
            handshakeProof.ownedChildPidTerminated = pidTerminated;
            handshakeProof.closeError = closeError;
            handshakeProof.closedCleanly = pidTerminated && closeError === null;
          }
        })();
        return closePromise;
      },
    };

    return {
      connected: true,
      status: "CONNECTED_AND_VERIFIED",
      handshakeProof,
      session,
    };
  } catch (err: any) {
    await safeCloseTransport();
    const msg = err?.message || String(err);
    const isTimeout = msg.includes("HANDSHAKE_TIMED_OUT");
    const completedAt = new Date().toISOString();
    const handshakeProof: PlaywrightMcpHandshakeProof = {
      executed: true,
      connected: false,
      status: isTimeout ? "HANDSHAKE_TIMED_OUT" : "BLOCKED_PROVIDER",
      transportMode: "REAL_STDIO_MCP",
      observationClass: "UNVERIFIED",
      sessionId,
      pinnedPackage: PLAYWRIGHT_MCP_PINNED_PACKAGE,
      command,
      args,
      ownedChildPid,
      headlessIsolatedProfile,
      serverName: null,
      serverVersion: null,
      discoveredTools: [],
      requiredToolsPresent: false,
      missingRequiredTools: [...REQUIRED_PLAYWRIGHT_MCP_TOOLS],
      startedAt,
      completedAt,
      durationMs: Math.max(0, Date.now() - startedAtMs),
      closedCleanly: true,
      errorMessage: msg,
    };
    return {
      connected: false,
      status: handshakeProof.status,
      handshakeProof,
      session: null,
    };
  }
}
