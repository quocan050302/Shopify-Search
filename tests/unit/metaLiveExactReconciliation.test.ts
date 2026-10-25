import { describe, it, expect } from "vitest";
import {
  findDuplicateIds,
  reconcileExactAdIdSets,
  finalizeLiveJourneyVerdict,
  verifyWorkerProvenance,
  ExactAdIdReconciliationInput,
  LiveJourneyGateResults,
} from "@/services/discovery/metaCollector/metaExactReconciliation";

describe("Strict Ad ID Reconciliation & Live Verdict Helpers (Sections 07, 08, 22, 24)", () => {
  const generateAdIds = (count: number, prefix = "ad_"): string[] =>
    Array.from({ length: count }, (_, i) => `${prefix}${String(i + 1).padStart(3, "0")}`);

  describe("findDuplicateIds()", () => {
    it("returns empty array when no duplicates exist", () => {
      const ids = ["id_1", "id_2", "id_3"];
      expect(findDuplicateIds(ids)).toEqual([]);
    });

    it("identifies single duplicate ID", () => {
      const ids = ["id_1", "id_2", "id_3", "id_2"];
      expect(findDuplicateIds(ids)).toEqual(["id_2"]);
    });

    it("identifies multiple duplicate IDs deterministically", () => {
      const ids = ["c", "a", "b", "a", "c", "d", "c"];
      expect(findDuplicateIds(ids)).toEqual(["a", "c"]);
    });

    it("safely handles empty strings and whitespace", () => {
      const ids = ["id_1", "", "   ", "id_1"];
      expect(findDuplicateIds(ids)).toEqual(["id_1"]);
    });
  });

  describe("reconcileExactAdIdSets() — REC-01 to REC-12", () => {
    // REC-01: All 25 IDs match
    it("REC-01: passes when all 25 IDs match exactly across Database, HTTP, and Browser", () => {
      const ids25 = generateAdIds(25);
      const input: ExactAdIdReconciliationInput = {
        discoveryRunId: "run_test_rec_01",
        databaseIds: [...ids25],
        httpIds: [...ids25],
        browserIds: [...ids25],
        databaseStatus: "PASSED",
        httpStatus: "PASSED",
        browserStatus: "PASSED",
        browserPaginationCompleted: true,
      };

      const result = reconcileExactAdIdSets(input);
      expect(result.status).toBe("PASSED");
      expect(result.exactMatch).toBe(true);
      expect(result.databaseCount).toBe(25);
      expect(result.httpCount).toBe(25);
      expect(result.browserCount).toBe(25);
      expect(result.missingFromHttp).toHaveLength(0);
      expect(result.unexpectedInHttp).toHaveLength(0);
      expect(result.missingFromBrowser).toHaveLength(0);
      expect(result.unexpectedInBrowser).toHaveLength(0);
      expect(result.duplicateDatabaseIds).toHaveLength(0);
      expect(result.duplicateHttpIds).toHaveLength(0);
      expect(result.duplicateBrowserIds).toHaveLength(0);
      expect(result.errors).toHaveLength(0);
    });

    // REC-02: Browser missing 1 ID (The V11.6.0 defect)
    it("REC-02: fails when Browser is missing 1 ID (24/25 observed)", () => {
      const ids25 = generateAdIds(25);
      const ids24Browser = ids25.slice(0, 24);
      const missingId = ids25[24];

      const input: ExactAdIdReconciliationInput = {
        discoveryRunId: "run_test_rec_02",
        databaseIds: [...ids25],
        httpIds: [...ids25],
        browserIds: ids24Browser,
        databaseStatus: "PASSED",
        httpStatus: "PASSED",
        browserStatus: "PASSED",
        browserPaginationCompleted: true,
      };

      const result = reconcileExactAdIdSets(input);
      expect(result.status).toBe("FAILED");
      expect(result.exactMatch).toBe(false);
      expect(result.missingFromBrowser).toEqual([missingId]);
      expect(result.browserCount).toBe(24);
      expect(result.databaseCount).toBe(25);
      expect(result.errors.some((e) => e.includes("missing from browser"))).toBe(true);
    });

    // REC-03: Browser contains unexpected ID
    it("REC-03: fails when Browser contains an unexpected ID not in Database", () => {
      const ids25 = generateAdIds(25);
      const browserWithExtra = [...ids25.slice(0, 24), "unexpected_ad_999"];

      const input: ExactAdIdReconciliationInput = {
        discoveryRunId: "run_test_rec_03",
        databaseIds: [...ids25],
        httpIds: [...ids25],
        browserIds: browserWithExtra,
        databaseStatus: "PASSED",
        httpStatus: "PASSED",
        browserStatus: "PASSED",
        browserPaginationCompleted: true,
      };

      const result = reconcileExactAdIdSets(input);
      expect(result.status).toBe("FAILED");
      expect(result.exactMatch).toBe(false);
      expect(result.unexpectedInBrowser).toEqual(["unexpected_ad_999"]);
      expect(result.missingFromBrowser).toEqual([ids25[24]]);
    });

    // REC-04: HTTP missing ID
    it("REC-04: fails when HTTP readback is missing an ID", () => {
      const ids25 = generateAdIds(25);
      const httpMissing = ids25.slice(0, 24);

      const input: ExactAdIdReconciliationInput = {
        discoveryRunId: "run_test_rec_04",
        databaseIds: [...ids25],
        httpIds: httpMissing,
        browserIds: [...ids25],
        databaseStatus: "PASSED",
        httpStatus: "PASSED",
        browserStatus: "PASSED",
        browserPaginationCompleted: true,
      };

      const result = reconcileExactAdIdSets(input);
      expect(result.status).toBe("FAILED");
      expect(result.exactMatch).toBe(false);
      expect(result.missingFromHttp).toEqual([ids25[24]]);
    });

    // REC-05: HTTP duplicate ID
    it("REC-05: fails when HTTP response contains duplicate IDs", () => {
      const ids24 = generateAdIds(24);
      const httpWithDup = [...ids24, ids24[0]];

      const input: ExactAdIdReconciliationInput = {
        discoveryRunId: "run_test_rec_05",
        databaseIds: [...ids24, "ad_025"],
        httpIds: httpWithDup,
        browserIds: [...ids24, "ad_025"],
        databaseStatus: "PASSED",
        httpStatus: "PASSED",
        browserStatus: "PASSED",
        browserPaginationCompleted: true,
      };

      const result = reconcileExactAdIdSets(input);
      expect(result.status).toBe("FAILED");
      expect(result.exactMatch).toBe(false);
      expect(result.duplicateHttpIds).toEqual([ids24[0]]);
    });

    // REC-06: Browser duplicate ID
    it("REC-06: fails when Browser DOM contains duplicate card IDs across pages", () => {
      const ids24 = generateAdIds(24);
      const browserWithDup = [...ids24, ids24[5]];

      const input: ExactAdIdReconciliationInput = {
        discoveryRunId: "run_test_rec_06",
        databaseIds: [...ids24, "ad_025"],
        httpIds: [...ids24, "ad_025"],
        browserIds: browserWithDup,
        databaseStatus: "PASSED",
        httpStatus: "PASSED",
        browserStatus: "PASSED",
        browserPaginationCompleted: true,
      };

      const result = reconcileExactAdIdSets(input);
      expect(result.status).toBe("FAILED");
      expect(result.exactMatch).toBe(false);
      expect(result.duplicateBrowserIds).toEqual([ids24[5]]);
    });

    // REC-07: Same counts but different IDs
    it("REC-07: fails when counts are identical (25) but IDs differ", () => {
      const dbIds = generateAdIds(25, "db_");
      const browserIds = generateAdIds(25, "dom_");

      const input: ExactAdIdReconciliationInput = {
        discoveryRunId: "run_test_rec_07",
        databaseIds: dbIds,
        httpIds: dbIds,
        browserIds: browserIds,
        databaseStatus: "PASSED",
        httpStatus: "PASSED",
        browserStatus: "PASSED",
        browserPaginationCompleted: true,
      };

      const result = reconcileExactAdIdSets(input);
      expect(result.status).toBe("FAILED");
      expect(result.exactMatch).toBe(false);
      expect(result.missingFromBrowser).toHaveLength(25);
      expect(result.unexpectedInBrowser).toHaveLength(25);
    });

    // REC-08: Pagination incomplete
    it("REC-08: fails when browser pagination was marked incomplete", () => {
      const ids25 = generateAdIds(25);

      const input: ExactAdIdReconciliationInput = {
        discoveryRunId: "run_test_rec_08",
        databaseIds: [...ids25],
        httpIds: [...ids25],
        browserIds: [...ids25],
        databaseStatus: "PASSED",
        httpStatus: "PASSED",
        browserStatus: "PASSED",
        browserPaginationCompleted: false, // Incomplete!
      };

      const result = reconcileExactAdIdSets(input);
      expect(result.status).toBe("FAILED");
      expect(result.exactMatch).toBe(false);
      expect(result.errors.some((e) => e.includes("pagination"))).toBe(true);
    });

    // REC-09: Browser skipped
    it("REC-09: fails when Browser status is SKIPPED or NOT_VERIFIED", () => {
      const ids25 = generateAdIds(25);

      const input: ExactAdIdReconciliationInput = {
        discoveryRunId: "run_test_rec_09",
        databaseIds: [...ids25],
        httpIds: [...ids25],
        browserIds: [],
        databaseStatus: "PASSED",
        httpStatus: "PASSED",
        browserStatus: "SKIPPED",
        browserPaginationCompleted: false,
      };

      const result = reconcileExactAdIdSets(input);
      expect(result.status).toBe("FAILED");
      expect(result.exactMatch).toBe(false);
    });

    // REC-10, REC-11, REC-12: Tested via finalizeLiveJourneyVerdict
    it("REC-10: rejects verdict when source provenance is UNKNOWN", () => {
      const gates: LiveJourneyGateResults = {
        source: "FAILED",
        worker: "PASSED",
        persistence: "PASSED",
        http: "PASSED",
        browser: "PASSED",
        reconciliation: "PASSED",
        artifactIntegrity: "PASSED",
      };

      const verdict = finalizeLiveJourneyVerdict(gates);
      expect(verdict.success).toBe(false);
      expect(verdict.verdict).toBe("FAILED");
      expect(verdict.blockingReasons.some((r) => r.includes("Source"))).toBe(true);
    });

    it("REC-11: marks verdict BLOCKED when source is BLOCKED", () => {
      const gates: LiveJourneyGateResults = {
        source: "BLOCKED",
        worker: "PASSED",
        persistence: "PASSED",
        http: "PASSED",
        browser: "PASSED",
        reconciliation: "PASSED",
        artifactIntegrity: "PASSED",
      };

      const verdict = finalizeLiveJourneyVerdict(gates);
      expect(verdict.success).toBe(false);
      expect(verdict.verdict).toBe("BLOCKED");
    });

    it("REC-12: rejects verdict when mandatory evidence or artifact integrity fails", () => {
      const gates: LiveJourneyGateResults = {
        source: "PASSED",
        worker: "PASSED",
        persistence: "PASSED",
        http: "PASSED",
        browser: "PASSED",
        reconciliation: "PASSED",
        artifactIntegrity: "FAILED",
        cleanup: "PASSED",
      };

      const verdict = finalizeLiveJourneyVerdict(gates);
      expect(verdict.success).toBe(false);
      expect(verdict.verdict).toBe("FAILED");
      expect(verdict.blockingReasons.some((r) => r.includes("Artifact integrity"))).toBe(true);
    });

    it("REC-13 (FIX 1): rejects verdict with FAILED when cleanup fails even if all other gates passed", () => {
      const gates: LiveJourneyGateResults = {
        source: "PASSED",
        worker: "PASSED",
        persistence: "PASSED",
        http: "PASSED",
        browser: "PASSED",
        reconciliation: "PASSED",
        artifactIntegrity: "PASSED",
        cleanup: "FAILED",
      };

      const verdict = finalizeLiveJourneyVerdict(gates);
      expect(verdict.success).toBe(false);
      expect(verdict.verdict).toBe("FAILED");
      expect(verdict.blockingReasons.some((r) => r.includes("cleanup teardown"))).toBe(true);
    });

    it("REC-14 (FIX 1): grants VERIFIED verdict when all 7 gates and cleanup gate are PASSED", () => {
      const gates: LiveJourneyGateResults = {
        source: "PASSED",
        worker: "PASSED",
        persistence: "PASSED",
        http: "PASSED",
        browser: "PASSED",
        reconciliation: "PASSED",
        artifactIntegrity: "PASSED",
        cleanup: "PASSED",
      };

      const verdict = finalizeLiveJourneyVerdict(gates);
      expect(verdict.success).toBe(true);
      expect(verdict.verdict).toBe("VERIFIED");
      expect(verdict.blockingReasons).toHaveLength(0);
    });
  });

  describe("Section 23: Historical V11.6.0 Defect Regression Test", () => {
    it("fails closed on the exact historical V11.6.0 data (25 DB vs 24 Browser)", () => {
      // 25 Database IDs from artifacts/v11.6.0/live_journey_1792942161302_8112dff0/database-persistence.json
      const v11_6_0_dbIds = [
        "cmvnzhl6400432ig9x5xdyg1s", // The missing 25th ad!
        "cmvnzhl6d004a2ig9ft5ofbo0",
        "cmvnzhl6l004h2ig90gngevjx",
        "cmvnzhl6r004n2ig9se3hzqzw",
        "cmvnzhl71004u2ig9x05evs85",
        "cmvnzhl7800512ig9b9sfj0my",
        "cmvnzhl7e00572ig98cxiv2d9",
        "cmvnzhl7l005e2ig9333s07v9",
        "cmvnzhl7t005l2ig92wd9jufe",
        "cmvnzhl80005r2ig9mgcl7jjr",
        "cmvnzhl86005x2ig91xgjhy1b",
        "cmvnzhl8b00642ig9dailr1gn",
        "cmvnzhl8i006b2ig94pkltzpq",
        "cmvnzhl8p006i2ig9tm84qgc0",
        "cmvnzhl8w006p2ig9ybtm0h6d",
        "cmvnzhl92006w2ig981g3fjjy",
        "cmvnzhl9800732ig9o10of48d",
        "cmvnzhl9e007a2ig9r2x39r8j",
        "cmvnzhl9k007h2ig90zvcdo44",
        "cmvnzhl9q007o2ig9uq9zme7y",
        "cmvnzhl9w007v2ig9kev0avxs",
        "cmvnzhla300812ig9saepg4tz",
        "cmvnzhla800872ig90p84lngj",
        "cmvnzhlaf008e2ig9l4n0yw66",
        "cmvnzhlak008l2ig91bjta2yz",
      ];

      // 24 Browser IDs from artifacts/v11.6.0/live_journey_1792942161302_8112dff0/browser-readback.json
      const v11_6_0_browserIds = [
        "cmvnzhlak008l2ig91bjta2yz",
        "cmvnzhlaf008e2ig9l4n0yw66",
        "cmvnzhla800872ig90p84lngj",
        "cmvnzhla300812ig9saepg4tz",
        "cmvnzhl9w007v2ig9kev0avxs",
        "cmvnzhl9q007o2ig9uq9zme7y",
        "cmvnzhl9k007h2ig90zvcdo44",
        "cmvnzhl9e007a2ig9r2x39r8j",
        "cmvnzhl9800732ig9o10of48d",
        "cmvnzhl92006w2ig981g3fjjy",
        "cmvnzhl8w006p2ig9ybtm0h6d",
        "cmvnzhl8p006i2ig9tm84qgc0",
        "cmvnzhl8i006b2ig94pkltzpq",
        "cmvnzhl8b00642ig9dailr1gn",
        "cmvnzhl86005x2ig91xgjhy1b",
        "cmvnzhl80005r2ig9mgcl7jjr",
        "cmvnzhl7t005l2ig92wd9jufe",
        "cmvnzhl7l005e2ig9333s07v9",
        "cmvnzhl7e00572ig98cxiv2d9",
        "cmvnzhl7800512ig9b9sfj0my",
        "cmvnzhl71004u2ig9x05evs85",
        "cmvnzhl6r004n2ig9se3hzqzw",
        "cmvnzhl6l004h2ig90gngevjx",
        "cmvnzhl6d004a2ig9ft5ofbo0",
      ];

      const input: ExactAdIdReconciliationInput = {
        discoveryRunId: "cmvnzh2x500012eg9d8lsodjk",
        databaseIds: v11_6_0_dbIds,
        httpIds: v11_6_0_dbIds, // HTTP had all 25
        browserIds: v11_6_0_browserIds,
        databaseStatus: "COMPLETED",
        httpStatus: "PASSED",
        browserStatus: "PASSED",
        browserPaginationCompleted: true,
      };

      const result = reconcileExactAdIdSets(input);

      // Must FAIL closed!
      expect(result.status).toBe("FAILED");
      expect(result.exactMatch).toBe(false);
      expect(result.databaseCount).toBe(25);
      expect(result.httpCount).toBe(25);
      expect(result.browserCount).toBe(24);
      expect(result.missingFromBrowser).toEqual(["cmvnzhl6400432ig9x5xdyg1s"]);
      expect(result.unexpectedInBrowser).toHaveLength(0);
      expect(result.errors.some((e) => e.includes("cmvnzhl6400432ig9x5xdyg1s"))).toBe(true);
    });
  });

  describe("verifyWorkerProvenance() — Worker Provenance Verification (FIX 2)", () => {
    const validRunId = "run_prov_test_001";
    const sampleLibraryIds = ["lib_001", "lib_002", "lib_003"];

    const createValidEvidence = () => ({
      acceptanceRunId: "test_acceptance_001",
      discoveryRunId: validRunId,
      workerPid: 12345,
      requestedMode: "REAL_LIVE_META",
      providerId: "meta-ads-collector",
      actualTransport: "stdio",
      observedSourceType: "REAL_UPSTREAM",
      fixtureDetected: false,
      upstreamRequestExecuted: true,
      upstreamResponseObserved: true,
      upstreamResultSetId: "rs_001",
      upstreamAdIds: [...sampleLibraryIds],
      validAdsCollected: 3,
      observedAt: new Date().toISOString(),
      evidenceOrigin: "ACTUAL_PROVIDER_EXECUTION",
      errors: [],
    });

    it("passes worker gate when evidence is valid and matches persisted records", () => {
      const result = verifyWorkerProvenance({
        discoveryRunId: validRunId,
        finalRunStatus: "COMPLETED",
        validCount: 3,
        providerEvidence: createValidEvidence(),
        persistedLibraryIds: [...sampleLibraryIds],
      });

      expect(result.status).toBe("PASSED");
      expect(result.isValid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it("fails worker gate when fixtureDetected = true", () => {
      const ev = createValidEvidence();
      ev.fixtureDetected = true;

      const result = verifyWorkerProvenance({
        discoveryRunId: validRunId,
        finalRunStatus: "COMPLETED",
        validCount: 3,
        providerEvidence: ev,
        persistedLibraryIds: [...sampleLibraryIds],
      });

      expect(result.status).toBe("FAILED");
      expect(result.isValid).toBe(false);
      expect(result.errors.some((e) => e.includes("fixtureDetected"))).toBe(true);
    });

    it("fails worker gate when observedSourceType = UNKNOWN", () => {
      const ev = createValidEvidence();
      ev.observedSourceType = "UNKNOWN";

      const result = verifyWorkerProvenance({
        discoveryRunId: validRunId,
        finalRunStatus: "COMPLETED",
        validCount: 3,
        providerEvidence: ev,
        persistedLibraryIds: [...sampleLibraryIds],
      });

      expect(result.status).toBe("FAILED");
      expect(result.isValid).toBe(false);
      expect(result.errors.some((e) => e.includes("observedSourceType"))).toBe(true);
    });

    it("fails worker gate when upstreamRequestExecuted = false", () => {
      const ev = createValidEvidence();
      ev.upstreamRequestExecuted = false;

      const result = verifyWorkerProvenance({
        discoveryRunId: validRunId,
        finalRunStatus: "COMPLETED",
        validCount: 3,
        providerEvidence: ev,
        persistedLibraryIds: [...sampleLibraryIds],
      });

      expect(result.status).toBe("FAILED");
      expect(result.isValid).toBe(false);
      expect(result.errors.some((e) => e.includes("upstreamRequestExecuted"))).toBe(true);
    });

    it("fails worker gate when discoveryRunId is mismatched", () => {
      const ev = createValidEvidence();
      ev.discoveryRunId = "unrelated_other_run_999";

      const result = verifyWorkerProvenance({
        discoveryRunId: validRunId,
        finalRunStatus: "COMPLETED",
        validCount: 3,
        providerEvidence: ev,
        persistedLibraryIds: [...sampleLibraryIds],
      });

      expect(result.status).toBe("FAILED");
      expect(result.isValid).toBe(false);
      expect(result.errors.some((e) => e.includes("discoveryRunId"))).toBe(true);
    });

    it("fails worker gate when upstreamAdIds does not match persisted library records", () => {
      const ev = createValidEvidence();
      ev.upstreamAdIds = ["lib_001", "lib_002", "lib_DIFFERENT"];

      const result = verifyWorkerProvenance({
        discoveryRunId: validRunId,
        finalRunStatus: "COMPLETED",
        validCount: 3,
        providerEvidence: ev,
        persistedLibraryIds: [...sampleLibraryIds], // lib_001, lib_002, lib_003
      });

      expect(result.status).toBe("FAILED");
      expect(result.isValid).toBe(false);
      expect(result.errors.some((e) => e.includes("missing from persisted") || e.includes("missing from upstream"))).toBe(true);
    });

    it("marks worker gate BLOCKED when run status is BLOCKED_SOURCE", () => {
      const result = verifyWorkerProvenance({
        discoveryRunId: validRunId,
        finalRunStatus: "BLOCKED_SOURCE",
        validCount: 0,
        providerEvidence: null,
        persistedLibraryIds: [],
      });

      expect(result.status).toBe("BLOCKED");
      expect(result.isValid).toBe(false);
      expect(result.errors.some((e) => e.includes("blocked"))).toBe(true);
    });

    it("fails worker gate when providerEvidence is null", () => {
      const result = verifyWorkerProvenance({
        discoveryRunId: validRunId,
        finalRunStatus: "COMPLETED",
        validCount: 3,
        providerEvidence: null,
        persistedLibraryIds: [...sampleLibraryIds],
      });

      expect(result.status).toBe("FAILED");
      expect(result.isValid).toBe(false);
      expect(result.errors.some((e) => e.includes("Missing exact-run provider evidence"))).toBe(true);
    });

    it("fails worker gate when actualTransport is invalid", () => {
      const ev = createValidEvidence();
      ev.actualTransport = "mock_transport";

      const result = verifyWorkerProvenance({
        discoveryRunId: validRunId,
        finalRunStatus: "COMPLETED",
        validCount: 3,
        providerEvidence: ev,
        persistedLibraryIds: [...sampleLibraryIds],
      });

      expect(result.status).toBe("FAILED");
      expect(result.isValid).toBe(false);
      expect(result.errors.some((e) => e.includes("actualTransport"))).toBe(true);
    });
  });
});
