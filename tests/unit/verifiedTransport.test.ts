import { describe, it, expect } from "vitest";
import http from "node:http";
import https from "node:https";
import {
  createVerifiedPublicDispatcher,
  VerifiedPublicDestination,
} from "@/services/links/verifiedPublicTransport";

describe("KH-01 — Checkpoint 2: Destination-Pinned Transport Security", () => {
  it("creates verified dispatcher bound strictly to pre-validated IP", () => {
    const dest: VerifiedPublicDestination = {
      originalHostname: "example.com",
      normalizedHostname: "example.com",
      protocol: "https:",
      port: 443,
      validatedAddresses: ["93.184.216.34"],
      selectedAddress: "93.184.216.34",
      family: 4,
      validatedAt: Date.now(),
    };

    const dispatcher = createVerifiedPublicDispatcher(dest);
    expect(dispatcher.destination.selectedAddress).toBe("93.184.216.34");
    expect(dispatcher.destination.normalizedHostname).toBe("example.com");
    dispatcher.close();
  });

  it("terminates immediately when AbortSignal is pre-aborted", async () => {
    const dest: VerifiedPublicDestination = {
      originalHostname: "example.com",
      normalizedHostname: "example.com",
      protocol: "https:",
      port: 443,
      validatedAddresses: ["93.184.216.34"],
      selectedAddress: "93.184.216.34",
      family: 4,
      validatedAt: Date.now(),
    };

    const dispatcher = createVerifiedPublicDispatcher(dest);
    const controller = new AbortController();
    controller.abort();

    await expect(
      dispatcher.request(new URL("https://example.com/"), {
        signal: controller.signal,
      })
    ).rejects.toThrow(/aborted/i);

    dispatcher.close();
  });

  it("truncates body and sets isTruncated flag when response exceeds maxBytes", async () => {
    // Setup a small local HTTP server to emit 50KB
    const server = http.createServer((req, res) => {
      res.writeHead(200, { "Content-Type": "text/plain" });
      const chunk = Buffer.alloc(1024, "a");
      for (let i = 0; i < 50; i++) {
        res.write(chunk);
      }
      res.end();
    });

    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address() as any;
    const port = address.port;

    const dest: VerifiedPublicDestination = {
      originalHostname: "localhost",
      normalizedHostname: "localhost",
      protocol: "http:",
      port,
      validatedAddresses: ["127.0.0.1"],
      selectedAddress: "127.0.0.1",
      family: 4,
      validatedAt: Date.now(),
    };

    const dispatcher = createVerifiedPublicDispatcher(dest);

    try {
      const res = await dispatcher.request(new URL(`http://localhost:${port}/`), {
        maxBytes: 5 * 1024, // 5KB limit
      });

      expect(res.statusCode).toBe(200);
      expect(res.isTruncated).toBe(true);
      expect(res.bytesRead).toBeGreaterThan(5 * 1024);
      expect(res.body?.length).toBeLessThanOrEqual(5 * 1024);
    } finally {
      dispatcher.close();
      server.close();
    }
  });
});
