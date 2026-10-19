/**
 * GET, POST, DELETE /api/v1/settings/credentials
 *
 * Secure server-side credential management for SWAI:
 * - GET: Returns status and masked keys for configured providers. NEVER returns raw keys.
 * - POST: Saves a provider credential securely in server-side storage (.env.local).
 * - DELETE: Removes a provider credential from server storage.
 */

import { NextRequest, NextResponse } from "next/server";
import {
  getProviderConnectionStates,
  saveCredential,
  removeCredential,
  maskApiKey,
  ProviderId,
} from "@/services/credentials/credentialService";
import { requireAdminAuth } from "@/services/security/adminAuth";

export async function GET() {
  try {
    const states = getProviderConnectionStates();

    return NextResponse.json({
      success: true,
      data: {
        providers: states,
        shopify: {
          id: "shopify",
          name: "Shopify Store Connection",
          status: "NOT_CONNECTED",
          message: "Pre-Shopify Research Mode is active. Connection disabled intentionally.",
          requiredScopes: ["read_orders", "read_products", "read_analytics"],
          connectedAt: null,
          storeDomain: null,
        },
      },
      meta: {
        timestamp: new Date().toISOString(),
        version: "v7.1",
        securityNotice:
          "All API keys are stored exclusively in server-side .env.local storage. Keys are never transmitted in full to the client.",
      },
    });
  } catch (err: any) {
    return NextResponse.json(
      {
        success: false,
        error: {
          code: "CREDENTIAL_FETCH_FAILED",
          message: err.message || "Failed to retrieve provider connection states.",
        },
      },
      { status: 500 }
    );
  }
}

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

    if (!key || typeof key !== "string" || key.trim().length === 0) {
      return NextResponse.json(
        {
          success: false,
          error: {
            code: "EMPTY_CREDENTIAL",
            message: "API key or token cannot be empty.",
          },
        },
        { status: 400 }
      );
    }

    const result = await saveCredential(provider as ProviderId, key);

    return NextResponse.json({
      success: true,
      data: {
        provider,
        maskedKey: result.maskedKey,
        status: "KEY_PRESENT_UNVERIFIED",
        message:
          "Credential saved securely to server-side storage. Click 'Test Connection' to verify live connectivity.",
      },
      meta: {
        timestamp: new Date().toISOString(),
      },
    });
  } catch (err: any) {
    return NextResponse.json(
      {
        success: false,
        error: {
          code: "CREDENTIAL_SAVE_FAILED",
          message: err.message || "Failed to save credential.",
        },
      },
      { status: 500 }
    );
  }
}

export async function DELETE(request: NextRequest) {
  const authErr = requireAdminAuth(request);
  if (authErr) return authErr;

  try {
    const body = await request.json();
    const { provider } = body;

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

    await removeCredential(provider as ProviderId);

    return NextResponse.json({
      success: true,
      data: {
        provider,
        status: "NOT_CONFIGURED",
        message: "Credential removed from server-side storage.",
      },
      meta: {
        timestamp: new Date().toISOString(),
      },
    });
  } catch (err: any) {
    return NextResponse.json(
      {
        success: false,
        error: {
          code: "CREDENTIAL_DELETE_FAILED",
          message: err.message || "Failed to remove credential.",
        },
      },
      { status: 500 }
    );
  }
}
