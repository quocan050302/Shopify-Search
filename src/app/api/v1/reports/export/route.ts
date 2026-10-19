import { NextRequest, NextResponse } from "next/server";
import { exportResearchReport } from "@/services/tracking/trackingService";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const entityType = body.entityType === "products" ? "products" : "ads";

    const csvData = await exportResearchReport(entityType);

    return new NextResponse(csvData, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="swai-${entityType}-research-${Date.now()}.csv"`,
      },
    });
  } catch (error: any) {
    return NextResponse.json(
      {
        success: false,
        error: {
          code: "EXPORT_FAILED",
          message: error.message || "Failed to generate research export",
        },
      },
      { status: 500 }
    );
  }
}
