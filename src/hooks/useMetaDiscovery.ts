"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import {
  ProviderHealthResponse,
  normalizeMetaHealth,
  NormalizedReadiness,
} from "@/lib/meta/normalizeMetaHealth";
import {
  ResearchAuthorizationStatus,
  ResearchAuthorizationState,
} from "@/lib/meta/researchActionPolicy";
import { MetaRequestItem } from "@/components/meta/MetaJobsTable";
import { MetaResearchFormState } from "@/lib/meta/validateMetaResearchForm";

export type { ResearchAuthorizationStatus, ResearchAuthorizationState };

export type CreateResearchResult =
  | { ok: true; runId: string; queuedStatus?: string }
  | { ok: false; error: string };

export interface MetaDiscoveryErrors {
  health?: string | null;
  jobs?: string | null;
  mutation?: string | null;
}

export interface ResearchJobsPagination {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export function useMetaDiscovery() {
  const [health, setHealth] = useState<ProviderHealthResponse | null>(null);
  const [authorization, setAuthorization] = useState<ResearchAuthorizationStatus>({
    state: "CHECKING",
    authorized: false,
  });
  const [jobs, setJobs] = useState<MetaRequestItem[]>([]);
  const [isInitialLoading, setIsInitialLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errors, setErrors] = useState<MetaDiscoveryErrors>({});
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [lastCheckedAt, setLastCheckedAt] = useState<string | undefined>(undefined);

  // Server-side pagination & filter state
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [statusFilter, setStatusFilter] = useState("ALL");
  const [searchQuery, setSearchQuery] = useState("");
  const [pagination, setPagination] = useState<ResearchJobsPagination>({
    page: 1,
    pageSize: 20,
    total: 0,
    totalPages: 1,
  });

  const isMountedRef = useRef(true);
  const healthAbortRef = useRef<AbortController | null>(null);
  const authAbortRef = useRef<AbortController | null>(null);
  const jobsAbortRef = useRef<AbortController | null>(null);
  const isRefreshingRef = useRef(false);

  // 1. Fetch Authorization Status
  const fetchAuthStatus = useCallback(async (): Promise<ResearchAuthorizationStatus> => {
    authAbortRef.current?.abort();
    const controller = new AbortController();
    authAbortRef.current = controller;

    try {
      const res = await fetch("/api/v1/auth/status", {
        signal: controller.signal,
        headers: { "Cache-Control": "no-cache" },
      });
      if (!res.ok) {
        const errorStatus: ResearchAuthorizationStatus = {
          state: "UNAVAILABLE",
          authorized: false,
          code: `HTTP_${res.status}`,
          message: `Authorization service returned HTTP ${res.status}`,
        };
        if (isMountedRef.current) setAuthorization(errorStatus);
        return errorStatus;
      }
      const json = await res.json();
      let state: ResearchAuthorizationState = "UNAVAILABLE";
      if (json.authorized) {
        state = json.authMode === "LOCAL_DEV" ? "AUTHORIZED_LOCAL" : "AUTHORIZED_SESSION";
      } else {
        if (json.code === "INVALID_ADMIN_TOKEN") {
          state = "INVALID_CREDENTIALS";
        } else if (json.code === "FORBIDDEN" || json.code === "UNAUTHORIZED_WORKSPACE") {
          state = "FORBIDDEN";
        } else {
          state = "AUTH_REQUIRED";
        }
      }
      const authResult: ResearchAuthorizationStatus = {
        state,
        authorized: Boolean(json.authorized),
        authMode: json.authMode || null,
        code: json.code,
        message: json.message,
      };
      if (isMountedRef.current) {
        setAuthorization(authResult);
      }
      return authResult;
    } catch (err: any) {
      if (err.name === "AbortError") return { state: "CHECKING", authorized: false };
      const errorStatus: ResearchAuthorizationStatus = {
        state: "UNAVAILABLE",
        authorized: false,
        code: "NETWORK_ERROR",
        message: err.message || "Failed to contact authorization service",
      };
      if (isMountedRef.current) setAuthorization(errorStatus);
      return errorStatus;
    }
  }, []);

  // 1. Fetch Health (with AbortController protection)
  const fetchHealth = useCallback(async (): Promise<ProviderHealthResponse | null> => {
    healthAbortRef.current?.abort();
    const controller = new AbortController();
    healthAbortRef.current = controller;

    try {
      const res = await fetch("/api/v1/discovery/meta/provider/health", {
        signal: controller.signal,
      });
      if (!res.ok) throw new Error(`Health query failed (HTTP ${res.status})`);
      const json: ProviderHealthResponse = await res.json();
      if (isMountedRef.current) {
        setHealth(json);
        setLastCheckedAt(new Date().toISOString());
        setErrors((prev) => ({ ...prev, health: null }));
      }
      return json;
    } catch (err: any) {
      if (err.name === "AbortError") return null;
      console.warn("Meta health check failed:", err.message);
      if (isMountedRef.current) {
        setErrors((prev) => ({ ...prev, health: err.message || "Failed to query provider health" }));
      }
      return null;
    }
  }, []);

  // 2. Fetch Jobs (with server-side filtering, pagination & AbortController)
  const fetchJobs = useCallback(
    async (overrideParams?: {
      page?: number;
      pageSize?: number;
      status?: string;
      query?: string;
    }): Promise<MetaRequestItem[]> => {
      jobsAbortRef.current?.abort();
      const controller = new AbortController();
      jobsAbortRef.current = controller;

      const p = overrideParams?.page ?? page;
      const ps = overrideParams?.pageSize ?? pageSize;
      const s = overrideParams?.status ?? statusFilter;
      const q = overrideParams?.query ?? searchQuery;

      try {
        const searchParams = new URLSearchParams({
          page: String(p),
          pageSize: String(ps),
        });
        if (s && s !== "ALL") searchParams.set("status", s);
        if (q && q.trim()) searchParams.set("query", q.trim());

        const res = await fetch(`/api/v1/discovery/meta/requests?${searchParams.toString()}`, {
          signal: controller.signal,
        });
        if (!res.ok) {
          if (res.status === 401 || res.status === 403) {
            if (isMountedRef.current) {
              setErrors((prev) => ({
                ...prev,
                jobs: "Authentication required to view research jobs ledger.",
              }));
              setJobs([]);
            }
            return [];
          }
          throw new Error(`Jobs fetch failed (HTTP ${res.status})`);
        }
        const json = await res.json();
        const items: MetaRequestItem[] = json.data || [];
        if (isMountedRef.current) {
          setJobs(items);
          if (json.pagination) {
            setPagination({
              page: json.pagination.page,
              pageSize: json.pagination.pageSize,
              total: json.pagination.total,
              totalPages: json.pagination.totalPages || 1,
            });
          }
          setErrors((prev) => ({ ...prev, jobs: null }));
        }
        return items;
      } catch (err: any) {
        if (err.name === "AbortError") return [];
        console.warn("Meta jobs fetch failed:", err.message);
        if (isMountedRef.current) {
          setErrors((prev) => ({ ...prev, jobs: err.message || "Failed to fetch research jobs" }));
        }
        return [];
      }
    },
    [page, pageSize, statusFilter, searchQuery]
  );

  // 3. Refresh Workspace (prevents overlapping refreshes)
  const refreshWorkspace = useCallback(
    async (isBackground = false) => {
      if (isRefreshingRef.current) return;
      isRefreshingRef.current = true;
      if (!isBackground) setIsRefreshing(true);
      try {
        await Promise.all([fetchHealth(), fetchJobs(), fetchAuthStatus()]);
      } finally {
        isRefreshingRef.current = false;
        if (isMountedRef.current) {
          setIsRefreshing(false);
          setIsInitialLoading(false);
        }
      }
    },
    [fetchHealth, fetchJobs, fetchAuthStatus]
  );

  // 4. Create Research Request
  const createJob = useCallback(
    async (formData: MetaResearchFormState): Promise<CreateResearchResult> => {
      if (!authorization.authorized) {
        const errMsg =
          authorization.message || "Administrator authorization required to start research.";
        setErrors((prev) => ({ ...prev, mutation: errMsg }));
        return { ok: false, error: errMsg };
      }

      setIsSubmitting(true);
      setErrors((prev) => ({ ...prev, mutation: null }));
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
          if (res.status === 401 || res.status === 403) {
            if (isMountedRef.current) {
              setAuthorization({
                state: res.status === 401 ? "AUTH_REQUIRED" : "FORBIDDEN",
                authorized: false,
                code: json.error || "UNAUTHORIZED",
                message: json.message || "Authorization required to create research tasks.",
              });
            }
          }
          const errMsg =
            (typeof json.error === "string" ? json.error : json.error?.message) ||
            json.message ||
            "Failed to queue research task.";
          throw new Error(errMsg);
        }

        const runId = json.runId;
        const queuedStatus = json.status || "PENDING";
        setSuccessMessage(`Research task queued successfully (Run ID: ${runId}).`);
        await refreshWorkspace(true);
        return { ok: true, runId, queuedStatus };
      } catch (err: any) {
        const errMsg = err.message || "Failed to create research request";
        setErrors((prev) => ({ ...prev, mutation: errMsg }));
        return { ok: false, error: errMsg };
      } finally {
        if (isMountedRef.current) setIsSubmitting(false);
      }
    },
    [authorization, refreshWorkspace]
  );

  // 5. Cancel Job
  const cancelJob = useCallback(
    async (jobId: string) => {
      setErrors((prev) => ({ ...prev, mutation: null }));
      try {
        const res = await fetch(`/api/v1/discovery/meta/requests/${jobId}/cancel`, {
          method: "POST",
        });
        const json = await res.json();
        if (!res.ok) {
          const errMsg =
            (typeof json.error === "string" ? json.error : json.error?.message) ||
            json.message ||
            "Could not cancel task";
          throw new Error(errMsg);
        }
        setSuccessMessage(`Task '${jobId}' has been cancelled.`);
        await refreshWorkspace(true);
      } catch (err: any) {
        setErrors((prev) => ({ ...prev, mutation: err.message || "Cancellation failed" }));
      }
    },
    [refreshWorkspace]
  );

  // 6. Retry Job
  const retryJob = useCallback(
    async (jobId: string) => {
      setErrors((prev) => ({ ...prev, mutation: null }));
      try {
        const res = await fetch(`/api/v1/discovery/meta/requests/${jobId}/retry`, {
          method: "POST",
        });
        const json = await res.json();
        if (!res.ok) {
          const errMsg =
            (typeof json.error === "string" ? json.error : json.error?.message) ||
            json.message ||
            "Could not retry task";
          throw new Error(errMsg);
        }
        setSuccessMessage(`Retry attempt queued (New Run ID: ${json.newRunId}).`);
        await refreshWorkspace(true);
      } catch (err: any) {
        setErrors((prev) => ({ ...prev, mutation: err.message || "Retry failed" }));
      }
    },
    [refreshWorkspace]
  );

  // Filter & Pagination handlers that trigger fetch
  const handlePageChange = useCallback(
    (newPage: number) => {
      setPage(newPage);
      fetchJobs({ page: newPage });
    },
    [fetchJobs]
  );

  const handleStatusFilterChange = useCallback(
    (newStatus: string) => {
      setStatusFilter(newStatus);
      setPage(1);
      fetchJobs({ status: newStatus, page: 1 });
    },
    [fetchJobs]
  );

  const handleSearchQueryChange = useCallback(
    (newQuery: string) => {
      setSearchQuery(newQuery);
      setPage(1);
      fetchJobs({ query: newQuery, page: 1 });
    },
    [fetchJobs]
  );

  // Adaptive visibility-aware polling
  const hasActiveJobs = jobs.some((j) => j.status === "PENDING" || j.status === "RUNNING");

  useEffect(() => {
    isMountedRef.current = true;
    refreshWorkspace();

    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        refreshWorkspace(true);
      }
    };
    document.addEventListener("visibilitychange", handleVisibilityChange);

    const intervalTime = hasActiveJobs ? 10000 : 35000;
    const interval = setInterval(() => {
      if (document.visibilityState === "visible") {
        refreshWorkspace(true);
      }
    }, intervalTime);

    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      clearInterval(interval);
    };
  }, [refreshWorkspace, hasActiveJobs]);

  // Derived error string for backward-compatible feedback banners
  const error = errors.mutation || errors.jobs || errors.health || null;

  const setError = useCallback((msg: string | null) => {
    setErrors((prev) => ({ ...prev, mutation: msg }));
  }, []);

  // Derived readiness model
  const readiness: NormalizedReadiness = normalizeMetaHealth(health, isInitialLoading);

  return {
    health,
    authorization,
    jobs,
    readiness,
    pagination,
    page,
    pageSize,
    statusFilter,
    searchQuery,
    isInitialLoading,
    isRefreshing,
    isSubmitting,
    error,
    errors,
    successMessage,
    lastCheckedAt,
    setError,
    setSuccessMessage,
    setPage: handlePageChange,
    setStatusFilter: handleStatusFilterChange,
    setSearchQuery: handleSearchQueryChange,
    refreshWorkspace,
    fetchAuthStatus,
    createJob,
    cancelJob,
    retryJob,
  };
}
