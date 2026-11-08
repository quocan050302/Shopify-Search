/** Official UI export intake. This module performs no external network requests. */
import crypto from "node:crypto";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { buildAuthorizedProductWhere } from "@/services/research/authorizedScopeHelpers";
import { getKH02Leaderboard } from "@/services/kh02/persistence/kh02PersistenceService";
import type { DiscoveredProductCandidate } from "@/services/kh02/identity/productCandidateDiscovery";
import { calculateKH02EvergreenScore } from "@/services/kh02/scoring/evergreenOpportunityScoring";
import { evaluateDemandHistoryEvidence } from "./temporalDemandEngine";
import { executeDemandObservationBatchImport, BatchImportError } from "./demandObservationBatchImport";
import { validateAndParseGoogleTrendsCsv } from "./googleTrendsCsvValidator";
import {
  normalizeCsvAuthorityQuery,
  validateOfficialGoogleTrendsAcquisitionUrl,
  verifyDurableCsvImportAuthority,
} from "./durableCsvImportAuthority";

export const MAX_TRENDS_UPLOAD_BYTES = 256 * 1024;
export const localTrendsInputSchema = z.object({
  productId: z.string().trim().min(1).max(200),
  query: z.string().trim().min(3).max(200),
  sourceUrl: z.string().trim().min(1).max(2048),
  rawCsv: z.string().min(1).max(MAX_TRENDS_UPLOAD_BYTES),
  authorityId: z.string().trim().min(1).max(200).optional(),
}).strict();

export const LOCAL_TRENDS_ACCESS = {
  acquisitionMode: "OFFICIAL_UI_EXPORT_USER_ASSISTED",
  automaticAcquisitionAvailable: false,
  acquisitionBlocker: "GOOGLE_TRENDS_EXPLORE_ROBOTS_DISALLOW",
  robotsUrl: "https://trends.google.com/robots.txt",
  exportHelpUrl: "https://support.google.com/trends/answer/4365538?hl=en",
  apiAlphaUrl: "https://developers.google.com/search/apis/trends",
  message: "Open Google Trends and download Interest over time as CSV. Import, DB readback and G15/G16 evaluation then run locally. No paid service or automatic source approval is used.",
} as const;

export function buildOfficialTrendsExploreUrl(query: string): string {
  const url = new URL("https://trends.google.com/trends/explore");
  url.searchParams.set("geo", "US");
  url.searchParams.set("date", "today 12-m");
  url.searchParams.set("q", query.trim());
  return validateOfficialGoogleTrendsAcquisitionUrl(url.href, query, "US");
}

function isCompletedPeriod(point: { periodStart: string | Date; periodEnd: string | Date }, cadence: string | null | undefined, now = Date.now()) {
  const start = new Date(point.periodStart);
  const rawEnd = new Date(point.periodEnd);
  let endExclusive = rawEnd.getTime() + 86400000;
  if (rawEnd.getTime() === start.getTime()) {
    const next = new Date(start);
    if (cadence === "WEEKLY") next.setUTCDate(next.getUTCDate() + 7);
    else if (cadence === "MONTHLY") next.setUTCMonth(next.getUTCMonth() + 1);
    else next.setUTCDate(next.getUTCDate() + 1);
    endExclusive = next.getTime();
  }
  return endExclusive <= now;
}

async function authorizedProduct(workspaceId: string, productId: string) {
  const product = await prisma.researchProduct.findFirst({
    where: { id: productId, ...buildAuthorizedProductWhere(workspaceId) },
    include: { store: true },
  });
  if (!product) throw new BatchImportError("Product not found in this workspace.", 404, "PRODUCT_NOT_FOUND");
  return product;
}

function conservativeCandidate(product: { id: string; title: string; category: string; productUrl: string | null; imageUrl: string | null; store: { domain: string } | null }): DiscoveredProductCandidate {
  return {
    candidateId: product.id, researchProductId: product.id, title: product.title,
    canonicalProductName: product.title, category: product.category,
    canonicalProductUrl: product.productUrl, storeDomain: product.store?.domain || null,
    thumbnailUrl: product.imageUrl, videoUrl: null, problemStatement: null, targetAudience: null,
    advertiserNames: [], supportingAdIds: [], supportingSourceTypes: [], sourceObservations: [],
    totalObservationCount: 0, distinctAdvertisersCount: 0, earliestObservationDate: null,
    latestObservationDate: null, identityConfidence: "AMBIGUOUS", identityStatus: "UNRESOLVED",
  };
}

async function evaluateStoredImport(workspaceId: string, productId: string, rawSha: string, query: string) {
  const product = await authorizedProduct(workspaceId, productId);
  // Never combine independently scaled CSV exports into one demand series.
  const rows = await prisma.productDemandObservation.findMany({
    where: { productId, source: "GOOGLE_TRENDS_CSV", region: "US", keyword: query,
      evidenceReference: { contains: `sha256:${rawSha}` } },
    orderBy: { periodStart: "asc" }, take: 500,
  });
  const completedRows = rows.filter(row => isCompletedPeriod(row, row.evidenceReference?.match(/:cadence=(DAILY|WEEKLY|MONTHLY)\b/)?.[1]));
  const points = completedRows.map(row => ({ ...row, observedAt: row.observedAt.toISOString(),
    methodologyVersion: row.methodologyVersion, region: row.region, source: row.source }));
  const now = new Date().toISOString();
  const saved = await getKH02Leaderboard(workspaceId);
  const items = saved ? [...(saved.topThree || []), ...(saved.provisionalCandidates || []),
    ...(saved.remainingCandidates || []), ...(saved.insufficientEvidenceCandidates || [])] : [];
  const prior = items.find(item => item.candidate?.researchProductId === product.id || item.candidate?.candidateId === product.id)?.candidate;
  // Identity/ad authority comes only from a server-side saved candidate, never an upload.
  const candidate = { ...(prior || conservativeCandidate(product)), researchProductId: product.id, productId: product.id };
  const g15 = evaluateDemandHistoryEvidence(points, {
    minimumDataPoints: 3, minimumCoveredDays: 60, targetProductId: product.id,
    candidateCanonicalName: candidate.canonicalProductName || candidate.title, requiredRegion: "US", workspaceId,
    evaluationScope: "BUSINESS", strictSourceProvenance: true, strictLiveOrigin: true,
    strictChronological: true, asOfTimestamp: now,
  });
  const score = calculateKH02EvergreenScore({ candidate, demandSeries: points });
  const eligible = g15.eligibleForEvergreen && score.tier === "VERIFIED_EVERGREEN" && score.evergreenVerification?.verifiedByGate === true;
  return {
    productId, title: product.title, rawSha256: rawSha, query, evaluatedAt: now,
    storedObservations: rows.length, evaluatedCompletedObservations: points.length, excludedStoredIncompletePeriods: rows.length - points.length, g15,
    g16: { eligible, tier: score.tier, score, scope: "SINGLE_PRODUCT_REEVALUATION",
      topThreePublished: false, reasons: score.evergreenVerification?.disqualifiers || score.missingEvidence },
    releaseVerdict: "RELEASE_HOLD" as const,
  };
}

let importing = false;
export async function importLocalTrendsCsv(workspaceId: string, actorId: string, rawInput: unknown) {
  const parsed = localTrendsInputSchema.safeParse(rawInput);
  if (!parsed.success) throw new BatchImportError("Invalid Trends import fields.", 400, "INVALID_TRENDS_INPUT", parsed.error.issues);
  const input = parsed.data;
  if (Buffer.byteLength(input.rawCsv, "utf8") > MAX_TRENDS_UPLOAD_BYTES)
    throw new BatchImportError("CSV exceeds 256 KiB.", 413, "CSV_TOO_LARGE");
  if (importing) throw new BatchImportError("Another CSV import is running. Retry after it finishes.", 409, "IMPORT_BUSY");
  importing = true;
  try {
    await authorizedProduct(workspaceId, input.productId);
    let sourceUrl: string;
    try { sourceUrl = validateOfficialGoogleTrendsAcquisitionUrl(input.sourceUrl, input.query, "US"); }
    catch { throw new BatchImportError("Source URL must be the official US Explore URL for the exact query.", 422, "INVALID_ACQUISITION_URL"); }
    // Validate without mutation before accepting/persisting any original bytes.
    const validation = validateAndParseGoogleTrendsCsv(input.rawCsv, { expectedKeyword: input.query, expectedRegion: "US", persist: false });
    if (!validation.valid || !validation.evidenceReference || !validation.keyword || normalizeCsvAuthorityQuery(validation.keyword) !== normalizeCsvAuthorityQuery(input.query))
      throw new BatchImportError("CSV query, US geography or schema does not match.", 422, "INVALID_GOOGLE_TRENDS_CSV", validation.errors);
    const now = new Date();
    // A single-date weekly/monthly row represents the whole bucket, not just its start.
    const complete = validation.dataPoints.filter(point => isCompletedPeriod(point, validation.cadence, now.getTime()));
    if (!complete.length) throw new BatchImportError("No completed observation periods in this CSV.", 422, "NO_COMPLETED_PERIODS");
    if (complete.length > 500) throw new BatchImportError("Maximum 500 completed rows per import.", 422, "TOO_MANY_ROWS");
    const persisted = validateAndParseGoogleTrendsCsv(input.rawCsv, { expectedKeyword: input.query, expectedRegion: "US", persist: true });
    if (!persisted.valid) throw new BatchImportError("Original CSV could not be stored safely.", 500, "CSV_STORAGE_FAILED");
    const authority = verifyDurableCsvImportAuthority({ authorityId: input.authorityId,
      rawCsvSha256: validation.sha256Checksum, workspaceId, targetProductId: input.productId,
      targetKeyword: validation.keyword, region: "US", evaluationScope: "BUSINESS", asOfTimestamp: now });
    if (input.authorityId && (!authority.verified || !authority.businessEligible))
      throw new BatchImportError(authority.reason, 422, authority.code);
    const cadenceReference = `${validation.evidenceReference}:cadence=${validation.cadence || "AUTO"}`;
    const evidenceReference = input.authorityId ? `${cadenceReference}:authorityId=${input.authorityId}` : cadenceReference;
    // CSV-shaped bytes + a user-provided URL are local integrity, not proof of Google origin.
    const imported = await executeDemandObservationBatchImport({ workspaceId, productId: input.productId,
      source: "GOOGLE_TRENDS_CSV", region: "US", evidenceReference,
      methodologyVersion: "google_trends_local_csv_v1", strictProvenance: true,
      points: complete.map(point => ({ ...point, evidenceReference })),
    });
    const receiptId = `trends_local_${crypto.createHash("sha256").update(JSON.stringify([workspaceId, input.productId, validation.sha256Checksum])).digest("hex")}`;
    let evaluation: Awaited<ReturnType<typeof evaluateStoredImport>> | null = null;
    let evaluationError: string | null = null;
    try { evaluation = await evaluateStoredImport(workspaceId, input.productId, validation.sha256Checksum, validation.keyword); }
    catch { evaluationError = "DB import committed; evaluation failed. Use Re-evaluate to retry. No winner was published."; }
    // Separate audit record, always SOURCE_SUBMITTED: never a forged merchant/product proof.
    let receiptPersisted = false;
    try {
      await prisma.researchEvidence.upsert({ where: { id: receiptId }, create: {
        id: receiptId, workspaceId, subjectType: "PRODUCT", subjectId: input.productId,
        productId: input.productId, pillar: "DEMAND", claim: "GOOGLE_TRENDS_LOCAL_CSV_IMPORT",
        sourceUrl, observationMethod: "USER_CSV_UPLOAD", classification: "SOURCE_SUBMITTED",
        sourceContentRef: `sha256:${validation.sha256Checksum}`, observedAt: now,
        observedValue: JSON.stringify({ query: validation.keyword, rawSha256: validation.sha256Checksum,
          importedAt: now.toISOString(), actorId, authorityId: input.authorityId || null,
          sourceOriginStatus: authority.businessEligible ? "APPROVED_OFFICIAL_CSV_IMPORT" : "USER_UPLOADED_UNATTESTED" }),
      }, update: {} });
      receiptPersisted = true;
    } catch { /* The response reports that observations committed but the audit receipt failed. */ }
    return { ...LOCAL_TRENDS_ACCESS, imported, receiptId, receiptPersisted,
      excludedIncompletePeriods: validation.dataPointsCount - complete.length,
      rawSha256: validation.sha256Checksum, csvRows: validation.dataPointsCount,
      authority: { verified: authority.verified, businessEligible: authority.businessEligible,
        code: authority.code, reason: authority.reason, providerOriginVerified: false },
      evaluation, evaluationError,
      warning: !receiptPersisted ? "Observations committed, but audit receipt failed to persist." : null };
  } finally { importing = false; }
}

export async function getLocalTrendsWorkflow(workspaceId: string, productId?: string) {
  if (!productId) {
    const products = await prisma.researchProduct.findMany({ where: buildAuthorizedProductWhere(workspaceId),
      select: { id: true, title: true }, orderBy: { updatedAt: "desc" }, take: 200 });
    return { ...LOCAL_TRENDS_ACCESS, products };
  }
  await authorizedProduct(workspaceId, productId);
  const receipt = await prisma.researchEvidence.findFirst({ where: { workspaceId, productId,
    claim: "GOOGLE_TRENDS_LOCAL_CSV_IMPORT", observationMethod: "USER_CSV_UPLOAD" }, orderBy: { observedAt: "desc" } });
  if (!receipt?.observedValue) return { ...LOCAL_TRENDS_ACCESS, evaluation: null };
  const data = JSON.parse(receipt.observedValue) as { rawSha256: string; query: string };
  return { ...LOCAL_TRENDS_ACCESS, evaluation: await evaluateStoredImport(workspaceId, productId, data.rawSha256, data.query) };
}
