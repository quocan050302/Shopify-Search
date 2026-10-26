import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { prisma } from "@/lib/db";

vi.mock("@/services/links/linkValidationService", async (importOriginal) => {
  const actual: any = await importOriginal();
  return {
    ...actual,
    fetchPublicResearchPage: vi.fn().mockResolvedValue({
      originalUrl: "https://cc.uprootclean.com/main/phr",
      finalUrl: "https://cc.uprootclean.com/main/phr",
      httpStatus: 200,
      statusClassification: "SUCCESS",
      content: `
        <!DOCTYPE html>
        <html>
          <head>
            <title>Uproot Clean - Ultimate Pet Hair Cleaner Pro</title>
            <script type="application/ld+json">
              {
                "@context": "https://schema.org",
                "@type": "Product",
                "name": "Uproot Cleaner Pro",
                "offers": {
                  "@type": "Offer",
                  "price": "29.99",
                  "priceCurrency": "USD"
                }
              }
            </script>
          </head>
          <body>
            <h1>Ultimate Pet Hair Cleaner Pro</h1>
            <button>Get Yours Now</button>
            <p>Free Shipping on orders over $50</p>
          </body>
        </html>
      `,
      contentLengthBytes: 600,
      headers: {},
      isTruncated: false,
      contentType: "text/html",
      durationMs: 12,
    }),
  };
});

import { executeKh01EndToEndAcceptance } from "../../scripts/kh01RealE2E";

describe("KH-01 Checkpoint 7 — Real End-to-End Acceptance (Queue -> Claim -> Fetch -> Persist -> Readback)", () => {
  const TEST_WORKSPACE = "ws_kh01_e2e_integration";

  beforeEach(async () => {
    await prisma.researchEvidence.deleteMany({ where: { workspaceId: TEST_WORKSPACE } });
    await prisma.landingPageSnapshot.deleteMany({ where: { workspaceId: TEST_WORKSPACE } });
    await prisma.competitorOfferSnapshot.deleteMany({ where: { workspaceId: TEST_WORKSPACE } });
    await prisma.syncJob.deleteMany({ where: { workspaceId: TEST_WORKSPACE } });
    await prisma.workspace.deleteMany({ where: { id: TEST_WORKSPACE } });

    await prisma.workspace.create({
      data: { id: TEST_WORKSPACE, name: "E2E Acceptance Workspace" },
    });
  });

  afterEach(async () => {
    await prisma.researchEvidence.deleteMany({ where: { workspaceId: TEST_WORKSPACE } });
    await prisma.landingPageSnapshot.deleteMany({ where: { workspaceId: TEST_WORKSPACE } });
    await prisma.competitorOfferSnapshot.deleteMany({ where: { workspaceId: TEST_WORKSPACE } });
    await prisma.syncJob.deleteMany({ where: { workspaceId: TEST_WORKSPACE } });
    await prisma.workspace.deleteMany({ where: { id: TEST_WORKSPACE } });
  });

  it("executes the complete KH-01 research lifecycle with actual persistence and readback", async () => {
    const report = await executeKh01EndToEndAcceptance({
      classification: "INTEGRATION_E2E",
      workspaceId: TEST_WORKSPACE,
    });

    if (report.overallStatus !== "ACCEPTED") {
      console.error("E2E Report Steps:", JSON.stringify(report.steps, null, 2));
    }

    expect(report.overallStatus).toBe("ACCEPTED");
    expect(report.manifest.landingSnapshotId).not.toBeNull();
    expect(report.manifest.jobId).not.toBeNull();
    expect(report.manifest.workerId).not.toBeNull();
    expect(report.manifest.claimToken).not.toBeNull();
    expect(report.manifest.recommendation).not.toBe("TEST_CANDIDATE"); // Missing supplier cost gate enforced

    // Verify snapshot in DB
    const snapshot = await prisma.landingPageSnapshot.findUnique({
      where: { id: report.manifest.landingSnapshotId! },
    });
    expect(snapshot).not.toBeNull();
    expect(snapshot?.workspaceId).toBe(TEST_WORKSPACE);

    // Verify job in DB
    const job = await prisma.syncJob.findUnique({
      where: { id: report.manifest.jobId! },
    });
    expect(job).not.toBeNull();
    expect(job?.status === "COMPLETED" || job?.status === "ACCESS_RESTRICTED").toBe(true);
  }, 25000);
});
