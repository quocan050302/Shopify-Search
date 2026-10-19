import { NextResponse } from "next/server";
import { auditResearchDataIntegrity } from "@/services/ads/adService";

export async function GET() {
  try {
    const auditResult = await auditResearchDataIntegrity();

    return NextResponse.json({
      success: true,
      data: auditResult,
      meta: {
        timestamp: new Date().toISOString(),
        version: "v1",
        note: "Audit is read-only — no data is modified. Reported issues require manual remediation.",
      },
    });
  } catch (error: any) {
    return NextResponse.json(
      {
        success: false,
        error: {
          code: "AUDIT_FAILED",
          message: error.message || "Data integrity audit failed",
          retryable: true,
          timestamp: new Date().toISOString(),
        },
      },
      { status: 500 }
    );
  }
}
