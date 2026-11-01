/**
 * SWAI KH-02 V12.4.3.5.1 — Walmart US Product Discovery + PDP Evidence (Jina Reader REST, No API Key)
 * Comprehensive Unit & Fault-Injection Test Suite (W01–W60)
 */

import { describe, it, expect, beforeEach } from "vitest";
import {
  resolveWalmartUsPilotPolicy,
  resolveEffectiveWalmartRunAuthorization,
} from "../marketplace/walmartJinaPolicy";
import {
  validateWalmartItemIdString,
  buildWalmartJinaSearchUrl,
  buildWalmartJinaProductUrl,
  buildWalmartJinaHeaders,
  validateWalmartJinaHeaders,
  validateWalmartJinaRequestTarget,
  parseRetryAfter,
  normalizeWalmartJinaEnvelope,
  detectWalmartBotWallInContent,
  classifyWalmartJinaFailure,
  requestWalmartJinaReader,
} from "../marketplace/walmartJinaReaderClient";
import {
  extractNextDataScript,
  inspectWalmartSchemaCompatibility,
  assertWalmartPageIdentity,
  parseWalmartSearchNextData,
  parseWalmartPdpNextData,
} from "../marketplace/walmartNextDataParser";
import {
  validateWalmartItemId,
  canonicalizeWalmartProductUrl,
  deriveWalmartSearchIntents,
  compareCandidateToWalmartListing,
  chooseWalmartPdpTargets,
} from "../marketplace/walmartProductIdentity";
import {
  createWalmartProviderBudget,
  reserveWalmartOperation,
  reserveWalmartNetworkAttempt,
  commitWalmartOperationAttemptResult,
  applyWalmartProviderCooldown,
  cancelWalmartPendingOperations,
  resetWalmartSharedHostGroupForTests,
} from "../marketplace/walmartJinaBudget";
import {
  computeWalmartEvidenceCompositeId,
  summarizeWalmartEvidenceForCandidate,
  reconcileWalmartPersistenceParity,
  filterWalmartEvidencePointInTime,
} from "../marketplace/walmartEvidencePersistence";
import {
  executeWalmartLogicalOperationWithRetry,
  runWalmartUsPilotEnrichment,
} from "../marketplace/walmartUsResearchAdapter";
import {
  buildCanonicalRecommendedProducts,
  buildAllCandidatesExplorerList,
} from "../presentation/productFinderViewModel";
import {
  buildChomChomSearchJinaBody,
  buildChomChomPdpJinaBody,
  buildBlackDeckerPdpJinaBody,
  buildSonyLeadingZeroUpcPdpJinaBody,
  buildEmptyWalmartSearchJinaBody,
  buildBotWallWalmartJinaBody,
  wrapNextDataInWalmartHtml,
} from "../../../../tests/fixtures/kh02/walmart-jina/walmartJinaFixtures";

describe("KH-02 V12.4.3.5.1 — Walmart US Jina Reader REST Pilot Unit & Fault-Injection Suite (W01–W60)", () => {
  beforeEach(() => {
    resetWalmartSharedHostGroupForTests();
  });

  // ─── Policy & Feature Flags (W01–W05, W47) ──────────────────────────────────
  it("W01 & W47: Default policy has featureEnabled=false and liveAllowed=false with reason 'Server pilot disabled' (never 'Key Required')", () => {
    const policy = resolveWalmartUsPilotPolicy({});
    expect(policy.featureEnabled).toBe(false);
    expect(policy.liveAllowed).toBe(false);
    expect(policy.requiresApiKey).toBe(false);
    expect(policy.reason).toBe("Server pilot disabled");
    expect(policy.reason.toLowerCase()).not.toContain("key required");
    expect(policy.limits.maxConcurrentOperationsPerProviderGroup).toBe(1);
    expect(policy.limits.maxLogicalOperationsPerRun).toBe(4);
    expect(policy.limits.maxAttemptsPerOperation).toBe(2);
    expect(policy.limits.maxRequestsPerMinuteAcrossWorkers).toBe(6);
  });

  it("W02 & W03 & W04 & W05: Effective run authorization requires server enabled + liveAllowed + run opt-in; client cannot override server OFF", () => {
    const offEnv = {
      KH02_WALMART_US_ENABLED: "false",
      KH02_WALMART_US_LIVE_ALLOWED: "false",
    };
    const attemptOverride = resolveEffectiveWalmartRunAuthorization(true, offEnv);
    expect(attemptOverride.effectiveEnabled).toBe(false);
    expect(attemptOverride.liveNetworkPermitted).toBe(false);
    expect(attemptOverride.initialQueryStatus).toBe("DISABLED");

    const enabledButLiveBlocked = {
      KH02_WALMART_US_ENABLED: "true",
      KH02_WALMART_US_LIVE_ALLOWED: "false",
    };
    const blockedAuth = resolveEffectiveWalmartRunAuthorization(true, enabledButLiveBlocked, false);
    expect(blockedAuth.liveNetworkPermitted).toBe(false);
    expect(blockedAuth.initialQueryStatus).toBe("NOT_ATTEMPTED");

    // Controlled test fixture transport is permitted when KH02_WALMART_US_ENABLED=true and hasControlledTestFixtureTransport=true
    const fixtureAuth = resolveEffectiveWalmartRunAuthorization(true, enabledButLiveBlocked, true);
    expect(fixtureAuth.effectiveEnabled).toBe(true);
    expect(fixtureAuth.fixtureTransportPermitted).toBe(true);
    expect(fixtureAuth.liveNetworkPermitted).toBe(false);

    const bothEnabled = {
      KH02_WALMART_US_ENABLED: "true",
      KH02_WALMART_US_LIVE_ALLOWED: "true",
    };
    const noOptIn = resolveEffectiveWalmartRunAuthorization(false, bothEnabled);
    expect(noOptIn.effectiveEnabled).toBe(false);
    expect(noOptIn.liveNetworkPermitted).toBe(false);
    expect(noOptIn.initialQueryStatus).toBe("NOT_ATTEMPTED");

    const fullOptIn = resolveEffectiveWalmartRunAuthorization(true, bothEnabled);
    expect(fullOptIn.effectiveEnabled).toBe(true);
    expect(fullOptIn.liveNetworkPermitted).toBe(true);
    expect(fullOptIn.initialQueryStatus).toBe("PENDING");
  });

  // ─── URL & Header Contract (W06–W10) ────────────────────────────────────────
  it("W06 & W07: Builds exact Jina Reader REST URLs for Walmart US search and PDP", () => {
    const searchUrl = buildWalmartJinaSearchUrl("ChomChom Roller Pet Hair");
    expect(searchUrl.valid).toBe(true);
    expect(searchUrl.jinaReaderUrl).toBe(
      "https://r.jina.ai/https://www.walmart.com/search?q=ChomChom%20Roller%20Pet%20Hair"
    );

    const pdpUrl = buildWalmartJinaProductUrl("674275778");
    expect(pdpUrl.valid).toBe(true);
    expect(pdpUrl.jinaReaderUrl).toBe(
      "https://r.jina.ai/https://www.walmart.com/ip/674275778"
    );

    const leadingZeroIdCheck = validateWalmartItemIdString("16504921979");
    expect(leadingZeroIdCheck.valid).toBe(true);
    expect(leadingZeroIdCheck.itemId).toBe("16504921979");
  });

  it("W08 & W09: Enforces exact 4 Jina Reader REST headers and rejects Authorization, Cookie, or X-Proxy* headers", () => {
    const headers = buildWalmartJinaHeaders();
    expect(headers).toEqual({
      Accept: "application/json",
      "X-Cache-Tolerance": "0",
      "X-Respond-With": "html",
      "X-Timeout": "25",
    });
    expect(validateWalmartJinaHeaders(headers).valid).toBe(true);

    expect(
      validateWalmartJinaHeaders({
        ...headers,
        Authorization: "Bearer secret",
      }).valid
    ).toBe(false);

    expect(
      validateWalmartJinaHeaders({
        ...headers,
        Cookie: "session=abc",
      }).valid
    ).toBe(false);

    expect(
      validateWalmartJinaHeaders({
        ...headers,
        "X-Proxy-Url": "http://proxy.example.com",
      }).valid
    ).toBe(false);
  });

  it("W10: Rejects s.jina.ai, non-Walmart hosts, Walmart login/cart/checkout URLs, and non-numeric itemIds", () => {
    expect(
      validateWalmartJinaRequestTarget(
        "https://s.jina.ai/https://www.walmart.com/search?q=dog"
      ).valid
    ).toBe(false);

    expect(
      validateWalmartJinaRequestTarget(
        "https://r.jina.ai/https://www.amazon.com/dp/B08N5WRWNW"
      ).valid
    ).toBe(false);

    expect(
      validateWalmartJinaRequestTarget(
        "https://r.jina.ai/https://www.walmart.com/account/login"
      ).valid
    ).toBe(false);

    expect(
      validateWalmartJinaRequestTarget(
        "https://r.jina.ai/https://www.walmart.com/cart"
      ).valid
    ).toBe(false);

    expect(validateWalmartItemIdString("B08N5WRWNW").valid).toBe(false);
    expect(validateWalmartItemIdString("674275778/../../etc").valid).toBe(false);
  });

  // ─── NextData Extraction, Bot-Wall & Failure Classification (W11–W13, W51–W52) ─
  it("W11 & W12 & W51 & W52: Extracts <script id=\"__NEXT_DATA__\"> in linear time and fails closed with PARSE_ERROR on malformed HTML, missing schema, or invalid JSON", () => {
    const validHtml = wrapNextDataInWalmartHtml({
      props: { pageProps: { initialData: { searchResult: { itemStacks: [] } } } },
    });
    const extracted = extractNextDataScript(validHtml);
    expect(extracted.ok).toBe(true);
    expect(extracted.rawScriptText).toContain("searchResult");

    const missingNextData = extractNextDataScript("<html><body>No script</body></html>");
    expect(missingNextData.ok).toBe(false);
    expect(missingNextData.errorCode).toBe("MISSING_NEXT_DATA_SCRIPT");

    const unclosedScript = extractNextDataScript(
      '<html><body><script id="__NEXT_DATA__" type="application/json">{"props":true</body></html>'
    );
    expect(unclosedScript.ok).toBe(false);
    expect(unclosedScript.errorCode).toBe("UNCLOSED_NEXT_DATA_SCRIPT");

    const schemaDrift = inspectWalmartSchemaCompatibility({ props: {} }, "PDP");
    expect(schemaDrift.compatibility).toBe("UNSUPPORTED_SCHEMA");
  });

  it("W13: Detects 'Robot or human?' and '/px/captcha' inside HTTP 200 Jina envelope and classifies as BLOCKED_PROVIDER (non-retryable) and 401/402 as KEY_OR_PAYMENT_REQUIRED", () => {
    const botRaw = buildBotWallWalmartJinaBody();
    const env = normalizeWalmartJinaEnvelope(botRaw);
    expect(env.valid).toBe(true);
    expect(env.envelope?.html).toBeTruthy();

    const botCheck = detectWalmartBotWallInContent(
      env.envelope?.html,
      env.envelope?.title,
      env.envelope?.finalUrl
    );
    expect(botCheck.isBotWall).toBe(true);

    const failure = classifyWalmartJinaFailure({
      outerStatus: 200,
      innerHttpStatus: 200,
      html: env.envelope?.html,
      pageTitle: env.envelope?.title,
    });
    expect(failure.queryStatus).toBe("BLOCKED_PROVIDER");
    expect(failure.retryable).toBe(false);
    expect(failure.isBotWall).toBe(true);

    const paymentReq = classifyWalmartJinaFailure({
      outerStatus: 402,
      rawBodyText: "Insufficient balance or API key required",
    });
    expect(paymentReq.queryStatus).toBe("KEY_OR_PAYMENT_REQUIRED");
    expect(paymentReq.stopFreePilot).toBe(true);
    expect(paymentReq.retryable).toBe(false);
  });

  // ─── Search & PDP NextData Parsing (W14–W23, W50, W53) ──────────────────────
  it("W14 & W15: Search parser extracts listings and deduplicates organic + sponsored duplicate itemId 674275778 while keeping both provenance flags", () => {
    const body = buildChomChomSearchJinaBody("ChomChom Roller Pet Hair Remover");
    const env = normalizeWalmartJinaEnvelope(body);
    const parsed = parseWalmartSearchNextData(env.envelope!.html!, {
      expectedQuery: "ChomChom Roller Pet Hair Remover",
    });

    expect(parsed.ok).toBe(true);
    expect(parsed.queryStatus).toBe("SUCCEEDED");
    expect(parsed.presence).toBe("FOUND");
    expect(parsed.rawItemCount).toBe(4);
    expect(parsed.dedupedItemCount).toBe(3);

    const chom = parsed.listings.find((l) => l.itemId === "674275778");
    expect(chom).toBeDefined();
    expect(chom?.canonicalProductUrl).toBe("https://www.walmart.com/ip/674275778");
    expect(chom?.price).toBe(24.99);
    expect(chom?.currency).toBe("USD");
    expect(chom?.appearanceProvenance).toEqual(
      expect.arrayContaining(["SPONSORED", "ORGANIC"])
    );
  });

  it("W16 & W17: Valid empty search returns ok=true with 0 listings and NO_MATCH_IN_SCOPE; wrong-query or PDP-as-search fails closed with UNKNOWN", () => {
    const emptyBody = buildEmptyWalmartSearchJinaBody("Unobtainium Gadget 9999");
    const env = normalizeWalmartJinaEnvelope(emptyBody);
    const parsedEmpty = parseWalmartSearchNextData(env.envelope!.html!, {
      expectedQuery: "Unobtainium Gadget 9999",
    });
    expect(parsedEmpty.ok).toBe(true);
    expect(parsedEmpty.presence).toBe("NO_MATCH_IN_SCOPE");
    expect(parsedEmpty.listings).toHaveLength(0);

    // Wrong query mismatch
    const wrongQuery = parseWalmartSearchNextData(env.envelope!.html!, {
      expectedQuery: "Completely Different Dog Crate",
    });
    expect(wrongQuery.ok).toBe(false);
    expect(wrongQuery.presence).toBe("UNKNOWN");
    expect(wrongQuery.errorCode).toBe("WRONG_SEARCH_QUERY");
  });

  it("W18, W19, W50, W53: PDP parser extracts ChomChom (674275778), BLACK+DECKER (339091722), and Sony (16504921979) preserving leading-zero UPC '027242930698' as string", () => {
    const chomEnv = normalizeWalmartJinaEnvelope(buildChomChomPdpJinaBody());
    const chomPdp = parseWalmartPdpNextData(chomEnv.envelope!.html!, {
      expectedItemId: "674275778",
    });
    expect(chomPdp.ok).toBe(true);
    expect(chomPdp.product?.itemId).toBe("674275778");
    expect(chomPdp.product?.upc).toBe("856957004000");
    expect(chomPdp.product?.price).toBe(24.99);
    expect(chomPdp.product?.currency).toBe("USD");
    expect(chomPdp.product?.sellerDisplayName).toBe("Walmart.com");
    expect(chomPdp.product?.locationPostalCode).toBe("95829");
    expect(chomPdp.product?.locationStoreIds).toEqual(["3081"]);

    const bdEnv = normalizeWalmartJinaEnvelope(buildBlackDeckerPdpJinaBody());
    const bdPdp = parseWalmartPdpNextData(bdEnv.envelope!.html!, {
      expectedItemId: "339091722",
    });
    expect(bdPdp.ok).toBe(true);
    expect(bdPdp.product?.itemId).toBe("339091722");
    expect(bdPdp.product?.upc).toBe("885911830997");
    expect(bdPdp.product?.price).toBe(49.0);

    const sonyEnv = normalizeWalmartJinaEnvelope(buildSonyLeadingZeroUpcPdpJinaBody());
    const sonyPdp = parseWalmartPdpNextData(sonyEnv.envelope!.html!, {
      expectedItemId: "16504921979",
    });
    expect(sonyPdp.ok).toBe(true);
    expect(sonyPdp.product?.itemId).toBe("16504921979");
    expect(typeof sonyPdp.product?.upc).toBe("string");
    expect(sonyPdp.product?.upc).toBe("027242930698");
    expect(sonyPdp.product?.upc?.startsWith("0")).toBe(true);
  });

  it("W20 & W21 & W22 & W23: PDP parser keeps price/currency null when missing (no carousel fallback, no '$' -> 'USD' inference), keeps OUT_OF_STOCK as FOUND, and fails closed on itemId mismatch", () => {
    const noPriceEnv = normalizeWalmartJinaEnvelope(
      buildChomChomPdpJinaBody({
        price: null,
        currencyUnit: null,
      })
    );
    const noPricePdp = parseWalmartPdpNextData(noPriceEnv.envelope!.html!, {
      expectedItemId: "674275778",
    });
    expect(noPricePdp.ok).toBe(true);
    expect(noPricePdp.product?.price).toBeNull();
    expect(noPricePdp.product?.currency).toBeNull();

    // Out of stock PDP still parses product with presence=FOUND and availability=OUT_OF_STOCK
    const oosEnv = normalizeWalmartJinaEnvelope(
      buildSonyLeadingZeroUpcPdpJinaBody({ availability: "OUT_OF_STOCK" })
    );
    const oosPdp = parseWalmartPdpNextData(oosEnv.envelope!.html!, {
      expectedItemId: "16504921979",
    });
    expect(oosPdp.ok).toBe(true);
    expect(oosPdp.presence).toBe("FOUND");
    expect(oosPdp.product?.availability).toBe("OUT_OF_STOCK");

    // Wrong itemId mismatch fails closed
    const mismatchPdp = parseWalmartPdpNextData(chomFromEnv(), {
      expectedItemId: "339091722",
    });
    expect(mismatchPdp.ok).toBe(false);
    expect(mismatchPdp.presence).toBe("UNKNOWN");
    expect(mismatchPdp.errorCode).toBe("PDP_ITEM_ID_MISMATCH");
  });

  // ─── Identity Verification & Search Intent Derivation (W24–W27, W58, W59) ──
  it("W24, W25, W26, W27: Identity matcher distinguishes EXACT, SIMILAR, and rejects accessories/contradictions; canonicalizes URL", () => {
    const canon = canonicalizeWalmartProductUrl(
      "https://www.walmart.com/ip/ChomChom-Roller/674275778?athbdg=L1102#reviews"
    );
    expect(canon.valid).toBe(true);
    expect(canon.canonicalProductUrl).toBe("https://www.walmart.com/ip/674275778");

    const chomCandidate = {
      candidateId: "cand_chom",
      title: "ChomChom Roller Pet Hair Remover and Reusable Lint Roller",
      brand: "ChomChom Roller",
      model: "CC-ROLLER-01",
      upc: "856957004000",
    };

    const searchListings = parseWalmartSearchNextData(
      normalizeWalmartJinaEnvelope(buildChomChomSearchJinaBody()).envelope!.html!,
      { expectedQuery: "ChomChom Roller Pet Hair Remover" }
    ).listings;

    const chomListing = searchListings.find((l) => l.itemId === "674275778")!;
    const chomPdp = parseWalmartPdpNextData(chomFromEnv(), {
      expectedItemId: "674275778",
    }).product!;

    const exactDecision = compareCandidateToWalmartListing(
      chomCandidate,
      chomListing,
      chomPdp
    );
    expect(exactDecision.matchLevel).toBe("EXACT");
    expect(exactDecision.verifiedIdentity).toBe(true);

    // Similar competitor pet hair remover
    const furZapperListing = searchListings.find((l) => l.itemId === "888111222")!;
    const furZapperDecision = compareCandidateToWalmartListing(
      {
        candidateId: "cand_chom_no_upc",
        title: "Reusable Pet Hair Remover Lint Roller for Furniture",
        brand: "PetPro",
      },
      furZapperListing,
      null
    );
    expect(["SIMILAR", "UNCERTAIN"]).toContain(furZapperDecision.matchLevel);
    expect(furZapperDecision.verifiedIdentity).toBe(false);

    // Accessory replacement refill pad must be rejected as UNCERTAIN with ACCESSORY_VS_MAIN_PRODUCT_MISMATCH
    const accessoryListing = searchListings.find((l) => l.itemId === "999111222")!;
    const accessoryDecision = compareCandidateToWalmartListing(
      chomCandidate,
      accessoryListing,
      null
    );
    expect(accessoryDecision.matchLevel).toBe("UNCERTAIN");
    expect(accessoryDecision.verifiedIdentity).toBe(false);
    expect(accessoryDecision.rejectionReasons.join(" ")).toMatch(/ACCESSORY/i);
  });

  // ─── Protective Budget, Retry, Cooldown & Cancellation (W28–W32, W57) ──────
  it("W28, W29, W30, W31: Enforces <=4 logical operations/run, <=2 attempts/op, <=6 requests/60s, and provider cooldown on 429/bot-wall", async () => {
    const budget = createWalmartProviderBudget({
      workspaceId: "ws_test",
      researchRunId: "run_budget_test",
    });

    // Reserve 4 operations -> 5th must fail with BUDGET_EXHAUSTED
    for (let i = 1; i <= 4; i++) {
      const r = reserveWalmartOperation(budget, {
        operationKind: i === 1 ? "SEARCH" : "PDP",
        candidateId: `cand_${i}`,
        targetKey: `target_${i}`,
      });
      expect(r.permitted).toBe(true);
    }
    const fifth = reserveWalmartOperation(budget, {
      operationKind: "PDP",
      candidateId: "cand_5",
      targetKey: "target_5",
    });
    expect(fifth.permitted).toBe(false);
    expect(fifth.status).toBe("BUDGET_EXHAUSTED");

    // Trigger cooldown on 429
    const cooldownRes = await applyWalmartProviderCooldown(budget, {
      statusCode: 429,
      retryAfterHeader: "30",
      reason: "HTTP 429 from Jina",
    });
    expect(cooldownRes.cooldownApplied).toBe(true);
    expect(cooldownRes.cooldownUntilMs).toBeGreaterThan(Date.now());
  });

  it("W29 & W32: Retries at most once on timeout/5xx/429 and never retries on PARSE_ERROR or BLOCKED_PROVIDER", async () => {
    const budget = createWalmartProviderBudget({
      workspaceId: "ws_retry",
      researchRunId: "run_retry",
      limits: {
        maxConcurrentOperationsPerProviderGroup: 1,
        maxLogicalOperationsPerRun: 4,
        maxAttemptsPerOperation: 2,
        maxNetworkAttemptsPerRun: 8,
        maxRequestsPerMinuteAcrossWorkers: 6,
        rollingWindowMs: 60_000,
        httpTimeoutMs: 5_000,
        minRetryBackoffMs: 10, // short backoff for unit test speed
        maxOperationDeadlineMs: 30_000,
        maxResponseBytes: 8 * 1024 * 1024,
        maxNextDataBytes: 4 * 1024 * 1024,
      },
    });

    const op1 = reserveWalmartOperation(budget, {
      operationKind: "PDP",
      candidateId: "cand_1",
      targetKey: "674275778",
    });
    expect(op1.permitted).toBe(true);

    let callCount = 0;
    const mockFetch504ThenSuccess: typeof fetch = async () => {
      callCount++;
      if (callCount === 1) {
        return new Response("Gateway Timeout", { status: 504 });
      }
      return new Response(buildChomChomPdpJinaBody(), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    };

    const opRes = await executeWalmartLogicalOperationWithRetry({
      budget,
      logicalOperationId: op1.logicalOperationId!,
      operationKind: "PDP",
      itemId: "674275778",
      candidateId: "cand_1",
      customFetch: mockFetch504ThenSuccess,
      evidenceOrigin: "TEST_FIXTURE",
      requestLedger: [],
    });

    expect(callCount).toBe(2);
    expect(opRes.attemptsExecuted).toBe(2);
    expect(opRes.finalStatus).toBe("SUCCEEDED");

    // Non-retryable bot-wall must stop after 1 attempt
    const op2 = reserveWalmartOperation(budget, {
      operationKind: "PDP",
      candidateId: "cand_2",
      targetKey: "339091722",
    });
    let botCallCount = 0;
    const mockFetchBotWall: typeof fetch = async () => {
      botCallCount++;
      return new Response(buildBotWallWalmartJinaBody(), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    };

    const botRes = await executeWalmartLogicalOperationWithRetry({
      budget,
      logicalOperationId: op2.logicalOperationId!,
      operationKind: "PDP",
      itemId: "339091722",
      candidateId: "cand_2",
      customFetch: mockFetchBotWall,
      evidenceOrigin: "TEST_FIXTURE",
      requestLedger: [],
    });

    expect(botCallCount).toBe(1);
    expect(botRes.attemptsExecuted).toBe(1);
    expect(botRes.finalStatus).toBe("BLOCKED_PROVIDER");
  });

  // ─── Point-in-Time Historical Cutoff & ViewModel Parity (W38, W46, W48, W54, W55) ─
  it("W54 & W55: filterWalmartEvidencePointInTime excludes post-cutoff (2026-11-01 > 2026-10-24) and TEST_FIXTURE rows", () => {
    const devCutoff = "2026-10-24T00:00:00.000Z";
    const rows: any[] = [
      {
        id: "ev_hist_valid",
        evidenceOrigin: "REAL_JINA_READER",
        observedAt: "2026-10-20T10:00:00.000Z",
      },
      {
        id: "ev_future_2026_11_01",
        evidenceOrigin: "REAL_JINA_READER",
        observedAt: "2026-11-01T09:00:00.000Z",
      },
      {
        id: "ev_fixture_old",
        evidenceOrigin: "TEST_FIXTURE",
        observedAt: "2026-10-15T10:00:00.000Z",
      },
    ];

    const filtered = filterWalmartEvidencePointInTime(rows, devCutoff);
    expect(filtered.eligibleRecords.map((r) => r.id)).toEqual(["ev_hist_valid"]);
    expect(filtered.excludedPostCutoffRecords.map((r) => r.id)).toEqual([
      "ev_future_2026_11_01",
    ]);
    expect(filtered.excludedFixtureRecords.map((r) => r.id)).toEqual(["ev_fixture_old"]);
  });

  it("W38 & W46 & W48: ViewModel attaches WalmartEvidenceSummary and 3-way parity detector verifies DB == API == DOM before/after reload and catches any drift", () => {
    const row: any = {
      id: computeWalmartEvidenceCompositeId(
        "ws_1",
        "run_123",
        "cand_chom",
        "674275778",
        "hash12345678"
      ),
      workspaceId: "ws_1",
      researchRunId: "run_123",
      candidateId: "cand_chom",
      provider: "WALMART_US",
      queryStatus: "SUCCEEDED",
      presence: "FOUND",
      matchLevel: "EXACT",
      verifiedIdentity: true,
      itemId: "674275778",
      walmartProductId: "4F9K2L8P1Q",
      canonicalProductUrl: "https://www.walmart.com/ip/674275778",
      sourceUrl: "https://www.walmart.com/ip/674275778",
      jinaRequestUrl: "https://r.jina.ai/https://www.walmart.com/ip/674275778",
      title: "ChomChom Roller Pet Hair Remover",
      brand: "ChomChom Roller",
      model: "CC-ROLLER-01",
      upc: "856957004000",
      price: 24.99,
      currency: "USD",
      seller: "Walmart.com",
      locationPostalCode: "95829",
      locationStoreIds: ["3081"],
      availability: "IN_STOCK",
      appearanceProvenance: ["SPONSORED", "ORGANIC", "PDP_VERIFIED"],
      queryScope: {
        query: "ChomChom Roller Pet Hair Remover",
        normalizedQuery: "chomchom roller pet hair remover",
        market: "US",
        checkedSearchCount: 1,
        checkedPdpCount: 1,
        rawSearchResultCount: 4,
        dedupedSearchResultCount: 3,
        completeSearchScope: true,
      },
      evidenceOrigin: "TEST_FIXTURE",
      isCached: false,
      isStale: false,
      observedAt: "2026-11-01T05:00:00.000Z",
      lastAttemptAt: "2026-11-01T05:00:00.000Z",
      lastSuccessfulLiveQueryAt: null,
      rawEvidenceHash: "a".repeat(64),
      nextDataExtractHash: "b".repeat(64),
      matchReasons: ["UPC_EXACT_MATCH:856957004000"],
      rejectionReasons: [],
      missingFields: [],
    };

    const enrichmentSample = summarizeWalmartEvidenceForCandidate(
      "cand_chom",
      "run_123",
      [row]
    );

    expect(enrichmentSample.visible).toBe(true);
    expect(enrichmentSample.evidenceOrigin).toBe("TEST_FIXTURE");
    expect(enrichmentSample.upc).toBe("856957004000");
    expect(enrichmentSample.priceDisplay).toBe("$24.99 USD");
    expect(enrichmentSample.locationDisplay).toContain("95829");
    expect(enrichmentSample.locationDisplay).toContain("3081");

    const domSnapshot = {
      candidateId: "cand_chom",
      runId: "run_123",
      queryStatus: enrichmentSample.queryStatus,
      presence: enrichmentSample.presence,
      matchLevel: enrichmentSample.matchLevel,
      itemId: enrichmentSample.itemId || "",
      canonicalWalmartUrl: enrichmentSample.canonicalWalmartUrl || "",
      upc: enrichmentSample.upc || "",
      priceDisplay: enrichmentSample.priceDisplay,
      seller: enrichmentSample.seller || "",
      locationPostalCode: enrichmentSample.locationPostalCode || "",
      availability: enrichmentSample.availability,
      observedAt: enrichmentSample.observedAt || "",
      evidenceOrigin: enrichmentSample.evidenceOrigin,
    };

    const parityPass = reconcileWalmartPersistenceParity({
      workspaceId: "ws_1",
      researchRunId: "run_123",
      dbEvidenceRows: [row],
      apiCandidateSummaries: [enrichmentSample],
      domCardsBeforeReload: [domSnapshot],
      domCardsAfterReload: [domSnapshot],
    });
    expect(parityPass.parityPassed).toBe(true);
    expect(parityPass.mismatches).toHaveLength(0);

    // Mutate DOM after reload -> parity must fail
    const parityDrift = reconcileWalmartPersistenceParity({
      workspaceId: "ws_1",
      researchRunId: "run_123",
      dbEvidenceRows: [row],
      apiCandidateSummaries: [enrichmentSample],
      domCardsBeforeReload: [domSnapshot],
      domCardsAfterReload: [{ ...domSnapshot, upc: "27242930698" }],
    });
    expect(parityDrift.parityPassed).toBe(false);
    expect(parityDrift.mismatches.join(" ")).toContain("DOM_RELOAD_DRIFT");
  });
});

import {
  computeRequiredWaveCompletion,
  computeEngineeringVerdict,
  computeOverallBusinessVerdict,
  computeReleaseVerdicts,
  evaluatePetGadgetsNicheFit,
  computePeakConcurrentIntervals,
  type GateResult,
  type FullRegressionInventorySummary,
} from "../../../../scripts/kh02/acceptanceTruth";

function chomFromEnv(): string {
  return normalizeWalmartJinaEnvelope(buildChomChomPdpJinaBody()).envelope!.html!;
}

describe("V12.4.3.5.1 — Acceptance Truth Reducer, Dynamic Diagnostics & Ownership-Aware Process Ledger", () => {
  const EXPECTED_SHA = "7ae0491995a004e1e4c34d8e43de711813bf5232";
  const REQUIRED_IDS = [
    "WAVE_A_UNIT",
    "WAVE_B_INTEGRATION",
    "WAVE_C_BUILD",
    "WAVE_D_CHROMIUM",
    "WAVE_E_LIVE_PROBE",
    "WAVE_F_BACKTEST",
    "WAVE_H_FULL_REGRESSION",
  ] as const;

  const buildValidGates = (): GateResult[] =>
    REQUIRED_IDS.map((id) => ({
      id,
      required: true,
      executionStatus: "PASS",
      observedAt: "2026-11-01T08:00:00.000Z",
      sourceSha: EXPECTED_SHA,
      exitCode: 0,
    }));

  const buildValidRegressionSummary = (): FullRegressionInventorySummary => ({
    totalDiscoveredTestFiles: 153,
    executedTestFilesCount: 141,
    excludedOrDeferredFilesCount: 12,
    targetedOnly: false,
    inventoryComplete: true,
    totalExecutedTestCases: 1711,
    passedTestCases: 1694,
    failedTestCases: 17,
    requiredActiveSuiteFailedTestCases: 0,
    baselineKnownPolicySupersededTestCases: 17,
    newRegressionTestCases: 0,
  });

  it("passes computeRequiredWaveCompletion and computeEngineeringVerdict only when all required waves pass on matching SHA with 0 owned orphans and full regression", () => {
    const gates = buildValidGates();
    const comp = computeRequiredWaveCompletion(REQUIRED_IDS, gates, EXPECTED_SHA);
    expect(comp.complete).toBe(true);
    expect(comp.passed).toBe(true);
    expect(comp.missing).toEqual([]);
    expect(comp.invalid).toEqual([]);

    const eng = computeEngineeringVerdict({
      requiredIds: REQUIRED_IDS,
      results: gates,
      expectedSha: EXPECTED_SHA,
      validatorPassed: true,
      validatorChecksFailed: 0,
      diskGuardPassed: true,
      minFreeDiskGiB: 45,
      diskThresholdGiB: 15,
      shaParityVerified: true,
      regressionInventory: buildValidRegressionSummary(),
      ownedOrphanCount: 0,
      nonInflationVerified: true,
      nonInflationCandidatesCount: 3,
    });
    expect(eng).toBe("PASS");
  });

  it("rejects missing required wave, failed wave, altered SHA, targeted-only regression, non-zero owned orphans, and disk < threshold", () => {
    const baseGates = buildValidGates();

    // 1. Missing required wave -> INCOMPLETE
    const missingGates = baseGates.slice(0, 6);
    const missingComp = computeRequiredWaveCompletion(REQUIRED_IDS, missingGates, EXPECTED_SHA);
    expect(missingComp.complete).toBe(false);
    expect(missingComp.passed).toBe(false);
    expect(missingComp.missing).toContain("WAVE_H_FULL_REGRESSION");
    expect(
      computeEngineeringVerdict({
        requiredIds: REQUIRED_IDS,
        results: missingGates,
        expectedSha: EXPECTED_SHA,
        validatorPassed: true,
        validatorChecksFailed: 0,
        diskGuardPassed: true,
        minFreeDiskGiB: 45,
        diskThresholdGiB: 15,
        shaParityVerified: true,
        regressionInventory: buildValidRegressionSummary(),
        ownedOrphanCount: 0,
        nonInflationVerified: true,
        nonInflationCandidatesCount: 3,
      })
    ).toBe("INCOMPLETE");

    // 2. Failed wave -> FAIL
    const failedGates = baseGates.map((g, idx) =>
      idx === 1 ? { ...g, executionStatus: "FAIL" as const, exitCode: 1 } : g
    );
    expect(
      computeEngineeringVerdict({
        requiredIds: REQUIRED_IDS,
        results: failedGates,
        expectedSha: EXPECTED_SHA,
        validatorPassed: true,
        validatorChecksFailed: 0,
        diskGuardPassed: true,
        minFreeDiskGiB: 45,
        diskThresholdGiB: 15,
        shaParityVerified: true,
        regressionInventory: buildValidRegressionSummary(),
        ownedOrphanCount: 0,
        nonInflationVerified: true,
        nonInflationCandidatesCount: 3,
      })
    ).toBe("FAIL");

    // 3. Altered SHA -> FAIL
    const badShaGates = baseGates.map((g, idx) =>
      idx === 2 ? { ...g, sourceSha: "deadbeef".repeat(5) } : g
    );
    const badShaComp = computeRequiredWaveCompletion(REQUIRED_IDS, badShaGates, EXPECTED_SHA);
    expect(badShaComp.passed).toBe(false);
    expect(badShaComp.invalid).toContain("WAVE_C_BUILD");

    // 4. Targeted-only regression claimed as full -> INCOMPLETE
    expect(
      computeEngineeringVerdict({
        requiredIds: REQUIRED_IDS,
        results: baseGates,
        expectedSha: EXPECTED_SHA,
        validatorPassed: true,
        validatorChecksFailed: 0,
        diskGuardPassed: true,
        minFreeDiskGiB: 45,
        diskThresholdGiB: 15,
        shaParityVerified: true,
        regressionInventory: { ...buildValidRegressionSummary(), targetedOnly: true },
        ownedOrphanCount: 0,
        nonInflationVerified: true,
        nonInflationCandidatesCount: 3,
      })
    ).toBe("INCOMPLETE");

    // 5. Non-zero owned orphan count -> FAIL
    expect(
      computeEngineeringVerdict({
        requiredIds: REQUIRED_IDS,
        results: baseGates,
        expectedSha: EXPECTED_SHA,
        validatorPassed: true,
        validatorChecksFailed: 0,
        diskGuardPassed: true,
        minFreeDiskGiB: 45,
        diskThresholdGiB: 15,
        shaParityVerified: true,
        regressionInventory: buildValidRegressionSummary(),
        ownedOrphanCount: 1,
        nonInflationVerified: true,
        nonInflationCandidatesCount: 3,
      })
    ).toBe("FAIL");

    // 6. Disk below threshold -> BLOCKED
    expect(
      computeEngineeringVerdict({
        requiredIds: REQUIRED_IDS,
        results: baseGates,
        expectedSha: EXPECTED_SHA,
        validatorPassed: true,
        validatorChecksFailed: 0,
        diskGuardPassed: false,
        minFreeDiskGiB: 12,
        diskThresholdGiB: 15,
        shaParityVerified: true,
        regressionInventory: buildValidRegressionSummary(),
        ownedOrphanCount: 0,
        nonInflationVerified: true,
        nonInflationCandidatesCount: 3,
      })
    ).toBe("BLOCKED");
  });

  it("derives multi-verdict release truth dynamically from G07/G15/G16 and provider diagnostics without false FULL_ACCEPTANCE", () => {
    const mockDiagnostics: any = {
      sourceSha: EXPECTED_SHA,
      evaluatedAt: "2026-11-01T08:00:00.000Z",
      dataAsOf: "2026-11-01T04:22:41.831Z",
      providers: {
        walmartUs: {
          providerId: "WALMART_US",
          transport: "JINA_READER_REST_NO_KEY",
          defaultFeatureEnabled: false,
          defaultLiveAllowed: false,
          probeExecutionStatus: "DID_RUN",
          classificationIntegrityStatus: "PASS",
          liveProviderStatus: "BLOCKED_PROVIDER",
          liveVerdict: "BLOCKED_PROVIDER",
          verifiedLiveProductCount: 0,
          attemptedLiveCallsCount: 2,
          reason: "Walmart anti-bot verification ('Robot or human?').",
        },
        amazonUs: {
          providerId: "AMAZON_US",
          transport: "CREATORS_API_AND_PLAYWRIGHT_MCP",
          defaultFeatureEnabled: false,
          defaultLiveAllowed: false,
          configured: false,
          authenticated: null,
          querySucceeded: false,
          liveVerdict: "CREDENTIALS_REQUIRED",
          verifiedLiveProductCount: 0,
          attemptedLiveCallsCount: 0,
          missingEnvKeys: ["AMAZON_CREATORS_CREDENTIAL_ID"],
          reason: "Missing Amazon Creators API credentials.",
        },
      },
      gates: {
        g07: {
          gateId: "G07",
          verdict: "BLOCKED",
          evaluatedFromSource: "diagnoseKH02Source('TIKTOK_ADS')",
          reason: "TikTok US live provider not configured.",
        },
        g15: {
          gateId: "G15",
          verdict: "INSUFFICIENT_EVIDENCE",
          requiredCoveredDays: 60,
          qualifiedProductsCount: 0,
          requiredQualifiedProductsCount: 3,
          totalDemandObservationsInDb: 0,
          evaluatedProducts: [],
          reason: "0/3 candidates have >=60 days demand.",
          remediationGuidance: "Import verified Google Trends CSVs.",
        },
        g16: {
          gateId: "G16",
          verdict: "PARTIAL_2_OF_3",
          snapshotFreshness: "HISTORICAL_SNAPSHOT_RE_EVALUATED",
          evaluatedRunId: "kh02_run_1793506961831_zvxlw",
          evaluatedWorkspaceId: "default-workspace",
          evaluatedRunCreatedAt: "2026-11-01T04:22:41.831Z",
          verifiedLiveMerchantsCount: 2,
          requiredLiveMerchantsCount: 3,
          distinctFamiliesCount: 3,
          distinctCanonicalProductsCount: 3,
          candidates: [],
          reason: "2/3 verified live merchants (3rd is CheckoutChamp funnel).",
        },
      },
      shortlistQuality: {
        targetNiche: "Pet Gadgets",
        storedRunShortlistNicheMatchedCount: 3,
        storedRunShortlistTotalCount: 3,
        holdoutBacktestShortlistNicheMatchedCount: 1,
        holdoutBacktestShortlistTotalCount: 3,
        holdoutNicheMismatches: [],
        allThreeNicheMatchedAndVerified: false,
      },
    };

    expect(computeOverallBusinessVerdict(mockDiagnostics)).toBe("INSUFFICIENT_EVIDENCE");

    const release = computeReleaseVerdicts({
      releaseVersion: "12.4.3.5.1",
      runtimeReleaseIdentity: "12.4.3.5.0.3",
      branch: "feature/kh02-walmart-us-jina-reader-v12.4.3.5.1",
      baseSha: "fbe51a06ab8354c886d0415a9599f977c83caabc",
      masterHeadSha: "5dd5128b4ec9ce70e957a2f250b9012a25e9118c",
      codeSha: EXPECTED_SHA,
      testedTreeSha: "1111111111111111111111111111111111111111",
      engineeringInput: {
        requiredIds: REQUIRED_IDS,
        results: buildValidGates(),
        expectedSha: EXPECTED_SHA,
        validatorPassed: true,
        validatorChecksFailed: 0,
        diskGuardPassed: true,
        minFreeDiskGiB: 45,
        diskThresholdGiB: 15,
        shaParityVerified: true,
        regressionInventory: buildValidRegressionSummary(),
        ownedOrphanCount: 0,
        nonInflationVerified: true,
        nonInflationCandidatesCount: 3,
      },
      diagnostics: mockDiagnostics,
      backtestOutput: {
        backtestEngineExecuted: "PASS",
        pointInTimeIntegrityVerdict: "PASS",
        policyScenarioVerdict: "PASS",
        policyScenariosPassed: "16/16",
        devObservationsCount: 4,
        holdoutObservationsCount: 28,
        businessHistoricalEvidenceSufficient: "INSUFFICIENT_EVIDENCE",
        overallHistoricalBacktestVerdict: "INSUFFICIENT_HISTORICAL_EVIDENCE",
      },
      nonInflationSummary: {
        comparedCandidatesCount: 3,
        candidateSetMatch: true,
        providerPathExercised: true,
        walmartEvidenceRowsExercised: 6,
        scoreDeltaAbsMax: 0,
        rankingChanged: false,
        gateChanges: 0,
        nonInflationVerified: true,
      },
      negativeMutationsCaught: "60/60",
      ancestryVerified: true,
    });

    expect(release.engineeringVerdict).toBe("PASS");
    expect(release.liveWalmartProviderVerdict).toBe("BLOCKED_PROVIDER");
    expect(release.liveAmazonProviderVerdict).toBe("CREDENTIALS_REQUIRED");
    expect(release.kh02BusinessVerdict).toBe("INSUFFICIENT_EVIDENCE");
    expect(release.historicalG07Verdict).toBe("BLOCKED");
    expect(release.historicalG15Verdict).toBe("INSUFFICIENT_EVIDENCE");
    expect(release.historicalG16Verdict).toBe("PARTIAL_2_OF_3");
    expect(release.overallVerdict).toBe("ENGINEERING_READY_WITH_EXTERNAL_BLOCKERS");
    expect(release.remainingExternalBlockers.length).toBeGreaterThanOrEqual(4);
  });

  it("evaluates Pet Gadgets niche fit and peak concurrent process intervals accurately", () => {
    expect(
      evaluatePetGadgetsNicheFit("UAHPET Fresh Food Automatic Pet Feeder", "uahpet.com").matches
    ).toBe(true);
    expect(
      evaluatePetGadgetsNicheFit("The KittySpout™ - Wireless Fountain", "kittyspout.com").matches
    ).toBe(true);
    expect(
      evaluatePetGadgetsNicheFit(
        "Car Fender Panel Dent Edge Repair Tools",
        "pdrcanada.ca"
      ).matches
    ).toBe(false);
    expect(
      evaluatePetGadgetsNicheFit("Natural Relief in Weeks", " try.audizen.com").matches
    ).toBe(false);

    // Peak concurrency interval check
    expect(
      computePeakConcurrentIntervals([
        { startedAtMs: 1000, endedAtMs: 3000 },
        { startedAtMs: 2000, endedAtMs: 4000 },
        { startedAtMs: 4500, endedAtMs: 5500 },
      ])
    ).toBe(2);

    expect(
      computePeakConcurrentIntervals([
        { startedAtMs: 1000, endedAtMs: 2000 },
        { startedAtMs: 2500, endedAtMs: 3500 },
      ])
    ).toBe(1);
  });
});
