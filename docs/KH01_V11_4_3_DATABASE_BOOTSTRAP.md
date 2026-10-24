# KH-01 V11.4.3 — Checkpoint 1: Database Bootstrap & Isolation Architecture

**Target Version**: V11.4.3  
**Implementation Date**: 2026-10-24  
**Operating Mode**: RESEARCH_ONLY  

---

## 1. Defect Analysis & Motivation

In previous versions, `src/lib/db.ts` exported the Prisma client via an eager top-level declaration:
```typescript
export const prisma = globalForPrisma.prisma || createPrismaClient();
```
When test setup scripts (e.g. `tests/setupTestEnvironment.ts`) imported path canonicalization or safety assertion utilities from `@/lib/db`, Node.js evaluated `src/lib/db.ts` before the test harness had established `process.env.TEST_DATABASE_URL`. Consequently, `createPrismaClient()` evaluated against the fallback `DATABASE_URL` (`file:./dev.db`), cached the application client into `globalForPrisma`, and leaked the active development database into the test context.

---

## 2. Refactored Architecture

We separated configuration, safety validation, and Prisma construction into three distinct layers:

1. **`src/lib/database/databaseConfig.ts`**:
   * Pure, side-effect-free configuration parser and path canonicalizer.
   * Exports `DatabaseRole`, `CanonicalDatabaseLocation`, `DatabaseConfiguration`, `canonicalizeSqliteDatabasePath`, and `resolveDatabaseConfiguration`.
   * Never constructs Prisma and never performs database I/O.
2. **`src/lib/database/databaseSafety.ts`**:
   * Pure security policy enforcement.
   * Asserts fail-closed isolation in test environments.
   * Rejects path collisions, symlink aliases, and production databases before any client initialization.
3. **`src/lib/db.ts`**:
   * Exports a lazy proxy for `prisma` (`new Proxy({} as PrismaClient, { ... })`).
   * Defers `getApplicationPrisma()` invocation until the first database property access.
   * Verifies that the cached client's target canonical key matches the active configuration before reuse.
   * Re-exports configuration and safety utilities for backward compatibility across all existing callers.

---

## 3. Verification

* `npx tsc --noEmit` confirms 100% type compatibility across all existing Prisma callers.
* Unit tests in `tests/unit/dbIsolation.test.ts` verify that importing configuration functions does not trigger database connection or create SQLite files.
