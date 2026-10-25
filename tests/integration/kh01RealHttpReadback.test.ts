import { describe, it, expect, beforeAll, afterAll } from "vitest";
import http from "http";
import { AddressInfo } from "net";
import { verifyExactRunHttpReadback } from "../../scripts/kh01/runFullAcceptance";

describe("KH-01 Real HTTP Readback (Part 07, FIX-03 & FIX-04, Invariant 3)", () => {
  let server: http.Server;
  let baseUrl: string;
  const adminApiKey = "test_admin_http_token";
  const workspaceId = "ws_http_readback_test";
  const runId = "run_http_001";

  // State manipulated by tests to simulate real endpoint behavior
  let customHandler: ((req: http.IncomingMessage, res: http.ServerResponse) => void) | null = null;

  beforeAll(async () => {
    server = http.createServer((req, res) => {
      if (customHandler) {
        return customHandler(req, res);
      }
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ success: false, error: "Not found" }));
    });

    await new Promise<void>((resolve) => {
      server.listen(0, "127.0.0.1", () => {
        const addr = server.address() as AddressInfo;
        baseUrl = `http://127.0.0.1:${addr.port}`;
        resolve();
      });
    });
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  const context = {
    workspaceId,
    liveDbHandle: null,
    databaseUrl: "file:test.db",
    startedAt: new Date().toISOString(),
    cleanup: async () => {},
  };

  it("succeeds when real HTTP server returns 200 with body.data matching expected IDs", async () => {
    customHandler = (req, res) => {
      // Validate real HTTP TCP headers
      expect(req.headers["authorization"]).toBe(`Bearer ${adminApiKey}`);
      expect(req.headers["x-workspace-id"]).toBe(workspaceId);

      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          success: true,
          runId,
          data: [
            { id: "ad_001", title: "Ad 1" },
            { id: "ad_002", title: "Ad 2" },
          ],
          pagination: {
            page: 1,
            pageSize: 20,
            total: 2,
            totalPages: 1,
          },
        })
      );
    };

    const serverHandle = { baseUrl, adminApiKey };
    const evidence = await verifyExactRunHttpReadback(
      serverHandle,
      context as any,
      runId,
      ["ad_001", "ad_002"]
    );

    expect(evidence.status).toBe("PASSED");
    expect(evidence.httpStatus).toBe(200);
    expect(evidence.adIds).toEqual(["ad_001", "ad_002"]);
    expect(evidence.pagesFetched).toBe(1);
    expect(evidence.missingIds).toHaveLength(0);
    expect(evidence.unexpectedIds).toHaveLength(0);
    expect(evidence.evidenceOrigin).toBe("ACTUAL_HTTP_RESPONSE");
  });

  it("handles multi-page pagination across real HTTP requests", async () => {
    customHandler = (req, res) => {
      const url = new URL(req.url!, baseUrl);
      const page = parseInt(url.searchParams.get("page") || "1", 10);

      res.writeHead(200, { "Content-Type": "application/json" });
      if (page === 1) {
        res.end(
          JSON.stringify({
            success: true,
            runId,
            data: [{ id: "ad_p1_001" }, { id: "ad_p1_002" }],
            pagination: { page: 1, pageSize: 2, total: 3, totalPages: 2 },
          })
        );
      } else {
        res.end(
          JSON.stringify({
            success: true,
            runId,
            data: [{ id: "ad_p2_003" }],
            pagination: { page: 2, pageSize: 2, total: 3, totalPages: 2 },
          })
        );
      }
    };

    const serverHandle = { baseUrl, adminApiKey };
    const evidence = await verifyExactRunHttpReadback(
      serverHandle,
      context as any,
      runId,
      ["ad_p1_001", "ad_p1_002", "ad_p2_003"]
    );

    expect(evidence.status).toBe("PASSED");
    expect(evidence.pagesFetched).toBe(2);
    expect(evidence.adIds).toEqual(["ad_p1_001", "ad_p1_002", "ad_p2_003"]);
  });

  it("fails when endpoint returns HTTP 401 Unauthorized", async () => {
    customHandler = (_req, res) => {
      res.writeHead(401, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Unauthorized" }));
    };

    const serverHandle = { baseUrl, adminApiKey: "wrong_token" };
    const evidence = await verifyExactRunHttpReadback(
      serverHandle,
      context as any,
      runId,
      ["ad_001"]
    );

    expect(evidence.status).toBe("FAILED");
    expect(evidence.httpStatus).toBe(401);
    expect(evidence.error).toContain("status 401");
  });

  it("fails when endpoint returns HTTP 404 Not Found", async () => {
    customHandler = (_req, res) => {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Run not found" }));
    };

    const serverHandle = { baseUrl, adminApiKey };
    const evidence = await verifyExactRunHttpReadback(
      serverHandle,
      context as any,
      "non_existent_run",
      ["ad_001"]
    );

    expect(evidence.status).toBe("FAILED");
    expect(evidence.httpStatus).toBe(404);
  });

  it("fails when HTTP response is missing an expected ad ID", async () => {
    customHandler = (_req, res) => {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          success: true,
          runId,
          data: [{ id: "ad_001" }], // Missing ad_002
          pagination: { page: 1, total: 1, totalPages: 1 },
        })
      );
    };

    const serverHandle = { baseUrl, adminApiKey };
    const evidence = await verifyExactRunHttpReadback(
      serverHandle,
      context as any,
      runId,
      ["ad_001", "ad_002"]
    );

    expect(evidence.status).toBe("FAILED");
    expect(evidence.missingIds).toContain("ad_002");
    expect(evidence.error).toContain("HTTP ID mismatch");
  });

  it("fails when HTTP response returns an unexpected extraneous ad ID", async () => {
    customHandler = (_req, res) => {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          success: true,
          runId,
          data: [{ id: "ad_001" }, { id: "ad_unrelated_foreign" }],
          pagination: { page: 1, total: 2, totalPages: 1 },
        })
      );
    };

    const serverHandle = { baseUrl, adminApiKey };
    const evidence = await verifyExactRunHttpReadback(
      serverHandle,
      context as any,
      runId,
      ["ad_001"]
    );

    expect(evidence.status).toBe("FAILED");
    expect(evidence.unexpectedIds).toContain("ad_unrelated_foreign");
  });

  it("detects and rejects duplicate ad IDs across pagination", async () => {
    customHandler = (req, res) => {
      const url = new URL(req.url!, baseUrl);
      const page = parseInt(url.searchParams.get("page") || "1", 10);

      res.writeHead(200, { "Content-Type": "application/json" });
      if (page === 1) {
        res.end(
          JSON.stringify({
            success: true,
            runId,
            data: [{ id: "ad_001" }],
            pagination: { page: 1, total: 2, totalPages: 2 },
          })
        );
      } else {
        // Page 2 accidentally duplicates ad_001
        res.end(
          JSON.stringify({
            success: true,
            runId,
            data: [{ id: "ad_001" }],
            pagination: { page: 2, total: 2, totalPages: 2 },
          })
        );
      }
    };

    const serverHandle = { baseUrl, adminApiKey };
    const evidence = await verifyExactRunHttpReadback(
      serverHandle,
      context as any,
      runId,
      ["ad_001"]
    );

    expect(evidence.status).toBe("FAILED");
    expect(evidence.duplicateIds).toContain("ad_001");
  });

  it("fails gracefully with network error when target server is unreachable", async () => {
    const closedServerHandle = { baseUrl: "http://127.0.0.1:59999", adminApiKey };
    const evidence = await verifyExactRunHttpReadback(
      closedServerHandle,
      context as any,
      runId,
      ["ad_001"]
    );

    expect(evidence.status).toBe("FAILED");
    expect(evidence.httpStatus).toBeNull();
    expect(evidence.error).toBeTruthy();
  });
});
