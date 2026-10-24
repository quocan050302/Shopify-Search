"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import {
  Globe2,
  Sparkles,
  ShieldCheck,
  Clock,
  CheckCircle2,
  AlertTriangle,
  RefreshCw,
  ExternalLink,
  Search,
  Sliders,
  X,
  Play,
  Activity,
  Terminal,
  Server,
  Cpu,
  Layers,
  HelpCircle,
  RotateCcw,
  Ban,
  Check,
} from "lucide-react";
import { Header } from "@/components/layout/Header";

interface ProviderHealth {
  provider: {
    id: string;
    name: string;
    enabled: boolean;
    status: string;
    isAuthorized: boolean;
    message: string;
  };
  environment: {
    pythonReady: boolean;
    dataDirReady: boolean;
    defaultCountry: string;
    liveTestEnabled: boolean;
  };
  worker: {
    status: "RUNNING" | "STOPPED";
    lastHeartbeat: string | null;
  };
  history: {
    lastSuccessfulRetrievalAt: string | null;
    lastSuccessfulRecordCount: number;
    lastFailureCategory: string | null;
    lastFailureMessage: string | null;
  };
  limits: {
    maxResultsPerSearch: number;
    maxRequestsPerSearch: number;
    maxExecutionSeconds: number;
    maxConcurrency: number;
  };
}

interface MetaRequestItem {
  id: string;
  jobId: string | null;
  providerId: string;
  status: string;
  keywords: string[];
  market: string;
  requestedLimit: number;
  actualRetrievedCount: number;
  validCount: number;
  newUniqueCount: number;
  existingDuplicateCount: number;
  linkedAdsCount: number;
  errorMessage: string | null;
  errorCategory: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  createdAt: string;
}

export default function MetaDiscoveryPage() {
  const [health, setHealth] = useState<ProviderHealth | null>(null);
  const [requests, setRequests] = useState<MetaRequestItem[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // Form state
  const [keywordsInput, setKeywordsInput] = useState("");
  const [market, setMarket] = useState("US");
  const [creativePreference, setCreativePreference] = useState<"VIDEO" | "IMAGE" | "ALL">("ALL");
  const [activeStatus, setActiveStatus] = useState<"ACTIVE" | "INACTIVE" | "ALL">("ACTIVE");
  const [requestedLimit, setRequestedLimit] = useState<number>(25);
  const [advertiserPageId, setAdvertiserPageId] = useState("");
  const [submitting, setSubmitting] = useState(false);

  // Diagnostics Modal
  const [diagnosticsOpen, setDiagnosticsOpen] = useState(false);
  const [selectedRequest, setSelectedRequest] = useState<MetaRequestItem | null>(null);

  const fetchData = useCallback(async () => {
    try {
      setRefreshing(true);
      setError(null);

      const [healthRes, requestsRes] = await Promise.all([
        fetch("/api/v1/discovery/meta/provider/health"),
        fetch("/api/v1/discovery/meta/requests?pageSize=50"),
      ]);

      if (healthRes.ok) {
        const hJson = await healthRes.json();
        setHealth(hJson);
      }

      if (requestsRes.ok) {
        const rJson = await requestsRes.json();
        setRequests(rJson.data || []);
      }
    } catch (err: unknown) {
      console.error("Failed to load Meta discovery data:", err);
      setError("Failed to connect to local Meta discovery services.");
    } finally {
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
    const timer = setInterval(fetchData, 10000);
    return () => clearInterval(timer);
  }, [fetchData]);

  const handleCreateRequest = async (e: React.FormEvent) => {
    e.preventDefault();
    const rawKeywords = keywordsInput
      .split(",")
      .map((k) => k.trim())
      .filter((k) => k.length > 0);

    if (rawKeywords.length === 0) {
      setError("Please provide at least one search keyword.");
      return;
    }

    try {
      setSubmitting(true);
      setError(null);
      setSuccessMsg(null);

      const res = await fetch("/api/v1/discovery/meta/requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          keywords: rawKeywords,
          market,
          requestedLimit,
          creativePreference,
          activeStatus,
          advertiserPageId: advertiserPageId.trim() || undefined,
        }),
      });

      const json = await res.json();
      if (!res.ok || !json.success) {
        throw new Error(json.message || json.error || "Failed to create research task.");
      }

      setSuccessMsg(`Research task queued successfully (Run ID: ${json.runId}). Local worker will process it.`);
      setKeywordsInput("");
      setAdvertiserPageId("");
      await fetchData();
    } catch (err: unknown) {
      setError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  const handleCancel = async (runId: string) => {
    try {
      setError(null);
      const res = await fetch(`/api/v1/discovery/meta/requests/${runId}/cancel`, {
        method: "POST",
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.message || "Could not cancel task");
      setSuccessMsg(`Task '${runId}' cancelled.`);
      await fetchData();
    } catch (err: unknown) {
      setError((err as Error).message);
    }
  };

  const handleRetry = async (runId: string) => {
    try {
      setError(null);
      const res = await fetch(`/api/v1/discovery/meta/requests/${runId}/retry`, {
        method: "POST",
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.message || "Could not retry task");
      setSuccessMsg(`New retry attempt queued (Run ID: ${json.newRunId}).`);
      await fetchData();
    } catch (err: unknown) {
      setError((err as Error).message);
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "COMPLETED":
        return "bg-emerald-500/10 text-emerald-400 border-emerald-500/30";
      case "RUNNING":
        return "bg-blue-500/10 text-blue-400 border-blue-500/30 animate-pulse";
      case "PENDING":
        return "bg-amber-500/10 text-amber-400 border-amber-500/30";
      case "BLOCKED_SOURCE":
        return "bg-rose-500/15 text-rose-400 border-rose-500/40";
      case "RATE_LIMITED":
        return "bg-yellow-500/15 text-yellow-400 border-yellow-500/40";
      case "CANCELLED":
        return "bg-slate-800 text-slate-400 border-slate-700";
      default:
        return "bg-red-500/10 text-red-400 border-red-500/30";
    }
  };

  return (
    <div className="flex-1 flex flex-col min-h-screen bg-[#0a0e17]">
      <Header />

      <main className="p-8 max-w-7xl mx-auto w-full space-y-6">
        {/* Top Header */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <div className="h-8 w-8 rounded-lg bg-blue-600/20 border border-blue-500/30 flex items-center justify-center text-blue-400 font-bold">
                <Globe2 className="h-5 w-5" />
              </div>
              <h1 className="text-xl font-extrabold text-white tracking-tight">
                Meta Ads Discovery Desk
              </h1>
              <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-blue-500/10 text-blue-400 border border-blue-500/30">
                Self-Hosted MCP
              </span>
            </div>
            <p className="text-xs text-slate-400 mt-1">
              Local-first Facebook Ad Library research powered by MetaAdsCollector MCP. Zero subscription APIs, zero cloud tunnels.
            </p>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            <button
              onClick={() => setDiagnosticsOpen(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 text-xs font-medium transition-all cursor-pointer"
            >
              <Cpu className="h-3.5 w-3.5 text-blue-400" />
              <span>Diagnostics</span>
            </button>
            <button
              onClick={fetchData}
              disabled={refreshing}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 text-xs font-medium transition-all cursor-pointer"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${refreshing ? "animate-spin text-blue-400" : ""}`} />
              <span>Refresh</span>
            </button>
            <Link
              href="/explorer?platform=META"
              className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-blue-600/30 hover:bg-blue-600/50 text-blue-200 border border-blue-500/40 text-xs font-semibold transition-all shadow-sm"
            >
              <Layers className="h-3.5 w-3.5 text-blue-400" />
              <span>Open Meta Explorer</span>
            </Link>
          </div>
        </div>

        {/* Global Notifications */}
        {error && (
          <div className="p-3.5 rounded-xl bg-red-950/30 border border-red-800/40 text-xs text-red-300 flex items-start gap-2">
            <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5 text-red-400" />
            <div className="flex-1">{error}</div>
            <button onClick={() => setError(null)} className="text-slate-400 hover:text-white">
              <X className="h-4 w-4" />
            </button>
          </div>
        )}

        {successMsg && (
          <div className="p-3.5 rounded-xl bg-emerald-950/30 border border-emerald-800/40 text-xs text-emerald-300 flex items-start gap-2">
            <CheckCircle2 className="h-4 w-4 shrink-0 mt-0.5 text-emerald-400" />
            <div className="flex-1">{successMsg}</div>
            <button onClick={() => setSuccessMsg(null)} className="text-slate-400 hover:text-white">
              <X className="h-4 w-4" />
            </button>
          </div>
        )}

        {/* 1. Provider Status Cards */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          {/* Card 1: Local MCP Server */}
          <div className="p-4 rounded-xl bg-[#111827] border border-[#1f293d] flex flex-col justify-between">
            <div className="flex items-center justify-between mb-2">
              <span className="text-[11px] font-semibold text-slate-400">Local MCP Server</span>
              <Server className="h-4 w-4 text-blue-400" />
            </div>
            <div>
              <div className="flex items-center gap-1.5 mb-1">
                <span
                  className={`h-2 w-2 rounded-full ${
                    health?.environment.pythonReady ? "bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.6)]" : "bg-red-400"
                  }`}
                />
                <span className="text-sm font-bold text-white">
                  {health?.environment.pythonReady ? "Active (Python venv)" : "Not Configured"}
                </span>
              </div>
              <p className="text-[10px] text-slate-500">
                {health?.provider.message || "services/meta-ads-collector/.venv"}
              </p>
            </div>
          </div>

          {/* Card 2: Source Availability */}
          <div className="p-4 rounded-xl bg-[#111827] border border-[#1f293d] flex flex-col justify-between">
            <div className="flex items-center justify-between mb-2">
              <span className="text-[11px] font-semibold text-slate-400">Source Protocol</span>
              <Globe2 className="h-4 w-4 text-blue-400" />
            </div>
            <div>
              <div className="flex items-center gap-1.5 mb-1">
                <span className="h-2 w-2 rounded-full bg-emerald-400" />
                <span className="text-sm font-bold text-white">Public Ad Library</span>
              </div>
              <p className="text-[10px] text-slate-500">
                Market: {health?.environment.defaultCountry || "US"} (Zero token cost)
              </p>
            </div>
          </div>

          {/* Card 3: Background Worker */}
          <div className="p-4 rounded-xl bg-[#111827] border border-[#1f293d] flex flex-col justify-between">
            <div className="flex items-center justify-between mb-2">
              <span className="text-[11px] font-semibold text-slate-400">Background Worker</span>
              <Activity className="h-4 w-4 text-indigo-400" />
            </div>
            <div>
              <div className="flex items-center gap-1.5 mb-1">
                <span
                  className={`h-2 w-2 rounded-full ${
                    health?.worker.status === "RUNNING"
                      ? "bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.6)]"
                      : "bg-amber-400"
                  }`}
                />
                <span className="text-sm font-bold text-white">
                  {health?.worker.status === "RUNNING" ? "Worker Online" : "Worker Offline"}
                </span>
              </div>
              <p className="text-[10px] text-slate-500">
                {health?.worker.status === "RUNNING"
                  ? "Heartbeat active in database"
                  : "Start with: npm run discovery:worker"}
              </p>
            </div>
          </div>

          {/* Card 4: Historical Retrieval */}
          <div className="p-4 rounded-xl bg-[#111827] border border-[#1f293d] flex flex-col justify-between">
            <div className="flex items-center justify-between mb-2">
              <span className="text-[11px] font-semibold text-slate-400">Latest Valid Ads</span>
              <ShieldCheck className="h-4 w-4 text-emerald-400" />
            </div>
            <div>
              <div className="text-sm font-bold text-white mb-1">
                {health?.history.lastSuccessfulRecordCount || 0} ads verified
              </div>
              <p className="text-[10px] text-slate-500">
                {health?.history.lastSuccessfulRetrievalAt
                  ? `Last retrieved: ${new Date(health.history.lastSuccessfulRetrievalAt).toLocaleTimeString()}`
                  : "No recent collections"}
              </p>
            </div>
          </div>
        </div>

        {/* 2. New Research Search Form */}
        <div className="p-6 rounded-xl bg-[#111827] border border-[#1f293d] shadow-sm">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-sm font-bold text-white flex items-center gap-2">
                <Search className="h-4 w-4 text-blue-400" />
                <span>Launch New Meta Ad Library Search</span>
              </h2>
              <p className="text-[11px] text-slate-400 mt-0.5">
                Executes bounded keyword discovery on facebook.com/ads/library via local MCP stdio collector
              </p>
            </div>
            <span className="text-[10px] text-slate-500 font-mono">
              Limit: {requestedLimit} ads max
            </span>
          </div>

          <form onSubmit={handleCreateRequest} className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {/* Keywords Input */}
              <div className="md:col-span-2">
                <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                  Search Keywords <span className="text-blue-400">*</span>
                </label>
                <div className="relative">
                  <input
                    type="text"
                    placeholder="e.g. pet hair remover, portable blender, teeth whitening"
                    value={keywordsInput}
                    onChange={(e) => setKeywordsInput(e.target.value)}
                    className="w-full px-3.5 py-2.5 rounded-lg bg-slate-900 border border-slate-800 text-xs text-slate-200 placeholder-slate-600 focus:outline-none focus:border-blue-500"
                    required
                  />
                </div>
                <p className="text-[10px] text-slate-500 mt-1">
                  Separate multiple keywords with commas. Search operates on US commercial ads.
                </p>
              </div>

              {/* Requested Limit */}
              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                  Max Ads to Retrieve
                </label>
                <select
                  value={requestedLimit}
                  onChange={(e) => setRequestedLimit(parseInt(e.target.value, 10))}
                  className="w-full px-3 py-2.5 rounded-lg bg-slate-900 border border-slate-800 text-xs text-slate-200 focus:outline-none focus:border-blue-500 cursor-pointer"
                >
                  <option value={5}>5 Ads (Fast check)</option>
                  <option value={10}>10 Ads (Standard)</option>
                  <option value={25}>25 Ads (Comprehensive)</option>
                  <option value={50}>50 Ads (Deep dive)</option>
                  <option value={100}>100 Ads (Exhaustive)</option>
                </select>
                <p className="text-[10px] text-slate-500 mt-1">
                  Bounded retrieval prevents rate limits.
                </p>
              </div>
            </div>

            {/* Advanced Filters Grid */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 pt-2 border-t border-slate-800/60">
              {/* Status */}
              <div>
                <label className="block text-[11px] font-semibold text-slate-400 mb-1">
                  Delivery Status
                </label>
                <select
                  value={activeStatus}
                  onChange={(e) => setActiveStatus(e.target.value as any)}
                  className="w-full px-3 py-2 rounded-lg bg-slate-900 border border-slate-800 text-xs text-slate-300 focus:outline-none focus:border-blue-500 cursor-pointer"
                >
                  <option value="ACTIVE">ACTIVE (Currently delivering)</option>
                  <option value="ALL">ALL (Active & Inactive)</option>
                  <option value="INACTIVE">INACTIVE only</option>
                </select>
              </div>

              {/* Creative Preference */}
              <div>
                <label className="block text-[11px] font-semibold text-slate-400 mb-1">
                  Format Preference
                </label>
                <select
                  value={creativePreference}
                  onChange={(e) => setCreativePreference(e.target.value as any)}
                  className="w-full px-3 py-2 rounded-lg bg-slate-900 border border-slate-800 text-xs text-slate-300 focus:outline-none focus:border-blue-500 cursor-pointer"
                >
                  <option value="ALL">ALL Formats</option>
                  <option value="VIDEO">Videos only</option>
                  <option value="IMAGE">Images only</option>
                </select>
              </div>

              {/* Optional Advertiser Page ID */}
              <div>
                <label className="block text-[11px] font-semibold text-slate-400 mb-1">
                  Specific Page ID (Optional)
                </label>
                <input
                  type="text"
                  placeholder="e.g. 109823485721"
                  value={advertiserPageId}
                  onChange={(e) => setAdvertiserPageId(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg bg-slate-900 border border-slate-800 text-xs text-slate-300 placeholder-slate-700 focus:outline-none focus:border-blue-500"
                />
              </div>
            </div>

            {/* Submit Action */}
            <div className="flex items-center justify-between pt-2">
              <div className="text-[11px] text-slate-500 flex items-center gap-1.5">
                <Terminal className="h-3.5 w-3.5 text-slate-400" />
                <span>Runs asynchronously in background worker with durable checkpoints.</span>
              </div>
              <button
                type="submit"
                disabled={submitting}
                className="flex items-center gap-2 px-5 py-2.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold shadow-md transition-all disabled:opacity-50 cursor-pointer"
              >
                {submitting ? (
                  <>
                    <RefreshCw className="h-4 w-4 animate-spin" />
                    <span>Queuing Task...</span>
                  </>
                ) : (
                  <>
                    <Play className="h-4 w-4 fill-current" />
                    <span>Queue Meta Research Task</span>
                  </>
                )}
              </button>
            </div>
          </form>
        </div>

        {/* 3. Research Jobs Panel */}
        <div className="p-6 rounded-xl bg-[#111827] border border-[#1f293d] space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-sm font-bold text-white flex items-center gap-2">
                <Layers className="h-4 w-4 text-blue-400" />
                <span>Research Jobs Ledger</span>
              </h2>
              <p className="text-[11px] text-slate-400 mt-0.5">
                Durable execution history, verifiable outcome counters, and run-to-ad associations
              </p>
            </div>
            <span className="text-xs text-slate-400 font-mono">
              {requests.length} task{requests.length !== 1 ? "s" : ""}
            </span>
          </div>

          {requests.length === 0 ? (
            <div className="p-8 rounded-lg bg-slate-900/50 border border-slate-800 text-center">
              <Globe2 className="h-8 w-8 text-slate-600 mx-auto mb-2" />
              <p className="text-xs font-medium text-slate-400">No Meta research tasks created yet.</p>
              <p className="text-[11px] text-slate-600 mt-1">
                Enter a keyword above to start collecting factual public Facebook Ad Library records.
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-slate-800 text-slate-400 text-[11px]">
                    <th className="pb-2.5 font-semibold">Job ID</th>
                    <th className="pb-2.5 font-semibold">Keywords / Market</th>
                    <th className="pb-2.5 font-semibold">Status</th>
                    <th className="pb-2.5 font-semibold">Counters (Retr / Valid / New / Dups)</th>
                    <th className="pb-2.5 font-semibold">Created</th>
                    <th className="pb-2.5 font-semibold text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60">
                  {requests.map((job) => (
                    <tr key={job.id} className="hover:bg-slate-900/40 transition-colors">
                      {/* Job ID & Provider */}
                      <td className="py-3 pr-3 font-mono text-[11px] text-slate-300">
                        <span className="text-blue-400 font-semibold">{job.id.slice(0, 10)}...</span>
                        <div className="text-[10px] text-slate-500 font-sans">{job.providerId}</div>
                      </td>

                      {/* Keywords & Market */}
                      <td className="py-3 pr-3">
                        <div className="font-medium text-white flex items-center gap-1.5 flex-wrap">
                          {job.keywords.map((k, idx) => (
                            <span
                              key={idx}
                              className="px-1.5 py-0.5 rounded bg-slate-800 border border-slate-700 text-[10px] font-mono text-slate-300"
                            >
                              {k}
                            </span>
                          ))}
                        </div>
                        <span className="text-[10px] text-slate-500">Market: {job.market}</span>
                      </td>

                      {/* Status */}
                      <td className="py-3 pr-3">
                        <span
                          className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold border ${getStatusBadge(
                            job.status
                          )}`}
                        >
                          {job.status}
                        </span>
                        {job.errorMessage && (
                          <p className="text-[10px] text-red-400/80 mt-1 max-w-xs truncate" title={job.errorMessage}>
                            {job.errorMessage}
                          </p>
                        )}
                      </td>

                      {/* Counters */}
                      <td className="py-3 pr-3 font-mono text-[11px]">
                        <span className="text-white font-semibold">{job.actualRetrievedCount}</span>
                        <span className="text-slate-500"> / </span>
                        <span className="text-emerald-400 font-semibold">{job.validCount}</span>
                        <span className="text-slate-500"> / </span>
                        <span className="text-blue-400 font-semibold">+{job.newUniqueCount}</span>
                        <span className="text-slate-500"> / </span>
                        <span className="text-slate-400">{job.existingDuplicateCount}</span>
                      </td>

                      {/* Created Time */}
                      <td className="py-3 pr-3 text-slate-400 text-[11px]">
                        {new Date(job.createdAt).toLocaleTimeString(undefined, {
                          hour: "2-digit",
                          minute: "2-digit",
                          second: "2-digit",
                        })}
                      </td>

                      {/* Actions */}
                      <td className="py-3 text-right">
                        <div className="flex items-center justify-end gap-1.5">
                          {/* View in Explorer */}
                          <Link
                            href={`/explorer?platform=META&requestId=${job.id}`}
                            className="inline-flex items-center gap-1 px-2.5 py-1 rounded bg-blue-600/20 hover:bg-blue-600/30 text-blue-300 border border-blue-500/30 text-[11px] font-medium transition-colors"
                            title="Inspect exactly the ads retrieved in this run"
                          >
                            <span>View Ads</span>
                            <ExternalLink className="h-3 w-3" />
                          </Link>

                          {/* Cancel if active */}
                          {(job.status === "PENDING" || job.status === "RUNNING") && (
                            <button
                              onClick={() => handleCancel(job.id)}
                              className="inline-flex items-center gap-1 px-2 py-1 rounded bg-rose-950/40 hover:bg-rose-900/60 text-rose-300 border border-rose-800/40 text-[11px] font-medium transition-colors cursor-pointer"
                              title="Cancel execution"
                            >
                              <Ban className="h-3 w-3" />
                              <span>Cancel</span>
                            </button>
                          )}

                          {/* Retry if failed/cancelled */}
                          {(job.status === "FAILED" ||
                            job.status === "CANCELLED" ||
                            job.status === "BLOCKED_SOURCE") && (
                            <button
                              onClick={() => handleRetry(job.id)}
                              className="inline-flex items-center gap-1 px-2 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 text-[11px] font-medium transition-colors cursor-pointer"
                              title="Create a new retry attempt"
                            >
                              <RotateCcw className="h-3 w-3" />
                              <span>Retry</span>
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* 4. Diagnostics Modal */}
        {diagnosticsOpen && (
          <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
            <div className="bg-[#111827] border border-[#1f293d] rounded-2xl max-w-xl w-full p-6 space-y-4 shadow-2xl">
              <div className="flex items-center justify-between pb-3 border-b border-slate-800">
                <div className="flex items-center gap-2">
                  <Cpu className="h-5 w-5 text-blue-400" />
                  <h3 className="text-sm font-bold text-white">MetaAdsCollector System Diagnostics</h3>
                </div>
                <button
                  onClick={() => setDiagnosticsOpen(false)}
                  className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              <div className="space-y-3 text-xs">
                <div className="p-3 rounded-lg bg-slate-900 border border-slate-800 space-y-1.5 font-mono">
                  <div className="flex justify-between">
                    <span className="text-slate-400">Local MCP Client:</span>
                    <span className="text-emerald-400 font-semibold">READY (stdio transport)</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-400">Python Binary:</span>
                    <span className="text-slate-200">{health?.environment.pythonReady ? "Found" : "Missing"}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-400">Collector Data Dir:</span>
                    <span className="text-slate-200">{health?.environment.dataDirReady ? "Accessible" : "Missing"}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-400">Worker Status:</span>
                    <span className={health?.worker.status === "RUNNING" ? "text-emerald-400" : "text-amber-400"}>
                      {health?.worker.status}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-400">Max Results Budget:</span>
                    <span className="text-slate-200">{health?.limits.maxResultsPerSearch} ads</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-400">Max Requests Budget:</span>
                    <span className="text-slate-200">{health?.limits.maxRequestsPerSearch}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-400">Execution Timeout:</span>
                    <span className="text-slate-200">{health?.limits.maxExecutionSeconds}s</span>
                  </div>
                </div>

                <div className="p-3 rounded-lg bg-blue-950/20 border border-blue-800/30 text-[11px] text-blue-300">
                  <p className="font-semibold mb-1">Architecture Guarantee:</p>
                  <p className="leading-relaxed">
                    MetaAdsCollector operates strictly within your local machine. No external gateway, ngrok,
                    or Cloudflare tunnel is required. Public Meta Ad Library endpoints are queried without
                    third-party paid API intermediaries.
                  </p>
                </div>
              </div>

              <div className="pt-3 border-t border-slate-800 flex justify-end">
                <button
                  onClick={() => setDiagnosticsOpen(false)}
                  className="px-4 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-white text-xs font-semibold transition-colors cursor-pointer"
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
