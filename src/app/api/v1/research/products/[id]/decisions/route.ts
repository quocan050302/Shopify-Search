import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import {
  resolveAuthorizedResearchContext,
  assertProductWorkspaceAccess,
  ResearchAuthError,
} from "@/services/research/researchAuthService";

export async function POST(
  request: NextRequest,
  props: { params: Promise<{ id: string }> }
) {
  try {
    const context = await resolveAuthorizedResearchContext(request);
    const { id: productId } = await props.params;

    await assertProductWorkspaceAccess(productId, context);

    const body = await request.json();
    const { decision, notes = "" } = body;

    const validDecisions = ["RESEARCHING", "SHORTLISTED", "TEST_CANDIDATE", "REJECTED", "ARCHIVED"];
    if (!decision || !validDecisions.includes(decision)) {
      return NextResponse.json(
        { success: false, error: `Valid decision required: ${validDecisions.join(", ")}` },
        { status: 400 }
      );
    }

    // Check latest algorithmic assessment
    const latestAssessment = await prisma.productOpportunityAssessment.findFirst({
      where: { productId },
      orderBy: { createdAt: "desc" },
    });

    const algorithmRecommendation = latestAssessment?.recommendation || "RESEARCH_MORE";
    const isOverride =
      decision === "TEST_CANDIDATE" && algorithmRecommendation !== "TEST_CANDIDATE";

    const overrideNotice = isOverride
      ? "[USER OVERRIDE — ALGORITHMIC REQUIREMENTS NOT MET]"
      : "";

    const combinedNotes = `${overrideNotice} ${notes}`.trim();

    const decisionRecord = await prisma.researchDecision.create({
      data: {
        productId,
        decision,
        notes: combinedNotes,
        decidedAt: new Date(),
      },
    });

    return NextResponse.json({
      success: true,
      data: {
        decision: decisionRecord,
        isOverride,
        algorithmRecommendation,
        userDecision: decision,
        overrideStatus: isOverride
          ? "USER OVERRIDE — REQUIREMENTS NOT MET"
          : "ALIGNED_WITH_ALGORITHM",
      },
      meta: {
        timestamp: new Date().toISOString(),
        version: "11.4.0",
      },
    });
  } catch (err: any) {
    if (err instanceof ResearchAuthError) {
      return NextResponse.json(
        { success: false, error: err.message, code: err.code },
        { status: err.statusCode }
      );
    }
    console.error("[Record Research Decision Error]:", err);
    return NextResponse.json(
      { success: false, error: err?.message || "Internal server error" },
      { status: 500 }
    );
  }
}
