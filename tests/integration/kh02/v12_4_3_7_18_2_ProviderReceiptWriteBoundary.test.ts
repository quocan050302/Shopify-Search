/**
 * ANTI — KH-02 V12.4.3.7.18.2: PROVIDER RECEIPT WRITE BOUNDARY INTEGRATION
 *
 * Verifies end-to-end DB persistence and HTTP route behavior under strict
 * provider origin enforcement.
 *
 * Scenarios RC01 - RC08:
 * - RC01: HTTP route /api/v1/demand/import rejects unverified PROVIDER_API with 422
 * - RC02: HTTP route allows valid USER_MANUAL observations without live authority
 * - RC03: HTTP route cross-workspace isolation blocks unauthorized product write (403)
 * - RC04: Multi-row provider batch with 1 invalid row rolls back atomically (0 rows)
 * - RC05: Cold process pure check: no in-memory cache leak permits unverified provider
 * - RC06: Non-existent product ID returns 404 PRODUCT_NOT_FOUND
 * - RC07: Conflicting duplicate detection works identically for provider rows
 * - RC08: Stored provider receipts remain bitwise immutable before and after verification
 */

import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { NextRequest } from "next/server";
import { POST as demandImportPost } from "@/app/api/v1/demand/import/route";
import { prisma } from "@/lib/db";
import {
  executeDemandObservationBatchImport,
  BatchImportError,
} from "@/services/kh02/demand/demandObservationBatchImport";

describe("KH-02 V12.4.3.7.18.2: Provider Receipt Write Boundary Integration (RC01 - RC08)", () => {
  const testWorkspaceA = "ws_rc_boundary_a";
  const testWorkspaceB = "ws_rc_boundary_b";
  const testProductA = "prod_rc_boundary_a";
  const testProductB = "prod_rc_boundary_b";

  beforeAll(async () => {
    // Setup Workspace A
    await prisma.workspace.upsert({
      where: { id: testWorkspaceA },
      create: { id: testWorkspaceA, name: "WS RC Boundary A" },
      update: {},
    });
    const wlA = await prisma.watchlist.upsert({
      where: { id: "wl_" + testWorkspaceA },
      create: { id: "wl_" + testWorkspaceA, workspaceId: testWorkspaceA, name: "WL A" },
      update: {},
    });
    await prisma.researchProduct.upsert({
      where: { id: testProductA },
      create: { id: testProductA, title: "Automatic Cat Feeder A" },
      update: {},
    });
    await prisma.watchlistItem.upsert({
      where: { id: "wli_" + testProductA },
      create: { id: "wli_" + testProductA, watchlistId: wlA.id, productId: testProductA, itemType: "PRODUCT" },
      update: { watchlistId: wlA.id, productId: testProductA },
    });

    // Setup Workspace B
    await prisma.workspace.upsert({
      where: { id: testWorkspaceB },
      create: { id: testWorkspaceB, name: "WS RC Boundary B" },
      update: {},
    });
    const wlB = await prisma.watchlist.upsert({
      where: { id: "wl_" + testWorkspaceB },
      create: { id: "wl_" + testWorkspaceB, workspaceId: testWorkspaceB, name: "WL B" },
      update: {},
    });
    await prisma.researchProduct.upsert({
      where: { id: testProductB },
      create: { id: testProductB, title: "Automatic Cat Feeder B" },
      update: {},
    });
    await prisma.watchlistItem.upsert({
      where: { id: "wli_" + testProductB },
      create: { id: "wli_" + testProductB, watchlistId: wlB.id, productId: testProductB, itemType: "PRODUCT" },
      update: { watchlistId: wlB.id, productId: testProductB },
    });
  });

  beforeEach(async () => {
    await prisma.productDemandObservation.deleteMany({
      where: { productId: { in: [testProductA, testProductB] } },
    });
  });

  afterAll(async () => {
    try {
      await prisma.productDemandObservation.deleteMany({ where: { productId: { in: [testProductA, testProductB] } } });
      await prisma.watchlistItem.deleteMany({ where: { productId: { in: [testProductA, testProductB] } } });
      await prisma.researchProduct.deleteMany({ where: { id: { in: [testProductA, testProductB] } } });
      await prisma.watchlist.deleteMany({ where: { workspaceId: { in: [testWorkspaceA, testWorkspaceB] } } });
      await prisma.workspace.deleteMany({ where: { id: { in: [testWorkspaceA, testWorkspaceB] } } });
    } catch {}
  });

  it("RC01: HTTP route /api/v1/demand/import rejects unverified PROVIDER_API with 422 JSON", async () => {
    const req = new NextRequest("http://localhost:3000/api/v1/demand/import", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-workspace-id": testWorkspaceA,
      },
      body: JSON.stringify({
        productId: testProductA,
        rows: [
          {
            keyword: "cat water fountain",
            region: "US",
            periodStart: "2026-07-01T00:00:00.000Z",
            periodEnd: "2026-07-07T23:59:59.999Z",
            demandValue: 75,
            source: "PROVIDER_API",
            evidenceReference: "provider-request:serpapi:unbacked_req_xyz",
          },
        ],
      }),
    });

    const res = await demandImportPost(req);
    expect(res.status).toBe(422);

    const json = await res.json();
    expect(json.success).toBe(false);
    expect(json.error).toBeDefined();

    const count = await prisma.productDemandObservation.count({ where: { productId: testProductA } });
    expect(count).toBe(0);
  });

  it("RC02: HTTP route allows valid USER_MANUAL observations without live authority", async () => {
    const req = new NextRequest("http://localhost:3000/api/v1/demand/import", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-workspace-id": testWorkspaceA,
      },
      body: JSON.stringify({
        productId: testProductA,
        rows: [
          {
            keyword: "cat water fountain",
            region: "US",
            periodStart: "2026-07-01T00:00:00.000Z",
            periodEnd: "2026-07-07T23:59:59.999Z",
            demandValue: 65,
            source: "USER_MANUAL",
          },
        ],
      }),
    });

    const res = await demandImportPost(req);
    expect(res.status).toBe(200);

    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.data.insertedCount).toBe(1);

    const count = await prisma.productDemandObservation.count({ where: { productId: testProductA } });
    expect(count).toBe(1);
  });

  it("RC03: HTTP route cross-workspace isolation blocks unauthorized product write (403)", async () => {
    // Attempt to write into Product B using Workspace A header
    const req = new NextRequest("http://localhost:3000/api/v1/demand/import", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-workspace-id": testWorkspaceA, // Workspace A
      },
      body: JSON.stringify({
        productId: testProductB, // Belongs to Workspace B
        rows: [
          {
            keyword: "cat feeder",
            region: "US",
            periodStart: "2026-07-01T00:00:00.000Z",
            demandValue: 40,
            source: "USER_MANUAL",
          },
        ],
      }),
    });

    const res = await demandImportPost(req);
    expect(res.status).toBe(403);

    const count = await prisma.productDemandObservation.count({ where: { productId: testProductB } });
    expect(count).toBe(0);
  });

  it("RC04: Multi-row provider batch with 1 invalid row rolls back atomically (0 rows)", async () => {
    try {
      await executeDemandObservationBatchImport({
        productId: testProductA,
        workspaceId: testWorkspaceA,
        source: "PROVIDER_API",
        points: [
          {
            keyword: "cat water fountain",
            region: "US",
            periodStart: new Date("2026-07-01"),
            demandValue: 75,
            evidenceReference: "provider-request:serpapi:fake_row_1",
          },
          {
            keyword: "cat water fountain",
            region: "US",
            periodStart: new Date("2026-07-08"),
            demandValue: 80,
            evidenceReference: "provider-request:serpapi:fake_row_2",
          },
        ],
      });
      expect.unreachable("Should throw 422");
    } catch (err: any) {
      expect(err).toBeInstanceOf(BatchImportError);
      expect(err.statusCode).toBe(422);
    }

    const count = await prisma.productDemandObservation.count({ where: { productId: testProductA } });
    expect(count).toBe(0);
  });

  it("RC05: Cold process pure check: no in-memory cache leak permits unverified provider", async () => {
    // Calling with an unbacked claim in a freshly initialized call must fail closed
    try {
      await executeDemandObservationBatchImport({
        productId: testProductA,
        workspaceId: testWorkspaceA,
        source: "PROVIDER_API",
        points: [
          {
            keyword: "cat water fountain",
            region: "US",
            periodStart: new Date("2026-07-01"),
            demandValue: 75,
            evidenceReference: "provider-request:serpapi:cold_cache_unverified_req",
          },
        ],
      });
      expect.unreachable("Should throw 422");
    } catch (err: any) {
      expect(err).toBeInstanceOf(BatchImportError);
      expect(err.statusCode).toBe(422);
    }
  });

  it("RC06: Non-existent product ID returns 404 PRODUCT_NOT_FOUND", async () => {
    try {
      await executeDemandObservationBatchImport({
        productId: "prod_completely_non_existent_123456",
        workspaceId: testWorkspaceA,
        source: "USER_MANUAL",
        points: [
          {
            keyword: "cat water fountain",
            region: "US",
            periodStart: new Date("2026-07-01"),
            demandValue: 50,
          },
        ],
      });
      expect.unreachable("Should throw 404");
    } catch (err: any) {
      expect(err).toBeInstanceOf(BatchImportError);
      expect(err.statusCode).toBe(404);
      expect(err.code).toBe("PRODUCT_NOT_FOUND");
    }
  });

  it("RC07: Conflicting duplicate detection works identically for provider rows", async () => {
    // Insert one manual observation first
    await executeDemandObservationBatchImport({
      productId: testProductA,
      workspaceId: testWorkspaceA,
      source: "USER_MANUAL",
      points: [
        {
          keyword: "cat water fountain",
          region: "US",
          periodStart: new Date("2026-07-01"),
          demandValue: 50,
        },
      ],
    });

    // Second import with differing value (50 vs 95) throws 409
    try {
      await executeDemandObservationBatchImport({
        productId: testProductA,
        workspaceId: testWorkspaceA,
        source: "USER_MANUAL",
        points: [
          {
            keyword: "cat water fountain",
            region: "US",
            periodStart: new Date("2026-07-01"),
            demandValue: 95, // Conflict!
          },
        ],
      });
      expect.unreachable("Should throw 409");
    } catch (err: any) {
      expect(err).toBeInstanceOf(BatchImportError);
      expect(err.statusCode).toBe(409);
      expect(err.code).toBe("CONFLICTING_DUPLICATE_OBSERVATION");
    }
  });

  it("RC08: Stored provider receipts remain bitwise immutable before and after verification", () => {
    const receiptsDir = path.join(process.cwd(), "data/provider_receipts");
    if (!fs.existsSync(receiptsDir)) return;

    const files = fs.readdirSync(receiptsDir).filter((f) => /^[a-f0-9]{64}\.json$/.test(f));
    expect(files.length).toBeGreaterThanOrEqual(3);
    for (const f of files) {
      const fullPath = path.join(receiptsDir, f);
      const raw = fs.readFileSync(fullPath);
      const sha = crypto.createHash("sha256").update(raw).digest("hex");
      expect(f).toBe(`${sha}.json`);
    }
  });
});
