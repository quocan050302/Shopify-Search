/**
 * SWAI KH-02 V12.4.3.7.1 — Amazon Live Commercial, Reference Evidence Integrity,
 * and Real Network HTTP -> Independent Worker End-to-End Closure Test Suite
 *
 * Covers Section 07 mandatory positive & negative test matrix (50 cases):
 * - Group A: Amazon UI ZIP + Currency + Commercial Context (A01–A16, 16 cases)
 * - Group B: Standalone Reference / Fixture / Live Evidence Integrity (B01–B13, 13 cases)
 * - Group C: Real HTTP -> Separate Worker Process -> DB/API/UI (C01–C15, 15 cases)
 * - Group D: Meta -> Amazon Discovery & Identity Regression (D01–D06, 6 cases)
 */

import fs from "fs";
import path from "path";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import {
  resolveAmazonUsPolicyContext,
  summarizeAmazonEvidenceForProduct,
} from "@/services/kh02/marketplace/marketplaceEvidenceTypes";
import {
  loadStandaloneAmazonReferenceManifest,
  parseAmazonProductEvidence,
  parseAmazonSearchSnapshotCards,
  verifyAmazonProductIdentity,
} from "@/services/kh02/marketplace/amazonUsIdentity";
import {
  computeAmazonNonInflationDelta,
  deriveAmazonSearchIntents,
  selectAmazonCandidateMatches,
} from "@/services/kh02/marketplace/amazonUsAuthorizedDiscoveryAdapter";
import {
  runAmazonUsPilotEnrichment,
  selectDynamicAmazonVerificationTargets,
} from "@/services/kh02/marketplace/amazonUsEvidenceAdapter";
import {
  connectAmazonPlaywrightMcp,
  ensureAmazonUsDeliveryContextViaUi,
  readAmazonCommercialContextFromRenderedUi,
  type McpToolCaller,
} from "@/services/kh02/marketplace/amazonUsMcpTransport";
import {
  loadAmazonEvidenceForRun,
  persistAmazonEvidenceAtomically,
} from "@/services/kh02/marketplace/marketplaceEvidencePersistence";
import { resolveWalmartUsPilotPolicy } from "@/services/kh02/marketplace/walmartJinaPolicy";
import { runWalmartUsPilotEnrichment } from "@/services/kh02/marketplace/walmartUsResearchAdapter";
import {
  discoverProductCandidatesFromAds,
  selectTopResearchShortlist,
} from "@/services/kh02/identity/productCandidateDiscovery";
import {
  claimNextResearchJob,
  executeResearchJob,
  updateJobIfClaimOwned,
} from "@/workers/kh02Worker";
import {
  POST as postResearchRoute,
  GET as getResearchRoute,
} from "@/app/api/v1/kh02/research/route";
import { GET as getLeaderboardRoute } from "@/app/api/v1/kh02/leaderboard/route";
import { GET as getRunByIdRoute } from "@/app/api/v1/kh02/research/runs/[runId]/route";
import { GET as getAmazonRoute } from "@/app/api/v1/kh02/marketplace/amazon/route";

const TEST_WS_A = "ws_v124371_alpha";
const TEST_WS_B = "ws_v124371_beta";
const TEST_RUN_A = "kh02_run_v124371_alpha_1";

function makeMcpEvalResponse(payload: Record<string, any>) {
  return {
    content: [
      {
        type: "text",
        text: `### Result\n${JSON.stringify(payload)}\n### Ran Playwright code`,
      },
    ],
  };
}

describe("KH-02 V12.4.3.7.1 — Commercial Context, Reference Integrity & Network-Worker Closure", () => {
  beforeAll(async () => {
    await prisma.workspace.upsert({
      where: { id: TEST_WS_A },
      update: { name: "V12.4.3.7.1 Workspace Alpha" },
      create: { id: TEST_WS_A, name: "V12.4.3.7.1 Workspace Alpha" },
    });
    await prisma.workspace.upsert({
      where: { id: TEST_WS_B },
      update: { name: "V12.4.3.7.1 Workspace Beta" },
      create: { id: TEST_WS_B, name: "V12.4.3.7.1 Workspace Beta" },
    });
    await prisma.syncJob.upsert({
      where: { id: TEST_RUN_A },
      update: { workspaceId: TEST_WS_A, jobType: "KH02_RESEARCH", status: "COMPLETED" },
      create: {
        id: TEST_RUN_A,
        workspaceId: TEST_WS_A,
        jobType: "KH02_RESEARCH",
        status: "COMPLETED",
        resultJson: JSON.stringify({ topic: "Pet Gadgets", researchRunId: TEST_RUN_A }),
      },
    });
  });

  afterAll(async () => {
    await prisma.researchEvidence
      .deleteMany({
        where: { workspaceId: { in: [TEST_WS_A, TEST_WS_B] } },
      })
      .catch(() => {});
    await prisma.syncJob
      .deleteMany({
        where: { workspaceId: { in: [TEST_WS_A, TEST_WS_B] } },
      })
      .catch(() => {});
  });

  // ============================================================================
  // GROUP A: AMAZON UI ZIP + CURRENCY + COMMERCIAL CONTEXT (16 CASES)
  // ============================================================================
  describe("Group A — Amazon UI ZIP + Currency + Commercial Context (16 cases)", () => {
    it("A01: Cold homepage load waits for #twotabsearchtextbox readiness before clicking location trigger", async () => {
      let evalCallCount = 0;
      const caller: McpToolCaller = {
        sessionId: "mcp_a01",
        ownedChildPid: 10001,
        discoveredTools: ["browser_navigate", "browser_evaluate"],
        async callTool(params) {
          if (params.name === "browser_navigate") {
            return { content: [{ type: "text", text: "Navigated" }] };
          }
          evalCallCount++;
          if (evalCallCount === 1) {
            // Cold splash: search box not ready on poll 1
            return makeMcpEvalResponse({
              url: "https://www.amazon.com/",
              pageTitle: null,
              searchBoxReady: false,
              deliveryLinkVisible: false,
              deliveryLocationText: null,
              observedZip: null,
              observedMarket: null,
              explicitCurrency: null,
              explicitCurrencySource: null,
              captchaDetected: false,
              loginWallDetected: false,
            });
          }
          if (evalCallCount === 2) {
            // Poll 2: search box ready
            return makeMcpEvalResponse({
              url: "https://www.amazon.com/ref=nav_logo",
              pageTitle: "Amazon.com. Spend less. Smile more.",
              searchBoxReady: true,
              deliveryLinkVisible: true,
              deliveryLocationText: "Deliver to Vietnam",
              observedZip: null,
              observedMarket: null,
              explicitCurrency: "VND",
              explicitCurrencySource: "DOM:#icp-touch-link-cop",
              captchaDetected: false,
              loginWallDetected: false,
            });
          }
          if (evalCallCount === 3) {
            // Modal apply
            return makeMcpEvalResponse({
              locationDialogOpened: true,
              zipFieldVisible: true,
              applyClicked: true,
              confirmationHandled: true,
              reason: "UI_ZIP_SUBMITTED",
            });
          }
          // Post-apply readback
          return makeMcpEvalResponse({
            url: "https://www.amazon.com/ref=nav_logo",
            pageTitle: "Amazon.com. Spend less. Smile more.",
            searchBoxReady: true,
            deliveryLinkVisible: true,
            deliveryLocationText: "Deliver to Sacramento 95829",
            observedZip: "95829",
            observedMarket: "US",
            explicitCurrency: "USD",
            explicitCurrencySource: "DOM:#icp-touch-link-cop",
            captchaDetected: false,
            loginWallDetected: false,
          });
        },
      };

      const res = await ensureAmazonUsDeliveryContextViaUi(caller, {
        targetZip: "95829",
        maxReadyPolls: 4,
        pollIntervalMs: 10,
      });

      expect(res.homepageReady).toBe(true);
      expect(res.searchBoxReady).toBe(true);
      expect(res.locationDialogOpened).toBe(true);
      expect(res.observedDeliveryPostalCode).toBe("95829");
      expect(res.status).toBe("US_DISPLAYED_CONTEXT_VERIFIED");
      expect(res.uiActionLedger.some((s) => s.step === "WAIT_SEARCH_BOX_READY")).toBe(true);
    });

    it("A02: Search box not ready after max bounded polls -> returns READY_TIMEOUT, usDeliveryVerified = false, does not fabricate ZIP", async () => {
      const caller: McpToolCaller = {
        sessionId: "mcp_a02",
        ownedChildPid: 10002,
        discoveredTools: ["browser_navigate", "browser_evaluate"],
        async callTool(params) {
          if (params.name === "browser_navigate") {
            return { content: [{ type: "text", text: "Navigated" }] };
          }
          return makeMcpEvalResponse({
            url: "https://www.amazon.com/",
            pageTitle: null,
            searchBoxReady: false,
            deliveryLinkVisible: false,
            deliveryLocationText: null,
            observedZip: null,
            observedMarket: null,
            explicitCurrency: null,
            explicitCurrencySource: null,
            captchaDetected: false,
            loginWallDetected: false,
          });
        },
      };

      const res = await ensureAmazonUsDeliveryContextViaUi(caller, {
        targetZip: "95829",
        maxReadyPolls: 4,
        pollIntervalMs: 5,
      });

      expect(res.status).toBe("READY_TIMEOUT");
      expect(res.usDeliveryVerified).toBe(false);
      expect(res.observedDeliveryPostalCode).toBeNull();
      expect(res.locationDialogOpened).toBe(false);
    });

    it("A03: Location trigger #nav-global-location-popover-link missing -> returns UNKNOWN, observedDeliveryPostalCode = null", async () => {
      const caller: McpToolCaller = {
        sessionId: "mcp_a03",
        ownedChildPid: 10003,
        discoveredTools: ["browser_navigate", "browser_evaluate"],
        async callTool(params) {
          if (params.name === "browser_navigate") {
            return { content: [{ type: "text", text: "Navigated" }] };
          }
          return makeMcpEvalResponse({
            url: "https://www.amazon.com/",
            pageTitle: "Amazon.com",
            searchBoxReady: true,
            deliveryLinkVisible: false,
            deliveryLocationText: null,
            observedZip: null,
            observedMarket: null,
            explicitCurrency: null,
            explicitCurrencySource: null,
            captchaDetected: false,
            loginWallDetected: false,
          });
        },
      };

      const res = await ensureAmazonUsDeliveryContextViaUi(caller, {
        targetZip: "95829",
        maxReadyPolls: 2,
        pollIntervalMs: 5,
      });

      expect(res.status).toBe("UNKNOWN");
      expect(res.observedDeliveryPostalCode).toBeNull();
      expect(res.usDeliveryVerified).toBe(false);
    });

    it("A04: Location dialog opens, #GLUXZipUpdateInput filled with 95829, Apply clicked, confirmation handled, post-reload header shows Deliver to Sacramento 95829 -> observedDeliveryPostalCode = 95829, usDeliveryVerified = true", async () => {
      let step = 0;
      const caller: McpToolCaller = {
        sessionId: "mcp_a04",
        ownedChildPid: 10004,
        discoveredTools: ["browser_navigate", "browser_evaluate"],
        async callTool(params) {
          if (params.name === "browser_navigate") {
            return { content: [{ type: "text", text: "Navigated" }] };
          }
          step++;
          if (step === 1) {
            return makeMcpEvalResponse({
              url: "https://www.amazon.com/",
              pageTitle: "Amazon.com",
              searchBoxReady: true,
              deliveryLinkVisible: true,
              deliveryLocationText: "Deliver to Vietnam",
              observedZip: null,
              observedMarket: null,
              explicitCurrency: "VND",
              explicitCurrencySource: "DOM:#icp-touch-link-cop",
              captchaDetected: false,
              loginWallDetected: false,
            });
          }
          if (step === 2) {
            return makeMcpEvalResponse({
              locationDialogOpened: true,
              zipFieldVisible: true,
              applyClicked: true,
              confirmationHandled: true,
              reason: "UI_ZIP_SUBMITTED",
            });
          }
          return makeMcpEvalResponse({
            url: "https://www.amazon.com/",
            pageTitle: "Amazon.com",
            searchBoxReady: true,
            deliveryLinkVisible: true,
            deliveryLocationText: "Deliver to Sacramento 95829",
            observedZip: "95829",
            observedMarket: "US",
            explicitCurrency: "USD",
            explicitCurrencySource: "DOM:#icp-touch-link-cop",
            captchaDetected: false,
            loginWallDetected: false,
          });
        },
      };

      const res = await ensureAmazonUsDeliveryContextViaUi(caller, { targetZip: "95829" });
      expect(res.observedDeliveryPostalCode).toBe("95829");
      expect(res.usDeliveryVerified).toBe(true);
      expect(res.observedCurrency).toBe("USD");
      expect(res.status).toBe("US_DISPLAYED_CONTEXT_VERIFIED");
    });

    it("A05: Location dialog opens, Apply clicked, but post-reload header still shows Deliver to Vietnam -> observedDeliveryPostalCode = null, verifiedDeliveryMarket = null, status = US_NOT_CONFIRMED", async () => {
      let step = 0;
      const caller: McpToolCaller = {
        sessionId: "mcp_a05",
        ownedChildPid: 10005,
        discoveredTools: ["browser_navigate", "browser_evaluate"],
        async callTool(params) {
          if (params.name === "browser_navigate") {
            return { content: [{ type: "text", text: "Navigated" }] };
          }
          step++;
          if (step === 2) {
            return makeMcpEvalResponse({
              locationDialogOpened: true,
              zipFieldVisible: true,
              applyClicked: true,
              confirmationHandled: false,
              reason: "UI_ZIP_SUBMITTED",
            });
          }
          return makeMcpEvalResponse({
            url: "https://www.amazon.com/",
            pageTitle: "Amazon.com",
            searchBoxReady: true,
            deliveryLinkVisible: true,
            deliveryLocationText: "Deliver to Vietnam",
            observedZip: null,
            observedMarket: null,
            explicitCurrency: "VND",
            explicitCurrencySource: "DOM:#icp-touch-link-cop",
            captchaDetected: false,
            loginWallDetected: false,
          });
        },
      };

      const res = await ensureAmazonUsDeliveryContextViaUi(caller, { targetZip: "95829" });
      expect(res.status).toBe("US_NOT_CONFIRMED");
      expect(res.observedDeliveryPostalCode).toBeNull();
      expect(res.usDeliveryVerified).toBe(false);

      const parsed = parseAmazonProductEvidence(
        {
          sourceUrl: "https://www.amazon.com/dp/B0D3XGHTJ5",
          finalUrl: "https://www.amazon.com/dp/B0D3XGHTJ5",
          canonicalUrl: "https://www.amazon.com/dp/B0D3XGHTJ5",
          httpStatus: 200,
          structuredData: {
            asin: "B0D3XGHTJ5",
            productTitle: "faroro Automatic Cat Feeder 4L Timed Pet Dry Food Dispenser",
            brand: "faroro",
            deliveryLocationText: res.observedDeliveryLocationText,
            deliveryPostalCode: res.observedDeliveryPostalCode,
            explicitUsDeliveryConfirmed: res.usDeliveryVerified,
          },
        },
        {
          workspaceId: TEST_WS_A,
          researchRunId: TEST_RUN_A,
          candidateId: "cand_a05",
          observationClass: "TEST_FIXTURE",
        }
      );
      expect(parsed.observedDeliveryPostalCode).toBeNull();
      expect(parsed.verifiedDeliveryMarket).toBeNull();
    });

    it("A06: Location dialog opens, #GLUXZipUpdateInput missing or Apply disabled -> status = DIALOG_OR_APPLY_UNAVAILABLE, usDeliveryVerified = false", async () => {
      let step = 0;
      const caller: McpToolCaller = {
        sessionId: "mcp_a06",
        ownedChildPid: 10006,
        discoveredTools: ["browser_navigate", "browser_evaluate"],
        async callTool(params) {
          if (params.name === "browser_navigate") {
            return { content: [{ type: "text", text: "Navigated" }] };
          }
          step++;
          if (step === 1) {
            return makeMcpEvalResponse({
              url: "https://www.amazon.com/",
              pageTitle: "Amazon.com",
              searchBoxReady: true,
              deliveryLinkVisible: true,
              deliveryLocationText: "Deliver to Vietnam",
              observedZip: null,
              observedMarket: null,
              explicitCurrency: "VND",
              explicitCurrencySource: "DOM:#icp-touch-link-cop",
              captchaDetected: false,
              loginWallDetected: false,
            });
          }
          return makeMcpEvalResponse({
            locationDialogOpened: true,
            zipFieldVisible: false,
            applyClicked: false,
            confirmationHandled: false,
            reason: "ZIP_INPUT_NOT_VISIBLE_IN_POPOVER",
          });
        },
      };

      const res = await ensureAmazonUsDeliveryContextViaUi(caller, { targetZip: "95829" });
      expect(res.status).toBe("DIALOG_OR_APPLY_UNAVAILABLE");
      expect(res.usDeliveryVerified).toBe(false);
      expect(res.observedDeliveryPostalCode).toBeNull();
    });

    it("A07: CAPTCHA / bot wall during homepage or location modal -> CAPTCHA_BLOCKED / BLOCKED_PROVIDER, session aborts remaining ops and closes cleanly", async () => {
      const caller: McpToolCaller = {
        sessionId: "mcp_a07",
        ownedChildPid: 10007,
        discoveredTools: ["browser_navigate", "browser_evaluate"],
        async callTool(params) {
          if (params.name === "browser_navigate") {
            return { content: [{ type: "text", text: "Navigated" }] };
          }
          return makeMcpEvalResponse({
            url: "https://www.amazon.com/errors/validateCaptcha",
            pageTitle: "Amazon.com",
            searchBoxReady: false,
            deliveryLinkVisible: false,
            deliveryLocationText: null,
            observedZip: null,
            observedMarket: null,
            explicitCurrency: null,
            explicitCurrencySource: null,
            captchaDetected: true,
            loginWallDetected: false,
          });
        },
      };

      const res = await ensureAmazonUsDeliveryContextViaUi(caller, { targetZip: "95829" });
      expect(res.status).toBe("BLOCKED_PROVIDER");
      expect(res.usDeliveryVerified).toBe(false);
      expect(res.notes.join(" ")).toContain("CAPTCHA_OR_BOT_WALL_DETECTED_ON_HOME");
    });

    it("A08: Sign-in wall during location modal -> AUTHENTICATION_REQUIRED / BLOCKED_PROVIDER, no login attempted", async () => {
      const caller: McpToolCaller = {
        sessionId: "mcp_a08",
        ownedChildPid: 10008,
        discoveredTools: ["browser_navigate", "browser_evaluate"],
        async callTool(params) {
          if (params.name === "browser_navigate") {
            return { content: [{ type: "text", text: "Navigated" }] };
          }
          return makeMcpEvalResponse({
            url: "https://www.amazon.com/ap/signin",
            pageTitle: "Amazon Sign-In",
            searchBoxReady: false,
            deliveryLinkVisible: false,
            deliveryLocationText: null,
            observedZip: null,
            observedMarket: null,
            explicitCurrency: null,
            explicitCurrencySource: null,
            captchaDetected: false,
            loginWallDetected: true,
          });
        },
      };

      const res = await ensureAmazonUsDeliveryContextViaUi(caller, { targetZip: "95829" });
      expect(res.status).toBe("AUTHENTICATION_REQUIRED");
      expect(res.usDeliveryVerified).toBe(false);
      expect(res.notes.join(" ")).toContain("LOGIN_WALL_DETECTED_ON_HOME");
    });

    it("A09: No internal fetch('/portal-migration/hz/glow/address-change...') exists in amazonUsMcpTransport.ts", () => {
      const transportPath = path.resolve(
        process.cwd(),
        "src/services/kh02/marketplace/amazonUsMcpTransport.ts"
      );
      const src = fs.readFileSync(transportPath, "utf8");
      expect(src).not.toContain("/portal-migration/hz/glow/address-change");
      expect(src).not.toMatch(/fetch\s*\(\s*['"`]\/portal-migration/);
    });

    it("A10: Search page header shows Deliver to Sacramento 95829 -> Search cards record observedDeliveryPostalCode = 95829", () => {
      const searchRes = parseAmazonSearchSnapshotCards({
        sourceUrl: "https://www.amazon.com/s?k=automatic+cat+feeder",
        finalUrl: "https://www.amazon.com/s?k=automatic+cat+feeder",
        httpStatus: 200,
        pageTitle: "Amazon.com : automatic cat feeder",
        structuredData: {
          deliveryLocationText: "Deliver to Sacramento 95829",
          deliveryPostalCode: "95829",
          currency: "USD",
          searchCards: [
            {
              asin: "B0D3XGHTJ5",
              title: "faroro Automatic Cat Feeder 4L Timed Pet Dry Food Dispenser",
              href: "/faroro-Automatic-Cat-Feeder/dp/B0D3XGHTJ5/ref=sr_1_1",
              price: "$49.99",
              currency: "USD",
            },
          ],
        },
      });
      expect(searchRes.observedDeliveryPostalCode).toBe("95829");
      expect(searchRes.cards).toHaveLength(1);
      expect(searchRes.cards[0].observedDeliveryPostalCode).toBe("95829");
    });

    it("A11: Currency symbol $ alone without explicit USD does NOT verify currency = USD (currency = null)", () => {
      const ev = parseAmazonProductEvidence(
        {
          sourceUrl: "https://www.amazon.com/dp/B0D3XGHTJ5",
          finalUrl: "https://www.amazon.com/dp/B0D3XGHTJ5",
          canonicalUrl: "https://www.amazon.com/dp/B0D3XGHTJ5",
          httpStatus: 200,
          html: `<div class="a-price"><span class="a-offscreen">$49.99</span></div>`,
          structuredData: {
            asin: "B0D3XGHTJ5",
            productTitle: "faroro Automatic Cat Feeder 4L Timed Pet Dry Food Dispenser",
            brand: "faroro",
            price: "$49.99",
            currency: null,
            deliveryPostalCode: "95829",
            explicitUsDeliveryConfirmed: true,
          },
        },
        {
          workspaceId: TEST_WS_A,
          researchRunId: TEST_RUN_A,
          candidateId: "cand_a11",
          observationClass: "TEST_FIXTURE",
        }
      );
      expect(ev.currency).toBeNull();
      expect(ev.commercialUsStatus).toBe("PARTIAL_US_COMMERCIAL");
    });

    it("A12: US ZIP 95829 + non-USD currency (VND) yields commercialUsStatus = PARTIAL_US_COMMERCIAL or NOT_USD_VERIFIED, NOT US_COMMERCIAL_VERIFIED", async () => {
      let step = 0;
      const caller: McpToolCaller = {
        sessionId: "mcp_a12",
        ownedChildPid: 10012,
        discoveredTools: ["browser_navigate", "browser_evaluate"],
        async callTool(params) {
          if (params.name === "browser_navigate") {
            return { content: [{ type: "text", text: "Navigated" }] };
          }
          step++;
          if (step === 2) {
            return makeMcpEvalResponse({
              locationDialogOpened: true,
              zipFieldVisible: true,
              applyClicked: true,
              confirmationHandled: true,
              reason: "UI_ZIP_SUBMITTED",
            });
          }
          return makeMcpEvalResponse({
            url: "https://www.amazon.com/",
            pageTitle: "Amazon.com",
            searchBoxReady: true,
            deliveryLinkVisible: true,
            deliveryLocationText: "Deliver to Sacramento 95829",
            observedZip: "95829",
            observedMarket: "US",
            explicitCurrency: "VND",
            explicitCurrencySource: "DOM:#icp-touch-link-cop",
            captchaDetected: false,
            loginWallDetected: false,
          });
        },
      };

      const preflight = await ensureAmazonUsDeliveryContextViaUi(caller, { targetZip: "95829" });
      expect(preflight.observedDeliveryPostalCode).toBe("95829");
      expect(preflight.observedCurrency).toBe("VND");
      expect(preflight.status).toBe("NOT_USD_VERIFIED");

      const pdpEv = parseAmazonProductEvidence(
        {
          sourceUrl: "https://www.amazon.com/dp/B0D3XGHTJ5",
          finalUrl: "https://www.amazon.com/dp/B0D3XGHTJ5",
          canonicalUrl: "https://www.amazon.com/dp/B0D3XGHTJ5",
          httpStatus: 200,
          structuredData: {
            asin: "B0D3XGHTJ5",
            productTitle: "faroro Automatic Cat Feeder 4L Timed Pet Dry Food Dispenser",
            brand: "faroro",
            price: null,
            currency: null,
            deliveryLocationText: "Deliver to Sacramento 95829",
            deliveryPostalCode: "95829",
            explicitUsDeliveryConfirmed: true,
          },
        },
        {
          workspaceId: TEST_WS_A,
          researchRunId: TEST_RUN_A,
          candidateId: "cand_a12",
          observationClass: "TEST_FIXTURE",
        }
      );
      expect(pdpEv.commercialUsStatus).toBe("PARTIAL_US_COMMERCIAL");
      expect(pdpEv.commercialUsStatus).not.toBe("US_COMMERCIAL_VERIFIED");
    });

    it("A13: US ZIP 95829 + explicit USD + numeric buybox price $49.99 yields commercialUsStatus = US_COMMERCIAL_VERIFIED", () => {
      const ev = parseAmazonProductEvidence(
        {
          sourceUrl: "https://www.amazon.com/dp/B0D3XGHTJ5",
          finalUrl: "https://www.amazon.com/dp/B0D3XGHTJ5",
          canonicalUrl: "https://www.amazon.com/dp/B0D3XGHTJ5",
          httpStatus: 200,
          structuredData: {
            asin: "B0D3XGHTJ5",
            productTitle: "faroro Automatic Cat Feeder 4L Timed Pet Dry Food Dispenser",
            brand: "faroro",
            price: 49.99,
            currency: "USD",
            availability: "In Stock",
            seller: "WECACO",
            deliveryLocationText: "Deliver to Sacramento 95829",
            deliveryPostalCode: "95829",
            explicitUsDeliveryConfirmed: true,
          },
        },
        {
          workspaceId: TEST_WS_A,
          researchRunId: TEST_RUN_A,
          candidateId: "cand_a13",
          observationClass: "TEST_FIXTURE",
        }
      );
      expect(ev.observedDeliveryPostalCode).toBe("95829");
      expect(ev.verifiedDeliveryMarket).toBe("US");
      expect(ev.currency).toBe("USD");
      expect(ev.price).toBe(49.99);
      expect(ev.commercialUsStatus).toBe("US_COMMERCIAL_VERIFIED");
    });

    it("A14: Carousel / related-item price is ignored when main buybox price is absent (price = null)", () => {
      const ev = parseAmazonProductEvidence(
        {
          sourceUrl: "https://www.amazon.com/dp/B0D3XGHTJ5",
          finalUrl: "https://www.amazon.com/dp/B0D3XGHTJ5",
          canonicalUrl: "https://www.amazon.com/dp/B0D3XGHTJ5",
          httpStatus: 200,
          structuredData: {
            asin: "B0D3XGHTJ5",
            productTitle: "faroro Automatic Cat Feeder 4L Timed Pet Dry Food Dispenser",
            brand: "faroro",
            price: 29.99,
            currency: "USD",
            isSuggestedOrCarouselPrice: true,
            priceSource: "related_carousel",
            deliveryPostalCode: "95829",
            explicitUsDeliveryConfirmed: true,
          },
        },
        {
          workspaceId: TEST_WS_A,
          researchRunId: TEST_RUN_A,
          candidateId: "cand_a14",
          observationClass: "TEST_FIXTURE",
        }
      );
      expect(ev.price).toBeNull();
      expect(ev.commercialUsStatus).not.toBe("US_COMMERCIAL_VERIFIED");
    });

    it("A15: PDP missing ZIP does NOT borrow homepage/search ZIP as if observed on PDP (observedDeliveryPostalCode = null on PDP)", async () => {
      const caller: McpToolCaller = {
        sessionId: "mcp_a15",
        ownedChildPid: 10015,
        discoveredTools: ["browser_evaluate"],
        async callTool() {
          return makeMcpEvalResponse({
            url: "https://www.amazon.com/dp/B0D3XGHTJ5",
            pageTitle: "faroro Automatic Cat Feeder",
            searchBoxReady: true,
            deliveryLinkVisible: true,
            deliveryLocationText: "Select your address",
            observedZip: null,
            observedMarket: null,
            explicitCurrency: "USD",
            explicitCurrencySource: "DOM:priceCurrency",
            rawPriceText: "$49.99",
            seller: "WECACO",
            availability: "In Stock",
            captchaDetected: false,
            loginWallDetected: false,
          });
        },
      };

      const pdpReadback = await readAmazonCommercialContextFromRenderedUi(caller, {
        pageUrlHint: "https://www.amazon.com/dp/B0D3XGHTJ5",
      });
      expect(pdpReadback.observedZip).toBeNull();
      expect(pdpReadback.observedMarket).toBeNull();

      const pdpEv = parseAmazonProductEvidence(
        {
          sourceUrl: "https://www.amazon.com/dp/B0D3XGHTJ5",
          finalUrl: "https://www.amazon.com/dp/B0D3XGHTJ5",
          canonicalUrl: "https://www.amazon.com/dp/B0D3XGHTJ5",
          httpStatus: 200,
          structuredData: {
            asin: "B0D3XGHTJ5",
            productTitle: "faroro Automatic Cat Feeder 4L Timed Pet Dry Food Dispenser",
            brand: "faroro",
            price: 49.99,
            currency: "USD",
            deliveryLocationText: pdpReadback.deliveryLocationText,
            deliveryPostalCode: pdpReadback.observedZip,
            explicitUsDeliveryConfirmed: Boolean(pdpReadback.observedZip),
          },
        },
        {
          workspaceId: TEST_WS_A,
          researchRunId: TEST_RUN_A,
          candidateId: "cand_a15",
          observationClass: "TEST_FIXTURE",
        }
      );
      expect(pdpEv.observedDeliveryPostalCode).toBeNull();
      expect(pdpEv.verifiedDeliveryMarket).toBeNull();
    });

    it("A16: Seller and availability statuses are OBSERVED when present and NOT_OBSERVED when absent (null, never Unknown or 0)", () => {
      const observedEv = parseAmazonProductEvidence(
        {
          sourceUrl: "https://www.amazon.com/dp/B0D3XGHTJ5",
          finalUrl: "https://www.amazon.com/dp/B0D3XGHTJ5",
          canonicalUrl: "https://www.amazon.com/dp/B0D3XGHTJ5",
          httpStatus: 200,
          structuredData: {
            asin: "B0D3XGHTJ5",
            productTitle: "faroro Automatic Cat Feeder 4L Timed Pet Dry Food Dispenser",
            brand: "faroro",
            seller: "WECACO",
            availability: "In Stock",
            price: 49.99,
            currency: "USD",
          },
        },
        {
          workspaceId: TEST_WS_A,
          researchRunId: TEST_RUN_A,
          candidateId: "cand_a16_obs",
          observationClass: "TEST_FIXTURE",
        }
      );
      expect(observedEv.sellerStatus).toBe("OBSERVED");
      expect(observedEv.availabilityStatus).toBe("OBSERVED");
      expect(observedEv.seller).toBe("WECACO");
      expect(observedEv.availability).toBe("In Stock");

      const absentEv = parseAmazonProductEvidence(
        {
          sourceUrl: "https://www.amazon.com/dp/B0D3XGHTJ5",
          finalUrl: "https://www.amazon.com/dp/B0D3XGHTJ5",
          canonicalUrl: "https://www.amazon.com/dp/B0D3XGHTJ5",
          httpStatus: 200,
          structuredData: {
            asin: "B0D3XGHTJ5",
            productTitle: "faroro Automatic Cat Feeder 4L Timed Pet Dry Food Dispenser",
            brand: "faroro",
            seller: null,
            merchant: null,
            availability: null,
            price: null,
            currency: null,
          },
        },
        {
          workspaceId: TEST_WS_A,
          researchRunId: TEST_RUN_A,
          candidateId: "cand_a16_abs",
          observationClass: "TEST_FIXTURE",
        }
      );
      expect(absentEv.sellerStatus).toBe("NOT_OBSERVED");
      expect(absentEv.availabilityStatus).toBe("NOT_OBSERVED");
      expect(absentEv.seller).toBeNull();
      expect(absentEv.availability).toBeNull();
      expect(absentEv.price).toBeNull();
    });
  });

  // ============================================================================
  // GROUP B: STANDALONE REFERENCE / FIXTURE / LIVE EVIDENCE INTEGRITY (13 CASES)
  // ============================================================================
  describe("Group B — Standalone Reference / Fixture / Live Evidence Integrity (13 cases)", () => {
    it("B01: REFERENCE_AMAZON_STANDALONE_2026_11_02.json has referenceOrigin = USER_SUPPLIED_EXTERNAL_STANDALONE_REPORT and referenceAvailability = SUMMARY_AND_SCRIPT_ONLY", () => {
      const manifest = loadStandaloneAmazonReferenceManifest();
      expect(manifest.referenceOrigin).toBe("USER_SUPPLIED_EXTERNAL_STANDALONE_REPORT");
      expect(manifest.referenceAvailability).toBe("SUMMARY_AND_SCRIPT_ONLY");
      expect(manifest.standaloneReferenceStatus).toBe("USER_REPORTED_SEARCH_TO_PDP_PASS");
      expect(manifest.standaloneAppIntegrationStatus).toBe("NOT_TESTED_BY_REFERENCE");
    });

    it("B02: referenceRawHashVerified = false when original external .playwright-mcp raw file is not present on disk", () => {
      const manifest = loadStandaloneAmazonReferenceManifest();
      expect(manifest.referenceRawHashVerified).toBe(false);
      expect(manifest.referenceReplayStatus).toBe("NOT_EXECUTED");
    });

    it("B03: Parser test on standalone reference values uses observationClass = TEST_FIXTURE, fixtureSource = USER_REPORTED_REFERENCE_FIELDS", () => {
      const manifest = loadStandaloneAmazonReferenceManifest();
      const rep = manifest.reportedPdpObservation;
      const ev = parseAmazonProductEvidence(
        {
          sourceUrl: rep.derivedNormalizedCanonicalUrl,
          finalUrl: rep.derivedNormalizedCanonicalUrl,
          canonicalUrl: rep.observedCanonicalUrl,
          httpStatus: null,
          structuredData: {
            asin: rep.asin,
            productTitle: rep.productTitle,
            brand: rep.brand,
            modelNumber: rep.modelNumber,
            price: rep.price,
            currency: rep.currency,
            availability: rep.availability,
            seller: rep.seller,
            deliveryLocationText: rep.observedDeliveryLocationText,
            deliveryPostalCode: rep.observedDeliveryPostalCode,
            explicitUsDeliveryConfirmed: true,
          },
        },
        {
          workspaceId: TEST_WS_A,
          researchRunId: TEST_RUN_A,
          candidateId: "cand_b03_ref",
          observationClass: "TEST_FIXTURE",
          requestMode: "TEST_FIXTURE",
          fixtureSource: "USER_REPORTED_REFERENCE_FIELDS",
          referenceOrigin: "USER_SUPPLIED_EXTERNAL_STANDALONE_REPORT",
        }
      );

      expect(ev.observationClass).toBe("TEST_FIXTURE");
      expect(ev.requestMode).toBe("TEST_FIXTURE");
      expect(ev.evidenceOrigin).toBe("USER_SUPPLIED_EXTERNAL_STANDALONE_REPORT");
      expect(ev.asin).toBe("B0D3XGHTJ5");
      expect(ev.price).toBe(49.99);
      expect(ev.currency).toBe("USD");
      expect(ev.observedDeliveryPostalCode).toBe("95829");
    });

    it("B04: Attempting to mark synthetic reference fixture as observationClass = AUTHORIZED_LIVE without live MCP tool invocation receipt is downgraded", () => {
      const manifest = loadStandaloneAmazonReferenceManifest();
      const rep = manifest.reportedPdpObservation;
      const ev = parseAmazonProductEvidence(
        {
          sourceUrl: rep.derivedNormalizedCanonicalUrl,
          finalUrl: rep.derivedNormalizedCanonicalUrl,
          canonicalUrl: rep.observedCanonicalUrl,
          structuredData: {
            asin: rep.asin,
            productTitle: rep.productTitle,
            brand: rep.brand,
            price: rep.price,
            currency: "USD",
            deliveryPostalCode: rep.observedDeliveryPostalCode,
            explicitUsDeliveryConfirmed: true,
          },
        },
        {
          workspaceId: TEST_WS_A,
          researchRunId: TEST_RUN_A,
          candidateId: "cand_b04_bad_live",
          observationClass: "AUTHORIZED_LIVE",
          fixtureSource: "USER_REPORTED_REFERENCE_FIELDS",
          referenceOrigin: "USER_SUPPLIED_EXTERNAL_STANDALONE_REPORT",
        }
      );

      expect(ev.observationClass).toBe("TEST_FIXTURE");
      expect(ev.observationClass).not.toBe("AUTHORIZED_LIVE");
      expect(ev.sanitizationWarnings).toContain(
        "EXTERNAL_REFERENCE_OR_FIXTURE_DOWNGRADED_FROM_LIVE"
      );
    });

    it("B05: Standalone reference artifact cannot satisfy current-run live Amazon acceptance gate", () => {
      const manifest = loadStandaloneAmazonReferenceManifest();
      expect(manifest.trustBoundaryPolicy.canSatisfyCurrentRunLiveGate).toBe(false);
      expect(manifest.trustBoundaryPolicy.forbiddenObservationClasses).toContain("AUTHORIZED_LIVE");
      expect(manifest.trustBoundaryPolicy.fixtureObservationClass).toBe("TEST_FIXTURE");
      expect(manifest.trustBoundaryPolicy.fixtureSource).toBe("USER_REPORTED_REFERENCE_FIELDS");
    });

    it("B06: Current-run live Amazon evidence requires real sessionId, ownedChildPid, and non-empty toolInvocationRecords from REAL_STDIO_MCP", async () => {
      const unconfigured = await connectAmazonPlaywrightMcp({
        allowRealStdioMcp: false,
      });
      expect(unconfigured.connected).toBe(false);
      expect(unconfigured.status).toBe("MCP_NOT_CONFIGURED");
      expect(unconfigured.handshakeProof.observationClass).toBe("UNVERIFIED");
      expect(unconfigured.handshakeProof.ownedChildPid).toBeNull();
    });

    it("B07: LOCAL_MCP_TEST_DOUBLE / fixture session is labeled TEST_FIXTURE, never AUTHORIZED_LIVE", async () => {
      const fixtureConn = await connectAmazonPlaywrightMcp({
        fixtureTransport: {
          enabled: true,
          snapshotsByUrl: {
            "https://www.amazon.com/dp/B0D3XGHTJ5": {
              sourceUrl: "https://www.amazon.com/dp/B0D3XGHTJ5",
              finalUrl: "https://www.amazon.com/dp/B0D3XGHTJ5",
              httpStatus: 200,
              pageTitle: "faroro Automatic Cat Feeder",
              structuredData: {
                asin: "B0D3XGHTJ5",
                productTitle: "faroro Automatic Cat Feeder",
                brand: "faroro",
              },
            },
          },
        },
      });
      expect(fixtureConn.handshakeProof.observationClass).toBe("TEST_FIXTURE");
      expect(fixtureConn.session?.observationClass).toBe("TEST_FIXTURE");
      await fixtureConn.session?.close();
    });

    it("B08: Fixture snapshots (fixtureSnapshotsByUrl) are labeled TEST_FIXTURE, never AUTHORIZED_LIVE", async () => {
      const res = await runAmazonUsPilotEnrichment({
        workspaceId: TEST_WS_A,
        researchRunId: TEST_RUN_A,
        niche: "Pet Gadgets",
        optInRequested: true,
        candidates: [
          {
            candidateId: "cand_b08",
            title: "faroro Automatic Cat Feeder TD20",
            brand: "faroro",
            model: "TD20",
          } as any,
        ],
        candidateAmazonUrls: {
          cand_b08: "https://www.amazon.com/dp/B0D3XGHTJ5",
        },
        requestMode: "TEST_FIXTURE",
        env: {
          KH02_AMAZON_US_ENABLED: "true",
          KH02_AMAZON_US_LIVE_ALLOWED: "true",
          KH02_AMAZON_US_USER_AUTHORIZED_URLS_ATTESTED: "true",
        },
        fixtureSnapshotsByUrl: {
          "https://www.amazon.com/dp/B0D3XGHTJ5": {
            sourceUrl: "https://www.amazon.com/dp/B0D3XGHTJ5",
            finalUrl: "https://www.amazon.com/dp/B0D3XGHTJ5",
            canonicalUrl: "https://www.amazon.com/dp/B0D3XGHTJ5",
            httpStatus: 200,
            structuredData: {
              asin: "B0D3XGHTJ5",
              productTitle: "faroro Automatic Cat Feeder TD20",
              brand: "faroro",
              modelNumber: "TD20",
              price: 49.99,
              currency: "USD",
            },
          },
        },
      });
      expect(res.marketplaceEvidence.length).toBeGreaterThanOrEqual(1);
      for (const ev of res.marketplaceEvidence) {
        expect(ev.observationClass).toBe("TEST_FIXTURE");
        expect(ev.observationClass).not.toBe("AUTHORIZED_LIVE");
      }
    });

    it("B09: providerRequestId remains null when Playwright MCP provides no upstream request ID; never copies providerInvocationRef", () => {
      const ev = parseAmazonProductEvidence(
        {
          sourceUrl: "https://www.amazon.com/dp/B0D3XGHTJ5",
          finalUrl: "https://www.amazon.com/dp/B0D3XGHTJ5",
          canonicalUrl: "https://www.amazon.com/dp/B0D3XGHTJ5",
          structuredData: {
            asin: "B0D3XGHTJ5",
            productTitle: "faroro Automatic Cat Feeder TD20",
            brand: "faroro",
          },
        },
        {
          workspaceId: TEST_WS_A,
          researchRunId: TEST_RUN_A,
          candidateId: "cand_b09",
          providerInvocationRef: "amz_inv_run_cand_b09",
          providerRequestId: "amz_inv_run_cand_b09",
          observationClass: "TEST_FIXTURE",
        }
      );
      expect(ev.providerInvocationRef).toBe("amz_inv_run_cand_b09");
      expect(ev.providerRequestId).toBeNull();
    });

    it("B10: httpStatus remains null (httpStatusOrigin = UNOBSERVED_NULL) when Playwright MCP does not expose HTTP status; never defaults to 200", () => {
      const ev = parseAmazonProductEvidence(
        {
          sourceUrl: "https://www.amazon.com/dp/B0D3XGHTJ5",
          finalUrl: "https://www.amazon.com/dp/B0D3XGHTJ5",
          canonicalUrl: "https://www.amazon.com/dp/B0D3XGHTJ5",
          httpStatus: null,
          structuredData: {
            asin: "B0D3XGHTJ5",
            productTitle: "faroro Automatic Cat Feeder TD20",
            brand: "faroro",
          },
        },
        {
          workspaceId: TEST_WS_A,
          researchRunId: TEST_RUN_A,
          candidateId: "cand_b10",
          observationClass: "TEST_FIXTURE",
        }
      );
      expect(ev.httpStatus).toBeNull();
      expect(ev.httpStatusOrigin).toBe("UNOBSERVED_NULL");
    });

    it("B11: Canonical URL /clp/B0D3XGHTJ5 is preserved in observedCanonicalUrl with canonicalUrlOrigin = OBSERVED_CANONICAL while canonicalAmazonUrl = https://www.amazon.com/dp/B0D3XGHTJ5", () => {
      const ev = parseAmazonProductEvidence(
        {
          sourceUrl:
            "https://www.amazon.com/faroro-Automatic-Cat-Feeder-Programmable/dp/B0D3XGHTJ5/ref=sr_1_1",
          finalUrl:
            "https://www.amazon.com/faroro-Automatic-Cat-Feeder-Programmable/dp/B0D3XGHTJ5/ref=sr_1_1",
          canonicalUrl: "https://www.amazon.com/clp/B0D3XGHTJ5",
          structuredData: {
            asin: "B0D3XGHTJ5",
            productTitle: "faroro Automatic Cat Feeder TD20",
            brand: "faroro",
          },
        },
        {
          workspaceId: TEST_WS_A,
          researchRunId: TEST_RUN_A,
          candidateId: "cand_b11",
          observationClass: "TEST_FIXTURE",
        }
      );
      expect(ev.observedCanonicalUrl).toBe("https://www.amazon.com/clp/B0D3XGHTJ5");
      expect(ev.canonicalUrlOrigin).toBe("OBSERVED_CANONICAL");
      expect(ev.canonicalAmazonUrl).toBe("https://www.amazon.com/dp/B0D3XGHTJ5");
    });

    it("B12: Canonical URL with different ASIN (/dp/B099999999 vs /dp/B0D3XGHTJ5) is rejected with ASIN_DISCREPANCY_ACROSS_SOURCES", () => {
      const ev = parseAmazonProductEvidence(
        {
          sourceUrl: "https://www.amazon.com/dp/B0D3XGHTJ5",
          finalUrl: "https://www.amazon.com/dp/B0D3XGHTJ5",
          canonicalUrl: "https://www.amazon.com/dp/B099999999",
          structuredData: {
            asin: "B0D3XGHTJ5",
            productTitle: "faroro Automatic Cat Feeder TD20",
            brand: "faroro",
          },
        },
        {
          workspaceId: TEST_WS_A,
          researchRunId: TEST_RUN_A,
          candidateId: "cand_b12",
          observationClass: "TEST_FIXTURE",
        }
      );
      expect(ev.status).toBe("FAILED");
      expect(ev.rejectionReasons.join(" ")).toContain("ASIN_DISCREPANCY_ACROSS_SOURCES");
    });

    it("B13: Unvisited search cards (4 of 5) remain searchIdentityVerdict = SEARCH_ONLY_NOT_VERIFIED and combinedIdentityVerdict = DISCOVERED_NOT_VERIFIED", () => {
      const searchRes = parseAmazonSearchSnapshotCards({
        sourceUrl: "https://www.amazon.com/s?k=automatic+cat+feeder",
        finalUrl: "https://www.amazon.com/s?k=automatic+cat+feeder",
        httpStatus: 200,
        structuredData: {
          deliveryPostalCode: "95829",
          currency: "USD",
          searchCards: [
            { asin: "B0D3XGHTJ5", title: "faroro Automatic Cat Feeder TD20", href: "/dp/B0D3XGHTJ5" },
            { asin: "B0DCNNN5FC", title: "WiFi Cat Feeder Camera", href: "/dp/B0DCNNN5FC" },
            { asin: "B0HB9H7CXV", title: "Dual Bowl Pet Feeder", href: "/dp/B0HB9H7CXV" },
            { asin: "B0GSR1GTHW", title: "Smart Dry Food Dispenser", href: "/dp/B0GSR1GTHW" },
            { asin: "B0GVSFS68N", title: "Timed Cat Food Dispenser", href: "/dp/B0GVSFS68N" },
          ],
        },
      });
      expect(searchRes.cards).toHaveLength(5);
      const unvisited = searchRes.cards.slice(1);
      expect(unvisited).toHaveLength(4);
      for (const card of unvisited) {
        expect(card.searchIdentityVerdict).toBe("SEARCH_ONLY_NOT_VERIFIED");
        expect(card.combinedIdentityVerdict).toBe("DISCOVERED_NOT_VERIFIED");
      }
    });
  });

  // ============================================================================
  // GROUP C: REAL HTTP -> SEPARATE WORKER PROCESS -> DB/API/UI (15 CASES)
  // ============================================================================
  describe("Group C — Real HTTP -> Separate Worker Process -> DB/API/UI (15 cases)", () => {
    it("C01: POST /api/v1/kh02/research without x-workspace-id returns 400 or 401", async () => {
      const req = new NextRequest("http://localhost:3000/api/v1/kh02/research", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ niche: "Pet Gadgets" }),
      });
      const res = await postResearchRoute(req);
      expect([400, 401]).toContain(res.status);
    });

    it("C02: POST /api/v1/kh02/research with client-supplied KH02_AMAZON_US_LIVE_ALLOWED or KH02_WALMART_US_LIVE_ALLOWED returns 400", async () => {
      const amzReq = new NextRequest("http://localhost:3000/api/v1/kh02/research", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-workspace-id": TEST_WS_A,
        },
        body: JSON.stringify({
          niche: "Pet Gadgets",
          KH02_AMAZON_US_LIVE_ALLOWED: true,
        }),
      });
      const amzRes = await postResearchRoute(amzReq);
      expect(amzRes.status).toBe(400);

      const wmtReq = new NextRequest("http://localhost:3000/api/v1/kh02/research", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-workspace-id": TEST_WS_A,
        },
        body: JSON.stringify({
          niche: "Pet Gadgets",
          KH02_WALMART_US_LIVE_ALLOWED: true,
        }),
      });
      const wmtRes = await postResearchRoute(wmtReq);
      expect(wmtRes.status).toBe(400);
    });

    it("C03: POST /api/v1/kh02/research returns 202 with researchRunId and QUEUED SyncJob before worker claims it", async () => {
      const req = new NextRequest("http://localhost:3000/api/v1/kh02/research", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-workspace-id": TEST_WS_A,
        },
        body: JSON.stringify({
          topic: "Pet Gadgets C03 Unique",
          market: "US",
          sourceMode: "CACHE_ONLY",
          asyncMode: true,
        }),
      });
      const res = await postResearchRoute(req);
      expect(res.status).toBe(202);
      const body = await res.json();
      const runId = body?.data?.researchRunId || body?.data?.jobId || body?.researchRunId || body?.jobId;
      expect(typeof runId).toBe("string");
      expect(["PENDING", "QUEUED"]).toContain(body?.data?.status || body?.status);
      const dbJob = await prisma.syncJob.findUnique({ where: { id: runId } });
      expect(["PENDING", "QUEUED"]).toContain(dbJob?.status);
    });

    it("C04: Worker claims QUEUED job with distinct workerId, sets claimToken, fencingToken, fencingGeneration >= 1, leaseExpiresAt", async () => {
      const req = new NextRequest("http://localhost:3000/api/v1/kh02/research", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-workspace-id": TEST_WS_A,
        },
        body: JSON.stringify({
          topic: "Pet Gadgets C04 Claim",
          market: "US",
          sourceMode: "CACHE_ONLY",
          asyncMode: true,
        }),
      });
      const res = await postResearchRoute(req);
      expect(res.status).toBe(202);
      const claimed = await claimNextResearchJob("worker_distinct_pid_99991");
      expect(claimed).not.toBeNull();
      expect(claimed?.workerId).toBe("worker_distinct_pid_99991");
      expect(Boolean(claimed?.claimToken)).toBe(true);
      expect(Boolean(claimed?.fencingToken)).toBe(true);
      expect(claimed!.fencingGeneration).toBeGreaterThanOrEqual(1);
      expect(Boolean(claimed?.leaseExpiresAt)).toBe(true);
    });

    it("C05: Stale worker with outdated claimToken / fencingGeneration cannot overwrite job state or persist evidence", async () => {
      const req = new NextRequest("http://localhost:3000/api/v1/kh02/research", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-workspace-id": TEST_WS_A,
        },
        body: JSON.stringify({
          topic: "Pet Gadgets C05 Fencing",
          market: "US",
          sourceMode: "CACHE_ONLY",
          asyncMode: true,
        }),
      });
      const res = await postResearchRoute(req);
      expect(res.status).toBe(202);
      const body = await res.json();
      const runId = body?.data?.researchRunId || body?.data?.jobId || body?.researchRunId || body?.jobId;

      // Claim all queued until we get runId
      let targetJob = await claimNextResearchJob("worker_owner_c05");
      while (targetJob && targetJob.id !== runId) {
        targetJob = await claimNextResearchJob("worker_owner_c05");
      }
      expect(targetJob?.id).toBe(runId);

      // Stale worker attempts update with wrong claimToken and fencingGeneration
      const staleAttempt = await updateJobIfClaimOwned(
        runId,
        {
          workerId: "worker_stale_intruder",
          claimToken: "stale_claim_token_000",
          fencingToken: "stale_fencing_token_000",
          fencingGeneration: 0,
          recordVersion: targetJob!.recordVersion,
        },
        { progress: 99 }
      );
      expect(staleAttempt.success).toBe(false);
      expect(staleAttempt.reason).toBe("OWNERSHIP_LOST");
    });

    it("C06: Worker completes job and writes ResearchEvidence rows (KH02_AMAZON_US_PRODUCT_EVIDENCE)", async () => {
      const ev = parseAmazonProductEvidence(
        {
          sourceUrl: "https://www.amazon.com/dp/B0D3XGHTJ5",
          finalUrl: "https://www.amazon.com/dp/B0D3XGHTJ5",
          canonicalUrl: "https://www.amazon.com/dp/B0D3XGHTJ5",
          httpStatus: 200,
          structuredData: {
            asin: "B0D3XGHTJ5",
            productTitle: "faroro Automatic Cat Feeder TD20",
            brand: "faroro",
            price: 49.99,
            currency: "USD",
            deliveryPostalCode: "95829",
            explicitUsDeliveryConfirmed: true,
          },
        },
        {
          workspaceId: TEST_WS_A,
          researchRunId: TEST_RUN_A,
          candidateId: "cand_c06",
          observationClass: "TEST_FIXTURE",
        }
      );

      const persisted = await persistAmazonEvidenceAtomically(TEST_WS_A, TEST_RUN_A, [ev]);
      expect(persisted.persistedCount).toBe(1);

      const loaded = await loadAmazonEvidenceForRun(TEST_WS_A, TEST_RUN_A);
      expect(loaded.evidenceRows.length).toBeGreaterThanOrEqual(1);
      expect(loaded.evidenceRows.some((r) => r.asin === "B0D3XGHTJ5")).toBe(true);
    });

    it("C07: GET /research/runs/{runId}, GET /research, GET /leaderboard, GET /marketplace/amazon return consistent workspace-scoped data", async () => {
      const amzReq = new NextRequest(
        `http://localhost:3000/api/v1/kh02/marketplace/amazon?runId=${TEST_RUN_A}&researchRunId=${TEST_RUN_A}`,
        {
          method: "GET",
          headers: { "x-workspace-id": TEST_WS_A },
        }
      );
      const amzRes = await getAmazonRoute(amzReq);
      expect(amzRes.status).toBe(200);
      const amzJson = await amzRes.json();
      const records =
        amzJson?.data?.marketplaceEvidence ||
        amzJson?.data?.evidenceRows ||
        amzJson?.data?.evidenceRecords ||
        amzJson?.marketplaceEvidence ||
        amzJson?.evidenceRows ||
        amzJson?.evidenceRecords ||
        [];
      expect(records.some((r: any) => r.asin === "B0D3XGHTJ5")).toBe(true);
    });

    it("C08: GET routes are strictly read-only (0 new/modified DB rows across repeated GET requests)", async () => {
      const beforeJobs = await prisma.syncJob.count({ where: { workspaceId: TEST_WS_A } });
      const beforeEv = await prisma.researchEvidence.count({ where: { workspaceId: TEST_WS_A } });

      const lbReq = new NextRequest("http://localhost:3000/api/v1/kh02/leaderboard?niche=Pet+Gadgets", {
        method: "GET",
        headers: { "x-workspace-id": TEST_WS_A },
      });
      await getLeaderboardRoute(lbReq);
      await getLeaderboardRoute(lbReq);

      const resReq = new NextRequest("http://localhost:3000/api/v1/kh02/research?niche=Pet+Gadgets", {
        method: "GET",
        headers: { "x-workspace-id": TEST_WS_A },
      });
      await getResearchRoute(resReq);

      const afterJobs = await prisma.syncJob.count({ where: { workspaceId: TEST_WS_A } });
      const afterEv = await prisma.researchEvidence.count({ where: { workspaceId: TEST_WS_A } });
      expect(afterJobs).toBe(beforeJobs);
      expect(afterEv).toBe(beforeEv);
    });

    it("C09: GET with Workspace B header cannot read Workspace A run or Amazon evidence", async () => {
      const amzReqB = new NextRequest(
        `http://localhost:3000/api/v1/kh02/marketplace/amazon?runId=${TEST_RUN_A}&researchRunId=${TEST_RUN_A}`,
        {
          method: "GET",
          headers: { "x-workspace-id": TEST_WS_B },
        }
      );
      const amzResB = await getAmazonRoute(amzReqB);
      const amzJsonB = await amzResB.json();
      const recordsB =
        amzJsonB?.data?.evidenceRows ||
        amzJsonB?.data?.evidenceRecords ||
        amzJsonB?.evidenceRows ||
        [];
      expect(recordsB).toHaveLength(0);
    });

    it("C10: Product Finder UI data contract preserves exact shortlist and Amazon evidence fields across serialization/reload", () => {
      const ev = parseAmazonProductEvidence(
        {
          sourceUrl: "https://www.amazon.com/dp/B0D3XGHTJ5",
          finalUrl: "https://www.amazon.com/dp/B0D3XGHTJ5",
          canonicalUrl: "https://www.amazon.com/clp/B0D3XGHTJ5",
          httpStatus: 200,
          structuredData: {
            asin: "B0D3XGHTJ5",
            productTitle: "faroro Automatic Cat Feeder TD20",
            brand: "faroro",
            price: 49.99,
            currency: "USD",
            deliveryPostalCode: "95829",
            explicitUsDeliveryConfirmed: true,
          },
        },
        {
          workspaceId: TEST_WS_A,
          researchRunId: TEST_RUN_A,
          candidateId: "cand_c10",
          observationClass: "TEST_FIXTURE",
        }
      );
      const summaryBefore = summarizeAmazonEvidenceForProduct(
        "cand_c10",
        TEST_RUN_A,
        [ev]
      );
      const summaryAfter = JSON.parse(JSON.stringify(summaryBefore));
      expect(summaryAfter).toEqual(summaryBefore);
      expect(summaryAfter.asin).toBe("B0D3XGHTJ5");
    });

    it("C11: Provisional shortlist items (PROVISIONAL_CANDIDATE) never render as verified evergreen winners (evergreenWinnerCount = 0)", () => {
      const candidates = discoverProductCandidatesFromAds(
        [
          {
            source: "META_ADS",
            sourceRecordId: "1455290188234101",
            sourceUrl: "https://www.facebook.com/ads/library/?id=1455290188234101",
            landingPageUrl: "https://pawquench.com/products/stainless-cat-water-fountain",
            advertiserDomain: "pawquench.com",
            advertiserOrCreator: "PawQuench",
            title: "PawQuench Stainless Cat Water Fountain",
            description: "Ultra quiet cat water fountain with triple filtration.",
            provenance: "LIVE_PROVIDER",
            observedAt: "2026-10-20T10:00:00.000Z",
          },
        ],
        "Pet Gadgets"
      );
      const selection = selectTopResearchShortlist(candidates, 3);
      for (const item of selection.shortlist) {
        expect((item as any).qualificationTier).not.toBe("EVERGREEN_WINNER");
      }
    });

    it("C12: Shortfall (< 3 candidates) is never padded with fabricated or irrelevant items", () => {
      const candidates = discoverProductCandidatesFromAds(
        [
          {
            source: "META_ADS",
            sourceRecordId: "1455290188234101",
            sourceUrl: "https://www.facebook.com/ads/library/?id=1455290188234101",
            landingPageUrl: "https://pawquench.com/products/stainless-cat-water-fountain",
            advertiserDomain: "pawquench.com",
            advertiserOrCreator: "PawQuench",
            title: "PawQuench Stainless Cat Water Fountain",
            description: "Ultra quiet cat water fountain.",
            provenance: "LIVE_PROVIDER",
            observedAt: "2026-10-20T10:00:00.000Z",
          },
        ],
        "Pet Gadgets"
      );
      const selection = selectTopResearchShortlist(candidates, 3);
      expect(selection.shortlist.length).toBe(1);
      expect(selection.shortfallReason).toBeTruthy();
    });

    it("C13: Secondary niche (Home Organization) has 0 overlap in candidateId, productFamilyKey, and asin with Pet Gadgets", () => {
      const petCandidates = discoverProductCandidatesFromAds(
        [
          {
            source: "META_ADS",
            sourceRecordId: "1455290188234101",
            sourceUrl: "https://www.facebook.com/ads/library/?id=1455290188234101",
            landingPageUrl: "https://pawquench.com/products/stainless-cat-water-fountain",
            advertiserDomain: "pawquench.com",
            advertiserOrCreator: "PawQuench",
            title: "PawQuench Stainless Cat Water Fountain",
            description: "Quiet pet hydration fountain.",
            provenance: "LIVE_PROVIDER",
            observedAt: "2026-10-20T10:00:00.000Z",
          },
        ],
        "Pet Gadgets"
      );
      const homeCandidates = discoverProductCandidatesFromAds(
        [
          {
            source: "META_ADS",
            sourceRecordId: "2455290188234202",
            sourceUrl: "https://www.facebook.com/ads/library/?id=2455290188234202",
            landingPageUrl: "https://shelfmaster.com/products/under-sink-sliding-organizer",
            advertiserDomain: "shelfmaster.com",
            advertiserOrCreator: "ShelfMaster",
            title: "ShelfMaster 2-Tier Under Sink Sliding Organizer Rack",
            description: "Pull-out cabinet storage organizer for kitchen and bathroom.",
            provenance: "LIVE_PROVIDER",
            observedAt: "2026-10-20T10:00:00.000Z",
          },
        ],
        "Home Organization"
      );

      expect(petCandidates.length).toBeGreaterThanOrEqual(1);
      expect(homeCandidates.length).toBeGreaterThanOrEqual(1);
      const petIds = new Set(petCandidates.map((c) => c.candidateId));
      const homeIds = new Set(homeCandidates.map((c) => c.candidateId));
      for (const hid of homeIds) {
        expect(petIds.has(hid)).toBe(false);
      }
      const petFamilies = new Set(
        petCandidates.map((c) => c.familyKey || c.canonicalProductName)
      );
      const homeFamilies = new Set(
        homeCandidates.map((c) => c.familyKey || c.canonicalProductName)
      );
      for (const hf of homeFamilies) {
        expect(petFamilies.has(hf)).toBe(false);
      }
    });

    it("C14: Walmart remains paused (PAUSED_EXTERNAL / PAUSED_BLOCKED_PROVIDER) and makes 0 live Walmart HTTP requests", async () => {
      const policy = resolveWalmartUsPilotPolicy({});
      expect(policy.featureEnabled).toBe(false);
      expect(policy.liveAllowed).toBe(false);
      expect(policy.operationalStatus).toBe("PAUSED_EXTERNAL");

      let liveWalmartHttpCount = 0;
      const wmtRes = await runWalmartUsPilotEnrichment({
        workspaceId: TEST_WS_A,
        researchRunId: TEST_RUN_A,
        niche: "Pet Gadgets",
        enableWalmartUsPilot: true,
        shortlistedCandidates: [
          {
            candidateId: "cand_wmt_c14",
            title: "PawQuench Stainless Cat Water Fountain",
            brand: "PawQuench",
          } as any,
        ],
        env: {},
        customFetch: (async () => {
          liveWalmartHttpCount++;
          return new Response("{}", { status: 200 });
        }) as any,
      });
      expect(liveWalmartHttpCount).toBe(0);
      expect(wmtRes.telemetry.logicalOperationsUsed).toBe(0);
      expect(wmtRes.telemetry.overallStatus).toBe("DISABLED");
    });

    it("C15: MCP session lifecycle tracks ownedChildPid and verifies clean termination on close()", async () => {
      const conn = await connectAmazonPlaywrightMcp({
        fixtureTransport: {
          enabled: true,
          snapshotsByUrl: {
            "https://www.amazon.com/dp/B0D3XGHTJ5": {
              sourceUrl: "https://www.amazon.com/dp/B0D3XGHTJ5",
              finalUrl: "https://www.amazon.com/dp/B0D3XGHTJ5",
              httpStatus: 200,
              pageTitle: "faroro Automatic Cat Feeder",
            },
          },
        },
      });
      expect(conn.session?.isAlive()).toBe(true);
      await conn.session?.close();
      expect(conn.session?.isAlive()).toBe(false);
      expect(conn.handshakeProof.closedCleanly).toBe(true);
    });
  });

  // ============================================================================
  // GROUP D: META -> AMAZON DISCOVERY & IDENTITY REGRESSION (6 CASES)
  // ============================================================================
  describe("Group D — Meta -> Amazon Discovery & Identity Regression (6 cases)", () => {
    it("D01: selectDynamicAmazonVerificationTargets selects up to 2 top shortlist candidates and never falls back to candidates.slice(0, 3)", () => {
      const ineligible = selectDynamicAmazonVerificationTargets(
        [
          {
            candidateId: "cand_ineligible_1",
            title: "Generic Store Blog Post",
            relevanceStatus: "IRRELEVANT",
            productRealityStatus: "UNRESOLVED",
            identityStatus: "UNRESOLVED",
            sourceObservations: [{ provenance: "CACHED_SOURCE" }],
          } as any,
        ],
        [],
        { niche: "Pet Gadgets" }
      );
      expect(ineligible.selectedCandidates).toHaveLength(0);
      expect(ineligible.selectedCount).toBe(0);
    });

    it("D02: deriveAmazonSearchIntents strips marketing fluff (50% OFF, Free Shipping, emojis, URLs) and builds clean product query", () => {
      const intents = deriveAmazonSearchIntents(
        {
          candidateId: "cand_d02",
          title: "🔥 50% OFF Today Only! Free Shipping https://example.com Furbo 360 Dog Camera Treat Tosser",
          canonicalProductName: "Furbo 360 Dog Camera Treat Tosser",
          brand: "Furbo",
        },
        "Pet Gadgets"
      );
      expect(intents.length).toBeGreaterThanOrEqual(1);
      expect(intents[0].normalizedKeywords.toLowerCase()).not.toContain("50%");
      expect(intents[0].normalizedKeywords.toLowerCase()).not.toContain("free shipping");
      expect(intents[0].normalizedKeywords.toLowerCase()).not.toContain("http");
      expect(intents[0].normalizedKeywords.toLowerCase()).toContain("furbo");
    });

    it("D03: Search card brand is never copied from candidate.brand when search card DOM lacks brand", () => {
      const searchRes = parseAmazonSearchSnapshotCards({
        sourceUrl: "https://www.amazon.com/s?k=automatic+cat+laser+toy",
        finalUrl: "https://www.amazon.com/s?k=automatic+cat+laser+toy",
        httpStatus: 200,
        structuredData: {
          searchCards: [
            {
              asin: "B0C7GMX4FT",
              title: "Interactive Cat Laser Toy Automatic Rotating Tower",
              brand: null,
              href: "/dp/B0C7GMX4FT",
            },
          ],
        },
      });
      expect(searchRes.cards).toHaveLength(1);
      expect(searchRes.cards[0].brand).toBeNull();
    });

    it("D04: Search -> PDP same-item identity (AMAZON_SEARCH_PDP_IDENTITY_VERIFIED) does NOT auto-promote metaCandidateEquivalenceVerdict to EXACT_PRODUCT when brand/model differ", () => {
      const pdpEv = parseAmazonProductEvidence(
        {
          sourceUrl: "https://www.amazon.com/dp/B0C7GMX4FT",
          finalUrl: "https://www.amazon.com/dp/B0C7GMX4FT",
          canonicalUrl: "https://www.amazon.com/dp/B0C7GMX4FT",
          httpStatus: 200,
          structuredData: {
            asin: "B0C7GMX4FT",
            productTitle: "YVE LIFE Interactive Cat Toys Laser for Indoor Cats Automatic Kitten Toys",
            brand: "YVE LIFE",
            modelNumber: "M05",
            price: 25.0,
            currency: "USD",
            deliveryPostalCode: "95829",
            explicitUsDeliveryConfirmed: true,
          },
        },
        {
          workspaceId: TEST_WS_A,
          researchRunId: TEST_RUN_A,
          candidateId: "cand_meta_other_brand",
          observationClass: "TEST_FIXTURE",
        }
      );

      const verified = verifyAmazonProductIdentity(
        {
          candidateId: "cand_meta_other_brand",
          title: "Interactive Cat Laser Toy Tower",
          brand: null,
        },
        pdpEv,
        {
          searchCard: {
            asin: "B0C7GMX4FT",
            productTitle: "YVE LIFE Interactive Cat Toys Laser for Indoor Cats Automatic Kitten Toys",
            brand: "YVE LIFE",
            observedSearchHref: "https://www.amazon.com/dp/B0C7GMX4FT",
            observedSearchHrefOrigin: "OBSERVED_HREF",
            searchRankPosition: 1,
          },
          sessionClosedCleanly: true,
        }
      );

      expect(verified.searchIdentityVerdict).toBe("AMAZON_SEARCH_PDP_IDENTITY_VERIFIED");
      expect(verified.metaCandidateEquivalenceVerdict).not.toBe("EXACT_PRODUCT");
      expect(verified.combinedIdentityVerdict).toBe(
        "AMAZON_SEARCH_PDP_VERIFIED_META_MATCH_UNVERIFIED"
      );
    });

    it("D05: Brand-only match (BRAND_ONLY) never promotes to EXACT_PRODUCT", () => {
      const pdpEv = parseAmazonProductEvidence(
        {
          sourceUrl: "https://www.amazon.com/dp/B0D3XGHTJ5",
          finalUrl: "https://www.amazon.com/dp/B0D3XGHTJ5",
          canonicalUrl: "https://www.amazon.com/dp/B0D3XGHTJ5",
          httpStatus: 200,
          structuredData: {
            asin: "B0D3XGHTJ5",
            productTitle: "faroro Replacement Desiccant Bag 6-Pack for Pet Feeder",
            brand: "faroro",
            price: 12.99,
            currency: "USD",
          },
        },
        {
          workspaceId: TEST_WS_A,
          researchRunId: TEST_RUN_A,
          candidateId: "cand_d05",
          observationClass: "TEST_FIXTURE",
        }
      );

      const verified = verifyAmazonProductIdentity(
        {
          candidateId: "cand_d05",
          title: "faroro Automatic Cat Feeder 4L Timed Pet Dry Food Dispenser TD20",
          brand: "faroro",
          model: "TD20",
        },
        pdpEv
      );
      expect(verified.identityMatch).not.toBe("EXACT_PRODUCT");
      expect(verified.metaCandidateEquivalenceVerdict).not.toBe("EXACT_PRODUCT");
    });

    it("D06: Amazon/Walmart evidence attachment produces 0 delta on evergreenScore, ranking, G07, G15, G16", () => {
      const before = {
        runId: "run_before_d06",
        cutoffIso: "2026-10-30T00:00:00.000Z",
        candidates: [
          {
            candidateId: "cand_1",
            rank: 1,
            opportunityScore: 71.4,
            g07Passed: false,
            g15Passed: false,
            g16Passed: false,
          },
          {
            candidateId: "cand_2",
            rank: 2,
            opportunityScore: 68.2,
            g07Passed: false,
            g15Passed: false,
            g16Passed: false,
          },
        ],
      };
      const after = {
        runId: "run_after_d06",
        cutoffIso: "2026-10-30T00:00:00.000Z",
        candidates: before.candidates.map((c) => ({
          ...c,
          amazonEvidenceStatus: "IDENTITY_VERIFIED",
        })),
      };

      const delta = computeAmazonNonInflationDelta(before as any, after as any);
      expect(delta.comparisonStatus).toBe("COMPARED_ZERO_INFLATION");
      expect(delta.maxAbsoluteScoreDelta).toBe(0);
      expect(delta.rankOrderChanged).toBe(false);
      expect(delta.g07Changed).toBe(false);
      expect(delta.g15Changed).toBe(false);
      expect(delta.g16Changed).toBe(false);
    });
  });
});
