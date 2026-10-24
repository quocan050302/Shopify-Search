import path from "path";
import os from "os";
import fs from "fs";
import crypto from "crypto";
import { createClient } from "@libsql/client";
import { canonicalizeSqliteDatabasePath } from "@/lib/database/databaseConfig";
import { assertSafeTestDatabase } from "@/lib/database/databaseSafety";

// Ensure every Vitest worker runs against a completely isolated SQLite test database
if (!process.env.TEST_DATABASE_URL) {
  const uniqueId = `vitest-run-${Date.now()}-${crypto.randomUUID()}`;
  const tempDir = path.join(os.tmpdir(), "swai-vitest-isolated", uniqueId);
  fs.mkdirSync(tempDir, { recursive: true });
  const isolatedPath = path.join(tempDir, "isolated_test.db");
  const templatePath = path.resolve(process.cwd(), "prisma/test_template.db");
  const schemaSqlPath = path.resolve(process.cwd(), "prisma/schema.sql");

  const testUrl = `file:${isolatedPath.replace(/\\/g, "/")}`;

  if (fs.existsSync(templatePath) && fs.statSync(templatePath).size > 0) {
    fs.copyFileSync(templatePath, isolatedPath);
  } else if (fs.existsSync(schemaSqlPath)) {
    fs.writeFileSync(isolatedPath, "");
    const ddl = fs.readFileSync(schemaSqlPath, "utf8");
    const client = createClient({ url: testUrl });
    await client.executeMultiple(ddl);
    client.close();
  } else {
    fs.writeFileSync(isolatedPath, "");
  }

  process.env.TEST_DATABASE_URL = testUrl;
  process.env.SWAI_TEST_ISOLATION = "strict";

  assertSafeTestDatabase(testUrl, process.env);
}
