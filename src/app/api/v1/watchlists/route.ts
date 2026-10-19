import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { createWatchlist, addWatchlistItem, removeWatchlistItem } from "@/services/tracking/trackingService";

export async function GET() {
  try {
    const watchlists = await prisma.watchlist.findMany({
      include: {
        items: {
          include: {
            ad: {
              include: {
                advertiser: true,
                mediaAssets: true,
                researchScores: { take: 1, orderBy: { createdAt: "desc" } },
              },
            },
            product: {
              include: { store: true },
            },
          },
        },
      },
      orderBy: { createdAt: "desc" },
    });

    return NextResponse.json({
      success: true,
      data: watchlists,
      meta: {
        timestamp: new Date().toISOString(),
        version: "v1",
      },
    });
  } catch (error: any) {
    return NextResponse.json(
      {
        success: false,
        error: {
          code: "WATCHLIST_FETCH_FAILED",
          message: error.message || "Failed to fetch watchlists",
          retryable: true,
          timestamp: new Date().toISOString(),
        },
      },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { action, name, description, watchlistId, itemType, itemId } = body;

    // Action: create watchlist
    if (action === "create" || name) {
      if (!name || !name.trim()) {
        return NextResponse.json(
          {
            success: false,
            error: {
              code: "MISSING_NAME",
              message: "Watchlist name is required.",
              retryable: false,
              timestamp: new Date().toISOString(),
            },
          },
          { status: 400 }
        );
      }

      // Find or create a real workspace — never use a hardcoded string ID
      let workspace = await prisma.workspace.findFirst({
        orderBy: { createdAt: "asc" },
      });

      if (!workspace) {
        workspace = await prisma.workspace.create({
          data: {
            name: "US Research Desk",
            operatingMode: "RESEARCH_ONLY",
            targetMarket: "US",
          },
        });
      }

      const created = await createWatchlist(workspace.id, name.trim(), description);
      return NextResponse.json({
        success: true,
        data: created,
        meta: { timestamp: new Date().toISOString(), version: "v1" },
      });
    }

    // Action: add item to watchlist
    if (action === "add_item" && watchlistId && itemType && itemId) {
      // Verify watchlistId is a real database ID (not 'default-watchlist')
      const watchlist = await prisma.watchlist.findUnique({
        where: { id: watchlistId },
      });

      if (!watchlist) {
        return NextResponse.json(
          {
            success: false,
            error: {
              code: "WATCHLIST_NOT_FOUND",
              message: `Watchlist with ID '${watchlistId}' not found. Please create a watchlist first.`,
              retryable: false,
              timestamp: new Date().toISOString(),
            },
          },
          { status: 404 }
        );
      }

      const added = await addWatchlistItem(watchlistId, itemType, itemId);
      return NextResponse.json({
        success: true,
        data: added,
        meta: { timestamp: new Date().toISOString(), version: "v1" },
      });
    }

    return NextResponse.json(
      {
        success: false,
        error: {
          code: "BAD_REQUEST",
          message: "Invalid watchlist payload. Provide action, name, or add_item parameters.",
          retryable: false,
          timestamp: new Date().toISOString(),
        },
      },
      { status: 400 }
    );
  } catch (error: any) {
    return NextResponse.json(
      {
        success: false,
        error: {
          code: "WATCHLIST_ACTION_FAILED",
          message: error.message || "Failed to perform watchlist action",
          retryable: false,
          timestamp: new Date().toISOString(),
        },
      },
      { status: 500 }
    );
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const itemId = searchParams.get("itemId");

    if (!itemId) {
      return NextResponse.json(
        {
          success: false,
          error: {
            code: "MISSING_ITEM_ID",
            message: "itemId query parameter is required.",
            retryable: false,
            timestamp: new Date().toISOString(),
          },
        },
        { status: 400 }
      );
    }

    // Verify item exists before attempting delete
    const item = await prisma.watchlistItem.findUnique({ where: { id: itemId } });
    if (!item) {
      return NextResponse.json(
        {
          success: false,
          error: {
            code: "ITEM_NOT_FOUND",
            message: `Watchlist item with ID '${itemId}' not found.`,
            retryable: false,
            timestamp: new Date().toISOString(),
          },
        },
        { status: 404 }
      );
    }

    await removeWatchlistItem(itemId);

    return NextResponse.json({
      success: true,
      data: { removedItemId: itemId },
      meta: { timestamp: new Date().toISOString(), version: "v1" },
    });
  } catch (error: any) {
    return NextResponse.json(
      {
        success: false,
        error: {
          code: "WATCHLIST_DELETE_FAILED",
          message: error.message || "Failed to remove watchlist item",
          retryable: false,
          timestamp: new Date().toISOString(),
        },
      },
      { status: 500 }
    );
  }
}
