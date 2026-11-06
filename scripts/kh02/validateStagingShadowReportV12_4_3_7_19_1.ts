/**
 * SWAI KH-02 — V12.4.3.7.19.1
 * Staging Shadow Report Validator
 */

import fs from "node:fs";
import path from "node:path";
import {
  StagingShadowResult,
  validateStagingShadowReport,
} from "../../src/services/kh02/staging/stagingShadowReleaseGate";

async function main() {
  const reportPath = path.resolve(
    process.cwd(),
    "reports/kh02/KH02_V12_4_3_7_19_1_STAGING_RUNTIME_PROOF_2026-11-06.json"
  );

  if (!fs.existsSync(reportPath)) {
    console.error(`[V12.4.3.7.19.1] Report not found: ${reportPath}`);
    process.exit(1);
  }

  const raw = fs.readFileSync(reportPath, "utf8");
  const report: StagingShadowResult = JSON.parse(raw);

  const check = validateStagingShadowReport(report);
  if (!check.valid) {
    console.error("[V12.4.3.7.19.1] Report validation failed:", check.errors);
    process.exit(1);
  }

  console.log(`[V12.4.3.7.19.1] Staging shadow report validated: status=${report.status}, mode=${report.mode}`);
  process.exit(0);
}

main().catch((err) => {
  console.error("[V12.4.3.7.19.1] Validation script error:", err);
  process.exit(1);
});

