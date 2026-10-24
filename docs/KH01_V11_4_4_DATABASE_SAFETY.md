# KH-01 V11.4.4 — Database Isolation & Production Mode Safety

**Date**: 2026-10-24  
**Target Version**: V11.4.4  
**Branch**: `feature/v11-meta-collector-remove-muse`  

---

## 1. Context & Identified Vulnerability
In V11.4.3, `assertSafeTestDatabase()` in `src/lib/database/databaseSafety.ts` contained:
```ts
const isTest = environment.NODE_ENV === "test" || environment.VITEST === "true";
if (!isTest) return;
```
When running Next.js in production mode (`next start` or `next build`), `NODE_ENV` is set to `"production"`. If an E2E test or integration server started with `SWAI_DB_ROLE=INTEGRATION_TEST`, the early exit allowed `assertSafeTestDatabase` to silently bypass collision checks, risking accidental fallback to `dev.db`.

---

## 2. Implemented Architecture & Logic

### Authoritative Protected Mode Detector: `isProtectedTestExecution`
Implemented in `src/lib/database/databaseConfig.ts` and re-exported via `src/lib/database/databaseSafety.ts` and `src/lib/db.ts`:
```ts
export function isProtectedTestExecution(
  environment: NodeJS.ProcessEnv = process.env
): boolean {
  if (environment.NODE_ENV === "test") return true;
  if (environment.VITEST === "true") return true;
  if (
    environment.SWAI_DB_ROLE === "INTEGRATION_TEST" ||
    environment.SWAI_DB_ROLE === "LIVE_ACCEPTANCE" ||
    environment.SWAI_DB_ROLE === "UNIT_TEST"
  ) {
    return true;
  }
  if (
    environment.SWAI_E2E_SERVER === "true" ||
    environment.SWAI_TEST_ISOLATION === "strict"
  ) {
    return true;
  }
  return false;
}
```

### Fail-Closed Assertion: `assertSafeTestDatabase`
Updated in `src/lib/database/databaseSafety.ts`:
```ts
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
```

### Dynamic URL Resolution: `resolveDatabaseConfiguration`
Updated in `src/lib/database/databaseConfig.ts`:
```ts
const isProtected = isProtectedTestExecution(environment);
const isTest = isVitest || isTestEnv || isProtected;
...
const rawUrl =
  (isProtected && environment.TEST_DATABASE_URL) ||
  environment.DATABASE_URL ||
  "file:./dev.db";
```

---

## 3. Verification & Test Evidence
- **Test Suite**: `tests/unit/dbIsolation.test.ts`
- **Tests Added**:
  - `enforces isolation when NODE_ENV is production but SWAI_DB_ROLE is INTEGRATION_TEST`:
    - Verified missing `TEST_DATABASE_URL` throws fail-closed error.
    - Verified collision with active `dev.db` throws fail-closed error.
    - Verified distinct isolated path passes safely.
- **Outcome**: 11 / 11 tests passed in 345ms.
- **Git Commit Target**: Checkpoint 2 (`fix(kh01): enforce database isolation for HTTP and browser acceptance`).
