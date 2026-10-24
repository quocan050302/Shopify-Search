import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import {
  resolveAuthorizedResearchContext,
  assertProductWorkspaceAccess,
  ResearchAuthError,
} from "@/services/research/researchAuthService";
import { z } from "zod";
import {
  recordSupplierQuote,
  calculateFulfillmentRisk,
  saveFulfillmentAssessment,
  SupplierQuoteInput,
  FulfillmentEvidence,
} from "@/services/research/fulfillmentAssessmentService";

const SupplierQuoteSchema = z.object({
  supplierName: z.string().min(1, "Supplier name is required"),
  productIdentifier: z.string().optional(),
  currency: z.string().default("USD"),
  unitCost: z.coerce.number().finite().positive("Unit cost must be greater than 0"),
  moq: z.coerce.number().int().positive().default(1),
  processingTimeDays: z.coerce.number().int().nonnegative().optional(),
  shippingCostEstimate: z.coerce.number().finite().nonnegative().optional(),
  shippingLeadTimeDays: z.coerce.number().int().nonnegative().optional(),
  destinationCountry: z.string().default("US"),
  quoteSource: z
    .enum(["USER_ESTIMATE", "SUPPLIER_INVOICE", "PLATFORM_QUOTE", "THIRD_PARTY_AUDIT"])
    .default("USER_ESTIMATE"),
  evidenceReference: z.string().optional(),
});

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
      const rawQuote = quote || body;
      const parseResult = SupplierQuoteSchema.safeParse(rawQuote);
      if (!parseResult.success) {
        return NextResponse.json(
          { success: false, error: "Invalid supplier quote inputs", details: parseResult.error.format() },
          { status: 400 }
        );
      }
      const validQuote = parseResult.data;
      const quoteInput: SupplierQuoteInput = {
        productId,
        supplierName: validQuote.supplierName,
        productIdentifier: validQuote.productIdentifier,
        currency: validQuote.currency,
        unitCost: validQuote.unitCost,
        moq: validQuote.moq,
        processingTimeDays: validQuote.processingTimeDays,
        shippingCostEstimate: validQuote.shippingCostEstimate,
        shippingLeadTimeDays: validQuote.shippingLeadTimeDays,
        destinationCountry: validQuote.destinationCountry,
        quoteSource: validQuote.quoteSource,
        evidenceReference: validQuote.evidenceReference,
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
