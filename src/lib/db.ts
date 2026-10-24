import { PrismaClient } from "@/generated/prisma/client";
import { PrismaLibSql } from "@prisma/adapter-libsql";
import {
  DatabaseRole,
  CanonicalDatabaseLocation,
  DatabaseConfiguration,
  canonicalizeSqliteDatabasePath,
  resolveDatabaseConfiguration,
} from "./database/databaseConfig";
import { assertSafeTestDatabase } from "./database/databaseSafety";

export type { DatabaseRole, CanonicalDatabaseLocation, DatabaseConfiguration };
export { canonicalizeSqliteDatabasePath, resolveDatabaseConfiguration, assertSafeTestDatabase };

interface GlobalPrismaState {
  prisma?: PrismaClient;
  canonicalKey?: string;
}

const globalForPrisma = globalThis as unknown as {
  prismaState?: GlobalPrismaState;
};

if (!globalForPrisma.prismaState) {
  globalForPrisma.prismaState = {};
}

/**
 * Returns the validated database connection URL for the current environment.
 */
export function getDatabaseUrl(): string {
  const config = resolveDatabaseConfiguration(process.env);
  assertSafeTestDatabase(config.url, process.env);
  return config.url;
}

/**
 * Creates a standalone PrismaClient instance bound to the specified or configured URL.
 */
export function createPrismaClient(databaseUrl?: string): PrismaClient {
  const url = databaseUrl || getDatabaseUrl();
  assertSafeTestDatabase(url, process.env);
  const adapter = new PrismaLibSql({ url });
  return new PrismaClient({ adapter });
}

/**
 * Returns the active application Prisma singleton, guaranteeing safe initialization.
 */
export function getApplicationPrisma(): PrismaClient {
  const config = resolveDatabaseConfiguration(process.env);
  assertSafeTestDatabase(config.url, process.env);

  const state = globalForPrisma.prismaState!;
  if (!state.prisma || state.canonicalKey !== config.location.canonicalKey) {
    if (state.prisma) {
      // Disconnect previous instance if target changed
      state.prisma.$disconnect().catch(() => {});
    }
    state.prisma = createPrismaClient(config.url);
    state.canonicalKey = config.location.canonicalKey;
  }

  return state.prisma;
}

/**
 * Lazy Prisma client proxy that defers connection and initialization until first access.
 * Prevents premature Prisma client construction upon module import.
 */
export const prisma: PrismaClient = new Proxy({} as PrismaClient, {
  get(_target, prop, receiver) {
    const client = getApplicationPrisma();
    const value = Reflect.get(client, prop, receiver);
    if (typeof value === "function") {
      return value.bind(client);
    }
    return value;
  },
});
