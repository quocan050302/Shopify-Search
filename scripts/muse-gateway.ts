/**
 * SWAI V10.1 — Launch Script for Dedicated Muse Restricted Gateway
 *
 * Usage:
 *   npm run muse:gateway
 *
 * Listens on: 127.0.0.1:8787
 * Forwards to: 127.0.0.1:3000
 */

import dotenv from "dotenv";
import path from "node:path";
import { createMuseGatewayServer } from "../src/server/museGateway";

// Load environment variables (.env.local first, then .env)
dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });
dotenv.config({ path: path.resolve(process.cwd(), ".env") });

const PORT = parseInt(process.env.MUSE_GATEWAY_PORT || "8787", 10);
const HOST = process.env.MUSE_GATEWAY_HOST || "127.0.0.1";
const TARGET_HOST = process.env.SWAI_UPSTREAM_URL || "http://127.0.0.1:3000";

const tokenConfigured = Boolean((process.env.MUSE_INGESTION_TOKEN || "").trim());

console.log("=================================================================");
console.log("   SWAI V10.1 — RESTRICTED LOCAL MUSE HTTPS/HTTP REVERSE PROXY   ");
console.log("=================================================================");
console.log(` Listening on:        http://${HOST}:${PORT}`);
console.log(` Forwarding to:       ${TARGET_HOST}`);
console.log(` Permitted Endpoints: ONLY /api/v1/discovery/muse/agent/*`);
console.log(` Forbidden Paths:     ALL other routes return HTTP 404`);
console.log(` Authentication:      MUSE_INGESTION_TOKEN required (${tokenConfigured ? "CONFIGURED" : "MISSING!"})`);
console.log(` Rate Limiting:       60 req/min per IP`);
console.log(` Payload Boundary:    2MB maximum`);
console.log(" Secret Redaction:    Tokens, keys & database details never logged");
console.log("-----------------------------------------------------------------");

if (!tokenConfigured) {
  console.warn("⚠️  WARNING: MUSE_INGESTION_TOKEN is not set in .env or .env.local!");
  console.warn("   External agent requests will be rejected with HTTP 401 until configured.\n");
}

const server = createMuseGatewayServer({
  port: PORT,
  host: HOST,
  targetHost: TARGET_HOST,
});

server.listen(PORT, HOST, () => {
  console.log(`✅ Muse Gateway is running and ready on http://${HOST}:${PORT}`);
  console.log("   (Point Cloudflare Tunnel or external agent to this port ONLY)\n");
});

// Graceful shutdown
const shutdown = () => {
  console.log("\n[MUSE-GATEWAY] Shutting down gateway proxy...");
  server.close(() => {
    console.log("[MUSE-GATEWAY] Gateway stopped cleanly.");
    process.exit(0);
  });
};

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
