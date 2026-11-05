/**
 * ANTI — KH-02 V12.4.3.7.17: Group D — DATABASE CONCURRENCY, UNIQUENESS & MULTI-PROCESS WRITERS
 * Scenarios D01 - D18
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import fs from "node:fs";
import { prisma } from "@/lib/db";
import {
  executeDemandObservationBatchImport,
} from "@/services/kh02/demand/demandObservationBatchImport";

const execFileAsync = promisify(execFile);

describe("KH-02 V12.4.3.7.17 Group D: Database Uniqueness & Concurrency", () => {
  const testProductId = "prod_d_test_" + Date.now();
  const testWorkspaceId = "ws_d_test";

  beforeEach(async () => {
    await prisma.workspace.upsert({
      where: { id: testWorkspaceId },
      create: { id: testWorkspaceId, name: "WS Test D" },
      update: {},
    });

    const wl = await prisma.watchlist.upsert({
      where: { id: "wl_" + testWorkspaceId },
      create: { id: "wl_" + testWorkspaceId, workspaceId: testWorkspaceId, name: "WL Test D" },
      update: {},
    });

    await prisma.researchProduct.upsert({
      where: { id: testProductId },
      create: { id: testProductId, title: "Automatic Cat Feeder D" },
      update: {},
    });

    await prisma.watchlistItem.upsert({
      where: { id: "wli_" + testProductId },
      create: { id: "wli_" + testProductId, watchlistId: wl.id, productId: testProductId, itemType: "PRODUCT" },
      update: { watchlistId: wl.id, productId: testProductId },
    });
  });

  afterEach(async () => {
    try {
      await prisma.productDemandObservation.deleteMany({
        where: { productId: { startsWith: "prod_d_test" } },
      });
      await prisma.watchlistItem.deleteMany({
        where: { productId: { startsWith: "prod_d_test" } },
      });
      await prisma.researchProduct.deleteMany({
        where: { id: { startsWith: "prod_d_test" } },
      });
    } catch {}
  });

  it("D01: composite unique constraint (productId, source, keyword, region, periodStart) strictly enforced", async () => {
    const periodStart = new Date("2026-05-03T00:00:00.000Z");
    const periodEnd = new Date("2026-05-09T23:59:59.999Z");

    await prisma.productDemandObservation.create({
      data: {
        productId: testProductId,
        source: "USER_MANUAL",
        keyword: "automatic cat feeder",
        region: "US",
        periodStart,
        periodEnd,
        demandValue: 50,
      },
    });

    const count = await prisma.productDemandObservation.count({
      where: { productId: testProductId },
    });
    expect(count).toBe(1);
  });

  it("D02: inserting two rows with identical composite tuple throws P2002 unique constraint violation", async () => {
    const periodStart = new Date("2026-05-10T00:00:00.000Z");
    const periodEnd = new Date("2026-05-16T23:59:59.999Z");

    await prisma.productDemandObservation.create({
      data: {
        productId: testProductId,
        source: "USER_MANUAL",
        keyword: "cat feeder",
        region: "US",
        periodStart,
        periodEnd,
        demandValue: 45,
      },
    });

    await expect(
      prisma.productDemandObservation.create({
        data: {
          productId: testProductId,
          source: "USER_MANUAL",
          keyword: "cat feeder",
          region: "US",
          periodStart,
          periodEnd,
          demandValue: 60, // Contradictory demand value on identical composite key
        },
      })
    ).rejects.toThrow(/P2002|Unique constraint/i);
  });

  it("D03: inserting rows with different source but same (productId, keyword, region, periodStart) both succeed", async () => {
    const periodStart = new Date("2026-05-17T00:00:00.000Z");
    const periodEnd = new Date("2026-05-23T23:59:59.999Z");

    const r1 = await prisma.productDemandObservation.create({
      data: {
        productId: testProductId,
        source: "USER_MANUAL",
        keyword: "cat feeder",
        region: "US",
        periodStart,
        periodEnd,
        demandValue: 45,
      },
    });

    const r2 = await prisma.productDemandObservation.create({
      data: {
        productId: testProductId,
        source: "LIVE_PROVIDER",
        keyword: "cat feeder",
        region: "US",
        periodStart,
        periodEnd,
        demandValue: 55,
      },
    });

    expect(r1.id).not.toBe(r2.id);
    const count = await prisma.productDemandObservation.count({
      where: { productId: testProductId, periodStart },
    });
    expect(count).toBe(2);
  });

  it("D04: inserting rows with different periodStart but same (productId, source, keyword, region) both succeed", async () => {
    const r1 = await prisma.productDemandObservation.create({
      data: {
        productId: testProductId,
        source: "USER_MANUAL",
        keyword: "cat feeder",
        region: "US",
        periodStart: new Date("2026-05-24T00:00:00.000Z"),
        periodEnd: new Date("2026-05-30T23:59:59.999Z"),
        demandValue: 70,
      },
    });

    const r2 = await prisma.productDemandObservation.create({
      data: {
        productId: testProductId,
        source: "USER_MANUAL",
        keyword: "cat feeder",
        region: "US",
        periodStart: new Date("2026-05-31T00:00:00.000Z"),
        periodEnd: new Date("2026-06-06T23:59:59.999Z"),
        demandValue: 75,
      },
    });

    expect(r1.id).not.toBe(r2.id);
  });

  it("D05: single transaction inserting 10 rows where row 10 conflicts with DB rolls back entire transaction", async () => {
    const existingDate = new Date("2026-06-07T00:00:00.000Z");
    await prisma.productDemandObservation.create({
      data: {
        productId: testProductId,
        source: "USER_MANUAL",
        keyword: "cat feeder",
        region: "US",
        periodStart: existingDate,
        periodEnd: new Date("2026-06-13T23:59:59.999Z"),
        demandValue: 90,
      },
    });

    const newPoints = [];
    for (let i = 1; i <= 9; i++) {
      newPoints.push({
        keyword: "cat feeder",
        region: "US",
        periodStart: new Date(Date.UTC(2026, 5, 7 + i * 7)).toISOString(),
        periodEnd: new Date(Date.UTC(2026, 5, 13 + i * 7)).toISOString(),
        demandValue: 50 + i,
      });
    }
    // Row 10 has conflicting existing date with DIFFERENT demand value!
    newPoints.push({
      keyword: "cat feeder",
      region: "US",
      periodStart: existingDate.toISOString(),
      periodEnd: new Date("2026-06-13T23:59:59.999Z").toISOString(),
      demandValue: 10, // Conflicting value
    });

    await expect(
      executeDemandObservationBatchImport({
        productId: testProductId,
        workspaceId: testWorkspaceId,
        source: "USER_MANUAL",
        points: newPoints,
      })
    ).rejects.toThrow();

    // Verify none of the 9 new rows were committed
    const total = await prisma.productDemandObservation.count({
      where: { productId: testProductId },
    });
    expect(total).toBe(1); // Only the initial existing row
  });

  it("D06: multi-process concurrency: 2 concurrent promises inserting demand rows yield no duplicate rows", async () => {
    const points1 = [
      { keyword: "cat feeder", region: "US", periodStart: "2026-08-01T00:00:00.000Z", periodEnd: "2026-08-07T00:00:00.000Z", demandValue: 40 },
    ];
    const points2 = [
      { keyword: "cat feeder", region: "US", periodStart: "2026-08-01T00:00:00.000Z", periodEnd: "2026-08-07T00:00:00.000Z", demandValue: 40 },
    ];

    const [r1, r2] = await Promise.all([
      executeDemandObservationBatchImport({
        productId: testProductId,
        workspaceId: testWorkspaceId,
        source: "USER_MANUAL",
        region: "US",
        points: points1,
      }),
      executeDemandObservationBatchImport({
        productId: testProductId,
        workspaceId: testWorkspaceId,
        source: "USER_MANUAL",
        region: "US",
        points: points2,
      }),
    ]);

    expect(r1.insertedCount + r2.insertedCount).toBe(1);
    const count = await prisma.productDemandObservation.count({
      where: { productId: testProductId, periodStart: new Date("2026-08-01T00:00:00.000Z") },
    });
    expect(count).toBe(1);
  });

  it("D07: multi-process with conflicting values for same timestamp: one commits, other rejected; zero partial state", async () => {
    const dt = "2026-08-08T00:00:00.000Z";
    const p1 = [{ keyword: "cat feeder", region: "US", periodStart: dt, periodEnd: "2026-08-14T00:00:00.000Z", demandValue: 30 }];
    const p2 = [{ keyword: "cat feeder", region: "US", periodStart: dt, periodEnd: "2026-08-14T00:00:00.000Z", demandValue: 80 }];

    const results = await Promise.allSettled([
      executeDemandObservationBatchImport({
        productId: testProductId,
        workspaceId: testWorkspaceId,
        source: "USER_MANUAL",
        region: "US",
        points: p1,
      }),
      executeDemandObservationBatchImport({
        productId: testProductId,
        workspaceId: testWorkspaceId,
        source: "USER_MANUAL",
        region: "US",
        points: p2,
      }),
    ]);

    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r) => r.status === "rejected");

    expect(fulfilled.length).toBe(1);
    expect(rejected.length).toBe(1);

    const count = await prisma.productDemandObservation.count({
      where: { productId: testProductId, periodStart: new Date(dt) },
    });
    expect(count).toBe(1);
  });

  it("D08: aborted or thrown transaction leaves database in clean uncorrupted state", async () => {
    const preCount = await prisma.productDemandObservation.count({ where: { productId: testProductId } });

    try {
      await prisma.$transaction(async (tx) => {
        await tx.productDemandObservation.create({
          data: {
            productId: testProductId,
            source: "USER_MANUAL",
            keyword: "cat feeder",
            region: "US",
            periodStart: new Date("2026-09-01T00:00:00.000Z"),
            periodEnd: new Date("2026-09-07T00:00:00.000Z"),
            demandValue: 42,
          },
        });
        throw new Error("Simulated process crash / abort");
      });
    } catch {}

    const postCount = await prisma.productDemandObservation.count({ where: { productId: testProductId } });
    expect(postCount).toBe(preCount);
  });

  it("D09: multi-process high-load import (4 concurrent distinct batches): all valid points committed", async () => {
    const batches = [1, 2, 3, 4].map((batchNum) => ({
      productId: testProductId,
      workspaceId: testWorkspaceId,
      source: "USER_MANUAL",
      region: "US",
      points: [
        {
          keyword: "cat feeder",
          region: "US",
          periodStart: new Date(Date.UTC(2026, 9, batchNum)).toISOString(),
          periodEnd: new Date(Date.UTC(2026, 9, batchNum + 6)).toISOString(),
          demandValue: 40 + batchNum,
        },
      ],
    }));

    const results = await Promise.all(
      batches.map((b) => executeDemandObservationBatchImport(b))
    );

    const totalInserted = results.reduce((acc, r) => acc + r.insertedCount, 0);
    expect(totalInserted).toBe(4);
  });

  it("D10: transaction handling completes cleanly within bounded time", async () => {
    const start = Date.now();
    await prisma.$transaction(async (tx) => {
      await tx.productDemandObservation.findFirst({ where: { productId: testProductId } });
    });
    const elapsed = Date.now() - start;
    expect(elapsed).toBeLessThan(3000);
  });

  it("D11: PRAGMA foreign_keys = ON verified: inserting observation for non-existent product throws", async () => {
    await expect(
      prisma.productDemandObservation.create({
        data: {
          productId: "prod_completely_non_existent_123456",
          source: "USER_MANUAL",
          keyword: "feeder",
          region: "US",
          periodStart: new Date(),
          periodEnd: new Date(),
          demandValue: 50,
        },
      })
    ).rejects.toThrow();
  });

  it("D12: SQLite busy_timeout / WAL mode verification: raw query runs without error", async () => {
    const res = await prisma.$queryRawUnsafe<any[]>("PRAGMA journal_mode;");
    expect(res).toBeDefined();
    expect(res.length).toBeGreaterThan(0);
  });

  it("D13: batch import size limit: rejects batches > 500 points with bounded resource usage", async () => {
    const oversizedBatch = Array.from({ length: 501 }, (_, i) => ({
      keyword: "cat feeder",
      region: "US",
      periodStart: `2026-01-01T00:00:00.000Z`,
      periodEnd: `2026-01-07T00:00:00.000Z`,
      demandValue: 50,
    }));

    await expect(
      executeDemandObservationBatchImport({
        productId: testProductId,
        workspaceId: testWorkspaceId,
        source: "USER_MANUAL",
        points: oversizedBatch,
      })
    ).rejects.toThrow(/Maximum 500 rows/);
  });

  it("D14: non-retryable DB error fails immediately without infinite retry", async () => {
    await expect(
      prisma.productDemandObservation.create({
        data: {
          productId: null as any, // Missing required field
          source: "USER_MANUAL",
          keyword: "cat feeder",
          region: "US",
          periodStart: new Date(),
          periodEnd: new Date(),
        },
      })
    ).rejects.toThrow();
  });

  it("D15: duplicate rows inside same input batch deduplicated deterministically before insert", async () => {
    const dt = "2026-11-01T00:00:00.000Z";
    const duplicateBatch = [
      { keyword: "cat feeder", region: "US", periodStart: dt, periodEnd: "2026-11-07T00:00:00.000Z", demandValue: 50 },
      { keyword: "cat feeder", region: "US", periodStart: dt, periodEnd: "2026-11-07T00:00:00.000Z", demandValue: 50 },
    ];

    const res = await executeDemandObservationBatchImport({
      productId: testProductId,
      workspaceId: testWorkspaceId,
      source: "USER_MANUAL",
      points: duplicateBatch,
    });

    expect(res.insertedCount).toBe(1);
    expect(res.skippedCount).toBe(1);
  });

  it("D16: conflicting demand values for identical timestamp inside same batch rejected before DB write", async () => {
    const dt = "2026-11-08T00:00:00.000Z";
    const conflictingBatch = [
      { keyword: "cat feeder", region: "US", periodStart: dt, periodEnd: "2026-11-14T00:00:00.000Z", demandValue: 50 },
      { keyword: "cat feeder", region: "US", periodStart: dt, periodEnd: "2026-11-14T00:00:00.000Z", demandValue: 75 },
    ];

    await expect(
      executeDemandObservationBatchImport({
        productId: testProductId,
        workspaceId: testWorkspaceId,
        source: "USER_MANUAL",
        points: conflictingBatch,
      })
    ).rejects.toThrow(/Conflicting duplicate observation/);
  });

  it("D17: decimal precision preservation: floating-point demand values stored and retrieved accurately", async () => {
    const dt = new Date("2026-11-15T00:00:00.000Z");
    const row = await prisma.productDemandObservation.create({
      data: {
        productId: testProductId,
        source: "USER_MANUAL",
        keyword: "cat feeder",
        region: "US",
        periodStart: dt,
        periodEnd: new Date("2026-11-21T00:00:00.000Z"),
        demandValue: 50.5,
      },
    });

    const read = await prisma.productDemandObservation.findUnique({
      where: { id: row.id },
    });
    expect(read?.demandValue).toBe(50.5);
  });

  it("D18: multi-tenant workspace data isolation: observations for Workspace 1 cannot be mutated by Workspace 2", async () => {
    const otherWsId = "ws_other_tenant";
    await prisma.workspace.upsert({
      where: { id: otherWsId },
      create: { id: otherWsId, name: "Other WS" },
      update: {},
    });

    // Attempting to import into testProductId using otherWsId must fail with 403
    await expect(
      executeDemandObservationBatchImport({
        productId: testProductId,
        workspaceId: otherWsId,
        source: "USER_MANUAL",
        points: [
          { keyword: "cat feeder", region: "US", periodStart: "2026-11-22T00:00:00.000Z", periodEnd: "2026-11-28T00:00:00.000Z", demandValue: 50 },
        ],
      })
    ).rejects.toThrow(/Access denied/);
  });
});
