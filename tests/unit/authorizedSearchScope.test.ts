import { describe, it, expect } from "vitest";
import {
  buildAuthorizedAdWhere,
  buildAuthorizedProductWhere,
} from "@/services/research/authorizedScopeHelpers";

describe("authorizedScopeHelpers unit tests", () => {
  it("buildAuthorizedAdWhere generates strict relation where query for valid workspaceId", () => {
    const where = buildAuthorizedAdWhere("ws_test_123");
    expect(where.OR).toBeDefined();
    expect(where.OR?.length).toBe(2);

    // Checks runAds
    const runAdsClause = where.OR?.[0] as any;
    expect(runAdsClause.runAds).toBeDefined();

    // Checks watchlistItems
    const watchlistClause = where.OR?.[1] as any;
    expect(watchlistClause.watchlistItems).toBeDefined();
    expect(watchlistClause.watchlistItems.some.watchlist.workspaceId).toBe("ws_test_123");
  });

  it("buildAuthorizedAdWhere fails closed on empty or whitespace workspaceId", () => {
    const whereEmpty = buildAuthorizedAdWhere("");
    expect(whereEmpty).toEqual({ id: "__UNAUTHORIZED_EMPTY_WORKSPACE__" });

    const whereWhitespace = buildAuthorizedAdWhere("   ");
    expect(whereWhitespace).toEqual({ id: "__UNAUTHORIZED_EMPTY_WORKSPACE__" });
  });

  it("buildAuthorizedProductWhere generates comprehensive relational checks for valid workspaceId", () => {
    const where = buildAuthorizedProductWhere("ws_test_prod_99");
    expect(where.OR).toBeDefined();
    expect(where.OR?.length).toBe(6);

    // Checks adLinks -> ad -> runAds
    const adLinksClause = where.OR?.[0] as any;
    expect(adLinksClause.adLinks.some.ad.runAds).toBeDefined();

    // Checks watchlistItems -> watchlist
    const watchlistClause = where.OR?.[1] as any;
    expect(watchlistClause.watchlistItems.some.watchlist.workspaceId).toBe("ws_test_prod_99");

    // Checks evidence
    const evidenceClause = where.OR?.[2] as any;
    expect(evidenceClause.evidence.some.workspaceId).toBe("ws_test_prod_99");

    // Checks opportunityAssessments
    const oppClause = where.OR?.[3] as any;
    expect(oppClause.opportunityAssessments.some.workspaceId).toBe("ws_test_prod_99");

    // Checks offerSnapshots
    const offerClause = where.OR?.[4] as any;
    expect(offerClause.offerSnapshots.some.workspaceId).toBe("ws_test_prod_99");

    // Checks landingPageSnapshots
    const lpClause = where.OR?.[5] as any;
    expect(lpClause.landingPageSnapshots.some.workspaceId).toBe("ws_test_prod_99");
  });

  it("buildAuthorizedProductWhere fails closed on empty or whitespace workspaceId", () => {
    const whereEmpty = buildAuthorizedProductWhere("");
    expect(whereEmpty).toEqual({ id: "__UNAUTHORIZED_EMPTY_WORKSPACE__" });

    const whereWhitespace = buildAuthorizedProductWhere("  ");
    expect(whereWhitespace).toEqual({ id: "__UNAUTHORIZED_EMPTY_WORKSPACE__" });
  });
});
