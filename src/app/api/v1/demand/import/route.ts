/**
 * POST /api/v1/demand/import
 * Imports product demand observations (e.g. from Google Trends CSV export).
 *
 * GET /api/v1/demand/products/:id/history
 * Returns demand observation history for a product.
 */
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";

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
  rows: DemandImportRow[];
  methodologyVersion?: string;
}

const DEMAND_VALUE_MAX = 100;
const MAX_ROWS_PER_IMPORT = 500;

export async function POST(request: NextRequest) {
  try {
    const body: DemandImportPayload = await request.json();

    if (!body.productId || typeof body.productId !== "string") {
      return NextResponse.json(
        { success: false, error: { code: "MISSING_PRODUCT_ID", message: "productId is required." } },
        { status: 400 }
      );
    }

    if (!Array.isArray(body.rows) || body.rows.length === 0) {
      return NextResponse.json(
        { success: false, error: { code: "EMPTY_ROWS", message: "rows array must not be empty." } },
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

    // Verify product exists
    const product = await prisma.researchProduct.findUnique({ where: { id: body.productId } });
    if (!product) {
      return NextResponse.json(
        { success: false, error: { code: "PRODUCT_NOT_FOUND", message: `Product ${body.productId} not found.` } },
        { status: 404 }
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

    // Insert observations (skip duplicates by keyword+region+periodStart)
    let insertedCount = 0;
    let skippedCount = 0;

    for (const row of validRows) {
      const existing = await prisma.productDemandObservation.findFirst({
        where: {
          productId: body.productId,
          keyword: row.keyword.trim(),
          region: row.region.trim().toUpperCase(),
          periodStart: new Date(row.periodStart),
        },
      });

      if (existing) {
        skippedCount++;
        continue;
      }

      await prisma.productDemandObservation.create({
        data: {
          productId: body.productId,
          source: row.source,
          region: row.region.trim().toUpperCase(),
          keyword: row.keyword.trim(),
          periodStart: new Date(row.periodStart),
          periodEnd: new Date(row.periodEnd),
          demandValue: row.demandValue ?? null,
          valueType: "RELATIVE_INTEREST",
          evidenceReference: row.evidenceReference ?? null,
          methodologyVersion: body.methodologyVersion ?? "1.0",
        },
      });
      insertedCount++;
    }

    return NextResponse.json({
      success: true,
      data: {
        productId: body.productId,
        totalRows: body.rows.length,
        validRows: validRows.length,
        insertedCount,
        skippedCount,
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
    return NextResponse.json(
      { success: false, error: { code: "IMPORT_FAILED", message: error.message } },
      { status: 500 }
    );
  }
}
