/**
 * SWAI KH-02 V12.1.1 — Runtime Hardening & Provider Capabilities Test Suite
 *
 * Covers:
 * 1. Google Ads MCP: capability discovery, schema validation, tool invocation, and normalization
 * 2. Meta Ads: geographic delivery market provenance resolution
 * 3. HasData: credit authority, quota validation, and usage reconciliation
 * 4. TikTok Organic: capability resolution and collection safety
 * 5. Research Worker: atomic job claim, lease renewal, crash recovery, and error classification
 * 6. Provenance & Reconciliation: observation identity, card tracing, and cross-layer consistency
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  discoverGoogleAdsMcpCapabilities,
  validateGoogleMcpToolArguments,
  invokeGoogleMcpTool,
  normalizeGoogleAdsResponse,
  GoogleTransparencyMcpClient,
} from "@/services/kh02/providers/googleTransparencyResearchAdapter";
import {
  resolveMetaMarketProvenance,
} from "@/services/kh02/providers/metaResearchAdapter";
import {
  fetchHasDataCreditStatus,
  evaluateHasDataQuota,
  reconcileHasDataUsage,
} from "@/services/kh02/providers/hasDataCreditService";
import {
  resolveTikTokCapabilities,
  collectTikTokOrganicEvidence,
} from "@/services/kh02/providers/tiktokOrganicResearchAdapter";
import {
  claimNextResearchJob,
  renewResearchJobLease,
  recoverStaleResearchJobs,
  classifyResearchError,
  computeResearchIdempotencyKey,
  getResearchWorkerHealth,
} from "@/workers/kh02Worker";
import {
  validateResearchProvenance,
  buildObservationIdentity,
  assertSafeTestDatabase,
  reconcileResearchAcrossLayers,
  traceProductCardEvidence,
} from "@/services/kh02/persistence/kh02PersistenceService";
import { prisma } from "@/lib/db";

describe("SWAI KH-02 V12.1.1 — Runtime Hardening & Provider Contract Suite", () => {
  const TEST_WORKSPACE = `ws_v12_1_1_${Date.now()}`;

  beforeEach(async () => {
    await prisma.workspace.create({
      data: {
        id: TEST_WORKSPACE,
        name: "V12.1.1 Test Workspace",
        operatingMode: "RESEARCH_ONLY",
      },
    });
  });

  afterEach(async () => {
    await prisma.syncJob.deleteMany({
      where: { workspaceId: TEST_WORKSPACE },
    });
    await prisma.workspace.deleteMany({
      where: { id: TEST_WORKSPACE },
    });
  });

  // ── 1. Google MCP Tool Validation & Discovery ─────────────────────────────
  describe("1. Google Ads MCP Contract & Schema Validation", () => {
    it("validates tool arguments against advertised JSON schema", () => {
      const schema = {
        type: "object",
        properties: {
          domain: { type: "string" },
          count: { type: "number" },
        },
        required: ["domain"],
      };

      // Valid call
      const validRes = validateGoogleMcpToolArguments(schema, { domain: "petgrooming.com", count: 10 });
      expect(validRes.valid).toBe(true);
      expect(validRes.errors).toHaveLength(0);

      // Missing required parameter
      const missingRes = validateGoogleMcpToolArguments(schema, { count: 10 });
      expect(missingRes.valid).toBe(false);
      expect(missingRes.errors[0]).toContain("Missing required parameter: 'domain'");

      // Incorrect type
      const typeMismatchRes = validateGoogleMcpToolArguments(schema, { domain: 12345 });
      expect(typeMismatchRes.valid).toBe(false);
      expect(typeMismatchRes.errors[0]).toContain("expected string");
    });

    it("discovers MCP capabilities and maps available operations", async () => {
      const mockClient: GoogleTransparencyMcpClient = {
        connect: async () => {},
        listTools: async () => ["search_advertiser_by_domain", "get_ads", "get_ad_detail"],
        searchAdvertisers: async () => ({}),
        searchAdvertiserByDomain: async () => ({ ads: [] }),
        getAds: async () => ({ ads: [] }),
        getAdDetail: async () => ({}),
        close: async () => {},
        isAlive: () => true,
      };

      const capabilities = await discoverGoogleAdsMcpCapabilities({}, mockClient);
      expect(capabilities.transportConnected).toBe(true);
      expect(capabilities.supportedOperations.domainLookup).toBe(true);
      expect(capabilities.supportedOperations.adsRetrieval).toBe(true);
      expect(capabilities.supportedOperations.adDetail).toBe(true);
      expect(capabilities.matchedTools.domainLookupTool).toBe("search_advertiser_by_domain");
    });

    it("normalizes Google Ads responses with strict US delivery market checks", () => {
      const rawPayload = {
        ads: [
          {
            id: "g_ad_101",
            advertiser_name: "PupClean Co",
            advertiser_id: "adv_99",
            headline: "Best Dog Grooming Brush 2026",
            body: "Keep your home free from pet hair with our self-cleaning brush",
            format: "video",
            region: "US", // Explicit US delivery
            last_shown: "2026-03-15",
          },
          {
            id: "g_ad_102",
            advertiser_name: "PupClean Co",
            advertiser_id: "adv_99",
            headline: "International Shipping Available",
            format: "image",
            region: "GB", // Non-US
            last_shown: "2026-03-14",
          },
        ],
      };

      const result = normalizeGoogleAdsResponse(rawPayload, {
        requestedDomain: "pupclean.com",
        topic: "Dog Grooming Brush",
        observedAt: "2026-03-20T00:00:00.000Z",
        toolName: "search_advertiser_by_domain",
      });

      expect(result.totalExtracted).toBe(2);
      expect(result.ads[0].verifiedDeliveryMarket).toBe("US");
      expect(result.ads[0].productRelevance).toBe("PRODUCT_SPECIFIC");
      expect(result.ads[1].verifiedDeliveryMarket).toBeNull(); // Non-US remains null for US research
    });
  });

  // ── 2. Meta Geographic Provenance ─────────────────────────────────────────
  describe("2. Meta Ads Geographic Provenance", () => {
    it("reports UNKNOWN for verified delivery market when provider data lacks explicit US region", () => {
      const unverifiedAd = {
        id: "ad_meta_unknown",
        platform: "META",
        targetMarket: "UNKNOWN",
        advertiser: { name: "Store X", country: "US" }, // Advertiser country is NOT delivery market
      };

      const prov = resolveMetaMarketProvenance(unverifiedAd, { requestedMarket: "US" });
      expect(prov.requestedMarket).toBe("US");
      expect(prov.verifiedDeliveryMarket).toBeNull();
      expect(prov.marketVerification).toBe("UNKNOWN");
    });

    it("confirms verifiedDeliveryMarket = US only when explicitly reported by provider", () => {
      const verifiedAd = {
        id: "ad_meta_verified",
        platform: "META",
        targetMarket: "US",
        dataSource: { supportedRegions: "US,CA" },
      };

      const prov = resolveMetaMarketProvenance(verifiedAd, { requestedMarket: "US" });
      expect(prov.requestedMarket).toBe("US");
      expect(prov.verifiedDeliveryMarket).toBe("US");
      expect(prov.marketVerification).toBe("VERIFIED");
    });
  });

  // ── 3. HasData Credit Authority ───────────────────────────────────────────
  describe("3. HasData Credit Authority & Quota Validation", () => {
    it("returns UNCONFIGURED and blocks spend when API key is missing", async () => {
      const status = await fetchHasDataCreditStatus({ apiKey: "" });
      expect(status.authority).toBe("UNCONFIGURED");
      expect(status.remainingCredits).toBeNull();

      const quota = evaluateHasDataQuota(status, {
        operationType: "TIKTOK_ORGANIC_SEARCH",
        estimatedRequests: 1,
        creditsPerRequest: 1,
      });

      expect(quota.isAllowed).toBe(false);
      expect(quota.decision).toBe("QUOTA_UNAVAILABLE");
    });

    it("enforces fail-closed safety policy when AUTO_PAID_RESEARCH is false", () => {
      const originalEnv = process.env.AUTO_PAID_RESEARCH;
      delete process.env.AUTO_PAID_RESEARCH;

      const creditStatus = {
        totalCredits: 1000,
        usedCredits: 200,
        remainingCredits: 800,
        billingPeriod: "2026-03",
        retrievedAt: new Date().toISOString(),
        unit: "CREDITS",
        authority: "AUTHORITATIVE_API" as const,
        verificationStatus: "VERIFIED" as const,
      };

      const quota = evaluateHasDataQuota(creditStatus, {
        operationType: "TIKTOK_ORGANIC_SEARCH",
        estimatedRequests: 1,
        creditsPerRequest: 1,
      });

      expect(quota.isAllowed).toBe(false);
      expect(quota.reason).toContain("AUTO_PAID_RESEARCH is false");

      process.env.AUTO_PAID_RESEARCH = originalEnv;
    });

    it("reconciles credit consumption against observed balance changes", () => {
      const before = {
        totalCredits: 1000,
        usedCredits: 100,
        remainingCredits: 900,
        billingPeriod: null,
        retrievedAt: new Date().toISOString(),
        unit: "CREDITS",
        authority: "AUTHORITATIVE_API" as const,
        verificationStatus: "VERIFIED" as const,
      };

      const after = {
        ...before,
        usedCredits: 102,
        remainingCredits: 898,
      };

      const reconciliation = reconcileHasDataUsage(before, after, [
        { id: "op_1", type: "TIKTOK_SEARCH", estimatedCredits: 2, observedSuccess: true, timestamp: "" },
      ]);

      expect(reconciliation.reconciliationStatus).toBe("MATCHED");
      expect(reconciliation.creditsConsumedObserved).toBe(2);
    });
  });

  // ── 4. TikTok Capabilities Resolution ─────────────────────────────────────
  describe("4. TikTok Capabilities Resolution", () => {
    it("distinguishes TikTok Organic from Paid Ads capabilities", async () => {
      const caps = await resolveTikTokCapabilities({ apiKey: "test_hasdata_key" });
      expect(caps.organicVideoSearchSupported).toBe(true);
      expect(caps.videoMetricsSupported).toBe(true);
      expect(caps.paidAdsSupported).toBe(false); // Paid ads is separate capability
      expect(caps.status).toBe("AVAILABLE");
    });
  });

  // ── 5. Worker Atomic Claims, Fencing, and Recovery ─────────────────────────
  describe("5. Research Worker Lifecycle & Fencing", () => {
    it("atomically claims a PENDING job and advances fencing token", async () => {
      // Seed pending job
      const job = await prisma.syncJob.create({
        data: {
          id: `job_claim_${Date.now()}`,
          workspaceId: TEST_WORKSPACE,
          jobType: "KH02_RESEARCH",
          status: "PENDING",
          resultJson: JSON.stringify({ topic: "Dog Whistle" }),
        },
      });

      const claimed = await claimNextResearchJob("test-worker-1");
      expect(claimed).not.toBeNull();
      expect(claimed?.id).toBe(job.id);
      expect(claimed?.status).toBe("RUNNING");
      expect(claimed?.fencingVersion).toBe(1);

      // Second worker attempting to claim must get null (atomic claim fencing)
      const secondClaim = await claimNextResearchJob("test-worker-2");
      expect(secondClaim).toBeNull();
    });

    it("renews lease with matching fencing token and rejects mismatched token", async () => {
      const job = await prisma.syncJob.create({
        data: {
          id: `job_lease_${Date.now()}`,
          workspaceId: TEST_WORKSPACE,
          jobType: "KH02_RESEARCH",
          status: "RUNNING",
          resultJson: JSON.stringify({
            topic: "Cat Litter Box",
            _runtime: {
              workerId: "worker-alpha",
              fencingToken: "token-secret-123",
              fencingVersion: 1,
              leaseExpiresAt: new Date(Date.now() + 30000).toISOString(),
            },
          }),
        },
      });

      // Valid renewal
      const validRenewal = await renewResearchJobLease(job.id, "worker-alpha", "token-secret-123");
      expect(validRenewal.renewed).toBe(true);
      expect(validRenewal.fencingVersion).toBe(2);

      // Mismatched token rejected
      const invalidRenewal = await renewResearchJobLease(job.id, "worker-alpha", "forged-token");
      expect(invalidRenewal.renewed).toBe(false);
      expect(invalidRenewal.error).toContain("mismatch");
    });

    it("recovers crashed worker jobs whose leases have expired", async () => {
      const expiredLeaseTime = new Date(Date.now() - 10000).toISOString();
      const staleJob = await prisma.syncJob.create({
        data: {
          id: `job_stale_${Date.now()}`,
          workspaceId: TEST_WORKSPACE,
          jobType: "KH02_RESEARCH",
          status: "RUNNING",
          resultJson: JSON.stringify({
            topic: "Pet Camera",
            _runtime: {
              workerId: "crashed-worker",
              fencingToken: "token-crashed",
              attemptNumber: 1,
              leaseExpiresAt: expiredLeaseTime,
            },
          }),
        },
      });

      const recovery = await recoverStaleResearchJobs();
      expect(recovery.recoveredCount).toBeGreaterThanOrEqual(1);

      const recoveredJob = await prisma.syncJob.findUnique({ where: { id: staleJob.id } });
      expect(recoveredJob?.status).toBe("PENDING");
      expect(recoveredJob?.errorMessage).toContain("Recovered from stale worker lease expiry");
    });

    it("classifies errors accurately into retryable vs non-retryable", () => {
      const authErr = classifyResearchError(new Error("VALIDATION_FAILED: Invalid market parameter"));
      expect(authErr.retryable).toBe(false);

      const timeoutErr = classifyResearchError(new Error("Connection timeout after 5000ms"));
      expect(timeoutErr.retryable).toBe(true);
      expect(timeoutErr.backoffMs).toBe(5000);
    });

    it("computes deterministic idempotency keys", () => {
      const key1 = computeResearchIdempotencyKey(
        { topic: "Dog Toys", market: "US", lookbackDays: 90, workspaceId: TEST_WORKSPACE },
        { workspaceId: TEST_WORKSPACE }
      );
      const key2 = computeResearchIdempotencyKey(
        { topic: "  dog toys  ", market: "US", lookbackDays: 90, workspaceId: TEST_WORKSPACE },
        { workspaceId: TEST_WORKSPACE }
      );
      expect(key1).toBe(key2);
    });

    it("reports live worker telemetry and health", () => {
      const health = getResearchWorkerHealth();
      expect(health.workerId).toContain("kh02-worker");
      expect(typeof health.uptimeSeconds).toBe("number");
      expect(health.lastHeartbeatAt).toBeTruthy();
    });
  });

  // ── 6. Provenance Validation & Cross-Layer Reconciliation ──────────────────
  describe("6. Provenance Validation & Cross-Layer Traceability", () => {
    it("validates observation provenance completeness", () => {
      const validObs = {
        source: "META_ADS",
        sourceRecordId: "meta_123",
        sourceUrl: "https://facebook.com/ads/library/?id=123",
        observedAt: new Date().toISOString(),
      };
      expect(validateResearchProvenance(validObs).valid).toBe(true);

      const invalidObs = {
        sourceRecordId: "meta_123",
      };
      const valRes = validateResearchProvenance(invalidObs);
      expect(valRes.valid).toBe(false);
      expect(valRes.errors.length).toBeGreaterThan(0);
    });

    it("builds deterministic observation identity keys for time-series deduplication", () => {
      const id1 = buildObservationIdentity("META_ADS", { id: "ad_99", observedAt: "2026-03-01T10:00:00Z" });
      const id2 = buildObservationIdentity("META_ADS", { id: "ad_99", observedAt: "2026-03-01T18:00:00Z" });
      const id3 = buildObservationIdentity("META_ADS", { id: "ad_99", observedAt: "2026-03-02T10:00:00Z" });

      expect(id1.identityKey).toBe(id2.identityKey); // Same day snapshot
      expect(id1.identityKey).not.toBe(id3.identityKey); // Distinct day snapshot
    });

    it("traces displayed product card back to persisted evidence references", async () => {
      const runId = `run_trace_${Date.now()}`;
      await prisma.syncJob.create({
        data: {
          id: runId,
          workspaceId: TEST_WORKSPACE,
          jobType: "KH02_RESEARCH",
          status: "COMPLETED",
          resultJson: JSON.stringify({
            topThree: [
              {
                rank: 1,
                candidate: {
                  candidateId: "cand_pet_brush",
                  researchProductId: "prod_pet_brush",
                  title: "Self Cleaning Dog Brush",
                  canonicalProductUrl: "https://petbrush.com/products/brush",
                  storeDomain: "petbrush.com",
                  sourceObservations: [
                    { source: "META_ADS", sourceRecordId: "ad_1", evidenceReference: "Ad:1" },
                    { source: "TIKTOK_ORGANIC", sourceRecordId: "tt_1", evidenceReference: "Video:1" },
                  ],
                },
                score: { opportunityScore: 88 },
              },
            ],
          }),
        },
      });

      const trace = await traceProductCardEvidence("cand_pet_brush", runId);
      expect(trace).not.toBeNull();
      expect(trace?.title).toBe("Self Cleaning Dog Brush");
      expect(trace?.sources).toEqual(["META_ADS", "TIKTOK_ORGANIC"]);
      expect(trace?.evidenceReferences).toEqual(["Ad:1", "Video:1"]);
    });

    it("reconciles research across database snapshot and runtime state", async () => {
      const runId = `run_reconcile_${Date.now()}`;
      await prisma.syncJob.create({
        data: {
          id: runId,
          workspaceId: TEST_WORKSPACE,
          jobType: "KH02_RESEARCH",
          status: "COMPLETED",
          resultJson: JSON.stringify({
            totalCandidatesDiscovered: 4,
            topThree: [{ rank: 1, candidate: { title: "Item 1" } }],
          }),
        },
      });

      const reconciliation = await reconcileResearchAcrossLayers(runId);
      expect(reconciliation.reconciliationVerdict).toBe("RECONCILED");
      expect(reconciliation.candidatesCount).toBe(4);
      expect(reconciliation.topThreeCount).toBe(1);
    });

    it("prevents test suite execution against production databases", () => {
      expect(() => {
        assertSafeTestDatabase({ url: "file:./prod.db" });
      }).toThrow(/Safety violation/);
    });
  });
});
