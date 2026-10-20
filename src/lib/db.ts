import path from "path";
import "@/lib/loadLocalEnvironment";
import { PrismaLibSql } from "@prisma/adapter-libsql";
import { PrismaClient } from "@/generated/prisma/client";

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient;
};

function getDatabaseUrl(): string {
  const rawUrl = process.env.DATABASE_URL || "file:./dev.db";
  if (rawUrl.startsWith("file:")) {
    const relativePath = rawUrl.replace("file:", "");
    const absolutePath = path.resolve(/*turbopackIgnore: true*/ process.cwd(), relativePath).replace(/\\/g, "/");
    return `file:${absolutePath}`;
  }
  return rawUrl;
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
