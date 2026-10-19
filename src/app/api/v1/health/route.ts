import { NextResponse } from "next/server";
import { getSystemHealth } from "@/services/ops/systemHealth";

export async function GET() {
  try {
    const health = await getSystemHealth();
    return NextResponse.json({
      success: true,
      data: health,
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
          code: "INTERNAL_ERROR",
          message: error.message || "Failed to retrieve system health",
        },
      },
      { status: 500 }
    );
  }
}
