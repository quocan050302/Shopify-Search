import { describe, it, expect } from "vitest";
import { mapMetaJobStatus } from "../../src/lib/meta/mapMetaJobStatus";

describe("mapMetaJobStatus", () => {
  it("maps COMPLETED to success badge and terminal flags", () => {
    const res = mapMetaJobStatus("COMPLETED");
    expect(res.label).toBe("Completed");
    expect(res.variant).toBe("success");
    expect(res.isTerminal).toBe(true);
    expect(res.canViewAds).toBe(true);
    expect(res.canCancel).toBe(false);
  });

  it("maps RUNNING to info badge with cancellation enabled", () => {
    const res = mapMetaJobStatus("RUNNING");
    expect(res.label).toBe("Running");
    expect(res.variant).toBe("info");
    expect(res.isTerminal).toBe(false);
    expect(res.canCancel).toBe(true);
    expect(res.canRetry).toBe(false);
  });

  it("maps PENDING to warning badge with cancellation enabled", () => {
    const res = mapMetaJobStatus("PENDING");
    expect(res.label).toBe("Queued");
    expect(res.variant).toBe("warning");
    expect(res.isTerminal).toBe(false);
    expect(res.canCancel).toBe(true);
  });

  it("maps FAILED to danger badge with retry enabled", () => {
    const res = mapMetaJobStatus("FAILED");
    expect(res.label).toBe("Failed");
    expect(res.variant).toBe("danger");
    expect(res.isTerminal).toBe(true);
    expect(res.canRetry).toBe(true);
  });

  it("maps BLOCKED_SOURCE to danger badge with source restriction details", () => {
    const res = mapMetaJobStatus("BLOCKED_SOURCE");
    expect(res.label).toBe("Source restricted");
    expect(res.variant).toBe("danger");
    expect(res.isTerminal).toBe(true);
    expect(res.canRetry).toBe(true);
  });

  it("maps RATE_LIMITED to warning badge", () => {
    const res = mapMetaJobStatus("RATE_LIMITED");
    expect(res.label).toBe("Rate limited");
    expect(res.variant).toBe("warning");
    expect(res.isTerminal).toBe(true);
    expect(res.canRetry).toBe(true);
  });
});
