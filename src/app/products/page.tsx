"use client";

import { useEffect, useState, useRef } from "react";
import Link from "next/link";
import {
  Trophy,
  Medal,
  Sparkles,
  TrendingUp,
  ShieldCheck,
  AlertCircle,
  AlertTriangle,
  PlaySquare,
  Play,
  Store,
  ExternalLink,
  Search,
  CheckCircle2,
  Clock,
  ChevronRight,
  ShoppingBag,
  RefreshCw,
  X,
  Eye,
  SlidersHorizontal,
  Server,
  Info,
  Database,
  Globe,
  KeyRound,
} from "lucide-react";
import { ProviderSetupGuide } from "@/components/products/ProviderSetupGuide";
import { Header } from "@/components/layout/Header";
import { isStockImage } from "@/services/video/videoSourceResolver";

interface RankedItem {
  rank: number | null;
  candidate: {
    candidateId: string;
    researchProductId?: string | null;
    title: string;
    category: string;
    problemStatement: string | null;
    targetAudience: string | null;
    thumbnailUrl: string | null;
    videoUrl: string | null;
    canonicalProductUrl: string | null;
    storeDomain: string | null;
    advertiserNames: string[];
    supportingAdIds: string[];
    supportingSourceTypes: string[];
    totalObservationCount: number;
    distinctAdvertisersCount: number;
    identityStatus?: "VERIFIED" | "PROBABLE" | "AMBIGUOUS" | "UNRESOLVED";
    rawAdIdentifier?: string | null;
    sourceObservations?: any[];
    relevanceStatus?: "RELEVANT" | "PROBABLY_RELEVANT" | "AMBIGUOUS" | "IRRELEVANT";
    relevanceReasons?: string[];
    relevanceScore?: number;
    isEligibleAsEvergreenWinner?: boolean;
    aiIntelligence?: any;
    aiExclusionReason?: string | null;
  };
  score: {
    opportunityScore: number | null;
    evidenceConfidence: number;
    scoreStatus: "VERIFIED" | "PROVISIONAL" | "INSUFFICIENT_EVIDENCE" | "REJECTED";
    tier?: string;
    demandClass: string;
    strengths: string[];
    risks: string[];
    missingEvidence: string[];
    recommendation: string;
    recommendationRationale: string;
    pillars: Record<string, { score: number | null; maxWeight: number; status: string; explanation: string }>;
  };
}

interface LeaderboardData {
  researchRunId: string;
  topic: string;
  market: "US";
  lookbackDays: number;
  formulaVersion: string;
  runStatus: string;
  sourceStatuses: Record<string, string>;
  topThree: RankedItem[];
  provisionalCandidates?: RankedItem[];
  remainingCandidates: RankedItem[];
  insufficientEvidenceCandidates: RankedItem[];
  rejectedCandidates?: RankedItem[];
  totalCandidatesDiscovered: number;
  totalObservationsCollected?: number;
  generatedAt?: string;
  researchShortlist?: {
    shortlist: any[];
    requestedCount: number;
    qualifiedCount: number;
    shortfallReason?: string | null;
    distinctnessSummary?: string;
    distinctnessEvaluation?: any;
  };
  shortfallReason?: string | null;
  candidateFunnel?: any;
  aiTelemetry?: {
    provider: string;
    aiStatus: string;
    authStatus: string;
    modelsDiscoveredCount: number;
    eligibleModelsCount: number;
    primaryModelId: string | null;
    actualModelUsed: string | null;
    fallbackUsed: boolean;
    totalAnalysesAttempted: number;
    totalAnalysesCompleted: number;
    totalAnalysesFailed: number;
    physicalProductsCount: number;
    servicesRejectedCount: number;
    contentRejectedCount: number;
  };
}

interface ProviderStatusItem {
  source: string;
  displayName: string;
  readiness: string;
  isReady: boolean;
  readinessReason: string;
  diagnosticStatus?: string;
  diagnostic?: any;
  dimensions?: any;
  requiredAction?: string;
  estimatedQueryCost?: any;
}

export default function ProductsPage() {
  // Research State
  const [topic, setTopic] = useState("Pet Gadgets");
  const [lookbackDays, setLookbackDays] = useState<number>(90);
  const [isResearching, setIsResearching] = useState(false);
  const [researchError, setResearchError] = useState<string | null>(null);
  const [leaderboard, setLeaderboard] = useState<LeaderboardData | null>(null);

  // Active Research Tracking & Worker Health State
  const [activeRunId, setActiveRunId] = useState<string | null>(null);
  const [activeRunTopic, setActiveRunTopic] = useState<string>("");
  const [activeRunLookback, setActiveRunLookback] = useState<number>(90);
  const [runStage, setRunStage] = useState<string>("QUEUED");
  const [runProgress, setRunProgress] = useState<number>(0);
  const [effectiveJobState, setEffectiveJobState] = useState<string | null>(null);
  const [pollingState, setPollingState] = useState<"IDLE" | "POLLING_ACTIVE" | "POLLING_TIMED_OUT" | "POLLING_ERROR">("IDLE");
  const [jobLiveness, setJobLiveness] = useState<any | null>(null);
  const [elapsedSeconds, setElapsedSeconds] = useState<number>(0);
  const [isLongRunningNotice, setIsLongRunningNotice] = useState<boolean>(false);
  const [workerStatus, setWorkerStatus] = useState<string>("UNKNOWN");
  const [isTestingConnections, setIsTestingConnections] = useState<boolean>(false);
  const [isDiscoveringSources, setIsDiscoveringSources] = useState<boolean>(false);
  const [discoveryMeta, setDiscoveryMeta] = useState<any | null>(null);

  const currentTrackingRunIdRef = useRef<string | null>(null);

  // Live Provider Status State
  const [providerStatuses, setProviderStatuses] = useState<ProviderStatusItem[]>([]);

  // Database Products Tab State
  const [viewMode, setViewMode] = useState<"LEADERBOARD" | "STORED_PRODUCTS">("LEADERBOARD");
  const [storedProducts, setStoredProducts] = useState<any[]>([]);
  const [runtimeVersion, setRuntimeVersion] = useState<any | null>(null);

  const compileTimeFrontendSha = process.env.NEXT_PUBLIC_SWAI_FRONTEND_BUILD_SHA || "";
  const compileTimeReleaseVersion = process.env.NEXT_PUBLIC_SWAI_RELEASE_VERSION || "12.4.1";

  useEffect(() => {
    const params = new URLSearchParams();
    if (compileTimeFrontendSha) params.set("frontendSha", compileTimeFrontendSha);
    if (compileTimeReleaseVersion) params.set("frontendVersion", compileTimeReleaseVersion);
    fetch(`/api/v1/kh02/version?${params.toString()}`)
      .then((res) => res.json())
      .then((json) => {
        if (json.success && json.data) setRuntimeVersion(json.data);
      })
      .catch(() => {});
  }, [compileTimeFrontendSha, compileTimeReleaseVersion]);
  const [storedLoading, setStoredLoading] = useState(false);
  const [storedSearch, setStoredSearch] = useState("");
  const [storedCategory, setStoredCategory] = useState("ALL");

  // Video / Media Modal State
  const [activeMediaItem, setActiveMediaItem] = useState<{
    title: string;
    videoUrl?: string | null;
    thumbnailUrl?: string | null;
    sourceUrl?: string | null;
    platform?: string;
  } | null>(null);

  // Candidate Inspection Modal State (for unlinked candidates)
  const [inspectCandidate, setInspectCandidate] = useState<RankedItem | null>(null);
  const [showConnectionDetails, setShowConnectionDetails] = useState<boolean>(false);
  const [connectionTestResults, setConnectionTestResults] = useState<any[] | null>(null);
  const isInputDirtyRef = useRef<boolean>(false);

  // Fetch Latest Leaderboard Snapshot from DB (No network research on reload)
  const fetchLatestLeaderboard = async () => {
    try {
      const res = await fetch("/api/v1/kh02/leaderboard");
      const json = await res.json();
      if (json.success && json.data) {
        setLeaderboard(json.data);
        if (json.data.topic && !isInputDirtyRef.current) setTopic(json.data.topic);
        if (json.data.lookbackDays) setLookbackDays(json.data.lookbackDays);
      }
    } catch (err) {
      console.error("Failed to load saved leaderboard snapshot:", err);
    }
  };

  // Fetch Live Provider Readiness Statuses
  const fetchProviderStatuses = async () => {
    try {
      const res = await fetch("/api/v1/kh02/providers/status");
      const json = await res.json();
      if (json.success && Array.isArray(json.data)) {
        setProviderStatuses(json.data);
      }
    } catch (err) {
      console.error("Failed to load provider statuses:", err);
    }
  };

  // Auto-discover available zero-key and configured sources (safe, zero cost)
  const handleDiscoverSources = async () => {
    try {
      setIsDiscoveringSources(true);
      const res = await fetch("/api/v1/kh02/providers/discover", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
      if (res.ok) {
        const json = await res.json();
        if (json.success) {
          setDiscoveryMeta(json.meta);
          setShowConnectionDetails(true);
        }
        await fetchProviderStatuses();
      }
    } catch (err) {
      console.error("Failed to discover provider sources:", err);
    } finally {
      setIsDiscoveringSources(false);
    }
  };

  // Test all connections on demand (zero-cost safe diagnostics)
  const handleTestConnections = async () => {
    try {
      setIsTestingConnections(true);
      const res = await fetch("/api/v1/kh02/providers/test-connection", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ all: true }),
      });
      if (res.ok) {
        const json = await res.json();
        if (json.success && Array.isArray(json.data)) {
          setConnectionTestResults(json.data);
          setShowConnectionDetails(true);

          // Update providerStatuses directly with the latest probe results
          setProviderStatuses((prevStatuses) => {
            if (!prevStatuses || prevStatuses.length === 0) return prevStatuses;
            return prevStatuses.map((item) => {
              const probe = json.data.find((p: any) => p.source === item.source);
              if (!probe) return item;
              const mergedDims = {
                ...item.dimensions,
                ...probe.dimensions,
                // Crucial invariant: Never wipe actual research live query history with a diagnostic transport probe
                lastLiveQueryRecordCount:
                  item.dimensions?.lastLiveQueryRecordCount !== null && item.dimensions?.lastLiveQueryRecordCount !== undefined
                    ? item.dimensions.lastLiveQueryRecordCount
                    : probe.dimensions?.lastLiveQueryRecordCount ?? null,
                lastLiveQueryAt: item.dimensions?.lastLiveQueryAt || probe.dimensions?.lastLiveQueryAt || null,
                lastSuccessfulLiveQueryAt:
                  item.dimensions?.lastSuccessfulLiveQueryAt || probe.dimensions?.lastSuccessfulLiveQueryAt || null,
                lastSuccessfulRecordCount:
                  item.dimensions?.lastSuccessfulRecordCount !== null && item.dimensions?.lastSuccessfulRecordCount !== undefined
                    ? item.dimensions.lastSuccessfulRecordCount
                    : probe.dimensions?.lastSuccessfulRecordCount ?? null,
                queryProvenance: item.dimensions?.queryProvenance || probe.dimensions?.queryProvenance || "NONE",
                isLive: item.dimensions?.isLive ?? probe.dimensions?.isLive ?? false,
                queryExecuted: Boolean(item.dimensions?.queryExecuted || probe.dimensions?.queryExecuted),
                queryStatus: item.dimensions?.queryStatus || probe.dimensions?.queryStatus,
                queryError: item.dimensions?.queryError || probe.dimensions?.queryError,
              };
              return {
                ...item,
                readiness: probe.status,
                diagnosticStatus: probe.status,
                isReady:
                  probe.status === "CONNECTED" ||
                  probe.status === "SOURCE_ACCESS_VERIFIED" ||
                  probe.status === "LIVE_DATA_VERIFIED",
                readinessReason: probe.reason,
                dimensions: mergedDims,
                diagnostic: {
                  ...item.diagnostic,
                  ...probe,
                  dimensions: mergedDims,
                },
                latestProbe: probe,
              };
            });
          });
        }
      }
    } catch (err) {
      console.error("Failed to test source connections:", err);
    } finally {
      setIsTestingConnections(false);
    }
  };

  // Resilient Research Job Tracking Hook / Poller
  const pollJobExecution = async (runId: string) => {
    currentTrackingRunIdRef.current = runId;
    setActiveRunId(runId);
    setPollingState("POLLING_ACTIVE");
    if (typeof window !== "undefined") {
      sessionStorage.setItem("kh02_active_run_id", runId);
    }

    let attempts = 0;
    const maxAttempts = 120; // Bounded ~3 minute active polling window per check
    const startTime = Date.now();
    let latestLiveness: any = null;

    while (attempts < maxAttempts) {
      if (currentTrackingRunIdRef.current !== runId) {
        return; // Superseded by a newer research run
      }

      await new Promise((r) => setTimeout(r, 1500));
      attempts++;
      const elapsed = Math.round((Date.now() - startTime) / 1000);
      setElapsedSeconds(elapsed);

      if (elapsed >= 45 && !isLongRunningNotice) {
        setIsLongRunningNotice(true);
      }

      try {
        const [runRes, workerRes] = await Promise.all([
          fetch(`/api/v1/kh02/research/runs/${runId}`),
          attempts % 5 === 1 ? fetch("/api/v1/kh02/worker/status").catch(() => null) : null,
        ]);

        if (workerRes && workerRes.ok) {
          const workerJson = await workerRes.json();
          if (workerJson.data?.worker?.status) {
            setWorkerStatus(workerJson.data.worker.status);
          }
        }

        if (runRes.ok) {
          const runJson = await runRes.json();
          const jobData = runJson.data;
          const status = jobData?.status;
          const effState = jobData?.effectiveJobState || status;
          const stage = jobData?.stage || status;
          const progress = jobData?.progress || 0;
          const liveness = jobData?.liveness || null;

          latestLiveness = liveness;
          setRunStage(stage);
          setRunProgress(progress);
          setEffectiveJobState(effState);
          setJobLiveness(liveness);
          if (liveness?.workerStatus) {
            setWorkerStatus(liveness.workerStatus);
          }

          if (status === "COMPLETED" || status === "PARTIALLY_COMPLETED") {
            if (currentTrackingRunIdRef.current === runId) {
              if (jobData?.result) {
                setLeaderboard(jobData.result);
              } else {
                await fetchLatestLeaderboard();
              }
              setViewMode("LEADERBOARD");
              if (typeof window !== "undefined") {
                sessionStorage.removeItem("kh02_active_run_id");
              }
              setActiveRunId(null);
              setEffectiveJobState(status);
              setPollingState("IDLE");
              setIsResearching(false);
              setIsLongRunningNotice(false);
              setResearchError(null);
            }
            return;
          } else if (status === "FAILED" || status === "CANCELED" || effState === "FAILED" || effState === "CANCELED") {
            if (typeof window !== "undefined") {
              sessionStorage.removeItem("kh02_active_run_id");
            }
            setEffectiveJobState(effState);
            setPollingState("IDLE");
            setIsResearching(false);
            setIsLongRunningNotice(false);
            throw new Error(
              jobData?.errorMessage ||
                liveness?.actionableStatusMessage ||
                "Background research job failed."
            );
          } else if (effState === "STALLED" || liveness?.isStalled) {
            // Evidence-backed stall detected: do NOT claim worker is actively processing
            setEffectiveJobState("STALLED");
            setPollingState("IDLE");
            setIsResearching(false);
            setIsLongRunningNotice(false);
            setResearchError(
              liveness?.actionableStatusMessage ||
                `Research job ${runId} is stalled (${liveness?.stallReason || "no recent progress"}). You can start a new research run or check worker health.`
            );
            return;
          }
        }
      } catch (err: any) {
        if (err.message && (err.message.includes("Background research job failed") || err.message.includes("stalled") || err.message.includes("abandoned") || err.message.includes("deadline"))) {
          throw err;
        }
        setPollingState("POLLING_ERROR");
      }
    }

    // Browser polling window timed out — report truthfully based on actual liveness evidence
    setPollingState("POLLING_TIMED_OUT");
    setIsLongRunningNotice(true);
    if (latestLiveness?.isActivelyProcessing) {
      setResearchError(
        `Browser polling window timed out for run ${runId}, while worker ${latestLiveness.workerId || "active"} still holds a valid lease (stage: ${latestLiveness.stage || runStage}, ${latestLiveness.progress ?? runProgress}%). Click "Resume Polling" or reload to check completion.`
      );
    } else {
      setResearchError(
        latestLiveness?.actionableStatusMessage ||
          `Browser polling window timed out for run ${runId}. Active worker processing is not verified (${latestLiveness?.stallReason || "no active lease"}). You can start a new research run or check worker status.`
      );
    }
    setIsResearching(false);
  };

  // Explicit User-Triggered Asynchronous Research Execution
  const executeResearch = async (selectedTopic: string = topic, days: number = lookbackDays) => {
    if (isResearching) return; // Prevent duplicate concurrent submissions

    const cleanTopic = (selectedTopic || "").trim();
    if (!cleanTopic || cleanTopic.length < 2) {
      setResearchError("Please enter a research topic (at least 2 characters).");
      return;
    }

    try {
      setIsResearching(true);
      setResearchError(null);
      setIsLongRunningNotice(false);
      setElapsedSeconds(0);
      setRunProgress(0);
      setRunStage("QUEUED");
      setActiveRunTopic(cleanTopic);
      setActiveRunLookback(days);

      const res = await fetch("/api/v1/kh02/research", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          topic: cleanTopic,
          market: "US",
          lookbackDays: days,
          maxCandidates: 15,
          mode: "async",
        }),
      });

      const json = await res.json();
      if (!res.ok || !json.success) {
        throw new Error(json.error?.message || "Failed to execute evergreen product research.");
      }

      if (res.status === 202 && (json.data?.runId || json.data?.jobId)) {
        const runId = json.data.runId || json.data.jobId;
        await pollJobExecution(runId);
      } else if (json.data?.result) {
        setLeaderboard(json.data.result);
        setViewMode("LEADERBOARD");
        setIsResearching(false);
      } else if (json.data) {
        setLeaderboard(json.data);
        setViewMode("LEADERBOARD");
        setIsResearching(false);
      }
    } catch (err: any) {
      setResearchError(err.message || "Failed to conduct evergreen product research.");
      setIsResearching(false);
    }
  };

  // Fetch Database Stored Products (Catalog)
  const fetchStoredProducts = async () => {
    try {
      setStoredLoading(true);
      const params = new URLSearchParams();
      if (storedSearch.trim()) params.append("query", storedSearch.trim());
      if (storedCategory !== "ALL") params.append("category", storedCategory);

      const res = await fetch(`/api/v1/products?${params.toString()}`);
      const json = await res.json();
      if (json.success) {
        setStoredProducts(json.data);
      }
    } catch (err: any) {
      console.error("Error fetching stored products:", err);
    } finally {
      setStoredLoading(false);
    }
  };

  // On page mount: Restore saved state and check active jobs (NO automatic network research)
  useEffect(() => {
    fetchLatestLeaderboard();
    fetchProviderStatuses();
    fetchStoredProducts();

    // Check worker health status
    fetch("/api/v1/kh02/worker/status")
      .then((res) => res.json())
      .then((json) => {
        if (json.data?.worker?.status) {
          setWorkerStatus(json.data.worker.status);
        }
      })
      .catch(() => {});

    // Check for active running research run in workspace to restore tracking
    const checkActiveRun = async () => {
      try {
        const res = await fetch("/api/v1/kh02/research/active");
        if (res.ok) {
          const json = await res.json();
          if (json.success && json.data) {
            const active = json.data;
            const effState = active.effectiveJobState || active.status;
            const liveness = active.liveness || null;
            setActiveRunId(active.runId);
            setEffectiveJobState(effState);
            setJobLiveness(liveness);
            if (active.topic) {
              setTopic(active.topic);
              setActiveRunTopic(active.topic);
            }
            if (active.lookbackDays) {
              setLookbackDays(active.lookbackDays);
              setActiveRunLookback(active.lookbackDays);
            }
            setRunStage(active.stage || active.status);
            setRunProgress(active.progress || 0);
            if (effState === "STALLED" || liveness?.isStalled) {
              setIsResearching(false);
              setResearchError(
                liveness?.actionableStatusMessage ||
                  `Previous research job ${active.runId} is stalled (${liveness?.stallReason || "lease expired"}). You can start a new research run.`
              );
              return;
            }
            setIsResearching(true);
            pollJobExecution(active.runId);
            return;
          }
        }

        // Fallback: check sessionStorage
        if (typeof window !== "undefined") {
          const savedRunId = sessionStorage.getItem("kh02_active_run_id");
          if (savedRunId) {
            const runRes = await fetch(`/api/v1/kh02/research/runs/${savedRunId}`);
            if (runRes.ok) {
              const runJson = await runRes.json();
              const jobData = runJson.data;
              const status = jobData?.status;
              const effState = jobData?.effectiveJobState || status;
              const liveness = jobData?.liveness || null;
              if (effState === "STALLED" || liveness?.isStalled) {
                sessionStorage.removeItem("kh02_active_run_id");
                setActiveRunId(savedRunId);
                setEffectiveJobState("STALLED");
                setJobLiveness(liveness);
                setIsResearching(false);
                setResearchError(
                  liveness?.actionableStatusMessage ||
                    `Previous research job ${savedRunId} is stalled.`
                );
              } else if (status === "PENDING" || status === "RUNNING") {
                setActiveRunId(savedRunId);
                setEffectiveJobState(effState);
                setJobLiveness(liveness);
                setIsResearching(true);
                pollJobExecution(savedRunId);
              } else {
                sessionStorage.removeItem("kh02_active_run_id");
              }
            }
          }
        }
      } catch (err) {
        console.warn("Failed to check active research run:", err);
      }
    };

    checkActiveRun();
  }, []);

  const getSourceBadge = (sourceKey: string, defaultLabel: string) => {
    const probe = connectionTestResults?.find((p) => p.source === sourceKey);
    const live = providerStatuses.find((p) => p.source === sourceKey);
    const status = probe?.status || live?.diagnosticStatus || live?.readiness || leaderboard?.sourceStatuses?.[sourceKey] || "NOT_CONFIGURED";
    const reason = probe?.reason || live?.readinessReason || live?.diagnostic?.reason || "";

    if (status === "TEMPORARILY_DISABLED") {
      return (
        <span
          className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-md bg-slate-900 border border-slate-700/60 text-slate-400 text-[11px] font-medium"
          title={reason || "Temporarily disabled in KH-02 V12.3; no outbound calls or credentials required"}
        >
          <Clock className="h-3 w-3 text-slate-500" />
          {defaultLabel ? `${defaultLabel}: Tạm tắt` : "Tạm tắt"}
        </span>
      );
    }

    if (status === "TIMEOUT") {
      return (
        <span
          className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-md bg-rose-950/70 border border-rose-500/40 text-rose-300 text-[11px] font-medium"
          title={reason || "Connection probe timed out"}
        >
          <AlertTriangle className="h-3 w-3 text-rose-400" />
          {defaultLabel ? `${defaultLabel}: Timeout` : "Timeout"}
        </span>
      );
    }
    if (status === "FAILED" || status === "TRANSPORT_FAILED" || status === "CONNECTION_FAILED") {
      return (
        <span
          className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-md bg-rose-950/70 border border-rose-500/40 text-rose-300 text-[11px] font-medium"
          title={reason || "Connection probe failed"}
        >
          <AlertTriangle className="h-3 w-3 text-rose-400" />
          {defaultLabel ? `${defaultLabel}: Failed` : "Failed"}
        </span>
      );
    }
    if (status === "CONNECTED" || status === "TRANSPORT_CONNECTED") {
      return (
        <span
          className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-md bg-emerald-950/70 border border-emerald-500/40 text-emerald-300 text-[11px] font-medium"
          title={reason || "Connected: Live connection verified"}
        >
          <CheckCircle2 className="h-3 w-3 text-emerald-400" />
          {defaultLabel ? `${defaultLabel}: Connected` : "Connected"}
        </span>
      );
    }
    if (status === "LIVE_DATA_VERIFIED" || status === "SOURCE_DATA_VERIFIED" || status === "SOURCE_ACCESS_VERIFIED" || status === "PASSED") {
      const label = sourceKey === "META_ADS" ? "Collector Connected" : "Live Verified";
      return (
        <span
          className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-md bg-emerald-950/70 border border-emerald-500/40 text-emerald-300 text-[11px] font-medium"
          title={reason || "Verified: Valid ad observations retrieved"}
        >
          <CheckCircle2 className="h-3 w-3 text-emerald-400" />
          {defaultLabel ? `${defaultLabel}: ${label}` : label}
        </span>
      );
    }
    if (status === "CACHE_ONLY" || status === "MANUAL_ONLY" || status === "MANUAL_RESEARCH_ONLY") {
      return (
        <span
          className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-md bg-amber-950/70 border border-amber-500/40 text-amber-300 text-[11px] font-medium"
          title={reason || "Cache/Manual: Stored competitor ad search active"}
        >
          <AlertTriangle className="h-3 w-3 text-amber-400" />
          {defaultLabel ? `${defaultLabel}: Cache / DB Only` : "Cache / DB Only"}
        </span>
      );
    }
    if (status === "AUTHENTICATION_FAILED") {
      return (
        <span
          className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-md bg-rose-950/70 border border-rose-500/40 text-rose-300 text-[11px] font-medium"
          title={reason || "Authentication Failed: Check API Key"}
        >
          <AlertTriangle className="h-3 w-3 text-rose-400" />
          {defaultLabel ? `${defaultLabel}: Auth Failed` : "Auth Failed"}
        </span>
      );
    }
    if (status === "COST_BLOCKED" || status === "QUOTA_EXCEEDED") {
      return (
        <span
          className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-md bg-rose-950/70 border border-rose-500/40 text-rose-300 text-[11px] font-medium"
          title={reason || "Paid request prevented by zero-cost policy"}
        >
          <AlertTriangle className="h-3 w-3 text-rose-400" />
          {defaultLabel ? `${defaultLabel}: Cost Blocked` : "Cost Blocked"}
        </span>
      );
    }
    if (status === "ENGINE_READY" || (sourceKey === "DEMAND_HISTORY" && (status === "CONFIGURED" || status === "INSUFFICIENT_HISTORY"))) {
      return (
        <span
          className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-md bg-blue-950/70 border border-blue-500/40 text-blue-300 text-[11px] font-medium"
          title={reason || "Engine Ready: Temporal demand policy active"}
        >
          <Clock className="h-3 w-3 text-blue-400" />
          {defaultLabel ? `${defaultLabel}: Engine Ready` : "Engine Ready"}
        </span>
      );
    }
    if (status === "CONFIGURED") {
      return (
        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-md bg-blue-950/70 border border-blue-500/40 text-blue-300 text-[11px] font-medium" title={reason || "Configured; connection not tested"}>
          <Clock className="h-3 w-3 text-blue-400" />
          {defaultLabel ? `${defaultLabel}: Configured (Not Tested)` : "Configured (Not Tested)"}
        </span>
      );
    }
    if (status === "CREDENTIALS_REQUIRED") {
      return (
        <span
          className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-md bg-amber-950/60 border border-amber-500/30 text-amber-300 text-[11px] font-medium"
          title={reason || "Credentials Required: Configure API key"}
        >
          <AlertTriangle className="h-3 w-3 text-amber-400" />
          {defaultLabel ? `${defaultLabel}: Key Required` : "Key Required"}
        </span>
      );
    }
    if (status === "SKIPPED") {
      return (
        <span
          className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-md bg-slate-900 border border-slate-700/50 text-slate-400 text-[11px] font-medium"
          title={reason || "Source unselected for this research run"}
        >
          <Clock className="h-3 w-3 text-slate-500" />
          {defaultLabel ? `${defaultLabel}: Skipped` : "Skipped"}
        </span>
      );
    }
    return (
      <span
        className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-md bg-slate-900 border border-slate-700/50 text-slate-400 text-[11px] font-medium"
        title={reason || "Source not configured"}
      >
        <Clock className="h-3 w-3 text-slate-500" />
        {defaultLabel ? `${defaultLabel}: Not Configured` : "Not Configured"}
      </span>
    );
  };

  const getGeminiAIBadge = () => {
    const ai = leaderboard?.aiTelemetry;
    if (!ai) return null;
    if (ai.aiStatus === "COMPLETED") {
      const modelLabel = ai.actualModelUsed || ai.primaryModelId || "Gemini";
      return (
        <span
          data-testid="kh02-gemini-ai-badge"
          className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-md bg-purple-950/70 border border-purple-500/40 text-purple-300 text-[11px] font-medium"
          title={`Gemini AI: ${modelLabel} (${ai.totalAnalysesCompleted}/${ai.totalAnalysesAttempted} analyzed)`}
        >
          <Sparkles className="h-3 w-3 text-purple-400" />
          <span>Gemini AI: {modelLabel}</span>
          <span className="text-[10px] text-purple-400 font-mono">({ai.totalAnalysesCompleted}/{ai.totalAnalysesAttempted})</span>
        </span>
      );
    }
    if (ai.aiStatus === "PARTIAL") {
      return (
        <span
          data-testid="kh02-gemini-ai-badge"
          className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-md bg-amber-950/70 border border-amber-500/40 text-amber-300 text-[11px] font-medium"
          title={`Gemini AI Partial: ${ai.totalAnalysesCompleted}/${ai.totalAnalysesAttempted}`}
        >
          <AlertTriangle className="h-3 w-3 text-amber-400" />
          <span>Gemini AI: Partial</span>
        </span>
      );
    }
    return (
      <span
        data-testid="kh02-gemini-ai-badge"
        className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-md bg-slate-900 border border-slate-700/50 text-slate-400 text-[11px] font-medium"
        title="Gemini AI: Unavailable; rule-based fallback active"
      >
        <Clock className="h-3 w-3 text-slate-500" />
        <span>Gemini AI: Fallback</span>
      </span>
    );
  };

  return (
    <div className="flex-1 flex flex-col min-h-screen bg-[#0B1020] text-slate-100">
      <Header onImportSuccess={() => fetchStoredProducts()} />

      <main className="p-6 md:p-8 max-w-7xl mx-auto w-full space-y-8">
        {/* Header / Subheader */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-[#1f293d] pb-6">
          <div>
            <div className="flex items-center gap-2 mb-2 flex-wrap">
              <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-purple-950/60 border border-purple-500/30 text-purple-300 text-xs font-semibold">
                <Sparkles className="h-3.5 w-3.5 text-purple-400" />
                <span>SWAI KH-02 V12.4.1 — AI-Powered Product Intelligence</span>
              </div>
              {(runtimeVersion?.frontendBuildSha || runtimeVersion?.backendBuildSha || runtimeVersion?.buildSha || compileTimeFrontendSha) && (
                <span
                  data-testid="kh02-runtime-version-badge"
                  data-release-version={runtimeVersion?.releaseVersion || compileTimeReleaseVersion}
                  data-frontend-sha={runtimeVersion?.frontendBuildSha || compileTimeFrontendSha || ""}
                  data-backend-sha={runtimeVersion?.backendBuildSha || runtimeVersion?.buildSha || ""}
                  data-worker-sha={runtimeVersion?.workerBuildSha || ""}
                  className="text-[11px] font-mono text-slate-400 bg-slate-900 px-2 py-0.5 rounded border border-slate-800"
                >
                  SHA: {(runtimeVersion?.frontendBuildSha || runtimeVersion?.backendBuildSha || runtimeVersion?.buildSha || compileTimeFrontendSha).slice(0, 7)}
                </span>
              )}
              {runtimeVersion?.runtimeStatus && (
                <span
                  data-testid="kh02-runtime-parity-badge"
                  data-runtime-status={runtimeVersion.runtimeStatus}
                  className={`text-[10px] font-mono px-2 py-0.5 rounded border ${
                    runtimeVersion.runtimeStatus === "MATCHED"
                      ? "bg-emerald-950/60 text-emerald-300 border-emerald-700/50"
                      : runtimeVersion.runtimeStatus === "WORKER_OFFLINE"
                      ? "bg-amber-950/60 text-amber-300 border-amber-700/50"
                      : "bg-rose-950/60 text-rose-300 border-rose-700/50"
                  }`}
                  title={runtimeVersion.diagnostics?.join(" | ") || ""}
                >
                  Runtime: {runtimeVersion.runtimeStatus}
                </span>
              )}
            </div>
            <h1 className="text-2xl md:text-3xl font-extrabold text-white tracking-tight flex items-center gap-3">
              <Trophy className="h-7 w-7 text-amber-400" />
              <span>Evergreen Opportunity Leaderboard</span>
            </h1>
            <p className="text-xs md:text-sm text-slate-400 mt-1 max-w-2xl">
              Cross-platform market intelligence across Meta Ads, TikTok Ads, TikTok Organic, and Google Ads Transparency. Identifying sustainable products for a long-term branded Shopify store.
            </p>
          </div>

          {/* View Mode Switcher */}
          <div className="flex items-center bg-[#111827] border border-[#1f293d] p-1 rounded-xl text-xs">
            <button
              onClick={() => setViewMode("LEADERBOARD")}
              className={`px-3 py-1.5 rounded-lg font-medium transition-all ${
                viewMode === "LEADERBOARD"
                  ? "bg-purple-600 text-white shadow"
                  : "text-slate-400 hover:text-white"
              }`}
            >
              Top 3 Leaderboard
            </button>
            <button
              onClick={() => setViewMode("STORED_PRODUCTS")}
              className={`px-3 py-1.5 rounded-lg font-medium transition-all ${
                viewMode === "STORED_PRODUCTS"
                  ? "bg-purple-600 text-white shadow"
                  : "text-slate-400 hover:text-white"
              }`}
            >
              All Researched SKUs ({storedProducts.length})
            </button>
          </div>
        </div>

        {/* Research Filter & Niche Selector */}
        <div className="p-5 rounded-2xl bg-[#161228] border border-[#2e234d] shadow-lg space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-12 gap-3 items-center">
            {/* Topic Input */}
            <div className="md:col-span-6 relative">
              <Search className="h-4 w-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-purple-400" />
              <input
                type="text"
                data-testid="kh02-research-input"
                placeholder="Enter niche or topic (e.g. Pet Gadgets, Home Cleaning, Kitchen Organization)..."
                value={topic}
                onChange={(e) => {
                  isInputDirtyRef.current = true;
                  setTopic(e.target.value);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    const val = e.currentTarget.value.trim();
                    if (val.length >= 2 && !isResearching) {
                      isInputDirtyRef.current = true;
                      executeResearch(val, lookbackDays);
                    }
                  }
                }}
                suppressHydrationWarning
                className="w-full pl-10 pr-4 py-2.5 rounded-xl bg-[#0e0b1c] border border-[#3b2d63] text-sm text-white focus:outline-none focus:border-purple-500 focus:ring-1 focus:ring-purple-500 placeholder-slate-500"
              />
            </div>

            {/* Time Window Selector */}
            <div className="md:col-span-3 flex items-center bg-[#0e0b1c] border border-[#3b2d63] p-1 rounded-xl">
              {[30, 90, 180, 365].map((days) => (
                <button
                  key={days}
                  type="button"
                  data-testid={`kh02-lookback-${days}`}
                  onClick={() => {
                    setLookbackDays(days);
                  }}
                  className={`flex-1 py-1.5 text-xs font-semibold rounded-lg transition-all ${
                    lookbackDays === days
                      ? "bg-purple-600 text-white shadow-sm"
                      : "text-slate-400 hover:text-slate-200"
                  }`}
                >
                  {days}D
                </button>
              ))}
            </div>

            {/* Action Button */}
            <div className="md:col-span-3">
              <button
                type="button"
                data-testid="kh02-analyze-button"
                onClick={() => {
                  const clean = topic.trim();
                  if (clean.length >= 2) {
                    isInputDirtyRef.current = true;
                    executeResearch(clean, lookbackDays);
                  }
                }}
                disabled={isResearching || !topic.trim() || topic.trim().length < 2}
                className="w-full py-2.5 px-4 rounded-xl bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 text-white font-semibold text-xs md:text-sm flex items-center justify-center gap-2 shadow-md transition-all disabled:opacity-50"
              >
                {isResearching ? (
                  <>
                    <RefreshCw className="h-4 w-4 animate-spin" />
                    <span>Analyzing Multi-Source Data...</span>
                  </>
                ) : (
                  <>
                    <Sparkles className="h-4 w-4" />
                    <span>Analyze Evergreen Niche</span>
                  </>
                )}
              </button>
            </div>
          </div>

          {/* Dynamic Source Status Bar */}
          <div data-testid="kh02-source-status-bar" className="pt-3 border-t border-[#2e234d]/60 flex flex-wrap items-center justify-between gap-3 text-xs">
            <div className="flex flex-wrap items-center gap-2 text-slate-400 font-medium">
              <span>Source Status:</span>
              {getSourceBadge("META_ADS", "Meta Ads")}
              {getSourceBadge("TIKTOK_ADS", "TikTok Ads US")}
              {getSourceBadge("TIKTOK_ORGANIC", "TikTok Organic")}
              {getSourceBadge("GOOGLE_ADS", "Google Ads")}
              {getSourceBadge("DEMAND_HISTORY", "Demand History")}
              {getGeminiAIBadge()}
              <button
                data-testid="kh02-discover-sources-button"
                onClick={handleDiscoverSources}
                disabled={isDiscoveringSources}
                className="px-2 py-0.5 rounded-md bg-indigo-900/40 hover:bg-indigo-800/60 border border-indigo-500/30 text-indigo-300 text-[11px] font-medium flex items-center gap-1 transition-all disabled:opacity-50"
                title="Auto-discover zero-key and configured providers without cost"
              >
                <Sparkles className={`h-3 w-3 ${isDiscoveringSources ? "animate-spin" : ""}`} />
                <span>{isDiscoveringSources ? "Discovering..." : "Discover Sources"}</span>
              </button>
              <button
                data-testid="kh02-test-connections-button"
                onClick={handleTestConnections}
                disabled={isTestingConnections}
                className="px-2 py-0.5 rounded-md bg-purple-900/40 hover:bg-purple-800/60 border border-purple-500/30 text-purple-300 text-[11px] font-medium flex items-center gap-1 transition-all disabled:opacity-50"
                title="Run non-metered connection checks across all sources"
              >
                <RefreshCw className={`h-3 w-3 ${isTestingConnections ? "animate-spin" : ""}`} />
                <span>{isTestingConnections ? "Testing..." : "Test Connections"}</span>
              </button>
              <button
                onClick={() => setShowConnectionDetails(!showConnectionDetails)}
                className="px-2 py-0.5 rounded-md bg-[#1f293d] hover:bg-slate-700/60 border border-slate-700/50 text-slate-300 text-[11px] font-medium flex items-center gap-1 transition-all"
                title="Toggle detailed source connection diagnostic panel"
              >
                <Info className="h-3 w-3 text-slate-400" />
                <span>{showConnectionDetails ? "Hide Details" : "Connection Details"}</span>
              </button>
            </div>
            <div className="text-slate-500 text-[11px]">
              Market: <span className="text-slate-300 font-semibold">United States</span> · Zero unapproved credit spend
            </div>
          </div>

          {/* Connection Diagnostics Details Panel */}
          {showConnectionDetails && (
            <div data-testid="kh02-connection-details-panel" className="mt-3 p-4 rounded-xl bg-[#0d1222] border border-purple-500/30 space-y-3 text-xs animate-in fade-in duration-200">
              <div className="flex items-center justify-between border-b border-[#1f293d] pb-2">
                <div className="flex items-center gap-2">
                  <Server className="h-4 w-4 text-purple-400" />
                  <span className="font-bold text-white text-xs md:text-sm">Source Intelligence Connection Diagnostics</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-[10px] text-emerald-400 bg-emerald-950/60 px-2 py-0.5 rounded border border-emerald-500/30">
                    Non-Metered Diagnostics
                  </span>
                  <button
                    onClick={() => setShowConnectionDetails(false)}
                    className="text-slate-400 hover:text-white px-2 py-0.5 rounded bg-slate-800 text-[10px]"
                  >
                    Close
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                {providerStatuses.map((sourceItem) => {
                  const latestProbe = connectionTestResults?.find((t) => t.source === sourceItem.source) || (sourceItem as any).latestProbe;
                  const diag = latestProbe || sourceItem.diagnostic || {};
                  const persistedDims = sourceItem.dimensions || diag.dimensions || {};
                  const probeDims = latestProbe?.dimensions;

                  // Safely merge probe connection/transport/auth diagnostics with persisted research query telemetry
                  const dims = {
                    ...persistedDims,
                    ...(probeDims ? {
                      transportConnected: probeDims.transportConnected ?? persistedDims.transportConnected,
                      transportStatus: probeDims.transportStatus ?? persistedDims.transportStatus,
                      authenticated: probeDims.authenticated ?? persistedDims.authenticated,
                      authStatus: probeDims.authStatus ?? persistedDims.authStatus,
                      capabilityStatus: probeDims.capabilityStatus ?? persistedDims.capabilityStatus,
                      lastProbeAt: probeDims.lastProbeAt ?? persistedDims.lastProbeAt,
                    } : {}),
                    // Always preserve query telemetry from the latest research runs of this workspace:
                    lastLiveQueryRecordCount: persistedDims.lastLiveQueryRecordCount ?? null,
                    lastSuccessfulRecordCount: persistedDims.lastSuccessfulRecordCount ?? null,
                    lastLiveQueryAt: persistedDims.lastLiveQueryAt ?? null,
                    lastSuccessfulLiveQueryAt: persistedDims.lastSuccessfulLiveQueryAt ?? null,
                    queryExecuted: Boolean(persistedDims.queryExecuted),
                    queryStatus: persistedDims.queryStatus,
                    queryProvenance: persistedDims.queryProvenance,
                    isLive: persistedDims.isLive,
                    queryError: persistedDims.queryError,
                  };
                  const cost = diag.estimatedQueryCost || sourceItem.diagnostic?.estimatedQueryCost || {};
                  const isMeta = sourceItem.source === "META_ADS";
                  const isGoogle = sourceItem.source === "GOOGLE_ADS";
                  const isDemand = sourceItem.source === "DEMAND_HISTORY";
                  const isOrganic = sourceItem.source === "TIKTOK_ORGANIC";
                  const isTikTokAds = sourceItem.source === "TIKTOK_ADS";
                  const isTikTok = isOrganic || isTikTokAds;
                  const sourceConfigured = isDemand ? diag.upstreamConfigured === true : diag.configured;

                  // Check if tested just now (exclude disabled TikTok)
                  const justTested = Boolean(latestProbe) && !isTikTok;

                  // Truthful auth rendering
                  let authDisplay = "Not Tested";
                  let authClass = "text-slate-400";
                  const aStatus = latestProbe?.authStatus || dims.authStatus;
                  if (isTikTok) {
                    authDisplay = "Tạm tắt (Chính sách)";
                    authClass = "text-slate-500 font-medium";
                  } else if (aStatus === "AUTH_NOT_REQUIRED" || (dims.authenticated === null && (isMeta || isGoogle || isDemand))) {
                    authDisplay = isMeta ? "Not Required (Local stdio)" : isGoogle ? "Not Required (MCP stdio)" : isDemand ? "Not Required (Engine)" : "Not Required";
                    authClass = "text-slate-300";
                  } else if (aStatus === "CREDENTIALS_REQUIRED" || (!diag.configured && (isOrganic || isTikTokAds))) {
                    authDisplay = "Credentials Required";
                    authClass = "text-amber-400 font-medium";
                  } else if (aStatus === "AUTHENTICATION_FAILED" || dims.authenticated === false || latestProbe?.status === "FAILED") {
                    authDisplay = "Failed (Check Key)";
                    authClass = "text-rose-400 font-medium";
                  } else if (dims.authenticated === true || aStatus === "AUTHENTICATED") {
                    authDisplay = "Authenticated";
                    authClass = "text-emerald-400 font-medium";
                  }

                  // Truthful transport rendering: Connected, Failed, Timeout, Not Configured, Not Tested, Tạm tắt
                  let transportDisplay = "Not Tested";
                  let transportClass = "text-slate-400";
                  const tStatus = latestProbe?.status === "TIMEOUT" ? "TIMEOUT" : (dims.transportStatus || latestProbe?.transportStatus);

                  if (isTikTok) {
                    transportDisplay = "Tạm tắt";
                    transportClass = "text-slate-500 font-medium";
                  } else if (tStatus === "TIMEOUT" || latestProbe?.status === "TIMEOUT") {
                    transportDisplay = "Timeout";
                    transportClass = "text-rose-400 font-semibold";
                  } else if (tStatus === "CONNECTED" || tStatus === "TRANSPORT_CONNECTED" || dims.transportConnected === true || (latestProbe && (latestProbe.status === "CONNECTED" || latestProbe.status === "SOURCE_ACCESS_VERIFIED"))) {
                    transportDisplay = "Connected";
                    transportClass = "text-emerald-400 font-medium";
                  } else if (tStatus === "TRANSPORT_FAILED" || dims.transportConnected === false || latestProbe?.status === "FAILED") {
                    transportDisplay = "Failed";
                    transportClass = "text-rose-400 font-medium";
                  } else if (!diag.configured || tStatus === "NOT_CONFIGURED") {
                    transportDisplay = "Not Configured";
                    transportClass = "text-slate-500";
                  } else {
                    transportDisplay = "Not Tested";
                    transportClass = "text-slate-400";
                  }

                  const storedCount =
                    typeof dims.storedRecordCount === "number"
                      ? dims.storedRecordCount
                      : typeof diag.recordsReturned === "number"
                      ? diag.recordsReturned
                      : 0;

                  const lastLiveCount =
                    typeof dims.lastLiveQueryRecordCount === "number"
                      ? dims.lastLiveQueryRecordCount
                      : typeof (sourceItem as any).lastLiveQueryRecordCount === "number"
                      ? (sourceItem as any).lastLiveQueryRecordCount
                      : null;

                  return (
                    <div
                      key={sourceItem.source}
                      className="p-3 rounded-lg bg-[#141b2d] border border-slate-800/80 space-y-2"
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-1.5">
                          <span className="font-semibold text-slate-200">{sourceItem.displayName || sourceItem.source}</span>
                          {justTested && (
                            <span className="text-[9px] px-1 rounded bg-purple-900/60 text-purple-300 border border-purple-500/30">
                              Tested Now
                            </span>
                          )}
                        </div>
                        {getSourceBadge(sourceItem.source, "")}
                      </div>

                      <div className="space-y-1 text-[11px] text-slate-400">
                        <div className="flex justify-between">
                          <span>{isDemand ? "Live provider:" : "Configuration:"}</span>
                          <span className={isTikTok ? "text-slate-500 font-medium" : sourceConfigured ? "text-emerald-400" : "text-amber-400 font-medium"}>
                            {isTikTok ? "Tạm tắt" : sourceConfigured ? "Configured" : "Missing"}
                          </span>
                        </div>
                        <div className="flex justify-between">
                          <span>Transport:</span>
                          <span className={transportClass}>
                            {transportDisplay}
                          </span>
                        </div>
                        <div className="flex justify-between">
                          <span>Authentication:</span>
                          <span className={authClass}>
                            {authDisplay}
                          </span>
                        </div>
                        {isDemand && (
                          <div className="flex justify-between">
                            <span>Engine:</span>
                            <span className="text-blue-400 font-medium">Ready (Temporal Policy)</span>
                          </div>
                        )}
                        <div className="flex justify-between">
                          <span>Stored Records:</span>
                          <span className="text-slate-300 font-mono">
                            {storedCount}
                          </span>
                        </div>
                        <div className="flex justify-between">
                          <span>Last Live Query:</span>
                          <span className="font-mono">
                            {isTikTok ? (
                              <span className="text-slate-500 font-medium">Tạm tắt</span>
                            ) : (() => {
                              // 1. Live attempt failed
                              const liveFailed =
                                dims.liveSucceeded === false ||
                                (Boolean(dims.liveAttempted) && Boolean(dims.liveError || dims.queryError)) ||
                                ((dims.queryStatus === "FAILED" ||
                                  dims.queryStatus === "QUERY_FAILED" ||
                                  dims.queryStatus === "BLOCKED_SOURCE" ||
                                  dims.queryStatus === "TRANSPORT_FAILED" ||
                                  dims.queryStatus === "AUTHENTICATION_FAILED") &&
                                  !dims.lastSuccessfulLiveQueryAt &&
                                  dims.lastLiveQueryRecordCount === null);

                              if (liveFailed) {
                                const err = dims.liveError || dims.queryError || "Query failed";
                                return (
                                  <span
                                    className="text-rose-400"
                                    title={dims.lastLiveQueryAt ? `Failed at ${dims.lastLiveQueryAt}: ${err}` : err}
                                  >
                                    Failed{err ? `: ${err.slice(0, 20)}...` : ""}
                                  </span>
                                );
                              }

                              // 2. Upstream live event record count (truthfully reported)
                              const liveCount =
                                typeof dims.lastLiveQueryRecordCount === "number"
                                  ? dims.lastLiveQueryRecordCount
                                  : null;

                              if (liveCount !== null) {
                                if (liveCount > 0) {
                                  return (
                                    <span
                                      className="text-emerald-400 font-semibold"
                                      title={dims.lastLiveQueryAt ? `Executed at ${dims.lastLiveQueryAt}` : undefined}
                                    >
                                      {liveCount} records
                                    </span>
                                  );
                                }
                                return (
                                  <span
                                    className="text-slate-300"
                                    title={dims.lastLiveQueryAt ? `Executed at ${dims.lastLiveQueryAt} (0 records returned)` : "0 records returned"}
                                  >
                                    0 records
                                  </span>
                                );
                              }

                              // 3. Fallback: queryExecuted with isLive
                              if (dims.isLive && dims.queryExecuted) {
                                return <span className="text-slate-300">0 records</span>;
                              }

                              return <span className="text-slate-500">Not Run</span>;
                            })()}
                          </span>
                        </div>
                        {((typeof dims.cachedRecordsCount === "number" && dims.cachedRecordsCount > 0) || dims.queryProvenance === "CACHED_SOURCE") && (
                          <div className="flex justify-between text-xs text-amber-400/90 pt-0.5">
                            <span>Cache Used:</span>
                            <span
                              className="font-mono bg-amber-500/10 px-1.5 py-0.5 rounded border border-amber-500/20 text-amber-300"
                              title="Retrieved from persistent SQLite cache for research discovery"
                            >
                              Cache ({dims.cachedRecordsCount ?? storedCount} records)
                            </span>
                          </div>
                        )}
                        <div className="flex justify-between">
                          <span>Query Cost:</span>
                          <span className="text-slate-300">
                            {cost.isPaid ? `${cost.estimatedCredits || 10} ${isDemand ? "Searches" : "Credits"}/query` : "Free Zero-Cost"}
                          </span>
                        </div>
                      </div>

                      {isTikTok ? (
                        <p className="text-[10px] text-slate-500 bg-slate-900/40 p-1.5 rounded border border-slate-800/60">
                          Tạm tắt trong bản phát hành KH-02 V12.3 theo chính sách. Không yêu cầu key hay cookie.
                        </p>
                      ) : (
                        <>
                          {diag.reason && (
                            <p className="text-[10px] text-slate-400 bg-slate-900/60 p-1.5 rounded border border-slate-800">
                              {diag.reason}
                            </p>
                          )}
                          {diag.requiredAction && (
                            <p className="text-[10px] text-amber-300/90 font-medium">
                              Next Step: {diag.requiredAction}
                            </p>
                          )}
                          <ProviderSetupGuide source={sourceItem.source} />
                        </>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        {/* Active Research Progress Panel */}
        {isResearching && (
          <div data-testid="kh02-research-progress-panel" className="p-5 rounded-2xl bg-[#161228] border border-purple-500/40 shadow-xl space-y-3">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-2 border-b border-[#2e234d] pb-3">
              <div className="flex items-center gap-2">
                <RefreshCw className="h-4 w-4 text-purple-400 animate-spin" />
                <span className="text-sm font-bold text-white">
                  Researching: <span className="text-purple-300">{activeRunTopic || topic}</span>
                </span>
                <span className="px-2 py-0.5 rounded text-[11px] font-semibold bg-purple-900/60 border border-purple-500/40 text-purple-200">
                  {activeRunLookback || lookbackDays}D Lookback · US
                </span>
              </div>
              <div className="flex items-center gap-3 text-xs">
                <span className="text-slate-400">
                  Worker:{" "}
                  <span
                    className={`font-semibold ${
                      workerStatus === "ALIVE"
                        ? "text-emerald-400"
                        : workerStatus === "OFFLINE"
                        ? "text-amber-400"
                        : "text-slate-400"
                    }`}
                  >
                    {workerStatus}
                  </span>
                </span>
                <span className="text-slate-400">
                  Elapsed: <span className="text-white font-mono">{elapsedSeconds}s</span>
                </span>
              </div>
            </div>

            {/* Stage tracker */}
            <div className="space-y-1.5">
              <div className="flex justify-between text-xs">
                <span className="text-slate-300 font-medium">
                  Stage: <span className="text-purple-300 uppercase font-semibold">{runStage || "INITIALIZING"}</span>
                </span>
                <span className="text-slate-400 font-mono">{runProgress}%</span>
              </div>
              <div className="w-full bg-[#0e0b1c] rounded-full h-2 border border-[#3b2d63]">
                <div
                  className="bg-gradient-to-r from-purple-500 to-indigo-500 h-2 rounded-full transition-all duration-500"
                  style={{ width: `${Math.max(runProgress, 8)}%` }}
                />
              </div>
            </div>

            {/* Long running friendly notice */}
            {isLongRunningNotice && (
              <div className="p-3 rounded-xl bg-indigo-950/40 border border-indigo-500/30 text-xs text-indigo-300 flex items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <Clock className="h-4 w-4 text-indigo-400 shrink-0" />
                  <span>Research is continuing in the background. You can leave this page or switch tabs; your job is safely tracked.</span>
                </div>
              </div>
            )}

            {/* Worker offline warning */}
            {workerStatus === "OFFLINE" && (runStage === "QUEUED" || runStage === "PENDING") && (
              <div className="p-3 rounded-xl bg-amber-950/50 border border-amber-500/40 text-xs text-amber-300 flex items-center gap-2">
                <AlertTriangle className="h-4 w-4 text-amber-400 shrink-0" />
                <span>
                  Research is queued waiting for a worker. Start <code className="px-1.5 py-0.5 rounded bg-amber-900/60 font-mono text-amber-200">npm run kh02:worker</code> or <code className="px-1.5 py-0.5 rounded bg-amber-900/60 font-mono text-amber-200">npm run dev:all</code> to begin processing.
                </span>
              </div>
            )}
          </div>
        )}

        {/* Error / Stalled / Polling Timeout Notification */}
        {researchError && (
          <div
            data-testid="kh02-job-status-banner"
            data-effective-job-state={effectiveJobState || "ERROR"}
            data-polling-state={pollingState}
            className="p-4 rounded-xl bg-red-950/40 border border-red-800/40 text-sm text-red-300 flex items-center justify-between gap-3"
          >
            <div className="flex items-center gap-3">
              <AlertCircle className="h-5 w-5 text-red-400 shrink-0" />
              <span>{researchError}</span>
            </div>
            {activeRunId && (pollingState === "POLLING_TIMED_OUT" || effectiveJobState === "STALLED") && (
              <button
                type="button"
                onClick={() => {
                  setResearchError(null);
                  setIsResearching(true);
                  pollJobExecution(activeRunId);
                }}
                className="px-3 py-1 rounded-lg bg-red-900/60 hover:bg-red-800 text-xs text-red-100 font-semibold shrink-0 border border-red-600/40"
              >
                Check Status
              </button>
            )}
          </div>
        )}

        {/* Historical Snapshot Notice when a newer run is active, stalled, or failed */}
        {leaderboard && activeRunId && leaderboard.researchRunId !== activeRunId && (
          <div
            data-testid="kh02-last-completed-research-banner"
            data-snapshot-run-id={leaderboard.researchRunId}
            data-active-run-id={activeRunId}
            className="p-3.5 rounded-xl bg-amber-950/50 border border-amber-500/40 text-xs text-amber-200 flex flex-col sm:flex-row sm:items-center justify-between gap-2"
          >
            <div className="flex items-center gap-2">
              <Clock className="h-4 w-4 text-amber-400 shrink-0" />
              <span className="font-bold uppercase tracking-wide text-amber-300">
                LAST COMPLETED RESEARCH
              </span>
              <span className="text-amber-100">
                — Showing saved snapshot for topic &quot;{leaderboard.topic}&quot; while job <code className="font-mono text-amber-300">{activeRunId}</code> is {effectiveJobState || (isResearching ? "RUNNING" : "STALLED")}.
              </span>
            </div>
            <div className="text-[11px] font-mono text-amber-300/90 shrink-0">
              Snapshot ID: {leaderboard.researchRunId} {leaderboard.generatedAt ? `· ${new Date(leaderboard.generatedAt).toLocaleString()}` : ""}
            </div>
          </div>
        )}

        {/* VIEW MODE 1: LEADERBOARD PRESENTATION */}
        {viewMode === "LEADERBOARD" && (
          <div className="space-y-8">
            {/* Top 3 Section Title */}
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-lg font-extrabold text-white flex items-center gap-2">
                  <Medal className="h-5 w-5 text-amber-400" />
                  <span>Top 3 Evidence-Qualified Evergreen Products</span>
                </h2>
                <p className="text-xs text-slate-400 mt-0.5">
                  Strictly gated on verified long-term demand stability (≥15/25 pts), multi-month coverage, and high confidence (≥65%).
                </p>
              </div>
              {leaderboard && (
                <div className="text-right">
                  <div data-testid="kh02-candidate-funnel-summary" className="text-xs text-purple-400 font-mono">
                    {leaderboard.candidateFunnel ? (
                      <span>
                        {leaderboard.candidateFunnel.rawCandidateGroups} raw groups · {leaderboard.candidateFunnel.relevantCandidates + (leaderboard.candidateFunnel.probablyRelevantCandidates || 0)} eligible · {leaderboard.candidateFunnel.candidatesActuallyScored} scored · {leaderboard.candidateFunnel.identitiesVerified} verified
                      </span>
                    ) : (
                      <span>{leaderboard.totalCandidatesDiscovered} candidate groups discovered</span>
                    )}
                  </div>
                  <div
                    data-testid="kh02-authoritative-run-meta"
                    data-research-run-id={leaderboard.researchRunId}
                    className="text-[10px] text-slate-500 font-mono mt-0.5"
                  >
                    Run: {leaderboard.researchRunId} · Formula V{leaderboard.formulaVersion}
                  </div>
                </div>
              )}
            </div>

            {/* TOP 3 PODIUM CONTAINER */}
            {isResearching && (!leaderboard || leaderboard.topThree.length === 0) ? (
              <div className="p-16 rounded-2xl bg-[#161228] border border-[#2e234d] text-center space-y-4">
                {isResearching ? (
                  <>
                    <RefreshCw className="h-8 w-8 text-purple-400 animate-spin mx-auto" />
                    <p className="text-sm font-semibold text-white">Aggregating cross-platform intelligence...</p>
                    <p className="text-xs text-slate-500 max-w-md mx-auto">
                      Inspecting Meta ad observations, TikTok video metrics, Google advertiser domains, and historical demand time series.
                    </p>
                  </>
                ) : (
                  <div data-testid="kh02-empty-state">
                    <ShoppingBag className="h-8 w-8 text-slate-500 mx-auto" />
                    <p className="text-sm font-semibold text-white">No Evergreen Winners Available Yet</p>
                    <p className="text-xs text-slate-500 max-w-md mx-auto">
                      Select a niche above and click &quot;Analyze Evergreen Niche&quot; to discover top products.
                    </p>
                  </div>
                )}
              </div>
            ) : leaderboard && leaderboard.topThree.length > 0 ? (
              <div data-testid="kh02-leaderboard-container" className="space-y-4">
                {leaderboard.topThree.map((item) => {
                  const rank = item.rank || 1;
                  const isGold = rank === 1;
                  const isSilver = rank === 2;

                  const borderColor = isGold
                    ? "border-[#F4C95D] shadow-[0_0_25px_rgba(244,201,93,0.15)]"
                    : isSilver
                    ? "border-[#66C9EB] shadow-[0_0_20px_rgba(102,201,235,0.15)]"
                    : "border-[#F48B87] shadow-[0_0_20px_rgba(244,139,135,0.15)]";

                  const badgeBg = isGold
                    ? "bg-[#F4C95D] text-black font-extrabold"
                    : isSilver
                    ? "bg-[#66C9EB] text-black font-extrabold"
                    : "bg-[#F48B87] text-black font-extrabold";

                  const rankLabel = isGold ? "#1 EVERGREEN WINNER" : isSilver ? "#2 STRONG CONTENDER" : "#3 VIABLE OPPORTUNITY";

                  return (
                    <div
                      key={item.candidate.candidateId}
                      data-testid="kh02-ranked-product-card"
                      data-candidate-id={item.candidate.candidateId}
                      data-opportunity-score={item.score?.opportunityScore ?? 0}
                      data-rank={rank}
                      data-confidence={item.score?.evidenceConfidence ?? ""}
                      data-confidence-status={item.score?.scoreStatus ?? ""}
                      className={`p-5 rounded-2xl bg-[#1D1733] border-2 ${borderColor} transition-all flex flex-col md:flex-row items-center gap-6 justify-between`}
                    >
                      {/* Left: Thumbnail & Video Trigger */}
                      <div className="flex items-center gap-4 w-full md:w-auto">
                        <div
                          onClick={() => {
                            if (item.candidate.videoUrl || item.candidate.thumbnailUrl) {
                              setActiveMediaItem({
                                title: item.candidate.title,
                                videoUrl: item.candidate.videoUrl,
                                thumbnailUrl: item.candidate.thumbnailUrl,
                                sourceUrl: item.candidate.canonicalProductUrl,
                                platform: item.candidate.supportingSourceTypes[0] || "Meta",
                              });
                            }
                          }}
                          className="relative shrink-0 w-24 h-24 md:w-32 md:h-32 rounded-xl overflow-hidden bg-slate-950 border border-slate-800 cursor-pointer group"
                        >
                          {item.candidate.thumbnailUrl && !isStockImage(item.candidate.thumbnailUrl) ? (
                            <img
                              src={item.candidate.thumbnailUrl}
                              alt={item.candidate.title}
                              className="w-full h-full object-cover group-hover:scale-105 transition-transform"
                            />
                          ) : (
                            <div className="w-full h-full flex items-center justify-center bg-purple-950/40 text-purple-300">
                              <ShoppingBag className="h-8 w-8 text-purple-400" />
                            </div>
                          )}
                          {/* Rank Badge */}
                          <div className={`absolute top-2 left-2 px-2 py-0.5 rounded text-[11px] ${badgeBg}`}>
                            #{rank}
                          </div>
                          {/* Video Play Overlay */}
                          {item.candidate.videoUrl ? (
                            <div className="absolute inset-0 flex items-center justify-center bg-black/40 group-hover:bg-black/20 transition-all">
                              <div className="w-8 h-8 rounded-full bg-purple-600/90 text-white flex items-center justify-center shadow-lg">
                                <Play className="h-4 w-4 fill-white" />
                              </div>
                            </div>
                          ) : (
                            <div className="absolute bottom-1 right-1 px-1.5 py-0.5 rounded bg-black/60 text-[9px] text-slate-300 opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-1">
                              <Eye className="h-2.5 w-2.5" /> Preview
                            </div>
                          )}
                        </div>

                        {/* Title & Core Problem */}
                        <div className="space-y-1.5 flex-1">
                          <div className="flex items-center gap-2">
                            <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-purple-950 text-purple-300 border border-purple-800/40">
                              {rankLabel}
                            </span>
                            <span className="text-[11px] text-slate-400 font-medium">
                              {item.candidate.category}
                            </span>
                            {item.candidate.identityStatus && (
                              <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium border ${
                                item.candidate.identityStatus === "VERIFIED"
                                  ? "bg-emerald-950/60 text-emerald-300 border-emerald-800/40"
                                  : item.candidate.identityStatus === "PROBABLE"
                                  ? "bg-blue-950/60 text-blue-300 border-blue-800/40"
                                  : "bg-amber-950/60 text-amber-300 border-amber-800/40"
                              }`}>
                                {item.candidate.identityStatus === "VERIFIED"
                                  ? "Verified Product"
                                  : item.candidate.identityStatus === "PROBABLE"
                                  ? "Probable Product"
                                  : "Needs Review"}
                              </span>
                            )}
                            {item.candidate.aiIntelligence && (
                              <span className="text-[10px] px-1.5 py-0.5 rounded font-medium bg-purple-950/60 text-purple-300 border border-purple-800/40">
                                AI: {item.candidate.aiIntelligence.commercialEntityType}
                              </span>
                            )}
                          </div>
                          <h3 className={`text-base md:text-lg font-bold leading-tight ${
                            item.candidate.identityStatus === "UNRESOLVED" || item.candidate.title.startsWith("Unidentified Product")
                              ? "text-amber-200/90 font-mono text-sm"
                              : "text-white"
                          }`}>
                            {item.candidate.title}
                          </h3>

                          {item.candidate.problemStatement && (
                            <p className="text-xs text-slate-300 line-clamp-2">
                              <span className="text-purple-400 font-semibold">Problem:</span> {item.candidate.problemStatement}
                            </p>
                          )}

                          {(item.candidate as any)?.psychologyProfile && (
                            <div className="mt-2 p-2.5 rounded-lg bg-purple-950/30 border border-purple-800/30 text-[11px] space-y-1">
                              <div className="flex items-center justify-between text-purple-300 font-semibold text-[10px]">
                                <span>Customer Psychology & Angle</span>
                                <span className="text-[9px] px-1.5 py-0.5 rounded bg-purple-900/60 text-purple-200">
                                  {(item.candidate as any).psychologyProfile?.functionalProblem?.status}
                                </span>
                              </div>
                              <p className="text-slate-300 text-[11px]">
                                <span className="text-purple-400 font-medium">Target:</span> {(item.candidate as any).psychologyProfile?.targetCustomer?.claimText}
                              </p>
                              <p className="text-slate-300 text-[11px]">
                                <span className="text-purple-400 font-medium">Hook:</span> {(item.candidate as any).psychologyProfile?.suggestedMessagingAngle?.claimText}
                              </p>
                              <p className="text-slate-500 text-[9px] italic pt-0.5">
                                * {(item.candidate as any).psychologyProfile?.unverifiedBusinessMetricsDisclaimer}
                              </p>
                            </div>
                          )}

                          <div className="flex flex-wrap items-center gap-2 pt-1 text-[11px]">
                            {item.candidate.storeDomain && (
                              <span className="inline-flex items-center gap-1 text-slate-400">
                                <Store className="h-3 w-3 text-indigo-400" />
                                {item.candidate.storeDomain}
                              </span>
                            )}
                            <span className="text-slate-600">•</span>
                            <span className="text-slate-400">
                              {item.candidate.distinctAdvertisersCount} active advertiser(s)
                            </span>
                            <span className="text-slate-600">•</span>
                            <span className="text-purple-300">
                              {item.candidate.supportingSourceTypes.join(", ")}
                            </span>
                          </div>
                        </div>
                      </div>

                      {/* Right: Scores & Action */}
                      <div className="flex items-center justify-between md:justify-end gap-6 w-full md:w-auto pt-4 md:pt-0 border-t md:border-t-0 border-[#2e234d]">
                        {/* Score Metric */}
                        <div className="text-center md:text-right">
                          <span className="text-[10px] text-slate-400 block font-medium">Evergreen Score</span>
                          <span className="text-2xl md:text-3xl font-black text-white font-mono">
                            {item.score.opportunityScore ?? "—"}<span className="text-xs text-slate-500">/100</span>
                          </span>
                          <div className="text-[10px] text-emerald-400 font-semibold mt-0.5">
                            {item.score.demandClass.replace("_", " ")}
                          </div>
                        </div>

                        {/* Evidence Confidence */}
                        <div className="text-center md:text-right">
                          <span className="text-[10px] text-slate-400 block font-medium">Confidence</span>
                          <span className="text-lg md:text-xl font-extrabold text-purple-300 font-mono">
                            {item.score.evidenceConfidence}%
                          </span>
                          <span className="text-[10px] text-emerald-400 block font-semibold">
                            {item.score.scoreStatus}
                          </span>
                        </div>

                        {/* Intelligence Action */}
                        <div>
                          {item.candidate.researchProductId ? (
                            <Link
                              href={`/products/${item.candidate.researchProductId}/intelligence`}
                              className="py-2.5 px-4 rounded-xl bg-purple-600 hover:bg-purple-500 text-white font-semibold text-xs flex items-center gap-1.5 shadow-md transition-all whitespace-nowrap"
                            >
                              <span>Inspect Analysis</span>
                              <ChevronRight className="h-4 w-4" />
                            </Link>
                          ) : (
                            <button
                              onClick={() => setInspectCandidate(item)}
                              className="py-2.5 px-4 rounded-xl bg-slate-800 hover:bg-slate-700 text-purple-300 border border-purple-500/30 font-semibold text-xs flex items-center gap-1.5 shadow-md transition-all whitespace-nowrap"
                            >
                              <span>Inspect Candidate</span>
                              <SlidersHorizontal className="h-3.5 w-3.5" />
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div data-testid="kh02-empty-state" className="p-8 rounded-2xl bg-[#161228] border border-amber-500/30 text-center space-y-3">
                <AlertTriangle className="h-7 w-7 text-amber-400 mx-auto" />
                <h3 className="text-sm font-bold text-white">
                  No verified evergreen winners yet for &quot;{leaderboard?.topic || activeRunTopic || topic.trim() || "Pet Gadgets"}&quot;
                </h3>
                {Boolean(topic.trim() && leaderboard?.topic && topic.trim().toLowerCase() !== leaderboard.topic.toLowerCase()) && (
                  <p className="text-[11px] text-slate-400 font-normal">
                    (Kết quả lần tìm trước: &quot;{leaderboard?.topic}&quot;)
                  </p>
                )}
                <p className="text-xs text-slate-400 max-w-lg mx-auto leading-relaxed">
                  To protect against false evergreen claims, candidates require proven non-declining multi-month historical demand stability (≥15/25 pts) and high evidence confidence (≥65%). Promising products are shown under Provisional Opportunities below.
                </p>
              </div>
            )}

            {/* TOP 3 PRODUCTS TO EVALUATE — RESEARCH SHORTLIST */}
            {leaderboard && (
              <div data-testid="kh02-research-shortlist-section" className="space-y-4 pt-6 border-t border-[#1f293d]">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                  <div>
                    <div className="flex items-center gap-2">
                      <Sparkles className="h-4 w-4 text-amber-400" />
                      <h3 className="text-sm font-bold text-white">
                        Top 3 Products to Evaluate
                      </h3>
                      <span className="text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-300 border border-amber-500/30 font-semibold">
                        Research Shortlist — Further Validation Required
                      </span>
                    </div>
                    <p className="text-[11px] text-slate-400 mt-0.5">
                      Identifiable, niche-relevant product candidates discovered from current advertising evidence for business evaluation. Does not imply verified evergreen demand.
                    </p>
                  </div>
                  {leaderboard.researchShortlist && (
                    <span className="text-[11px] font-mono text-amber-400 shrink-0">
                      {leaderboard.researchShortlist.qualifiedCount} of {leaderboard.researchShortlist.requestedCount} qualified
                    </span>
                  )}
                </div>

                {/* Shortfall Notice if fewer than 3 qualify */}
                {leaderboard.researchShortlist?.shortfallReason && (
                  <div data-testid="kh02-shortlist-shortfall-notice" className="p-3 rounded-lg bg-amber-950/40 border border-amber-500/30 text-amber-200 text-xs flex items-center gap-2">
                    <Info className="h-4 w-4 text-amber-400 shrink-0" />
                    <span>{leaderboard.researchShortlist.shortfallReason}</span>
                  </div>
                )}

                {leaderboard.researchShortlist?.shortlist && leaderboard.researchShortlist.shortlist.length > 0 ? (
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    {leaderboard.researchShortlist.shortlist.map((candidate: any, idx: number) => (
                      <div
                        key={candidate.candidateId}
                        data-testid="kh02-research-shortlist-card"
                        data-candidate-id={candidate.candidateId}
                        data-shortlist-rank={idx + 1}
                        className="p-4 rounded-xl bg-[#161228] border border-amber-500/30 hover:border-amber-400/60 transition-all flex flex-col justify-between space-y-3"
                      >
                        <div className="space-y-3">
                          <div className="flex items-start gap-3">
                            <div
                              onClick={() => {
                                if (candidate.videoUrl || candidate.thumbnailUrl) {
                                  setActiveMediaItem({
                                    title: candidate.title,
                                    videoUrl: candidate.videoUrl,
                                    thumbnailUrl: candidate.thumbnailUrl,
                                    sourceUrl: candidate.canonicalProductUrl,
                                    platform: candidate.supportingSourceTypes?.[0] || "Meta",
                                  });
                                }
                              }}
                              className="relative shrink-0 w-16 h-16 rounded-lg overflow-hidden bg-slate-950 border border-slate-800 cursor-pointer"
                            >
                              {candidate.thumbnailUrl && !isStockImage(candidate.thumbnailUrl) ? (
                                <img src={candidate.thumbnailUrl} alt={candidate.title} className="w-full h-full object-cover" />
                              ) : (
                                <ShoppingBag className="h-6 w-6 text-amber-400 m-auto mt-5" />
                              )}
                              <span className="absolute top-1 left-1 px-1.5 py-0.5 rounded bg-amber-500/90 text-black font-black text-[9px]">
                                #{idx + 1}
                              </span>
                            </div>

                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-1.5 flex-wrap">
                                <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-800 text-slate-300 font-mono">
                                  {candidate.identityStatus || "PROVISIONAL"}
                                </span>
                                <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-950/80 text-emerald-300 font-medium">
                                  {candidate.relevanceStatus || "RELEVANT"}
                                </span>
                                {candidate.aiIntelligence && (
                                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-purple-950/80 text-purple-300 font-medium">
                                    AI: {candidate.aiIntelligence.commercialEntityType}
                                  </span>
                                )}
                              </div>
                              <h4 className="text-xs font-bold text-white mt-1 line-clamp-2">
                                {candidate.canonicalProductName || candidate.displayName || candidate.title}
                              </h4>
                              {candidate.storeDomain && (
                                <p className="text-[11px] text-slate-400 flex items-center gap-1 mt-0.5 truncate">
                                  <Store className="h-3 w-3 text-amber-400 shrink-0" />
                                  <span>{candidate.storeDomain}</span>
                                </p>
                              )}
                            </div>
                          </div>

                          <div className="space-y-1.5 text-[11px] bg-slate-950/40 p-2.5 rounded-lg border border-slate-800/60">
                            {candidate.canonicalProductUrl && (
                              <div className="flex items-center justify-between text-slate-400">
                                <span className="text-slate-500">URL:</span>
                                <a
                                  href={candidate.canonicalProductUrl}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="text-amber-400 hover:underline flex items-center gap-1 truncate max-w-[180px]"
                                >
                                  <span className="truncate">{candidate.canonicalProductUrl.replace(/^https?:\/\//, '')}</span>
                                  <ExternalLink className="h-3 w-3 shrink-0" />
                                </a>
                              </div>
                            )}
                            <div className="flex items-center justify-between text-slate-400">
                              <span className="text-slate-500">Ad Evidence:</span>
                              <span className="font-mono text-slate-300">
                                {candidate.supportingAdIds?.length || 0} ads ({candidate.supportingSourceTypes?.join(", ") || "Meta"})
                              </span>
                            </div>
                            <div className="flex items-center justify-between text-slate-400">
                              <span className="text-slate-500">Distinctness:</span>
                              <span className="text-slate-300 truncate max-w-[180px]">
                                {candidate.category || "Unique Product Type"}
                              </span>
                            </div>
                          </div>
                        </div>

                        <div className="pt-2 border-t border-slate-800 flex items-center justify-between text-[11px]">
                          <span className="text-amber-400/90 font-medium">Evaluation Candidate</span>
                          <span className="text-slate-500 text-[10px]">Pending Long-Term Demand</span>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="p-4 rounded-xl bg-slate-900/50 border border-slate-800 text-center text-xs text-slate-400">
                    No shortlist products currently qualified for evaluation.
                  </div>
                )}
              </div>
            )}

            {/* PROVISIONAL OPPORTUNITIES SHORTLIST */}
            {leaderboard && leaderboard.provisionalCandidates && leaderboard.provisionalCandidates.length > 0 && (
              <div className="space-y-4 pt-6 border-t border-[#1f293d]">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="text-sm font-bold text-slate-200 flex items-center gap-2">
                      <Clock className="h-4 w-4 text-purple-400" />
                      <span>Provisional Opportunities (Pending Long-Term Demand Confirmation)</span>
                    </h3>
                    <p className="text-[11px] text-slate-500 mt-0.5">
                      Promising commercial presence observed across ads, but historical demand or supplier margins remain provisional.
                    </p>
                  </div>
                  <span className="text-[11px] font-mono text-purple-400">
                    {leaderboard.provisionalCandidates.length} provisional candidates
                  </span>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {leaderboard.provisionalCandidates.slice(0, 6).map((item, idx) => (
                    <div
                      key={item.candidate.candidateId}
                      data-testid="kh02-provisional-product-card"
                      data-candidate-id={item.candidate.candidateId}
                      data-opportunity-score={item.score?.opportunityScore ?? 0}
                      data-rank={item.rank ?? ""}
                      data-display-order={idx + 1}
                      data-confidence={item.score?.evidenceConfidence ?? ""}
                      data-confidence-status={item.score?.scoreStatus ?? "PROVISIONAL"}
                      className="p-4 rounded-xl bg-[#130f24] border border-[#2b214a] hover:border-purple-500/40 transition-all flex items-start justify-between gap-4"
                    >
                      <div className="flex items-start gap-3 flex-1">
                        <div
                          onClick={() => {
                            if (item.candidate.videoUrl || item.candidate.thumbnailUrl) {
                              setActiveMediaItem({
                                title: item.candidate.title,
                                videoUrl: item.candidate.videoUrl,
                                thumbnailUrl: item.candidate.thumbnailUrl,
                                sourceUrl: item.candidate.canonicalProductUrl,
                                platform: item.candidate.supportingSourceTypes[0] || "Meta",
                              });
                            }
                          }}
                          className="relative shrink-0 w-16 h-16 rounded-lg overflow-hidden bg-slate-950 border border-slate-800 cursor-pointer"
                        >
                          {item.candidate.thumbnailUrl && !isStockImage(item.candidate.thumbnailUrl) ? (
                            <img src={item.candidate.thumbnailUrl} alt={item.candidate.title} className="w-full h-full object-cover" />
                          ) : (
                            <ShoppingBag className="h-6 w-6 text-purple-400 m-auto mt-5" />
                          )}
                          {item.candidate.videoUrl && (
                            <div className="absolute inset-0 flex items-center justify-center bg-black/40">
                              <Play className="h-3 w-3 fill-white text-white" />
                            </div>
                          )}
                        </div>

                        <div className="space-y-1 flex-1">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-purple-950/80 text-purple-300 border border-purple-800/40">
                              PROVISIONAL
                            </span>
                            {item.candidate.identityStatus && (
                              <span className={`text-[9px] px-1.5 py-0.5 rounded font-medium border ${
                                item.candidate.identityStatus === "VERIFIED"
                                  ? "bg-emerald-950/60 text-emerald-300 border-emerald-800/40"
                                  : item.candidate.identityStatus === "PROBABLE"
                                  ? "bg-blue-950/60 text-blue-300 border-blue-800/40"
                                  : "bg-amber-950/60 text-amber-300 border-amber-800/40"
                              }`}>
                                {item.candidate.identityStatus === "VERIFIED" ? "Verified" : item.candidate.identityStatus === "PROBABLE" ? "Probable" : "Review Required"}
                              </span>
                            )}
                          </div>
                          <h4 className="text-xs font-bold text-white line-clamp-1">{item.candidate.title}</h4>

                          <p className="text-[11px] text-slate-400 line-clamp-1">
                            {item.candidate.storeDomain || "Multi-store"} · {item.candidate.distinctAdvertisersCount} advertiser(s)
                          </p>
                          <div className="text-[10px] text-purple-300 font-mono pt-1">
                            Score: {item.score.opportunityScore ?? "—"}/100 · Conf: {item.score.evidenceConfidence}%
                          </div>
                          {item.candidate.aiExclusionReason && (
                            <div className="text-[10px] text-rose-300 bg-rose-950/40 border border-rose-800/30 rounded px-1.5 py-0.5 mt-1 flex items-center gap-1">
                              <AlertCircle className="h-3 w-3 text-rose-400 shrink-0" />
                              <span className="truncate">{item.candidate.aiExclusionReason}</span>
                            </div>
                          )}
                        </div>
                      </div>

                      <div>
                        {item.candidate.researchProductId ? (
                          <Link
                            href={`/products/${item.candidate.researchProductId}/intelligence`}
                            className="py-1.5 px-3 rounded-lg bg-slate-800 hover:bg-slate-700 text-purple-300 text-xs font-semibold flex items-center gap-1"
                          >
                            <span>Inspect</span>
                            <ChevronRight className="h-3.5 w-3.5" />
                          </Link>
                        ) : (
                          <button
                            onClick={() => setInspectCandidate(item)}
                            className="py-1.5 px-3 rounded-lg bg-slate-800 hover:bg-slate-700 text-purple-300 text-xs font-semibold flex items-center gap-1"
                          >
                            <span>Details</span>
                            <ChevronRight className="h-3.5 w-3.5" />
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* REMAINING CANDIDATES (#4+) */}
            {leaderboard && leaderboard.remainingCandidates.length > 0 && (
              <div className="space-y-3 pt-6 border-t border-[#1f293d]">
                <h3 className="text-sm font-bold text-slate-300">
                  Other Verified Candidates (#{leaderboard.remainingCandidates[0]?.rank || 4} and below)
                </h3>
                <div className="space-y-2">
                  {leaderboard.remainingCandidates.map((item) => (
                    <div
                      key={item.candidate.candidateId}
                      className="p-3.5 rounded-xl bg-[#141026] border border-[#261d40] hover:border-purple-500/40 transition-all flex items-center justify-between gap-4 text-xs"
                    >
                      <div className="flex items-center gap-3">
                        <span className="w-6 text-center font-bold text-slate-400 font-mono">
                          #{item.rank}
                        </span>
                        <div>
                          <h4 className="font-semibold text-white">{item.candidate.title}</h4>
                          <p className="text-[11px] text-slate-500">{item.candidate.category} · {item.candidate.storeDomain || "Multiple stores"}</p>
                        </div>
                      </div>

                      <div className="flex items-center gap-6">
                        <div className="text-right">
                          <span className="text-slate-400 text-[10px] block">Score</span>
                          <span className="font-bold text-white font-mono">{item.score.opportunityScore ?? "—"}/100</span>
                        </div>
                        <div className="text-right">
                          <span className="text-slate-400 text-[10px] block">Confidence</span>
                          <span className="font-semibold text-purple-300 font-mono">{item.score.evidenceConfidence}%</span>
                        </div>
                        {item.candidate.researchProductId ? (
                          <Link
                            href={`/products/${item.candidate.researchProductId}/intelligence`}
                            className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium"
                          >
                            Inspect
                          </Link>
                        ) : (
                          <button
                            onClick={() => setInspectCandidate(item)}
                            className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium"
                          >
                            Details
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* REJECTED / DISQUALIFIED CANDIDATES (AUDIT & RELEVANCE GATE) */}
            {leaderboard && leaderboard.rejectedCandidates && leaderboard.rejectedCandidates.length > 0 && (
              <div data-testid="kh02-rejected-candidates-section" className="space-y-4 pt-6 border-t border-[#1f293d]">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="text-sm font-bold text-rose-300 flex items-center gap-2">
                      <AlertCircle className="h-4 w-4 text-rose-400" />
                      <span>Excluded / Disqualified Candidates (Relevance & Market Identity Audit)</span>
                    </h3>
                    <p className="text-[11px] text-slate-500 mt-0.5">
                      Candidates identified in raw ad data but blocked by relevance gating (e.g. human body depilatories or non-pet products for pet hair remover queries).
                    </p>
                  </div>
                  <span className="text-[11px] font-mono text-rose-400">
                    {leaderboard.rejectedCandidates.length} excluded
                  </span>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {leaderboard.rejectedCandidates.map((item) => (
                    <div
                      key={item.candidate.candidateId}
                      data-testid="kh02-rejected-product-card"
                      className="p-3 rounded-xl bg-rose-950/20 border border-rose-900/40 text-xs space-y-1.5"
                    >
                      <div className="flex items-center justify-between">
                        <span className="font-semibold text-rose-200 line-clamp-1">{item.candidate.title}</span>
                        <span className="px-1.5 py-0.5 rounded bg-rose-900/60 text-rose-300 text-[10px] font-bold">
                          REJECTED
                        </span>
                      </div>
                      <p className="text-[11px] text-slate-400">
                        {item.candidate.storeDomain || "Domain unverified"} · Score: {item.score?.opportunityScore ?? 0}/100
                      </p>
                      <p className="text-[10px] text-rose-300/80 bg-rose-950/40 p-1.5 rounded border border-rose-900/30">
                        <span className="font-semibold">Reason:</span>{" "}
                        {item.score?.recommendationRationale ||
                          item.candidate.relevanceReasons?.join("; ") ||
                          "Failed product relevance filter for requested research topic"}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* VIEW MODE 2: STORED DATABASE SKUS (PRESERVES EXISTING FUNCTIONALITY) */}
        {viewMode === "STORED_PRODUCTS" && (
          <div className="space-y-6">
            <div className="flex flex-col md:flex-row gap-3 items-center justify-between text-xs">
              <div className="relative flex-1 w-full">
                <Search className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
                <input
                  type="text"
                  placeholder="Search catalog products by title or domain..."
                  value={storedSearch}
                  onChange={(e) => setStoredSearch(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && fetchStoredProducts()}
                  className="w-full pl-9 pr-4 py-2 rounded-lg bg-slate-900 border border-slate-800 text-slate-200 focus:outline-none focus:border-indigo-500 text-xs"
                />
              </div>

              <div className="flex items-center gap-2 w-full md:w-auto">
                <span className="text-slate-500 font-medium">Category:</span>
                <select
                  value={storedCategory}
                  onChange={(e) => setStoredCategory(e.target.value)}
                  className="px-3 py-2 rounded-lg bg-slate-900 border border-slate-800 text-slate-200 focus:outline-none focus:border-indigo-500 text-xs"
                >
                  <option value="ALL">All Categories</option>
                  <option value="Home & Kitchen">Home & Kitchen</option>
                  <option value="Beauty & Personal Care">Beauty & Personal Care</option>
                  <option value="Health & Wellness Products">Health & Wellness</option>
                  <option value="Pet Supplies">Pet Supplies</option>
                  <option value="Fitness">Fitness</option>
                  <option value="Fashion">Fashion</option>
                </select>
              </div>
            </div>

            {storedLoading ? (
              <div className="p-16 text-center text-slate-500">Loading catalog products...</div>
            ) : storedProducts.length === 0 ? (
              <div className="p-16 rounded-xl bg-[#111827] border border-[#1f293d] text-center space-y-3">
                <ShoppingBag className="h-10 w-10 text-slate-600 mx-auto" />
                <p className="text-sm font-bold text-white">No products found in catalog</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
                {storedProducts.map((product) => (
                  <div
                    key={product.id}
                    className="bg-[#111827] rounded-xl border border-[#1f293d] overflow-hidden flex flex-col justify-between hover:border-slate-700 transition-all shadow-sm"
                  >
                    <div>
                      <div className="relative h-44 w-full bg-slate-950 overflow-hidden flex items-center justify-center">
                        {product.imageUrl && !isStockImage(product.imageUrl) ? (
                          <img src={product.imageUrl} alt={product.title} className="w-full h-full object-cover" />
                        ) : (
                          <ShoppingBag className="h-8 w-8 text-slate-700" />
                        )}
                      </div>
                      <div className="p-4 space-y-2">
                        <span className="text-[10px] px-2 py-0.5 rounded bg-slate-800 text-slate-400 font-medium">
                          {product.category}
                        </span>
                        <h2 className="text-sm font-bold text-white line-clamp-2">{product.title}</h2>
                        <p className="text-xs text-slate-400 font-mono">
                          Domain: <span className="text-indigo-300">{product.store?.domain || "Unknown"}</span>
                        </p>
                      </div>
                    </div>

                    <div className="p-4 pt-0 space-y-3">
                      <div className="flex items-center justify-between pt-3 border-t border-[#1f293d]">
                        <div>
                          <span className="text-[10px] text-slate-500 block">Observed Price</span>
                          <span className="text-base font-extrabold text-emerald-400 font-mono">
                            {product.currentPrice != null ? `$${product.currentPrice.toFixed(2)}` : "—"}
                          </span>
                        </div>
                        <div className="text-right">
                          <span className="text-[10px] text-slate-500 block">Linked Ads</span>
                          <span className="text-xs font-bold text-white font-mono">
                            {product.adLinks?.length ?? 0} observed
                          </span>
                        </div>
                      </div>

                      <Link
                        href={`/products/${product.id}/intelligence`}
                        className="w-full py-2 px-3 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors shadow-sm"
                      >
                        <Sparkles className="h-3.5 w-3.5" />
                        <span>Product Intelligence</span>
                      </Link>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </main>

      {/* VIDEO / MEDIA PREVIEW MODAL */}
      {activeMediaItem && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
          <div className="bg-[#161228] border border-[#2e234d] rounded-2xl max-w-2xl w-full overflow-hidden shadow-2xl space-y-4 p-5">
            <div className="flex items-center justify-between">
              <div>
                <span className="text-[10px] px-2 py-0.5 rounded bg-purple-950 text-purple-300 border border-purple-800/40 font-bold">
                  {activeMediaItem.platform || "Media Creative"}
                </span>
                <h3 className="text-base font-bold text-white mt-1 line-clamp-1">{activeMediaItem.title}</h3>
              </div>
              <button
                onClick={() => setActiveMediaItem(null)}
                className="p-1.5 rounded-lg bg-slate-800 text-slate-400 hover:text-white"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="relative rounded-xl overflow-hidden bg-black aspect-video flex items-center justify-center">
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
              ) : (
                <p className="text-xs text-slate-500">Media source unavailable for preview.</p>
              )}
            </div>

            <div className="flex items-center justify-between pt-2">
              <span className="text-xs text-slate-400">Verified platform creative demonstration</span>
              {activeMediaItem.sourceUrl && (
                <a
                  href={activeMediaItem.sourceUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs text-purple-400 hover:text-purple-300 flex items-center gap-1 font-semibold"
                >
                  <span>Open Canonical Source</span>
                  <ExternalLink className="h-3.5 w-3.5" />
                </a>
              )}
            </div>
          </div>
        </div>
      )}

      {/* CANDIDATE INSPECTION MODAL (For Unlinked Candidates) */}
      {inspectCandidate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
          <div className="bg-[#161228] border border-[#2e234d] rounded-2xl max-w-2xl w-full overflow-hidden shadow-2xl p-6 space-y-5 max-h-[90vh] overflow-y-auto">
            <div className="flex items-start justify-between">
              <div>
                <span className="text-[10px] px-2 py-0.5 rounded bg-purple-950 text-purple-300 border border-purple-800/40 font-bold">
                  CANDIDATE INTELLIGENCE SUMMARY
                </span>
                <h3 className="text-lg font-bold text-white mt-1">{inspectCandidate.candidate.title}</h3>
                <p className="text-xs text-slate-400">
                  {inspectCandidate.candidate.category} · {inspectCandidate.candidate.storeDomain || "Multiple Storefronts"}
                </p>
              </div>
              <button
                onClick={() => setInspectCandidate(null)}
                className="p-1.5 rounded-lg bg-slate-800 text-slate-400 hover:text-white"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {/* Score Overview */}
            <div className="grid grid-cols-3 gap-3 p-4 rounded-xl bg-[#0e0b1c] border border-[#2e234d]">
              <div>
                <span className="text-[10px] text-slate-400 block">Opportunity Score</span>
                <span className="text-xl font-bold text-white font-mono">{inspectCandidate.score.opportunityScore ?? "—"}/100</span>
              </div>
              <div>
                <span className="text-[10px] text-slate-400 block">Evidence Confidence</span>
                <span className="text-xl font-bold text-purple-300 font-mono">{inspectCandidate.score.evidenceConfidence}%</span>
              </div>
              <div>
                <span className="text-[10px] text-slate-400 block">Recommendation</span>
                <span className="text-xs font-bold text-amber-400">{inspectCandidate.score.recommendation}</span>
              </div>
            </div>

            {/* Problem Statement */}
            {inspectCandidate.candidate.problemStatement && (
              <div className="space-y-1">
                <span className="text-xs font-semibold text-purple-400">Identified Problem / Pain Point</span>
                <p className="text-xs text-slate-300 bg-[#0e0b1c] p-3 rounded-lg border border-[#2e234d]">
                  {inspectCandidate.candidate.problemStatement}
                </p>
              </div>
            )}

            {/* Pillars Breakdown */}
            <div className="space-y-2">
              <span className="text-xs font-semibold text-slate-300">Six-Pillar Evaluation</span>
              <div className="grid grid-cols-2 gap-2 text-xs">
                {Object.entries(inspectCandidate.score.pillars).map(([key, val]) => (
                  <div key={key} className="p-2.5 rounded-lg bg-[#0e0b1c] border border-[#261d40] space-y-1">
                    <div className="flex justify-between items-center">
                      <span className="text-slate-400 capitalize text-[11px]">{key.replace(/([A-Z])/g, " $1")}</span>
                      <span className="font-bold text-white font-mono">{val.score ?? 0}/{val.maxWeight}</span>
                    </div>
                    <p className="text-[10px] text-slate-500 line-clamp-1">{val.explanation}</p>
                  </div>
                ))}
              </div>
            </div>

            {/* Missing Evidence */}
            {inspectCandidate.score.missingEvidence.length > 0 && (
              <div className="space-y-1">
                <span className="text-xs font-semibold text-amber-400">Missing Signals For Full Evergreening</span>
                <ul className="text-[11px] text-slate-400 space-y-1 bg-[#0e0b1c] p-3 rounded-lg border border-[#2e234d] list-disc list-inside">
                  {inspectCandidate.score.missingEvidence.map((m, idx) => (
                    <li key={idx}>{m}</li>
                  ))}
                </ul>
              </div>
            )}

            {/* Canonical Link */}
            {inspectCandidate.candidate.canonicalProductUrl && (
              <div className="flex items-center justify-between pt-2">
                <span className="text-xs text-slate-400">Store Destination URL</span>
                <a
                  href={inspectCandidate.candidate.canonicalProductUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs text-purple-400 hover:text-purple-300 flex items-center gap-1 font-semibold"
                >
                  <span>Visit Storefront</span>
                  <ExternalLink className="h-3 w-3" />
                </a>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
