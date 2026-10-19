import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "fs";
import path from "path";
import {
  maskApiKey,
  PROVIDER_CATALOG,
  getCredentialValue,
  saveCredential,
  removeCredential,
  getProviderConnectionStates,
  testProviderConnection,
  ProviderId,
} from "@/services/credentials/credentialService";
import { GET, POST, DELETE } from "@/app/api/v1/settings/credentials/route";
import { POST as runTestPost } from "@/app/api/v1/settings/credentials/test/route";
import { NextRequest } from "next/server";

const ENV_LOCAL_TEST = path.join(process.cwd(), ".env.local");
const STATUS_CACHE_TEST = path.join(process.cwd(), ".connection-status.json");

describe("Server-Side Credential Management & Security", () => {
  const originalEnv = { ...process.env };
  let originalEnvLocal: string | null = null;
  let originalStatusCache: string | null = null;

  beforeEach(() => {
    // Backup any existing .env.local or status cache
    if (fs.existsSync(ENV_LOCAL_TEST)) {
      originalEnvLocal = fs.readFileSync(ENV_LOCAL_TEST, "utf-8");
    } else {
      originalEnvLocal = null;
    }
    if (fs.existsSync(STATUS_CACHE_TEST)) {
      originalStatusCache = fs.readFileSync(STATUS_CACHE_TEST, "utf-8");
    } else {
      originalStatusCache = null;
    }

    // Clean env variables for testing
    delete process.env.GEMINI_API_KEY;
    delete process.env.META_AD_LIBRARY_ACCESS_TOKEN;
    delete process.env.CAPTAPI_KEY;
  });

  afterEach(() => {
    // Restore env variables
    process.env = { ...originalEnv };

    // Restore files
    if (originalEnvLocal !== null) {
      fs.writeFileSync(ENV_LOCAL_TEST, originalEnvLocal);
    } else if (fs.existsSync(ENV_LOCAL_TEST)) {
      fs.unlinkSync(ENV_LOCAL_TEST);
    }

    if (originalStatusCache !== null) {
      fs.writeFileSync(STATUS_CACHE_TEST, originalStatusCache);
    } else if (fs.existsSync(STATUS_CACHE_TEST)) {
      fs.unlinkSync(STATUS_CACHE_TEST);
    }

    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  describe("API Key Masking Security", () => {
    it("never returns raw API keys in masked output", () => {
      const sensitiveKey = "AIzaSyD-1234567890abcdefXYZ9876";
      const masked = maskApiKey(sensitiveKey);

      expect(masked).toBeDefined();
      expect(masked).not.toBe(sensitiveKey);
      expect(masked).toContain("••••••••••••");
      expect(masked?.endsWith("9876")).toBe(true);
      expect(masked).not.toContain("AIzaSyD");
      expect(masked).not.toContain("1234567890");
    });

    it("handles short keys securely", () => {
      expect(maskApiKey("short12")).toBe("••••••••");
      expect(maskApiKey("12345678")).toBe("••••••••");
    });

    it("returns null for null, undefined, or empty strings", () => {
      expect(maskApiKey(null)).toBeNull();
      expect(maskApiKey(undefined)).toBeNull();
      expect(maskApiKey("")).toBeNull();
      expect(maskApiKey("   ")).toBeNull();
    });
  });

  describe("Provider Catalog Definition", () => {
    it("defines Google Gemini AI with GEMINI_API_KEY", () => {
      const def = PROVIDER_CATALOG.gemini;
      expect(def).toBeDefined();
      expect(def.envVar).toBe("GEMINI_API_KEY");
      expect(def.name).toContain("Gemini");
      expect(def.setupInstructions.steps.length).toBeGreaterThan(0);
      expect(def.docsUrl).toContain("aistudio.google.com");
    });

    it("defines Meta Ad Library with META_AD_LIBRARY_ACCESS_TOKEN", () => {
      const def = PROVIDER_CATALOG.meta;
      expect(def).toBeDefined();
      expect(def.envVar).toBe("META_AD_LIBRARY_ACCESS_TOKEN");
      expect(def.name).toContain("Meta Ad Library");
      expect(def.setupInstructions.securityNote).toContain("commercial ads");
    });

    it("defines Captapi with CAPTAPI_KEY", () => {
      const def = PROVIDER_CATALOG.captapi;
      expect(def).toBeDefined();
      expect(def.envVar).toBe("CAPTAPI_KEY");
      expect(def.name).toContain("Captapi");
      expect(def.docsUrl).toContain("captapi.com");
    });
  });

  describe("Secure Storage: Save & Remove", () => {
    it("saves credentials to server environment and .env.local without exposing them", async () => {
      const testKey = "capt_live_998877665544332211";
      const saveRes = await saveCredential("captapi", testKey);

      expect(saveRes.success).toBe(true);
      expect(saveRes.maskedKey).toBe("••••••••••••2211");
      expect(saveRes.maskedKey).not.toContain("capt_live");

      // Verify in-memory env is populated
      expect(process.env.CAPTAPI_KEY).toBe(testKey);

      // Verify .env.local is written
      expect(fs.existsSync(ENV_LOCAL_TEST)).toBe(true);
      const content = fs.readFileSync(ENV_LOCAL_TEST, "utf-8");
      expect(content).toContain('CAPTAPI_KEY="capt_live_998877665544332211"');
    });

    it("resets status to KEY_PRESENT_UNVERIFIED upon saving a new key", async () => {
      await saveCredential("gemini", "AIzaSyFakeKeyForTest12345");
      const states = getProviderConnectionStates();

      expect(states.gemini.configured).toBe(true);
      expect(states.gemini.status).toBe("KEY_PRESENT_UNVERIFIED");
      expect(states.gemini.status).not.toBe("CONNECTED");
    });

    it("removes credentials from server environment and .env.local", async () => {
      await saveCredential("meta", "EAABtesttoken12345");
      expect(process.env.META_AD_LIBRARY_ACCESS_TOKEN).toBe("EAABtesttoken12345");

      const removeRes = await removeCredential("meta");
      expect(removeRes.success).toBe(true);
      expect(process.env.META_AD_LIBRARY_ACCESS_TOKEN).toBeUndefined();

      const states = getProviderConnectionStates();
      expect(states.meta.configured).toBe(false);
      expect(states.meta.status).toBe("NOT_CONFIGURED");
    });
  });

  describe("Live Connection Testing Rules", () => {
    it("returns NOT_CONFIGURED when testing without a key", async () => {
      const res = await testProviderConnection("gemini");
      expect(res.status).toBe("NOT_CONFIGURED");
      expect(res.errorMessage).toContain("GEMINI_API_KEY is not configured");
      expect(res.missingPermissions).toContain("GEMINI_API_KEY");
    });

    it("does NOT mark Gemini CONNECTED when API authentication fails", async () => {
      const badKey = "AIzaSy_definitely_invalid_key_99999";
      const res = await testProviderConnection("gemini", badKey);

      expect(res.status).toBe("ERROR");
      expect(res.status).not.toBe("CONNECTED");
      expect(res.errorMessage).toBeDefined();
      expect(res.missingPermissions.length).toBeGreaterThan(0);
    });

    it("Meta: does NOT claim US commercial ad discovery is supported without verifying permissions", async () => {
      // Mock fetch for Meta Graph API where ad_archive permission is missing
      const mockFetch = vi.fn().mockImplementation(async (url: string) => {
        if (url.includes("/me/permissions")) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              data: [{ permission: "email", status: "granted" }],
            }),
          };
        }
        if (url.includes("/ads_archive")) {
          return {
            ok: false,
            status: 400,
            json: async () => ({
              error: {
                message: "(#10) Application does not have permission for this action: ad_archive",
                type: "OAuthException",
                code: 10,
              },
            }),
          };
        }
        return { ok: false, status: 404, json: async () => ({}) };
      });

      vi.stubGlobal("fetch", mockFetch);

      const res = await testProviderConnection("meta", "EAAB_test_token_no_archive");

      expect(res.status).toBe("ERROR");
      expect(res.status).not.toBe("CONNECTED");
      expect(res.missingPermissions).toContain("ad_archive (Meta Ad Library API permission)");
      expect(res.policyNotice).toContain("ad_archive");
    });

    it("Meta: when ad_archive succeeds, explicitly marks US commercial discovery as RESTRICTED", async () => {
      const mockFetch = vi.fn().mockImplementation(async (url: string) => {
        if (url.includes("/me/permissions")) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              data: [{ permission: "ad_archive", status: "granted" }],
            }),
          };
        }
        if (url.includes("/ads_archive")) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              data: [{ id: "123456789" }],
            }),
          };
        }
        return { ok: false, status: 404, json: async () => ({}) };
      });

      vi.stubGlobal("fetch", mockFetch);

      const res = await testProviderConnection("meta", "EAAB_valid_archive_token");

      expect(res.status).toBe("CONNECTED");
      expect(res.grantedPermissions).toContain("ad_archive");

      // Verify that US commercial discovery is NOT falsely claimed as fully supported
      const commercialCap = res.capabilities.find((c) =>
        c.name.toLowerCase().includes("commercial")
      );
      expect(commercialCap).toBeDefined();
      expect(commercialCap?.status).toBe("RESTRICTED");
      expect(commercialCap?.notes).toContain("RESTRICTED BY META POLICY");
    });

    it("Captapi: marks ERROR on HTTP 401/403 and never marks CONNECTED", async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
        statusText: "Unauthorized",
        json: async () => ({ error: "Invalid API key" }),
      });
      vi.stubGlobal("fetch", mockFetch);

      const res = await testProviderConnection("captapi", "capt_live_invalid_key_test");
      expect(res.status).toBe("ERROR");
      expect(res.status).not.toBe("CONNECTED");
      expect(res.errorCode).toBe(401);
      expect(res.errorMessage).toContain("401");
    });

    it("Captapi: marks CONNECTED on HTTP 200 balance check", async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ balance: 500, credits_remaining: 500 }),
      });
      vi.stubGlobal("fetch", mockFetch);

      const res = await testProviderConnection("captapi", "capt_live_valid_key_test");
      expect(res.status).toBe("CONNECTED");
      expect(res.errorMessage).toBeNull();
      expect(res.capabilities.some((c) => c.status === "VERIFIED")).toBe(true);
    });
  });

  describe("API Endpoints Security & Integrity", () => {
    it("GET /api/v1/settings/credentials never returns raw API keys", async () => {
      process.env.GEMINI_API_KEY = "AIzaSySuperSecretKey1234567890ABCDEF";
      process.env.META_AD_LIBRARY_ACCESS_TOKEN = "EAABRealSecretTokenMeta999888";

      const res = await GET();
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.success).toBe(true);
      expect(body.data.providers).toBeDefined();

      const rawResponseText = JSON.stringify(body);
      expect(rawResponseText).not.toContain("AIzaSySuperSecretKey1234567890");
      expect(rawResponseText).not.toContain("EAABRealSecretTokenMeta");
      expect(body.data.providers.gemini.maskedKey).toContain("••••••••••••CDEF");
      expect(body.data.shopify.status).toBe("NOT_CONNECTED");
    });

    it("POST /api/v1/settings/credentials saves securely and does not echo raw key", async () => {
      const rawKey = "AIzaSySecretNewKey1234567890xyz";
      const req = new NextRequest("http://localhost:3000/api/v1/settings/credentials", {
        method: "POST",
        body: JSON.stringify({
          provider: "gemini",
          key: rawKey,
        }),
      });

      const res = await POST(req);
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(json.success).toBe(true);
      expect(json.data.maskedKey).toBeDefined();
      expect(json.data.maskedKey).not.toContain("AIzaSySecretNewKey");

      const responseString = JSON.stringify(json);
      expect(responseString).not.toContain(rawKey);

      expect(process.env.GEMINI_API_KEY).toBe(rawKey);
    });

    it("POST /api/v1/settings/credentials rejects invalid providers and empty keys", async () => {
      const badReq = new NextRequest("http://localhost:3000/api/v1/settings/credentials", {
        method: "POST",
        body: JSON.stringify({ provider: "unknown_hack", key: "123" }),
      });
      const badRes = await POST(badReq);
      expect(badRes.status).toBe(400);

      const emptyReq = new NextRequest("http://localhost:3000/api/v1/settings/credentials", {
        method: "POST",
        body: JSON.stringify({ provider: "gemini", key: "   " }),
      });
      const emptyRes = await POST(emptyReq);
      expect(emptyRes.status).toBe(400);
    });

    it("DELETE /api/v1/settings/credentials removes the key", async () => {
      process.env.CAPTAPI_KEY = "capt_live_to_delete_9999";

      const req = new NextRequest("http://localhost:3000/api/v1/settings/credentials", {
        method: "DELETE",
        body: JSON.stringify({ provider: "captapi" }),
      });

      const res = await DELETE(req);
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(json.success).toBe(true);
      expect(process.env.CAPTAPI_KEY).toBeUndefined();
    });

    it("POST /api/v1/settings/credentials/test triggers live test and returns result", async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
        json: async () => ({ message: "Unauthorized" }),
      });
      vi.stubGlobal("fetch", mockFetch);

      const req = new NextRequest("http://localhost:3000/api/v1/settings/credentials/test", {
        method: "POST",
        body: JSON.stringify({
          provider: "captapi",
          key: "capt_live_invalid_123",
        }),
      });

      const res = await runTestPost(req);
      const json = await res.json();

      expect(json.data.provider).toBe("captapi");
      expect(json.data.status).toBe("ERROR");
      expect(json.meta.verified).toBe(false);
    });
  });
});
