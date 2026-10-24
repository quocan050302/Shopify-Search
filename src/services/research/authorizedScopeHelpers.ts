/**
 * SWAI V11.5.1 — Authorized Scope Query Helpers
 *
 * Enforces strict multi-tenant workspace isolation across Ads and Products queries.
 * Evaluates relational ownership through legitimate associations:
 * - CompetitorAd: DiscoveryRunAd -> DiscoveryRun -> Workspace, or Watchlist -> Workspace
 * - ResearchProduct: AdProductLink -> CompetitorAd -> DiscoveryRunAd -> Workspace,
 *                    or Watchlist, Evidence, OpportunityAssessment, OfferSnapshot, LandingPageSnapshot -> Workspace
 */

import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { ResearchAuthError } from "@/services/research/researchAuthService";

/**
 * Builds Prisma where input to restrict CompetitorAd queries strictly to the authorized workspace.
 */
export function buildAuthorizedAdWhere(workspaceId: string): Prisma.CompetitorAdWhereInput {
  if (!workspaceId || typeof workspaceId !== "string" || workspaceId.trim().length === 0) {
    // Fail-closed: match nothing if workspaceId is missing or empty
    return { id: "__UNAUTHORIZED_EMPTY_WORKSPACE__" };
  }

  const cleanWs = workspaceId.trim();

  return {
    OR: [
      {
        runAds: {
          some: {
            OR: [
              { workspaceId: cleanWs },
              { run: { workspaceId: cleanWs } },
            ],
          },
        },
      },
      {
        watchlistItems: {
          some: {
            watchlist: {
              workspaceId: cleanWs,
            },
          },
        },
      },
    ],
  };
}

/**
 * Builds Prisma where input to restrict ResearchProduct queries strictly to the authorized workspace.
 */
export function buildAuthorizedProductWhere(workspaceId: string): Prisma.ResearchProductWhereInput {
  if (!workspaceId || typeof workspaceId !== "string" || workspaceId.trim().length === 0) {
    // Fail-closed: match nothing if workspaceId is missing or empty
    return { id: "__UNAUTHORIZED_EMPTY_WORKSPACE__" };
  }

  const cleanWs = workspaceId.trim();

  return {
    OR: [
      {
        adLinks: {
          some: {
            ad: {
              runAds: {
                some: {
                  OR: [
                    { workspaceId: cleanWs },
                    { run: { workspaceId: cleanWs } },
                  ],
                },
              },
            },
          },
        },
      },
      {
        watchlistItems: {
          some: {
            watchlist: {
              workspaceId: cleanWs,
            },
          },
        },
      },
      {
        evidence: {
          some: {
            workspaceId: cleanWs,
          },
        },
      },
      {
        opportunityAssessments: {
          some: {
            workspaceId: cleanWs,
          },
        },
      },
      {
        offerSnapshots: {
          some: {
            workspaceId: cleanWs,
          },
        },
      },
      {
        landingPageSnapshots: {
          some: {
            workspaceId: cleanWs,
          },
        },
      },
    ],
  };
}

/**
 * Resolves a DiscoveryRun strictly asserting that it exists and belongs to the caller's authorized workspace.
 * Fails closed with 404 for missing runs and 403 for cross-workspace attempts.
 */
export async function resolveAuthorizedDiscoveryRun(
  runId: string,
  context: { workspaceId: string }
): Promise<{ id: string; workspaceId: string; status: string; providerId: string }> {
  if (!runId || typeof runId !== "string" || !runId.trim()) {
    throw new ResearchAuthError("Missing or invalid discovery run ID parameter.", "RUN_NOT_FOUND", 400);
  }

  const cleanRunId = runId.trim();
  const run = await prisma.discoveryRun.findUnique({
    where: { id: cleanRunId },
    select: { id: true, workspaceId: true, status: true, providerId: true },
  });

  if (!run) {
    throw new ResearchAuthError(`Discovery run '${cleanRunId}' not found.`, "RUN_NOT_FOUND", 404);
  }

  if (run.workspaceId !== context.workspaceId) {
    throw new ResearchAuthError(
      `Access denied: Discovery run '${cleanRunId}' belongs to another workspace.`,
      "FORBIDDEN_WORKSPACE_RUN",
      403
    );
  }

  return run;
}
