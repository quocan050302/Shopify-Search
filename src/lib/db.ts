import path from "path";
import fs from "fs";
import "@/lib/loadLocalEnvironment";
import { PrismaLibSql } from "@prisma/adapter-libsql";
import { PrismaClient } from "@/generated/prisma/client";

export type DatabaseRole =
  | "APPLICATION"
  | "UNIT_TEST"
  | "INTEGRATION_TEST"
  | "LIVE_ACCEPTANCE";

export interface CanonicalDatabaseLocation {
  isRemote: boolean;
  rawUrl: string;
  canonicalPath: string | null;
  canonicalKey: string;
}

export interface DatabaseConfiguration {
  role: DatabaseRole;
  url: string;
  location: CanonicalDatabaseLocation;
}

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient;
};

/**
 * Normalizes any database URL or SQLite filesystem path into a canonical comparison key.
 * Resolves symlinks, relative paths, case variations (Windows), and file: protocols.
 */
export function canonicalizeSqliteDatabasePath(
  databaseUrl: string,
  baseDirectory: string = process.cwd()
): CanonicalDatabaseLocation {
  if (!databaseUrl || typeof databaseUrl !== "string") {
    return {
      isRemote: false,
      rawUrl: "",
      canonicalPath: null,
      canonicalKey: "empty",
    };
  }

  const trimmed = databaseUrl.trim();

  // Remote libSQL / Turso or HTTP protocols
  if (
    trimmed.startsWith("libsql://") ||
    trimmed.startsWith("http://") ||
    trimmed.startsWith("https://") ||
    trimmed.startsWith("ws://") ||
    trimmed.startsWith("wss://")
  ) {
    try {
      const parsed = new URL(trimmed);
      return {
        isRemote: true,
        rawUrl: trimmed,
        canonicalPath: null,
        canonicalKey: `remote:${parsed.protocol}//${parsed.host}${parsed.pathname}`.toLowerCase(),
      };
    } catch {
      return {
        isRemote: true,
        rawUrl: trimmed,
        canonicalPath: null,
        canonicalKey: `remote:${trimmed.toLowerCase()}`,
      };
    }
  }

  // Local SQLite file path
  let filePath = trimmed;
  if (filePath.startsWith("file:")) {
    filePath = filePath.slice(5);
  }

  // Strip query parameters (e.g. ?mode=memory or ?cache=shared)
  const queryIndex = filePath.indexOf("?");
  if (queryIndex !== -1) {
    filePath = filePath.slice(0, queryIndex);
  }

  // Handle in-memory database
  if (filePath === ":memory:" || filePath === "") {
    return {
      isRemote: false,
      rawUrl: trimmed,
      canonicalPath: ":memory:",
      canonicalKey: "memory::memory:",
    };
  }

  // Decode URI encoding if present
  try {
    filePath = decodeURIComponent(filePath);
  } catch {
    // Keep as is if malformed decoding
  }

  // Normalize path separators to POSIX forward slash
  filePath = filePath.replace(/\\/g, "/");

  // Handle Windows drive letters (e.g. /C:/path -> C:/path)
  if (/^\/[a-zA-Z]:/.test(filePath)) {
    filePath = filePath.slice(1);
  }

  // Resolve absolute path against baseDirectory
  let absolutePath = path.isAbsolute(filePath)
    ? path.normalize(filePath)
    : path.resolve(baseDirectory, filePath);

  // Resolve real path / symlink if target exists
  try {
    if (fs.existsSync(absolutePath)) {
      absolutePath = fs.realpathSync(absolutePath);
    } else {
      // If file doesn't exist yet, resolve parent directory symlink if possible
      const parentDir = path.dirname(absolutePath);
      if (fs.existsSync(parentDir)) {
        const realParent = fs.realpathSync(parentDir);
        absolutePath = path.join(realParent, path.basename(absolutePath));
      }
    }
  } catch {
    // Fall back to normalized absolutePath
  }

  // Standardize case on Windows / macOS for comparison key
  const normalizedKey = absolutePath.replace(/\\/g, "/").toLowerCase();

  return {
    isRemote: false,
    rawUrl: trimmed,
    canonicalPath: absolutePath.replace(/\\/g, "/"),
    canonicalKey: `file:${normalizedKey}`,
  };
}

/**
 * Resolves the active database configuration and validates role boundaries.
 */
export function resolveDatabaseConfiguration(
  environment: NodeJS.ProcessEnv = process.env
): DatabaseConfiguration {
  const isVitest = environment.VITEST === "true";
  const isTestEnv = environment.NODE_ENV === "test";
  const isTest = isVitest || isTestEnv;

  let role: DatabaseRole = "APPLICATION";
  if (environment.SWAI_DB_ROLE) {
    role = environment.SWAI_DB_ROLE as DatabaseRole;
  } else if (isTest) {
    if (environment.SWAI_LIVE_ACCEPTANCE === "true") {
      role = "LIVE_ACCEPTANCE";
    } else if (environment.TEST_DATABASE_URL || environment.SWAI_TEST_ISOLATION === "strict") {
      role = "INTEGRATION_TEST";
    } else {
      role = "UNIT_TEST";
    }
  }

  const rawUrl =
    (isTest && environment.TEST_DATABASE_URL) ||
    environment.DATABASE_URL ||
    "file:./dev.db";

  const location = canonicalizeSqliteDatabasePath(rawUrl);

  return {
    role,
    url: location.isRemote ? rawUrl : `file:${location.canonicalPath}`,
    location,
  };
}

/**
 * Asserts that test execution cannot accidentally overwrite or mutate the active application database.
 * Fails closed immediately prior to any database connection.
 */
export function assertSafeTestDatabase(
  databaseUrl: string,
  environment: NodeJS.ProcessEnv = process.env
): void {
  const isTest = environment.NODE_ENV === "test" || environment.VITEST === "true";
  if (!isTest) return;

  const activeAppRawUrl = environment.DATABASE_URL || "file:./dev.db";
  const activeAppLocation = canonicalizeSqliteDatabasePath(activeAppRawUrl);
  const testLocation = canonicalizeSqliteDatabasePath(databaseUrl);

  // 1. Never allow test database to point to production database files
  if (testLocation.canonicalKey.includes("production.db")) {
    throw new Error(
      `CRITICAL DATABASE SAFETY: Integration test execution blocked. Test database points to production database: ${databaseUrl}`
    );
  }

  // 2. Strict integration test isolation check
  const isStrictIntegration =
    environment.SWAI_TEST_ISOLATION === "strict" ||
    environment.SWAI_DB_ROLE === "INTEGRATION_TEST";

  if (isStrictIntegration) {
    if (!environment.TEST_DATABASE_URL) {
      throw new Error(
        "CRITICAL DATABASE SAFETY: Integration test requires an explicit isolated TEST_DATABASE_URL. Accidental fallback to active database is prohibited."
      );
    }
  }

  // 3. Collision check: If TEST_DATABASE_URL is provided, it MUST NOT match the active application DB
  if (environment.TEST_DATABASE_URL) {
    if (testLocation.canonicalKey === activeAppLocation.canonicalKey) {
      throw new Error(
        `CRITICAL DATABASE SAFETY: TEST_DATABASE_URL resolves to the same file as the active application database (${activeAppLocation.canonicalPath}). Tests must run against an isolated database.`
      );
    }
  }
}

export function getDatabaseUrl(): string {
  const config = resolveDatabaseConfiguration(process.env);
  assertSafeTestDatabase(config.url, process.env);
  return config.url;
}

export function createPrismaClient(databaseUrl?: string): PrismaClient {
  const url = databaseUrl || getDatabaseUrl();
  const adapter = new PrismaLibSql({ url });
  return new PrismaClient({ adapter });
}

export const prisma = globalForPrisma.prisma || createPrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
