import { describe, it, expect } from "vitest";
import { deriveResearchAction } from "@/lib/meta/researchActionPolicy";
import { NormalizedReadiness } from "@/lib/meta/normalizeMetaHealth";

describe("Research Action Policy (deriveResearchAction)", () => {
  const baseReadiness: NormalizedReadiness = {
    state: "READY",
    title: "System Operational",
    message: "Ready to research Meta public ads.",
    badgeVariant: "success",
    canStartResearch: true,
    canQueueForLater: true,
    primaryActionLabel: "Start Research",
    setupSteps: [],
  };

  it("returns START with submit button when READY", () => {
    const action = deriveResearchAction({ ...baseReadiness, state: "READY", canStartResearch: true });
    expect(action.kind).toBe("START");
    expect(action.label).toBe("Start Research");
    expect(action.enabled).toBe(true);
    expect(action.buttonType).toBe("submit");
  });

  it("returns QUEUE with submit button when WORKER_OFFLINE and canQueueForLater is true", () => {
    const action = deriveResearchAction({
      ...baseReadiness,
      state: "WORKER_OFFLINE",
      canStartResearch: false,
      canQueueForLater: true,
    });
    expect(action.kind).toBe("QUEUE");
    expect(action.label).toBe("Queue for Later");
    expect(action.enabled).toBe(true);
    expect(action.buttonType).toBe("submit");
  });

  it("returns SETUP with non-submitting button when SETUP_REQUIRED", () => {
    const action = deriveResearchAction({
      ...baseReadiness,
      state: "SETUP_REQUIRED",
      canStartResearch: false,
      canQueueForLater: false,
    });
    expect(action.kind).toBe("SETUP");
    expect(action.label).toBe("Configure Collector");
    expect(action.enabled).toBe(true);
    expect(action.buttonType).toBe("button");
  });

  it("returns DIAGNOSTICS with non-submitting button when UNKNOWN", () => {
    const action = deriveResearchAction({
      ...baseReadiness,
      state: "UNKNOWN",
      canStartResearch: false,
      canQueueForLater: false,
    });
    expect(action.kind).toBe("DIAGNOSTICS");
    expect(action.label).toBe("Run Diagnostics");
    expect(action.enabled).toBe(true);
    expect(action.buttonType).toBe("button");
  });

  it("returns WAIT with disabled non-submitting button when LOADING", () => {
    const action = deriveResearchAction({
      ...baseReadiness,
      state: "LOADING",
      canStartResearch: false,
      canQueueForLater: false,
    });
    expect(action.kind).toBe("WAIT");
    expect(action.label).toBe("Checking...");
    expect(action.enabled).toBe(false);
    expect(action.buttonType).toBe("button");
  });

  it("returns QUEUE when SOURCE_RESTRICTED and durable queueing is allowed", () => {
    const action = deriveResearchAction({
      ...baseReadiness,
      state: "SOURCE_RESTRICTED",
      canStartResearch: false,
      canQueueForLater: true,
    });
    expect(action.kind).toBe("QUEUE");
    expect(action.label).toBe("Queue for Later");
    expect(action.enabled).toBe(true);
    expect(action.buttonType).toBe("submit");
  });

  it("returns DIAGNOSTICS when SOURCE_RESTRICTED and durable queueing is disallowed", () => {
    const action = deriveResearchAction({
      ...baseReadiness,
      state: "SOURCE_RESTRICTED",
      canStartResearch: false,
      canQueueForLater: false,
    });
    expect(action.kind).toBe("DIAGNOSTICS");
    expect(action.label).toBe("Run Diagnostics");
    expect(action.enabled).toBe(true);
    expect(action.buttonType).toBe("button");
  });
});
