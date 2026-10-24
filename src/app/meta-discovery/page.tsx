"use client";

import { useState } from "react";
import { Header } from "@/components/layout/Header";
import { MetaWorkspaceHeader } from "@/components/meta/MetaWorkspaceHeader";
import { MetaSetupGuide } from "@/components/meta/MetaSetupGuide";
import { MetaResearchForm } from "@/components/meta/MetaResearchForm";
import { MetaJobsTable, MetaRequestItem } from "@/components/meta/MetaJobsTable";
import { MetaJobDetailsDrawer } from "@/components/meta/MetaJobDetailsDrawer";
import { MetaDiagnosticsPanel } from "@/components/meta/MetaDiagnosticsPanel";
import { useMetaDiscovery } from "@/hooks/useMetaDiscovery";
import { AlertCircle, CheckCircle2, X } from "lucide-react";

export default function MetaDiscoveryPage() {
  const {
    health,
    jobs,
    readiness,
    isInitialLoading,
    isRefreshing,
    isSubmitting,
    error,
    successMessage,
    lastCheckedAt,
    setError,
    setSuccessMessage,
    refreshWorkspace,
    createJob,
    cancelJob,
    retryJob,
  } = useMetaDiscovery();

  const [diagnosticsOpen, setDiagnosticsOpen] = useState(false);
  const [selectedJob, setSelectedJob] = useState<MetaRequestItem | null>(null);

  const maxBudget = health?.limits?.maxResultsPerSearch || 25;

  return (
    <div className="flex-1 flex flex-col min-h-screen bg-[#0B1020]">
      <Header />

      <main className="p-4 sm:p-6 lg:p-8 max-w-7xl mx-auto w-full space-y-6">
        {/* Workspace Top Header */}
        <MetaWorkspaceHeader
          readiness={readiness}
          isRefreshing={isRefreshing}
          onRefresh={() => refreshWorkspace(false)}
          onOpenDiagnostics={() => setDiagnosticsOpen(true)}
        />

        {/* Actionable Feedback Banners */}
        {error && (
          <div className="p-3.5 rounded-xl border border-red-500/30 bg-red-500/10 flex items-start justify-between gap-3 text-xs text-red-200 animate-in fade-in-50 duration-150">
            <div className="flex items-center gap-2">
              <AlertCircle className="h-4 w-4 text-red-400 shrink-0" />
              <span>{error}</span>
            </div>
            <button
              onClick={() => setError(null)}
              className="p-1 rounded text-red-400 hover:text-red-200 hover:bg-red-500/20 transition-colors"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        )}

        {successMessage && (
          <div className="p-3.5 rounded-xl border border-emerald-500/30 bg-emerald-500/10 flex items-start justify-between gap-3 text-xs text-emerald-200 animate-in fade-in-50 duration-150">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4 text-emerald-400 shrink-0" />
              <span>{successMessage}</span>
            </div>
            <button
              onClick={() => setSuccessMessage(null)}
              className="p-1 rounded text-emerald-400 hover:text-emerald-200 hover:bg-emerald-500/20 transition-colors"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        )}

        {/* Setup Guide (Shown only when action is required) */}
        <MetaSetupGuide
          readiness={readiness}
          onOpenDiagnostics={() => setDiagnosticsOpen(true)}
        />

        {/* Research Task Creation Form */}
        <MetaResearchForm
          readiness={readiness}
          maxBudget={maxBudget}
          isSubmitting={isSubmitting}
          onSubmit={async (formData) => {
            await createJob(formData);
          }}
          onOpenSetupGuide={() => setDiagnosticsOpen(true)}
        />

        {/* Research Jobs Section */}
        <section className="space-y-3 pt-2" id="jobs">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-base font-semibold text-slate-100">
                Research Jobs Ledger
              </h2>
              <p className="text-xs text-slate-400">
                Track collection runs, inspect retrieved ad counts, and navigate to discovered creatives.
              </p>
            </div>
            <span className="text-xs text-slate-400 font-mono">
              {jobs.length} total {jobs.length === 1 ? "run" : "runs"}
            </span>
          </div>

          <MetaJobsTable
            jobs={jobs}
            isLoading={isInitialLoading}
            onRefresh={() => refreshWorkspace(false)}
            onSelectJob={(job) => setSelectedJob(job)}
            onCancelJob={cancelJob}
            onRetryJob={retryJob}
          />
        </section>
      </main>

      {/* Diagnostics Modal */}
      <MetaDiagnosticsPanel
        isOpen={diagnosticsOpen}
        onClose={() => setDiagnosticsOpen(false)}
        health={health}
        lastCheckedAt={lastCheckedAt}
        onRunDiagnostics={() => refreshWorkspace(false)}
      />

      {/* Contextual Job Details Drawer */}
      <MetaJobDetailsDrawer
        job={selectedJob}
        onClose={() => setSelectedJob(null)}
      />
    </div>
  );
}
