"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import {
  Globe2,
  Sparkles,
  ShieldCheck,
  ShieldAlert,
  Clock,
  CheckCircle2,
  AlertTriangle,
  Play,
  RotateCcw,
  RefreshCw,
  ExternalLink,
  Upload,
  FileCode,
  Layers,
  Search,
  Filter,
  Eye,
  Sliders,
  X,
  Radio,
} from "lucide-react";
import { Header } from "@/components/layout/Header";

interface MuseBridgeStatus {
  isConfigured: boolean;
  connectionState: string;
  executionMode: string;
  lastHeartbeatAt: string | null;
  lastSubmissionAt: string | null;
  pendingRequestsCount: number;
  runningRequestsCount: number;
  completedRequestsCount: number;
  failedRequestsCount: number;
  agentSessionId: string | null;
  notice: string;
}

interface MuseRequestItem {
  requestId: string;
  status: string;
  providerId: string;
  platform: string;
  keywords: string[];
  market: string;
  targetCount: number;
  creativePreference?: string;
  actualRetrievedCount: number;
  validCount: number;
  newUniqueCount: number;
  existingDuplicateCount: number;
  rejectedCount: number;
  failedCount: number;
  errorMessage: string | null;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  heartbeatAt: string | null;
}

export default function MetaDiscoveryPage() {
  const [bridgeStatus, setBridgeStatus] = useState<MuseBridgeStatus | null>(null);
  const [requests, setRequests] = useState<MuseRequestItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // Form state
  const [keywordsInput, setKeywordsInput] = useState("");
  const [category, setCategory] = useState("ALL");
  const [creativePreference, setCreativePreference] = useState<"VIDEO" | "IMAGE" | "CAROUSEL" | "ALL">("VIDEO");
  const [targetCount, setTargetCount] = useState<number>(25);
  const [submitting, setSubmitting] = useState(false);

  // Drawer / Modal state
  const [selectedRequest, setSelectedRequest] = useState<MuseRequestItem | null>(null);
  const [artifactModalOpen, setArtifactModalOpen] = useState(false);
  const [artifactTargetRequestId, setArtifactTargetRequestId] = useState<string>("");
  const [artifactJson, setArtifactJson] = useState("");
  const [artifactSubmitting, setArtifactSubmitting] = useState(false);
  const [artifactResult, setArtifactResult] = useState<any | null>(null);

  // Fetch bridge status and requests
  const fetchData = useCallback(async () => {
    try {
      setRefreshing(true);
      setError(null);

      // Fetch bridge health
      const bridgeRes = await fetch("/api/v1/discovery/muse/bridge");
      if (bridgeRes.ok) {
        const bJson = await bridgeRes.json();
        if (bJson.success) setBridgeStatus(bJson.data);
      }

      // Fetch queue items
      const queueRes = await fetch("/api/v1/discovery/muse/requests?status=ALL&limit=50", {
        headers: {
          // Use default admin token if available via session or header
          "x-muse-token": "dev_session_token",
        },
      });

      if (queueRes.ok) {
        const qJson = await queueRes.json();
        if (qJson.success) setRequests(qJson.data);
      }
    } catch (err: unknown) {
      console.warn("Failed to load Meta discovery data:", err);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 15000); // 15s polling
    return () => clearInterval(interval);
  }, [fetchData]);

  // Create Muse Research Request
  const handleCreateRequest = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!keywordsInput.trim()) {
      setError("Please enter at least one keyword for Meta Ad Library research.");
      return;
    }

    try {
      setSubmitting(true);
      setError(null);
      setSuccessMsg(null);

      const keywords = keywordsInput
        .split(",")
        .map((k) => k.trim())
        .filter((k) => k.length > 0);

      const res = await fetch("/api/v1/discovery/muse/requests", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-muse-token": "dev_session_token",
        },
        body: JSON.stringify({
          keywords,
          market: "US",
          requestedLimit: targetCount,
          category: category !== "ALL" ? category : undefined,
          creativePreference,
        }),
      });

      const json = await res.json();
      if (!res.ok || !json.success) {
        throw new Error(json.error?.message || "Failed to create research request.");
      }

      setSuccessMsg(`Research request '${json.data.requestId}' created! Waiting for Muse research execution.`);
      setKeywordsInput("");
      await fetchData();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Error creating request.");
    } finally {
      setSubmitting(false);
    }
  };

  // Cancel Request
  const handleCancelRequest = async (id: string) => {
    try {
      const res = await fetch(`/api/v1/discovery/muse/requests/${id}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          "x-muse-token": "dev_session_token",
        },
        body: JSON.stringify({ status: "CANCELLED" }),
      });
      if (res.ok) {
        await fetchData();
      }
    } catch (err) {
      console.error("Cancel failed:", err);
    }
  };

  // Submit Artifact (Mode C bridge fallback)
  const handleSubmitArtifact = async () => {
    if (!artifactTargetRequestId || !artifactJson.trim()) {
      setError("Please specify request ID and valid JSON payload.");
      return;
    }

    try {
      setArtifactSubmitting(true);
      setArtifactResult(null);

      let parsed: any;
      try {
        parsed = JSON.parse(artifactJson);
      } catch {
        throw new Error("Invalid JSON format. Please verify the research artifact.");
      }

      const payload = Array.isArray(parsed) ? { records: parsed } : parsed;

      const res = await fetch(`/api/v1/discovery/muse/requests/${artifactTargetRequestId}/results`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-muse-token": "dev_session_token",
        },
        body: JSON.stringify(payload),
      });

      const json = await res.json();
      if (!res.ok || !json.success) {
        throw new Error(json.error?.message || "Submission failed.");
      }

      setArtifactResult(json.data);
      setSuccessMsg(`Artifact successfully ingested! ${json.data.newUniqueInserted} new ads committed.`);
      await fetchData();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Artifact submission failed.");
    } finally {
      setArtifactSubmitting(false);
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "COMPLETED":
        return "bg-emerald-500/15 text-emerald-400 border-emerald-500/30";
      case "PARTIALLY_COMPLETED":
        return "bg-cyan-500/15 text-cyan-400 border-cyan-500/30";
      case "RUNNING":
      case "CLAIMED":
        return "bg-amber-500/15 text-amber-400 border-amber-500/30 animate-pulse";
      case "PENDING":
        return "bg-indigo-500/15 text-indigo-400 border-indigo-500/30";
      case "CANCELLED":
        return "bg-slate-800 text-slate-400 border-slate-700";
      case "FAILED":
      default:
        return "bg-rose-500/15 text-rose-400 border-rose-500/30";
    }
  };

  return (
    <div className="flex-1 flex flex-col min-h-screen bg-[#090d16] text-slate-100">
      <Header />

      <main className="flex-1 p-6 max-w-7xl mx-auto w-full space-y-6">
        {/* Top Header Banner */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-[#1f293d] pb-5">
          <div>
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-gradient-to-tr from-blue-600 to-indigo-600 text-white shadow-lg shadow-blue-500/20">
                <Globe2 className="h-6 w-6" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h1 className="text-xl font-bold text-white tracking-tight">
                    Meta Ads Discovery & Muse AI Research
                  </h1>
                  <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-blue-500/20 text-blue-400 border border-blue-500/30 uppercase">
                    Primary Platform
                  </span>
                  <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 uppercase">
                    US Market 🇺🇸
                  </span>
                </div>
                <p className="text-xs text-slate-400 mt-0.5">
                  Asynchronous research on public Meta Ad Library with verified Library IDs, start dates, and video creatives.
                </p>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2.5">
            <button
              onClick={fetchData}
              disabled={refreshing}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-900 border border-slate-800 text-xs font-medium text-slate-300 hover:text-white hover:bg-slate-800 transition-all cursor-pointer"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${refreshing ? "animate-spin text-indigo-400" : ""}`} />
              <span>Refresh</span>
            </button>

            <Link
              href="/explorer?platform=META"
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-600/20 text-blue-400 border border-blue-500/30 text-xs font-medium hover:bg-blue-600/30 transition-all"
            >
              <span>View Meta Ads Explorer</span>
              <ExternalLink className="h-3 w-3" />
            </Link>

            <button
              onClick={() => {
                setArtifactTargetRequestId(requests.find((r) => r.status === "PENDING" || r.status === "RUNNING")?.requestId || "");
                setArtifactModalOpen(true);
              }}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-indigo-600 text-white text-xs font-medium hover:bg-indigo-500 shadow-sm transition-all cursor-pointer"
            >
              <Upload className="h-3.5 w-3.5" />
              <span>Import Artifact</span>
            </button>
          </div>
        </div>

        {/* Alerts & Messages */}
        {error && (
          <div className="p-3.5 rounded-lg bg-rose-950/40 border border-rose-800/40 text-rose-300 text-xs flex items-center justify-between">
            <div className="flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 shrink-0 text-rose-400" />
              <span>{error}</span>
            </div>
            <button onClick={() => setError(null)} className="text-rose-400 hover:text-rose-200">
              <X className="h-4 w-4" />
            </button>
          </div>
        )}

        {successMsg && (
          <div className="p-3.5 rounded-lg bg-emerald-950/40 border border-emerald-800/40 text-emerald-300 text-xs flex items-center justify-between">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-400" />
              <span>{successMsg}</span>
            </div>
            <button onClick={() => setSuccessMsg(null)} className="text-emerald-400 hover:text-emerald-200">
              <X className="h-4 w-4" />
            </button>
          </div>
        )}

        {/* Live Muse Bridge Status Card */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <div className="bg-[#0f172a] rounded-xl border border-[#1f293d] p-4 flex flex-col justify-between shadow-sm">
            <div>
              <div className="flex items-center justify-between text-xs text-slate-400 mb-1.5">
                <span className="font-semibold uppercase tracking-wider text-[10px]">Muse Bridge Status</span>
                <span className="h-2 w-2 rounded-full bg-blue-400 animate-ping" />
              </div>
              <div className="flex items-center gap-2">
                <span
                  className={`text-xs font-semibold px-2 py-0.5 rounded border ${
                    bridgeStatus?.connectionState === "AGENT_CONNECTED" || bridgeStatus?.connectionState === "RESEARCH_IN_PROGRESS"
                      ? "bg-emerald-500/15 text-emerald-400 border-emerald-500/30"
                      : bridgeStatus?.connectionState === "LIVE_VERIFIED"
                      ? "bg-blue-500/15 text-blue-400 border-blue-500/30"
                      : "bg-amber-500/15 text-amber-400 border-amber-500/30"
                  }`}
                >
                  {bridgeStatus?.connectionState || "CHECKING..."}
                </span>
              </div>
            </div>
            <p className="text-[11px] text-slate-400 mt-2 line-clamp-2 leading-relaxed">
              {bridgeStatus?.notice || "Checking Muse bridge connectivity..."}
            </p>
          </div>

          <div className="bg-[#0f172a] rounded-xl border border-[#1f293d] p-4 flex flex-col justify-between shadow-sm">
            <div>
              <span className="font-semibold uppercase tracking-wider text-[10px] text-slate-400 block mb-1.5">
                Execution Mode
              </span>
              <span className="text-xs font-semibold text-slate-200">
                {bridgeStatus?.executionMode || "MUSE_AGENT_CONNECTION_NOT_VERIFIED"}
              </span>
            </div>
            <div className="text-[11px] text-slate-500 mt-2">
              <span>Token Configured: </span>
              <span className={bridgeStatus?.isConfigured ? "text-emerald-400" : "text-amber-400"}>
                {bridgeStatus?.isConfigured ? "YES (MUSE_INGESTION_TOKEN)" : "NO (Admin Fallback)"}
              </span>
            </div>
          </div>

          <div className="bg-[#0f172a] rounded-xl border border-[#1f293d] p-4 flex flex-col justify-between shadow-sm">
            <div>
              <span className="font-semibold uppercase tracking-wider text-[10px] text-slate-400 block mb-1.5">
                Queue Activity
              </span>
              <div className="flex items-center gap-3">
                <div>
                  <span className="text-lg font-bold text-white">{bridgeStatus?.pendingRequestsCount ?? 0}</span>
                  <span className="text-[10px] text-slate-400 block">Pending</span>
                </div>
                <div className="h-6 w-px bg-slate-800" />
                <div>
                  <span className="text-lg font-bold text-amber-400">{bridgeStatus?.runningRequestsCount ?? 0}</span>
                  <span className="text-[10px] text-slate-400 block">Running</span>
                </div>
                <div className="h-6 w-px bg-slate-800" />
                <div>
                  <span className="text-lg font-bold text-emerald-400">{bridgeStatus?.completedRequestsCount ?? 0}</span>
                  <span className="text-[10px] text-slate-400 block">Completed</span>
                </div>
              </div>
            </div>
            <div className="text-[10px] text-slate-500 mt-2 truncate font-mono">
              Heartbeat: {bridgeStatus?.lastHeartbeatAt ? new Date(bridgeStatus.lastHeartbeatAt).toLocaleTimeString() : "No active lease"}
            </div>
          </div>

          <div className="bg-[#0f172a] rounded-xl border border-[#1f293d] p-4 flex flex-col justify-between shadow-sm">
            <div>
              <span className="font-semibold uppercase tracking-wider text-[10px] text-slate-400 block mb-1.5">
                Last Verified Results
              </span>
              <div className="text-xs font-semibold text-slate-200">
                {bridgeStatus?.lastSubmissionAt ? new Date(bridgeStatus.lastSubmissionAt).toLocaleDateString() : "No submissions yet"}
              </div>
            </div>
            <div className="flex items-center gap-1.5 text-[11px] text-slate-400 mt-2">
              <ShieldCheck className="h-3.5 w-3.5 text-blue-400" />
              <span>Free discovery ($0 API spend)</span>
            </div>
          </div>
        </div>

        {/* Research Request Creation Card */}
        <div className="bg-[#0f172a] rounded-xl border border-[#1f293d] p-5 shadow-sm">
          <div className="flex items-center gap-2 mb-4 border-b border-[#1f293d]/80 pb-3">
            <Sliders className="h-4 w-4 text-blue-400" />
            <h2 className="text-sm font-semibold text-white">Create Meta Ad Library Research Request</h2>
          </div>

          <form onSubmit={handleCreateRequest} className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="md:col-span-2 space-y-1.5">
                <label className="text-xs font-medium text-slate-300">
                  Search Keywords (comma separated) <span className="text-rose-400">*</span>
                </label>
                <div className="relative">
                  <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-500" />
                  <input
                    type="text"
                    value={keywordsInput}
                    onChange={(e) => setKeywordsInput(e.target.value)}
                    placeholder="e.g. pet hair remover, dog shedding brush, sofa cleaner"
                    className="w-full pl-9 pr-3 py-2 rounded-lg bg-slate-900 border border-slate-800 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-blue-500 transition-all"
                  />
                </div>
                <p className="text-[10px] text-slate-500">
                  Muse will search the public Meta Ad Library in the US market using these exact commercial terms.
                </p>
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-medium text-slate-300">Product Category</label>
                <select
                  value={category}
                  onChange={(e) => setCategory(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg bg-slate-900 border border-slate-800 text-xs text-slate-200 focus:outline-none focus:border-blue-500 transition-all cursor-pointer"
                >
                  <option value="ALL">All Categories</option>
                  <option value="Home & Kitchen">Home & Kitchen</option>
                  <option value="Beauty & Personal Care">Beauty & Personal Care</option>
                  <option value="Gadgets & Electronics">Gadgets & Electronics</option>
                  <option value="Pet Supplies">Pet Supplies</option>
                  <option value="Health & Fitness">Health & Fitness</option>
                  <option value="Fashion & Apparel">Fashion & Apparel</option>
                </select>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 pt-2">
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-slate-300">Creative Format Preference</label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setCreativePreference("VIDEO")}
                    className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-all cursor-pointer ${
                      creativePreference === "VIDEO"
                        ? "bg-blue-600/20 text-blue-400 border-blue-500/40"
                        : "bg-slate-900 text-slate-400 border-slate-800 hover:text-slate-200"
                    }`}
                  >
                    Video Preferred 🎬
                  </button>
                  <button
                    type="button"
                    onClick={() => setCreativePreference("ALL")}
                    className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-all cursor-pointer ${
                      creativePreference === "ALL"
                        ? "bg-blue-600/20 text-blue-400 border-blue-500/40"
                        : "bg-slate-900 text-slate-400 border-slate-800 hover:text-slate-200"
                    }`}
                  >
                    All Formats 📁
                  </button>
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-medium text-slate-300">Target Results Count</label>
                <select
                  value={targetCount}
                  onChange={(e) => setTargetCount(Number(e.target.value))}
                  className="w-full px-3 py-2 rounded-lg bg-slate-900 border border-slate-800 text-xs text-slate-200 focus:outline-none focus:border-blue-500 transition-all cursor-pointer"
                >
                  <option value={5}>5 Verified Ads</option>
                  <option value={10}>10 Verified Ads</option>
                  <option value={25}>25 Verified Ads (Standard)</option>
                  <option value={50}>50 Verified Ads (Deep Research)</option>
                </select>
              </div>

              <div className="flex items-end">
                <button
                  type="submit"
                  disabled={submitting}
                  className="w-full px-4 py-2 rounded-lg bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white text-xs font-semibold shadow-md shadow-blue-500/20 transition-all cursor-pointer flex items-center justify-center gap-2 disabled:opacity-50"
                >
                  {submitting ? (
                    <>
                      <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                      <span>Queueing Request...</span>
                    </>
                  ) : (
                    <>
                      <Sparkles className="h-3.5 w-3.5" />
                      <span>Create Muse Research Request</span>
                    </>
                  )}
                </button>
              </div>
            </div>
          </form>
        </div>

        {/* Request Queue & History Table */}
        <div className="bg-[#0f172a] rounded-xl border border-[#1f293d] overflow-hidden shadow-sm">
          <div className="p-4 border-b border-[#1f293d] flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Clock className="h-4 w-4 text-blue-400" />
              <h2 className="text-sm font-semibold text-white">Research Request Queue & Execution History</h2>
              <span className="text-[10px] px-2 py-0.5 rounded bg-slate-800 text-slate-400 font-mono">
                {requests.length} requests
              </span>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs text-slate-300">
              <thead className="bg-slate-900/80 text-[10px] font-semibold text-slate-400 uppercase tracking-wider border-b border-slate-800">
                <tr>
                  <th className="p-3">Request ID</th>
                  <th className="p-3">Keywords</th>
                  <th className="p-3">Status</th>
                  <th className="p-3">Target</th>
                  <th className="p-3">Results (New / Upd / Rej)</th>
                  <th className="p-3">Created</th>
                  <th className="p-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60 font-mono text-[11px]">
                {requests.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="p-8 text-center text-slate-500">
                      No research requests queued yet. Enter keywords above to initiate Meta discovery.
                    </td>
                  </tr>
                ) : (
                  requests.map((r) => (
                    <tr key={r.requestId} className="hover:bg-slate-900/50 transition-colors">
                      <td className="p-3 font-semibold text-blue-400">
                        {r.requestId.slice(0, 10)}...
                      </td>
                      <td className="p-3 font-sans text-slate-200">
                        <div className="flex flex-wrap gap-1 max-w-xs">
                          {r.keywords.map((kw, i) => (
                            <span key={i} className="px-1.5 py-0.5 rounded bg-slate-800 text-[10px] text-slate-300 border border-slate-700">
                              {kw}
                            </span>
                          ))}
                        </div>
                      </td>
                      <td className="p-3 font-sans">
                        <span className={`px-2 py-0.5 rounded text-[10px] font-semibold border ${getStatusBadge(r.status)}`}>
                          {r.status}
                        </span>
                      </td>
                      <td className="p-3">{r.targetCount}</td>
                      <td className="p-3">
                        <span className="text-emerald-400 font-semibold">{r.newUniqueCount}</span>
                        <span className="text-slate-500"> / </span>
                        <span className="text-blue-400">{r.existingDuplicateCount}</span>
                        <span className="text-slate-500"> / </span>
                        <span className="text-rose-400">{r.rejectedCount}</span>
                      </td>
                      <td className="p-3 text-slate-400 text-[10px]">
                        {new Date(r.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                      </td>
                      <td className="p-3 text-right font-sans space-x-2">
                        <button
                          onClick={() => setSelectedRequest(r)}
                          className="px-2 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white text-[10px] font-medium transition-colors cursor-pointer"
                        >
                          Details
                        </button>

                        {r.status === "PENDING" && (
                          <button
                            onClick={() => handleCancelRequest(r.requestId)}
                            className="px-2 py-1 rounded bg-rose-950/40 hover:bg-rose-900/50 text-rose-300 border border-rose-800/40 text-[10px] font-medium transition-colors cursor-pointer"
                          >
                            Cancel
                          </button>
                        )}

                        {(r.status === "PENDING" || r.status === "RUNNING") && (
                          <button
                            onClick={() => {
                              setArtifactTargetRequestId(r.requestId);
                              setArtifactModalOpen(true);
                            }}
                            className="px-2 py-1 rounded bg-indigo-900/40 hover:bg-indigo-800/50 text-indigo-300 border border-indigo-700/40 text-[10px] font-medium transition-colors cursor-pointer"
                          >
                            Submit Results
                          </button>
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Modal: Import Muse Research Artifact (Mode C Bridge Fallback) */}
        {artifactModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
            <div className="bg-[#0f172a] rounded-xl border border-[#1f293d] w-full max-w-2xl overflow-hidden shadow-2xl animate-in fade-in duration-150">
              <div className="p-4 border-b border-[#1f293d] flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <FileCode className="h-5 w-5 text-indigo-400" />
                  <h3 className="text-sm font-semibold text-white">Import Muse Research Artifact (JSON)</h3>
                </div>
                <button
                  onClick={() => {
                    setArtifactModalOpen(false);
                    setArtifactResult(null);
                  }}
                  className="text-slate-400 hover:text-white"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              <div className="p-5 space-y-4">
                <p className="text-xs text-slate-400 leading-relaxed">
                  When Muse operates in a browser conversation without direct connectivity to localhost:3000,
                  paste Muse&apos;s structured JSON research output below. SWAI will normalize, verify, and commit the ads to the database.
                </p>

                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-slate-300">Target Request ID</label>
                  <input
                    type="text"
                    value={artifactTargetRequestId}
                    onChange={(e) => setArtifactTargetRequestId(e.target.value)}
                    placeholder="Enter or select Request ID"
                    className="w-full px-3 py-2 rounded-lg bg-slate-900 border border-slate-800 text-xs text-slate-200 focus:outline-none focus:border-indigo-500 font-mono"
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-slate-300">
                    Muse JSON Records Array or Submission Payload
                  </label>
                  <textarea
                    rows={8}
                    value={artifactJson}
                    onChange={(e) => setArtifactJson(e.target.value)}
                    placeholder={`[
  {
    "libraryId": "1642750633880173",
    "advertiserName": "Uproot Clean",
    "headline": "Pet Hair Remover Pro",
    "mediaType": "VIDEO",
    "sourceReportedStartAt": "2025-11-02",
    "activeStatus": "ACTIVE"
  }
]`}
                    className="w-full px-3 py-2 rounded-lg bg-slate-900 border border-slate-800 text-xs text-slate-200 focus:outline-none focus:border-indigo-500 font-mono leading-relaxed"
                  />
                </div>

                {artifactResult && (
                  <div className="p-3 rounded-lg bg-emerald-950/40 border border-emerald-800/40 text-xs space-y-1">
                    <div className="flex items-center gap-1.5 text-emerald-400 font-semibold">
                      <CheckCircle2 className="h-4 w-4" />
                      <span>Ingestion Successful</span>
                    </div>
                    <p className="text-slate-300">
                      Total Submitted: {artifactResult.totalSubmitted} | New Unique Ads: {artifactResult.newUniqueInserted} | Duplicates: {artifactResult.existingUpdated} | Rejected: {artifactResult.rejectedCount}
                    </p>
                  </div>
                )}
              </div>

              <div className="p-4 border-t border-[#1f293d] flex items-center justify-end gap-2 bg-slate-900/60">
                <button
                  type="button"
                  onClick={() => {
                    setArtifactModalOpen(false);
                    setArtifactResult(null);
                  }}
                  className="px-3 py-1.5 rounded-lg text-xs font-medium text-slate-400 hover:text-white"
                >
                  Close
                </button>
                <button
                  type="button"
                  disabled={artifactSubmitting}
                  onClick={handleSubmitArtifact}
                  className="px-4 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold transition-all cursor-pointer disabled:opacity-50 flex items-center gap-1.5"
                >
                  {artifactSubmitting ? (
                    <>
                      <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                      <span>Ingesting...</span>
                    </>
                  ) : (
                    <span>Commit Artifact to Database</span>
                  )}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Drawer: Request Details */}
        {selectedRequest && (
          <div className="fixed inset-0 z-50 flex justify-end bg-black/60 backdrop-blur-sm">
            <div className="w-full max-w-lg bg-[#0f172a] border-l border-[#1f293d] h-full flex flex-col shadow-2xl animate-in slide-in-from-right duration-200">
              <div className="p-4 border-b border-[#1f293d] flex items-center justify-between">
                <div>
                  <h3 className="text-sm font-semibold text-white">Research Request Details</h3>
                  <p className="text-[10px] text-slate-500 font-mono">{selectedRequest.requestId}</p>
                </div>
                <button onClick={() => setSelectedRequest(null)} className="text-slate-400 hover:text-white">
                  <X className="h-4 w-4" />
                </button>
              </div>

              <div className="p-5 flex-1 overflow-y-auto space-y-4 text-xs">
                <div className="space-y-1">
                  <span className="text-[10px] font-semibold uppercase text-slate-400 tracking-wider">Status</span>
                  <div>
                    <span className={`px-2 py-0.5 rounded text-xs font-semibold border ${getStatusBadge(selectedRequest.status)}`}>
                      {selectedRequest.status}
                    </span>
                  </div>
                </div>

                <div className="space-y-1">
                  <span className="text-[10px] font-semibold uppercase text-slate-400 tracking-wider">Keywords</span>
                  <div className="flex flex-wrap gap-1">
                    {selectedRequest.keywords.map((kw, i) => (
                      <span key={i} className="px-2 py-0.5 rounded bg-slate-800 text-slate-200 border border-slate-700">
                        {kw}
                      </span>
                    ))}
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3 p-3 rounded-lg bg-slate-900/80 border border-slate-800 text-[11px]">
                  <div>
                    <span className="text-slate-500 block">Platform</span>
                    <span className="text-slate-200 font-semibold">{selectedRequest.platform}</span>
                  </div>
                  <div>
                    <span className="text-slate-500 block">Market</span>
                    <span className="text-slate-200 font-semibold">{selectedRequest.market}</span>
                  </div>
                  <div>
                    <span className="text-slate-500 block">Target Count</span>
                    <span className="text-slate-200 font-semibold">{selectedRequest.targetCount}</span>
                  </div>
                  <div>
                    <span className="text-slate-500 block">Creative Preference</span>
                    <span className="text-slate-200 font-semibold">{selectedRequest.creativePreference || "ALL"}</span>
                  </div>
                </div>

                <div className="space-y-2">
                  <span className="text-[10px] font-semibold uppercase text-slate-400 tracking-wider">Ingestion Counters</span>
                  <div className="grid grid-cols-3 gap-2 text-center">
                    <div className="p-2.5 rounded-lg bg-emerald-950/20 border border-emerald-800/30">
                      <span className="text-sm font-bold text-emerald-400 block">{selectedRequest.newUniqueCount}</span>
                      <span className="text-[10px] text-slate-400">New Ads</span>
                    </div>
                    <div className="p-2.5 rounded-lg bg-blue-950/20 border border-blue-800/30">
                      <span className="text-sm font-bold text-blue-400 block">{selectedRequest.existingDuplicateCount}</span>
                      <span className="text-[10px] text-slate-400">Duplicates</span>
                    </div>
                    <div className="p-2.5 rounded-lg bg-rose-950/20 border border-rose-800/30">
                      <span className="text-sm font-bold text-rose-400 block">{selectedRequest.rejectedCount}</span>
                      <span className="text-[10px] text-slate-400">Rejected</span>
                    </div>
                  </div>
                </div>

                {selectedRequest.errorMessage && (
                  <div className="p-3 rounded-lg bg-rose-950/40 border border-rose-800/40 text-rose-300 text-[11px]">
                    <span className="font-semibold block mb-0.5">Execution Error</span>
                    <span>{selectedRequest.errorMessage}</span>
                  </div>
                )}

                <div className="pt-3 border-t border-slate-800 space-y-1.5 text-[11px] text-slate-500">
                  <div className="flex justify-between">
                    <span>Created:</span>
                    <span className="text-slate-400">{new Date(selectedRequest.createdAt).toLocaleString()}</span>
                  </div>
                  {selectedRequest.startedAt && (
                    <div className="flex justify-between">
                      <span>Started / Claimed:</span>
                      <span className="text-slate-400">{new Date(selectedRequest.startedAt).toLocaleString()}</span>
                    </div>
                  )}
                  {selectedRequest.finishedAt && (
                    <div className="flex justify-between">
                      <span>Finished:</span>
                      <span className="text-slate-400">{new Date(selectedRequest.finishedAt).toLocaleString()}</span>
                    </div>
                  )}
                </div>
              </div>

              <div className="p-4 border-t border-[#1f293d] flex items-center justify-between">
                <Link
                  href="/explorer?platform=META"
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-600/20 text-blue-400 border border-blue-500/30 text-xs font-medium hover:bg-blue-600/30"
                >
                  <span>Open Meta Explorer</span>
                  <ExternalLink className="h-3 w-3" />
                </Link>
                <button
                  onClick={() => setSelectedRequest(null)}
                  className="px-3 py-1.5 rounded-lg bg-slate-800 text-slate-300 text-xs hover:bg-slate-700"
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
