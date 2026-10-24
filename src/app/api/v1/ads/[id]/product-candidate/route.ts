import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { saveAdProductCandidate } from "@/services/products/productService";

const CandidateSchema = z.object({
  workspaceId: z.string().min(1).max(100).optional(),
  title: z.string().min(1).max(300).optional(),
  category: z.string().min(1).max(100).optional(),
  description: z.string().max(3000).optional(),
  productUrl: z
    .string()
    .max(2000)
    .refine((val) => !val || /^https?:\/\/[^\s$.?#].[^\s]*$/i.test(val), {
      message: "productUrl must be a valid HTTP or HTTPS URL",
    })
    .optional(),
  storeDomain: z
    .string()
    .max(255)
    .regex(/^[a-zA-Z0-9.-]+$/, { message: "Invalid store domain" })
    .optional(),
  observedSellingPrice: z
    .number({ message: "Price must be a number" })
    .finite({ message: "Price must be a finite number (NaN and Infinity not allowed)" })
    .nonnegative({ message: "Price cannot be negative" })
    .max(100000, { message: "Price exceeds reasonable threshold" })
    .nullable()
    .optional(),
  estimatedSupplierCost: z
    .number({ message: "Supplier cost must be a number" })
    .finite({ message: "Supplier cost must be a finite number (NaN and Infinity not allowed)" })
    .nonnegative({ message: "Supplier cost cannot be negative" })
    .max(100000, { message: "Supplier cost exceeds reasonable threshold" })
    .nullable()
    .optional(),
  shippingCost: z
    .number({ message: "Shipping cost must be a number" })
    .finite({ message: "Shipping cost must be a finite number" })
    .nonnegative({ message: "Shipping cost cannot be negative" })
    .max(10000, { message: "Shipping cost exceeds reasonable threshold" })
    .nullable()
    .optional(),
  platformFees: z
    .number({ message: "Platform fees must be a number" })
    .finite({ message: "Platform fees must be a finite number" })
    .nonnegative({ message: "Platform fees cannot be negative" })
    .max(10000, { message: "Platform fees exceed reasonable threshold" })
    .nullable()
    .optional(),
  returnAllowancePercent: z
    .number({ message: "Return allowance must be a number" })
    .finite({ message: "Return allowance must be a finite number" })
    .min(0, { message: "Return allowance cannot be negative" })
    .max(100, { message: "Return allowance cannot exceed 100%" })
    .nullable()
    .optional(),
  targetProfitPerUnit: z
    .number({ message: "Target profit must be a number" })
    .finite({ message: "Target profit must be a finite number" })
    .nonnegative({ message: "Target profit cannot be negative" })
    .max(10000, { message: "Target profit exceeds threshold" })
    .nullable()
    .optional(),
  isConfirmedByUser: z.boolean().optional(),
  costVerificationSource: z
    .enum(["USER_ESTIMATE", "SUPPLIER_INVOICE", "USER_VERIFIED_QUOTE", "UNVERIFIED"])
    .nullable()
    .optional(),
  sourceStatus: z.enum(["USER_ENTERED", "STOREFRONT_VERIFIED", "UNVERIFIED"]).optional(),
  checklist: z
    .object({
      demandEvidence: z.enum(["UNKNOWN", "UNVERIFIED", "VERIFIED"]).or(z.boolean()).optional(),
      demandEvidenceSource: z.string().max(500).nullable().optional(),
      competitionLevel: z.enum(["UNKNOWN", "LOW", "MODERATE", "HIGH", "SATURATED"]).optional(),
      creativeAppeal: z.enum(["UNKNOWN", "STRONG", "MODERATE", "WEAK"]).optional(),
      differentiationFeasibility: z.enum(["UNKNOWN", "VIABLE", "UNCERTAIN", "NOT_VIABLE"]).or(z.boolean()).optional(),
      deliveryFeasibility: z.enum(["UNKNOWN", "CONFIRMED", "UNCERTAIN", "HIGH_RISK"]).or(z.boolean()).optional(),
      returnRisk: z.enum(["UNKNOWN", "LOW", "MEDIUM", "HIGH"]).optional(),
    })
    .optional(),
  userDecision: z.enum(["READY_FOR_SMALL_TEST", "RESEARCH_MORE", "REJECTED"]).nullable().optional(),
  recommendation: z.enum(["READY_FOR_SMALL_TEST", "RESEARCH_MORE", "REJECTED"]).nullable().optional(),
  notes: z.string().max(3000).optional(),
});

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params;

    // Reject invalid ad ID format
    if (!id || typeof id !== "string" || id.trim().length === 0) {
      return NextResponse.json(
        {
          success: false,
          error: {
            code: "INVALID_AD_ID",
            message: "Missing or invalid advertisement ID parameter.",
          },
        },
        { status: 400 }
      );
    }

    const rawBody = await request.json().catch(() => null);
    if (!rawBody || typeof rawBody !== "object") {
      return NextResponse.json(
        {
          success: false,
          error: {
            code: "INVALID_JSON_BODY",
            message: "Request body must be a valid JSON object.",
          },
        },
        { status: 400 }
      );
    }

    // 1. Zod Validation (rejection of invalid costs, NaN, Infinity, malicious URLs)
    const parseResult = CandidateSchema.safeParse(rawBody);
    if (!parseResult.success) {
      return NextResponse.json(
        {
          success: false,
          error: {
            code: "VALIDATION_FAILED",
            message: "Invalid input values provided for product candidate.",
            details: parseResult.error.flatten(),
          },
        },
        { status: 400 }
      );
    }

    const validated = parseResult.data;

    // 2. Authorization and workspace ownership check
    const headerWorkspaceId = request.headers.get("x-workspace-id");
    const requestedWorkspaceId = headerWorkspaceId || validated.workspaceId;

    let workspace = null;
    if (requestedWorkspaceId) {
      workspace = await prisma.workspace.findUnique({
        where: { id: requestedWorkspaceId },
      });
      if (!workspace) {
        return NextResponse.json(
          {
            success: false,
            error: {
              code: "UNAUTHORIZED_WORKSPACE",
              message: "The requested workspace does not exist or access is unauthorized.",
            },
          },
          { status: 403 }
        );
      }
    } else {
      workspace = await prisma.workspace.findFirst();
      if (!workspace) {
        return NextResponse.json(
          {
            success: false,
            error: {
              code: "NO_WORKSPACE_CONFIGURED",
              message: "No accessible workspace is configured.",
            },
          },
          { status: 403 }
        );
      }
    }

    // 3. Verify selected ad belongs to an accessible workspace
    const ad = await prisma.competitorAd.findUnique({
      where: { id },
      include: {
        runAds: true,
        watchlistItems: {
          include: { watchlist: true },
        },
      },
    });

    if (!ad) {
      return NextResponse.json(
        {
          success: false,
          error: {
            code: "AD_NOT_FOUND",
            message: `Advertisement with ID ${id} was not found.`,
          },
        },
        { status: 404 }
      );
    }

    const associatedWorkspaceIds = new Set<string>();
    for (const runAd of ad.runAds) {
      if (runAd.workspaceId) associatedWorkspaceIds.add(runAd.workspaceId);
    }
    for (const item of ad.watchlistItems) {
      if (item.watchlist?.workspaceId) associatedWorkspaceIds.add(item.watchlist.workspaceId);
    }

    if (
      associatedWorkspaceIds.size > 0 &&
      !associatedWorkspaceIds.has(workspace.id) &&
      !associatedWorkspaceIds.has("default-workspace")
    ) {
      return NextResponse.json(
        {
          success: false,
          error: {
            code: "FORBIDDEN_WORKSPACE_AD",
            message: "The requested advertisement does not belong to your accessible workspace.",
          },
        },
        { status: 403 }
      );
    }

    // 4. Save Candidate inside transaction
    const result = await saveAdProductCandidate({
      adId: id,
      title: validated.title,
      category: validated.category,
      description: validated.description,
      productUrl: validated.productUrl,
      storeDomain: validated.storeDomain,
      observedSellingPrice: validated.observedSellingPrice ?? null,
      estimatedSupplierCost: validated.estimatedSupplierCost ?? null,
      shippingCost: validated.shippingCost ?? null,
      platformFees: validated.platformFees ?? null,
      returnAllowancePercent: validated.returnAllowancePercent ?? null,
      targetProfitPerUnit: validated.targetProfitPerUnit ?? null,
      isConfirmedByUser: validated.isConfirmedByUser,
      costVerificationSource: validated.costVerificationSource,
      sourceStatus: validated.sourceStatus || "USER_ENTERED",
      checklist: validated.checklist,
      userDecision: validated.userDecision || validated.recommendation,
      notes: validated.notes,
    });

    return NextResponse.json({
      success: true,
      data: result,
      meta: {
        workspaceId: workspace.id,
        timestamp: new Date().toISOString(),
        note: "Product research recommendation is an evidence-based assessment, not a guarantee of sales or profit.",
      },
    });
  } catch (error: any) {
    // 5. Do not expose raw internal errors to the client
    console.error("API error in POST /api/v1/ads/[id]/product-candidate:", error);
    return NextResponse.json(
      {
        success: false,
        error: {
          code: "CANDIDATE_SAVE_FAILED",
          message: error?.message || "Failed to save product candidate.",
        },
      },
      { status: 500 }
    );
  }
}
