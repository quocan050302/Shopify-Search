import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs";
import path from "path";
import crypto from "crypto";
import {
  collectScreenshotEvidence,
  stageScreenshotArtifacts,
  ScreenshotEvidence,
} from "../../scripts/kh01/runFullAcceptance";

describe("KH-01 Screenshot Evidence Integrity (FINAL-04)", () => {
  const testScratchDir = path.resolve(process.cwd(), "artifacts/test_scratch_screenshots");
  const testStagingDir = path.resolve(process.cwd(), "artifacts/test_staging_screenshots");
  const dummyRunId = "kh01_rel_screenshot_test";

  const canonicalViewports = [
    { width: 1920, height: 1080 },
    { width: 1440, height: 900 },
    { width: 1280, height: 800 },
    { width: 1024, height: 768 },
    { width: 768, height: 1024 },
    { width: 390, height: 844 },
  ];

  beforeEach(() => {
    if (fs.existsSync(testScratchDir)) {
      fs.rmSync(testScratchDir, { recursive: true, force: true });
    }
    if (fs.existsSync(testStagingDir)) {
      fs.rmSync(testStagingDir, { recursive: true, force: true });
    }
    fs.mkdirSync(testScratchDir, { recursive: true });
    fs.mkdirSync(testStagingDir, { recursive: true });
  });

  afterEach(() => {
    if (fs.existsSync(testScratchDir)) {
      fs.rmSync(testScratchDir, { recursive: true, force: true });
    }
    if (fs.existsSync(testStagingDir)) {
      fs.rmSync(testStagingDir, { recursive: true, force: true });
    }
  });

  function createValidScreenshots(dir: string, count: number = 6) {
    for (let i = 0; i < count; i++) {
      const vp = canonicalViewports[i];
      const filename = `viewport_${vp.width}x${vp.height}.png`;
      const filePath = path.join(dir, filename);
      // Write mock PNG bytes (8-byte PNG signature + dummy image payload)
      const pngHeader = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, i, i + 1, i + 2]);
      fs.writeFileSync(filePath, pngHeader);
    }
  }

  describe("collectScreenshotEvidence()", () => {
    it("collects all 6 canonical screenshots with valid SHA256 hashes", async () => {
      createValidScreenshots(testScratchDir, 6);

      const evidence = await collectScreenshotEvidence(testScratchDir, {
        acceptanceRunId: dummyRunId,
      });

      expect(evidence.length).toBe(6);
      for (const item of evidence) {
        expect(item.acceptanceRunId).toBe(dummyRunId);
        expect(item.fileExists).toBe(true);
        expect(item.fileSizeBytes).toBeGreaterThan(0);
        expect(item.sha256).toMatch(/^[a-f0-9]{64}$/);
        expect(item.associatedViewportStatus).toBe("PASSED");
        expect(item.relativePath).toContain("viewport_");
      }
    });

    it("marks missing screenshot as FAILED", async () => {
      // Create only first 5 screenshots, leaving mobile 390x844 missing
      createValidScreenshots(testScratchDir, 5);

      const evidence = await collectScreenshotEvidence(testScratchDir, {
        acceptanceRunId: dummyRunId,
      });

      expect(evidence.length).toBe(6);
      const missingItem = evidence.find((e) => e.width === 390 && e.height === 844);
      expect(missingItem).toBeDefined();
      expect(missingItem?.fileExists).toBe(false);
      expect(missingItem?.fileSizeBytes).toBe(0);
      expect(missingItem?.sha256).toBe("");
      expect(missingItem?.associatedViewportStatus).toBe("FAILED");
    });

    it("marks zero-byte screenshot as FAILED", async () => {
      createValidScreenshots(testScratchDir, 5);
      // Create 6th as empty 0-byte file
      const emptyFile = path.join(testScratchDir, "viewport_390x844.png");
      fs.writeFileSync(emptyFile, Buffer.alloc(0));

      const evidence = await collectScreenshotEvidence(testScratchDir, {
        acceptanceRunId: dummyRunId,
      });

      const zeroByteItem = evidence.find((e) => e.width === 390 && e.height === 844);
      expect(zeroByteItem?.fileExists).toBe(false);
      expect(zeroByteItem?.fileSizeBytes).toBe(0);
      expect(zeroByteItem?.associatedViewportStatus).toBe("FAILED");
    });
  });

  describe("stageScreenshotArtifacts()", () => {
    it("stages all 6 valid screenshots and verifies checksum equality", async () => {
      createValidScreenshots(testScratchDir, 6);
      const evidence = await collectScreenshotEvidence(testScratchDir, {
        acceptanceRunId: dummyRunId,
      });

      const stagingResult = await stageScreenshotArtifacts(evidence, testStagingDir);
      expect(stagingResult.success).toBe(true);
      expect(stagingResult.copiedCount).toBe(6);
      expect(stagingResult.errors.length).toBe(0);

      // Verify files copied to staging/screenshots/
      for (const item of stagingResult.stagedScreenshots) {
        expect(fs.existsSync(item.targetPath)).toBe(true);
        const diskBuf = fs.readFileSync(item.targetPath);
        const diskHash = crypto.createHash("sha256").update(diskBuf).digest("hex");
        expect(diskHash).toBe(item.sha256);
      }
    });

    it("fails staging when an evidence item is missing or corrupted", async () => {
      const invalidEvidence: ScreenshotEvidence[] = [
        {
          acceptanceRunId: dummyRunId,
          testId: "STAGE_TEST",
          width: 1920,
          height: 1080,
          relativePath: "screenshots/viewport_1920x1080.png",
          originalPath: path.join(testScratchDir, "non_existent.png"),
          capturedAt: new Date().toISOString(),
          fileExists: true,
          fileSizeBytes: 100,
          sha256: "fake_hash",
          browserName: "chromium",
          associatedViewportStatus: "PASSED",
        },
      ];

      const stagingResult = await stageScreenshotArtifacts(invalidEvidence, testStagingDir);
      expect(stagingResult.success).toBe(false);
      expect(stagingResult.errors.length).toBeGreaterThan(0);
      expect(stagingResult.errors[0]).toContain("source file missing on disk");
    });

    it("ensures Run A and Run B do not overwrite each other's screenshots", async () => {
      const stagingDirRunA = path.join(testStagingDir, "run_A");
      const stagingDirRunB = path.join(testStagingDir, "run_B");

      createValidScreenshots(testScratchDir, 6);
      const evidence = await collectScreenshotEvidence(testScratchDir, {
        acceptanceRunId: "run_A",
      });

      const resA = await stageScreenshotArtifacts(evidence, stagingDirRunA);
      expect(resA.success).toBe(true);

      // Modify scratch file for Run B
      const modifiedBuf = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0xaa, 0xbb, 0xcc, 0xdd]);
      fs.writeFileSync(path.join(testScratchDir, "viewport_1920x1080.png"), modifiedBuf);

      const evidenceB = await collectScreenshotEvidence(testScratchDir, {
        acceptanceRunId: "run_B",
      });
      const resB = await stageScreenshotArtifacts(evidenceB, stagingDirRunB);
      expect(resB.success).toBe(true);

      // Run A screenshot file remains untouched
      const fileA = path.join(stagingDirRunA, "screenshots", "viewport_1920x1080.png");
      const fileB = path.join(stagingDirRunB, "screenshots", "viewport_1920x1080.png");

      const hashA = crypto.createHash("sha256").update(fs.readFileSync(fileA)).digest("hex");
      const hashB = crypto.createHash("sha256").update(fs.readFileSync(fileB)).digest("hex");

      expect(hashA).not.toBe(hashB);
      expect(hashA).toBe(evidence[0].sha256);
      expect(hashB).toBe(evidenceB[0].sha256);
    });
  });
});
