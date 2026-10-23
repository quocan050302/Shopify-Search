/**
 * POST /api/v1/discovery/muse/requests/:id/results
 *
 * The external Muse agent submits source-verified Facebook ad records
 * observed on the public Meta Ad Library for a queued request.
 *
 * Pipeline features:
 * - Scoped authentication via MUSE_INGESTION_TOKEN or ADMIN_API_KEY.
 * - Idempotency key / submissionId prevents duplicate submission processing.
 * - Format verification of Meta Library IDs (at least 5 digits, numeric).
 * - Independent record normalization so valid ads are preserved if one record fails.
 * - Honest handling of legitimate zero-result searches (COMPLETED_EMPTY).
 * - Atomic transition to COMPLETED / PARTIALLY_COMPLETED / FAILED.
 * - ProviderRequestLedger entry with zero external API costs.
 */

import { NextRequest, NextResponse } from "next/server";
import { verifyMuseAgentAuthorization } from "@/services/security/museAuth";
import { submitMuseResearchResults } from "@/services/discovery/muse/museResultSubmissionService";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = verifyMuseAgentAuthorization(request, "SUBMIT_RESULTS");
  if (!auth.authorized) return auth.errorResponse!;

  const { id } = await params;

  try {
    const body = await request.json();

    const summary = await submitMuseResearchResults(id, body, auth.agent!);

    return NextResponse.json({
      success: true,
      data: summary,
      meta: {
        timestamp: new Date().toISOString(),
        version: "v10.0",
        notice:
          "Results committed through transactional discovery pipeline. Duplicates update observations without cloning ads.",
      },
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Failed to submit Muse research results.";
    const isNotFound = msg.includes("not found");
    const isConflict = msg.includes("already");
    const isValidation = msg.includes("Invalid");

    return NextResponse.json(
      {
        success: false,
        error: {
          code: isNotFound
            ? "NOT_FOUND"
            : isConflict
            ? "REQUEST_ALREADY_CLOSED"
            : isValidation
            ? "VALIDATION_FAILED"
            : "MUSE_RESULTS_FAILED",
          message: msg,
        },
      },
      { status: isNotFound ? 404 : isConflict ? 409 : isValidation ? 400 : 500 }
    );
  }
}
