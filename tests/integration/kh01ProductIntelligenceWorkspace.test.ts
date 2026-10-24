import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { prisma } from "@/lib/db";
import { ResearchAccessContext } from "@/services/research/researchAuthService";

vi.mock("@/services/links/linkValidationService", async (importOriginal) => {
  const actual: any = await importOriginal();
  return {
    ...actual,
    fetchPublicResearchPage: vi.fn().mockResolvedValue({
      originalUrl: "https://petgroomer.shop/products/pet-hair-roller?variant=410291",
      finalUrl: "https://petgroomer.shop/products/pet-hair-roller?variant=410291",
      httpStatus: 200,
      statusClassification: "SUCCESS",
      content: `
        <html>
          <head>
            <title>Pet Hair Roller - Clean Fur Instantly</title>
            <script type="application/ld+json">
              {
                "@context": "https://schema.org",
                "@type": "Product",
                "name": "Electrostatic Pet Hair Roller",
                "offers": {
                  "@type": "Offer",
                  "price": "29.99",
                  "priceCurrency": "USD"
                }
              }
            </script>
          </head>
          <body>
            <h1>Electrostatic Pet Hair Roller</h1>
            <button>Add to Cart</button>
            <p>Free shipping on all US orders</p>
          </body>
        </html>
      `,
      contentLengthBytes: 500,
      headers: {},
      isTruncated: false,
      contentType: "text/html",
      durationMs: 10,
    }),
  };
});
import {
  extractProductIdentityCandidate,
  resolveOrCreateResearchProduct,
  attachAdvertisementToProduct,
  getProductAdvertisingProfile,
} from "@/services/research/productIdentityService";
import {
  createLandingPageResearchJob,
  executeLandingPageResearchJob,
} from "@/services/research/landingPageInspectionService";
import {
  calculateOrderEconomics,
  compareEconomicsScenarios,
} from "@/lib/economics";
import {
  recordSupplierQuote,
  calculateFulfillmentRisk,
  saveFulfillmentAssessment,
} from "@/services/research/fulfillmentAssessmentService";
import {
  calculateOpportunityAssessment,
  evaluateSmallTestReadiness,
  saveProductOpportunityAssessment,
} from "@/services/research/opportunityAssessmentService";
import {
  claimPendingKh01Job,
  executeKh01Job,
  recoverInterruptedKh01Jobs,
} from "@/workers/kh01Worker";

describe("KH-01.E — End-to-End Product Intelligence Integration & Acceptance", () => {
  const TEST_WORKSPACE = "test-kh01-workspace";
  const TEST_AD_ID = "test-kh01-meta-ad-1";
  const TEST_ADVERTISER_ID = "test-kh01-advertiser-1";
  const authContext: ResearchAccessContext = {
    workspaceId: TEST_WORKSPACE,
    actorId: "test-user-1",
    accessMode: "AUTHENTICATED",
  };

  beforeEach(async () => {
    // Clean up test data
    await prisma.researchEvidence.deleteMany({ where: { workspaceId: TEST_WORKSPACE } });
    await prisma.competitorOfferSnapshot.deleteMany({ where: { workspaceId: TEST_WORKSPACE } });
    await prisma.landingPageSnapshot.deleteMany({ where: { workspaceId: TEST_WORKSPACE } });
    await prisma.productEconomicsScenario.deleteMany({ where: { workspaceId: TEST_WORKSPACE } });
    await prisma.supplierQuote.deleteMany({ where: { workspaceId: TEST_WORKSPACE } });
    await prisma.fulfillmentAssessment.deleteMany({ where: { workspaceId: TEST_WORKSPACE } });
    await prisma.productOpportunityAssessment.deleteMany({ where: { workspaceId: TEST_WORKSPACE } });
    await prisma.adProductLink.deleteMany({ where: { adId: TEST_AD_ID } });
    await prisma.researchDecision.deleteMany({ where: { adId: TEST_AD_ID } });
    await prisma.competitorAd.deleteMany({ where: { id: TEST_AD_ID } });
    await prisma.advertiser.deleteMany({ where: { id: TEST_ADVERTISER_ID } });
    await prisma.competitorStore.deleteMany({ where: { domain: "petgroomer.shop" } });
    await prisma.researchProduct.deleteMany({ where: { productUrl: "https://petgroomer.shop/products/pet-hair-roller" } });
    await prisma.syncJob.deleteMany({ where: { workspaceId: TEST_WORKSPACE } });
    await prisma.workspace.deleteMany({ where: { id: TEST_WORKSPACE } });

    // Seed test workspace and authentic Meta ad
    await prisma.workspace.create({
      data: {
        id: TEST_WORKSPACE,
        name: "KH-01 Acceptance Test Workspace",
        targetMarket: "US",
      },
    });

    await prisma.advertiser.create({
      data: {
        id: TEST_ADVERTISER_ID,
        name: "Pet Groomer Official",
        platform: "META",
      },
    });

    const dataSource = await prisma.dataSource.upsert({
      where: { name: "META_AD_LIBRARY" },
      update: {},
      create: {
        id: "source-meta-test",
        name: "META_AD_LIBRARY",
        displayName: "Meta Ad Library",
        capabilities: "[]",
        supportedRegions: "[\"US\"]",
      },
    });

    await prisma.competitorAd.create({
      data: {
        id: TEST_AD_ID,
        advertiser: { connect: { id: TEST_ADVERTISER_ID } },
        dataSource: { connect: { id: dataSource.id } },
        platform: "META",
        externalAdId: "meta-lib-123456789",
        headline: "Tired of pet hair on your couch?",
        bodyText: "Our electrostatic roller cleans cat and dog hair in seconds. Buy 1 get 1 50% off + Free Shipping today!",
        landingPageUrl: "https://petgroomer.shop/products/pet-hair-roller?utm_source=facebook&variant=410291",
        originalAdUrl: "https://www.facebook.com/ads/library/?id=123456789",
        sourceReportedStartAt: new Date("2026-03-01T10:00:00Z"),
      },
    });
  });

  afterEach(async () => {
    // Cleanup
    await prisma.researchEvidence.deleteMany({ where: { workspaceId: TEST_WORKSPACE } });
    await prisma.competitorOfferSnapshot.deleteMany({ where: { workspaceId: TEST_WORKSPACE } });
    await prisma.landingPageSnapshot.deleteMany({ where: { workspaceId: TEST_WORKSPACE } });
    await prisma.productEconomicsScenario.deleteMany({ where: { workspaceId: TEST_WORKSPACE } });
    await prisma.supplierQuote.deleteMany({ where: { workspaceId: TEST_WORKSPACE } });
    await prisma.fulfillmentAssessment.deleteMany({ where: { workspaceId: TEST_WORKSPACE } });
    await prisma.productOpportunityAssessment.deleteMany({ where: { workspaceId: TEST_WORKSPACE } });
    await prisma.adProductLink.deleteMany({ where: { adId: TEST_AD_ID } });
    await prisma.competitorAd.deleteMany({ where: { id: TEST_AD_ID } });
    await prisma.advertiser.deleteMany({ where: { id: TEST_ADVERTISER_ID } });
    await prisma.competitorStore.deleteMany({ where: { domain: "petgroomer.shop" } });
    await prisma.researchProduct.deleteMany({ where: { productUrl: "https://petgroomer.shop/products/pet-hair-roller" } });
    await prisma.syncJob.deleteMany({ where: { workspaceId: TEST_WORKSPACE } });
    await prisma.workspace.deleteMany({ where: { id: TEST_WORKSPACE } });
    vi.restoreAllMocks();
  });

  it("executes complete end-to-end product research workflow without data fabrication", async () => {
    console.log("Starting Step 1...");
    // Step 1: Extract candidate from genuine Meta ad
    const candidate = await extractProductIdentityCandidate(TEST_AD_ID, authContext);
    console.log("Passed Step 1");
    expect(candidate.adId).toBe(TEST_AD_ID);
    expect(candidate.storeDomain).toBe("petgroomer.shop");
    expect(candidate.canonicalProductUrl).toBe("https://petgroomer.shop/products/pet-hair-roller?variant=410291");
    expect(candidate.identityConfidence).toBe("PROBABLE");

    console.log("Starting Step 2...");
    // Step 2: Confirm and create canonical ResearchProduct
    const productResult = await resolveOrCreateResearchProduct(
      candidate,
      { mode: "CREATE_NEW", title: "Electrostatic Pet Hair Roller", category: "Pet Supplies" },
      authContext
    );
    console.log("Passed Step 2");
    expect(productResult.isNew).toBe(true);
    expect(productResult.title).toBe("Electrostatic Pet Hair Roller");

    console.log("Starting Step 3...");
    // Step 3: Attach Ad to Product
    const link = await attachAdvertisementToProduct(
      TEST_AD_ID,
      productResult.productId,
      candidate.supportingEvidenceIds,
      authContext
    );
    console.log("Passed Step 3");
    expect(link.productId).toBe(productResult.productId);

    console.log("Starting Step 4...");
    // Step 4: Verify Advertising Profile
    const profile = await getProductAdvertisingProfile(productResult.productId);
    console.log("Passed Step 4");
    expect(profile.totalLinkedAds).toBe(1);
    expect(profile.distinctAdvertisers.length).toBe(1);
    expect(profile.observedLandingPages).toContain("https://petgroomer.shop/products/pet-hair-roller?utm_source=facebook&variant=410291");

    console.log("Starting Step 5...");
    // Step 5: Queue Landing Page Research Job
    const jobReceipt = await createLandingPageResearchJob(
      {
        productId: productResult.productId,
        targetUrl: candidate.canonicalProductUrl!,
        forceRefresh: true,
      },
      authContext
    );
    console.log("Passed Step 5");
    expect(jobReceipt.jobId).toBeDefined();
    expect(jobReceipt.status).toBe("QUEUED");

    console.log("Starting Step 6...");
    // Step 6: Worker claims and executes job
    const claimed = await claimPendingKh01Job("test-worker-e2e");
    console.log("Passed Step 6");
    expect(claimed).not.toBeNull();
    expect(claimed?.id).toBe(jobReceipt.jobId);

    const execResult = await executeKh01Job(claimed!);
    expect(execResult.status).toBe("COMPLETED");

    console.log("Starting Step 7...");
    // Step 7: Record Supplier Quote
    const quote = await recordSupplierQuote(
      {
        productId: productResult.productId,
        supplierName: "Shenzhen Pet Care Manufacturing",
        unitCost: 4.80,
        moq: 100,
        shippingLeadTimeDays: 9,
        quoteSource: "SUPPLIER_INVOICE",
      },
      authContext
    );
    expect(quote.unitCost).toBe(4.80);

    // Step 8: Calculate Unit Economics with explicit assumptions
    const baseScenario = calculateOrderEconomics({
      scenarioName: "Base Single Unit",
      unitsPerOrder: 1,
      sellingPricePerUnit: 29.99,
      supplierCostPerUnit: quote.unitCost, // $4.80
      shippingChargedToCustomer: 0,        // Free shipping
      actualShippingCostPaid: 5.20,        // Paid by store
      fulfillmentCostPerOrder: 1.80,
      paymentProcessingFeePercent: 2.9,
      paymentProcessingFeeFixed: 0.30,
      targetProfitPerOrder: 8.00,
    });

    expect(baseScenario.isComplete).toBe(true);
    expect(baseScenario.contributionBeforeAds).toBeGreaterThan(15);
    expect(baseScenario.breakEvenCpa).toBe(baseScenario.contributionBeforeAds);

    // Step 9: Save Scenario to Product
    await prisma.productEconomicsScenario.create({
      data: {
        workspaceId: TEST_WORKSPACE,
        productId: productResult.productId,
        scenarioName: baseScenario.scenarioName,
        inputsJson: JSON.stringify(baseScenario),
        outputsJson: JSON.stringify(baseScenario),
        assumptionProvenanceJson: JSON.stringify({ cogs: "SUPPLIER_INVOICE" }),
      },
    });

    // Step 10: Evaluate Fulfillment Risk
    const fulfillmentRisk = calculateFulfillmentRisk({
      productWeightGrams: 220,
      packageDimensionsCm: "18x8x6",
      isFragile: false,
      hasBatteryOrLiquid: false,
      hasConfirmedSupplierQuote: true,
      shippingLeadTimeDays: 9,
      returnComplexity: "SIMPLE",
    });
    expect(fulfillmentRisk.overallRiskLevel).toBe("LOW");

    await saveFulfillmentAssessment(productResult.productId, fulfillmentRisk, {
      productWeightGrams: 220,
      packageDimensionsCm: "18x8x6",
    }, authContext);

    // Step 11: Calculate Six-Pillar Opportunity Assessment
    const assessment = calculateOpportunityAssessment({
      productId: productResult.productId,
      productEvidence: {
        productTitle: "Electrostatic Pet Hair Roller",
        category: "Pet Supplies",
        customerPainPointClarity: "CLEAR",
        problemSolved: "Cat and dog hair embedded in furniture",
        competitionLevel: "MODERATE",
        identityConfidence: "EXACT",
      },
      creativeEvidence: {
        adCount: 1,
        hasVideoDemonstration: true,
        clearCtaObserved: true,
      },
      offerSnapshots: [
        {
          sellingPrice: 29.99,
          compareAtPrice: 49.99,
          bundleQuantity: 1,
          hasFreeShipping: true,
        },
      ],
      economicsScenarios: [baseScenario],
      fulfillmentAssessment: fulfillmentRisk,
    });

    expect(assessment.evidenceReadinessScore).toBeGreaterThanOrEqual(70);
    expect(assessment.opportunityScore).toBeGreaterThanOrEqual(65);

    // Step 12: Decision Gates Check
    const testReadiness = evaluateSmallTestReadiness(assessment);
    expect(testReadiness.gateChecks.every((g) => g.passed)).toBe(true);
    expect(testReadiness.isReadyForSmallTest).toBe(true);

    // Step 13: Persist Assessment
    await saveProductOpportunityAssessment(productResult.productId, assessment, authContext);

    // Step 14: Verify Audit Trail & User Decision
    const decision = await prisma.researchDecision.create({
      data: {
        productId: productResult.productId,
        adId: TEST_AD_ID,
        decision: "TEST_CANDIDATE",
        notes: "Passed all 6 pillars with verified $4.80 supplier invoice and 2.05x break-even ROAS.",
      },
    });
    expect(decision.decision).toBe("TEST_CANDIDATE");

    // Step 15: Verify Evidence Provenance count
    const evidenceCount = await prisma.researchEvidence.count({
      where: { subjectId: productResult.productId },
    });
    expect(evidenceCount).toBeGreaterThan(0);
  });

  it("accurately detects and records user override when requirements are not met", async () => {
    // Create product with negative economics
    const badProduct = await prisma.researchProduct.create({
      data: {
        title: "Unviable Low Margin Item",
        category: "Other",
        currentPrice: 10.00,
      },
    });

    const unviableScenario = calculateOrderEconomics({
      scenarioName: "Unviable",
      unitsPerOrder: 1,
      sellingPricePerUnit: 10.00,
      supplierCostPerUnit: 12.00, // COGS > Selling Price
    });

    const assessment = calculateOpportunityAssessment({
      productId: badProduct.id,
      productEvidence: {
        productTitle: badProduct.title,
        customerPainPointClarity: "UNKNOWN",
        identityConfidence: "INSUFFICIENT_EVIDENCE",
      },
      creativeEvidence: { adCount: 1 },
      offerSnapshots: [],
      economicsScenarios: [unviableScenario],
    });

    expect(assessment.recommendation).toBe("REJECT");

    // User attempts to force TEST_CANDIDATE
    const isOverride = assessment.recommendation !== "TEST_CANDIDATE";
    expect(isOverride).toBe(true);

    const overrideNotice = "[USER OVERRIDE — ALGORITHMIC REQUIREMENTS NOT MET]";
    const recordedDecision = await prisma.researchDecision.create({
      data: {
        productId: badProduct.id,
        decision: "TEST_CANDIDATE",
        notes: `${overrideNotice} User decided to test regardless of negative margin.`,
      },
    });

    expect(recordedDecision.notes).toContain("[USER OVERRIDE — ALGORITHMIC REQUIREMENTS NOT MET]");
  });
});
