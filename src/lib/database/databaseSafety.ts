import {
  canonicalizeSqliteDatabasePath,
  DatabaseConfiguration,
  resolveDatabaseConfiguration,
  isProtectedTestExecution,
} from "./databaseConfig";

export { isProtectedTestExecution };


/**
 * Asserts that test execution cannot accidentally overwrite or mutate the active application database.
 * Fails closed immediately prior to any database connection.
 */
export function assertSafeTestDatabase(
  databaseUrl: string,
  environment: NodeJS.ProcessEnv = process.env
): void {
  if (!isProtectedTestExecution(environment)) return;

  const activeAppRawUrl = environment.DATABASE_URL || "file:./dev.db";
  const activeAppLocation = canonicalizeSqliteDatabasePath(activeAppRawUrl);
  const testLocation = canonicalizeSqliteDatabasePath(databaseUrl);

  // 1. Never allow test database to point to production database files
  if (testLocation.canonicalKey.includes("production.db")) {
    throw new Error(
      `CRITICAL DATABASE SAFETY: Integration test execution blocked. Test database points to production database: ${databaseUrl}`
    );
  }

  // 2. Reject remote libSQL target for tests unless specifically approved
  if (testLocation.isRemote && environment.SWAI_ALLOW_REMOTE_TEST_DB !== "true") {
    throw new Error(
      `CRITICAL DATABASE SAFETY: Remote database URL '${testLocation.rawUrl.split("@").pop()}' is blocked in test mode.`
    );
  }

  // 3. Strict integration test isolation check
  const isStrictIntegration =
    environment.SWAI_TEST_ISOLATION === "strict" ||
    environment.SWAI_DB_ROLE === "INTEGRATION_TEST" ||
    environment.SWAI_DB_ROLE === "LIVE_ACCEPTANCE" ||
    environment.SWAI_E2E_SERVER === "true";

  if (isStrictIntegration) {
    if (!environment.TEST_DATABASE_URL) {
      throw new Error(
        "CRITICAL DATABASE SAFETY: Integration test requires an explicit isolated TEST_DATABASE_URL. Accidental fallback to active database is prohibited."
      );
    }
  }

  // 4. Collision check: If TEST_DATABASE_URL is provided, it MUST NOT match the active application DB
  if (environment.TEST_DATABASE_URL) {
    if (testLocation.canonicalKey === activeAppLocation.canonicalKey) {
      throw new Error(
        `CRITICAL DATABASE SAFETY: TEST_DATABASE_URL resolves to the same file as the active application database (${activeAppLocation.canonicalPath}). Tests must run against an isolated database.`
      );
    }
  }
}

