import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import {
  resolveAuthorizedResearchContext,
  assertProductWorkspaceAccess,
  ResearchAuthError,
} from "@/services/research/researchAuthService";
import {
  buildProductOpportunityInput,
  calculateOpportunityAssessment,
  evaluateSmallTestReadiness,
  explainOpportunityRecommendation,
  saveProductOpportunityAssessment,
  SixPillarOpportunityInput,
} from "@/services/research/opportunityAssessmentService";
import { ProductEconomicsScenarioResult } from "@/lib/economics";

export async function GET(
  request: NextRequest,
  props: { params: Promise<{ id: string }> }
) {
  try {
    const context = await resolveAuthorizedResearchContext(request);
    const { id: productId } = await props.params;

    await assertProductWorkspaceAccess(productId, context);

    const assessment = await prisma.productOpportunityAssessment.findFirst({
      where: { productId },
      orderBy: { createdAt: "desc" },
    });

    if (!assessment) {
      return NextResponse.json({
        success: true,
        data: null,
        message: "No opportunity assessment calculated yet",
      });
    }

    let pillars = null;
    let strengths = [];
    let risks = [];
    let missingCriticalEvidence = [];

    try {
      if (assessment.pillarsJson) pillars = JSON.parse(assessment.pillarsJson);
      if (assessment.strengthsJson) strengths = JSON.parse(assessment.strengthsJson);
      if (assessment.risksJson) risks = JSON.parse(assessment.risksJson);
      if (assessment.missingCriticalEvidenceJson) missingCriticalEvidence = JSON.parse(assessment.missingCriticalEvidenceJson);
    } catch (parseErr) {
      console.warn("Assessment JSON parse error:", parseErr);
    }

    const hydratedAssessment = {
      ...assessment,
      pillars,
      strengths,
      risks,
      missingCriticalEvidence,
    };

    const readinessDecision = evaluateSmallTestReadiness(hydratedAssessment as any);
    const explanation = explainOpportunityRecommendation(hydratedAssessment as any);

    return NextResponse.json({
      success: true,
      data: {
        assessment: hydratedAssessment,
        readinessDecision,
        explanation,
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
    console.error("[Get Opportunity Error]:", err);
    return NextResponse.json(
      { success: false, error: err?.message || "Internal server error" },
      { status: 500 }
    );
  }
}

export async function POST(
  request: NextRequest,
  props: { params: Promise<{ id: string }> }
) {
  try {
    const context = await resolveAuthorizedResearchContext(request);
    const { id: productId } = await props.params;

    await assertProductWorkspaceAccess(productId, context);

    const sixPillarInput = await buildProductOpportunityInput(productId, context);
    const opportunityAssessment = calculateOpportunityAssessment(sixPillarInput);
    const saved = await saveProductOpportunityAssessment(productId, opportunityAssessment, context);

    const readinessDecision = evaluateSmallTestReadiness(opportunityAssessment);
    const explanation = explainOpportunityRecommendation(opportunityAssessment);

    return NextResponse.json({
      success: true,
      data: {
        assessment: opportunityAssessment,
        record: saved,
        readinessDecision,
        explanation,
      },
      meta: {
        timestamp: new Date().toISOString(),
        version: "11.4.1",
      },
    });
  } catch (err: any) {
    if (err instanceof ResearchAuthError) {
      return NextResponse.json(
        { success: false, error: err.message, code: err.code },
        { status: err.statusCode }
      );
    }
    console.error("[Recalculate Opportunity Error]:", err);
    return NextResponse.json(
      { success: false, error: err?.message || "Internal server error" },
      { status: 500 }
    );
  }
}
