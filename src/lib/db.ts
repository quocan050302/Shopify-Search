import path from "path";
import "@/lib/loadLocalEnvironment";
import { PrismaLibSql } from "@prisma/adapter-libsql";
import { PrismaClient } from "@/generated/prisma/client";

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient;
};

export function assertSafeTestDatabase(
  databaseUrl: string,
  environment: NodeJS.ProcessEnv = process.env
): void {
  const isTest = environment.NODE_ENV === "test" || environment.VITEST === "true";
  if (!isTest) return;

  // Fail closed if test database points to production database
  if (environment.TEST_DATABASE_URL && databaseUrl.includes("production.db")) {
    throw new Error(
      `CRITICAL SAFETY: Integration test execution blocked. Test database points to production database: ${databaseUrl}`
    );
  }
}

export function getDatabaseUrl(): string {
  const isTest = process.env.NODE_ENV === "test" || process.env.VITEST === "true";
  const rawUrl = (isTest && process.env.TEST_DATABASE_URL) || process.env.DATABASE_URL || "file:./dev.db";
  let resolvedUrl = rawUrl;
  if (rawUrl.startsWith("file:")) {
    const relativePath = rawUrl.replace("file:", "");
    const absolutePath = path.resolve(/*turbopackIgnore: true*/ process.cwd(), relativePath).replace(/\\/g, "/");
    resolvedUrl = `file:${absolutePath}`;
  }
  assertSafeTestDatabase(resolvedUrl, process.env);
  return resolvedUrl;
}

function createPrismaClient(): PrismaClient {
  const url = getDatabaseUrl();
  const adapter = new PrismaLibSql({ url });
  return new PrismaClient({ adapter });
}

export const prisma = globalForPrisma.prisma || createPrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
