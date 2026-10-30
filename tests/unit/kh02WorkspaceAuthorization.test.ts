import { describe, it, expect } from "vitest";
import { prisma } from "@/lib/db";
import {
  createKH02ResearchRun,
  WorkspacePersistenceError,
} from "@/services/kh02/persistence/kh02PersistenceService";

describe("SWAI KH-02 — Workspace Authorization & Database Safety", () => {
  const validWorkspace = "test_auth_valid_ws";

  it("valid provisioned workspace succeeds in creating research run", async () => {
    await prisma.workspace.upsert({
      where: { id: validWorkspace },
      update: {},
      create: {
        id: validWorkspace,
        name: "Valid Test Workspace",
        targetMarket: "US",
      },
    });

    const runId = await createKH02ResearchRun({
      workspaceId: validWorkspace,
      topic: "Pet Gadgets",
      market: "US",
    });

    expect(runId).toBeDefined();
    expect(runId).toContain("kh02_run_");

    const job = await prisma.syncJob.findUnique({
      where: { id: runId },
    });
    expect(job).not.toBeNull();
    expect(job?.workspaceId).toBe(validWorkspace);
    expect(job?.status).toBe("PENDING");
  });

  it("missing or non-existent workspace throws WORKSPACE_NOT_FOUND (404)", async () => {
    const missingWs = "totally_nonexistent_workspace_12345";

    // Ensure it does not exist
    await prisma.workspace.deleteMany({
      where: { id: missingWs },
    });

    await expect(
      createKH02ResearchRun({
        workspaceId: missingWs,
        topic: "Pet Gadgets",
      })
    ).rejects.toThrowError(WorkspacePersistenceError);

    try {
      await createKH02ResearchRun({
        workspaceId: missingWs,
        topic: "Pet Gadgets",
      });
      expect.unreachable("Should have thrown WorkspacePersistenceError");
    } catch (err: unknown) {
      expect(err).toBeInstanceOf(WorkspacePersistenceError);
      const wsErr = err as WorkspacePersistenceError;
      expect(wsErr.code).toBe("WORKSPACE_NOT_FOUND");
      expect(wsErr.statusCode).toBe(404);
    }

    // Verify workspace was NOT auto-created in database
    const created = await prisma.workspace.findUnique({
      where: { id: missingWs },
    });
    expect(created).toBeNull();
  });

  it("empty workspace ID throws NO_WORKSPACE_CONFIGURED (400)", async () => {
    await expect(
      createKH02ResearchRun({
        workspaceId: "",
        topic: "Pet Gadgets",
      })
    ).rejects.toMatchObject({
      code: "NO_WORKSPACE_CONFIGURED",
      statusCode: 400,
    });
  });

  it("does not auto-create arbitrary workspaces into SQLite during persistence", async () => {
    const arbitraryWs = "arbitrary_attacker_injected_ws_" + Date.now();

    try {
      await createKH02ResearchRun({
        workspaceId: arbitraryWs,
        topic: "Pet Gadgets",
      });
    } catch {
      // Expected rejection
    }

    const check = await prisma.workspace.findUnique({
      where: { id: arbitraryWs },
    });
    expect(check).toBeNull();
  });
});
