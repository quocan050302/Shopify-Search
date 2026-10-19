import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { createWatchlist, addWatchlistItem } from "@/services/tracking/trackingService";

export async function GET() {
  try {
    const watchlists = await prisma.watchlist.findMany({
      include: {
        items: {
          include: {
            ad: {
              include: { advertiser: true, mediaAssets: true, researchScores: { take: 1 } },
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
      const workspace = await prisma.workspace.findFirst();
      const workspaceId = workspace?.id || "default-workspace";

      const created = await createWatchlist(workspaceId, name, description);
      return NextResponse.json({
        success: true,
        data: created,
        meta: { timestamp: new Date().toISOString(), version: "v1" },
      });
    }

    // Action: add item to watchlist
    if (action === "add_item" && watchlistId && itemType && itemId) {
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
        error: { code: "BAD_REQUEST", message: "Invalid watchlist payload" },
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
        },
      },
      { status: 500 }
    );
  }
}
