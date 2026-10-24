import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { discoveryOrchestrator } from "@/services/discovery/discoveryOrchestrator";

const CreateMetaRequestSchema = z.object({
  workspaceId: z.string().optional(),
  keywords: z.array(z.string().min(1)).min(1, "At least one keyword is required"),
  market: z.string().default("US"),
  requestedLimit: z.number().int().min(1).max(100).default(25),
  creativePreference: z.enum(["VIDEO", "IMAGE", "ALL"]).default("ALL").optional(),
  activeStatus: z.enum(["ACTIVE", "INACTIVE", "ALL"]).default("ACTIVE").optional(),
  advertiserPageId: z.string().optional(),
  launchWithinDays: z.union([z.literal(7), z.literal(14), z.literal(30), z.literal(60), z.literal(90), z.literal(180)]).optional(),
});

/**
 * POST /api/v1/discovery/meta/requests
 * Creates a new Meta Ad Library research job executed locally by meta-ads-collector.
 * Returns HTTP 202 Accepted with the pending run ID.
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const validated = CreateMetaRequestSchema.parse(body);

    const defaultWorkspace = await prisma.workspace.findFirst({ select: { id: true } });
    const workspaceId = validated.workspaceId || defaultWorkspace?.id || "default-workspace";

    const job = await discoveryOrchestrator.createDiscoveryJob({
      workspaceId,
      platform: "META",
      providerId: "meta-ads-collector",
      market: validated.market.toUpperCase(),
      keywords: validated.keywords,
      industries: [],
      objectives: [],
      searchWindowDays: 30,
      sortBy: "relevance",
      requestedLimit: validated.requestedLimit,
      pageSize: Math.min(25, validated.requestedLimit),
      runMode: "MANUAL",
      launchWithinDays: validated.launchWithinDays,
      creativePreference: validated.creativePreference,
      activeStatus: validated.activeStatus,
      advertiserPageId: validated.advertiserPageId,
    });

    return NextResponse.json(
      {
        success: true,
        runId: job.jobId,
        syncJobId: job.syncJobId,
        status: job.status,
        provider: "meta-ads-collector",
        market: validated.market.toUpperCase(),
        requestedLimit: validated.requestedLimit,
        createdAt: new Date().toISOString(),
      },
      { status: 202 }
    );
  } catch (err: unknown) {
    if (err instanceof z.ZodError) {
      return NextResponse.json(
        {
          success: false,
          error: "INVALID_REQUEST",
          details: err.issues.map((i) => i.message),
        },
        { status: 400 }
      );
    }
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      {
        success: false,
        error: "INTERNAL_ERROR",
        message: msg,
      },
      { status: 500 }
    );
  }
}

/**
 * GET /api/v1/discovery/meta/requests
 * Lists historical and active Meta discovery runs for the authorized workspace.
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const status = searchParams.get("status");
    const page = Math.max(1, parseInt(searchParams.get("page") || "1", 10));
    const pageSize = Math.min(50, Math.max(1, parseInt(searchParams.get("pageSize") || "20", 10)));

    const where: any = {
      providerId: { in: ["meta-ads-collector", "muse-ad-library"] },
    };

    if (status && status !== "ALL") {
      where.status = status;
    }

    const [total, runs] = await Promise.all([
      prisma.discoveryRun.count({ where }),
      prisma.discoveryRun.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: {
          runAds: {
            select: { id: true },
          },
        },
      }),
    ]);

    const items = runs.map((r) => {
      let parsedQuery: any = {};
      try {
        parsedQuery = JSON.parse(r.queryConfigJson);
      } catch {}

      return {
        id: r.id,
        jobId: r.jobId,
        providerId: r.providerId,
        status: r.status,
        keywords: parsedQuery.keywords || [],
        market: parsedQuery.market || "US",
        requestedLimit: r.requestedLimit,
        actualRetrievedCount: r.actualRetrievedCount,
        validCount: r.validCount,
        newUniqueCount: r.newUniqueCount,
        existingDuplicateCount: r.existingDuplicateCount,
        linkedAdsCount: r.runAds?.length || 0,
        errorMessage: r.errorMessage,
        errorCategory: r.errorCategory,
        startedAt: r.startedAt,
        finishedAt: r.finishedAt,
        createdAt: r.createdAt,
      };
    });

    return NextResponse.json({
      success: true,
      data: items,
      pagination: {
        page,
        pageSize,
        total,
        totalPages: Math.ceil(total / pageSize),
      },
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      {
        success: false,
        error: "FAILED_TO_LIST_REQUESTS",
        message: msg,
      },
      { status: 500 }
    );
  }
}
