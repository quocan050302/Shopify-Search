import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";
import {
  isTrustedLocalDeployment,
  resolveDeploymentSecurityPolicy,
  resolveTrustedRequestContext,
  validateAdminRequest,
  resolveSwaiLaunchConfiguration,
  assertLaunchBindingMatchesPolicy,
  getResearchAuthorizationDiagnostics,
} from "@/services/security/adminAuth";

describe("SWAI V11.5.9.1 Runtime Research Authorization Unit Tests", () => {
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
    delete process.env.HOSTNAME;
    delete process.env.PORT;
    delete process.env.VERCEL;
    delete process.env.RENDER;
    delete process.env.FLY_APP_NAME;
    delete process.env.AWS_REGION;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  describe("Mandatory Negative & Boundary Security Matrix", () => {
    it("AUTH-01: Verified local 127.0.0.1 gives LOCAL_ONLY with bypass allowed", () => {
      process.env.HOST = "127.0.0.1";
      const policy = resolveDeploymentSecurityPolicy();
      expect(policy.mode).toBe("LOCAL_ONLY");
      expect(policy.localBypassAllowed).toBe(true);
      expect(policy.configurationValid).toBe(true);

      const req = new NextRequest("http://127.0.0.1:3000/api/v1/auth/status");
      const admin = validateAdminRequest(req);
      expect(admin.authorized).toBe(true);
      expect(admin.authMode).toBe("LOCAL_DEV");
    });

    it("AUTH-02: Default local launcher resolves valid LOCAL_DESKTOP configuration", () => {
      const launchConfig = resolveSwaiLaunchConfiguration({
        requestedMode: "LOCAL_DESKTOP",
        requestedHost: "127.0.0.1",
        requestedPort: 3000,
      });

      expect(launchConfig.valid).toBe(true);
      expect(launchConfig.mode).toBe("LOCAL_DESKTOP");
      expect(launchConfig.listenerHost).toBe("127.0.0.1");
      expect(launchConfig.authenticationRequired).toBe(false);
      expect(launchConfig.errors).toHaveLength(0);
    });

    it("AUTH-03: HOST undefined and unverified requires authentication", () => {
      // HOST is not set
      const policy = resolveDeploymentSecurityPolicy();
      expect(policy.mode).toBe("AUTHENTICATED_REMOTE");
      expect(policy.localBypassAllowed).toBe(false);

      const req = new NextRequest("http://127.0.0.1:3000/api/v1/auth/status");
      const admin = validateAdminRequest(req);
      expect(admin.authorized).toBe(false);
      expect(admin.code).toBe("ADMIN_AUTH_REQUIRED");
    });

    it("AUTH-04: Public 0.0.0.0 listener forbids local bypass", () => {
      process.env.HOST = "0.0.0.0";
      const policy = resolveDeploymentSecurityPolicy();
      expect(policy.mode).toBe("AUTHENTICATED_REMOTE");
      expect(policy.localBypassAllowed).toBe(false);

      const req = new NextRequest("http://127.0.0.1:3000/api/v1/auth/status");
      const admin = validateAdminRequest(req);
      expect(admin.authorized).toBe(false);
      expect(admin.code).toBe("ADMIN_AUTH_REQUIRED");
    });

    it("AUTH-05: LAN IP listener forbids local bypass", () => {
      process.env.HOST = "192.168.1.150";
      const policy = resolveDeploymentSecurityPolicy();
      expect(policy.mode).toBe("AUTHENTICATED_REMOTE");
      expect(policy.localBypassAllowed).toBe(false);

      const req = new NextRequest("http://127.0.0.1:3000/api/v1/auth/status");
      const admin = validateAdminRequest(req);
      expect(admin.authorized).toBe(false);
    });

    it("AUTH-06: Cloud deployment forbids local bypass even if HOST is loopback", () => {
      process.env.HOST = "127.0.0.1";
      process.env.VERCEL = "1";
      const policy = resolveDeploymentSecurityPolicy();
      expect(policy.mode).toBe("AUTHENTICATED_REMOTE");
      expect(policy.localBypassAllowed).toBe(false);
      expect(isTrustedLocalDeployment()).toBe(false);
    });

    it("AUTH-07: Remote request claiming Host localhost does not bypass auth on non-loopback listener", () => {
      process.env.HOST = "0.0.0.0";
      const req = new NextRequest("http://localhost:3000/api/v1/discovery/meta/requests", {
        headers: { host: "localhost:3000" },
      });
      const ctx = resolveTrustedRequestContext(req);
      expect(ctx.trustEstablished).toBe(false);
      expect(ctx.authenticationRequired).toBe(true);

      const admin = validateAdminRequest(req);
      expect(admin.authorized).toBe(false);
    });

    it("AUTH-08: Spoofed X-Forwarded-For cannot grant local bypass", () => {
      process.env.HOST = "127.0.0.1";
      const req = new NextRequest("http://localhost:3000/api/v1/discovery/meta/requests", {
        headers: { "x-forwarded-for": "198.51.100.5, 127.0.0.1" },
      });
      const ctx = resolveTrustedRequestContext(req);
      expect(ctx.trustEstablished).toBe(false);
      expect(ctx.authenticationRequired).toBe(true);
    });

    it("AUTH-09: Spoofed X-Real-IP cannot grant local bypass", () => {
      process.env.HOST = "127.0.0.1";
      const req = new NextRequest("http://localhost:3000/api/v1/discovery/meta/requests", {
        headers: { "x-real-ip": "203.0.113.8" },
      });
      const ctx = resolveTrustedRequestContext(req);
      expect(ctx.trustEstablished).toBe(false);
      expect(ctx.authenticationRequired).toBe(true);
    });

    it("AUTH-10: Invalid admin cookie is denied even on loopback", () => {
      process.env.HOST = "127.0.0.1";
      process.env.ADMIN_API_KEY = "genuine_secure_key_12345";

      const req = new NextRequest("http://localhost:3000/api/v1/discovery/meta/requests", {
        headers: { cookie: "swai_admin_token=stale_or_invalid_cookie_token" },
      });

      const admin = validateAdminRequest(req);
      expect(admin.authorized).toBe(false);
      expect(admin.code).toBe("INVALID_ADMIN_TOKEN");
    });

    it("AUTH-11: Invalid Bearer token is denied even on loopback", () => {
      process.env.HOST = "127.0.0.1";
      process.env.ADMIN_API_KEY = "genuine_secure_key_12345";

      const req = new NextRequest("http://localhost:3000/api/v1/discovery/meta/requests", {
        headers: { authorization: "Bearer invalid_bearer_token" },
      });

      const admin = validateAdminRequest(req);
      expect(admin.authorized).toBe(false);
      expect(admin.code).toBe("INVALID_ADMIN_TOKEN");
    });

    it("AUTH-12: Explicit SWAI_REQUIRE_AUTH requires authentication on loopback", () => {
      process.env.HOST = "127.0.0.1";
      process.env.SWAI_REQUIRE_AUTH = "true";

      const policy = resolveDeploymentSecurityPolicy();
      expect(policy.mode).toBe("LOCAL_ONLY");
      expect(policy.localBypassAllowed).toBe(false);

      const req = new NextRequest("http://localhost:3000/api/v1/discovery/meta/requests");
      const admin = validateAdminRequest(req);
      expect(admin.authorized).toBe(false);
      expect(admin.code).toBe("ADMIN_AUTH_REQUIRED");
    });

    it("AUTH-13: Conflicting local/public launch configuration is rejected", () => {
      const launchConfig = resolveSwaiLaunchConfiguration({
        requestedMode: "LOCAL_DESKTOP",
        requestedHost: "0.0.0.0",
      });

      expect(launchConfig.valid).toBe(false);
      expect(launchConfig.errors.length).toBeGreaterThan(0);
      expect(launchConfig.errors[0]).toContain("not a loopback address");
    });

    it("AUTH-14: Missing trusted binding is never auto-local", () => {
      delete process.env.HOST;
      delete process.env.HOSTNAME;
      expect(isTrustedLocalDeployment()).toBe(false);

      const launchConfig = resolveSwaiLaunchConfiguration({
        requestedMode: "LOCAL_DESKTOP",
        requestedHost: "192.168.1.200",
      });
      expect(launchConfig.valid).toBe(false);
    });
  });

  describe("assertLaunchBindingMatchesPolicy Helper", () => {
    it("throws if policy allows local bypass on a non-loopback host", () => {
      expect(() => {
        assertLaunchBindingMatchesPolicy("0.0.0.0", {
          mode: "LOCAL_ONLY",
          localBypassAllowed: true,
          configurationValid: true,
          reason: "test policy",
        });
      }).toThrow("CRITICAL SECURITY CONFLICT");
    });

    it("does not throw on consistent loopback binding", () => {
      expect(() => {
        assertLaunchBindingMatchesPolicy("127.0.0.1", {
          mode: "LOCAL_ONLY",
          localBypassAllowed: true,
          configurationValid: true,
          reason: "test policy",
        });
      }).not.toThrow();
    });
  });

  describe("getResearchAuthorizationDiagnostics Helper", () => {
    it("returns sanitized diagnostic info without leaking secrets", () => {
      process.env.HOST = "127.0.0.1";
      process.env.ADMIN_API_KEY = "super_secret_never_leak_key_xyz";

      const req = new NextRequest("http://localhost:3000/api/v1/auth/status", {
        headers: { authorization: "Bearer invalid_secret_token" },
      });

      const diag = getResearchAuthorizationDiagnostics(req);
      expect(diag.authorized).toBe(false);
      expect(diag.reasonCode).toBe("INVALID_ADMIN_TOKEN");
      expect(diag.credentialsPresent).toBe(true);
      expect(diag.credentialsValid).toBe(false);
      expect(diag.listenerVerifiedLoopback).toBe(true);

      const diagJson = JSON.stringify(diag);
      expect(diagJson).not.toContain("super_secret_never_leak_key_xyz");
      expect(diagJson).not.toContain("invalid_secret_token");
    });

    it("reports LOCAL_DEV authorized when legitimately running local desktop without credentials", () => {
      process.env.HOST = "127.0.0.1";
      const req = new NextRequest("http://localhost:3000/api/v1/auth/status");
      const diag = getResearchAuthorizationDiagnostics(req);

      expect(diag.authorized).toBe(true);
      expect(diag.reasonCode).toBe("LOCAL_DEV");
      expect(diag.deploymentMode).toBe("LOCAL_DESKTOP");
      expect(diag.credentialsPresent).toBe(false);
    });
  });
});
