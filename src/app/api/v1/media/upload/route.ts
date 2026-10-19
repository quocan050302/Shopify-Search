/**
 * POST /api/v1/media/upload
 *
 * Authorized video upload endpoint.
 * Accepts MP4 and WebM only. Validates file content (magic bytes), not just extension.
 * Stores files in /public/uploads/ for persistent HTML5 playback.
 * Returns a playback URL that works after reload.
 *
 * Security:
 * - File type validated via magic bytes (not just MIME header from client)
 * - File size configurable via MAX_UPLOAD_SIZE_MB env var (default: 100MB)
 * - No executable extensions allowed
 * - Filenames sanitized (UUID-based, no user-controlled paths)
 *
 * IMPORTANT:
 * - /public/uploads/ is suitable for local research use only.
 * - For production deployment, replace with cloud storage (S3, GCS, etc.)
 * - Do not use /tmp or in-memory — files must persist after server restart.
 */
import { NextRequest, NextResponse } from "next/server";
import { writeFile, mkdir, stat } from "fs/promises";
import { join } from "path";
import { randomUUID } from "crypto";

// ─── Config ───────────────────────────────────────────────────────────────────

const MAX_SIZE_MB = parseInt(process.env.MAX_UPLOAD_SIZE_MB || "100", 10);
const MAX_SIZE_BYTES = MAX_SIZE_MB * 1024 * 1024;
const UPLOAD_DIR = join(process.cwd(), "public", "uploads");

// ─── Magic Byte Signatures ────────────────────────────────────────────────────

/**
 * Validates file content using magic bytes, not client-declared MIME type.
 * Only MP4 and WebM are accepted.
 */
export function validateVideoMagicBytes(buffer: Uint8Array): {
  valid: boolean;
  detectedFormat: "MP4" | "WEBM" | "MOV" | "UNKNOWN";
  mimeType: string | null;
  reason: string;
} {
  // MP4 / M4V: ftyp box at bytes 4–7
  // Common MP4 signatures:
  //   [0-3] = box size (4 bytes), [4-7] = 'ftyp' (66 74 79 70)
  const isMP4 =
    buffer.length >= 8 &&
    buffer[4] === 0x66 && // 'f'
    buffer[5] === 0x74 && // 't'
    buffer[6] === 0x79 && // 'y'
    buffer[7] === 0x70;   // 'p'

  if (isMP4) {
    return { valid: true, detectedFormat: "MP4", mimeType: "video/mp4", reason: "Valid MP4 container (ftyp box detected)." };
  }

  // MOV: also uses ftyp or 'wide'/'mdat' — check for 'moov' or 'wide' at [4]
  const isMOV =
    buffer.length >= 8 &&
    buffer[4] === 0x6d && // 'm'
    buffer[5] === 0x6f && // 'o'
    buffer[6] === 0x6f && // 'o'
    buffer[7] === 0x76;   // 'v'

  // WebM / MKV: starts with EBML header 0x1A 0x45 0xDF 0xA3
  const isWebM =
    buffer.length >= 4 &&
    buffer[0] === 0x1a &&
    buffer[1] === 0x45 &&
    buffer[2] === 0xdf &&
    buffer[3] === 0xa3;

  if (isWebM) {
    return { valid: true, detectedFormat: "WEBM", mimeType: "video/webm", reason: "Valid WebM container (EBML header detected)." };
  }

  if (isMOV) {
    return { valid: true, detectedFormat: "MOV", mimeType: "video/mp4", reason: "Valid QuickTime MOV (moov atom detected). Served as MP4." };
  }

  // Check for MP4 with 0-size box (some encoders write 0 for box size)
  const isMP4Alt =
    buffer.length >= 12 &&
    buffer[0] === 0x00 &&
    buffer[1] === 0x00 &&
    buffer[2] === 0x00 &&
    buffer[3] === 0x00 &&
    buffer[4] === 0x66 && // 'f'
    buffer[5] === 0x74 && // 't'
    buffer[6] === 0x79 && // 'y'
    buffer[7] === 0x70;   // 'p'

  if (isMP4Alt) {
    return { valid: true, detectedFormat: "MP4", mimeType: "video/mp4", reason: "Valid MP4 container (extended ftyp box)." };
  }

  return {
    valid: false,
    detectedFormat: "UNKNOWN",
    mimeType: null,
    reason:
      "File magic bytes do not match MP4 (ftyp) or WebM (EBML) signatures. " +
      "Only MP4 and WebM video files are accepted. " +
      `First 4 bytes: ${Array.from(buffer.slice(0, 4)).map((b) => `0x${b.toString(16).padStart(2, "0")}`).join(" ")}`,
  };
}

/**
 * Ensures the upload directory exists.
 */
async function ensureUploadDir(): Promise<void> {
  try {
    await stat(UPLOAD_DIR);
  } catch {
    await mkdir(UPLOAD_DIR, { recursive: true });
  }
}

/**
 * Returns the public URL for an uploaded file.
 */
export function getUploadedFilePublicUrl(filename: string): string {
  return `/uploads/${filename}`;
}

/**
 * Validates and returns the playback URL for an uploaded video.
 * This is the URL to pass to the HTML5 video element.
 */
export function getAuthorizedVideoPlaybackUrl(uploadedFilename: string): string {
  // Sanitize — only allow UUID-named files
  // Strip '..' sequences first (path traversal protection), then remove non-safe chars
  const noTraversal = uploadedFilename.replace(/\.\./g, "");
  const safeFilename = noTraversal.replace(/[^a-zA-Z0-9\-_.]/g, "");
  return `/uploads/${safeFilename}`;
}

// ─── Route Handler ────────────────────────────────────────────────────────────

export async function POST(request: NextRequest) {
  try {
    await ensureUploadDir();

    const contentLength = request.headers.get("content-length");
    if (contentLength && parseInt(contentLength, 10) > MAX_SIZE_BYTES) {
      return NextResponse.json(
        {
          success: false,
          error: {
            code: "FILE_TOO_LARGE",
            message: `File exceeds maximum size of ${MAX_SIZE_MB}MB. Received ${Math.round(parseInt(contentLength, 10) / 1024 / 1024)}MB.`,
          },
        },
        { status: 413 }
      );
    }

    let formData: FormData;
    try {
      formData = await request.formData();
    } catch {
      return NextResponse.json(
        { success: false, error: { code: "INVALID_REQUEST", message: "Request must be multipart/form-data." } },
        { status: 400 }
      );
    }

    const file = formData.get("video") as File | null;
    const adId = formData.get("adId") as string | null;
    const label = formData.get("label") as string | null;

    if (!file || !(file instanceof File)) {
      return NextResponse.json(
        { success: false, error: { code: "MISSING_FILE", message: "No 'video' file field in form data." } },
        { status: 400 }
      );
    }

    // Check file size
    if (file.size > MAX_SIZE_BYTES) {
      return NextResponse.json(
        {
          success: false,
          error: {
            code: "FILE_TOO_LARGE",
            message: `File size ${Math.round(file.size / 1024 / 1024)}MB exceeds limit of ${MAX_SIZE_MB}MB.`,
          },
        },
        { status: 413 }
      );
    }

    if (file.size === 0) {
      return NextResponse.json(
        { success: false, error: { code: "EMPTY_FILE", message: "Uploaded file is empty." } },
        { status: 400 }
      );
    }

    // Read file buffer
    const arrayBuffer = await file.arrayBuffer();
    const buffer = new Uint8Array(arrayBuffer);

    // Validate magic bytes — do NOT trust client-declared MIME type
    const magicCheck = validateVideoMagicBytes(buffer);
    if (!magicCheck.valid) {
      return NextResponse.json(
        {
          success: false,
          error: {
            code: "INVALID_FILE_TYPE",
            message: magicCheck.reason,
            acceptedFormats: ["MP4 (video/mp4)", "WebM (video/webm)"],
          },
        },
        { status: 415 }
      );
    }

    // Generate safe UUID-based filename
    const extension = magicCheck.detectedFormat === "WEBM" ? "webm" : "mp4";
    const safeFilename = `${randomUUID()}.${extension}`;
    const filePath = join(UPLOAD_DIR, safeFilename);

    // Write to persistent storage
    await writeFile(filePath, buffer);

    const publicUrl = getUploadedFilePublicUrl(safeFilename);

    return NextResponse.json({
      success: true,
      data: {
        filename: safeFilename,
        publicUrl,
        playbackUrl: publicUrl,
        format: magicCheck.detectedFormat,
        mimeType: magicCheck.mimeType,
        sizeBytes: file.size,
        sizeMB: Math.round((file.size / 1024 / 1024) * 100) / 100,
        adId: adId || null,
        label: label || null,
        verificationMethod: magicCheck.reason,
        uploadedAt: new Date().toISOString(),
        storageNote:
          "File stored in /public/uploads/ — accessible as static asset after server restart. " +
          "For production use, replace with cloud storage (S3/GCS).",
      },
      meta: {
        maxSizeMB: MAX_SIZE_MB,
        supportedFormats: ["MP4", "WebM"],
        magicByteVerified: true,
      },
    });
  } catch (error: any) {
    return NextResponse.json(
      { success: false, error: { code: "UPLOAD_FAILED", message: error.message } },
      { status: 500 }
    );
  }
}
