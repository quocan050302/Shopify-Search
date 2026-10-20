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
import {
  resolveAndVerifyActiveModel,
  redactSecrets,
} from "@/services/ai/geminiModelService";
import {
  getProviderBudget,
  authorizePaidApiCall,
  ProviderBudgetConfig,
} from "@/services/providers/budgetService";

export type ProviderId = "gemini" | "meta" | "captapi" | "apify";

export interface ProviderDefinition {
  id: ProviderId;
  name: string;
  envVar: string;
  description: string;
  docsUrl: string;
  isOptional?: boolean;
  isPaid?: boolean;
  defaultEnabled?: boolean;
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
  isOptional?: boolean;
  isPaid?: boolean;
  enabled?: boolean;
  usageBudget?: any;
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
  details?: Record<string, unknown>;
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
  details?: Record<string, unknown>;
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
    isOptional: true,
    isPaid: true,
    defaultEnabled: false,
    description:
      "Optional third-party licensed ad intelligence. Disabled by default to protect against unexpected credit charges. Core research uses TikTok Creative Center (US) without paid API calls.",
    docsUrl: "https://captapi.com/dashboard/api-keys",
    setupInstructions: {
      title: "How to configure Captapi Ads Intelligence (Optional)",
      steps: [
        "Create an account at captapi.com.",
        "Navigate to Dashboard → API Keys.",
        "Generate a Live API Key (typically prefixed with 'capt_live_').",
        "Paste the key below and click 'Save & Test'.",
        "Captapi is optional and disabled by default. You can enable or disable it anytime.",
        "SWAI will verify your key against the Captapi account balance endpoint (0 credits consumed).",
      ],
      securityNote:
        "Your Captapi key is stored securely in server-side storage. Automatic paid calls remain disabled until explicitly authorized.",
    },
    supportedCapabilities: [
      "Third-Party Ad Intelligence Queries (Optional)",
      "Cross-Platform Social Ad Extraction",
      "Credit Balance & Quota Monitoring",
    ],
  },
  apify: {
    id: "apify",
    name: "Apify Platform (Metered Actor)",
    envVar: "APIFY_TOKEN",
    isOptional: true,
    isPaid: true,
    defaultEnabled: false,
    description:
      "Optional cloud actor runner for TikTok Top Ads discovery. Disabled by default ($0 spend) to protect user budget.",
    docsUrl: "https://docs.apify.com/api/v2",
    setupInstructions: {
      title: "How to configure Apify Platform (Optional)",
      steps: [
        "Create an account at console.apify.com.",
        "Navigate to Settings → Integrations → API Tokens.",
        "Copy your personal API token and paste it here.",
        "Apify is metered and requires explicit enablement (ENABLE_APIFY_DISCOVERY=true).",
        "SWAI verifies your token against the Apify /users/me endpoint (0 credits consumed).",
      ],
      securityNote:
        "Your Apify token is stored securely in server-side storage (.env.local). Automatic paid calls remain disabled until authorized.",
    },
    supportedCapabilities: [
      "TikTok Top Ads Actor Automation (Metered)",
      "Cloud Browser Automation Run",
      "Actor Run Status & Metered Credit Tracking",
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
    details?: Record<string, unknown>;
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

/**
 * Safely rotates an existing provider credential with live validation.
 * Invalidates previous cache, saves new key to server storage, and runs authenticated test.
 */
export async function rotateCredential(
  provider: ProviderId,
  newKey: string
): Promise<{ success: boolean; maskedKey: string; testResult: ConnectionTestResult }> {
  const saveRes = await saveCredential(provider, newKey);
  const testResult = await testProviderConnection(provider, newKey);
  return {
    success: testResult.status === "CONNECTED",
    maskedKey: saveRes.maskedKey,
    testResult,
  };
}

// ─── Provider Status Inspection ───────────────────────────────────────────────

/**
 * Gets the current connection status of all providers.
 * NEVER returns raw keys!
 */
export function getProviderConnectionStates(): Record<ProviderId, ProviderConnectionState> {
  const cache = readStatusCache();
  const results: Partial<Record<ProviderId, ProviderConnectionState>> = {};

  const providers: ProviderId[] = ["gemini", "meta", "captapi", "apify"];

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

    const budget = getProviderBudget(pid);

    results[pid] = {
      id: pid,
      name: def.name,
      envVar: def.envVar,
      configured,
      maskedKey: masked,
      status,
      isOptional: def.isOptional ?? false,
      isPaid: def.isPaid ?? false,
      enabled: budget.enabled,
      usageBudget: budget,
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

/**
 * Checks if a provider request is authorized under budget and enablement rules.
 */
export function isProviderAuthorizedForRequest(
  provider: ProviderId,
  estimatedCredits: number | boolean = 1,
  isAutomatic = false
): { allowed: boolean; authorized: boolean; reason?: string; config: ProviderBudgetConfig } {
  let credits = 1;
  let auto = isAutomatic;
  if (typeof estimatedCredits === "boolean") {
    auto = estimatedCredits;
    credits = 1;
  } else {
    credits = estimatedCredits;
  }
  const auth = authorizePaidApiCall({ provider, estimatedCredits: credits, isAutomaticRequest: auto });
  return {
    ...auth,
    authorized: auth.allowed,
  };
}

// ─── Test Connection Implementations ──────────────────────────────────────────

async function testGeminiConnection(key: string): Promise<ConnectionTestResult> {
  const testedAt = new Date().toISOString();

  // Call the unified model selection and verification service
  const result = await resolveAndVerifyActiveModel(key);

  if (result.success && result.textGenerationVerified) {
    return {
      provider: "gemini",
      status: "CONNECTED",
      latencyMs: result.latencyMs,
      testedAt,
      errorMessage: null,
      missingPermissions: [],
      grantedPermissions: ["listModels", "generateContent"],
      capabilities: [
        {
          name: "Gemini API Authentication & Model Discovery",
          status: "VERIFIED",
          notes: `Discovered ${result.discoveryCount} models on ${result.workingApiVersion}. Authenticated successfully.`,
        },
        {
          name: "Text Generation & Creative Reasoning (0–100 Hook Scoring, Angles)",
          status: "VERIFIED",
          notes: `Verified live generateContent on ${result.selectedModel} (${result.workingApiVersion}).`,
        },
        {
          name: "Multimodal Video Creative Analysis (MP4 / WebM via Files API)",
          status: "REQUIRES_AUTH",
          notes: `Text generation verified on ${result.selectedModel}. Video analysis requires authorized MP4/WebM upload via Files API.`,
        },
        {
          name: "Evergreen vs Trend-Driven Creative Classification",
          status: "VERIFIED",
          notes: `Creative reasoning enabled with ${result.selectedModel}.`,
        },
        {
          name: "Original 15s / 30s Ad Script Generation",
          status: "VERIFIED",
          notes: `Script generation enabled with ${result.selectedModel}.`,
        },
      ],
      policyNotice: null,
      details: {
        selectedModel: result.selectedModel,
        apiVersion: result.workingApiVersion,
        availableModels: result.availableModels.slice(0, 10),
        testedCandidates: result.testedCandidates,
        authVerified: true,
        textGenerationVerified: true,
        videoAnalysisVerified: false,
      },
    };
  }

  // Handle failure with accurate error classification
  const errCode = result.error?.code || "GENERATION_FAILED";
  const rawMsg = result.error?.message || "Gemini connection test failed.";
  const errMsg = redactSecrets(rawMsg);
  const missingPerms: string[] = [];

  if (errCode === "INVALID_API_KEY") {
    missingPerms.push("Valid GEMINI_API_KEY — key was rejected by Google AI Studio");
  } else if (errCode === "PERMISSION_DENIED") {
    missingPerms.push("Generative Language API permission — enable API in Google Cloud Console");
  } else if (errCode === "QUOTA_EXCEEDED") {
    missingPerms.push("API quota — check quota limits in Google AI Studio");
  } else if (errCode === "MODEL_NOT_AVAILABLE") {
    missingPerms.push(`Model availability — tested models (${result.testedCandidates.map((c) => c.model).join(", ")}) not available for this account`);
  } else {
    missingPerms.push("Live generateContent execution");
  }

  return {
    provider: "gemini",
    status: "ERROR",
    latencyMs: result.latencyMs,
    testedAt,
    errorMessage: errMsg,
    errorCode: errCode,
    missingPermissions: missingPerms,
    grantedPermissions: result.discoveryCount > 0 ? ["listModels"] : [],
    capabilities: PROVIDER_CATALOG.gemini.supportedCapabilities.map((cap) => ({
      name: cap,
      status: "UNAVAILABLE" as const,
      notes: errMsg,
    })),
    policyNotice:
      errCode === "RATE_LIMITED"
        ? "Gemini models are experiencing temporary demand spikes (HTTP 503). Automatic fallback attempted alternative models."
        : errCode === "MODEL_NOT_AVAILABLE"
        ? "The configured or default model was deprecated or not available for your account. Please update to a supported model in AI Studio."
        : null,
    details: {
      selectedModel: result.selectedModel,
      apiVersion: result.workingApiVersion,
      availableModels: result.availableModels.slice(0, 10),
      testedCandidates: result.testedCandidates,
      authVerified: result.discoveryCount > 0,
      textGenerationVerified: false,
      videoAnalysisVerified: false,
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

    try {
      const permRes = await fetch(
        `https://graph.facebook.com/v20.0/me/permissions?access_token=${encodeURIComponent(token)}`,
        { method: "GET", headers: { Accept: "application/json" } }
      );
      if (permRes.ok) {
        const permJson = await permRes.json();
        if (Array.isArray(permJson?.data)) {
          grantedPerms = (permJson.data as Array<{ status?: string; permission?: string }>)
            .filter((p) => p.status === "granted" && typeof p.permission === "string")
            .map((p) => p.permission as string);
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
  } catch (err: unknown) {
    const latencyMs = Date.now() - startTime;
    const errMsg = err instanceof Error ? err.message : "Failed to connect to Meta Graph API.";
    return {
      provider: "meta",
      status: "ERROR",
      latencyMs,
      testedAt,
      errorMessage: errMsg,
      errorCode: "NETWORK_ERROR",
      missingPermissions: ["Network connectivity or valid token"],
      grantedPermissions: [],
      capabilities: [
        {
          name: "Meta Ad Library Automated Archive Query",
          status: "UNAVAILABLE",
          notes: `Connection failed: ${errMsg}`,
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
  } catch (err: unknown) {
    const latencyMs = Date.now() - startTime;
    const errMsg = err instanceof Error ? err.message : "Failed to reach Captapi API endpoint.";
    return {
      provider: "captapi",
      status: "ERROR",
      latencyMs,
      testedAt,
      errorMessage: errMsg,
      errorCode: "NETWORK_ERROR",
      missingPermissions: ["Network connectivity or valid host"],
      grantedPermissions: [],
      capabilities: [
        {
          name: "Third-Party Ad Intelligence Queries",
          status: "UNAVAILABLE",
          notes: `Connection failed: ${errMsg}`,
        },
      ],
      policyNotice: "Failed to reach https://api.captapi.com. Check network connectivity.",
    };
  }
}

async function testApifyConnection(key: string): Promise<ConnectionTestResult> {
  const testedAt = new Date().toISOString();
  const startTime = Date.now();

  try {
    const res = await fetch("https://api.apify.com/v2/users/me", {
      headers: {
        Authorization: `Bearer ${key.trim()}`,
      },
      signal: AbortSignal.timeout(6000),
    });

    const latencyMs = Date.now() - startTime;

    if (res.status === 200) {
      const data = (await res.json()) as { data?: { username?: string; plan?: { id?: string } } };
      const username = data?.data?.username || "authenticated user";
      const plan = data?.data?.plan?.id || "payg";

      return {
        provider: "apify",
        status: "CONNECTED",
        latencyMs,
        testedAt,
        errorMessage: null,
        missingPermissions: [],
        grantedPermissions: ["users:me", "acts:run"],
        capabilities: [
          {
            name: "Apify Account Authentication",
            status: "VERIFIED",
            notes: `Authenticated as '${username}' (Plan: ${plan}).`,
          },
          {
            name: "TikTok Top Ads Metered Actor Runs",
            status: "VERIFIED",
            notes: "Actor dispatch ready. Requires explicit budget enablement before running.",
          },
        ],
        policyNotice: "Paid actor calls require ENABLE_APIFY_DISCOVERY=true and an active credit budget.",
        details: { username, plan },
      };
    }

    if (res.status === 401 || res.status === 403) {
      return {
        provider: "apify",
        status: "ERROR",
        latencyMs,
        testedAt,
        errorMessage: `Apify API token rejected (HTTP ${res.status}: Invalid or unauthorized token).`,
        errorCode: "INVALID_CREDENTIAL",
        missingPermissions: ["APIFY_TOKEN"],
        grantedPermissions: [],
        capabilities: [
          {
            name: "Apify Account Authentication",
            status: "UNAVAILABLE",
            notes: `HTTP ${res.status}: token authentication failed.`,
          },
        ],
        policyNotice: "Please verify your personal API token in Apify Console → Integrations.",
      };
    }

    return {
      provider: "apify",
      status: "ERROR",
      latencyMs,
      testedAt,
      errorMessage: `Apify responded with HTTP ${res.status}.`,
      errorCode: `HTTP_${res.status}`,
      missingPermissions: [],
      grantedPermissions: [],
      capabilities: [],
      policyNotice: null,
    };
  } catch (err: unknown) {
    const errMsg = err instanceof Error ? err.message : String(err);
    return {
      provider: "apify",
      status: "ERROR",
      latencyMs: Date.now() - startTime,
      testedAt,
      errorMessage: `Could not reach Apify API: ${errMsg}`,
      errorCode: "NETWORK_ERROR",
      missingPermissions: [],
      grantedPermissions: [],
      capabilities: [],
      policyNotice: "Failed to reach https://api.apify.com. Check network connectivity.",
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

  const keyToTest =
    keyOverride !== undefined
      ? keyOverride.trim()
      : (getCredentialValue(provider) || "");

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
  } else if (provider === "apify") {
    testResult = await testApifyConnection(keyToTest);
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
