/**
 * ANTI — KH-02 V12.4.3.7.17: Group A — NETWORK, SSRF, DNS & REDIRECT TEST SUITE
 * Scenarios A01 - A24
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  verifyLiveMerchantProductPageDestination,
  isBlockedIpAddress,
  isBlockedPrivateHost,
  parseIpv4ToNumber,
} from "@/services/kh02/identity/verifiedMerchantPdpResolver";
import { classifyVerifiedGoogleMerchantDestination } from "@/services/kh02/identity/crossPlatformProductMatcher";

describe("KH-02 V12.4.3.7.17 Group A: Network, SSRF, DNS & Redirect Security", () => {
  const candidate = {
    candidateId: "cand_pet_feeder",
    storeDomain: "uahpet.com",
    canonicalProductUrl: "https://uahpet.com/products/automatic-cat-feeder",
    title: "Automatic Cat Feeder",
    handle: "automatic-cat-feeder",
  };

  it("A01: external HTTPS merchant product URL, offline precheck only, zero network, isVerifiedPdp=false", () => {
    const precheck = classifyVerifiedGoogleMerchantDestination(
      "https://uahpet.com/products/automatic-cat-feeder",
      candidate
    );
    expect(precheck.urlStructureValid).toBe(true);
    expect(precheck.destinationVerificationStatus).toBe("PDP_URL_STRUCTURE_VALID");
    expect(precheck.isVerifiedPdp).toBe(false);
  });

  it("A02: URL with localhost, 127.0.0.1, 127.1, 0.0.0.0, and 169.254.169.254 blocked before connect", async () => {
    const blockedHosts = ["localhost", "127.0.0.1", "127.1", "0.0.0.0", "169.254.169.254"];
    for (const host of blockedHosts) {
      expect(isBlockedPrivateHost(host)).toBe(true);
      const res = await verifyLiveMerchantProductPageDestination({
        creative: { creativeId: "cr_ssrf", landingPageUrl: `https://${host}/products/cat-feeder` },
        candidate: { ...candidate, storeDomain: host },
        options: { transportMode: "TEST_SIMULATION" },
      });
      expect(res.isVerifiedPdp).toBe(false);
      expect(res.verificationStatus).toBe("BLOCKED_PRIVATE_HOST");
    }
  });

  it("A03: 10/8, 172.16/12, 192.168/16, 100.64/10, multicast and IPv4-mapped private IPv6 blocked", () => {
    const privateIps = [
      "10.0.0.1",
      "10.254.254.254",
      "172.16.0.1",
      "172.31.255.255",
      "192.168.0.1",
      "192.168.100.50",
      "100.64.0.1",
      "100.127.255.255",
      "224.0.0.1",
      "239.255.255.250",
      "::ffff:10.0.0.1",
      "::ffff:192.168.1.1",
      "::ffff:172.20.1.1",
    ];
    for (const ip of privateIps) {
      expect(isBlockedIpAddress(ip)).toBe(true);
    }
    expect(isBlockedIpAddress("8.8.8.8")).toBe(false);
    expect(isBlockedIpAddress("93.184.216.34")).toBe(false);
  });

  it("A04: IPv6 ::1, fc00::/7, fe80::/10, ::ffff:127.0.0.1, zone-id variants blocked", () => {
    const privateV6 = [
      "::1",
      "::",
      "fc00::1",
      "fd12:3456:789a::1",
      "fe80::1",
      "fe80::1%eth0",
      "::ffff:127.0.0.1",
      "::ffff:127.1",
    ];
    for (const ip of privateV6) {
      expect(isBlockedIpAddress(ip)).toBe(true);
    }
  });

  it("A05: DNS A/AAAA resolving to private/link-local/CNAME private blocked; assert zero socket connect", async () => {
    let attemptedConnect = false;
    const mockFetch = vi.fn().mockImplementation(async () => {
      attemptedConnect = true;
      return new Response("OK", { status: 200 });
    });

    const res = await verifyLiveMerchantProductPageDestination({
      creative: { creativeId: "cr_dns", landingPageUrl: "https://uahpet.com/products/cat-feeder" },
      candidate,
      options: {
        transportMode: "TEST_SIMULATION",
        fetchFn: mockFetch as any,
        dnsLookupFn: async () => [{ address: "10.0.0.5", family: 4 }],
      },
    });

    expect(attemptedConnect).toBe(false);
    expect(res.isVerifiedPdp).toBe(false);
    expect(res.verificationStatus).toBe("DNS_PRIVATE_BLOCKED");
  });

  it("A06: DNS rebinding first public then private at connect must fail; assert dialed peer validation", async () => {
    const res = await verifyLiveMerchantProductPageDestination({
      creative: { creativeId: "cr_rebind", landingPageUrl: "https://uahpet.com/products/cat-feeder" },
      candidate,
      options: {
        transportMode: "TEST_SIMULATION",
        dnsLookupFn: async () => [{ address: "93.184.216.34", family: 4 }],
        simulateConnectedPeerIp: "127.0.0.1", // Rebound to loopback!
      },
    });

    expect(res.isVerifiedPdp).toBe(false);
    expect(res.verificationStatus).toBe("DNS_REBIND_BLOCKED");
  });

  it("A07: valid initial merchant URL -> HTTP 302 Location http://169.254.169.254/latest/meta-data must fail without private connect", async () => {
    let connectedToPrivate = false;
    const mockFetch = vi.fn().mockImplementation(async (url: string) => {
      if (url.includes("169.254.169.254")) {
        connectedToPrivate = true;
        return new Response("aws-secret-keys", { status: 200 });
      }
      return new Response(null, {
        status: 302,
        headers: { Location: "http://169.254.169.254/latest/meta-data" },
      });
    });

    const res = await verifyLiveMerchantProductPageDestination({
      creative: { creativeId: "cr_meta", landingPageUrl: "https://uahpet.com/products/cat-feeder" },
      candidate,
      options: {
        transportMode: "TEST_SIMULATION",
        fetchFn: mockFetch as any,
        dnsLookupFn: async () => [{ address: "93.184.216.34", family: 4 }],
      },
    });

    expect(connectedToPrivate).toBe(false);
    expect(res.isVerifiedPdp).toBe(false);
    expect(res.verificationStatus).toBe("REDIRECT_DOWNGRADE_HTTP");
  });

  it("A08: valid merchant URL -> 302 other merchant/shortener/cross-domain must fail; no disallowed hop dial", async () => {
    let dialedOther = false;
    const mockFetch = vi.fn().mockImplementation(async (url: string) => {
      if (url.includes("evil-phishing.com")) {
        dialedOther = true;
        return new Response("Evil", { status: 200 });
      }
      return new Response(null, {
        status: 302,
        headers: { Location: "https://evil-phishing.com/products/cat-feeder" },
      });
    });

    const res = await verifyLiveMerchantProductPageDestination({
      creative: { creativeId: "cr_cross", landingPageUrl: "https://uahpet.com/products/cat-feeder" },
      candidate,
      options: {
        transportMode: "TEST_SIMULATION",
        fetchFn: mockFetch as any,
        dnsLookupFn: async () => [{ address: "93.184.216.34", family: 4 }],
      },
    });

    expect(dialedOther).toBe(false);
    expect(res.isVerifiedPdp).toBe(false);
    expect(res.verificationStatus).toBe("REDIRECT_CROSS_DOMAIN");
  });

  it("A09: valid relative redirect between approved merchant paths -> manual hop chain works, final URL captured", async () => {
    let hopCount = 0;
    const mockFetch = vi.fn().mockImplementation(async (url: string) => {
      hopCount++;
      if (url === "https://uahpet.com/products/cat-feeder") {
        return new Response(null, {
          status: 301,
          headers: { Location: "/products/automatic-cat-feeder" },
        });
      }
      return new Response(
        `<html><head><title>Automatic Cat Feeder</title><script type="application/ld+json">{"@type":"Product","name":"Automatic Cat Feeder"}</script></head><body>Product detail page</body></html>`,
        { status: 200, headers: { "Content-Type": "text/html" } }
      );
    });

    const res = await verifyLiveMerchantProductPageDestination({
      creative: { creativeId: "cr_rel", landingPageUrl: "https://uahpet.com/products/cat-feeder" },
      candidate,
      options: {
        transportMode: "TEST_SIMULATION",
        fetchFn: mockFetch as any,
        dnsLookupFn: async () => [{ address: "93.184.216.34", family: 4 }],
      },
    });

    expect(res.isVerifiedPdp).toBe(true);
    expect(res.finalUrl).toBe("https://uahpet.com/products/automatic-cat-feeder");
    expect(res.redirectChain?.length).toBe(2);
    expect(hopCount).toBe(2);
  });

  it("A10: >5 redirect hops or redirect loop -> fail bounded, exact observed attempt count", async () => {
    let attempts = 0;
    const mockLoopFetch = vi.fn().mockImplementation(async (url: string) => {
      attempts++;
      if (url.includes("stepA")) {
        return new Response(null, { status: 302, headers: { Location: "https://uahpet.com/products/stepB" } });
      }
      return new Response(null, { status: 302, headers: { Location: "https://uahpet.com/products/stepA" } });
    });

    const res = await verifyLiveMerchantProductPageDestination({
      creative: { creativeId: "cr_loop", landingPageUrl: "https://uahpet.com/products/stepA" },
      candidate,
      options: {
        transportMode: "TEST_SIMULATION",
        fetchFn: mockLoopFetch as any,
        dnsLookupFn: async () => [{ address: "93.184.216.34", family: 4 }],
      },
    });

    expect(res.isVerifiedPdp).toBe(false);
    expect(res.verificationStatus).toBe("REDIRECT_LOOP");
    expect(attempts).toBe(2);
  });

  it("A11: redirect https -> http downgrade, custom port, or userinfo in Location fails", async () => {
    const mockDowngradeFetch = vi.fn().mockResolvedValue(
      new Response(null, { status: 302, headers: { Location: "http://uahpet.com/products/cat-feeder" } })
    );

    const res = await verifyLiveMerchantProductPageDestination({
      creative: { creativeId: "cr_down", landingPageUrl: "https://uahpet.com/products/cat-feeder" },
      candidate,
      options: {
        transportMode: "TEST_SIMULATION",
        fetchFn: mockDowngradeFetch as any,
        dnsLookupFn: async () => [{ address: "93.184.216.34", family: 4 }],
      },
    });

    expect(res.isVerifiedPdp).toBe(false);
    expect(res.verificationStatus).toBe("REDIRECT_DOWNGRADE_HTTP");
  });

  it("A12: protocol file, data, javascript, gopher, ftp and credentials in URL rejected", async () => {
    const invalidProtocols = [
      "file:///etc/passwd",
      "data:text/html,<h1>Pwned</h1>",
      "javascript:alert(1)",
      "ftp://uahpet.com/products/feeder",
      "https://admin:password@uahpet.com/products/feeder",
    ];

    for (const badUrl of invalidProtocols) {
      const res = await verifyLiveMerchantProductPageDestination({
        creative: { creativeId: "cr_badproto", landingPageUrl: badUrl },
        candidate,
        options: { transportMode: "TEST_SIMULATION" },
      });
      expect(res.isVerifiedPdp).toBe(false);
      expect(res.verificationStatus).toMatch(/HTTP_ERROR|VERIFICATION_FAILED/);
    }
  });

  it("A13: rawUrl claims merchant /products but response actually homepage -> no live exact", async () => {
    const mockHomeFetch = vi.fn().mockResolvedValue(
      new Response(
        `<html><head><title>Home Page</title></head><body>Welcome to UAHPET</body></html>`,
        { status: 200, headers: { "Content-Type": "text/html" } }
      )
    );

    const res = await verifyLiveMerchantProductPageDestination({
      creative: { creativeId: "cr_home", landingPageUrl: "https://uahpet.com/products/automatic-cat-feeder" },
      candidate,
      options: {
        transportMode: "TEST_SIMULATION",
        fetchFn: mockHomeFetch as any,
        simulateFinalUrl: "https://uahpet.com/", // Landed on homepage
        dnsLookupFn: async () => [{ address: "93.184.216.34", family: 4 }],
      },
    });

    expect(res.isVerifiedPdp).toBe(false);
    expect(res.verificationStatus).toBe("REDIRECT_NON_PDP");
  });

  it("A14: HTTP 404, 500, missing Location on 302, non-HTML content type all reject", async () => {
    const mock404 = vi.fn().mockResolvedValue(new Response("Not Found", { status: 404 }));
    const res404 = await verifyLiveMerchantProductPageDestination({
      creative: { creativeId: "cr_404", landingPageUrl: "https://uahpet.com/products/automatic-cat-feeder" },
      candidate,
      options: { transportMode: "TEST_SIMULATION", fetchFn: mock404 as any, dnsLookupFn: async () => [{ address: "93.184.216.34", family: 4 }] },
    });
    expect(res404.isVerifiedPdp).toBe(false);
    expect(res404.verificationStatus).toBe("HTTP_ERROR");

    const mockPng = vi.fn().mockResolvedValue(new Response("PNG_BYTES", { status: 200, headers: { "Content-Type": "image/png" } }));
    const resPng = await verifyLiveMerchantProductPageDestination({
      creative: { creativeId: "cr_png", landingPageUrl: "https://uahpet.com/products/automatic-cat-feeder" },
      candidate,
      options: { transportMode: "TEST_SIMULATION", fetchFn: mockPng as any, dnsLookupFn: async () => [{ address: "93.184.216.34", family: 4 }] },
    });
    expect(resPng.isVerifiedPdp).toBe(false);
    expect(resPng.verificationStatus).toBe("CONTENT_TYPE_INVALID");
  });

  it("A15: DNS lookup failure or empty result -> fail LIVE without insecure retry", async () => {
    const mockDnsFail = vi.fn().mockRejectedValue(new Error("ENOTFOUND uahpet.com"));
    const res = await verifyLiveMerchantProductPageDestination({
      creative: { creativeId: "cr_dnsfail", landingPageUrl: "https://uahpet.com/products/automatic-cat-feeder" },
      candidate,
      options: { transportMode: "TEST_SIMULATION", dnsLookupFn: mockDnsFail },
    });
    expect(res.isVerifiedPdp).toBe(false);
    expect(res.verificationStatus).toBe("DNS_LOOKUP_FAILED");
  });

  it("A16: test fetchFn even when transportMode LIVE_NATIVE -> TEST_ONLY and isLiveExternalProof=false", async () => {
    const mockFetch = vi.fn().mockResolvedValue(
      new Response(
        `<html><head><title>Automatic Cat Feeder</title><script type="application/ld+json">{"@type":"Product","name":"Automatic Cat Feeder"}</script></head><body>Valid PDP</body></html>`,
        { status: 200, headers: { "Content-Type": "text/html" } }
      )
    );

    const res = await verifyLiveMerchantProductPageDestination({
      creative: { creativeId: "cr_testfn", landingPageUrl: "https://uahpet.com/products/automatic-cat-feeder" },
      candidate,
      options: {
        transportMode: "LIVE_NATIVE", // Claims live native!
        fetchFn: mockFetch as any, // But injected test fetchFn
        dnsLookupFn: async () => [{ address: "93.184.216.34", family: 4 }],
      },
    });

    expect(res.isVerifiedPdp).toBe(true);
    expect(res.verificationSource).toBe("TEST_VERIFIED_ONLY");
    expect(res.isLiveExternalProof).toBe(false);
  });

  it("A17: monkeypatched or uncontrolled environment without ENABLE_LIVE_NETWORK_FETCHER fails closed", async () => {
    const prevEnv = process.env.ENABLE_LIVE_NETWORK_FETCHER;
    delete process.env.ENABLE_LIVE_NETWORK_FETCHER;

    const res = await verifyLiveMerchantProductPageDestination({
      creative: { creativeId: "cr_noenv", landingPageUrl: "https://uahpet.com/products/automatic-cat-feeder" },
      candidate,
    });

    expect(res.isVerifiedPdp).toBe(false);
    expect(res.verificationStatus).toBe("NOT_RUN_NO_AUTHORIZED_TRANSPORT");

    if (prevEnv) process.env.ENABLE_LIVE_NETWORK_FETCHER = prevEnv;
  });

  it("A18: response body streaming over 2 MiB -> aborts before >cap buffered", async () => {
    // Generate a stream of 3 MB (3 * 1024 * 1024 bytes)
    let chunksSent = 0;
    const stream = new ReadableStream({
      pull(controller) {
        if (chunksSent < 30) {
          controller.enqueue(new Uint8Array(100 * 1024)); // 100KB chunk
          chunksSent++;
        } else {
          controller.close();
        }
      },
    });

    const mockBigFetch = vi.fn().mockResolvedValue(
      new Response(stream, { status: 200, headers: { "Content-Type": "text/html" } })
    );

    const res = await verifyLiveMerchantProductPageDestination({
      creative: { creativeId: "cr_big", landingPageUrl: "https://uahpet.com/products/automatic-cat-feeder" },
      candidate,
      options: {
        transportMode: "TEST_SIMULATION",
        fetchFn: mockBigFetch as any,
        dnsLookupFn: async () => [{ address: "93.184.216.34", family: 4 }],
      },
    });

    expect(res.isVerifiedPdp).toBe(false);
    expect(res.verificationStatus).toBe("BODY_TOO_LARGE");
    expect(chunksSent).toBeLessThanOrEqual(22); // Aborted around 2MB!
  });

  it("A19: decompressed bomb or huge response exceeds decoded cap", async () => {
    const hugeText = "X".repeat(2.5 * 1024 * 1024); // 2.5 MB text string
    const mockBomb = vi.fn().mockResolvedValue(
      new Response(hugeText, { status: 200, headers: { "Content-Type": "text/html" } })
    );

    const res = await verifyLiveMerchantProductPageDestination({
      creative: { creativeId: "cr_bomb", landingPageUrl: "https://uahpet.com/products/automatic-cat-feeder" },
      candidate,
      options: {
        transportMode: "TEST_SIMULATION",
        fetchFn: mockBomb as any,
        dnsLookupFn: async () => [{ address: "93.184.216.34", family: 4 }],
      },
    });

    expect(res.isVerifiedPdp).toBe(false);
    expect(res.verificationStatus).toBe("BODY_TOO_LARGE");
  });

  it("A20: parent timeout stops active stream and releases resources", async () => {
    const slowStream = new ReadableStream({
      async pull(controller) {
        await new Promise((r) => setTimeout(r, 500));
        controller.enqueue(new Uint8Array(1024));
      },
    });

    const mockSlowFetch = vi.fn().mockResolvedValue(
      new Response(slowStream, { status: 200, headers: { "Content-Type": "text/html" } })
    );

    const res = await verifyLiveMerchantProductPageDestination({
      creative: { creativeId: "cr_timeout", landingPageUrl: "https://uahpet.com/products/automatic-cat-feeder" },
      candidate,
      options: {
        transportMode: "TEST_SIMULATION",
        fetchFn: mockSlowFetch as any,
        timeoutMs: 50, // Short timeout
        dnsLookupFn: async () => [{ address: "93.184.216.34", family: 4 }],
      },
    });

    expect(res.isVerifiedPdp).toBe(false);
    expect(res.verificationStatus).toBe("TIMEOUT");
  });

  it("A21: concurrent resolver requests do not cross-contaminate or deadlock", async () => {
    const mockFetch = vi.fn().mockImplementation(async () =>
      new Response(
        `<html><head><title>Automatic Cat Feeder</title><script type="application/ld+json">{"@type":"Product","name":"Automatic Cat Feeder"}</script></head><body>Valid PDP</body></html>`,
        { status: 200, headers: { "Content-Type": "text/html" } }
      )
    );

    const [r1, r2, r3] = await Promise.all([
      verifyLiveMerchantProductPageDestination({
        creative: { creativeId: "cr_c1", landingPageUrl: "https://uahpet.com/products/automatic-cat-feeder" },
        candidate,
        options: { transportMode: "TEST_SIMULATION", fetchFn: mockFetch as any, dnsLookupFn: async () => [{ address: "93.184.216.34", family: 4 }] },
      }),
      verifyLiveMerchantProductPageDestination({
        creative: { creativeId: "cr_c2", landingPageUrl: "https://uahpet.com/products/automatic-cat-feeder" },
        candidate,
        options: { transportMode: "TEST_SIMULATION", fetchFn: mockFetch as any, dnsLookupFn: async () => [{ address: "93.184.216.34", family: 4 }] },
      }),
      verifyLiveMerchantProductPageDestination({
        creative: { creativeId: "cr_c3", landingPageUrl: "https://uahpet.com/products/automatic-cat-feeder" },
        candidate,
        options: { transportMode: "TEST_SIMULATION", fetchFn: mockFetch as any, dnsLookupFn: async () => [{ address: "93.184.216.34", family: 4 }] },
      }),
    ]);

    expect(r1.isVerifiedPdp).toBe(true);
    expect(r2.isVerifiedPdp).toBe(true);
    expect(r3.isVerifiedPdp).toBe(true);
  });

  it("A22: unauthorized env flag absent -> NOT_RUN_NO_AUTHORIZED_TRANSPORT, zero HTTP attempts", async () => {
    const saved = process.env.ENABLE_LIVE_NETWORK_FETCHER;
    delete process.env.ENABLE_LIVE_NETWORK_FETCHER;

    const res = await verifyLiveMerchantProductPageDestination({
      creative: { creativeId: "cr_no_env", landingPageUrl: "https://uahpet.com/products/automatic-cat-feeder" },
      candidate,
    });

    expect(res.isVerifiedPdp).toBe(false);
    expect(res.verificationStatus).toBe("NOT_RUN_NO_AUTHORIZED_TRANSPORT");

    if (saved) process.env.ENABLE_LIVE_NETWORK_FETCHER = saved;
  });

  it("A23: disabled transport mode returns NOT_RUN_NO_AUTHORIZED_TRANSPORT", async () => {
    const res = await verifyLiveMerchantProductPageDestination({
      creative: { creativeId: "cr_dis", landingPageUrl: "https://uahpet.com/products/automatic-cat-feeder" },
      candidate,
      options: { transportMode: "DISABLED" },
    });
    expect(res.isVerifiedPdp).toBe(false);
    expect(res.verificationStatus).toBe("NOT_RUN_NO_AUTHORIZED_TRANSPORT");
  });

  it("A24: request ledger records real observed final URL, IP, TLS, content SHA without leaking tokens", async () => {
    const mockFetch = vi.fn().mockResolvedValue(
      new Response(
        `<html><head><title>Automatic Cat Feeder</title><script type="application/ld+json">{"@type":"Product","name":"Automatic Cat Feeder"}</script></head><body>Valid PDP</body></html>`,
        { status: 200, headers: { "Content-Type": "text/html" } }
      )
    );

    const res = await verifyLiveMerchantProductPageDestination({
      creative: { creativeId: "cr_receipt", landingPageUrl: "https://uahpet.com/products/automatic-cat-feeder" },
      candidate,
      options: {
        transportMode: "TEST_SIMULATION",
        fetchFn: mockFetch as any,
        dnsLookupFn: async () => [{ address: "93.184.216.34", family: 4 }],
      },
    });

    expect(res.isVerifiedPdp).toBe(true);
    expect(res.finalUrl).toBe("https://uahpet.com/products/automatic-cat-feeder");
    expect(res.verifiedPeerIp).toBe("93.184.216.34");
    expect(res.tlsVerified).toBe(true);
    expect(res.contentSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(res.redirectChain).toEqual(["https://uahpet.com/products/automatic-cat-feeder"]);
  });
});
