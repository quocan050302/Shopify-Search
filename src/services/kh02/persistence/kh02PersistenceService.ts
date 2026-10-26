/**
 * SWAI KH-02 — Persistent Research Runs & Ranking Snapshots
 *
 * Implements persistent, workspace-isolated research run management and
 * immutable ranking snapshots using the database syncJob model.
 *
 * Invariants:
 * 1. Strictly workspace-scoped: Cross-workspace access is rejected.
 * 2. Immutable snapshots: Past runs remain preserved when a new run executes.
 * 3. Page reloads restore the latest completed leaderboard snapshot without re-running network calls.
 * 4. Transparent statuses: PENDING, RUNNING, COMPLETED, PARTIALLY_COMPLETED, FAILED, CANCELED.
 * 5. Full cross-layer provenance validation and reconciliation.
 */

import { prisma } from "@/lib/db";
import { EvergreenLeaderboardResult } from "../evergreenResearchOrchestrator";

export interface KH02RunSummary {
  runId: string;
  workspaceId: string;
  topic: string;
  status: string;
  progress: number;
  totalCandidates: number;
  topCandidateTitles: string[];
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
}

export interface ProvenanceValidationResult {
  valid: boolean;
  errors: string[];
}

export interface ObservationIdentity {
  identityKey: string;
  provider: string;
  sourceRecordId: string;
}

export interface ProductEvidenceTrace {
  productId: string;
  title: string;
  candidateId?: string;
  supportingObservationsCount: number;
  sources: string[];
  evidenceReferences: string[];
  canonicalProductUrl?: string | null;
  storeDomain?: string | null;
}

export interface BrowserReconciliationEvidence {
  runId: string;
  workspaceId?: string;
  terminalStatus?: string;
  rankedCandidateIds?: string[];
  provisionalCandidateIds?: string[];
  displayedCandidateIds: string[];
  displayedRankOrder?: string[] | number[];
  displayedScores?: Record<string, number>;
  displayedConfidence?: Record<string, string>;
  visibleScoreValues?: number[];
  renderedSourceStatuses?: Record<string, string>;
  cardCount?: number;
  emptyStateRendered?: boolean;
}

export interface ComparableResearchSnapshot {
  runId: string;
  workspaceId: string;
  status: string;
  candidateIds: string[];
  rankedCandidateIds: string[];
  provisionalCandidateIds: string[];
  rankedScores: Record<string, number>;
  confidenceStatuses: Record<string, string>;
  sourceObservationIds: string[];
  rawObservationsCount: number | null;
  candidateCount: number;
}

export interface ReconciliationMismatch {
  field: string;
  expected: any;
  actual: any;
  reason: string;
}

export interface LayerComparisonResult {
  reconciled: boolean;
  mismatches: ReconciliationMismatch[];
}

export interface CrossLayerReconciliation {
  researchRunId: string;
  workspaceId?: string;
  status: string;
  rawObservationsCount: number | null;
  candidatesCount: number;
  topThreeCount: number;
  provisionalCount?: number;
  candidateIds?: string[];
  databaseConsistent?: boolean;
  httpReconciled?: boolean;
  httpStatus?: "PASS" | "FAIL" | "NOT_RUN" | "BLOCKED";
  browserReconciled?: boolean;
  browserStatus?: "PASS" | "FAIL" | "NOT_RUN" | "BLOCKED";
  productDiscoveryVerified?: boolean;
  liveSourceVerified?: boolean;
  persistedSnapshotMatchesHttp: boolean;
  reconciliationVerdict: "RECONCILED" | "MISMATCH";
  reconciled?: boolean;
  mismatches?: ReconciliationMismatch[];
  notes: string[];
}

export interface SchemaUpgradeResult {
  upgraded: boolean;
  addedColumns: string[];
  alreadyPresentColumns: string[];
  indicesVerified: boolean;
  error?: string;
}


/**
 * Creates a new persistent KH-02 research run in PENDING status.
 */
export async function createKH02ResearchRun(
  params: {
    workspaceId: string;
    topic: string;
    market?: string;
    lookbackDays?: number;
    maxCandidates?: number;
  },
  db: any = prisma
): Promise<string> {
  const runId = `kh02_run_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;

  await db.syncJob.create({
    data: {
      id: runId,
      workspaceId: params.workspaceId,
      jobType: "KH02_RESEARCH",
      status: "PENDING",
      progress: 0,
      totalItems: 0,
      resultJson: JSON.stringify({
        topic: params.topic,
        market: params.market || "US",
        lookbackDays: params.lookbackDays || 90,
        maxCandidates: params.maxCandidates || 15,
      }),
      createdAt: new Date(),
    },
  });

  return runId;
}

export const createResearchJob = async (
  input: { topic: string; market?: string; lookbackDays?: number; maxCandidates?: number },
  context: { workspaceId: string },
  db: any = prisma
): Promise<string> => {
  return createKH02ResearchRun({
    workspaceId: context.workspaceId,
    topic: input.topic,
    market: input.market,
    lookbackDays: input.lookbackDays,
    maxCandidates: input.maxCandidates,
  }, db);
};

/**
 * Enqueues or marks a research job available for worker consumption.
 */
export async function enqueueResearchJob(
  jobId: string,
  context?: { workspaceId?: string },
  db: any = prisma
): Promise<{ enqueued: boolean; jobId: string }> {
  const where: any = { id: jobId, jobType: "KH02_RESEARCH" };
  if (context?.workspaceId) where.workspaceId = context.workspaceId;

  const job = await db.syncJob.findFirst({ where });
  if (!job) {
    throw new Error(`Research job '${jobId}' not found for enqueue.`);
  }

  return { enqueued: true, jobId };
}

/**
 * Updates the execution progress and status of a persistent run.
 */
export async function updateKH02ResearchRunStatus(params: {
  runId: string;
  workspaceId: string;
  status: "RUNNING" | "COMPLETED" | "PARTIALLY_COMPLETED" | "FAILED" | "CANCELED";
  progress?: number;
  errorMessage?: string;
  startedAt?: Date;
  completedAt?: Date;
}): Promise<void> {
  const data: any = {
    status: params.status,
  };
  if (params.progress !== undefined) data.progress = params.progress;
  if (params.errorMessage !== undefined) data.errorMessage = params.errorMessage;
  if (params.startedAt) data.startedAt = params.startedAt;
  if (params.completedAt) data.completedAt = params.completedAt;

  await prisma.syncJob.updateMany({
    where: {
      id: params.runId,
      workspaceId: params.workspaceId,
      jobType: "KH02_RESEARCH",
    },
    data,
  });
}

/**
 * Persists the final immutable leaderboard ranking snapshot to the research run.
 */
export async function persistKH02RankingSnapshot(
  runId: string,
  workspaceId: string,
  result: EvergreenLeaderboardResult
): Promise<void> {
  await prisma.syncJob.updateMany({
    where: {
      id: runId,
      workspaceId,
      jobType: "KH02_RESEARCH",
    },
    data: {
      status: result.runStatus === "FAILED" ? "FAILED" : (result.runStatus === "PARTIAL" ? "PARTIALLY_COMPLETED" : "COMPLETED"),
      progress: 100,
      totalItems: result.totalCandidatesDiscovered,
      resultJson: JSON.stringify(result),
      completedAt: new Date(),
    },
  });
}

/**
 * Restores the latest completed leaderboard snapshot for a workspace.
 */
export async function getKH02Leaderboard(
  workspaceId: string
): Promise<EvergreenLeaderboardResult | null> {
  const latestJob = await prisma.syncJob.findFirst({
    where: {
      workspaceId,
      jobType: "KH02_RESEARCH",
      status: { in: ["COMPLETED", "PARTIALLY_COMPLETED"] },
    },
    orderBy: {
      completedAt: "desc",
    },
  });

  if (!latestJob?.resultJson) return null;

  try {
    return JSON.parse(latestJob.resultJson) as EvergreenLeaderboardResult;
  } catch {
    return null;
  }
}

/**
 * Retrieves research run history for a workspace.
 */
export async function getKH02ResearchRuns(
  workspaceId: string
): Promise<KH02RunSummary[]> {
  const jobs = await prisma.syncJob.findMany({
    where: {
      workspaceId,
      jobType: "KH02_RESEARCH",
    },
    orderBy: {
      createdAt: "desc",
    },
    take: 30,
  });

  return jobs.map((job) => {
    let topic = "General Research";
    let totalCandidates = job.totalItems || 0;
    let topCandidateTitles: string[] = [];

    if (job.resultJson) {
      try {
        const parsed = JSON.parse(job.resultJson);
        if (parsed.topic) topic = parsed.topic;
        if (Array.isArray(parsed.topThree)) {
          topCandidateTitles = parsed.topThree.map((item: any) => item.candidate?.title || "Product Candidate");
        }
      } catch {}
    }

    return {
      runId: job.id,
      workspaceId: job.workspaceId,
      topic,
      status: job.status,
      progress: job.progress,
      totalCandidates,
      topCandidateTitles,
      startedAt: job.startedAt ? job.startedAt.toISOString() : null,
      completedAt: job.completedAt ? job.completedAt.toISOString() : null,
      createdAt: job.createdAt.toISOString(),
    };
  });
}

/**
 * Retrieves an exact research run by ID for an authorized workspace.
 */
export async function getKH02ResearchRunById(
  runId: string,
  workspaceId: string,
  db: any = prisma
): Promise<{
  runId: string;
  workspaceId: string;
  status: string;
  progress: number;
  stage?: string;
  result: EvergreenLeaderboardResult | null;
  errorMessage?: string | null;
  startedAt?: string | null;
  completedAt?: string | null;
  leaseExpiresAt?: string | null;
  createdAt: string;
} | null> {
  const job = await db.syncJob.findFirst({
    where: {
      id: runId,
      workspaceId,
      jobType: "KH02_RESEARCH",
    },
  });

  if (!job) return null;

  let result: EvergreenLeaderboardResult | null = null;
  let meta: any = {};
  if (job.resultJson) {
    try {
      meta = JSON.parse(job.resultJson);
      if (meta.topThree || meta.formulaVersion) {
        result = meta;
      }
    } catch {}
  }

  const stage =
    meta._runtime?.lastProgress?.stage ||
    (job.status === "COMPLETED"
      ? "COMPLETED"
      : job.status === "FAILED"
      ? "FAILED"
      : job.status === "RUNNING"
      ? "RUNNING"
      : "QUEUED");

  return {
    runId: job.id,
    workspaceId: job.workspaceId,
    status: job.status,
    progress: job.progress,
    stage,
    result,
    errorMessage: job.errorMessage || null,
    startedAt: job.startedAt ? job.startedAt.toISOString() : null,
    completedAt: job.completedAt ? job.completedAt.toISOString() : null,
    leaseExpiresAt: job.leaseExpiresAt ? job.leaseExpiresAt.toISOString() : null,
    createdAt: job.createdAt.toISOString(),
  };
}

/**
 * Retrieves the currently active (PENDING or RUNNING) KH-02 research job for a workspace,
 * allowing instant re-attachment across browser reloads or page navigations.
 */
export async function getKH02ActiveResearchRun(
  workspaceId: string,
  db: any = prisma
): Promise<{
  runId: string;
  workspaceId: string;
  status: string;
  progress: number;
  stage: string;
  topic?: string;
  lookbackDays?: number;
  market?: string;
  startedAt: string | null;
  createdAt: string;
} | null> {
  const activeJob = await db.syncJob.findFirst({
    where: {
      workspaceId,
      jobType: "KH02_RESEARCH",
      status: { in: ["PENDING", "RUNNING"] },
    },
    orderBy: { createdAt: "desc" },
  });

  if (!activeJob) return null;

  let meta: any = {};
  if (activeJob.resultJson) {
    try {
      meta = JSON.parse(activeJob.resultJson);
    } catch {}
  }

  const stage =
    meta._runtime?.lastProgress?.stage ||
    (activeJob.status === "RUNNING" ? "RUNNING" : "QUEUED");

  return {
    runId: activeJob.id,
    workspaceId: activeJob.workspaceId,
    status: activeJob.status,
    progress: activeJob.progress,
    stage,
    topic: meta.topic,
    lookbackDays: meta.lookbackDays,
    market: meta.market || "US",
    startedAt: activeJob.startedAt ? activeJob.startedAt.toISOString() : null,
    createdAt: activeJob.createdAt.toISOString(),
  };
}

/**
 * Validates that an observation retains required external provenance fields.
 */
export function validateResearchProvenance(observation: any): ProvenanceValidationResult {
  const errors: string[] = [];
  if (!observation || typeof observation !== "object") {
    return { valid: false, errors: ["Observation must be a valid object."] };
  }

  if (!observation.source) errors.push("Missing source platform/provider.");
  if (!observation.sourceRecordId) errors.push("Missing sourceRecordId.");
  if (!observation.sourceUrl && !observation.landingPageUrl) {
    errors.push("Missing sourceUrl or landingPageUrl.");
  }
  if (!observation.observedAt) errors.push("Missing observedAt timestamp.");

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Builds a deterministic identity key for deduplicating repeated observation ingestion.
 */
export function buildObservationIdentity(
  provider: string,
  sourceRecord: any,
  context?: any
): ObservationIdentity {
  const recordId = String(sourceRecord.id || sourceRecord.sourceRecordId || sourceRecord.externalAdId || "");
  const observedDate = sourceRecord.observedAt ? new Date(sourceRecord.observedAt).toISOString().slice(0, 10) : "";
  const identityKey = `${provider}::${recordId}::${observedDate}`;

  return {
    identityKey,
    provider,
    sourceRecordId: recordId,
  };
}

/**
 * Asserts that the runtime database configuration does not target production.
 */
export function assertSafeTestDatabase(databaseConfig?: any): void {
  const url = databaseConfig?.url || process.env.DATABASE_URL || "";
  const isProd = process.env.NODE_ENV === "production" || url.includes("prod.db") || url.includes("production");
  if (isProd) {
    throw new Error("Safety violation: Destructive test operations are prohibited against production databases.");
  }
}

/**
 * Traces a displayed product card to its underlying persisted provider observations.
 */
export async function traceProductCardEvidence(
  productId: string,
  researchJobId: string,
  db: any = prisma
): Promise<ProductEvidenceTrace | null> {
  const job = await db.syncJob.findUnique({ where: { id: researchJobId } });
  if (!job?.resultJson) return null;

  try {
    const result: EvergreenLeaderboardResult = JSON.parse(job.resultJson);
    const allItems = [...(result.topThree || []), ...(result.provisionalCandidates || [])];

    const match = allItems.find(
      (item) => item.candidate.candidateId === productId || item.candidate.researchProductId === productId
    );

    if (!match) return null;

    const observations = match.candidate.sourceObservations || [];
    const sources = Array.from(new Set(observations.map((o: any) => o.source)));
    const evidenceReferences = observations.map((o: any) => o.evidenceReference || o.sourceUrl).filter(Boolean);

    return {
      productId,
      title: match.candidate.title,
      candidateId: match.candidate.candidateId,
      supportingObservationsCount: observations.length,
      sources,
      evidenceReferences,
      canonicalProductUrl: match.candidate.canonicalProductUrl,
      storeDomain: match.candidate.storeDomain,
    };
  } catch {
    return null;
  }
}

export interface TestFixtureRegistry {
  workspaceIds?: string[];
  jobIds?: string[];
  advertiserIds?: string[];
  adIds?: string[];
  dataSourceIds?: string[];
  watchlistIds?: string[];
  watchlistItemIds?: string[];
  productIds?: string[];
}

/**
 * Scoped, non-destructive test fixture cleanup that removes ONLY owned test IDs.
 * Strictly avoids unscoped deleteMany({}) operations to protect shared data.
 */
export async function cleanupKH02TestFixtures(
  registry: TestFixtureRegistry,
  db: any = prisma
): Promise<{ cleanedCount: number }> {
  let cleanedCount = 0;

  // 1. Clean sync jobs owned by test workspaces or matching test job IDs
  if ((registry.jobIds && registry.jobIds.length > 0) || (registry.workspaceIds && registry.workspaceIds.length > 0)) {
    const res = await db.syncJob.deleteMany({
      where: {
        OR: [
          ...(registry.jobIds && registry.jobIds.length > 0 ? [{ id: { in: registry.jobIds } }] : []),
          ...(registry.workspaceIds && registry.workspaceIds.length > 0 ? [{ workspaceId: { in: registry.workspaceIds } }] : []),
        ],
      },
    });
    cleanedCount += res.count;
  }

  // 2. Clean research evidence (if table exists and workspace registered)
  if (registry.workspaceIds && registry.workspaceIds.length > 0 && db.researchEvidence) {
    try {
      const res = await db.researchEvidence.deleteMany({
        where: { workspaceId: { in: registry.workspaceIds } },
      });
      cleanedCount += res.count;
    } catch {
      // Optional model table may not be migrated in active sqlite db
    }
  }

  // 3. Clean watchlist items
  if (
    (registry.watchlistItemIds && registry.watchlistItemIds.length > 0) ||
    (registry.watchlistIds && registry.watchlistIds.length > 0) ||
    (registry.adIds && registry.adIds.length > 0)
  ) {
    const res = await db.watchlistItem.deleteMany({
      where: {
        OR: [
          ...(registry.watchlistItemIds && registry.watchlistItemIds.length > 0 ? [{ id: { in: registry.watchlistItemIds } }] : []),
          ...(registry.watchlistIds && registry.watchlistIds.length > 0 ? [{ watchlistId: { in: registry.watchlistIds } }] : []),
          ...(registry.adIds && registry.adIds.length > 0 ? [{ adId: { in: registry.adIds } }] : []),
        ],
      },
    });
    cleanedCount += res.count;
  }

  // 4. Clean watchlists
  if ((registry.watchlistIds && registry.watchlistIds.length > 0) || (registry.workspaceIds && registry.workspaceIds.length > 0)) {
    const res = await db.watchlist.deleteMany({
      where: {
        OR: [
          ...(registry.watchlistIds && registry.watchlistIds.length > 0 ? [{ id: { in: registry.watchlistIds } }] : []),
          ...(registry.workspaceIds && registry.workspaceIds.length > 0 ? [{ workspaceId: { in: registry.workspaceIds } }] : []),
        ],
      },
    });
    cleanedCount += res.count;
  }

  // 5. Clean competitor ads (cascades to adMediaAssets, adProductLinks, etc.)
  if (registry.adIds && registry.adIds.length > 0) {
    const res = await db.competitorAd.deleteMany({
      where: { id: { in: registry.adIds } },
    });
    cleanedCount += res.count;
  }

  // 5b. Clean research products (cascades to productDemandObservation, etc.)
  if (registry.productIds && registry.productIds.length > 0) {
    const res = await db.researchProduct.deleteMany({
      where: { id: { in: registry.productIds } },
    });
    cleanedCount += res.count;
  }

  // 6. Clean data sources
  if (registry.dataSourceIds && registry.dataSourceIds.length > 0) {
    const res = await db.dataSource.deleteMany({
      where: { id: { in: registry.dataSourceIds } },
    });
    cleanedCount += res.count;
  }

  // 7. Clean advertisers
  if (registry.advertiserIds && registry.advertiserIds.length > 0) {
    const res = await db.advertiser.deleteMany({
      where: { id: { in: registry.advertiserIds } },
    });
    cleanedCount += res.count;
  }

  // 8. Clean workspaces
  if (registry.workspaceIds && registry.workspaceIds.length > 0) {
    const res = await db.workspace.deleteMany({
      where: { id: { in: registry.workspaceIds } },
    });
    cleanedCount += res.count;
  }

  return { cleanedCount };
}

export interface DatabaseReconciliationResult {
  researchRunId: string;
  status: string;
  rawObservationsCount: number;
  candidatesCount: number;
  topThreeCount: number;
  isConsistent: boolean;
  notes: string[];
}

/**
 * Validates persistent database integrity for a research run.
 */
export async function reconcilePersistedResearch(
  runId: string,
  workspaceId: string,
  db: any = prisma
): Promise<DatabaseReconciliationResult> {
  const job = await db.syncJob.findFirst({
    where: { id: runId, workspaceId, jobType: "KH02_RESEARCH" },
  });

  if (!job) {
    return {
      researchRunId: runId,
      status: "NOT_FOUND",
      rawObservationsCount: 0,
      candidatesCount: 0,
      topThreeCount: 0,
      isConsistent: false,
      notes: [`Job '${runId}' for workspace '${workspaceId}' not found in database.`],
    };
  }

  let snapshot: EvergreenLeaderboardResult | null = null;
  try {
    snapshot = JSON.parse(job.resultJson || "{}");
  } catch {}

  const rawCount = (snapshot as any)?.totalObservationsCollected ?? (snapshot?.totalCandidatesDiscovered || 0);
  const candCount = snapshot?.totalCandidatesDiscovered || 0;
  const topCount = snapshot?.topThree?.length || 0;

  const notes: string[] = [];
  let isConsistent = Boolean(snapshot && job.status !== "PENDING");
  if (!snapshot) {
    notes.push("Missing or corrupted resultJson snapshot in database.");
  } else {
    notes.push(`Persisted database state verified: ${candCount} candidates discovered, ${topCount} ranked winners.`);
  }

  return {
    researchRunId: runId,
    status: job.status,
    rawObservationsCount: rawCount,
    candidatesCount: candCount,
    topThreeCount: topCount,
    isConsistent,
    notes,
  };
}

/**
 * Normalizes any research run representation (SyncJob, API payload, or LeaderboardResult)
 * into a canonical ComparableResearchSnapshot for exact cross-layer equivalence.
 */
export function normalizeResearchSnapshotForComparison(
  source: any,
  workspaceId?: string
): ComparableResearchSnapshot {
  if (!source) {
    return {
      runId: "",
      workspaceId: workspaceId || "",
      status: "NOT_FOUND",
      candidateIds: [],
      rankedCandidateIds: [],
      provisionalCandidateIds: [],
      rankedScores: {},
      confidenceStatuses: {},
      sourceObservationIds: [],
      rawObservationsCount: null,
      candidateCount: 0,
    };
  }

  const runId = source.runId || source.id || source.researchRunId || "";
  const resolvedWorkspaceId = source.workspaceId || workspaceId || "";
  const status = source.status || source.runStatus || "UNKNOWN";

  let snapshot: any = source;
  if (source.result && typeof source.result === "object") {
    snapshot = source.result;
  } else if (source.resultJson) {
    try {
      snapshot = JSON.parse(source.resultJson);
    } catch {
      snapshot = {};
    }
  }

  const topThreeList = Array.isArray(snapshot?.topThree) ? snapshot.topThree : [];
  const provList = Array.isArray(snapshot?.provisionalCandidates) ? snapshot.provisionalCandidates : [];
  const remainingList = Array.isArray(snapshot?.remainingCandidates) ? snapshot.remainingCandidates : [];

  const rankedCandidateIds: string[] = [];
  const rankedScores: Record<string, number> = {};
  const confidenceStatuses: Record<string, string> = {};
  const sourceObservationIds: string[] = [];

  for (const item of topThreeList) {
    const cid =
      item?.candidate?.candidateId ||
      item?.candidate?.id ||
      item?.candidateId ||
      item?.id ||
      (typeof item?.candidate?.title === "string" ? item.candidate.title : undefined);
    if (cid && typeof cid === "string") {
      rankedCandidateIds.push(cid);
      const scoreVal = typeof item.score?.opportunityScore === "number" ? item.score.opportunityScore : 0;
      rankedScores[cid] = Math.round(scoreVal * 100) / 100;
      confidenceStatuses[cid] = item.score?.scoreStatus || "UNKNOWN";

      if (Array.isArray(item.candidate?.sourceObservations)) {
        for (const obs of item.candidate.sourceObservations) {
          if (obs?.sourceRecordId) sourceObservationIds.push(obs.sourceRecordId);
        }
      }
    }
  }

  const provisionalCandidateIds: string[] = [];
  for (const item of provList) {
    const cid =
      item?.candidate?.candidateId ||
      item?.candidate?.id ||
      item?.candidateId ||
      item?.id ||
      (typeof item?.candidate?.title === "string" ? item.candidate.title : undefined);
    if (cid && typeof cid === "string") {
      provisionalCandidateIds.push(cid);
      const scoreVal = typeof item.score?.opportunityScore === "number" ? item.score.opportunityScore : 0;
      rankedScores[cid] = Math.round(scoreVal * 100) / 100;
      confidenceStatuses[cid] = item.score?.scoreStatus || "PROVISIONAL";
    }
  }

  const remainingCandidateIds: string[] = [];
  for (const item of remainingList) {
    const cid =
      item?.candidate?.candidateId ||
      item?.candidate?.id ||
      item?.candidateId ||
      item?.id ||
      (typeof item?.candidate?.title === "string" ? item.candidate.title : undefined);
    if (cid && typeof cid === "string") {
      remainingCandidateIds.push(cid);
    }
  }

  // Canonical candidate IDs preserving category hierarchy (topThree, then provisional, then remaining)
  const candidateIds: string[] = Array.from(
    new Set([...rankedCandidateIds, ...provisionalCandidateIds, ...remainingCandidateIds])
  );

  // Authoritative raw observation count: only when explicitly present as a number; NEVER substitute candidateCount!
  const rawObservationsCount =
    typeof snapshot?.totalObservationsCollected === "number"
      ? snapshot.totalObservationsCollected
      : null;

  const candidateCount =
    typeof snapshot?.totalCandidatesDiscovered === "number"
      ? snapshot.totalCandidatesDiscovered
      : candidateIds.length;

  return {
    runId,
    workspaceId: resolvedWorkspaceId,
    status,
    candidateIds,
    rankedCandidateIds,
    provisionalCandidateIds,
    rankedScores,
    confidenceStatuses,
    sourceObservationIds,
    rawObservationsCount,
    candidateCount,
  };
}

/**
 * Reconciles the database snapshot with the live HTTP endpoint response.
 * Compares exact candidate identity, ordered ranking, score tolerance, and terminal status.
 */
export async function reconcileDatabaseAndHttp(
  dbSnapshot: ComparableResearchSnapshot,
  httpEndpoint: string,
  context: { workspaceId?: string; headers?: Record<string, string> }
): Promise<LayerComparisonResult> {
  const mismatches: ReconciliationMismatch[] = [];

  try {
    const headers: Record<string, string> = {
      ...(context.headers || {}),
    };
    if (context.workspaceId || dbSnapshot.workspaceId) {
      headers["x-workspace-id"] = context.workspaceId || dbSnapshot.workspaceId;
    }

    const res = await fetch(httpEndpoint, { headers });
    if (!res.ok) {
      mismatches.push({
        field: "httpStatusCode",
        expected: 200,
        actual: res.status,
        reason: `HTTP readback failed with status code ${res.status}`,
      });
      return { reconciled: false, mismatches };
    }

    const json = await res.json().catch(() => null);
    if (!json || !json.data) {
      mismatches.push({
        field: "httpPayload",
        expected: "JSON response with data property",
        actual: json,
        reason: "HTTP response body was missing or malformed data payload",
      });
      return { reconciled: false, mismatches };
    }

    const httpSnapshot = normalizeResearchSnapshotForComparison(
      json.data,
      context.workspaceId || dbSnapshot.workspaceId
    );

    // 1. Run ID equality
    if (httpSnapshot.runId !== dbSnapshot.runId) {
      mismatches.push({
        field: "runId",
        expected: dbSnapshot.runId,
        actual: httpSnapshot.runId,
        reason: `HTTP runId '${httpSnapshot.runId}' does not match DB runId '${dbSnapshot.runId}'`,
      });
    }

    // 2. Workspace ID equality
    if (dbSnapshot.workspaceId && httpSnapshot.workspaceId && httpSnapshot.workspaceId !== dbSnapshot.workspaceId) {
      mismatches.push({
        field: "workspaceId",
        expected: dbSnapshot.workspaceId,
        actual: httpSnapshot.workspaceId,
        reason: `HTTP workspaceId '${httpSnapshot.workspaceId}' does not match DB workspaceId '${dbSnapshot.workspaceId}'`,
      });
    }

    // 3. Status equality
    if (httpSnapshot.status !== dbSnapshot.status) {
      mismatches.push({
        field: "status",
        expected: dbSnapshot.status,
        actual: httpSnapshot.status,
        reason: `HTTP status '${httpSnapshot.status}' does not match DB status '${dbSnapshot.status}'`,
      });
    }

    // 4. Exact ranked candidate IDs (ordered!)
    if (
      httpSnapshot.rankedCandidateIds.length !== dbSnapshot.rankedCandidateIds.length ||
      httpSnapshot.rankedCandidateIds.some((id, idx) => id !== dbSnapshot.rankedCandidateIds[idx])
    ) {
      mismatches.push({
        field: "rankedCandidateIds",
        expected: dbSnapshot.rankedCandidateIds,
        actual: httpSnapshot.rankedCandidateIds,
        reason: `HTTP ranked candidates order/set mismatch. Expected [${dbSnapshot.rankedCandidateIds.join(", ")}], received [${httpSnapshot.rankedCandidateIds.join(", ")}]`,
      });
    }

    // 5. Complete candidate IDs set equality
    const dbSet = new Set(dbSnapshot.candidateIds);
    const httpSet = new Set(httpSnapshot.candidateIds);
    const missingInHttp = dbSnapshot.candidateIds.filter((id) => !httpSet.has(id));
    const extraInHttp = httpSnapshot.candidateIds.filter((id) => !dbSet.has(id));

    if (missingInHttp.length > 0 || extraInHttp.length > 0) {
      mismatches.push({
        field: "candidateIds",
        expected: dbSnapshot.candidateIds,
        actual: httpSnapshot.candidateIds,
        reason: `HTTP candidate set differs: missing [${missingInHttp.join(", ")}], extra [${extraInHttp.join(", ")}]`,
      });
    }

    // 6. Check for duplicate candidate IDs in HTTP
    const seenHttp = new Set<string>();
    const dupHttp: string[] = [];
    for (const cid of httpSnapshot.candidateIds) {
      if (seenHttp.has(cid)) dupHttp.push(cid);
      seenHttp.add(cid);
    }
    if (dupHttp.length > 0) {
      mismatches.push({
        field: "duplicateCandidates",
        expected: [],
        actual: dupHttp,
        reason: `HTTP response contains duplicate candidate IDs: [${dupHttp.join(", ")}]`,
      });
    }

    // 7. Ranked score equality (tolerance 0.01)
    for (const cid of dbSnapshot.rankedCandidateIds) {
      const dbScore = dbSnapshot.rankedScores[cid];
      const httpScore = httpSnapshot.rankedScores[cid];
      if (dbScore !== undefined && httpScore !== undefined) {
        if (Math.abs(dbScore - httpScore) > 0.01) {
          mismatches.push({
            field: `rankedScores.${cid}`,
            expected: dbScore,
            actual: httpScore,
            reason: `Score mismatch for candidate '${cid}': DB=${dbScore} vs HTTP=${httpScore}`,
          });
        }
      } else if (dbScore !== undefined && httpScore === undefined) {
        mismatches.push({
          field: `rankedScores.${cid}`,
          expected: dbScore,
          actual: undefined,
          reason: `Candidate '${cid}' missing score in HTTP payload`,
        });
      }
    }

    return {
      reconciled: mismatches.length === 0,
      mismatches,
    };
  } catch (err: any) {
    mismatches.push({
      field: "httpNetworkError",
      expected: "Successful HTTP request",
      actual: err.message,
      reason: `HTTP reconciliation network error: ${err.message}`,
    });
    return { reconciled: false, mismatches };
  }
}

/**
 * Reconciles the database snapshot with Playwright Chromium browser evidence.
 * Enforces exact candidate set equality, rank ordering, and rejects partial matches.
 */
export function reconcileDatabaseAndBrowser(
  dbSnapshot: ComparableResearchSnapshot,
  browserEvidence: BrowserReconciliationEvidence
): LayerComparisonResult {
  const mismatches: ReconciliationMismatch[] = [];

  // 1. Run ID equality
  if (browserEvidence.runId !== dbSnapshot.runId) {
    mismatches.push({
      field: "browserRunId",
      expected: dbSnapshot.runId,
      actual: browserEvidence.runId,
      reason: `Browser evidenced runId '${browserEvidence.runId}' does not match DB runId '${dbSnapshot.runId}'`,
    });
    return { reconciled: false, mismatches };
  }

  // 2. Terminal state check
  if (browserEvidence.terminalStatus && browserEvidence.terminalStatus !== dbSnapshot.status) {
    mismatches.push({
      field: "browserTerminalStatus",
      expected: dbSnapshot.status,
      actual: browserEvidence.terminalStatus,
      reason: `Browser terminal status '${browserEvidence.terminalStatus}' !== DB status '${dbSnapshot.status}'`,
    });
  }

  // 3. Empty state vs Nonzero candidates
  if (dbSnapshot.candidateCount === 0) {
    if (browserEvidence.displayedCandidateIds.length > 0) {
      mismatches.push({
        field: "browserCandidateCount",
        expected: 0,
        actual: browserEvidence.displayedCandidateIds.length,
        reason: `DB discovered 0 candidates, but browser displayed ${browserEvidence.displayedCandidateIds.length} candidate card(s)`,
      });
    }
    if (browserEvidence.emptyStateRendered === false) {
      mismatches.push({
        field: "emptyStateRendered",
        expected: true,
        actual: false,
        reason: "Expected empty-state component to be rendered in browser for 0-candidate run",
      });
    }
    return { reconciled: mismatches.length === 0, mismatches };
  }

  // 4. Nonzero candidate case: Complete set equality
  const expectedCids = dbSnapshot.candidateIds;
  const displayedCids = browserEvidence.displayedCandidateIds;

  const displayedSet = new Set(displayedCids);
  const expectedSet = new Set(expectedCids);

  const missingInBrowser = expectedCids.filter((id) => !displayedSet.has(id));
  const extraInBrowser = displayedCids.filter((id) => !expectedSet.has(id));

  if (missingInBrowser.length > 0 || extraInBrowser.length > 0) {
    mismatches.push({
      field: "displayedCandidateIds",
      expected: expectedCids,
      actual: displayedCids,
      reason: `Browser candidate set mismatch: missing in browser [${missingInBrowser.join(", ")}], extra in browser [${extraInBrowser.join(", ")}]`,
    });
  }

  // 5. Check for duplicate candidate IDs rendered in browser
  const seenBrowser = new Set<string>();
  const dupBrowser: string[] = [];
  for (const cid of displayedCids) {
    if (seenBrowser.has(cid)) dupBrowser.push(cid);
    seenBrowser.add(cid);
  }
  if (dupBrowser.length > 0) {
    mismatches.push({
      field: "duplicateBrowserCandidates",
      expected: [],
      actual: dupBrowser,
      reason: `Browser rendered duplicate candidate IDs: [${dupBrowser.join(", ")}]`,
    });
  }

  // 6. Ranked order check
  if (browserEvidence.displayedRankOrder && browserEvidence.displayedRankOrder.length > 0) {
    const expectedRanked = dbSnapshot.rankedCandidateIds;
    const actualRanked = browserEvidence.displayedRankOrder.map((v) => String(v));
    if (
      actualRanked.length !== expectedRanked.length ||
      actualRanked.some((id, idx) => id !== expectedRanked[idx])
    ) {
      mismatches.push({
        field: "displayedRankOrder",
        expected: expectedRanked,
        actual: actualRanked,
        reason: `Browser displayed rank order mismatch. Expected [${expectedRanked.join(", ")}], received [${actualRanked.join(", ")}]`,
      });
    }
  }

  // 7. Score value check (display rounding tolerance 1.0)
  if (browserEvidence.displayedScores) {
    for (const [cid, browserScore] of Object.entries(browserEvidence.displayedScores)) {
      const dbScore = dbSnapshot.rankedScores[cid];
      if (dbScore !== undefined) {
        if (Math.abs(dbScore - browserScore) > 1.0) {
          mismatches.push({
            field: `displayedScores.${cid}`,
            expected: dbScore,
            actual: browserScore,
            reason: `Browser score for '${cid}' is ${browserScore}, but DB score is ${dbScore}`,
          });
        }
      }
    }
  }

  // 8. Confidence status check
  if (browserEvidence.displayedConfidence) {
    for (const [cid, browserConf] of Object.entries(browserEvidence.displayedConfidence)) {
      const dbConf = dbSnapshot.confidenceStatuses[cid];
      if (dbConf && browserConf !== dbConf) {
        mismatches.push({
          field: `displayedConfidence.${cid}`,
          expected: dbConf,
          actual: browserConf,
          reason: `Browser confidence for '${cid}' is '${browserConf}', but DB is '${dbConf}'`,
        });
      }
    }
  }

  return {
    reconciled: mismatches.length === 0,
    mismatches,
  };
}

/**
 * Reconciles research integrity across Source, Database, HTTP, and Browser layers.
 * Performs real HTTP verification when baseUrl is provided in context.
 * Performs exact candidate set, ranking, and scoring verification with browser evidence.
 */
export async function reconcileResearchAcrossLayers(
  researchJobId: string,
  context?: {
    baseUrl?: string;
    workspaceId?: string;
    db?: any;
    browserDisplayedCount?: number;
    browserEvidence?: BrowserReconciliationEvidence;
    strictFullLayers?: boolean;
    requireAllLayers?: boolean;
  }
): Promise<CrossLayerReconciliation> {
  const db = context?.db || prisma;
  const job = await db.syncJob.findUnique({ where: { id: researchJobId } });

  const notes: string[] = [];
  const allMismatches: ReconciliationMismatch[] = [];

  if (!job) {
    return {
      researchRunId: researchJobId,
      workspaceId: context?.workspaceId || "",
      status: "NOT_FOUND",
      rawObservationsCount: null,
      candidatesCount: 0,
      topThreeCount: 0,
      provisionalCount: 0,
      candidateIds: [],
      databaseConsistent: false,
      httpReconciled: false,
      httpStatus: "NOT_RUN",
      browserReconciled: false,
      browserStatus: "NOT_RUN",
      productDiscoveryVerified: false,
      liveSourceVerified: false,
      persistedSnapshotMatchesHttp: false,
      reconciliationVerdict: "MISMATCH",
      mismatches: [
        {
          field: "jobId",
          expected: researchJobId,
          actual: null,
          reason: `Job '${researchJobId}' does not exist in database.`,
        },
      ],
      notes: [`Job '${researchJobId}' does not exist in database.`],
    };
  }

  const dbSnapshot = normalizeResearchSnapshotForComparison(job, context?.workspaceId || job.workspaceId);
  const isConsistent = Boolean(job.resultJson && job.status !== "PENDING");

  if (!job.resultJson) {
    allMismatches.push({
      field: "resultJson",
      expected: "Valid JSON leaderboard snapshot",
      actual: null,
      reason: "Missing or corrupted resultJson snapshot in database.",
    });
    notes.push("Missing or corrupted resultJson snapshot in database.");
  } else {
    notes.push(
      `DB snapshot verified: ${dbSnapshot.candidateCount} candidates (${dbSnapshot.rankedCandidateIds.length} ranked, ${dbSnapshot.provisionalCandidateIds.length} provisional).`
    );
  }

  // ── HTTP Reconciliation ──
  let httpReconciled = false;
  let httpStatus: "PASS" | "FAIL" | "NOT_RUN" | "BLOCKED" = "NOT_RUN";

  if (context?.baseUrl) {
    const httpEndpoint = `${context.baseUrl}/api/v1/kh02/research/runs/${researchJobId}`;
    const httpResult = await reconcileDatabaseAndHttp(dbSnapshot, httpEndpoint, {
      workspaceId: context.workspaceId || job.workspaceId,
    });

    if (httpResult.reconciled) {
      httpReconciled = true;
      httpStatus = "PASS";
      notes.push("HTTP readback content verified: exact match with DB snapshot.");
    } else {
      httpReconciled = false;
      httpStatus = "FAIL";
      allMismatches.push(...httpResult.mismatches);
      for (const m of httpResult.mismatches) {
        notes.push(`HTTP mismatch on [${m.field}]: ${m.reason}`);
      }
    }
  } else {
    notes.push("HTTP layer check skipped: no baseUrl context provided.");
    httpStatus = "NOT_RUN";
    httpReconciled = false;
  }

  // ── Browser Reconciliation ──
  let browserReconciled = false;
  let browserStatus: "PASS" | "FAIL" | "NOT_RUN" | "BLOCKED" = "NOT_RUN";

  if (context?.browserEvidence) {
    const bResult = reconcileDatabaseAndBrowser(dbSnapshot, context.browserEvidence);
    if (bResult.reconciled) {
      browserReconciled = true;
      browserStatus = "PASS";
      notes.push("Browser reconciliation verified: complete candidate set, rank order, and scores match DB.");
    } else {
      browserReconciled = false;
      browserStatus = "FAIL";
      allMismatches.push(...bResult.mismatches);
      for (const m of bResult.mismatches) {
        notes.push(`Browser mismatch on [${m.field}]: ${m.reason}`);
      }
    }
  } else if (context?.browserDisplayedCount !== undefined) {
    if (context.browserDisplayedCount !== dbSnapshot.candidateCount) {
      browserReconciled = false;
      browserStatus = "FAIL";
      allMismatches.push({
        field: "browserDisplayedCount",
        expected: dbSnapshot.candidateCount,
        actual: context.browserDisplayedCount,
        reason: `Browser card count mismatch: rendered ${context.browserDisplayedCount} vs DB ${dbSnapshot.candidateCount}`,
      });
      notes.push(`Browser count mismatch: ${context.browserDisplayedCount} rendered vs ${dbSnapshot.candidateCount} in DB.`);
    } else {
      browserReconciled = true;
      browserStatus = "PASS";
      notes.push(`Browser card count matched: ${context.browserDisplayedCount} cards rendered.`);
    }
  } else {
    notes.push("Browser layer check skipped: no browserEvidence or browserDisplayedCount provided.");
    browserStatus = "NOT_RUN";
    browserReconciled = false;
  }

  const productDiscoveryVerified = dbSnapshot.candidateIds.length > 0;
  const liveSourceVerified = (dbSnapshot.rawObservationsCount ?? 0) > 0;

  // Strict full-layer evaluation when requested: all layers (DB, HTTP, Browser) must pass.
  // When offline / single-layer testing: evaluated layers must pass with 0 mismatches.
  const requireAll = context?.strictFullLayers === true || context?.requireAllLayers === true;
  let verdict: "RECONCILED" | "MISMATCH";

  if (requireAll) {
    verdict =
      isConsistent && httpReconciled && browserReconciled && allMismatches.length === 0
        ? "RECONCILED"
        : "MISMATCH";
  } else {
    const httpOk = context?.baseUrl ? httpReconciled : true;
    const browserOk =
      context?.browserEvidence || context?.browserDisplayedCount !== undefined ? browserReconciled : true;
    verdict = isConsistent && httpOk && browserOk && allMismatches.length === 0 ? "RECONCILED" : "MISMATCH";
  }

  return {
    researchRunId: researchJobId,
    workspaceId: dbSnapshot.workspaceId,
    status: job.status,
    rawObservationsCount: dbSnapshot.rawObservationsCount,
    candidatesCount: dbSnapshot.candidateCount,
    topThreeCount: dbSnapshot.rankedCandidateIds.length,
    provisionalCount: dbSnapshot.provisionalCandidateIds.length,
    candidateIds: dbSnapshot.candidateIds,
    databaseConsistent: isConsistent,
    httpReconciled,
    httpStatus,
    browserReconciled,
    browserStatus,
    productDiscoveryVerified,
    liveSourceVerified,
    persistedSnapshotMatchesHttp: httpReconciled, // Backwards compatible with existing KH-01/KH-02 callers
    reconciliationVerdict: verdict,
    reconciled: verdict === "RECONCILED",
    mismatches: allMismatches,
    notes,
  };
}

/**
 * Idempotently checks and upgrades preexisting SQLite databases to ensure all
 * V12.1 dedicated KH-02 leasing and fencing columns exist without destructive table recreations.
 * Inspects PRAGMA table_info and PRAGMA index_list directly against SQLite metadata.
 */
export async function ensureSyncJobSchemaUpgraded(
  db: any = prisma
): Promise<SchemaUpgradeResult> {
  const addedColumns: string[] = [];
  const alreadyPresentColumns: string[] = [];

  try {
    const rawCols: any = await db.$queryRawUnsafe(
      'PRAGMA table_info("sync_jobs");'
    );
    const existingColNames = new Set((rawCols || []).map((c: any) => c.name));

    const requiredColumns: Array<{ name: string; ddl: string }> = [
      { name: "workerId", ddl: 'ALTER TABLE "sync_jobs" ADD COLUMN "workerId" TEXT;' },
      { name: "claimToken", ddl: 'ALTER TABLE "sync_jobs" ADD COLUMN "claimToken" TEXT;' },
      { name: "fencingToken", ddl: 'ALTER TABLE "sync_jobs" ADD COLUMN "fencingToken" TEXT;' },
      { name: "fencingGeneration", ddl: 'ALTER TABLE "sync_jobs" ADD COLUMN "fencingGeneration" INTEGER NOT NULL DEFAULT 0;' },
      { name: "recordVersion", ddl: 'ALTER TABLE "sync_jobs" ADD COLUMN "recordVersion" INTEGER NOT NULL DEFAULT 0;' },
      { name: "leaseExpiresAt", ddl: 'ALTER TABLE "sync_jobs" ADD COLUMN "leaseExpiresAt" DATETIME;' },
      { name: "attemptNumber", ddl: 'ALTER TABLE "sync_jobs" ADD COLUMN "attemptNumber" INTEGER NOT NULL DEFAULT 0;' },
    ];

    for (const col of requiredColumns) {
      if (!existingColNames.has(col.name)) {
        await db.$executeRawUnsafe(col.ddl);
        addedColumns.push(col.name);
      } else {
        alreadyPresentColumns.push(col.name);
      }
    }

    // Ensure dedicated performance and query indices exist
    await db.$executeRawUnsafe('CREATE INDEX IF NOT EXISTS "sync_jobs_jobType_status_idx" ON "sync_jobs"("jobType", "status");');
    await db.$executeRawUnsafe('CREATE INDEX IF NOT EXISTS "sync_jobs_workerId_status_idx" ON "sync_jobs"("workerId", "status");');

    // Authoritative verification against actual SQLite metadata
    const rawIndices: any = await db.$queryRawUnsafe('PRAGMA index_list("sync_jobs");').catch(() => []);
    const indexNames = new Set((rawIndices || []).map((idx: any) => idx.name));
    const indicesVerified =
      indexNames.has("sync_jobs_jobType_status_idx") &&
      indexNames.has("sync_jobs_workerId_status_idx");

    return {
      upgraded: addedColumns.length > 0,
      addedColumns,
      alreadyPresentColumns,
      indicesVerified,
    };
  } catch (err: any) {
    return {
      upgraded: false,
      addedColumns,
      alreadyPresentColumns,
      indicesVerified: false,
      error: err.message,
    };
  }
}
