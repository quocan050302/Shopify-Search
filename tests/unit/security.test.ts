import { describe, it, expect } from "vitest";
import { validateExternalResourceUrl, verifyApplicationIsolation } from "@/lib/security";

describe("Security & SSRF Guard", () => {
  it("allows valid public HTTPS URLs", () => {
    const res = validateExternalResourceUrl("https://www.facebook.com/ads/library/?id=123456");
    expect(res.isValid).toBe(true);
    expect(res.sanitizedUrl).toBeDefined();
  });

  it("blocks localhost and loopback addresses", () => {
    expect(validateExternalResourceUrl("http://localhost:3000").isValid).toBe(false);
    expect(validateExternalResourceUrl("http://127.0.0.1:8080").isValid).toBe(false);
    expect(validateExternalResourceUrl("http://127.0.0.2:80").isValid).toBe(false);
  });

  it("blocks cloud metadata service (169.254.169.254)", () => {
    const res = validateExternalResourceUrl("http://169.254.169.254/latest/meta-data/");
    expect(res.isValid).toBe(false);
  });

  it("blocks private network CIDRs", () => {
    expect(validateExternalResourceUrl("http://10.0.0.1/admin").isValid).toBe(false);
    expect(validateExternalResourceUrl("http://192.168.1.1").isValid).toBe(false);
    expect(validateExternalResourceUrl("http://172.16.0.5").isValid).toBe(false);
  });

  it("blocks non-HTTP protocols", () => {
    expect(validateExternalResourceUrl("ftp://files.example.com").isValid).toBe(false);
    expect(validateExternalResourceUrl("file:///etc/passwd").isValid).toBe(false);
  });

  it("verifies application isolation from APP #1", () => {
    const status = verifyApplicationIsolation();
    expect(status.isIsolated).toBe(true);
    expect(status.appName).toContain("Shopify Winning Ads Intelligence");
    expect(status.gitOrigin.replace(/\.git$/, "")).toBe("https://github.com/quocan050302/Shopify-Search");
  });
});
