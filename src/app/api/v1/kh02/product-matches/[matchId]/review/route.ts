/**
 * POST /api/v1/kh02/product-matches/[matchId]/review
 *
 * Persists an authorized human operator decision (CONFIRMED | REJECTED | UNCERTAIN)
 * for a cross-platform product matching hypothesis.
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  resolveAuthorizedResearchContext,
  ResearchAuthError,
} from "@/services/research/researchAuthService";
import {
  persistProductMatchReview,
  getStoredProductMatchReview,
} from "@/services/kh02/identity/crossPlatformProductMatcher";

const ReviewSchema = z.object({
  decision: z.enum(["CONFIRMED", "REJECTED", "UNCERTAIN"]),
  notes: z.string().max(500).optional(),
});

export async function POST(
  request: NextRequest,
  props: { params: Promise<{ matchId: string }> }
) {
  try {
    const params = await props.params;
    const context = await resolveAuthorizedResearchContext(request);

    let body: any;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json(
        { success: false, error: { code: "INVALID_JSON", message: "Request body must be valid JSON." } },
        { status: 400 }
      );
    }

    const parseResult = ReviewSchema.safeParse(body);
    if (!parseResult.success) {
      return NextResponse.json(
        {
          success: false,
          error: {
            code: "VALIDATION_FAILED",
            message: "Invalid review parameters",
            details: parseResult.error.format(),
          },
        },
        { status: 400 }
      );
    }

    const { decision, notes } = parseResult.data;

    const review = await persistProductMatchReview(
      params.matchId,
      decision,
      context.actorId,
      context.workspaceId,
      notes
    );

    return NextResponse.json({
      success: true,
      data: review,
      meta: {
        workspaceId: context.workspaceId,
        actorId: context.actorId,
        timestamp: new Date().toISOString(),
      },
    });
  } catch (err: any) {
    if (err instanceof ResearchAuthError) {
      return NextResponse.json(
        { success: false, error: { code: err.code, message: err.message } },
        { status: err.statusCode }
      );
    }

    return NextResponse.json(
      {
        success: false,
        error: {
          code: "MATCH_REVIEW_FAILED",
          message: err.message || "Failed to record product match review.",
        },
      },
      { status: 500 }
    );
  }
}

export async function GET(
  request: NextRequest,
  props: { params: Promise<{ matchId: string }> }
) {
  try {
    const params = await props.params;
    const context = await resolveAuthorizedResearchContext(request);
    const review = await getStoredProductMatchReview(params.matchId, context.workspaceId);

    return NextResponse.json({
      success: true,
      data: review,
      meta: {
        workspaceId: context.workspaceId,
        timestamp: new Date().toISOString(),
      },
    });
  } catch (err: any) {
    if (err instanceof ResearchAuthError) {
      return NextResponse.json(
        { success: false, error: { code: err.code, message: err.message } },
        { status: err.statusCode }
      );
    }

    return NextResponse.json(
      {
        success: false,
        error: {
          code: "MATCH_REVIEW_FETCH_FAILED",
          message: err.message || "Failed to retrieve product match review.",
        },
      },
      { status: 500 }
    );
  }
}
