/**
 * GET, POST /api/v1/settings/budgets
 *
 * Provider usage budget & credit protection management:
 * - GET: Retrieves budget configurations for all providers (Gemini, Meta, Captapi).
 * - POST: Updates budget configuration (enabled, monthly credit limit, allowAutomaticRequests).
 */

import { NextRequest, NextResponse } from "next/server";
import {
  loadProviderBudgets,
  updateProviderBudget,
  ProviderBudgetConfig,
} from "@/services/providers/budgetService";
import { ProviderId } from "@/services/credentials/credentialService";
import { requireAdminAuth } from "@/services/security/adminAuth";

export async function GET() {
  try {
    const budgets = loadProviderBudgets();
    return NextResponse.json({
      success: true,
      data: budgets,
      meta: {
        timestamp: new Date().toISOString(),
        version: "v7.3",
        notice:
          "Captapi is optional and disabled by default. Automatic paid API calls are blocked until explicitly authorized.",
      },
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Failed to load provider budgets.";
    return NextResponse.json(
      { success: false, error: { code: "BUDGET_FETCH_FAILED", message: msg } },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  const authErr = requireAdminAuth(request);
  if (authErr) return authErr;

  try {
    const body = await request.json();
    const { provider, enabled, monthlyCreditLimit, allowAutomaticRequests } = body;

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

    const updates: Partial<ProviderBudgetConfig> = {};
    if (typeof enabled === "boolean") updates.enabled = enabled;
    if (typeof monthlyCreditLimit === "number" && monthlyCreditLimit >= 0) {
      updates.monthlyCreditLimit = monthlyCreditLimit;
    }
    if (typeof allowAutomaticRequests === "boolean") {
      updates.allowAutomaticRequests = allowAutomaticRequests;
    }

    const updated = updateProviderBudget(provider as ProviderId, updates);

    return NextResponse.json({
      success: true,
      data: updated,
      meta: {
        timestamp: new Date().toISOString(),
        version: "v7.3",
      },
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Failed to update provider budget.";
    return NextResponse.json(
      { success: false, error: { code: "BUDGET_UPDATE_FAILED", message: msg } },
      { status: 500 }
    );
  }
}
