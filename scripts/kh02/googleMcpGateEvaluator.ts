/**
 * SWAI KH-02 V12.4.3.4.5 — Google MCP Gate & Creative Association Evaluator
 *
 * Provides dynamic evaluation of Google Ads Transparency MCP retrieval,
 * verified creative pipeline invariants, and exact vs probable product matching.
 */

export interface GoogleMcpGateInput {
  researchRunId: string;
  telemetry: any;
  rawManifest: {
    rawCount: number;
    creatives: any[];
    upstreamTransportStatus?: string;
  };
  normalizationLedger: {
    normalizedDistinctCount?: number;
    rejectedBeforeNormalizationCount?: number;
    records?: any[];
    normalizedRecords?: any[];
    [key: string]: any;
  };
  associationLedger: {
    classifiedDistinctCount?: number;
    totalClassified?: number;
    productLevelMatchesCount?: number;
    exactMatches?: number;
    probableProductMatchesCount?: number;
    probableMatches?: number;
    brandLevelMatchesCount?: number;
    brandOnlyMatches?: number;
    associations?: any[];
    entries?: any[];
    [key: string]: any;
  };
}

export interface GoogleMcpGateEvaluationResult {
  evaluatedAt: string;
  researchRunId: string;
  transportStatus: "CONNECTED" | "DISCONNECTED" | "ERROR";
  liveCreativesRetrievedCount: number;
  exactProductSkuMatchesCount: number;
  probableProductMatchesCount: number;
  brandOnlyMatchesCount: number;
  pipelineInvariantPassed: boolean;
  subGates: {
    G06_TRANSPORT: "PASS" | "FAIL";
    G06_LIVE_RETRIEVAL: "PASS" | "INSUFFICIENT_EVIDENCE" | "FAIL";
    G06_PIPELINE_RECONCILIATION: "PASS" | "FAIL";
    GOOGLE_PRODUCT_ASSOCIATION: "PASS" | "FAIL";
    GOOGLE_EXACT_PRODUCT_EVIDENCE: "PASS" | "INSUFFICIENT_EVIDENCE";
  };
  overallG06Verdict: "PASS" | "INSUFFICIENT_EVIDENCE" | "FAIL";
  overallG06Reason: string;
}

export function evaluateGoogleMcpGates(
  input: GoogleMcpGateInput
): GoogleMcpGateEvaluationResult {
  const { researchRunId, telemetry, rawManifest, normalizationLedger, associationLedger } = input;

  const transportOk =
    telemetry?.queryStatus === "QUERY_COMPLETED" ||
    telemetry?.transportStatus === "CONNECTED" ||
    (rawManifest?.creatives && rawManifest.creatives.length > 0);

  const rawCount = rawManifest?.rawCount ?? (rawManifest?.creatives?.length || 0);
  const normalizedCount = normalizationLedger?.normalizedDistinctCount ?? 0;
  const rejectedCount = normalizationLedger?.rejectedBeforeNormalizationCount ?? 0;

  // Pipeline invariant: rawCount === normalizedCount + rejectedCount
  const invariantPassed = rawCount === (normalizedCount + rejectedCount);

  // Check live provider credentials / modes
  const liveCreatives = (rawManifest?.creatives || []).filter(
    (c: any) =>
      c.sourceMode === "LIVE_PROVIDER" ||
      c.provenance === "LIVE_PROVIDER" ||
      c.provenance === "REAL_UPSTREAM" ||
      !c.isCached
  );
  const liveCount = liveCreatives.length;

  const exactCount = associationLedger?.productLevelMatchesCount ?? associationLedger?.exactMatches ?? 0;
  const probableCount = associationLedger?.probableProductMatchesCount ?? associationLedger?.probableMatches ?? 0;
  const brandCount = associationLedger?.brandLevelMatchesCount ?? associationLedger?.brandOnlyMatches ?? 0;
  const associations = associationLedger?.associations ?? associationLedger?.entries ?? [];

  // Evaluate sub-gates
  const g06Transport: "PASS" | "FAIL" = transportOk ? "PASS" : "FAIL";
  const g06LiveRetrieval: "PASS" | "INSUFFICIENT_EVIDENCE" | "FAIL" =
    liveCount > 0 ? "PASS" : "INSUFFICIENT_EVIDENCE";
  const g06Reconciliation: "PASS" | "FAIL" = invariantPassed ? "PASS" : "FAIL";

  const associationsValid =
    Array.isArray(associations) &&
    (associations.length === 0 ||
      associations.every(
        (a: any) => (a.creativeId || a.id) && (a.candidateId || a.productId)
      ));
  const googleProductAssociation: "PASS" | "FAIL" = associationsValid ? "PASS" : "FAIL";

  const googleExactSku: "PASS" | "INSUFFICIENT_EVIDENCE" =
    exactCount > 0 ? "PASS" : "INSUFFICIENT_EVIDENCE";

  // Derive top-level G06 verdict
  let overallG06Verdict: "PASS" | "INSUFFICIENT_EVIDENCE" | "FAIL" = "PASS";
  let overallG06Reason = "";

  if (!transportOk) {
    overallG06Verdict = "FAIL";
    overallG06Reason = "Google Ads MCP transport connection failed.";
  } else if (!invariantPassed) {
    overallG06Verdict = "FAIL";
    overallG06Reason = `Creative pipeline invariant violation: raw (${rawCount}) != normalized (${normalizedCount}) + rejected (${rejectedCount}).`;
  } else if (liveCount === 0) {
    overallG06Verdict = "INSUFFICIENT_EVIDENCE";
    overallG06Reason = "Multi-domain live retrieval yielded 0 creatives in current run.";
  } else {
    overallG06Verdict = "PASS";
    overallG06Reason = `Retrieved and normalized ${liveCount} live Google Ads creatives (${probableCount} probable product matches, ${exactCount} exact SKU matches).`;
  }

  return {
    evaluatedAt: new Date().toISOString(),
    researchRunId,
    transportStatus: transportOk ? "CONNECTED" : "DISCONNECTED",
    liveCreativesRetrievedCount: liveCount,
    exactProductSkuMatchesCount: exactCount,
    probableProductMatchesCount: probableCount,
    brandOnlyMatchesCount: brandCount,
    pipelineInvariantPassed: invariantPassed,
    subGates: {
      G06_TRANSPORT: g06Transport,
      G06_LIVE_RETRIEVAL: g06LiveRetrieval,
      G06_PIPELINE_RECONCILIATION: g06Reconciliation,
      GOOGLE_PRODUCT_ASSOCIATION: googleProductAssociation,
      GOOGLE_EXACT_PRODUCT_EVIDENCE: googleExactSku,
    },
    overallG06Verdict,
    overallG06Reason,
  };
}

export function runGoogleGateNegativeTests(): {
  totalTests: number;
  totalPassed: number;
  passed: boolean;
  cases: Array<{ testId: string; description: string; passed: boolean; resultVerdict: string }>;
} {
  const baseInput: GoogleMcpGateInput = {
    researchRunId: "run_test_g06",
    telemetry: { queryStatus: "QUERY_COMPLETED" },
    rawManifest: {
      rawCount: 3,
      creatives: [
        { creativeId: "cr1", sourceMode: "LIVE_PROVIDER" },
        { creativeId: "cr2", sourceMode: "LIVE_PROVIDER" },
        { creativeId: "cr3", sourceMode: "LIVE_PROVIDER" },
      ],
    },
    normalizationLedger: {
      normalizedDistinctCount: 3,
      rejectedBeforeNormalizationCount: 0,
      records: [{ id: "cr1" }, { id: "cr2" }, { id: "cr3" }],
    },
    associationLedger: {
      classifiedDistinctCount: 3,
      productLevelMatchesCount: 0,
      probableProductMatchesCount: 3,
      brandLevelMatchesCount: 0,
      associations: [
        { creativeId: "cr1", candidateId: "c1" },
        { creativeId: "cr2", candidateId: "c2" },
        { creativeId: "cr3", candidateId: "c3" },
      ],
    },
  };

  const cases = [
    {
      testId: "G06-NEG-01",
      description: "3 live creatives, 3 probable, 0 exact -> G06 PASS, exact INSUFFICIENT",
      exec: () => {
        const res = evaluateGoogleMcpGates(baseInput);
        return res.overallG06Verdict === "PASS" && res.subGates.GOOGLE_EXACT_PRODUCT_EVIDENCE === "INSUFFICIENT_EVIDENCE";
      },
    },
    {
      testId: "G06-NEG-02",
      description: "0 live creatives -> G06 INSUFFICIENT_EVIDENCE",
      exec: () => {
        const input = {
          ...baseInput,
          rawManifest: { rawCount: 0, creatives: [] },
          normalizationLedger: { normalizedDistinctCount: 0, rejectedBeforeNormalizationCount: 0, records: [] },
        };
        const res = evaluateGoogleMcpGates(input);
        return res.overallG06Verdict === "INSUFFICIENT_EVIDENCE";
      },
    },
    {
      testId: "G06-NEG-03",
      description: "Pipeline invariant mismatch (raw 3, norm 2, rej 0) -> G06 FAIL",
      exec: () => {
        const input = {
          ...baseInput,
          normalizationLedger: { normalizedDistinctCount: 2, rejectedBeforeNormalizationCount: 0, records: [] },
        };
        const res = evaluateGoogleMcpGates(input);
        return res.overallG06Verdict === "FAIL" && !res.pipelineInvariantPassed;
      },
    },
    {
      testId: "G06-NEG-04",
      description: "Transport failure -> G06 FAIL",
      exec: () => {
        const input = {
          ...baseInput,
          telemetry: { queryStatus: "TRANSPORT_ERROR" },
          rawManifest: { rawCount: 0, creatives: [] },
        };
        const res = evaluateGoogleMcpGates(input);
        return res.overallG06Verdict === "FAIL" || res.subGates.G06_TRANSPORT === "FAIL";
      },
    },
  ];

  const results = cases.map((c) => {
    let passed = false;
    let resultVerdict = "UNKNOWN";
    try {
      passed = c.exec();
      resultVerdict = passed ? "PASS" : "FAIL";
    } catch {
      passed = false;
      resultVerdict = "EXCEPTION";
    }
    return {
      testId: c.testId,
      description: c.description,
      passed,
      resultVerdict,
    };
  });

  const totalPassed = results.filter((r) => r.passed).length;

  return {
    totalTests: cases.length,
    totalPassed,
    passed: totalPassed === cases.length,
    cases: results,
  };
}
