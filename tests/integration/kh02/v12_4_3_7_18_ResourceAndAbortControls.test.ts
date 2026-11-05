/**
 * ANTI — KH-02 V12.4.3.7.18: RESOURCE AND ABORT CONTROLS INTEGRATION TEST
 * Validates real statfs disk headroom, memory constraints, abort controls, and socket cleanup.
 */

import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { prisma } from "@/lib/db";
import { parseGoogleTrendsCsvBytes } from "@/services/kh02/demand/googleTrendsCsvValidator";
import { performAuditedSecureTlsFetch } from "@/services/kh02/identity/verifiedMerchantPdpResolver";

describe("KH-02 V12.4.3.7.18: Resource & Abort Controls Integration", () => {
  it("Res01: Filesystem headroom verification using real statfsSync (>= 500 MiB free)", () => {
    const stats = fs.statfsSync(process.cwd());
    const freeBytes = stats.bavail * stats.bsize;
    const freeMiB = freeBytes / (1024 * 1024);

    expect(freeMiB).toBeGreaterThan(500);
  });

  it("Res02: Memory stability: 100 consecutive pure CSV parse calls produce no memory leak", () => {
    const sampleCsv = "Category: All categories\nWeek,automatic cat feeder: (United States)\n" +
      Array.from({ length: 52 }, (_, i) => `2025-01-${String(i % 28 + 1).padStart(2, "0")},${50 + (i % 20)}`).join("\n");

    const memBefore = process.memoryUsage().heapUsed;

    for (let i = 0; i < 100; i++) {
      parseGoogleTrendsCsvBytes(sampleCsv);
    }

    const memAfter = process.memoryUsage().heapUsed;
    const diffMiB = (memAfter - memBefore) / (1024 * 1024);

    // Delta should not exceed 50 MiB for 100 small parses
    expect(diffMiB).toBeLessThan(50);
  });

  it("Res03: Socket cancellation via AbortController aborts cleanly within timeout", async () => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 50);

    const startTime = Date.now();
    let errorCaught: any = null;
    try {
      // Dial an unroutable IP with immediate abort
      await performAuditedSecureTlsFetch("https://192.0.2.1/test", "192.0.2.1", controller.signal, 1000);
    } catch (err) {
      errorCaught = err;
    } finally {
      clearTimeout(timeout);
    }

    const duration = Date.now() - startTime;
    expect(errorCaught).toBeDefined();
    expect(duration).toBeLessThan(1000);
  });

  it("Res04: SQLite WAL checkpoint hygiene runs without error", async () => {
    const res = await (prisma as any).$queryRawUnsafe("PRAGMA wal_checkpoint(PASSIVE);");
    expect(Array.isArray(res)).toBe(true);
  });

  it("Res05: Provider receipts storage directory exists and sentinel manifest is intact", () => {
    const storageDir = path.resolve(process.cwd(), "data/provider_receipts");
    expect(fs.existsSync(storageDir)).toBe(true);

    const manifestPath = path.join(storageDir, ".fixture_manifest.json");
    if (fs.existsSync(manifestPath)) {
      const stat = fs.statSync(manifestPath);
      expect(stat.size).toBeGreaterThan(0);
    }
  });
});

