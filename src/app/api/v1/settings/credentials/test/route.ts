/**
 * POST /api/v1/settings/credentials/test
 *
 * Runs a live authenticated connection test for a provider:
 * - Google Gemini AI: tests generateContent via @google/generative-ai
 * - Meta Ad Library: tests ads_archive endpoint and inspects exact permissions
 * - Captapi: tests account balance endpoint
 *
 * CRITICAL REQUIREMENTS:
 * - Does NOT mark a provider CONNECTED until an authenticated test request succeeds.
 * - Does NOT claim Meta commercial US ad discovery is supported without verifying exact permissions.
 * - Displays exact API errors and missing permissions.
 */

import { NextRequest, NextResponse } from "next/server";
import {
  testProviderConnection,
  ProviderId,
} from "@/services/credentials/credentialService";
import { requireAdminAuth } from "@/services/security/adminAuth";

export async function POST(request: NextRequest) {
  const authErr = requireAdminAuth(request);
  if (authErr) return authErr;

  try {
    const body = await request.json();
    const { provider, key } = body;

    if (!provider || !["gemini", "meta", "captapi"].includes(provider)) {
      return NextResponse.json(
        {
          success: false,
          error: {
            code: "INVALID_PROVIDER",
            message: "Provider must be one of: 'gemini', 'meta', 'captapi'.",
          },
        },
        { status: 400 }
      );
    }

    const testResult = await testProviderConnection(
      provider as ProviderId,
      typeof key === "string" && key.trim().length > 0 ? key : undefined
    );

    return NextResponse.json({
      success: testResult.status === "CONNECTED",
      data: testResult,
      meta: {
        timestamp: new Date().toISOString(),
        verified: testResult.status === "CONNECTED",
      },
    });
  } catch (err: any) {
    return NextResponse.json(
      {
        success: false,
        error: {
          code: "TEST_EXECUTION_FAILED",
          message: err.message || "An unexpected error occurred during connection test.",
        },
      },
      { status: 500 }
    );
  }
}
