"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import {
  ProviderHealthResponse,
  normalizeMetaHealth,
  NormalizedReadiness,
} from "@/lib/meta/normalizeMetaHealth";
import { MetaRequestItem } from "@/components/meta/MetaJobsTable";
import { MetaResearchFormState } from "@/lib/meta/validateMetaResearchForm";

export function useMetaDiscovery() {
  const [health, setHealth] = useState<ProviderHealthResponse | null>(null);
  const [jobs, setJobs] = useState<MetaRequestItem[]>([]);
  const [isInitialLoading, setIsInitialLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [lastCheckedAt, setLastCheckedAt] = useState<string | undefined>(undefined);

  const isMountedRef = useRef(true);
  const abortControllerRef = useRef<AbortController | null>(null);

  // 1. Fetch Health
  const fetchHealth = useCallback(async (): Promise<ProviderHealthResponse | null> => {
    try {
      const res = await fetch("/api/v1/discovery/meta/provider/health");
      if (!res.ok) throw new Error("Failed to query provider health");
      const json: ProviderHealthResponse = await res.json();
      if (isMountedRef.current) {
        setHealth(json);
        setLastCheckedAt(new Date().toISOString());
      }
      return json;
    } catch (err: any) {
      console.warn("Meta health check failed:", err.message);
      return null;
    }
  }, []);

  // 2. Fetch Jobs
  const fetchJobs = useCallback(async (): Promise<MetaRequestItem[]> => {
    try {
      const res = await fetch("/api/v1/discovery/meta/requests?pageSize=50");
      if (!res.ok) throw new Error("Failed to fetch research jobs");
      const json = await res.json();
      const items: MetaRequestItem[] = json.data || [];
      if (isMountedRef.current) {
        setJobs(items);
      }
      return items;
    } catch (err: any) {
      console.warn("Meta jobs fetch failed:", err.message);
      return [];
    }
  }, []);

  // 3. Refresh Workspace
  const refreshWorkspace = useCallback(async (isBackground = false) => {
    if (!isBackground) setIsRefreshing(true);
    try {
      await Promise.all([fetchHealth(), fetchJobs()]);
    } finally {
      if (isMountedRef.current) {
        setIsRefreshing(false);
        setIsInitialLoading(false);
      }
    }
  }, [fetchHealth, fetchJobs]);

  // 4. Create Research Request
  const createJob = useCallback(
    async (formData: MetaResearchFormState): Promise<string | null> => {
      setIsSubmitting(true);
      setError(null);
      setSuccessMessage(null);

      try {
        const rawKeywords = formData.keywordsInput
          .split(",")
          .map((k) => k.trim())
          .filter((k) => k.length > 0);

        const res = await fetch("/api/v1/discovery/meta/requests", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            keywords: rawKeywords,
            market: formData.market,
            requestedLimit: formData.requestedLimit,
            creativePreference: formData.creativePreference,
            activeStatus: formData.activeStatus,
            launchWithinDays: formData.launchWithinDays,
            advertiserPageId: formData.advertiserPageId || undefined,
          }),
        });

        const json = await res.json();
        if (!res.ok || !json.success) {
          throw new Error(json.message || json.error || "Failed to queue research task.");
        }

        const runId = json.runId;
        setSuccessMessage(`Research task queued successfully (Run ID: ${runId}).`);
        await refreshWorkspace(true);
        return runId;
      } catch (err: any) {
        setError(err.message || "Failed to create research request");
        return null;
      } finally {
        if (isMountedRef.current) setIsSubmitting(false);
      }
    },
    [refreshWorkspace]
  );

  // 5. Cancel Job
  const cancelJob = useCallback(
    async (jobId: string) => {
      setError(null);
      try {
        const res = await fetch(`/api/v1/discovery/meta/requests/${jobId}/cancel`, {
          method: "POST",
        });
        const json = await res.json();
        if (!res.ok) throw new Error(json.message || "Could not cancel task");
        setSuccessMessage(`Task '${jobId}' has been cancelled.`);
        await refreshWorkspace(true);
      } catch (err: any) {
        setError(err.message || "Cancellation failed");
      }
    },
    [refreshWorkspace]
  );

  // 6. Retry Job
  const retryJob = useCallback(
    async (jobId: string) => {
      setError(null);
      try {
        const res = await fetch(`/api/v1/discovery/meta/requests/${jobId}/retry`, {
          method: "POST",
        });
        const json = await res.json();
        if (!res.ok) throw new Error(json.message || "Could not retry task");
        setSuccessMessage(`Retry attempt queued (New Run ID: ${json.newRunId}).`);
        await refreshWorkspace(true);
      } catch (err: any) {
        setError(err.message || "Retry failed");
      }
    },
    [refreshWorkspace]
  );

  // Initial fetch and visibility-aware polling
  useEffect(() => {
    isMountedRef.current = true;
    refreshWorkspace();

    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        refreshWorkspace(true);
      }
    };
    document.addEventListener("visibilitychange", handleVisibilityChange);

    // Adaptive polling: poll every 10s if any job is RUNNING or PENDING, else every 30s
    const interval = setInterval(() => {
      if (document.visibilityState === "visible") {
        refreshWorkspace(true);
      }
    }, 12000);

    return () => {
      isMountedRef.current = false;
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      clearInterval(interval);
    };
  }, [refreshWorkspace]);

  // Derived readiness model
  const readiness: NormalizedReadiness = normalizeMetaHealth(health, isInitialLoading);

  return {
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
  };
}
