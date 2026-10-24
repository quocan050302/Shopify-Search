"use client";

import React, { useState, useMemo } from "react";
import Link from "next/link";
import {
  Search,
  Filter,
  RefreshCw,
  ExternalLink,
  Ban,
  RotateCcw,
  Eye,
  Loader2,
  Calendar,
  Layers,
} from "lucide-react";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import {
  Table,
  TableHead,
  TableBody,
  TableRow,
  TableHeaderCell,
  TableCell,
} from "@/components/ui/Table";
import { mapMetaJobStatus } from "@/lib/meta/mapMetaJobStatus";

export interface MetaRequestItem {
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

export interface MetaJobsTableProps {
  jobs: MetaRequestItem[];
  isLoading: boolean;
  onRefresh: () => void;
  onSelectJob: (job: MetaRequestItem) => void;
  onCancelJob: (jobId: string) => Promise<void>;
  onRetryJob: (jobId: string) => Promise<void>;
}

export const MetaJobsTable: React.FC<MetaJobsTableProps> = ({
  jobs,
  isLoading,
  onRefresh,
  onSelectJob,
  onCancelJob,
  onRetryJob,
}) => {
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("ALL");
  const [actionLoadingId, setActionLoadingId] = useState<string | null>(null);

  // Filter and search
  const filteredJobs = useMemo(() => {
    return jobs.filter((job) => {
      // Status match
      if (statusFilter !== "ALL" && job.status.toUpperCase() !== statusFilter) {
        return false;
      }
      // Query match
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase().trim();
        const kwMatch = (job.keywords || []).some((kw) => kw.toLowerCase().includes(q));
        const idMatch = job.id.toLowerCase().includes(q);
        if (!kwMatch && !idMatch) return false;
      }
      return true;
    });
  }, [jobs, statusFilter, searchQuery]);

  const handleCancel = async (id: string) => {
    setActionLoadingId(`cancel-${id}`);
    try {
      await onCancelJob(id);
    } finally {
      setActionLoadingId(null);
    }
  };

  const handleRetry = async (id: string) => {
    setActionLoadingId(`retry-${id}`);
    try {
      await onRetryJob(id);
    } finally {
      setActionLoadingId(null);
    }
  };

  const formatTime = (isoString: string) => {
    try {
      const date = new Date(isoString);
      return date.toLocaleDateString(undefined, {
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      });
    } catch {
      return isoString;
    }
  };

  return (
    <div className="space-y-3.5">
      {/* Search and Filters Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-[#0c121e]/80 p-3.5 rounded-xl border border-slate-800">
        <div className="flex items-center gap-2.5 flex-1 max-w-md">
          <div className="relative w-full">
            <Search className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Filter by keywords or run ID..."
              className="w-full pl-9 pr-3 py-1.5 rounded-lg bg-slate-900 border border-slate-800 text-xs sm:text-sm text-slate-200 placeholder-slate-500 focus:outline-none focus:border-indigo-500"
            />
          </div>
        </div>

        <div className="flex items-center gap-2.5 self-end sm:self-auto">
          <div className="flex items-center gap-1.5">
            <Filter className="h-3.5 w-3.5 text-slate-400" />
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="px-2.5 py-1.5 rounded-lg bg-slate-900 border border-slate-800 text-xs text-slate-200 focus:outline-none focus:border-indigo-500 cursor-pointer"
            >
              <option value="ALL">All Statuses</option>
              <option value="COMPLETED">Completed</option>
              <option value="RUNNING">Running</option>
              <option value="PENDING">Queued</option>
              <option value="FAILED">Failed</option>
              <option value="CANCELLED">Cancelled</option>
            </select>
          </div>

          <Button
            variant="outline"
            size="sm"
            onClick={onRefresh}
            disabled={isLoading}
            leftIcon={
              isLoading ? (
                <Loader2 className="h-3 w-3 animate-spin text-slate-400" />
              ) : (
                <RefreshCw className="h-3 w-3 text-slate-400" />
              )
            }
          >
            Refresh
          </Button>
        </div>
      </div>

      {/* Table or Empty State */}
      {isLoading && jobs.length === 0 ? (
        <div className="p-12 text-center rounded-xl border border-slate-800 bg-[#0c121e]/40 space-y-3">
          <Loader2 className="h-6 w-6 animate-spin text-indigo-400 mx-auto" />
          <p className="text-sm text-slate-400">Loading research jobs ledger...</p>
        </div>
      ) : filteredJobs.length === 0 ? (
        <EmptyState
          icon={Layers}
          title={jobs.length === 0 ? "No research jobs yet" : "No matching research runs"}
          description={
            jobs.length === 0
              ? "Queue your first Meta advertising research task above to begin discovering public ads."
              : "No jobs match your current search or status filter. Try clearing the filters."
          }
          primaryAction={
            jobs.length > 0
              ? {
                  label: "Clear Filters",
                  onClick: () => {
                    setSearchQuery("");
                    setStatusFilter("ALL");
                  },
                }
              : undefined
          }
        />
      ) : (
        <Table>
          <TableHead>
            <tr>
              <TableHeaderCell>Research Query</TableHeaderCell>
              <TableHeaderCell>Status</TableHeaderCell>
              <TableHeaderCell className="text-right">Retrieved</TableHeaderCell>
              <TableHeaderCell className="text-right">Valid</TableHeaderCell>
              <TableHeaderCell className="text-right">New Unique</TableHeaderCell>
              <TableHeaderCell className="text-right">Duplicates</TableHeaderCell>
              <TableHeaderCell>Created</TableHeaderCell>
              <TableHeaderCell className="text-right">Actions</TableHeaderCell>
            </tr>
          </TableHead>
          <TableBody>
            {filteredJobs.map((job) => {
              const statusPresentation = mapMetaJobStatus(job.status);
              const isCancelling = actionLoadingId === `cancel-${job.id}`;
              const isRetrying = actionLoadingId === `retry-${job.id}`;
              const firstKeyword = job.keywords?.[0] || "Meta Search";
              const extraKeywordsCount = (job.keywords?.length || 1) - 1;

              return (
                <TableRow key={job.id}>
                  {/* Research Query */}
                  <TableCell>
                    <div className="space-y-0.5">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className="font-medium text-slate-100">{firstKeyword}</span>
                        {extraKeywordsCount > 0 && (
                          <span className="text-[10px] px-1.5 py-0.2 rounded bg-slate-800 text-slate-400 border border-slate-700">
                            +{extraKeywordsCount}
                          </span>
                        )}
                      </div>
                      <p className="text-[11px] text-slate-400 font-mono truncate max-w-[180px]">
                        {job.id}
                      </p>
                    </div>
                  </TableCell>

                  {/* Status */}
                  <TableCell>
                    <Badge variant={statusPresentation.variant} size="sm" dot={!statusPresentation.isTerminal}>
                      {statusPresentation.label}
                    </Badge>
                  </TableCell>

                  {/* Counts */}
                  <TableCell className="text-right font-mono text-xs text-slate-300">
                    {job.actualRetrievedCount}
                  </TableCell>
                  <TableCell className="text-right font-mono text-xs text-emerald-400 font-semibold">
                    {job.validCount}
                  </TableCell>
                  <TableCell className="text-right font-mono text-xs text-indigo-300">
                    {job.newUniqueCount}
                  </TableCell>
                  <TableCell className="text-right font-mono text-xs text-slate-400">
                    {job.existingDuplicateCount}
                  </TableCell>

                  {/* Created Time */}
                  <TableCell className="text-xs text-slate-400 whitespace-nowrap">
                    {formatTime(job.createdAt)}
                  </TableCell>

                  {/* Actions */}
                  <TableCell className="text-right">
                    <div className="flex items-center justify-end gap-1.5">
                      {/* Inspect details button */}
                      <button
                        onClick={() => onSelectJob(job)}
                        className="p-1.5 rounded-lg text-slate-400 hover:text-slate-200 hover:bg-slate-800 transition-colors cursor-pointer"
                        title="View job details"
                        aria-label="View job details"
                      >
                        <Eye className="h-4 w-4" />
                      </button>

                      {/* View Ads Explorer shortcut if ads exist */}
                      {job.validCount > 0 && (
                        <Link
                          href={`/explorer?query=${encodeURIComponent(firstKeyword)}`}
                          className="p-1.5 rounded-lg text-emerald-400 hover:text-emerald-300 hover:bg-emerald-500/10 transition-colors"
                          title="View discovered ads in Explorer"
                          aria-label="View discovered ads in Explorer"
                        >
                          <ExternalLink className="h-4 w-4" />
                        </Link>
                      )}

                      {/* Cancel action */}
                      {statusPresentation.canCancel && (
                        <button
                          onClick={() => handleCancel(job.id)}
                          disabled={isCancelling}
                          className="p-1.5 rounded-lg text-red-400 hover:text-red-300 hover:bg-red-500/10 transition-colors cursor-pointer disabled:opacity-50"
                          title="Cancel queued task"
                          aria-label="Cancel queued task"
                        >
                          {isCancelling ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            <Ban className="h-4 w-4" />
                          )}
                        </button>
                      )}

                      {/* Retry action */}
                      {statusPresentation.canRetry && (
                        <button
                          onClick={() => handleRetry(job.id)}
                          disabled={isRetrying}
                          className="p-1.5 rounded-lg text-slate-400 hover:text-slate-200 hover:bg-slate-800 transition-colors cursor-pointer disabled:opacity-50"
                          title="Retry research task"
                          aria-label="Retry research task"
                        >
                          {isRetrying ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            <RotateCcw className="h-4 w-4" />
                          )}
                        </button>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      )}
    </div>
  );
};
