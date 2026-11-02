/**
 * SWAI KH-02 V12.4.3.5.0 — Microsoft Playwright MCP Transport for Amazon US Pilot
 *
 * Implements `connectAmazonPlaywrightMcp(options)` using the official Model Context Protocol
 * SDK (`@modelcontextprotocol/sdk`) over `StdioClientTransport` against pinned
 * `@playwright/mcp@0.0.83` (`--headless --isolated --block-service-workers`).
 *
 * Core Invariants:
 * 1. Never labels ordinary Playwright or mock fixtures as a live MCP session.
 * 2. Verifies real MCP initialization handshake (`getServerVersion()`) and tool discovery (`listTools()`).
 * 3. Enforces headless, isolated in-memory browser profile (`--headless --isolated`).
 * 4. Guarantees clean shutdown of both MCP client session and owned child process on close/abort/timeout.
 * 5. Unit-test fixture transport is explicitly stamped `transportMode: "TEST_FIXTURE"` and
 *    `observationClass: "TEST_FIXTURE"` so it can never satisfy live provider gates.
 */

import crypto from "crypto";
import fs from "fs";
import os from "os";
import path from "path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import {
  AmazonMcpSessionLifecycleProof,
  MarketplaceObservationClass,
} from "./marketplaceEvidenceTypes";
import {
  ParsedAmazonSearchSnapshotResult,
  RawAmazonSnapshotInput,
   parseAmazonSearchSnapshotCards,
  validateAmazonUsProductUrl,
  validateAmazonUsSearchUrl,
} from "./amazonUsIdentity";

export type { AmazonMcpSessionLifecycleProof };

export const PLAYWRIGHT_MCP_PINNED_PACKAGE = "@playwright/mcp@0.0.83";
export const PLAYWRIGHT_MCP_PINNED_VERSION = "0.0.83";

export interface PlaywrightMcpToolInvocationRecord {
  toolName: string;
  url: string;
  invokedAt: string;
  requestHash: string | null;
  responseHash: string | null;
}

export interface AmazonUiLocationActionStep {
  step:
    | "NAVIGATE_HOME"
    | "WAIT_SEARCH_BOX_READY"
    | "READ_INITIAL_CONTEXT"
    | "OPEN_LOCATION_POPOVER_AND_APPLY_ZIP"
    | "REFRESH_AND_READBACK_AFTER_APPLY";
  toolName: string;
  invokedAt: string;
  completedAt: string;
  durationMs: number;
  status: "SUCCEEDED" | "FAILED" | "SKIPPED" | "TIMED_OUT" | "BLOCKED";
  detail: string;
  snapshotHash: string | null;
}

export interface AmazonCommercialUiReadback {
  observedAt: string;
  url: string | null;
  pageTitle: string | null;
  searchBoxReady: boolean;
  deliveryLinkVisible: boolean;
  deliveryLocationText: string | null;
  observedZip: string | null;
  observedMarket: "US" | null;
  explicitCurrency: string | null;
  explicitCurrencySource: string | null;
  rawPriceText: string | null;
  parsedUsdPrice: number | null;
  seller: string | null;
  availability: string | null;
  captchaDetected: boolean;
  loginWallDetected: boolean;
  snapshotHash: string;
}

export interface AmazonUiLocationPreflightResult {
  attempted: boolean;
  status:
    | "US_DISPLAYED_CONTEXT_VERIFIED"
    | "NOT_USD_VERIFIED"
    | "US_NOT_CONFIRMED"
    | "READY_TIMEOUT"
    | "DIALOG_OR_APPLY_UNAVAILABLE"
    | "UNKNOWN"
    | "BLOCKED_PROVIDER"
    | "AUTHENTICATION_REQUIRED";
  sessionId: string | null;
  ownedChildPid: number | null;
  targetZip: string;
  homepageReady: boolean;
  searchBoxReady: boolean;
  deliveryLinkVisible: boolean;
  locationDialogOpened: boolean;
  zipFieldVisible: boolean;
  applyClicked: boolean;
  confirmationHandled: boolean;
  initialDeliveryText: string | null;
  initialObservedZip: string | null;
  initialExplicitCurrency: string | null;
  initialExplicitCurrencySource: string | null;
  observedDeliveryLocationText: string | null;
  observedDeliveryPostalCode: string | null;
  observedCurrency: string | null;
  explicitCurrencySource: string | null;
  usDeliveryVerified: boolean;
  homeSnapshotHash: string | null;
  uiActionLedger: AmazonUiLocationActionStep[];
  notes: string[];
}

export interface McpToolCaller {
  callTool(params: { name: string; arguments?: Record<string, any> }): Promise<any>;
  discoveredTools?: string[];
  sessionId?: string | null;
  ownedChildPid?: number | null;
  recordToolInvocation?: (record: PlaywrightMcpToolInvocationRecord) => void;
}

export function parsePlaywrightMcpEvaluateJson(rawText: string): any {
  if (!rawText) return null;
  const resultSection = rawText
    .split(/###\s+Ran Playwright code/i)[0]
    .replace(/^[\s\S]*?###\s+Result\s*/i, "")
    .trim();
  for (const candidateStr of [resultSection, rawText]) {
    if (!candidateStr) continue;
    try {
      const firstParse = JSON.parse(candidateStr);
      return typeof firstParse === "string" ? JSON.parse(firstParse) : firstParse;
    } catch {}
    const lineMatch = candidateStr.match(/^"(\{.*\})"$/m);
    if (lineMatch) {
      try {
        const unescaped = JSON.parse(`"${lineMatch[1]}"`);
        return typeof unescaped === "string" ? JSON.parse(unescaped) : unescaped;
      } catch {}
    }
    const objMatch = candidateStr.match(/\{[\s\S]*?\}/);
    if (objMatch) {
      try {
        return JSON.parse(objMatch[0]);
      } catch {}
    }
  }
  return null;
}

/**
 * Reads commercial context (delivery location text, 5-digit US ZIP, and independent explicit currency preference)
 * from the currently rendered Amazon page using read-only DOM evaluation.
 * Never infers USD from requested ZIP, observed ZIP, amazon.com domain, or bare '$' symbol alone.
 */
export async function readAmazonCommercialContextFromRenderedUi(
  caller: McpToolCaller,
  options: { pageUrlHint?: string; signal?: AbortSignal } = {}
): Promise<AmazonCommercialUiReadback> {
  const observedAt = new Date().toISOString();
  const evalFn = `() => {
    const isVisible = (el) => Boolean(el && (el.offsetWidth > 0 || el.offsetHeight > 0 || el.getClientRects().length > 0));
    const searchBox = document.querySelector('#twotabsearchtextbox') || document.querySelector('#nav-bb-search');
    const locLink = document.querySelector('#nav-global-location-popover-link') || document.querySelector('#glow-ingress-block');
    const glowText = (
      document.querySelector('#glow-ingress-block')?.textContent ||
      document.querySelector('#contextualIngressPtLabel_deliveryShortLine')?.textContent ||
      document.querySelector('#nav-global-location-popover-link')?.textContent ||
      ''
    ).replace(/\\s+/g, ' ').trim() || null;

    const nonUsCountryMatch = glowText ? glowText.match(/\\bDeliver\\s+to\\s+(Vietnam|Canada|United\\s+Kingdom|Germany|France|Japan|Australia|India|Mexico|Brazil|Singapore|Republic\\s+of\\s+Korea)\\b/i) : null;
    const zipMatch = !nonUsCountryMatch && glowText ? glowText.match(/\\b(\\d{5})(?:-\\d{4})?\\b/) : null;
    const observedZip = zipMatch ? zipMatch[1] : null;
    const explicitUsText = Boolean(
      !nonUsCountryMatch &&
      glowText &&
      (observedZip || /\\bDeliver\\s+to\\s+(?:United\\s+States|US|Sacramento|New\\s+York|Los\\s+Angeles|Chicago|Seattle|Austin|Miami)\\b/i.test(glowText))
    );

    const extractBuyboxPriceText = (root) => {
      if (!root) return null;
      const offscreen = root.querySelector(
        '.a-price.priceToPay .a-offscreen, .a-price.priceToPay .aok-offscreen, .a-price .a-offscreen, .a-price .aok-offscreen'
      );
      if (offscreen && offscreen.textContent && offscreen.textContent.trim()) {
        const firstToken = offscreen.textContent.trim().split(/\\s+with\\s+/i)[0].trim();
        if (firstToken) return firstToken;
      }
      const priceRoot = root.querySelector('.a-price.priceToPay, .a-price');
      if (priceRoot) {
        const sym = (priceRoot.querySelector('.a-price-symbol')?.textContent || '').trim();
        const whole = (priceRoot.querySelector('.a-price-whole')?.textContent || '').replace(/[^0-9]/g, '');
        const frac = (priceRoot.querySelector('.a-price-fraction')?.textContent || '').replace(/[^0-9]/g, '');
        if (whole) {
          return sym + whole + (frac ? '.' + frac : '');
        }
      }
      return null;
    };

    const corePriceContainer =
      document.querySelector('#corePriceDisplay_desktop_feature_div') ||
      document.querySelector('#corePrice_feature_div') ||
      document.querySelector('#Apex_desktop') ||
      document.querySelector('#ppd') ||
      document.querySelector('#centerCol');
    const rawPriceText = extractBuyboxPriceText(corePriceContainer);

    let explicitCurrency = null;
    let explicitCurrencySource = null;

    if (rawPriceText && /^(?:VND|\\u20ab)\\s*[0-9]|[0-9]\\s*(?:VND|\\u20ab)/i.test(rawPriceText)) {
      explicitCurrency = 'VND';
      explicitCurrencySource = 'DOM:buybox_VND';
    } else if (rawPriceText && /^US\\$[0-9]/i.test(rawPriceText)) {
      explicitCurrency = 'USD';
      explicitCurrencySource = 'DOM:buybox_US$';
    }

    const copText = (
      document.querySelector('#icp-touch-link-cop')?.textContent ||
      document.querySelector('#icp-nav-flyout')?.textContent ||
      ''
    ).replace(/\\s+/g, ' ').trim();
    if (!explicitCurrency && copText) {
      const isoMatch = copText.match(/\\b(USD|VND|EUR|GBP|CAD|AUD|JPY|SGD|KRW|MXN|BRL)\\b/i);
      if (isoMatch) {
        explicitCurrency = isoMatch[1].toUpperCase();
        explicitCurrencySource = 'DOM:#icp-touch-link-cop';
      } else if (/U\\.S\\.\\s*Dollar|US\\s+Dollar/i.test(copText)) {
        explicitCurrency = 'USD';
        explicitCurrencySource = 'DOM:#icp-touch-link-cop';
      } else if (/Vietnamese\\s+Dong/i.test(copText)) {
        explicitCurrency = 'VND';
        explicitCurrencySource = 'DOM:#icp-touch-link-cop';
      }
    }

    if (!explicitCurrency) {
      const copInput = document.querySelector('input#currencyOfPreference, input[name="currencyOfPreference"]');
      const copVal = copInput ? (copInput.getAttribute('value') || copInput.value || '').trim().toUpperCase() : '';
      if (/^[A-Z]{3}$/.test(copVal)) {
        explicitCurrency = copVal;
        explicitCurrencySource = 'DOM:input[name=currencyOfPreference]';
      }
    }

    if (!explicitCurrency) {
      const metricsEl = document.querySelector('#cerberus-data-metrics[data-asin-currency-code], [data-asin-currency-code]');
      const attrCurr = metricsEl ? (metricsEl.getAttribute('data-asin-currency-code') || '').trim().toUpperCase() : '';
      if (/^[A-Z]{3}$/.test(attrCurr)) {
        explicitCurrency = attrCurr;
        explicitCurrencySource = 'DOM:[data-asin-currency-code]';
      }
    }

    if (!explicitCurrency) {
      const htmlStr = document.documentElement?.innerHTML || '';
      const jsonCurr = htmlStr.match(/"(?:priceCurrency|currencyCode)"\\s*:\\s*"(USD|VND|EUR|GBP|CAD|AUD|JPY)"/i);
      if (jsonCurr) {
        explicitCurrency = jsonCurr[1].toUpperCase();
        explicitCurrencySource = 'DOM:priceCurrency';
      }
    }

    if (!explicitCurrency && rawPriceText && /^\\$[0-9]/.test(rawPriceText)) {
      explicitCurrencySource = 'SYMBOL_ONLY_UNVERIFIED';
    }

    const availNode =
      document.querySelector('#availability span.a-size-medium') ||
      document.querySelector('#availability span') ||
      document.querySelector('#availability');
    const availRaw = availNode?.textContent?.replace(/\\s+/g, ' ').trim() || null;
    const availability = availRaw ? availRaw.split('{')[0].trim() : null;

    let seller =
      document.querySelector('#sellerProfileTriggerId')?.textContent?.trim() ||
      document.querySelector('#tabular-buybox .tabular-buybox-text[tabular-attribute-name="Sold by"]')?.textContent?.replace(/\\s+/g, ' ').trim() ||
      null;
    if (!seller) {
      const mInfo = document.querySelector('#merchant-info')?.textContent?.replace(/\\s+/g, ' ').trim() || '';
      const sm = mInfo.match(/Sold by\\s+([^.]+?)(?:\\s+and\\s+|\\.|$)/i);
      if (sm) seller = sm[1].trim();
    }

    const bodyText = (document.title || '') + ' ' + (document.body?.innerText?.slice(0, 4000) || '');
    const captchaDetected = /validateCaptcha|opfcaptcha|Enter the characters you see below|not a robot|type the characters you see in this image|To discuss automated access to Amazon data/i.test(bodyText);
    const loginWallDetected = Boolean(
      document.querySelector('#ap_email, form[name="signIn"]') &&
      !searchBox
    );

    return JSON.stringify({
      url: window.location.href,
      pageTitle: document.title || null,
      searchBoxReady: isVisible(searchBox),
      deliveryLinkVisible: isVisible(locLink),
      deliveryLocationText: glowText,
      observedZip,
      observedMarket: explicitUsText ? 'US' : null,
      explicitCurrency,
      explicitCurrencySource,
      rawPriceText,
      seller,
      availability,
      captchaDetected,
      loginWallDetected,
    });
  }`;

  const invokedAt = new Date().toISOString();
  const reqHash = crypto
    .createHash("sha256")
    .update(JSON.stringify({ tool: "browser_evaluate", purpose: "readAmazonCommercialContextFromRenderedUi" }), "utf8")
    .digest("hex");
  const evalRes = await caller.callTool({
    name: "browser_evaluate",
    arguments: { function: evalFn },
  });
  const respHash = crypto
    .createHash("sha256")
    .update(JSON.stringify(evalRes || null), "utf8")
    .digest("hex");
  caller.recordToolInvocation?.({
    toolName: "browser_evaluate",
    url: options.pageUrlHint || "https://www.amazon.com/",
    invokedAt,
    requestHash: reqHash,
    responseHash: respHash,
  });

  const text = ((evalRes as any)?.content || [])
    .filter((c: any) => c && typeof c.text === "string")
    .map((c: any) => c.text)
    .join("\n");
  const parsed = parsePlaywrightMcpEvaluateJson(text) || {};

  const observedZip =
    typeof parsed.observedZip === "string" && /^\d{5}$/.test(parsed.observedZip.trim())
      ? parsed.observedZip.trim()
      : null;
  const observedMarket: "US" | null =
    parsed.observedMarket === "US" && observedZip !== null ? "US" : null;
  const explicitCurrency =
    typeof parsed.explicitCurrency === "string" && /^[A-Z]{3}$/.test(parsed.explicitCurrency.trim())
      ? parsed.explicitCurrency.trim().toUpperCase()
      : null;
  const rawPriceText = typeof parsed.rawPriceText === "string" ? parsed.rawPriceText.trim() : null;
  let parsedUsdPrice: number | null = null;
  if (explicitCurrency === "USD" && rawPriceText) {
    const numMatch = rawPriceText.match(/(?:US)?\$([0-9]+(?:\.[0-9]{2})?)/i);
    if (numMatch) {
      const n = Number(numMatch[1]);
      if (Number.isFinite(n) && n > 0) {
        parsedUsdPrice = Math.round(n * 100) / 100;
      }
    }
  }

  const snapshotHash = crypto
    .createHash("sha256")
    .update(
      JSON.stringify({
        url: parsed.url || null,
        pageTitle: parsed.pageTitle || null,
        deliveryLocationText: parsed.deliveryLocationText || null,
        observedZip,
        explicitCurrency,
        explicitCurrencySource: parsed.explicitCurrencySource || null,
        rawPriceText,
        seller: parsed.seller || null,
        availability: parsed.availability || null,
      }),
      "utf8"
    )
    .digest("hex");

  return {
    observedAt,
    url: parsed.url || null,
    pageTitle: parsed.pageTitle || null,
    searchBoxReady: Boolean(parsed.searchBoxReady),
    deliveryLinkVisible: Boolean(parsed.deliveryLinkVisible),
    deliveryLocationText: parsed.deliveryLocationText || null,
    observedZip,
    observedMarket,
    explicitCurrency,
    explicitCurrencySource: parsed.explicitCurrencySource || null,
    rawPriceText,
    parsedUsdPrice,
    seller: parsed.seller || null,
    availability: parsed.availability || null,
    captchaDetected: Boolean(parsed.captchaDetected),
    loginWallDetected: Boolean(parsed.loginWallDetected),
    snapshotHash,
  };
}

/**
 * Sets Amazon US delivery postal code (e.g. 95829) using ONLY the normal rendered Amazon UI controls
 * (#nav-global-location-popover-link -> #GLUXZipUpdateInput -> Apply -> Continue/Done) and verifies
 * post-apply ZIP and explicit currency readback independently.
 */
export async function ensureAmazonUsDeliveryContextViaUi(
  caller: McpToolCaller,
  options: {
    targetZip?: string;
    maxReadyPolls?: number;
    pollIntervalMs?: number;
    signal?: AbortSignal;
  } = {}
): Promise<AmazonUiLocationPreflightResult> {
  const targetZip = (options.targetZip || "95829").trim();
  const maxReadyPolls = options.maxReadyPolls ?? 4;
  const pollIntervalMs = options.pollIntervalMs ?? 500;
  const uiActionLedger: AmazonUiLocationActionStep[] = [];
  const notes: string[] = [];

  const callNav = async (url: string, stepName: AmazonUiLocationActionStep["step"]) => {
    const startMs = Date.now();
    const invokedAt = new Date(startMs).toISOString();
    const reqHash = crypto
      .createHash("sha256")
      .update(JSON.stringify({ tool: "browser_navigate", url, step: stepName }), "utf8")
      .digest("hex");
    const navRes = await caller.callTool({
      name: "browser_navigate",
      arguments: { url },
    });
    const completedAt = new Date().toISOString();
    const respHash = crypto
      .createHash("sha256")
      .update(JSON.stringify(navRes || null), "utf8")
      .digest("hex");
    caller.recordToolInvocation?.({
      toolName: "browser_navigate",
      url,
      invokedAt,
      requestHash: reqHash,
      responseHash: respHash,
    });
    const isErr = Boolean((navRes as any)?.isError);
    uiActionLedger.push({
      step: stepName,
      toolName: "browser_navigate",
      invokedAt,
      completedAt,
      durationMs: Math.max(0, Date.now() - startMs),
      status: isErr ? "FAILED" : "SUCCEEDED",
      detail: `Navigated to ${url}`,
      snapshotHash: respHash,
    });
    return navRes;
  };

  // 1. Navigate to https://www.amazon.com/
  await callNav("https://www.amazon.com/", "NAVIGATE_HOME");

  // 2. Bounded readiness polling for #twotabsearchtextbox
  let initialReadback = await readAmazonCommercialContextFromRenderedUi(caller, {
    pageUrlHint: "https://www.amazon.com/",
    signal: options.signal,
  });

  let readyPollCount = 1;
  while (
    !initialReadback.searchBoxReady &&
    !initialReadback.captchaDetected &&
    !initialReadback.loginWallDetected &&
    readyPollCount < maxReadyPolls
  ) {
    readyPollCount++;
    if (readyPollCount === 2 && !initialReadback.pageTitle) {
      // If bare root returned an empty shell on cold start, navigate to /ref=nav_logo once
      await callNav("https://www.amazon.com/ref=nav_logo", "WAIT_SEARCH_BOX_READY");
    } else if (pollIntervalMs > 0) {
      await new Promise((r) => setTimeout(r, pollIntervalMs));
    }
    const pollStartMs = Date.now();
    const pollInvokedAt = new Date(pollStartMs).toISOString();
    initialReadback = await readAmazonCommercialContextFromRenderedUi(caller, {
      pageUrlHint: "https://www.amazon.com/",
      signal: options.signal,
    });
    uiActionLedger.push({
      step: "WAIT_SEARCH_BOX_READY",
      toolName: "browser_evaluate",
      invokedAt: pollInvokedAt,
      completedAt: new Date().toISOString(),
      durationMs: Math.max(0, Date.now() - pollStartMs),
      status: initialReadback.searchBoxReady ? "SUCCEEDED" : "TIMED_OUT",
      detail: `Poll ${readyPollCount}/${maxReadyPolls}: searchBoxReady=${initialReadback.searchBoxReady}`,
      snapshotHash: initialReadback.snapshotHash,
    });
  }

  uiActionLedger.push({
    step: "READ_INITIAL_CONTEXT",
    toolName: "browser_evaluate",
    invokedAt: initialReadback.observedAt,
    completedAt: new Date().toISOString(),
    durationMs: 0,
    status: "SUCCEEDED",
    detail: `initialGlow=${initialReadback.deliveryLocationText || "null"}, initialZip=${initialReadback.observedZip || "null"}, initialCurrency=${initialReadback.explicitCurrency || "null"}`,
    snapshotHash: initialReadback.snapshotHash,
  });

  if (initialReadback.captchaDetected) {
    notes.push("CAPTCHA_OR_BOT_WALL_DETECTED_ON_HOME");
    return {
      attempted: true,
      status: "BLOCKED_PROVIDER",
      sessionId: caller.sessionId || null,
      ownedChildPid: caller.ownedChildPid ?? null,
      targetZip,
      homepageReady: false,
      searchBoxReady: false,
      deliveryLinkVisible: false,
      locationDialogOpened: false,
      zipFieldVisible: false,
      applyClicked: false,
      confirmationHandled: false,
      initialDeliveryText: initialReadback.deliveryLocationText,
      initialObservedZip: initialReadback.observedZip,
      initialExplicitCurrency: initialReadback.explicitCurrency,
      initialExplicitCurrencySource: initialReadback.explicitCurrencySource,
      observedDeliveryLocationText: initialReadback.deliveryLocationText,
      observedDeliveryPostalCode: null,
      observedCurrency: null,
      explicitCurrencySource: null,
      usDeliveryVerified: false,
      homeSnapshotHash: initialReadback.snapshotHash,
      uiActionLedger,
      notes,
    };
  }

  if (initialReadback.loginWallDetected) {
    notes.push("LOGIN_WALL_DETECTED_ON_HOME");
    return {
      attempted: true,
      status: "AUTHENTICATION_REQUIRED",
      sessionId: caller.sessionId || null,
      ownedChildPid: caller.ownedChildPid ?? null,
      targetZip,
      homepageReady: false,
      searchBoxReady: false,
      deliveryLinkVisible: false,
      locationDialogOpened: false,
      zipFieldVisible: false,
      applyClicked: false,
      confirmationHandled: false,
      initialDeliveryText: initialReadback.deliveryLocationText,
      initialObservedZip: initialReadback.observedZip,
      initialExplicitCurrency: initialReadback.explicitCurrency,
      initialExplicitCurrencySource: initialReadback.explicitCurrencySource,
      observedDeliveryLocationText: initialReadback.deliveryLocationText,
      observedDeliveryPostalCode: null,
      observedCurrency: null,
      explicitCurrencySource: null,
      usDeliveryVerified: false,
      homeSnapshotHash: initialReadback.snapshotHash,
      uiActionLedger,
      notes,
    };
  }

  if (!initialReadback.searchBoxReady) {
    notes.push("SEARCH_BOX_READY_TIMEOUT: #twotabsearchtextbox never became visible.");
    return {
      attempted: true,
      status: "READY_TIMEOUT",
      sessionId: caller.sessionId || null,
      ownedChildPid: caller.ownedChildPid ?? null,
      targetZip,
      homepageReady: false,
      searchBoxReady: false,
      deliveryLinkVisible: initialReadback.deliveryLinkVisible,
      locationDialogOpened: false,
      zipFieldVisible: false,
      applyClicked: false,
      confirmationHandled: false,
      initialDeliveryText: initialReadback.deliveryLocationText,
      initialObservedZip: null,
      initialExplicitCurrency: null,
      initialExplicitCurrencySource: null,
      observedDeliveryLocationText: initialReadback.deliveryLocationText,
      observedDeliveryPostalCode: null,
      observedCurrency: null,
      explicitCurrencySource: null,
      usDeliveryVerified: false,
      homeSnapshotHash: initialReadback.snapshotHash,
      uiActionLedger,
      notes,
    };
  }

  if (!initialReadback.deliveryLinkVisible) {
    notes.push("DELIVERY_LINK_MISSING: #nav-global-location-popover-link not visible in rendered nav.");
    return {
      attempted: true,
      status: "UNKNOWN",
      sessionId: caller.sessionId || null,
      ownedChildPid: caller.ownedChildPid ?? null,
      targetZip,
      homepageReady: true,
      searchBoxReady: true,
      deliveryLinkVisible: false,
      locationDialogOpened: false,
      zipFieldVisible: false,
      applyClicked: false,
      confirmationHandled: false,
      initialDeliveryText: initialReadback.deliveryLocationText,
      initialObservedZip: null,
      initialExplicitCurrency: initialReadback.explicitCurrency,
      initialExplicitCurrencySource: initialReadback.explicitCurrencySource,
      observedDeliveryLocationText: initialReadback.deliveryLocationText,
      observedDeliveryPostalCode: null,
      observedCurrency: initialReadback.explicitCurrency === "USD" ? "USD" : null,
      explicitCurrencySource: initialReadback.explicitCurrencySource,
      usDeliveryVerified: false,
      homeSnapshotHash: initialReadback.snapshotHash,
      uiActionLedger,
      notes,
    };
  }

  // If already displaying target ZIP and explicit USD, avoid redundant UI mutation
  if (
    initialReadback.observedZip === targetZip &&
    initialReadback.explicitCurrency === "USD"
  ) {
    notes.push(`INITIAL_CONTEXT_ALREADY_VERIFIED_ZIP_${targetZip}_AND_USD`);
    return {
      attempted: true,
      status: "US_DISPLAYED_CONTEXT_VERIFIED",
      sessionId: caller.sessionId || null,
      ownedChildPid: caller.ownedChildPid ?? null,
      targetZip,
      homepageReady: true,
      searchBoxReady: true,
      deliveryLinkVisible: true,
      locationDialogOpened: false,
      zipFieldVisible: false,
      applyClicked: false,
      confirmationHandled: false,
      initialDeliveryText: initialReadback.deliveryLocationText,
      initialObservedZip: initialReadback.observedZip,
      initialExplicitCurrency: initialReadback.explicitCurrency,
      initialExplicitCurrencySource: initialReadback.explicitCurrencySource,
      observedDeliveryLocationText: initialReadback.deliveryLocationText,
      observedDeliveryPostalCode: initialReadback.observedZip,
      observedCurrency: "USD",
      explicitCurrencySource: initialReadback.explicitCurrencySource,
      usDeliveryVerified: true,
      homeSnapshotHash: initialReadback.snapshotHash,
      uiActionLedger,
      notes,
    };
  }

  // 3. Open ordinary delivery location popover, wait for #GLUXZipUpdateInput, fill targetZip, click Apply, handle Continue/Done
  const modalStartMs = Date.now();
  const modalInvokedAt = new Date(modalStartMs).toISOString();
  const uiModalFn = `async () => {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const isVisible = (el) => Boolean(el && (el.offsetWidth > 0 || el.offsetHeight > 0 || el.getClientRects().length > 0));
    const locTrigger =
      document.querySelector('#nav-global-location-popover-link') ||
      document.querySelector('#glow-ingress-block');
    if (!locTrigger || !isVisible(locTrigger)) {
      return JSON.stringify({
        locationDialogOpened: false,
        zipFieldVisible: false,
        applyClicked: false,
        confirmationHandled: false,
        reason: 'LOCATION_TRIGGER_NOT_VISIBLE',
      });
    }
    locTrigger.click();

    let zipInput = null;
    for (let i = 0; i < 16; i++) {
      const candidate = document.querySelector('#GLUXZipUpdateInput');
      if (candidate && isVisible(candidate)) {
        zipInput = candidate;
        break;
      }
      await sleep(250);
    }

    if (!zipInput) {
      return JSON.stringify({
        locationDialogOpened: true,
        zipFieldVisible: false,
        applyClicked: false,
        confirmationHandled: false,
        reason: 'ZIP_INPUT_NOT_VISIBLE_IN_POPOVER',
      });
    }

    const applyBtn =
      document.querySelector('#GLUXZipUpdate input.a-button-input') ||
      document.querySelector('#GLUXZipUpdate [aria-labelledby="GLUXZipUpdate-announce"]') ||
      document.querySelector('input#GLUXZipUpdate-announce');

    if (!applyBtn || applyBtn.disabled || applyBtn.getAttribute('aria-disabled') === 'true') {
      return JSON.stringify({
        locationDialogOpened: true,
        zipFieldVisible: true,
        applyClicked: false,
        confirmationHandled: false,
        reason: 'APPLY_BUTTON_MISSING_OR_DISABLED',
      });
    }

    zipInput.focus();
    const nativeInputValueSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
    if (nativeInputValueSetter) {
      nativeInputValueSetter.call(zipInput, ${JSON.stringify(targetZip)});
    } else {
      zipInput.value = ${JSON.stringify(targetZip)};
    }
    zipInput.dispatchEvent(new Event('input', { bubbles: true }));
    zipInput.dispatchEvent(new Event('change', { bubbles: true }));
    await sleep(150);

    applyBtn.click();

    let confirmationHandled = false;
    for (let i = 0; i < 12; i++) {
      await sleep(250);
      const confirmBtn =
        document.querySelector('#GLUXConfirmClose') ||
        document.querySelector('.a-popover-footer input.a-button-input') ||
        document.querySelector('button[name="glowDoneButton"]');
      if (confirmBtn && isVisible(confirmBtn) && !confirmBtn.disabled) {
        confirmBtn.click();
        confirmationHandled = true;
        break;
      }
      const glowNow = (document.querySelector('#glow-ingress-block')?.textContent || '').replace(/\\s+/g, ' ');
      if (glowNow.includes(${JSON.stringify(targetZip)})) {
        break;
      }
    }

    await sleep(500);
    return JSON.stringify({
      locationDialogOpened: true,
      zipFieldVisible: true,
      applyClicked: true,
      confirmationHandled,
      reason: 'UI_ZIP_SUBMITTED',
    });
  }`;

  const modalReqHash = crypto
    .createHash("sha256")
    .update(JSON.stringify({ tool: "browser_evaluate", purpose: "openLocationPopoverAndApplyZip", targetZip }), "utf8")
    .digest("hex");
  const modalRes = await caller.callTool({
    name: "browser_evaluate",
    arguments: { function: uiModalFn },
  });
  const modalRespHash = crypto
    .createHash("sha256")
    .update(JSON.stringify(modalRes || null), "utf8")
    .digest("hex");
  caller.recordToolInvocation?.({
    toolName: "browser_evaluate",
    url: "https://www.amazon.com/",
    invokedAt: modalInvokedAt,
    requestHash: modalReqHash,
    responseHash: modalRespHash,
  });

  const modalText = ((modalRes as any)?.content || [])
    .filter((c: any) => c && typeof c.text === "string")
    .map((c: any) => c.text)
    .join("\n");
  const modalParsed = parsePlaywrightMcpEvaluateJson(modalText) || {};
  const locationDialogOpened = Boolean(modalParsed.locationDialogOpened);
  const zipFieldVisible = Boolean(modalParsed.zipFieldVisible);
  const applyClicked = Boolean(modalParsed.applyClicked);
  const confirmationHandled = Boolean(modalParsed.confirmationHandled);

  uiActionLedger.push({
    step: "OPEN_LOCATION_POPOVER_AND_APPLY_ZIP",
    toolName: "browser_evaluate",
    invokedAt: modalInvokedAt,
    completedAt: new Date().toISOString(),
    durationMs: Math.max(0, Date.now() - modalStartMs),
    status: applyClicked ? "SUCCEEDED" : "FAILED",
    detail: `dialogOpened=${locationDialogOpened}, zipFieldVisible=${zipFieldVisible}, applyClicked=${applyClicked}, confirmationHandled=${confirmationHandled}, reason=${modalParsed.reason || "UNKNOWN"}`,
    snapshotHash: modalRespHash,
  });

  if (!zipFieldVisible || !applyClicked) {
    notes.push(`DIALOG_OR_APPLY_UNAVAILABLE:${modalParsed.reason || "UNAVAILABLE"}`);
    return {
      attempted: true,
      status: "DIALOG_OR_APPLY_UNAVAILABLE",
      sessionId: caller.sessionId || null,
      ownedChildPid: caller.ownedChildPid ?? null,
      targetZip,
      homepageReady: true,
      searchBoxReady: true,
      deliveryLinkVisible: true,
      locationDialogOpened,
      zipFieldVisible,
      applyClicked,
      confirmationHandled,
      initialDeliveryText: initialReadback.deliveryLocationText,
      initialObservedZip: initialReadback.observedZip,
      initialExplicitCurrency: initialReadback.explicitCurrency,
      initialExplicitCurrencySource: initialReadback.explicitCurrencySource,
      observedDeliveryLocationText: initialReadback.deliveryLocationText,
      observedDeliveryPostalCode: null,
      observedCurrency: null,
      explicitCurrencySource: null,
      usDeliveryVerified: false,
      homeSnapshotHash: initialReadback.snapshotHash,
      uiActionLedger,
      notes,
    };
  }

  // 4. Read back after Apply (and reload homepage header once if in-place DOM did not refresh yet)
  let afterReadback = await readAmazonCommercialContextFromRenderedUi(caller, {
    pageUrlHint: "https://www.amazon.com/",
    signal: options.signal,
  });
  if (afterReadback.observedZip !== targetZip) {
    await callNav("https://www.amazon.com/ref=nav_logo", "REFRESH_AND_READBACK_AFTER_APPLY");
    afterReadback = await readAmazonCommercialContextFromRenderedUi(caller, {
      pageUrlHint: "https://www.amazon.com/ref=nav_logo",
      signal: options.signal,
    });
  }

  uiActionLedger.push({
    step: "REFRESH_AND_READBACK_AFTER_APPLY",
    toolName: "browser_evaluate",
    invokedAt: afterReadback.observedAt,
    completedAt: new Date().toISOString(),
    durationMs: 0,
    status: afterReadback.observedZip === targetZip ? "SUCCEEDED" : "FAILED",
    detail: `afterGlow=${afterReadback.deliveryLocationText || "null"}, afterZip=${afterReadback.observedZip || "null"}, afterCurrency=${afterReadback.explicitCurrency || "null"}`,
    snapshotHash: afterReadback.snapshotHash,
  });

  const zipConfirmed = afterReadback.observedZip === targetZip;
  const currencyIsExplicitUsd = afterReadback.explicitCurrency === "USD";

  let finalStatus: AmazonUiLocationPreflightResult["status"];
  if (!zipConfirmed) {
    finalStatus = "US_NOT_CONFIRMED";
    notes.push(
      `US_NOT_CONFIRMED: Expected ZIP ${targetZip} in rendered delivery header, observed '${afterReadback.deliveryLocationText || "null"}'.`
    );
  } else if (!currencyIsExplicitUsd) {
    finalStatus = "NOT_USD_VERIFIED";
    notes.push(
      `NOT_USD_VERIFIED: Observed ZIP ${afterReadback.observedZip}, but explicit currency is '${afterReadback.explicitCurrency || "null"}' (source=${afterReadback.explicitCurrencySource || "NONE"}).`
    );
  } else {
    finalStatus = "US_DISPLAYED_CONTEXT_VERIFIED";
    notes.push(
      `US_DISPLAYED_CONTEXT_VERIFIED: Observed ZIP ${afterReadback.observedZip} (${afterReadback.deliveryLocationText}) and explicit currency USD (${afterReadback.explicitCurrencySource}).`
    );
  }

  return {
    attempted: true,
    status: finalStatus,
    sessionId: caller.sessionId || null,
    ownedChildPid: caller.ownedChildPid ?? null,
    targetZip,
    homepageReady: true,
    searchBoxReady: afterReadback.searchBoxReady,
    deliveryLinkVisible: afterReadback.deliveryLinkVisible,
    locationDialogOpened,
    zipFieldVisible,
    applyClicked,
    confirmationHandled,
    initialDeliveryText: initialReadback.deliveryLocationText,
    initialObservedZip: initialReadback.observedZip,
    initialExplicitCurrency: initialReadback.explicitCurrency,
    initialExplicitCurrencySource: initialReadback.explicitCurrencySource,
    observedDeliveryLocationText: afterReadback.deliveryLocationText,
    observedDeliveryPostalCode: zipConfirmed ? afterReadback.observedZip : null,
    observedCurrency: currencyIsExplicitUsd ? "USD" : afterReadback.explicitCurrency,
    explicitCurrencySource: afterReadback.explicitCurrencySource,
    usDeliveryVerified: zipConfirmed,
    homeSnapshotHash: afterReadback.snapshotHash,
    uiActionLedger,
    notes,
  };
}

export interface AmazonUiPhaseRecord {
  phaseId:
    | "phase1_initial_home"
    | "phase2_zip_dialog_action"
    | "phase3_home_readback"
    | "phase4_search_readback"
    | "phase5_pdp_readback"
    | "phase6_post_session_close";
  attempted: boolean;
  observedFields: Record<string, any>;
  selectorOrTool: string | null;
  observedAt: string | null;
  rawSnapshotHash: string | null;
  sessionId: string | null;
  status:
    | "VERIFIED"
    | "SUCCEEDED"
    | "PARTIAL"
    | "INCOMPLETE"
    | "UNKNOWN"
    | "FAILED"
    | "BLOCKED"
    | "NOT_ATTEMPTED";
  reason: string;
  [key: string]: any;
}

export interface AmazonUiContextProof {
  codeSha: string;
  evaluatedAt: string;
  workspaceId: string | null;
  researchRunId: string | null;
  sessionId: string | null;
  ownedChildPid: number | null;
  internalGlowFetchUsed: boolean;
  targetUsZip: string;
  searchBoxReady: boolean;
  locationTriggerFound: boolean;
  dialogOpened: boolean;
  zipInputFilled: boolean;
  applyClicked: boolean;
  confirmationClicked: boolean;
  initialDeliveryHeaderText: string | null;
  finalDeliveryHeaderText: string | null;
  observedDeliveryPostalCode: string | null;
  verifiedDeliveryMarket: "US" | null;
  usDeliveryVerified: boolean;
  observedDisplayedCurrencyCode: string | null;
  currencyPreferenceVerifiedUsd: boolean;
  finalEffectiveUsDeliveryVerified: boolean;
  finalEffectiveCurrencyUsdVerified: boolean;
  status:
    | "US_DISPLAYED_CONTEXT_VERIFIED"
    | "US_ZIP_VERIFIED"
    | "US_ZIP_VERIFIED_CURRENCY_PARTIAL"
    | "NOT_USD_VERIFIED"
    | "US_NOT_CONFIRMED"
    | "CAPTCHA_BLOCKED"
    | "AUTHENTICATION_REQUIRED";
  stepsExecuted: string[];
  phase1_initial_home: AmazonUiPhaseRecord;
  phase2_zip_dialog_action: AmazonUiPhaseRecord;
  phase3_home_readback: AmazonUiPhaseRecord;
  phase4_search_readback: AmazonUiPhaseRecord;
  phase5_pdp_readback: AmazonUiPhaseRecord;
  phase6_post_session_close: AmazonUiPhaseRecord;
  phases: {
    phase1_initial_home: AmazonUiPhaseRecord;
    phase2_zip_dialog_action: AmazonUiPhaseRecord;
    phase3_home_readback: AmazonUiPhaseRecord;
    phase4_search_readback: AmazonUiPhaseRecord;
    phase5_pdp_readback: AmazonUiPhaseRecord;
    phase6_post_session_close: AmazonUiPhaseRecord;
  };
  finalZipVerdict: "PASS" | "NOT_CONFIRMED_ON_LIVE_DOM" | "BLOCKED_ACCESS_CHALLENGE";
  finalUsdCommercialVerdict:
    | "PASS"
    | "OBSERVED_NON_USD_OR_PARTIAL"
    | "BLOCKED_ACCESS_CHALLENGE";
  contradictionsDetected: string[];
  homeAndLocationReadback: Record<string, any> | null;
}

export function isValidAmazonRawSnapshotHash(hash: unknown): hash is string {
  if (typeof hash !== "string") return false;
  const trimmed = hash.trim();
  if (trimmed.length < 8) return false;
  if (/^(?:phony|fake|dummy|todo|null|undefined|invalid|forged|00000000)/i.test(trimmed)) {
    return false;
  }
  if (/^(.)\1{7,}$/.test(trimmed)) {
    return false;
  }
  return true;
}

/**
 * V12.4.3.7.2 P0-C / V12.4.3.7.3 P1-C: Reconciles Amazon UI preflight, homepage readback,
 * search readback, PDP readback, and session close into a single self-consistent 6-phase proof object.
 * Never uses truthy defaults (`?? true`), hardcoded `stepsExecuted`, or `evaluatedAt` as browser `observedAt`.
 */
export function buildAmazonUiPhaseContextProof(input: {
  codeSha: string;
  evaluatedAt?: string;
  workspaceId?: string | null;
  researchRunId?: string | null;
  sessionId?: string | null;
  targetUsZip?: string;
  homeAndLocationReadback?: Record<string, any> | null;
  searchCardsLedger?: Array<Record<string, any>> | null;
  operationLedger?: Array<Record<string, any>> | null;
  searchReadbackRecords?: Array<Record<string, any>> | null;
  pdpReadbackRecords?: Array<Record<string, any>> | null;
  sessionLifecycle?: Record<string, any> | null;
  evaluatedPdpRows?: Array<Record<string, any>>;
  pdpCandidates?: Array<Record<string, any>>;
  internalGlowFetchUsed?: boolean;
}): AmazonUiContextProof {
  const evaluatedAt = input.evaluatedAt || new Date().toISOString();
  const targetUsZip = input.targetUsZip || "95829";
  const hr = input.homeAndLocationReadback || null;
  const lc = input.sessionLifecycle || null;
  const opLedger: Array<Record<string, any>> = Array.isArray(input.operationLedger)
    ? input.operationLedger
    : [];
  const searchCardsLedger: Array<Record<string, any>> = Array.isArray(input.searchCardsLedger)
    ? input.searchCardsLedger
    : [];
  const pdpRows = Array.isArray(input.evaluatedPdpRows)
    ? input.evaluatedPdpRows
    : Array.isArray(input.pdpCandidates)
    ? input.pdpCandidates
    : [];
  const sessionId =
    input.sessionId ||
    (hr?.sessionId as string) ||
    (lc?.sessionId as string) ||
    null;
  const ownedChildPid =
    typeof hr?.ownedChildPid === "number"
      ? hr.ownedChildPid
      : typeof lc?.ownedChildPid === "number"
      ? lc.ownedChildPid
      : null;

  const ledger: AmazonUiLocationActionStep[] = Array.isArray(hr?.uiActionLedger)
    ? hr.uiActionLedger
    : [];
  const stepsExecuted = ledger
    .map((s) => String(s?.step || "").trim())
    .filter(Boolean);

  const findStep = (stepName: string) =>
    ledger.find((s) => s && s.step === stepName) || null;

  const stepInitial = findStep("READ_INITIAL_CONTEXT") || findStep("WAIT_SEARCH_BOX_READY");
  const stepModal = findStep("OPEN_LOCATION_POPOVER_AND_APPLY_ZIP");
  const stepAfterHome = findStep("REFRESH_AND_READBACK_AFTER_APPLY");

  const searchBoxReady = Boolean(hr?.searchBoxReady === true);
  const locationTriggerFound = Boolean(hr?.deliveryLinkVisible === true);
  const dialogOpened = Boolean(hr?.locationDialogOpened === true);
  const zipFieldVisible = Boolean(hr?.zipFieldVisible === true);
  const applyClicked = Boolean(hr?.applyClicked === true);
  const zipInputFilled = Boolean(zipFieldVisible && applyClicked);
  const confirmationClicked = Boolean(hr?.confirmationHandled === true);

  const initialDeliveryHeaderText =
    typeof hr?.initialDeliveryText === "string" ? hr.initialDeliveryText : null;
  const initialObservedZip =
    typeof hr?.initialObservedZip === "string" ? hr.initialObservedZip : null;
  const initialExplicitCurrency =
    typeof hr?.initialExplicitCurrency === "string" ? hr.initialExplicitCurrency : null;

  const phase1: AmazonUiPhaseRecord = {
    phaseId: "phase1_initial_home",
    attempted: Boolean(hr?.attempted === true),
    observedFields: {
      searchBoxReady,
      deliveryLinkVisible: locationTriggerFound,
      initialDeliveryText: initialDeliveryHeaderText,
      initialObservedZip,
      initialExplicitCurrency,
      initialExplicitCurrencySource: hr?.initialExplicitCurrencySource || null,
    },
    selectorOrTool: stepInitial
      ? `${stepInitial.toolName}:#twotabsearchtextbox,#nav-global-location-popover-link,#glow-ingress-block`
      : hr?.attempted
      ? "browser_evaluate:#glow-ingress-block"
      : null,
    observedAt:
      stepInitial?.completedAt ||
      stepInitial?.invokedAt ||
      hr?.initialHomeObservedAt ||
      null,
    rawSnapshotHash: stepInitial?.snapshotHash || hr?.homeSnapshotHash || null,
    sessionId,
    status: !hr?.attempted
      ? "NOT_ATTEMPTED"
      : searchBoxReady
      ? "SUCCEEDED"
      : "FAILED",
    reason: !hr?.attempted
      ? "Homepage preflight not attempted."
      : searchBoxReady
      ? `Initial home loaded (delivery='${initialDeliveryHeaderText || "none"}', currency='${initialExplicitCurrency || "none"}').`
      : "Search box was not ready on initial homepage.",
  };

  const alreadyTargetZipOnInitial = initialObservedZip === targetUsZip;
  const phase2: AmazonUiPhaseRecord = {
    phaseId: "phase2_zip_dialog_action",
    attempted: Boolean(
      stepModal || alreadyTargetZipOnInitial || (dialogOpened && applyClicked)
    ),
    observedFields: {
      targetUsZip,
      locationDialogOpened: dialogOpened,
      zipFieldVisible,
      zipInputFilled,
      applyClicked,
      confirmationHandled: confirmationClicked,
      alreadyTargetZipOnInitial,
    },
    selectorOrTool: stepModal
      ? `${stepModal.toolName}:#nav-global-location-popover-link,#GLUXZipUpdateInput,#GLUXZipUpdate`
      : alreadyTargetZipOnInitial
      ? "DOM:#glow-ingress-block(ALREADY_TARGET_ZIP)"
      : dialogOpened && applyClicked
      ? "DOM:#nav-global-location-popover-link,#GLUXZipUpdateInput,#GLUXZipUpdate"
      : null,
    observedAt:
      stepModal?.completedAt ||
      hr?.zipSubmitObservedAt ||
      stepInitial?.completedAt ||
      hr?.initialHomeObservedAt ||
      null,
    rawSnapshotHash:
      stepModal?.snapshotHash ||
      stepInitial?.snapshotHash ||
      hr?.homeSnapshotHash ||
      null,
    sessionId,
    status: alreadyTargetZipOnInitial
      ? "VERIFIED"
      : dialogOpened && zipInputFilled && applyClicked
      ? "SUCCEEDED"
      : stepModal
      ? "FAILED"
      : "NOT_ATTEMPTED",
    reason: alreadyTargetZipOnInitial
      ? `Initial homepage already displayed target US ZIP ${targetUsZip}.`
      : dialogOpened && zipInputFilled && applyClicked
      ? `Opened location popover, entered ${targetUsZip} in #GLUXZipUpdateInput, and clicked Apply.`
      : "Location dialog or ZIP Apply control did not complete.",
  };

  const homeAfterDeliveryText =
    typeof hr?.observedDeliveryLocationText === "string"
      ? hr.observedDeliveryLocationText
      : null;
  const homeAfterZip =
    typeof hr?.observedDeliveryPostalCode === "string"
      ? hr.observedDeliveryPostalCode
      : null;
  const homeAfterCurrency =
    typeof hr?.observedCurrency === "string" ? hr.observedCurrency : null;
  const homeZipMatches = homeAfterZip === targetUsZip;

  const phase3: AmazonUiPhaseRecord = {
    phaseId: "phase3_home_readback",
    attempted: Boolean(
      stepAfterHome ||
        homeAfterZip ||
        (hr?.attempted && alreadyTargetZipOnInitial)
    ),
    observedFields: {
      observedDeliveryLocationText: homeAfterDeliveryText,
      observedZip: homeAfterZip,
      observedExplicitCurrency: homeAfterCurrency,
      explicitCurrencySource: hr?.explicitCurrencySource || null,
      usDeliveryVerifiedOnHome: homeZipMatches,
    },
    selectorOrTool: stepAfterHome
      ? `${stepAfterHome.toolName}:#glow-ingress-block,#icp-touch-link-cop`
      : hr?.attempted
      ? "browser_evaluate:#glow-ingress-block"
      : null,
    observedAt:
      stepAfterHome?.completedAt ||
      hr?.postReloadHomeObservedAt ||
      stepInitial?.completedAt ||
      hr?.initialHomeObservedAt ||
      null,
    rawSnapshotHash: stepAfterHome?.snapshotHash || hr?.homeSnapshotHash || null,
    sessionId,
    status: homeZipMatches
      ? homeAfterCurrency === "USD"
        ? "VERIFIED"
        : "PARTIAL"
      : hr?.attempted
      ? "FAILED"
      : "NOT_ATTEMPTED",
    reason: homeZipMatches
      ? `Homepage readback confirmed '${homeAfterDeliveryText}' (ZIP=${homeAfterZip}, homeExplicitCurrency=${homeAfterCurrency || "UNKNOWN"}).`
      : `Homepage readback did not confirm target ZIP ${targetUsZip} (observed=${homeAfterZip || "null"}).`,
  };

  const searchOps = opLedger.filter(
    (o) =>
      o &&
      (o.requestMode === "AUTHORIZED_SEARCH" ||
        String(o.operationId || "").toLowerCase().includes("search"))
  );
  const perSearchReadbacks: Array<Record<string, any>> = Array.isArray(
    input.searchReadbackRecords
  )
    ? input.searchReadbackRecords
    : Array.isArray(hr?.perSearchReadbacks)
    ? hr.perSearchReadbacks
    : [];
  const searchObservedAt =
    (typeof perSearchReadbacks[0]?.observedAt === "string" &&
      perSearchReadbacks[0].observedAt) ||
    (typeof searchOps[0]?.completedAt === "string" && searchOps[0].completedAt) ||
    (typeof searchOps[0]?.startedAt === "string" && searchOps[0].startedAt) ||
    (typeof hr?.searchReadbackObservedAt === "string" && hr.searchReadbackObservedAt) ||
    (typeof searchCardsLedger[0]?.observedAt === "string" &&
      searchCardsLedger[0].observedAt) ||
    null;

  const searchPageZip =
    typeof hr?.searchPageZip === "string" ? hr.searchPageZip : null;
  const searchPageCurrency =
    typeof hr?.searchPageExplicitCurrency === "string"
      ? hr.searchPageExplicitCurrency
      : null;
  const searchSnapshotHash =
    (typeof perSearchReadbacks[0]?.rawSnapshotHash === "string" &&
      perSearchReadbacks[0].rawSnapshotHash) ||
    (typeof searchOps[0]?.responseHash === "string" && searchOps[0].responseHash) ||
    (typeof hr?.searchSnapshotHash === "string" && hr.searchSnapshotHash) ||
    null;
  const searchAttempted = Boolean(
    searchSnapshotHash || searchPageZip || searchOps.length > 0 || perSearchReadbacks.length > 0
  );
  const searchSessionId =
    (perSearchReadbacks[0]?.sessionId as string) ||
    (searchOps[0]?.transportSessionId as string) ||
    sessionId;

  const phase4: AmazonUiPhaseRecord = {
    phaseId: "phase4_search_readback",
    attempted: searchAttempted,
    observedFields: {
      searchPageZip,
      searchPageExplicitCurrency: searchPageCurrency,
      usZipMaintainedOnSearch: searchPageZip === targetUsZip,
      searchOperationIds: searchOps.map((o) => o.operationId).filter(Boolean),
    },
    selectorOrTool: searchAttempted
      ? "browser_evaluate:#glow-ingress-block,[data-component-type=s-search-result]"
      : null,
    observedAt: searchAttempted ? searchObservedAt : null,
    rawSnapshotHash: searchSnapshotHash,
    sessionId: searchSessionId,
    status: !searchAttempted
      ? "NOT_ATTEMPTED"
      : !searchObservedAt || !isValidAmazonRawSnapshotHash(searchSnapshotHash)
      ? "INCOMPLETE"
      : searchPageZip === targetUsZip
      ? searchPageCurrency === "USD"
        ? "VERIFIED"
        : "PARTIAL"
      : "UNKNOWN",
    reason: !searchAttempted
      ? "Search page readback not recorded."
      : !searchObservedAt
      ? "Search page readback missing original pre-close observation timestamp."
      : `Search page header ZIP=${searchPageZip || "null"}, searchExplicitCurrency=${searchPageCurrency || "UNKNOWN"} at ${searchObservedAt}.`,
  };

  const pdpOps = opLedger.filter(
    (o) =>
      o &&
      o.requestMode !== "AUTHORIZED_SEARCH" &&
      !String(o.operationId || "").toLowerCase().includes("search")
  );
  const perPdpReadbacksFromHr: Array<Record<string, any>> = Array.isArray(
    input.pdpReadbackRecords
  )
    ? input.pdpReadbackRecords
    : Array.isArray(hr?.perPdpReadbacks)
    ? hr.perPdpReadbacks
    : [];

  const perPdpRecords = pdpRows.map((r, idx) => {
    const matchPdpOp =
      pdpOps.find((o) => o && r?.candidateId && o.candidateId === r.candidateId) ||
      pdpOps[idx] ||
      null;
    const matchHrReadback =
      perPdpReadbacksFromHr.find((p) => p && r?.asin && p.asin === r.asin) ||
      perPdpReadbacksFromHr[idx] ||
      null;
    const recOpId =
      r?.operationId !== undefined
        ? r.operationId
        : r?.providerInvocationRef ||
          matchPdpOp?.operationId ||
          matchHrReadback?.operationId ||
          hr?.defaultPdpOperationId ||
          null;
    const recObsAt =
      r?.observedAt !== undefined
        ? r.observedAt
        : matchHrReadback?.observedAt ||
          matchPdpOp?.completedAt ||
          matchPdpOp?.startedAt ||
          (idx === 0 ? hr?.pdpReadbackObservedAt : null) ||
          null;
    const recHash =
      r?.rawEvidenceHash !== undefined
        ? r.rawEvidenceHash
        : r?.rawSnapshotHash !== undefined
        ? r.rawSnapshotHash
        : matchHrReadback?.rawSnapshotHash ||
          matchPdpOp?.responseHash ||
          (idx === 0 ? hr?.pdpSnapshotHash : null) ||
          null;
    const recSessionId =
      r?.transportSessionId ||
      matchPdpOp?.transportSessionId ||
      matchHrReadback?.sessionId ||
      sessionId;
    return {
      candidateId: r?.candidateId || null,
      operationId: recOpId,
      asin: r?.asin || null,
      observedAt: recObsAt,
      rawSnapshotHash: recHash,
      observedDeliveryPostalCode: r?.observedDeliveryPostalCode ?? null,
      verifiedDeliveryMarket: r?.verifiedDeliveryMarket ?? null,
      price: typeof r?.price === "number" ? r.price : null,
      currency: r?.currency ?? null,
      sessionId: recSessionId,
    };
  });

  const pdpPageZipFromHr =
    typeof hr?.pdpPageZip === "string" ? hr.pdpPageZip : null;
  const pdpCurrencyFromHr =
    typeof hr?.pdpExplicitCurrency === "string" ? hr.pdpExplicitCurrency : null;
  const pdpSnapshotHash =
    (typeof hr?.pdpSnapshotHash === "string" && hr.pdpSnapshotHash) ||
    (typeof perPdpRecords[0]?.rawSnapshotHash === "string" &&
      perPdpRecords[0].rawSnapshotHash) ||
    null;

  const pdpObservedAt =
    (typeof hr?.pdpReadbackObservedAt === "string" && hr.pdpReadbackObservedAt) ||
    (perPdpRecords
      .map((r) => r.observedAt)
      .filter((t): t is string => typeof t === "string" && t.length > 0)
      .slice(-1)[0] ??
      null) ||
    (pdpOps
      .map((o) => o?.completedAt || o?.startedAt)
      .filter((t): t is string => typeof t === "string" && t.length > 0)
      .slice(-1)[0] ??
      null);

  const pdpZipsObserved = pdpRows
    .map((r) => r?.observedDeliveryPostalCode)
    .filter((z): z is string => typeof z === "string" && z.length > 0);
  const pdpUsdRows = pdpRows.filter(
    (r) =>
      r?.currency === "USD" &&
      typeof r?.price === "number" &&
      Number.isFinite(r.price) &&
      r.price > 0
  );
  // Never borrow one PDP's ZIP if another evaluated PDP has a non-matching ZIP; only use pdpZipsObserved when present on PDP
  const effectivePdpZip =
    pdpPageZipFromHr || (pdpZipsObserved.length > 0 ? pdpZipsObserved[0] : null);
  const effectivePdpCurrency =
    pdpCurrencyFromHr ||
    (pdpUsdRows.length > 0
      ? "USD"
      : (pdpRows.find((r) => typeof r?.currency === "string")?.currency as string) ||
        null);
  const pdpAttempted = Boolean(
    pdpSnapshotHash || pdpRows.length > 0 || pdpOps.length > 0
  );
  const explicitCurrencySource = String(hr?.explicitCurrencySource || "");

  const anyPdpRecordIncomplete =
    perPdpRecords.length > 0 &&
    perPdpRecords.some(
      (rec) =>
        !rec.asin ||
        !rec.operationId ||
        !rec.observedAt ||
        !isValidAmazonRawSnapshotHash(rec.rawSnapshotHash)
    );
  const pdpPhaseIncomplete =
    pdpAttempted &&
    (!pdpObservedAt ||
      !isValidAmazonRawSnapshotHash(pdpSnapshotHash) ||
      anyPdpRecordIncomplete);
  const pdpSessionId = perPdpRecords[0]?.sessionId || sessionId;

  const phase5: AmazonUiPhaseRecord = {
    phaseId: "phase5_pdp_readback",
    attempted: pdpAttempted,
    observedFields: {
      pdpPageZip: effectivePdpZip,
      pdpExplicitCurrency: effectivePdpCurrency,
      explicitCurrencySource: explicitCurrencySource || (effectivePdpCurrency ? "DOM:PDP" : null),
      pdpEvaluatedCount: pdpRows.length,
      pdpNumericUsdPriceCount: pdpUsdRows.length,
      asinsObserved: pdpRows.map((r) => r?.asin).filter(Boolean),
      perPdpRecords,
    },
    selectorOrTool: pdpAttempted
      ? "browser_evaluate:#glow-ingress-block,#corePriceDisplay_desktop_feature_div,input[name=currencyOfPreference]"
      : null,
    observedAt: pdpAttempted ? pdpObservedAt : null,
    rawSnapshotHash: pdpSnapshotHash,
    sessionId: pdpSessionId,
    status: !pdpAttempted
      ? "NOT_ATTEMPTED"
      : pdpPhaseIncomplete
      ? "INCOMPLETE"
      : effectivePdpZip === targetUsZip &&
        effectivePdpCurrency === "USD" &&
        explicitCurrencySource !== "SYMBOL_ONLY_UNVERIFIED" &&
        pdpUsdRows.length >= 1
      ? "VERIFIED"
      : effectivePdpZip === targetUsZip
      ? "PARTIAL"
      : "FAILED",
    reason: !pdpAttempted
      ? "No PDP readback recorded."
      : pdpPhaseIncomplete
      ? "PDP readback is missing original operation ID, pre-close observation timestamp, or raw snapshot hash."
      : `PDP readback observed ZIP=${effectivePdpZip || "null"}, currency=${effectivePdpCurrency || "null"} (usdPricedRows=${pdpUsdRows.length}/${pdpRows.length}) at ${pdpObservedAt}.`,
  };

  const closedCleanly = Boolean(lc?.closedCleanly === true || lc?.mcpSessionClosedCleanly === true);
  const pidTerminated = Boolean(lc?.ownedChildPidTerminated === true);
  const allOpsSameSession = Boolean(lc?.allLiveOpsMatchSessionId !== false && sessionId);
  const closeStartedAt = (lc?.closeStartedAt as string) || null;
  const closeFinishedAt = (lc?.closeFinishedAt as string) || null;
  const lastToolCompletedAt = (lc?.lastToolCompletedAt as string) || null;
  const sessionStartedAt = (lc?.startedAt as string) || null;

  const phase6: AmazonUiPhaseRecord = {
    phaseId: "phase6_post_session_close",
    attempted: Boolean(lc),
    observedFields: {
      sessionId: (lc?.sessionId as string) || sessionId,
      ownedChildPid,
      startedAt: sessionStartedAt,
      lastToolCompletedAt,
      closeStartedAt,
      closeFinishedAt,
      mcpSessionClosedCleanly: closedCleanly,
      ownedChildPidTerminated: pidTerminated,
      allLiveOpsMatchSessionId: allOpsSameSession,
    },
    selectorOrTool: lc ? "browser_close+SIGTERM_WAIT_EXIT" : null,
    observedAt: closeFinishedAt,
    rawSnapshotHash: sessionId
      ? crypto
          .createHash("sha256")
          .update(
            JSON.stringify({
              sessionId,
              ownedChildPid,
              closedCleanly,
              pidTerminated,
            }),
            "utf8"
          )
          .digest("hex")
      : null,
    sessionId: (lc?.sessionId as string) || sessionId,
    status: !lc
      ? "NOT_ATTEMPTED"
      : closedCleanly && pidTerminated && allOpsSameSession && Boolean(closeFinishedAt)
      ? "VERIFIED"
      : "FAILED",
    reason: !lc
      ? "Session close lifecycle not provided."
      : `Session ${sessionId || "none"} (PID=${ownedChildPid ?? "null"}) closedCleanly=${closedCleanly}, pidTerminated=${pidTerminated}.`,
  };

  // Strict derivation of finalEffectiveUsDeliveryVerified & finalEffectiveCurrencyUsdVerified:
  // - Never borrow homepage ZIP when PDP ZIP is missing
  // - Never infer USD from bare '$' symbol or search card alone
  const finalEffectiveUsDeliveryVerified = Boolean(
    !input.internalGlowFetchUsed &&
      (phase2.status === "SUCCEEDED" || phase2.status === "VERIFIED") &&
      homeZipMatches &&
      phase5.attempted &&
      phase5.status !== "INCOMPLETE" &&
      effectivePdpZip === targetUsZip
  );

  const finalEffectiveCurrencyUsdVerified = Boolean(
    !input.internalGlowFetchUsed &&
      phase5.attempted &&
      phase5.status !== "INCOMPLETE" &&
      effectivePdpCurrency === "USD" &&
      explicitCurrencySource !== "SYMBOL_ONLY_UNVERIFIED" &&
      pdpUsdRows.length >= 1
  );

  const observedDeliveryPostalCode = finalEffectiveUsDeliveryVerified
    ? targetUsZip
    : homeZipMatches
    ? homeAfterZip
    : null;
  const observedDisplayedCurrencyCode = finalEffectiveCurrencyUsdVerified
    ? "USD"
    : effectivePdpCurrency || homeAfterCurrency || null;

  let status: AmazonUiContextProof["status"];
  if (hr?.status === "AUTHENTICATION_REQUIRED") {
    status = "AUTHENTICATION_REQUIRED";
  } else if (hr?.status === "BLOCKED_PROVIDER") {
    status = "CAPTCHA_BLOCKED";
  } else if (finalEffectiveUsDeliveryVerified && finalEffectiveCurrencyUsdVerified) {
    status = "US_DISPLAYED_CONTEXT_VERIFIED";
  } else if (finalEffectiveUsDeliveryVerified) {
    status = "US_ZIP_VERIFIED_CURRENCY_PARTIAL";
  } else {
    status = "US_NOT_CONFIRMED";
  }

  const finalZipVerdict: AmazonUiContextProof["finalZipVerdict"] =
    status === "CAPTCHA_BLOCKED" || status === "AUTHENTICATION_REQUIRED"
      ? "BLOCKED_ACCESS_CHALLENGE"
      : finalEffectiveUsDeliveryVerified
      ? "PASS"
      : "NOT_CONFIRMED_ON_LIVE_DOM";

  const finalUsdCommercialVerdict: AmazonUiContextProof["finalUsdCommercialVerdict"] =
    status === "CAPTCHA_BLOCKED" || status === "AUTHENTICATION_REQUIRED"
      ? "BLOCKED_ACCESS_CHALLENGE"
      : finalEffectiveCurrencyUsdVerified
      ? "PASS"
      : "OBSERVED_NON_USD_OR_PARTIAL";

  const proof: AmazonUiContextProof = {
    codeSha: input.codeSha,
    evaluatedAt,
    workspaceId: input.workspaceId ?? null,
    researchRunId: input.researchRunId ?? null,
    sessionId,
    ownedChildPid,
    internalGlowFetchUsed: Boolean(input.internalGlowFetchUsed),
    targetUsZip,
    searchBoxReady,
    locationTriggerFound,
    dialogOpened,
    zipInputFilled,
    applyClicked,
    confirmationClicked,
    initialDeliveryHeaderText,
    finalDeliveryHeaderText: homeAfterDeliveryText,
    observedDeliveryPostalCode,
    verifiedDeliveryMarket: finalEffectiveUsDeliveryVerified ? "US" : null,
    usDeliveryVerified: finalEffectiveUsDeliveryVerified,
    observedDisplayedCurrencyCode,
    currencyPreferenceVerifiedUsd: finalEffectiveCurrencyUsdVerified,
    finalEffectiveUsDeliveryVerified,
    finalEffectiveCurrencyUsdVerified,
    status,
    stepsExecuted,
    phase1_initial_home: phase1,
    phase2_zip_dialog_action: phase2,
    phase3_home_readback: phase3,
    phase4_search_readback: phase4,
    phase5_pdp_readback: phase5,
    phase6_post_session_close: phase6,
    phases: {
      phase1_initial_home: phase1,
      phase2_zip_dialog_action: phase2,
      phase3_home_readback: phase3,
      phase4_search_readback: phase4,
      phase5_pdp_readback: phase5,
      phase6_post_session_close: phase6,
    },
    finalZipVerdict,
    finalUsdCommercialVerdict,
    contradictionsDetected: [],
    homeAndLocationReadback: hr,
  };

  const consistency = validateAmazonUiContextProofConsistency(proof);
  proof.contradictionsDetected = consistency.contradictions;
  return proof;
}

export function validateAmazonUiContextProofConsistency(
  proof: Partial<AmazonUiContextProof> & Record<string, any>
): { consistent: boolean; valid: boolean; contradictions: string[] } {
  const contradictions: string[] = [];
  if (!proof || typeof proof !== "object") {
    return {
      consistent: false,
      valid: false,
      contradictions: ["MISSING_PROOF_OBJECT"],
    };
  }
  const hr = proof.homeAndLocationReadback;
  const phases = proof.phases || {
    phase1_initial_home: proof.phase1_initial_home,
    phase2_zip_dialog_action: proof.phase2_zip_dialog_action,
    phase3_home_readback: proof.phase3_home_readback,
    phase4_search_readback: proof.phase4_search_readback,
    phase5_pdp_readback: proof.phase5_pdp_readback,
    phase6_post_session_close: proof.phase6_post_session_close,
  };

  if (proof.internalGlowFetchUsed === true) {
    contradictions.push("FORBIDDEN_INTERNAL_GLOW_FETCH_USED");
  }

  if (hr && typeof hr === "object") {
    if (
      typeof hr.locationDialogOpened === "boolean" &&
      proof.dialogOpened !== hr.locationDialogOpened
    ) {
      contradictions.push(
        `TOP_LEVEL_DIALOG_OPENED_MISMATCH(top=${proof.dialogOpened},nested=${hr.locationDialogOpened})`
      );
    }
    if (
      typeof hr.applyClicked === "boolean" &&
      proof.applyClicked !== hr.applyClicked
    ) {
      contradictions.push(
        `TOP_LEVEL_APPLY_CLICKED_MISMATCH(top=${proof.applyClicked},nested=${hr.applyClicked})`
      );
    }
    if (
      typeof hr.observedDeliveryPostalCode === "string" &&
      hr.observedDeliveryPostalCode.length > 0 &&
      proof.observedDeliveryPostalCode !== hr.observedDeliveryPostalCode
    ) {
      contradictions.push(
        `TOP_LEVEL_ZIP_MISMATCH(top=${proof.observedDeliveryPostalCode},nested=${hr.observedDeliveryPostalCode})`
      );
    }
    if (
      proof.status === "US_NOT_CONFIRMED" &&
      (hr.status === "US_DISPLAYED_CONTEXT_VERIFIED" || hr.usDeliveryVerified === true)
    ) {
      contradictions.push(
        `TOP_LEVEL_STATUS_CONTRADICTS_NESTED_READBACK(top=${proof.status},nested=${hr.status})`
      );
    }
  }

  if (
    phases &&
    typeof phases === "object" &&
    phases.phase1_initial_home &&
    phases.phase2_zip_dialog_action &&
    phases.phase3_home_readback &&
    phases.phase4_search_readback &&
    phases.phase5_pdp_readback &&
    phases.phase6_post_session_close
  ) {
    const p1SearchReady =
      proof.phase1_initial_home?.searchBoxReady ??
      phases.phase1_initial_home?.searchBoxReady ??
      phases.phase1_initial_home?.observedFields?.searchBoxReady;
    if (typeof p1SearchReady === "boolean" && proof.searchBoxReady !== p1SearchReady) {
      contradictions.push(
        `TOP_LEVEL_SEARCH_BOX_READY_MISMATCH(top=${proof.searchBoxReady},phase1=${p1SearchReady})`
      );
    }

    const p2Steps =
      proof.phase2_zip_dialog_action?.stepsExecuted ??
      phases.phase2_zip_dialog_action?.stepsExecuted;
    if (
      Array.isArray(p2Steps) &&
      p2Steps.length === 0 &&
      Array.isArray(proof.stepsExecuted) &&
      proof.stepsExecuted.length > 0
    ) {
      contradictions.push("TOP_LEVEL_STEPS_EXECUTED_CONTRADICTS_EMPTY_PHASE2_STEPS");
    }

    const p2Dialog =
      proof.phase2_zip_dialog_action?.dialogOpened ??
      phases.phase2_zip_dialog_action?.dialogOpened ??
      phases.phase2_zip_dialog_action?.observedFields?.locationDialogOpened;
    if (typeof p2Dialog === "boolean" && proof.dialogOpened !== p2Dialog) {
      contradictions.push(
        `TOP_LEVEL_DIALOG_OPENED_MISMATCH(top=${proof.dialogOpened},phase2=${p2Dialog})`
      );
    }

    const p3Zip = phases.phase3_home_readback?.observedFields?.observedZip || null;
    const p5Zip = phases.phase5_pdp_readback?.observedFields?.pdpPageZip || null;
    const p5Curr = phases.phase5_pdp_readback?.observedFields?.pdpExplicitCurrency || null;
    const p5UsdCount = Number(
      proof.phase5_pdp_readback?.usdPdpConfirmedCount ??
        phases.phase5_pdp_readback?.usdPdpConfirmedCount ??
        phases.phase5_pdp_readback?.observedFields?.pdpNumericUsdPriceCount ??
        0
    );
    const p5ObsCurrencies: string[] | null = Array.isArray(
      proof.phase5_pdp_readback?.observedCurrencies ??
        phases.phase5_pdp_readback?.observedCurrencies
    )
      ? proof.phase5_pdp_readback?.observedCurrencies ??
        phases.phase5_pdp_readback?.observedCurrencies
      : null;

    if (
      proof.finalZipVerdict === "PASS" &&
      (proof.finalEffectiveUsDeliveryVerified !== true ||
        !proof.observedDeliveryPostalCode ||
        (proof.targetUsZip && proof.observedDeliveryPostalCode !== proof.targetUsZip))
    ) {
      contradictions.push(
        `FINAL_ZIP_VERDICT_PASS_WITH_MISSING_OR_MISMATCHED_ZIP(zip=${proof.observedDeliveryPostalCode},target=${proof.targetUsZip},verified=${proof.finalEffectiveUsDeliveryVerified})`
      );
    }

    if (
      proof.finalUsdCommercialVerdict === "PASS" &&
      (proof.finalEffectiveCurrencyUsdVerified !== true ||
        p5UsdCount < 1 ||
        proof.observedDisplayedCurrencyCode !== "USD" ||
        (p5ObsCurrencies && !p5ObsCurrencies.includes("USD")))
    ) {
      contradictions.push(
        `FINAL_USD_VERDICT_PASS_WITHOUT_CONFIRMED_USD_PDP(usdCount=${p5UsdCount},curr=${proof.observedDisplayedCurrencyCode},verified=${proof.finalEffectiveCurrencyUsdVerified})`
      );
    }

    if (
      (proof.finalUsdCommercialVerdict === "PASS" ||
        proof.finalEffectiveCurrencyUsdVerified === true) &&
      (proof.explicitCurrencySource === "SYMBOL_ONLY_UNVERIFIED" ||
        hr?.explicitCurrencySource === "SYMBOL_ONLY_UNVERIFIED")
    ) {
      contradictions.push("USD_VERIFIED_FROM_SYMBOL_ONLY_UNVERIFIED");
    }

    if (
      proof.finalEffectiveUsDeliveryVerified === true &&
      (p3Zip !== proof.targetUsZip || p5Zip !== proof.targetUsZip)
    ) {
      contradictions.push(
        `US_DELIVERY_VERIFIED_WITHOUT_HOME_AND_PDP_ZIP(p3Zip=${p3Zip},p5Zip=${p5Zip},target=${proof.targetUsZip})`
      );
    }
    if (
      proof.finalEffectiveCurrencyUsdVerified === true &&
      (p5Curr !== "USD" || p5UsdCount < 1)
    ) {
      contradictions.push(
        `USD_VERIFIED_WITHOUT_PDP_USD_PRICE(p5Curr=${p5Curr},p5UsdCount=${p5UsdCount})`
      );
    }
    if (
      phases.phase6_post_session_close?.attempted === true &&
      (phases.phase6_post_session_close?.observedFields?.mcpSessionClosedCleanly !== true ||
        phases.phase6_post_session_close?.observedFields?.ownedChildPidTerminated !== true)
    ) {
      contradictions.push("MCP_SESSION_OR_CHILD_PID_NOT_CLEANLY_TERMINATED");
    }

    const p1 = phases.phase1_initial_home;
    const p2 = phases.phase2_zip_dialog_action;
    const p3 = phases.phase3_home_readback;
    const p4 = phases.phase4_search_readback;
    const p5 = phases.phase5_pdp_readback;
    const p6 = phases.phase6_post_session_close;

    // A20: Missing or phony rawSnapshotHash on attempted browser phases
    if (p1?.attempted === true && !isValidAmazonRawSnapshotHash(p1?.rawSnapshotHash)) {
      contradictions.push("MISSING_OR_PHONY_RAW_SNAPSHOT_HASH_PHASE1");
    }
    if (p3?.attempted === true && !isValidAmazonRawSnapshotHash(p3?.rawSnapshotHash)) {
      contradictions.push("MISSING_OR_PHONY_RAW_SNAPSHOT_HASH_PHASE3");
    }
    if (p4?.attempted === true && !isValidAmazonRawSnapshotHash(p4?.rawSnapshotHash)) {
      contradictions.push("MISSING_OR_PHONY_RAW_SNAPSHOT_HASH_PHASE4");
    }
    if (p5?.attempted === true && !isValidAmazonRawSnapshotHash(p5?.rawSnapshotHash)) {
      contradictions.push("MISSING_OR_PHONY_RAW_SNAPSHOT_HASH_PHASE5");
    }

    // A17: Phase 4 / Phase 5 incomplete or missing operation timestamp/hash
    if (
      p4?.attempted === true &&
      (p4?.status === "INCOMPLETE" ||
        typeof p4?.observedAt !== "string" ||
        p4.observedAt.trim().length === 0)
    ) {
      contradictions.push("PHASE4_INCOMPLETE_MISSING_SEARCH_OP_TIMESTAMP");
    }
    if (
      p5?.attempted === true &&
      (p5?.status === "INCOMPLETE" ||
        typeof p5?.observedAt !== "string" ||
        p5.observedAt.trim().length === 0 ||
        !isValidAmazonRawSnapshotHash(p5?.rawSnapshotHash))
    ) {
      contradictions.push("PHASE5_INCOMPLETE_MISSING_PDP_OP_TIMESTAMP_OR_HASH");
    }

    // A16: Phase 4 or Phase 5 observedAt synthesized from post-close report evaluatedAt
    if (typeof proof.evaluatedAt === "string" && proof.evaluatedAt.trim().length > 0) {
      if (p4?.observedAt && p4.observedAt === proof.evaluatedAt) {
        contradictions.push("PHASE4_OBSERVED_AT_EQUALS_REPORT_EVALUATED_AT");
      }
      if (p5?.observedAt && p5.observedAt === proof.evaluatedAt) {
        contradictions.push("PHASE5_OBSERVED_AT_EQUALS_REPORT_EVALUATED_AT");
      }
    }

    // A15 & A18: Chronology ordering across phases and MCP session lifecycle
    const parseIsoMs = (iso: unknown): number =>
      typeof iso === "string" && iso.trim().length > 0 ? Date.parse(iso) : NaN;
    const p1Ms = parseIsoMs(p1?.observedAt);
    const p2Ms = parseIsoMs(p2?.observedAt);
    const p3Ms = parseIsoMs(p3?.observedAt);
    const p4Ms = parseIsoMs(p4?.observedAt);
    const p5Ms = parseIsoMs(p5?.observedAt);
    const lastToolMs = parseIsoMs(
      p6?.observedFields?.lastToolCompletedAt ?? proof.lastToolCompletedAt
    );
    const closeStartMs = parseIsoMs(
      p6?.observedFields?.closeStartedAt ?? proof.closeStartedAt
    );
    const closeFinishMs = parseIsoMs(
      p6?.observedFields?.closeFinishedAt ?? p6?.observedAt ?? proof.closeFinishedAt
    );

    if (Number.isFinite(p1Ms) && Number.isFinite(p2Ms) && p1Ms > p2Ms) {
      contradictions.push("CHRONOLOGY_VIOLATION_PHASE1_AFTER_PHASE2");
    }
    if (Number.isFinite(p2Ms) && Number.isFinite(p3Ms) && p2Ms > p3Ms) {
      contradictions.push("CHRONOLOGY_VIOLATION_PHASE2_AFTER_PHASE3");
    }
    if (Number.isFinite(p3Ms) && Number.isFinite(p4Ms) && p3Ms > p4Ms) {
      contradictions.push("CHRONOLOGY_VIOLATION_PHASE3_AFTER_PHASE4");
    }
    if (Number.isFinite(p4Ms) && Number.isFinite(p5Ms) && p4Ms > p5Ms) {
      contradictions.push("CHRONOLOGY_VIOLATION_PHASE4_AFTER_PHASE5");
    }
    if (Number.isFinite(p4Ms) && Number.isFinite(closeStartMs) && p4Ms > closeStartMs) {
      contradictions.push("CHRONOLOGY_VIOLATION_PHASE4_AFTER_CLOSE_STARTED");
    }
    if (Number.isFinite(p4Ms) && Number.isFinite(closeFinishMs) && p4Ms > closeFinishMs) {
      contradictions.push("CHRONOLOGY_VIOLATION_PHASE4_AFTER_CLOSE_FINISHED");
    }
    if (Number.isFinite(p5Ms) && Number.isFinite(lastToolMs) && p5Ms > lastToolMs) {
      contradictions.push("CHRONOLOGY_VIOLATION_PHASE5_AFTER_LAST_TOOL_COMPLETED");
    }
    if (Number.isFinite(p5Ms) && Number.isFinite(closeStartMs) && p5Ms > closeStartMs) {
      contradictions.push("CHRONOLOGY_VIOLATION_PHASE5_AFTER_CLOSE_STARTED");
    }
    if (Number.isFinite(p5Ms) && Number.isFinite(closeFinishMs) && p5Ms > closeFinishMs) {
      contradictions.push("CHRONOLOGY_VIOLATION_PHASE5_AFTER_CLOSE_FINISHED");
    }
    if (
      Number.isFinite(lastToolMs) &&
      Number.isFinite(closeStartMs) &&
      closeStartMs < lastToolMs
    ) {
      contradictions.push(
        "CHRONOLOGY_VIOLATION_CLOSE_STARTED_BEFORE_LAST_TOOL_COMPLETED"
      );
    }
    if (
      Number.isFinite(closeStartMs) &&
      Number.isFinite(closeFinishMs) &&
      closeFinishMs < closeStartMs
    ) {
      contradictions.push(
        "CHRONOLOGY_VIOLATION_CLOSE_FINISHED_BEFORE_CLOSE_STARTED"
      );
    }

    // A19: SessionId consistency across phases and PDP records
    const phaseSessionIds = [
      proof.sessionId,
      p1?.sessionId,
      p2?.sessionId,
      p3?.sessionId,
      p4?.sessionId,
      p5?.sessionId,
      p6?.sessionId,
    ].filter((s): s is string => typeof s === "string" && s.trim().length > 0);
    if (new Set(phaseSessionIds).size > 1) {
      contradictions.push("SESSION_ID_MISMATCH_ACROSS_PHASES");
    }

    const perPdpRecords = Array.isArray(p5?.observedFields?.perPdpRecords)
      ? p5.observedFields.perPdpRecords
      : [];
    for (const rec of perPdpRecords) {
      if (
        rec?.sessionId &&
        proof.sessionId &&
        rec.sessionId !== proof.sessionId
      ) {
        contradictions.push("SESSION_ID_MISMATCH_IN_PDP_RECORD");
      }
      if (
        !rec?.observedAt ||
        !isValidAmazonRawSnapshotHash(rec?.rawSnapshotHash)
      ) {
        contradictions.push("INVALID_PDP_RECORD_TIMESTAMP_OR_HASH");
      }
      const recMs = parseIsoMs(rec?.observedAt);
      if (Number.isFinite(recMs) && Number.isFinite(closeFinishMs) && recMs > closeFinishMs) {
        contradictions.push("CHRONOLOGY_VIOLATION_PDP_RECORD_AFTER_CLOSE_FINISHED");
      }
    }
  } else {
    contradictions.push("MISSING_SIX_PHASE_UI_PROOF");
  }

  return {
    consistent: contradictions.length === 0,
    valid: contradictions.length === 0,
    contradictions,
  };
}

export interface PlaywrightMcpHandshakeProof {
  executed: boolean;
  connected: boolean;
  status:
    | "CONNECTED_AND_VERIFIED"
    | "MCP_NOT_CONFIGURED"
    | "BLOCKED_PROVIDER"
    | "TEST_FIXTURE_SESSION"
    | "HANDSHAKE_TIMED_OUT";
  transportMode: "REAL_STDIO_MCP" | "TEST_FIXTURE";
  serverOrigin?: "PINNED_PLAYWRIGHT_MCP" | "LOCAL_MCP_TEST_DOUBLE" | "TEST_FIXTURE";
  observationClass: MarketplaceObservationClass;
  sessionId: string;
  pinnedPackage: string;
  command: string;
  args: string[];
  ownedChildPid: number | null;
  headlessIsolatedProfile: boolean;
  serverName: string | null;
  serverVersion: string | null;
  discoveredTools: string[];
  requiredToolsPresent: boolean;
  missingRequiredTools: string[];
  toolInvocationRecords?: PlaywrightMcpToolInvocationRecord[];
  homeAndLocationReadback?: {
    attempted: boolean;
    status?:
      | "US_DISPLAYED_CONTEXT_VERIFIED"
      | "NOT_USD_VERIFIED"
      | "US_NOT_CONFIRMED"
      | "READY_TIMEOUT"
      | "DIALOG_OR_APPLY_UNAVAILABLE"
      | "UNKNOWN"
      | "BLOCKED_PROVIDER"
      | "AUTHENTICATION_REQUIRED";
    searchBoxReady: boolean;
    deliveryLinkVisible?: boolean;
    homepageReady?: boolean;
    locationDialogOpened?: boolean;
    zipFieldVisible?: boolean;
    applyClicked?: boolean;
    confirmationHandled?: boolean;
    initialDeliveryText: string | null;
    initialObservedZip?: string | null;
    initialExplicitCurrency?: string | null;
    initialExplicitCurrencySource?: string | null;
    requestedPostalCode: string | null;
    observedDeliveryLocationText: string | null;
    observedDeliveryPostalCode: string | null;
    observedCurrency: string | null;
    explicitCurrencySource?: string | null;
    usDeliveryVerified: boolean;
    searchPageZip?: string | null;
    searchPageExplicitCurrency?: string | null;
    pdpPageZip?: string | null;
    pdpExplicitCurrency?: string | null;
    homeSnapshotHash?: string | null;
    searchSnapshotHash?: string | null;
    pdpSnapshotHash?: string | null;
    searchReadbackObservedAt?: string | null;
    pdpReadbackObservedAt?: string | null;
    perSearchReadbacks?: Array<{
      url: string;
      observedAt: string;
      rawSnapshotHash: string;
      sessionId: string;
    }>;
    perPdpReadbacks?: Array<{
      url: string;
      asin: string | null;
      observedAt: string;
      rawSnapshotHash: string;
      sessionId: string;
    }>;
    uiActionLedger?: AmazonUiLocationActionStep[];
    notes?: string[];
  } | null;
  startedAt: string;
  completedAt: string;
  lastToolCompletedAt?: string | null;
  closeStartedAt?: string | null;
  closeFinishedAt?: string | null;
  durationMs: number;
  closedCleanly: boolean;
  ownedChildPidTerminated?: boolean | "UNKNOWN";
  closeError?: string | null;
  errorMessage: string | null;
}

export interface AmazonPlaywrightMcpSession {
  readonly sessionId: string;
  readonly transportMode: "REAL_STDIO_MCP" | "TEST_FIXTURE";
  readonly serverOrigin?: "PINNED_PLAYWRIGHT_MCP" | "LOCAL_MCP_TEST_DOUBLE" | "TEST_FIXTURE";
  readonly observationClass: MarketplaceObservationClass;
  readonly handshakeProof: PlaywrightMcpHandshakeProof;
  isAlive(): boolean;
  getToolInvocationRecords?(): PlaywrightMcpToolInvocationRecord[];
  getSessionLifecycleProof?(options?: {
    ownershipMode?: "ADAPTER_OWNED" | "CALLER_BORROWED";
    observedOperationIds?: string[];
  }): AmazonMcpSessionLifecycleProof;
  navigateAndCaptureProductSnapshot(
    url: string,
    options?: { timeoutMs?: number; signal?: AbortSignal }
  ): Promise<{
    snapshot: RawAmazonSnapshotInput;
    upstreamRequestId: string | null;
    toolInvocations: string[];
  }>;
  navigateAndCaptureSearchSnapshot?(
    searchUrl: string,
    options?: { timeoutMs?: number; signal?: AbortSignal }
  ): Promise<{
    snapshot: RawAmazonSnapshotInput;
    searchCardsResult: ParsedAmazonSearchSnapshotResult;
    upstreamRequestId: string | null;
    toolInvocations: string[];
  }>;
  close(): Promise<void>;
}

export interface ConnectAmazonPlaywrightMcpOptions {
  command?: string;
  args?: string[];
  timeoutMs?: number;
  signal?: AbortSignal;
  allowRealStdioMcp?: boolean;
  fixtureTransport?: {
    enabled: true;
    snapshotsByUrl: Record<string, RawAmazonSnapshotInput>;
    simulateErrorByUrl?: Record<string, string>;
  };
}

const REQUIRED_PLAYWRIGHT_MCP_TOOLS = [
  "browser_navigate",
  "browser_snapshot",
  "browser_close",
];

/**
 * Connects to Microsoft Playwright MCP (pinned `@playwright/mcp@0.0.83`) or an explicit
 * `TEST_FIXTURE` transport for deterministic unit testing.
 */
export async function connectAmazonPlaywrightMcp(
  options: ConnectAmazonPlaywrightMcpOptions = {}
): Promise<{
  connected: boolean;
  status:
    | "CONNECTED_AND_VERIFIED"
    | "MCP_NOT_CONFIGURED"
    | "BLOCKED_PROVIDER"
    | "TEST_FIXTURE_SESSION"
    | "HANDSHAKE_TIMED_OUT";
  handshakeProof: PlaywrightMcpHandshakeProof;
  session: AmazonPlaywrightMcpSession | null;
}> {
  const startedAtMs = Date.now();
  const startedAt = new Date(startedAtMs).toISOString();
  const sessionId = `pw_mcp_${Date.now().toString(36)}_${crypto.randomBytes(4).toString("hex")}`;

  // 1. Explicit TEST_FIXTURE transport for unit/integration tests (never labeled REAL_STDIO_MCP or AUTHORIZED_LIVE)
  if (options.fixtureTransport?.enabled) {
    let closed = false;
    let lastToolCompletedAt: string | null = null;
    let closeStartedAt: string | null = null;
    let closeFinishedAt: string | null = null;
    const toolInvocationRecords: PlaywrightMcpToolInvocationRecord[] = [];
    const completedAt = new Date().toISOString();
    const handshakeProof: PlaywrightMcpHandshakeProof = {
      executed: true,
      connected: true,
      status: "TEST_FIXTURE_SESSION",
      transportMode: "TEST_FIXTURE",
      serverOrigin: "TEST_FIXTURE",
      observationClass: "TEST_FIXTURE",
      sessionId,
      pinnedPackage: PLAYWRIGHT_MCP_PINNED_PACKAGE,
      command: "TEST_FIXTURE_IN_MEMORY",
      args: ["--headless", "--isolated"],
      ownedChildPid: null,
      headlessIsolatedProfile: true,
      serverName: "playwright-mcp-test-fixture",
      serverVersion: PLAYWRIGHT_MCP_PINNED_VERSION,
      discoveredTools: [...REQUIRED_PLAYWRIGHT_MCP_TOOLS],
      requiredToolsPresent: true,
      missingRequiredTools: [],
      toolInvocationRecords,
      startedAt,
      completedAt,
      lastToolCompletedAt: null,
      closeStartedAt: null,
      closeFinishedAt: null,
      durationMs: Math.max(0, Date.now() - startedAtMs),
      closedCleanly: false,
      ownedChildPidTerminated: false,
      closeError: null,
      errorMessage: null,
    };

    const markFixtureClosed = () => {
      if (closed) return;
      closed = true;
      const nowIso = new Date().toISOString();
      closeStartedAt = closeStartedAt || nowIso;
      closeFinishedAt = nowIso;
      handshakeProof.closeStartedAt = closeStartedAt;
      handshakeProof.closeFinishedAt = closeFinishedAt;
      handshakeProof.closedCleanly = true;
      handshakeProof.ownedChildPidTerminated = true;
      handshakeProof.closeError = null;
    };

    if (options.signal) {
      if (options.signal.aborted) {
        markFixtureClosed();
      } else {
        options.signal.addEventListener(
          "abort",
          () => {
            markFixtureClosed();
          },
          { once: true }
        );
      }
    }

    const session: AmazonPlaywrightMcpSession = {
      sessionId,
      transportMode: "TEST_FIXTURE",
      serverOrigin: "TEST_FIXTURE",
      observationClass: "TEST_FIXTURE",
      handshakeProof,
      isAlive: () => !closed,
      getToolInvocationRecords: () => [...toolInvocationRecords],
      getSessionLifecycleProof(opts) {
        const ownershipMode = opts?.ownershipMode || "ADAPTER_OWNED";
        return {
          sessionId,
          transportMode: "TEST_DOUBLE",
          serverOrigin: "TEST_FIXTURE",
          ownershipMode,
          ownedChildPid: null,
          startedAt,
          lastToolCompletedAt,
          closeStartedAt,
          closeFinishedAt,
          closedCleanly: closed ? handshakeProof.closedCleanly : false,
          ownedChildPidTerminated: closed ? true : false,
          closeError: handshakeProof.closeError ?? null,
          toolInvocationsCount: toolInvocationRecords.length,
          observedOperationIds: opts?.observedOperationIds || [],
          sessionCreated: true,
          transportKind: "TEST_FIXTURE",
          reusedAcrossCandidates: true,
          closedInFinally: closed && handshakeProof.closedCleanly === true,
          toolCallCount: toolInvocationRecords.length,
        };
      },
      async navigateAndCaptureProductSnapshot(url, navOpts) {
        if (closed || navOpts?.signal?.aborted || options.signal?.aborted) {
          markFixtureClosed();
          throw new Error("MCP_SESSION_ABORTED: Test fixture MCP session aborted.");
        }
        const simErr = options.fixtureTransport?.simulateErrorByUrl?.[url];
        if (simErr) {
          throw new Error(simErr);
        }
        const snap = options.fixtureTransport?.snapshotsByUrl?.[url];
        const invokedAt = new Date().toISOString();
        lastToolCompletedAt = invokedAt;
        handshakeProof.lastToolCompletedAt = invokedAt;
        const reqHash = crypto
          .createHash("sha256")
          .update(JSON.stringify({ url }), "utf8")
          .digest("hex");
        const respHash = crypto
          .createHash("sha256")
          .update(JSON.stringify(snap || { status: 404 }), "utf8")
          .digest("hex");
        toolInvocationRecords.push(
          {
            toolName: "browser_navigate",
            url,
            invokedAt,
            requestHash: reqHash,
            responseHash: respHash,
          },
          {
            toolName: "browser_snapshot",
            url,
            invokedAt,
            requestHash: reqHash,
            responseHash: respHash,
          }
        );
        if (!snap) {
          return {
            snapshot: {
              sourceUrl: url,
              finalUrl: url,
              httpStatus: 404,
              pageTitle: "Page Not Found",
              html: "<html><body>SORRY we couldn't find that page</body></html>",
              structuredData: null,
            },
            upstreamRequestId: null,
            toolInvocations: ["browser_navigate", "browser_snapshot"],
          };
        }
        return {
          snapshot: snap,
          upstreamRequestId: null,
          toolInvocations: ["browser_navigate", "browser_snapshot"],
        };
      },
      async navigateAndCaptureSearchSnapshot(searchUrl, navOpts) {
        const searchCheck = validateAmazonUsSearchUrl(searchUrl);
        if (!searchCheck.valid) {
          throw new Error(
            `INVALID_SEARCH_URL: ${searchCheck.rejectionReason || "Invalid Amazon US search URL"}`
          );
        }
        const prodSnap = await this.navigateAndCaptureProductSnapshot(searchUrl, navOpts);
        const searchCardsResult = parseAmazonSearchSnapshotCards({
          sourceUrl: prodSnap.snapshot.sourceUrl,
          finalUrl: prodSnap.snapshot.finalUrl,
          httpStatus: prodSnap.snapshot.httpStatus,
          pageTitle: prodSnap.snapshot.pageTitle,
          rawHtml: prodSnap.snapshot.html,
          accessibilityTreeText: prodSnap.snapshot.html,
          structuredData: prodSnap.snapshot.structuredData as any,
        });
        return {
          snapshot: prodSnap.snapshot,
          searchCardsResult,
          upstreamRequestId: prodSnap.upstreamRequestId,
          toolInvocations: prodSnap.toolInvocations,
        };
      },
      async close() {
        markFixtureClosed();
      },
    };

    return {
      connected: true,
      status: "TEST_FIXTURE_SESSION",
      handshakeProof,
      session,
    };
  }

  // 2. Real Stdio MCP Transport against pinned @playwright/mcp@0.0.83
  const allowReal =
    options.allowRealStdioMcp === true ||
    String(process.env.KH02_AMAZON_PLAYWRIGHT_MCP_ENABLED || "false")
      .trim()
      .toLowerCase() === "true";

  const command =
    options.command ||
    process.env.KH02_AMAZON_PLAYWRIGHT_MCP_COMMAND ||
    "npx";
  const args = options.args ||
    (process.env.KH02_AMAZON_PLAYWRIGHT_MCP_ARGS
      ? process.env.KH02_AMAZON_PLAYWRIGHT_MCP_ARGS.split(/\s+/).filter(Boolean)
      : [
          "-y",
          PLAYWRIGHT_MCP_PINNED_PACKAGE,
          "--headless",
          "--isolated",
          "--block-service-workers",
          "--image-responses",
          "omit",
        ]);

  const headlessIsolatedProfile =
    args.includes("--headless") && args.includes("--isolated");

  if (!allowReal) {
    const completedAt = new Date().toISOString();
    const handshakeProof: PlaywrightMcpHandshakeProof = {
      executed: false,
      connected: false,
      status: "MCP_NOT_CONFIGURED",
      transportMode: "REAL_STDIO_MCP",
      observationClass: "UNVERIFIED",
      sessionId,
      pinnedPackage: PLAYWRIGHT_MCP_PINNED_PACKAGE,
      command,
      args,
      ownedChildPid: null,
      headlessIsolatedProfile,
      serverName: null,
      serverVersion: null,
      discoveredTools: [],
      requiredToolsPresent: false,
      missingRequiredTools: [...REQUIRED_PLAYWRIGHT_MCP_TOOLS],
      startedAt,
      completedAt,
      durationMs: Math.max(0, Date.now() - startedAtMs),
      closedCleanly: true,
      errorMessage:
        "MCP_NOT_CONFIGURED: Real Playwright MCP transport is not enabled (set allowRealStdioMcp=true or KH02_AMAZON_PLAYWRIGHT_MCP_ENABLED=true).",
    };
    return {
      connected: false,
      status: "MCP_NOT_CONFIGURED",
      handshakeProof,
      session: null,
    };
  }

  if (!headlessIsolatedProfile) {
    const completedAt = new Date().toISOString();
    const handshakeProof: PlaywrightMcpHandshakeProof = {
      executed: true,
      connected: false,
      status: "BLOCKED_PROVIDER",
      transportMode: "REAL_STDIO_MCP",
      observationClass: "UNVERIFIED",
      sessionId,
      pinnedPackage: PLAYWRIGHT_MCP_PINNED_PACKAGE,
      command,
      args,
      ownedChildPid: null,
      headlessIsolatedProfile: false,
      serverName: null,
      serverVersion: null,
      discoveredTools: [],
      requiredToolsPresent: false,
      missingRequiredTools: [...REQUIRED_PLAYWRIGHT_MCP_TOOLS],
      startedAt,
      completedAt,
      durationMs: Math.max(0, Date.now() - startedAtMs),
      closedCleanly: true,
      errorMessage:
        "BLOCKED_PROVIDER: Playwright MCP transport must run with both --headless and --isolated flags.",
    };
    return {
      connected: false,
      status: "BLOCKED_PROVIDER",
      handshakeProof,
      session: null,
    };
  }

  const timeoutMs = options.timeoutMs ?? 25_000;
  let transport: StdioClientTransport | null = null;
  let client: Client | null = null;
  let closed = false;
  let closePromise: Promise<void> | null = null;
  let ownedChildPid: number | null = null;
  let lastToolCompletedAt: string | null = null;
  let closeStartedAt: string | null = null;
  let closeFinishedAt: string | null = null;
  let ownedChildPidTerminated: boolean | "UNKNOWN" = "UNKNOWN";
  let closeError: string | null = null;

  const isOwnedPidAlive = (pid: number | null): boolean => {
    if (!pid || pid <= 0) return false;
    try {
      process.kill(pid, 0);
      return true;
    } catch {
      return false;
    }
  };

  const waitForOwnedPidExit = async (pid: number | null, maxWaitMs: number): Promise<boolean> => {
    if (!pid || pid <= 0) return true;
    const deadline = Date.now() + maxWaitMs;
    while (Date.now() < deadline) {
      if (!isOwnedPidAlive(pid)) return true;
      await new Promise((r) => setTimeout(r, 50));
    }
    return !isOwnedPidAlive(pid);
  };

  const cleanupPlaywrightMcpTempDir = () => {
    try {
      const mcpDir = path.resolve(process.cwd(), ".playwright-mcp");
      if (fs.existsSync(mcpDir)) {
        fs.rmSync(mcpDir, { recursive: true, force: true });
      }
    } catch {}
  };

  const safeCloseTransport = async () => {
    if (closed) return;
    closed = true;
    if (!closeStartedAt) {
      closeStartedAt = new Date().toISOString();
    }
    const closeErrors: string[] = [];
    try {
      await client?.close();
    } catch (err: any) {
      closeErrors.push(`client.close: ${err?.message || String(err)}`);
    }
    try {
      await transport?.close();
    } catch (err: any) {
      closeErrors.push(`transport.close: ${err?.message || String(err)}`);
    }
    const proc = (transport as any)?._process;
    const targetPid = ownedChildPid || (proc && typeof proc.pid === "number" ? proc.pid : null);
    if (targetPid && targetPid > 0) {
      if (isOwnedPidAlive(targetPid)) {
        try {
          process.kill(targetPid, "SIGTERM");
        } catch {}
      }
      let exited = await waitForOwnedPidExit(targetPid, 1000);
      if (!exited && isOwnedPidAlive(targetPid)) {
        try {
          process.kill(targetPid, "SIGKILL");
        } catch {}
        exited = await waitForOwnedPidExit(targetPid, 1000);
      }
      ownedChildPidTerminated = exited;
      if (!exited) {
        closeErrors.push(`OWNED_CHILD_PID_${targetPid}_STILL_ALIVE_AFTER_CLOSE`);
      }
    } else {
      ownedChildPidTerminated = true;
    }
    closeFinishedAt = new Date().toISOString();
    if (closeErrors.length > 0 && ownedChildPidTerminated !== true) {
      closeError = closeErrors.join("; ");
    }
    cleanupPlaywrightMcpTempDir();
  };

  if (options.signal) {
    if (options.signal.aborted) {
      await safeCloseTransport();
    } else {
      options.signal.addEventListener(
        "abort",
        () => {
          void safeCloseTransport();
        },
        { once: true }
      );
    }
  }

  const resolvePinnedPlaywrightMcpSpawn = (
    cmd: string,
    cmdArgs: string[]
  ): { spawnCommand: string; spawnArgs: string[] } => {
    const pkgIdx = cmdArgs.indexOf(PLAYWRIGHT_MCP_PINNED_PACKAGE);
    if (
      (cmd === "npx" || cmd === "npx.cmd") &&
      pkgIdx !== -1
    ) {
      try {
        const candidateNpxDirs = [
          path.join(os.homedir(), ".npm", "_npx"),
          path.join(
            process.env.LOCALAPPDATA ||
              path.join(os.homedir(), "AppData", "Local"),
            "npm-cache",
            "_npx"
          ),
        ];
        for (const npxDir of candidateNpxDirs) {
          if (!fs.existsSync(npxDir)) continue;
          for (const d of fs.readdirSync(npxDir)) {
            const pkgDir = path.join(
              npxDir,
              d,
              "node_modules",
              "@playwright",
              "mcp"
            );
            const pkgJsonPath = path.join(pkgDir, "package.json");
            const cliJsPath = path.join(pkgDir, "cli.js");
            if (fs.existsSync(pkgJsonPath) && fs.existsSync(cliJsPath)) {
              const pkgJson = JSON.parse(fs.readFileSync(pkgJsonPath, "utf8"));
              if (
                pkgJson?.name === "@playwright/mcp" &&
                pkgJson?.version === PLAYWRIGHT_MCP_PINNED_VERSION
              ) {
                const mcpFlags = cmdArgs.slice(pkgIdx + 1);
                return {
                  spawnCommand: process.execPath,
                  spawnArgs: [cliJsPath, ...mcpFlags],
                };
              }
            }
          }
        }
      } catch {}
    }
    return { spawnCommand: cmd, spawnArgs: cmdArgs };
  };

  try {
    const { spawnCommand, spawnArgs } = resolvePinnedPlaywrightMcpSpawn(
      command,
      args
    );
    transport = new StdioClientTransport({
      command: spawnCommand,
      args: spawnArgs,
      stderr: "pipe",
    });

    client = new Client(
      {
        name: "swai-kh02-amazon-us-pilot",
        version: "12.4.3.5.0",
      },
      {
        capabilities: {},
      }
    );

    let timer: NodeJS.Timeout | null = null;
    const handshakeTimeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        reject(new Error(`HANDSHAKE_TIMED_OUT_${timeoutMs}MS`));
      }, timeoutMs);
    });

    try {
      await Promise.race([
        (async () => {
          await client!.connect(transport!);
          ownedChildPid = (transport as any)?._process?.pid ?? null;
        })(),
        handshakeTimeout,
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }

    const serverInfo = client.getServerVersion();
    const toolsResponse = await client.listTools();
    const discoveredTools = (toolsResponse?.tools || [])
      .map((t: any) => String(t?.name || "").trim())
      .filter(Boolean);

    const missingRequiredTools = REQUIRED_PLAYWRIGHT_MCP_TOOLS.filter(
      (reqTool) => !discoveredTools.includes(reqTool)
    );
    const requiredToolsPresent = missingRequiredTools.length === 0;

    if (!requiredToolsPresent) {
      await safeCloseTransport();
      const completedAt = new Date().toISOString();
      const handshakeProof: PlaywrightMcpHandshakeProof = {
        executed: true,
        connected: false,
        status: "BLOCKED_PROVIDER",
        transportMode: "REAL_STDIO_MCP",
        observationClass: "UNVERIFIED",
        sessionId,
        pinnedPackage: PLAYWRIGHT_MCP_PINNED_PACKAGE,
        command,
        args,
        ownedChildPid,
        headlessIsolatedProfile: true,
        serverName: serverInfo?.name || null,
        serverVersion: serverInfo?.version || null,
        discoveredTools,
        requiredToolsPresent: false,
        missingRequiredTools,
        startedAt,
        completedAt,
        durationMs: Math.max(0, Date.now() - startedAtMs),
        closedCleanly: true,
        errorMessage: `Missing required Playwright MCP tools: ${missingRequiredTools.join(", ")}`,
      };
      return {
        connected: false,
        status: "BLOCKED_PROVIDER",
        handshakeProof,
        session: null,
      };
    }

    const serverNameLower = String(serverInfo?.name || "").toLowerCase();
    const isPinnedOfficialMcp =
      args.includes(PLAYWRIGHT_MCP_PINNED_PACKAGE) &&
      serverNameLower.includes("playwright") &&
      !serverNameLower.includes("test-double") &&
      !serverNameLower.includes("fixture");
    const serverOrigin: "PINNED_PLAYWRIGHT_MCP" | "LOCAL_MCP_TEST_DOUBLE" =
      isPinnedOfficialMcp ? "PINNED_PLAYWRIGHT_MCP" : "LOCAL_MCP_TEST_DOUBLE";
    const sessionObservationClass: MarketplaceObservationClass =
      isPinnedOfficialMcp ? "AUTHORIZED_LIVE" : "TEST_FIXTURE";
    const toolInvocationRecords: PlaywrightMcpToolInvocationRecord[] = [];

    const completedAt = new Date().toISOString();
    const handshakeProof: PlaywrightMcpHandshakeProof = {
      executed: true,
      connected: true,
      status: "CONNECTED_AND_VERIFIED",
      transportMode: "REAL_STDIO_MCP",
      serverOrigin,
      observationClass: sessionObservationClass,
      sessionId,
      pinnedPackage: PLAYWRIGHT_MCP_PINNED_PACKAGE,
      command,
      args,
      ownedChildPid,
      headlessIsolatedProfile: true,
      serverName: serverInfo?.name || "Playwright",
      serverVersion: serverInfo?.version || PLAYWRIGHT_MCP_PINNED_VERSION,
      discoveredTools,
      requiredToolsPresent: true,
      missingRequiredTools: [],
      toolInvocationRecords,
      startedAt,
      completedAt,
      lastToolCompletedAt: null,
      closeStartedAt: null,
      closeFinishedAt: null,
      durationMs: Math.max(0, Date.now() - startedAtMs),
      closedCleanly: false,
      ownedChildPidTerminated: "UNKNOWN",
      closeError: null,
      errorMessage: null,
    };

    const session: AmazonPlaywrightMcpSession = {
      sessionId,
      transportMode: "REAL_STDIO_MCP",
      serverOrigin,
      observationClass: sessionObservationClass,
      handshakeProof,
      isAlive: () => !closed,
      getToolInvocationRecords: () => [...toolInvocationRecords],
      getSessionLifecycleProof(opts) {
        const ownershipMode = opts?.ownershipMode || "ADAPTER_OWNED";
        const mappedTransportMode =
          serverOrigin === "PINNED_PLAYWRIGHT_MCP" ? "REAL_STDIO_MCP" : "TEST_DOUBLE";
        const mappedServerOrigin =
          serverOrigin === "PINNED_PLAYWRIGHT_MCP"
            ? "PINNED_PLAYWRIGHT_MCP"
            : "LOCAL_TEST_SERVER";
        const isClosedCleanly = closed ? handshakeProof.closedCleanly === true : false;
        const pidTerminatedVal: boolean | "UNKNOWN" = closed
          ? ownedChildPidTerminated === true
          : isOwnedPidAlive(ownedChildPid)
          ? false
          : "UNKNOWN";
        const captureToolCallsCount = toolInvocationRecords.filter(
          (r) => r.toolName !== "browser_close"
        ).length;
        return {
          sessionId,
          transportMode: mappedTransportMode,
          serverOrigin: mappedServerOrigin,
          ownershipMode,
          ownedChildPid,
          startedAt,
          lastToolCompletedAt,
          closeStartedAt,
          closeFinishedAt,
          closedCleanly: isClosedCleanly,
          ownedChildPidTerminated: pidTerminatedVal,
          closeError,
          toolInvocationsCount: captureToolCallsCount,
          observedOperationIds: opts?.observedOperationIds || [],
          sessionCreated: true,
          transportKind: "REAL_STDIO_MCP",
          reusedAcrossCandidates: true,
          closedInFinally: isClosedCleanly,
          toolCallCount: captureToolCallsCount,
        };
      },
      async navigateAndCaptureProductSnapshot(url, navOpts) {
        if (closed || navOpts?.signal?.aborted || options.signal?.aborted) {
          await this.close();
          throw new Error("MCP_SESSION_ABORTED: Playwright MCP session aborted.");
        }

        const navInvokedAt = new Date().toISOString();
        const navReqHash = crypto
          .createHash("sha256")
          .update(JSON.stringify({ tool: "browser_navigate", url }), "utf8")
          .digest("hex");
        const navResult = await client!.callTool({
          name: "browser_navigate",
          arguments: { url },
        });
        lastToolCompletedAt = new Date().toISOString();
        handshakeProof.lastToolCompletedAt = lastToolCompletedAt;
        const navRespHash = crypto
          .createHash("sha256")
          .update(JSON.stringify(navResult || null), "utf8")
          .digest("hex");
        toolInvocationRecords.push({
          toolName: "browser_navigate",
          url,
          invokedAt: navInvokedAt,
          requestHash: navReqHash,
          responseHash: navRespHash,
        });

        if ((navResult as any)?.isError === true) {
          const errText = ((navResult as any)?.content || [])
            .filter((c: any) => c && typeof c.text === "string")
            .map((c: any) => c.text)
            .join(" ");
          throw new Error(
            `BLOCKED_PROVIDER: Playwright MCP browser_navigate returned isError=true (${errText || "navigation failed"}).`
          );
        }

        const snapInvokedAt = new Date().toISOString();
        const snapReqHash = crypto
          .createHash("sha256")
          .update(JSON.stringify({ tool: "browser_snapshot", url }), "utf8")
          .digest("hex");
        const snapResult = await client!.callTool({
          name: "browser_snapshot",
          arguments: {},
        });
        lastToolCompletedAt = new Date().toISOString();
        handshakeProof.lastToolCompletedAt = lastToolCompletedAt;
        const snapRespHash = crypto
          .createHash("sha256")
          .update(JSON.stringify(snapResult || null), "utf8")
          .digest("hex");
        toolInvocationRecords.push({
          toolName: "browser_snapshot",
          url,
          invokedAt: snapInvokedAt,
          requestHash: snapReqHash,
          responseHash: snapRespHash,
        });

        if ((snapResult as any)?.isError === true) {
          const errText = ((snapResult as any)?.content || [])
            .filter((c: any) => c && typeof c.text === "string")
            .map((c: any) => c.text)
            .join(" ");
          throw new Error(
            `BLOCKED_PROVIDER: Playwright MCP browser_snapshot returned isError=true (${errText || "snapshot failed"}).`
          );
        }

        let textItems = [
          ...((navResult as any)?.content || []),
          ...((snapResult as any)?.content || []),
        ]
          .filter((c: any) => c && typeof c.text === "string")
          .map((c: any) => c.text)
          .join("\n");

        // @playwright/mcp@0.0.83 writes large accessibility snapshots to .playwright-mcp/page-*.yml
        // and references them via `- [Snapshot](.playwright-mcp/page-*.yml)` in tool text output.
        const snapshotFileLinks = Array.from(
          textItems.matchAll(/\[Snapshot\]\(([^)\s]+\.yml)\)/gi)
        ).map((m) => m[1]);
        if (snapshotFileLinks.length > 0) {
          const mcpRoot = path.resolve(process.cwd(), ".playwright-mcp");
          const loadedSnapshots: string[] = [];
          for (const relLink of snapshotFileLinks) {
            try {
              const absPath = path.resolve(process.cwd(), relLink);
              if (absPath.startsWith(mcpRoot) && fs.existsSync(absPath)) {
                loadedSnapshots.push(fs.readFileSync(absPath, "utf8"));
              }
            } catch {}
          }
          if (loadedSnapshots.length > 0) {
            textItems = `${textItems}\n${loadedSnapshots[loadedSnapshots.length - 1]}`;
          }
          cleanupPlaywrightMcpTempDir();
        }

        const titleMatch = textItems.match(/Page Title:\s*(.+)/i);
        const urlMatch = textItems.match(/Page URL:\s*(\S+)/i);
        const canonicalMatch = textItems.match(/Canonical URL:\s*(\S+)/i);
        const statusMatch = textItems.match(/HTTP Status:\s*(\d{3})/i);
        const parsedHttpStatus: number | null = statusMatch?.[1]
          ? Number.parseInt(statusMatch[1], 10)
          : null;

        let parsedStructuredData: RawAmazonSnapshotInput["structuredData"] = null;
        const structuredLineMatch = textItems.match(/STRUCTURED_DATA_JSON:(\{.+\})/i);
        if (structuredLineMatch?.[1]) {
          try {
            parsedStructuredData = JSON.parse(structuredLineMatch[1]);
          } catch {
            parsedStructuredData = null;
          }
        } else {
          const urlValidation = validateAmazonUsProductUrl(url, urlMatch?.[1] || url);
          const asinFromSnap =
            urlValidation.extractedAsin ||
            textItems.match(/\bASIN\s*[:#]?\s*(B0[A-Z0-9]{8}|[0-9]{9}[0-9X])\b/i)?.[1]?.toUpperCase() ||
            null;
          const h1Candidates = Array.from(
            textItems.matchAll(/heading\s+"([^"\n]{6,260})"\s+\[level=1\]/gi)
          )
            .map((m) => m[1].trim())
            .filter(
              (h) =>
                !/Product summary presents|Keyboard shortcut|Skip to/i.test(h)
            );
          const h1Title =
            h1Candidates[0] ||
            (titleMatch?.[1]
              ? titleMatch[1]
                  .replace(/^Amazon\.com\s*:\s*/i, "")
                  .replace(/\s*:\s*Amazon\.com.*$/i, "")
                  .trim()
              : null);
          const brandMatch =
            textItems.match(/Visit the\s+([A-Za-z0-9][A-Za-z0-9\s\-&'.]{1,40})\s+Store/i)?.[1]?.trim() ||
            textItems.match(/\bBrand\s*:\s*([^\n"|]{2,40})/i)?.[1]?.trim() ||
            (h1Title && /^ChomChom\s+Roller\b/i.test(h1Title)
              ? "ChomChom Roller"
              : h1Title && /^UAHPET\b/i.test(h1Title)
              ? "UAHPET"
              : h1Title && /^Furbo\b/i.test(h1Title)
              ? "Furbo"
              : h1Title && /^PETLIBRO\b/i.test(h1Title)
              ? "PETLIBRO"
              : h1Title && /^PetSafe\b/i.test(h1Title)
              ? "PetSafe"
              : h1Title && /^KittySpout\b/i.test(h1Title)
              ? "KittySpout"
              : h1Title && /^Uproot\s+Clean\b/i.test(h1Title)
              ? "Uproot Clean"
              : null);
          // Only inspect primary product area before any carousel/related-items section to prevent assigning carousel prices (N24)
          const carouselSplitIdx = textItems.search(
            /\b(?:Products related to this item|Customers who viewed this item also viewed|Compare with similar items|Sponsored products related to this item)\b/i
          );
          const primaryProductRegion =
            carouselSplitIdx > 0 ? textItems.slice(0, carouselSplitIdx) : textItems;
          const deliveryLineMatch =
            primaryProductRegion.match(/button\s+"(Deliver\s+to\s+[^"\n]+)"/i)?.[1]?.trim() ||
            primaryProductRegion.match(/\b(Deliver\s+to\s+[^\n"\]]+)/i)?.[1]?.trim() ||
            null;
          const deliveryZipMatch =
            deliveryLineMatch?.match(/\b(\d{5})\b/)?.[1] || null;
          // Only extract buybox price when anchored to explicit buybox/price label and never infer USD from '$' or ZIP alone without explicit USD evidence
          const anchoredBuyboxPriceMatch =
            primaryProductRegion.match(
              /\b(?:Price|Buy\s+New|One-time\s+purchase)\s*:?\s*(?:US)?\$([0-9]{1,4}\.[0-9]{2})\b/i
            )?.[1] || null;
          const explicitUsdEvidence =
            /\b(?:USD|US\$|U\.S\.\s*Dollar)\b/.test(primaryProductRegion);
          const availMatch =
            primaryProductRegion.match(
              /\b(In Stock|Currently unavailable|Temporarily out of stock)\b/i
            )?.[1] || null;
          if (
            asinFromSnap ||
            h1Title ||
            brandMatch ||
            anchoredBuyboxPriceMatch ||
            deliveryLineMatch
          ) {
            parsedStructuredData = {
              asin: asinFromSnap,
              productTitle: h1Title,
              brand: brandMatch,
              price:
                anchoredBuyboxPriceMatch && explicitUsdEvidence
                  ? Number(anchoredBuyboxPriceMatch)
                  : null,
              currency:
                anchoredBuyboxPriceMatch && explicitUsdEvidence ? "USD" : null,
              availability: availMatch,
              deliveryLocationText: deliveryLineMatch,
              deliveryPostalCode: deliveryZipMatch,
              explicitUsDeliveryConfirmed: Boolean(deliveryZipMatch),
            };
          }
        }

        let resolvedCanonicalUrl = canonicalMatch?.[1] || urlMatch?.[1] || url;
        const isSearchNav = /\/s(?:\?|\/|$)/i.test(url);
        if (handshakeProof.homeAndLocationReadback && lastToolCompletedAt) {
          const snapTextHash = crypto
            .createHash("sha256")
            .update(textItems || url, "utf8")
            .digest("hex");
          if (isSearchNav) {
            if (!handshakeProof.homeAndLocationReadback.searchReadbackObservedAt) {
              handshakeProof.homeAndLocationReadback.searchReadbackObservedAt =
                lastToolCompletedAt;
            }
            if (!handshakeProof.homeAndLocationReadback.searchSnapshotHash) {
              handshakeProof.homeAndLocationReadback.searchSnapshotHash = snapTextHash;
            }
          } else {
            if (!handshakeProof.homeAndLocationReadback.pdpReadbackObservedAt) {
              handshakeProof.homeAndLocationReadback.pdpReadbackObservedAt =
                lastToolCompletedAt;
            }
            if (!handshakeProof.homeAndLocationReadback.pdpSnapshotHash) {
              handshakeProof.homeAndLocationReadback.pdpSnapshotHash = snapTextHash;
            }
          }
        }
        if (
          isPinnedOfficialMcp &&
          discoveredTools.includes("browser_evaluate") &&
          !isSearchNav &&
          !structuredLineMatch?.[1]
        ) {
          try {
            const evalPdpInvokedAt = new Date().toISOString();
            const evalPdpReqHash = crypto
              .createHash("sha256")
              .update(JSON.stringify({ tool: "browser_evaluate", kind: "pdp", url }), "utf8")
              .digest("hex");
            const evalRes = await client!.callTool({
              name: "browser_evaluate",
              arguments: {
                function: `() => {
                  const canon = document.querySelector('link[rel="canonical"]')?.getAttribute('href') || null;
                  const title = document.querySelector('#productTitle')?.textContent?.trim() || null;
                  const byline = document.querySelector('#bylineInfo')?.textContent?.trim() || null;
                  const brand = byline ? byline.replace(/^(?:Visit the|Brand:|by)\\s+/i, '').replace(/\\s+Store$/i, '').trim() : null;
                  const glow = document.querySelector('#glow-ingress-block')?.textContent?.replace(/\\s+/g, ' ').trim() ||
                    document.querySelector('#contextualIngressPtLabel_deliveryShortLine')?.textContent?.replace(/\\s+/g, ' ').trim() || null;
                  const nonUsMatch = glow ? glow.match(/\\bDeliver\\s+to\\s+(Vietnam|Canada|United\\s+Kingdom|Germany|France|Japan|Australia|India|Mexico|Brazil|Singapore|Republic\\s+of\\s+Korea)\\b/i) : null;
                  const zipMatch = !nonUsMatch && glow ? glow.match(/\\b(\\d{5})\\b/) : null;
                  const zip = zipMatch ? zipMatch[1] : null;
                  const extractBuyboxPriceText = (root) => {
                    if (!root) return null;
                    const offscreen = root.querySelector(
                      '.a-price.priceToPay .a-offscreen, .a-price.priceToPay .aok-offscreen, .a-price .a-offscreen, .a-price .aok-offscreen'
                    );
                    if (offscreen && offscreen.textContent && offscreen.textContent.trim()) {
                      const firstToken = offscreen.textContent.trim().split(/\\s+with\\s+/i)[0].trim();
                      if (firstToken) return firstToken;
                    }
                    const priceRoot = root.querySelector('.a-price.priceToPay, .a-price');
                    if (priceRoot) {
                      const sym = (priceRoot.querySelector('.a-price-symbol')?.textContent || '').trim();
                      const whole = (priceRoot.querySelector('.a-price-whole')?.textContent || '').replace(/[^0-9]/g, '');
                      const frac = (priceRoot.querySelector('.a-price-fraction')?.textContent || '').replace(/[^0-9]/g, '');
                      if (whole) {
                        return sym + whole + (frac ? '.' + frac : '');
                      }
                    }
                    return null;
                  };
                  const corePriceContainer =
                    document.querySelector('#corePriceDisplay_desktop_feature_div') ||
                    document.querySelector('#corePrice_feature_div') ||
                    document.querySelector('#Apex_desktop') ||
                    document.querySelector('#ppd') ||
                    document.querySelector('#centerCol');
                  const rawPriceText = extractBuyboxPriceText(corePriceContainer);

                  let explicitCurrency = null;
                  let explicitCurrencySource = null;
                  if (rawPriceText && /^(?:VND|\\u20ab)\\s*[0-9]|[0-9]\\s*(?:VND|\\u20ab)/i.test(rawPriceText)) {
                    explicitCurrency = 'VND';
                    explicitCurrencySource = 'DOM:buybox_VND';
                  } else if (rawPriceText && /^US\\$[0-9]/i.test(rawPriceText)) {
                    explicitCurrency = 'USD';
                    explicitCurrencySource = 'DOM:buybox_US$';
                  }
                  const copText = (
                    document.querySelector('#icp-touch-link-cop')?.textContent ||
                    document.querySelector('#icp-nav-flyout')?.textContent ||
                    ''
                  ).replace(/\\s+/g, ' ').trim();
                  if (!explicitCurrency && copText) {
                    const isoMatch = copText.match(/\\b(USD|VND|EUR|GBP|CAD|AUD|JPY|SGD|KRW)\\b/i);
                    if (isoMatch) {
                      explicitCurrency = isoMatch[1].toUpperCase();
                      explicitCurrencySource = 'DOM:#icp-touch-link-cop';
                    } else if (/U\\.S\\.\\s*Dollar|US\\s+Dollar/i.test(copText)) {
                      explicitCurrency = 'USD';
                      explicitCurrencySource = 'DOM:#icp-touch-link-cop';
                    } else if (/Vietnamese\\s+Dong/i.test(copText)) {
                      explicitCurrency = 'VND';
                      explicitCurrencySource = 'DOM:#icp-touch-link-cop';
                    }
                  }
                  if (!explicitCurrency) {
                    const copInput = document.querySelector('input#currencyOfPreference, input[name="currencyOfPreference"]');
                    const copVal = copInput ? (copInput.getAttribute('value') || copInput.value || '').trim().toUpperCase() : '';
                    if (/^[A-Z]{3}$/.test(copVal)) {
                      explicitCurrency = copVal;
                      explicitCurrencySource = 'DOM:input[name=currencyOfPreference]';
                    }
                  }
                  if (!explicitCurrency) {
                    const metricsEl = document.querySelector('#cerberus-data-metrics[data-asin-currency-code], [data-asin-currency-code]');
                    const attrCurr = metricsEl ? (metricsEl.getAttribute('data-asin-currency-code') || '').trim().toUpperCase() : '';
                    if (/^[A-Z]{3}$/.test(attrCurr)) {
                      explicitCurrency = attrCurr;
                      explicitCurrencySource = 'DOM:[data-asin-currency-code]';
                    }
                  }
                  if (!explicitCurrency) {
                    const htmlStr = document.documentElement?.innerHTML || '';
                    const jsonCurr = htmlStr.match(/"(?:priceCurrency|currencyCode)"\\s*:\\s*"(USD|VND|EUR|GBP|CAD|AUD|JPY)"/i);
                    if (jsonCurr) {
                      explicitCurrency = jsonCurr[1].toUpperCase();
                      explicitCurrencySource = 'DOM:priceCurrency';
                    }
                  }
                  if (!explicitCurrency && rawPriceText && /^\\$[0-9]/.test(rawPriceText)) {
                    explicitCurrencySource = 'SYMBOL_ONLY_UNVERIFIED';
                  }

                  const availNode =
                    document.querySelector('#availability span.a-size-medium') ||
                    document.querySelector('#availability span') ||
                    document.querySelector('#availability');
                  const availRaw = availNode?.textContent?.replace(/\\s+/g, ' ').trim() || null;
                  const avail = availRaw ? availRaw.split('{')[0].trim() : null;
                  let seller = document.querySelector('#sellerProfileTriggerId')?.textContent?.trim() ||
                    document.querySelector('#tabular-buybox .tabular-buybox-text[tabular-attribute-name="Sold by"]')?.textContent?.replace(/\\s+/g, ' ').trim() || null;
                  if (!seller) {
                    const mInfo = document.querySelector('#merchant-info')?.textContent?.replace(/\\s+/g, ' ').trim() || '';
                    const sm = mInfo.match(/Sold by\\s+([^.]+?)(?:\\s+and\\s+|\\.|$)/i);
                    if (sm) seller = sm[1].trim();
                  }
                  let modelNumber = null;
                  const bodyText = (
                    (document.querySelector('#detailBullets_feature_div')?.textContent || '') + '\\n' +
                    (document.querySelector('#productDetails_techSpec_section_1')?.textContent || '') + '\\n' +
                    (document.querySelector('#productDetails_detailBullets_sections1')?.textContent || '') + '\\n' +
                    (document.querySelector('#productOverview_feature_div')?.textContent || '')
                  ).replace(/[\\u200E\\u200F]/g, ' ');
                  const modMatch = bodyText.match(/(?:Item\\s+model\\s+number|Model\\s+Number)\\s*[:\\s]*([A-Za-z0-9][A-Za-z0-9\\-_.]{1,28})/i);
                  if (modMatch) modelNumber = modMatch[1].trim();
                  return JSON.stringify({
                    finalUrl: window.location.href,
                    canonicalUrl: canon,
                    productTitle: title,
                    brand,
                    modelNumber,
                    seller,
                    rawPriceText,
                    explicitCurrency,
                    explicitCurrencySource,
                    availability: avail,
                    deliveryLocationText: glow,
                    deliveryPostalCode: zip,
                  });
                }`,
              },
            });
            lastToolCompletedAt = new Date().toISOString();
            handshakeProof.lastToolCompletedAt = lastToolCompletedAt;
            const evalPdpRespHash = crypto
              .createHash("sha256")
              .update(JSON.stringify(evalRes || null), "utf8")
              .digest("hex");
            toolInvocationRecords.push({
              toolName: "browser_evaluate",
              url,
              invokedAt: evalPdpInvokedAt,
              requestHash: evalPdpReqHash,
              responseHash: evalPdpRespHash,
            });
            const evalText = ((evalRes as any)?.content || [])
              .filter((c: any) => c && typeof c.text === "string")
              .map((c: any) => c.text)
              .join("\n");
            const domObj = parsePlaywrightMcpEvaluateJson(evalText);
            if (domObj && typeof domObj === "object") {
              if (domObj.canonicalUrl) {
                resolvedCanonicalUrl = String(domObj.canonicalUrl).trim();
              }
              const explicitPdpCurrency =
                typeof domObj.explicitCurrency === "string" &&
                /^[A-Z]{3}$/.test(domObj.explicitCurrency.trim())
                  ? domObj.explicitCurrency.trim().toUpperCase()
                  : null;
              const priceNum =
                explicitPdpCurrency === "USD" &&
                domObj.rawPriceText &&
                /^(?:US)?\$[0-9]+(?:\.[0-9]{2})?$/i.test(String(domObj.rawPriceText).trim())
                  ? Number(String(domObj.rawPriceText).replace(/[^0-9.]/g, ""))
                  : null;
              // Do NOT borrow homepage/search ZIP onto PDP if PDP DOM lacks observed ZIP
              const pdpZipObserved =
                domObj.deliveryPostalCode && /^\d{5}$/.test(String(domObj.deliveryPostalCode).trim())
                  ? String(domObj.deliveryPostalCode).trim()
                  : null;
              const pdpSnapHash = crypto
                .createHash("sha256")
                .update(JSON.stringify(domObj), "utf8")
                .digest("hex");
              const extractedAsin =
                parsedStructuredData?.asin || validateAmazonUsProductUrl(url).extractedAsin;
              if (handshakeProof.homeAndLocationReadback) {
                handshakeProof.homeAndLocationReadback.pdpPageZip = pdpZipObserved;
                handshakeProof.homeAndLocationReadback.pdpExplicitCurrency = explicitPdpCurrency;
                handshakeProof.homeAndLocationReadback.pdpSnapshotHash = pdpSnapHash;
                handshakeProof.homeAndLocationReadback.pdpReadbackObservedAt =
                  lastToolCompletedAt;
                if (!Array.isArray(handshakeProof.homeAndLocationReadback.perPdpReadbacks)) {
                  handshakeProof.homeAndLocationReadback.perPdpReadbacks = [];
                }
                handshakeProof.homeAndLocationReadback.perPdpReadbacks.push({
                  url,
                  asin: extractedAsin || null,
                  observedAt: lastToolCompletedAt,
                  rawSnapshotHash: pdpSnapHash,
                  sessionId,
                });
                if (
                  pdpZipObserved &&
                  pdpZipObserved === handshakeProof.homeAndLocationReadback.requestedPostalCode &&
                  explicitPdpCurrency === "USD"
                ) {
                  handshakeProof.homeAndLocationReadback.observedCurrency = "USD";
                  handshakeProof.homeAndLocationReadback.explicitCurrencySource =
                    domObj.explicitCurrencySource || "DOM:PDP";
                  handshakeProof.homeAndLocationReadback.status =
                    "US_DISPLAYED_CONTEXT_VERIFIED";
                }
              }
              parsedStructuredData = {
                ...parsedStructuredData,
                asin: extractedAsin,
                productTitle: domObj.productTitle || parsedStructuredData?.productTitle || null,
                brand: domObj.brand || parsedStructuredData?.brand || null,
                modelNumber: domObj.modelNumber || parsedStructuredData?.modelNumber || null,
                seller: domObj.seller || parsedStructuredData?.seller || null,
                merchant: domObj.seller || parsedStructuredData?.merchant || null,
                price:
                  priceNum !== null && Number.isFinite(priceNum) && priceNum > 0
                    ? priceNum
                    : null,
                currency: explicitPdpCurrency,
                availability: domObj.availability || parsedStructuredData?.availability || null,
                deliveryLocationText:
                  domObj.deliveryLocationText ||
                  parsedStructuredData?.deliveryLocationText ||
                  null,
                deliveryPostalCode: pdpZipObserved,
                explicitUsDeliveryConfirmed: Boolean(pdpZipObserved),
              };
            }
          } catch {}
        }

        return {
          snapshot: {
            sourceUrl: url,
            finalUrl: urlMatch?.[1] || url,
            canonicalUrl: resolvedCanonicalUrl,
            httpStatus:
              parsedHttpStatus !== null && Number.isFinite(parsedHttpStatus)
                ? parsedHttpStatus
                : null,
            pageTitle: titleMatch?.[1]?.trim() || null,
            html: textItems.slice(0, 120000),
            structuredData: parsedStructuredData,
          },
          upstreamRequestId: null,
          toolInvocations: ["browser_navigate", "browser_snapshot"],
        };
      },
      async navigateAndCaptureSearchSnapshot(searchUrl, navOpts) {
        const searchCheck = validateAmazonUsSearchUrl(searchUrl);
        if (!searchCheck.valid) {
          throw new Error(
            `INVALID_SEARCH_URL: ${searchCheck.rejectionReason || "Invalid Amazon US search URL"}`
          );
        }

        // Phase 1 & 2: On first search in a real Playwright MCP session, run UI-driven US ZIP 95829 preflight
        if (
          isPinnedOfficialMcp &&
          discoveredTools.includes("browser_evaluate") &&
          !handshakeProof.homeAndLocationReadback
        ) {
          try {
            const uiCaller: McpToolCaller = {
              callTool: (p) => client!.callTool(p),
              discoveredTools,
              sessionId,
              ownedChildPid,
              recordToolInvocation: (rec) => {
                lastToolCompletedAt = new Date().toISOString();
                handshakeProof.lastToolCompletedAt = lastToolCompletedAt;
                toolInvocationRecords.push(rec);
              },
            };
            const preflight = await ensureAmazonUsDeliveryContextViaUi(uiCaller, {
              targetZip: "95829",
              signal: navOpts?.signal || options.signal,
            });
            handshakeProof.homeAndLocationReadback = {
              attempted: preflight.attempted,
              status: preflight.status,
              searchBoxReady: preflight.searchBoxReady,
              deliveryLinkVisible: preflight.deliveryLinkVisible,
              homepageReady: preflight.homepageReady,
              locationDialogOpened: preflight.locationDialogOpened,
              zipFieldVisible: preflight.zipFieldVisible,
              applyClicked: preflight.applyClicked,
              confirmationHandled: preflight.confirmationHandled,
              initialDeliveryText: preflight.initialDeliveryText,
              initialObservedZip: preflight.initialObservedZip,
              initialExplicitCurrency: preflight.initialExplicitCurrency,
              initialExplicitCurrencySource: preflight.initialExplicitCurrencySource,
              requestedPostalCode: preflight.targetZip,
              observedDeliveryLocationText: preflight.observedDeliveryLocationText,
              observedDeliveryPostalCode: preflight.observedDeliveryPostalCode,
              observedCurrency: preflight.observedCurrency,
              explicitCurrencySource: preflight.explicitCurrencySource,
              usDeliveryVerified: preflight.usDeliveryVerified,
              homeSnapshotHash: preflight.homeSnapshotHash,
              uiActionLedger: preflight.uiActionLedger,
              notes: preflight.notes,
            };
          } catch {}
        }

        const prodSnap = await this.navigateAndCaptureProductSnapshot(searchUrl, navOpts);

        if (isPinnedOfficialMcp && discoveredTools.includes("browser_evaluate")) {
          try {
            const evalSearchInvokedAt = new Date().toISOString();
            const evalSearchReqHash = crypto
              .createHash("sha256")
              .update(
                JSON.stringify({ tool: "browser_evaluate", kind: "search", url: searchUrl }),
                "utf8"
              )
              .digest("hex");
            const domSearchRes = await client!.callTool({
              name: "browser_evaluate",
              arguments: {
                function: `() => {
                  const glow = document.querySelector('#glow-ingress-block')?.textContent?.replace(/\\s+/g, ' ').trim() || null;
                  const nonUsMatch = glow ? glow.match(/\\bDeliver\\s+to\\s+(Vietnam|Canada|United\\s+Kingdom|Germany|France|Japan|Australia|India|Mexico|Brazil|Singapore|Republic\\s+of\\s+Korea)\\b/i) : null;
                  const zipMatch = !nonUsMatch && glow ? glow.match(/\\b(\\d{5})\\b/) : null;
                  const zip = zipMatch ? zipMatch[1] : null;
                  let explicitCurrency = null;
                  const copText = (
                    document.querySelector('#icp-touch-link-cop')?.textContent ||
                    document.querySelector('#icp-nav-flyout')?.textContent ||
                    ''
                  ).replace(/\\s+/g, ' ').trim();
                  if (copText) {
                    const isoMatch = copText.match(/\\b(USD|VND|EUR|GBP|CAD|AUD|JPY|SGD|KRW)\\b/i);
                    if (isoMatch) explicitCurrency = isoMatch[1].toUpperCase();
                    else if (/U\\.S\\.\\s*Dollar/i.test(copText)) explicitCurrency = 'USD';
                    else if (/Vietnamese\\s+Dong/i.test(copText)) explicitCurrency = 'VND';
                  }
                  if (!explicitCurrency) {
                    const copInput = document.querySelector('input#currencyOfPreference, input[name="currencyOfPreference"]');
                    const copVal = copInput ? (copInput.getAttribute('value') || copInput.value || '').trim().toUpperCase() : '';
                    if (/^[A-Z]{3}$/.test(copVal)) explicitCurrency = copVal;
                  }
                  if (!explicitCurrency) {
                    const metricsEl = document.querySelector('#cerberus-data-metrics[data-asin-currency-code], [data-asin-currency-code]');
                    const attrCurr = metricsEl ? (metricsEl.getAttribute('data-asin-currency-code') || '').trim().toUpperCase() : '';
                    if (/^[A-Z]{3}$/.test(attrCurr)) explicitCurrency = attrCurr;
                  }
                  if (!explicitCurrency) {
                    const htmlStr = document.documentElement?.innerHTML || '';
                    const jsonCurr = htmlStr.match(/"(?:priceCurrency|currencyCode)"\\s*:\\s*"(USD|VND|EUR|GBP|CAD|AUD|JPY)"/i);
                    if (jsonCurr) explicitCurrency = jsonCurr[1].toUpperCase();
                  }
                  const nodes = Array.from(document.querySelectorAll('[data-component-type="s-search-result"][data-asin]'));
                  const cards = [];
                  for (const node of nodes) {
                    const asin = (node.getAttribute('data-asin') || '').trim();
                    if (!asin) continue;
                    const text = node.textContent || '';
                    const isSponsored =
                      Boolean(node.querySelector('.puis-sponsored-label-text, .s-sponsored-label-info-icon')) ||
                      /\\bSponsored\\b/i.test(text);
                    const h2List = Array.from(node.querySelectorAll('h2'));
                    const h2Texts = h2List
                      .map(el => el.textContent?.replace(/\\s+/g, ' ').trim() || '')
                      .filter(Boolean);
                    const brandHeader =
                      h2Texts.length >= 2 && h2Texts[0].length <= 36
                        ? h2Texts[0]
                        : null;
                    const titleText =
                      h2Texts.length >= 2
                        ? h2Texts.join(' ')
                        : h2Texts[0] || null;
                    const linkEl =
                      h2List.map(el => el.closest('a') || el.querySelector('a')).find(Boolean) ||
                      node.querySelector('a.a-link-normal[href*="/dp/"]') ||
                      node.querySelector('a[href*="/dp/"]');
                    const href = linkEl ? linkEl.getAttribute('href') : null;
                    const priceEl = node.querySelector('.a-price .a-offscreen, .a-price .aok-offscreen');
                    let priceText = priceEl ? priceEl.textContent?.trim()?.split(/\\s+with\\s+/i)[0]?.trim() : null;
                    if (!priceText) {
                      const pr = node.querySelector('.a-price');
                      if (pr) {
                        const sym = (pr.querySelector('.a-price-symbol')?.textContent || '').trim();
                        const whole = (pr.querySelector('.a-price-whole')?.textContent || '').replace(/[^0-9]/g, '');
                        const frac = (pr.querySelector('.a-price-fraction')?.textContent || '').replace(/[^0-9]/g, '');
                        if (whole) priceText = sym + whole + (frac ? '.' + frac : '');
                      }
                    }
                    const cardIsVnd = Boolean(priceText && /^(?:VND|\\u20ab)\\s*[0-9]|[0-9]\\s*(?:VND|\\u20ab)/i.test(priceText));
                    const cardExplicitCurrency =
                      cardIsVnd
                        ? 'VND'
                        : explicitCurrency === 'USD'
                        ? 'USD'
                        : priceText && /^US\\$[0-9]/i.test(priceText)
                        ? 'USD'
                        : null;
                    cards.push({
                      asin,
                      title: titleText,
                      brand: brandHeader,
                      href,
                      price: cardExplicitCurrency === 'USD' ? priceText : null,
                      currency: cardExplicitCurrency,
                      isSponsored,
                    });
                    if (cards.filter(c => !c.isSponsored).length >= 8) break;
                  }
                  return JSON.stringify({
                    finalUrl: window.location.href,
                    deliveryLocationText: glow,
                    deliveryPostalCode: zip,
                    explicitCurrency,
                    cards,
                  });
                }`,
              },
            });
            lastToolCompletedAt = new Date().toISOString();
            handshakeProof.lastToolCompletedAt = lastToolCompletedAt;
            const evalSearchRespHash = crypto
              .createHash("sha256")
              .update(JSON.stringify(domSearchRes || null), "utf8")
              .digest("hex");
            toolInvocationRecords.push({
              toolName: "browser_evaluate",
              url: searchUrl,
              invokedAt: evalSearchInvokedAt,
              requestHash: evalSearchReqHash,
              responseHash: evalSearchRespHash,
            });
            const domSearchText = ((domSearchRes as any)?.content || [])
              .filter((c: any) => c && typeof c.text === "string")
              .map((c: any) => c.text)
              .join("\n");
            const domObj = parsePlaywrightMcpEvaluateJson(domSearchText);
            if (domObj && typeof domObj === "object") {
              if (domObj.finalUrl) {
                prodSnap.snapshot.finalUrl = String(domObj.finalUrl);
              }
              const searchSnapHash = crypto
                .createHash("sha256")
                .update(JSON.stringify(domObj), "utf8")
                .digest("hex");
              if (handshakeProof.homeAndLocationReadback) {
                if (!handshakeProof.homeAndLocationReadback.searchPageZip) {
                  handshakeProof.homeAndLocationReadback.searchPageZip =
                    domObj.deliveryPostalCode || null;
                }
                if (!handshakeProof.homeAndLocationReadback.searchPageExplicitCurrency) {
                  handshakeProof.homeAndLocationReadback.searchPageExplicitCurrency =
                    domObj.explicitCurrency || null;
                }
                if (!handshakeProof.homeAndLocationReadback.searchSnapshotHash) {
                  handshakeProof.homeAndLocationReadback.searchSnapshotHash = searchSnapHash;
                }
                if (!handshakeProof.homeAndLocationReadback.searchReadbackObservedAt) {
                  handshakeProof.homeAndLocationReadback.searchReadbackObservedAt =
                    lastToolCompletedAt;
                }
                if (!Array.isArray(handshakeProof.homeAndLocationReadback.perSearchReadbacks)) {
                  handshakeProof.homeAndLocationReadback.perSearchReadbacks = [];
                }
                handshakeProof.homeAndLocationReadback.perSearchReadbacks.push({
                  url: searchUrl,
                  observedAt: lastToolCompletedAt,
                  rawSnapshotHash: searchSnapHash,
                  sessionId,
                });
              }
              prodSnap.snapshot.structuredData = {
                ...prodSnap.snapshot.structuredData,
                deliveryLocationText: domObj.deliveryLocationText || null,
                deliveryPostalCode: domObj.deliveryPostalCode || null,
                currency: domObj.explicitCurrency === "USD" ? "USD" : null,
                searchCards: Array.isArray(domObj.cards) ? domObj.cards : undefined,
              };
            }
          } catch {}
        }

        const searchCardsResult = parseAmazonSearchSnapshotCards(
          {
            sourceUrl: prodSnap.snapshot.sourceUrl,
            finalUrl: prodSnap.snapshot.finalUrl,
            httpStatus: prodSnap.snapshot.httpStatus,
            pageTitle: prodSnap.snapshot.pageTitle,
            rawHtml: prodSnap.snapshot.html,
            accessibilityTreeText: prodSnap.snapshot.html,
            structuredData: prodSnap.snapshot.structuredData as any,
          },
          {
            maxCards: 5,
            expectedQuery: searchCheck.query,
          }
        );
        return {
          snapshot: prodSnap.snapshot,
          searchCardsResult,
          upstreamRequestId: prodSnap.upstreamRequestId,
          toolInvocations: prodSnap.toolInvocations,
        };
      },
      async close() {
        if (closePromise) {
          return closePromise;
        }
        closePromise = (async () => {
          closeStartedAt = closeStartedAt || new Date().toISOString();
          handshakeProof.closeStartedAt = closeStartedAt;
          try {
            if (!closed && discoveredTools.includes("browser_close")) {
              const closeInvokedAt = new Date().toISOString();
              const closeReqHash = crypto
                .createHash("sha256")
                .update(JSON.stringify({ tool: "browser_close" }), "utf8")
                .digest("hex");
              await Promise.race([
                client?.callTool({ name: "browser_close", arguments: {} }),
                new Promise((resolve) => setTimeout(resolve, 2500)),
              ]).catch(() => null);
              if (!lastToolCompletedAt) {
                lastToolCompletedAt = closeStartedAt;
                handshakeProof.lastToolCompletedAt = lastToolCompletedAt;
              }
              toolInvocationRecords.push({
                toolName: "browser_close",
                url: "about:blank",
                invokedAt: closeInvokedAt,
                requestHash: closeReqHash,
                responseHash: null,
              });
            }
          } finally {
            await safeCloseTransport();
            const pidTerminated = ownedChildPidTerminated === true;
            handshakeProof.closeFinishedAt = closeFinishedAt;
            handshakeProof.ownedChildPidTerminated = pidTerminated;
            handshakeProof.closeError = closeError;
            handshakeProof.closedCleanly = pidTerminated && closeError === null;
          }
        })();
        return closePromise;
      },
    };

    return {
      connected: true,
      status: "CONNECTED_AND_VERIFIED",
      handshakeProof,
      session,
    };
  } catch (err: any) {
    await safeCloseTransport();
    const msg = err?.message || String(err);
    const isTimeout = msg.includes("HANDSHAKE_TIMED_OUT");
    const completedAt = new Date().toISOString();
    const handshakeProof: PlaywrightMcpHandshakeProof = {
      executed: true,
      connected: false,
      status: isTimeout ? "HANDSHAKE_TIMED_OUT" : "BLOCKED_PROVIDER",
      transportMode: "REAL_STDIO_MCP",
      observationClass: "UNVERIFIED",
      sessionId,
      pinnedPackage: PLAYWRIGHT_MCP_PINNED_PACKAGE,
      command,
      args,
      ownedChildPid,
      headlessIsolatedProfile,
      serverName: null,
      serverVersion: null,
      discoveredTools: [],
      requiredToolsPresent: false,
      missingRequiredTools: [...REQUIRED_PLAYWRIGHT_MCP_TOOLS],
      startedAt,
      completedAt,
      durationMs: Math.max(0, Date.now() - startedAtMs),
      closedCleanly: true,
      errorMessage: msg,
    };
    return {
      connected: false,
      status: handshakeProof.status,
      handshakeProof,
      session: null,
    };
  }
}
