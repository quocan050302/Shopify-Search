/**
 * GET /api/v1/providers/feasibility
 *
 * Returns honest assessment of all provider capabilities,
 * credential status, and data availability.
 *
 * Separates:
 *   LOCAL_SEARCH — searches the local SWAI database
 *   CONNECTED_PROVIDER_SEARCH — requires API credentials (may be blocked)
 *   MANUAL_IMPORT — always available via URL paste
 */
import { NextRequest, NextResponse } from "next/server";
import { validateGeminiConfiguration } from "@/services/ai/geminiAdapter";

export async function GET(_request: NextRequest) {
  // Check actual environment variables
  const hasMetaToken = !!(
    process.env.META_AD_LIBRARY_ACCESS_TOKEN?.trim().length
  );
  const hasGeminiKey = !!(process.env.GEMINI_API_KEY?.trim().length);
  const hasCaptapiKey = !!(process.env.CAPTAPI_KEY?.trim().length);
  const hasTikTokDevKey = !!(process.env.TIKTOK_DEVELOPER_KEY?.trim().length);

  const geminiConfig = validateGeminiConfiguration();

  return NextResponse.json({
    success: true,
    data: {
      searchModes: {
        LOCAL_SEARCH: {
          status: "AVAILABLE",
          description: "Search the local SWAI research database. Records must be manually imported.",
          requiresCredentials: false,
          usAvailability: "FULL",
        },
        CONNECTED_PROVIDER_SEARCH: {
          status: "PARTIALLY_BLOCKED",
          description: "Automated search against external provider APIs. Most providers require credentials.",
          requiresCredentials: true,
          usAvailability: "LIMITED",
        },
        MANUAL_IMPORT: {
          status: "AVAILABLE",
          description: "Paste a Meta Ad Library or TikTok post URL to import an ad manually.",
          requiresCredentials: false,
          usAvailability: "FULL",
        },
      },
      providers: [
        {
          id: "meta-ad-library",
          name: "Meta Ad Library",
          type: "PUBLIC_TRANSPARENCY_ARCHIVE",
          usCommercialAdCoverage: "PUBLIC_BROWSE_ONLY",
          credentialStatus: hasMetaToken ? "KEY_PRESENT_UNVERIFIED" : "NOT_CONFIGURED",
          credentialRequired: "META_AD_LIBRARY_ACCESS_TOKEN (Meta developer app with ad_archive permission)",
          liveStatus: "AVAILABLE_URL_IMPORT_ONLY",
          capabilities: {
            automatedSearch: hasMetaToken ? "UNVERIFIED" : "BLOCKED",
            directUrlImport: "AVAILABLE",
            videoPlayback: "BLOCKED — Meta render_ad requires authenticated Meta session",
            sourceUrlOpen: "AVAILABLE",
          },
          verdict:
            "Reliable for manual URL import. Automated search requires a Meta developer app " +
            "with ad_archive permission — NOT standard app review. " +
            "Video playback inside SWAI is NOT supported (Meta authentication required).",
          credentialSetup: {
            step1: "Create a Meta Developer App at developers.facebook.com",
            step2: "Request ad_archive permission (requires business verification)",
            step3: "Generate a long-lived access token",
            step4: "Set META_AD_LIBRARY_ACCESS_TOKEN in .env.local",
          },
        },
        {
          id: "tiktok-creative-center",
          name: "TikTok Creative Center",
          type: "PUBLIC_AD_INSPIRATION_TOOL",
          usCommercialAdCoverage: "BROWSE_ONLY",
          credentialStatus: "NOT_APPLICABLE",
          credentialRequired: "None for browsing. No public API for Top Ads discovery.",
          liveStatus: "AVAILABLE_URL_IMPORT_ONLY",
          capabilities: {
            automatedSearch: "BLOCKED — No public API for Top Ads or commercial ad search",
            directUrlImport: "AVAILABLE — import the Creative Center URL",
            videoPlayback: "BLOCKED — Creative Center URLs are NOT embeddable",
            sourceUrlOpen: "AVAILABLE",
            tiktokPostEmbed: "AVAILABLE — only if you have the organic TikTok post URL (tiktok.com/@user/video/ID)",
          },
          verdict:
            "Creative Center provides competitive inspiration via browsing only. " +
            "Inline video embed is NOT available for Creative Center links. " +
            "If you find the underlying TikTok post URL, it can be embedded via the official player/v1 endpoint.",
        },
        {
          id: "tiktok-post-embed",
          name: "TikTok Post oEmbed",
          type: "PLATFORM_EMBED",
          usCommercialAdCoverage: "ORGANIC_POSTS_ONLY",
          credentialStatus: "NOT_REQUIRED",
          credentialRequired: "None — uses official TikTok oEmbed + player/v1",
          liveStatus: "AVAILABLE",
          capabilities: {
            automatedSearch: "NOT_APPLICABLE",
            directUrlImport: "AVAILABLE — paste tiktok.com/@user/video/ID URLs",
            videoPlayback: "AVAILABLE — inline embed via player/v1 (with oEmbed verification)",
            sourceUrlOpen: "AVAILABLE",
          },
          verdict:
            "Real TikTok post URLs (NOT Creative Center links) can be embedded inline via the " +
            "official TikTok player/v1 endpoint. Post existence is verified via TikTok oEmbed API. " +
            "Private, removed or restricted posts will show an appropriate message.",
        },
        {
          id: "tiktok-commercial-api",
          name: "TikTok Commercial Content API (EU DSA)",
          type: "REGULATORY_COMPLIANCE_API",
          usCommercialAdCoverage: "NONE — EU only",
          credentialStatus: hasTikTokDevKey ? "KEY_PRESENT_UNVERIFIED" : "NOT_CONFIGURED",
          credentialRequired: "TikTok Developer Access + EU DSA enterprise license",
          liveStatus: "BLOCKED_REGIONAL",
          capabilities: {
            automatedSearch: "BLOCKED — US data not available",
            directUrlImport: "NOT_APPLICABLE",
            videoPlayback: "NOT_APPLICABLE",
          },
          verdict:
            "TikTok Commercial Content API is restricted to EU region for DSA compliance only. " +
            "NOT applicable for US Shopify product research. " +
            "Do not confuse TikTok API for Business with competitor ad discovery.",
        },
        {
          id: "captapi",
          name: "Captapi (Third-Party Licensed Provider)",
          type: "LICENSED_THIRD_PARTY_DATA",
          usCommercialAdCoverage: "UNVERIFIED — requires evaluation",
          credentialStatus: hasCaptapiKey ? "KEY_PRESENT_UNVERIFIED" : "NOT_CONFIGURED",
          credentialRequired: "CAPTAPI_KEY — requires paid subscription at captapi.com",
          liveStatus: hasCaptapiKey ? "KEY_PRESENT_AWAITING_VERIFICATION" : "NOT_CONFIGURED",
          capabilities: {
            automatedSearch: hasCaptapiKey ? "UNVERIFIED" : "BLOCKED_NO_CREDENTIALS",
            directUrlImport: "NOT_APPLICABLE",
            videoPlayback: "UNVERIFIED — depends on their creative URL coverage",
            sourceUrlOpen: "UNVERIFIED",
          },
          evaluationStatus: {
            usCommercialAdCoverage: "NOT_VERIFIED — must test with real query",
            commercialAdMetadata: "NOT_VERIFIED",
            actualCreativeUrls: "NOT_VERIFIED",
            runDateAccuracy: "NOT_VERIFIED",
            playbackRights: "NOT_VERIFIED — check Terms of Service",
            apiPricing: "Not evaluated",
            rateLimits: "Not evaluated",
          },
          verdict:
            "Captapi is a candidate third-party licensed data provider. " +
            "SWAI adapter is prepared but live verification requires a paid API key. " +
            "Set CAPTAPI_KEY in .env.local to enable. " +
            "Verify US commercial ad coverage, source URL authenticity, and playback rights " +
            "against Captapi documentation before production use.",
          adapterStatus: "IMPLEMENTED — live_verification_BLOCKED_until_credentials_provided",
        },
      ],
      aiAnalysis: {
        provider: "Google Gemini",
        model: geminiConfig.modelVersion,
        status: geminiConfig.status,
        configured: geminiConfig.configured,
        message: geminiConfig.message,
        limitations: geminiConfig.limitations,
        credentialRequired: "GEMINI_API_KEY in server-side environment (never expose to browser)",
        credentialSetup: {
          step1: "Go to aistudio.google.com and generate an API key",
          step2: "Add GEMINI_API_KEY=your-key to .env.local",
          step3: "Restart the dev server",
          step4: "Key is server-only — never commit to git or expose in browser",
        },
      },
      videoUpload: {
        status: "AVAILABLE",
        endpoint: "POST /api/v1/media/upload",
        acceptedFormats: ["MP4", "WebM"],
        maxSizeMB: parseInt(process.env.MAX_UPLOAD_SIZE_MB || "100", 10),
        validationMethod: "MAGIC_BYTES — file content validated, not client MIME type",
        storageLocation: "/public/uploads/ (local research use)",
        persistsAfterReload: true,
        note: "For production deployment, replace with cloud storage (S3/GCS)",
      },
    },
    meta: {
      timestamp: new Date().toISOString(),
      version: "v7.1",
      note:
        "This report reflects actual credential configuration and verified capability status. " +
        "UNVERIFIED statuses require live API testing. Do not claim CONNECTED until verified.",
    },
  });
}
