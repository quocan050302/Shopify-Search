import { spawn, ChildProcess } from "child_process";
import crypto from "crypto";
import net from "net";
import path from "path";
import { assertSafeTestDatabase } from "@/lib/database/databaseSafety";

export interface SwaiTestServerOptions {
  databaseUrl: string;
  port?: number;
  mode?: "development" | "production";
  deploymentMode?: "LOCAL_DESKTOP" | "REMOTE";
  allowLocalBypass?: boolean;
  adminApiKey?: string;
  timeoutMs?: number;
  acceptanceRunId?: string;
  dbObservationToken?: string;
}

export interface SwaiTestServerHandle {
  baseUrl: string;
  host: "127.0.0.1";
  port: number;
  pid: number;
  databaseUrl: string;
  adminApiKey: string;
  acceptanceRunId?: string;
  dbObservationToken?: string;
  stop(): Promise<void>;
}

/**
 * Finds an available ephemeral TCP port on the loopback interface (127.0.0.1).
 */
export async function getAvailablePort(host: string = "127.0.0.1"): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.on("error", reject);
    server.listen(0, host, () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close(() => reject(new Error("Unable to obtain port from ephemeral server")));
        return;
      }
      const port = address.port;
      server.close((err) => {
        if (err) reject(err);
        else resolve(port);
      });
    });
  });
}

/**
 * Polls the running Next.js server until the /api/v1/health endpoint responds with HTTP 200.
 */
export async function waitForSwaiServer(
  baseUrl: string,
  serverProcess: ChildProcess,
  timeoutMs: number = 30000
): Promise<void> {
  const startTime = Date.now();
  const healthUrl = `${baseUrl}/api/v1/health`;

  while (Date.now() - startTime < timeoutMs) {
    if (serverProcess.exitCode !== null) {
      throw new Error(
        `Next.js test server process exited prematurely with code ${serverProcess.exitCode}`
      );
    }

    try {
      const res = await fetch(healthUrl, { method: "GET" });
      if (res.ok) {
        return;
      }
    } catch {
      // Server not yet accepting connections; continue polling
    }

    await new Promise((resolve) => setTimeout(resolve, 250));
  }

  throw new Error(`Timeout after ${timeoutMs}ms waiting for Next.js test server at ${baseUrl}`);
}

/**
 * Starts an isolated, dedicated Next.js server on 127.0.0.1 against the provided isolated test database.
 * Fails closed if the database URL violates test isolation rules.
 */
export async function startSwaiTestServer(
  options: SwaiTestServerOptions
): Promise<SwaiTestServerHandle> {
  const mode = options.mode || "production";
  const adminApiKey = options.adminApiKey || (options.allowLocalBypass ? "" : "test_admin_e2e_secret_token_12345");
  const timeoutMs = options.timeoutMs || 30000;

  // 1. Verify and enforce test database isolation
  const activeAppDb =
    process.env.DATABASE_URL && process.env.DATABASE_URL !== options.databaseUrl
      ? process.env.DATABASE_URL
      : "file:./dev.db";

  const testEnv: NodeJS.ProcessEnv = {
    ...process.env,
    NODE_ENV: mode,
    DATABASE_URL: activeAppDb,
    TEST_DATABASE_URL: options.databaseUrl,
    SWAI_DB_ROLE: "INTEGRATION_TEST",
    SWAI_TEST_ISOLATION: "strict",
  };
  assertSafeTestDatabase(options.databaseUrl, testEnv);

  // 2. Select port
  const port = options.port || (await getAvailablePort("127.0.0.1"));
  const host = "127.0.0.1";
  const baseUrl = `http://${host}:${port}`;

  // 3. Resolve Next.js binary
  const nextBinPath = require.resolve("next/dist/bin/next");

  const dbObservationToken =
    options.dbObservationToken ||
    (options.acceptanceRunId ? crypto.randomBytes(32).toString("hex") : undefined);

  const serverEnv: NodeJS.ProcessEnv = {
    ...process.env,
    PORT: String(port),
    HOSTNAME: host,
    HOST: host,
    NODE_ENV: mode,
    DATABASE_URL: activeAppDb,
    TEST_DATABASE_URL: options.databaseUrl,
    SWAI_DB_ROLE: "INTEGRATION_TEST",
    SWAI_TEST_ISOLATION: "strict",
    ...(options.acceptanceRunId ? { KH01_ACCEPTANCE_RUN_ID: options.acceptanceRunId } : {}),
    ...(dbObservationToken ? { KH01_DB_OBSERVATION_TOKEN: dbObservationToken } : {}),
  };

  if (options.allowLocalBypass) {
    serverEnv.SWAI_DEPLOYMENT_MODE = "LOCAL_DESKTOP";
    serverEnv.SWAI_LOCAL_DESKTOP = "true";
    serverEnv.SWAI_REMOTE_ACCESS = "false";
    delete serverEnv.SWAI_E2E_SERVER;
    delete serverEnv.SWAI_REQUIRE_AUTH;
    if (!options.adminApiKey) {
      delete serverEnv.ADMIN_API_KEY;
      delete serverEnv.SWAI_ADMIN_TOKEN;
      delete serverEnv.ADMIN_SECRET;
    }
  } else if (options.deploymentMode === "REMOTE") {
    serverEnv.SWAI_DEPLOYMENT_MODE = "REMOTE";
    serverEnv.SWAI_REMOTE_ACCESS = "true";
    delete serverEnv.SWAI_E2E_SERVER;
    if (!options.adminApiKey) {
      delete serverEnv.ADMIN_API_KEY;
      delete serverEnv.SWAI_ADMIN_TOKEN;
      delete serverEnv.ADMIN_SECRET;
    }
  } else {
    serverEnv.SWAI_E2E_SERVER = "true";
    if (adminApiKey) {
      serverEnv.ADMIN_API_KEY = adminApiKey;
      serverEnv.SWAI_ADMIN_TOKEN = adminApiKey;
      serverEnv.ADMIN_SECRET = adminApiKey;
    }
  }


  const serverArgs = [
    nextBinPath,
    mode === "production" ? "start" : "dev",
    "-p",
    String(port),
    "-H",
    host,
  ];

  let stdoutBuffer = "";
  let stderrBuffer = "";

  const serverProcess = spawn(process.execPath, serverArgs, {
    cwd: process.cwd(),
    env: serverEnv,
    stdio: ["ignore", "pipe", "pipe"],
  });

  serverProcess.stdout?.on("data", (chunk) => {
    stdoutBuffer += chunk.toString();
  });

  serverProcess.stderr?.on("data", (chunk) => {
    stderrBuffer += chunk.toString();
  });

  try {
    await waitForSwaiServer(baseUrl, serverProcess, timeoutMs);
  } catch (err: any) {
    serverProcess.kill("SIGKILL");
    throw new Error(
      `Failed to start SWAI test server: ${err.message}\nSTDOUT:\n${stdoutBuffer.slice(-2000)}\nSTDERR:\n${stderrBuffer.slice(-2000)}`
    );
  }

  const pid = serverProcess.pid || 0;

  const stop = async (): Promise<void> => {
    if (serverProcess.exitCode !== null) return;

    return new Promise((resolve) => {
      let resolved = false;
      const finish = () => {
        if (!resolved) {
          resolved = true;
          resolve();
        }
      };

      const forceKillTimer = setTimeout(() => {
        try {
          serverProcess.kill("SIGKILL");
        } catch {
          // ignore
        }
        finish();
      }, 5000);

      serverProcess.on("exit", () => {
        clearTimeout(forceKillTimer);
        finish();
      });

      try {
        serverProcess.kill("SIGTERM");
      } catch {
        finish();
      }
    });
  };

  return {
    baseUrl,
    host,
    port,
    pid,
    databaseUrl: options.databaseUrl,
    adminApiKey,
    acceptanceRunId: options.acceptanceRunId,
    dbObservationToken,
    stop,
  };
}
