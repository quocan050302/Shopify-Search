/**
 * SWAI KH-02 V12.4.3.4.6 — Google MCP Gate, Explicit Live Provenance, Set Reconciliation & Association Evaluator
 *
 * Enforces:
 * 1. Explicit live provenance on every creative (`sourceMode === "LIVE_PROVIDER"` or `provenance === "LIVE_PROVIDER" | "REAL_UPSTREAM"`,
 *    `isCached === false`, non-empty creative ID, current-run `researchRunId` match, and `providerRequestId`/`mcpInvocationRef`).
 *    Never uses `!c.isCached` as standalone live proof!
 * 2. Transport connection truth (`G06_TRANSPORT` requires explicit telemetry / MCP invocation proof, never rawManifest length alone).
 * 3. Set-based creative pipeline reconciliation (`G06_CREATIVE_PIPELINE` / `G06_PIPELINE_RECONCILIATION`) verifying exact creative ID sets
 *    and `researchRunId` consistency across raw, normalized, rejected, and association ledgers.
 * 4. Strict separation of `GOOGLE_PRODUCT_ASSOCIATION` (pipeline/association ledger integrity) vs `GOOGLE_EXACT_PRODUCT_EVIDENCE`
 *    (product-specific SKU match requiring destination product URL/handle or SKU/title + domain proof, never probable or brand-only).
 */

export interface GoogleMcpGateInput {
  researchRunId: string;
  evaluatedCandidateIds?: string[];
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
    rejectedRecords?: any[];
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

export interface SetReconciliationAudit {
  rawCreativeIds: string[];
  normalizedCreativeIds: string[];
  rejectedCreativeIds: string[];
  unaccountedRawCreativeIds: string[];
  unknownNormalizedCreativeIds: string[];
  unknownRejectedCreativeIds: string[];
  overlapNormalizedAndRejectedIds: string[];
  runIdMismatchCreativeIds: string[];
  unknownAssociationCreativeIds: string[];
  unknownAssociationCandidateIds: string[];
  setInvariantPassed: boolean;
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
  setReconciliation: SetReconciliationAudit;
  subGates: {
    G06_TRANSPORT: "PASS" | "FAIL";
    G06_LIVE_RETRIEVAL: "PASS" | "INSUFFICIENT_EVIDENCE" | "FAIL";
    G06_CREATIVE_PIPELINE: "PASS" | "FAIL";
    G06_PIPELINE_RECONCILIATION: "PASS" | "FAIL";
    GOOGLE_PRODUCT_ASSOCIATION: "PASS" | "FAIL";
    GOOGLE_EXACT_PRODUCT_EVIDENCE: "PASS" | "INSUFFICIENT_EVIDENCE";
  };
  overallG06Verdict: "PASS" | "INSUFFICIENT_EVIDENCE" | "FAIL";
  overallG06Reason: string;
}

function cleanId(val: unknown): string | null {
  if (typeof val !== "string" && typeof val !== "number") return null;
  const s = String(val).trim();
  if (!s || s.toLowerCase() === "unknown" || s.toLowerCase() === "null" || s.toLowerCase() === "undefined") {
    return null;
  }
  return s;
}

function extractCreativeId(item: any): string | null {
  if (!item || typeof item !== "object") return null;
  return (
    cleanId(item.creativeId) ||
    cleanId(item.creative_id) ||
    cleanId(item.sourceRecordId) ||
    cleanId(item.id)
  );
}

/**
 * Pure predicate: returns true ONLY when a Google creative has explicit live provenance,
 * `isCached === false` (never undefined or true), non-empty creative ID, current-run `researchRunId` match,
 * and non-empty `providerRequestId` / `mcpInvocationRef`.
 */
export function isExplicitlyLiveGoogleCreative(
  creative: any,
  currentResearchRunId: string
): boolean {
  if (!creative || typeof creative !== "object") return false;
  const targetRunId = cleanId(currentResearchRunId);
  if (!targetRunId) return false;

  const cid = extractCreativeId(creative);
  if (!cid) return false;

  // Must explicitly have isCached === false (undefined is NOT sufficient!)
  if (creative.isCached !== false) {
    return false;
  }

  const sourceMode = cleanId(creative.sourceMode);
  const provenance = cleanId(creative.provenance);
  if (sourceMode === "CACHE_ONLY" || sourceMode === "CACHED" || provenance === "CACHED_SOURCE" || provenance === "CACHED_DB") {
    return false;
  }

  const hasExplicitLiveModeOrProvenance =
    sourceMode === "LIVE_PROVIDER" ||
    provenance === "LIVE_PROVIDER" ||
    provenance === "REAL_UPSTREAM";
  if (!hasExplicitLiveModeOrProvenance) {
    return false;
  }

  const crRunId = cleanId(creative.researchRunId);
  if (!crRunId || crRunId !== targetRunId) {
    return false;
  }

  const reqRef = cleanId(creative.providerRequestId) || cleanId(creative.mcpInvocationRef);
  if (!reqRef) {
    return false;
  }

  return true;
}

/**
 * Pure predicate: verifies whether an association entry claiming EXACT_PRODUCT_MATCH
 * actually possesses product-level evidence (destination product URL/handle, SKU/model,
 * or verified exact product title + merchant domain match) rather than brand domain alone.
 */
export function hasVerifiedExactProductAssociationEvidence(assoc: any): boolean {
  if (!assoc || typeof assoc !== "object") return false;
  const verdict = assoc.associationVerdict || assoc.associationClassification || assoc.verdict;
  if (verdict !== "EXACT_PRODUCT_MATCH") return false;

  const classification = String(assoc.exactMatchingClassification || "").toUpperCase();
  if (classification === "BRAND_DOMAIN_MATCH" || classification === "BRAND_ONLY_MATCH") {
    return false;
  }

  const dest = cleanId(assoc.finalDestination) || cleanId(assoc.normalizedProductUrl) || cleanId(assoc.rawLandingUrl);
  const hasProductDest =
    Boolean(dest) &&
    !String(dest).includes("adstransparency.google.com") &&
    /\/products\/|\/dp\/|\/p\/|\/item\//i.test(String(dest));

  const hasSkuOrExactTitleProof =
    Boolean(cleanId(assoc.matchedSku) || cleanId(assoc.sku)) ||
    ((classification === "EXACT" || classification === "HIGH_CONFIDENCE") &&
      Boolean(cleanId(assoc.matchingEvidence)) &&
      Boolean(cleanId(assoc.creativeTitle)));

  return hasProductDest || hasSkuOrExactTitleProof;
}

export function evaluateGoogleMcpGates(
  input: GoogleMcpGateInput
): GoogleMcpGateEvaluationResult {
  const { researchRunId, telemetry, rawManifest, normalizationLedger, associationLedger } = input;
  const cleanRunId = cleanId(researchRunId) || "";

  // 1. Transport Connection Truth (G06_TRANSPORT)
  // Requires explicit telemetry status or succeeded MCP invocation proof — never rawManifest.creatives.length > 0 alone!
  const mcpInvocations = Array.isArray(telemetry?.enrichmentExecution?.mcpInvocations)
    ? telemetry.enrichmentExecution.mcpInvocations
    : [];
  const hasSucceededMcpInvocation = mcpInvocations.some(
    (inv: any) => inv && inv.status === "SUCCEEDED"
  );
  const explicitTransportError =
    telemetry?.queryStatus === "TRANSPORT_ERROR" ||
    telemetry?.queryStatus === "MCP_TRANSPORT_FAILURE" ||
    telemetry?.queryStatus === "TRANSPORT_FAILED" ||
    telemetry?. queryStatus === "FAILED" ||
    telemetry?.transportStatus === "TRANSPORT_FAILED" ||
    telemetry?.transportStatus === "DISCONNECTED" ||
    rawManifest?.upstreamTransportStatus === "FAILED" ||
    rawManifest?.upstreamTransportStatus === "DISCONNECTED";

  const transportOk =
    !explicitTransportError &&
    Boolean(
      telemetry?.transportStatus === "CONNECTED" ||
        telemetry?.queryStatus === "PASSED" ||
        telemetry?.queryStatus === "QUERY_COMPLETED" ||
        telemetry?.queryStatus === "QUERY_SUCCEEDED_EMPTY" ||
        hasSucceededMcpInvocation
    );

  // 2. Explicit Live Creative Verification
  const rawCreatives = Array.isArray(rawManifest?.creatives) ? rawManifest.creatives : [];
  const liveCreatives = rawCreatives.filter((c: any) =>
    isExplicitlyLiveGoogleCreative(c, cleanRunId)
  );
  const liveCount = liveCreatives.length;

  // 3. Set-Based Creative Pipeline Reconciliation
  const normRecords = Array.isArray(normalizationLedger?.records)
    ? normalizationLedger.records
    : Array.isArray(normalizationLedger?.normalizedRecords)
    ? normalizationLedger.normalizedRecords
    : [];

  const rejRecords = Array.isArray(normalizationLedger?.rejectedRecords)
    ? normalizationLedger.rejectedRecords
    : [];

  const rawIdList = rawCreatives.map(extractCreativeId).filter(Boolean) as string[];
  const rawIdSet = new Set<string>(rawIdList);

  const normIdList = normRecords.map(extractCreativeId).filter(Boolean) as string[];
  const normIdSet = new Set<string>(normIdList);

  // Adapter-level rejected records (excluding Stage 7 post-normalization association classifications that are already in normIdSet)
  const allRejIdList = rejRecords.map(extractCreativeId).filter(Boolean) as string[];
  const unknownRejectedCreativeIds = allRejIdList.filter((id) => !rawIdSet.has(id));
  const adapterRejIdList = allRejIdList.filter((id) => !normIdSet.has(id));
  const adapterRejIdSet = new Set<string>(adapterRejIdList);

  const unknownNormalizedCreativeIds = normIdList.filter((id) => !rawIdSet.has(id));
  const unaccountedRawCreativeIds = Array.from(rawIdSet).filter(
    (id) => !normIdSet.has(id) && !adapterRejIdSet.has(id)
  );
  const overlapNormalizedAndRejectedIds: string[] = [];

  // Check runId consistency on normalized records and associations
  const runIdMismatchCreativeIds: string[] = [];
  for (const r of normRecords) {
    const rid = cleanId(r?.researchRunId);
    const cid = extractCreativeId(r) || "unknown";
    if (rid && cleanRunId && rid !== cleanRunId) {
      runIdMismatchCreativeIds.push(cid);
    }
  }

  // Also check declared counts vs actual record sets
  const declaredRawCount =
    typeof rawManifest?.rawCount === "number" ? rawManifest.rawCount : rawCreatives.length;
  const declaredNormCount =
    typeof normalizationLedger?.normalizedDistinctCount === "number"
      ? normalizationLedger.normalizedDistinctCount
      : normIdSet.size;
  const declaredRejCount =
    typeof normalizationLedger?.rejectedBeforeNormalizationCount === "number"
      ? normalizationLedger.rejectedBeforeNormalizationCount
      : adapterRejIdSet.size;

  const countsMatchDeclared =
    declaredRawCount === rawIdSet.size &&
    declaredNormCount === normIdSet.size &&
    (declaredRejCount === adapterRejIdSet.size ||
      (normIdSet.size === rawIdSet.size && unknownRejectedCreativeIds.length === 0));

  const setInvariantPassed =
    countsMatchDeclared &&
    rawCreatives.length === rawIdSet.size &&
    normRecords.length === normIdSet.size &&
    unknownNormalizedCreativeIds.length === 0 &&
    unknownRejectedCreativeIds.length === 0 &&
    unaccountedRawCreativeIds.length === 0 &&
    runIdMismatchCreativeIds.length === 0 &&
    rawIdSet.size === normIdSet.size + adapterRejIdSet.size;

  // 4. Association Ledger Integrity & Exact vs Probable/Brand Classification
  const associations = Array.isArray(associationLedger?.associations)
    ? associationLedger.associations
    : Array.isArray(associationLedger?.entries)
    ? associationLedger.entries
    : [];

  const validCandidateSet =
    Array.isArray(input.evaluatedCandidateIds) && input.evaluatedCandidateIds.length > 0
      ? new Set(input.evaluatedCandidateIds.map((id) => String(id).trim()).filter(Boolean))
      : null;

  const unknownAssociationCreativeIds: string[] = [];
  const unknownAssociationCandidateIds: string[] = [];

  let verifiedExactCount = 0;
  let verifiedProbableCount = 0;
  let verifiedBrandCount = 0;

  for (const assoc of associations) {
    const acid = extractCreativeId(assoc);
    if (!acid || !rawIdSet.has(acid)) {
      unknownAssociationCreativeIds.push(acid || "missing_creative_id");
    }

    const assocRunId = cleanId(assoc?.researchRunId);
    if (assocRunId && cleanRunId && assocRunId !== cleanRunId) {
      runIdMismatchCreativeIds.push(acid || "assoc_run_mismatch");
    }

    // Validate candidate reference
    const matchedCand =
      cleanId(assoc?.matchedCandidateId) ||
      cleanId(assoc?.candidateId) ||
      cleanId(assoc?.productId);
    const evalCands = Array.isArray(assoc?.candidateIdsEvaluated)
      ? assoc.candidateIdsEvaluated.map(cleanId).filter(Boolean)
      : [];

    if (!matchedCand && evalCands.length === 0) {
      unknownAssociationCandidateIds.push("missing_candidate_id");
    } else if (validCandidateSet) {
      if (matchedCand && !validCandidateSet.has(matchedCand)) {
        unknownAssociationCandidateIds.push(matchedCand);
      }
      for (const ec of evalCands) {
        if (ec && !validCandidateSet.has(ec)) {
          unknownAssociationCandidateIds.push(ec);
        }
      }
    }

    const v = assoc?.associationVerdict || assoc?.associationClassification || assoc?.verdict;
    if (v === "EXACT_PRODUCT_MATCH") {
      if (hasVerifiedExactProductAssociationEvidence(assoc)) {
        verifiedExactCount++;
      } else {
        // Unproven exact claim is downgraded to probable/brand
        verifiedProbableCount++;
      }
    } else if (v === "PROBABLE_PRODUCT_MATCH") {
      verifiedProbableCount++;
    } else if (v === "BRAND_ONLY_MATCH") {
      verifiedBrandCount++;
    }
  }

  // If associations array didn't carry explicit associationVerdict per item, fall back to ledger counts ONLY if verifiedExactCount is 0
  const exactCount =
    associations.some((a: any) => a?.associationVerdict || a?.associationClassification || a?.verdict)
      ? verifiedExactCount
      : 0;
  const probableCount =
    associations.some((a: any) => a?.associationVerdict || a?.associationClassification || a?.verdict)
      ? verifiedProbableCount
      : associationLedger?.probableProductMatchesCount ?? associationLedger?.probableMatches ?? 0;
  const brandCount =
    associations.some((a: any) => a?.associationVerdict || a?.associationClassification || a?.verdict)
      ? verifiedBrandCount
      : associationLedger?.brandLevelMatchesCount ?? associationLedger?.brandOnlyMatches ?? 0;

  const associationsValid =
    Array.isArray(associations) &&
    unknownAssociationCreativeIds.length === 0 &&
    unknownAssociationCandidateIds.length === 0 &&
    runIdMismatchCreativeIds.length === 0 &&
    (rawIdSet.size === 0 || associations.length === rawIdSet.size);

  const g06Transport: "PASS" | "FAIL" = transportOk ? "PASS" : "FAIL";
  const g06LiveRetrieval: "PASS" | "INSUFFICIENT_EVIDENCE" | "FAIL" = !transportOk
    ? "FAIL"
    : liveCount > 0
    ? "PASS"
    : "INSUFFICIENT_EVIDENCE";
  const g06Reconciliation: "PASS" | "FAIL" = setInvariantPassed ? "PASS" : "FAIL";
  const googleProductAssociation: "PASS" | "FAIL" =
    setInvariantPassed && associationsValid ? "PASS" : "FAIL";
  const googleExactSku: "PASS" | "INSUFFICIENT_EVIDENCE" =
    exactCount > 0 ? "PASS" : "INSUFFICIENT_EVIDENCE";

  let overallG06Verdict: "PASS" | "INSUFFICIENT_EVIDENCE" | "FAIL" = "PASS";
  let overallG06Reason = "";

  if (!transportOk) {
    overallG06Verdict = "FAIL";
    overallG06Reason = "Google Ads MCP transport connection failed or lacked invocation proof.";
  } else if (!setInvariantPassed) {
    overallG06Verdict = "FAIL";
    overallG06Reason = `Creative pipeline set reconciliation failed (raw=${rawIdSet.size}, norm=${normIdSet.size}, unaccountedRaw=${unaccountedRawCreativeIds.length}, unknownNorm=${unknownNormalizedCreativeIds.length}, unknownRej=${unknownRejectedCreativeIds.length}).`;
  } else if (!associationsValid) {
    overallG06Verdict = "FAIL";
    overallG06Reason = `Google creative association ledger failed integrity (unknownCreatives=${unknownAssociationCreativeIds.length}, unknownCandidates=${unknownAssociationCandidateIds.length}).`;
  } else if (liveCount === 0) {
    overallG06Verdict = "INSUFFICIENT_EVIDENCE";
    overallG06Reason = "Zero explicitly live, non-cached Google Ads creatives verified for current researchRunId.";
  } else {
    overallG06Verdict = "PASS";
    overallG06Reason = `Retrieved and set-reconciled ${liveCount} live Google Ads creatives (${probableCount} probable product matches, ${brandCount} brand-only matches, ${exactCount} exact SKU matches).`;
  }

  return {
    evaluatedAt: new Date().toISOString(),
    researchRunId: cleanRunId,
    transportStatus: transportOk ? "CONNECTED" : "DISCONNECTED",
    liveCreativesRetrievedCount: liveCount,
    exactProductSkuMatchesCount: exactCount,
    probableProductMatchesCount: probableCount,
    brandOnlyMatchesCount: brandCount,
    pipelineInvariantPassed: setInvariantPassed,
    setReconciliation: {
      rawCreativeIds: Array.from(rawIdSet),
      normalizedCreativeIds: Array.from(normIdSet),
      rejectedCreativeIds: Array.from(adapterRejIdSet),
      unaccountedRawCreativeIds,
      unknownNormalizedCreativeIds,
      unknownRejectedCreativeIds,
      overlapNormalizedAndRejectedIds,
      runIdMismatchCreativeIds,
      unknownAssociationCreativeIds,
      unknownAssociationCandidateIds,
      setInvariantPassed,
    },
    subGates: {
      G06_TRANSPORT: g06Transport,
      G06_LIVE_RETRIEVAL: g06LiveRetrieval,
      G06_CREATIVE_PIPELINE: g06Reconciliation,
      G06_PIPELINE_RECONCILIATION: g06Reconciliation,
      GOOGLE_PRODUCT_ASSOCIATION: googleProductAssociation,
      GOOGLE_EXACT_PRODUCT_EVIDENCE: googleExactSku,
    },
    overallG06Verdict,
    overallG06Reason,
  };
}

function makeValidGoogleGateInput(): GoogleMcpGateInput {
  const runId = "run_test_g06";
  return {
    researchRunId: runId,
    evaluatedCandidateIds: ["c1", "c2", "c3"],
    telemetry: {
      transportStatus: "CONNECTED",
      queryStatus: "PASSED",
      enrichmentExecution: {
        mcpInvocations: [{ toolName: "get_advertiser_ads", status: "SUCCEEDED", returnedCount: 3 }],
      },
    },
    rawManifest: {
      rawCount: 3,
      creatives: [
        {
          creativeId: "cr1",
          sourceMode: "LIVE_PROVIDER",
          provenance: "REAL_UPSTREAM",
          isCached: false,
          researchRunId: runId,
          providerRequestId: "inv_1",
        },
        {
          creativeId: "cr2",
          sourceMode: "LIVE_PROVIDER",
          provenance: "REAL_UPSTREAM",
          isCached: false,
          researchRunId: runId,
          providerRequestId: "inv_1",
        },
        {
          creativeId: "cr3",
          sourceMode: "LIVE_PROVIDER",
          provenance: "REAL_UPSTREAM",
          isCached: false,
          researchRunId: runId,
          providerRequestId: "inv_1",
        },
      ],
    },
    normalizationLedger: {
      normalizedDistinctCount: 3,
      rejectedBeforeNormalizationCount: 0,
      records: [
        { id: "cr1", researchRunId: runId },
        { id: "cr2", researchRunId: runId },
        { id: "cr3", researchRunId: runId },
      ],
      rejectedRecords: [],
    },
    associationLedger: {
      classifiedDistinctCount: 3,
      productLevelMatchesCount: 0,
      probableProductMatchesCount: 2,
      brandLevelMatchesCount: 1,
      associations: [
        {
          creativeId: "cr1",
          matchedCandidateId: "c1",
          researchRunId: runId,
          associationVerdict: "PROBABLE_PRODUCT_MATCH",
        },
        {
          creativeId: "cr2",
          matchedCandidateId: "c2",
          researchRunId: runId,
          associationVerdict: "PROBABLE_PRODUCT_MATCH",
        },
        {
          creativeId: "cr3",
          matchedCandidateId: "c3",
          researchRunId: runId,
          associationVerdict: "BRAND_ONLY_MATCH",
        },
      ],
    },
  };
}

export function runGoogleGateNegativeTests(): {
  totalTests: number;
  totalPassed: number;
  passed: boolean;
  cases: Array<{ testId: string; description: string; passed: boolean; resultVerdict: string }>;
} {
  const cases = [
    {
      testId: "G06-NEG-01",
      description: "Creative with isCached: undefined and no sourceMode is NOT counted as live -> G06 INSUFFICIENT_EVIDENCE",
      exec: () => {
        const base = makeValidGoogleGateInput();
        base.rawManifest.creatives = base.rawManifest.creatives.map((c) => ({
          creativeId: c.creativeId,
          isCached: undefined,
          researchRunId: base.researchRunId,
          providerRequestId: "inv_1",
        }));
        const res = evaluateGoogleMcpGates(base);
        return (
          res.liveCreativesRetrievedCount === 0 &&
          res.overallG06Verdict === "INSUFFICIENT_EVIDENCE"
        );
      },
    },
    {
      testId: "G06-NEG-02",
      description: "Creative with sourceMode: CACHE_ONLY is NOT counted as live",
      exec: () => {
        const base = makeValidGoogleGateInput();
        base.rawManifest.creatives = base.rawManifest.creatives.map((c) => ({
          ...c,
          sourceMode: "CACHE_ONLY",
          provenance: "CACHED_SOURCE",
        }));
        const res = evaluateGoogleMcpGates(base);
        return (
          res.liveCreativesRetrievedCount === 0 &&
          res.overallG06Verdict === "INSUFFICIENT_EVIDENCE"
        );
      },
    },
    {
      testId: "G06-NEG-03",
      description: "Creative from old researchRunId is NOT counted as current-run live",
      exec: () => {
        const base = makeValidGoogleGateInput();
        base.rawManifest.creatives = base.rawManifest.creatives.map((c) => ({
          ...c,
          researchRunId: "run_old_stale",
        }));
        const res = evaluateGoogleMcpGates(base);
        return (
          res.liveCreativesRetrievedCount === 0 &&
          res.overallG06Verdict === "INSUFFICIENT_EVIDENCE"
        );
      },
    },
    {
      testId: "G06-NEG-04",
      description: "Raw count equals normalized + rejected numerically, but creative IDs differ (raw=[c1,c2], norm=[c99], rej=[c88]) -> G06_CREATIVE_PIPELINE FAIL",
      exec: () => {
        const base = makeValidGoogleGateInput();
        base.rawManifest = {
          rawCount: 2,
          creatives: [
            {
              creativeId: "c1",
              sourceMode: "LIVE_PROVIDER",
              isCached: false,
              researchRunId: base.researchRunId,
              providerRequestId: "inv_1",
            },
            {
              creativeId: "c2",
              sourceMode: "LIVE_PROVIDER",
              isCached: false,
              researchRunId: base.researchRunId,
              providerRequestId: "inv_1",
            },
          ],
        };
        base.normalizationLedger = {
          normalizedDistinctCount: 1,
          rejectedBeforeNormalizationCount: 1,
          records: [{ id: "c99", researchRunId: base.researchRunId }],
          rejectedRecords: [{ creativeId: "c88" }],
        };
        const res = evaluateGoogleMcpGates(base);
        return (
          res.subGates.G06_CREATIVE_PIPELINE === "FAIL" &&
          res.overallG06Verdict === "FAIL"
        );
      },
    },
    {
      testId: "G06-NEG-05",
      description: "Association ledger references unknown creativeId -> GOOGLE_PRODUCT_ASSOCIATION FAIL",
      exec: () => {
        const base = makeValidGoogleGateInput();
        base.associationLedger.associations![0].creativeId = "cr_unknown_999";
        const res = evaluateGoogleMcpGates(base);
        return (
          res.subGates.GOOGLE_PRODUCT_ASSOCIATION === "FAIL" &&
          res.overallG06Verdict === "FAIL"
        );
      },
    },
    {
      testId: "G06-NEG-06",
      description: "Association ledger references unknown candidateId -> GOOGLE_PRODUCT_ASSOCIATION FAIL",
      exec: () => {
        const base = makeValidGoogleGateInput();
        base.associationLedger.associations![0].matchedCandidateId = "cand_nonexistent_999";
        const res = evaluateGoogleMcpGates(base);
        return (
          res.subGates.GOOGLE_PRODUCT_ASSOCIATION === "FAIL" &&
          res.overallG06Verdict === "FAIL"
        );
      },
    },
    {
      testId: "G06-NEG-07",
      description: "PROBABLE_PRODUCT_MATCH only -> exactProductMatchCount=0, probableProductMatchCount>0, GOOGLE_EXACT_PRODUCT_EVIDENCE=INSUFFICIENT_EVIDENCE",
      exec: () => {
        const base = makeValidGoogleGateInput();
        const res = evaluateGoogleMcpGates(base);
        return (
          res.exactProductSkuMatchesCount === 0 &&
          res.probableProductMatchesCount > 0 &&
          res.subGates.GOOGLE_EXACT_PRODUCT_EVIDENCE === "INSUFFICIENT_EVIDENCE"
        );
      },
    },
    {
      testId: "G06-NEG-08",
      description: "BRAND_ONLY_MATCH only -> exactProductMatchCount=0, brandOnlyMatchCount>0, GOOGLE_EXACT_PRODUCT_EVIDENCE=INSUFFICIENT_EVIDENCE",
      exec: () => {
        const base = makeValidGoogleGateInput();
        base.associationLedger.associations = base.associationLedger.associations!.map((a) => ({
          ...a,
          associationVerdict: "BRAND_ONLY_MATCH",
        }));
        const res = evaluateGoogleMcpGates(base);
        return (
          res.exactProductSkuMatchesCount === 0 &&
          res.brandOnlyMatchesCount === 3 &&
          res.subGates.GOOGLE_EXACT_PRODUCT_EVIDENCE === "INSUFFICIENT_EVIDENCE"
        );
      },
    },
    {
      testId: "G06-NEG-09",
      description: "Transport failed with cached creatives present -> G06_TRANSPORT FAIL",
      exec: () => {
        const base = makeValidGoogleGateInput();
        base.telemetry = {
          transportStatus: "DISCONNECTED",
          queryStatus: "TRANSPORT_FAILED",
          enrichmentExecution: { mcpInvocations: [] },
        };
        const res = evaluateGoogleMcpGates(base);
        return (
          res.subGates.G06_TRANSPORT === "FAIL" &&
          res.overallG06Verdict === "FAIL"
        );
      },
    },
    {
      testId: "G06-NEG-10",
      description: "Authentic live creatives with set-reconciled pipeline and brand/probable matches -> G06 PASS, GOOGLE_EXACT_PRODUCT_EVIDENCE INSUFFICIENT_EVIDENCE",
      exec: () => {
        const base = makeValidGoogleGateInput();
        const res = evaluateGoogleMcpGates(base);
        return (
          res.subGates.G06_TRANSPORT === "PASS" &&
          res.subGates.G06_CREATIVE_PIPELINE === "PASS" &&
          res.subGates.GOOGLE_PRODUCT_ASSOCIATION === "PASS" &&
          res.subGates.GOOGLE_EXACT_PRODUCT_EVIDENCE === "INSUFFICIENT_EVIDENCE" &&
          res.overallG06Verdict === "PASS"
        );
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
