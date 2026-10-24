import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import {
  resolveAuthorizedResearchContext,
  assertProductWorkspaceAccess,
  ResearchAuthError,
} from "@/services/research/researchAuthService";
import {
  calculateOrderEconomics,
  compareEconomicsScenarios,
  evaluateEconomicsEligibility,
  ProductEconomicsScenarioInput,
  ProductEconomicsScenarioResult,
} from "@/lib/economics";
import { createResearchEvidence } from "@/services/research/evidenceService";

export async function GET(
  request: NextRequest,
  props: { params: Promise<{ id: string }> }
) {
  try {
    const context = await resolveAuthorizedResearchContext(request);
    const { id: productId } = await props.params;

    await assertProductWorkspaceAccess(productId, context);

    const savedScenarios = await prisma.productEconomicsScenario.findMany({
      where: { productId },
      orderBy: { createdAt: "desc" },
    });

    const parsedResults: ProductEconomicsScenarioResult[] = [];
    for (const s of savedScenarios) {
      try {
        if (s.outputsJson) {
          parsedResults.push(JSON.parse(s.outputsJson));
        }
      } catch {
        // ignore parse error
      }
    }

    const comparison = compareEconomicsScenarios(parsedResults);

    return NextResponse.json({
      success: true,
      data: {
        savedScenarios,
        comparison,
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
    console.error("[Get Economics Error]:", err);
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

    const body: ProductEconomicsScenarioInput = await request.json();

    const result = calculateOrderEconomics(body);
    const eligibility = evaluateEconomicsEligibility(result);

    const scenario = await prisma.productEconomicsScenario.create({
      data: {
        workspaceId: context.workspaceId,
        productId,
        scenarioName: body.scenarioName || "Custom Scenario",
        inputsJson: JSON.stringify(body),
        outputsJson: JSON.stringify(result),
        assumptionProvenanceJson: JSON.stringify(body.sourceProvenance || {}),
        calculationVersion: "11.4.0",
      },
    });

    // Record evidence record for contribution margin
    if (result.contributionBeforeAds != null) {
      await createResearchEvidence(
        {
          subjectType: "PRODUCT",
          subjectId: productId,
          pillar: "ECONOMICS",
          claim: `Estimated order contribution before ads: $${result.contributionBeforeAds.toFixed(2)} (Break-even CPA $${result.breakEvenCpa?.toFixed(2) ?? 0})`,
          observedValue: String(result.contributionBeforeAds),
          observationMethod: "MODEL_INFERENCE",
          classification: "USER_ESTIMATED",
          sourceContentRef: `Selling: $${body.sellingPricePerUnit}, Cost: $${body.supplierCostPerUnit}`,
        },
        context
      );
    }

    return NextResponse.json({
      success: true,
      data: {
        scenario,
        result,
        eligibility,
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
    console.error("[Save Economics Scenario Error]:", err);
    return NextResponse.json(
      { success: false, error: err?.message || "Internal server error" },
      { status: 500 }
    );
  }
}
