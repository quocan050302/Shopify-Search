/**
 * SWAI KH-02 — V12.4.3.7.19.3.2.3
 * Dedicated Candidate Database Readback Diagnostic Script (Gate E9)
 *
 * Connects read-only to Prisma database, queries persisted demand observations
 * for canonical UAHPET candidate 'cmvsy7zqh000jp0orhypwohho', verifies candidate
 * attribution under strict BUSINESS scope, and outputs structured observable JSON.
 */

import { execSync } from "child_process";
import { prisma, getDatabaseUrl } from "../../src/lib/db";
import { filterAttributableObservations } from "../../src/services/kh02/demand/candidateDemandAttribution";
import {
  hasVerifiableCsvOrProviderLineage,
  evaluateDemandHistoryEvidence,
} from "../../src/services/kh02/demand/temporalDemandEngine";
import { getKH02ResearchRunById } from "../../src/services/kh02/persistence/kh02PersistenceService";

export interface GlobalDemandPartitionSummary {
  totalRawDemandRows: number;
  bySource: Record<string, number>;
  fixtureProductRows: number;
  candidateSpecificRows: number;
  verifiedBusinessLineageRows: number;
}

export interface CandidateDbReadbackOptions {
  productId?: string;
  candidateId?: string;
  runId?: string;
}

export interface CandidateDbReadbackResult {
  dbConnected: boolean;
  dbReadbackExecuted: boolean;
  dbConnectionStatus: "SUCCESS" | "FAILED";
  productLookupStatus: "FOUND" | "NOT_FOUND";
  dbPathOrMaskedDsn: string;
  testedCodeSha: string;
  testedTreeSha: string;
  runId: string | null;
  candidateId: string;
  canonicalProductId: string;
  canonicalTitleFromDB: string | null;
  rawRecordCount: number;
  distinctKeywords: string[];
  sourceClassifications: string[];
  distinctEvidenceRefs: string[];
  candidateAttributableCount: number;
  businessAttributableCount: number;
  verifiedOfficialCsvRows: number;
  coveredCalendarDays: number;
  g15Verdict: "INSUFFICIENT_EVIDENCE" | "PASS";
  g16Verdict: "INSUFFICIENT_EVIDENCE" | "NOT_EVALUATED" | "PASS";
  g16EvaluationStatus:
    | "EVALUATED_WITH_RUN_CONTEXT"
    | "NOT_EVALUATED_SINGLE_PRODUCT_NO_RUN_CONTEXT"
    | "RUN_NOT_FOUND";
  identityAmbiguity: string | null;
  discrepancyNote: string;
  globalDemandPartitionSummary?: GlobalDemandPartitionSummary;
  executedAt: string;
}

export async function executeCandidateDbReadback(
  input: string | CandidateDbReadbackOptions = "cmvsy7zqh000jp0orhypwohho"
): Promise<CandidateDbReadbackResult> {
  const opts: CandidateDbReadbackOptions =
    typeof input === "string" ? { productId: input } : input || {};
  const targetProductId = opts.productId || process.env.KH02_READBACK_PRODUCT_ID || "cmvsy7zqh000jp0orhypwohho";
  const targetRunId = opts.runId || process.env.KH02_READBACK_RUN_ID || null;
  const resolvedCandidateId =
    opts.candidateId ||
    process.env.KH02_READBACK_CANDIDATE_ID ||
    (targetProductId === "cmvsy7zqh000jp0orhypwohho"
      ? "cand_uahpet_feeder"
      : `cand_${targetProductId}`);
  const executedAt = new Date().toISOString();
  let testedCodeSha = "0000000000000000000000000000000000000000";
  let testedTreeSha = "0000000000000000000000000000000000000000";
  try {
    testedCodeSha = execSync("git rev-parse HEAD", { encoding: "utf-8" }).trim();
    testedTreeSha = execSync("git log -1 --format=%T HEAD", { encoding: "utf-8" }).trim();
  } catch (_) {}
  let rawDbUrl = "file:./prisma/dev.db";
  try {
    rawDbUrl = getDatabaseUrl();
  } catch (_) {}
  const maskedDsn = rawDbUrl
    .replace(/:\/\/([^:]+):([^@]+)@/, "://$1:***@")
    .replace(/^file:.*[\/\\]([^\/\\]+)$/, "file:./prisma/$1");

  try {
    // 1. Verify DB connection and query research product (never fabricate a default title if missing)
    const product = await prisma.researchProduct.findUnique({
      where: { id: targetProductId },
    });

    const productLookupStatus: "FOUND" | "NOT_FOUND" = product ? "FOUND" : "NOT_FOUND";
    const canonicalTitleFromDB: string | null = product?.title ?? null;

    // 2. Query demand observations for target product and global partition dynamically
    const [observations, allObservations] = await Promise.all([
      prisma.productDemandObservation.findMany({
        where: { productId: targetProductId },
        orderBy: { periodStart: "asc" },
      }),
      prisma.productDemandObservation.findMany(),
    ]);

    const bySource: Record<string, number> = {};
    let fixtureProductRows = 0;
    let verifiedBusinessLineageRows = 0;
    for (const row of allObservations) {
      const src = row.source || "UNKNOWN";
      bySource[src] = (bySource[src] || 0) + 1;
      if (
        (row.productId && /^prod_fixture_|fixture|mock|synthetic|demo/i.test(row.productId)) ||
        (row.evidenceReference && /fixture|mock|synthetic|demo/i.test(row.evidenceReference))
      ) {
        fixtureProductRows++;
      }
      const lineage = hasVerifiableCsvOrProviderLineage(
        row.evidenceReference || "",
        null,
        {
          targetProductId: row.productId || undefined,
          targetKeyword: row.keyword || undefined,
          region: row.region || undefined,
          observationDate: row.periodStart ? row.periodStart.toISOString().slice(0, 10) : undefined,
          observationValue: row.demandValue ?? undefined,
          evaluationScope: "BUSINESS",
        }
      );
      if (lineage.lineageVerified && lineage.businessLineageEligible) {
        verifiedBusinessLineageRows++;
      }
    }

    const globalDemandPartitionSummary: GlobalDemandPartitionSummary = {
      totalRawDemandRows: allObservations.length,
      bySource,
      fixtureProductRows,
      candidateSpecificRows: observations.length,
      verifiedBusinessLineageRows,
    };

    const rawRecordCount = observations.length;
    const distinctKeywords = Array.from(new Set(observations.map((o) => o.keyword).filter(Boolean))) as string[];
    const sourceClassifications = Array.from(new Set(observations.map((o) => o.source).filter(Boolean))) as string[];

    // Mask / redact raw file paths, expose only checksum/id reference
    const distinctEvidenceRefs = Array.from(
      new Set(
        observations
          .map((o) => {
            const ref = o.evidenceReference || "";
            const shaMatch = ref.match(/sha256:([a-f0-9]{64})/i);
            return shaMatch ? `sha256:${shaMatch[1].slice(0, 16)}...` : ref.slice(0, 24);
          })
          .filter(Boolean)
      )
    );

    // 3. Candidate-scoped attribution partition under strict BUSINESS scope
    const mappedObs = observations.map((o) => ({
      id: o.id,
      productId: o.productId,
      keyword: o.keyword,
      source: o.source,
      region: o.region,
      evidenceReference: o.evidenceReference,
      periodStart: o.periodStart ? o.periodStart.toISOString().slice(0, 10) : undefined,
      periodEnd: o.periodEnd ? o.periodEnd.toISOString().slice(0, 10) : undefined,
      demandValue: o.demandValue,
    }));

    const partition = filterAttributableObservations(mappedObs, {
      canonicalProductId: targetProductId,
      candidateCanonicalName: canonicalTitleFromDB || undefined,
      evaluationScope: "BUSINESS",
      strictProvenance: true,
    });

    const candidateAttributableCount = partition.attributableObservations.length;
    const businessAttributableCount = partition.businessAttributableObservations.length;

    // 4. Calculate covered days and G15 verdict using the real production demand evaluator
    const demandAssessment = evaluateDemandHistoryEvidence(
      partition.businessAttributableObservations.map((o) => ({
        id: o.id,
        productId: o.productId || targetProductId,
        keyword: o.keyword || "",
        periodStart: o.periodStart || "",
        periodEnd: o.periodEnd || o.periodStart || "",
        demandValue: Number(o.demandValue ?? 0),
        demandUnit: "INDEX_0_100" as const,
        source: o.source || "UNKNOWN",
        region: o.region || "US",
        confidence: 0.9,
        evidenceReference: o.evidenceReference || null,
      })),
      {
        minimumCoveredDays: 60,
        evaluationScope: "BUSINESS",
        targetProductId,
        candidateCanonicalName: canonicalTitleFromDB || undefined,
      }
    );

    const coveredCalendarDays = demandAssessment.coveredDays;

    // 5. Official CSV rows count via real hasVerifiableCsvOrProviderLineage + candidate attribution under BUSINESS scope
    const verifiedOfficialCsvRows = partition.businessAttributableObservations.filter((o) => {
      if (o.source !== "GOOGLE_TRENDS_CSV") return false;
      const lineage = hasVerifiableCsvOrProviderLineage(
        o.evidenceReference || "",
        null,
        {
          targetProductId: o.productId || targetProductId,
          targetKeyword: o.keyword || undefined,
          targetProduct: canonicalTitleFromDB || undefined,
          region: o.region || undefined,
          observationDate: o.periodStart || undefined,
          observationValue: o.demandValue ?? undefined,
          evaluationScope: "BUSINESS",
        }
      );
      return Boolean(
        lineage.lineageVerified &&
          lineage.businessLineageEligible &&
          lineage.originKind === "VERIFIED_OFFICIAL_CSV_IMPORT"
      );
    }).length;

    const g15Verdict: "INSUFFICIENT_EVIDENCE" | "PASS" =
      demandAssessment.status === "VERIFIED" &&
      demandAssessment.temporalCoverageValid === true &&
      coveredCalendarDays >= 60 &&
      businessAttributableCount > 0
        ? "PASS"
        : "INSUFFICIENT_EVIDENCE";

    let g16Verdict: "INSUFFICIENT_EVIDENCE" | "NOT_EVALUATED" | "PASS" =
      g15Verdict === "PASS" ? "NOT_EVALUATED" : "INSUFFICIENT_EVIDENCE";
    let g16EvaluationStatus:
      | "EVALUATED_WITH_RUN_CONTEXT"
      | "NOT_EVALUATED_SINGLE_PRODUCT_NO_RUN_CONTEXT"
      | "RUN_NOT_FOUND" = "NOT_EVALUATED_SINGLE_PRODUCT_NO_RUN_CONTEXT";

    if (targetRunId) {
      const runDetail = await getKH02ResearchRunById(targetRunId, "default-workspace").catch(() => null);
      if (!runDetail) {
        g16EvaluationStatus = "RUN_NOT_FOUND";
        g16Verdict = "INSUFFICIENT_EVIDENCE";
      } else {
        g16EvaluationStatus = "EVALUATED_WITH_RUN_CONTEXT";
        const eligibleCount = Number(
          (runDetail as any)?.evergreenEligibleCount ??
            (runDetail as any)?.summary?.evergreenEligibleCount ??
            0
        );
        g16Verdict =
          g15Verdict === "PASS" && eligibleCount >= 3 ? "PASS" : "INSUFFICIENT_EVIDENCE";
      }
    }

    // 6. Discrepancy & Truth Note
    const discrepancyNote =
      rawRecordCount > 0 && verifiedOfficialCsvRows === 0
        ? `Database contains ${rawRecordCount} raw observation rows (${verifiedOfficialCsvRows} verified CSV rows) with 'verified-merchant-demand' pseudo-reference; 0 are official verified Google Trends Explore CSV records with durable origin authority.`
        : `Database contains ${rawRecordCount} raw rows (${verifiedOfficialCsvRows} verified CSV rows).`;

    return {
      dbConnected: true,
      dbReadbackExecuted: true,
      dbConnectionStatus: "SUCCESS",
      productLookupStatus,
      dbPathOrMaskedDsn: maskedDsn,
      testedCodeSha,
      testedTreeSha,
      runId: targetRunId,
      candidateId: resolvedCandidateId,
      canonicalProductId: targetProductId,
      canonicalTitleFromDB,
      rawRecordCount,
      distinctKeywords,
      sourceClassifications,
      distinctEvidenceRefs,
      candidateAttributableCount,
      businessAttributableCount,
      verifiedOfficialCsvRows,
      coveredCalendarDays,
      g15Verdict,
      g16Verdict,
      g16EvaluationStatus,
      identityAmbiguity: canonicalTitleFromDB ? null : `ResearchProduct '${targetProductId}' not found in current database`,
      discrepancyNote,
      globalDemandPartitionSummary,
      executedAt,
    };
  } catch (err: any) {
    throw err;
  }
}

async function main() {
  try {
    const result = await executeCandidateDbReadback();
    console.log("=== CANDIDATE DATABASE READBACK DIAGNOSTIC (GATE E9) ===");
    console.log(JSON.stringify(result, null, 2));
    console.log(
      `DB_CONNECTION_STATUS: ${result.dbConnectionStatus} (dbConnected=${result.dbConnected}, rawRecords=${result.rawRecordCount}) | BUSINESS_VERDICT: G15=${result.g15Verdict}, G16=${result.g16Verdict} (${result.g16EvaluationStatus})`
    );
    process.exit(0);
  } catch (err: any) {
    console.error("=== CANDIDATE DATABASE READBACK FAILED ===");
    console.error(err?.message || err);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}
