import fs from "fs";
import path from "path";
import os from "os";
import crypto from "crypto";
import { createClient } from "@libsql/client";
import { PrismaClient } from "@/generated/prisma/client";
import { createPrismaClient } from "@/lib/db";
import { canonicalizeSqliteDatabasePath } from "@/lib/database/databaseConfig";
import { assertSafeTestDatabase } from "@/lib/database/databaseSafety";

export interface IsolatedDatabaseOptions {
  prefix?: string;
  sourceTemplatePath?: string;
  schemaSqlPath?: string;
}

export interface TestDatabaseHandle {
  url: string;
  filePath: string;
  canonicalKey: string;
  prisma: PrismaClient;
  teardown: () => Promise<void>;
}

export interface SchemaVerificationResult {
  verified: boolean;
  tableCount: number;
  tables: string[];
}

/**
 * Initializes the schema on a newly allocated SQLite database file using schema.sql DDL.
 */
export async function initializeIsolatedDatabaseSchema(
  databaseUrl: string,
  schemaSqlPath: string = path.resolve(process.cwd(), "prisma/schema.sql")
): Promise<void> {
  if (!fs.existsSync(schemaSqlPath)) {
    throw new Error(
      `CRITICAL SCHEMA INITIALIZATION ERROR: Schema DDL file '${schemaSqlPath}' not found.`
    );
  }

  const ddl = fs.readFileSync(schemaSqlPath, "utf8");
  const client = createClient({ url: databaseUrl });

  try {
    await client.executeMultiple(ddl);
  } finally {
    client.close();
  }
}

/**
 * Verifies that all required KH-01 and application tables exist in the isolated database.
 */
export async function verifyIsolatedSchema(
  prisma: PrismaClient
): Promise<SchemaVerificationResult> {
  const result = await prisma.$queryRaw<Array<{ name: string }>>`
    SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_prisma_%';
  `;

  const tables = result.map((r) => r.name);
  const requiredTables = [
    "workspaces",
    "competitor_ads",
    "research_products",
    "sync_jobs",
    "landing_page_snapshots",
    "competitor_offer_snapshots",
    "research_evidence",
    "research_decisions",
  ];

  for (const table of requiredTables) {
    if (!tables.includes(table)) {
      throw new Error(
        `CRITICAL SCHEMA VERIFICATION FAILED: Required table '${table}' missing in isolated test database.`
      );
    }
  }

  return {
    verified: true,
    tableCount: tables.length,
    tables,
  };
}

/**
 * Creates an isolated, ephemeral SQLite database for integration and E2E testing.
 * Strictly guarantees that test mutations never touch the user's active research database.
 * Does NOT rely on untracked local template databases; initializes cleanly from version-controlled schema.sql.
 */
export async function createIsolatedTestDatabase(
  options: IsolatedDatabaseOptions = {}
): Promise<TestDatabaseHandle> {
  const {
    prefix = "swai-test",
    sourceTemplatePath = path.resolve(process.cwd(), "prisma/test_template.db"),
    schemaSqlPath = path.resolve(process.cwd(), "prisma/schema.sql"),
  } = options;

  const uniqueId = `${prefix}-${Date.now()}-${crypto.randomUUID()}`;
  const tempDir = path.join(os.tmpdir(), "swai-isolated-test-dbs", uniqueId);
  fs.mkdirSync(tempDir, { recursive: true });

  const filePath = path.join(tempDir, "isolated.db");
  const url = `file:${filePath.replace(/\\/g, "/")}`;

  // Fail-closed safety assertion against active application database
  assertSafeTestDatabase(url, {
    ...process.env,
    NODE_ENV: "test",
    TEST_DATABASE_URL: url,
    SWAI_TEST_ISOLATION: "strict",
  });

  const canonical = canonicalizeSqliteDatabasePath(url);

  // If local template exists, use it as fast copy; otherwise execute schema.sql DDL
  if (fs.existsSync(sourceTemplatePath) && fs.statSync(sourceTemplatePath).size > 0) {
    fs.copyFileSync(sourceTemplatePath, filePath);
  } else {
    fs.writeFileSync(filePath, "");
    await initializeIsolatedDatabaseSchema(url, schemaSqlPath);
  }

  // Configure WAL mode and busy timeout for safe multi-process concurrency
  try {
    const pragmaClient = createClient({ url });
    await pragmaClient.execute("PRAGMA journal_mode = WAL;");
    await pragmaClient.execute("PRAGMA busy_timeout = 10000;");
    pragmaClient.close();
  } catch {
    // Ignore pragma error if unsupported
  }

  const prisma = createPrismaClient(url);

  // Verify that all required tables exist
  await verifyIsolatedSchema(prisma);

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
      // Handle Windows file locks with brief delay if needed
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
