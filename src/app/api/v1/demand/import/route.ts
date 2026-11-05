/**
 * POST /api/v1/demand/import
 * Imports product demand observations (e.g. from Google Trends CSV export).
 *
 * GET /api/v1/demand/products/:id/history
 * Returns demand observation history for a product.
 */
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import {
  validateAndParseGoogleTrendsCsv,
  verifyStoredCsvFile,
  verifyDemandObservationAgainstRawCsv,
} from "@/services/kh02/demand/googleTrendsCsvValidator";
import {
  executeDemandObservationBatchImport,
  BatchImportError,
} from "@/services/kh02/demand/demandObservationBatchImport";
import {
  resolveAuthorizedResearchContext,
  ResearchAuthError,
} from "@/services/research/researchAuthService";
import { buildAuthorizedProductWhere } from "@/services/research/authorizedScopeHelpers";

export interface DemandImportRow {
  keyword: string;
  region: string;
  periodStart: string; // ISO date string
  periodEnd: string;
  demandValue: number | null; // 0–100 relative interest, or null
  source: "GOOGLE_TRENDS_CSV" | "USER_MANUAL" | "PROVIDER_API";
  evidenceReference?: string;
}

export interface DemandImportPayload {
  productId: string;
  rows?: DemandImportRow[];
  rawCsv?: string;
  canonicalProductName?: string;
  methodologyVersion?: string;
}

const DEMAND_VALUE_MAX = 100;
const MAX_ROWS_PER_IMPORT = 500;

export async function POST(request: NextRequest) {
  try {
    const authContext = await resolveAuthorizedResearchContext(request);
    const workspaceId = authContext.workspaceId;
    const body: DemandImportPayload = await request.json();

    if (!body.productId || typeof body.productId !== "string") {
      return NextResponse.json(
        { success: false, error: { code: "MISSING_PRODUCT_ID", message: "productId is required." } },
        { status: 400 }
      );
    }

    // Verify product exists within the caller's authorized workspace
    const product = await prisma.researchProduct.findFirst({
      where: {
        id: body.productId,
        ...buildAuthorizedProductWhere(workspaceId),
      },
    });

    if (!product) {
      const existsGlobally = await prisma.researchProduct.findUnique({ where: { id: body.productId } });
      if (existsGlobally) {
        return NextResponse.json(
          {
            success: false,
            error: {
              code: "FORBIDDEN_WORKSPACE_PRODUCT",
              message: `Access denied: Product ${body.productId} belongs to another workspace.`,
            },
          },
          { status: 403 }
        );
      }
      return NextResponse.json(
        { success: false, error: { code: "PRODUCT_NOT_FOUND", message: `Product ${body.productId} not found.` } },
        { status: 404 }
      );
    }

    // Direct Google Trends CSV import path
    if (typeof body.rawCsv === "string" && body.rawCsv.trim().length > 0) {
      const canonicalName = body.canonicalProductName || product.title;
      const validation = validateAndParseGoogleTrendsCsv(body.rawCsv, {
        expectedKeyword: canonicalName,
      });

      if (!validation.valid) {
        return NextResponse.json(
          {
            success: false,
            error: {
              code: "INVALID_GOOGLE_TRENDS_CSV",
              message: "Google Trends Explore CSV validation failed.",
              details: validation.errors,
            },
          },
          { status: 422 }
        );
      }

      const importRes = await executeDemandObservationBatchImport({
        productId: body.productId,
        workspaceId,
        source: "GOOGLE_TRENDS_CSV",
        region: validation.region || "US",
        evidenceReference: validation.evidenceReference,
        methodologyVersion: "google_trends_explore_csv_v1",
        strictProvenance: true,
        points: validation.dataPoints.map((pt) => ({
          keyword: pt.keyword,
          region: pt.region,
          periodStart: pt.periodStart,
          periodEnd: pt.periodEnd,
          demandValue: pt.demandValue,
          evidenceReference: validation.evidenceReference,
          methodologyVersion: "google_trends_explore_csv_v1",
        })),
      });

      return NextResponse.json({
        success: true,
        data: {
          productId: body.productId,
          source: "GOOGLE_TRENDS_CSV",
          sha256Checksum: validation.sha256Checksum,
          evidenceReference: validation.evidenceReference,
          keyword: validation.keyword,
          region: validation.region,
          startDate: validation.startDate,
          endDate: validation.endDate,
          totalRows: validation.dataPointsCount,
          insertedCount: importRes.insertedCount,
          skippedCount: importRes.skippedCount,
        },
        meta: {
          timestamp: new Date().toISOString(),
          note: "Official Google Trends CSV imported, byte integrity verified (SHA-256), and persisted.",
        },
      });
    }

    if (!Array.isArray(body.rows) || body.rows.length === 0) {
      return NextResponse.json(
        { success: false, error: { code: "EMPTY_ROWS", message: "rows array or rawCsv string must be provided." } },
        { status: 400 }
      );
    }

    if (body.rows.length > MAX_ROWS_PER_IMPORT) {
      return NextResponse.json(
        {
          success: false,
          error: {
            code: "TOO_MANY_ROWS",
            message: `Maximum ${MAX_ROWS_PER_IMPORT} rows per import. Received ${body.rows.length}.`,
          },
        },
        { status: 400 }
      );
    }

    // Reject mixed-source batch (P1-D & B06 requirement)
    const sourcesInBatch = new Set(body.rows.map((r) => r.source));
    if (sourcesInBatch.size > 1) {
      return NextResponse.json(
        {
          success: false,
          error: {
            code: "MIXED_SOURCE_BATCH_REJECTED",
            message: "Heterogeneous per-row sources in a single import batch are not permitted.",
          },
        },
        { status: 422 }
      );
    }

    // Validate and sanitize rows
    const errors: string[] = [];
    const validRows: DemandImportRow[] = [];

    for (let i = 0; i < body.rows.length; i++) {
      const row = body.rows[i];
      const rowIndex = i + 1;

      if (!row.keyword || typeof row.keyword !== "string" || row.keyword.trim().length === 0) {
        errors.push(`Row ${rowIndex}: keyword is required.`);
        continue;
      }

      if (!row.region || typeof row.region !== "string") {
        errors.push(`Row ${rowIndex}: region is required.`);
        continue;
      }

      const pStart = new Date(row.periodStart);
      const pEnd = new Date(row.periodEnd);
      const now = new Date();

      if (isNaN(pStart.getTime()) || isNaN(pEnd.getTime())) {
        errors.push(`Row ${rowIndex}: Invalid periodStart or periodEnd date.`);
        continue;
      }

      if (pStart > now || pEnd > now) {
        errors.push(`Row ${rowIndex}: Period dates cannot be in the future.`);
        continue;
      }

      if (pEnd < pStart) {
        errors.push(`Row ${rowIndex}: periodEnd must be after periodStart.`);
        continue;
      }

      if (row.demandValue !== null) {
        if (typeof row.demandValue !== "number" || row.demandValue < 0 || row.demandValue > DEMAND_VALUE_MAX) {
          errors.push(`Row ${rowIndex}: demandValue must be 0–${DEMAND_VALUE_MAX} or null.`);
          continue;
        }
      }

      const validSources = ["GOOGLE_TRENDS_CSV", "USER_MANUAL", "PROVIDER_API"];
      if (!validSources.includes(row.source)) {
        errors.push(`Row ${rowIndex}: Invalid source "${row.source}".`);
        continue;
      }

      // Exact source-to-row CSV provenance check (B04 & B06 requirement)
      if (row.source === "GOOGLE_TRENDS_CSV") {
        if (!row.evidenceReference) {
          errors.push(`Row ${rowIndex}: evidenceReference is required for GOOGLE_TRENDS_CSV.`);
          continue;
        }
        const hashMatch = row.evidenceReference.match(/\bsha256:([a-f0-9]+)\b/i);
        if (!hashMatch || hashMatch[1].length !== 64) {
          errors.push(`Row ${rowIndex}: Full 64-hex SHA-256 checksum required in evidenceReference.`);
          continue;
        }
        const rowVerify = verifyDemandObservationAgainstRawCsv(row.evidenceReference, {
          keyword: row.keyword,
          region: row.region,
          periodStart: pStart,
          periodEnd: pEnd,
          demandValue: row.demandValue,
          productId: body.productId,
        });
        if (!rowVerify.verified) {
          errors.push(`Row ${rowIndex}: Raw CSV row verification failed: ${rowVerify.reason} (${rowVerify.code})`);
          continue;
        }
      }

      if (row.source === "PROVIDER_API") {
        if (!row.evidenceReference || !/\b(provider-request|serpapi-request|trends-api-request):/i.test(row.evidenceReference)) {
          errors.push(`Row ${rowIndex}: PROVIDER_API row requires verifiable collector receipt descriptor or evidence reference.`);
          continue;
        }
      }

      validRows.push(row);
    }

    if (errors.length > 0) {
      return NextResponse.json(
        {
          success: false,
          error: {
            code: "VALIDATION_FAILED",
            message: `${errors.length} validation error(s).`,
            details: errors.slice(0, 20), // Limit error list
          },
        },
        { status: 422 }
      );
    }

    // Transactional insert observations via executeDemandObservationBatchImport
    const importRes = await executeDemandObservationBatchImport({
      productId: body.productId,
      workspaceId,
      source: validRows[0]?.source || "USER_MANUAL",
      region: validRows[0]?.region || "US",
      methodologyVersion: body.methodologyVersion ?? "1.0",
      strictProvenance: true,
      points: validRows.map((r) => ({
        source: r.source,
        keyword: r.keyword,
        region: r.region,
        periodStart: r.periodStart,
        periodEnd: r.periodEnd,
        demandValue: r.demandValue,
        evidenceReference: r.evidenceReference,
        methodologyVersion: body.methodologyVersion ?? "1.0",
      })),
    });

    return NextResponse.json({
      success: true,
      data: {
        productId: body.productId,
        totalRows: body.rows.length,
        validRows: validRows.length,
        insertedCount: importRes.insertedCount,
        skippedCount: importRes.skippedCount,
        errorCount: body.rows.length - validRows.length,
      },
      meta: {
        timestamp: new Date().toISOString(),
        note:
          "demandValue is stored as RELATIVE_INTEREST (Google Trends 0–100 scale). " +
          "This is NOT absolute search volume and NOT sales data.",
      },
    });
  } catch (error: any) {
    if (error instanceof ResearchAuthError) {
      return NextResponse.json(
        { success: false, error: { code: error.code, message: error.message } },
        { status: error.statusCode || 401 }
      );
    }
    if (error instanceof BatchImportError) {
      return NextResponse.json(
        { success: false, error: { code: error.code, message: error.message, details: error.details } },
        { status: error.statusCode }
      );
    }
    return NextResponse.json(
      { success: false, error: { code: "IMPORT_FAILED", message: error.message } },
      { status: 500 }
    );
  }
}
