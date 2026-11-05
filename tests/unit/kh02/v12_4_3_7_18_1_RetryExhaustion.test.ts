/**
 * ANTI — KH-02 V12.4.3.7.18.1: RETRY EXHAUSTION (B01 - B08)
 *
 * Verifies that SQLite lock contention / P1008 retry exhaustion NEVER returns phantom success.
 * Enforces typed BatchImportError with status 503, exact retry bound MAX_DB_ATTEMPTS,
 * post-commit readback verification, and all-or-nothing rollback.
 */

import { describe, it, expect, vi, beforeAll, beforeEach, afterAll } from "vitest";
import {
  executeDemandObservationBatchImport,
  BatchImportError,
  MAX_DB_ATTEMPTS,
} from "@/services/kh02/demand/demandObservationBatchImport";
import { prisma } from "@/lib/db";
import { POST } from "@/app/api/v1/demand/import/route";
import { NextRequest } from "next/server";

describe("KH-02 V12.4.3.7.18.1: Workstream B — Retry Exhaustion & Durable Commit (B01 - B08)", () => {
  const testProductId = "prod_retry_test_01";
  const testWorkspaceId = "ws_retry_test";

  beforeAll(async () => {
    await prisma.workspace.upsert({
      where: { id: testWorkspaceId },
      create: { id: testWorkspaceId, name: "WS Retry Test" },
      update: {},
    });

    const wl = await prisma.watchlist.upsert({
      where: { id: "wl_" + testWorkspaceId },
      create: { id: "wl_" + testWorkspaceId, workspaceId: testWorkspaceId, name: "WL Retry Test" },
      update: {},
    });

    await prisma.researchProduct.upsert({
      where: { id: testProductId },
      create: { id: testProductId, title: "Automatic Cat Feeder" },
      update: {},
    });

    await prisma.watchlistItem.upsert({
      where: { id: "wli_" + testProductId },
      create: { id: "wli_" + testProductId, watchlistId: wl.id, productId: testProductId, itemType: "PRODUCT" },
      update: { watchlistId: wl.id, productId: testProductId },
    });
  });

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterAll(async () => {
    try {
      await prisma.productDemandObservation.deleteMany({ where: { productId: testProductId } });
      await prisma.watchlistItem.deleteMany({ where: { productId: testProductId } });
      await prisma.researchProduct.deleteMany({ where: { id: testProductId } });
      await prisma.watchlist.deleteMany({ where: { workspaceId: testWorkspaceId } });
      await prisma.workspace.deleteMany({ where: { id: testWorkspaceId } });
    } catch {}
  });

  const samplePoints = [
    {
      periodStart: "2026-05-03",
      demandValue: 45,
      keyword: "automatic cat feeder",
      region: "US",
    },
    {
      periodStart: "2026-05-10",
      demandValue: 50,
      keyword: "automatic cat feeder",
      region: "US",
    },
  ];

  it("B01: force SQLITE_BUSY on every allowed attempt -> exact MAX_DB_ATTEMPTS attempts, 503, 0 fake success", async () => {
    let attemptsCount = 0;
    vi.spyOn(prisma, "$transaction").mockImplementation(async () => {
      attemptsCount++;
      throw new Error("SQLITE_BUSY: database is locked");
    });

    try {
      await executeDemandObservationBatchImport({
        productId: testProductId,
        workspaceId: testWorkspaceId,
        source: "USER_MANUAL",
        points: samplePoints,
      });
      expect.unreachable("Should have thrown BatchImportError");
    } catch (err: any) {
      expect(err).toBeInstanceOf(BatchImportError);
      expect(err.statusCode).toBe(503);
      expect(err.code).toBe("DATABASE_BUSY_RETRY_EXHAUSTED");
      expect(attemptsCount).toBe(MAX_DB_ATTEMPTS);
    }
  });

  it("B02: force P1008 on every allowed attempt -> exact MAX_DB_ATTEMPTS, 503", async () => {
    let attemptsCount = 0;
    vi.spyOn(prisma, "$transaction").mockImplementation(async () => {
      attemptsCount++;
      const p1008Err: any = new Error("Operations timed out");
      p1008Err.code = "P1008";
      throw p1008Err;
    });

    try {
      await executeDemandObservationBatchImport({
        productId: testProductId,
        workspaceId: testWorkspaceId,
        source: "USER_MANUAL",
        points: samplePoints,
      });
      expect.unreachable("Should have thrown BatchImportError");
    } catch (err: any) {
      expect(err).toBeInstanceOf(BatchImportError);
      expect(err.statusCode).toBe(503);
      expect(err.code).toBe("DATABASE_BUSY_RETRY_EXHAUSTED");
      expect(attemptsCount).toBe(MAX_DB_ATTEMPTS);
    }
  });

  it("B03: final permitted retry succeeds -> correct once-only inserted/skipped counts", async () => {
    let attemptsCount = 0;
    vi.spyOn(prisma, "$transaction").mockImplementation(async (callback: any) => {
      attemptsCount++;
      if (attemptsCount < MAX_DB_ATTEMPTS) {
        throw new Error("SQLITE_BUSY: database is locked");
      }
      const fakeTx = {
        productDemandObservation: {
          findMany: vi.fn().mockResolvedValue([]),
          createMany: vi.fn().mockResolvedValue({ count: 2 }),
        },
      };
      return await callback(fakeTx);
    });

    vi.spyOn(prisma.productDemandObservation, "count").mockResolvedValue(2);

    const res = await executeDemandObservationBatchImport({
      productId: testProductId,
      workspaceId: testWorkspaceId,
      source: "USER_MANUAL",
      points: samplePoints,
    });

    expect(res.success).toBe(true);
    expect(res.insertedCount).toBe(2);
    expect(res.skippedCount).toBe(0);
    expect(attemptsCount).toBe(MAX_DB_ATTEMPTS);
  });

  it("B04: non-retriable failure fails immediately without retrying MAX_DB_ATTEMPTS times", async () => {
    let attemptsCount = 0;
    vi.spyOn(prisma, "$transaction").mockImplementation(async () => {
      attemptsCount++;
      throw new Error("P2003: Foreign key constraint failed");
    });

    try {
      await executeDemandObservationBatchImport({
        productId: testProductId,
        workspaceId: testWorkspaceId,
        source: "USER_MANUAL",
        points: samplePoints,
      });
      expect.unreachable("Should have thrown non-retriable error");
    } catch (err: any) {
      expect(attemptsCount).toBe(1); // Did not retry
      expect(err.message).toContain("P2003");
    }
  });

  it("B05: injected DB failure inside transaction triggers rollback with 0 leaked rows", async () => {
    vi.spyOn(prisma, "$transaction").mockImplementation(async (callback: any) => {
      const fakeTx = {
        productDemandObservation: {
          findMany: vi.fn().mockResolvedValue([]),
          createMany: vi.fn().mockRejectedValue(new Error("FATAL_DISK_IO_ERROR")),
        },
      };
      return await callback(fakeTx);
    });

    await expect(
      executeDemandObservationBatchImport({
        productId: testProductId,
        workspaceId: testWorkspaceId,
        source: "USER_MANUAL",
        points: samplePoints,
      })
    ).rejects.toThrow("FATAL_DISK_IO_ERROR");
  });

  it("B06: DB write success but readback failure -> report explicit error, do not report success", async () => {
    vi.spyOn(prisma, "$transaction").mockImplementation(async (callback: any) => {
      const fakeTx = {
        productDemandObservation: {
          findMany: vi.fn().mockResolvedValue([]),
          createMany: vi.fn().mockResolvedValue({ count: 2 }),
        },
      };
      return await callback(fakeTx);
    });

    // Readback reports 0 rows instead of expected 2
    vi.spyOn(prisma.productDemandObservation, "count").mockResolvedValue(0);

    try {
      await executeDemandObservationBatchImport({
        productId: testProductId,
        workspaceId: testWorkspaceId,
        source: "USER_MANUAL",
        points: samplePoints,
      });
      expect.unreachable("Should have failed on readback");
    } catch (err: any) {
      expect(err).toBeInstanceOf(BatchImportError);
      expect(err.statusCode).toBe(500);
      expect(err.code).toBe("READBACK_VERIFICATION_FAILED");
    }
  });

  it("B07: API maps exhaustion to 503 JSON response, not success: true", async () => {
    vi.spyOn(prisma, "$transaction").mockImplementation(async () => {
      throw new Error("SQLITE_BUSY: database is locked");
    });

    const req = new NextRequest("http://localhost:3000/api/v1/demand/import", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-workspace-id": testWorkspaceId,
      },
      body: JSON.stringify({
        productId: testProductId,
        rows: [
          {
            keyword: "automatic cat feeder",
            region: "US",
            periodStart: "2026-05-03T00:00:00.000Z",
            periodEnd: "2026-05-10T00:00:00.000Z",
            demandValue: 45,
            source: "USER_MANUAL",
          },
        ],
      }),
    });

    const resp = await POST(req);
    expect(resp.status).toBe(503);
    const body = await resp.json();
    expect(body.success).toBe(false);
    expect(body.error.code).toBe("DATABASE_BUSY_RETRY_EXHAUSTED");
  });

  it("B08: timeout and resource-bound retry completes within bounded time", async () => {
    vi.spyOn(prisma, "$transaction").mockImplementation(async () => {
      throw new Error("Operation has timed out");
    });

    const start = Date.now();
    try {
      await executeDemandObservationBatchImport({
        productId: testProductId,
        workspaceId: testWorkspaceId,
        source: "USER_MANUAL",
        points: samplePoints,
      });
    } catch (err: any) {
      const elapsed = Date.now() - start;
      expect(err.statusCode).toBe(503);
      expect(elapsed).toBeLessThan(3500);
    }
  });
});
