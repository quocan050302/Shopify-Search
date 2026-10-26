/**
 * POST /api/v1/kh02/research
 *
 * Initiates cross-platform evergreen winning product research for a topic/niche.
 * Enforces workspace isolation and server-side authorization.
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  resolveAuthorizedResearchContext,
  ResearchAuthError,
} from "@/services/research/researchAuthService";
import { runEvergreenProductResearch } from "@/services/kh02/evergreenResearchOrchestrator";

const ResearchRequestSchema = z.object({
  topic: z.string().min(2, "Topic must be at least 2 characters").max(80),
  market: z.literal("US").default("US"),
  lookbackDays: z.number().int().min(7).max(730).default(90),
  maxCandidates: z.number().int().min(3).max(50).default(15),
});

export async function POST(request: NextRequest) {
  try {
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

    const parseResult = ResearchRequestSchema.safeParse(body);
    if (!parseResult.success) {
      return NextResponse.json(
        {
          success: false,
          error: {
            code: "VALIDATION_FAILED",
            message: "Invalid research parameters",
            details: parseResult.error.format(),
          },
        },
        { status: 400 }
      );
    }

    const { topic, market, lookbackDays, maxCandidates } = parseResult.data;

    const result = await runEvergreenProductResearch({
      topic,
      market,
      lookbackDays,
      maxCandidates,
      workspaceId: context.workspaceId,
      signal: request.signal,
    });

    return NextResponse.json({
      success: true,
      data: result,
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
          code: "RESEARCH_EXECUTION_FAILED",
          message: err.message || "An unexpected error occurred during evergreen product research.",
        },
      },
      { status: 500 }
    );
  }
}
