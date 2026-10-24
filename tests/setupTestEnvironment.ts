import path from "path";
import os from "os";
import fs from "fs";
import crypto from "crypto";
import { canonicalizeSqliteDatabasePath, assertSafeTestDatabase } from "@/lib/db";

// Ensure every Vitest worker runs against a completely isolated SQLite test database
if (!process.env.TEST_DATABASE_URL) {
  const uniqueId = `vitest-run-${Date.now()}-${crypto.randomUUID()}`;
  const tempDir = path.join(os.tmpdir(), "swai-vitest-isolated", uniqueId);
  fs.mkdirSync(tempDir, { recursive: true });
  const isolatedPath = path.join(tempDir, "isolated_test.db");
  const templatePath = path.resolve(process.cwd(), "prisma/test_template.db");

  if (fs.existsSync(templatePath)) {
    fs.copyFileSync(templatePath, isolatedPath);
  } else {
    fs.writeFileSync(isolatedPath, "");
  }

  const testUrl = `file:${isolatedPath.replace(/\\/g, "/")}`;
  process.env.TEST_DATABASE_URL = testUrl;
  process.env.SWAI_TEST_ISOLATION = "strict";

  assertSafeTestDatabase(testUrl, process.env);
}
