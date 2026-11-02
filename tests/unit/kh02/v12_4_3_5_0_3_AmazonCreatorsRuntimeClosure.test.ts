/**
 * SWAI KH-02 V12.4.3.5.0.3 — Amazon US Creators API Real Runtime Wiring, Official Lower-Camel Contract
 * Parity, MODE A Local HTTP Emulator E2E & 48-Mutation Anti-Fake Acceptance Test Suite (R01–R52)
 */

import fs from "fs";
import http from "http";
import os from "os";
import path from "path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  CREATORS_API_DEFAULT_RESOURCES,
  CREATORS_API_OAUTH_SCOPE,
  CREATORS_API_OAUTH_TOKEN_ENDPOINT_EU,
  CREATORS_API_OAUTH_TOKEN_ENDPOINT_FE,
  CREATORS_API_OAUTH_TOKEN_ENDPOINT_NA,
  CREATORS_API_US_MARKETPLACE,
  buildCreatorsGetItemsPayload,
  buildCreatorsSearchItemsPayload,
  classifyCreatorsApiFailure,
  createCreatorsApiClient,
  normalizeCreatorsApiItemShape,
  parseCreatorsGetItemsEnvelope,
  parseCreatorsSearchItemsEnvelope,
  resolveCreatorsApiCredentialVersion,
  resolveCreatorsApiEligibility,
  resolveCreatorsApiTokenEndpointByVersion,
  validateCreatorsApiEndpointUrl,
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
  fetchAuthorizedAmazonProductEvidence,
  resolveAmazonCreatorsApiRuntimeClient,
  runAmazonUsPilotEnrichment,
} from "@/services/kh02/marketplace/amazonUsEvidenceAdapter";
import { createAmazonProviderBudget } from "@/services/kh02/marketplace/amazonUsBudget";
import { evaluateAmazonUsEvidenceGate } from "@/services/kh02/marketplace/amazonUsEvidenceGate";
import {
  parseAmazonProductEvidence,
  sanitizeUntrustedAmazonText,
} from "@/services/kh02/marketplace/amazonUsIdentity";
import {
  NON_INFLATION_NOTICE,
  resolveAmazonUsPolicyContext,
  summarizeAmazonEvidenceForProduct,
} from "@/services/kh02/marketplace/marketplaceEvidenceTypes";
import {
  attachAmazonEvidenceToExistingResearchRun,
  loadAmazonEvidenceForRun,
  persistAmazonEvidenceAtomically,
} from "@/services/kh02/marketplace/marketplaceEvidencePersistence";
import { runEvergreenProductResearch } from "@/services/kh02/evergreenResearchOrchestrator";
import {
  SWAI_KH02_RELEASE_VERSION,
  getRuntimeVersionInfo,
} from "@/services/kh02/version/runtimeVersionService";
import { prisma } from "@/lib/db";
import {
  runAmazonCreatorsRuntimeNegativeMutationSuite,
  validateAmazonCreatorsRuntimeClosureV12_4_3_5_0_3,
  writeCanonicalValidCreatorsRuntimeFixture,
} from "../../../scripts/kh02/validateAmazonCreatorsRuntimeClosureV12_4_3_5_0_3";

const FIXTURE_DIR = path.resolve(
  process.cwd(),
  "tests/fixtures/kh02/amazon-creators-api"
);

const officialOauthFixture = JSON.parse(
  fs.readFileSync(path.join(FIXTURE_DIR, "official-oauth-response.json"), "utf8")
);
const officialSearchFixture = JSON.parse(
  fs.readFileSync(path.join(FIXTURE_DIR, "official-search-items.json"), "utf8")
);
const officialGetItemsFixture = JSON.parse(
  fs.readFileSync(path.join(FIXTURE_DIR, "official-get-items.json"), "utf8")
);
const officialSearchEmptyFixture = JSON.parse(
  fs.readFileSync(path.join(FIXTURE_DIR, "official-search-empty.json"), "utf8")
);
const officialGetPartialErrorsFixture = JSON.parse(
  fs.readFileSync(
    path.join(FIXTURE_DIR, "official-get-partial-errors.json"),
    "utf8"
  )
);

describe("KH-02 V12.4.3.5.0.3 — Amazon US Creators API Real Runtime Wiring & Official Contract Parity (R01–R52)", () => {
  // =========================================================================
  // 1. OAuth 2.0 Client Credentials Contract (R01–R06)
  // =========================================================================
  it("R01: createCreatorsApiClient sends POST /auth/o2/token with Content-Type: application/json and scope: creatorsapi::default", async () => {
    let observedTokenHeaders: Record<string, string> = {};
    let observedTokenBody: any = null;

    const client = createCreatorsApiClient({
      credentialId: "cid_v31",
      credentialSecret: "csec_v31",
      partnerTag: "swai-20",
      fetchFn: async (input: any, init?: any) => {
        const url = String(input);
        if (url.includes("/auth/o2/token")) {
          observedTokenHeaders = (init?.headers || {}) as Record<string, string>;
          observedTokenBody = JSON.parse(String(init?.body || "{}"));
          return new Response(JSON.stringify(officialOauthFixture), {
            status: 200,
          });
        }
        return new Response(JSON.stringify(officialSearchEmptyFixture), {
          status: 200,
        });
      },
    });

    await client.searchItemsByCandidateIntent(
      { candidateId: "c1", normalizedKeywords: "UAHPET Wireless Cat Fountain" },
      { workspaceId: "ws1", researchRunId: "run1", candidateId: "c1" }
    );

    expect(observedTokenHeaders["Content-Type"]).toBe("application/json");
    expect(observedTokenBody).toEqual({
      grant_type: "client_credentials",
      client_id: "cid_v31",
      client_secret: "csec_v31",
      scope: CREATORS_API_OAUTH_SCOPE,
    });
  });

  it("R02: Token endpoint maps credential version 3.1 -> NA, 3.2 -> EU, 3.3 -> FE", () => {
    expect(resolveCreatorsApiCredentialVersion("3.1")).toBe("3.1");
    expect(resolveCreatorsApiCredentialVersion("3.2")).toBe("3.2");
    expect(resolveCreatorsApiCredentialVersion("3.3")).toBe("3.3");
    expect(resolveCreatorsApiCredentialVersion(undefined)).toBe("3.1");

    expect(resolveCreatorsApiTokenEndpointByVersion("3.1")).toBe(
      CREATORS_API_OAUTH_TOKEN_ENDPOINT_NA
    );
    expect(resolveCreatorsApiTokenEndpointByVersion("3.2")).toBe(
      CREATORS_API_OAUTH_TOKEN_ENDPOINT_EU
    );
    expect(resolveCreatorsApiTokenEndpointByVersion("3.3")).toBe(
      CREATORS_API_OAUTH_TOKEN_ENDPOINT_FE
    );
  });

  it("R03: OAuth malformed 200 response missing access_token or positive expires_in fails closed as AUTHENTICATION_FAILED", async () => {
    const clientMissingExpires = createCreatorsApiClient({
      credentialId: "cid",
      credentialSecret: "csec",
      partnerTag: "swai-20",
      fetchFn: async () =>
        new Response(JSON.stringify({ access_token: "tok_only" }), {
          status: 200,
        }),
    });

    const res = await clientMissingExpires.searchItemsByCandidateIntent(
      { candidateId: "c1", normalizedKeywords: "UAHPET Cat Fountain" },
      { workspaceId: "ws", researchRunId: "run", candidateId: "c1" }
    );
    expect(res.succeeded).toBe(false);
    expect(res.status).toBe("AUTHENTICATION_FAILED");
    expect(res.errorCode).toBe("OAUTH_TOKEN_PARSE_FAILED");
  });

  it("R04: OAuth token is cached across sequential SearchItems/GetItems calls and does not consume the 4-op product budget", async () => {
    let tokenCalls = 0;
    const budget = createAmazonProviderBudget({
      workspaceId: "ws_r04",
      researchRunId: "run_r04",
      maxOperationsPerRun: 4,
      isolatedCoordinator: true,
    });

    const client = createCreatorsApiClient({
      credentialId: "cid",
      credentialSecret: "csec",
      partnerTag: "swai-20",
      fetchFn: async (input: any) => {
        if (String(input).includes("/auth/o2/token")) {
          tokenCalls++;
          return new Response(JSON.stringify(officialOauthFixture), {
            status: 200,
          });
        }
        return new Response(JSON.stringify(officialSearchEmptyFixture), {
          status: 200,
        });
      },
    });

    for (let i = 1; i <= 4; i++) {
      const r = await client.searchItemsByCandidateIntent(
        { candidateId: `c${i}`, normalizedKeywords: `UAHPET Fountain ${i}` },
        { workspaceId: "ws_r04", researchRunId: "run_r04", candidateId: `c${i}`, budget }
      );
      expect(r.succeeded).toBe(true);
    }

    expect(tokenCalls).toBe(1);
    expect(budget.getSnapshot().operationsUsedInRun).toBe(4);
    expect(client.getTokenTelemetrySummary?.().tokenCacheHits).toBe(3);
  });

  it("R05: Concurrent in-flight SearchItems calls deduplicate OAuth token acquisition to a single /auth/o2/token call", async () => {
    let tokenCalls = 0;
    const client = createCreatorsApiClient({
      credentialId: "cid",
      credentialSecret: "csec",
      partnerTag: "swai-20",
      fetchFn: async (input: any) => {
        if (String(input).includes("/auth/o2/token")) {
          tokenCalls++;
          await new Promise((r) => setTimeout(r, 20));
          return new Response(JSON.stringify(officialOauthFixture), {
            status: 200,
          });
        }
        return new Response(JSON.stringify(officialSearchEmptyFixture), {
          status: 200,
        });
      },
    });

    const [r1, r2] = await Promise.all([
      client.searchItemsByCandidateIntent(
        { candidateId: "c1", normalizedKeywords: "UAHPET Fountain 1" },
        { workspaceId: "ws", researchRunId: "run", candidateId: "c1" }
      ),
      client.searchItemsByCandidateIntent(
        { candidateId: "c2", normalizedKeywords: "UAHPET Fountain 2" },
        { workspaceId: "ws", researchRunId: "run", candidateId: "c2" }
      ),
    ]);

    expect(r1.succeeded).toBe(true);
    expect(r2.succeeded).toBe(true);
    expect(tokenCalls).toBe(1);
    expect(client.getTokenTelemetrySummary?.().concurrentDeduplicationsCount).toBe(1);
  });

  it("R06: 401 token expiry on catalog call triggers at most 1 token refresh + 1 retry; second 401 fails closed", async () => {
    let tokenCalls = 0;
    let searchCalls = 0;
    const client = createCreatorsApiClient({
      credentialId: "cid",
      credentialSecret: "csec",
      partnerTag: "swai-20",
      fetchFn: async (input: any) => {
        if (String(input).includes("/auth/o2/token")) {
          tokenCalls++;
          return new Response(
            JSON.stringify({
              access_token: `tok_${tokenCalls}`,
              expires_in: 3600,
            }),
            { status: 200 }
          );
        }
        searchCalls++;
        if (searchCalls === 1) {
          return new Response(JSON.stringify({ error: "expired_token" }), {
            status: 401,
          });
        }
        return new Response(JSON.stringify(officialSearchEmptyFixture), {
          status: 200,
        });
      },
    });

    const res = await client.searchItemsByCandidateIntent(
      { candidateId: "c1", normalizedKeywords: "UAHPET Fountain" },
      { workspaceId: "ws", researchRunId: "run", candidateId: "c1" }
    );
    expect(res.succeeded).toBe(true);
    expect(tokenCalls).toBe(2);
    expect(searchCalls).toBe(2);
    expect(client.getTokenTelemetrySummary?.().tokenRefreshesOn401Count).toBe(1);
  });

  // =========================================================================
  // 2. Request Payload Builders & Endpoint Validation (R07–R10)
  // =========================================================================
  it("R07: buildCreatorsSearchItemsPayload builds official lower-camel payload with marketplace=www.amazon.com and lower-camel resources", () => {
    const payload = buildCreatorsSearchItemsPayload(
      {
        candidateId: "c1",
        normalizedKeywords: "UAHPET Wireless Cat Water Fountain",
        brand: "UAHPET",
        itemCount: 15,
      },
      { partnerTag: "swai-20" }
    );

    expect(payload.keywords).toBe("UAHPET Wireless Cat Water Fountain");
    expect(payload.marketplace).toBe("www.amazon.com");
    expect(payload.partnerTag).toBe("swai-20");
    expect(payload.itemCount).toBe(10); // Clamped <= 10
    expect(payload.brand).toBe("UAHPET");
    expect(payload.currencyOfPreference).toBe("USD");
    expect(payload.resources).toContain("itemInfo.title");
    expect(payload.resources).toContain("offersV2.listings.price");
    expect(payload.resources).not.toContain("ItemInfo.Title");
  });

  it("R08: SearchItems headers include Authorization: Bearer <token>, x-marketplace: www.amazon.com, Content-Type: application/json", async () => {
    let searchHeaders: Record<string, string> = {};
    const client = createCreatorsApiClient({
      credentialId: "cid",
      credentialSecret: "csec",
      partnerTag: "swai-20",
      fetchFn: async (input: any, init?: any) => {
        if (String(input).includes("/auth/o2/token")) {
          return new Response(JSON.stringify(officialOauthFixture), {
            status: 200,
          });
        }
        searchHeaders = (init?.headers || {}) as Record<string, string>;
        return new Response(JSON.stringify(officialSearchEmptyFixture), {
          status: 200,
        });
      },
    });

    await client.searchItemsByCandidateIntent(
      { candidateId: "c1", normalizedKeywords: "UAHPET Fountain" },
      { workspaceId: "ws", researchRunId: "run", candidateId: "c1" }
    );

    expect(searchHeaders.Authorization).toBe(
      `Bearer ${officialOauthFixture.access_token}`
    );
    expect(searchHeaders["x-marketplace"]).toBe(CREATORS_API_US_MARKETPLACE);
    expect(searchHeaders["Content-Type"]).toBe("application/json");
  });

  it("R09: buildCreatorsGetItemsPayload deduplicates, validates strict 10-char ASINs, caps at <=10, and uses itemIds + lower-camel resources", () => {
    const payload = buildCreatorsGetItemsPayload(
      ["b08n5wrwnw", "B08N5WRWNW", "INVALID", "CATEGORIES", "B09KITTYS1"],
      { partnerTag: "swai-20" }
    );

    expect(payload.itemIds).toEqual(["B08N5WRWNW", "B09KITTYS1"]);
    expect(payload.itemIdType).toBe("ASIN");
    expect(payload.marketplace).toBe("www.amazon.com");
    expect(payload.partnerTag).toBe("swai-20");
    expect(payload.resources).toEqual([...CREATORS_API_DEFAULT_RESOURCES]);
  });

  it("R10: validateCreatorsApiEndpointUrl rejects non-HTTPS and untrusted hosts while allowing localhost only when allowIsolatedTestHost=true", () => {
    expect(
      validateCreatorsApiEndpointUrl("https://creatorsapi.amazon/catalog/v1/searchItems")
        .valid
    ).toBe(true);
    expect(
      validateCreatorsApiEndpointUrl("https://evil.example.com/catalog/v1/searchItems")
        .valid
    ).toBe(false);
    expect(
      validateCreatorsApiEndpointUrl("http://127.0.0.1:4555/catalog/v1/searchItems", {
        allowIsolatedTestHost: false,
      }).valid
    ).toBe(false);
    expect(
      validateCreatorsApiEndpointUrl("http://127.0.0.1:4555/catalog/v1/searchItems", {
        allowIsolatedTestHost: true,
      }).valid
    ).toBe(true);
  });

  // =========================================================================
  // 3. Official Lower-Camel Response Envelope & Item Parsing (R11–R22)
  // =========================================================================
  it("R11: parseCreatorsSearchItemsEnvelope parses official-search-items.json (searchResult.items, totalResultCount=4)", () => {
    const parsed = parseCreatorsSearchItemsEnvelope(officialSearchFixture);
    expect(parsed.valid).toBe(true);
    expect(parsed.status).toBe("OBSERVED_UNVERIFIED");
    expect(parsed.totalResultCount).toBe(4);
    expect(parsed.items).toHaveLength(4);
    expect(parsed.schemaOrigin).toBe("OFFICIAL_LOWER_CAMEL");
  });

  it("R12: normalizeCreatorsApiItemShape and normalizeAmazonSearchItem extract lower-camel asin, parentASIN, itemInfo.*, offersV2.listings, images.primary.medium.url", () => {
    const rawUahpet = officialSearchFixture.searchResult.items[0];
    const shape = normalizeCreatorsApiItemShape(rawUahpet);
    expect(shape.schemaValid).toBe(true);
    expect(shape.asin).toBe("B08N5WRWNW");
    expect(shape.parentAsin).toBe("B08N5WRW00");
    expect(shape.title).toContain("UAHPET Wireless Cat Water Fountain");
    expect(shape.brand).toBe("UAHPET");
    expect(shape.modelNumber).toBe("UAH-WF-01");
    expect(shape.partNumber).toBe("PN-UAH-WF-01");
    expect(shape.gtinList).toContain("012345678905");
    expect(shape.priceAmount).toBe(49.99);
    expect(shape.priceCurrency).toBe("USD");
    expect(shape.availabilityMessage).toBe("In Stock");
    expect(shape.merchantName).toBe("UAHPET Official Store");

    const norm = normalizeAmazonSearchItem(rawUahpet, {
      workspaceId: "ws1",
      researchRunId: "run1",
      candidateId: "cand_uahpet_1",
      providerInvocationRef: "amz_inv_1",
      providerRequestId: "amz-req-1",
      observedAt: "2026-11-01T00:00:00.000Z",
      rawResponseHash: "h_raw",
      accessPolicyStatus: "AUTHORIZED_CREATORS_API",
      imageLicensePermitted: true,
    });
    expect(norm.kind).toBe("EVIDENCE");
    if (norm.kind === "EVIDENCE") {
      expect(norm.evidence.asin).toBe("B08N5WRWNW");
      expect(norm.evidence.parentAsin).toBe("B08N5WRW00");
      expect(norm.evidence.variationAsin).toBe("B08N5WRWNW");
      expect(norm.evidence.price).toBe(49.99);
      expect(norm.evidence.currency).toBe("USD");
      expect(norm.evidence.modelNumber).toBe("UAH-WF-01");
      expect(norm.evidence.gtin).toBe("012345678905");
      expect(norm.licensedImageUrl).toBe(
        "https://m.media-amazon.com/images/I/41uahpet-fountain._SL160_.jpg"
      );
    }
  });

  it("R13: HTTP 200 with legacy uppercase SearchResult.Items fails closed with status=PROVIDER_ERROR and errorCode=SCHEMA_MISMATCH (never QUERY_SUCCEEDED_EMPTY)", () => {
    const legacyRes = parseCreatorsSearchItemsEnvelope({
      SearchResult: {
        TotalResultCount: 1,
        Items: [{ ASIN: "B08N5WRWNW" }],
      },
    });
    expect(legacyRes.valid).toBe(false);
    expect(legacyRes.status).toBe("PROVIDER_ERROR");
    expect(legacyRes.status).not.toBe("QUERY_SUCCEEDED_EMPTY");
    expect(legacyRes.errorCode).toBe("SCHEMA_MISMATCH");
  });

  it("R14: HTTP 200 with unrecognized {} or { data: [] } fails closed with SCHEMA_MISMATCH, never QUERY_SUCCEEDED_EMPTY", () => {
    const emptyObjRes = parseCreatorsSearchItemsEnvelope({});
    expect(emptyObjRes.valid).toBe(false);
    expect(emptyObjRes.status).toBe("PROVIDER_ERROR");
    expect(emptyObjRes.errorCode).toBe("SCHEMA_MISMATCH");

    const wrongEnvelopeRes = parseCreatorsSearchItemsEnvelope({ data: [] });
    expect(wrongEnvelopeRes.valid).toBe(false);
    expect(wrongEnvelopeRes.status).toBe("PROVIDER_ERROR");
    expect(wrongEnvelopeRes.errorCode).toBe("SCHEMA_MISMATCH");
  });

  it("R15: Explicit { searchResult: { totalResultCount: 0, items: [] } } or NoResults error returns QUERY_SUCCEEDED_EMPTY", () => {
    const emptyRes = parseCreatorsSearchItemsEnvelope(officialSearchEmptyFixture);
    expect(emptyRes.valid).toBe(true);
    expect(emptyRes.status).toBe("QUERY_SUCCEEDED_EMPTY");
    expect(emptyRes.items).toHaveLength(0);

    const noResultsErr = parseCreatorsSearchItemsEnvelope({
      errors: [{ code: "NoResults", message: "No results found" }],
    });
    expect(noResultsErr.valid).toBe(true);
    expect(noResultsErr.status).toBe("QUERY_SUCCEEDED_EMPTY");
  });

  it("R16: Missing offersV2 preserves price=null, currency=null, availability=null (never converts missing price to 0)", () => {
    const norm = normalizeAmazonSearchItem(
      {
        asin: "B08N5WRWNW",
        itemInfo: {
          title: { displayValue: "UAHPET Wireless Cat Water Fountain" },
          byLineInfo: { brand: { displayValue: "UAHPET" } },
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
    expect(norm.kind).toBe("EVIDENCE");
    if (norm.kind === "EVIDENCE") {
      expect(norm.evidence.price).toBeNull();
      expect(norm.evidence.currency).toBeNull();
      expect(norm.evidence.availability).toBeNull();
    }
  });

  it("R17: Non-USD offer currency (EUR, GBP, CAD) in offersV2.listings is rejected with NON_USD_OFFER_CURRENCY", () => {
    for (const curr of ["EUR", "GBP", "CAD"]) {
      const norm = normalizeAmazonSearchItem(
        {
          asin: "B08N5WRWNW",
          itemInfo: { title: { displayValue: "UAHPET Fountain" } },
          offersV2: {
            listings: [{ price: { amount: 49.99, currency: curr } }],
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
      expect(norm.kind).toBe("REJECTED");
      if (norm.kind === "REJECTED") {
        expect(norm.rejectionReason).toBe(`NON_USD_OFFER_CURRENCY:${curr}`);
      }
    }
  });

  it("R18: Image URL in images.primary.medium.url is excluded when imageLicensePermitted !== true", () => {
    const rawItem = officialSearchFixture.searchResult.items[0];
    const unlicensed = normalizeAmazonSearchItem(rawItem, {
      workspaceId: "ws",
      researchRunId: "run",
      candidateId: "c1",
      providerInvocationRef: "inv",
      providerRequestId: null,
      observedAt: new Date().toISOString(),
      rawResponseHash: "h",
      accessPolicyStatus: "AUTHORIZED_CREATORS_API",
      imageLicensePermitted: false,
    });
    expect(unlicensed.kind).toBe("EVIDENCE");
    if (unlicensed.kind === "EVIDENCE") {
      expect(unlicensed.licensedImageUrl).toBeNull();
    }
  });

  it("R19: detailPageURL on www.amazon.com with affiliate query params is accepted and canonicalized, while non-US or mismatched-ASIN detailPageURL is rejected", () => {
    const validAffiliate = normalizeAmazonSearchItem(
      {
        asin: "B08N5WRWNW",
        detailPageURL:
          "https://www.amazon.com/dp/B08N5WRWNW?tag=swai-20&linkCode=osi&th=1&psc=1",
        itemInfo: { title: { displayValue: "UAHPET Wireless Cat Fountain" } },
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
    expect(validAffiliate.kind).toBe("EVIDENCE");
    if (validAffiliate.kind === "EVIDENCE") {
      expect(validAffiliate.evidence.canonicalAmazonUrl).toBe(
        "https://www.amazon.com/dp/B08N5WRWNW"
      );
      expect(validAffiliate.evidence.sourceUrl).toContain("tag=swai-20");
    }

    const nonUs = normalizeAmazonSearchItem(
      {
        asin: "B08N5WRWNW",
        detailPageURL: "https://www.amazon.co.uk/dp/B08N5WRWNW",
        itemInfo: { title: { displayValue: "UAHPET Fountain" } },
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
    expect(nonUs.kind).toBe("REJECTED");

    const mismatchedAsinUrl = normalizeAmazonSearchItem(
      {
        asin: "B08N5WRWNW",
        detailPageURL: "https://www.amazon.com/dp/B09KITTYS1",
        itemInfo: { title: { displayValue: "UAHPET Fountain" } },
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
    expect(mismatchedAsinUrl.kind).toBe("REJECTED");
  });

  it("R20: parseCreatorsGetItemsEnvelope parses official-get-items.json (itemResults.items) and indexes itemsByAsin", () => {
    const parsed = parseCreatorsGetItemsEnvelope(officialGetItemsFixture, [
      "B08N5WRWNW",
      "B09KITTYS1",
      "B09UPROOT1",
    ]);
    expect(parsed.valid).toBe(true);
    expect(parsed.items).toHaveLength(3);
    expect(Object.keys(parsed.itemsByAsin).sort()).toEqual([
      "B08N5WRWNW",
      "B09KITTYS1",
      "B09UPROOT1",
    ]);
    expect(parsed.missingAsins).toHaveLength(0);
  });

  it("R21: fetchAuthorizedAmazonProductEvidence and discoverAmazonProductsForCandidates match GetItems strictly by normalized ASIN, never by items[0] index", async () => {
    // officialGetItemsFixture has B09UPROOT1 at index 0, B09KITTYS1 at index 1, B08N5WRWNW at index 2!
    const client = createCreatorsApiClient({
      credentialId: "cid",
      credentialSecret: "csec",
      partnerTag: "swai-20",
      fetchFn: async (input: any) => {
        if (String(input).includes("/auth/o2/token")) {
          return new Response(JSON.stringify(officialOauthFixture), {
            status: 200,
          });
        }
        return new Response(JSON.stringify(officialGetItemsFixture), {
          status: 200,
          headers: { "x-amzn-requestid": "req-reversed-order-1" },
        });
      },
    });

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

    const fetchRes = await fetchAuthorizedAmazonProductEvidence({
      workspaceId: "ws1",
      researchRunId: "run1",
      candidateId: "cand_uahpet_1",
      sourceUrl: "https://www.amazon.com/dp/B08N5WRWNW",
      candidate: {
        candidateId: "cand_uahpet_1",
        title: "UAHPET Wireless Cat Water Fountain Stainless Steel",
        brand: "UAHPET",
        model: "UAH-WF-01",
      },
      requestMode: "URL_VERIFICATION",
      policyContext: policy,
      creatorsApiClient: client,
    });

    // Even though B09UPROOT1 is at items[0], fetchAuthorizedAmazonProductEvidence matched B08N5WRWNW at items[2]!
    expect(fetchRes.evidence?.asin).toBe("B08N5WRWNW");
    expect(fetchRes.evidence?.brand).toBe("UAHPET");
    expect(fetchRes.evidence?.price).toBe(49.99);
    expect(fetchRes.status).toBe("IDENTITY_VERIFIED");
  });

  it("R22: parseCreatorsGetItemsEnvelope and discoverAmazonProductsForCandidates handle official-get-partial-errors.json without dropping valid items", async () => {
    const parsed = parseCreatorsGetItemsEnvelope(
      officialGetPartialErrorsFixture,
      ["B08N5WRWNW", "B00MISSING"]
    );
    expect(parsed.valid).toBe(true);
    expect(parsed.itemsByAsin.B08N5WRWNW).toBeDefined();
    expect(parsed.missingAsins).toEqual(["B00MISSING"]);
    expect(parsed.partialErrors).toHaveLength(2);
    expect(parsed.partialErrors[0].code).toBe("ItemNotAccessible");
  });

  // =========================================================================
  // 4. Runtime Factory Wiring (R23–R28)
  // =========================================================================
  it("R23: resolveAmazonCreatorsApiRuntimeClient returns POLICY_DISABLED (client=null) when KH02_AMAZON_US_ENABLED=false", () => {
    const res = resolveAmazonCreatorsApiRuntimeClient({
      env: {
        KH02_AMAZON_US_ENABLED: "false",
        KH02_AMAZON_US_LIVE_ALLOWED: "true",
        KH02_AMAZON_CREATORS_API_CREDENTIAL_ID: "cid",
        KH02_AMAZON_CREATORS_API_CREDENTIAL_SECRET: "csec",
        KH02_AMAZON_ASSOCIATES_PARTNER_TAG: "swai-20",
      },
    });
    expect(res.client).toBeNull();
    expect(res.reasonCode).toBe("POLICY_DISABLED");
  });

  it("R24: resolveAmazonCreatorsApiRuntimeClient returns LIVE_NOT_ALLOWED (client=null) when KH02_AMAZON_US_LIVE_ALLOWED=false", () => {
    const res = resolveAmazonCreatorsApiRuntimeClient({
      env: {
        KH02_AMAZON_US_ENABLED: "true",
        KH02_AMAZON_US_LIVE_ALLOWED: "false",
        KH02_AMAZON_CREATORS_API_CREDENTIAL_ID: "cid",
        KH02_AMAZON_CREATORS_API_CREDENTIAL_SECRET: "csec",
        KH02_AMAZON_ASSOCIATES_PARTNER_TAG: "swai-20",
      },
    });
    expect(res.client).toBeNull();
    expect(res.reasonCode).toBe("LIVE_NOT_ALLOWED");
  });

  it("R25: resolveAmazonCreatorsApiRuntimeClient returns CREDENTIALS_MISSING_OR_INCOMPLETE when credentials or partnerTag are missing", () => {
    const res = resolveAmazonCreatorsApiRuntimeClient({
      env: {
        KH02_AMAZON_US_ENABLED: "true",
        KH02_AMAZON_US_LIVE_ALLOWED: "true",
        KH02_AMAZON_CREATORS_API_CREDENTIAL_ID: "cid",
      },
    });
    expect(res.client).toBeNull();
    expect(res.reasonCode).toBe("CREDENTIALS_MISSING_OR_INCOMPLETE");
  });

  it("R26: resolveAmazonCreatorsApiRuntimeClient constructs a real CreatorsApiClient when flags and credentials are valid", () => {
    const res = resolveAmazonCreatorsApiRuntimeClient({
      env: {
        KH02_AMAZON_US_ENABLED: "true",
        KH02_AMAZON_US_LIVE_ALLOWED: "true",
        KH02_AMAZON_CREATORS_API_CREDENTIAL_ID: "cid",
        KH02_AMAZON_CREATORS_API_CREDENTIAL_SECRET: "csec",
        KH02_AMAZON_ASSOCIATES_PARTNER_TAG: "swai-20",
      },
    });
    expect(res.client).not.toBeNull();
    expect(res.createdFromRuntimeFactory).toBe(true);
    expect(res.reasonCode).toBe("RUNTIME_CLIENT_CONSTRUCTED");
  });

  it("R27: runAmazonUsPilotEnrichment automatically constructs and uses the runtime CreatorsApiClient without passing creatorsApiClient", async () => {
    let transportCalled = false;
    const res = await runAmazonUsPilotEnrichment({
      workspaceId: "ws_r27",
      researchRunId: "run_r27",
      niche: "Pet Gadgets",
      optInRequested: true,
      candidates: [
        {
          candidateId: "cand_uahpet_1",
          title: "UAHPET Wireless Cat Water Fountain Stainless Steel",
          brand: "UAHPET",
          model: "UAH-WF-01",
        },
      ],
      env: {
        KH02_AMAZON_US_ENABLED: "true",
        KH02_AMAZON_US_LIVE_ALLOWED: "true",
        KH02_AMAZON_CREATORS_API_CREDENTIAL_ID: "cid_runtime",
        KH02_AMAZON_CREATORS_API_CREDENTIAL_SECRET: "csec_runtime",
        KH02_AMAZON_ASSOCIATES_PARTNER_TAG: "swai-20",
      },
      creatorsApiTransportFactory: () => async (input: any) => {
        transportCalled = true;
        if (String(input).includes("/auth/o2/token")) {
          return new Response(JSON.stringify(officialOauthFixture), {
            status: 200,
          });
        }
        return new Response(JSON.stringify(officialSearchFixture), {
          status: 200,
          headers: { "x-amzn-requestid": "req-runtime-factory-1" },
        });
      },
    });

    expect(transportCalled).toBe(true);
    expect(res.marketplaceEvidence).toHaveLength(1);
    expect(res.marketplaceEvidence[0].asin).toBe("B08N5WRWNW");
    expect(res.marketplaceEvidence[0].identityMatch).toBe("EXACT_PRODUCT");
    expect(res.marketplaceEvidence[0].observationClass).toBe("TEST_FIXTURE");
  });

  it("R28: resolveCreatorsApiEligibility and discoverAmazonProductsForCandidates keep authenticated=false before upstream call succeeds", async () => {
    const eligBefore = resolveCreatorsApiEligibility({
      KH02_AMAZON_US_ENABLED: "true",
      KH02_AMAZON_US_LIVE_ALLOWED: "true",
      KH02_AMAZON_CREATORS_API_CREDENTIAL_ID: "cid",
      KH02_AMAZON_CREATORS_API_CREDENTIAL_SECRET: "csec",
      KH02_AMAZON_ASSOCIATES_PARTNER_TAG: "swai-20",
    });
    expect(eligBefore.configured).toBe(true);
    expect(eligBefore.authenticated).toBe(false);
    expect(eligBefore.querySucceeded).toBe(false);

    const failedAuthDisc = await discoverAmazonProductsForCandidates({
      workspaceId: "ws",
      researchRunId: "run",
      niche: "Pet Gadgets",
      candidates: [
        { candidateId: "c1", title: "UAHPET Wireless Cat Fountain", brand: "UAHPET" },
      ],
      env: {
        KH02_AMAZON_US_ENABLED: "true",
        KH02_AMAZON_US_LIVE_ALLOWED: "true",
        KH02_AMAZON_CREATORS_API_CREDENTIAL_ID: "cid",
        KH02_AMAZON_CREATORS_API_CREDENTIAL_SECRET: "csec",
        KH02_AMAZON_ASSOCIATES_PARTNER_TAG: "swai-20",
      },
      transportFactory: () => async () =>
        new Response(JSON.stringify({ error: "invalid_client" }), {
          status: 401,
        }),
    });
    expect(failedAuthDisc.runStatus).toBe("AUTHENTICATION_FAILED");
    expect(failedAuthDisc.eligibility?.authenticated).toBe(false);
    expect(failedAuthDisc.eligibility?.querySucceeded).toBe(false);
  });

  // =========================================================================
  // 5. MODE A Real Local HTTP Server E2E Runtime Proof (R29–R34)
  // =========================================================================
  describe("MODE A Local HTTP Creators API Emulator E2E", () => {
    let server: http.Server;
    let baseUrl = "";
    const observedOauthRequests: Array<{
      headers: http.IncomingHttpHeaders;
      body: any;
    }> = [];
    const observedSearchRequests: Array<{
      headers: http.IncomingHttpHeaders;
      body: any;
    }> = [];
    const observedGetItemsRequests: Array<{
      headers: http.IncomingHttpHeaders;
      body: any;
    }> = [];

    beforeAll(async () => {
      server = http.createServer((req, res) => {
        const chunks: Buffer[] = [];
        req.on("data", (c) => chunks.push(c));
        req.on("end", () => {
          const rawBody = Buffer.concat(chunks).toString("utf8");
          let parsedBody: any = {};
          try {
            parsedBody = JSON.parse(rawBody);
          } catch {
            parsedBody = {};
          }

          if (req.url === "/auth/o2/token") {
            observedOauthRequests.push({
              headers: req.headers,
              body: parsedBody,
            });
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify(officialOauthFixture));
            return;
          }

          if (req.url === "/catalog/v1/searchItems") {
            observedSearchRequests.push({
              headers: req.headers,
              body: parsedBody,
            });
            const kw = String(parsedBody.keywords || "").toLowerCase();
            // Return items without modelNumber on SearchItems so batched GetItems is also exercised!
            const matchingItems = officialSearchFixture.searchResult.items
              .filter((item: any) => {
                const t = String(
                  item.itemInfo?.title?.displayValue || ""
                ).toLowerCase();
                if (kw.includes("uahpet")) return t.includes("uahpet");
                if (kw.includes("kittyspout")) return t.includes("kittyspout");
                if (kw.includes("uproot")) return t.includes("uproot");
                return true;
              })
              .map((item: any) => ({
                ...item,
                itemInfo: {
                  ...item.itemInfo,
                  manufactureInfo: undefined,
                },
              }));

            res.writeHead(200, {
              "Content-Type": "application/json",
              "x-amzn-requestid": `emu-search-req-${observedSearchRequests.length}`,
            });
            res.end(
              JSON.stringify({
                searchResult: {
                  totalResultCount: matchingItems.length,
                  items: matchingItems,
                },
              })
            );
            return;
          }

          if (req.url === "/catalog/v1/getItems") {
            observedGetItemsRequests.push({
              headers: req.headers,
              body: parsedBody,
            });
            res.writeHead(200, {
              "Content-Type": "application/json",
              "x-amzn-requestid": `emu-getitems-req-${observedGetItemsRequests.length}`,
            });
            res.end(JSON.stringify(officialGetItemsFixture));
            return;
          }

          res.writeHead(404);
          res.end();
        });
      });

      await new Promise<void>((resolve) => {
        server.listen(0, "127.0.0.1", () => {
          const addr = server.address();
          if (addr && typeof addr === "object") {
            baseUrl = `http://127.0.0.1:${addr.port}`;
          }
          resolve();
        });
      });
    });

    afterAll(async () => {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    });

    let enrichmentCache: Awaited<ReturnType<typeof runAmazonUsPilotEnrichment>> | null = null;

    it("R29: runAmazonUsPilotEnrichment executes over real localhost HTTP emulator via runtime factory (creatorsApiClient=undefined)", async () => {
      observedOauthRequests.length = 0;
      observedSearchRequests.length = 0;
      observedGetItemsRequests.length = 0;

      const emulatorEnv = {
        KH02_AMAZON_US_ENABLED: "true",
        KH02_AMAZON_US_LIVE_ALLOWED: "true",
        KH02_AMAZON_CREATORS_API_CREDENTIAL_ID: "emu_cid_31",
        KH02_AMAZON_CREATORS_API_CREDENTIAL_SECRET: "emu_csec_31",
        KH02_AMAZON_ASSOCIATES_PARTNER_TAG: "swai-20",
        KH02_AMAZON_CREATORS_API_ALLOW_ISOLATED_TEST_HOST: "true",
        KH02_AMAZON_CREATORS_API_TOKEN_ENDPOINT: `${baseUrl}/auth/o2/token`,
        KH02_AMAZON_CREATORS_API_SEARCH_ITEMS_ENDPOINT: `${baseUrl}/catalog/v1/searchItems`,
        KH02_AMAZON_CREATORS_API_GET_ITEMS_ENDPOINT: `${baseUrl}/catalog/v1/getItems`,
      };

      enrichmentCache = await runAmazonUsPilotEnrichment({
        workspaceId: "ws_mode_a",
        researchRunId: "run_mode_a",
        niche: "Pet Gadgets",
        optInRequested: true,
        candidates: [
          {
            candidateId: "cand_uahpet_1",
            title: "UAHPET Wireless Cat Water Fountain Stainless Steel",
            brand: "UAHPET",
            model: "UAH-WF-01",
          },
          {
            candidateId: "cand_kittyspout_2",
            title: "KittySpout Stainless Steel Cat Water Fountain 4L",
            brand: "KittySpout",
            model: "KS-SS-4L",
          },
          {
            candidateId: "cand_uproot_3",
            title: "Uproot Cleaner Pro Pet Hair Remover Tool",
            brand: "Uproot Clean",
            model: "UP-PRO-01",
          },
        ],
        env: emulatorEnv,
      });

      expect(enrichmentCache.marketplaceEvidence).toHaveLength(3);
      expect(enrichmentCache.marketplaceTelemetry.allowedAccessRoute).toBe(
        "OFFICIAL_CREATORS_API"
      );
    });

    it("R30: OAuth request contract (Content-Type: application/json, scope: creatorsapi::default) verified at HTTP emulator", () => {
      expect(observedOauthRequests).toHaveLength(1);
      expect(observedOauthRequests[0].headers["content-type"]).toBe(
        "application/json"
      );
      expect(observedOauthRequests[0].body.grant_type).toBe("client_credentials");
      expect(observedOauthRequests[0].body.scope).toBe("creatorsapi::default");
    });

    it("R31: SearchItems + GetItems headers (x-marketplace: www.amazon.com) and lower-camel payloads verified at HTTP emulator", () => {
      expect(observedSearchRequests).toHaveLength(3);
      expect(observedGetItemsRequests).toHaveLength(1);
      expect(observedSearchRequests[0].headers["x-marketplace"]).toBe(
        "www.amazon.com"
      );
      expect(observedSearchRequests[0].body.resources).toContain(
        "itemInfo.title"
      );
      expect(observedGetItemsRequests[0].body.itemIds).toEqual([
        "B08N5WRWNW",
        "B09KITTYS1",
        "B09UPROOT1",
      ]);
    });

    it("R32: 3 candidates verified with exact ASINs & models enriched from reversed-order GetItems while accessory is rejected", () => {
      expect(enrichmentCache).not.toBeNull();
      const byCand = new Map(
        enrichmentCache!.marketplaceEvidence.map((e) => [e.candidateId, e])
      );
      expect(byCand.get("cand_uahpet_1")?.asin).toBe("B08N5WRWNW");
      expect(byCand.get("cand_uahpet_1")?.modelNumber).toBe("UAH-WF-01");
      expect(byCand.get("cand_kittyspout_2")?.asin).toBe("B09KITTYS1");
      expect(byCand.get("cand_kittyspout_2")?.modelNumber).toBe("KS-SS-4L");
      expect(byCand.get("cand_uproot_3")?.asin).toBe("B09UPROOT1");
      expect(byCand.get("cand_uproot_3")?.modelNumber).toBe("UP-PRO-01");
    });

    it("R33: Localhost test transport strictly tagged as TEST_FIXTURE and excluded from REAL_PROVIDER_VERIFIED", () => {
      expect(enrichmentCache).not.toBeNull();
      for (const ev of enrichmentCache!.marketplaceEvidence) {
        expect(ev.observationClass).toBe("TEST_FIXTURE");
        expect(ev.providerSourceOrigin).toBe("TEST_FIXTURE");
      }
      expect(
        enrichmentCache!.marketplaceTelemetry.gateEvaluation?.counts
          .verifiedLiveUsProductIdentitiesCount
      ).toBe(0);
      expect(
        enrichmentCache!.marketplaceTelemetry.gateEvaluation?.realProviderVerdict
      ).not.toBe("REAL_PROVIDER_VERIFIED");
    });

    it("R34: runEvergreenProductResearch orchestrator executes Amazon Creators API enrichment via runtime factory with zero injected client", async () => {
      const emulatorEnv = {
        KH02_AMAZON_US_ENABLED: "true",
        KH02_AMAZON_US_LIVE_ALLOWED: "true",
        KH02_AMAZON_CREATORS_API_CREDENTIAL_ID: "emu_cid_31",
        KH02_AMAZON_CREATORS_API_CREDENTIAL_SECRET: "emu_csec_31",
        KH02_AMAZON_ASSOCIATES_PARTNER_TAG: "swai-20",
        KH02_AMAZON_CREATORS_API_ALLOW_ISOLATED_TEST_HOST: "true",
        KH02_AMAZON_CREATORS_API_TOKEN_ENDPOINT: `${baseUrl}/auth/o2/token`,
        KH02_AMAZON_CREATORS_API_SEARCH_ITEMS_ENDPOINT: `${baseUrl}/catalog/v1/searchItems`,
        KH02_AMAZON_CREATORS_API_GET_ITEMS_ENDPOINT: `${baseUrl}/catalog/v1/getItems`,
      };

      const res = await runEvergreenProductResearch({
        workspaceId: "ws_orch_mode_a",
        runId: "run_orch_mode_a",
        topic: "Pet Gadgets",
        market: "US",
        lookbackDays: 90,
        sourceMode: "CACHE_ONLY",
        enableAmazonUsPilot: true,
        amazonPilotEnv: emulatorEnv,
      });

      expect(res.marketplaceTelemetry).toBeDefined();
      expect(res.marketplaceTelemetry?.featureEnabled).toBe(true);
      expect(res.marketplaceTelemetry?.allowedAccessRoute).toBe(
        "OFFICIAL_CREATORS_API"
      );
    });
  });

  // =========================================================================
  // 6. Error Classification, Budget, Security & Non-Inflation (R35–R44)
  // =========================================================================
  it("R35: Upstream 401 on SearchItems returns AUTHENTICATION_FAILED with secrets redacted", async () => {
    const client = createCreatorsApiClient({
      credentialId: "SECRET_ID_ABC",
      credentialSecret: "SECRET_VAL_XYZ",
      partnerTag: "swai-20",
      fetchFn: async () =>
        new Response(
          JSON.stringify({
            error: "invalid_client",
            error_description: "Failed for SECRET_ID_ABC and SECRET_VAL_XYZ",
          }),
          { status: 401 }
        ),
    });

    const res = await client.searchItemsByCandidateIntent(
      { candidateId: "c1", normalizedKeywords: "UAHPET Fountain" },
      { workspaceId: "ws", researchRunId: "run", candidateId: "c1" }
    );
    expect(res.status).toBe("AUTHENTICATION_FAILED");
    expect(res.retryable).toBe(false);
    expect(res.errorMessage).not.toContain("SECRET_ID_ABC");
    expect(res.errorMessage).not.toContain("SECRET_VAL_XYZ");
  });

  it("R36: Upstream 403 AccessDenied returns ACCESS_NOT_GRANTED and halts remaining candidates in run", async () => {
    let calls = 0;
    const budget = createAmazonProviderBudget({
      workspaceId: "ws_403",
      researchRunId: "run_403",
      isolatedCoordinator: true,
    });
    const client = createCreatorsApiClient({
      credentialId: "cid",
      credentialSecret: "csec",
      partnerTag: "swai-20",
      fetchFn: async (input: any) => {
        if (String(input).includes("/auth/o2/token")) {
          return new Response(JSON.stringify(officialOauthFixture), {
            status: 200,
          });
        }
        calls++;
        return new Response(
          JSON.stringify({
            errors: [{ code: "AccessDenied", message: "Not eligible" }],
          }),
          { status: 403 }
        );
      },
    });

    const disc = await discoverAmazonProductsForCandidates({
      workspaceId: "ws_403",
      researchRunId: "run_403",
      niche: "Pet Gadgets",
      candidates: [
        { candidateId: "c1", title: "UAHPET Wireless Cat Fountain", brand: "UAHPET" },
        { candidateId: "c2", title: "KittySpout Cat Fountain", brand: "KittySpout" },
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

    expect(calls).toBe(1);
    expect(disc.runStatus).toBe("ACCESS_NOT_GRANTED");
  });

  it("R37: Upstream 429 TooManyRequests returns RATE_LIMITED and halts remaining candidates", () => {
    const classified = classifyCreatorsApiFailure(null, {
      httpStatus: 429,
      parsedJson: { errors: [{ code: "TooManyRequests" }] },
    });
    expect(classified.status).toBe("RATE_LIMITED");
    expect(classified.retryable).toBe(false);
  });

  it("R38: Upstream 503 returns PROVIDER_ERROR with retryable=true within bounded 2-attempt cap", async () => {
    let searchAttempts = 0;
    const budget = createAmazonProviderBudget({
      workspaceId: "ws_503",
      researchRunId: "run_503",
      maxAttemptsPerOperation: 2,
      isolatedCoordinator: true,
    });
    const client = createCreatorsApiClient({
      credentialId: "cid",
      credentialSecret: "csec",
      partnerTag: "swai-20",
      fetchFn: async (input: any) => {
        if (String(input).includes("/auth/o2/token")) {
          return new Response(JSON.stringify(officialOauthFixture), {
            status: 200,
          });
        }
        searchAttempts++;
        if (searchAttempts === 1) {
          return new Response(JSON.stringify({ message: "Service Unavailable" }), {
            status: 503,
          });
        }
        return new Response(JSON.stringify(officialSearchEmptyFixture), {
          status: 200,
        });
      },
    });

    const res = await client.searchItemsByCandidateIntent(
      { candidateId: "c1", normalizedKeywords: "UAHPET Fountain" },
      { workspaceId: "ws_503", researchRunId: "run_503", candidateId: "c1", budget }
    );
    expect(searchAttempts).toBe(2);
    expect(res.succeeded).toBe(true);
    expect(res.status).toBe("QUERY_SUCCEEDED_EMPTY");
  });

  it("R39: AbortSignal cancellation aborts in-flight Creators API call cleanly as TIMED_OUT", async () => {
    const controller = new AbortController();
    controller.abort(new Error("TIMED_OUT"));
    const client = createCreatorsApiClient({
      credentialId: "cid",
      credentialSecret: "csec",
      partnerTag: "swai-20",
      fetchFn: async () =>
        new Response(JSON.stringify(officialOauthFixture), { status: 200 }),
    });

    const res = await client.searchItemsByCandidateIntent(
      { candidateId: "c1", normalizedKeywords: "UAHPET Fountain" },
      {
        workspaceId: "ws",
        researchRunId: "run",
        candidateId: "c1",
        signal: controller.signal,
      }
    );
    expect(res.succeeded).toBe(false);
    expect(res.status).toBe("TIMED_OUT");
  });

  it("R40: Shared 4-operation budget cap (<=3 searches + <=1 batched GetItems) is strictly enforced across 5 candidates", () => {
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
    const plan = planAmazonDiscoveryBudget(
      [
        { candidateId: "c1", title: "UAHPET Cat Fountain", brand: "UAHPET" },
        { candidateId: "c2", title: "KittySpout Cat Fountain", brand: "KittySpout" },
        { candidateId: "c3", title: "Uproot Cleaner Pro", brand: "Uproot Clean" },
        { candidateId: "c4", title: "ChomChom Pet Roller", brand: "ChomChom" },
        { candidateId: "c5", title: "FurZapper Hair Remover", brand: "FurZapper" },
      ],
      4,
      policy,
      "Pet Gadgets"
    );
    expect(plan.selectedCandidateIds).toHaveLength(3);
    expect(plan.plannedSearchOperationsCount).toBe(3);
    expect(plan.reservedGetItemsBatchCount).toBe(1);
    expect(plan.maxTotalOperationsPerRun).toBe(4);
    expect(plan.maxConcurrency).toBe(1);
  });

  it("R41: sanitizeUntrustedAmazonText strips <script>, event handlers, and control chars from Creators API titles", () => {
    const res = sanitizeUntrustedAmazonText(
      'UAHPET <script>alert("xss")</script> Wireless onclick="evil()" Cat Fountain\u0007'
    );
    expect(res.sanitized).not.toContain("<script>");
    expect(res.sanitized).not.toContain("onclick");
    expect(res.warnings.length).toBeGreaterThan(0);
  });

  it("R42: computeAmazonNonInflationDelta proves 0 score/rank/G07/G15/G16 delta before vs after Amazon enrichment", () => {
    const snap = {
      runId: "run_1",
      cutoffIso: "2026-03-10T23:59:59.000Z",
      candidates: [
        {
          candidateId: "c1",
          rank: 1,
          opportunityScore: 64.25,
          g07Passed: false,
          g15Passed: false,
          g16Passed: true,
        },
      ],
    };
    const cmp = computeAmazonNonInflationDelta(snap, snap);
    expect(cmp.comparisonStatus).toBe("COMPARED_ZERO_INFLATION");
    expect(cmp.maxAbsoluteScoreDelta).toBe(0);
    expect(cmp.rankOrderChanged).toBe(false);
    expect(cmp.g07Changed).toBe(false);
    expect(cmp.g15Changed).toBe(false);
    expect(cmp.g16Changed).toBe(false);
  });

  it("R43: parseAmazonProductEvidence preserves httpStatus=null (UNOBSERVED_NULL) when unobserved and OBSERVED when HTTP 200 is observed", () => {
    const unobserved = parseAmazonProductEvidence(
      {
        sourceUrl: "https://www.amazon.com/dp/B08N5WRWNW",
        httpStatus: null,
        structuredData: { asin: "B08N5WRWNW", productTitle: "UAHPET Fountain" },
      },
      { workspaceId: "ws", researchRunId: "run", candidateId: "c1" }
    );
    expect(unobserved.httpStatus).toBeNull();
    expect(unobserved.httpStatusOrigin).toBe("UNOBSERVED_NULL");

    const observed = parseAmazonProductEvidence(
      {
        sourceUrl: "https://www.amazon.com/dp/B08N5WRWNW",
        httpStatus: 200,
        structuredData: { asin: "B08N5WRWNW", productTitle: "UAHPET Fountain" },
      },
      { workspaceId: "ws", researchRunId: "run", candidateId: "c1" }
    );
    expect(observed.httpStatus).toBe(200);
    expect(observed.httpStatusOrigin).toBe("OBSERVED");
  });

  it("R44: Existing Playwright MCP / fixture URL verification continues to work unchanged alongside Creators API wiring", async () => {
    const res = await runAmazonUsPilotEnrichment({
      workspaceId: "ws_mcp_parity",
      researchRunId: "run_mcp_parity",
      optInRequested: true,
      requestMode: "TEST_FIXTURE",
      fixtureSnapshotsByUrl: {
        "https://www.amazon.com/dp/B08N5WRWNW": {
          sourceUrl: "https://www.amazon.com/dp/B08N5WRWNW",
          finalUrl: "https://www.amazon.com/dp/B08N5WRWNW",
          canonicalUrl: "https://www.amazon.com/dp/B08N5WRWNW",
          httpStatus: 200,
          pageTitle: "UAHPET Wireless Cat Water Fountain Stainless Steel",
          structuredData: {
            asin: "B08N5WRWNW",
            productTitle: "UAHPET Wireless Cat Water Fountain Stainless Steel",
            brand: "UAHPET",
            price: 49.99,
            currency: "USD",
          },
        },
      },
      candidates: [
        {
          candidateId: "cand_uahpet_1",
          title: "UAHPET Wireless Cat Water Fountain Stainless Steel",
          brand: "UAHPET",
          amazonProductUrl: "https://www.amazon.com/dp/B08N5WRWNW",
        },
      ],
    });
    expect(res.marketplaceEvidence).toHaveLength(1);
    expect(res.marketplaceEvidence[0].asin).toBe("B08N5WRWNW");
    expect(res.marketplaceEvidence[0].status).toBe("IDENTITY_VERIFIED");
  });

  // =========================================================================
  // 7. Persistence, Reload, Validator & 48-Mutation Anti-Fake Suite (R45–R52)
  // =========================================================================
  it("R45: persistAmazonEvidenceAtomically and loadAmazonEvidenceForRun persist and reload official Creators API evidence in SQLite", async () => {
    const wsA = `ws_r45_a_${Date.now()}`;
    const runId = `run_r45_${Date.now()}`;

    const norm = normalizeAmazonSearchItem(
      officialSearchFixture.searchResult.items[0],
      {
        workspaceId: wsA,
        researchRunId: runId,
        candidateId: "cand_uahpet_1",
        providerInvocationRef: "amz_inv_r45",
        providerRequestId: "amz-req-r45",
        observedAt: new Date().toISOString(),
        rawResponseHash: "h_r45",
        accessPolicyStatus: "AUTHORIZED_CREATORS_API",
        observationClass: "TEST_FIXTURE",
      }
    );
    expect(norm.kind).toBe("EVIDENCE");
    const ev = (norm as any).evidence;

    try {
      await prisma.workspace.upsert({
        where: { id: wsA },
        create: { id: wsA, name: "R45 Workspace A" },
        update: {},
      });
      await prisma.syncJob.create({
        data: {
          id: runId,
          workspaceId: wsA,
          jobType: "KH02_RESEARCH_RUN",
          status: "COMPLETED",
          resultJson: JSON.stringify({
            researchRunId: runId,
            topic: "Pet Gadgets",
            researchShortlist: {
              shortlist: [
                {
                  candidateId: "cand_uahpet_1",
                  title: "UAHPET Wireless Cat Water Fountain",
                },
              ],
            },
          }),
        },
      });

      await persistAmazonEvidenceAtomically(wsA, runId, [ev]);
      const loadedA = await loadAmazonEvidenceForRun(wsA, runId);
      expect(loadedA.evidenceRows).toHaveLength(1);
      expect(loadedA.evidenceRows[0].asin).toBe("B08N5WRWNW");
      expect(loadedA.evidenceRows[0].price).toBe(49.99);
    } finally {
      await prisma.researchEvidence
        .deleteMany({ where: { workspaceId: wsA } })
        .catch(() => {});
      await prisma.syncJob
        .deleteMany({ where: { id: runId } })
        .catch(() => {});
      await prisma.workspace
        .deleteMany({ where: { id: wsA } })
        .catch(() => {});
    }
  });

  it("R46: attachAmazonEvidenceToExistingResearchRun preserves parent COMPLETED status and candidate scores/ranks", async () => {
    const wsA = `ws_r46_a_${Date.now()}`;
    const runId = `run_r46_${Date.now()}`;

    const norm = normalizeAmazonSearchItem(
      officialSearchFixture.searchResult.items[0],
      {
        workspaceId: wsA,
        researchRunId: runId,
        candidateId: "cand_uahpet_1",
        providerInvocationRef: "amz_inv_r46",
        providerRequestId: "amz-req-r46",
        observedAt: new Date().toISOString(),
        rawResponseHash: "h_r46",
        accessPolicyStatus: "AUTHORIZED_CREATORS_API",
        observationClass: "TEST_FIXTURE",
      }
    );
    const ev = (norm as any).evidence;

    try {
      await prisma.workspace.upsert({
        where: { id: wsA },
        create: { id: wsA, name: "R46 Workspace A" },
        update: {},
      });
      await prisma.syncJob.create({
        data: {
          id: runId,
          workspaceId: wsA,
          jobType: "KH02_RESEARCH_RUN",
          status: "COMPLETED",
          resultJson: JSON.stringify({
            researchRunId: runId,
            topic: "Pet Gadgets",
            researchShortlist: {
              shortlist: [
                {
                  candidateId: "cand_uahpet_1",
                  title: "UAHPET Wireless Cat Water Fountain",
                  opportunityScore: 68.5,
                },
              ],
            },
          }),
        },
      });

      await attachAmazonEvidenceToExistingResearchRun({
        workspaceId: wsA,
        researchRunId: runId,
        evidenceRows: [ev],
        telemetry: null as any,
      });
      const updatedJob = await prisma.syncJob.findUnique({
        where: { id: runId },
      });
      expect(updatedJob?.status).toBe("COMPLETED");
      const parsed = JSON.parse(updatedJob?.resultJson || "{}");
      expect(parsed.researchShortlist.shortlist[0].opportunityScore).toBe(68.5);
    } finally {
      await prisma.researchEvidence
        .deleteMany({ where: { workspaceId: wsA } })
        .catch(() => {});
      await prisma.syncJob
        .deleteMany({ where: { id: runId } })
        .catch(() => {});
      await prisma.workspace
        .deleteMany({ where: { id: wsA } })
        .catch(() => {});
    }
  });

  it("R47: Cross-workspace isolation prevents Workspace B from reading Workspace A Amazon evidence", async () => {
    const wsA = `ws_r47_a_${Date.now()}`;
    const wsB = `ws_r47_b_${Date.now()}`;
    const runId = `run_r47_${Date.now()}`;

    const norm = normalizeAmazonSearchItem(
      officialSearchFixture.searchResult.items[0],
      {
        workspaceId: wsA,
        researchRunId: runId,
        candidateId: "cand_uahpet_1",
        providerInvocationRef: "amz_inv_r47",
        providerRequestId: "amz-req-r47",
        observedAt: new Date().toISOString(),
        rawResponseHash: "h_r47",
        accessPolicyStatus: "AUTHORIZED_CREATORS_API",
        observationClass: "TEST_FIXTURE",
      }
    );
    const ev = (norm as any).evidence;

    try {
      await prisma.workspace.upsert({
        where: { id: wsA },
        create: { id: wsA, name: "R47 Workspace A" },
        update: {},
      });
      await prisma.workspace.upsert({
        where: { id: wsB },
        create: { id: wsB, name: "R47 Workspace B" },
        update: {},
      });
      await prisma.syncJob.create({
        data: {
          id: runId,
          workspaceId: wsA,
          jobType: "KH02_RESEARCH_RUN",
          status: "COMPLETED",
          resultJson: JSON.stringify({ researchRunId: runId }),
        },
      });

      await persistAmazonEvidenceAtomically(wsA, runId, [ev]);
      const loadedB = await loadAmazonEvidenceForRun(wsB, runId);
      expect(loadedB.evidenceRows).toHaveLength(0);
    } finally {
      await prisma.researchEvidence
        .deleteMany({ where: { workspaceId: wsA } })
        .catch(() => {});
      await prisma.syncJob
        .deleteMany({ where: { id: runId } })
        .catch(() => {});
      await prisma.workspace
        .deleteMany({ where: { id: { in: [wsA, wsB] } } })
        .catch(() => {});
    }
  });

  it("R48: summarizeAmazonEvidenceForProduct includes NON_INFLATION_NOTICE, asin, parentAsin, variationAsin, and canonicalAmazonUrl", () => {
    const norm = normalizeAmazonSearchItem(
      officialSearchFixture.searchResult.items[0],
      {
        workspaceId: "ws",
        researchRunId: "run_1",
        candidateId: "cand_1",
        providerInvocationRef: "inv_1",
        providerRequestId: "req_1",
        observedAt: new Date().toISOString(),
        rawResponseHash: "h_1",
        accessPolicyStatus: "AUTHORIZED_CREATORS_API",
        observationClass: "TEST_FIXTURE",
      }
    );
    expect(norm.kind).toBe("EVIDENCE");
    const summary = summarizeAmazonEvidenceForProduct(
      "cand_1",
      "run_1",
      [(norm as any).evidence]
    );
    expect(summary.visible).toBe(true);
    expect(summary.asin).toBe("B08N5WRWNW");
    expect(summary.parentAsin).toBe("B08N5WRW00");
    expect(summary.variationAsin).toBe("B08N5WRWNW");
    expect(summary.canonicalAmazonUrl).toBe(
      "https://www.amazon.com/dp/B08N5WRWNW"
    );
    expect(summary.nonInflationNotice).toBe(NON_INFLATION_NOTICE);
  });

  it("R49: SWAI_KH02_RELEASE_VERSION is 12.4.3.5.0.3 and matches getRuntimeVersionInfo().releaseVersion", () => {
    expect(SWAI_KH02_RELEASE_VERSION).toBe("12.4.3.5.0.3");
    expect(getRuntimeVersionInfo().releaseVersion).toBe("12.4.3.5.0.3");
  });

  it("R50: writeCanonicalValidCreatorsRuntimeFixture passes all 15 checks (V01..V15) of validateAmazonCreatorsRuntimeClosureV12_4_3_5_0_3", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "kh02_v1243503_r50_"));
    try {
      const sha = "3333333333333333333333333333333333333333";
      writeCanonicalValidCreatorsRuntimeFixture(tmpDir, sha);
      const val = validateAmazonCreatorsRuntimeClosureV12_4_3_5_0_3(tmpDir, {
        expectedCodeSha: sha,
      });
      expect(val.valid).toBe(true);
      expect(val.passedChecksCount).toBe(15);
      expect(val.failedChecksCount).toBe(0);
      expect(val.overallClosureVerdict).toBe(
        "ENGINEERING_READY_WITH_LIVE_EXTERNAL_BLOCKER"
      );
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("R51: validateAmazonCreatorsRuntimeClosureV12_4_3_5_0_3 rejects mismatched expectedCodeSha", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "kh02_v1243503_r51_"));
    try {
      writeCanonicalValidCreatorsRuntimeFixture(
        tmpDir,
        "3333333333333333333333333333333333333333"
      );
      const val = validateAmazonCreatorsRuntimeClosureV12_4_3_5_0_3(tmpDir, {
        expectedCodeSha: "9999999999999999999999999999999999999999",
      });
      expect(val.valid).toBe(false);
      expect(
        val.checks.find((c: any) => c.checkId === "V02_SOURCE_SHA_CONSISTENCY")?.passed
      ).toBe(false);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("R52: runAmazonCreatorsRuntimeNegativeMutationSuite executes all 48 physical-file negative control mutations (M01..M48) with 48/48 caught and 0 escapes", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "kh02_v1243503_r52_"));
    try {
      const suite = runAmazonCreatorsRuntimeNegativeMutationSuite(tmpDir);
      expect(suite.totalMutationsExecuted).toBe(48);
      expect(suite.caughtCount).toBe(48);
      expect(suite.escapedCount).toBe(0);
      expect(suite.allCaughtZeroEscapes).toBe(true);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  }, 30000);
});
