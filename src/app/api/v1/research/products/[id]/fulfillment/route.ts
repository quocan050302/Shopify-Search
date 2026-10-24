import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import {
  resolveAuthorizedResearchContext,
  assertProductWorkspaceAccess,
  ResearchAuthError,
} from "@/services/research/researchAuthService";
import {
  recordSupplierQuote,
  calculateFulfillmentRisk,
  saveFulfillmentAssessment,
  SupplierQuoteInput,
  FulfillmentEvidence,
} from "@/services/research/fulfillmentAssessmentService";

export async function GET(
  request: NextRequest,
  props: { params: Promise<{ id: string }> }
) {
  try {
    const context = await resolveAuthorizedResearchContext(request);
    const { id: productId } = await props.params;

    await assertProductWorkspaceAccess(productId, context);

    const quotes = await prisma.supplierQuote.findMany({
      where: { productId },
      orderBy: { quoteDate: "desc" },
    });

    const assessment = await prisma.fulfillmentAssessment.findFirst({
      where: { productId },
      orderBy: { createdAt: "desc" },
    });

    let identifiedRisks = [];
    let criticalGaps = [];
    try {
      if (assessment?.risksJson) identifiedRisks = JSON.parse(assessment.risksJson);
      if (assessment?.criticalGapsJson) criticalGaps = JSON.parse(assessment.criticalGapsJson);
    } catch {
      // ignore parse error
    }

    return NextResponse.json({
      success: true,
      data: {
        quotes,
        assessment: assessment ? { ...assessment, identifiedRisks, criticalGaps } : null,
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
    console.error("[Get Fulfillment Error]:", err);
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

    const body = await request.json();
    const { action = "ADD_QUOTE", quote, fulfillmentEvidence } = body;

    let createdQuote = null;
    if (action === "ADD_QUOTE" || quote) {
      const quoteInput: SupplierQuoteInput = {
        productId,
        supplierName: quote?.supplierName || body.supplierName,
        productIdentifier: quote?.productIdentifier || body.productIdentifier,
        currency: quote?.currency || body.currency || "USD",
        unitCost: parseFloat(quote?.unitCost ?? body.unitCost),
        moq: parseInt(quote?.moq ?? body.moq ?? "1", 10),
        processingTimeDays: quote?.processingTimeDays ?? body.processingTimeDays,
        shippingCostEstimate: quote?.shippingCostEstimate ?? body.shippingCostEstimate,
        shippingLeadTimeDays: quote?.shippingLeadTimeDays ?? body.shippingLeadTimeDays,
        destinationCountry: quote?.destinationCountry || body.destinationCountry || "US",
        quoteSource: quote?.quoteSource || body.quoteSource || "USER_ESTIMATE",
        evidenceReference: quote?.evidenceReference || body.evidenceReference,
      };

      createdQuote = await recordSupplierQuote(quoteInput, context);
    }

    let savedAssessment = null;
    if (fulfillmentEvidence || action === "EVALUATE_FULFILLMENT") {
      const ev: FulfillmentEvidence = fulfillmentEvidence || body;
      const riskResult = calculateFulfillmentRisk(ev);
      savedAssessment = await saveFulfillmentAssessment(productId, riskResult, ev, context);
    }

    return NextResponse.json({
      success: true,
      data: {
        quote: createdQuote,
        assessment: savedAssessment,
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
    console.error("[Post Fulfillment Error]:", err);
    return NextResponse.json(
      { success: false, error: err?.message || "Internal server error" },
      { status: 500 }
    );
  }
}
