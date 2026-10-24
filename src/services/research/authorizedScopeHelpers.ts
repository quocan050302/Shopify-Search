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
