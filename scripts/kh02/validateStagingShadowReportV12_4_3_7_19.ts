/**
 * SWAI KH-02 — V12.4.3.7.19
 * Staging Shadow Report Validator
 */

import fs from "node:fs";
import path from "node:path";
import { StagingShadowResult } from "../../src/services/kh02/staging/stagingShadowReleaseGate";

async function main() {
  const reportPath = path.resolve(
    process.cwd(),
    "reports/kh02/KH02_V12_4_3_7_19_STAGING_SHADOW_RUNTIME_REPORT_2026-11-06.json"
  );

  if (!fs.existsSync(reportPath)) {
    console.error(`[V12.4.3.7.19] Report not found: ${reportPath}`);
    process.exit(1);
  }

  const raw = fs.readFileSync(reportPath, "utf8");
  const report: StagingShadowResult = JSON.parse(raw);

  if (!report.mode || !report.status) {
    console.error("[V12.4.3.7.19] Report missing mandatory fields.");
    process.exit(1);
  }

  if (report.zeroProductionMutations !== true) {
    console.error("[V12.4.3.7.19] Zero production mutations check failed.");
    process.exit(1);
  }

  if (report.isProductionDenylisted !== true) {
    console.error("[V12.4.3.7.19] Production denylist check failed.");
    process.exit(1);
  }

  console.log(`[V12.4.3.7.19] Staging shadow report validated: status=${report.status}, mode=${report.mode}`);
  process.exit(0);
}

main().catch((err) => {
  console.error("[V12.4.3.7.19] Validation script error:", err);
  process.exit(1);
});

