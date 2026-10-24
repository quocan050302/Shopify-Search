import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";
import {
  isTrustedLocalDeployment,
  resolveTrustedRequestContext,
  resolveAdminPrincipal,
  validateAdminRequest,
  requireAdminAuth,
} from "@/services/security/adminAuth";

describe("Admin Authentication Trust Boundary & Deployment Verification", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env.ADMIN_API_KEY;
    delete process.env.SWAI_ADMIN_TOKEN;
    delete process.env.ADMIN_SECRET;
    delete process.env.SWAI_DEPLOYMENT_MODE;
    delete process.env.SWAI_REMOTE_ACCESS;
    delete process.env.HOST;
    delete process.env.PORT;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  describe("isTrustedLocalDeployment", () => {
    it("returns true in default development/test desktop mode", () => {
      (process.env as Record<string, string | undefined>).NODE_ENV = "development";
      expect(isTrustedLocalDeployment()).toBe(true);
    });

    it("returns true when SWAI_LOCAL_DESKTOP is explicitly true", () => {
      process.env.SWAI_LOCAL_DESKTOP = "true";
      (process.env as Record<string, string | undefined>).NODE_ENV = "production";
      expect(isTrustedLocalDeployment()).toBe(true);
    });

    it("returns false when SWAI_DEPLOYMENT_MODE is REMOTE", () => {
      process.env.SWAI_DEPLOYMENT_MODE = "REMOTE";
      expect(isTrustedLocalDeployment()).toBe(false);
    });

    it("returns false when SWAI_REMOTE_ACCESS is true", () => {
      process.env.SWAI_REMOTE_ACCESS = "true";
      expect(isTrustedLocalDeployment()).toBe(false);
    });

    it("returns false when server host is bound to public 0.0.0.0", () => {
      process.env.HOST = "0.0.0.0";
      expect(isTrustedLocalDeployment()).toBe(false);
    });

    it("returns false on cloud container platforms (Vercel, Render, etc.)", () => {
      process.env.VERCEL = "1";
      expect(isTrustedLocalDeployment()).toBe(false);
    });
  });

  describe("resolveTrustedRequestContext", () => {
    it("classifies genuine loopback request as LOCAL_DESKTOP with trustEstablished", () => {
      const req = new NextRequest("http://localhost:3000/api/v1/search");
      const ctx = resolveTrustedRequestContext(req);
      expect(ctx.deploymentMode).toBe("LOCAL_DESKTOP");
      expect(ctx.trustEstablished).toBe(true);
      expect(ctx.authenticationRequired).toBe(false);
    });

    it("rejects loopback request when remote deployment mode is active", () => {
      process.env.SWAI_DEPLOYMENT_MODE = "REMOTE";
      const req = new NextRequest("http://localhost:3000/api/v1/search");
      const ctx = resolveTrustedRequestContext(req);
      expect(ctx.deploymentMode).toBe("REMOTE");
      expect(ctx.trustEstablished).toBe(false);
      expect(ctx.authenticationRequired).toBe(true);
    });

    it("rejects non-loopback destination host", () => {
      const req = new NextRequest("http://192.168.1.50:3000/api/v1/search");
      const ctx = resolveTrustedRequestContext(req);
      expect(ctx.trustEstablished).toBe(false);
      expect(ctx.authenticationRequired).toBe(true);
    });

    it("rejects spoofed x-forwarded-for header from remote client", () => {
      const req = new NextRequest("http://localhost:3000/api/v1/search", {
        headers: { "x-forwarded-for": "203.0.113.195, 127.0.0.1" },
      });
      const ctx = resolveTrustedRequestContext(req);
      expect(ctx.trustEstablished).toBe(false);
      expect(ctx.authenticationRequired).toBe(true);
      expect(ctx.reason).toContain("remote IP");
    });

    it("rejects spoofed x-real-ip header from remote client", () => {
      const req = new NextRequest("http://localhost:3000/api/v1/search", {
        headers: { "x-real-ip": "198.51.100.10" },
      });
      const ctx = resolveTrustedRequestContext(req);
      expect(ctx.trustEstablished).toBe(false);
      expect(ctx.authenticationRequired).toBe(true);
      expect(ctx.reason).toContain("x-real-ip");
    });
  });

  describe("resolveAdminPrincipal & validateAdminRequest", () => {
    it("authorizes local desktop researcher on genuine loopback without credentials", () => {
      const req = new NextRequest("http://localhost:3000/api/v1/search");
      const result = resolveAdminPrincipal(req);
      expect(result.authorized).toBe(true);
      expect(result.principalId).toBe("local_dev_admin");
      expect(result.authMode).toBe("LOCAL_DEV");
    });

    it("authorizes verified administrator when matching secret Bearer token provided", () => {
      process.env.ADMIN_API_KEY = "vault_secret_token_999";
      const req = new NextRequest("http://localhost:3000/api/v1/search", {
        headers: { Authorization: "Bearer vault_secret_token_999" },
      });
      const result = resolveAdminPrincipal(req);
      expect(result.authorized).toBe(true);
      expect(result.principalId).toBe("admin_owner");
      expect(result.authMode).toBe("OWNER_ADMIN");
    });

    it("strictly rejects invalid Bearer token even on localhost", () => {
      process.env.ADMIN_API_KEY = "vault_secret_token_999";
      const req = new NextRequest("http://localhost:3000/api/v1/search", {
        headers: { Authorization: "Bearer wrong_secret" },
      });
      const result = resolveAdminPrincipal(req);
      expect(result.authorized).toBe(false);
      expect(result.code).toBe("INVALID_ADMIN_TOKEN");
    });

    it("fails closed for remote requests without credentials", () => {
      process.env.SWAI_DEPLOYMENT_MODE = "REMOTE";
      const req = new NextRequest("http://localhost:3000/api/v1/search");
      const result = resolveAdminPrincipal(req);
      expect(result.authorized).toBe(false);
      expect(result.code).toBe("ADMIN_AUTH_REQUIRED");
    });
  });

  describe("requireAdminAuth", () => {
    it("requires credentials for sensitive operations when secret is configured", () => {
      process.env.ADMIN_API_KEY = "vault_secret_token_999";
      const req = new NextRequest("http://localhost:3000/api/v1/settings/credentials", {
        method: "POST",
      });
      const res = requireAdminAuth(req);
      expect(res).not.toBeNull();
      expect(res?.status).toBe(401);
    });

    it("permits sensitive operation with matching Bearer token", () => {
      process.env.ADMIN_API_KEY = "vault_secret_token_999";
      const req = new NextRequest("http://localhost:3000/api/v1/settings/credentials", {
        method: "POST",
        headers: { Authorization: "Bearer vault_secret_token_999" },
      });
      const res = requireAdminAuth(req);
      expect(res).toBeNull();
    });
  });
});
