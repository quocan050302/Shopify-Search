import fs from "fs";
import path from "path";
import os from "os";
import crypto from "crypto";
import { PrismaClient } from "@/generated/prisma/client";
import { createPrismaClient, canonicalizeSqliteDatabasePath } from "@/lib/db";

export interface IsolatedDatabaseOptions {
  prefix?: string;
  sourceTemplatePath?: string;
}

export interface TestDatabaseHandle {
  url: string;
  filePath: string;
  canonicalKey: string;
  prisma: PrismaClient;
  teardown: () => Promise<void>;
}

/**
 * Creates an isolated, ephemeral SQLite database for integration and E2E testing.
 * Strictly guarantees that test mutations never touch the user's active research database.
 */
export async function createIsolatedTestDatabase(
  options: IsolatedDatabaseOptions = {}
): Promise<TestDatabaseHandle> {
  const {
    prefix = "swai-test",
    sourceTemplatePath = path.resolve(process.cwd(), "prisma/test_template.db"),
  } = options;

  const uniqueId = `${prefix}-${Date.now()}-${crypto.randomUUID()}`;
  const tempDir = path.join(os.tmpdir(), "swai-isolated-test-dbs", uniqueId);
  fs.mkdirSync(tempDir, { recursive: true });

  const filePath = path.join(tempDir, "isolated.db");

  // Copy empty schema-only template if available
  if (fs.existsSync(sourceTemplatePath)) {
    fs.copyFileSync(sourceTemplatePath, filePath);
  } else {
    // If template does not exist, create empty file
    fs.writeFileSync(filePath, "");
  }

  const url = `file:${filePath.replace(/\\/g, "/")}`;
  const canonical = canonicalizeSqliteDatabasePath(url);

  const prisma = createPrismaClient(url);

  const teardown = async () => {
    try {
      await prisma.$disconnect();
    } catch {
      // Ignore disconnect error during cleanup
    }

    try {
      if (fs.existsSync(tempDir)) {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    } catch {
      // Ignore file lock removal errors on Windows / busy temp
    }
  };

  return {
    url,
    filePath,
    canonicalKey: canonical.canonicalKey,
    prisma,
    teardown,
  };
}
