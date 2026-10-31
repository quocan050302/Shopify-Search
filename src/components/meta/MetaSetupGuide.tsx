"use client";

import React, { useState } from "react";
import {
  CheckCircle2,
  AlertCircle,
  Clock,
  Terminal,
  Copy,
  Check,
  HelpCircle,
  ExternalLink,
} from "lucide-react";
import { NormalizedReadiness } from "@/lib/meta/normalizeMetaHealth";
import { Badge } from "@/components/ui/Badge";

export interface MetaSetupGuideProps {
  readiness: NormalizedReadiness;
  onOpenDiagnostics: () => void;
}

export const MetaSetupGuide: React.FC<MetaSetupGuideProps> = ({
  readiness,
  onOpenDiagnostics,
}) => {
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const handleCopy = async (command: string, id: string) => {
    try {
      if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(command);
        setCopiedId(id);
        setTimeout(() => setCopiedId(null), 2000);
      }
    } catch (err) {
      console.warn("Clipboard copy failed:", err);
    }
  };

  // Only render if action is required
  if (readiness.state === "READY") {
    return null;
  }

  const getStepIcon = (status: "COMPLETE" | "NEEDS_ACTION" | "FAILED" | "UNKNOWN") => {
    switch (status) {
      case "COMPLETE":
        return <CheckCircle2 className="h-4 w-4 text-emerald-400 shrink-0" />;
      case "FAILED":
        return <AlertCircle className="h-4 w-4 text-red-400 shrink-0" />;
      case "NEEDS_ACTION":
        return <Clock className="h-4 w-4 text-amber-400 shrink-0" />;
      default:
        return <HelpCircle className="h-4 w-4 text-slate-500 shrink-0" />;
    }
  };

  const getStepBadge = (status: "COMPLETE" | "NEEDS_ACTION" | "FAILED" | "UNKNOWN") => {
    switch (status) {
      case "COMPLETE":
        return <Badge variant="success" size="sm">Ready</Badge>;
      case "FAILED":
        return <Badge variant="danger" size="sm">Failed</Badge>;
      case "NEEDS_ACTION":
        return <Badge variant="warning" size="sm">Needs Action</Badge>;
      default:
        return <Badge variant="neutral" size="sm">Unknown</Badge>;
    }
  };

  return (
    <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-5 space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <span className="h-2 w-2 rounded-full bg-amber-400" />
            <h3 className="text-sm font-semibold text-slate-200">
              {readiness.title}
            </h3>
          </div>
          <p className="text-xs text-slate-400 leading-relaxed max-w-2xl">
            {readiness.message} Complete the steps below to enable automated public ad research.
          </p>
        </div>

        <button
          onClick={onOpenDiagnostics}
          className="self-start sm:self-auto text-xs text-indigo-400 hover:text-indigo-300 font-medium underline underline-offset-4 cursor-pointer"
        >
          View Full Diagnostics →
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-1">
        {readiness.setupSteps.map((step, idx) => (
          <div
            key={step.id}
            className="p-3.5 rounded-lg border border-slate-800 bg-[#0c121e]/80 flex flex-col justify-between space-y-2.5"
          >
            <div className="flex items-start justify-between gap-2">
              <div className="flex items-center gap-2">
                {getStepIcon(step.status)}
                <span className="text-xs font-semibold text-slate-200">
                  {idx + 1}. {step.title}
                </span>
              </div>
              {getStepBadge(step.status)}
            </div>

            <p className="text-[11px] text-slate-400 leading-relaxed">
              {step.description}
            </p>

            {step.command && (
              <div className="flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-md bg-slate-950/70 border border-slate-800 text-[11px] font-mono text-slate-300">
                <span className="truncate">{step.command}</span>
                <button
                  onClick={() => handleCopy(step.command!, step.id)}
                  className="p-1 rounded text-slate-400 hover:text-slate-200 hover:bg-slate-800 transition-colors shrink-0 cursor-pointer"
                  title="Copy terminal command"
                  aria-label="Copy terminal command"
                >
                  {copiedId === step.id ? (
                    <Check className="h-3.5 w-3.5 text-emerald-400" />
                  ) : (
                    <Copy className="h-3.5 w-3.5" />
                  )}
                </button>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
};
