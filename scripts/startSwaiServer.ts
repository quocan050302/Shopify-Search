#!/usr/bin/env node
/**
 * SWAI Safe Server Launcher
 *
 * Requirements (KH-01 / V11.5.9.1):
 * 1. Synchronizes Next.js listener interface (-H) with server-side HOST/SWAI_DEPLOYMENT_MODE environment.
 * 2. Enforces fail-closed validation on startup options (rejects public binding with LOCAL_DESKTOP).
 * 3. Sanitizes logs: never logs admin secrets or credentials.
 * 4. Propagates process signals (SIGINT/SIGTERM) cleanly.
 */

import { spawn } from "child_process";
import path from "path";
import { resolveSwaiLaunchConfiguration } from "../src/services/security/adminAuth";

interface ParsedCliArgs {
  command: "dev" | "start";
  exposure?: "LOCAL_DESKTOP" | "AUTHENTICATED_REMOTE";
  host?: string;
  port?: number;
}

function parseCliArgs(argv: string[]): ParsedCliArgs {
  const args = argv.slice(2);
  let command: "dev" | "start" = "dev";
  let exposure: "LOCAL_DESKTOP" | "AUTHENTICATED_REMOTE" | undefined;
  let host: string | undefined;
  let port: number | undefined;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "dev" || arg === "start") {
      command = arg;
    } else if (arg === "--local") {
      exposure = "LOCAL_DESKTOP";
    } else if (arg === "--remote") {
      exposure = "AUTHENTICATED_REMOTE";
    } else if (arg === "-H" || arg === "--host") {
      host = args[++i];
    } else if (arg.startsWith("--host=")) {
      host = arg.slice(7);
    } else if (arg === "-p" || arg === "--port") {
      const p = parseInt(args[++i], 10);
      if (!isNaN(p)) port = p;
    } else if (arg.startsWith("--port=")) {
      const p = parseInt(arg.slice(7), 10);
      if (!isNaN(p)) port = p;
    }
  }

  return { command, exposure, host, port };
}

export async function launchSwaiServer(argv: string[] = process.argv): Promise<void> {
  const parsed = parseCliArgs(argv);
  const launchConfig = resolveSwaiLaunchConfiguration({
    mode: parsed.command === "start" ? "production" : "development",
    exposure: parsed.exposure,
    host: parsed.host,
    port: parsed.port,
  });

  if (!launchConfig.valid) {
    console.error("[SWAI-LAUNCHER] FATAL: Invalid server launch configuration:");
    for (const err of launchConfig.errors) {
      console.error(`  - ${err}`);
    }
    process.exit(1);
  }

  const childEnv: NodeJS.ProcessEnv = {
    ...process.env,
    HOST: launchConfig.listenerHost,
    HOSTNAME: launchConfig.listenerHost,
    PORT: String(launchConfig.port),
    SWAI_DEPLOYMENT_MODE: launchConfig.mode,
    SWAI_REMOTE_ACCESS: launchConfig.mode === "AUTHENTICATED_REMOTE" ? "true" : "false",
  };

  const nextBinPath = require.resolve("next/dist/bin/next");
  const serverArgs = [
    nextBinPath,
    parsed.command === "start" ? "start" : "dev",
    "-H",
    launchConfig.listenerHost,
    "-p",
    String(launchConfig.port),
  ];

  console.log(`[SWAI-LAUNCHER] Starting Next.js (${parsed.command.toUpperCase()})`);
  console.log(`[SWAI-LAUNCHER] Binding Interface: ${launchConfig.listenerHost}:${launchConfig.port}`);
  console.log(`[SWAI-LAUNCHER] Deployment Mode:   ${launchConfig.mode}`);
  console.log(`[SWAI-LAUNCHER] Auth Required:     ${launchConfig.authenticationRequired}`);

  const child = spawn(process.execPath, serverArgs, {
    cwd: path.resolve(__dirname, ".."),
    env: childEnv,
    stdio: "inherit",
  });

  const forwardSignal = (sig: NodeJS.Signals) => {
    if (!child.killed) {
      child.kill(sig);
    }
  };

  process.on("SIGINT", () => forwardSignal("SIGINT"));
  process.on("SIGTERM", () => forwardSignal("SIGTERM"));

  child.on("exit", (code, signal) => {
    if (signal) {
      process.kill(process.pid, signal);
    } else {
      process.exit(code ?? 0);
    }
  });
}

if (require.main === module || process.argv[1] === __filename) {
  launchSwaiServer().catch((err) => {
    console.error("[SWAI-LAUNCHER] Unhandled exception:", err);
    process.exit(1);
  });
}
