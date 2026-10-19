/**
 * SWAI Gemini Files API Video Service
 *
 * PHASE 4: Repair Actual Video Analysis
 *
 * Responsibilities:
 * 1. Validate video candidates (never treat arbitrary TikTok page URLs as Gemini video file references).
 * 2. Validate MIME types and container format via magic bytes (MP4 / WebM).
 * 3. Upload authorized video files to the Gemini Files API via GoogleAIFileManager.
 * 4. Poll until the Gemini file processing state becomes ACTIVE.
 * 5. Provide a valid Gemini file URI (e.g. https://generativelanguage.googleapis.com/v1beta/files/...) to the model.
 * 6. Guarantee cleanup of uploaded files after analysis.
 * 7. Never generate a success response if video upload or processing fails.
 * 8. Track VIDEO_ANALYSIS_VERIFIED status separately from text generation.
 */

import fs from "fs";
import path from "path";
import { GoogleAIFileManager } from "@google/generative-ai/server";
import { validateVideoMagicBytes } from "@/app/api/v1/media/upload/route";
import { redactSecrets } from "./geminiModelService";

export interface VideoEligibilityResult {
  eligible: boolean;
  reason: string;
  sourceType: "LOCAL_UPLOAD" | "REMOTE_VIDEO" | "NOT_ELIGIBLE";
  localFilePath?: string;
  remoteUrl?: string;
  detectedMimeType?: string;
}

export interface PreparedGeminiFile {
  fileUri: string;
  fileName: string;
  mimeType: string;
  cleanup: () => Promise<void>;
}

/**
 * Validates whether a video reference can be ingested into the Gemini Files API.
 */
export async function validateVideoForGeminiAnalysis(
  videoUrl: string | null | undefined
): Promise<VideoEligibilityResult> {
  if (!videoUrl || videoUrl.trim().length === 0) {
    return {
      eligible: false,
      reason: "No video URL or reference provided.",
      sourceType: "NOT_ELIGIBLE",
    };
  }

  const trimmed = videoUrl.trim();

  // Reject Google / open sample demo videos
  const samplePatterns = [
    /commondatastorage\.googleapis\.com\/gtv-videos-bucket/i,
    /sample-videos\.com/i,
    /w3schools\.com\/html\/mov/i,
    /filesamples\.com/i,
  ];
  if (samplePatterns.some((p) => p.test(trimmed))) {
    return {
      eligible: false,
      reason: "Video reference points to a generic sample/demo file, not an authentic competitor ad creative.",
      sourceType: "NOT_ELIGIBLE",
    };
  }

  // Check for TikTok web page URLs — these cannot be uploaded directly as raw video files
  const isTikTokWebPage =
    /tiktok\.com\/@[^/]+\/video\/\d+/i.test(trimmed) ||
    /tiktok\.com\/t\/[a-zA-Z0-9]+/i.test(trimmed) ||
    /vm\.tiktok\.com\/[a-zA-Z0-9]+/i.test(trimmed) ||
    /ads\.tiktok\.com\/business\/creativecenter/i.test(trimmed);

  if (isTikTokWebPage) {
    return {
      eligible: false,
      reason:
        "TikTok web page URLs are HTML documents, not raw video streams. " +
        "To perform multimodal video AI analysis, please upload the authorized MP4/WebM ad creative via Media Upload or provide a direct video URL.",
      sourceType: "NOT_ELIGIBLE",
    };
  }

  // Check for Meta Ad Library web page URLs
  const isMetaWebPage =
    /facebook\.com\/ads\/archive/i.test(trimmed) ||
    /facebook\.com\/ads\/library/i.test(trimmed);

  if (isMetaWebPage) {
    return {
      eligible: false,
      reason:
        "Meta Ad Library links point to web pages or authenticated render_ad sessions. " +
        "Upload the authorized MP4/WebM creative via Media Upload for Gemini AI video analysis.",
      sourceType: "NOT_ELIGIBLE",
    };
  }

  // Check if it's a local uploaded file in /uploads/
  if (trimmed.startsWith("/uploads/") || trimmed.startsWith("uploads/")) {
    const filename = trimmed.replace(/^\/?uploads\//, "");
    const localPath = path.join(process.cwd(), "public", "uploads", filename);

    if (!fs.existsSync(localPath)) {
      return {
        eligible: false,
        reason: `Local upload file '${filename}' was not found on disk.`,
        sourceType: "NOT_ELIGIBLE",
      };
    }

    try {
      // Validate magic bytes
      const headerBuffer = Buffer.alloc(32);
      const fd = fs.openSync(localPath, "r");
      fs.readSync(fd, headerBuffer, 0, 32, 0);
      fs.closeSync(fd);

      const magicCheck = validateVideoMagicBytes(new Uint8Array(headerBuffer));
      if (!magicCheck.valid) {
        return {
          eligible: false,
          reason: `Uploaded file is not a valid MP4 or WebM video: ${magicCheck.reason}`,
          sourceType: "NOT_ELIGIBLE",
        };
      }

      return {
        eligible: true,
        reason: "Authorized local MP4/WebM upload ready for Gemini Files API ingestion.",
        sourceType: "LOCAL_UPLOAD",
        localFilePath: localPath,
        detectedMimeType: magicCheck.mimeType || "video/mp4",
      };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return {
        eligible: false,
        reason: `Failed to inspect local video file: ${msg}`,
        sourceType: "NOT_ELIGIBLE",
      };
    }
  }

  // Check for direct HTTP(S) video stream
  const isDirectVideo = /\.(mp4|webm)(\?.*)?$/i.test(trimmed);
  if (isDirectVideo) {
    const detectedMimeType = trimmed.includes(".webm") ? "video/webm" : "video/mp4";
    return {
      eligible: true,
      reason: "Direct video stream URL eligible for Gemini Files API upload.",
      sourceType: "REMOTE_VIDEO",
      remoteUrl: trimmed,
      detectedMimeType,
    };
  }

  return {
    eligible: false,
    reason:
      "Video URL format not supported for Gemini video analysis. " +
      "Supported formats: authorized MP4/WebM uploads (/uploads/...) or direct .mp4/.webm video URLs.",
    sourceType: "NOT_ELIGIBLE",
  };
}

/**
 * Uploads a validated video to the Gemini Files API and waits for processing to complete.
 * Returns the Gemini File URI, file name, MIME type, and a cleanup callback.
 */
export async function uploadVideoToGeminiFiles(
  apiKey: string,
  videoCheck: VideoEligibilityResult,
  options: { maxWaitSeconds?: number } = {}
): Promise<PreparedGeminiFile> {
  const maxWaitSeconds = options.maxWaitSeconds || 45;
  const fileManager = new GoogleAIFileManager(apiKey.trim());

  let targetFilePath = videoCheck.localFilePath;
  let isTempFile = false;

  // If remote URL, download video to temporary buffer/file first
  if (videoCheck.sourceType === "REMOTE_VIDEO" && videoCheck.remoteUrl) {
    const tempDir = path.join(process.cwd(), "public", "uploads", "temp");
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }
    const tempFileName = `remote_dl_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.mp4`;
    targetFilePath = path.join(tempDir, tempFileName);
    isTempFile = true;

    try {
      const res = await fetch(videoCheck.remoteUrl, {
        signal: AbortSignal.timeout(20000),
      });
      if (!res.ok) {
        throw new Error(`Failed to download remote video: HTTP ${res.status}`);
      }
      const arrayBuffer = await res.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);

      // Validate magic bytes
      const magicCheck = validateVideoMagicBytes(new Uint8Array(buffer.slice(0, 32)));
      if (!magicCheck.valid) {
        throw new Error(`Downloaded remote video failed container verification: ${magicCheck.reason}`);
      }

      fs.writeFileSync(targetFilePath, buffer);
    } catch (err: unknown) {
      if (isTempFile && targetFilePath && fs.existsSync(/*turbopackIgnore: true*/ targetFilePath)) {
        try { fs.unlinkSync(targetFilePath); } catch {}
      }
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(`Failed to prepare remote video for upload: ${msg}`);
    }
  }

  if (!targetFilePath || !fs.existsSync(/*turbopackIgnore: true*/ targetFilePath)) {
    throw new Error("No accessible video file found on disk for Gemini Files upload.");
  }

  const mimeType = videoCheck.detectedMimeType || "video/mp4";
  let geminiFileName: string | null = null;

  try {
    // 1. Upload file to Gemini Files API
    const uploadRes = await fileManager.uploadFile(targetFilePath, {
      mimeType,
      displayName: `swai_ad_${Date.now()}`,
    });

    geminiFileName = uploadRes.file.name;
    let file = uploadRes.file;

    // 2. Poll until file processing is ACTIVE
    const startTime = Date.now();
    const maxWaitMs = maxWaitSeconds * 1000;

    while (file.state === "PROCESSING" && Date.now() - startTime < maxWaitMs) {
      await new Promise((r) => setTimeout(r, 2000));
      file = await fileManager.getFile(geminiFileName);
    }

    if (file.state === "FAILED") {
      throw new Error("Gemini Files API reported video processing state FAILED.");
    }

    if (file.state !== "ACTIVE") {
      throw new Error(
        `Gemini Files API video processing timed out after ${maxWaitSeconds}s (current state: ${file.state}).`
      );
    }

    // Mark VIDEO_ANALYSIS_VERIFIED in status cache
    markVideoAnalysisVerified();

    const cleanup = async () => {
      // Clean up local temp file if created
      if (isTempFile && targetFilePath && fs.existsSync(/*turbopackIgnore: true*/ targetFilePath)) {
        try { fs.unlinkSync(targetFilePath); } catch {}
      }
      // Clean up Gemini remote file
      if (geminiFileName) {
        try {
          await fileManager.deleteFile(geminiFileName);
        } catch {
          // ignore cleanup errors
        }
      }
    };

    return {
      fileUri: file.uri,
      fileName: file.name,
      mimeType: file.mimeType || mimeType,
      cleanup,
    };
  } catch (err: unknown) {
    // Cleanup temp file on failure
    if (isTempFile && targetFilePath && fs.existsSync(/*turbopackIgnore: true*/ targetFilePath)) {
      try { fs.unlinkSync(targetFilePath); } catch {}
    }
    if (geminiFileName) {
      try { await fileManager.deleteFile(geminiFileName); } catch {}
    }
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`Gemini video upload failed: ${redactSecrets(msg)}`);
  }
}

/**
 * Updates status cache when a real video has been analyzed successfully.
 */
function markVideoAnalysisVerified(): void {
  try {
    const cacheFile = path.join(process.cwd(), ".connection-status.json");
    if (!fs.existsSync(cacheFile)) return;

    const data = JSON.parse(fs.readFileSync(cacheFile, "utf-8"));
    if (!data.gemini) data.gemini = {};
    if (!data.gemini.details) data.gemini.details = {};

    data.gemini.details.videoAnalysisVerified = true;
    data.gemini.details.lastVideoAnalysisAt = new Date().toISOString();

    fs.writeFileSync(cacheFile, JSON.stringify(data, null, 2), "utf-8");
  } catch {
    // ignore
  }
}
