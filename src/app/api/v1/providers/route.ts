import { NextResponse } from "next/server";
import { listResearchProviders } from "@/services/providers/registry";

export async function GET() {
  try {
    const providers = await listResearchProviders();
    return NextResponse.json({
      success: true,
      data: providers,
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
          code: "PROVIDER_ERROR",
          message: error.message || "Failed to list providers",
        },
      },
      { status: 500 }
    );
  }
}
