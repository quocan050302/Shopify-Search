import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import {
  resolveAuthorizedResearchContext,
  assertProductWorkspaceAccess,
  ResearchAuthError,
} from "@/services/research/researchAuthService";
import {
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

    // 1. Load product
    const product = await prisma.researchProduct.findUnique({
      where: { id: productId },
      include: {
        adLinks: { include: { ad: { include: { mediaAssets: true } } } },
      },
    });

    if (!product) {
      return NextResponse.json(
        { success: false, error: "Product not found" },
        { status: 404 }
      );
    }

    // 2. Load latest offer snapshots
    const offerSnapshots = await prisma.competitorOfferSnapshot.findMany({
      where: { productId },
      orderBy: { observedAt: "desc" },
      take: 10,
    });

    // 3. Load latest landing page & funnel
    const landingPage = await prisma.landingPageSnapshot.findFirst({
      where: { productId },
      orderBy: { observedAt: "desc" },
    });

    let funnelAssessment = null;
    if (landingPage?.croSignalsJson) {
      try {
        const cro = JSON.parse(landingPage.croSignalsJson);
        const match = landingPage.messageMatchJson ? JSON.parse(landingPage.messageMatchJson) : null;
        funnelAssessment = {
          observedStrengths: cro.aboveTheFold?.strengths || [],
          observedWeaknesses: cro.aboveTheFold?.weaknesses || [],
          potentialFriction: cro.potentialFriction || [],
          missingEvidence: landingPage.warningsJson ? JSON.parse(landingPage.warningsJson) : [],
          confidence: 0.8,
          croReadiness: cro.croReadinessScore || 65,
          analysisVersion: "11.4.0",
        };
      } catch {
        // ignore parse error
      }
    }

    // 4. Load economics scenarios
    const savedEconomics = await prisma.productEconomicsScenario.findMany({
      where: { productId },
      orderBy: { createdAt: "desc" },
    });

    const economicsScenarios: ProductEconomicsScenarioResult[] = [];
    for (const e of savedEconomics) {
      try {
        if (e.outputsJson) economicsScenarios.push(JSON.parse(e.outputsJson));
      } catch {}
    }

    // 5. Load fulfillment assessment
    const fulfillmentRecord = await prisma.fulfillmentAssessment.findFirst({
      where: { productId },
      orderBy: { createdAt: "desc" },
    });

    let fulfillmentAssessment = null;
    if (fulfillmentRecord) {
      try {
        fulfillmentAssessment = {
          overallRiskLevel: fulfillmentRecord.overallRiskLevel as any,
          identifiedRisks: fulfillmentRecord.risksJson ? JSON.parse(fulfillmentRecord.risksJson) : [],
          criticalGaps: fulfillmentRecord.criticalGapsJson ? JSON.parse(fulfillmentRecord.criticalGapsJson) : [],
          leadTimeAssessment: "Lead times evaluated",
          complianceStatus: "Evaluated",
          riskScore: fulfillmentRecord.overallRiskLevel === "HIGH" ? 75 : 25,
        };
      } catch {}
    }

    // Build Six-Pillar Input
    const sixPillarInput: SixPillarOpportunityInput = {
      productId,
      productEvidence: {
        productTitle: product.title,
        category: product.category,
        problemSolved: product.description || "Identified consumer utility",
        customerPainPointClarity: product.description ? "CLEAR" : "MODERATE",
        identityConfidence: "EXACT",
      },
      creativeEvidence: {
        adCount: product.adLinks.length,
        hasVideoDemonstration: product.adLinks.some((l) =>
          l.ad.mediaAssets?.some((m) => m.aspectRatio === "9:16" || m.durationSeconds)
        ),
        clearCtaObserved: true,
      },
      offerSnapshots,
      funnelAssessment: funnelAssessment as any,
      economicsScenarios,
      fulfillmentAssessment,
    };

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
    console.error("[Recalculate Opportunity Error]:", err);
    return NextResponse.json(
      { success: false, error: err?.message || "Internal server error" },
      { status: 500 }
    );
  }
}
