import { describe, it, expect, vi } from "vitest";
import { parseAcceptanceCliArgs } from "../../scripts/kh01/runFullAcceptance";

describe("KH-01 Acceptance CLI Arguments Parser (Section 05)", () => {
  it("defaults to offline-only with no flags provided", () => {
    const opts = parseAcceptanceCliArgs(["node", "runFullAcceptance.ts"]);
    expect(opts.runLiveSource).toBe(false);
    expect(opts.requestedScope).toBe("OFFLINE");
  });

  it("sets runLiveSource true and scope FULL_LIVE with --live-meta", () => {
    const opts = parseAcceptanceCliArgs(["node", "runFullAcceptance.ts", "--live-meta"]);
    expect(opts.runLiveSource).toBe(true);
    expect(opts.requestedScope).toBe("FULL_LIVE");
  });

  it("sets runLiveSource false and scope OFFLINE with --offline-only", () => {
    const opts = parseAcceptanceCliArgs(["node", "runFullAcceptance.ts", "--offline-only"]);
    expect(opts.runLiveSource).toBe(false);
    expect(opts.requestedScope).toBe("OFFLINE");
  });

  it("rejects conflicting arguments --live-meta and --offline-only", () => {
    expect(() =>
      parseAcceptanceCliArgs(["node", "runFullAcceptance.ts", "--live-meta", "--offline-only"])
    ).toThrow(/Conflicting/);
  });

  it("rejects unknown arguments with nonzero error", () => {
    expect(() =>
      parseAcceptanceCliArgs(["node", "runFullAcceptance.ts", "--unknown-flag"])
    ).toThrow(/Unknown/);
  });

  it("handles --help without throwing error", () => {
    const exitSpy = vi.spyOn(process, "exit").mockImplementation((() => {}) as any);
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    try {
      parseAcceptanceCliArgs(["node", "runFullAcceptance.ts", "--help"]);
      expect(exitSpy).toHaveBeenCalledWith(0);
    } finally {
      exitSpy.mockRestore();
      logSpy.mockRestore();
    }
  });
});
