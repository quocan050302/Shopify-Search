/**
 * SWAI KH-01 Acceptance Gate Canonical Registry (Section 14)
 * Single authoritative source of truth for all KH-01 release gates and manifest validation.
 */

export type GateCriticality = "MANDATORY" | "OPTIONAL";
export type AcceptanceStatus = "PASSED" | "FAILED" | "BLOCKED" | "NOT_RUN";
export type ReleaseVerdict = "ACCEPTED" | "CONDITIONALLY_ACCEPTED" | "BLOCKED";

export interface AcceptanceGateDefinition {
  gateId: string;
  description: string;
  criticality: GateCriticality;
  evidenceType: string;
  stageId: string;
  expectedTestFile?: string;
  expectedTestName?: string;
}

export interface GateEvidence {
  gateId: string;
  runId: string;
  testId: string;
  status: AcceptanceStatus;
  evidenceType: string;
  evidenceReference: string | null;
  observedAt: string | null;
  error?: string;
}

export type LiveVerificationLevel =
  | "NETWORK_REACHABLE"
  | "MCP_CONNECTED"
  | "SOURCE_ACCESSIBLE"
  | "ADS_COLLECTED"
  | "ADS_PERSISTED"
  | "RUN_RECONCILED";

export interface LiveMetaVerificationResult {
  status: AcceptanceStatus;
  detailedOutcome:
    | "LIVE_RECONCILED"
    | "SOURCE_ACCESSIBLE_NO_RESULTS"
    | "MCP_UNAVAILABLE"
    | "BLOCKED_SOURCE"
    | "RATE_LIMITED"
    | "NO_VALID_ADS"
    | "PERSISTENCE_FAILED"
    | "RECONCILIATION_FAILED"
    | "NOT_RUN";
  levelsVerified: LiveVerificationLevel[];
  runId: string | null;
  source: string;
  retrievedCount: number;
  validCount: number;
  linkedCount: number;
  displayedCount: number;
  evidenceReferences: string[];
  startedAt: string;
  completedAt: string;
  error?: string;
}

export interface Kh01AcceptanceManifest {
  applicationVersion: string;
  protocolVersion: string;
  acceptanceRunId: string;
  testedCommitSha: string;
  reportCommitSha?: string;
  branch: string;
  startedAt: string;
  completedAt: string;
  gates: GateEvidence[];
  stages: any[];
  liveVerification: LiveMetaVerificationResult;
  unresolvedDefects: string[];
  releaseVerdict: ReleaseVerdict;
}

/**
 * The canonical 13 mandatory release gates for KH-01.
 */
export const CANONICAL_ACCEPTANCE_GATES: AcceptanceGateDefinition[] = [
  {
    gateId: "GATE_01_CORRECT_BRANCH",
    description: "Acceptance executed strictly on feature/v11-meta-collector-remove-muse",
    criticality: "MANDATORY",
    evidenceType: "TEST_ASSERTION",
    stageId: "STAGE_01_GIT_STATE",
  },
  {
    gateId: "GATE_02_ACTIVE_DB_PROTECTED",
    description: "Database isolation strictly protects active user/dev database",
    criticality: "MANDATORY",
    evidenceType: "DATABASE_QUERY",
    stageId: "STAGE_03_UNIT_SUITE",
    expectedTestFile: "tests/unit/dbIsolation.test.ts",
    expectedTestName: "blocks test execution when databaseUrl contains production.db",
  },
  {
    gateId: "GATE_03_AUTH_TRUST_BOUNDARY",
    description: "Remote HTTP headers (Host, x-forwarded-for, x-real-ip) cannot spoof administrator access",
    criticality: "MANDATORY",
    evidenceType: "TEST_ASSERTION",
    stageId: "STAGE_03_SECURITY_SUITE",
    expectedTestFile: "tests/unit/adminAuthTrustBoundary.test.ts",
    expectedTestName: "rejects spoofed x-forwarded-for header from remote client",
  },
  {
    gateId: "GATE_04_WORKSPACE_ISOLATION",
    description: "Multi-tenant workspace isolation enforced across all Ads endpoints and fallback queries",
    criticality: "MANDATORY",
    evidenceType: "TEST_ASSERTION",
    stageId: "STAGE_03_SECURITY_SUITE",
    expectedTestFile: "tests/integration/legacyAdsWorkspaceIsolation.test.ts",
    expectedTestName: "Workspace A caller querying GET /api/v1/ads receives ONLY Workspace A ads",
  },
  {
    gateId: "GATE_05_EXACT_RUN_COMPLETENESS",
    description: "Exact research run displays 100% authentic run ads without 30-day age filtering",
    criticality: "MANDATORY",
    evidenceType: "TEST_ASSERTION",
    stageId: "STAGE_03_EXACT_RUN_SUITE",
    expectedTestFile: "tests/integration/exactRunCompleteness.test.ts",
    expectedTestName: "retrieves all 25 linked ads across pagination without 30-day age filtering",
  },
  {
    gateId: "GATE_06_READINESS_SUBMISSION_POLICY",
    description: "Research submission strictly enforced; UNKNOWN and LOADING cannot create jobs",
    criticality: "MANDATORY",
    evidenceType: "TEST_ASSERTION",
    stageId: "STAGE_03_READINESS_SUITE",
    expectedTestFile: "tests/unit/researchActionPolicy.test.ts",
    expectedTestName: "returns DIAGNOSTICS with non-submitting button when UNKNOWN",
  },
  {
    gateId: "GATE_07_PROVENANCE_INTEGRITY",
    description: "Advertising provenance preserved without fabricated impressions, sales, or ROAS",
    criticality: "MANDATORY",
    evidenceType: "TEST_ASSERTION",
    stageId: "STAGE_05_UNIFIED_JOURNEY",
    expectedTestFile: "tests/integration/kh01UnifiedJourney.test.ts",
    expectedTestName: "Step 3: Executes the research job via production worker and persists real snapshots",
  },
  {
    gateId: "GATE_08_GENUINE_CONCURRENCY_PROOF",
    description: "True multi-process mutual exclusion and lease renewal proven across independent workers",
    criticality: "MANDATORY",
    evidenceType: "PROCESS_CONCURRENCY_TEST",
    stageId: "STAGE_04_CONCURRENCY_RECOVERY",
    expectedTestFile: "tests/integration/kh01WorkerConcurrency.test.ts",
    expectedTestName: "proves true multi-process mutual exclusion across independent Node.js processes sharing SQLite (Section 31)",
  },
  {
    gateId: "GATE_09_GENUINE_CRASH_RECOVERY",
    description: "Worker crash recovery and stale write protection verified under adversarial conditions",
    criticality: "MANDATORY",
    evidenceType: "PROCESS_CONCURRENCY_TEST",
    stageId: "STAGE_04_CONCURRENCY_RECOVERY",
    expectedTestFile: "tests/integration/kh01WorkerConcurrency.test.ts",
    expectedTestName: "verifies full crash recovery scenario, immutable payload preservation, and stale rejection",
  },
  {
    gateId: "GATE_10_TYPESCRIPT_PASSED",
    description: "TypeScript compilation passes with zero errors under strict mode",
    criticality: "MANDATORY",
    evidenceType: "TEST_ASSERTION",
    stageId: "STAGE_02_TYPESCRIPT",
  },
  {
    gateId: "GATE_11_PRODUCTION_BUILD_PASSED",
    description: "Next.js production build completes successfully with zero bundle errors",
    criticality: "MANDATORY",
    evidenceType: "TEST_ASSERTION",
    stageId: "STAGE_06_PRODUCTION_BUILD",
  },
  {
    gateId: "GATE_12_UNIFIED_JOURNEY_E2E",
    description: "Continuous research journey executed from creation through worker to browser UI",
    criticality: "MANDATORY",
    evidenceType: "BROWSER_ACTION",
    stageId: "STAGE_05_UNIFIED_JOURNEY",
    expectedTestFile: "tests/integration/kh01UnifiedJourney.test.ts",
    expectedTestName: "Step 6: Navigates Chromium browser to Product Intelligence and validates UI displays worker data",
  },
  {
    gateId: "GATE_13_TEST_TRUTHFULNESS_VERIFIED",
    description: "Acceptance runner truthfulness verified; reports cannot inherit PASS from missing/skipped tests",
    criticality: "MANDATORY",
    evidenceType: "TEST_ASSERTION",
    stageId: "STAGE_03D_TRUTHFULNESS_SUITE",
    expectedTestFile: "tests/unit/kh01AcceptanceTruthfulness.test.ts",
    expectedTestName: "accurately classifies SKIPPED test and does not report it as passed",
  },
  // Optional Live Source Gate
  {
    gateId: "GATE_14_LIVE_META_SOURCE",
    description: "Live Meta Ad Library extraction verified via local MCP collector (optional opt-in)",
    criticality: "OPTIONAL",
    evidenceType: "LIVE_SOURCE_OBSERVATION",
    stageId: "STAGE_07_LIVE_META",
  },
];

/**
 * Validates a generated Kh01AcceptanceManifest for consistency, uniqueness, and truthfulness.
 */
export function validateKh01AcceptanceManifest(manifest: Kh01AcceptanceManifest): {
  isValid: boolean;
  errors: string[];
} {
  const errors: string[] = [];

  if (!manifest.acceptanceRunId || !manifest.acceptanceRunId.trim()) {
    errors.push("Missing acceptanceRunId in manifest.");
  }

  if (!manifest.testedCommitSha || manifest.testedCommitSha === "UNKNOWN") {
    errors.push("Invalid or missing testedCommitSha.");
  }

  if (manifest.branch !== "feature/v11-meta-collector-remove-muse") {
    errors.push(`Target branch mismatch: expected feature/v11-meta-collector-remove-muse, got ${manifest.branch}`);
  }

  // Check duplicate gate IDs
  const seenGateIds = new Set<string>();
  for (const g of manifest.gates) {
    if (seenGateIds.has(g.gateId)) {
      errors.push(`Duplicate gateId '${g.gateId}' found in manifest.`);
    }
    seenGateIds.add(g.gateId);

    if (g.runId !== manifest.acceptanceRunId) {
      errors.push(`Gate '${g.gateId}' runId '${g.runId}' does not match manifest acceptanceRunId '${manifest.acceptanceRunId}'.`);
    }

    if (!g.evidenceReference || !g.evidenceReference.trim()) {
      errors.push(`Gate '${g.gateId}' is missing an evidence reference.`);
    }
  }

  // Ensure all mandatory gates are present and evaluated
  const mandatoryGates = CANONICAL_ACCEPTANCE_GATES.filter((g) => g.criticality === "MANDATORY");
  for (const def of mandatoryGates) {
    const gate = manifest.gates.find((g) => g.gateId === def.gateId);
    if (!gate) {
      errors.push(`Missing mandatory gate evidence for '${def.gateId}'.`);
    } else if (manifest.releaseVerdict !== "BLOCKED" && gate.status !== "PASSED") {
      errors.push(
        `Contradictory release verdict: mandatory gate '${def.gateId}' has status '${gate.status}' but releaseVerdict is '${manifest.releaseVerdict}'. Non-BLOCKED releases strictly require PASSED.`
      );
    }
  }

  // Ensure all required stages are present and passed if release is not BLOCKED
  if (manifest.stages && Array.isArray(manifest.stages) && manifest.releaseVerdict !== "BLOCKED") {
    for (const stage of manifest.stages) {
      if (stage.status !== "PASSED") {
        errors.push(
          `Stage '${stage.stageId || stage.name}' failed with exit code ${stage.exitCode}, but release verdict is '${manifest.releaseVerdict}'.`
        );
      }
    }
  }

  // Live source validation
  if (manifest.liveVerification) {
    if (manifest.liveVerification.status === "PASSED") {
      if (manifest.liveVerification.retrievedCount === 0) {
        errors.push("Live verification cannot be PASSED with retrievedCount 0.");
      }
      if (!manifest.liveVerification.levelsVerified.includes("ADS_COLLECTED")) {
        errors.push("Live verification cannot be PASSED without ADS_COLLECTED level.");
      }
      if (!manifest.liveVerification.levelsVerified.includes("ADS_PERSISTED")) {
        errors.push("Live verification cannot be PASSED without ADS_PERSISTED level.");
      }
      if (!manifest.liveVerification.levelsVerified.includes("RUN_RECONCILED")) {
        errors.push("Live verification cannot be PASSED without RUN_RECONCILED level.");
      }
      if (!manifest.liveVerification.runId) {
        errors.push("Live verification cannot be PASSED without a verified runId.");
      }
    } else if (manifest.releaseVerdict === "ACCEPTED") {
      errors.push("Release verdict cannot be ACCEPTED when live verification is not PASSED (LIVE_RECONCILED).");
    }
  }

  // Verdict validation
  if (manifest.unresolvedDefects && manifest.unresolvedDefects.length > 0 && manifest.releaseVerdict !== "BLOCKED") {
    errors.push("Release verdict cannot be ACCEPTED or CONDITIONALLY_ACCEPTED with unresolved P0/P1 defects.");
  }

  return {
    isValid: errors.length === 0,
    errors,
  };
}

/**
 * Derives the exact release verdict from mandatory gates, optional checks, and unresolved defects.
 */
export function deriveReleaseVerdict(
  gates: GateEvidence[],
  liveVerification: LiveMetaVerificationResult,
  unresolvedDefects: string[] = []
): ReleaseVerdict {
  if (unresolvedDefects.length > 0) {
    return "BLOCKED";
  }

  const mandatoryGateDefs = CANONICAL_ACCEPTANCE_GATES.filter((g) => g.criticality === "MANDATORY");
  for (const def of mandatoryGateDefs) {
    const gate = gates.find((g) => g.gateId === def.gateId);
    if (!gate || gate.status !== "PASSED") {
      return "BLOCKED";
    }
  }

  // If all mandatory gates passed:
  if (
    liveVerification.status === "PASSED" &&
    liveVerification.detailedOutcome === "LIVE_RECONCILED" &&
    liveVerification.levelsVerified.includes("ADS_COLLECTED") &&
    liveVerification.levelsVerified.includes("ADS_PERSISTED") &&
    liveVerification.levelsVerified.includes("RUN_RECONCILED")
  ) {
    return "ACCEPTED";
  }

  // If live verification was not run or blocked, but all mandatory offline checks passed:
  return "CONDITIONALLY_ACCEPTED";
}

/**
 * Finalizes acceptance verdict taking into account all stage executions and manifest validation results.
 */
export function finalizeAcceptanceVerdict(
  gates: GateEvidence[],
  stages: { stageId: string; status: AcceptanceStatus }[],
  liveVerification: LiveMetaVerificationResult,
  unresolvedDefects: string[] = [],
  manifestValidationErrors: string[] = []
): ReleaseVerdict {
  if (manifestValidationErrors.length > 0) {
    return "BLOCKED";
  }
  if (unresolvedDefects.length > 0) {
    return "BLOCKED";
  }
  const anyStageFailed = stages.some((s) => s.status !== "PASSED");
  if (anyStageFailed) {
    return "BLOCKED";
  }
  return deriveReleaseVerdict(gates, liveVerification, unresolvedDefects);
}
