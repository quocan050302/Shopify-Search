import path from "path";
import os from "os";
import fs from "fs";
import crypto from "crypto";
import { createClient } from "@libsql/client";
import { canonicalizeSqliteDatabasePath } from "@/lib/database/databaseConfig";
import { assertSafeTestDatabase } from "@/lib/database/databaseSafety";

// Ensure every Vitest worker runs against a completely isolated SQLite test database
if (!process.env.TEST_DATABASE_URL) {
  const baseIsolatedDir = path.join(os.tmpdir(), "swai-vitest-isolated");
  try {
    if (fs.existsSync(baseIsolatedDir)) {
      const now = Date.now();
      for (const entry of fs.readdirSync(baseIsolatedDir)) {
        if (entry === "cached_schema_template.db") continue;
        const entryPath = path.join(baseIsolatedDir, entry);
        try {
          const stat = fs.statSync(entryPath);
          if (now - stat.mtimeMs > 5 * 60 * 1000) {
            fs.rmSync(entryPath, { recursive: true, force: true });
          }
        } catch {}
      }
    }
  } catch {}
  const uniqueId = `vitest-run-${Date.now()}-${crypto.randomUUID()}`;
  const tempDir = path.join(os.tmpdir(), "swai-vitest-isolated", uniqueId);
  fs.mkdirSync(tempDir, { recursive: true });
  if (false) {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {}
  }
  const isolatedPath = path.join(tempDir, "isolated_test.db");
  const templatePath = fs.existsSync(path.resolve(process.cwd(), "prisma/test_template.db")) && fs.statSync(path.resolve(process.cwd(), "prisma/test_template.db")).size > 0
    ? path.resolve(process.cwd(), "prisma/test_template.db")
    : path.join(baseIsolatedDir, "cached_schema_template.db");
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
    try {
      if (!fs.existsSync(templatePath)) {
        fs.copyFileSync(isolatedPath, templatePath);
      }
    } catch {}
  } else {
    fs.writeFileSync(isolatedPath, "");
  }

  process.env.TEST_DATABASE_URL = testUrl;
  process.env.SWAI_TEST_ISOLATION = "strict";

  assertSafeTestDatabase(testUrl, process.env);
}

if (!process.env.HOST) {
  process.env.HOST = "127.0.0.1";
}
