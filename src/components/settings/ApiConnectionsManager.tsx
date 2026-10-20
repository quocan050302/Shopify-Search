"use client";

import { useState, useEffect } from "react";
import {
  Key,
  CheckCircle2,
  AlertCircle,
  AlertTriangle,
  RefreshCw,
  ExternalLink,
  ShieldCheck,
  Eye,
  EyeOff,
  Trash2,
  Save,
  Sparkles,
  ChevronDown,
  ChevronUp,
  Clock,
  Layers,
  Store,
  Lock,
  Globe,
} from "lucide-react";
import type { ProviderConnectionState, ProviderId } from "@/services/credentials/credentialService";

interface ApiConnectionsManagerProps {
  onStatusChange?: () => void;
}

export function ApiConnectionsManager({ onStatusChange }: ApiConnectionsManagerProps) {
  const [providers, setProviders] = useState<Record<ProviderId, ProviderConnectionState> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Per-provider state for input, show/hide, loading, and expanded guides
  const [inputKeys, setInputKeys] = useState<Record<ProviderId, string>>({
    gemini: "",
    meta: "",
    captapi: "",
    apify: "",
  });
  const [showKeys, setShowKeys] = useState<Record<ProviderId, boolean>>({
    gemini: false,
    meta: false,
    captapi: false,
    apify: false,
  });
  const [saving, setSaving] = useState<Record<ProviderId, boolean>>({
    gemini: false,
    meta: false,
    captapi: false,
    apify: false,
  });
  const [testing, setTesting] = useState<Record<ProviderId, boolean>>({
    gemini: false,
    meta: false,
    captapi: false,
    apify: false,
  });
  const [expandedGuides, setExpandedGuides] = useState<Record<ProviderId, boolean>>({
    gemini: false,
    meta: false,
    captapi: false,
    apify: false,
  });
  const [actionFeedback, setActionFeedback] = useState<Record<ProviderId, { type: "success" | "error"; message: string } | null>>({
    gemini: null,
    meta: null,
    captapi: null,
    apify: null,
  });

  const fetchConnections = async () => {
    try {
      setError(null);
      const res = await fetch("/api/v1/settings/credentials");
      const json = await res.json();
      if (json.success && json.data?.providers) {
        setProviders(json.data.providers);
      } else {
        setError(json.error?.message || "Failed to load provider credentials.");
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to connect to credentials API.");
    } finally {
      setLoading(false);
    }
  };

interface ProviderBudgetSummary {
  enabled?: boolean;
  allowAutomaticRequests?: boolean;
  creditsUsedThisMonth?: number;
  monthlyCreditLimit?: number;
  allowanceUsd?: number;
  spentUsd?: number;
}

  const [budgets, setBudgets] = useState<Record<string, ProviderBudgetSummary> | null>(null);

  const fetchBudgets = async () => {
    try {
      const res = await fetch("/api/v1/settings/budgets");
      const json = await res.json();
      if (json.success && json.data) {
        setBudgets(json.data);
      }
    } catch {
      // ignore
    }
  };

  const handleUpdateBudget = async (provider: ProviderId, updates: Partial<ProviderBudgetSummary>) => {
    try {
      const res = await fetch("/api/v1/settings/budgets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider, ...updates }),
      });
      const json = await res.json();
      if (json.success && json.data) {
        setBudgets((prev) => ({
          ...prev,
          [provider]: json.data,
        }));
      }
    } catch {
      // ignore
    }
  };

  useEffect(() => {
    fetchConnections();
    fetchBudgets();
  }, []);

  const handleSave = async (provider: ProviderId) => {
    const rawKey = inputKeys[provider]?.trim();
    if (!rawKey) {
      setActionFeedback((prev) => ({
        ...prev,
        [provider]: { type: "error", message: "Please enter an API key or token before saving." },
      }));
      return;
    }

    setSaving((prev) => ({ ...prev, [provider]: true }));
    setActionFeedback((prev) => ({ ...prev, [provider]: null }));

    try {
      const res = await fetch("/api/v1/settings/credentials", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider, key: rawKey }),
      });
      const json = await res.json();

      if (json.success) {
        // Clear input for security
        setInputKeys((prev) => ({ ...prev, [provider]: "" }));
        setActionFeedback((prev) => ({
          ...prev,
          [provider]: {
            type: "success",
            message: "Key saved securely to server. Click 'Test Connection' to verify.",
          },
        }));
        await fetchConnections();
        onStatusChange?.();
      } else {
        setActionFeedback((prev) => ({
          ...prev,
          [provider]: { type: "error", message: json.error?.message || "Failed to save credential." },
        }));
      }
    } catch (err: unknown) {
      setActionFeedback((prev) => ({
        ...prev,
        [provider]: { type: "error", message: err instanceof Error ? err.message : "Network error while saving." },
      }));
    } finally {
      setSaving((prev) => ({ ...prev, [provider]: false }));
    }
  };

  const handleRemove = async (provider: ProviderId) => {
    if (!confirm(`Are you sure you want to remove the server credential for ${provider}?`)) {
      return;
    }

    setActionFeedback((prev) => ({ ...prev, [provider]: null }));
    try {
      const res = await fetch("/api/v1/settings/credentials", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider }),
      });
      const json = await res.json();
      if (json.success) {
        setInputKeys((prev) => ({ ...prev, [provider]: "" }));
        setActionFeedback((prev) => ({
          ...prev,
          [provider]: { type: "success", message: "Credential removed from server storage." },
        }));
        await fetchConnections();
        onStatusChange?.();
      } else {
        setActionFeedback((prev) => ({
          ...prev,
          [provider]: { type: "error", message: json.error?.message || "Failed to remove credential." },
        }));
      }
    } catch (err: unknown) {
      setActionFeedback((prev) => ({
        ...prev,
        [provider]: { type: "error", message: err instanceof Error ? err.message : "Network error." },
      }));
    }
  };

  const handleTest = async (provider: ProviderId) => {
    setTesting((prev) => ({ ...prev, [provider]: true }));
    setActionFeedback((prev) => ({ ...prev, [provider]: null }));

    try {
      // If user typed a new key without saving yet, test that key directly
      const candidateKey = inputKeys[provider]?.trim() || undefined;

      const res = await fetch("/api/v1/settings/credentials/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider, key: candidateKey }),
      });
      const json = await res.json();

      if (json.data) {
        const result = json.data;
        if (result.status === "CONNECTED") {
          setActionFeedback((prev) => ({
            ...prev,
            [provider]: {
              type: "success",
              message: `Authenticated connection verified! Latency: ${result.latencyMs}ms.`,
            },
          }));
        } else {
          setActionFeedback((prev) => ({
            ...prev,
            [provider]: {
              type: "error",
              message: result.errorMessage || "Connection test failed.",
            },
          }));
        }
        await fetchConnections();
        onStatusChange?.();
      } else {
        setActionFeedback((prev) => ({
          ...prev,
          [provider]: { type: "error", message: json.error?.message || "Test request failed." },
        }));
      }
    } catch (err: unknown) {
      setActionFeedback((prev) => ({
        ...prev,
        [provider]: { type: "error", message: err instanceof Error ? err.message : "Failed to execute connection test." },
      }));
    } finally {
      setTesting((prev) => ({ ...prev, [provider]: false }));
    }
  };

  const getStatusBadge = (status: ProviderConnectionState["status"]) => {
    switch (status) {
      case "CONNECTED":
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/30">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
            <CheckCircle2 className="h-3.5 w-3.5" />
            CONNECTED
          </span>
        );
      case "KEY_PRESENT_UNVERIFIED":
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold bg-amber-500/10 text-amber-400 border border-amber-500/30">
            <Clock className="h-3.5 w-3.5" />
            KEY_SAVED_UNVERIFIED
          </span>
        );
      case "ERROR":
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold bg-rose-500/10 text-rose-400 border border-rose-500/30">
            <AlertCircle className="h-3.5 w-3.5" />
            CONNECTION_ERROR
          </span>
        );
      default:
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold bg-slate-800 text-slate-400 border border-slate-700">
            NOT_CONFIGURED
          </span>
        );
    }
  };

  const getProviderIcon = (id: ProviderId) => {
    switch (id) {
      case "gemini":
        return <Sparkles className="h-5 w-5 text-indigo-400" />;
      case "meta":
        return <Layers className="h-5 w-5 text-blue-400" />;
      case "captapi":
        return <Key className="h-5 w-5 text-teal-400" />;
      case "apify":
        return <Globe className="h-5 w-5 text-amber-400" />;
    }
  };

  if (loading) {
    return (
      <div className="p-8 rounded-2xl bg-[#111827] border border-[#1f293d] flex items-center justify-center gap-3 text-slate-400 text-sm">
        <RefreshCw className="h-4 w-4 animate-spin text-indigo-400" />
        <span>Loading server credentials and connection status...</span>
      </div>
    );
  }

  if (error || !providers) {
    return (
      <div className="p-6 rounded-2xl bg-rose-950/30 border border-rose-800 text-rose-300 space-y-2 text-xs">
        <div className="flex items-center gap-2 font-bold">
          <AlertCircle className="h-4 w-4 text-rose-400" />
          <span>Error loading credential management</span>
        </div>
        <p>{error || "Providers unavailable."}</p>
        <button
          onClick={fetchConnections}
          className="px-3 py-1.5 rounded-lg bg-rose-900/60 hover:bg-rose-800 text-white font-medium mt-2"
        >
          Retry Connection
        </button>
      </div>
    );
  }

  const providerKeys: ProviderId[] = ["gemini", "meta", "captapi", "apify"];

  return (
    <div className="space-y-6">
      {/* Security Architecture Disclosure Banner */}
      <div className="p-4 rounded-xl bg-gradient-to-r from-indigo-950/40 via-slate-900 to-slate-950 border border-indigo-500/20 text-xs flex items-start gap-3">
        <ShieldCheck className="h-5 w-5 text-indigo-400 shrink-0 mt-0.5" />
        <div className="space-y-1">
          <p className="font-semibold text-slate-200">
            Secure Server-Side Credential Storage
          </p>
          <p className="text-slate-400 leading-relaxed">
            API keys and tokens are stored exclusively on the server in gitignored{" "}
            <code className="px-1.5 py-0.5 rounded bg-slate-800 text-indigo-300 font-mono text-[11px]">
              .env.local
            </code>{" "}
            storage. Credentials are <strong>NEVER</strong> returned to the browser, <strong>NEVER</strong> stored in localStorage, and excluded from GitHub. Providers are only marked <strong>CONNECTED</strong> after a real authenticated request succeeds.
          </p>
        </div>
      </div>

      {/* Provider Connection Cards */}
      <div className="space-y-6">
        {providerKeys.map((pid) => {
          const provider = providers[pid];
          if (!provider) return null;

          const isSaved = provider.configured;
          const isTesting = testing[pid];
          const isSaving = saving[pid];
          const isGuideOpen = expandedGuides[pid];
          const feedback = actionFeedback[pid];
          const details = (provider.details || {}) as {
            selectedModel?: string;
            apiVersion?: string;
            testedCandidates?: Array<{
              model: string;
              success: boolean;
              statusCode?: number;
              latencyMs?: number;
              error?: string;
            }>;
          };

          return (
            <div
              key={pid}
              id={`provider-card-${pid}`}
              className={`p-6 rounded-2xl bg-[#111827] border transition-all duration-200 ${
                provider.status === "CONNECTED"
                  ? "border-emerald-500/30 shadow-lg shadow-emerald-950/20"
                  : provider.status === "ERROR"
                  ? "border-rose-500/30 shadow-lg shadow-rose-950/20"
                  : provider.status === "KEY_PRESENT_UNVERIFIED"
                  ? "border-amber-500/30 shadow-lg shadow-amber-950/20"
                  : "border-[#1f293d]"
              } space-y-5`}
            >
              {/* Header */}
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-800/80 pb-4">
                <div className="flex items-center gap-3">
                  <div className="p-2.5 rounded-xl bg-slate-900 border border-slate-800">
                    {getProviderIcon(pid)}
                  </div>
                  <div>
                    <div className="flex items-center gap-2 flex-wrap">
                      <h3 className="text-base font-bold text-white">
                        {provider.name}
                      </h3>
                      <span className="text-[10px] px-2 py-0.5 rounded bg-slate-950 text-indigo-400 border border-indigo-900/50 font-mono">
                        {provider.envVar}
                      </span>
                      {pid === "captapi" && (
                        <span className="text-[10px] px-2 py-0.5 rounded bg-amber-500/20 text-amber-300 border border-amber-500/30 font-semibold uppercase">
                          Optional • Disabled by default
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-slate-400 mt-0.5">
                      {provider.setupInstructions.title}
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  {getStatusBadge(provider.status)}
                </div>
              </div>

              {/* Status & Diagnostics Summary */}
              <div className="grid grid-cols-1 md:grid-cols-4 gap-3 text-xs">
                <div className="p-3 rounded-xl bg-slate-900/80 border border-slate-800 space-y-1">
                  <span className="text-slate-400 block text-[11px]">Server Storage</span>
                  <div className="flex items-center gap-1.5 font-mono">
                    {isSaved ? (
                      <>
                        <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400 shrink-0" />
                        <span className="text-emerald-400 font-semibold truncate">
                          {provider.maskedKey}
                        </span>
                      </>
                    ) : (
                      <span className="text-slate-400">Not configured</span>
                    )}
                  </div>
                </div>

                <div className="p-3 rounded-xl bg-slate-900/80 border border-slate-800 space-y-1">
                  <span className="text-slate-400 block text-[11px]">Last Verification</span>
                  <div className="flex items-center gap-1.5 text-slate-300">
                    {provider.lastTestedAt ? (
                      <>
                        <Clock className="h-3.5 w-3.5 text-slate-400 shrink-0" />
                        <span className="text-[11px] truncate">
                          {new Date(provider.lastTestedAt).toLocaleTimeString()} (
                          {provider.latencyMs ?? 0}ms)
                        </span>
                      </>
                    ) : (
                      <span className="text-slate-400">Awaiting test</span>
                    )}
                  </div>
                </div>

                <div className="p-3 rounded-xl bg-slate-900/80 border border-slate-800 space-y-1">
                  <span className="text-slate-400 block text-[11px]">Connected Model</span>
                  <div className="flex items-center gap-1.5">
                    {pid === "gemini" && details.selectedModel ? (
                      <span className="text-indigo-300 font-semibold font-mono text-[11px] truncate flex items-center gap-1">
                        <Sparkles className="h-3 w-3 text-indigo-400 shrink-0" />
                        {String(details.selectedModel)}
                        <span className="text-[9px] px-1 py-0.2 rounded bg-slate-800 text-slate-400">
                          {String(details.apiVersion || "v1")}
                        </span>
                      </span>
                    ) : provider.status === "CONNECTED" ? (
                      <span className="text-emerald-400 font-semibold text-[11px]">
                        Active Provider
                      </span>
                    ) : (
                      <span className="text-slate-500 font-mono text-[11px]">None</span>
                    )}
                  </div>
                </div>

                <div className="p-3 rounded-xl bg-slate-900/80 border border-slate-800 space-y-1">
                  <span className="text-slate-400 block text-[11px]">Verification Status</span>
                  <div className="flex items-center gap-1.5">
                    {provider.status === "CONNECTED" ? (
                      <span className="text-emerald-400 font-semibold flex items-center gap-1">
                        <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
                        Verified Active
                      </span>
                    ) : provider.missingPermissions && provider.missingPermissions.length > 0 ? (
                      <span className="text-rose-400 font-semibold truncate">
                        Missing: {provider.missingPermissions[0]}
                      </span>
                    ) : isSaved ? (
                      <span className="text-amber-400 font-semibold">
                        Awaiting Test
                      </span>
                    ) : (
                      <span className="text-slate-400">Key required</span>
                    )}
                  </div>
                </div>
              </div>

              {/* Meta Ad Library Specific US Commercial Notice */}
              {pid === "meta" && (
                <div className="p-3.5 rounded-xl bg-amber-950/30 border border-amber-500/30 text-xs space-y-1.5">
                  <div className="flex items-center gap-2 text-amber-300 font-semibold">
                    <AlertTriangle className="h-4 w-4 shrink-0 text-amber-400" />
                    <span>Meta Commercial Ad Discovery Policy Notice</span>
                  </div>
                  <p className="text-slate-300 leading-relaxed text-[11px]">
                    Per Meta Platform Policy, the automated <code>ad_archive</code> API in the United States requires explicit business verification and individual identity review. Standard API access is restricted to political and social issue ads.
                  </p>
                  <p className="text-amber-400/90 text-[11px] font-medium">
                    ✓ Manual URL import in SWAI remains fully supported for all public Facebook & Instagram commercial ads without API key restrictions.
                  </p>
                </div>
              )}

              {/* Error Alert Display if test failed */}
              {provider.lastError && (
                <div className="p-3.5 rounded-xl bg-rose-950/40 border border-rose-500/40 text-xs space-y-2">
                  <div className="flex items-start gap-2 text-rose-300 font-semibold">
                    <AlertCircle className="h-4 w-4 shrink-0 text-rose-400 mt-0.5" />
                    <div>
                      <span>Provider Error: {provider.lastErrorCode ? `[Code ${provider.lastErrorCode}] ` : ""}</span>
                      <span className="font-normal text-rose-200 block mt-0.5">{provider.lastError}</span>
                    </div>
                  </div>
                  {provider.missingPermissions && provider.missingPermissions.length > 0 && (
                    <div className="flex items-center gap-1.5 flex-wrap pt-1">
                      <span className="text-slate-400 text-[11px]">Missing permissions:</span>
                      {provider.missingPermissions.map((perm) => (
                        <span
                          key={perm}
                          className="px-2 py-0.5 rounded bg-rose-900/60 text-rose-300 border border-rose-700/50 font-mono text-[10px]"
                        >
                          {perm}
                        </span>
                      ))}
                    </div>
                  )}
                  {provider.policyNotice && (
                    <p className="text-[11px] text-slate-400 italic pt-1 border-t border-rose-900/40">
                      {provider.policyNotice}
                    </p>
                  )}
                </div>
              )}

              {/* Verified Capabilities (Visible when CONNECTED) */}
              {provider.status === "CONNECTED" && provider.capabilities && provider.capabilities.length > 0 && (
                <div className="p-3.5 rounded-xl bg-slate-900/60 border border-emerald-500/20 text-xs space-y-2">
                  <span className="font-bold text-slate-300 block text-[11px] uppercase tracking-wider">
                    Verified Provider Capabilities
                  </span>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {provider.capabilities.map((cap) => (
                      <div
                        key={cap.name}
                        className="flex items-start gap-2 p-2 rounded-lg bg-slate-950/60 border border-slate-800"
                      >
                        {cap.status === "VERIFIED" ? (
                          <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400 shrink-0 mt-0.5" />
                        ) : (
                          <AlertTriangle className="h-3.5 w-3.5 text-amber-400 shrink-0 mt-0.5" />
                        )}
                        <div>
                          <span className="font-medium text-slate-200 block text-[11px]">
                            {cap.name}
                          </span>
                          <span className="text-[10px] text-slate-400 block leading-tight">
                            {cap.notes}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Action Feedback Banner */}
              {feedback && (
                <div
                  className={`p-3 rounded-xl text-xs flex items-center gap-2 ${
                    feedback.type === "success"
                      ? "bg-emerald-950/40 text-emerald-300 border border-emerald-500/40"
                      : "bg-rose-950/40 text-rose-300 border border-rose-500/40"
                  }`}
                >
                  {feedback.type === "success" ? (
                    <CheckCircle2 className="h-4 w-4 text-emerald-400 shrink-0" />
                  ) : (
                    <AlertCircle className="h-4 w-4 text-rose-400 shrink-0" />
                  )}
                  <span>{feedback.message}</span>
                </div>
              )}

              {/* Provider Usage Budget & Credit Protection (Requirements 1 & 13) */}
              {pid === "captapi" && (
                <div className="p-4 rounded-xl bg-slate-900/90 border border-amber-800/40 space-y-3 text-xs">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                    <div>
                      <h4 className="font-bold text-slate-200 text-xs flex items-center gap-1.5">
                        <Lock className="h-3.5 w-3.5 text-amber-400" />
                        <span>Credit Protection & Usage Budget</span>
                      </h4>
                      <p className="text-[11px] text-slate-400 mt-0.5">
                        Captapi is optional and disabled by default. Core research uses TikTok Creative Center (US) without paid API calls.
                      </p>
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      <span className="text-[11px] text-slate-400">Provider Status:</span>
                      <button
                        type="button"
                        onClick={() =>
                          handleUpdateBudget("captapi", {
                            enabled: !(budgets?.captapi?.enabled ?? false),
                          })
                        }
                        className={`px-3 py-1 rounded-lg text-xs font-semibold border transition-all cursor-pointer ${
                          budgets?.captapi?.enabled
                            ? "bg-emerald-950/60 text-emerald-300 border-emerald-600/50"
                            : "bg-slate-800 text-slate-400 border-slate-700"
                        }`}
                      >
                        {budgets?.captapi?.enabled ? "ENABLED" : "DISABLED (DEFAULT)"}
                      </button>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
                    <div className="p-2.5 rounded-lg bg-slate-950 border border-slate-800">
                      <span className="text-slate-400 text-[10px] block font-semibold uppercase">
                        Automatic Paid Requests
                      </span>
                      <div className="flex items-center justify-between mt-1">
                        <span className="text-[11px] font-mono text-slate-300">
                          {budgets?.captapi?.allowAutomaticRequests
                            ? "Allowed"
                            : "BLOCKED (Default)"}
                        </span>
                        <button
                          type="button"
                          onClick={() =>
                            handleUpdateBudget("captapi", {
                              allowAutomaticRequests: !(budgets?.captapi?.allowAutomaticRequests ?? false),
                            })
                          }
                          className="text-[10px] text-indigo-400 hover:underline cursor-pointer"
                        >
                          {budgets?.captapi?.allowAutomaticRequests ? "Disable auto" : "Allow auto"}
                        </button>
                      </div>
                    </div>

                    <div className="p-2.5 rounded-lg bg-slate-950 border border-slate-800">
                      <span className="text-slate-400 text-[10px] block font-semibold uppercase">
                        Monthly Credit Budget
                      </span>
                      <div className="flex items-center justify-between mt-1">
                        <span className="text-[11px] font-mono text-slate-300">
                          {budgets?.captapi?.creditsUsedThisMonth ?? 0} /{" "}
                          {budgets?.captapi?.monthlyCreditLimit ?? 100} credits
                        </span>
                        <span className="text-[10px] text-slate-500">Cap protected</span>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* Credential Entry & Actions */}
              <div className="space-y-3 pt-2">
                <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2.5">
                  <div className="relative flex-1">
                    <input
                      id={`input-${pid}-key`}
                      type={showKeys[pid] ? "text" : "password"}
                      value={inputKeys[pid]}
                      onChange={(e) =>
                        setInputKeys((prev) => ({ ...prev, [pid]: e.target.value }))
                      }
                      placeholder={
                        isSaved
                          ? `Enter new ${provider.name} key to replace stored credential...`
                          : `Enter ${provider.name} key (${provider.envVar})...`
                      }
                      autoComplete="new-password"
                      className="w-full px-3.5 py-2.5 pr-10 rounded-xl bg-slate-950 border border-slate-800 text-slate-200 text-xs font-mono placeholder:text-slate-400 focus:outline-none focus:border-indigo-500 transition-colors"
                    />
                    <button
                      type="button"
                      onClick={() =>
                        setShowKeys((prev) => ({ ...prev, [pid]: !prev[pid] }))
                      }
                      tabIndex={-1}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-200 p-1"
                      title={showKeys[pid] ? "Hide credential" : "Show credential"}
                    >
                      {showKeys[pid] ? (
                        <EyeOff className="h-4 w-4" />
                      ) : (
                        <Eye className="h-4 w-4" />
                      )}
                    </button>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      id={`btn-save-${pid}`}
                      onClick={() => handleSave(pid)}
                      disabled={isSaving || !inputKeys[pid]?.trim()}
                      className="px-4 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:bg-slate-800 disabled:text-slate-400 text-white font-semibold text-xs flex items-center gap-1.5 transition-colors cursor-pointer disabled:cursor-not-allowed"
                    >
                      {isSaving ? (
                        <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Save className="h-3.5 w-3.5" />
                      )}
                      <span>Save Key</span>
                    </button>

                    <button
                      id={`btn-test-${pid}`}
                      onClick={() => handleTest(pid)}
                      disabled={isTesting || (!isSaved && !inputKeys[pid]?.trim())}
                      className="px-4 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 disabled:bg-slate-900 disabled:text-slate-400 text-white font-semibold text-xs border border-slate-700 flex items-center gap-1.5 transition-colors cursor-pointer disabled:cursor-not-allowed"
                    >
                      {isTesting ? (
                        <>
                          <RefreshCw className="h-3.5 w-3.5 animate-spin text-indigo-400" />
                          <span>Testing...</span>
                        </>
                      ) : (
                        <>
                          <RefreshCw className="h-3.5 w-3.5 text-emerald-400" />
                          <span>{isSaved ? "Retest Connection" : "Test Connection"}</span>
                        </>
                      )}
                    </button>

                    {isSaved && (
                      <button
                        id={`btn-remove-${pid}`}
                        onClick={() => handleRemove(pid)}
                        title="Remove credential from server"
                        className="p-2.5 rounded-xl bg-slate-900 hover:bg-rose-950/50 text-slate-400 hover:text-rose-400 border border-slate-800 hover:border-rose-800/50 transition-colors"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    )}
                  </div>
                </div>

                {/* Candidate Models & Fallback Provenance */}
                {details.testedCandidates && details.testedCandidates.length > 0 && (
                  <div className="flex items-center gap-1.5 flex-wrap pt-1 text-[11px] text-slate-400">
                    <span className="text-[10px] text-slate-400 uppercase tracking-wider font-semibold">Evaluated candidates:</span>
                    {details.testedCandidates.map((c) => (
                      <span
                        key={c.model}
                        className={`px-1.5 py-0.5 rounded font-mono text-[10px] border ${
                          c.success
                            ? "bg-emerald-950/60 text-emerald-400 border-emerald-700/50 font-semibold"
                            : "bg-slate-900 text-slate-400 border-slate-800"
                        }`}
                      >
                        {c.model} {c.success ? "✓ active" : c.statusCode ? `(${c.statusCode})` : "×"}
                      </span>
                    ))}
                  </div>
                )}

                {/* Key Rotation Guidance */}
                {isSaved && (
                  <p className="text-[11px] text-slate-400 pt-0.5">
                    <span className="text-indigo-400 font-semibold">Key Rotation:</span> To replace this credential with a new key from your provider, enter the new key above and click Save Key. The server will update encrypted storage and require re-verification.
                  </p>
                )}
              </div>

              {/* Collapsible Configuration Guide */}
              <div className="border-t border-slate-800/60 pt-3">
                <button
                  type="button"
                  onClick={() =>
                    setExpandedGuides((prev) => ({ ...prev, [pid]: !prev[pid] }))
                  }
                  className="flex items-center justify-between w-full text-left text-xs text-slate-400 hover:text-slate-200 transition-colors py-1 font-medium"
                >
                  <span className="flex items-center gap-1.5">
                    <span>Configuration Guide & Required Permissions</span>
                  </span>
                  {isGuideOpen ? (
                    <ChevronUp className="h-4 w-4" />
                  ) : (
                    <ChevronDown className="h-4 w-4" />
                  )}
                </button>

                {isGuideOpen && (
                  <div className="mt-3 p-4 rounded-xl bg-slate-950/80 border border-slate-800/80 text-xs space-y-3">
                    <ol className="list-decimal list-inside space-y-1.5 text-slate-300">
                      {provider.setupInstructions.steps.map((step, idx) => (
                        <li key={idx} className="leading-relaxed">
                          {step}
                        </li>
                      ))}
                    </ol>

                    <div className="pt-2 flex items-center justify-between border-t border-slate-800 text-[11px]">
                      <span className="text-slate-400 italic">
                        {provider.setupInstructions.securityNote}
                      </span>
                      <a
                        href={provider.docsUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 text-indigo-400 hover:text-indigo-300 font-semibold"
                      >
                        <span>Open Provider Portal</span>
                        <ExternalLink className="h-3 w-3" />
                      </a>
                    </div>
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Shopify Connection Card (Strictly NOT_CONNECTED) */}
      <div className="p-6 rounded-2xl bg-[#111827] border border-[#1f293d] space-y-4">
        <div className="flex items-center justify-between border-b border-slate-800 pb-4">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-xl bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
              <Store className="h-6 w-6" />
            </div>
            <div>
              <h2 className="text-base font-bold text-white flex items-center gap-2">
                <span>Shopify Store Connection</span>
                <span className="text-[10px] px-2 py-0.5 rounded bg-amber-500/10 text-amber-400 border border-amber-500/20 font-mono font-semibold">
                  NOT_CONNECTED
                </span>
              </h2>
              <p className="text-xs text-slate-400 mt-0.5">
                Pre-Shopify Research Mode is active. No Shopify store connection is required for competitor ad research.
              </p>
            </div>
          </div>
        </div>

        <div className="p-4 rounded-xl bg-slate-900/60 border border-slate-800 text-xs space-y-3">
          <div className="flex items-center gap-2 text-slate-300 font-medium">
            <Lock className="h-4 w-4 text-amber-400 shrink-0" />
            <span>
              Store connection intentionally locked in RESEARCH_ONLY mode.
            </span>
          </div>
          <p className="text-slate-400 leading-relaxed">
            SWAI operates in complete isolation from private merchant accounts. All competitor intelligence, longevity analysis, and video AI research function independently.
          </p>

          <div className="pt-2 flex items-center gap-3">
            <input
              type="text"
              disabled
              placeholder="your-store-name.myshopify.com"
              className="px-3 py-2 rounded-lg bg-slate-950 border border-slate-800 text-slate-400 text-xs w-72 cursor-not-allowed font-mono"
            />
            <button
              disabled
              className="px-4 py-2 rounded-lg bg-slate-800 text-slate-400 font-medium text-xs border border-slate-700 cursor-not-allowed"
            >
              Connect Store (Post-Launch)
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
