import { NextRequest, NextResponse } from "next/server";
import {
  checkExternalLink,
  validateResearchUrl,
} from "@/services/links/linkValidationService";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { urls } = body;

    if (!Array.isArray(urls) || urls.length === 0) {
      return NextResponse.json(
        {
          success: false,
          error: {
            code: "MISSING_URLS",
            message: "Provide a 'urls' array with at least one URL to validate.",
            retryable: false,
            timestamp: new Date().toISOString(),
          },
        },
        { status: 400 }
      );
    }

    if (urls.length > 10) {
      return NextResponse.json(
        {
          success: false,
          error: {
            code: "TOO_MANY_URLS",
            message: "Maximum 10 URLs per validation request.",
            retryable: false,
            timestamp: new Date().toISOString(),
          },
        },
        { status: 400 }
      );
    }

    const results = await Promise.all(
      urls.map((url: string) =>
        checkExternalLink(url, { timeoutMs: 6000, allowGet: false })
      )
    );

    const summary = {
      total: results.length,
      valid: results.filter((r) =>
        ["VALID", "REDIRECTED"].includes(r.verificationStatus)
      ).length,
      notFound: results.filter((r) => r.verificationStatus === "NOT_FOUND")
        .length,
      accessRestricted: results.filter(
        (r) => r.verificationStatus === "ACCESS_RESTRICTED"
      ).length,
      temporarilyUnavailable: results.filter((r) =>
        ["TEMPORARILY_UNAVAILABLE", "RATE_LIMITED"].includes(
          r.verificationStatus
        )
      ).length,
      invalid: results.filter((r) =>
        ["INVALID", "GONE"].includes(r.verificationStatus)
      ).length,
    };

    return NextResponse.json({
      success: true,
      data: results,
      summary,
      meta: {
        timestamp: new Date().toISOString(),
        version: "v1",
        note: "Results are indicative — network conditions and platform restrictions affect accuracy.",
      },
    });
  } catch (error: any) {
    return NextResponse.json(
      {
        success: false,
        error: {
          code: "VALIDATION_FAILED",
          message: error.message || "Link validation request failed",
          retryable: true,
          timestamp: new Date().toISOString(),
        },
      },
      { status: 500 }
    );
  }
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const url = searchParams.get("url");

    if (!url) {
      return NextResponse.json(
        {
          success: false,
          error: {
            code: "MISSING_URL",
            message: "Provide a 'url' query parameter.",
            retryable: false,
            timestamp: new Date().toISOString(),
          },
        },
        { status: 400 }
      );
    }

    const result = validateResearchUrl(url);

    return NextResponse.json({
      success: true,
      data: result,
      meta: {
        timestamp: new Date().toISOString(),
        version: "v1",
        note: "This endpoint only validates URL structure and SSRF safety — no HTTP request is made.",
      },
    });
  } catch (error: any) {
    return NextResponse.json(
      {
        success: false,
        error: {
          code: "VALIDATION_FAILED",
          message: error.message || "URL validation failed",
          retryable: false,
          timestamp: new Date().toISOString(),
        },
      },
      { status: 500 }
    );
  }
}
