import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";
import { POST as credentialsPost } from "@/app/api/v1/settings/credentials/route";
import { GET as searchGet } from "@/app/api/v1/search/route";
import { resolveAuthorizedResearchContext } from "@/services/research/researchAuthService";

describe("Admin Access & Endpoint Security Integration", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("permits local loopback research search in desktop development", async () => {
    const req = new NextRequest("http://localhost:3000/api/v1/search?q=test");
    const res = await searchGet(req);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
  });

  it("rejects search when remote deployment mode is active without credentials", async () => {
    process.env.SWAI_DEPLOYMENT_MODE = "REMOTE";
    const req = new NextRequest("http://localhost:3000/api/v1/search?q=test");
    const res = await searchGet(req);
    expect(res.status).toBe(401);
  });

  it("rejects search with spoofed Host header over remote network interface", async () => {
    const req = new NextRequest("http://localhost:3000/api/v1/search?q=test", {
      headers: {
        host: "localhost:3000",
        "x-forwarded-for": "198.51.100.25",
      },
    });
    const res = await searchGet(req);
    expect(res.status).toBe(401);
  });

  it("strictly enforces matching admin token on credentials mutation", async () => {
    process.env.ADMIN_API_KEY = "configured_master_key_777";
    const unauthReq = new NextRequest("http://localhost:3000/api/v1/settings/credentials", {
      method: "POST",
      body: JSON.stringify({ provider: "gemini", key: "new_key" }),
    });
    const unauthRes = await credentialsPost(unauthReq);
    expect(unauthRes.status).toBe(401);

    const authReq = new NextRequest("http://localhost:3000/api/v1/settings/credentials", {
      method: "POST",
      headers: {
        Authorization: "Bearer configured_master_key_777",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ provider: "gemini", key: "AIzaSy_mock_valid_key_12345" }),
    });
    const authRes = await credentialsPost(authReq);
    expect(authRes.status).toBe(200);
  });
});
