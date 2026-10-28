/**
 * SWAI KH-02 V12.4 / V12.4.1 — Master Acceptance Runner
 *
 * Delegates directly to the repaired V12.4.1 Zero False-PASS Acceptance Runner
 * (runAcceptanceV12_4_1.ts), eliminating all hardcoded PASS verdicts and
 * non-browser fallbacks while preserving historical artifacts under acceptance/kh02-v12.4/.
 */

import { runAcceptanceV12_4_1 } from "./runAcceptanceV12_4_1";

runAcceptanceV12_4_1().catch((err) => {
  console.error("FATAL: Acceptance runner failed:", err);
  process.exit(1);
});
