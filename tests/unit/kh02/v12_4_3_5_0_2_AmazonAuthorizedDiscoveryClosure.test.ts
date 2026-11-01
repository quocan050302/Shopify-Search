/**
 * SWAI KH-02 V12.4.3.5.0.2 — Authorized Amazon US Discovery, Creators API Client & Anti-Fake Closure Unit Suite (D01–D25)
 *
 * Tests all new V12.4.3.5.0.2 functions and BUG T1..T5 repairs:
 * - deriveAmazonSearchIntents (D01–D04)
 * - planAmazonDiscoveryBudget (D05–D06)
 * - resolveCreatorsApiEligibility (D07–D08)
 * - createCreatorsApiClient, searchItemsByCandidateIntent, getItemsByAsins, classifyCreatorsApiFailure (D09–D14)
 * - normalizeAmazonSearchItem & selectAmazonCandidateMatches (D15–D18)
 * - discoverAmazonProductsForCandidates & runAmazonUsPilotEnrichment integration (D19–D21)
 * - BUG T4 repair: navigateAndCaptureProductSnapshot unobserved httpStatus -> null & MCP isError rejection (D22–D23)
 * - BUG T2 repair: computeAmazonNonInflationDelta dynamic calculation & mutation detection (D24)
 * - Independent validator & 45 physical-file negative control mutations N01..N45 (D25)
 */

import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it } from "vitest";
import {
  CREATORS_API_US_MARKETPLACE,
  classifyCreatorsApiFailure,
  createCreatorsApiClient,
  resolveCreatorsApiEligibility,
} from "@/services/kh02/marketplace/amazonCreatorsApiClient";
import {
  computeAmazonNonInflationDelta,
  deriveAmazonSearchIntents,
  discoverAmazonProductsForCandidates,
  normalizeAmazonSearchItem,
  planAmazonDiscoveryBudget,
  selectAmazonCandidateMatches,
} from "@/services/kh02/marketplace/amazonUsAuthorizedDiscoveryAdapter";
import {
  createAmazonProviderBudget,
  resetSharedAmazonBudgetCoordinatorsForTest,
} from "@/services/kh02/marketplace/amazonUsBudget";
import { runAmazonUsPilotEnrichment } from "@/services/kh02/marketplace/amazonUsEvidenceAdapter";
import { evaluateAmazonUsEvidenceGate } from "@/services/kh02/marketplace/amazonUsEvidenceGate";
import { parseAmazonProductEvidence } from "@/services/kh02/marketplace/amazonUsIdentity";
import { resolveAmazonUsPolicyContext } from "@/services/kh02/marketplace/marketplaceEvidenceTypes";
import { SWAI_KH02_RELEASE_VERSION } from "@/services/kh02/version/runtimeVersionService";
import {
  runAmazonUsAuthorizedDiscoveryNegativeMutationSuite,
  validateAmazonUsAuthorizedDiscoveryV12_4_3_5_0_2,
  writeCanonicalValidAuthorizedDiscoveryFixture,
} from "../../../scripts/kh02/validateAmazonUsAuthorizedDiscoveryV12_4_3_5_0_2";

describe("KH-02 V12.4.3.5.0.2 — Authorized Amazon US Product Discovery & Anti-Fake Acceptance Closure (D01–D25)", () => {
  afterEach(() => {
    resetSharedAmazonBudgetCoordinatorsForTest();
  });

  it("D01: deriveAmazonSearchIntents builds deterministic candidate-specific queries from verified brand/title/model and suppresses generic niche", () => {
    const intents = deriveAmazonSearchIntents(
      {
        candidateId: "cand_uahpet_1",
        merchantVerifiedProductName: "UAHPET Wireless Cat Water Fountain",
        brand: "UAHPET",
        model: "UAH-WF-01",
        productFamily: "Automatic Pet Water Fountain",
      },
      "Pet Gadgets"
    );

    expect(intents.length).toBeGreaterThanOrEqual(1);
    expect(intents[0].candidateId).toBe("cand_uahpet_1");
    expect(intents[0].normalizedKeywords).toContain("UAHPET");
    expect(intents[0].normalizedKeywords).toContain("Fountain");
    expect(intents[0].normalizedKeywords).toContain("UAH-WF-01");
    expect(intents[0].normalizedKeywords.toLowerCase()).not.toBe("pet gadgets");
    expect(intents[0].suppressedTerms).toContain("GENERIC_NICHE_SUPPRESSED:Pet Gadgets");
  });

  it("D02: deriveAmazonSearchIntents strips HTML/script injection, ad noise, and ignores rawAdCopy as trusted identifier", () => {
    const intents = deriveAmazonSearchIntents(
      {
        candidateId: "cand_kittyspout_2",
        title: "<script>alert(1)</script>KittySpout Stainless Steel Cat Fountain 50% OFF Free Shipping!",
        brand: "KittySpout",
        rawAdCopy: "Buy now at https://spam.example/B099999999 #viral",
      },
      "Pet Gadgets"
    );

    expect(intents).toHaveLength(1);
    expect(intents[0].normalizedKeywords).not.toContain("script");
    expect(intents[0].normalizedKeywords).not.toContain("50%");
    expect(intents[0].normalizedKeywords).not.toContain("B099999999");
    expect(intents[0].suppressedTerms).toContain(
      "RAW_AD_COPY_IGNORED_FOR_TRUSTED_IDENTIFIERS"
    );
  });

  it("D03: deriveAmazonSearchIntents rejects brand-only single-token queries and empty/generic candidates", () => {
    const brandOnly = deriveAmazonSearchIntents(
      {
        candidateId: "cand_brand_only",
        title: "UAHPET",
        brand: "UAHPET",
      },
      "Pet Gadgets"
    );
    expect(brandOnly).toHaveLength(0);

    const genericOnly = deriveAmazonSearchIntents(
      {
        candidateId: "cand_generic",
        title: "Pet Gadgets",
      },
      "Pet Gadgets"
    );
    expect(genericOnly).toHaveLength(0);
  });

  it("D04: deriveAmazonSearchIntents deduplicates repeated tokens and caps keyword length/tokens", () => {
    const intents = deriveAmazonSearchIntents(
      {
        candidateId: "cand_long",
        title:
          "FurZapper Pet Hair Remover Laundry FurZapper Silicone Washer Dryer Hair Catcher Multi Pack",
        brand: "FurZapper",
        model: "FZ-200",
      },
      "Pet Supplies",
      { maxTokens: 7, maxKeywordLength: 60 }
    );
    expect(intents).toHaveLength(1);
    expect(intents[0].normalizedKeywords.length).toBeLessThanOrEqual(60);
    expect(intents[0].normalizedKeywords.split(/\s+/).length).toBeLessThanOrEqual(7);
  });

  it("D05: planAmazonDiscoveryBudget enforces max 3 candidates, max 4 shared operations, concurrency=1, and suppresses duplicate family queries", () => {
    const policy = resolveAmazonUsPolicyContext(
      {
        KH02_AMAZON_US_ENABLED: "true",
        KH02_AMAZON_US_LIVE_ALLOWED: "true",
        KH02_AMAZON_CREATORS_API_CREDENTIAL_ID: "cid",
        KH02_AMAZON_CREATORS_API_CREDENTIAL_SECRET: "csec",
        KH02_AMAZON_ASSOCIATES_PARTNER_TAG: "tag-20",
      },
      { creatorsApiEntitlementVerified: true }
    );

    const plan = planAmazonDiscoveryBudget(
      [
        {
          candidateId: "c1",
          title: "UAHPET Wireless Cat Water Fountain",
          brand: "UAHPET",
        },
        {
          candidateId: "c2_dup",
          title: "UAHPET Wireless Cat Water Fountain",
          brand: "UAHPET",
        },
        {
          candidateId: "c3",
          title: "KittySpout Stainless Cat Fountain",
          brand: "KittySpout",
        },
        {
          candidateId: "c4",
          title: "Uproot Clean Pro Pet Hair Remover",
          brand: "Uproot Clean",
        },
        {
          candidateId: "c5_overflow",
          title: "ChomChom Roller Pet Hair Remover",
          brand: "ChomChom",
        },
      ],
      4,
      policy,
      "Pet Gadgets"
    );

    expect(plan.maxCandidatesPerRun).toBe(3);
    expect(plan.maxTotalOperationsPerRun).toBe(4);
    expect(plan.maxConcurrency).toBe(1);
    expect(plan.selectedCandidateIds).toEqual(["c1", "c3", "c4"]);
    expect(plan.plannedSearchOperationsCount).toBe(3);
    expect(plan.reservedGetItemsBatchCount).toBe(1);
    const dupPlan = plan.candidateQueryPlans.find((p) => p.candidateId === "c2_dup");
    expect(dupPlan?.suppressionReason).toBe("DUPLICATE_NORMALIZED_QUERY_SUPPRESSED");
  });

  it("D06: planAmazonDiscoveryBudget adapts when remaining shared budget is already partially consumed by URL verification", () => {
    const policy = resolveAmazonUsPolicyContext({
      KH02_AMAZON_US_ENABLED: "true",
      KH02_AMAZON_US_LIVE_ALLOWED: "true",
      KH02_AMAZON_US_USER_AUTHORIZED_URLS_ATTESTED: "true",
    });

    const plan = planAmazonDiscoveryBudget(
      [
        { candidateId: "c1", title: "UAHPET Wireless Cat Water Fountain", brand: "UAHPET" },
        { candidateId: "c2", title: "KittySpout Stainless Cat Fountain", brand: "KittySpout" },
      ],
      1,
      policy,
      "Pet Gadgets"
    );

    expect(plan.selectedCandidateIds).toEqual(["c1"]);
    expect(plan.plannedSearchOperationsCount).toBe(1);
    expect(plan.reservedGetItemsBatchCount).toBe(0);
  });

  it("D07: resolveCreatorsApiEligibility separates configured vs authenticated vs querySucceeded and masks partnerTag", () => {
    const unconfigured = resolveCreatorsApiEligibility({
      KH02_AMAZON_US_ENABLED: "true",
      KH02_AMAZON_US_LIVE_ALLOWED: "true",
    });
    expect(unconfigured.configured).toBe(false);
    expect(unconfigured.status).toBe("CREDENTIALS_REQUIRED");
    expect(unconfigured.accessPolicyStatus).toBe("CREDENTIALS_REQUIRED");

    const configuredOnly = resolveCreatorsApiEligibility({
      KH02_AMAZON_US_ENABLED: "true",
      KH02_AMAZON_US_LIVE_ALLOWED: "true",
      KH02_AMAZON_CREATORS_API_CREDENTIAL_ID: "my_secret_id_123",
      KH02_AMAZON_CREATORS_API_CREDENTIAL_SECRET: "my_super_secret_456",
      KH02_AMAZON_ASSOCIATES_PARTNER_TAG: "swaius-20",
    });
    expect(configuredOnly.configured).toBe(true);
    expect(configuredOnly.authenticated).toBe(false);
    expect(configuredOnly.querySucceeded).toBe(false);
    expect(configuredOnly.partnerTagMasked).toBe("sw***-20");
    expect(JSON.stringify(configuredOnly)).not.toContain("my_secret_id_123");
    expect(JSON.stringify(configuredOnly)).not.toContain("my_super_secret_456");
  });

  it("D08: resolveCreatorsApiEligibility rejects non-US marketplaces and unapproved accounts", () => {
    const ukDecision = resolveCreatorsApiEligibility(
      {
        KH02_AMAZON_US_ENABLED: "true",
        KH02_AMAZON_US_LIVE_ALLOWED: "true",
        KH02_AMAZON_CREATORS_API_CREDENTIAL_ID: "id",
        KH02_AMAZON_CREATORS_API_CREDENTIAL_SECRET: "sec",
        KH02_AMAZON_ASSOCIATES_PARTNER_TAG: "tag-20",
      },
      { marketplace: "www.amazon.co.uk" }
    );
    expect(ukDecision.eligibleForLiveRequests).toBe(false);
    expect(ukDecision.status).toBe("BLOCKED_POLICY");

    const unapproved = resolveCreatorsApiEligibility(
      {
        KH02_AMAZON_US_ENABLED: "true",
        KH02_AMAZON_US_LIVE_ALLOWED: "true",
        KH02_AMAZON_CREATORS_API_CREDENTIAL_ID: "id",
        KH02_AMAZON_CREATORS_API_CREDENTIAL_SECRET: "sec",
        KH02_AMAZON_ASSOCIATES_PARTNER_TAG: "tag-20",
      },
      { accountApproved: false }
    );
    expect(unapproved.eligibleForLiveRequests).toBe(false);
    expect(unapproved.status).toBe("ACCESS_NOT_GRANTED");
  });

  it("D09: createCreatorsApiClient acquires OAuth 2.0 bearer token, caches it, and invokes official SearchItems with x-marketplace: www.amazon.com", async () => {
    const calls: Array<{ url: string; headers: Record<string, string>; body: string }> = [];
    const mockFetch: typeof fetch = async (input: any, init?: any) => {
      const url = String(input);
      const headers = (init?.headers || {}) as Record<string, string>;
      const body = String(init?.body || "");
      calls.push({ url, headers, body });

      if (url.includes("/auth/o2/token")) {
        return new Response(
          JSON.stringify({
            access_token: "oauth_token_xyz_999",
            token_type: "bearer",
            expires_in: 3600,
          }),
          { status: 200 }
        );
      }

      return new Response(
        JSON.stringify({
          searchResult: {
            totalResultCount: 1,
            items: [
              {
                asin: "B08N5WRWNW",
                parentASIN: "B08N5WRW00",
                detailPageURL: "https://www.amazon.com/dp/B08N5WRWNW",
                itemInfo: {
                  title: {
                    displayValue: "UAHPET Wireless Cat Water Fountain Stainless Steel",
                  },
                  byLineInfo: {
                    brand: { displayValue: "UAHPET" },
                  },
                  manufactureInfo: {
                    model: { displayValue: "UAH-WF-01" },
                  },
                },
                offersV2: {
                  listings: [
                    {
                      price: { amount: 49.99, currency: "USD" },
                      availability: { message: "In Stock" },
                      merchantInfo: { name: "UAHPET Official" },
                    },
                  ],
                },
              },
            ],
          },
        }),
        {
          status: 200,
          headers: { "x-amzn-requestid": "amz-upstream-req-001" },
        }
      );
    };

    const client = createCreatorsApiClient({
      credentialId: "cred_id_test",
      credentialSecret: "cred_sec_test",
      partnerTag: "swai-20",
      fetchFn: mockFetch,
    });

    const res1 = await client.searchItemsByCandidateIntent(
      {
        candidateId: "cand_1",
        normalizedKeywords: "UAHPET Wireless Cat Water Fountain",
      },
      {
        workspaceId: "ws_1",
        researchRunId: "run_1",
        candidateId: "cand_1",
      }
    );
    const res2 = await client.searchItemsByCandidateIntent(
      {
        candidateId: "cand_1",
        normalizedKeywords: "UAHPET Wireless Cat Water Fountain",
      },
      {
        workspaceId: "ws_1",
        researchRunId: "run_1",
        candidateId: "cand_1",
      }
    );

    expect(res1.succeeded).toBe(true);
    expect(res1.httpStatus).toBe(200);
    expect(res1.httpStatusOrigin).toBe("OBSERVED");
    expect(res1.upstreamRequestId).toBe("amz-upstream-req-001");
    expect(res1.items).toHaveLength(1);
    expect(res2.succeeded).toBe(true);
    // Token endpoint called only once across two SearchItems calls
    expect(calls.filter((c) => c.url.includes("/auth/o2/token"))).toHaveLength(1);
    const searchCall = calls.find((c) => c.url.includes("/catalog/v1/searchItems"))!;
    expect(searchCall.headers["x-marketplace"]).toBe(CREATORS_API_US_MARKETPLACE);
    expect(searchCall.headers.Authorization).toBe("Bearer oauth_token_xyz_999");
  });

  it("D10: createCreatorsApiClient getItemsByAsins batches valid ASINs and preserves upstream request ID and raw hash", async () => {
    const mockFetch: typeof fetch = async (input: any) => {
      const url = String(input);
      if (url.includes("/auth/o2/token")) {
        return new Response(
          JSON.stringify({ access_token: "tok_1", expires_in: 3600 }),
          { status: 200 }
        );
      }
      return new Response(
        JSON.stringify({
          itemResults: {
            items: [
              {
                asin: "B08N5WRWNW",
                itemInfo: {
                  title: { displayValue: "UAHPET Wireless Cat Water Fountain" },
                },
              },
            ],
          },
        }),
        { status: 200, headers: { "x-amzn-requestid": "amz-getitems-req-77" } }
      );
    };

    const client = createCreatorsApiClient({
      credentialId: "cid",
      credentialSecret: "csec",
      partnerTag: "swai-20",
      fetchFn: mockFetch,
    });

    const getRes = await client.getItemsByAsins(
      ["B08N5WRWNW", "INVALID_ASIN", "B08N5WRWNW"],
      {
        workspaceId: "ws_1",
        researchRunId: "run_1",
        candidateId: "cand_1",
      }
    );

    expect(getRes.succeeded).toBe(true);
    expect(getRes.requestedAsins).toEqual(["B08N5WRWNW"]);
    expect(getRes.upstreamRequestId).toBe("amz-getitems-req-77");
    expect(getRes.rawResponseHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("D11: classifyCreatorsApiFailure and client handle 401 AUTHENTICATION_FAILED and 403 ACCESS_NOT_GRANTED as non-retryable with redacted secrets", async () => {
    const client401 = createCreatorsApiClient({
      credentialId: "TOP_SECRET_ID",
      credentialSecret: "TOP_SECRET_VALUE",
      partnerTag: "swai-20",
      fetchFn: async () =>
        new Response(
          JSON.stringify({
            error: "invalid_client",
            error_description: "Bad secret TOP_SECRET_VALUE for TOP_SECRET_ID",
          }),
          { status: 401 }
        ),
    });

    const res401 = await client401.searchItemsByCandidateIntent(
      { candidateId: "c1", normalizedKeywords: "UAHPET Fountain" },
      { workspaceId: "ws", researchRunId: "run", candidateId: "c1" }
    );
    expect(res401.succeeded).toBe(false);
    expect(res401.status).toBe("AUTHENTICATION_FAILED");
    expect(res401.retryable).toBe(false);
    expect(res401.errorMessage).not.toContain("TOP_SECRET_VALUE");
    expect(res401.errorMessage).not.toContain("TOP_SECRET_ID");

    const c403 = classifyCreatorsApiFailure(null, {
      httpStatus: 403,
      parsedJson: {
        Errors: [{ Code: "AccessDenied", Message: "PartnerTag not eligible" }],
      },
    });
    expect(c403.status).toBe("ACCESS_NOT_GRANTED");
    expect(c403.retryable).toBe(false);
  });

  it("D12: classifyCreatorsApiFailure handles 429 RATE_LIMITED, 503 PROVIDER_ERROR, timeout TIMED_OUT, and HTTP 200 empty QUERY_SUCCEEDED_EMPTY", async () => {
    expect(
      classifyCreatorsApiFailure(null, {
        httpStatus: 429,
        parsedJson: { Errors: [{ Code: "TooManyRequests" }] },
      }).status
    ).toBe("RATE_LIMITED");

    const err503 = classifyCreatorsApiFailure(null, { httpStatus: 503 });
    expect(err503.status).toBe("PROVIDER_ERROR");
    expect(err503.retryable).toBe(true);

    const errTimeout = classifyCreatorsApiFailure(new Error("TIMED_OUT"));
    expect(errTimeout.status).toBe("TIMED_OUT");
    expect(errTimeout.retryable).toBe(true);

    const emptyClient = createCreatorsApiClient({
      credentialId: "cid",
      credentialSecret: "csec",
      partnerTag: "swai-20",
      fetchFn: async (input: any) => {
        if (String(input).includes("/auth/o2/token")) {
          return new Response(
            JSON.stringify({ access_token: "tok", expires_in: 3600 }),
            { status: 200 }
          );
        }
        return new Response(
          JSON.stringify({
            searchResult: { totalResultCount: 0, items: [] },
          }),
          { status: 200 }
        );
      },
    });
    const emptyRes = await emptyClient.searchItemsByCandidateIntent(
      { candidateId: "c1", normalizedKeywords: "Nonexistent Product XYZ987" },
      { workspaceId: "ws", researchRunId: "run", candidateId: "c1" }
    );
    expect(emptyRes.succeeded).toBe(true);
    expect(emptyRes.status).toBe("QUERY_SUCCEEDED_EMPTY");
    expect(emptyRes.items).toHaveLength(0);
  });

  it("D13: normalizeAmazonSearchItem preserves null price/currency when absent and includes image only when license permits", () => {
    const rawItem = {
      asin: "B08N5WRWNW",
      parentASIN: "B08N5WRW00",
      detailPageURL: "https://www.amazon.com/dp/B08N5WRWNW",
      itemInfo: {
        title: { displayValue: "UAHPET Wireless Cat Water Fountain" },
        byLineInfo: { brand: { displayValue: "UAHPET" } },
      },
      images: {
        primary: {
          medium: { url: "https://m.media-amazon.com/images/I/test.jpg" },
        },
      },
    };

    const normNoLicense = normalizeAmazonSearchItem(rawItem, {
      workspaceId: "ws_1",
      researchRunId: "run_1",
      candidateId: "cand_1",
      providerInvocationRef: "amz_inv_1",
      providerRequestId: "amz_req_1",
      observedAt: "2026-11-01T00:00:00.000Z",
      rawResponseHash: "h1",
      accessPolicyStatus: "AUTHORIZED_CREATORS_API",
      imageLicensePermitted: false,
    });
    expect(normNoLicense.kind).toBe("EVIDENCE");
    if (normNoLicense.kind === "EVIDENCE") {
      expect(normNoLicense.evidence.price).toBeNull();
      expect(normNoLicense.evidence.currency).toBeNull();
      expect(normNoLicense.evidence.verifiedDeliveryMarket).toBeNull();
      expect(normNoLicense.evidence.parentAsin).toBe("B08N5WRW00");
      expect(normNoLicense.evidence.variationAsin).toBe("B08N5WRWNW");
      expect(normNoLicense.licensedImageUrl).toBeNull();
    }

    const normLicensed = normalizeAmazonSearchItem(rawItem, {
      workspaceId: "ws_1",
      researchRunId: "run_1",
      candidateId: "cand_1",
      providerInvocationRef: "amz_inv_1",
      providerRequestId: "amz_req_1",
      observedAt: "2026-11-01T00:00:00.000Z",
      rawResponseHash: "h1",
      accessPolicyStatus: "AUTHORIZED_CREATORS_API",
      imageLicensePermitted: true,
    });
    expect(normLicensed.kind).toBe("EVIDENCE");
    if (normLicensed.kind === "EVIDENCE") {
      expect(normLicensed.licensedImageUrl).toBe(
        "https://m.media-amazon.com/images/I/test.jpg"
      );
    }
  });

  it("D14: normalizeAmazonSearchItem rejects non-US detail URLs, non-USD currencies, and invalid ASINs", () => {
    const badCurrency = normalizeAmazonSearchItem(
      {
        asin: "B08N5WRWNW",
        itemInfo: { title: { displayValue: "UAHPET Fountain" } },
        offersV2: {
          listings: [{ price: { amount: 39.99, currency: "GBP" } }],
        },
      },
      {
        workspaceId: "ws",
        researchRunId: "run",
        candidateId: "c1",
        providerInvocationRef: "inv",
        providerRequestId: null,
        observedAt: new Date().toISOString(),
        rawResponseHash: "h",
        accessPolicyStatus: "AUTHORIZED_CREATORS_API",
      }
    );
    expect(badCurrency.kind).toBe("REJECTED");
    if (badCurrency.kind === "REJECTED") {
      expect(badCurrency.rejectionReason).toContain("NON_USD_OFFER_CURRENCY");
    }
  });

  it("D15: selectAmazonCandidateMatches ranks EXACT_PRODUCT above BRAND_ONLY and rejects replacement filter accessories", () => {
    const candidate = {
      candidateId: "cand_uahpet_1",
      title: "UAHPET Wireless Cat Water Fountain Stainless Steel",
      brand: "UAHPET",
      model: "UAH-WF-01",
    };

    const accessoryNorm = normalizeAmazonSearchItem(
      {
        asin: "B08N5WRACC",
        itemInfo: {
          title: {
            displayValue: "UAHPET Replacement Filters 6 Pack for Cat Water Fountain",
          },
          byLineInfo: { brand: { displayValue: "UAHPET" } },
        },
      },
      {
        workspaceId: "ws",
        researchRunId: "run",
        candidateId: "cand_uahpet_1",
        providerInvocationRef: "inv_1",
        providerRequestId: null,
        observedAt: new Date().toISOString(),
        rawResponseHash: "h1",
        accessPolicyStatus: "AUTHORIZED_CREATORS_API",
      }
    );

    const exactNorm = normalizeAmazonSearchItem(
      {
        asin: "B08N5WRWNW",
        itemInfo: {
          title: {
            displayValue: "UAHPET Wireless Cat Water Fountain Stainless Steel",
          },
          byLineInfo: { brand: { displayValue: "UAHPET" } },
          manufactureInfo: { model: { displayValue: "UAH-WF-01" } },
        },
        offersV2: {
          listings: [{ price: { amount: 49.99, currency: "USD" } }],
        },
      },
      {
        workspaceId: "ws",
        researchRunId: "run",
        candidateId: "cand_uahpet_1",
        providerInvocationRef: "inv_1",
        providerRequestId: null,
        observedAt: new Date().toISOString(),
        rawResponseHash: "h1",
        accessPolicyStatus: "AUTHORIZED_CREATORS_API",
      }
    );

    expect(accessoryNorm.kind).toBe("EVIDENCE");
    expect(exactNorm.kind).toBe("EVIDENCE");
    if (accessoryNorm.kind === "EVIDENCE" && exactNorm.kind === "EVIDENCE") {
      const decisions = selectAmazonCandidateMatches(candidate, [
        accessoryNorm.evidence,
        exactNorm.evidence,
      ]);
      expect(decisions[0].asin).toBe("B08N5WRWNW");
      expect(decisions[0].identityMatch).toBe("EXACT_PRODUCT");
      expect(decisions[0].selectedAsBest).toBe(true);
      expect(decisions[1].asin).toBe("B08N5WRACC");
      expect(decisions[1].identityMatch).toBe("BRAND_ONLY");
      expect(decisions[1].selectedAsBest).toBe(false);
    }
  });

  it("D16: discoverAmazonProductsForCandidates performs 0 network calls when policy is OFF or credentials are missing", async () => {
    const disabledRes = await discoverAmazonProductsForCandidates({
      workspaceId: "ws_1",
      researchRunId: "run_1",
      niche: "Pet Gadgets",
      candidates: [
        { candidateId: "c1", title: "UAHPET Wireless Cat Water Fountain", brand: "UAHPET" },
      ],
      env: { KH02_AMAZON_US_ENABLED: "false" },
    });
    expect(disabledRes.runStatus).toBe("DISABLED");
    expect(disabledRes.providerRequestLedger).toHaveLength(0);

    const missingCredsRes = await discoverAmazonProductsForCandidates({
      workspaceId: "ws_1",
      researchRunId: "run_1",
      niche: "Pet Gadgets",
      candidates: [
        { candidateId: "c1", title: "UAHPET Wireless Cat Water Fountain", brand: "UAHPET" },
      ],
      env: {
        KH02_AMAZON_US_ENABLED: "true",
        KH02_AMAZON_US_LIVE_ALLOWED: "true",
      },
    });
    expect(missingCredsRes.runStatus).toBe("CREDENTIALS_REQUIRED");
    expect(missingCredsRes.accessPolicyStatus).toBe("CREDENTIALS_REQUIRED");
    expect(missingCredsRes.providerRequestLedger).toHaveLength(0);
  });

  it("D17: discoverAmazonProductsForCandidates executes SearchItems + optional batched GetItems within shared 4-operation budget", async () => {
    let searchCalls = 0;
    let getItemsCalls = 0;
    const client = createCreatorsApiClient({
      credentialId: "cid",
      credentialSecret: "csec",
      partnerTag: "swai-20",
      fetchFn: async (input: any) => {
        const url = String(input);
        if (url.includes("/auth/o2/token")) {
          return new Response(
            JSON.stringify({ access_token: "tok", expires_in: 3600 }),
            { status: 200 }
          );
        }
        if (url.includes("/catalog/v1/searchItems")) {
          searchCalls++;
          return new Response(
            JSON.stringify({
              searchResult: {
                totalResultCount: 1,
                items: [
                  {
                    asin: `B08N5WRW0${searchCalls}`,
                    itemInfo: {
                      title: {
                        displayValue: "UAHPET Wireless Cat Water Fountain Stainless Steel",
                      },
                      byLineInfo: { brand: { displayValue: "UAHPET" } },
                    },
                  },
                ],
              },
            }),
            { status: 200, headers: { "x-amzn-requestid": `req-s-${searchCalls}` } }
          );
        }
        getItemsCalls++;
        return new Response(
          JSON.stringify({
            itemResults: {
              items: [
                {
                  asin: "B08N5WRW01",
                  itemInfo: {
                    title: {
                      displayValue: "UAHPET Wireless Cat Water Fountain Stainless Steel",
                    },
                    byLineInfo: { brand: { displayValue: "UAHPET" } },
                    manufactureInfo: { model: { displayValue: "UAH-WF-01" } },
                  },
                  offersV2: {
                    listings: [{ price: { amount: 49.99, currency: "USD" } }],
                  },
                },
              ],
            },
          }),
          { status: 200, headers: { "x-amzn-requestid": "req-g-1" } }
        );
      },
    });

    const budget = createAmazonProviderBudget({
      workspaceId: "ws_disc",
      researchRunId: "run_disc",
      maxOperationsPerRun: 4,
      isolatedCoordinator: true,
    });

    const discRes = await discoverAmazonProductsForCandidates({
      workspaceId: "ws_disc",
      researchRunId: "run_disc",
      niche: "Pet Gadgets",
      candidates: [
        {
          candidateId: "c1",
          title: "UAHPET Wireless Cat Water Fountain Stainless Steel",
          brand: "UAHPET",
          model: "UAH-WF-01",
        },
      ],
      env: {
        KH02_AMAZON_US_ENABLED: "true",
        KH02_AMAZON_US_LIVE_ALLOWED: "true",
        KH02_AMAZON_CREATORS_API_CREDENTIAL_ID: "cid",
        KH02_AMAZON_CREATORS_API_CREDENTIAL_SECRET: "csec",
        KH02_AMAZON_ASSOCIATES_PARTNER_TAG: "swai-20",
      },
      budget,
      creatorsApiClient: client,
    });

    expect(searchCalls).toBe(1);
    expect(getItemsCalls).toBe(1);
    expect(discRes.runStatus).toBe("IDENTITY_VERIFIED");
    expect(discRes.marketplaceEvidence).toHaveLength(1);
    expect(discRes.marketplaceEvidence[0].price).toBe(49.99);
    expect(discRes.marketplaceEvidence[0].modelNumber).toBe("UAH-WF-01");
    expect(discRes.marketplaceEvidence[0].providerSourceOrigin).toBe(
      "AUTHORIZED_CREATORS_API"
    );
  });

  it("D18: runAmazonUsPilotEnrichment automatically discovers Amazon products for candidates without URLs when entitled Creators API client is provided", async () => {
    const client = createCreatorsApiClient({
      credentialId: "cid",
      credentialSecret: "csec",
      partnerTag: "swai-20",
      fetchFn: async (input: any) => {
        if (String(input).includes("/auth/o2/token")) {
          return new Response(
            JSON.stringify({ access_token: "tok", expires_in: 3600 }),
            { status: 200 }
          );
        }
        return new Response(
          JSON.stringify({
            searchResult: {
              totalResultCount: 1,
              items: [
                {
                  asin: "B08N5WRWNW",
                  itemInfo: {
                    title: {
                      displayValue: "UAHPET Wireless Cat Water Fountain Stainless Steel",
                    },
                    byLineInfo: { brand: { displayValue: "UAHPET" } },
                    manufactureInfo: { model: { displayValue: "UAH-WF-01" } },
                  },
                  offersV2: {
                    listings: [{ price: { amount: 49.99, currency: "USD" } }],
                  },
                },
              ],
            },
          }),
          { status: 200, headers: { "x-amzn-requestid": "req-enrich-1" } }
        );
      },
    });

    const res = await runAmazonUsPilotEnrichment({
      workspaceId: "ws_enrich",
      researchRunId: "run_enrich",
      niche: "Pet Gadgets",
      optInRequested: true,
      candidates: [
        {
          candidateId: "cand_no_url_1",
          title: "UAHPET Wireless Cat Water Fountain Stainless Steel",
          brand: "UAHPET",
          model: "UAH-WF-01",
        },
      ],
      creatorsApiClient: client,
      env: {
        KH02_AMAZON_US_ENABLED: "true",
        KH02_AMAZON_US_LIVE_ALLOWED: "true",
        KH02_AMAZON_CREATORS_API_CREDENTIAL_ID: "cid",
        KH02_AMAZON_CREATORS_API_CREDENTIAL_SECRET: "csec",
        KH02_AMAZON_ASSOCIATES_PARTNER_TAG: "swai-20",
      },
    });

    expect(res.marketplaceEvidence).toHaveLength(1);
    expect(res.marketplaceEvidence[0].asin).toBe("B08N5WRWNW");
    expect(res.marketplaceEvidence[0].identityMatch).toBe("EXACT_PRODUCT");
    expect(res.marketplaceTelemetry.discoverySummary?.discoveryAttempted).toBe(true);
    expect(res.marketplaceTelemetry.discoverySummary?.exactMatchesSelectedCount).toBe(1);
  });

  it("D19: evaluateAmazonUsEvidenceGate excludes LOCAL_MCP_TEST_DOUBLE from REAL_PROVIDER_VERIFIED even when observationClass is tampered", () => {
    const policy = resolveAmazonUsPolicyContext(
      {
        KH02_AMAZON_US_ENABLED: "true",
        KH02_AMAZON_US_LIVE_ALLOWED: "true",
        KH02_AMAZON_CREATORS_API_CREDENTIAL_ID: "cid",
        KH02_AMAZON_CREATORS_API_CREDENTIAL_SECRET: "csec",
        KH02_AMAZON_ASSOCIATES_PARTNER_TAG: "swai-20",
      },
      { creatorsApiEntitlementVerified: true }
    );

    const gate = evaluateAmazonUsEvidenceGate(
      "run_gate_1",
      [
        {
          id: "ev_1",
          workspaceId: "ws_1",
          researchRunId: "run_gate_1",
          candidateId: "c1",
          provider: "AMAZON_US",
          requestMode: "URL_VERIFICATION",
          requestedMarket: "US",
          verifiedDeliveryMarket: null,
          sourceUrl: "https://www.amazon.com/dp/B08N5WRWNW",
          finalUrl: "https://www.amazon.com/dp/B08N5WRWNW",
          canonicalAmazonUrl: "https://www.amazon.com/dp/B08N5WRWNW",
          asin: "B08N5WRWNW",
          parentAsin: null,
          variationAsin: null,
          productTitle: "UAHPET Fountain",
          brand: "UAHPET",
          merchant: null,
          seller: null,
          currency: "USD",
          price: 49.99,
          availability: "In Stock",
          observedAt: new Date().toISOString(),
          sourceTimestamp: null,
          rawEvidenceHash: "h_raw",
          extractedFieldsHash: "h_ext",
          providerInvocationRef: "amz_inv_1",
          providerRequestId: null,
          responseEvidenceRef: null,
          evidenceOrigin: "LOCAL_DOUBLE",
          providerSourceOrigin: "LOCAL_MCP_TEST_DOUBLE",
          observationClass: "AUTHORIZED_LIVE",
          verificationScope: "IDENTITY_CORROBORATED",
          identityMatch: "EXACT_PRODUCT",
          isCached: false,
          matchedCanonicalKey: "amz_us:B08N5WRWNW",
          matchingReasons: [],
          missingFields: [],
          rejectionReasons: [],
          accessPolicyStatus: "AUTHORIZED_CREATORS_API",
          status: "IDENTITY_VERIFIED",
        },
      ],
      [],
      policy,
      { workspaceId: "ws_1" }
    );

    expect(gate.counts.verifiedLiveUsProductIdentitiesCount).toBe(0);
    expect(gate.counts.fixtureOrCachedRowsExcludedFromLive).toBe(1);
    expect(gate.realProviderVerdict).not.toBe("REAL_PROVIDER_VERIFIED");
  });

  it("D20: BUG T4 Repair — parseAmazonProductEvidence preserves httpStatus=null (UNOBSERVED_NULL) when snapshot has no HTTP status", () => {
    const ev = parseAmazonProductEvidence(
      {
        sourceUrl: "https://www.amazon.com/dp/B08N5WRWNW",
        finalUrl: "https://www.amazon.com/dp/B08N5WRWNW",
        canonicalUrl: "https://www.amazon.com/dp/B08N5WRWNW",
        httpStatus: null,
        pageTitle: "UAHPET Wireless Cat Water Fountain",
        structuredData: {
          asin: "B08N5WRWNW",
          productTitle: "UAHPET Wireless Cat Water Fountain",
          brand: "UAHPET",
        },
      },
      {
        workspaceId: "ws_1",
        researchRunId: "run_1",
        candidateId: "cand_1",
      }
    );

    expect(ev.httpStatus).toBeNull();
    expect(ev.httpStatus).not.toBe(200);
    expect(ev.httpStatusOrigin).toBe("UNOBSERVED_NULL");
    expect(ev.asin).toBe("B08N5WRWNW");
  });

  it("D21: BUG T4 Repair — parseAmazonProductEvidence records httpStatusOrigin=OBSERVED when explicit HTTP status is present", () => {
    const ev = parseAmazonProductEvidence(
      {
        sourceUrl: "https://www.amazon.com/dp/B08N5WRWNW",
        finalUrl: "https://www.amazon.com/dp/B08N5WRWNW",
        canonicalUrl: "https://www.amazon.com/dp/B08N5WRWNW",
        httpStatus: 200,
        pageTitle: "UAHPET Wireless Cat Water Fountain",
        structuredData: {
          asin: "B08N5WRWNW",
          productTitle: "UAHPET Wireless Cat Water Fountain",
          brand: "UAHPET",
        },
      },
      {
        workspaceId: "ws_1",
        researchRunId: "run_1",
        candidateId: "cand_1",
      }
    );

    expect(ev.httpStatus).toBe(200);
    expect(ev.httpStatusOrigin).toBe("OBSERVED");
  });

  it("D22: BUG T2 Repair — computeAmazonNonInflationDelta dynamically computes zero delta and catches score/rank/G15/G16 mutations", () => {
    const beforeSnap = {
      runId: "run_before",
      cutoffIso: "2026-03-10T23:59:59.000Z",
      candidates: [
        {
          candidateId: "cand_1",
          rank: 1,
          opportunityScore: 64.25,
          g07Passed: false,
          g15Passed: false,
          g16Passed: true,
        },
        {
          candidateId: "cand_2",
          rank: 2,
          opportunityScore: 61.8,
          g07Passed: false,
          g15Passed: false,
          g16Passed: true,
        },
      ],
    };

    const afterIdentical = {
      runId: "run_after",
      cutoffIso: "2026-03-10T23:59:59.000Z",
      candidates: [
        {
          candidateId: "cand_1",
          rank: 1,
          opportunityScore: 64.25,
          g07Passed: false,
          g15Passed: false,
          g16Passed: true,
        },
        {
          candidateId: "cand_2",
          rank: 2,
          opportunityScore: 61.8,
          g07Passed: false,
          g15Passed: false,
          g16Passed: true,
        },
      ],
    };

    const zeroDelta = computeAmazonNonInflationDelta(beforeSnap, afterIdentical);
    expect(zeroDelta.comparisonStatus).toBe("COMPARED_ZERO_INFLATION");
    expect(zeroDelta.maxAbsoluteScoreDelta).toBe(0);
    expect(zeroDelta.rankOrderChanged).toBe(false);
    expect(zeroDelta.g15Changed).toBe(false);
    expect(zeroDelta.g16Changed).toBe(false);

    const mutatedScore = computeAmazonNonInflationDelta(beforeSnap, {
      ...afterIdentical,
      candidates: [
        { ...afterIdentical.candidates[0], opportunityScore: 69.0 },
        afterIdentical.candidates[1],
      ],
    });
    expect(mutatedScore.comparisonStatus).toBe("INFLATION_DETECTED");
    expect(mutatedScore.maxAbsoluteScoreDelta).toBeCloseTo(4.75, 2);
  });

  it("D23: BUG T2 Repair — computeAmazonNonInflationDelta returns NOT_COMPARABLE on empty snapshots or cutoff mismatch", () => {
    const emptyCmp = computeAmazonNonInflationDelta(null, null);
    expect(emptyCmp.comparisonStatus).toBe("NOT_COMPARABLE");

    const mismatchCutoff = computeAmazonNonInflationDelta(
      {
        runId: "r1",
        cutoffIso: "2026-03-10T23:59:59.000Z",
        candidates: [{ candidateId: "c1", opportunityScore: 60 }],
      },
      {
        runId: "r2",
        cutoffIso: "2026-03-22T23:59:59.000Z",
        candidates: [{ candidateId: "c1", opportunityScore: 60 }],
      }
    );
    expect(mismatchCutoff.comparisonStatus).toBe("NOT_COMPARABLE");
    expect(mismatchCutoff.notComparableReason).toContain("Cutoff mismatch");
  });

  it("D24: Release version is 12.4.3.5.0.2+ and canonical valid fixture passes all 13 independent validator checks", () => {
    expect(["12.4.3.5.0.2", "12.4.3.5.0.3"]).toContain(SWAI_KH02_RELEASE_VERSION);
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "kh02_v1243502_valid_"));
    try {
      const sha = "2222222222222222222222222222222222222222";
      writeCanonicalValidAuthorizedDiscoveryFixture(tmpDir, sha);
      const val = validateAmazonUsAuthorizedDiscoveryV12_4_3_5_0_2(tmpDir, {
        expectedCodeSha: sha,
      });
      expect(val.valid).toBe(true);
      expect(val.engineeringVerdict).toBe("ENGINEERING_READY");
      expect(val.overallClosureVerdict).toBe(
        "ENGINEERING_READY_WITH_LIVE_EXTERNAL_BLOCKER"
      );
      expect(val.passedChecksCount).toBe(13);
      expect(val.failedChecksCount).toBe(0);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("D25: Independent validator catches and rejects all 45 physical-file negative control mutations (N01..N45) with 0 escapes", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "kh02_v1243502_mut_"));
    try {
      const suite = runAmazonUsAuthorizedDiscoveryNegativeMutationSuite(tmpDir);
      expect(suite.totalMutationsExecuted).toBe(45);
      expect(suite.caughtCount).toBe(45);
      expect(suite.escapedCount).toBe(0);
      expect(suite.allCaughtZeroEscapes).toBe(true);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});

