import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "fs";
import path from "path";
import {
  verifyActiveDatabaseMarkerAbsent,
  evaluateDatabaseIsolationVerdict,
} from "../../scripts/kh01/runFullAcceptance";

describe("KH-01 Active Database Protection (FINAL-08-05)", () => {
  const scratchDir = path.resolve(process.cwd(), "artifacts/.scratch-test-db-protection");
  const testActiveDbPath = path.join(scratchDir, "mock-active.db");

  beforeAll(() => {
    if (!fs.existsSync(scratchDir)) {
      fs.mkdirSync(scratchDir, { recursive: true });
    }
  });

  afterAll(() => {
    try {
      if (fs.existsSync(scratchDir)) {
        fs.rmSync(scratchDir, { recursive: true, force: true });
      }
    } catch {}
  });

  it("returns NOT_VERIFIED when active database file does not exist on disk", async () => {
    const nonexistentPath = path.join(scratchDir, "nonexistent-active.db");
    const result = await verifyActiveDatabaseMarkerAbsent(
      `file:${nonexistentPath}`,
      "marker_xyz"
    );

    expect(result.status).toBe("NOT_VERIFIED");
    expect(result.queryExecuted).toBe(false);
    expect(result.markerFound).toBeNull();
    expect(result.errorCode).toBe("ACTIVE_DB_FILE_ABSENT");
  });

  it("returns PASSED when query executes successfully and marker is absent", async () => {
    const { createClient } = await import("@libsql/client");
    const client = createClient({ url: `file:${testActiveDbPath}` });
    await client.execute(`
      CREATE TABLE IF NOT EXISTS workspaces (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL
      )
    `);
    await client.execute({
      sql: "INSERT OR REPLACE INTO workspaces (id, name) VALUES (?, ?)",
      args: ["other_workspace", "Production Workspace"],
    });
    client.close();

    const result = await verifyActiveDatabaseMarkerAbsent(
      `file:${testActiveDbPath}`,
      "target_marker_absent"
    );

    expect(result.status).toBe("PASSED");
    expect(result.queryExecuted).toBe(true);
    expect(result.markerFound).toBe(false);
    expect(result.activeDatabaseProtected).toBe(true);
  });

  it("returns FAILED when marker is detected inside active database", async () => {
    const { createClient } = await import("@libsql/client");
    const client = createClient({ url: `file:${testActiveDbPath}` });
    await client.execute({
      sql: "INSERT OR REPLACE INTO workspaces (id, name) VALUES (?, ?)",
      args: ["leaked_marker_123", "Leaked Probe Marker"],
    });
    client.close();

    const result = await verifyActiveDatabaseMarkerAbsent(
      `file:${testActiveDbPath}`,
      "leaked_marker_123"
    );

    expect(result.status).toBe("FAILED");
    expect(result.queryExecuted).toBe(true);
    expect(result.markerFound).toBe(true);
    expect(result.activeDatabaseProtected).toBe(false);
    expect(result.error).toContain("was detected in active database");
  });

  it("returns NOT_VERIFIED fail-closed when table does not exist in active database", async () => {
    const emptyDbPath = path.join(scratchDir, "empty-active.db");
    const { createClient } = await import("@libsql/client");
    const client = createClient({ url: `file:${emptyDbPath}` });
    await client.execute("CREATE TABLE dummy (col TEXT)");
    client.close();

    const result = await verifyActiveDatabaseMarkerAbsent(
      `file:${emptyDbPath}`,
      "any_marker"
    );

    expect(result.status).toBe("NOT_VERIFIED");
    expect(result.queryExecuted).toBe(false);
    expect(result.markerFound).toBeNull();
    expect(result.errorCode).toBe("ACTIVE_DB_QUERY_FAILED");
  });

  describe("evaluateDatabaseIsolationVerdict (V1159-02)", () => {
    it("returns eligibleForAcceptance false when activeDatabaseStatus is NOT_VERIFIED", () => {
      const verdict = evaluateDatabaseIsolationVerdict({
        canonicalPathsDifferent: true,
        prismaConnectionVerified: true,
        markerWriteVerified: true,
        markerReadVerified: true,
        activeDatabaseStatus: "NOT_VERIFIED",
        activeDatabaseProtected: null,
        errors: [],
      });

      expect(verdict.status).toBe("NOT_VERIFIED");
      expect(verdict.eligibleForAcceptance).toBe(false);
      expect(verdict.reasons.length).toBeGreaterThan(0);
    });

    it("returns eligibleForAcceptance false when activeDatabaseStatus is FAILED", () => {
      const verdict = evaluateDatabaseIsolationVerdict({
        canonicalPathsDifferent: true,
        prismaConnectionVerified: true,
        markerWriteVerified: true,
        markerReadVerified: true,
        activeDatabaseStatus: "FAILED",
        activeDatabaseProtected: false,
        errors: [],
      });

      expect(verdict.status).toBe("FAILED");
      expect(verdict.eligibleForAcceptance).toBe(false);
    });

    it("returns eligibleForAcceptance false when canonical paths are identical", () => {
      const verdict = evaluateDatabaseIsolationVerdict({
        canonicalPathsDifferent: false,
        prismaConnectionVerified: true,
        markerWriteVerified: true,
        markerReadVerified: true,
        activeDatabaseStatus: "PASSED",
        activeDatabaseProtected: true,
        errors: [],
      });

      expect(verdict.status).toBe("FAILED");
      expect(verdict.eligibleForAcceptance).toBe(false);
    });

    it("returns eligibleForAcceptance true when isolated and active database protection are PASSED with 0 errors", () => {
      const verdict = evaluateDatabaseIsolationVerdict({
        canonicalPathsDifferent: true,
        prismaConnectionVerified: true,
        markerWriteVerified: true,
        markerReadVerified: true,
        activeDatabaseStatus: "PASSED",
        activeDatabaseProtected: true,
        errors: [],
      });

      expect(verdict.status).toBe("PASSED");
      expect(verdict.eligibleForAcceptance).toBe(true);
      expect(verdict.reasons).toEqual([]);
    });
  });
});
