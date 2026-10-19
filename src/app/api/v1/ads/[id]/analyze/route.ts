import { NextRequest, NextResponse } from "next/server";
import { analyzeAdCreative } from "@/services/ai/creativeAnalyzer";

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params;
    const analysis = await analyzeAdCreative(id);

    return NextResponse.json({
      success: true,
      data: analysis,
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
          code: "ANALYSIS_FAILED",
          message: error.message || "Failed to analyze ad creative",
        },
      },
      { status: 500 }
    );
  }
}
