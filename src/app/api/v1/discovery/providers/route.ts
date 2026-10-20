/**
 * GET /api/v1/discovery/providers
 *
 * Lists all registered Auto Discovery providers with live availability states and capabilities.
 */

import { NextResponse } from "next/server";
import { listDiscoveryProviders } from "@/services/discovery/providerRegistry";

export async function GET() {
  try {
    const providers = listDiscoveryProviders();
    const result = [];

    for (const p of providers) {
      const caps = p.getCapabilities();
      const avail = await p.checkAvailability();
      result.push({
        id: p.id,
        name: p.name,
        version: p.version,
        capabilities: caps,
        availability: avail,
      });
    }

    return NextResponse.json({
      success: true,
      data: result,
      meta: {
        timestamp: new Date().toISOString(),
        version: "v9.2",
        notice: "Free-first auto discovery. Captapi and Apify metered services remain disabled until explicitly authorized.",
      },
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Failed to inspect discovery providers.";
    return NextResponse.json(
      { success: false, error: { code: "PROVIDER_LOOKUP_FAILED", message: msg } },
      { status: 500 }
    );
  }
}

/**
 * POST /api/v1/discovery/providers
 *
 * Triggers an explicit live connection test for a specific provider (Rule 50).
 */
export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const providerId = body.providerId || "tiktok-topads";

    const providers = listDiscoveryProviders();
    const provider = providers.find((p) => p.id === providerId);

    if (!provider) {
      return NextResponse.json(
        { success: false, error: { code: "PROVIDER_NOT_FOUND", message: `Provider '${providerId}' not found.` } },
        { status: 404 }
      );
    }

    const avail = provider.verifyProviderConnection
      ? await provider.verifyProviderConnection()
      : await provider.checkAvailability();

    return NextResponse.json({
      success: true,
      data: {
        providerId: provider.id,
        name: provider.name,
        availability: avail,
        testedAt: new Date().toISOString(),
      },
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Failed to test provider connection.";
    return NextResponse.json(
      { success: false, error: { code: "PROVIDER_TEST_FAILED", message: msg } },
      { status: 500 }
    );
  }
}
