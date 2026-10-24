# KH-01 V11.4.2 — Database Isolation & Safety Architecture

## Executive Summary
This report documents the implementation and verification of fail-closed database isolation in SWAI V11.4.2 under Master Plan KH-01 Checkpoint 1.

---

## 1. Path Canonicalization (`canonicalizeSqliteDatabasePath`)
The canonical path resolution engine in `src/lib/db.ts` standardizes database identifiers across operating systems:
- Strips `file:` protocol and URI encodings.
- Strips connection query parameters (e.g. `?mode=memory`).
- Normalizes path separators to POSIX `/`.
- Resolves relative paths against the process working directory or specified base directory.
- Resolves symbolic links via `fs.realpathSync`.
- Distinguishes remote libSQL / Turso URLs (`libsql://`, `https://`) from local SQLite files.
- Generates a case-normalized `canonicalKey` for collision comparison.

---

## 2. Fail-Closed Test Database Assertions (`assertSafeTestDatabase`)
- **Production Guard**: Test execution fails closed if `databaseUrl` resolves to any `production.db` file.
- **Collision Guard**: Test execution fails closed if `TEST_DATABASE_URL` resolves to the same file or symlink as the active application database (`DATABASE_URL` or `./dev.db`).
- **Strict Isolation Mode**: If `SWAI_TEST_ISOLATION="strict"` or `SWAI_DB_ROLE="INTEGRATION_TEST"`, execution fails closed if `TEST_DATABASE_URL` is omitted.
- **Fail Before Prisma Init**: All checks execute synchronously prior to client construction, preventing accidental connections.

---

## 3. Ephemeral Isolated Database Factory (`createIsolatedTestDatabase`)
- Factory location: `tests/helpers/createIsolatedTestDatabase.ts`.
- Clones a template SQLite schema (`prisma/test_template.db`) into a unique temporary directory in `os.tmpdir()`.
- Guarantees zero side-effects on `./dev.db`.
- Automatically torn down via `dbHandle.teardown()`.

---

## 4. Test Verification
All 10 unit tests in `tests/unit/dbIsolation.test.ts` passed:
- Path canonicalization on relative paths, symlinks, URI encodings, and remote URLs.
- Fail-closed collision detection on same file through different relative paths.
- Ephemeral test DB allocation and query execution.
