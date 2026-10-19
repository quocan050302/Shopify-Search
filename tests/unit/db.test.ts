import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma } from "@/lib/db";

describe("Database Client Connectivity", () => {
  it("should initialize prisma client and query data sources", async () => {
    expect(prisma).toBeDefined();
    // Test count or findMany
    const count = await prisma.dataSource.count();
    expect(typeof count).toBe("number");
  });
});
