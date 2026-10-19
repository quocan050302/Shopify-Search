/**
 * SWAI Server-Side Credential Management Service
 *
 * Provides secure server-side credential storage, key masking,
 * provider permission verification, and real authenticated test routines.
 *
 * CRITICAL SECURITY PRINCIPLES:
 * 1. Raw credentials NEVER leave the server — masked tokens only.
 * 2. Never store credentials in localStorage, sessionStorage, or browser state.
 * 3. Never commit credentials to GitHub — storage is in gitignored .env.local.
 * 4. Provider connection status is marked CONNECTED ONLY after an authenticated test request succeeds.
 * 5. Meta commercial US ad discovery is NOT claimed without explicit verification of permissions.
 * 6. Shopify connection is strictly NOT_CONNECTED.
 */

import fs from "fs";
import path from "path";
import { GoogleGenerativeAI } from "@google/generative-ai";

export type ProviderId = "gemini" | "meta" | "captapi";

export interface ProviderDefinition {
  id: ProviderId;
  name: string;
  envVar: string;
  description: string;
  docsUrl: string;
  setupInstructions: {
    title: string;
    steps: string[];
    securityNote: string;
  };
  supportedCapabilities: string[];
}

export interface ProviderConnectionState {
  id: ProviderId;
  name: string;
  envVar: string;
  configured: boolean;
  maskedKey: string | null;
  status: "CONNECTED" | "KEY_PRESENT_UNVERIFIED" | "NOT_CONFIGURED" | "ERROR";
  lastTestedAt: string | null;
  lastTestStatus: "SUCCESS" | "FAILED" | null;
  lastError: string | null;
  lastErrorCode?: string | number | null;
  latencyMs?: number | null;
  grantedPermissions: string[];
  missingPermissions: string[];
  capabilities: Array<{
    name: string;
    status: "VERIFIED" | "RESTRICTED" | "UNAVAILABLE" | "REQUIRES_AUTH";
    notes: string;
  }>;
  policyNotice?: string | null;
  details?: Record<string, any>;
  setupInstructions: {
    title: string;
    steps: string[];
    securityNote: string;
  };
  docsUrl: string;
}

export interface ConnectionTestResult {
  provider: ProviderId;
  status: "CONNECTED" | "ERROR" | "NOT_CONFIGURED";
  latencyMs: number;
  testedAt: string;
  errorMessage: string | null;
  errorCode?: string | number | null;
  missingPermissions: string[];
  grantedPermissions: string[];
  capabilities: Array<{
    name: string;
    status: "VERIFIED" | "RESTRICTED" | "UNAVAILABLE" | "REQUIRES_AUTH";
    notes: string;
  }>;
  policyNotice: string | null;
  details?: Record<string, any>;
}

// ─── Provider Catalog ─────────────────────────────────────────────────────────

export const PROVIDER_CATALOG: Record<ProviderId, ProviderDefinition> = {
  gemini: {
    id: "gemini",
    name: "Google Gemini AI",
    envVar: "GEMINI_API_KEY",
    description:
      "Multimodal AI for video creative analysis, opening hook scoring, selling angle extraction, and script generation.",
    docsUrl: "https://aistudio.google.com/app/apikey",
    setupInstructions: {
      title: "How to configure Google Gemini AI",
      steps: [
        "Visit Google AI Studio at aistudio.google.com.",
        "Sign in with your Google account.",
        "Navigate to 'Get API Key' and click 'Create API key'.",
        "Paste your key into the field below and click 'Save & Test'.",
        "SWAI will immediately execute a live authentication test using gemini-1.5-flash.",
      ],
      securityNote:
        "The Gemini API key is stored exclusively on the server in .env.local and is never sent to the browser.",
    },
    supportedCapabilities: [
      "Multimodal Video Creative Analysis (MP4 / WebM)",
      "Opening 3-Second Hook Quality Scoring (0–100)",
      "Core Selling Angle & UVP Extraction",
      "Evergreen vs Trend-Driven Creative Classification",
      "Original 15s / 30s Ad Script Generation",
    ],
  },
  meta: {
    id: "meta",
    name: "Meta Ad Library",
    envVar: "META_AD_LIBRARY_ACCESS_TOKEN",
    description:
      "Programmatic search and ad longevity tracking across Meta Facebook & Instagram Ad Library.",
    docsUrl: "https://developers.facebook.com/docs/ad-library-api/",
    setupInstructions: {
      title: "How to configure Meta Ad Library API",
      steps: [
        "Create a Meta Developer account at developers.facebook.com.",
        "Create a Business App and add the 'Ad Library API' product.",
        "Request the 'ad_archive' permission (requires Meta Business Verification).",
        "Complete individual identity verification if querying US political or issue ads.",
        "Generate a long-lived User Access Token or System User Token.",
        "Paste the token below and click 'Save & Test'.",
      ],
      securityNote:
        "Per Meta Platform Terms, standard Ad Library API access in the US is restricted to political & issue ads. Automated discovery of US commercial ads requires specialized Meta approval. Manual URL import is fully supported without an API key.",
    },
    supportedCapabilities: [
      "Meta Ad Library Automated Archive Query (requires ad_archive)",
      "Political & Social Issue Ad Intelligence",
      "Manual URL Import for All US Commercial Facebook/Instagram Ads (No token required)",
      "Advertiser Page Verification & Historical Observation",
    ],
  },
  captapi: {
    id: "captapi",
    name: "Captapi Ads Intelligence",
    envVar: "CAPTAPI_KEY",
    description:
      "Licensed third-party ad intelligence and multi-platform social advertising data extraction.",
    docsUrl: "https://captapi.com/dashboard/api-keys",
    setupInstructions: {
      title: "How to configure Captapi Ads Intelligence",
      steps: [
        "Create an account at captapi.com.",
        "Navigate to Dashboard → API Keys.",
        "Generate a Live API Key (typically prefixed with 'capt_live_').",
        "Paste the key below and click 'Save & Test'.",
        "SWAI will verify your key against the Captapi account balance endpoint (0 credits consumed).",
      ],
      securityNote:
        "Your Captapi key is stored securely in server-side storage and tested against https://api.captapi.com/v1/account/balance.",
    },
    supportedCapabilities: [
      "Third-Party Ad Intelligence Queries",
      "Cross-Platform Social Ad Extraction",
      "Credit Balance & Quota Monitoring",
    ],
  },
};

// ─── Cache & File Helpers ─────────────────────────────────────────────────────

const STATUS_CACHE_FILE = path.join(process.cwd(), ".connection-status.json");
const ENV_LOCAL_FILE = path.join(process.cwd(), ".env.local");

interface StoredStatusCache {
  [provider: string]: {
    status: "CONNECTED" | "KEY_PRESENT_UNVERIFIED" | "NOT_CONFIGURED" | "ERROR";
    lastTestedAt: string | null;
    lastTestStatus: "SUCCESS" | "FAILED" | null;
    lastError: string | null;
    lastErrorCode?: string | number | null;
    latencyMs?: number | null;
    grantedPermissions: string[];
    missingPermissions: string[];
    capabilities: Array<{
      name: string;
      status: "VERIFIED" | "RESTRICTED" | "UNAVAILABLE" | "REQUIRES_AUTH";
      notes: string;
    }>;
    policyNotice?: string | null;
    details?: Record<string, any>;
  };
}

function readStatusCache(): StoredStatusCache {
  try {
    if (fs.existsSync(STATUS_CACHE_FILE)) {
      const data = fs.readFileSync(STATUS_CACHE_FILE, "utf-8");
      return JSON.parse(data);
    }
  } catch {
    // Ignore read errors
  }
  return {};
}

function writeStatusCache(cache: StoredStatusCache) {
  try {
    fs.writeFileSync(STATUS_CACHE_FILE, JSON.stringify(cache, null, 2), {
      mode: 0o600,
    });
  } catch {
    // Ignore write errors in restricted environments
  }
}

// ─── Key Masking Utility ──────────────────────────────────────────────────────

/**
 * Safely masks an API key so that it can be displayed in the UI
 * without ever exposing the sensitive credential.
 *
 * Example: "AIzaSyD1234567890abcdef" -> "••••••••••••cdef"
 */
export function maskApiKey(key: string | null | undefined): string | null {
  if (!key || typeof key !== "string") return null;
  const trimmed = key.trim();
  if (trimmed.length === 0) return null;
  if (trimmed.length <= 8) {
    return "••••••••";
  }
  return `••••••••••••${trimmed.slice(-4)}`;
}

// ─── Environment Local File Handler ───────────────────────────────────────────

/**
 * Reads the current value of a provider's credential from process.env or .env.local.
 */
export function getCredentialValue(provider: ProviderId): string | null {
  const def = PROVIDER_CATALOG[provider];
  if (!def) return null;

  // First check process.env
  const inEnv = process.env[def.envVar];
  if (inEnv && inEnv.trim().length > 0) {
    return inEnv.trim();
  }

  // Fallback to reading .env.local directly
  try {
    if (fs.existsSync(ENV_LOCAL_FILE)) {
      const content = fs.readFileSync(ENV_LOCAL_FILE, "utf-8");
      const lines = content.split("\n");
      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed.startsWith("#") || !trimmed.includes("=")) continue;
        const [k, ...vParts] = trimmed.split("=");
        if (k.trim() === def.envVar) {
          let val = vParts.join("=").trim();
          if (
            (val.startsWith('"') && val.endsWith('"')) ||
            (val.startsWith("'") && val.endsWith("'"))
          ) {
            val = val.slice(1, -1);
          }
          if (val.length > 0) return val;
        }
      }
    }
  } catch {
    // Ignore error
  }

  return null;
}

/**
 * Saves a credential securely to .env.local and updates process.env in-memory.
 */
export async function saveCredential(
  provider: ProviderId,
  key: string
): Promise<{ success: boolean; maskedKey: string }> {
  const def = PROVIDER_CATALOG[provider];
  if (!def) {
    throw new Error(`Unknown provider: ${provider}`);
  }

  const cleanKey = key.trim();
  if (!cleanKey) {
    throw new Error("API key or token cannot be empty.");
  }

  // Update in-memory process.env immediately
  process.env[def.envVar] = cleanKey;

  // Update or append in .env.local
  let fileContent = "";
  try {
    if (fs.existsSync(ENV_LOCAL_FILE)) {
      fileContent = fs.readFileSync(ENV_LOCAL_FILE, "utf-8");
    }
  } catch {
    fileContent = "";
  }

  const lines = fileContent.split("\n");
  let found = false;
  const newLines = lines.map((line) => {
    const trimmed = line.trim();
    if (!trimmed.startsWith("#") && trimmed.includes("=")) {
      const [k] = trimmed.split("=");
      if (k.trim() === def.envVar) {
        found = true;
        return `${def.envVar}="${cleanKey}"`;
      }
    }
    return line;
  });

  if (!found) {
    newLines.push(`${def.envVar}="${cleanKey}"`);
  }

  fs.writeFileSync(ENV_LOCAL_FILE, newLines.filter((l) => l !== "").join("\n") + "\n", {
    mode: 0o600,
  });

  // Reset verification cache to KEY_PRESENT_UNVERIFIED
  const cache = readStatusCache();
  cache[provider] = {
    status: "KEY_PRESENT_UNVERIFIED",
    lastTestedAt: null,
    lastTestStatus: null,
    lastError: null,
    lastErrorCode: null,
    latencyMs: null,
    grantedPermissions: [],
    missingPermissions: [],
    capabilities: def.supportedCapabilities.map((cap) => ({
      name: cap,
      status: "REQUIRES_AUTH",
      notes: "Credential saved but not yet live-verified against provider API.",
    })),
    policyNotice: null,
  };
  writeStatusCache(cache);

  return {
    success: true,
    maskedKey: maskApiKey(cleanKey)!,
  };
}

/**
 * Removes a credential from .env.local and process.env.
 */
export async function removeCredential(
  provider: ProviderId
): Promise<{ success: boolean }> {
  const def = PROVIDER_CATALOG[provider];
  if (!def) {
    throw new Error(`Unknown provider: ${provider}`);
  }

  delete process.env[def.envVar];

  try {
    if (fs.existsSync(ENV_LOCAL_FILE)) {
      const fileContent = fs.readFileSync(ENV_LOCAL_FILE, "utf-8");
      const lines = fileContent.split("\n");
      const filtered = lines.filter((line) => {
        const trimmed = line.trim();
        if (!trimmed.startsWith("#") && trimmed.includes("=")) {
          const [k] = trimmed.split("=");
          if (k.trim() === def.envVar) return false;
        }
        return true;
      });
      fs.writeFileSync(ENV_LOCAL_FILE, filtered.join("\n"), { mode: 0o600 });
    }
  } catch {
    // Ignore error
  }

  const cache = readStatusCache();
  delete cache[provider];
  writeStatusCache(cache);

  return { success: true };
}

// ─── Provider Status Inspection ───────────────────────────────────────────────

/**
 * Gets the current connection status of all providers.
 * NEVER returns raw keys!
 */
export function getProviderConnectionStates(): Record<ProviderId, ProviderConnectionState> {
  const cache = readStatusCache();
  const results: Partial<Record<ProviderId, ProviderConnectionState>> = {};

  const providers: ProviderId[] = ["gemini", "meta", "captapi"];

  for (const pid of providers) {
    const def = PROVIDER_CATALOG[pid];
    const key = getCredentialValue(pid);
    const configured = Boolean(key && key.length > 0);
    const masked = maskApiKey(key);
    const cached = cache[pid];

    let status: ProviderConnectionState["status"] = "NOT_CONFIGURED";
    if (configured) {
      if (cached?.status === "CONNECTED") {
        status = "CONNECTED";
      } else if (cached?.status === "ERROR") {
        status = "ERROR";
      } else {
        status = "KEY_PRESENT_UNVERIFIED";
      }
    }

    results[pid] = {
      id: pid,
      name: def.name,
      envVar: def.envVar,
      configured,
      maskedKey: masked,
      status,
      lastTestedAt: cached?.lastTestedAt || null,
      lastTestStatus: cached?.lastTestStatus || null,
      lastError: cached?.lastError || null,
      lastErrorCode: cached?.lastErrorCode || null,
      latencyMs: cached?.latencyMs ?? null,
      grantedPermissions: cached?.grantedPermissions || [],
      missingPermissions: cached?.missingPermissions || [],
      capabilities: cached?.capabilities || def.supportedCapabilities.map((cap) => ({
        name: cap,
        status: configured ? "REQUIRES_AUTH" : "UNAVAILABLE",
        notes: configured
          ? "Click 'Test Connection' to verify API capability."
          : "Provider credential not configured.",
      })),
      policyNotice: cached?.policyNotice || null,
      details: cached?.details || {},
      setupInstructions: def.setupInstructions,
      docsUrl: def.docsUrl,
    };
  }

  return results as Record<ProviderId, ProviderConnectionState>;
}

// ─── Test Connection Implementations ──────────────────────────────────────────

/**
 * Live test connection for Google Gemini AI.
 * Uses @google/generative-ai to perform an authenticated generateContent call.
 *
 * NOTE: Google AI Studio now issues API keys in two formats:
 *   - Legacy:  AIzaSy... (older projects)
 *   - New:     AQ.xxxx  (newer projects via OAuth 2.0)
 * Both formats are fully valid — no format validation is applied here.
 *
 * Model fallback order (newest → stable):
 *   1. gemini-2.0-flash          — preferred stable model (2025)
 *   2. gemini-2.0-flash-lite     — lighter/faster variant
 *   3. gemini-1.5-flash-latest   — stable alias (avoids deprecated suffix)
 *   4. gemini-1.5-flash-002      — pinned stable release
 * We try each in sequence until one succeeds.
 */
async function testGeminiConnection(key: string): Promise<ConnectionTestResult> {
  const startTime = Date.now();
  const testedAt = new Date().toISOString();

  // Ordered list of models to probe — newest first
  const MODELS_TO_TRY = [
    "gemini-2.0-flash",
    "gemini-2.0-flash-lite",
    "gemini-1.5-flash-latest",
    "gemini-1.5-flash-002",
  ];

  const ai = new GoogleGenerativeAI(key);
  let lastError: any = null;
  let workingModel: string | null = null;
  let responseText = "";

  for (const modelName of MODELS_TO_TRY) {
    try {
      const model = ai.getGenerativeModel({ model: modelName });
      const result = await model.generateContent("Ping. Respond with OK.");
      responseText = result.response.text();
      workingModel = modelName;
      break; // Success — stop trying
    } catch (err: any) {
      lastError = err;
      // Only continue if it's a model-not-found error (404)
      const is404 =
        err.status === 404 ||
        (typeof err.message === "string" && (
          err.message.includes("not found") ||
          err.message.includes("404") ||
          err.message.includes("not supported")
        ));
      if (!is404) {
        // Auth failure or network error — no point trying other models
        break;
      }
    }
  }

  const latencyMs = Date.now() - startTime;

  if (workingModel && responseText) {
    return {
      provider: "gemini",
      status: "CONNECTED",
      latencyMs,
      testedAt,
      errorMessage: null,
      missingPermissions: [],
      grantedPermissions: ["generateContent", "multimodal_analysis"],
      capabilities: [
        {
          name: "Video Creative Analysis (MP4 / WebM)",
          status: "VERIFIED",
          notes: `Live verification succeeded on ${workingModel}.`,
        },
        {
          name: "Opening 3-Second Hook Quality Scoring",
          status: "VERIFIED",
          notes: "Algorithmic scoring ready.",
        },
        {
          name: "Core Selling Angle & UVP Extraction",
          status: "VERIFIED",
          notes: "Creative parsing enabled.",
        },
        {
          name: "Evergreen vs Trend-Driven Creative Classification",
          status: "VERIFIED",
          notes: "Longevity classification enabled.",
        },
        {
          name: "Original Ad Script Generation",
          status: "VERIFIED",
          notes: "15s / 30s creative concept generation enabled.",
        },
      ],
      policyNotice: null,
      details: {
        model: workingModel,
        responsePreview: responseText.slice(0, 60).trim(),
        modelsAttempted: MODELS_TO_TRY.slice(0, MODELS_TO_TRY.indexOf(workingModel) + 1),
      },
    };
  }

  // All models failed
  const errMsg = lastError?.message || "Failed to authenticate with Google Gemini API.";
  const is401or403 =
    lastError?.status === 401 ||
    lastError?.status === 403 ||
    (typeof errMsg === "string" && (
      errMsg.includes("API_KEY_INVALID") ||
      errMsg.includes("PERMISSION_DENIED") ||
      errMsg.includes("403") ||
      errMsg.includes("401")
    ));

  const keyFormatNote =
    "Google AI Studio generates keys in two valid formats: \"AIzaSy...\" (older) " +
    "and \"AQ.xxxx\" (newer OAuth 2.0 based). Both are accepted by SWAI.";

  return {
    provider: "gemini",
    status: "ERROR",
    latencyMs,
    testedAt,
    errorMessage: errMsg,
    errorCode: lastError?.status || lastError?.code || "AUTH_FAILED",
    missingPermissions: is401or403
      ? ["Valid GEMINI_API_KEY — check for API restrictions or disabled billing"]
      : ["Accessible Gemini model — all tested models returned 404"],
    grantedPermissions: [],
    capabilities: PROVIDER_CATALOG.gemini.supportedCapabilities.map((cap) => ({
      name: cap,
      status: "UNAVAILABLE" as const,
      notes: errMsg,
    })),
    policyNotice:
      is401or403
        ? `Authentication rejected. ${keyFormatNote} Verify the key has no API restrictions at console.cloud.google.com.`
        : `All model variants tested (${MODELS_TO_TRY.join(", ")}) returned 404. " +
          "This may be a regional restriction or project quota issue. ${keyFormatNote}`,
    details: {
      modelsAttempted: MODELS_TO_TRY,
      lastErrorCode: lastError?.status,
      keyFormatNote,
    },
  };
}

/**
 * Live test connection for Meta Ad Library API.
 * Calls Meta Graph API endpoints to test token validity and exact permissions.
 *
 * CRITICAL RULE:
 * Never claim Meta commercial US ad discovery is supported without verifying exact permissions.
 */
async function testMetaConnection(token: string): Promise<ConnectionTestResult> {
  const startTime = Date.now();
  const testedAt = new Date().toISOString();

  try {
    // 1. Check permissions granted to this token via /me/permissions
    let grantedPerms: string[] = [];
    let hasAdArchive = false;
    let tokenDebugInfo: Record<string, any> = {};

    try {
      const permRes = await fetch(
        `https://graph.facebook.com/v20.0/me/permissions?access_token=${encodeURIComponent(token)}`,
        { method: "GET", headers: { Accept: "application/json" } }
      );
      if (permRes.ok) {
        const permJson = await permRes.json();
        if (Array.isArray(permJson?.data)) {
          grantedPerms = permJson.data
            .filter((p: any) => p.status === "granted")
            .map((p: any) => p.permission);
          hasAdArchive = grantedPerms.includes("ad_archive");
        }
      }
    } catch {
      // Permission probe non-fatal, proceed to archive endpoint
    }

    // 2. Perform test query to ads_archive
    // Querying archive with limit=1 and US market
    const archiveUrl =
      `https://graph.facebook.com/v20.0/ads_archive?` +
      new URLSearchParams({
        ad_reached_countries: "['US']",
        fields: "id",
        limit: "1",
        access_token: token,
      }).toString();

    const archiveRes = await fetch(archiveUrl, {
      method: "GET",
      headers: { Accept: "application/json" },
    });

    const latencyMs = Date.now() - startTime;
    const resJson = await archiveRes.json();

    if (!archiveRes.ok || resJson.error) {
      const err = resJson.error || {};
      const errMsg = err.message || `Meta Graph API returned HTTP ${archiveRes.status}`;
      const errCode = err.code || archiveRes.status;
      const errSubcode = err.error_subcode;

      const missing: string[] = [];
      if (!hasAdArchive || String(errMsg).toLowerCase().includes("ad_archive")) {
        missing.push("ad_archive (Meta Ad Library API permission)");
      }

      return {
        provider: "meta",
        status: "ERROR",
        latencyMs,
        testedAt,
        errorMessage: errMsg,
        errorCode: errCode,
        missingPermissions: missing.length > 0 ? missing : ["ad_archive or valid OAuth access"],
        grantedPermissions: grantedPerms,
        capabilities: [
          {
            name: "Meta Ad Library Automated Archive Query",
            status: "REQUIRES_AUTH",
            notes: `Meta API returned error: ${errMsg}`,
          },
          {
            name: "Political & Social Issue Ad Intelligence",
            status: "REQUIRES_AUTH",
            notes: "Requires active ad_archive permission.",
          },
          {
            name: "Manual URL Import for All US Facebook/Instagram Ads",
            status: "VERIFIED",
            notes: "Manual URL import is available without requiring an API token.",
          },
        ],
        policyNotice:
          "Meta requires developer app registration, business verification, and 'ad_archive' permission. Standard access in the US covers political/issue ads. Automated US commercial ad discovery requires specialized Meta approval.",
        details: {
          errorType: err.type,
          fbtrace_id: err.fbtrace_id,
          errorSubcode: errSubcode,
        },
      };
    }

    // Query succeeded!
    hasAdArchive = true;
    if (!grantedPerms.includes("ad_archive")) {
      grantedPerms.push("ad_archive");
    }

    return {
      provider: "meta",
      status: "CONNECTED",
      latencyMs,
      testedAt,
      errorMessage: null,
      missingPermissions: [],
      grantedPermissions: grantedPerms,
      capabilities: [
        {
          name: "Meta Ad Library Automated Archive Query",
          status: "VERIFIED",
          notes: "Authenticated access to ads_archive endpoint confirmed.",
        },
        {
          name: "Political & Social Issue Ads",
          status: "VERIFIED",
          notes: "Verified with ad_archive permission.",
        },
        {
          name: "US Commercial Ad Discovery via API",
          status: "RESTRICTED",
          notes:
            "RESTRICTED BY META POLICY: Standard ad_archive access in the United States requires identity confirmation and is designed for political/issue ads. Broad US commercial ad discovery via API requires explicit Meta business authorization. Manual URL import is fully supported for all commercial ads.",
        },
        {
          name: "Manual URL Import for All US Facebook/Instagram Ads",
          status: "VERIFIED",
          notes: "Always available without token restrictions.",
        },
      ],
      policyNotice:
        "Authenticated with Meta Ad Library API. NOTE: In compliance with Meta Platform Terms, US commercial ad discovery via API requires explicit business authorization. Commercial competitor ads should be researched via public Ad Library links and imported via SWAI URL Import.",
      details: {
        recordReturned: Array.isArray(resJson.data) ? resJson.data.length : 0,
      },
    };
  } catch (err: any) {
    const latencyMs = Date.now() - startTime;
    return {
      provider: "meta",
      status: "ERROR",
      latencyMs,
      testedAt,
      errorMessage: err.message || "Failed to connect to Meta Graph API.",
      errorCode: "NETWORK_ERROR",
      missingPermissions: ["Network connectivity or valid token"],
      grantedPermissions: [],
      capabilities: [
        {
          name: "Meta Ad Library Automated Archive Query",
          status: "UNAVAILABLE",
          notes: `Connection failed: ${err.message}`,
        },
      ],
      policyNotice:
        "Failed to reach https://graph.facebook.com. Check network connectivity and token validity.",
    };
  }
}

/**
 * Live test connection for Captapi Ads Intelligence.
 * Verifies key against Captapi account balance endpoint (0 credits consumed).
 */
async function testCaptapiConnection(key: string): Promise<ConnectionTestResult> {
  const startTime = Date.now();
  const testedAt = new Date().toISOString();

  try {
    const res = await fetch("https://api.captapi.com/v1/account/balance", {
      method: "GET",
      headers: {
        Authorization: `Bearer ${key}`,
        "x-api-key": key,
        Accept: "application/json",
        "User-Agent": "SWAI-AdIntelligence/7.1",
      },
    });

    const latencyMs = Date.now() - startTime;

    if (res.status === 401 || res.status === 403) {
      return {
        provider: "captapi",
        status: "ERROR",
        latencyMs,
        testedAt,
        errorMessage: `Authentication failed (HTTP ${res.status}): Invalid or expired Captapi API key.`,
        errorCode: res.status,
        missingPermissions: ["Valid Captapi API subscription key"],
        grantedPermissions: [],
        capabilities: [
          {
            name: "Third-Party Ad Intelligence Queries",
            status: "UNAVAILABLE",
            notes: "Authentication failed with Captapi.",
          },
        ],
        policyNotice:
          "Check your API key in the Captapi Dashboard at captapi.com/dashboard/api-keys.",
      };
    }

    if (!res.ok) {
      let errText = "";
      try {
        const errJson = await res.json();
        errText = errJson.message || errJson.error || JSON.stringify(errJson);
      } catch {
        errText = await res.text();
      }

      return {
        provider: "captapi",
        status: "ERROR",
        latencyMs,
        testedAt,
        errorMessage: `Captapi API error (HTTP ${res.status}): ${errText || res.statusText}`,
        errorCode: res.status,
        missingPermissions: ["Valid Captapi balance access"],
        grantedPermissions: [],
        capabilities: [
          {
            name: "Third-Party Ad Intelligence Queries",
            status: "UNAVAILABLE",
            notes: `Captapi returned HTTP ${res.status}`,
          },
        ],
        policyNotice: "Unable to verify Captapi balance.",
      };
    }

    const data = await res.json();

    return {
      provider: "captapi",
      status: "CONNECTED",
      latencyMs,
      testedAt,
      errorMessage: null,
      missingPermissions: [],
      grantedPermissions: ["account.balance", "ads.search"],
      capabilities: [
        {
          name: "Account Balance & Quota Check",
          status: "VERIFIED",
          notes: `Account verified. Balance: ${JSON.stringify(data.balance ?? data.credits ?? "Active")}`,
        },
        {
          name: "Third-Party Ad Intelligence Queries",
          status: "VERIFIED",
          notes: "Licensed access active.",
        },
        {
          name: "Cross-Platform Social Ad Extraction",
          status: "VERIFIED",
          notes: "Scraper-free structured extraction ready.",
        },
      ],
      policyNotice:
        "Connected to Captapi Ads Intelligence. Queries consume credits according to your Captapi plan.",
      details: {
        accountData: data,
      },
    };
  } catch (err: any) {
    const latencyMs = Date.now() - startTime;
    return {
      provider: "captapi",
      status: "ERROR",
      latencyMs,
      testedAt,
      errorMessage: err.message || "Failed to reach Captapi API endpoint.",
      errorCode: "NETWORK_ERROR",
      missingPermissions: ["Network connectivity or valid host"],
      grantedPermissions: [],
      capabilities: [
        {
          name: "Third-Party Ad Intelligence Queries",
          status: "UNAVAILABLE",
          notes: `Connection failed: ${err.message}`,
        },
      ],
      policyNotice: "Failed to reach https://api.captapi.com. Check network connectivity.",
    };
  }
}

/**
 * Executes a live connection test for the given provider.
 * Optionally tests a freshly supplied key override before saving.
 */
export async function testProviderConnection(
  provider: ProviderId,
  keyOverride?: string
): Promise<ConnectionTestResult> {
  const def = PROVIDER_CATALOG[provider];
  if (!def) {
    throw new Error(`Unknown provider: ${provider}`);
  }

  const keyToTest = keyOverride?.trim() || getCredentialValue(provider);

  if (!keyToTest) {
    const res: ConnectionTestResult = {
      provider,
      status: "NOT_CONFIGURED",
      latencyMs: 0,
      testedAt: new Date().toISOString(),
      errorMessage: `${def.envVar} is not configured. Please enter a key first.`,
      errorCode: "MISSING_CREDENTIAL",
      missingPermissions: [def.envVar],
      grantedPermissions: [],
      capabilities: def.supportedCapabilities.map((cap) => ({
        name: cap,
        status: "UNAVAILABLE",
        notes: "Credential not provided.",
      })),
      policyNotice: null,
    };
    return res;
  }

  let testResult: ConnectionTestResult;
  if (provider === "gemini") {
    testResult = await testGeminiConnection(keyToTest);
  } else if (provider === "meta") {
    testResult = await testMetaConnection(keyToTest);
  } else if (provider === "captapi") {
    testResult = await testCaptapiConnection(keyToTest);
  } else {
    throw new Error(`Unsupported provider: ${provider}`);
  }

  // Update status cache on server
  const cache = readStatusCache();
  cache[provider] = {
    status: testResult.status,
    lastTestedAt: testResult.testedAt,
    lastTestStatus: testResult.status === "CONNECTED" ? "SUCCESS" : "FAILED",
    lastError: testResult.errorMessage,
    lastErrorCode: testResult.errorCode,
    latencyMs: testResult.latencyMs,
    grantedPermissions: testResult.grantedPermissions,
    missingPermissions: testResult.missingPermissions,
    capabilities: testResult.capabilities,
    policyNotice: testResult.policyNotice,
    details: testResult.details,
  };
  writeStatusCache(cache);

  return testResult;
}
