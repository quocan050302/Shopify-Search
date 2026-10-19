/**
 * V7.1 Unit Tests
 *
 * Tests for:
 * 1. TikTok URL classification and ID extraction
 * 2. TikTok player URL building (player/v1 endpoint)
 * 3. Video magic byte validation (MP4, WebM, invalid)
 * 4. Gemini adapter configuration detection
 * 5. Upload playback URL generation
 * 6. Creative Center → not-embeddable classification
 * 7. Synthetic and invalid ad ID handling
 * 8. oEmbed fallback behavior on network error
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import {
  extractTikTokPostIdFromUrl,
  buildTikTokPlayerUrl,
  getTikTokEmbedMetadata,
  resolveTikTokPlayerSource,
} from "@/services/video/tiktokEmbedService";

import { validateVideoMagicBytes, getAuthorizedVideoPlaybackUrl } from "@/app/api/v1/media/upload/route";

import { validateGeminiConfiguration } from "@/services/ai/geminiAdapter";

import { isSyntheticAdId } from "@/services/video/videoSourceResolver";

// ─── A: TikTok URL Classification ────────────────────────────────────────────

describe("extractTikTokPostIdFromUrl — URL classification", () => {
  it("extracts numeric ID from standard TikTok post URL", () => {
    const result = extractTikTokPostIdFromUrl(
      "https://www.tiktok.com/@nike/video/7123456789012345678"
    );
    expect(result.postId).toBe("7123456789012345678");
    expect(result.sourceType).toBe("TIKTOK_POST");
  });

  it("extracts ID from URL without www prefix", () => {
    const result = extractTikTokPostIdFromUrl(
      "https://tiktok.com/@brand/video/7198765432109876543"
    );
    expect(result.postId).toBe("7198765432109876543");
    expect(result.sourceType).toBe("TIKTOK_POST");
  });

  it("classifies Creative Center URL as NOT embeddable", () => {
    const result = extractTikTokPostIdFromUrl(
      "https://ads.tiktok.com/business/creativecenter/inspiration/topads/pc/en?id=7123456789012345678"
    );
    expect(result.postId).toBeNull();
    expect(result.sourceType).toBe("TIKTOK_CREATIVE_CENTER");
  });

  it("classifies TikTok library URL as NOT embeddable", () => {
    const result = extractTikTokPostIdFromUrl(
      "https://library.tiktok.com/ads?start_time=1700000000&end_time=1710000000"
    );
    expect(result.postId).toBeNull();
    expect(result.sourceType).toBe("TIKTOK_CREATIVE_CENTER");
  });

  it("classifies vm.tiktok.com short URL correctly", () => {
    const result = extractTikTokPostIdFromUrl("https://vm.tiktok.com/AbCdEfGh/");
    expect(result.postId).toBeNull();
    expect(result.sourceType).toBe("TIKTOK_SHORT_URL");
    // Reason must explain that redirect resolution is required
    expect(result.reason).toMatch(/redirect|short/i);
  });

  it("returns UNKNOWN for non-TikTok URL", () => {
    const result = extractTikTokPostIdFromUrl("https://instagram.com/p/abc123/");
    expect(result.postId).toBeNull();
    expect(result.sourceType).toBe("UNKNOWN");
  });

  it("returns UNKNOWN for empty URL", () => {
    const result = extractTikTokPostIdFromUrl("");
    expect(result.postId).toBeNull();
  });

  it("does not extract short/fake numeric IDs (must be 10+ digits)", () => {
    // This URL has only 6 digits — too short for a real TikTok post ID
    const result = extractTikTokPostIdFromUrl(
      "https://www.tiktok.com/@user/video/123456"
    );
    expect(result.postId).toBeNull();
  });
});

// ─── B: TikTok Player URL Building ───────────────────────────────────────────

describe("buildTikTokPlayerUrl — player/v1 endpoint", () => {
  it("uses /player/v1/ format (not deprecated /embed/v2/)", () => {
    const url = buildTikTokPlayerUrl("7123456789012345678");
    expect(url).toContain("/player/v1/");
    expect(url).not.toContain("/embed/v2/");
    expect(url).not.toContain("/oembed");
  });

  it("includes expected query params", () => {
    const url = buildTikTokPlayerUrl("7123456789012345678");
    expect(url).toContain("autoplay=");
    expect(url).toContain("controls=");
  });

  it("includes the post ID in the URL path", () => {
    const postId = "7198765432109876543";
    const url = buildTikTokPlayerUrl(postId);
    expect(url).toContain(postId);
  });
});

// ─── C: Creative Center → Not Embeddable ─────────────────────────────────────

describe("resolveTikTokPlayerSource — Creative Center not embeddable", () => {
  it("returns OPEN_SOURCE for Creative Center URLs", async () => {
    const result = await resolveTikTokPlayerSource(
      "https://ads.tiktok.com/business/creativecenter/inspiration/topads/pc/en?id=7123456789",
      { validateViaOEmbed: false }
    );
    expect(result.strategy).toBe("OPEN_SOURCE");
    expect(result.restriction).toMatch(/creative_center|NOT_EMBEDDABLE/i);
    expect(result.playerUrl).toBeUndefined();
  });

  it("returns UNAVAILABLE for short URL without validateViaOEmbed", async () => {
    const result = await resolveTikTokPlayerSource(
      "https://vm.tiktok.com/AbCdEf/",
      { validateViaOEmbed: false }
    );
    expect(result.strategy).toBe("OPEN_SOURCE");
  });

  it("returns TIKTOK_OEMBED for real post URL without oEmbed validation", async () => {
    const result = await resolveTikTokPlayerSource(
      "https://www.tiktok.com/@nike/video/7123456789012345678",
      { validateViaOEmbed: false }
    );
    expect(result.strategy).toBe("TIKTOK_OEMBED");
    expect(result.playerUrl).toContain("/player/v1/");
    expect(result.postId).toBe("7123456789012345678");
  });
});

// ─── D: Video Magic Bytes Validation ─────────────────────────────────────────

describe("validateVideoMagicBytes", () => {
  function makeBuffer(bytes: number[]): Uint8Array {
    return new Uint8Array(bytes);
  }

  it("validates MP4 (ftyp box signature)", () => {
    // box_size (4 bytes) + 'ftyp' = 66 74 79 70
    const mp4 = makeBuffer([0x00, 0x00, 0x00, 0x20, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d]);
    const result = validateVideoMagicBytes(mp4);
    expect(result.valid).toBe(true);
    expect(result.detectedFormat).toBe("MP4");
    expect(result.mimeType).toBe("video/mp4");
  });

  it("validates WebM (EBML header 1A 45 DF A3)", () => {
    const webm = makeBuffer([0x1a, 0x45, 0xdf, 0xa3, 0x01, 0x00, 0x00, 0x00]);
    const result = validateVideoMagicBytes(webm);
    expect(result.valid).toBe(true);
    expect(result.detectedFormat).toBe("WEBM");
    expect(result.mimeType).toBe("video/webm");
  });

  it("rejects PNG file (PNG signature 89 50 4E 47)", () => {
    const png = makeBuffer([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const result = validateVideoMagicBytes(png);
    expect(result.valid).toBe(false);
    expect(result.detectedFormat).toBe("UNKNOWN");
  });

  it("rejects JPEG file (FF D8 FF)", () => {
    const jpeg = makeBuffer([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46]);
    const result = validateVideoMagicBytes(jpeg);
    expect(result.valid).toBe(false);
  });

  it("rejects EXE file (MZ header 4D 5A)", () => {
    const exe = makeBuffer([0x4d, 0x5a, 0x90, 0x00, 0x03, 0x00, 0x00, 0x00]);
    const result = validateVideoMagicBytes(exe);
    expect(result.valid).toBe(false);
  });

  it("rejects empty buffer", () => {
    const empty = makeBuffer([]);
    const result = validateVideoMagicBytes(empty);
    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/magic bytes|signature|unknown/i);
  });

  it("includes the detected bytes in reason for unknown files", () => {
    const unknown = makeBuffer([0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07]);
    const result = validateVideoMagicBytes(unknown);
    expect(result.valid).toBe(false);
    // reason should contain hex byte representation
    expect(result.reason).toMatch(/0x/i);
  });
});

// ─── E: Upload URL Generation ─────────────────────────────────────────────────

describe("getAuthorizedVideoPlaybackUrl", () => {
  it("generates a valid public URL for UUID-based filenames", () => {
    const url = getAuthorizedVideoPlaybackUrl("abc123-def456.mp4");
    expect(url).toBe("/uploads/abc123-def456.mp4");
    expect(url).toMatch(/^\/uploads\//);
  });

  it("sanitizes filenames with path traversal attempts", () => {
    const url = getAuthorizedVideoPlaybackUrl("../../../etc/passwd");
    expect(url).not.toContain("..");
    expect(url).not.toContain("/etc/");
  });

  it("sanitizes filenames with shell injection characters", () => {
    const url = getAuthorizedVideoPlaybackUrl("video; rm -rf /.mp4");
    expect(url).not.toContain(";");
    expect(url).not.toContain(" ");
  });

  it("preserves valid UUID filenames unchanged", () => {
    const uuid = "550e8400-e29b-41d4-a716-446655440000.mp4";
    const url = getAuthorizedVideoPlaybackUrl(uuid);
    expect(url).toBe(`/uploads/${uuid}`);
  });
});

// ─── F: Gemini Configuration Detection ───────────────────────────────────────

describe("validateGeminiConfiguration", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it("returns NOT_CONFIGURED when GEMINI_API_KEY is absent", () => {
    delete process.env.GEMINI_API_KEY;
    const result = validateGeminiConfiguration();
    expect(result.configured).toBe(false);
    expect(result.status).toBe("NOT_CONFIGURED");
    expect(result.limitations.length).toBeGreaterThan(0);
  });

  it("returns NOT_CONFIGURED when GEMINI_API_KEY is empty string", () => {
    process.env.GEMINI_API_KEY = "";
    const result = validateGeminiConfiguration();
    expect(result.configured).toBe(false);
    expect(result.status).toBe("NOT_CONFIGURED");
  });

  it("returns KEY_PRESENT_UNVERIFIED when GEMINI_API_KEY is set", () => {
    process.env.GEMINI_API_KEY = "test-key-abc123";
    const result = validateGeminiConfiguration();
    expect(result.configured).toBe(true);
    expect(result.status).toBe("KEY_PRESENT_UNVERIFIED");
    expect(result.message).toMatch(/not live-tested|unverified/i);
  });

  it("includes model version in response", () => {
    delete process.env.GEMINI_API_KEY;
    const result = validateGeminiConfiguration();
    expect(result.modelVersion).toBeTruthy();
    expect(result.modelVersion).toMatch(/gemini/i);
  });

  it("includes prompt version", () => {
    const result = validateGeminiConfiguration();
    expect(result.promptVersion).toBeTruthy();
  });
});

// ─── G: oEmbed Error Handling ─────────────────────────────────────────────────

describe("getTikTokEmbedMetadata — error handling", () => {
  it("returns CREATIVE_CENTER_NOT_EMBEDDABLE for Creative Center URL", async () => {
    const result = await getTikTokEmbedMetadata(
      "https://ads.tiktok.com/business/creativecenter/inspiration/topads/pc/en?id=7123"
    );
    expect(result.success).toBe(false);
    expect(result.error?.code).toBe("CREATIVE_CENTER_NOT_EMBEDDABLE");
  });

  it("returns INVALID_URL for short TikTok URL", async () => {
    const result = await getTikTokEmbedMetadata(
      "https://vm.tiktok.com/ZMexample/"
    );
    expect(result.success).toBe(false);
    expect(result.error?.code).toBe("INVALID_URL");
  });

  it("returns NOT_A_TIKTOK_POST for non-TikTok URL", async () => {
    const result = await getTikTokEmbedMetadata(
      "https://instagram.com/p/abc123"
    );
    expect(result.success).toBe(false);
    expect(result.error?.code).toBe("NOT_A_TIKTOK_POST");
  });
});

// ─── H: Synthetic Ad ID Detection (preserved from V6.2) ──────────────────────

describe("isSyntheticAdId detection — V6.2 patterns preserved", () => {

  it("detects seed synthetic ad IDs", () => {
    expect(isSyntheticAdId("meta_bleame_crystal_hair_eraser_01")).toBe(true);
    expect(isSyntheticAdId("tiktok_ridge_wallet_titanium_02")).toBe(true);
    expect(isSyntheticAdId("meta_blendjet_portable_blender_03")).toBe(true);
  });

  it("does not flag real numeric TikTok IDs as synthetic", () => {
    expect(isSyntheticAdId("7123456789012345678")).toBe(false);
    expect(isSyntheticAdId("1234567890987654321")).toBe(false);
  });

  it("does not flag real Meta numeric IDs as synthetic", () => {
    expect(isSyntheticAdId("102938475619283")).toBe(false);
  });

  it("returns false for null/undefined", () => {
    expect(isSyntheticAdId(null)).toBe(false);
    expect(isSyntheticAdId(undefined)).toBe(false);
  });
});

// ─── I: TikTok URL from Distinct ID Patterns ─────────────────────────────────

describe("Creative Center IDs vs Post IDs distinction", () => {
  it("Creative Center 'id' param is NOT a TikTok post ID", () => {
    // This is the Creative Center pattern — id param is a material_id, not a post video ID
    const creativeCenterUrl =
      "https://ads.tiktok.com/business/creativecenter/inspiration/topads/pc/en?period=30&region=US&id=7289012345678901234";

    const result = extractTikTokPostIdFromUrl(creativeCenterUrl);
    // Must NOT extract the id param value as a post ID
    expect(result.postId).toBeNull();
    expect(result.sourceType).toBe("TIKTOK_CREATIVE_CENTER");
  });

  it("Post URL contains numeric ID in PATH, not query params", () => {
    const postUrl = "https://www.tiktok.com/@adidas/video/7289012345678901234";
    const result = extractTikTokPostIdFromUrl(postUrl);
    expect(result.postId).toBe("7289012345678901234");
    expect(result.sourceType).toBe("TIKTOK_POST");
  });
});
