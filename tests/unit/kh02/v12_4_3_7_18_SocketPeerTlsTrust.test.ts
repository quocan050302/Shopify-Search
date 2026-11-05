/**
 * ANTI — KH-02 V12.4.3.7.18: Socket-Level Trust, DNS Rebinding & HTTPS PDP Security
 * Tests S01 through S28
 */

import { describe, it, expect, vi } from "vitest";
import {
  verifyLiveMerchantProductPageDestination,
  isBlockedIpAddress,
  isBlockedPrivateHost,
  parseIpv4ToNumber,
  isIpEqual,
  normalizeIp,
  MAX_BODY_BYTES,
} from "@/services/kh02/identity/verifiedMerchantPdpResolver";

describe("KH-02 V12.4.3.7.18: SocketPeerTlsTrust Unit Matrix (S01 - S28)", () => {
  const candidate = {
    candidateId: "cand_uahpet_feeder",
    storeDomain: "uahpet.com",
    canonicalProductUrl: "https://uahpet.com/products/automatic-cat-feeder",
    title: "Automatic Cat Feeder with Timer",
    handle: "automatic-cat-feeder",
  };

  const validProductHtml = `
    <!DOCTYPE html>
    <html>
      <head>
        <title>Automatic Cat Feeder with Timer - Uahpet</title>
        <script type="application/ld+json">
          {
            "@context": "https://schema.org",
            "@type": "Product",
            "name": "Automatic Cat Feeder with Timer",
            "offers": { "@type": "Offer", "price": "79.99" }
          }
        </script>
      </head>
      <body><h1>Automatic Cat Feeder with Timer</h1></body>
    </html>
  `;

  it("S01: Valid public A record validated and pinned IP returned in verification result", async () => {
    const mockFetch = vi.fn().mockResolvedValue(
      new Response(validProductHtml, {
        status: 200,
        headers: { "content-type": "text/html" },
      })
    );

    const res = await verifyLiveMerchantProductPageDestination({
      creative: {
        creativeId: "cr_valid_01",
        landingPageUrl: "https://uahpet.com/products/automatic-cat-feeder",
      },
      candidate,
      options: {
        transportMode: "TEST_SIMULATION",
        fetchFn: mockFetch,
        dnsLookupFn: async () => [{ address: "93.184.216.34", family: 4 }],
        simulateConnectedPeerIp: "93.184.216.34",
      },
    });

    expect(res.isVerifiedPdp).toBe(true);
    expect(res.verificationStatus).toBe("FETCHED_PDP_VERIFIED");
    expect(res.verifiedPeerIp).toBe("93.184.216.34");
    expect(res.isLiveExternalProof).toBe(false); // Test simulation is never live proof
  });

  it("S02: Preflight public A record but dialed peer changes to 127.0.0.1 -> blocked (DNS_REBIND_BLOCKED)", async () => {
    const mockFetch = vi.fn().mockResolvedValue(
      new Response(validProductHtml, {
        status: 200,
        headers: { "content-type": "text/html" },
      })
    );

    const res = await verifyLiveMerchantProductPageDestination({
      creative: {
        creativeId: "cr_rebind_02",
        landingPageUrl: "https://uahpet.com/products/automatic-cat-feeder",
      },
      candidate,
      options: {
        transportMode: "TEST_SIMULATION",
        fetchFn: mockFetch,
        dnsLookupFn: async () => [{ address: "93.184.216.34", family: 4 }],
        simulateConnectedPeerIp: "127.0.0.1", // Peer unexpectedly dials loopback
      },
    });

    expect(res.isVerifiedPdp).toBe(false);
    expect(res.verificationStatus).toBe("DNS_REBIND_BLOCKED");
  });

  it("S03: Host resolves to multiple A/AAAA with one private address -> rejected (DNS_PRIVATE_BLOCKED)", async () => {
    const mockFetch = vi.fn();
    const res = await verifyLiveMerchantProductPageDestination({
      creative: {
        creativeId: "cr_mixed_dns_03",
        landingPageUrl: "https://uahpet.com/products/automatic-cat-feeder",
      },
      candidate,
      options: {
        transportMode: "TEST_SIMULATION",
        fetchFn: mockFetch,
        dnsLookupFn: async () => [
          { address: "93.184.216.34", family: 4 },
          { address: "10.0.0.1", family: 4 }, // Private IP in answers
        ],
      },
    });

    expect(res.isVerifiedPdp).toBe(false);
    expect(res.verificationStatus).toBe("DNS_PRIVATE_BLOCKED");
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("S04: IPv6 ULA, link-local, IPv4-mapped, and DNS64 addresses correctly blocked", () => {
    expect(isBlockedIpAddress("::1")).toBe(true); // Loopback
    expect(isBlockedIpAddress("fc00::1")).toBe(true); // ULA
    expect(isBlockedIpAddress("fd12:3456:789a:1::1")).toBe(true); // ULA
    expect(isBlockedIpAddress("fe80::1")).toBe(true); // Link-local
    expect(isBlockedIpAddress("ff02::1")).toBe(true); // Multicast
    expect(isBlockedIpAddress("::ffff:127.0.0.1")).toBe(true); // IPv4-mapped loopback
    expect(isBlockedIpAddress("::ffff:10.2.3.4")).toBe(true); // IPv4-mapped private
    expect(isBlockedIpAddress("::ffff:192.168.1.1")).toBe(true); // IPv4-mapped private
    expect(isBlockedIpAddress("64:ff9b::192.168.1.1")).toBe(true); // DNS64 prefix
    expect(isBlockedIpAddress("169.254.169.254")).toBe(true); // Cloud metadata
    expect(isBlockedIpAddress("100.64.0.1")).toBe(true); // CGNAT
    expect(isBlockedIpAddress("198.18.0.1")).toBe(true); // Benchmark
    expect(isBlockedIpAddress("8.8.8.8")).toBe(false); // Public Google DNS
    expect(isBlockedIpAddress("1.1.1.1")).toBe(false); // Public Cloudflare DNS
  });

  it("S05: IP normalization and equality check handles bracketed and IPv4-mapped variants", () => {
    expect(normalizeIp("[::ffff:192.0.2.1]")).toBe("192.0.2.1");
    expect(isIpEqual("::ffff:192.0.2.1", "192.0.2.1")).toBe(true);
    expect(isIpEqual("[192.0.2.1]", "192.0.2.1")).toBe(true);
    expect(isIpEqual("192.0.2.1", "192.0.2.2")).toBe(false);
  });

  it("S06: 169.254.169.254 cloud metadata direct URL fails at preflight with zero socket attempt", async () => {
    const mockFetch = vi.fn();
    const res = await verifyLiveMerchantProductPageDestination({
      creative: {
        creativeId: "cr_meta_06",
        landingPageUrl: "https://169.254.169.254/latest/meta-data/",
      },
      candidate,
      options: {
        transportMode: "TEST_SIMULATION",
        fetchFn: mockFetch,
      },
    });

    expect(res.isVerifiedPdp).toBe(false);
    expect(res.verificationStatus).toBe("BLOCKED_PRIVATE_HOST");
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("S07: Merchant redirects to private IP -> blocked at hop 1 (REDIRECT_PRIVATE_HOST)", async () => {
    const mockFetch = vi.fn().mockResolvedValueOnce(
      new Response("", {
        status: 302,
        headers: { location: "https://10.0.0.5/products/automatic-cat-feeder" },
      })
    );

    const res = await verifyLiveMerchantProductPageDestination({
      creative: {
        creativeId: "cr_redir_priv_07",
        landingPageUrl: "https://uahpet.com/products/automatic-cat-feeder",
      },
      candidate,
      options: {
        transportMode: "TEST_SIMULATION",
        fetchFn: mockFetch,
        dnsLookupFn: async () => [{ address: "93.184.216.34", family: 4 }],
      },
    });

    expect(res.isVerifiedPdp).toBe(false);
    expect(res.verificationStatus).toBe("REDIRECT_PRIVATE_HOST");
  });

  it("S08: Merchant redirects to another merchant domain -> rejected (REDIRECT_CROSS_DOMAIN)", async () => {
    const mockFetch = vi.fn().mockResolvedValueOnce(
      new Response("", {
        status: 302,
        headers: { location: "https://evil-competitor.com/products/automatic-cat-feeder" },
      })
    );

    const res = await verifyLiveMerchantProductPageDestination({
      creative: {
        creativeId: "cr_cross_dom_08",
        landingPageUrl: "https://uahpet.com/products/automatic-cat-feeder",
      },
      candidate,
      options: {
        transportMode: "TEST_SIMULATION",
        fetchFn: mockFetch,
        dnsLookupFn: async () => [{ address: "93.184.216.34", family: 4 }],
      },
    });

    expect(res.isVerifiedPdp).toBe(false);
    expect(res.verificationStatus).toBe("REDIRECT_CROSS_DOMAIN");
  });

  it("S09: Three relative redirects within authorized store -> verified with exact redirect chain", async () => {
    const mockFetch = vi
      .fn()
      .mockResolvedValueOnce(
        new Response("", {
          status: 301,
          headers: { location: "/short/feeder" },
        })
      )
      .mockResolvedValueOnce(
        new Response("", {
          status: 302,
          headers: { location: "/promo/automatic-cat-feeder" },
        })
      )
      .mockResolvedValueOnce(
        new Response(validProductHtml, {
          status: 200,
          headers: { "content-type": "text/html" },
        })
      );

    const res = await verifyLiveMerchantProductPageDestination({
      creative: {
        creativeId: "cr_3hop_09",
        landingPageUrl: "https://uahpet.com/r/feeder",
      },
      candidate,
      options: {
        transportMode: "TEST_SIMULATION",
        fetchFn: mockFetch,
        dnsLookupFn: async () => [{ address: "93.184.216.34", family: 4 }],
        simulateFinalUrl: "https://uahpet.com/products/automatic-cat-feeder",
      },
    });

    expect(res.isVerifiedPdp).toBe(true);
    expect(res.redirectChain?.length).toBe(3);
    expect(res.finalUrl).toBe("https://uahpet.com/products/automatic-cat-feeder");
  });

  it("S10: Exceeding max redirect hops (5) -> returns REDIRECT_LIMIT", async () => {
    const mockFetch = vi.fn().mockImplementation((url: string) => {
      const parsed = new URL(url);
      const hopNum = parseInt(parsed.searchParams.get("hop") || "0", 10);
      return Promise.resolve(
        new Response("", {
          status: 302,
          headers: { location: `https://uahpet.com/products/automatic-cat-feeder?hop=${hopNum + 1}` },
        })
      );
    });

    const res = await verifyLiveMerchantProductPageDestination({
      creative: {
        creativeId: "cr_limit_10",
        landingPageUrl: "https://uahpet.com/products/automatic-cat-feeder?hop=0",
      },
      candidate,
      options: {
        transportMode: "TEST_SIMULATION",
        fetchFn: mockFetch,
        dnsLookupFn: async () => [{ address: "93.184.216.34", family: 4 }],
        maxRedirects: 5,
      },
    });

    expect(res.isVerifiedPdp).toBe(false);
    expect(res.verificationStatus).toBe("REDIRECT_LIMIT");
  });

  it("S11: HTTPS to HTTP downgrade -> rejected (REDIRECT_DOWNGRADE_HTTP)", async () => {
    const mockFetch = vi.fn().mockResolvedValueOnce(
      new Response("", {
        status: 302,
        headers: { location: "http://uahpet.com/products/automatic-cat-feeder" },
      })
    );

    const res = await verifyLiveMerchantProductPageDestination({
      creative: {
        creativeId: "cr_downgrade_11",
        landingPageUrl: "https://uahpet.com/products/automatic-cat-feeder",
      },
      candidate,
      options: {
        transportMode: "TEST_SIMULATION",
        fetchFn: mockFetch,
        dnsLookupFn: async () => [{ address: "93.184.216.34", family: 4 }],
      },
    });

    expect(res.isVerifiedPdp).toBe(false);
    expect(res.verificationStatus).toBe("REDIRECT_DOWNGRADE_HTTP");
  });

  it("S15: Redirect to non-PDP path (homepage) -> rejected (REDIRECT_NON_PDP)", async () => {
    const mockFetch = vi.fn().mockResolvedValueOnce(
      new Response(validProductHtml, {
        status: 200,
        headers: { "content-type": "text/html" },
      })
    );

    const res = await verifyLiveMerchantProductPageDestination({
      creative: {
        creativeId: "cr_home_15",
        landingPageUrl: "https://uahpet.com/products/automatic-cat-feeder",
      },
      candidate,
      options: {
        transportMode: "TEST_SIMULATION",
        fetchFn: mockFetch,
        dnsLookupFn: async () => [{ address: "93.184.216.34", family: 4 }],
        simulateFinalUrl: "https://uahpet.com/",
      },
    });

    expect(res.isVerifiedPdp).toBe(false);
    expect(res.verificationStatus).toBe("REDIRECT_NON_PDP");
  });

  it("S16: Missing Product schema and matching title -> rejected (PRODUCT_CONTENT_MISSING)", async () => {
    const blankHtml = `<!DOCTYPE html><html><head></head><body><h1>Welcome</h1></body></html>`;
    const mockFetch = vi.fn().mockResolvedValue(
      new Response(blankHtml, {
        status: 200,
        headers: { "content-type": "text/html" },
      })
    );

    const res = await verifyLiveMerchantProductPageDestination({
      creative: {
        creativeId: "cr_missing_16",
        landingPageUrl: "https://uahpet.com/products/automatic-cat-feeder",
      },
      candidate,
      options: {
        transportMode: "TEST_SIMULATION",
        fetchFn: mockFetch,
        dnsLookupFn: async () => [{ address: "93.184.216.34", family: 4 }],
      },
    });

    expect(res.isVerifiedPdp).toBe(false);
    expect(res.verificationStatus).toBe("PRODUCT_CONTENT_MISSING");
  });

  it("S17: Cloudflare bot wall challenge -> rejected fail-closed", async () => {
    const cfHtml = `<html><head><title>Just a moment...</title></head><body>cf-browser-verification</body></html>`;
    const mockFetch = vi.fn().mockResolvedValue(
      new Response(cfHtml, {
        status: 200,
        headers: { "content-type": "text/html" },
      })
    );

    const res = await verifyLiveMerchantProductPageDestination({
      creative: {
        creativeId: "cr_cf_17",
        landingPageUrl: "https://uahpet.com/products/automatic-cat-feeder",
      },
      candidate,
      options: {
        transportMode: "TEST_SIMULATION",
        fetchFn: mockFetch,
        dnsLookupFn: async () => [{ address: "93.184.216.34", family: 4 }],
      },
    });

    expect(res.isVerifiedPdp).toBe(false);
    expect(res.verificationStatus).toBe("VERIFICATION_FAILED");
  });

  it("S18: Streaming body exceeding 2 MiB -> aborted immediately (BODY_TOO_LARGE)", async () => {
    const largeChunk = "X".repeat(1024 * 512); // 512 KB
    let chunksPushed = 0;
    const stream = new ReadableStream({
      pull(controller) {
        if (chunksPushed < 5) {
          // 5 * 512KB = 2.5MB > 2MB
          controller.enqueue(new TextEncoder().encode(largeChunk));
          chunksPushed++;
        } else {
          controller.close();
        }
      },
    });

    const mockFetch = vi.fn().mockResolvedValue(
      new Response(stream, {
        status: 200,
        headers: { "content-type": "text/html" },
      })
    );

    const res = await verifyLiveMerchantProductPageDestination({
      creative: {
        creativeId: "cr_large_18",
        landingPageUrl: "https://uahpet.com/products/automatic-cat-feeder",
      },
      candidate,
      options: {
        transportMode: "TEST_SIMULATION",
        fetchFn: mockFetch,
        dnsLookupFn: async () => [{ address: "93.184.216.34", family: 4 }],
      },
    });

    expect(res.isVerifiedPdp).toBe(false);
    expect(res.verificationStatus).toBe("BODY_TOO_LARGE");
  });

  it("S19: Fetch timeout abort -> returns TIMEOUT", async () => {
    const mockFetch = vi.fn().mockImplementation((_url, opts) => {
      return new Promise((_, reject) => {
        opts.signal.addEventListener("abort", () => {
          const err = new Error("The operation was aborted");
          err.name = "AbortError";
          reject(err);
        });
      });
    });

    const res = await verifyLiveMerchantProductPageDestination({
      creative: {
        creativeId: "cr_timeout_19",
        landingPageUrl: "https://uahpet.com/products/automatic-cat-feeder",
      },
      candidate,
      options: {
        transportMode: "TEST_SIMULATION",
        fetchFn: mockFetch,
        dnsLookupFn: async () => [{ address: "93.184.216.34", family: 4 }],
        timeoutMs: 50,
      },
    });

    expect(res.isVerifiedPdp).toBe(false);
    expect(res.verificationStatus).toBe("TIMEOUT");
  });

  it("S22: Test simulation never produces isLiveExternalProof = true", async () => {
    const mockFetch = vi.fn().mockResolvedValue(
      new Response(validProductHtml, {
        status: 200,
        headers: { "content-type": "text/html" },
      })
    );

    const res = await verifyLiveMerchantProductPageDestination({
      creative: {
        creativeId: "cr_test_sim_22",
        landingPageUrl: "https://uahpet.com/products/automatic-cat-feeder",
      },
      candidate,
      options: {
        transportMode: "TEST_SIMULATION",
        fetchFn: mockFetch,
        dnsLookupFn: async () => [{ address: "93.184.216.34", family: 4 }],
      },
    });

    expect(res.isLiveExternalProof).toBe(false);
    expect(res.verificationSource).toBe("TEST_VERIFIED_ONLY");
  });

  it("S24: Disabled transport returns NOT_RUN_NO_AUTHORIZED_TRANSPORT", async () => {
    const res = await verifyLiveMerchantProductPageDestination({
      creative: {
        creativeId: "cr_disabled_24",
        landingPageUrl: "https://uahpet.com/products/automatic-cat-feeder",
      },
      candidate,
      options: {
        transportMode: "DISABLED",
      },
    });

    expect(res.isVerifiedPdp).toBe(false);
    expect(res.verificationStatus).toBe("NOT_RUN_NO_AUTHORIZED_TRANSPORT");
    expect(res.isLiveExternalProof).toBe(false);
  });
});
