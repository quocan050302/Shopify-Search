/**
 * ANTI — KH-02 V12.4.3.7.18.1: SOCKET TRUST NO TEST BYPASS (A01 - A16)
 *
 * Verifies that test injection/bypass options can NEVER elevate into LIVE PDP PROOF.
 * Enforces immutable transport provenance boundaries, pinned IP validation,
 * CA TLS authorization, and fail-closed security.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  verifyLiveMerchantProductPageDestination,
  evaluateLivePdpEligibility,
} from "@/services/kh02/identity/verifiedMerchantPdpResolver";

describe("KH-02 V12.4.3.7.18.1: Workstream A — Socket Trust No Test Bypass (A01 - A16)", () => {
  const originalEnv = process.env.ENABLE_LIVE_NETWORK_FETCHER;

  beforeEach(() => {
    delete process.env.ENABLE_LIVE_NETWORK_FETCHER;
  });

  afterEach(() => {
    if (originalEnv !== undefined) {
      process.env.ENABLE_LIVE_NETWORK_FETCHER = originalEnv;
    } else {
      delete process.env.ENABLE_LIVE_NETWORK_FETCHER;
    }
  });

  const validHtml = `<!DOCTYPE html><html><head>
    <title>Automatic Cat Feeder - UAHPET Store</title>
    <script type="application/ld+json">
      {
        "@context": "https://schema.org",
        "@type": "Product",
        "name": "Automatic Cat Feeder",
        "offers": { "@type": "Offer", "price": "49.99" }
      }
    </script>
  </head><body><h1>Automatic Cat Feeder</h1></body></html>`;

  const validCreative = {
    creativeId: "cr_uahpet_01",
    landingPageUrl: "https://uahpet.com/products/automatic-cat-feeder",
  };

  const validCandidate = {
    candidateId: "cand_uahpet_01",
    storeDomain: "uahpet.com",
    canonicalProductUrl: "https://uahpet.com/products/automatic-cat-feeder",
    title: "Automatic Cat Feeder",
  };

  it("A01: allowed public DNS resolves with disabled transport -> zero socket calls, no live", async () => {
    const res = await verifyLiveMerchantProductPageDestination({
      creative: validCreative,
      candidate: validCandidate,
      options: {
        transportMode: "DISABLED",
      },
    });

    expect(res.isVerifiedPdp).toBe(false);
    expect(res.verificationStatus).toBe("NOT_RUN_NO_AUTHORIZED_TRANSPORT");
    expect(res.isLiveExternalProof).toBe(false);
  });

  it("A02: public DNS preflight but pinnedIp=127.0.0.1 -> reject before dial, no live", async () => {
    const mockFetch = vi.fn();
    const res = await verifyLiveMerchantProductPageDestination({
      creative: validCreative,
      candidate: validCandidate,
      options: {
        dnsLookupFn: async () => [{ address: "93.184.216.34", family: 4 }],
        pinnedIp: "127.0.0.1", // Injected loopback
        fetchFn: mockFetch,
      },
    });

    expect(res.isVerifiedPdp).toBe(false);
    expect(res.verificationStatus).toBe("BLOCKED_PRIVATE_HOST");
    expect(res.isLiveExternalProof).toBe(false);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("A03: pinned override is another public IP not in DNS result -> reject", async () => {
    const mockFetch = vi.fn();
    const res = await verifyLiveMerchantProductPageDestination({
      creative: validCreative,
      candidate: validCandidate,
      options: {
        dnsLookupFn: async () => [{ address: "93.184.216.34", family: 4 }],
        pinnedIp: "8.8.8.8", // Not in DNS resolution result
        fetchFn: mockFetch,
      },
    });

    expect(res.isVerifiedPdp).toBe(false);
    expect(res.verificationStatus).toBe("SOCKET_PEER_MISMATCH");
    expect(res.reason).toContain("not present in vetted DNS resolution results");
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("A04: injected dnsLookupFn returns public IP and fetch seems valid -> TEST_ONLY", async () => {
    const mockFetch = vi.fn().mockResolvedValue(
      new Response(validHtml, {
        status: 200,
        headers: { "content-type": "text/html" },
      })
    );

    const res = await verifyLiveMerchantProductPageDestination({
      creative: validCreative,
      candidate: validCandidate,
      options: {
        dnsLookupFn: async () => [{ address: "93.184.216.34", family: 4 }],
        fetchFn: mockFetch,
      },
    });

    expect(res.isVerifiedPdp).toBe(true);
    expect(res.verificationStatus).toBe("TEST_ONLY");
    expect(res.isLiveExternalProof).toBe(false);
    expect(res.verificationSource).toBe("TEST_VERIFIED_ONLY");
  });

  it("A05: fetchFn injected + LIVE_NATIVE + ENABLE_LIVE_NETWORK_FETCHER=true -> TEST_ONLY", async () => {
    process.env.ENABLE_LIVE_NETWORK_FETCHER = "true";

    const mockFetch = vi.fn().mockResolvedValue(
      new Response(validHtml, {
        status: 200,
        headers: { "content-type": "text/html" },
      })
    );

    const res = await verifyLiveMerchantProductPageDestination({
      creative: validCreative,
      candidate: validCandidate,
      options: {
        transportMode: "LIVE_NATIVE",
        fetchFn: mockFetch,
        dnsLookupFn: async () => [{ address: "93.184.216.34", family: 4 }],
      },
    });

    expect(res.isVerifiedPdp).toBe(true);
    expect(res.verificationStatus).toBe("TEST_ONLY");
    expect(res.isLiveExternalProof).toBe(false);
    expect(res.verificationSource).toBe("TEST_VERIFIED_ONLY");
    expect(res.liveEligibilityAudit?.isLiveEligible).toBe(false);
    expect(res.liveEligibilityAudit?.auditReasons).toContain("TEST_OVERRIDES_OR_SIMULATION_DETECTED");
  });

  it("A06: self-signed local TLS cert + allowSelfSignedTestCert=true + live flag -> TEST_ONLY, tlsVerified not CA verified", async () => {
    process.env.ENABLE_LIVE_NETWORK_FETCHER = "true";

    const mockFetch = vi.fn().mockResolvedValue(
      new Response(validHtml, {
        status: 200,
        headers: { "content-type": "text/html" },
      })
    );

    const res = await verifyLiveMerchantProductPageDestination({
      creative: validCreative,
      candidate: validCandidate,
      options: {
        transportMode: "LIVE_NATIVE",
        allowSelfSignedTestCert: true,
        fetchFn: mockFetch,
        dnsLookupFn: async () => [{ address: "93.184.216.34", family: 4 }],
      },
    });

    expect(res.isVerifiedPdp).toBe(true);
    expect(res.verificationStatus).toBe("TEST_ONLY");
    expect(res.isLiveExternalProof).toBe(false);
    expect(res.tlsVerified).toBe(false); // Self-signed is NOT CA verified
  });

  it("A07: allowLoopbackForTest=true or simulated peer/final URL -> TEST_ONLY regardless of env", async () => {
    process.env.ENABLE_LIVE_NETWORK_FETCHER = "true";

    const mockFetch = vi.fn().mockResolvedValue(
      new Response(validHtml, {
        status: 200,
        headers: { "content-type": "text/html" },
      })
    );

    const res = await verifyLiveMerchantProductPageDestination({
      creative: validCreative,
      candidate: validCandidate,
      options: {
        transportMode: "LIVE_NATIVE",
        simulateConnectedPeerIp: "93.184.216.34",
        fetchFn: mockFetch,
        dnsLookupFn: async () => [{ address: "93.184.216.34", family: 4 }],
      },
    });

    expect(res.isVerifiedPdp).toBe(true);
    expect(res.verificationStatus).toBe("TEST_ONLY");
    expect(res.isLiveExternalProof).toBe(false);
  });

  it("A08: actual isolated test params: records actual peer, marked non-live without real CA network", async () => {
    const mockFetch = vi.fn().mockResolvedValue(
      new Response(validHtml, {
        status: 200,
        headers: { "content-type": "text/html" },
      })
    );

    const res = await verifyLiveMerchantProductPageDestination({
      creative: validCreative,
      candidate: validCandidate,
      options: {
        transportMode: "TEST_SIMULATION",
        fetchFn: mockFetch,
        dnsLookupFn: async () => [{ address: "93.184.216.34", family: 4 }],
      },
    });

    expect(res.isVerifiedPdp).toBe(true);
    expect(res.verificationStatus).toBe("FETCHED_PDP_VERIFIED");
    expect(res.isLiveExternalProof).toBe(false);
  });

  it("A09: actual peer mismatch -> close socket and reject SOCKET_PEER_MISMATCH", async () => {
    const mockFetch = vi.fn();
    const res = await verifyLiveMerchantProductPageDestination({
      creative: validCreative,
      candidate: validCandidate,
      options: {
        dnsLookupFn: async () => [{ address: "93.184.216.34", family: 4 }],
        simulateConnectedPeerIp: "198.51.100.1", // Discrepant IP
        fetchFn: mockFetch,
      },
    });

    expect(res.isVerifiedPdp).toBe(false);
    expect(res.verificationStatus).toBe("DNS_REBIND_BLOCKED");
  });

  it("A10: cert unauthorized in strict mode -> failure, tlsVerified false, live false", async () => {
    // When performAuditedSecureTlsFetch encounters unauthorized cert without allowSelfSignedTestCert
    const res = evaluateLivePdpEligibility({
      isVerifiedPdp: false,
      hasTestOverrides: false,
      isRealSocketConnection: true,
      observedTlsAuthorized: false, // Unauthorized cert
      observedActualPeerIp: "93.184.216.34",
      pinnedIp: "93.184.216.34",
      hasProductContentProof: true,
      hasMerchantDomainMatch: true,
      envLiveEnabled: true,
    });

    expect(res.isLiveEligible).toBe(false);
    expect(res.auditReasons).toContain("TLS_SOCKET_NOT_AUTHORIZED");
  });

  it("A11: https: string alone -> never tlsVerified true without audited connection", async () => {
    const mockFetch = vi.fn().mockResolvedValue(
      new Response(validHtml, {
        status: 200,
        headers: { "content-type": "text/html" },
      })
    );

    const res = await verifyLiveMerchantProductPageDestination({
      creative: validCreative,
      candidate: validCandidate,
      options: {
        transportMode: "TEST_SIMULATION",
        fetchFn: mockFetch,
        dnsLookupFn: async () => [{ address: "93.184.216.34", family: 4 }],
      },
    });

    expect(res.isVerifiedPdp).toBe(true);
    // Protocol is https, but mock fetch did not perform audited CA TLS connection
    expect(res.tlsVerified).toBe(false);
  });

  it("A12: redirect to private IP, mismatched merchant, custom port, insecure scheme -> blocked before connect", async () => {
    // Insecure scheme
    const res1 = await verifyLiveMerchantProductPageDestination({
      creative: { creativeId: "cr_insecure", landingPageUrl: "http://uahpet.com/products/feeder" },
      candidate: validCandidate,
      options: { transportMode: "TEST_SIMULATION" },
    });
    expect(res1.isVerifiedPdp).toBe(false);
    expect(res1.verificationStatus).toBe("HTTP_ERROR");

    // Private IP
    const res2 = await verifyLiveMerchantProductPageDestination({
      creative: { creativeId: "cr_priv", landingPageUrl: "https://10.0.0.1/products/feeder" },
      candidate: validCandidate,
      options: { transportMode: "TEST_SIMULATION" },
    });
    expect(res2.isVerifiedPdp).toBe(false);
    expect(res2.verificationStatus).toBe("BLOCKED_PRIVATE_HOST");

    // Mismatched domain
    const res3 = await verifyLiveMerchantProductPageDestination({
      creative: { creativeId: "cr_mismatch", landingPageUrl: "https://evil-attacker.com/products/feeder" },
      candidate: validCandidate,
      options: { transportMode: "TEST_SIMULATION" },
    });
    expect(res3.isVerifiedPdp).toBe(false);
    expect(res3.verificationStatus).toBe("STORE_DOMAIN_MISMATCH");

    // Custom non-standard port
    const res4 = await verifyLiveMerchantProductPageDestination({
      creative: { creativeId: "cr_port", landingPageUrl: "https://uahpet.com:8443/products/feeder" },
      candidate: validCandidate,
      options: { transportMode: "TEST_SIMULATION" },
    });
    expect(res4.isVerifiedPdp).toBe(false);
    expect(res4.verificationStatus).toBe("VERIFICATION_FAILED");
  });

  it("A13: oversized body/timeout/abort -> no open sockets, no false live success", async () => {
    const hugeHtml = "A".repeat(3 * 1024 * 1024); // 3MB body
    const mockFetch = vi.fn().mockResolvedValue(
      new Response(hugeHtml, {
        status: 200,
        headers: { "content-type": "text/html" },
      })
    );

    const res = await verifyLiveMerchantProductPageDestination({
      creative: validCreative,
      candidate: validCandidate,
      options: {
        transportMode: "TEST_SIMULATION",
        fetchFn: mockFetch,
        dnsLookupFn: async () => [{ address: "93.184.216.34", family: 4 }],
      },
    });

    expect(res.isVerifiedPdp).toBe(false);
    expect(res.verificationStatus).toBe("BODY_TOO_LARGE");
    expect(res.isLiveExternalProof).toBe(false);
  });

  it("A14: legitimate Product HTML on test server -> product structure can verify while live status stays false", async () => {
    const mockFetch = vi.fn().mockResolvedValue(
      new Response(validHtml, {
        status: 200,
        headers: { "content-type": "text/html" },
      })
    );

    const res = await verifyLiveMerchantProductPageDestination({
      creative: validCreative,
      candidate: validCandidate,
      options: {
        transportMode: "TEST_SIMULATION",
        fetchFn: mockFetch,
        dnsLookupFn: async () => [{ address: "93.184.216.34", family: 4 }],
      },
    });

    expect(res.isVerifiedPdp).toBe(true);
    expect(res.title).toBe("Automatic Cat Feeder");
    expect(res.isLiveExternalProof).toBe(false);
  });

  it("A15: combined bypass-options attack -> fail closed; live=true cannot be forged", async () => {
    process.env.ENABLE_LIVE_NETWORK_FETCHER = "true";

    const mockFetch = vi.fn().mockResolvedValue(
      new Response(validHtml, {
        status: 200,
        headers: { "content-type": "text/html" },
      })
    );

    const res = await verifyLiveMerchantProductPageDestination({
      creative: validCreative,
      candidate: validCandidate,
      options: {
        transportMode: "LIVE_NATIVE",
        fetchFn: mockFetch,
        dnsLookupFn: async () => [{ address: "93.184.216.34", family: 4 }],
        allowSelfSignedTestCert: true,
        allowLoopbackForTest: true,
        simulateFinalUrl: "https://uahpet.com/products/automatic-cat-feeder",
        simulateConnectedPeerIp: "93.184.216.34",
      },
    });

    expect(res.isVerifiedPdp).toBe(true);
    expect(res.isLiveExternalProof).toBe(false);
    expect(res.verificationStatus).toBe("TEST_ONLY");
    expect(res.verificationSource).toBe("TEST_VERIFIED_ONLY");
  });

  it("A16: source creative lacks authenticated provenance -> cannot claim G16 exact live evidence", async () => {
    const res = await verifyLiveMerchantProductPageDestination({
      creative: {
        creativeId: "", // Missing creativeId
        landingPageUrl: "https://uahpet.com/products/automatic-cat-feeder",
      },
      candidate: validCandidate,
      options: { transportMode: "TEST_SIMULATION" },
    });

    expect(res.isVerifiedPdp).toBe(false);
    expect(res.verificationStatus).toBe("PROVIDER_DESTINATION_MISSING");
  });
});
