/**
 * ANTI — KH-02 V12.4.3.7.18.1: REAL TLS PEER CERT ISOLATION
 *
 * Spawns an isolated local HTTPS TLS server to verify:
 * 1. Actual socket.remoteAddress matches pinned IP.
 * 2. TLS certificate authorization failure on untrusted certificate.
 * 3. Self-signed test certificates never grant CA-verified status or live authority.
 * 4. SOCKET_PEER_MISMATCH immediate connection termination on IP drift.
 * 5. Clean teardown with zero dangling open handles.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import https from "node:https";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execSync } from "node:child_process";
import {
  performAuditedSecureTlsFetch,
  verifyLiveMerchantProductPageDestination,
} from "@/services/kh02/identity/verifiedMerchantPdpResolver";

describe("KH-02 V12.4.3.7.18.1: Real TLS Peer & Certificate Isolation", () => {
  let server: https.Server;
  let serverPort: number;
  let keyPath: string;
  let certPath: string;

  const validHtml = `<!DOCTYPE html><html><head>
    <title>Smart Feeder - Local Store</title>
    <script type="application/ld+json">
      {
        "@context": "https://schema.org",
        "@type": "Product",
        "name": "Smart Feeder",
        "offers": { "@type": "Offer", "price": "59.99" }
      }
    </script>
  </head><body><h1>Smart Feeder</h1></body></html>`;

  beforeAll(async () => {
    if (process.platform === "win32" && !process.env.PATH?.includes("Git\\usr\\bin")) {
      const gitUsrBin = "C:\\Program Files\\Git\\usr\\bin";
      if (fs.existsSync(gitUsrBin)) {
        process.env.PATH = `${gitUsrBin};${process.env.PATH}`;
      }
    }

    const tmpDir = os.tmpdir();
    keyPath = path.join(tmpDir, `swai_v18_1_key_${Date.now()}.pem`);
    certPath = path.join(tmpDir, `swai_v18_1_cert_${Date.now()}.pem`);

    execSync(
      `openssl req -x509 -newkey rsa:2048 -nodes -sha256 -subj '/CN=127.0.0.1' -keyout "${keyPath}" -out "${certPath}" -days 1`,
      { stdio: "ignore" }
    );

    const key = fs.readFileSync(keyPath);
    const cert = fs.readFileSync(certPath);

    server = https.createServer({ key, cert }, (req, res) => {
      const url = new URL(req.url || "/", `https://${req.headers.host}`);
      if (url.pathname === "/products/smart-feeder") {
        res.writeHead(200, {
          "content-type": "text/html; charset=utf-8",
          connection: "close",
        });
        res.end(validHtml);
        return;
      }

      if (url.pathname === "/large-stream") {
        res.writeHead(200, {
          "content-type": "text/html",
          connection: "close",
        });
        res.write("B".repeat(1024 * 1024));
        res.write("B".repeat(1024 * 1024));
        res.write("B".repeat(100 * 1024)); // > 2MB
        res.end();
        return;
      }

      res.writeHead(404);
      res.end("Not Found");
    });

    await new Promise<void>((resolve) => {
      server.listen(0, "127.0.0.1", () => {
        const addr = server.address();
        if (addr && typeof addr === "object") {
          serverPort = addr.port;
        }
        resolve();
      });
    });
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => {
      if (server) {
        server.close(() => resolve());
      } else {
        resolve();
      }
    });

    try { if (fs.existsSync(keyPath)) fs.unlinkSync(keyPath); } catch {}
    try { if (fs.existsSync(certPath)) fs.unlinkSync(certPath); } catch {}
  });

  it("TLS01: Direct performAuditedSecureTlsFetch captures actual socket remoteAddress 127.0.0.1", async () => {
    const controller = new AbortController();
    const url = `https://127.0.0.1:${serverPort}/products/smart-feeder`;

    const resp = await performAuditedSecureTlsFetch(url, "127.0.0.1", controller.signal, 5000, {
      allowSelfSignedTestCert: true,
      allowLoopbackForTest: true,
    });

    expect(resp.statusCode).toBe(200);
    expect(resp.actualPeerIp).toBe("127.0.0.1");
    expect(resp.isRealSocket).toBe(true);
    // Since it's self-signed without system CA, tlsAuthorized is false
    expect(resp.tlsAuthorized).toBe(false);
  });

  it("TLS02: Direct performAuditedSecureTlsFetch rejects unvetted certificate when allowSelfSignedTestCert=false", async () => {
    const controller = new AbortController();
    const url = `https://127.0.0.1:${serverPort}/products/smart-feeder`;

    await expect(
      performAuditedSecureTlsFetch(url, "127.0.0.1", controller.signal, 5000, {
        allowSelfSignedTestCert: false, // Strict mode
        allowLoopbackForTest: true,
      })
    ).rejects.toThrow();
  });

  it("TLS03: Socket peer mismatch throws SOCKET_PEER_MISMATCH immediately", async () => {
    const controller = new AbortController();
    const url = `https://127.0.0.1:${serverPort}/products/smart-feeder`;

    // Pretend pinned IP is 93.184.216.34, but socket actually connects to 127.0.0.1
    await expect(
      performAuditedSecureTlsFetch(url, "93.184.216.34", controller.signal, 5000, {
        allowSelfSignedTestCert: true,
        allowLoopbackForTest: true,
      })
    ).rejects.toThrow("SOCKET_PEER_MISMATCH");
  });

  it("TLS04: Full resolver with self-signed test server yields TEST_ONLY and tlsVerified: false", async () => {
    const res = await verifyLiveMerchantProductPageDestination({
      creative: {
        creativeId: "cr_local_01",
        landingPageUrl: `https://127.0.0.1:${serverPort}/products/smart-feeder`,
      },
      candidate: {
        candidateId: "cand_local_01",
        storeDomain: "127.0.0.1",
        canonicalProductUrl: `https://127.0.0.1:${serverPort}/products/smart-feeder`,
        title: "Smart Feeder",
      },
      options: {
        allowLoopbackForTest: true,
        allowSelfSignedTestCert: true,
      },
    });

    expect(res.isVerifiedPdp).toBe(true);
    expect(res.verificationStatus).toBe("TEST_ONLY");
    expect(res.isLiveExternalProof).toBe(false);
    expect(res.tlsVerified).toBe(false); // Self-signed is not CA verified
    expect(res.verifiedPeerIp).toBe("127.0.0.1");
  });

  it("TLS05: Stream > 2 MiB aborts socket with BODY_TOO_LARGE", async () => {
    const controller = new AbortController();
    const url = `https://127.0.0.1:${serverPort}/large-stream`;

    await expect(
      performAuditedSecureTlsFetch(url, "127.0.0.1", controller.signal, 5000, {
        allowSelfSignedTestCert: true,
        allowLoopbackForTest: true,
      })
    ).rejects.toThrow("BODY_TOO_LARGE");
  });
});

