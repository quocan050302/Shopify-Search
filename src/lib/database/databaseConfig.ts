import path from "path";
import fs from "fs";

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

/**
 * Canonicalizes a SQLite or remote database URL into a stable canonical location.
 * Correctly normalizes file paths, resolves symlinks, and respects Windows drive letters / macOS paths.
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

  // Strip query string if present (e.g. ?mode=memory&cache=shared)
  const queryIndex = filePath.indexOf("?");
  if (queryIndex !== -1) {
    filePath = filePath.slice(0, queryIndex);
  }

  try {
    filePath = decodeURIComponent(filePath);
  } catch {
    // Ignore decoding failure
  }

  // Handle in-memory SQLite paths
  if (filePath === ":memory:" || filePath === "") {
    return {
      isRemote: false,
      rawUrl: trimmed,
      canonicalPath: ":memory:",
      canonicalKey: "memory::memory:",
    };
  }

  // Normalize path separators
  filePath = filePath.replace(/\\/g, "/");

  // Handle file:// URIs on Windows (e.g. /C:/path)
  if (/^\/[a-zA-Z]:\//.test(filePath)) {
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
 * Returns true when any authoritative configured test mode applies.
 * Ensures an explicit test role (e.g. SWAI_DB_ROLE=INTEGRATION_TEST) never silently
 * bypasses isolation checks merely because NODE_ENV=production.
 */
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

/**
 * Resolves the active database configuration without constructing Prisma.
 */
export function resolveDatabaseConfiguration(
  environment: NodeJS.ProcessEnv = process.env
): DatabaseConfiguration {
  const isVitest = environment.VITEST === "true";
  const isTestEnv = environment.NODE_ENV === "test";
  const isProtected = isProtectedTestExecution(environment);
  const isTest = isVitest || isTestEnv || isProtected;

  let role: DatabaseRole = "APPLICATION";
  if (environment.SWAI_DB_ROLE) {
    const rawRole = environment.SWAI_DB_ROLE;
    if (
      rawRole === "APPLICATION" ||
      rawRole === "UNIT_TEST" ||
      rawRole === "INTEGRATION_TEST" ||
      rawRole === "LIVE_ACCEPTANCE"
    ) {
      role = rawRole as DatabaseRole;
    } else {
      throw new Error(`CRITICAL DATABASE SAFETY: Unknown SWAI_DB_ROLE '${rawRole}'.`);
    }
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
    (isProtected && environment.TEST_DATABASE_URL) ||
    environment.DATABASE_URL ||
    "file:./dev.db";

  const location = canonicalizeSqliteDatabasePath(rawUrl);

  return {
    role,
    url: location.isRemote ? rawUrl : `file:${location.canonicalPath}`,
    location,
  };
}

