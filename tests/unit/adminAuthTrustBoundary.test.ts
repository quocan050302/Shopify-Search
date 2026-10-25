import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";
import {
  isTrustedLocalDeployment,
  resolveDeploymentSecurityPolicy,
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
    delete process.env.SWAI_LOCAL_DESKTOP;
    delete process.env.SWAI_REQUIRE_AUTH;
    delete process.env.SWAI_E2E_SERVER;
    delete process.env.HOST;
    delete process.env.PORT;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  describe("resolveDeploymentSecurityPolicy", () => {
    it("classifies default local desktop as LOCAL_ONLY with bypass allowed", () => {
      const policy = resolveDeploymentSecurityPolicy();
      expect(policy.mode).toBe("LOCAL_ONLY");
      expect(policy.localBypassAllowed).toBe(true);
      expect(policy.configurationValid).toBe(true);
    });

    it("rejects public 0.0.0.0 binding even in development mode", () => {
      process.env.HOST = "0.0.0.0";
      (process.env as Record<string, string | undefined>).NODE_ENV = "development";
      const policy = resolveDeploymentSecurityPolicy();
      expect(policy.mode).toBe("AUTHENTICATED_REMOTE");
      expect(policy.localBypassAllowed).toBe(false);
    });

    it("detects configuration conflict when SWAI_LOCAL_DESKTOP is true but HOST is 0.0.0.0", () => {
      process.env.HOST = "0.0.0.0";
      process.env.SWAI_LOCAL_DESKTOP = "true";
      const policy = resolveDeploymentSecurityPolicy();
      expect(policy.mode).toBe("AUTHENTICATED_REMOTE");
      expect(policy.configurationValid).toBe(false);
      expect(policy.reason).toContain("Configuration conflict");
    });

    it("requires authentication on loopback when SWAI_REQUIRE_AUTH is true", () => {
      process.env.SWAI_REQUIRE_AUTH = "true";
      const policy = resolveDeploymentSecurityPolicy();
      expect(policy.mode).toBe("LOCAL_ONLY");
      expect(policy.localBypassAllowed).toBe(false);
      expect(policy.configurationValid).toBe(true);
    });

    it("classifies non-loopback host interface as AUTHENTICATED_REMOTE", () => {
      process.env.HOST = "192.168.1.119";
      const policy = resolveDeploymentSecurityPolicy();
      expect(policy.mode).toBe("AUTHENTICATED_REMOTE");
      expect(policy.localBypassAllowed).toBe(false);
    });
  });

  describe("isTrustedLocalDeployment", () => {
    it("returns true in default development/test desktop mode", () => {
      (process.env as Record<string, string | undefined>).NODE_ENV = "development";
      expect(isTrustedLocalDeployment()).toBe(true);
    });

    it("returns true when SWAI_LOCAL_DESKTOP is explicitly true on loopback", () => {
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

    it("returns false when server host is bound to public 0.0.0.0 even if SWAI_LOCAL_DESKTOP is set", () => {
      process.env.HOST = "0.0.0.0";
      process.env.SWAI_LOCAL_DESKTOP = "true";
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

    it("fails closed when host binding is 0.0.0.0 even if request says Host: localhost", () => {
      process.env.HOST = "0.0.0.0";
      const req = new NextRequest("http://localhost:3000/api/v1/search");
      const ctx = resolveTrustedRequestContext(req);
      expect(ctx.trustEstablished).toBe(false);
      expect(ctx.authenticationRequired).toBe(true);
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
