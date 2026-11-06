/**
 * SWAI KH-02 — V12.4.3.7.19.1
 * Staging Shadow Validation Runner
 *
 * Usage:
 *   npx tsx scripts/kh02/runStagingShadowValidationV12_4_3_7_19_1.ts [--staging]
 */

import fs from "node:fs";
import path from "node:path";
import { executeStagingShadowCheck } from "../../src/services/kh02/staging/stagingShadowReleaseGate";

async function main() {
  const args = process.argv.slice(2);
  const isStaging = args.includes("--staging");
  const mode = isStaging ? "STAGING_RUNTIME_SHADOW" : "OFFLINE_CONTRACT_CHECK";

  console.log(`[V12.4.3.7.19.1] Running Staging Shadow Validation in mode: ${mode}`);

  const result = await executeStagingShadowCheck({
    mode,
    stagingEndpoint: process.env.STAGING_ENDPOINT_URL,
    allowNetwork: false, // Default fail-closed no network
  });

  const reportDir = path.resolve(process.cwd(), "reports/kh02");
  if (!fs.existsSync(reportDir)) {
    fs.mkdirSync(reportDir, { recursive: true });
  }

  const reportPath = path.join(reportDir, "KH02_V12_4_3_7_19_1_STAGING_RUNTIME_PROOF_2026-11-06.json");
  fs.writeFileSync(reportPath, JSON.stringify(result, null, 2) + "\n", "utf8");

  console.log(`[V12.4.3.7.19.1] Staging Shadow Result: ${result.status}`);
  console.log(`[V12.4.3.7.19.1] Report saved to: ${reportPath}`);

  if (result.status === "EXECUTED_FAIL") {
    process.exit(1);
  }
  process.exit(0);
}

main().catch((err) => {
  console.error("[V12.4.3.7.19.1] Unhandled runner error:", err);
  process.exit(1);
});

