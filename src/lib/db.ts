import { PrismaClient } from "@/generated/prisma/client";
import { PrismaLibSql } from "@prisma/adapter-libsql";
import {
  DatabaseRole,
  CanonicalDatabaseLocation,
  DatabaseConfiguration,
  canonicalizeSqliteDatabasePath,
} from "./database/databaseConfig";
import { assertSafeTestDatabase, isProtectedTestExecution } from "./database/databaseSafety";

export type { DatabaseRole, CanonicalDatabaseLocation, DatabaseConfiguration };
export {
  canonicalizeSqliteDatabasePath,
  resolveDatabaseConfiguration,
  assertSafeTestDatabase,
  isProtectedTestExecution,
};

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
 * Prevents premature Prisma client construction upon module import while supporting
 * full property reflection and test spies (vi.spyOn).
 */
export const prisma: PrismaClient = new Proxy({} as PrismaClient, {
  get(_target, prop, receiver) {
    if (prop in _target) {
      return Reflect.get(_target, prop, receiver);
    }
    const client = getApplicationPrisma();
    const value = Reflect.get(client, prop, receiver);
    if (typeof value === "function") {
      return value.bind(client);
    }
    return value;
  },
  set(_target, prop, value, receiver) {
    Reflect.set(_target, prop, value);
    const client = getApplicationPrisma();
    return Reflect.set(client, prop, value, receiver);
  },
  defineProperty(_target, prop, descriptor) {
    return Reflect.defineProperty(_target, prop, descriptor);
  },
  deleteProperty(_target, prop) {
    return Reflect.deleteProperty(_target, prop);
  },
  has(_target, prop) {
    if (prop in _target) return true;
    const client = getApplicationPrisma();
    return prop in client;
  },
  getOwnPropertyDescriptor(_target, prop) {
    if (prop in _target) {
      const targetDesc = Object.getOwnPropertyDescriptor(_target, prop);
      if (targetDesc) return { ...targetDesc, configurable: true };
    }
    const client = getApplicationPrisma();
    const desc =
      Object.getOwnPropertyDescriptor(client, prop) ||
      Object.getOwnPropertyDescriptor(Object.getPrototypeOf(client), prop);
    if (desc) {
      return { ...desc, configurable: true };
    }
    if (prop in client) {
      return {
        value: (client as any)[prop],
        writable: true,
        enumerable: true,
        configurable: true,
      };
    }
    return undefined;
  },
  ownKeys(_target) {
    const client = getApplicationPrisma();
    const clientKeys = Reflect.ownKeys(client);
    const targetKeys = Reflect.ownKeys(_target);
    return Array.from(new Set([...clientKeys, ...targetKeys]));
  },
});
