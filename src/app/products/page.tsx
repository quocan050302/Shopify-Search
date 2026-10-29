"use client";

import React, { useState, useEffect, useCallback, useRef, useMemo } from "react";
import Link from "next/link";
import {
  Search,
  ShoppingBag,
  TrendingUp,
  Store,
  ExternalLink,
  AlertCircle,
  Sparkles,
  Award,
  Clock,
  CheckCircle2,
  XCircle,
  Loader2,
  Database,
  ShieldCheck,
  RefreshCw,
  ChevronRight,
  SlidersHorizontal,
  Play,
  X,
  Info,
  AlertTriangle,
  History,
  Filter,
  Layers,
  Activity,
  Users,
  FileSearch,
  BarChart3,
} from "lucide-react";
import type {
  EvergreenLeaderboardResponse,
  RankedProductCandidate,
  SourceConnectionSummary,
  ResearchSourceMode,
} from "@/services/kh02/types";
import {
  buildCanonicalRecommendedProducts,
  buildAllCandidatesExplorerList,
  formatBusinessTerm,
  type CanonicalRecommendedProduct,
  type ExplorerCandidateRow,
  type ExplorerCandidateStatus,
} from "@/services/kh02/presentation/productFinderViewModel";

function isStockImage(url: string | null | undefined): boolean {
  if (!url) return true;
  const lower = url.toLowerCase();
  return (
    lower.includes("unsplash.com") ||
    lower.includes("picsum.photos") ||
    lower.includes("placehold.co") ||
    lower.includes("placeholder.com") ||
    lower.includes("via.placeholder") ||
    lower.includes("dummyimage.com")
  );
}

function formatRelativeAge(isoDate: string | null | undefined): string {
  if (!isoDate) return "Just now";
  const ts = new Date(isoDate).getTime();
  if (Number.isNaN(ts)) return "Just now";
  const diffSec = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  if (diffSec < 60) return `${diffSec}s ago`;
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDays = Math.floor(diffHr / 24);
  return `${diffDays}d ago`;
}

interface StoredProductItem {
  id: string;
  title: string;
  category: string;
  imageUrl: string | null;
  productUrl: string | null;
  currentPrice: number | null;
  compareAtPrice: number | null;
  store?: {
    id: string;
    domain: string;
    storeName: string | null;
  };
  adLinks?: Array<{
    adId: string;
    confidenceScore: number;
  }>;
}

interface ActiveJobProgress {
  jobId: string;
  runId: string;
  status: "QUEUED" | "RUNNING" | "COMPLETED" | "FAILED" | "PARTIAL";
  stage: string;
  progressPct: number;
  errorSummary?: string | null;
  startedAt?: string | null;
  completedAt?: string | null;
}

interface RecentRunHistoryItem {
  runId: string;
  topic: string;
  country: string;
  lookbackDays: number;
  status: string;
  currentStage: string;
  progressPct: number;
  totalObservations: number;
  totalCandidates: number;
  verifiedCandidates: number;
  evergreenWinners: number;
  createdAt: string;
  completedAt?: string | null;
}

type PrimaryTab = "RECOMMENDED" | "ALL_CANDIDATES" | "EVIDENCE_DIAGNOSTICS";
type DrawerTab = "OVERVIEW" | "ADS" | "DEMAND" | "PSYCHOLOGY";

const WORKER_PROGRESS_STAGES = [
  { key: "DISCOVERING_SOURCES", label: "Discovering Sources", minPct: 5 },
  { key: "COLLECTING_EVIDENCE", label: "Collecting Evidence", minPct: 20 },
  { key: "VERIFYING_IDENTITY", label: "Verifying Product Identity", minPct: 45 },
  { key: "CHECKING_DEMAND", label: "Checking Demand", minPct: 65 },
  { key: "RANKING_CANDIDATES", label: "Ranking Candidates", minPct: 82 },
  { key: "PREPARING_RESULTS", label: "Preparing Results", minPct: 95 },
];

function resolveWorkerStageIndex(stageRaw: string | undefined, pct: number): number {
  const s = (stageRaw || "").toUpperCase();
  if (s.includes("COMPLETED") || pct >= 95) return 5;
  if (s.includes("SCORING") || s.includes("RANK")) return 4;
  if (s.includes("DEMAND") || s.includes("TEMPORAL")) return 3;
  if (s.includes("CANDIDATE") || s.includes("IDENTITY") || s.includes("AI_DISCOVERY") || s.includes("ENRICH")) return 2;
  if (s.includes("META") || s.includes("GOOGLE") || s.includes("OBSERVATION") || s.includes("COLLECT")) return 1;
  return 0;
}

const QUICK_TOPICS = [
  "Pet Gadgets",
  "Dog",
  "Cat",
  "DIY",
  "Gardening",
  "Automatic Pet Feeder",
];

export default function ProductsPage() {
  const [viewMode, setViewMode] = useState<"EVERGREEN_RESEARCH" | "STORED_PRODUCTS">(
    "EVERGREEN_RESEARCH"
  );
  const [activeTab, setActiveTab] = useState<PrimaryTab>("RECOMMENDED");

  // Search Command Bar State
  const [topic, setTopic] = useState("Pet Gadgets");
  const [country, setCountry] = useState("US");
  const [lookbackDays, setLookbackDays] = useState<30 | 90 | 180 | 365>(180);
  const [sourceMode, setSourceMode] = useState<ResearchSourceMode>("LIVE_WITH_CACHE_FALLBACK");

  // Research Leaderboard & Run State
  const [leaderboard, setLeaderboard] = useState<EvergreenLeaderboardResponse | null>(null);
  const [activeRunId, setActiveRunId] = useState<string | null>(null);
  const [activeRunStatus, setActiveRunStatus] = useState<string | null>(null);
  const [activeRunCompletedAt, setActiveRunCompletedAt] = useState<string | null>(null);
  const [activeRunTopic, setActiveRunTopic] = useState<string | null>(null);
  const [activeJob, setActiveJob] = useState<ActiveJobProgress | null>(null);
  const [recentRuns, setRecentRuns] = useState<RecentRunHistoryItem[]>([]);

  // Source Status & Runtime Identity
  const [sourceSummary, setSourceSummary] = useState<SourceConnectionSummary | null>(null);
  const [testingSources, setTestingSources] = useState(false);
  const [discoveringSources, setDiscoveringSources] = useState(false);
  const [researchLoading, setResearchLoading] = useState(false);
  const [researchError, setResearchError] = useState<string | null>(null);
  const [runtimeIdentity, setRuntimeIdentity] = useState<{
    releaseVersion: string;
    gitCommitSha: string;
    shortCommitSha: string;
    workerStatus: {
      status: string;
      commitSha: string | null;
      releaseVersion: string | null;
      lastHeartbeatAt: string | null;
      heartbeatAgeMs: number | null;
    };
    versionParity: {
      frontendReleaseVersion: string;
      backendReleaseVersion: string;
      workerReleaseVersion: string | null;
      frontendCommitSha: string;
      backendCommitSha: string;
      workerCommitSha: string | null;
      allConsistent: boolean;
      mismatchWarning: string | null;
    };
  } | null>(null);

  // All Candidates Explorer Filters
  const [candidateFilter, setCandidateFilter] = useState<"ALL" | ExplorerCandidateStatus>("ALL");
  const [candidateSearch, setCandidateSearch] = useState("");
  const [selectedFamily, setSelectedFamily] = useState<string>("ALL");

  // Drawers & Modals
  const [drawerCandidate, setDrawerCandidate] = useState<{
    candidate: any;
    rankedItem: RankedProductCandidate | null;
    canonicalCard?: CanonicalRecommendedProduct | null;
  } | null>(null);
  const [drawerTab, setDrawerTab] = useState<DrawerTab>("OVERVIEW");
  const [drawerOverviewData, setDrawerOverviewData] = useState<any | null>(null);
  const [drawerLoading, setDrawerLoading] = useState(false);

  const [historyDrawerOpen, setHistoryDrawerOpen] = useState(false);
  const [activeMediaItem, setActiveMediaItem] = useState<{
    title: string;
    videoUrl?: string | null;
    thumbnailUrl?: string | null;
    sourceUrl?: string | null;
    platform?: string;
  } | null>(null);

  // Stored Catalog State
  const [storedProducts, setStoredProducts] = useState<StoredProductItem[]>([]);
  const [storedLoading, setStoredLoading] = useState(false);
  const [storedSearch, setStoredSearch] = useState("");
  const [storedCategory, setStoredCategory] = useState("ALL");

  const pollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const frontendBuildSha =
    process.env.NEXT_PUBLIC_SWAI_GIT_SHA ||
    runtimeIdentity?.shortCommitSha ||
    "unknown";
  const frontendReleaseVersion =
    process.env.NEXT_PUBLIC_SWAI_RELEASE_VERSION ||
    runtimeIdentity?.releaseVersion ||
    "12.4.3.2";

  const fetchRuntimeVersion = useCallback(async () => {
    try {
      const res = await fetch(
        `/api/v1/kh02/version?frontendSha=${encodeURIComponent(
          frontendBuildSha
        )}&frontendVersion=${encodeURIComponent(frontendReleaseVersion)}`
      );
      const json = await res.json();
      if (json.success && json.data) {
        setRuntimeIdentity(json.data);
      }
    } catch (err) {
      console.error("[ProductsPage] Failed to fetch runtime version:", err);
    }
  }, [frontendBuildSha, frontendReleaseVersion]);

  const fetchSourceStatuses = useCallback(async () => {
    try {
      const res = await fetch("/api/v1/kh02/sources/status");
      const json = await res.json();
      if (json.success) {
        setSourceSummary(json.data);
      }
    } catch (err) {
      console.error("[ProductsPage] Failed to load source statuses:", err);
    }
  }, []);

  const handleTestSources = async () => {
    setTestingSources(true);
    try {
      const res = await fetch("/api/v1/kh02/sources/test", { method: "POST" });
      const json = await res.json();
      if (json.success) {
        setSourceSummary(json.data);
      }
    } catch (err) {
      console.error("[ProductsPage] Source test failed:", err);
    } finally {
      setTestingSources(false);
    }
  };

  const handleDiscoverSources = async () => {
    setDiscoveringSources(true);
    try {
      const res = await fetch("/api/v1/kh02/sources/discover", { method: "POST" });
      const json = await res.json();
      if (json.success && json.data?.statusSummary) {
        setSourceSummary(json.data.statusSummary);
      }
    } catch (err) {
      console.error("[ProductsPage] Source auto-discovery failed:", err);
    } finally {
      setDiscoveringSources(false);
    }
  };

  const loadPersistedRun = useCallback(
    async (opts?: { runId?: string; topic?: string; lookback?: number; syncTopicInput?: boolean }) => {
      try {
        const params = new URLSearchParams();
        if (opts?.runId) params.set("runId", opts.runId);
        if (opts?.topic) params.set("topic", opts.topic);
        if (opts?.lookback) params.set("lookback", String(opts.lookback));

        const res = await fetch(`/api/v1/kh02/research?${params.toString()}`);
        const json = await res.json();
        if (json.success && json.data) {
          if (json.data.recentRuns) {
            setRecentRuns(json.data.recentRuns);
          }
          if (json.data.leaderboard) {
            setLeaderboard(json.data.leaderboard);
            setActiveRunId(json.data.runId || null);
            setActiveRunStatus(json.data.status || "COMPLETED");
            setActiveRunCompletedAt(json.data.completedAt || null);
            setActiveRunTopic(json.data.topic || json.data.leaderboard.topic || null);
            if (opts?.syncTopicInput && json.data.topic) {
              setTopic(json.data.topic);
            }
          }
          if (json.data.activeJob) {
            const job = json.data.activeJob as ActiveJobProgress;
            setActiveJob(job);
            if (job.status === "QUEUED" || job.status === "RUNNING") {
              setResearchLoading(true);
            } else {
              setResearchLoading(false);
            }
          } else {
            setActiveJob(null);
            setResearchLoading(false);
          }
          return json.data;
        }
      } catch (err) {
        console.error("[ProductsPage] Failed to load persisted run:", err);
      }
      return null;
    },
    []
  );

  useEffect(() => {
    if (
      !activeJob ||
      (activeJob.status !== "QUEUED" && activeJob.status !== "RUNNING")
    ) {
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current);
        pollIntervalRef.current = null;
      }
      return;
    }

    pollIntervalRef.current = setInterval(async () => {
      const data = await loadPersistedRun({ runId: activeJob.runId });
      if (
        data &&
        data.activeJob &&
        data.activeJob.status !== "QUEUED" &&
        data.activeJob.status !== "RUNNING"
      ) {
        setResearchLoading(false);
        fetchSourceStatuses();
      }
    }, 2000);

    return () => {
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current);
        pollIntervalRef.current = null;
      }
    };
  }, [activeJob, loadPersistedRun, fetchSourceStatuses]);

  const handleRunEvergreenResearch = useCallback(
    async (
      overrideTopic?: string,
      overrideLookback?: 30 | 90 | 180 | 365,
      overrideSourceMode?: ResearchSourceMode
    ) => {
      const targetTopic = (overrideTopic ?? topic).trim();
      const targetLookback = overrideLookback ?? lookbackDays;
      const targetSourceMode = overrideSourceMode ?? sourceMode;
      if (!targetTopic || targetTopic.length < 2) {
        setResearchError("Please enter a research topic (at least 2 characters).");
        return;
      }

      setResearchLoading(true);
      setResearchError(null);

      try {
        const res = await fetch("/api/v1/kh02/research", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            topic: targetTopic,
            country,
            lookbackDays: targetLookback,
            sourceMode: targetSourceMode,
            asyncMode: true,
          }),
        });
        const json = await res.json();
        if (!json.success) {
          setResearchError(json.error?.message || "Failed to enqueue research job");
          setResearchLoading(false);
        } else if (json.data) {
          if (json.data.leaderboard) {
            setLeaderboard(json.data.leaderboard);
            setActiveRunId(json.data.runId || null);
            setActiveRunStatus(json.data.status || "COMPLETED");
            setActiveRunCompletedAt(json.data.completedAt || new Date().toISOString());
            setActiveRunTopic(targetTopic);
            setActiveJob(null);
            setResearchLoading(false);
            loadPersistedRun({ runId: json.data.runId });
          } else {
            setActiveRunId(json.data.runId);
            setActiveRunStatus(json.data.status || "QUEUED");
            setActiveJob({
              jobId: json.data.jobId,
              runId: json.data.runId,
              status: json.data.status || "QUEUED",
              stage: json.data.stage || "QUEUED",
              progressPct: json.data.progressPct ?? 5,
            });
          }
          fetchSourceStatuses();
        }
      } catch (err: any) {
        setResearchError(err?.message || "Unexpected network error");
        setResearchLoading(false);
      }
    },
    [topic, country, lookbackDays, sourceMode, fetchSourceStatuses, loadPersistedRun]
  );

  const fetchStoredProducts = useCallback(async () => {
    setStoredLoading(true);
    try {
      const params = new URLSearchParams();
      if (storedSearch) params.set("search", storedSearch);
      if (storedCategory !== "ALL") params.set("category", storedCategory);

      const res = await fetch(`/api/v1/products?${params.toString()}`);
      const json = await res.json();
      if (json.success) {
        setStoredProducts(json.data);
      }
    } catch (err) {
      console.error("[ProductsPage] Stored products fetch failed:", err);
    } finally {
      setStoredLoading(false);
    }
  }, [storedSearch, storedCategory]);

  // Initial load + URL query restoration
  useEffect(() => {
    fetchRuntimeVersion();
    fetchSourceStatuses();

    if (typeof window !== "undefined") {
      const sp = new URLSearchParams(window.location.search);
      const urlRunId = sp.get("runId") || undefined;
      const urlTopic = sp.get("topic") || undefined;
      const urlLookback = sp.get("lookback") ? Number(sp.get("lookback")) : undefined;
      const urlSourceMode = sp.get("sourceMode") as ResearchSourceMode | null;
      const urlTab = sp.get("tab") as PrimaryTab | null;

      if (urlTopic) setTopic(urlTopic);
      if (urlLookback === 30 || urlLookback === 90 || urlLookback === 180 || urlLookback === 365) {
        setLookbackDays(urlLookback);
      }
      if (
        urlSourceMode === "LIVE_WITH_CACHE_FALLBACK" ||
        urlSourceMode === "CACHE_ONLY" ||
        urlSourceMode === "LIVE_ONLY"
      ) {
        setSourceMode(urlSourceMode);
      }
      if (
        urlTab === "RECOMMENDED" ||
        urlTab === "ALL_CANDIDATES" ||
        urlTab === "EVIDENCE_DIAGNOSTICS"
      ) {
        setActiveTab(urlTab);
      }

      loadPersistedRun({
        runId: urlRunId,
        topic: urlRunId ? undefined : urlTopic,
        lookback: urlLookback,
        syncTopicInput: true,
      });
    } else {
      loadPersistedRun({ syncTopicInput: true });
    }
  }, [fetchRuntimeVersion, fetchSourceStatuses, loadPersistedRun]);

  useEffect(() => {
    if (viewMode === "STORED_PRODUCTS") {
      fetchStoredProducts();
    }
  }, [viewMode, fetchStoredProducts]);

  // Keyboard Escape handler to close slide-over drawers and modals
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setDrawerCandidate(null);
        setHistoryDrawerOpen(false);
        setActiveMediaItem(null);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  // Open Candidate Research Detail Drawer and fetch optional overview data
  const openCandidateResearchDrawer = useCallback(
    async (
      candidate: any,
      rankedItem: RankedProductCandidate | null,
      canonicalCard?: CanonicalRecommendedProduct | null,
      initialTab: DrawerTab = "OVERVIEW"
    ) => {
      setDrawerCandidate({ candidate, rankedItem, canonicalCard });
      setDrawerTab(initialTab);
      setDrawerOverviewData(null);

      const pid = candidate.researchProductId || candidate.candidateId;
      if (!pid) return;
      setDrawerLoading(true);
      try {
        const params = new URLSearchParams();
        if (activeRunId) params.set("runId", activeRunId);
        if (candidate.candidateId) params.set("candidateId", candidate.candidateId);
        const res = await fetch(
          `/api/v1/research/products/${encodeURIComponent(pid)}/overview?${params.toString()}`
        );
        const json = await res.json();
        if (json.success && json.data) {
          setDrawerOverviewData(json.data);
        }
      } catch {
        // Drawer still renders full candidate evidence from leaderboard
      } finally {
        setDrawerLoading(false);
      }
    },
    [activeRunId]
  );

  // Derived View Models
  const canonicalRecommended = useMemo(
    () => buildCanonicalRecommendedProducts(leaderboard),
    [leaderboard]
  );

  const allExplorerCandidates = useMemo(
    () => buildAllCandidatesExplorerList(leaderboard),
    [leaderboard]
  );

  const distinctFamilies = useMemo(() => {
    const map = new Map<string, string>();
    for (const row of allExplorerCandidates) {
      if (row.familyKey && row.familyLabel) {
        map.set(row.familyKey, row.familyLabel);
      }
    }
    return Array.from(map.entries());
  }, [allExplorerCandidates]);

  const filteredExplorerCandidates = useMemo(() => {
    return allExplorerCandidates.filter((row) => {
      if (candidateFilter !== "ALL" && row.explorerStatus !== candidateFilter) {
        return false;
      }
      if (selectedFamily !== "ALL" && row.familyKey !== selectedFamily) {
        return false;
      }
      if (candidateSearch.trim()) {
        const q = candidateSearch.trim().toLowerCase();
        const hay = `${row.title} ${row.storeDomain || ""} ${row.familyLabel} ${row.audienceBadgeLabel}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [allExplorerCandidates, candidateFilter, selectedFamily, candidateSearch]);

  const explorerCounts = useMemo(() => {
    const counts = {
      ALL: allExplorerCandidates.length,
      RESEARCH_QUALIFIED: 0,
      PROVISIONAL: 0,
      NEEDS_VERIFICATION: 0,
      EXCLUDED: 0,
    };
    for (const row of allExplorerCandidates) {
      counts[row.explorerStatus] = (counts[row.explorerStatus] || 0) + 1;
    }
    return counts;
  }, [allExplorerCandidates]);

  // 4-Metric Status Summary Computed Values
  const shortlistQualifiedCount = leaderboard?.researchShortlist?.qualifiedCount ?? 0;
  const shortlistRequestedCount = leaderboard?.researchShortlist?.requestedCount ?? 3;
  const evergreenWinnerCount = leaderboard?.topThree?.length ?? 0;
  const metaFreshLiveAds = leaderboard?.sourceCoverage?.META_ADS?.freshLiveAdsCount ?? 0;
  const metaHistoricalAds = leaderboard?.sourceCoverage?.META_ADS?.historicalCachedAdsCount ?? 0;
  const googleFreshLiveAds =
    leaderboard?.sourceCoverage?.GOOGLE_ADS_TRANSPARENCY?.freshLiveAdsCount ?? 0;
  const googleHistoricalAds =
    leaderboard?.sourceCoverage?.GOOGLE_ADS_TRANSPARENCY?.historicalCachedAdsCount ?? 0;
  const totalLiveAds = metaFreshLiveAds + googleFreshLiveAds;
  const totalHistoricalAds = metaHistoricalAds + googleHistoricalAds;

  const sourceCoverageHeadline = useMemo(() => {
    const metaPart =
      metaFreshLiveAds > 0
        ? "Meta Live"
        : metaHistoricalAds > 0
        ? "Meta Cache"
        : "Meta Idle";
    const googlePart =
      googleFreshLiveAds > 0
        ? "Google Live"
        : googleHistoricalAds > 0
        ? "Google Cache"
        : "Google Ready";
    return `${metaPart} · ${googlePart}`;
  }, [metaFreshLiveAds, metaHistoricalAds, googleFreshLiveAds, googleHistoricalAds]);

  const buildCommercialAssessmentUrl = useCallback(
    (productIdOrCandidateId: string, candidateId: string) => {
      const params = new URLSearchParams();
      if (activeRunId) params.set("runId", activeRunId);
      if (candidateId) params.set("candidateId", candidateId);
      if (leaderboard?.topic || topic) params.set("topic", leaderboard?.topic || topic);
      params.set("lookbackDays", String(leaderboard?.lookbackDays || lookbackDays));
      params.set("sourceMode", leaderboard?.sourceMode || sourceMode);
      return `/products/${encodeURIComponent(
        productIdOrCandidateId
      )}/intelligence?${params.toString()}`;
    },
    [activeRunId, leaderboard, topic, lookbackDays, sourceMode]
  );

  const activeStageIndex = activeJob
    ? resolveWorkerStageIndex(activeJob.stage, activeJob.progressPct)
    : -1;

  return (
    <div className="min-h-screen bg-[#0b0f17] text-slate-100 pb-20 overflow-x-hidden">
      {/* =====================================================================
          SECTION 1: CLEAN PRODUCT FINDER HEADER
         ===================================================================== */}
      <header
        data-testid="pf-header"
        className="border-b border-slate-800/80 bg-[#0f1523]/95 backdrop-blur-md sticky top-0 z-30"
      >
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-3.5 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <div className="h-9 w-9 rounded-xl bg-indigo-600/20 border border-indigo-500/30 flex items-center justify-center shrink-0">
              <ShoppingBag className="h-4.5 w-4.5 text-indigo-400" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2.5 flex-wrap">
                <h1 className="text-lg sm:text-xl font-bold text-white tracking-tight">
                  Product Finder
                </h1>
                <span className="text-[11px] font-medium px-2 py-0.5 rounded-md bg-slate-800/90 text-slate-300 border border-slate-700/70">
                  US Market
                </span>
              </div>
              <p className="text-xs text-slate-400 truncate">
                Discover products backed by market evidence.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            {/* Runtime Version & Parity Pill */}
            <button
              type="button"
              onClick={() => setActiveTab("EVIDENCE_DIAGNOSTICS")}
              data-testid="kh02-runtime-version-badge"
              data-release-version={runtimeIdentity?.releaseVersion || frontendReleaseVersion}
              data-frontend-sha={
                runtimeIdentity?.versionParity?.frontendCommitSha || frontendBuildSha
              }
              data-backend-sha={
                runtimeIdentity?.versionParity?.backendCommitSha ||
                runtimeIdentity?.shortCommitSha ||
                "unknown"
              }
              data-worker-sha={
                runtimeIdentity?.versionParity?.workerCommitSha ||
                runtimeIdentity?.workerStatus?.commitSha ||
                "none"
              }
              className="text-[11px] font-mono px-2.5 py-1 rounded-lg bg-slate-900 hover:bg-slate-800 text-slate-300 border border-slate-800 flex items-center gap-1.5 transition-colors"
              title="Click to inspect runtime parity and diagnostics"
            >
              <span>v{runtimeIdentity?.releaseVersion || frontendReleaseVersion}</span>
              <span className="text-slate-600">·</span>
              <span
                data-testid="kh02-runtime-parity-badge"
                data-runtime-status={
                  runtimeIdentity?.versionParity?.allConsistent
                    ? "CONSISTENT"
                    : "MISMATCH_OR_STALE"
                }
                className={`inline-flex items-center gap-1 ${
                  runtimeIdentity?.versionParity?.allConsistent
                    ? "text-emerald-400"
                    : "text-amber-400"
                }`}
              >
                <span
                  className={`h-1.5 w-1.5 rounded-full ${
                    runtimeIdentity?.versionParity?.allConsistent
                      ? "bg-emerald-400"
                      : "bg-amber-400"
                  }`}
                />
                {runtimeIdentity?.versionParity?.allConsistent ? "Synced" : "Check Worker"}
              </span>
            </button>

            {/* Research History Drawer Trigger */}
            <button
              type="button"
              data-testid="pf-history-trigger"
              onClick={() => setHistoryDrawerOpen(true)}
              className="px-3 py-1.5 rounded-lg text-xs font-medium bg-slate-900 hover:bg-slate-800 text-slate-200 border border-slate-800 flex items-center gap-1.5 transition-colors"
            >
              <History className="h-3.5 w-3.5 text-slate-400" />
              <span>Research History</span>
              {recentRuns.length > 0 && (
                <span className="px-1.5 py-0.2 rounded bg-slate-800 text-slate-300 font-mono text-[10px]">
                  {recentRuns.length}
                </span>
              )}
            </button>

            {/* Workspace Mode Switcher */}
            <div className="flex items-center bg-slate-900 p-0.5 rounded-lg border border-slate-800">
              <button
                type="button"
                onClick={() => setViewMode("EVERGREEN_RESEARCH")}
                className={`px-2.5 py-1 rounded-md text-xs font-medium transition-all ${
                  viewMode === "EVERGREEN_RESEARCH"
                    ? "bg-indigo-600 text-white shadow-xs"
                    : "text-slate-400 hover:text-white"
                }`}
              >
                Market Research
              </button>
              <button
                type="button"
                onClick={() => setViewMode("STORED_PRODUCTS")}
                className={`px-2.5 py-1 rounded-md text-xs font-medium transition-all ${
                  viewMode === "STORED_PRODUCTS"
                    ? "bg-indigo-600 text-white shadow-xs"
                    : "text-slate-400 hover:text-white"
                }`}
              >
                Catalog ({storedProducts.length || "SKUs"})
              </button>
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-6 space-y-6">
        {viewMode === "EVERGREEN_RESEARCH" && (
          <>
            {/* =====================================================================
                SECTION 2: UNIFIED RESEARCH COMMAND BAR
               ===================================================================== */}
            <section
              data-testid="pf-command-bar"
              className="rounded-2xl bg-[#111827] border border-slate-800/90 p-4 sm:p-5 shadow-lg space-y-3.5"
            >
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-3 items-center">
                {/* Search Input */}
                <div className="lg:col-span-5 relative">
                  <Search className="h-4 w-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                  <input
                    data-testid="kh02-research-input"
                    type="text"
                    value={topic}
                    onChange={(e) => setTopic(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && handleRunEvergreenResearch()}
                    placeholder="Search a niche or product (e.g., dog, cat, cordless glue gun)..."
                    className="w-full pl-10 pr-4 py-2.5 rounded-xl bg-[#0b0f17] border border-slate-700/80 text-white placeholder-slate-500 text-sm focus:outline-none focus:border-indigo-500 transition-colors"
                  />
                </div>

                {/* Market + Lookback Window */}
                <div className="lg:col-span-3 flex items-center gap-2">
                  <select
                    aria-label="Target Market"
                    value={country}
                    onChange={(e) => setCountry(e.target.value)}
                    className="px-2.5 py-2.5 rounded-xl bg-[#0b0f17] border border-slate-700/80 text-xs font-medium text-slate-200 focus:outline-none focus:border-indigo-500"
                  >
                    <option value="US">US</option>
                  </select>

                  <div className="flex-1 flex items-center bg-[#0b0f17] p-1 rounded-xl border border-slate-700/80">
                    {([30, 90, 180, 365] as const).map((days) => (
                      <button
                        key={days}
                        type="button"
                        data-testid={`kh02-lookback-${days}`}
                        onClick={() => setLookbackDays(days)}
                        className={`flex-1 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                          lookbackDays === days
                            ? "bg-indigo-600 text-white shadow-xs"
                            : "text-slate-400 hover:text-white"
                        }`}
                      >
                        {days}D
                      </button>
                    ))}
                  </div>
                </div>

                {/* Source Mode Selector */}
                <div className="lg:col-span-2">
                  <select
                    aria-label="Research Source Mode"
                    data-testid="kh02-source-mode-select"
                    value={sourceMode}
                    onChange={(e) => setSourceMode(e.target.value as ResearchSourceMode)}
                    className="w-full px-3 py-2.5 rounded-xl bg-[#0b0f17] border border-slate-700/80 text-xs font-medium text-slate-200 focus:outline-none focus:border-indigo-500"
                  >
                    <option value="LIVE_WITH_CACHE_FALLBACK">Live + Cache</option>
                    <option value="CACHE_ONLY">Cache Only</option>
                    <option value="LIVE_ONLY">Live Only</option>
                  </select>
                </div>

                {/* Primary CTA Button */}
                <div className="lg:col-span-2">
                  <button
                    type="button"
                    data-testid="kh02-analyze-button"
                    onClick={() => handleRunEvergreenResearch()}
                    disabled={researchLoading || !topic.trim()}
                    className="w-full py-2.5 px-4 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white font-semibold text-xs sm:text-sm flex items-center justify-center gap-2 shadow-sm transition-all cursor-pointer"
                  >
                    {researchLoading ? (
                      <>
                        <Loader2 className="h-4 w-4 animate-spin" />
                        <span>Analyzing...</span>
                      </>
                    ) : (
                      <>
                        <Sparkles className="h-4 w-4" />
                        <span>Analyze Products</span>
                      </>
                    )}
                  </button>
                </div>
              </div>

              {/* Quick Topic Pills & Active Run Context */}
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pt-1 border-t border-slate-800/70 text-xs">
                <div className="flex items-center gap-1.5 flex-wrap">
                  <span className="text-[11px] text-slate-500 font-medium mr-1">
                    Quick searches:
                  </span>
                  {QUICK_TOPICS.map((preset) => (
                    <button
                      key={preset}
                      type="button"
                      onClick={() => {
                        setTopic(preset);
                        handleRunEvergreenResearch(preset, lookbackDays, sourceMode);
                      }}
                      className={`px-2.5 py-1 rounded-lg text-[11px] font-medium transition-colors ${
                        (leaderboard?.topic || topic).toLowerCase() === preset.toLowerCase()
                          ? "bg-indigo-500/20 text-indigo-300 border border-indigo-500/40"
                          : "bg-slate-900 hover:bg-slate-800 text-slate-400 border border-slate-800"
                      }`}
                    >
                      {preset}
                    </button>
                  ))}
                </div>

                {activeRunId && leaderboard && (
                  <div
                    data-testid="kh02-last-completed-research-banner"
                    className="flex items-center gap-2 text-[11px] text-slate-400"
                  >
                    <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400 shrink-0" />
                    <span
                      data-testid="kh02-authoritative-run-meta"
                      data-research-run-id={activeRunId}
                    >
                      Showing <strong className="text-slate-200">{leaderboard.topic}</strong> ·{" "}
                      {leaderboard.lookbackDays}D ·{" "}
                      {leaderboard.sourceMode === "LIVE_ONLY"
                        ? "Live Only"
                        : leaderboard.sourceMode === "CACHE_ONLY"
                        ? "Cache Only"
                        : "Live + Cache"}{" "}
                      · Run <span className="font-mono">{activeRunId.slice(0, 10)}</span>
                    </span>
                  </div>
                )}
              </div>

              {/* 6-Stage Real Worker Progress Indicator */}
              {activeJob &&
                (activeJob.status === "QUEUED" || activeJob.status === "RUNNING") && (
                  <div
                    data-testid="kh02-research-progress-panel"
                    className="pt-3 border-t border-slate-800 space-y-2.5"
                  >
                    <div className="flex items-center justify-between text-xs">
                      <div className="flex items-center gap-2 text-indigo-300 font-medium">
                        <Loader2 className="h-3.5 w-3.5 animate-spin text-indigo-400" />
                        <span>
                          {WORKER_PROGRESS_STAGES[activeStageIndex]?.label ||
                            "Running product research..."}
                        </span>
                      </div>
                      <span className="font-mono text-xs text-slate-300">
                        {activeJob.progressPct}%
                      </span>
                    </div>
                    <div className="grid grid-cols-2 sm:grid-cols-6 gap-1.5">
                      {WORKER_PROGRESS_STAGES.map((stage, idx) => {
                        const isDone = idx < activeStageIndex;
                        const isCurrent = idx === activeStageIndex;
                        return (
                          <div
                            key={stage.key}
                            className={`px-2.5 py-1.5 rounded-lg border text-[11px] font-medium flex items-center gap-1.5 ${
                              isDone
                                ? "bg-emerald-950/40 border-emerald-700/40 text-emerald-300"
                                : isCurrent
                                ? "bg-indigo-950/60 border-indigo-500/60 text-white"
                                : "bg-slate-900/60 border-slate-800 text-slate-500"
                            }`}
                          >
                            <span
                              className={`h-1.5 w-1.5 rounded-full shrink-0 ${
                                isDone
                                  ? "bg-emerald-400"
                                  : isCurrent
                                  ? "bg-indigo-400 animate-pulse"
                                  : "bg-slate-700"
                              }`}
                            />
                            <span className="truncate">{stage.label}</span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

              {researchError && (
                <div className="p-3 rounded-xl bg-rose-950/40 border border-rose-800/50 text-xs text-rose-200 flex items-center gap-2">
                  <AlertCircle className="h-4 w-4 text-rose-400 shrink-0" />
                  <span>{researchError}</span>
                </div>
              )}
            </section>

            {/* =====================================================================
                SECTION 3: 4-METRIC RESEARCH STATUS SUMMARY
               ===================================================================== */}
            <section
              data-testid="pf-status-summary"
              className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3.5"
            >
              {/* Metric 1: Research Shortlist */}
              <div className="p-4 rounded-xl bg-[#111827] border border-slate-800/90 flex flex-col justify-between">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium text-slate-400">
                    Research Shortlist
                  </span>
                  <Sparkles className="h-4 w-4 text-amber-400" />
                </div>
                <div className="mt-2 flex items-baseline gap-2">
                  <span className="text-2xl font-bold text-white font-mono">
                    {shortlistQualifiedCount} / {shortlistRequestedCount}
                  </span>
                  <span className="text-xs font-medium text-amber-300">Products</span>
                </div>
                <p className="text-[11px] text-slate-400 mt-1">
                  Merchant-verified physical products matching your search
                </p>
              </div>

              {/* Metric 2: Verified Evergreen */}
              <div className="p-4 rounded-xl bg-[#111827] border border-slate-800/90 flex flex-col justify-between">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium text-slate-400">
                    Verified Evergreen
                  </span>
                  <Award className="h-4 w-4 text-emerald-400" />
                </div>
                <div className="mt-2 flex items-baseline gap-2">
                  <span className="text-2xl font-bold text-white font-mono">
                    {evergreenWinnerCount} / 3
                  </span>
                  <span className="text-xs font-medium text-emerald-400">Winners</span>
                </div>
                <p className="text-[11px] text-slate-400 mt-1">
                  {evergreenWinnerCount > 0
                    ? "Backed by verified multi-month demand stability"
                    : "Requires 6+ months of verified demand history"}
                </p>
              </div>

              {/* Metric 3: Source Coverage */}
              <div className="p-4 rounded-xl bg-[#111827] border border-slate-800/90 flex flex-col justify-between">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium text-slate-400">
                    Source Coverage
                  </span>
                  <Database className="h-4 w-4 text-indigo-400" />
                </div>
                <div className="mt-2">
                  <span
                    data-testid="kh02-badge-source-freshness"
                    className="text-base font-bold text-white block truncate"
                  >
                    {sourceCoverageHeadline}
                  </span>
                </div>
                <p className="text-[11px] text-slate-400 mt-1 font-mono">
                  {totalLiveAds} live ads · {totalHistoricalAds} cached records
                </p>
              </div>

              {/* Metric 4: Research Freshness */}
              <div className="p-4 rounded-xl bg-[#111827] border border-slate-800/90 flex flex-col justify-between">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium text-slate-400">
                    Research Freshness
                  </span>
                  <Clock className="h-4 w-4 text-slate-400" />
                </div>
                <div className="mt-2 flex items-baseline gap-2">
                  <span className="text-base font-bold text-white">
                    {formatRelativeAge(activeRunCompletedAt || leaderboard?.generatedAt)}
                  </span>
                  <span className="text-[11px] px-1.5 py-0.5 rounded bg-slate-800 text-slate-300 font-mono">
                    {leaderboard?.lookbackDays || lookbackDays}D
                  </span>
                </div>
                <p className="text-[11px] text-slate-400 mt-1 truncate">
                  {leaderboard?.topic ? `Topic: "${leaderboard.topic}"` : "Ready to analyze"}
                </p>
              </div>
            </section>

            {/* =====================================================================
                SECTION 4: SEGMENTED RESULT NAVIGATION TABS
               ===================================================================== */}
            <div
              data-testid="pf-tabs"
              className="flex items-center justify-between border-b border-slate-800 gap-2 overflow-x-auto"
            >
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  data-testid="pf-tab-recommended"
                  onClick={() => setActiveTab("RECOMMENDED")}
                  className={`px-4 py-2.5 text-xs sm:text-sm font-semibold border-b-2 transition-colors flex items-center gap-2 whitespace-nowrap ${
                    activeTab === "RECOMMENDED"
                      ? "border-indigo-500 text-white"
                      : "border-transparent text-slate-400 hover:text-slate-200"
                  }`}
                >
                  <Sparkles className="h-4 w-4 text-indigo-400" />
                  <span>Recommended</span>
                  <span className="px-1.5 py-0.5 rounded-full bg-slate-800 text-slate-300 text-[11px] font-mono">
                    {canonicalRecommended.length}
                  </span>
                </button>

                <button
                  type="button"
                  data-testid="pf-tab-all-candidates"
                  onClick={() => setActiveTab("ALL_CANDIDATES")}
                  className={`px-4 py-2.5 text-xs sm:text-sm font-semibold border-b-2 transition-colors flex items-center gap-2 whitespace-nowrap ${
                    activeTab === "ALL_CANDIDATES"
                      ? "border-indigo-500 text-white"
                      : "border-transparent text-slate-400 hover:text-slate-200"
                  }`}
                >
                  <Layers className="h-4 w-4 text-slate-400" />
                  <span>All Candidates</span>
                  <span className="px-1.5 py-0.5 rounded-full bg-slate-800 text-slate-300 text-[11px] font-mono">
                    {allExplorerCandidates.length}
                  </span>
                </button>

                <button
                  type="button"
                  data-testid="pf-tab-evidence-diagnostics"
                  onClick={() => setActiveTab("EVIDENCE_DIAGNOSTICS")}
                  className={`px-4 py-2.5 text-xs sm:text-sm font-semibold border-b-2 transition-colors flex items-center gap-2 whitespace-nowrap ${
                    activeTab === "EVIDENCE_DIAGNOSTICS"
                      ? "border-indigo-500 text-white"
                      : "border-transparent text-slate-400 hover:text-slate-200"
                  }`}
                >
                  <Activity className="h-4 w-4 text-slate-400" />
                  <span>Evidence & Diagnostics</span>
                </button>
              </div>
            </div>

            {/* =====================================================================
                TAB 1: RECOMMENDED (CANONICAL SINGLE-CARD PRODUCT DECISION VIEW)
               ===================================================================== */}
            {activeTab === "RECOMMENDED" && (
              <section
                data-testid="kh02-leaderboard-container"
                className="space-y-4"
              >
                {/* Calm Informative Banner when Evergreen Winners == 0 */}
                {leaderboard && evergreenWinnerCount === 0 && (
                  <div
                    data-testid="kh02-empty-state"
                    className="p-4 rounded-xl bg-slate-900/90 border border-slate-800 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                  >
                    <div className="flex items-start gap-3">
                      <Info className="h-4 w-4 text-amber-400 shrink-0 mt-0.5" />
                      <div className="space-y-0.5">
                        <h2
                          data-testid="kh02-snapshot-topic-heading"
                          className="text-xs sm:text-sm font-semibold text-white"
                        >
                          0 Verified Evergreen Winners for &ldquo;
                          {leaderboard?.topic || activeRunTopic || topic}&rdquo; — Showing Top
                          Research-Qualified Products
                        </h2>
                        <p className="text-xs text-slate-400 leading-relaxed">
                          Evergreen qualification requires 6–12 months of verified non-declining
                          demand history. Review the merchant-verified products below or inspect
                          their commercial readiness before launching.
                        </p>
                      </div>
                    </div>
                    {leaderboard.researchShortlist?.shortfallReason && (
                      <span
                        data-testid="kh02-shortlist-shortfall-notice"
                        className="text-[11px] px-2.5 py-1 rounded-lg bg-amber-950/40 border border-amber-700/40 text-amber-200 shrink-0"
                      >
                        {leaderboard.researchShortlist.shortfallReason}
                      </span>
                    )}
                  </div>
                )}

                {/* Canonical Recommended Product Cards (Strictly 1 Card Per Product) */}
                {canonicalRecommended.length > 0 ? (
                  <div
                    data-testid="kh02-research-shortlist-section"
                    className="grid grid-cols-1 lg:grid-cols-3 gap-4"
                  >
                    {canonicalRecommended.map((item) => (
                      <article
                        key={item.candidateId}
                        data-testid="pf-canonical-product-card"
                        data-candidate-id={item.candidateId}
                        data-product-key={item.productKey}
                        data-qualification-tier={item.qualificationTier}
                        data-opportunity-score={item.opportunityScore ?? 0}
                        data-rank={item.rank}
                        data-confidence={item.evidenceConfidence}
                        data-confidence-status={item.scoreStatusCode}
                        data-identity-status={item.rawCandidate.identityStatus || "PROBABLE"}
                        data-reality-status={
                          item.rawCandidate.productRealityStatus ||
                          "EVIDENCE_SUPPORTED_PHYSICAL_PRODUCT"
                        }
                        data-family-key={item.familyKey}
                        className="rounded-2xl bg-[#111827] border border-slate-800 hover:border-slate-700 transition-all p-5 flex flex-col justify-between space-y-4 shadow-sm"
                      >
                        <div className="space-y-4">
                          {/* Top Row: Rank + Qualification Badge */}
                          <div className="flex items-center justify-between gap-2">
                            <span className="px-2 py-0.5 rounded-md bg-slate-800 text-slate-200 font-mono text-xs font-bold">
                              #{item.rank}
                            </span>
                            <span
                              data-testid="kh02-badge-evergreen-status"
                              className={`text-[11px] font-semibold px-2.5 py-0.5 rounded-full border ${
                                item.qualificationTone === "emerald"
                                  ? "bg-emerald-950/60 text-emerald-300 border-emerald-700/50"
                                  : item.qualificationTone === "amber"
                                  ? "bg-amber-950/60 text-amber-300 border-amber-700/50"
                                  : "bg-slate-800 text-slate-300 border-slate-700"
                              }`}
                            >
                              {item.qualificationBadgeLabel}
                            </span>
                          </div>

                          {/* Product Identity Header */}
                          <div className="flex items-start gap-3.5">
                            <div
                              onClick={() => {
                                if (item.videoUrl || item.thumbnailUrl) {
                                  setActiveMediaItem({
                                    title: item.title,
                                    videoUrl: item.videoUrl,
                                    thumbnailUrl: item.thumbnailUrl,
                                    sourceUrl: item.canonicalProductUrl,
                                    platform: item.supportingSources[0] || "Meta Ads",
                                  });
                                }
                              }}
                              className="relative w-16 h-16 rounded-xl overflow-hidden bg-slate-950 border border-slate-800 shrink-0 cursor-pointer flex items-center justify-center"
                            >
                              {item.thumbnailUrl && !isStockImage(item.thumbnailUrl) ? (
                                <img
                                  src={item.thumbnailUrl}
                                  alt={item.title}
                                  className="w-full h-full object-cover"
                                />
                              ) : (
                                <ShoppingBag className="h-6 w-6 text-slate-500" />
                              )}
                              {item.videoUrl && (
                                <div className="absolute inset-0 bg-black/40 flex items-center justify-center">
                                  <Play className="h-4 w-4 text-white fill-white" />
                                </div>
                              )}
                            </div>

                            <div className="min-w-0 flex-1 space-y-1">
                              <h3 className="text-sm font-bold text-white leading-snug line-clamp-2">
                                {item.title}
                              </h3>
                              <div className="flex items-center gap-1.5 flex-wrap text-[11px] text-slate-400">
                                {item.storeDomain && (
                                  <span className="inline-flex items-center gap-1 text-slate-300 font-medium truncate max-w-[170px]">
                                    <Store className="h-3 w-3 text-indigo-400 shrink-0" />
                                    {item.storeDomain}
                                  </span>
                                )}
                                <span>·</span>
                                <span className="text-slate-400 truncate">
                                  {item.familyLabel}
                                </span>
                              </div>
                              <div className="flex items-center gap-1.5 flex-wrap pt-0.5">
                                <span
                                  data-testid="kh02-badge-identity-status"
                                  className="text-[10px] px-1.5 py-0.5 rounded bg-slate-800/90 text-slate-300 border border-slate-700/70"
                                >
                                  {formatBusinessTerm(
                                    item.rawCandidate.identityStatus || "PROBABLE"
                                  )}
                                </span>
                                <span
                                  data-testid="kh02-badge-reality-status"
                                  className="text-[10px] px-1.5 py-0.5 rounded bg-slate-800/90 text-slate-300 border border-slate-700/70"
                                >
                                  {formatBusinessTerm(
                                    item.rawCandidate.productRealityStatus ||
                                      "EVIDENCE_SUPPORTED_PHYSICAL_PRODUCT"
                                  )}
                                </span>
                                <span className="text-[10px] px-1.5 py-0.5 rounded bg-indigo-950/60 text-indigo-300 border border-indigo-800/50 font-medium">
                                  {item.audienceBadgeLabel}
                                </span>
                              </div>
                            </div>
                          </div>

                          {/* Score & Confidence Metrics */}
                          <div className="grid grid-cols-2 gap-2.5 p-3 rounded-xl bg-[#0b0f17] border border-slate-800/80">
                            <div>
                              <span className="text-[10px] text-slate-400 block">
                                Research Score
                              </span>
                              <div className="flex items-baseline gap-1 mt-0.5">
                                <span className="text-lg font-bold text-white font-mono">
                                  {item.opportunityScore ?? "—"}
                                </span>
                                <span className="text-xs text-slate-500 font-mono">/ 100</span>
                              </div>
                              <span className="text-[10px] text-slate-400 truncate block">
                                {item.scoreStatusLabel}
                              </span>
                            </div>

                            <div>
                              <span className="text-[10px] text-slate-400 block">
                                Evidence Confidence
                              </span>
                              <div className="flex items-baseline gap-1 mt-0.5">
                                <span className="text-lg font-bold text-emerald-400 font-mono">
                                  {item.evidenceConfidence}%
                                </span>
                              </div>
                              <span className="text-[10px] text-slate-400 truncate block">
                                {item.observationCount} ad observation
                                {item.observationCount === 1 ? "" : "s"}
                              </span>
                            </div>
                          </div>

                          {/* Why It Matters */}
                          <div className="space-y-1">
                            <span className="text-[11px] font-semibold text-slate-300 block">
                              Why it fits your search
                            </span>
                            <p className="text-xs text-slate-400 leading-relaxed line-clamp-2">
                              {item.whyItMatters}
                            </p>
                          </div>

                          {/* Verified Evidence & Missing Requirements */}
                          <div className="space-y-2 text-xs pt-1 border-t border-slate-800/70">
                            <div className="space-y-1">
                              <span className="text-[10px] uppercase tracking-wider text-slate-400 font-semibold block">
                                Verified Evidence
                              </span>
                              <ul className="space-y-1">
                                {item.verifiedEvidenceItems.slice(0, 3).map((ev, i) => (
                                  <li
                                    key={i}
                                    className="text-[11px] text-slate-300 flex items-center gap-1.5"
                                  >
                                    <CheckCircle2 className="h-3 w-3 text-emerald-400 shrink-0" />
                                    <span className="truncate">{ev}</span>
                                  </li>
                                ))}
                              </ul>
                            </div>

                            {item.missingRequirements.length > 0 && (
                              <div className="space-y-1 pt-1">
                                <span className="text-[10px] uppercase tracking-wider text-amber-400/90 font-semibold block">
                                  Needed for Evergreen Winner
                                </span>
                                <p className="text-[11px] text-amber-200/90 leading-snug line-clamp-2">
                                  {item.missingRequirements[0]}
                                </p>
                              </div>
                            )}
                          </div>
                        </div>

                        {/* Card Footer Actions */}
                        <div className="pt-3 border-t border-slate-800/80 flex items-center justify-between gap-2">
                          <button
                            type="button"
                            data-testid="pf-view-research-btn"
                            onClick={() =>
                              openCandidateResearchDrawer(
                                item.rawCandidate,
                                item.rawRankedItem,
                                item,
                                "OVERVIEW"
                              )
                            }
                            className="flex-1 py-2 px-3 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-100 font-semibold text-xs flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
                          >
                            <FileSearch className="h-3.5 w-3.5 text-indigo-400" />
                            <span>View Research</span>
                          </button>

                          <Link
                            data-testid="pf-commercial-assessment-link"
                            href={buildCommercialAssessmentUrl(
                              item.researchProductId || item.candidateId,
                              item.candidateId
                            )}
                            className="flex-1 py-2 px-3 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-semibold text-xs flex items-center justify-center gap-1.5 transition-colors text-center"
                          >
                            <span>Commercial Assessment</span>
                            <ChevronRight className="h-3.5 w-3.5 shrink-0" />
                          </Link>

                          {item.canonicalProductUrl && (
                            <a
                              href={item.canonicalProductUrl}
                              target="_blank"
                              rel="noreferrer"
                              title="Open merchant product page"
                              className="p-2 rounded-xl bg-slate-900 hover:bg-slate-800 text-slate-300 border border-slate-800 transition-colors"
                            >
                              <ExternalLink className="h-3.5 w-3.5" />
                            </a>
                          )}
                        </div>
                      </article>
                    ))}
                  </div>
                ) : (
                  <div
                    data-testid="kh02-empty-shortlist-explanation"
                    className="p-8 rounded-2xl bg-[#111827] border border-slate-800 text-center space-y-3"
                  >
                    <ShoppingBag className="h-8 w-8 text-slate-500 mx-auto" />
                    <h3 className="text-sm font-bold text-white">
                      No qualified product candidates found for &ldquo;
                      {leaderboard?.topic || topic}&rdquo;
                    </h3>
                    <p className="text-xs text-slate-400 max-w-lg mx-auto leading-relaxed">
                      Returned advertisements either lacked verifiable merchant product pages or
                      targeted a different customer segment. Try switching Source Mode to{" "}
                      <strong className="text-slate-200">Live + Cache</strong> or check the{" "}
                      <button
                        type="button"
                        onClick={() => setActiveTab("ALL_CANDIDATES")}
                        className="text-indigo-400 underline hover:text-indigo-300"
                      >
                        All Candidates
                      </button>{" "}
                      tab to inspect excluded items.
                    </p>
                  </div>
                )}
              </section>
            )}

            {/* =====================================================================
                TAB 2: ALL CANDIDATES EXPLORER
               ===================================================================== */}
            {activeTab === "ALL_CANDIDATES" && (
              <section
                data-testid="pf-all-candidates-view"
                className="rounded-2xl bg-[#111827] border border-slate-800 p-4 sm:p-5 space-y-4"
              >
                {/* Filter Bar */}
                <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
                  {/* Status Filter Chips */}
                  <div className="flex items-center gap-1.5 flex-wrap">
                    {(
                      [
                        { key: "ALL", label: "All", testId: "pf-filter-all" },
                        {
                          key: "RESEARCH_QUALIFIED",
                          label: "Research Qualified",
                          testId: "pf-filter-qualified",
                        },
                        {
                          key: "PROVISIONAL",
                          label: "Provisional",
                          testId: "pf-filter-provisional",
                        },
                        {
                          key: "NEEDS_VERIFICATION",
                          label: "Needs Verification",
                          testId: "pf-filter-needs-verification",
                        },
                        {
                          key: "EXCLUDED",
                          label: "Excluded",
                          testId: "pf-filter-excluded",
                        },
                      ] as const
                    ).map((chip) => {
                      const count = explorerCounts[chip.key] ?? 0;
                      const active = candidateFilter === chip.key;
                      return (
                        <button
                          key={chip.key}
                          type="button"
                          data-testid={chip.testId}
                          onClick={() => setCandidateFilter(chip.key)}
                          className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors flex items-center gap-1.5 ${
                            active
                              ? "bg-indigo-600 text-white"
                              : "bg-slate-900 hover:bg-slate-800 text-slate-300 border border-slate-800"
                          }`}
                        >
                          <span>{chip.label}</span>
                          <span
                            className={`text-[10px] font-mono px-1.5 py-0.2 rounded ${
                              active ? "bg-indigo-700 text-white" : "bg-slate-800 text-slate-400"
                            }`}
                          >
                            {count}
                          </span>
                        </button>
                      );
                    })}
                  </div>

                  {/* Search & Family Filter */}
                  <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
                    <div className="relative">
                      <Search className="h-3.5 w-3.5 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
                      <input
                        type="text"
                        value={candidateSearch}
                        onChange={(e) => setCandidateSearch(e.target.value)}
                        placeholder="Filter by product or store..."
                        className="pl-8 pr-3 py-1.5 rounded-lg bg-[#0b0f17] border border-slate-800 text-xs text-slate-200 focus:outline-none focus:border-indigo-500 w-full sm:w-52"
                      />
                    </div>

                    <select
                      aria-label="Filter by Product Family"
                      value={selectedFamily}
                      onChange={(e) => setSelectedFamily(e.target.value)}
                      className="px-3 py-1.5 rounded-lg bg-[#0b0f17] border border-slate-800 text-xs text-slate-200 focus:outline-none focus:border-indigo-500"
                    >
                      <option value="ALL">All Families ({distinctFamilies.length})</option>
                      {distinctFamilies.map(([key, label]) => (
                        <option key={key} value={key}>
                          {label}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                {/* Desktop Candidate Table */}
                <div className="hidden md:block overflow-x-auto">
                  <table className="w-full text-left border-collapse text-xs">
                    <thead>
                      <tr className="border-b border-slate-800 text-slate-400 text-[11px]">
                        <th className="py-2.5 px-3 font-medium">Product & Store</th>
                        <th className="py-2.5 px-3 font-medium">Status</th>
                        <th className="py-2.5 px-3 font-medium">Audience Fit</th>
                        <th className="py-2.5 px-3 font-medium">Score / Conf</th>
                        <th className="py-2.5 px-3 font-medium">Evidence & Qualification Note</th>
                        <th className="py-2.5 px-3 text-right font-medium">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800/60">
                      {filteredExplorerCandidates.map((row) => (
                        <tr
                          key={row.candidateId}
                          data-testid={
                            row.explorerStatus === "EXCLUDED"
                              ? "kh02-rejected-product-card"
                              : "pf-explorer-candidate-row"
                          }
                          data-candidate-id={row.candidateId}
                          className="hover:bg-slate-900/50 transition-colors"
                        >
                          <td className="py-3 px-3 max-w-xs">
                            <div className="font-semibold text-white line-clamp-1">
                              {row.title}
                            </div>
                            <div className="text-[11px] text-slate-400 flex items-center gap-1.5 mt-0.5">
                              <span>{row.storeDomain || "Store unverified"}</span>
                              <span>·</span>
                              <span className="text-slate-500">{row.familyLabel}</span>
                            </div>
                          </td>
                          <td className="py-3 px-3 whitespace-nowrap">
                            <span
                              className={`text-[11px] font-medium px-2 py-0.5 rounded-full border ${
                                row.statusTone === "emerald"
                                  ? "bg-emerald-950/60 text-emerald-300 border-emerald-700/40"
                                  : row.statusTone === "amber"
                                  ? "bg-amber-950/60 text-amber-300 border-amber-700/40"
                                  : row.statusTone === "rose"
                                  ? "bg-rose-950/60 text-rose-300 border-rose-700/40"
                                  : "bg-slate-800 text-slate-300 border-slate-700"
                              }`}
                            >
                              {row.statusBadgeLabel}
                            </span>
                            <div className="text-[10px] text-slate-500 mt-1">
                              {row.identityLabel}
                            </div>
                          </td>
                          <td className="py-3 px-3 whitespace-nowrap">
                            <span
                              className={`text-[11px] px-2 py-0.5 rounded font-medium ${
                                row.audienceFitStatus === "MISMATCHED"
                                  ? "bg-rose-950/60 text-rose-300 border border-rose-800/50"
                                  : "bg-slate-800 text-slate-300"
                              }`}
                            >
                              {row.audienceBadgeLabel}
                            </span>
                          </td>
                          <td className="py-3 px-3 whitespace-nowrap font-mono">
                            <div className="text-white font-semibold">
                              {row.opportunityScore != null ? `${row.opportunityScore}/100` : "—"}
                            </div>
                            <div className="text-[10px] text-slate-400">
                              {row.evidenceConfidence}% · {row.observationCount} obs
                            </div>
                          </td>
                          <td className="py-3 px-3 max-w-md">
                            <p className="text-slate-300 text-xs line-clamp-2">
                              {row.plainEnglishReason}
                            </p>
                          </td>
                          <td className="py-3 px-3 text-right whitespace-nowrap">
                            <div className="inline-flex items-center gap-1.5">
                              <button
                                type="button"
                                onClick={() =>
                                  openCandidateResearchDrawer(
                                    row.rawCandidate,
                                    row.rawRankedItem,
                                    null,
                                    "OVERVIEW"
                                  )
                                }
                                className="px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium"
                              >
                                Inspect
                              </button>
                              {row.explorerStatus !== "EXCLUDED" && (
                                <Link
                                  href={buildCommercialAssessmentUrl(
                                    row.researchProductId || row.candidateId,
                                    row.candidateId
                                  )}
                                  className="px-2.5 py-1 rounded-lg bg-indigo-600/20 hover:bg-indigo-600/30 text-indigo-300 border border-indigo-500/30 text-xs font-medium"
                                >
                                  Assess
                                </Link>
                              )}
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {/* Mobile Stacked Cards */}
                <div className="md:hidden space-y-2.5">
                  {filteredExplorerCandidates.map((row) => (
                    <div
                      key={row.candidateId}
                      data-testid="pf-explorer-mobile-card"
                      className="p-3.5 rounded-xl bg-[#0b0f17] border border-slate-800 space-y-2 text-xs"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <h4 className="font-bold text-white line-clamp-1">{row.title}</h4>
                          <p className="text-[11px] text-slate-400 truncate">
                            {row.storeDomain || "Store unverified"} · {row.familyLabel}
                          </p>
                        </div>
                        <span
                          className={`text-[10px] font-semibold px-2 py-0.5 rounded-full shrink-0 ${
                            row.statusTone === "emerald"
                              ? "bg-emerald-950 text-emerald-300"
                              : row.statusTone === "rose"
                              ? "bg-rose-950 text-rose-300"
                              : "bg-amber-950 text-amber-300"
                          }`}
                        >
                          {row.statusBadgeLabel}
                        </span>
                      </div>
                      <p className="text-[11px] text-slate-300 line-clamp-2">
                        {row.plainEnglishReason}
                      </p>
                      <div className="flex items-center justify-between pt-2 border-t border-slate-800/80">
                        <span className="font-mono text-[11px] text-slate-400">
                          Score: {row.opportunityScore ?? "—"}/100 · {row.audienceBadgeLabel}
                        </span>
                        <button
                          type="button"
                          onClick={() =>
                            openCandidateResearchDrawer(
                              row.rawCandidate,
                              row.rawRankedItem,
                              null,
                              "OVERVIEW"
                            )
                          }
                          className="px-2.5 py-1 rounded-lg bg-slate-800 text-slate-200 text-xs font-medium"
                        >
                          Inspect
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            )}

            {/* =====================================================================
                TAB 3: EVIDENCE & DIAGNOSTICS
               ===================================================================== */}
            {activeTab === "EVIDENCE_DIAGNOSTICS" && (
              <section
                data-testid="pf-evidence-diagnostics-view"
                className="space-y-6"
              >
                {/* 14.1 Source Execution Summary */}
                <div
                  data-testid="kh02-source-status-bar"
                  className="rounded-2xl bg-[#111827] border border-slate-800 p-5 space-y-4"
                >
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                    <div>
                      <h2 className="text-sm font-bold text-white flex items-center gap-2">
                        <Database className="h-4 w-4 text-indigo-400" />
                        <span>Advertising & Demand Source Providers</span>
                      </h2>
                      <p className="text-xs text-slate-400 mt-0.5">
                        Real-time upstream collection status, historical cache fallback, and
                        provider credentials.
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        data-testid="kh02-discover-sources-button"
                        onClick={handleDiscoverSources}
                        disabled={discoveringSources}
                        className="px-3 py-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 text-slate-200 border border-slate-700 text-xs font-medium flex items-center gap-1.5"
                      >
                        {discoveringSources ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <Sparkles className="h-3.5 w-3.5 text-indigo-400" />
                        )}
                        <span>Discover Sources</span>
                      </button>

                      <button
                        type="button"
                        data-testid="kh02-test-connections-button"
                        onClick={handleTestSources}
                        disabled={testingSources}
                        className="px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-medium flex items-center gap-1.5"
                      >
                        {testingSources ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <RefreshCw className="h-3.5 w-3.5" />
                        )}
                        <span>Test Connections</span>
                      </button>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3 text-xs">
                    {[
                      {
                        label: "Meta Ads Library",
                        cov: leaderboard?.sourceCoverage?.META_ADS,
                      },
                      {
                        label: "Google Ads Transparency",
                        cov: leaderboard?.sourceCoverage?.GOOGLE_ADS_TRANSPARENCY,
                      },
                      {
                        label: "Demand History",
                        cov: leaderboard?.sourceCoverage?.GOOGLE_TRENDS,
                      },
                      {
                        label: "TikTok Creative",
                        cov: leaderboard?.sourceCoverage?.TIKTOK_CREATIVE,
                      },
                    ].map((src) => (
                      <div
                        key={src.label}
                        className="p-3.5 rounded-xl bg-[#0b0f17] border border-slate-800 space-y-1.5"
                      >
                        <div className="flex items-center justify-between">
                          <span className="font-semibold text-slate-200">{src.label}</span>
                          <span
                            className={`text-[10px] font-mono px-1.5 py-0.5 rounded ${
                              src.cov?.freshLiveAdsCount
                                ? "bg-emerald-950 text-emerald-300"
                                : src.cov?.historicalCachedAdsCount
                                ? "bg-amber-950 text-amber-300"
                                : "bg-slate-800 text-slate-400"
                            }`}
                          >
                            {src.cov?.queryStatus || "READY"}
                          </span>
                        </div>
                        <div className="font-mono text-[11px] text-slate-400">
                          Live: {src.cov?.freshLiveAdsCount ?? 0} · Cache:{" "}
                          {src.cov?.historicalCachedAdsCount ?? 0}
                        </div>
                        {src.cov?.errorSummary && (
                          <p className="text-[10px] text-amber-300/90 line-clamp-2">
                            {src.cov.errorSummary}
                          </p>
                        )}
                      </div>
                    ))}

                    {/* Gemini AI Badge */}
                    <div
                      data-testid="kh02-gemini-ai-badge"
                      className="p-3.5 rounded-xl bg-[#0b0f17] border border-slate-800 space-y-1.5"
                    >
                      <div className="flex items-center justify-between">
                        <span className="font-semibold text-slate-200">Gemini AI Verifier</span>
                        <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-emerald-950 text-emerald-300">
                          {leaderboard?.aiDiscoverySummary?.aiMode || "ACTIVE"}
                        </span>
                      </div>
                      <div className="font-mono text-[11px] text-slate-400">
                        Verified: {leaderboard?.aiDiscoverySummary?.aiVerifiedPhysicalCount ?? 0}{" "}
                        · Calls: {leaderboard?.aiDiscoverySummary?.actualGeminiCalls ?? 0}
                      </div>
                    </div>
                  </div>
                </div>

                {/* 14.2 Meta Subquery Execution Table */}
                <div className="rounded-2xl bg-[#111827] border border-slate-800 p-5 space-y-3">
                  <h3 className="text-sm font-bold text-white">
                    Meta & Source Subquery Execution Log
                  </h3>
                  <div className="overflow-x-auto">
                    <table
                      data-testid="kh02-query-coverage-table"
                      className="w-full text-left border-collapse text-xs"
                    >
                      <thead>
                        <tr className="border-b border-slate-800 text-slate-400 text-[11px]">
                          <th className="py-2 px-3">Query String</th>
                          <th className="py-2 px-3">Type</th>
                          <th className="py-2 px-3">Status</th>
                          <th className="py-2 px-3">API Calls</th>
                          <th className="py-2 px-3">Returned Ads</th>
                          <th className="py-2 px-3">Diagnostic Note</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-800/60 font-mono text-[11px]">
                        {(leaderboard?.queryExecutions || []).length > 0 ? (
                          (leaderboard?.queryExecutions || []).map((q: any, idx: number) => (
                            <tr key={idx}>
                              <td className="py-2 px-3 text-white">{q.queryString}</td>
                              <td className="py-2 px-3 text-slate-400">{q.queryType}</td>
                              <td className="py-2 px-3">
                                <span
                                  className={`px-1.5 py-0.5 rounded text-[10px] ${
                                    q.status === "QUERY_SUCCEEDED"
                                      ? "bg-emerald-950 text-emerald-300"
                                      : q.status === "QUERY_FAILED"
                                      ? "bg-rose-950 text-rose-300"
                                      : "bg-slate-800 text-slate-300"
                                  }`}
                                >
                                  {q.status}
                                </span>
                              </td>
                              <td className="py-2 px-3 text-slate-300">{q.actualApiCalls}</td>
                              <td className="py-2 px-3 text-slate-200">{q.returnedAdsCount}</td>
                              <td className="py-2 px-3 text-slate-400 font-sans">
                                {q.errorMessage || "Completed"}
                              </td>
                            </tr>
                          ))
                        ) : (
                          <tr>
                            <td colSpan={6} className="py-3 px-3 text-slate-400 font-sans">
                              No upstream subqueries recorded for this snapshot.
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>

                {/* 14.3 Coherent 13-Stage Candidate Funnel */}
                <div
                  data-testid="kh02-discovery-intelligence-panel"
                  className="rounded-2xl bg-[#111827] border border-slate-800 p-5 space-y-4"
                >
                  <div
                    data-testid="kh02-candidate-funnel-summary"
                    className="flex items-center justify-between"
                  >
                    <div>
                      <h3 className="text-sm font-bold text-white">
                        Coherent 13-Stage Candidate Qualification Funnel
                      </h3>
                      <p className="text-xs text-slate-400">
                        Auditable stage-by-stage progression from raw ad observations to
                        Verified Evergreen Winners.
                      </p>
                    </div>
                    <span
                      className={`text-[11px] font-mono px-2.5 py-1 rounded-lg ${
                        leaderboard?.candidateFunnel?.funnelCoherent !== false
                          ? "bg-emerald-950/60 text-emerald-300 border border-emerald-700/40"
                          : "bg-rose-950/60 text-rose-300"
                      }`}
                    >
                      {leaderboard?.candidateFunnel?.funnelCoherent !== false
                        ? "FUNNEL COHERENT"
                        : "CHECK FUNNEL"}
                    </span>
                  </div>

                  <div
                    data-testid="kh02-coherent-funnel-grid"
                    className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-2.5 text-xs"
                  >
                    {[
                      {
                        label: "1. Raw Source Items",
                        val: leaderboard?.candidateFunnel?.rawSourceItemsCount,
                      },
                      {
                        label: "2. Ad Observations",
                        val: leaderboard?.candidateFunnel?.normalizedObservationsCount,
                      },
                      {
                        label: "3. Extracted Candidates",
                        val: leaderboard?.candidateFunnel?.extractedCandidatesCount,
                      },
                      {
                        label: "4. Physical Candidates",
                        val: leaderboard?.candidateFunnel?.physicalProductCandidatesCount,
                      },
                      {
                        label: "5. Non-Product Excluded",
                        val: leaderboard?.candidateFunnel?.excludedNonProductCount,
                      },
                      {
                        label: "6. Site Shells Excluded",
                        val: leaderboard?.candidateFunnel?.excludedUnverifiedSiteShellCount,
                      },
                      {
                        label: "7. Niche Irrelevant",
                        val: leaderboard?.candidateFunnel?.excludedIrrelevantCount,
                      },
                      {
                        label: "8. Niche Relevant",
                        val: leaderboard?.candidateFunnel?.nicheRelevantCandidatesCount,
                      },
                      {
                        label: "9. Identity Verified",
                        val: leaderboard?.candidateFunnel?.identityVerifiedCount,
                      },
                      {
                        label: "10. Identity Probable",
                        val: leaderboard?.candidateFunnel?.identityProbableCount,
                      },
                      {
                        label: "11. Distinct Families",
                        val: leaderboard?.candidateFunnel?.distinctProductFamiliesCount,
                      },
                      {
                        label: "12. Shortlist Qualified",
                        val: leaderboard?.candidateFunnel?.shortlistQualifiedCount,
                      },
                      {
                        label: "13. Evergreen Winners",
                        val: leaderboard?.candidateFunnel?.verifiedEvergreenWinnerCount,
                      },
                    ].map((st) => (
                      <div
                        key={st.label}
                        className="p-3 rounded-xl bg-[#0b0f17] border border-slate-800"
                      >
                        <span className="text-[10px] text-slate-400 block truncate">
                          {st.label}
                        </span>
                        <span className="text-base font-bold text-white font-mono mt-1 block">
                          {st.val ?? 0}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>

                {/* 14.4 Runtime & Build Parity Panel */}
                <div className="rounded-2xl bg-[#111827] border border-slate-800 p-5 space-y-3 text-xs">
                  <h3 className="text-sm font-bold text-white flex items-center gap-2">
                    <ShieldCheck className="h-4 w-4 text-emerald-400" />
                    <span>Runtime & Worker Build Parity</span>
                  </h3>
                  <div className="grid grid-cols-1 sm:grid-cols-4 gap-3 font-mono">
                    <div className="p-3 rounded-xl bg-[#0b0f17] border border-slate-800">
                      <span className="text-[10px] text-slate-400 block font-sans">
                        Release Version
                      </span>
                      <span className="text-sm font-bold text-white">
                        {runtimeIdentity?.releaseVersion || frontendReleaseVersion}
                      </span>
                    </div>
                    <div className="p-3 rounded-xl bg-[#0b0f17] border border-slate-800">
                      <span className="text-[10px] text-slate-400 block font-sans">
                        Frontend Build SHA
                      </span>
                      <span className="text-sm font-bold text-slate-200">
                        {runtimeIdentity?.versionParity?.frontendCommitSha || frontendBuildSha}
                      </span>
                    </div>
                    <div className="p-3 rounded-xl bg-[#0b0f17] border border-slate-800">
                      <span className="text-[10px] text-slate-400 block font-sans">
                        Backend Server SHA
                      </span>
                      <span className="text-sm font-bold text-slate-200">
                        {runtimeIdentity?.versionParity?.backendCommitSha ||
                          runtimeIdentity?.shortCommitSha ||
                          "unknown"}
                      </span>
                    </div>
                    <div className="p-3 rounded-xl bg-[#0b0f17] border border-slate-800">
                      <span className="text-[10px] text-slate-400 block font-sans">
                        Worker Heartbeat SHA
                      </span>
                      <span className="text-sm font-bold text-emerald-400">
                        {runtimeIdentity?.versionParity?.workerCommitSha ||
                          runtimeIdentity?.workerStatus?.commitSha ||
                          "standby"}
                      </span>
                    </div>
                  </div>
                </div>
              </section>
            )}
          </>
        )}

        {/* =====================================================================
            STORED CATALOG SKUS VIEW (PRESERVED KH-01 / CATALOG FUNCTIONALITY)
           ===================================================================== */}
        {viewMode === "STORED_PRODUCTS" && (
          <section className="space-y-5">
            <div className="flex flex-col sm:flex-row gap-3 items-center justify-between text-xs">
              <div className="relative flex-1 w-full">
                <Search className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
                <input
                  type="text"
                  placeholder="Search catalog products by title or store domain..."
                  value={storedSearch}
                  onChange={(e) => setStoredSearch(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && fetchStoredProducts()}
                  className="w-full pl-9 pr-4 py-2 rounded-xl bg-[#111827] border border-slate-800 text-slate-200 focus:outline-none focus:border-indigo-500 text-xs"
                />
              </div>

              <select
                aria-label="Catalog Category"
                value={storedCategory}
                onChange={(e) => setStoredCategory(e.target.value)}
                className="px-3 py-2 rounded-xl bg-[#111827] border border-slate-800 text-slate-200 text-xs"
              >
                <option value="ALL">All Categories</option>
                <option value="Home & Kitchen">Home & Kitchen</option>
                <option value="Beauty & Personal Care">Beauty & Personal Care</option>
                <option value="Pet Supplies">Pet Supplies</option>
              </select>
            </div>

            {storedLoading ? (
              <div className="p-12 text-center text-slate-400 text-xs">
                Loading stored catalog products...
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
                {storedProducts.map((product) => (
                  <div
                    key={product.id}
                    className="bg-[#111827] rounded-2xl border border-slate-800 overflow-hidden flex flex-col justify-between p-4 space-y-3"
                  >
                    <div className="space-y-2">
                      <span className="text-[10px] px-2 py-0.5 rounded bg-slate-800 text-slate-300">
                        {product.category}
                      </span>
                      <h3 className="text-sm font-bold text-white line-clamp-2">
                        {product.title}
                      </h3>
                      <p className="text-xs text-slate-400 font-mono">
                        Store: {product.store?.domain || "Unknown"}
                      </p>
                    </div>
                    <div className="pt-3 border-t border-slate-800 flex items-center justify-between">
                      <span className="text-sm font-bold text-emerald-400 font-mono">
                        {product.currentPrice != null
                          ? `$${product.currentPrice.toFixed(2)}`
                          : "Price unverified"}
                      </span>
                      <Link
                        href={`/products/${product.id}/intelligence`}
                        className="px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold"
                      >
                        Commercial Assessment
                      </Link>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>
        )}
      </main>

      {/* =====================================================================
          SECTION 12: SLIDE-OVER PRODUCT RESEARCH DETAIL DRAWER
         ===================================================================== */}
      {drawerCandidate && (
        <div
          data-testid="pf-candidate-drawer"
          className="fixed inset-0 z-50 flex justify-end bg-black/70 backdrop-blur-xs"
        >
          <div className="w-full max-w-2xl bg-[#0f1523] border-l border-slate-800 h-full flex flex-col justify-between overflow-hidden shadow-2xl">
            {/* Drawer Header */}
            <div className="p-5 border-b border-slate-800 flex items-start justify-between gap-4">
              <div className="min-w-0 space-y-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-[10px] font-semibold px-2 py-0.5 rounded bg-indigo-950 text-indigo-300 border border-indigo-800/50">
                    {formatBusinessTerm(
                      drawerCandidate.candidate.identityStatus || "PROBABLE"
                    )}
                  </span>
                  <span className="text-[10px] font-semibold px-2 py-0.5 rounded bg-slate-800 text-slate-300">
                    {drawerCandidate.candidate.familyLabel ||
                      drawerCandidate.candidate.category ||
                      "Physical Product"}
                  </span>
                </div>
                <h2 className="text-base font-bold text-white line-clamp-2">
                  {drawerCandidate.candidate.merchantVerifiedProductName ||
                    drawerCandidate.candidate.canonicalProductName ||
                    drawerCandidate.candidate.title}
                </h2>
                {drawerCandidate.candidate.storeDomain && (
                  <p className="text-xs text-slate-400 font-mono">
                    Merchant: {drawerCandidate.candidate.storeDomain}
                  </p>
                )}
              </div>

              <button
                type="button"
                data-testid="pf-drawer-close"
                onClick={() => setDrawerCandidate(null)}
                className="p-1.5 rounded-lg bg-slate-800 text-slate-400 hover:text-white"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {/* Drawer Internal Tabs */}
            <div className="flex items-center border-b border-slate-800 px-5 gap-2 overflow-x-auto bg-[#0b0f17]">
              {(
                [
                  { key: "OVERVIEW", label: "Overview" },
                  { key: "ADS", label: "Advertising Evidence" },
                  { key: "DEMAND", label: "Demand & Trend Evidence" },
                  { key: "PSYCHOLOGY", label: "Customer Psychology" },
                ] as const
              ).map((t) => (
                <button
                  key={t.key}
                  type="button"
                  data-testid={`pf-drawer-tab-${t.key.toLowerCase()}`}
                  onClick={() => setDrawerTab(t.key)}
                  className={`py-2.5 px-3 text-xs font-semibold border-b-2 whitespace-nowrap transition-colors ${
                    drawerTab === t.key
                      ? "border-indigo-500 text-white"
                      : "border-transparent text-slate-400 hover:text-slate-200"
                  }`}
                >
                  {t.label}
                </button>
              ))}
            </div>

            {/* Drawer Body */}
            <div className="flex-1 overflow-y-auto p-5 space-y-4 text-xs">
              {drawerTab === "OVERVIEW" && (
                <div className="space-y-4">
                  <div className="p-4 rounded-xl bg-[#111827] border border-slate-800 space-y-2">
                    <h3 className="font-semibold text-white">
                      Product Identity & Target Customer Fit
                    </h3>
                    <p className="text-slate-300 leading-relaxed">
                      {drawerCandidate.candidate.verificationReason ||
                        drawerCandidate.canonicalCard?.whyItMatters ||
                        "Identified as a concrete sellable product supported by advertising and storefront evidence."}
                    </p>
                    {drawerCandidate.candidate.audienceRelevance && (
                      <div className="pt-2 border-t border-slate-800 flex items-center justify-between text-[11px]">
                        <span className="text-slate-400">Target Customer Segment:</span>
                        <span className="font-semibold text-indigo-300">
                          {(drawerCandidate.candidate.audienceRelevance.supportedAudiences || []).join(
                            ", "
                          )}{" "}
                          ({drawerCandidate.candidate.audienceRelevance.relevanceReason})
                        </span>
                      </div>
                    )}
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div className="p-3.5 rounded-xl bg-[#111827] border border-slate-800">
                      <span className="text-[10px] text-slate-400 block">
                        Merchant Store Domain
                      </span>
                      <span className="text-sm font-semibold text-white mt-0.5 block truncate">
                        {drawerCandidate.candidate.storeDomain || "Unverified Store"}
                      </span>
                    </div>
                    <div className="p-3.5 rounded-xl bg-[#111827] border border-slate-800">
                      <span className="text-[10px] text-slate-400 block">
                        Model / SKU / Identifier
                      </span>
                      <span className="text-sm font-mono text-slate-200 mt-0.5 block truncate">
                        {[
                          drawerCandidate.candidate.model,
                          drawerCandidate.candidate.sku,
                          drawerCandidate.candidate.gtin,
                        ]
                          .filter(Boolean)
                          .join(" · ") || "Standard Merchant SKU"}
                      </span>
                    </div>
                  </div>

                  {drawerCandidate.candidate.canonicalProductUrl && (
                    <div className="p-3.5 rounded-xl bg-[#111827] border border-slate-800 flex items-center justify-between">
                      <div className="min-w-0 pr-3">
                        <span className="text-[10px] text-slate-400 block">
                          Verified Product Page URL
                        </span>
                        <span className="text-xs font-mono text-indigo-300 truncate block">
                          {drawerCandidate.candidate.canonicalProductUrl}
                        </span>
                      </div>
                      <a
                        href={drawerCandidate.candidate.canonicalProductUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-white text-xs font-medium shrink-0 flex items-center gap-1"
                      >
                        <span>Open Page</span>
                        <ExternalLink className="h-3.5 w-3.5" />
                      </a>
                    </div>
                  )}
                </div>
              )}

              {drawerTab === "ADS" && (
                <div className="space-y-3">
                  <div className="p-4 rounded-xl bg-[#111827] border border-slate-800 space-y-2">
                    <h3 className="font-semibold text-white">
                      Supporting Advertising Observations
                    </h3>
                    <div className="grid grid-cols-3 gap-2 pt-1 font-mono">
                      <div>
                        <span className="text-[10px] text-slate-400 block font-sans">
                          Total Observations
                        </span>
                        <span className="text-sm font-bold text-white">
                          {drawerCandidate.candidate.totalObservationCount || 1}
                        </span>
                      </div>
                      <div>
                        <span className="text-[10px] text-slate-400 block font-sans">
                          Supporting Ads
                        </span>
                        <span className="text-sm font-bold text-white">
                          {drawerCandidate.candidate.supportingAdIds?.length || 1}
                        </span>
                      </div>
                      <div>
                        <span className="text-[10px] text-slate-400 block font-sans">
                          Distinct Advertisers
                        </span>
                        <span className="text-sm font-bold text-white">
                          {drawerCandidate.candidate.distinctAdvertisersCount || 1}
                        </span>
                      </div>
                    </div>
                  </div>

                  {drawerCandidate.candidate.evidenceSnippets?.map(
                    (snippet: string, i: number) => (
                      <div
                        key={i}
                        className="p-3.5 rounded-xl bg-[#111827] border border-slate-800 text-slate-300 leading-relaxed"
                      >
                        &ldquo;{snippet}&rdquo;
                      </div>
                    )
                  )}
                </div>
              )}

              {drawerTab === "DEMAND" && (
                <div className="space-y-3">
                  <div className="p-4 rounded-xl bg-[#111827] border border-slate-800 space-y-2">
                    <div className="flex items-center justify-between">
                      <h3 className="font-semibold text-white">
                        Historical Demand & Trend Provenance
                      </h3>
                      <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-amber-950 text-amber-300 border border-amber-700/40">
                        {drawerCandidate.rankedItem?.temporalProfile?.demandSourceAuthority
                          ?.authorityStatus || "PENDING_VERIFICATION"}
                      </span>
                    </div>
                    <p className="text-slate-300 leading-relaxed">
                      {drawerCandidate.rankedItem?.temporalProfile?.demandSourceAuthority
                        ?.authorityReason ||
                        "Historical multi-month search demand is not yet verified from an authoritative Google Trends CSV import or live provider."}
                    </p>
                    <div className="p-2.5 rounded-lg bg-slate-900 border border-slate-800 text-[11px] text-slate-400">
                      <strong>Data Honesty Note:</strong> Search interest reflects search
                      trends, not direct unit sales (`SEARCH_INTEREST_NOT_SALES`). Unverified or
                      templated series cannot qualify a product as a Verified Evergreen Winner.
                    </div>
                  </div>
                </div>
              )}

              {drawerTab === "PSYCHOLOGY" && (
                <div className="space-y-3">
                  <div className="p-4 rounded-xl bg-[#111827] border border-slate-800 space-y-2">
                    <h3 className="font-semibold text-white">
                      Customer Psychology & Ad Angles
                    </h3>
                    <p className="text-slate-400 text-[11px]">
                      Signals are strictly separated into <strong>OBSERVED</strong> (directly in
                      ad copy) vs <strong>INFERRED</strong> (modeled from product category).
                    </p>
                    {drawerLoading ? (
                      <div className="py-4 text-slate-400 flex items-center gap-2">
                        <Loader2 className="h-4 w-4 animate-spin" />
                        <span>Loading customer psychology signals...</span>
                      </div>
                    ) : drawerOverviewData?.customerPsychology ? (
                      <div className="space-y-2 pt-2">
                        {(drawerOverviewData.customerPsychology.painPoints || [])
                          .slice(0, 3)
                          .map((pt: any, idx: number) => (
                            <div
                              key={idx}
                              className="p-2.5 rounded-lg bg-slate-900 border border-slate-800 flex items-start justify-between gap-2"
                            >
                              <span className="text-slate-200">{pt.label}</span>
                              <span
                                className={`text-[10px] font-mono px-1.5 py-0.5 rounded shrink-0 ${
                                  pt.evidenceStatus === "OBSERVED"
                                    ? "bg-emerald-950 text-emerald-300"
                                    : "bg-amber-950 text-amber-300"
                                }`}
                              >
                                {pt.evidenceStatus}
                              </span>
                            </div>
                          ))}
                      </div>
                    ) : (
                      <p className="text-slate-400 text-xs">
                        Open the full Commercial Assessment to inspect detailed buyer personas,
                        pain points, and creative angles.
                      </p>
                    )}
                  </div>
                </div>
              )}
            </div>

            {/* Drawer Footer */}
            <div className="p-4 border-t border-slate-800 bg-[#0b0f17] flex items-center justify-between gap-3">
              <button
                type="button"
                onClick={() => setDrawerCandidate(null)}
                className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold"
              >
                Close
              </button>
              <Link
                href={buildCommercialAssessmentUrl(
                  drawerCandidate.candidate.researchProductId ||
                    drawerCandidate.candidate.candidateId,
                  drawerCandidate.candidate.candidateId
                )}
                className="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold flex items-center gap-1.5"
              >
                <span>Open Full Commercial Assessment</span>
                <ChevronRight className="h-4 w-4" />
              </Link>
            </div>
          </div>
        </div>
      )}

      {/* =====================================================================
          SECTION 15: RESEARCH HISTORY DRAWER
         ===================================================================== */}
      {historyDrawerOpen && (
        <div
          data-testid="pf-history-drawer"
          className="fixed inset-0 z-50 flex justify-end bg-black/70 backdrop-blur-xs"
        >
          <div className="w-full max-w-md bg-[#0f1523] border-l border-slate-800 h-full flex flex-col justify-between overflow-hidden shadow-2xl">
            <div className="p-5 border-b border-slate-800 flex items-center justify-between">
              <div>
                <h2 className="text-base font-bold text-white flex items-center gap-2">
                  <History className="h-4 w-4 text-indigo-400" />
                  <span>Research History</span>
                </h2>
                <p className="text-xs text-slate-400">
                  Switch between previous research runs without losing stored evidence.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setHistoryDrawerOpen(false)}
                className="p-1.5 rounded-lg bg-slate-800 text-slate-400 hover:text-white"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-4 space-y-2.5">
              {recentRuns.length === 0 ? (
                <p className="text-xs text-slate-500 text-center py-8">
                  No historical research runs recorded yet.
                </p>
              ) : (
                recentRuns.map((run) => (
                  <div
                    key={run.runId}
                    className={`p-3.5 rounded-xl border transition-colors flex items-center justify-between gap-3 text-xs ${
                      activeRunId === run.runId
                        ? "bg-indigo-950/40 border-indigo-500/50"
                        : "bg-[#111827] border-slate-800 hover:border-slate-700"
                    }`}
                  >
                    <div className="min-w-0 space-y-0.5">
                      <div className="font-bold text-white truncate">{run.topic}</div>
                      <div className="text-[11px] text-slate-400 font-mono">
                        {run.lookbackDays}D · {run.totalObservations} obs ·{" "}
                        {run.evergreenWinners} evergreen
                      </div>
                      <div className="text-[10px] text-slate-500">
                        {formatRelativeAge(run.completedAt || run.createdAt)} ·{" "}
                        <span className="font-mono">{run.runId.slice(0, 8)}</span>
                      </div>
                    </div>
                    <button
                      type="button"
                      data-testid="pf-history-run-item"
                      onClick={() => {
                        loadPersistedRun({ runId: run.runId, syncTopicInput: true });
                        setHistoryDrawerOpen(false);
                      }}
                      className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-white text-xs font-semibold shrink-0"
                    >
                      Load Run
                    </button>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}

      {/* MEDIA PREVIEW MODAL */}
      {activeMediaItem && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-xs p-4">
          <div className="bg-[#111827] border border-slate-800 rounded-2xl max-w-2xl w-full overflow-hidden shadow-2xl space-y-4 p-5">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold text-white truncate">
                {activeMediaItem.title}
              </h3>
              <button
                type="button"
                onClick={() => setActiveMediaItem(null)}
                className="p-1.5 rounded-lg bg-slate-800 text-slate-400 hover:text-white"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="rounded-xl overflow-hidden bg-black aspect-video flex items-center justify-center">
              {activeMediaItem.videoUrl ? (
                <video
                  src={activeMediaItem.videoUrl}
                  controls
                  autoPlay
                  className="w-full h-full object-contain"
                />
              ) : activeMediaItem.thumbnailUrl ? (
                <img
                  src={activeMediaItem.thumbnailUrl}
                  alt={activeMediaItem.title}
                  className="w-full h-full object-contain"
                />
              ) : null}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
