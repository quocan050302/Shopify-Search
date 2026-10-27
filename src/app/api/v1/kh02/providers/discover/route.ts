/**
 * GET & POST /api/v1/kh02/providers/discover
 *
 * Runs zero-key provider auto-discovery and capability probing across
 * Meta Ads, TikTok Ads, TikTok Organic, Google Ads Transparency, and Demand History.
 * Enforces zero unapproved cost policy ($0 budget).
 */

import { NextRequest, NextResponse } from "next/server";
import { discoverAvailableKH02Providers } from "@/services/kh02/providers/providerDiscoveryService";
import {
  resolveAuthorizedResearchContext,
  ResearchAuthError,
} from "@/services/research/researchAuthService";

export async function GET(request: NextRequest) {
  return handleDiscovery(request);
}

export async function POST(request: NextRequest) {
  return handleDiscovery(request);
}

async function handleDiscovery(request: NextRequest) {
  try {
    const context = await resolveAuthorizedResearchContext(request);

    const discoveryResults = await discoverAvailableKH02Providers({
      workspaceId: context.workspaceId,
      allowPaidOperations: false,
    });

    const zeroKeyAuthorized = discoveryResults.filter(
      (r) =>
        r.accessClass === "ZERO_KEY_AUTHORIZED" ||
        r.accessClass === "LOCAL_COLLECTOR_AVAILABLE"
    );

    const activeWorkingConnectors = discoveryResults.filter(
      (r) => r.readiness.transportConnected
    );

    return NextResponse.json({
      success: true,
      data: discoveryResults,
      meta: {
        workspaceId: context.workspaceId,
        timestamp: new Date().toISOString(),
        totalProviders: discoveryResults.length,
        zeroKeyAuthorizedCount: zeroKeyAuthorized.length,
        activeWorkingConnectorsCount: activeWorkingConnectors.length,
        summary: {
          zeroKeyProviders: zeroKeyAuthorized.map((p) => p.providerId),
          activeConnectors: activeWorkingConnectors.map((p) => p.providerId),
        },
      },
    });
  } catch (err: any) {
    if (err instanceof ResearchAuthError) {
      return NextResponse.json(
        { success: false, error: { code: err.code, message: err.message } },
        { status: err.statusCode }
      );
    }

    return NextResponse.json(
      {
        success: false,
        error: {
          code: "PROVIDER_DISCOVERY_FAILED",
          message: err.message || "Failed to execute provider auto-discovery.",
        },
      },
      { status: 500 }
    );
  }
}
