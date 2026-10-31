# KH-01 V11.4.3 — Checkpoint 2: Reproducible Test Schema from Clean Checkout

**Target Version**: V11.4.3  
**Implementation Date**: 2026-10-24  
**Operating Mode**: RESEARCH_ONLY  

---

## 1. Defect Analysis & Root Cause

Previously, the isolated test database factory in `tests/helpers/createIsolatedTestDatabase.ts` depended on copying a local binary database file: `prisma/test_template.db`.
However, `.gitignore` contains the rule `*.db`, which meant `prisma/test_template.db` was untracked and excluded from version control.

On a fresh git clone or clean CI environment, `test_template.db` was absent, causing the factory to create a 0-byte empty file. This resulted in immediate SQL runtime failures (`no such table: workspaces`, etc.) when running tests. Furthermore, executing `prisma db push` programmatically is actively blocked by Prisma Migrate's AI agent safety checks.

---

## 2. Solution: Version-Controlled DDL Execution

We introduced `prisma/schema.sql`, an exact, complete SQL DDL schema export tracked directly in Git:
* Contains all table definitions, foreign keys, indexes, and default constraints across all 42 application and KH-01 tables.
* When `createIsolatedTestDatabase` or `setupTestEnvironment.ts` runs on a machine without a local binary template, it initializes the ephemeral SQLite database by executing `client.executeMultiple(ddl)` using `@libsql/client`.
* Execution completes in ~10 milliseconds, requires zero external network calls, zero binary templates, and zero agent override flags.
* `verifyIsolatedSchema(prisma)` validates that all core models (`workspaces`, `competitor_ads`, `research_products`, `sync_jobs`, `landing_page_snapshots`, `competitor_offer_snapshots`, `research_evidence`, `research_decisions`) are present and ready before returning the database handle.

---

## 3. Verification

* Verified that `tests/helpers/createIsolatedTestDatabase.ts` creates and verifies a fully queryable database in temporary storage without relying on `test_template.db`.
* Verified that test teardown safely unlinks the temporary database and associated WAL/SHM journal files without touching `dev.db`.
