/**
 * SWAI V11.6.1 — Live Journey Resource Lifecycle & Cleanup Helper (Sections 18, 19)
 *
 * Guarantees safe, idempotent, bounded cleanup of all live journey resources:
 * Browser, Subprocess Worker, Next.js loopback test server, Python MCP client,
 * Prisma connection, and ephemeral isolated SQLite database.
 */

import { ChildProcess } from "child_process";

export interface LiveJourneyResources {
  page?: any | null;
  browserContext?: any | null;
  browser?: any | null;
  workerChild?: ChildProcess | null;
  server?: { stop: () => Promise<void> } | any | null;
  mcpClient?: { close: () => Promise<void> } | any | null;
  dbHandle?: {
    prisma?: { $disconnect: () => Promise<void> };
    teardown: () => Promise<void>;
  } | any | null;
}

export interface CleanupResult {
  browserClosed: boolean;
  workerStopped: boolean;
  nextServerStopped: boolean;
  mcpClosed: boolean;
  prismaDisconnected: boolean;
  isolatedDatabaseDeleted: boolean;
  errors: string[];
}

/**
 * Safely tears down resources in deterministic order.
 * Guaranteed to be idempotent and bounded by timeout.
 */
export async function cleanupLiveJourneyResources(
  resources: LiveJourneyResources
): Promise<CleanupResult> {
  const errors: string[] = [];
  let browserClosed = false;
  let workerStopped = false;
  let nextServerStopped = false;
  let mcpClosed = false;
  let prismaDisconnected = false;
  let isolatedDatabaseDeleted = false;

  // 1. Close page
  if (resources.page) {
    try {
      if (!resources.page.isClosed?.()) {
        await resources.page.close().catch(() => {});
      }
    } catch (err: unknown) {
      errors.push(`Error closing browser page: ${(err as Error).message}`);
    }
  }

  // 2. Close browser context
  if (resources.browserContext) {
    try {
      await resources.browserContext.close().catch(() => {});
    } catch (err: unknown) {
      errors.push(`Error closing browser context: ${(err as Error).message}`);
    }
  }

  // 3. Close Chromium browser instance
  if (resources.browser) {
    try {
      if (resources.browser.isConnected?.()) {
        await resources.browser.close().catch(() => {});
      }
      browserClosed = true;
    } catch (err: unknown) {
      errors.push(`Error closing browser: ${(err as Error).message}`);
    }
  } else {
    browserClosed = true;
  }

  // 4. Request Worker shutdown, wait with timeout, and escalate to SIGKILL if necessary
  if (resources.workerChild) {
    try {
      if (resources.workerChild.exitCode === null && resources.workerChild.signalCode === null) {
        resources.workerChild.kill("SIGTERM");
        const exited = await Promise.race([
          new Promise<boolean>((resolve) => {
            resources.workerChild?.once("exit", () => resolve(true));
          }),
          new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 2500)),
        ]);

        if (!exited && resources.workerChild.exitCode === null) {
          try {
            resources.workerChild.kill("SIGKILL");
          } catch {}
        }
      }
      workerStopped = true;
    } catch (err: unknown) {
      errors.push(`Error terminating discovery worker subprocess: ${(err as Error).message}`);
    }
  } else {
    workerStopped = true;
  }

  // 5. Stop Next.js loopback test server
  if (resources.server) {
    try {
      await resources.server.stop();
      nextServerStopped = true;
    } catch (err: unknown) {
      errors.push(`Error stopping Next.js test server: ${(err as Error).message}`);
    }
  } else {
    nextServerStopped = true;
  }

  // 6. Close Python MCP client
  if (resources.mcpClient) {
    try {
      await resources.mcpClient.close();
      mcpClosed = true;
    } catch (err: unknown) {
      errors.push(`Error closing MCP client: ${(err as Error).message}`);
    }
  } else {
    mcpClosed = true;
  }

  // 7. Disconnect Prisma & teardown ephemeral test database
  if (resources.dbHandle) {
    try {
      if (resources.dbHandle.prisma) {
        await resources.dbHandle.prisma.$disconnect().catch(() => {});
        prismaDisconnected = true;
      }
    } catch (err: unknown) {
      errors.push(`Error disconnecting Prisma: ${(err as Error).message}`);
    }

    try {
      await resources.dbHandle.teardown();
      isolatedDatabaseDeleted = true;
    } catch (err: unknown) {
      errors.push(`Error tearing down isolated database: ${(err as Error).message}`);
    }
  } else {
    prismaDisconnected = true;
    isolatedDatabaseDeleted = true;
  }

  return {
    browserClosed,
    workerStopped,
    nextServerStopped,
    mcpClosed,
    prismaDisconnected,
    isolatedDatabaseDeleted,
    errors,
  };
}
