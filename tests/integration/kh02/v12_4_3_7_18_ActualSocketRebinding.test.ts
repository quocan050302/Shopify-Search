/**
 * ANTI — KH-02 V12.4.3.7.18: Integration Test — Actual Socket Rebinding, Real Peer IP & TLS Verification
 *
 * Spawns an actual Node https.createServer on loopback with self-signed TLS credentials to verify:
 * 1. Real TCP/TLS socket connection is established.
 * 2. Actual socket.remoteAddress is measured (127.0.0.1) and pinned.
 * 3. Socket peer mismatch detection: connection destroyed if remoteAddress contradicts pinned IP.
 * 4. Strict TLS authorization failure when untrusted certificate presented without bypass.
 * 5. Bounded 2 MiB stream truncation aborting socket without OOM.
 * 6. Clean resource cleanup and socket reaping on abort.
 * 7. Verification isolation: test loopback never sets isLiveExternalProof = true.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import https from "node:https";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execSync } from "node:child_process";
import {
  verifyLiveMerchantProductPageDestination,
  performAuditedSecureTlsFetch,
} from "@/services/kh02/identity/verifiedMerchantPdpResolver";

describe("KH-02 V12.4.3.7.18: ActualSocketRebinding & Real TLS Integration", () => {
  let server: https.Server;
  let serverPort: number;
  let keyPath: string;
  let certPath: string;

  const validPdpBody = `
    <!DOCTYPE html>
    <html>
      <head>
        <title>Smart Cat Feeder - Test Store</title>
        <script type="application/ld+json">
          {
            "@context": "https://schema.org",
            "@type": "Product",
            "name": "Smart Cat Feeder",
            "offers": { "@type": "Offer", "price": "59.99" }
          }
        </script>
      </head>
      <body><h1>Smart Cat Feeder</h1></body>
    </html>
  `;

  beforeAll(async () => {
    const tmpDir = os.tmpdir();
    keyPath = path.join(tmpDir, `swai_test_key_${Date.now()}.pem`);
    certPath = path.join(tmpDir, `swai_test_cert_${Date.now()}.pem`);

    execSync(
      `openssl req -x509 -newkey rsa:2048 -nodes -sha256 -subj '/CN=localhost' -keyout "${keyPath}" -out "${certPath}" -days 1`,
      { stdio: "ignore" }
    );

    const key = fs.readFileSync(keyPath);
    const cert = fs.readFileSync(certPath);

    server = https.createServer({ key, cert }, (req, res) => {
      const url = new URL(req.url || "/", `https://localhost:${serverPort}`);

      if (url.pathname === "/products/smart-cat-feeder") {
        res.writeHead(200, { "Content-Type": "text/html" });
        res.end(validPdpBody);
        return;
      }

      if (url.pathname === "/redirect-to-pdp") {
        res.writeHead(302, { Location: `https://127.0.0.1:${serverPort}/products/smart-cat-feeder` });
        res.end();
        return;
      }

      if (url.pathname === "/oversized-stream") {
        res.writeHead(200, { "Content-Type": "text/html" });
        const chunk = "X".repeat(1024 * 256); // 256 KB
        let count = 0;
        const interval = setInterval(() => {
          if (count++ < 12) {
            // 12 * 256 KB = 3 MB > 2 MB cap
            res.write(chunk);
          } else {
            clearInterval(interval);
            res.end();
          }
        }, 20);
        req.on("close", () => clearInterval(interval));
        return;
      }

      if (url.pathname === "/slow-hang") {
        // Never send response to trigger timeout
        return;
      }

      res.writeHead(404, { "Content-Type": "text/plain" });
      res.end("Not Found");
    });

    await new Promise<void>((resolve) => {
      server.listen(0, "127.0.0.1", () => {
        const addr = server.address();
        if (typeof addr === "object" && addr) {
          serverPort = addr.port;
        }
        resolve();
      });
    });
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => {
      if (server) server.close(() => resolve());
      else resolve();
    });
    try { if (fs.existsSync(keyPath)) fs.unlinkSync(keyPath); } catch {}
    try { if (fs.existsSync(certPath)) fs.unlinkSync(certPath); } catch {}
  });

  it("T01: Real TLS connection dials loopback and measures actual socket.remoteAddress as 127.0.0.1", async () => {
    const targetUrl = `https://127.0.0.1:${serverPort}/products/smart-cat-feeder`;
    const controller = new AbortController();

    const hopResp = await performAuditedSecureTlsFetch(
      targetUrl,
      "127.0.0.1",
      controller.signal,
      5000,
      {
        allowSelfSignedTestCert: true,
        allowLoopbackForTest: true,
      }
    );

    expect(hopResp.statusCode).toBe(200);
    expect(hopResp.isRealSocket).toBe(true);
    expect(hopResp.actualPeerIp).toBe("127.0.0.1");
    expect(hopResp.bodyText).toContain("Smart Cat Feeder");
  });

  it("T02: Peer address mismatch destroys socket and rejects with SOCKET_PEER_MISMATCH", async () => {
    const targetUrl = `https://127.0.0.1:${serverPort}/products/smart-cat-feeder`;
    const controller = new AbortController();

    // Lie about pinned IP: claim the approved IP is 192.0.2.1, but socket connects to 127.0.0.1
    let errorCaught: any = null;
    try {
      await performAuditedSecureTlsFetch(
        targetUrl,
        "192.0.2.1", // Pinned expectation contradicts actual 127.0.0.1 socket
        controller.signal,
        5000,
        {
          allowSelfSignedTestCert: true,
          allowLoopbackForTest: true,
        }
      );
    } catch (err: any) {
      errorCaught = err;
    }

    expect(errorCaught).toBeDefined();
    expect(errorCaught?.message).toBe("SOCKET_PEER_MISMATCH");
  });

  it("T03: TLS certificate verification fails when rejectUnauthorized is active without test bypass", async () => {
    const targetUrl = `https://127.0.0.1:${serverPort}/products/smart-cat-feeder`;
    const controller = new AbortController();

    let errorCaught: any = null;
    try {
      await performAuditedSecureTlsFetch(
        targetUrl,
        "127.0.0.1",
        controller.signal,
        5000,
        {
          allowSelfSignedTestCert: false, // Strict TLS verification of self-signed cert
          allowLoopbackForTest: true,
        }
      );
    } catch (err: any) {
      errorCaught = err;
    }

    expect(errorCaught).toBeDefined();
    expect(errorCaught?.message).toMatch(/self-signed certificate|TLS_AUTHENTICATION_FAILED|DEPTH_ZERO_SELF_SIGNED_CERT|CERT_HAS_EXPIRED|unable to verify/i);
  });

  it("T04: Hop-by-hop redirect on real TLS server reaches PDP and verifies content", async () => {
    const landingUrl = `https://127.0.0.1:${serverPort}/redirect-to-pdp`;

    const res = await verifyLiveMerchantProductPageDestination({
      creative: {
        creativeId: "cr_real_tls_redirect",
        landingPageUrl: landingUrl,
      },
      candidate: {
        candidateId: "cand_test",
        storeDomain: "127.0.0.1",
        title: "Smart Cat Feeder",
        handle: "smart-cat-feeder",
      },
      options: {
        transportMode: "TEST_SIMULATION",
        allowLoopbackForTest: true,
        allowSelfSignedTestCert: true,
        timeoutMs: 5000,
      },
    });

    expect(res.isVerifiedPdp).toBe(true);
    expect(res.redirectChain?.length).toBe(2);
    expect(res.verificationSource).toBe("TEST_VERIFIED_ONLY");
    expect(res.isLiveExternalProof).toBe(false);
  });

  it("T05: Real streaming response exceeding 2 MiB cap aborts socket immediately (BODY_TOO_LARGE)", async () => {
    const targetUrl = `https://127.0.0.1:${serverPort}/oversized-stream`;
    const controller = new AbortController();

    let errorCaught: any = null;
    try {
      await performAuditedSecureTlsFetch(
        targetUrl,
        "127.0.0.1",
        controller.signal,
        5000,
        {
          allowSelfSignedTestCert: true,
          allowLoopbackForTest: true,
        }
      );
    } catch (err: any) {
      errorCaught = err;
    }

    expect(errorCaught).toBeDefined();
    expect(errorCaught?.message).toBe("BODY_TOO_LARGE");
  });

  it("T06: Timeout cleanly aborts socket connection and cancels stream", async () => {
    const targetUrl = `https://127.0.0.1:${serverPort}/slow-hang`;
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 100);

    let errorCaught: any = null;
    try {
      await performAuditedSecureTlsFetch(
        targetUrl,
        "127.0.0.1",
        controller.signal,
        150,
        {
          allowSelfSignedTestCert: true,
          allowLoopbackForTest: true,
        }
      );
    } catch (err: any) {
      errorCaught = err;
    }

    expect(errorCaught).toBeDefined();
    expect(errorCaught?.message).toMatch(/TIMEOUT|aborted/i);
  });
});
