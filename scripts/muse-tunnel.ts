/**
 * SWAI V10.1 — Cloudflare Quick Tunnel Launch Script for Muse Gateway
 *
 * CRITICAL SECURITY INVARIANT:
 * This tunnel connects EXCLUSIVELY to the restricted Muse reverse proxy on 127.0.0.1:8787.
 * It NEVER points to port 3000, preventing any exposure of Next.js dev endpoints,
 * user settings, admin routes, or database operations.
 *
 * Usage:
 *   npm run muse:tunnel
 */

import { spawn } from "node:child_process";

const GATEWAY_URL = "http://127.0.0.1:8787";

console.log("=================================================================");
console.log("   SWAI V10.1 — CLOUDFLARE QUICK TUNNEL FOR RESTRICTED GATEWAY   ");
console.log("=================================================================");
console.log(` Target Upstream:     ${GATEWAY_URL} (RESTRICTED GATEWAY ONLY)`);
console.log(" Invariant:           Port 3000 (Next.js) is NEVER exposed to the public tunnel");
console.log(" Permitted Traffic:   ONLY /api/v1/discovery/muse/agent/* with valid token");
console.log("-----------------------------------------------------------------\n");

function checkAndLaunchTunnel() {
  const tunnelProcess = spawn("cloudflared", ["tunnel", "--url", GATEWAY_URL], {
    stdio: ["ignore", "pipe", "pipe"],
  });

  let tunnelUrlFound = false;

  const handleOutput = (data: Buffer) => {
    const text = data.toString();

    // Scan for quick tunnel URL
    const match = text.match(/https:\/\/[a-zA-Z0-9-]+\.trycloudflare\.com/);
    if (match && !tunnelUrlFound) {
      tunnelUrlFound = true;
      console.log("\n-----------------------------------------------------------------");
      console.log("🎉 CLOUDFLARE QUICK TUNNEL IS ACTIVE!");
      console.log(`📡 Public External Gateway URL: \x1b[32m${match[0]}\x1b[0m`);
      console.log("-----------------------------------------------------------------");
      console.log("Configure external Muse agent with:");
      console.log(`  Queue Endpoint:     ${match[0]}/api/v1/discovery/muse/agent/requests`);
      console.log(`  Heartbeat Endpoint: ${match[0]}/api/v1/discovery/muse/agent/heartbeat`);
      console.log("  Headers:");
      console.log("    Authorization: Bearer <YOUR_MUSE_INGESTION_TOKEN>");
      console.log("    Content-Type: application/json");
      console.log("-----------------------------------------------------------------\n");
    }

    // Print cloudflared status messages (filtering redundant connection noise)
    if (text.includes("INF") || text.includes("ERR") || text.includes("Registered tunnel connection")) {
      process.stdout.write(`[cloudflared] ${text}`);
    }
  };

  tunnelProcess.stdout.on("data", handleOutput);
  tunnelProcess.stderr.on("data", handleOutput);

  tunnelProcess.on("error", (err: NodeJS.ErrnoException) => {
    if (err.code === "ENOENT") {
      console.error("❌ 'cloudflared' command not found on this machine.");
      console.error("\nTo install Cloudflare Tunnel CLI:");
      console.error("  • Windows (PowerShell): winget install --id Cloudflare.cloudflared");
      console.error("  • macOS (Homebrew):     brew install cloudflared");
      console.error("  • Linux:                https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/\n");
      console.error("Manual execution command (after install):");
      console.error(`  cloudflared tunnel --url ${GATEWAY_URL}\n`);
    } else {
      console.error("❌ Failed to start Cloudflare Tunnel:", err.message);
    }
    process.exit(1);
  });

  tunnelProcess.on("exit", (code) => {
    console.log(`\n[cloudflared] Tunnel process exited with code ${code}.`);
    process.exit(code || 0);
  });

  const shutdown = () => {
    console.log("\n[cloudflared] Stopping Cloudflare Tunnel...");
    tunnelProcess.kill("SIGTERM");
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

checkAndLaunchTunnel();
