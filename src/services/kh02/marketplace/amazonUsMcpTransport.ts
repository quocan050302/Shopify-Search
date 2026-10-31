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
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { MarketplaceObservationClass } from "./marketplaceEvidenceTypes";
import { RawAmazonSnapshotInput } from "./amazonUsIdentity";

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
  durationMs: number;
  closedCleanly: boolean;
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
  navigateAndCaptureProductSnapshot(
    url: string,
    options?: { timeoutMs?: number; signal?: AbortSignal }
  ): Promise<{
    snapshot: RawAmazonSnapshotInput;
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
      durationMs: Math.max(0, Date.now() - startedAtMs),
      closedCleanly: false,
      errorMessage: null,
    };

    if (options.signal) {
      if (options.signal.aborted) {
        closed = true;
        handshakeProof.closedCleanly = true;
      } else {
        options.signal.addEventListener(
          "abort",
          () => {
            closed = true;
            handshakeProof.closedCleanly = true;
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
      async navigateAndCaptureProductSnapshot(url, navOpts) {
        if (closed || navOpts?.signal?.aborted || options.signal?.aborted) {
          closed = true;
          handshakeProof.closedCleanly = true;
          throw new Error("MCP_SESSION_ABORTED: Test fixture MCP session aborted.");
        }
        const simErr = options.fixtureTransport?.simulateErrorByUrl?.[url];
        if (simErr) {
          throw new Error(simErr);
        }
        const snap = options.fixtureTransport?.snapshotsByUrl?.[url];
        const invokedAt = new Date().toISOString();
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
      async close() {
        closed = true;
        handshakeProof.closedCleanly = true;
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
  let ownedChildPid: number | null = null;

  const safeCloseTransport = async () => {
    if (closed) return;
    closed = true;
    try {
      await client?.close();
    } catch {}
    try {
      await transport?.close();
    } catch {}
    const proc = (transport as any)?._process;
    if (proc && typeof proc.pid === "number" && !proc.killed) {
      try {
        process.kill(proc.pid, "SIGTERM");
      } catch {}
    }
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

  try {
    transport = new StdioClientTransport({
      command,
      args,
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
      durationMs: Math.max(0, Date.now() - startedAtMs),
      closedCleanly: false,
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
      async navigateAndCaptureProductSnapshot(url, navOpts) {
        if (closed || navOpts?.signal?.aborted || options.signal?.aborted) {
          await safeCloseTransport();
          handshakeProof.closedCleanly = true;
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

        const snapInvokedAt = new Date().toISOString();
        const snapReqHash = crypto
          .createHash("sha256")
          .update(JSON.stringify({ tool: "browser_snapshot", url }), "utf8")
          .digest("hex");
        const snapResult = await client!.callTool({
          name: "browser_snapshot",
          arguments: {},
        });
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

        const textItems = [
          ...((navResult as any)?.content || []),
          ...((snapResult as any)?.content || []),
        ]
          .filter((c: any) => c && typeof c.text === "string")
          .map((c: any) => c.text)
          .join("\n");

        const titleMatch = textItems.match(/Page Title:\s*(.+)/i);
        const urlMatch = textItems.match(/Page URL:\s*(\S+)/i);
        const canonicalMatch = textItems.match(/Canonical URL:\s*(\S+)/i);
        const statusMatch = textItems.match(/HTTP Status:\s*(\d{3})/i);
        const parsedHttpStatus = statusMatch?.[1]
          ? Number.parseInt(statusMatch[1], 10)
          : 200;

        let parsedStructuredData: RawAmazonSnapshotInput["structuredData"] = null;
        const structuredLineMatch = textItems.match(/STRUCTURED_DATA_JSON:(\{.+\})/i);
        if (structuredLineMatch?.[1]) {
          try {
            parsedStructuredData = JSON.parse(structuredLineMatch[1]);
          } catch {
            parsedStructuredData = null;
          }
        }

        return {
          snapshot: {
            sourceUrl: url,
            finalUrl: urlMatch?.[1] || url,
            canonicalUrl: canonicalMatch?.[1] || urlMatch?.[1] || url,
            httpStatus: Number.isFinite(parsedHttpStatus) ? parsedHttpStatus : 200,
            pageTitle: titleMatch?.[1]?.trim() || null,
            html: textItems.slice(0, 12000),
            structuredData: parsedStructuredData,
          },
          upstreamRequestId: null,
          toolInvocations: ["browser_navigate", "browser_snapshot"],
        };
      },
      async close() {
        try {
          if (!closed && discoveredTools.includes("browser_close")) {
            await client?.callTool({ name: "browser_close", arguments: {} }).catch(() => null);
          }
        } finally {
          await safeCloseTransport();
          handshakeProof.closedCleanly = true;
        }
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
