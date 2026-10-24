import { describe, it, expect, afterAll } from "vitest";
import path from "path";
import fs from "fs";
import os from "os";
import {
  canonicalizeSqliteDatabasePath,
  assertSafeTestDatabase,
  resolveDatabaseConfiguration,
} from "@/lib/db";
import { createIsolatedTestDatabase } from "../helpers/createIsolatedTestDatabase";

describe("KH-01 — Checkpoint 1: Strict Database Isolation & Canonical Path Safety", () => {
  const cwd = process.cwd();

  describe("canonicalizeSqliteDatabasePath", () => {
    it("normalizes relative and file: paths to canonical POSIX paths", () => {
      const result1 = canonicalizeSqliteDatabasePath("file:./dev.db", cwd);
      const result2 = canonicalizeSqliteDatabasePath("file:dev.db", cwd);
      const result3 = canonicalizeSqliteDatabasePath("./dev.db", cwd);

      expect(result1.isRemote).toBe(false);
      expect(result1.canonicalKey).toBe(result2.canonicalKey);
      expect(result1.canonicalKey).toBe(result3.canonicalKey);
      expect(result1.canonicalPath).toBe(path.resolve(cwd, "dev.db").replace(/\\/g, "/"));
    });

    it("correctly identifies remote libSQL and HTTP URLs", () => {
      const remote = canonicalizeSqliteDatabasePath("libsql://my-cluster.turso.io/db");
      expect(remote.isRemote).toBe(true);
      expect(remote.canonicalPath).toBeNull();
      expect(remote.canonicalKey).toContain("remote:libsql://my-cluster.turso.io/db");
    });

    it("handles in-memory database designations", () => {
      const mem1 = canonicalizeSqliteDatabasePath(":memory:");
      const mem2 = canonicalizeSqliteDatabasePath("file::memory:");
      expect(mem1.canonicalKey).toBe("memory::memory:");
      expect(mem2.canonicalKey).toBe("memory::memory:");
    });

    it("handles URI-encoded file paths and strip query parameters", () => {
      const res = canonicalizeSqliteDatabasePath("file:./test%20dir/my%20db.sqlite?mode=ro", cwd);
      expect(res.canonicalPath).toContain("test dir/my db.sqlite");
      expect(res.canonicalPath).not.toContain("?mode=ro");
    });

    it("resolves symlinks to their true target canonical key", () => {
      const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "swai-symlink-test-"));
      const realFile = path.join(tempDir, "real.db");
      fs.writeFileSync(realFile, "data");
      const symlinkFile = path.join(tempDir, "link.db");

      try {
        fs.symlinkSync(realFile, symlinkFile);
        const canonReal = canonicalizeSqliteDatabasePath(`file:${realFile}`);
        const canonLink = canonicalizeSqliteDatabasePath(`file:${symlinkFile}`);
        expect(canonLink.canonicalKey).toBe(canonReal.canonicalKey);
      } catch (err: any) {
        // If symlink permission denied on non-elevated Windows, skip gracefully
        if (err.code !== "EPERM") throw err;
      } finally {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    });
  });

  describe("assertSafeTestDatabase", () => {
    it("blocks test execution when databaseUrl contains production.db", () => {
      expect(() => {
        assertSafeTestDatabase("file:/var/data/production.db", {
          NODE_ENV: "test",
          TEST_DATABASE_URL: "file:/var/data/production.db",
        });
      }).toThrow(/CRITICAL DATABASE SAFETY.*points to production database/);
    });

    it("fails closed in strict integration mode if TEST_DATABASE_URL is not set", () => {
      expect(() => {
        assertSafeTestDatabase("file:./dev.db", {
          NODE_ENV: "test",
          SWAI_TEST_ISOLATION: "strict",
        });
      }).toThrow(/requires an explicit isolated TEST_DATABASE_URL/);
    });

    it("blocks execution if TEST_DATABASE_URL resolves to the same file as active application DB", () => {
      const activeUrl = "file:./dev.db";
      const collidingUrl = `file:${path.resolve(cwd, "dev.db")}`;

      expect(() => {
        assertSafeTestDatabase(collidingUrl, {
          NODE_ENV: "test",
          DATABASE_URL: activeUrl,
          TEST_DATABASE_URL: collidingUrl,
        });
      }).toThrow(/resolves to the same file as the active application database/);
    });

    it("allows execution when TEST_DATABASE_URL points to a genuinely distinct SQLite path", () => {
      const distinctTestUrl = "file:/tmp/swai-test-isolated-12345/test.db";
      expect(() => {
        assertSafeTestDatabase(distinctTestUrl, {
          NODE_ENV: "test",
          DATABASE_URL: "file:./dev.db",
          TEST_DATABASE_URL: distinctTestUrl,
        });
      }).not.toThrow();
    });
  });

  describe("createIsolatedTestDatabase factory", () => {
    it("allocates a distinct isolated database file and safely performs schema queries", async () => {
      const dbHandle = await createIsolatedTestDatabase({ prefix: "unit-verify" });
      try {
        expect(dbHandle.url).toContain("isolated.db");
        expect(fs.existsSync(dbHandle.filePath)).toBe(true);

        // Verify it can execute queries independently
        const tableCount: any = await dbHandle.prisma.$queryRaw`SELECT count(*) as count FROM sqlite_master WHERE type='table'`;
        expect(Number(tableCount[0].count)).toBeGreaterThan(0);
      } finally {
        await dbHandle.teardown();
      }
      expect(fs.existsSync(dbHandle.filePath)).toBe(false);
    });
  });
});
