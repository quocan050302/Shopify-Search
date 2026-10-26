import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs";
import { createIsolatedTestDatabase, TestDatabaseHandle } from "../helpers/createIsolatedTestDatabase";
import { verifyAcceptanceDatabaseIdentity } from "../../scripts/kh01/runFullAcceptance";

describe("KH-01 Database Isolation & Safety (Part 06, Invariant 7)", () => {
  let testDb: TestDatabaseHandle;

  beforeEach(async () => {
    testDb = await createIsolatedTestDatabase({ prefix: "kh01-iso-test" });
  });

  afterEach(async () => {
    if (testDb) {
      await testDb.teardown();
    }
  });

  it("proves test database is strictly isolated from active application database", () => {
    const context = {
      databaseUrl: testDb.url,
      acceptanceRunId: "test_run",
      workspaceId: "test_ws",
      startedAt: new Date().toISOString(),
      liveDbHandle: testDb,
      cleanup: async () => {},
    };

    const identity = verifyAcceptanceDatabaseIdentity(context as any);
    expect(identity.verified).toBe(true);
    expect(identity.isIsolated).toBe(true);
    expect(identity.error).toBeUndefined();
    expect(identity.testDbUrl).not.toBe(identity.activeAppDb);
  });

  it("strictly rejects test context pointing to production database", () => {
    const context = {
      databaseUrl: "file:/var/data/production.db",
      acceptanceRunId: "test_run",
      workspaceId: "test_ws",
      startedAt: new Date().toISOString(),
      liveDbHandle: null,
      cleanup: async () => {},
    };

    const identity = verifyAcceptanceDatabaseIdentity(context as any);
    expect(identity.verified).toBe(false);
    expect(identity.isIsolated).toBe(false);
    expect(identity.error).toContain("points to production database");
  });

  it("strictly rejects test context pointing to development dev.db", () => {
    const context = {
      databaseUrl: "file:./dev.db",
      acceptanceRunId: "test_run",
      workspaceId: "test_ws",
      startedAt: new Date().toISOString(),
      liveDbHandle: null,
      cleanup: async () => {},
    };

    const identity = verifyAcceptanceDatabaseIdentity(context as any);
    expect(identity.verified).toBe(false);
    expect(identity.isIsolated).toBe(false);
    expect(identity.error).toMatch(/resolves to same file as active application database|conflicts with active application database/);
  });

  it("guarantees writes to isolated test database never touch dev.db", async () => {
    const devDbPath = "dev.db";
    let devDbMtimeBefore: number | null = null;
    if (fs.existsSync(devDbPath)) {
      devDbMtimeBefore = fs.statSync(devDbPath).mtimeMs;
    }

    // Write records to isolated DB
    await testDb.prisma.workspace.create({
      data: {
        id: "ws_isolation_check",
        name: "Isolation Check Workspace",
        operatingMode: "RESEARCH_ONLY",
        targetMarket: "US",
      },
    });

    const run = await testDb.prisma.discoveryRun.create({
      data: {
        workspaceId: "ws_isolation_check",
        providerId: "meta-ads-collector",
        status: "COMPLETED",
        queryConfigJson: "{}",
      },
    });

    expect(run.id).toBeTruthy();

    // Verify dev.db was not modified
    if (fs.existsSync(devDbPath) && devDbMtimeBefore !== null) {
      const devDbMtimeAfter = fs.statSync(devDbPath).mtimeMs;
      expect(devDbMtimeAfter).toBe(devDbMtimeBefore);
    }
  });

  it("removes isolated database artifacts cleanly upon teardown", async () => {
    const filePath = testDb.filePath;
    expect(fs.existsSync(filePath)).toBe(true);

    await testDb.teardown();
    expect(fs.existsSync(filePath)).toBe(false);
  });
});
