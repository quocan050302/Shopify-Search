"use client";

import React, { useState } from "react";
import {
  X,
  Activity,
  CheckCircle2,
  AlertTriangle,
  HelpCircle,
  Clock,
  Terminal,
  Server,
  Cpu,
  Database,
  Layers,
  ShieldCheck,
  Copy,
  Check,
} from "lucide-react";
import { ProviderHealthResponse } from "@/lib/meta/normalizeMetaHealth";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";

export interface MetaDiagnosticsPanelProps {
  isOpen: boolean;
  onClose: () => void;
  health: ProviderHealthResponse | null;
  lastCheckedAt?: string;
  onRunDiagnostics?: () => void;
}

export const MetaDiagnosticsPanel: React.FC<MetaDiagnosticsPanelProps> = ({
  isOpen,
  onClose,
  health,
  lastCheckedAt,
  onRunDiagnostics,
}) => {
  const [copiedCmd, setCopiedCmd] = useState(false);

  if (!isOpen) return null;

  const copyDoctorCommand = async () => {
    try {
      if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText("npm run doctor");
        setCopiedCmd(true);
        setTimeout(() => setCopiedCmd(false), 2000);
      }
    } catch (err) {
      console.warn("Clipboard copy failed:", err);
    }
  };

  const getStatusIcon = (isOk: boolean, isWarning?: boolean) => {
    if (isOk) return <CheckCircle2 className="h-4 w-4 text-emerald-400" />;
    if (isWarning) return <Clock className="h-4 w-4 text-amber-400" />;
    return <AlertTriangle className="h-4 w-4 text-red-400" />;
  };

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
      <div className="bg-[#0D1424] border border-slate-800 rounded-2xl w-full max-w-2xl shadow-2xl overflow-hidden animate-in zoom-in-95 duration-200">
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-800 flex items-center justify-between bg-slate-900/60">
          <div className="flex items-center gap-2.5">
            <Activity className="h-5 w-5 text-indigo-400" />
            <div>
              <h2 className="text-base font-semibold text-slate-100">
                Meta Research Diagnostics
              </h2>
              <p className="text-xs text-slate-400">
                Runtime environment, worker heartbeat, and provider checks
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-200 hover:bg-slate-800 transition-colors cursor-pointer"
            aria-label="Close diagnostics"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 space-y-5 text-xs">
          {/* Timestamp & Doctor prompt */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 p-3 rounded-lg bg-slate-900/40 border border-slate-800">
            <span className="text-slate-400">
              Checked at:{" "}
              <strong className="text-slate-200 font-mono">
                {lastCheckedAt ? new Date(lastCheckedAt).toLocaleTimeString() : "Just now"}
              </strong>
            </span>
            <button
              onClick={copyDoctorCommand}
              className="flex items-center gap-1.5 text-indigo-400 hover:text-indigo-300 font-medium cursor-pointer"
            >
              <Terminal className="h-3.5 w-3.5" />
              <span>Copy `npm run doctor`</span>
              {copiedCmd ? <Check className="h-3 w-3 text-emerald-400" /> : <Copy className="h-3 w-3" />}
            </button>
          </div>

          {/* Diagnostic Subsystems */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {/* 1. Python Binary Environment */}
            <div className="p-3.5 rounded-xl border border-slate-800 bg-[#0c121e]/80 space-y-1.5">
              <div className="flex items-center justify-between">
                <span className="font-semibold text-slate-200 flex items-center gap-1.5">
                  <Cpu className="h-3.5 w-3.5 text-indigo-400" />
                  Python Environment
                </span>
                {getStatusIcon(Boolean(health?.environment?.pythonReady))}
              </div>
              <p className="text-slate-400 leading-relaxed text-[11px]">
                {health?.environment?.pythonReady
                  ? "Configured Python binary available and executable."
                  : "Python virtualenv not found in collector directory. Run `python3 -m venv .venv`."}
              </p>
            </div>

            {/* 2. Collector Data Directory */}
            <div className="p-3.5 rounded-xl border border-slate-800 bg-[#0c121e]/80 space-y-1.5">
              <div className="flex items-center justify-between">
                <span className="font-semibold text-slate-200 flex items-center gap-1.5">
                  <Database className="h-3.5 w-3.5 text-indigo-400" />
                  Collector Data Store
                </span>
                {getStatusIcon(Boolean(health?.environment?.dataDirReady))}
              </div>
              <p className="text-slate-400 leading-relaxed text-[11px]">
                {health?.environment?.dataDirReady
                  ? "Local storage directory mounted and write-ready."
                  : "Data directory is missing or read-only."}
              </p>
            </div>

            {/* 3. Background Worker Heartbeat */}
            <div className="p-3.5 rounded-xl border border-slate-800 bg-[#0c121e]/80 space-y-1.5">
              <div className="flex items-center justify-between">
                <span className="font-semibold text-slate-200 flex items-center gap-1.5">
                  <Server className="h-3.5 w-3.5 text-indigo-400" />
                  Background Worker
                </span>
                {getStatusIcon(
                  health?.worker?.status === "RUNNING",
                  health?.worker?.status !== "RUNNING"
                )}
              </div>
              <p className="text-slate-400 leading-relaxed text-[11px]">
                Status:{" "}
                <strong className={health?.worker?.status === "RUNNING" ? "text-emerald-400" : "text-amber-400"}>
                  {health?.worker?.status || "UNKNOWN"}
                </strong>
                {health?.worker?.lastHeartbeat && (
                  <span className="block text-[10px] text-slate-500 font-mono mt-0.5">
                    Heartbeat: {new Date(health.worker.lastHeartbeat).toLocaleTimeString()}
                  </span>
                )}
              </p>
            </div>

            {/* 4. Provider Authorization */}
            <div className="p-3.5 rounded-xl border border-slate-800 bg-[#0c121e]/80 space-y-1.5">
              <div className="flex items-center justify-between">
                <span className="font-semibold text-slate-200 flex items-center gap-1.5">
                  <ShieldCheck className="h-3.5 w-3.5 text-indigo-400" />
                  Local MCP Provider
                </span>
                {getStatusIcon(
                  Boolean(health?.provider?.enabled && health?.provider?.status !== "NOT_CONFIGURED"),
                  health?.provider?.status === "NOT_CONFIGURED"
                )}
              </div>
              <p className="text-slate-400 leading-relaxed text-[11px]">
                {health?.provider?.status || "NOT_CONFIGURED"}
                {health?.provider?.message && (
                  <span className="block text-slate-400 text-[10px] mt-0.5">
                    {health.provider.message}
                  </span>
                )}
              </p>
            </div>
          </div>

          {/* Configured Limits & Budget */}
          <div className="p-4 rounded-xl border border-slate-800 bg-slate-900/40 space-y-2">
            <h4 className="font-semibold text-slate-300 flex items-center gap-1.5">
              <Layers className="h-3.5 w-3.5 text-indigo-400" />
              Effective Operating Limits
            </h4>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-[11px] pt-1">
              <div>
                <span className="text-slate-400 block">Max Results/Search</span>
                <span className="font-mono text-slate-200 font-semibold">
                  {health?.limits?.maxResultsPerSearch || 25}
                </span>
              </div>
              <div>
                <span className="text-slate-400 block">Max Concurrency</span>
                <span className="font-mono text-slate-200 font-semibold">
                  {health?.limits?.maxConcurrency || 1}
                </span>
              </div>
              <div>
                <span className="text-slate-400 block">Timeout (sec)</span>
                <span className="font-mono text-slate-200 font-semibold">
                  {health?.limits?.maxExecutionSeconds || 60}s
                </span>
              </div>
              <div>
                <span className="text-slate-400 block">Default Market</span>
                <span className="font-mono text-slate-200 font-semibold">
                  {health?.environment?.defaultCountry || "US"}
                </span>
              </div>
            </div>
          </div>

          {/* Failure Records (if any) */}
          {health?.history?.lastFailureCategory && (
            <div className="p-3.5 rounded-xl border border-amber-500/30 bg-amber-500/10 space-y-1">
              <span className="text-amber-300 font-semibold flex items-center gap-1.5 text-xs">
                <AlertTriangle className="h-3.5 w-3.5" />
                Latest Failure Category: {health.history.lastFailureCategory}
              </span>
              <p className="text-amber-200/90 text-[11px] font-mono">
                {health.history.lastFailureMessage || "No message logged."}
              </p>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-slate-800 bg-slate-900/60 flex items-center justify-end gap-2">
          <Button variant="outline" size="sm" onClick={onClose}>
            Close
          </Button>
        </div>
      </div>
    </div>
  );
};
