"use client";

import React from "react";
import Link from "next/link";
import {
  ExternalLink,
  Layers,
  Clock,
  CheckCircle2,
  AlertTriangle,
  Database,
  Globe2,
  Hash,
} from "lucide-react";
import { Drawer } from "@/components/ui/Drawer";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { MetaRequestItem } from "./MetaJobsTable";
import { mapMetaJobStatus } from "@/lib/meta/mapMetaJobStatus";
import { buildExplorerUrlForRun } from "@/lib/meta/buildExplorerUrlForRun";

export interface MetaJobDetailsDrawerProps {
  job: MetaRequestItem | null;
  onClose: () => void;
}

export const MetaJobDetailsDrawer: React.FC<MetaJobDetailsDrawerProps> = ({
  job,
  onClose,
}) => {
  if (!job) return null;

  const statusPresentation = mapMetaJobStatus(job.status);
  const primaryKeyword = job.keywords?.[0] || "Meta Search";

  const formatDate = (isoString?: string | null) => {
    if (!isoString) return "—";
    try {
      return new Date(isoString).toLocaleString();
    } catch {
      return isoString;
    }
  };

  return (
    <Drawer
      isOpen={Boolean(job)}
      onClose={onClose}
      title="Research Job Details"
      subtitle={`Run ID: ${job.id}`}
      footer={
        <div className="flex items-center gap-3">
          <Button variant="outline" size="sm" onClick={onClose}>
            Close
          </Button>
          {job.validCount > 0 && (
            <Link href={buildExplorerUrlForRun(job.id, "META")}>
              <Button
                variant="primary"
                size="sm"
                leftIcon={<ExternalLink className="h-4 w-4" />}
              >
                View Discovered Ads
              </Button>
            </Link>
          )}
        </div>
      }
    >
      <div className="space-y-6">
        {/* Status Banner */}
        <div className="p-4 rounded-xl border border-slate-800 bg-slate-900/60 flex items-center justify-between gap-4">
          <div className="space-y-1">
            <span className="text-xs text-slate-400 font-medium">Execution Status</span>
            <p className="text-xs text-slate-300">{statusPresentation.description}</p>
          </div>
          <Badge variant={statusPresentation.variant} size="md">
            {statusPresentation.label}
          </Badge>
        </div>

        {/* Search Parameters */}
        <div className="space-y-3">
          <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
            Research Scope
          </h3>
          <div className="p-4 rounded-xl border border-slate-800 bg-[#0c121e]/80 space-y-3">
            <div>
              <span className="text-xs text-slate-400 block mb-1.5">Keywords Queried:</span>
              <div className="flex flex-wrap gap-1.5">
                {(job.keywords || []).map((kw, i) => (
                  <span
                    key={i}
                    className="px-2.5 py-1 rounded-md text-xs font-medium bg-indigo-500/10 text-indigo-300 border border-indigo-500/20"
                  >
                    {kw}
                  </span>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3 pt-2 border-t border-slate-800/60 text-xs">
              <div>
                <span className="text-slate-400 block">Target Market</span>
                <span className="font-semibold text-slate-200">{job.market || "US"} (United States)</span>
              </div>
              <div>
                <span className="text-slate-400 block">Requested Budget</span>
                <span className="font-semibold text-slate-200">{job.requestedLimit} ads</span>
              </div>
            </div>
          </div>
        </div>

        {/* Results Breakdown */}
        <div className="space-y-3">
          <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
            Collection Output
          </h3>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="p-3 rounded-lg border border-slate-800 bg-slate-900/40 text-center space-y-0.5">
              <span className="text-[11px] text-slate-400 block">Total Retrieved</span>
              <span className="text-lg font-bold text-slate-100 font-mono">
                {job.actualRetrievedCount}
              </span>
            </div>
            <div className="p-3 rounded-lg border border-slate-800 bg-slate-900/40 text-center space-y-0.5">
              <span className="text-[11px] text-slate-400 block">Valid Ads</span>
              <span className="text-lg font-bold text-emerald-400 font-mono">
                {job.validCount}
              </span>
            </div>
            <div className="p-3 rounded-lg border border-slate-800 bg-slate-900/40 text-center space-y-0.5">
              <span className="text-[11px] text-slate-400 block">New Unique</span>
              <span className="text-lg font-bold text-indigo-300 font-mono">
                {job.newUniqueCount}
              </span>
            </div>
            <div className="p-3 rounded-lg border border-slate-800 bg-slate-900/40 text-center space-y-0.5">
              <span className="text-[11px] text-slate-400 block">Duplicates</span>
              <span className="text-lg font-bold text-slate-400 font-mono">
                {job.existingDuplicateCount}
              </span>
            </div>
          </div>
        </div>

        {/* Timing Information */}
        <div className="space-y-3">
          <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
            Execution Timestamps
          </h3>
          <div className="p-4 rounded-xl border border-slate-800 bg-[#0c121e]/80 space-y-2 text-xs">
            <div className="flex justify-between py-1 border-b border-slate-800/40">
              <span className="text-slate-400">Created At</span>
              <span className="font-mono text-slate-200">{formatDate(job.createdAt)}</span>
            </div>
            <div className="flex justify-between py-1 border-b border-slate-800/40">
              <span className="text-slate-400">Execution Started</span>
              <span className="font-mono text-slate-200">{formatDate(job.startedAt)}</span>
            </div>
            <div className="flex justify-between py-1">
              <span className="text-slate-400">Completed At</span>
              <span className="font-mono text-slate-200">{formatDate(job.finishedAt)}</span>
            </div>
          </div>
        </div>

        {/* Error Details (if present) */}
        {(job.errorCategory || job.errorMessage) && (
          <div className="p-4 rounded-xl border border-red-500/30 bg-red-500/10 space-y-2">
            <div className="flex items-center gap-2 text-red-300 font-semibold text-xs">
              <AlertTriangle className="h-4 w-4" />
              <span>Execution Error ({job.errorCategory || "UNKNOWN"})</span>
            </div>
            <p className="text-xs text-red-200 font-mono leading-relaxed bg-black/30 p-2.5 rounded-lg border border-red-500/20">
              {job.errorMessage || "No additional error message provided."}
            </p>
          </div>
        )}
      </div>
    </Drawer>
  );
};
