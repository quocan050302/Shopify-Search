"use client";

import { useState, useEffect, useCallback } from "react";
import {
  Radar,
  Play,
  RotateCcw,
  AlertTriangle,
  CheckCircle2,
  Clock,
  ExternalLink,
  ShieldAlert,
  Sliders,
  Layers,
  Sparkles,
  Info,
  Flame,
  XCircle,
  Database,
  Calendar,
} from "lucide-react";
import Link from "next/link";

interface ProviderItem {
  id: string;
  name: string;
  version: string;
  capabilities: {
    supportsUS: boolean;
    supportsKeywordFiltering: boolean;
    supportsIndustryFiltering: boolean;
    isPaid: boolean;
    description: string;
  };
  availability: {
    status: string;
    message?: string;
    isAuthorized: boolean;
    requiresConfig: boolean;
  };
}

interface DiscoverySchedule {
  id?: string;
  enabled: boolean;
  name: string;
  providerId: string;
  searchWindowDays: number;
  targetMarket: string;
  keywords: string[];
  industries: string[];
  dailyLimit: number;
  timezone: string;
  hourOfDayUtc: number;
  lastRunAt?: string | null;
}

interface DiscoveryJob {
  id: string;
  providerId: string;
  status: string;
  runMode: string;
  requestedLimit: number;
  actualRetrievedCount: number;
  validCount: number;
  newUniqueCount: number;
  existingDuplicateCount: number;
  failedCount: number;
  creditsUsed: number;
  errorMessage?: string | null;
  startedAt?: string | null;
  finishedAt?: string | null;
  createdAt: string;
}

interface DiscoveryStats {
  totalDiscoveredAds: number;
  totalRuns: number;
  completedRuns: number;
  blockedRuns: number;
  activeSchedules: number;
  lastDiscoveredAt?: string | null;
  workerStatus?: {
    isRunning: boolean;
    activeJobsCount: number;
  };
}

export default function DiscoveryPage() {
  const [providers, setProviders] = useState<ProviderItem[]>([]);
  const [schedule, setSchedule] = useState<DiscoverySchedule>({
    enabled: false,
    name: "US TikTok Top Ads Daily Discovery",
    providerId: "tiktok-topads",
    searchWindowDays: 30,
    targetMarket: "US",
    keywords: ["beauty", "skincare", "ecommerce"],
    industries: [],
    dailyLimit: 20,
    timezone: "UTC",
    hourOfDayUtc: 6,
  });
  const [jobs, setJobs] = useState<DiscoveryJob[]>([]);
  const [stats, setStats] = useState<DiscoveryStats | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isRunningJob, setIsRunningJob] = useState(false);
  const [activeJobResult, setActiveJobResult] = useState<any | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionNotice, setActionNotice] = useState<string | null>(null);

  // Form controls
  const [keywordsText, setKeywordsText] = useState("beauty, skincare, ecommerce");
  const [selectedProvider, setSelectedProvider] = useState("tiktok-topads");
  const [searchWindow, setSearchWindow] = useState<7 | 30 | 180>(30);
  const [dailyLimit, setDailyLimit] = useState(20);
  const [selectedIndustry, setSelectedIndustry] = useState("");

  const loadData = useCallback(async () => {
    try {
      setIsLoading(true);
      const [provRes, cfgRes, jobsRes, statsRes] = await Promise.all([
        fetch("/api/v1/discovery/providers"),
        fetch("/api/v1/discovery/config"),
        fetch("/api/v1/discovery/jobs?limit=10"),
        fetch("/api/v1/discovery/stats"),
      ]);

      if (provRes.ok) {
        const provData = await provRes.json();
        setProviders(provData.data || []);
      }

      if (cfgRes.ok) {
        const cfgData = await cfgRes.json();
        if (cfgData.data && cfgData.data.length > 0) {
          const s = cfgData.data[0];
          setSchedule(s);
          setKeywordsText(s.keywords?.join(", ") || "");
          setSelectedProvider(s.providerId || "tiktok-topads");
          setSearchWindow(s.searchWindowDays || 30);
          setDailyLimit(s.dailyLimit || 20);
        }
      }

      if (jobsRes.ok) {
        const jobsData = await jobsRes.json();
        setJobs(jobsData.data || []);
      }

      if (statsRes.ok) {
        const statsData = await statsRes.json();
        setStats(statsData.data || null);
      }
    } catch (err: unknown) {
      console.warn("Failed to load discovery page data:", err);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Execute discovery run (manual or dry run)
  const handleRunDiscovery = async (dryRun = false) => {
    try {
      setIsRunningJob(true);
      setActionError(null);
      setActionNotice(null);
      setActiveJobResult(null);

      const keywords = keywordsText
        .split(",")
        .map((k) => k.trim())
        .filter((k) => k.length > 0);

      const queryPayload = {
        workspaceId: "default-workspace",
        platform: "TIKTOK",
        market: "US",
        keywords,
        industries: selectedIndustry ? [selectedIndustry] : [],
        objectives: [],
        searchWindowDays: searchWindow,
        sortBy: "relevance",
        requestedLimit: dailyLimit,
        pageSize: 20,
        providerId: selectedProvider,
        runMode: dryRun ? "DRY_RUN" : "MANUAL",
      };

      const res = await fetch("/api/v1/discovery/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: queryPayload, dryRun }),
      });

      const data = await res.json();

      if (!res.ok || !data.success) {
        setActionError(data.error?.message || "Discovery run could not be executed.");
        return;
      }

      setActiveJobResult(data.data);
      if (data.data.finalStatus === "BLOCKED_SOURCE") {
        setActionError(
          data.data.errorMessage ||
            "Provider requires session authentication (TIKTOK_CC_COOKIE). Zero fake ads inserted."
        );
      } else {
        setActionNotice(
          `Discovery ${dryRun ? "dry-run" : "run"} completed with status: ${data.data.finalStatus}. Retrieved ${data.data.actualRetrievedCount}, new unique: ${data.data.newUniqueCount}.`
        );
      }

      // Refresh job list and stats
      loadData();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setActionError(`Run failed: ${msg}`);
    } finally {
      setIsRunningJob(false);
    }
  };

  // Toggle or save schedule
  const handleSaveSchedule = async (enabledState?: boolean) => {
    try {
      setActionError(null);
      setActionNotice(null);

      const keywords = keywordsText
        .split(",")
        .map((k) => k.trim())
        .filter((k) => k.length > 0);

      const payload: DiscoverySchedule = {
        ...schedule,
        enabled: enabledState !== undefined ? enabledState : schedule.enabled,
        providerId: selectedProvider,
        searchWindowDays: searchWindow,
        dailyLimit,
        keywords,
        industries: selectedIndustry ? [selectedIndustry] : [],
      };

      const res = await fetch("/api/v1/discovery/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
        setActionError(data.error?.message || "Failed to update discovery schedule.");
        return;
      }

      setSchedule(data.data);
      setActionNotice(
        `Schedule ${payload.enabled ? "activated" : "paused"}. Daily limit: ${payload.dailyLimit} ads at ${payload.hourOfDayUtc}:00 UTC.`
      );
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setActionError(`Schedule save failed: ${msg}`);
    }
  };

  const activeProviderObj = providers.find((p) => p.id === selectedProvider);

  return (
    <div className="min-h-screen bg-[#0c121e] text-slate-100 p-8 space-y-8">
      {/* ── Header ── */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-[#1f293d] pb-6">
        <div>
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-xl bg-gradient-to-tr from-indigo-600 to-indigo-500 shadow-md shadow-indigo-600/30">
              <Radar className="h-6 w-6 text-white" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-2xl font-bold tracking-tight text-white">TikTok Auto Discovery Engine</h1>
                <span className="text-[10px] uppercase font-bold px-2 py-0.5 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                  V9 Production
                </span>
                <span className="text-[10px] uppercase font-bold px-2 py-0.5 rounded bg-indigo-500/10 text-indigo-400 border border-indigo-500/20">
                  US 🇺🇸 Focus
                </span>
              </div>
              <p className="text-xs text-slate-400 mt-1">
                Automated competitive advertising discovery without manual URL copying. Zero unauthorized paid calls.
              </p>
            </div>
          </div>
        </div>

        {/* Global Action Buttons */}
        <div className="flex items-center gap-3">
          <a
            href="https://ads.tiktok.com/business/creativecenter/inspiration/topads/pc/en?period=30&region=US"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-slate-900 hover:bg-slate-800 text-slate-300 hover:text-white border border-slate-800 text-xs font-medium transition-all"
            title="Open TikTok Top Ads prefiltered for United States"
          >
            <Flame className="h-3.5 w-3.5 text-amber-400" />
            <span>Open Top Ads (US) ↗</span>
          </a>

          <Link
            href="/explorer"
            className="px-3.5 py-2 rounded-lg bg-slate-900 hover:bg-slate-800 text-slate-300 hover:text-white border border-slate-800 text-xs font-medium transition-all"
          >
            View Ads Explorer
          </Link>

          <button
            onClick={() => handleRunDiscovery(false)}
            disabled={isRunningJob}
            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-gradient-to-r from-indigo-600 to-indigo-500 hover:from-indigo-500 hover:to-indigo-400 text-white text-xs font-semibold shadow-md shadow-indigo-600/30 transition-all cursor-pointer disabled:opacity-50"
          >
            <Play className="h-3.5 w-3.5 fill-current" />
            <span>{isRunningJob ? "Running Discovery..." : "Run Discovery Now"}</span>
          </button>
        </div>
      </div>

      {/* ── Status Alerts ── */}
      {actionError && (
        <div className="p-4 rounded-xl bg-rose-500/10 border border-rose-500/20 text-rose-300 text-xs flex items-start gap-3">
          <AlertTriangle className="h-4 w-4 shrink-0 text-rose-400 mt-0.5" />
          <div className="flex-1">
            <strong className="block font-semibold text-rose-200">Action Notice / Blocked State</strong>
            <p className="mt-0.5">{actionError}</p>
          </div>
          <button onClick={() => setActionError(null)} className="text-slate-400 hover:text-white text-xs">
            ✕
          </button>
        </div>
      )}

      {actionNotice && (
        <div className="p-4 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-300 text-xs flex items-start gap-3">
          <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-400 mt-0.5" />
          <div className="flex-1">
            <strong className="block font-semibold text-emerald-200">Execution Success</strong>
            <p className="mt-0.5">{actionNotice}</p>
          </div>
          <button onClick={() => setActionNotice(null)} className="text-slate-400 hover:text-white text-xs">
            ✕
          </button>
        </div>
      )}

      {/* ── Top Metric Cards ── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="p-4 rounded-xl bg-slate-900/60 border border-[#1f293d] flex items-center justify-between">
          <div>
            <span className="text-[11px] font-medium text-slate-400 uppercase tracking-wider">Total Discovered Ads</span>
            <div className="text-2xl font-bold text-white mt-1">{stats?.totalDiscoveredAds ?? 0}</div>
            <span className="text-[10px] text-emerald-400 flex items-center gap-1 mt-0.5">
              <CheckCircle2 className="h-2.5 w-2.5" /> Verified in Database
            </span>
          </div>
          <div className="p-2.5 rounded-lg bg-indigo-500/10 text-indigo-400">
            <Database className="h-5 w-5" />
          </div>
        </div>

        <div className="p-4 rounded-xl bg-slate-900/60 border border-[#1f293d] flex items-center justify-between">
          <div>
            <span className="text-[11px] font-medium text-slate-400 uppercase tracking-wider">Discovery Runs</span>
            <div className="text-2xl font-bold text-white mt-1">{stats?.totalRuns ?? 0}</div>
            <span className="text-[10px] text-slate-400 mt-0.5 block">
              {stats?.completedRuns ?? 0} completed • {stats?.blockedRuns ?? 0} blocked
            </span>
          </div>
          <div className="p-2.5 rounded-lg bg-emerald-500/10 text-emerald-400">
            <Layers className="h-5 w-5" />
          </div>
        </div>

        <div className="p-4 rounded-xl bg-slate-900/60 border border-[#1f293d] flex items-center justify-between">
          <div>
            <span className="text-[11px] font-medium text-slate-400 uppercase tracking-wider">Daily Schedule</span>
            <div className="text-2xl font-bold text-white mt-1">
              {schedule.enabled ? "Active" : "Paused"}
            </div>
            <span className="text-[10px] text-slate-400 mt-0.5 block">
              {schedule.dailyLimit} ads/day • {schedule.hourOfDayUtc}:00 UTC
            </span>
          </div>
          <div className="p-2.5 rounded-lg bg-amber-500/10 text-amber-400">
            <Calendar className="h-5 w-5" />
          </div>
        </div>

        <div className="p-4 rounded-xl bg-slate-900/60 border border-[#1f293d] flex items-center justify-between">
          <div>
            <span className="text-[11px] font-medium text-slate-400 uppercase tracking-wider">Background Worker</span>
            <div className="text-2xl font-bold text-white mt-1">
              {stats?.workerStatus?.isRunning ? "Online" : "Standalone CLI"}
            </div>
            <span className="text-[10px] text-slate-400 mt-0.5 block font-mono">
              npm run discovery:worker
            </span>
          </div>
          <div className="p-2.5 rounded-lg bg-purple-500/10 text-purple-400">
            <Clock className="h-5 w-5" />
          </div>
        </div>
      </div>

      {/* ── Main Engine Section: Configuration + Provider Health ── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left Column: Search & Schedule Configuration (2 Cols) */}
        <div className="lg:col-span-2 space-y-6">
          <div className="p-5 rounded-2xl bg-slate-900/60 border border-[#1f293d] space-y-5">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div className="flex items-center gap-2">
                <Sliders className="h-4 w-4 text-indigo-400" />
                <h2 className="text-sm font-semibold text-white">Discovery Search Configuration</h2>
              </div>
              <span className="text-[11px] text-slate-400">Target: United States (US 🇺🇸)</span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {/* Keywords */}
              <div className="sm:col-span-2 space-y-1.5">
                <label className="text-xs font-medium text-slate-300">
                  Search Keywords <span className="text-slate-500">(comma-separated)</span>
                </label>
                <input
                  type="text"
                  value={keywordsText}
                  onChange={(e) => setKeywordsText(e.target.value)}
                  placeholder="e.g. beauty, skincare, gadget, kitchen"
                  className="w-full px-3.5 py-2 rounded-lg bg-slate-950 border border-slate-800 text-xs text-white placeholder-slate-600 focus:outline-none focus:border-indigo-500"
                />
              </div>

              {/* Provider Selection */}
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-slate-300">Discovery Provider</label>
                <select
                  value={selectedProvider}
                  onChange={(e) => setSelectedProvider(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-800 text-xs text-slate-200 focus:outline-none focus:border-indigo-500"
                >
                  <option value="tiktok-topads">TikTok Creative Center Top Ads (Direct — Free Default)</option>
                  <option value="apify-topads">Apify TikTok Top Ads (Metered — User Authorized)</option>
                </select>
              </div>

              {/* Search Window Days */}
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-slate-300">
                  Search Filter Window <span className="text-slate-500">(Top Ads filter)</span>
                </label>
                <select
                  value={searchWindow}
                  onChange={(e) => setSearchWindow(Number(e.target.value) as 7 | 30 | 180)}
                  className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-800 text-xs text-slate-200 focus:outline-none focus:border-indigo-500"
                >
                  <option value={7}>Last 7 Days (Trending Breakouts)</option>
                  <option value={30}>Last 30 Days (Standard Winning Benchmark)</option>
                  <option value={180}>Last 180 Days (Broad Candidate Pool)</option>
                </select>
                <span className="text-[10px] text-slate-500 block">
                  Rule 12: Search window specifies query scope, NOT continuous running duration.
                </span>
              </div>

              {/* Daily Limit */}
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-slate-300">Requested Daily Ad Limit</label>
                <select
                  value={dailyLimit}
                  onChange={(e) => setDailyLimit(Number(e.target.value))}
                  className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-800 text-xs text-slate-200 focus:outline-none focus:border-indigo-500"
                >
                  <option value={10}>10 Ads per run</option>
                  <option value={20}>20 Ads per run (Recommended)</option>
                  <option value={50}>50 Ads per run</option>
                  <option value={100}>100 Ads per run</option>
                </select>
              </div>

              {/* Industry Filter */}
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-slate-300">Industry / Niche</label>
                <select
                  value={selectedIndustry}
                  onChange={(e) => setSelectedIndustry(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-800 text-xs text-slate-200 focus:outline-none focus:border-indigo-500"
                >
                  <option value="">All E-Commerce Categories</option>
                  <option value="Beauty & Personal Care">Beauty & Personal Care</option>
                  <option value="Home & Garden">Home & Garden</option>
                  <option value="Apparel & Accessories">Apparel & Accessories</option>
                  <option value="Consumer Electronics">Consumer Electronics</option>
                  <option value="Health & Wellness">Health & Wellness</option>
                </select>
              </div>
            </div>

            {/* Action Bar */}
            <div className="flex flex-wrap items-center justify-between gap-3 pt-3 border-t border-slate-800">
              <div className="flex items-center gap-2">
                <button
                  onClick={() => handleSaveSchedule(!schedule.enabled)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-all ${
                    schedule.enabled
                      ? "bg-amber-500/10 text-amber-400 border-amber-500/20 hover:bg-amber-500/20"
                      : "bg-emerald-500/10 text-emerald-400 border-emerald-500/20 hover:bg-emerald-500/20"
                  }`}
                >
                  {schedule.enabled ? "Pause Schedule" : "Enable Daily Schedule"}
                </button>
                <button
                  onClick={() => handleSaveSchedule()}
                  className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-medium transition-all"
                >
                  Save Config
                </button>
              </div>

              <div className="flex items-center gap-2">
                <button
                  onClick={() => handleRunDiscovery(true)}
                  disabled={isRunningJob}
                  className="px-3 py-1.5 rounded-lg bg-slate-950 hover:bg-slate-800 border border-slate-800 text-slate-400 hover:text-white text-xs font-medium transition-all disabled:opacity-50"
                  title="Run without inserting into database or making paid API calls"
                >
                  Dry Run
                </button>
                <button
                  onClick={() => handleRunDiscovery(false)}
                  disabled={isRunningJob}
                  className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold shadow-sm transition-all disabled:opacity-50"
                >
                  <Play className="h-3 w-3 fill-current" />
                  <span>{isRunningJob ? "Discovering..." : "Execute Discovery"}</span>
                </button>
              </div>
            </div>
          </div>

          {/* Active Job Real-Time Card */}
          {activeJobResult && (
            <div className="p-4 rounded-xl bg-slate-900/80 border border-indigo-500/30 space-y-2">
              <div className="flex items-center justify-between text-xs">
                <span className="font-semibold text-white">Latest Execution Result</span>
                <span
                  className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                    activeJobResult.finalStatus === "COMPLETED"
                      ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/30"
                      : activeJobResult.finalStatus === "BLOCKED_SOURCE"
                      ? "bg-rose-500/10 text-rose-400 border border-rose-500/30"
                      : "bg-amber-500/10 text-amber-400 border border-amber-500/30"
                  }`}
                >
                  {activeJobResult.finalStatus}
                </span>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs pt-1 text-slate-300">
                <div>Retrieved: <strong className="text-white">{activeJobResult.actualRetrievedCount}</strong></div>
                <div>New Unique: <strong className="text-emerald-400">{activeJobResult.newUniqueCount}</strong></div>
                <div>Duplicates: <strong className="text-slate-400">{activeJobResult.existingDuplicateCount}</strong></div>
                <div>Cost: <strong className="text-white">${activeJobResult.actualCostUsd || "0.00"}</strong></div>
              </div>
              {activeJobResult.errorMessage && (
                <p className="text-[11px] text-rose-300 pt-1 border-t border-slate-800">
                  {activeJobResult.errorMessage}
                </p>
              )}
            </div>
          )}
        </div>

        {/* Right Column: Provider Transparency & Diagnostics (1 Col) */}
        <div className="space-y-6">
          <div className="p-5 rounded-2xl bg-slate-900/60 border border-[#1f293d] space-y-4">
            <div className="flex items-center gap-2 border-b border-slate-800 pb-3">
              <ShieldAlert className="h-4 w-4 text-emerald-400" />
              <h3 className="text-sm font-semibold text-white">Provider Verification</h3>
            </div>

            {providers.map((p) => {
              const isSelected = p.id === selectedProvider;
              const isAvailable = p.availability.status === "AVAILABLE";
              const isBlocked = p.availability.status === "BLOCKED_SOURCE" || p.availability.status === "REQUIRES_AUTH";

              return (
                <div
                  key={p.id}
                  onClick={() => setSelectedProvider(p.id)}
                  className={`p-3.5 rounded-xl border transition-all cursor-pointer ${
                    isSelected
                      ? "bg-indigo-600/10 border-indigo-500/40"
                      : "bg-slate-950/60 border-slate-800 hover:border-slate-700"
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-white">{p.name}</span>
                    <span
                      className={`text-[9px] font-bold px-1.5 py-0.5 rounded border uppercase ${
                        isAvailable
                          ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/30"
                          : isBlocked
                          ? "bg-rose-500/10 text-rose-400 border-rose-500/30"
                          : "bg-slate-800 text-slate-400 border-slate-700"
                      }`}
                    >
                      {p.availability.status.replace("_", " ")}
                    </span>
                  </div>

                  <p className="text-[11px] text-slate-400 mt-1 line-clamp-2">
                    {p.availability.message || p.capabilities.description}
                  </p>

                  <div className="flex items-center gap-2 mt-2 pt-2 border-t border-slate-800/60 text-[10px] text-slate-500">
                    <span>{p.capabilities.isPaid ? "Metered Paid" : "Zero Cost ($0.00)"}</span>
                    <span>•</span>
                    <span>{p.capabilities.supportsUS ? "US Supported" : "Non-US"}</span>
                  </div>
                </div>
              );
            })}

            {/* Honest Blocked State Notice */}
            <div className="p-3 rounded-xl bg-slate-950/80 border border-slate-800/80 text-[11px] text-slate-400 space-y-1.5">
              <div className="flex items-center gap-1.5 text-amber-400 font-semibold">
                <Info className="h-3.5 w-3.5 shrink-0" />
                <span>Zero-Cost Architecture Notice</span>
              </div>
              <p className="text-[10px] leading-relaxed text-slate-400">
                SWAI never bypasses CAPTCHA, rotates illegal proxies, or fabricates synthetic advertisements. If TikTok requires session credentials, provide <code className="text-slate-300">TIKTOK_CC_COOKIE</code> in your environment or use the zero-cost Manual Batch Import.
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* ── Run History Table ── */}
      <div className="p-5 rounded-2xl bg-slate-900/60 border border-[#1f293d] space-y-4">
        <div className="flex items-center justify-between border-b border-slate-800 pb-3">
          <div className="flex items-center gap-2">
            <Clock className="h-4 w-4 text-slate-400" />
            <h3 className="text-sm font-semibold text-white">Discovery Execution History</h3>
          </div>
          <button
            onClick={loadData}
            className="flex items-center gap-1 text-xs text-slate-400 hover:text-white transition-colors"
          >
            <RotateCcw className="h-3 w-3" /> Refresh
          </button>
        </div>

        {jobs.length === 0 ? (
          <div className="py-8 text-center text-xs text-slate-500">
            No discovery runs recorded yet. Click &quot;Run Discovery Now&quot; or start the worker.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-slate-800 text-slate-400">
                  <th className="pb-2 font-medium">Job ID</th>
                  <th className="pb-2 font-medium">Provider</th>
                  <th className="pb-2 font-medium">Status</th>
                  <th className="pb-2 font-medium">Mode</th>
                  <th className="pb-2 font-medium">Retrieved</th>
                  <th className="pb-2 font-medium">New Unique</th>
                  <th className="pb-2 font-medium">Started</th>
                  <th className="pb-2 font-medium">Notice</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60">
                {jobs.map((j) => (
                  <tr key={j.id} className="hover:bg-slate-800/20">
                    <td className="py-2.5 font-mono text-[11px] text-slate-300">{j.id.slice(0, 10)}...</td>
                    <td className="py-2.5 text-slate-300">{j.providerId}</td>
                    <td className="py-2.5">
                      <span
                        className={`text-[9px] font-bold px-1.5 py-0.5 rounded border uppercase ${
                          j.status === "COMPLETED"
                            ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/30"
                            : j.status === "BLOCKED_SOURCE"
                            ? "bg-rose-500/10 text-rose-400 border-rose-500/30"
                            : j.status === "RUNNING"
                            ? "bg-indigo-500/10 text-indigo-400 border-indigo-500/30 animate-pulse"
                            : "bg-amber-500/10 text-amber-400 border-amber-500/30"
                        }`}
                      >
                        {j.status}
                      </span>
                    </td>
                    <td className="py-2.5 text-slate-400">{j.runMode}</td>
                    <td className="py-2.5 text-slate-200">{j.actualRetrievedCount}</td>
                    <td className="py-2.5 text-emerald-400 font-medium">+{j.newUniqueCount}</td>
                    <td className="py-2.5 text-slate-400">
                      {j.startedAt ? new Date(j.startedAt).toLocaleTimeString() : "N/A"}
                    </td>
                    <td className="py-2.5 text-slate-400 max-w-xs truncate" title={j.errorMessage || ""}>
                      {j.errorMessage || "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
