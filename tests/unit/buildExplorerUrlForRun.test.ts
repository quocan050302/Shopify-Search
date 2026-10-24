import { describe, it, expect } from "vitest";
import { buildExplorerUrlForRun } from "@/lib/meta/buildExplorerUrlForRun";

describe("buildExplorerUrlForRun", () => {
  it("generates an Explorer URL with platform and requestId", () => {
    const url = buildExplorerUrlForRun("run_abc_123", "META");
    expect(url).toBe("/explorer?platform=META&requestId=run_abc_123");
  });

  it("defaults platform to META if not specified", () => {
    const url = buildExplorerUrlForRun("run_xyz_999");
    expect(url).toBe("/explorer?platform=META&requestId=run_xyz_999");
  });

  it("encodes special characters safely in runId", () => {
    const url = buildExplorerUrlForRun("run/123+456#test", "META");
    expect(url).toBe("/explorer?platform=META&requestId=run%2F123%2B456%23test");
  });

  it("supports other platforms like TIKTOK", () => {
    const url = buildExplorerUrlForRun("run_tiktok_01", "TIKTOK");
    expect(url).toBe("/explorer?platform=TIKTOK&requestId=run_tiktok_01");
  });
});
