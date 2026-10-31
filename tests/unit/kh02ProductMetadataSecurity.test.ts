import { describe, it, expect, vi } from "vitest";
import {
  isSafePublicUrl,
  isIpAddressPrivate,
  fetchVerifiedProductPageMetadata,
} from "@/services/kh02/identity/productMetadataExtractor";

describe("SWAI KH-02 — Product Metadata Extractor Security & SSRF Defense", () => {
  it("rejects loopback, local, and private IPv4 addresses", () => {
    expect(isSafePublicUrl("http://localhost:3000/products/test")).toBe(false);
    expect(isSafePublicUrl("http://127.0.0.1/products/test")).toBe(false);
    expect(isSafePublicUrl("http://0.0.0.0/products/test")).toBe(false);
    expect(isSafePublicUrl("http://10.0.0.5/products/test")).toBe(false);
    expect(isSafePublicUrl("http://192.168.1.100/products/test")).toBe(false);
    expect(isSafePublicUrl("http://172.16.0.1/products/test")).toBe(false);
    expect(isSafePublicUrl("http://172.25.1.1/products/test")).toBe(false);
    expect(isSafePublicUrl("http://172.31.255.255/products/test")).toBe(false);
  });

  it("rejects cloud metadata IPs and internal hostnames", () => {
    expect(isSafePublicUrl("http://169.254.169.254/latest/meta-data")).toBe(false);
    expect(isSafePublicUrl("http://metadata.google.internal/computeMetadata/v1")).toBe(false);
    expect(isSafePublicUrl("http://instance-data/latest/meta-data")).toBe(false);
  });

  it("rejects non-http/https protocols", () => {
    expect(isSafePublicUrl("file:///etc/passwd")).toBe(false);
    expect(isSafePublicUrl("ftp://example.com/item")).toBe(false);
    expect(isSafePublicUrl("javascript:alert(1)")).toBe(false);
    expect(isSafePublicUrl("data:text/html,<b>hi</b>")).toBe(false);
  });

  it("accurately classifies private and loopback IPv4 and IPv6 addresses", () => {
    expect(isIpAddressPrivate("127.0.0.1")).toBe(true);
    expect(isIpAddressPrivate("10.10.10.10")).toBe(true);
    expect(isIpAddressPrivate("192.168.0.1")).toBe(true);
    expect(isIpAddressPrivate("172.16.1.1")).toBe(true);
    expect(isIpAddressPrivate("172.31.1.1")).toBe(true);
    expect(isIpAddressPrivate("169.254.169.254")).toBe(true);
    expect(isIpAddressPrivate("::1")).toBe(true);
    expect(isIpAddressPrivate("fc00::1")).toBe(true);
    expect(isIpAddressPrivate("fe80::1")).toBe(true);
    expect(isIpAddressPrivate("8.8.8.8")).toBe(false);
    expect(isIpAddressPrivate("104.26.10.228")).toBe(false);
  });

  it("safely blocks redirects targeting private addresses or loopback", async () => {
    // Mock fetch implementation that redirects to 127.0.0.1
    const mockFetch = vi.fn().mockResolvedValue({
      status: 302,
      headers: new Headers({
        Location: "http://127.0.0.1:8080/admin/secret",
      }),
    });

    const result = await fetchVerifiedProductPageMetadata("https://legit-shop.com/products/wand", {
      fetchFn: mockFetch as any,
    });

    expect(result.isSafe).toBe(false);
    expect(result.fetchError).toMatch(/redirect.*blocked|private/i);
  });

  it("enforces a strict redirect depth limit", async () => {
    let redirectCount = 0;
    const mockFetch = vi.fn().mockImplementation(() => {
      redirectCount++;
      return Promise.resolve({
        status: 302,
        headers: new Headers({
          Location: `https://legit-shop.com/hop-${redirectCount}`,
        }),
      });
    });

    const result = await fetchVerifiedProductPageMetadata("https://legit-shop.com/start", {
      fetchFn: mockFetch as any,
    });

    expect(result.pageType).toBe("ERROR_PAGE");
    expect(result.fetchError).toMatch(/redirect depth limit|too many redirects/i);
    expect(redirectCount).toBeLessThanOrEqual(6);
  });

  it("enforces streaming byte limit on oversized responses", async () => {
    const hugeChunk = new Uint8Array(100 * 1024); // 100KB chunks
    let chunkCount = 0;
    let cancelled = false;

    const mockStream = new ReadableStream({
      pull(controller) {
        chunkCount++;
        if (chunkCount <= 10) {
          controller.enqueue(hugeChunk);
        } else {
          controller.close();
        }
      },
      cancel() {
        cancelled = true;
      },
    });

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers({
        "content-type": "text/html; charset=utf-8",
      }),
      body: mockStream,
    });

    const result = await fetchVerifiedProductPageMetadata("https://legit-shop.com/products/heavy-item", {
      fetchFn: mockFetch as any,
      maxSizeBytes: 256 * 1024, // 256KB
    });

    expect(cancelled).toBe(true);
    expect(result.isSafe).toBe(true);
  });
});
