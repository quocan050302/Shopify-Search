"use client";

import React, { useState, useMemo, useEffect } from "react";
import {
  Search,
  SlidersHorizontal,
  ChevronDown,
  ChevronUp,
  Play,
  Clock,
  AlertCircle,
  HelpCircle,
} from "lucide-react";
import { Button } from "@/components/ui/Button";
import { NormalizedReadiness } from "@/lib/meta/normalizeMetaHealth";
import {
  MetaResearchFormState,
  validateMetaResearchForm,
} from "@/lib/meta/validateMetaResearchForm";
import { getAllowedResearchLimits } from "@/lib/meta/getAllowedResearchLimits";

export type CreateResearchResult =
  | { ok: true; runId: string; queuedStatus?: string }
  | { ok: false; error: string };

export interface MetaResearchFormProps {
  readiness: NormalizedReadiness;
  maxBudget: number;
  isSubmitting: boolean;
  onSubmit: (formData: MetaResearchFormState) => Promise<CreateResearchResult>;
  onOpenSetupGuide?: () => void;
}

export const MetaResearchForm: React.FC<MetaResearchFormProps> = ({
  readiness,
  maxBudget,
  isSubmitting,
  onSubmit,
  onOpenSetupGuide,
}) => {
  const [keywordsInput, setKeywordsInput] = useState("");
  const [market] = useState("US");
  const [requestedLimit, setRequestedLimit] = useState<number>(Math.min(25, maxBudget));
  const [creativePreference, setCreativePreference] = useState<"VIDEO" | "IMAGE" | "ALL">("ALL");
  const [activeStatus, setActiveStatus] = useState<"ACTIVE" | "INACTIVE" | "ALL">("ACTIVE");
  const [launchWithinDays, setLaunchWithinDays] = useState<number | undefined>(undefined);
  const [advertiserPageId, setAdvertiserPageId] = useState("");
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [formErrors, setFormErrors] = useState<{ keywords?: string; limit?: string }>({});
  const [isSubmittingLocal, setIsSubmittingLocal] = useState(false);

  const allowedLimits = useMemo(() => getAllowedResearchLimits(maxBudget), [maxBudget]);

  useEffect(() => {
    if (requestedLimit > maxBudget && maxBudget > 0) {
      setRequestedLimit(maxBudget);
    }
  }, [maxBudget, requestedLimit]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    // Prevent duplicate or rapid concurrent submissions
    if (isSubmitting || isSubmittingLocal) {
      return;
    }

    const currentState: MetaResearchFormState = {
      keywordsInput,
      market,
      requestedLimit,
      creativePreference,
      activeStatus,
      launchWithinDays,
      advertiserPageId: advertiserPageId.trim() || undefined,
    };

    const validation = validateMetaResearchForm(currentState, {
      maxResultsPerSearch: maxBudget,
    });

    if (!validation.isValid) {
      setFormErrors(validation.errors);
      return;
    }

    setFormErrors({});
    setIsSubmittingLocal(true);
    try {
      const result = await onSubmit(currentState);
      if (result.ok) {
        // Clear keywords only on confirmed successful backend mutation
        setKeywordsInput("");
        setAdvertiserPageId("");
        setFormErrors({});
      } else {
        // On failure: PRESERVE keywordsInput, advertiserPageId, and all filters!
        setFormErrors({ keywords: result.error || "Failed to queue research task." });
      }
    } catch (err: any) {
      setFormErrors({ keywords: err.message || "Failed to submit research request." });
    } finally {
      setIsSubmittingLocal(false);
    }
  };

  // Quick preset keyword helper
  const handleApplyPreset = (kw: string) => {
    if (!keywordsInput.trim()) {
      setKeywordsInput(kw);
    } else {
      setKeywordsInput(`${keywordsInput}, ${kw}`);
    }
  };

  return (
    <form
      onSubmit={handleSubmit}
      className="p-5 rounded-xl border border-slate-800 bg-[#0c121e]/90 shadow-sm space-y-4"
    >
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-slate-200 flex items-center gap-2">
          <Search className="h-4 w-4 text-indigo-400" />
          <span>New Research Request</span>
        </h2>
        <span className="text-xs text-slate-400">
          Collector Budget: <strong className="text-slate-200">{maxBudget}</strong> ads/task
        </span>
      </div>

      {/* Main Grid: Keywords & Quick Options */}
      <div className="grid grid-cols-1 md:grid-cols-12 gap-4">
        {/* Keywords input */}
        <div className="md:col-span-8 space-y-1.5">
          <label htmlFor="meta-keywords-input" className="block text-xs font-medium text-slate-300">
            Search Keywords <span className="text-slate-400 font-normal">(comma-separated)</span>
          </label>
          <div className="relative">
            <input
              id="meta-keywords-input"
              type="text"
              value={keywordsInput}
              onChange={(e) => {
                setKeywordsInput(e.target.value);
                if (formErrors.keywords) setFormErrors((prev) => ({ ...prev, keywords: undefined }));
              }}
              placeholder="e.g. pet hair remover, cleaning gadget, posture corrector"
              className={`w-full px-3.5 py-2 rounded-lg bg-slate-900 border text-sm text-slate-200 placeholder-slate-500 focus:outline-none focus:ring-1 transition-colors ${
                formErrors.keywords
                  ? "border-red-500/80 focus:border-red-500 focus:ring-red-500"
                  : "border-slate-800 focus:border-indigo-500 focus:ring-indigo-500"
              }`}
            />
          </div>
          {formErrors.keywords ? (
            <p className="text-xs text-red-400 flex items-center gap-1">
              <AlertCircle className="h-3 w-3 shrink-0" />
              <span>{formErrors.keywords}</span>
            </p>
          ) : (
            <div className="flex items-center gap-2 flex-wrap pt-0.5">
              <span className="text-[11px] text-slate-400">Popular:</span>
              {["gadget", "kitchen", "beauty", "pet"].map((tag) => (
                <button
                  key={tag}
                  type="button"
                  onClick={() => handleApplyPreset(tag)}
                  className="text-[11px] px-2 py-0.5 rounded bg-slate-800/80 hover:bg-slate-700/80 text-slate-400 hover:text-slate-200 transition-colors cursor-pointer"
                >
                  +{tag}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Market (Locked to US) */}
        <div className="md:col-span-2 space-y-1.5">
          <label className="block text-xs font-medium text-slate-300">Target Market</label>
          <div className="px-3.5 py-2 rounded-lg bg-slate-900/50 border border-slate-800 text-sm text-slate-300 flex items-center justify-between cursor-not-allowed">
            <span>United States</span>
            <span className="text-[10px] font-mono text-slate-400">US 🇺🇸</span>
          </div>
        </div>

        {/* Max Results */}
        <div className="md:col-span-2 space-y-1.5">
          <label htmlFor="meta-limit-select" className="block text-xs font-medium text-slate-300">
            Max Results
          </label>
          <select
            id="meta-limit-select"
            value={requestedLimit}
            onChange={(e) => setRequestedLimit(Number(e.target.value))}
            className="w-full px-3 py-2 rounded-lg bg-slate-900 border border-slate-800 text-sm text-slate-200 focus:outline-none focus:border-indigo-500 transition-colors cursor-pointer"
          >
            {allowedLimits.map((lim) => (
              <option key={lim} value={lim}>
                {lim} ads {lim === 25 ? "(standard)" : lim === maxBudget ? "(max)" : ""}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Advanced Filters Toggle */}
      <div className="pt-1">
        <button
          type="button"
          onClick={() => setShowAdvanced((prev) => !prev)}
          className="flex items-center gap-1.5 text-xs text-slate-400 hover:text-slate-300 font-medium transition-colors cursor-pointer"
        >
          <SlidersHorizontal className="h-3.5 w-3.5 text-slate-500" />
          <span>Advanced Research Parameters</span>
          {showAdvanced ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
        </button>

        {showAdvanced && (
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3.5 mt-3 pt-3 border-t border-slate-800/80 animate-in fade-in-50 duration-150">
            <div className="space-y-1.5">
              <label htmlFor="meta-active-status" className="block text-xs font-medium text-slate-400">Delivery Status</label>
              <select
                id="meta-active-status"
                value={activeStatus}
                onChange={(e) => setActiveStatus(e.target.value as any)}
                className="w-full px-3 py-1.5 rounded-lg bg-slate-900 border border-slate-800 text-xs text-slate-200 focus:outline-none focus:border-indigo-500"
              >
                <option value="ACTIVE">Active Ads Only</option>
                <option value="INACTIVE">Inactive / Historic</option>
                <option value="ALL">All Delivery Statuses</option>
              </select>
            </div>

            <div className="space-y-1.5">
              <label htmlFor="meta-creative-preference" className="block text-xs font-medium text-slate-400">Creative Format</label>
              <select
                id="meta-creative-preference"
                value={creativePreference}
                onChange={(e) => setCreativePreference(e.target.value as any)}
                className="w-full px-3 py-1.5 rounded-lg bg-slate-900 border border-slate-800 text-xs text-slate-200 focus:outline-none focus:border-indigo-500"
              >
                <option value="ALL">All Creative Types</option>
                <option value="VIDEO">Video Ads Only</option>
                <option value="IMAGE">Static Image Only</option>
              </select>
            </div>

            <div className="space-y-1.5">
              <label htmlFor="meta-freshness-select" className="block text-xs font-medium text-slate-400">Launch Freshness</label>
              <select
                id="meta-freshness-select"
                value={launchWithinDays || ""}
                onChange={(e) => setLaunchWithinDays(e.target.value ? Number(e.target.value) : undefined)}
                className="w-full px-3 py-1.5 rounded-lg bg-slate-900 border border-slate-800 text-xs text-slate-200 focus:outline-none focus:border-indigo-500"
              >
                <option value="">Any Launch Date</option>
                <option value="7">Last 7 Days</option>
                <option value="30">Last 30 Days</option>
                <option value="90">Last 90 Days</option>
              </select>
            </div>

            <div className="space-y-1.5">
              <label htmlFor="meta-page-id-input" className="block text-xs font-medium text-slate-400">Advertiser Page ID</label>
              <input
                id="meta-page-id-input"
                type="text"
                value={advertiserPageId}
                onChange={(e) => setAdvertiserPageId(e.target.value)}
                placeholder="Optional Meta page ID"
                className="w-full px-3 py-1.5 rounded-lg bg-slate-900 border border-slate-800 text-xs text-slate-200 focus:outline-none focus:border-indigo-500"
              >
              </input>
            </div>
          </div>
        )}
      </div>

      {/* Footer: Smart Primary Action */}
      <div className="pt-2 flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-t border-slate-800/80">
        <div className="text-xs text-slate-400">
          {readiness.state === "WORKER_OFFLINE" ? (
            <p className="text-amber-400/90 flex items-center gap-1.5">
              <Clock className="h-3.5 w-3.5 shrink-0" />
              <span>Worker offline: task will queue durably until worker is started.</span>
            </p>
          ) : readiness.state === "SETUP_REQUIRED" ? (
            <p className="text-slate-400">
              Complete collector setup above before queuing new searches.
            </p>
          ) : (
            <p className="text-slate-400">
              Authentic queries dispatched through local MetaAdsCollector daemon.
            </p>
          )}
        </div>

        <div className="flex items-center gap-2 self-end sm:self-auto">
          {readiness.state === "SETUP_REQUIRED" ? (
            <Button
              type="button"
              variant="secondary"
              onClick={onOpenSetupGuide}
              className="text-amber-300 border-amber-500/30"
            >
              Configure Collector
            </Button>
          ) : (
            <Button
              type="submit"
              variant="primary"
              isLoading={isSubmitting || isSubmittingLocal}
              disabled={isSubmitting || isSubmittingLocal}
              leftIcon={<Play className="h-4 w-4 fill-current" />}
            >
              {readiness.primaryActionLabel}
            </Button>
          )}
        </div>
      </div>
    </form>
  );
};
