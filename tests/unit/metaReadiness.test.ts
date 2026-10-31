import { describe, it, expect } from "vitest";
import {
  normalizeMetaHealth,
  ProviderHealthResponse,
} from "../../src/lib/meta/normalizeMetaHealth";

describe("Meta Discovery Readiness Model", () => {
  it("returns LOADING state when health is null or loading", () => {
    const result = normalizeMetaHealth(null, true);
    expect(result.state).toBe("LOADING");
    expect(result.canStartResearch).toBe(false);
    expect(result.canQueueForLater).toBe(false);
    expect(result.primaryActionLabel).toBe("Checking...");
  });

  it("returns SETUP_REQUIRED when Python binary is missing", () => {
    const healthFixture: ProviderHealthResponse = {
      provider: {
        id: "meta-ads-collector",
        name: "Meta Ad Library (Local MCP)",
        enabled: true,
        status: "READY",
        isAuthorized: true,
        message: "Provider available",
      },
      environment: {
        pythonReady: false,
        dataDirReady: true,
        defaultCountry: "US",
        liveTestEnabled: false,
      },
      worker: {
        status: "RUNNING",
        lastHeartbeat: new Date().toISOString(),
      },
      history: {
        lastSuccessfulRetrievalAt: null,
        lastSuccessfulRecordCount: 0,
        lastFailureCategory: null,
        lastFailureMessage: null,
      },
      limits: {
        maxResultsPerSearch: 25,
        maxRequestsPerSearch: 5,
        maxExecutionSeconds: 60,
        maxConcurrency: 1,
      },
    };

    const result = normalizeMetaHealth(healthFixture, false);
    expect(result.state).toBe("SETUP_REQUIRED");
    expect(result.canStartResearch).toBe(false);
    expect(result.primaryActionLabel).toBe("Configure Collector");
    expect(result.setupSteps.find((s) => s.id === "python_env")?.status).toBe("NEEDS_ACTION");
  });

  it("returns SETUP_REQUIRED when provider status is NOT_CONFIGURED", () => {
    const healthFixture: ProviderHealthResponse = {
      provider: {
        id: "meta-ads-collector",
        name: "Meta Ad Library (Local MCP)",
        enabled: true,
        status: "NOT_CONFIGURED",
        isAuthorized: false,
        message: "Local MCP Server not configured",
      },
      environment: {
        pythonReady: true,
        dataDirReady: true,
        defaultCountry: "US",
        liveTestEnabled: false,
      },
      worker: {
        status: "RUNNING",
        lastHeartbeat: new Date().toISOString(),
      },
      history: {
        lastSuccessfulRetrievalAt: null,
        lastSuccessfulRecordCount: 0,
        lastFailureCategory: null,
        lastFailureMessage: null,
      },
      limits: {
        maxResultsPerSearch: 25,
        maxRequestsPerSearch: 5,
        maxExecutionSeconds: 60,
        maxConcurrency: 1,
      },
    };

    const result = normalizeMetaHealth(healthFixture, false);
    expect(result.state).toBe("SETUP_REQUIRED");
    expect(result.canStartResearch).toBe(false);
    expect(result.primaryActionLabel).toBe("Configure Collector");
  });

  it("returns WORKER_OFFLINE when provider is ready but background worker is stopped", () => {
    const healthFixture: ProviderHealthResponse = {
      provider: {
        id: "meta-ads-collector",
        name: "Meta Ad Library (Local MCP)",
        enabled: true,
        status: "READY",
        isAuthorized: true,
        message: "Collector operational",
      },
      environment: {
        pythonReady: true,
        dataDirReady: true,
        defaultCountry: "US",
        liveTestEnabled: false,
      },
      worker: {
        status: "STOPPED",
        lastHeartbeat: null,
      },
      history: {
        lastSuccessfulRetrievalAt: null,
        lastSuccessfulRecordCount: 0,
        lastFailureCategory: null,
        lastFailureMessage: null,
      },
      limits: {
        maxResultsPerSearch: 25,
        maxRequestsPerSearch: 5,
        maxExecutionSeconds: 60,
        maxConcurrency: 1,
      },
    };

    const result = normalizeMetaHealth(healthFixture, false);
    expect(result.state).toBe("WORKER_OFFLINE");
    expect(result.canStartResearch).toBe(false);
    expect(result.canQueueForLater).toBe(true);
    expect(result.primaryActionLabel).toBe("Queue for Later");
    expect(result.setupSteps.find((s) => s.id === "worker_process")?.status).toBe("NEEDS_ACTION");
  });

  it("returns SOURCE_RESTRICTED when upstream Meta Ad Library blocked access", () => {
    const healthFixture: ProviderHealthResponse = {
      provider: {
        id: "meta-ads-collector",
        name: "Meta Ad Library (Local MCP)",
        enabled: true,
        status: "READY",
        isAuthorized: true,
        message: "Collector operational",
      },
      environment: {
        pythonReady: true,
        dataDirReady: true,
        defaultCountry: "US",
        liveTestEnabled: false,
      },
      worker: {
        status: "RUNNING",
        lastHeartbeat: new Date().toISOString(),
      },
      history: {
        lastSuccessfulRetrievalAt: null,
        lastSuccessfulRecordCount: 0,
        lastFailureCategory: "BLOCKED_SOURCE",
        lastFailureMessage: "Meta rate limited or anti-bot challenge",
      },
      limits: {
        maxResultsPerSearch: 25,
        maxRequestsPerSearch: 5,
        maxExecutionSeconds: 60,
        maxConcurrency: 1,
      },
    };

    const result = normalizeMetaHealth(healthFixture, false);
    expect(result.state).toBe("SOURCE_RESTRICTED");
    expect(result.canStartResearch).toBe(false);
    expect(result.primaryActionLabel).toBe("Queue for Later");
  });

  it("returns READY when all environment, provider, and worker components are healthy", () => {
    const healthFixture: ProviderHealthResponse = {
      provider: {
        id: "meta-ads-collector",
        name: "Meta Ad Library (Local MCP)",
        enabled: true,
        status: "READY",
        isAuthorized: true,
        message: "Collector operational",
      },
      environment: {
        pythonReady: true,
        dataDirReady: true,
        defaultCountry: "US",
        liveTestEnabled: false,
      },
      worker: {
        status: "RUNNING",
        lastHeartbeat: new Date().toISOString(),
      },
      history: {
        lastSuccessfulRetrievalAt: new Date().toISOString(),
        lastSuccessfulRecordCount: 25,
        lastFailureCategory: null,
        lastFailureMessage: null,
      },
      limits: {
        maxResultsPerSearch: 25,
        maxRequestsPerSearch: 5,
        maxExecutionSeconds: 60,
        maxConcurrency: 1,
      },
    };

    const result = normalizeMetaHealth(healthFixture, false);
    expect(result.state).toBe("READY");
    expect(result.canStartResearch).toBe(true);
    expect(result.primaryActionLabel).toBe("Start Research");
    expect(result.setupSteps.every((s) => s.status === "COMPLETE")).toBe(true);
  });

  it("returns UNKNOWN state when health is null and not loading (prevents infinite LOADING spinner)", () => {
    const result = normalizeMetaHealth(null, false);
    expect(result.state).toBe("UNKNOWN");
    expect(result.canStartResearch).toBe(false);
    expect(result.primaryActionLabel).toBe("Run Diagnostics");
  });

  it("allows newer successful retrieval to supersede older BLOCKED_SOURCE failure", () => {
    const olderFailure = new Date(Date.now() - 3600_000).toISOString(); // 1 hour ago
    const newerSuccess = new Date(Date.now() - 600_000).toISOString();  // 10 mins ago

    const healthFixture: ProviderHealthResponse = {
      provider: {
        id: "meta-ads-collector",
        name: "Meta Ad Library (Local MCP)",
        enabled: true,
        status: "READY",
        isAuthorized: true,
        message: "Collector operational",
      },
      environment: {
        pythonReady: true,
        dataDirReady: true,
        defaultCountry: "US",
        liveTestEnabled: false,
      },
      worker: {
        status: "RUNNING",
        lastHeartbeat: new Date().toISOString(),
      },
      history: {
        lastSuccessfulRetrievalAt: newerSuccess,
        lastSuccessfulRecordCount: 20,
        lastFailureCategory: "BLOCKED_SOURCE",
        lastFailureMessage: "Old challenge",
        lastFailureAt: olderFailure,
      },
      limits: {
        maxResultsPerSearch: 25,
        maxRequestsPerSearch: 5,
        maxExecutionSeconds: 60,
        maxConcurrency: 1,
      },
    };

    const result = normalizeMetaHealth(healthFixture, false);
    // Because newer success happened AFTER the failure, status should be READY, not permanently restricted!
    expect(result.state).toBe("READY");
    expect(result.canStartResearch).toBe(true);
  });
});
